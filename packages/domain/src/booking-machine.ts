/**
 * Booking state machine. Authoritative description: docs/BOOKING_STATE_MACHINE.md §3.
 * Any transition not in the table is rejected. The server is the only writer.
 */

import type { BookingStatus } from './enums.ts';

export type ActorKind = 'sender' | 'traveller' | 'system' | 'support';

export type BookingCommand =
  // client-issued (present in the OpenAPI transition enum)
  | 'submit'
  | 'accept'
  | 'decline'
  | 'cancel'
  | 'confirm_pickup'
  | 'start_transit'
  | 'arrive'
  | 'confirm_delivery'
  | 'receiver_unavailable'
  | 'raise_dispute'
  | 'report_incident'
  // system-issued
  | 'expire'
  | 'auto_expire'
  | 'payment_authorised'
  | 'payment_failed'
  | 'open_pickup'
  | 'eligibility_failed'
  | 'safety_block'
  | 'lock'
  | 'escalate'
  | 'settle_window'
  | 'resolve_sender'
  | 'resolve_traveller'
  | 'compensate'
  | 'clear'
  | 'release';

/**
 * The commands a user token may send to the generic transitions route.
 *
 * `confirm_pickup` and `confirm_delivery` are absent on purpose: proof that a handover happened is a
 * six-digit code plus a photo, and only the two handover endpoints collect them. Accepting them here
 * would offer a way to claim delivery with no evidence at all.
 */
export const HANDOVER_ONLY_COMMANDS = ['confirm_pickup', 'confirm_delivery'] as const satisfies readonly BookingCommand[];

/** Everything else that a signed-in party can ask for. The API builds its request schema from this. */
export const CLIENT_COMMANDS: readonly BookingCommand[] = [
  'submit',
  'accept',
  'decline',
  'cancel',
  'start_transit',
  'arrive',
  'receiver_unavailable',
  'raise_dispute',
  'report_incident',
];

export interface TransitionContext {
  now: Date;
  actor: ActorKind;
  acceptBy?: Date | null;
  quoteValid?: boolean;
  capacityHeld?: boolean;
  travellerVerified?: boolean;
  /** Whole hours from now until the parcel pickup window starts. Negative once it has started. */
  hoursUntilWindowStart?: number;
  otpValid?: boolean;
  photoPresent?: boolean;
  disputeDeadline?: Date | null;
  disputeWindowElapsed?: boolean;
  openDispute?: boolean;
  pickupConsumed?: boolean;
  payoutAmountPaise?: number;
  ledgerBalancePaise?: number;
  supportRole?: 'support_agent' | 'trust_safety' | 'finance' | 'verification_reviewer' | 'admin_readonly' | null;
}

export interface TransitionFailure {
  ok: false;
  code: 'INVALID_TRANSITION' | 'TRANSITION_NOT_PERMITTED' | 'OTP_INVALID' | 'QUOTE_EXPIRED'
    | 'CAPACITY_UNAVAILABLE' | 'VERIFICATION_REQUIRED' | 'DISPUTE_WINDOW_CLOSED'
    | 'PAYOUT_NOT_ELIGIBLE' | 'HANDOVER_NOT_ALLOWED_IN_STATE' | 'ACCEPT_WINDOW_CLOSED';
  message: string;
}

export interface TransitionSuccess {
  ok: true;
  to: BookingStatus;
}

export type TransitionResult = TransitionSuccess | TransitionFailure;

interface Rule {
  from: BookingStatus;
  command: BookingCommand;
  to: BookingStatus;
  actors: readonly ActorKind[];
  /** Returns a failure code when the guard blocks the transition. */
  guard?: (ctx: TransitionContext) => TransitionFailure | null;
  /**
   * True when the guard depends on data supplied with the request (an OTP, a photo) rather than
   * on permission. Such commands stay visible in `allowed_commands` so the UI can show the form.
   */
  dataGuard?: boolean;
}

const guard = (
  code: TransitionFailure['code'],
  message: string,
  test: (ctx: TransitionContext) => boolean,
): ((ctx: TransitionContext) => TransitionFailure | null) => (ctx) =>
  test(ctx) ? null : { ok: false, code, message };

const RULES: readonly Rule[] = [
  {
    from: 'draft',
    command: 'submit',
    to: 'pending_traveller_acceptance',
    actors: ['sender'],
    guard: (ctx) => {
      if (ctx.quoteValid === false) return { ok: false, code: 'QUOTE_EXPIRED', message: 'This price has expired. Refresh it to continue.' };
      if (ctx.capacityHeld === false) return { ok: false, code: 'CAPACITY_UNAVAILABLE', message: 'That traveller no longer has room.' };
      return null;
    },
  },
  { from: 'draft', command: 'expire', to: 'expired', actors: ['system'] },
  {
    from: 'pending_traveller_acceptance',
    command: 'accept',
    to: 'payment_pending',
    actors: ['traveller'],
    guard: (ctx) => {
      if (ctx.acceptBy && ctx.now.getTime() > ctx.acceptBy.getTime()) {
        return { ok: false, code: 'ACCEPT_WINDOW_CLOSED', message: 'The 30-minute acceptance window has closed.' };
      }
      if (ctx.capacityHeld === false) return { ok: false, code: 'CAPACITY_UNAVAILABLE', message: 'Capacity is no longer held.' };
      if (ctx.travellerVerified === false) return { ok: false, code: 'VERIFICATION_REQUIRED', message: 'Complete ID verification before accepting.' };
      return null;
    },
  },
  { from: 'pending_traveller_acceptance', command: 'decline', to: 'cancelled_by_traveller', actors: ['traveller'] },
  { from: 'pending_traveller_acceptance', command: 'cancel', to: 'cancelled_by_sender', actors: ['sender'] },
  { from: 'pending_traveller_acceptance', command: 'auto_expire', to: 'expired', actors: ['system'] },
  { from: 'payment_pending', command: 'payment_authorised', to: 'confirmed', actors: ['system'] },
  { from: 'payment_pending', command: 'payment_failed', to: 'cancelled_by_sender', actors: ['system'] },
  { from: 'payment_pending', command: 'cancel', to: 'cancelled_by_sender', actors: ['sender'] },
  { from: 'confirmed', command: 'open_pickup', to: 'pickup_ready', actors: ['system'] },
  {
    from: 'confirmed',
    command: 'cancel',
    to: 'cancelled_by_sender',
    actors: ['sender'],
    guard: guard('INVALID_TRANSITION', 'A cancellation fee applies inside 2 hours of the pickup window.', (ctx) =>
      (ctx.hoursUntilWindowStart ?? 999) > 2),
  },
  {
    from: 'confirmed',
    command: 'cancel',
    to: 'cancelled_by_traveller',
    actors: ['traveller'],
    guard: guard('INVALID_TRANSITION', 'The parcel has already been picked up.', (ctx) => !ctx.pickupConsumed),
  },
  { from: 'confirmed', command: 'eligibility_failed', to: 'cancelled_ineligible', actors: ['system'] },
  {
    from: 'confirmed',
    command: 'safety_block',
    to: 'cancelled_safety',
    actors: ['support'],
    guard: guard('TRANSITION_NOT_PERMITTED', 'Only trust & safety can block a booking.', (ctx) => ctx.supportRole === 'trust_safety'),
  },
  {
    from: 'pickup_ready',
    command: 'confirm_pickup',
    to: 'picked_up',
    actors: ['traveller'],
    dataGuard: true,
    guard: (ctx) => {
      if (!ctx.otpValid) return { ok: false, code: 'OTP_INVALID', message: 'That pickup code is not correct.' };
      if (!ctx.photoPresent) return { ok: false, code: 'HANDOVER_NOT_ALLOWED_IN_STATE', message: 'A photo of the sealed parcel is required.' };
      return null;
    },
  },
  { from: 'pickup_ready', command: 'cancel', to: 'cancelled_by_sender', actors: ['sender'] },
  { from: 'pickup_ready', command: 'lock', to: 'locked_for_review', actors: ['system'] },
  // Exhausting the delivery code attempts has to lock the booking the same way the pickup code does,
  // and it has to happen as a transition: the raw status write it used to be left the timeline
  // claiming the parcel was still where it was.
  { from: 'arrived', command: 'lock', to: 'locked_for_review', actors: ['system'] },
  { from: 'delivery_attempt_failed', command: 'lock', to: 'locked_for_review', actors: ['system'] },
  { from: 'picked_up', command: 'start_transit', to: 'in_transit', actors: ['traveller'] },
  { from: 'picked_up', command: 'report_incident', to: 'incident_open', actors: ['sender', 'traveller', 'support'] },
  { from: 'in_transit', command: 'arrive', to: 'arrived', actors: ['traveller'] },
  { from: 'in_transit', command: 'report_incident', to: 'incident_open', actors: ['sender', 'traveller', 'support'] },
  {
    from: 'arrived',
    command: 'confirm_delivery',
    to: 'delivered',
    actors: ['traveller'],
    dataGuard: true,
    guard: (ctx) => {
      if (!ctx.otpValid) return { ok: false, code: 'OTP_INVALID', message: 'That delivery code is not correct.' };
      if (!ctx.photoPresent) return { ok: false, code: 'HANDOVER_NOT_ALLOWED_IN_STATE', message: 'A delivery photo is required.' };
      return null;
    },
  },
  {
    from: 'arrived',
    command: 'receiver_unavailable',
    to: 'delivery_attempt_failed',
    actors: ['traveller'],
  },
  // A failed attempt is followed by a second handover, not by a free pass. Without this guard the
  // generic transitions route could walk `arrived -> receiver_unavailable -> confirm_delivery` and
  // reach `delivered` with no code and no photo, which then qualifies the payout.
  {
    from: 'delivery_attempt_failed',
    command: 'confirm_delivery',
    to: 'delivered',
    actors: ['traveller'],
    dataGuard: true,
    guard: (ctx) => {
      if (!ctx.otpValid) return { ok: false, code: 'OTP_INVALID', message: 'That delivery code is not correct.' };
      if (!ctx.photoPresent) return { ok: false, code: 'HANDOVER_NOT_ALLOWED_IN_STATE', message: 'A delivery photo is required.' };
      return null;
    },
  },
  { from: 'delivery_attempt_failed', command: 'escalate', to: 'incident_open', actors: ['system', 'support'] },
  // A parcel that has reached the city but cannot be handed over is exactly when a human needs to
  // be told. Before these two edges, `incident_open` was reachable from the delivery end of the
  // journey only by `escalate`, which is system/support — and no staff surface issued it, so a stuck
  // parcel stayed stuck and its payout stayed frozen.
  { from: 'arrived', command: 'report_incident', to: 'incident_open', actors: ['sender', 'traveller', 'support'] },
  {
    from: 'delivery_attempt_failed',
    command: 'report_incident',
    to: 'incident_open',
    actors: ['sender', 'traveller', 'support'],
  },
  {
    from: 'delivered',
    command: 'raise_dispute',
    to: 'disputed',
    actors: ['sender', 'traveller'],
    guard: (ctx) => {
      if (ctx.disputeDeadline && ctx.now.getTime() > ctx.disputeDeadline.getTime()) {
        return { ok: false, code: 'DISPUTE_WINDOW_CLOSED', message: 'The 72-hour dispute window has closed.' };
      }
      return null;
    },
  },
  { from: 'delivered', command: 'settle_window', to: 'payout_eligible', actors: ['system'] },
  { from: 'disputed', command: 'resolve_sender', to: 'refunded', actors: ['support'] },
  { from: 'disputed', command: 'resolve_traveller', to: 'payout_eligible', actors: ['support'] },
  { from: 'disputed', command: 'escalate', to: 'incident_open', actors: ['support'] },
  { from: 'incident_open', command: 'compensate', to: 'refunded', actors: ['support'] },
  { from: 'incident_open', command: 'clear', to: 'payout_eligible', actors: ['support'] },
  {
    from: 'payout_eligible',
    command: 'release',
    to: 'paid_out',
    actors: ['system', 'support'],
    guard: (ctx) => {
      if (ctx.openDispute) return { ok: false, code: 'PAYOUT_NOT_ELIGIBLE', message: 'A dispute is open.' };
      if (ctx.disputeWindowElapsed === false) return { ok: false, code: 'PAYOUT_NOT_ELIGIBLE', message: 'The dispute window has not elapsed.' };
      if (
        typeof ctx.payoutAmountPaise === 'number' &&
        typeof ctx.ledgerBalancePaise === 'number' &&
        ctx.payoutAmountPaise > ctx.ledgerBalancePaise
      ) {
        return { ok: false, code: 'PAYOUT_NOT_ELIGIBLE', message: 'Payout exceeds the captured balance.' };
      }
      return null;
    },
  },
  {
    from: 'locked_for_review',
    command: 'clear',
    to: 'confirmed',
    actors: ['support'],
    guard: guard('TRANSITION_NOT_PERMITTED', 'Only a support agent can clear a locked booking.', (ctx) => ctx.supportRole === 'support_agent'),
  },
  {
    from: 'locked_for_review',
    command: 'cancel',
    to: 'cancelled_safety',
    actors: ['support'],
    guard: guard('TRANSITION_NOT_PERMITTED', 'Only a support agent can cancel a locked booking.', (ctx) => ctx.supportRole === 'support_agent'),
  },
];

export function findRule(from: BookingStatus, command: BookingCommand): Rule | undefined {
  return RULES.find((r) => r.from === from && r.command === command);
}

export function applyTransition(
  from: BookingStatus,
  command: BookingCommand,
  ctx: TransitionContext,
): TransitionResult {
  const rule = findRule(from, command);
  if (!rule) {
    return {
      ok: false,
      code: 'INVALID_TRANSITION',
      message: `A booking in "${from}" cannot perform "${command}".`,
    };
  }
  if (!rule.actors.includes(ctx.actor)) {
    return {
      ok: false,
      code: 'TRANSITION_NOT_PERMITTED',
      message: `"${command}" is not available to ${ctx.actor}.`,
    };
  }
  const failure = rule.guard?.(ctx) ?? null;
  if (failure) return failure;
  return { ok: true, to: rule.to };
}

/** Server-computed list of commands the caller may attempt right now (guards included). */
export function allowedCommands(from: BookingStatus, ctx: TransitionContext): BookingCommand[] {
  return RULES.filter((r) => r.from === from && r.actors.includes(ctx.actor))
    // A handover needs the code and the photo, so it is offered by the handover panel instead of by
    // this list — advertising a command the transitions route refuses would be a dead button.
    .filter((r) => !(HANDOVER_ONLY_COMMANDS as readonly string[]).includes(r.command))
    .filter((r) => (r.guard && !r.dataGuard ? r.guard(ctx) === null : true))
    .map((r) => r.command);
}

export function isTerminal(status: BookingStatus): boolean {
  return (
    status === 'paid_out' ||
    status === 'refunded' ||
    status === 'expired' ||
    status === 'cancelled_by_sender' ||
    status === 'cancelled_by_traveller' ||
    status === 'cancelled_ineligible' ||
    status === 'cancelled_safety'
  );
}

export const TRANSITION_TABLE = RULES;
