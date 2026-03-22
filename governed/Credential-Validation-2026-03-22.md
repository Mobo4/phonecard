# Credential Validation Report
Date: 2026-03-22

## Validated as Working
- Render API key: authenticated, workspace enumerated.
- Render owner/workspace ID resolved: `tea-csp65ortq21c73eau3n0`.
- Telnyx API keys (both provided) authenticated successfully.
- Stripe live secret key authenticated successfully (`/v1/account` returned active account).
- Cloudflare API key + email authenticated successfully (zones list returned active zones).

## Not Working / Blocked
- Supabase project URL provided does not resolve in DNS (`hhstopwvenlkhsqignrn.supabase.com` and `.co` both unresolved).
- Local Supabase endpoint provided (`host.docker.internal:8000`) is not reachable from this host.

## Live Provisioning Completed
- Render Postgres created (`phonecard-db`, free plan, Oregon).
- Render Key Value created (`phonecard-kv`, free plan, Oregon).
- Telnyx TeXML application created (`phonecard-texml-staging`).

## Live Provisioning Pending
- Render web service creation for Phonecard app (requires source repo URL for this project).
- Telnyx number assignment to Phonecard TeXML app (deferred to avoid disrupting current fax number mapping).
- Cloudflare DNS record creation for final Phonecard host (requires chosen zone + hostname target).
