import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";

import { CATEGORY_LABELS, type Category } from "@py/domain";

import { useCities, useConfig, useDocumentTitle } from "../lib/hooks";
import { useSession } from "../lib/session";
import { inr } from "../lib/format";
import { Button, Card, Field, Select, TextInput } from "../components/ui";
import { HeroBackdrop } from "../components/HeroBackdrop";
import {
  ArrowRightIcon,
  AwardIcon,
  CameraIcon,
  CarIcon,
  CoinsIcon,
  DocIcon,
  LockIcon,
  ParcelIcon,
  PhoneIcon,
  RouteIcon,
  SearchIcon,
  ShieldCheckIcon,
  SwapIcon,
  TagIcon,
} from "../components/icons";

const STEPS = [
  {
    icon: ParcelIcon,
    title: "Describe the parcel",
    body: "What is inside, how heavy it is, and the window it must arrive in. The price is calculated and shown before you pay.",
  },
  {
    icon: RouteIcon,
    title: "Match a traveller",
    body: "Verified travellers already driving your route, ranked on time window, capacity and reliability — with the reasons for each match.",
  },
  {
    icon: ShieldCheckIcon,
    title: "Hand over with a code",
    body: "A six-digit code at pickup and another at delivery. Both sides keep a photo of the sealed parcel.",
  },
];

const INCLUDED = [
  {
    icon: ShieldCheckIcon,
    title: "Verified travellers",
    body: "ID checked by a person before a trip goes live.",
  },
  {
    icon: CameraIcon,
    title: "Sealed-parcel photo",
    body: "Taken at pickup, so the condition is on record.",
  },
  {
    icon: LockIcon,
    title: "Code at both ends",
    body: "Nothing changes hands without the handover code.",
  },
  {
    icon: PhoneIcon,
    title: "Dispute support",
    body: "Raise a case for 72 hours after delivery.",
  },
];

const FEATURES = [
  {
    icon: ShieldCheckIcon,
    title: "Verified travellers",
    body: "Every traveller’s ID is checked by a person before their trip goes live.",
  },
  {
    icon: TagIcon,
    title: "Transparent pricing",
    body: "One price, calculated from weight and route, shown before anything is charged.",
  },
  {
    icon: LockIcon,
    title: "Secure handovers",
    body: "A code at pickup, a code at delivery, and a photo of the sealed parcel.",
  },
  {
    icon: RouteIcon,
    title: "Recorded status",
    body: "Each step lands on your booking. Live vehicle location is not offered.",
  },
];

/**
 * Each card points at a route that exists. The four sending cards preselect a real, offerable
 * category — `electronics` is prohibited at launch, so the closest honest one is low-value
 * accessories.
 */
const QUICK_LINKS: Array<{
  icon: typeof DocIcon;
  title: string;
  label: string;
  to: string;
}> = [
  {
    icon: DocIcon,
    title: "Documents",
    label: "Papers, contracts, invoices",
    to: "/send?category=documents",
  },
  {
    icon: AwardIcon,
    title: "Certificates",
    label: "Degrees, marksheets, transcripts",
    to: "/send?category=educational_certificates",
  },
  {
    icon: ParcelIcon,
    title: "Business samples",
    label: "Swatches, catalogues, dry parts",
    to: "/send?category=business_samples",
  },
  {
    icon: TagIcon,
    title: "Low-value accessories",
    label: "Cables, cases, chargers",
    to: "/send?category=electronics_accessories_low_value",
  },
  {
    icon: CoinsIcon,
    title: "Travelling & earning",
    label: "Carry a parcel on a trip you are making",
    to: "/trips/new",
  },
  {
    icon: SearchIcon,
    title: "Track a parcel",
    label: "Status and handover codes",
    to: "/bookings",
  },
];

export function Landing() {
  useDocumentTitle("");
  const { user } = useSession();
  const navigate = useNavigate();
  const { data: config } = useConfig();
  const cities = useCities();
  const limits = config?.limits;

  const serviceable = (cities.data ?? []).filter((city) => city.is_serviceable);

  const [originCityId, setOriginCityId] = useState("");
  const [destCityId, setDestCityId] = useState("");
  const [weight, setWeight] = useState("1.5");
  const [category, setCategory] = useState<Category>("documents");
  const [error, setError] = useState("");

  const maxWeight = limits?.max_weight_kg ?? 5;

  const viaAuth = (target: string) =>
    user ? target : `/login?next=${encodeURIComponent(target)}`;

  function swapCities() {
    setOriginCityId(destCityId);
    setDestCityId(originCityId);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (cities.isLoading || cities.isError) {
      setError("City list unavailable right now. Try again in a moment.");
      return;
    }
    if (!originCityId || !destCityId) {
      setError("Choose both cities to continue.");
      return;
    }
    if (originCityId === destCityId) {
      setError("Pickup and destination must be different cities.");
      return;
    }
    const w = Number(weight);
    if (!Number.isFinite(w) || w < 0.1 || w > maxWeight) {
      setError(`We carry between 0.1 and ${maxWeight} kg at launch.`);
      return;
    }
    const query = new URLSearchParams({
      origin: originCityId,
      dest: destCityId,
      weight: String(w),
      category,
    });
    const target = `/send?${query.toString()}`;
    navigate(user ? target : `/login?next=${encodeURIComponent(target)}`);
  }

  return (
    <div>
      <section className="hero-panel relative w-full px-4 pt-12 pb-28 sm:px-6 sm:pt-16 sm:pb-36">
        <HeroBackdrop />
        <div className="relative mx-auto w-full max-w-3xl text-center text-brand-900">
          <p className="inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold tracking-wide uppercase">
            Bareilly ⇄ Delhi NCR · Bareilly ⇄ Lucknow
          </p>
          <h1 className="mt-5 text-[34px] leading-[1.1] font-bold tracking-tight text-balance sm:text-5xl">
            Send it with{" "}
            <span className="text-brand-700">someone already going</span>.
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-ink-700 sm:text-lg">
            A small sealed parcel, carried by a verified traveller on a journey
            they were making anyway. You see the price, the person and the
            handover record before anything moves.
          </p>

          {limits ? (
            <dl className="mx-auto mt-8 grid max-w-2xl grid-cols-2 gap-x-8 gap-y-4 border-t border-brand-900/20 pt-6 text-sm sm:grid-cols-4">
              {[
                ["Weight", `${limits.max_weight_kg} kg`],
                ["Each side", `${limits.max_dimension_cm} cm`],
                ["Declared value", inr(limits.max_declared_value_paise)],
                ["Travel mode", "Car"],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs text-ink-700">{label}</dt>
                  <dd className="mt-1 font-semibold text-brand-900 tabular">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
        </div>

        <form
          onSubmit={submit}
          aria-label="Quick booking"
          className="relative mx-auto mt-9 w-full max-w-4xl rounded-sheet bg-surface p-4 text-ink-900 shadow-float sm:p-6"
        >
          <p className="text-xs font-semibold tracking-wide text-ink-500 uppercase">
            Book in under a minute
          </p>

          <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto_1fr] md:items-end">
            <Field label="Pickup city" htmlFor="hp-origin">
              <Select
                id="hp-origin"
                value={originCityId}
                onChange={(event) => {
                  setOriginCityId(event.target.value);
                  setError("");
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

            <div className="flex justify-center">
              <button
                type="button"
                onClick={swapCities}
                aria-label="Swap pickup and destination cities"
                className="inline-flex h-11 items-center gap-1.5 rounded-full border border-line-strong bg-canvas px-4 text-xs font-semibold text-ink-700 hover:border-ink-300 hover:text-ink-900"
              >
                <SwapIcon size={15} />
                Swap
              </button>
            </div>

            <Field label="Destination city" htmlFor="hp-dest">
              <Select
                id="hp-dest"
                value={destCityId}
                onChange={(event) => {
                  setDestCityId(event.target.value);
                  setError("");
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
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3">
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
                  setError("");
                }}
              />
            </Field>
            <Field label="Category" htmlFor="hp-category">
              <Select
                id="hp-category"
                value={category}
                onChange={(event) =>
                  setCategory(event.target.value as Category)
                }
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
            <p className="mt-3 text-sm text-danger-600" role="alert">
              {error}
            </p>
          ) : null}

          <Button
            type="submit"
            size="lg"
            fullWidth
            className="mt-4"
            disabled={cities.isLoading || cities.isError}
          >
            See price and travellers
            <ArrowRightIcon size={18} />
          </Button>

          <p className="mt-3 text-center text-xs leading-relaxed text-ink-500">
            Nothing is charged until you confirm a price. Next: the parcel
            photo, the time window, then a verified traveller.
          </p>
        </form>
      </section>

      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <section
          aria-labelledby="quick-links"
          className="relative z-10 -mt-16 sm:-mt-24"
        >
          <h2 id="quick-links" className="sr-only">
            What you can send or do
          </h2>
          <ul className="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-x-visible sm:px-0 md:grid-cols-3 lg:grid-cols-6">
            {QUICK_LINKS.map((link) => (
              <li
                key={link.title}
                className="w-[15rem] shrink-0 snap-start sm:w-auto"
              >
                <Link
                  to={viaAuth(link.to)}
                  className="flex h-full flex-col rounded-card border border-line bg-surface p-4 shadow-card transition-shadow hover:border-brand-200 hover:shadow-float"
                >
                  <span className="grid h-10 w-10 place-items-center rounded-full bg-brand-50 text-brand-700">
                    <link.icon size={19} />
                  </span>
                  <p className="mt-3 text-sm font-semibold text-ink-900">
                    {link.title}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-ink-500">
                    {link.label}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="why-py" className="mt-14 sm:mt-20">
          <div className="mx-auto max-w-2xl text-center">
            <h2
              id="why-py"
              className="text-2xl font-bold tracking-tight text-ink-900 text-balance sm:text-3xl"
            >
              Inter-city parcel delivery, made simpler
            </h2>
            <p className="mt-3 text-base leading-relaxed text-ink-500">
              Courier rates price a parcel like freight. A seat in a car already
              making the trip is not freight — so we price it as a handover
              between two people, and record both ends.
            </p>
            <span
              aria-hidden="true"
              className="mx-auto mt-5 block h-px w-48 bg-gradient-to-r from-transparent via-brand-200 to-transparent"
            />
          </div>

          <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((feature) => (
              <li key={feature.title}>
                <Card className="h-full">
                  <span className="grid h-10 w-10 place-items-center rounded-full bg-brand-50 text-brand-700">
                    <feature.icon size={19} />
                  </span>
                  <h3 className="mt-4 text-base font-semibold text-ink-900">
                    {feature.title}
                  </h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-ink-500">
                    {feature.body}
                  </p>
                </Card>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="how-it-works" className="mt-14 sm:mt-20">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-xs font-semibold tracking-wide text-brand-700 uppercase">
              How it works
            </p>
            <h2
              id="how-it-works"
              className="mt-2 text-2xl font-bold tracking-tight text-ink-900 text-balance sm:text-3xl"
            >
              Three steps, both sides recorded
            </h2>
          </div>
          <ol className="mt-8 grid gap-4 sm:grid-cols-3">
            {STEPS.map((step, index) => (
              <li key={step.title}>
                <Card className="h-full">
                  <span className="grid h-9 w-9 place-items-center rounded-full bg-brand-50 text-brand-700">
                    <step.icon size={18} />
                  </span>
                  <p className="mt-4 text-xs font-semibold text-ink-500 tabular">
                    Step {index + 1}
                  </p>
                  <h3 className="mt-1 text-base font-semibold text-ink-900">
                    {step.title}
                  </h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-ink-500">
                    {step.body}
                  </p>
                </Card>
              </li>
            ))}
          </ol>
        </section>

        <section
          aria-labelledby="what-you-get"
          className="mt-14 grid gap-4 lg:grid-cols-[1.05fr_0.95fr] sm:mt-20"
        >
          <Card>
            <h2
              id="what-you-get"
              className="text-lg font-semibold text-ink-900"
            >
              What every booking includes
            </h2>
            <ul className="mt-5 grid gap-5 sm:grid-cols-2">
              {INCLUDED.map((item) => (
                <li key={item.title} className="flex gap-3">
                  <item.icon
                    size={18}
                    className="mt-0.5 shrink-0 text-brand-700"
                  />
                  <div>
                    <p className="text-sm font-semibold text-ink-900">
                      {item.title}
                    </p>
                    <p className="mt-0.5 text-sm leading-relaxed text-ink-500">
                      {item.body}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <h2 className="text-lg font-semibold text-ink-900">
              What we don’t carry
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-ink-500">
              No cash, jewellery, medicines, electronics or passports. The list
              is short and specific, and it is enforced when you describe a
              parcel.
            </p>
            <p className="mt-4 text-sm leading-relaxed text-ink-500">
              <strong className="font-semibold text-ink-900">
                Your parcel is not insured.
              </strong>{" "}
              Until cover exists, if something goes wrong we help you
              investigate and may offer a goodwill amount — we cannot repay the
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

        <section className="mt-14 space-y-4 sm:mt-20">
          <Card className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <SearchIcon
                size={20}
                className="mt-0.5 shrink-0 text-brand-700"
              />
              <div>
                <h2 className="text-lg font-semibold text-ink-900">
                  Where is my parcel?
                </h2>
                <p className="mt-1 max-w-xl text-sm leading-relaxed text-ink-500">
                  Sign in to see every booking, the handover codes and the
                  current status.
                </p>
              </div>
            </div>
            <Link to={viaAuth("/bookings")} className="shrink-0">
              <Button variant="secondary">Track a parcel</Button>
            </Link>
          </Card>

          <Card className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <CarIcon size={20} className="mt-0.5 shrink-0 text-brand-700" />
              <div>
                <h2 className="text-lg font-semibold text-ink-900">
                  Already driving that way?
                </h2>
                <p className="mt-1 max-w-xl text-sm leading-relaxed text-ink-500">
                  Carry a small sealed parcel on a trip you were making anyway.
                  You’re paid after delivery, once the dispute window has
                  passed.
                </p>
              </div>
            </div>
            <Link to={viaAuth("/trips/new")} className="shrink-0">
              <Button variant="secondary" size="lg">
                Post a trip
              </Button>
            </Link>
          </Card>
        </section>
      </div>
    </div>
  );
}
