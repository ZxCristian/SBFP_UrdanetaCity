/**
 * Lightweight keep-alive endpoint for the Supabase database.
 *
 * A tiny DB touch so the project is not scored as inactive by Supabase's
 * free-plan auto-pause. It runs one `select 1` — no writes, no side effects, no
 * discovery of which emails hold accounts — and reports the backend it used.
 *
 * `/api/keep-alive-daily` is the stronger variant: it also records a timestamp
 * in `sbfp_keepalive`, which proves a write reached the database. This route is
 * for monitors that only need to confirm the database answers.
 */
import { createFileRoute } from '@tanstack/react-router';
import { dbSource, getSql } from '@/lib/db';
import { keepAliveAuthorized } from '@/lib/sbfp-keepalive';

export const Route = createFileRoute('/api/keep-alive')({
  server: {
    handlers: {
      GET: async ({ request }) => handleKeepAlive(request),
      POST: async ({ request }) => handleKeepAlive(request),
    },
  },
});

async function handleKeepAlive(request: Request) {
  if (!keepAliveAuthorized(request)) {
    return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }

  try {
    const sql = await getSql();
    await sql`select 1`;
    return new Response(JSON.stringify({
      ok: true,
      backend: dbSource,
      ts: new Date().toISOString(),
    }), {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  } catch (err) {
    console.error('[keep-alive] db touch failed:', err);
    return new Response(JSON.stringify({
      ok: false,
      error:
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message: unknown }).message)
          : 'db touch failed',
    }), {
      status: 500,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }
}
