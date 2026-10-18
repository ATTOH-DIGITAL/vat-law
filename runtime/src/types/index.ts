// vat.law domain types — Vertical #25

export type Tier = 'essentials' | 'pro' | 'cross_border'

export type VatScheme =
  | 'standard'
  | 'flat_rate'
  | 'cash_accounting'
  | 'annual_accounting'
  | 'margin_secondhand'
  | 'margin_toms'
  | 'retail_apportionment'
  | 'retail_direct_calc'

export type PartialExemptionMethod = 'standard' | 'special'

export type ReturnStatus =
  | 'draft'
  | 'awaiting_qa'
  | 'qa_approved'
  | 'submitted'
  | 'accepted'
  | 'rejected'

export type IndiaQaStatus = 'pending' | 'approved' | 'rejected' | 'needs_clarification'

export type AccountingPlatform = 'xero' | 'quickbooks' | 'sage' | 'freeagent' | 'manual'

export type DrcCategory =
  | 'standard'                  // outside DRC — standard 20% applies
  | 'construction_drc'          // CIS DRC 20% / 5%
  | 'mobile_phones'             // s.55A wholesale DRC
  | 'computer_chips'
  | 'gas_electricity_wholesale'
  | 'emissions_allowances'
  | 'telecoms_wholesale'

export type AlertSeverity = 'info' | 'warning' | 'critical'

export type AlertCategory =
  | 'return_due'
  | 'penalty_point'
  | 'enquiry'
  | 'cgs_anniversary'
  | 'oss_quarter'
  | 'threshold_crossed'
  | 'mtd_obligation'
  | 'partial_exemption_annual'

export type EnquiryStage =
  | 'notice_received'
  | 'response_drafting'
  | 'response_qa'
  | 'submitted'
  | 'follow_up'
  | 'closed_no_action'
  | 'closed_with_assessment'

// Core customer record
export interface Customer {
  id: string
  profile_id: string
  legal_name: string
  trading_name: string | null
  tier: Tier
  vrn: string | null                  // 9-digit VAT registration number
  scheme: VatScheme
  registration_date: string | null
  flat_rate_pct: number | null
  flat_rate_sector: string | null
  partial_exemption_method: PartialExemptionMethod | null
  uses_cash_accounting: boolean
  uses_annual_accounting: boolean
  is_group_representative: boolean
  group_members: string[]             // VRNs of group members
  accounting_platform: AccountingPlatform
  accounting_platform_tenant_id: string | null
  hmrc_mtd_connected_at: string | null
  hmrc_mtd_access_token_encrypted: string | null
  hmrc_mtd_refresh_token_encrypted: string | null
  hmrc_mtd_token_expires_at: string | null
  current_penalty_points: number
  penalty_points_threshold: number    // 4 quarterly / 5 monthly / 2 annual
  created_at: string
  updated_at: string
}

// 9-box VAT return (HMRC MTD)
export interface VatReturn {
  id: string
  customer_id: string
  period_key: string                  // e.g. "24A1"
  period_start: string
  period_end: string
  due_date: string
  // 9 boxes per HMRC VAT return
  box1_vat_due_sales: number          // VAT due on sales and other outputs
  box2_vat_due_acquisitions: number   // VAT due on acquisitions from EU member states
  box3_total_vat_due: number          // = box1 + box2
  box4_vat_reclaimed: number          // VAT reclaimed on purchases and other inputs
  box5_net_vat_due: number            // = box3 - box4 (positive = owed to HMRC)
  box6_total_sales_ex_vat: number     // Total value of sales and other outputs ex VAT
  box7_total_purchases_ex_vat: number // Total value of purchases and other inputs ex VAT
  box8_supplies_to_eu: number         // Total value of supplies of goods to EU member states
  box9_acquisitions_from_eu: number   // Total value of acquisitions of goods from EU member states
  finalised: boolean
  status: ReturnStatus
  india_qa_status: IndiaQaStatus | null
  india_qa_reviewed_by: string | null
  india_qa_reviewed_at: string | null
  hmrc_submission_form_bundle_number: string | null
  hmrc_submission_payment_indicator: string | null
  hmrc_submission_processing_date: string | null
  submitted_at: string | null
  rejection_reason: string | null
  created_at: string
  updated_at: string
}

// Invoice ingested from bookkeeping platform (sales or purchase)
export interface VatInvoice {
  id: string
  customer_id: string
  source_platform: AccountingPlatform
  source_invoice_id: string
  direction: 'sales' | 'purchase'
  invoice_date: string
  tax_point_date: string | null
  counterparty_name: string
  counterparty_vat_number: string | null
  counterparty_country: string        // ISO-3166-1 alpha-2
  net_amount: number
  vat_amount: number
  gross_amount: number
  vat_rate: number                    // 0, 5, 20 etc.
  vat_treatment: string               // 'standard' | 'zero_rated' | 'exempt' | 'reverse_charge' | 'outside_scope' | 'margin'
  drc_category: DrcCategory | null
  drc_classified_at: string | null
  drc_classified_by: 'ai' | 'india_qa' | 'customer' | null
  cgs_capital_good_id: string | null
  is_partial_exemption_input: boolean
  partial_exemption_residual: boolean
  created_at: string
  updated_at: string
}

// Partial exemption record (standard method or approved special method)
export interface PartialExemptionRecord {
  id: string
  customer_id: string
  period_start: string
  period_end: string
  method: PartialExemptionMethod
  taxable_supplies: number
  exempt_supplies: number
  total_supplies: number
  recovery_percentage: number          // rounded up to next whole percentage
  directly_attributable_taxable_input: number
  directly_attributable_exempt_input: number
  residual_input: number
  recoverable_residual_input: number
  total_recoverable_input: number
  de_minimis_passed: boolean           // £625/mo and ≤50% rule
  annual_adjustment_applied: boolean
  annual_adjustment_amount: number | null
  created_at: string
  updated_at: string
}

// Domestic Reverse Charge — CIS construction or wholesale specified goods
export interface DrcAssignment {
  id: string
  customer_id: string
  invoice_id: string
  category: DrcCategory
  rationale: string
  confidence_score: number             // 0..1 from classifier
  needs_india_qa: boolean
  india_qa_status: IndiaQaStatus | null
  reviewed_at: string | null
  created_at: string
  updated_at: string
}

// One-Stop-Shop / Import One-Stop-Shop return for cross-border B2C
export interface OssReturn {
  id: string
  customer_id: string
  scheme: 'oss_union' | 'oss_non_union' | 'ioss'
  quarter: string                      // e.g. "2026-Q1"
  period_start: string
  period_end: string
  member_state_breakdown: Array<{
    country: string                    // ISO-3166-1 alpha-2
    vat_rate: number
    taxable_amount: number
    vat_due: number
  }>
  total_vat_due: number
  reporting_member_state: string       // typically 'IE' for UK businesses post-Brexit using Irish OSS
  submitted_at: string | null
  status: ReturnStatus
  created_at: string
  updated_at: string
}

// Capital Goods Scheme — £250k+ land/buildings or £50k+ computer/ships/aircraft
export interface CapitalGood {
  id: string
  customer_id: string
  description: string
  acquisition_date: string
  acquisition_value: number
  input_vat_claimed: number
  asset_class: 'land_buildings' | 'computer_equipment' | 'ships' | 'aircraft'
  adjustment_period_years: number      // 10 for land/buildings, 5 for others
  initial_recovery_percentage: number
  annual_adjustments: Array<{
    interval_year: number
    interval_end: string
    recovery_percentage_this_interval: number
    adjustment_amount: number          // + payable to HMRC / - reclaimable
    applied_in_return_id: string | null
  }>
  disposed_at: string | null
  disposal_adjustment: number | null
  created_at: string
  updated_at: string
}

// HMRC enquiry — VAT compliance check / officer visit / assessment correspondence
export interface HmrcEnquiry {
  id: string
  customer_id: string
  notice_reference: string | null
  notice_received_at: string
  notice_pdf_url: string | null
  enquiry_type: 'desk_based' | 'on_site_visit' | 'aspect' | 'full' | 'assessment'
  periods_under_enquiry: string[]
  officer_name: string | null
  officer_email: string | null
  response_deadline: string
  stage: EnquiryStage
  cta_partner_id: string | null
  cta_partner_assigned_at: string | null
  india_qa_status: IndiaQaStatus | null
  draft_response_url: string | null
  final_response_url: string | null
  outcome_assessment_gbp: number | null
  outcome_penalty_gbp: number | null
  outcome_interest_gbp: number | null
  closed_at: string | null
  created_at: string
  updated_at: string
}

// Points-based penalty regime (Jan 2023+) — 1 point per late submission
export interface PenaltyPoint {
  id: string
  customer_id: string
  period_key: string
  awarded_at: string
  expires_at: string                   // 24-month clock from end of month after non-compliance
  threshold_at_award: number
  triggered_financial_penalty: boolean
  financial_penalty_amount: number | null
  cleared_by_compliance: boolean
  cleared_at: string | null
  created_at: string
}

// CTA / CIOT / ATT partner adviser (carries regulated VAT advice accountability)
export interface CtaPartner {
  id: string
  firm_name: string
  ciot_membership_number: string
  cta_registered: boolean
  att_registered: boolean
  primary_contact_name: string
  primary_contact_email: string
  primary_contact_phone: string | null
  regions_covered: string[]
  sectors_covered: string[]
  fee_split_pct: number                // default 80/20 in partner favour for HMRC enquiry tier
  is_active: boolean
  onboarded_at: string
  created_at: string
  updated_at: string
}

// Referral to CTA partner (HMRC enquiry handling, contentious assessments)
export interface CtaReferral {
  id: string
  customer_id: string
  enquiry_id: string | null
  cta_partner_id: string
  referral_reason: 'hmrc_enquiry' | 'assessment_appeal' | 'tribunal' | 'voluntary_disclosure'
  fee_gbp: number
  fee_split_partner_gbp: number
  fee_split_vatlaw_gbp: number
  referred_at: string
  partner_accepted_at: string | null
  partner_completed_at: string | null
  customer_satisfaction_rating: number | null
  created_at: string
  updated_at: string
}

// Dashboard alert
export interface VatAlert {
  id: string
  customer_id: string
  severity: AlertSeverity
  category: AlertCategory
  message: string
  related_return_id: string | null
  related_enquiry_id: string | null
  related_cgs_id: string | null
  due_at: string | null
  resolved_at: string | null
  created_at: string
}

// UK VAT statutory constants
export const VAT_REGISTRATION_THRESHOLD_GBP = 90000              // April 2024 threshold
export const VAT_DEREGISTRATION_THRESHOLD_GBP = 88000
export const STANDARD_VAT_RATE_PCT = 20
export const REDUCED_VAT_RATE_PCT = 5
export const PENALTY_POINTS_THRESHOLD_QUARTERLY = 4
export const PENALTY_POINTS_THRESHOLD_MONTHLY = 5
export const PENALTY_POINTS_THRESHOLD_ANNUAL = 2
export const PENALTY_POINTS_EXPIRY_MONTHS = 24
export const FIRST_LATE_PAYMENT_PENALTY_PCT_DAY_16 = 2
export const FIRST_LATE_PAYMENT_PENALTY_PCT_DAY_31 = 4
export const SECOND_LATE_PAYMENT_DAILY_RATE_PCT = 4              // annualised, applied daily from day 31 (post Apr 2025 fully active)
export const DE_MINIMIS_MONTHLY_GBP = 625
export const DE_MINIMIS_PERCENTAGE_PCT = 50
export const CGS_LAND_BUILDINGS_THRESHOLD_GBP = 250000
export const CGS_COMPUTER_SHIPS_AIRCRAFT_THRESHOLD_GBP = 50000
export const CGS_LAND_BUILDINGS_INTERVALS = 10
export const CGS_OTHER_INTERVALS = 5
