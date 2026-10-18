# vat.law — Backend Contract (n8n ↔ runtime)

Created 10 Jul 2026 as part of the estate-wide n8n node-API translation sweep
(gdpr-law PR #589 is the pattern of record; ir35-law is the calibration
example). Scope: what the 5 workflow JSONs in `runtime/n8n_workflows/` do, how
they relate to the Next runtime's API routes, and which to import in which
deployment mode. Table/column names in the JSONs are the contract of record;
`runtime/scripts/verify.mjs` checks G4/G4b + H/H2 machine-check every workflow
table ref (`/rest/v1/` URL refs AND both node-param spellings, rpc/storage
excluded, with negative controls), every POSTed column, and every
CHECK-constrained enum literal against the migration chain.

## Node-API status (10 Jul 2026 — translation done)

All Supabase traffic in the 5 JSONs runs as `n8n-nodes-base.httpRequest`
(v4.x) → PostgREST. Translated 10 Jul 2026: the old `bodyContentType: "json"`
param and the `options.headers` object were **silently ignored by httpRequest
v4.x** — every PostgREST call went out with **no `apikey`/`Authorization`
headers at all**, and the `Prefer: resolution=ignore-duplicates` WF01 thought
it was sending (inside `options.headers`) never reached the wire. Real shapes
now: `sendHeaders: true` + `headerParameters`, `sendBody: true` +
`specifyBody: "json"` + `jsonBody`, and — for WF04's HMRC-notice PDF vault
upload to `/storage/v1/object/vat-enquiry-notices/…` — the real binary path
(`contentType: "binaryData"` + `inputDataFieldName`), which the fictional
shape likewise never actually sent. WF01's return-due alert upsert now carries
`?on_conflict=customer_id,alert_type,trigger_date` + `Prefer:
resolution=ignore-duplicates`, matching sql_001:385
`unique (customer_id, alert_type, trigger_date)` on `vat_alerts`. Import-time
residue: n8n Cloud blocks `$env.*` — swap to the credential store if hosted
there; the `vat-enquiry-notices` storage bucket must exist before WF04 runs
(storage paths are deliberately outside the table gate's scope).

**Runtime vs DEVELOPER_PACK divergence:** all 5 `DEVELOPER_PACK/n8n_*.json`
copies had CONTENT-diverged from `runtime/n8n_workflows/` before this sweep —
e.g. the pack's WF01 still upserts on the **dead `dedup_key` column** (node
"Upsert alert (dedup on dedup_key)") that pass-10 removed from the runtime
copy, and the pack's WF02 still writes the old "Snapshot row for dashboard"
node. `runtime/n8n_workflows/` is the curated contract of record; the pack
copies are stale duplicates kept for the cleanup lane. Both locations were
param-fixed in this sweep so neither carries the fictional node API, but do
NOT import the pack copies.

## Deployment Modes — route ↔ workflow overlap (decided 10 Jul 2026)

The runtime's write routes are session-authed (`supabase.auth.getUser()` +
401) and rate-limited; the webhook workflows carry no auth — running both
double-writes the same surfaces. **Runtime-primary is the shipped default; the
webhook workflows are the STANDALONE-mode alternative.**

| Workflow | Runtime counterpart | Runtime mode (default) | Standalone mode |
|---|---|---|---|
| 01 return-due cron | none — runtime has no scheduler | **IMPORT** — sole 90/60/30/7-day return-due alert engine; idempotent upsert per sql_001:385 | same |
| 02 penalty-point exposure cron (Mon 8am) | none | **IMPORT** — sole weekly exposure engine, but see FINDING 1 (same-day re-run 409s) and note it fires insurance.law's cross-sell webhook (`INSURANCE_LAW_CROSS_SELL_WEBHOOK` — point at insurance `/api/events/ingest` in that vertical's runtime mode, per its BACKEND_CONTRACT) | same |
| 03 threshold breach (webhook `vat-threshold-breach`) | `/api/threshold/check` (rate-limited public lead intake, writes `threshold_check_leads`; `/api/cross-fired` also writes it) | do NOT import — duplicate unauthed lead-intake surface. Capability asymmetry flagged, not aligned: WF03 also books Cal.com + sends Resend email; the route does neither | primary |
| 04 enquiry intake (webhook `vat-enquiry-intake`) | `/api/enquiry/intake` (getUser-authed + rate-limited, writes `vat_hmrc_enquiries` + `vat_alerts`, assigns CTA partner) | do NOT import — unauthed duplicate of an authed route | primary, but BLOCKED by FINDING 2 (dead RPC hard-fails the audit-trail leg) |
| 05 CTA referral (webhook `vat-cta-refer`) | none — no route writes `vat_cta_referrals` (the intake route only reads `vat_cta_partners`) | **IMPORT** as the sole referral-ledger engine — but see FINDING 2 (dead RPC hard-fails the partner open-count leg) | same |

**Dangling ping (flagged, not aligned):** `/api/enquiry/intake` fires
`N8N_WEBHOOK_VAT_ENQUIRY` **after** its own insert with a post-write payload
(`{ vertical, event: 'enquiry_intake', enquiry_id, customer_id, enquiry_type,
priority, response_deadline, hmrc_reference, india_qa_required }`, route.ts:201).
WF04's `vat-enquiry-intake` webhook expects a **fresh intake body**
(`body.customer_id`, `body.enquiry_type`, notice PDF, officer fields) and
would treat the ping as a brand-new HMRC notice — inserting a SECOND
`vat_hmrc_enquiries` row for the same enquiry. Keep `N8N_WEBHOOK_VAT_ENQUIRY`
UNSET until a dedicated post-write consumer workflow exists for that payload
shape (the gdpr-law lesson, verbatim).

## REAL FINDINGS (10 Jul 2026 — recorded, not silently fixed)

1. **WF02's "Weekly exposure alert row" 409s on same-day re-runs.** It POSTs
   `/rest/v1/vat_alerts` with NO `?on_conflict` and NO `Prefer` resolution
   header, writing a fixed `alert_type: 'penalty_point_exposure'` and
   `trigger_date: $now.format('yyyy-MM-dd')`. `vat_alerts` carries sql_001:385
   `unique (customer_id, alert_type, trigger_date)`, so the weekly Monday runs
   are fine (new trigger_date each week) but ANY same-day re-run — manual
   re-execute, retry after a partial failure, double cron fire — hits 23505 →
   PostgREST 409 → the node hard-fails the execution. WF01 shows the correct
   idempotent shape one file away. Fix belongs to the workflow owner (add
   `?on_conflict=customer_id,alert_type,trigger_date` + `Prefer:
   resolution=ignore-duplicates`); recorded here rather than patched so the
   translation sweep stays param-only.
2. **Two RPC calls target functions NO migration defines.** WF04 POSTs
   `/rest/v1/rpc/pull_audit_trail_for_periods` and WF05 POSTs
   `/rest/v1/rpc/increment_cta_partner_open_count`; the vat chain defines only
   the `vat_touch_updated_at` / `vat_audit_capture` trigger functions
   (sql_001:484, 515) and no `.sql` anywhere in the repo creates either RPC
   (estate-wide sweep 10 Jul 2026). Neither node sets
   `options.response.response.neverError`, so the PostgREST 404 hard-fails the
   whole execution — WF04's audit-trail leg and WF05's partner open-count leg
   are dead on arrival. RPCs are functions, not tables (the verify gate
   excludes them by design, with a control) — this is a contract gap for the
   owner: ship the two functions as a migration or drop/soft-fail the calls.

## Env contract (n8n side)

`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (all 5), `RESEND_API_KEY` +
`RESEND_FROM_EMAIL` (01/02/03/04/05), `INDIA_QA_QUEUE_WEBHOOK` +
`INDIA_QA_QUEUE_API_KEY` (01/04), `INSURANCE_LAW_CROSS_SELL_WEBHOOK` +
`INSURANCE_LAW_API_KEY` (02), `CALCOM_API_URL` + `CALCOM_API_KEY` +
`CALCOM_VAT_INTAKE_EVENT_ID` (03), `ANTHROPIC_API_KEY` +
`CTA_PARTNER_SIGNOFF_EMAIL` + `RESPONSE_PACK_RENDER_WEBHOOK` +
`RESPONSE_PACK_RENDER_API_KEY` + `SUPREME_CAPITAL_REFERRAL_WEBHOOK` +
`SUPREME_CAPITAL_API_KEY` + `SUPREME_TEAM_CC_EMAIL` (04/05). n8n Cloud blocks
`$env.*` — use the credential store there.

## Verify gate

`runtime/scripts/verify.mjs` — check G4 (pass-9/10) scans every
`/rest/v1/<table>` workflow URL ref against the drift map + migration chain
(rpc excluded); G4b (added 10 Jul 2026) feeds the `tableId`/bare-`table` param
spellings through the same predicates and adds the negative-control block
(ghost URL + ghost param must trip, chain table must pass, rpc/storage/HTML
must stay excluded); check H asserts every POSTed jsonBody column is a real
migration column; H2 asserts every CHECK-constrained enum literal (e.g.
`vat_alerts.alert_type`) is constraint-admitted. Exit 0 as of 10 Jul 2026.
