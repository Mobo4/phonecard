#!/usr/bin/env bash
set -euo pipefail
total=0
fail=0
check(){ total=$((total+1)); if ! eval "$1"; then fail=$((fail+1)); fi; }

f="governed/Traceability-Matrix.md"
check "[ -f \"$f\" ]"
check "grep -q 'FR-01' \"$f\""
check "grep -q 'FR-02' \"$f\""
check "grep -q 'FR-03' \"$f\""
check "grep -q 'FR-04' \"$f\""
check "grep -q 'FR-05' \"$f\""
check "grep -q 'FR-06' \"$f\""
check "grep -q 'ER-01' \"$f\""
check "grep -q 'ER-05' \"$f\""
check "grep -q 'C-02' \"$f\""
check "grep -q 'R-04' \"$f\""

pass=$((total-fail))
echo "RESULTS: suite=test-11 total=$total pass=$pass fail=$fail"
if [ "$fail" -gt 0 ]; then exit 1; fi

