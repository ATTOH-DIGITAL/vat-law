# 1. Ideal Customer Profiles (ICP) — VAT.law — Value Added Tax Act 1994, MTD VAT 9-Box & Partial Exemption OS

## 1.1 Executive Positioning
- **Repository**: `vat-law`
- **Primary Domain**: `vat.law`
- **Core Statutory Mandate**:
- **Value Added Tax Act 1994 (Schedule 1 £90,000 Rolling 12-Month Registration Threshold, Schedule 8 Zero-Rating, Schedule 9 Exempt Supplies)**
- **Value Added Tax Regulations 1995 (Part XIV Partial Exemption De Minimis £625/mo & 50% Test, Flat Rate Scheme 16.5% Limited Cost Trader Rule)**
- **Making Tax Digital for VAT (Digital Links Mandate & Fraud Prevention Headers)**
- **Finance Act 2021 Schedule 24 & 26 (Points-Based Late Submission & Late Payment Penalty Regime)**

## 1.2 Primary Buyer Persona (Tier-1 ICP)
- **Segment**: UK VAT-Registered SMEs (£90k–£10m turnover) and Fast-Growing Pre-Threshold Businesses tracking the rolling 365-day £90,000 cliff edge
- **Decision Maker**: Managing Director, Founder, Compliance Principal, or Finance Director.
- **Annual Contract Value (ACV)**: £350 – £2,400/yr self-serve; up to £6,000/yr multi-entity/enterprise.
- **Urgent Trigger Events**:
  1. Statutory filing deadline, regulatory inspection notice, or penalty warning letter within 14–60 days.
  2. High-street advisor or legacy software quoting £1,500–£10,000+ with a 3–6 week manual turnaround.
  3. Immediate requirement for an audit-defensible calculation or prescribed statutory document via `Rolling 12-Month £90k Threshold Tracker, FRS vs Standard Scheme Optimiser & 9-Box Auditor`.

## 1.3 Secondary Channel & Multiplier Persona (Tier-2 ICP)
- **Segment**: Bookkeepers & E-Commerce Accountants reconciling multi-rate UK/EU OSS, Reverse Charge, and Partial Exemption adjustments
- **Channel Economics**: 1 partner seat governs 15–100 underlying SME client tenants under strict Supabase `tenant_id` Row-Level Security (RLS).
- **Wedge Motion**: Embeddable Snap Module (`snap_modules/vat_threshold_engine.js`) deployed as an un-gated statutory diagnostic that converts high-intent organic traffic into authenticated workspaces.

## 1.4 Disqualification Criteria (Anti-ICP)
- Non-UK jurisdictions where UK primary legislation (Value Added Tax Act 1994 (Schedule 1 £90,000 Rolling 12-Month Registration Threshold, Schedule 8 Zero-Rating, Schedule 9 Exempt Supplies)) does not apply.
- FTSE-350 enterprises requiring 12-month bespoke on-premise procurement cycles.
