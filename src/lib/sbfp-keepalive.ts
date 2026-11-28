/**
 * Invisible daily keep-alive writer for the Supabase database.
 *
 * One authenticated DB write per day that records a timestamp so the project is
 * less likely to be scored as inactive by Supabase's free-plan auto-pause. It
 * writes to a small app table (`sbfp_keepalive`) that is part of the migration
 * schema, never rendered in the app, and never read by the School Portal or
 * Division Console UI.
 *
 * There is no in-app scheduler here: TanStack Start + Vercel serverless have no
 * long-lived cron. This module exists so an external timer (Vercel Cron, a
 * worker, or a one-line curl loop) can call it once a day.
 */

import { getSql } from './db';

const TABLE = 'sbfp_keepalive';

export async function keepAliveWrite(): Promise<boolean> {
  const sql = await getSql();
  // One row per day, silently overwritten. No UI ever reads this table.
  await sql`
    insert into ${sql`${TABLE}`} (kind, ts)
    values ('daily', now())
    on conflict (kind) do update
    set ts = now()
  `;
  return true;
}

export async function lastKeepAlive(sql: Awaited<ReturnType<typeof getSql>>): Promise<string | null> {
  const rows = await sql<{ ts: string | null }>`
    select ts from ${sql`${TABLE}`} where kind = 'daily'
  `;
  return rows[0]?.ts ?? null;
}
