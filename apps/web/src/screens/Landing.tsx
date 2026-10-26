import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { CATEGORY_LABELS, type Category } from '@py/domain';

import { useCities, useConfig, useDocumentTitle } from '../lib/hooks';
import { useSession } from '../lib/session';
import { inr } from '../lib/format';
import { Button, Card, Field, Select, TextInput } from '../components/ui';
import {
  ArrowRightIcon,
  CameraIcon,
  CarIcon,
  LockIcon,
  ParcelIcon,
  PhoneIcon,
  RouteIcon,
  SearchIcon,
  ShieldCheckIcon,
  SwapIcon,
} from '../components/icons';

const STEPS = [
  {
    icon: ParcelIcon,
    title: 'Describe the parcel',
    body: 'What is inside, how heavy it is, and the window it must arrive in. The price is calculated and shown before you pay.',
  },
  {
    icon: RouteIcon,
    title: 'Match a traveller',
    body: 'Verified travellers already driving your route, ranked on time window, capacity and reliability — with the reasons for each match.',
  },
  {
    icon: ShieldCheckIcon,
    title: 'Hand over with a code',
    body: 'A six-digit code at pickup and another at delivery. Both sides keep a photo of the sealed parcel.',
  },
];

const INCLUDED = [
  { icon: ShieldCheckIcon, title: 'Verified travellers', body: 'ID checked by a person before a trip goes live.' },
  { icon: CameraIcon, title: 'Sealed-parcel photo', body: 'Taken at pickup, so the condition is on record.' },
  { icon: LockIcon, title: 'Code at both ends', body: 'Nothing changes hands without the handover code.' },
  { icon: PhoneIcon, title: 'Dispute support', body: 'Raise a case for 72 hours after delivery.' },
];

export function Landing() {
  useDocumentTitle('');
  const { user } = useSession();
  const navigate = useNavigate();
  const { data: config } = useConfig();
  const cities = useCities();
  const limits = config?.limits;

  const serviceable = (cities.data ?? []).filter((city) => city.is_serviceable);

  const [originCityId, setOriginCityId] = useState('');
  const [destCityId, setDestCityId] = useState('');
  const [weight, setWeight] = useState('1.5');
  const [category, setCategory] = useState<Category>('documents');
  const [error, setError] = useState('');

  const maxWeight = limits?.max_weight_kg ?? 5;

  function swapCities() {
    setOriginCityId(destCityId);
    setDestCityId(originCityId);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (cities.isLoading || cities.isError) {
      setError('City list unavailable right now. Try again in a moment.');
      return;
    }
    if (!originCityId || !destCityId) {
      setError('Choose both cities to continue.');
      return;
    }
    if (originCityId === destCityId) {
      setError('Pickup and destination must be different cities.');
      return;
    }
    const w = Number(weight);
    if (!Number.isFinite(w) || w < 0.1 || w > maxWeight) {
      setError(`We carry between 0.1 and ${maxWeight} kg at launch.`);
      return;
    }
    const query = new URLSearchParams({ origin: originCityId, dest: destCityId, weight: String(w), category });
    const target = `/send?${query.toString()}`;
    navigate(user ? target : `/login?next=${encodeURIComponent(target)}`);
  }

  return (
    <div className="space-y-12">
      <section
        className="relative -mx-[calc((100svw-100%)/2)] -mt-8 bg-brand-900 bg-cover bg-center bg-no-repeat px-4 sm:px-6"
        style={{ backgroundImage: 'url("/hero-background.png")' }}
      >
        <div aria-hidden="true" className="absolute inset-0 bg-brand-900/25" />
        <div className="relative mx-auto w-full max-w-6xl hero-gradient rounded-t-sheet px-6 py-10 text-white sm:px-10 sm:py-14 lg:grid lg:grid-cols-[1.05fr_1fr] lg:items-center lg:gap-12">
          <div>
            <p className="text-xs font-medium tracking-wide text-white/60 uppercase">
              Bareilly ⇄ Delhi NCR · Bareilly ⇄ Lucknow
            </p>
            <h1 className="mt-3 max-w-2xl text-[34px] leading-[1.12] font-bold tracking-tight text-balance sm:text-5xl">
              Send it with someone already going.
            </h1>
            <p className="mt-4 max-w-xl text-base leading-relaxed text-white/75 sm:text-lg">
              A small sealed parcel, carried by a verified traveller on a journey they were making anyway. You see the
              price, the person and the handover record before anything moves.
            </p>

            {limits ? (
              <dl className="mt-8 grid max-w-2xl grid-cols-2 gap-x-8 gap-y-4 border-t border-white/12 pt-6 text-sm sm:grid-cols-4">
                {[
                  ['Weight', `${limits.max_weight_kg} kg`],
                  ['Each side', `${limits.max_dimension_cm} cm`],
                  ['Declared value', inr(limits.max_declared_value_paise)],
                  ['Travel mode', 'Car'],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-xs text-white/55">{label}</dt>
                    <dd className="mt-1 font-semibold text-white tabular">{value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </div>

          <form
            onSubmit={submit}
            aria-label="Quick booking"
            className="mt-10 rounded-card bg-surface p-5 text-ink-900 shadow-card sm:p-6 lg:mt-0"
          >
            <p className="text-xs font-medium tracking-wide text-ink-500 uppercase">Book in under a minute</p>
            <h2 className="mt-1 text-lg font-semibold">Where is it going?</h2>

            <div className="mt-4 space-y-4">
              <Field label="Pickup city" htmlFor="hp-origin">
                <Select
                  id="hp-origin"
                  value={originCityId}
                  onChange={(event) => {
                    setOriginCityId(event.target.value);
                    setError('');
                  }}
                >
                  <option value="">Choose a city</option>
                  {serviceable.map((city) => (
                    <option key={city.id} value={city.id}>
                      {city.name}
                    </option>
                  ))}
                </Select>
              </Field>

              <div className="flex items-center gap-3" aria-hidden="true">
                <span className="h-px flex-1 bg-line" />
                <button
                  type="button"
                  onClick={swapCities}
                  className="inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-canvas px-2.5 py-1 text-xs font-semibold text-ink-700 hover:border-ink-300 hover:text-ink-900"
                >
                  <SwapIcon size={14} />
                  Swap
                </button>
              </div>

              <Field label="Destination city" htmlFor="hp-dest">
                <Select
                  id="hp-dest"
                  value={destCityId}
                  onChange={(event) => {
                    setDestCityId(event.target.value);
                    setError('');
                  }}
                >
                  <option value="">Choose a city</option>
                  {serviceable.map((city) => (
                    <option key={city.id} value={city.id}>
                      {city.name}
                    </option>
                  ))}
                </Select>
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Weight (kg)" htmlFor="hp-weight">
                  <TextInput
                    id="hp-weight"
                    type="number"
                    inputMode="decimal"
                    min={0.1}
                    max={maxWeight}
                    step={0.1}
                    value={weight}
                    onChange={(event) => {
                      setWeight(event.target.value);
                      setError('');
                    }}
                  />
                </Field>
                <Field label="Category" htmlFor="hp-category">
                  <Select
                    id="hp-category"
                    value={category}
                    onChange={(event) => setCategory(event.target.value as Category)}
                  >
                    {(config?.categories ?? []).map((value) => (
                      <option key={value} value={value}>
                        {CATEGORY_LABELS[value as Category]}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>

              {error ? (
                <p className="text-sm text-danger-600" role="alert">
                  {error}
                </p>
              ) : null}

              <Button type="submit" size="lg" fullWidth disabled={cities.isLoading || cities.isError}>
                See price and travellers
                <ArrowRightIcon size={18} />
              </Button>

              <p className="text-center text-xs leading-relaxed text-ink-500">
                Nothing is charged until you confirm a price. Next: the parcel photo, the time window, then a
                verified traveller.
              </p>
            </div>
          </form>
        </div>
      </section>

      <section aria-labelledby="how-it-works">
        <h2 id="how-it-works" className="text-2xl font-bold tracking-tight text-ink-900">
          Three steps, both sides recorded
        </h2>
        <ol className="mt-6 grid gap-px overflow-hidden rounded-card border border-line bg-line sm:grid-cols-3">
          {STEPS.map((step, index) => (
            <li key={step.title} className="bg-surface p-5 sm:p-6">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-brand-50 text-brand-700">
                <step.icon size={18} />
              </span>
              <p className="mt-4 tabular text-xs font-semibold text-ink-500">Step {index + 1}</p>
              <h3 className="mt-1 text-base font-semibold text-ink-900">{step.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-500">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="what-you-get" className="grid gap-5 lg:grid-cols-[1.05fr_0.95fr]">
        <Card>
          <h2 id="what-you-get" className="text-lg font-semibold text-ink-900">
            What every booking includes
          </h2>
          <ul className="mt-5 grid gap-5 sm:grid-cols-2">
            {INCLUDED.map((item) => (
              <li key={item.title} className="flex gap-3">
                <item.icon size={18} className="mt-0.5 shrink-0 text-brand-700" />
                <div>
                  <p className="text-sm font-semibold text-ink-900">{item.title}</p>
                  <p className="mt-0.5 text-sm leading-relaxed text-ink-500">{item.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold text-ink-900">What we don’t carry</h2>
          <p className="mt-2 text-sm leading-relaxed text-ink-500">
            No cash, jewellery, medicines, electronics or passports. The list is short and specific, and it is
            enforced when you describe a parcel.
          </p>
          <p className="mt-4 text-sm leading-relaxed text-ink-500">
            <strong className="font-semibold text-ink-900">Your parcel is not insured.</strong> Until cover exists,
            if something goes wrong we help you investigate and may offer a goodwill amount — we cannot repay the
            full value.
          </p>
          <Link
            to="/prohibited"
            className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-brand-700 underline underline-offset-4"
          >
            Read the prohibited items list
            <ArrowRightIcon size={15} />
          </Link>
        </Card>
      </section>

      <section className="space-y-5">
        <Card className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <SearchIcon size={20} className="mt-0.5 shrink-0 text-brand-700" />
            <div>
              <h2 className="text-lg font-semibold text-ink-900">Where is my parcel?</h2>
              <p className="mt-1 max-w-xl text-sm leading-relaxed text-ink-500">
                Sign in to see every booking, the handover codes and the current status.
              </p>
            </div>
          </div>
          <Link to={user ? '/bookings' : '/login?next=/bookings'} className="shrink-0">
            <Button variant="secondary">Track a parcel</Button>
          </Link>
        </Card>

        <Card className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <CarIcon size={20} className="mt-0.5 shrink-0 text-brand-700" />
            <div>
              <h2 className="text-lg font-semibold text-ink-900">Already driving that way?</h2>
              <p className="mt-1 max-w-xl text-sm leading-relaxed text-ink-500">
                Carry a small sealed parcel on a trip you were making anyway. You’re paid after delivery, once the
                dispute window has passed.
              </p>
            </div>
          </div>
          <Link to={user ? '/trips/new' : '/login?next=/trips/new'} className="shrink-0">
            <Button variant="secondary" size="lg">
              Post a trip
            </Button>
          </Link>
        </Card>
      </section>
    </div>
  );
}
