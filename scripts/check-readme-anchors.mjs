#!/usr/bin/env node

// =============================================================================
// check-readme-anchors.mjs
//
// CI guard (fast gate, <1s, node-puro) que valida os links INTERNOS do README
// e de docs/*.md: cada `[texto](#slug)` DEVE resolver para um heading real,
// com o slug gerado pelo MESMO algoritmo que o GitHub usa para ancorar
// headings (o pacote github-slugger) — falhando o PR se um heading for
// renomeado sem atualizar os links (docs stale, link quebrado).
//
// Usage:
//   SEM target (default): escaneia README.md + TODOS os docs/*.md
//   (auto-descoberta via docs/, ignorando não-.md e subdiretórios; docs/
//   AUSENTE é skip silencioso — fixtures de mutation/CLI em temp dirs só têm
//   README.md e não podem quebrar por isso):
//   node scripts/check-readme-anchors.mjs            # forward (padrão)
//   node scripts/check-readme-anchors.mjs --reverse  # forward + reverse
//   node scripts/check-readme-anchors.mjs --reverse-strict  # + strict
//   node scripts/check-readme-anchors.mjs --reverse-strict --min-label-len 3
//   node scripts/check-readme-anchors.mjs --reverse-strict \
//       --prose-allowlist abaixo,acima,seguir,aqui,fluxo  # exime prosa
//   node scripts/check-readme-anchors.mjs --reverse-strict \
//       --min-suggestion-sim 0.3  # limiar da sugestão do heading (default 0.4)
//   node scripts/check-readme-anchors.mjs --reverse --json  # report JSON
//   COM target (SÓ os alvos são escaneados):
//   node scripts/check-readme-anchors.mjs --reverse docs/x.md
//
// Exit codes:
//   0 — todos os links internos resolvem (e, com --reverse, apontam para o
//       heading semanticamente certo). Com --json, SEMPRE 0 (report mode —
//       o caller, ex.: check-readme-reverse-baseline.mjs, decide o gate)
//   1 — pelo menos um link quebrado OU (com --reverse) label apontando para
//       o heading errado OU (com --reverse-strict) label de UM token
//       não-stopword inexistente em qualquer heading apontando para heading
//       sem esse token (sem --json)
//
// Algoritmo github-slugger (verificado contra as âncoras reais do README —
// ex.: `#por-que-o-guard-de-crlf-é-sh-only-decisão-escopo-intencional` e
// `#evidência-empírica-log-real-do-act--bug-do-setup-bun`):
//   1. lowercase (toLowerCase);
//   2. remove a classe de pontuação
//      [\u2000-\u206F\u2E00-\u2E7F\\'!"#$%&()*+,./:;<=>?@[\]^`{|}~]
//      — inclui em dash (U+2014) e aspas/parênteses/pontos/barras, mas NÃO
//      acentos (é/ó ficam) NEM hífens (‑ preservado);
//   3. espaços → hífens. NÃO colapsa hífens consecutivos (dois espaços → `--`)
//      e NÃO trima hífens das pontas.
//
// Cuidados de extração (falsos positivos evitados):
//   - FENCES (```): linhas `# ...` DENTRO de blocos de código (ex.: comentários
//     bash `# 1. Install dependencies` no Quick Start) NÃO são headings; links
//     dentro de fences também não contam;
//   - spans de código inline (\`...\`) são ignorados na extração de links;
//   - links CROSS-DOC (`[x](docs/API.md#anchor)`) SÃO validados: o arquivo
//     alvo deve existir (relativo ao diretório do arquivo atual) e a âncora
//     deve resolver para um heading real dele (mesmo algoritmo de slug);
//   - URLs externas são ignoradas — só `#slug` puro e `caminho.md#anchor`;
//   - imagens `![alt](#...)` são ignoradas (caractere anterior ao `[` é `!`);
//   - links REFERENCE-STYLE (`[ref]: #slug`) NÃO são validados — o README não
//     usa este formato hoje, mas um futuro ref-style bypassaria o guard;
//   - headings DUPLICADOS ganham sufixo -1, -2 (comportamento do GitHub): o
//     primeiro `## X` gera `x`, o segundo gera `x-1`, etc. — ambos válidos.
//
// Validação REVERSA (--reverse, opcional): além de resolver, confere a
// SEMÂNTICA do label — `[X](#slug)` deve apontar para um heading cujo texto
// corresponda a X. Detecta `[CRLF Guard](#normalizador)` (link aponta para o
// heading errado, mas resolve). Regra validada contra o README real (13
// links, 0 falsos positivos): label presente no heading → OK; label de prosa
// (ex.: "abaixo") que não casa com NENHUM heading → exento; label que casa
// com OUTRO heading → violação com sugestão do heading mais RELEVANTE
// (Jaccard de tokens — Levenshtein só como desempate).
// =============================================================================

import { readFileSync, readdirSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

/**
 * Classe de pontuação removida pelo github-slugger (mesma do pacote real) —
 * inclui o em dash (U+2014, dentro de \u2000-\u206F) mas NÃO acentos nem
 * hífens comuns. Mantida como exportada para os testes validarem o contrato.
 */
export const SLUGGER_PUNCT_RE = /[\u2000-\u206F\u2E00-\u2E7F\\'!"#$%&()*+,./:;<=>?@[\]^`{|}~]/g

/**
 * Aplica o algoritmo github-slugger a um texto de heading: lowercase, remove
 * a pontuação da classe e troca espaços por hífens (sem colapsar, sem trim).
 *
 * @param {string} text
 * @returns {string}
 */
export function slugify(text) {
  return text.toLowerCase().replace(SLUGGER_PUNCT_RE, "").replace(/ /g, "-")
}

/** Regex de heading ATX: 1-6 `#` + espaço + texto (não pode estar em fence). */
const HEADING_RE = /^#{1,6}\s+(.+?)\s*$/

/** Regex de link inline markdown: `[label](#slug)` — slug sem espaço/`)`. */
const LINK_RE = /\[([^\]]*)\]\(#([^)\s]+)\)/g

/**
 * Regex de link CROSS-DOC inline: `[label](caminho/arquivo.md#anchor)` —
 * alvo terminando em `.md` seguido de `#anchor`. O `[^)#\s]+` captura o
 * caminho relativo (com `/`, `.` e `-`), e o `[^)\s]+` a âncora.
 *
 * ÂNCORA com `#` interno (ex.: `sub/dir.md#x#y`) captura `x#y` inteiro e
 * FALHA por design: o slugger REMOVE `#` (classe de pontuação), então
 * nenhum heading real contém `#` — um link com `#` na âncora é inválido.
 */
const CROSS_DOC_LINK_RE = /\[([^\]]*)\]\(([^)#\s]+\.md)#([^)\s]+)\)/g

/**
 * Extrai os headings do conteúdo, ignorando linhas dentro de fences (```).
 * Headings DUPLICADOS (mesmo slug) ganham sufixo -1, -2 — como o GitHub faz.
 *
 * @param {string} content
 * @returns {{ line: number, level: number, slug: string, text: string }[]}
 */
export function extractHeadings(content) {
  const headings = []
  const seen = new Map() // slug → quantidade de ocorrências já emitidas
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
    const m = line.match(HEADING_RE)
    if (!m) continue
    const text = m[1].trim()
    const baseSlug = slugify(text)
    const count = seen.get(baseSlug) ?? 0
    seen.set(baseSlug, count + 1)
    const slug = count === 0 ? baseSlug : `${baseSlug}-${count}`
    headings.push({ line: i + 1, level: m[0].match(/^#+/)[0].length, slug, text })
  }
  return headings
}

/**
 * Extrai os links internos puros (`#slug`) do conteúdo, ignorando fences,
 * spans de código inline, imagens e links para outros arquivos/URLs.
 *
 * @param {string} content
 * @returns {{ line: number, slug: string, label: string }[]}
 */
export function extractInternalLinks(content) {
  const links = []
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
    // remove spans de código inline (\`...\`) — links dentro deles não contam
    const noInlineCode = line.replace(/`[^`]*`/g, "")
    LINK_RE.lastIndex = 0
    let m
    while ((m = LINK_RE.exec(noInlineCode)) !== null) {
      // imagem `![alt](#...)`: o `!` fica FORA do `[...]` (caractere anterior)
      if (m.index > 0 && noInlineCode[m.index - 1] === "!") continue
      links.push({ line: i + 1, slug: m[2], label: m[1].trim() })
    }
  }
  return links
}

/**
 * Extrai os links CROSS-DOC (`[label](caminho/arquivo.md#anchor)`) do
 * conteúdo — o gap de referências entre arquivos (ex.: `docs/API.md#anchor`
 * citado pelo README). Mesmas regras de extração do extractInternalLinks
 * (fences, spans de código inline e imagens ignorados) mais o filtro de URL:
 * alvos externos (`https://...`, `//...`) NÃO são arquivos locais do repo e
 * ficam fora — só caminhos RELATIVOS terminando em `.md` com âncora entram.
 *
 * @param {string} content
 * @returns {{ line: number, target: string, anchor: string, label: string }[]}
 */
export function extractCrossDocLinks(content) {
  const links = []
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
    const noInlineCode = line.replace(/`[^`]*`/g, "")
    CROSS_DOC_LINK_RE.lastIndex = 0
    let m
    while ((m = CROSS_DOC_LINK_RE.exec(noInlineCode)) !== null) {
      // imagem `![alt](...)`: o `!` fica FORA do `[...]` (caractere anterior)
      if (m.index > 0 && noInlineCode[m.index - 1] === "!") continue
      // URL externa (http/https/protocolo:// ou //) — não é arquivo local
      if (/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(m[2])) continue
      links.push({ line: i + 1, target: m[2], anchor: m[3], label: m[1].trim() })
    }
  }
  return links
}

/**
 * Valida os links CROSS-DOC contra o arquivo alvo: resolve a âncora contra
 * os headings do arquivo destino (mesmo algoritmo de slug) e falha se o
 * ARQUIVO não existir ou a âncora não existir nele. `readTarget` recebe o
 * caminho relativo (ex.: `docs/API.md`, `../README.md`) e devolve o conteúdo
 * do arquivo ou `null` (arquivo ausente).
 *
 * DEDUP por alvo: o mesmo arquivo pode ser linkado várias vezes no conteúdo
 * (ex.: `[a](docs/x.md#x) [b](docs/x.md#y)`); readTarget é chamado UMA vez
 * por alvo (Map interno) — o cache do main() é complementar (atravessa
 * arquivos diferentes linkando o mesmo alvo).
 *
 * @param {string} content  conteúdo do arquivo ONDE os links aparecem
 * @param {(target: string) => string | null} readTarget  resolver do alvo
 * @returns {{ line: number, target: string, anchor: string, label: string, reason: "file-missing" | "anchor-missing", closest?: string, distance?: number }[]}
 */
export function checkCrossDocLinks(content, readTarget) {
  const links = extractCrossDocLinks(content)
  const violations = []
  const targetCache = new Map()
  for (const link of links) {
    let targetContent = targetCache.get(link.target)
    if (targetContent === undefined) {
      targetContent = readTarget(link.target)
      targetCache.set(link.target, targetContent)
    }
    if (targetContent === null) {
      violations.push({ ...link, reason: "file-missing" })
      continue
    }
    const headings = extractHeadings(targetContent)
    const slugs = new Set(headings.map((h) => h.slug))
    if (!slugs.has(link.anchor)) {
      // sugere o heading mais próximo (mesmo contrato do checkAnchors)
      let best = null
      let bestDist = Infinity
      for (const h of headings) {
        const d = levenshtein(link.anchor, h.slug)
        if (d < bestDist) {
          bestDist = d
          best = h
        }
      }
      violations.push({
        ...link,
        reason: "anchor-missing",
        closest: best ? best.slug : undefined,
        distance: best ? bestDist : undefined,
      })
    }
  }
  return violations
}

/**
 * Distância de Levenshtein (para sugerir o heading mais próximo quando um
 * link quebra — ajuda a achar o heading renomeado).
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function levenshtein(a, b) {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 0; j <= b.length; j++) dp[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    }
  }
  return dp[a.length][b.length]
}

/**
 * Similaridade de TOKENS (0..1) para a sugestão do strict:
 * 1 − Levenshtein normalizado pela maior string (1 − dist/maxLen). 1 =
 * idênticos, 0 = completamente diferentes. Usada para sugerir o heading
 * mais provável quando o label single-token NÃO existe em nenhum heading
 * (ex.: heading 'Guard' renomeado para 'Gate' →
 * tokenSimilarity('guard','gate') = 1 − 3/5 = 0.4). Ao contrário do jaccard
 * (similaridade de PRESENÇA entre conjuntos de tokens — inútil quando o
 * token do label não está em nenhum heading: seria 0 para todos), esta é a
 * métrica de PARECENÇA entre o token do label e cada token de cada heading.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number} 0..1
 */
export function tokenSimilarity(a, b) {
  const maxLen = Math.max(a.length, b.length)
  if (maxLen === 0) return 1 // ambos vazios = idênticos
  return 1 - levenshtein(a, b) / maxLen
}

/**
 * Valida os links internos contra os slugs gerados dos headings: todo link
 * `#slug` DEVE existir na lista de slugs (incluindo sufixos -1/-2 de
 * duplicados). Retorna violações com linha, link e sugestão do heading mais
 * próximo (para apontar o heading renomeado).
 *
 * @param {string} content
 * @returns {{ line: number, slug: string, label: string, closest?: string, distance?: number }[]}
 */
export function checkAnchors(content) {
  const headings = extractHeadings(content)
  const links = extractInternalLinks(content)
  const slugs = new Set(headings.map((h) => h.slug))
  const violations = []
  for (const link of links) {
    if (slugs.has(link.slug)) continue
    // sugere o heading mais próximo (ajuda a achar a renomeação)
    let best = null
    let bestDist = Infinity
    for (const h of headings) {
      const d = levenshtein(link.slug, h.slug)
      if (d < bestDist) {
        bestDist = d
        best = h
      }
    }
    violations.push({
      line: link.line,
      slug: link.slug,
      label: link.label,
      closest: best ? best.slug : undefined,
      distance: best ? bestDist : undefined,
    })
  }
  return violations
}

/**
 * Stopwords PT/EN removidas na normalização semântica do reverse check —
 * labels de prosa ("abaixo", "fluxo de medição") não devem ser sinalizados,
 * e palavras de função não devem participar da comparação de conjuntos.
 */
export const STOPWORDS = new Set([
  // PT
  "a",
  "o",
  "e",
  "é",
  "de",
  "do",
  "da",
  "dos",
  "das",
  "em",
  "no",
  "na",
  "nos",
  "nas",
  "para",
  "por",
  "com",
  "sem",
  "que",
  "se",
  "um",
  "uma",
  "uns",
  "umas",
  "os",
  "as",
  "ao",
  "aos",
  "à",
  "às",
  "mais",
  "mas",
  "como",
  "não",
  "sobre",
  "entre",
  "até",
  "após",
  "desde",
  "ser",
  "são",
  "foi",
  // EN
  "the",
  "of",
  "to",
  "and",
  "or",
  "in",
  "for",
  "on",
  "with",
  "at",
  "by",
  "from",
  "is",
  "are",
  "was",
  "were",
  "be",
  "it",
  "this",
  "that",
  "an",
])

/**
 * Tokeniza um texto para a comparação semântica do reverse check: lowercase,
 * caracteres não-[a-zà-ú0-9] viram espaço (mantém acentos PT), remove
 * stopwords. Preserva ordem/duplicatas simples; a comparação usa Set depois.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-zà-ú0-9]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .filter((t) => !STOPWORDS.has(t))
}

/**
 * Similaridade de Jaccard entre dois conjuntos de tokens: |A ∩ B| / |A ∪ B|.
 * 1 = conjuntos idênticos, 0 = disjuntos, 0.5 = metade em comum. Aceita
 * arrays (tokenize) ou Sets (os token-sets pré-computados dos headings).
 * ORDEM-INSENSÍVEL — a vantagem sobre o Levenshtein de texto quando os
 * tokens são os mesmos mas a ordem difere (ex.: heading 'Guard de CRLF' vs
 * label 'CRLF Guard' → Jaccard 1.0, mas Levenshtein alto por reordenação).
 *
 * @param {string[] | Set<string>} a
 * @param {string[] | Set<string>} b
 * @returns {number} 0..1
 */
export function jaccard(a, b) {
  const setA = a instanceof Set ? a : new Set(a)
  const setB = b instanceof Set ? b : new Set(b)
  if (setA.size === 0 && setB.size === 0) return 1 // ambos vazios = idênticos
  // Pós early-return, pelo menos um conjunto é não-vazio → union ≥ 1 sempre
  // (sem ramo inalcançável de divisão por zero).
  const inter = [...setA].filter((t) => setB.has(t)).length
  return inter / (setA.size + setB.size - inter)
}

/**
 * Regra SEMÂNTICA de label (compartilhada): valida que o LABEL de cada link
 * `[X]` corresponde semanticamente ao heading para onde aponta — o núcleo do
 * checkAnchorSemantics (guard de âncoras) E da direção `label` do TOC guard
 * (check-readme-toc.mjs). Reuso REAL da regra, não só dos utilitários: uma
 * mudança na heurística aqui vale para os DOIS guards sem drift.
 *
 * Regra (validada contra os 13 links reais do README, 0 falsos positivos):
 *   1. tokenize label + heading (stopwords removidas);
 *   2. se TODOS os tokens do label estão no heading resolvido → OK;
 *   3. se NENHUM heading do doc contém TODOS os tokens do label → o label é
 *      prosa (ex.: "abaixo", "fluxo de medição") → exento (não sinaliza);
 *   4. senão → o label corresponde a OUTRO heading → violação, com sugestão
 *      do heading mais RELEVANTE: Jaccard dos token-sets primário (ex.:
 *      'Guard de CRLF' e 'CRLF Guard' empatam em 1.0 — ordem não importa),
 *      Levenshtein de texto como desempate quando o Jaccard é igual.
 *
 * Heurística documentada: labels que reduzem a UM token não-stopword (ex.:
 * "Guard") e existem em algum heading serão sinalizados ao apontarem para
 * qualquer outro lugar — um label genérico apontando para o heading errado
 * PROVAVELMENTE está errado, então flaggar é o comportamento intencional.
 *
 * Modo STRICT (opts.strict — CLI --reverse-strict): fecha a brecha da
 * heurística single-token. Um label de UM token não-stopword SIGNIFICATIVO
 * (len >= opts.minSingleTokenLen, default 3) apontando para um heading SEM
 * esse token vira violação MESMO quando nenhum outro heading contém o token
 * (no modo normal isso cai na regra 3 'prosa → exento' e escapa). Tokens
 * curtos (ex.: 'OK', 'CI', 'X' — len < threshold) são tratados como
 * genéricos legítimos e permitidos.
 *
 * SUGESTÃO do strict (opts.minSuggestionSim — CLI --min-suggestion-sim,
 * default 0.4): quando o label single-token NÃO existe em NENHUM heading, o
 * guard sugere o heading mais provável por similaridade de TOKENS do label
 * contra TODOS os tokens de TODOS os headings (tokenSimilarity — Levenshtein
 * normalizado 0..1, ex.: 'guard' → 'gate' = 0.4). A melhor similaridade
 * acima do limiar vira suggestion (slug do heading); abaixo, suggestion é
 * null — o render emite 'nenhum heading corresponde'. Ao contrário da regra
 * 4 (que só considera headings que CONTÊM o label inteiro), a sugestão do
 * strict varre todos os headings mesmo sem o token — cobre renomeação que
 * elimina o token (ex.: 'Guard' → 'Gate').
 *
 * PROSE ALLOWLIST (opts.proseAllowlist — CLI --prose-allowlist
 * <palavras,separadas>): atenua o trade-off do strict. Palavras de prosa
 * COMUM (ex.: 'abaixo', 'acima', 'seguir', 'aqui', 'fluxo') que o strict
 * flagaria como falso positivo são eximidas — o token permitido NÃO dispara
 * a violação strict e cai na regra 3 (prosa → exento) como no modo normal.
 * A renomeação single-token REAL continua pega: um token permitido que
 * EXISTE como heading em outro lugar segue indo para a regra 4 (violação
 * com sugestão) — a allowlist só exime prosa, não renomeação. Palavras
 * permitidas são normalizadas (lowercase + trim). Default: vazio (comporta-
 * mento strict atual preservado — opt-in por flag).
 *
 * BLIND SPOT INERENTE (documentado): uma palavra na allowlist que JÁ FOI um
 * heading real, renomeado para um texto SEM o token (e nenhum outro heading
 * carrega o token), fica eximida do strict — o mesmo blind spot de qualquer
 * allowlist: a lista assume que a palavra é prosa, então uma renomeação que
 * elimina o token é aceita. A regra 4 (sugestão) cobre apenas o caso do
 * token ainda existir em outro heading. Escolher a allowlist = declarar
 * 'esta palavra é prosa, não heading' — o preço da eliminação de falso
 * positivo.
 *
 * TRADE-OFF DOCUMENTADO: SEM allowlist, o strict sinaliza também PROSA de
 * um token (ex.: 'abaixo', 'acima' — palavras longas que não são headings).
 * É o preço intencional de pegar renomeações de headings single-token
 * (ex.: '### Guard' renomeado para '### Gate' deixa o label 'Guard' sem
 * correspondência em NENHUM heading — escapava no modo normal). Por isso o
 * modo é OPT-IN e NÃO está no CI (utf8-check/hooks/pre-push): rodar strict
 * no README real acusa os links de prosa ('abaixo') — esperado; a allowlist
 * é o mecanismo para rodar strict no CI sem o ruído de prosa (ver job
 * readme-reverse-strict-alert no pr-check.yml).
 *
 * @param {object[]} headings  de extractHeadings (line, level, slug, text)
 * @param {{ line: number, slug: string, label: string }[]} links  links
 *        internos OU entradas de TOC — qualquer fonte com {line, slug, label}
 * @param {{ strict?: boolean, minSingleTokenLen?: number, proseAllowlist?: string[], minSuggestionSim?: number }} [opts]
 * @returns {object[]} violações {line, slug, label, heading, suggestion, suggestionSim}
 */
export function checkLinkLabelSemantics(headings, links, opts = {}) {
  const {
    strict = false,
    minSingleTokenLen = 3,
    proseAllowlist = [],
    minSuggestionSim = 0.4,
  } = opts
  // Palavras de prosa eximidas do strict — normalizadas (lowercase + trim):
  // o token de label já sai lowercase do tokenize, então a comparação é
  // case-insensitive por construção.
  const allowedProse = new Set(proseAllowlist.map((w) => w.trim().toLowerCase()).filter(Boolean))
  const bySlug = new Map(headings.map((h) => [h.slug, h]))
  const tokensBySlug = new Map(headings.map((h) => [h.slug, new Set(tokenize(h.text))]))
  const violations = []

  for (const link of links) {
    const heading = bySlug.get(link.slug)
    if (!heading) continue // forward já acusa link quebrado
    const labelTokens = tokenize(link.label)
    if (labelTokens.length === 0) continue
    const resolvedTokens = tokensBySlug.get(link.slug)
    // 2. label inteiro presente no heading resolvido → OK
    if (labelTokens.every((t) => resolvedTokens.has(t))) continue
    // STRICT (--reverse-strict): fecha a brecha da regra 3 — um label de UM
    // token não-stopword SIGNIFICATIVO (len >= minSingleTokenLen) apontando
    // para um heading SEM o token, e que NÃO existe em NENHUM outro heading,
    // vira violação (no modo normal isso é 'prosa → exento' e escapa). Se o
    // token existe em outro heading, a regra 4 (abaixo) já sinaliza com
    // sugestão — sem violação dupla. Tokens curtos (ex.: 'OK', 'CI', 'X') são
    // genéricos legítimos e ficam abaixo do threshold.
    if (
      strict &&
      labelTokens.length === 1 &&
      labelTokens[0].length >= minSingleTokenLen &&
      !resolvedTokens.has(labelTokens[0]) &&
      // PROSE ALLOWLIST: token de prosa comum (ex.: 'abaixo') não dispara o
      // strict — cai na regra 3 (prosa → exento). Renomeação real continua
      // pega: se o token permitido existir como heading em outro lugar, a
      // regra 4 sinaliza com sugestão.
      !allowedProse.has(labelTokens[0])
    ) {
      const token = labelTokens[0]
      const existsElsewhere = headings.some((h) => tokensBySlug.get(h.slug).has(token))
      if (!existsElsewhere) {
        // SUGESTÃO: o token não existe em NENHUM heading — mas o heading
        // renomeado pode ter tokens PARECIDOS (ex.: 'Guard' → 'Gate'). A
        // sugestão é o heading com a melhor tokenSimilarity do label contra
        // TODOS os tokens de TODOS os headings (não só os que contêm o
        // token — nenhum contém). Acima do limiar minSuggestionSim →
        // suggestion=slug do heading; abaixo → suggestion=null (render
        // emite 'nenhum heading corresponde').
        //
        // O heading RESOLVIDO é EXCLUÍDO dos candidatos: sugerir o próprio
        // alvo seria contraditório ('aponta para o heading errado?
        // (sugestão: '#guardian')' quando o link JÁ aponta para #guardian —
        // ex.: label 'Guard' → #guardian, heading 'Guardian' tem token
        // 'guardian', sim 0.625). A sugestão só tem sentido como ALTERNATIVA.
        let bestSim = 0
        let bestHeading = null
        for (const h of headings) {
          if (h.slug === link.slug) continue // resolved não é candidato
          for (const t of tokensBySlug.get(h.slug)) {
            const sim = tokenSimilarity(token, t)
            if (sim > bestSim) {
              bestSim = sim
              bestHeading = h
            }
          }
        }
        violations.push({
          line: link.line,
          slug: link.slug,
          label: link.label,
          heading: heading.text,
          strict: true,
          suggestion: bestHeading && bestSim >= minSuggestionSim ? bestHeading.slug : null,
          suggestionSim: bestSim,
        })
        continue
      }
    }
    // 3. nenhum heading contém o label inteiro → prosa → exento
    const matches = headings.filter((h) => {
      const set = tokensBySlug.get(h.slug)
      return labelTokens.every((t) => set.has(t))
    })
    if (matches.length === 0) continue
    // 4. label corresponde a outro heading → violação; a sugestão é o
    //    heading mais RELEVANTE: rankeia por Jaccard dos token-sets
    //    (ordem-insensível — 'Guard de CRLF' e 'CRLF Guard' empatam em 1.0)
    //    e usa Levenshtein de texto SÓ como desempate (Jaccard igual → o
    //    texto mais próximo por caracteres). Antes era Levenshtein puro: um
    //    heading com tokens EXTRAS mas texto parecido (ex.: 'CRLF Guard
    //    Alfa', distância 5) vencia um token-idêntico reordenado ('Guard de
    //    CRLF', distância ~12 por reordenação) — imprevisível.
    const labelLower = link.label.toLowerCase()
    const labelSet = new Set(labelTokens)
    let best = matches[0]
    let bestJ = jaccard(labelSet, tokensBySlug.get(matches[0].slug))
    let bestDist = levenshtein(labelLower, matches[0].text.toLowerCase())
    for (const cand of matches) {
      const j = jaccard(labelSet, tokensBySlug.get(cand.slug))
      const d = levenshtein(labelLower, cand.text.toLowerCase())
      if (j > bestJ || (j === bestJ && d < bestDist)) {
        bestJ = j
        bestDist = d
        best = cand
      }
    }
    violations.push({
      line: link.line,
      slug: link.slug,
      label: link.label,
      heading: heading.text,
      suggestion: best.slug,
    })
  }
  return violations
}

/**
 * Validação REVERSA (--reverse, opcional) dos links internos: o LABEL do link
 * `[X]` deve corresponder semanticamente ao heading para onde aponta — delega
 * ao helper compartilhado checkLinkLabelSemantics (a MESMA regra que o guard
 * de TOC chama de direção `label`; aqui o guard de âncoras a expõe como
 * `--reverse` — nomes diferentes, regra única). Um link
 * `[CRLF Guard](#normalizador)` resolve (forward ok) mas aponta para o
 * heading ERRADO — o label "CRLF Guard" corresponde a outro heading.
 *
 * @param {string} content
 * @param {{ strict?: boolean, minSingleTokenLen?: number, proseAllowlist?: string[], minSuggestionSim?: number }} [opts]
 *        mesmo contrato do checkLinkLabelSemantics (CLI: --reverse-strict,
 *        --min-label-len, --prose-allowlist e --min-suggestion-sim)
 * @returns {object[]} violações {line, slug, label, heading, suggestion, suggestionSim}
 */
export function checkAnchorSemantics(content, opts = {}) {
  return checkLinkLabelSemantics(extractHeadings(content), extractInternalLinks(content), opts)
}

/** Arquivo DEFAULT escaneado (além da auto-descoberta de docs/*.md) quando
 * nenhum caminho é passado. */
export const DEFAULT_PATH = "README.md"

/**
 * Descobre os `docs/*.md` do repo para o scan DEFAULT (quando nenhum target
 * é passado explicitamente). Retorna paths RELATIVOS (`docs/a.md`) ordenados,
 * ignorando não-.md (case-insensitive — um `README.MD` em filesystem sem
 * distinção de caixa também é markdown para o GitHub) e subdiretórios.
 * Retorna [] se `docs/` não existir — skip silencioso: os mutation tests e
 * os CLI tests rodam em temp dirs SÓ com README.md e não podem quebrar por
 * ausência de docs/.
 *
 * @param {string} root  diretório do repo (process.cwd() na CLI)
 * @returns {string[]}
 */
export function discoverDocTargets(root) {
  const docsDir = join(root, "docs")
  let entries
  try {
    entries = readdirSync(docsDir, { withFileTypes: true })
  } catch {
    return [] // docs/ ausente — skip silencioso
  }
  return entries
    .filter((e) => e.isFile() && /\.md$/i.test(e.name))
    .map((e) => e.name)
    .sort()
    .map((n) => `docs/${n}`)
}

function main() {
  const args = process.argv.slice(2)
  let reverse = false
  let reverseStrict = false
  let minLabelLen = 3
  let json = false
  let proseAllowlist = []
  let minSuggestionSim = 0.4
  const targets = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === "--reverse") {
      reverse = true
    } else if (a === "--reverse-strict") {
      reverseStrict = true
    } else if (a === "--min-label-len") {
      const next = args[i + 1]
      if (next !== undefined && /^\d+$/.test(next)) {
        minLabelLen = Number(next)
        i++ // consome o valor
      }
    } else if (a === "--prose-allowlist") {
      const next = args[i + 1]
      if (next !== undefined) {
        // lista separada por vírgula: --prose-allowlist abaixo,acima,seguir
        proseAllowlist = next
          .split(",")
          .map((w) => w.trim())
          .filter(Boolean)
        i++ // consome o valor
      }
    } else if (a === "--min-suggestion-sim") {
      const next = args[i + 1]
      if (next !== undefined && /^(0(\.\d+)?|1(\.0+)?)$/.test(next)) {
        minSuggestionSim = Number(next)
        i++ // consome o valor
      }
    } else if (a === "--json") {
      json = true
    } else {
      targets.push(a)
    }
  }
  const reverseMode = reverse || reverseStrict
  // Default: README.md + TODOS os docs/*.md (auto-descoberta) — a nova âncora
  // do TESTING.md e futuras ficam guardadas contra drift. Targets explícitos
  // ainda sobreescrevem (compat: CLI tests passam 'README.md').
  const resolvedTargets =
    targets.length > 0 ? targets : [DEFAULT_PATH, ...discoverDocTargets(process.cwd())]
  const allViolations = []
  let headingCount = 0

  // Cache de arquivos-alvo cross-doc (abs → conteúdo|null) — evita re-ler o
  // mesmo alvo quando vários arquivos linkam para ele (ex.: README.md e
  // docs/TESTING.md ambos apontando para ../README.md).
  const targetCache = new Map()
  const readTargetCached = (abs) => {
    if (targetCache.has(abs)) return targetCache.get(abs)
    let content = null
    try {
      content = readFileSync(abs, "utf8")
    } catch {
      /* arquivo ausente → null (violação file-missing) */
    }
    targetCache.set(abs, content)
    return content
  }

  for (const target of resolvedTargets) {
    const path = join(process.cwd(), target)
    let content
    try {
      content = readFileSync(path, "utf8")
    } catch (e) {
      console.error(`❌ Não foi possível ler ${target}: ${e.message}`)
      process.exit(1)
    }
    for (const v of checkAnchors(content)) {
      allViolations.push({ file: target, type: "forward", ...v })
    }
    // CROSS-DOC: links para OUTROS arquivos .md (`docs/API.md#anchor`)
    // resolvidos RELATIVO ao diretório do arquivo atual — o README na raiz
    // linka `docs/x.md`, um doc em docs/ linka `../README.md`. Violações
    // saem como type "forward" (link quebrado) para o FAIL-CLOSED do
    // check-readme-reverse-baseline.mjs (weekly) pegá-las — um link morto
    // cross-doc também é input inválido para o audit de drift semântico.
    const baseDir = dirname(path)
    for (const v of checkCrossDocLinks(content, (rel) => readTargetCached(resolve(baseDir, rel)))) {
      // slug = `alvo#âncora` para o JSON/FAIL-CLOSED do
      // check-readme-reverse-baseline.mjs renderizar algo significativo
      // (ele imprime `[label](#f.slug)` no relatório de links quebrados).
      allViolations.push({
        file: target,
        type: "forward",
        kind: "cross-doc",
        slug: `${v.target}#${v.anchor}`,
        ...v,
      })
    }
    if (reverseMode) {
      const opts = reverseStrict
        ? {
            strict: true,
            minSingleTokenLen: minLabelLen,
            proseAllowlist,
            minSuggestionSim,
          }
        : {}
      for (const v of checkAnchorSemantics(content, opts)) {
        allViolations.push({ file: target, type: "reverse", ...v })
      }
    }
    headingCount += extractHeadings(content).length
  }

  // ── REPORT (--json): exit 0 SEMPRE — o caller decide o gate ─────────
  // Contrato do check-secret-leaks-baseline.mjs (que spawna o audit com
  // --json): o JSON no stdout é o que o caller parseia; o exit 0 com
  // achados é INTENCIONAL (o baseline guard compara por assinatura e falha
  // só em NOVOS). Sem --json, o comportamento é o GATE (exit 1 com
  // achados) que o CI/hooks usam.
  if (json) {
    console.log(JSON.stringify({ count: allViolations.length, findings: allViolations }, null, 2))
    process.exit(0)
  }

  if (allViolations.length > 0) {
    console.error(`❌ Link(s) interno(s) do README inválido(s) (${allViolations.length}):\n`)
    for (const v of allViolations) {
      if (v.type === "forward" && v.kind === "cross-doc") {
        const label = v.label ? ` [${v.label}]` : ""
        if (v.reason === "file-missing") {
          console.error(
            `   - ${v.file}:${v.line} [cross-doc]${label}: '${v.target}#${v.anchor}' — ARQUIVO '${v.target}' NÃO existe (link morto)\n`,
          )
        } else {
          const close = v.closest
            ? `\n     → heading mais próximo em '${v.target}': '#${v.closest}' (distância ${v.distance})`
            : `\n     → nenhum heading encontrado em '${v.target}' — link órfão?`
          console.error(
            `   - ${v.file}:${v.line} [cross-doc]${label}: '${v.target}#${v.anchor}' — âncora '#${v.anchor}' NÃO existe em '${v.target}'${close}\n`,
          )
        }
      } else if (v.type === "forward") {
        const label = v.label ? ` [${v.label}]` : ""
        const close = v.closest
          ? `\n     → heading mais próximo: '#${v.closest}' (distância ${v.distance})`
          : "\n     → nenhum heading encontrado — link órfão?"
        console.error(`   - ${v.file}:${v.line} [forward]${label}: '#${v.slug}'${close}\n`)
      } else if (v.strict) {
        const suggestion =
          v.suggestion !== null && v.suggestion !== undefined
            ? ` (sugestão: '#${v.suggestion}' — similaridade ${v.suggestionSim.toFixed(2)})`
            : ` (nenhum heading corresponde — melhor similaridade ${v.suggestionSim.toFixed(2)} abaixo do limiar ${minSuggestionSim})`
        console.error(
          `   - ${v.file}:${v.line} [reverse-strict] [${v.label}]: '#${v.slug}'` +
            ` (heading: '${v.heading}') — label de UM token não-stopword que NÃO` +
            ` existe em NENHUM heading do doc; aponta para o heading errado?${suggestion}\n`,
        )
      } else {
        console.error(
          `   - ${v.file}:${v.line} [reverse] [${v.label}]: '#${v.slug}'` +
            ` (heading: '${v.heading}') — o label corresponde a outro heading` +
            ` (sugestão: '#${v.suggestion}'); aponta para o heading errado?\n`,
        )
      }
    }
    console.error(
      `   Ação: (forward) renomeou um heading? Atualize o link no mesmo PR (o slug é\n` +
        `   gerado pelo algoritmo github-slugger). (reverse) O label do link não\n` +
        `   corresponde ao heading — corrija o slug para o heading certo ou o label.`,
    )
    process.exit(1)
  }

  const mode = reverseStrict
    ? "forward + reverse-strict"
    : reverse
      ? "forward + reverse"
      : "forward"
  console.log(
    `✅ Todos os links internos resolvem para headings reais (${resolvedTargets.join(", ")}; ${headingCount} headings; ${mode}).`,
  )
  process.exit(0)
}

// True apenas quando executado diretamente (node ...) — permite importar as
// funções puras em testes unitários sem disparar o scan.
const IS_DIRECT_RUN =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (IS_DIRECT_RUN) main()
