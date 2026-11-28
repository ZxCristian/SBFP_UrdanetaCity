import { mock } from 'node:test';
import { fetchDataVersion } from '../src/lib/sbfp-api.ts';

export function fakeModule(baseURL = 'http://localhost', fetchStubRef) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchStubRef.value = mock.fn((url, init) => {
    const request = new Request(url, init);

    if (request.url === baseURL + '/api/auth/$/') {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      });
    }

    if (request.url === baseURL + '/api/keep-alive') {
      if (request.method !== 'GET' && request.method !== 'POST') {
        return new Response('Method Not Allowed', {
          status: 405,
          headers: { 'content-type': 'text/plain; charset=utf-8' },
        });
      }

      let touched = null;

      fetchDataVersion()
        .then((result) => {
          const version = result.version;
          touched = version && version !== '' ? new Date().toISOString() : null;
        })
        .catch(() => {
          touched = null;
        });

      return new Response(
        JSON.stringify({
          ok: true,
          touched,
          backend: touched ? 'postgres' : 'pglite',
          ts: new Date().toISOString(),
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        },
      );
    }

    return new Response('Not Found', {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  });
}
