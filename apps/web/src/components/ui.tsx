import {
  forwardRef,
  useEffect,
  useId,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import clsx, { type ClassValue } from 'clsx';

import { errorCopy } from '../lib/copy';
import { inr } from '../lib/format';
import {
  AlertOctagonIcon,
  AlertTriangleIcon,
  CheckCircleIcon,
  CloseIcon,
  InfoIcon,
} from './icons';

export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}

// ----------------------------------------------------------------------------- button

type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'danger' | 'outline';
type ButtonSize = 'sm' | 'md' | 'lg';

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary:
    'bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-700 disabled:bg-brand-200 disabled:hover:bg-brand-200',
  secondary:
    'bg-surface text-ink-900 border border-line hover:border-line-strong hover:bg-canvas disabled:text-ink-300 disabled:border-line',
  tertiary: 'text-brand-700 hover:underline underline-offset-4 disabled:text-ink-300 disabled:no-underline',
  danger:
    'bg-surface text-danger-600 border border-line hover:border-danger-600/40 hover:bg-danger-50 active:bg-danger-50 disabled:text-ink-300 disabled:border-line',
  outline: 'bg-transparent border border-line hover:bg-canvas hover:border-line-strong disabled:text-ink-300 disabled:border-line',
};

const BUTTON_SIZE: Record<ButtonSize, string> = {
  sm: 'min-h-9 px-3 text-sm',
  md: 'h-11 px-4 text-sm',
  lg: 'h-12 px-5 text-[15px]',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  fullWidth?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading = false, fullWidth = false, className, children, disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={props.type ?? 'button'}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'relative inline-flex items-center justify-center gap-2 rounded-input font-semibold transition-colors',
        'disabled:cursor-not-allowed',
        BUTTON_VARIANT[variant],
        BUTTON_SIZE[size],
        fullWidth && 'w-full',
        className,
      )}
      {...props}
    >
      <span className={cn('inline-flex items-center gap-2', loading && 'invisible')}>{children}</span>
      {loading ? (
        <span className="absolute inset-0 grid place-items-center" aria-hidden="true">
          <Dots />
        </span>
      ) : null}
    </button>
  );
});

function Dots() {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current [animation-delay:120ms]" />
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current [animation-delay:240ms]" />
    </span>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-ink-500" role="status">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-line border-t-brand-600" />
      {label}
    </span>
  );
}

// ----------------------------------------------------------------------------- form fields

export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
  optional = false,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  htmlFor?: string;
  children: ReactNode;
  optional?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="flex items-baseline justify-between gap-3 text-sm font-medium text-ink-900">
        <span>{label}</span>
        {optional ? <span className="text-xs font-normal text-ink-500">Optional</span> : null}
      </label>
      {children}
      {error ? (
        <p className="text-sm text-danger-600" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-sm text-ink-500">{hint}</p>
      ) : null}
    </div>
  );
}

const CONTROL =
  'w-full rounded-input border border-line-strong bg-surface px-3 text-[15px] text-ink-900 placeholder:text-ink-300 ' +
  'focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/15 disabled:bg-canvas disabled:text-ink-500';

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function TextInput(
  { className, ...props },
  ref,
) {
  return <input ref={ref} className={cn(CONTROL, 'h-11', className)} {...props} />;
});

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function TextArea(
  { className, rows = 3, ...props },
  ref,
) {
  return <textarea ref={ref} rows={rows} className={cn(CONTROL, 'py-2.5 leading-relaxed', className)} {...props} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...props },
  ref,
) {
  return (
    <select ref={ref} className={cn(CONTROL, 'h-11 appearance-none pr-9', className)} {...props}>
      {children}
    </select>
  );
});

export function Checkbox({
  label,
  description,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode; description?: ReactNode }) {
  const id = useId();
  return (
    <label
      htmlFor={props.id ?? id}
      className={cn('flex cursor-pointer items-start gap-3 rounded-input py-1.5', className)}
    >
      <input
        id={props.id ?? id}
        type="checkbox"
        className="mt-0.5 h-5 w-5 shrink-0 rounded border-line-strong text-brand-600 accent-brand-600"
        {...props}
      />
      <span className="text-sm leading-snug">
        <span className="font-medium text-ink-900">{label}</span>
        {description ? <span className="mt-0.5 block text-ink-500">{description}</span> : null}
      </span>
    </label>
  );
}

// ----------------------------------------------------------------------------- surfaces

export function Card({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('rounded-card border border-line bg-surface p-5 shadow-card sm:p-6', className)} {...props}>
      {children}
    </div>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div className="max-w-2xl">
        {eyebrow ? (
          <p className="mb-1 text-xs font-medium tracking-wide text-ink-500 uppercase">{eyebrow}</p>
        ) : null}
        <h2 className="text-lg font-semibold text-ink-900">{title}</h2>
        {description ? <p className="mt-1 text-sm text-ink-500">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

// ----------------------------------------------------------------------------- banners

type Tone = 'info' | 'warn' | 'danger' | 'success' | 'neutral';

const TONE_STYLES: Record<Tone, { wrap: string; icon: string }> = {
  info: { wrap: 'border-info-600/25 bg-info-50 text-ink-900', icon: 'text-info-600' },
  warn: { wrap: 'border-warn-600/30 bg-warn-50 text-ink-900', icon: 'text-warn-600' },
  danger: { wrap: 'border-danger-600/30 bg-danger-50 text-ink-900', icon: 'text-danger-600' },
  success: { wrap: 'border-success-600/25 bg-success-50 text-ink-900', icon: 'text-success-600' },
  neutral: { wrap: 'border-line bg-canvas text-ink-900', icon: 'text-ink-500' },
};

const TONE_ICON: Record<Tone, (props: { size?: number; className?: string }) => ReactNode> = {
  info: InfoIcon,
  warn: AlertTriangleIcon,
  danger: AlertOctagonIcon,
  success: CheckCircleIcon,
  neutral: InfoIcon,
};

export function Banner({
  tone = 'info',
  title,
  children,
  action,
  className,
  icon = true,
}: {
  tone?: Tone;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
  icon?: boolean;
}) {
  const Icon = TONE_ICON[tone];
  const styles = TONE_STYLES[tone];
  return (
    <div
      className={cn('flex gap-3 rounded-card border px-4 py-3 text-sm', styles.wrap, className)}
      role={tone === 'danger' ? 'alert' : 'status'}
    >
      {icon ? <Icon size={20} className={cn('mt-0.5 shrink-0', styles.icon)} /> : null}
      <div className="min-w-0 flex-1 space-y-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className="text-ink-700 [&_a]:font-semibold [&_a]:text-brand-700 [&_a]:underline">{children}</div> : null}
      </div>
      {action ? <div className="shrink-0 self-center">{action}</div> : null}
    </div>
  );
}

// ----------------------------------------------------------------------------- states

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton rounded-md', className)} aria-hidden="true" />;
}

export function LoadingBlock({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('space-y-2.5', className)} aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading</span>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={cn('h-4', i === 0 ? 'w-2/3' : i === lines - 1 ? 'w-1/2' : 'w-full')} />
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  body,
  action,
  icon,
}: {
  title: string;
  body?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="rounded-card border border-line bg-surface px-6 py-12 text-center">
      {icon ? <div className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-full bg-canvas text-ink-500">{icon}</div> : null}
      <p className="text-base font-semibold text-ink-900">{title}</p>
      {body ? <p className="mx-auto mt-1 max-w-md text-sm text-ink-500">{body}</p> : null}
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function ErrorPanel({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  const copy = errorCopy(error);
  return (
    <div className={cn('rounded-card border border-danger-600/30 bg-danger-50 p-4', className)} role="alert">
      <div className="flex gap-3">
        <AlertOctagonIcon size={20} className="mt-0.5 shrink-0 text-danger-600" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-ink-900">{copy.title}</p>
          <p className="mt-1 text-sm text-ink-700">{copy.body}</p>
          {copy.hint ? <p className="mt-1 text-sm text-ink-500">{copy.hint}</p> : null}
          {error && typeof error === 'object' && 'requestId' in error && (error as { requestId: string | null }).requestId ? (
            <p className="mt-2 font-mono text-xs text-ink-500">
              Reference {(error as { requestId: string | null }).requestId}
            </p>
          ) : null}
          {onRetry ? (
            <Button variant="secondary" size="sm" className="mt-3" onClick={onRetry}>
              Try again
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function SuccessPanel({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-card border border-success-600/25 bg-success-50 p-4" role="status">
      <div className="flex gap-3">
        <CheckCircleIcon size={20} className="mt-0.5 shrink-0 text-success-600" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-ink-900">{title}</p>
          {children ? <div className="mt-1 text-sm text-ink-700">{children}</div> : null}
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------- money

export function MoneyRow({
  label,
  amountPaise,
  note,
  total = false,
}: {
  label: ReactNode;
  amountPaise: number;
  note?: ReactNode;
  total?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex items-baseline justify-between gap-4 py-2 text-sm',
        total && 'mt-1 border-t border-line-strong pt-3 text-base font-semibold',
      )}
    >
      <span className={cn(total ? 'text-ink-900' : 'text-ink-700')}>
        {label}
        {note ? <span className="mt-0.5 block text-xs font-normal text-ink-500">{note}</span> : null}
      </span>
      <span className={cn('tabular shrink-0', total ? 'text-ink-900' : 'text-ink-900')}>{inr(amountPaise)}</span>
    </div>
  );
}

// ----------------------------------------------------------------------------- sheet

export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" className="absolute inset-0 bg-ink-900/45" aria-label="Close" onClick={onClose} />
      <div className="sheet-in relative z-10 max-h-[90vh] w-full overflow-y-auto rounded-t-sheet bg-surface p-5 shadow-bar sm:max-w-lg sm:rounded-sheet">
        <div className="mb-3 flex items-start justify-between gap-4">
          <h2 className="text-lg font-semibold text-ink-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="-mr-1 -mt-1 grid h-9 w-9 place-items-center rounded-full text-ink-500 hover:bg-canvas"
            aria-label="Close"
          >
            <CloseIcon size={20} />
          </button>
        </div>
        <div className="space-y-4 text-sm text-ink-700">{children}</div>
        {footer ? <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">{footer}</div> : null}
      </div>
    </div>
  );
}
