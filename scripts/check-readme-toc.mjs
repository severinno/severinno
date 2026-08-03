#!/usr/bin/env node

// =============================================================================
// check-readme-toc.mjs
//
// CI guard (fast gate, <1s, node-puro) que valida os TOCs (índices de seção)
// do README nas TRÊS direções:
//
//   → (forward)  todo link `- [label](#slug)` de um bloco de TOC DEVE resolver
//                para um heading real — mesmo algoritmo github-slugger do
//                check-readme-anchors.mjs (reutilizado por import, sem drift);
//   ← (reverse)  em toda SEÇÃO que declara um TOC, TODOS os headings filhos
//                diretos (nível pai+1) DEVEM estar listados no índice — um
//                heading novo adicionado à seção sem o bullet correspondente
//                no TOC falha o PR (índice incompleto). Níveis mais profundos
//                (pai+2+) são EXENTOS: o índice cobre só os sub-blocos diretos
//                (ex.: o mini-índice de 8 sub-blocos da seção '## Encoding
//                Guards' lista os `###`, mas não os `####` aninhados).
//   ≡ (label)    o LABEL de cada bullet do TOC deve corresponder
//                SEMANTICAMENTE ao heading para onde aponta — mesma regra do
//                guard de âncoras (checkLinkLabelSemantics, reutilizada por
//                import — regra ÚNICA nos dois guards, sem drift):
//                `- [CRLF Guard](#normalizador)` resolve (forward ok) mas o
//                label casa com OUTRO heading → violação com sugestão do
//                heading certo. Pega renomeações que MANTÊM o slug mas trocam
//                o texto (ex.: heading 'CRLF Guard' → 'CRLF-Guard' — slug
//                'crlf-guard' nos dois) e labels apontando para o heading
//                errado. Label de prosa (não casa com nenhum heading) é
//                exento — mesmo contrato do guard de âncoras.
//
// Definição de bloco de TOC: run de >= MIN_TOC_ENTRIES linhas CONSECUTIVAS de
// bullet link puro `- [label](#slug)` (fence-aware — linhas dentro de ```
// não contam). Um bullet isolado em prosa NÃO forma bloco (evita falso
// positivo na direção reverse: exigir completude de índice onde não há TOC).
//
// O pai do TOC é o heading mais próximo ACIMA do bloco com nível MENOR que o
// nível-alvo — e o nível-alvo é DERIVADO das entradas resolvidas do próprio
// TOC (o nível dos headings para onde os slugs apontam), NÃO do pai nominal.
// Isso torna o guard robusto a conversões parágrafo→heading ANTES do índice:
// um `###` novo inserido entre a seção e os bullets não vira "pai" do TOC — o
// pai continua sendo a `##` dona, e o heading novo é flagrado como fora do
// índice (o bug que o nearest-heading-ingênuo deixava passar). O escopo da
// seção vai do pai até o próximo heading de nível <= pai.level (exclusivo).
// Se o bloco não tiver pai (topo do arquivo), só a direção forward aplica.
//
// Usage:
//   node scripts/check-readme-toc.mjs            # escaneia README.md
//   node scripts/check-readme-toc.mjs docs/x.md  # escaneia outro(s)
//
// Exit codes:
//   0 — TOCs consistentes (links resolvem + filhos diretos listados)
//   1 — pelo menos um link de TOC quebrado OU heading fora do índice
// =============================================================================

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
// Reuso do slugger (github-slugger) e da extração de headings do guard de
// âncoras — o contrato dos dois guards NUNCA diverge (mesma fonte).
import { extractHeadings, levenshtein, checkLinkLabelSemantics } from "./check-readme-anchors.mjs"

/** Linha de bullet link puro: `- [label](#slug)` (slug sem espaço/`)`). */
const TOC_ENTRY_RE = /^\s*-\s+\[([^\]]*)\]\(#([^)\s]+)\)/

/** Mínimo de entradas consecutivas para considerar um bloco como TOC. */
const MIN_TOC_ENTRIES = 2

/**
 * Extrai blocos de TOC do conteúdo: runs de >= MIN_TOC_ENTRIES linhas
 * consecutivas de bullet link puro (fence-aware). Um bullet isolado em prosa
 * NÃO forma bloco.
 *
 * @param {string} content
 * @returns {{ line: number, entries: { line: number, slug: string, label: string }[] }[]}
 */
export function extractTocBlocks(content) {
  const blocks = []
  let inFence = false
  const lines = content.split(/\r?\n/)
  let current = null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()
    if (trimmed.startsWith("```")) {
      inFence = !inFence
      current = null // fence quebra um run em andamento
      continue
    }
    if (inFence) continue
    const m = line.match(TOC_ENTRY_RE)
    if (m) {
      if (!current) current = { line: i + 1, entries: [] }
      current.entries.push({ line: i + 1, slug: m[2], label: m[1].trim() })
    } else {
      if (current && current.entries.length >= MIN_TOC_ENTRIES) blocks.push(current)
      current = null
    }
  }
  if (current && current.entries.length >= MIN_TOC_ENTRIES) blocks.push(current)
  return blocks
}

/**
 * Heading mais próximo ACIMA da linha dada (nenhum → null). Os headings vêm
 * ordenados por linha (extractHeadings itera o conteúdo em ordem).
 *
 * @param {{ line: number, level: number, slug: string, text: string }[]} headings
 * @param {number} line
 * @returns {object | null}
 */
export function nearestHeadingAbove(headings, line) {
  let nearest = null
  for (const h of headings) {
    if (h.line >= line) break
    nearest = h
  }
  return nearest
}

/**
 * Heading mais próximo ACIMA da linha dada com nível ESTRITAMENTE menor que
 * maxLevel (nenhum → null). Usado como PAI do TOC: o índice de uma seção `##`
 * pertence à seção, não a um `###` novo que um parágrafo vire ANTES dos
 * bullets (robustez a conversões parágrafo→heading).
 *
 * @param {{ line: number, level: number, slug: string, text: string }[]} headings
 * @param {number} line
 * @param {number} maxLevel  nível exclusivo (parent.level < maxLevel)
 * @returns {object | null}
 */
export function nearestHeadingAboveBelow(headings, line, maxLevel) {
  let nearest = null
  for (const h of headings) {
    if (h.line >= line) break
    if (h.level < maxLevel) nearest = h
  }
  return nearest
}

/**
 * Nível-alvo que o TOC indexa: o MENOR nível entre os headings resolvidos
 * pelas entradas do bloco (os slugs apontam para eles). null quando NENHUMA
 * entrada resolve (ex.: todos os links quebrados) — nesse caso a direção
 * reverse não tem como derivar o nível e o forward já acusa os links.
 *
 * @param {{ entries: { slug: string }[] }} block
 * @param {{ slug: string, level: number }[]} headings
 * @returns {number | null}
 */
export function resolveIndexedLevel(block, headings) {
  // Assume TOC de nível ÚNICO (o padrão do repo: o mini-índice lista só os
  // `###` filhos diretos). MIN entre as entradas resolvidas = o nível dos
  // filhos diretos — mesmo se uma entrada extra apontar para um heading de
  // nível mais profundo (ex.: link cruzado para um `####`), o min ainda é o
  // nível da seção dona. (Um link para um nível MAIS RASO deslocaria o min,
  // mas isso não ocorre em TOC de seção bem-formado.)
  //
  // TOC MULTI-NÍVEL (contrato travado em teste): um índice MISTO (### + ####)
  // NÃO muda a heurística — o min (nível mais raso) é o nível-alvo do reverse
  // e os `####` do índice são tratados como links cruzados (forward apenas),
  // NÃO como nível indexado: a completude dos filhos diretos (`###`) continua
  // exigida mesmo com entradas profundas no TOC, e um `####` fora do índice
  // permanece exento. Um TOC SÓ de `####` (deep-only) tem min = 4 e exigiria
  // a completude dos `####` — comportamento documentado, não suportado como
  // padrão do repo.
  const slugToLevel = new Map(headings.map((h) => [h.slug, h.level]))
  let min = null
  for (const e of block.entries) {
    const level = slugToLevel.get(e.slug)
    if (level === undefined) continue
    if (min === null || level < min) min = level
  }
  return min
}

/**
 * Valida os blocos de TOC nas TRÊS direções:
 *
 *   forward  — toda entrada do TOC resolve para um heading real (slug com
 *              sufixo -1/-2 de duplicados incluso);
 *   label    — o LABEL de cada bullet corresponde semanticamente ao heading
 *              resolvido (mesma regra do checkLinkLabelSemantics das âncoras);
 *   reverse  — em toda seção com TOC, todos os headings de nível pai+1 no
 *              escopo da seção (do pai até o próximo heading <= pai.level)
 *              estão listados no índice. Níveis mais profundos são exentos.
 *
 * @param {string} content
 * @returns {object[]} violações (vazio = consistente)
 */
export function checkToc(content) {
  const headings = extractHeadings(content)
  const slugSet = new Set(headings.map((h) => h.slug))
  const blocks = extractTocBlocks(content)
  const violations = []

  for (const block of blocks) {
    const tocSlugs = new Set(block.entries.map((e) => e.slug))

    // forward: links do TOC precisam resolver
    for (const entry of block.entries) {
      if (slugSet.has(entry.slug)) continue
      let best = null
      let bestDist = Infinity
      for (const h of headings) {
        const d = levenshtein(entry.slug, h.slug)
        if (d < bestDist) {
          bestDist = d
          best = h
        }
      }
      violations.push({
        type: "forward",
        line: entry.line,
        slug: entry.slug,
        label: entry.label,
        closest: best ? best.slug : undefined,
        distance: best ? bestDist : undefined,
      })
    }

    // label: o LABEL de cada bullet deve corresponder ao heading resolvido —
    // pega renomeações que mantêm o slug mas trocam o texto (o slug casa, mas
    // o label ficou apontando para o heading errado). REUSO REAL da regra do
    // guard de âncoras (checkLinkLabelSemantics — mesmo contrato, sem drift):
    // a heurística (subset→OK / prosa→exento / outro heading→violação) vive
    // em UM lugar para os dois guards.
    for (const v of checkLinkLabelSemantics(headings, block.entries)) {
      violations.push({ type: "label", ...v })
    }

    // reverse: heading filho direto (nível-alvo) fora do índice
    //
    // O nível-alvo vem das entradas RESOLVIDAS do TOC, e o pai é o heading
    // acima com nível menor que ele — nunca o heading nominal mais próximo
    // (um `###` que um parágrafo vire antes dos bullets não rouba o pai da
    // seção dona). Se nenhuma entrada resolve, cai no fallback nominal.
    const indexedLevel = resolveIndexedLevel(block, headings)
    const parent =
      indexedLevel === null
        ? nearestHeadingAbove(headings, block.line)
        : nearestHeadingAboveBelow(headings, block.line, indexedLevel)
    if (!parent) continue // TOC no topo do arquivo — sem seção para cobrir
    const requiredLevel = indexedLevel ?? parent.level + 1
    const sectionEnd = headings.find((h) => h.line > parent.line && h.level <= parent.level)
    const endLine = sectionEnd ? sectionEnd.line : Number.POSITIVE_INFINITY
    for (const h of headings) {
      if (h.line <= parent.line || h.line >= endLine) continue
      if (h.level !== requiredLevel) continue
      if (tocSlugs.has(h.slug)) continue
      violations.push({
        type: "reverse",
        line: h.line,
        slug: h.slug,
        label: h.text,
        section: parent.text,
        level: h.level,
      })
    }
  }
  return violations
}

/** Nome padrão do arquivo escaneado quando nenhum caminho é passado. */
export const DEFAULT_PATH = "README.md"

function main() {
  const targets = process.argv.slice(2).length > 0 ? process.argv.slice(2) : [DEFAULT_PATH]
  const allViolations = []
  let blockCount = 0
  let headingCount = 0

  for (const target of targets) {
    const path = join(process.cwd(), target)
    let content
    try {
      content = readFileSync(path, "utf8")
    } catch (e) {
      console.error(`❌ Não foi possível ler ${target}: ${e.message}`)
      process.exit(1)
    }
    const violations = checkToc(content)
    for (const v of violations) allViolations.push({ file: target, ...v })
    if (blockCount === 0) blockCount = extractTocBlocks(content).length
    if (headingCount === 0) headingCount = extractHeadings(content).length
  }

  if (allViolations.length > 0) {
    console.error(`❌ TOC(s) do README inconsistentes (${allViolations.length}):\n`)
    for (const v of allViolations) {
      if (v.type === "forward") {
        const close = v.closest
          ? `\n     → heading mais próximo: '#${v.closest}' (distância ${v.distance})`
          : "\n     → nenhum heading encontrado — link órfão?"
        console.error(`   - ${v.file}:${v.line} [link de TOC] [${v.label}]: '#${v.slug}'${close}\n`)
      } else if (v.type === "label") {
        console.error(
          `   - ${v.file}:${v.line} [label do TOC] [${v.label}]: '#${v.slug}'` +
            ` (heading: '${v.heading}') — o label corresponde a outro heading` +
            ` (sugestão: '#${v.suggestion}'); aponta para o heading errado?\n`,
        )
      } else {
        console.error(
          `   - ${v.file}:${v.line} [heading fora do índice] '${v.label}' (nível ${v.level})` +
            ` na seção '${v.section}' sem bullet no TOC — adicione '- [${v.label}](#${v.slug})'\n`,
        )
      }
    }
    console.error(
      `   Ação: (forward) renomeou um heading? Atualize o link do TOC no mesmo PR.` +
        `\n   (reverse) adicionou um heading novo à seção? Adicione o bullet no índice da seção.` +
        `\n   (label) o label do bullet não corresponde ao heading resolvido — corrija o slug ou o label.`,
    )
    process.exit(1)
  }

  console.log(
    `✅ TOCs do README consistentes (${targets.join(", ")}; ${blockCount} TOC(s), ${headingCount} headings, forward + reverse + label ok).`,
  )
  process.exit(0)
}

// True apenas quando executado diretamente (node ...) — permite importar as
// funções puras em testes unitários sem disparar o scan.
const IS_DIRECT_RUN =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (IS_DIRECT_RUN) main()
