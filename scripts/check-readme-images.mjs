#!/usr/bin/env node

// =============================================================================
// check-readme-images.mjs
//
// CI guard (fast gate, <1s, node-puro) que valida que TODAS as imagens do
// README resolvem para algo real — prevenindo imagens quebradas na página
// principal do repositório:
//
//   - caminho RELATIVO → o arquivo DEVE existir no repo (resolvido a partir
//     do diretório do arquivo escaneado, ex.: README.md → raiz do repo);
//   - URL http(s) → validação SINTÁTICA sempre (scheme + host presentes);
//     com a flag --network, faz HEAD real em cada URL (modo mais lento,
//     ~1-2s/URL — fora do fast gate padrão);
//   - data: URIs → exentas (auto-contidas, nunca quebram);
//   - placeholders {owner}/{repo} → exentos (template do README, substituído
//     ao publicar — não é imagem quebrada);
//   - outros schemes (mailto:, ftp:, tel:) → violação (não são imagem válida).
//
// Sintaxes cobertas (as duas que o GitHub renderiza):
//   - Markdown: ![alt](src) e ![alt](src "title")
//   - HTML: <img src="..." alt="...">
//
// Cuidados de extração (falsos positivos evitados):
//   - FENCES (```): imagens dentro de blocos de código NÃO contam;
//   - spans de código inline (`...`) são ignorados na extração.
//
// Usage:
//   node scripts/check-readme-images.mjs            # escaneia README.md
//   node scripts/check-readme-images.mjs docs/x.md  # escaneia outro(s)
//   node scripts/check-readme-images.mjs --network  # + HEAD real nas URLs
//
// Exit codes:
//   0 — todas as imagens resolvem (arquivos existem / URLs válidas)
//   1 — pelo menos uma imagem quebrada (arquivo ausente ou URL inválida)
// =============================================================================

import { readFileSync, existsSync } from "node:fs"
import { join, dirname, resolve } from "node:path"
import { pathToFileURL } from "node:url"

/** Regex de imagem Markdown: `![alt](src)` com título opcional `"..."`. */
const MD_IMG_RE = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g

/** Regex de tag <img ... src="..."> (HTML). */
const HTML_IMG_RE = /<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/gi

/**
 * Placeholder de template do README (ex.: {owner}/{repo}). SEM a flag `g` de
 * propósito: usado só com .test(), e um regex global vazaria lastIndex entre
 * chamadas (3+ imagens template consecutivas falseariam como violação).
 */
const TEMPLATE_PLACEHOLDER_RE = /\{[^}]*\}/

/**
 * Extrai as imagens do conteúdo nas DUAS sintaxes (Markdown `![]()` e HTML
 * `<img src=...>`), ignorando fences e spans de código inline.
 *
 * @param {string} content
 * @returns {{ line: number, src: string, kind: "markdown" | "html" }[]}
 */
export function extractImages(content) {
  const images = []
  let inFence = false
  const lines = content.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()
    if (trimmed.startsWith("```")) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    // remove spans de código inline (`...`) — imagens dentro deles não contam
    const noInlineCode = line.replace(/`[^`]*`/g, "")
    const found = []
    HTML_IMG_RE.lastIndex = 0
    let m
    while ((m = HTML_IMG_RE.exec(noInlineCode)) !== null) {
      found.push({ index: m.index, src: m[1].trim(), kind: "html" })
    }
    MD_IMG_RE.lastIndex = 0
    while ((m = MD_IMG_RE.exec(noInlineCode)) !== null) {
      found.push({ index: m.index, src: m[2].trim(), kind: "markdown" })
    }
    // ORDEM DE DOCUMENTO: as duas sintaxes podem coexistir na MESMA linha —
    // ordenar por posição garante que `![md]` antes de `<img>` não inverta.
    found.sort((a, b) => a.index - b.index)
    for (const f of found) images.push({ line: i + 1, src: f.src, kind: f.kind })
  }
  return images
}

/**
 * Resolve e valida UM caminho relativo de imagem contra o diretório do
 * arquivo escaneado (semântica do GitHub: relativo ao arquivo markdown).
 *
 * @param {string} src
 * @param {string} fileDir  diretório do arquivo escaneado
 * @returns {{ ok: boolean, resolved?: string, reason?: string }}
 */
export function validateRelative(src, fileDir) {
  // caminho absoluto/repo-root? GitHub resolve um `/foo.png` relativo à RAIZ
  // do repo — correto hoje porque o alvo padrão é README.md (na raiz, onde
  // fileDir === repo-root). Para um alvo ANINHADO futuro (docs/x.md), um `/`
  // deveria resolver contra a raiz do repo e não contra fileDir — assumir a
  // raiz só é correto enquanto o guard escanear arquivos de nível raiz.
  const clean = src.startsWith("/") ? src.slice(1) : src
  const resolved = resolve(fileDir, clean)
  if (existsSync(resolved)) return { ok: true, resolved }
  return { ok: false, resolved, reason: `arquivo não existe: ${resolved}` }
}

/**
 * Valida UMA referência de imagem:
 *   - data: URI → exenta (auto-contida);
 *   - placeholder {..} → exento (template do README);
 *   - URL http(s) → sintática (scheme + host); --network faz HEAD real;
 *   - outro scheme (mailto:, ftp:) → violação;
 *   - relativo → precisa existir no disco (validateRelative).
 *
 * @param {string} src
 * @param {string} fileDir
 * @returns {{ ok: boolean, kind: string, resolved?: string, reason?: string, url?: string }}
 */
export function validateImage(src, fileDir) {
  if (src.startsWith("data:")) return { ok: true, kind: "data" }
  if (TEMPLATE_PLACEHOLDER_RE.test(src)) return { ok: true, kind: "template" }
  if (/^https?:\/\//i.test(src)) {
    try {
      const u = new URL(src)
      if (!u.hostname) return { ok: false, kind: "url", reason: `URL sem host: ${src}` }
      return { ok: true, kind: "url", url: u.href }
    } catch {
      return { ok: false, kind: "url", reason: `URL inválida: ${src}` }
    }
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(src)) {
    return {
      ok: false,
      kind: "scheme",
      reason: `scheme não suportado (não é http/https/data): ${src}`,
    }
  }
  return validateRelative(src, fileDir)
}

/**
 * Valida TODAS as imagens de um conteúdo contra o diretório do arquivo.
 *
 * @param {string} content
 * @param {string} fileDir
 * @returns {{ line: number, src: string, kind: string, resolved?: string, reason?: string, url?: string }[]}
 */
export function checkImages(content, fileDir) {
  return extractImages(content)
    .map((img) => ({
      line: img.line,
      src: img.src,
      kind: img.kind,
      ...validateImage(img.src, fileDir),
    }))
    .filter((r) => !r.ok)
}

/**
 * HEAD real em uma URL (modo --network): 2xx/3xx = acessível. Timeout curto
 * (5s) para o guard não travar em rede lenta.
 *
 * @param {string} url
 * @returns {Promise<boolean>}
 */
export async function checkUrlAccessible(url) {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(5000),
    })
    return res.ok || res.status < 400
  } catch {
    // rede fora / timeout — trata como inacessível (fail-closed)
    return false
  }
}

/** Nome padrão do arquivo escaneado quando nenhum caminho é passado. */
export const DEFAULT_PATH = "README.md"

async function main() {
  const args = process.argv.slice(2)
  const network = args.includes("--network")
  const targets = args.filter((a) => a !== "--network")
  const resolvedTargets = targets.length > 0 ? targets : [DEFAULT_PATH]
  const allViolations = []
  let imageCount = 0

  for (const target of resolvedTargets) {
    const path = join(process.cwd(), target)
    let content
    try {
      content = readFileSync(path, "utf8")
    } catch (e) {
      console.error(`❌ Não foi possível ler ${target}: ${e.message}`)
      process.exit(1)
    }
    const fileDir = dirname(path)
    const violations = checkImages(content, fileDir)
    for (const v of violations) allViolations.push({ file: target, ...v })
    if (imageCount === 0) imageCount = extractImages(content).length

    // modo --network: HEAD real nas URLs válidas sintaticamente
    if (network) {
      const urls = extractImages(content)
        .map((img) => ({ line: img.line, ...validateImage(img.src, fileDir) }))
        .filter((r) => r.ok && r.kind === "url")
      for (const u of urls) {
        const accessible = await checkUrlAccessible(u.url)
        if (!accessible) {
          allViolations.push({
            file: target,
            line: u.line,
            src: u.url,
            kind: "url",
            reason: `URL inacessível (HEAD): ${u.url}`,
          })
        }
      }
    }
  }

  if (allViolations.length > 0) {
    console.error(`❌ Imagem(ns) do README quebrada(s) (${allViolations.length}):\n`)
    for (const v of allViolations) {
      console.error(`   - ${v.file}:${v.line} [${v.kind}] '${v.src}': ${v.reason}\n`)
    }
    console.error(
      `   Ação: o caminho relativo DEVE existir no repo (ou o arquivo foi\n` +
        `   removido/esquecido no commit?), e URLs http(s) precisam ser válidas.\n` +
        `   Exceções intencionais: data: URIs e placeholders {owner}/{repo}.`,
    )
    process.exit(1)
  }

  const mode = network ? "sintaxe + HEAD real" : "sintaxe (arquivos existem)"
  console.log(
    `✅ Todas as imagens resolvem (${resolvedTargets.join(", ")}; ${imageCount} imagem(ns); ${mode}).`,
  )
  process.exit(0)
}

// True apenas quando executado diretamente (node ...) — permite importar as
// funções puras em testes unitários sem disparar o scan.
const IS_DIRECT_RUN =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (IS_DIRECT_RUN) main()
