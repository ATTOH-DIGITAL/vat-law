# 4. User Stories & Gherkin Acceptance Criteria — VAT.law — Value Added Tax Act 1994, MTD VAT 9-Box & Partial Exemption OS

```gherkin
Feature: Deterministic Statutory Assessment & Tenant-Isolated Persistence
  As a UK Director or Compliance Officer using VAT.law — Value Added Tax Act 1994, MTD VAT 9-Box & Partial Exemption OS
  I want every statutory calculation and document generation to be deterministically validated and tenant-isolated
  So that our business remains 100% compliant with Value Added Tax Act 1994 (Schedule 1 £90,000 Rolling 12-Month Registration Threshold, Schedule 8 Zero-Rating, Schedule 9 Exempt Supplies)

  Scenario: Anonymous prospect runs the embeddable Snap Module diagnostic
    Given a visitor opens the "Rolling 12-Month £90k Threshold Tracker, FRS vs Standard Scheme Optimiser & 9-Box Auditor" widget
    When they submit valid UK entity parameters
    Then the Snap Module computes the deterministic statutory outcome in <50ms without external network dependencies
    And returns explicit statutory citations referencing "Value Added Tax Act 1994 (Schedule 1 £90,000 Rolling 12-Month Registration Threshold, Schedule 8 Zero-Rating, Schedule 9 Exempt Supplies)"
    And prompts the user to persist their compliance pack into an authenticated workspace

  Scenario: Authenticated tenant executes a protected compliance mutation
    Given an authenticated tenant with a valid JWT validated via auth.getUser()
    When they POST to the vertical compliance endpoint
    Then the runtime enforces per-tenant rate limiting and schema validation
    And writes the resulting record and audit event scoped strictly to the caller's tenant_id
    And Row-Level Security (RLS) blocks any cross-tenant read or mutation

  Scenario: Deep health probe fails closed on missing token or degraded dependency
    Given the "/api/health?deep=1" endpoint is invoked
    When the Authorization bearer token is missing or HEALTH_DEEP_TOKEN is unset
    Then the runtime responds with HTTP 503/401 using constant-time crypto.timingSafeEqual comparison
    And never leaks environment variable values in the response payload

  Scenario: Sovereign bot_verify gate validates repository integrity
    Given a developer or autonomous agent runs "node scripts/bot_verify.mjs"
    When all 5 Sovereign Pillars and Rule 20 (zero GitHub Actions workflows) are inspected
    Then every pillar assertion and runtime verification suite passes with exit code 0
```
