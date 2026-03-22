# Phonecard PRD v2 (Compliance-First)
Last updated: 2026-03-21 (America/Los_Angeles)

## 1) Product Intent
Provide resilient U.S.-origin PSTN calling to approved destinations when internet communication channels are unavailable.

## 2) Country Policy
- Launch country: Afghanistan only.
- Blocked country at launch: Iran.
- Iran activation requires:
- written sanctions counsel memo for this exact business model,
- written carrier/provider confirmation of permitted traffic class,
- internal compliance signoff.

## 3) Operating Model
- Telnyx is the telephony runtime (DID, IVR, bridge, disconnect timer).
- We only operate payment, token, wallet, pricing policy, and compliance checks.
- No self-hosted SIP/media stack.

## 4) Mandatory Controls
- C-01: Destination allow-list and prefix allow-list.
- C-02: SDN/sanctions screening process for counterparties and operational lists.
- C-03: Fraud controls (velocity, spend caps, abuse lockouts).
- C-04: Immutable ledger with compensating entries only.
- C-05: Webhook authenticity checks and event idempotency.
- C-06: Data retention and audit export policy for call and payment events.

## 5) Voice Flow Requirements
1. Gather token.
2. Validate token + account state.
3. Gather destination.
4. Validate destination policy and rate.
5. Announce rate + estimated minutes.
6. Confirm intent.
7. Connect with computed `timeLimit`.
8. On completion event, settle ledger and archive call record.

## 6) Pricing and Customer Disclosure
- Publish destination rates and update timestamp.
- IVR must disclose estimate wording before connect.
- Deny connect on any pricing ambiguity.
- Refund policy must define failed/short-call dispute handling.

## 7) Security Baseline
- Token hashes at rest; rotate token secrets.
- PII minimization in logs.
- Restricted admin actions with audit log.
- Signed webhook verification for both payment and telephony events.
- Least-privilege API keys and periodic rotation.

## 8) Reliability Baseline
- Settlement target: near-real-time on webhook success.
- Reconcile fallback: scheduled job to close pending sessions.
- Availability target:
- call auth path >= 99.9%
- payment webhook path >= 99.9%
- Recovery target:
- payment/call settlement backlog drained within 15 minutes.

## 9) Data Model
- `users`
- `auth_tokens`
- `wallet_ledger`
- `destination_rates`
- `call_sessions`
- `payment_events`
- `telnyx_events`
- `compliance_flags`
- `admin_audit_log`

## 10) Go/No-Go Checklist
- Telnyx destination enablement confirmed in writing.
- Level/verification requirements satisfied.
- Legal/compliance memo approved.
- Support runbook approved (refunds, disputes, abuse reports).
- Incident response playbook approved.
- Beta metrics dashboards operational.

## 11) Beta Success Criteria
- First-call success rate >= target.
- No negative-wallet incidents.
- No unreconciled sessions older than SLA.
- Chargeback rate within acceptable threshold.
- Support response SLA met.
