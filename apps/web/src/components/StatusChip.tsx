import { BOOKING_STATUS_LABELS, type BookingStatus } from '@py/domain';

import { cn } from './ui';
import { CheckCircleIcon, ClockIcon, InfoIcon, XCircleIcon } from './icons';

type ChipTone = 'success' | 'warn' | 'danger' | 'brand' | 'neutral';

const TONES: Record<ChipTone, string> = {
  success: 'bg-success-50 text-success-600',
  warn: 'bg-warn-50 text-warn-600',
  danger: 'bg-danger-50 text-danger-600',
  brand: 'bg-brand-50 text-brand-700',
  neutral: 'bg-canvas text-ink-700',
};

const TONE_ICON: Record<ChipTone, typeof InfoIcon> = {
  success: CheckCircleIcon,
  warn: ClockIcon,
  danger: XCircleIcon,
  brand: ClockIcon,
  neutral: InfoIcon,
};

export function Chip({
  tone = 'neutral',
  children,
  icon = true,
  className,
}: {
  tone?: ChipTone;
  children: React.ReactNode;
  icon?: boolean;
  className?: string;
}) {
  const Icon = TONE_ICON[tone];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap',
        TONES[tone],
        className,
      )}
    >
      {icon ? <Icon size={14} aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

function toneForStatus(status: string): ChipTone {
  switch (status) {
    case 'confirmed':
    case 'delivered':
    case 'payout_eligible':
    case 'paid_out':
      return 'success';
    case 'pickup_ready':
    case 'picked_up':
    case 'in_transit':
    case 'arrived':
      return 'brand';
    case 'pending_traveller_acceptance':
    case 'payment_pending':
    case 'delivery_attempt_failed':
    case 'locked_for_review':
      return 'warn';
    case 'disputed':
    case 'incident_open':
    case 'cancelled_by_sender':
    case 'cancelled_by_traveller':
    case 'cancelled_ineligible':
    case 'cancelled_safety':
    case 'expired':
      return 'danger';
    default:
      return 'neutral';
  }
}

export function StatusChip({ status, className }: { status: string; className?: string }) {
  const label = BOOKING_STATUS_LABELS[status as BookingStatus] ?? status.replaceAll('_', ' ');
  return (
    <Chip tone={toneForStatus(status)} className={className}>
      {label}
    </Chip>
  );
}

export function VerificationChip({ state }: { state: string }) {
  switch (state) {
    case 'verified':
      return <Chip tone="success">ID verified</Chip>;
    case 'pending':
      return <Chip tone="warn">Verification pending</Chip>;
    case 'rejected':
      return <Chip tone="danger">Verification rejected</Chip>;
    case 'expired':
      return <Chip tone="danger">Verification expired</Chip>;
    default:
      return <Chip tone="neutral">Not verified</Chip>;
  }
}

export function MatchBandChip({ band }: { band: string }) {
  const map: Record<string, { tone: ChipTone; label: string }> = {
    excellent: { tone: 'success', label: 'Excellent match' },
    good: { tone: 'brand', label: 'Good match' },
    fair: { tone: 'warn', label: 'Fair match' },
  };
  const entry = map[band] ?? { tone: 'neutral' as ChipTone, label: band };
  return (
    <Chip tone={entry.tone} icon={false}>
      {entry.label}
    </Chip>
  );
}

export function PayoutChip({ state }: { state: string }) {
  switch (state) {
    case 'eligible':
      return <Chip tone="success">Payout eligible</Chip>;
    case 'frozen':
      return <Chip tone="danger">Payout frozen</Chip>;
    case 'released':
      return <Chip tone="success">Paid out</Chip>;
    case 'void':
      return <Chip tone="neutral">Payout void</Chip>;
    default:
      return <Chip tone="neutral">Payout not yet due</Chip>;
  }
}
