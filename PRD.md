# PRD (Canonical, Rebuilt Top-Down)
Last updated: 2026-03-21
Architecture policy: simple agentic primitive design

## 1) Objective
Deliver a prepaid PSTN calling system for U.S. users that remains usable when internet calling apps are unavailable.

## 2) Scope and Country Policy
- Launch country: Afghanistan only.
- Iran is blocked at launch.
- Iran enablement requires written legal, provider, and internal compliance approval.

## 3) Platform (Simple + Operable)
- Render Web Service: core API and webhook runtime.
- Cloudflare: DNS, WAF, routing, static web delivery.
- Supabase: Google Authentication + Postgres.
- Telnyx: hosted IVR and call execution.
- Stripe: prepaid top-up payments.
- Redis (managed): token throttling and cooldown controls.

## 4) Agentic Primitives
- `Identity`: Google Authentication and session handling.
- `Credit`: Stripe credit posting to immutable ledger.
- `Authz`: token validation and policy checks.
- `Rating`: destination pricing and call budget math.
- `VoiceExecute`: Telnyx `<Gather>/<Say>/<Dial timeLimit>`.
- `Settle`: webhook-driven debit settlement.
- `Reconcile`: delayed/missed event closure.
- `Audit`: append-only operational evidence trail.

## 5) User Journey
1. User signs up with Google.
2. User buys credit.
3. User receives token/PIN.
4. User dials U.S. access number.
5. Token and destination are collected and validated.
6. IVR announces rate and estimated minutes.
7. User confirms and call connects.
8. Call disconnects at budget limit.
9. Ledger and call history settle automatically.

## 6) Functional Requirements
- FR-01: deny call when budget is below minimum threshold.
- FR-02: announce rate and estimate before connect.
- FR-03: enforce hard cutoff with `timeLimit`.
- FR-04: wallet cannot go negative in normal operation.
- FR-05: every call attempt is auditable.
- FR-06: settlement is idempotent.

## 7) Error Handling
- Wrong token: max 3 attempts then cooldown.
- Invalid destination: one reprompt then terminate.
- Insufficient balance: deny with top-up prompt.
- Rating/auth uncertainty: fail closed.
- Missed webhook: mark `pending_settlement`, retry, reconcile.

## 8) Security and Compliance
- webhook signature checks required for Stripe and Telnyx.
- token hashes only.
- least-privilege credentials and rotation drills.
- dual approval for country policy changes.
- sanctions workflow with reviewer, timestamp, and evidence.

## 9) Troubleshooting Model
- Primitive-local diagnosis first.
- Cross-primitive correlation second.
- Priority:
- P1 compliance or billing correctness.
- P2 service degradation.
- P3 non-critical UX.

## 10) SLOs
- call authorization availability >= 99.9%.
- payment webhook processing >= 99.9%.
- settlement backlog age <= 15 minutes.

## 11) Launch Gates
- Afghanistan route enabled and tested.
- Iran blocked in all auth paths.
- critical outcome tests pass.
- two consecutive full-suite passes complete.

