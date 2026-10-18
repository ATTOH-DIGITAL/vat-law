-- =====================================================
-- vat.law · Migration 001 · Initial schema
-- Vertical #25 of Supreme Operating System
-- Generated: 18 May 2026
-- Tables: 11 + vat_cta_partners reference + audit log
-- RLS: Enabled on all customer-scoped tables
-- =====================================================
-- Regulatory context: vat.law is an AI-native UK complex-VAT NAVIGATOR. It is
-- a TECHNOLOGY PLATFORM that runs the non-regulated, deterministic work:
-- MTD-VAT submission, digital-link record-keeping, error checking,
-- scheme-eligibility analysis, partial-exemption math, DRC classification,
-- margin/TOMS calculation, OSS/IOSS country breakdown, capital-goods-scheme
-- tracking, penalty-point exposure and HMRC enquiry-response preparation.
--
-- Where the work crosses into REGULATED COMPLEX TAX ADVICE — partial-exemption
-- methodology sign-off, group VAT structuring, place-of-supply rulings,
-- HMRC enquiry strategy — the question is routed to the customer's
-- CTA / CIOT / ATT partner adviser via the vat_cta_partners table. The
-- partner adviser carries the regulated accountability; vat.law carries
-- the computation, evidence pack, and audit trail.
--
-- UK context (May 2026):
--   · 2.179m UK VAT-registered businesses (HMRC)
--   · MTD VAT mandatory for all VAT-registered since April 2022 (no opt-out)
--   · £90,000 VAT registration threshold from April 2024 (was £85,000)
--   · Points-based penalty regime live since 1 January 2023
--       quarterly filers: 4 points → £200 fixed penalty, +£200 per
--       subsequent late return; points expire 24 months after issue
--       (if the threshold is reached, the customer must clear all points
--        by a "period of compliance" first)
--   · April 2025 LPP escalation:
--       LPP1 = 3% on day 15 + 3% on day 30
--       LPP2 = 10% per annum daily rate (was 4%)
-- =====================================================

-- =====================================================
-- 1. vat_customers — VAT-registered customer profile
-- =====================================================
create table if not exists vat_customers (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references auth.users(id) on delete cascade not null,
  legal_name text not null,
  companies_house_number text,
  vat_number text,
  vrn text,
  scheme text not null default 'standard' check (scheme in
    ('standard','cash','flat_rate','annual','margin','toms','retail')),
  flat_rate_percentage numeric(5,2),
  group_member boolean not null default false,
  group_representative_id uuid references vat_customers(id) on delete set null,
  partial_exemption_flag boolean not null default false,
  partial_exemption_method text check (partial_exemption_method in
    ('standard','special','sector','transactions_based','outputs_based','inputs_based','none')),
  filing_frequency text not null default 'quarterly' check (filing_frequency in
    ('monthly','quarterly','annually','stagger_1','stagger_2','stagger_3')),
  registration_threshold_breached_at date,
  deregistration_threshold_breached_at date,
  tier text not null default 'essentials' check (tier in ('essentials','pro','cross_border')),
  billing_cadence text not null default 'monthly' check (billing_cadence in ('monthly','annual')),
  stripe_customer_id text,
  bookkeeping_software text check (bookkeeping_software in
    ('xero','sage','quickbooks','freeagent','sole_tax','manual','csv','none')),
  bookkeeping_software_connected_at timestamptz,
  eori_number text,
  oss_registered boolean not null default false,
  ioss_registered boolean not null default false,
  cis_registered boolean not null default false,
  cis_status text check (cis_status in ('registered','gross','net','none')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists vat_customers_profile_idx on vat_customers(profile_id);
create index if not exists vat_customers_vrn_idx on vat_customers(vrn);
create index if not exists vat_customers_tier_idx on vat_customers(tier);
create index if not exists vat_customers_group_idx on vat_customers(group_representative_id) where group_member = true;

-- =====================================================
-- 2. vat_returns — quarterly / monthly / annual returns
-- =====================================================
-- nine_box jsonb shape:
--   { "box_1": net, "box_2": net, "box_3": net, "box_4": net,
--     "box_5": net, "box_6": net, "box_7": net, "box_8": net, "box_9": net }
-- vat.law NEVER auto-submits Pro / Cross-Border returns — they route through
-- India QA and (where partial-exemption / DRC / OSS is in scope) a CTA
-- partner sign-off before HMRC MTD submission.
-- =====================================================
create table if not exists vat_returns (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references vat_customers(id) on delete cascade not null,
  period_start date not null,
  period_end date not null,
  due_date date not null,
  nine_box jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in
    ('draft','qa_review','cta_sign','await_customer_approval','queued_for_submission',
     'submitted','accepted','rejected','amended','closed')),
  mtd_submission_ref text,
  mtd_correlation_id text,
  mtd_obligation_period text,
  filed_at timestamptz,
  filed_by_user_id uuid,
  audit_trail jsonb not null default '[]'::jsonb,
  partial_exemption_record_id uuid,
  india_qa_id uuid,
  india_qa_status text not null default 'pending' check (india_qa_status in ('pending','approved','rejected','needs_clarification')),
  cta_partner_id text,
  cta_partner_signed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (customer_id, period_start, period_end)
);

create index if not exists vat_returns_customer_idx on vat_returns(customer_id);
create index if not exists vat_returns_due_idx on vat_returns(due_date) where status not in ('submitted','accepted','closed');
create index if not exists vat_returns_status_idx on vat_returns(status);

-- =====================================================
-- 3. vat_invoices — transaction-level ledger from bookkeeping software
-- =====================================================
create table if not exists vat_invoices (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references vat_customers(id) on delete cascade not null,
  source text not null check (source in ('xero','sage','quickbooks','freeagent','sole_tax','manual','csv')),
  external_id text,
  direction text not null check (direction in ('sale','purchase')),
  issue_date date not null,
  supplier_or_customer text,
  supplier_vat_number text,
  net numeric(12,2) not null,
  vat numeric(12,2) not null default 0,
  gross numeric(12,2),
  vat_rate text not null check (vat_rate in ('standard','reduced','zero','exempt','outside','drc','margin','toms')),
  drc_classification text check (drc_classification in ('end_user','intermediary','standard_drc','not_applicable')),
  margin_scheme boolean not null default false,
  margin_purchase_price numeric(12,2),
  margin_sale_price numeric(12,2),
  place_of_supply text check (place_of_supply in ('uk','eu_b2c','eu_b2b','row_b2c','row_b2b','digital_b2c','digital_b2b','outside_scope')),
  member_state_code text,
  member_state_vat_rate numeric(5,2),
  capital_good_id uuid,
  cgs_year integer,
  is_capital_good boolean not null default false,
  postponed_vat_accounting boolean not null default false,
  c79_evidenced boolean not null default false,
  return_id uuid references vat_returns(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists vat_invoices_customer_idx on vat_invoices(customer_id);
create index if not exists vat_invoices_return_idx on vat_invoices(return_id);
create index if not exists vat_invoices_date_idx on vat_invoices(issue_date);
create index if not exists vat_invoices_drc_idx on vat_invoices(drc_classification) where vat_rate = 'drc';
create index if not exists vat_invoices_oss_idx on vat_invoices(place_of_supply) where place_of_supply in ('eu_b2c','digital_b2c');

-- =====================================================
-- 4. vat_partial_exemption_records — Notice 706 methodology
-- =====================================================
-- De minimis test (Notice 706 §11): a partly-exempt business may recover
-- ALL its exempt-related input tax if BOTH of these are met:
--   (a) total exempt input tax ≤ £625/month on average over the relevant
--       period (£1,875/quarter / £7,500/year)
--   (b) total exempt input tax ≤ 50% of total input tax
-- =====================================================
create table if not exists vat_partial_exemption_records (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references vat_customers(id) on delete cascade not null,
  period text not null,
  period_start date not null,
  period_end date not null,
  method text not null check (method in ('standard','special','sector','transactions_based','outputs_based','inputs_based')),
  taxable_supplies numeric(12,2) not null default 0,
  exempt_supplies numeric(12,2) not null default 0,
  total_input_tax numeric(12,2) not null default 0,
  directly_attributable_taxable numeric(12,2) not null default 0,
  directly_attributable_exempt numeric(12,2) not null default 0,
  residual_input_tax numeric(12,2) not null default 0,
  recoverable_percentage numeric(5,2),
  recoverable_residual numeric(12,2),
  exempt_input_tax_recovered numeric(12,2) not null default 0,
  de_minimis_pass boolean not null default false,
  de_minimis_reason text,
  annual_adjustment jsonb,
  is_annual_adjustment boolean not null default false,
  methodology_memo_path text,
  cgs_overlap_flag boolean not null default false,
  cgs_overlap_assets jsonb,
  status text not null default 'draft' check (status in
    ('draft','india_qa_review','await_cta_partner_sign','cta_signed','final','superseded')),
  cta_partner_id text,
  cta_partner_signed boolean not null default false,
  cta_partner_signed_at timestamptz,
  india_qa_signed boolean not null default false,
  india_qa_id uuid,
  notice_706_references text[] default array['VAT Notice 706','Notice 706 §3 (standard method)','Notice 706 §11 (de minimis)'],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists vat_pe_customer_idx on vat_partial_exemption_records(customer_id);
create index if not exists vat_pe_period_idx on vat_partial_exemption_records(customer_id, period_start, period_end);
create index if not exists vat_pe_status_idx on vat_partial_exemption_records(status);

-- =====================================================
-- 5. vat_drc_assignments — domestic reverse charge classification (Notice 735)
-- =====================================================
-- One row per invoice DRC classification with reasoning + confidence.
-- Confidence < 0.85 routes to India QA before customer presentation.
-- =====================================================
create table if not exists vat_drc_assignments (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references vat_customers(id) on delete cascade not null,
  invoice_id uuid references vat_invoices(id) on delete cascade not null,
  cis_status text check (cis_status in ('registered','gross','net','none','unknown')),
  end_user_flag boolean not null default false,
  intermediary_flag boolean not null default false,
  customer_vat_registered boolean,
  customer_cis_registered boolean,
  supply_type text check (supply_type in
    ('construction_services','construction_materials_supply_only','professional_services',
     'plant_hire','labour_only','mixed','none')),
  verdict text not null check (verdict in ('drc','standard','zero','manual_review')),
  reasoning text not null,
  confidence numeric(4,3) not null,
  routes_to_india_qa boolean not null default false,
  india_qa_signed boolean not null default false,
  india_qa_id uuid,
  notice_735_references text[] default array['VAT Notice 735','Notice 735 §1.2 (end-user / intermediary)','Notice 735 §2.4 (services in scope)'],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists vat_drc_customer_idx on vat_drc_assignments(customer_id);
create index if not exists vat_drc_invoice_idx on vat_drc_assignments(invoice_id);
create index if not exists vat_drc_qa_idx on vat_drc_assignments(routes_to_india_qa) where india_qa_signed = false;

-- =====================================================
-- 6. vat_oss_returns — One Stop Shop / Import One Stop Shop
-- =====================================================
-- country_breakdown jsonb shape: { "FR": { "net": ..., "vat": ..., "rate": 20.0 }, ... }
-- IOSS threshold for low-value goods: £135 (consignment value) / €150
-- =====================================================
create table if not exists vat_oss_returns (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references vat_customers(id) on delete cascade not null,
  scheme text not null check (scheme in ('oss_union','oss_non_union','ioss')),
  period text not null,
  period_start date not null,
  period_end date not null,
  country_breakdown jsonb not null default '{}'::jsonb,
  total_net numeric(12,2) not null default 0,
  total_vat numeric(12,2) not null default 0,
  oss_submission_ref text,
  status text not null default 'draft' check (status in
    ('draft','india_qa_review','cta_sign','await_customer_approval','submitted','accepted','rejected','closed')),
  india_qa_id uuid,
  cta_partner_id text,
  cta_partner_signed_at timestamptz,
  filed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (customer_id, scheme, period_start, period_end)
);

create index if not exists vat_oss_customer_idx on vat_oss_returns(customer_id);
create index if not exists vat_oss_status_idx on vat_oss_returns(status);

-- =====================================================
-- 7. vat_capital_goods — Capital Goods Scheme (Notice 706/2)
-- =====================================================
-- Land/buildings: 10-year adjustment period (where input VAT ≥ £250k)
-- Computers: 5-year adjustment period (where input VAT ≥ £50k single asset)
-- Aircraft / ships / boats: 5-year adjustment period (where input VAT ≥ £50k)
-- yearly_adjustments jsonb shape: [{ "year": 1, "use_pct": 75, "adjustment": -1234.00 }, ...]
-- =====================================================
create table if not exists vat_capital_goods (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references vat_customers(id) on delete cascade not null,
  asset_description text not null,
  asset_class text not null check (asset_class in ('land_buildings','computers','aircraft_ships','other')),
  acquisition_date date not null,
  acquisition_cost numeric(12,2) not null,
  acquisition_input_vat numeric(12,2) not null,
  initial_recoverable_pct numeric(5,2) not null,
  adjustment_years integer not null,
  current_adjustment_year integer not null default 1,
  yearly_adjustments jsonb not null default '[]'::jsonb,
  total_adjustments_to_date numeric(12,2) not null default 0,
  disposed_at date,
  disposal_treatment text,
  status text not null default 'active' check (status in ('active','disposed','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists vat_cgs_customer_idx on vat_capital_goods(customer_id);
create index if not exists vat_cgs_active_idx on vat_capital_goods(status) where status = 'active';

-- =====================================================
-- 8. vat_hmrc_enquiries — written/visit/phone enquiries from HMRC
-- =====================================================
create table if not exists vat_hmrc_enquiries (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references vat_customers(id) on delete cascade not null,
  notice_type text not null check (notice_type in ('written','officer_visit','pre_arranged','phone','schedule_36')),
  opened_on date not null,
  officer_name text,
  officer_email text,
  hmrc_reference text,
  subject_area text,
  deadline date,
  status text not null default 'triaged' check (status in
    ('triaged','pack_drafted','india_qa_review','cta_sign','await_customer_approval','sent','closed','escalated')),
  assessed_liability numeric(12,2),
  customer_charge_gbp numeric(10,2) default 495.00,
  supreme_capital_referral_id uuid,
  supreme_capital_referred_at timestamptz,
  insurance_law_referral_id uuid,
  response_pack_path text,
  india_qa_id uuid,
  cta_partner_id text,
  cta_partner_signed_at timestamptz,
  sent_at timestamptz,
  closed_at timestamptz,
  outcome text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists vat_enq_customer_idx on vat_hmrc_enquiries(customer_id);
create index if not exists vat_enq_deadline_idx on vat_hmrc_enquiries(deadline) where status not in ('sent','closed');
create index if not exists vat_enq_status_idx on vat_hmrc_enquiries(status);

-- =====================================================
-- 9. vat_penalty_points — points-based penalty regime (Jan 2023+)
-- =====================================================
-- Quarterly filers: 4 points → £200 fixed penalty
-- Monthly filers:   5 points → £200 fixed penalty
-- Annual filers:    2 points → £200 fixed penalty
-- Points expire 24 months after issue (rolling), unless threshold reached
-- (then a "period of compliance" + all returns in must be met).
-- =====================================================
create table if not exists vat_penalty_points (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references vat_customers(id) on delete cascade not null,
  issued_on date not null,
  expires_on date not null,
  return_period text not null,
  return_id uuid references vat_returns(id) on delete set null,
  status text not null default 'live' check (status in ('live','expired','appealed','fixed_penalty_triggered','reset')),
  appeal_filed_at timestamptz,
  appeal_outcome text,
  reset_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists vat_pp_customer_idx on vat_penalty_points(customer_id, status);
create index if not exists vat_pp_expiry_idx on vat_penalty_points(expires_on) where status = 'live';

-- =====================================================
-- 10. vat_alerts — return-due · penalty-point · threshold · LPP imminent
-- =====================================================
create table if not exists vat_alerts (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references vat_customers(id) on delete cascade not null,
  return_id uuid references vat_returns(id) on delete cascade,
  alert_type text not null check (alert_type in
    ('return_due_90d','return_due_60d','return_due_30d','return_due_7d','return_due_3d','return_overdue',
     'penalty_point_exposure','penalty_threshold_imminent','fixed_penalty_triggered',
     'registration_threshold_breached','deregistration_threshold_eligible',
     'lpp1_day15_imminent','lpp1_day30_imminent','lpp2_accruing',
     'partial_exemption_annual_adjustment_due','cgs_adjustment_due',
     'oss_return_due_30d','oss_return_due_7d','hmrc_enquiry_deadline_imminent',
     'cta_sign_off_required','india_qa_required')),
  trigger_date date not null,
  payload jsonb,
  severity text not null default 'medium' check (severity in ('low','medium','high','critical')),
  status text not null default 'new' check (status in ('new','sent','acknowledged','resolved')),
  sent_at timestamptz,
  acknowledged_at timestamptz,
  acknowledged_by uuid,
  created_at timestamptz not null default now(),
  unique (customer_id, alert_type, trigger_date)
);

create index if not exists vat_alerts_customer_idx on vat_alerts(customer_id);
create index if not exists vat_alerts_unsent_idx on vat_alerts(trigger_date) where status = 'new';
create index if not exists vat_alerts_severity_idx on vat_alerts(severity) where status in ('new','sent');

-- =====================================================
-- 11. vat_cta_referrals — referrals to CTA / CIOT / ATT partner advisers
-- =====================================================
create table if not exists vat_cta_referrals (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references vat_customers(id) on delete cascade not null,
  partner_id text not null,
  query_text text not null,
  detected_triggers text[] not null default array[]::text[],
  subject_area text check (subject_area in
    ('partial_exemption','drc','oss_ioss','toms','margin','group_vat',
     'place_of_supply','capital_goods','hmrc_enquiry','registration','other')),
  routing_strategy text not null default 'geography' check (routing_strategy in
    ('geography','specialism','round_robin','customer_choice')),
  referral_brief jsonb not null,
  commission_firewall_disclosed boolean not null default true,
  status text not null default 'sent' check (status in ('sent','accepted','declined','completed','withdrawn')),
  partner_responded_at timestamptz,
  partner_outcome_summary text,
  fee_split_terms text default '50/50 net of disbursements',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists vat_ref_customer_idx on vat_cta_referrals(customer_id);
create index if not exists vat_ref_partner_idx on vat_cta_referrals(partner_id);
create index if not exists vat_ref_status_idx on vat_cta_referrals(status);

-- =====================================================
-- vat_cta_partners — reference table for CTA / CIOT / ATT partner firms
-- =====================================================
-- Complex VAT advice in the UK is not a "reserved activity" but it carries
-- professional indemnity exposure and (where the partner is HMRC-AML
-- supervised) regulatory accountability. vat.law routes regulated complex
-- tax advice questions to CTA-qualified partner firms.
-- =====================================================
create table if not exists vat_cta_partners (
  partner_id text primary key,
  firm_name text not null,
  qualification text not null check (qualification in ('CTA','CIOT','ATT','CTA_CIOT','CTA_ATT')),
  member_number text,
  city text not null,
  region text,
  coverage_region text,
  primary_contact_name text,
  primary_contact_email text,
  primary_contact_phone text,
  specialisms text[] not null default array[]::text[],
  referral_commission_pct numeric(5,2),
  fee_split_terms text default '50/50 net of disbursements',
  service_level_hours integer default 24,
  active boolean not null default true,
  notes text
);

insert into vat_cta_partners
  (partner_id, firm_name, qualification, member_number, city, region, coverage_region,
   primary_contact_name, primary_contact_email, specialisms, service_level_hours)
values
  ('WCTA_LDN','Westminster CTA Partners LLP','CTA','CTA-2026-LDN-001','London','Greater London','south',
   'Partner Contact','referrals@westminster-cta.example',
   array['partial_exemption','drc','oss','toms','margin','group','enquiry'], 24),
  ('MTAX_MAN','Manchester Tax Advisers Ltd','CIOT','CIOT-2026-MAN-002','Manchester','North West','north_west',
   'Partner Contact','referrals@manchester-tax.example',
   array['partial_exemption','drc','oss','toms','margin','group','enquiry'], 24),
  ('NIT_NCL','Newcastle Indirect Tax LLP','CTA','CTA-2026-NCL-003','Newcastle upon Tyne','North East','north_east',
   'Partner Contact','referrals@newcastle-indirect-tax.example',
   array['partial_exemption','drc','oss','toms','margin','group','enquiry'], 48)
on conflict (partner_id) do nothing;

-- =====================================================
-- Audit log: every return submission, methodology sign-off and enquiry response
-- is logged immutably for HMRC AML-supervised audit-trail purposes.
-- =====================================================
create table if not exists vat_audit_log (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null,
  table_name text not null,
  row_id uuid not null,
  action text not null check (action in ('insert','update','delete','submit','approve','reject','sign')),
  actor_id uuid,
  actor_role text,
  diff jsonb,
  occurred_at timestamptz not null default now()
);

create index if not exists vat_audit_customer_idx on vat_audit_log(customer_id, occurred_at desc);
create index if not exists vat_audit_row_idx on vat_audit_log(table_name, row_id);

-- =====================================================
-- Trigger: touch updated_at
-- =====================================================
create or replace function vat_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end$$;

create trigger vat_customers_touch before update on vat_customers
  for each row execute function vat_touch_updated_at();
create trigger vat_returns_touch before update on vat_returns
  for each row execute function vat_touch_updated_at();
create trigger vat_invoices_touch before update on vat_invoices
  for each row execute function vat_touch_updated_at();
create trigger vat_pe_touch before update on vat_partial_exemption_records
  for each row execute function vat_touch_updated_at();
create trigger vat_drc_touch before update on vat_drc_assignments
  for each row execute function vat_touch_updated_at();
create trigger vat_oss_touch before update on vat_oss_returns
  for each row execute function vat_touch_updated_at();
create trigger vat_cgs_touch before update on vat_capital_goods
  for each row execute function vat_touch_updated_at();
create trigger vat_enq_touch before update on vat_hmrc_enquiries
  for each row execute function vat_touch_updated_at();
create trigger vat_pp_touch before update on vat_penalty_points
  for each row execute function vat_touch_updated_at();
create trigger vat_ref_touch before update on vat_cta_referrals
  for each row execute function vat_touch_updated_at();

-- =====================================================
-- Audit trigger: write every mutation on submission-critical tables
-- =====================================================
create or replace function vat_audit_capture()
returns trigger language plpgsql as $$
declare
  v_customer uuid;
begin
  if tg_op = 'DELETE' then
    v_customer := old.customer_id;
    insert into vat_audit_log (customer_id, table_name, row_id, action, diff)
      values (v_customer, tg_table_name, old.id, 'delete', to_jsonb(old));
    return old;
  else
    v_customer := new.customer_id;
    insert into vat_audit_log (customer_id, table_name, row_id, action, diff)
      values (v_customer, tg_table_name, new.id, lower(tg_op), to_jsonb(new));
    return new;
  end if;
end$$;

create trigger vat_returns_audit after insert or update or delete on vat_returns
  for each row execute function vat_audit_capture();
create trigger vat_pe_audit after insert or update or delete on vat_partial_exemption_records
  for each row execute function vat_audit_capture();
create trigger vat_drc_audit after insert or update or delete on vat_drc_assignments
  for each row execute function vat_audit_capture();
create trigger vat_oss_audit after insert or update or delete on vat_oss_returns
  for each row execute function vat_audit_capture();
create trigger vat_enq_audit after insert or update or delete on vat_hmrc_enquiries
  for each row execute function vat_audit_capture();

-- =====================================================
-- Row-Level Security
-- =====================================================
alter table vat_customers enable row level security;
alter table vat_returns enable row level security;
alter table vat_invoices enable row level security;
alter table vat_partial_exemption_records enable row level security;
alter table vat_drc_assignments enable row level security;
alter table vat_oss_returns enable row level security;
alter table vat_capital_goods enable row level security;
alter table vat_hmrc_enquiries enable row level security;
alter table vat_penalty_points enable row level security;
alter table vat_alerts enable row level security;
alter table vat_cta_referrals enable row level security;
alter table vat_audit_log enable row level security;

create policy "vc_own" on vat_customers
  for all using (profile_id = auth.uid()) with check (profile_id = auth.uid());

create policy "vr_own" on vat_returns
  for all using (customer_id in (select id from vat_customers where profile_id = auth.uid()));

create policy "vi_own" on vat_invoices
  for all using (customer_id in (select id from vat_customers where profile_id = auth.uid()));

create policy "vpe_own" on vat_partial_exemption_records
  for all using (customer_id in (select id from vat_customers where profile_id = auth.uid()));

create policy "vdrc_own" on vat_drc_assignments
  for all using (customer_id in (select id from vat_customers where profile_id = auth.uid()));

create policy "voss_own" on vat_oss_returns
  for all using (customer_id in (select id from vat_customers where profile_id = auth.uid()));

create policy "vcgs_own" on vat_capital_goods
  for all using (customer_id in (select id from vat_customers where profile_id = auth.uid()));

create policy "venq_own" on vat_hmrc_enquiries
  for all using (customer_id in (select id from vat_customers where profile_id = auth.uid()));

create policy "vpp_own" on vat_penalty_points
  for all using (customer_id in (select id from vat_customers where profile_id = auth.uid()));

create policy "valerts_own" on vat_alerts
  for all using (customer_id in (select id from vat_customers where profile_id = auth.uid()));

create policy "vref_own" on vat_cta_referrals
  for all using (customer_id in (select id from vat_customers where profile_id = auth.uid()));

create policy "vaudit_own" on vat_audit_log
  for select using (customer_id in (select id from vat_customers where profile_id = auth.uid()));
