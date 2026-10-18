// Dependency-free migration/route coverage check for integration_oauth_states.
// Proves sql_005 creates a table whose columns cover every key the Xero OAuth
// connect route inserts, and that RLS is enabled + owner-scoped (the caller can
// only write a pending OAuth-state row for a vat_customers row they own).
// No DB, no npm deps — pure file parsing with node:test.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const runtime = join(here, '..')

const migrationSql = readFileSync(
  join(runtime, 'supabase_migrations', 'sql_005_integration_oauth_states.sql'),
  'utf8'
)
const routeSrc = readFileSync(
  join(runtime, 'src', 'app', 'api', 'integrations', 'xero', 'connect', 'route.ts'),
  'utf8'
)

function insertKeysFor(src, table) {
  const marker = `from('${table}').insert({`
  const start = src.indexOf(marker)
  assert.notEqual(start, -1, `insert into ${table} not found in route`)
  const body = src.slice(start + marker.length, src.indexOf('})', start))
  return body
    .split('\n')
    .map((l) => l.trim())
    .map((l) => /^([a-z_][a-z0-9_]*)\s*(:|,|$)/.exec(l))
    .filter(Boolean)
    .map((m) => m[1])
}

function columnsFor(sql, table) {
  const marker = `create table if not exists ${table} (`
  const start = sql.indexOf(marker)
  assert.notEqual(start, -1, `create table ${table} not found in migration`)
  const block = sql.slice(start + marker.length, sql.indexOf('\n);', start))
  const cols = []
  for (const line of block.split('\n')) {
    const t = line.trim()
    const m = /^([a-z_][a-z0-9_]*)\s+(uuid|text|jsonb|timestamptz|numeric|boolean)/.exec(t)
    if (m) cols.push(m[1])
  }
  return cols
}

test('every integration_oauth_states insert key has a migration column', () => {
  const keys = insertKeysFor(routeSrc, 'integration_oauth_states')
  const cols = columnsFor(migrationSql, 'integration_oauth_states')
  // route inserts: provider, customer_id, state, nonce, created_at
  assert.ok(keys.length >= 5, `expected >=5 insert keys, got ${keys.join(',')}`)
  for (const k of keys) {
    assert.ok(cols.includes(k), `insert key "${k}" has no column (cols: ${cols.join(',')})`)
  }
})

test('migration enables RLS and is owner-scoped (no anon access)', () => {
  assert.match(migrationSql, /enable row level security/)
  // owner-scoped policy for authenticated callers, keyed on vat_customers ownership
  assert.match(migrationSql, /to authenticated/)
  assert.match(
    migrationSql,
    /customer_id in \(select id from vat_customers where profile_id = auth\.uid\(\)\)/
  )
  // this is NOT a public webhook sink — anon must never be granted access
  assert.doesNotMatch(migrationSql, /to anon/)
})

test('state column is UNIQUE (callback matches on it; collisions are bugs)', () => {
  // the create table block must mark state unique so the callback lookup is exact
  const block = migrationSql.slice(
    migrationSql.indexOf('create table if not exists integration_oauth_states ('),
    migrationSql.indexOf('\n);')
  )
  assert.match(block, /state\s+text not null unique/)
})

test('NEGATIVE CONTROL: a fabricated key is correctly reported as uncovered', () => {
  const cols = columnsFor(migrationSql, 'integration_oauth_states')
  assert.equal(cols.includes('definitely_not_a_column'), false)
})
