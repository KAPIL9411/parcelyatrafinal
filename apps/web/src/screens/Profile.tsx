import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { ID_TYPE_LABELS, type IdType } from '@py/domain';

import {
  api,
  type Inbox,
  type NotificationItem,
  type Profile as ProfileRecord,
  type Verification,
} from '../lib/api';
import { formatDateTime, timeAgo } from '../lib/format';
import { useDocumentTitle } from '../lib/hooks';
import { useSession } from '../lib/session';
import {
  Banner,
  Button,
  Card,
  ErrorPanel,
  Field,
  SectionHeading,
  Select,
  Sheet,
  SuccessPanel,
  TextInput,
  cn,
} from '../components/ui';
import { Chip, VerificationChip } from '../components/StatusChip';
import {
  AlertTriangleIcon,
  ChatIcon,
  DownloadIcon,
  LogoutIcon,
  ShieldCheckIcon,
  UserIcon,
} from '../components/icons';

interface NotificationList {
  items: NotificationItem[];
  next_cursor: string | null;
  unread_count: number;
}

const TEMPLATE_LABELS: Record<string, string> = {
  booking_requested: 'A sender asked you to carry a parcel',
  traveller_interested: 'A traveller offered to carry one of your parcels',
  booking_accepted: 'Your traveller accepted',
  booking_declined: 'The traveller declined',
  booking_cancelled: 'A booking was cancelled',
  payment_captured: 'Payment confirmed',
  payment_failed: 'A payment did not complete',
  pickup_ready: 'Pickup is ready',
  pickup_code_ready: 'A pickup code is ready to read out',
  delivery_code_ready: 'A delivery code is ready to read out',
  message_received: 'A new message on one of your bookings',
  pickup_confirmed: 'The parcel was picked up',
  in_transit: 'The parcel is on the way',
  arrived: 'The traveller has arrived',
  trip_changed: 'A traveller changed the trip you booked',
  delivered: 'The parcel was delivered',
  delivery_failed: 'A delivery attempt failed',
  dispute_opened: 'A problem was raised',
  dispute_resolved: 'A problem was resolved',
  payout_eligible: 'The problem window closed',
  verification_approved: 'Your ID was verified',
  verification_rejected: 'Your verification was not accepted',
  otp: 'A handover code was sent',
};

export function Profile() {
  useDocumentTitle('Your account');
  const { user, setUser, signOut, isStaff } = useSession();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [name, setName] = useState(user?.name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [locale, setLocale] = useState(user?.locale ?? 'en-IN');
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<unknown>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [markingRead, setMarkingRead] = useState(false);
  const [markReadError, setMarkReadError] = useState<unknown>(null);

  const verification = useQuery({
    queryKey: ['verification', 'me'],
    queryFn: () => api.get<Verification>('/verifications/me'),
    enabled: Boolean(user),
  });

  const notifications = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get<NotificationList>('/notifications?limit=20'),
    enabled: Boolean(user),
  });

  const inbox = useQuery({
    queryKey: ['conversations'],
    queryFn: () => api.get<Inbox>('/conversations?limit=10'),
    enabled: Boolean(user),
  });

  if (!user) return null;

  async function markAllRead() {
    setMarkingRead(true);
    setMarkReadError(null);
    try {
      await api.post('/notifications/read-all', {});
      await queryClient.invalidateQueries({ queryKey: ['notifications'] });
    } catch (err) {
      setMarkReadError(err);
    } finally {
      setMarkingRead(false);
    }
  }

  async function save() {
    setSaveBusy(true);
    setSaveError(null);
    setSaved(false);
    try {
      const updated = await api.patch<ProfileRecord>('/me', {
        ...(name.trim() ? { name: name.trim() } : {}),
        ...(email.trim() ? { email: email.trim() } : {}),
        locale,
      });
      setUser(updated);
      setSaved(true);
    } catch (err) {
      setSaveError(err);
    } finally {
      setSaveBusy(false);
    }
  }

  async function requestExport() {
    setExportBusy(true);
    setExportMessage(null);
    try {
      await api.post('/me/export', {});
      setExportMessage('Queued. We will text you when the file is ready. It can take up to 48 hours.');
    } catch (err) {
      setExportMessage(null);
      setSaveError(err);
    } finally {
      setExportBusy(false);
    }
  }

  async function requestDeletion() {
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await api.post('/me/deletion-request', { confirm: true, reason: 'requested_in_app' });
      setDeleteOpen(false);
      await signOut();
      navigate('/');
    } catch (err) {
      setDeleteError(err);
    } finally {
      setDeleteBusy(false);
    }
  }

  const vState = verification.data?.state ?? user.verification_state;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <p className="text-xs font-medium tracking-wide text-ink-500 uppercase">Your account</p>
        <h1 className="mt-1 text-[22px] font-semibold tracking-tight text-ink-900 sm:text-2xl">
          {user.name ?? (user.phone_last4 ? `Account ending ${user.phone_last4}` : 'Your account')}
        </h1>
        <p className="mt-1 text-sm text-ink-500">
          {user.phone_last4
            ? `A phone number ending ${user.phone_last4}, ${
                user.phone_verified ? 'verified' : 'not verified — you added it to the account yourself'
              }. We never show the full number.`
            : `Signed in as ${user.email ?? 'a Google account'}.`}
          {user.email && !user.phone_last4 ? (
            <span> {user.email_verified ? 'Google verified this address.' : 'This address is not verified yet.'}</span>
          ) : null}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="sm:col-span-2">
          <SectionHeading title="Details" description="Only your name and email are shown to the other side. Never your number." />
          <div className="space-y-4">
            <Field label="Name" htmlFor="name" hint="First name is enough. This is what the other side sees.">
              <TextInput
                id="name"
                value={name}
                maxLength={80}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. Aarti"
              />
            </Field>
            <Field label="Email" htmlFor="email" optional hint="Used for receipts only. No marketing unless you ask.">
              <TextInput
                id="email"
                type="email"
                value={email}
                maxLength={254}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
              />
            </Field>
            <Field label="Language" htmlFor="locale">
              <Select id="locale" value={locale} onChange={(event) => setLocale(event.target.value)}>
                <option value="en-IN">English</option>
                <option value="hi-IN">हिन्दी (Hindi)</option>
              </Select>
            </Field>

            {saveError ? <ErrorPanel error={saveError} /> : null}
            {saved ? <SuccessPanel title="Saved" /> : null}

            <Button loading={saveBusy} onClick={() => void save()}>
              Save changes
            </Button>
          </div>
        </Card>

        <div className="space-y-4">
          <Card>
            <div className="flex items-center gap-2">
              <ShieldCheckIcon size={18} className="text-brand-700" />
              <h2 className="text-sm font-semibold text-ink-900">Verification</h2>
            </div>
            <div className="mt-2">
              <VerificationChip state={vState} />
            </div>
            <p className="mt-2 text-sm text-ink-500">
              {verification.data?.id_type
                ? `Submitted with ${ID_TYPE_LABELS[verification.data.id_type as IdType] ?? verification.data.id_type}.`
                : 'Required before you can publish a trip.'}
            </p>
            <Link to="/verification" className="mt-3 inline-block">
              <Button variant="secondary" size="sm">
                {vState === 'verified' ? 'View verification' : 'Manage verification'}
              </Button>
            </Link>
          </Card>

          {isStaff ? (
            <Card>
              <div className="flex items-center gap-2">
                <UserIcon size={18} className="text-brand-700" />
                <h2 className="text-sm font-semibold text-ink-900">Operations</h2>
              </div>
              <p className="mt-1 text-sm text-ink-500">This account holds a staff role.</p>
              <Link to="/admin" className="mt-3 inline-block">
                <Button variant="secondary" size="sm">
                  Open operations
                </Button>
              </Link>
            </Card>
          ) : null}
        </div>
      </div>

      <Card>
        <SectionHeading
          title="Messages"
          description="One thread per booking, shared with the other side. It stays readable after delivery as the record of what was agreed."
        />
        {inbox.isLoading ? (
          <p className="text-sm text-ink-500">Loading…</p>
        ) : inbox.isError ? (
          <ErrorPanel error={inbox.error} onRetry={() => void inbox.refetch()} />
        ) : (inbox.data?.items.length ?? 0) === 0 ? (
          <p className="text-sm text-ink-500">Nothing here yet. A thread opens when a booking is accepted.</p>
        ) : (
          <ul className="divide-y divide-line">
            {inbox.data?.items.map((thread) => (
              <li key={thread.conversation_id}>
                <Link to={`/bookings/${thread.booking_id}`} className="flex items-start gap-3 py-3">
                  <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-50 text-brand-700">
                    <ChatIcon size={16} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className={cn('text-sm', thread.unread_count > 0 ? 'font-semibold text-ink-900' : 'font-medium text-ink-900')}>
                        {thread.counterparty ?? 'Parcel Yatra user'}
                      </span>
                      <span className="text-xs text-ink-500">
                        {thread.role === 'sender' ? 'you are sending' : thread.role === 'traveller' ? 'you are carrying' : 'you are receiving'}
                      </span>
                      {thread.closed ? (
                        <Chip tone="neutral" icon={false}>
                          closed
                        </Chip>
                      ) : null}
                      {thread.unread_count > 0 ? (
                        <Chip tone="brand" icon={false}>
                          {thread.unread_count} new
                        </Chip>
                      ) : null}
                    </span>
                    <span className="mt-0.5 block truncate text-sm text-ink-500">
                      {thread.last_message ?? 'No messages yet — say where you can hand over.'}
                    </span>
                    {thread.last_at ? <span className="mt-0.5 block text-xs text-ink-300">{timeAgo(thread.last_at)}</span> : null}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <SectionHeading
          title="Notifications"
          description="What we sent, and when. Bodies are never stored with personal data."
          action={
            (notifications.data?.unread_count ?? 0) > 0 ? (
              <div className="flex items-center gap-3">
                <span className="tabular text-xs font-semibold text-brand-700">
                  {notifications.data?.unread_count} unread
                </span>
                <Button variant="secondary" size="sm" loading={markingRead} onClick={() => void markAllRead()}>
                  Mark all as read
                </Button>
              </div>
            ) : null
          }
        />
        {markReadError ? <ErrorPanel error={markReadError} /> : null}
        {notifications.isLoading ? (
          <p className="text-sm text-ink-500">Loading…</p>
        ) : notifications.isError ? (
          <ErrorPanel error={notifications.error} onRetry={() => void notifications.refetch()} />
        ) : (notifications.data?.items.length ?? 0) === 0 ? (
          <p className="text-sm text-ink-500">Nothing yet. Booking updates appear here.</p>
        ) : (
          <ul className="divide-y divide-line">
            {notifications.data?.items.map((item) => (
              <li key={item.id} className="flex flex-wrap items-start justify-between gap-2 py-3">
                <div className="min-w-0">
                  <p
                    className={cn(
                      'text-sm',
                      item.read_at ? 'font-normal text-ink-500' : 'font-semibold text-ink-900',
                    )}
                  >
                    {TEMPLATE_LABELS[item.template_id] ?? item.template_id.replaceAll('_', ' ')}
                  </p>
                  <p className="text-xs text-ink-500">
                    {item.channel.toUpperCase()} · {timeAgo(item.created_at)}
                    {item.booking_id ? ` · booking ${item.booking_id.slice(0, 8)}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Chip tone={item.status === 'sent' || item.status === 'delivered' ? 'success' : 'neutral'} icon={false}>
                    {item.status}
                  </Chip>
                  {item.booking_id ? (
                    <Link
                      to={`/bookings/${item.booking_id}`}
                      className="text-xs font-semibold text-brand-700 underline underline-offset-2"
                    >
                      Open
                    </Link>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <SectionHeading title="Your data" />
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-ink-900">Export my data</p>
              <p className="text-sm text-ink-500">A machine-readable copy of your account, bookings and cases.</p>
            </div>
            <Button variant="secondary" loading={exportBusy} onClick={() => void requestExport()}>
              <DownloadIcon size={17} />
              Request export
            </Button>
          </div>
          {exportMessage ? <SuccessPanel title="Export queued">{exportMessage}</SuccessPanel> : null}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
            <div>
              <p className="text-sm font-semibold text-ink-900">Delete my account</p>
              <p className="text-sm text-ink-500">
                You need no open bookings. We keep payment, refund, dispute and audit records where the law requires
                it.
              </p>
            </div>
            <Button variant="danger" onClick={() => setDeleteOpen(true)}>
              Delete account
            </Button>
          </div>
        </div>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-surface px-4 py-3">
        <p className="text-sm text-ink-500">
          Signed in since {formatDateTime(user.created_at, true)}.
        </p>
        <Button variant="secondary" onClick={() => void signOut().then(() => navigate('/'))}>
          <LogoutIcon size={17} />
          Sign out
        </Button>
      </div>

      <Sheet
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Delete your account?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleteOpen(false)}>
              Keep my account
            </Button>
            <Button variant="danger" loading={deleteBusy} onClick={() => void requestDeletion()}>
              Delete account
            </Button>
          </>
        }
      >
        <Banner tone="danger" title="This signs you out immediately" icon>
          Your profile stops being usable now. We remove the rest within 30 days, except records we must keep for
          payments, disputes and audits.
        </Banner>
        <p>Open bookings must be finished or cancelled first. If any exist, the request is refused and nothing changes.</p>
        {deleteError ? <ErrorPanel error={deleteError} /> : null}
        <p className="flex gap-2 text-xs text-ink-500">
          <AlertTriangleIcon size={16} className="mt-0.5 shrink-0" />
          Deleting an account does not cancel a booking that is already in transit.
        </p>
      </Sheet>
    </div>
  );
}
