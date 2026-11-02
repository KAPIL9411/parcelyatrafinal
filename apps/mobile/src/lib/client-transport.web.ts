/**
 * Session transport for the browser build.
 *
 * Nothing here is optional. The iOS PWA has to survive being closed and reopened, and the only
 * credential durable enough to do that is the 30-day refresh token. Handing that token to
 * JavaScript would put it in a store any script on the page can read, so it stays in the HttpOnly
 * `py_refresh` cookie the server already writes. The page never sees it; it only asks
 * `POST /v1/auth/refresh` and the browser attaches the cookie.
 *
 * Two consequences are worth naming where they bite:
 *
 *  - `py_refresh` is written with `Path=/v1/auth`, so it travels on auth calls only, never on a
 *    parcel or booking request. Business calls stay bearer-authenticated exactly as on native.
 *  - Cross-origin, iOS Safari treats that cookie as third-party storage and can drop it. Serving
 *    the PWA from the same origin as `/v1` is what makes the session reliable — see ios/README.md.
 */

// The `.ts` specifier is deliberate here: this is a type-only import that babel erases, so it names
// the shared declaration file instead of resolving `./client-transport` back onto this web variant.
import type { FetchCredentials } from './client-transport.ts';

export type { FetchCredentials } from './client-transport.ts';

/** Absent, not `web`: the server treats anything other than the literal `native` as a browser. */
export const clientMarkerHeaders: Record<string, string> = {};

/** Required for the HttpOnly refresh cookie to be sent and to be written by a `fetch` response. */
export const fetchCredentials: FetchCredentials = 'include';

/** The web contract answers sign-in with a cookie, so no `refresh_token` field is expected. */
export const refreshTokenMustBeInBody = false;

/** Boot asks the server for a session before concluding the visitor is signed out. */
export const canRestoreFromCookie = true;
