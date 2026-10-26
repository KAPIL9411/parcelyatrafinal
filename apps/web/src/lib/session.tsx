import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import {
  api,
  bootstrap,
  setAccessToken,
  type AuthResponse,
  type OtpChallenge,
  type Profile,
} from './api';

interface SessionValue {
  user: Profile | null;
  loading: boolean;
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

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const isStaff = isStaffProfile(user);

  // One restore per page load. The refresh cookie is the only durable credential the browser keeps,
  // so a returning visitor is signed in again without ever typing anything.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const restored = await bootstrap();
      if (!restored) {
        if (!cancelled) setLoading(false);
        return;
      }
      try {
        const profile = await api.get<Profile>('/me');
        if (!cancelled) setUser(profile);
      } catch {
        setAccessToken(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
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
  }, []);

  const value = useMemo<SessionValue>(
    () => ({ user, loading, isStaff, requestOtp, verifyOtp, adoptSession, signOut, reload, setUser }),
    [user, loading, isStaff, requestOtp, verifyOtp, adoptSession, signOut, reload],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside SessionProvider');
  return ctx;
}

export { STAFF_ROLES };
