// Sign-in state. TOKEN HANDLING (owner rule for Phase 2B):
//  - the access token lives only in memory (a ref inside this provider). It is never written to localStorage,
//    sessionStorage, cookies or a URL, so a script injected into the page cannot read it from storage;
//  - reloading the page therefore signs the person out (there is no refresh token in standalone mode, ADR-D4);
//  - it is dropped on logout, on a 401 from the API (expired, revoked or suspended) and when its lifetime ends,
//    and the login page then says the session ended;
//  - logout also revokes the token on the server.
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
import { createApi, type Api } from '../api/client';
import type { LoginResult, Role, User } from '../api/types';
import { config } from '../config';

export interface AuthValue {
  user: User | null;
  api: Api;
  /** Throws ApiError on failure (401 wrong credentials, 429 locked or rate limited, 403 not allowed). */
  login: (email: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
  /** True after a signed-in session was ended by expiry, revocation or a 401. */
  sessionEnded: boolean;
  acknowledgeSessionEnded: () => void;
}

export const AuthContext = createContext<AuthValue | null>(null);

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}

/** Where each role lands after signing in (PRD section 4 page list). */
export function homeFor(role: Role): string {
  if (role === 'doctor') return '/doctor';
  if (role === 'staff') return '/patients';
  return '/admin/audit'; // admin and researcher
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [sessionEnded, setSessionEnded] = useState(false);
  const tokenRef = useRef<string | null>(null);
  const timerRef = useRef<number | undefined>(undefined);

  const endSession = useCallback((expired: boolean) => {
    window.clearTimeout(timerRef.current);
    tokenRef.current = null;
    setUser(null);
    if (expired) setSessionEnded(true);
  }, []);

  const api = useMemo(
    () =>
      createApi({
        baseUrl: config.apiBaseUrl,
        getToken: () => tokenRef.current,
        onUnauthorized: () => endSession(true),
      }),
    [endSession],
  );

  const login = useCallback(
    async (email: string, password: string): Promise<User> => {
      const result = await api.post<LoginResult>('/auth/login', { email, password });
      tokenRef.current = result.accessToken;
      window.clearTimeout(timerRef.current);
      // end the session a little before the server would refuse the token
      timerRef.current = window.setTimeout(
        () => endSession(true),
        Math.max(1, result.expiresIn - 5) * 1000,
      );
      setSessionEnded(false);
      setUser(result.user);
      return result.user;
    },
    [api, endSession],
  );

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      /* the token is dropped locally either way */
    }
    endSession(false);
  }, [api, endSession]);

  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  const value = useMemo<AuthValue>(
    () => ({
      user,
      api,
      login,
      logout,
      sessionEnded,
      acknowledgeSessionEnded: () => setSessionEnded(false),
    }),
    [user, api, login, logout, sessionEnded],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
