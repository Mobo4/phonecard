# Phonecard PRD v2 (Launch-Fast)
Last updated: 2026-03-21 (America/Los_Angeles)

## 1) Outcome
Launch a prepaid PSTN access-number service for U.S. callers to reach Afghanistan using Telnyx-hosted voice flows.

## 2) Ownership Boundary
- We own: payments, wallet ledger, token lifecycle, destination/risk policy, support/admin.
- Telnyx owns: DID, IVR runtime, DTMF capture, call bridge/media, call disconnect timer.
- No self-hosted SIP/media infrastructure.

## 3) MVP User Flow
1. User creates account and tops up wallet.
2. User receives account token/PIN.
3. User calls U.S. access number.
4. IVR gathers token and destination.
5. Token API verifies token + balance + destination policy.
6. IVR announces rate + estimated minutes.
7. User presses 1 to connect.
8. Dial executes with computed `timeLimit`.
9. Completion webhook settles wallet and writes CDR.

## 4) Hard Functional Requirements
- FR-01: Reject call if balance < minimum connect threshold.
- FR-02: Announce rate and estimated minutes before connect.
- FR-03: Enforce hard cutoff using `timeLimit` on outbound leg.
- FR-04: Wallet must never go negative in normal operation.
- FR-05: Failed webhook delivery must be recovered by reconciliation job.
- FR-06: Every call attempt must produce an auditable event trail.

## 5) Error and Retry Paths
- Wrong token: allow 3 tries, then terminate and cooldown.
- Invalid destination: explain format and reprompt once.
- Insufficient balance: announce top-up instruction and end.
- Rate lookup failure: fail closed (deny connect).
- Webhook delay/failure: mark call `pending_settlement`; retry + periodic reconcile.

## 6) Security Requirements
- Store token/PIN as salted hash (never plaintext).
- Enforce per-ANI and per-account rate limits.
- Verify Telnyx webhook signature using official scheme.
- Require Stripe webhook signature verification.
- Apply idempotency keys to all ledger mutations.

## 7) Rating and Balance Logic
- Destination rating key: longest-prefix match.
- Billing increment policy (MVP): 60-second conservative estimate.
- `raw_seconds = floor((balance_usd / rate_usd_per_min) * 60)`
- `max_call_seconds = max(0, raw_seconds - safety_buffer_seconds)`
- Connect only if `max_call_seconds >= MIN_CONNECT_SECONDS`.
- Announced minutes are estimates; disclose in IVR text.

## 8) Telnyx Setup
1. Purchase U.S. DID(s).
2. Create TeXML Bin scripts and TeXML app in Mission Control.
3. Assign DID(s) to TeXML app.
4. Configure `<Gather>`, `<Say>`, `<Dial timeLimit>`.
5. Create Outbound Voice Profile with:
- `whitelisted_destinations`
- `max_destination_rate`
- `daily_spend_limit`
6. Enable call lifecycle webhooks.

## 9) Data Model (Minimal)
- `users`
- `wallet_ledger`
- `auth_tokens`
- `destination_rates`
- `call_sessions`
- `telnyx_events`
- `fraud_flags`

## 10) Acceptance Tests
- T-01: User with enough balance hears estimate and connects.
- T-02: User with low balance is blocked pre-connect.
- T-03: Active call disconnects exactly at computed cutoff window.
- T-04: Duplicate webhook does not double-charge ledger.
- T-05: Missed webhook is corrected by reconciliation job.

## 11) Launch Gates
- Afghanistan destination enabled on account.
- Telnyx verification level satisfies destination requirements.
- Legal approval complete for sanctions/compliance scope.
- Iran remains blocked until explicit written legal + carrier approval.
