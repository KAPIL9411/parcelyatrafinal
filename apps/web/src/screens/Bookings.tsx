import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import { MODE_LABELS } from '@py/domain';

import { api, type BookingSummary } from '../lib/api';
import { formatDateTime, inr, timeAgo } from '../lib/format';
import { useDocumentTitle } from '../lib/hooks';
import { useSession } from '../lib/session';
import { Button, Card, EmptyState, ErrorPanel, LoadingBlock, SectionHeading, Skeleton, cn } from '../components/ui';
import { StatusChip } from '../components/StatusChip';
import { ArrowRightIcon, CarIcon, ParcelIcon } from '../components/icons';

interface BookingList {
  items: BookingSummary[];
  next_cursor: string | null;
}

type Filter = 'all' | 'sender' | 'traveller';

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'sender', label: 'Sending' },
  { value: 'traveller', label: 'Carrying' },
];

/** Bookings that still need somebody to do something. Everything else is history. */
const OPEN_STATUSES = new Set([
  'draft',
  'pending_traveller_acceptance',
  'payment_pending',
  'confirmed',
  'pickup_ready',
  'picked_up',
  'in_transit',
  'arrived',
  'delivery_attempt_failed',
  'disputed',
  'incident_open',
  'locked_for_review',
]);

export function Bookings() {
  useDocumentTitle('My parcels');
  const { user } = useSession();
  const [filter, setFilter] = useState<Filter>('all');

  const query = useQuery({
    queryKey: ['bookings', filter],
    queryFn: () =>
      api.get<BookingList>(`/bookings?limit=100${filter === 'all' ? '' : `&role=${filter}`}`),
    enabled: Boolean(user),
    refetchInterval: 30_000,
  });

  const items = query.data?.items ?? [];
  const open = items.filter((item) => OPEN_STATUSES.has(item.status));
  const past = items.filter((item) => !OPEN_STATUSES.has(item.status));

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-wide text-brand-700 uppercase">Your account</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-ink-900 sm:text-3xl">My parcels</h1>
          <p className="mt-1 text-sm text-ink-500">
            Everything you are sending and everything you are carrying, in one list.
          </p>
        </div>
        <Link to="/send">
          <Button>
            Send a parcel
            <ArrowRightIcon size={17} />
          </Button>
        </Link>
      </div>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filter bookings">
        {FILTERS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={filter === option.value}
            onClick={() => setFilter(option.value)}
            className={cn(
              'rounded-full border px-3.5 py-1.5 text-sm font-semibold',
              filter === option.value
                ? 'border-brand-600 bg-brand-50 text-brand-700'
                : 'border-line-strong bg-surface text-ink-700 hover:border-ink-300',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      {query.isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Card key={i}>
              <LoadingBlock lines={3} />
            </Card>
          ))}
        </div>
      ) : query.isError ? (
        <ErrorPanel error={query.error} onRetry={() => void query.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          title={filter === 'traveller' ? 'You have not carried anything yet' : 'No parcels yet'}
          body={
            filter === 'traveller'
              ? 'Publish a trip and we will show you parcels that fit your route and timing.'
              : 'Describe a parcel, see the price, and choose a verified traveller already making the journey.'
          }
          icon={filter === 'traveller' ? <CarIcon size={22} /> : <ParcelIcon size={22} />}
          action={
            filter === 'traveller' ? (
              <Link to="/trips/new">
                <Button>Publish a trip</Button>
              </Link>
            ) : (
              <Link to="/send">
                <Button>Send a parcel</Button>
              </Link>
            )
          }
        />
      ) : (
        <>
          {open.length > 0 ? (
            <section aria-labelledby="open-bookings">
              <SectionHeading title="In progress" description="These need someone to act next." />
              <div className="space-y-3">
                {open.map((item) => (
                  <BookingRow key={item.id} booking={item} />
                ))}
              </div>
            </section>
          ) : null}

          {past.length > 0 ? (
            <section aria-labelledby="past-bookings">
              <SectionHeading title="Finished" />
              <div className="space-y-3">
                {past.map((item) => (
                  <BookingRow key={item.id} booking={item} />
                ))}
              </div>
            </section>
          ) : null}

          {open.length === 0 && past.length === 0 ? (
            <Skeleton className="h-24 w-full" />
          ) : null}
        </>
      )}

      <p className="pt-2 text-xs text-ink-500">
        We keep booking records for the period described in the privacy notice. A booking can be opened by both
        people on it; nobody else can see it.
      </p>
    </div>
  );
}

function BookingRow({ booking }: { booking: BookingSummary }) {
  return (
    <Link
      to={`/bookings/${booking.id}`}
      state={{ role: booking.role }}
      className="block rounded-card border border-line bg-surface p-4 shadow-card transition-colors hover:border-line-strong sm:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatusChip status={booking.status} />
            <span className="rounded-full border border-line bg-canvas px-2 py-0.5 text-xs font-semibold text-ink-700">
              {booking.role === 'sender' ? 'Sending' : 'Carrying'}
            </span>
          </div>
          <p className="mt-2 text-sm font-semibold text-ink-900">
            {MODE_LABELS[booking.mode as keyof typeof MODE_LABELS] ?? booking.mode} ·{' '}
            {booking.role === 'sender' ? 'you are sending' : 'you are carrying'}
          </p>
          <p className="tabular mt-0.5 text-xs text-ink-500">
            Booking {booking.id.slice(0, 8)} · updated {timeAgo(booking.updated_at)}
          </p>
        </div>

        <div className="text-right">
          <p className="tabular text-lg font-bold text-ink-900">{inr(booking.agreed_total_paise)}</p>
          <p className="text-xs text-ink-500">{formatDateTime(booking.created_at)}</p>
        </div>
      </div>
    </Link>
  );
}
