#!/usr/bin/env bash
# Golden copy of the 'Prove budget gate blocks (zeroed budgets)' step in
# .github/workflows/ci.yml (job `budget`). Source of truth: the run block is
# extracted via js-yaml at test time — the divergence test in
# scripts/__tests__/workflow-prove-gate-golden.test.ts FAILS if the workflow's
# program and this copy ever differ, so an edit to either MUST be mirrored in
# the other. The behavioral test runs BOTH programs with a `node()` bash
# function mock (simulating check-js-budget's exit code + output per mode) and
# asserts identical exit codes on all 5 assert paths (exit0 / exit2 /
# no-total / no-real / ok).

set +e
out=$(node scripts/check-js-budget.mjs 2>&1)
code=$?
set -e
printf '%s\n' "$out" | tail -30
if [ "$code" -eq 0 ]; then
  echo "::error::Budget gate PASSED with zeroed budgets — the gate is not blocking!"
  exit 1
fi
if [ "$code" -eq 2 ]; then
  echo "::error::Budget gate failed with exit 2 (report not found) — proof inconclusive"
  exit 1
fi
if ! printf '%s\n' "$out" | grep -q "Total client bundle.*> budget 1 KB"; then
  echo "::error::Budget gate failed but not on the total-size check — proof inconclusive"
  exit 1
fi
if ! printf '%s\n' "$out" | grep -qE "real: /.* transfer.*> budget 1 KB"; then
  echo "::error::Budget gate failed but not on a real-transfer check — proof inconclusive"
  exit 1
fi
echo "✅ Gate proof OK: budget check exited $code with zeroed budgets (expected failure)"
