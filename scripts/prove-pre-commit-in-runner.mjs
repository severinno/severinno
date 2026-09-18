#!/usr/bin/env node

// =============================================================================
// prove-pre-commit-in-runner.mjs
//
// A prova do bloqueio do PRE-COMMIT executada DENTRO do runtime do CI — a
// imagem do runner — e não na máquina de quem commita.
//
// Usage:
//   node scripts/prove-pre-commit-in-runner.mjs                # escolhe o LUGAR (ver abaixo)
//   node scripts/prove-pre-commit-in-runner.mjs --in-image     # modo INTERNO: roda AQUI (é o que o container executa)
//   node scripts/prove-pre-commit-in-runner.mjs --image <ref>  # sobrepõe a ref (default: derivada de IMAGE_* + BUN_VERSION)
//   node scripts/prove-pre-commit-in-runner.mjs --docker <cli> # cliente docker (default: docker)
//   node scripts/prove-pre-commit-in-runner.mjs --root <dir>   # raiz do checkout (default: a do script)
//   node scripts/prove-pre-commit-in-runner.mjs --json         # saída estruturada
//   node scripts/prove-pre-commit-in-runner.mjs -h
//
// Exit codes:
//   0 — PROVADO: um `git commit` de verdade invocou o hook REAL do checkout,
//       que RECUSOU o corpo `run:` quebrado no índice (zero objetos de commit) e
//       ACEITOU o mesmo commit com o corpo fechado (o CONTROLE) — medido dentro
//       do runtime do CI
//   1 — VIOLADO: o defeito ENTROU (objeto de commit criado / corpo quebrado em
//       HEAD): o hook deixou passar, e o commit de quem confia nele já existe
//   2 — INDETERMINADO: não deu para provar ONDE importa — sem docker E sem estar
//       dentro da imagem, imagem ausente/ilegível, marcadores do runtime
//       ausentes, ou a prova indisponível (falta o fecho do guard, sem
//       node_modules, sem git/bash). Ausência de prova NUNCA vira "está certo"
//   3 — uso inválido
//
// POR QUE ISTO EXISTE (a diferença entre "o hook bloqueia" e "o hook bloqueia
// também quando quem executa é o CI")
//
// O `forge-doctor` já publica o fato do bloqueio do pre-commit, e ele EXECUTA a
// prova de verdade (`proveCommitBlocks`, de `./pre-commit-proof.mjs`) — mas ele
// roda onde o doctor roda: na máquina do operador. O mesmo vale para a suíte
// (`pre-commit-run-syntax-blocks.test.ts`). Ou seja: a promessa "um corpo `run:`
// quebrado no índice não vira commit" era medida num ambiente que NÃO é o que
// julga o merge, e a diferença entre os dois ambientes é exatamente onde a
// classe já mordeu — `git` ausente, `bash` de outra implementação, o `node` de
// outro caminho, o hook sem bit de execução (que o git IGNORA em silêncio, e o
// commit entra).
//
// Aqui o MESMO módulo de prova é executado dentro da imagem do runner — a mesma
// (`Dockerfile.ubuntu-bun`) em que os jobs do CI rodam — e o veredito é o de um
// `git commit` de verdade invocando o hook de verdade. O que muda é o LUGAR, e
// o lugar é ESCOLHIDO E DECLARADO:
//
//   1. JÁ DENTRO DA IMAGEM — o caso do job da forja: o label `docker://` do
//      act_runner (`GITEA_RUNNER_LABELS`) faz o job rodar NO CONTAINER da imagem,
//      e o socket do docker NÃO está montado nele. Aqui a prova roda em lugar
//      (in-place) e os marcadores do runtime são VERIFICADOS: estar num
//      container (`/.dockerenv`) E sobre a base do runner (`/opt/acttoolcache`,
//      o MESMO caminho que a medição dos shells registrou para o `node`). Sem os
//      dois, "estou na imagem" seria presunção — e a prova mediria a máquina de
//      quem roda;
//   2. `docker run` — o caso do runner auto-hospedado do GitHub, que é uma
//      MÁQUINA com docker e não um container da imagem: o mesmo comando roda com
//      `--in-image` DENTRO de um container da ref derivada, com o checkout
//      montado NO MESMO CAMINHO (o `node_modules` do fixture é um link ABSOLUTO:
//      montar em outro caminho faria o guard morrer de "module not found" e o
//      não-zero seria do fixture, não do defeito).
//
// O veredito é o MESMO tri-estado dos outros fatos (proven/violated/unavailable)
// e o exit code o transporta: um job de CI usa este comando como gate, e o que
// ele não conseguiu medir sai como INDETERMINADO (exit 2), NOMEANDO o que
// faltou — nunca como verde.
//
// O QUE ELA **NÃO** PROMETE (escopo declarado, não esquecimento):
//
//   - os guards IRMÃOS do hook são o DUBLÊ DECLARADO do simulador
//     (`hook-simulator.mjs`): o `bun`, o `bash` e o `node` deles devolvem 0. Quem
//     roda de verdade é o guard do defeito (`check-workflow-run-syntax.mjs
//     --staged`, com o `node` REAL do runtime) e o REMÉDIO. Sem o dublê a fase C
//     do hook (`lint-staged`, `typecheck`) rodaria num fixture que não tem o
//     `package.json` do repositório, e o CONTROLE nunca comitaria — o dublê é o
//     que torna a medição sobre o FIO sob teste;
//   - a ref é a que o repositório DECLARA (`IMAGE_REGISTRY`/`IMAGE_NAMESPACE`/
//     `BUN_VERSION`): o digest sai como proveniência MEDIDA, mas quem diz se o
//     runner registrado aponta para ELA é o `check-runner-labels`/o smoke;
//   - no modo `docker run` a imagem tem de estar local ou ser baixável (registry
//     privado → credencial): o pull que falha sai como INDETERMINADO com a dica,
//     não como violação;
//   - o hook real roda num repositório de FIXTURE (é o simulador da casa), não
//     no checkout: a prova mede o BLOQUEIO do defeito, não o commit do PR.
// =============================================================================

import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { resolveBash } from "./hook-simulator.mjs"
import { proveCommitBlocks } from "./pre-commit-proof.mjs"
// O cliente do docker e o "o docker responde?" têm UM dono cada (`dockerCall` e
// `dockerAvailable` do `prove-image-contract`, `probeDigest`/`runnerImageRef` do
// `runner-shells`): uma segunda implementação de "o docker respondeu" divergiria
// no dia em que alguém ajustasse uma — e as duas provas passariam a medir
// coisas diferentes.
import { dockerAvailable, dockerCall } from "./prove-image-contract.mjs"
import { probeDigest, runnerImageRef } from "./runner-shells.mjs"

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")

/** O próprio arquivo — o comando que o container executa no modo `docker run`. */
export const SELF = fileURLToPath(import.meta.url)

export const EXIT = {
  PROVEN: 0,
  VIOLATED: 1,
  UNAVAILABLE: 2,
  USAGE: 3,
}

/**
 * A FORMA do relatório (o que o `--json` publica e o que o relatório humano lê).
 *
 * Ela é UMA só para todos os modos de propósito: um consumidor do `--json` não
 * precisa perguntar em que modo o comando estava para saber quais campos
 * existem — os do modo saem AUSENTES, e ausente é diferente de inventado. É
 * também o que deixa os testes medirem o relatório inteiro sem `any`.
 *
 * @typedef {{
 *   state: string, detail: string, limits: string[],
 *   modo?: string, image?: string|null, digest?: string|null, pulled?: string|null,
 *   markers?: {container: string|null, base: string|null, inside: boolean},
 *   runtime?: {node: string, nodeVersion: string, git: string|null, bash: string}|null,
 *   facts?: Record<string,string>|null, unparsed?: string[],
 *   proof?: {state: string, detail: string, evidence: object|null}|null,
 *   argv?: string, inner?: string,
 * }} ReporteDoLugar
 */

/** Teto do `docker run` da prova (pull + a prova; a prova em si leva segundos). */
export const RUN_TIMEOUT_MS = 600_000

/**
 * Os marcadores de "estou DENTRO de um container". Qualquer um serve: o
 * `/.dockerenv` é do docker e o `/run/.containerenv` do podman.
 */
export const CONTAINER_MARKERS = ["/.dockerenv", "/run/.containerenv"]

/**
 * O marcador da BASE da imagem do runner — `catthehacker/ubuntu:act-latest`, de
 * onde o `Dockerfile.ubuntu-bun` parte. O caminho NÃO é arbitrário: é o mesmo
 * que a medição dos shells registrou para o `node` da imagem
 * (`/opt/acttoolcache/node/<versão>/x64/bin/node`, em `runner-shells.mjs`) e o
 * que a prova impressa no relatório cita. Sem ele, "estou no container certo"
 * seria presunção: qualquer container passaria.
 */
export const IMAGE_BASE_MARKER = "/opt/acttoolcache"

/**
 * O prefixo das linhas de EVIDÊNCIA do modo interno. Elas são a ponte entre o
 * processo que roda dentro da imagem e quem o invocou: o filho imprime
 * `PROVA-<CHAVE>=<valor>` (uma por linha) e o pai as lê do stdout, em vez de
 * depender do formato humano do relatório. O estado continua vindo do EXIT CODE
 * (é o que o docker propaga) — as linhas são a proveniência, não o veredito.
 */
export const EVIDENCE_PREFIX = "PROVA-"

/**
 * A ref da imagem que o PAI está executando, herdada pelo container. O mesmo
 * nome é o dono da informação: sem ele a evidência do modo interno diria
 * "imagem ?" (o processo de dentro NÃO consegue ler a tag em que foi lançado —
 * uma tag não existe dentro do container, só o filesystem dele).
 */
export const IMAGE_REF_ENV = "PROVA_IMAGE_REF"

/** O que NÃO é negociável: o hook, o guard que ele executa e o fixture. */
export const LIMITS = [
  "os guards IRMÃOS do hook rodam no DUBLÊ DECLARADO do simulador (`bun`/`bash`/`node` deles devolvem 0): quem roda de verdade é o guard do defeito, com o `node` REAL do runtime",
  "o repositório da prova é o FIXTURE do simulador (o mesmo da suíte e do doctor), não o checkout do PR",
  "a ref é a DECLARADA pelo repositório (IMAGE_REGISTRY/IMAGE_NAMESPACE/BUN_VERSION): o digest sai como proveniência medida, mas quem prova qual imagem o runner registrou é o `check-runner-labels`/o smoke",
]

/**
 * A PERGUNTA do lugar: estamos dentro de um container SOBRE a base do runner?
 *
 * As duas metades são necessárias e nenhuma basta: `/opt/acttoolcache` numa
 * máquina hospedeira não prova container, e `/.dockerenv` num container
 * qualquer não prova que a base é a do runner.
 *
 * @param {{exists?: (path: string) => boolean}} [deps]
 * @returns {{container: string|null, base: string|null, inside: boolean}}
 */
export function markersInImage({ exists = existsSync } = {}) {
  const container = CONTAINER_MARKERS.find((p) => exists(p)) ?? null
  const base = exists(IMAGE_BASE_MARKER) ? IMAGE_BASE_MARKER : null
  return { container, base, inside: container !== null && base !== null }
}

/**
 * O runtime MEDIDO de onde a prova está rodando: o `node` (o caminho é
 * `process.execPath` — o processo que EXECUTA a prova, não um `command -v` que
 * poderia resolver outro), o `git` e o `bash` do harness.
 *
 * É esta a evidência de "rodou dentro da imagem": no job da forja o caminho do
 * node é o do toolcache da base; numa máquina qualquer, não é.
 *
 * @param {{run?: typeof spawnSync, bash?: () => string, execPath?: string, version?: string}} [deps]
 * @returns {{node: string, nodeVersion: string, git: string|null, bash: string}}
 */
export function runtimeEvidence({
  run = spawnSync,
  bash = resolveBash,
  execPath = process.execPath,
  version = process.version,
} = {}) {
  const git = run("git", ["--version"], { encoding: "utf8", timeout: 30_000 })
  return {
    node: execPath,
    nodeVersion: version,
    git: git?.status === 0 ? String(git.stdout ?? "").trim() : null,
    bash: bash(),
  }
}

/**
 * As linhas de evidência do modo interno — o contrato estável com quem invoca.
 *
 * @param {object} r
 * @returns {string[]}
 */
export function evidenceLines(r) {
  const linhas = [`${EVIDENCE_PREFIX}MODO=${r.modo}`, `${EVIDENCE_PREFIX}STATE=${r.state}`]
  if (r.markers?.container) linhas.push(`${EVIDENCE_PREFIX}CONTAINER=${r.markers.container}`)
  if (r.markers?.base) linhas.push(`${EVIDENCE_PREFIX}BASE=${r.markers.base}`)
  if (r.runtime) {
    linhas.push(`${EVIDENCE_PREFIX}NODE=${r.runtime.node} ${r.runtime.nodeVersion}`)
    if (r.runtime.git) linhas.push(`${EVIDENCE_PREFIX}GIT=${r.runtime.git}`)
    linhas.push(`${EVIDENCE_PREFIX}BASH=${r.runtime.bash}`)
  }
  if (r.image) linhas.push(`${EVIDENCE_PREFIX}IMAGE=${r.image}`)
  if (r.digest) linhas.push(`${EVIDENCE_PREFIX}DIGEST=${r.digest}`)
  const defeito = r.proof?.evidence?.defeito
  if (defeito) {
    linhas.push(
      `${EVIDENCE_PREFIX}DEFEITO=exit:${defeito.status} objetos:${defeito.objetosDeCommit} head:${defeito.headExiste ? "sim" : "nao"}`,
    )
  }
  const controle = r.proof?.evidence?.controle
  if (controle) {
    linhas.push(
      `${EVIDENCE_PREFIX}CONTROLE=exit:${controle.status} objetos:${controle.objetosDeCommit}`,
    )
  }
  return linhas
}

/**
 * O parser das linhas acima — usado por quem INVOCA o modo interno (o pai
 * `docker run`) e pelos testes. Linha que ele não entende vira `unparsed`, nunca
 * um valor inventado.
 *
 * @param {string} output
 * @returns {{facts: Record<string,string>, unparsed: string[]}}
 */
export function parseInImage(output) {
  const facts = {}
  const unparsed = []
  for (const linha of String(output ?? "").split("\n")) {
    const m = /^PROVA-([A-Z]+)=(.*)$/.exec(linha.trim())
    if (!m) {
      if (linha.includes(EVIDENCE_PREFIX)) unparsed.push(linha.trim())
      continue
    }
    facts[m[1]] = m[2]
  }
  return { facts, unparsed }
}

/**
 * O modo INTERNO: a prova roda AQUI, exigindo os marcadores do runtime.
 *
 * `--in-image` NÃO dispensa a verificação: um `--in-image` numa máquina
 * hospedeira é uso indevido, e devolver `proven` ali mediria outra coisa. É o
 * caso de uso que o comando existe para não permitir.
 *
 * @param {{root?: string, env?: Record<string,string|undefined>, deps?: {prove?: Function, exists?: Function, markers?: Function, runtime?: Function}}} [args]
 * @returns {ReporteDoLugar}
 */
export function innerReport({
  root = REPO_ROOT,
  env = process.env,
  deps = /** @type {any} */ ({}),
} = {}) {
  const exists = deps.exists ?? existsSync
  const markers = (deps.markers ?? markersInImage)({ exists })
  const runtime = (deps.runtime ?? runtimeEvidence)()
  const ref = env[IMAGE_REF_ENV] ?? null
  const base = { modo: "in-image", image: ref, limits: LIMITS, markers, runtime }

  if (!markers.inside) {
    const faltando = []
    if (!markers.container)
      faltando.push(`um marcador de container (${CONTAINER_MARKERS.join(" ou ")})`)
    if (!markers.base) faltando.push(`a base do runner (${IMAGE_BASE_MARKER})`)
    return {
      ...base,
      state: "unavailable",
      detail:
        `--in-image foi pedido FORA do runtime do CI: faltou ${faltando.join(" e ")}. ` +
        `A prova tem de rodar dentro de um container da imagem do runner — sem os marcadores, ` +
        `o veredito mediria a máquina de quem roda, que é exatamente o que este comando existe para não confundir`,
      proof: null,
    }
  }

  const prove = deps.prove ?? ((opts) => proveCommitBlocks(opts))
  const proof = prove({ root })
  const onde = ref === null ? "" : ` dentro da imagem '${ref}'`
  return { ...base, state: proof.state, detail: `${proof.detail}${onde}`, proof }
}

/**
 * O comando que o container executa: o MESMO script, com `--in-image`. O
 * caminho vai citado porque o checkout do runner tem espaço no caminho do
 * workspace (`/home/runner/work/<repo>/<repo>` — sem aspas, um espaço partiria o
 * comando em dois).
 *
 * @param {{root?: string, self?: string}} [args]
 * @returns {string}
 */
export function innerCommand({ root = REPO_ROOT, self = SELF } = {}) {
  return `node ${JSON.stringify(self)} --root ${JSON.stringify(root)} --in-image`
}

/**
 * O argv do `docker run` — com o checkout montado NO MESMO CAMINHO (o
 * `node_modules` do fixture é um link absoluto) e as variáveis da ref herdadas
 * pelo container (para a evidência declarar a versão contra a qual a prova
 * rodou, e não só o `bun --version` do momento de quem invoca).
 *
 * @param {{ref: string, root?: string, env?: Record<string,string|undefined>}} args
 * @returns {string[]}
 */
export function dockerRunArgv({ ref, root = REPO_ROOT, env = {} }) {
  const argv = ["run", "--rm"]
  for (const nome of ["IMAGE_REGISTRY", "IMAGE_NAMESPACE", "BUN_VERSION"]) {
    const valor = env[nome]
    if (typeof valor === "string" && valor !== "") argv.push("-e", `${nome}=${valor}`)
  }
  // A ref NÃO se descobre de dentro (uma tag não existe no filesystem do
  // container): quem a sabe é quem o lançou, e a evidência precisa dela para
  // dizer QUAL imagem provou o bloqueio.
  argv.push("-e", `${IMAGE_REF_ENV}=${ref}`)
  argv.push(
    "-v",
    `${root}:${root}`,
    "-w",
    root,
    "--entrypoint",
    "/bin/bash",
    ref,
    "-lc",
    innerCommand({ root }),
  )
  return argv
}

/** A prova INDISPONÍVEL: o `state` selecionado é sempre o mesmo caminho de saída. */
function indisponivel(detail, extra = {}) {
  return { state: "unavailable", detail, limits: LIMITS, ...extra }
}

/**
 * O lugar-escolhedor: decide ONDE a prova roda, executa, e devolve o relatório
 * com o modo DECLARADO. Nada de "provei de algum jeito" — quem lê precisa saber
 * se o `git commit` aconteceu no container da imagem ou no host.
 *
 * @param {{
 *   root?: string, image?: string|null, docker?: string,
 *   env?: Record<string,string|undefined>, wantInImage?: boolean,
 *   deps?: {prove?: Function, exists?: Function, markers?: Function, runtime?: Function,
 *           available?: Function, call?: Function, digest?: Function},
 * }} [args]
 * @returns {ReporteDoLugar}
 */
export function placeReport({
  root = REPO_ROOT,
  image = null,
  docker = "docker",
  env = process.env,
  wantInImage = false,
  deps = /** @type {any} */ ({}),
} = {}) {
  const exists = deps.exists ?? existsSync
  const markers = (deps.markers ?? markersInImage)({ exists })
  const ref = image ?? (deps.imageRef ?? runnerImageRef)(env)

  // 1. `--in-image` explícito: é o container falando. Roda aqui (ou diz por que não pode).
  if (wantInImage) return innerReport({ root, env, deps })

  // 2. O job JÁ roda dentro da imagem (o label `docker://` da forja): o docker
  //    não está montado no container, e não precisa estar.
  if (markers.inside) return innerReport({ root, env, deps })

  // 3. O runner é uma máquina com docker: o MESMO comando roda no container.
  const available = (deps.available ?? dockerAvailable)({ docker })
  if (!available) {
    return indisponivel(
      `não dá para provar o bloqueio dentro do runtime do CI: não estamos dentro da imagem do runner ` +
        `(faltou ${markers.container ? IMAGE_BASE_MARKER : CONTAINER_MARKERS.join(" ou ")}) e o docker não respondeu ` +
        `(cliente '${docker}'). O remedy é rodar este comando onde há uma das duas coisas: ` +
        `no container do job da forja (label docker://) ou numa máquina com docker`,
      { modo: "indefinido", markers, image: ref },
    )
  }
  if (typeof ref !== "string" || ref.trim() === "") {
    return indisponivel(
      "sem ref da imagem do runner: defina BUN_VERSION (IMAGE_REGISTRY/IMAGE_NAMESPACE completam a ref) ou passe --image <ref>",
      { modo: "docker-run", markers, image: null },
    )
  }

  const call = deps.call ?? dockerCall
  const local = call({ docker, args: ["image", "inspect", "--format", "{{.Id}}", ref] })
  let pulled = null
  if (local.code !== 0) {
    // A imagem não está local: puxar é o caminho normal do runner que ainda não
    // a tem. O pull que falha é INDETERMINADO com a dica da credencial — nunca
    // violação (o defeito não foi medido).
    const pull = call({ docker, args: ["pull", ref], timeoutMs: RUN_TIMEOUT_MS })
    if (pull.code !== 0) {
      return indisponivel(
        `a imagem '${ref}' não está local e o pull falhou: ${pull.output.split("\n").slice(-1)[0] || "sem saída"} — ` +
          `confira a credencial do registry (o mirror é privado) e se a tag existe (BUN_VERSION re-sincronizado)`,
        { modo: "docker-run", markers, image: ref },
      )
    }
    pulled = "baixada"
  }

  const argv = dockerRunArgv({ ref, root, env })
  const res = call({ docker, args: argv, timeoutMs: RUN_TIMEOUT_MS })
  const digest = (deps.digest ?? probeDigest)(ref, { docker })
  const parsed = parseInImage(res.output)
  const state = stateFromExit(res.code)
  const base = {
    modo: "docker-run",
    image: ref,
    digest,
    pulled,
    markers,
    limits: LIMITS,
    facts: parsed.facts,
    unparsed: parsed.unparsed,
    argv: [docker, ...argv].join(" "),
    // O relatório do container, inteiro: a prova é dele, e um veredito sem a
    // medição que o produziu obrigaria quem lê a reexecutar o docker para ver
    // o que o hook disse.
    inner: res.output,
  }
  if (state === null) {
    return {
      ...base,
      state: "unavailable",
      detail:
        `o \`docker run\` não terminou (timeout de ${RUN_TIMEOUT_MS}ms ou sinal) — o veredito não foi medido: ` +
        `${res.output.split("\n").slice(-1)[0] || "sem saída"}`,
    }
  }
  return { ...base, state, detail: detailFromFacts(state, parsed.facts, res.output) }
}

/**
 * O exit code do processo (do container, propagado pelo docker) é o veículo do
 * veredito: `null` é "não terminou" e NÃO vira verde.
 *
 * @param {number|null|undefined} code
 * @returns {"proven"|"violated"|"unavailable"|null}
 */
export function stateFromExit(code) {
  if (code === EXIT.PROVEN) return "proven"
  if (code === EXIT.VIOLATED) return "violated"
  if (code === EXIT.UNAVAILABLE) return "unavailable"
  return null
}

/**
 * O detalhe do modo `docker run`: as mesmas metades medidas, lidas das linhas de
 * evidência do container (o estado já veio do exit code — aqui só se NARRA o que
 * o container mediu, sem inventar o que ele não publicou).
 */
function detailFromFacts(state, facts, output) {
  const defeito = facts.DEFEITO ?? "não publicado"
  const controle = facts.CONTROLE ?? "não publicado"
  const runtime = facts.NODE ? `${facts.NODE} (git: ${facts.GIT ?? "ausente"})` : "não publicado"
  if (state === "proven") {
    return (
      `DENTRO da imagem '${facts.IMAGE ?? "?"}', um 'git commit' de verdade com o corpo 'run:' quebrado no índice ` +
      `foi RECUSADO (${defeito}) e o mesmo commit com o corpo fechado ENTROU (${controle}); ` +
      `runtime medido no container: ${runtime}`
    )
  }
  if (state === "violated") {
    return (
      `DENTRO da imagem '${facts.IMAGE ?? "?"}' o defeito ENTROU: ${defeito} — ` +
      `o commit de quem confia no hook já existe, medido no runtime do CI (${runtime})`
    )
  }
  // `unavailable`: o container não pôde provar. A última linha da saída dele
  // costuma ser o motivo — ela é citada em vez de substituída por um genérico.
  const ultima = String(output ?? "")
    .trim()
    .split("\n")
    .filter((l) => l.trim() !== "")
    .slice(-1)[0]
  return `o container não conseguiu provar (defeito: ${defeito}, controle: ${controle}): ${ultima ?? "sem saída"}`
}

/** O exit code do comando — o MESMO tri-estado dos outros fatos do repositório. */
export function exitCodeFor(state) {
  if (state === "proven") return EXIT.PROVEN
  if (state === "violated") return EXIT.VIOLATED
  return EXIT.UNAVAILABLE
}

/** O relatório humano. O modo e o runtime vêm primeiro: são a pergunta do comando. */
export function renderReport(report, { emit = console.log } = {}) {
  const linha = (s = "") => emit(s)
  linha("== Prova do bloqueio do pre-commit — DENTRO do runtime do CI ==")
  const modo =
    report.modo === "in-image"
      ? "em lugar (o job já roda no container da imagem do runner)"
      : report.modo === "docker-run"
        ? "num container da imagem do runner (docker run)"
        : "indefinido (não foi possível escolher o lugar)"
  linha(`   lugar: ${modo}`)
  if (report.image) {
    linha(
      `   imagem: ${report.image}${report.digest ? ` (digest ${report.digest})` : " (digest não lido)"}`,
    )
  } else if (report.modo === "in-image") {
    linha(
      "   imagem: a do PRÓPRIO runtime (o job roda no container do label `docker://` da forja) — " +
        "o digest não é legível daqui; quem prova o mapeamento dele é o `check-runner-labels`/o smoke",
    )
  }
  if (report.runtime) {
    linha(
      `   runtime: node ${report.runtime.node} ${report.runtime.nodeVersion} · git ${report.runtime.git ?? "AUSENTE"} · bash ${report.runtime.bash}`,
    )
    linha(
      `   marcadores: container=${report.markers?.container ?? "AUSENTE"} · base=${report.markers?.base ?? "AUSENTE"}`,
    )
  }
  if (report.facts && Object.keys(report.facts).length > 0) {
    linha(
      `   medido no container: defeito ${report.facts.DEFEITO ?? "?"} · controle ${report.facts.CONTROLE ?? "?"}`,
    )
  }
  if (report.argv) linha(`   comando: ${report.argv}`)
  if (report.inner) {
    linha("")
    linha("   — o que o container mediu (relatório dele) —")
    for (const l of String(report.inner).split("\n")) linha(`   ${l}`)
  }
  linha("")
  if (report.state === "proven") linha(`  ✅ PROVADO: ${report.detail}`)
  else if (report.state === "violated") linha(`  ❌ VIOLADO: ${report.detail}`)
  else linha(`  ⚠️  INDETERMINADO: ${report.detail}`)
  linha("")
  linha("   O que esta prova NÃO cobre (declarado):")
  for (const l of report.limits ?? []) linha(`     · ${l}`)
}

/** O parser das opções — `--in-image` é a única que troca o LUGAR da prova. */
export function parseArgs(argv = []) {
  const opts = {
    help: false,
    json: false,
    inImage: false,
    image: null,
    docker: "docker",
    root: REPO_ROOT,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "-h" || a === "--help") opts.help = true
    else if (a === "--json") opts.json = true
    else if (a === "--in-image") opts.inImage = true
    else if (a === "--image") opts.image = argv[++i] ?? null
    else if (a === "--docker") opts.docker = argv[++i] ?? "docker"
    else if (a === "--root") opts.root = argv[++i] ?? REPO_ROOT
    else return { ...opts, unknown: a }
  }
  return opts
}

/* c8 ignore start — o wrapper de CLI (a suíte cobre as partes puras e o fluxo injetado) */
export const IS_MAIN =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

export function main({ argv = process.argv.slice(2), env = process.env, deps = {} } = {}) {
  const opts = parseArgs(argv)
  if (opts.unknown !== undefined) {
    console.error(`❌ opção desconhecida: ${opts.unknown}`)
    return EXIT.USAGE
  }
  if (opts.help) {
    console.log(
      "prove-pre-commit-in-runner — a prova do bloqueio do pre-commit DENTRO do runtime do CI\n\n" +
        "Usage:\n" +
        "  node scripts/prove-pre-commit-in-runner.mjs [--in-image] [--image <ref>] [--docker <cli>] [--root <dir>] [--json]\n\n" +
        "Exit codes: 0 provado · 1 violado · 2 indeterminado · 3 uso inválido",
    )
    return EXIT.PROVEN
  }
  const report = placeReport({
    root: opts.root,
    image: opts.image,
    docker: opts.docker,
    env,
    wantInImage: opts.inImage,
    deps,
  })
  if (opts.json) console.log(JSON.stringify(report, null, 2))
  else renderReport(report)
  // As linhas de evidência saem SEMPRE (também no modo `--json`): é o contrato
  // estável com quem invoca este comando de dentro de um container.
  for (const l of evidenceLines(report)) console.log(l)
  return exitCodeFor(report.state)
}

if (IS_MAIN) process.exit(main())
/* c8 ignore stop */
