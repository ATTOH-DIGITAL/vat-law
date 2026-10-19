#!/usr/bin/env node
/**
 * scripts/bot_verify.mjs — Unified Estate 5-Pillar, Rule 20 & 2026-10-19 Investability Verification Harness
 * Repository: vat-law
 *
 * Enforces:
 *   1. Pillar 1 (docs/): 1_ICP_PROFILES.md .. 5_INVESTOR_DOSSIER.md present & non-empty
 *   2. Pillar 2 (runtime/): runtime directory present
 *   3. Pillar 3 (snap_modules/): snap_modules directory & manifest.json present
 *   4. Pillar 4 (supabase_migrations/): SQL migrations present with ENABLE ROW LEVEL SECURITY
 *   5. Pillar 5 (scripts/bot_verify.mjs): self-verifying entrypoint wired
 *   6. Rule 20 Guard: zero .yml/.yaml files in .github/workflows/ (GitHub Actions decommissioned)
 *   7. 2026-10-19 Investability Pack (Sections A–J) & Cross-Estate Proof in docs/5_INVESTOR_DOSSIER.md
 *   8. Runtime Verification Suite: executes runtime/scripts/verify.mjs if present
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

let passed = 0;
let failed = 0;

function check(label, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  [PASS] ${label}`);
  } else {
    failed += 1;
    console.error(`  [FAIL] ${label}${detail ? ' — ' + detail : ''}`);
  }
}

console.log(`=== Sovereign 5-Pillar, Rule 20 & Investability Verification (${ROOT}) ===`);

// Pillar 1: docs/
const requiredDocs = [
  '1_ICP_PROFILES.md',
  '2_COMPETITOR_LANDSCAPE.md',
  '3_PRODUCT_STRATEGY_MOAT.md',
  '4_USER_STORIES_GHERKIN.md',
  '5_INVESTOR_DOSSIER.md',
];
for (const doc of requiredDocs) {
  const p = join(ROOT, 'docs', doc);
  const ok = existsSync(p) && statSync(p).isFile() && statSync(p).size > 100;
  check(`Pillar 1 (docs/${doc})`, ok, 'missing or empty');
}

// 2026-10-19 Investability Pack (A–J) & Cross-Estate 5-Point Proof check
const dossierPath = join(ROOT, 'docs', '5_INVESTOR_DOSSIER.md');
if (existsSync(dossierPath)) {
  const dossier = readFileSync(dossierPath, 'utf8');
  const requiredHeadings = [
    '## A. Product Identity',
    '## B. Capability Truth',
    '## C. Operating-System Inheritance',
    "## D. Ballon d'Or Top-Five Benchmark",
    '## E. Market Maturity Classification',
    '## F. Capital Evidence',
    '## G. Lead / Lag Score',
    '## H. Gap-to-Money',
    '## I. Investability Score (0–100)',
    '## J. Capital Case',
  ];
  const allHeadingsPresent = requiredHeadings.every((h) => dossier.includes(h));
  check('Investability Pack (Sections A–J in docs/5_INVESTOR_DOSSIER.md)', allHeadingsPresent, 'missing A–J sections');

  const requiredReasoningLines = [
    'This product is stronger because it can also use:',
    'This product should not rebuild:',
    'This product can sell through:',
    'The current public presentation misses:',
    'The highest-value next action is:',
  ];
  const allReasoningPresent = requiredReasoningLines.every((l) => dossier.includes(l));
  check('Cross-Estate 5-Point Reasoning Proof (docs/5_INVESTOR_DOSSIER.md)', allReasoningPresent, 'missing mandatory reasoning lines');
}

// Pillar 2: runtime/
const runtimeDir = join(ROOT, 'runtime');
check('Pillar 2 (runtime/ directory)', existsSync(runtimeDir) && statSync(runtimeDir).isDirectory());

// Pillar 3: snap_modules/
const snapDir = join(ROOT, 'snap_modules');
const snapManifest = join(snapDir, 'manifest.json');
check('Pillar 3 (snap_modules/ directory & manifest.json)', existsSync(snapDir) && existsSync(snapManifest));

// Pillar 4: supabase_migrations/
const migDir = join(ROOT, 'supabase_migrations');
const migFiles = existsSync(migDir) ? readdirSync(migDir).filter((f) => f.endsWith('.sql')) : [];
const hasRls = migFiles.some((f) => /ENABLE\s+ROW\s+LEVEL\s+SECURITY/i.test(readFileSync(join(migDir, f), 'utf8')));
check('Pillar 4 (supabase_migrations/ with RLS)', migFiles.length > 0 && hasRls, `found ${migFiles.length} sql files`);

// Pillar 5: scripts/bot_verify.mjs
check('Pillar 5 (scripts/bot_verify.mjs)', existsSync(join(ROOT, 'scripts', 'bot_verify.mjs')));

// Rule 20: Zero .yml/.yaml files in .github/workflows/
const wfDir = join(ROOT, '.github', 'workflows');
const wfYmls = existsSync(wfDir)
  ? readdirSync(wfDir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
  : [];
check('Rule 20 (zero .yml/.yaml in .github/workflows/)', wfYmls.length === 0, `found: ${wfYmls.join(', ')}`);

// Execute runtime/scripts/verify.mjs if present
const runtimeVerify = join(ROOT, 'runtime', 'scripts', 'verify.mjs');
if (existsSync(runtimeVerify)) {
  console.log('  [INFO] Running runtime/scripts/verify.mjs ...');
  const res = spawnSync(process.execPath, [runtimeVerify], {
    cwd: join(ROOT, 'runtime'),
    stdio: 'inherit',
  });
  check('Runtime verify suite (runtime/scripts/verify.mjs)', res.status === 0, `exit code ${res.status}`);
}

console.log(`\n=== Summary: ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  process.exit(1);
}
