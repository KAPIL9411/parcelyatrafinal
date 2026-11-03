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

const STATS = [
  ["09", "years moving parcels"],
  ["<90", "minutes average drop-off"],
  ["05 kg", "maximum parcel weight"],
  ["02", "launch corridors"],
];

const SERVICES = [
  { icon: ClockIcon, title: "Same-day", body: "For documents, gifts and the things that cannot wait.", meta: "From ₹45" },
  { icon: RouteIcon, title: "Inter-city", body: "Share a journey already happening between two cities.", meta: "Bareilly ↔ Nainital" },
  { icon: TagIcon, title: "For business", body: "A dependable last mile for small teams and growing stores.", meta: "Built to repeat" },
];

const STEPS = [
  { icon: ParcelIcon, title: "Tell us what to move", body: "Choose your route, describe the parcel and see the price before you commit." },
  { icon: ShieldCheckIcon, title: "Meet the right journey", body: "We match you with a verified traveller already going your way." },
  { icon: CheckCircleIcon, title: "Handover with confidence", body: "A photo and a code make pickup and delivery clear for everyone." },
];

const USE_CASES = [
  ["01", "The document you forgot", "Certificates, forms and work papers that need to reach someone today."],
  ["02", "The gift that cannot wait", "A birthday surprise, a home-cooked treat or something small that means a lot."],
  ["03", "The business that keeps moving", "Samples, stock and customer orders for teams that cannot afford a missed drop."],
];

const FAQ = [
  ["Where does Parcel Yatra run?", "We launch on the Bareilly ⇄ Nainital corridor: Baheri, Kichha, Rudrapur and Haldwani in between, both directions. More corridors open as verified travellers publish trips."],
  ["How fast will my parcel arrive?", "Your available arrival window is shown before you pay. It depends on the route and the traveller’s journey."],
  ["What can I send?", "Documents, educational certificates, business samples, dry spare parts, sealed cosmetics and low-value accessories."],
  ["How do you keep deliveries safe?", "Travellers are verified before publishing trips. Pickup and delivery both use a one-time code, and the sealed parcel is photographed."],
  ["Do you track the parcel live?", "You receive recorded status updates from the people involved. Live vehicle location is not offered in this build."],
];

const TRUST = [
  { icon: ShieldCheckIcon, label: "Verified travellers" },
  { icon: TagIcon, label: "Price before payment" },
  { icon: LockIcon, label: "Code at both ends" },
];

const PROMISE_FEATURES = [
  { icon: CameraIcon, title: "Photo at pickup", body: "The sealed parcel’s condition is recorded." },
  { icon: LockIcon, title: "Code at delivery", body: "The right person confirms the handover." },
  { icon: TagIcon, title: "Price before payment", body: "Route, weight and fees shown upfront." },
  { icon: ClockIcon, title: "Recorded updates", body: "Every status change stays with the booking." },
];

export function Landing() {
  useDocumentTitle("Parcel Yatra — Delivery that keeps up");

  return (
    <div className="overflow-hidden">
      <section className="hero-stage relative overflow-hidden bg-ink-900 text-white">
        <div aria-hidden="true" className="hero-orbit absolute -right-40 -top-40 h-[34rem] w-[34rem] rounded-full border border-white/10" />
        <div aria-hidden="true" className="hero-orbit hero-orbit-delay absolute -bottom-72 left-[35%] h-[40rem] w-[40rem] rounded-full border border-brand-500/20" />
        <div className="relative mx-auto grid min-h-[680px] max-w-7xl gap-14 px-4 pb-20 pt-16 sm:px-8 sm:pb-28 sm:pt-24 lg:grid-cols-[0.92fr_1.08fr] lg:items-center lg:gap-20">
          <div className="max-w-2xl">
            <div className="eyebrow inline-flex items-center gap-2 border border-white/15 bg-white/5 px-3 py-2 text-white/70">
              <span className="h-2 w-2 rounded-full bg-accent-500 shadow-[0_0_0_5px_rgba(216,255,84,0.12)]" />
              Parcel delivery, made human
            </div>
            <h1 className="display-title mt-7 max-w-3xl text-[4.5rem] font-black sm:text-[7.5rem]">
              Send it.<br />
              <span className="text-brand-200">We’ll move it.</span>
            </h1>
            <p className="mt-8 max-w-xl text-lg leading-relaxed text-white/70 sm:text-xl">
              Same-day and inter-city delivery for the moments that matter. Your parcel travels with a verified person already making the journey.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-4">
              <Link to="/send" className="inline-flex h-14 items-center gap-3 rounded-input bg-accent-500 px-7 text-base font-bold text-ink-900 transition-all hover:-translate-y-0.5 hover:bg-white hover:shadow-float">
                Send a parcel <ArrowRightIcon size={18} />
              </Link>
              <Link to="/trips/new" className="inline-flex h-14 items-center gap-2 rounded-input border border-white/25 px-6 text-base font-bold text-white transition-colors hover:border-white hover:bg-white/10">
                Carry a parcel
              </Link>
            </div>
            <div className="mt-10 flex flex-wrap gap-x-6 gap-y-3 border-t border-white/15 pt-5">
              {TRUST.map(({ icon: Icon, label }) => <span key={label} className="inline-flex items-center gap-2 text-xs font-semibold text-white/65"><Icon size={16} className="text-accent-500" /> {label}</span>)}
            </div>
          </div>

          <div className="relative mx-auto w-full max-w-[590px] lg:mr-0">
            <div aria-hidden="true" className="absolute -inset-5 rounded-sheet bg-brand-600/25 blur-2xl" />
            <div className="hero-media relative aspect-[0.95] overflow-hidden rounded-sheet bg-[#07112a] shadow-float ring-1 ring-white/15">
              <img src="/delivery-scooter.webp" alt="Parcel Yatra delivery scooter with branded delivery bag" className="h-full w-full object-cover object-center" />
              <div className="absolute inset-0 bg-gradient-to-t from-ink-900 via-ink-900/15 to-transparent" />
              <div className="absolute left-5 top-5 flex items-center gap-2 rounded-input bg-accent-500 px-3 py-2 text-[10px] font-black tracking-[0.14em] text-ink-900 uppercase sm:left-7 sm:top-7"><span className="h-1.5 w-1.5 rounded-full bg-ink-900" /> Ready to move</div>
              <div className="absolute bottom-6 left-6 right-6 sm:bottom-8 sm:left-8 sm:right-8">
                <div className="flex items-end justify-between gap-4"><div><p className="eyebrow text-white/55">Next available route</p><p className="mt-2 text-3xl font-black tracking-[-0.06em] sm:text-5xl">Bareilly <span className="text-brand-200">→</span><br className="sm:hidden" /> Nainital</p></div><span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-white text-ink-900"><ArrowRightIcon size={21} /></span></div>
                <div className="route-line mt-7 h-px opacity-50" />
                <div className="mt-3 flex items-center justify-between text-xs font-semibold text-white/55"><span>Tomorrow · 08:30</span><span className="text-accent-500">from ₹45</span></div>
              </div>
            </div>
            <div className="hero-ticket absolute -bottom-7 -left-4 border border-line bg-surface p-4 text-ink-900 shadow-float sm:-left-8 sm:p-5"><div className="flex items-center gap-2 text-[10px] font-black tracking-[0.12em] text-ink-500 uppercase"><CheckCircleIcon size={14} className="text-brand-600" /> Pickup confirmed</div><p className="mt-3 text-lg font-black tracking-[-0.03em]">Sealed & photographed</p><p className="mt-1 text-xs text-ink-500">Your parcel is ready for its journey.</p></div>
          </div>
        </div>
      </section>

      <section className="border-b border-line bg-surface">
        <div className="mx-auto grid max-w-7xl grid-cols-2 divide-x divide-line sm:grid-cols-4 sm:px-8">
          {STATS.map(([value, label]) => <div key={label} className="px-4 py-8 sm:px-7 sm:py-10"><p className="text-3xl font-black tracking-[-0.07em] text-brand-600 sm:text-4xl">{value}</p><p className="mt-2 max-w-[155px] text-xs font-semibold leading-relaxed text-ink-500 sm:text-sm">{label}</p></div>)}
        </div>
      </section>

      <section id="services" className="scroll-mt-20 bg-canvas py-24 sm:py-32">
        <div className="mx-auto max-w-7xl px-4 sm:px-8">
          <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end"><div><p className="eyebrow text-brand-600">One network. Many reasons.</p><h2 className="mt-4 max-w-3xl text-4xl font-black tracking-[-0.065em] text-ink-900 sm:text-6xl">Whatever needs moving,<br /><span className="text-ink-500">there’s a better way.</span></h2></div><Link to="/pricing" className="inline-flex items-center gap-2 text-sm font-bold text-brand-600 hover:underline">See transparent pricing <ArrowRightIcon size={16} /></Link></div>
          <div className="mt-12 grid gap-4 lg:grid-cols-3">{SERVICES.map(({ icon: Icon, title, body, meta }, index) => <Link to="/send" key={title} className={`group relative min-h-[285px] overflow-hidden rounded-card border p-7 transition-all hover:-translate-y-1 hover:shadow-float sm:p-9 ${index === 1 ? "border-brand-600 bg-brand-600 text-white" : "border-line bg-surface text-ink-900"}`}><div className={`grid h-12 w-12 place-items-center rounded-input ${index === 1 ? "bg-accent-500 text-ink-900" : "bg-brand-50 text-brand-600"}`}><Icon size={22} /></div><p className={`mt-9 text-xs font-black tracking-[0.12em] uppercase ${index === 1 ? "text-brand-100" : "text-brand-600"}`}>{meta}</p><h3 className="mt-2 text-3xl font-black tracking-[-0.06em]">{title}</h3><p className={`mt-3 max-w-xs leading-relaxed ${index === 1 ? "text-white/70" : "text-ink-500"}`}>{body}</p><span className={`absolute bottom-7 right-7 grid h-9 w-9 place-items-center rounded-full border transition-transform group-hover:translate-x-1 ${index === 1 ? "border-white/30 text-white" : "border-line-strong text-ink-900"}`}><ArrowRightIcon size={16} /></span></Link>)}</div>
        </div>
      </section>

      <section id="how-it-works" className="scroll-mt-20 bg-surface py-24 sm:py-32">
        <div className="mx-auto max-w-7xl px-4 sm:px-8"><div className="grid gap-12 lg:grid-cols-[0.75fr_1.25fr] lg:items-end"><div><p className="eyebrow text-brand-600">How it works</p><h2 className="mt-4 text-4xl font-black tracking-[-0.065em] text-ink-900 sm:text-6xl">Three steps.<br /><span className="text-ink-500">No guesswork.</span></h2></div><p className="max-w-md text-lg leading-relaxed text-ink-500">Designed like a great delivery should feel: clear at the start, visible in the middle and certain at the end.</p></div><div className="mt-14 grid gap-px overflow-hidden border border-line bg-line md:grid-cols-3">{STEPS.map(({ icon: Icon, title, body }, index) => <article key={title} className="bg-surface p-7 sm:p-9"><div className="flex items-start justify-between"><span className="grid h-12 w-12 place-items-center rounded-input bg-ink-900 text-accent-500"><Icon size={22} /></span><span className="text-5xl font-black tracking-[-0.08em] text-brand-100">0{index + 1}</span></div><h3 className="mt-16 max-w-[235px] text-2xl font-black tracking-[-0.05em] text-ink-900">{title}</h3><p className="mt-4 max-w-xs leading-relaxed text-ink-500">{body}</p></article>)}</div></div>
      </section>

      <section className="border-y border-line bg-ink-900 py-24 text-white sm:py-32"><div className="mx-auto max-w-7xl px-4 sm:px-8"><div className="flex flex-col justify-between gap-7 lg:flex-row lg:items-end"><div><p className="eyebrow text-brand-200">Made for real life</p><h2 className="mt-4 max-w-3xl text-4xl font-black tracking-[-0.065em] sm:text-6xl">For the little urgent things<br /><span className="text-white/45">and the big everyday ones.</span></h2></div><p className="max-w-sm leading-relaxed text-white/55">A delivery network should fit into your day, not ask you to reorganise it.</p></div><div className="mt-14 grid gap-px border border-white/15 bg-white/15 md:grid-cols-3">{USE_CASES.map(([number, title, body]) => <div key={number} className="bg-ink-900 p-7 sm:p-9"><span className="text-sm font-black text-accent-500">{number}</span><h3 className="mt-16 max-w-[250px] text-2xl font-black tracking-[-0.05em]">{title}</h3><p className="mt-4 max-w-xs leading-relaxed text-white/55">{body}</p></div>)}</div></div></section>

      <section id="app" className="scroll-mt-20 bg-canvas py-24 sm:py-32"><div className="mx-auto grid max-w-7xl gap-16 px-4 sm:px-8 lg:grid-cols-[0.72fr_1.28fr] lg:items-center"><div><p className="eyebrow text-brand-600">Your delivery, in one place</p><h2 className="mt-4 text-4xl font-black tracking-[-0.065em] text-ink-900 sm:text-6xl">A calmer way<br /><span className="text-ink-500">to keep up.</span></h2><p className="mt-6 max-w-md text-lg leading-relaxed text-ink-700">Post a parcel, follow each update and keep both handover codes together in the Parcel Yatra app.</p><DownloadButton label="Download the Android app" size="lg" className="mt-9 rounded-input bg-brand-600 text-white hover:bg-brand-700" /><p className="mt-3 text-xs text-ink-500">{APP_DOWNLOAD_READY ? "Available now for Android." : "The direct Android download link is being finalised."}</p></div><div className="no-scrollbar flex snap-x gap-6 overflow-x-auto pb-4 lg:grid lg:grid-cols-3 lg:overflow-visible">{(["home", "send", "track"] as const).map((screen) => <div key={screen} className="w-[250px] shrink-0 snap-center lg:w-auto"><PhonePreview screen={screen} /></div>)}</div></div></section>

      <section id="safety" className="scroll-mt-20 bg-brand-600 py-24 text-white sm:py-32"><div className="mx-auto grid max-w-7xl gap-14 px-4 sm:px-8 lg:grid-cols-[0.72fr_1.28fr] lg:items-start"><div><p className="eyebrow text-brand-100">The Parcel Yatra promise</p><h2 className="mt-4 max-w-lg text-4xl font-black tracking-[-0.065em] sm:text-6xl">Small details.<br />Big confidence.</h2><p className="mt-6 max-w-md text-lg leading-relaxed text-white/65">We make the moments that matter visible, so senders and travellers know exactly what happens next.</p></div><div className="grid gap-x-10 gap-y-10 sm:grid-cols-2">{PROMISE_FEATURES.map(({ icon: Icon, title, body }) => <div key={title} className="flex gap-4"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-input bg-accent-500 text-ink-900"><Icon size={21} /></span><div><h3 className="text-lg font-bold">{title}</h3><p className="mt-1 text-sm leading-relaxed text-white/60">{body}</p></div></div>)}</div></div></section>

      <section id="faq" className="scroll-mt-20 bg-surface py-24 sm:py-32"><div className="mx-auto max-w-3xl px-4 sm:px-8"><div className="border-b border-line pb-9"><p className="eyebrow text-brand-600">Before you send</p><h2 className="mt-4 text-4xl font-black tracking-[-0.065em] text-ink-900 sm:text-6xl">Good questions.<br /><span className="text-ink-500">Straight answers.</span></h2></div><div className="mt-7">{FAQ.map(([question, answer], index) => <details key={question} className="group border-b border-line py-5"><summary className="flex cursor-pointer list-none items-center justify-between gap-5 text-lg font-bold tracking-[-0.02em] text-ink-900 [&::-webkit-details-marker]:hidden"><span><span className="mr-4 text-sm font-black text-brand-600">0{index + 1}</span>{question}</span><ChevronDownIcon size={19} className="shrink-0 text-ink-500 transition-transform group-open:rotate-180" /></summary><p className="mt-4 max-w-2xl pl-9 text-sm leading-relaxed text-ink-500">{answer}</p></details>)}</div></div></section>

      <section id="download" className="scroll-mt-20 bg-ink-900 px-4 py-10 sm:px-8 sm:py-16"><div className="relative mx-auto max-w-7xl overflow-hidden rounded-sheet bg-brand-600 px-7 py-14 sm:px-16 sm:py-20"><div aria-hidden="true" className="absolute -right-32 -top-36 h-[28rem] w-[28rem] rounded-full border-[3rem] border-accent-500/30" /><div className="relative flex flex-col justify-between gap-10 lg:flex-row lg:items-end"><div><p className="eyebrow text-brand-100">Ready when you are</p><h2 className="mt-4 max-w-3xl text-5xl font-black tracking-[-0.08em] text-white sm:text-8xl">Move it<br /><span className="text-accent-500">forward.</span></h2></div><div className="max-w-xs"><p className="leading-relaxed text-white/70">The next journey is already happening. Put your parcel on it.</p><Link to="/send" className="mt-7 inline-flex h-12 items-center gap-3 rounded-input bg-accent-500 px-5 text-sm font-black text-ink-900 hover:bg-white">Get started <ArrowRightIcon size={17} /></Link></div></div></div></section>
    </div>
  );
}
