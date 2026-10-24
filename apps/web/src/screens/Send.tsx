import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import {
  CATEGORY_HINTS,
  CATEGORY_LABELS,
  MATCH_REASON_LABELS,
  MODE_LABELS,
  RELIABILITY_LABELS,
  type Category,
} from '@py/domain';

import { api, type Match, type MatchResult, type Parcel, type Quote } from '../lib/api';
import { errorCopy } from '../lib/copy';
import { countdown, formatDateTime, formatWindow, fromLocalInput, inr, kg, normaliseIndianPhone, toLocalInput } from '../lib/format';
import { useCities, useAreas, useConfig, useCountdown, useDocumentTitle, useOnline } from '../lib/hooks';
import { useSession } from '../lib/session';
import { sampleImage, uploadPhoto } from '../lib/upload';
import {
  Banner,
  Button,
  Card,
  Checkbox,
  EmptyState,
  ErrorPanel,
  Field,
  LoadingBlock,
  MoneyRow,
  SectionHeading,
  Select,
  Skeleton,
  TextArea,
  TextInput,
  cn,
} from '../components/ui';
import { MatchBandChip, SandboxChip } from '../components/StatusChip';
import { RouteLine } from '../components/RouteLine';
import {
  ArrowRightIcon,
  CameraIcon,
  CarIcon,
  CheckCircleIcon,
  ParcelIcon,
  ShieldCheckIcon,
} from '../components/icons';

const MAX_VALUE_RUPEES = 5000;

interface ItemState {
  category: Category;
  description: string;
  weightKg: string;
  dims: [string, string, string];
  declaredValueRupees: string;
  photoKey: string;
  packaging: { sealed: boolean; tamperEvident: boolean; noLiquids: boolean };
  declaration: boolean;
}

interface RouteState {
  originCityId: string;
  originArea: string;
  destCityId: string;
  destArea: string;
  windowStart: string;
  windowEnd: string;
  receiverName: string;
  receiverPhone: string;
}

const STEP_LABELS = ['Item', 'Route', 'Price and traveller'];

function defaultItem(): ItemState {
  return {
    category: 'documents',
    description: '',
    weightKg: '1.5',
    dims: ['30', '22', '2'],
    declaredValueRupees: '2500',
    photoKey: '',
    packaging: { sealed: false, tamperEvident: false, noLiquids: false },
    declaration: false,
  };
}

function defaultRoute(bareillyId: string | undefined, delhiId: string | undefined): RouteState {
  const start = new Date();
  start.setDate(start.getDate() + 1);
  start.setHours(9, 0, 0, 0);
  const end = new Date(start);
  end.setHours(18, 0, 0, 0);

  return {
    originCityId: bareillyId ?? '',
    originArea: '',
    destCityId: delhiId ?? '',
    destArea: '',
    windowStart: toLocalInput(start),
    windowEnd: toLocalInput(end),
    receiverName: '',
    receiverPhone: '',
  };
}

export function Send() {
  useDocumentTitle('Send a parcel');
  const { user } = useSession();
  const online = useOnline();
  const navigate = useNavigate();

  const config = useConfig();
  const cities = useCities();
  const bareilly = cities.data?.find((c) => c.name === 'Bareilly');
  const delhi = cities.data?.find((c) => c.name === 'Delhi');

  const [step, setStep] = useState(1);
  const [item, setItem] = useState<ItemState>(defaultItem);
  const [route, setRoute] = useState<RouteState>(() => defaultRoute(undefined, undefined));
  const [routeSeeded, setRouteSeeded] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<unknown>(null);
  const [submitError, setSubmitError] = useState<unknown>(null);
  const [parcel, setParcel] = useState<Parcel | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [matches, setMatches] = useState<MatchResult | null>(null);
  const [selectedTrip, setSelectedTrip] = useState<string | null>(null);
  const [bookingBusy, setBookingBusy] = useState(false);
  const [bookingError, setBookingError] = useState<unknown>(null);

  const originAreas = useAreas(route.originCityId || null);
  const destAreas = useAreas(route.destCityId || null);
  const originCity = cities.data?.find((c) => c.id === route.originCityId);
  const destCity = cities.data?.find((c) => c.id === route.destCityId);

  // Seed the route once the catalogue arrives, without clobbering anything the user already chose.
  useEffect(() => {
    if (routeSeeded || !bareilly || !delhi) return;
    setRoute((prev) => ({
      ...prev,
      originCityId: prev.originCityId || bareilly.id,
      destCityId: prev.destCityId || delhi.id,
    }));
    setRouteSeeded(true);
  }, [routeSeeded, bareilly, delhi]);

  const quoteRemaining = useCountdown(quote?.expires_at);
  const quoteExpired = Boolean(quote) && quoteRemaining <= 0;

  const selectedMatch = useMemo(
    () => matches?.matches.find((m) => m.trip_id === selectedTrip) ?? null,
    [matches, selectedTrip],
  );

  // ------------------------------------------------------------------ validation

  function validateItem(): boolean {
    const next: Record<string, string> = {};
    const weight = Number(item.weightKg);
    const value = Number(item.declaredValueRupees);
    const dims = item.dims.map(Number);

    if (item.description.trim().length < 5) next.description = 'Describe what is inside in at least five characters.';
    if (item.description.trim().length > 300) next.description = 'Keep the description under 300 characters.';
    if (!Number.isFinite(weight) || weight <= 0 || weight > 5) next.weight = 'Weight must be between 0.1 and 5 kg.';
    if (dims.some((d) => !Number.isFinite(d) || d < 1 || d > 45)) next.dims = 'Each side must be between 1 and 45 cm.';
    if (!Number.isFinite(value) || value < 1 || value > MAX_VALUE_RUPEES) {
      next.value = 'We carry items worth up to ₹5,000 at pilot, because parcels are not insured yet.';
    }
    if (!item.photoKey) next.photo = 'Photograph the sealed parcel.';
    if (!item.packaging.sealed || !item.packaging.tamperEvident || !item.packaging.noLiquids) {
      next.packaging = 'Tick all three packaging checks before continuing.';
    }
    if (!item.declaration) next.declaration = 'Confirm the declaration to continue.';

    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function validateRoute(): boolean {
    const next: Record<string, string> = {};
    if (!route.originCityId) next.originCity = 'Choose the pickup city.';
    if (!route.originArea) next.originArea = 'Choose the pickup area.';
    if (!route.destCityId) next.destCity = 'Choose the destination city.';
    if (!route.destArea) next.destArea = 'Choose the destination area.';
    if (route.originCityId && route.originCityId === route.destCityId) next.destCity = 'Pickup and destination must differ.';

    const start = route.windowStart ? new Date(route.windowStart) : null;
    const end = route.windowEnd ? new Date(route.windowEnd) : null;
    if (!start || Number.isNaN(start.getTime())) next.windowStart = 'Choose a start time.';
    if (!end || Number.isNaN(end.getTime())) next.windowEnd = 'Choose an end time.';
    if (start && end) {
      if (end <= start) next.windowEnd = 'The window must end after it starts.';
      if (start.getTime() < Date.now() - 60_000) next.windowStart = 'The window cannot start in the past.';
      if (end.getTime() > Date.now() + 7 * 86_400_000) next.windowEnd = 'The window must be within the next 7 days.';
    }

    if (route.receiverName.trim().length < 2) next.receiverName = 'Enter the receiver’s name.';
    if (!normaliseIndianPhone(route.receiverPhone)) {
      next.receiverPhone = 'Enter a 10-digit Indian mobile number. We text the receiver before delivery.';
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  }

  // ------------------------------------------------------------------ actions

  async function handlePhoto(file: File | null) {
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      const key = await uploadPhoto(file, 'parcel_sealed');
      setItem((prev) => ({ ...prev, photoKey: key }));
      setErrors((prev) => ({ ...prev, photo: '' }));
    } catch (err) {
      setUploadError(err);
    } finally {
      setUploading(false);
    }
  }

  async function createParcelAndPrice() {
    if (!validateRoute()) return;
    setBusy(true);
    setSubmitError(null);
    setParcel(null);
    setQuote(null);
    setMatches(null);

    try {
      const created = await api.post<Parcel>('/parcels', {
        origin_city_id: route.originCityId,
        dest_city_id: route.destCityId,
        origin_area: route.originArea,
        dest_area: route.destArea,
        category: item.category,
        description: item.description.trim(),
        weight_kg: Number(item.weightKg),
        dims_cm: item.dims.map((d) => Math.round(Number(d))),
        declared_value_paise: Math.round(Number(item.declaredValueRupees) * 100),
        window_start: fromLocalInput(route.windowStart),
        window_end: fromLocalInput(route.windowEnd),
        receiver_name: route.receiverName.trim(),
        receiver_phone: normaliseIndianPhone(route.receiverPhone)!,
        sealed_photo_key: item.photoKey,
        declaration_accepted: true,
      });

      setParcel(created);

      if (created.review_required) {
        setStep(3);
        return;
      }

      const [matchResult, priced] = await Promise.all([
        api.get<MatchResult>(`/parcels/${created.id}/matches`),
        api.post<Quote>(`/parcels/${created.id}/quote`),
      ]);
      setMatches(matchResult);
      setQuote(priced);
      setSelectedTrip(matchResult.matches[0]?.trip_id ?? null);
      setStep(3);
    } catch (err) {
      setSubmitError(err);
    } finally {
      setBusy(false);
    }
  }

  async function refreshPrice() {
    if (!parcel) return;
    setBusy(true);
    setSubmitError(null);
    try {
      const priced = await api.post<Quote>(`/parcels/${parcel.id}/quote`);
      setQuote(priced);
    } catch (err) {
      setSubmitError(err);
    } finally {
      setBusy(false);
    }
  }

  async function book() {
    if (!parcel || !quote || !selectedTrip) return;
    setBookingBusy(true);
    setBookingError(null);
    try {
      const created = await api.post<{ id: string }>('/bookings', {
        parcel_id: parcel.id,
        trip_id: selectedTrip,
        quote_id: quote.id,
      });
      navigate(`/bookings/${created.id}`);
    } catch (err) {
      setBookingError(err);
    } finally {
      setBookingBusy(false);
    }
  }

  // ------------------------------------------------------------------ render

  if (!user) {
    return (
      <Card className="mx-auto max-w-lg text-center">
        <h1 className="text-xl font-semibold text-ink-900">Sign in to send a parcel</h1>
        <p className="mt-1 text-sm text-ink-500">We need a verified phone number before a parcel can be posted.</p>
        <Link to="/login?next=/send" className="mt-5 inline-block">
          <Button>Sign in</Button>
        </Link>
      </Card>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <p className="text-xs font-semibold tracking-wide text-brand-700 uppercase">New parcel</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-ink-900 sm:text-3xl">Send a parcel</h1>
        <p className="mt-1 text-sm text-ink-500">
          Three steps. Nothing is charged until a traveller accepts and you confirm the price.
        </p>
      </div>

      <ol className="flex items-center gap-2" aria-label="Progress">
        {STEP_LABELS.map((label, index) => {
          const number = index + 1;
          const state = step === number ? 'current' : step > number ? 'done' : 'pending';
          return (
            <li key={label} className="flex flex-1 items-center gap-2">
              <span
                className={cn(
                  'grid h-7 w-7 shrink-0 place-items-center rounded-full border text-xs font-bold',
                  state === 'done' && 'border-brand-600 bg-brand-600 text-white',
                  state === 'current' && 'border-brand-600 bg-surface text-brand-700',
                  state === 'pending' && 'border-line-strong bg-surface text-ink-300',
                )}
                aria-current={state === 'current' ? 'step' : undefined}
              >
                {state === 'done' ? <CheckCircleIcon size={15} /> : number}
              </span>
              <span
                className={cn(
                  'hidden text-sm sm:block',
                  state === 'current' ? 'font-semibold text-ink-900' : 'text-ink-500',
                )}
              >
                {label}
              </span>
              {index < STEP_LABELS.length - 1 ? <span className="h-px flex-1 bg-line" aria-hidden="true" /> : null}
            </li>
          );
        })}
      </ol>

      {!online ? (
        <Banner tone="warn" title="You’re offline">
          We’ll keep this draft on your device. You can submit when the connection returns.
        </Banner>
      ) : null}

      {/* ---------------------------------------------------------------- step 1 */}
      {step === 1 ? (
        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (validateItem()) setStep(2);
          }}
        >
          <Card className="space-y-5">
            <SectionHeading eyebrow="Step 1" title="What are you sending?" />

            <Field label="Category" hint="Prohibited items are not listed. Read the prohibited items list if you are unsure.">
              <div className="grid gap-2 sm:grid-cols-2">
                {(config.data?.categories ?? []).map((value) => {
                  const category = value as Category;
                  const active = item.category === category;
                  return (
                    <label
                      key={value}
                      className={cn(
                        'flex cursor-pointer gap-3 rounded-input border p-3 transition-colors',
                        active ? 'border-brand-600 bg-brand-50' : 'border-line-strong bg-surface hover:border-ink-300',
                      )}
                    >
                      <input
                        type="radio"
                        name="category"
                        value={value}
                        checked={active}
                        onChange={() => setItem((prev) => ({ ...prev, category }))}
                        className="mt-0.5 h-4 w-4 shrink-0 accent-brand-600"
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-ink-900">{CATEGORY_LABELS[category]}</span>
                        <span className="mt-0.5 block text-xs text-ink-500">{CATEGORY_HINTS[category]}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </Field>

            <Field
              label="What is inside?"
              htmlFor="description"
              error={errors.description}
              hint="Be specific. “Documents” is not enough — say which documents."
            >
              <TextArea
                id="description"
                value={item.description}
                maxLength={300}
                onChange={(event) => setItem((prev) => ({ ...prev, description: event.target.value }))}
                placeholder="e.g. A4 envelope with property papers and a signed agreement"
              />
            </Field>

            <Field
              label="Photo of the sealed parcel"
              error={errors.photo ?? (uploadError ? errorCopy(uploadError).body : null)}
              hint="Photograph the parcel after sealing it. We strip location data from the photo."
            >
              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex min-h-12 cursor-pointer items-center gap-2 rounded-input border border-line-strong bg-surface px-4 text-sm font-semibold text-ink-900 hover:border-ink-500">
                  <CameraIcon size={18} />
                  {item.photoKey ? 'Replace photo' : 'Take or choose a photo'}
                  <input
                    type="file"
                    accept="image/jpeg,image/png"
                    capture="environment"
                    className="sr-only"
                    onChange={(event) => void handlePhoto(event.target.files?.[0] ?? null)}
                  />
                </label>
                {import.meta.env.DEV ? (
                  <Button
                    variant="tertiary"
                    size="sm"
                    loading={uploading}
                    onClick={() => void handlePhoto(sampleImage('sealed-parcel.png'))}
                  >
                    Use sample image (test mode)
                  </Button>
                ) : null}
                {item.photoKey ? (
                  <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-success-600">
                    <CheckCircleIcon size={16} /> Attached
                  </span>
                ) : uploading ? (
                  <span className="text-sm text-ink-500">Uploading…</span>
                ) : null}
              </div>
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Weight (kg)" htmlFor="weight" error={errors.weight} hint="Up to 5 kg at launch.">
                <TextInput
                  id="weight"
                  type="number"
                  inputMode="decimal"
                  min={0.1}
                  max={5}
                  step={0.1}
                  value={item.weightKg}
                  onChange={(event) => setItem((prev) => ({ ...prev, weightKg: event.target.value }))}
                />
              </Field>

              <Field
                label="Declared value (₹)"
                htmlFor="value"
                error={errors.value}
                hint={`Up to ₹${MAX_VALUE_RUPEES.toLocaleString('en-IN')}.`}
              >
                <TextInput
                  id="value"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={MAX_VALUE_RUPEES}
                  value={item.declaredValueRupees}
                  onChange={(event) => setItem((prev) => ({ ...prev, declaredValueRupees: event.target.value }))}
                />
              </Field>
            </div>

            <Field label="Dimensions (cm)" error={errors.dims} hint="Length, width and height. Each side up to 45 cm.">
              <div className="grid grid-cols-3 gap-2">
                {(['Length', 'Width', 'Height'] as const).map((label, index) => (
                  <div key={label}>
                    <TextInput
                      aria-label={label}
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={45}
                      value={item.dims[index]}
                      onChange={(event) =>
                        setItem((prev) => {
                          const dims = [...prev.dims] as [string, string, string];
                          dims[index] = event.target.value;
                          return { ...prev, dims };
                        })
                      }
                    />
                    <span className="mt-1 block text-xs text-ink-500">{label}</span>
                  </div>
                ))}
              </div>
            </Field>

            <Field label="Packaging checks" error={errors.packaging} hint="All three must be true before a traveller accepts.">
              <div className="space-y-1">
                <Checkbox
                  checked={item.packaging.sealed}
                  onChange={(event) =>
                    setItem((prev) => ({ ...prev, packaging: { ...prev.packaging, sealed: event.target.checked } }))
                  }
                  label="The parcel is sealed"
                />
                <Checkbox
                  checked={item.packaging.tamperEvident}
                  onChange={(event) =>
                    setItem((prev) => ({
                      ...prev,
                      packaging: { ...prev.packaging, tamperEvident: event.target.checked },
                    }))
                  }
                  label="It is tamper-evident"
                  description="Tape or a seal that shows if it has been opened."
                />
                <Checkbox
                  checked={item.packaging.noLiquids}
                  onChange={(event) =>
                    setItem((prev) => ({
                      ...prev,
                      packaging: { ...prev.packaging, noLiquids: event.target.checked },
                    }))
                  }
                  label="There are no liquids inside"
                />
              </div>
            </Field>

            <div>
              <Checkbox
                checked={item.declaration}
                onChange={(event) => setItem((prev) => ({ ...prev, declaration: event.target.checked }))}
                label="I declare this is not a prohibited item"
                description="The description is accurate and nothing has been added after the photo."
              />
              {errors.declaration ? (
                <p className="mt-1 text-sm text-danger-600" role="alert">
                  {errors.declaration}
                </p>
              ) : null}
            </div>
          </Card>

          <div className="flex justify-end">
            <Button type="submit" size="lg">
              Continue to route
              <ArrowRightIcon size={18} />
            </Button>
          </div>
        </form>
      ) : null}

      {/* ---------------------------------------------------------------- step 2 */}
      {step === 2 ? (
        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            void createParcelAndPrice();
          }}
        >
          <Card className="space-y-5">
            <SectionHeading
              eyebrow="Step 2"
              title="Where and when?"
              description="We only run the corridors below at pilot. Pickup and drop use the area you choose — never GPS."
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Pickup city" htmlFor="originCity" error={errors.originCity}>
                <Select
                  id="originCity"
                  value={route.originCityId}
                  onChange={(event) =>
                    setRoute((prev) => ({ ...prev, originCityId: event.target.value, originArea: '' }))
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

              <Field label="Pickup area" htmlFor="originArea" error={errors.originArea}>
                <Select
                  id="originArea"
                  value={route.originArea}
                  onChange={(event) => setRoute((prev) => ({ ...prev, originArea: event.target.value }))}
                  disabled={!route.originCityId || originAreas.isLoading}
                >
                  <option value="">Choose an area</option>
                  {(originAreas.data ?? []).map((area) => (
                    <option key={area.id} value={area.name}>
                      {area.name}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Destination city" htmlFor="destCity" error={errors.destCity}>
                <Select
                  id="destCity"
                  value={route.destCityId}
                  onChange={(event) =>
                    setRoute((prev) => ({ ...prev, destCityId: event.target.value, destArea: '' }))
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

              <Field label="Destination area" htmlFor="destArea" error={errors.destArea}>
                <Select
                  id="destArea"
                  value={route.destArea}
                  onChange={(event) => setRoute((prev) => ({ ...prev, destArea: event.target.value }))}
                  disabled={!route.destCityId || destAreas.isLoading}
                >
                  <option value="">Choose an area</option>
                  {(destAreas.data ?? []).map((area) => (
                    <option key={area.id} value={area.name}>
                      {area.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Window starts"
                htmlFor="windowStart"
                error={errors.windowStart}
                hint="Must be within the next 7 days."
              >
                <TextInput
                  id="windowStart"
                  type="datetime-local"
                  value={route.windowStart}
                  onChange={(event) => setRoute((prev) => ({ ...prev, windowStart: event.target.value }))}
                />
              </Field>
              <Field label="Window ends" htmlFor="windowEnd" error={errors.windowEnd}>
                <TextInput
                  id="windowEnd"
                  type="datetime-local"
                  value={route.windowEnd}
                  onChange={(event) => setRoute((prev) => ({ ...prev, windowEnd: event.target.value }))}
                />
              </Field>
            </div>

            <div className="rounded-card border border-line bg-canvas p-4">
              <h3 className="text-sm font-semibold text-ink-900">Who receives it?</h3>
              <p className="mt-1 text-sm text-ink-500">
                We text the receiver a link before delivery. We never show their number to the traveller.
              </p>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <Field label="Receiver’s name" htmlFor="receiverName" error={errors.receiverName}>
                  <TextInput
                    id="receiverName"
                    value={route.receiverName}
                    onChange={(event) => setRoute((prev) => ({ ...prev, receiverName: event.target.value }))}
                    placeholder="e.g. R. Sharma"
                  />
                </Field>
                <Field label="Receiver’s mobile" htmlFor="receiverPhone" error={errors.receiverPhone}>
                  <TextInput
                    id="receiverPhone"
                    type="tel"
                    inputMode="numeric"
                    value={route.receiverPhone}
                    onChange={(event) => setRoute((prev) => ({ ...prev, receiverPhone: event.target.value }))}
                    placeholder="+91 98765 43210"
                  />
                </Field>
              </div>
            </div>

            {submitError ? <ErrorPanel error={submitError} onRetry={() => void createParcelAndPrice()} /> : null}
          </Card>

          <div className="flex items-center justify-between gap-3">
            <Button variant="secondary" onClick={() => setStep(1)}>
              Back
            </Button>
            <Button type="submit" size="lg" loading={busy}>
              See price and travellers
              <ArrowRightIcon size={18} />
            </Button>
          </div>
        </form>
      ) : null}

      {/* ---------------------------------------------------------------- step 3 */}
      {step === 3 ? (
        <div className="space-y-5">
          {parcel?.review_required ? (
            <Card>
              <Banner
                tone="warn"
                title="This needs a quick human check"
                icon
              >
                <p>
                  Usually within 2 hours. We’ll text you. You can close this page — nothing is charged while we
                  review it.
                </p>
              </Banner>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link to="/bookings">
                  <Button variant="secondary">Go to my parcels</Button>
                </Link>
                <Link to="/help">
                  <Button variant="tertiary">Contact support</Button>
                </Link>
              </div>
            </Card>
          ) : busy && !quote ? (
            <Card className="space-y-4">
              <Skeleton className="h-5 w-40" />
              <LoadingBlock lines={4} />
            </Card>
          ) : (
            <>
              <Card>
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-ink-900">Price</h2>
                    <p className="text-sm text-ink-500">Every line is named. The server computed it.</p>
                  </div>
                  <SandboxChip />
                </div>

                {quote ? (
                  <>
                    <div className="rounded-input bg-canvas p-3">
                      <RouteLine
                        from={`${originCity?.name ?? ''} · ${route.originArea}`}
                        to={`${destCity?.name ?? ''} · ${route.destArea}`}
                        meta={formatWindow(fromLocalInput(route.windowStart), fromLocalInput(route.windowEnd))}
                      />
                    </div>

                    <div className="mt-4">
                      {quote.breakdown.map((line) => (
                        <MoneyRow key={line.label} label={line.label} amountPaise={line.amount_paise} note={line.note} />
                      ))}
                      <MoneyRow label="Total" amountPaise={quote.total_paise} total />
                    </div>

                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
                      {quoteExpired ? (
                        <span className="font-semibold text-warn-600">This price expired.</span>
                      ) : (
                        <span className="text-ink-500">
                          This price is held for{' '}
                          <span className="tabular font-semibold text-ink-900">{countdown(quoteRemaining)}</span>.
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => void refreshPrice()}
                        className="font-semibold text-brand-700 underline underline-offset-2"
                      >
                        {quoteExpired ? 'Refresh price' : 'How we price'}
                      </button>
                    </div>

                    {quoteExpired ? (
                      <Banner tone="warn" className="mt-3">
                        The amount may change when you refresh. You will see the new total before you book.
                      </Banner>
                    ) : null}
                  </>
                ) : (
                  <ErrorPanel error={submitError} onRetry={() => void createParcelAndPrice()} />
                )}
              </Card>

              <Card>
                <SectionHeading
                  title="Travellers on your route"
                  description="Ranked by fit, not by who paid us. No phone number or exact address is shown."
                />

                {matches === null ? (
                  <div className="space-y-3">
                    {[0, 1, 2].map((i) => (
                      <Skeleton key={i} className="h-28 w-full" />
                    ))}
                  </div>
                ) : matches.matches.length === 0 ? (
                  <EmptyState
                    title="No traveller matches this route and time yet"
                    body="Widen your window, or we can tell you when someone posts a matching trip."
                    icon={<CarIcon size={22} />}
                    action={
                      <div className="flex flex-wrap justify-center gap-2">
                        <Button variant="secondary" onClick={() => setStep(2)}>
                          Widen window
                        </Button>
                        <Link to="/help">
                          <Button variant="tertiary">Notify me</Button>
                        </Link>
                      </div>
                    }
                  />
                ) : (
                  <div className="space-y-3">
                    {matches.low_confidence ? (
                      <Banner tone="warn" title="These are the closest we have">
                        Check the arrival time against your window before choosing.
                      </Banner>
                    ) : null}

                    {matches.matches.map((match) => (
                      <MatchCard
                        key={match.trip_id}
                        match={match}
                        selected={selectedTrip === match.trip_id}
                        onSelect={() => setSelectedTrip(match.trip_id)}
                      />
                    ))}
                  </div>
                )}
              </Card>

              {selectedMatch && quote && !quoteExpired ? (
                <div className="sticky bottom-20 z-20 md:bottom-4">
                  <div className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4 shadow-bar sm:flex-row sm:items-center sm:justify-between">
                    <div className="text-sm">
                      <p className="font-semibold text-ink-900">
                        {inr(quote.total_paise)} · {selectedMatch.traveller_first_name ?? 'Traveller'}{' '}
                        {selectedMatch.traveller_initial ? `${selectedMatch.traveller_initial}.` : ''}
                      </p>
                      <p className="text-ink-500">You pay on confirmation. Nothing is charged now.</p>
                    </div>
                    <Button size="lg" loading={bookingBusy} onClick={() => void book()}>
                      Request this traveller
                    </Button>
                  </div>
                </div>
              ) : null}

              {bookingError ? <ErrorPanel error={bookingError} onRetry={() => void book()} /> : null}
            </>
          )}

          <div className="flex items-center justify-between gap-3">
            <Button variant="secondary" onClick={() => setStep(2)}>
              Back
            </Button>
            <Link to="/bookings">
              <Button variant="tertiary">Save and finish later</Button>
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MatchCard({ match, selected, onSelect }: { match: Match; selected: boolean; onSelect: () => void }) {
  return (
    <div
      className={cn(
        'rounded-card border p-4 transition-colors',
        selected ? 'border-brand-600 bg-brand-50/60' : 'border-line bg-surface',
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-full bg-brand-100 text-sm font-bold text-brand-700">
            {(match.traveller_first_name?.[0] ?? 'T').toUpperCase()}
          </span>
          <div>
            <p className="text-sm font-semibold text-ink-900">
              {match.traveller_first_name ?? 'Traveller'}
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
          ) : null}
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
        <span>Indicative {inr(match.indicative_price_paise)}</span>
        {match.accepts_documents_only ? <span>Documents only</span> : null}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
        <ul className="flex flex-wrap gap-1.5">
          {match.reasons.slice(0, 3).map((reason) => (
            <li
              key={reason}
              className="rounded-full bg-surface px-2 py-0.5 text-xs text-ink-700 ring-1 ring-line"
            >
              {MATCH_REASON_LABELS[reason as keyof typeof MATCH_REASON_LABELS] ?? reason}
            </li>
          ))}
        </ul>
        <Button variant={selected ? 'primary' : 'secondary'} size="sm" onClick={onSelect}>
          {selected ? 'Selected' : 'Choose'}
        </Button>
      </div>
    </div>
  );
}
