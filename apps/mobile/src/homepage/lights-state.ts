/**
 * Whether the hero carries a light string, and what it should show.
 *
 * The campaign decides the default: a published `lamp` theme is festive, so its lights start on.
 * A deliberate choice on the device wins over that default, and a campaign that has no lamp simply
 * has no control — a stored preference must never light up a hero that was not designed for it.
 */

export function lightsAvailable(decoration: string | undefined): boolean {
  return decoration === 'lamp';
}

export function resolveLights(decoration: string | undefined, stored: boolean | null): boolean {
  if (!lightsAvailable(decoration)) return false;
  return stored ?? true;
}
