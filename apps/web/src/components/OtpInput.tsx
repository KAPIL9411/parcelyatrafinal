import { useEffect, useRef } from 'react';

import { cn } from './ui';

const LENGTH = 6;

/**
 * Six-box OTP input: numeric keypad, paste-aware, auto-advance, auto-submit on the sixth digit.
 * Errors are shown as text by the caller as well as by the shake here — never colour alone.
 */
export function OtpInput({
  value,
  onChange,
  onComplete,
  disabled = false,
  error = false,
  autoFocus = false,
  label = 'Six-digit code',
}: {
  value: string;
  onChange: (next: string) => void;
  onComplete?: (code: string) => void;
  disabled?: boolean;
  error?: boolean;
  autoFocus?: boolean;
  label?: string;
}) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const submitted = useRef<string | null>(null);
  const digits = value.split('');

  useEffect(() => {
    if (autoFocus) refs.current[0]?.focus();
  }, [autoFocus]);

  useEffect(() => {
    if (value.length < LENGTH) submitted.current = null;
    if (value.length === LENGTH && onComplete && submitted.current !== value) {
      submitted.current = value;
      onComplete(value);
    }
  }, [value, onComplete]);

  function write(next: string, focusIndex?: number) {
    const clean = next.replace(/\D/g, '').slice(0, LENGTH);
    onChange(clean);
    if (focusIndex !== undefined) {
      const target = Math.min(clean.length, LENGTH - 1);
      refs.current[target]?.focus();
      if (clean.length === LENGTH) refs.current[LENGTH - 1]?.blur();
    }
  }

  return (
    <div
      className={cn('flex gap-2', error && 'shake')}
      role="group"
      aria-label={label}
      onPaste={(event) => {
        const text = event.clipboardData.getData('text');
        if (/\d/.test(text)) {
          event.preventDefault();
          write(text, 0);
        }
      }}
    >
      {Array.from({ length: LENGTH }).map((_, index) => (
        <input
          key={index}
          ref={(el) => {
            refs.current[index] = el;
          }}
          value={digits[index] ?? ''}
          onChange={(event) => {
            const incoming = event.target.value.replace(/\D/g, '');
            if (!incoming) {
              const next = value.slice(0, index) + value.slice(index + 1);
              onChange(next);
              return;
            }
            if (incoming.length > 1) {
              write(value.slice(0, index) + incoming, index);
              return;
            }
            const chars = value.padEnd(LENGTH, ' ').split('');
            chars[index] = incoming;
            const joined = chars.join('').replace(/\s/g, '');
            onChange(joined.slice(0, LENGTH));
            if (index < LENGTH - 1) refs.current[index + 1]?.focus();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Backspace' && !digits[index] && index > 0) {
              event.preventDefault();
              const next = value.slice(0, Math.max(0, index - 1));
              onChange(next);
              refs.current[index - 1]?.focus();
            }
            if (event.key === 'ArrowLeft' && index > 0) refs.current[index - 1]?.focus();
            if (event.key === 'ArrowRight' && index < LENGTH - 1) refs.current[index + 1]?.focus();
          }}
          disabled={disabled}
          inputMode="numeric"
          autoComplete={index === 0 ? 'one-time-code' : 'off'}
          aria-label={`Digit ${index + 1} of ${LENGTH}`}
          maxLength={1}
          className={cn(
            'tabular h-14 w-full max-w-14 rounded-input border bg-surface text-center text-2xl font-semibold text-ink-900',
            'focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20',
            error ? 'border-danger-600' : 'border-line-strong',
            disabled && 'bg-canvas text-ink-300',
          )}
        />
      ))}
    </div>
  );
}
