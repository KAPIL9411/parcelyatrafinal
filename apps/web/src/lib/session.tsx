import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import {
  api,
  bootstrap,
  setAccessToken,
  type AuthResponse,
  type OtpChallenge,
  type Profile,
} from './api';

/**
 * Three states, because "still finding out" and "nobody is signed in" are different answers and the
 * UI has to be able to tell them apart. Anything that treats `loading` as signed out shows a Sign In
 * button for a second and then yanks it away.
 */
type SessionStatus = 'loading' | 'authenticated' | 'unauthenticated';

interface SessionValue {
  user: Profile | null;
  status: SessionStatus;
  /** True when the signed-in account holds any staff role. */
  isStaff: boolean;
  requestOtp: (phone: string) => Promise<OtpChallenge>;
  verifyOtp: (challengeId: string, code: string) => Promise<Profile>;
  /** Used by the Google callback, which gets the same shape back from a different endpoint. */
  adoptSession: (res: AuthResponse) => Profile;
  signOut: (everywhere?: boolean) => Promise<void>;
  reload: () => Promise<void>;
  /** Replace the cached profile after the server confirms an update to it. */
  setUser: (user: Profile | null) => void;
}

const SessionContext = createContext<SessionValue | null>(null);

const STAFF_ROLES = ['support_agent', 'trust_safety', 'finance', 'admin_readonly', 'verification_reviewer'];

/**
 * Staff detection reads the caller's own roles from `/me`. `status` roles exist too, so the check
 * is "any role in the staff set", not "roles is non-empty".
 */
function isStaffProfile(user: Profile | null): boolean {
  if (!user) return false;
  return (user.roles ?? []).some((role) => STAFF_ROLES.includes(role));
}

/**
 * The restore is memoised for the page load rather than per component mount. The provider mounts
 * twice under React's StrictMode in development, and a second `POST /auth/refresh` rotates the pair
 * the first one is still waiting on. One promise, one answer, reused.
 */
let restoreInFlight: Promise<Profile | null> | null = null;

function restoreSession(): Promise<Profile | null> {
  restoreInFlight ??= (async () => {
    // The refresh cookie is the only durable credential the browser keeps, so a returning visitor is
    // signed in again without ever typing anything.
    if (!(await bootstrap())) return null;
    try {
      return await api.get<Profile>('/me');
    } catch {
      setAccessToken(null);
      return null;
    }
  })().catch(() => {
    // A failed request is "not signed in right now", not "keep the visitor on a skeleton for the rest
    // of the page load". `fetch` rejects outright with no connection, and nothing here may hang.
    setAccessToken(null);
    return null;
  });
  return restoreInFlight;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Profile | null>(null);
  const [restoring, setRestoring] = useState(true);
  const status: SessionStatus = restoring ? 'loading' : user ? 'authenticated' : 'unauthenticated';
  const isStaff = isStaffProfile(user);

  useEffect(() => {
    let cancelled = false;
    void restoreSession().then((profile) => {
      if (cancelled) return;
      if (profile) setUser(profile);
      setRestoring(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const reload = useCallback(async () => {
    try {
      const profile = await api.get<Profile>('/me');
      setUser(profile);
    } catch {
      // A failed `/me` means the session is gone. Never keep a ghost user.
      setAccessToken(null);
      setUser(null);
    }
  }, []);

  const requestOtp = useCallback(async (phone: string) => {
    return api.post<OtpChallenge>('/auth/otp/request', { phone, purpose: 'login' }, { auth: false });
  }, []);

  const adoptSession = useCallback((res: AuthResponse) => {
    setAccessToken(res.access_token);
    setUser(res.user);
    // The signed-in answer for this page load is now this session, not whatever the cookie said
    // before it was exchanged.
    restoreInFlight = Promise.resolve(res.user);
    return res.user;
  }, []);

  const verifyOtp = useCallback(
    async (challengeId: string, code: string) => {
      const res = await api.post<AuthResponse>('/auth/otp/verify', { challenge_id: challengeId, code }, { auth: false });
      return adoptSession(res);
    },
    [adoptSession],
  );

  const signOut = useCallback(async (everywhere = false) => {
    try {
      await api.post(everywhere ? '/auth/logout-all' : '/auth/logout', {});
    } catch {
      // Signing out locally must succeed even if the server call does not.
    }
    setAccessToken(null);
    setUser(null);
    restoreInFlight = Promise.resolve(null);
  }, []);

  const value = useMemo<SessionValue>(
    () => ({ user, status, isStaff, requestOtp, verifyOtp, adoptSession, signOut, reload, setUser }),
    [user, status, isStaff, requestOtp, verifyOtp, adoptSession, signOut, reload],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside SessionProvider');
  return ctx;
}

export { STAFF_ROLES };
