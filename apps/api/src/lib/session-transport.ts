import type { FastifyRequest } from 'fastify';

/**
 * A native app cannot use an HttpOnly cookie: there is no cookie jar the JavaScript layer can
 * inspect, and platform HTTP clients differ in whether they persist one across launches. So a
 * request from the mobile build declares itself here and receives the refresh token in the JSON
 * body instead, to be kept in the platform keystore (`expo-secure-store`, i.e. Android Keystore /
 * iOS Keychain).
 *
 * The header is a transport choice, not an authorisation decision: the caller still has to present
 * a valid code or Google token to get a session at all. The web client never sends it and keeps the
 * cookie-only path, so a script on the web page has nothing new to read.
 */
export const NATIVE_CLIENT_HEADER = 'x-py-client';

export function isNativeClient(req: FastifyRequest): boolean {
  return req.headers[NATIVE_CLIENT_HEADER] === 'native';
}
