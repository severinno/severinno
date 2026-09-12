#!/usr/bin/env node
// =============================================================================
// scripts/check-runner-labels.mjs — o registro do act_runner == os labels do
// compose da forja.
//
// POR QUE EXISTE
//
// Os labels do runner (`GITEA_RUNNER_LABELS` em deploy/docker-compose.gitea.yml)
// não são configuração do container: são ESTADO GRAVADO. O act_runner os envia
// ao Gitea NO REGISTRO e, dali em diante, usa os que ficaram em `/data/.runner`
// — ele não relê o compose. O `docker compose up -d runner` recria o container
// com o env NOVO e o arquivo de registro (que vive no volume, e sobrevive ao
// `rm` do container) continua com os labels VELHOS.
//
// O resultado desse descompasso é o pior tipo de falha: NENHUM sintoma. O job
// roda, o setup do Bun funciona, os testes passam — só que na imagem antiga,
// sem o tier-1 (o fast path de 0s), pagando o download em todo job. A forja
// continua verde e mais lenta, para sempre.
//
// O QUE JÁ EXISTIA (e por que não bastava)
//   - `check:registry-source` prova que o compose DECLARA a imagem das
//     variáveis (invariante 6) e que a INTERPOLAÇÃO resolve para a versão certa
//     (invariante 7). Tudo no TEXTO e no render.
//   - `deploy/gitea-up.sh --re-register` sabe APAGAR o registro velho.
//   - O smoke prova (Prova 2) que o tier-1 ENG AJOU — que é o SINTOMA do
//     registro certo. Só o sintoma: quando ele falha, o log diz "a imagem do
//     runner não embarca o Bun", e não "o label registrado aponta para outra
//     imagem". E ele cobre apenas o label que o próprio job pediu
//     (`runs-on: ubuntu-latest`); um segundo label registrado ao lado, ou um
//     label que ninguém usa, não é visto por ninguém.
//
// O QUE ESTE GUARD FAZ
//
// Lê as DUAS pontas e compara:
//   DECLARADO   — o `GITEA_RUNNER_LABELS` RESOLVIDO do compose da forja, pelo
//                 mesmo caminho do invariante 7 (`docker compose config
//                 --format json`, com o env da forja como única fonte) — é o
//                 que a stack DEVERIA ter registrado;
//   REGISTRADO  — o campo `labels` de `/data/.runner` DENTRO do container do
//                 runner em execução (`docker exec ... cat`) — é o que a stack
//                 REALMENTE registrou, e o que decide a imagem de todo job.
//
// A comparação é por NOME de label (o que o `runs-on` pede), e o que se compara
// é a IMAGEM de cada um: um label com o nome certo apontando para a imagem
// velha é exatamente o caso invisível.
//
// POR QUE O ARQUIVO DE REGISTRO (e não a API do Gitea)
//   O Gitea guarda os labels que o runner DECLARA; quem executa o job é o
//   runner, a partir do estado dele. Duas fontes: o arquivo é a que MANDA, e é
//   também a única que sobrevive a um runner que perdeu o contato com a
//   instância. Comparar com o banco provaria o que o servidor acha, não o que
//   vai rodar.
//
// DE ONDE VÊM OS CAMINHOS (nada é cravado aqui)
//   - o nome do container sai do `container_name` do próprio render (o compose
//     é a fonte única); sem ele, o container é procurado pelo service label do
//     compose (`com.docker.compose.service=runner`), que o compose sempre põe;
//   - o arquivo de registro sai do ÚNICO volume NOMEADO do serviço (o socket do
//     docker é bind) — no compose atual, `runner-data:/data` → `/data/.runner`.
//     Com DOIS volumes nomeados o guard NÃO escolhe: ele falha alto, porque ler
//     o arquivo errado e comparar seria pior que não comparar.
//
// INDETERMINADO ≠ DIVERGENTE (a distinção que dá sentido ao exit code)
//   Sem docker, sem o socket dentro do job, sem o container no ar, ou com o
//   registro ilegível, o guard NÃO diz "os labels estão certos": ele diz que
//   não conseguiu olhar (exit 3). "Não sei" nunca vira "conferido" — é a mesma
//   invariante do doctor (`INDETERMINADA` nunca é `PRONTA`).
//
// Usage:
//   node scripts/check-runner-labels.mjs                    # compara e reporta
//   node scripts/check-runner-labels.mjs --json
//   node scripts/check-runner-labels.mjs --gitea-env deploy/.env.gitea
//   node scripts/check-runner-labels.mjs --container gitea-runner
//   node scripts/check-runner-labels.mjs --state-file /data/.runner
//
// ATENÇÃO: a flag do env NÃO se chama `--env-file` de propósito — `--env-file`
// é opção do PRÓPRIO Node (>=20.6) e o runtime a consome ANTES do script rodar
// (mesma armadilha documentada em ensure-runner-image.mjs). Aqui é `--gitea-env`.
//
// Exit codes:
//   0 — PROVADO: o registro é igual ao que o compose declara
//   1 — DIVERGENTE: o registro está velho (ou é de outro compose) — re-registre
//   2 — env/uso: compose da forja, env da forja ou argumento inválido
//   3 — INDETERMINADO: não deu para olhar (docker/compose/socket/container/estado)
// =============================================================================

import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { join } from "node:path"

import { discoverEnvMirrors } from "./check-actrc-sync.mjs"
import { GITEA_COMPOSE } from "./check-bun-mirror.mjs"
import {
  composeAvailable,
  controlledEnv,
  parseComposeRender,
  renderCompose,
  runnerEnvironment,
} from "./check-registry-source.mjs"

/** O serviço do compose cujo registro e cuja imagem estão em julgamento. */
export const RUNNER_SERVICE = "runner"

/**
 * Nome do arquivo de estado do act_runner. É o default do `runner.file` do
 * próprio act_runner (a docs o chama de "registration file"); o compose não o
 * sobrescreve — se sobrescrever, o `--state-file` existe para isso.
 */
export const RUNNER_STATE_BASENAME = ".runner"

/** O label de serviço que o compose põe em todo container que ele cria. */
export const COMPOSE_SERVICE_LABEL = "com.docker.compose.service"

export const EXIT = {
  OK: 0,
  MISMATCH: 1,
  ENV: 2,
  UNKNOWN: 3,
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. Labels: texto → entradas {nome, imagem} (puro)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Parseia uma lista de labels do act_runner nas entradas que a decisão usa.
 *
 * O formato é `<nome>:docker://<imagem>` (job em container) ou `<nome>`
 * (label de host). A separação é feita no `docker://` e NÃO no primeiro `:`,
 * para um registry com porta (`127.0.0.1:5000/...`) não virar um nome de label.
 * Entrada sem `docker://` entra com `image: null`: ela é comparada pelo texto
 * cru, porque "não roda em container" também é uma decisão que muda de um lado
 * para o outro.
 *
 * @param {string|string[]|null|undefined} value
 * @returns {{name: string, image: string|null, raw: string}[]}
 */
export function parseLabelEntries(value) {
  const parts = Array.isArray(value) ? value : String(value ?? "").split(",")
  const entries = []
  for (const part of parts) {
    const raw = String(part).trim()
    if (raw === "") continue
    const at = raw.indexOf("docker://")
    if (at === -1) {
      entries.push({ name: raw, image: null, raw })
      continue
    }
    entries.push({
      name: raw.slice(0, at).replace(/:$/, "").trim(),
      image: raw.slice(at + "docker://".length).trim(),
      raw,
    })
  }
  return entries
}

/**
 * Indexa as entradas por NOME, guardando o CONJUNTO de imagens (um nome
 * repetido com imagens diferentes é divergência, não "o último vence").
 *
 * @param {{name: string, image: string|null, raw: string}[]} entries
 * @returns {Map<string, string[]>}
 */
function indexByName(entries) {
  const index = new Map()
  for (const entry of entries) {
    const key = entry.name !== "" ? entry.name : entry.raw
    const value = entry.image ?? entry.raw
    if (!index.has(key)) index.set(key, [])
    if (!index.get(key).includes(value)) index.get(key).push(value)
  }
  for (const values of index.values()) values.sort()
  return index
}

/**
 * Compara os dois lados por NOME de label. Pura — é o núcleo da decisão.
 *
 * Três divergências distintas, com remédios distintos:
 *   - `missing`   — o compose declara o label e o registro não o tem;
 *   - `mismatch`  — o nome existe nos dois, apontando para IMAGENS diferentes
 *                   (o caso invisível: o `runs-on` casa, a imagem é a velha);
 *   - `extra`     — o registro tem um label que o compose não declara (label
 *                   adicionado à mão na UI, ou resíduo de uma configuração
 *                   anterior).
 *
 * @param {{name: string, image: string|null, raw: string}[]} declared
 * @param {{name: string, image: string|null, raw: string}[]} registered
 * @returns {{
 *   missing: {name: string, declared: string[]}[],
 *   mismatch: {name: string, declared: string, registered: string}[],
 *   extra: {name: string, registered: string[]}[],
 * }}
 */
export function compareLabelSets(declared, registered) {
  const d = indexByName(declared)
  const r = indexByName(registered)
  const missing = []
  const mismatch = []
  const extra = []

  for (const [name, images] of d) {
    if (!r.has(name)) {
      missing.push({ name, declared: images })
      continue
    }
    const other = r.get(name)
    if (images.join(" | ") !== other.join(" | ")) {
      mismatch.push({ name, declared: images.join(" | "), registered: other.join(" | ") })
    }
  }
  for (const [name, images] of r) {
    if (!d.has(name)) extra.push({ name, registered: images })
  }
  return { missing, mismatch, extra }
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. O lado DECLARADO — o render do compose (o mesmo caminho do invariante 7)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * O env da forja que serve de baseline: o arquivo do HOST (`deploy/.env.gitea`)
 * quando existe, senão o template comitado — a mesma escolha do
 * `checkComposeInterpolation`, pelo mesmo motivo (o arquivo do host é o que o
 * compose lê de verdade).
 *
 * @param {string} cwd
 * @returns {{path: string, label: string, deployed: boolean}|null}
 */
export function declaredEnvMirror(cwd) {
  const mirrors = discoverEnvMirrors(cwd)
  return mirrors.find((m) => m.deployed) ?? mirrors[0] ?? null
}

/**
 * Os labels DECLARADOS, já resolvidos pelo próprio docker.
 *
 * @param {{cwd: string, run: Function, envFile?: string|null}} args
 * @returns {{ok: boolean, labels: string|null, detail: string, state?: string, rendered?: object|null}}
 */
export function declaredLabels({ cwd, run, envFile = null }) {
  const mirror = envFile ? { path: envFile, label: envFile } : declaredEnvMirror(cwd)
  if (!mirror) {
    return {
      ok: false,
      labels: null,
      state: "env-missing",
      detail:
        "nenhum env da forja neste checkout (deploy/env.gitea.example ou deploy/.env.gitea) — sem ele o render não tem a fonte única da versão",
    }
  }
  if (!existsSync(mirror.path)) {
    return {
      ok: false,
      labels: null,
      state: "env-missing",
      detail: `env da forja não encontrado: ${mirror.path}`,
    }
  }

  const rendered = renderCompose({
    cwd,
    envFile: mirror.path,
    env: controlledEnv(process.env),
    run,
  })
  if (!rendered.ok) {
    return {
      ok: false,
      labels: null,
      state: "env-missing",
      detail: `${GITEA_COMPOSE} não renderiza com ${mirror.label}: ${rendered.detail}`,
    }
  }
  const parsed = parseComposeRender(rendered.stdout)
  const env = parsed ? runnerEnvironment(parsed) : null
  if (!env) {
    return {
      ok: false,
      labels: null,
      state: "env-missing",
      detail: `${GITEA_COMPOSE}: o render não tem o serviço '${RUNNER_SERVICE}' (ou o environment dele)`,
    }
  }
  return {
    ok: true,
    labels: env.GITEA_RUNNER_LABELS ?? null,
    detail: `declarado em ${mirror.label}`,
    rendered: parsed,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. O lado REGISTRADO — /data/.runner dentro do container em execução
// ═══════════════════════════════════════════════════════════════════════════

/**
 * O diretório, DENTRO do container, onde o registro é gravado: o target do
 * único volume NOMEADO do serviço. Derivado do compose (e não cravado) porque
 * um rename no volume tem de chegar até aqui.
 *
 * Ambiguidade é FALHA, não palpite: com dois volumes nomeados o guard não sabe
 * qual guarda o registro, e ler o arquivo errado é pior que não ler.
 *
 * @param {object|null} rendered
 * @returns {{ok: boolean, target?: string, detail: string}}
 */
export function stateMountTarget(rendered) {
  const mounts = rendered?.services?.[RUNNER_SERVICE]?.volumes
  if (!Array.isArray(mounts)) {
    return { ok: false, detail: `o render não tem os mounts do serviço '${RUNNER_SERVICE}'` }
  }
  const named = mounts.filter((m) => m && m.type === "volume")
  if (named.length === 0) {
    return {
      ok: false,
      detail: `o serviço '${RUNNER_SERVICE}' não monta volume nomeado — o registro não sobreviveria ao container, e não há onde lê-lo`,
    }
  }
  if (named.length > 1) {
    return {
      ok: false,
      detail: `o serviço '${RUNNER_SERVICE}' monta ${named.length} volumes nomeados (${named
        .map((m) => m.target)
        .join(", ")}) — não sei qual guarda o registro; passe --state-file`,
    }
  }
  return { ok: true, target: named[0].target, detail: named[0].target }
}

/** O caminho do registro dentro do container, a partir do target do volume. */
export function stateFilePath(target) {
  return `${String(target).replace(/\/+$/, "")}/${RUNNER_STATE_BASENAME}`
}

/**
 * Interpreta o conteúdo de `/data/.runner`.
 *
 * O arquivo é o estado do act_runner: um JSON com um aviso, os dados do
 * registro e os `labels`. Um arquivo válido SEM o campo `labels` não é erro de
 * leitura — é um runner que ficou sem label nenhum, e a comparação trata isso
 * como divergência (nada casa com o declarado).
 *
 * @param {string} content
 * @returns {{ok: boolean, labels?: string[], detail: string}}
 */
export function parseRunnerState(content) {
  let parsed
  try {
    parsed = JSON.parse(String(content ?? ""))
  } catch (error) {
    return { ok: false, detail: `não é JSON válido (${error.message})` }
  }
  if (!parsed || typeof parsed !== "object") {
    return { ok: false, detail: "o conteúdo não é um objeto JSON" }
  }
  const labels = parsed.labels
  if (labels === undefined || labels === null) {
    return { ok: true, labels: [], detail: "registro sem o campo 'labels'" }
  }
  if (!Array.isArray(labels)) return { ok: false, detail: "o campo 'labels' não é uma lista" }
  return { ok: true, labels: labels.map((l) => String(l)), detail: `${labels.length} label(s)` }
}

/**
 * O nome do container do runner. Fonte primária: o `container_name` do render
 * (declarado no compose). Sem ele, o container é procurado pelo service label
 * que o próprio compose põe — nunca por um nome cravado aqui.
 *
 * @param {{cwd: string, run: Function, rendered: object|null}} args
 * @returns {{ok: boolean, container?: string, detail: string}}
 */
export function resolveRunnerContainer({ cwd, run, rendered }) {
  const declared = rendered?.services?.[RUNNER_SERVICE]?.container_name
  if (typeof declared === "string" && declared.trim() !== "") {
    return { ok: true, container: declared.trim(), detail: `container_name do compose` }
  }

  const res = run(
    "docker",
    [
      "ps",
      "--filter",
      `label=${COMPOSE_SERVICE_LABEL}=${RUNNER_SERVICE}`,
      "--format",
      "{{.Names}}",
    ],
    { cwd, encoding: "utf8", timeout: 30_000 },
  )
  if (res.error) return { ok: false, detail: res.error.message }
  const names = String(res.stdout ?? "")
    .split("\n")
    .map((n) => n.trim())
    .filter(Boolean)
  if (names.length === 0) {
    return {
      ok: false,
      detail: `nenhum container com label=${COMPOSE_SERVICE_LABEL}=${RUNNER_SERVICE} está rodando`,
    }
  }
  return { ok: true, container: names[0], detail: `service label do compose` }
}

/**
 * Lê os labels REGISTRADOS (`/data/.runner`) de dentro do container.
 *
 * O `docker exec` NÃO usa shell: `cat` é resolvido pelo próprio docker, então
 * não há quoting para errar. A distinção "não consegui olhar" × "o registro não
 * existe" é feita pelo texto do erro do `cat` (mesma dependência do aviso do
 * docker em `check:registry-source`, e pelo mesmo motivo: reimplementar a
 * detecção seria inventar uma terceira semântica).
 *
 * @param {{cwd: string, run: Function, container: string, stateFile: string}} args
 * @returns {{ok: boolean, state?: string, labels?: string[], detail: string}}
 */
export function readRegisteredLabels({ cwd, run, container, stateFile }) {
  const res = run("docker", ["exec", container, "cat", stateFile], {
    cwd,
    encoding: "utf8",
    timeout: 30_000,
  })
  if (res.error) return { ok: false, state: "unavailable", detail: res.error.message }
  if (res.status !== 0) {
    const err = String(res.stderr ?? "").trim()
    if (/no such file|cannot find|not found/i.test(err)) {
      return {
        ok: false,
        state: "unregistered",
        detail: `o container '${container}' não tem registro em ${stateFile} — nenhum label registrado (nenhum job seria atribuído a ele)`,
      }
    }
    return {
      ok: false,
      state: "unavailable",
      detail: `docker exec ${container} cat ${stateFile} falhou: ${err.split(/\r?\n/)[0] || `exit ${res.status}`}`,
    }
  }

  const state = parseRunnerState(res.stdout)
  if (!state.ok) {
    return {
      ok: false,
      state: "unavailable",
      detail: `${stateFile} ilegível: ${state.detail}`,
    }
  }
  return { ok: true, labels: state.labels, detail: state.detail }
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. A decisão
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @typedef {object} RunnerLabelsResult
 * @property {string} state      proven | violated | unavailable | env-missing
 * @property {string[]} violations
 * @property {string[]} remedies
 * @property {string} detail
 * @property {string[]} declared
 * @property {string[]} registered
 * @property {string|null} container
 * @property {string|null} stateFile
 */

/**
 * Compara o registro do act_runner com o que o compose da forja declara.
 *
 * @param {{cwd?: string, run?: Function, envFile?: string|null, container?: string|null, stateFile?: string|null}} [options]
 * @returns {RunnerLabelsResult}
 */
export function checkRunnerLabels({
  cwd = process.cwd(),
  run = spawnSync,
  envFile = null,
  container = null,
  stateFile = null,
} = {}) {
  const base = {
    violations: [],
    remedies: [],
    declared: [],
    registered: [],
    container: null,
    stateFile: null,
  }

  if (!existsSync(join(cwd, GITEA_COMPOSE))) {
    return {
      ...base,
      state: "env-missing",
      detail: `${GITEA_COMPOSE} não existe neste checkout — não há stack da forja para comparar`,
    }
  }

  const docker = composeAvailable({ cwd, run })
  if (!docker.ok) {
    return {
      ...base,
      state: "unavailable",
      detail: `docker compose indisponível: ${docker.detail}`,
    }
  }

  const declared = declaredLabels({ cwd, run, envFile })
  if (!declared.ok) {
    return { ...base, state: declared.state ?? "env-missing", detail: declared.detail }
  }

  const declaredEntries = parseLabelEntries(declared.labels)
  const declaredRaw = declaredEntries.map((e) => e.raw)

  const resolvedContainer = container
    ? { ok: true, container, detail: "--container" }
    : resolveRunnerContainer({ cwd, run, rendered: declared.rendered })
  if (!resolvedContainer.ok) {
    return {
      ...base,
      state: "unavailable",
      declared: declaredRaw,
      detail: `não sei qual container ler — ${resolvedContainer.detail}`,
    }
  }

  let path = stateFile
  if (!path) {
    const mount = stateMountTarget(declared.rendered)
    if (!mount.ok) {
      return {
        ...base,
        state: "unavailable",
        declared: declaredRaw,
        container: resolvedContainer.container,
        detail: mount.detail,
      }
    }
    path = stateFilePath(mount.target)
  }

  const registered = readRegisteredLabels({
    cwd,
    run,
    container: resolvedContainer.container,
    stateFile: path,
  })
  if (!registered.ok) {
    if (registered.state === "unregistered") {
      return {
        ...base,
        state: "violated",
        declared: declaredRaw,
        container: resolvedContainer.container,
        stateFile: path,
        detail: registered.detail,
        violations: [registered.detail],
        remedies: [
          "Remédio: `bash deploy/gitea-up.sh --re-register` (garante a imagem, apaga o registro e sobe) — ver deploy/GITEA.md § Runner.",
        ],
      }
    }
    return {
      ...base,
      state: "unavailable",
      declared: declaredRaw,
      container: resolvedContainer.container,
      stateFile: path,
      detail: registered.detail,
    }
  }

  const registeredEntries = parseLabelEntries(registered.labels)
  const registeredRaw = registeredEntries.map((e) => e.raw)
  const diff = compareLabelSets(declaredEntries, registeredEntries)
  const violations = []

  for (const miss of diff.missing) {
    violations.push(
      `o compose declara o label '${miss.name}' e o REGISTRO não o tem (registro: ${miss.declared.join(", ")}) — quem pedir \`runs-on: ${miss.name}\` não encontra este runner`,
    )
  }
  for (const bad of diff.mismatch) {
    violations.push(
      `o label '${bad.name}' está registrado apontando para '${bad.registered}', e o compose declara '${bad.declared}' — o job cai na imagem ANTIGA, sem o Bun pré-instalado (o tier-1 do setup-bun não engaja e o download volta em TODO job, sem outro sintoma)`,
    )
  }
  for (const add of diff.extra) {
    violations.push(
      `o REGISTRO tem o label '${add.name}' (${add.registered.join(", ")}) que o compose não declara — resíduo de um registro anterior ou label adicionado à mão`,
    )
  }

  // Os remédios são SEPARADOS das divergências de propósito: contá-los juntos
  // faria `violations.length` deixar de significar "quantos problemas existem"
  // (a mesma armadilha já corrigida no `check:registry-source`).
  const remedies =
    violations.length > 0
      ? [
          "Remédio: `bash deploy/gitea-up.sh --re-register` (deriva o volume do próprio compose, apaga o registro gravado e sobe) — ver deploy/GITEA.md § Runner.",
          `Se o compose do host for outro arquivo, confirme COMPOSE_FILE: a comparação é contra ${GITEA_COMPOSE} deste checkout.`,
        ]
      : []

  return {
    ...base,
    state: violations.length > 0 ? "violated" : "proven",
    violations,
    remedies,
    declared: declaredRaw,
    registered: registeredRaw,
    container: resolvedContainer.container,
    stateFile: path,
    detail:
      violations.length > 0
        ? `${violations.length} divergência(s) entre o registro e o compose`
        : `${registeredRaw.length} label(s) registrado(s) idênticos ao compose (${declared.detail})`,
  }
}

/** O exit code de um resultado — o CONTRATO da CLI. */
export function exitCodeFor(result) {
  if (result.state === "proven") return EXIT.OK
  if (result.state === "violated") return EXIT.MISMATCH
  if (result.state === "env-missing") return EXIT.ENV
  return EXIT.UNKNOWN
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. Relatório e CLI
// ═══════════════════════════════════════════════════════════════════════════

/** O relatório legível — o MESMO texto na CLI e no smoke. */
export function renderReport(result) {
  const lines = []
  if (result.state === "proven") {
    lines.push(
      `check-runner-labels: ✅ o registro do act_runner é o do compose — ${result.detail}.`,
    )
    lines.push(`  container     : ${result.container} · registro: ${result.stateFile}`)
    for (const label of result.declared) lines.push(`  registrado    : ${label}`)
    return lines.join("\n")
  }
  if (result.state === "violated") {
    lines.push(`check-runner-labels: ❌ ${result.detail}:`)
    for (const v of result.violations) lines.push(`  - ${v}`)
    for (const r of result.remedies) lines.push(`  → ${r}`)
    lines.push(`  declarado pelo compose : ${result.declared.join(" , ") || "<nenhum>"}`)
    lines.push(`  registrado no runner   : ${result.registered.join(" , ") || "<nenhum>"}`)
    return lines.join("\n")
  }
  lines.push(
    `check-runner-labels: ⚠️ NÃO PROVADO (${result.state}) — o registro NÃO foi comparado com o compose.`,
  )
  lines.push(`  ${result.detail}`)
  return lines.join("\n")
}

const USAGE = `Uso: node scripts/check-runner-labels.mjs [opções]

  --gitea-env <path>   env da forja a usar como baseline (default: o do host, se existir, senão o template)
  --container <nome>   container do runner (default: o container_name do compose)
  --state-file <path>  caminho do registro DENTRO do container (default: <volume nomeado>/.runner)
  --json               saída estruturada
  -h, --help           esta ajuda

Exit codes:
  0 PROVADO · 1 DIVERGENTE · 2 env/uso · 3 INDETERMINADO`

/**
 * @param {string[]} argv
 * @returns {{envFile: string|null, container: string|null, stateFile: string|null, json: boolean, help: boolean, error?: string}}
 */
export function parseArgs(argv) {
  const opts = { envFile: null, container: null, stateFile: null, json: false, help: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--gitea-env") opts.envFile = argv[++i] ?? null
    else if (arg === "--container") opts.container = argv[++i] ?? null
    else if (arg === "--state-file") opts.stateFile = argv[++i] ?? null
    else if (arg === "--json") opts.json = true
    else if (arg === "-h" || arg === "--help") opts.help = true
    else if (arg.startsWith("-")) return { ...opts, error: `argumento desconhecido: ${arg}` }
  }
  return opts
}

const isMain =
  !!process.argv[1] && process.argv[1].split(/[\\/]/).pop() === "check-runner-labels.mjs"

if (isMain) {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.help) {
    console.log(USAGE)
    process.exit(EXIT.OK)
  }
  if (opts.error) {
    console.error(`check-runner-labels: ${opts.error}`)
    console.error(USAGE)
    process.exit(EXIT.ENV)
  }

  const result = checkRunnerLabels(opts)
  const code = exitCodeFor(result)

  if (opts.json) {
    console.log(JSON.stringify({ ...result, exitCode: code }, null, 2))
  } else {
    console.log(renderReport(result))
  }
  process.exit(code)
}
