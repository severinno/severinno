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

## Fragile-range exclusion (the 2026-08 em-dash bug class)

The fragile character-class RANGE scan (`scripts/fragile-range-patterns.mjs`,
wired as verify-encoding.sh layer 3 AND imported by the vitest guard
`fragile-range-guard.test.ts`) deliberately does NOT audit every file in the
repo. This section is the frozen, baseline-readable record of WHAT is
excluded and WHY - the canonical in-code copy is the DECISION RECORD block
in the module; this is its mirror so the decision survives outside test code.

**The 2026-08 bug.** An em-dash slipped into `scripts/health-check.sh`
because the encoding gate used `grep -n '[^ -~]'` - a locale-dependent
character-class RANGE that fails SILENTLY (no hits, non-zero confidence).
The fix was `scripts/scan-non-ascii.mjs` (raw byte iteration, no pattern to
break). But the fragile-range CLASS can reintroduce itself through any
future gate, so the module hunts that class across executable code.

**What IS scanned** (`scanExecutableCode`):
- gate files: `scripts/*` (sh/mjs/ts/py/ps1), root `*.sh`, `.husky` hooks,
  `.github/workflows/*.yml`, `.github/actions/**/action.yml`, non-test
  helpers in `scripts/__tests__` (e.g. `golden-copy-utils.ts`);
- `TARGET_DIRS` trees: `e2e/`, `src/`, `mini-services/`, `.zscripts/`.

**What is NOT scanned BY DESIGN** (decision 2026-08):
- extensions: `.md`, `.css`, `.html` - not in `TARGET_EXTS`, so `filesInDir`
  never even enumerates them;
- trees (`EXCLUDED_TREES`): `docs`, `public`, `examples`, `config`, `prisma`,
  `db`, `download`, `upload`, `osrm-data`, `agent-ctx`, `.opencode`,
  `tool-results`, `secrets`, `.agents` - never `TARGET_DIR` entries.

**Why.** The fragile-range class is about EXECUTABLE byte-detection logic - a
grep pattern in a gate that fails silently. The excluded trees hold
documentation prose (a scanned `.md` quoting the historical space-tilde
pattern would false-positive the repo's own history), static client content
(`public/`), samples (`examples/`), infra config/seed (`config/`, `prisma/`,
`db/`, `osrm-data/`), user content (`download/`, `upload/`), agent/tool prose
(`agent-ctx/`, `.opencode/`, `tool-results/`), secret templates (`secrets/`)
and the not-yet-existing `.agents/` (skills are markdown). None of them run
as gates on the VPS or in CI, so a range there cannot silently fail an
encoding check - scanning them would only manufacture false positives.

**The exclusion is TWO-LAYERED** (verified by the REVERSE MUTATION tests):
`docs/` is kept out by BOTH the TREE contract (not in `TARGET_DIRS`) AND the
EXTENSION contract (`.md` not in `TARGET_EXTS`). Injecting ONLY `docs/` into
`TARGET_DIRS` makes a dirty `.ts` inside `docs/` trip the scan but does NOT
trip a dirty `.md` (the extension filter still blocks it); only lifting BOTH
contracts together makes the `.md` trip. A future change that extends
`TARGET_EXTS` or `TARGET_DIRS` to cover any excluded extension or tree fails
the EXCLUSION CONTRACT and REVERSE MUTATION tests and forces an explicit
rethink.

## Who protects the docs? (encoding audit coverage)

Short answer: NO encoding gate audits the `docs/` tree or `.md`/`.css`/`.html`
files. They are consistently OUTSIDE the audited surface: the fragile-range
exclusion is a recorded 2026-08 decision (see the 'Fragile-range exclusion'
section above and the DECISION RECORD block in
`scripts/fragile-range-patterns.mjs`), and the UTF-8/ASCII gates have scopes
defined around source code and VPS-bound scripts that never included prose
extensions. This section is the canonical answer so the question never has
to be re-derived.

Coverage matrix (every gate and exactly what it audits):

| Gate | Scans | docs/ tree? | .md/.css/.html? |
|------|-------|:-----------:|:---------------:|
| `scripts/check-utf8.sh` (`check_utf8.py`) | valid UTF-8 for `.ts`/`.tsx` + `.sh` (`src/` + fixed dirs `scripts/`, `.github/workflows/`, `.zscripts/`) | no | no |
| `scripts/verify-ascii-proof.sh` | pure ASCII for `.sh` + `.husky` hooks (this baseline) | no | no |
| `scripts/fragile-range-patterns.mjs` | fragile character-class ranges in gate files + `TARGET_DIRS` (`e2e/`, `src/`, `mini-services/`, `.zscripts/`) | no | no (excluded by design - see the 'Fragile-range exclusion' section above) |
| `scripts/scan-non-ascii.mjs` | whatever file list it is GIVEN (raw bytes) - a generic scanner, not a tree walker; `--utf8` mode validates WELL-FORMEDNESS (corruption), not accent presence | only if explicitly passed | only if explicitly passed |
| `pr-check.yml` `docs-encoding` job (informational) | invalid UTF-8 in `git ls-files '*.md' '*.css' '*.html' '.github/workflows/*.yml' '.github/actions/*/action.yml'` via `scan-non-ascii.mjs --utf8 --report` - NON-BLOCKING (continue-on-error + exit 0), emits `::warning::` | no (only when a doc/YAML gate file is corrupt) | no (only when corrupt) |

So `docs/` and `.md`/`.css`/`.html` are outside every encoding GATE. Why
that is safe (and why extending a gate to them would be WRONG):

- The fragile-range exclusion is deliberate: WHY lives in the
  'Fragile-range exclusion' section above (canonical DECISION RECORD in
  `scripts/fragile-range-patterns.mjs`) - not re-stated here to avoid
  drift.
- Docs legitimately carry accents: 69 of the repo's 73 `.md` files have
  bytes >= 0x80 (Portuguese prose). An ASCII gate over `docs/` would FAIL
  the docs themselves, not protect them.
- The corruption class the gates exist to catch (Windows-1252 byte 0x97 in
  `.ts`/`.tsx`) cannot silently harm a `.md`: a corrupted byte in a doc
  renders as visible mojibake in GitHub, not a silent gate failure. Impact
  is cosmetic, not operational.

Current state (2026-08 snapshot): 73 `.md` files (4 ASCII-pure, 69 with
legit non-ASCII, 0 with INVALID UTF-8), 1 `.css`, 0 `.html` - the doc
surface is clean today.

INFORMATIONAL ALERT (not a gate, added 2026-08): the `docs-encoding` job in
pr-check.yml runs `git ls-files '*.md' '*.css' '*.html'
'.github/workflows/*.yml' '.github/actions/*/action.yml' | xargs node
scripts/scan-non-ascii.mjs --utf8 --report` with `continue-on-error: true`
and `exit 0`, converting a CORRUPTION (INVALID UTF-8) into a `::warning::`
annotation on the PR WITHOUT blocking and WITHOUT tripping on legit accents
(the `--utf8` mode validates well-formedness only - 69/73 .md have non-ASCII
and must stay green). Since 2026-08 the YAML GATE FILES are ALSO listed:
the fragile-range scan audits them for the RANGE class but no encoding gate
reached them (check-utf8 covers only .ts/.tsx/.sh; the ASCII proof would
false-fail their legit accents/em-dashes) - see 'Who protects .zscripts and
the YAML gate files?' below. This is the ONE informational contact CI has
with the docs + YAML gate surfaces; the exclusion design above is preserved
- docs are still never a blocking gate.

Ad-hoc audit (not wired into CI, by design - available on demand):

```bash
git ls-files '*.md' | xargs node scripts/scan-non-ascii.mjs --report
```

## Who protects .zscripts and the YAML gate files?

Same "who protects what" gap the fragile-range closure answered, now asked
for the ENCODING gates. Short answer: `.zscripts/*.sh` are protected for
VALID UTF-8 by `check-utf8.sh` (blocking, always-scanned fixed dir), and the
YAML gate files are protected for VALID UTF-8 by the `docs-encoding` job
(informational) - neither is in the STRICT ASCII proof, by design.

### .zscripts/*.sh (7 workspace-agent operational scripts)

- **ASCII proof: EXCLUDED BY DESIGN** (2026-08). Their banners are legit
  CJK (Chinese comments + emoji), not mojibake: they are local
  workspace-agent tooling (build/dev/start helpers), never scp'd to the
  VPS, and the 2026-08 lesson was the OPPOSITE failure - a broken gate
  transliterating legitimate characters. A strict ASCII gate would
  false-fail all 7 files on every run.
- **Encoding gate: `check-utf8.sh`** - since 2026-08 `.zscripts` is in the
  wrapper's ALWAYS-scanned fixed dirs (`src/` is overridable by a
  positional dir, but `scripts/`, `.github/workflows/` and `.zscripts/` are
  not). A corrupt byte (0x97 etc.) in an ops script fails the gate like any
  other `.sh`. Pinned by hermetic CONTRACT tests in `check-utf8.test.ts`
  (temp CWD with a dirty `.zscripts/*.sh` -> exit 1; legit CJK banner ->
  exit 0).

### YAML gate files (.github/workflows/*.yml + .github/actions/**/action.yml)

- **ASCII proof: EXCLUDED BY DESIGN.** They legitimately carry accents
  (workflow comments) and em-dashes (composite action descriptions) - a
  strict ASCII gate would false-fail them.
- **Range class: `fragile-range`** (verify-encoding.sh layer 3) - they ARE
  gate files, so the fragile character-class RANGE scan audits them
  (blocking).
- **Encoding gate: `docs-encoding` job (informational)** - since 2026-08
  the `--utf8` scan ALSO lists the YAML gate files (`git ls-files
  '.github/workflows/*.yml' '.github/actions/*/action.yml'`). `--utf8`
  validates well-formedness only: legit accents/em-dashes pass, raw 0x97
  corruption flags a `::warning::` - non-blocking, same design as the docs
  surface (a corrupt byte in a workflow comment is visible mojibake in the
  GitHub UI, not a silent operational failure).

### Why validity, not ASCII, for both?

The 2026-08 incident was a broken gate that transliterated legit characters.
Both trees carry legit non-ASCII by intent. The gates above catch the
CORRUPTION class (invalid UTF-8 / raw 0x97) without false-failing the
content - the same distinction the docs surface already uses.

### Why is the YAML scan informational while fragile-range is blocking?

The SAME YAML gate files get a BLOCKING fragile-range scan (layer 3, the
character-class RANGE bug class) and an INFORMATIONAL `--utf8` scan (the
encoding corruption class). Deliberate: the fragile-range class is a gate
that fails SILENTLY (a broken grep pattern slips past), so it must block.
Encoding corruption in a workflow/action YAML is loud and visible (the
GitHub Actions editor shows the parse error / mojibake) - it cannot
silently weaken a gate, so `::warning::` suffices and keeps the job from
ever turning a doc-adjacent corruption into a red step.

## Legit accent vs. corruption (the mojibake visual guide)

Not every byte >= 0x80 is the same problem. Two classes, and only ONE of
them is corruption:

| Class | What it is | Example bytes | Renders on GitHub as | Action |
|-------|------------|---------------|----------------------|--------|
| Legit non-ASCII | a valid UTF-8 multi-byte sequence (Portuguese prose) | `é` = `0xC3 0xA9`, `ã` = `0xC3 0xA3`, `—` = `0xE2 0x80 0x94` | the intended glyph (`é`, `ã`, `—`) | NEVER touch - this is 69 of the repo's 73 `.md` files |
| Corruption | a raw byte that is NOT valid UTF-8 | `0x97` alone (a Windows-1252 em dash pasted raw) | `�` (U+FFFD replacement char), a box, or nothing | FLAG - run the `docs-encoding` scan and fix the byte |

Visual rules of thumb on GitHub:

- **Rendered view**: if the character shows as `é`/`ã`/`ç`/`—`, it is legit -
  leave it alone. If it shows as `�` or as nonsense, it is corruption.
- **Raw/file view**: a legit accent is a clean two- or three-byte sequence
  (`C3 A9` for `é`). A lone `0x97` has no valid UTF-8 meaning - GitHub
  renders it as `�`.
- **Diff view**: a line that changed only because an editor re-saved the
  file as Windows-1252 shows `�` on the added side. A line whose `é` renders
  correctly is NOT a diff artifact to "fix".

NEVER "fix" an accent that renders correctly. The 2026-08 incident was the
OPPOSITE failure: a broken gate transliterated legitimate characters
thinking they were the bug. The corruption class this repo hunts is raw
invalid bytes (`0x97`), which the `--utf8` scan flags while legit accents
never trip it:

```bash
# Flags ONLY corruption (invalid UTF-8) - exactly what the docs-encoding job runs
git ls-files '*.md' '*.css' '*.html' | xargs node scripts/scan-non-ascii.mjs --utf8 --report
# Flags ALL non-ASCII (legit accents included) - informational distinction only
node scripts/scan-non-ascii.mjs --report <file>
```

Edge case: mojibake that is still valid UTF-8 (double-encoded, e.g. `Ã©`
rendered where `é` was intended) is NOT flagged by any scan - its bytes are
legal UTF-8, it just renders wrong. Same rule of thumb: if it renders as the
intended glyph, leave it; if it renders garbled or as `�`, investigate
before touching anything.

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
