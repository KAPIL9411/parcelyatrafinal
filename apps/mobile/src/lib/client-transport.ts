/**
 * How this build carries its session to the API.
 *
 * The server answers `x-py-client: native` by putting the 30-day refresh token in the JSON body,
 * because a React Native app has no cookie jar. Any other client keeps the web contract: the token
 * is written to an HttpOnly cookie the page cannot read, and only `/v1/auth/*` sees it.
 *
 * The web variant of this module lives beside it as `client-transport.web.ts`. Import sites must
 * stay extensionless — `../lib/client-transport` — because naming the file `client-transport.ts`
 * asks Metro for one exact file and quietly discards the platform override.
 */

export type FetchCredentials = 'omit' | 'include' | 'same-origin';

/** Sent on the auth endpoints. The server compares it to the string `native` exactly. */
export const clientMarkerHeaders: Record<string, string> = { 'x-py-client': 'native' };

/** Passed to `fetch`. A native client has no cookies, so none are sent or stored. */
export const fetchCredentials: FetchCredentials = 'omit';

/**
 * True when a sign-in response without a `refresh_token` field means the server failed to hand the
 * session over. On the web transport the field is deliberately absent — the cookie is the session —
 * so the same absence is the expected answer, not a fault.
 */
export const refreshTokenMustBeInBody = true;

/**
 * True when a session can be restored without any stored credential, because the browser's cookie
 * jar may still hold one. A native install has nothing to ask, so boot reads its keystore first.
 */
export const canRestoreFromCookie = false;
