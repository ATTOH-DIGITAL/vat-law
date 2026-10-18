/**
 * oss_engine.test.mjs
 * vat.law — OSS / IOSS / place-of-supply accuracy harness
 *
 * Pins the deterministic cross-border logic: B2B/B2C classification, supply
 * kind, place-of-supply routing, the IOSS £135/€150 low-value thresholds, EORI
 * shape validation, member-state VAT computation MECHANICS, and PVA↔C79
 * reconciliation. A wrong place-of-supply or threshold mis-routes the VAT
 * treatment, so this is the trust anchor.
 *
 * RATE NOTE: the module ships an EU member-state standard-rate table flagged as
 * a SNAPSHOT (re-validate quarterly). Full 27-state re-verification on 18 Jun
 * 2026 confirmed every entry current; two were corrected then — RO 19→21%
 * (1 Aug 2025, Law 141/2025) and EE 22→24% (1 Jul 2025, permanent). This
 * harness pins stable anchors (DE 19%, HU 27%) plus the two corrected rates as
 * regression guards. Re-verify the table quarterly against ec.europa.eu.
 *
 * Run:  node --test tests/oss_engine.test.mjs
 */
import mod from '../snap_modules/module_oss_engine.js';
const {
  IOSS_LOW_VALUE_THRESHOLD_GBP, IOSS_LOW_VALUE_THRESHOLD_EUR, EU_MEMBER_STATE_CODES,
  validateEori, classifyB2BvsB2C, classifySupplyKind, determinePlaceOfSupply,
  detectIoss, computeMemberStateVat, reconcilePva, buildCountryBreakdown, draftOssReturn,
} = mod;

let pass = 0, fail = 0; const fails = [];
function eq(label, got, exp) { (got === exp) ? pass++ : (fail++, fails.push({ label, got, exp })); }
function ok(label, cond) { cond ? pass++ : (fail++, fails.push({ label })); }

eq('IOSS GBP threshold £135', IOSS_LOW_VALUE_THRESHOLD_GBP, 135);
eq('IOSS EUR threshold €150', IOSS_LOW_VALUE_THRESHOLD_EUR, 150);
ok('DE recognised as EU member state', EU_MEMBER_STATE_CODES.includes('DE'));

// ── EORI shape ────────────────────────────────────────────────────────────────
eq('GB + 12 digits valid', validateEori('GB123456789012').valid, true);
eq('GB EORI country', validateEori('GB123456789012').country, 'GB');
eq('XI (NI) EORI valid', validateEori('XI123456789012').valid, true);
eq('branch suffix valid', validateEori('GB123456789012000').valid, true);
eq('lowercase normalised + valid', validateEori('gb123456789012').valid, true);
eq('spaces stripped', validateEori('GB 1234 5678 9012').valid, true);
eq('too short → invalid', validateEori('GB12345').valid, false);
eq('empty → invalid', validateEori('').valid, false);

// ── B2B vs B2C ────────────────────────────────────────────────────────────────
eq('VAT number → B2B', classifyB2BvsB2C({ customer_vat_number: 'DE123456789' }).is_b2b, true);
eq('business flag → B2B', classifyB2BvsB2C({ customer_business_flag: true }).is_b2b, true);
eq('no VAT, no flag → B2C', classifyB2BvsB2C({}).is_b2b, false);

// ── supply kind ───────────────────────────────────────────────────────────────
eq('digital service', classifySupplyKind({ supply_kind: 'digital_service' }).kind, 'digital_service');
eq('goods', classifySupplyKind({ supply_kind: 'goods' }).kind, 'goods');
eq('unrecognised → unknown', classifySupplyKind({ supply_kind: 'foo' }).kind, 'unknown');

// ── place of supply ───────────────────────────────────────────────────────────
eq('GB → uk', determinePlaceOfSupply({ customer_country_code: 'GB' }), 'uk');
eq('B2B EU → eu_b2b', determinePlaceOfSupply({ is_b2b: true, customer_country_code: 'DE' }), 'eu_b2b');
eq('B2C EU digital → digital_b2c', determinePlaceOfSupply({ is_b2b: false, supply_kind: 'digital_service', customer_country_code: 'FR' }), 'digital_b2c');
eq('B2C EU goods → eu_b2c', determinePlaceOfSupply({ is_b2b: false, supply_kind: 'goods', customer_country_code: 'FR' }), 'eu_b2c');
eq('B2C RoW digital → digital_b2c_row', determinePlaceOfSupply({ is_b2b: false, supply_kind: 'digital_service', customer_country_code: 'US' }), 'digital_b2c_row');
eq('B2B RoW → row_b2b', determinePlaceOfSupply({ is_b2b: true, customer_country_code: 'US' }), 'row_b2b');

// ── IOSS low-value detection ──────────────────────────────────────────────────
eq('£100 → IOSS eligible', detectIoss({ consignment_value: 100, currency: 'GBP' }).eligible_for_ioss, true);
eq('£200 → not eligible', detectIoss({ consignment_value: 200, currency: 'GBP' }).eligible_for_ioss, false);
eq('€140 → eligible (€150 threshold)', detectIoss({ consignment_value: 140, currency: 'EUR' }).eligible_for_ioss, true);
eq('£135 boundary → eligible', detectIoss({ consignment_value: 135, currency: 'GBP' }).eligible_for_ioss, true);
eq('zero value → not eligible (manual)', detectIoss({ consignment_value: 0 }).eligible_for_ioss, false);

// ── member-state VAT MECHANICS (stable rates only) ────────────────────────────
const de = computeMemberStateVat({ net_amount: 1000, customer_country_code: 'DE' });
ok('DE lookup ok', de.ok === true);
eq('DE 19% standard rate', de.rate_pct, 19);
eq('DE VAT = net × 19%', de.vat, 190);
eq('DE gross = net + VAT', de.gross, 1190);
eq('HU 27% (highest, stable)', computeMemberStateVat({ net_amount: 100, customer_country_code: 'HU' }).rate_pct, 27);
// regression guards for the 18 Jun 2026 corrections (RO +2pp, EE +2pp)
eq('RO 21% (corrected 1 Aug 2025)', computeMemberStateVat({ net_amount: 100, customer_country_code: 'RO' }).rate_pct, 21);
eq('EE 24% (corrected 1 Jul 2025)', computeMemberStateVat({ net_amount: 100, customer_country_code: 'EE' }).rate_pct, 24);
eq('snapshot date bumped to 2026-06-18',
  mod.draftOssReturn({ customer: { eori_number: 'GB123456789012' }, invoices: [], period: 'x' }).rates_snapshot_date, '2026-06-18');
eq('unknown country → not ok', computeMemberStateVat({ net_amount: 100, customer_country_code: 'XX' }).ok, false);

// ── PVA ↔ C79 reconciliation ──────────────────────────────────────────────────
const recOk = reconcilePva({ pva_claimed_invoices: [{ import_vat: 100 }, { import_vat: 50 }], c79_statement: { total_import_vat: 150 } });
ok('matching claim reconciles', recOk.matches === true);
eq('matching diff is 0', recOk.diff, 0);
const over = reconcilePva({ pva_claimed_invoices: [{ import_vat: 200 }], c79_statement: { total_import_vat: 150 } });
ok('over-claim flagged', over.matches === false);
ok('over-claim narrative', /over-claim/.test(over.reason));
ok('within £0.50 tolerance reconciles',
  reconcilePva({ pva_claimed_invoices: [{ import_vat: 100.30 }], c79_statement: { total_import_vat: 100 } }).matches === true);

// ── country breakdown + draft return ──────────────────────────────────────────
const breakdown = buildCountryBreakdown({ invoices: [{ member_state_code: 'DE', net: 1000 }, { member_state_code: 'XX', net: 500 }] });
ok('EU invoice aggregated', breakdown.DE && breakdown.DE.net === 1000);
ok('non-EU invoice skipped', breakdown.XX === undefined);

const draft = draftOssReturn({ customer: { eori_number: 'GB123456789012' }, invoices: [{ member_state_code: 'DE', net: 1000 }], period: '2026-Q2' });
eq('draft status', draft.status, 'await_india_qa');
ok('draft never auto-submits', draft.auto_submit === false);
ok('draft carries snapshot date', typeof draft.rates_snapshot_date === 'string');
ok('draft EORI validated', draft.eori_validation.valid === true);
let threw = false;
try { draftOssReturn({}); } catch { threw = true; }
ok('draft without customer → throws', threw);

console.log(`\nRESULTS: ${pass} passed, ${fail} failed`);
if (fail) { for (const f of fails) console.log(`  ✗ ${f.label}${f.got!==undefined?` — got ${JSON.stringify(f.got)} exp ${JSON.stringify(f.exp)}`:''}`); }
process.exit(fail ? 1 : 0);
