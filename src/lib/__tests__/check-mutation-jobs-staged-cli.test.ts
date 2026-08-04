/**
 * check-mutation-jobs-staged-cli.test.ts
 *
 * Teste de INTEGRAÇÃO do main() do guard scripts/check-mutation-jobs.mjs no
 * modo `--staged`: spawna a CLI REAL (process.execPath — robusto no Windows)
 * contra um repositório git TEMPORÁRIO REAL (git init + git add + git commit),
 * validando o CONTRATO DE EXIT CODES do main() no caminho staged:
 *
 *   exit 0  — diff staged sem test-mutation-*.sh NOVO, script novo JÁ
 *             wireado na matriz do master (coberto no MESMO diff), ou run:
 *             de workflow NOVO apontando para script EXISTENTE
 *   exit 1  — diff staged com test-mutation-*.sh NOVO SEM cobertura (sem ref
 *             direta num workflow run: nem na matriz do master) — forward —
 *             OU um run: de workflow NOVO (linha adicionada pelo diff)
 *             apontando para test-mutation-*.sh INEXISTENTE — reverse
 *   exit 2  — infra: `--base` inválido (gitDiffMutationScope retorna null)
 *             ou fora de repositório git (git diff --cached falha)
 *
 * Diferente do check-mutation-jobs.test.ts (que cobre as funções PURAS com
 * texto de diff fake injetado), este valida o caminho staged→main(): o git
 * diff é REAL (arquivos efetivamente staged). O guard resolve scripts/,
 * .github/workflows/ e package.json a partir de process.cwd() — o fixture
 * é um mini-repo com a estrutura mínima (package.json {} + workflow com
 * run: bash scripts/test-mutation-guards.sh + master com matriz SUBTESTS +
 * folha real).
 *
 * ATENÇÃO (esbuild): `${{` e `${...}` do GitHub Actions precisam de escape
 * (`\${{`, `\${...}`) dentro de template literals — senão o esbuild lê `${`
 * como interpolação e o arquivo nem compila.
 *
 * Usage:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/check-mutation-jobs-staged-cli.test.ts
 */

import { describe, it, expect, afterEach } from "vitest"
import { execFileSync, spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const SCRIPT = resolve(process.cwd(), "scripts/check-mutation-jobs.mjs")
const tmpDirs: string[] = []

/** Cria um repo git REAL temporário (autocrlf=false — bytes crus). */
function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "cmj-staged-cli-"))
  tmpDirs.push(dir)
  execFileSync("git", ["init", "-q"], { cwd: dir })
  execFileSync("git", ["config", "user.email", "t@t"], { cwd: dir })
  execFileSync("git", ["config", "user.name", "t"], { cwd: dir })
  execFileSync("git", ["config", "core.autocrlf", "false"], { cwd: dir })
  return dir
}

/** Cria a estrutura mínima que o guard precisa (fail-closed: exit 2 sem elas). */
function buildFixture(dir: string): void {
  mkdirSync(join(dir, ".github", "workflows"), { recursive: true })
  mkdirSync(join(dir, "scripts"), { recursive: true })
  writeFileSync(join(dir, "package.json"), "{}\n", "utf8")
  // workflow com ref DIRETA ao master (run: single-line — o formato real)
  writeFileSync(
    join(dir, ".github", "workflows", "pr-check.yml"),
    `name: PR Check\njobs:\n  mutation-guards:\n    runs-on: ubuntu-latest\n    steps:\n      - name: Mutation tests\n        run: bash scripts/test-mutation-guards.sh\n`,
    "utf8",
  )
  // master com matriz SUBTESTS referenciando a folha real
  writeFileSync(
    join(dir, "scripts", "test-mutation-guards.sh"),
    `#!/usr/bin/env bash\nSUBTESTS=(\n  "real|Real — folha coberta|scripts/test-mutation-real.sh"\n)\n`,
    "utf8",
  )
  // folha existente referenciada pela matriz
  writeFileSync(
    join(dir, "scripts", "test-mutation-real.sh"),
    "#!/usr/bin/env bash\nexit 0\n",
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

describe("check-mutation-jobs.mjs --staged — integração do main() com git real", () => {
  it("exit 0: fixture limpo sem nada staged (git diff --cached vazio)", () => {
    const dir = makeRepo()
    buildFixture(dir)

    const { status, out } = runStaged(dir)
    expect(status).toBe(0)
    expect(out).toContain("Diff ok")
  })

  it("exit 0: script NOVO wireado na matriz do master no MESMO diff", () => {
    const dir = makeRepo()
    buildFixture(dir)
    // script novo + entrada na matriz do master, ambos staged — cobertura no
    // mesmo diff → NÃO é órfão (o mutation test roda via matriz transitiva).
    writeFileSync(
      join(dir, "scripts", "test-mutation-novo.sh"),
      "#!/usr/bin/env bash\nexit 0\n",
      "utf8",
    )
    stage(dir, "scripts/test-mutation-novo.sh")
    writeFileSync(
      join(dir, "scripts", "test-mutation-guards.sh"),
      `#!/usr/bin/env bash\nSUBTESTS=(\n  "real|Real — folha coberta|scripts/test-mutation-real.sh"\n  "novo|Novo — wireado|scripts/test-mutation-novo.sh"\n)\n`,
      "utf8",
    )
    stage(dir, "scripts/test-mutation-guards.sh")

    const { status, out } = runStaged(dir)
    expect(status).toBe(0)
    expect(out).toContain("Diff ok")
  })

  it("exit 1: script test-mutation-*.sh NOVO staged SEM cobertura (órfão)", () => {
    const dir = makeRepo()
    buildFixture(dir)
    // script novo SEM wire — nem ref direta num workflow, nem na matriz.
    writeFileSync(
      join(dir, "scripts", "test-mutation-orphan.sh"),
      "#!/usr/bin/env bash\nexit 0\n",
      "utf8",
    )
    stage(dir, "scripts/test-mutation-orphan.sh")

    const { status, out } = runStaged(dir)
    expect(status).toBe(1)
    // mensagem do main() staged generalizada: '❌ Diff com N violação(ões)...'
    expect(out).toContain("violação(ões) de cobertura")
    expect(out).toContain("test-mutation-orphan.sh")
    expect(out).toContain("SEM job correspondente")
  })

  it("exit 0: arquivo NOVO que NÃO é test-mutation-*.sh não é avaliado", () => {
    const dir = makeRepo()
    buildFixture(dir)
    writeFileSync(join(dir, "scripts", "foo.sh"), "#!/usr/bin/env bash\nexit 0\n", "utf8")
    stage(dir, "scripts/foo.sh")

    const { status, out } = runStaged(dir)
    expect(status).toBe(0)
    expect(out).toContain("Diff ok")
  })

  it("exit 1: --base HEAD~1 — script órfão NOVO COMMITADO entre base e HEAD", () => {
    const dir = makeRepo()
    buildFixture(dir)
    commitAll(dir, "baseline") // HEAD~1 = fixture limpo
    writeFileSync(
      join(dir, "scripts", "test-mutation-orphan.sh"),
      "#!/usr/bin/env bash\nexit 0\n",
      "utf8",
    )
    commitAll(dir, "orphan") // HEAD = script órfão — diff base...HEAD a vê

    const { status, out } = runStaged(dir, ["--base", "HEAD~1"])
    expect(status).toBe(1)
    expect(out).toContain("violação(ões) de cobertura")
    expect(out).toContain("test-mutation-orphan.sh")
    expect(out).toContain("SEM job correspondente")
  })

  it("exit 0: --base HEAD sem diff (controle — baseline COMMITADO idêntico)", () => {
    const dir = makeRepo()
    buildFixture(dir)
    commitAll(dir)

    const { status, out } = runStaged(dir, ["--base", "HEAD"])
    expect(status).toBe(0)
    expect(out).toContain("Diff ok")
  })

  it("exit 2: --base com ref INVÁLIDA (metacharacter de shell)", () => {
    const dir = makeRepo()
    buildFixture(dir)

    // isValidGitRef rejeita `;` — gitDiffMutationScope retorna null → exit 2.
    const { status, out } = runStaged(dir, ["--base", "main; rm -rf /"])
    expect(status).toBe(2)
    expect(out).toContain("git diff indisponível")
    expect(out).toContain("main; rm -rf /")
  })

  it("exit 1: run: de workflow NOVO staged referencia script INEXISTENTE (reverse)", () => {
    const dir = makeRepo()
    buildFixture(dir)
    commitAll(dir, "baseline") // workflow baseline com ref válida (guards)

    // mutação: adiciona um step com run: a script INEXISTENTE em scripts/
    writeFileSync(
      join(dir, ".github", "workflows", "pr-check.yml"),
      `name: PR Check\njobs:\n  mutation-guards:\n    runs-on: ubuntu-latest\n    steps:\n      - name: Mutation tests\n        run: bash scripts/test-mutation-guards.sh\n      - name: Broken ref (novo)\n        run: bash scripts/test-mutation-fantasma.sh\n`,
      "utf8",
    )
    stage(dir, ".github/workflows/pr-check.yml")

    const { status, out } = runStaged(dir)
    expect(status).toBe(1)
    // mensagem do main() staged generalizada: '❌ Diff com N violação(ões)...'
    expect(out).toContain("violação(ões) de cobertura")
    expect(out).toContain("test-mutation-fantasma.sh")
    expect(out).toContain("workflow referencia")
    expect(out).toContain("NÃO existe em scripts/")
  })

  it("exit 0: run: de workflow NOVO staged referencia script EXISTENTE (par fechado)", () => {
    const dir = makeRepo()
    buildFixture(dir)
    commitAll(dir, "baseline")

    // adiciona um step com run: a script QUE EXISTE (real) — sem violação
    writeFileSync(
      join(dir, ".github", "workflows", "pr-check.yml"),
      `name: PR Check\njobs:\n  mutation-guards:\n    runs-on: ubuntu-latest\n    steps:\n      - name: Mutation tests\n        run: bash scripts/test-mutation-guards.sh\n      - name: Valid ref (novo)\n        run: bash scripts/test-mutation-real.sh\n`,
      "utf8",
    )
    stage(dir, ".github/workflows/pr-check.yml")

    const { status, out } = runStaged(dir)
    expect(status).toBe(0)
    expect(out).toContain("Diff ok")
  })

  it("exit 1: --base HEAD~1 — run: de workflow quebrado COMMITADO entre base e HEAD", () => {
    const dir = makeRepo()
    buildFixture(dir)
    commitAll(dir, "baseline") // HEAD~1 = workflow com ref válida

    // mutação commitada como HEAD: workflow ganha run: a script fantasma
    writeFileSync(
      join(dir, ".github", "workflows", "pr-check.yml"),
      `name: PR Check\njobs:\n  mutation-guards:\n    runs-on: ubuntu-latest\n    steps:\n      - name: Mutation tests\n        run: bash scripts/test-mutation-guards.sh\n      - name: Broken ref (commitado)\n        run: bash scripts/test-mutation-fantasma.sh\n`,
      "utf8",
    )
    commitAll(dir, "broken-ref")

    const { status, out } = runStaged(dir, ["--base", "HEAD~1"])
    expect(status).toBe(1)
    expect(out).toContain("test-mutation-fantasma.sh")
    expect(out).toContain("workflow referencia")
    expect(out).toContain("NÃO existe em scripts/")
  })

  it("exit 2: --base com ref que não existe no repo (git diff falha)", () => {
    const dir = makeRepo()
    buildFixture(dir)
    commitAll(dir)
    writeFileSync(
      join(dir, "scripts", "test-mutation-orphan.sh"),
      "#!/usr/bin/env bash\nexit 0\n",
      "utf8",
    )
    stage(dir, "scripts/test-mutation-orphan.sh")

    // ref sintaticamente válida MAS inexistente → git diff origin/nope...HEAD falha
    const { status, out } = runStaged(dir, ["--base", "origin/nope"])
    expect(status).toBe(2)
    expect(out).toContain("git diff indisponível")
  })

  it("exit 2: fora de repositório git (git diff --cached falha)", () => {
    const dir = mkdtempSync(join(tmpdir(), "cmj-staged-nogit-"))
    tmpDirs.push(dir)
    // NOTA: sem git init — o guard não deve conseguir rodar o diff.

    const { status, out } = runStaged(dir)
    expect(status).toBe(2)
    expect(out).toContain("git diff indisponível")
  })
})
