# Infra PRD C (Hybrid Reuse Existing Fax Runtime)

## Approach
- Reuse the existing Render deployment pattern and operational runbook from fax service.
- Stand up a dedicated Phonecard service in same workspace/account conventions.
- Share Cloudflare account and deployment guardrails.

## Primitive Mapping
- Same as current Phonecard primitives, isolated per app.
- No shared data plane with fax workload.

## Why C
- Lowest process risk for team familiar with current fax operations.
- Faster incident response due known hosting pattern.

## Risks
- Depends on access to existing Render workspace automation.
- Risk of cross-project credential confusion if not isolated cleanly.
