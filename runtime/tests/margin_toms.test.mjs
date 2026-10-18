/**
 * margin_toms.test.mjs
 * vat.law — Margin Scheme / Global Accounting / TOMS accuracy harness
 *
 * Pins the VAT margin maths (Notice 718 / 718-1 / 718-2 / 709-5): VAT on the
 * margin at the 1/6 fraction (20% standard rate), the no-VAT-on-loss rule,
 * Global Accounting loss carry-forward, TOMS in-scope component apportionment,
 * the deposit-defers-margin rule, and stock-book completeness. A wrong margin
 * over/under-declares VAT, so this is the trust anchor. The only rate is the
 * stable 20% standard rate (1/6 fraction) — year-agnostic (current as of June
 * 2026).
 *
 * Run:  node --test tests/margin_toms.test.mjs
 */
import mod from '../snap_modules/module_margin_toms.js';
const {
  STANDARD_VAT_RATE, MARGIN_VAT_FRACTION, MARGIN_SCHEMES, STOCK_BOOK_REQUIRED_FIELDS,
  validateStockBookEntry, computeMarginTransaction, globalAccounting,
  tomsPrePaymentTreatment, computeTomsPackage, computePeriod,
} = mod;

let pass = 0, fail = 0; const fails = [];
function eq(label, got, exp) { (got === exp) ? pass++ : (fail++, fails.push({ label, got, exp })); }
function ok(label, cond) { cond ? pass++ : (fail++, fails.push({ label })); }

eq('standard VAT rate 20%', STANDARD_VAT_RATE, 0.20);
ok('margin VAT fraction is 1/6', Math.abs(MARGIN_VAT_FRACTION - 1 / 6) < 1e-12);
ok('margin schemes include margin', MARGIN_SCHEMES.includes('margin'));
eq('10 required stock-book fields', STOCK_BOOK_REQUIRED_FIELDS.length, 10);

// ── stock-book validation ─────────────────────────────────────────────────────
const completeEntry = Object.fromEntries(STOCK_BOOK_REQUIRED_FIELDS.map(f => [f, 'x']));
ok('complete stock book → pass', validateStockBookEntry(completeEntry).pass);
ok('missing field → fail', validateStockBookEntry({ ...completeEntry, sale_price: '' }).pass === false);
eq('null entry → all fields missing', validateStockBookEntry(null).missing.length, 10);

// ── margin transaction (vat = margin / 6) ─────────────────────────────────────
const profit = computeMarginTransaction({ purchase_price: 100, sale_price: 160, stock_book_entry: completeEntry });
eq('margin = sale − purchase', profit.margin, 60);
eq('VAT on margin = margin/6', profit.vat_on_margin, 10);
ok('profit not a loss', profit.is_loss === false);
const loss = computeMarginTransaction({ purchase_price: 200, sale_price: 150 });
eq('loss → margin floored at 0', loss.margin, 0);
eq('loss → no VAT', loss.vat_on_margin, 0);
ok('loss flagged', loss.is_loss === true);
eq('£600 margin → £100 VAT', computeMarginTransaction({ purchase_price: 0, sale_price: 600 }).vat_on_margin, 100);

// ── Global Accounting (aggregate margin, loss carries forward) ─────────────────
const ga = globalAccounting({ period_purchases: [100, 200], period_sales: [500] });
eq('GA net margin = sales − purchases', ga.net_margin, 200);
eq('GA VAT = margin/6', ga.vat_due, 33.33);
const gaLoss = globalAccounting({ period_purchases: [500], period_sales: [100] });
eq('GA period loss → VAT 0', gaLoss.vat_due, 0);
eq('GA loss carried forward', gaLoss.new_carry_forward, 400);
eq('GA carry-forward reduces margin',
  globalAccounting({ period_purchases: [300], period_sales: [500], carried_forward_loss: 100 }).net_margin, 100);

// ── TOMS pre-payment (deposit defers margin) ──────────────────────────────────
eq('payment before tour supplied → defer',
  tomsPrePaymentTreatment({ payment_received_at: '2026-01-01', tour_supplied_at: '2026-06-01', deposit_amount: 200 }).crystallises_now, false);
eq('no supply date → defer',
  tomsPrePaymentTreatment({ payment_received_at: '2026-01-01', deposit_amount: 200 }).crystallises_now, false);
eq('tour already supplied → crystallise',
  tomsPrePaymentTreatment({ payment_received_at: '2026-01-01', tour_supplied_at: '2025-12-01', deposit_amount: 200 }).crystallises_now, true);

// ── TOMS package (in-scope margin; out-of-scope = standard) ───────────────────
const toms = computeTomsPackage({
  package_id: 'p1',
  components: [
    { kind: 'accommodation', customer_paid: 1000, supplier_cost: 700 },
    { kind: 'agency_commission', customer_paid: 100, supplier_cost: 50 },
  ],
  customer_pre_payments: [{ received_at: '2026-01-01', amount: 200 }],
  tour_supplied_at: '2026-06-01',
});
eq('TOMS in-scope margin only', toms.total_margin, 300);
eq('TOMS VAT on in-scope margin', toms.total_vat_on_margin, 50);
ok('out-of-scope component → standard treatment',
  toms.breakdown.find(b => b.kind === 'agency_commission').treatment === 'standard_vat_outside_toms');
eq('TOMS deferred pre-payment counted', toms.pre_payments.deferred_count, 1);
eq('TOMS deferred amount', toms.pre_payments.deferred_amount, 200);
let threwToms = false;
try { computeTomsPackage({ package_id: 'p', components: [] }); } catch { threwToms = true; }
ok('TOMS without components → throws', threwToms);

// ── computePeriod orchestration ───────────────────────────────────────────────
const period = computePeriod({ scheme: 'margin', transactions: [{ purchase_price: 100, sale_price: 160, stock_book_entry: completeEntry }] });
eq('period method', period.payload.method, 'margin');
eq('period total VAT', period.payload.total_vat_due, 10);
eq('period status', period.status, 'await_india_qa');
ok('period never auto-finalises', period.auto_finalise === false);
ok('scheme switch forces CTA sign-off',
  computePeriod({ scheme: 'margin', transactions: [], scheme_switch: true }).cta_partner_sign_required === true);
let threwScheme = false, threwBad = false;
try { computePeriod({}); } catch { threwScheme = true; }
try { computePeriod({ scheme: 'nonsense' }); } catch { threwBad = true; }
ok('no scheme → throws', threwScheme);
ok('unsupported scheme → throws', threwBad);

console.log(`\nRESULTS: ${pass} passed, ${fail} failed`);
if (fail) { for (const f of fails) console.log(`  ✗ ${f.label}${f.got!==undefined?` — got ${JSON.stringify(f.got)} exp ${JSON.stringify(f.exp)}`:''}`); }
process.exit(fail ? 1 : 0);
