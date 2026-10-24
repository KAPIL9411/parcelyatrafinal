import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import { MODE_LABELS } from '@py/domain';

import { api, type Trip, type Verification } from '../lib/api';
import { fromLocalInput, toLocalInput } from '../lib/format';
import { useAreas, useCities, useConfig, useDocumentTitle } from '../lib/hooks';
import { useSession } from '../lib/session';
import {
  Banner,
  Button,
  Card,
  Checkbox,
  ErrorPanel,
  Field,
  SectionHeading,
  Select,
  TextInput,
} from '../components/ui';
import { ArrowRightIcon, CarIcon, ShieldCheckIcon } from '../components/icons';

interface TripState {
  originCityId: string;
  originArea: string;
  destCityId: string;
  destAreaHint: string;
  mode: string;
  departureAt: string;
  arrivalAt: string;
  capacityKg: string;
  documentsOnly: boolean;
}

function tomorrowAt(hour: number): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(hour, 0, 0, 0);
  return toLocalInput(d);
}

export function NewTrip() {
  useDocumentTitle('Publish a trip');
  const { user } = useSession();
  const navigate = useNavigate();
  const cities = useCities();
  const config = useConfig();

  const verification = useQuery({
    queryKey: ['verification', 'me'],
    queryFn: () => api.get<Verification>('/verifications/me'),
    enabled: Boolean(user),
  });

  const bareilly = cities.data?.find((c) => c.name === 'Bareilly');
  const delhi = cities.data?.find((c) => c.name === 'Delhi');

  const [trip, setTrip] = useState<TripState>(() => ({
    originCityId: '',
    originArea: '',
    destCityId: '',
    destAreaHint: '',
    mode: 'car',
    departureAt: tomorrowAt(9),
    arrivalAt: tomorrowAt(18),
    capacityKg: '5',
    documentsOnly: false,
  }));
  const [seeded, setSeeded] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<unknown>(null);

  const areas = useAreas(trip.originCityId || null);

  useEffect(() => {
    if (seeded || !bareilly || !delhi) return;
    setTrip((prev) => ({
      ...prev,
      originCityId: prev.originCityId || bareilly.id,
      destCityId: prev.destCityId || delhi.id,
    }));
    setSeeded(true);
  }, [seeded, bareilly, delhi]);

  const verified = verification.data?.state === 'verified';

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (!trip.originCityId) next.originCityId = 'Choose the city you are leaving from.';
    if (!trip.destCityId) next.destCityId = 'Choose the city you are going to.';
    if (trip.originCityId && trip.originCityId === trip.destCityId) next.destCityId = 'Origin and destination must differ.';

    const departure = trip.departureAt ? new Date(trip.departureAt) : null;
    const arrival = trip.arrivalAt ? new Date(trip.arrivalAt) : null;
    if (!departure || Number.isNaN(departure.getTime())) next.departureAt = 'Choose a departure time.';
    if (!arrival || Number.isNaN(arrival.getTime())) next.arrivalAt = 'Choose an estimated arrival time.';
    if (departure && arrival) {
      if (arrival <= departure) next.arrivalAt = 'Arrival must be after departure.';
      if (departure.getTime() < Date.now() - 60_000) next.departureAt = 'Departure cannot be in the past.';
    }

    const capacity = Number(trip.capacityKg);
    if (!Number.isFinite(capacity) || capacity <= 0 || capacity > 20) {
      next.capacityKg = 'Capacity must be between 0.5 and 20 kg.';
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function submit() {
    if (!validate()) return;
    setBusy(true);
    setSubmitError(null);
    try {
      const created = await api.post<Trip>('/trips', {
        origin_city_id: trip.originCityId,
        dest_city_id: trip.destCityId,
        ...(trip.originArea ? { origin_area: trip.originArea } : {}),
        mode: trip.mode,
        departure_at: fromLocalInput(trip.departureAt),
        arrival_estimate_at: fromLocalInput(trip.arrivalAt),
        capacity_kg: Number(trip.capacityKg),
        accepts_documents_only: trip.documentsOnly,
      });
      navigate('/trips', { state: { published: created.id } });
    } catch (err) {
      setSubmitError(err);
    } finally {
      setBusy(false);
    }
  }

  if (verification.isLoading) {
    return (
      <Card className="mx-auto max-w-lg">
        <p className="text-sm text-ink-500">Checking your verification…</p>
      </Card>
    );
  }

  if (!verified) {
    const state = verification.data?.state ?? 'not_started';
    return (
      <div className="mx-auto max-w-lg space-y-4">
        <Card>
          <span className="grid h-11 w-11 place-items-center rounded-full bg-warn-50 text-warn-600">
            <ShieldCheckIcon size={22} />
          </span>
          <h1 className="mt-4 text-xl font-semibold text-ink-900">
            {state === 'pending' ? 'Your verification is with our team' : 'Verify your ID before publishing a trip'}
          </h1>
          <p className="mt-2 text-sm text-ink-700">
            {state === 'pending'
              ? 'Usually within 24 hours. You cannot publish a trip until a person has checked your ID.'
              : state === 'rejected'
                ? 'Your last verification was not accepted. Read the reason, then try once more or contact support.'
                : 'A person checks one photo ID and a selfie. It usually takes under 24 hours. We never ask for Aadhaar.'}
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link to="/verification">
              <Button>{state === 'rejected' ? 'Review verification' : 'Start verification'}</Button>
            </Link>
            <Link to="/help">
              <Button variant="secondary">Contact support</Button>
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <p className="text-xs font-semibold tracking-wide text-brand-700 uppercase">Travelling</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-ink-900 sm:text-3xl">Publish a trip</h1>
        <p className="mt-1 text-sm text-ink-500">
          Tell us the drive you are already making. Senders see the route, the time and the space — not your phone
          number.
        </p>
      </div>

      <Banner tone="info" title="Only car travel is open at pilot">
        We are not carrying parcels on bikes, buses, trains or flights yet. Car only keeps the handover simple.
      </Banner>

      <form
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Card className="space-y-5">
          <SectionHeading eyebrow="Route" title="Where are you going?" />

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Leaving from" htmlFor="originCity" error={errors.originCityId}>
              <Select
                id="originCity"
                value={trip.originCityId}
                onChange={(event) =>
                  setTrip((prev) => ({ ...prev, originCityId: event.target.value, originArea: '' }))
                }
              >
                <option value="">Choose a city</option>
                {(cities.data ?? []).map((city) => (
                  <option key={city.id} value={city.id} disabled={!city.is_serviceable}>
                    {city.name}
                    {city.is_serviceable ? '' : ' (not yet)'}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Going to" htmlFor="destCity" error={errors.destCityId}>
              <Select
                id="destCity"
                value={trip.destCityId}
                onChange={(event) => setTrip((prev) => ({ ...prev, destCityId: event.target.value }))}
              >
                <option value="">Choose a city</option>
                {(cities.data ?? []).map((city) => (
                  <option key={city.id} value={city.id} disabled={!city.is_serviceable}>
                    {city.name}
                    {city.is_serviceable ? '' : ' (not yet)'}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <Field
            label="Area you are leaving from"
            htmlFor="originArea"
            optional
            hint="A neighbourhood is enough. We never ask for your exact address."
          >
            <Select
              id="originArea"
              value={trip.originArea}
              onChange={(event) => setTrip((prev) => ({ ...prev, originArea: event.target.value }))}
              disabled={!trip.originCityId || areas.isLoading}
            >
              <option value="">Prefer not to say</option>
              {(areas.data ?? []).map((area) => (
                <option key={area.id} value={area.name}>
                  {area.name}
                </option>
              ))}
            </Select>
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Departure" htmlFor="departureAt" error={errors.departureAt}>
              <TextInput
                id="departureAt"
                type="datetime-local"
                value={trip.departureAt}
                onChange={(event) => setTrip((prev) => ({ ...prev, departureAt: event.target.value }))}
              />
            </Field>
            <Field
              label="Estimated arrival"
              htmlFor="arrivalAt"
              error={errors.arrivalAt}
              hint="Your honest estimate, not a promise."
            >
              <TextInput
                id="arrivalAt"
                type="datetime-local"
                value={trip.arrivalAt}
                onChange={(event) => setTrip((prev) => ({ ...prev, arrivalAt: event.target.value }))}
              />
            </Field>
          </div>
        </Card>

        <Card className="space-y-5">
          <SectionHeading eyebrow="Space" title="How much can you carry?" />

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Capacity (kg)" htmlFor="capacity" error={errors.capacityKg} hint="Between 0.5 and 20 kg.">
              <TextInput
                id="capacity"
                type="number"
                inputMode="decimal"
                min={0.5}
                max={20}
                step={0.5}
                value={trip.capacityKg}
                onChange={(event) => setTrip((prev) => ({ ...prev, capacityKg: event.target.value }))}
              />
            </Field>

            <Field label="Travel mode" htmlFor="mode">
              <Select id="mode" value={trip.mode} disabled>
                <option value="car">{MODE_LABELS.car}</option>
                {(config.data?.modes ?? [])
                  .filter((mode) => mode !== 'car')
                  .map((mode) => (
                    <option key={mode} value={mode} disabled>
                      {MODE_LABELS[mode as keyof typeof MODE_LABELS] ?? mode} (not open at pilot)
                    </option>
                  ))}
              </Select>
            </Field>
          </div>

          <Checkbox
            checked={trip.documentsOnly}
            onChange={(event) => setTrip((prev) => ({ ...prev, documentsOnly: event.target.checked }))}
            label="I will carry documents only"
            description="Optional. It narrows the requests you receive to paper documents."
          />

          <div className="rounded-input border border-line bg-canvas p-4">
            <div className="flex gap-3">
              <CarIcon size={20} className="mt-0.5 shrink-0 text-brand-700" />
              <div className="text-sm text-ink-700">
                <p className="font-semibold text-ink-900">What you are agreeing to</p>
                <ul className="mt-1.5 space-y-1">
                  <li>The parcel is sealed before you receive it, and you can refuse it at the door.</li>
                  <li>You hand it to the named receiver only, against a six-digit code.</li>
                  <li>You are not a courier service: four parcels per month is the pilot limit.</li>
                  <li>Your share is released after delivery, once the 72-hour problem window has passed.</li>
                </ul>
              </div>
            </div>
          </div>
        </Card>

        {submitError ? <ErrorPanel error={submitError} /> : null}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link to="/trips">
            <Button variant="secondary" type="button">
              Back
            </Button>
          </Link>
          <Button type="submit" size="lg" loading={busy}>
            Publish trip
            <ArrowRightIcon size={18} />
          </Button>
        </div>
      </form>
    </div>
  );
}
