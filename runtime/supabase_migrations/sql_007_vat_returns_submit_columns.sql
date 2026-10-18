-- =====================================================
-- vat.law · Migration 007 · 9-box submit-path column reconcile
-- Additive migration — non-destructive (never edits shipped sql_001..sql_006).
-- Generated: 2 July 2026 (build loop · fifth pass)
-- =====================================================
-- Closes packet §5.2 (column-shape drift on vat_returns — "production
-- blocker") plus the submit-path slice of §5.5 (tier enum drift). Passes 1-4
-- reconciled at TABLE level; this is the first COLUMN-level reconcile, on the
-- core paid flow:
--
--   src/app/api/returns/submit/route.ts   (HMRC MTD 9-box submission,
--                                          India-QA gated for pro/cross_border)
--
-- What the route reads/writes vs what sql_001 created:
--
--   vat_returns — route uses `finalised`, `period_key`,
--   `box1_vat_due_sales`..`box9_acquisitions_from_eu`, `rejection_reason`,
--   `submitted_at`, `hmrc_submission_form_bundle_number`,
--   `hmrc_submission_payment_indicator`, `hmrc_submission_processing_date`,
--   and writes status 'awaiting_qa'. sql_001 has NONE of those columns (it
--   stores `nine_box jsonb` + `mtd_obligation_period`) and its status check
--   constraint rejects 'awaiting_qa'. Every submit attempt failed at column
--   level even though the table exists — exactly the class of drift the
--   pass-3 adversarial verify rejected on dpo-law.
--
--   vat_customers — route reads/writes `hmrc_mtd_access_token_encrypted`,
--   `hmrc_mtd_refresh_token_encrypted`, `hmrc_mtd_token_expires_at` for the
--   OAuth token-freshness branch. sql_001 has no HMRC token columns, so the
--   route could never find a connected customer (perpetual 412) and the
--   token-refresh persist always errored.
--
-- Design decisions:
--   * Columns are ADDED alongside `nine_box`/`mtd_obligation_period` (not a
--     rename/drop — additive law). A guarded, idempotent backfill copies any
--     existing jsonb 9-box data + obligation period into the new columns so
--     pre-migration draft returns stay submittable.
--   * box1-5 are VAT amounts (pence precision); box6-9 are whole-pound
--     statutory values per HMRC MTD VAT API v1.0 (the route rounds them
--     before submission) — both stored as numeric(14,2) to match the
--     bookkeeping-side inputs; HMRC rounding happens at payload-build time.
--   * `finalised` models the HMRC legal declaration checkbox (VAT Notice
--     700/22: the trader must declare the return is complete before
--     submission). Route returns 400 when false — default false is correct.
--   * status check constraint: re-created ONCE here with 'awaiting_qa' added.
--     Postgres auto-named the inline sql_001 check `vat_returns_status_check`;
--     drop-if-exists + add-named is the standard additive way to widen an
--     enum-style check without touching the shipped file.
--   * Token columns are the ENCRYPTED-at-rest values (route naming makes the
--     contract explicit); they live on vat_customers, whose sql_001 RLS
--     policy `vc_own` (profile_id = auth.uid()) already scopes them to the
--     owning customer. vat_returns keeps policy `vr_own`. Both tables already
--     have RLS ENABLED in sql_001 — no new table is created here, so no new
--     enable/policy is required (verify.mjs check B remains green).
--   * NO regulated figure is asserted here and NO live HMRC call is made —
--     live 9-box filing stays a Craig-owned STOP line (packet §6 Live-2).
-- =====================================================

-- ---- 1. vat_returns: 9-box + submission-receipt columns ----
alter table vat_returns add column if not exists finalised boolean not null default false;
alter table vat_returns add column if not exists period_key text;
alter table vat_returns add column if not exists box1_vat_due_sales numeric(14,2);
alter table vat_returns add column if not exists box2_vat_due_acquisitions numeric(14,2);
alter table vat_returns add column if not exists box3_total_vat_due numeric(14,2);
alter table vat_returns add column if not exists box4_vat_reclaimed numeric(14,2);
alter table vat_returns add column if not exists box5_net_vat_due numeric(14,2);
alter table vat_returns add column if not exists box6_total_sales_ex_vat numeric(14,2);
alter table vat_returns add column if not exists box7_total_purchases_ex_vat numeric(14,2);
alter table vat_returns add column if not exists box8_supplies_to_eu numeric(14,2);
alter table vat_returns add column if not exists box9_acquisitions_from_eu numeric(14,2);
alter table vat_returns add column if not exists rejection_reason text;
alter table vat_returns add column if not exists submitted_at timestamptz;
alter table vat_returns add column if not exists hmrc_submission_form_bundle_number text;
alter table vat_returns add column if not exists hmrc_submission_payment_indicator text;
alter table vat_returns add column if not exists hmrc_submission_processing_date timestamptz;

create index if not exists vat_returns_period_key_idx
  on vat_returns(customer_id, period_key)
  where period_key is not null;

-- ---- 2. widen the status check to admit the route's 'awaiting_qa' ----
-- (sql_001 inline check auto-name is vat_returns_status_check; full original
-- value set preserved + 'awaiting_qa' appended.)
alter table vat_returns drop constraint if exists vat_returns_status_check;
alter table vat_returns add constraint vat_returns_status_check
  check (status in
    ('draft','qa_review','cta_sign','await_customer_approval','queued_for_submission',
     'submitted','accepted','rejected','amended','closed','awaiting_qa'));

-- ---- 3. vat_customers: HMRC MTD OAuth token columns (encrypted at rest) ----
alter table vat_customers add column if not exists hmrc_mtd_access_token_encrypted text;
alter table vat_customers add column if not exists hmrc_mtd_refresh_token_encrypted text;
alter table vat_customers add column if not exists hmrc_mtd_token_expires_at timestamptz;

-- ---- 4. idempotent backfill: jsonb nine_box -> typed box columns ----
-- Only touches rows that carry jsonb data and have not been backfilled yet
-- (box1 null guard), so re-running is a no-op. period_key mirrors the MTD
-- obligation period sql_001 already stored.
update vat_returns set
  box1_vat_due_sales        = nullif(nine_box->>'box_1','')::numeric,
  box2_vat_due_acquisitions = nullif(nine_box->>'box_2','')::numeric,
  box3_total_vat_due        = nullif(nine_box->>'box_3','')::numeric,
  box4_vat_reclaimed        = nullif(nine_box->>'box_4','')::numeric,
  box5_net_vat_due          = nullif(nine_box->>'box_5','')::numeric,
  box6_total_sales_ex_vat   = nullif(nine_box->>'box_6','')::numeric,
  box7_total_purchases_ex_vat = nullif(nine_box->>'box_7','')::numeric,
  box8_supplies_to_eu       = nullif(nine_box->>'box_8','')::numeric,
  box9_acquisitions_from_eu = nullif(nine_box->>'box_9','')::numeric
where nine_box <> '{}'::jsonb
  and box1_vat_due_sales is null;

update vat_returns set period_key = mtd_obligation_period
where period_key is null
  and mtd_obligation_period is not null;
