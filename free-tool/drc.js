/**
 * ATTOH VAT & CIS · module_drc_matrix.js
 *
 * Pure-function module classifying construction-sector supplies under the
 * VAT Domestic Reverse Charge (DRC) regime — VAT Notice 735, in force
 * from 1 March 2021. For each invoice, decide whether the supply should
 * be invoiced under standard VAT (supplier accounts for output tax),
 * under reverse charge (customer accounts for both output AND input tax),
 * or as zero-rated, and return invoice-by-invoice reasoning + confidence.
 *
 * REGULATORY BOUNDARY
 *   ATTOH VAT & CIS is a TECHNOLOGY PLATFORM. The DRC classification rules are
 *   deterministic (Notice 735 §2 + §3 — services in scope, end-user /
 *   intermediary exclusions, CIS overlay) and the platform encodes them.
 *
 *   Where the classifier's confidence is below 0.85, OR where the supply
 *   is "mixed" (some services in DRC scope, some not), OR where the
 *   end-user / intermediary status is contested, the matter routes to
 *   India QA. If the question crosses into "should we restructure how we
 *   invoice this customer?" that is regulated complex tax advice and
 *   routes to a CTA / CIOT / ATT partner via module_cta_referrer.js.
 *
 *   This module:
 *     1. Classifies a sub-contractor's CIS status (registered / gross / net)
 *     2. Determines whether the recipient is an end-user or intermediary
 *     3. Applies the CIS overlay (CIS-out-of-scope ⇒ DRC-out-of-scope)
 *     4. Returns a per-invoice verdict (drc / standard / zero / manual_review)
 *        with a human-readable reasoning string and a confidence score
 *     5. Routes verdicts with confidence < 0.85 to India QA
 *
 *   VAT Notice 735 references (live at May 2026):
 *     · Notice 735 §1.2 — end-user / intermediary definitions
 *     · Notice 735 §2.4 — services in scope of DRC
 *     · Notice 735 §2.5 — services NOT in scope (professional services etc.)
 *     · Notice 735 §3.1 — supplier obligations on the DRC invoice
 *     · Notice 735 §3.4 — CIS overlay
 */

const NOTICE_735_REFS = [
  'VAT Notice 735',
  'Notice 735 §1.2 (end-user / intermediary)',
  'Notice 735 §2.4 (services in scope)',
  'Notice 735 §2.5 (services NOT in scope)',
  'Notice 735 §3.1 (DRC invoice format)',
  'Notice 735 §3.4 (CIS overlay)',
]

// Notice 735 §2.4 — services in scope of CIS reverse charge.
const SERVICES_IN_DRC_SCOPE = [
  'construction_services',
  'site_preparation',
  'civil_engineering',
  'demolition',
  'painting_decorating',
  'installation_heating_lighting_ventilation_water',
  'cleaning_internal_buildings_post_construction',
  'integral_works',
]

// Notice 735 §2.5 — services NOT in scope.
const SERVICES_OUT_OF_DRC_SCOPE = [
  'professional_services',
  'architecture',
  'surveying',
  'consultancy',
  'building_inspection',
  'manufacture_offsite_no_installation',
  'materials_supply_only',
  'signage',
  'carpet_fitting',
  'artistic_works',
  'plant_hire_no_operator',
]

const CIS_REGISTERED_STATUSES = ['registered', 'gross', 'net']

const CONFIDENCE_THRESHOLD = 0.85

function clamp01(n) {
  if (n < 0) return 0
  if (n > 1) return 1
  return n
}

/**
 * Classify the sub-contractor's CIS status from the input flags.
 * If CIS-out-of-scope, the supply CANNOT be DRC.
 */
function classifyCisStatus({ cis_status, cis_registered, supply_type }) {
  if (cis_status && CIS_REGISTERED_STATUSES.includes(cis_status)) {
    return { in_cis_scope: true, cis_status, reason: `Sub-contractor is CIS-${cis_status}.` }
  }
  if (cis_registered === true) {
    return { in_cis_scope: true, cis_status: 'registered', reason: 'Sub-contractor flagged CIS-registered.' }
  }
  if (cis_registered === false) {
    return {
      in_cis_scope: false,
      cis_status: 'none',
      reason: 'Sub-contractor is not CIS-registered — CIS overlay excludes DRC (Notice 735 §3.4).',
    }
  }
  if (SERVICES_OUT_OF_DRC_SCOPE.includes(supply_type)) {
    return {
      in_cis_scope: false,
      cis_status: 'unknown',
      reason: `Supply type ${supply_type} is not within CIS / DRC scope (Notice 735 §2.5).`,
    }
  }
  return { in_cis_scope: null, cis_status: 'unknown', reason: 'CIS status unknown — manual review required.' }
}

/**
 * Determine whether the recipient is an end-user or intermediary.
 * Notice 735 §1.2: end-user is the final consumer of construction services
 * (typically a property owner who will occupy the building). Intermediary
 * is connected to an end-user (same group / common landlord-tenant interest)
 * and is treated as an end-user for DRC purposes.
 *
 * BOTH end-user and intermediary supplies fall OUT of DRC scope — they
 * follow standard VAT rules. Notification by the customer is the trigger:
 * the customer must give written notification of end-user/intermediary
 * status; absent notification, DRC applies.
 */
function classifyEndUserIntermediary({ end_user_flag, intermediary_flag, written_notification_received }) {
  if (written_notification_received !== true) {
    return {
      is_end_user_or_intermediary: false,
      reason: 'No written end-user / intermediary notification received — DRC applies by default (Notice 735 §1.2).',
    }
  }
  if (end_user_flag === true) {
    return {
      is_end_user_or_intermediary: true,
      kind: 'end_user',
      reason: 'Customer has given written end-user notification — DRC does not apply; charge standard VAT.',
    }
  }
  if (intermediary_flag === true) {
    return {
      is_end_user_or_intermediary: true,
      kind: 'intermediary',
      reason: 'Customer has given written intermediary notification — DRC does not apply; charge standard VAT.',
    }
  }
  return {
    is_end_user_or_intermediary: false,
    reason: 'Customer is neither end-user nor intermediary — continue DRC assessment.',
  }
}

/**
 * Classify a single invoice. Pure function — no I/O.
 *
 * @param {Object} input
 * @param {Object} input.invoice                  — vat_invoices row shape
 * @param {Object} input.customer_status          — { vat_registered, cis_registered, end_user_flag, intermediary_flag, written_notification_received }
 * @returns {Object} verdict + reasoning + confidence
 */
function classifyInvoice({ invoice, customer_status }) {
  if (!invoice) throw new Error('classifyInvoice: invoice required')
  const cust = customer_status || {}
  const reasons = []
  let confidence = 1.0

  // 0. Zero-rating overrides everything. A zero-rated supply (e.g. a new-build
  //    dwelling, Notice 708) is 0% VAT regardless of the customer's VAT / CIS
  //    or end-user status, and the reverse charge never applies to it. Checked
  //    FIRST so it is not pre-empted by the standard-VAT short-circuits below
  //    (not-VAT-registered / end-user / out-of-CIS), each of which would
  //    otherwise mislabel a zero-rated invoice as standard 20% VAT.
  if (invoice.zero_rated_new_build === true) {
    return {
      invoice_id: invoice.id,
      verdict: 'zero',
      reasoning:
        'Supply is zero-rated under VAT Notice 708 (new-build dwelling) — zero-rating overrides DRC; charge zero-rate VAT.',
      confidence: 0.95,
      routes_to_india_qa: false,
      cis_status: 'not_applicable',
      end_user_flag: !!cust.end_user_flag,
      intermediary_flag: !!cust.intermediary_flag,
    }
  }

  // 1. Recipient must be VAT-registered for DRC to apply.
  if (cust.vat_registered === false) {
    return {
      invoice_id: invoice.id,
      verdict: 'standard',
      reasoning: 'Customer is not VAT-registered — DRC cannot apply; charge standard VAT.',
      confidence: 0.99,
      routes_to_india_qa: false,
      cis_status: 'not_applicable',
      end_user_flag: !!cust.end_user_flag,
      intermediary_flag: !!cust.intermediary_flag,
    }
  }
  if (cust.vat_registered == null) {
    reasons.push('Customer VAT-registration unknown — assuming registered; flag for QA.')
    confidence -= 0.2
  }

  // 2. End-user / intermediary notification short-circuits to standard VAT.
  const eui = classifyEndUserIntermediary({
    end_user_flag: cust.end_user_flag,
    intermediary_flag: cust.intermediary_flag,
    written_notification_received: cust.written_notification_received,
  })
  if (eui.is_end_user_or_intermediary) {
    return {
      invoice_id: invoice.id,
      verdict: 'standard',
      reasoning: eui.reason,
      confidence: 0.97,
      routes_to_india_qa: false,
      cis_status: 'not_applicable',
      end_user_flag: !!cust.end_user_flag,
      intermediary_flag: !!cust.intermediary_flag,
    }
  }
  reasons.push(eui.reason)

  // 3. CIS overlay — if outside CIS, outside DRC.
  const cis = classifyCisStatus({
    cis_status: cust.cis_status,
    cis_registered: cust.cis_registered,
    supply_type: invoice.supply_type,
  })
  reasons.push(cis.reason)
  if (cis.in_cis_scope === false) {
    return {
      invoice_id: invoice.id,
      verdict: 'standard',
      reasoning: reasons.join(' '),
      confidence: 0.95,
      routes_to_india_qa: false,
      cis_status: cis.cis_status,
      end_user_flag: !!cust.end_user_flag,
      intermediary_flag: !!cust.intermediary_flag,
    }
  }
  if (cis.in_cis_scope === null) {
    confidence -= 0.25
  }

  // 4. Supply-type test.
  const supply_type = invoice.supply_type || 'unknown'
  let supply_verdict = null
  if (SERVICES_IN_DRC_SCOPE.includes(supply_type)) {
    supply_verdict = 'in_scope'
    reasons.push(`Supply type ${supply_type} is in DRC scope (Notice 735 §2.4).`)
  } else if (SERVICES_OUT_OF_DRC_SCOPE.includes(supply_type)) {
    supply_verdict = 'out_of_scope'
    reasons.push(`Supply type ${supply_type} is NOT in DRC scope (Notice 735 §2.5).`)
  } else if (supply_type === 'mixed') {
    supply_verdict = 'mixed'
    reasons.push('Supply is mixed — invoice contains both in-scope and out-of-scope elements; manual review required.')
    confidence -= 0.4
  } else {
    supply_verdict = 'unknown'
    reasons.push(`Supply type ${supply_type} is not classified — manual review required.`)
    confidence -= 0.5
  }

  // 5. Final verdict.
  let verdict
  if (supply_verdict === 'in_scope') {
    verdict = 'drc'
  } else if (supply_verdict === 'out_of_scope') {
    verdict = 'standard'
  } else {
    verdict = 'manual_review'
    confidence = clamp01(confidence - 0.15)
  }

  confidence = clamp01(confidence)
  const routes_to_india_qa = confidence < CONFIDENCE_THRESHOLD || verdict === 'manual_review'

  return {
    invoice_id: invoice.id,
    verdict,
    reasoning: reasons.join(' '),
    confidence: Math.round(confidence * 1000) / 1000,
    routes_to_india_qa,
    cis_status: cis.cis_status,
    end_user_flag: !!cust.end_user_flag,
    intermediary_flag: !!cust.intermediary_flag,
    notice_735_references: NOTICE_735_REFS,
  }
}

/**
 * Classify a batch of invoices. Returns an array of verdicts in input order
 * plus an aggregated summary suitable for the dashboard tile.
 */
function classifyBatch({ invoices, customer_status }) {
  if (!Array.isArray(invoices)) {
    throw new Error('classifyBatch: invoices array required')
  }
  const verdicts = invoices.map((inv) =>
    classifyInvoice({ invoice: inv, customer_status }),
  )
  const counts = { drc: 0, standard: 0, zero: 0, manual_review: 0 }
  let total_qa = 0
  let confidence_sum = 0
  for (const v of verdicts) {
    counts[v.verdict] = (counts[v.verdict] || 0) + 1
    if (v.routes_to_india_qa) total_qa += 1
    confidence_sum += v.confidence
  }
  const avg_confidence = verdicts.length > 0 ? confidence_sum / verdicts.length : 0
  return {
    ok: true,
    verdicts,
    summary: {
      total_invoices: verdicts.length,
      counts,
      routes_to_india_qa_count: total_qa,
      average_confidence: Math.round(avg_confidence * 1000) / 1000,
      below_threshold_count: verdicts.filter((v) => v.confidence < CONFIDENCE_THRESHOLD).length,
    },
    confidence_threshold: CONFIDENCE_THRESHOLD,
    notice_735_references: NOTICE_735_REFS,
    auto_finalise: false,
  }
}

const __cjs = {
  NOTICE_735_REFS,
  SERVICES_IN_DRC_SCOPE,
  SERVICES_OUT_OF_DRC_SCOPE,
  CIS_REGISTERED_STATUSES,
  CONFIDENCE_THRESHOLD,
  classifyCisStatus,
  classifyEndUserIntermediary,
  classifyInvoice,
  classifyBatch,
}

export { classifyInvoice, classifyCisStatus, classifyEndUserIntermediary, CONFIDENCE_THRESHOLD, NOTICE_735_REFS, SERVICES_IN_DRC_SCOPE };
