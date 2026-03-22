# PRD A: Render-First Runtime

## Summary
This approach uses agentic primitive services with Render as the runtime and Cloudflare as edge ingress.

## Google Authentication
- Supabase Auth with Google OAuth for signup and login.

## Platform
- Render Web Service for API and webhook handlers.
- Cloudflare for DNS, WAF, and edge routing.
- Telnyx for IVR and PSTN execution.

## Call Flow
- Token verify, destination rating, estimate announce, connect with cutoff.

## Data Model
- `users`, `auth_tokens`, `wallet_ledger`, `call_sessions`, `telnyx_events`.

## Security Controls
- webhook signatures, token hashing, fail-closed auth, idempotent settlement.

## Troubleshooting
- Runbook-first response for webhook failures and settlement backlog.

## Launch Gates
- Afghanistan enabled, Iran blocked, tests and SLOs passing.

