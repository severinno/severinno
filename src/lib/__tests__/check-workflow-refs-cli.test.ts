/**
 * check-workflow-refs-cli.test.ts
 *
 * Testes de INTEGRAÇÃO do guard scripts/check-workflow-refs.mjs: roda a CLI
 * REAL via child_process (process.execPath — robusto no Windows) contra
 * diretórios temporários com .github/workflows + scripts/ + package.json
 * fake, validando o fluxo completo do guard (não apenas as funções puras,
 * já cobertas pelo check-workflow-refs.test.ts).
 *
 * Cobre:
 *   - workflow com script ausente → exit 1 (violação kind=script)
 *   - workflow com entry de package.json ausente → exit 1
 *   - workflow com uses: local apontando para arquivo inexistente → exit 1
 *   - repo fake limpo (tudo resolvido) → exit 0
 *   - repo real do projeto → exit 0 (nenhuma referência quebrada hoje)
 *
 * Usage:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/check-workflow-refs-cli.test.ts
 */

import { describe, it, expect, afterAll } from "vitest"
import { spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const SCRIPT = join(process.cwd(), "scripts", "check-workflow-refs.mjs")
const ROOT_TMP = mkdtempSync(join(tmpdir(), "cwf-refs-"))

/** Roda `check-workflow-refs.mjs` num cwd arbitrário (CLI real). */
function runGuard(cwd: string, extra: string[] = []): { status: number | null; out: string } {
  const res = spawnSync(process.execPath, [SCRIPT, ...extra], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
  return { status: res.status, out: `${res.stdout ?? ""}${res.stderr ?? ""}` }
}

/** Cria um repo fake isolado com .github/workflows + scripts/ + package.json. */
function makeFakeRepo(
  name: string,
  opts: {
    workflows: Record<string, string>
    scripts?: string[]
    pkgScripts?: Record<string, string>
  },
): string {
  const dir = join(ROOT_TMP, name)
  const wfDir = join(dir, ".github", "workflows")
  const scriptsDir = join(dir, "scripts")
  mkdirSync(wfDir, { recursive: true })
  mkdirSync(scriptsDir, { recursive: true })
  for (const [wfName, content] of Object.entries(opts.workflows)) {
    writeFileSync(join(wfDir, wfName), content, "utf8")
  }
  for (const s of opts.scripts ?? []) {
    writeFileSync(join(scriptsDir, s), "", "utf8")
  }
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ scripts: opts.pkgScripts ?? {} }, null, 2),
    "utf8",
  )
  return dir
}

describe("check-workflow-refs.mjs — CLI real (fast gate)", () => {
  afterAll(() => {
    rmSync(ROOT_TMP, { recursive: true, force: true })
  })

  it("script ausente em scripts/ → exit 1 com violação kind=script", () => {
    const dir = makeFakeRepo("t1-script", {
      workflows: {
        "bench.yml": `name: Bench\njobs:\n  b:\n    steps:\n      - run: node scripts/geo-benchmark-gone.mjs\n`,
      },
      scripts: ["geo-benchmark-gist.mjs"],
    })
    const { status, out } = runGuard(dir)
    expect(status).toBe(1)
    expect(out).toContain("Referência(s) quebrada(s)")
    expect(out).toContain("bench.yml:5")
    expect(out).toContain("[script] geo-benchmark-gone.mjs")
  })

  it("entry de package.json ausente → exit 1 com violação kind=package.json", () => {
    const dir = makeFakeRepo("t2-pkg", {
      workflows: {
        "pr.yml": `name: PR\njobs:\n  c:\n    steps:\n      - run: bun run test:seed-removed-e2e\n`,
      },
      pkgScripts: { "test:seed-prod-e2e": "bash scripts/test-seed-prod-e2e.sh" },
    })
    const { status, out } = runGuard(dir)
    expect(status).toBe(1)
    expect(out).toContain("pr.yml:5")
    expect(out).toContain("[package.json] test:seed-removed-e2e")
  })

  it("TRANSITIVO: entry EXISTE mas o script alvo está ausente → exit 1", () => {
    // espelho do par fechado do check-mutation-jobs: a entry existe em
    // package.json, mas o scripts/X que ela invoca não existe — o run: bun
    // run <entry> falharia no runtime; o guard pega no PR
    const dir = makeFakeRepo("t5-pkg-transitive", {
      workflows: {
        "pr.yml": `name: PR\njobs:\n  c:\n    steps:\n      - run: bun run test:seed-prod-e2e\n`,
      },
      scripts: [], // scripts/ vazio — o alvo test-seed-prod-e2e.sh NÃO existe
      pkgScripts: { "test:seed-prod-e2e": "bash scripts/test-seed-prod-e2e.sh" },
    })
    const { status, out } = runGuard(dir)
    expect(status).toBe(1)
    expect(out).toContain("[package.json] test:seed-prod-e2e")
    expect(out).toContain("test-seed-prod-e2e.sh")
    expect(out).toContain("NÃO existe")
  })

  it("TRANSITIVO: entry existe E o script alvo existe → exit 0 (par fechado)", () => {
    const dir = makeFakeRepo("t6-pkg-transitive-ok", {
      workflows: {
        "pr.yml": `name: PR\njobs:\n  c:\n    steps:\n      - run: bun run test:seed-prod-e2e\n`,
      },
      scripts: ["test-seed-prod-e2e.sh"], // o alvo EXISTE
      pkgScripts: { "test:seed-prod-e2e": "bash scripts/test-seed-prod-e2e.sh" },
    })
    const { status, out } = runGuard(dir)
    expect(status).toBe(0)
    expect(out).toContain("Nenhuma referência quebrada")
  })

  it("uses: local apontando para arquivo inexistente → exit 1", () => {
    const dir = makeFakeRepo("t3-uses", {
      workflows: {
        "pr.yml": `name: PR\njobs:\n  g:\n    uses: ./.github/workflows/seed-deleted.yml\n`,
        "seed-guards.yml": `name: Seed Guards\non:\n  workflow_call:\n`,
      },
    })
    const { status, out } = runGuard(dir)
    expect(status).toBe(1)
    expect(out).toContain("[workflow] seed-deleted.yml")
  })

  it("repo fake limpo (tudo resolvido) → exit 0", () => {
    const dir = makeFakeRepo("t4-clean", {
      workflows: {
        "pr.yml": `name: PR\njobs:\n  b:\n    steps:\n      - run: node scripts/geo-benchmark-gist.mjs\n      - run: bun run lint\n      - uses: ./.github/workflows/seed-guards.yml\n`,
        "seed-guards.yml": `name: Seed Guards\non:\n  workflow_call:\n`,
      },
      scripts: ["geo-benchmark-gist.mjs"],
      pkgScripts: { lint: "eslint ." },
    })
    const { status, out } = runGuard(dir)
    expect(status).toBe(0)
    expect(out).toContain("Nenhuma referência quebrada")
  })

  it("repo real do projeto → exit 0 (nenhuma referência quebrada hoje)", () => {
    const { status, out } = runGuard(process.cwd())
    expect(status).toBe(0)
    expect(out).toContain("Nenhuma referência quebrada")
  })

  it("--pkg-internal: entry de package.json invoca script DELETADO (sem workflow referenciando) → exit 1", () => {
    // o modo valida TODAS as entries que invocam scripts/ — mesmo sem NENHUM
    // workflow referenciando a entry (escopo: hooks locais/manuais bun run)
    const dir = makeFakeRepo("t7-pkg-internal", {
      workflows: {
        "ok.yml": `name: OK\njobs:\n  c:\n    steps:\n      - run: echo ok\n`,
      },
      scripts: [], // scripts/ vazio — o alvo test-seed-prod-e2e.sh NÃO existe
      pkgScripts: { "test:seed-prod-e2e": "bash scripts/test-seed-prod-e2e.sh" },
    })
    const { status, out } = runGuard(dir, ["--pkg-internal"])
    expect(status).toBe(1)
    expect(out).toContain("package.json")
    expect(out).toContain("test:seed-prod-e2e")
    expect(out).toContain("test-seed-prod-e2e.sh")
    expect(out).toContain("NÃO existe")
  })

  it("--pkg-internal: todas as entries com alvo existente → exit 0", () => {
    const dir = makeFakeRepo("t8-pkg-internal-ok", {
      workflows: {
        "ok.yml": `name: OK\njobs:\n  c:\n    steps:\n      - run: echo ok\n`,
      },
      scripts: ["test-seed-prod-e2e.sh"], // o alvo EXISTE
      pkgScripts: { "test:seed-prod-e2e": "bash scripts/test-seed-prod-e2e.sh" },
    })
    const { status, out } = runGuard(dir, ["--pkg-internal"])
    expect(status).toBe(0)
    expect(out).toContain("Nenhuma referência quebrada")
  })

  it("SEM --pkg-internal: entry órfã com script deletado NÃO falha (modo é opt-in)", () => {
    // o modo default é workflow-only — uma entry que NENHUM workflow
    // referencia (órfã de workflow) com alvo deletado passa SEM a flag
    const dir = makeFakeRepo("t9-pkg-default-skip", {
      workflows: {
        "ok.yml": `name: OK\njobs:\n  c:\n    steps:\n      - run: echo ok\n`,
      },
      scripts: [],
      pkgScripts: { "test:seed-prod-e2e": "bash scripts/test-seed-prod-e2e.sh" },
    })
    const { status, out } = runGuard(dir) // SEM --pkg-internal
    expect(status).toBe(0)
    expect(out).toContain("Nenhuma referência quebrada")
  })
})
