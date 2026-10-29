import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

import { requireAuth } from '../lib/auth.ts';
import { STAFF_ROLES } from '../lib/admin-access.ts';
import { toIso } from '../lib/serialize.ts';

/**
 * Change feed for client synchronisation.
 *
 * The app used to update only when a screen happened to refetch: some lists polled, some did not,
 * and a screen that was already mounted never learned that the other party had acted. The fix is
 * not a WebSocket — it is one authoritative "has anything I can see changed?" answer that both
 * clients poll while they are in the foreground and then reconcile through the normal endpoints.
 *
 * Why this shape:
 *
 *  - It reads the authoritative tables, so a missed poll can never leave a client permanently
 *    wrong. There is no event log to fall behind, and no event can be published for a transaction
 *    that did not commit: a row only exists here after COMMIT.
 *  - It is scoped to the caller. Every subquery filters on `$1` (or on the caller's membership),
 *    so it cannot disclose another user's parcel, booking, message or count. Staff-only figures
 *    are a separate query and are simply absent for everyone else.
 *  - It returns opaque revisions, not data. A revision changes when the underlying rows change;
 *    the client then invalidates the matching React Query keys and the screens refetch through
 *    the endpoints that already enforce authorisation.
 *  - It is one statement, so a poll is one round trip. That matters on a serverless database
 *    where connection setup dominates a small query.
 *
 * This endpoint deliberately does NOT deliver payloads and does NOT claim exactly-once delivery.
 * It is reconciliation, which is the part that has to be reliable.
 */

interface ScopeRow {
  bookings: string;
  parcels: string;
  trips: string;
  notifications: string;
  messages: string;
  verification: string;
  interests: string;
  notifications_unread: string;
  messages_unread: string;
}

interface AdminRow {
  pending_verifications: string;
  verifications_at: string | null;
  open_disputes: string;
  disputes_at: string | null;
  pending_payouts: string;
  payouts_at: string | null;
}

/** Statuses that no longer need the user's attention. Mirrors the client-side closed sets. */
const CLOSED_BOOKING_STATUSES = [
  'delivered',
  'payout_eligible',
  'paid_out',
  'cancelled_by_sender',
  'cancelled_by_traveller',
  'cancelled_ineligible',
  'cancelled_safety',
  'expired',
  'refunded',
] as const;

function revisionOf(...parts: unknown[]): string {
  return createHash('sha256').update(parts.map((p) => String(p ?? '')).join('|')).digest('hex').slice(0, 20);
}

const USER_SCOPES_SQL = `
WITH me AS (SELECT $1::uuid AS uid)
SELECT
  -- Bookings I am a party to. updated_at moves on every state transition and on cancellation.
  (SELECT coalesce(max(b.updated_at)::text, '') || '|' || count(*)::text
     FROM bookings b CROSS JOIN me
    WHERE b.sender_id = me.uid OR b.traveller_id = me.uid) AS bookings,
  -- Parcels I sent. updated_at moves on status changes (posted, matched, cancelled, closed).
  (SELECT coalesce(max(p.updated_at)::text, '') || '|' || count(*)::text
     FROM parcels p CROSS JOIN me
    WHERE p.sender_id = me.uid) AS parcels,
  -- Trips I published. trips has no updated_at, so capacity and status are folded into the marker:
  -- accepting a booking changes capacity_kg_remaining, which the traveller's trip screen shows.
  (SELECT coalesce(max(t.created_at)::text, '') || '|' || count(*)::text || '|' ||
          coalesce(sum(t.capacity_kg_remaining), 0)::text || '|' ||
          coalesce(string_agg(t.status::text, ',' ORDER BY t.id), '')
     FROM trips t CROSS JOIN me
    WHERE t.traveller_id = me.uid) AS trips,
  -- Notification history, including read-state changes.
  (SELECT coalesce(max(n.created_at)::text, '') || '|' || count(*)::text || '|' ||
          count(*) FILTER (WHERE n.read_at IS NOT NULL)::text
     FROM notifications n CROSS JOIN me
    WHERE n.user_id = me.uid) AS notifications,
  -- Messages in threads I am a member of, plus my own last_read_at so marking read is a change.
  (SELECT coalesce(max(m.created_at)::text, '') || '|' || count(*)::text || '|' ||
          coalesce(max(cm.last_read_at)::text, '')
     FROM messages m
     JOIN conversation_members cm ON cm.conversation_id = m.conversation_id
     CROSS JOIN me
    WHERE cm.user_id = me.uid AND m.removed_at IS NULL) AS messages,
  (SELECT coalesce(max(v.updated_at)::text, '') || '|' || count(*)::text
     FROM verifications v CROSS JOIN me
    WHERE v.user_id = me.uid) AS verification,
  -- Interest a traveller expressed on one of my parcels, or that I expressed on someone's trip.
  (SELECT coalesce(max(x.created_at)::text, '') || '|' || count(*)::text FROM (
     SELECT ti.created_at
       FROM trip_interests ti
       JOIN parcels p ON p.id = ti.parcel_id
       CROSS JOIN me
      WHERE p.sender_id = me.uid
     UNION ALL
     SELECT ti.created_at
       FROM trip_interests ti CROSS JOIN me
      WHERE ti.traveller_id = me.uid
   ) x) AS interests,
  (SELECT count(*)::text
     FROM notifications n CROSS JOIN me
    WHERE n.user_id = me.uid AND n.read_at IS NULL AND n.channel = 'in_app') AS notifications_unread,
  -- Same unread definition as GET /v1/conversations, so the badge and the inbox never disagree.
  (SELECT count(*)::text
     FROM messages m
     JOIN conversation_members cm ON cm.conversation_id = m.conversation_id
     CROSS JOIN me
    WHERE cm.user_id = me.uid
      AND m.removed_at IS NULL
      AND m.kind <> 'system'
      AND m.sender_id <> me.uid
      AND (cm.last_read_at IS NULL OR m.created_at > cm.last_read_at)) AS messages_unread
`;

const ADMIN_SCOPES_SQL = `
SELECT
  (SELECT count(*)::text FROM verifications WHERE state = 'pending') AS pending_verifications,
  (SELECT max(updated_at)::text FROM verifications WHERE state = 'pending') AS verifications_at,
  (SELECT count(*)::text FROM disputes
    WHERE state IN ('open', 'evidence_requested', 'under_review')) AS open_disputes,
  (SELECT max(created_at)::text FROM disputes
    WHERE state IN ('open', 'evidence_requested', 'under_review')) AS disputes_at,
  (SELECT count(*)::text FROM payouts WHERE state = 'eligible') AS pending_payouts,
  (SELECT max(created_at)::text FROM payouts WHERE state = 'eligible') AS payouts_at
`;

export async function syncRoutes(app: FastifyInstance): Promise<void> {
  const db = app.db;

  app.get('/sync/state', async (req, reply) => {
    const auth = requireAuth(req);

    // A poll is per-user and must never be served from a shared cache.
    reply.header('cache-control', 'no-store');

    const user = await db.query<ScopeRow>(USER_SCOPES_SQL, [auth.userId]);
    const row = user.rows[0];
    if (!row) {
      // The aggregate always returns exactly one row; this is defensive, not a real branch.
      return reply.code(200).send({
        generated_at: new Date().toISOString(),
        revision: revisionOf(),
        scopes: {},
        counts: { notifications_unread: 0, messages_unread: 0 },
      });
    }

    const scopes: Record<string, string> = {
      bookings: revisionOf(row.bookings),
      parcels: revisionOf(row.parcels),
      trips: revisionOf(row.trips),
      notifications: revisionOf(row.notifications),
      messages: revisionOf(row.messages),
      verification: revisionOf(row.verification),
      interests: revisionOf(row.interests),
    };

    const body: {
      generated_at: string;
      revision: string;
      scopes: Record<string, string>;
      counts: { notifications_unread: number; messages_unread: number };
      admin?: {
        pending_verifications: number;
        open_disputes: number;
        pending_payouts: number;
      };
    } = {
      generated_at: new Date().toISOString(),
      revision: '',
      scopes,
      counts: {
        notifications_unread: Number(row.notifications_unread ?? 0),
        messages_unread: Number(row.messages_unread ?? 0),
      },
    };

    // Staff queues are only ever computed for staff. A non-staff caller does not receive the key,
    // not even as zeroes, so the response does not reveal whether staff data exists.
    const isStaff = auth.roles.some((role) => (STAFF_ROLES as readonly string[]).includes(role));
    if (isStaff) {
      const admin = await db.query<AdminRow>(ADMIN_SCOPES_SQL);
      const a = admin.rows[0];
      if (a) {
        const pendingVerifications = Number(a.pending_verifications ?? 0);
        const openDisputes = Number(a.open_disputes ?? 0);
        const pendingPayouts = Number(a.pending_payouts ?? 0);
        body.admin = {
          pending_verifications: pendingVerifications,
          open_disputes: openDisputes,
          pending_payouts: pendingPayouts,
        };
        scopes.admin = revisionOf(
          pendingVerifications,
          a.verifications_at,
          openDisputes,
          a.disputes_at,
          pendingPayouts,
          a.payouts_at,
        );
      }
    }

    body.revision = revisionOf(...Object.keys(scopes).sort().map((k) => `${k}:${scopes[k]}`));

    app.log.debug(
      { user_id: auth.userId, generated_at: toIso(body.generated_at), staff: isStaff },
      'sync state',
    );

    return reply.code(200).send(body);
  });
}
