// Dependency-free migration/route coverage check for cross_vertical_events.
// Proves sql_004 creates a table whose columns cover every key the
// cross-fired route inserts, and that RLS permits the anon webhook writer.
// No DB, no npm deps — pure file parsing with node:test.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const runtime = join(here, '..')

const migrationSql = readFileSync(
  join(runtime, 'supabase_migrations', 'sql_004_cross_vertical_events.sql'),
  'utf8'
)
const routeSrc = readFileSync(
  join(runtime, 'src', 'app', 'api', 'cross-fired', 'route.ts'),
  'utf8'
)

// --- extract the keys the route inserts into cross_vertical_events ---
function insertKeysFor(src, table) {
  const marker = `from('${table}').insert({`
  const start = src.indexOf(marker)
  assert.notEqual(start, -1, `insert into ${table} not found in route`)
  const body = src.slice(start + marker.length, src.indexOf('})', start))
  // top-level object keys: `key:` at any indent, take the identifier before ':'
  return body
    .split('\n')
    .map((l) => l.trim())
    // matches both `key: value` and ES6 shorthand `key,` / `key`
    .map((l) => /^([a-z_][a-z0-9_]*)\s*(:|,|$)/.exec(l))
    .filter(Boolean)
    .map((m) => m[1])
}

// --- extract column names from the create table block ---
function columnsFor(sql, table) {
  const marker = `create table if not exists ${table} (`
  const start = sql.indexOf(marker)
  assert.notEqual(start, -1, `create table ${table} not found in migration`)
  const block = sql.slice(start + marker.length, sql.indexOf('\n);', start))
  const cols = []
  for (const line of block.split('\n')) {
    const t = line.trim()
    // a column line starts with an identifier followed by a type; skip
    // continuation lines (check (...), references ...) and constraint lines.
    const m = /^([a-z_][a-z0-9_]*)\s+(uuid|text|jsonb|timestamptz|numeric|boolean)/.exec(t)
    if (m) cols.push(m[1])
  }
  return cols
}

test('every cross_vertical_events insert key has a migration column', () => {
  const keys = insertKeysFor(routeSrc, 'cross_vertical_events')
  const cols = columnsFor(migrationSql, 'cross_vertical_events')
  assert.ok(keys.length >= 5, `expected >=5 insert keys, got ${keys.join(',')}`)
  for (const k of keys) {
    assert.ok(cols.includes(k), `insert key "${k}" has no column (cols: ${cols.join(',')})`)
  }
})

test('migration enables RLS and grants anon INSERT (anon SSR webhook writer)', () => {
  assert.match(migrationSql, /enable row level security/)
  assert.match(migrationSql, /for insert\s+to anon, authenticated/)
  // no SELECT policy for anon/authenticated — reads are service-role only
  assert.doesNotMatch(migrationSql, /for select\s+to (anon|authenticated)/)
})

test('NEGATIVE CONTROL: a fabricated key is correctly reported as uncovered', () => {
  const cols = columnsFor(migrationSql, 'cross_vertical_events')
  assert.equal(cols.includes('definitely_not_a_column'), false)
})
