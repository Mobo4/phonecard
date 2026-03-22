# Troubleshooting Runbook

## Incident 1: Webhook failures
- Confirm signature validation path.
- Check replay/idempotency behavior.
- Queue retry safely and inspect error body.

## Incident 2: Settlement backlog
- Query pending sessions by age.
- Trigger reconcile pass.
- Verify ledger convergence and close sessions.

## Incident 3: Token brute force
- Inspect ANI/account attempt counters.
- Enforce cooldown and lock.
- Escalate fraud review if repeated.

## Render outage
- Enter fail-closed mode.
- Publish status notice.
- Recover from queued callbacks on restoration.

## Cloudflare Worker errors
- Roll back last deployment.
- Confirm edge route and WAF policy.
- Re-run synthetic auth checks.

## Telnyx event delay
- Keep session `pending_settlement`.
- Reconcile using delayed callback data.
- Validate final debit and audit chain.

## Escalation
- P1: compliance/billing correctness risk, immediate on-call and leadership.
- P2: prolonged auth/rating degradation.
- P3: non-critical presentation issue.

