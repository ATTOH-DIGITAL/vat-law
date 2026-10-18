-- =====================================================
-- vat.law · Migration 009 · §5.4 duplicate-route/table reconcile — column backfill
-- Additive migration — non-destructive (never edits shipped sql_001..sql_008).
-- Generated: 2 July 2026 (build loop · ninth pass)
-- =====================================================
-- Closes the 7 REMAINING §5.4 drifts (drc_assignments, cta_partners,
-- hmrc_enquiries, vat_enquiries, vat_profiles, partial_exemption_records,
-- vat_partial_exemption_calcs) under the "one canonical route per capability"
-- decision, following the pass-8 oss_returns -> vat_oss_returns pattern:
-- COLUMN-ACCURATE reconcile, never a blind rename.
--
-- Per-capability canonical decisions (full table in NOTES.md):
--
--   DRC classification  -> table vat_drc_assignments  · route /api/drc/classify-batch
--   CTA partner lookup  -> table vat_cta_partners     · service-role read (RLS stays default-deny per sql_006)
--   HMRC enquiry intake -> table vat_hmrc_enquiries   · route /api/enquiry/intake
--                          (duplicate /api/vat-enquiry/intake DELETED; its Telegram +
--                           n8n fan-out + civil_evasion handling folded into canonical)
--   Tier/profile lookup -> table vat_customers        · (vat_profiles never existed;
--                           vat-drc-check now reads vat_customers.tier via profile_id)
--   Partial exemption   -> table vat_partial_exemption_records · route /api/partial-exemption/calculate
--                          (duplicate /api/vat-partial-exemption DELETED; its tier gate +
--                           India-QA edge-case recommendation folded into canonical)
--
-- Everything the reconciled routes write already exists in sql_001 EXCEPT the
-- columns added below — each is REAL business data the routes capture that the
-- canonical tables genuinely lacked (the sql_008 reporting_member_state
-- precedent: persist it additively rather than silently dropping the write).
--
-- Design decisions:
--   * ADD COLUMN IF NOT EXISTS — additive law; no rename/drop, no edit to a
--     shipped file. Re-running is a no-op.
--   * NO new table -> no new `enable row level security` / policy needed.
--     vat_drc_assignments (vdrc_own), vat_invoices (vi_own) and
--     vat_hmrc_enquiries (venq_own) already have RLS ENABLED in sql_001 with
--     customer-scoped policies; the new columns inherit that row scoping.
--     verify.mjs check B stays green.
--   * vat_cta_partners RLS posture is UNCHANGED (sql_006 default-deny). The
--     reconciled /api/enquiry/intake reads it via the SERVICE ROLE behind a
--     getUser() auth gate and returns only {partner_id, firm_name} to the
--     client — partner PII (email/phone) and commercial terms
--     (referral_commission_pct / fee_split_terms) never cross RLS or the wire
--     to a customer. No authenticated SELECT policy is added.
--   * category / enquiry_type / drc_classified_by are text WITHOUT a CHECK
--     constraint: the vocabularies are classifier/product-side and validated
--     in-app (the classify-batch route normalises unknown categories to
--     verdict='manual_review' + India-QA routing) — same in-app-not-DDL call
--     as sql_008's reporting_member_state.
--   * NO regulated figure is asserted here (the £625/mo + 50% de-minimis
--     figures, £90k threshold, DRC/CIS regexes and LPP rules live in code and
--     sql_001 and are untouched). NO live filing, deploy, price or partner
--     send happens here.
-- =====================================================

-- ---- 1. vat_drc_assignments: classifier category detail ----
-- The batch classifier distinguishes construction_drc / mobile_phones /
-- computer_chips / gas_electricity_wholesale / emissions_allowances /
-- telecoms_wholesale — the sql_001 `verdict` check ('drc','standard','zero',
-- 'manual_review') keeps the decision, this keeps WHICH DRC regime applied.
alter table vat_drc_assignments add column if not exists category text;

comment on column vat_drc_assignments.category is
  'DRC regime detail from the batch classifier (standard | construction_drc | '
  'mobile_phones | computer_chips | gas_electricity_wholesale | '
  'emissions_allowances | telecoms_wholesale). Validated in-app; verdict '
  'carries the constrained decision.';

-- ---- 2. vat_invoices: classification receipt columns ----
-- classify-batch stamps each invoice with the chosen category + when/by whom
-- it was classified ('ai' or 'india_qa'). Distinct axis from the sql_001
-- drc_classification column (end_user/intermediary/standard_drc counterparty
-- status), so added rather than overloaded.
alter table vat_invoices add column if not exists drc_category text;
alter table vat_invoices add column if not exists drc_classified_at timestamptz;
alter table vat_invoices add column if not exists drc_classified_by text;

-- ---- 3. vat_hmrc_enquiries: intake columns the canonical table lacked ----
-- notice_pdf_url        — the uploaded HMRC notice (response_pack_path is the
--                         OUTBOUND response pack; the inbound notice needs its own home)
-- enquiry_type          — scope axis (desk_based/on_site_visit/aspect/full/
--                         assessment/civil_evasion); notice_type stays the
--                         constrained delivery-channel axis
-- periods_under_enquiry — the VAT periods HMRC named in the notice
-- cta_partner_assigned_at — assignment timestamp (cta_partner_signed_at is the
--                         later signature moment)
-- statutory_power_cited — s.29 / Sch.36 etc, extracted by the n8n intake OCR
alter table vat_hmrc_enquiries add column if not exists notice_pdf_url text;
alter table vat_hmrc_enquiries add column if not exists enquiry_type text;
alter table vat_hmrc_enquiries add column if not exists periods_under_enquiry text[];
alter table vat_hmrc_enquiries add column if not exists cta_partner_assigned_at timestamptz;
alter table vat_hmrc_enquiries add column if not exists statutory_power_cited text;
