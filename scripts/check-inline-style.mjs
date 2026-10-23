#!/usr/bin/env node
/**
 * check-inline-style.mjs
 *
 * Guard anti-<style>-inline: reprova QUALQUER ponto de renderização de
 * `<style>` em .tsx do app fora da allowlist, garantindo que a CSP estrita
 * (src/lib/csp.ts — `style-src`/`style-src-elem` SEM 'unsafe-inline') não
 * volte atrás por engano. Padrão check-* do repo: funções puras exportadas
 * (testáveis) + main() só em CLI. SEM imports de pacotes — node builtins
 * apenas (testes da forja copiam o script para /tmp sem node_modules).
 *
 * Exit codes:
 *   0 — nenhum <style> inline fora da allowlist e hash da CSP íntegro (pass)
 *   1 — pelo menos uma violação (novo <style> ou hash dessincronizado) (fail)
 *
 * Usage:
 *   node scripts/check-inline-style.mjs
 *
 * Por que (o defeito que fecha):
 *   A CSP não tem 'unsafe-inline' em style-src-elem — o único <style> inline
 *   legítimo é o do global-error.tsx, cujo conteúdo é pinado por HASH:
 *     'sha256-eqW5FnLZ2T07K7f5xhzEJOVJru1NKj1t3pH4q2urlAE='
 *   Consequências silenciosas que o build NÃO pega:
 *   1. Um .tsx novo com <style> inline compila e roda — e o BROWSER bloqueia
 *      o estilo em produção (página renderiza sem estilo, sem erro nenhum).
 *   2. Editar o `styles` do global-error sem atualizar o hash quebra a PINA
 *      ATUAL: a página de erro raiz (última linha de defesa quando tudo
 *      mais falhou) fica sem estilo.
 *
 * O que o guard reprova:
 *   - `<style` em JSX (elemento, self-closing, com atributos) em qualquer
 *     .tsx de src/ FORA de arquivos de teste e fora da allowlist.
 *   - Hash da CSP dessincronizado com o `styles` do global-error (a prova
 *     criptográfica de que a allowlist segue sendo válida).
 *
 * Allowlist (cada entrada com motivo — editar aqui é revisado em PR):
 *   - src/app/global-error.tsx — a página de erro raiz renderiza fora da
 *     árvore normal (Next desmonta tudo num erro de render), sem CSS externo
 *     garantido; <style> auto-contido é obrigatório e é o hash pinado.
 *
 *     (Único membro hoje: o wrapper de charts do shadcn que também o tinha
 *     foi REMOVIDO em 2026-10-02 — código morto, zero consumidores; se um dia
 *     um wrapper de chart voltar, use style={{}}/CSSOM ou peça hash novo.)
 *
 * Heurística e limitações documentadas:
 *   - Comentários (JSDoc, de linha e comentários JSX de bloco) e CONTEÚDO de
 *     strings/template literals são ignorados — `<style>` citado em comentário
 *     ou dentro de CSS gerado não é flagado (varre char a char com máquina de
 *     estados).
 *   - Um `<style>` injetado EXCLUSIVAMENTE via string (ex.:
 *     dangerouslySetInnerHTML={{ __html: "<style>..." }}) escapa — é a
 *     mesma classe de limitação documentada do check-clock-bombs.
 *   - Interpolação ${...} dentro de template literal é tratada como parte
 *     da string (escapa da análise) — irrelevante para o caso real.
 */

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs"
import { join, relative } from "node:path"
import { pathToFileURL } from "node:url"
import { createHash } from "node:crypto"

// ── Allowlist — <style> inline permitidos (path exato, com motivo) ─────────

export const ALLOWLIST = [
  {
    path: "src/app/global-error.tsx",
    reason:
      "Página de erro raiz renderiza fora da árvore normal, sem CSS externo garantido; <style> auto-contido é obrigatório e o conteúdo é pinado por hash em style-src-elem (src/lib/csp.ts).",
    addedAt: "2026-10-02",
  },
]

// ── Detecção ────────────────────────────────────────────────────────────────

/**
 * Máquina de estados char a char: BLANCA (troca por espaço) comentários de
 * linha, blocos de comentário (inclusive JSDoc) e conteúdo de strings
 * ('...', "...", `...`) preservando quebras de linha — para que a linha
 * casada na saída tenha o mesmo número da original. Escape (backslash-x)
 * respeitado dentro de strings. Template literal persiste entre linhas;
 * interpolação dollar-chaves é tratada como parte da string.
 */
export function blankCommentsAndStrings(content) {
  const out = []
  let inBlockComment = false
  let inLineComment = false
  let inSingle = false
  let inDouble = false
  let inTemplate = false

  for (let i = 0; i < content.length; i++) {
    const ch = content[i]
    const next = i + 1 < content.length ? content[i + 1] : ""

    if (ch === "\n") {
      inLineComment = false
      out.push("\n")
      continue
    }

    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false
        out.push("  ")
        i++
      } else {
        out.push(" ")
      }
      continue
    }
    if (inLineComment) {
      out.push(" ")
      continue
    }
    if (inSingle || inDouble || inTemplate) {
      // Escape dentro de string: consome o par, mantém branco.
      if ((inSingle || inDouble) && ch === "\\") {
        out.push("  ")
        i++
        continue
      }
      if (inSingle && ch === "'") inSingle = false
      else if (inDouble && ch === '"') inDouble = false
      else if (inTemplate && ch === "`") inTemplate = false
      out.push(ch === "\t" ? "\t" : " ")
      continue
    }

    if (ch === "/" && next === "*") {
      inBlockComment = true
      out.push("  ")
      i++
      continue
    }
    if (ch === "/" && next === "/") {
      inLineComment = true
      out.push("  ")
      i++
      continue
    }
    if (ch === "'") {
      inSingle = true
      out.push(" ")
      continue
    }
    if (ch === '"') {
      inDouble = true
      out.push(" ")
      continue
    }
    if (ch === "`") {
      inTemplate = true
      out.push(" ")
      continue
    }
    out.push(ch)
  }
  return out.join("")
}

/** `<style` em abertura de elemento JSX (não `</style>`, não `<styleSheet`). */
const STYLE_OPEN_RE = /<style(?=$|[\s>{/])/

/**
 * Linhas que abrem um elemento <style> em JSX (após branquear comentários e
 * strings). Retorna [{ line, text }] — `text` é a linha ORIGINAL (p/ relatório).
 */
export function findStyleRenderLines(content) {
  const blanked = blankCommentsAndStrings(content)
  const blankedLines = blanked.split("\n")
  const originalLines = content.split("\n")
  const hits = []
  for (let i = 0; i < blankedLines.length; i++) {
    if (STYLE_OPEN_RE.test(blankedLines[i])) {
      hits.push({ line: i + 1, text: originalLines[i].trim().slice(0, 120) })
    }
  }
  return hits
}

/** Arquivo de teste (não roda no app — CSP não se aplica ao runtime de teste). */
export function isTestFile(relPath) {
  return relPath.includes("/__tests__/") || /\.(test|spec)\.tsx$/.test(relPath)
}

/** Na allowlist? (path relativo exato ao root do repo) */
export function isAllowlisted(relPath) {
  return ALLOWLIST.some((a) => a.path === relPath)
}

/**
 * Violações de <style> inline num arquivo. `rel` é o path relativo ao root
 * (ex.: "src/app/global-error.tsx"). Retorna [] p/ teste e allowlist.
 */
export function checkInlineStyles(rel, content) {
  if (isTestFile(rel) || isAllowlisted(rel)) return []
  return findStyleRenderLines(content).map((h) => ({
    line: h.line,
    text: h.text,
  }))
}

// ── Prova do hash: global-error ⇄ csp.ts ───────────────────────────────────

/** Extrai o template literal `styles` do global-error (null se não achar). */
export function extractGlobalErrorStyles(content) {
  const m = content.match(/const\s+styles\s*=\s*`([\s\S]*?)`/)
  return m ? m[1] : null
}

/** Extrai o hash sha256 pinado na diretiva style-src-elem (null se não achar). */
export function extractCspStyleHash(content) {
  // [^`\n]* cobre os tokens intermediários da diretiva ('self', nonces etc.)
  // sem atravessar a linha do template literal que a declara.
  const m = content.match(/style-src-elem[^`\n]*'sha256-([A-Za-z0-9+/=]+)'/)
  return m ? m[1] : null
}

/** sha256 base64 do conteúdo — o formato que a CSP espera. */
export function sha256Base64(content) {
  return createHash("sha256").update(content).digest("base64")
}

/**
 * Confere que o hash pinado na CSP é o do `styles` ATUAL do global-error.
 * Arquivo ausente → skip (fixtures de CLI sem o par). Falha de extração ou
 * hash divergente → violação (fail-closed: refatorar o styles SEM atualizar
 * o hash é exatamente o bug silencioso que este guard existe para pegar).
 */
export function checkGlobalErrorHashPin(globalErrorContent, cspContent) {
  if (globalErrorContent === null || cspContent === null) return []
  const violations = []

  const styles = extractGlobalErrorStyles(globalErrorContent)
  if (styles === null) {
    violations.push({
      kind: "hash-pin",
      message:
        "não consegui extrair `const styles = \\`...\\`` de src/app/global-error.tsx — o guard pina o hash desse template literal; ajuste o extrator (ou o global-error não declara mais o estilo inline?).",
    })
    return violations
  }

  const pinned = extractCspStyleHash(cspContent)
  if (pinned === null) {
    violations.push({
      kind: "hash-pin",
      message:
        "não encontrei 'sha256-...' em style-src-elem em src/lib/csp.ts — o pin do global-error sumiu da CSP?",
    })
    return violations
  }

  const actual = sha256Base64(styles)
  if (actual !== pinned) {
    violations.push({
      kind: "hash-pin",
      message: `hash dessincronizado: CSP pina 'sha256-${pinned}', mas o styles atual do global-error é 'sha256-${actual}'. Ou você editou o estilo (recalcule o hash), ou editou a CSP (justifique em PR).`,
    })
  }
  return violations
}

// ── Varredura ───────────────────────────────────────────────────────────────

/**
 * Caminha recursivamente `dir` atrás de *.tsx (pulando node_modules, .next,
 * dotdirs) e retorna os arquivos com violações:
 *   [{ file, violations: [{ line, text }] }]
 * (arquivos de teste e allowlist já são filtrados por checkInlineStyles)
 */
export function scanTsxDir(dir) {
  const results = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (entry === "node_modules" || entry === ".next" || entry.startsWith(".")) continue

    const st = statSync(full)
    if (st.isDirectory()) {
      results.push(...scanTsxDir(full))
    } else if (entry.endsWith(".tsx")) {
      const rel = relative(process.cwd(), full).split("\\").join("/")
      const content = readFileSync(full, "utf8")
      const violations = checkInlineStyles(rel, content)
      if (violations.length > 0) {
        results.push({ file: rel, violations })
      }
    }
  }
  return results
}

// ── CLI ────────────────────────────────────────────────────────────────────

function main() {
  const root = join(process.cwd(), "src")
  const results = scanTsxDir(root)

  // Prova do hash — só faz sentido com o par real no repo.
  const gePath = join(process.cwd(), "src", "app", "global-error.tsx")
  const cspPath = join(process.cwd(), "src", "lib", "csp.ts")
  if (existsSync(gePath) && existsSync(cspPath)) {
    const pinViolations = checkGlobalErrorHashPin(
      readFileSync(gePath, "utf8"),
      readFileSync(cspPath, "utf8"),
    )
    if (pinViolations.length > 0)
      results.push({ file: "src/app/global-error.tsx + src/lib/csp.ts", violations: pinViolations })
  }

  if (results.length > 0) {
    console.error("❌ <STYLE> INLINE FORA DA ALLOWLIST / HASH DA CSP DESSINCRONIZADO:")
    for (const r of results) {
      console.error(`\n  📄 ${r.file}`)
      for (const v of r.violations) {
        if (v.kind === "hash-pin") {
          console.error(`     ${v.message}`)
        } else {
          console.error(
            `     linha ${v.line}: <style> inline (CSP sem 'unsafe-inline' em style-src-elem)`,
          )
          console.error(`       ${v.text}`)
        }
      }
    }
    console.error("\n  Como corrigir:")
    console.error("    - Mova o CSS para globals.css (padrão do repo: ticker, skeletons, 404).")
    console.error("    - Estilo dinâmico: use style={{...}} (style-src-attr permite atributo).")
    console.error(
      "    - Caso legitimamente excepcional: adicione à ALLOWLIST com motivo (topo do guard).",
    )
    console.error(
      "    - Hash: se editou o styles do global-error, recalcule o sha256-base64 e atualize src/lib/csp.ts.",
    )
    process.exit(1)
  }

  console.log(
    "✅ Nenhum <style> inline fora da allowlist; hash da CSP sincronizado com o global-error.",
  )
  process.exit(0)
}

const IS_DIRECT_RUN =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (IS_DIRECT_RUN) main()
