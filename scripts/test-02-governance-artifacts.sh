#!/usr/bin/env bash
set -euo pipefail
total=0
fail=0
check(){ total=$((total+1)); if ! eval "$1"; then fail=$((fail+1)); fi; }

check "[ -f governed/Governance-Run.md ]"
check "[ -f governed/Diagnosis.md ]"
check "[ -f SHARED-TASKS.md ]"
check "grep -q 'Constitutional check' governed/Governance-Run.md"
check "grep -q 'Diagnose the current code state' governed/Governance-Run.md"
check "grep -q 'Write 3 independent PRDs' governed/Governance-Run.md"
check "grep -q 'Synthesize' governed/Governance-Run.md"
check "grep -q 'Cold-review' governed/Governance-Run.md"
check "grep -q 'Write tests before code' governed/Governance-Run.md"
check "grep -q 'run tests.*FAIL' governed/Governance-Run.md"
check "grep -q 'update SHARED-TASKS.md' governed/Governance-Run.md"

pass=$((total-fail))
echo "RESULTS: suite=test-02 total=$total pass=$pass fail=$fail"
if [ "$fail" -gt 0 ]; then exit 1; fi

