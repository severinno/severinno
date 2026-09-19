/**
 * check-bun-mirror-staged-cli.test.ts
 *
 * Teste de INTEGRAÇÃO do main() do guard scripts/check-bun-mirror.mjs no modo
 * `--staged`: spawna a CLI REAL (process.execPath — robusto no Windows)
 * contra um repositório git TEMPORÁRIO REAL (git init + git add + git commit),
 * validando o CONTRATO DE EXIT CODES do main():
 *
 *   exit 0  — diff staged limpo (sem violações introduzidas)
 *   exit 1  — diff staged COM violação (key literal bun-1.3.14-... / chamada
 *             do setup com versão literal introduzidos pelo diff)
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

/** Chamada do setup com versão LITERAL no argumento — violação do diff. */
const LITERAL_CALL_SITE = `name: Fake
jobs:
  job:
    runs-on: ubuntu-latest
    steps:
      - name: Setup Bun
        shell: bash
        run: bash scripts/setup-bun-ci.sh "1.3.14"
`

/** Chamada do setup OK (fonte única) — baseline para testar a REMOÇÃO. */
const OK_CALL_SITE = `name: Fake
jobs:
  job:
    runs-on: ubuntu-latest
    steps:
      - name: Setup Bun
        shell: bash
        run: bash scripts/setup-bun-ci.sh "\${{ vars.BUN_VERSION }}"
`

/** Job cuja chamada do setup SUMIU — a REMOÇÃO (regressão). */
const MISSING_CALL_SITE = `name: Fake
jobs:
  job:
    runs-on: ubuntu-latest
    steps:
      - run: echo outro
`

/** Workflow com key LITERAL + env BUN_VERSION literal (base da migração). */
const LITERAL_KEY_AND_CALL = `name: Fake
env:
  BUN_VERSION: 1.3.14
jobs:
  job:
    runs-on: ubuntu-latest
    steps:
      - name: Setup Bun
        shell: bash
        run: bash scripts/setup-bun-ci.sh "\${{ vars.BUN_VERSION }}"
      - name: Cache node_modules
        uses: actions/cache@v4
        with:
          path: node_modules
          key: bun-1.3.14-\${{ hashFiles('bun.lock') }}
          restore-keys: bun-1.3.14-
`

/** Migração INCOMPLETA: key literal migrada para vars, mas o env BUN_VERSION SOBREVIVE. */
const PARTIAL_MIGRATION = `name: Fake
env:
  BUN_VERSION: 1.3.14
jobs:
  job:
    runs-on: ubuntu-latest
    steps:
      - name: Setup Bun
        shell: bash
        run: bash scripts/setup-bun-ci.sh "\${{ vars.BUN_VERSION }}"
      - name: Cache node_modules
        uses: actions/cache@v4
        with:
          path: node_modules
          key: bun-\${{ vars.BUN_VERSION }}-\${{ hashFiles('bun.lock') }}
          restore-keys: bun-\${{ vars.BUN_VERSION }}-
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

  it("exit 1: chamada do setup staged com versão LITERAL no argumento", () => {
    const dir = makeRepo()
    addWorkflow(dir, "deploy.yml", LITERAL_CALL_SITE)
    stage(dir, ".github/workflows/deploy.yml")

    const { status, out } = runStaged(dir)
    expect(status).toBe(1)
    expect(out).toContain("violação(ões)")
    expect(out).toContain("deploy.yml:")
    expect(out).toContain("1.3.14")
    expect(out).toContain("fonte única")
  })

  it("exit 1: REMOÇÃO da chamada do setup de um job PRÉ-EXISTENTE (regressão)", () => {
    // Chamada OK COMMITADA (baseline) → working tree SEM a chamada (o job
    // segue com outro step) → staged. O diff mostra as linhas da chamada como
    // REMOVIDAS sem substituta — o check de ADIÇÃO não vê (não há linha nova
    // com o script), então o checkStagedRemovedSetupBunCall pega a regressão.
    const dir = makeRepo()
    addWorkflow(dir, "deploy.yml", OK_CALL_SITE)
    commitAll(dir, "baseline") // HEAD com call site OK
    addWorkflow(dir, "deploy.yml", MISSING_CALL_SITE)
    stage(dir, ".github/workflows/deploy.yml")

    const { status, out } = runStaged(dir)
    expect(status).toBe(1)
    expect(out).toContain("violação(ões)")
    expect(out).toContain("deploy.yml:")
    expect(out).toContain("REMOÇÃO")
    expect(out).toContain("sem substituta")
    expect(out).toContain("setup-bun-ci.sh")
  })

  it("exit 0: MIGRAÇÃO da chamada (sai a antiga, entra a nova) não é regressão", () => {
    // A REMOÇÃO da chamada só é regressão quando o job fica SEM setup: se o
    // mesmo arquivo TAMBÉM ganha uma chamada do script, é a migração legítima
    // (ex.: `uses: ./.github/actions/setup-bun` → `run: bash scripts/setup-bun-ci.sh`).
    const dir = makeRepo()
    addWorkflow(
      dir,
      "deploy.yml",
      `name: Fake
jobs:
  job:
    runs-on: ubuntu-latest
    steps:
      - name: Setup Bun
        uses: ./.github/actions/setup-bun
`,
    )
    commitAll(dir, "baseline")
    addWorkflow(dir, "deploy.yml", OK_CALL_SITE)
    stage(dir, ".github/workflows/deploy.yml")

    const { status, out } = runStaged(dir)
    expect(status).toBe(0)
    expect(out).toContain("Diff ok")
  })

  it("exit 1: key literal REMOVIDA + env BUN_VERSION literal SOBREVIVENTE na janela (migração incompleta)", () => {
    // Baseline com key + env BUN_VERSION LITERAIS COMMITADO → working tree
    // migra SÓ a key para vars (o `BUN_VERSION: 1.3.14` do env SOBREVIVE como
    // CONTEXTO no diff) → staged. O checkStagedLiterals (só linhas +) não vê
    // o literal de contexto; o checkStagedRemovedLiterals é o que pega a
    // migração incompleta introduzida pelo diff.
    const dir = makeRepo()
    addWorkflow(dir, "deploy.yml", LITERAL_KEY_AND_CALL)
    commitAll(dir, "baseline") // HEAD com literais
    addWorkflow(dir, "deploy.yml", PARTIAL_MIGRATION)
    stage(dir, ".github/workflows/deploy.yml")

    const { status, out } = runStaged(dir)
    expect(status).toBe(1)
    expect(out).toContain("violação(ões)")
    expect(out).toContain("deploy.yml:")
    expect(out).toContain("SOBREVIVE ao lado de literal REMOVIDO")
    expect(out).toContain("migração incompleta")
    // TRAVA o -U${DIFF_CONTEXT}: a âncora é a key literal REMOVIDA (linha 15
    // do fixture) e o SOBREVIVENTE é o env da linha 3 — se o contexto do git
    // diff voltar ao default de 3 linhas, a linha 3 some do diff e a
    // violação deixa de ser produzida.
    expect(out).toContain("deploy.yml:3: literal do Bun SOBREVIVE")
    expect(out).toContain("(linha 15)")
  })

  it("exit 0: MIGRAÇÃO COMPLETA (key E env literais migrados) não é regressão", () => {
    // A migração remove os DOIS literais — nenhum sobrevive na região.
    const dir = makeRepo()
    addWorkflow(dir, "deploy.yml", LITERAL_KEY_AND_CALL)
    commitAll(dir, "baseline")
    addWorkflow(
      dir,
      "deploy.yml",
      `name: Fake
env:
  BUN_VERSION: \${{ vars.BUN_VERSION }}
jobs:
  job:
    runs-on: ubuntu-latest
    steps:
      - name: Setup Bun
        shell: bash
        run: bash scripts/setup-bun-ci.sh "\${{ vars.BUN_VERSION }}"
      - name: Cache node_modules
        uses: actions/cache@v4
        with:
          path: node_modules
          key: bun-\${{ vars.BUN_VERSION }}-\${{ hashFiles('bun.lock') }}
          restore-keys: bun-\${{ vars.BUN_VERSION }}-
`,
    )
    stage(dir, ".github/workflows/deploy.yml")

    const { status, out } = runStaged(dir)
    expect(status).toBe(0)
    expect(out).toContain("Diff ok")
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

  it("exit 1: --staged --base HEAD~1 — key antiga (bun-1.3.14-) ADICIONADA ao diff → mensagem clara", () => {
    // Espelho do unit checkStagedCacheKeys ("key antiga ADICIONADA pelo diff
    // → violação") no nível CLI real: baseline COMMITADO com key VÁLIDA
    // (HEAD~1), HEAD troca key+restore-keys para o literal antigo (mesmo
    // conteúdo do LITERAL_KEY já definido) — o diff base...HEAD mostra as
    // linhas como ADICIONADAS. Só linhas adicionadas são avaliadas, e a
    // violação aparece com arquivo:linha + a mensagem da fonte única
    // ("sem a fonte única").
    const dir = makeRepo()
    addWorkflow(dir, "fake.yml", VALID_KEY)
    commitAll(dir, "baseline") // HEAD~1 = key válida (fonte única)
    addWorkflow(dir, "fake.yml", LITERAL_KEY) // key + restore-keys literais
    commitAll(dir, "regressão") // HEAD = literal — diff HEAD~1...HEAD a vê

    const { status, out } = runStaged(dir, ["--base", "HEAD~1"])
    expect(status).toBe(1)
    expect(out).toContain("violação(ões)")
    expect(out).toContain("fake.yml:")
    expect(out).toContain("bun-1.3.14")
    // Contrato de MENSAGEM CLARA: aponta a fonte única e a correção
    expect(out).toContain("sem a fonte única")
    expect(out).toContain("vars.BUN_VERSION")
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
