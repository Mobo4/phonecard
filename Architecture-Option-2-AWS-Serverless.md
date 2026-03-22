# Architecture Option 2: AWS Serverless + Telnyx
Version: cold design v1

## 1) Stack
- Telephony: Telnyx Mission Control + TeXML Bin + Outbound Voice Profile.
- Web app: Next.js on AWS Amplify.
- API: API Gateway + Lambda.
- DB: Amazon RDS Postgres (or Aurora PostgreSQL Serverless v2).
- Cache/Rate-limit: ElastiCache Redis.
- Queue/Jobs: SQS + EventBridge Scheduler.
- Payments: Stripe Checkout + Webhooks.
- Observability: CloudWatch + X-Ray + Sentry.
- Secrets: AWS Secrets Manager + KMS.

## 2) Why This Option
- Strong enterprise security controls.
- Single primary cloud for API/data/monitoring.
- Clear path for compliance-heavy operation and scale.

## 3) Component Responsibilities
- Lambda `tokenVerify`:
- token auth, cooldown, fraud checks, compliance block checks.
- Lambda `rateAuthorize`:
- longest-prefix pricing lookup, credit math, call auth response.
- Lambda `stripeWebhookHandler`:
- signature validation, credit ledger insertion, payment event dedupe.
- Lambda `telnyxWebhookHandler`:
- call lifecycle ingest, final debit settlement, pending-state handling.
- Lambda `reconcilePendingSettlements`:
- retries, external event lookups, closure of stale pending sessions.

## 4) Request Flow
1. User creates Stripe Checkout session.
2. Stripe webhook credits wallet immutably.
3. Telnyx TeXML flow calls `tokenVerify`.
4. Telnyx TeXML flow calls `rateAuthorize`.
5. Telnyx announces estimate and dials with `timeLimit`.
6. Telnyx completion webhook triggers settlement.
7. Scheduler + queue reconciles missed/delayed events.

## 5) Data Model
- Same canonical PRD tables with strict FKs.
- Additional operational tables:
- `idempotency_registry`
- `job_runs`
- `alert_events`

## 6) Security Controls
- KMS-encrypted secrets and DB storage.
- VPC-only Lambda to DB/Redis.
- WAF + API authn/authz for protected endpoints.
- Audit logging for admin actions and compliance state transitions.

## 7) Reliability Model
- DLQs on webhook/event queues.
- Lambda retries with exponential backoff.
- EventBridge schedule every minute for reconciliation.
- CloudWatch alarms on:
- auth failure rates,
- webhook signature failures,
- pending settlement age > 10 minutes.

## 8) Risks
- Higher setup and cloud complexity than edge-first option.
- Higher baseline cost than Cloudflare/Supabase.
- Longer time to first production if team is not AWS-native.

## 9) Best Fit
- Production-focused launch with stronger governance and predictable scale path.
