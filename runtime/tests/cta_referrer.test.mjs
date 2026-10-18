/**
 * cta_referrer.test.mjs
 * vat.law — CTA/CIOT/ATT partner-referral accuracy harness
 *
 * Pins the regulated-advice boundary: detection of advice-trigger phrases
 * (the platform must NOT answer regulated complex-tax questions), subject-area
 * detection, partner routing precedence (customer choice → geography →
 * specialism → round-robin) with the commission firewall, and the referral
 * brief's mandatory disclosures. A missed trigger means the platform answers a
 * regulated question it must route out, so this is the trust anchor. Routing
 * logic is year-agnostic (current as of June 2026).
 *
 * Run:  node --test tests/cta_referrer.test.mjs
 */
import mod from '../snap_modules/module_cta_referrer.js';
const { REGULATED_ADVICE_KEYWORDS, ROUTING_STRATEGIES, DEFAULT_STRATEGY,
  classifyQuery, pickPartner, buildReferralBrief, maybeRefer } = mod;

let pass = 0, fail = 0; const fails = [];
function eq(label, got, exp) { (got === exp) ? pass++ : (fail++, fails.push({ label, got, exp })); }
function ok(label, cond) { cond ? pass++ : (fail++, fails.push({ label })); }

ok('"should i" is a regulated trigger', REGULATED_ADVICE_KEYWORDS.includes('should i'));
eq('4 routing strategies', ROUTING_STRATEGIES.length, 4);
eq('default strategy is geography', DEFAULT_STRATEGY, 'geography');

// ── query classification ──────────────────────────────────────────────────────
const reg = classifyQuery('Can we claim the de minimis under partial exemption?');
ok('advice trigger detected', reg.is_regulated === true);
ok('trigger surfaced', reg.triggers.includes('can we claim'));
eq('subject area = partial_exemption', reg.subject_area, 'partial_exemption');
eq('non-advice query → not regulated', classifyQuery('What is my VAT number?').is_regulated, false);
eq('empty → not regulated', classifyQuery('').is_regulated, false);
eq('non-string → not regulated', classifyQuery(null).is_regulated, false);
eq('DRC subject area detected',
  classifyQuery('Should we apply the reverse charge for a CIS sub-contractor?').subject_area, 'drc');

// ── partner routing precedence ────────────────────────────────────────────────
const partners = [
  { partner_id: 'p1', firm_name: 'Alpha Tax', coverage_region: 'london', specialisms: ['drc'], active: true },
  { partner_id: 'p2', firm_name: 'Beta Tax', coverage_region: 'manchester', specialisms: ['partial_exemption'], active: true },
  { partner_id: 'p3', firm_name: 'Gamma Tax', coverage_region: 'leeds', specialisms: ['toms'], active: false },
];
eq('customer choice wins',
  pickPartner({ partners, strategy: 'customer_choice', customer: { preferred_partner_id: 'p2' } }).partner_id, 'p2');
eq('geography match',
  pickPartner({ partners, strategy: 'geography', customer: { coverage_region: 'Manchester' } }).partner_id, 'p2');
eq('specialism match',
  pickPartner({ partners, strategy: 'specialism', specialism: 'drc' }).partner_id, 'p1');
eq('round-robin fallback uses cursor',
  pickPartner({ partners, strategy: 'round_robin', round_robin_cursor: 1 }).partner_id, 'p2');
ok('inactive partner excluded from rotation',
  pickPartner({ partners, strategy: 'round_robin', round_robin_cursor: 2 }).partner_id !== 'p3');
let threwNoPartners = false;
try { pickPartner({ partners: [{ active: false }] }); } catch { threwNoPartners = true; }
ok('no active partners → throws', threwNoPartners);

// ── referral brief ────────────────────────────────────────────────────────────
const brief = buildReferralBrief({
  customer: { id: 'c1', legal_name: 'Acme Ltd', tier: 'Pro', scheme: 'standard' },
  partner: partners[0],
  query: { text: 'should we elect to register', triggers: ['should we'], subject_area: 'registration', source_channel: 'dashboard_chat' },
});
ok('referral id prefixed VAT-REF-', brief.referral_id.startsWith('VAT-REF-'));
eq('partner threaded', brief.partner.firm_name, 'Alpha Tax');
eq('customer threaded', brief.customer.legal_name, 'Acme Ltd');
ok('commission firewall disclosed', /NOT a routing input/.test(brief.commercial_terms.commission_firewall));
ok('no-commission disclosure present',
  brief.customer_disclosure_required.some(d => /no commission incentive/i.test(d)));

// ── maybeRefer orchestration ──────────────────────────────────────────────────
const refer = maybeRefer({
  query_text: 'Can we claim input tax under partial exemption de minimis?',
  customer: { id: 'c1', legal_name: 'Acme Ltd', coverage_region: 'london', tier: 'Pro', scheme: 'standard' },
  partners,
});
ok('regulated query → refer true', refer.refer === true);
ok('referral brief built', refer.referral_brief && refer.referral_brief.referral_id.startsWith('VAT-REF-'));
ok('refer never auto-sends', refer.auto_send === false);

const noRefer = maybeRefer({ query_text: 'What is my VAT registration number?', customer: { id: 'c1' }, partners });
ok('non-regulated query → no referral', noRefer.refer === false);
let threwRefer = false;
try { maybeRefer({ customer: { id: 'c1' } }); } catch { threwRefer = true; }
ok('maybeRefer without query → throws', threwRefer);

console.log(`\nRESULTS: ${pass} passed, ${fail} failed`);
if (fail) { for (const f of fails) console.log(`  ✗ ${f.label}${f.got!==undefined?` — got ${JSON.stringify(f.got)} exp ${JSON.stringify(f.exp)}`:''}`); }
process.exit(fail ? 1 : 0);
