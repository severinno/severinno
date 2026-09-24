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
// A TERCEIRA PERGUNTA AO MESMO CONTAINER — a VERSÃO do binário × a TAG que o
// compose declara (o irmão do pin do runner do GitHub). O container do
// act_runner NÃO se auto-atualiza: quem decide a versão do binário é a IMAGEM
// declarada, e uma tag que não declara versão (`latest`) deixa a stack subir
// qualquer build que o `docker pull` do dia tiver servido — sem uma linha do
// repositório mudar e sem sintoma nenhum na forja. MEDIDO em 22/09/2026: a tag
// `latest` reporta `v0.6.1` e a `0.2.11` reporta `v0.2.11`, com as duas imagens
// no disco e o compose sem dizer qual delas a stack sobe. Ver a seção 3b: a tag
// que não pina versão sai `floating` (declaração pendente, nunca verde) e a que
// pina outra que a que roda sai `drift` (exit 1, com o remédio de alinhar a tag
// ou trazer o container para ela).
//
// POR QUE O ARQUIVO DE REGISTRO (e não a API do Gitea)
//   O Gitea guarda os labels que o runner DECLARA; quem executa o job é o
//   runner, a partir do estado dele. Duas fontes: o arquivo é a que MANDA, e é
//   também a única que sobrevive a um runner que perdeu o contato com a
//   instância. Comparar com o banco provaria o que o servidor acha, não o que
//   vai rodar.
//
// A OUTRA FORJA (o runner auto-hospedado do GitHub), e por que ela precisa
// deste guard: lá o registro NÃO tem arquivo. `RunnerSettings` (o `.runner` do
// actions/runner) guarda AgentId/AgentName/PoolName/ServerUrl — e nenhum label:
// os labels do runner do GitHub vivem no SERVIDOR, mandados no `config.sh
// --labels`. Então a comparação usa a API (`GET
// /repos/<owner>/<repo>/actions/runners`, o mesmo estado que ATRIBUI job) contra
// o `RUNNER_LABELS` de `deploy/setup-github-runner.sh` (a fonte única do
// repositório: nada é cravado aqui), por NOME e case-insensitive (a API devolve
// `Linux`/`X64` para o que o script declara em minúsculas — comparar caixa
// seria alarme falso). Mesmos estados, mesmos exit codes e mesmo silêncio
// proibido: sem token de self-hosted runners, é INDETERMINADO (3), nunca
// "em sincronia". Detalhe (a leitura, os estados e por que OFFLINE conta) na
// seção 4 deste arquivo.
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
// CONJUNTO VAZIO NÃO É SINCRONIA (o caso que passava por omissão)
//   "Igual ao compose" com ZERO labels dos dois lados é uma verdade VACUA — e o
//   sintoma dela é o pior possível: um runner ÓRFÃO (rodando, registrado, sem
//   label nenhum) existe na instância e não é atribuído a job algum, enquanto o
//   relatório imprime ✅. O mesmo vale para o lado declarado: um compose que
//   perdeu a variável `GITEA_RUNNER_LABELS` não tem o que comparar — e
//   comparar vazio com vazio nunca é prova de que a stack está no ar.
//   Nos dois casos o estado é DIVERGENTE (exit 1), com o remédio de CADA um:
//   registro vazio ⇒ re-registrar (o registro só pega os labels na subida);
//   compose sem a variável ⇒ declarar os labels e depois re-registrar.
//
// Usage:
//   node scripts/check-runner-labels.mjs                    # compara e reporta (forja)
//   node scripts/check-runner-labels.mjs --json
//   node scripts/check-runner-labels.mjs --gitea-env deploy/.env.gitea
//   node scripts/check-runner-labels.mjs --container gitea-runner
//   node scripts/check-runner-labels.mjs --state-file /data/.runner
//   node scripts/check-runner-labels.mjs --forge github     # runner do GitHub (API)
//   node scripts/check-runner-labels.mjs --forge github --runner-name hostinger-runner
//
// ATENÇÃO: a flag do env NÃO se chama `--env-file` de propósito — `--env-file`
// é opção do PRÓPRIO Node (>=20.6) e o runtime a consome ANTES do script rodar
// (mesma armadilha documentada em ensure-runner-image.mjs). Aqui é `--gitea-env`.
//
// Exit codes (os mesmos nas duas forjas):
//   0 — PROVADO: o registro é igual ao declarado (nos DOIS lados, com pelo menos
//       um label de cada lado)
//   1 — DIVERGENTE: o registro está velho (ou é de outro declarante), está VAZIO
//       (runner órfão), o runner não existe/está OFFLINE (GitHub) ou a
//       declaração não tem label nenhum — re-registre e/ou declare os labels
//   2 — env/uso: compose/env da forja ausente, repo do GitHub desconhecido ou
//       argumento inválido
//   3 — INDETERMINADO: não deu para olhar (docker/compose/socket/container/estado,
//       ou sem token de self-hosted runners no GitHub)
// =============================================================================

import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
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
 * A FORMA DECLARADA de apontar o container do runner — a variável que os DOIS
 * consumidores leem (este guard e o `forge-doctor`, que o chama por dentro).
 *
 * O nome do container saía só do `container_name` do compose, e isso amarra a
 * medição à STACK: o container tem de ser o dela, com o nome que ela usa. Uma
 * SONDA (o ensaio da metade da VERSÃO contra um container de teste — a imagem
 * pinada, o binário de outra build — ou um runner de outra stack) não tinha como
 * se declarar sem TOMAR o nome da stack.
 *
 * `--container` (a CLI) continua ganhando dela, e ela ganha do compose:
 * DECLARADO vence derivado, e a FONTE sai dita no veredito.
 */
export const RUNNER_CONTAINER_ENV = "GITEA_RUNNER_CONTAINER"

/**
 * O nome do container do runner, na ordem: DECLARADO (`--container`/a variável) →
 * o `container_name` do render (declarado no compose) → o service label que o
 * próprio compose põe. Nunca um nome cravado aqui.
 *
 * @param {{cwd: string, run: Function, rendered: object|null, declarado?: string|null}} args
 * @returns {{ok: boolean, container?: string, detail: string}}
 */
export function resolveRunnerContainer({ cwd, run, rendered, declarado = null }) {
  const nomeDeclarado = typeof declarado === "string" ? declarado.trim() : ""
  if (nomeDeclarado !== "") {
    return { ok: true, container: nomeDeclarado, detail: `declarado por ${RUNNER_CONTAINER_ENV}` }
  }

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
// 3b. A VERSÃO do binário × a TAG que o compose declara
// ═══════════════════════════════════════════════════════════════════════════
//
// POR QUE ESTA METADE EXISTE (o outro lado do pin do GitHub): o container do
// act_runner NÃO se auto-atualiza — quem decide a versão do binário é a IMAGEM
// que o compose declara. E é aí que mora a classe: o compose da forja declarava
// `gitea/act_runner:latest`, e `latest` NÃO é uma versão — é o nome de uma
// PROMESSA. O `docker compose pull` de um dia qualquer troca a versão que roda
// sem uma linha do repositório mudar, e nada no relatório dizia QUAL versão o
// runner usa hoje. MEDIDO em 22/09/2026 neste host: `gitea/act_runner:latest`
// reportava `v0.6.1`, e a tag `0.2.11` (que já foi puxada aqui) reporta
// `v0.2.11` — as duas imagens conviviam no disco, e era o compose que não dizia
// qual delas a stack sobe. O REMÉDIO foi aplicado no mesmo dia: a tag virou
// `gitea/act_runner:0.6.1`, que é o MESMO digest que o `latest` do dia servia
// (medido: sha256:b5c35d6d…; e `v0.6.1` NÃO existe no registry — `not found`,
// ou seja, o `v` seria um pin quebrado). Com a imagem pinada, a leitura do
// binário mede `0.6.1 = tag 0.6.1 (proven)`, e o que muda no veredito é o
// estado quando NÃO há container para ler: deixa de ser `floating` (declaração
// pendente, o remédio era o pin) e passa a ser `unread` (o que RODA não foi
// julgado — a leitura é da stack).
//
// A comparação é por VALOR (`v0.6.1` e `0.6.1` são a mesma versão — o `v` de
// uma tag de release e espaço em volta não são drift), e ela tem SEIS estados
// porque as causas têm remédios diferentes:
//   - `proven`   — a tag declara uma VERSÃO e o binário do container reporta ela;
//   - `drift`    — a tag declara uma versão e o binário reporta OUTRA: o que roda
//                  não é o que o repositório declara (a imagem não foi puxada de
//                  novo, ou o volume/container é de outro dia). É a mesma classe
//                  do pin recusado do GitHub, e BLOQUEIA;
//   - `floating` — a tag NÃO é uma versão (`latest`, `stable`, ...): não há pin
//                  com que comparar. Não é verde nem divergência — é uma
//                  declaração que o repositório ainda não fez, e ela sai no
//                  veredito com o remédio (pin a tag à versão que roda hoje);
//   - `digest`   — a imagem é pinada por DIGEST (`repo@sha256:…`): o que roda é
//                  IMUTÁVEL (o digest é o conteúdo), mas um digest não declara
//                  VERSÃO — esta comparação não se aplica. Ele existe porque
//                  jogá-lo em `floating` faria o relatório AFIRMAR que "a versão
//                  que roda é a que o docker pull do dia tiver servido", o que é
//                  falso para um digest: mentira de régua, não de dado;
//   - `no-image` — o render não declara imagem nenhuma para o serviço do runner;
//   - `unread`   — o binário não reportou a versão (o `docker exec` falhou, ou a
//                  saída não tem versão nenhuma).
//
// `floating`, `digest`, `no-image` e `unread` NUNCA viram `proven`: "não deu para
// julgar" não é "está certo" (a invariante do INDETERMINADO do doctor, dentro do
// guard).

/**
 * A versão que o BINÁRIO reporta, lida da saída do `act_runner --version`.
 *
 * O formato é do próprio binário (`act_runner version v0.6.1`, medido nas duas
 * imagens deste host) e a leitura é tolerante de propósito: rótulo, `v` de
 * prefixo, build info depois, quebras de linha. O que ela NÃO faz é inventar —
 * sem um token com dígitos e pontos a leitura é `null`, e o estado vira
 * `unread` ("não deu para julgar"), nunca uma versão chutada.
 *
 * @param {unknown} stdout o stdout do `act_runner --version`
 * @returns {string|null} a versão normalizada, ou null
 */
export function parseRunnerBinaryVersion(stdout) {
  const texto = String(stdout ?? "")
  const casado = /\bv?(\d+(?:\.\d+)+)\b/.exec(texto)
  return casado ? normalizeRunnerVersion(casado[1]) : null
}

/**
 * Lê a versão do binário DENTRO do container em execução.
 *
 * O caminho do binário é `/usr/local/bin/act_runner` (medido na imagem), e o
 * `docker exec` NÃO usa shell: o nome é resolvido pelo PATH do container, então
 * não há quoting para errar — a mesma decisão do `cat` do registro. "Não
 * consegui olhar" (docker fora, container parado) é `unavailable`; uma saída sem
 * versão é `unread`; as duas são ausência de prova, nunca "em sincronia".
 *
 * @param {{cwd: string, run: Function, container: string}} args
 * @returns {{ok: boolean, version?: string|null, state?: string, detail: string}}
 */
export function readRunnerBinaryVersion({ cwd, run, container }) {
  const res = run("docker", ["exec", container, "act_runner", "--version"], {
    cwd,
    encoding: "utf8",
    timeout: 30_000,
  })
  if (res.error) return { ok: false, state: "unavailable", detail: res.error.message }
  if (res.status !== 0) {
    const err = String(res.stderr ?? "").trim()
    return {
      ok: false,
      state: "unavailable",
      detail: `docker exec ${container} act_runner --version falhou: ${err.split(/\r?\n/)[0] || `exit ${res.status}`}`,
    }
  }
  const version = parseRunnerBinaryVersion(res.stdout)
  if (version === null) {
    return {
      ok: false,
      state: "unread",
      detail: `o binario do container '${container}' nao reportou versao nenhuma em \`act_runner --version\` (saida: ${
        String(res.stdout ?? "")
          .trim()
          .split(/\r?\n/)[0] || "<vazia>"
      })`,
    }
  }
  return { ok: true, version, detail: `o binario reporta ${version}` }
}

/**
 * A TAG de uma referência de imagem (`repo:tag`), ou `null` quando ela não tem
 * uma.
 *
 * A distinção importa: um registry com PORTA (`git.exemplo.cloud:5000/x/y`) tem
 * `:` que NÃO separa tag — a tag é o que vem depois do último `:` que aparece
 * DEPOIS da última barra. Sem tag, o docker assume `latest`, e é isso que o
 * guard diz (o `null` vira `floating` no comparador, pela mesma regra).
 *
 * @param {unknown} ref
 * @returns {string|null}
 */
export function imageTag(ref) {
  const texto = String(ref ?? "").trim()
  if (texto === "") return null
  // Um DIGEST não é uma tag (`repo@sha256:abc…` tem `:` e não tem tag): a régua
  // daqui é `repo:tag`, e quem trata o digest é o `compareActRunnerVersion`,
  // ANTES desta função — devolver o hash como "tag" faria a comparação acusar
  // uma tag que não existe.
  if (imageDigest(texto) !== null) return null
  const barra = texto.lastIndexOf("/")
  const doisPontos = texto.lastIndexOf(":")
  if (doisPontos <= barra) return null
  const tag = texto.slice(doisPontos + 1).trim()
  return tag === "" ? null : tag
}

/**
 * O DIGEST de uma referência de imagem (`repo@sha256:…`), ou `null`.
 *
 * O `@` é o separador do digest no formato OCI — uma referência pode ter os dois
 * (`repo:1.2.3@sha256:…`), e aí ela declara uma tag E um conteúdo; o digest é o
 * que está depois do `@`. É ele que decide o estado `digest` da comparação.
 *
 * @param {unknown} ref
 * @returns {string|null} o algoritmo+hash (`sha256:…`), ou `null`
 */
export function imageDigest(ref) {
  const texto = String(ref ?? "").trim()
  const arroba = texto.lastIndexOf("@")
  if (arroba < 0) return null
  const digest = texto.slice(arroba + 1).trim()
  return /^[a-z0-9]+:[0-9a-f]{16,}$/i.test(digest) ? digest : null
}

/**
 * A tag DECLARA uma versão? (`0.6.1`, `v0.6.1` — e não `latest`/`stable`.)
 *
 * A régua é a FORMA, não uma lista de nomes flutuantes: uma tag que não é
 * número-pontuado não pina versão nenhuma, e uma lista à mão deixaria passar a
 * próxima tag de fantasia que alguém inventar. O `latest` implícito (imagem sem
 * tag) cai aqui pela mesma porta.
 *
 * @param {unknown} tag
 * @returns {boolean}
 */
export function isVersionTag(tag) {
  return /^v?\d+(?:\.\d+)*$/.test(String(tag ?? "").trim())
}

/**
 * A VERSÃO do binário × a TAG DECLARADA no compose — pura, e é o núcleo desta
 * metade (o irmão do `compareRunnerVersion`, e com um estado a mais).
 *
 * O estado `floating` é o que a forja mediu: sem ele, ou o guard diria verde
 * ("a declaração está cumprida") sobre uma tag que não declara nada, ou acusaria
 * um drift que ninguém pode consertar sem decidir QUAL versão a stack sobe. Ele é
 * uma DECLARAÇÃO PENDENTE, e é assim que o doctor o publica.
 *
 * `digest` é o par do `floating` num mundo pinado por conteúdo: uma imagem
 * `repo@sha256:…` não deixa dúvida sobre o que roda, mas o digest NÃO diz versão
 * — a comparação de versão simplesmente não se aplica, e o estado o declara em
 * vez de forçar um "floating" cuja prosa ("a versão que roda é a que o docker
 * pull do dia tiver servido") seria falsa.
 *
 * @param {{declaredImage?: unknown, reported?: unknown, container?: string|null}} args
 * @returns {{state: string, declared: string|null, tag: string|null, reported: string|null, detail: string}}
 */
export function compareActRunnerVersion({
  declaredImage = null,
  reported = null,
  container = null,
  fonte = null,
}) {
  const imagem = String(declaredImage ?? "").trim()
  // A FONTE do container é dita ao lado do nome: uma SONDA declarada não é o
  // container da stack, e o veredito da versão não pode se confundir com ela.
  const onde = container ? ` no container '${container}'${fonte ? ` (${fonte})` : ""}` : ""
  const tag = imageTag(imagem)
  const reportada = normalizeRunnerVersion(reported)
  if (imagem === "") {
    return {
      state: "no-image",
      declared: null,
      tag: null,
      reported: reportada,
      detail: `o render de ${GITEA_COMPOSE} nao declara a imagem do servico '${RUNNER_SERVICE}' — sem ela nao ha versao declarada para comparar com a que o binario reporta`,
    }
  }
  const digest = imageDigest(imagem)
  if (digest !== null) {
    return {
      state: "digest",
      declared: imagem,
      // Uma referência pode declarar os DOIS (`repo:1.2.3@sha256:…`): a tag
      // continua sendo informação (é ela que um humano lê), mas quem pina o
      // conteúdo é o digest — por isso o estado não é `proven` nem `drift`.
      tag: imageTag(imagem.slice(0, imagem.lastIndexOf("@"))) ?? null,
      reported: reportada,
      detail: `a imagem declarada do runner e '${imagem}' — pinada por DIGEST (${digest}): o que roda e IMUTAVEL, e por isso nao ha "o que o docker pull do dia serviu"; mas um digest NAO declara VERSAO nenhuma${reportada ? ` (o binario reporta ${reportada} hoje)` : ""}, entao o repositorio declara o CONTEUDO e nao a versao que a stack sobe — alinhe a tag (ou mova o pin para uma tag que declare versao) para que a versao que roda seja comparavel`,
    }
  }
  if (!isVersionTag(tag)) {
    return {
      state: "floating",
      declared: imagem,
      // A tag como ela está declarada (`latest`, ou `null` quando a imagem não
      // tem tag nenhuma): o ESTADO é que diz que ela não pina versão — apagá-la
      // aqui faria o relatório dizer "tag não declarada" sobre uma imagem que
      // declara exatamente `latest`.
      tag: tag ?? null,
      reported: reportada,
      detail: `a imagem declarada do runner e '${imagem}' e a tag '${tag ?? "(nenhuma — o docker assume latest)"}' NAO declara versao nenhuma: a versao que roda e a que o docker pull do dia tiver servido${reportada ? ` (o binario reporta ${reportada} hoje)` : ""} — nada no repositorio diz QUAL delas a stack sobe`,
    }
  }
  if (reportada === null) {
    return {
      state: "unread",
      declared: imagem,
      tag,
      reported: null,
      detail: `a tag declarada pina ${tag}, e a versao do binario${onde} NAO foi lida — o que roda NAO foi julgado contra o que o repositorio declara`,
    }
  }
  if (normalizeRunnerVersion(tag) === reportada) {
    return {
      state: "proven",
      declared: imagem,
      tag,
      reported: reportada,
      detail: `versao ${reportada} = a tag declarada em ${GITEA_COMPOSE}`,
    }
  }
  return {
    state: "drift",
    declared: imagem,
    tag,
    reported: reportada,
    detail: `o binario do runner${onde} reporta '${reportada}' e ${GITEA_COMPOSE} declara a tag '${tag}': o que RODA nao e o que o repositorio declara`,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. A OUTRA FORJA — o runner auto-hospedado do GitHub
// ═══════════════════════════════════════════════════════════════════════════
//
// POR QUE (o mesmo registro velho, e aqui ele é invisível POR CONSTRUÇÃO):
// o act_runner GRAVA os labels em /data/.runner — é por isso que a seção 3 os
// consegue ler de dentro do container. O runner do GitHub NÃO grava nada: em
// `actions/runner`, a estrutura persistida (`.runner`, `RunnerSettings` em
// `src/Runner.Common/ConfigurationStore.cs`) tem AgentId, AgentName, PoolName,
// ServerUrl, GitHubUrl, WorkFolder — e NENHUM campo de labels. Os labels do
// runner do GitHub vivem no SERVIDOR (mandados no `config.sh --labels` e
// guardados só lá): o arquivo local prova IDENTIDADE, nunca a atribuição de jobs.
//
// A consequência é a MESMA falha da forja, sem a leitura que a denuncia:
// `deploy/setup-github-runner.sh` declara `RUNNER_LABELS=...` e registra com
// `--replace`. Um runner re-registrado à mão (ou um host restaurado de backup,
// ou um `config.sh` sem `--labels`) fica com OUTRA lista, e nada no repositório
// percebe: o workflow que pede um label que sumiu não falha — ele ESPERA, para
// sempre, e o que já existe continua verde.
//
// A ponte é a API: `GET /repos/<owner>/<repo>/actions/runners` devolve, por
// runner, `status` (online/offline) e `labels[]` — o estado que ATRIBUI job, o
// mesmo papel que o arquivo tem na forja. Compara-se o lado DECLARADO (o
// `RUNNER_LABELS` do script de setup: a fonte única do repositório) com esse
// estado, por NOME e CASE-INSENSITIVE: a API normaliza os labels que o próprio
// GitHub cria (`Linux`, `X64`) e a docs diz que label não diferencia maiúsculas
// — comparar `linux` × `Linux` seria um alarme FALSO, e alarme falso é o que
// ensina a ignorar o guard.
//
// CREDENCIAL, e o que ela custa: a lista de runners exige permissão de
// self-hosted runners no REPOSITÓRIO (PAT clássico com scope `repo`, ou
// fine-grained com 'Self-hosted runners: read'). O `GITHUB_TOKEN` de um run NÃO
// tem esse escopo — e por isso, sem token, o guard diz INDETERMINADO (exit 3,
// "não olhei"), nunca "em sincronia". As variáveis são as MESMAS do
// `apply-required-checks.mjs` (GITHUB_TOKEN/GH_TOKEN, GITHUB_API_URL) — uma
// credencial, um vocabulário.
//
// O REPO, e por que ele NÃO sai do `GITHUB_REPOSITORY`: o canal do GitHub é
// `GH_REPOSITORY` (o mesmo do `githubReadConfig`, do board e do doctor). O runner
// da forja EMULA o contexto do GitHub — lá `GITHUB_REPOSITORY` é o repositório DO
// GITEA, e lê-lo aqui consultaria o registro de OUTRO repositório (a resposta
// seria o registro vazio de um repo que não é o nosso, publicada como se fosse o
// nosso). O `apply-required-checks` aceita `--repo` pelo mesmo motivo; aqui a
// precedência é `--gh-repo` > o `REPO_URL` do script (fonte comitada) >
// `GH_REPOSITORY` — e a ausência dos três é `env-missing` NOMEANDO o canal.
//
// A TERCEIRA PERGUNTA AO MESMO REGISTRO — a VERSÃO registrada × o PIN do
// script. O payload da API traz, por runner, o campo `version`: é a versão que o
// SERVIÇO aceitou (o runner se atualiza sozinho para ela). O `RUNNER_VERSION` de
// `deploy/setup-github-runner.sh` é o pin que o repositório declara, e os dois
// TÊM de casar. MEDIDO em 22/09/2026: com o pin em 2.320.0 o runner registrou,
// pegou o primeiro job e se AUTO-ATUALIZOU para 2.337.0 no MEIO dele — o update
// derruba o worker, o job fica PRESO em `in_progress` segurando o único runner
// (o cancel do run e o remove do runner respondem 422 "is currently running a
// job"), e nada no repositório percebia: a forja ficou parada, não vermelha.
//
// Um pin recusado é a pior classe de defeito — ele só aparece no meio de um job,
// longe de quem o declarou. A comparação aqui o nomeia ANTES, e ela é por VALOR
// (o `v` de `v2.337.0` e espaço em volta não são drift). As TRÊS respostas são
// separadas de propósito (labels e versão, em listas distintas) porque os
// remédios são diferentes: re-registrar resolve o REGISTRO, e alinhar o PIN é o
// que resolve a versão. "Não deu para julgar" (script sem o pin, ou API sem o
// campo `version`) NUNCA vira "em sincronia": sai com o estado próprio (`no-pin`
// / `unread`), que o doctor publica como não-provado.

/** O script que DECLARA o runner do GitHub: fonte única dos labels, do nome e do repo. */
export const GITHUB_RUNNER_SCRIPT = "deploy/setup-github-runner.sh"

/** O host da API — o mesmo default (e a mesma variável) do `apply-required-checks`. */
export const DEFAULT_GITHUB_API_URL = "https://api.github.com"

/**
 * O valor de uma atribuição de shell simples (`NOME="valor"`) do script.
 *
 * O script é a FONTE ÚNICA do que o runner do GitHub deveria ter registrado, e
 * ler o texto dele é a alternativa a cravar a lista aqui — duas verdades
 * divergiriam no dia do bump. O regex exige a linha inteira (`^...$` em modo
 * multiline) para não casar um `RUNNER_LABELS` citado dentro de um comentário ou
 * de um `echo`.
 *
 * @param {string} text
 * @param {string} name
 * @returns {string|null}
 */
export function shellAssignment(text, name) {
  const re = new RegExp(`^\\s*${name}=("|')?([^"'\\n]*)\\1\\s*$`, "m")
  const match = re.exec(String(text ?? ""))
  return match ? match[2].trim() : null
}

/**
 * `https://github.com/owner/name(.git)` → `owner/name` (a forma que a API pede).
 *
 * @param {string|null} url
 * @returns {string|null}
 */
export function repoFromUrl(url) {
  const match = /^https?:\/\/[^/]+\/([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/.exec(
    String(url ?? "").trim(),
  )
  return match ? match[1] : null
}

/**
 * O lado DECLARADO do GitHub, lido do script de setup — nada é cravado aqui.
 *
 * O `version` é o PIN da versão do runner (`RUNNER_VERSION`), a segunda
 * declaração que o serviço tem de aceitar: ela é lida do MESMO texto, pelo mesmo
 * `shellAssignment` (linha inteira, sem casar comentário) e não é cravada aqui.
 *
 * @param {string} text
 * @returns {{labels: string|null, entries: ReturnType<typeof parseLabelEntries>, name: string|null, repoUrl: string|null, repo: string|null, version: string|null}}
 */
export function parseGithubRunnerSetup(text) {
  const labels = shellAssignment(text, "RUNNER_LABELS")
  const repoUrl = shellAssignment(text, "REPO_URL")
  return {
    labels,
    entries: parseLabelEntries(labels),
    name: shellAssignment(text, "RUNNER_NAME"),
    repoUrl,
    repo: repoFromUrl(repoUrl),
    version: shellAssignment(text, "RUNNER_VERSION"),
  }
}

/**
 * As entradas com o NOME e o VALOR COMPARADO em caixa baixa.
 *
 * Labels do GitHub não diferenciam maiúsculas — a API devolve `Linux`/`X64`
 * para o que o script declara em minúsculas, e comparar caixa reportaria um
 * drift que não existe (o alarme falso que faz o operador parar de ler). O
 * `raw` continua o ORIGINAL: é ele que o relatório mostra, para o leitor ver o
 * registro como ele está lá.
 *
 * O valor vai para `image` mesmo quando não há `docker://` (a comparação de um
 * label de host é pelo TEXTO, e `compareLabelSets` usa `image ?? raw`):
 * normalizar só o `name` deixaria `linux` × `Linux` caindo em `mismatch`.
 *
 * @param {{name: string, image: string|null, raw: string}[]} entries
 * @returns {{name: string, image: string, raw: string}[]}
 */
export function normalizeLabelEntries(entries) {
  return entries.map((e) => ({
    name: String(e.name).toLowerCase(),
    image: String(e.image ?? e.raw).toLowerCase(),
    raw: e.raw,
  }))
}

/**
 * @typedef {object} GithubRunner
 * @property {number|string|null} id
 * @property {string} name
 * @property {string} status   online | offline | unknown
 * @property {string[]} labels os NOMES dos labels (a API os devolve como objetos)
 * @property {string} version  a versão que o SERVIÇO aceitou (a que o runner usa)
 */

/**
 * A lista de runners do payload da API, na forma que a decisão usa.
 *
 * O `version` é lido aqui porque é ele que o SERVIÇO aceitou: é o valor que o
 * pin do script tem de casar (a classe medida em 22/09/2026 — o runner se
 * auto-atualiza no meio do primeiro job quando o pin é recusado). Ausente no
 * payload vira string vazia, e a comparação trata isso como "não julgado" —
 * nunca como "em sincronia".
 *
 * @param {unknown} payload
 * @returns {{ok: boolean, runners?: GithubRunner[], detail: string}}
 */
export function parseGithubRunners(payload) {
  const runners = payload && typeof payload === "object" ? payload.runners : null
  if (!Array.isArray(runners)) {
    return { ok: false, detail: "a resposta da API não tem a lista 'runners'" }
  }
  return {
    ok: true,
    detail: `${runners.length} runner(s)`,
    runners: runners.map((r) => ({
      id: r?.id ?? null,
      name: String(r?.name ?? ""),
      status: String(r?.status ?? "unknown"),
      version: String(r?.version ?? ""),
      labels: (Array.isArray(r?.labels) ? r.labels : [])
        .map((l) => String(l?.name ?? ""))
        .filter(Boolean),
    })),
  }
}

/**
 * Uma versão de runner comparável: tira espaço e um `v` de prefixo.
 *
 * A comparação é por VALOR (o `v2.337.0` de uma tag e o `2.337.0` que a API
 * devolve são a MESMA versão) — comparar o texto cru faria alarme falso e o
 * operador aprenderia a ignorar o guard.
 *
 * @param {unknown} value
 * @returns {string|null} a versão normalizada, ou null sem valor
 */
export function normalizeRunnerVersion(value) {
  const texto = String(value ?? "").trim()
  if (texto === "") return null
  return texto.replace(/^v/i, "")
}

/**
 * A VERSÃO REGISTRADA × O PIN DO SCRIPT — pura, e é o núcleo desta metade.
 *
 * Os quatro estados existem porque as três causas são diferentes, e cada uma tem
 * um remédio (e um leitor) diferente:
 *   - `proven`  — o registro responde a versão que o script pina;
 *   - `drift`   — o serviço RECUSOU o pin (o registro está em outra versão). É o
 *                 defeito medido: o runner se auto-atualiza no meio do primeiro
 *                 job, derruba o worker e o job fica preso segurando o runner;
 *   - `no-pin`  — o script não declara `RUNNER_VERSION`: não há pin com que
 *                 comparar (a declaração é legível sem rede, e é daqui que o
 *                 remédio sai);
 *   - `unread`  — a API não devolveu o campo `version` deste runner.
 *
 * `no-pin` e `unread` NÃO são `proven`: "não deu para julgar" nunca vira "está
 * certo" (a invariante do INDETERMINADO do doctor, dentro do guard).
 *
 * @param {{pin: unknown, registered: unknown, runnerName?: string|null}} args
 * @returns {{state: string, pin: string|null, registered: string|null, detail: string}}
 */
export function compareRunnerVersion({ pin, registered, runnerName = null }) {
  const pino = normalizeRunnerVersion(pin)
  const registrada = normalizeRunnerVersion(registered)
  const onde = runnerName ? ` do runner '${runnerName}'` : ""
  if (pino === null) {
    return {
      state: "no-pin",
      pin: null,
      registered: registrada,
      detail: `${GITHUB_RUNNER_SCRIPT} NAO declara RUNNER_VERSION — sem o pin nao ha com que comparar a versao registrada${onde}`,
    }
  }
  if (registrada === null) {
    return {
      state: "unread",
      pin: pino,
      registered: null,
      detail: `a API nao devolveu o campo 'version'${onde} — a versao registrada NAO foi julgada (o pin declara ${pino})`,
    }
  }
  if (pino === registrada) {
    return {
      state: "proven",
      pin: pino,
      registered: registrada,
      detail: `versao ${registrada} = o pin de ${GITHUB_RUNNER_SCRIPT}`,
    }
  }
  return {
    state: "drift",
    pin: pino,
    registered: registrada,
    detail: `o servico RECUSOU o pin:${onde} o registro responde '${registrada}' e ${GITHUB_RUNNER_SCRIPT} pina '${pino}'`,
  }
}

/**
 * Escolhe o runner do registro pelo NOME declarado no script.
 *
 * AMBIGUIDADE É FALHA, não palpite — a mesma regra dos dois volumes nomeados na
 * seção 3: com mais de um runner registrado e sem `RUNNER_NAME` no script, ler
 * "um deles" e comparar seria pior que não comparar.
 *
 * @param {GithubRunner[]} runners
 * @param {string|null} name
 * @returns {{ok: boolean, runner?: GithubRunner, state?: string, detail: string, found?: string[]}}
 */
export function selectGithubRunner(runners, name) {
  const found = runners.map((r) => r.name)
  if (runners.length === 0) {
    return {
      ok: false,
      state: "none",
      found,
      detail: "nenhum runner auto-hospedado registrado no repositório",
    }
  }
  if (name) {
    const named = runners.filter((r) => r.name.toLowerCase() === String(name).toLowerCase())
    if (named.length === 1)
      return { ok: true, runner: named[0], found, detail: `runner '${named[0].name}'` }
    if (named.length === 0) {
      return {
        ok: false,
        state: "missing",
        found,
        detail: `nenhum runner chamado '${name}' (registrados: ${found.join(", ")})`,
      }
    }
    return {
      ok: false,
      state: "ambiguous",
      found,
      detail: `${named.length} runners chamados '${name}' — não sei qual comparar`,
    }
  }
  if (runners.length === 1)
    return { ok: true, runner: runners[0], found, detail: `runner '${runners[0].name}'` }
  return {
    ok: false,
    state: "ambiguous",
    found,
    detail: `${runners.length} runners registrados (${found.join(", ")}) e ${GITHUB_RUNNER_SCRIPT} não declara RUNNER_NAME — não sei qual comparar`,
  }
}

/**
 * `GET /repos/<owner>/<repo>/actions/runners` — o estado que ATRIBUI job.
 *
 * Nunca lança: erro de rede, 401/403 (sem permissão de self-hosted runners) e
 * 404 são "não olhei", não "está certo" nem "divergente".
 *
 * @param {{apiUrl?: string, repo: string, token: string, fetchImpl?: Function}} args
 * @returns {Promise<{ok: boolean, data?: object, detail: string}>}
 */
export async function fetchGithubRunners({
  apiUrl = DEFAULT_GITHUB_API_URL,
  repo,
  token,
  fetchImpl = fetch,
} = {}) {
  const path = `/repos/${repo}/actions/runners`
  let res
  try {
    res = await fetchImpl(`${String(apiUrl).replace(/\/+$/, "")}${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    })
  } catch (err) {
    return { ok: false, detail: `a API do GitHub não respondeu: ${err?.message ?? String(err)}` }
  }
  if (!res.ok) {
    const hint =
      res.status === 401 || res.status === 403 || res.status === 404
        ? " — a lista de runners exige permissão de SELF-HOSTED RUNNERS no repositório (PAT clássico com scope `repo`, ou fine-grained com 'Self-hosted runners: read'). O GITHUB_TOKEN de um run NÃO tem esse escopo."
        : ""
    let body = ""
    try {
      body = String((await res.text?.()) ?? "").slice(0, 200)
    } catch {
      body = ""
    }
    return {
      ok: false,
      detail: `GET ${path} → HTTP ${res.status}${body ? `: ${body}` : ""}${hint}`,
    }
  }
  let data
  try {
    data = await res.json()
  } catch (err) {
    return { ok: false, detail: `a resposta da API não é JSON (${err?.message ?? String(err)})` }
  }
  return { ok: true, data }
}

/**
 * @typedef {object} GithubRunnerLabelsResult
 * @property {string} state      proven | violated | unavailable | env-missing
 * @property {string[]} violations
 * @property {string[]} remedies
 * @property {string} detail
 * @property {string[]} declared    os labels que o script declara
 * @property {string[]} registered  os que a API devolveu (vazio se não houve seleção)
 * @property {string[]} versionViolations as divergências da VERSÃO registrada × o PIN
 *                                   do script (lista PRÓPRIA: `violations` é dos
 *                                   labels, e `violations.length` significa
 *                                   "quantos problemas de label existem")
 * @property {{state: string, pin: string|null, registered: string|null, detail: string}|null} version
 *                                   a comparação da versão (null quando nenhum
 *                                   runner chegou a ser selecionado)
 * @property {string|null} runner    o runner comparado (null se nenhum foi selecionado)
 * @property {string|null} status    online/offline do runner comparado
 * @property {string|null} repo      owner/nome consultado
 * @property {string} apiUrl
 * @property {string} forge
 */

/**
 * O relatório do GitHub: o registro declarado × o que a API devolve.
 *
 * Mesma tri-estado e mesmos exit codes da forja (0 provado, 1 divergente,
 * 2 env/uso, 3 não olhei). O que NÃO é igual, e está dito no header, é a fonte
 * do lado registrado: aqui não existe arquivo a ler — o servidor é a única
 * fonte, e o arquivo local do runner (`.runner`) nem tem campo de labels.
 *
 * @param {{cwd?: string, env?: object, token?: string|null, apiUrl?: string|null, repo?: string|null, runnerName?: string|null, fetchImpl?: Function}} [options]
 * @returns {Promise<GithubRunnerLabelsResult>}
 */
export async function checkGithubRunnerLabels({
  cwd = process.cwd(),
  env = process.env,
  token = null,
  apiUrl = null,
  repo = null,
  runnerName = null,
  fetchImpl = fetch,
} = {}) {
  const base = {
    forge: "github",
    violations: [],
    // As violações da VERSÃO ficam numa lista PRÓPRIA: `violations` é a lista
    // que as mensagens do registro (labels) consomem, e `violations.length`
    // significa "quantos problemas de LABEL existem". Somar as duas faria o
    // número deixar de significar o que ele diz — a mesma armadilha já corrigida
    // no `check:registry-source` e no remédio da forja.
    versionViolations: [],
    version: null,
    remedies: [],
    declared: [],
    registered: [],
    runner: null,
    status: null,
    repo: null,
    apiUrl: null,
  }

  const scriptPath = join(cwd, GITHUB_RUNNER_SCRIPT)
  if (!existsSync(scriptPath)) {
    return {
      ...base,
      state: "env-missing",
      detail: `${GITHUB_RUNNER_SCRIPT} não existe neste checkout — não há runner do GitHub declarado aqui`,
    }
  }

  const setup = parseGithubRunnerSetup(readFileSync(scriptPath, "utf8"))
  const declaredEntries = setup.entries
  const declaredRaw = declaredEntries.map((e) => e.raw)
  // O CANAL do GitHub, e não o `GITHUB_REPOSITORY` do contexto compartilhado
  // (que no runner da forja aponta para o repositório do Gitea): ver o cabeçalho.
  const resolvedRepo = repo ?? setup.repo ?? env.GH_REPOSITORY ?? null
  const resolvedApiUrl = apiUrl ?? env.GH_API_URL ?? env.GITHUB_API_URL ?? DEFAULT_GITHUB_API_URL
  const resolvedToken = token ?? env.GH_TOKEN ?? env.GITHUB_TOKEN ?? null

  const reRegister =
    "Remédio: `bash deploy/setup-github-runner.sh` — ele registra com `--replace` e o registro passa a ter os labels do script (ver deploy/GITHUB_RUNNER.md)."

  // O lado DECLARADO é legível sem rede: um script que perdeu a variável é
  // PROVADO aqui, exatamente como o compose sem `GITEA_RUNNER_LABELS` na forja.
  if (declaredEntries.length === 0) {
    const side =
      setup.labels === null
        ? `${GITHUB_RUNNER_SCRIPT} NÃO declara RUNNER_LABELS`
        : `${GITHUB_RUNNER_SCRIPT} declara RUNNER_LABELS VAZIO`
    return {
      ...base,
      state: "violated",
      repo: resolvedRepo,
      apiUrl: resolvedApiUrl,
      declared: [],
      violations: [
        `${side}: um runner sem label nenhum não recebe job algum — nem o \`runs-on: self-hosted\` que TODO workflow deste repositório pede. Sem a declaração não há o que comparar com o registro.`,
      ],
      remedies: [
        `Remédio: declare RUNNER_LABELS em ${GITHUB_RUNNER_SCRIPT} e SÓ ENTÃO re-registre — o registro só pega os labels no config.sh.`,
        reRegister,
      ],
      detail: `${GITHUB_RUNNER_SCRIPT} não tem labels a comparar`,
    }
  }

  // Sem saber QUAL repositório, a API não tem a quem perguntar: é falta de
  // ambiente (2), e não uma conclusão sobre o registro.
  if (!resolvedRepo) {
    return {
      ...base,
      state: "env-missing",
      apiUrl: resolvedApiUrl,
      declared: declaredRaw,
      detail: `não sei qual repositório consultar: ${GITHUB_RUNNER_SCRIPT} não declara REPO_URL e GH_REPOSITORY (o canal do GitHub) não está no ambiente (ou use --gh-repo owner/name) — o \`GITHUB_REPOSITORY\` do contexto compartilhado NÃO é lido: no runner da forja ele aponta para o repositório do Gitea`,
    }
  }

  // Sem credencial, a leitura do registro é impossível — e isso é "não olhei"
  // (3), nunca "em sincronia". O token mora no ambiente, nunca no arquivo.
  if (!resolvedToken) {
    return {
      ...base,
      state: "unavailable",
      repo: resolvedRepo,
      apiUrl: resolvedApiUrl,
      declared: declaredRaw,
      detail:
        "sem token de self-hosted runners no ambiente (GITHUB_TOKEN ou GH_TOKEN): a lista de runners do repo exige permissão de SELF-HOSTED RUNNERS (PAT clássico com scope `repo`, ou fine-grained com 'Self-hosted runners: read') — o GITHUB_TOKEN de um run NÃO a tem",
    }
  }

  const fetched = await fetchGithubRunners({
    apiUrl: resolvedApiUrl,
    repo: resolvedRepo,
    token: resolvedToken,
    fetchImpl,
  })
  if (!fetched.ok) {
    return {
      ...base,
      state: "unavailable",
      repo: resolvedRepo,
      apiUrl: resolvedApiUrl,
      declared: declaredRaw,
      detail: fetched.detail,
    }
  }
  const parsed = parseGithubRunners(fetched.data)
  if (!parsed.ok) {
    return {
      ...base,
      state: "unavailable",
      repo: resolvedRepo,
      apiUrl: resolvedApiUrl,
      declared: declaredRaw,
      detail: `resposta inesperada da API: ${parsed.detail}`,
    }
  }

  // A FLAG manda sobre o script (mesma ordem do `--gh-repo` e do `--container`
  // na forja): quem passa `--runner-name` quer inquirir AQUELE runner.
  const selected = selectGithubRunner(parsed.runners, runnerName ?? setup.name)
  if (!selected.ok) {
    const tail =
      selected.state === "none"
        ? "sem um runner registrado nenhum job é atribuído: todo `runs-on` fica ESPERANDO para sempre em vez de falhar"
        : "o registro é o que atribui job a runner: sem o runner declarado, o workflow espera para sempre em vez de falhar"
    return {
      ...base,
      state: "violated",
      repo: resolvedRepo,
      apiUrl: resolvedApiUrl,
      declared: declaredRaw,
      registered: [],
      violations: [`${selected.detail} — ${tail}`],
      remedies: [reRegister],
      detail: `${GITHUB_RUNNER_SCRIPT} declara ${declaredEntries.length} label(s) e o repositório não tem o runner declarado`,
    }
  }

  const runner = selected.runner
  const registeredEntries = parseLabelEntries(runner.labels)
  const diff = compareLabelSets(
    normalizeLabelEntries(declaredEntries),
    normalizeLabelEntries(registeredEntries),
  )
  // O nome ORIGINAL, para a mensagem citar o registro como ele está lá.
  const orig = new Map([
    ...declaredEntries.map((e) => [e.name.toLowerCase(), e.raw]),
    ...registeredEntries.map((e) => [e.name.toLowerCase(), e.raw]),
  ])
  const named = (name) => orig.get(String(name).toLowerCase()) ?? name
  const violations = []
  const versionViolations = []

  // Registrado mas OFFLINE é o "runner órfão" desta forja: existe no painel,
  // não pega job. Tem remédio próprio (e é a causa do "no runner available").
  if (runner.status !== "online") {
    violations.push(
      `o runner '${runner.name}' está registrado como '${runner.status}' (não 'online'): ele existe no painel e NÃO pega job — todo \`runs-on: self-hosted\` fica esperando (é a causa do "no runner available" que o deploy/GITHUB_RUNNER.md manda investigar)`,
    )
  }
  // CONJUNTO VAZIO NÃO É SINCRONIA, e aqui vale o mesmo raciocínio da forja: um
  // registro com ZERO labels não são "4 labels faltando" — são UM problema com
  // causa própria (o runner subiu sem nada). `violations.length` tem de
  // significar "quantos problemas existem".
  if (registeredEntries.length === 0) {
    violations.push(
      `o runner '${runner.name}' está registrado com NENHUM label (runner órfão) e o setup declara ${declaredEntries.length} (${declaredEntries.map((e) => e.raw).join(" , ")}): existe no painel e nenhum job é atribuído a ele — nem o \`runs-on: self-hosted\` que todo workflow deste repositório pede`,
    )
  }
  for (const miss of registeredEntries.length === 0 ? [] : diff.missing) {
    violations.push(
      `o setup declara o label '${named(miss.name)}' e o REGISTRO não o tem (registro: ${registeredEntries.map((e) => e.raw).join(" , ")}) — um job com \`runs-on: ${named(miss.name)}\` não encontra este runner: ele ESPERA, e nada falha`,
    )
  }
  for (const bad of diff.mismatch) {
    violations.push(
      `o label '${named(bad.name)}' está registrado apontando para '${bad.registered}', e o setup declara '${bad.declared}' — o job cai em outra imagem do que o repositório declara`,
    )
  }
  for (const add of diff.extra) {
    violations.push(
      `o REGISTRO tem o label '${named(add.name)}' (${add.registered.join(", ")}) que o setup não declara — resíduo de um registro anterior ou label adicionado à mão: nenhum \`runs-on\` deste repositório o pede, e é por onde um runner passa a apontar para outra coisa sem ninguém ver`,
    )
  }

  // ── A VERSÃO registrada × o PIN do script ────────────────────────────────
  //
  // A terceira pergunta ao MESMO registro, e a única cujo sintoma aparece LONGE
  // daqui: um pin recusado não deixa a forja vermelha — o runner se auto-atualiza
  // no meio do primeiro job, derruba o worker e o job fica PRESO segurando o
  // único runner (medido: 2.320.0 → 2.337.0, e o cancel/remove respondem 422
  // "is currently running a job"). Só o pin alinhado à versão que o serviço
  // aceita evita isso, e é o que esta comparação vigia.
  const version = compareRunnerVersion({
    pin: setup.version,
    registered: runner.version,
    runnerName: runner.name,
  })
  if (version.state === "drift") {
    versionViolations.push(
      `${version.detail} — o pin que o servico recusa se AUTO-ATUALIZA no meio do primeiro job: o update derruba o worker e o job fica PRESO em in_progress segurando o runner (o cancel do run e o remove do runner respondem 422 'is currently running a job')`,
    )
  }

  const versionRemedies = versionViolations.length
    ? [
        `Remédio: alinhe \`RUNNER_VERSION\` em ${GITHUB_RUNNER_SCRIPT} à versão que o serviço aceita (o \`version\` do registro é legível na própria API) e SÓ ENTÃO re-registre — o pin é o que o config.sh baixa.`,
      ]
    : []
  const remedies =
    violations.length === 0 && versionViolations.length === 0
      ? []
      : runner.status !== "online" && violations.length > 0
        ? [
            `Remédio: no host do runner, \`sudo systemctl restart actions.runner.*\` e \`journalctl -u actions.runner.*\` para ver por que ele não conectou — ver deploy/GITHUB_RUNNER.md § Troubleshooting.`,
            reRegister,
            ...versionRemedies,
          ]
        : [reRegister, ...versionRemedies]

  const problemas = violations.length + versionViolations.length
  return {
    ...base,
    state: problemas > 0 ? "violated" : "proven",
    violations,
    versionViolations,
    version,
    remedies,
    declared: declaredRaw,
    registered: registeredEntries.map((e) => e.raw),
    runner: runner.name,
    status: runner.status,
    repo: resolvedRepo,
    apiUrl: resolvedApiUrl,
    detail:
      problemas > 0
        ? violations.length > 0
          ? `${problemas} problema(s) entre o registro do GitHub e o que ${GITHUB_RUNNER_SCRIPT} declara`
          : `${version.detail} — a forja fica PARADA, nao vermelha`
        : `${registeredEntries.length} label(s) registrado(s) idênticos ao setup, em '${runner.name}' (${runner.status})`,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. A decisão
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @typedef {object} RunnerLabelsResult
 * @property {string} state      proven | violated | unavailable | env-missing
 * @property {string[]} violations
 * @property {string[]} versionViolations  o drift da VERSÃO do binário (remédio PRÓPRIO: a TAG)
 * @property {{state: string, tag: string|null, reported: string|null, detail: string}|null} version  a versão do binário × a tag do compose
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
 * @param {{cwd?: string, run?: Function, envFile?: string|null, container?: string|null,
 *   stateFile?: string|null, env?: Record<string, string | undefined>}} [options]
 * @returns {RunnerLabelsResult}
 */
export function checkRunnerLabels({
  cwd = process.cwd(),
  run = spawnSync,
  envFile = null,
  container = null,
  stateFile = null,
  env = process.env,
} = {}) {
  const base = {
    violations: [],
    versionViolations: [],
    version: null,
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

  // O container do runner: `--container` (a CLI) → a variável DECLARADA
  // (`RUNNER_CONTAINER_ENV`, a mesma forma nos dois consumidores) → o compose. A
  // `fonte` viaja até o veredito da VERSÃO: quem mediu uma sonda contra a tag
  // pinada precisa de saber que o container NÃO é o da stack.
  const doAmbiente =
    typeof env?.[RUNNER_CONTAINER_ENV] === "string" ? env[RUNNER_CONTAINER_ENV] : null
  const resolvedContainer = container
    ? { ok: true, container, detail: "--container" }
    : resolveRunnerContainer({ cwd, run, rendered: declared.rendered, declarado: doAmbiente })
  const fonteDoContainer = container
    ? "--container"
    : resolvedContainer.ok
      ? resolvedContainer.detail
      : null
  if (!resolvedContainer.ok) {
    return {
      ...base,
      state: "unavailable",
      declared: declaredRaw,
      detail: `não sei qual container ler — ${resolvedContainer.detail}`,
    }
  }

  // ── A VERSÃO do binário × a TAG do compose ────────────────────────────────
  //
  // Lida AQUI (com o container já resolvido e ANTES do registro): a versão é um
  // fato do CONTAINER, não do arquivo de registro — e assim ela existe em TODOS
  // os caminhos que chegaram a resolver um container, inclusive o do runner que
  // subiu sem registro nenhum. `floating` (a tag não pina versão) não bloqueia:
  // é uma DECLARAÇÃO PENDENTE, e o veredito a publica como não-provado — o que
  // bloqueia é o `drift` (a tag declara uma versão e o que RODA é outra).
  const reported = readRunnerBinaryVersion({
    cwd,
    run,
    container: resolvedContainer.container,
  })
  const version = compareActRunnerVersion({
    declaredImage: declared.rendered?.services?.[RUNNER_SERVICE]?.image ?? null,
    reported: reported.ok ? reported.version : null,
    container: resolvedContainer.container,
    fonte: fonteDoContainer,
  })
  const versionViolations = []
  if (version.state === "drift") {
    versionViolations.push(
      `${version.detail} — a versao do act_runner e a do BINARIO dentro da imagem: com a tag declarada apontando para outra build, os labels podem ate casar e o runner roda outra versao (foi a classe medida no pin do GitHub: 2.320.0 -> 2.337.0, o job fica preso segurando o unico runner)`,
    )
  }
  const versionRemedies = versionViolations.length
    ? [
        `Remédio: alinhe a tag da imagem do runner em ${GITEA_COMPOSE} (ou traga o container para a versao declarada com \`docker compose pull runner && docker compose up -d runner\`) — a versao do binario vem da IMAGEM, e o container nao se auto-atualiza.`,
      ]
    : []

  let path = stateFile
  if (!path) {
    const mount = stateMountTarget(declared.rendered)
    if (!mount.ok) {
      return {
        ...base,
        state: "unavailable",
        declared: declaredRaw,
        container: resolvedContainer.container,
        version,
        versionViolations,
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
        version,
        versionViolations,
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
      version,
      versionViolations,
      detail: registered.detail,
    }
  }

  const registeredEntries = parseLabelEntries(registered.labels)
  const registeredRaw = registeredEntries.map((e) => e.raw)
  const diff = compareLabelSets(declaredEntries, registeredEntries)
  const violations = []

  // ── CONJUNTO VAZIO NÃO É SINCRONIA ────────────────────────────────────────
  //
  // "Igual ao compose" com ZERO labels dos DOIS lados é verdade VACUA, e o
  // guard imprimia ✅ para ela. O sintoma é o pior tipo: um runner ÓRFÃO (no ar,
  // registrado, sem label nenhum) não recebe job algum — a forja fica parada — e
  // o smoke dava "prova de sincronia". Pelo outro lado, um compose que perdeu
  // `GITEA_RUNNER_LABELS` não tem o que comparar: comparar vazio com vazio não
  // prova que a stack está no ar. Cada um dos casos tem remédio PRÓPRIO, e é por
  // isso que eles são decididos antes do diff por nome.
  if (declaredEntries.length === 0) {
    // "Não declara" e "declara vazio" têm o mesmo EFEITO e consertos diferentes
    // de leitura: o primeiro é a variável ausente do serviço, o segundo é uma
    // variável que sobrou vazia (um env que não interpolou). A mensagem diz qual.
    const side =
      declared.labels === null
        ? `o compose NÃO declara GITEA_RUNNER_LABELS no serviço '${RUNNER_SERVICE}'`
        : `o compose declara GITEA_RUNNER_LABELS VAZIO no serviço '${RUNNER_SERVICE}'`
    violations.push(
      `${side} (o render de ${GITEA_COMPOSE} resolve um conjunto VAZIO): um runner sem label nenhum não recebe job algum — nem o \`runs-on: ubuntu-latest\` deste smoke encontraria este runner. O registro tem ${registeredRaw.length > 0 ? `${registeredRaw.length} label(s) (${registeredRaw.join(" , ")})` : "NENHUM label — runner órfão: existe na instância e não é atribuído a job nenhum"}`,
    )
  } else if (registeredEntries.length === 0) {
    violations.push(
      `o runner está RODANDO e não tem NENHUM label registrado em ${path}: é um runner órfão — existe na instância e nenhum job é atribuído a ele. O compose declara ${declaredEntries.length} label(s) (${declaredEntries.map((e) => e.name).join(", ")}), e a subida registrou zero deles (nada do que o compose declara chegou ao registro)`,
    )
  } else {
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
  }

  // Os remédios são SEPARADOS das divergências de propósito: contá-los juntos
  // faria `violations.length` deixar de significar "quantos problemas existem"
  // (a mesma armadilha já corrigida no `check:registry-source`).
  const reRegister =
    "Remédio: `bash deploy/gitea-up.sh --re-register` (deriva o volume do próprio compose, apaga o registro gravado e sobe) — ver deploy/GITEA.md § Runner."
  const remedies =
    violations.length === 0
      ? []
      : declaredEntries.length === 0
        ? [
            `Remédio: declare GITEA_RUNNER_LABELS no serviço '${RUNNER_SERVICE}' de ${GITEA_COMPOSE} (o invariante 6 já exige a imagem da VARIÁVEL: \`ubuntu-latest:docker://\${IMAGE_REGISTRY:-git.severinno.cloud}/\${IMAGE_NAMESPACE:-severinno}/ubuntu-bun:\${BUN_VERSION}\`) e só então re-registre — o registro só pega os labels na SUBIDA.`,
            reRegister,
            `Se o compose do host for outro arquivo, confirme COMPOSE_FILE: a comparação é contra ${GITEA_COMPOSE} deste checkout.`,
          ]
        : [
            reRegister,
            `Se o compose do host for outro arquivo, confirme COMPOSE_FILE: a comparação é contra ${GITEA_COMPOSE} deste checkout.`,
          ]

  const problemas = violations.length + versionViolations.length
  return {
    ...base,
    state: problemas > 0 ? "violated" : "proven",
    violations,
    versionViolations,
    version,
    remedies:
      problemas === 0
        ? []
        : violations.length > 0
          ? [...remedies, ...versionRemedies]
          : versionRemedies,
    declared: declaredRaw,
    registered: registeredRaw,
    container: resolvedContainer.container,
    stateFile: path,
    detail:
      problemas > 0
        ? violations.length > 0
          ? declaredEntries.length === 0
            ? `o compose não tem labels a comparar (${declared.detail})`
            : registeredEntries.length === 0
              ? `o registro do runner está VAZIO e o compose declara ${declaredEntries.length} label(s)`
              : `${problemas} divergência(s) entre o registro e o compose`
          : `${version.detail} — a forja roda outra versao do que o repositorio declara`
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
// 6. Relatório e CLI
// ═══════════════════════════════════════════════════════════════════════════

/** O relatório legível — o MESMO texto na CLI e no smoke. */
export function renderReport(result) {
  const lines = []

  // O lado do GitHub tem outra origem de leitura (o servidor, não o container),
  // então o relatório diz QUAL forja está sendo julgada. O texto da forja
  // continua byte a byte o mesmo: o smoke o consome.
  if (result.forge === "github") {
    const where = result.runner
      ? `${result.runner} (${result.status})`
      : "nenhum runner selecionado"
    const registry = `repos/${result.repo}/actions/runners`
    const versao =
      result.version === null || result.version === undefined
        ? null
        : `  versao        : ${result.version.registered ?? "<nao lida>"} ${result.version.state === "proven" ? "=" : "!="} pin ${result.version.pin ?? "<nao declarado>"} (${result.version.state})`
    if (result.state === "proven") {
      lines.push(
        `check-runner-labels[github]: ✅ o runner auto-hospedado está registrado com os labels do setup — ${result.detail}.`,
      )
      lines.push(`  runner        : ${where} · api: ${registry}`)
      lines.push(`  declarado     : ${result.declared.join(" , ") || "<nenhum>"}`)
      lines.push(`  registrado    : ${result.registered.join(" , ") || "<nenhum>"}`)
      if (versao) lines.push(versao)
      return lines.join("\n")
    }
    if (result.state === "violated") {
      lines.push(`check-runner-labels[github]: ❌ ${result.detail}:`)
      for (const v of result.violations) lines.push(`  - ${v}`)
      for (const v of result.versionViolations ?? []) lines.push(`  - ${v}`)
      for (const r of result.remedies) lines.push(`  → ${r}`)
      lines.push(`  declarado pelo setup    : ${result.declared.join(" , ") || "<nenhum>"}`)
      lines.push(`  registrado no GitHub    : ${result.registered.join(" , ") || "<nenhum>"}`)
      if (result.runner) lines.push(`  runner                  : ${where}`)
      // A versão ao lado do registro TAMBÉM no estado vermelho: é ela que diz se
      // o defeito é o registro (labels) ou o PIN que o serviço recusou.
      if (versao) lines.push(versao)
      return lines.join("\n")
    }
    lines.push(
      `check-runner-labels[github]: ⚠️ NÃO PROVADO (${result.state}) — o registro do GitHub NÃO foi comparado com o setup.`,
    )
    lines.push(`  ${result.detail}`)
    return lines.join("\n")
  }

  // A VERSÃO do binário × a TAG do compose: a segunda pergunta ao MESMO
  // container, e a que diz se o defeito é o REGISTRO (labels) ou a IMAGEM
  // (versão que roda). Sai nos TRÊS desfechos — é ela que explica um vermelho
  // sem nenhuma violação de label.
  const versao =
    result.version === null || result.version === undefined
      ? null
      : `  versao        : ${result.version.reported ?? "<nao lida>"} ${result.version.state === "proven" ? "=" : "!="} tag ${result.version.tag ?? "<nao declarada>"} (${result.version.state})`

  if (result.state === "proven") {
    lines.push(
      `check-runner-labels: ✅ o registro do act_runner é o do compose — ${result.detail}.`,
    )
    lines.push(`  container     : ${result.container} · registro: ${result.stateFile}`)
    for (const label of result.declared) lines.push(`  registrado    : ${label}`)
    if (versao) lines.push(versao)
    return lines.join("\n")
  }
  if (result.state === "violated") {
    lines.push(`check-runner-labels: ❌ ${result.detail}:`)
    for (const v of result.violations) lines.push(`  - ${v}`)
    for (const v of result.versionViolations ?? []) lines.push(`  - ${v}`)
    for (const r of result.remedies) lines.push(`  → ${r}`)
    lines.push(`  declarado pelo compose : ${result.declared.join(" , ") || "<nenhum>"}`)
    lines.push(`  registrado no runner   : ${result.registered.join(" , ") || "<nenhum>"}`)
    if (versao) lines.push(versao)
    return lines.join("\n")
  }
  lines.push(
    `check-runner-labels: ⚠️ NÃO PROVADO (${result.state}) — o registro NÃO foi comparado com o compose.`,
  )
  lines.push(`  ${result.detail}`)
  if (versao) lines.push(versao)
  return lines.join("\n")
}

const USAGE = `Uso: node scripts/check-runner-labels.mjs [opções]

  --forge <gitea|github>  qual forja comparar (default: gitea)

  forja (act_runner, lê o registro DENTRO do container):
  --gitea-env <path>   env da forja a usar como baseline (default: o do host, se existir, senão o template)
  --container <nome>   container do runner (default: a variável GITEA_RUNNER_CONTAINER,
                       e depois o container_name do compose)
    a variável GITEA_RUNNER_CONTAINER é a forma DECLARADA de apontar o container
    nos DOIS consumidores (aqui e no forge-doctor): é o que deixa uma SONDA (um
    container de teste com a imagem pinada) medir a metade da VERSÃO sem tomar o
    nome que a stack usa. O declarado VENCE o derivado (--container > variável >
    compose), e a fonte sai dita no veredito.
  --state-file <path>  caminho do registro DENTRO do container (default: <volume nomeado>/.runner)
    a VERSÃO sai do comando act_runner --version (docker exec) e é comparada com
    a TAG da imagem que o RENDER do compose declara: uma tag que NAO declara
    versao (latest) sai 'floating' — nunca verde, nunca divergencia —, e uma tag
    que declara versao e nao é a que o binario reporta sai 'drift' (exit 1)

  github (runner auto-hospedado; o registro vive no SERVIDOR, não em arquivo):
  --gh-repo <owner/nome>  repositório a consultar (default: o REPO_URL do script de setup)
  --runner-name <nome>    runner a comparar (default: o RUNNER_NAME do script de setup)
    credenciais do ambiente: GITHUB_TOKEN | GH_TOKEN, GH_API_URL, GH_REPOSITORY
    (as MESMAS do apply-required-checks; a lista de runners exige permissão de
     self-hosted runners no repo — o GITHUB_TOKEN de um run não a tem; e o REPO
     vem do canal GH_REPOSITORY, nunca do GITHUB_REPOSITORY compartilhado,
     que no runner da forja aponta para o repositório do Gitea)

  --json               saída estruturada
  -h, --help           esta ajuda

Exit codes (os mesmos nas duas forjas):
  0 PROVADO · 1 DIVERGENTE · 2 env/uso · 3 INDETERMINADO`

/**
 * @param {string[]} argv
 * @returns {{forge: string, envFile: string|null, container: string|null, stateFile: string|null, ghRepo: string|null, runnerName: string|null, json: boolean, help: boolean, error?: string}}
 */
export function parseArgs(argv) {
  const opts = {
    forge: "gitea",
    envFile: null,
    container: null,
    stateFile: null,
    ghRepo: null,
    runnerName: null,
    json: false,
    help: false,
  }
  /**
   * O valor de uma flag de valor. Uma flag ENGOLIDA como valor (`--gh-repo
   * --json`) seria comparada como se fosse o nome do runner, e a mensagem
   * mandaria caçar um drift que não existe.
   */
  const valueOf = (i, flag) => {
    const v = argv[i + 1]
    if (v === undefined || v.startsWith("--")) return { error: `${flag} exige um valor` }
    return { value: v }
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    let consumed = null
    const take = (flag, key) => {
      const r = valueOf(i, flag)
      if (r.error) return r
      opts[key] = r.value
      i++
      return null
    }
    if (arg === "--forge") consumed = take("--forge", "forge")
    else if (arg === "--gitea-env") consumed = take("--gitea-env", "envFile")
    else if (arg === "--container") consumed = take("--container", "container")
    else if (arg === "--state-file") consumed = take("--state-file", "stateFile")
    else if (arg === "--gh-repo") consumed = take("--gh-repo", "ghRepo")
    else if (arg === "--runner-name") consumed = take("--runner-name", "runnerName")
    else if (arg === "--json") opts.json = true
    else if (arg === "-h" || arg === "--help") opts.help = true
    else if (arg.startsWith("-")) return { ...opts, error: `argumento desconhecido: ${arg}` }
    if (consumed?.error) return { ...opts, error: consumed.error }
  }
  if (opts.forge !== "gitea" && opts.forge !== "github") {
    return { ...opts, error: `--forge aceita 'gitea' ou 'github' (recebi '${opts.forge}')` }
  }
  // Flag de uma forja na outra: ignorar em silêncio faria o guard comparar
  // OUTRA coisa do que quem digitou pediu.
  const giteaOnly = ["--gitea-env", "--container", "--state-file"].filter(
    (f) =>
      ({
        "--gitea-env": opts.envFile,
        "--container": opts.container,
        "--state-file": opts.stateFile,
      })[f] !== null,
  )
  const githubOnly = ["--gh-repo", "--runner-name"].filter(
    (f) => ({ "--gh-repo": opts.ghRepo, "--runner-name": opts.runnerName })[f] !== null,
  )
  if (opts.forge === "github" && giteaOnly.length > 0) {
    return {
      ...opts,
      error: `${giteaOnly.join(", ")} ${giteaOnly.length > 1 ? "são" : "é"} da forja gitea — use --forge gitea`,
    }
  }
  if (opts.forge === "gitea" && githubOnly.length > 0) {
    return {
      ...opts,
      error: `${githubOnly.join(", ")} ${githubOnly.length > 1 ? "são" : "é"} do runner do GitHub — use --forge github`,
    }
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

  const result =
    opts.forge === "github"
      ? await checkGithubRunnerLabels({
          env: process.env,
          repo: opts.ghRepo,
          runnerName: opts.runnerName,
        })
      : checkRunnerLabels(opts)
  const code = exitCodeFor(result)

  if (opts.json) {
    console.log(JSON.stringify({ ...result, exitCode: code }, null, 2))
  } else {
    console.log(renderReport(result))
  }
  process.exit(code)
}
