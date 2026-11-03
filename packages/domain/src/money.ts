/**
 * Money is an integer number of paise everywhere. No floats cross a boundary.
 * See AGENTS.md §7 and docs/PRICING_AND_UNIT_ECONOMICS.md.
 */

export const PAISE_PER_RUPEE = 100;

export function rupeesToPaise(rupees: number): number {
  if (!Number.isFinite(rupees)) throw new TypeError('rupees must be finite');
  return Math.round(rupees * PAISE_PER_RUPEE);
}

export function paiseToRupees(paise: number): number {
  return paise / PAISE_PER_RUPEE;
}

/** Indian digit grouping: 1,23,456.78 */
export function formatPaise(paise: number, opts: { withSymbol?: boolean; showZeroPaise?: boolean } = {}): string {
  const withSymbol = opts.withSymbol ?? true;
  const sign = paise < 0 ? '-' : '';
  const abs = Math.abs(Math.trunc(paise));
  const whole = Math.floor(abs / PAISE_PER_RUPEE);
  const frac = abs % PAISE_PER_RUPEE;
  const grouped = groupIndian(whole);
  const fracText = frac === 0 && !opts.showZeroPaise ? '' : `.${String(frac).padStart(2, '0')}`;
  return `${sign}${withSymbol ? '\u20B9' : ''}${grouped}${fracText}`;
}

export function groupIndian(n: number): string {
  const s = String(Math.trunc(Math.abs(n)));
  if (s.length <= 3) return s;
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3);
  return `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}`;
}

/** Parses a rupee string typed by a user. Returns null when not a valid amount. */
export function parseRupeesToPaise(input: string): number | null {
  const cleaned = input.replace(/[\s,\u20B9]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * PAISE_PER_RUPEE);
}

export function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
