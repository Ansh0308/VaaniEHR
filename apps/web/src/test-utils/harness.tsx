// Test harness (not shipped): a fake API behind fetch, and the real app tree (router, AuthProvider, toasts, shell) signed
// in as a chosen role through the REAL login code path. Everything here is fake data.
import { act, cleanup, render } from '@testing-library/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import App from '../App';
import type { Role } from '../api/types';
import { AuthProvider, useAuth } from '../auth/AuthContext';
import { ToastProvider } from '../components/ui/Toast';
import i18n from '../i18n';

export interface MockRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
  params: Record<string, string>;
  authorization: string | null;
}
export interface MockReply {
  status?: number;
  /** JSON payload. A plain object is wrapped in { success: true, data } unless `raw` is set. */
  data?: unknown;
  error?: { code: string; message?: string };
  /** Reply with text instead of the JSON envelope (the CSV export). */
  text?: string;
  headers?: Record<string, string>;
}
export type Handler = (req: MockRequest) => MockReply | Promise<MockReply>;

export const IDS = {
  clinic: '5eed0000-0000-4000-8000-000000000001',
  patient: '5eed0000-0000-4000-8000-000000000100',
  session: '5eed0000-0000-4000-8000-0000000000a1',
  user: (role: Role) =>
    ({
      doctor: '5eed0000-0000-4000-8000-000000000012',
      staff: '5eed0000-0000-4000-8000-000000000014',
      admin: '5eed0000-0000-4000-8000-000000000011',
      researcher: '5eed0000-0000-4000-8000-000000000015',
    })[role],
};

export const userFor = (role: Role) => ({
  id: IDS.user(role),
  name: `Fake ${role}`,
  role,
  clinicId: IDS.clinic,
  status: 'approved',
  isSimulated: true,
});

export const fakePatient = (over: Record<string, unknown> = {}) => ({
  id: IDS.patient,
  name: 'Fake Patient',
  phone: '0000000001',
  dob: '1990-05-17',
  gender: 'female',
  email: null,
  optInMsg: true,
  isSimulated: true,
  createdAt: '2026-10-15T10:00:00.000Z',
  allergies: ['Drug-A (FAKE)'],
  ...over,
});

const NOTICE = (language: 'en' | 'gu') => ({
  version: '0.1',
  language,
  status: 'PLACEHOLDER',
  needsReview: language === 'gu',
  title: language === 'en' ? '[PLACEHOLDER] Consent notice' : '[પ્લેસહોલ્ડર] સંમતિ સૂચના',
  body: language === 'en' ? '[PLACEHOLDER] Notice text.' : '[પ્લેસહોલ્ડર] સૂચનાનું લખાણ.',
  scopes: {
    audio: {
      label: language === 'en' ? 'Audio recording' : 'ઓડિયો',
      description: '[PLACEHOLDER] a',
    },
    ai_processing: {
      label: language === 'en' ? 'AI processing' : 'AI',
      description: '[PLACEHOLDER] b',
    },
    whatsapp: {
      label: language === 'en' ? 'WhatsApp summary' : 'WhatsApp',
      description: '[PLACEHOLDER] c',
    },
  },
});
export const fakeNotices = () => ({
  version: '0.1',
  notices: { en: NOTICE('en'), gu: NOTICE('gu') },
});

export const noConsent = () => ({
  sessionId: IDS.session,
  scopes: Object.fromEntries(
    ['audio', 'ai_processing', 'whatsapp'].map((s) => [
      s,
      { granted: false, since: null, noticeVersion: null, noticeLanguage: null, source: null },
    ]),
  ),
  recordingAllowed: false,
  whatsappAllowed: false,
  events: [],
});

export interface Call {
  method: string;
  path: string;
  body: unknown;
  query: Record<string, string>;
  authorization: string | null;
}

/** Routes are keyed "METHOD /path"; a segment like ":id" matches any value and lands in req.params. */
export function installApi(routes: Record<string, Handler>) {
  const calls: Call[] = [];
  const compiled = Object.entries(routes).map(([key, handler]) => {
    const [method = 'GET', pattern = '/'] = key.split(' ');
    const names: string[] = [];
    const regex = new RegExp(
      `^${pattern.replace(/:([A-Za-z]+)/g, (_m, name: string) => {
        names.push(name);
        return '([^/]+)';
      })}$`,
    );
    return { method, regex, names, handler };
  });

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = (init?.method ?? 'GET').toUpperCase();
    const path = url.pathname.replace(/^\/api\/v1/, '');
    const headers = new Headers(init?.headers);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({
      method,
      path,
      body,
      query: Object.fromEntries(url.searchParams),
      authorization: headers.get('Authorization'),
    });
    for (const route of compiled) {
      if (route.method !== method) continue;
      const match = route.regex.exec(path);
      if (!match) continue;
      const params = Object.fromEntries(route.names.map((n, i) => [n, match[i + 1] ?? '']));
      const reply = await route.handler({
        method,
        path,
        query: url.searchParams,
        body,
        params,
        authorization: headers.get('Authorization'),
      });
      const status = reply.status ?? (reply.error ? 400 : 200);
      if (reply.text !== undefined) {
        return new Response(reply.text, { status, headers: reply.headers ?? {} });
      }
      const envelope = reply.error
        ? { success: false, error: reply.error }
        : { success: true, data: reply.data };
      return new Response(JSON.stringify(envelope), {
        status,
        headers: { 'Content-Type': 'application/json', ...(reply.headers ?? {}) },
      });
    }
    return new Response(
      JSON.stringify({
        success: false,
        error: { code: 'NOT_FOUND', message: `no mock for ${method} ${path}` },
      }),
      { status: 404, headers: { 'Content-Type': 'application/json' } },
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return {
    calls,
    fetchMock,
    callsTo: (method: string, path: string) =>
      calls.filter((c) => c.method === method && c.path === path),
  };
}

/** The routes every signed-in screen needs. */
export const baseRoutes = (role: Role): Record<string, Handler> => ({
  'POST /auth/login': () => ({
    data: {
      accessToken: `fake-token-${role}`,
      tokenType: 'Bearer',
      expiresIn: 3600,
      user: userFor(role),
    },
  }),
  'POST /auth/logout': () => ({ data: { loggedOut: true } }),
  'GET /health': () => ({ data: { status: 'ok' } }),
});

function AutoLogin({ role, children }: { role: Role; children: ReactNode }) {
  const { login } = useAuth();
  const [ready, setReady] = useState(false);
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    // sign in through the real code path once; afterwards the real app (guards included) decides what to show
    void login(`${role}@example.invalid`, 'fake-password').finally(() => setReady(true));
  }, [login, role]);
  return ready ? <>{children}</> : null;
}

export interface RenderOptions {
  role: Role;
  path: string;
  routes?: Record<string, Handler>;
  language?: 'en' | 'gu';
}

/** Renders the real app signed in as `role`. Overlays set `inert` on #root, so it mounts inside a #root like the real app. */
export async function renderApp({ role, path, routes = {}, language = 'en' }: RenderOptions) {
  await act(() => i18n.changeLanguage(language));
  const api = installApi({ ...baseRoutes(role), ...routes });
  const root = document.createElement('div');
  root.id = 'root';
  document.body.appendChild(root);
  const view = render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <ToastProvider>
          <AutoLogin role={role}>
            <App />
          </AutoLogin>
        </ToastProvider>
      </AuthProvider>
    </MemoryRouter>,
    { container: root },
  );
  // let the sign-in finish and the first screen render
  await act(async () => {
    await Promise.resolve();
  });
  return { ...view, ...api };
}

/** Renders the real app signed OUT at a path (login page, guards). */
export async function renderSignedOut(
  path: string,
  routes: Record<string, Handler> = {},
  language: 'en' | 'gu' = 'en',
) {
  await act(() => i18n.changeLanguage(language));
  const api = installApi({ ...baseRoutes('doctor'), ...routes });
  const root = document.createElement('div');
  root.id = 'root';
  document.body.appendChild(root);
  const view = render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </AuthProvider>
    </MemoryRouter>,
    { container: root },
  );
  return { ...view, ...api };
}

export function cleanupApp() {
  cleanup();
  document.getElementById('root')?.remove();
  vi.unstubAllGlobals();
}
