-- =====================================================
-- vat.law · Migration 008 · OSS/IOSS draft-path column reconcile
-- Additive migration — non-destructive (never edits shipped sql_001..sql_007).
-- Generated: 2 July 2026 (build loop · eighth pass)
-- =====================================================
-- Closes the §5.4 OSS slice: src/app/api/oss/draft/route.ts wrote to a table
-- name (`oss_returns`) that NO migration creates, and — worse than a plain
-- name drift — its column vocabulary DIVERGED from the canonical
-- vat_oss_returns that sql_001 already created. A blind `oss_returns` ->
-- `vat_oss_returns` rename would have SILENTLY BROKEN five column contracts:
--
--   route wrote                 canonical vat_oss_returns (sql_001)
--   -------------------------   -----------------------------------
--   quarter                     period                (name diff)
--   member_state_breakdown      country_breakdown     (name + shape diff:
--                                                      array -> {CC:{net,vat,rate}})
--   total_vat_due               total_vat             (name diff)
--   reporting_member_state      (NO SUCH COLUMN)      (missing column)
--   status 'awaiting_qa'        status check rejects  (constraint would 400)
--
-- Fix (pass-8): the route is reconciled to the canonical vat_oss_returns with a
-- COLUMN-ACCURATE mapping (quarter->period, member_state_breakdown->
-- country_breakdown object shape, total_vat_due->total_vat, +total_net,
-- status 'awaiting_qa'->'india_qa_review' which the sql_001 check already
-- admits). The one column the canonical genuinely lacked — the OSS Member
-- State of Identification (the MS through which a UK post-Brexit trader files
-- OSS Union, e.g. IE via the Irish ROS portal) — is REAL business data worth
-- persisting, so it is ADDED here additively rather than dropped from the write.
--
-- Design decisions:
--   * ADD COLUMN IF NOT EXISTS — additive law; no rename/drop, no edit to a
--     shipped file. Re-running is a no-op.
--   * No new table -> no new `enable row level security` / policy needed.
--     vat_oss_returns already has RLS ENABLED in sql_001 with policy
--     `voss_own` (customer-scoped via the vat_customers ownership join), so the
--     new column inherits that row scoping. verify.mjs check B stays green.
--   * text (2-char ISO country code, e.g. 'IE'/'DE'); the route validates
--     `.length(2)` with a default of 'IE' via zod before write. No CHECK
--     constraint added here — the EU member-state set is reference data that
--     changes (accessions/derogations) and is validated in-app, not pinned in
--     DDL, to avoid a migration each time the set moves.
--   * NO regulated figure and NO live OSS/IOSS filing is asserted here — actual
--     submission via the Irish ROS (OSS Union) / IOSS portal stays a
--     Craig-owned STOP line. This only stages an India-QA-gated draft row.
-- =====================================================

alter table vat_oss_returns
  add column if not exists reporting_member_state text;

comment on column vat_oss_returns.reporting_member_state is
  'OSS/IOSS Member State of Identification (ISO-2, e.g. IE) — the MS through '
  'which the trader files the OSS Union / IOSS return. Set by oss/draft route; '
  'validated in-app (length 2), default IE for UK post-Brexit OSS Union filers.';
