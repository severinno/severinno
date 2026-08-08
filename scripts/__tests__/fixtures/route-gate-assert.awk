# Golden copy of the Camada A route-gate assert awk program.
#
# Source of truth: the 'Assert Rotas blocks in bundle report' step in
# .github/workflows/release-deploy.yml (js-yaml-extracted at test time). This
# file is the versioned, reviewable reference of that logic — the divergence
# test in release-assert-route-gate.test.ts FAILS if the workflow's program
# and this copy ever differ, so an edit to either one MUST be mirrored in the
# other. The behavioral test also runs BOTH programs against the same fixture
# matrix and asserts identical exit codes.
#
# Run as: awk -v 'tag=### v0.4.3 ' -f route-gate-assert.awk docs/bundle-report.md
# (exit 0 = the tag's own Rotas block contains a | /busca | row).

/^## Rotas/ { in_routes = 1 }
in_routes && index($0, tag) == 1 { in_block = 1; next }
in_block && /^### / { in_block = 0 }
in_block && /^\| \/busca \|/ { found = 1 }
END { exit (found ? 0 : 1) }
