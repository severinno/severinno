/**
 * check-readme-images.test.ts
 *
 * Testes unitários das funções PURAS de scripts/check-readme-images.mjs —
 * o guard que valida que TODAS as imagens do README resolvem para arquivos
 * existentes no repo (caminho relativo) ou URLs válidas, evitando imagens
 * quebradas na página principal do repositório.
 *
 * Cobre:
 *   - extractImages: sintaxes Markdown `![alt](src)` e HTML `<img src=...>`;
 *     fence-aware (imagens em code blocks NÃO contam); spans de código
 *     inline ignorados; título opcional `"..."` no markdown
 *   - validateImage: relativo existente/inexistente; URL http(s) válida e
 *     sem host; template {owner}/{repo} exento; data: URI exenta; scheme
 *     não suportado (mailto:) → violação
 *   - checkImages: agrega violações com linha + reason
 *   - Regressão REAL do README: os 6 badges <img> atuais resolvem (ground
 *     truth — 6 URLs válidas; o badge de coverage estático foi removido)
 */

import { describe, it, expect } from "vitest"
import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import {
  extractImages,
  validateImage,
  validateRelative,
  checkImages,
  checkUrlAccessible,
} from "../../../scripts/check-readme-images.mjs"

// ── extractImages ─────────────────────────────────────────────────────────

describe("extractImages", () => {
  it("extrai Markdown `![alt](src)` e HTML `<img src=...>` na mesma linha", () => {
    const content = '![logo](public/logo.svg) <img src="public/hero-provider.png" alt="hero">'
    const images = extractImages(content)
    expect(images).toHaveLength(2)
    expect(images[0]).toMatchObject({ line: 1, src: "public/logo.svg", kind: "markdown" })
    expect(images[1]).toMatchObject({ line: 1, src: "public/hero-provider.png", kind: "html" })
  })

  it("ignora imagens DENTRO de fences (```) e spans de código inline", () => {
    const content = [
      "```markdown",
      "![fake](nao-conta.png)",
      "```",
      "`![inline](tambem-nao.png)`",
      "![real](public/logo.svg)",
    ].join("\n")
    const images = extractImages(content)
    expect(images).toHaveLength(1)
    expect(images[0].src).toBe("public/logo.svg")
  })

  it('suporta título opcional no Markdown: ![alt](src "title")', () => {
    const images = extractImages('![x](public/logo.svg "Logo do repo")')
    expect(images).toHaveLength(1)
    expect(images[0].src).toBe("public/logo.svg")
  })

  it("suporta atributos antes do src na tag <img>", () => {
    const images = extractImages('<img width="120" src="public/logo.svg" alt="x">')
    expect(images).toHaveLength(1)
    expect(images[0].src).toBe("public/logo.svg")
  })
})

// ── validateRelative ──────────────────────────────────────────────────────

describe("validateRelative", () => {
  it("caminho relativo existente → ok (resolvido contra o dir do arquivo)", () => {
    const res = validateRelative("public/logo.svg", process.cwd())
    expect(res.ok).toBe(true)
    expect(res.resolved).toContain("public")
  })

  it("caminho relativo INEXISTENTE → violação com reason", () => {
    const res = validateRelative("img/nao-existe.png", process.cwd())
    expect(res.ok).toBe(false)
    expect(res.reason).toContain("não existe")
  })

  it("caminho começando com / (repo-root) resolve a partir do dir do arquivo", () => {
    const res = validateRelative("/public/logo.svg", process.cwd())
    expect(res.ok).toBe(true)
  })
})

// ── validateImage ─────────────────────────────────────────────────────────

describe("validateImage", () => {
  it("URL http(s) válida → ok com url normalizada", () => {
    const res = validateImage("https://img.shields.io/badge/x-1-green", process.cwd())
    expect(res).toMatchObject({ ok: true, kind: "url" })
    expect(res.url).toContain("https://img.shields.io")
  })

  it("URL sem host → violação", () => {
    const res = validateImage("http://", process.cwd())
    expect(res.ok).toBe(false)
    expect(res.reason).toContain("URL inválida")
  })

  it("placeholder {owner}/{repo} → exento (template do README)", () => {
    const res = validateImage(
      "https://github.com/{owner}/{repo}/actions/workflows/ci.yml/badge.svg",
      process.cwd(),
    )
    expect(res).toMatchObject({ ok: true, kind: "template" })
  })

  it("data: URI → exenta (auto-contida)", () => {
    expect(validateImage("data:image/png;base64,xxx", process.cwd())).toMatchObject({
      ok: true,
      kind: "data",
    })
  })

  it("scheme não suportado (mailto:/ftp:) → violação", () => {
    const res = validateImage("mailto:x@y.z", process.cwd())
    expect(res.ok).toBe(false)
    expect(res.reason).toContain("scheme não suportado")
  })

  it("caminho relativo inexistente → violação via validateRelative", () => {
    const res = validateImage("nao-existe.png", process.cwd())
    expect(res.ok).toBe(false)
    expect(res.reason).toContain("não existe")
  })
})

// ── checkImages ───────────────────────────────────────────────────────────

describe("checkImages", () => {
  it("agrega violações com linha + reason", () => {
    const content = [
      "![ok](public/logo.svg)",
      "![quebrada](img/nao-existe.png)",
      '<img src="https://img.shields.io/badge/x-1-green" alt="ok">',
    ].join("\n")
    const violations = checkImages(content, process.cwd())
    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatchObject({ line: 2, src: "img/nao-existe.png" })
    expect(violations[0].reason).toContain("não existe")
  })
})

// ── Regressão REAL do README ──────────────────────────────────────────────

describe("regressão real do README", () => {
  it("os 6 badges <img> atuais resolvem (URLs válidas)", () => {
    const readmePath = join(process.cwd(), "README.md")
    if (!existsSync(readmePath)) return // ambiente sem o README — pula
    const readme = readFileSync(readmePath, "utf8")
    // pin do COUNT de extração: se uma regressão do regex DERRUBAR uma imagem
    // da varredura, o toEqual([]) abaixo passaria mesmo assim — o count trava
    // o ground truth (espelha a filosofia do check-e2e-counts)
    expect(extractImages(readme).length).toBe(6)
    const violations = checkImages(readme, join(process.cwd(), "README.md", ".."))
    expect(violations, JSON.stringify(violations)).toEqual([])
  })
})

// ── checkUrlAccessible (modo --network) ───────────────────────────────────

describe("checkUrlAccessible", () => {
  it("retorna false para URL sem host sem lançar (fail-closed)", async () => {
    const ok = await checkUrlAccessible("http://")
    expect(ok).toBe(false)
  })
})
