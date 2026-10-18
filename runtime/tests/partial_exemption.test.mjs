/**
 * partial_exemption.test.mjs
 * vat.law — partial-exemption accuracy harness (VAT Notice 706)
 *
 * Pins the standard-method recovery %, the round-UP rule (§4.6) and the
 * de minimis test (§11: £625/mo avg AND ≤50% of input tax). Getting these
 * wrong means over-reclaim (assessment + penalty) or under-reclaim (lost cash),
 * so this is the computation the Pro tier is sold on. Source of truth: Notice 706.
 *
 * Run:  node --test tests/partial_exemption.test.mjs
 */
import mod from '../snap_modules/module_partial_exemption.js';
const { roundUpPercentage, standardMethodPercentage, deMinimisLimitGbp, deMinimisTest, computeRecoverableResidual } = mod;

let pass = 0, fail = 0; const fails = [];
function eq(label, got, exp) { (JSON.stringify(got) === JSON.stringify(exp)) ? pass++ : (fail++, fails.push({ label, got, exp })); }
function ok(label, cond) { cond ? pass++ : (fail++, fails.push({ label })); }

// ── round UP to next whole % (Notice 706 §4.6) ────────────────────────────────
eq('73.01 rounds up to 74', roundUpPercentage(73.01), 74);
eq('73.00 stays 73 (exact)', roundUpPercentage(73.00), 73);
eq('0 → 0', roundUpPercentage(0), 0);
eq('100 → 100', roundUpPercentage(100), 100);
eq('over 100 capped at 100', roundUpPercentage(150), 100);

// ── standard-method recoverable % = taxable/(taxable+exempt), rounded up ───────
let s = standardMethodPercentage({ taxable_supplies: 80000, exempt_supplies: 20000 });
eq('80/20 → raw 80', s.percentage_raw, 80);
eq('80/20 → recoverable 80', s.percentage_recoverable, 80);
s = standardMethodPercentage({ taxable_supplies: 73010, exempt_supplies: 26990 });
eq('73.01% → raw 73.01', s.percentage_raw, 73.01);
eq('73.01% → recoverable 74 (rounded up)', s.percentage_recoverable, 74);
eq('zero supplies → 0/0', standardMethodPercentage({ taxable_supplies: 0, exempt_supplies: 0 }), { percentage_raw: 0, percentage_recoverable: 0 });

// ── de minimis period limits ──────────────────────────────────────────────────
eq('quarterly limit £1,875', deMinimisLimitGbp({ period_basis: 'quarterly' }), 1875);
eq('monthly limit £625', deMinimisLimitGbp({ period_basis: 'monthly' }), 625);
eq('annual limit £7,500', deMinimisLimitGbp({ period_basis: 'annually' }), 7500);
eq('3 months → 3 × £625 = £1,875', deMinimisLimitGbp({ months_in_period: 3 }), 1875);

// ── de minimis test: PASS iff exempt ≤ limit AND ≤ 50% of total ───────────────
let d = deMinimisTest({ exempt_input_tax: 500, total_input_tax: 5000, period_basis: 'quarterly' });
ok('£500 exempt / £5000 total quarterly → PASS', d.pass === true);
eq('  proportion reported as 10%', d.proportion, 10);

ok('£2000 exempt > £1875 limit → FAIL (leg a)', deMinimisTest({ exempt_input_tax: 2000, total_input_tax: 5000, period_basis: 'quarterly' }).pass === false);
ok('£1000 of £1500 (66.7% > 50%) → FAIL (leg b)', deMinimisTest({ exempt_input_tax: 1000, total_input_tax: 1500, period_basis: 'quarterly' }).pass === false);
ok('both legs fail flagged', /Both legs failed/.test(deMinimisTest({ exempt_input_tax: 2000, total_input_tax: 3000, period_basis: 'quarterly' }).reason));

// ── recoverable residual = residual × % / 100 ─────────────────────────────────
eq('£1000 residual @74% = £740', computeRecoverableResidual({ residual_input_tax: 1000, recoverable_percentage: 74 }), 740);
eq('£1234.56 residual @80% = £987.65', computeRecoverableResidual({ residual_input_tax: 1234.56, recoverable_percentage: 80 }), 987.65);

console.log(`\nRESULTS: ${pass} passed, ${fail} failed`);
if (fail) { for (const f of fails) console.log(`  ✗ ${f.label}${f.got!==undefined?` — got ${JSON.stringify(f.got)} exp ${JSON.stringify(f.exp)}`:''}`); }
process.exit(fail ? 1 : 0);
