import { Link } from 'react-router-dom';

import { useDocumentTitle } from '../lib/hooks';
import { useSession } from '../lib/session';
import { Button, Card } from '../components/ui';
import { RouteLine } from '../components/RouteLine';
import {
  ArrowRightIcon,
  CameraIcon,
  CarIcon,
  DocIcon,
  LockIcon,
  ParcelIcon,
  PhoneIcon,
  ShieldCheckIcon,
} from '../components/icons';

const STEPS = [
  {
    icon: DocIcon,
    title: 'Declare it',
    body: 'What is inside, how heavy it is, and the window it must arrive in. We show the exact price before you pay.',
  },
  {
    icon: CarIcon,
    title: 'Match it',
    body: 'We find a verified traveller already driving your route. You see why each one matched.',
  },
  {
    icon: PhoneIcon,
    title: 'Hand it over',
    body: 'A six-digit code at pickup and another at delivery. Both sides have a photo of the sealed parcel.',
  },
];

const TRUST = [
  { icon: ShieldCheckIcon, title: 'Verified travellers', body: 'ID checked by a person before a trip goes live.' },
  { icon: CameraIcon, title: 'Sealed-parcel photo', body: 'Taken at pickup, so the condition is on record.' },
  { icon: LockIcon, title: 'OTP at both ends', body: 'Nothing changes hands without the code.' },
  { icon: PhoneIcon, title: 'Dispute support', body: 'Raise a case for 72 hours after delivery.' },
];

export function Landing() {
  useDocumentTitle('');
  const { user } = useSession();

  return (
    <div className="space-y-10">
      <section className="hero-gradient relative overflow-hidden rounded-sheet px-5 py-10 text-white sm:px-10 sm:py-14">
        <div
          className="pointer-events-none absolute -top-24 -right-24 h-72 w-72 rounded-full border border-white/10"
          aria-hidden="true"
        />
        <div
          className="pointer-events-none absolute -right-8 bottom-0 h-48 w-48 rounded-full border border-accent-500/20"
          aria-hidden="true"
        />

        <div className="relative grid gap-10 lg:grid-cols-[1.15fr_0.85fr] lg:items-center">
          <div>
            <p className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-3 py-1 text-xs font-semibold text-white/80">
              <span className="h-1.5 w-1.5 rounded-full bg-accent-500" aria-hidden="true" />
              Pilot corridors · Bareilly ⇄ Delhi NCR · Bareilly ⇄ Lucknow
            </p>

            <h1 className="max-w-xl text-[34px] leading-[1.1] font-bold tracking-tight text-balance sm:text-5xl">
              Send it with someone already going.
            </h1>

            <p className="mt-4 max-w-lg text-base text-white/75 sm:text-lg">
              A small sealed parcel, carried by a verified traveller on a journey they were making anyway. You
              see the price, the person and the handover record before anything moves.
            </p>

            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <Link to={user ? '/send' : '/login?next=/send'}>
                <Button size="lg" fullWidth className="sm:w-auto">
                  Send a parcel
                  <ArrowRightIcon size={18} />
                </Button>
              </Link>
              <Link to={user ? '/trips/new' : '/login?next=/trips/new'}>
                <Button
                  size="lg"
                  fullWidth
                  variant="secondary"
                  className="border-white/25 bg-white/5 text-white hover:border-white/60 hover:bg-white/10 sm:w-auto"
                >
                  I’m travelling
                </Button>
              </Link>
            </div>

            <p className="mt-4 text-xs text-white/55">
              Prices are shown after you describe the parcel — we don’t publish a number we can’t stand behind.
            </p>
          </div>

          <div className="rounded-card border border-white/15 bg-white/[0.06] p-5 backdrop-blur-sm">
            <p className="mb-4 text-xs font-semibold tracking-wide text-white/60 uppercase">A typical booking</p>
            <RouteLine from="Bareilly" to="Delhi" meta="Documents · up to 5 kg" dark />
            <dl className="mt-5 space-y-3 border-t border-white/15 pt-4 text-sm">
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-white/60">Traveller</dt>
                <dd className="font-semibold text-white">Verified · car</dd>
              </div>
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-white/60">Handover</dt>
                <dd className="font-semibold text-white">Code at both ends</dd>
              </div>
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-white/60">Tracking</dt>
                <dd className="font-semibold text-white">Status updates, no live map</dd>
              </div>
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-white/60">Insurance</dt>
                <dd className="font-semibold text-accent-500">Not insured</dd>
              </div>
            </dl>
          </div>
        </div>
      </section>

      <section aria-labelledby="how-it-works">
        <h2 id="how-it-works" className="text-2xl font-bold tracking-tight text-ink-900">
          Three steps, both sides recorded
        </h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          {STEPS.map((step, index) => (
            <Card key={step.title} className="flex h-full flex-col">
              <div className="mb-4 flex items-center justify-between">
                <span className="grid h-10 w-10 place-items-center rounded-input bg-brand-50 text-brand-700">
                  <step.icon size={22} />
                </span>
                <span className="tabular text-sm font-bold text-ink-300">0{index + 1}</span>
              </div>
              <h3 className="text-base font-semibold text-ink-900">{step.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-500">{step.body}</p>
            </Card>
          ))}
        </div>
      </section>

      <section aria-labelledby="what-you-get" className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
        <Card>
          <h2 id="what-you-get" className="text-lg font-semibold text-ink-900">
            What every booking includes
          </h2>
          <ul className="mt-4 grid gap-4 sm:grid-cols-2">
            {TRUST.map((item) => (
              <li key={item.title} className="flex gap-3">
                <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-50 text-brand-700">
                  <item.icon size={18} />
                </span>
                <div>
                  <p className="text-sm font-semibold text-ink-900">{item.title}</p>
                  <p className="mt-0.5 text-sm text-ink-500">{item.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </Card>

        <div className="space-y-4">
          <Card className="border-danger-600/25 bg-danger-50">
            <div className="flex gap-3">
              <ParcelIcon size={22} className="mt-0.5 shrink-0 text-danger-600" />
              <div>
                <h2 className="text-base font-semibold text-ink-900">We don’t carry everything</h2>
                <p className="mt-1 text-sm text-ink-700">
                  No cash, jewellery, medicines, electronics or passports. The full list is short and specific.
                </p>
                <Link
                  to="/prohibited"
                  className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-danger-600 underline underline-offset-4"
                >
                  Read the prohibited items list
                  <ArrowRightIcon size={15} />
                </Link>
              </div>
            </div>
          </Card>

          <Card>
            <h2 className="text-base font-semibold text-ink-900">Pilot limits</h2>
            <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
              {[
                ['Weight', '5 kg'],
                ['Each side', '45 cm'],
                ['Declared value', '₹5,000'],
                ['Travel mode', 'Car only'],
              ].map(([label, value]) => (
                <div key={label} className="rounded-input bg-canvas px-3 py-2">
                  <dt className="text-xs text-ink-500">{label}</dt>
                  <dd className="mt-0.5 font-semibold text-ink-900">{value}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-sm text-ink-500">
              <strong className="font-semibold text-ink-900">Your parcel is not insured.</strong> We’re working on
              cover. Until it exists, if something goes wrong we can help you investigate and may offer a goodwill
              amount, but we cannot repay the full value.
            </p>
          </Card>
        </div>
      </section>

      <section className="rounded-card border border-line bg-surface p-6 sm:p-8">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-ink-900">Already driving that way?</h2>
            <p className="mt-1 max-w-xl text-sm text-ink-500">
              Carry a small sealed parcel on a trip you were making anyway. Get paid after delivery, once the
              problem window has passed.
            </p>
          </div>
          <Link to={user ? '/trips/new' : '/login?next=/trips/new'}>
            <Button variant="secondary" size="lg">
              Post a trip
            </Button>
          </Link>
        </div>
      </section>
    </div>
  );
}
