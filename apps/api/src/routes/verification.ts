import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { config } from '../config.ts';
import { AppError } from '../lib/errors.ts';
import { requireAuth } from '../lib/auth.ts';
import { toIso, toIsoOrNull } from '../lib/serialize.ts';
import { audit } from '../services/audit.ts';

const submitSchema = z
  .object({
    id_type: z.enum(['driving_licence', 'voter_id', 'passport']),
    id_front_key: z.string().min(1).max(256),
    id_back_key: z.string().max(256).optional(),
    selfie_key: z.string().min(1).max(256),
    consent_version: z.string().max(32).optional(),
  })
  .strict();

interface VerificationRow {
  id: string;
  user_id: string;
  state: string;
  id_type: string | null;
  reason_code: string | null;
  decided_at: Date | null;
  created_at: Date;
  attempts?: number;
}

function view(row: VerificationRow, attempts: number) {
  return {
    id: row.id,
    user_id: row.user_id,
    state: row.state,
    id_type: row.id_type,
    reason_code: row.reason_code,
    attempts: Math.min(3, attempts),
    decided_at: toIsoOrNull(row.decided_at),
    created_at: toIso(row.created_at),
  };
}

export async function verificationRoutes(app: FastifyInstance): Promise<void> {
  const db = app.db;

  app.get('/verifications/me', async (req) => {
    const auth = requireAuth(req);
    const res = await db.query<VerificationRow>(
      `SELECT * FROM verifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [auth.userId],
    );
    const row = res.rows[0];
    if (!row) {
      // No verification yet: return the empty state without inventing a record.
      return {
        id: '00000000-0000-4000-8000-000000000000',
        user_id: auth.userId,
        state: 'not_started',
        id_type: null,
        reason_code: null,
        attempts: 0,
        decided_at: null,
        created_at: new Date(0).toISOString(),
      };
    }
    const count = await db.query<{ count: string }>(`SELECT count(*)::text AS count FROM verifications WHERE user_id = $1`, [
      auth.userId,
    ]);
    return view(row, Number(count.rows[0]?.count ?? 1));
  });

  app.post('/verifications', async (req, reply) => {
    const auth = requireAuth(req);
    if (!config.FEATURE_VERIFICATION_SUBMISSIONS_ENABLED) {
      throw new AppError('FORBIDDEN', { reason: 'verification_submissions_disabled' });
    }
    const body = submitSchema.parse(req.body);

    const prior = await db.query<VerificationRow>(
      `SELECT * FROM verifications WHERE user_id = $1 ORDER BY created_at DESC`,
      [auth.userId],
    );
    const attempts = prior.rows.length;
    if (attempts >= 3) {
      throw new AppError('FORBIDDEN', { reason: 'verification_attempts_exhausted' }, 'Contact support to continue verification.');
    }
    const latest = prior.rows[0];
    if (latest && latest.state === 'pending') {
      throw new AppError('CONFLICT', { reason: 'verification_pending' }, 'Your verification is already with our team.');
    }
    if (latest && latest.state === 'verified') throw new AppError('CONFLICT', { reason: 'already_verified' }, 'You are already verified.');

    const created = await db.transaction(async (tx) => {
      const v = await tx.query<VerificationRow>(
        `INSERT INTO verifications (user_id, state, id_type) VALUES ($1,'pending',$2) RETURNING *`,
        [auth.userId, body.id_type],
      );
      const row = v.rows[0]!;

      const docs: Array<{ kind: string; key: string }> = [
        { kind: 'id_front', key: body.id_front_key },
        { kind: 'selfie', key: body.selfie_key },
      ];
      if (body.id_back_key) docs.push({ kind: 'id_back', key: body.id_back_key });

      for (const doc of docs) {
        await tx.query(
          `INSERT INTO verification_documents
            (verification_id, kind, object_key, content_sha256, mime_type, byte_size, purge_after)
           VALUES ($1,$2,$3,$4,'image/jpeg',1024,$5)`,
          [row.id, doc.kind, doc.key, 'pending-server-hash', new Date(Date.now() + 180 * 24 * 3_600_000)],
        );
      }
      return row;
    });

    // NOTE: The 'traveller' role is intentionally NOT granted here.
    // It is granted exclusively by an admin reviewer in POST /admin/verifications/:id/decision
    // when decision=approve. Granting it on submission would allow unverified users to act
    // as travellers before KYC approval.
    await audit(db, {
      actorId: auth.userId,
      actorKind: 'user',
      action: 'verification.submitted',
      resource: 'verification',
      resourceId: created.id,
      after: { id_type: body.id_type },
    });

    return reply.code(201).send(view(created, attempts + 1));
  });
}
