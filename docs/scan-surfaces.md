# Scan Surfaces - Severinno

> Frozen 2026-08. Answering "which routes/surfaces are audited?" requires
> knowing that the repo has THREE KINDS of fixed lists that a quick audit can
> confuse. This file is the canonical distinction so the next audit does not
> re-derive it:
>
> 1. **Code surface** - WHICH FILES does a gate SCAN (a contract);
> 2. **Runtime routes** - WHICH PAGES are performance-audited, and against
>    WHAT budget (a product decision);
> 3. **Trigger filters** - WHEN does a workflow RUN (CI economics, a hint).
>
> **Rule of thumb:** surfaces are CONTRACTS (single-source manifest +
> `--print-*` + test-pinned), routes are PRODUCT decisions (per-page budget,
> never derivable from the file tree), triggers are HINTS (over-narrow is
> safe - it only skips a run). Never unify the three; they answer different
> questions and fail in different ways.

## 1. The three list types

### Type A - Code surface (superficie de codigo)

Answers: **WHICH FILES does this gate scan?**

- Lives in versioned manifest modules with `--print-*` query modes; every
  consumer DERIVES its arguments from the manifest (never a second hardcoded
  copy - see the `encoding-surface.mjs` and `fragile-range-patterns.mjs`
  patterns).
- Drift is a CONTRACT failure: contract tests + golden copies pin the
  exports; a manually-edited second list is caught by the divergence guards.
- Canonical manifests:
  - `scripts/encoding-surface.mjs` - `ALWAYS_SCAN_DIRS`
    (`scripts/`, `.github/workflows/`, `.zscripts/`), `VPS_SH_PATTERNS`
    (`scripts/health-check.sh`, `*.sh`), `OPS_SH_PATTERNS` (`scripts/*.sh`,
    `.husky/pre-commit`, `.husky/pre-push`), `YAML_GATE_PATTERNS`
    (`.github/workflows/*.yml`, `.github/actions/*/action.yml`),
    `MJS_GATE_PATTERNS` (`scripts/*.mjs`), `DOCS_PATTERNS`
    (`*.md`, `*.css`, `*.html`).
  - `scripts/fragile-range-patterns.mjs` - `TARGET_DIRS` (`e2e/`, `src/`,
    `mini-services/`, `.zscripts/`), `TARGET_EXTS`, `EXCLUDED_TREES`
    (`docs`, `public`, `examples`, `config`, `prisma`, `db`, `download`,
    `upload`, `osrm-data`, `agent-ctx`, `.opencode`, `tool-results`,
    `secrets`, `.agents`).
  - Root executable tooling (2026-08 audit) ENTERS the fragile-range gate
    surface: `gateFiles()` scans every tracked root `*.sh`/`*.ts`/`*.mjs`/
    `*.ps1` tooling config plus `Makefile`/`Dockerfile` (next.config.ts,
    eslint.config.mjs, dev.ps1, test-prisma7.mjs, ...) - a fragile
    character-class range in any of them is the same silent-failure bug
    class as the 2026-08 em-dash in a gate script. Root `docker-compose*.yml`
    and `pnpm-*.yaml` stay OUT BY DESIGN (declared container/package data,
    not executable gate logic - the same class as the `config/`,
    `examples/`, `prisma/` tree exclusions). Frozen lists + the NO-ORPHAN
    contract: `scripts/__tests__/executable-surface.test.ts`.

### Type B - Runtime routes (rotas de runtime)

Answers: **WHICH PAGES are audited and against WHAT budget?**

- Lives in `scripts/budget-routes.mjs`: `REAL_ROUTE_CHECKS` (the 4 real
  routes with per-route `budgetKB` 320/270/280/320 for `/busca`,
  `/dashboard`, `/u/[slug]`, `/categoria/[slug]`) and `LHC_PATHS`/`LHC_URLS`
  (the LHCI crawl list).
- A **product decision**, not a filesystem fact. A route existing in
  `src/app/` does not make it audited; being audited is a deliberate choice
  with a budget number attached. It is therefore NOT derivable from the code
  surface:
  - `/dashboard` is auth-gated - LHCI cannot audit it, so it is a budget
    route but NOT in `LHC_PATHS`.
  - `/` is a check-1 (initial JS) metric - it is in `LHC_PATHS` but NOT in
    `REAL_ROUTE_CHECKS`.
  - LHCI needs concrete crawlable URLs (`LHC_PATHS` uses
    `/categoria/limpeza`, `/u/carlos-encanador`) while the budget gate uses
    the route PATTERNS (`/categoria/[slug]`, `/u/[slug]`).
- Drift is a CONTRACT failure: `budget-routes.test.ts` pins the exports and
  asserts `lighthouserc*.json` `ci.collect.url == LHC_URLS`, the smoke test
  derives from `--print-lhci-paths`, and ci.yml/release-deploy.yml declare
  every `envKey`/`deltaEnvKey`.

### Type C - Trigger filters (filtros de trigger)

Answers: **WHEN does this workflow RUN?**

- Live inline in each workflow's own `paths:` block (or YAML anchor).
  Deliberately NOT derived from any manifest and NOT test-pinned.
- CI economics: expensive jobs run only when relevant trees change. Current
  triggers (2026-08 snapshot):
  - `benchmark-auto-baseline.yml` - `src/lib/*.ts`, `scripts/*.mjs`;
  - `e2e-cache.yml` - cache-related files in `src/lib/`, `src/app/`,
    `e2e/`, `scripts/`, + its own workflow file (anchor `&cache_paths`);
  - `lighthouse-ci.yml` - `src/app/**`, `src/components/**`, `src/lib/**`,
    `next.config.ts`, `package.json`, `lighthouserc*.json`, scripts,
    + `scripts/budget-routes.mjs` + its own workflow file;
  - `ssh-composite-proof.yml` - the `severinno-ssh`/`severinno-scp` actions,
    `health-check.yml`, + its own workflow file;
  - `utf8-auto-fix.yml` - `src/**/*.ts`, `src/**/*.tsx`;
  - `ci.yml`, `deploy.yml`, `pr-check.yml`, `guard-gates.yml` - NO `paths:`
    (always run; guard-gates.yml é o push net do guard vitest -
    fragile-range-guard + golden-copy-utils em todo push a main/develop,
    imune a skip por lint - espelho do job fragile-guard do pr-check).
- **Failure mode is SAFE:** an over-narrow `paths:` only SKIPS a run (push
  to main still runs the full jobs via the always-run workflows); an
  over-narrow scan surface silently misses violations. Different failure
  semantics justify different strictness - this is why triggers are hints
  while surfaces are contracts.

## 2. Matrix - who scans what

| Consumer | List type | Source of truth (manifest) | Gate posture |
|----------|-----------|----------------------------|--------------|
| `check-utf8.sh` (`check_utf8.py`) | A - code surface | `encoding-surface.mjs --print-always-dirs` (`scripts/`, `.github/workflows/`, `.zscripts/`) + `src/` positional | blocking (UTF-8) |
| `verify-ascii-proof.sh` | A - code surface | `encoding-surface.mjs --print-vps-sh` / `--print-ops-sh` + frozen manifest in `ascii-safe.md` | blocking (ASCII, `--sync`) |
| `fragile-range-patterns.mjs` (verify-encoding.sh layer 3) | A - code surface | its own `TARGET_DIRS` / `TARGET_EXTS` / `EXCLUDED_TREES` | blocking |
| `verify-encoding.sh` layer 4 (YAML gate UTF-8) | A - code surface | `encoding-surface.mjs --print-yaml-gate` (`YAML_GATE_PATTERNS`) | blocking |
| `verify-encoding.sh` layer 5 (scripts/*.mjs pure-ASCII) | A - code surface | `encoding-surface.mjs --print-mjs-gate` (`MJS_GATE_PATTERNS` = `scripts/*.mjs`) | blocking |
| `docs-encoding` job / `check-docs-encoding.sh` | A - code surface | `encoding-surface.mjs --print-docs` (`DOCS_PATTERNS`) | informational |
| `test:unit` (vitest.config.unit.ts) | A - code surface (test discovery) | `vitest.config.unit.ts` include/exclude, pinned by `unit-surface-contract.test.ts` | blocking (contract) |
| `check-js-budget.mjs` check 7 (real routes) | B - runtime routes | `budget-routes.mjs --print-routes` (`REAL_ROUTE_CHECKS`) | blocking (per-route budgets) |
| `bundle-report.mjs` ROUTE_DELTA_KB (main anti-regression) | B - runtime routes | `budget-routes.mjs` `deltaEnvKey` per route (default 30 KB) | blocking on main |
| `lighthouserc.json` / `lighthouserc.mobile.json` | B - runtime routes | `budget-routes.mjs --print-lhci-urls` (`LHC_URLS`) | CWV audits |
| `lighthouse-ci.yml` smoke test | B - runtime routes | `budget-routes.mjs --print-lhci-paths` | derived loop, no second list |
| Workflow `paths:` triggers | C - trigger filters | inline in each workflow (NOT derived, NOT pinned) | CI economics |
| `ci.yml`, `deploy.yml`, `pr-check.yml` | - (no `paths:`) | always run | - |

## 3. Why each fixed list is legitimate (and why they must NOT be unified)

1. **Code surface = contract, must be derived.** If the scan list drifts
   from the manifest, the gate silently audits the wrong files. This is why
   the fragile-range/encoding surfaces are single-source with divergence
   guards, and why a second hardcoded copy fails the CONTRACT tests.

2. **Runtime routes = product decision, cannot be derived from the tree.**
   Auth-gated pages (`/dashboard`), pattern-vs-concrete URLs, and per-route
   budgets have no filesystem signal. `LHC_PATHS` is intentionally NOT
   identical to `REAL_ROUTE_CHECKS` (home is a check-1 metric; dashboard is
   auth-gated; LHCI needs concrete seeds). Deriving routes from
   `src/app/**` would audit pages nobody chose to budget and miss the
   deliberate choices.

3. **Trigger filters = hints with a safe failure mode.** Over-narrow
   `paths:` costs CI minutes at worst; over-narrow surfaces cost silent
   regressions. They must NOT be unified in either direction: using the
   audit surface as `paths:` would force LHCI on every doc change, and
   treating `paths:` as the audit surface would skip audits.

4. **Rule of thumb:** if a change to the list must FAIL CI when it drifts,
   it is a manifest + contract test (Type A or B). If a change only costs CI
   minutes when wrong, it is `paths:` (Type C) and needs no test.

## 4. Audit checklist (do not re-derive)

Ask which question the list answers, then:

- "What does gate X scan?" -> find its manifest export (`encoding-surface.mjs`
  or `fragile-range-patterns.mjs`), run its `--print-*`, check the CONTRACT
  test pins it.
- "Which tests does the local `test:unit` run?" -> `vitest.config.unit.ts`
  include/exclude, pinned by `unit-surface-contract.test.ts` (extglob
  `!(...)` is the only working negation on vitest 3.1.1 - `!` silently
  fails; section 7).
- "Which pages are budgeted?" -> `scripts/budget-routes.mjs`
  `REAL_ROUTE_CHECKS` (budget) + `LHC_PATHS`/`LHC_URLS` (LHCI crawl).
- "When does workflow Y run?" -> its own `paths:` block; there is no
  manifest, and that is by design.
- "Can workflow Y be manually dispatched?" -> its `workflow_dispatch:`
  must have a sibling trigger (hermetic) and exist on the default branch
  (Prova 7 - dispatch 404s off the default branch; Type D, section 5).
- "Which branch can a proof use without firing a deploy?" -> `ci-proof/*`
  (Type E, section 6): no workflow's push filter matches it - the template
  is a CONTRACT, not a convention, so it cannot silently stop being safe.

The encoding-gate side of this matrix is mirrored in
[`docs/ascii-safe.md`](ascii-safe.md) ("Who protects the docs?" section);
the route/budget side is pinned by `scripts/__tests__/budget-routes.test.ts`.
This file exists so the next audit starts from the taxonomy instead of
re-deriving it from grep output.

## 5. Type D - workflow_dispatch reachability (a workflow contract)

### Type D

Answers: **can a workflow be manually dispatched from the Actions tab?**

Discovered in Prova 7 (2026-08): dispatching a workflow via the API/UI
returns 404 when the workflow file does not exist on the DEFAULT branch -
the Actions tab only sees workflows present there. A workflow added in a PR
is therefore undispatchable until merged (inherent to GitHub, not a bug),
but a dispatch workflow silently vanishing from the default branch is a
reachability regression.

Two rules, enforced by `scripts/__tests__/scan-surfaces-contract.test.ts`
(no js-yaml - a minimal `on:` trigger parser with a whitelist of GitHub
trigger keys, mirroring `extractPaths`):

1. **HERMETIC (blocking):** `workflow_dispatch:` is never the ONLY trigger
   of a workflow. A dispatch-only workflow has no automatic trigger, so it
   is one unmerged push away from being simultaneously unreachable AND
   undispatchable (not on the default branch yet). This rule needs no git
   and fails the suite when violated.
2. **GIT-AWARE (warning):** every workflow with `workflow_dispatch:` should
   exist on the default branch (`origin/HEAD`). When a dispatch workflow is
   missing there, the suite emits the Prova 7 warning line instead of
   failing - a workflow added in the current PR branch is legitimately
   absent from the default branch until merged, so the check must not block
   the PR that introduces it. The check skips gracefully when the
   default-branch ref is unavailable (shallow CI checkout).

Current dispatch set (2026-08 snapshot) - all have a sibling trigger, none
is dispatch-only:

- `deploy.yml` - `push` + `workflow_dispatch:`
- `e2e-cache.yml` - `pull_request`, `push`, `workflow_call` + `workflow_dispatch:`
- `guard-gates.yml` - `push` + `workflow_dispatch:`
- `hook-parallel-race.yml` - `schedule` (semanal) + `workflow_dispatch:` (prova de estabilidade do par paralelo tsc | lint-staged do pre-commit, secao 11.8 - nao e gate de merge, por isso schedule+manual e nao push/PR)
- `lighthouse-ci.yml` - `pull_request`, `push`, `workflow_call` + `workflow_dispatch:`
- `pr-check.yml` - `pull_request`, `merge_group` + `workflow_dispatch:`
- `release-deploy.yml` - `push` + `workflow_dispatch:`
- `ssh-composite-proof.yml` - `pull_request`, `push` + `workflow_dispatch:`

The trigger parser and the `missingOnDefault` diff are pinned by synthetic
mutation tests, so the warning's behavior is proven without depending on
the repo's git state.

## 6. ci-proof branch template (prova permanente de sentinela)

### Type E

Answers: **qual branch um proof pode usar sem disparar deploy?**

Discovered in Prova 7 (2026-08): the sentinel proof ran on `develop` because
pushing to `main` would have fired `deploy.yml` (production deploy). The
branch/event risk matrix is FROZEN here (2026-08 snapshot) so the next proof
does not re-derive it - and the `ci-proof/*` namespace is a CONTRACT (Type E
below) so the template cannot silently stop being safe.

| Ref / event | Workflows fired | Verdict |
|---|---|---|
| push to `main` | `deploy.yml` (**DEPLOY**), `ci.yml`, `guard-gates.yml`, `lighthouse-ci.yml`, `utf8-check.yml` + path-limited: `benchmark-auto-baseline`, `e2e-cache`, `ssh-composite-proof` | **DANGER - the deploy branch** |
| push to `develop` | `ci.yml`, `guard-gates.yml`, `utf8-check.yml` (no deploy) | noisy, no deploy |
| push tags `v*` | `release-deploy.yml` (**RELEASE + DEPLOY**) | **DANGER - never from a proof** |
| push to `ci-proof/*` | nothing | **THE proof namespace** |
| PR to `main` | `pr-check.yml`, `ci.yml` + path-limited: `e2e-cache`, `lighthouse-ci`, `ssh-composite-proof`, `utf8-auto-fix` (`deploy.yml` has NO pull_request trigger - PRs never deploy) | PR-gate proofs |
| workflow_dispatch | only the dispatched workflow, any ref - but the workflow FILE must exist on the default branch (Prova 7: dispatch 404s off the default branch) | dispatch proofs |

Note: `release/v0.4.0` (the default branch) currently has NO push listener,
but it is the release line, not a proof namespace - use `ci-proof/*`.

The `ci-proof/*` safety is a CONTRACT (Type E in
`scripts/__tests__/scan-surfaces-contract.test.ts`): every workflow's `push:`
and `pull_request:` block must carry a `branches:` (or `tags:`) filter, and NO
branch pattern may match a `ci-proof/*` branch. A future `branches: ["**"]`
or a filter-less `push:` block FAILS the suite - the template breaks loudly,
not silently.

Scope note: the invariant inspects `push:`/`pull_request:` only - the repo
uses neither `pull_request_target:` nor `pull_request_review:` today; a
future adoption must extend `triggerFilter` (and this section) before it
lands, or a PR-gated workflow with a filter-less `pull_request_target:`
would escape the invariant (it fires on PR events against a branch filter,
not on branch pushes - a different event class than the push matrix above).

## 7. Unit test surface (test:unit / vitest.config.unit.ts) - a Type A contract

Answers: **WHICH test files does the local `test:unit` suite run, and which
are excluded?**

Context (2026-08): the `AddressAutocomplete` component was only covered by
the fuzz suite (seed 42) because `vitest.config.unit.ts` blanket-excluded
`src/components/**/*.test.{ts,tsx}` - a surface gap: NO regular suite
covered the component, and the pre-commit area-mapping silently skipped
component edits ("No test files found" + `--passWithNoTests` = mute skip).

The smoke test the fix needed ALREADY EXISTED (`address-autocomplete.test.tsx`,
32 deterministic tests with fake timers, outside the fuzz) - the gap was the
surface, not missing coverage, so no duplicate was created.

Lever findings (probed empirically on vitest 3.1.1):

- `!` glob NEGATION in include/exclude does NOT work (silently ignored).
- EXTGLOB `!(...)` DOES work - the only viable re-inclusion mechanism.

Fix: replace the blanket exclusion with an extglob re-inclusion admitting
exactly the deterministic vitrine suites:

```
exclude: [
  // extglob !(...) is the ONLY working negation on vitest 3.1.1
  // other component trees stay out of test:unit (blanket exclusion removed)
  "src/components/!(vitrine)/**/*.test.{ts,tsx}",
  // vitrine slow/brittle kinds: fuzz (real timers + axe), a11y/accessibility (axe), snapshot (golden)
  "src/components/vitrine/__tests__/*fuzz*.test.{ts,tsx}",
  "src/components/vitrine/__tests__/*a11y*.test.{ts,tsx}",
  "src/components/vitrine/__tests__/*accessibility*.test.{ts,tsx}",
  "src/components/vitrine/__tests__/*snapshot*.test.{ts,tsx}",
  "node_modules",
  ".next",
],
```

Everything else under `vitrine/__tests__/` is unit-visible: today exactly
`address-autocomplete.test.tsx` (32 deterministic) + `provider-card.test.tsx`
(3 deterministic) - 35/35. The fuzz suites still run via
`scripts/run-all-fuzz.mjs` under the DEFAULT config (no `--config` flag), so
excluding `*fuzz*` from the unit config does not affect `fuzz:ci`.

Direct benefit: the pre-commit area-mapping now maps a vitrine edit (e.g.
`address-autocomplete.tsx`) to REAL deterministic tests instead of the
mute "No test files found" skip.

Import-order contract: under unit config the vitrine setup is NOT a
setupFile (only `vitest.config.ts` default has it), so vitrine test files
must import `./test-utils` (which registers the `vi.mock` calls) BEFORE the
component - the suite is then self-contained under BOTH configs.

Pinned by `scripts/__tests__/unit-surface-contract.test.ts` (extracts the
exclude block from the CONFIG TEXT - importing the vitest config directly
fails on a vite invariant - + picomatch + mutation): a NEW plain vitrine
test AUTO-JOINS test:unit (growth contract); the real-tree pin (EXACTLY 2
files) breaks LOUDLY by design the day that happens - update
`EXPECTED_INCLUDED` consciously.

Residual (documented, not a bug): non-vitrine component edits (admin,
client, provider trees) still silently skip in the pre-commit mapping - the
contract pins that residual too. Opening the whole `src/components` tree to
test:unit is deliberately NOT done (many axe/snapshot-heavy suites would
slow the local gate); the vitrine tree is the deterministic/small one.
