import { useEffect, useRef, useState } from "react";

import { Skeleton } from "./ui";

/**
 * The hero photograph cannot paint before the bundle has run, so the panel would sit empty and the
 * picture would then pop in. This keeps the system's own skeleton shimmer in that space and fades
 * the photograph over it once it has actually decoded.
 *
 * Decorative, so `aria-hidden`; a load that never finishes leaves the shimmer rather than a broken
 * image icon.
 */
export function HeroBackdrop() {
  const photo = useRef<HTMLImageElement>(null);
  const [ready, setReady] = useState(false);

  // A warm cache can finish before React attaches `onLoad`, and an image decoded while the tab was
  // hidden never fires it at all; `complete` is the only reliable answer after mount.
  useEffect(() => {
    const img = photo.current;
    if (img?.complete && img.naturalWidth > 0) setReady(true);
  }, []);

  return (
    <div
      aria-hidden
      className="hero-backdrop"
      data-photo-ready={ready ? "true" : undefined}
    >
      <Skeleton className="absolute inset-0 rounded-none" />
      <img
        ref={photo}
        className="hero-photo"
        src="/hero-background.webp"
        alt=""
        decoding="async"
        fetchPriority="high"
        onLoad={() => setReady(true)}
      />
    </div>
  );
}
