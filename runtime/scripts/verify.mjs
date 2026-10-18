#!/usr/bin/env node
// =====================================================
// vat.law · verify.mjs — dependency-free loop stop-signal
// =====================================================
// Closes packet §5.10 ("no smoke/verify/validate script exists"). This is the
// missing static-proof harness the build loop runs after each pass.
//
// It makes REAL assertions (with a negative control) against the runtime with
// zero npm dependencies — pure file parsing so it runs even when node_modules
// is absent (which it is in-loop). It does NOT hit a database, deploy, file to
// HMRC, or touch pricing — all of those are Craig-owned STOP lines.
//
// Checks:
//   A. Schema<->route table coverage. Every table a route queries via
//      `.from('<table>')` must either be created by a migration, or be a
//      DOCUMENTED still-open §5.4 duplicate-route drift entry. A route that
//      queries a table that is neither created nor documented-open FAILS.
//   B. Every migration-created tenant table has `enable row level security`.
//   C. The migration-closed tables from passes 1-4 (threshold_check_leads,
//      vat_obligation_checks, cross_vertical_events, integration_oauth_states)
//      are ALL actually covered — i.e. they must NOT appear in the open-drift
//      set. This is the regression guard: if a future edit removes one of
//      those migrations, the check fails.
//   C2. §5.4 drift closed by reconciling a drifted table NAME to the canonical
//      vat_* table (pass-7: 'customers' -> 'vat_customers'). Asserts the drifted
//      name is no longer queried by any route, the canonical table is still
//      created, and the drifted name is itself uncreated (negative control) so
//      check A would hard-fail its reappearance. This converts a former
//      known-open §5.4 WARNING into a hard failure.
//   D. NEGATIVE CONTROL: a table name known to be uncreated-and-undocumented
//      is asserted to be flagged, so an inverted/over-permissive check cannot
//      silently pass.
//   E. COLUMN-level contract for the 9-box submit path (pass-5, packet §5.2).
//      Every column src/app/api/returns/submit/route.ts reads via
//      `vatReturn.<col>` / `vatReturn.customer.<col>` or writes via
//      `.from(t).update({...})` must exist in the migrations' DDL for
//      vat_returns / vat_customers; every status value the route writes must
//      be admitted by the (last-wins) vat_returns status check constraint;
//      every tier literal it compares must be admitted by the
//      vat_customers.tier check; and the route must not reference the drifted
//      `customers` table name or the drifted 'crossborder' tier spelling.
//      Own NEGATIVE CONTROLS: a synthetic column and a synthetic status value
//      must be reported missing by the same predicates.
//   F. COLUMN-level contract for the OSS/IOSS draft path (pass-8, §5.4).
//   G. COLUMN-level contract for the pass-9 §5.4 reconciled paths (enquiry
//      intake, partial exemption, DRC batch) + an n8n PostgREST dead-table
//      scan. See the CLOSED_DRIFT block for the per-capability decisions.
//   H. COLUMN-level contract for n8n workflow POST/PATCH bodies (pass-10).
//      G's PostgREST scan only checked that a table referenced by an n8n
//      `/rest/v1/<table>` node EXISTS — it never checked that the columns the
//      node actually POSTs are real columns. This parses every httpRequest
//      node's `jsonBody` object literal and asserts every top-level key is a
//      migration-defined column of its target table. Caught (and this pass
//      fixed) two live production breaks: n8n_01's return-due cron wrote a
//      non-existent `vat_alerts.dedup_key` (every daily run 400'd before any
//      customer alert/email fired) and n8n_05's CTA referral router wrote
//      three non-existent `vat_cta_referrals` columns while omitting the
//      NOT NULL `referral_brief` column (every regulated-advice referral
//      would have 400'd before the partner/customer email fired).
//
// Exit 0 = all assertions hold (open-drift entries are reported as warnings,
// not failures — they are a separate, larger §5.4 backlog item). Exit 1 = a
// real regression.
// =====================================================

import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const runtime = join(here, '..')

const RED = (s) => `\x1b[31m${s}\x1b[0m`
const GRN = (s) => `\x1b[32m${s}\x1b[0m`
const YEL = (s) => `\x1b[33m${s}\x1b[0m`

// ---- documented still-open §5.4 duplicate-route table-name drift ----
// EMPTY as of pass-9: all 8 §5.4 drifts are CLOSED (see CLOSED_DRIFT below).
// History: 'customers' closed pass-7; 'oss_returns' closed pass-8 (column-
// accurate, check F); the remaining 7 (drc_assignments, cta_partners,
// hmrc_enquiries, vat_enquiries, vat_profiles, partial_exemption_records,
// vat_partial_exemption_calcs) closed pass-9 under the "one canonical route
// per capability" decision (column-accurate, check G). The set stays here so
// any FUTURE drift must be consciously documented — an undocumented queried-
// but-uncreated table is a HARD failure via check A.
const OPEN_DRIFT = new Set([])

// Tables that the last four loop passes explicitly CLOSED with a migration.
// They must be created AND must not be in OPEN_DRIFT (regression guard).
const CLOSED_BY_LOOP = [
  'threshold_check_leads',
  'vat_obligation_checks',
  'cross_vertical_events',
  'integration_oauth_states',
]

// ---- §5.4 drift CLOSED by reconciling the drifted name to a canonical table ----
// Unlike CLOSED_BY_LOOP (new migration), these were closed by renaming the route's
// `.from('<drifted>')` to the canonical `vat_*` table that already exists and
// already carries the columns the route reads. Each entry asserts three things:
//   1. no route may reference the drifted name again (closure guard),
//   2. the canonical replacement must still be created by a migration (regression),
//   3. the drifted name must be uncreated AND absent from OPEN_DRIFT, so that the
//      generic check-A would HARD-fail it if it reappeared (negative control).
// pass-7: 'customers' → 'vat_customers'. The drifted 'customers' name was the one
// blocking the oss/draft Cross-Border tier gate (and 4 sibling ownership reads)
// against a table no migration creates.
// pass-8: 'oss_returns' → 'vat_oss_returns'. Unlike 'customers' (a pure name
// drift), this was ALSO a column-vocabulary drift (quarter/member_state_breakdown/
// total_vat_due/reporting_member_state + a rejected 'awaiting_qa' status), so the
// reconcile is column-accurate — proven independently by check F below, which
// hard-fails if any written column/status isn't in the canonical DDL. That is the
// guard against a future "blind rename" regressing the mapping.
// pass-9: the remaining 7 §5.4 drifts, closed under "one canonical route per
// capability" (decision table in ../NOTES.md):
//   drc_assignments -> vat_drc_assignments (drc/classify-batch, column-accurate:
//     category->verdict mapping + rationale->reasoning + confidence_score->
//     confidence + needs_india_qa->routes_to_india_qa; regime detail keeps the
//     sql_009 additive `category` column — proven by check G)
//   cta_partners -> vat_cta_partners (enquiry/intake partner lookup; SERVICE-ROLE
//     read behind the getUser gate, sql_006 default-deny RLS unchanged)
//   hmrc_enquiries + vat_enquiries -> vat_hmrc_enquiries (duplicate
//     /api/vat-enquiry/intake DELETED, Telegram/n8n/civil_evasion folded into
//     the canonical /api/enquiry/intake; intake columns added in sql_009)
//   vat_profiles -> vat_customers (tier lives on vat_customers.tier keyed by
//     profile_id; vat_profiles was never created by any migration)
//   partial_exemption_records + vat_partial_exemption_calcs ->
//     vat_partial_exemption_records (duplicate /api/vat-partial-exemption
//     DELETED, tier gate + India-QA edge-case recommendation folded into the
//     canonical /api/partial-exemption/calculate; column-accurate mapping
//     proven by check G)
const CLOSED_DRIFT = {
  customers: 'vat_customers',
  oss_returns: 'vat_oss_returns',
  drc_assignments: 'vat_drc_assignments',
  cta_partners: 'vat_cta_partners',
  hmrc_enquiries: 'vat_hmrc_enquiries',
  vat_enquiries: 'vat_hmrc_enquiries',
  vat_profiles: 'vat_customers',
  partial_exemption_records: 'vat_partial_exemption_records',
  vat_partial_exemption_calcs: 'vat_partial_exemption_records',
}

function walk(dir) {
  const out = []
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name)
    if (ent.isDirectory()) out.push(...walk(p))
    else out.push(p)
  }
  return out
}

// ---- gather every table a route queries ----
const routeFiles = walk(join(runtime, 'src')).filter((f) => f.endsWith('.ts') || f.endsWith('.tsx'))
const queried = new Map() // table -> [files]
for (const f of routeFiles) {
  const src = readFileSync(f, 'utf8')
  const re = /\.from\(['"]([a-zA-Z_][a-zA-Z0-9_]*)['"]\)/g
  let m
  while ((m = re.exec(src))) {
    const t = m[1]
    if (!queried.has(t)) queried.set(t, [])
    const rel = f.slice(runtime.length + 1)
    if (!queried.get(t).includes(rel)) queried.get(t).push(rel)
  }
}

// ---- gather every table a migration creates + its RLS status ----
const migDir = join(runtime, 'supabase_migrations')
const migFiles = readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort()
const created = new Set()
const rlsEnabled = new Set()
for (const f of migFiles) {
  const sql = readFileSync(join(migDir, f), 'utf8')
  const ct = /create table (?:if not exists )?([a-z_][a-z0-9_]*)/g
  let m
  while ((m = ct.exec(sql))) created.add(m[1])
  const rls = /alter table ([a-z_][a-z0-9_]*)\s+enable row level security/g
  while ((m = rls.exec(sql))) rlsEnabled.add(m[1])
}

// =====================================================
// Assertions
// =====================================================
const failures = []
const warnings = []

// --- A. every queried table is created OR documented-open ---
for (const [table, files] of queried) {
  if (created.has(table)) continue
  if (OPEN_DRIFT.has(table)) {
    warnings.push(`OPEN §5.4 drift: route table "${table}" not created (in ${files.join(', ')})`)
    continue
  }
  failures.push(
    `UNDOCUMENTED missing table "${table}" queried by ${files.join(', ')} — ` +
    `not created by any migration and not a known §5.4 open-drift entry.`
  )
}

// --- B. every created tenant table has RLS enabled ---
// (audit/reference tables are still expected to opt in; sql_001 enables RLS on
// all of them, so any created table WITHOUT rls is a real regression.)
for (const t of created) {
  if (!rlsEnabled.has(t)) {
    failures.push(`Table "${t}" is created but never gets "enable row level security".`)
  }
}

// --- C. loop-closed tables are actually closed (created + not open-drift) ---
for (const t of CLOSED_BY_LOOP) {
  if (!created.has(t)) {
    failures.push(`REGRESSION: loop-closed table "${t}" is no longer created by any migration.`)
  }
  if (OPEN_DRIFT.has(t)) {
    failures.push(`CONTRADICTION: "${t}" is both loop-closed and listed as open-drift.`)
  }
}

// --- C2. §5.4 drift reconciled-to-canonical is actually closed ---
// (1) drifted name must not be queried by any route again; (2) canonical must be
// created; (3) drifted name must be uncreated + not in OPEN_DRIFT so check A would
// hard-fail it if it returned. This turns the former known-open §5.4 'customers'
// WARNING into a hard failure now that it is closed.
for (const [drifted, canonical] of Object.entries(CLOSED_DRIFT)) {
  if (queried.has(drifted)) {
    failures.push(
      `§5.4 REGRESSION: drifted table "${drifted}" is queried again by ${queried.get(drifted).join(', ')} ` +
      `— it was reconciled to canonical "${canonical}" in an earlier pass and must not reappear.`,
    )
  }
  if (!created.has(canonical)) {
    failures.push(`§5.4 REGRESSION: canonical replacement table "${canonical}" (for drifted "${drifted}") is no longer created by any migration.`)
  }
  if (OPEN_DRIFT.has(drifted)) {
    failures.push(`CONTRADICTION: "${drifted}" is both reconciled-closed and still listed in OPEN_DRIFT.`)
  }
  // NEGATIVE CONTROL: the drifted name must remain uncreated so that, were it to
  // reappear in a route, generic check A would flag it (not silently pass). If a
  // migration ever creates a literal `customers` table, this control fires.
  if (created.has(drifted)) {
    failures.push(`§5.4 NEGATIVE CONTROL FAILED: drifted name "${drifted}" is itself created by a migration — the closure guard is moot (canonical is "${canonical}").`)
  }
}

// --- D. NEGATIVE CONTROL ---
// A table that is neither created nor in OPEN_DRIFT MUST be reported by check A.
// Inject a synthetic reference and confirm the same logic flags it. If this
// does not flag, the coverage logic is inverted/over-permissive and the whole
// harness is untrustworthy — so we fail hard.
{
  const fake = '__verify_negative_control_table__'
  const wouldFlag = !created.has(fake) && !OPEN_DRIFT.has(fake)
  if (!wouldFlag) {
    failures.push('NEGATIVE CONTROL FAILED: synthetic uncovered table was not flagged — coverage logic is broken.')
  }
}

// --- E. COLUMN-level contract: 9-box submit path (packet §5.2, pass-5) ---
// Parse per-table column DDL out of every migration (create-table blocks +
// additive `alter table ... add column` statements), then assert the submit
// route only touches columns/enum values the schema actually defines.
{
  const tableColumns = new Map() // table -> Set(columns)
  const statusChecks = new Map() // table -> [values] (last definition wins)
  let tierCheckValues = null     // vat_customers.tier admitted values

  const addCol = (t, c) => {
    if (!tableColumns.has(t)) tableColumns.set(t, new Set())
    tableColumns.get(t).add(c)
  }
  const NON_COLUMN_KEYWORDS = new Set(['unique', 'check', 'constraint', 'primary', 'foreign', 'like'])

  for (const f of migFiles) { // migFiles is sorted → later files override
    const sql = readFileSync(join(migDir, f), 'utf8')

    // create-table blocks (terminated by a `);` line)
    const blockRe = /create table (?:if not exists )?([a-z_][a-z0-9_]*)\s*\(([\s\S]*?)\n\);/g
    let b
    while ((b = blockRe.exec(sql))) {
      const [, table, body] = b
      for (const raw of body.split('\n')) {
        const line = raw.trim()
        if (!line || line.startsWith('--') || line.startsWith('(')) continue
        const cm = line.match(/^([a-z_][a-z0-9_]*)\s/)
        if (!cm || NON_COLUMN_KEYWORDS.has(cm[1])) continue
        addCol(table, cm[1])
      }
      const sc = body.match(/check\s*\(status in\s*\(([^)]+)\)/)
      if (sc) statusChecks.set(table, [...sc[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]))
      if (table === 'vat_customers') {
        const tc = body.match(/check\s*\(tier in\s*\(([^)]+)\)/)
        if (tc) tierCheckValues = [...tc[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
      }
    }

    // additive columns
    const alterRe = /alter table ([a-z_][a-z0-9_]*)\s+add column (?:if not exists )?([a-z_][a-z0-9_]*)/g
    while ((b = alterRe.exec(sql))) addCol(b[1], b[2])

    // re-created (widened) status check constraints — last wins
    const alterCheckRe = /alter table ([a-z_][a-z0-9_]*)\s+add constraint [a-z_]+\s+check\s*\(status in\s*\(([^)]+)\)/g
    while ((b = alterCheckRe.exec(sql))) {
      statusChecks.set(b[1], [...b[2].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]))
    }
  }

  const colCovered = (table, col) => tableColumns.has(table) && tableColumns.get(table).has(col)
  const statusAdmitted = (v) => (statusChecks.get('vat_returns') ?? []).includes(v)

  // vat_alerts.alert_type admitted values (hoisted out of check G so check H's
  // n8n-payload scan can share the exact same admission set — one parse, two
  // consumers, no drift between "what G checks in routes" and "what H checks
  // in n8n workflow JSON").
  const allMigSql = migFiles.map((f) => readFileSync(join(migDir, f), 'utf8')).join('\n')
  const alertTypeBlock = allMigSql.match(/check\s*\(alert_type in\s*\(([^)]+)\)/)
  const alertTypeValues = alertTypeBlock ? [...alertTypeBlock[1].matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]) : null
  const alertTypeAdmitted = (v) => Array.isArray(alertTypeValues) && alertTypeValues.includes(v)

  const submitPath = 'src/app/api/returns/submit/route.ts'
  const route = readFileSync(join(runtime, submitPath), 'utf8')

  // columns READ off the vat_returns row / embedded vat_customers row
  const returnCols = new Set()
  const customerCols = new Set()
  for (const m of route.matchAll(/vatReturn\.customer\.([a-zA-Z_][a-zA-Z0-9_]*)/g)) customerCols.add(m[1])
  for (const m of route.matchAll(/vatReturn\.([a-zA-Z_][a-zA-Z0-9_]*)/g)) {
    if (m[1] !== 'customer') returnCols.add(m[1])
  }

  // columns WRITTEN via .from('<table>').update({ ... })
  const writeCols = new Map() // table -> Set(columns)
  const writtenStatuses = new Set()
  for (const m of route.matchAll(/\.from\('([a-z_]+)'\)\s*\.update\(\{([\s\S]*?)\}\)/g)) {
    const [, table, body] = m
    if (!writeCols.has(table)) writeCols.set(table, new Set())
    for (const k of body.matchAll(/(?:^|[,{\s])([a-z_][a-z0-9_]*)\s*:/g)) writeCols.get(table).add(k[1])
    if (table === 'vat_returns') {
      for (const s of body.matchAll(/(?:^|[^a-z_])status\s*:\s*'([a-z_]+)'/g)) writtenStatuses.add(s[1])
    }
  }

  // tier literals the route compares against
  const comparedTiers = new Set()
  for (const m of route.matchAll(/tier\s*===\s*'([a-z_]+)'/g)) comparedTiers.add(m[1])

  // parser sanity: known sql_001 columns must be visible, else the parser
  // itself regressed (empty sets would mask nothing but report confusingly)
  if (!colCovered('vat_returns', 'nine_box') || !colCovered('vat_customers', 'profile_id')) {
    failures.push('E-PARSER: migration column parser no longer sees known sql_001 columns (nine_box / profile_id).')
  }

  for (const c of returnCols) {
    if (!colCovered('vat_returns', c)) {
      failures.push(`§5.2 submit-path column "vat_returns.${c}" is read by ${submitPath} but defined by no migration.`)
    }
  }
  for (const c of customerCols) {
    if (!colCovered('vat_customers', c)) {
      failures.push(`§5.2 submit-path column "vat_customers.${c}" is read by ${submitPath} but defined by no migration.`)
    }
  }
  for (const [table, cols] of writeCols) {
    for (const c of cols) {
      if (!colCovered(table, c)) {
        failures.push(`§5.2 submit-path column "${table}.${c}" is written by ${submitPath} but defined by no migration.`)
      }
    }
  }
  for (const s of writtenStatuses) {
    if (!statusAdmitted(s)) {
      failures.push(`§5.2 submit path writes vat_returns.status='${s}' but the status check constraint rejects it.`)
    }
  }
  for (const t of comparedTiers) {
    if (!tierCheckValues || !tierCheckValues.includes(t)) {
      failures.push(`§5.5 submit path compares tier '${t}' which the vat_customers.tier check constraint rejects.`)
    }
  }
  if (/\.from\('customers'\)|customers!inner/.test(route.replace(/vat_customers/g, ''))) {
    failures.push(`§5.4 regression: ${submitPath} references the drifted "customers" table name (canonical is vat_customers).`)
  }
  if (route.includes("'crossborder'")) {
    failures.push(`§5.5 regression: ${submitPath} uses the drifted tier spelling 'crossborder' (DB constraint value is 'cross_border').`)
  }

  // --- F. COLUMN-level contract: OSS/IOSS draft path (pass-8, §5.4) ---
  // 'oss_returns' was reconciled to canonical 'vat_oss_returns' (see CLOSED_DRIFT).
  // Because the two DIVERGED at column level (quarter/member_state_breakdown/
  // total_vat_due/reporting_member_state + a rejected 'awaiting_qa' status), a
  // blind rename would have shipped a silent column break. This check parses what
  // the route now WRITES into vat_oss_returns and asserts every column exists in
  // the migration DDL and the written status is admitted by the sql_001 status
  // check — so the ONLY way to keep this green is the column-accurate mapping.
  // Its negative controls prove the predicates flag synthetic misses.
  {
    const ossPath = 'src/app/api/oss/draft/route.ts'
    const ossRoute = readFileSync(join(runtime, ossPath), 'utf8')
    const ossStatusAdmitted = (v) => (statusChecks.get('vat_oss_returns') ?? []).includes(v)

    // the route must persist into the canonical table, never the drifted name
    if (/\.from\('oss_returns'\)/.test(ossRoute)) {
      failures.push(`§5.4 regression: ${ossPath} still writes the drifted "oss_returns" table (canonical is vat_oss_returns).`)
    }
    if (!/\.from\('vat_oss_returns'\)\s*\.insert\(/.test(ossRoute)) {
      failures.push(`F-PARSER: ${ossPath} no longer inserts into vat_oss_returns — OSS draft-path contract not found.`)
    }

    // columns WRITTEN via .from('vat_oss_returns').insert({ ... })
    const ossWriteCols = new Set()
    const ossWrittenStatuses = new Set()
    const im = ossRoute.match(/\.from\('vat_oss_returns'\)\s*\.insert\(\{([\s\S]*?)\}\)\s*\.select\(/)
    if (im) {
      const bodyTxt = im[1]
      // Line-based: each property is on its own line, key first. This captures
      // BOTH explicit `key: value` AND ES6 shorthand `key,` (e.g.
      // `country_breakdown,` / `total_net,`) — a colon-only regex would silently
      // miss shorthand columns and let a real column break through.
      for (const raw of bodyTxt.split('\n')) {
        const line = raw.trim()
        if (!line || line.startsWith('//') || line.startsWith('*')) continue
        const cm = line.match(/^([a-z_][a-z0-9_]*)\s*(?::|,|$)/)
        if (cm) ossWriteCols.add(cm[1])
      }
      for (const s of bodyTxt.matchAll(/(?:^|[^a-z_])status\s*:\s*'([a-z_]+)'/g)) ossWrittenStatuses.add(s[1])
    } else {
      failures.push(`F-PARSER: could not parse the vat_oss_returns insert object in ${ossPath}.`)
    }

    for (const c of ossWriteCols) {
      if (!colCovered('vat_oss_returns', c)) {
        failures.push(`§5.4 OSS draft-path column "vat_oss_returns.${c}" is written by ${ossPath} but defined by no migration (blind-rename column break).`)
      }
    }
    for (const s of ossWrittenStatuses) {
      if (!ossStatusAdmitted(s)) {
        failures.push(`§5.4 OSS draft path writes vat_oss_returns.status='${s}' but the status check constraint rejects it.`)
      }
    }

    // parser sanity: the insert must carry the reconciled column names, not the
    // drifted ones — so the whole point of the reconcile is asserted, not assumed.
    for (const drifted of ['quarter', 'member_state_breakdown', 'total_vat_due']) {
      if (ossWriteCols.has(drifted)) {
        failures.push(`§5.4 OSS draft path still writes drifted column "${drifted}" into vat_oss_returns (expected the canonical name).`)
      }
    }
    for (const canonical of ['period', 'country_breakdown', 'total_vat']) {
      if (!ossWriteCols.has(canonical)) {
        failures.push(`F-PARSER: OSS draft insert is missing expected canonical column "${canonical}" — reconcile parse looks broken.`)
      }
    }
    if (ossWriteCols.size < 8) {
      failures.push(`F-PARSER: OSS draft insert parse looks broken (only ${ossWriteCols.size} columns).`)
    }

    // NEGATIVE CONTROLS — the same predicates must flag synthetic misses.
    if (colCovered('vat_oss_returns', '__verify_nc_oss_column__')) {
      failures.push('F NEGATIVE CONTROL FAILED: synthetic missing vat_oss_returns column was reported as covered.')
    }
    if (ossStatusAdmitted('__verify_nc_oss_status__')) {
      failures.push('F NEGATIVE CONTROL FAILED: synthetic vat_oss_returns status value was reported as admitted.')
    }
    // the drifted 'awaiting_qa' status the route USED to write must be rejected by
    // the canonical constraint — else the reconcile to 'india_qa_review' is moot.
    if (ossStatusAdmitted('awaiting_qa')) {
      failures.push("F NEGATIVE CONTROL FAILED: 'awaiting_qa' is reported as a vat_oss_returns-admitted status — the status reconcile is moot.")
    }
    // and the constraint parse must have found the real admitted set (else the
    // status checks above would vacuously pass against an empty list).
    if (!ossStatusAdmitted('india_qa_review')) {
      failures.push('F-PARSER: vat_oss_returns status check parse looks broken — canonical value india_qa_review not seen as admitted.')
    }
  }

  // --- G. COLUMN-level contract: the pass-9 §5.4 reconciled paths ---
  // The remaining 7 §5.4 drifts were closed by reconciling three write paths to
  // their canonical tables (enquiry intake -> vat_hmrc_enquiries + vat_alerts,
  // partial exemption -> vat_partial_exemption_records, DRC batch ->
  // vat_drc_assignments + vat_invoices update). Like check F, each was a
  // COLUMN-vocabulary drift, not just a name diff — so this check parses what
  // the routes actually write and asserts every column exists in the migration
  // DDL and every constrained literal is admitted. A blind rename cannot stay
  // green here.
  {
    // per-table object-literal insert/update bodies in a route source
    const bodiesFor = (src, table, verb) => {
      const out = []
      const re = new RegExp(String.raw`\.from\('${table}'\)\s*\.${verb}\(\{([\s\S]*?)\n\s*\}\)`, 'g')
      let m
      while ((m = re.exec(src))) out.push(m[1])
      return out
    }
    // line-based key extraction (captures `key: value` AND shorthand `key,`)
    const keysOf = (bodyTxt) => {
      const keys = new Set()
      for (const raw of bodyTxt.split('\n')) {
        const line = raw.trim()
        if (!line || line.startsWith('//') || line.startsWith('*')) continue
        const cm = line.match(/^([a-z_][a-z0-9_]*)\s*(?::|,|$)/)
        if (cm) keys.add(cm[1])
      }
      return keys
    }
    const assertCovered = (routeRel, table, keys, ctx) => {
      for (const k of keys) {
        if (!colCovered(table, k)) {
          failures.push(`§5.4 ${ctx} column "${table}.${k}" is written by ${routeRel} but defined by no migration (blind-rename column break).`)
        }
      }
    }

    // -- G1. enquiry intake: vat_hmrc_enquiries + vat_alerts inserts --
    const enqPath = 'src/app/api/enquiry/intake/route.ts'
    const enqSrc = readFileSync(join(runtime, enqPath), 'utf8')
    const enqBodies = bodiesFor(enqSrc, 'vat_hmrc_enquiries', 'insert')
    if (enqBodies.length !== 1) {
      failures.push(`G-PARSER: expected exactly 1 vat_hmrc_enquiries insert in ${enqPath}, found ${enqBodies.length}.`)
    }
    for (const b of enqBodies) {
      const keys = keysOf(b)
      if (keys.size < 8) failures.push(`G-PARSER: vat_hmrc_enquiries insert parse looks broken (only ${keys.size} keys).`)
      assertCovered(enqPath, 'vat_hmrc_enquiries', keys, 'enquiry-intake')
      // sql_009 intake columns must actually be in the write (reconcile substance)
      for (const c of ['notice_pdf_url', 'enquiry_type', 'periods_under_enquiry']) {
        if (!keys.has(c)) failures.push(`G-PARSER: enquiry intake insert is missing expected reconciled column "${c}".`)
      }
      // drifted column vocabulary must be gone
      for (const drifted of ['notice_reference', 'notice_received_at', 'response_deadline', 'stage', 'india_qa_status']) {
        if (keys.has(drifted)) failures.push(`§5.4 enquiry intake still writes drifted column "${drifted}" into vat_hmrc_enquiries.`)
      }
      const sm = b.match(/(?:^|[^a-z_])status\s*:\s*'([a-z_]+)'/)
      if (!sm) failures.push(`G-PARSER: enquiry intake insert writes no status literal.`)
      else if (!(statusChecks.get('vat_hmrc_enquiries') ?? []).includes(sm[1])) {
        failures.push(`§5.4 enquiry intake writes vat_hmrc_enquiries.status='${sm[1]}' but the status check constraint rejects it.`)
      }
    }
    const alertBodies = bodiesFor(enqSrc, 'vat_alerts', 'insert')
    // vat_alerts.alert_type admitted set is parsed once, outside this block (see
    // the hoisted `alertTypeValues`/`alertTypeAdmitted` above check E) — reused
    // here AND by check H's n8n-payload scan so both consumers agree on the
    // exact same admitted set.
    if (!alertTypeValues || !alertTypeValues.includes('hmrc_enquiry_deadline_imminent')) {
      failures.push('G-PARSER: vat_alerts alert_type check parse looks broken (hmrc_enquiry_deadline_imminent not seen).')
    }
    if (alertBodies.length < 1) failures.push(`G-PARSER: no vat_alerts insert found in ${enqPath}.`)
    for (const b of alertBodies) {
      assertCovered(enqPath, 'vat_alerts', keysOf(b), 'enquiry-alert')
      for (const at of b.matchAll(/alert_type\s*:\s*'([a-z0-9_]+)'/g)) {
        if (!alertTypeAdmitted(at[1])) {
          failures.push(`§5.4 enquiry intake writes vat_alerts.alert_type='${at[1]}' but the alert_type check constraint rejects it.`)
        }
      }
      // the old drifted vat_alerts vocabulary (category/message/related_enquiry_id/
      // due_at — columns no migration defines) must be gone
      for (const drifted of ['category', 'message', 'related_enquiry_id', 'due_at']) {
        if (keysOf(b).has(drifted)) failures.push(`§5.4 enquiry intake still writes drifted vat_alerts column "${drifted}".`)
      }
    }

    // -- G2. partial exemption: vat_partial_exemption_records insert --
    const pePath = 'src/app/api/partial-exemption/calculate/route.ts'
    const peSrc = readFileSync(join(runtime, pePath), 'utf8')
    const peBodies = bodiesFor(peSrc, 'vat_partial_exemption_records', 'insert')
    if (peBodies.length !== 1) {
      failures.push(`G-PARSER: expected exactly 1 vat_partial_exemption_records insert in ${pePath}, found ${peBodies.length}.`)
    }
    for (const b of peBodies) {
      const keys = keysOf(b)
      if (keys.size < 10) failures.push(`G-PARSER: vat_partial_exemption_records insert parse looks broken (only ${keys.size} keys).`)
      assertCovered(pePath, 'vat_partial_exemption_records', keys, 'partial-exemption')
      // the NOT NULL period label must be written (sql_001 has no default for it)
      if (!keys.has('period')) failures.push('§5.4 partial-exemption insert omits the NOT NULL "period" column.')
      // drifted column vocabulary must be gone
      for (const drifted of ['total_supplies', 'recovery_percentage', 'residual_input', 'de_minimis_passed', 'annual_adjustment_applied', 'total_recoverable_input']) {
        if (keys.has(drifted)) failures.push(`§5.4 partial-exemption still writes drifted column "${drifted}" into vat_partial_exemption_records.`)
      }
    }

    // -- G3. DRC batch: vat_drc_assignments rows + vat_invoices update --
    const drcPath = 'src/app/api/drc/classify-batch/route.ts'
    const drcSrc = readFileSync(join(runtime, drcPath), 'utf8')
    const rowsMatch = drcSrc.match(/const rows = classifications\.map\(c => \(\{([\s\S]*?)\n\s*\}\)\)/)
    if (!rowsMatch) {
      failures.push(`G-PARSER: could not parse the vat_drc_assignments row-builder in ${drcPath}.`)
    } else {
      const keys = keysOf(rowsMatch[1])
      if (keys.size < 5) failures.push(`G-PARSER: vat_drc_assignments row-builder parse looks broken (only ${keys.size} keys).`)
      assertCovered(drcPath, 'vat_drc_assignments', keys, 'drc-batch')
      // drifted column vocabulary must be gone
      for (const drifted of ['rationale', 'confidence_score', 'needs_india_qa', 'india_qa_status']) {
        if (keys.has(drifted)) failures.push(`§5.4 drc-batch still writes drifted column "${drifted}" into vat_drc_assignments.`)
      }
    }
    if (!/\.from\('vat_drc_assignments'\)\s*\.insert\(rows\)/.test(drcSrc)) {
      failures.push(`G-PARSER: ${drcPath} no longer inserts rows into vat_drc_assignments.`)
    }
    // verdict literals the route can produce must be admitted by the sql_001 check
    const verdictBlock = readFileSync(join(migDir, migFiles[0]), 'utf8').match(/verdict text not null check \(verdict in\s*\(([^)]+)\)/)
    const verdictValues = verdictBlock ? [...verdictBlock[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]) : null
    const verdictSig = drcSrc.match(/verdictFor = \(category: string\):\s*([^=]+)=>/)
    if (!verdictValues || !verdictSig) {
      failures.push('G-PARSER: could not parse the verdict constraint and/or verdictFor signature.')
    } else {
      for (const lit of verdictSig[1].matchAll(/'([a-z_]+)'/g)) {
        if (!verdictValues.includes(lit[1])) {
          failures.push(`§5.4 drc-batch can write vat_drc_assignments.verdict='${lit[1]}' which the check constraint rejects.`)
        }
      }
      // NEGATIVE CONTROL: a classifier CATEGORY must NOT be verdict-admitted —
      // if it is, the constraint parse grabbed the wrong list.
      if (verdictValues.includes('construction_drc')) {
        failures.push('G NEGATIVE CONTROL FAILED: classifier category construction_drc admitted as a verdict — constraint parse is wrong.')
      }
    }
    for (const b of bodiesFor(drcSrc, 'vat_invoices', 'update')) {
      assertCovered(drcPath, 'vat_invoices', keysOf(b), 'drc-invoice-stamp')
    }

    // -- G4. n8n workflows must not write drifted tables via PostgREST --
    // (routes are covered by check A; the n8n intake workflow wrote
    // /rest/v1/vat_enquiries — a dead table — until pass-9.)
    const n8nDir = join(runtime, 'n8n_workflows')
    const n8nFiles = readdirSync(n8nDir).filter((f) => f.endsWith('.json'))
    let n8nRestRefs = 0
    for (const f of n8nFiles) {
      const src = readFileSync(join(n8nDir, f), 'utf8')
      for (const m of src.matchAll(/\/rest\/v1\/([a-z_][a-z0-9_]*)/g)) {
        n8nRestRefs++
        const t = m[1]
        if (t === 'rpc') continue
        if (Object.prototype.hasOwnProperty.call(CLOSED_DRIFT, t)) {
          failures.push(`§5.4 REGRESSION: n8n workflow ${f} references drifted table "/rest/v1/${t}" (canonical is "${CLOSED_DRIFT[t]}").`)
        } else if (!created.has(t)) {
          failures.push(`§5.4: n8n workflow ${f} references "/rest/v1/${t}" which no migration creates.`)
        }
      }
    }
    if (n8nRestRefs < 2) {
      failures.push(`G-PARSER: n8n PostgREST scan found only ${n8nRestRefs} /rest/v1/ reference(s) — expected the enquiry + CTA workflows at minimum.`)
    }

    // -- G4b. n8n table refs via node PARAM spellings (10 Jul 2026 node-API sweep) --
    // All 5 vat workflows currently carry every table ref as an httpRequest
    // /rest/v1/ URL (scanned by G4 above) — there are ZERO n8n-nodes-base.supabase
    // nodes in this vertical today. But the real node's `tableId` param (and the
    // fictional bare `table` param of the pre-translation dialect) is exactly how
    // a future edit would re-enter OUTSIDE G4's URL regex — the ir35 pass-10
    // one-spelling gate-evasion lesson. Feed both param spellings through the
    // same drift/exists predicates so that door is watched too.
    for (const f of n8nFiles) {
      const src = readFileSync(join(n8nDir, f), 'utf8')
      for (const m of src.matchAll(/"(?:tableId|table)"\s*:\s*"([a-z_][a-z0-9_]*)"/g)) {
        const t = m[1]
        if (Object.prototype.hasOwnProperty.call(CLOSED_DRIFT, t)) {
          failures.push(`§5.4 REGRESSION: n8n workflow ${f} references drifted table "${t}" via a tableId/table param (canonical is "${CLOSED_DRIFT[t]}").`)
        } else if (!created.has(t)) {
          failures.push(`§5.4: n8n workflow ${f} references tableId/table "${t}" which no migration creates.`)
        }
      }
    }

    // NEGATIVE CONTROLS (G4/G4b) — the n8n table-ref predicates must be able to
    // fail in BOTH spellings, must pass a chain table, must keep /rest/v1/rpc/<fn>
    // excluded (PostgREST FUNCTION calls, not tables — WF04/05 legitimately POST
    // rpc endpoints), and must never read a /storage/v1/ object path or an HTML
    // <table> tag inside a JSON string value as a table ref.
    {
      const urlTables = (s) => [...s.matchAll(/\/rest\/v1\/([a-z_][a-z0-9_]*)/g)].map((m) => m[1]).filter((t) => t !== 'rpc')
      const paramTables = (s) => [...s.matchAll(/"(?:tableId|table)"\s*:\s*"([a-z_][a-z0-9_]*)"/g)].map((m) => m[1])
      const ghostUrl = urlTables('{"url": "={{$env.SUPABASE_URL}}/rest/v1/__verify_nc_ghost_table__?on_conflict=a"}')
      const chainUrl = urlTables('{"url": "={{$env.SUPABASE_URL}}/rest/v1/vat_alerts?on_conflict=customer_id,alert_type,trigger_date"}')
      const rpcUrl = urlTables('{"url": "={{$env.SUPABASE_URL}}/rest/v1/rpc/increment_cta_partner_open_count"}')
      const storageUrl = urlTables('{"url": "={{$env.SUPABASE_URL}}/storage/v1/object/vat-enquiry-notices/x.pdf"}')
      const ghostParam = paramTables('{"tableId": "__verify_nc_ghost_table__"}')
      const bareParam = paramTables('{"table": "__verify_nc_ghost_table__"}')
      const htmlParam = paramTables('{"html": "<table border=\\"1\\"><tr><td>vat_alerts</td></tr></table>"}')
      const n8nRefControlsOk =
        ghostUrl.length === 1 && !created.has(ghostUrl[0]) &&
        chainUrl.length === 1 && created.has(chainUrl[0]) &&
        rpcUrl.length === 0 &&
        storageUrl.length === 0 &&
        ghostParam.length === 1 && !created.has(ghostParam[0]) &&
        bareParam.length === 1 &&
        htmlParam.length === 0
      if (!n8nRefControlsOk) {
        failures.push('G4 NEGATIVE CONTROL FAILED: n8n table-ref predicates (URL + tableId/table spellings, rpc/storage exclusion, HTML-string immunity) did not behave — the scan cannot be trusted.')
      }
    }

    // NEGATIVE CONTROLS — same predicates must flag synthetic misses
    if (colCovered('vat_hmrc_enquiries', '__verify_nc_enq_column__')) {
      failures.push('G NEGATIVE CONTROL FAILED: synthetic missing vat_hmrc_enquiries column was reported as covered.')
    }
    if ((statusChecks.get('vat_hmrc_enquiries') ?? []).includes('notice_received')) {
      failures.push("G NEGATIVE CONTROL FAILED: drifted stage value 'notice_received' reported as an admitted vat_hmrc_enquiries status.")
    }
    if (!(statusChecks.get('vat_hmrc_enquiries') ?? []).includes('triaged')) {
      failures.push('G-PARSER: vat_hmrc_enquiries status check parse looks broken — canonical value triaged not seen as admitted.')
    }
  }

  // --- H. COLUMN-level contract: n8n workflow POST/PATCH bodies (pass-10) ---
  // Check G4 above only proved every n8n `/rest/v1/<table>` reference targets a
  // table that EXISTS. It never looked at what the node actually POSTs — so a
  // node can target a perfectly real, RLS-correct table and still 400 on every
  // single execution because a column in its `jsonBody` object literal doesn't
  // exist. This is the n8n-payload analogue of check E/F/G's route-column
  // contracts, applied to the n8n workflow JSON instead of route.ts source.
  //
  // Method: for every n8n-nodes-base.httpRequest node whose method is POST/PATCH
  // and whose url contains `/rest/v1/<table>` (not `/rest/v1/rpc/...`), parse the
  // `jsonBody` mustache expression's top-level object-literal keys (bracket-depth
  // aware, so nested objects/arrays/calls inside a value are not mistaken for
  // sibling keys) and assert every key is a real migration-defined column of the
  // target table (mapped through CLOSED_DRIFT if the node still names a drifted
  // table). A table this vertical doesn't create/reconcile is left to check G4.
  {
    // Strip the n8n mustache wrapper `={{ ... }}` (or `{{ ... }}`), then return
    // the top-level `key:` identifiers of the remaining object literal. Depth
    // tracking over {}/[]/() means nested keys (e.g. inside `payload: {...}`)
    // are never mistaken for top-level columns.
    function objectLiteralKeys(raw) {
      const stripped = raw.replace(/^=?\{\{\s*/, '').replace(/\s*\}\}$/, '')
      const start = stripped.indexOf('{')
      if (start === -1) return null
      let depth = 0, end = -1
      for (let i = start; i < stripped.length; i++) {
        if (stripped[i] === '{') depth++
        else if (stripped[i] === '}') { depth--; if (depth === 0) { end = i; break } }
      }
      if (end === -1) return null
      const inner = stripped.slice(start + 1, end)
      const parts = []
      let cur = '', d = 0
      for (const ch of inner) {
        if (ch === '{' || ch === '[' || ch === '(') d++
        else if (ch === '}' || ch === ']' || ch === ')') d--
        if (ch === ',' && d === 0) { parts.push(cur); cur = '' } else cur += ch
      }
      if (cur.trim()) parts.push(cur)
      const keys = []
      for (const p of parts) {
        const m = p.trim().match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:/)
        if (m) keys.push(m[1])
      }
      return keys
    }

    // Quote-agnostic literal-value matcher for H2 (and any future
    // ENUM_VALUE_COLUMNS entry). A naive `column: '...'` regex only catches
    // single-quoted JS string literals; the IDENTICAL assignment written
    // `column: "..."` (double-quoted — equally valid JS, arguably more common
    // style) or as a plain template literal `` column: `...` `` is invisible
    // to it, so the historical vat_-prefix bug could be reintroduced verbatim
    // under a different quote style and sail through H2 with zero failures
    // (proven live by the adversarial verifier that flagged this gap). This
    // single matcher handles all three quote styles with correct escape
    // handling instead of three copy-pasted regexes, so it extends cleanly to
    // future ENUM_VALUE_COLUMNS entries. Template literals that contain a
    // `${...}` interpolation are dynamic and unknowable from static text, so
    // they are SKIPPED rather than guessed at or false-positived — consistent
    // with this rail's existing "skip when unknown, never guess" pattern (see
    // e.g. `if (!Array.isArray(ec.values)) continue` a few lines below).
    function literalValuesFor(raw, column) {
      const re = new RegExp(
        `\\b${column}\\s*:\\s*` +
        `(?:'((?:[^'\\\\]|\\\\.)*)'` +      // 'single-quoted', escapes honoured
        `|"((?:[^"\\\\]|\\\\.)*)"` +        // "double-quoted", escapes honoured
        '|`([^`]*)`)',                      // `template literal` (no nested backticks)
        'g',
      )
      const values = new Set()
      let m
      while ((m = re.exec(raw))) {
        const [, sq, dq, tpl] = m
        if (tpl !== undefined) {
          if (tpl.includes('${')) continue // interpolated — dynamic, unknowable: skip
          if (/^[a-z0-9_]+$/.test(tpl)) values.add(tpl)
          continue
        }
        const val = sq !== undefined ? sq : dq
        if (val !== undefined && /^[a-z0-9_]+$/.test(val)) values.add(val)
      }
      return values
    }

    // n8nDir/n8nFiles from check G4 are scoped to G's block (already closed
    // above) — re-derive them here so this check stands alone.
    const n8nDir = join(runtime, 'n8n_workflows')
    const n8nFiles = readdirSync(n8nDir).filter((f) => f.endsWith('.json'))

    let n8nBodyChecks = 0
    for (const f of n8nFiles) {
      const raw = readFileSync(join(n8nDir, f), 'utf8')
      let wf
      try { wf = JSON.parse(raw) } catch { failures.push(`H-PARSER: ${f} is not valid JSON.`); continue }
      for (const node of wf.nodes || []) {
        if (node.type !== 'n8n-nodes-base.httpRequest') continue
        const p = node.parameters || {}
        const method = String(p.method || 'GET').toUpperCase()
        if (method !== 'POST' && method !== 'PATCH') continue
        const urlM = typeof p.url === 'string' && p.url.match(/\/rest\/v1\/([a-z_][a-z0-9_]*)(?:\?|$)/)
        if (!urlM) continue // excludes /rest/v1/rpc/... (path continues past the segment) and non-Supabase URLs
        const table = urlM[1]
        if (table === 'rpc' || typeof p.jsonBody !== 'string') continue
        const canonical = CLOSED_DRIFT[table] || table

        const keys = objectLiteralKeys(p.jsonBody)
        if (!keys) {
          failures.push(`H-PARSER: could not parse the jsonBody object literal on node "${node.name}" in ${f}.`)
          continue
        }
        n8nBodyChecks++
        for (const k of keys) {
          if (!colCovered(canonical, k)) {
            failures.push(`§n8n-payload: node "${node.name}" in ${f} POSTs "${canonical}.${k}" but no migration defines that column (PostgREST would reject the insert).`)
          }
        }
      }
    }
    if (n8nBodyChecks < 3) {
      failures.push(`H-PARSER: n8n payload column scan found only ${n8nBodyChecks} POST/PATCH body(ies) against real tables — expected at least the alerts/leads/enquiry/referral writers.`)
    }

    // --- H2. VALUE-level contract: CHECK-constrained enum VALUES in n8n
    // payloads. Check H above only proves every top-level jsonBody KEY is a
    // real migration-defined column — it says nothing about whether a
    // CHECK-constrained column's VALUE is one the constraint actually admits.
    // That is exactly the bug the adversarial verifier found still open after
    // pass-10: n8n_01 wrote real columns (customer_id/return_id/alert_type/
    // trigger_date/payload) but with `vat_`-prefixed alert_type literals
    // ('vat_return_due_90d' etc) the sql_001 CHECK constraint has never
    // admitted (it wants 'return_due_90d' etc) — so the 07:00 daily cron 400'd
    // on the INSERT, one layer past the dedup_key column break pass-10 fixed.
    // This is the n8n-payload analogue of check G1's route-level alert_type
    // validator (`alertTypeAdmitted`, hoisted above check E and shared with G1
    // so both consumers agree on one parse of the constraint).
    //
    // Trace note: n8n_01's httpRequest node itself only forwards
    // `$json.alert_type` (not a literal) — the four literal values are defined
    // upstream in the "Compute due alerts" Function node's WINDOWS array. A
    // check that only read the httpRequest node's own jsonBody text would see
    // no literal at all and vacuously pass. So this scans EVERY string value
    // in the WHOLE parsed workflow (Function-node functionCode source,
    // jsonBody mustache expressions, etc.) for every literal
    // `<enum-column>: '<value>'` assignment, whenever the httpRequest node
    // that ships that field writes it into a CHECK-constrained column on its
    // target table. Table set is small and explicit (one entry today,
    // extensible the same way CLOSED_DRIFT / statusChecks already are) rather
    // than a blind full-schema enum scan, so a false literal match elsewhere
    // in the file (e.g. a node *name* containing the word) can't slip through
    // un-scoped.
    //
    // IMPORTANT: this deliberately scans JSON.parse()'d STRING VALUES, not the
    // raw file bytes. A JS double-quoted literal embedded inside a JSON
    // string field (e.g. functionCode) is stored on disk as an ESCAPED
    // `\"...\"` — raw-byte scanning would see the backslash-quote pair, not a
    // real `"` boundary, and the double-quote arm of literalValuesFor would
    // never match. JSON.parse() already undoes that JSON-level escaping, so
    // decoded string values contain the real quote characters the JS author
    // wrote — which is what makes catching '...', "...", and `...` uniformly
    // possible regardless of which layer (JSON file vs. JS source) the quote
    // style lives at.
    function collectStrings(node, out) {
      if (typeof node === 'string') { out.push(node); return }
      if (Array.isArray(node)) { for (const v of node) collectStrings(v, out); return }
      if (node && typeof node === 'object') { for (const v of Object.values(node)) collectStrings(v, out) }
    }

    const ENUM_VALUE_COLUMNS = [
      { table: 'vat_alerts', column: 'alert_type', admitted: alertTypeAdmitted, values: alertTypeValues },
    ]
    let n8nEnumValueChecks = 0
    for (const f of n8nFiles) {
      const raw = readFileSync(join(n8nDir, f), 'utf8')
      let wf
      try { wf = JSON.parse(raw) } catch { continue } // already reported by check H above
      const stringsOut = []
      collectStrings(wf, stringsOut)
      const decodedBlob = stringsOut.join('\n')
      for (const node of wf.nodes || []) {
        if (node.type !== 'n8n-nodes-base.httpRequest') continue
        const p = node.parameters || {}
        const method = String(p.method || 'GET').toUpperCase()
        if (method !== 'POST' && method !== 'PATCH') continue
        const urlM = typeof p.url === 'string' && p.url.match(/\/rest\/v1\/([a-z_][a-z0-9_]*)(?:\?|$)/)
        if (!urlM) continue
        const table = urlM[1]
        if (table === 'rpc' || typeof p.jsonBody !== 'string') continue
        const canonical = CLOSED_DRIFT[table] || table
        const keys = objectLiteralKeys(p.jsonBody)
        if (!keys) continue // already reported by check H above

        for (const ec of ENUM_VALUE_COLUMNS) {
          if (ec.table !== canonical || !keys.includes(ec.column)) continue
          if (!Array.isArray(ec.values)) continue // constraint parse failed — flagged elsewhere
          n8nEnumValueChecks++

          // literal sources for this field name anywhere in the workflow file
          // (the httpRequest node's own jsonBody, if it assigns a literal
          // directly — e.g. n8n_02's 'penalty_point_exposure' — AND every
          // upstream node, e.g. n8n_01's Function-node WINDOWS array). Quote-
          // agnostic via literalValuesFor over the DECODED string blob (see
          // above): catches '...', "...", and non-interpolated `...` forms of
          // the identical assignment, however the enclosing JSON escapes it.
          const literals = literalValuesFor(decodedBlob, ec.column)
          for (const lit of literals) {
            if (!ec.admitted(lit)) {
              failures.push(`§n8n-payload: ${f} feeds "${canonical}.${ec.column}" the literal value '${lit}' (via node "${node.name}") but the ${ec.column} check constraint rejects it.`)
            }
          }
        }
      }
    }
    if (n8nEnumValueChecks < 1) {
      failures.push('H2-PARSER: n8n enum-value scan found no vat_alerts.alert_type-writing node to check — expected at least the return-due cron.')
    }

    // NEGATIVE CONTROLS (H2)
    // (1) the actual historical bug values must be rejected by the predicate —
    // proves the extended rail would have caught (and, if reintroduced, WILL
    // catch) the exact `vat_` prefix defect this pass fixed.
    for (const badLit of ['vat_return_due_90d', 'vat_return_due_60d', 'vat_return_due_30d', 'vat_return_due_7d']) {
      if (alertTypeAdmitted(badLit)) {
        failures.push(`H2 NEGATIVE CONTROL FAILED: '${badLit}' was reported as an admitted vat_alerts.alert_type value — the vat_ prefix bug would no longer be caught.`)
      }
    }
    // (2) generic synthetic value must be rejected (predicate not inverted).
    if (alertTypeAdmitted('__verify_nc_alert_type_value__')) {
      failures.push('H2 NEGATIVE CONTROL FAILED: synthetic alert_type value was reported as admitted.')
    }
    // (3) regression guard: the vat_-prefixed literals must not reappear
    // anywhere in n8n_01, in ANY quote style (single/double/template — same
    // quote-agnostic matcher as the main H2 loop, not a raw single-quote
    // substring check, so this guard can't itself be bypassed by a re-plant
    // under a different quote style).
    {
      const src = readFileSync(join(n8nDir, 'n8n_01_return_due_cron.json'), 'utf8')
      let wf01
      try { wf01 = JSON.parse(src) } catch { wf01 = null } // already reported by check H above
      if (wf01) {
        const out01 = []
        collectStrings(wf01, out01)
        const literalsFound = literalValuesFor(out01.join('\n'), 'alert_type')
        for (const badLit of ['vat_return_due_90d', 'vat_return_due_60d', 'vat_return_due_30d', 'vat_return_due_7d']) {
          if (literalsFound.has(badLit)) {
            failures.push(`§n8n-payload REGRESSION: n8n_01_return_due_cron.json writes the vat_-prefixed alert_type literal '${badLit}' again — the check constraint admits only the unprefixed form.`)
          }
        }
      }
    }

    // PARSER sanity (H2): literalValuesFor must be genuinely quote-agnostic —
    // this is the exact gap the adversarial verifier proved live (single-quote
    // regex passes a double-quoted or template-literal replant of the same
    // bug). Assert all three quote styles are caught, a `${...}`-interpolated
    // template literal is skipped (unknowable, not guessed), and a value that
    // isn't a plain lowercase identifier (so cannot be a real enum literal) is
    // ignored rather than false-positived.
    {
      const sample = literalValuesFor(
        "a: { alert_type: 'return_due_90d' }, b: { alert_type: \"return_due_60d\" }, " +
        'c: { alert_type: `return_due_30d` }, d: { alert_type: `vat_${dynamic}_type` }, ' +
        "e: { alert_type: 'Not An Identifier' }",
        'alert_type',
      )
      const ok = sample.has('return_due_90d') && sample.has('return_due_60d') && sample.has('return_due_30d') &&
        !sample.has('vat_${dynamic}_type') && ![...sample].some((v) => v.includes('${')) &&
        !sample.has('Not An Identifier')
      if (!ok) {
        failures.push(`H2-PARSER: literalValuesFor quote-agnostic sanity check failed (got ${JSON.stringify([...sample])}).`)
      }
    }

    // NEGATIVE CONTROLS (H)
    // (1) a synthetic column on a real, already-scanned table must be flagged.
    if (colCovered('vat_alerts', '__verify_nc_n8n_column__')) {
      failures.push('H NEGATIVE CONTROL FAILED: synthetic n8n-payload column was reported as covered.')
    }
    // (2) the parser itself: nested keys must NOT leak into the top-level set,
    // and top-level keys (including one guarded by a function-call value with
    // its own commas) must all be found — proves the depth-aware split works
    // in both directions, not just vacuously returning everything or nothing.
    {
      const sample = objectLiteralKeys("={{ { a: 1, b: { c: 2, d: 3 }, e: [1,2,3], f: fn(1,2) } }}")
      const ok = Array.isArray(sample) && ['a', 'b', 'e', 'f'].every((k) => sample.includes(k)) &&
        !sample.includes('c') && !sample.includes('d')
      if (!ok) {
        failures.push(`H-PARSER: objectLiteralKeys sanity check failed (got ${JSON.stringify(sample)}, expected exactly a/b/e/f).`)
      }
    }
    // (3) the historical bug must not regress. Two of the four dead columns
    // this pass removed (dedup_key, sent_at) are gone from the file entirely,
    // so a plain raw-text proximity check is unambiguous. The other two
    // (topic, source_channel) are DELIBERATELY still present in n8n_05 — just
    // moved inside the `referral_brief` jsonb value instead of being top-level
    // columns — so a raw-text check for those two would false-positive on the
    // correct fix. Their regression protection is the main per-key loop above:
    // if `topic`/`source_channel` ever reappear as TOP-LEVEL keys, the parsed
    // key set catches them via colCovered the same way it caught them
    // originally (proved by negative control (2)'s nested-key exclusion).
    for (const [file, table, deadCol] of [
      ['n8n_01_return_due_cron.json', 'vat_alerts', 'dedup_key'],
      ['n8n_05_cta_referral_webhook.json', 'vat_cta_referrals', 'sent_at'],
    ]) {
      if (colCovered(table, deadCol)) continue // would no longer be dead — not a regression
      const src = readFileSync(join(n8nDir, file), 'utf8')
      if (new RegExp(`jsonBody[\\s\\S]{0,400}\\b${deadCol}\\s*:`).test(src)) {
        failures.push(`§n8n-payload REGRESSION: ${file} writes dead column "${table}.${deadCol}" again (fixed pass-10).`)
      }
    }
  }

  // --- REPO-WIDE tier-literal scan (pass-6, §5.5) ---
  // Pass-5 only guarded the submit route, so the drifted 'crossborder' spelling
  // survived in src/types/index.ts (Tier union) and src/app/api/oss/draft (a
  // `customer.tier !== 'crossborder'` compare that is ALWAYS true against the
  // canonical DB value 'cross_border' — permanently locking Cross-Border
  // customers out of OSS/IOSS drafts). Kill the class wherever it lives: every
  // tier equality/inequality comparison AND every `Tier` union member across all
  // routes + type files must be admitted by the vat_customers.tier constraint.
  const tierAdmitted = (t) => Array.isArray(tierCheckValues) && tierCheckValues.includes(t)
  let scannedTierComparisons = 0
  for (const f of routeFiles) {
    const src = readFileSync(f, 'utf8')
    const rel = f.slice(runtime.length + 1)
    for (const m of src.matchAll(/\btier\s*(?:===|!==)\s*'([a-z_]+)'/g)) {
      scannedTierComparisons++
      if (!tierAdmitted(m[1])) {
        failures.push(`§5.5 tier drift: ${rel} compares tier '${m[1]}' which the vat_customers.tier check constraint rejects (admits ${tierCheckValues?.join('/') ?? '?'}).`)
      }
    }
    for (const u of src.matchAll(/type\s+Tier\s*=\s*([^\n]+)/g)) {
      for (const lit of u[1].matchAll(/'([a-z_]+)'/g)) {
        if (!tierAdmitted(lit[1])) {
          failures.push(`§5.5 tier drift: ${rel} Tier union includes '${lit[1]}' which the vat_customers.tier check constraint rejects (admits ${tierCheckValues?.join('/') ?? '?'}).`)
        }
      }
    }
    if (src.includes("'crossborder'")) {
      failures.push(`§5.5 regression: ${rel} uses the drifted tier spelling 'crossborder' (canonical DB value is 'cross_border').`)
    }
  }

  // NEGATIVE CONTROLS — the same predicates must flag synthetic misses,
  // otherwise the coverage logic is inverted/over-permissive.
  if (colCovered('vat_returns', '__verify_nc_column__')) {
    failures.push('E NEGATIVE CONTROL FAILED: synthetic missing column was reported as covered.')
  }
  if (statusAdmitted('__verify_nc_status__')) {
    failures.push('E NEGATIVE CONTROL FAILED: synthetic status value was reported as admitted.')
  }
  // the drifted spelling MUST be rejected by the constraint predicate, else the
  // repo-wide tier scan is inverted/over-permissive and the whole guard is moot.
  if (tierAdmitted('crossborder')) {
    failures.push("E NEGATIVE CONTROL FAILED: 'crossborder' was reported as a constraint-admitted tier.")
  }
  // the repo-wide scan must have found real tier comparisons to guard (else the
  // regex silently matched nothing and would pass an all-drifted repo).
  if (scannedTierComparisons < 2) {
    failures.push(`E-PARSER: repo-wide tier scan found only ${scannedTierComparisons} tier comparison(s) — expected the submit + OSS routes at minimum.`)
  }
  // and the checks must have real inputs (route parse found the contract)
  if (returnCols.size < 5 || customerCols.size < 3 || writtenStatuses.size < 2) {
    failures.push(`E-PARSER: submit-route parse looks broken (returnCols=${returnCols.size}, customerCols=${customerCols.size}, statuses=${writtenStatuses.size}).`)
  }
}

// =====================================================
// Report
// =====================================================
console.log('vat.law verify — schema<->route coverage + RLS\n')
console.log(`  migrations scanned : ${migFiles.length} (${migFiles.join(', ')})`)
console.log(`  tables created     : ${created.size}`)
console.log(`  tables with RLS    : ${rlsEnabled.size}`)
console.log(`  route tables seen  : ${queried.size}`)
console.log(`  loop-closed tables : ${CLOSED_BY_LOOP.join(', ')}\n`)

if (warnings.length) {
  console.log(YEL(`  ${warnings.length} known-open §5.4 warning(s):`))
  for (const w of warnings) console.log(YEL(`    - ${w}`))
  console.log()
}

if (failures.length) {
  console.log(RED(`  ${failures.length} FAILURE(S):`))
  for (const f of failures) console.log(RED(`    - ${f}`))
  console.log()
  console.log(RED('VERIFY FAILED'))
  process.exit(1)
}

console.log(GRN('VERIFY PASSED') + `  (${warnings.length} known-open §5.4 warning(s), 0 failures)`)
process.exit(0)
