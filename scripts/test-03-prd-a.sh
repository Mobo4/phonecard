#!/usr/bin/env bash
set -euo pipefail
total=0
fail=0
check(){ total=$((total+1)); if ! eval "$1"; then fail=$((fail+1)); fi; }

f="governed/PRD-A.md"
check "[ -f \"$f\" ]"
check "grep -q '^# PRD A' \"$f\""
check "grep -q 'agentic primitive' \"$f\""
check "grep -qi 'render' \"$f\""
check "grep -qi 'cloudflare' \"$f\""
check "grep -q 'Google Authentication' \"$f\""
check "grep -q 'Call Flow' \"$f\""
check "grep -q 'Data Model' \"$f\""
check "grep -q 'Security Controls' \"$f\""
check "grep -q 'Troubleshooting' \"$f\""
check "grep -q 'Launch Gates' \"$f\""

pass=$((total-fail))
echo "RESULTS: suite=test-03 total=$total pass=$pass fail=$fail"
if [ "$fail" -gt 0 ]; then exit 1; fi

