import { APP_DOWNLOAD_READY, APP_DOWNLOAD_URL } from "../lib/app-download";
import { DownloadIcon } from "./icons";
import { cn } from "./ui";

type Tone = "primary" | "inverse";
type Size = "sm" | "md" | "lg";

const TONE: Record<Tone, string> = {
  primary: "bg-brand-600 text-white shadow-sm hover:bg-brand-700 hover:shadow-card",
  inverse: "bg-white text-brand-900 shadow-sm hover:bg-brand-50",
};

const SIZE: Record<Size, string> = {
  sm: "min-h-9 gap-1.5 px-3.5 text-sm",
  md: "h-11 gap-2 px-4 text-sm",
  lg: "h-12 gap-2 px-5 text-[15px]",
};

/**
 * The Android download call to action. The current APK is served from the web app's public assets.
 */
export function DownloadButton({
  tone = "primary",
  size = "md",
  label = "Get the Android app",
  className,
}: {
  tone?: Tone;
  size?: Size;
  label?: string;
  className?: string;
}) {
  const base = cn(
    "inline-flex items-center justify-center whitespace-nowrap rounded-input font-semibold transition-all",
    SIZE[size],
    className,
  );

  if (APP_DOWNLOAD_READY) {
    return (
      <a
        href={APP_DOWNLOAD_URL}
        download="ParcelYatra.apk"
        className={cn(base, TONE[tone])}
      >
        <DownloadIcon size={18} />
        {label}
      </a>
    );
  }

  return (
    <span
      className={cn(
        base,
        "cursor-not-allowed border border-line-strong bg-surface text-ink-500",
      )}
      aria-disabled="true"
      title="The direct Android download link is being finalised"
    >
      <DownloadIcon size={18} />
      {label}
      <span className="rounded-full bg-canvas px-2 py-0.5 text-[10px] font-bold tracking-wide text-ink-500 uppercase">
        Soon
      </span>
    </span>
  );
}
