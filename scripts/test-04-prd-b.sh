#!/usr/bin/env bash
set -euo pipefail
total=0
fail=0
check(){ total=$((total+1)); if ! eval "$1"; then fail=$((fail+1)); fi; }

f="governed/PRD-B.md"
check "[ -f \"$f\" ]"
check "grep -q '^# PRD B' \"$f\""
check "grep -q 'agentic primitive' \"$f\""
check "grep -qi 'render' \"$f\""
check "grep -qi 'cloudflare' \"$f\""
check "grep -q 'Google Authentication' \"$f\""
check "grep -q 'Payment and Ledger' \"$f\""
check "grep -q 'Webhook Strategy' \"$f\""
check "grep -q 'Observability' \"$f\""
check "grep -q 'Troubleshooting' \"$f\""
check "grep -q 'Risks and Mitigations' \"$f\""

pass=$((total-fail))
echo "RESULTS: suite=test-04 total=$total pass=$pass fail=$fail"
if [ "$fail" -gt 0 ]; then exit 1; fi

