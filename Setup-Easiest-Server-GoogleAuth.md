# Easiest Server Setup (Google Auth + Telnyx)
Goal: fastest working production baseline

## 1) Create Supabase Project
1. Create a new Supabase project.
2. Enable Auth provider: Google.
3. In Google Cloud Console, create OAuth client for your web domain.
4. Add Google client ID/secret in Supabase Auth settings.
5. Add redirect URLs for dev/staging/prod web domains.

## 2) Create Database Schema
Create PRD tables:
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

## 3) Deploy Cloudflare Worker API
Create Worker endpoints:
- `POST /payments/checkout-session`
- `POST /webhooks/stripe`
- `POST /voice/token-verify`
- `POST /voice/rate-and-authorize`
- `POST /webhooks/telnyx/voice`
- `GET /health`

## 4) Configure Stripe
1. Create products/top-up amounts (or dynamic amounts).
2. Set webhook URL to Worker `/webhooks/stripe`.
3. Enable signature verification in Worker.
4. Add idempotency key handling in `payment_events`.

## 5) Configure Telnyx
1. Buy U.S. DID(s).
2. Create TeXML Bin scripts with `<Gather>`, `<Say>`, `<Dial timeLimit>`.
3. Assign DID to TeXML app.
4. Set TeXML action URLs to Worker endpoints:
- token verify endpoint
- rate/authorize endpoint
5. Set call lifecycle webhook to `/webhooks/telnyx/voice`.
6. Configure Outbound Voice Profile:
- `whitelisted_destinations` (Afghanistan only at launch),
- `max_destination_rate`,
- `daily_spend_limit`.

## 6) Configure Redis Throttling
- Store token attempt counters by ANI and account.
- Enforce cooldown and lockout policy.

## 7) Required Environment Variables
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_ANON_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `TELNYX_API_KEY`
- `TELNYX_WEBHOOK_PUBLIC_KEY` (or required signature material)
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
- `MIN_CONNECT_SECONDS`
- `SAFETY_BUFFER_SECONDS`

## 8) Launch Validation
- Run all `Critical` tests in `PRD-outcome-tests.md`.
- Confirm Google signup works for new users.
- Confirm call cutoff and settlement idempotency.
- Confirm Iran remains blocked in auth policy.
