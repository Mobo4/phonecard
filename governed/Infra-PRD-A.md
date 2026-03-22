# Infra PRD A (Render-Centric, Fastest Path)

## Approach
- Render hosts API + worker runtime.
- Render managed Postgres + Key Value.
- Cloudflare provides DNS/WAF.
- Telnyx hosts voice runtime (TeXML + number mapping).

## Primitive Mapping
- `Identity`: Supabase JWT verification in Render API.
- `Credit`: Stripe webhook into Render API.
- `Authz/Rating`: Render API.
- `VoiceExecute`: Telnyx TeXML + `timeLimit`.
- `Settle/Reconcile/Audit`: Render API + Postgres.

## Why A
- Minimal infrastructure surface.
- Best troubleshooting simplicity.
- Closest to current codebase layout.

## Risks
- Requires Render API credentials and owner ID.
- Requires valid Telnyx voice-capable API key.
