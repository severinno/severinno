/**
 * golden-copy-utils.ts — shared helpers for the golden-copy suites in
 * scripts/__tests__/ (workflow-embedded programs vs versioned golden copies).
 *
 * The canonical-form helper was previously duplicated in every golden-copy
 * suite (canonicalShell in workflow-prove-gate-golden.test.ts, canonicalAwk in
 * release-assert-route-gate.test.ts, canonicalShell in the deleted
 * workflow-healthcheck-golden.test.ts). Extracted here so a 4th suite imports
 * instead of copy-pasting — a divergence in the canonicalizer itself would
 * silently weaken EVERY divergence guard at once.
 *
 * The subprocess runner + CRLF normalization + temp-dir registry were also
 * duplicated across the shim harnesses (runProveGateProgram / runAwkProgram /
 * runScript in the health-check suite): every harness spawned bash/awk with
 * the same shape (env merged over process.env, utf8, 30s timeout) and
 * normalized CRLF before piping programs into bash (a Windows checkout via
 * `* text=auto` → CRLF would break bash parsing on `\r`). Centralized here so
 * the 4th suite inherits the same hardening by default instead of
 * re-implementing it per-harness.
 *
 * The module-patch scaffold (ModulePatchOp + writeModuleCopy) was the 3rd
 * instance of the same shape — the fragile-range REVERSE MUTATION
 * (writePatchedModule below), the encoding-surface GROWTH CONTRACT
 * (writePatchedSurfaceModule) and the budget-routes GROWTH CONTRACT
 * (writePatchedRoutesModule) all read a manifest module, patched it at
 * structural anchors and wrote a temp copy. Extracted here so a 4th
 * manifest suite builds ops and calls writeModuleCopy instead of
 * copy-pasting the read-module / anchor / write-copy shape a 4th time.
 */
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { expect } from "vitest"
import { TARGET_DIRS, filesInDir } from "../fragile-range-patterns.mjs"
import { ENCODING_NET, GUARD_NET } from "../workflow-contracts.mjs"

/**
 * RULE OF THREE (EXTRACTED 2026-08): the guard-net workflow rel-paths,
 * DERIVED from the workflow-contracts manifest - the SAME derivation
 * scan-guard-gates.mjs applies (guardNet[0] = the push net, guardNet[last]
 * = the PR-side twin). Three suites read/write these workflows against the
 * manifest: scan-guard-gates.test.ts (the REAL-REPO CONTRACT reads + the
 * synthetic fixtures), workflow-contracts.test.ts (the LIVE TREE twin
 * reads) and run-precommit-guards.test.ts (writeBadGuardNet runs the REAL
 * guard against synthetic roots). Each previously hardcoded the three
 * rel-paths; a rename in the manifest would have broken those suites for
 * the WRONG reason (a fixture writing the old path -> WORKFLOW MISSING
 * instead of the intended mutation). Derived here so a manifest change
 * re-derives every consumer - the drift class the manifest exists to kill.
 */
export const GUARD_PUSH_NET = GUARD_NET[0]
/** The PR-side twin (the LAST GUARD_NET entry - the same twin the guard derives). */
export const GUARD_PR_TWIN = GUARD_NET[GUARD_NET.length - 1]
/**
 * The merge-path encoding caller (ci.yml): the ENCODING_NET entry that is
 * NOT the PR twin - order-robust (a reorder of ENCODING_NET cannot silently
 * swap which file the rule-8 asserts read).
 */
export const ENCODING_CI_NET = ENCODING_NET.find((rel) => rel !== GUARD_PR_TWIN) ?? ENCODING_NET[0]

/**
 * RULE OF USES (EXTRACTED 2026-08): the synthetic pr-check.yml fixtures were
 * duplicated INLINE in ~9 tests of scan-guard-gates.test.ts - the base
 * writePRWorkflow (the clean PR twin) plus 4 full-file inline blocks for the
 * FUZZ mutations (FUZZ JOB MISSING, FUZZ STEP MISSING and the two fixtures of
 * the MUTATION COMBINADA test), each spelling out the same ~30-line YAML.
 * Two repeated SHAPES crossed the rule-of-two threshold:
 *   - SEM FUZZ (the fuzz job absent): the FUZZ JOB MISSING test AND the
 *     MUTATION COMBINADA fixture 2 - byte-identical shapes, both asserting
 *     'FUZZ JOB MISSING'.
 *   - FUZZ QUEBRADO (fuzz present but broken): the FUZZ STEP MISSING test
 *     (wrong step, no check job) AND the MUTATION COMBINADA fixture 1
 *     (needs: check + wrong step, with check) - the two mutations of rule 7
 *     that are NOT mutually exclusive (NEEDS + STEP report together).
 * Extracted here so a 4th fixture (or a mutation touching only the fuzz
 * job) builds on the shared blocks instead of a 4th inline copy. The
 * single-use variants (fragile-guard missing/wrong-step, benchmark
 * missing/wrong-step, encoding call-site missing) stay inline by the rule
 * of uses - a 2nd use of one extracts it the same way.
 *
 * The five job blocks below mirror the REAL pr-check.yml shape the guard
 * parses (utf8-check call site + check + fuzz + benchmark + fragile-guard,
 * all standalone without needs:). The re-entry append pattern (a SECOND
 * job block APPENDED via `extra`, e.g. fragile-guard needs:) is preserved
 * by the `extra` param of writePRWorkflow - the parser reads the LAST block.
 */

const PR_CHECK_HEADER = [
  "name: PR Check",
  "on:",
  "  pull_request:",
  "    branches: [main]",
  "jobs:",
]

const PR_JOB_UTF8 = ["  utf8-check:", "    uses: ./.github/workflows/utf8-check.yml"]

const PR_JOB_CHECK = [
  "  check:",
  "    runs-on: ubuntu-latest",
  "    steps:",
  "      - name: Unit tests",
  "        run: bun run test:unit",
]

const PR_JOB_FUZZ = [
  "  fuzz:",
  "    name: Fuzz Tests",
  "    runs-on: ubuntu-latest",
  "    steps:",
  "      - name: Run fuzz tests",
  "        run: bun run fuzz:ci > fuzz-results.json",
]

const PR_JOB_BENCHMARK = [
  "  benchmark:",
  "    name: Geo Benchmark",
  "    runs-on: ubuntu-latest",
  "    steps:",
  "      - name: Run geo benchmark",
  "        run: |",
  "          node scripts/run-benchmark.mjs --type geo --json",
]

/**
 * The 3 versioned scanner steps (rule 10 of scan-guard-gates, sec 11.32) -
 * the standalone CLI gate scanners that must run in BOTH net workflows. The
 * real guard-gates.yml + pr-check.yml fragile-guard job carry these SAME 3
 * steps (name + `run: node scripts/scan-<x>.mjs --ci`), so the fixture
 * blocks stay canonical SUBSETs of the real workflows (sec 11.25 drift
 * contract). Exported as a RECORD (granular strip in the rule-10 mutation
 * tests) + a flat SCANNER_STEPS (the base/block builders spread it).
 */
export const SCANNER_BLOCKS: Record<"timeouts" | "curl" | "eol", [string, string]> = {
  timeouts: [
    "      - name: Scan subprocess-heavy tests for explicit timeouts",
    "        run: node scripts/scan-timeouts.mjs --ci",
  ],
  curl: [
    "      - name: Scan gate-script curls for explicit timeouts",
    "        run: node scripts/scan-curl-timeouts.mjs --ci",
  ],
  eol: [
    "      - name: Scan string \\n anchors in the test/mutation surface",
    "        run: node scripts/scan-eol-anchor.mjs --ci",
  ],
}

/** The flat scanner-step lines (the 3 blocks in order) - the base builders spread it. */
export const SCANNER_STEPS: string[] = [
  ...SCANNER_BLOCKS.timeouts,
  ...SCANNER_BLOCKS.curl,
  ...SCANNER_BLOCKS.eol,
]

const PR_JOB_FRAGILE = [
  "  fragile-guard:",
  "    name: Fragile Range Guard",
  "    runs-on: ubuntu-latest",
  "    steps:",
  "      - uses: actions/checkout@v4",
  "      - name: Run guard vitest suites (fragile-range-guard + golden-copy-utils)",
  "        run: bun run test:guard",
  ...SCANNER_STEPS,
]

/**
 * The PR-twin job blocks keyed by JOB KEY - exported so the fixture-vs-real
 * contract (golden-copy-utils.test.ts, sec 11.25) can compare each shared
 * block against the SAME job in the REAL pr-check.yml (canonical SUBSET:
 * every fixture line must appear in the real job block). The keys are the
 * scanner-anchored jobs (utf8-check call site + check + fuzz + benchmark +
 * fragile-guard) - a 6th anchored job MUST grow this record AND the shape
 * pin in the contract (the growth direction the pin enforces).
 */
export const PR_JOB_BLOCKS: Record<string, string[]> = {
  "utf8-check": PR_JOB_UTF8,
  check: PR_JOB_CHECK,
  fuzz: PR_JOB_FUZZ,
  benchmark: PR_JOB_BENCHMARK,
  "fragile-guard": PR_JOB_FRAGILE,
}

function writePRWorkflowFile(dir: string, jobs: string[], extra = ""): void {
  const abs = path.join(dir, GUARD_PR_TWIN)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, [...PR_CHECK_HEADER, ...jobs, ""].join("\n") + extra)
}

/**
 * Write the CLEAN synthetic pr-check.yml (the PR twin): all five standalone
 * jobs (utf8-check + check + fuzz + benchmark + fragile-guard). `extra`
 * appends raw YAML lines - the re-entry append pattern for the needs:
 * mutations (the parser reads the LAST job block). Moved here from
 * scan-guard-gates.test.ts so the fixture family shares the job blocks.
 */
export function writePRWorkflow(dir: string, extra = ""): void {
  writePRWorkflowFile(dir, [...PR_JOB_UTF8, ...PR_JOB_CHECK, ...PR_JOB_FUZZ, ...PR_JOB_BENCHMARK, ...PR_JOB_FRAGILE], extra)
}

/**
 * Write the SEM-FUZZ pr-check.yml: the fuzz job ABSENT (utf8-check + check
 * + benchmark + fragile-guard) - the 'FUZZ JOB MISSING' shape (rule 7),
 * used by the FUZZ JOB MISSING test and the MUTATION COMBINADA fixture 2.
 * `extra` exists for family symmetry with writePRWorkflow (both call sites
 * today pass nothing) - a 2nd use of the append pattern extracts it.
 */
export function writePRWorkflowSemFuzz(dir: string, extra = ""): void {
  writePRWorkflowFile(dir, [...PR_JOB_UTF8, ...PR_JOB_CHECK, ...PR_JOB_BENCHMARK, ...PR_JOB_FRAGILE], extra)
}

/** Options for the FUZZ-QUEBRADO shape (rule 7 mutations). */
export interface PRWorkflowFuzzOpts {
  /** Add `needs: <X>` to the fuzz job (the skip-vector mutation). */
  needs?: string
  /** Omit the `check` job (the FUZZ STEP MISSING shape keeps only the broken fuzz). */
  omitCheck?: boolean
}

/**
 * Write the FUZZ-QUEBRADO pr-check.yml: the fuzz job present but BROKEN - the
 * fuzz:ci step replaced by `run: bun run test:unit` (the 'FUZZ STEP MISSING'
 * mutation; the step NAME 'Run something else' is intentionally distinct
 * from 'Run fuzz tests' so a future step-name assertion cannot misread),
 * optionally with `needs: <X>` added (the 'FUZZ JOB NEEDS' mutation) and
 * optionally WITHOUT the check job. Used by the FUZZ STEP MISSING test
 * ({ omitCheck: true }) and the MUTATION COMBINADA fixture 1
 * ({ needs: "check" }) - the two rule-7 mutations that are NOT mutually
 * exclusive and must report together.
 */
export function writePRWorkflowFuzzQuebrado(dir: string, opts: PRWorkflowFuzzOpts = {}): void {
  const fuzz = [
    "  fuzz:",
    ...(opts.needs ? [`    needs: ${opts.needs}`] : []),
    "    name: Fuzz Tests",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - name: Run something else",
    "        run: bun run test:unit",
  ]
  const jobs = [
    ...PR_JOB_UTF8,
    ...(opts.omitCheck ? [] : PR_JOB_CHECK),
    ...fuzz,
    ...PR_JOB_BENCHMARK,
    ...PR_JOB_FRAGILE,
  ]
  writePRWorkflowFile(dir, jobs)
}

/**
 * RULE OF USES (EXTRACTED 2026-08): the synthetic guard-gates.yml (push net)
 * fixtures were duplicated INLINE in scan-guard-gates.test.ts (the local
 * writeWorkflow, ~27 call sites) while TWO sibling suites built the SAME
 * workflow with DIFFERENT shapes: guard-gates-exclusivity.test.ts (the local
 * writePush, 3 call sites, runs-on + paths INLINE in the job block) and
 * run-precommit-guards.test.ts (writeBadGuardNet's push net, inline). Two
 * repeated shapes crossed the rule-of-two threshold - extracted here so a
 * 4th fixture builds on the shared base.
 *
 * The base is BYTE-IDENTICAL to the old writeWorkflow: the PATHS FILTER
 * `:10` line pin depends on the exact 9 content lines + the trailing ""
 * element (the extra append starts at line 10). `extra` is the re-entry
 * append pattern (the parser reads the LAST job block) - the paths/needs
 * mutations pass their raw YAML there, exactly like the old call sites.
 * Single-use variants stay inline by the rule: the JOB MISSING fixture
 * (a `lint:` job instead of `guard-gates:`) and the twin mutations.
 */
export interface GuardGatesWorkflowOpts {
  /** Workflow name line (default "Guard Gates"). */
  name?: string
  /** Include `runs-on: ubuntu-latest` in the guard-gates job (the exclusivity fixture shape). */
  runsOn?: boolean
  /** Replace the test:guard step with the lint step (the TEST GUARD STEP MISSING shape). */
  step?: boolean
  /** Remove ALL 3 scanner steps (the rule-10 all-missing shape, sec 11.32). */
  omitScanners?: boolean
  /** Remove ONE scanner step (the rule-10 single-step shape, sec 11.32). */
  omitScanner?: "timeouts" | "curl" | "eol"
  /** Append raw YAML lines after the base (the re-entry append pattern - the parser reads the LAST block). */
  extra?: string
}

/**
 * The push-net base (guard-gates.yml shape) - exported for the same
 * fixture-vs-real contract (sec 11.25): the base must remain a canonical
 * SUBSET of the REAL guard-gates.yml (the push-net twin of the PR blocks).
 * The 3 scanner steps (rule 10, sec 11.32) live AFTER the test:guard step,
 * mirroring the real workflow - so the base now has 15 content lines (the
 * `extra` append starts at line 16, not 10: the PATHS FILTER `:16` pin).
 */
export const GUARD_PUSH_BASE = [
  "name: Guard Gates",
  "on:",
  "  push:",
  "    branches: [main, develop]",
  "jobs:",
  "  guard-gates:",
  "    steps:",
  "      - name: Run guard vitest suites (BASELINE + divergence guards)",
  "        run: bun run test:guard",
  ...SCANNER_STEPS,
]

/**
 * Write the CLEAN synthetic guard-gates.yml (the push net) - the shared base
 * for every push-net fixture (scan-guard-gates.test.ts, the exclusivity
 * suite, run-precommit-guards.test.ts). The base is BYTE-IDENTICAL to the
 * local writeWorkflow it replaces: the PATHS FILTER `:16` line pin depends
 * on the exact 15 content lines (9 base + 6 scanner steps, rule 10, sec
 * 11.32) + the trailing "" element (the extra append starts at line 16).
 * `extra` appends raw YAML - the re-entry append pattern for the
 * needs:/paths mutations (the parser reads the LAST job block). `runsOn`
 * and `step` cover the exclusivity shape (runs-on in the job, lint step
 * for the TEST GUARD STEP MISSING mutation); `name` covers the
 * run-precommit shape ("guard-gates"); `omitScanners`/`omitScanner` cover
 * the rule-10 shapes (all 3 scanner steps missing / one step missing). The
 * step NAME is cosmetic (the scanner anchors on the `run:` key, never the
 * name). `step:false` targets the test:guard step BY INDEX (findIndex), NOT
 * the tail - the scanner steps sit AFTER it now.
 */
export function writeGuardGatesWorkflow(dir: string, opts: GuardGatesWorkflowOpts = {}): void {
  const lines = [...GUARD_PUSH_BASE]
  if (opts.name) lines[0] = opts.name
  if (opts.runsOn) lines.splice(6, 0, "    runs-on: ubuntu-latest")
  if (opts.step === false) {
    const runIdx = lines.findIndex((l) => l.includes("run: bun run test:guard"))
    lines.splice(runIdx - 1, 2, "      - name: lint", "        run: bun run lint")
  }
  if (opts.omitScanners) {
    lines.splice(lines.length - SCANNER_STEPS.length, SCANNER_STEPS.length)
  } else if (opts.omitScanner) {
    const block = SCANNER_BLOCKS[opts.omitScanner]
    const idx = lines.findIndex((l) => l === block[0])
    // fail-loud on drift (o mesmo postura do replaceEolAgnostic): um
    // findIndex -1 viraria um splice(-1, 2) silencioso removendo o tail -
    // impossivel com as constantes estaticas (o drift contract da 11.25 as
    // pina), mas o -1 nunca pode virar um no-op silencioso.
    if (idx < 0) throw new Error(`omitScanner: bloco ${opts.omitScanner} nao encontrado no GUARD_PUSH_BASE (drift das constantes)`)
    lines.splice(idx, 2)
  }
  const abs = path.join(dir, GUARD_PUSH_NET)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, [...lines, ""].join("\n") + (opts.extra ?? ""))
}

/**
 * RULE OF USES (EXTRACTED 2026-08): the synthetic ci.yml (the ENCODING_NET
 * merge-path caller, rule 8/11 of scan-guard-gates) was duplicated INLINE in
 * THREE suites with TWO shapes: scan-guard-gates.test.ts (the local
 * writeCIWorkflow, ~30 call sites, utf8-check call site ALWAYS in the base)
 * and guard-gates-exclusivity.test.ts (the local writeCi, 6 call sites,
 * utf8-check OPT-IN via { enc: true }) - plus the inert inline in
 * run-precommit-guards.test.ts (writeBadGuardNet, sec 11.26 left it as "a
 * unica variante que fica inline" - that frontier decision MOVES: the
 * shared builder below replaces the inline too). Two repeated shapes
 * crossed the rule-of-two threshold - extracted here so a 4th fixture
 * builds on the shared base. The blocks mirror the REAL ci.yml shape the
 * guard parses: lint (the base job) + the utf8-check call site (rule 8/11
 * anchor). Single-use variants stay inline by the rule: the rule-11
 * mutations that rewrite the whole ci.yml (dangling needs, call-site
 * missing) and the rule-8 needs:/step mutations keep their full-file
 * inline writes (each is a sole-failure shape).
 */

const CI_HEADER = ["name: CI", "on:", "  push:", "    branches: [main, develop]", "jobs:"]

const CI_JOB_LINT = ["  lint:", "    runs-on: ubuntu-latest", "    steps:", "      - run: bun run lint"]

const CI_JOB_UTF8 = ["  utf8-check:", "    uses: ./.github/workflows/utf8-check.yml"]

/**
 * The ci.yml job blocks keyed by JOB KEY - exported so the fixture-vs-real
 * contract (golden-copy-utils.test.ts, sec 11.25) can compare each shared
 * block against the SAME job in the REAL ci.yml (canonical SUBSET: every
 * fixture line must appear in the real job block). The keys are the two
 * jobs of the shared base - lint is a cosmetic filler (no guard rule scans
 * it; the pin rationale, reviewer nit sec 11.34) and utf8-check is the
 * call-site anchor (rule 8/11). A 3rd job joining the shared base MUST
 * grow this record AND the shape pin in the contract (the growth
 * direction the pin enforces).
 */
export const CI_JOB_BLOCKS: Record<string, string[]> = {
  lint: CI_JOB_LINT,
  "utf8-check": CI_JOB_UTF8,
}

export interface CIWorkflowOpts {
  /** Include the utf8-check call site (default true - the scan-guard-gates base shape). */
  enc?: boolean
  /** Append raw YAML lines after the base (the re-entry append pattern - the parser reads the LAST block). */
  extra?: string
}

/**
 * Write the CLEAN synthetic ci.yml (the merge-path encoding caller) - the
 * shared base for every ci.yml fixture (scan-guard-gates.test.ts, the
 * exclusivity suite, run-precommit-guards.test.ts). `enc` defaults to true
 * (the scan-guard-gates shape always carries the utf8-check call site; the
 * exclusivity call sites ALL pass { enc: true }, so the merged default is
 * byte-identical for every current consumer). `extra` is the re-entry
 * append pattern (the parser reads the LAST job block) - the prose-comment
 * mutations pass their raw lines there, exactly like the old call sites.
 */
export function writeCIWorkflow(dir: string, opts: CIWorkflowOpts = {}): void {
  const lines = [...CI_HEADER, ...CI_JOB_LINT]
  if (opts.enc !== false) lines.push(...CI_JOB_UTF8)
  const abs = path.join(dir, ENCODING_CI_NET)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, [...lines, ""].join("\n") + (opts.extra ?? ""))
}

/** Canonical form for the divergence guards (content, not layout). */
export function canonicalProgram(program: string): string {
  return program
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trim()) // BOTH sides: extraction carries the YAML block indent
    .filter((l) => l.length > 0 && !l.startsWith("#"))
    .join("\n")
}

/**
 * RULE OF USES (EXTRACTED 2026-08): o doc sintetico POISONADO do
 * scan-exit-claims (a claim registrada 11.42 como base + a claim fake 11.99
 * nao-registrada - o shape que derruba o CLI exit-claims E o guard do push
 * com 'claim na secao 11.99') estava inline em DOIS lugares: o POISON_DOC
 * const do check-exit-claims-push.test.ts (sec 11.49) e o
 * writePoisonExitClaimsDoc local do run-precommit-guards.test.ts (sec 11.57
 * - o teste novo do 8o guard no batch). 2 shapes repetidas -> extraido aqui
 * para um 3o suite herdar o MESMO doc envenenado sem re-escrever o shape.
 * O retorno de writePoisonExitClaimsDoc e o PATH do doc escrito (o seam
 * EXIT_CLAIMS_DOC / CHECK_EXIT_CLAIMS_PUSH_DOC aponta para ele).
 */
export const POISON_EXIT_CLAIMS_DOC = [
  "## 11.42 o CLI scan-exit-claims sai exit code 0 no doc real",
  "",
  "**Exit codes**: exit code 0 (doc coberto) / exit code 1 (violacoes listadas).",
  "",
  "## 11.99 Claim fake da prova",
  "",
  "**Exit codes**: exit code 3 aqui.",
  "",
  "## 12. Referencias",
  "",
].join("\n")

/**
 * Escreve o doc envenenado em `<dir>/docs/gates-proofs.md` (o rel-path que
 * o scan-exit-claims usa por default) e devolve o PATH - o seam dos testes
 * que rodam o CLI real contra o doc sintetico. A claim fake 11.99 produz o
 * bloco unregistered (CURE + stale noise - o stale de TODAS as outras
 * entradas do manifest sem claim no doc sintetico e esperado e inofensivo
 * nos asserts de presenca).
 */
export function writePoisonExitClaimsDoc(dir: string): string {
  const abs = path.join(dir, "docs", "gates-proofs.md")
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, POISON_EXIT_CLAIMS_DOC, "utf8")
  return abs
}

/** CRLF → LF. Needed before piping a program/golden copy into bash -c. */
export function normalizeCrlf(input: string): string {
  return input.replace(/\r\n/g, "\n")
}

/**
 * PROVA 17 ACHADO (sec 8.14, 2026-08-10): ancoras de string com `\n`
 * FALHAM SILENCIOSAMENTE em arquivos CRLF. No Windows, os gate files
 * (.github/workflows/*.yml, .husky/*, package.json) sao CRLF no working
 * tree (git autocrlf) - um `content.replace("...\n...", ...)` nao casa o
 * `\r\n` e vira um no-op silencioso: a mutacao nao aplica, o teste passa
 * falso, e o sinal da prova desaparece. A 1a tentativa da Prova 17
 * falhou exatamente assim; o fix foi normalizar para LF antes de
 * substituir. ESTE helper e o fix tornado contrato:
 *
 *   1. normaliza CRLF -> LF no conteudo ANTES de casar a ancora;
 *   2. THROWS se a ancora nao for encontrada apos a normalizacao - o
 *      no-op silencioso vira fail-loud com o label da chamada (a classe
 *      que o scan-eol-anchor.mjs tambem trava, mas aqui no runtime).
 *
 * RULE OF USES (2026-08): os 8 sites de mutacao de gate file nos testes
 * (scan-fuzz-precommit, scan-prepush-batch, scan-push-full-suite) usavam
 * `.replace("...\n...", "")` cru em constantes LF sinteticas - o mesmo
 * idioma que quebra em CRLF real. Refatorados para este helper (2+ usos,
 * regra satisfeita): a normalizacao e no-op no conteudo LF, mas o throw
 * no anchor-miss vira o silencio em erro claro se a constante driftar.
 */
export function replaceEolAgnostic(content: string, search: string, replacement: string, label: string): string {
  const lf = normalizeCrlf(content)
  if (!lf.includes(search)) {
    throw new Error(`${label}: ancora ${JSON.stringify(search)} nao encontrada apos normalizacao CRLF->LF (Prova 17 ACHADO, sec 8.14) - a mutacao seria um no-op silencioso`)
  }
  return lf.replace(search, replacement)
}

export interface SpawnResult {
  status: number | null
  stdout: string
  stderr: string
}

/**
 * Assert the layer-3 offender COUNT is pinned to exactly `count` - the
 * "sole failure source" guarantee shared by every fragile-range dirty test
 * (the guard suite's CLI --dir dirty + FRAGILE_SCAN_ROOT dirty tests, and
 * the verify-encoding.sh FRAGILE_SCAN_ROOT + FRAGILE_SCAN_DIRS mutation
 * tests). ALL of them are hermetic by construction: the CLI tests set
 * FRAGILE_SCAN_ROOT (synthetic root) so they scan ZERO real surface, and
 * the wrapper tests set BOTH layer-3 overrides. A real-repo regression can
 * therefore never flip these pins or masquerade as a synthetic proof -
 * the live-regression signal belongs to the real-surface tests (the guard
 * suite's repo-wide / BASELINE / REAL-REPO CONTRACT / clean-verdict CLI
 * runs), not to these pins.
 */
export function expectSoleFailureCount(stderr: string, count: number): void {
  expect(stderr).toContain(`${count} fragile character-class range(s) in LIVE code:`)
}

/**
 * RULE OF TWO USES (EXTRACTED 2026-08): expectedTargetFiles() is the
 * derived count of code files under the module's TARGET_DIRS trees — the
 * exact number the layer-3 verdict asserts ("+ N target files"). It was
 * duplicated VERBATIM in the REAL-REPO CONTRACT --dir MULTI-ARG test
 * (fragile-range-guard.test.ts) and the CONTRACT layer-3-derivation test
 * (verify-encoding.test.ts); the repo's usual rule-of-three would wait
 * for a 3rd copy, but this derivation is exactly where a suite hardcodes
 * a magic "+ 476 target files" literal, so the shared helper landed at 2
 * uses. A 3rd suite asserts that count by importing THIS instead of
 * re-deriving it.
 *
 * The count is DERIVED from the module's own exports (TARGET_DIRS +
 * filesInDir) — never a frozen literal — so it always agrees with what
 * the module's CLI itself counts (extraFiles += filesInDir(d).length),
 * and a new file (or a 5th TARGET_DIRS tree) self-adjusts instead of
 * tripping a stale pin. Root defaults to the process CWD (both original
 * call sites used ROOT = process.cwd()); a synthetic-root suite can pass
 * its own. NOTE: this import pulls fragile-range-patterns.mjs (an
 * IS_MAIN-guarded CLI entry, side-effect-free on import) into every
 * suite that imports golden-copy-utils — safe by design, but the module
 * stays the single source of truth for both symbols.
 *
 * Real-coverage note: the helper is exercised, not dead — both call
 * sites assert the real-repo count against the layer-3 verdict regex
 * ("+ N target files?"), so a refactor that weakens the derivation would
 * fail the CONTRACT tests, not pass silently.
 */
export function expectedTargetFiles(root = process.cwd()): number {
  return TARGET_DIRS.reduce((n, d) => n + filesInDir(path.join(root, d)).length, 0)
}

/**
 * REVERSE-MUTATION harness - shared by the module-level reverse mutations
 * (fragile-range-guard.test.ts, via patchModuleCopy + runReverseMutation)
 * AND the wrapper-level reverse mutation (verify-encoding.test.ts, via
 * patchModuleFile + FRAGILE_MODULE). Both suites write a TEMP COPY of the
 * real fragile-range-patterns.mjs with the scan-scope contracts LIFTED
 * (docs/ injected into TARGET_DIRS, optionally .md appended to
 * TARGET_EXTS) and re-execute the real code with the lifted constants -
 * an export-level vi.mock could never change the module-scope binding
 * scanExecutableCode reads, so the mutation must happen at the
 * module-source level.
 *
 * The expected declarations are NOT hardcoded anchors anymore: they live in
 * a VERSIONED GOLDEN COPY (scripts/__tests__/fixtures/fragile-range-scope.txt
 * - the repo's golden-copy pattern). writePatchedModule EXTRACTS the live
 * declarations from the real module by structural shape, compares them to
 * the golden snapshot (canonicalProgram-normalized), and on drift throws a
 * CLEAR DIFF (expected golden lines vs actual live lines + the fixture path
 * to update) instead of a bare "anchor not found" - so a module change is
 * actionable at a glance. The divergence guard in golden-copy-utils.test.ts
 * enforces the golden == live-module sync.
 */
const REAL_FRAGILE_MODULE = path.resolve(process.cwd(), "scripts", "fragile-range-patterns.mjs")
const SCOPE_GOLDEN = path.resolve(
  process.cwd(),
  "scripts",
  "__tests__",
  "fixtures",
  "fragile-range-scope.txt",
)

// Structural locators for the two scan-scope declarations. SHAPE-based, not
// value-based: they match the declaration LINE regardless of its value, so a
// value drift is REPORTED (the golden diff) instead of silently failing to
// find an exact-string anchor. If the declaration is renamed or the shape
// changes, extraction fails loudly with the fixture path to update.
const TARGET_DIRS_DECL = /^export const TARGET_DIRS = \[[^\]]*\]$/m
const TARGET_EXTS_DECL = /^const TARGET_EXTS = \/[^\n]*$/m

/**
 * Extract the live TARGET_DIRS/TARGET_EXTS declaration lines from the real
 * module source (structural shape). Throws with the fixture path if the
 * declaration shape changed (rename/restructure) - no silent ignore.
 */
function extractScopeDeclarations(src: string): { targetDirs: string; targetExts: string } {
  const dirs = src.match(TARGET_DIRS_DECL)
  const exts = src.match(TARGET_EXTS_DECL)
  if (!dirs || !exts) {
    throw new Error(
      "REVERSE MUTATION: could not locate the TARGET_DIRS/TARGET_EXTS declarations in fragile-range-patterns.mjs (structural shape changed) — update scripts/__tests__/fixtures/fragile-range-scope.txt AND this harness",
    )
  }
  return { targetDirs: dirs[0], targetExts: exts[0] }
}

/**
 * Verify the live module's scan-scope declarations match the versioned
 * GOLDEN COPY (canonicalProgram-normalized: layout noise tolerated, real
 * token changes caught). On drift, throws a CLEAR DIFF - expected golden
 * lines vs actual live lines + the fixture path - replacing the old bare
 * "anchor not found" failure. Returns the extracted declarations so the
 * caller can patch them. Exported for the divergence-guard mutation tests.
 */
export function assertScopeMatchesGolden(src: string): { targetDirs: string; targetExts: string } {
  const live = extractScopeDeclarations(src)
  const golden = canonicalProgram(fs.readFileSync(SCOPE_GOLDEN, "utf8"))
  const liveForm = canonicalProgram(`${live.targetExts}\n${live.targetDirs}`)
  if (golden !== liveForm) {
    throw new Error(
      [
        "REVERSE MUTATION: fragile-range-patterns.mjs scan-scope declarations drifted from the golden copy",
        `  golden copy (${path.relative(process.cwd(), SCOPE_GOLDEN)}):`,
        ...golden.split("\n").map((l) => `    ${l}`),
        "  live module (scripts/fragile-range-patterns.mjs):",
        ...liveForm.split("\n").map((l) => `    ${l}`),
        "  fix: update the golden copy to the live declarations (or restore the module) — the divergence guard in golden-copy-utils.test.ts enforces the sync",
      ].join("\n"),
    )
  }
  return live
}

/**
 * RULE OF THREE (EXTRACTED 2026-08 — the 3rd module-patch harness arrived
 * with the budget-routes GROWTH CONTRACT): writeModuleCopy is the SHARED
 * SCAFFOLD behind every suite that writes a TEMP COPY of a real manifest
 * module with contract-lifting patches — the fragile-range REVERSE
 * MUTATION (writePatchedModule below), the encoding-surface GROWTH CONTRACT
 * (writePatchedSurfaceModule in encoding-surface.test.ts) and the
 * budget-routes GROWTH CONTRACT (writePatchedRoutesModule in
 * budget-routes.test.ts). A 4th manifest suite builds ops and calls THIS
 * instead of copy-pasting the read-module / anchor / write-copy shape a 4th
 * time.
 *
 * Each op is (anchor, replace, onMissing): the anchor is a string (literal,
 * first occurrence) or a RegExp (the matched text — the whole structural
 * span the op rewrites), the replacement is a literal string or a replacer
 * receiving the matched text, and a MISSING anchor throws the onMissing
 * error — the same fail-loudly-on-shape-drift posture each harness kept
 * ("update the harness when legitimately edited"), so a module
 * rename/restructure can never degrade into a silent no-op. REGEX anchors
 * MUST be non-global (no `g` flag): the presence check matches once, so a
 * global flag would make the splice hit every occurrence while the anchor
 * semantics assume one.
 *
 * The splice goes through String.replace with a FUNCTION replacement, never
 * a string: a string replacement would interpret `$&`/`$1`-style sequences
 * in the NEW text, silently mangling patches whose content legitimately
 * contains `$`. REGEX anchors are re-matched for the splice (replace-on-
 * regex) instead of re-locating the matched text as a literal: the matched
 * TEXT could in principle appear earlier in the file, and a literal
 * first-occurrence splice would land at the wrong position.
 */
export interface ModulePatchOp {
  anchor: string | RegExp
  replace: string | ((match: string) => string)
  onMissing: string
}

export function writeModuleCopy(dir: string, modulePath: string, ops: ModulePatchOp[]): string {
  let src = fs.readFileSync(modulePath, "utf8")
  for (const op of ops) {
    if (typeof op.anchor === "string") {
      if (!src.includes(op.anchor)) {
        throw new Error(op.onMissing)
      }
      const replacement = typeof op.replace === "string" ? op.replace : op.replace(op.anchor)
      src = src.replace(op.anchor, () => replacement)
    } else {
      const matched = src.match(op.anchor)
      // length === 0 ENFORCES the non-global contract: with a `g` flag,
      // match() returns [] on no-match (truthy) — the fail-loudly throw
      // would silently pass and the replacer would receive undefined.
      if (!matched || matched.length === 0) {
        throw new Error(op.onMissing)
      }
      const replacement = typeof op.replace === "string" ? op.replace : op.replace(matched[0])
      src = src.replace(op.anchor, () => replacement)
    }
  }
  const modPath = path.join(dir, path.basename(modulePath))
  fs.writeFileSync(modPath, src)
  return modPath
}

/**
 * Write a patched temp copy of fragile-range-patterns.mjs (contracts
 * lifted per `patch`) into `dir` and return the copy's path. First verifies
 * the live declarations match the golden copy (clear diff on drift), then
 * patches the EXTRACTED lines through the shared writeModuleCopy scaffold —
 * so the lift is applied to whatever the module actually declares today (as
 * long as it is in sync with the snapshot).
 */
function writePatchedModule(dir: string, patch: { targetDirs?: string[]; extsAddMd?: boolean }): string {
  const src = fs.readFileSync(REAL_FRAGILE_MODULE, "utf8")
  const decls = assertScopeMatchesGolden(src)
  const ops: ModulePatchOp[] = []
  if (patch.targetDirs) {
    ops.push({
      anchor: decls.targetDirs,
      replace: `export const TARGET_DIRS = ${JSON.stringify(patch.targetDirs)}`,
      onMissing:
        "REVERSE MUTATION: TARGET_DIRS declaration anchor missing (golden sync passed but the extracted line vanished) — update this harness",
    })
  }
  if (patch.extsAddMd) {
    // Lift the extracted regex literal: append |md to the char-class group.
    // The declaration line ends with )$/ - insert |md right before it. The
    // golden sync transitively guarantees the trailing shape today, but the
    // guard below converts a would-be silent no-op into a clear harness
    // error if that shape ever changes (belt-and-suspenders).
    const lifted = decls.targetExts.replace(/\)\$\/$/, "|md)$/")
    if (lifted === decls.targetExts) {
      throw new Error(
        "REVERSE MUTATION: could not lift TARGET_EXTS (expected trailing ')$/' not found) — the golden-copy sync or the declaration shape changed",
      )
    }
    ops.push({
      anchor: decls.targetExts,
      replace: lifted,
      onMissing:
        "REVERSE MUTATION: TARGET_EXTS declaration anchor missing (golden sync passed but the extracted line vanished) — update this harness",
    })
  }
  return writeModuleCopy(dir, REAL_FRAGILE_MODULE, ops)
}

/**
 * Write ONLY the patched module copy (no runner) and return its path. Used
 * by the WRAPPER-level reverse mutation: verify-encoding.sh layer 3 runs
 * the module via the FRAGILE_MODULE env override, so the wrapper executes
 * the temp copy with the lifted contracts through its real wiring.
 */
export function patchModuleFile(patch: { targetDirs?: string[]; extsAddMd?: boolean }): string {
  const dir = createTempDir("frg-revmod-")
  return writePatchedModule(dir, patch)
}

/**
 * Write the patched module copy PLUS a tiny runner that imports it and
 * calls scanExecutableCode(root); returns the RUNNER path (the
 * module-level reverse-mutation shape, for runReverseMutation).
 */
export function patchModuleCopy(patch: { targetDirs?: string[]; extsAddMd?: boolean }): string {
  const dir = createTempDir("frg-revmod-")
  writePatchedModule(dir, patch)
  const runnerPath = path.join(dir, "run-scan.mjs")
  fs.writeFileSync(
    runnerPath,
    [
      `import { scanExecutableCode } from "./fragile-range-patterns.mjs"`,
      `const offs = scanExecutableCode(process.argv[2])`,
      `process.stdout.write(JSON.stringify(offs))`,
      `process.exit(offs.length > 0 ? 1 : 0)`,
      "",
    ].join("\n"),
  )
  return runnerPath
}

/**
 * Run the patched module's scanExecutableCode(root) as a real node process.
 * Delegates to the shared runSubprocess (env inherit + utf8 + 30s timeout)
 * rather than re-implementing the shape.
 */
export function runReverseMutation(runnerPath: string, root: string) {
  return runSubprocess({ command: process.execPath, args: [runnerPath, root] })
}

/**
 * RULE OF THREE (EXTRACTED 2026-08 - the 3rd wrapper mutation test arrived
 * with the wrapper-level REVERSE MUTATION): the wrapper's FULL 5-assertion
 * layer-3 mutation block (aggregation + isolation L1/L2 + propagation +
 * count-pin) now lives HERE as this helper - all 3 callers in
 * verify-encoding.test.ts run runGate(["--ci", "src/"], env) through it:
 * the FRAGILE_SCAN_ROOT dirty-gate-file test, the FRAGILE_SCAN_DIRS dirty
 * target test, and the FRAGILE_MODULE reverse-mutation test. A 4th wrapper
 * mutation test calls THIS helper - never copies the 5 lines again. (The
 * full wrapper-vs-CLI division of responsibility is documented in the
 * verify-encoding.test.ts docblock.)
 *
 * Asserts (in order): worst-exit aggregation (status 1), layer-1
 * isolation (check-utf8 clean), layer-2 isolation (proof clean), layer-3
 * propagation ("fragile-range:" on stderr), and the UNCONDITIONAL
 * count-pin (expectSoleFailureCount(..., 1) - every caller sets BOTH
 * layer-3 overrides, so layer 3 scans zero real surface and the synthetic
 * fixture is the sole failure source by construction). Returns the raw
 * result so a caller may add fixture-specific asserts on top.
 */
export function expectLayer3FailsThroughWrapper(
  env: Record<string, string>,
  script = path.resolve(process.cwd(), "scripts", "verify-encoding.sh"),
): SpawnResult {
  const r = runSubprocess({ command: "bash", args: [script, "--ci", "src/"], env })
  expect(r.status).toBe(1) // worst-exit aggregation
  expect(r.stdout).toContain("check-utf8: done (all clean)") // layer 1 isolation
  expect(r.stdout).toContain("verify-ascii-proof: done (all clean)") // layer 2 isolation
  expect(r.stderr).toContain("fragile-range:") // layer 3 propagated through the wrapper
  // Count pinned to 1 - UNCONDITIONAL: layer 3 scans only synthetic trees
  // (both overrides set), so the sole failure source is the fixture itself
  // and no real-repo regression can masquerade as it.
  expectSoleFailureCount(r.stderr, 1)
  return r
}

/**
 * Run a subprocess (bash/awk/...) with the shared shape every shim harness
 * used: env merged over process.env, utf8 decoding, 30s timeout (kill on
 * hang so a broken loop fails the suite instead of stalling CI). Returns
 * status + decoded stdout/stderr ("" when the stream is absent).
 */
export function runSubprocess(opts: {
  command: string
  args: string[]
  env?: Record<string, string>
  timeoutMs?: number
  /** Working directory for the child (defaults to the parent's CWD). */
  cwd?: string
}): SpawnResult {
  const r = spawnSync(opts.command, opts.args, {
    env: { ...process.env, ...opts.env },
    encoding: "utf8",
    timeout: opts.timeoutMs ?? 30_000,
    cwd: opts.cwd,
  })
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" }
}

// Temp-dir registry: harnesses create fixture dirs (report files, shim
// counter/log files) via createTempDir and clean them up in afterEach via
// cleanupTempDirs — same lifecycle the suites used inline, centralized.
const tempDirs: string[] = []

/** Create a temp dir tracked by the shared registry (cleaned in afterEach). */
export function createTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

/** Remove every temp dir created since the last call (call in afterEach). */
export function cleanupTempDirs(): void {
  for (const d of tempDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
}
