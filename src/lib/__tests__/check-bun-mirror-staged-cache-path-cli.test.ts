/**
 * check-bun-mirror-staged-cache-path-cli.test.ts
 *
 * Teste de INTEGRAÇÃO do main() do guard scripts/check-bun-mirror.mjs no modo
 * `--staged` para a REMOÇÃO de campos de bloco actions/cache: spawna a CLI
 * REAL (process.execPath — robusto no Windows) contra um repositório git
 * TEMPORÁRIO REAL (git init + commit baseline + git add — o --staged roda
 * git diff --cached), validando o checkStagedRemovedCacheBlockFields
 * end-to-end:
 *
 *   exit 1 — o PR REMOVEU o campo `path:` de um bloco actions/cache que
 *            SOBREVIVE no novo arquivo (a linha `uses: actions/cache` fica
 *            como contexto no diff, o `path:` some como linha `-`) — o bloco
 *            fica SEM path, quebrando o par key↔path no restore
 *   exit 1 — o PR REMOVEU o campo `key:` de um bloco sobrevivente (mesma
 *            regressão na outra direção do par)
 *   exit 0 — o STEP INTEIRO foi removido (uses + path + key todos `-`) —
 *            remover o step é legítimo, não é regressão
 *   exit 0 — baseline com bloco cache VÁLIDO commitado → staged idêntico
 *            (sem diff) não viola
 *   exit 1 — cenário COMPOSTO: o mesmo diff remove o path: de um bloco
 *            SOBREVIVENTE (REMOÇÃO do campo path:) E adiciona um bloco NOVO
 *            sem path (SEM path declarado) — as DUAS direções do par
 *            key↔path disparam juntas no staged
 *
 * Diferente do check-bun-mirror-cli.test.ts (scan GLOBAL com mirror válido),
 * este foca no caminho staged→main(): o git diff é REAL (arquivos
 * efetivamente staged), não texto de diff fake injetado nas funções puras
 * (já coberto pelo check-bun-mirror.test.ts — describe
 * checkStagedRemovedCacheBlockFields). Como o main() em --staged só lê o
 * diff de .github/workflows, os fixtures NÃO precisam de mirror/action/
 * Dockerfile válidos — o guard nem os consulta nesse modo.
 *
 * ATENÇÃO (esbuild): `${{` e `${...}` do GitHub Actions precisam de escape
 * (`\${{`, `\${...}`) dentro de template literals — senão o esbuild lê `${`
 * como interpolação e o arquivo nem compila.
 *
 * Usage:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/check-bun-mirror-staged-cache-path-cli.test.ts
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
  const dir = mkdtempSync(join(tmpdir(), "cbun-path-cli-"))
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

/** git commit -qm — baseline commitado (HEAD com o bloco VÁLIDO). */
function commitAll(dir: string, msg = "init"): void {
  execFileSync("git", ["add", "-A"], { cwd: dir })
  execFileSync("git", ["commit", "-qm", msg], { cwd: dir })
}

/** Roda a CLI REAL com `--staged` no cwd do repo fake. */
function runStaged(cwd: string): { status: number | null; out: string } {
  const res = spawnSync(process.execPath, [SCRIPT, "--staged"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
  return { status: res.status, out: `${res.stdout ?? ""}${res.stderr ?? ""}` }
}

/** Bloco actions/cache VÁLIDO (path + key da toolchain bun, fonte única). */
const VALID_CACHE_BLOCK = `name: Fake
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

/** Bloco actions/cache SEM o campo `path:` — a REMOÇÃO do path (regressão). */
const MISSING_PATH_BLOCK = `name: Fake
jobs:
  job:
    runs-on: ubuntu-latest
    steps:
      - name: Cache node_modules
        uses: actions/cache@v4
        with:
          key: bun-\${{ vars.BUN_VERSION }}-\${{ hashFiles('bun.lock') }}
          restore-keys: bun-\${{ vars.BUN_VERSION }}-
`

/** Bloco actions/cache SEM o campo `key:` — a REMOÇÃO da key (regressão). */
const MISSING_KEY_BLOCK = `name: Fake
jobs:
  job:
    runs-on: ubuntu-latest
    steps:
      - name: Cache node_modules
        uses: actions/cache@v4
        with:
          path: node_modules
          restore-keys: bun-\${{ vars.BUN_VERSION }}-
`

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe("check-bun-mirror.mjs --staged — REMOÇÃO de path:/key: de bloco actions/cache (git real)", () => {
  it("exit 0: baseline com bloco cache VÁLIDO commitado → staged idêntico (sem diff)", () => {
    const dir = makeRepo()
    addWorkflow(dir, "fake.yml", VALID_CACHE_BLOCK)
    commitAll(dir, "baseline")

    const { status, out } = runStaged(dir)
    expect(status).toBe(0)
    expect(out).toContain("Diff ok")
  })

  it("exit 1: REMOÇÃO do path: de um bloco actions/cache SOBREVIVENTE (regressão)", () => {
    // Bloco VÁLIDO COMMITADO (baseline) → working tree SEM o `path:`
    // (removido) → staged. O diff mostra `- path: node_modules` como linha
    // REMOVIDA com o `uses:` de CONTEXTO — o check de ADIÇÃO (só avalia
    // blocos cuja uses foi adicionada) não vê, então o
    // checkStagedRemovedCacheBlockFields é o que pega a regressão.
    const dir = makeRepo()
    addWorkflow(dir, "fake.yml", VALID_CACHE_BLOCK)
    commitAll(dir, "baseline") // HEAD com bloco completo
    addWorkflow(dir, "fake.yml", MISSING_PATH_BLOCK)
    stage(dir, ".github/workflows/fake.yml")

    const { status, out } = runStaged(dir)
    expect(status).toBe(1)
    expect(out).toContain("violação(ões)")
    expect(out).toContain("fake.yml:")
    expect(out).toContain("REMOÇÃO")
    expect(out).toContain("path:")
    // Contrato de mensagem clara: aponta a correção (restaurar o path do par key↔path)
    expect(out).toContain("SOBREVIVEU sem path")
  })

  it("exit 1: REMOÇÃO da key: de um bloco actions/cache SOBREVIVENTE (regressão)", () => {
    const dir = makeRepo()
    addWorkflow(dir, "fake.yml", VALID_CACHE_BLOCK)
    commitAll(dir, "baseline") // HEAD com bloco completo
    addWorkflow(dir, "fake.yml", MISSING_KEY_BLOCK)
    stage(dir, ".github/workflows/fake.yml")

    const { status, out } = runStaged(dir)
    expect(status).toBe(1)
    expect(out).toContain("violação(ões)")
    expect(out).toContain("fake.yml:")
    expect(out).toContain("REMOÇÃO")
    expect(out).toContain("key:")
    expect(out).toContain("SOBREVIVEU sem key")
  })

  it("exit 0: STEP INTEIRO removido (uses + path + key) não é regressão", () => {
    // Bloco actions/cache INTEIRO (uses + with + path + key) REMOVIDO —
    // remover o step/job é legítimo (ex.: job eliminado). Só a remoção do
    // CAMPO de um bloco que SOBREVIVE é regressão.
    const dir = makeRepo()
    addWorkflow(dir, "fake.yml", VALID_CACHE_BLOCK)
    commitAll(dir, "baseline")
    addWorkflow(
      dir,
      "fake.yml",
      `name: Fake
jobs:
  other:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
`,
    )
    stage(dir, ".github/workflows/fake.yml")

    const { status, out } = runStaged(dir)
    expect(status).toBe(0)
    expect(out).toContain("Diff ok")
  })

  it("exit 1: REMOÇÃO do path: + ADIÇÃO de um bloco NOVO sem path no MESMO diff", () => {
    // Cenário composto: o mesmo diff remove o path de um bloco sobrevivente
    // E adiciona um bloco de cache novo (uses ADICIONADA) sem path — o
    // checkStagedCachePaths (bloco novo sem path) E o
    // checkStagedRemovedCacheBlockFields (path removido do sobrevivente)
    // disparam juntos. Valida que o staged não perde NENHUMA das duas
    // direções do par key↔path.
    const dir = makeRepo()
    addWorkflow(dir, "fake.yml", VALID_CACHE_BLOCK)
    commitAll(dir, "baseline")
    addWorkflow(
      dir,
      "fake.yml",
      `name: Fake
jobs:
  job:
    runs-on: ubuntu-latest
    steps:
      - name: Cache node_modules
        uses: actions/cache@v4
        with:
          key: bun-\${{ vars.BUN_VERSION }}-\${{ hashFiles('bun.lock') }}
          restore-keys: bun-\${{ vars.BUN_VERSION }}-
      - name: Cache novo SEM path
        uses: actions/cache@v4
        with:
          key: bun-\${{ vars.BUN_VERSION }}-novo
`,
    )
    stage(dir, ".github/workflows/fake.yml")

    const { status, out } = runStaged(dir)
    expect(status).toBe(1)
    expect(out).toContain("violação(ões)")
    expect(out).toContain("fake.yml:")
    // direção 1: bloco NOVO (uses adicionada) sem path — checkStagedCachePaths
    expect(out).toContain("SEM path declarado")
    // direção 2: bloco SOBREVIVENTE com path removido — checkStagedRemovedCacheBlockFields
    expect(out).toContain("REMOÇÃO do campo path:")
  })
})
