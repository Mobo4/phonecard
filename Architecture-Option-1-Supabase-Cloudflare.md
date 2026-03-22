# Architecture Option 1: Supabase + Cloudflare + Telnyx
Version: cold design v1

## 1) Stack
- Telephony: Telnyx Mission Control + TeXML Bin + Outbound Voice Profile.
- Web app: Cloudflare Pages (or Vercel static export).
- API: Cloudflare Workers.
- DB/Auth: Supabase Postgres + Supabase Auth.
- Queue/Jobs: Cloudflare Queues + Cron Triggers.
- Cache/Rate-limit: Upstash Redis.
- Payments: Stripe Checkout + Webhooks.
- Observability: Logflare/Sentry + Supabase logs.

## 2) Why This Option
- Fastest low-ops path.
- No VM/server ownership.
- Very low baseline cost.
- Good fit for webhook-heavy, lightweight APIs.

## 3) Component Responsibilities
- Worker `voice-token-verify`:
- validates token hash, account state, cooldown, fraud flags.
- Worker `voice-rate-authorize`:
- normalizes destination, longest-prefix lookup, computes `max_call_seconds`, returns policy decision.
- Worker `stripe-webhook`:
- verifies signature, writes immutable wallet credit rows.
- Worker `telnyx-webhook`:
- verifies signature, writes call events, settles wallet idempotently.
- Cron `reconcile-pending-settlements`:
- resolves `pending_settlement` sessions under 15-minute SLO.

## 4) Request Flow
1. User tops up via web -> Stripe Checkout.
2. Stripe webhook posts credit to `wallet_ledger`.
3. Caller dials Telnyx DID.
4. TeXML `<Gather>` token -> Worker verify endpoint.
5. TeXML `<Gather>` destination -> Worker rate/authorize endpoint.
6. TeXML `<Say>` plays estimate.
7. TeXML `<Dial timeLimit>` connects call.
8. Telnyx completion webhook settles final debit.
9. Reconcile cron fixes delayed webhook sessions.

## 5) Data Model
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

## 6) Security Controls
- Token hashes with Argon2id or bcrypt.
- Stripe and Telnyx signed webhook verification.
- Idempotency key constraints on payment/call events.
- Per-ANI/account token attempt throttles via Redis.
- Least-privilege service-role keys with rotation playbook.

## 7) Reliability Model
- Multi-region edge execution for APIs.
- Retry queues for transient webhook failures.
- Reconcile job every 1 minute.
- Health checks + alerting on backlog age and error rates.

## 8) Risks
- Cloudflare Worker execution limits for heavier logic.
- Multi-vendor operational complexity (Cloudflare + Supabase + Upstash).
- Must design strong idempotency to avoid cross-system duplicate settlement.

## 9) Best Fit
- MVP and early scale (low-to-medium call volume) with speed priority.
