# PRD Synthesized: Primitive Simple, Render + Cloudflare
Date: 2026-03-21

## Product Objective
Provide prepaid PSTN calling for U.S. users to Afghanistan at launch when internet calling apps are unavailable.

## Scope and Country Policy
- Launch country: Afghanistan only.
- Iran is blocked at launch in all authorization paths.
- Iran enablement requires written legal, provider, and internal compliance approval.
- No other destination may be enabled without the same recorded approval set.

## Architecture Choice
- Runtime: Render Web Service for API + webhook handlers.
- Edge: Cloudflare for routing, WAF, DNS, and static web delivery.
- Identity and DB: Supabase with Google Authentication.
- Telephony: Telnyx hosted runtime.
- Cache/Controls: Redis (managed) for per-ANI and per-account throttling, cooldowns, and short-lived auth state.

## agentic primitive model
- `Identity`: Google Authentication and user session lifecycle.
- `Credit`: Stripe checkout + webhook credits.
- `Authz`: token verification with Redis-backed counters and policy/fraud checks.
- `Rating`: longest-prefix rate resolution and call budget math.
- `VoiceExecute`: Telnyx `<Gather>`, `<Say>`, `<Dial timeLimit>`.
- `Settle`: idempotent call debit settlement.
- `Reconcile`: close delayed/missed webhook paths.
- `Audit`: append decision/event trail.

## Google Authentication
- Signup/login uses Google OAuth via Supabase.
- First login provisions token/PIN and wallet context.
- Admin access requires role claims and least-privilege authorization.

## Rating and Authorization Rules
- Rate selection: longest-prefix match.
- Decision-time rate snapshot is used consistently for auth response.
- `raw_seconds = floor((available_balance_usd / retail_rate_usd_per_min) * 60)`.
- `max_call_seconds = max(0, raw_seconds - safety_buffer_seconds)`.
- `announced_minutes = floor(max_call_seconds / 60)`.
- Connect only when `max_call_seconds >= MIN_CONNECT_SECONDS`.
- Announcement wording must state minutes are an estimate.

## Core Call Flow
1. User tops up via Stripe.
2. User calls U.S. access number.
3. Token verification runs.
4. Destination rating and authorization runs.
5. IVR announces rate and estimated minutes.
6. User confirms; call connects.
7. `<Dial timeLimit>` hard-disconnects on budget exhaustion.
8. Completion webhook settles debit.
9. Reconcile job closes delayed/missed settlement paths.

## Error Handling
- Wrong token: max 3 attempts, then terminate and apply cooldown.
- Invalid destination: one reprompt only, then terminate safely.
- Insufficient balance: deny before dial-out and play top-up prompt.
- Rating/auth uncertainty: fail closed with denial reason logged.
- Missed final webhook: mark `pending_settlement`, retry, then reconcile.

## API and Webhook Contracts
| Endpoint | Auth | Required Input | Required Output | Idempotency Source |
|---|---|---|---|---|
| `POST /payments/checkout-session` | user JWT | user, amount | checkout URL, session id | request id |
| `POST /webhooks/stripe` | signed webhook | event payload | accepted/ignored + reason | stripe event id |
| `POST /voice/token-verify` | telnyx call token | token, ani, call id | allow, reason_code | call id + step |
| `POST /voice/rate-and-authorize` | telnyx call token | destination, user/session | allow, rate, announced_minutes, max_call_seconds, reason_code | call id + destination |
| `POST /webhooks/telnyx/voice` | signed webhook | call event payload | accepted/ignored + reason | telnyx event id |
| `GET /health` | none | none | status, timestamp | n/a |

## Required Data Entities
- `users`
- `auth_tokens`
- `wallet_ledger` (append-only)
- `payment_events`
- `call_sessions`
- `call_events`
- `auth_events`
- `reconcile_runs`
- `fraud_flags`
- `compliance_flags`
- `admin_audit_log`

Entity rules:
- FK integrity between calls, events, and settlement records.
- Corrections are compensating ledger rows only.
- Settlement and payment writes are idempotent.

## Security and Compliance Controls
- webhook signature verification is mandatory.
- token hashes only; no plaintext storage.
- least-privilege keys + quarterly rotation drills.
- unknown state must fail closed.
- Iran blocked at launch.
- Afghanistan allow-listed at launch.
- country policy changes require dual approval and audit evidence.
- sanctions workflow stores reviewer, timestamp, and decision artifacts.

## Troubleshooting Model
- Primitive-local diagnosis first.
- Cross-primitive correlation second.
- P1: billing or compliance correctness risk.
- P2: authorization/rating degradation.
- P3: non-critical UX issue.

## Operational Runbook
- Webhook failures: verify signature, queue retry, inspect idempotency keys.
- Settlement backlog: inspect `pending_settlement`, run reconcile, verify closure.
- Token brute force: lock account/ANI, inspect counters, escalate fraud review.
- Render outage: fail closed, recover from queue backlog.
- Cloudflare errors: rollback route/deploy, restore known-good path.
- Telnyx event delay: preserve pending state and settle on delayed callback.

## SLOs
- Call authorization availability >= 99.9%.
- Payment webhook processing >= 99.9%.
- Settlement backlog age <= 15 minutes.
- SLO evidence must be collected for 7 consecutive pilot days.

## Acceptance Criteria
- Pre-connect rate and minute estimate announced.
- Call denied below minimum threshold.
- Hard cutoff enforced at time budget.
- Wallet non-negative after settle/reconcile.
- Duplicate webhooks cannot double charge.
- Iran blocked in all auth paths.

## Launch Gates
- Afghanistan enablement verified.
- Legal and compliance approvals documented.
- `/health` monitoring and dashboards operational.
- Runbook drill evidence documented.
- Ownership-boundary audit complete (no self-hosted SIP/media).
- All Critical tests pass with two consecutive full-suite runs plus regression.

