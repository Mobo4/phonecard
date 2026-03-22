# PRD B: Cloudflare-First Runtime

## Summary
This approach uses agentic primitive components on Cloudflare Workers with Render as fallback runtime.

## Google Authentication
- Supabase Auth with Google OAuth and JWT sessions.

## Platform
- Cloudflare Workers for APIs.
- Render background worker for reconciliation fallback.
- Telnyx hosted voice flow.

## Payment and Ledger
- Stripe Checkout credits immutable ledger.
- Telnyx completion events post call debits idempotently.

## Webhook Strategy
- Signature validation, replay defense, and dead-letter retry queue.

## Observability
- Cloudflare logs, Sentry alerts, settlement backlog dashboards.

## Troubleshooting
- Deterministic incident triage by primitive ownership.

## Risks and Mitigations
- Edge/runtime split complexity mitigated with strict contracts.

