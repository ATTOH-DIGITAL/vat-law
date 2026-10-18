# 3. Product Strategy & Sovereign Moat — VAT.law — Value Added Tax Act 1994, MTD VAT 9-Box & Partial Exemption OS

## 3.1 Five-Pillar Sovereign Architecture
`vat-law` is engineered as an autonomous, zero-bloat vertical operating system conforming to the **ATTOH Sovereign 5-Pillar Standard**:
1. **Pillar 1 (`docs/`)**: Canonical commercial, statutory, Gherkin acceptance, and investor intelligence.
2. **Pillar 2 (`runtime/`)**: Deterministic application & API runtime with header-only constant-time deep health probes (`/api/health?deep=1`).
3. **Pillar 3 (`snap_modules/`)**: Dependency-free, embeddable statutory calculation engines (`Rolling 12-Month £90k Threshold Tracker, FRS vs Standard Scheme Optimiser & 9-Box Auditor`) that run identically in browser widgets, API routes, and background workers.
4. **Pillar 4 (`supabase_migrations/`)**: PostgreSQL DDL with mandatory `ENABLE ROW LEVEL SECURITY` and `tenant_id` isolation across every operational and audit table.
5. **Pillar 5 (`scripts/bot_verify.mjs`)**: Zero-cost local/bot verification harness enforcing Rule 20 compliance (no paid GitHub Actions runner minutes).

## 3.2 Statutory Rule Engine Moat
Unlike generic LLM wrappers that hallucinate UK tax rates or statutory notice periods, `vat-law` encodes hard statutory thresholds directly in deterministic code:
- **Value Added Tax Act 1994 (Schedule 1 £90,000 Rolling 12-Month Registration Threshold, Schedule 8 Zero-Rating, Schedule 9 Exempt Supplies)**
- **Value Added Tax Regulations 1995 (Part XIV Partial Exemption De Minimis £625/mo & 50% Test, Flat Rate Scheme 16.5% Limited Cost Trader Rule)**
- **Making Tax Digital for VAT (Digital Links Mandate & Fraud Prevention Headers)**
- **Finance Act 2021 Schedule 24 & 26 (Points-Based Late Submission & Late Payment Penalty Regime)**

## 3.3 Free-Tool PLG Wedge
- **Canonical Snap Widget**: `Rolling 12-Month £90k Threshold Tracker, FRS vs Standard Scheme Optimiser & 9-Box Auditor` (`snap_modules/manifest.json`).
- **Conversion Loop**: Anonymous prospect runs instant statutory check -> receives RAG risk score & statutory citation -> unlocks PDF certificate / automated filing / continuous monitoring via Stripe Checkout.
