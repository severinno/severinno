/**
 * rotate-secrets-seed-hooks.test.ts
 *
 * Testes de INTEGRAÇÃO da extensão do secrets-guard (rotate-secrets.mjs
 * --check): além de falhar se .env estiver rastreado, o guard agora TAMBÉM
 * falha se hooks de TESTE do seed (SEED_SPEC_PATCH / PROD_SEED_ALLOW_DEV)
 * aparecerem em workflows de PRODUÇÃO (fora do allowlist de teste do
 * check-seed-hooks.mjs).
 *
 * Roda a CLI REAL via child_process (process.execPath — robusto no Windows)
 * contra um diretório temporário com .github/workflows fake, validando o
 * fluxo completo do guard (não apenas as funções puras, que já são cobertas
 * pelo check-seed-hooks.test.ts).
 *
 * Cobre:
 *   - deploy.yml com hook → exit 1 (mensagem de violação)
 *   - workflow do allowlist (seed-guards.yml) com hook → exit 0
 *   - release-deploy.yml com hook → exit 1
 *   - diretório .github/workflows ausente → exit 0 (sem violação)
 *   - repo real (cwd do projeto) → exit 0 (nenhum hook vazado hoje)
 *
 * Usage:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/rotate-secrets-seed-hooks.test.ts
 *
 * Exit codes:
 *   0 — todos os testes passaram
 *   1 — pelo menos um teste falhou
 */

import { describe, it, expect, afterAll } from "vitest"
import { spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const SCRIPT = join(process.cwd(), "scripts", "rotate-secrets.mjs")
const ROOT_TMP = mkdtempSync(join(tmpdir(), "rs-seed-hooks-"))

/** Roda `rotate-secrets.mjs --check` num cwd arbitrário (CLI real). */
function runCheck(cwd: string): { status: number | null; out: string } {
  const res = spawnSync(process.execPath, [SCRIPT, "--check"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
  return { status: res.status, out: `${res.stdout ?? ""}${res.stderr ?? ""}` }
}

/** Cria um repo fake isolado com .github/workflows/<name> = <content>. */
function makeFakeRepo(name: string, workflows: Record<string, string>): string {
  // Cada teste usa um subdiretório PRÓPRIO — evita que workflows com hook de
  // um teste anterior (fora do allowlist) vazem para o scan do teste seguinte
  // e façam o guard falhar onde o teste espera exit 0.
  const dir = join(ROOT_TMP, name)
  const wfDir = join(dir, ".github", "workflows")
  mkdirSync(wfDir, { recursive: true })
  for (const [wfName, content] of Object.entries(workflows)) {
    writeFileSync(join(wfDir, wfName), content, "utf8")
  }
  return dir
}

// PROD_SEED_ALLOW_DEV está na LINHA 8 (findSeedHookUses é 1-based):
//   1 name: Deploy  2 (vazia)  3 jobs:  4 migrate:  5 steps:
//   6 - name: Run seed  7 env:  8 PROD_SEED_ALLOW_DEV: "1"  9 run:
const DEPLOY_WITH_HOOK = `name: Deploy

jobs:
  migrate:
    steps:
      - name: Run seed
        env:
          PROD_SEED_ALLOW_DEV: "1"
        run: bun run db:seed:prod
`

describe("rotate-secrets.mjs --check — hooks de teste do seed em workflows", () => {
  afterAll(() => {
    rmSync(ROOT_TMP, { recursive: true, force: true })
  })

  it("deploy.yml com PROD_SEED_ALLOW_DEV → exit 1 com mensagem de violação", () => {
    const dir = makeFakeRepo("t1-deploy", { "deploy.yml": DEPLOY_WITH_HOOK })
    const { status, out } = runCheck(dir)
    expect(status).toBe(1)
    expect(out).toContain("Hook(s) de teste do seed em workflow(s) de produção")
    expect(out).toContain("deploy.yml:8")
    expect(out).toContain("PROD_SEED_ALLOW_DEV")
  })

  it("release-deploy.yml com SEED_SPEC_PATCH → exit 1 (fail-closed)", () => {
    const dir = makeFakeRepo("t2-release", {
      "release-deploy.yml": `name: Release\njobs:\n  build:\n    steps:\n      - run: |\n          SEED_SPEC_PATCH='[{"name":"Elétrica","icon":"bolt"}]' bun prisma/seed-prod.ts\n`,
    })
    const { status, out } = runCheck(dir)
    expect(status).toBe(1)
    expect(out).toContain("release-deploy.yml")
    expect(out).toContain("SEED_SPEC_PATCH")
  })

  it("workflow do allowlist (seed-guards.yml) com hook → exit 0 (teste legítimo)", () => {
    const dir = makeFakeRepo("t3-allowlist", { "seed-guards.yml": DEPLOY_WITH_HOOK })
    const { status, out } = runCheck(dir)
    expect(status).toBe(0)
    expect(out).toContain("Nenhum hook de teste do seed em workflows de produção")
  })

  it("sem diretório .github/workflows → exit 0 (nada a verificar)", () => {
    const dir = makeFakeRepo("t4-empty", {})
    rmSync(join(dir, ".github"), { recursive: true, force: true })
    const { status } = runCheck(dir)
    expect(status).toBe(0)
  })

  it("repo real do projeto → exit 0 (nenhum hook vazado hoje)", () => {
    const { status, out } = runCheck(process.cwd())
    expect(status).toBe(0)
    expect(out).toContain("Nenhum hook de teste do seed em workflows de produção")
  })
})
