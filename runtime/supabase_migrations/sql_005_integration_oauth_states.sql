-- =====================================================
-- vat.law · Migration 005 · integration_oauth_states
-- Additive migration — non-destructive.
-- Generated: 1 July 2026 (build loop · fourth pass)
-- =====================================================
-- Closes the remaining packet §5.1 entry for `integration_oauth_states`.
--
-- The route below inserts into `integration_oauth_states` on every outbound
-- Xero OAuth2 authorisation start, so a missing table means the OAuth CSRF
-- state token is never persisted and the callback has nothing to match the
-- returned `state` against — defeating the CSRF/tamper protection the route
-- deliberately builds (random nonce + HMAC over customer_id):
--
--   src/app/api/integrations/xero/connect/route.ts (line 39)
--
-- Failure mode today (identical to the pre-fix threshold_check_leads /
-- cross_vertical_events bug): the table did not exist in sql_001..sql_004, so
-- the insert errored. Even once created, the writer uses createRouteClient()
-- (the anon SSR client carrying the caller's JWT from cookies — NOT the
-- service role), so RLS must permit the *owning* authenticated caller to
-- INSERT or the pending-state row is silently rejected.
--
-- Security model:
--   * The route runs behind an authenticated getUser() gate and verifies the
--     caller owns `customer_id` (customer.profile_id === user.id) BEFORE the
--     insert. So the correct RLS shape is owner-scoped on customer_id via
--     vat_customers.profile_id = auth.uid() — the same "*_own" pattern used by
--     vat_returns / vat_invoices / etc. in sql_001. This means a caller can
--     only ever write a pending OAuth-state row for a customer they own, which
--     is exactly the CSRF trust boundary the route is trying to establish.
--   * SELECT is owner-scoped too so the callback (running as the same caller)
--     can look up and validate the returned `state`. No anon SELECT.
--
-- Column set is the EXACT union of the insert site's payload:
--   provider, customer_id, state, nonce, created_at.
--   * provider    -> not null, checked against the known OAuth providers
--     (route hardcodes 'xero'; constraint is a defence-in-depth mirror that
--     still allows the callback-completing providers we integrate).
--   * customer_id -> not null, FK to vat_customers(id); the route only inserts
--     after proving ownership of this id.
--   * state       -> not null, unique; this is the value echoed back by Xero
--     and matched in the callback, so a duplicate would be a collision bug.
--   * nonce       -> not null; the random half of the HMAC state body.
--   * created_at  -> route-set ISO timestamp; defaulted defensively so the
--     15-minute expiry sweep has a value even if a caller omits it.
-- =====================================================

create table if not exists integration_oauth_states (
  id           uuid primary key default gen_random_uuid(),
  provider     text not null
    check (provider in ('xero','quickbooks','freeagent','sage')),
  customer_id  uuid references vat_customers(id) on delete cascade not null,
  state        text not null unique,
  nonce        text not null,
  created_at   timestamptz not null default now()
);

create index if not exists integration_oauth_states_customer_idx
  on integration_oauth_states(customer_id, created_at desc);
-- The callback matches on the returned `state` value; a UNIQUE constraint
-- already indexes it, but keep an explicit lookup-by-provider path too.
create index if not exists integration_oauth_states_provider_idx
  on integration_oauth_states(provider, created_at desc);

-- RLS: enabled, owner-scoped (same "*_own" pattern as sql_001). The caller can
-- only INSERT/SELECT a pending state row for a vat_customers row they own.
-- No anon access; back-office/expiry sweeps run under the service role, which
-- bypasses RLS.
alter table integration_oauth_states enable row level security;

drop policy if exists "ios_own" on integration_oauth_states;
create policy "ios_own" on integration_oauth_states
  for all
  to authenticated
  using (customer_id in (select id from vat_customers where profile_id = auth.uid()))
  with check (customer_id in (select id from vat_customers where profile_id = auth.uid()));
