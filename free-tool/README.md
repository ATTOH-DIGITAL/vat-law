# CIS Domestic Reverse Charge checker — free public calculator (source of record)

**LIVE:** https://vat-drc-check.pages.dev (deployed 2026-07-11 from this dir; verified 200)
**Deploy:** `cd` into this dir → `npx wrangler pages deploy . --project-name=vat-drc-check --branch=main` (own CF account, zero spend).
**Engine:** `drc.js` — the ATTOH VAT & CIS DRC decision engine (HMRC Notice 735), page-adapted with an ESM `export` line for the browser. **Keep in sync when a runtime module lands.**
**Provenance:** built 2026-07-10 by the calc-sweep session (credits died before deploy or commit); source recovered from the session scratchpad on 2026-07-11 and deployed from this exact dir.
