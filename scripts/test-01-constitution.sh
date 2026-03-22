#!/usr/bin/env bash
set -euo pipefail
total=0
fail=0

check() {
  total=$((total + 1))
  if ! eval "$1"; then
    fail=$((fail + 1))
  fi
}

check "[ -f data/playbook.md ]"
check "grep -q '^# Constitution' data/playbook.md"
check "grep -q 'Article 1' data/playbook.md"
check "grep -q 'Article 2' data/playbook.md"
check "grep -q 'Article 3' data/playbook.md"
check "grep -q 'Article 4' data/playbook.md"
check "grep -q 'Article 5' data/playbook.md"
check "grep -q 'Article 6' data/playbook.md"
check "grep -q 'Article 7' data/playbook.md"
check "grep -q 'L1_HUMAN_ONLY' data/playbook.md"
check "grep -q 'Drafts only for external communications' data/playbook.md"

pass=$((total - fail))
echo "RESULTS: suite=test-01 total=$total pass=$pass fail=$fail"
if [ "$fail" -gt 0 ]; then exit 1; fi
