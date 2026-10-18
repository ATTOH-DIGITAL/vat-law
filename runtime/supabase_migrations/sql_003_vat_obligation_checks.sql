-- =====================================================
-- vat.law · Migration 003 · vat_obligation_checks
-- Additive migration — non-destructive.
-- Generated: 1 July 2026 (build loop)
-- =====================================================
-- Closes packet §5.6 (self-admitted missing migration) and the §5.1 entry for
-- `vat_obligation_checks`.
--
-- The route below writes to `vat_obligation_checks`, which sql_001/sql_002 never
-- created, so every persist was failing (route swallows the error non-fatally —
-- see the `console.warn('vat_obligation_checks persist failed', ...)` branch):
--
--   src/app/api/vat-obligation-check/route.ts  (authed £90k obligation check;
--                                               all paid tiers + trial, never anon)
--
-- The route carried the exact spec for this table in its TODO(schema) comment:
--   "business_id uuid nullable, user_id uuid not null, RLS".
--
-- Writer uses the SERVICE-ROLE client (supabaseAdmin), which bypasses RLS. The
-- route validates the user via getAuthedUser() (auth.getUser, not getSession),
-- then scopes business_id to a vat_customers row the caller provably owns
-- (id = business_id AND profile_id = userId); if unowned it persists NULL and
-- keeps only the validated user_id. So:
--   * user_id  -> not null (always the validated auth.users id)
--   * business_id -> nullable uuid, FK to vat_customers(id) (only set when owned)
--
-- Column set is the EXACT union of the insert site's payload:
--   business_id, user_id, turnover_12m, vat_registered, filing_frequency,
--   registration_required, registration_approaching, potentially_late,
--   penalty_point_risk, checked_at.
-- =====================================================

create table if not exists vat_obligation_checks (
  id                        uuid primary key default gen_random_uuid(),
  -- Nullable: only persisted when the caller provably owns the vat_customers row.
  business_id               uuid references vat_customers(id) on delete set null,
  -- Not null: always the validated auth.users id from getAuthedUser().
  user_id                   uuid references auth.users(id) on delete cascade not null,
  turnover_12m              numeric(14,2) not null default 0,
  vat_registered            boolean not null default false,
  filing_frequency          text not null
    check (filing_frequency in ('monthly','quarterly','annual')),
  registration_required     boolean not null default false,
  registration_approaching  boolean not null default false,
  potentially_late          boolean not null default false,
  -- Mirrors the route's PenaltyPointRisk union: 'high' | 'medium' | 'low' | 'none'.
  penalty_point_risk        text not null default 'none'
    check (penalty_point_risk in ('high','medium','low','none')),
  checked_at                timestamptz not null default now(),
  created_at                timestamptz not null default now()
);

create index if not exists vat_obligation_checks_user_idx
  on vat_obligation_checks(user_id, checked_at desc);
create index if not exists vat_obligation_checks_business_idx
  on vat_obligation_checks(business_id)
  where business_id is not null;

-- RLS: enabled. The writer is the service-role client (bypasses RLS); reads are
-- owner-scoped so a customer can only ever see their own obligation-check log.
-- No route reads this table today (grep: zero non-insert refs) — the SELECT
-- policy is defensive so a future customer-facing read stays user-scoped, and
-- INSERT/UPDATE/DELETE default-deny for anon/authenticated (service role only).
alter table vat_obligation_checks enable row level security;

drop policy if exists "voc_own_select" on vat_obligation_checks;
create policy "voc_own_select" on vat_obligation_checks
  for select
  to authenticated
  using (user_id = auth.uid());
