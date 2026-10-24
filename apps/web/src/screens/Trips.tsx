import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { MODE_LABELS, TRIP_STATUSES } from '@py/domain';

import { api, type Trip, type Verification } from '../lib/api';
import { formatDateTime, kg } from '../lib/format';
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
import { RouteLine } from '../components/RouteLine';
import { Chip, VerificationChip } from '../components/StatusChip';
import { CarIcon, CheckCircleIcon, ClockIcon, PlusIcon } from '../components/icons';

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

export function Trips() {
  useDocumentTitle('Travelling');
  const { user } = useSession();
  const queryClient = useQueryClient();
  const cities = useCities();
  const [cancelTarget, setCancelTarget] = useState<Trip | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState<unknown>(null);

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
          <p className="text-xs font-semibold tracking-wide text-brand-700 uppercase">Travelling</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-ink-900 sm:text-3xl">Your trips</h1>
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

                  {trip.status === 'published' ? (
                    <Button variant="danger" size="sm" onClick={() => setCancelTarget(trip)}>
                      Cancel trip
                    </Button>
                  ) : null}
                </div>
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
        open={Boolean(cancelTarget)}
        onClose={() => {
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
    </div>
  );
}
