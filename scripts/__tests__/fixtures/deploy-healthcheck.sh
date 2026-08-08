#!/usr/bin/env bash
# Golden copy of the 'Wait for health check' step in .github/workflows/deploy.yml
# (smoke test do Docker build). Source of truth: the run block is extracted via
# js-yaml at test time — the divergence test in
# scripts/__tests__/workflow-healthcheck-golden.test.ts FAILS if the workflow's
# program and this copy ever differ, so an edit to either MUST be mirrored in
# the other. The behavioral test runs BOTH programs with curl/sleep/seq shims
# and asserts identical exit codes.

for i in $(seq 1 20); do
  sleep 3
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/health 2>/dev/null || echo "000")
  if [ "$HTTP_CODE" = "200" ]; then
    echo "Health check passed (HTTP $HTTP_CODE) after ${i}s"
    exit 0
  fi
  echo "Attempt $i/20 - HTTP $HTTP_CODE"
done
echo "Health check failed after 20 attempts"
exit 1
