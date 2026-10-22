// Small typed client for api-node (envelope { success, data } / { success: false, error: { code, message } }).
// The bearer token is read through getToken() on every call and is never written to storage or a URL.
// A 401 on a request that carried a token means the session is over (expired, revoked, user suspended): onUnauthorized().
// Error TEXT shown to people comes from i18n keyed by status/code; server messages are English and are not displayed.

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    /** machine-readable extras from the server (the named blockers of a refused sign-off) */
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface DownloadResult {
  blob: Blob;
  filename: string;
  rows: number;
  truncated: boolean;
}

export interface Api {
  /** GET /api/v1/<path> */
  get<T>(path: string, query?: Record<string, string | number | undefined>): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  put<T>(path: string, body?: unknown): Promise<T>;
  patch<T>(path: string, body?: unknown): Promise<T>;
  delete<T>(path: string): Promise<T>;
  /** POST /api/v1/<path> that answers with a file (the audit CSV export). */
  download(path: string, body?: unknown): Promise<DownloadResult>;
  /** GET on an unprefixed public endpoint: /health, /ready, /config/public. No token is sent. */
  root<T>(path: string): Promise<T>;
}

export interface ApiOptions {
  baseUrl: string;
  getToken: () => string | null;
  onUnauthorized: () => void;
  fetchImpl?: typeof fetch;
}

interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: { code?: string; message?: string; details?: Record<string, unknown> };
}

const PREFIX = '/api/v1';

export function createApi({ baseUrl, getToken, onUnauthorized, fetchImpl }: ApiOptions): Api {
  const doFetch = (input: string, init: RequestInit): Promise<Response> =>
    (fetchImpl ?? fetch)(input, init);

  function url(path: string, query?: Record<string, string | number | undefined>): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== '') params.set(key, String(value));
    }
    const qs = params.toString();
    return `${baseUrl}${PREFIX}${path}${qs ? `?${qs}` : ''}`;
  }

  async function send(
    method: string,
    target: string,
    body: unknown,
    withToken: boolean,
  ): Promise<Response> {
    const token = withToken ? getToken() : null;
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers['Authorization'] = `Bearer ${token}`;
    let response: Response;
    try {
      response = await doFetch(target, {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new ApiError(0, 'NETWORK', 'Network error');
    }
    if (response.status === 401 && token) onUnauthorized();
    return response;
  }

  async function fail(response: Response): Promise<never> {
    let code = 'HTTP_ERROR';
    let message = `HTTP ${response.status}`;
    let details: Record<string, unknown> | undefined;
    try {
      const envelope = (await response.json()) as Envelope<unknown>;
      code = envelope.error?.code ?? code;
      message = envelope.error?.message ?? message;
      details = envelope.error?.details;
    } catch {
      /* not JSON: keep the generic values */
    }
    throw new ApiError(response.status, code, message, details);
  }

  async function json<T>(response: Response): Promise<T> {
    if (!response.ok) return fail(response);
    const envelope = (await response.json()) as Envelope<T>;
    if (!envelope.success) return fail(response);
    return envelope.data as T;
  }

  return {
    get: async (path, query) => json(await send('GET', url(path, query), undefined, true)),
    post: async (path, body) => json(await send('POST', url(path), body ?? {}, true)),
    put: async (path, body) => json(await send('PUT', url(path), body ?? {}, true)),
    patch: async (path, body) => json(await send('PATCH', url(path), body ?? {}, true)),
    delete: async (path) => json(await send('DELETE', url(path), undefined, true)),
    root: async (path) => json(await send('GET', `${baseUrl}${path}`, undefined, false)),
    download: async (path, body) => {
      const response = await send('POST', url(path), body ?? {}, true);
      if (!response.ok) return fail(response);
      const disposition = response.headers.get('Content-Disposition') ?? '';
      const match = /filename="([^"]+)"/.exec(disposition);
      return {
        blob: await response.blob(),
        filename: match?.[1] ?? 'download.csv',
        rows: Number(response.headers.get('X-Exported-Rows') ?? 0),
        truncated: response.headers.get('X-Export-Truncated') === 'true',
      };
    },
  };
}
