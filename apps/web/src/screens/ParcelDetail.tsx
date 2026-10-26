import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { CATEGORY_LABELS, MODE_LABELS, RELIABILITY_LABELS, type Category } from '@py/domain';

import {
  api,
  ApiError,
  type Match,
  type MatchResult,
  type ParcelOfferList,
  type ParcelWithBooking,
  type Quote,
} from '../lib/api';
import { formatDateTime, formatWindow, inr, kg, timeAgo } from '../lib/format';
import { useCities, useDocumentTitle } from '../lib/hooks';
import { useSession } from '../lib/session';
import {
  Banner,
  Button,
  Card,
  EmptyState,
  ErrorPanel,
  LoadingBlock,
  SectionHeading,
  Sheet,
  cn,
} from '../components/ui';
import { Chip, MatchBandChip, VerificationChip } from '../components/StatusChip';
import { RouteLine } from '../components/RouteLine';
import { ArrowRightIcon, CarIcon, ChevronLeftIcon, ParcelIcon, ShieldCheckIcon } from '../components/icons';

/** A parcel the sender can still act on. Anything else is a record, not a request. */
const OPEN_STATUSES = new Set(['posted', 'matched']);

const PARCEL_TONE: Record<string, 'success' | 'brand' | 'warn' | 'danger' | 'neutral'> = {
  posted: 'success',
  matched: 'brand',
  draft: 'neutral',
  ineligible: 'danger',
  cancelled: 'danger',
  closed: 'neutral',
};

/** Why an aggregate `no_match_reasons` code is worth saying out loud to a sender. */
const REASON_COPY: Record<string, string> = {
  NO_TRIP_ON_DATE: 'Nobody has published a trip on this route for your window yet.',
  NO_CAPACITY: 'The travellers on this route have no space left.',
  WINDOW_TOO_TIGHT: 'The trips that fit this window arrive after you need it delivered.',
  PARCEL_NOT_OPEN: 'This parcel is not open for booking.',
};

export function ParcelDetail() {
  useDocumentTitle('Parcel');
  const { parcelId = '' } = useParams();
  const { user } = useSession();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const cities = useCities();

  const [bookBusy, setBookBusy] = useState<string | null>(null);
  const [bookError, setBookError] = useState<unknown>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState<unknown>(null);

  const parcel = useQuery({
    queryKey: ['parcel', parcelId],
    queryFn: () => api.get<ParcelWithBooking>(`/parcels/${parcelId}`),
    enabled: Boolean(user && parcelId),
    refetchInterval: 30_000,
  });

  const offers = useQuery({
    queryKey: ['parcel-offers', parcelId],
    queryFn: () => api.get<ParcelOfferList>(`/parcels/${parcelId}/interests`),
    enabled: Boolean(user && parcelId),
    refetchInterval: 60_000,
  });

  const isOpen = Boolean(parcel.data && OPEN_STATUSES.has(parcel.data.status));

  const matches = useQuery({
    queryKey: ['parcel-matches', parcelId],
    queryFn: () => api.get<MatchResult>(`/parcels/${parcelId}/matches`),
    enabled: Boolean(user && parcelId && isOpen),
    refetchInterval: 60_000,
  });

  const cityName = (id: string) => cities.data?.find((c) => c.id === id)?.name ?? 'City';

  /**
   * Book one traveller. The price is taken here rather than passed in from a card: a quote kept open in
   * a tab expires in 15 minutes, and the server refuses a stale one. A live price is a conflict with the
   * quote id attached, so it is reused instead of being treated as a failure.
   */
  async function book(tripId: string) {
    setBookBusy(tripId);
    setBookError(null);
    try {
      const quoteId = await currentQuote();
      const created = await api.post<{ id: string }>('/bookings', { parcel_id: parcelId, trip_id: tripId, quote_id: quoteId });
      await queryClient.invalidateQueries({ queryKey: ['parcel', parcelId] });
      navigate(`/bookings/${created.id}`);
    } catch (err) {
      setBookError(err);
    } finally {
      setBookBusy(null);
    }
  }

  async function currentQuote(): Promise<string> {
    try {
      const priced = await api.post<Quote>(`/parcels/${parcelId}/quote`);
      return priced.id;
    } catch (err) {
      if (err instanceof ApiError && typeof err.details.quote_id === 'string') return err.details.quote_id;
      throw err;
    }
  }

  async function cancelParcel() {
    setCancelBusy(true);
    setCancelError(null);
    try {
      await api.delete(`/parcels/${parcelId}`);
      setCancelOpen(false);
      await queryClient.invalidateQueries({ queryKey: ['parcel', parcelId] });
    } catch (err) {
      setCancelError(err);
    } finally {
      setCancelBusy(false);
    }
  }

  if (parcel.isLoading) {
    return (
      <div className="mx-auto max-w-3xl">
        <Card>
          <LoadingBlock lines={5} />
        </Card>
      </div>
    );
  }

  if (parcel.isError || !parcel.data) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <ErrorPanel error={parcel.error} onRetry={() => void parcel.refetch()} />
        <Link to="/bookings" className="text-sm font-semibold text-brand-700 underline">
          Back to my parcels
        </Link>
      </div>
    );
  }

  const record = parcel.data;
  const offerList = offers.data?.items ?? [];
  const offeredTrips = new Set(offerList.map((o) => o.trip_id));
  const matchList = matches.data?.matches ?? [];
  const matchedTrips = new Set(matchList.map((m) => m.trip_id));
  // An offer outlives its match: the window may have passed or the capacity gone. The sender still
  // deserves to see that someone offered, and to be told why that offer can no longer be taken.
  const strandedOffers = offerList.filter((o) => !matchedTrips.has(o.trip_id));

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Link to="/bookings" className="inline-flex items-center gap-1 text-sm font-medium text-ink-500 hover:text-ink-900">
        <ChevronLeftIcon size={16} />
        My parcels
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Chip tone={PARCEL_TONE[record.status] ?? 'neutral'}>{record.status}</Chip>
            {offerList.length > 0 ? <Chip tone="brand">{offerList.length} offered to carry</Chip> : null}
          </div>
          <h1 className="text-[22px] font-semibold tracking-tight text-ink-900 sm:text-2xl">
            {CATEGORY_LABELS[record.category as Category] ?? record.category}
          </h1>
          <p className="mt-1 text-sm text-ink-500">{record.description}</p>
        </div>
        <div className="text-right">
          <p className="tabular text-lg font-bold text-ink-900">{inr(record.declared_value_paise)}</p>
          <p className="text-xs text-ink-500">declared value</p>
        </div>
      </div>

      <Card>
        <RouteLine
          from={`${cityName(record.origin_city_id)} · ${record.origin_area}`}
          to={`${cityName(record.dest_city_id)} · ${record.dest_area}`}
          meta={formatWindow(record.window_start, record.window_end)}
        />
        <dl className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
          <div>
            <dt className="text-ink-500">Weight</dt>
            <dd className="font-semibold text-ink-900">{kg(record.weight_kg)}</dd>
          </div>
          <div>
            <dt className="text-ink-500">Size</dt>
            <dd className="font-semibold text-ink-900">{record.dims_cm.join(' × ')} cm</dd>
          </div>
          <div>
            <dt className="text-ink-500">Posted</dt>
            <dd className="font-semibold text-ink-900">{formatDateTime(record.created_at)}</dd>
          </div>
        </dl>
        {record.review_reason ? (
          <p className="mt-3 text-xs text-ink-500">Held for review: {record.review_reason}</p>
        ) : null}
      </Card>

      {record.booking_id ? (
        <Banner
          tone="info"
          title="This parcel is already booked"
          action={
            <Link to={`/bookings/${record.booking_id}`}>
              <Button size="sm">
                Open booking
                <ArrowRightIcon size={16} />
              </Button>
            </Link>
          }
        >
          One parcel can only have one active booking, so no further requests can be made on it.
        </Banner>
      ) : null}

      {isOpen && !record.booking_id ? (
        <Card>
          <SectionHeading
            title="Travellers who offered"
            description="An offer is a traveller telling you they are going this way. Nothing is booked or charged until you choose them."
          />

          {offers.isLoading ? (
            <LoadingBlock lines={3} />
          ) : offers.isError ? (
            <ErrorPanel error={offers.error} onRetry={() => void offers.refetch()} />
          ) : offerList.length === 0 ? (
            <p className="text-sm text-ink-500">
              Nobody has offered yet. Travellers with a published trip on this route see this parcel in
              their own list, and you can also pick from the matches below.
            </p>
          ) : (
            <div className="space-y-3">
              {offerList.map((offer) => (
                <TravellerRow
                  key={offer.trip_id}
                  name={offer.traveller_first_name ?? 'Traveller'}
                  mode={offer.mode}
                  verificationState={offer.verification_state}
                  departureAt={offer.departure_at}
                  arrivalAt={offer.arrival_estimate_at}
                  capacityKgRemaining={offer.capacity_kg_remaining}
                  originArea={offer.origin_area}
                  offeredAt={offer.offered_at}
                  live={matchedTrips.has(offer.trip_id)}
                  band={matchList.find((m) => m.trip_id === offer.trip_id)?.band}
                  pricePaise={matchList.find((m) => m.trip_id === offer.trip_id)?.indicative_price_paise}
                  canBook={matchedTrips.has(offer.trip_id) && offer.trip_status !== 'cancelled'}
                  busy={bookBusy === offer.trip_id}
                  onBook={() => void book(offer.trip_id)}
                />
              ))}
            </div>
          )}

          {bookError ? <ErrorPanel error={bookError} className="mt-4" /> : null}
        </Card>
      ) : null}

      {isOpen && !record.booking_id ? (
        <Card>
          <SectionHeading
            title="Other travellers on this route"
            description="Same engine, same hard gates as the offers above. Ranked by fit, not by who paid us."
          />
          {matches.isLoading ? (
            <LoadingBlock lines={3} />
          ) : matches.isError ? (
            <ErrorPanel error={matches.error} onRetry={() => void matches.refetch()} />
          ) : matchList.filter((m) => !offeredTrips.has(m.trip_id)).length === 0 && strandedOffers.length === 0 ? (
            <EmptyState
              title="No other traveller fits this parcel"
              body={
                REASON_COPY[matches.data?.no_match_reasons[0] ?? ''] ??
                'Nobody has published a trip that passes the route, timing and capacity checks for this parcel.'
              }
              icon={<CarIcon size={22} />}
              action={
                <Link to="/trips">
                  <Button variant="secondary" size="sm">
                    See travelling
                  </Button>
                </Link>
              }
            />
          ) : (
            <div className="space-y-3">
              {matches.data?.low_confidence ? (
                <Banner tone="warn" title="These are the closest we have">
                  Check the arrival time against your window before choosing.
                </Banner>
              ) : null}
              {matchList
                .filter((m) => !offeredTrips.has(m.trip_id))
                .map((match) => (
                  <MatchRow
                    key={match.trip_id}
                    match={match}
                    busy={bookBusy === match.trip_id}
                    onBook={() => void book(match.trip_id)}
                  />
                ))}
              {strandedOffers.length > 0 ? (
                <div className="space-y-3 border-t border-line pt-3">
                  <p className="text-xs font-medium text-ink-500 uppercase">Offered, but no longer a match</p>
                  {strandedOffers.map((offer) => (
                    <TravellerRow
                      key={offer.trip_id}
                      name={offer.traveller_first_name ?? 'Traveller'}
                      mode={offer.mode}
                      verificationState={offer.verification_state}
                      departureAt={offer.departure_at}
                      arrivalAt={offer.arrival_estimate_at}
                      capacityKgRemaining={offer.capacity_kg_remaining}
                      originArea={offer.origin_area}
                      offeredAt={offer.offered_at}
                      live={false}
                      canBook={false}
                      busy={false}
                      onBook={() => undefined}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          )}
        </Card>
      ) : null}

      {isOpen && !record.booking_id ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-canvas px-4 py-3">
          <p className="text-sm text-ink-500">
            Cancelling stops travellers offering for this parcel. It cannot be undone.
          </p>
          <Button variant="danger" size="sm" onClick={() => setCancelOpen(true)}>
            Cancel this parcel
          </Button>
        </div>
      ) : null}

      <Sheet
        open={cancelOpen}
        onClose={() => {
          setCancelOpen(false);
          setCancelError(null);
        }}
        title="Cancel this parcel?"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setCancelOpen(false);
                setCancelError(null);
              }}
            >
              Keep it posted
            </Button>
            <Button variant="danger" loading={cancelBusy} onClick={() => void cancelParcel()}>
              Cancel parcel
            </Button>
          </>
        }
      >
        <p>
          Travellers will stop seeing it, and any offer you have not taken becomes void. If a booking is
          already active we will not let you cancel here — cancel the booking first.
        </p>
        {cancelError ? <ErrorPanel error={cancelError} /> : null}
      </Sheet>
    </div>
  );
}

interface RowProps {
  name: string;
  mode: string;
  verificationState: string;
  departureAt: string;
  arrivalAt: string;
  capacityKgRemaining: number;
  originArea: string | null;
  offeredAt?: string;
  band?: Match['band'];
  pricePaise?: number;
  /** False when the engine no longer pairs this trip with the parcel, so booking is refused. */
  live: boolean;
  canBook: boolean;
  busy: boolean;
  onBook: () => void;
}

function TravellerRow({
  name,
  mode,
  verificationState,
  departureAt,
  arrivalAt,
  capacityKgRemaining,
  originArea,
  offeredAt,
  band,
  pricePaise,
  live,
  canBook,
  busy,
  onBook,
}: RowProps) {
  return (
    <div
      className={cn(
        'rounded-card border p-4',
        live ? 'border-brand-600/40 bg-brand-50/40' : 'border-line bg-surface',
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-full bg-brand-100 text-sm font-bold text-brand-700">
            {name.slice(0, 1).toUpperCase()}
          </span>
          <div>
            <p className="text-sm font-semibold text-ink-900">{name}</p>
            <p className="text-xs text-ink-500">
              {MODE_LABELS[mode as keyof typeof MODE_LABELS] ?? mode}
              {originArea ? ` · starts in ${originArea}` : ''}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone="brand" icon={false}>
            Offered{offeredAt ? ` ${timeAgo(offeredAt)}` : ''}
          </Chip>
          {band ? <MatchBandChip band={band} /> : null}
          {verificationState === 'verified' ? (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-success-600">
              <ShieldCheckIcon size={14} /> Verified
            </span>
          ) : (
            <VerificationChip state={verificationState} />
          )}
        </div>
      </div>

      <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        <p className="text-ink-700">
          Departs <span className="font-semibold text-ink-900">{formatDateTime(departureAt)}</span>
        </p>
        <p className="text-ink-700">
          Arrives <span className="font-semibold text-ink-900">~{formatDateTime(arrivalAt)}</span>
        </p>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="inline-flex items-center gap-1.5 text-xs text-ink-500">
          <ParcelIcon size={14} />
          {kg(capacityKgRemaining)} space left
          {typeof pricePaise === 'number' ? ` · price ${inr(pricePaise)}` : ''}
        </p>
        {canBook ? (
          <Button size="sm" loading={busy} onClick={onBook}>
            Book {name}
          </Button>
        ) : (
          <p className="text-xs text-ink-500">
            {live ? 'This trip is no longer open.' : 'Their trip no longer fits this parcel’s window or space.'}
          </p>
        )}
      </div>
    </div>
  );
}

function MatchRow({ match, busy, onBook }: { match: Match; busy: boolean; onBook: () => void }) {
  const name = match.traveller_first_name ?? 'Traveller';
  return (
    <div className="rounded-card border border-line bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-full bg-canvas text-sm font-bold text-ink-700">
            {name.slice(0, 1).toUpperCase()}
          </span>
          <div>
            <p className="text-sm font-semibold text-ink-900">
              {name}
              {match.traveller_initial ? ` ${match.traveller_initial}.` : ''}
            </p>
            <p className="text-xs text-ink-500">
              {MODE_LABELS[match.mode as keyof typeof MODE_LABELS] ?? match.mode} ·{' '}
              {RELIABILITY_LABELS[match.reliability_band as keyof typeof RELIABILITY_LABELS] ?? 'New traveller'}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <MatchBandChip band={match.band} />
          {match.verification_state === 'verified' ? (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-success-600">
              <ShieldCheckIcon size={14} /> Verified
            </span>
          ) : (
            <VerificationChip state={match.verification_state} />
          )}
        </div>
      </div>

      <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        <p className="text-ink-700">
          Departs <span className="font-semibold text-ink-900">{formatDateTime(match.departure_at)}</span>
        </p>
        <p className="text-ink-700">
          Arrives <span className="font-semibold text-ink-900">~{formatDateTime(match.arrival_estimate_at)}</span>
        </p>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-500">
        <span className="inline-flex items-center gap-1">
          <ParcelIcon size={14} /> {kg(match.capacity_kg_remaining)} space left
        </span>
        {match.pickup_distance_band_km && match.pickup_distance_band_km !== '<1' ? (
          <span>Starts {match.pickup_distance_band_km} km away, as the crow flies</span>
        ) : null}
        <span>Price {inr(match.indicative_price_paise)}</span>
        {match.accepts_documents_only ? <span>Documents only</span> : null}
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="truncate text-xs text-ink-500">{match.reasons.join(' · ')}</p>
        <Button size="sm" variant="secondary" loading={busy} onClick={onBook}>
          Book {name}
        </Button>
      </div>
    </div>
  );
}
