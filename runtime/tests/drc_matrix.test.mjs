/**
 * drc_matrix.test.mjs
 * vat.law — Domestic Reverse Charge classifier accuracy harness
 *
 * Pins VAT Notice 735 DRC classification: VAT-registration gate, the
 * end-user/intermediary written-notification short-circuit, the CIS overlay
 * (out of CIS ⇒ out of DRC), the supply-in-scope test, the new-build zero-rate
 * override, and the 0.85 India-QA confidence routing. A wrong verdict means an
 * invoice charged under the wrong VAT treatment (under/over-declared output
 * tax), so this is the trust anchor. DRC is a mechanism, not a rate — logic is
 * year-agnostic (current as of June 2026).
 *
 * Run:  node --test tests/drc_matrix.test.mjs
 */
import mod from '../snap_modules/module_drc_matrix.js';
const {
  SERVICES_IN_DRC_SCOPE, SERVICES_OUT_OF_DRC_SCOPE, CIS_REGISTERED_STATUSES,
  CONFIDENCE_THRESHOLD, classifyCisStatus, classifyEndUserIntermediary,
  classifyInvoice, classifyBatch,
} = mod;

let pass = 0, fail = 0; const fails = [];
function eq(label, got, exp) { (got === exp) ? pass++ : (fail++, fails.push({ label, got, exp })); }
function ok(label, cond) { cond ? pass++ : (fail++, fails.push({ label })); }

eq('confidence threshold 0.85', CONFIDENCE_THRESHOLD, 0.85);
ok('construction is in DRC scope', SERVICES_IN_DRC_SCOPE.includes('construction_services'));
ok('professional services out of DRC scope', SERVICES_OUT_OF_DRC_SCOPE.includes('professional_services'));
ok('CIS statuses include gross', CIS_REGISTERED_STATUSES.includes('gross'));

// ── CIS status ────────────────────────────────────────────────────────────────
eq('cis_status gross → in scope', classifyCisStatus({ cis_status: 'gross' }).in_cis_scope, true);
eq('cis_registered true → in scope', classifyCisStatus({ cis_registered: true }).in_cis_scope, true);
eq('cis_registered false → out of scope', classifyCisStatus({ cis_registered: false }).in_cis_scope, false);
ok('not-registered cites §3.4 overlay', /§3\.4/.test(classifyCisStatus({ cis_registered: false }).reason));
eq('out-of-scope supply (architecture) → out', classifyCisStatus({ supply_type: 'architecture' }).in_cis_scope, false);
eq('unknown CIS → null (manual)', classifyCisStatus({}).in_cis_scope, null);

// ── end-user / intermediary ───────────────────────────────────────────────────
eq('no written notification → DRC applies (not end-user)',
  classifyEndUserIntermediary({ written_notification_received: false }).is_end_user_or_intermediary, false);
eq('written end-user notification → out of DRC',
  classifyEndUserIntermediary({ written_notification_received: true, end_user_flag: true }).kind, 'end_user');
eq('written intermediary notification → out of DRC',
  classifyEndUserIntermediary({ written_notification_received: true, intermediary_flag: true }).kind, 'intermediary');

// ── single-invoice verdicts ───────────────────────────────────────────────────
eq('non-VAT-registered customer → standard',
  classifyInvoice({ invoice: { id: 'i', supply_type: 'construction_services' }, customer_status: { vat_registered: false } }).verdict, 'standard');
eq('end-user notified → standard',
  classifyInvoice({ invoice: { id: 'i', supply_type: 'construction_services' }, customer_status: { vat_registered: true, written_notification_received: true, end_user_flag: true } }).verdict, 'standard');

const drc = classifyInvoice({
  invoice: { id: 'i1', supply_type: 'construction_services' },
  customer_status: { vat_registered: true, cis_registered: true, written_notification_received: false },
});
eq('registered + CIS + in-scope → DRC', drc.verdict, 'drc');
eq('clean DRC → full confidence', drc.confidence, 1);
ok('clean DRC → no QA routing', drc.routes_to_india_qa === false);

eq('in-scope CIS but out-of-scope supply → standard',
  classifyInvoice({ invoice: { id: 'i', supply_type: 'architecture' }, customer_status: { vat_registered: true, cis_registered: true, written_notification_received: false } }).verdict, 'standard');
eq('new-build zero-rate overrides DRC',
  classifyInvoice({ invoice: { id: 'i', supply_type: 'construction_services', zero_rated_new_build: true }, customer_status: { vat_registered: true, cis_registered: true, written_notification_received: false } }).verdict, 'zero');

const mixed = classifyInvoice({ invoice: { id: 'i', supply_type: 'mixed' }, customer_status: { vat_registered: true, cis_registered: true, written_notification_received: false } });
eq('mixed supply → manual review', mixed.verdict, 'manual_review');
ok('manual review routes to QA', mixed.routes_to_india_qa === true);

// unknown VAT registration drops confidence below threshold → QA
const unknownVat = classifyInvoice({ invoice: { id: 'i', supply_type: 'construction_services' }, customer_status: { cis_registered: true, written_notification_received: false } });
eq('unknown VAT-reg → confidence 0.8', unknownVat.confidence, 0.8);
ok('confidence < 0.85 → routes to QA', unknownVat.routes_to_india_qa === true);

let threw = false;
try { classifyInvoice({ customer_status: {} }); } catch { threw = true; }
ok('no invoice → throws', threw);

// ── batch ─────────────────────────────────────────────────────────────────────
const batch = classifyBatch({
  invoices: [
    { id: 'a', supply_type: 'construction_services' },
    { id: 'b', supply_type: 'architecture' },
  ],
  customer_status: { vat_registered: true, cis_registered: true, written_notification_received: false },
});
eq('batch total', batch.summary.total_invoices, 2);
eq('batch DRC count', batch.summary.counts.drc, 1);
eq('batch standard count', batch.summary.counts.standard, 1);
ok('batch never auto-finalises', batch.auto_finalise === false);
let threwBatch = false;
try { classifyBatch({ invoices: 'nope' }); } catch { threwBatch = true; }
ok('non-array batch → throws', threwBatch);

// ── supply-vocabulary alignment (canonical Notice 735 keys) ───────────────────
// Regression guard: the public free-tool <select> emits these exact keys. A
// mismatch (short UI key vs canonical engine key) silently fell through to
// manual_review — e.g. "installation — heating" was told "standard 20% VAT" when
// it is squarely in DRC scope. Pin every canonical key to its verdict.
const cleanCust = { vat_registered: true, cis_registered: true, written_notification_received: false };
for (const s of SERVICES_IN_DRC_SCOPE) {
  eq(`in-scope supply ${s} → drc`,
    classifyInvoice({ invoice: { id: s, supply_type: s }, customer_status: cleanCust }).verdict, 'drc');
}
for (const s of SERVICES_OUT_OF_DRC_SCOPE) {
  eq(`out-of-scope supply ${s} → standard`,
    classifyInvoice({ invoice: { id: s, supply_type: s }, customer_status: cleanCust }).verdict, 'standard');
}
eq('installation heating/lighting/vent/water → drc',
  classifyInvoice({ invoice: { id: 'i', supply_type: 'installation_heating_lighting_ventilation_water' }, customer_status: cleanCust }).verdict, 'drc');
eq('materials supply only → standard',
  classifyInvoice({ invoice: { id: 'i', supply_type: 'materials_supply_only' }, customer_status: cleanCust }).verdict, 'standard');

// ── zero-rating overrides the standard-VAT short-circuits (ordering fix) ───────
// A zero-rated new-build supply is 0% regardless of the customer relationship,
// and the reverse charge never applies to it. It must not be pre-empted by the
// not-VAT-registered / end-user / out-of-CIS early returns — each of which
// previously mislabelled a zero-rated invoice as 'standard' (20% VAT).
eq('zero-rate + non-VAT-registered customer → zero',
  classifyInvoice({ invoice: { id: 'i', supply_type: 'construction_services', zero_rated_new_build: true }, customer_status: { vat_registered: false } }).verdict, 'zero');
eq('zero-rate + end-user notified → zero',
  classifyInvoice({ invoice: { id: 'i', supply_type: 'construction_services', zero_rated_new_build: true }, customer_status: { vat_registered: true, written_notification_received: true, end_user_flag: true } }).verdict, 'zero');
eq('zero-rate + out-of-CIS subcontractor → zero',
  classifyInvoice({ invoice: { id: 'i', supply_type: 'construction_services', zero_rated_new_build: true }, customer_status: { vat_registered: true, cis_registered: false, written_notification_received: false } }).verdict, 'zero');
eq('zero-rate keeps cis_status not_applicable',
  classifyInvoice({ invoice: { id: 'i', supply_type: 'construction_services', zero_rated_new_build: true }, customer_status: { vat_registered: false } }).cis_status, 'not_applicable');

console.log(`\nRESULTS: ${pass} passed, ${fail} failed`);
if (fail) { for (const f of fails) console.log(`  ✗ ${f.label}${f.got!==undefined?` — got ${JSON.stringify(f.got)} exp ${JSON.stringify(f.exp)}`:''}`); }
process.exit(fail ? 1 : 0);
