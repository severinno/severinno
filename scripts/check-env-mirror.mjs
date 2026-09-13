#!/usr/bin/env node
// =============================================================================
// check-env-mirror.mjs
//
// Usage:
//   node scripts/check-env-mirror.mjs                       # descobre host e template no checkout
//   node scripts/check-env-mirror.mjs --host deploy/.env.gitea
//   node scripts/check-env-mirror.mjs --host <env do VPS> --template deploy/env.gitea.example
//   node scripts/check-env-mirror.mjs --json
//
// Exit codes:
//   0 — em SINCRONIA: o env do host espelha o template comitado
//   1 — DIVERGE (ou nao havia o que comparar): subir a stack interpolaria outra
//       coisa que o repositorio declara (imagem, versao, segredo)
//   2 — uso invalido (flag desconhecida, --host/--template sem valor)
//
// POR QUE EXISTE
//
// O guard `check:registry-source` (invariante 7b) ja compara o env do HOST
// (`deploy/.env.gitea`, no VPS) com o template comitado
// (`deploy/env.gitea.example`) — mas ele e um gate de CI: quem sobe a stack com
// `deploy/gitea-up.sh` tinha de LEMBRAR de roda-lo. Este comando e a mesma regra
// num passo que o bring-up executa sozinho, para o pre-requisito ser mecanico.
//
// E a mesma comparacao, nao uma segunda: as funcoes vem do
// `check-registry-source.mjs` (`parseEnvAssignments`, `composeEnvVariables`,
// `compareEnvMirrorDeclarations`), que continua sendo a fonte unica da regra —
// inclusive a ASSIMETRIA dos segredos (numa variavel comum DIVERGIR e o defeito;
// num segredo, IGUALAR e o defeito, porque o template e comitado e o host tem o
// valor real).
//
// POR QUE ANTES DA GARANTIA DA IMAGEM (a ordem importa)
//
// O `ensure-runner-image.mjs` resolve IMAGE_REGISTRY/IMAGE_NAMESPACE/BUN_VERSION
// DESTE arquivo para decidir qual tag garantir. Com um env divergente ele
// garantiria a imagem ERRADA — e a stack subiria apontando para ela. Conferir o
// espelho primeiro faz a subida recusar ANTES de resolver a imagem errada.
//
// POR QUE NAO E UM GATE DE CI PROPRIO
//
// Ele nao prova nada sobre o repositorio em si (isso e o `check:registry-source`)
// nem sobre a imagem (isso e o `ensure-runner-image`): ele responde "ESTE arquivo
// do host e o que o repositorio declara?" — uma pergunta que so existe onde a
// stack roda, e cuja resposta tem de ser dada no momento de subir. Por isso o
// unico chamador e o `deploy/gitea-up.sh`.
//
// O que NAO cobre: o valor RENDERIZADO do compose (variavel que nao vem de
// nenhum arquivo, literal no compose) e o RENDER com docker — esses ficam com o
// `check:registry-source`, que precisa do plugin `compose`. Aqui e comparacao de
// ARQUIVOS: roda em qualquer host, inclusive sem docker.
// =============================================================================

import { existsSync, readFileSync } from "node:fs"
import { isAbsolute, join } from "node:path"
import process from "node:process"
import { pathToFileURL } from "node:url"

import { GITEA_ENV_DEPLOYED, discoverEnvMirrors } from "./check-actrc-sync.mjs"
import { GITEA_COMPOSE, GITEA_ENV_MIRROR } from "./check-bun-mirror.mjs"
import {
  compareEnvMirrorDeclarations,
  composeEnvVariables,
  parseEnvAssignments,
} from "./check-registry-source.mjs"

/** A raiz do checkout — o processo roda da raiz do repositorio. */
export const ROOT = process.cwd()

/** Exit codes — o contrato da CLI. */
export const EXIT = { OK: 0, DIVERGED: 1, USAGE: 2 }

/** O script do bring-up que consome este comando (o unico chamador). */
export const BRING_UP = "deploy/gitea-up.sh"

/**
 * O veredito da comparacao.
 *
 * @typedef {{state: "in-sync"|"diverged"|"absent", violations: string[], consumed: string[], host: string|null, template: string|null, detail: string}} MirrorResult
 */

/**
 * Uma comparacao pura: dois conteudos de env + o compose que diz QUAIS nomes
 * importam. Sem filesystem e sem docker — e o que o teste exercita.
 *
 * @param {{templateContent: string, hostContent: string, composeContent: string, templateLabel: string, hostLabel: string}} args
 * @returns {{violations: string[], consumed: string[]}}
 */
export function compareMirrors({
  templateContent,
  hostContent,
  composeContent,
  templateLabel,
  hostLabel,
}) {
  const consumed = composeEnvVariables(composeContent)
  const violations = compareEnvMirrorDeclarations({
    template: parseEnvAssignments(templateContent),
    host: parseEnvAssignments(hostContent),
    templateLabel,
    hostLabel,
    consumed,
  })
  return { violations, consumed }
}

/**
 * O caminho absoluto de um env apontado por flag, com o label para a mensagem.
 * `null` quando o arquivo nao existe — o CLI decide se a ausencia e erro de uso
 * (a flag foi dada e aponta para o nada) ou apenas "nao aplicavel".
 *
 * @param {string} cwd
 * @param {string} path
 * @returns {{path: string, label: string}|null}
 */
function at(cwd, path) {
  const full = isAbsolute(path) ? path : join(cwd, path)
  return existsSync(full) ? { path: full, label: path } : null
}

/**
 * A comparacao completa: resolve os dois lados (flags primeiro, descoberta
 * depois) e aplica a regra. Nao decide exit code — devolve o estado.
 *
 * `absent` NAO e "conforme": e "nao havia o que comparar". O bring-up trata os
 * dois como recusa (ele exige a comparacao); um relatorio solto pode querer
 * distinguir — por isso o estado existe em vez de um booleano.
 *
 * @param {{cwd?: string, host?: string|null, template?: string|null, read?: (p: string) => string, exists?: (p: string) => boolean}} [args]
 * @returns {MirrorResult}
 */
export function checkEnvMirror({
  cwd = ROOT,
  host = null,
  template = null,
  read = (p) => readFileSync(p, "utf8"),
  exists = existsSync,
} = {}) {
  // O template: a flag EXPLICITA primeiro; senao o comitado. Uma flag que aponta
  // para o nada nao vira o template comitado em silencio (isso faria a
  // comparacao medir outro arquivo sem avisar) — o CLI recusa antes de chegar aqui.
  const templateSide = template
    ? at(cwd, template)
    : exists(join(cwd, GITEA_ENV_MIRROR))
      ? { path: join(cwd, GITEA_ENV_MIRROR), label: GITEA_ENV_MIRROR }
      : null
  // O host: a flag explicita primeiro; senao os espelhos do HOST descobertos
  // (gitignored — existem so onde a stack roda).
  const hostSide = host ? at(cwd, host) : (discoverEnvMirrors(cwd).find((m) => m.deployed) ?? null)

  if (!templateSide || !hostSide) {
    const missing = [
      !templateSide ? `o template (${template ?? GITEA_ENV_MIRROR})` : null,
      !hostSide ? `o env do host (${host ?? GITEA_ENV_DEPLOYED.join(", ")})` : null,
    ].filter(Boolean)
    return {
      state: "absent",
      violations: [],
      consumed: [],
      host: hostSide?.label ?? null,
      template: templateSide?.label ?? null,
      detail: `nao havia o que comparar: ${missing.join(" e ")} nao existe(m) — a subida exige a comparacao, nao a presume`,
    }
  }

  const { violations, consumed } = compareMirrors({
    templateContent: read(templateSide.path),
    hostContent: read(hostSide.path),
    composeContent: read(join(cwd, GITEA_COMPOSE)),
    templateLabel: templateSide.label,
    hostLabel: hostSide.label,
  })

  return {
    state: violations.length > 0 ? "diverged" : "in-sync",
    violations,
    consumed,
    host: hostSide.label,
    template: templateSide.label,
    detail:
      violations.length > 0
        ? `${violations.length} divergencia(s) entre o env do HOST (${hostSide.label}) e o template comitado (${templateSide.label})`
        : `host x template em sincronia: ${consumed.length} variavel(is) que o compose consome conferidas (${hostSide.label} x ${templateSide.label})`,
  }
}

export const USAGE = `check-env-mirror — o env do HOST espelha o template comitado?

  node scripts/check-env-mirror.mjs [opcoes]

  --host <caminho>       o env do HOST (default: descoberto — ${GITEA_ENV_DEPLOYED.join(", ")})
  --template <caminho>   o template comitado (default: ${GITEA_ENV_MIRROR})
  --json                 imprime o resultado em JSON
  -h, --help             esta ajuda

Exit codes: 0 em sincronia · 1 diverge (ou nao havia o que comparar) · 2 uso invalido`

/**
 * O uso dos argumentos — puro, para o teste exercitar o contrato da CLI.
 *
 * @param {string[]} argv
 * @returns {{error?: string, help?: boolean, json?: boolean, host?: string|null, template?: string|null}}
 */
export function parseArgs(argv) {
  const opts = { json: false, help: false, host: null, template: null }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--json") opts.json = true
    else if (arg === "-h" || arg === "--help") opts.help = true
    else if (arg === "--host" || arg === "--template") {
      const value = argv[i + 1]
      if (!value) return { error: `${arg} exige um caminho` }
      i += 1
      if (arg === "--host") opts.host = value
      else opts.template = value
    } else return { error: `flag desconhecida: ${arg}` }
  }
  return opts
}

/** O relatorio humano — os dois lados, as variaveis e cada divergencia. */
export function renderReport(result, { emit = console.log } = {}) {
  const line = (s = "") => emit(s)
  line()
  line("check-env-mirror — o env do host espelha o template comitado?")
  line(`  host     : ${result.host ?? "<nao encontrado>"}`)
  line(`  template : ${result.template ?? "<nao encontrado>"}`)
  if (result.state !== "absent") {
    line(`  conferido: ${result.consumed.join(", ")}`)
  }
  line()
  if (result.state === "in-sync") {
    line(`  ✅ EM SINCRONIA: ${result.detail}`)
  } else {
    for (const v of result.violations) line(`  ❌ ${v}`)
    line(
      `  ${result.state === "absent" ? "·" : "❌"} ${result.state === "absent" ? "NAO APLICAVEL" : "DIVERGE"}: ${result.detail}`,
    )
  }
  line()
  line("  A regra e a mesma do `check:registry-source` (invariante 7b) — aqui ela roda")
  line("  no momento de subir a stack, para o pre-requisito nao depender de alguem lembrar.")
  line()
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.error) {
    console.error(`check-env-mirror: ${opts.error}`)
    console.error(USAGE)
    process.exit(EXIT.USAGE)
  }
  if (opts.help) {
    console.log(USAGE)
    process.exit(EXIT.OK)
  }
  // A flag EXPLICITA apontando para o nada e erro de uso (pergunta explicita):
  // comparar outro arquivo em silencio seria medir o que ninguem pediu.
  for (const [flag, value] of [
    ["--host", opts.host],
    ["--template", opts.template],
  ]) {
    if (value && !existsSync(isAbsolute(value) ? value : join(process.cwd(), value))) {
      console.error(`check-env-mirror: ${flag} aponta para um arquivo inexistente: ${value}`)
      console.error(USAGE)
      process.exit(EXIT.USAGE)
    }
  }

  const result = checkEnvMirror({ host: opts.host, template: opts.template })
  if (opts.json) {
    console.log(JSON.stringify(result, null, 2))
  } else {
    renderReport(result)
  }
  // `absent` sai 1 pelo MESMO motivo de `diverged`: quem chamou pediu a garantia
  // do espelho (o bring-up), e "nao havia o que comparar" nao e a garantia.
  process.exit(result.state === "in-sync" ? EXIT.OK : EXIT.DIVERGED)
}

const IS_DIRECT_RUN =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (IS_DIRECT_RUN) await main()
