#!/usr/bin/env bash
set -euo pipefail
total=0
fail=0
check(){ total=$((total+1)); if ! eval "$1"; then fail=$((fail+1)); fi; }

f="Architecture-Final-Merged.md"
check "[ -f \"$f\" ]"
check "grep -q 'Render' \"$f\""
check "grep -q 'Cloudflare' \"$f\""
check "grep -q 'Google Auth' \"$f\""
check "grep -q 'Telnyx' \"$f\""
check "grep -q 'no self-hosted SIP/media' \"$f\""
check "grep -q 'Primitive mapping' \"$f\""
check "grep -q '/voice/token-verify' \"$f\""
check "grep -q '/voice/rate-and-authorize' \"$f\""
check "grep -q 'pending_settlement' \"$f\""
check "grep -q 'Troubleshooting' \"$f\""

pass=$((total-fail))
echo "RESULTS: suite=test-07 total=$total pass=$pass fail=$fail"
if [ "$fail" -gt 0 ]; then exit 1; fi

