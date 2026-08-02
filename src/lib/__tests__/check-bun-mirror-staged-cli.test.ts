/**
 * check-bun-mirror-staged-cli.test.ts
 *
 * Teste de INTEGRAÇÃO do main() do guard scripts/check-bun-mirror.mjs no modo
 * `--staged`: spawna a CLI REAL (process.execPath — robusto no Windows)
 * contra um repositório git TEMPORÁRIO REAL (git init + git add + git commit),
 * validando o CONTRATO DE EXIT CODES do main():
 *
 *   exit 0  — diff staged limpo (sem violações introduzidas)
 *   exit 1  — diff staged COM violação (key literal bun-1.3.14-... / literal
 *             bun-version: 1.3.14 introduzidos pelo diff)
 *   exit 2  — infra: `--base` inválido (gitDiffWorkflows retorna null) ou
 *             fora de repositório git (git diff --cached falha)
 *
 * Diferente do check-bun-mirror-cli.test.ts (que cobre o scan GLOBAL via
 * makeBaseRepo com mirror válido), este foca no caminho staged→main(): o
 * git diff é REAL (arquivos efetivamente staged), não texto de diff fake
 * injetado nas funções puras (já coberto pelo check-bun-mirror.test.ts).
 * Como o main() em --staged só lê o diff de .github/workflows, os fixtures
 * NÃO precisam de mirror/action/Dockerfile válidos — o guard nem os consulta
 * nesse modo.
 *
 * ATENÇÃO (esbuild): `${{` e `${...}` do GitHub Actions precisam de escape
 * (`\${{`, `\${...}`) dentro de template literals — senão o esbuild lê `${`
 * como interpolação e o arquivo nem compila.
 *
 * Usage:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/check-bun-mirror-staged-cli.test.ts
 */

import { describe, it, expect, afterEach } from "vitest"
import { execFileSync, spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const SCRIPT = resolve(process.cwd(), "scripts/check-bun-mirror.mjs")
const tmpDirs: string[] = []

/** Cria um repo git REAL temporário (autocrlf=false — bytes crus). */
function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "cbun-staged-cli-"))
  tmpDirs.push(dir)
  execFileSync("git", ["init", "-q"], { cwd: dir })
  execFileSync("git", ["config", "user.email", "t@t"], { cwd: dir })
  execFileSync("git", ["config", "user.name", "t"], { cwd: dir })
  execFileSync("git", ["config", "core.autocrlf", "false"], { cwd: dir })
  return dir
}

/** Cria .github/workflows/<name> com o conteúdo dado (working tree). */
function addWorkflow(dir: string, name: string, content: string): void {
  mkdirSync(join(dir, ".github", "workflows"), { recursive: true })
  writeFileSync(join(dir, ".github", "workflows", name), content, "utf8")
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

/** Workflow com cache key bun VÁLIDA (fonte única) — diff staged limpo. */
const VALID_KEY = `name: Fake
jobs:
  job:
    runs-on: ubuntu-latest
    steps:
      - name: Cache node_modules
        uses: actions/cache@v4
        with:
          path: node_modules
          key: bun-\${{ vars.BUN_VERSION }}-\${{ hashFiles('bun.lock') }}
          restore-keys: bun-\${{ vars.BUN_VERSION }}-
`

/** Workflow com key LITERAL antiga (bun-1.3.14-...) — violação do diff. */
const LITERAL_KEY = `name: Fake
jobs:
  job:
    runs-on: ubuntu-latest
    steps:
      - name: Cache node_modules
        uses: actions/cache@v4
        with:
          path: node_modules
          key: bun-1.3.14-\${{ hashFiles('bun.lock') }}
          restore-keys: bun-1.3.14-
`

/** Call site do setup-bun com literal bun-version: 1.3.14 — violação do diff. */
const LITERAL_CALL_SITE = `name: Fake
jobs:
  job:
    runs-on: ubuntu-latest
    steps:
      - name: Setup Bun
        uses: ./.github/actions/setup-bun
        with:
          bun-version: 1.3.14
`

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe("check-bun-mirror.mjs --staged — integração do main() com git real", () => {
  it("exit 0: workflow staged com key bun VÁLIDA (vars.BUN_VERSION)", () => {
    const dir = makeRepo()
    addWorkflow(dir, "fake.yml", VALID_KEY)
    stage(dir, ".github/workflows/fake.yml")

    const { status, out } = runStaged(dir)
    expect(status).toBe(0)
    expect(out).toContain("Diff ok")
  })

  it("exit 0: nada staged (repo vazio, sem workflow) — git diff --cached vazio", () => {
    const dir = makeRepo()

    const { status, out } = runStaged(dir)
    expect(status).toBe(0)
    expect(out).toContain("Diff ok")
  })

  it("exit 1: workflow staged com key LITERAL antiga (bun-1.3.14-)", () => {
    const dir = makeRepo()
    addWorkflow(dir, "fake.yml", LITERAL_KEY)
    stage(dir, ".github/workflows/fake.yml")

    const { status, out } = runStaged(dir)
    expect(status).toBe(1)
    expect(out).toContain("violação(ões)")
    expect(out).toContain("fake.yml:")
    expect(out).toContain("bun-1.3.14")
  })

  it("exit 1: call site staged com literal bun-version: 1.3.14", () => {
    const dir = makeRepo()
    addWorkflow(dir, "deploy.yml", LITERAL_CALL_SITE)
    stage(dir, ".github/workflows/deploy.yml")

    const { status, out } = runStaged(dir)
    expect(status).toBe(1)
    expect(out).toContain("violação(ões)")
    expect(out).toContain("deploy.yml:")
    expect(out).toContain("bun-version='1.3.14'")
  })

  it("exit 0: --base HEAD sem diff (controle — baseline COMMITADO idêntico)", () => {
    // Baseline com key válida COMMITADA → depois staged idêntico (sem diff).
    const dir = makeRepo()
    addWorkflow(dir, "fake.yml", VALID_KEY)
    commitAll(dir)

    const { status, out } = runStaged(dir, ["--base", "HEAD"])
    expect(status).toBe(0)
    expect(out).toContain("Diff ok")
  })

  it("exit 1: --base HEAD~1 com diff base...HEAD introduzindo literal (COMMITADO)", () => {
    const dir = makeRepo()
    addWorkflow(dir, "fake.yml", VALID_KEY)
    commitAll(dir, "baseline") // HEAD~1 = key válida
    addWorkflow(dir, "fake.yml", LITERAL_KEY)
    commitAll(dir, "literal") // HEAD = literal — diff HEAD~1...HEAD a vê

    const { status, out } = runStaged(dir, ["--base", "HEAD~1"])
    expect(status).toBe(1)
    // A mensagem de VIOLAÇÃO não imprime o sufixo "vs base X" (só o caminho
    // de sucesso o faz) — valida a violação real detectada no diff do base.
    expect(out).toContain("fake.yml:")
    expect(out).toContain("bun-1.3.14")
  })

  it("exit 2: --base com ref INVÁLIDA (metacharacter de shell)", () => {
    const dir = makeRepo()
    addWorkflow(dir, "fake.yml", VALID_KEY)
    stage(dir, ".github/workflows/fake.yml")

    // isValidGitRef rejeita `;` — gitDiffWorkflows retorna null → exit 2.
    const { status, out } = runStaged(dir, ["--base", "main; rm -rf /"])
    expect(status).toBe(2)
    expect(out).toContain("git diff indisponível")
    expect(out).toContain("main; rm -rf /")
  })

  it("exit 2: --base com ref que não existe no repo (git diff falha)", () => {
    const dir = makeRepo()
    addWorkflow(dir, "fake.yml", VALID_KEY)
    commitAll(dir)
    addWorkflow(dir, "fake.yml", LITERAL_KEY)
    stage(dir, ".github/workflows/fake.yml")

    // ref sintaticamente válida MAS inexistente → git diff origin/nope...HEAD falha
    const { status, out } = runStaged(dir, ["--base", "origin/nope"])
    expect(status).toBe(2)
    expect(out).toContain("git diff indisponível")
  })

  it("exit 2: fora de repositório git (git diff --cached falha)", () => {
    const dir = mkdtempSync(join(tmpdir(), "cbun-staged-nogit-"))
    tmpDirs.push(dir)
    // NOTA: sem git init — o guard não deve conseguir rodar o diff.

    const { status, out } = runStaged(dir)
    expect(status).toBe(2)
    expect(out).toContain("git diff indisponível")
  })
})
