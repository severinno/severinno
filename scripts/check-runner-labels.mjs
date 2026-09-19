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
// `apply-required-checks.mjs` (GITHUB_TOKEN/GH_TOKEN, GITHUB_API_URL,
// GITHUB_REPOSITORY): uma credencial, um vocabulário.

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
 * @param {string} text
 * @returns {{labels: string|null, entries: ReturnType<typeof parseLabelEntries>, name: string|null, repoUrl: string|null, repo: string|null}}
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
 */

/**
 * A lista de runners do payload da API, na forma que a decisão usa.
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
      labels: (Array.isArray(r?.labels) ? r.labels : [])
        .map((l) => String(l?.name ?? ""))
        .filter(Boolean),
    })),
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
  const resolvedRepo = repo ?? setup.repo ?? env.GITHUB_REPOSITORY ?? null
  const resolvedApiUrl = apiUrl ?? env.GITHUB_API_URL ?? DEFAULT_GITHUB_API_URL
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
      detail: `não sei qual repositório consultar: ${GITHUB_RUNNER_SCRIPT} não declara REPO_URL e GITHUB_REPOSITORY não está no ambiente (ou use --gh-repo owner/name)`,
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

  const remedies =
    violations.length === 0
      ? []
      : runner.status !== "online"
        ? [
            `Remédio: no host do runner, \`sudo systemctl restart actions.runner.*\` e \`journalctl -u actions.runner.*\` para ver por que ele não conectou — ver deploy/GITHUB_RUNNER.md § Troubleshooting.`,
            reRegister,
          ]
        : [reRegister]

  return {
    ...base,
    state: violations.length > 0 ? "violated" : "proven",
    violations,
    remedies,
    declared: declaredRaw,
    registered: registeredEntries.map((e) => e.raw),
    runner: runner.name,
    status: runner.status,
    repo: resolvedRepo,
    apiUrl: resolvedApiUrl,
    detail:
      violations.length > 0
        ? `${violations.length} problema(s) entre o registro do GitHub e o que ${GITHUB_RUNNER_SCRIPT} declara`
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
            `Remédio: declare GITEA_RUNNER_LABELS no serviço '${RUNNER_SERVICE}' de ${GITEA_COMPOSE} (o invariante 6 já exige a imagem da VARIÁVEL: \`ubuntu-latest:docker://\${IMAGE_REGISTRY:-ghcr.io}/\${IMAGE_NAMESPACE:-severinno}/ubuntu-bun:\${BUN_VERSION}\`) e só então re-registre — o registro só pega os labels na SUBIDA.`,
            reRegister,
            `Se o compose do host for outro arquivo, confirme COMPOSE_FILE: a comparação é contra ${GITEA_COMPOSE} deste checkout.`,
          ]
        : [
            reRegister,
            `Se o compose do host for outro arquivo, confirme COMPOSE_FILE: a comparação é contra ${GITEA_COMPOSE} deste checkout.`,
          ]

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
        ? declaredEntries.length === 0
          ? `o compose não tem labels a comparar (${declared.detail})`
          : registeredEntries.length === 0
            ? `o registro do runner está VAZIO e o compose declara ${declaredEntries.length} label(s)`
            : `${violations.length} divergência(s) entre o registro e o compose`
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
    if (result.state === "proven") {
      lines.push(
        `check-runner-labels[github]: ✅ o runner auto-hospedado está registrado com os labels do setup — ${result.detail}.`,
      )
      lines.push(`  runner        : ${where} · api: ${registry}`)
      lines.push(`  declarado     : ${result.declared.join(" , ") || "<nenhum>"}`)
      lines.push(`  registrado    : ${result.registered.join(" , ") || "<nenhum>"}`)
      return lines.join("\n")
    }
    if (result.state === "violated") {
      lines.push(`check-runner-labels[github]: ❌ ${result.detail}:`)
      for (const v of result.violations) lines.push(`  - ${v}`)
      for (const r of result.remedies) lines.push(`  → ${r}`)
      lines.push(`  declarado pelo setup    : ${result.declared.join(" , ") || "<nenhum>"}`)
      lines.push(`  registrado no GitHub    : ${result.registered.join(" , ") || "<nenhum>"}`)
      if (result.runner) lines.push(`  runner                  : ${where}`)
      return lines.join("\n")
    }
    lines.push(
      `check-runner-labels[github]: ⚠️ NÃO PROVADO (${result.state}) — o registro do GitHub NÃO foi comparado com o setup.`,
    )
    lines.push(`  ${result.detail}`)
    return lines.join("\n")
  }

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

  --forge <gitea|github>  qual forja comparar (default: gitea)

  forja (act_runner, lê o registro DENTRO do container):
  --gitea-env <path>   env da forja a usar como baseline (default: o do host, se existir, senão o template)
  --container <nome>   container do runner (default: o container_name do compose)
  --state-file <path>  caminho do registro DENTRO do container (default: <volume nomeado>/.runner)

  github (runner auto-hospedado; o registro vive no SERVIDOR, não em arquivo):
  --gh-repo <owner/nome>  repositório a consultar (default: o REPO_URL do script de setup)
  --runner-name <nome>    runner a comparar (default: o RUNNER_NAME do script de setup)
    credenciais do ambiente: GITHUB_TOKEN | GH_TOKEN, GITHUB_API_URL, GITHUB_REPOSITORY
    (as MESMAS do apply-required-checks; a lista de runners exige permissão de
     self-hosted runners no repo — o GITHUB_TOKEN de um run não a tem)

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
