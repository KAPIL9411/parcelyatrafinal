import { useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { QRCodeSVG } from 'qrcode.react';

import {
  BOOKING_STATUS_HINTS,
  DISPUTE_CATEGORY_LABELS,
  TRAVELLER_STATUS_HINTS,
  type BookingStatus,
  type DisputeCategory,
} from '@py/domain';

import { api, ApiError, type Booking, type BookingSummary, type Dispute, type PaymentIntent, getAccessToken } from '../lib/api';
import { errorCopy } from '../lib/copy';
import { countdown, formatDateTime, formatWindow, inr } from '../lib/format';
import { useCountdown, useDevCode, useDocumentTitle, useHandoverCode } from '../lib/hooks';
import { useSession } from '../lib/session';
import { sampleImage, uploadPhoto } from '../lib/upload';
import {
  Banner,
  Button,
  Card,
  Checkbox,
  ErrorPanel,
  Field,
  LoadingBlock,
  MoneyRow,
  SectionHeading,
  Select,
  Sheet,
  Skeleton,
  SuccessPanel,
  TextArea,
  cn,
} from '../components/ui';
import { Chip, PayoutChip, StatusChip, VerificationChip } from '../components/StatusChip';
import { ChatPanel } from '../components/ChatPanel';
import { OtpInput } from '../components/OtpInput';
import { LastUpdated, Timeline } from '../components/Timeline';
import { RouteLine } from '../components/RouteLine';
import { LiveTrackingMap } from '../components/LiveTrackingMap';
import {
  AlertTriangleIcon,
  CameraIcon,
  CarIcon,
  CheckCircleIcon,
  ClockIcon,
  LockIcon,
  ParcelIcon,
  ShieldCheckIcon,
  StarIcon,
} from '../components/icons';

interface BookingList {
  items: BookingSummary[];
  next_cursor: string | null;
}

/** Before pickup, the sender still needs the seal checklist. After it, the card is stale advice. */
const HANDOVER_CHECK_STATUSES = ['payment_pending', 'confirmed', 'pickup_ready'];

/** Payment is collected after delivery. `payment_pending` is the pre-change flow. */
const PAYMENT_DUE_STATUSES = ['payment_pending', 'delivered', 'disputed', 'payout_eligible'];

const REVIEW_TAGS = [
  { value: 'on_time', label: 'On time' },
  { value: 'careful_handling', label: 'Careful handling' },
  { value: 'clear_communication', label: 'Clear communication' },
  { value: 'late', label: 'Late' },
  { value: 'poor_packaging', label: 'Poor packaging' },
  { value: 'unresponsive', label: 'Hard to reach' },
];

export function BookingDetail() {
  const { bookingId = '' } = useParams();
  const location = useLocation();
  const { user } = useSession();
  const queryClient = useQueryClient();

  const bookingQ = useQuery({
    queryKey: ['booking', bookingId],
    queryFn: () => api.get<Booking>(`/bookings/${bookingId}`),
    enabled: Boolean(bookingId),
  });

  const listQ = useQuery({
    queryKey: ['bookings', 'all'],
    queryFn: () => api.get<BookingList>('/bookings?limit=100'),
    staleTime: 15_000,
  });

  const role = useMemo(() => {
    const fromList = listQ.data?.items.find((item) => item.id === bookingId)?.role;
    if (fromList) return fromList;
    const fromState = (location.state as { role?: 'sender' | 'traveller' } | null)?.role;
    return fromState ?? 'sender';
  }, [listQ.data, bookingId, location.state]);

  const booking = bookingQ.data;
  useDocumentTitle(booking ? `Booking ${booking.id.slice(0, 8)}` : 'Booking');

  if (bookingQ.isLoading) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <Skeleton className="h-8 w-52" />
        <Card>
          <LoadingBlock lines={5} />
        </Card>
        <Card>
          <LoadingBlock lines={4} />
        </Card>
      </div>
    );
  }

  if (bookingQ.isError || !booking) {
    return (
      <div className="mx-auto max-w-lg space-y-4 py-6">
        <ErrorPanel error={bookingQ.error} onRetry={() => void bookingQ.refetch()} />
        <Link to="/bookings">
          <Button variant="secondary">Back to my parcels</Button>
        </Link>
      </div>
    );
  }

  const refresh = async () => {
    await Promise.all([bookingQ.refetch(), queryClient.invalidateQueries({ queryKey: ['bookings'] })]);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link to="/bookings" className="text-sm font-semibold text-brand-700 hover:underline">
            ← My parcels
          </Link>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-ink-900">
            {role === 'sender' ? 'Your parcel' : booking.status === 'pending_traveller_acceptance' ? 'A parcel request' : 'A parcel you are carrying'}
          </h1>
          <p className="tabular mt-0.5 text-xs text-ink-500">Booking {booking.id.slice(0, 8)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip status={booking.status} />
          <PayoutChip state={booking.payout_state} />
        </div>
      </div>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <RouteLine
              from={booking.pickup_area ?? 'Pickup area'}
              to={booking.drop_area ?? 'Drop area'}
              meta={
                booking.pickup_window_start && booking.pickup_window_end
                  ? formatWindow(booking.pickup_window_start, booking.pickup_window_end)
                  : 'No pickup time set — agree one in the chat below'
              }
            />
          </div>
          <div className="text-right">
            <p className="text-xs text-ink-500">Total</p>
            <p className="tabular text-xl font-bold text-ink-900">{inr(booking.agreed_total_paise)}</p>
          </div>
        </div>

        <p className="mt-4 rounded-input bg-canvas px-3 py-2 text-sm text-ink-700">
          {(role === 'sender' ? BOOKING_STATUS_HINTS : TRAVELLER_STATUS_HINTS)[booking.status as BookingStatus] ??
            'Status update in progress.'}
        </p>

        {booking.counterparty ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-full bg-brand-100 text-sm font-bold text-brand-700">
                {(booking.counterparty.first_name?.[0] ?? 'P').toUpperCase()}
              </span>
              <div>
                <p className="text-sm font-semibold text-ink-900">
                  {booking.counterparty.first_name ?? 'Counterparty'}
                </p>
                <p className="tabular text-xs text-ink-500">
                  {booking.counterparty.phone_masked ?? 'Number hidden'}
                </p>
              </div>
            </div>
            {role === 'sender' ? (
              <VerificationChip state={booking.counterparty.verification_state} />
            ) : (
              <Chip tone="neutral">Signed in by SMS</Chip>
            )}
          </div>
        ) : null}
      </Card>

      {['picked_up', 'in_transit', 'arrived'].includes(booking.status) ? (
        <LiveTrackingMap parcelId={booking.parcel_id} bookingId={booking.id} token={getAccessToken()} />
      ) : null}

      <ActionPanel booking={booking} role={role} onChanged={refresh} />

      <ChatPanel bookingId={booking.id} />

      <Card>
        <SectionHeading title="Status history" description="Updates come from the people involved, not from a map." />
        <Timeline events={booking.timeline} status={booking.status} viewerRole={role} />
        <LastUpdated value={booking.updated_at} status={booking.status} />
      </Card>

      {role === 'sender' && HANDOVER_CHECK_STATUSES.includes(booking.status) ? (
        <Card>
          <SectionHeading title="What to check at handover" />
          <ul className="space-y-2 text-sm text-ink-700">
            {[
              'The parcel is still sealed, with the same tape you applied.',
              'The weight matches what you declared.',
              'Nothing has been added since you took the photo.',
            ].map((line) => (
              <li key={line} className="flex gap-2">
                <CheckCircleIcon size={17} className="mt-0.5 shrink-0 text-success-600" />
                {line}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-ink-500">
            Give the pickup code to the traveller <strong className="font-semibold text-ink-900">only after</strong>{' '}
            they have the parcel in hand.
          </p>
        </Card>
      ) : null}

      <Card className="border-danger-600/25 bg-danger-50">
        <div className="flex gap-3">
          <AlertTriangleIcon size={20} className="mt-0.5 shrink-0 text-danger-600" />
          <div>
            <p className="text-sm font-semibold text-ink-900">
              {role === 'sender' ? 'Your parcel is not insured.' : 'The parcel is not insured.'}
            </p>
            <p className="mt-1 text-sm text-ink-700">
              We’re working on cover. Until it exists, if something goes wrong we can help you investigate and may
              offer a goodwill amount, but we cannot repay the full value.
            </p>
          </div>
        </div>
      </Card>

      <Card>
        <SectionHeading title="Money" description="The server computed these amounts. Nothing is released while payouts are disabled." />
        <MoneyRow label="Total the sender pays" amountPaise={booking.agreed_total_paise} />
        <MoneyRow label="Traveller’s share" amountPaise={booking.traveller_share_paise} note="Paid after delivery, once the problem window has passed." />
        <div className="mt-3">
          <p className="text-xs text-ink-500">
            Payments run through a sandbox provider in this build. No money leaves an account and no payout is
            released.
          </p>
        </div>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------- action panel

function ActionPanel({
  booking,
  role,
  onChanged,
}: {
  booking: Booking;
  role: 'sender' | 'traveller';
  onChanged: () => Promise<void>;
}) {
  const [error, setError] = useState<unknown>(null);
  const [acting, setActing] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [disputeOpen, setDisputeOpen] = useState(false);

  const acceptRemaining = useCountdown(booking.accept_by);
  const disputeRemaining = useCountdown(booking.dispute_deadline);
  const canCancel = booking.allowed_commands.includes('cancel');

  async function act(command: string, extra: Record<string, unknown> = {}) {
    setActing(command);
    setError(null);
    try {
      await api.post(`/bookings/${booking.id}/transitions`, { command, ...extra });
      await onChanged();
    } catch (err) {
      setError(err);
    } finally {
      setActing(null);
    }
  }

  async function devAdvance() {
    setActing('advance');
    setError(null);
    try {
      await api.post(`/dev/bookings/${booking.id}/advance`, {});
      await onChanged();
    } catch (err) {
      setError(err);
    } finally {
      setActing(null);
    }
  }

  return (
    <div className="space-y-3">
      {booking.status === 'pending_traveller_acceptance' ? (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-ink-900">
                {role === 'sender' ? 'Waiting for the traveller to accept' : 'This sender has asked you to carry a parcel'}
              </p>
              <p className="mt-1 text-sm text-ink-500">
                {acceptRemaining > 0
                  ? `${role === 'sender' ? 'They have' : 'You have'} ${countdown(acceptRemaining)} left to decide.`
                  : 'The 30-minute window has closed.'}
              </p>
            </div>
            {role === 'traveller' ? (
              <div className="flex gap-2">
                <Button variant="secondary" loading={acting === 'decline'} onClick={() => void act('decline')}>
                  Decline
                </Button>
                <Button loading={acting === 'accept'} onClick={() => void act('accept')}>
                  Accept and carry
                </Button>
              </div>
            ) : (
              <Chip tone="warn">30-minute window</Chip>
            )}
          </div>
        </Card>
      ) : null}

      {role === 'sender' && PAYMENT_DUE_STATUSES.includes(booking.status) && booking.payment?.state !== 'captured' ? (
        <PaymentPanel booking={booking} onPaid={onChanged} />
      ) : null}

      {role === 'traveller' && PAYMENT_DUE_STATUSES.includes(booking.status) && booking.payment?.state !== 'captured' ? (
        <Banner
          tone="info"
          title={booking.status === 'payment_pending' ? 'Waiting for the sender to pay' : 'Delivered. Waiting for the sender to pay'}
        >
          {booking.status === 'payment_pending'
            ? 'The booking is confirmed as soon as the test payment completes. You do not need to do anything.'
            : 'The delivery code was accepted. The sender pays from their app; your share is released after the problem window closes.'}
        </Banner>
      ) : null}

      {booking.status === 'confirmed' ? (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-ink-900">Both sides are committed</p>
              <p className="mt-1 text-sm text-ink-500">
                Pickup opens when the window starts. We’ll text the sender a six-digit code.
              </p>
            </div>
            {import.meta.env.DEV ? (
              <Button variant="tertiary" size="sm" loading={acting === 'advance'} onClick={() => void devAdvance()}>
                Open pickup now
              </Button>
            ) : null}
          </div>
        </Card>
      ) : null}

      {booking.status === 'pickup_ready' ? (
        role === 'sender' ? (
          <SenderCodePanel booking={booking} phase="pickup" onChanged={onChanged} />
        ) : (
          <HandoverPanel booking={booking} phase="pickup" onDone={onChanged} />
        )
      ) : null}

      {booking.status === 'picked_up' && role === 'traveller' ? (
        <Card>
          <p className="text-sm font-semibold text-ink-900">You have the parcel</p>
          <p className="mt-1 text-sm text-ink-500">Start the journey when you set off. The sender sees this update.</p>
          <Button className="mt-3" loading={acting === 'start_transit'} onClick={() => void act('start_transit')}>
            I’m on the way
          </Button>
        </Card>
      ) : null}

      {booking.status === 'in_transit' && role === 'traveller' ? (
        <Card>
          <p className="text-sm font-semibold text-ink-900">On the way</p>
          <p className="mt-1 text-sm text-ink-500">
            Mark arrival when you reach the destination city. The receiver gets a delivery code then.
          </p>
          <Button className="mt-3" loading={acting === 'arrive'} onClick={() => void act('arrive')}>
            I’ve arrived
          </Button>
        </Card>
      ) : null}

      {booking.status === 'arrived' && role === 'traveller' ? (
        <HandoverPanel booking={booking} phase="delivery" onDone={onChanged} />
      ) : null}

      {booking.status === 'arrived' && role === 'sender' ? (
        <SenderCodePanel booking={booking} phase="delivery" onChanged={onChanged} />
      ) : null}

      {booking.status === 'delivery_attempt_failed' && role === 'traveller' ? (
        <Card>
          <p className="text-sm font-semibold text-ink-900">The receiver was not available</p>
          <p className="mt-1 text-sm text-ink-500">
            Keep the parcel sealed and contact support. Do not leave it with a neighbour or at a door without the
            code.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {booking.allowed_commands.includes('report_incident') ? (
              <Button
                variant="secondary"
                loading={acting === 'report_incident'}
                onClick={() => void act('report_incident')}
              >
                Open a case
              </Button>
            ) : null}
            <Link to="/help">
              <Button variant="tertiary">Contact support</Button>
            </Link>
          </div>
        </Card>
      ) : null}

      {['delivered', 'payout_eligible', 'paid_out'].includes(booking.status) ? (
        <DeliveredPanel booking={booking} role={role} onChanged={onChanged} />
      ) : null}

      {booking.dispute ? (
        <CasePanel booking={booking} onChanged={onChanged} />
      ) : null}

      {['locked_for_review', 'incident_open'].includes(booking.status) ? (
        <Banner tone="danger" title="This booking is paused">
          Our team is checking it. We’ll call you. Do not hand over the parcel or any code until this clears.
        </Banner>
      ) : null}

      {error ? <ErrorPanel error={error} /> : null}

      {canCancel && !['delivered', 'payout_eligible', 'paid_out', 'disputed'].includes(booking.status) ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-surface px-4 py-3">
          <p className="text-sm text-ink-500">
            {role === 'sender'
              ? booking.status === 'pending_traveller_acceptance'
                ? 'You can cancel free until the traveller accepts.'
                : 'If you cancel now, the traveller keeps their share and the rest is returned.'
              : 'Cancelling after accepting affects your ranking.'}
          </p>
          <Button variant="danger" size="sm" onClick={() => setCancelOpen(true)}>
            Cancel booking
          </Button>
        </div>
      ) : null}

      {['delivered', 'payout_eligible', 'paid_out'].includes(booking.status) && role === 'sender' ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-surface px-4 py-3">
          <p className="text-sm text-ink-500">
            {booking.status === 'delivered' && disputeRemaining > 0 && booking.dispute_deadline
              ? `Problems can be raised until ${formatDateTime(booking.dispute_deadline, true)} — about ${Math.ceil(disputeRemaining / 3600)} hours left.`
              : 'The problem window has closed.'}
          </p>
          {booking.status === 'delivered' ? (
            <Button variant="danger" size="sm" disabled={disputeRemaining <= 0} onClick={() => setDisputeOpen(true)}>
              Raise a problem
            </Button>
          ) : null}
        </div>
      ) : null}

      <CancelSheet
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        booking={booking}
        role={role}
        onConfirm={async (reason) => {
          setCancelOpen(false);
          await act('cancel', { reason_code: reason });
        }}
      />

      <DisputeSheet
        open={disputeOpen}
        onClose={() => setDisputeOpen(false)}
        booking={booking}
        onDone={async () => {
          setDisputeOpen(false);
          await onChanged();
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------- payment

function PaymentPanel({ booking, onPaid }: { booking: Booking; onPaid: () => Promise<void> }) {
  const [state, setState] = useState<'idle' | 'creating' | 'confirming' | 'checking' | 'done' | 'awaiting'>('idle');
  const [error, setError] = useState<unknown>(null);
  const [intent, setIntent] = useState<PaymentIntent | null>(null);
  const [checked, setChecked] = useState(false);

  // A reload must not lose the payment the sender already started. The booking payload carries the
  // same link, so the panel renders from the server's copy when there is no in-memory intent.
  const stored = booking.payment;
  const payment: PaymentIntent | null =
    intent ??
    (stored?.payment_link
      ? {
          id: stored.reference ?? '',
          state: stored.state,
          amount_paise: stored.amount_paise,
          currency: 'INR',
          provider: 'upi_direct',
          sandbox: stored.sandbox,
          client_secret: null,
          provider_ref: stored.reference ?? '',
          payment_link: stored.payment_link,
          payee: stored.payee ?? null,
          created_at: '',
        }
      : null);

  /** A UPI collection with no receipt yet: the sender has to pay, we cannot do it for them. */
  const awaitingUpi = payment?.payment_link != null && payment.state === 'created';

  async function pay() {
    setState('creating');
    setError(null);
    try {
      const created = await api.post<PaymentIntent>(`/bookings/${booking.id}/payment-intent`, {});
      setIntent(created);

      if (created.payment_link) {
        setState('idle');
        return;
      }

      setState('confirming');

      if (!import.meta.env.DEV) {
        // A capture can only come from the provider's signed webhook, and no provider checkout is
        // wired into this build. The intent stays open and the booking stays unpaid — which is the
        // truth, not a failure to paper over.
        setState('awaiting');
        return;
      }

      // There is no provider UI in this build. The sandbox adapter is driven by the same signed
      // webhook a real provider would call, through the development simulator.
      await api.post('/dev/webhooks/simulate', {
        type: 'payment.captured',
        provider_ref: created.provider_ref,
      });

      await onPaid();
      setState('done');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'PAYMENT_ALREADY_EXISTS') {
        // An earlier attempt exists. Refresh; if it was captured the panel disappears on its own.
        await onPaid();
        setState('idle');
        return;
      }
      setError(err);
      setState('idle');
    }
  }

  async function refresh() {
    setState('checking');
    setChecked(true);
    await onPaid();
    setState('idle');
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-ink-900">
            {booking.status === 'payment_pending' ? 'Confirm and pay' : 'Pay for this delivery'}
          </h2>
          <p className="mt-1 text-sm text-ink-500">
            {booking.status === 'payment_pending'
              ? `The traveller accepted. Your price is fixed at ${inr(booking.agreed_total_paise)}.`
              : `The parcel was delivered and the delivery code was accepted. Your price is fixed at ${inr(
                  booking.agreed_total_paise,
                )}. The traveller is paid after the problem window closes.`}
          </p>
        </div>
      </div>

      {import.meta.env.DEV && !payment?.payment_link ? (
        <Banner tone="info" className="mt-4" title="Sandbox payments">
          This build uses a test payment provider. The booking moves forward exactly as it would after a real
          capture, and nothing leaves a bank account.
        </Banner>
      ) : null}

      {state === 'confirming' ? (
        <p className="mt-4 flex items-center gap-2 text-sm font-semibold text-ink-900">
          <ClockIcon size={18} className="text-brand-700" /> Confirming with the payment provider…
        </p>
      ) : null}

      {awaitingUpi && payment ? (
        <div className="mt-4 rounded-card border border-line bg-canvas p-4">
          <div className="grid gap-5 sm:grid-cols-[168px,1fr] sm:items-start">
            <div className="mx-auto rounded-lg bg-white p-2.5 shadow-sm">
              <QRCodeSVG value={payment.payment_link!} size={148} level="M" />
            </div>
            <div>
              <p className="text-sm font-semibold text-ink-900">Pay {inr(payment.amount_paise)} by UPI</p>
              <p className="mt-1 text-sm text-ink-600">Scan the code with any UPI app, or send to</p>
              <p className="mt-2 font-mono text-base font-semibold text-ink-900">{payment.payee?.vpa}</p>
              <p className="text-xs text-ink-500">{payment.payee?.name}</p>
              <p className="mt-2 text-sm text-ink-600">
                Reference <span className="font-mono font-semibold text-ink-900">{payment.provider_ref}</span>
              </p>
              <p className="mt-1 text-xs text-ink-500">
                The button below opens your UPI app with the handle, amount and reference filled in.
              </p>
              <a
                href={payment.payment_link!}
                className="mt-3 inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-sm font-semibold text-ink-900 hover:bg-canvas"
              >
                Open UPI app
              </a>
            </div>
          </div>
          <p className="mt-4 text-xs text-ink-500">
            The payment is recorded after our finance team matches this reference to the bank statement, usually
            within a few hours. This page never marks itself paid.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button variant="secondary" size="sm" loading={state === 'checking'} onClick={() => void refresh()}>
              Refresh status
            </Button>
            {checked ? (
              <span className="text-xs text-ink-500">Not confirmed yet. If you have paid, give it a little time.</span>
            ) : null}
          </div>
        </div>
      ) : null}

      {state === 'awaiting' ? (
        <Banner tone="warn" className="mt-4" title="Payment started, not taken">
          <span className="block">
            A payment of {inr(intent?.amount_paise ?? booking.agreed_total_paise)} was created but no money has moved,
            because this build has no checkout connected to a real payment provider. The booking stays unpaid until a
            capture webhook arrives from the provider.
          </span>
          <span className="mt-1 block tabular text-xs text-ink-500">Payment reference {intent?.id?.slice(0, 8) ?? '—'}</span>
        </Banner>
      ) : null}

      {state === 'done' ? <SuccessPanel title="Payment confirmed">The capture is recorded on the booking.</SuccessPanel> : null}

      {error ? <ErrorPanel error={error} /> : null}

      {awaitingUpi ? null : (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button
            size="lg"
            loading={state === 'creating' || state === 'confirming' || state === 'checking'}
            disabled={state === 'done'}
            onClick={() => void pay()}
          >
            {state === 'awaiting' ? 'Try again' : `Pay ${inr(booking.agreed_total_paise)}`}
          </Button>
          <span className="text-xs text-ink-500">
            Amount set by the server from the stored quote. A client-supplied amount is ignored.
          </span>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------- handover code

function SenderCodePanel({
  booking,
  phase,
  onChanged,
}: {
  booking: Booking;
  phase: 'pickup' | 'delivery';
  onChanged: () => Promise<void>;
}) {
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const handover = useHandoverCode(booking.id, phase);
  const code = handover.data?.code ?? null;

  async function regenerate() {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/bookings/${booking.id}/otp/regenerate`, { phase });
      await handover.refetch();
      await onChanged();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const pickup = phase === 'pickup';

  return (
    <Card>
      <h2 className="text-lg font-semibold text-ink-900">{pickup ? 'Pickup code' : 'Delivery code'}</h2>
      <p className="mt-1 text-sm text-ink-500">
        {pickup ? (
          <>
            Give this to the traveller <strong className="font-semibold text-ink-900">only after</strong> they have the
            parcel in hand. Do not send it in a message.
          </>
        ) : (
          <>
            Share this with the receiver, not the traveller. It proves the parcel reached the right person.
          </>
        )}
      </p>

      {code ? (
        <div className="mt-4 rounded-card border border-dashed border-line-strong bg-canvas px-4 py-6 text-center">
          <p className="tabular text-3xl font-bold tracking-[0.3em] text-ink-900">{code}</p>
          <p className="mt-2 text-xs font-medium text-ink-500">
            {handover.data?.expires_at
              ? `Valid until ${new Date(handover.data.expires_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`
              : 'Six digits. Read it out; do not forward it.'}
          </p>
        </div>
      ) : (
        <div className="mt-4 flex items-center gap-3 rounded-card border border-line bg-canvas px-4 py-4">
          <LockIcon size={20} className="text-ink-500" />
          <p className="text-sm text-ink-700">
            {handover.isError
              ? 'A code is issued when this step opens. If you expected one, send a new code.'
              : 'Loading your code…'}
          </p>
        </div>
      )}

      {error ? <ErrorPanel error={error} /> : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" loading={busy} onClick={() => void regenerate()}>
          Send a new code
        </Button>
        <Link to="/help">
          <Button variant="tertiary" size="sm">
            {pickup ? 'Traveller is late' : 'Receiver cannot be reached'}
          </Button>
        </Link>
      </div>
    </Card>
  );
}

function HandoverPanel({
  booking,
  phase,
  onDone,
}: {
  booking: Booking;
  phase: 'pickup' | 'delivery';
  onDone: () => Promise<void>;
}) {
  const [code, setCode] = useState('');
  const [photoKey, setPhotoKey] = useState('');
  const [uploading, setUploading] = useState(false);
  const [sealIntact, setSealIntact] = useState(false);
  const [weightMatches, setWeightMatches] = useState(false);
  const [receiverConfirmed, setReceiverConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [wrong, setWrong] = useState(false);

  const testCode = useDevCode(`/dev/handover-otp/${booking.id}/${phase}`, {
    enabled: import.meta.env.DEV,
    auth: true,
  });

  const checklistOk = phase === 'pickup' ? sealIntact && weightMatches : receiverConfirmed;

  async function attach(file: File | null) {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const key = await uploadPhoto(file, phase === 'pickup' ? 'parcel_sealed' : 'parcel_delivery');
      setPhotoKey(key);
    } catch (err) {
      setError(err);
    } finally {
      setUploading(false);
    }
  }

  async function submit() {
    setBusy(true);
    setError(null);
    setWrong(false);
    try {
      await api.post(`/bookings/${booking.id}/handover/${phase}`, {
        otp: code,
        photo_key: photoKey,
        ...(phase === 'pickup'
          ? { checklist: { seal_intact: sealIntact, weight_matches_declaration: weightMatches } }
          : { receiver_name_confirmed: receiverConfirmed }),
      });
      await onDone();
    } catch (err) {
      setWrong(true);
      setError(err);
      setCode('');
      window.setTimeout(() => setWrong(false), 700);
    } finally {
      setBusy(false);
    }
  }

  const copy = error ? errorCopy(error) : null;

  return (
    <Card>
      <h2 className="text-lg font-semibold text-ink-900">
        {phase === 'pickup' ? 'Confirm pickup' : 'Confirm delivery'}
      </h2>
      <p className="mt-1 text-sm text-ink-500">
        {phase === 'pickup'
          ? 'Check the seal, weigh the parcel, then ask the sender for the six-digit code.'
          : 'Hand the parcel to the receiver, then ask them for the six-digit delivery code.'}
      </p>

      <div className="mt-5">
        <p className="mb-2 text-sm font-semibold text-ink-900">
          {phase === 'pickup' ? 'Pickup code from the sender' : 'Delivery code from the receiver'}
        </p>
        <OtpInput value={code} onChange={setCode} error={wrong} disabled={busy} autoFocus />
        {copy ? (
          <p className="mt-2 text-sm text-danger-600" role="alert">
            {copy.title}. {copy.body}
          </p>
        ) : null}
        {testCode ? (
          <button
            type="button"
            className="mt-2 text-xs font-semibold text-warn-600 underline underline-offset-2"
            onClick={() => setCode(testCode)}
          >
            Use code {testCode}
          </button>
        ) : null}
      </div>

      <div className="mt-5 space-y-3">
        {phase === 'pickup' ? (
          <>
            <Checkbox
              checked={sealIntact}
              onChange={(event) => setSealIntact(event.target.checked)}
              label="The seal is intact"
              description="If it is not, refuse the handover. There is no penalty for refusing."
            />
            <Checkbox
              checked={weightMatches}
              onChange={(event) => setWeightMatches(event.target.checked)}
              label="The weight matches the declaration"
            />
          </>
        ) : (
          <Checkbox
            checked={receiverConfirmed}
            onChange={(event) => setReceiverConfirmed(event.target.checked)}
            label="I handed it to the named receiver"
          />
        )}

        <div>
          <p className="mb-2 text-sm font-semibold text-ink-900">
            {phase === 'pickup' ? 'Photo of the sealed parcel' : 'Photo of the handover'}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-input border border-line-strong bg-surface px-4 text-sm font-medium text-ink-900 hover:bg-canvas">
              <CameraIcon size={18} />
              {photoKey ? 'Replace photo' : 'Take a photo'}
              <input
                type="file"
                accept="image/jpeg,image/png"
                capture="environment"
                className="sr-only"
                onChange={(event) => void attach(event.target.files?.[0] ?? null)}
              />
            </label>
            {import.meta.env.DEV ? (
              <Button variant="tertiary" size="sm" loading={uploading} onClick={() => void attach(sampleImage(`${phase}.png`))}>
                Use sample image
              </Button>
            ) : null}
            {photoKey ? (
              <span className="inline-flex items-center gap-1 text-sm font-semibold text-success-600">
                <CheckCircleIcon size={16} /> Attached
              </span>
            ) : null}
          </div>
        </div>
      </div>

      <Button
        className="mt-5"
        size="lg"
        fullWidth
        loading={busy}
        disabled={code.length !== 6 || !photoKey || !checklistOk}
        onClick={() => void submit()}
      >
        {phase === 'pickup' ? 'Confirm pickup' : 'Confirm delivery'}
      </Button>

      {phase === 'pickup' ? (
        <p className="mt-3 text-xs text-ink-500">
          Refusing is allowed. Choose “seal not intact” or “weight does not match” at the door — there is no penalty.
        </p>
      ) : null}
    </Card>
  );
}

// ---------------------------------------------------------------------------- delivered

function DeliveredPanel({
  booking,
  role,
  onChanged,
}: {
  booking: Booking;
  role: 'sender' | 'traveller';
  onChanged: () => Promise<void>;
}) {
  const [stars, setStars] = useState(0);
  const [tags, setTags] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/bookings/${booking.id}/review`, { stars, tags });
      setDone(true);
      await onChanged();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-ink-900">
            {booking.status === 'delivered' ? 'Delivered' : booking.status === 'payout_eligible' ? 'Window closed' : 'Paid out'}
          </h2>
          <p className="mt-1 text-sm text-ink-500">
            {booking.status === 'delivered'
              ? role === 'sender'
                ? booking.payment?.state === 'captured'
                  ? 'Payment captured. The problem window is open; after it closes, the traveller is paid.'
                  : 'Delivered. Pay the traveller’s share above. The problem window is open.'
                : booking.payment?.state === 'captured'
                  ? 'The sender has paid. Your payout follows after the 72-hour problem window.'
                  : 'The sender pays from their app. Your payout follows after the 72-hour problem window.'
              : booking.status === 'payout_eligible'
                ? role === 'sender'
                  ? 'No problem was raised in time. The traveller’s share is now due.'
                  : 'No problem was raised in time. Your share is now due.'
                : role === 'sender'
                  ? 'The traveller has been paid.'
                  : 'Your share has been paid.'}
          </p>
        </div>
        <PayoutChip state={booking.payout_state} />
      </div>

      <div className="mt-4 border-t border-line pt-4">
        <p className="text-sm font-semibold text-ink-900">Rate this {role === 'sender' ? 'traveller' : 'sender'}</p>
        <p className="mt-0.5 text-xs text-ink-500">
          Your rating is separate from any incident report. A good rating never hides a case.
        </p>

        {done ? (
          <SuccessPanel title="Thanks — your rating is recorded." />
        ) : (
          <>
            <div className="mt-3 flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setStars(value)}
                  aria-label={`${value} star${value === 1 ? '' : 's'}`}
                  aria-pressed={stars === value}
                  className={cn(
                    'grid h-11 w-11 place-items-center rounded-input',
                    value <= stars ? 'text-accent-600' : 'text-ink-300 hover:text-ink-500',
                  )}
                >
                  <StarIcon size={26} filled={value <= stars} />
                </button>
              ))}
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {REVIEW_TAGS.map((tag) => {
                const active = tags.includes(tag.value);
                return (
                  <button
                    key={tag.value}
                    type="button"
                    aria-pressed={active}
                    onClick={() =>
                      setTags((prev) => (active ? prev.filter((t) => t !== tag.value) : [...prev, tag.value]))
                    }
                    className={cn(
                      'rounded-full border px-3 py-1.5 text-xs font-semibold',
                      active ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-line-strong text-ink-700',
                    )}
                  >
                    {tag.label}
                  </button>
                );
              })}
            </div>

            {error ? <ErrorPanel error={error} /> : null}

            <Button className="mt-4" loading={busy} disabled={stars === 0} onClick={() => void submit()}>
              Submit rating
            </Button>
          </>
        )}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------- case

const CASE_STATE_LABELS: Record<string, string> = {
  open: 'Open — a person will review it',
  evidence_requested: 'Evidence requested',
  under_review: 'Under review',
};

/**
 * The open case, on the booking itself.
 *
 * The API has had `GET /disputes/:id` and `POST /disputes/:id/evidence` from the start, but there
 * was no route to reach them, so the page could only tell people a "case page" existed. This card
 * is that page: reference, state, what has been sent, and one place to add more.
 */
function CasePanel({ booking, onChanged }: { booking: Booking; onChanged: () => Promise<void> }) {
  const disputeId = booking.dispute?.id ?? '';
  const caseQ = useQuery({
    queryKey: ['dispute', disputeId],
    queryFn: () => api.get<Dispute>(`/disputes/${disputeId}`),
    enabled: Boolean(disputeId),
  });

  const [note, setNote] = useState('');
  const [photoKey, setPhotoKey] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [sent, setSent] = useState(false);

  const dispute = caseQ.data;
  const state = dispute?.state ?? booking.dispute?.state ?? 'open';
  const closed = ['resolved', 'closed'].includes(state);

  async function attach(file: File | null) {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      setPhotoKey(await uploadPhoto(file, 'dispute_evidence'));
    } catch (err) {
      setError(err);
    } finally {
      setUploading(false);
    }
  }

  async function submit() {
    if (!note.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/disputes/${disputeId}/evidence`, {
        note: note.trim(),
        ...(photoKey ? { object_key: photoKey } : {}),
      });
      setNote('');
      setPhotoKey(null);
      setSent(true);
      await caseQ.refetch();
      await onChanged();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="border-danger-600/25">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-ink-900">Case open</h2>
          <p className="tabular mt-0.5 text-xs text-ink-500">Case {disputeId.slice(0, 8)}</p>
        </div>
        <Chip tone={closed ? 'success' : 'warn'}>{CASE_STATE_LABELS[state] ?? state.replaceAll('_', ' ')}</Chip>
      </div>

      <p className="mt-3 text-sm text-ink-700">
        Payout is frozen until this is resolved. Support will contact both sides. Add anything that helps below —
        photos, a description of the damage, or what the receiver saw.
      </p>

      <dl className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <dt className="text-xs text-ink-500">Category</dt>
          <dd className="text-sm font-semibold text-ink-900">
            {DISPUTE_CATEGORY_LABELS[(dispute?.category ?? booking.dispute?.category ?? '') as DisputeCategory] ??
              'Case'}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-ink-500">Opened</dt>
          <dd className="text-sm font-semibold text-ink-900">
            {formatDateTime(dispute?.created_at ?? booking.dispute?.created_at ?? booking.updated_at, true)}
          </dd>
        </div>
      </dl>

      <div className="mt-5 border-t border-line pt-4">
        <p className="text-sm font-semibold text-ink-900">What has been added</p>
        {caseQ.isPending ? (
          <Skeleton className="mt-2 h-10 w-full" />
        ) : (dispute?.evidence.length ?? 0) === 0 ? (
          <p className="mt-1 text-sm text-ink-500">Nothing yet. The description you wrote when opening the case is already on file.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {dispute?.evidence.map((item) => (
              <li key={item.id} className="rounded-input border border-line bg-canvas px-3 py-2">
                <p className="text-sm text-ink-700">{item.note}</p>
                <p className="mt-1 text-xs text-ink-500">
                  {formatDateTime(item.created_at, true)}
                  {item.object_key ? ' · photo attached' : ''}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>

      {closed ? (
        <p className="mt-4 text-sm text-ink-500">This case is closed. Evidence can no longer be added.</p>
      ) : (
        <div className="mt-5 border-t border-line pt-4">
          <Field
            label="Add to the case"
            htmlFor="case-note"
            hint="Facts only. Say what you saw, when, and what condition the parcel was in."
          >
            <TextArea
              id="case-note"
              rows={3}
              maxLength={1000}
              value={note}
              onChange={(event) => {
                setNote(event.target.value);
                setSent(false);
              }}
              placeholder="e.g. The envelope was torn along the top edge and the second page was creased."
            />
          </Field>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-input border border-line-strong bg-surface px-4 text-sm font-medium text-ink-900 hover:bg-canvas">
              <CameraIcon size={18} />
              {photoKey ? 'Replace photo' : 'Attach a photo'}
              <input
                type="file"
                accept="image/jpeg,image/png"
                className="sr-only"
                onChange={(event) => void attach(event.target.files?.[0] ?? null)}
              />
            </label>
            {import.meta.env.DEV ? (
              <Button variant="tertiary" size="sm" loading={uploading} onClick={() => void attach(sampleImage('case.png'))}>
                Use sample image
              </Button>
            ) : null}
            {photoKey ? (
              <span className="inline-flex items-center gap-1 text-sm font-semibold text-success-600">
                <CheckCircleIcon size={16} /> Attached
              </span>
            ) : null}
          </div>

          {error ? <ErrorPanel error={error} /> : null}
          {sent ? <p className="mt-3 text-sm font-semibold text-success-600">Added. Support sees it on the case.</p> : null}

          <Button className="mt-4" loading={busy} disabled={!note.trim()} onClick={() => void submit()}>
            Add to the case
          </Button>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------- sheets

const CANCEL_REASONS = [
  { value: 'plans_changed', label: 'My plans changed' },
  { value: 'found_another_option', label: 'I found another option' },
  { value: 'traveller_late', label: 'The traveller is late' },
  { value: 'price', label: 'The price' },
  { value: 'other', label: 'Something else' },
];

function CancelSheet({
  open,
  onClose,
  booking,
  role,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  booking: Booking;
  role: 'sender' | 'traveller';
  onConfirm: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const free = ['pending_traveller_acceptance', 'draft'].includes(booking.status);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Cancel this booking?"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Keep booking
          </Button>
          <Button
            variant="danger"
            loading={busy}
            disabled={!reason}
            onClick={() => {
              setBusy(true);
              void onConfirm(reason).finally(() => setBusy(false));
            }}
          >
            Cancel booking
          </Button>
        </>
      }
    >
      <p className="font-semibold text-ink-900">
        {free
          ? 'Nothing has been charged, so this cancellation is free.'
          : role === 'sender'
            ? 'The traveller keeps their share. The rest is returned to you.'
            : 'Cancelling after accepting affects your ranking.'}
      </p>
      <p>
        {free
          ? 'The traveller has not accepted yet. No money moves.'
          : `The traveller’s share is ${inr(booking.traveller_share_paise)}. We do not control how long your bank takes to post a refund.`}
      </p>

      <Field label="Why are you cancelling?" htmlFor="cancel-reason">
        <Select id="cancel-reason" value={reason} onChange={(event) => setReason(event.target.value)}>
          <option value="">Choose a reason</option>
          {CANCEL_REASONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </Field>
    </Sheet>
  );
}

function DisputeSheet({
  open,
  onClose,
  booking,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  booking: Booking;
  onDone: () => Promise<void>;
}) {
  const [category, setCategory] = useState<DisputeCategory>('damaged');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api.post('/disputes', {
        booking_id: booking.id,
        category,
        description: description.trim(),
      });
      await onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Raise a problem"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Not now
          </Button>
          <Button
            variant="danger"
            loading={busy}
            disabled={description.trim().length < 10}
            onClick={() => void submit()}
          >
            Open a case
          </Button>
        </>
      }
    >
      <Banner tone="danger" title="Raising this pauses the traveller’s payment" icon>
        It stays frozen until we’ve reviewed the case. Only one case can be open per booking.
      </Banner>

      <Field label="What went wrong?" htmlFor="dispute-category">
        <Select
          id="dispute-category"
          value={category}
          onChange={(event) => setCategory(event.target.value as DisputeCategory)}
        >
          {(Object.keys(DISPUTE_CATEGORY_LABELS) as DisputeCategory[]).map((value) => (
            <option key={value} value={value}>
              {DISPUTE_CATEGORY_LABELS[value]}
            </option>
          ))}
        </Select>
      </Field>

      <Field
        label="What happened?"
        htmlFor="dispute-description"
        hint={`${description.trim().length}/2000 · at least 10 characters`}
      >
        <TextArea
          id="dispute-description"
          value={description}
          maxLength={2000}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Tell us what you found and when."
        />
      </Field>

      {error ? <ErrorPanel error={error} /> : null}

      <p className="text-xs text-ink-500">
        Case reference and next steps appear on this page once the case is open. A person reviews it.
      </p>
    </Sheet>
  );
}

// Keep an icon reference so the parcel mark is available for empty states without an extra import cycle.
export const BookingIcons = { ParcelIcon, CarIcon, ShieldCheckIcon, AlertTriangleIcon };
