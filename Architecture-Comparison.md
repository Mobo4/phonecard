# Architecture Comparison (Cold)
Compared options:
- Option 1: Supabase + Cloudflare + Telnyx
- Option 2: AWS Serverless + Telnyx
- Option 3: GCP + Firebase + Telnyx

## 1) Weighted Criteria
| Criterion | Weight | O1 | O2 | O3 |
|---|---:|---:|---:|---:|
| Time to MVP | 25 | 9 | 7 | 8 |
| Operational Simplicity | 20 | 7 | 8 | 7 |
| Security/Compliance Posture | 20 | 7 | 9 | 8 |
| Reliability/SLO Path | 15 | 8 | 9 | 8 |
| Cost Efficiency (early stage) | 10 | 9 | 6 | 7 |
| Scale Path (mid/long term) | 10 | 7 | 9 | 8 |
| **Weighted Score** | 100 | **8.0** | **8.1** | **7.8** |

## 2) Summary
- Option 1 wins speed and cost.
- Option 2 wins governance, reliability controls, and long-term scale.
- Option 3 is balanced but not best-in-class on your current priorities.

## 3) Recommendation
Use a merged architecture with:
- Option 1 speed patterns for MVP developer velocity.
- Option 2 governance and reliability patterns as non-negotiables.
- Option 3 event/reconcile discipline for webhook robustness.

## 4) Non-Negotiables Across All Options
- Telnyx-hosted voice runtime only (TeXML Bin + TeXML app).
- No self-hosted SIP/media/call servers.
- Hard call cutoff via `<Dial timeLimit>`.
- Fail-closed auth/rating.
- Idempotent settlement and fallback reconciliation.
- Afghanistan-only launch gate; Iran blocked until approvals.
