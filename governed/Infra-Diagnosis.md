# Infrastructure Diagnosis (Fax Reuse Audit)
Date: 2026-03-22

## Goal
Determine which credentials and server context from prior Fax/Telnyx projects can be reused to launch Phonecard on primitive architecture.

## Findings
- Fax project (`/Users/alex/Documents/Projects/Fax`) contains templates and examples, not live cloud deployment credentials.
- Telnyx project (`/Users/alex/Documents/Projects/Telnyx/.env`) contains values for:
- `TELNYX_API_KEY` (present but malformed/placeholder; API rejects with Telnyx error `10009`).
- `TELNYX_CONNECTION_ID` (present).
- `TELNYX_FROM_NUMBER` (present).
- Cloudflare access is available on this machine (`wrangler whoami` successful; account visible).
- Render API/CLI access is not available (`render` CLI missing; no `RENDER_API_KEY` found in env files).
- Supabase and Stripe production secrets for Phonecard are not present in local env files.
- Existing Render service from fax project is reachable: `https://telnyx-fax-webhook.onrender.com/api/health`.

## Provisioning Blockers
- Missing valid Telnyx API key for voice provisioning.
- Missing Render API key + workspace owner ID.
- Missing Supabase project credentials (URL, JWKS/issuer, anon/service keys).
- Missing Stripe key pair and webhook secret.
- Missing Google OAuth credentials for Phonecard domain.

## Reusable Assets
- Cloudflare authenticated runtime and account access.
- Existing Render operational pattern (`onrender.com` service, health path, Cloudflare fronting).
- Existing primitive/governed process and test suites in this repo.
