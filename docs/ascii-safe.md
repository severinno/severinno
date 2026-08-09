# ASCII-Safe Baseline - Severinno

> Frozen 2026-08. This file is the single source of truth for the audited
> shell-script surface (VPS-bound + ops + hooks) and its encoding contract.
> `scripts/verify-ascii-proof.sh` compares its computed audit lists against
> the machine-parseable manifest below; the proof FAILS when the real audit
> surface drifts from it.
>
> SINGLE ENTRY: `scripts/verify-encoding.sh` is the consolidated encoding
> gate (UTF-8 validity + VPS ASCII + this proof + baseline + the fragile
> character-class RANGE scan — the 2026-08 em-dash bug class) that CI
> (utf8-check.yml) and the local hooks call as ONE step. The proof stays
> directly invokable for its focused audit and for `--sync` regeneration.
> The fragile-range scan is the SAME module the vitest guard imports
> (`scripts/fragile-range-patterns.mjs`), wired in so the class is blocked
> even when the gate runs without the vitest suite.

## Contract

Every file listed below MUST be pure ASCII (no byte >= 0x80):

- **VPS-bound** - `scripts/health-check.sh` (scp'd by the reusable
  health-check workflow) + the root `*.sh` supervisor scripts. These run over
  ssh on the VPS where the remote locale may not be UTF-8.
- **Ops** - the remaining `scripts/*.sh` + the `.husky` hooks (`pre-commit`,
  `pre-push`).

> Why there is NO separate "VPS-only" scan step: the `.husky` hooks are
> audited HERE, in the Ops section, under the SAME strict rule — there is no
> explicit step that scans only the VPS-bound set. The old always-on VPS gate
> (`health-check.sh` + root `*.sh`) and the `--ascii` opt-in scan were
> REMOVED from check-utf8.sh in 2026-08 as redundant: the proof audits a
> strict superset of both, hooks included (verify-ascii-proof.sh's Ops list
> is `scripts/*.sh` minus health-check.sh, plus `.husky/pre-commit` +
> `.husky/pre-push`). Both hooks are registered in the manifest below and
> pinned by the PROOF test in verify-ascii-proof.test.ts.

The 2026-08 transliteration removed the last accented banners, so the strict
rule applies repo-wide: there are NO accented-allowed entries anymore. The
manifest below is the complete frozen set.

## How drift is caught

`verify-ascii-proof.sh` fails when:

1. any listed file has a non-ASCII byte (the encoding check itself);
2. a NEW `.sh`/hook appears in the audit but is NOT registered in the
   manifest below - e.g. a new ops script with an accented banner would be
   flagged as unregistered AND as a violation until the baseline is updated;
3. a manifest entry disappears from the audit surface (file deleted or
   moved) without regenerating the baseline.

To register a change (new file added, file renamed, file removed), run:

```bash
bash scripts/verify-ascii-proof.sh --sync
```

(equivalent through the single entry: `bash scripts/verify-encoding.sh --sync`,
which forwards to the proof and skips the UTF-8 layer).

`--sync` rewrites ONLY the manifest block below from the actual tree
(preserving this prose) and prints the new file counts. Commit the updated
baseline together with the change that required it.

## Manifest (machine-parseable; regenerate with `--sync`, do not hand-edit)

<!-- ASCII-BASELINE:VPS -->
scripts/health-check.sh
keep-alive.sh
run-server.sh
start-server.sh
supervisor.sh
<!-- ASCII-BASELINE:OPS -->
scripts/backup-db.sh
scripts/check-health.sh
scripts/check-utf8.sh
scripts/dashboard.sh
scripts/deploy.sh
scripts/diagnose-completo.sh
scripts/diagnose-docker.sh
scripts/dlq-monitor.sh
scripts/docker-entrypoint.sh
scripts/entrypoint.sh
scripts/fail2ban-setup.sh
scripts/fix-encoding.sh
scripts/glitchtip-alerts.sh
scripts/glitchtip-setup.sh
scripts/keep-alive.sh
scripts/pgbouncer-stress-test.sh
scripts/pre-push-gates.sh
scripts/release.sh
scripts/restore-baseline.sh
scripts/restore-db.sh
scripts/run-fuzz.sh
scripts/setup-cron-push.sh
scripts/setup-osrm.sh
scripts/setup-secrets.sh
scripts/setup-vps.sh
scripts/setup.sh
scripts/test-e2e-a11y.sh
scripts/test-e2e-cache.sh
scripts/test-fail2ban-recidive.sh
scripts/test-security-headers.sh
scripts/verify-ascii-proof.sh
scripts/verify-encoding.sh
scripts/verify-hsts-preload.sh
.husky/pre-commit
.husky/pre-push
<!-- ASCII-BASELINE:END -->
