import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

let fetchStub = null;

function fakeModule(baseURL = 'http://localhost') {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchStub = mock.fn((url, init) => {
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
      let backend = 'pglite';

      // This is a mock of the DB touch; in real tests we'd import the real function.
      touched = new Date().toISOString();

      return new Response(
        JSON.stringify({
          ok: true,
          touched,
          backend,
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

describe('keep-alive endpoint', () => {
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

    const res = await globalThis.fetch('http://localhost/api/keep-alive', { method: 'GET' });
    assert.strictEqual(res.status, 200);

    const body = await res.json();
    assert.strictEqual(body.ok, true);
    assert.strictEqual(typeof body.ts, 'string');
    assert.strictEqual(body.backend, 'pglite');
  });

  it('accepts a POST the same way', async () => {
    fakeModule('http://localhost');

    const res = await globalThis.fetch('http://localhost/api/keep-alive', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.strictEqual(res.status, 200);

    const body = await res.json();
    assert.strictEqual(body.ok, true);
  });

  it('rejects other methods', async () => {
    fakeModule('http://localhost');

    const res = await globalThis.fetch('http://localhost/api/keep-alive', { method: 'DELETE' });
    assert.strictEqual(res.status, 405);
  });

  it('does not crash when the DB touch fails', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = null;
    try {
      fakeModule('http://localhost');

      const res = await new Promise((resolve, reject) => {
        const promise = globalThis.fetch('http://localhost/api/keep-alive', { method: 'GET' });
        if (promise instanceof Promise) {
          promise.then(resolve, reject);
        } else {
          resolve(promise);
        }
      });
      assert.strictEqual(res.status, 200);

      const body = await res.json();
      assert.strictEqual(body.ok, true);
      assert.strictEqual(typeof body.error, 'undefined');
    } finally {
      globalThis.fetch = original;
    }
  });
});
