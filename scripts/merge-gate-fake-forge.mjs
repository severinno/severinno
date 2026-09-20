#!/usr/bin/env node
// =============================================================================
// merge-gate-fake-forge.mjs — a FORJA DUBLADA da prova do merge gate
// =============================================================================
//
// Usage:
//   node scripts/merge-gate-fake-forge.mjs --fixture <dir> [--registro <knob>]
//
//   --fixture <dir>    checkout SINTÉTICO com `ci/required-checks.json` e o
//                      workflow que ele aponta (o manifesto é a fonte dos
//                      contextos, como na prova de verdade)
//   --registro <knob>  o que a proteção REGISTRA, derivado dos contextos do
//                      manifesto: `limpo` (default) · `menos` · `mais` ·
//                      `contagem` · `menos+mais` · `contagem+menos`
//
// Exit codes:
//   0 — o motor da prova rodou e o veredito saiu (JSON no stdout)
//   1 — a fixture não resolve contexto nenhum, ou o motor não devolveu veredito
//   2 — uso inválido (flag desconhecida / fixture ausente)
//
// POR QUE ESTE ARQUIVO EXISTE
//
// A prova do merge gate (`prove-gitea-merge-gate.mjs`) mede a régua do REGISTRO
// da proteção — contexto a MENOS, a MAIS e CONTAGEM no nome. Ela roda contra um
// Gitea efêmero (docker), o que a torna caríssima para a prova por mutação: o
// que precisa ser medido não é o transporte, é o QUE O VEREDITO DIZ quando o
// registro não bate. Aqui o transporte é dublado (docker, o CLI do Gitea e a API
// HTTP) e o MOTOR é o de verdade — `proveGiteaMergeGate` com as suas costuras
// injetáveis, o mesmo caminho de código que o cron executa.
//
// O QUE ESTE DUBLÊ NÃO É: uma segunda implementação da prova. Ele não decide
// nada da régua — só responde à API como um Gitea 1.22 (inclusive a REGRA de
// merge: exige status `success` de TODOS os contextos registrados e bloqueia só
// com `enable_status_check` ligado) e deixa o motor julgar.
//
// LIMITE DECLARADO: o dublê cobre as rotas que a prova usa. Um caminho novo na
// prova cai no 404 `nao mapeado` e o veredito sai diferente — o desvio é
// VISÍVEL (o mutation test mede o veredito), nunca um verde por acaso.
// =============================================================================

import process from "node:process"
import { pathToFileURL } from "node:url"
import { defaultIo, loadManifest, resolveManifestContexts } from "./check-required-checks.mjs"
import { proveGiteaMergeGate } from "./prove-gitea-merge-gate.mjs"

export const USAGE = `merge-gate-fake-forge — roda o motor da prova do merge gate contra uma forja dublada

  node scripts/merge-gate-fake-forge.mjs --fixture <dir> [--registro <knob>]

  --fixture <dir>    checkout sintético (com ci/required-checks.json)
  --registro <knob>  limpo | menos | mais | contagem | menos+mais | contagem+menos
  -h, --help         esta ajuda

Exit codes: 0 mediu · 1 fixture/motor · 2 uso inválido`

/**
 * O que a proteção registra, a partir dos contextos que o MANIFESTO do fixture
 * declara. Os knobs são as três classes da régua (a menos, a mais, contagem) e
 * as duas COMBINAÇÕES que a prova cirúrgica precisa (uma metade mutada, a outra
 * ainda no relatório).
 *
 * @param {string[]} esperados
 * @param {string} knob
 * @returns {string[]}
 */
export function registroDoKnob(esperados, knob) {
  const sem = (c) => c !== "Tests"
  const comContagem = (c) => (c === "Lint" ? "Lint (3 checks)" : c)
  switch (knob) {
    case "menos":
      return esperados.filter(sem)
    case "mais":
      return [...esperados, "Guard que sumiu"]
    case "contagem":
      return esperados.map(comContagem)
    case "menos+mais":
      return [...esperados.filter(sem), "Guard que sumiu"]
    case "contagem+menos":
      return esperados.filter(sem).map(comContagem)
    default:
      return esperados
  }
}

/**
 * A forja dublada: o estado (contextos registrados + status por commit) e a
 * REGRA de merge do Gitea. A mutação `disable-enforcement` da matriz desliga o
 * booleano — é ele que separa "a lista está anotada" de "a lista bloqueia".
 */
export function fakeForge(registrado) {
  const REPO = "prova/ensaio"
  const estado = { enforced: true, contexts: registrado, statuses: new Map(), prs: 0 }
  const json = (status, data) => ({ status, data, text: JSON.stringify(data) })
  const request = async ({ method, path, body }) => {
    if (path === "/version") return json(200, { version: "1.22.6" })
    if (path === "/user/repos") return json(201, { name: "ensaio" })
    if (path === `/repos/${REPO}/branch_protections`) {
      if (method === "GET")
        return json(200, [
          {
            branch_name: "main",
            status_check_contexts: estado.contexts,
            enable_status_check: estado.enforced,
          },
        ])
      estado.enforced = body?.enable_status_check === true
      estado.contexts = body?.status_check_contexts ?? estado.contexts
      return json(201, { enable_status_check: estado.enforced })
    }
    if (path === `/repos/${REPO}/branch_protections/main`) {
      estado.enforced = body?.enable_status_check === true
      if (body?.status_check_contexts) estado.contexts = body.status_check_contexts
      return json(200, { enable_status_check: estado.enforced })
    }
    if (path === `/repos/${REPO}/branches`) return json(201, {})
    if (path.startsWith(`/repos/${REPO}/contents/`)) return json(201, {})
    if (path === `/repos/${REPO}/pulls` && method === "POST") {
      estado.prs += 1
      estado.statuses.set(`sha-${estado.prs}`, new Map())
      return json(201, { number: estado.prs, head: { sha: `sha-${estado.prs}` } })
    }
    const pull = /^\/repos\/[^/]+\/[^/]+\/pulls\/(\d+)$/.exec(path)
    if (pull && method === "GET") return json(200, { mergeable: true })
    const merge = /^\/repos\/[^/]+\/[^/]+\/pulls\/(\d+)\/merge$/.exec(path)
    if (merge) {
      const postados = estado.statuses.get(`sha-${merge[1]}`) ?? new Map()
      const incompletos = estado.contexts.filter((c) => postados.get(c) !== "success")
      if (estado.enforced && incompletos.length > 0)
        return json(405, {
          message: "not allowed to merge [reason: Not all required status checks successful]",
        })
      return json(200, { merged: true })
    }
    const status = /^\/repos\/[^/]+\/[^/]+\/statuses\/(.+)$/.exec(path)
    if (status) {
      estado.statuses.get(status[1])?.set(body.context, body.state)
      return json(201, {})
    }
    return json(404, { message: `nao mapeado: ${method} ${path}` })
  }
  return { request, estado }
}

/** O docker e o APLIADOR dublados (o applier é o efeito: o estado da forja). */
export function fakeDocker(estado) {
  const run = () => ({ status: 0, stdout: "container-id\n", stderr: "" })
  const spawn = (_cmd, args) => {
    if (args[0] === "exec" && args.includes("generate-access-token"))
      return {
        status: 0,
        stdout: `Access token was successfully created: ${"a".repeat(40)}\n`,
        stderr: "",
      }
    if (args[0] === "exec") return { status: 0, stdout: "New user created\n", stderr: "" }
    if (args.some((a) => String(a).endsWith("apply-required-checks.mjs"))) {
      if (args.includes("--apply")) return { status: 0, stdout: "aplicado\n", stderr: "" }
      // O `--check` do applier ACUSA quando a exigência está desligada — é a
      // metade que a prova mede depois da mutação `disable-enforcement`.
      return estado.enforced === true
        ? { status: 0, stdout: "em sincronia\n", stderr: "" }
        : {
            status: 1,
            stdout:
              "! enable_status_check=false — os contextos estão registrados e NÃO bloqueiam\n",
            stderr: "",
          }
    }
    return { status: 1, stdout: "", stderr: "inesperado" }
  }
  return { run, spawn }
}

export function parseArgs(argv) {
  const opts = { fixture: null, registro: "limpo", help: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "-h" || arg === "--help") opts.help = true
    else if (arg === "--fixture" || arg === "--registro") {
      const value = argv[++i]
      if (!value) return { error: `${arg} exige um valor` }
      if (arg === "--fixture") opts.fixture = value
      else opts.registro = value
    } else if (arg.startsWith("-")) return { error: `flag desconhecida: ${arg}` }
    else return { error: `argumento inesperado: ${arg}` }
  }
  if (!opts.help && !opts.fixture) return { error: "--fixture é obrigatório" }
  return opts
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.error) {
    console.error(`merge-gate-fake-forge: ${opts.error}`)
    console.error(USAGE)
    process.exit(2)
  }
  if (opts.help) {
    console.log(USAGE)
    process.exit(0)
  }

  const io = defaultIo(opts.fixture)
  const esperados = resolveManifestContexts(
    loadManifest(opts.fixture, io),
    io,
  ).gitea?.contexts?.map((c) => c.context)
  if (!esperados || esperados.length === 0) {
    console.error(`❌ fixture sem contexto nenhum para o gitea: ${opts.fixture}`)
    process.exit(1)
  }

  const forge = fakeForge(registroDoKnob(esperados, opts.registro))
  const { run, spawn } = fakeDocker(forge.estado)
  const result = await proveGiteaMergeGate({
    cwd: opts.fixture,
    run,
    spawn,
    request: forge.request,
    sleepMs: () => Promise.resolve(),
    timeoutS: 4,
    keep: true,
    port: 1,
  })
  if (!result?.verdict) {
    console.error("❌ o motor da prova não devolveu veredito")
    process.exit(1)
  }
  console.log(
    JSON.stringify({
      verdict: result.verdict,
      blockers: result.blockers,
      registration: result.registration,
      contexts: result.contexts,
      cases: result.cases.map((c) => [c.id, c.outcome?.state ?? null]),
    }),
  )
  process.exit(0)
}

const IS_DIRECT_RUN =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (IS_DIRECT_RUN) await main()
