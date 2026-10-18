/**
 * vat.law · module_margin_toms.js
 *
 * Pure-function module implementing the VAT Margin Scheme (Notice 718) for
 * second-hand goods, the Auctioneers' Scheme (Notice 718/2), Global
 * Accounting (Notice 718/1), and the Tour Operators' Margin Scheme
 * (Notice 709/5) — TOMS.
 *
 * REGULATORY BOUNDARY
 *   vat.law is a TECHNOLOGY PLATFORM. The margin math is deterministic.
 *   Where the customer's eligibility for a scheme is contested, where the
 *   customer is switching between Margin and standard accounting, or
 *   where TOMS pre-payments need apportionment across travel components,
 *   the underlying decision is regulated complex tax advice and is
 *   routed to a CTA / CIOT / ATT partner via module_cta_referrer.js.
 *
 *   This module:
 *     1. Margin Scheme — computes VAT on the margin (sale − purchase),
 *        validates stock-book entries, applies the "no margin VAT if
 *        loss" rule, supports Global Accounting averaging, and
 *        documents the audit trail.
 *     2. TOMS — apportions a tour package between "in-scope" and
 *        "out-of-scope" supplies, calculates margin on the in-scope
 *        portion, handles pre-payments (deposits) by deferring margin
 *        until the tour is supplied, and tracks documentation completeness.
 *     3. Documentation pass/fail — the stock book + invoice + evidence
 *        trio is the audit trail HMRC requires; we flag missing pieces.
 *
 *   VAT Notice references (live at May 2026):
 *     · Notice 718    — the Margin Scheme (general)
 *     · Notice 718/1  — Global Accounting
 *     · Notice 718/2  — Auctioneers' Scheme
 *     · Notice 709/5  — TOMS
 */

const MARGIN_NOTICE_REFS = [
  'VAT Notice 718 (Margin Scheme)',
  'VAT Notice 718/1 (Global Accounting)',
  'VAT Notice 718/2 (Auctioneers Scheme)',
]

const TOMS_NOTICE_REFS = [
  'VAT Notice 709/5 (Tour Operators Margin Scheme)',
]

const STANDARD_VAT_RATE = 0.20

// Margin scheme VAT fraction at the standard rate: 1/6 of the margin.
const MARGIN_VAT_FRACTION = 1 / 6

const MARGIN_SCHEMES = ['margin', 'global_accounting', 'auctioneers']

function round2(n) {
  return Math.round(n * 100) / 100
}

/**
 * Required stock-book fields under Notice 718. If any field is missing,
 * the entry is "documentation_failed" and cannot be relied on as
 * evidence of margin-scheme eligibility.
 */
const STOCK_BOOK_REQUIRED_FIELDS = [
  'stock_number',
  'purchase_date',
  'purchase_invoice_number',
  'seller_name_address',
  'item_description',
  'purchase_price',
  'sale_date',
  'sale_invoice_number',
  'buyer_name_address',
  'sale_price',
]

/**
 * Validate a stock-book entry for completeness.
 */
function validateStockBookEntry(entry) {
  if (!entry || typeof entry !== 'object') {
    return { pass: false, missing: STOCK_BOOK_REQUIRED_FIELDS.slice(), reason: 'No stock-book entry supplied.' }
  }
  const missing = STOCK_BOOK_REQUIRED_FIELDS.filter((f) => entry[f] == null || entry[f] === '')
  return {
    pass: missing.length === 0,
    missing,
    reason:
      missing.length === 0
        ? 'All required stock-book fields present.'
        : `Stock-book entry incomplete — missing: ${missing.join(', ')}.`,
  }
}

/**
 * Compute margin VAT on a single second-hand-goods transaction.
 *
 *   margin = max(0, sale_price − purchase_price)
 *   vat_on_margin = margin × 1/6   (at the 20% standard rate)
 *
 * If sold at a loss, margin is zero and no VAT is due — but the loss
 * cannot be offset against profits on other items (except under
 * Global Accounting; see globalAccounting()).
 */
function computeMarginTransaction({ purchase_price, sale_price, stock_book_entry }) {
  const purchase = Number(purchase_price) || 0
  const sale = Number(sale_price) || 0
  const margin_raw = sale - purchase
  const margin = Math.max(0, margin_raw)
  const vat = round2(margin * MARGIN_VAT_FRACTION)
  const stock = validateStockBookEntry(stock_book_entry)
  return {
    purchase_price: round2(purchase),
    sale_price: round2(sale),
    margin: round2(margin),
    margin_raw: round2(margin_raw),
    is_loss: margin_raw < 0,
    vat_on_margin: vat,
    stock_book_pass: stock.pass,
    stock_book_missing: stock.missing,
    stock_book_reason: stock.reason,
    documentation_pass: stock.pass,
  }
}

/**
 * Global Accounting (Notice 718/1) — for low-value bulk second-hand goods
 * where a per-item stock book is impractical. The trader totals purchases
 * and sales in the period and pays VAT on the aggregate margin (sales − purchases).
 *
 * Negative aggregate margin (period loss) is carried FORWARD to the next
 * period; never refunded as a negative VAT figure.
 */
function globalAccounting({ period_purchases, period_sales, carried_forward_loss = 0 }) {
  const purchases = (period_purchases || []).reduce((a, p) => a + (Number(p) || 0), 0)
  const sales = (period_sales || []).reduce((a, s) => a + (Number(s) || 0), 0)
  const gross_margin = sales - purchases - (Number(carried_forward_loss) || 0)
  if (gross_margin <= 0) {
    return {
      method: 'global_accounting',
      period_purchases_total: round2(purchases),
      period_sales_total: round2(sales),
      carried_forward_loss: round2(Number(carried_forward_loss) || 0),
      net_margin: 0,
      vat_due: 0,
      new_carry_forward: round2(Math.abs(gross_margin)),
      reason: 'Period at or below break-even — no margin VAT due; loss carried forward.',
    }
  }
  return {
    method: 'global_accounting',
    period_purchases_total: round2(purchases),
    period_sales_total: round2(sales),
    carried_forward_loss: round2(Number(carried_forward_loss) || 0),
    net_margin: round2(gross_margin),
    vat_due: round2(gross_margin * MARGIN_VAT_FRACTION),
    new_carry_forward: 0,
    reason: `Margin VAT due on net margin of £${round2(gross_margin)}.`,
  }
}

// =====================================================
// TOMS — Tour Operators' Margin Scheme (Notice 709/5)
// =====================================================

const TOMS_IN_SCOPE_COMPONENTS = [
  'accommodation',
  'passenger_transport',
  'hire_of_means_of_transport',
  'trips_excursions',
  'services_of_tour_guides',
  'use_of_airport_lounges',
]

/**
 * TOMS pre-payment treatment (Notice 709/5).
 *   A deposit / pre-payment for a tour does NOT crystallise margin
 *   VAT at the point of receipt. Margin is crystallised when the tour
 *   is supplied (or, for an annual provisional calculation, at the
 *   provisional/annual adjustment).
 */
function tomsPrePaymentTreatment({ payment_received_at, tour_supplied_at, deposit_amount }) {
  const received = new Date(payment_received_at)
  const supplied = tour_supplied_at ? new Date(tour_supplied_at) : null
  if (!supplied || supplied > received) {
    return {
      crystallises_now: false,
      deposit_amount: round2(Number(deposit_amount) || 0),
      reason:
        'Pre-payment received before tour supplied — under TOMS the margin is calculated when the tour is supplied; defer VAT.',
    }
  }
  return {
    crystallises_now: true,
    deposit_amount: round2(Number(deposit_amount) || 0),
    reason: 'Tour has been supplied — include this pre-payment in the period margin calculation.',
  }
}

/**
 * Compute TOMS margin on a single tour package.
 *
 *   For each in-scope bought-in component (e.g. hotel night, flight),
 *   margin = customer_paid − supplier_cost
 *   vat = margin × 1/6
 *
 * Out-of-scope components (e.g. agency commission, in-house services)
 * are excluded from TOMS and follow standard VAT.
 */
function computeTomsPackage({ package_id, components, customer_pre_payments = [], tour_supplied_at }) {
  if (!Array.isArray(components) || components.length === 0) {
    throw new Error('computeTomsPackage: components required')
  }
  const breakdown = components.map((c) => {
    const customer = Number(c.customer_paid) || 0
    const supplier = Number(c.supplier_cost) || 0
    const margin = Math.max(0, customer - supplier)
    const in_scope = TOMS_IN_SCOPE_COMPONENTS.includes(c.kind)
    return {
      kind: c.kind,
      in_scope,
      customer_paid: round2(customer),
      supplier_cost: round2(supplier),
      margin: in_scope ? round2(margin) : 0,
      vat_on_margin: in_scope ? round2(margin * MARGIN_VAT_FRACTION) : 0,
      treatment: in_scope ? 'toms_margin' : 'standard_vat_outside_toms',
    }
  })
  const total_margin = breakdown.reduce((a, b) => a + b.margin, 0)
  const total_vat = breakdown.reduce((a, b) => a + b.vat_on_margin, 0)

  const pre_payment_summary = customer_pre_payments.map((pp) =>
    tomsPrePaymentTreatment({
      payment_received_at: pp.received_at,
      tour_supplied_at,
      deposit_amount: pp.amount,
    }),
  )
  const deferred = pre_payment_summary.filter((p) => !p.crystallises_now)
  const crystallised = pre_payment_summary.filter((p) => p.crystallises_now)

  return {
    package_id,
    breakdown,
    total_margin: round2(total_margin),
    total_vat_on_margin: round2(total_vat),
    pre_payments: {
      crystallised_count: crystallised.length,
      deferred_count: deferred.length,
      deferred_amount: round2(deferred.reduce((a, d) => a + d.deposit_amount, 0)),
      detail: pre_payment_summary,
    },
    toms_notice_references: TOMS_NOTICE_REFS,
    documentation_pass:
      breakdown.every((b) => b.supplier_cost > 0 && b.customer_paid > 0) === true,
  }
}

// =====================================================
// Top-level: compute a margin/TOMS period
// =====================================================

/**
 * Top-level: compute a period's margin-scheme or TOMS output and emit the
 * queued record. NEVER persists. NEVER files. Output is fed to India QA
 * (+ CTA partner sign-off if scheme switch / mixed treatment / TOMS adj).
 */
function computePeriod(input) {
  if (!input || !input.scheme) throw new Error('computePeriod: scheme required')
  const scheme = input.scheme

  let payload = null

  if (scheme === 'margin') {
    const txs = (input.transactions || []).map((t) =>
      computeMarginTransaction({
        purchase_price: t.purchase_price,
        sale_price: t.sale_price,
        stock_book_entry: t.stock_book_entry,
      }),
    )
    const total_margin = txs.reduce((a, t) => a + t.margin, 0)
    const total_vat = txs.reduce((a, t) => a + t.vat_on_margin, 0)
    const documentation_pass = txs.every((t) => t.documentation_pass)
    payload = {
      method: 'margin',
      transactions: txs,
      total_margin: round2(total_margin),
      total_vat_due: round2(total_vat),
      documentation_pass,
      notice_references: MARGIN_NOTICE_REFS,
    }
  } else if (scheme === 'global_accounting') {
    payload = globalAccounting({
      period_purchases: input.period_purchases,
      period_sales: input.period_sales,
      carried_forward_loss: input.carried_forward_loss,
    })
    payload.notice_references = MARGIN_NOTICE_REFS
    payload.documentation_pass = !!input.documentation_pass
  } else if (scheme === 'auctioneers') {
    // Auctioneers' Scheme (Notice 718/2) — auctioneer treats hammer price
    // less buyer's premium + commission as the margin. Same math, different
    // composition; require caller to have stripped buyer's premium upstream.
    const txs = (input.transactions || []).map((t) =>
      computeMarginTransaction({
        purchase_price: t.hammer_purchase_total,
        sale_price: t.hammer_sale_total,
        stock_book_entry: t.stock_book_entry,
      }),
    )
    payload = {
      method: 'auctioneers',
      transactions: txs,
      total_margin: round2(txs.reduce((a, t) => a + t.margin, 0)),
      total_vat_due: round2(txs.reduce((a, t) => a + t.vat_on_margin, 0)),
      documentation_pass: txs.every((t) => t.documentation_pass),
      notice_references: MARGIN_NOTICE_REFS,
    }
  } else if (scheme === 'toms') {
    const packages = (input.packages || []).map((p) =>
      computeTomsPackage({
        package_id: p.id,
        components: p.components,
        customer_pre_payments: p.customer_pre_payments,
        tour_supplied_at: p.tour_supplied_at,
      }),
    )
    payload = {
      method: 'toms',
      packages,
      total_margin: round2(packages.reduce((a, p) => a + p.total_margin, 0)),
      total_vat_due: round2(packages.reduce((a, p) => a + p.total_vat_on_margin, 0)),
      documentation_pass: packages.every((p) => p.documentation_pass),
      notice_references: TOMS_NOTICE_REFS,
    }
  } else {
    throw new Error(`computePeriod: unsupported scheme ${scheme}`)
  }

  const cta_partner_sign_required =
    payload.documentation_pass === false ||
    !!input.scheme_switch ||
    !!input.first_period_under_scheme

  return {
    ok: true,
    status: 'await_india_qa',
    scheme,
    payload,
    cta_partner_sign_required,
    routes_to: ['india_qa', cta_partner_sign_required ? 'cta_partner' : null].filter(Boolean),
    auto_finalise: false,
    notice_references: scheme === 'toms' ? TOMS_NOTICE_REFS : MARGIN_NOTICE_REFS,
  }
}

module.exports = {
  MARGIN_NOTICE_REFS,
  TOMS_NOTICE_REFS,
  STANDARD_VAT_RATE,
  MARGIN_VAT_FRACTION,
  MARGIN_SCHEMES,
  STOCK_BOOK_REQUIRED_FIELDS,
  TOMS_IN_SCOPE_COMPONENTS,
  validateStockBookEntry,
  computeMarginTransaction,
  globalAccounting,
  tomsPrePaymentTreatment,
  computeTomsPackage,
  computePeriod,
}
