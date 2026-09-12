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
//      adicione { prefix, version, paths } para validar cache keys de
//      OUTRAS toolchains com o mesmo padrão — ex.: um futuro cache keyed em
//      'next-' entra como { prefix: "next", version: "15", paths: [".next"] },
//      forçando next-15-... na key E o path .next no bloco.
//   7b. TODO bloco actions/cache com key de toolchain configurada FECHA o
//      par key↔path (nas DUAS direções): o `path:` declarado precisa casar
//      com a toolchain da key (bun → node_modules / ~/.bun; prisma →
//      node_modules/.prisma + node_modules/@prisma/client), E o
//      `restore-keys:` também — um restore-keys com prefixo de OUTRA
//      toolchain configurada (ex.: key bun-... + restore-keys prisma-...)
//      buscaria o cache da toolchain errada. Um path de OUTRA toolchain
//      (ex.: node_modules/.prisma com key bun-...) ou um path desconhecido é
//      VIOLAÇÃO — a key sem o path certo quebraria o cache (restore de
//      toolchain errada). No modo --staged, a REMOÇÃO do path:/key: de um
//      bloco actions/cache que SOBREVIVE no novo arquivo é violação de
//      regressão (checkStagedRemovedCacheBlockFields) — espelha o
//      checkStagedRemovedBunVersion: remover o path/key deixa o bloco sem o
//      par key↔path, quebrando o cache no restore.
//   8. NENHUM literal de versão do Bun nos workflows (bun-version: 1.3.14,
//      BUN_VERSION: "1.3.14", bun-1.3.14-...) — o guard caça versões
//      hardcoded para que a variável continue sendo a única fonte.
//   9. O .actrc local define BUN_VERSION (sem ele, o act local roda com
//      vars.BUN_VERSION vazia e o setup-bun falha em runtime).
//  10. (modo --staged) Cache keys, literais e CALL SITES do setup-bun
//      INTRODUZIDOS pelo diff em questão (git diff --cached local, ou PR
//      base...HEAD no CI) seguem a fonte única — uma key antiga
//      (bun-1.3.14-...), uma key de OUTRA toolchain configurada (ex.:
//      next-14-... se 'next' entrar no DEFAULT_CACHE_KEY_RULES) ou um call
//      site sem bun-version adicionado pelo próprio PR falha antes do merge,
//      mesmo que o working tree global já esteja certo. Só linhas ADICIONADAS
//      (+ no diff) são avaliadas — violações pré-existentes do base não
//      poluem o PR (no call site, o bun-version pode estar numa linha de
//      CONTEXTO — ex.: migração de oven-sh/setup-bun@v2 — por isso o check
//      usa o parser rico).
//      REGRESSÃO INVERSA (checkStagedRemovedLiterals): um literal REMOVIDO
//      pelo diff (linha `-` — o PR está migrando aquele literal para a fonte
//      única) com OUTRO literal SOBREVIVENTE na mesma região (janela
//      CACHE_BLOCK_WINDOW) é violação — a migração ficou incompleta: o PR
//      tocou a família de literais mas deixou um para trás. O checkStagedLiterals
//      (só linhas +) não pega um literal de CONTEXTO; este check espelha o
//      checkStagedRemovedCacheBlockFields para a família de literais.
//  11. TODO call site do setup-bun passa `bun-version: ${{ vars.BUN_VERSION }}`
//      (omitir o input ou usar literal é violação — sem ele o action falha
//      em runtime com mensagem confusa). No modo --staged, call sites cuja
//      linha `uses:` foi adicionada pelo diff são avaliados — E a REMOÇÃO
//      do input bun-version de um call site que SOBREVIVEU (linha `uses:`
//      de contexto/adicionada + `bun-version:` removido no diff) é
//      violação de regressão (checkStagedRemovedBunVersion).
//  12. Arquivos de workflow são escaneados nas DUAS extensões (.yml E .yaml)
//      — um workflow com extensão alternativa não escapa dos checks de
//      cache key/literal/call site/par key↔path (global E staged).
//  13. NENHUM Dockerfile do repo pinava versão LITERAL do Bun (bun@1.2,
//      FROM oven/bun:1, bun@1.3.14, bun-v1.3.14 na URL de download do
//      Dockerfile.ubuntu-bun) — a versão nos Dockerfiles só pode vir
//      do build-arg BUN_VERSION (mesmo padrão do Dockerfile.ubuntu-bun:
//      ARG BUN_VERSION + \${BUN_VERSION}; o workflow passa
//      --build-arg BUN_VERSION=${{ vars.BUN_VERSION }}). Um literal criaria
//      um segundo ponto de verdade quando a variável for trocada.
//      O checkDockerfileBunLine cobre as TRÊS formas: npm install -g bun@,
//      FROM oven/bun: e o curl bun-v<ver> (releases/download).
//  14. O repo usa APENAS bun.lock como lockfile — package-lock.json e
//      pnpm-lock.yaml (raiz e mini-services/*) são proibidos (a unificação
//      é travada: um `npm install` acidental regenera o npm lockfile e o
//      guard falha no PR).
//
// Escopo: lê .github/workflows/sync-bun-mirror.yml + .github/actions/
// setup-bun/action.yml + Dockerfile.bun-mirror + os workflows de TODAS as
// forjas (scripts/forge-workflows.mjs)
// E *.yaml (cache keys + literais) + .actrc + Dockerfiles (Dockerfile,
// Dockerfile.worker, Dockerfile.ubuntu-bun, mini-services/realtime/Dockerfile)
// + lockfiles estrangeiros. Node puro, sem deps, <1s.
// =============================================================================

import { readFileSync, existsSync, readdirSync } from "node:fs"

import { FORGE_WORKFLOW_DIRS, existingWorkflowDirs, workflowFileNames } from "./forge-workflows.mjs"
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
 * Janela (em linhas) do bloco `with:` de um actions/cache — cobre o caso
 * multi-path (`path: |` + linhas indentadas) seguido de key/restore-keys.
 * Compartilhada entre o scan global (checkCachePaths) e o scan de diff
 * (checkStagedCachePaths), sem drift entre as duas janelas.
 */
export const CACHE_BLOCK_WINDOW = 14

/**
 * Contexto de linhas pedido ao `git diff` (flag -U) no modo --staged/--base.
 * O default do git é 3 linhas — INSUFICIENTE para os checks de REMOÇÃO com
 * janela (checkStagedRemovedLiterals, checkStagedRemovedCacheBlockFields,
 * checkStagedRemovedBunVersion): um literal/path/input SOBREVIVENTE a poucas
 * linhas de distância da mudança não apareceria no diff como contexto e o
 * check não o enxergaria (falso negativo — a migração incompleta passaria
 * despercebida). -U20 garante que QUALQUER linha dentro da janela
 * CACHE_BLOCK_WINDOW (14) ao redor de uma mudança esteja visível no diff,
 * tanto antes (sobreviventes que precedem a remoção) quanto depois.
 */
export const DIFF_CONTEXT = 20

/**
 * Regex de detecção da linha `uses: actions/cache` — casa AMBAS as formas
 * reais: o item de lista `- uses: actions/cache@v4` (padrão em todos os
 * workflows) e a forma aninhada `        uses: actions/cache@v4` (sem dash,
 * dentro de um step com name). Compartilhada entre o scan global
 * (checkCachePaths) e o scan de diff (checkStagedCachePaths), sem drift
 * entre as duas — um fix aqui vale para ambas.
 */
export const CACHE_USES_RE = /^\s*(?:-\s+)?uses:\s+actions\/cache/

/**
 * Regex de arquivo de workflow do GitHub Actions — casa AMBAS as extensões
 * válidas (.yml e .yaml). Compartilhada entre o scan global (checkCacheKeys,
 * checkCachePaths, checkNoLiteralBunVersion, checkSetupBunCallSites) e o
 * parser de diff (parseDiffLines) — um workflow com extensão alternativa
 * não escapa dos checks, e um fix aqui vale para todos os scans, sem drift.
 */
export const WORKFLOW_FILE_RE = /\.ya?ml$/

/**
 * Dockerfiles do repo que PINAM/instalam o Bun — todos escaneados por
 * versões LITERAIS (invariante 13). O Dockerfile.ubuntu-bun usa o padrão
 * correto (ARG BUN_VERSION + \${BUN_VERSION}); os demais são obrigados ao
 * mesmo padrão pelo guard. Se um Dockerfile NOVO pinar bun, ADICIONE-O aqui
 * (lista explícita — um Dockerfile fora da lista escaparia do check).
 */
export const DOCKERFILES = [
  "Dockerfile",
  "Dockerfile.worker",
  "Dockerfile.ubuntu-bun",
  "Dockerfile.bun-mirror",
  "mini-services/realtime/Dockerfile",
]

/**
 * Lockfiles ESTRANGEIROS proibidos — o repo usa APENAS bun.lock (fonte
 * única de deps). Se um lockfile npm/pnpm aparecer (ex.: `npm install`
 * acidental na raiz ou num mini-service), o guard falha (invariante 14).
 */
export const FOREIGN_LOCKFILES = [
  "package-lock.json",
  "pnpm-lock.yaml",
  "mini-services/realtime/package-lock.json",
  // pnpm-workspace.yaml NÃO é lockfile, mas é config pnpm — foi removido na
  // unificação em bun.lock; incluído aqui para o guard pegar a re-introdução
  // (um `pnpm install` acidental regenera o lockfile E o workspace config).
  "pnpm-workspace.yaml",
]

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

/** O action.yml referencia o mirror OCI no tier 3? (<registry>/.../bun:<ver>) */
export function hasGhcrMirrorRef(actionContent) {
  // Tier 3 monta MIRROR="${IMAGE_REGISTRY:-ghcr.io}/${GHCR_OWNER}/bun:${BUN_VERSION}"
  // — o guard casa a construção do nome + o pull, não uma string hardcoded.
  //
  // O registry é configurável (repo variable IMAGE_REGISTRY), então o prefixo
  // aceito é 'ghcr.io' OU a expansão shell de IMAGE_REGISTRY. O que o guard
  // protege é a INVARIANTE: o tier 3 puxa o Bun do mirror, e nunca volta a
  // baixar o release direto (isso quebraria o objetivo do mirror).
  return (
    /(?:ghcr\.io|\$\{IMAGE_REGISTRY(?::-[^}]*)?\})\/\$\{GHCR_OWNER\}\/bun:\$\{BUN_VERSION\}/.test(
      actionContent,
    ) || /(?:ghcr\.io|\$\{IMAGE_REGISTRY(?::-[^}]*)?\})\/[^"']+\/bun:/m.test(actionContent)
  )
}

/**
 * Regras de cache key por toolchain: cada prefixo (ex.: bun, prisma) com a
 * versão que a key DEVE incluir E os paths que o bloco actions/cache DEVE
 * cachear (fecha o par key↔path). Para bun/prisma a "versão" é a REFERÊNCIA
 * da repository variable (${{ vars.BUN_VERSION }}) — um literal é violação.
 *
 * paths: caminhos que um bloco com key '<prefixo>-...' deve declarar em
 * `path:` (exata match após trim). Multi-path (`path: |`) é suportado — a
 * validação passa se PELO MENOS UM path da lista for um dos paths da regra.
 * A direção inversa também vale: um path que é de OUTRA toolchain com key de
 * outra é violação (ex.: path node_modules/.prisma com key bun-...).
 *
 * Lista CONFIGURÁVEL — para validar cache keys de outra toolchain, adicione
 * { prefix, version, paths } aqui (ex.: um futuro cache keyed em 'next-'
 * entraria como { prefix: "next", version: "15", paths: [".next"] }).
 *
 * @returns {{ prefix: string, version: string, paths: string[] }[]}
 */
export const DEFAULT_CACHE_KEY_RULES = () => [
  {
    prefix: "bun",
    version: BUN_VERSION_VAR,
    paths: ["node_modules", "~/.bun"],
  },
  {
    prefix: "prisma",
    version: BUN_VERSION_VAR,
    paths: ["node_modules/.prisma", "node_modules/@prisma/client"],
  },
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
 * Extrai o PREFIXO de uma cache key (ex.: 'bun' de 'bun-${{ vars.BUN_VERSION }}-...').
 * Usa match NÃO-guloso: em uma key literal ('prisma-1.3.14-...') o prefixo
 * é 'prisma' (o literal é violação de OUTRO check — aqui só identificamos
 * a toolchain). Retorna null se a key não tiver o formato '<prefixo>-...'.
 *
 * @param {string} keyValue  valor cru da key (ex.: 'bun-...')
 * @returns {string|null}
 */
export function extractCacheKeyPrefix(keyValue) {
  const m = String(keyValue).match(/^([a-zA-Z0-9_.-]+?)-/)
  return m ? m[1] : null
}

/**
 * Parseia as linhas do bloco `with:` de um actions/cache (após a linha
 * `uses: actions/cache`) e extrai os paths declarados, o prefixo da key E os
 * prefixos dos restore-keys. Suporta `path:` simples (ex.: 'path:
 * node_modules') e multi-linha ('path: |' seguido de linhas mais indentadas
 * — ex.: prisma client) — e o mesmo para `restore-keys: |` (lista de
 * fallbacks, cada linha um prefixo próprio). O restore-keys é lido para o
 * checkCachePathBlock fechar o par key↔path TAMBÉM na direção do restore
 * (ex.: key bun + restore-keys prisma = inconsistência).
 *
 * @param {string[]} blockLines  linhas do bloco (incluindo with:/path:/key:/restore-keys:)
 * @returns {{ paths: string[], keyPrefix: string|null, restorePrefixes: string[] }}
 */
export function parseCacheBlock(blockLines) {
  const paths = []
  const restorePrefixes = []
  let keyPrefix = null
  let multiIndent = -1
  let multiKind = null // "path" | "restore" — qual campo multi-linha está sendo coletado
  for (const line of blockLines) {
    const indent = line.match(/^\s*/)[0].length
    const trimmed = line.trim()
    if (trimmed === "" || trimmed.startsWith("#")) continue
    if (multiIndent >= 0) {
      // coleciona linhas MAIS indentadas que o `path: |` / `restore-keys: |`
      // — até a indentação voltar ao nível do campo (mesmo nível do path:)
      if (indent <= multiIndent) {
        multiIndent = -1
        multiKind = null
      } else {
        if (multiKind === "path") {
          paths.push(trimmed)
        } else if (multiKind === "restore") {
          const p = extractCacheKeyPrefix(trimmed)
          if (p) restorePrefixes.push(p)
        }
        continue
      }
    }
    const pathM = line.match(/^\s*path:\s*(.+?)\s*$/)
    if (pathM) {
      const v = pathM[1].trim()
      if (v === "|" || v === ">" || v === ">-") {
        multiIndent = indent
        multiKind = "path"
        continue
      }
      paths.push(v.replace(/^["']|["']$/g, ""))
      continue
    }
    const keyM = line.match(/^\s*key:\s*(.+?)\s*$/)
    if (keyM) {
      keyPrefix = extractCacheKeyPrefix(keyM[1].trim())
      continue
    }
    const restM = line.match(/^\s*restore-keys:\s*(.+?)\s*$/)
    if (restM) {
      const v = restM[1].trim()
      if (v === "|" || v === ">" || v === ">-") {
        multiIndent = indent
        multiKind = "restore"
        continue
      }
      const p = extractCacheKeyPrefix(v)
      if (p) restorePrefixes.push(p)
    }
  }
  return { paths, keyPrefix, restorePrefixes }
}

/**
 * Valida UM bloco actions/cache (linhas após o `uses:`) contra as regras —
 * FECHA o par key↔path (nas DUAS direções: path E restore-keys):
 *   - a key tem prefixo de toolchain configurada → o bloco DEVE declarar
 *     pelo menos um path daquela toolchain;
 *   - um path declarado que pertence a OUTRA toolchain (ex.:
 *     node_modules/.prisma com key bun-...) é violação;
 *   - um path desconhecido de TODAS as toolchains com key configurada é
 *     violação (não é um path da toolchain);
 *   - um restore-keys com prefixo de OUTRA toolchain CONFIGURADA (ex.: key
 *     bun-... + restore-keys prisma-...) é violação — o restore buscaria o
 *     cache da toolchain errada; prefixos desconhecidos não têm contrato;
 *   - regra sem `paths` (toolchain custom) → só valida a key (não o path).
 *
 * @param {string} file         nome do arquivo
 * @param {number} usesLineNo   linha do `uses:` (1-based)
 * @param {string[]} blockLines linhas do bloco após o uses
 * @param {{ prefix: string, version: string, paths?: string[] }[]} rules
 * @returns {string[]} lista de violações (vazia = ok)
 */
export function checkCachePathBlock(file, usesLineNo, blockLines, rules) {
  if (rules.length === 0) return []
  const { paths, keyPrefix, restorePrefixes } = parseCacheBlock(blockLines)
  if (!keyPrefix) return [] // sem key reconhecível — o check de key/literal já cobre
  const rule = rules.find((r) => r.prefix === keyPrefix)
  if (!rule) return [] // toolchain não configurada — nada a validar
  const expected = rule.paths || []
  const violations = []

  // ── 0º: restore-keys de OUTRA toolchain → inconsistência do par (direção
  // do restore) — ex.: key bun-... + restore-keys prisma-... restaura o cache
  // da toolchain errada. Só prefixos de toolchains CONFIGURADAS são
  // reportados (um restore-keys com prefixo desconhecido não tem contrato).
  const foreignRestores = [
    ...new Set(restorePrefixes.filter((p) => p !== keyPrefix && rules.some((r) => r.prefix === p))),
  ]
  if (foreignRestores.length > 0) {
    violations.push(
      `${file}:${usesLineNo}: restore-keys '${foreignRestores
        .map((p) => `${p}-...`)
        .join(
          ", ",
        )}' de OUTRA toolchain — feche o par key↔path (restore-keys deve casar com a toolchain '${keyPrefix}-...' da key)`,
    )
  }

  // Regra custom SEM paths (ex.: { prefix: "next", version: "15" }) → valida
  // só a key (checkCacheKeys), nunca o path — sem paths declarados não há
  // contrato de path a impor. A violação do restore-keys (0º) ainda vale.
  if (expected.length === 0) return violations

  if (paths.length === 0) {
    violations.push(
      `${file}:${usesLineNo}: bloco actions/cache '${keyPrefix}-...' SEM path declarado — declare um dos paths da toolchain (${expected.join(", ")})`,
    )
    return violations
  }

  // 1º: path(s) de OUTRA toolchain → violação SEMPRE (fecha o par) — mesmo
  // quando o bloco também cacheia um path correto da toolchain da key (ex.:
  // bun key com node_modules + node_modules/.prisma: o .prisma sob key bun
  // derrota o keying por schema hash).
  const foreign = paths.filter(
    (p) => !expected.includes(p) && rules.some((r) => r !== rule && (r.paths || []).includes(p)),
  )
  if (foreign.length > 0) {
    // owners distintos (Set) — ex.: dois paths da mesma toolchain não
    // duplicam a sugestão 'use key prisma-... ou prisma-...'
    const owners = [
      ...new Set(foreign.map((p) => rules.find((r) => (r.paths || []).includes(p))?.prefix)),
    ].map((pfx) => `${pfx}-...`)
    violations.push(
      `${file}:${usesLineNo}: cache '${keyPrefix}-...' com path(s) [${foreign.join(", ")}] que pertence(m) à toolchain ${[
        ...new Set(
          rules
            .filter((r) => r !== rule && (r.paths || []).some((p) => foreign.includes(p)))
            .map((r) => r.prefix),
        ),
      ]
        .map((p) => `'${p}'`)
        .join(" e ")} — feche o par key↔path (use key '${owners.join(" ou ")}' ou mude o path)`,
    )
    return violations
  }

  // 2º: nenhum path de outra toolchain — passa se PELO MENOS UM path da
  // toolchain da key existir (multi-path parcial é ok). Se o restore-keys já
  // gerou violação (0º), ela é preservada mesmo com paths corretos.
  if (paths.some((p) => expected.includes(p))) return violations

  // 3º: path desconhecido de TODAS as toolchains com key configurada → violação.
  violations.push(
    `${file}:${usesLineNo}: cache '${keyPrefix}-...' com path(s) [${paths.join(", ")}] que não batem com a toolchain ${keyPrefix} (esperado: ${expected.join(", ")})`,
  )
  return violations
}

/**
 * Varre .github/workflows/*.yml e *.yaml e valida o par key↔path de TODO
 * bloco actions/cache cuja key tem prefixo de toolchain configurada — fecha
 * a conexão entre a key (que já é validada por checkCacheKeys) e o path que
 * o bloco realmente cacheia.
 *
 * @param {string} workflowsDir  diretório .github/workflows
 * @param {{ prefix: string, version: string, paths?: string[] }[]} rules
 * @returns {string[]} lista de violações (vazia = ok)
 */
export function checkCachePaths(workflowsDir, rules) {
  const violations = []
  if (!existsSync(workflowsDir) || rules.length === 0) return violations

  for (const file of readdirSync(workflowsDir).filter((f) => WORKFLOW_FILE_RE.test(f))) {
    const lines = readFileSync(join(workflowsDir, file), "utf8").split("\n")
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (line.trim() === "" || line.trim().startsWith("#")) continue
      if (!line.match(CACHE_USES_RE)) continue
      const usesIndent = line.match(/^\s*/)[0].length
      const block = []
      for (let j = i + 1; j < lines.length && block.length < CACHE_BLOCK_WINDOW; j++) {
        const l = lines[j]
        const indent = l.match(/^\s*/)[0].length
        const t = l.trim()
        if (t === "") continue
        // novo step no MESMO nível ou mais raso (indent <= uses) termina o bloco
        if (indent <= usesIndent && (/^\s*-\s+/.test(l) || !/^\s{2,}/.test(l))) break
        block.push(l)
      }
      const v = checkCachePathBlock(file, i + 1, block, rules)
      if (v.length > 0) violations.push(...v)
    }
  }
  return violations
}

/**
 * Varre .github/workflows/*.yml e *.yaml e falha se alguma cache key (key:
 * ou restore-keys:) com prefixo de uma toolchain CONFIGURADA (rules) não
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

  for (const file of readdirSync(workflowsDir).filter((f) => WORKFLOW_FILE_RE.test(f))) {
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

  for (const file of readdirSync(workflowsDir).filter((f) => WORKFLOW_FILE_RE.test(f))) {
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

  for (const file of readdirSync(workflowsDir).filter((f) => WORKFLOW_FILE_RE.test(f))) {
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
 * CI) e devolve TODAS as linhas que aparecem no diff por arquivo de workflow
 * (.yml OU .yaml) do diretório .github/workflows — ADICIONADAS (prefixo '+'),
 * de CONTEXTO (prefixo ' ') e REMOVIDAS (prefixo '-') — com o número de linha
 * correspondente NO NOVO arquivo e as flags `added`/`removed`. O contexto é
 * necessário para o checkStagedSetupBunCallSites: na migração de action (ex.:
 * oven-sh/setup-bun@v2 → ./.github/actions/setup-bun) a linha `uses:` é
 * ADICIONADA mas `with:`/`bun-version:` ficam como CONTEXTO no diff — um
 * parser só-de-adicionadas veria o call site SEM o bun-version e geraria
 * falso positivo. As REMOVIDAS (sem incrementar lineNo — não existem no
 * arquivo novo) são necessárias para o checkStagedRemovedBunVersion detectar
 * a remoção do input bun-version de um call site que SOBREVIVEU. Headers
 * `--- a/<path>` do arquivo ANTIGO são ignorados (não são linhas removidas).
 * Arquivos sem extensão de workflow (.yml/.yaml) são ignorados.
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
      // (aceita .yml E .yaml — extensão alternativa não escapa do scan)
      const path = line.slice(4).replace(/^b\//, "")
      currentFile = WORKFLOW_FILE_RE.test(path) ? path : null
      lineNo = 0
      continue
    }
    if (line.startsWith("@@ ")) {
      // "@@ -12,4 +15,6 @@" → linha de partida do arquivo NOVO no hunk
      const m = line.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
      lineNo = m ? Number(m[1]) : 0
      continue
    }
    if (line.startsWith("--- ")) {
      // "--- a/<path>" — header do arquivo ANTIGO no diff; NÃO é uma linha
      // REMOVIDA. Sem este guard, num diff multi-arquivo o `--- a/<próximo>`
      // (antes do `+++` que reseta currentFile) cairia como `removed: true`
      // espúrio do arquivo ANTERIOR.
      continue
    }
    if (!currentFile) continue
    const ch = line[0]
    if (ch === "+") {
      if (!perFile.has(currentFile)) perFile.set(currentFile, [])
      perFile.get(currentFile).push({ lineNo, content: line.slice(1), added: true })
      lineNo++
    } else if (ch === "-") {
      // linha REMOVIDA — não existe no arquivo novo; incluída com `removed:
      // true` SEM incrementar lineNo (ela não ocupa posição no arquivo novo)
      // para o checkStagedRemovedBunVersion detectar a remoção do input
      // bun-version de um call site que SOBREVIVEU no novo arquivo.
      if (!perFile.has(currentFile)) perFile.set(currentFile, [])
      perFile.get(currentFile).push({ lineNo, content: line.slice(1), removed: true })
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
 * arquivo de workflow (.yml/.yaml) — camada fina sobre parseDiffLines (o
 * parser rico) para os checks por linha (cache keys e literais).
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
 * local, ou PR base...HEAD no CI) contra TODAS as toolchains configuradas
 * (rules — o DEFAULT_CACHE_KEY_RULES é a fonte: hoje bun + prisma, mas
 * qualquer { prefix, version } adicionado à lista vale TAMBÉM no staged, ex.:
 * um futuro 'next' com version '15') — detecta keys antigas (ex.:
 * bun-1.3.14-... ou next-14-...) introduzidas PELO PR antes do merge, mesmo
 * que o working tree global já esteja migrado. Só linhas ADICIONADAS são
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
 * Valida o par key↔path dos blocos actions/cache nas linhas de um diff —
 * detecta blocos de cache NOVOS (linha `uses: actions/cache` ADICIONADA)
 * cujo path não bate com a toolchain da key. Só blocos cuja linha `uses:`
 * foi adicionada pelo diff são avaliados (violações pré-existentes do base
 * não poluem o PR). Usa o parser RICO (parseDiffLines): o path/key podem
 * estar em linhas de CONTEXTO do mesmo bloco.
 *
 * @param {string} diffText  saída de git diff
 * @param {{ prefix: string, version: string, paths?: string[] }[]} rules
 * @returns {string[]} lista de violações (vazia = ok)
 */
export function checkStagedCachePaths(diffText, rules) {
  const violations = []
  if (rules.length === 0) return violations
  for (const [file, lines] of parseDiffLines(diffText)) {
    for (let i = 0; i < lines.length; i++) {
      const { lineNo, content, added } = lines[i]
      if (!added) continue // só blocos INTRODUZIDOS por este diff
      if (content.trim() === "" || content.trim().startsWith("#")) continue
      if (!content.match(CACHE_USES_RE)) continue

      // Janela de até CACHE_BLOCK_WINDOW linhas depois do uses (mesma do
      // scan global) — varre adicionadas E contexto do mesmo arquivo. Linhas
      // REMOVIDAS são puladas — um path/key removido não pertence ao bloco
      // sobrevivente que está sendo validado.
      const following = []
      for (let j = i + 1; j < lines.length && lines[j].lineNo <= lineNo + CACHE_BLOCK_WINDOW; j++) {
        if (lines[j].removed) continue
        following.push(lines[j].content)
      }
      const v = checkCachePathBlock(file, lineNo, following, rules)
      if (v.length > 0) violations.push(...v)
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
      // hunks ficam de fora). Linhas REMOVIDAS são puladas — um bun-version
      // removido não é um input que sobrevive no novo arquivo (um call site
      // adicionado junto com a remoção do bun-version seria falso negativo).
      const following = []
      for (let j = i + 1; j < lines.length && lines[j].lineNo <= lineNo + CALL_SITE_WINDOW; j++) {
        if (lines[j].removed) continue
        following.push(lines[j].content)
      }
      const v = checkSetupBunCallSite(file, lineNo, following)
      if (v) violations.push(v)
    }
  }
  return violations
}

/**
 * Checa a REMOÇÃO do input bun-version de call sites do setup-bun nas linhas
 * de um diff — a regressão OPOSTA à do checkStagedSetupBunCallSites: um call
 * site que SOBREVIVE no arquivo novo (linha `uses:` presente como contexto OU
 * adicionada) mas que PERDEU o `bun-version:` — o input foi REMOVIDO pelo PR
 * (linha `-` no diff). Sem este check, remover o input de um call site
 * pré-existente passaria no guard: o check de adição só avalia call sites
 * cuja linha `uses:` foi ADICIONADA.
 *
 * NÃO reporta quando:
 *   - o call site INTEIRO foi removido (a linha `uses:` também é `-` — o
 *     step deixou de existir, não há contrato a impor);
 *   - um `bun-version:` SOBREVIVE na janela (adicionado ou contexto) — ex.:
 *     migração literal→vars (a linha antiga é `-`, a nova é `+`) — o call
 *     site TROCOU o valor, não perdeu o input.
 *
 * @param {string} diffText  saída de git diff
 * @returns {string[]} lista de violações (vazia = ok)
 */
export function checkStagedRemovedBunVersion(diffText) {
  const violations = []
  for (const [file, lines] of parseDiffLines(diffText)) {
    for (let i = 0; i < lines.length; i++) {
      const { lineNo, content, removed } = lines[i]
      // âncora: call site que SOBREVIVE no novo arquivo (uses presente —
      // contexto ou adicionado). `uses:` REMOVIDO = step inteiro removido.
      if (removed) continue
      if (content.trim() === "" || content.trim().startsWith("#")) continue
      if (!content.includes("uses: ./.github/actions/setup-bun")) continue

      // Janela seguinte (mesma do checkStagedSetupBunCallSites) — procura um
      // `bun-version:` REMOVIDO e, na MESMA janela, um SOBREVIVENTE.
      const following = []
      for (let j = i + 1; j < lines.length && lines[j].lineNo <= lineNo + CALL_SITE_WINDOW; j++) {
        following.push(lines[j])
      }

      const removedBun = following.find((l) => l.removed && /^\s*bun-version\s*:/.test(l.content))
      if (!removedBun) continue
      const survivingBun = following.some(
        (l) => !l.removed && /^\s*bun-version\s*:/.test(l.content),
      )
      if (survivingBun) continue // trocou o valor (literal→vars), não perdeu o input

      violations.push(
        `${file}:${removedBun.lineNo}: REMOÇÃO do input bun-version do call site do setup-bun (uses: linha ${lineNo}) — o call site SOBREVIVEU sem o input; adicione de volta 'bun-version: ${BUN_VERSION_VAR}'`,
      )
    }
  }
  return violations
}

/**
 * Checa a REMOÇÃO do path: OU da key: de blocos actions/cache nas linhas de
 * um diff — a regressão OPOSTA à do checkStagedCachePaths: um bloco que
 * SOBREVIVE no arquivo novo (linha `uses: actions/cache` presente como
 * contexto OU adicionada) mas que PERDEU o `path:` ou a `key:` — o campo foi
 * REMOVIDO pelo PR (linha `-` no diff). Sem este check, remover o path/key
 * de um bloco pré-existente passaria no guard: o check de adição só avalia
 * blocos cuja linha `uses:` foi ADICIONADA.
 *
 * NÃO reporta quando:
 *   - o bloco INTEIRO foi removido (a linha `uses:` também é `-` — o step
 *     deixou de existir, não há contrato a impor);
 *   - um `path:`/`key:` SOBREVIVE na janela (adicionado ou contexto) — ex.:
 *     troca de path node_modules → node_modules/.prisma (a linha antiga é
 *     `-`, a nova é `+`) — o bloco TROCOU o valor, não perdeu o campo.
 *
 * O `restore-keys:` NÃO é alvo: ele é opcional por natureza (fallback do
 * cache) — remover restore-keys não quebra o par key↔path; só path/key são
 * obrigatórios para o restore funcionar.
 *
 * LIMITAÇÃO (intencional): a REMOÇÃO só é detectada na linha `path:` em si —
 * remover apenas as sub-linhas indentadas de um `path: |` sobrevivente
 * (deixando `path: |` sem filhos, i.e. lista vazia de paths) escapa do
 * check, pois nenhuma linha REMOVIDA com prefixo `path:` existe na janela
 * para disparar a detecção (o header `path: |` sobrevive e não casa o
 * regex de remoção). Diferente do parseCacheBlock global, que coleta os
 * filhos indentados e detectaria a lista vazia como 'SEM path declarado' —
 * o scan de remoção é por linha-cabeçalho. Se um dia essa variante
 * aparecer, ampliar o regex para também exigir pelo menos um filho
 * indentado após um `path: |` removido.
 * @param {string} diffText  saída de git diff
 * @returns {string[]} lista de violações (vazia = ok)
 */
export function checkStagedRemovedCacheBlockFields(diffText) {
  const violations = []
  for (const [file, lines] of parseDiffLines(diffText)) {
    for (let i = 0; i < lines.length; i++) {
      const { lineNo, content, removed } = lines[i]
      // âncora: bloco actions/cache que SOBREVIVE no novo arquivo (uses
      // presente — contexto ou adicionado). `uses:` REMOVIDO = bloco inteiro
      // removido (step deletado) — sem contrato a impor.
      if (removed) continue
      if (content.trim() === "" || content.trim().startsWith("#")) continue
      if (!content.match(CACHE_USES_RE)) continue

      // Janela seguinte (mesma do checkStagedCachePaths) — procura um
      // `path:`/`key:` REMOVIDO e, na MESMA janela, um SOBREVIVENTE.
      const following = []
      for (let j = i + 1; j < lines.length && lines[j].lineNo <= lineNo + CACHE_BLOCK_WINDOW; j++) {
        following.push(lines[j])
      }

      // path removido sem path sobrevivente na janela → bloco sem path
      const removedPath = following.find((l) => l.removed && /^\s*path:/.test(l.content))
      if (removedPath) {
        const survivingPath = following.some((l) => !l.removed && /^\s*path:/.test(l.content))
        if (!survivingPath) {
          violations.push(
            `${file}:${removedPath.lineNo}: REMOÇÃO do campo path: do bloco actions/cache (uses: linha ${lineNo}) — o bloco SOBREVIVEU sem path; declare um dos paths da toolchain (ex.: node_modules) do par key↔path`,
          )
        }
      }

      // key removida sem key sobrevivente na janela → bloco sem key
      const removedKey = following.find((l) => l.removed && /^\s*key:/.test(l.content))
      if (removedKey) {
        const survivingKey = following.some((l) => !l.removed && /^\s*key:/.test(l.content))
        if (!survivingKey) {
          violations.push(
            `${file}:${removedKey.lineNo}: REMOÇÃO do campo key: do bloco actions/cache (uses: linha ${lineNo}) — o bloco SOBREVIVEU sem key; adicione de volta a key da toolchain (ex.: bun-${BUN_VERSION_VAR}-...) do par key↔path`,
          )
        }
      }
    }
  }
  return violations
}

/**
 * Checa a migração INCOMPLETA de literais nas linhas de um diff — a
 * regressão OPOSTA à do checkStagedLiterals (que só vê linhas ADICIONADAS):
 * um literal (bun-version: 1.3.14, BUN_VERSION: "1.3.14", bun-1.3.14-...)
 * REMOVIDO pelo diff (linha `-`) — o PR está migrando aquele literal para a
 * fonte única — enquanto OUTRO literal SOBREVIVE na mesma região (linha de
 * contexto ou adicionada, dentro da janela) — a migração ficou pela METADE:
 * o PR tocou a família de literais (removeu um) mas deixou outro para trás.
 *
 * Por que o checkStagedLiterals não basta: ele só avalia linhas ADICIONADAS
 * (+ no diff). Um bun-version literal que SOBREVIVE como CONTEXTO (não foi
 * adicionado pelo PR) escapa dele — e o PR claramente está migrando a região
 * (removeu a key literal ao lado), então o sobrevivente é um ponto esquecido.
 *
 * NÃO reporta quando:
 *   - NENHUM literal foi removido (um literal pré-existente de contexto, sem
 *     atividade de migração na região, não é responsabilidade do PR);
 *   - o literal removido e o sobrevivente estão LONGES (fora da janela
 *     CACHE_BLOCK_WINDOW) — sem evidência de que são a MESMA migração;
 *   - o bloco/step INTEIRO foi removido (sem literal sobrevivente na região).
 *
 * @param {string} diffText  saída de git diff
 * @returns {string[]} lista de violações (vazia = ok)
 */
export function checkStagedRemovedLiterals(diffText) {
  const violations = []
  for (const [file, lines] of parseDiffLines(diffText)) {
    for (let i = 0; i < lines.length; i++) {
      const anchor = lines[i]
      // âncora: literal REMOVIDO pelo diff (linha `-`) — o PR está migrando
      if (!anchor.removed) continue
      if (anchor.content.trim() === "" || anchor.content.trim().startsWith("#")) continue
      if (checkLiteralBunLine(file, anchor.lineNo, anchor.content) === null) continue

      // região (mesma janela do cache block) em AMBAS as direções — um
      // literal SOBREVIVENTE na região = migração incompleta
      const surviving = lines.find(
        (l, j) =>
          j !== i &&
          !l.removed &&
          Math.abs((l.lineNo ?? anchor.lineNo) - anchor.lineNo) <= CACHE_BLOCK_WINDOW &&
          l.content.trim() !== "" &&
          !l.content.trim().startsWith("#") &&
          checkLiteralBunLine(file, l.lineNo ?? anchor.lineNo, l.content) !== null,
      )
      if (!surviving) continue

      violations.push(
        `${file}:${surviving.lineNo}: literal do Bun SOBREVIVE ao lado de literal REMOVIDO (linha ${anchor.lineNo}) — migração incompleta para a fonte única ${BUN_VERSION_VAR}; remova o literal sobrevivente ou migre para a variável`,
      )
    }
  }
  return violations
}

/**
 * Valida que um ref de git passado via --base é um nome de ref SEGURO
 * (charset refname do git + operadores de revisão: letras, dígitos, ., _, /,
 * -, ~ e ^ — ex.: origin/main, HEAD~1, v1.0^2). Proteção contra
 * metacharacters de shell: `~` e `^` são INOCUOS aqui porque o ref só entra
 * numa range de `git diff` via execFileSync (array de args, SEM shell), e a
 * proteção real contra ranges/injeção é o check `..` (ex.: main..other) e o
 * prefixo `-` (ex.: -f). Um valor malicioso como `main; rm -rf /` ou
 * `$(whoami)` falha o charset ANTES de chegar ao git.
 *
 * @param {string} ref
 * @returns {boolean}
 */
export function isValidGitRef(ref) {
  return /^[a-zA-Z0-9][a-zA-Z0-9._/~^-]*$/.test(ref) && !ref.includes("..") && !ref.startsWith("-")
}

/**
 * Roda `git diff --cached` (staged local) ou `git diff <base>...HEAD`
 * (CI — PR vs base) limitado a .github/workflows. Retorna null se git
 * indisponível / sem repositório / ref base inválida (o caller decide o
 * exit code). Usa execFileSync (array de args, SEM shell) — sem risco de
 * injeção a partir do valor de --base.
 *
 * Passa `-U${DIFF_CONTEXT}` para EXPANDIR o contexto do diff além do
 * default de 3 linhas — requisito dos checks de REMOÇÃO com janela (ver
 * DIFF_CONTEXT): um literal/path/input sobrevivente fora do contexto de 3
 * linhas não apareceria no diff e a regressão passaria despercebida.
 *
 * @param {string|null} base  ref base (ex.: "origin/main"); null = staged
 * @returns {string|null} texto do diff ou null (infra failure)
 */
export function gitDiffWorkflows(base) {
  if (base !== null && !isValidGitRef(base)) return null
  // Pathspec de TODAS as forjas: no modo --staged/--base o guard precisa ver o
  // que o PR introduz em qualquer pipeline — limitar ao GitHub foi o que deixou
  // a forja dona do merge sem cobertura de fonte única.
  const args = base
    ? ["diff", `-U${DIFF_CONTEXT}`, `${base}...HEAD`, "--", ...FORGE_WORKFLOW_DIRS]
    : ["diff", `-U${DIFF_CONTEXT}`, "--cached", "--", ...FORGE_WORKFLOW_DIRS]
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
 * Checa UMA linha de um Dockerfile contra versões LITERAIS do Bun — casa
 * `npm install -g bun@1.2`, `FROM oven/bun:1`, `FROM oven/bun:1.3.14` etc.
 * A versão nos Dockerfiles só pode vir do build-arg BUN_VERSION
 * (\${BUN_VERSION}) — um literal cria um segundo ponto de verdade.
 * Retorna a violação ou null.
 *
 * @param {string} file     nome do Dockerfile (ex.: "Dockerfile")
 * @param {number} lineNo   número da linha (1-based)
 * @param {string} content  conteúdo da linha
 * @returns {string|null}
 */
export function checkDockerfileBunLine(file, lineNo, content) {
  if (content.trim().startsWith("#")) return null // ignora comentários
  // Casa bun@<tag>, FROM oven/bun:<tag> E o padrão curl de download
  // (bun-v<tag> — ex.: Dockerfile.ubuntu-bun baixa de
  // .../releases/download/bun-v${BUN_VERSION}/bun-linux-x64.zip) — a tag
  // literal (1.2, 1, 1.3.14, 1-slim) é violação; \${BUN_VERSION} é o padrão
  // correto. O padrão curl só casa versão semântica/dígitos (bun-v1.2,
  // bun-v1.3.14) — nunca \${BUN_VERSION} (não é dígito) nem prosa como
  // 'bun-vendor'.
  const m = content.match(/(?:npm install -g bun@|FROM oven\/bun:)([^\s"'\\]+)/)
  if (!m) {
    const curlM = content.match(/bun-v(\d+(?:\.\d+)*)/)
    if (!curlM) return null
    return `${file}:${lineNo}: versão do Bun '${curlM[1]}' em '${curlM[0].trim()}' é um LITERAL no Dockerfile — use a fonte única via ARG (ex.: 'bun-v\${BUN_VERSION}' na URL de download; o workflow passa --build-arg BUN_VERSION=${BUN_VERSION_VAR})`
  }
  const tag = m[1]
  // Permite a fonte única em TODAS as formas válidas do ARG: \${BUN_VERSION},
  // \${BUN_VERSION}-slim (sufixo — o prefixo exato \${BUN_VERSION} casa),
  // \${BUN_VERSION:-x} (DEFAULT — o prefixo \${BUN_VERSION: casa) e $BUN_VERSION
  // (sem chaves). Prefixos EXPLÍCITOS (não includes): um typo como
  // \${BUN_VERSIONX} é flagrado como literal (includes aceitaria silencioso).
  if (
    tag.startsWith("${BUN_VERSION}") ||
    tag.startsWith("${BUN_VERSION:") ||
    tag.startsWith("$BUN_VERSION")
  )
    return null
  return `${file}:${lineNo}: versão do Bun '${tag}' em '${m[0].trim()}' é um LITERAL no Dockerfile — use a fonte única via ARG (ex.: 'npm install -g bun@\${BUN_VERSION}' ou 'FROM oven/bun:\${BUN_VERSION}'; o workflow passa --build-arg BUN_VERSION=${BUN_VERSION_VAR})`
}

/**
 * Varre TODOS os Dockerfiles da lista DOCKERFILES por versões LITERAIS do
 * Bun (invariante 13) — o padrão correto é ARG BUN_VERSION + \${BUN_VERSION}
 * (como o Dockerfile.ubuntu-bun). Um Dockerfile novo que pinar bun sem
 * entrar na lista escaparia — a lista é explícita de propósito.
 *
 * @param {string} cwd  diretório do repo
 * @returns {string[]} lista de violações (vazia = ok)
 */
export function checkDockerfiles(cwd) {
  const violations = []
  for (const rel of DOCKERFILES) {
    const p = join(cwd, rel)
    if (!existsSync(p)) {
      violations.push(
        `Dockerfile ausente da lista DOCKERFILES: ${rel} (sem ele, um Dockerfile que pinar bun escaparia do guard)`,
      )
      continue
    }
    const lines = readFileSync(p, "utf8").split("\n")
    lines.forEach((l, i) => {
      const v = checkDockerfileBunLine(rel, i + 1, l)
      if (v) violations.push(v)
    })
  }
  return violations
}

/**
 * Verifica que NENHUM lockfile estrangeiro (npm/pnpm) existe no repo
 * (invariante 14) — a unificação em bun.lock é travada: um `npm install`
 * acidental na raiz ou num mini-service regenera o lockfile e o guard falha.
 *
 * @param {string} cwd  diretório do repo
 * @returns {string[]} lista de violações (vazia = ok)
 */
export function checkNoForeignLockfiles(cwd) {
  const violations = []
  for (const rel of FOREIGN_LOCKFILES) {
    if (existsSync(join(cwd, rel))) {
      violations.push(
        `${rel} presente — o repo usa APENAS bun.lock como fonte única de deps; remova o lockfile/config npm/pnpm (um 'npm install'/'pnpm install' acidental o regenera)`,
      )
    }
  }
  return violations
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
      `${actionPath}: tier 3 (cold cache) não referencia o mirror OCI (<registry>/<owner>/bun:<versão>)`,
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
      ...checkStagedRemovedBunVersion(diffText),
      ...checkStagedCachePaths(diffText, DEFAULT_CACHE_KEY_RULES()),
      ...checkStagedRemovedCacheBlockFields(diffText),
      ...checkStagedRemovedLiterals(diffText),
    ]
    if (violations.length > 0) {
      console.error(
        `❌ Diff com ${violations.length} violação(ões) de cache key/literal/call site/remoção de input/remoção de path-key/par key↔path do Bun:\n`,
      )
      for (const v of violations) console.error(`   - ${v}`)
      console.error(
        `\n   Cache keys, literais, call sites e pares key↔path introduzidos por este diff precisam usar a` +
          `\n   fonte única ${BUN_VERSION_VAR} — um literal (bun-1.3.14-...) não seria` +
          `\n   invalidado pela troca da variável, e um path de outra toolchain` +
          `\n   (ex.: node_modules/.prisma com key bun-...) quebraria o cache. E` +
          `\n   REMOVER o input bun-version de um call site que sobreviveu é` +
          `\n   regressão — o action falharia em runtime sem a versão.`,
      )
      process.exit(1)
    }
    console.log(
      `✅ Diff ok — nenhuma cache key/literal/call site/remoção de input/par key↔path do Bun introduzido` +
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

  // Os invariantes globais rodam em TODAS as forjas. As funções puras rotulam
  // a violação com o BASENAME do workflow (contrato já testado); aqui o rótulo
  // é prefixado com o diretório da forja para que o diagnóstico diga em qual
  // pipeline a fonte única foi violada — foi essa ausência que deixou
  // `BUN_VERSION: "1.4.0"` literal viver na pipeline dona do merge.
  for (const dir of existingWorkflowDirs(cwd)) {
    const workflowsDir = join(cwd, dir)
    const names = workflowFileNames(cwd, dir)
    const label = (v) => {
      for (const n of names) if (v.startsWith(`${n}:`)) return `${dir}/${v}`
      return v
    }
    violations.push(...checkCacheKeys(workflowsDir, DEFAULT_CACHE_KEY_RULES()).map(label))
    violations.push(...checkCachePaths(workflowsDir, DEFAULT_CACHE_KEY_RULES()).map(label))
    violations.push(...checkNoLiteralBunVersion(workflowsDir).map(label))
    violations.push(...checkSetupBunCallSites(workflowsDir).map(label))
  }
  violations.push(...checkActrc(join(cwd, ".actrc")))
  violations.push(...checkDockerfiles(cwd))
  violations.push(...checkNoForeignLockfiles(cwd))

  if (violations.length > 0) {
    console.error(`❌ Fonte única do Bun com ${violations.length} violação(ões):\n`)
    for (const v of violations) console.error(`   - ${v}`)
    console.error(
      `\n   A versão do Bun vive APENAS na repository variable vars.BUN_VERSION` +
        `\n   (Settings → Secrets and variables → Actions). Workflows passam` +
        `\n   'bun-version: ${BUN_VERSION_VAR}', o mirror usa a mesma variável e` +
        `\n   o action resolve em runtime. Sem literais em lugar nenhum — trocar` +
        `\n   o Bun = alterar a variável em UM lugar. E o par key↔path de cada` +
        `\n   bloco actions/cache precisa fechar (path da toolchain correta).`,
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
