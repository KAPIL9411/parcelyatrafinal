import { APP_DOWNLOAD_READY, APP_DOWNLOAD_URL } from "../lib/app-download";
import { DownloadIcon, ExternalLinkIcon } from "./icons";
import { cn } from "./ui";

type Tone = "primary" | "inverse";
type Size = "sm" | "md" | "lg";

const TONE: Record<Tone, string> = {
  primary: "bg-brand-600 text-white hover:bg-brand-700",
  inverse: "bg-white text-brand-900 hover:bg-brand-50",
};

const SIZE: Record<Size, string> = {
  sm: "min-h-9 gap-1.5 px-3.5 text-sm",
  md: "h-11 gap-2 px-4 text-sm",
  lg: "h-12 gap-2 px-5 text-[15px]",
};

/**
 * The Android download call to action. While `APP_DOWNLOAD_URL` is unset this is deliberately not a
 * link: it renders a disabled control that says "soon" rather than sending anyone to a dead page.
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
    "inline-flex items-center justify-center whitespace-nowrap rounded-input font-semibold transition-colors",
    SIZE[size],
    className,
  );

  if (APP_DOWNLOAD_READY) {
    return (
      <a
        href={APP_DOWNLOAD_URL}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(base, TONE[tone])}
      >
        <DownloadIcon size={18} />
        {label}
        <ExternalLinkIcon size={14} className="opacity-70" />
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
