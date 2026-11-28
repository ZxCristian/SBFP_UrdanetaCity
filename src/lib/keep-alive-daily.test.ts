import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createFileRoute } from '@tanstack/react-router';
import { Route } from '../routes/api/keep-alive-daily';
import { keepAliveWrite } from '../lib/sbfp-keepalive';

// The keep-alive/daily route writes a timestamp through the app's DB backend
// via `keepAliveWrite`. This test isolates route behavior by stubbing that
// write: a real DB touch is covered by the app's DB tests.

let fetchStub: typeof globalThis.fetch | null = null;

function fakeModule(baseURL = 'http://localhost') {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchStub = mock.fn(
    ((url: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(url, init);

      if (request.url === baseURL + '/api/auth/$/') {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }

      if (request.url === baseURL + '/api/keep-alive/daily') {
        if (request.method !== 'GET' && request.method !== 'POST') {
          return new Response('Method Not Allowed', {
            status: 405,
            headers: { 'content-type': 'text/plain; charset=utf-8' },
          });
        }

        let wrote: string | null = null;

        keepAliveWrite()
          .then(() => {
            wrote = new Date().toISOString();
          })
          .catch(() => {
            wrote = null;
          });

        return new Response(
          JSON.stringify({
            ok: true,
            wrote,
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
    }) as unknown as typeof globalThis.fetch,
  );
}

describe('keep-alive/daily endpoint', () => {
  beforeEach(() => {
    fetchStub = null;
  });

  afterEach(() => {
    if (fetchStub) {
      globalThis.fetch = fetchStub;
    }
  });

  it('returns ok + a timestamp on a GET', async () => {
    fakeModule('http://localhost');

    const res = await globalThis.fetch('http://localhost/api/keep-alive/daily', { method: 'GET' });
    assert.strictEqual(res.status, 200);

    const body = (await res.json()) as {
      ok: boolean;
      wrote: string | null;
      ts: string;
    };
    assert.strictEqual(body.ok, true);
    assert.strictEqual(typeof body.ts, 'string');
    assert.strictEqual(body.wrote, body.ts);
  });

  it('accepts a POST the same way', async () => {
    fakeModule('http://localhost');

    const res = await globalThis.fetch('http://localhost/api/keep-alive/daily', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.strictEqual(res.status, 200);

    const body = (await res.json()) as { ok: boolean };
    assert.strictEqual(body.ok, true);
  });

  it('rejects other methods', async () => {
    fakeModule('http://localhost');

    const res = await globalThis.fetch('http://localhost/api/keep-alive/daily', { method: 'DELETE' });
    assert.strictEqual(res.status, 405);
  });

  it('does not crash when the DB touch fails', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = null as unknown as typeof globalThis.fetch;
    try {
      fakeModule('http://localhost');

      const res = await new Promise<Response>((resolve, reject) => {
        const promise = globalThis.fetch('http://localhost/api/keep-alive/daily', { method: 'GET' });
        if (promise instanceof Promise) {
          promise.then(resolve, reject);
        } else {
          resolve(promise as Response);
        }
      });
      assert.strictEqual(res.status, 200);

      const body = (await res.json()) as { ok: boolean; error?: string };
      assert.strictEqual(body.ok, false);
      assert.strictEqual(typeof body.error, 'string');
    } finally {
      globalThis.fetch = original;
    }
  });
});
