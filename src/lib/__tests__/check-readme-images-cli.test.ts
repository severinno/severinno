/**
 * check-readme-images-cli.test.ts
 *
 * Teste de INTEGRAÇÃO do main() do guard scripts/check-readme-images.mjs:
 * spawna a CLI REAL (process.execPath — robusto no Windows) contra um README
 * TEMPORÁRIO, validando o CONTRATO DE EXIT CODES:
 *
 *   exit 0 — todas as imagens resolvem (arquivos existem / URLs válidas)
 *   exit 1 — imagem quebrada (caminho relativo para arquivo ausente), com a
 *            mensagem apontando arquivo, linha e o motivo
 *   exit 1 — arquivo ilegível (fail-closed)
 *
 * O guard aceita caminhos como argumentos (node ... <path>) e resolve
 * caminhos relativos CONTRA O DIRETÓRIO DO ARQUIVO escaneado — então o
 * teste cria um arquivo real no diretório temporário e referencia via
 * caminho relativo (mesma semântica do GitHub).
 *
 * Usage:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/check-readme-images-cli.test.ts
 */

import { describe, it, expect, afterEach } from "vitest"
import { spawnSync } from "node:child_process"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const SCRIPT = resolve(process.cwd(), "scripts/check-readme-images.mjs")
const tmpDirs: string[] = []

function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "cri-cli-"))
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

describe("check-readme-images.mjs CLI (main)", () => {
  it("exit 0 — todas as imagens resolvem (URLs válidas + data: URI exenta)", () => {
    const content = [
      "![badge](https://img.shields.io/badge/x-1-green)",
      '<img src="https://img.shields.io/badge/y-2-blue" alt="y">',
      "![data](data:image/png;base64,xxx)",
    ].join("\n")
    const res = runCli(makeTmpDir(), content)
    expect(res.status).toBe(0)
    expect(res.stdout).toContain("✅")
  })

  it("exit 1 — imagem relativa para arquivo AUSENTE, com linha + motivo", () => {
    const dir = makeTmpDir()
    writeFileSync(join(dir, "logo.svg"), "svg", "utf8")
    const content = [
      "![ok](logo.svg)", // existe no dir temporário
      "![quebrada](img/nao-existe.png)", // ausente
    ].join("\n")
    const res = runCli(dir, content)
    expect(res.status).toBe(1)
    expect(res.stderr).toContain("README.md:2")
    expect(res.stderr).toContain("img/nao-existe.png")
    expect(res.stderr).toContain("não existe")
  })

  it("exit 1 — scheme não suportado (mailto:) é violação, não URL válida", () => {
    const content = "![x](mailto:dev@example.com)"
    const res = runCli(makeTmpDir(), content)
    expect(res.status).toBe(1)
    expect(res.stderr).toContain("scheme não suportado")
  })

  it("exit 0 — placeholders {owner}/{repo} exentos (template do README)", () => {
    const content =
      '<img src="https://github.com/{owner}/{repo}/actions/workflows/ci.yml/badge.svg" alt="ci">'
    const res = runCli(makeTmpDir(), content)
    expect(res.status).toBe(0)
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

  it("exit 0 — --network (flag filtrada dos targets) não quebra o parse", () => {
    const content = '<img src="https://img.shields.io/badge/x-1-green" alt="x">'
    writeFileSync(join(makeTmpDir(), "README.md"), content, "utf8")
    const res = spawnSync(process.execPath, [SCRIPT, "--network", "README.md"], {
      cwd: tmpDirs[tmpDirs.length - 1],
      encoding: "utf8",
    })
    expect(res.status).toBe(0)
    expect((res.stdout ?? "") + (res.stderr ?? "")).not.toContain("não foi possível")
  })
})
