/**
 * check-bun-mirror-cli.test.ts
 *
 * Testes de INTEGRAÇÃO do guard scripts/check-bun-mirror.mjs: roda a CLI REAL
 * via child_process (process.execPath — robusto no Windows) contra fake repos
 * com mirror/action/Dockerfile/.actrc VÁLIDOS + workflows fake com cache keys
 * de bun/prisma/next, validando o fluxo completo do guard (exit code +
 * mensagens POR PREFIXO) — não apenas as funções puras (já cobertas pelo
 * check-bun-mirror.test.ts).
 *
 * Cobre:
 *   - keys bun/prisma VÁLIDAS (vars.BUN_VERSION) + next (toolchain não
 *     configurada, ignorada) → exit 0
 *   - literais bun E prisma → exit 1 com mensagens por prefixo (bun-1.3.14 /
 *     prisma-1.3.14); a key next NÃO gera mensagem (prefixo não configurado)
 *   - path de OUTRA toolchain (key bun + path node_modules/.prisma) → exit 1
 *     com a mensagem do par key↔path
 *   - repo real do projeto → exit 0 (todos os blocos reais fecham o par)
 *
 * ATENÇÃO (esbuild): dentro de template literals, `${{` e `${...}` do GitHub
 * Actions precisam de escape (`\${{`, `\${...}`) — senão o esbuild lê `${`
 * como início de interpolação e o arquivo nem compila.
 *
 * Usage:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/check-bun-mirror-cli.test.ts
 */

import { describe, it, expect, afterAll } from "vitest"
import { spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const SCRIPT = join(process.cwd(), "scripts", "check-bun-mirror.mjs")
const ROOT_TMP = mkdtempSync(join(tmpdir(), "cbun-mirror-cli-"))

/** Roda `check-bun-mirror.mjs` num cwd arbitrário (CLI real). */
function runGuard(cwd: string): { status: number | null; out: string } {
  const res = spawnSync(process.execPath, [SCRIPT], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
  return { status: res.status, out: `${res.stdout ?? ""}${res.stderr ?? ""}` }
}

/**
 * Cria um repo fake com o MÍNIMO para o validateMirror passar (senão o guard
 * falharia por motivo ALHEIO ao cache key↔path — o teste quer isolar o scan
 * de keys): mirror com env.BUN_VERSION = vars.BUN_VERSION, action sem default
 * + ref a inputs.bun-version + ref ao mirror GHCR, Dockerfile presente e
 * .actrc definindo BUN_VERSION.
 */
function makeBaseRepo(name: string): string {
  const dir = join(ROOT_TMP, name)
  const wfDir = join(dir, ".github", "workflows")
  const actionDir = join(dir, ".github", "actions", "setup-bun")
  mkdirSync(wfDir, { recursive: true })
  mkdirSync(actionDir, { recursive: true })

  writeFileSync(
    join(wfDir, "sync-bun-mirror.yml"),
    `name: Sync Bun Mirror
env:
  BUN_VERSION: \${{ vars.BUN_VERSION }}
jobs:
  mirror:
    runs-on: ubuntu-latest
    steps:
      - run: echo ok
`,
    "utf8",
  )
  writeFileSync(
    join(actionDir, "action.yml"),
    `inputs:
  bun-version:
    required: false
runs:
  using: composite
  steps:
    - name: Resolve Bun version
      run: |
        VERSION="\${{ inputs.bun-version }}"
    - name: Download Bun release (cold cache)
      run: |
        MIRROR="ghcr.io/\${GHCR_OWNER}/bun:\${BUN_VERSION}"
        docker pull "$MIRROR"
`,
    "utf8",
  )
  writeFileSync(join(dir, "Dockerfile.bun-mirror"), "FROM scratch\nCOPY bun /bun\n", "utf8")
  writeFileSync(join(dir, ".actrc"), `--var BUN_VERSION=1.3.14\n`, "utf8")
  return dir
}

/** Adiciona um workflow fake ao repo base. */
function addWorkflow(dir: string, name: string, content: string): void {
  writeFileSync(join(dir, ".github", "workflows", name), content, "utf8")
}

/** Keys bun/prisma VÁLIDAS (vars.BUN_VERSION) + next (prefixo NÃO configurado). */
const VALID_KEYS = `name: Fake
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
      - name: Cache Prisma client
        uses: actions/cache@v4
        with:
          path: |
            node_modules/.prisma
            node_modules/@prisma/client
          key: prisma-\${{ vars.BUN_VERSION }}-\${{ hashFiles('prisma/schema.prisma') }}
          restore-keys: prisma-\${{ vars.BUN_VERSION }}-
      - name: Cache Next (toolchain NÃO configurada — ignorada)
        uses: actions/cache@v4
        with:
          path: .next/cache
          key: next-15-\${{ hashFiles('next.lock') }}
          restore-keys: next-15-
`

/** Literais bun E prisma (violações por prefixo) + next válida (sem mensagem). */
const LITERAL_KEYS = `name: Fake
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
      - name: Cache Prisma client
        uses: actions/cache@v4
        with:
          path: |
            node_modules/.prisma
            node_modules/@prisma/client
          key: prisma-1.3.14-\${{ hashFiles('prisma/schema.prisma') }}
          restore-keys: prisma-1.3.14-
      - name: Cache Next (prefixo NÃO configurado — nenhuma mensagem)
        uses: actions/cache@v4
        with:
          path: .next/cache
          key: next-15-\${{ hashFiles('next.lock') }}
`

/** Path de OUTRA toolchain sob key bun — o par key↔path quebrado. */
const PATH_MISMATCH = `name: Fake
jobs:
  job:
    runs-on: ubuntu-latest
    steps:
      - name: Cache node_modules
        uses: actions/cache@v4
        with:
          path: |
            node_modules/.prisma
            node_modules/@prisma/client
          key: bun-\${{ vars.BUN_VERSION }}-\${{ hashFiles('bun.lock') }}
          restore-keys: bun-\${{ vars.BUN_VERSION }}-
`

describe("check-bun-mirror.mjs — CLI real (guard do cache key↔path)", () => {
  afterAll(() => {
    rmSync(ROOT_TMP, { recursive: true, force: true })
  })

  it("keys bun/prisma VÁLIDAS + next (ignorada) → exit 0", () => {
    const dir = makeBaseRepo("t1-clean")
    addWorkflow(dir, "fake.yml", VALID_KEYS)
    const { status, out } = runGuard(dir)
    expect(status).toBe(0)
    expect(out).toContain("Fonte única do Bun ok")
  })

  it("literais bun E prisma → exit 1 com mensagens por prefixo; next sem mensagem", () => {
    const dir = makeBaseRepo("t2-literals")
    addWorkflow(dir, "fake.yml", LITERAL_KEYS)
    const { status, out } = runGuard(dir)
    expect(status).toBe(1)
    expect(out).toContain("bun-1.3.14")
    expect(out).toContain("prisma-1.3.14")
    expect(out).toContain("fake.yml:")
    // next NÃO é toolchain configurada — o guard não gera mensagem para ela
    expect(out).not.toContain("next-15")
  })

  it("path de outra toolchain (key bun + path node_modules/.prisma) → exit 1 com a mensagem do par", () => {
    const dir = makeBaseRepo("t3-path-mismatch")
    addWorkflow(dir, "fake.yml", PATH_MISMATCH)
    const { status, out } = runGuard(dir)
    expect(status).toBe(1)
    expect(out).toContain("feche o par key↔path")
    expect(out).toContain("'prisma'")
    expect(out).toContain("fake.yml:")
  })

  it("repo real do projeto → exit 0 (todos os blocos reais fecham o par)", () => {
    const { status, out } = runGuard(process.cwd())
    expect(status).toBe(0)
    expect(out).toContain("Fonte única do Bun ok")
  })
})
