import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
// Extensionless on purpose: `secret-store.web.ts` replaces the platform keystore in the browser
// build, and a `.ts`-suffixed specifier pins Metro to the native file.
import { readSecret, writeSecret, deleteSecret } from './lib/secret-store';
import { useQueryClient } from '@tanstack/react-query';

import {
  bootstrapSession,
  completeGoogleCallback as apiGoogleCallback,
  me,
  requestOtp,
  signInWithGoogle as apiGoogleSignIn,
  signOut as apiSignOut,
  verifyOtp as apiVerifyOtp,
} from './api/client.ts';
import { ApiError } from './api/http.ts';
import type { AuthResponse, OtpChallenge, Profile } from './api/types.ts';
import { stopDriverLocationService } from './tracking/LocationService';

const PROFILE_KEY = 'py.profile';

/**
 * How long a restored session may take to prove itself before the app shows the sign-in screen.
 * The transport allows 30s for one cold call; this sits under it so a hung boot still resolves, and
 * well above the point where a warm API has already answered.
 */
const BOOT_CEILING_MS = 15_000;

export type SessionStatus = 'booting' | 'signed_out' | 'signed_in';

interface SessionValue {
  status: SessionStatus;
  user: Profile | null;
  /** True when a stored session exists but the server could not be reached. */
  offline: boolean;
  sendOtp: (phone: string) => Promise<OtpChallenge & { phone_masked: string }>;
  verifyOtp: (challengeId: string, code: string) => Promise<AuthResponse>;
  googleSignIn: (idToken: string) => Promise<AuthResponse>;
  googleCallback: (code: string, state: string, binding?: string | null) => Promise<AuthResponse>;
  refreshProfile: () => Promise<Profile | null>;
  signOut: (everywhere?: boolean) => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

async function cacheProfile(profile: Profile | null): Promise<void> {
  if (profile) await writeSecret(PROFILE_KEY, JSON.stringify(profile));
  else await deleteSecret(PROFILE_KEY);
}

async function readCachedProfile(): Promise<Profile | null> {
  const raw = await readSecret(PROFILE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Profile;
  } catch {
    return null;
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>('booting');
  const [user, setUser] = useState<Profile | null>(null);
  const [offline, setOffline] = useState(false);
  const queryClient = useQueryClient();
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;

    // A ceiling on boot, not a deadline. The splash must not hang on an unreachable API, but a
    // cold-starting server is still worth waiting for. Reading `status` here would be the bug: this
    // effect runs once, so its closure holds the opening `'booting'` forever and the timer would
    // sign out any session that simply took longer than the ceiling to restore.
    let settled = false;
    const maxBootTimeout = setTimeout(() => {
      if (mounted.current && !settled) {
        console.warn('[Session] Boot timed out - presenting the sign-in screen');
        setStatus('signed_out');
      }
    }, BOOT_CEILING_MS);
    void (async () => {
      try {
        const result = await bootstrapSession();
        if (!mounted.current) return;

        if (result === 'signed_in') {
          try {
            const profile = await me();
            if (!mounted.current) return;
            setUser(profile);
            setOffline(false);
            setStatus('signed_in');
            await cacheProfile(profile);
            return;
          } catch (err) {
            // A rejected token ends the session. A transport failure keeps the last known profile so
            // the app opens usable instead of flashing the sign-in screen on a bad connection.
            if (err instanceof ApiError && err.status === 401) {
              await cacheProfile(null);
              setStatus('signed_out');
              return;
            }
            const cached = await readCachedProfile();
            if (cached) {
              setUser(cached);
              setOffline(true);
              setStatus('signed_in');
            } else {
              setStatus('signed_out');
            }
            return;
          }
        }

        if (result === 'offline') {
          const cached = await readCachedProfile();
          if (cached) {
            setUser(cached);
            setOffline(true);
            setStatus('signed_in');
          } else {
            setStatus('signed_out');
          }
          return;
        }

        setStatus('signed_out');
      } catch (error) {
        // If bootstrap completely fails, don't leave user stuck on splash
        console.error('[Session] Bootstrap error:', error);
        if (mounted.current) {
          setStatus('signed_out');
        }
      } finally {
        settled = true;
        clearTimeout(maxBootTimeout);
      }
    })();

    return () => {
      mounted.current = false;
      clearTimeout(maxBootTimeout);
    };
  }, []);

  const adopter = useCallback(
    async (session: AuthResponse): Promise<AuthResponse> => {
      setUser(session.user);
      setOffline(false);
      setStatus('signed_in');
      await cacheProfile(session.user);
      void queryClient.invalidateQueries();
      return session;
    },
    [queryClient],
  );

  const sendOtp = useCallback(async (phone: string) => requestOtp(phone), []);

  const verifyOtp = useCallback(
    async (challengeId: string, code: string) => adopter(await apiVerifyOtp(challengeId, code)),
    [adopter],
  );

  const googleSignIn = useCallback(
    async (idToken: string) => adopter(await apiGoogleSignIn(idToken)),
    [adopter],
  );

  const googleCallback = useCallback(
    async (code: string, state: string, binding?: string | null) =>
      adopter(await apiGoogleCallback(code, state, binding)),
    [adopter],
  );

  const refreshProfile = useCallback(async () => {
    try {
      const profile = await me();
      setUser(profile);
      setOffline(false);
      await cacheProfile(profile);
      return profile;
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.code === 'AUTH_REQUIRED')) {
        setUser(null);
        setStatus('signed_out');
        await cacheProfile(null);
      }
      return null;
    }
  }, []);

  const signOut = useCallback(
    async (everywhere = false) => {
      // A courier signing out must not keep a foreground GPS notification alive.
      await stopDriverLocationService().catch(() => {});
      queryClient.clear();
      await apiSignOut(everywhere);
      setUser(null);
      setOffline(false);
      setStatus('signed_out');
      await cacheProfile(null);
    },
    [queryClient],
  );

  const value = useMemo<SessionValue>(
    () => ({
      status,
      user,
      offline,
      sendOtp,
      verifyOtp,
      googleSignIn,
      googleCallback,
      refreshProfile,
      signOut,
    }),
    [
      status,
      user,
      offline,
      sendOtp,
      verifyOtp,
      googleSignIn,
      googleCallback,
      refreshProfile,
      signOut,
    ],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside SessionProvider');
  return value;
}
