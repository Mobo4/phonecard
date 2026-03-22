#!/usr/bin/env bash
set -euo pipefail
total=0
fail=0
check(){ total=$((total+1)); if ! eval "$1"; then fail=$((fail+1)); fi; }

f="governed/PRD-C.md"
check "[ -f \"$f\" ]"
check "grep -q '^# PRD C' \"$f\""
check "grep -q 'agentic primitive' \"$f\""
check "grep -qi 'render' \"$f\""
check "grep -qi 'cloudflare' \"$f\""
check "grep -q 'Google Authentication' \"$f\""
check "grep -q 'Compliance' \"$f\""
check "grep -q 'SLO' \"$f\""
check "grep -q 'Error Handling' \"$f\""
check "grep -q 'Troubleshooting' \"$f\""
check "grep -q 'Rollout Plan' \"$f\""

pass=$((total-fail))
echo "RESULTS: suite=test-05 total=$total pass=$pass fail=$fail"
if [ "$fail" -gt 0 ]; then exit 1; fi

