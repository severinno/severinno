#!/usr/bin/env bash
# Golden copy of the deploy health-check LOOP inside the 'Deploy via SSH' step
# of .github/workflows/release-deploy.yml (appleboy/ssh-action script). Source
# of truth: the script is extracted via js-yaml + regex at test time — the
# divergence test in scripts/__tests__/workflow-healthcheck-golden.test.ts
# FAILS if the workflow's loop and this copy ever differ. The behavioral test
# runs BOTH programs with curl/sleep/seq/docker shims and asserts identical
# exit codes.

for i in $(seq 1 12); do
  sleep 5
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/health)
  if [ "$HTTP_CODE" = "200" ]; then
    echo "Health check passed (HTTP $HTTP_CODE)"
    docker image prune -f
    exit 0
  fi
  echo "Attempt $i/12 - HTTP $HTTP_CODE, retrying..."
done

echo "Health check failed after 12 attempts"
exit 1
