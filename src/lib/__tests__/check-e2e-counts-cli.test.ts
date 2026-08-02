/**
 * check-e2e-counts-cli.test.ts
 *
 * Testes de INTEGRAÇÃO do guard scripts/check-e2e-counts.mjs: roda a CLI REAL
 * via child_process (process.execPath — robusto no Windows) contra
 * diretórios temporários com um stub da derivação + workflows fake,
 * validando o fluxo completo do guard (não apenas as funções puras, já
 * cobertas pelo check-e2e-counts.test.ts).
 *
 * O guard agora obtém a fonte da verdade rodando `bun scripts/seed-e2e-count.ts
 * --json` no cwd — os fake repos escrevem um STUB desse script que imprime o
 * JSON desejado (hermético, sem depender do repo real).
 *
 * Cobre:
 *   - count documentado divergente da derivação → exit 1 com arquivo:linha
 *   - count documentado igual → exit 0
 *   - derivação FALHA (stub com saída inválida) → exit 1 (fail-closed)
 *   - repo real do projeto → exit 0 (derivação real: prod=128, dev=162)
 *
 * Usage:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/check-e2e-counts-cli.test.ts
 */

import { describe, it, expect, afterAll } from "vitest"
import { spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const SCRIPT = join(process.cwd(), "scripts", "check-e2e-counts.mjs")
const ROOT_TMP = mkdtempSync(join(tmpdir(), "ce2e-counts-"))

/** Roda `check-e2e-counts.mjs` num cwd arbitrário (CLI real). */
function runGuard(cwd: string): { status: number | null; out: string } {
  const res = spawnSync(process.execPath, [SCRIPT], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
  return { status: res.status, out: `${res.stdout ?? ""}${res.stderr ?? ""}` }
}

/** Cria um repo fake com stub da derivação + workflows + script local. */
function makeFakeRepo(
  name: string,
  opts: {
    /** JSON que o stub da derivação imprime (default: {"prod":115,"dev":162}). */
    derivationJson?: string
    /** Stub da derivação que FALHA (exit 1) — fail-closed. */
    derivationFails?: boolean
    workflows?: Record<string, string>
    localScript?: string
  },
): string {
  const dir = join(ROOT_TMP, name)
  const scriptsDir = join(dir, "scripts")
  const wfDir = join(dir, ".github", "workflows")
  mkdirSync(scriptsDir, { recursive: true })
  mkdirSync(wfDir, { recursive: true })

  if (opts.derivationFails) {
    writeFileSync(join(scriptsDir, "seed-e2e-count.ts"), `process.exit(1)\n`, "utf8")
  } else {
    const json = opts.derivationJson ?? `{"prod":115,"dev":162}`
    writeFileSync(
      join(scriptsDir, "seed-e2e-count.ts"),
      `console.log(${JSON.stringify(json)})\n`,
      "utf8",
    )
  }

  for (const [wfName, content] of Object.entries(opts.workflows ?? {})) {
    writeFileSync(join(wfDir, wfName), content, "utf8")
  }
  writeFileSync(
    join(scriptsDir, "validate-seed-guards-matrix-local.sh"),
    opts.localScript ?? `echo "Rodando prod E2E (115 checks)..."\n`,
    "utf8",
  )
  return dir
}

const PR_CHECK = `# ORDEM: prod E2E PRIMEIRO (115 checks — banco limpo, asserta ZERO
# usuários), dev E2E DEPOIS (162 checks — o wipe+recreate do dev seed não
`

const SEED_GUARDS = `# 1. prod E2E (test-seed-prod-e2e.ts — 115 checks): guard recusa fora de
# 2. dev E2E (test-seed-dev-e2e.ts — 162 checks): guard recusa em produção,
`

describe("check-e2e-counts.mjs — CLI real (fast gate)", () => {
  afterAll(() => {
    rmSync(ROOT_TMP, { recursive: true, force: true })
  })

  it("count documentado divergente da derivação → exit 1 com arquivo:linha", () => {
    const dir = makeFakeRepo("t1-divergent", {
      workflows: {
        "pr-check.yml": `# ORDEM: prod E2E PRIMEIRO (147 checks — divergente\n`,
        "seed-guards.yml": SEED_GUARDS,
      },
    })
    const { status, out } = runGuard(dir)
    expect(status).toBe(1)
    expect(out).toContain("divergente")
    expect(out).toContain("pr-check.yml:1")
    expect(out).toContain("[prod] documentado=147 → esperado=115")
  })

  it("counts documentados iguais à derivação → exit 0", () => {
    const dir = makeFakeRepo("t2-clean", {
      workflows: { "pr-check.yml": PR_CHECK, "seed-guards.yml": SEED_GUARDS },
    })
    const { status, out } = runGuard(dir)
    expect(status).toBe(0)
    expect(out).toContain("sincronizados")
    expect(out).toContain("prod=115, dev=162")
  })

  it("derivação FALHA (stub exit 1) → exit 1 (fail-closed)", () => {
    const dir = makeFakeRepo("t3-derivation-fails", {
      derivationFails: true,
      workflows: { "seed-guards.yml": SEED_GUARDS },
    })
    const { status, out } = runGuard(dir)
    expect(status).toBe(1)
    expect(out).toContain("derivação de counts falhou")
    expect(out).toContain("seed-e2e-count.ts")
  })

  it("derivação com JSON inválido → exit 1 (fail-closed)", () => {
    const dir = makeFakeRepo("t3b-bad-json", {
      derivationJson: "não é json",
      workflows: { "seed-guards.yml": SEED_GUARDS },
    })
    const { status, out } = runGuard(dir)
    expect(status).toBe(1)
    expect(out).toContain("não é JSON válido")
  })

  it("repo real do projeto → exit 0 (derivação real prod=128, dev=162)", () => {
    const { status, out } = runGuard(process.cwd())
    expect(status).toBe(0)
    expect(out).toContain("sincronizados")
  })
})
