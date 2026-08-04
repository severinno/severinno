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

  it("--reverse-strict --prose-allowlist: prosa single-token EXIMIDA → exit 0 (falso positivo eliminado)", () => {
    // O cenário REAL: label 'abaixo' (prosa, len 6) aponta para heading
    // legítimo — o strict SEM allowlist acusaria (exit 1); com 'abaixo' na
    // allowlist o token cai na regra 3 (prosa → exento) e o guard passa.
    const content = [
      "## Encoding Guards",
      "",
      "- [abaixo](#crlf-guard)",
      "- [CRLF Guard](#crlf-guard)",
      "",
      "### CRLF Guard",
    ].join("\n")
    writeFileSync(join(makeTmpDir(), "README.md"), content, "utf8")
    const res = spawnSync(
      process.execPath,
      [
        SCRIPT,
        "--reverse-strict",
        "--prose-allowlist",
        "abaixo,acima,seguir,aqui,fluxo",
        "README.md",
      ],
      { cwd: tmpDirs[tmpDirs.length - 1], encoding: "utf8" },
    )
    expect(res.status).toBe(0)
    expect(res.stdout ?? "").toContain("forward + reverse-strict")
  })

  it("--reverse-strict SEM allowlist: a mesma prosa single-token → exit 1 (contraste)", () => {
    const content = [
      "## Encoding Guards",
      "",
      "- [abaixo](#crlf-guard)",
      "- [CRLF Guard](#crlf-guard)",
      "",
      "### CRLF Guard",
    ].join("\n")
    writeFileSync(join(makeTmpDir(), "README.md"), content, "utf8")
    const res = spawnSync(process.execPath, [SCRIPT, "--reverse-strict", "README.md"], {
      cwd: tmpDirs[tmpDirs.length - 1],
      encoding: "utf8",
    })
    expect(res.status).toBe(1)
    expect(res.stderr ?? "").toContain("[reverse-strict]")
  })

  it("--reverse-strict: renomeação com token PARECIDO → exit 1 com sugestão por similaridade", () => {
    // 'Guard' aponta para #normalizador; nenhum heading tem 'guard', mas
    // 'Guardian' tem 'guardian' → tokenSimilarity('guard','guardian') = 1 −
    // 3/8 = 0.625 ≥ 0.4 → sugestão '#guardian' impressa com a similaridade
    // (toFixed(2) → '0.63'). Seção 'Seção' de propósito: um 'Encoding
    // Guards' roubaria a sugestão ('guard'→'guards' sim 0.83).
    const content = [
      "## Seção",
      "",
      "- [Guard](#normalizador)",
      "",
      "### Guardian",
      "### Normalizador",
    ].join("\n")
    writeFileSync(join(makeTmpDir(), "README.md"), content, "utf8")
    const res = spawnSync(process.execPath, [SCRIPT, "--reverse-strict", "README.md"], {
      cwd: tmpDirs[tmpDirs.length - 1],
      encoding: "utf8",
    })
    expect(res.status).toBe(1)
    expect(res.stderr ?? "").toContain("[reverse-strict]")
    expect(res.stderr ?? "").toContain("sugestão: '#guardian'")
    expect(res.stderr ?? "").toContain("similaridade 0.63")
  })

  it("--reverse-strict: melhor similaridade ABAIXO do limiar → 'nenhum heading corresponde'", () => {
    // 'Guard' vs 'Normalizador' — nenhum token parecido (sim 0 < 0.4) → o
    // render emite 'nenhum heading corresponde' com a melhor similaridade.
    // Seção neutra: 'Encoding Guards' roubaria a sugestão (sim 0.83).
    const content = ["## Seção", "", "- [Guard](#normalizador)", "", "### Normalizador"].join("\n")
    writeFileSync(join(makeTmpDir(), "README.md"), content, "utf8")
    const res = spawnSync(process.execPath, [SCRIPT, "--reverse-strict", "README.md"], {
      cwd: tmpDirs[tmpDirs.length - 1],
      encoding: "utf8",
    })
    expect(res.status).toBe(1)
    expect(res.stderr ?? "").toContain("[reverse-strict]")
    expect(res.stderr ?? "").toContain("nenhum heading corresponde")
  })

  it("--reverse-strict --min-suggestion-sim 0.7: candidato razoável (0.625) fica abaixo → 'nenhum heading corresponde'", () => {
    // Limiar configurável: 'guard'→'guardian' = 0.625 < 0.7 → sugere null
    // mesmo com candidato razoável.
    const content = [
      "## Seção",
      "",
      "- [Guard](#normalizador)",
      "",
      "### Guardian",
      "### Normalizador",
    ].join("\n")
    writeFileSync(join(makeTmpDir(), "README.md"), content, "utf8")
    const res = spawnSync(
      process.execPath,
      [SCRIPT, "--reverse-strict", "--min-suggestion-sim", "0.7", "README.md"],
      { cwd: tmpDirs[tmpDirs.length - 1], encoding: "utf8" },
    )
    expect(res.status).toBe(1)
    expect(res.stderr ?? "").toContain("nenhum heading corresponde")
  })

  it("--reverse-strict --prose-allowlist: renomeação single-token REAL continua exit 1", () => {
    // 'guard' NÃO está na allowlist — o token não existe em nenhum heading
    // (heading renomeado 'Gate') → o strict segue flagrando a renomeação
    // real, mesmo com a allowlist presente. Prova que a allowlist só exime
    // prosa, não renomeação.
    const content = [
      "## Encoding Guards",
      "",
      "- [Guard](#gate)", // heading 'Gate' não tem o token 'guard'
      "",
      "### Gate",
    ].join("\n")
    writeFileSync(join(makeTmpDir(), "README.md"), content, "utf8")
    const res = spawnSync(
      process.execPath,
      [
        SCRIPT,
        "--reverse-strict",
        "--prose-allowlist",
        "abaixo,acima,seguir,aqui,fluxo",
        "README.md",
      ],
      { cwd: tmpDirs[tmpDirs.length - 1], encoding: "utf8" },
    )
    expect(res.status).toBe(1)
    expect(res.stderr ?? "").toContain("[reverse-strict]")
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

describe("check-readme-anchors.mjs CLI (links cross-doc docs/*.md#anchor)", () => {
  it("exit 0 — [X](docs/api.md#anchor) resolve para heading real do alvo (acentos preservados)", () => {
    const dir = makeTmpDir()
    const res = runCliDefault(dir, {
      "README.md": "# Main\n\nVeja [API](docs/api.md#seção-x).\n",
      "docs/api.md": "# API\n\n## Seção X\n",
    })
    expect(res.status).toBe(0)
    expect(res.stdout).toContain("✅")
  })

  it("exit 1 — âncora NÃO existe no arquivo alvo → [cross-doc] com linha e alvo", () => {
    const dir = makeTmpDir()
    const res = runCliDefault(dir, {
      "README.md": "# Main\n\nVeja [API](docs/api.md#seção-y).\n",
      "docs/api.md": "# API\n\n## Seção X\n",
    })
    expect(res.status).toBe(1)
    expect(res.stderr).toContain("README.md:3")
    expect(res.stderr).toContain("[cross-doc]")
    expect(res.stderr).toContain("docs/api.md#seção-y")
    expect(res.stderr).toContain("NÃO existe em 'docs/api.md'")
    expect(res.stderr).toContain("#seção-x") // sugestão do heading mais próximo
  })

  it("exit 1 — ARQUIVO alvo NÃO existe → [cross-doc] com mensagem de arquivo", () => {
    const dir = makeTmpDir()
    const res = runCliDefault(dir, {
      "README.md": "# Main\n\nVeja [Ghost](docs/ghost.md#x).\n",
    })
    expect(res.status).toBe(1)
    expect(res.stderr).toContain("[cross-doc]")
    expect(res.stderr).toContain("ARQUIVO 'docs/ghost.md' NÃO existe")
  })

  it("exit 0 — link ../README.md#anchor a partir de docs/ resolve relativo", () => {
    const dir = makeTmpDir()
    const res = runCliDefault(dir, {
      "README.md": "# Main\n\n## Seção Raiz\n",
      "docs/foo.md": "# Foo\n\nVolta ao [Raiz](../README.md#seção-raiz).\n",
    })
    expect(res.status).toBe(0)
    expect(res.stdout).toContain("✅")
  })

  it("exit 0 — link cross-doc para o PRÓPRIO arquivo (README.md#x) resolve", () => {
    const dir = makeTmpDir()
    const res = runCliDefault(dir, {
      "README.md": "# Main\n\n## Seção\n\n[Self](README.md#seção).\n",
    })
    expect(res.status).toBe(0)
    expect(res.stdout).toContain("✅")
  })

  it("exit 1 — ARQUIVO alvo sem âncora (docs/x.md sem #) NÃO é validado (contrato: só file#anchor)", () => {
    // link de arquivo SEM âncora (`docs/api.md`) fica FORA do escopo — o
    // regex exige `.md#anchor`. O guard NÃO falha por um .md citado sem #.
    const dir = makeTmpDir()
    const res = runCliDefault(dir, {
      "README.md": "# Main\n\nVeja [API](docs/api.md).\n",
    })
    expect(res.status).toBe(0)
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
