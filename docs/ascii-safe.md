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

The machine-consumed surfaces are SINGLE-SOURCE-OF-TRUTH in
`scripts/encoding-surface.mjs` (the versioned encoding-surface manifest - the
same pattern as `fragile-range-patterns.mjs` `TARGET_DIRS`: export the
arrays, `--print-*` query modes, and every wrapper DERIVES its args from the
module). This table summarizes what each gate does; the canonical SURFACE
lists live in the manifest, not in this prose.

| Gate | Scans | docs/ tree? | .md/.css/.html? |
|------|-------|:-----------:|:---------------:|
| `scripts/check-utf8.sh` (`check_utf8.py`) | valid UTF-8 for `.ts`/`.tsx` + `.sh` (`src/` positional default + fixed dirs DERIVED from `encoding-surface.mjs --print-always-dirs`: `scripts/`, `.github/workflows/`, `.zscripts/`) | no | no |
| `scripts/verify-ascii-proof.sh` | pure ASCII for `.sh` + `.husky` hooks - VPS/OPS glob patterns DERIVED from `encoding-surface.mjs --print-vps-sh`/`--print-ops-sh` (this baseline) | no | no |
| `scripts/fragile-range-patterns.mjs` | fragile character-class ranges in gate files + `TARGET_DIRS` (`e2e/`, `src/`, `mini-services/`, `.zscripts/`) | no | no (excluded by design - see the 'Fragile-range exclusion' section above) |
| `scripts/verify-encoding.sh` layer 4 (blocking) | invalid UTF-8 in YAML gate files (`.github/workflows/*.yml` + `.github/actions/*/action.yml` - globs DERIVED from `encoding-surface.mjs --print-yaml-gate`) - BLOCKING: a corrupt byte breaks the workflow parse and silently stops CI | no | no |
| `scripts/scan-non-ascii.mjs` | whatever file list it is GIVEN (raw bytes) - a generic scanner, not a tree walker; `--utf8` mode validates WELL-FORMEDNESS (corruption), not accent presence | only if explicitly passed | only if explicitly passed |
| `pr-check.yml` `docs-encoding` job (informational) + local `scripts/check-docs-encoding.sh` | invalid UTF-8 in docs surface (`git ls-files` of `encoding-surface.mjs --print-docs` globs: `*.md`, `*.css`, `*.html`) via `scan-non-ascii.mjs --utf8 --report` - NON-BLOCKING (continue-on-error + exit 0), emits `::warning::` | no (only when a doc file is corrupt) | no (only when corrupt) |

> Related: this matrix covers only the ENCODING (Type A) side of the scan
> surfaces. The three-list taxonomy - code surface (Type A) vs runtime
> routes (Type B, the budget/LHCI lists) vs workflow trigger filters (Type
> C, the `paths:` blocks) - and the full who-scans-what matrix live in
> [`docs/scan-surfaces.md`](scan-surfaces.md). This section answers the
> encoding-specific "who protects the docs?" question; that file answers
> "who scans what, and why each fixed list is legitimate" across all three
> types.

So `docs/` and `.md`/`.css`/`.html` are outside every encoding GATE. Why
that is safe (and why extending a gate to them would be WRONG):

- The fragile-range exclusion is deliberate: WHY lives in the
  'Fragile-range exclusion' section above (canonical DECISION RECORD in
  `scripts/fragile-range-patterns.mjs`) - not re-stated here to avoid
  drift.
- Docs legitimately carry accents: 71 of the repo's 76 `.md` files have
  bytes >= 0x80 (Portuguese prose). An ASCII gate over `docs/` would FAIL
  the docs themselves, not protect them.
- The corruption class the gates exist to catch (Windows-1252 byte 0x97 in
  `.ts`/`.tsx`) cannot silently harm a `.md`: a corrupted byte in a doc
  renders as visible mojibake in GitHub, not a silent gate failure. Impact
  is cosmetic, not operational.

### The docs/ exclusion is TWO-LAYERED (tree x extension) - the 2x2 proof

The fragile-range exclusion of `docs/` rests on TWO independent contracts
(the TREE contract: `docs/` is not in `TARGET_DIRS`; the EXTENSION
contract: `.md`/`.css`/`.html` are not in `TARGET_EXTS`). Both directions of
the proof are enforced by tests - this table is the HOW it is verified (the
WHAT/WHY lives in the 'Fragile-range exclusion' section above, canonical in
`scripts/fragile-range-patterns.mjs`):

| | `.md`/`.css`/`.html` NOT in `TARGET_EXTS` (today) | `.md`/`.css`/`.html` IN `TARGET_EXTS` (hypothetical) |
|---|---|---|
| `docs/` NOT in `TARGET_DIRS` (today) | **CLEAN** - current state: the scan never enters the tree AND never enumerates the extensions | **CLEAN** - docs/ is never a target tree, so `scanExecutableCode` never enters it even with the extensions scanned |
| `docs/` IN `TARGET_DIRS` (hypothetical) | **CLEAN** - the extension filter still blocks the `.md`: `filesInDir` never even enumerates it | **TRIPS** - both contracts lifted: the dirty `.md` is found and the scan fails |

The three CLEAN cells are only trustworthy because the TRIP cell is proven:
each REVERSE MUTATION test lifts the contracts on a temp COPY of the module
(source-patched, re-executed as a real node process - an export-level mock
could never change the module-scope binding) and shows the SAME fixtures
trip the moment the contract is gone. The exclusion is a CONTRACT, not
fixture luck.

**Bidirectional proof - what each suite pins:**

- `EXCLUSION CONTRACT` (`fragile-range-guard.test.ts`) - the CLEAN
direction: a genuinely-dirty `.md` under `docs/` does NOT trip the
repo-wide `scanExecutableCode` (tree level); a dirty `.md`/`.css`/`.html`
is never enumerated by `filesInDir` (extension level); the check is
parametrized over every `EXCLUDED_TREES` entry. Plus the golden copy
(`golden-copy-utils.test.ts`) pins that the LIVE module declarations match
the versioned snapshot `fixtures/fragile-range-scope.txt` with a CLEAR DIFF
on drift (the reverse-mutation harness anchors are versioned, not
hardcoded).
- `REVERSE MUTATION` (module level, `fragile-range-guard.test.ts`) - the
CONTRACT direction: lifting ONLY the tree does not trip a `.md`; lifting
ONLY the extension does not trip either; lifting BOTH does - proving the
two layers are complementary, exactly as the DECISION RECORD documents.
- `REVERSE MUTATION` (wrapper level, `verify-encoding.test.ts` + the
`FRAGILE_MODULE` override) - the WIRING direction: `verify-encoding.sh`
layer 3 executed against a temp patched module copy (docs/ injected via
`FRAGILE_MODULE`, the module path override) exits 1 with `fragile-range:` -
the exclusion is enforced end-to-end through the single gate entry, not
just through the module API.

**Proof commands (run from the repo root):**

```bash
# 1. The exclusion holds today: EXCLUSION CONTRACT + module REVERSE MUTATION + repo-wide clean
NO_COLOR=1 npx vitest run scripts/__tests__/fragile-range-guard.test.ts --config vitest.config.unit.ts

# 2. The contract is WIRED: wrapper-level REVERSE MUTATION (FRAGILE_MODULE) + golden-copy divergence guard
NO_COLOR=1 npx vitest run scripts/__tests__/verify-encoding.test.ts scripts/__tests__/golden-copy-utils.test.ts --config vitest.config.unit.ts

# 3. The real gate agrees (layer 3 clean on the real repo)
bash scripts/verify-encoding.sh --ci src/
```

Any future change that extends `TARGET_EXTS` or `TARGET_DIRS` to cover an
excluded extension or tree FAILS the EXCLUSION CONTRACT + REVERSE MUTATION
tests AND the golden-copy divergence guard - forcing an explicit rethink
before the exclusion can silently narrow.

Current state (2026-08 snapshot): 76 `.md` files (5 ASCII-pure, 71 with
legit non-ASCII, 0 with INVALID UTF-8), 1 `.css`, 0 `.html` - the doc
surface is clean today. (`docs/scan-surfaces.md`, added 2026-08, is one of
the ASCII-pure five - it is deliberately accent-free.)

INFORMATIONAL ALERT (not a gate, added 2026-08): the `docs-encoding` job in
pr-check.yml runs `git ls-files '*.md' '*.css' '*.html' | xargs node
scripts/scan-non-ascii.mjs --utf8 --report` with `continue-on-error: true`
and `exit 0`, converting a CORRUPTION (INVALID UTF-8) into a `::warning::`
annotation on the PR WITHOUT blocking and WITHOUT tripping on legit accents
(the `--utf8` mode validates well-formedness only - 71/76 .md have non-ASCII
and must stay green). NOTE (2026-08): this job USED to also scan the YAML
gate files (`.github/workflows/*.yml` + `.github/actions/*/action.yml`)
informational - they moved OUT into verify-encoding.sh LAYER 4 as a
BLOCKING gate (a corrupt byte in a workflow YAML breaks the parse and
silently stops CI, so it must block - see 'Who protects .zscripts and the
YAML gate files?' below). This is the ONE informational contact CI has
with the docs surface; the exclusion design above is preserved - docs are
still never a blocking gate.

**SENTINEL PROOFS (how we know these gates really bite):** see
`docs/gates-proofs.md` — Prova 1 (utf8-byte, run 31298436074), Prova 2
(fragile-range, run 31306797327), Prova 3 (budget sentinel), Prova 4
(FRAGILE_SCAN_ROOT, run 31312427503), Prova 5 (`.zscripts` fixed-dir 0x97
sentinel, local) e Prova 6 (SPREAD CONTRACT live — 5º dir injetado no
`TARGET_DIRS` real, local) — cada uma segue o contrato injetar -> gate
falha (exit 1 com o path exato) -> reverter -> repo limpo.

**Local hook mirror (pre-commit + pre-push, added 2026-08):**
`bash scripts/check-docs-encoding.sh` — a dedicated script (NOT
`check-utf8.sh --ext md --ci`, which would scan 0 .md files — its default
surface is `src/` + fixed dirs only) that runs the SAME surface as the CI
job (`git ls-files '*.md' '*.css' '*.html'`) with SAME `--utf8 --report`
mode and SAME non-blocking semantics (exit 0 always). The script wraps
the Node scanner directly (`scan-non-ascii.mjs`), mirroring the CI's exact
command without involving `check-utf8.sh`, `check_utf8.py`, or any ASCII
gate. Custo medido < 1s (76 files, single node spawn).

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
- **Corruption class: `verify-encoding.sh` LAYER 4 (BLOCKING, since 2026-08)** - `scan-non-ascii.mjs --utf8 --report` over `git ls-files '.github/workflows/*.yml' '.github/actions/*/action.yml'`. Unlike the docs surface, this is a BLOCKING gate: a corrupt byte (0x97) in a workflow YAML BREAKS the parse entirely (js-yaml and PyYAML both throw "invalid start byte" - measured 2026-08), so the workflow silently fails to load and CI checks silently stop running. That is an OPERATIONAL failure, not the cosmetic mojibake a corrupt byte causes in a `.md`. `--utf8` validates well-formedness only: the legit accents/em-dashes 17/18 gate files carry today pass; only INVALID sequences block. The `docs-encoding` job was narrowed to docs-only (`.md/.css/.html`, informational) - the YAML gate files moved OUT of it into layer 4.

### Why validity, not ASCII, for both?

The 2026-08 incident was a broken gate that transliterated legit characters.
Both trees carry legit non-ASCII by intent. The gates above catch the
CORRUPTION class (invalid UTF-8 / raw 0x97) without false-failing the
content - the same distinction the docs surface already uses.

### Why is the YAML gate-file UTF-8 scan blocking while the docs scan is informational?

The SAME YAML gate files get a BLOCKING fragile-range scan (layer 3, the
character-class RANGE bug class) AND a BLOCKING `--utf8` scan (layer 4,
the encoding corruption class, since 2026-08). The docs surface
(`.md/.css/.html`) stays informational. This asymmetry is deliberate and
was MEASURED: a corrupt byte (0x97) in a workflow YAML BREAKS the parse
entirely - js-yaml and PyYAML both throw "invalid start byte" (probe run
2026-08) - so the workflow silently fails to load and CI checks silently
stop running. That is an OPERATIONAL failure that weakens the gates
themselves, not the cosmetic mojibake a corrupt byte causes in a `.md`
(which the GitHub UI renders visibly). Docs corruptioncan never silently weaken a gate; workflow corruption can - hence layer 4
BLOCKS. The old
"informational YAML scan" rationale (2016-08 text claiming workflow
corruption is "loud and visible") was disproven by the parse probes and
retired. SCOPE NOTE: layer 4 is the UTF-8 CORRUPTION gate specifically
(invalid sequences) - it is NOT a full YAML linter (a valid-UTF-8 control
character could still break parsing; that class is covered by GH's own
parse on push, not by this gate).

## Legit accent vs. corruption (the mojibake visual guide)

Not every byte >= 0x80 is the same problem. Two classes, and only ONE of
them is corruption:

| Class | What it is | Example bytes | Renders on GitHub as | Action |
|-------|------------|---------------|----------------------|--------|
| Legit non-ASCII | a valid UTF-8 multi-byte sequence (Portuguese prose) | `é` = `0xC3 0xA9`, `ã` = `0xC3 0xA3`, `—` = `0xE2 0x80 0x94` | the intended glyph (`é`, `ã`, `—`) | NEVER touch - this is 71 of the repo's 76 `.md` files |
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
scripts/check-docs-encoding.sh
scripts/check-health.sh
scripts/check-utf8.sh
scripts/dashboard.sh
scripts/deploy.sh
scripts/diagnose-completo.sh
scripts/diagnose-docker.sh
scripts/dlq-monitor.sh
scripts/docker-entrypoint.sh
scripts/entrypoint.sh
scripts/eslintd-shim.sh
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
