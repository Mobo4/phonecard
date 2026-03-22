#!/usr/bin/env bash
set -euo pipefail
total=0
fail=0
check(){ total=$((total+1)); if ! eval "$1"; then fail=$((fail+1)); fi; }

f="governed/Troubleshooting-Runbook.md"
check "[ -f \"$f\" ]"
check "grep -q 'Incident 1' \"$f\""
check "grep -q 'Incident 2' \"$f\""
check "grep -q 'Incident 3' \"$f\""
check "grep -q 'Webhook failures' \"$f\""
check "grep -q 'Settlement backlog' \"$f\""
check "grep -q 'Token brute force' \"$f\""
check "grep -q 'Render outage' \"$f\""
check "grep -q 'Cloudflare Worker errors' \"$f\""
check "grep -q 'Telnyx event delay' \"$f\""
check "grep -q 'Escalation' \"$f\""

pass=$((total-fail))
echo "RESULTS: suite=test-09 total=$total pass=$pass fail=$fail"
if [ "$fail" -gt 0 ]; then exit 1; fi

