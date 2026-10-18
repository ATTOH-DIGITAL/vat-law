/**
 * vat.law · module_cta_referrer.js
 *
 * Routes regulated complex-VAT advisory questions from a customer to a
 * CTA / CIOT / ATT partner adviser. vat.law itself runs the
 * deterministic, technology-platform work (MTD submission, digital-link
 * record-keeping, partial-exemption math, DRC matrix, margin/TOMS
 * computation, OSS country breakdown). It does NOT give regulated
 * complex tax advice — that is the partner adviser's work.
 *
 * REGULATORY BOUNDARY
 *   UK tax advice is not a "reserved activity" the way legal advice or
 *   FCA-regulated financial advice is. However, complex VAT advice
 *   carries:
 *     · Professional indemnity exposure (Chartered Tax Adviser PI insurance)
 *     · HMRC AML-supervised practice accountability (CIOT / ATT supervised)
 *     · Reputational and civil-liability exposure on methodology choices
 *
 *   The architectural decision: vat.law is the technology platform;
 *   the CTA / CIOT / ATT partner carries the regulated accountability.
 *
 *   This module:
 *     1. Detects when a customer query has crossed into regulated complex
 *        tax advice ("should I", "best treatment", "will HMRC accept",
 *        "advise me on", "is this allowable", "can we structure this")
 *     2. Picks a partner from vat_cta_partners by geography → capacity → specialism
 *     3. Builds a structured referral brief
 *     4. Discloses the commission firewall — partner selection is geography
 *        + capacity based; commission is NEVER a routing input
 *
 *   It NEVER answers the underlying question. The platform is a routing
 *   layer; the partner is the regulated layer; the customer chooses the
 *   partner (or accepts our default rotation).
 *
 * REVENUE MECHANIC
 *   vat.law receives a 50/50 split (net of disbursements) with the
 *   partner on the partner's chargeable advisory fees originating from
 *   a referral. Commission is firewalled from the customer-facing
 *   referral decision — the rotation is geography + capacity based;
 *   commission is not a routing input.
 *
 *   This mirrors immigration.law's module_oisc_referrer.js pattern; the
 *   only differences are the partner qualification (CTA / CIOT / ATT
 *   instead of OISC Level 3) and the regulated-advice trigger keywords.
 */

const REGULATED_ADVICE_KEYWORDS = [
  'should i',
  'should we',
  'best treatment',
  'best approach',
  'will hmrc accept',
  'will hmrc allow',
  'advise me on',
  'advise us on',
  'your advice on',
  'recommend',
  'recommendation',
  'is this allowable',
  'is this allowed',
  'can we claim',
  'can i claim',
  'can we structure',
  'can we restructure',
  'should we deregister',
  'should we register',
  'should we elect',
  'optimal scheme',
  'optimal method',
  'cheapest scheme',
  'planning opportunity',
  'tax planning',
  'mitigate',
  'avoid penalty',
  'avoid the penalty',
  'reduce vat liability',
  'restructure the group',
  'group vat structure',
  'partial exemption method change',
  'special method',
  'place of supply ruling',
  'voluntary disclosure',
  'unprompted disclosure',
  'penalty mitigation',
]

const SUBJECT_AREA_KEYWORDS = {
  partial_exemption: ['partial exemption', 'exempt input tax', 'de minimis', 'residual', 'special method', 'standard method'],
  drc: ['reverse charge', 'drc', 'cis', 'sub-contractor', 'construction reverse'],
  oss_ioss: ['oss', 'ioss', 'one stop shop', 'distance sale', 'eu b2c', 'place of supply'],
  toms: ['tour operator', 'toms', 'tour margin', 'package holiday'],
  margin: ['margin scheme', 'second-hand', 'global accounting', 'auctioneers'],
  group_vat: ['vat group', 'group registration', 'group reorganisation'],
  capital_goods: ['cgs', 'capital goods scheme', 'capital good'],
  hmrc_enquiry: ['hmrc enquiry', 'schedule 36', 'officer visit', 'visiting officer', 'hmrc letter'],
  registration: ['registration threshold', 'voluntary registration', 'deregistration', '£90,000', '£90k'],
}

const ROUTING_STRATEGIES = ['round_robin', 'geography', 'specialism', 'customer_choice']

const DEFAULT_STRATEGY = 'geography'

/**
 * Detect whether a free-text customer query has crossed into regulated
 * complex tax advice territory. Used by the dashboard chat and by
 * inbound webhook triage to gate the customer from getting an answer
 * from the platform.
 *
 * @param {string} text
 * @returns {{ is_regulated: boolean, triggers: string[], subject_area: string|null }}
 */
function classifyQuery(text) {
  if (!text || typeof text !== 'string') {
    return { is_regulated: false, triggers: [], subject_area: null }
  }
  const lower = text.toLowerCase()
  const triggers = REGULATED_ADVICE_KEYWORDS.filter((kw) => lower.includes(kw))

  // Identify subject area by keyword count.
  let best_area = null
  let best_score = 0
  for (const [area, kws] of Object.entries(SUBJECT_AREA_KEYWORDS)) {
    const score = kws.reduce((acc, kw) => (lower.includes(kw) ? acc + 1 : acc), 0)
    if (score > best_score) {
      best_score = score
      best_area = area
    }
  }

  return {
    is_regulated: triggers.length > 0,
    triggers,
    subject_area: best_area,
  }
}

/**
 * Pick a partner firm from the seed list using the configured strategy.
 *
 *   Routing precedence:
 *     1. customer_choice (if customer has named a preferred_partner_id)
 *     2. geography (match customer's region against partner.coverage_region)
 *     3. specialism (match the detected subject_area against partner.specialisms)
 *     4. round_robin (fallback)
 *
 *   Commission is NOT a routing input.
 *
 * @param {Object} input
 * @param {Array}  input.partners                — rows from vat_cta_partners
 * @param {Object} [input.customer]              — { coverage_region, preferred_partner_id }
 * @param {string} [input.strategy]              — one of ROUTING_STRATEGIES
 * @param {string} [input.specialism]            — subject_area from classifyQuery
 * @param {number} [input.round_robin_cursor]    — monotonically increasing counter
 * @returns {Object} chosen partner row
 */
function pickPartner(input) {
  const partners = (input.partners || []).filter((p) => p.active !== false)
  if (partners.length === 0) {
    throw new Error('No active CTA / CIOT / ATT partner advisers configured — referral cannot proceed.')
  }

  const strategy = input.strategy || DEFAULT_STRATEGY

  if (strategy === 'customer_choice' && input.customer && input.customer.preferred_partner_id) {
    const chosen = partners.find((p) => p.partner_id === input.customer.preferred_partner_id)
    if (chosen) return chosen
  }

  if (strategy === 'geography' && input.customer && input.customer.coverage_region) {
    const region = input.customer.coverage_region.toLowerCase()
    const regional = partners.find(
      (p) => (p.coverage_region || '').toLowerCase() === region,
    )
    if (regional) return regional
  }

  if (strategy === 'specialism' && input.specialism) {
    const sp = partners.find((p) => (p.specialisms || []).includes(input.specialism))
    if (sp) return sp
  }

  // Round-robin fallback
  const cursor = (input.round_robin_cursor || 0) % partners.length
  return partners[cursor]
}

/**
 * Build the structured referral brief that is sent to the partner.
 *
 * @param {Object} input
 * @param {Object} input.customer
 * @param {Object} input.partner
 * @param {Object} input.query                   — { text, triggers, subject_area, source_channel }
 * @param {Object} [input.return_context]        — optional vat_returns row context
 * @param {Object} [input.enquiry_context]       — optional vat_hmrc_enquiries row context
 * @returns {Object} brief payload
 */
function buildReferralBrief(input) {
  return {
    referral_id: `VAT-REF-${Date.now()}`,
    generated_at: new Date().toISOString(),
    partner: {
      partner_id: input.partner.partner_id,
      firm_name: input.partner.firm_name,
      qualification: input.partner.qualification,
      member_number: input.partner.member_number,
      primary_contact_email: input.partner.primary_contact_email,
      city: input.partner.city,
      coverage_region: input.partner.coverage_region,
    },
    customer: {
      id: input.customer.id,
      legal_name: input.customer.legal_name,
      vrn: input.customer.vrn || null,
      companies_house_number: input.customer.companies_house_number || null,
      tier: input.customer.tier,
      coverage_region: input.customer.coverage_region || null,
      bookkeeping_software: input.customer.bookkeeping_software || null,
      scheme: input.customer.scheme,
      partial_exemption_flag: !!input.customer.partial_exemption_flag,
    },
    return_context: input.return_context
      ? {
          return_id: input.return_context.id,
          period_start: input.return_context.period_start,
          period_end: input.return_context.period_end,
          due_date: input.return_context.due_date,
          status: input.return_context.status,
        }
      : null,
    enquiry_context: input.enquiry_context
      ? {
          enquiry_id: input.enquiry_context.id,
          notice_type: input.enquiry_context.notice_type,
          opened_on: input.enquiry_context.opened_on,
          deadline: input.enquiry_context.deadline,
          subject_area: input.enquiry_context.subject_area,
          assessed_liability: input.enquiry_context.assessed_liability,
        }
      : null,
    query: {
      text: input.query.text,
      detected_triggers: input.query.triggers,
      subject_area: input.query.subject_area,
      source_channel: input.query.source_channel,
    },
    commercial_terms: {
      fee_split: '50/50 of partner-charged advisory fees, net of disbursements',
      commission_firewall:
        'Partner rotation is geography + capacity based. Commission is NOT a routing input.',
      service_level_hours: input.partner.service_level_hours || 24,
    },
    customer_disclosure_required: [
      'vat.law has no commission incentive on the partner selected.',
      'The customer is free to instruct a different CTA / CIOT / ATT-qualified adviser or any other tax adviser at any point.',
      'The partner is independently qualified — their advice is their own.',
      'vat.law remains the technology platform and the audit-trail layer; the partner carries regulated complex-tax-advice accountability.',
    ],
  }
}

/**
 * Top-level: from a query text + customer + partners list, decide whether
 * to refer and (if so) build the full referral payload. NEVER persists.
 */
function maybeRefer(input) {
  if (!input || !input.query_text || !input.customer) {
    throw new Error('maybeRefer: query_text and customer required')
  }
  const classification = classifyQuery(input.query_text)
  if (!classification.is_regulated) {
    return {
      ok: true,
      refer: false,
      classification,
      reason:
        'Query does not contain regulated-advice triggers — answer via deterministic platform output (no partner referral).',
    }
  }
  const partner = pickPartner({
    partners: input.partners,
    customer: input.customer,
    strategy: input.strategy,
    specialism: classification.subject_area,
    round_robin_cursor: input.round_robin_cursor,
  })
  const brief = buildReferralBrief({
    customer: input.customer,
    partner,
    query: {
      text: input.query_text,
      triggers: classification.triggers,
      subject_area: classification.subject_area,
      source_channel: input.source_channel || 'dashboard_chat',
    },
    return_context: input.return_context,
    enquiry_context: input.enquiry_context,
  })
  return {
    ok: true,
    refer: true,
    classification,
    partner,
    referral_brief: brief,
    auto_send: false,
    routes_to: ['cta_partner', 'india_qa_oversight'],
  }
}

module.exports = {
  REGULATED_ADVICE_KEYWORDS,
  SUBJECT_AREA_KEYWORDS,
  ROUTING_STRATEGIES,
  DEFAULT_STRATEGY,
  classifyQuery,
  pickPartner,
  buildReferralBrief,
  maybeRefer,
}
