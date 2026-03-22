# Infra PRD B (Cloudflare-First)

## Approach
- Cloudflare Workers hosts API control plane.
- Cloudflare D1 + KV for persistence.
- Telnyx remains hosted voice runtime.
- Render removed from critical path.

## Primitive Mapping
- `Identity/Credit/Authz/Rating/Settle/Reconcile/Audit`: Workers + D1.
- `VoiceExecute`: Telnyx TeXML.

## Why B
- Existing Cloudflare auth is available now.
- Potential lower ops overhead for small traffic.

## Risks
- Requires larger app refactor from Node/Express backend.
- D1/KV migration complexity from current Postgres+Redis adapter.
