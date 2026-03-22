# PRD C: Compliance-Hardened Hybrid

## Summary
This approach keeps agentic primitive isolation while prioritizing policy controls and audit depth.

## Google Authentication
- Google OAuth via Supabase with role claims for admin actions.

## Platform
- Render API services.
- Cloudflare front door and protections.
- Telnyx hosted PSTN call runtime.

## Compliance
- Afghanistan allow-list at launch.
- Iran blocked until all required approvals exist.

## SLO
- 99.9% auth availability, 99.9% payment webhook processing, 15-minute settlement backlog SLA.

## Error Handling
- 3 token retries, one destination reprompt, fail-closed rating, reconciliation fallback.

## Troubleshooting
- Incident-first runbooks with escalation thresholds.

## Rollout Plan
- staged release, pilot monitoring, and launch gates.

