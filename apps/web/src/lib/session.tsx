import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import {
  api,
  clearTokens,
  readTokens,
  writeTokens,
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
  signOut: () => Promise<void>;
  reload: () => Promise<void>;
  setUser: (user: Profile | null) => void;
}

const SessionContext = createContext<SessionValue | null>(null);

const STAFF_ROLES = ['support_agent', 'trust_safety', 'finance', 'admin_readonly', 'verification_reviewer', 'support_lead'];

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

  const reload = useCallback(async () => {
    if (!readTokens()) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const profile = await api.get<Profile>('/me');
      setUser(profile);
    } catch {
      // A failed `/me` with tokens present means the session is gone. Never keep a ghost user.
      clearTokens();
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const requestOtp = useCallback(async (phone: string) => {
    return api.post<OtpChallenge>('/auth/otp/request', { phone, purpose: 'login' }, { auth: false });
  }, []);

  const verifyOtp = useCallback(async (challengeId: string, code: string) => {
    const res = await api.post<AuthResponse>(
      '/auth/otp/verify',
      { challenge_id: challengeId, code },
      { auth: false },
    );
    writeTokens({ access_token: res.access_token, refresh_token: res.refresh_token });
    setUser(res.user);
    return res.user;
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api.post('/auth/logout', {}, { idempotencyKey: crypto.randomUUID() });
    } catch {
      // Signing out locally must succeed even if the server call does not.
    }
    clearTokens();
    setUser(null);
  }, []);

  const value = useMemo<SessionValue>(
    () => ({ user, loading, isStaff, requestOtp, verifyOtp, signOut, reload, setUser }),
    [user, loading, isStaff, requestOtp, verifyOtp, signOut, reload],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside SessionProvider');
  return ctx;
}

export { STAFF_ROLES };
