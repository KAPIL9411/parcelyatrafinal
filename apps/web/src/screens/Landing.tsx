import { Link } from "react-router-dom";

import { APP_DOWNLOAD_READY } from "../lib/app-download";
import { useDocumentTitle } from "../lib/hooks";
import { DownloadButton } from "../components/DownloadButton";
import { PhonePreview } from "../components/PhoneMockup";
import {
  ArrowRightIcon,
  CameraIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  ClockIcon,
  LockIcon,
  ParcelIcon,
  RouteIcon,
  ShieldCheckIcon,
  TagIcon,
} from "../components/icons";

const FEATURES = [
  { icon: RouteIcon, number: "01", title: "A route, not a warehouse", body: "Your parcel moves with a verified traveller already making the journey." },
  { icon: TagIcon, number: "02", title: "A price you can see", body: "Route, weight and fees are clear before the booking is confirmed." },
  { icon: LockIcon, number: "03", title: "A handover you can trust", body: "Codes, photos and updates keep both ends of the journey accountable." },
];

const FAQ = [
  ["Where does Parcel Yatra run?", "We launch with Bareilly ↔ Delhi NCR and Bareilly ↔ Lucknow. More corridors open as travellers publish trips."],
  ["What can I send?", "Documents, educational certificates, business samples, dry spare parts, sealed cosmetics and low-value accessories."],
  ["Is my parcel insured?", "No. Cover does not exist in this build. If there is a problem, raise it within 72 hours of delivery and we will investigate."],
  ["How are travellers verified?", "A person checks photo ID and a selfie before a traveller can publish a trip. Both ends use a one-time handover code."],
  ["Do you track my parcel live?", "No. Status updates come from the people involved and each update is recorded on your booking."],
];

const TRUST_POINTS = [
  { icon: ShieldCheckIcon, label: "Verified travellers" },
  { icon: CameraIcon, label: "Sealed-parcel photo" },
  { icon: LockIcon, label: "Code at both ends" },
];

const SAFETY_FEATURES = [
  { icon: CameraIcon, title: "Photo at pickup", body: "The sealed parcel’s condition is recorded." },
  { icon: LockIcon, title: "Code at delivery", body: "The right person confirms the handover." },
  { icon: TagIcon, title: "Price before payment", body: "No hidden convenience charge appears later." },
  { icon: ClockIcon, title: "Recorded updates", body: "Every status change stays with the booking." },
];

export function Landing() {
  useDocumentTitle("Parcel Yatra — The shorter way to send");

  return (
    <div className="overflow-hidden">
      <section className="site-hero relative border-b border-line">
        <div aria-hidden="true" className="hero-grid pointer-events-none absolute inset-0 opacity-70" />
        <div className="relative mx-auto grid max-w-7xl gap-14 px-4 pb-20 pt-16 sm:px-8 sm:pb-28 sm:pt-24 lg:grid-cols-[1.02fr_0.98fr] lg:items-center lg:gap-20">
          <div>
            <p className="eyebrow flex items-center gap-3 text-ink-500"><span className="h-2 w-2 rounded-full bg-accent-500 ring-4 ring-accent-500/20" /> Parcel delivery, rethought</p>
            <h1 className="display-title mt-7 max-w-3xl text-[4.25rem] font-black text-ink-900 sm:text-[6.75rem]">
              The shorter<br />
              way to <span className="relative inline-block">send.<span className="absolute -bottom-1 left-0 h-3 w-full -rotate-2 bg-accent-500/75 sm:h-5" /></span>
            </h1>
            <p className="relative mt-9 max-w-lg text-lg leading-relaxed text-ink-700 sm:text-xl">
              Move a parcel across cities by sharing the journey someone is already making. Less waiting. Less distance. More certainty.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-4">
              <Link to="/send" className="inline-flex h-14 items-center gap-3 rounded-[3px] bg-ink-900 px-7 text-base font-bold text-white transition-all hover:-translate-y-1 hover:bg-black hover:shadow-float">
                Send a parcel <ArrowRightIcon size={18} />
              </Link>
              <Link to="/trips/new" className="inline-flex h-14 items-center gap-2 border-b-2 border-ink-900 px-1 text-base font-bold text-ink-900 hover:border-accent-600">
                Carry a parcel
              </Link>
            </div>
            <div className="mt-10 flex flex-wrap gap-x-6 gap-y-3 border-t border-line pt-5">
              {TRUST_POINTS.map(({ icon: Icon, label }) => <span key={label} className="inline-flex items-center gap-2 text-xs font-bold text-ink-700"><Icon size={16} /> {label}</span>)}
            </div>
          </div>

          <div className="relative min-h-[460px] sm:min-h-[590px]">
            <div className="paper-grid absolute -right-5 -top-5 h-40 w-40 opacity-60 sm:-right-12 sm:-top-10" />
            <div className="absolute inset-0 overflow-hidden rounded-[4px] bg-ink-900 shadow-float">
              <img src="/hero-background.webp" alt="A delivery route across India" className="h-full w-full object-cover opacity-85 mix-blend-screen" />
              <div className="absolute inset-0 bg-ink-900/35" />
              <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-ink-900/90 to-transparent" />
              <div className="absolute bottom-7 left-7 right-7 text-white sm:bottom-10 sm:left-10 sm:right-10">
                <p className="eyebrow text-white/60">One open seat</p>
                <div className="mt-3 flex items-end justify-between gap-4"><p className="text-3xl font-black tracking-[-0.06em] sm:text-5xl">Bareilly<br /><span className="text-accent-500">→ Delhi NCR</span></p><span className="mb-1 grid h-12 w-12 shrink-0 place-items-center rounded-full bg-accent-500 text-ink-900"><ArrowRightIcon size={22} /></span></div>
                <div className="route-line mt-8 h-px opacity-60" />
                <p className="mt-3 text-xs font-semibold text-white/60">Next departure · tomorrow · 08:30</p>
              </div>
            </div>
            <div className="absolute -bottom-8 -left-4 w-56 border border-line bg-surface p-5 shadow-float sm:-left-8 sm:w-64">
              <div className="flex items-center justify-between"><span className="eyebrow text-ink-500">Live booking</span><span className="h-2 w-2 rounded-full bg-accent-500" /></div>
              <p className="mt-5 text-2xl font-black tracking-[-0.05em] text-ink-900">Pickup confirmed</p>
              <div className="mt-4 flex items-center gap-2 text-xs font-bold text-ink-500"><CheckCircleIcon size={15} className="text-ink-900" /> Parcel sealed and photographed</div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-line bg-ink-900 text-white">
        <div className="mx-auto grid max-w-7xl grid-cols-2 divide-x divide-white/15 sm:grid-cols-4 sm:px-8">
          {[["09", "years building the network"], ["<90", "minutes average drop-off"], ["05 kg", "maximum parcel weight"], ["02", "launch corridors"]].map(([value, label]) => <div key={label} className="px-4 py-8 sm:px-7 sm:py-10"><p className="text-3xl font-black tracking-[-0.07em] text-accent-500 sm:text-4xl">{value}</p><p className="mt-2 max-w-[150px] text-xs font-semibold leading-relaxed text-white/55">{label}</p></div>)}
        </div>
      </section>

      <section id="how-it-works" className="scroll-mt-20 bg-surface py-24 sm:py-32">
        <div className="mx-auto max-w-7xl px-4 sm:px-8">
          <div className="flex flex-col justify-between gap-7 border-b border-line pb-10 lg:flex-row lg:items-end"><div><p className="eyebrow text-ink-500">A different kind of delivery</p><h2 className="mt-5 max-w-3xl text-4xl font-black tracking-[-0.075em] text-ink-900 sm:text-6xl">People already move.<br /><span className="text-ink-500">Your parcel can too.</span></h2></div><p className="max-w-sm text-base leading-relaxed text-ink-500">Parcel Yatra makes the unused space in everyday journeys useful. It is a network built around people, not depots.</p></div>
          <div className="mt-12 grid gap-px overflow-hidden border border-line bg-line md:grid-cols-3">{FEATURES.map(({ icon: Icon, number, title, body }) => <article key={number} className="bg-surface p-7 sm:p-9"><div className="flex items-start justify-between"><span className="grid h-11 w-11 place-items-center bg-accent-500 text-ink-900"><Icon size={21} /></span><span className="text-sm font-black text-ink-300">{number}</span></div><h3 className="mt-16 max-w-[240px] text-2xl font-black tracking-[-0.05em] text-ink-900">{title}</h3><p className="mt-4 max-w-xs leading-relaxed text-ink-500">{body}</p></article>)}</div>
        </div>
      </section>

      <section id="app" className="scroll-mt-20 border-y border-line bg-canvas py-24 sm:py-32">
        <div className="mx-auto grid max-w-7xl gap-16 px-4 sm:px-8 lg:grid-cols-[0.76fr_1.24fr] lg:items-center">
          <div><p className="eyebrow text-ink-500">Your control room</p><h2 className="mt-5 text-4xl font-black tracking-[-0.075em] text-ink-900 sm:text-6xl">Every detail.<br /><span className="text-ink-500">One calm place.</span></h2><p className="mt-6 max-w-md text-lg leading-relaxed text-ink-700">Post a parcel, match a journey and follow each handover without chasing a phone call.</p><DownloadButton label="Get the Android app" size="lg" className="mt-9 rounded-[3px] bg-ink-900 text-white hover:bg-black" /><p className="mt-3 text-xs text-ink-500">{APP_DOWNLOAD_READY ? "Available now for Android." : "The direct Android download link is being finalised."}</p></div>
          <div className="no-scrollbar flex snap-x gap-7 overflow-x-auto pb-5 lg:grid lg:grid-cols-3 lg:overflow-visible">{(["home", "send", "track"] as const).map((screen) => <div key={screen} className="w-[250px] shrink-0 snap-center lg:w-auto"><PhonePreview screen={screen} /></div>)}</div>
        </div>
      </section>

      <section id="safety" className="scroll-mt-20 bg-accent-500 py-24 sm:py-32"><div className="mx-auto grid max-w-7xl gap-14 px-4 sm:px-8 lg:grid-cols-[0.8fr_1.2fr] lg:items-start"><div><p className="eyebrow text-ink-700">The small things matter</p><h2 className="mt-5 max-w-lg text-4xl font-black tracking-[-0.075em] text-ink-900 sm:text-6xl">Trust is a series of tiny details.</h2><p className="mt-6 max-w-md leading-relaxed text-ink-700">We make the important moments visible, so a sender and a traveller never have to guess what happens next.</p></div><div className="grid gap-px border border-ink-900/20 bg-ink-900/20 sm:grid-cols-2">{SAFETY_FEATURES.map(({ icon: Icon, title, body }) => <div key={title} className="bg-accent-500 p-7"><Icon size={22} /><h3 className="mt-12 text-xl font-black tracking-[-0.04em] text-ink-900">{title}</h3><p className="mt-2 text-sm leading-relaxed text-ink-700">{body}</p></div>)}</div></div></section>

      <section id="faq" className="scroll-mt-20 bg-surface py-24 sm:py-32"><div className="mx-auto max-w-3xl px-4 sm:px-8"><div className="border-b border-line pb-8"><p className="eyebrow text-ink-500">Before you send</p><h2 className="mt-5 text-4xl font-black tracking-[-0.075em] text-ink-900 sm:text-6xl">Good questions.<br /><span className="text-ink-500">Straight answers.</span></h2></div><div className="mt-8">{FAQ.map(([question, answer], index) => <details key={question} className="group border-b border-line py-5"><summary className="flex cursor-pointer list-none items-center justify-between gap-5 text-lg font-black tracking-[-0.03em] text-ink-900 [&::-webkit-details-marker]:hidden"><span><span className="mr-4 text-sm text-ink-300">0{index + 1}</span>{question}</span><ChevronDownIcon size={19} className="shrink-0 text-ink-500 transition-transform group-open:rotate-180" /></summary><p className="mt-4 max-w-2xl pl-9 text-sm leading-relaxed text-ink-500">{answer}</p></details>)}</div></div></section>

      <section id="download" className="scroll-mt-20 bg-ink-900 px-4 py-10 sm:px-8 sm:py-16"><div className="paper-grid relative mx-auto max-w-7xl overflow-hidden bg-ink-900 px-7 py-16 sm:px-16 sm:py-24"><div className="relative flex flex-col justify-between gap-12 lg:flex-row lg:items-end"><div><p className="eyebrow text-accent-500">Start moving</p><h2 className="mt-5 max-w-3xl text-5xl font-black tracking-[-0.08em] text-white sm:text-8xl">Send it<br /><span className="text-accent-500">forward.</span></h2></div><div className="max-w-xs"><p className="leading-relaxed text-white/60">The next journey is already happening. Put your parcel on it.</p><Link to="/send" className="mt-7 inline-flex h-12 items-center gap-3 bg-accent-500 px-5 text-sm font-black text-ink-900 hover:bg-white">Get started <ArrowRightIcon size={17} /></Link></div></div></div></section>
    </div>
  );
}
