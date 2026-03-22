# Infra PRD Synthesized (Governed, Primitive, Simple)
Date: 2026-03-22

## 1) Constitutional Check
- Article 1: fail-closed for auth/rating/compliance.
- Article 2: primitive single-responsibility kept intact.
- Article 4: all infra changes must be verifiable via API checks and tests.
- Article 7: settlement correctness and reconcile SLA remain launch gates.

## 2) Selected Architecture
- Base on PRD A + best controls from C.
- Render: API web service + managed Postgres + Key Value.
- Cloudflare: DNS, proxy, WAF, optional rate limiting.
- Supabase: Google auth + JWT issuer/JWKS.
- Stripe: credit purchase and webhook settlement crediting.
- Telnyx: hosted TeXML voice runtime, number assignment, call control callbacks.

## 3) Primitive Responsibilities
- `Identity`: Supabase bearer validation, user bootstrap.
- `Credit`: Stripe checkout + signed webhook credit posts.
- `Authz`: PIN/token verification + lockout.
- `Rating`: longest-prefix pricing and balance time budget.
- `VoiceExecute`: Telnyx TeXML `<Say>` + `<Dial timeLimit>`.
- `Settle`: idempotent hangup settlement.
- `Reconcile`: pending settle replay.
- `Audit`: admin rate updates + security and billing events.

## 4) Provisioning Requirements (Must-Have Inputs)
- Render:
- `RENDER_API_KEY`
- `RENDER_OWNER_ID`
- `RENDER_REGION` (default acceptable if omitted)
- Telnyx:
- `TELNYX_API_KEY` (valid, not placeholder)
- Existing voice number(s) or budget and area code for purchase
- Stripe:
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- Supabase:
- `SUPABASE_URL`
- `SUPABASE_JWKS_URL` and issuer/audience settings
- Google OAuth:
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- Runtime:
- production domain/subdomain to attach in Cloudflare

## 5) API-Driven Provision Sequence
1. Render API create Postgres (`POST /v1/postgres`).
2. Render API create Key Value (`POST /v1/key-value`).
3. Render API create web service (`POST /v1/services`).
4. Render API set service env vars (`POST /v1/services/{serviceId}/env-vars`).
5. Telnyx API create/list TeXML app and attach voice URL.
6. Telnyx API assign number to TeXML/call control app.
7. Cloudflare API create DNS record to Render service domain.
8. Run Phonecard smoke tests + governed suites.

## 6) Fail-Closed and Guardrails
- No call connect when rating/auth uncertain.
- Country block policy enforced in rating primitive.
- Webhook signatures mandatory (Stripe + Telnyx).
- Admin rate changes require admin role and write audit trail.

## 7) Exit Criteria
- All app tests pass.
- 12 governed suites pass twice consecutively.
- Persistent smoke pass (DB+KV).
- TeXML connect flow verified (allow + deny + hard `timeLimit`).
