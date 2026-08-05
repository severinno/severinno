/**
 * check-mutation-timing-contract-staged-cli.test.ts
 *
 * Teste de INTEGRAÇÃO do main() do guard scripts/check-mutation-timing-contract.mjs
 * no modo `--staged`: spawna a CLI REAL (process.execPath — robusto no
 * Windows) contra um repositório git TEMPORÁRIO REAL (git init + git add +
 * git commit), validando o CONTRATO DE EXIT CODES do modo --staged:
 *
 *   exit 0  — índice (git show :path) com os 4 locais do contrato consistentes
 *   exit 1  — rename do job/step do seed-guards.yml STAGED sem os outros 3
 *             locais staged (estágio parcial — o que o check global do
 *             working tree não pega se o working tree já estiver migrado)
 *   exit 2  — infra: --base inválido (ref fora do whitelist), ref que não
 *             existe no repo, ou fora de repositório git (git show falha)
 *
 * O cenário principal espelha o bug que o --staged existe para prevenir: um
 * PR renomeia o job 'Mutation Test (contrato coordenado — ...)' no
 * seed-guards.yml e STAGEIA SÓ esse arquivo — os outros 3 locais (medidor,
 * mutation test, unit test) ficam com o nome antigo NO ÍNDICE (o que seria
 * commitado). O check global lê o working tree (que pode já estar migrado);
 * o --staged lê o ÍNDICE → o contrato diverge → exit 1 ANTES do merge.
 *
 * Diferente do check-mutation-timing-contract.test.ts (que cobre funções
 * puras + --root com fixtures em disco), este foca no caminho staged→main():
 * o git show é REAL (arquivos efetivamente staged), não conteúdo fake
 * injetado nas funções puras.
 *
 * ATENÇÃO (esbuild): `${{` e `${...}` do GitHub Actions precisam de escape
 * (`\${{`, `\${...}`) dentro de template literals — senão o esbuild lê `${`
 * como interpolação e o arquivo nem compila.
 *
 * Usage:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/check-mutation-timing-contract-staged-cli.test.ts
 */

import { describe, it, expect, afterEach } from "vitest"
import { execFileSync, spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const SCRIPT = resolve(process.cwd(), "scripts/check-mutation-timing-contract.mjs")
const tmpDirs: string[] = []

/** Cria um repo git REAL temporário (autocrlf=false — bytes crus). */
function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "cmtc-staged-cli-"))
  tmpDirs.push(dir)
  execFileSync("git", ["init", "-q"], { cwd: dir })
  execFileSync("git", ["config", "user.email", "t@t"], { cwd: dir })
  execFileSync("git", ["config", "user.name", "t"], { cwd: dir })
  execFileSync("git", ["config", "core.autocrlf", "false"], { cwd: dir })
  return dir
}

// ── Fixtures dos 4 arquivos do contrato (espelham o teste unitário) ─────

const CONTRACT_JOB = "Mutation Test (contrato coordenado — doc↔anchor↔código, 5 cenários)"
const CONTRACT_STEP = "Run mutation test (contrato coordenado — 5 cenários, 2 elos)"
const SEED_DEV_JOB = "Mutation Test (seed dev E2E pega regressões?)"
const SEED_DEV_STEP = "Run mutation test (seed dev E2E deve FALHAR)"
const JOB_MARKER = "contrato coordenado"
const STEP_MARKER = "Run mutation test"

function seedGuardsContent(jobName = CONTRACT_JOB, stepName = CONTRACT_STEP): string {
  return `name: Seed Guards

on:
  workflow_dispatch:

jobs:
  seed-dev-e2e:
    name: ${SEED_DEV_JOB}
    runs-on: ubuntu-latest
    steps:
      - name: ${SEED_DEV_STEP}
        run: echo seed
  mutation-coord-update:
    name: ${jobName}
    runs-on: ubuntu-latest
    steps:
      - name: ${stepName}
        run: echo coord
`
}

function medidorContent(jobMarker = JOB_MARKER, stepMarker = STEP_MARKER): string {
  return `export const JOB_NAME_MARKER = "${jobMarker}"
export const STEP_NAME_MARKER = "${stepMarker}"
`
}

function mutationTestContent(jobName = CONTRACT_JOB, stepName = CONTRACT_STEP): string {
  return `#!/usr/bin/env bash
JOB_NAME="${jobName}"
STEP_NAME="${stepName}"
`
}

function unitTestContent(jobName = CONTRACT_JOB, stepName = CONTRACT_STEP): string {
  return `const payload = {
  jobs: [
    { name: "${SEED_DEV_JOB}", steps: [{ name: "${SEED_DEV_STEP}" }] },
    { name: "${jobName}", steps: [{ name: "${stepName}" }] },
  ],
}
`
}

/** Escreve os 4 arquivos do contrato no repo (working tree). */
function writeContractFiles(dir: string, opts?: { jobName?: string; stepName?: string }): void {
  const { jobName = CONTRACT_JOB, stepName = CONTRACT_STEP } = opts ?? {}
  mkdirSync(join(dir, ".github", "workflows"), { recursive: true })
  mkdirSync(join(dir, "scripts"), { recursive: true })
  mkdirSync(join(dir, "src", "lib", "__tests__"), { recursive: true })
  writeFileSync(
    join(dir, ".github", "workflows", "seed-guards.yml"),
    seedGuardsContent(jobName, stepName),
    "utf8",
  )
  writeFileSync(join(dir, "scripts", "measure-mutation-timing.mjs"), medidorContent(), "utf8")
  writeFileSync(
    join(dir, "scripts", "test-mutation-timing-budget.sh"),
    mutationTestContent(jobName, stepName),
    "utf8",
  )
  writeFileSync(
    join(dir, "src", "lib", "__tests__", "measure-mutation-timing.test.ts"),
    unitTestContent(jobName, stepName),
    "utf8",
  )
}

/** git add <file> — deixa o arquivo STAGED (objeto do teste). */
function stage(dir: string, file: string): void {
  execFileSync("git", ["add", "--", file], { cwd: dir })
}

/** git commit -qm — baseline para os testes com --base. */
function commitAll(dir: string, msg = "init"): void {
  execFileSync("git", ["add", "-A"], { cwd: dir })
  execFileSync("git", ["commit", "-qm", msg], { cwd: dir })
}

/** Roda a CLI REAL com `--staged` (+ args opcionais) no cwd do repo fake. */
function runStaged(cwd: string, extra: string[] = []): { status: number | null; out: string } {
  const res = spawnSync(process.execPath, [SCRIPT, "--staged", ...extra], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
  return { status: res.status, out: `${res.stdout ?? ""}${res.stderr ?? ""}` }
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe("check-mutation-timing-contract.mjs --staged — integração do main() com git real", () => {
  it("exit 0: 4 arquivos consistentes STAGED → contrato ok", () => {
    const dir = makeRepo()
    writeContractFiles(dir)
    stage(dir, ".github/workflows/seed-guards.yml")
    stage(dir, "scripts/measure-mutation-timing.mjs")
    stage(dir, "scripts/test-mutation-timing-budget.sh")
    stage(dir, "src/lib/__tests__/measure-mutation-timing.test.ts")

    const { status, out } = runStaged(dir)
    expect(status).toBe(0)
    expect(out).toContain("Contrato de markers do mutation-coord consistente")
    expect(out).toContain("staged")
    expect(out).toContain(CONTRACT_JOB)
  })

  it("exit 1: rename do job no seed-guards STAGED sem os outros 3 → contrato diverge no ÍNDICE", () => {
    // O cenário central do --staged: o PR renomeia o job no seed-guards e
    // STAGEIA SÓ esse arquivo. Os outros 3 locais ficam com o nome antigo no
    // ÍNDICE (o que seria commitado) — o check global do working tree pode
    // até passar (working tree já migrado), mas o staged falha ANTES do merge.
    //
    // O rename MANTÉM o marker 'contrato coordenado' (ex.: '— 6 cenários' no
    // lugar de '— 5 cenários'): só assim a resolução do contrato chega à
    // DIVERGÊNCIA DE NOME (JOB_NAME do mutation test ≠ job real) — se o
    // rename DERRUBASSE o marker, o guard acusaria drift de marker primeiro
    // (check inicial) e a mensagem não seria a do estágio parcial.
    const dir = makeRepo()
    writeContractFiles(dir)
    // baseline commitado consistente — depois só o seed-guards muda no index
    commitAll(dir, "baseline")
    const newJob = "Mutation Test (contrato coordenado — doc↔anchor↔código, 6 cenários)"
    writeContractFiles(dir, { jobName: newJob })
    stage(dir, ".github/workflows/seed-guards.yml") // SÓ o seed-guards é staged

    const { status, out } = runStaged(dir)
    expect(status).toBe(1)
    expect(out).toContain("inconsistente entre os 4 locais")
    expect(out).toContain("JOB_NAME do mutation test")
    expect(out).toContain(newJob)
    expect(out).toContain(CONTRACT_JOB)
  })

  it("exit 0: rename COORDENADO (4 arquivos staged) → contrato consistente", () => {
    // O rename legítimo: TODOS os 4 locais staged com o nome novo (mantendo o
    // marker 'contrato coordenado') — o índice fica consistente e o guard
    // passa (o estágio parcial é o que falha, não o rename coordenado).
    const dir = makeRepo()
    const newJob = "Mutation Test (contrato coordenado — doc↔anchor↔código, 6 cenários)"
    writeContractFiles(dir, { jobName: newJob })
    stage(dir, ".github/workflows/seed-guards.yml")
    stage(dir, "scripts/measure-mutation-timing.mjs")
    stage(dir, "scripts/test-mutation-timing-budget.sh")
    stage(dir, "src/lib/__tests__/measure-mutation-timing.test.ts")

    const { status, out } = runStaged(dir)
    expect(status).toBe(0)
    expect(out).toContain("Contrato de markers do mutation-coord consistente")
    expect(out).toContain(newJob)
  })

  it("exit 1: REMOÇÃO do job do contrato staged (job some do seed-guards) → contrato quebra", () => {
    // O reverse do rename: o PR REMOVE o job do contrato do seed-guards (ou
    // renomeia para algo SEM o marker) sem remover os outros 3 — o medidor
    // (includes) nunca acharia o job → drift de marker.
    const dir = makeRepo()
    writeContractFiles(dir)
    commitAll(dir, "baseline")
    writeContractFiles(dir, {
      jobName: "Mutation Test (validação da doc — 5 cenários)", // sem o marker 'contrato coordenado'
    })
    stage(dir, ".github/workflows/seed-guards.yml")

    const { status, out } = runStaged(dir)
    expect(status).toBe(1)
    expect(out).toContain("nenhum job 'Mutation Test (...)'")
    expect(out).toContain(JOB_MARKER)
  })

  it("exit 0: --base HEAD com baseline commitado consistente (controle)", () => {
    const dir = makeRepo()
    writeContractFiles(dir)
    commitAll(dir, "baseline")

    const { status, out } = runStaged(dir, ["--base", "HEAD"])
    expect(status).toBe(0)
    expect(out).toContain("Contrato de markers do mutation-coord consistente")
  })

  it("exit 1: --base HEAD com rename quebrado commitado → o ref vê o contrato divergente", () => {
    // --base lê o estado da REF (git show ref:path) — HEAD~1 é o baseline
    // consistente; HEAD tem o rename quebrado commitado. O guard na ref HEAD
    // vê o drift (a ref é a fonte, não o working tree). Rename MANTÉM o
    // marker (— 6 cenários) para a mensagem ser a divergência de JOB_NAME.
    // NOTA: HEAD~1 não é usado aqui — a ref `~` está fora do whitelist do
    // isValidGitRef (fail-closed); refs suportadas: HEAD, origin/main, tags.
    const dir = makeRepo()
    writeContractFiles(dir)
    commitAll(dir, "baseline") // HEAD~1 = consistente
    const newJob = "Mutation Test (contrato coordenado — doc↔anchor↔código, 6 cenários)"
    writeContractFiles(dir, { jobName: newJob })
    // SÓ o seed-guards vai para o commit 'broken-rename' — o commitAll faria
    // git add -A (estagiaria os 4 arquivos → rename coordenado → HEAD
    // consistente). O estado quebrado exige que os outros 3 fiquem com o nome
    // antigo COMMITADO.
    execFileSync("git", ["add", "--", ".github/workflows/seed-guards.yml"], { cwd: dir })
    execFileSync("git", ["commit", "-qm", "broken-rename"], { cwd: dir }) // HEAD = quebrado

    const { status, out } = runStaged(dir, ["--base", "HEAD"])
    expect(status).toBe(1)
    expect(out).toContain("inconsistente entre os 4 locais")
    expect(out).toContain("JOB_NAME do mutation test")
    expect(out).toContain(newJob)
  })

  it("exit 2: --base com ref INVÁLIDA (metacharacter de shell)", () => {
    const dir = makeRepo()
    writeContractFiles(dir)
    stage(dir, ".github/workflows/seed-guards.yml")

    const { status, out } = runStaged(dir, ["--base", "main; rm -rf /"])
    expect(status).toBe(2)
    expect(out).toContain("ref inválida")
    expect(out).toContain("main; rm -rf /")
  })

  it("exit 2: --base com ref que não existe no repo (git show falha)", () => {
    const dir = makeRepo()
    writeContractFiles(dir)
    commitAll(dir)

    const { status, out } = runStaged(dir, ["--base", "origin/nope"])
    expect(status).toBe(2)
    expect(out).toContain("git show")
  })

  it("exit 2: fora de repositório git (git show :path falha)", () => {
    const dir = mkdtempSync(join(tmpdir(), "cmtc-staged-nogit-"))
    tmpDirs.push(dir)
    // NOTA: sem git init — o guard não deve conseguir ler o índice.

    const { status, out } = runStaged(dir)
    expect(status).toBe(2)
    expect(out).toContain("git show")
  })

  it("exit 2: --base sem --staged (o --base só tem efeito no modo --staged)", () => {
    const dir = makeRepo()
    writeContractFiles(dir)
    commitAll(dir)

    const res = spawnSync(process.execPath, [SCRIPT, "--base", "HEAD"], {
      cwd: dir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    })
    expect(res.status).toBe(2)
    expect(`${res.stdout ?? ""}${res.stderr ?? ""}`).toContain("--base exige --staged")
  })
})
