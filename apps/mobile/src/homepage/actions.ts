/**
 * Turning an allowlisted action into a navigation.
 *
 * The server never sends a path the app executes blindly: `HomeAction` is a closed union of
 * `route` (one of the screens in `HOME_ROUTES`), `send` (the booking flow, optionally pre-filled) and
 * `none`. This module is the only place that maps them, so a new action kind is a compile error
 * rather than a screen that silently does nothing.
 */
import { router, type Href } from 'expo-router';
import type { HomeAction } from '@py/domain';

export interface ActionContext {
  /** The city chosen in the header, used to pre-fill the booking flow. */
  originCity?: string;
}

export function runHomeAction(action: HomeAction | undefined, context: ActionContext = {}): void {
  if (!action || action.kind === 'none') return;

  if (action.kind === 'send') {
    const origin = action.origin ?? context.originCity;
    router.push({
      pathname: '/send',
      params: {
        ...(origin ? { origin } : {}),
        ...(action.category ? { category: action.category } : {}),
      },
    });
    return;
  }

  // `route` is a member of HOME_ROUTES, which is kept in step with the files under `app/`.
  router.push(action.route as Href);
}

/** Used by items that carry an explicit origin/destination pair instead of a generic action. */
export function openRouteToSend(origin: string, dest: string): void {
  router.push({ pathname: '/send', params: { origin, dest } });
}
