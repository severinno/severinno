#!/usr/bin/env node

// =============================================================================
// check-registry-source.mjs
//
// Guard da FONTE ÚNICA do registry OCI (imagens da aplicacao + mirrors de
// toolchain: bun, ubuntu-bun, postgis).
//
// POR QUE: as imagens eram referenciadas com o host HARDCODED (`ghcr.io/...`)
// em compose, workflows e no composite action do Bun. Isso acoplava o projeto
// ao GHCR — registry proprietario, com cota de armazenamento/egress no plano
// free — e transformava "trocar de registry" numa cacada em ~85 referencias.
// A fonte unica agora e `IMAGE_REGISTRY`:
//   - workflows (GitHub/Gitea): repository variable, `${{ vars.IMAGE_REGISTRY }}`
//   - compose (VPS):            `${IMAGE_REGISTRY:-ghcr.io}` do .env.production
//   - act local:                `--var IMAGE_REGISTRY=...` no .actrc
//   - Woodpecker:               secret `image_registry`
//
// REGRA: `ghcr.io` so pode aparecer como DEFAULT de IMAGE_REGISTRY — isto e,
// na mesma linha da variavel. Qualquer `ghcr.io` solto e regressao: volta a
// fixar o projeto no GHCR e quebra o flip de uma variavel.
//
// Invariantes:
//   1. Nenhum `ghcr.io` fora da forma de default da variavel (compose,
//      workflows, composite actions, woodpecker, setup scripts).
//   2. Imagens de TERCEIROS consumidas do GHCR vivem em
//      THIRD_PARTY_ALLOWLIST (explicitamente, uma por uma).
//   3. O .actrc define `--var IMAGE_REGISTRY=...` (espelho local do act — o
//      act nao le as variables do repositorio sem --var).
//   4. Todo `image:` de compose cujo path e nosso referencia `${IMAGE_REGISTRY`.
//   5. COMENTARIO (linha inteira e inline) e ignorado: e onde a documentacao
//      explica o default. O guard protege o codigo que resolve o registry,
//      nao a prosa — um guard que reclamasse da propria documentacao da
//      invariante seria desligado pela equipe.
//
// Usage:
//   node scripts/check-registry-source.mjs
//
// Exit codes:
//   0 — fonte unica respeitada
//   1 — referencia hardcoded, espelho local ausente ou compose sem a variavel
// =============================================================================

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"

import { FORGE_ACTIONS_DIRS, FORGE_WORKFLOW_DIRS } from "./forge-workflows.mjs"

const ROOT = process.cwd()

/**
 * Imagens de TERCEIROS que consumimos do GHCR de proposito. Cada entrada e um
 * prefixo de repositorio (sem tag). Adicionar aqui e uma decisao consciente:
 * significa "esta imagem nao e nossa e nao segue o IMAGE_REGISTRY".
 */
export const THIRD_PARTY_ALLOWLIST = [
  // OSRM (roteamento) — imagem comunitaria, sem espelho proprio.
  "ghcr.io/project-osrm/osrm-backend",
]

/**
 * Alvos varridos: os SITES DE RESOLUCAO do registry (onde o host e escolhido e
 * o deploy/imagem nasce). Sao todos YAML, onde comentario e inequivoco
 * (linha iniciada por `#`) — por isso o guard consegue ignorar prosa sem
 * falso positivo.
 *
 * Escopo CONSCIENTE: `scripts/*.mjs` ficam FORA. Neles a mesma string aparece
 * dentro de comentarios E de template strings de mensagem de erro ("imagem
 * ghcr.io/<owner>/ubuntu-bun nao publicada?"), e distinguir prosa de codigo
 * linha a linha exige heuristica — um guard com falso positivo e desligado
 * pela equipe, o que e pior que um guard com escopo declarado. O caminho de
 * CODIGO real dos scripts honra `process.env.IMAGE_REGISTRY` (ver
 * bench-setup-bun.mjs) e o que resolve o host para o deploy/pull esta aqui.
 */
export const SCAN_TARGETS = [
  { dir: ".", match: /^docker-compose.*\.ya?ml$/ },
  // Uma entrada por FORJA, vindas da fonte unica (scripts/forge-workflows.mjs)
  // — cravar os diretorios aqui deixaria a forja DONA DO MERGE fora da
  // varredura sem que nada acusasse.
  ...FORGE_WORKFLOW_DIRS.map((dir) => ({ dir, match: /\.ya?ml$/ })),
  { dir: FORGE_ACTIONS_DIRS[0], match: /^action\.ya?ml$/, recursive: true },
  { dir: ".woodpecker.yml", match: /.*/ },
]

/**
 * Uma linha e comentario quando seu conteudo (trim) comeca com `#`. Linhas
 * comentadas sao ignoradas: e onde a documentacao explica o default do
 * registry, e um guard que reclamasse de prosa bloquearia a propria
 * documentacao da invariante.
 *
 * @param {string} line
 * @returns {boolean}
 */
export function isCommentLine(line) {
  return line.trim().startsWith("#")
}

/**
 * Remove comentario INLINE de YAML (`key: valor # prosa`) — em YAML o `#` so
 * inicia comentario precedido de espaco (ou no inicio da linha). Sem isso, uma
 * anotacao como `packages: read # pull da imagem privada ghcr.io/<owner>/...`
 * seria lida como referencia de codigo (foi exatamente o caso real que este
 * guard encontrou).
 *
 * @param {string} line
 * @returns {string} a linha sem a parte comentada
 */
export function stripInlineComment(line) {
  return line.replace(/(^|\s)#.*$/, "$1").trimEnd()
}

/**
 * A linha usa o registry pela variavel (default embutido)? As duas formas
 * canonicas contem `IMAGE_REGISTRY` e `ghcr.io` na MESMA linha:
 *   `${{ vars.IMAGE_REGISTRY || 'ghcr.io' }}`   (workflows)
 *   `${IMAGE_REGISTRY:-ghcr.io}`                (compose / shell)
 * Uma linha sem `IMAGE_REGISTRY` que cite `ghcr.io` esta fixando o registry.
 *
 * @param {string} line
 * @returns {boolean}
 */
export function isRegistryVariableForm(line) {
  return /IMAGE_REGISTRY/.test(line)
}

/**
 * A referencia `ghcr.io/...` da linha esta na allowlist de terceiros?
 *
 * @param {string} line
 * @returns {boolean}
 */
export function isAllowlistedThirdParty(line) {
  return THIRD_PARTY_ALLOWLIST.some((prefix) => line.includes(prefix))
}

/**
 * Valida UMA linha quanto a invariante 1/2 (nenhum `ghcr.io` hardcoded).
 * Retorna a mensagem de violacao, ou null quando a linha esta correta.
 *
 * @param {string} file   caminho relativo (para a mensagem)
 * @param {number} lineNo 1-indexado
 * @param {string} line
 * @returns {string|null}
 */
export function checkRegistryLine(file, lineNo, line) {
  if (isCommentLine(line)) return null
  const code = stripInlineComment(line)
  if (!code.includes("ghcr.io")) return null
  if (isRegistryVariableForm(code)) return null
  if (isAllowlistedThirdParty(code)) return null
  return `${file}:${lineNo}: 'ghcr.io' hardcoded — use a fonte unica IMAGE_REGISTRY (compose: \`\${IMAGE_REGISTRY:-ghcr.io}\`; workflow: \`\${{ vars.IMAGE_REGISTRY || 'ghcr.io' }}\`). Se for uma imagem de TERCEIROS consumida do GHCR de proposito, adicione ao THIRD_PARTY_ALLOWLIST deste guard.`
}

/**
 * Invariante 4: todo `image:` de compose cujo path e o NOSSO precisa vir da
 * variavel. Pega o caso em que alguem mantem o caminho mas troca o host por
 * outro literal (`quay.io/severinno/...`, `git.severinno.cloud` cravado).
 *
 * @param {string} file
 * @param {number} lineNo
 * @param {string} line
 * @returns {string|null}
 */
export function checkComposeImageLine(file, lineNo, line) {
  if (!/^\s*image:\s*\S/.test(line)) return null
  if (!/\/severinno\//.test(line) && !/\$\{IMAGE_NAMESPACE/.test(line)) return null
  if (line.includes("${IMAGE_REGISTRY")) return null
  return `${file}:${lineNo}: imagem nossa sem IMAGE_REGISTRY — use \`\${IMAGE_REGISTRY:-ghcr.io}/\${IMAGE_NAMESPACE:-severinno}/...\` (trocar de registry deve ser UMA variavel, nao uma cacada).`
}

/**
 * Invariante 3: o `.actrc` precisa espelhar a variavel (o act nao le as
 * variables do repositorio sem `--var`). Sem a linha, o act local resolve a
 * variavel como string vazia e para de exercitar o caminho do registry.
 *
 * @param {string} content
 * @returns {string|null}
 */
export function checkActrc(content) {
  for (const line of content.split(/\r?\n/)) {
    if (isCommentLine(line)) continue
    if (/^--var\s+IMAGE_REGISTRY\s*=\s*\S/.test(line.trim())) return null
  }
  return ".actrc: falta `--var IMAGE_REGISTRY=<host>` — o espelho local do act precisa da variavel (o act nao le as variables do repositorio sem --var)"
}

/**
 * Coleta os arquivos a varrer. Arquivo ausente e silenciosamente ignorado (o
 * repo pode nao ter `.gitea/` em alguns checkouts) — a ausencia de um alvo nao
 * e uma violacao.
 *
 * @returns {string[]} caminhos relativos a raiz
 */
export function collectFiles(root = ROOT) {
  const files = []
  for (const target of SCAN_TARGETS) {
    const full = join(root, target.dir)
    if (!existsSync(full)) continue
    const st = statSync(full)
    if (st.isFile()) {
      files.push(relative(root, full))
      continue
    }
    if (!st.isDirectory()) continue
    if (target.recursive) {
      for (const entry of readdirSync(full)) {
        const sub = join(full, entry)
        if (!statSync(sub).isDirectory()) continue
        for (const inner of readdirSync(sub)) {
          if (target.match.test(inner)) files.push(relative(root, join(sub, inner)))
        }
      }
      continue
    }
    for (const entry of readdirSync(full)) {
      if (!target.match.test(entry)) continue
      if (!statSync(join(full, entry)).isFile()) continue
      files.push(relative(root, join(full, entry)))
    }
  }
  return files
}

/**
 * Varre tudo e devolve a lista de violacoes. Pura (recebe root e a lista de
 * arquivos) para poder ser testada com uma arvore temporaria.
 *
 * @param {string} root
 * @returns {string[]}
 */
export function findViolations(root = ROOT) {
  const violations = []
  for (const file of collectFiles(root)) {
    const isCompose = /^docker-compose.*\.ya?ml$/.test(file)
    const lines = readFileSync(join(root, file), "utf8").split(/\r?\n/)
    lines.forEach((line, idx) => {
      const hardcoded = checkRegistryLine(file, idx + 1, line)
      if (hardcoded) violations.push(hardcoded)
      if (isCompose) {
        const compose = checkComposeImageLine(file, idx + 1, line)
        if (compose) violations.push(compose)
      }
    })
  }

  const actrc = join(root, ".actrc")
  if (existsSync(actrc)) {
    const v = checkActrc(readFileSync(actrc, "utf8"))
    if (v) violations.push(v)
  }
  return violations
}

// ── modo CLI (so quando invocado diretamente, nao quando importado) ────────
const isMain =
  !!process.argv[1] && process.argv[1].split(/[\\/]/).pop() === "check-registry-source.mjs"

if (isMain) {
  const violations = findViolations()
  if (violations.length === 0) {
    console.log("check-registry-source: ✅ registry com fonte unica (IMAGE_REGISTRY).")
    process.exit(0)
  }
  console.error("check-registry-source: ❌ registry fixado fora da fonte unica:")
  for (const v of violations) console.error(`  - ${v}`)
  console.error(
    `\n${violations.length} violacao(oes). A fonte unica e IMAGE_REGISTRY (repo variable + .env.production + .actrc).`,
  )
  process.exit(1)
}
