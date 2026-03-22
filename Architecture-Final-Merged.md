# Final Merged Architecture (Easiest Setup + Google Auth)
Version: v2
Status: canonical

## 1) Design Decision
Use the easiest production-capable setup:
- Telephony: Telnyx hosted runtime.
- Identity + DB: Supabase.
- API/Webhooks: Cloudflare Workers.
- Payments: Stripe.

Why:
- Fastest to launch.
- No VM/server management.
- Native Google signup support via Supabase Auth.

Agentic primitive rule:
- Keep services as tiny primitives with one responsibility.
- Compose primitives in sequence; do not create a monolith handler.

## 2) Final Stack
- Telnyx Mission Control + TeXML Bin + Outbound Voice Profile.
- Supabase Auth (Google OAuth) + Supabase Postgres.
- Render Web Service for API and webhook runtime.
- Cloudflare Workers for edge-compatible lightweight handlers where needed.
- Cloudflare Pages for web app hosting.
- Upstash Redis for token attempt throttling/cooldowns.
- Stripe Checkout and signed Stripe webhooks.
- Supabase/Cloudflare logs + Sentry for observability.

## 3) Ownership Boundary
- We own: Google-auth user onboarding, payments, token lifecycle, wallet ledger, destination policy, compliance/admin.
- Telnyx owns: DID routing, IVR flow execution, DTMF capture, call bridge, cutoff timer execution.
- No self-hosted SIP/media/call server.

## 4) Google Authentication Model
- Signup/login method: Google OAuth only for MVP.
- Supabase Auth is source of identity truth.
- `users` row links to Supabase `auth.users.id`.
- On first successful login:
- create wallet account,
- issue initial token/PIN,
- initialize compliance/fraud flags.
- Session handling uses Supabase JWTs; admin endpoints require role claim checks.

## 5) Services and Endpoints (Minimal)
- `POST /payments/checkout-session`
- `POST /webhooks/stripe`
- `POST /voice/token-verify`
- `POST /voice/rate-and-authorize`
- `POST /webhooks/telnyx/voice`
- `GET /health`

Primitive mapping:
- `Identity` -> Supabase Google Auth.
- `Credit` -> Stripe webhook + `wallet_ledger`.
- `Authz` -> `/voice/token-verify`.
- `Rating` -> `/voice/rate-and-authorize`.
- `Voice Execute` -> Telnyx TeXML flow.
- `Settle` -> `/webhooks/telnyx/voice`.
- `Reconcile` -> scheduled pending settlement resolver.
- `Audit` -> `telnyx_events` + `admin_audit_log` + ledger trail.

## 6) End-to-End Runtime Flow
1. User signs up with Google on web app (Supabase Auth).
2. User buys credit via Stripe Checkout.
3. Stripe webhook credits immutable wallet ledger.
4. User calls Telnyx DID.
5. Telnyx `<Gather>` sends token to `/voice/token-verify`.
6. Telnyx `<Gather>` sends destination to `/voice/rate-and-authorize`.
7. Worker returns `allow`, `rate`, `announced_minutes`, `max_call_seconds`.
8. Telnyx `<Say>` announces estimate.
9. Telnyx `<Dial timeLimit>` connects and enforces hard cutoff.
10. Telnyx completion webhook settles call debit.
11. Reconcile worker closes `pending_settlement` sessions.

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

Data rules:
- Ledger append-only.
- Corrections are compensating rows only.
- Idempotency key uniqueness for payment and call settlement.
- Foreign keys enforced for session/payment/event integrity.

## 8) Error Policies
- Wrong token: max 3 attempts, then terminate and cooldown.
- Invalid destination: one reprompt, then safe termination.
- Insufficient balance: deny dial-out, announce top-up path.
- Rating/auth uncertainty: fail closed (deny).
- Missed/delayed webhook: mark `pending_settlement`, retry, reconcile under SLA.

## 9) Security Model
- Google OAuth through Supabase only.
- Token hashing at rest (Argon2id or bcrypt).
- Stripe/Telnyx webhook signature verification required.
- Role-based authorization for admin endpoints.
- Per-ANI and per-account throttle in Redis.
- Secret rotation at least quarterly with audit evidence.
- PII minimization in logs.

## 10) Reliability and SLO
- Worker retry + queue strategy for transient webhook failures.
- Reconciliation job every minute.
- SLO target: call auth path >= 99.9%.
- SLO target: payment webhook processing >= 99.9%.
- SLO target: `pending_settlement` backlog cleared within 15 minutes.

## 11) Compliance Guardrails
- Afghanistan allow-list only at launch.
- Iran hard-block in policy engine.
- Iran enablement requires:
- written sanctions counsel approval,
- written Telnyx/provider approval,
- internal compliance signoff.
- Country policy changes require dual approval and `admin_audit_log` entry.

## 12) Launch Readiness
Architecture is approved only when:
- all `Critical` tests in `PRD-outcome-tests.md` pass,
- Google signup/login works end-to-end,
- no self-hosted SIP/media components exist,
- settlement backlog SLO is met in 7-day pilot.
- each primitive passes isolated contract tests.

## 13) Troubleshooting
- Primitive-local incident ownership with escalation.
- Webhook failures: verify signature, queue retry, inspect idempotency keys.
- Settlement backlog: inspect `pending_settlement`, run reconcile, verify ledger closure.
- Telnyx event delay: hold pending state and settle on delayed callback.
- Render runtime issue: fail closed and recover queued backlog.
- Cloudflare edge issue: rollback route/deploy and restore known-good path.
