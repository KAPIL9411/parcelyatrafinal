import { Link } from "react-router-dom";

import { APP_DOWNLOAD_READY } from "../lib/app-download";
import { useDocumentTitle } from "../lib/hooks";
import { DownloadButton } from "../components/DownloadButton";
import { PhoneMockup, PhonePreview } from "../components/PhoneMockup";
import { Card } from "../components/ui";
import {
  ArrowRightIcon,
  CameraIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  CoinsIcon,
  LockIcon,
  ParcelIcon,
  RouteIcon,
  ShieldCheckIcon,
  TagIcon,
} from "../components/icons";

const TRUST = [
  { icon: ShieldCheckIcon, label: "Verified travellers" },
  { icon: CameraIcon, label: "Sealed-parcel photo" },
  { icon: LockIcon, label: "A code at both ends" },
];

const STEPS = [
  {
    icon: ParcelIcon,
    title: "Describe the parcel",
    body: "What is inside, how heavy it is and the window it must arrive in. The price is calculated and shown before you pay.",
  },
  {
    icon: RouteIcon,
    title: "Match a traveller",
    body: "Verified travellers already driving your route, ranked on time window, capacity and reliability — with the reasons for each match.",
  },
  {
    icon: LockIcon,
    title: "Hand over with a code",
    body: "A six-digit code at pickup and another at delivery. Both sides keep a photo of the sealed parcel.",
  },
];

const FEATURES = [
  {
    icon: ShieldCheckIcon,
    title: "Verified travellers",
    body: "One photo ID and a selfie, checked by a person before a trip can go live. Aadhaar is never accepted.",
  },
  {
    icon: TagIcon,
    title: "Transparent pricing",
    body: "One price, calculated from route, weight and category, with GST as its own line. You see it before anything is charged.",
  },
  {
    icon: LockIcon,
    title: "Secure handovers",
    body: "A code at pickup, a code at delivery, and a photo of the sealed parcel kept on the booking.",
  },
  {
    icon: RouteIcon,
    title: "Recorded status",
    body: "Every update from the sender and the traveller lands on the booking. Live vehicle location is not offered.",
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
    icon: ParcelIcon,
    title: "A written history",
    body: "Each status change stays attached to the booking.",
  },
];

const FAQ = [
  {
    q: "Where does Parcel Yatra run?",
    a: "At launch, parcels move on the Bareilly ⇄ Delhi NCR and Bareilly ⇄ Lucknow corridors. More routes open as travellers publish trips.",
  },
  {
    q: "What can I send?",
    a: "Documents, educational certificates, business samples, dry spare parts, sealed cosmetics and low-value accessories. The limits are 5 kg, 45 cm on each side and ₹5,000 declared value.",
  },
  {
    q: "Is my parcel insured?",
    a: "No. Cover does not exist in this build. If something goes wrong you can raise a problem within 72 hours of delivery; we investigate and may offer a goodwill amount, but we cannot repay the full value.",
  },
  {
    q: "How are travellers verified?",
    a: "A person checks one photo ID and a selfie before a trip can be published. A traveller can always refuse a parcel at the door if the seal is broken or the weight does not match.",
  },
  {
    q: "How is the price calculated?",
    a: "The server prices the route, weight, category and platform fee, and shows GST separately. The quote is held for a short window and is exactly what you pay.",
  },
  {
    q: "Where do I get the app?",
    a: "The Android app is the product. The direct download link is being finalised and will appear on this page as soon as it is available.",
  },
  {
    q: "Do you track my parcel live?",
    a: "No. Status updates come from the people involved, not from a live map. Each update is recorded on the booking.",
  },
];

export function Landing() {
  useDocumentTitle("Parcels carried by travellers between cities");

  return (
    <div>
      <section className="site-hero relative overflow-hidden">
        <div className="mx-auto grid w-full max-w-6xl gap-12 px-4 pt-12 pb-16 sm:px-6 sm:pt-16 sm:pb-20 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:gap-10">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-brand-200 bg-surface/80 px-3 py-1 text-xs font-semibold text-brand-700 backdrop-blur">
              <span className="h-1.5 w-1.5 rounded-full bg-accent-500" />
              Android app · inter-city parcels
            </p>

            <h1 className="mt-5 text-[2.15rem] leading-[1.08] font-bold tracking-tight text-ink-900 text-balance sm:text-5xl lg:text-[3.4rem]">
              Your parcel rides with{" "}
              <span className="text-brand-700">someone already going</span>.
            </h1>

            <p className="mt-5 max-w-xl text-base leading-relaxed text-ink-700 sm:text-lg">
              Parcel Yatra matches a small, sealed parcel with a verified
              traveller on a journey they were making anyway. Price before you
              pay, a code at pickup, a code at delivery, and the sealed-parcel
              photo on record.
            </p>

            <div className="mt-7 flex flex-wrap items-center gap-3">
              <DownloadButton size="lg" />
              <a
                href="#how-it-works"
                className="inline-flex h-12 items-center gap-2 rounded-input px-2 text-[15px] font-semibold text-brand-700 hover:underline hover:underline-offset-4"
              >
                See how it works
                <ArrowRightIcon size={17} />
              </a>
            </div>

            <p className="mt-3 max-w-md text-xs leading-relaxed text-ink-500">
              {APP_DOWNLOAD_READY
                ? "Android · direct download. Posting, matching and handover codes all live in the app."
                : "The direct Android download link is being finalised and will be published here. This page explains how the service works in the meantime."}
            </p>

            <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2.5">
              {TRUST.map((item) => (
                <li
                  key={item.label}
                  className="flex items-center gap-2 text-sm font-medium text-ink-700"
                >
                  <item.icon size={17} className="shrink-0 text-success-600" />
                  {item.label}
                </li>
              ))}
            </ul>
          </div>

          <div className="relative">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-1/2 h-[26rem] w-[26rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-200/50 blur-3xl"
            />
            <PhoneMockup screen="home" className="relative" />

            <div className="absolute top-24 -left-2 hidden rounded-xl border border-line bg-surface/95 px-3 py-2 shadow-float backdrop-blur sm:block lg:-left-6">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold text-ink-900">
                <LockIcon size={13} className="text-success-600" />
                Pickup code verified
              </p>
              <p className="mt-0.5 text-[10px] text-ink-500">
                Bareilly · sealed and photographed
              </p>
            </div>

            <div className="absolute right-0 bottom-20 hidden rounded-xl border border-line bg-surface/95 px-3 py-2 shadow-float backdrop-blur sm:block lg:-right-4">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold text-ink-900">
                <ShieldCheckIcon size={13} className="text-brand-600" />
                Verified traveller
              </p>
              <p className="mt-0.5 text-[10px] text-ink-500">
                Delhi NCR · trip published
              </p>
            </div>
          </div>
        </div>
      </section>

      <div className="border-y border-line bg-surface">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-center gap-x-8 gap-y-2 px-4 py-3 text-xs font-medium text-ink-700 sm:px-6">
          <span className="text-[11px] font-bold tracking-wide text-ink-500 uppercase">
            Open at launch
          </span>
          <span className="flex items-center gap-1.5">
            <RouteIcon size={14} className="text-brand-700" />
            Bareilly ⇄ Delhi NCR
          </span>
          <span className="flex items-center gap-1.5">
            <RouteIcon size={14} className="text-brand-700" />
            Bareilly ⇄ Lucknow
          </span>
          <span className="flex items-center gap-1.5">
            <CoinsIcon size={14} className="text-brand-700" />
            5 kg · 45 cm · ₹5,000 declared value
          </span>
        </div>
      </div>

      <section id="app" className="scroll-mt-20 bg-canvas py-16 sm:py-20">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-xs font-semibold tracking-wide text-brand-700 uppercase">
              The app is the product
            </p>
            <h2 className="mt-2 text-2xl font-bold tracking-tight text-ink-900 text-balance sm:text-3xl">
              The whole journey lives on your phone
            </h2>
            <p className="mt-3 text-base leading-relaxed text-ink-500">
              Posting, matching and handovers happen in the Android app. This
              website is the introduction — there is no booking form here.
            </p>
          </div>

          <div className="no-scrollbar mt-10 -mx-4 flex snap-x snap-mandatory gap-8 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0 lg:grid lg:grid-cols-3 lg:overflow-visible">
            {(["home", "send", "track"] as const).map((screen) => (
              <div
                key={screen}
                className="w-[268px] shrink-0 snap-center lg:w-auto"
              >
                <PhonePreview screen={screen} />
              </div>
            ))}
          </div>

          <p className="mt-8 text-center text-xs text-ink-500 lg:hidden">
            Swipe to see all three screens.
          </p>
          <p className="mt-2 text-center text-xs text-ink-500">
            Illustrative screens of the Android app. Real screenshots will
            replace them.
          </p>
        </div>
      </section>

      <section
        id="how-it-works"
        className="scroll-mt-20 py-16 sm:py-20"
      >
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-xs font-semibold tracking-wide text-brand-700 uppercase">
              How it works
            </p>
            <h2 className="mt-2 text-2xl font-bold tracking-tight text-ink-900 text-balance sm:text-3xl">
              Three steps, both sides recorded
            </h2>
            <p className="mt-3 text-base leading-relaxed text-ink-500">
              The sender and the traveller each confirm the handover. Nothing
              depends on a phone call or a guess.
            </p>
          </div>

          <ol className="mt-10 grid gap-4 sm:grid-cols-3">
            {STEPS.map((step, index) => (
              <li key={step.title}>
                <Card className="h-full">
                  <div className="flex items-center justify-between">
                    <span className="grid h-10 w-10 place-items-center rounded-full bg-brand-50 text-brand-700">
                      <step.icon size={19} />
                    </span>
                    <span className="tabular text-3xl font-bold text-brand-100">
                      0{index + 1}
                    </span>
                  </div>
                  <h3 className="mt-4 text-base font-semibold text-ink-900">
                    {step.title}
                  </h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-ink-500">
                    {step.body}
                  </p>
                </Card>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="border-y border-line bg-brand-50/60 py-16 sm:py-20">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-xs font-semibold tracking-wide text-brand-700 uppercase">
              Why Parcel Yatra
            </p>
            <h2 className="mt-2 text-2xl font-bold tracking-tight text-ink-900 text-balance sm:text-3xl">
              Built for a handover, not a warehouse
            </h2>
            <p className="mt-3 text-base leading-relaxed text-ink-500">
              A seat in a car already making the trip is not freight. We price
              it as a handover between two people — and record both ends.
            </p>
          </div>

          <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((feature) => (
              <li key={feature.title}>
                <div className="h-full rounded-card border border-line bg-surface p-5">
                  <span className="grid h-10 w-10 place-items-center rounded-full bg-brand-50 text-brand-700">
                    <feature.icon size={19} />
                  </span>
                  <h3 className="mt-4 text-base font-semibold text-ink-900">
                    {feature.title}
                  </h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-ink-500">
                    {feature.body}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section id="safety" className="scroll-mt-20 py-16 sm:py-20">
        <div className="mx-auto grid w-full max-w-6xl gap-4 px-4 sm:px-6 lg:grid-cols-[1.05fr_0.95fr]">
          <Card>
            <h2 className="text-lg font-semibold text-ink-900">
              Built into every booking
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

            <Link
              to="/safety"
              className="mt-6 inline-flex items-center gap-1 text-sm font-semibold text-brand-700 underline underline-offset-4"
            >
              How a handover works
              <ArrowRightIcon size={15} />
            </Link>
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
              className="mt-6 inline-flex items-center gap-1 text-sm font-semibold text-brand-700 underline underline-offset-4"
            >
              Read the prohibited items list
              <ArrowRightIcon size={15} />
            </Link>
          </Card>
        </div>

        <div className="mx-auto mt-4 w-full max-w-6xl px-4 sm:px-6">
          <Card className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <CoinsIcon
                size={20}
                className="mt-0.5 shrink-0 text-brand-700"
              />
              <div>
                <h2 className="text-lg font-semibold text-ink-900">
                  One price, before you pay
                </h2>
                <p className="mt-1 max-w-xl text-sm leading-relaxed text-ink-500">
                  Route, weight, category and platform fee — each its own line,
                  with GST shown separately. No hidden “convenience” charge
                  appears at payment.
                </p>
              </div>
            </div>
            <Link
              to="/pricing"
              className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-brand-700 underline underline-offset-4"
            >
              See pricing
              <ArrowRightIcon size={15} />
            </Link>
          </Card>
        </div>
      </section>

      <section id="faq" className="scroll-mt-20 border-t border-line bg-canvas py-16 sm:py-20">
        <div className="mx-auto w-full max-w-3xl px-4 sm:px-6">
          <div className="text-center">
            <p className="text-xs font-semibold tracking-wide text-brand-700 uppercase">
              Questions
            </p>
            <h2 className="mt-2 text-2xl font-bold tracking-tight text-ink-900 text-balance sm:text-3xl">
              Straight answers before you download
            </h2>
          </div>

          <div className="mt-8 space-y-3">
            {FAQ.map((item) => (
              <details
                key={item.q}
                className="group rounded-card border border-line bg-surface px-5 py-4 shadow-card open:border-brand-200"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-semibold text-ink-900 [&::-webkit-details-marker]:hidden">
                  {item.q}
                  <ChevronDownIcon
                    size={18}
                    className="shrink-0 text-ink-500 transition-transform group-open:rotate-180"
                  />
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-ink-500">
                  {item.a}
                </p>
              </details>
            ))}
          </div>

          <p className="mt-6 text-center text-sm text-ink-500">
            Still stuck?{" "}
            <Link
              to="/help"
              className="font-semibold text-brand-700 underline underline-offset-4"
            >
              Read the help page
            </Link>
            .
          </p>
        </div>
      </section>

      <section id="download" className="scroll-mt-20 px-4 py-16 sm:px-6 sm:py-20">
        <div className="relative mx-auto w-full max-w-6xl overflow-hidden rounded-sheet bg-brand-900 px-6 py-12 text-white sm:px-12 sm:py-16">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-24 -right-24 h-72 w-72 rounded-full bg-brand-600/40 blur-3xl"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -bottom-32 -left-16 h-72 w-72 rounded-full bg-accent-500/20 blur-3xl"
          />

          <div className="relative grid gap-10 lg:grid-cols-[1.15fr_0.85fr] lg:items-center">
            <div>
              <p className="text-xs font-semibold tracking-wide text-brand-200 uppercase">
                Get the app
              </p>
              <h2 className="mt-2 text-3xl font-bold tracking-tight text-balance sm:text-4xl">
                Ready when you are.
              </h2>
              <p className="mt-3 max-w-lg text-sm leading-relaxed text-brand-100 sm:text-base">
                Post a parcel, follow each update and keep both handover codes
                in one place. The app is where the journey happens — this page is
                just the front door.
              </p>

              <div className="mt-7 flex flex-wrap items-center gap-4">
                <DownloadButton tone="inverse" size="lg" />
                <Link
                  to="/help"
                  className="text-sm font-semibold text-brand-100 underline underline-offset-4 hover:text-white"
                >
                  Questions? Read the help page
                </Link>
              </div>

              {!APP_DOWNLOAD_READY ? (
                <p className="mt-3 max-w-md text-xs leading-relaxed text-brand-200/80">
                  The direct APK link is being finalised and will appear here.
                  No store listing exists yet.
                </p>
              ) : null}
            </div>

            <ul className="space-y-3 rounded-card border border-white/10 bg-white/5 p-5 text-sm">
              {[
                "Price shown before payment",
                "Codes at pickup and delivery",
                "Sealed-parcel photo on record",
                "Problem window for 72 hours",
              ].map((line) => (
                <li key={line} className="flex items-center gap-2.5">
                  <CheckCircleIcon
                    size={17}
                    className="shrink-0 text-brand-200"
                  />
                  {line}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
}
