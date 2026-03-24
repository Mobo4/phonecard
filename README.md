# Phonecard API (Render + Cloudflare + Telnyx)

Primitive-based backend for prepaid PSTN calling control.

## Primitives
- `Identity`: Google user bootstrap (via Supabase identity model)
- `Credit`: Stripe credit events
- `Authz`: token validation + lockout
- `Rating`: destination/cost authorization
- `VoiceExecute`: Telnyx-controlled IVR and hard cutoff
- `Settle`: idempotent call debit
- `Reconcile`: pending settlement recovery
- `Audit`: append-only ledger and event history

## Local Run
```bash
npm ci
npm run dev
```

## Test and Build
```bash
npm test
npm run build
```

## Endpoints
- `GET /health`
- `POST /identity/bootstrap`
- `POST /payments/checkout-session`
- `POST /admin/rates`
- `GET /admin/rates`
- `GET /admin/audit`
- `POST /webhooks/stripe`
- `POST /voice/token-verify`
- `POST /voice/rate-and-authorize`
- `POST /voice/texml/connect`
- `POST /voice/texml/dial-complete`
- `POST /webhooks/telnyx/voice`
- `POST /internal/reconcile`

## Auth Notes
- In production, checkout auth is enforced (`REQUIRE_CHECKOUT_AUTH=true`).
- `POST /payments/checkout-session` expects `Authorization: Bearer <supabase_jwt>`.
- User mismatch between JWT subject and payload user is denied.
- Admin routes require a bearer token with role `admin` (`403 admin_required` otherwise).

## Webhook Signature Notes
- Stripe and Telnyx signatures are validated against raw request body bytes.
- Do not re-stringify JSON payloads when generating signatures for tests/tools.

## Troubleshooting Quick Checks
- `401 TOKEN_INVALID` then `423 TOKEN_LOCKED` after retries: token brute-force controls are active.
- `401 invalid_signature` on webhook endpoints: signature secret/header mismatch.
- `403 USER_MISMATCH` on rate authorization: call session is bound to a different user than payload.
- `403 admin_required` on `/admin/*`: JWT verified but missing admin role claim.
- `403 COUNTRY_BLOCKED`: policy gate is active for a blocked prefix in `BLOCKED_COUNTRY_PREFIXES`.
- `402 INSUFFICIENT_BALANCE`: rating primitive denied pre-connect.
- `pending=true` on Telnyx webhook: run `/internal/reconcile` after missing-order events.

## TeXML Connect Path
- `POST /voice/texml/connect` supports both API JSON payloads and live Telnyx form callbacks.
- Live flow: PIN gather -> token verify -> destination gather -> rate authorize -> `<Say>` minutes -> `<Dial timeLimit="...">`.
- `<Dial action="/voice/texml/dial-complete">` callback settles usage when the bridged call ends.
- Denied call: `<Say>` reason prompt + `<Hangup/>`.

## Deployment
- Render blueprint file: `render.yaml`
- Put Cloudflare in front for DNS/WAF/route controls.
- Keep Telnyx as hosted telephony runtime (`<Gather>`, `<Say>`, `<Dial timeLimit>`).

## State Backend Selection
- If `DATABASE_URL` and `REDIS_URL` are set, server uses the persistent `PostgresRedisState`.
- Otherwise it falls back to in-memory state (safe for local testing only).
- Default retail margin is `115%` over configured/fallback wholesale rates (`RATE_MARGIN_PERCENT`, default `115`).
- Iran mobile (`+989`) is rated higher than Iran non-mobile (`+98`) in fallback rates.
- Store provider base rates in `destination_rates`; retail is computed as `base_rate * (1 + RATE_MARGIN_PERCENT/100)`.

## Live Persistent Smoke Pass
```bash
export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"
export DATABASE_URL="postgresql://<user>@localhost:5432/phonecard"
export REDIS_URL="redis://127.0.0.1:6379"
npm run smoke:persistent
```

## API Provisioning (Governed Infra)
```bash
scripts/provision/preflight.sh
scripts/provision/render-provision.sh
scripts/provision/telnyx-provision.sh
scripts/provision/cloudflare-provision.sh
```

Or run full sequence:
```bash
scripts/provision/run-all.sh
```

Required env vars are enforced by preflight (Render, Telnyx, Supabase, Stripe, Google OAuth, Cloudflare).
