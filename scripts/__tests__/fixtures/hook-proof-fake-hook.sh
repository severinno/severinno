#!/usr/bin/env bash
# hook-proof-fake-hook.sh - fake hook for hook-proof-run.test.ts (hermetic).
#
# The hook-proof-run CLI spawns `bash <hook>` with the refs payload on stdin
# (the push simulation). This fixture reads the payload (discards it - the
# real hook parses it, the fixture only proves the wiring) and echoes a
# SCRIPTED output + exit code via env (set by the test, inherited through the
# CLI's spawnSync env passthrough):
#   HOOK_PROOF_FAKE_HOOK_OUTPUT  the stdout to emit (default "fake hook out").
#   HOOK_PROOF_FAKE_HOOK_EXIT    the exit code (default 0).
# ASCII puro (fixture - fora dos gate .sh globs de top-level, mas mantem o
# padrao). Puro bash, sem deps.
set -u

# Read (and discard) the refs payload from stdin.
cat >/dev/null

printf '%s\n' "${HOOK_PROOF_FAKE_HOOK_OUTPUT:-fake hook out}"
exit "${HOOK_PROOF_FAKE_HOOK_EXIT:-0}"
