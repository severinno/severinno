/**
 * check-readme-toc-cli.test.ts
 *
 * Teste de INTEGRAÇÃO do main() do guard scripts/check-readme-toc.mjs:
 * spawna a CLI REAL (process.execPath — robusto no Windows) contra um README
 * TEMPORÁRIO, validando o CONTRATO DE EXIT CODES:
 *
 *   exit 0 — TOCs consistentes (links resolvem + filhos diretos listados)
 *   exit 1 — link de TOC quebrado (forward) OU heading fora do índice
 *            (reverse), com a mensagem apontando a linha
 *   exit 1 — arquivo ilegível (fail-closed)
 *
 * O guard aceita caminhos como argumentos (node ... <path>), então o teste
 * roda com cwd no diretório temporário e passa o nome do arquivo — sem
 * depender do README real do repo.
 *
 * Usage:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/check-readme-toc-cli.test.ts
 */

import { describe, it, expect, afterEach } from "vitest"
import { spawnSync } from "node:child_process"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const SCRIPT = resolve(process.cwd(), "scripts/check-readme-toc.mjs")
const tmpDirs: string[] = []

function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "crt-cli-"))
  tmpDirs.push(dir)
  return dir
}

/** Roda a CLI real contra <dir>/README.md e retorna {status, stdout, stderr}. */
function runCli(dir: string, content: string): { status: number; stdout: string; stderr: string } {
  writeFileSync(join(dir, "README.md"), content, "utf8")
  const res = spawnSync(process.execPath, [SCRIPT, "README.md"], {
    cwd: dir,
    encoding: "utf8",
  })
  return { status: res.status ?? -1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" }
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe("check-readme-toc.mjs CLI (main)", () => {
  it("exit 0 — TOC resolve E cobre todos os filhos diretos", () => {
    const content = [
      "## Encoding Guards",
      "",
      "- [CRLF Guard](#crlf-guard)",
      "- [Auditoria histórica](#auditoria-histórica)",
      "",
      "### CRLF Guard",
      "### Auditoria histórica",
    ].join("\n")
    const res = runCli(makeTmpDir(), content)
    expect(res.status).toBe(0)
    expect(res.stdout).toContain("✅")
  })

  it("exit 1 — heading renomeado: link de TOC quebrado (forward), com linha + sugestão", () => {
    const content = [
      "## Encoding Guards",
      "",
      "- [CRLF Guard](#crlf-guard)", // heading foi renomeado para baixo
      "- [Auditoria histórica](#auditoria-histórica)",
      "",
      "### Gate CRLF",
      "### Auditoria histórica",
    ].join("\n")
    const res = runCli(makeTmpDir(), content)
    expect(res.status).toBe(1)
    expect(res.stderr).toContain("README.md:3")
    expect(res.stderr).toContain("[link de TOC]")
    expect(res.stderr).toContain("#crlf-guard")
    expect(res.stderr).toContain("heading mais próximo")
  })

  it("exit 1 — heading NOVO fora do índice (reverse), com seção + sugestão de bullet", () => {
    const content = [
      "## Encoding Guards",
      "",
      "- [CRLF Guard](#crlf-guard)",
      "- [Auditoria histórica](#auditoria-histórica)",
      "",
      "### CRLF Guard",
      "### Auditoria histórica",
      "### Normalizador", // novo — sem bullet no TOC
    ].join("\n")
    const res = runCli(makeTmpDir(), content)
    expect(res.status).toBe(1)
    expect(res.stderr).toContain("[heading fora do índice]")
    expect(res.stderr).toContain("'Normalizador'")
    expect(res.stderr).toContain("Encoding Guards")
    expect(res.stderr).toContain("- [Normalizador](#normalizador)")
  })

  it("exit 1 — label do bullet não casa com o heading resolvido (label), com sugestão", () => {
    const content = [
      "## Encoding Guards",
      "",
      "- [CRLF Guard](#normalizador)",
      "- [Auditoria histórica](#auditoria-histórica)",
      "",
      "### CRLF Guard",
      "### Normalizador",
      "### Auditoria histórica",
    ].join("\n")
    const res = runCli(makeTmpDir(), content)
    expect(res.status).toBe(1)
    expect(res.stderr).toContain("[label do TOC]")
    expect(res.stderr).toContain("'CRLF Guard'")
    expect(res.stderr).toContain("normalizador")
    expect(res.stderr).toContain("sugestão: '#crlf-guard'")
  })

  it("exit 1 — arquivo ilegível (fail-closed)", () => {
    const dir = makeTmpDir()
    const res = spawnSync(process.execPath, [SCRIPT, "inexistente.md"], {
      cwd: dir,
      encoding: "utf8",
    })
    expect(res.status).toBe(1)
    expect((res.stderr ?? "").toLowerCase()).toContain("não foi possível ler")
  })
})
