#!/usr/bin/env bash
set -euo pipefail
total=0
fail=0
check(){ total=$((total+1)); if ! eval "$1"; then fail=$((fail+1)); fi; }

f="governed/PRD-Synthesized.md"
check "[ -f \"$f\" ]"
check "grep -qi 'hash' \"$f\""
check "grep -qi 'webhook signature' \"$f\""
check "grep -qi 'idempot' \"$f\""
check "grep -qi 'fail closed' \"$f\""
check "grep -qi 'Iran.*blocked' \"$f\""
check "grep -qi 'Afghanistan' \"$f\""
check "grep -qi 'dual approval' \"$f\""
check "grep -qi 'sanctions workflow' \"$f\""
check "grep -qi 'audit' \"$f\""
check "grep -qi 'least-privilege' \"$f\""

pass=$((total-fail))
echo "RESULTS: suite=test-08 total=$total pass=$pass fail=$fail"
if [ "$fail" -gt 0 ]; then exit 1; fi

