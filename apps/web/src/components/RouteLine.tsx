import { cn } from './ui';

/**
 * Static route line. It never animates: the pilot has no live tracking, and a moving marker would
 * imply one.
 */
export function RouteLine({
  from,
  to,
  meta,
  dark = false,
  className,
}: {
  from: string;
  to: string;
  meta?: string;
  dark?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <div className="min-w-0 flex-1">
        <p className={cn('truncate text-sm font-semibold', dark ? 'text-white' : 'text-ink-900')}>{from}</p>
        {meta ? <p className={cn('truncate text-xs', dark ? 'text-white/60' : 'text-ink-500')}>{meta}</p> : null}
      </div>

      <div className="flex shrink-0 items-center gap-1.5" aria-hidden="true">
        <span className={cn('h-2 w-2 rounded-full', dark ? 'bg-accent-500' : 'bg-brand-600')} />
        <span className={cn('h-px w-8 sm:w-12', dark ? 'bg-white/30' : 'bg-line-strong')} />
        <span className={cn('h-2 w-2 rounded-full border-2', dark ? 'border-accent-500' : 'border-brand-600')} />
      </div>

      <div className="min-w-0 flex-1 text-right">
        <p className={cn('truncate text-sm font-semibold', dark ? 'text-white' : 'text-ink-900')}>{to}</p>
        <p className={cn('truncate text-xs', dark ? 'text-white/60' : 'text-ink-500')}>destination</p>
      </div>
    </div>
  );
}
