import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import { api, ApiError, type OtpChallenge } from '../lib/api';
import { errorCopy } from '../lib/copy';
import { normaliseIndianPhone } from '../lib/format';
import { useDocumentTitle } from '../lib/hooks';
import { useSession } from '../lib/session';
import { Banner, Button, Card, ErrorPanel, Field, TextInput } from '../components/ui';
import { OtpInput } from '../components/OtpInput';
import { LockIcon, PhoneIcon, ShieldCheckIcon, GoogleIcon } from '../components/icons';

const DEMO_NUMBERS = [
  { phone: '+919000000001', label: 'Aarti — sender' },
  { phone: '+919000000002', label: 'Imran — verified traveller' },
  { phone: '+919000000009', label: 'Ops — staff roles' },
];

export function Login() {
  useDocumentTitle('Sign in');
  const { user, requestOtp, verifyOtp } = useSession();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const next = params.get('next') ?? '/bookings';

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
      // Get Google authorization URL from backend
      const response = await api.get<{ authorization_url: string; state: string }>(
        '/auth/google/authorize',
        { auth: false }
      );
      
      // Store state for CSRF protection
      localStorage.setItem('google_oauth_state', response.state);
      
      // Redirect to Google OAuth page
      window.location.href = response.authorization_url;
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  const copy = error ? errorCopy(error) : null;

  return (
    <div className="mx-auto grid max-w-4xl gap-6 py-4 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
      <div className="hidden lg:block">
        <div className="rounded-sheet bg-brand-900 p-7 text-white">
          <p className="text-xs font-semibold tracking-wide text-white/60 uppercase">Why phone only</p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight">One number, both sides of the handover.</h1>
          <p className="mt-3 text-sm text-white/75">
            We use your phone number to sign you in and to send the six-digit handover codes. We never show your
            number to the other side — only a masked form.
          </p>

          <ul className="mt-6 space-y-3 text-sm">
            <li className="flex gap-2.5 text-white/80">
              <ShieldCheckIcon size={18} className="mt-0.5 shrink-0 text-accent-500" />
              <span>No password to forget or leak.</span>
            </li>
            <li className="flex gap-2.5 text-white/80">
              <LockIcon size={18} className="mt-0.5 shrink-0 text-accent-500" />
              <span>The full number is never stored — only a hash and the last four digits.</span>
            </li>
            <li className="flex gap-2.5 text-white/80">
              <PhoneIcon size={18} className="mt-0.5 shrink-0 text-accent-500" />
              <span>Codes are sent at the moment they are needed, not in advance.</span>
            </li>
          </ul>
        </div>
      </div>

      <Card className="p-5 sm:p-7">
        <div className="mb-6 flex items-center gap-2 text-sm text-ink-500">
          <span className={stage === 'phone' ? 'font-semibold text-brand-700' : ''}>1. Number</span>
          <span aria-hidden="true">·</span>
          <span className={stage === 'otp' ? 'font-semibold text-brand-700' : ''}>2. Code</span>
        </div>

        {stage === 'phone' ? (
          <form
            className="space-y-5"
            onSubmit={(event) => {
              event.preventDefault();
              void sendCode();
            }}
          >
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-ink-900">Sign in or create an account</h1>
              <p className="mt-1 text-sm text-ink-500">
                We’ll text you a six-digit code. Standard SMS rates may apply.
              </p>
            </div>

            <Field
              label="Mobile number"
              htmlFor="phone"
              error={phoneInvalid ? 'Enter a 10-digit Indian mobile number starting with 6, 7, 8 or 9.' : null}
              hint="We only use this to sign you in and to send handover codes."
            >
              <div className="flex items-stretch gap-2">
                <span className="grid h-12 shrink-0 place-items-center rounded-input border border-line-strong bg-canvas px-3 text-sm font-semibold text-ink-700">
                  +91
                </span>
                <TextInput
                  id="phone"
                  name="phone"
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel-national"
                  autoFocus
                  maxLength={14}
                  placeholder="98765 43210"
                  value={phoneInput}
                  onChange={(event) => setPhoneInput(event.target.value)}
                  aria-invalid={phoneInvalid || undefined}
                />
              </div>
            </Field>

            {error ? <ErrorPanel error={error} /> : null}

            <Button type="submit" fullWidth size="lg" loading={busy} disabled={!phone}>
              Send code
            </Button>

            <div className="relative my-4">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-line"></div>
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="bg-canvas px-2 text-ink-500">Or continue with</span>
              </div>
            </div>

            <Button
              type="button"
              variant="outline"
              fullWidth
              size="lg"
              loading={busy}
              onClick={handleGoogleSignIn}
              className="border-2"
            >
              <GoogleIcon size={20} className="mr-2" />
              Sign in with Google
            </Button>

            <p className="text-xs leading-relaxed text-ink-500">
              By continuing you agree to our{' '}
              <Link to="/terms" className="font-semibold text-brand-700 underline underline-offset-2">
                draft terms
              </Link>{' '}
              and{' '}
              <Link to="/privacy" className="font-semibold text-brand-700 underline underline-offset-2">
                draft privacy notice
              </Link>
              . Booking updates are part of the service. Offers need a separate yes.
            </p>

            {import.meta.env.DEV ? (
              <details className="rounded-input border border-line bg-canvas px-3 py-2 text-sm">
                <summary className="cursor-pointer font-semibold text-ink-700">Demo numbers (local seed)</summary>
                <ul className="mt-2 space-y-1.5">
                  {DEMO_NUMBERS.map((demo) => (
                    <li key={demo.phone} className="flex items-center justify-between gap-3">
                      <span className="text-ink-500">{demo.label}</span>
                      <button
                        type="button"
                        className="tabular font-semibold text-brand-700 underline underline-offset-2"
                        onClick={() => setPhoneInput(demo.phone)}
                      >
                        {demo.phone}
                      </button>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </form>
        ) : (
          <div className="space-y-5">
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
              <Banner tone="warn" title="Test mode: this build can read the code">
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
