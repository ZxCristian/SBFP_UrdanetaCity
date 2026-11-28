-- Invisible keep-alive table. Only the daily touch endpoint writes here.
-- Nobody reads it in the app; it exists solely so Supabase sees DB activity.
create table if not exists sbfp_keepalive (
  kind text primary key,
  ts timestamptz not null default now()
);
