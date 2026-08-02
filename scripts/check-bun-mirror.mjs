#!/usr/bin/env node

// =============================================================================
// check-bun-mirror.mjs
//
// CI guard do mirror GHCR do Bun (.github/workflows/sync-bun-mirror.yml) +
// da FONTE ÚNICA da versão do Bun (repository variable BUN_VERSION).
//
// FONTE ÚNICA: a versão pinada do Bun vive na repository variable
// vars.BUN_VERSION (Settings → Secrets and variables → Actions). Todos os
// workflows passam `bun-version: ${{ vars.BUN_VERSION }}`, o sync-bun-mirror
// usa a mesma variável no env, e o composite action resolve a versão DO
// INPUT (callers passam o valor resolvido no workflow — vars NÃO resolve
// dentro de composite action no act 0.2.89, ver header do action.yml).
// Metadata de action NÃO avalia ${{ }}, então o default é proibido. Trocar
// o Bun = alterar a variável em UM lugar.
//
// Usage:
//   node scripts/check-bun-mirror.mjs                  # invariantes globais
//   node scripts/check-bun-mirror.mjs --staged         # git diff --cached (local/pre-commit)
//   node scripts/check-bun-mirror.mjs --staged --base origin/main   # diff do PR vs base (CI)
//
// Exit codes:
//   0 — invariantes ok (pass)
//   1 — pelo menos uma violação (fail)
//   2 — falha de infra (git diff indisponível)
//
// Este guard garante os invariantes:
//
//   1. O workflow do mirror EXISTE (sync-bun-mirror.yml).
//   2. env.BUN_VERSION do mirror referencia ${{ vars.BUN_VERSION }} (não um
//      literal — um literal criaria um segundo ponto de verdade).
//   3. O action.yml (setup-bun) NÃO tem default literal para bun-version
//      (metadata de action é estática — um default literal nunca poderia
//      casar com a variável e viraria drift silencioso). A versão resolve
//      em runtime do input bun-version (que os callers resolvem de
//      vars.BUN_VERSION no workflow).
//   4. O action.yml referencia ${{ inputs.bun-version }} no step de resolve
//      (o composite NÃO lê vars internamente — act 0.2.89 não resolve vars
//      em composite actions; o valor entra via input).
//   5. O action.yml (tier 3, cold cache) referencia o mirror GHCR
//      (ghcr.io/<owner>/bun:<versão>) — sem reverter para download direto.
//   6. O Dockerfile.bun-mirror existe (senão o mirror quebra no cron/CI).
//   7. Toda cache key bun-/prisma- nos workflows referencia
//      ${{ vars.BUN_VERSION }} (ex.: key: bun-${{ vars.BUN_VERSION }}-${{ hashFiles('bun.lock') }}).
//      Um literal (bun-1.3.14-...) é VIOLAÇÃO — a troca da variável não
//      invalidaria esse cache.
//
//      A lista de prefixos é CONFIGURÁVEL (DEFAULT_CACHE_KEY_RULES):
//      adicione { prefix, version } para validar cache keys de OUTRAS
//      toolchains com o mesmo padrão — ex.: um futuro cache keyed em
//      'next-' entra como { prefix: "next", version: "15" }, forçando
//      next-15-... na key.
//   8. NENHUM literal de versão do Bun nos workflows (bun-version: 1.3.14,
//      BUN_VERSION: "1.3.14", bun-1.3.14-...) — o guard caça versões
//      hardcoded para que a variável continue sendo a única fonte.
//   9. O .actrc local define BUN_VERSION (sem ele, o act local roda com
//      vars.BUN_VERSION vazia e o setup-bun falha em runtime).
//  10. (modo --staged) Cache keys, literais e CALL SITES do setup-bun
//      INTRODUZIDOS pelo diff em questão (git diff --cached local, ou PR
//      base...HEAD no CI) seguem a fonte única — uma key antiga
//      (bun-1.3.14-...) ou um call site sem bun-version adicionado pelo
//      próprio PR falha antes do merge, mesmo que o working tree global já
//      esteja certo. Só linhas ADICIONADAS (+ no diff) são avaliadas —
//      violações pré-existentes do base não poluem o PR (no call site, o
//      bun-version pode estar numa linha de CONTEXTO — ex.: migração de
//      oven-sh/setup-bun@v2 — por isso o check usa o parser rico).
//  11. TODO call site do setup-bun passa `bun-version: ${{ vars.BUN_VERSION }}`
//      (omitir o input ou usar literal é violação — sem ele o action falha
//      em runtime com mensagem confusa). No modo --staged, call sites cuja
//      linha `uses:` foi adicionada pelo diff são avaliados também.
//
// Escopo: lê .github/workflows/sync-bun-mirror.yml + .github/actions/
// setup-bun/action.yml + Dockerfile.bun-mirror + TODOS os .github/workflows/*.yml
// (cache keys + literais) + .actrc. Node puro, sem deps, <1s.
// =============================================================================

import { readFileSync, existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { execFileSync } from "node:child_process"

/** Referência da repository variable — a FONTE ÚNICA da versão do Bun. */
export const BUN_VERSION_VAR = "${{ vars.BUN_VERSION }}"

/**
 * Janela (em linhas) após um `uses:` para procurar o `bun-version:` —
 * compartilhada entre o scan global (checkSetupBunCallSites) e o scan de diff
 * (checkStagedSetupBunCallSites), sem drift entre as duas janelas.
 */
export const CALL_SITE_WINDOW = 6

/**
 * Extrai o valor de uma env var no topo de um workflow (ex.: BUN_VERSION).
 * Retorna o valor cru (pode ser o literal "1.3.14" ou a referência
 * "${{ vars.BUN_VERSION }}").
 */
export function extractEnvVersion(content, name = "BUN_VERSION") {
  const m = content.match(new RegExp(`^\\s*${name}:\\s*["']?([^"'\\n]+)["']?`, "m"))
  if (!m) return null
  // Descarta comentário inline (ex.: `BUN_VERSION: ${{ vars.BUN_VERSION }} # nota`)
  return m[1].trim().replace(/\s*#.*$/, "")
}

/**
 * Extrai o default de um input do action.yml (ex.: bun-version).
 * Retorna null se NÃO houver default — o estado CORRETO hoje (o guard falha
 * se houver um default literal; metadata de action não avalia ${{ }}).
 */
export function extractActionDefault(content, input = "bun-version") {
  const m = content.match(new RegExp(`^\\s*${input}:`, "m"))
  if (!m) return null
  // procura `default: "..."` no bloco do input (até o próximo input: no
  // nível 0 ou final do arquivo)
  const after = content.slice(m.index + m[0].length)
  const nextInput = after.search(/^\s{2}[a-z][a-z-]*:/m)
  const block = nextInput === -1 ? after : after.slice(0, nextInput)
  const d = block.match(/default:\s*["']?([^"'\n]+)/)
  return d ? d[1].trim() : null
}

/**
 * O action.yml referencia a repository variable BUN_VERSION?
 * Casa AMBAS as formas — a referência pura (`${{ vars.BUN_VERSION }}`) e a
 * resolução runtime (`${{ inputs.bun-version || vars.BUN_VERSION }}`) — o
 * ponto é validar que o action REALMENTE lê a variável em algum lugar.
 *
 * NOTA (08/2026): o runtime do action NÃO usa mais vars (resolve do input
 * — act 0.2.89 não resolve vars em composite actions). Esta função continua
 * exportada para testes/backwards-compat: ela casa também menções em prosa
 * (header do action.yml), então NÃO é usada pelo validateMirror — o contrato
 * real é hasBunVersionInputRef + checkSetupBunCallSites.
 */
export function hasVarsBunVersionRef(actionContent) {
  return /\bvars\.BUN_VERSION\b/.test(actionContent)
}

/**
 * O action.yml referencia o input bun-version no step de resolve?
 * (novo contrato: o composite resolve a versão DO INPUT, que os callers
 * resolvem de vars.BUN_VERSION no workflow — vars não resolve dentro de
 * composite action no act 0.2.89)
 */
export function hasBunVersionInputRef(actionContent) {
  return /\binputs\.bun-version\b/.test(actionContent)
}

/** O action.yml referencia o mirror GHCR no tier 3? (ghcr.io/.../bun:<ver>) */
export function hasGhcrMirrorRef(actionContent) {
  // Tier 3 monta MIRROR="ghcr.io/${GHCR_OWNER}/bun:${BUN_VERSION}" — o guard
  // casa a construção do nome + o pull, não uma string hardcoded.
  return (
    /ghcr\.io\/\$\{GHCR_OWNER\}\/bun:\$\{BUN_VERSION\}/.test(actionContent) ||
    /ghcr\.io\/[^"']+\/bun:/m.test(actionContent)
  )
}

/**
 * Regras de cache key por toolchain: cada prefixo (ex.: bun, prisma) com a
 * versão que a key DEVE incluir. Para bun/prisma a "versão" é a REFERÊNCIA
 * da repository variable (${{ vars.BUN_VERSION }}) — um literal é violação.
 * Lista CONFIGURÁVEL — para validar cache keys de outra toolchain, adicione
 * { prefix, version } aqui (ex.: um futuro cache keyed em 'next-' entraria
 * como { prefix: "next", version: "15" }).
 *
 * @returns {{ prefix: string, version: string }[]}
 */
export const DEFAULT_CACHE_KEY_RULES = () => [
  { prefix: "bun", version: BUN_VERSION_VAR },
  { prefix: "prisma", version: BUN_VERSION_VAR },
]

/**
 * Varre .github/workflows/*.yml e falha se alguma cache key (key: ou
 * restore-keys:) com prefixo de uma toolchain CONFIGURADA (rules) não
 * incluir a versão daquela regra. Para bun/prisma a versão é a referência
 * `${{ vars.BUN_VERSION }}` — um literal (ex.: bun-1.3.14-) NÃO casa e é
 * reportado como violação (trocar a variável não invalidaria esse cache).
 *
 * @param {string} workflowsDir  diretório .github/workflows
 * @param {{ prefix: string, version: string }[]} rules  regras configuráveis
 * @returns {string[]} lista de violações (vazia = ok)
 */
/**
 * Checa UMA linha de cache key contra as regras. Retorna a violação como
 * string, ou null se a linha estiver correta. Função de NÍVEL DE LINHA
 * compartilhada entre o scan global (checkCacheKeys) e o scan de diff
 * (checkStagedCacheKeys) — uma única fonte da lógica, sem drift.
 *
 * @param {string} file     nome do arquivo (ex.: "pr-check.yml")
 * @param {number} lineNo   número da linha (1-based)
 * @param {string} content  conteúdo da linha
 * @param {{ prefix: string, version: string }[]} rules
 * @returns {string|null}
 */
export function checkCacheKeyLine(file, lineNo, content, rules) {
  if (rules.length === 0) return null

  // Escapa metacharacters de cada prefixo antes de montar a regex — o ponto
  // do design é ADICIONAR toolchains futuras, e nomes como 'next.js'/'bun.sh'
  // injetariam `.` como wildcard na regex (casaria keys erradas em silêncio).
  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const prefixRe = rules.map((r) => escapeRe(r.prefix)).join("|")
  // `(.*)$` (não `(.+)`) — um `restore-keys: bun-` vazio também é violação
  const re = new RegExp(`^\\s*(key|restore-keys):\\s*(${prefixRe})-(.*)$`)

  const m = content.match(re)
  if (!m) return null
  const [, kind, prefixKind, rest] = m
  const rule = rules.find((r) => r.prefix === prefixKind)
  if (!rule) return null
  if (rest.startsWith(`${rule.version}-`)) return null
  // Mostra o token até o primeiro espaço, sem o resíduo '${{' (ex.:
  // '1.4.0-' em '1.4.0-${{ hashFiles(...) }}' ou vazio em
  // 'bun-${{ hashFiles(...) }}') — mensagem limpa no CI.
  const shown = rest.split(/\s/)[0].replace(/^\$\{\{.*/, "")
  return `${file}:${lineNo}: ${kind} de cache '${prefixKind}-${shown}' sem a fonte única ${rule.version} (use '${prefixKind}-${rule.version}-...')`
}

/**
 * Varre .github/workflows/*.yml e falha se alguma cache key (key: ou
 * restore-keys:) com prefixo de uma toolchain CONFIGURADA (rules) não
 * incluir a versão daquela regra. Para bun/prisma a versão é a referência
 * `${{ vars.BUN_VERSION }}` — um literal (ex.: bun-1.3.14-) NÃO casa e é
 * reportado como violação (trocar a variável não invalidaria esse cache).
 *
 * @param {string} workflowsDir  diretório .github/workflows
 * @param {{ prefix: string, version: string }[]} rules  regras configuráveis
 * @returns {string[]} lista de violações (vazia = ok)
 */
export function checkCacheKeys(workflowsDir, rules) {
  const violations = []
  if (!existsSync(workflowsDir)) return violations

  for (const file of readdirSync(workflowsDir).filter((f) => f.endsWith(".yml"))) {
    const lines = readFileSync(join(workflowsDir, file), "utf8").split("\n")
    lines.forEach((content, i) => {
      const v = checkCacheKeyLine(file, i + 1, content, rules)
      if (v) violations.push(v)
    })
  }
  return violations
}

/**
 * Caça versões LITERAIS do Bun nos workflows (bun-version: 1.3.14,
 * BUN_VERSION: "1.3.14", bun-1.3.14-...). A versão só pode vir da
 * repository variable — qualquer literal é um segundo ponto de verdade.
 *
 * @param {string} workflowsDir  diretório .github/workflows
 * @returns {string[]} lista de violações (vazia = ok)
 */
/**
 * Checa UMA linha contra versões LITERAIS do Bun (bun-version: 1.3.14,
 * BUN_VERSION: "1.3.14", bun-1.3.14-...). Retorna a violação ou null.
 * Função de NÍVEL DE LINHA compartilhada entre o scan global
 * (checkNoLiteralBunVersion) e o scan de diff (checkStagedLiterals).
 *
 * @param {string} file     nome do arquivo
 * @param {number} lineNo   número da linha (1-based)
 * @param {string} content  conteúdo da linha
 * @returns {string|null}
 */
export function checkLiteralBunLine(file, lineNo, content) {
  if (content.trim().startsWith("#")) return null // ignora comentários
  // Versão semântica 1.x.y — casa bun-version: <ver>, BUN_VERSION: <ver> e
  // qualquer cache key com literal (bun-1.3.14-...).
  const literalRe =
    /\b(?:bun-version|BUN_VERSION):\s*["']?(\d+\.\d+\.\d+)|(?:bun|prisma)-(\d+\.\d+\.\d+)-/g
  literalRe.lastIndex = 0
  const m = literalRe.exec(content)
  if (!m) return null
  const literal = m[1] || m[2]
  const context = m[0].trim()
  return `${file}:${lineNo}: versão literal do Bun '${literal}' em '${context}' — a versão só pode vir da repository variable (use ${BUN_VERSION_VAR})`
}

/**
 * Caça versões LITERAIS do Bun nos workflows (bun-version: 1.3.14,
 * BUN_VERSION: "1.3.14", bun-1.3.14-...). A versão só pode vir da
 * repository variable — qualquer literal é um segundo ponto de verdade.
 *
 * @param {string} workflowsDir  diretório .github/workflows
 * @returns {string[]} lista de violações (vazia = ok)
 */
export function checkNoLiteralBunVersion(workflowsDir) {
  const violations = []
  if (!existsSync(workflowsDir)) return violations

  for (const file of readdirSync(workflowsDir).filter((f) => f.endsWith(".yml"))) {
    const lines = readFileSync(join(workflowsDir, file), "utf8").split("\n")
    lines.forEach((content, i) => {
      const v = checkLiteralBunLine(file, i + 1, content)
      if (v) violations.push(v)
    })
  }
  return violations
}

/**
 * Normaliza o valor de um `bun-version:` (ex.: aceita aspas e descarta
 * comentário inline) — tratamento ÚNICO compartilhado entre o scan global
 * (checkSetupBunCallSites) e o scan de diff (checkStagedSetupBunCallSites).
 *
 * ORDEM IMPORTANTE: o comentário inline é removido ANTES das aspas — num
 * valor `"${{ vars.BUN_VERSION }}" # nota`, remover as aspas primeiro
 * deixaria a aspas final remanescente (`" # nota` impede o match `["']$`).
 *
 * @param {string} raw  valor cru do YAML (ex.: '"${{ vars.BUN_VERSION }}" # nota')
 * @returns {string} valor normalizado
 */
export function normalizeBunVersionValue(raw) {
  return raw
    .trim()
    .replace(/\s*#.*$/, "")
    .replace(/^["']|["']$/g, "")
    .trim()
}

/**
 * Checa UM call site do setup-bun: a partir da linha `uses:` (file:lineNo),
 * varre as linhas SEGUINTES (janela ~6) procurando `bun-version:`. Retorna
 * a violação como string, ou null se o call site estiver correto. Função de
 * NÍVEL DE CALL SITE compartilhada entre o scan global (checkSetupBunCallSites)
 * e o scan de diff (checkStagedSetupBunCallSites) — uma única fonte da
 * lógica, sem drift.
 *
 * @param {string} file           nome do arquivo
 * @param {number} lineNo         linha do `uses:` (1-based)
 * @param {string[]} following    conteúdo das linhas seguintes (janela)
 * @returns {string|null}
 */
export function checkSetupBunCallSite(file, lineNo, following) {
  let found = null
  for (const l of following) {
    const m = l.match(/^\s*bun-version\s*:\s*(.+?)\s*$/)
    if (m) {
      found = normalizeBunVersionValue(m[1])
      break
    }
  }
  if (found === null) {
    return `${file}:${lineNo}: call site do setup-bun SEM input bun-version — passe 'bun-version: ${BUN_VERSION_VAR}' (o composite resolve só do input; vars não resolve em composite no act 0.2.89)`
  }
  if (found !== BUN_VERSION_VAR) {
    return `${file}:${lineNo}: call site do setup-bun com bun-version='${found}' — use a fonte única ${BUN_VERSION_VAR} (literal é violação)`
  }
  return null
}

/**
 * Verifica que TODO call site do composite action setup-bun passa o input
 * bun-version com a fonte única (${{ vars.BUN_VERSION }}).
 *
 * Por que existe (08/2026): o composite action resolve a versão APENAS do
 * input bun-version — vars não resolve dentro de composite action no act
 * 0.2.89 (erro 'Unknown Variable Access vars'), então o valor é resolvido
 * no WORKFLOW (onde vars funciona) e entra via input. Se um call site
 * omitir o input ou usar literal, o action falha em runtime com mensagem
 * confusa (ou usa versão errada) — este scan pega no PR, antes do merge.
 *
 * @param {string} workflowsDir  diretório .github/workflows
 * @returns {string[]} lista de violações (vazia = ok)
 */
export function checkSetupBunCallSites(workflowsDir) {
  const violations = []
  if (!existsSync(workflowsDir)) return violations

  for (const file of readdirSync(workflowsDir).filter((f) => f.endsWith(".yml"))) {
    const lines = readFileSync(join(workflowsDir, file), "utf8").split("\n")
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      // Ignora comentários — uma prosa '# uses: ./.github/actions/setup-bun'
      // não é um call site real (mesmo guard de check-no-setup-bun.mjs).
      if (line.trim() === "" || line.trim().startsWith("#")) continue
      if (!line.includes("uses: ./.github/actions/setup-bun")) continue
      const v = checkSetupBunCallSite(file, i + 1, lines.slice(i + 1, i + 1 + CALL_SITE_WINDOW))
      if (v) violations.push(v)
    }
  }
  return violations
}

/**
 * Parseia um diff unificado (git diff --cached local, ou PR base...HEAD no
 * CI) e devolve TODAS as linhas que aparecem no diff por arquivo .yml do
 * diretório .github/workflows — ADICIONADAS (prefixo '+') E de CONTEXTO
 * (prefixo ' ') — com o número de linha correspondente NO NOVO arquivo e
 * a flag `added`. O contexto é necessário para o checkStagedSetupBunCallSites:
 * na migração de action (ex.: oven-sh/setup-bun@v2 → ./.github/actions/setup-bun)
 * a linha `uses:` é ADICIONADA mas `with:`/`bun-version:` ficam como
 * CONTEXTO no diff — um parser só-de-adicionadas veria o call site SEM o
 * bun-version e geraria falso positivo. Arquivos não-.yml são ignorados.
 *
 * @param {string} diffText  saída de `git diff ... -- .github/workflows`
 * @returns {Map<string, {lineNo: number, content: string, added: boolean}[]>}
 */
export function parseDiffLines(diffText) {
  const perFile = new Map()
  let currentFile = null
  let lineNo = 0

  for (const line of diffText.split("\n")) {
    if (line.startsWith("+++ ")) {
      // "+++ b/.github/workflows/pr-check.yml" → caminho do arquivo NOVO
      const path = line.slice(4).replace(/^b\//, "")
      currentFile = path.endsWith(".yml") ? path : null
      lineNo = 0
      continue
    }
    if (line.startsWith("@@ ")) {
      // "@@ -12,4 +15,6 @@" → linha de partida do arquivo NOVO no hunk
      const m = line.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
      lineNo = m ? Number(m[1]) : 0
      continue
    }
    if (!currentFile) continue
    const ch = line[0]
    if (ch === "+") {
      if (!perFile.has(currentFile)) perFile.set(currentFile, [])
      perFile.get(currentFile).push({ lineNo, content: line.slice(1), added: true })
      lineNo++
    } else if (ch === "-") {
      // linha removida — não existe no arquivo novo
    } else if (ch === " ") {
      if (!perFile.has(currentFile)) perFile.set(currentFile, [])
      perFile.get(currentFile).push({ lineNo, content: line.slice(1), added: false })
      lineNo++
    }
    // demais metadados (diff --git, index, \ No newline...) são ignorados
  }
  return perFile
}

/**
 * Parseia um diff e devolve apenas as linhas ADICIONADAS (prefixo '+') por
 * arquivo .yml — camada fina sobre parseDiffLines (o parser rico) para os
 * checks por linha (cache keys e literais).
 *
 * @param {string} diffText  saída de `git diff ... -- .github/workflows`
 * @returns {Map<string, {lineNo: number, content: string}[]>}
 */
export function parseDiffAddedLines(diffText) {
  const perFile = new Map()
  for (const [file, lines] of parseDiffLines(diffText)) {
    const added = lines.filter((l) => l.added).map(({ lineNo, content }) => ({ lineNo, content }))
    if (added.length > 0) perFile.set(file, added)
  }
  return perFile
}

/**
 * Checa as cache keys das linhas ADICIONADAS de um diff (git diff --cached
 * local, ou PR base...HEAD no CI) contra as regras — detecta keys antigas
 * (ex.: bun-1.3.14-...) introduzidas PELO PR antes do merge, mesmo que o
 * working tree global já esteja migrado. Só linhas ADICIONADAS são
 * avaliadas — violações pré-existentes do base não poluem o PR.
 *
 * @param {string} diffText  saída de git diff
 * @param {{ prefix: string, version: string }[]} rules  regras configuráveis
 * @returns {string[]} lista de violações (vazia = ok)
 */
export function checkStagedCacheKeys(diffText, rules) {
  const violations = []
  for (const [file, lines] of parseDiffAddedLines(diffText)) {
    for (const { lineNo, content } of lines) {
      const v = checkCacheKeyLine(file, lineNo, content, rules)
      if (v) violations.push(v)
    }
  }
  return violations
}

/**
 * Checa versões LITERAIS do Bun nas linhas ADICIONADAS de um diff — detecta
 * bun-version: 1.3.14 / bun-1.3.14-... introduzidos pelo próprio PR.
 *
 * @param {string} diffText  saída de git diff
 * @returns {string[]} lista de violações (vazia = ok)
 */
export function checkStagedLiterals(diffText) {
  const violations = []
  for (const [file, lines] of parseDiffAddedLines(diffText)) {
    for (const { lineNo, content } of lines) {
      const v = checkLiteralBunLine(file, lineNo, content)
      if (v) violations.push(v)
    }
  }
  return violations
}

/**
 * Checa call sites do setup-bun nas linhas de um diff — detecta call sites
 * SEM input bun-version (ou com literal) INTRODUZIDOS pelo próprio PR antes
 * do merge. Só call sites cuja linha `uses:` foi ADICIONADA pelo diff são
 * avaliados (violações pré-existentes do base não poluem o PR). Usa o parser
 * RICO (parseDiffLines): o `bun-version:` pode estar numa linha de CONTEXTO
 * — ex.: migração de oven-sh/setup-bun@v2 → ./.github/actions/setup-bun, que
 * adiciona só a linha `uses:` e mantém `with:`/`bun-version:` como contexto.
 *
 * @param {string} diffText  saída de git diff
 * @returns {string[]} lista de violações (vazia = ok)
 */
export function checkStagedSetupBunCallSites(diffText) {
  const violations = []
  for (const [file, lines] of parseDiffLines(diffText)) {
    for (let i = 0; i < lines.length; i++) {
      const { lineNo, content, added } = lines[i]
      if (!added) continue // só call sites INTRODUZIDOS por este diff
      if (content.trim() === "" || content.trim().startsWith("#")) continue
      if (!content.includes("uses: ./.github/actions/setup-bun")) continue

      // Janela de até CALL_SITE_WINDOW linhas depois do uses (mesma do
      // checkSetupBunCallSites global) — varre adicionadas E contexto do
      // mesmo arquivo. O limite por lineNo (não por índice) é necessário
      // porque o parser só inclui linhas que aparecem no diff (gaps entre
      // hunks ficam de fora).
      const following = []
      for (let j = i + 1; j < lines.length && lines[j].lineNo <= lineNo + CALL_SITE_WINDOW; j++) {
        following.push(lines[j].content)
      }
      const v = checkSetupBunCallSite(file, lineNo, following)
      if (v) violations.push(v)
    }
  }
  return violations
}

/**
 * Valida que um ref de git passado via --base é um nome de ref SEGURO
 * (charset refname do git: letras, dígitos, ., _, /, -). Proteção contra
 * metacharacters de shell — mesmo usando execFileSync (sem shell), o ref
 * entra no nome da range (ex.: origin/main...HEAD) e um valor malicioso
 * como `main; rm -rf /` quebraria o comando ou executaria algo.
 *
 * @param {string} ref
 * @returns {boolean}
 */
export function isValidGitRef(ref) {
  return /^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(ref) && !ref.includes("..") && !ref.startsWith("-")
}

/**
 * Roda `git diff --cached` (staged local) ou `git diff <base>...HEAD`
 * (CI — PR vs base) limitado a .github/workflows. Retorna null se git
 * indisponível / sem repositório / ref base inválida (o caller decide o
 * exit code). Usa execFileSync (array de args, SEM shell) — sem risco de
 * injeção a partir do valor de --base.
 *
 * @param {string|null} base  ref base (ex.: "origin/main"); null = staged
 * @returns {string|null} texto do diff ou null (infra failure)
 */
export function gitDiffWorkflows(base) {
  if (base !== null && !isValidGitRef(base)) return null
  const args = base
    ? ["diff", `${base}...HEAD`, "--", ".github/workflows"]
    : ["diff", "--cached", "--", ".github/workflows"]
  try {
    return execFileSync("git", args, { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 })
  } catch {
    return null
  }
}

/**
 * Verifica que o .actrc local define BUN_VERSION — sem ele, o act local roda
 * com vars.BUN_VERSION vazia e o setup-bun falha em runtime (mensagem
 * confusa de URL quebrado em vez do erro claro do resolve step).
 *
 * @param {string} actrcPath  caminho do .actrc
 * @returns {string[]} lista de violações (vazia = ok)
 */
export function checkActrc(actrcPath) {
  if (!existsSync(actrcPath)) {
    return [
      `${actrcPath} ausente — crie com '--var BUN_VERSION=<versão>' (espelho local da repository variable; sem ele o act local quebra)`,
    ]
  }
  const content = readFileSync(actrcPath, "utf8")
  if (!/BUN_VERSION\s*=/.test(content)) {
    return [
      `${actrcPath} não define BUN_VERSION — adicione '--var BUN_VERSION=<versão>' (mantenha em sincronia com a repository variable do GitHub)`,
    ]
  }
  return []
}

/**
 * Valida as invariantes a partir dos caminhos reais.
 * @returns {string[]} lista de violações (vazia = ok)
 */
export function validateMirror(workflowPath, actionPath, dockerfilePath) {
  const violations = []

  if (!existsSync(workflowPath)) {
    violations.push(`workflow do mirror ausente: ${workflowPath} (crie sync-bun-mirror.yml)`)
    return violations
  }
  if (!existsSync(actionPath)) {
    violations.push(`action ausente: ${actionPath}`)
    return violations
  }
  if (dockerfilePath && !existsSync(dockerfilePath)) {
    violations.push(
      `Dockerfile do mirror ausente: ${dockerfilePath} (sem ele, o workflow do mirror quebra no cron/CI)`,
    )
  }

  const wf = readFileSync(workflowPath, "utf8")
  const act = readFileSync(actionPath, "utf8")

  // ── Invariante 2: mirror referencia a repository variable (não literal) ─
  const mirrorVersion = extractEnvVersion(wf)
  if (!mirrorVersion) {
    violations.push(`${workflowPath}: env.BUN_VERSION não encontrado`)
  } else if (mirrorVersion !== BUN_VERSION_VAR) {
    violations.push(
      `${workflowPath}: env.BUN_VERSION='${mirrorVersion}' é um LITERAL — use ${BUN_VERSION_VAR} (fonte única: repository variable)`,
    )
  }

  // ── Invariantes 3-4: action sem default literal + referência à variável ─
  const actionDefault = extractActionDefault(act)
  if (actionDefault) {
    violations.push(
      `${actionPath}: default='${actionDefault}' é um LITERAL — metadata de action NÃO avalia \${{ }}, então nunca casaria com a variável. Remova o default; a versão resolve em runtime do input bun-version (que os callers resolvem de ${BUN_VERSION_VAR} no workflow).`,
    )
  }

  if (!hasBunVersionInputRef(act)) {
    violations.push(
      `${actionPath}: não referencia 'inputs.bun-version' no step 'Resolve Bun version' — o composite resolve a versão DO INPUT (callers passam bun-version: ${BUN_VERSION_VAR} no workflow; vars não resolve dentro de composite action no act 0.2.89)`,
    )
  }

  if (!hasGhcrMirrorRef(act)) {
    violations.push(
      `${actionPath}: tier 3 (cold cache) não referencia o mirror GHCR (ghcr.io/<owner>/bun:<versão>)`,
    )
  }

  return violations
}

function main() {
  const args = process.argv.slice(2)
  const staged = args.includes("--staged")
  const baseIdx = args.indexOf("--base")
  const base = baseIdx !== -1 ? args[baseIdx + 1] : null

  // ── Modo --staged: só o que o diff em questão INTRODUZ ──────────────
  // Local/pre-commit: git diff --cached (o que está staged). CI: o job
  // passa --base origin/main → git diff origin/main...HEAD. Só linhas
  // ADICIONADAS são avaliadas — violações pré-existentes do base não
  // poluem o PR, e uma key antiga introduzida pelo PR falha ANTES do
  // merge mesmo que o working tree global já esteja migrado.
  if (base && !staged) {
    console.error(
      `⚠️  --base ${base} sem --staged — o --base só tem efeito no modo --staged (diff base...HEAD). Rodando o scan global.`,
    )
  }

  if (staged) {
    const diffText = gitDiffWorkflows(base)
    if (diffText === null) {
      console.error(
        `❌ Modo --staged: git diff indisponível` +
          (base ? ` (base ${base})` : ` (nada staged? rode 'git add' primeiro)`),
      )
      process.exit(2)
    }
    const violations = [
      ...checkStagedCacheKeys(diffText, DEFAULT_CACHE_KEY_RULES()),
      ...checkStagedLiterals(diffText),
      ...checkStagedSetupBunCallSites(diffText),
    ]
    if (violations.length > 0) {
      console.error(
        `❌ Diff com ${violations.length} violação(ões) de cache key/literal/call site do Bun:\n`,
      )
      for (const v of violations) console.error(`   - ${v}`)
      console.error(
        `\n   Cache keys, literais e call sites introduzidos por este diff precisam usar a fonte única` +
          `\n   ${BUN_VERSION_VAR} — um literal (bun-1.3.14-...) não seria invalidado` +
          `\n   pela troca da variável.`,
      )
      process.exit(1)
    }
    console.log(
      `✅ Diff ok — nenhuma cache key/literal/call site do Bun introduzido` +
        (base ? ` (vs base ${base})` : ` (staged)`),
    )
    process.exit(0)
  }

  // ── Modo padrão: invariantes globais do repositório ─────────────────
  const cwd = process.cwd()
  const actionPath = join(cwd, ".github", "actions", "setup-bun", "action.yml")
  const violations = validateMirror(
    join(cwd, ".github", "workflows", "sync-bun-mirror.yml"),
    actionPath,
    join(cwd, "Dockerfile.bun-mirror"),
  )

  const workflowsDir = join(cwd, ".github", "workflows")
  violations.push(...checkCacheKeys(workflowsDir, DEFAULT_CACHE_KEY_RULES()))
  violations.push(...checkNoLiteralBunVersion(workflowsDir))
  violations.push(...checkSetupBunCallSites(workflowsDir))
  violations.push(...checkActrc(join(cwd, ".actrc")))

  if (violations.length > 0) {
    console.error(`❌ Fonte única do Bun com ${violations.length} violação(ões):\n`)
    for (const v of violations) console.error(`   - ${v}`)
    console.error(
      `\n   A versão do Bun vive APENAS na repository variable vars.BUN_VERSION` +
        `\n   (Settings → Secrets and variables → Actions). Workflows passam` +
        `\n   'bun-version: ${BUN_VERSION_VAR}', o mirror usa a mesma variável e` +
        `\n   o action resolve em runtime. Sem literais em lugar nenhum — trocar` +
        `\n   o Bun = alterar a variável em UM lugar.`,
    )
    process.exit(1)
  }

  console.log(`✅ Fonte única do Bun ok (BUN_VERSION=${BUN_VERSION_VAR}).`)
  process.exit(0)
}

// True apenas quando executado diretamente (node ...) — permite importar as
// funções puras em testes unitários sem disparar o scan.
const IS_DIRECT_RUN =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (IS_DIRECT_RUN) main()
