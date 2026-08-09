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
    `DOCS_PATTERNS` (`*.md`, `*.css`, `*.html`).
  - `scripts/fragile-range-patterns.mjs` - `TARGET_DIRS` (`e2e/`, `src/`,
    `mini-services/`, `.zscripts/`), `TARGET_EXTS`, `EXCLUDED_TREES`
    (`docs`, `public`, `examples`, `config`, `prisma`, `db`, `download`,
    `upload`, `osrm-data`, `agent-ctx`, `.opencode`, `tool-results`,
    `secrets`, `.agents`).

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
  - `ci.yml`, `deploy.yml`, `pr-check.yml` - NO `paths:` (always run).
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
| `docs-encoding` job / `check-docs-encoding.sh` | A - code surface | `encoding-surface.mjs --print-docs` (`DOCS_PATTERNS`) | informational |
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
- "Which pages are budgeted?" -> `scripts/budget-routes.mjs`
  `REAL_ROUTE_CHECKS` (budget) + `LHC_PATHS`/`LHC_URLS` (LHCI crawl).
- "When does workflow Y run?" -> its own `paths:` block; there is no
  manifest, and that is by design.

The encoding-gate side of this matrix is mirrored in
[`docs/ascii-safe.md`](ascii-safe.md) ("Who protects the docs?" section);
the route/budget side is pinned by `scripts/__tests__/budget-routes.test.ts`.
This file exists so the next audit starts from the taxonomy instead of
re-deriving it from grep output.
