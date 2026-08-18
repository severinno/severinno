/**
 * check-seed-count-literals-cli.test.ts
 *
 * Testes de INTEGRAÇÃO do guard scripts/check-seed-count-literals.mjs: roda a
 * CLI REAL via child_process (process.execPath — robusto no Windows) contra
 * diretórios temporários com um stub da derivação + arquivos fake em
 * scripts/, docs/ e .github/, validando o fluxo completo do guard (não apenas
 * as funções puras, já cobertas pelo check-seed-count-literals.test.ts).
 *
 * Cobre:
 *   - literal de count fora da derivação (docs/ + .github/) → exit 1
 *   - literais iguais à derivação → exit 0
 *   - mock data / UTF-8 check / prosa histórica → exit 0 (sem falso positivo)
 *   - derivação FALHA (stub com saída inválida) → exit 1 (fail-closed)
 *   - repo real do projeto → exit 0 (derivação real: prod=128, dev=162)
 *
 * Usage:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/check-seed-count-literals-cli.test.ts
 */

import { describe, it, expect, afterAll } from "vitest"
import { spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const SCRIPT = join(process.cwd(), "scripts", "check-seed-count-literals.mjs")
const ROOT_TMP = mkdtempSync(join(tmpdir(), "cseed-count-literals-"))

/** Roda `check-seed-count-literals.mjs` num cwd arbitrário (CLI real). */
function runGuard(cwd: string): { status: number | null; out: string } {
  const res = spawnSync(process.execPath, [SCRIPT], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
  return { status: res.status, out: `${res.stdout ?? ""}${res.stderr ?? ""}` }
}

/** Cria um repo fake com stub da derivação + arquivos em scripts/docs/.github. */
function makeFakeRepo(
  name: string,
  opts: {
    /** JSON que o stub da derivação imprime (default: {"prod":128,"dev":162}). */
    derivationJson?: string
    /** Stub da derivação que FALHA (exit 1) — fail-closed. */
    derivationFails?: boolean
    files?: Record<string, string>
  },
): string {
  const dir = join(ROOT_TMP, name)
  const scriptsDir = join(dir, "scripts")
  mkdirSync(scriptsDir, { recursive: true })
  mkdirSync(join(dir, "docs"), { recursive: true })
  mkdirSync(join(dir, ".github", "workflows"), { recursive: true })

  if (opts.derivationFails) {
    writeFileSync(join(scriptsDir, "seed-e2e-count.ts"), `process.exit(1)\n`, "utf8")
  } else {
    const json = opts.derivationJson ?? `{"prod":128,"dev":162}`
    writeFileSync(
      join(scriptsDir, "seed-e2e-count.ts"),
      `console.log(${JSON.stringify(json)})\n`,
      "utf8",
    )
  }

  for (const [rel, content] of Object.entries(opts.files ?? {})) {
    const full = join(dir, rel)
    mkdirSync(join(full, ".."), { recursive: true })
    writeFileSync(full, content, "utf8")
  }
  return dir
}

const PR_CHECK_OK = `# ORDEM: prod E2E PRIMEIRO (128 checks — banco limpo, asserta ZERO
# usuários), dev E2E DEPOIS (162 checks — o wipe+recreate do dev seed não
`

const DOCS_STALE = `# Relatório do último bump
- O seed E2E passou com 123 checks nesta iteração (ref ÓRFÃO — deve falhar).
`

const WORKFLOW_STALE = `# comentário com count velho
run: echo "| E2E (\${{ matrix.seed == 'prod' && '128' || '115' }} checks) |"
`

const NOISE = `name: UTF-8 Check
- Before committing, run a quick UTF-8 check on all staged files:
# SKIP_PRISMA_GENERATE: \${{ matrix.seed == 'prod' && '1' }}
# Mock data: CVC "123", "Rua das Flores, 123", rgba(249, 115, 22), "minha-senha-123"
# Prosa historica: doc dizia 128, ancora de teste esperava 123
`

describe("check-seed-count-literals.mjs — CLI real (varredura repo-wide)", () => {
  afterAll(() => {
    rmSync(ROOT_TMP, { recursive: true, force: true })
  })

  it("literal de count fora da derivação em docs/ → exit 1 com arquivo:linha", () => {
    const dir = makeFakeRepo("t1-docs-stale", {
      files: {
        "docs/report.md": DOCS_STALE,
        "docs/ok.md": `- seed passou com 128 checks\n`,
      },
    })
    const { status, out } = runGuard(dir)
    expect(status).toBe(1)
    expect(out).toContain("fora da derivação")
    expect(out).toContain("docs/report.md:2")
    expect(out).toContain("literal=123")
  })

  it("literal de count fora da derivação em .github/workflows → exit 1", () => {
    const dir = makeFakeRepo("t2-wf-stale", {
      files: { ".github/workflows/seed-guards.yml": WORKFLOW_STALE },
    })
    const { status, out } = runGuard(dir)
    expect(status).toBe(1)
    expect(out).toContain("seed-guards.yml:2")
    expect(out).toContain("literal=115")
  })

  it("literais iguais à derivação + noise (UTF-8/mock/prosa) → exit 0", () => {
    const dir = makeFakeRepo("t3-clean", {
      files: {
        ".github/workflows/pr-check.yml": PR_CHECK_OK,
        "docs/noise.md": NOISE,
      },
    })
    const { status, out } = runGuard(dir)
    expect(status).toBe(0)
    expect(out).toContain("sincronizados")
    expect(out).toContain("prod=128, dev=162")
  })

  it("derivação FALHA (stub exit 1) → exit 1 (fail-closed)", () => {
    const dir = makeFakeRepo("t4-derivation-fails", {
      derivationFails: true,
      files: { "docs/ok.md": `- seed passou com 128 checks\n` },
    })
    const { status, out } = runGuard(dir)
    expect(status).toBe(1)
    expect(out).toContain("derivação de counts falhou")
    expect(out).toContain("seed-e2e-count.ts")
  })

  it("derivação com JSON inválido → exit 1 (fail-closed)", () => {
    const dir = makeFakeRepo("t4b-bad-json", {
      derivationJson: "não é json",
      files: { "docs/ok.md": `- seed passou com 128 checks\n` },
    })
    const { status, out } = runGuard(dir)
    expect(status).toBe(1)
    expect(out).toContain("não é JSON válido")
  })

  it("repo real do projeto → exit 0 (derivação real prod=127, dev=161)", () => {
    const { status, out } = runGuard(process.cwd())
    expect(status).toBe(0)
    expect(out).toContain("sincronizados")
  })
})
