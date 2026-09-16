#!/usr/bin/env node
// =============================================================================
// prove-image-contract.mjs
//
// Usage:
//   node scripts/prove-image-contract.mjs                       # registry LOCAL + docker REAL
//   node scripts/prove-image-contract.mjs --json                # mesmo veredito, formato plano
//   node scripts/prove-image-contract.mjs --build               # constroi a imagem se ela faltar
//   node scripts/prove-image-contract.mjs --image ghcr.io/x/ubuntu-bun:1.3.14
//   node scripts/prove-image-contract.mjs --bun-version 1.3.14
//   node scripts/prove-image-contract.mjs --gitea-env deploy/.env.gitea
//   node scripts/prove-image-contract.mjs --registry-image registry:2
//   node scripts/prove-image-contract.mjs -h
//
// Exit codes:
//   0 — PROVADO: o artefato publicado (empurrado para um registry de verdade) sai
//       `proven` com os TRES fatos medidos, e cada sabotagem derruba o contrato
//       pelo fato que ela representa — plugin, caminho e versao
//   1 — VIOLADO: o contrato NAO esta provado (o controle sem a marca, uma sabotagem
//       passando em silencio, ou o fato esperado nao nomeado no vermelho)
//   2 — INDETERMINADO: sem docker, sem a imagem do runner, ou sem o registry de
//       teste — ausencia de prova, nunca "esta certo"
//   3 — uso invalido
//
// POR QUE EXISTE (a diferenca entre "o codigo roda" e "alguem RODOU")
//
// `checkPublishedImageContract` (o guard da base) responde a pergunta mais forte do
// repositorio: o artefato que o job BAIXA cumpre a promessa do build? Ele resolve o
// digest que a tag serve e roda `docker run <repo>@<digest>` com o MESMO bloco do
// Dockerfile. So que a UNICA prova dessa funcao ate aqui era a suite unitaria, que
// INJETA um `run` duble — e um duble nao valida a invocacao do docker: um
// `--entrypoint` errado, uma flag no lugar errado ou um alvo resolvido para a TAG
// (em vez do digest) passariam com a suite inteira verde. O que faltava era alguem
// RODAR o caminho real: um registry de verdade (nao um duble), um `docker` de
// verdade (nao um `run` injetado) e o contrato de verdade.
//
// Este comando faz exatamente isso, em CINCO casos, e cada um responde uma metade:
//
//   CONTROLE — o artefato COMPLETO, empurrado para o registry: tem de sair
//              `proven`, e os tres fatos (plugin `compose`, versao do Bun e o
//              caminho resolvido) sao MEDIDOS dentro do artefato, nao narrados;
//   SABOTAGENS — o MESMO artefato com UMA promessa quebrada por vez, empurrado
//              sob a propria tag: sem o plugin, com o Bun fora de
//              `/usr/local/bin`, e com a versao esperada diferente. Cada um tem
//              de sair `violated` NOMEANDO o fato que foi sabotado — sem o nome,
//              um vermelho generico provaria que algo quebrou, nao que ESTE fato
//              e verificado;
//   TAG AUSENTE — uma tag que o registry nao tem: tem de sair `unavailable`.
//              O 404 do registry nao pode virar "o contrato esta certo" nem
//              "o contrato esta violado" — e o mesmo tri-estado do doctor.
//
// O REGISTRY E LOCAL, E ISSO E DITO: o caminho exercitado e o REAL — resolver o
// digest pelo OCI v2, puxar por digest, rodar o bloco do Dockerfile dentro do
// artefato. O que um registry local NAO exercita e o TLS e a credencial do pacote
// privado do GHCR; quem mede o artefato de PRODUCAO e o doctor no cron semanal,
// com a credencial da forja (secao 3/7 do relatorio de prontidao).
// =============================================================================

import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import process from "node:process"
import { fileURLToPath, pathToFileURL } from "node:url"

import {
  BUN_PATH,
  checkPublishedImageContract,
  parseEvidence,
  runEvidence,
} from "./check-runner-base.mjs"
import { parseEnvFile, resolveImageRef } from "./ensure-runner-image.mjs"
import { buildRunnerImage } from "./prove-forge-runtime.mjs"
import { PLUGIN_DIRS } from "./prove-smoke-render-gate.mjs"

/** A raiz do repositorio — este script mora em `scripts/`. */
export const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

/** O env de referencia (o template COMITADO: o `.env.gitea` do host e gitignored). */
export const DEFAULT_ENV_FILE = "deploy/env.gitea.example"

/** O registry de teste: a imagem oficial, a mesma que qualquer operador tem. */
export const DEFAULT_REGISTRY_IMAGE = "registry:2"

/** A porta OCI DENTRO do container do registry (a de fora e sorteada). */
export const REGISTRY_PORT = 5000

/** O nome do container do registry de teste (unico por run: nao colide entre threads). */
export const REGISTRY_NAME = "prova-image-contract-registry"

/**
 * A porta fixa do registry de teste, REUSADA entre runs quando ja' responde.
 * Nao e' escolha estetica: onde o daemon nao pode matar container, uma porta
 * sorteada por run deixaria um registry a mais escutando a cada execucao.
 */
export const REGISTRY_HOST_PORT = 5177

/** O namespace de teste dentro do registry (nunca o do repositorio). */
export const REGISTRY_NAMESPACE = "prova"

/** O repositorio da imagem DENTRO do registry de teste. */
export const REGISTRY_REPO = "ubuntu-bun"

/** Exit codes — o contrato da CLI (a mesma escala da familia `prove-*`). */
export const EXIT = {
  OK: 0,
  FAILED: 1,
  UNAVAILABLE: 2,
  USAGE: 3,
}

/**
 * @typedef {{id: string, title: string, sabotage: "plugin"|"bun-path"|"version"|"missing-tag"|null,
 *   expect: "proven"|"violated"|"unavailable", mustName: string[]}} ContractCase
 * @typedef {{id: string, ok: boolean, state: string, detail: string, wrong: string[],
 *   target?: string|null, digest?: string|null, findings?: object|null}} CaseResult
 * @typedef {{verdict: "proven"|"violated"|"unavailable", blockers: string[], detail: string,
 *   ref: string|null, version: string|null, envFile: string, registry: string|null,
 *   registryImage: string, cases: CaseResult[], reused: boolean, cleanup: string|null}} ProofResult
 * @typedef {{json?: boolean, build?: boolean, help?: boolean, keep?: boolean, envFile?: string,
 *   image?: string|null, bunVersion?: string|null, registryImage?: string,
 *   timeoutS?: number, docker?: string, error?: string}} ProofOptions
 */

/**
 * OS CINCO CASOS. `sabotage` diz o que e' quebrado ANTES de empurrar (ou que so a
 * expectativa muda, no caso da versao); `mustName` e' o fato que o vermelho TEM de
 * nomear — e ele que separa "algo quebrou" de "ESTE fato e verificado".
 *
 * @type {ContractCase[]}
 */
export const CONTRACT_CASES = [
  {
    id: "controle",
    title: "o artefato publicado cumpre o contrato (os tres fatos medidos)",
    sabotage: null,
    expect: "proven",
    mustName: ["executa o contrato", "plugin `compose`", `em ${BUN_PATH}`],
  },
  {
    id: "plugin-ausente",
    title: "artefato SEM o plugin `compose` (o job guards ficaria INDETERMINADO)",
    sabotage: "plugin",
    expect: "violated",
    mustName: ["PLUGIN 'compose' nao esta na imagem"],
  },
  {
    id: "bun-fora-do-caminho",
    title: "artefato com o Bun FORA de /usr/local/bin (o tier-1 nao dispara)",
    sabotage: "bun-path",
    expect: "violated",
    mustName: [`bun resolve de 'AUSENTE' (o contrato promete ${BUN_PATH})`],
  },
  {
    id: "versao-diferente",
    title: "artefato cuja versao do Bun != a declarada (o runner roda outro bun)",
    sabotage: "version",
    expect: "violated",
    mustName: ["bun --version ="],
  },
  {
    id: "tag-ausente",
    title: "tag que o registry NAO tem (204 nunca vira 'esta certo')",
    sabotage: "missing-tag",
    expect: "unavailable",
    mustName: ["nao foi resolvido"],
  },
]

/**
 * O Dockerfile da sabotagem — DERIVADO da imagem base declarada (nunca uma
 * segunda imagem completa): a sabotagem tem de ser CIRURGICA, e um artefato que
 * difere em mais coisa faria o vermelho nao ser atribuivel ao fato sabotado.
 *
 * A lista de diretorios de plugin vem do `prove-smoke-render-gate` (uma fonte
 * so): remover de um caminho e deixar o plugin em outro faria o "sem o plugin"
 * ser, na verdade, "com o plugin em outro lugar" — e a mutacao passaria.
 *
 * @param {"plugin"|"bun-path"} kind
 * @param {string} baseRef
 * @param {{pluginDirs?: string[], bunPath?: string}} [deps]
 * @returns {string}
 */
export function sabotageDockerfile(
  kind,
  baseRef,
  { pluginDirs = PLUGIN_DIRS, bunPath = BUN_PATH } = {},
) {
  if (kind === "plugin") {
    const removed = pluginDirs.map((dir) => `${dir}/docker-compose`).join(" ")
    return [`FROM ${baseRef}`, `RUN rm -f ${removed}`, ""].join("\n")
  }
  if (kind === "bun-path") {
    return [`FROM ${baseRef}`, `RUN mv ${bunPath} ${bunPath}.fora-do-caminho`, ""].join("\n")
  }
  throw new Error(`sabotagem desconhecida: ${kind}`)
}

/**
 * Confere UM caso: o estado tem de ser o esperado E o detalhe tem de NOMEAR o fato.
 * As duas metades sao a prova — so o estado deixaria passar um vermelho generico.
 *
 * @param {ContractCase} spec
 * @param {{state?: string, detail?: string, target?: string|null, digest?: string|null, findings?: object|null}} result
 * @returns {CaseResult}
 */
export function classifyCase(spec, result = {}) {
  const state = result.state ?? "unavailable"
  const detail = String(result.detail ?? "")
  const wrong = []
  if (state !== spec.expect) wrong.push(`saiu '${state}' (o esperado e '${spec.expect}')`)
  for (const name of spec.mustName) {
    if (!detail.includes(name)) wrong.push(`o detalhe NAO nomeia '${name}'`)
  }
  return {
    id: spec.id,
    ok: wrong.length === 0,
    state,
    detail,
    wrong,
    target: result.target ?? null,
    digest: result.digest ?? null,
    findings: result.findings ?? null,
  }
}

/**
 * O veredito: o CONTROLE prova o artefato E cada sabotagem mede o que diz medir.
 *
 * Sem o controle, um vermelho nas sabotagens nao e' atribuivel ao fato sabotado
 * (seria um ambiente quebrado passando por contrato que morde). Sem uma
 * sabotagem vermelha, a verificacao daquele fato e' DECORATIVA — a imagem
 * passaria sem o plugin, ou com o Bun em outro lugar, dentro de um relatorio
 * dizendo que o artefato cumpre o contrato.
 *
 * @param {{cases: CaseResult[], skipped?: string|null}} args
 * @returns {{verdict: "proven"|"violated"|"unavailable", blockers: string[], detail: string}}
 */
export function summarizeProof({ cases = [], skipped = null } = {}) {
  if (skipped) return { verdict: "unavailable", blockers: [], detail: skipped }
  if (cases.length === 0) {
    return {
      verdict: "unavailable",
      blockers: [],
      detail: 'nenhum caso rodou — ausencia de prova, nunca "esta certo"',
    }
  }
  const blockers = []
  const control = cases.find((c) => c.id === "controle")
  if (!control) {
    blockers.push(
      "o CONTROLE nao rodou — sem ele um vermelho nas sabotagens nao e' do fato sabotado",
    )
  } else if (!control.ok) {
    blockers.push(
      `o CONTROLE nao provou o artefato publicado (${control.state}): ${control.detail} — ` +
        `o ambiente nao entrega o verde que a forja espera, e um vermelho nas sabotagens nao seria do fato quebrado`,
    )
  }
  for (const c of cases) {
    if (c.id === "controle" || c.ok) continue
    blockers.push(
      `o caso '${c.id}' NAO mediu o que diz medir: ${c.wrong.join(" · ")} — ${c.detail}` +
        ` (um fato que ninguem derruba e' um fato que nao esta verificado)`,
    )
  }
  if (blockers.length > 0) {
    return {
      verdict: "violated",
      blockers,
      detail:
        "o contrato da imagem PUBLICADA nao esta provado: o artefato nao cumpre, ou a violacao nao e' nomeada",
    }
  }
  return {
    verdict: "proven",
    blockers: [],
    detail:
      "o artefato publicado cumpre os tres fatos (plugin `compose`, versao do Bun e caminho resolvido) " +
      "e cada sabotagem derruba o contrato nomeando o fato dela",
  }
}

/**
 * O mesmo formato em qualquer desfecho (o `--json` nao muda de shape).
 *
 * @param {Partial<ProofResult>} [partial]
 * @returns {ProofResult}
 */
export function proofResult(partial = {}) {
  return {
    verdict: "unavailable",
    blockers: [],
    detail: "",
    ref: null,
    version: null,
    envFile: DEFAULT_ENV_FILE,
    registry: null,
    registryImage: DEFAULT_REGISTRY_IMAGE,
    cases: [],
    // O registry foi REUSADO (ja' respondia na porta fixa) e a nota de LIMPEZA
    // (o container que ficou) quando houver — o shape nao muda por causa delas, e
    // o veredito nao muda por elas.
    reused: false,
    cleanup: null,
    ...partial,
  }
}

/** O exit code do veredito. */
export function exitCodeFor(verdict) {
  if (verdict === "proven") return EXIT.OK
  if (verdict === "violated") return EXIT.FAILED
  return EXIT.UNAVAILABLE
}

/** Uma porta livre em 127.0.0.1 (o bind e' imediato e fechado em seguida). */
export function freePort(host = "127.0.0.1") {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once("error", reject)
    server.listen(0, host, () => {
      const address = server.address()
      const port = typeof address === "object" && address ? address.port : 0
      server.close(() => resolve(port))
    })
  })
}

/**
 * Remove o container do registry de teste. Devolve `null` quando a remocao
 * funcionou e a NOTA do que sobrou quando nao — uma limpeza que falha nao pode
 * ser invisivel (o container fica escutando numa porta e ninguem sabe por que),
 * mas tambem NAO e' violacao da prova: o contrato foi medido do mesmo jeito.
 *
 * @param {{docker?: string, container: string, cwd?: string, timeoutMs?: number, run?: Function}} args
 * @returns {string|null}
 */
export function removeRegistry(
  {
    docker = "docker",
    container,
    cwd = REPO_ROOT,
    timeoutMs = 60000,
    run = spawnSync,
  } = /** @type {any} */ ({}),
) {
  const res = dockerCall({ docker, args: ["rm", "-f", container], cwd, timeoutMs, run })
  if (res.code === 0) return null
  return (
    `o container do registry '${container}' NAO foi removido (exit ${res.code}): ` +
    `${res.output.split("\n")[0] || "sem saida"} — remova à mão: docker rm -f ${container}`
  )
}

/** Uma chamada ao docker: exit code (null = nao terminou) + stdout/stderr juntos. */
export function dockerCall({
  docker = "docker",
  args = [],
  cwd = REPO_ROOT,
  timeoutMs = 60000,
  run = spawnSync,
} = {}) {
  const res = run(docker, args, { cwd, encoding: "utf8", timeout: timeoutMs })
  const status = res?.status
  return {
    code: status === null || status === undefined ? null : status,
    output: `${String(res?.stdout ?? "")}${String(res?.stderr ?? "")}`.trim(),
  }
}

/** O docker responde? (sem daemon/ausente = null, que NUNCA vira "esta certo") */
export function dockerAvailable({ docker = "docker", cwd = REPO_ROOT, run = spawnSync } = {}) {
  const res = dockerCall({ docker, args: ["version", "--format", "{{.Server.Version}}"], cwd, run })
  return res.code === 0
}

/**
 * O registry JA' responde no `/v2/`? UMA tentativa (nao um laco): a resposta aqui
 * decide entre REUSAR e SUBIR, e um laco de espera faria a decisao demorar ~30s
 * no caso comum (nada escutando na porta fixa). Sem rede, ECONNREFUSED e'
 * imediato — o caso real.
 *
 * @param {string} baseUrl
 * @param {{fetchImpl?: Function, timeoutMs?: number}} [deps]
 * @returns {Promise<boolean>}
 */
export async function registryResponds(
  baseUrl,
  { fetchImpl = globalThis.fetch, timeoutMs = 1500 } = {},
) {
  try {
    const signal =
      typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
        ? AbortSignal.timeout(timeoutMs)
        : undefined
    const res = await fetchImpl(`${baseUrl}/v2/`, { signal })
    return Boolean(res?.ok)
  } catch {
    return false
  }
}

/** Espera o registry responder no `/v2/` (rede local; ~1s na pratica). */
export async function waitForRegistry(
  baseUrl,
  { fetchImpl = globalThis.fetch, timeoutMs = 30000 } = {},
) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetchImpl(`${baseUrl}/v2/`)
      if (res?.ok) return true
    } catch {
      // ainda subindo
    }
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  return false
}

/**
 * A PROVA: registry de verdade, docker de verdade, o guard de verdade.
 *
 * Toda dependencia de I/O e' injetavel (o padrao da familia) — mas o CAMINHO do
 * CLI nao passa duble nenhum: `check` e' o `checkPublishedImageContract` real,
 * `resolveIdentity` e' o probe real e `run` e' o `docker` real.
 *
 * @param {{cwd?: string, envFile?: string, image?: string|null, bunVersion?: string|null,
 *   build?: boolean, registryImage?: string, timeoutS?: number, docker?: string,
 *   run?: Function, exists?: Function, readFile?: Function, fetchImpl?: Function,
 *   check?: Function, evidence?: Function, parseEv?: Function, keep?: boolean}} [args]
 * @returns {Promise<ProofResult>}
 */
export async function proveImageContract({
  cwd = REPO_ROOT,
  envFile = DEFAULT_ENV_FILE,
  image = null,
  bunVersion = null,
  build = false,
  registryImage = DEFAULT_REGISTRY_IMAGE,
  timeoutS = 900,
  docker = "docker",
  run = spawnSync,
  exists = existsSync,
  readFile = (path) => readFileSync(path, "utf8"),
  fetchImpl = globalThis.fetch,
  check = checkPublishedImageContract,
  evidence = runEvidence,
  parseEv = parseEvidence,
  keep = false,
} = {}) {
  if (!dockerAvailable({ docker, cwd, run })) {
    return proofResult({
      detail:
        "o docker nao respondeu (sem docker no PATH?) — sem docker nao ha contrato a rodar " +
        'na imagem publicada: ausencia de prova, nunca "esta certo"',
    })
  }

  const envPath = join(cwd, envFile)
  if (!exists(envPath)) {
    return proofResult({
      detail: `env de referencia ausente: ${envFile} (aponte --gitea-env para o env da forja)`,
    })
  }
  const values = parseEnvFile(readFile(envPath))
  const declared = resolveImageRef({
    ...values,
    ...(bunVersion ? { BUN_VERSION: bunVersion } : {}),
  })
  if (declared.error) return proofResult({ detail: declared.error, envFile })
  const localRef = image ?? declared.ref
  const version = declared.version
  const timeoutMs = Math.round(timeoutS * 1000)
  const base = { ref: localRef, version, envFile, registryImage }

  if (dockerCall({ docker, args: ["image", "inspect", localRef], cwd, run }).code !== 0) {
    if (!build) {
      return proofResult({
        ...base,
        detail: `a imagem '${localRef}' NAO existe localmente — construa com --build (ou \`bun run runner-image:ensure\`)`,
      })
    }
    const built = buildRunnerImage({ ref: localRef, version, cwd, run, build: true, docker })
    if (!built.ok)
      return proofResult({ ...base, detail: `o build da imagem FALHOU: ${built.detail}` })
  }

  // O registry de teste: a imagem dele precisa existir localmente (o pull e' do
  // operador, uma vez — o comando nao instala nada do nada).
  if (dockerCall({ docker, args: ["image", "inspect", registryImage], cwd, run }).code !== 0) {
    const pulled = dockerCall({ docker, args: ["pull", registryImage], cwd, timeoutMs, run })
    if (pulled.code !== 0) {
      return proofResult({
        ...base,
        detail: `o registry de teste '${registryImage}' nao esta local e nao pode ser baixado: ${pulled.output.split("\n")[0] || "sem saida"}`,
      })
    }
  }

  // A PORTA E' FIXA E O REGISTRY E' REUSADO quando ja' responde: em ambiente
  // onde o container nao pode ser MORTO (sem CAP_KILL no daemon, o caso do
  // sandbox e de alguns runners), cada run deixaria um registry escutando para
  // sempre — e uma prova que polui a maquina em que roda acaba desligada. Se a
  // porta fixa estiver ocupada por outra coisa (ou o registry nao subir nela),
  // cai para uma porta sorteada; o relatorio diz qual caminho foi usado.
  let port = REGISTRY_HOST_PORT
  let registryBase = `http://127.0.0.1:${port}`
  let container = `${REGISTRY_NAME}-${port}`
  let startedHere = false
  const reused = await registryResponds(registryBase, { fetchImpl })
  if (!reused) {
    let started = dockerCall({
      docker,
      args: [
        "run",
        "-d",
        "--rm",
        "--name",
        container,
        "-p",
        `127.0.0.1:${port}:${REGISTRY_PORT}`,
        registryImage,
      ],
      cwd,
      timeoutMs,
      run,
    })
    if (started.code !== 0) {
      port = await freePort()
      registryBase = `http://127.0.0.1:${port}`
      container = `${REGISTRY_NAME}-${port}`
      started = dockerCall({
        docker,
        args: [
          "run",
          "-d",
          "--rm",
          "--name",
          container,
          "-p",
          `127.0.0.1:${port}:${REGISTRY_PORT}`,
          registryImage,
        ],
        cwd,
        timeoutMs,
        run,
      })
    }
    if (started.code !== 0) {
      return proofResult({
        ...base,
        registry: registryBase,
        detail: `o registry de teste nao subiu: ${started.output.split("\n").slice(-1)[0] || "sem saida"}`,
      })
    }
    startedHere = true
  }

  const tmp = mkdtempSync(join(tmpdir(), "prova-image-contract-"))
  const pushed = []
  // O corpo fica numa closure: assim o `finally` (a limpeza) roda ANTES do
  // retorno em TODOS os caminhos — inclusive nos desfechos parciais, que sao
  // justamente os que deixariam o registry escutando numa porta.
  const runCases = async () => {
    if (!(await waitForRegistry(registryBase, { fetchImpl }))) {
      return proofResult({
        ...base,
        registry: registryBase,
        detail: `o registry de teste subiu mas nao respondeu em ${registryBase}/v2/ — sem registry nao ha artefato publicado a medir`,
      })
    }

    const push = (sourceRef, tag) => {
      const dest = `127.0.0.1:${port}/${REGISTRY_NAMESPACE}/${REGISTRY_REPO}:${tag}`
      const tagged = dockerCall({ docker, args: ["tag", sourceRef, dest], cwd, timeoutMs, run })
      if (tagged.code !== 0) return { ok: false, dest, detail: `o tag falhou: ${tagged.output}` }
      const sent = dockerCall({ docker, args: ["push", dest], cwd, timeoutMs, run })
      if (sent.code !== 0)
        return { ok: false, dest, detail: `o push falhou: ${sent.output.split("\n").slice(-1)[0]}` }
      pushed.push(dest)
      return { ok: true, dest }
    }

    const results = []
    for (const spec of CONTRACT_CASES) {
      // A tag do registry de teste e' o proprio id do caso; a unica excecao e' a
      // sabotagem de VERSAO, que NAO muda o artefato (o esperado e' que muda) — e
      // a tag ausente, que nao e' empurrada de proposito.
      let sourceRef = localRef
      let tag = spec.id
      let expectedVersion = version
      if (spec.sabotage === "plugin" || spec.sabotage === "bun-path") {
        const dockerfile = join(tmp, `${spec.id}.Dockerfile`)
        writeFileSync(dockerfile, sabotageDockerfile(spec.sabotage, localRef))
        const dest = `127.0.0.1:${port}/${REGISTRY_NAMESPACE}/${REGISTRY_REPO}:${spec.id}`
        const built = dockerCall({
          docker,
          args: ["build", "-q", "-f", dockerfile, "-t", dest, tmp],
          cwd,
          timeoutMs,
          run,
        })
        if (built.code !== 0) {
          results.push({
            ...classifyCase(spec, {
              state: "unavailable",
              detail: `o build da sabotagem falhou: ${built.output.split("\n").slice(-1)[0]}`,
            }),
            wrong: [
              `o build da sabotagem '${spec.sabotage}' FALHOU — a sabotagem nao existe, e o caso nao mediu nada`,
            ],
            ok: false,
          })
          continue
        }
        sourceRef = dest
      } else if (spec.sabotage === "version") {
        expectedVersion = `${version}-nao-publicada`
      } else if (spec.sabotage === "missing-tag") {
        tag = `${spec.id}-nunca-empurrada`
      }

      if (spec.sabotage !== "missing-tag") {
        const sent = push(sourceRef, tag)
        if (!sent.ok) {
          results.push({
            ...classifyCase(spec, { state: "unavailable", detail: sent.detail }),
            ok: false,
            wrong: [`o artefato do caso nao chegou ao registry — o caso nao mediu nada`],
          })
          continue
        }
      }

      const ref = `${registryBase}/${REGISTRY_NAMESPACE}/${REGISTRY_REPO}:${tag}`
      const result = await check({ ref, expectedVersion, cwd, docker, run, timeoutMs })

      // No CONTROLE os tres fatos sao MEDIDOS dentro do artefato (nao narrados):
      // e' o que transforma "saiu proven" em "o artefato tem o plugin, a versao e
      // o caminho". Sem isso, a marca do bloco provaria o bloco, nao o artefato.
      let measured = null
      if (spec.id === "controle" && result.state === "proven" && result.target) {
        const probe = evidence({ target: result.target, docker, run, timeoutMs, cwd })
        measured = parseEv(probe.output)
        const diverged = []
        if (measured.bunPath !== BUN_PATH)
          diverged.push(`bun-path='${measured.bunPath}' (esperado ${BUN_PATH})`)
        if (measured.bunVersion !== version)
          diverged.push(`bun-version='${measured.bunVersion}' (esperado ${version})`)
        if (!measured.composeVersion || measured.composeVersion === "AUSENTE") {
          diverged.push("compose AUSENTE dentro do artefato")
        }
        if (diverged.length > 0) {
          results.push({
            ...classifyCase(spec, { ...result, findings: measured }),
            ok: false,
            wrong: [
              ...(classifyCase(spec, result).wrong ?? []),
              `os tres fatos NAO foram medidos: ${diverged.join(" · ")}`,
            ],
          })
          continue
        }
      }

      const classified = classifyCase(spec, {
        ...result,
        findings: measured ?? result.findings ?? null,
      })
      results.push(classified)
    }

    const summary = summarizeProof({ cases: results })
    return proofResult({ ...summary, ...base, registry: registryBase, cases: results })
  }

  let payload = null
  let cleanup = null
  try {
    payload = await runCases()
  } finally {
    // Só se remove o que ESTA run subiu: um registry reusado e' de outra run (e
    // , num ambiente que nao pode matar container, sera' reusado de novo).
    cleanup =
      !startedHere || keep ? null : removeRegistry({ docker, container, cwd, timeoutMs, run })
    for (const dest of pushed) dockerCall({ docker, args: ["rmi", dest], cwd, run })
    rmSync(tmp, { recursive: true, force: true })
  }
  return { ...payload, reused, cleanup }
}

/** O relatorio humano — uma linha por caso, com o fato que cada um mediu. */
export function renderReport(result, { emit = console.log } = {}) {
  const line = (s = "") => emit(s)
  line()
  line("prove-image-contract — o contrato da imagem PUBLICADA contra um registry DE VERDADE")
  line(`  alvo    : ${result.ref ?? "<nao resolvido>"} (BUN_VERSION ${result.version ?? "?"})`)
  line(`  env     : ${result.envFile}`)
  line(
    `  registry: ${result.registry ?? "<nao subiu>"} (${result.registryImage}) — docker REAL, sem duble` +
      (result.reused ? " (reusado de uma run anterior)" : ""),
  )
  line()
  for (const c of result.cases) {
    // O ✅/❌ e' do CASO (mediu o que devia?), nao do estado do contrato: um caso
    // cuja sabotagem TEM de ficar vermelha passa exatamente quando o contrato
    // fica vermelho — marcar pelo estado pintaria a prova de vermelho quando ela
    // esta certa (e de verde quando ela nao esta' medindo nada).
    const cMark = c.ok ? "✅" : "❌"
    const spec = CONTRACT_CASES.find((s) => s.id === c.id)
    line(`  ${cMark} ${c.id.padEnd(20)} ${spec ? spec.title : ""}`)
    line(`       ${c.state}: ${c.detail}`)
    if (c.findings) {
      line(
        `       medido dentro do artefato: bun-path=${c.findings.bunPath ?? "?"} · ` +
          `bun-version=${c.findings.bunVersion ?? "?"} · compose=${c.findings.composeVersion ?? "?"}`,
      )
    }
  }
  line()
  line("  ─────────────────────────────────────────────────────────────────")
  const verdictLine =
    result.verdict === "proven"
      ? `  ✅ PROVADO: ${result.detail}`
      : result.verdict === "violated"
        ? `  ❌ VIOLADO: ${result.detail}`
        : `  · INDETERMINADO: ${result.detail}`
  line(verdictLine)
  for (const b of result.blockers) line(`    ❌ ${b}`)
  if (result.cleanup) line(`    ⚠️ limpeza: ${result.cleanup}`)
  line()
  line("  O QUE A PROVA NAO COBRE")
  line('    · o artefato de PRODUCAO: aqui o "publicado" e um artefato empurrado para um registry')
  line(
    "      LOCAL. O que se exercita e o CAMINHO (resolver o digest pelo OCI v2, puxar por digest e",
  )
  line(
    "      rodar o bloco DENTRO do artefato). A build que o GHCR serve HOJE quem mede e o doctor",
  )
  line("      no cron semanal, com a credencial da forja (secao 3/7 do relatorio de prontidao)")
  line("    · o TLS e a CREDENCIAL do pacote privado: o registry local e anonimo e HTTP — o mesmo")
  line("      codigo de probe, mas sem o 401 do GHCR para exercitar")
  line(
    "    · o registry:2 em si: sem a imagem dele (e sem poder baixa-la) a prova sai INDETERMINADA",
  )
  line()
}

export const USAGE = `prove-image-contract — prova que o contrato da imagem PUBLICADA e verificado DE VERDADE

  node scripts/prove-image-contract.mjs [opcoes]

Opcoes:
  --gitea-env <path>     env de onde saem registry/namespace/BUN_VERSION (default: ${DEFAULT_ENV_FILE})
  --image <ref>          imagem base (default: a que o env declara)
  --bun-version <v>      sobrescreve a versao declarada no env (o que \`vars.BUN_VERSION\` daria)
  --build                constroi a imagem se ela nao existir localmente
  --registry-image <ref> imagem do registry de teste (default: ${DEFAULT_REGISTRY_IMAGE})
  --docker <bin>         binario do docker (default: docker)
  --timeout <segundos>   teto por chamada do docker (default: 900)
  --keep                 nao remove o container do registry ao sair (depuracao)
  --json                 mesmo veredito, formato plano
  -h, --help             esta ajuda

Os CINCO casos (o que cada um mede):
  controle ............. o artefato completo sai \`proven\` e os TRES fatos sao medidos dentro dele
  plugin-ausente ....... sem o plugin \`compose\`: \`violated\` NOMEANDO o plugin
  bun-fora-do-caminho .. Bun fora de ${BUN_PATH}: \`violated\` NOMEANDO o caminho
  versao-diferente ..... a versao do artefato != a declarada: \`violated\` NOMEANDO a versao
  tag-ausente .......... tag que o registry nao tem: \`unavailable\` (o 404 nao vira veredito)

Quem faz o que: o doctor (cron) mede o artefato de PRODUCAO; este comando prova, em
ambiente local, que a MEDICAO funciona — com registry e docker de verdade.`

/**
 * @param {string[]} argv
 * @returns {ProofOptions}
 */
export function parseArgs(argv = []) {
  /** @type {ProofOptions} */
  const opts = {
    json: false,
    build: false,
    help: false,
    envFile: DEFAULT_ENV_FILE,
    image: null,
    bunVersion: null,
    registryImage: DEFAULT_REGISTRY_IMAGE,
    timeoutS: 900,
    docker: "docker",
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--json") opts.json = true
    else if (arg === "--build") opts.build = true
    else if (arg === "-h" || arg === "--help") opts.help = true
    else if (arg === "--keep") opts.keep = true
    else if (arg === "--gitea-env" || arg === "--env-file") {
      const value = argv[++i]
      if (!value) return { ...opts, error: `${arg} exige um caminho` }
      opts.envFile = value
    } else if (arg === "--image") {
      const value = argv[++i]
      if (!value) return { ...opts, error: "--image exige uma referencia" }
      opts.image = value
    } else if (arg === "--bun-version") {
      const value = argv[++i]
      if (!value) return { ...opts, error: "--bun-version exige uma versao" }
      opts.bunVersion = value
    } else if (arg === "--registry-image") {
      const value = argv[++i]
      if (!value) return { ...opts, error: "--registry-image exige uma referencia" }
      opts.registryImage = value
    } else if (arg === "--docker") {
      const value = argv[++i]
      if (!value) return { ...opts, error: "--docker exige um binario" }
      opts.docker = value
    } else if (arg === "--timeout") {
      const value = argv[++i]
      const seconds = Number(value)
      if (!value || !Number.isFinite(seconds) || seconds <= 0)
        return { ...opts, error: "--timeout exige segundos > 0" }
      opts.timeoutS = seconds
    } else if (arg.startsWith("-")) {
      return { ...opts, error: `opcao desconhecida: ${arg}` }
    } else {
      return { ...opts, error: `argumento inesperado: ${arg}` }
    }
  }
  return opts
}

export async function main(argv = process.argv.slice(2), { emit = console.log } = {}) {
  const opts = parseArgs(argv)
  if (opts.error) {
    emit(`erro: ${opts.error}`)
    emit(USAGE)
    return EXIT.USAGE
  }
  if (opts.help) {
    emit(USAGE)
    return EXIT.OK
  }
  const result = await proveImageContract(opts)
  if (opts.json) emit(JSON.stringify(result, null, 2))
  else renderReport(result, { emit })
  return exitCodeFor(result.verdict)
}

/* c8 ignore start — o wrapper de CLI (a suite cobre as partes puras e o fluxo injetado) */
export const IS_MAIN =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (IS_MAIN) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(err)
      process.exit(EXIT.UNAVAILABLE)
    },
  )
}
/* c8 ignore stop */
