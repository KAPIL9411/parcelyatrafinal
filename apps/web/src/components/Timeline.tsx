import { BOOKING_STATUS_HINTS, BOOKING_STATUS_LABELS, TRAVELLER_STATUS_HINTS, type BookingStatus } from '@py/domain';

import { formatDateTime } from '../lib/format';
import { cn } from './ui';

interface TimelineEvent {
  from_state: string | null;
  to_state: string;
  actor_kind: string;
  actor_role?: 'sender' | 'traveller' | null;
  reason_code: string | null;
  occurred_at: string;
}

const ACTOR_LABEL: Record<string, string> = {
  system: 'Parcel Yatra',
  support: 'Support',
};

/**
 * Vertical timeline. Four node states: done, current, pending, skipped. No map, no animation.
 *
 * `viewerRole` matters: an event made by the other side must not read "You". The server sends
 * `actor_role` for exactly this reason (docs/BUILD_NOTES.md DEFECT-010).
 */
export function Timeline({
  events,
  status,
  viewerRole,
}: {
  events: TimelineEvent[];
  status: string;
  viewerRole: 'sender' | 'traveller';
}) {
  if (events.length === 0) {
    return <p className="text-sm text-ink-500">No status updates yet.</p>;
  }

  const lastIndex = events.length - 1;

  return (
    <ol className="space-y-0">
      {events.map((event, index) => {
        const isLast = index === lastIndex;
        const isDone = !isLast;
        const label = BOOKING_STATUS_LABELS[event.to_state as BookingStatus] ?? event.to_state.replaceAll('_', ' ');
        const hint = (viewerRole === 'sender' ? BOOKING_STATUS_HINTS : TRAVELLER_STATUS_HINTS)[
          event.to_state as BookingStatus
        ];
        const actor = event.actor_role
          ? event.actor_role === viewerRole
            ? 'You'
            : event.actor_role === 'sender'
              ? 'Sender'
              : 'Traveller'
          : (ACTOR_LABEL[event.actor_kind] ?? event.actor_kind);

        return (
          <li key={`${event.to_state}-${event.occurred_at}-${index}`} className="relative flex gap-3 pb-5 last:pb-0">
            {!isLast ? <span className="absolute top-5 left-[9px] h-full w-px bg-line" aria-hidden="true" /> : null}

            <span
              className={cn(
                'relative z-10 mt-1 grid h-[19px] w-[19px] shrink-0 place-items-center rounded-full border-2',
                isDone
                  ? 'border-brand-600 bg-brand-600 text-white'
                  : isLast
                    ? 'border-brand-600 bg-surface'
                    : 'border-line-strong bg-surface',
              )}
              aria-hidden="true"
            >
              {isDone ? (
                <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path d="m2.5 6 2.2 2.2L9.5 3.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : (
                <span className={cn('h-2 w-2 rounded-full', isLast ? 'bg-brand-600' : 'bg-line-strong')} />
              )}
            </span>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <p className={cn('text-sm font-semibold', isLast ? 'text-ink-900' : 'text-ink-700')}>{label}</p>
                <time className="tabular text-xs text-ink-500" dateTime={event.occurred_at}>
                  {formatDateTime(event.occurred_at)}
                </time>
              </div>
              <p className="mt-0.5 text-xs text-ink-500">
                {actor}
                {event.reason_code ? ` · ${event.reason_code.replaceAll('_', ' ')}` : ''}
              </p>
              {isLast && hint ? <p className="mt-1 text-sm text-ink-700">{hint}</p> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function LastUpdated({ value, status }: { value: string; status: string }) {
  return (
    <p className="mt-4 border-t border-line pt-3 text-xs text-ink-500">
      Last updated {formatDateTime(value)}
      {status !== 'delivered' ? ' · We don\u2019t track the traveller\u2019s live location. Status updates come from them.' : ''}
    </p>
  );
}
