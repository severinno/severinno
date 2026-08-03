/**
 * check-readme-anchors-cli.test.ts
 *
 * Teste de INTEGRAÇÃO do main() do guard scripts/check-readme-anchors.mjs:
 * spawna a CLI REAL (process.execPath — robusto no Windows) contra um README
 * TEMPORÁRIO, validando o CONTRATO DE EXIT CODES:
 *
 *   exit 0 — todos os links internos resolvem para headings reais
 *   exit 1 — pelo menos um link quebrado (heading renomeado sem atualizar o
 *            link), com a mensagem apontando a linha e o heading mais próximo
 *   exit 1 — arquivo ilegível (fail-closed)
 *
 * Modo --reverse (opcional, fora do CI): com a flag, links que RESOLVEM mas
 * apontam para o heading SEMANTICAMENTE errado (ex.: [CRLF Guard] apontando
 * para #normalizador) falham com exit 1 e mensagem [reverse] + sugestão;
 * sem a flag, o mesmo link passa (contrato forward-only preservado).
 *
 * O guard aceita caminhos como argumentos (node ... <path>), então o teste
 * roda com cwd no diretório temporário e passa o nome do arquivo — sem
 * depender do README real do repo.
 *
 * Usage:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/check-readme-anchors-cli.test.ts
 */

import { describe, it, expect, afterEach } from "vitest"
import { spawnSync } from "node:child_process"
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve, dirname } from "node:path"

const SCRIPT = resolve(process.cwd(), "scripts/check-readme-anchors.mjs")
const tmpDirs: string[] = []

function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "cra-cli-"))
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

/** Roda a CLI SEM target (default: README.md + auto-descoberta de docs/*.md). */
function runCliDefault(
  dir: string,
  files: Record<string, string>,
): { status: number; stdout: string; stderr: string } {
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, content, "utf8")
  }
  const res = spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: "utf8" })
  return { status: res.status ?? -1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" }
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe("check-readme-anchors.mjs CLI (main)", () => {
  it("exit 0 — todos os links resolvem (âncoras acentuadas inclusas)", () => {
    const content = [
      "## Encoding Guards",
      "",
      "- [Auditoria histórica](#auditoria-histórica)",
      "- [Por que .sh-only?](#por-que-o-guard-de-crlf-é-sh-only)",
      "",
      "### Auditoria histórica",
      "### Por que o guard de CRLF é `.sh`-only",
    ].join("\n")
    const res = runCli(makeTmpDir(), content)
    expect(res.status).toBe(0)
    expect(res.stdout).toContain("✅")
  })

  it("exit 1 — heading renomeado sem atualizar o link, com linha + sugestão", () => {
    const content = [
      "## Encoding Guards",
      "",
      "- [CRLF Guard](#crlf-guard)", // heading foi renomeado para baixo
      "",
      "### Gate CRLF",
    ].join("\n")
    const res = runCli(makeTmpDir(), content)
    expect(res.status).toBe(1)
    expect(res.stderr).toContain("README.md:3")
    expect(res.stderr).toContain("#crlf-guard")
    expect(res.stderr).toContain("heading mais próximo")
  })

  it("exit 1 — link órfão (nenhum heading) com mensagem clara", () => {
    const res = runCli(makeTmpDir(), "Veja [fantasma](#nao-existe).")
    expect(res.status).toBe(1)
    expect(res.stderr).toContain("nao-existe")
    expect(res.stderr).toContain("nenhum heading")
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

  it("SEM --reverse: link para heading errado mas que resolve → exit 0 (forward-only)", () => {
    // sem a flag, a validação semântica NÃO roda — só o forward (link resolve)
    const content = [
      "## Encoding Guards",
      "",
      "- [CRLF Guard](#normalizador)", // resolve, mas aponta errado
      "- [Auditoria histórica](#auditoria-histórica)",
      "",
      "### CRLF Guard",
      "### Auditoria histórica",
      "### Normalizador",
    ].join("\n")
    const res = runCli(makeTmpDir(), content)
    expect(res.status).toBe(0)
  })

  it("--reverse: link para heading errado mas que resolve → exit 1 com [reverse]", () => {
    const content = [
      "## Encoding Guards",
      "",
      "- [CRLF Guard](#normalizador)", // aponta para o heading errado
      "- [Auditoria histórica](#auditoria-histórica)",
      "",
      "### CRLF Guard",
      "### Auditoria histórica",
      "### Normalizador",
    ].join("\n")
    writeFileSync(join(makeTmpDir(), "README.md"), content, "utf8")
    // passa o caminho EXPLÍCITO + --reverse (a flag pode vir antes ou depois)
    const res = spawnSync(process.execPath, [SCRIPT, "README.md", "--reverse"], {
      cwd: tmpDirs[tmpDirs.length - 1],
      encoding: "utf8",
    })
    expect(res.status).toBe(1)
    expect(res.stderr ?? "").toContain("[reverse]")
    expect(res.stderr ?? "").toContain("CRLF Guard")
    expect(res.stderr ?? "").toContain("normalizador")
    expect(res.stderr ?? "").toContain("#crlf-guard")
  })

  it("--reverse: README limpo (labels corretos) → exit 0", () => {
    const content = [
      "## Encoding Guards",
      "",
      "- [CRLF Guard](#crlf-guard)",
      "- [Auditoria histórica](#auditoria-histórica)",
      "",
      "### CRLF Guard",
      "### Auditoria histórica",
    ].join("\n")
    writeFileSync(join(makeTmpDir(), "README.md"), content, "utf8")
    const res = spawnSync(process.execPath, [SCRIPT, "--reverse", "README.md"], {
      cwd: tmpDirs[tmpDirs.length - 1],
      encoding: "utf8",
    })
    expect(res.status).toBe(0)
    expect(res.stdout ?? "").toContain("forward + reverse")
  })
})

describe("check-readme-anchors.mjs CLI (--reverse-strict)", () => {
  it("SEM --reverse-strict: label single-token inexistente → exit 0 (contrato preservado)", () => {
    const content = [
      "## Encoding Guards",
      "",
      "- [Guard](#normalizador)", // prosa no modo normal → exento
      "",
      "### Normalizador",
    ].join("\n")
    const res = runCli(makeTmpDir(), content)
    expect(res.status).toBe(0)
  })

  it("--reverse-strict: label single-token inexistente em qualquer heading → exit 1 com [reverse-strict]", () => {
    const content = [
      "## Encoding Guards",
      "",
      "- [Guard](#normalizador)",
      "",
      "### Normalizador",
    ].join("\n")
    writeFileSync(join(makeTmpDir(), "README.md"), content, "utf8")
    const res = spawnSync(process.execPath, [SCRIPT, "--reverse-strict", "README.md"], {
      cwd: tmpDirs[tmpDirs.length - 1],
      encoding: "utf8",
    })
    expect(res.status).toBe(1)
    expect(res.stderr ?? "").toContain("[reverse-strict]")
    expect(res.stderr ?? "").toContain("Guard")
    expect(res.stderr ?? "").toContain("normalizador")
  })

  it("--reverse-strict --min-label-len 2: 'OK' passa a ser sinalizado → exit 1", () => {
    const content = [
      "## Encoding Guards",
      "",
      "- [OK](#normalizador)", // 2 chars < threshold default 3, mas 2 >= 2
      "",
      "### Normalizador",
    ].join("\n")
    writeFileSync(join(makeTmpDir(), "README.md"), content, "utf8")
    const res = spawnSync(
      process.execPath,
      [SCRIPT, "--reverse-strict", "--min-label-len", "2", "README.md"],
      { cwd: tmpDirs[tmpDirs.length - 1], encoding: "utf8" },
    )
    expect(res.status).toBe(1)
    expect(res.stderr ?? "").toContain("[reverse-strict]")
    expect(res.stderr ?? "").toContain("OK")
  })

  it("--reverse-strict: README limpo → exit 0 com 'forward + reverse-strict'", () => {
    const content = [
      "## Encoding Guards",
      "",
      "- [CRLF Guard](#crlf-guard)",
      "- [Auditoria histórica](#auditoria-histórica)",
      "",
      "### CRLF Guard",
      "### Auditoria histórica",
    ].join("\n")
    writeFileSync(join(makeTmpDir(), "README.md"), content, "utf8")
    const res = spawnSync(process.execPath, [SCRIPT, "--reverse-strict", "README.md"], {
      cwd: tmpDirs[tmpDirs.length - 1],
      encoding: "utf8",
    })
    expect(res.status).toBe(0)
    expect(res.stdout ?? "").toContain("forward + reverse-strict")
  })
})

describe("check-readme-anchors.mjs CLI (default sem target — auto-descoberta docs/*.md)", () => {
  it("docs/ AUSENTE → exit 0 (README.md apenas — fixtures de mutation não quebram)", () => {
    const dir = makeTmpDir()
    writeFileSync(join(dir, "README.md"), "## X\n\n- [X](#x)\n", "utf8")
    const res = spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: "utf8" })
    expect(res.status).toBe(0)
    expect(res.stdout ?? "").toContain("✅")
    expect(res.stdout ?? "").toContain("README.md")
  })

  it("docs/ limpo → exit 0 com o nome dos docs no relatório", () => {
    const dir = makeTmpDir()
    const res = runCliDefault(dir, {
      "README.md": "# Main\n",
      "docs/a.md": "# A\n\n- [A](#a)\n",
      "docs/z.md": "# Z\n\n- [Z](#z)\n",
    })
    expect(res.status).toBe(0)
    expect(res.stdout).toContain("docs/a.md")
    expect(res.stdout).toContain("docs/z.md")
  })

  it("link quebrado em docs/ → exit 1 com 'docs/foo.md:linha'", () => {
    const dir = makeTmpDir()
    const res = runCliDefault(dir, {
      "README.md": "# Main\n",
      "docs/foo.md": [
        "## Seção",
        "",
        "- [CRLF Guard](#crlf-guard)", // heading renomeado abaixo
        "",
        "### Gate CRLF",
      ].join("\n"),
    })
    expect(res.status).toBe(1)
    expect(res.stderr).toContain("docs/foo.md:3")
    expect(res.stderr).toContain("#crlf-guard")
  })

  it("target explícito ainda sobreescreve a auto-descoberta (docs/ não é escaneado)", () => {
    const dir = makeTmpDir()
    // docs/foo.md com link quebrado + target explícito 'README.md' → o guard
    // NÃO deve escanear o docs/ (contrato: targets explícitos substituem o
    // default). README.md limpo → exit 0.
    const res = runCliDefault(dir, {
      "README.md": "# Main\n",
      "docs/foo.md": "## X\n\n- [Quebrado](#nao-existe)\n",
    })
    const explicit = spawnSync(process.execPath, [SCRIPT, "README.md"], {
      cwd: dir,
      encoding: "utf8",
    })
    expect(explicit.status).toBe(0)
    expect(res.status).toBe(1) // default SEM target pega o docs/ quebrado
  })
})

describe("check-readme-anchors.mjs CLI (--json report mode)", () => {
  it("--json: README com drift semântico → exit 0 SEMPRE, com JSON {count, findings} no stdout", () => {
    const content = [
      "## Encoding Guards",
      "",
      "- [CRLF Guard](#normalizador)", // resolve, mas aponta errado
      "- [Auditoria histórica](#auditoria-histórica)",
      "",
      "### CRLF Guard",
      "### Auditoria histórica",
      "### Normalizador",
    ].join("\n")
    writeFileSync(join(makeTmpDir(), "README.md"), content, "utf8")
    const res = spawnSync(process.execPath, [SCRIPT, "--reverse", "--json", "README.md"], {
      cwd: tmpDirs[tmpDirs.length - 1],
      encoding: "utf8",
    })
    // REPORT: exit 0 MESMO com achados — o caller (baseline guard) decide
    expect(res.status).toBe(0)
    const out = JSON.parse(res.stdout ?? "")
    expect(out.count).toBe(1)
    expect(out.findings).toHaveLength(1)
    expect(out.findings[0]).toMatchObject({
      type: "reverse",
      slug: "normalizador",
      label: "CRLF Guard",
    })
  })

  it("--json: README limpo → exit 0 com count 0", () => {
    const content = [
      "## Encoding Guards",
      "",
      "- [CRLF Guard](#crlf-guard)",
      "- [Auditoria histórica](#auditoria-histórica)",
      "",
      "### CRLF Guard",
      "### Auditoria histórica",
    ].join("\n")
    writeFileSync(join(makeTmpDir(), "README.md"), content, "utf8")
    const res = spawnSync(process.execPath, [SCRIPT, "--reverse", "--json", "README.md"], {
      cwd: tmpDirs[tmpDirs.length - 1],
      encoding: "utf8",
    })
    expect(res.status).toBe(0)
    expect(JSON.parse(res.stdout ?? "")).toMatchObject({ count: 0, findings: [] })
  })
})
