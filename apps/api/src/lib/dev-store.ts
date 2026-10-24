/**
 * Development-only in-memory store for codes that are otherwise unrecoverable.
 *
 * The database stores only HMACs of OTPs, which is correct. That makes a demo flow impossible to
 * drive without a way to read the code. This map exists only in the API process, only when
 * ENABLE_DEV_ENDPOINTS is on, and is never written to disk or to a log. It is cleared on restart.
 */
const codes = new Map<string, { code: string; expiresAt: number; kind: 'login' | 'pickup' | 'delivery' }>();

export function rememberCode(key: string, code: string, kind: 'login' | 'pickup' | 'delivery', ttlMs = 15 * 60_000): void {
  codes.set(key, { code, expiresAt: Date.now() + ttlMs, kind });
  if (codes.size > 500) {
    const oldest = codes.keys().next().value;
    if (oldest !== undefined) codes.delete(oldest);
  }
}

export function recallCode(key: string): { code: string; kind: 'login' | 'pickup' | 'delivery' } | null {
  const hit = codes.get(key);
  if (!hit) return null;
  if (hit.expiresAt < Date.now()) {
    codes.delete(key);
    return null;
  }
  return { code: hit.code, kind: hit.kind };
}

export function forgetCode(key: string): void {
  codes.delete(key);
}
