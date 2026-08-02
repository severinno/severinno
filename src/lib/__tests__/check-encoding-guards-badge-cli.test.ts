/**
 * check-encoding-guards-badge-cli.test.ts
 *
 * Testes de INTEGRAÇÃO do guard scripts/check-encoding-guards-badge.mjs: roda
 * a CLI REAL via child_process (process.execPath — robusto no Windows) contra
 * diretórios temporários com READMEs fake, validando o fluxo completo:
 * derivação da tabela → comparação com o badge → exit code → --fix reescreve.
 *
 * Cobre:
 *   - badge divergente da tabela → exit 1 com o count esperado na mensagem
 *   - badge sincronizado → exit 0
 *   - seção/badge ausente → exit 1 (fail-closed)
 *   - --fix reescreve o badge (URL + alt) e o guard passa depois
 *   - repo real do projeto → exit 0 (tabela real sincronizada após o fix)
 *
 * Usage:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/check-encoding-guards-badge-cli.test.ts
 */

import { describe, it, expect, afterAll } from "vitest"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const SCRIPT = join(process.cwd(), "scripts", "check-encoding-guards-badge.mjs")
const ROOT_TMP = mkdtempSync(join(tmpdir(), "cegbadge-cli-"))

/** Roda `check-encoding-guards-badge.mjs` num cwd arbitrário (CLI real). */
function runGuard(cwd: string, extraArgs: string[] = []): { status: number | null; out: string } {
  const res = spawnSync(process.execPath, [SCRIPT, ...extraArgs], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
  return { status: res.status, out: `${res.stdout ?? ""}${res.stderr ?? ""}` }
}

/** Cria um repo fake com um README.md (diretório incluso) e o devolve. */
function makeRepo(name: string, content: string): string {
  const dir = join(ROOT_TMP, name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "README.md"), content, "utf8")
  return dir
}

/** Monta um README fake com tabela de N guards e badge com o count informado. */
function buildReadme(guards: string[], badgeCount: number): string {
  const rows = guards.map((g, i) => `| ${g} | t${i} | c${i} | <1s | ✅ Exit 1 |`).join("\n")
  return `# Fake

  <img src="https://img.shields.io/badge/encoding%20guards-${badgeCount}%2F${badgeCount}%20active%20%E2%9C%85-2ea44f" alt="Encoding guards: ${badgeCount}/${badgeCount} active">

## Encoding Guards

Prosa de exemplo:

| Camada | Gatilho | Comando | Tempo | Bloqueia? |
| :---: | --- | --- | :---: | :---: |
${rows}

**Fim**
`
}

const GUARDS_7 = [
  "🏠 **Pre-commit**",
  "🚀 **Pre-push**",
  "🔄 **CI/CD**",
  "📋 **PR Check**",
  "🔒 **CRLF Guard**",
  "📦 **Blob CRLF**",
  "🧨 **Single-line out=**",
]

describe("check-encoding-guards-badge.mjs — CLI real", () => {
  afterAll(() => {
    rmSync(ROOT_TMP, { recursive: true, force: true })
  })

  it("badge divergente da tabela → exit 1 com o count esperado", () => {
    const dir = makeRepo("t1-divergent", buildReadme(GUARDS_7, 8))
    const { status, out } = runGuard(dir)
    expect(status).toBe(1)
    expect(out).toContain("divergente")
    expect(out).toContain("badge atual: 8/8")
    expect(out).toContain("tabela real: 7")
  })

  it("badge sincronizado → exit 0", () => {
    const dir = makeRepo("t2-clean", buildReadme(GUARDS_7, 7))
    const { status, out } = runGuard(dir)
    expect(status).toBe(0)
    expect(out).toContain("sincronizado")
    expect(out).toContain("(7/7)")
  })

  it("seção ## Encoding Guards ausente → exit 1 (fail-closed)", () => {
    const dir = makeRepo("t3-no-section", "# Sem seção\n\n| a | b |\n")
    const { status, out } = runGuard(dir)
    expect(status).toBe(1)
    expect(out).toContain("seção '## Encoding Guards' não encontrada")
  })

  it("badge ausente no README → exit 1 (fail-closed)", () => {
    const dir = makeRepo(
      "t3b-no-badge",
      buildReadme(GUARDS_7, 7).replace(/.*encoding%20guards.*\n/, ""),
    )
    const { status, out } = runGuard(dir)
    expect(status).toBe(1)
    expect(out).toContain("divergente da tabela")
    expect(out).toContain("badge não encontrado no README")
  })

  it("--fix reescreve o badge e o guard passa depois", () => {
    const dir = makeRepo("t4-fix", buildReadme(GUARDS_7, 8))
    const readmePath = join(dir, "README.md")

    const fixRes = runGuard(dir, ["--fix"])
    expect(fixRes.status).toBe(0)
    expect(fixRes.out).toContain("8/8 → 7/7")

    const after = readFileSync(readmePath, "utf8")
    expect(after).toContain("encoding%20guards-7%2F7")
    expect(after).toContain('alt="Encoding guards: 7/7 active"')

    const checkRes = runGuard(dir)
    expect(checkRes.status).toBe(0)
  })

  it("repo real do projeto → exit 0 (badge sincronizado com a tabela real)", () => {
    const { status, out } = runGuard(process.cwd())
    expect(status).toBe(0)
    expect(out).toContain("sincronizado")
  })
})
