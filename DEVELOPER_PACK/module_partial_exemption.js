/**
 * vat.law · module_partial_exemption.js
 *
 * Pure-function module implementing partial-exemption calculations under
 * VAT Notice 706. Computes the recoverable percentage under the standard
 * method, supports special-method overrides, runs the de minimis test,
 * computes the annual adjustment, detects overlap with the Capital Goods
 * Scheme, and builds a methodology memo payload.
 *
 * REGULATORY BOUNDARY
 *   vat.law is a TECHNOLOGY PLATFORM. The partial-exemption math is
 *   deterministic and not regulated. However, methodology SIGN-OFF for
 *   Pro / Cross-Border customers (especially where the customer is on a
 *   special method, or where CGS overlap is detected, or where the
 *   recoverable percentage materially differs from the prior period)
 *   is regulated complex tax advice and is routed to a CTA / CIOT / ATT
 *   partner adviser via module_cta_referrer.js.
 *
 *   This module:
 *     1. Computes the standard-method residual recoverable percentage
 *           = taxable / (taxable + exempt) × 100
 *        rounded UP to the next whole percentage (Notice 706 §4.6)
 *     2. Supports special-method overrides (caller supplies the method
 *        and recoverable_percentage; we record it; no auto-compute)
 *     3. Runs the de minimis test (Notice 706 §11):
 *           exempt input tax ≤ £625/month average AND
 *           exempt input tax ≤ 50% of total input tax
 *        If de minimis passes, ALL input tax is recoverable.
 *     4. Computes the annual adjustment (Notice 706 §12) — compare the
 *        in-year recovery to the longer-period recovery and adjust on the
 *        first return after the longer-period end.
 *     5. Detects CGS overlap — if a capital good is in its adjustment
 *        period AND the customer is partly exempt, both regimes interact;
 *        we flag, do not compute the CGS adjustment here (see module_cgs).
 *     6. Builds the methodology memo payload (the customer-evidential
 *        record of how the period's recovery was computed).
 *
 *   CRITICAL: This module NEVER auto-finalises. Every output carries
 *   status: "await_cta_partner_sign" and is routed through India QA
 *   before customer presentation.
 *
 *   VAT Notice 706 references (live at May 2026):
 *     · Notice 706 §3 — the standard method
 *     · Notice 706 §4 — rounding the recovery percentage
 *     · Notice 706 §6 — special methods
 *     · Notice 706 §11 — de minimis
 *     · Notice 706 §12 — annual adjustment
 *     · Notice 706 §13 — CGS overlap
 */

const NOTICE_706_REFS = [
  'VAT Notice 706',
  'Notice 706 §3 (standard method)',
  'Notice 706 §4 (rounding)',
  'Notice 706 §6 (special methods)',
  'Notice 706 §11 (de minimis)',
  'Notice 706 §12 (annual adjustment)',
  'Notice 706 §13 (CGS overlap)',
]

const DE_MINIMIS_MONTHLY_LIMIT_GBP = 625
const DE_MINIMIS_QUARTERLY_LIMIT_GBP = 1875
const DE_MINIMIS_ANNUAL_LIMIT_GBP = 7500
const DE_MINIMIS_PROPORTION_CAP = 0.5

const SUPPORTED_METHODS = [
  'standard',
  'special',
  'sector',
  'transactions_based',
  'outputs_based',
  'inputs_based',
]

function round2(n) {
  return Math.round(n * 100) / 100
}

/**
 * Round the recoverable percentage UP to the next whole percentage,
 * per Notice 706 §4.6. e.g. 73.01 → 74; 73.00 → 73.
 */
function roundUpPercentage(pct) {
  if (pct >= 100) return 100
  if (pct <= 0) return 0
  const whole = Math.floor(pct)
  return pct === whole ? whole : whole + 1
}

/**
 * Standard-method recoverable percentage.
 *   recovery = taxable / (taxable + exempt) × 100
 *
 * @param {Object} input
 * @param {number} input.taxable_supplies   — value of taxable outputs (ex-VAT)
 * @param {number} input.exempt_supplies    — value of exempt outputs
 * @returns {{ percentage_raw: number, percentage_recoverable: number }}
 */
function standardMethodPercentage({ taxable_supplies, exempt_supplies }) {
  const taxable = Number(taxable_supplies) || 0
  const exempt = Number(exempt_supplies) || 0
  const denom = taxable + exempt
  if (denom <= 0) return { percentage_raw: 0, percentage_recoverable: 0 }
  const raw = (taxable / denom) * 100
  return {
    percentage_raw: round2(raw),
    percentage_recoverable: roundUpPercentage(raw),
  }
}

/**
 * Compute the period limit for the de minimis test based on filing frequency.
 *
 * @param {string} period_basis — 'monthly' | 'quarterly' | 'annually' | { months }
 * @param {number} months_in_period
 */
function deMinimisLimitGbp({ period_basis, months_in_period }) {
  if (typeof months_in_period === 'number' && months_in_period > 0) {
    return DE_MINIMIS_MONTHLY_LIMIT_GBP * months_in_period
  }
  if (period_basis === 'monthly') return DE_MINIMIS_MONTHLY_LIMIT_GBP
  if (period_basis === 'quarterly') return DE_MINIMIS_QUARTERLY_LIMIT_GBP
  if (period_basis === 'annually') return DE_MINIMIS_ANNUAL_LIMIT_GBP
  return DE_MINIMIS_QUARTERLY_LIMIT_GBP
}

/**
 * Run the de minimis test (Notice 706 §11).
 *   PASS if exempt input tax ≤ period limit (£625/month average)
 *        AND exempt input tax ≤ 50% of total input tax
 * If PASS, the entire input tax pot is recoverable.
 */
function deMinimisTest({
  exempt_input_tax,
  total_input_tax,
  period_basis = 'quarterly',
  months_in_period,
}) {
  const exempt = Number(exempt_input_tax) || 0
  const total = Number(total_input_tax) || 0
  const limit = deMinimisLimitGbp({ period_basis, months_in_period })
  const proportion = total > 0 ? exempt / total : 0
  const a_pass = exempt <= limit
  const b_pass = proportion <= DE_MINIMIS_PROPORTION_CAP
  const pass = a_pass && b_pass
  return {
    pass,
    limit_gbp: limit,
    exempt_input_tax: round2(exempt),
    total_input_tax: round2(total),
    proportion: round2(proportion * 100),
    reason: pass
      ? 'De minimis met — all input tax recoverable for the period.'
      : !a_pass && !b_pass
      ? `Both legs failed: exempt input tax £${round2(exempt)} > limit £${limit}; and ${round2(proportion * 100)}% > 50% cap.`
      : !a_pass
      ? `Leg (a) failed: exempt input tax £${round2(exempt)} > limit £${limit}.`
      : `Leg (b) failed: exempt input tax is ${round2(proportion * 100)}% of total input tax (cap 50%).`,
  }
}

/**
 * Compute the recoverable residual input tax under the applied method.
 *   recoverable_residual = residual_input_tax × recoverable_percentage / 100
 */
function computeRecoverableResidual({ residual_input_tax, recoverable_percentage }) {
  const r = Number(residual_input_tax) || 0
  const pct = Number(recoverable_percentage) || 0
  return round2((r * pct) / 100)
}

/**
 * Compute the annual adjustment (Notice 706 §12).
 *   Compare each quarterly recovery to the recovery that the longer-period
 *   (usually the partial-exemption year) computation produces. The difference
 *   is the adjustment, posted on the first return after the longer period.
 *
 * @param {Object} input
 * @param {Array<Object>} input.period_records — array of { period, recoverable_percentage, residual_input_tax, recoverable_residual }
 * @param {Object} input.longer_period          — { taxable_supplies, exempt_supplies, residual_input_tax }
 * @returns {Object} adjustment breakdown
 */
function annualAdjustment({ period_records, longer_period }) {
  if (!Array.isArray(period_records) || period_records.length === 0) {
    return {
      adjustment_gbp: 0,
      direction: 'none',
      reason: 'No period records supplied.',
    }
  }
  const lp = standardMethodPercentage({
    taxable_supplies: longer_period.taxable_supplies,
    exempt_supplies: longer_period.exempt_supplies,
  })
  const longer_residual = Number(longer_period.residual_input_tax) || 0
  const longer_recoverable = round2((longer_residual * lp.percentage_recoverable) / 100)
  const sum_in_year = period_records.reduce(
    (acc, p) => acc + (Number(p.recoverable_residual) || 0),
    0,
  )
  const diff = round2(longer_recoverable - sum_in_year)
  return {
    longer_period_percentage: lp.percentage_recoverable,
    longer_period_recoverable: longer_recoverable,
    in_year_recoverable_sum: round2(sum_in_year),
    adjustment_gbp: diff,
    direction: diff > 0 ? 'reclaim_more' : diff < 0 ? 'repay_back' : 'none',
    reason:
      diff === 0
        ? 'No annual adjustment required — in-year recovery equals longer-period recovery.'
        : diff > 0
        ? `Customer under-recovered by £${Math.abs(diff)} across the in-year periods; reclaim on next return.`
        : `Customer over-recovered by £${Math.abs(diff)} across the in-year periods; repay on next return.`,
  }
}

/**
 * Detect overlap with the Capital Goods Scheme.
 *   If any capital good is in its adjustment period (years remaining > 0)
 *   AND the customer is partly exempt, the CGS adjustment interacts with
 *   the partial-exemption recovery. We flag this; we do NOT compute the
 *   CGS adjustment here (that lives in the CGS module).
 *
 * @param {Object} input
 * @param {Array<Object>} input.capital_goods — rows from vat_capital_goods
 * @param {Date|string}    input.as_of_date
 */
function detectCgsOverlap({ capital_goods, as_of_date }) {
  if (!Array.isArray(capital_goods) || capital_goods.length === 0) {
    return { overlap: false, assets: [] }
  }
  const asOf = new Date(as_of_date || Date.now())
  const overlapping = capital_goods
    .filter((cg) => cg.status === 'active')
    .filter((cg) => {
      const acquired = new Date(cg.acquisition_date)
      const yearsElapsed =
        (asOf.getTime() - acquired.getTime()) / (1000 * 60 * 60 * 24 * 365.25)
      return yearsElapsed < (cg.adjustment_years || 0)
    })
    .map((cg) => ({
      capital_good_id: cg.id,
      description: cg.asset_description,
      asset_class: cg.asset_class,
      adjustment_years: cg.adjustment_years,
      current_year: cg.current_adjustment_year,
      initial_recoverable_pct: cg.initial_recoverable_pct,
    }))
  return {
    overlap: overlapping.length > 0,
    assets: overlapping,
  }
}

/**
 * Build the methodology memo payload — the customer-evidential record of
 * how the period's recovery was computed. This is the document that gets
 * rendered into the methodology memo PDF and stored in the audit trail.
 *
 * @param {Object} input — all the upstream computation outputs
 * @returns {Object} memo payload
 */
function buildMethodologyMemo(input) {
  return {
    template: 'partial_exemption_methodology_memo_v1',
    statutory_basis: 'VAT Notice 706',
    customer_id: input.customer.id,
    customer_legal_name: input.customer.legal_name,
    vrn: input.customer.vrn,
    period: input.period,
    method: input.method,
    method_recoverable_percentage: input.recoverable_percentage,
    standard_method_calc: input.standard_method_calc,
    inputs: {
      taxable_supplies: input.taxable_supplies,
      exempt_supplies: input.exempt_supplies,
      total_input_tax: input.total_input_tax,
      directly_attributable_taxable: input.directly_attributable_taxable,
      directly_attributable_exempt: input.directly_attributable_exempt,
      residual_input_tax: input.residual_input_tax,
    },
    outputs: {
      recoverable_residual: input.recoverable_residual,
      exempt_input_tax_recovered: input.exempt_input_tax_recovered,
      total_recoverable: round2(
        (input.directly_attributable_taxable || 0) +
          (input.recoverable_residual || 0) +
          (input.exempt_input_tax_recovered || 0),
      ),
    },
    de_minimis: input.de_minimis,
    annual_adjustment: input.annual_adjustment || null,
    cgs_overlap: input.cgs_overlap || { overlap: false, assets: [] },
    notice_706_references: NOTICE_706_REFS,
    status: 'await_cta_partner_sign',
    india_qa_required: true,
    cta_partner_sign_required: input.cta_partner_sign_required,
    cta_partner_sign_required_because:
      input.method !== 'standard'
        ? 'Customer is on a special method — methodology sign-off required.'
        : input.cgs_overlap && input.cgs_overlap.overlap
        ? 'CGS overlap detected — interaction between partial-exemption and CGS requires CTA sign-off.'
        : input.material_change_from_prior_period
        ? 'Recoverable percentage moved materially vs. prior period — CTA sign-off required.'
        : null,
    auto_finalise: false,
    generated_at: new Date().toISOString(),
  }
}

/**
 * Top-level: compute a period's partial-exemption recovery from supplied
 * inputs and emit the queued record. NEVER persists. NEVER files. Output
 * is fed to India QA + (where required) CTA partner sign-off.
 */
function computePeriod(input) {
  if (!input || !input.customer) throw new Error('computePeriod: customer required')
  const method = input.method || 'standard'
  if (!SUPPORTED_METHODS.includes(method)) {
    throw new Error(`computePeriod: unsupported method ${method}`)
  }

  let standard_method_calc = null
  let recoverable_percentage = null

  if (method === 'standard') {
    standard_method_calc = standardMethodPercentage({
      taxable_supplies: input.taxable_supplies,
      exempt_supplies: input.exempt_supplies,
    })
    recoverable_percentage = standard_method_calc.percentage_recoverable
  } else {
    if (typeof input.recoverable_percentage !== 'number') {
      throw new Error('computePeriod: special method requires caller-supplied recoverable_percentage')
    }
    recoverable_percentage = input.recoverable_percentage
  }

  const recoverable_residual = computeRecoverableResidual({
    residual_input_tax: input.residual_input_tax,
    recoverable_percentage,
  })

  const directly_attributable_exempt = Number(input.directly_attributable_exempt) || 0
  const residual_exempt = round2(
    (Number(input.residual_input_tax) || 0) - recoverable_residual,
  )
  const exempt_input_tax_total = round2(directly_attributable_exempt + residual_exempt)

  const de_minimis = deMinimisTest({
    exempt_input_tax: exempt_input_tax_total,
    total_input_tax: input.total_input_tax,
    period_basis: input.period_basis,
    months_in_period: input.months_in_period,
  })

  // If de minimis passes, ALL input tax is recoverable for the period.
  const exempt_input_tax_recovered = de_minimis.pass ? exempt_input_tax_total : 0

  const cgs_overlap = detectCgsOverlap({
    capital_goods: input.capital_goods || [],
    as_of_date: input.period_end,
  })

  const annual_adjustment_payload = input.is_annual_adjustment
    ? annualAdjustment({
        period_records: input.period_records || [],
        longer_period: input.longer_period || {},
      })
    : null

  const cta_partner_sign_required =
    method !== 'standard' ||
    cgs_overlap.overlap === true ||
    input.material_change_from_prior_period === true ||
    !!input.is_annual_adjustment

  const memo = buildMethodologyMemo({
    customer: input.customer,
    period: input.period,
    method,
    recoverable_percentage,
    standard_method_calc,
    taxable_supplies: input.taxable_supplies,
    exempt_supplies: input.exempt_supplies,
    total_input_tax: input.total_input_tax,
    directly_attributable_taxable: input.directly_attributable_taxable,
    directly_attributable_exempt,
    residual_input_tax: input.residual_input_tax,
    recoverable_residual,
    exempt_input_tax_recovered,
    de_minimis,
    annual_adjustment: annual_adjustment_payload,
    cgs_overlap,
    cta_partner_sign_required,
    material_change_from_prior_period: !!input.material_change_from_prior_period,
  })

  return {
    ok: true,
    status: 'await_cta_partner_sign',
    method,
    recoverable_percentage,
    recoverable_residual,
    exempt_input_tax_recovered,
    de_minimis,
    cgs_overlap,
    annual_adjustment: annual_adjustment_payload,
    methodology_memo: memo,
    routes_to: ['india_qa', cta_partner_sign_required ? 'cta_partner' : null].filter(Boolean),
    auto_finalise: false,
    notice_706_references: NOTICE_706_REFS,
  }
}

module.exports = {
  NOTICE_706_REFS,
  DE_MINIMIS_MONTHLY_LIMIT_GBP,
  DE_MINIMIS_QUARTERLY_LIMIT_GBP,
  DE_MINIMIS_ANNUAL_LIMIT_GBP,
  DE_MINIMIS_PROPORTION_CAP,
  SUPPORTED_METHODS,
  roundUpPercentage,
  standardMethodPercentage,
  deMinimisLimitGbp,
  deMinimisTest,
  computeRecoverableResidual,
  annualAdjustment,
  detectCgsOverlap,
  buildMethodologyMemo,
  computePeriod,
}
