import type { ReactNode } from "react";

import {
  ArrowRightIcon,
  AwardIcon,
  CarIcon,
  CheckCircleIcon,
  ChevronLeftIcon,
  DocIcon,
  LockIcon,
  ParcelIcon,
  PhoneIcon,
  RouteIcon,
  ShieldCheckIcon,
  SwapIcon,
  TagIcon,
  UserIcon,
} from "./icons";
import { cn } from "./ui";

/**
 * Illustrative app screens, drawn in CSS from the product's own vocabulary.
 *
 * These exist so the marketing page can show what the app looks like before real screenshots are
 * supplied. They are decorative: the whole block is `aria-hidden`, and each frame carries a visible
 * caption outside the artwork (`PhonePreview`), so nothing here is announced as live data.
 */

type Screen = "home" | "send" | "track";

const SCREEN_LABEL: Record<Screen, string> = {
  home: "Home",
  send: "Send a parcel",
  track: "Track a handover",
};

function StatusBar({ light = false }: { light?: boolean }) {
  return (
    <div
      className={cn(
        "relative z-10 flex items-center justify-between px-5 pt-2.5 text-[9px] font-bold tabular",
        light ? "text-white/90" : "text-ink-900",
      )}
    >
      <span>9:41</span>
      <span className="flex items-center gap-1">
        <span className="h-2 w-3 rounded-[2px] border border-current" aria-hidden="true">
          <span className="block h-full w-2/3 rounded-[1px] bg-current" />
        </span>
        <span className="h-2 w-2 rounded-full border border-current" aria-hidden="true" />
      </span>
    </div>
  );
}

function Tabs({ active }: { active: Screen | "parcels" | "trips" | "account" }) {
  const items: Array<{
    key: Screen | "parcels" | "trips" | "account";
    label: string;
    icon: typeof ParcelIcon;
  }> = [
    { key: "home", label: "Home", icon: ParcelIcon },
    { key: "send", label: "Send", icon: DocIcon },
    { key: "parcels", label: "Parcels", icon: TagIcon },
    { key: "trips", label: "Trips", icon: RouteIcon },
    { key: "account", label: "Account", icon: UserIcon },
  ];

  return (
    <div className="mt-auto flex items-center justify-around border-t border-line bg-surface px-1.5 pt-2 pb-3">
      {items.map((item) => (
        <span
          key={item.key}
          className={cn(
            "flex w-10 flex-col items-center gap-0.5 text-[7px] font-semibold",
            item.key === active ? "text-brand-700" : "text-ink-300",
          )}
        >
          <item.icon size={13} />
          {item.label}
        </span>
      ))}
    </div>
  );
}

function Pill({ children, tone = "brand" }: { children: ReactNode; tone?: "brand" | "success" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[7px] font-bold tracking-wide uppercase",
        tone === "brand" ? "bg-brand-50 text-brand-700" : "bg-success-50 text-success-600",
      )}
    >
      {children}
    </span>
  );
}

function HomeScreen() {
  const categories = [
    { icon: DocIcon, label: "Docs" },
    { icon: AwardIcon, label: "Certificates" },
    { icon: ParcelIcon, label: "Samples" },
    { icon: TagIcon, label: "Accessories" },
  ] as const;

  return (
    <div className="flex h-full flex-col bg-surface">
      <div className="bg-gradient-to-br from-brand-700 via-brand-900 to-[#070f1e] pb-12">
        <StatusBar light />
        <div className="px-4 pt-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold tracking-wide text-white">
              Parcel Yatra
            </span>
            <span className="grid h-6 w-6 place-items-center rounded-full bg-white/15 text-[8px] font-bold text-white">
              RS
            </span>
          </div>
          <p className="mt-4 text-[10px] font-medium text-brand-100">
            Good evening 👋
          </p>
          <p className="mt-1 text-[17px] leading-[1.25] font-bold text-white">
            Your parcel.
            <br />
            Their journey.
          </p>
        </div>
      </div>

      <div className="relative z-10 -mt-8 px-3">
        <div className="rounded-[14px] bg-surface p-3 shadow-[0_14px_30px_-18px_rgba(4,12,28,0.5)] ring-1 ring-line">
          <p className="text-[7px] font-bold tracking-widest text-ink-500 uppercase">
            Send a parcel
          </p>
          <div className="mt-2 flex items-center gap-1.5">
            <div className="min-w-0 flex-1 rounded-lg border border-line px-2 py-1.5">
              <p className="text-[6px] font-semibold tracking-wide text-ink-500 uppercase">
                From
              </p>
              <p className="truncate text-[10px] font-semibold text-ink-900">
                Bareilly
              </p>
            </div>
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-50 text-brand-700">
              <SwapIcon size={11} />
            </span>
            <div className="min-w-0 flex-1 rounded-lg border border-line px-2 py-1.5">
              <p className="text-[6px] font-semibold tracking-wide text-ink-500 uppercase">
                To
              </p>
              <p className="truncate text-[10px] font-semibold text-ink-900">
                Delhi NCR
              </p>
            </div>
          </div>
          <div className="mt-2 flex items-center justify-between rounded-lg bg-brand-600 px-2.5 py-2 text-white">
            <span className="text-[9px] font-semibold">
              See price and travellers
            </span>
            <ArrowRightIcon size={11} />
          </div>
        </div>
      </div>

      <div className="px-3 pt-3">
        <p className="text-[9px] font-bold text-ink-900">What are you sending?</p>
        <div className="mt-2 grid grid-cols-4 gap-1.5">
          {categories.map((category) => (
            <div
              key={category.label}
              className="rounded-lg bg-canvas px-1 py-2 text-center"
            >
              <category.icon size={14} className="mx-auto text-brand-700" />
              <p className="mt-1 truncate text-[6.5px] font-medium text-ink-700">
                {category.label}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="px-3 pt-3">
        <p className="text-[9px] font-bold text-ink-900">Routes open now</p>
        <div className="mt-1.5 space-y-1.5">
          {[
            ["Bareilly", "Delhi NCR"],
            ["Bareilly", "Lucknow"],
          ].map(([from, to]) => (
            <div
              key={to}
              className="flex items-center gap-2 rounded-lg border border-line px-2 py-1.5"
            >
              <RouteIcon size={12} className="shrink-0 text-brand-700" />
              <p className="text-[8px] font-medium text-ink-700">
                {from} <span className="text-ink-300">⇄</span> {to}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-auto flex items-center gap-1.5 px-3 pb-3 text-[7px] text-ink-500">
        <ShieldCheckIcon size={11} className="shrink-0 text-success-600" />
        Verified travellers · code at both ends
      </div>

      <Tabs active="home" />
    </div>
  );
}

function SendScreen() {
  return (
    <div className="flex h-full flex-col bg-surface">
      <StatusBar />
      <div className="px-3 pt-2">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-[10px] font-semibold text-ink-900">
            <ChevronLeftIcon size={13} className="text-ink-500" />
            New parcel
          </span>
          <Pill>Step 1 of 3</Pill>
        </div>
      </div>

      <div className="px-3 pt-4">
        <p className="text-[11px] font-bold text-ink-900">What’s inside?</p>
        <p className="mt-0.5 text-[7.5px] leading-relaxed text-ink-500">
          Sealed, small and within the allowed list.
        </p>
        <div className="mt-2 space-y-1.5">
          {[
            { icon: DocIcon, title: "Documents", body: "Papers, contracts" },
            { icon: AwardIcon, title: "Certificates", body: "Degrees, marksheets" },
            { icon: ParcelIcon, title: "Business samples", body: "Dry, sealed samples" },
          ].map((option, index) => (
            <div
              key={option.title}
              className={cn(
                "flex items-center gap-2 rounded-lg border px-2 py-1.5",
                index === 0
                  ? "border-brand-600 bg-brand-50/60"
                  : "border-line bg-surface",
              )}
            >
              <span
                className={cn(
                  "grid h-6 w-6 shrink-0 place-items-center rounded-full",
                  index === 0
                    ? "bg-brand-600 text-white"
                    : "bg-canvas text-ink-500",
                )}
              >
                <option.icon size={12} />
              </span>
              <span className="min-w-0 flex-1">
                <p className="truncate text-[8.5px] font-semibold text-ink-900">
                  {option.title}
                </p>
                <p className="truncate text-[7px] text-ink-500">{option.body}</p>
              </span>
              <CheckCircleIcon
                size={13}
                className={index === 0 ? "shrink-0 text-brand-600" : "shrink-0 text-line-strong"}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="px-3 pt-3">
        <div className="flex items-center justify-between rounded-lg border border-line px-2 py-2">
          <span>
            <p className="text-[8.5px] font-semibold text-ink-900">Weight</p>
            <p className="text-[6.5px] text-ink-500">Up to 5 kg at launch</p>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="grid h-5 w-5 place-items-center rounded-full border border-line text-[10px] font-bold text-ink-500">
              −
            </span>
            <span className="tabular text-[9px] font-bold text-ink-900">1.5 kg</span>
            <span className="grid h-5 w-5 place-items-center rounded-full border border-line text-[10px] font-bold text-ink-500">
              +
            </span>
          </span>
        </div>
      </div>

      <div className="px-3 pt-2">
        <div className="rounded-lg border border-line px-2 py-2">
          <div className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-brand-600" />
            <p className="flex-1 text-[8px] font-semibold text-ink-900">Bareilly</p>
            <p className="text-[6px] text-ink-500">Pickup</p>
          </div>
          <div className="my-1 ml-[2px] h-3 border-l border-dashed border-line-strong" />
          <div className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-accent-500" />
            <p className="flex-1 text-[8px] font-semibold text-ink-900">Delhi NCR</p>
            <p className="text-[6px] text-ink-500">Drop</p>
          </div>
        </div>
      </div>

      <div className="mt-auto px-3 pb-3">
        <p className="mb-2 flex items-center gap-1 text-[7px] text-ink-500">
          <LockIcon size={10} className="shrink-0 text-brand-700" />
          The price is shown before you pay.
        </p>
        <div className="flex items-center justify-between rounded-lg bg-brand-600 px-2.5 py-2 text-white">
          <span className="text-[9px] font-semibold">Continue</span>
          <ArrowRightIcon size={11} />
        </div>
      </div>

      <Tabs active="send" />
    </div>
  );
}

function TrackScreen() {
  const steps = [
    { label: "Parcel sealed and photographed", state: "done" },
    { label: "Picked up by traveller", state: "done" },
    { label: "On the way to Delhi NCR", state: "current" },
    { label: "Delivered to receiver", state: "next" },
  ] as const;

  return (
    <div className="flex h-full flex-col bg-canvas">
      <div className="bg-surface">
        <StatusBar />
        <div className="flex items-center justify-between px-3 pt-2 pb-3">
          <span className="text-[10px] font-semibold text-ink-900">Your parcel</span>
          <Pill tone="success">On the way</Pill>
        </div>
      </div>

      <div className="px-3 pt-3">
        <div className="rounded-lg bg-surface p-2.5 ring-1 ring-line">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[6px] font-semibold tracking-wide text-ink-500 uppercase">
                From
              </p>
              <p className="text-[9px] font-bold text-ink-900">Bareilly</p>
            </div>
            <span className="relative mx-1 flex flex-1 items-center">
              <span className="h-px flex-1 bg-line-strong" />
              <CarIcon size={12} className="mx-1 shrink-0 text-brand-600" />
              <span className="h-px flex-1 bg-line-strong" />
            </span>
            <div className="text-right">
              <p className="text-[6px] font-semibold tracking-wide text-ink-500 uppercase">
                To
              </p>
              <p className="text-[9px] font-bold text-ink-900">Delhi NCR</p>
            </div>
          </div>
          <p className="mt-1.5 text-[6.5px] text-ink-500">
            Documents · 1.5 kg · sealed at pickup
          </p>
        </div>
      </div>

      <div className="px-3 pt-2">
        <div className="rounded-lg bg-surface p-2.5 ring-1 ring-line">
          <p className="text-[8px] font-bold text-ink-900">Status</p>
          <ol className="mt-1.5 space-y-1.5">
            {steps.map((step) => (
              <li key={step.label} className="flex items-start gap-1.5">
                {step.state === "done" ? (
                  <CheckCircleIcon
                    size={11}
                    className="mt-px shrink-0 text-success-600"
                  />
                ) : (
                  <span
                    className={cn(
                      "mt-1 h-1.5 w-1.5 shrink-0 rounded-full",
                      step.state === "current"
                        ? "bg-brand-600 ring-2 ring-brand-100"
                        : "bg-line-strong",
                    )}
                  />
                )}
                <span
                  className={cn(
                    "text-[7.5px] leading-tight",
                    step.state === "next"
                      ? "text-ink-300"
                      : "font-medium text-ink-700",
                    step.state === "current" && "font-semibold text-ink-900",
                  )}
                >
                  {step.label}
                </span>
              </li>
            ))}
          </ol>
        </div>
      </div>

      <div className="px-3 pt-2">
        <div className="flex items-center gap-2 rounded-lg bg-surface p-2.5 ring-1 ring-line">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-50 text-brand-700">
            <LockIcon size={13} />
          </span>
          <span className="min-w-0 flex-1">
            <p className="text-[8px] font-semibold text-ink-900">Delivery code</p>
            <p className="text-[6.5px] text-ink-500">Share only at the door</p>
          </span>
          <span className="flex gap-0.5">
            {Array.from({ length: 6 }).map((_, index) => (
              <span
                key={index}
                className="h-1.5 w-1.5 rounded-full bg-ink-700"
              />
            ))}
          </span>
        </div>
      </div>

      <div className="px-3 pt-2">
        <div className="flex items-center gap-2 rounded-lg bg-surface p-2.5 ring-1 ring-line">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-900 text-[8px] font-bold text-white">
            RS
          </span>
          <span className="min-w-0 flex-1">
            <p className="text-[8px] font-semibold text-ink-900">Rohit S.</p>
            <p className="flex items-center gap-1 text-[6.5px] text-success-600">
              <ShieldCheckIcon size={9} /> Verified traveller
            </p>
          </span>
          <span className="grid h-6 w-6 place-items-center rounded-full bg-brand-50 text-brand-700">
            <PhoneIcon size={11} />
          </span>
        </div>
      </div>

      <Tabs active="parcels" />
    </div>
  );
}

export function PhoneMockup({
  screen,
  className,
}: {
  screen: Screen;
  className?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={cn("mx-auto w-[268px] select-none sm:w-[280px]", className)}
    >
      <div className="rounded-[2.75rem] border-[9px] border-ink-900 bg-ink-900 shadow-float">
        <div className="relative aspect-[268/552] overflow-hidden rounded-[2.1rem] bg-surface">
          <div className="absolute top-2 left-1/2 z-20 h-[18px] w-[86px] -translate-x-1/2 rounded-full bg-ink-900" />
          {screen === "home" ? (
            <HomeScreen />
          ) : screen === "send" ? (
            <SendScreen />
          ) : (
            <TrackScreen />
          )}
        </div>
      </div>
    </div>
  );
}

/** A frame plus its caption, used by the app-preview gallery. */
export function PhonePreview({ screen }: { screen: Screen }) {
  return (
    <figure className="flex flex-col items-center gap-4">
      <PhoneMockup screen={screen} />
      <figcaption className="text-center">
        <p className="text-sm font-semibold text-ink-900">{SCREEN_LABEL[screen]}</p>
        <p className="mt-0.5 text-xs text-ink-500">
          {screen === "home"
            ? "Greeting, search and the routes open now"
            : screen === "send"
              ? "Contents, weight and route before pricing"
              : "Status history and the delivery code"}
        </p>
      </figcaption>
    </figure>
  );
}
