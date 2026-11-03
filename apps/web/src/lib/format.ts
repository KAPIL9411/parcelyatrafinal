/**
 * Number and date formatting.
 *
 * Money arrives as integer paise. It is rendered with Indian digit grouping and never with
 * decimals unless paise are actually non-zero, per ux/CONTENT_AND_MICROCOPY.md §7.
 */

const inrFormatter = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const inrFormatter2 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function inr(paise: number | null | undefined): string {
  const value = Number(paise ?? 0);
  const rupees = value / 100;
  const whole = Number.isInteger(rupees);
  return `₹${whole ? inrFormatter.format(rupees) : inrFormatter2.format(rupees)}`;
}

export function inrRange(lowPaise: number, highPaise: number): string {
  return `${inr(lowPaise)}–${inr(highPaise)}`;
}

export function kg(value: number): string {
  return Number.isInteger(value) ? `${value} kg` : `${value.toFixed(1)} kg`;
}

function asDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

export function formatDate(value: string | Date, withYear = false): string {
  return asDate(value).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    ...(withYear ? { year: 'numeric' } : {}),
  });
}

export function formatTime(value: string | Date): string {
  return asDate(value)
    .toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true })
    .toLowerCase()
    .replace(/\s/g, ' ');
}

export function formatDateTime(value: string | Date, withYear = false): string {
  return `${formatDate(value, withYear)}, ${formatTime(value)}`;
}

export function dayLabel(value: string | Date): string {
  const d = asDate(value);
  const today = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(d) - startOf(today)) / 86_400_000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Tomorrow';
  if (diffDays === -1) return 'Yesterday';
  return formatDate(d);
}

export function formatWindow(start: string | Date, end: string | Date): string {
  const s = asDate(start);
  const e = asDate(end);
  if (s.toDateString() === e.toDateString()) {
    return `${dayLabel(s)} · ${formatTime(s)}–${formatTime(e)}`;
  }
  return `${dayLabel(s)} ${formatTime(s)} → ${dayLabel(e)} ${formatTime(e)}`;
}

export function countdown(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return `${m}:${String(rest).padStart(2, '0')}`;
}

export function timeAgo(value: string | Date): string {
  const diffMs = Date.now() - asDate(value).getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} d ago`;
}

export function shortId(id: string): string {
  return id.slice(0, 8);
}

/** A local `datetime-local` value for a Date, in the browser's timezone. */
export function toLocalInput(value: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

export function fromLocalInput(value: string): string {
  return new Date(value).toISOString();
}

/**
 * Accepts what a person actually types — `98123 45678`, `09812345678`, `+91 98123 45678` — and
 * returns E.164, or `null` when it is not a usable Indian mobile number. The API only accepts
 * E.164, so every screen that takes a number goes through this.
 */
export function normaliseIndianPhone(input: string): string | null {
  const digits = input.replace(/\D/g, '');
  const withoutTrunk = digits.length === 11 && digits.startsWith('0') ? digits.slice(1) : digits;
  const ten = withoutTrunk.length === 12 && withoutTrunk.startsWith('91') ? withoutTrunk.slice(2) : withoutTrunk;
  if (!/^[6-9]\d{9}$/.test(ten)) return null;
  return `+91${ten}`;
}
