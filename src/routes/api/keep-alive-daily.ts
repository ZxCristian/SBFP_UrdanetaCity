/**
 * Invisible daily keep-alive touch for the Supabase database.
 *
 * One DB write per day records a timestamp so the project is less likely to be
 * scored as inactive by Supabase's free-plan auto-pause. It writes to a small
 * app table (`sbfp_keepalive`) that is part of the normal migration schema,
 * never rendered in the app, and never exposed to the School Portal or Division
 * Console UI.
 *
 * There is no in-app scheduler here: TanStack Start + Vercel serverless have no
 * long-lived cron. This endpoint exists so an external timer (Vercel Cron, a
 * worker, or a one-line curl loop) can call it once a day.
 */
import { createFileRoute } from '@tanstack/react-router';
import { keepAliveAuthorized, keepAliveWrite } from '@/lib/sbfp-keepalive';

export const Route = createFileRoute('/api/keep-alive-daily')({
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
    await keepAliveWrite();
    return new Response(JSON.stringify({
      ok: true,
      ts: new Date().toISOString(),
    }), {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  } catch (err) {
    console.error('[keep-alive/daily] db touch failed:', err);
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
