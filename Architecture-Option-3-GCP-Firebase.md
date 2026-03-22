# Architecture Option 3: GCP + Firebase + Telnyx
Version: cold design v1

## 1) Stack
- Telephony: Telnyx Mission Control + TeXML Bin + Outbound Voice Profile.
- Web app: Firebase Hosting (or Next.js on Cloud Run).
- API: Cloud Run services.
- DB: Cloud SQL PostgreSQL.
- Cache/Rate-limit: Memorystore Redis.
- Queue/Jobs: Pub/Sub + Cloud Tasks + Cloud Scheduler.
- Payments: Stripe Checkout + Webhooks.
- Observability: Cloud Logging + Error Reporting + Cloud Monitoring.
- Secrets: Secret Manager + CMEK.

## 2) Why This Option
- Very fast app delivery with managed services.
- Strong managed queue/scheduler tools.
- Good analytics and reporting integration.

## 3) Component Responsibilities
- Service `auth-service`:
- token verify, cooldown, fraud gating.
- Service `rating-service`:
- destination normalization, prefix match, credit/time calculation.
- Service `payment-service`:
- Stripe session and webhook crediting.
- Service `voice-event-service`:
- Telnyx event ingest, settlement, idempotency handling.
- Job `pending-settlement-reconciler`:
- closes pending sessions and raises alerts on SLA breach.

## 4) Request Flow
1. Web app creates Stripe checkout session.
2. Stripe webhook updates ledger via payment service.
3. Telnyx `<Gather>` token -> auth service.
4. Telnyx `<Gather>` destination -> rating service.
5. Telnyx `<Say>` estimate and `<Dial timeLimit>`.
6. Completion webhook -> voice-event service settlement.
7. Scheduler triggers reconcile job.

## 5) Data Model
- Canonical PRD tables.
- Additional operational tables:
- `webhook_receipts`
- `reconcile_attempts`
- `service_slo_snapshots`

## 6) Security Controls
- Service-to-service auth via IAM.
- Workload identity and least-privilege service accounts.
- Signature verification for Stripe/Telnyx webhooks.
- Sensitive field redaction in logs.

## 7) Reliability Model
- Cloud Tasks for retry-safe webhook processing.
- Dead-letter topics for failed event processing.
- 1-minute scheduled reconcile.
- SLO monitoring dashboards for auth availability and settlement latency.

## 8) Risks
- Team familiarity may be lower if current stack is AWS/Supabase-centric.
- Cloud Run cold starts require tuning for webhook latency.
- Multi-service coordination complexity.

## 9) Best Fit
- Product teams that want fast managed development with strong GCP operations.
