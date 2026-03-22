# Remaining Inputs for Go-Live
Date: 2026-03-22

## Required to Finish Provisioning
- Git repo URL containing this Phonecard codebase (Render API service creation requires repo).
- Correct Supabase project URL (provided URL currently not resolvable).
- Supabase JWT issuer/JWKS URL derived from that correct project URL.
- Cloudflare target hostname and zone to attach Phonecard service DNS.
- Decision on Telnyx number strategy:
- attach existing `+17148807060` to Phonecard (will interrupt fax routing), or
- purchase a separate voice number for Phonecard (recommended).

## Recommended Immediate Security Action
- Rotate secrets that were shared in plaintext and used during setup:
- Render API key
- Telnyx API keys
- Stripe live secret key
- Supabase service role key
- Google OAuth client secret
