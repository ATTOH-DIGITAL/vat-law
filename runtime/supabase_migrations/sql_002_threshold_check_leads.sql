-- =====================================================
-- vat.law · Migration 002 · threshold_check_leads
-- Additive migration — non-destructive.
-- Generated: 1 July 2026 (build loop)
-- =====================================================
-- Closes packet §5.1 for the top-of-funnel lead table.
--
-- The routes below write to `threshold_check_leads`, which sql_001 never
-- created, so under RLS every insert was being silently rejected:
--
--   src/app/api/threshold/check/route.ts   (free £90k threshold check — public)
--   src/app/api/cross-fired/route.ts        (form.law / sole.tax fan-in webhook)
--
-- Both writers use createRouteClient() — the anon SSR client (NOT service
-- role). So RLS must permit the anon role to INSERT, or the lead never lands.
-- This is the top-of-funnel acquisition surface; a dropped insert is a lost
-- lead, not a security event, so anon INSERT is intended here. No SELECT is
-- granted to anon/authenticated — reads are back-office (service role), and
-- no route reads this table (grep: zero non-insert refs).
--
-- Column set is the UNION of every field the two insert sites write. All
-- columns except the primary key are nullable / defaulted because different
-- call sites omit different fields (e.g. threshold/check omits company_name,
-- companies_house_number, source, sole_tax_customer_id).
-- =====================================================

create table if not exists threshold_check_leads (
  id                          uuid primary key default gen_random_uuid(),
  email                       text not null,
  rolling_12_month_total_gbp  numeric(14,2) default 0,
  must_register               boolean default false,
  business_type               text
    check (business_type is null or business_type in
      ('sole_trader','partnership','ltd','llp','other')),
  primary_sector              text,
  source                      text,
  company_name                text,
  companies_house_number      text,
  sole_tax_customer_id        text,
  checked_at                  timestamptz default now(),
  created_at                  timestamptz default now()
);

create index if not exists threshold_check_leads_email_idx
  on threshold_check_leads(email);
create index if not exists threshold_check_leads_must_register_idx
  on threshold_check_leads(must_register) where must_register = true;
create index if not exists threshold_check_leads_checked_at_idx
  on threshold_check_leads(checked_at);

-- RLS: enabled, with a single scoped INSERT policy for the public writers.
-- No SELECT/UPDATE/DELETE policy → those default-deny for anon/authenticated;
-- back-office reads run under the service role, which bypasses RLS.
alter table threshold_check_leads enable row level security;

drop policy if exists "tcl_public_insert" on threshold_check_leads;
create policy "tcl_public_insert" on threshold_check_leads
  for insert
  to anon, authenticated
  with check (true);
