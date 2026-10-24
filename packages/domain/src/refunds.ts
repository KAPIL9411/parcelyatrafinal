/**
 * Refund computation. One function, unit-tested, used by every cancellation path.
 * Authoritative table: docs/BUSINESS_LOGIC.md §6.
 */

export type CancelActor = 'sender' | 'traveller' | 'system' | 'safety';

export interface RefundInput {
  actor: CancelActor;
  /** Hours from now until the parcel pickup window opens. */
  hoursUntilWindowStart: number;
  /** True once the traveller has accepted (payment captured or authorised). */
  accepted: boolean;
  /** True once the parcel has been picked up. In-app cancellation is then not allowed. */
  pickedUp: boolean;
  capturedPaise: number;
  /** Provider fee that is not returned to us. 0 until a provider is contracted. */
  paymentFeePaise?: number;
}

export interface RefundResult {
  allowed: boolean;
  reasonCode:
    | 'cancel_before_accept'
    | 'cancel_gt_2h'
    | 'cancel_lt_2h'
    | 'cancel_by_traveller'
    | 'expired_no_match'
    | 'cancelled_safety'
    | 'not_allowed_after_pickup';
  refundPaise: number;
  travellerCompensationPaise: number;
  platformRetainedPaise: number;
  requiresSecondApprover: boolean;
  note: string;
}

export const MAKER_CHECKER_THRESHOLD_PAISE = 100_000; // ₹1,000

export function computeRefund(input: RefundInput): RefundResult {
  const captured = Math.max(0, Math.trunc(input.capturedPaise));
  const fee = Math.max(0, Math.trunc(input.paymentFeePaise ?? 0));

  if (input.pickedUp) {
    return {
      allowed: false,
      reasonCode: 'not_allowed_after_pickup',
      refundPaise: 0,
      travellerCompensationPaise: 0,
      platformRetainedPaise: captured,
      requiresSecondApprover: false,
      note: 'After pickup, cancellation is not available in-app. Raise a dispute or incident instead.',
    };
  }

  if (input.actor === 'safety' || input.actor === 'system') {
    return {
      allowed: true,
      reasonCode: input.actor === 'safety' ? 'cancelled_safety' : 'expired_no_match',
      refundPaise: captured,
      travellerCompensationPaise: 0,
      platformRetainedPaise: 0,
      requiresSecondApprover: captured > MAKER_CHECKER_THRESHOLD_PAISE,
      note: input.actor === 'safety' ? 'Full refund on a safety block.' : 'Full refund when no one accepts in time.',
    };
  }

  if (input.actor === 'traveller') {
    return {
      allowed: true,
      reasonCode: 'cancel_by_traveller',
      refundPaise: captured,
      travellerCompensationPaise: 0,
      platformRetainedPaise: 0,
      requiresSecondApprover: captured > MAKER_CHECKER_THRESHOLD_PAISE,
      note: 'Full refund. The traveller records a reliability penalty.',
    };
  }

  if (!input.accepted) {
    return {
      allowed: true,
      reasonCode: 'cancel_before_accept',
      refundPaise: captured,
      travellerCompensationPaise: 0,
      platformRetainedPaise: 0,
      requiresSecondApprover: captured > MAKER_CHECKER_THRESHOLD_PAISE,
      note: 'Full refund before the traveller accepts.',
    };
  }

  if (input.hoursUntilWindowStart > 2) {
    const refund = Math.max(0, captured - fee);
    return {
      allowed: true,
      reasonCode: 'cancel_gt_2h',
      refundPaise: refund,
      travellerCompensationPaise: 0,
      platformRetainedPaise: fee,
      requiresSecondApprover: refund > MAKER_CHECKER_THRESHOLD_PAISE,
      note: 'Full refund minus the non-refundable payment fee.',
    };
  }

  // ≤ 2 hours before the window: half to the traveller, half refunded.
  const half = Math.floor(captured / 2);
  const refund = Math.max(0, half - fee);
  return {
    allowed: true,
    reasonCode: 'cancel_lt_2h',
    refundPaise: refund,
    travellerCompensationPaise: half,
    platformRetainedPaise: Math.max(0, captured - refund - half),
    requiresSecondApprover: refund > MAKER_CHECKER_THRESHOLD_PAISE,
    note: 'Within 2 hours of pickup: 50% refund, 50% to the traveller.',
  };
}
