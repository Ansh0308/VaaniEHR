// The API client: envelope handling, token use, 401 handling, query building, downloads. No network.
import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApi } from './client';

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

function make(
  token: string | null = 'tok',
  reply: () => Response | Promise<Response> = () => json(200, { success: true, data: { x: 1 } }),
) {
  const onUnauthorized = vi.fn();
  const fetchImpl = vi.fn(async () => reply()) as unknown as typeof fetch;
  const api = createApi({
    baseUrl: 'http://api.test',
    getToken: () => token,
    onUnauthorized,
    fetchImpl,
  });
  return { api, onUnauthorized, fetchImpl: fetchImpl as unknown as ReturnType<typeof vi.fn> };
}

describe('createApi', () => {
  it('returns data from the success envelope', async () => {
    const { api } = make();
    expect(await api.get('/things')).toEqual({ x: 1 });
  });

  it('sends the bearer token, JSON body and method on POST/PUT', async () => {
    const { api, fetchImpl } = make();
    await api.post('/things', { a: 1 });
    await api.put('/things/1', { b: 2 });
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://api.test/api/v1/things');
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"a":1}');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer tok');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect((fetchImpl.mock.calls[1] as [string, RequestInit])[1].method).toBe('PUT');
  });

  it('sends no Authorization header when there is no token (login)', async () => {
    const { api, fetchImpl } = make(null);
    await api.post('/auth/login', { email: 'a', password: 'b' });
    const init = (fetchImpl.mock.calls[0] as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>)['Authorization']).toBeUndefined();
  });

  it('builds the query string, skipping undefined and empty values, and encoding the rest', async () => {
    const { api, fetchImpl } = make();
    await api.get('/audit', { limit: 50, action: '', from: undefined, q: 'a b&c' });
    expect((fetchImpl.mock.calls[0] as [string])[0]).toBe(
      'http://api.test/api/v1/audit?limit=50&q=a+b%26c',
    );
  });

  it('turns an error envelope into an ApiError with status and code', async () => {
    const { api } = make('tok', () =>
      json(403, { success: false, error: { code: 'FORBIDDEN', message: 'no' } }),
    );
    await expect(api.get('/x')).rejects.toMatchObject({
      name: 'ApiError',
      status: 403,
      code: 'FORBIDDEN',
    });
  });

  it('copes with a non-JSON error body', async () => {
    const { api } = make('tok', () => new Response('<html>bad gateway</html>', { status: 502 }));
    await expect(api.get('/x')).rejects.toMatchObject({ status: 502, code: 'HTTP_ERROR' });
  });

  it('reports a network failure as status 0', async () => {
    const onUnauthorized = vi.fn();
    const api = createApi({
      baseUrl: 'http://api.test',
      getToken: () => 'tok',
      onUnauthorized,
      fetchImpl: (async () => {
        throw new TypeError('failed to fetch');
      }) as unknown as typeof fetch,
    });
    const error = await api.get('/x').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 0, code: 'NETWORK' });
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('a 401 on a request that carried a token ends the session', async () => {
    const { api, onUnauthorized } = make('tok', () =>
      json(401, { success: false, error: { code: 'UNAUTHENTICATED' } }),
    );
    await expect(api.get('/x')).rejects.toMatchObject({ status: 401 });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('a 401 without a token (wrong password at login) does NOT end a session', async () => {
    const { api, onUnauthorized } = make(null, () =>
      json(401, { success: false, error: { code: 'UNAUTHENTICATED' } }),
    );
    await expect(api.post('/auth/login', {})).rejects.toMatchObject({ status: 401 });
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('root() calls unprefixed public endpoints and never sends the token', async () => {
    const { api, fetchImpl } = make();
    await api.root('/health');
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://api.test/health');
    expect((init.headers as Record<string, string>)['Authorization']).toBeUndefined();
  });

  it('download() returns the file with its name, row count and truncation flag', async () => {
    const { api } = make(
      'tok',
      () =>
        new Response('a,b\r\n1,2\r\n', {
          status: 200,
          headers: {
            'Content-Type': 'text/csv',
            'Content-Disposition': 'attachment; filename="audit-2026-10-15.csv"',
            'X-Exported-Rows': '1',
            'X-Export-Truncated': 'true',
          },
        }),
    );
    const file = await api.download('/audit/export', {});
    expect(file).toMatchObject({ filename: 'audit-2026-10-15.csv', rows: 1, truncated: true });
    // the body arrives intact (jsdom mixes two Blob implementations, so check size and type rather than text)
    expect(file.blob.size).toBe(Buffer.byteLength('a,b\r\n1,2\r\n'));
    expect(file.blob.type).toContain('text/csv');
  });

  it('download() turns an error answer into an ApiError', async () => {
    const { api } = make('tok', () => json(403, { success: false, error: { code: 'FORBIDDEN' } }));
    await expect(api.download('/audit/export', {})).rejects.toMatchObject({ status: 403 });
  });
});
