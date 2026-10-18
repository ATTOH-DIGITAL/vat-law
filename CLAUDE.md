# vat.law — Vertical #25 of Supreme Operating System

**This is not another MTD-VAT filing tool.** It is Vertical #25 of the Supreme Operating System — an AI-native UK VAT *navigator* for the complex VAT decisions that Xero, Sage, QuickBooks, FreeAgent and bridging tools don't handle: partial exemption, reverse charge / DRC, margin schemes, OSS / IOSS, place-of-supply, postponed VAT accounting, capital goods scheme, TOMS, group VAT, HMRC enquiry response and the post-Jan-2023 points-based penalty regime.

**Status (2026-07-11):** DRC engine green + **LIVE public CIS Domestic Reverse Charge checker: https://vat-drc-check.pages.dev** (HMRC Notice 735, real engine client-side, four-question verdict with cited reasoning; verified 200). Built 2026-07-10 by the calc-sweep session (credits died pre-deploy); deployed 2026-07-11. Own CF Pages project `vat-drc-check` (source: `free-tool/`); zero spend. Product otherwise pre-launch · target Q4 2027.
**Owner:** attoh.tech
**Last updated:** 2026-07-11

---

## The play in one line

AI-native complex-VAT navigator for UK SMEs and their accountants — £19 / £49 / £149 per month — that pairs to whatever bookkeeping software the customer already runs (Xero, Sage, QuickBooks, FreeAgent, sole.tax). We don't compete on basic MTD submission; we win where the £14–£33/mo incumbents are silent.

## Research — why now (UK, May 2026)

| Force | Data | Source |
|-------|------|--------|
| VAT-registered businesses in the UK | **2.179m** (latest HMRC), 2.73m if you include PAYE | data.gov.uk · HMRC VAT registered businesses |
| MTD VAT mandate | **Mandatory for ALL VAT-registered since April 2022** (no threshold opt-out) | HMRC + Wikipedia MTD timeline |
| New points-based penalty regime | Live since **1 Jan 2023** · 4 points (quarterly) → £200 fixed penalty · +£200 per subsequent late submission · points expire after 24 months | HMRC + ACCA Global |
| Late-payment penalty escalation | **April 2025**: LPP1 raised to 3% on day 15 + 3% on day 30; LPP2 now 10% per annum daily rate (was 4%) | Price Bailey · PKF Francis Clark |
| MTD predicted yield | HMRC June 2025 tax gap report: **MTD VAT predicted to deliver £4bn+** | TaxWatchUK |
| HMRC costs after MTD | +15% (HMRC's own cost of collecting VAT after full MTD rollout) | TaxWatchUK |
| Productivity claim collapse | **73% of VAT traders report no productivity change** post-MTD · only 22% saw improvements | HMRC research report 2024 |
| Competitor pricing for basic MTD submission | Sage £14–£33 · Xero £22 · QuickBooks £14–£36 · Avalara MTD file free for spreadsheets · bridging tools (#GoFile, 123 Sheets, Easy MTD) £5–£20 | Vendor public pricing |

## React — where the gap actually sits

| Tier of provider | What they do | What they DON'T do |
|------------------|-------------|--------------------|
| Bookkeeping / MTD filers (Xero / Sage / QuickBooks / FreeAgent) | Record transactions · file the 9-box return · MTD digital link | Partial exemption · capital goods scheme · margin schemes · DRC · OSS/IOSS · place-of-supply · TOMS · group VAT · HMRC enquiry response |
| Bridging tools (#GoFile / 123 Sheets / Easy MTD) | Take a spreadsheet · file the 9-box return | Anything analytical at all |
| VAT specialists (PwC · Deloitte · BDO · RSM · Mazars) | All the complex stuff above | £400–£1,200/hr · inaccessible to ~99% of UK SMEs |
| Accountants in practice | Basic VAT + flat-rate · cash-accounting · some partial-exemption | Quote £1.5–£5k+ for complex one-offs · capacity-constrained on penalty-regime navigation · slow on enquiries |

**vat.law sits in the unserved middle:** AI-native + India QA + (where regulated advice is needed) OISC/CIOT/CTA-qualified partner adviser. £19 / £49 / £149 / month vs. £400+/hr from the specialists.

## Snap-tool architecture

| Snap Tool | Source | Reuse % | What it provides |
|-----------|--------|---------|-----------------|
| sole.tax MTD engine | VENTURES/SOLE_TAX/ | 95% | HMRC MTD API OAuth · digital-link record-keeping · 9-box submission · obligation poll |
| accounts.law CT600 engine | VENTURES/ACCOUNTS_LAW/ | 60% | Statutory FRS 105 entity model · turnover/threshold checks · cross-references to corporation tax base |
| form.law new-employer trigger | VENTURES/COMPANY_FORMATIONS/ | 95% | New company → £90k VAT-threshold watcher · automatic VAT registration prompt |
| pension.law cron pattern | VENTURES/PENSION_LAW/ | 70% | Quarterly VAT return cron · 90/60/30/7/3-day penalty-point exposure alerts · annual review |
| Apex SaaS document factory | VENTURES/APEX_SAAS/ | 80% | VAT registration packs · partial-exemption methodology memo · DRC sub-contractor matrix · HMRC enquiry response packs · margin-scheme records |
| gdpr.law audit trail | VENTURES/GDPR_LAW/ | 50% | Customer-evidential record-keeping · attestation chain |
| supreme_capital | VENTURES/SUPREME_CAPITAL/ | 40% | HMRC enquiry-response advance financing referral · cash-flow gap funding around VAT liabilities |
| dpo.law independence pattern | VENTURES/DPO_LAW/ | 30% | Partner-adviser independence firewall (where regulated tax advice is required) |
| **Total stack reuse** | | **~78%** | |

## Regulatory architecture

Tax advice in the UK is not regulated as a "reserved activity" the way legal advice or financial advice is — but **complex VAT advice carries professional indemnity and HMRC AML-supervised practice exposure**. The architectural decision:

- **vat.law (the platform)** runs the non-regulated, deterministic work: MTD submission, digital-link record-keeping, error-checking, scheme-eligibility checks, penalty-point exposure, audit-trail.
- **CTA / CIOT / ATT partner adviser network** (3 seed firms · qualified Chartered Tax Advisers) handles regulated complex advice on partial-exemption methodology, group VAT, place-of-supply edge cases, HMRC enquiry strategy.
- **India QA** sits between AI and customer — every return submitted and every memo issued is QA-stamped.
- **No commission on partner referrals** is allowed to influence the routing decision (geography → capacity → specialism, in that order).

This is the **same FCA-boundary architecture pattern** used in insurance.law (Supreme Capital does the regulated work) and dpo.law (named DPO does the regulated work) and immigration.law (OISC partner does the regulated work).

## Pricing tiers

| Tier | Price | What's included |
|------|-------|----------------|
| Essentials | £19/mo | MTD VAT submission · digital-link record-keeping · 9-box return · error checker · penalty-point exposure tracker · 90/60/30/7-day alerts · annual review |
| Pro | £49/mo | All Essentials + partial-exemption calculator · margin-scheme records · reverse-charge / DRC matrix · capital-goods-scheme tracker · cash-accounting / flat-rate optimisation · VAT registration / deregistration pack |
| Cross-Border | £149/mo | All Pro + OSS / IOSS · place-of-supply ruling · postponed VAT accounting · EORI · group VAT · TOMS · HMRC enquiry response (1 included per year · India QA + CTA partner) |
| HMRC enquiry response | £495 per enquiry | Standalone product · all tiers · includes audit-trail extraction · India QA + CTA partner · cross-referred Supreme Capital advance financing on assessed liability |
| Annual | 2 months free | Any tier |

## Revenue targets (Y1)

| Stream | Mechanism | Y1 estimate |
|--------|-----------|-------------|
| Essentials subs | £19/mo · 1,200 EOY × ~8mo avg | £182k |
| Pro subs | £49/mo · 400 EOY × ~7mo avg | £137k |
| Cross-Border subs | £149/mo · 100 EOY × ~6mo avg | £89k |
| HMRC enquiry response | ~80 enquiries × £495 net | £40k |
| Annual pre-pay uplift | 25% take annual | +£25k |
| Supreme Capital VAT-liability advance referrals | ~£250 net per referral × 30 | £8k |
| **Total Y1** | | **~£481k** |

Y5 ARR target: **£4–6m** on a base of 4,000+ Pro-and-above customers. Sticky by quarterly filing rhythm (4× / yr customer touchpoint, not annual).

Exit comparables: Avalara ($8.4B private take-out 2022), Vertex (NASDAQ:VERX), Sovos (PE-backed), Xero (NZ-listed). Target exit zone: **£40–80m at Y5–7** on £4–6m ARR · 10–15× ARR multiple.

## What's in this folder

- `CLAUDE.md` — this file
- `INDEX.html` — venture hub
- `STRATEGY.html` — research · market · gap · regulatory architecture · exit
- `TECH_REUSE_BLUEPRINT.html` — 78% reuse audit · £5,600 / 4-week build
- `PRODUCT_SPEC.html` — user journeys · feature spec · DB schema · API surface
- `BUILD_PLAN.html` — sprint · risk register
- `LANDING_PAGE.html` — customer-facing site
- `RUNTIME_DASHBOARD.html` — operational view
- `CLAUDE_PROJECT_SETUP.md` — Claude Project + India team prompts + CTA partner protocol

## Cross-references

- `../OPERATING_SYSTEM/SYSTEM_ARCHITECTURE.html` — vat.law is Vertical #25
- `../SOLE_TAX/` — primary snap source — MTD HMRC API auth + digital-link plumbing
- `../ACCOUNTS_LAW/` — adjacent snap — FRS 105 entity model + CT600 cross-ref
- `../FORM_LAW/` — zero-CAC acquisition (£90k threshold watcher on new companies)
- `../SUPREME_CAPITAL/` — VAT-liability advance financing referral
- `../IMMIGRATION_LAW/` — OISC partner pattern is the template we re-use for CTA partner network

## Session rules

1. **Don't compete on basic MTD submission.** Xero/Sage/QuickBooks own that at £14–£33/mo. We're a complement, not a replacement.
2. **The hook is the complex VAT** — partial exemption, DRC, OSS/IOSS, margin schemes, place-of-supply. Lead every marketing message with "you're overpaying or under-declaring on the bits Xero doesn't ask about."
3. **CTA partner boundary is sacred.** Regulated tax advice is the partner's work. vat.law is the technology platform and the deterministic computation layer.
4. **Penalty-point regime is a sharp urgency hook.** 4 points = £200 fixed penalty; the regime is poorly understood. Lead the dashboard with current penalty-point exposure.
5. **April 2025 LPP escalation** (3%+3% LPP1, 10% pa LPP2 daily) is the freshest urgency story. Use this in landing-page copy.
6. **HMRC enquiry response is the prestige product.** £495 per enquiry · India QA + CTA partner · Supreme Capital advance financing on assessed liability — this is the cross-vertical revenue moment.
7. **Quarterly cadence ≠ annual.** Customer touches the product 4× a year, which is structurally more retentive than once-a-year tax-return products.
8. **Forbidden language:** "we guarantee no HMRC penalty", "we are your tax adviser", "guaranteed VAT reclaim".
