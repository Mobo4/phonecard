#!/usr/bin/env bash
set -euo pipefail
total=0
fail=0
check(){ total=$((total+1)); if ! eval "$1"; then fail=$((fail+1)); fi; }

f="governed/PRD-Synthesized.md"
check "[ -f \"$f\" ]"
check "grep -q '^# PRD Synthesized' \"$f\""
check "grep -q 'agentic primitive' \"$f\""
check "grep -qi 'render' \"$f\""
check "grep -qi 'cloudflare' \"$f\""
check "grep -q 'Google Authentication' \"$f\""
check "grep -q 'Telnyx' \"$f\""
check "grep -q 'Troubleshooting Model' \"$f\""
check "grep -q 'Operational Runbook' \"$f\""
check "grep -q 'Acceptance Criteria' \"$f\""
check "grep -q 'Launch Gates' \"$f\""

pass=$((total-fail))
echo "RESULTS: suite=test-06 total=$total pass=$pass fail=$fail"
if [ "$fail" -gt 0 ]; then exit 1; fi

