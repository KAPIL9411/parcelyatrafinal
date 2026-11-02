import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { CATEGORY_LABELS, MODE_LABELS, TRIP_STATUSES, type Category } from '@py/domain';

import { api, ApiError, type Opportunity, type OpportunityList, type Trip, type Verification } from '../lib/api';
import { formatDateTime, formatWindow, fromLocalInput, inr, kg, toLocalInput } from '../lib/format';
import { useAreas, useCities, useDocumentTitle } from '../lib/hooks';
import { useSession } from '../lib/session';
import {
  Banner,
  Button,
  Card,
  EmptyState,
  ErrorPanel,
  Field,
  LoadingBlock,
  SectionHeading,
  Select,
  Sheet,
  TextInput,
  cn,
} from '../components/ui';
import { RouteLine } from '../components/RouteLine';
import { Chip, MatchBandChip, VerificationChip } from '../components/StatusChip';
import {
  CarIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  ClockIcon,
  ParcelIcon,
  PlusIcon,
  ShieldCheckIcon,
} from '../components/icons';

interface TripList {
  items: Trip[];
  next_cursor: string | null;
}

const TRIP_TONE: Record<string, 'success' | 'brand' | 'warn' | 'danger' | 'neutral'> = {
  published: 'success',
  in_progress: 'brand',
  completed: 'neutral',
  cancelled: 'danger',
  expired: 'neutral',
};

/** A trip that can still be offered work. Mirrors LIVE_TRIP_STATUSES on the server. */
const LIVE_TRIP_STATUSES = new Set(['published', 'partially_booked']);

/**
 * The trips the traveller can still change. Mirrors EDITABLE_TRIP_STATUSES on the server, which
 * includes `full` on purpose: someone who has filled their boot must be able to add space, and the
 * route re-checks every booked parcel before it writes anything.
 */
const EDITABLE_TRIP_STATUSES = new Set(['published', 'partially_booked', 'full']);

/**
 * What an empty discovery list actually means, in the traveller's terms. The codes come from the same
 * engine that built the list, so this never has to guess — it only translates.
 */
const OPPORTUNITY_REASON: Record<string, string> = {
  NO_PARCEL_ON_ROUTE: 'Nobody has posted a parcel on this route yet.',
  NO_CAPACITY: 'Everything on this route is heavier than the space you have left.',
  TRIP_NOT_LIVE: 'This trip is not open for parcels any more.',
  MATCHING_DISABLED: 'Matching is switched off in this deployment.',
  CATEGORY_NOT_ACCEPTED: 'The parcels on this route are not the kind this trip accepts.',
  DEPARTS_AFTER_WINDOW: 'The senders need them collected before you leave.',
  ARRIVES_TOO_LATE: 'You would arrive after their delivery window closes.',
  ITEM_PROHIBITED: 'Nothing legal for this trip is on the route right now.',
  TRAVELLER_NOT_VERIFIED: 'Verify your ID to see parcels on your route.',
};

export function Trips() {
  useDocumentTitle('Travelling');
  const { user } = useSession();
  const queryClient = useQueryClient();
  const cities = useCities();
  const [cancelTarget, setCancelTarget] = useState<Trip | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState<unknown>(null);
  const [editTarget, setEditTarget] = useState<Trip | null>(null);

  const verification = useQuery({
    queryKey: ['verification', 'me'],
    queryFn: () => api.get<Verification>('/verifications/me'),
    enabled: Boolean(user),
  });

  const trips = useQuery({
    queryKey: ['trips', 'mine'],
    queryFn: () => api.get<TripList>('/trips?limit=100'),
    enabled: Boolean(user),
  });

  const cityName = (id: string) => cities.data?.find((c) => c.id === id)?.name ?? 'City';

  async function cancelTrip() {
    if (!cancelTarget) return;
    setCancelBusy(true);
    setCancelError(null);
    try {
      await api.delete(`/trips/${cancelTarget.id}`);
      setCancelTarget(null);
      await queryClient.invalidateQueries({ queryKey: ['trips'] });
    } catch (err) {
      setCancelError(err);
    } finally {
      setCancelBusy(false);
    }
  }

  const verified = verification.data?.state === 'verified';

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium tracking-wide text-ink-500 uppercase">Travelling</p>
          <h1 className="mt-1 text-[22px] font-semibold tracking-tight text-ink-900 sm:text-2xl">Your trips</h1>
          <p className="mt-1 text-sm text-ink-500">
            A trip tells us where you are going and how much space you have. Senders choose you from there.
          </p>
        </div>
        {verified ? (
          <Link to="/trips/new">
            <Button>
              <PlusIcon size={17} />
              Publish a trip
            </Button>
          </Link>
        ) : null}
      </div>

      {verification.isLoading ? (
        <Card>
          <LoadingBlock lines={2} />
        </Card>
      ) : verification.isError ? (
        <ErrorPanel error={verification.error} onRetry={() => void verification.refetch()} />
      ) : verification.data ? (
        <>
          {verification.data.state === 'not_started' ? (
            <Card className="border-warn-600/30 bg-warn-50">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex gap-3">
                  <ClockIcon size={20} className="mt-0.5 shrink-0 text-warn-600" />
                  <div>
                    <p className="text-sm font-semibold text-ink-900">Verify your ID before you publish a trip</p>
                    <p className="mt-1 text-sm text-ink-700">
                      A person checks your driving licence, voter ID or passport. It usually takes under 24 hours.
                      You can look around meanwhile.
                    </p>
                  </div>
                </div>
                <Link to="/verification">
                  <Button size="sm">Start verification</Button>
                </Link>
              </div>
            </Card>
          ) : null}

          {verification.data.state === 'pending' ? (
            <Banner tone="warn" title="Verification is with our team">
              Usually within 24 hours. Publishing a trip stays disabled until it is done.
            </Banner>
          ) : null}

          {verification.data.state === 'rejected' ? (
            <Banner tone="danger" title="Verification was not accepted">
              You can read the reason and try once more, or contact support. Publishing a trip stays disabled.
            </Banner>
          ) : null}

          {verification.data.state === 'verified' ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-surface px-4 py-3">
              <div className="flex items-center gap-2">
                <CheckCircleIcon size={18} className="text-success-600" />
                <p className="text-sm font-semibold text-ink-900">You are verified to carry parcels</p>
              </div>
              <VerificationChip state={verification.data.state} />
            </div>
          ) : null}
        </>
      ) : null}

      {trips.isLoading ? (
        <Card>
          <LoadingBlock lines={4} />
        </Card>
      ) : trips.isError ? (
        <ErrorPanel error={trips.error} onRetry={() => void trips.refetch()} />
      ) : (trips.data?.items.length ?? 0) === 0 ? (
        <EmptyState
          title="No trips yet"
          body={
            verified
              ? 'Publish the drive you are already making. You choose how much space to offer, up to 20 kg.'
              : 'Once your ID is verified you can publish a trip and start receiving parcel requests.'
          }
          icon={<CarIcon size={22} />}
          action={
            verified ? (
              <Link to="/trips/new">
                <Button>Publish a trip</Button>
              </Link>
            ) : (
              <Link to="/verification">
                <Button>Verify your ID</Button>
              </Link>
            )
          }
        />
      ) : (
        <section aria-labelledby="trip-list">
          <SectionHeading title="Published trips" description="Only the areas and times you chose are shown to senders." />
          <div className="space-y-3">
            {trips.data?.items.map((trip) => (
              <Card key={trip.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <Chip tone={TRIP_TONE[trip.status] ?? 'neutral'}>
                        {TRIP_STATUSES.includes(trip.status as (typeof TRIP_STATUSES)[number])
                          ? trip.status.replaceAll('_', ' ')
                          : trip.status.replaceAll('_', ' ')}
                      </Chip>
                      <span className="text-xs font-semibold text-ink-500">
                        {MODE_LABELS[trip.mode as keyof typeof MODE_LABELS] ?? trip.mode}
                      </span>
                    </div>

                    <RouteLine
                      from={cityName(trip.origin_city_id)}
                      to={cityName(trip.dest_city_id)}
                      meta={`Departs ${formatDateTime(trip.departure_at)}`}
                    />

                    <dl className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                      <div>
                        <dt className="text-ink-500">Arrives</dt>
                        <dd className="font-semibold text-ink-900">{formatDateTime(trip.arrival_estimate_at)}</dd>
                      </div>
                      <div>
                        <dt className="text-ink-500">Space left</dt>
                        <dd className="font-semibold text-ink-900">{kg(trip.capacity_kg_remaining)}</dd>
                      </div>
                      <div>
                        <dt className="text-ink-500">Offered</dt>
                        <dd className="font-semibold text-ink-900">{kg(trip.capacity_kg)}</dd>
                      </div>
                      <div>
                        <dt className="text-ink-500">Parcels</dt>
                        <dd className="font-semibold text-ink-900">
                          {trip.accepts_documents_only ? 'Documents only' : 'Any eligible item'}
                        </dd>
                      </div>
                    </dl>
                  </div>

                  <div className="flex shrink-0 flex-col items-end gap-2">
                    {EDITABLE_TRIP_STATUSES.has(trip.status) ? (
                      <Button variant="secondary" size="sm" onClick={() => setEditTarget(trip)}>
                        Change trip
                      </Button>
                    ) : null}
                    {trip.status === 'published' ? (
                      <Button variant="danger" size="sm" onClick={() => setCancelTarget(trip)}>
                        Cancel trip
                      </Button>
                    ) : null}
                  </div>
                </div>

                <TripOpportunities trip={trip} />
              </Card>
            ))}
          </div>
        </section>
      )}

      <Card className="bg-canvas">
        <h2 className="text-sm font-semibold text-ink-900">What carrying involves</h2>
        <ul className="mt-2 space-y-1.5 text-sm text-ink-700">
          <li>You carry a sealed parcel in your own vehicle, on a journey you were already making.</li>
          <li>You can refuse at the door if the seal is broken or the weight does not match. No penalty.</li>
          <li>You mark arrival yourself. There is no live tracking of your phone.</li>
          <li>Your share is released after delivery, once the 72-hour problem window has passed.</li>
        </ul>
      </Card>

      <Sheet
        open={Boolean(cancelTarget)}        onClose={() => {
          setCancelTarget(null);
          setCancelError(null);
        }}
        title="Cancel this trip?"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setCancelTarget(null);
                setCancelError(null);
              }}
            >
              Keep trip
            </Button>
            <Button variant="danger" loading={cancelBusy} onClick={() => void cancelTrip()}>
              Cancel trip
            </Button>
          </>
        }
      >
        <p>
          Senders will no longer see this trip. If a parcel is already booked on it, we will not let you cancel
          here — cancel the booking first, or contact support.
        </p>
        {cancelError ? <ErrorPanel error={cancelError} /> : null}
      </Sheet>

      {editTarget ? <TripEditSheet key={editTarget.id} trip={editTarget} onClose={() => setEditTarget(null)} /> : null}
    </div>
  );
}

/**
 * Changing a trip that senders may already be relying on.
 *
 * The server decides what is allowed: it re-runs every parcel already booked on this trip through the
 * same engine gates that parcel passed when the sender chose it, and refuses a change that would strand
 * one. So this form sends only the fields the traveller actually touched, and a refusal is shown as a
 * refusal — the trip on screen stays what the server holds, never what was typed here.
 */
function TripEditSheet({ trip, onClose }: { trip: Trip; onClose: () => void }) {
  const queryClient = useQueryClient();
  const areas = useAreas(trip.origin_city_id);
  const [departure, setDeparture] = useState(toLocalInput(new Date(trip.departure_at)));
  const [arrival, setArrival] = useState(toLocalInput(new Date(trip.arrival_estimate_at)));
  const [capacity, setCapacity] = useState(String(trip.capacity_kg));
  const [area, setArea] = useState(trip.origin_area ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState<{ rechecked: number } | null>(null);

  function buildPatch(): Record<string, unknown> {
    const patch: Record<string, unknown> = {};
    // Times are compared as instants, not strings: a `datetime-local` value has no seconds or zone, so
    // the round trip never reproduces the stored ISO text exactly even when nothing changed.
    if (departure && new Date(fromLocalInput(departure)).getTime() !== new Date(trip.departure_at).getTime()) {
      patch.departure_at = fromLocalInput(departure);
    }
    if (arrival && new Date(fromLocalInput(arrival)).getTime() !== new Date(trip.arrival_estimate_at).getTime()) {
      patch.arrival_estimate_at = fromLocalInput(arrival);
    }
    const nextCapacity = Number(capacity);
    if (capacity.trim() !== '' && Number.isFinite(nextCapacity) && nextCapacity !== trip.capacity_kg) {
      patch.capacity_kg = nextCapacity;
    }
    const nextArea = area.trim();
    if (nextArea !== (trip.origin_area ?? '')) patch.origin_area = nextArea === '' ? null : nextArea;
    return patch;
  }

  async function save() {
    const patch = buildPatch();
    if (Object.keys(patch).length === 0) {
      setError(new ApiError('VALIDATION_FAILED', 'Nothing has changed yet.', 400, null, { reason: 'nothing_to_change' }));
      return;
    }
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const row = await api.patch<Trip & { bookings_rechecked: number }>(`/trips/${trip.id}`, patch);
      setSaved({ rechecked: row.bookings_rechecked });
      await queryClient.invalidateQueries({ queryKey: ['trips'] });
      await queryClient.invalidateQueries({ queryKey: ['trip-opportunities', trip.id] });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const booked = trip.capacity_kg - trip.capacity_kg_remaining;

  return (
    <Sheet
      open
      onClose={onClose}
      title="Change this trip"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {saved ? 'Done' : 'Keep as is'}
          </Button>
          <Button loading={busy} onClick={() => void save()}>
            Save changes
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-ink-700">
          {booked > 0
            ? `You are already carrying ${kg(booked)} on this trip. We check every booked parcel before we save, so a change that would leave one of them stranded is refused and nothing is written.`
            : 'Nothing is booked on this trip yet, so you can change the times, the space or the meeting point freely.'}
        </p>

        {saved ? (
          <Banner tone="success">
            Saved. {saved.rechecked === 0
              ? 'No parcel was booked on it, so nothing needed re-checking.'
              : `The ${saved.rechecked} ${saved.rechecked === 1 ? 'parcel' : 'parcels'} already booked on it still fit, and ${
                  saved.rechecked === 1 ? 'its' : 'their'
                } sender ${saved.rechecked === 1 ? 'was' : 'were'} told if the timing moved.`}
          </Banner>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Departure" htmlFor="editDeparture">
            <TextInput
              id="editDeparture"
              type="datetime-local"
              value={departure}
              onChange={(event) => setDeparture(event.target.value)}
            />
          </Field>
          <Field label="Estimated arrival" htmlFor="editArrival" hint="Your honest estimate, not a promise.">
            <TextInput
              id="editArrival"
              type="datetime-local"
              value={arrival}
              onChange={(event) => setArrival(event.target.value)}
            />
          </Field>
        </div>

        <Field
          label="Capacity (kg)"
          htmlFor="editCapacity"
          hint={
            booked > 0
              ? `Between ${kg(booked)} and 20 kg — you cannot take back space a booked parcel is using.`
              : 'Between 0.5 and 20 kg.'
          }
        >
          <TextInput
            id="editCapacity"
            type="number"
            inputMode="decimal"
            min={0.5}
            max={20}
            step={0.5}
            value={capacity}
            onChange={(event) => setCapacity(event.target.value)}
          />
        </Field>

        <Field label="Meeting point" htmlFor="editArea" hint="A neighbourhood is enough. We never ask for an exact address.">
          <Select
            id="editArea"
            value={area}
            onChange={(event) => setArea(event.target.value)}
            disabled={areas.isLoading}
          >
            <option value="">Prefer not to say</option>
            {(areas.data ?? []).map((item) => (
              <option key={item.id} value={item.name}>
                {item.name}
              </option>
            ))}
            {area && !(areas.data ?? []).some((item) => item.name === area) ? <option value={area}>{area}</option> : null}
          </Select>
        </Field>

        {error ? <ErrorPanel error={error} /> : null}
      </div>
    </Sheet>
  );
}

/**
 * The parcels this trip could carry, opened from the trip itself.
 *
 * The list is produced by the same engine the sender uses, so a parcel shown here is one that passes
 * every hard gate — route, window, capacity, category, prohibited content. An offer is a flag, not a
 * booking: the sender still chooses, and the traveller's share is only fixed when a booking is created,
 * which is why the money shown is labelled as the sender's price and never as earnings.
 */
function TripOpportunities({ trip }: { trip: Trip }) {
  const [open, setOpen] = useState(false);
  const [busyParcel, setBusyParcel] = useState<string | null>(null);
  const [offerError, setOfferError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const live = LIVE_TRIP_STATUSES.has(trip.status);

  const list = useQuery({
    queryKey: ['trip-opportunities', trip.id],
    queryFn: () => api.get<OpportunityList>(`/trips/${trip.id}/opportunities`),
    enabled: open && live,
    refetchInterval: 60_000,
  });

  const items = list.data?.items ?? [];
  const blockedTotal = Object.values(list.data?.blocked_counts ?? {}).reduce((a, b) => a + b, 0);

  async function offer(parcel: Opportunity) {
    setBusyParcel(parcel.parcel_id);
    setOfferError(null);
    try {
      await api.post(`/trips/${trip.id}/opportunities/${parcel.parcel_id}/interest`, {});
      await queryClient.invalidateQueries({ queryKey: ['trip-opportunities', trip.id] });
    } catch (err) {
      // A stale list is the normal failure here: someone booked it, or the space went. Say which.
      const reason = err instanceof ApiError ? String(err.details.reason ?? err.code) : '';
      setOfferError(
        reason === 'NO_CAPACITY'
          ? `That parcel is ${kg(parcel.weight_kg)} and you have ${kg(trip.capacity_kg_remaining)} left.`
          : reason === 'PARCEL_ALREADY_ASSIGNED'
            ? 'A sender has already booked that parcel.'
            : 'That parcel is no longer available on this trip. The list has been refreshed.',
      );
      await queryClient.invalidateQueries({ queryKey: ['trip-opportunities', trip.id] });
    } finally {
      setBusyParcel(null);
    }
  }

  if (!live) return null;

  return (
    <div className="mt-4 border-t border-line pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="secondary" size="sm" onClick={() => setOpen((v) => !v)}>
          <ChevronDownIcon size={16} className={cn('transition-transform', open && 'rotate-180')} />
          Parcels on this route
        </Button>
        {open && list.isSuccess && items.length > 0 ? (
          <p className="text-xs text-ink-500">
            {items.length} fit{blockedTotal > 0 ? ` · ${blockedTotal} on this route do not` : ''}
          </p>
        ) : null}
      </div>

      {!open ? null : (
        <div className="mt-4 space-y-3">
          {/* Kept above the list, not on the row: a refused parcel disappears from the list, and the
              reason is the part the traveller has to be able to read. */}
          {offerError ? (
            <Banner tone="warn" title="That offer was refused">
              {offerError}
            </Banner>
          ) : null}
          {list.isLoading ? (
            <LoadingBlock lines={3} />
          ) : list.isError ? (
            <ErrorPanel error={list.error} onRetry={() => void list.refetch()} />
          ) : items.length === 0 ? (
            <EmptyState
              title="Nothing on this route fits your trip"
              body={
                OPPORTUNITY_REASON[list.data?.no_match_reasons[0] ?? ''] ??
                'No parcel currently passes the route, timing and capacity checks for this trip.'
              }
              icon={<ParcelIcon size={22} />}
            />
          ) : (
            items.map((parcel) => (
              <div key={parcel.parcel_id} className="rounded-card border border-line bg-canvas p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <MatchBandChip band={parcel.band} />
                      {parcel.sender_verified ? (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-success-600">
                          <ShieldCheckIcon size={14} /> Sender verified
                        </span>
                      ) : (
                        <Chip tone="neutral" icon={false}>
                          Sender not verified
                        </Chip>
                      )}
                      {parcel.offered ? (
                        <Chip tone="brand" icon={false}>
                          Offered
                        </Chip>
                      ) : null}
                    </div>
                    <p className="mt-2 text-sm font-semibold text-ink-900">
                      {CATEGORY_LABELS[parcel.category as Category] ?? parcel.category} · {kg(parcel.weight_kg)}
                    </p>
                    <p className="text-xs text-ink-500">
                      {parcel.origin_area} → {parcel.dest_area}
                    </p>
                    <p className="tabular mt-1 text-xs text-ink-700">
                      Window {formatWindow(parcel.window_start, parcel.window_end)}
                    </p>
                  </div>

                  <div className="text-right">
                    <p className="tabular text-sm font-semibold text-ink-900">
                      Sender pays ~{inr(parcel.indicative_price_paise)}
                    </p>
                    <p className="text-xs text-ink-500">your share is set when a sender books you</p>
                    <div className="mt-2">
                      {parcel.offered ? (
                        <p className="text-xs text-ink-500">The sender has been told.</p>
                      ) : (
                        <Button size="sm" loading={busyParcel === parcel.parcel_id} onClick={() => void offer(parcel)}>
                          Offer to carry
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}

          <p className="text-xs text-ink-500">
            Offering tells the sender you are going their way. Nothing is reserved and nobody is charged —
            the sender chooses, and only then does the booking exist.
          </p>
        </div>
      )}
    </div>
  );
}
