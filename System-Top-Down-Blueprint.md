# Phonecard System Blueprint (Top-Down)
Version: 1.0
Date: 2026-03-21

## 1) Mission
Let U.S. users place prepaid PSTN calls to approved destinations when internet apps are unavailable.

## 1.1) Agentic Primitive Design (Simple)
Build the system as small primitives with one job each:
- `P1 Identity`: Google signup/login (Supabase Auth).
- `P2 Credit`: create immutable wallet credits/debits.
- `P3 Authz`: token verify + risk/compliance gate.
- `P4 Rating`: destination normalize + rate + call seconds budget.
- `P5 Voice Execute`: Telnyx IVR and `<Dial timeLimit>`.
- `P6 Settle`: webhook-driven final debit, idempotent.
- `P7 Reconcile`: fix delayed/missed webhook outcomes.
- `P8 Audit`: append event trail for every decision.

## 2) Product Boundary
- Launch destination: Afghanistan only.
- Iran remains blocked until written legal/provider/internal approvals exist.
- We manage payment, identity, token auth, balance/rating policy, and compliance controls.
- Telnyx manages telephony runtime (DID, IVR, DTMF, bridge, cutoff timer).

## 3) Simplest Production Stack
- Identity + DB: Supabase Auth + Supabase Postgres.
- User login: Google OAuth via Supabase.
- API/Webhooks: Cloudflare Workers.
- Frontend: Cloudflare Pages.
- Telephony: Telnyx TeXML Bin + TeXML App + Outbound Voice Profile.
- Payments: Stripe Checkout + webhook.
- Throttling: Upstash Redis.
- Monitoring: Sentry + Cloudflare/Supabase logs.

## 4) Core User Journey
1. User signs up with Google.
2. User buys credit.
3. User receives token/PIN.
4. User calls U.S. access number.
5. IVR asks token and destination.
6. System announces rate and estimated minutes.
7. User confirms and call connects.
8. Call stops at credit limit.
9. Settlement updates wallet and call history.

## 5) Runtime Call Flow
1. Telnyx `<Gather>` collects token.
2. `P3 Authz` (`/voice/token-verify`) validates token, lockout, fraud/compliance flags.
3. Telnyx `<Gather>` collects destination.
4. `P4 Rating` (`/voice/rate-and-authorize`):
- normalizes destination,
- longest-prefix rate lookup,
- computes `max_call_seconds`,
- returns allow/deny + announcement data.
5. `P5 Voice Execute`: Telnyx `<Say>` announces estimate.
6. `P5 Voice Execute`: Telnyx `<Dial timeLimit>` enforces hard cutoff.
7. Telnyx webhook posts completion event.
8. `P6 Settle`: settle ledger idempotently.
9. `P7 Reconcile`: resolve delayed/missed events.

## 6) API Surface
- `POST /payments/checkout-session`
- `POST /webhooks/stripe`
- `POST /voice/token-verify`
- `POST /voice/rate-and-authorize`
- `POST /webhooks/telnyx/voice`
- `GET /health`

Authorization response contract:
- `allow`
- `reason_code`
- `rate`
- `announced_minutes`
- `max_call_seconds`

## 7) Data Model
- `users`
- `auth_tokens`
- `wallet_ledger`
- `destination_rates`
- `call_sessions`
- `payment_events`
- `telnyx_events`
- `fraud_flags`
- `compliance_flags`
- `admin_audit_log`
- `idempotency_registry`

Data invariants:
- Ledger append-only.
- No destructive ledger edits.
- Settlement and payment webhooks are idempotent.
- FK integrity across user/call/payment/event records.

## 8) Billing Rules
- Pre-connect deny if `max_call_seconds < MIN_CONNECT_SECONDS`.
- Compute:
- `raw_seconds = floor((balance / rate_per_min) * 60)`
- `max_call_seconds = max(0, raw_seconds - safety_buffer_seconds)`
- `announced_minutes = floor(max_call_seconds / 60)`
- Always use estimate language in announcement.

## 9) Error Behavior
- Wrong token: 3 tries, then cooldown.
- Invalid destination: one reprompt, then end.
- Insufficient balance: announce top-up and end.
- Rating/Auth uncertainty: fail closed.
- Delayed/missed webhook: mark `pending_settlement` and reconcile.

## 10) Security Model
- Google OAuth managed by Supabase.
- Token hashes only (no plaintext token storage).
- Strict Stripe and Telnyx signature verification.
- Role-based admin authorization.
- Redis-based brute-force controls.
- Quarterly secret rotation drill.
- PII-minimized logging.

## 11) Compliance Model
- Destination allow-list and prefix controls.
- Afghanistan allowed at launch.
- Iran blocked at launch.
- Country policy changes require dual approval + audit entry.
- Sanctions workflow must record reviewer, timestamp, and decision evidence.

## 12) Reliability Targets
- Call auth availability >= 99.9%.
- Payment webhook processing >= 99.9%.
- Pending settlement backlog cleared <= 15 minutes.
- Reconcile job runs every minute.

## 13) Deployment Model
- Environments: `dev`, `staging`, `prod`.
- CI/CD gates:
- schema migration checks,
- webhook signature tests,
- idempotency regression tests,
- policy block tests (Iran blocked).

Primitive deployment rule:
- Each primitive must be independently testable.
- Primitive failures must fail closed and write audit events.

## 14) Observability
- Dashboard tiles:
- auth allow/deny rate,
- webhook success/failure,
- pending settlement age/count,
- wallet mismatch alerts.
- Runbooks:
- webhook outage,
- settlement backlog,
- fraud spike,
- Telnyx event delay.

## 15) Launch Checklist
- Google signup and login working.
- Stripe payments + webhook crediting verified.
- Telnyx call flow verified (`<Gather>`, `<Say>`, `<Dial timeLimit>`).
- Afghanistan route enabled and tested.
- Iran denied in all auth paths.
- All `Critical` tests in `PRD-outcome-tests.md` passing.
