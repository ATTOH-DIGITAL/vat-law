/**
 * vat.law · module_oss_engine.js
 *
 * Pure-function module implementing cross-border B2C VAT under the EU
 * One Stop Shop (OSS) Union and non-Union schemes, the Import One Stop
 * Shop (IOSS), and the UK place-of-supply rules for digital services
 * and goods. Reconciles import VAT against Postponed VAT Accounting
 * (PVA) C79 / MPIVS statements.
 *
 * REGULATORY BOUNDARY
 *   vat.law is a TECHNOLOGY PLATFORM. The classification rules
 *   (B2B vs. B2C, digital service vs. goods, place-of-supply, IOSS
 *   £135 threshold) are deterministic and the platform encodes them.
 *   Where the customer's establishment is contested, where multi-member-state
 *   establishment is in play, or where the OSS / IOSS election is being
 *   reconsidered, the underlying decision is regulated complex tax advice
 *   and is routed to a CTA / CIOT / ATT partner via module_cta_referrer.js.
 *
 *   This module:
 *     1. Classifies a transaction as B2B or B2C
 *     2. Classifies a supply as digital service / goods / both
 *     3. Determines the place of supply (UK / EU / RoW)
 *     4. For B2C goods to EU consumers, computes VAT at the destination
 *        member-state rate (from the snapshot table below)
 *     5. For B2C digital services to EU consumers, applies the
 *        member-state rate via OSS Union (UK seller can't use Union scheme
 *        post-Brexit — must use non-Union if NETP, or register locally)
 *     6. For low-value imports (≤ £135 / €150 consignment value) into the
 *        UK, applies the IOSS pathway
 *     7. Reconciles import VAT claimed under PVA against the customer's
 *        C79 statement totals
 *     8. Validates the EORI number shape
 *
 *   CRITICAL: This module NEVER auto-submits OSS / IOSS returns. Every
 *   output is queued to India QA before customer review.
 *
 *   EU member-state VAT rates below are a SNAPSHOT as of 18 June 2026
 *   (full 27-state re-verification on that date). The rates table must be
 *   re-validated quarterly against ec.europa.eu/taxation_customs.
 */

const IOSS_LOW_VALUE_THRESHOLD_GBP = 135
const IOSS_LOW_VALUE_THRESHOLD_EUR = 150

// EU member-state standard VAT rates — snapshot as of 18 June 2026.
// Source: ec.europa.eu/taxation_customs/vat-rates_en. Full 27-state
// re-verification 18 Jun 2026 (web-sourced): EE 22→24 (1 Jul 2025, permanent)
// and RO 19→21 (1 Aug 2025, Law 141/2025) corrected; all others unchanged.
const EU_MEMBER_STATE_STANDARD_VAT_RATES = {
  AT: 20.0, // Austria
  BE: 21.0, // Belgium
  BG: 20.0, // Bulgaria
  CY: 19.0, // Cyprus
  CZ: 21.0, // Czechia
  DE: 19.0, // Germany
  DK: 25.0, // Denmark
  EE: 24.0, // Estonia (raised to 24% 1 Jul 2025, made permanent)
  ES: 21.0, // Spain
  FI: 25.5, // Finland (raised from 24% Sep 2024)
  FR: 20.0, // France
  GR: 24.0, // Greece
  HR: 25.0, // Croatia
  HU: 27.0, // Hungary
  IE: 23.0, // Ireland
  IT: 22.0, // Italy
  LT: 21.0, // Lithuania
  LU: 17.0, // Luxembourg
  LV: 21.0, // Latvia
  MT: 18.0, // Malta
  NL: 21.0, // Netherlands
  PL: 23.0, // Poland
  PT: 23.0, // Portugal
  RO: 21.0, // Romania (raised to 21% 1 Aug 2025, Law 141/2025)
  SE: 25.0, // Sweden
  SI: 22.0, // Slovenia
  SK: 23.0, // Slovakia (raised from 20% Jan 2025)
}

const EU_MEMBER_STATE_CODES = Object.keys(EU_MEMBER_STATE_STANDARD_VAT_RATES)

// EORI shape — UK GB EORI is "GB" + 12 digits (legal-entity-level)
// or "GB" + 12 digits + "000" suffix. XI EORI (Northern Ireland) is "XI" + 12 digits.
const EORI_REGEX = /^(GB|XI)[0-9]{12}([0-9]{3})?$/i

function round2(n) {
  return Math.round(n * 100) / 100
}

function normaliseEori(input) {
  if (input == null) return ''
  return String(input).replace(/\s+/g, '').toUpperCase()
}

/**
 * Validate EORI number shape. Does NOT verify against the EORI database
 * (that would require a network call; module is pure).
 */
function validateEori(input) {
  const eori = normaliseEori(input)
  if (!eori) return { valid: false, reason: 'EORI is empty.', eori: null }
  if (!EORI_REGEX.test(eori)) {
    return {
      valid: false,
      reason: 'EORI must be GB or XI followed by 12 digits (and optional 3-digit branch suffix).',
      eori,
    }
  }
  return { valid: true, eori, country: eori.slice(0, 2) }
}

/**
 * Classify a transaction as B2B or B2C from the customer's VAT-number
 * presence and a (validated upstream) flag.
 */
function classifyB2BvsB2C({ customer_vat_number, customer_business_flag }) {
  const has_vat = typeof customer_vat_number === 'string' && customer_vat_number.trim().length > 4
  if (has_vat) return { is_b2b: true, reason: 'Customer supplied a VAT number — treat as B2B.' }
  if (customer_business_flag === true) {
    return { is_b2b: true, reason: 'Customer flagged as business without VAT number — treat as B2B subject to evidence.' }
  }
  return { is_b2b: false, reason: 'No VAT number and no business flag — treat as B2C.' }
}

/**
 * Classify a supply as digital service / goods / mixed.
 */
function classifySupplyKind({ supply_kind }) {
  if (supply_kind === 'digital_service') return { kind: 'digital_service' }
  if (supply_kind === 'goods') return { kind: 'goods' }
  if (supply_kind === 'service_non_digital') return { kind: 'service_non_digital' }
  if (supply_kind === 'mixed') return { kind: 'mixed' }
  return { kind: 'unknown' }
}

/**
 * Determine place of supply.
 *   - Digital services B2C → customer's member state (use OSS)
 *   - Goods B2C dispatched UK → EU → distance-sale to customer's state (OSS Union for established EU sellers;
 *     UK sellers post-Brexit register locally or via non-Union/import pathways)
 *   - Goods B2B → standard intra-EU rules (out of OSS scope)
 */
function determinePlaceOfSupply({ is_b2b, supply_kind, customer_country_code }) {
  const cc = (customer_country_code || '').toUpperCase()
  const is_eu = EU_MEMBER_STATE_CODES.includes(cc)
  if (cc === 'GB') return 'uk'
  if (is_b2b && is_eu) return 'eu_b2b'
  if (!is_b2b && is_eu && supply_kind === 'digital_service') return 'digital_b2c'
  if (!is_b2b && is_eu && supply_kind === 'goods') return 'eu_b2c'
  if (!is_b2b && !is_eu && supply_kind === 'digital_service') return 'digital_b2c_row'
  if (is_b2b && !is_eu) return 'row_b2b'
  if (!is_b2b && !is_eu) return 'row_b2c'
  return 'unknown'
}

/**
 * Detect whether an import qualifies under IOSS (low value).
 *   IOSS threshold: £135 GBP consignment value (UK) or €150 EUR (EU).
 */
function detectIoss({ consignment_value, currency = 'GBP' }) {
  const v = Number(consignment_value) || 0
  const threshold = currency === 'EUR' ? IOSS_LOW_VALUE_THRESHOLD_EUR : IOSS_LOW_VALUE_THRESHOLD_GBP
  return {
    eligible_for_ioss: v <= threshold && v > 0,
    consignment_value: round2(v),
    currency,
    threshold,
    reason:
      v <= 0
        ? 'Consignment value missing — manual review.'
        : v <= threshold
        ? `Consignment value £${round2(v)} ≤ £${threshold} — IOSS pathway applies.`
        : `Consignment value £${round2(v)} > £${threshold} — IOSS does NOT apply; standard import VAT applies.`,
  }
}

/**
 * Compute member-state VAT on a B2C cross-border supply.
 */
function computeMemberStateVat({ net_amount, customer_country_code }) {
  const cc = (customer_country_code || '').toUpperCase()
  const rate_pct = EU_MEMBER_STATE_STANDARD_VAT_RATES[cc]
  if (rate_pct == null) {
    return {
      ok: false,
      member_state: cc,
      reason: `${cc} is not a recognised EU member state — manual review.`,
    }
  }
  const net = Number(net_amount) || 0
  const vat = round2(net * (rate_pct / 100))
  return {
    ok: true,
    member_state: cc,
    rate_pct,
    net_amount: round2(net),
    vat,
    gross: round2(net + vat),
  }
}

/**
 * Reconcile import VAT claimed under Postponed VAT Accounting (PVA) against
 * the C79 / MPIVS statement totals from HMRC.
 */
function reconcilePva({ pva_claimed_invoices, c79_statement }) {
  const claimed_total = (pva_claimed_invoices || []).reduce(
    (a, inv) => a + (Number(inv.import_vat) || 0),
    0,
  )
  const c79_total = Number(c79_statement?.total_import_vat) || 0
  const diff = round2(claimed_total - c79_total)
  const tolerance = 0.50 // pence tolerance for rounding
  return {
    claimed_total: round2(claimed_total),
    c79_total: round2(c79_total),
    diff,
    matches: Math.abs(diff) <= tolerance,
    tolerance,
    reason:
      Math.abs(diff) <= tolerance
        ? 'PVA claim reconciles with C79 statement within rounding tolerance.'
        : diff > tolerance
        ? `Customer claimed £${round2(claimed_total)} but C79 only shows £${round2(c79_total)} — over-claim of £${diff}.`
        : `Customer claimed £${round2(claimed_total)} but C79 shows £${round2(c79_total)} — under-claim of £${Math.abs(diff)}.`,
  }
}

/**
 * Aggregate OSS / IOSS country-by-country breakdown for a return period.
 * Returns the structure that lands in vat_oss_returns.country_breakdown.
 */
function buildCountryBreakdown({ invoices, customer_country_resolver }) {
  const accumulator = {}
  for (const inv of invoices || []) {
    const cc = (customer_country_resolver
      ? customer_country_resolver(inv)
      : inv.member_state_code || ''
    ).toUpperCase()
    if (!EU_MEMBER_STATE_CODES.includes(cc)) continue
    const computed = computeMemberStateVat({
      net_amount: inv.net,
      customer_country_code: cc,
    })
    if (!computed.ok) continue
    if (!accumulator[cc]) {
      accumulator[cc] = { net: 0, vat: 0, rate: computed.rate_pct, count: 0 }
    }
    accumulator[cc].net = round2(accumulator[cc].net + computed.net_amount)
    accumulator[cc].vat = round2(accumulator[cc].vat + computed.vat)
    accumulator[cc].count += 1
  }
  return accumulator
}

/**
 * Top-level: assemble a draft OSS return payload. NEVER auto-submits.
 */
function draftOssReturn(input) {
  if (!input || !input.customer) throw new Error('draftOssReturn: customer required')
  const eori = validateEori(input.customer.eori_number)
  const country_breakdown = buildCountryBreakdown({
    invoices: input.invoices || [],
    customer_country_resolver: input.customer_country_resolver,
  })
  const total_net = Object.values(country_breakdown).reduce((a, c) => a + c.net, 0)
  const total_vat = Object.values(country_breakdown).reduce((a, c) => a + c.vat, 0)

  return {
    ok: true,
    status: 'await_india_qa',
    scheme: input.scheme || 'oss_union',
    period: input.period,
    country_breakdown,
    total_net: round2(total_net),
    total_vat: round2(total_vat),
    eori_validation: eori,
    auto_submit: false,
    rates_snapshot_date: '2026-06-18',
    routes_to: ['india_qa'],
    reasoning:
      'Country-by-country breakdown computed at each member-state rate. Snapshot date 2026-06-18. India QA must validate before customer approval and OSS submission.',
  }
}

module.exports = {
  IOSS_LOW_VALUE_THRESHOLD_GBP,
  IOSS_LOW_VALUE_THRESHOLD_EUR,
  EU_MEMBER_STATE_STANDARD_VAT_RATES,
  EU_MEMBER_STATE_CODES,
  EORI_REGEX,
  normaliseEori,
  validateEori,
  classifyB2BvsB2C,
  classifySupplyKind,
  determinePlaceOfSupply,
  detectIoss,
  computeMemberStateVat,
  reconcilePva,
  buildCountryBreakdown,
  draftOssReturn,
}
