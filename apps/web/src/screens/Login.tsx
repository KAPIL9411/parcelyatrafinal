import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import { api, ApiError, type OtpChallenge } from '../lib/api';
import { errorCopy } from '../lib/copy';
import { normaliseIndianPhone } from '../lib/format';
import { safeNext } from '../lib/nav';
import { useDocumentTitle } from '../lib/hooks';
import { useSession } from '../lib/session';
import { Banner, Button, Card, ErrorPanel, Field, Skeleton, TextInput } from '../components/ui';
import { OtpInput } from '../components/OtpInput';
import { LockIcon, PhoneIcon, ShieldCheckIcon, GoogleIcon } from '../components/icons';

export function Login() {
  useDocumentTitle('Sign in');
  const { user, status, requestOtp, verifyOtp } = useSession();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const next = safeNext(params.get('next'));

  const [stage, setStage] = useState<'phone' | 'otp'>('phone');
  const [phoneInput, setPhoneInput] = useState('');
  const [challenge, setChallenge] = useState<OtpChallenge | null>(null);
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const [otpError, setOtpError] = useState(false);
  const verifying = useRef(false);

  const phone = normaliseIndianPhone(phoneInput);
  const phoneInvalid = phoneInput.replace(/\D/g, '').length >= 10 && !phone;

  useEffect(() => {
    if (user) navigate(next, { replace: true });
  }, [user, navigate, next]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const id = window.setInterval(() => setResendIn((s) => Math.max(0, s - 1)), 1000);
    return () => window.clearInterval(id);
  }, [resendIn]);

  async function sendCode() {
    if (!phone || busy) return;
    setBusy(true);
    setError(null);
    setCode('');
    setOtpError(false);
    try {
      const created = await requestOtp(phone);
      setChallenge(created);
      setStage('otp');
      setResendIn(30);

      // Development convenience: the server keeps the code in memory when dev endpoints are on.
      // If this call fails, the panel simply never appears.
      try {
        const peek = await api.get<{ code: string }>(`/dev/otp/${created.challenge_id}`, { auth: false });
        setDevCode(peek.code);
      } catch {
        setDevCode(null);
      }
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(value: string) {
    if (!challenge || verifying.current) return;
    verifying.current = true;
    setBusy(true);
    setError(null);
    try {
      await verifyOtp(challenge.challenge_id, value);
      navigate(next, { replace: true });
    } catch (err) {
      setCode('');
      setOtpError(true);
      setError(err);
      window.setTimeout(() => setOtpError(false), 700);
    } finally {
      setBusy(false);
      verifying.current = false;
    }
  }

  // Google Sign-In handler
  async function handleGoogleSignIn() {
    if (busy) return;
    
    setBusy(true);
    setError(null);
    
    try {
      // The API answers with the Google URL, a `state` that carries the PKCE verifier and the nonce
      // sealed so only the API can read them, and the handshake binding. The binding is what proves,
      // at the callback, that the browser finishing the flow is the browser that started it.
      const response = await api.get<{
        authorization_url: string;
        state: string;
        handshake_binding: string;
      }>('/auth/google/authorize', { auth: false });

      sessionStorage.setItem('py.next', next);
      // The API also sets it as an HttpOnly cookie. Keeping this copy is what lets a browser that
      // refuses third-party cookies — Safari, Firefox, Chrome incognito — complete the sign-in.
      sessionStorage.setItem('py.oauth', response.handshake_binding);
      window.location.href = response.authorization_url;
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  const copy = error ? errorCopy(error) : null;

  return (
    <div className="mx-auto grid max-w-4xl gap-6 py-4 lg:grid-cols-[0.9fr_1.1fr]">
      <div>
        <div className="flex h-full flex-col rounded-sheet bg-brand-900 p-7 text-white">
          <p className="text-xs font-medium tracking-wide text-white/55 uppercase">Google or a code</p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight">Google, or a phone number and a code.</h1>
          <p className="mt-3 text-sm text-white/75">
            Signing in with Google is enough to post and carry parcels — we use the address Google has
            already verified for you. A phone number is optional, and useful if you want the masked
            number shown to the other side of a handover.
          </p>

          <ul className="mt-6 space-y-3 text-sm">
            <li className="flex gap-2.5 text-white/80">
              <ShieldCheckIcon size={18} className="mt-0.5 shrink-0 text-accent-500" />
              <span>No password to forget or leak.</span>
            </li>
            <li className="flex gap-2.5 text-white/80">
              <LockIcon size={18} className="mt-0.5 shrink-0 text-accent-500" />
              <span>Pickup and delivery codes are shown in the app, never sent in advance.</span>
            </li>
            <li className="flex gap-2.5 text-white/80">
              <PhoneIcon size={18} className="mt-0.5 shrink-0 text-accent-500" />
              <span>If you add a number, the other side only ever sees a masked form of it.</span>
            </li>
          </ul>
        </div>
      </div>

      <Card>
        {status === 'loading' ? (
          <SignInPending />
        ) : stage === 'phone' ? (
          <div className="space-y-5">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-ink-900">Sign in or create an account</h1>
              <p className="mt-1 text-sm text-ink-500">
                No password. Use Google, or a six-digit code sent to your phone.
              </p>
            </div>

            <Button type="button" fullWidth size="lg" loading={busy} onClick={handleGoogleSignIn}>
              <GoogleIcon size={20} />
              Sign in with Google
            </Button>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-line" />
              </div>
              <div className="relative flex justify-center">
                <span className="bg-surface px-3 text-xs text-ink-500">or use a phone number</span>
              </div>
            </div>

            <form
              className="space-y-5"
              onSubmit={(event) => {
                event.preventDefault();
                void sendCode();
              }}
            >
              <Field
                label="Mobile number"
                htmlFor="phone"
                error={phoneInvalid ? 'Enter a 10-digit Indian mobile number starting with 6, 7, 8 or 9.' : null}
                hint="We only use this to sign you in and to send handover codes."
              >
                <div className="flex items-stretch gap-2">
                  <span className="grid h-11 shrink-0 place-items-center rounded-input border border-line-strong bg-canvas px-3 text-sm font-medium text-ink-700 tabular">
                    +91
                  </span>
                  <TextInput
                    id="phone"
                    name="phone"
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel-national"
                    maxLength={14}
                    placeholder="98765 43210"
                    value={phoneInput}
                    onChange={(event) => setPhoneInput(event.target.value)}
                    aria-invalid={phoneInvalid || undefined}
                  />
                </div>
              </Field>

              {error ? <ErrorPanel error={error} /> : null}

              <Button type="submit" variant="secondary" fullWidth size="lg" loading={busy} disabled={!phone}>
                Send code
              </Button>
            </form>

            <p className="text-xs leading-relaxed text-ink-500">
              By continuing you agree to our{' '}
              <Link to="/terms" className="font-semibold text-brand-700 underline underline-offset-2">
                terms
              </Link>{' '}
              and{' '}
              <Link to="/privacy" className="font-semibold text-brand-700 underline underline-offset-2">
                privacy notice
              </Link>
              . Booking updates are part of the service. Offers need a separate yes.
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="flex items-center gap-2 text-sm text-ink-500">
              <span>1. Number</span>
              <span aria-hidden="true">·</span>
              <span className="font-semibold text-ink-900">2. Code</span>
            </div>

            <div>
              <h1 className="text-2xl font-bold tracking-tight text-ink-900">Enter the code</h1>
              <p className="mt-1 text-sm text-ink-500">
                Sent to {challenge?.phone_masked ?? phone}. It expires in five minutes.
              </p>
            </div>

            <OtpInput
              value={code}
              onChange={setCode}
              onComplete={(value) => void submitCode(value)}
              disabled={busy}
              error={otpError}
              autoFocus
            />

            {copy && (error as ApiError)?.code !== 'OTP_INVALID' ? (
              <ErrorPanel error={error} />
            ) : copy ? (
              <p className="text-sm text-danger-600" role="alert">
                {copy.title}. {copy.body}
              </p>
            ) : null}

            <Button fullWidth size="lg" loading={busy} disabled={code.length !== 6} onClick={() => void submitCode(code)}>
              Verify and continue
            </Button>

            <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
              <button
                type="button"
                className="font-semibold text-brand-700 underline underline-offset-2 disabled:text-ink-300 disabled:no-underline"
                disabled={resendIn > 0 || busy}
                onClick={() => void sendCode()}
              >
                {resendIn > 0 ? `Resend in 0:${String(resendIn).padStart(2, '0')}` : 'Resend code'}
              </button>
              <button
                type="button"
                className="text-ink-500 hover:text-ink-900"
                onClick={() => {
                  setStage('phone');
                  setCode('');
                  setError(null);
                  setDevCode(null);
                }}
              >
                Use a different number
              </button>
            </div>

            {devCode ? (
              <Banner tone="warn" title="Development build: this code is readable in memory">
                <p>
                  The database stores only a hash. The running API keeps the code in memory because development
                  endpoints are enabled.
                </p>
                <button
                  type="button"
                  className="mt-1 font-semibold text-brand-700 underline underline-offset-2"
                  onClick={() => {
                    setCode(devCode);
                    void submitCode(devCode);
                  }}
                >
                  Fill {devCode} and continue
                </button>
              </Banner>
            ) : null}
          </div>
        )}
      </Card>
    </div>
  );
}

/**
 * Stands in for the phone stage while the session check runs, so a returning visitor is never shown
 * the form they are about to be redirected away from. It mirrors the phone stage block for block —
 * heading, Google button, divider, labelled field with its hint, submit button, legal line — so the
 * card does not change height when the real form replaces it.
 */
function SignInPending() {
  return (
    <div className="space-y-5" aria-busy="true" aria-live="polite">
      <span className="sr-only">Checking whether you are already signed in</span>
      <div>
        <Skeleton className="h-8 w-4/5" />
        <Skeleton className="mt-2 h-4 w-3/5" />
      </div>
      <Skeleton className="h-12 w-full rounded-input" />
      <Skeleton className="mx-auto h-4 w-2/5" />
      <div className="space-y-2">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-11 w-full rounded-input" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-2/3" />
      </div>
      <Skeleton className="h-12 w-full rounded-input" />
      <div className="space-y-2">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-3/4" />
      </div>
    </div>
  );
}
