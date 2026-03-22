# PRD Outcome Test Suite (Comprehensive)
Last updated: 2026-03-21 (America/Los_Angeles)
Source of truth: `PRD.md` (v3 Canonical)

## 1) Objective Signoff Standard
System objective is met only when all are true:
- 100% of `Critical` tests pass.
- >= 95% of `High` tests pass.
- 0 open Sev-1 defects.
- 7 consecutive days meet PRD section 13 SLOs.
- Launch gates in PRD section 16 are fully evidenced.

## 2) Evidence Required
- Telnyx call event exports.
- Stripe payment and webhook event logs.
- API logs for `/voice/token-verify` and `/voice/rate-and-authorize`.
- Wallet ledger before/after snapshots.
- Reconciliation job logs and backlog age metrics.
- Compliance/legal signoff artifacts.
- Launch gate checklist with owner/date/proof links.

## 3) Coverage Traceability Matrix
| PRD Area | Required Functionality | Test IDs |
|---|---|---|
| Sec 1 | End-to-end prepaid PSTN objective | F-01, F-02, B-01, R-01 |
| Sec 2 | Afghanistan allowed, Iran blocked until approvals | C-01, C-02, C-03 |
| Sec 3 | Ownership boundary respected | A-07, L-03 |
| Sec 4 | Managed runtime architecture works | R-01, R-02, R-03 |
| Sec 5 | Full MVP call flow | F-01, F-03, F-04 |
| FR-01 | Low-balance pre-connect block | B-03 |
| FR-02 | Pre-connect rate + minutes announcement | F-02 |
| FR-03 | Hard disconnect at `timeLimit` | B-05 |
| FR-04 | Wallet never negative | B-06, D-03 |
| FR-05 | Full auditability | D-06 |
| FR-06 | Idempotent settlement | A-05, D-04 |
| ER-01 | Wrong token lockout | E-01 |
| ER-02 | Invalid destination handling | E-02 |
| ER-03 | Insufficient balance handling | E-03 |
| ER-04 | Rating fail-closed | E-04 |
| ER-05 | Missed webhook fallback reconcile | E-05, R-04 |
| Sec 8 | Rating formula and prefix logic | B-01, B-02, B-04 |
| Sec 9 | Telnyx config correctness | T-01, T-02, T-03 |
| Sec 10 | API surface behavior and security | A-01, A-02, A-03, A-04, A-06, A-08 |
| Sec 11 | Data model + immutable ledger | D-01, D-02, D-03, D-05, D-07 |
| Sec 12 | Security and fraud controls | S-01, S-02, S-03, S-04, S-05, S-06, S-07, S-09 |
| Sec 13 | Availability and settlement SLOs | R-01, R-02, R-04 |
| Sec 14 | Compliance and policy readiness | C-04, C-05, C-06 |
| Sec 16 | Launch gates complete | L-01, L-02, L-03, L-04, L-05 |

## 4) Test Catalog
### 4.1 Functional Flow Tests
| ID | Priority | Test | Pass Criteria |
|---|---|---|---|
| F-01 | Critical | End-to-end successful call | User tops up, authenticates, hears estimate, connects, and settles correctly. |
| F-02 | Critical | Announcement correctness | IVR reads destination rate and estimated minutes before confirmation. |
| F-03 | High | Confirmation gate | Call connects only after explicit user confirmation input. |
| F-04 | High | Call record generation | Successful call creates `call_sessions` and related event records. |

### 4.2 Billing and Rating Tests
| ID | Priority | Test | Pass Criteria |
|---|---|---|---|
| B-01 | Critical | Longest-prefix rate match | System chooses most specific prefix rate deterministically. |
| B-02 | High | Formula math validation | `raw_seconds`, `max_call_seconds`, `announced_minutes` match expected vectors. |
| B-03 | Critical | Minimum connect threshold | Authorization denied when `max_call_seconds < MIN_CONNECT_SECONDS`. |
| B-04 | High | Safety buffer application | Final authorized seconds include configured safety buffer subtraction. |
| B-05 | Critical | Hard cutoff timing | Call disconnects at or before computed `timeLimit` (+/- 2s). |
| B-06 | Critical | No negative balance | Ledger balance never below zero after call settlement and reconcile. |
| B-07 | High | Rounding disclosure integrity | Announced estimate wording reflects non-guaranteed minute estimate. |
| B-08 | High | Prefix update consistency | Rate table changes take effect without stale authorization decisions. |
| B-09 | High | Prefix class differentiation | Distinct prefixes (for example mobile vs non-mobile) return correct rate and estimate. |

### 4.3 Error and Recovery Tests
| ID | Priority | Test | Pass Criteria |
|---|---|---|---|
| E-01 | High | Wrong token retry policy | 3 invalid attempts trigger termination and cooldown. |
| E-02 | High | Invalid destination retry policy | One reprompt only; then safe termination. |
| E-03 | High | Insufficient balance voice path | User receives clear top-up message; no dial-out occurs. |
| E-04 | Critical | Rating fail-closed | Rating/API failure denies call and logs denial reason. |
| E-05 | Critical | Missed webhook fallback | Session enters `pending_settlement` then resolves via reconcile <= 15m. |
| E-06 | High | Delayed webhook ordering | Out-of-order events do not corrupt final settlement state. |

### 4.4 API and Webhook Contract Tests
| ID | Priority | Test | Pass Criteria |
|---|---|---|---|
| A-01 | High | `/payments/checkout-session` contract | Creates valid Stripe session and correlates internal payment intent. |
| A-02 | High | `/voice/token-verify` contract | Returns deterministic allow/deny with reason codes. |
| A-03 | High | `/voice/rate-and-authorize` contract | Returns rate, announced minutes, `max_call_seconds`, and policy decision. |
| A-04 | High | `/webhooks/stripe` signature validation | Invalid signature rejected, valid signature processed once. |
| A-05 | Critical | `/webhooks/telnyx/voice` idempotency | Duplicate completion event does not double-charge ledger. |
| A-06 | High | Deny-by-default behavior | Unknown auth/rate state returns deny, never allow. |
| A-07 | High | Boundary enforcement | API surface does not attempt SIP/media control actions. |
| A-08 | High | Endpoint authz/authn hardening | Protected endpoints reject unauthenticated or unauthorized access attempts. |

### 4.5 Data Integrity and Audit Tests
| ID | Priority | Test | Pass Criteria |
|---|---|---|---|
| D-01 | High | Table completeness | All PRD-required entities exist and are writable/readable. |
| D-02 | High | Immutable ledger rule | No update/delete path exists for posted ledger rows. |
| D-03 | Critical | Double-entry consistency | Wallet balance equals ledger-derived sum after each scenario. |
| D-04 | Critical | Idempotent settle replay | Replayed settle event yields no net additional debit/credit. |
| D-05 | High | Compensating adjustment model | Corrections are additive ledger entries, not destructive edits. |
| D-06 | High | Audit chain completeness | Each call attempt links auth event, call event, and billing result. |
| D-07 | High | Referential integrity | Foreign keys and required relationships prevent orphaned session/payment/event records. |

### 4.6 Security and Fraud Tests
| ID | Priority | Test | Pass Criteria |
|---|---|---|---|
| S-01 | Critical | Token storage security | Tokens are hashed with strong salt/algorithm; plaintext never stored. |
| S-02 | High | Token revocation | Revoked token immediately denied in call auth path. |
| S-03 | High | Token rotation | Rotated token accepted; previous token denied per policy. |
| S-04 | High | Brute-force throttling | Per-ANI and per-account limits trigger under attack simulation. |
| S-05 | High | Velocity spend controls | New account cannot exceed configured spend velocity thresholds. |
| S-06 | High | API key least privilege | Runtime keys lack unrelated write/admin permissions. |
| S-07 | High | PII log minimization | Logs exclude sensitive token/payment/card data. |
| S-08 | High | Chargeback handling flow | Chargeback event creates compliance/fraud flag and defined account action. |
| S-09 | High | Secret rotation drill | Key/secret rotation completes without service interruption or auth bypass. |

### 4.7 Telnyx Runtime Configuration Tests
| ID | Priority | Test | Pass Criteria |
|---|---|---|---|
| T-01 | High | DID to TeXML app mapping | Inbound DID routes to intended TeXML flow. |
| T-02 | High | Outbound voice profile controls | Whitelist, max rate, and daily spend limits enforce as configured. |
| T-03 | High | TeXML runtime behavior | `<Gather>`, `<Say>`, and `<Dial timeLimit>` execute exactly as designed. |

### 4.8 Compliance and Policy Tests
| ID | Priority | Test | Pass Criteria |
|---|---|---|---|
| C-01 | Critical | Afghanistan allow path | Afghanistan destination can authorize when all checks pass. |
| C-02 | Critical | Iran hard block | Iran destination denied in all auth paths at launch. |
| C-03 | High | Iran enablement gate | Iran cannot be enabled without all three required approvals captured. |
| C-04 | High | Policy publication readiness | ToS, Privacy, Refund, AUP are published and versioned. |
| C-05 | High | Operational compliance readiness | Support runbook and incident response playbook approved and test-drilled. |
| C-06 | High | Sanctions workflow execution | Screening workflow runs as designed with evidence of review/escalation outcomes. |

### 4.9 Reliability, SLO, and Operability Tests
| ID | Priority | Test | Pass Criteria |
|---|---|---|---|
| R-01 | Critical | Call auth availability | 7-day pilot shows call auth path >= 99.9%. |
| R-02 | Critical | Payment webhook availability | 7-day pilot shows webhook processing >= 99.9%. |
| R-03 | High | Health endpoint and alerting | `/health` is monitored and alerts on sustained failures. |
| R-04 | Critical | Settlement backlog age | No `pending_settlement` item older than 15 minutes over pilot window. |
| R-05 | High | Reconcile job resilience | Reconcile job retries safely and is idempotent across reruns. |
| R-06 | High | Concurrency and burst handling | System handles expected peak concurrent call auth requests without SLO breach. |

### 4.10 Launch Gate Tests
| ID | Priority | Test | Pass Criteria |
|---|---|---|---|
| L-01 | Critical | Destination enablement proof | Afghanistan termination and verification status documented. |
| L-02 | Critical | Legal/compliance signoff proof | Required approvals are signed and stored. |
| L-03 | High | Ownership boundary audit | No self-hosted SIP/media components found in production inventory. |
| L-04 | High | Ops dashboard readiness | Dashboards/alerts cover auth failures, webhook failures, and backlog age. |
| L-05 | High | Operations drill readiness | On-call runbook drill completed with documented recovery timings. |

## 5) Execution Phases
| Phase | Scope | Exit Criteria |
|---|---|---|
| P1 | Unit and contract tests (A/B/D/S) | 100% pass on Critical tests in scope. |
| P2 | Integration and telephony runtime tests (F/E/T) | No Sev-1 defects open. |
| P3 | Compliance and launch gate tests (C/L) | All gate evidence approved. |
| P4 | 7-day pilot SLO validation (R) | All SLO thresholds satisfied. |

## 6) Defect Severity and Launch Blocking
| Severity | Definition | Launch Impact |
|---|---|---|
| Sev-1 | Billing/compliance/security/control failure, or failed Critical test | Blocks launch |
| Sev-2 | High-impact reliability/operational gap | Blocks launch if >2 open |
| Sev-3 | Low-risk issue with workaround | Does not block by default |

## 7) Final Go/No-Go Rule
- `Go` only if objective signoff standard passes and no launch blockers remain.
- `No-Go` if any Sev-1 exists, any Critical test fails, SLO misses target, or Iran block controls are bypassable.
