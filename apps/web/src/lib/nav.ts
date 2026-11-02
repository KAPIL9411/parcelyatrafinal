/**
 * Validate a post-login `?next=` target.
 *
 * A raw `navigate(params.get('next'))` accepts `//evil.example`, which the browser resolves as a
 * protocol-relative URL and leaves the site with. Only root-relative, single-slash paths are allowed.
 */
export function safeNext(raw: string | null | undefined, fallback = '/bookings'): string {
  if (!raw) return fallback;
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\') || raw.includes('://')) return fallback;
  return raw;
}
