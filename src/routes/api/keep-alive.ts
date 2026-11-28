/**
 * Lightweight keep-alive endpoint for the Supabase database.
 *
 * A tiny authenticated DB touch so the project is not scored as inactive by
 * Supabase's free-plan auto-pause. It reads one row from an existing app table
 * (`sbfp_schools`) — no writes, no side effects, no discovery of which emails
 * hold accounts — and returns the current backend + a stale timestamp.
 *
 * There is no scheduled background task here: Vercel-serverless plus TanStack
 * Start have no long-lived cron. The app is the "something that touches the
 * DB" Supabase expects, so the Division Console poll (`fetchDataVersion`) and
 * the School Portal's same poll already count as activity once real users are
 * signed in. This endpoint exists for an external keep-alive monitor or an
 * operator to run on a timer when the app has no signed-in users.
 */
import { createFileRoute } from '@tanstack/react-router';
import { auth } from '@/lib/auth/server';
import { fetchDataVersion } from '@/lib/sbfp-api';

export const Route = createFileRoute('/api/keep-alive')({
  server: {
    handlers: {
      GET: async ({ request }) => handleKeepAlive(request),
      POST: async ({ request }) => handleKeepAlive(request),
    },
  },
});

async function handleKeepAlive(request: Request) {
  const response = await auth.handler(request);

  if ((response.status !== 200) || ((response.headers.get('content-type')?.startsWith('text/html')) ?? false)) {
    return response;
  }

  try {
    const result = await fetchDataVersion();
    return new Response(JSON.stringify({
      ok: true,
      touched: result.version !== '' ? new Date().toISOString() : null,
      backend: result.version !== '' ? 'postgres' : 'pglite',
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
