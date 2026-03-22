#!/usr/bin/env bash
set -euo pipefail
total=0
fail=0
check(){ total=$((total+1)); if ! eval "$1"; then fail=$((fail+1)); fi; }

f="PRD-outcome-tests.md"
check "[ -f \"$f\" ]"
check "grep -q 'Coverage Traceability Matrix' \"$f\""
check "grep -q 'Critical' \"$f\""
check "grep -q 'High' \"$f\""
check "grep -q 'F-01' \"$f\""
check "grep -q 'B-05' \"$f\""
check "grep -q 'E-05' \"$f\""
check "grep -q 'A-05' \"$f\""
check "grep -q 'S-01' \"$f\""
check "grep -q 'R-04' \"$f\""
check "grep -q 'L-01' \"$f\""

pass=$((total-fail))
echo "RESULTS: suite=test-10 total=$total pass=$pass fail=$fail"
if [ "$fail" -gt 0 ]; then exit 1; fi

