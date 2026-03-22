#!/usr/bin/env bash
set -euo pipefail
total=0
fail=0
check(){ total=$((total+1)); if ! eval "$1"; then fail=$((fail+1)); fi; }

check "[ -f governed/Verification-Report.md ]"
check "[ -f SHARED-TASKS.md ]"
check "grep -q 'Initial failing run' governed/Verification-Report.md"
check "grep -q 'Pass run 1' governed/Verification-Report.md"
check "grep -q 'Pass run 2' governed/Verification-Report.md"
check "grep -q 'Regression run' governed/Verification-Report.md"
check "grep -q '122' governed/Verification-Report.md"
check "grep -q 'Governed PRD pipeline' SHARED-TASKS.md"
check "grep -q 'done' SHARED-TASKS.md"
check "grep -q 'cold review' SHARED-TASKS.md"
check "grep -q 'updated' SHARED-TASKS.md"

pass=$((total-fail))
echo "RESULTS: suite=test-12 total=$total pass=$pass fail=$fail"
if [ "$fail" -gt 0 ]; then exit 1; fi

