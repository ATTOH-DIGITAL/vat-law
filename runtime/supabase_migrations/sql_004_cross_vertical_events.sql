-- =====================================================
-- vat.law · Migration 004 · cross_vertical_events
-- Additive migration — non-destructive.
-- Generated: 1 July 2026 (build loop · third pass)
-- =====================================================
-- Closes the remaining packet §5.1 entry for `cross_vertical_events`.
--
-- The route below inserts into `cross_vertical_events` on EVERY inbound
-- cross-vertical webhook, before any event routing runs, so a missing table
-- means the raw-event audit trail was never captured:
--
--   src/app/api/cross-fired/route.ts (line 57)  (form.law · sole.tax ·
--       accounts.law · landlord.tax fan-in; per-source HMAC-signed)
--
-- Two independent failure modes today, both closed here:
--   1. Table did not exist in sql_001..sql_003 — insert errored outright.
--   2. Even once created, the writer uses createRouteClient() — the anon SSR
--      client with NO session (this is a server-to-server HMAC webhook, not a
--      cookie/JWT caller). So RLS must permit the anon role to INSERT or the
--      row is silently rejected. Same design already shipped for
--      threshold_check_leads in sql_002, which THIS SAME route also writes to
--      via the same anon client.
--
-- This is a server-to-server audit sink, not a user-scoped event log, so the
-- inbound HMAC signature is the trust boundary (verified in the route before
-- the insert) — RLS's job here is only to prevent arbitrary anon SELECT/UPDATE/
-- DELETE, not to gate the insert. No SELECT is granted to anon/authenticated:
-- reads are back-office (service role, which bypasses RLS), and no route reads
-- this table (grep: the sole reference is the single insert on line 57).
--
-- Column set is the EXACT union of the insert site's payload:
--   source, event, payload, fired_at, received_at.
--   * source / event -> not null (route rejects a body missing either with 400
--     before reaching the insert; both are validated non-empty strings).
--   * payload -> jsonb, defaulted (route passes `body.payload || {}`).
--   * fired_at -> when the upstream vertical fired the event (client-supplied,
--     defaulted to now() defensively).
--   * received_at -> when vat.law ingested it (always route-set to now()).
-- The source check constraint mirrors the SECRETS map keys in the route
-- (form.law · sole.tax · accounts.law · landlord.tax); an unknown source is
-- already rejected with 400 upstream, so this is a defence-in-depth mirror.
-- =====================================================

create table if not exists cross_vertical_events (
  id           uuid primary key default gen_random_uuid(),
  source       text not null
    check (source in ('form.law','sole.tax','accounts.law','landlord.tax')),
  event        text not null,
  payload      jsonb not null default '{}'::jsonb,
  fired_at     timestamptz not null default now(),
  received_at  timestamptz not null default now(),
  created_at   timestamptz not null default now()
);

create index if not exists cross_vertical_events_source_idx
  on cross_vertical_events(source, received_at desc);
create index if not exists cross_vertical_events_event_idx
  on cross_vertical_events(event, received_at desc);

-- RLS: enabled, with a single scoped INSERT policy for the anon webhook writer.
-- No SELECT/UPDATE/DELETE policy → those default-deny for anon/authenticated;
-- back-office reads run under the service role, which bypasses RLS.
alter table cross_vertical_events enable row level security;

drop policy if exists "cve_public_insert" on cross_vertical_events;
create policy "cve_public_insert" on cross_vertical_events
  for insert
  to anon, authenticated
  with check (true);
