#!/usr/bin/env node
// =============================================================================
// prove-gitea-registry.mjs
//
// Usage:
//   node scripts/prove-gitea-registry.mjs                          # ensaio completo
//   node scripts/prove-gitea-registry.mjs --json                   # mesmo veredito, plano
//   node scripts/prove-gitea-registry.mjs --keep                   # não derruba a stack
//   node scripts/prove-gitea-registry.mjs --ubuntu-bun <ref>       # artefato de origem do runner
//   node scripts/prove-gitea-registry.mjs --bun-mirror <ref>       # artefato de origem do mirror
//   node scripts/prove-gitea-registry.mjs --no-build               # não constrói o mirror ausente
//   node scripts/prove-gitea-registry.mjs --timeout 900            # orçamento por operação (s)
//   node scripts/prove-gitea-registry.mjs --gitea-image <ref>      # força a imagem do Gitea
//   node scripts/prove-gitea-registry.mjs -h
//
// Exit codes:
//   0 — PROVADO: as DUAS imagens foram publicadas no registry embutido de um Gitea
//       EFÊMERO e voltaram por DIGEST, com o artefato medido e os controles negativos
//   1 — VIOLADO: uma imagem não voltou, o digest que o registry serve para a tag
//       não é o do push, um blob não está lá, o artefato puxado não é o declarado,
//       ou um controle negativo PASSOU (o que ele teria de recusar)
//   2 — INDETERMINADO: sem docker/compose, imagem ausente, artefato de origem
//       ausente, produção no host, ou o Gitea não subiu — ausência de prova
//   3 — uso inválido
//
// POR QUE EXISTE (a etapa 1 tinha uma metade declarada como NÃO fechada)
//
// O `docs/GITHUB_CUT.md` fecha o **Ato 1a** (o flip do valor declarado) e o
// **Ato 1b** (a publicação dos dois artefatos) — mas o Ato 1b foi medido num
// registry `registry:2` LOCAL, e o próprio documento declara o limite: *"a
// publicação acima aconteceu num registry local"*. A etapa 1 promete outra
// coisa: as duas imagens no registry **OCI embutido da Gitea** (`git.severinno.cloud`),
// que é o que o runner da forja e o tier-3 do `setup-bun-ci.sh` consomem. Um
// `registry:2` local prova a MECÂNICA do OCI e deixa de fora exatamente o que o
// Gitea acrescenta — o registry embutido, com TOKEN (realm do `/v2/`), com o
// PACOTE sob um dono, e com o digest que ELE serve para a tag.
//
// Este ensaio não depende de um registry permanente: ele sobe a stack da forja
// (o MESMO `deploy/docker-compose.gitea.yml`, com volumes e porta próprios),
// publica os dois artefatos no registry embutido **daquele** Gitea, e puxa os
// dois de volta **pelo digest** — dentro do mesmo ensaio, sem nada de produção.
//
// O QUE É MEDIDO (não narrado)
//
//   1. o `/v2/` do Gitea efêmero responde com o desafio Bearer e o realm aponta
//      para o endereço EFÊMERO (é o `ROOT_URL` que o ensaio aponta — desvio
//      declarado, ver abaixo);
//   2. token de PULL por basic auth (o pacote nasce PRIVADO: o anônimo responde
//      401 — medido; quem puxa precisa de credencial, e é o que o runbook da
//      etapa 1 tem de resolver do lado de quem puxa);
//   3. `docker push` dos DOIS artefatos: o digest do push é lido da resposta e,
//      logo em seguida, do `RepoDigests` do objeto **filtrado pelo destino**
//      (o `RepoDigests` é uma LISTA por repositório: o índice 0 costuma ser de
//      outro registry, e um pull por ele falha contra um registry que não
//      existe mais — medido);
//   4. a MESMA pergunta pela API do registry: o `Docker-Content-Digest` da tag
//      tem de ser o digest do push. Sem isso, "publiquei" seria o que o docker
//      disse, não o que o registry serve;
//   5. os BLOBS estão lá: `HEAD` por digest (todos, com o comprimento do
//      manifest) e o CONTEÚDO de dois deles baixado e HASHED (o config e a menor
//      camada até o teto declarado) — é o que impede o pull-back de ser servido
//      só pelo content store local (untag não apaga camada);
//   6. o PULL-BACK POR DIGEST: a tag é REMOVIDA antes, e o pull é feito pela
//      referência `<host>/<dono>/<imagem>@sha256:...`;
//   7. o ARTEFATO: `bun --version` dentro do que voltou é a versão declarada
//      (`BUN_VERSION`), e a imagem do runner carrega a label de identidade
//      (`org.opencontainers.image.version`) que o `check:registry-source` usa
//      para responder "o que o registry serve é a build que o repositório
//      declara?";
//   8. os CONTROLES NEGATIVOS: um digest INEXISTENTE no mesmo repositório tem de
//      FALHAR (o pull-back não é satisfeito por estado local) e uma tag nunca
//      publicada também. Controle que PASSA = violação: sem ele, um pull que
//      aceitasse qualquer coisa passaria por prova.
//
// COMO (a stack é DERIVADA, não uma segunda declaração)
//
//   - o compose é o MESMO `deploy/docker-compose.gitea.yml` sobreposto por um
//     arquivo GERADO que muda só o que precisa ser efêmero: nome do container,
//     porta local (bind em 127.0.0.1), volumes próprios e DUAS chaves de
//     `environment` do serviço `gitea` — o `ROOT_URL` e o `DOMAIN` (o realm do
//     token sai do ROOT_URL: apontando para a produção, o `docker login` do
//     ensaio iria para `git.severinno.cloud`). Os desvios são listados no
//     relatório, com o valor de origem;
//   - o env sai do template comitado (`deploy/env.gitea.example`) — é dele que
//     saem o DONO do pacote (`IMAGE_NAMESPACE`), a VERSÃO (`BUN_VERSION`) e o
//     registry DECLARADO (usado como ref de origem default dos dois artefatos);
//   - o REGISTRY EMBUTIDO não é ligado por OVERRIDE: a stack DECLARA o valor
//     (`GITEA__registry__ENABLED` no template, consumido pelo compose com o
//     MESMO valor como default — o par que o `check:registry-source` compara por
//     valor) e o ensaio MEDE o render nos DOIS caminhos: COM o env do host e SEM
//     a declaração (o default, que é o que vale onde a variável não existe).
//     Divergência entre eles, ou um valor que não ligue o registry, PARA o
//     ensaio ANTES de subir a stack: subir com ele desligado mediria outra coisa
//     (o 401 do `/v2/` viria de rota inexistente);
//   - as imagens de origem são ENTRADA (`--ubuntu-bun`/`--bun-mirror`): o ensaio
//     não baixa imagem por conta própria. Faltando o mirror, ele o CONSTRÓI do
//     `Dockerfile.bun-mirror` (declarado no relatório), com o binário vindo do
//     `oven/bun:<versão>` local — o mesmo release linux-x64 que o workflow
//     `sync-bun-mirror.yml` baixa;
//   - o veredito não vem de texto: vem das medições acima, e cada uma é uma
//     linha do relatório.
//
// O QUE NÃO COBRE (dito, não escondido)
//
//   - a VPS (`git.severinno.cloud`): publicar lá e definir as repository
//     variables nas duas forjas continuam sendo os dois atos de OPERAÇÃO da
//     etapa 1 (o ensaio prova a mecânica, com o mesmo Gitea da série 1.22);
//   - TLS/Caddy, DNS e firewall: a stack sobe só o serviço `gitea`, em HTTP no
//     loopback (o daemon trata `127.0.0.0/8` como registry inseguro);
//   - o act_runner: quem puxa a imagem do job é o DAEMON do host, com a
//     credencial DELE — o ensaio declara isso como fato e puxa com login
//     explícito (é o mesmo caminho de credencial);
//   - a visibilidade do pacote: o ensaio MEDE que o anônimo é recusado; tornar
//     o pacote público é decisão de operação, não deste ensaio.
//
// Onde roda: manual/operador (`bun run gitea-registry:prove`) e em host com
// docker. Sem docker ele é INDETERMINADO — nunca verde. O caminho
// `docker-ausente` é cobrado a cada PR pelo `check:prove-docs`.
// =============================================================================

import { createHash } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import process from "node:process"
import { fileURLToPath, pathToFileURL } from "node:url"

import { GITEA_COMPOSE } from "./check-bun-mirror.mjs"
import { parseEnvFile } from "./ensure-runner-image.mjs"
import {
  DEFAULT_ENV_FILE,
  EXIT,
  GITEA_SERVICE,
  composeArgs,
  dockerFacts,
  ephemeralEnvFile,
  exitCodeFor,
  freePort,
  imagePresent,
  removeContainers,
  renderCompose,
  run,
  waitForGitea,
} from "./prove-forge-smoke-ephemeral.mjs"

/** A raiz do repositório — este script mora em `scripts/`. */
export const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

/** O prefixo do projeto compose efêmero (o sufixo aleatório evita colisão). */
export const PROJECT_PREFIX = "prova-gitea-registry"

/**
 * A senha do dono do pacote DENTRO do Gitea efêmero.
 *
 * É um valor de ensaio: o usuário existe só enquanto a stack existir, e o banco
 * é o sqlite do volume efêmero (removido no teardown). A credencial do registry
 * da PRODUÇÃO é outra coisa — e não passa por aqui.
 */
export const OWNER_PASSWORD = "Prova!Registry1x"

/** O orçamento (segundos) de cada operação de docker/registry do ensaio. */
export const DEFAULT_TIMEOUT_S = 900

/**
 * Os DOIS artefatos da etapa 1, na ordem em que o documento os promete.
 *
 * `name` é o nome do pacote no registry (`<dono>/<name>`) e `evidence` diz como
 * o artefato puxado é MEDIDO: a imagem do runner roda o próprio `bun --version`
 * dentro dela; o mirror é `scratch` (o consumidor é o `docker cp` do tier-3),
 * então a evidência é EXTRAIR o `/bun` e rodá-lo — rodar a imagem inteira
 * falharia por desenho (não há libc no scratch).
 */
export const ARTIFACTS = [
  {
    key: "ubuntu-bun",
    name: "ubuntu-bun",
    role: "a imagem do runner (os jobs da forja rodam nela)",
    evidence: "run",
  },
  {
    key: "bun-mirror",
    name: "bun",
    role: "o mirror do Bun (tier-3 do setup-bun, via docker cp)",
    evidence: "extract",
  },
]

/** O que o cliente manda no `Accept` do manifest (índice + manifest de imagem). */
export const MANIFEST_ACCEPT = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.v2+json",
].join(", ")

/**
 * O teto do blob que o ensaio BAIXA e HASHEIA.
 *
 * O `HEAD` por digest prova que o registry tem um blob daquele comprimento; para
 * provar CONTEÚDO, o ensaio baixa e hasheia o config (sempre) e a MENOR camada
 * até este teto — as camadas grandes ficam no `HEAD`, e o limite é declarado em
 * vez de presumido (baixar 2GB por camada não é o que esta prova paga).
 */
export const BLOB_HASH_CAP_BYTES = 64 * 1024 * 1024

// ═══════════════════════════════════════════════════════════════════════════
// 1. O plano do ensaio (puro — sem docker, sem Gitea, sem fs)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Os alvos do ensaio, derivados do template do env.
 *
 * Fail-closed: sem `IMAGE_NAMESPACE` (o DONO do pacote), sem `BUN_VERSION` (a
 * TAG) ou sem `IMAGE_REGISTRY` (o registry DECLARADO, que é a ref de origem
 * default dos dois artefatos) o ensaio não inventa valor — ele diz o que falta.
 *
 * @param {{values: Record<string,string>, port: number}} args
 */
export function registryTargets({ values = {}, port }) {
  const missing = ["IMAGE_REGISTRY", "IMAGE_NAMESPACE", "BUN_VERSION"].filter((k) => !values[k])
  if (missing.length > 0) {
    return {
      ok: false,
      detail: `${DEFAULT_ENV_FILE} não declara ${missing.join(", ")} — o ensaio não inventa dono, tag nem registry`,
    }
  }
  const namespace = values.IMAGE_NAMESPACE
  const version = values.BUN_VERSION
  const host = `127.0.0.1:${port}`
  const artifacts = ARTIFACTS.map((spec) => {
    const repository = `${namespace}/${spec.name}`
    return {
      key: spec.key,
      name: spec.name,
      role: spec.role,
      evidence: spec.evidence,
      tag: version,
      repository,
      repoRef: `${host}/${repository}`,
      destRef: `${host}/${repository}:${version}`,
      declaredSource: `${values.IMAGE_REGISTRY}/${repository}:${version}`,
    }
  })
  return {
    ok: true,
    host,
    namespace,
    version,
    declaredRegistry: values.IMAGE_REGISTRY,
    artifacts,
    detail: `dono '${namespace}' · tag ${version} · alvo ${host}`,
  }
}

/**
 * O compose do ensaio: o comitado + um override GERADO.
 *
 * Só o que PRECISA ser efêmero entra aqui (nome do container, porta, volumes) e
 * as chaves de `environment` que a prova exige que sejam DIFERENTES da produção
 * — as três saem listadas em `registryDeviations`, com o valor de origem, para
 * o relatório poder dizer exatamente o que o ensaio mudou.
 *
 * @param {{project: string, port: number, volumeKeys: string[], giteaContainerName?: string, host?: string}} args
 */
export function renderRegistryOverride({
  project,
  port,
  volumeKeys,
  giteaContainerName = `${project}-${GITEA_SERVICE}`,
  host = `127.0.0.1:${port}`,
}) {
  return [
    "# GERADO pelo ensaio do registry (prove-gitea-registry.mjs). Não editar.",
    "services:",
    `  ${GITEA_SERVICE}:`,
    `    container_name: ${giteaContainerName}`,
    "    ports:",
    `      - '127.0.0.1:${port}:3000'`,
    "    environment:",
    `      GITEA__server__ROOT_URL: http://${host}/`,
    `      GITEA__server__DOMAIN: ${host}`,
    "volumes:",
    ...volumeKeys.map((key) => `  ${key}:\n    name: ${project}-${key}`),
    "",
  ].join("\n")
}

/**
 * O MESMO env do ensaio SEM a declaração do registry embutido.
 *
 * É o caminho do DEFAULT, e não uma conveniência: o caso real é um host cujo
 * `.env.gitea` é mais velho que o template (a variável não existe lá), e nesse
 * host quem decide o que sobe é o default embutido do compose. O ensaio mede o
 * render desse host — é a metade que a leitura do arquivo não prova.
 *
 * @param {string} content
 * @returns {string}
 */
export function envSemDeclaracaoDoRegistry(content) {
  return String(content ?? "")
    .split(/\r?\n/)
    .filter((linha) => !/^\s*(?:export\s+)?GITEA__registry__ENABLED\s*=/.test(linha))
    .join("\n")
}

/**
 * A DECLARAÇÃO do registry embutido — o fato que o ensaio exige ANTES de subir.
 *
 * Quatro exigências, todas medidas no RENDER (não no texto dos arquivos):
 *
 *   1. o template DECLARA a variável — sem a linha não há o que o host espelhe,
 *      e o valor passa a ser o default da SÉRIE da imagem;
 *   2. o valor declarado LIGA o registry (`true`): a etapa 1 do corte do GitHub
 *      publica as duas imagens nele; um `false` não é um detalhe de configuração;
 *   3. o render COM o env entregou o valor declarado — é o caminho em que a
 *      declaração do host chega ao container (o compose a consome);
 *   4. o render SEM a declaração entregou o MESMO valor — é o caminho do
 *      default, o que vale no host que não tem a linha. Ele é a razão de a
 *      igualdade `default × declarado` ser invariante, e não estilo.
 *
 * @param {{values?: Record<string,string>, renderedDeclarado?: Record<string,string>, renderedPadrao?: Record<string,string>|null, renderPadraoFalhou?: string|null, enabledValue?: string}} [args]
 * @returns {{ok: boolean, value: string|null, declared: string|null, renderedAsDeclared: string|null, renderedByDefault: string|null, detail: string}}
 */
export function registryDeclaration({
  values = {},
  renderedDeclarado = {},
  renderedPadrao = null,
  renderPadraoFalhou = null,
  enabledValue = "true",
} = {}) {
  const key = "GITEA__registry__ENABLED"
  const declared = values[key] ?? null
  const asDeclared = renderedDeclarado[key] ?? null
  const byDefault = renderedPadrao === null ? null : (renderedPadrao[key] ?? null)
  const base = {
    ok: false,
    value: null,
    declared,
    renderedAsDeclared: asDeclared,
    renderedByDefault: byDefault,
    detail: "",
  }
  const remedio = `declare '${key}=${enabledValue}' no template (deploy/env.gitea.example) — é o par (default do compose × valor declarado) que o \`check:registry-source\` compara por valor`
  if (declared === null) {
    return {
      ...base,
      detail: `a stack não DECLARA ${key}: nenhum arquivo do repositório diz se o registry embutido está ligado (${remedio})`,
    }
  }
  if (String(declared).trim().toLowerCase() !== enabledValue) {
    return {
      ...base,
      detail: `${key}='${declared}' no template: o registry embutido é o SUJEITO do ensaio e a etapa 1 depende dele — esta medição não mede um registry DESLIGADO (${remedio})`,
    }
  }
  if (asDeclared === null) {
    return {
      ...base,
      detail: `o render COM o env não entregou ${key} ao container: o compose não a consome (uma linha LITERAL no compose ignora o env do host, e o valor declarado não chega lá) — ${remedio}`,
    }
  }
  if (renderPadraoFalhou !== null) {
    return {
      ...base,
      detail: `o render do caminho DEFAULT (o host que não declara ${key}) falhou: ${renderPadraoFalhou}`,
    }
  }
  if (byDefault !== asDeclared) {
    return {
      ...base,
      detail: `o DEFAULT do compose entrega ${key}='${byDefault}' e o template declara '${asDeclared}': onde a variável não existe (o host com o env mais velho que o template) sobe outra coisa que o repositório declara — ${remedio}`,
    }
  }
  return {
    ...base,
    ok: true,
    value: asDeclared,
    detail: `${key}=${asDeclared} — declarado no template e entregue pelo render nos DOIS caminhos (com o env e pelo default do compose, o que vale no host que não a declara)`,
  }
}

/**
 * Os desvios DECLARADOS do ensaio em relação à stack declarada.
 *
 * Não é cerimônia: o `ROOT_URL` é o que decide para ONDE o `docker login` vai
 * (o realm do `/v2/` sai dele), e o `registry ENABLED` é o sujeito da prova.
 * Um ensaio que mudasse isso em silêncio estaria medindo outra coisa.
 *
 * @param {{baseEnv?: Record<string,string>, host: string}} args
 */
export function registryDeviations({ baseEnv = {}, host }) {
  return [
    {
      key: "GITEA__server__ROOT_URL",
      from: baseEnv.GITEA__server__ROOT_URL ?? null,
      to: `http://${host}/`,
      why: "o realm do token do registry sai do ROOT_URL: apontando para a produção, o `docker login` do ensaio iria para git.severinno.cloud",
    },
    {
      key: "GITEA__server__DOMAIN",
      from: baseEnv.GITEA__server__DOMAIN ?? null,
      to: host,
      why: "o Gitea do ensaio responde por 127.0.0.1:<porta>",
    },
    // O `GITEA__registry__ENABLED` NÃO está nesta lista de propósito: ele deixou
    // de ser desvio. A stack o declara (template + default do compose com o
    // MESMO valor) e o ensaio MEDE os dois caminhos do render — sobrepor o valor
    // aqui faria a prova passar por cima da declaração, que é exatamente o que
    // ela tem de medir.
  ]
}

/**
 * O digest do PUSH, lido do `RepoDigests` do objeto.
 *
 * `RepoDigests` é uma LISTA **por repositório**: um objeto empurrado por esta
 * máquina costuma carregar antes o digest de outro registry (medido: o índice 0
 * era de um registry local que já não existia, e o pull por ele falha com
 * `connection refused`). O que vale é a entrada cujo repositório é o DESTINO.
 *
 * @param {string[]} repoDigests
 * @param {string} repoRef `<host>/<dono>/<nome>` (sem tag)
 * @returns {string|null} `sha256:...` ou null
 */
export function digestForRepo(repoDigests, repoRef) {
  const prefix = `${repoRef}@`
  const hit = (repoDigests ?? []).find((entry) => String(entry).startsWith(prefix))
  return hit ? hit.slice(prefix.length) : null
}

/**
 * O digest que o PRÓPRIO push imprimiu (`...: digest: sha256:... size: N`).
 *
 * Serve de cruzamento com o `RepoDigests`: os dois lados vêm do docker, por
 * caminhos diferentes, e discordar é violação (o registry teria servido outro
 * manifest).
 *
 * @param {string} stdout
 */
export function parsePushDigest(stdout) {
  const m = String(stdout ?? "").match(/digest:\s*(sha256:[0-9a-f]{64})/i)
  return m ? m[1].toLowerCase() : null
}

/** Um digest que NÃO existe — o alvo dos controles negativos. */
export function fabricatedDigest(seed = `${PROJECT_PREFIX}-nao-publicado`) {
  return `sha256:${createHash("sha256").update(String(seed)).digest("hex")}`
}

/**
 * O veredito, a partir do que foi MEDIDO.
 *
 * Regras: qualquer violação vence (um controle que PASSOU é violação — ele
 * teria de recusar); sem violação, uma medição que não deu para fazer é
 * INDETERMINADO; com as duas metades medidas e os controles recusando, provado.
 *
 * @param {{artifacts?: object[], controls?: {name: string, ok: boolean, detail: string}[]}} args
 */
export function summarizePublish({ artifacts = [], controls = [] } = {}) {
  const wrongs = []
  const unavailable = []
  for (const a of artifacts) {
    for (const w of a.wrongs ?? []) wrongs.push(`${a.key}: ${w}`)
    if (a.unavailable) unavailable.push(`${a.key}: ${a.unavailable}`)
  }
  for (const c of controls) {
    if (c.ok !== true) wrongs.push(`controle '${c.name}': ${c.detail}`)
  }
  if (wrongs.length > 0) return { verdict: "violated", wrongs, unavailable }
  if (unavailable.length > 0) return { verdict: "unavailable", wrongs, unavailable }
  return { verdict: "proven", wrongs, unavailable }
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. IO — o docker do host e a API do registry do Gitea efêmero
// ═══════════════════════════════════════════════════════════════════════════

/** Um fetch com timeout — nunca lança: devolve o desfecho, o chamador julga. */
export async function fetchWithTimeout(
  url,
  { init = {}, fetchImpl = globalThis.fetch, timeoutMs = 20_000, binary = false } = {},
) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetchImpl(url, { ...init, signal: controller.signal })
    const body = binary ? Buffer.from(await res.arrayBuffer()) : await res.text()
    return {
      ok: true,
      status: res.status,
      headers: res.headers,
      body,
      detail: `HTTP ${res.status}`,
    }
  } catch (error) {
    return {
      ok: false,
      status: null,
      headers: null,
      body: "",
      detail: `sem resposta (${error.message})`,
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * O token do registry, pelo fluxo do docker: `GET /v2/token` com BASIC auth.
 *
 * É o MESMO caminho do `docker login` — e é o que prova que a credencial do
 * dono do pacote vale no registry embutido (não é um token de outro serviço).
 */
export async function registryToken({
  baseUrl,
  user,
  password,
  scope,
  fetchImpl,
  timeoutMs = 20_000,
}) {
  const url = `${baseUrl}/v2/token?service=container_registry&scope=${encodeURIComponent(scope)}`
  const basic = Buffer.from(`${user}:${password}`).toString("base64")
  const res = await fetchWithTimeout(url, {
    init: { headers: { Authorization: `Basic ${basic}` } },
    fetchImpl,
    timeoutMs,
  })
  if (!res.ok)
    return { ok: false, token: null, detail: `o endpoint do token não respondeu (${res.detail})` }
  if (res.status !== 200)
    return { ok: false, token: null, detail: `o token foi recusado (HTTP ${res.status})` }
  let parsed
  try {
    parsed = JSON.parse(res.body)
  } catch (error) {
    return { ok: false, token: null, detail: `a resposta do token não é JSON (${error.message})` }
  }
  const token = parsed.token ?? parsed.access_token ?? null
  return token
    ? { ok: true, token, detail: `token de pull emitido (${String(token).slice(0, 12)}…)` }
    : {
        ok: false,
        token: null,
        detail: `a resposta do token não trouxe campo nenhum (${res.body.slice(0, 80)})`,
      }
}

/**
 * O manifest que o registry serve para uma REFERÊNCIA (tag ou digest).
 *
 * `Docker-Content-Digest` é a resposta do registry à pergunta "qual digest esta
 * tag aponta?" — é ele que tem de ser o digest do push.
 */
export async function registryManifest({
  baseUrl,
  repository,
  reference,
  token,
  fetchImpl,
  timeoutMs = 30_000,
}) {
  const url = `${baseUrl}/v2/${repository}/manifests/${reference}`
  const init = {
    headers: {
      Accept: MANIFEST_ACCEPT,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  }
  const res = await fetchWithTimeout(url, { init, fetchImpl, timeoutMs })
  if (!res.ok)
    return {
      ok: false,
      digest: null,
      mediaType: null,
      body: null,
      status: null,
      detail: `o registry não respondeu (${res.detail})`,
    }
  if (res.status !== 200) {
    return {
      ok: false,
      digest: null,
      mediaType: null,
      body: null,
      status: res.status,
      detail: `HTTP ${res.status} — o registry não serve este manifest`,
    }
  }
  let body
  try {
    body = JSON.parse(res.body)
  } catch (error) {
    return {
      ok: false,
      digest: null,
      mediaType: null,
      body: null,
      status: res.status,
      detail: `o manifest não é JSON (${error.message})`,
    }
  }
  const digest = res.headers?.get?.("docker-content-digest") ?? null
  const mediaType = res.headers?.get?.("content-type") ?? body.mediaType ?? null
  return {
    ok: true,
    digest,
    mediaType,
    body,
    status: res.status,
    detail: `manifest ${mediaType ?? "?"} digest ${digest ?? "<sem header>"}`,
  }
}

/** `HEAD` num blob por digest: o registry TEM os bytes? (comprimento no header) */
export async function registryBlobHead({
  baseUrl,
  repository,
  digest,
  token,
  fetchImpl,
  timeoutMs = 120_000,
}) {
  const url = `${baseUrl}/v2/${repository}/blobs/${digest}`
  const init = {
    method: "HEAD",
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  }
  const res = await fetchWithTimeout(url, { init, fetchImpl, timeoutMs })
  if (!res.ok) return { ok: false, length: null, detail: `sem resposta (${res.detail})` }
  const raw = res.headers?.get?.("content-length") ?? null
  return {
    ok: res.status === 200,
    length: raw === null ? null : Number(raw),
    detail: `HTTP ${res.status}${raw === null ? "" : ` · ${raw} bytes`}`,
  }
}

/** Baixa o blob e devolve o SHA-256 do CONTEÚDO (a prova de que o byte veio). */
export async function registryBlobHash({
  baseUrl,
  repository,
  digest,
  token,
  fetchImpl,
  timeoutMs = 120_000,
}) {
  const url = `${baseUrl}/v2/${repository}/blobs/${digest}`
  const init = { headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) } }
  const res = await fetchWithTimeout(url, { init, fetchImpl, timeoutMs, binary: true })
  if (!res.ok)
    return { ok: false, computed: null, size: null, detail: `sem resposta (${res.detail})` }
  if (res.status !== 200)
    return { ok: false, computed: null, size: null, detail: `HTTP ${res.status}` }
  const computed = `sha256:${createHash("sha256").update(res.body).digest("hex")}`
  return {
    ok: computed === digest,
    computed,
    size: res.body.length,
    detail: `${res.body.length} bytes · sha256 ${computed === digest ? "CONFERE" : `DIVERGE (${computed})`}`,
  }
}

/**
 * O manifest da PLATAFORMA, quando o registry serve um ÍNDICE.
 *
 * O Gitea (medido, 1.22) responde com um índice OCI mesmo para um push de
 * manifest único, então os blobs moram no manifest do filho — e é o filho do
 * `linux/amd64` que o host puxa. Sem resolver isso, a verificação de blobs
 * olharia para a lista errada e passaria vazia.
 */
export async function platformManifestOf({
  baseUrl,
  repository,
  manifest,
  token,
  fetchImpl,
  timeoutMs = 30_000,
}) {
  const children = manifest?.manifests
  if (!Array.isArray(children) || children.length === 0)
    return { ok: true, digest: null, body: manifest, detail: "manifest de imagem (sem índice)" }
  const amd64 = children.find(
    (c) => (c.platform?.os ?? "linux") === "linux" && c.platform?.architecture === "amd64",
  )
  const child = amd64 ?? children.find((c) => typeof c.digest === "string")
  if (!child?.digest)
    return {
      ok: false,
      digest: null,
      body: null,
      detail: "o índice não traz nenhum filho com digest",
    }
  const got = await registryManifest({
    baseUrl,
    repository,
    reference: child.digest,
    token,
    fetchImpl,
    timeoutMs,
  })
  if (!got.ok)
    return {
      ok: false,
      digest: null,
      body: null,
      detail: `o filho ${child.digest} não pôde ser lido (${got.detail})`,
    }
  return {
    ok: true,
    digest: child.digest,
    body: got.body,
    detail: `filho ${amd64 ? "linux/amd64" : "primeiro"} ${child.digest}`,
  }
}

/**
 * Os BLOBS do manifest estão no registry?
 *
 * `HEAD` em TODOS (config + camadas), com o comprimento conferido contra o do
 * manifest, e o CONTEÚDO de dois baixado e hasheado: o config (sempre) e a menor
 * camada até o teto declarado. É esta metade que compensa o cache do daemon no
 * pull-back — `untag` não apaga camada, então o pull pode não baixar nada, e só
 * a API prova que os bytes estão LÁ.
 */
export async function verifyBlobs({
  baseUrl,
  repository,
  manifest,
  token,
  fetchImpl,
  timeoutMs = 120_000,
  capBytes = BLOB_HASH_CAP_BYTES,
}) {
  const body = manifest ?? {}
  const blobs = [
    ...(body.config?.digest
      ? [{ digest: body.config.digest, size: body.config.size ?? null, kind: "config" }]
      : []),
    ...(Array.isArray(body.layers)
      ? body.layers.map((l) => ({ digest: l.digest, size: l.size ?? null, kind: "layer" }))
      : []),
  ]
  if (blobs.length === 0)
    return {
      ok: false,
      blobs: [],
      hashed: [],
      totalBytes: 0,
      detail: "o manifest não declara config nem camadas",
    }

  const out = []
  const problems = []
  for (const blob of blobs) {
    const head = await registryBlobHead({
      baseUrl,
      repository,
      digest: blob.digest,
      token,
      fetchImpl,
      timeoutMs,
    })
    const lengthOk = blob.size === null || head.length === null || head.length === blob.size
    const ok = head.ok && lengthOk
    if (!ok)
      problems.push(
        `${blob.kind} ${blob.digest}: ${head.detail}${lengthOk ? "" : ` (o manifest declara ${blob.size})`}`,
      )
    out.push({ ...blob, head: head.detail, ok })
  }

  const hashed = []
  const mustHash = blobs.filter((b) => b.kind === "config")
  const layers = blobs
    .filter((b) => b.kind === "layer" && typeof b.size === "number")
    .sort((a, b) => a.size - b.size)
  if (layers.length > 0 && layers[0].size <= capBytes) mustHash.push(layers[0])
  for (const blob of mustHash) {
    const got = await registryBlobHash({
      baseUrl,
      repository,
      digest: blob.digest,
      token,
      fetchImpl,
      timeoutMs,
    })
    hashed.push({
      digest: blob.digest,
      kind: blob.kind,
      size: got.size,
      ok: got.ok,
      detail: got.detail,
    })
    if (!got.ok)
      problems.push(`${blob.kind} ${blob.digest}: o conteúdo baixado não confere (${got.detail})`)
  }
  const totalBytes = out.reduce((sum, b) => sum + (b.size ?? 0), 0)
  return {
    ok: problems.length === 0,
    blobs: out,
    hashed,
    totalBytes,
    detail: `${out.length} blob(s) (${totalBytes} bytes no manifest) · ${out.filter((b) => b.ok).length} com HEAD ok · ${hashed.length} hasheado(s)${problems.length > 0 ? ` · ${problems.length} problema(s)` : ""}`,
    problems,
  }
}

/** Uma chamada ao docker do host: exit code + saída juntos (nunca lança). */
export function dockerCall({
  docker = "docker",
  args,
  cwd = REPO_ROOT,
  run: runFn = run,
  timeoutMs = 120_000,
}) {
  const res = runFn(docker, args, { cwd, timeout: timeoutMs })
  return {
    code: res.status ?? null,
    output: `${res.stdout ?? ""}${res.stderr ?? ""}`.trim(),
    stdout: String(res.stdout ?? ""),
    stderr: String(res.stderr ?? ""),
    error: res.error ?? null,
  }
}

/**
 * Publica um artefato: `tag` + `push`, e o DIGEST do push.
 *
 * O digest é lido DUAS vezes (a linha do push e o `RepoDigests` filtrado pelo
 * destino) porque é ele que amarra todo o resto: a tag removida depois, o pull
 * por digest, e a comparação com o que o registry serve.
 */
export function pushArtifact({ sourceRef, target, docker, run: runFn = run, timeoutMs = 300_000 }) {
  const tagged = dockerCall({
    docker,
    args: ["tag", sourceRef, target.destRef],
    run: runFn,
    timeoutMs,
  })
  if (tagged.code !== 0)
    return {
      ok: false,
      digest: null,
      detail: `o tag de '${sourceRef}' falhou: ${tagged.output.split("\n").slice(-1)[0] || "sem saída"}`,
    }
  const pushed = dockerCall({ docker, args: ["push", target.destRef], run: runFn, timeoutMs })
  if (pushed.code !== 0)
    return {
      ok: false,
      digest: null,
      detail: `o push falhou: ${pushed.output.split("\n").slice(-1)[0] || "sem saída"}`,
    }
  const fromOutput = parsePushDigest(pushed.stdout || pushed.output)
  const inspected = dockerCall({
    docker,
    args: ["inspect", target.destRef, "--format", '{{join .RepoDigests "\\n"}}'],
    run: runFn,
    timeoutMs: 60_000,
  })
  const repoDigests =
    inspected.code === 0
      ? inspected.stdout
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean)
      : []
  const fromInspect = digestForRepo(repoDigests, target.repoRef)
  if (!fromInspect && !fromOutput) {
    return {
      ok: false,
      digest: null,
      detail: "o push não devolveu digest nenhum (nem na saída, nem no RepoDigests do destino)",
    }
  }
  if (fromInspect && fromOutput && fromInspect !== fromOutput) {
    return {
      ok: false,
      digest: fromInspect,
      detail: `o push imprimiu ${fromOutput} e o RepoDigests do destino diz ${fromInspect} — o registry serviu outro manifest`,
    }
  }
  return {
    ok: true,
    digest: fromInspect ?? fromOutput,
    detail: `empurrado; digest ${fromInspect ?? fromOutput}`,
  }
}

/** Remove a TAG local (não o artefato): o pull-back tem de vir do registry. */
export function untagRef({ ref, docker, run: runFn = run, timeoutMs = 120_000 }) {
  const res = dockerCall({ docker, args: ["rmi", ref], run: runFn, timeoutMs })
  return {
    ok: res.code === 0,
    detail:
      res.code === 0
        ? `tag '${ref}' removida`
        : `o rmi falhou: ${res.output.split("\n").slice(-1)[0] || "sem saída"}`,
  }
}

/** O pull por referência (tag ou digest) — o CONTROLE usa esta mesma função. */
export function pullRef({ ref, docker, run: runFn = run, timeoutMs }) {
  const res = dockerCall({ docker, args: ["pull", ref], run: runFn, timeoutMs })
  const last =
    res.output
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(-1)[0] ?? "sem saída"
  return { ok: res.code === 0, code: res.code, output: res.output, detail: last }
}

/** O `RepoDigests` do objeto puxado (tem de conter a referência do DESTINO). */
export function repoDigestsOf({ ref, docker, run: runFn = run }) {
  const res = dockerCall({
    docker,
    args: ["inspect", ref, "--format", '{{join .RepoDigests "\\n"}}'],
    run: runFn,
    timeoutMs: 60_000,
  })
  return res.code === 0
    ? res.stdout
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
    : []
}

/**
 * O ARTEFATO puxado — o que o consumidor mede.
 *
 * `run`: a imagem do runner executa `bun --version` DENTRO dela (e a label de
 * identidade é lida). `extract`: o mirror é scratch — o caminho do consumidor é
 * `docker create` + `docker cp` do `/bun`, e o binário extraído é que responde.
 */
export function artifactEvidence({
  spec,
  ref,
  version,
  docker,
  run: runFn = run,
  tmpDir,
  timeoutMs = 300_000,
}) {
  if (spec.evidence === "extract") {
    const created = dockerCall({ docker, args: ["create", ref], run: runFn, timeoutMs })
    const id = created.stdout.trim().split("\n").filter(Boolean).slice(-1)[0] ?? ""
    if (created.code !== 0 || id === "")
      return {
        ok: false,
        version: null,
        detail: `o docker create falhou: ${created.output.split("\n").slice(-1)[0] || "sem saída"}`,
      }
    const dest = join(tmpDir, "bun-extraido")
    const copied = dockerCall({
      docker,
      args: ["cp", `${id}:/bun`, dest],
      run: runFn,
      timeoutMs,
    })
    dockerCall({ docker, args: ["rm", id], run: runFn, timeoutMs })
    if (copied.code !== 0)
      return {
        ok: false,
        version: null,
        detail: `o docker cp do /bun falhou: ${copied.output.split("\n").slice(-1)[0] || "sem saída"}`,
      }
    const exec = runFn(dest, ["--version"], { cwd: tmpDir, timeout: 60_000 })
    const got = String(exec.stdout ?? "").trim()
    return {
      ok: exec.status === 0 && got === version,
      version: got,
      detail: `o /bun extraído responde '${got}'${got === version ? "" : ` (declarado: ${version})`}`,
    }
  }
  const runIt = dockerCall({
    docker,
    args: ["run", "--rm", ref, "bun", "--version"],
    run: runFn,
    timeoutMs,
  })
  const got = runIt.stdout.trim()
  const label = dockerCall({
    docker,
    args: [
      "inspect",
      ref,
      "--format",
      '{{index .Config.Labels "org.opencontainers.image.version"}}',
    ],
    run: runFn,
    timeoutMs: 60_000,
  })
  const labelValue = label.code === 0 ? label.stdout.trim() : ""
  const ok = runIt.code === 0 && got === version && (labelValue === "" || labelValue === version)
  return {
    ok,
    version: got,
    label: labelValue,
    detail: `bun --version = '${got}' · label version = '${labelValue || "<ausente>"}'${got === version ? "" : ` (declarado: ${version})`}`,
  }
}

/**
 * Constrói o mirror do Bun a partir do `Dockerfile.bun-mirror` comitado.
 *
 * O binário vem, em ordem: (1) do próprio artefato declarado, se existir local;
 * (2) do `oven/bun:<versão>` local (o MESMO release linux-x64 que o workflow
 * `sync-bun-mirror.yml` baixa); (3) do `bun` do PATH, se a versão bater. Sem
 * nenhum dos três, o ensaio é INDETERMINADO com a receita — ele não baixa da
 * rede por conta própria.
 */
export function buildMirrorArtifact({
  ref,
  version,
  docker,
  run: runFn = run,
  tmpDir,
  exists = existsSync,
  copyBun = null,
}) {
  const ctx = join(tmpDir, "mirror-ctx")
  const bunInCtx = join(ctx, "bun")
  mkdirSync(ctx, { recursive: true })
  let origin = null
  let why = null
  if (copyBun) {
    origin = copyBun
  } else {
    const base = `oven/bun:${version}`
    if (imagePresent(base, { run: runFn })) {
      const created = dockerCall({ docker, args: ["create", base], run: runFn, timeoutMs: 120_000 })
      const id = created.stdout.trim().split("\n").filter(Boolean).slice(-1)[0] ?? ""
      if (created.code === 0 && id !== "") {
        const copied = dockerCall({
          docker,
          args: ["cp", `${id}:/usr/local/bin/bun`, bunInCtx],
          run: runFn,
          timeoutMs: 300_000,
        })
        dockerCall({ docker, args: ["rm", id], run: runFn, timeoutMs: 120_000 })
        if (copied.code === 0 && exists(bunInCtx))
          origin = `oven/bun:${version} (o binário do release linux-x64)`
        else
          why = `o docker cp de '${base}' falhou: ${copied.output.split("\n").slice(-1)[0] || "sem saída"}`
      } else {
        why = `não consegui criar um container de '${base}': ${created.output.split("\n").slice(-1)[0] || "sem saída"}`
      }
    } else {
      why = `a imagem '${base}' não existe localmente`
    }
    if (!origin) {
      const which = runFn("bash", ["-lc", `command -v bun && bun --version`], { timeout: 30_000 })
      const lines = String(which.stdout ?? "")
        .trim()
        .split("\n")
      if (which.status === 0 && lines[1] === version && exists(lines[0])) {
        const copied = runFn("cp", [lines[0], bunInCtx], { timeout: 120_000 })
        if (copied.status === 0)
          origin = `o 'bun' do PATH do host (${lines[0]}, versão ${lines[1]})`
        else why = `${why ?? ""} · o cp do 'bun' do PATH falhou`
      } else {
        why = `${why ?? ""} · o 'bun' do PATH não bateu a versão (recebi '${lines[1] ?? "<vazio>"}')`
      }
    }
  }
  if (!origin) {
    return {
      ok: false,
      detail: `não há de onde tirar o binário do Bun ${version} (o ensaio não baixa da rede): ${why ?? "sem detalhe"}`,
    }
  }
  const built = dockerCall({
    docker,
    args: ["build", "-q", "-f", join(REPO_ROOT, "Dockerfile.bun-mirror"), "-t", ref, ctx],
    run: runFn,
    timeoutMs: 600_000,
  })
  if (built.code !== 0)
    return {
      ok: false,
      detail: `o build do mirror falhou: ${built.output.split("\n").slice(-1)[0] || "sem saída"}`,
    }
  return {
    ok: true,
    origin,
    detail: `mirror construído de Dockerfile.bun-mirror, binário de ${origin}`,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. O ensaio
// ═══════════════════════════════════════════════════════════════════════════

/** Os containers do host, com projeto e estado (a checagem de segurança). */
export function listContainers({ run: runFn = run } = {}) {
  const ps = runFn(
    "docker",
    ["ps", "-a", "--format", '{{.Names}}\t{{.State}}\t{{.Label "com.docker.compose.project"}}'],
    { timeout: 30_000 },
  )
  return String(ps.stdout ?? "")
    .split("\n")
    .map((line) => line.split("\t"))
    .filter((parts) => parts[0])
    .map((parts) => ({
      name: parts[0].trim(),
      running: (parts[1] ?? "").trim() === "running",
      project: (parts[2] ?? "").trim(),
    }))
}

/** Os volumes do host cujo nome é do PROJETO do ensaio. */
export function listProjectVolumes({ namePrefix, run: runFn = run } = {}) {
  const ls = runFn("docker", ["volume", "ls", "--format", "{{.Name}}"], { timeout: 30_000 })
  return String(ls.stdout ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((name) => name.startsWith(namePrefix))
}

/**
 * Remove os volumes do projeto — e diz o que NÃO saiu.
 *
 * O `compose down -v` não basta NESTE host: quando o daemon não consegue parar o
 * container, o `down` aborta no meio e o volume do Gitea (com o banco sqlite e os
 * PACOTES empurrados) fica para trás. Um ensaio verde que deixa 600MB de pacote
 * no host é o mesmo defeito que o teardown do Gitea efêmero já trata como
 * veredito: o resíduo entra no relatório, nunca é presumido removido.
 */
export function removeVolumes({ names, run: runFn = run }) {
  const remaining = []
  for (const name of names) {
    const removed = runFn("docker", ["volume", "rm", name], { timeout: 60_000 })
    const inspect = runFn("docker", ["volume", "inspect", name], { timeout: 30_000 })
    if (inspect.status === 0 && !removed.error) {
      // `volume rm` pode ter sucesso PARCIAL (volume em uso por outro grupo).
      const still = runFn("docker", ["volume", "inspect", name, "--format", "{{.Name}}"], {
        timeout: 30_000,
      })
      if (still.status === 0 && String(still.stdout ?? "").trim() === name) remaining.push(name)
    }
  }
  return remaining
}

/**
 * A checagem de segurança: o ensaio não divide recurso com a produção.
 *
 * Duas condições, as mesmas do ensaio do smoke: o NOME do container efêmero tem
 * de estar livre (o compose não sobe com nome ocupado) e uma stack da forja
 * RODANDO neste host faz o ensaio parar — ele é um ensaio, não um vizinho.
 * (O texto é próprio: o do smoke fala da Prova 5, que não existe aqui.)
 */
export function blockerDoEnsaio({ containers, giteaContainerName, ownPrefix, prodProject }) {
  const foreign = containers.filter((c) => !String(c.project ?? "").startsWith(ownPrefix))
  const collision = foreign.find((c) => c.name === giteaContainerName)
  if (collision) {
    return `o container '${giteaContainerName}' já existe neste host (projeto '${collision.project || "<sem projeto>"}', ${collision.running ? "RODANDO" : "parado"}) — o ensaio não adota container alheio; remova-o ou rode noutro host`
  }
  const live = foreign.find((c) => c.project === prodProject && c.running)
  if (live) {
    return `a stack da forja (projeto compose '${prodProject}') está RODANDO neste host (container '${live.name}') — o ensaio não divide recurso com a produção`
  }
  return null
}

/**
 * A PROVA: Gitea efêmero, registry embutido, as duas imagens, e o pull pelo digest.
 *
 * Todo I/O é injetável (o padrão da família), mas o caminho do CLI não passa por
 * dublê nenhum: `run` é o docker do host e `fetchImpl` é o fetch do node.
 */
export async function proveGiteaRegistry(deps = {}) {
  const {
    repoRoot = REPO_ROOT,
    opts = parseArgs([]),
    run: runFn = run,
    docker = dockerFacts({ run: runFn }),
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    now = () => Date.now(),
    fetchImpl = globalThis.fetch,
    exists = existsSync,
    readFile = (path) => readFileSync(path, "utf8"),
    log = (line) => console.log(line),
  } = deps

  const started = now()
  const result = {
    verdict: "unavailable",
    detail: "",
    steps: [],
    blockers: [],
    deviations: [],
    artifacts: [],
    controls: [],
    facts: {},
    residue: [],
    durationMs: 0,
    project: null,
    port: null,
  }
  const step = (name, state, detail) => {
    result.steps.push({ name, state, detail })
    log(`  ${state === "ok" ? "✅" : state === "skip" ? "⏭️ " : "❌"} ${name}: ${detail}`)
    return { name, state, detail }
  }
  const finish = (verdict, detail, blockers = []) => {
    result.verdict = verdict
    result.detail = detail
    result.blockers = [...result.blockers, ...blockers.filter(Boolean)]
    result.durationMs = now() - started
    return result
  }

  if (!docker.ok) {
    step("docker", "fail", docker.detail)
    return finish("unavailable", docker.detail, [docker.detail])
  }
  step("docker", "ok", docker.detail)

  const envPath = join(repoRoot, DEFAULT_ENV_FILE)
  if (!exists(envPath)) {
    const detail = `${DEFAULT_ENV_FILE} não existe — sem o template não há dono, tag nem registry declarado`
    step("template do env", "fail", detail)
    return finish("unavailable", detail, [detail])
  }
  const values = parseEnvFile(readFile(envPath))

  const composePath = join(repoRoot, GITEA_COMPOSE)
  if (!exists(composePath)) {
    const detail = `${GITEA_COMPOSE} não existe — o ensaio sobe a stack a partir DELE`
    step("compose da forja", "fail", detail)
    return finish("unavailable", detail, [detail])
  }

  // O prefixo do projeto é o DESTE ensaio (não o do smoke): a checagem de
  // segurança e a limpeza de resíduo filtram por ele, e um prefixo emprestado
  // faria os dois ensaios mexerem nos containers um do outro.
  const project = `${PROJECT_PREFIX}-${Math.floor(Math.random() * 0xffffffff).toString(16)}`
  result.project = project
  const port = await freePort()
  result.port = port
  const host = `127.0.0.1:${port}`
  const giteaContainer = `${project}-${GITEA_SERVICE}`

  const targets = registryTargets({ values, port })
  if (!targets.ok) {
    step("alvos do ensaio", "fail", targets.detail)
    return finish("unavailable", targets.detail, [targets.detail])
  }
  step("alvos do ensaio", "ok", targets.detail)
  result.facts.targets = {
    host,
    namespace: targets.namespace,
    version: targets.version,
    declaredRegistry: targets.declaredRegistry,
    artifacts: targets.artifacts.map((a) => ({
      key: a.key,
      repository: a.repository,
      destRef: a.destRef,
    })),
  }

  const base = renderCompose({ project, files: [composePath], envFile: envPath, run: runFn })
  if (!base.ok) {
    step("render do compose", "fail", base.detail)
    return finish("unavailable", base.detail, [base.detail])
  }
  const giteaService = base.config.services?.[GITEA_SERVICE]
  if (!giteaService) {
    const detail = `${GITEA_COMPOSE}: falta o serviço '${GITEA_SERVICE}' — o ensaio não sobe uma stack que a forja não declara`
    step("render do compose", "fail", detail)
    return finish("unavailable", detail, [detail])
  }
  const giteaImage = opts.giteaImage ?? giteaService.image
  result.facts.stack = { giteaImage, service: GITEA_SERVICE }
  result.deviations = registryDeviations({ baseEnv: giteaService.environment ?? {}, host })
  step("render do compose", "ok", `gitea=${giteaImage} · ${targets.artifacts.length} alvos`)

  if (!imagePresent(giteaImage, { run: runFn })) {
    const detail = `a imagem '${giteaImage}' não existe localmente — o ensaio não baixa imagem por conta própria (docker pull ${giteaImage})`
    step("imagem do Gitea", "fail", detail)
    return finish("unavailable", detail, [detail])
  }
  step("imagem do Gitea", "ok", giteaImage)

  // ── as imagens de ORIGEM (entrada do ensaio; o ensaio não baixa nada) ────
  const work = mkdtempSync(join(tmpdir(), `${PROJECT_PREFIX}-`))
  const resolved = {}
  for (const artifact of targets.artifacts) {
    const requested = artifact.key === "ubuntu-bun" ? opts.ubuntuBun : opts.bunMirror
    const source = requested ?? artifact.declaredSource
    if (imagePresent(source, { run: runFn })) {
      resolved[artifact.key] = { source, built: false, detail: `artefato local: ${source}` }
      step(`origem (${artifact.key})`, "ok", resolved[artifact.key].detail)
      continue
    }
    if (artifact.key === "bun-mirror" && opts.build) {
      const built = buildMirrorArtifact({
        ref: artifact.declaredSource,
        version: targets.version,
        docker: opts.docker,
        run: runFn,
        tmpDir: work,
        exists,
      })
      if (built.ok) {
        resolved[artifact.key] = {
          source: artifact.declaredSource,
          built: true,
          detail: built.detail,
        }
        step(`origem (${artifact.key})`, "ok", `${built.detail} → ${artifact.declaredSource}`)
        continue
      }
      const detail = `${source} não existe localmente e o mirror não pôde ser construído: ${built.detail}`
      step(`origem (${artifact.key})`, "fail", detail)
      return finish("unavailable", detail, [detail])
    }
    const detail = `a imagem de origem '${source}' não existe localmente — passe --${artifact.key === "ubuntu-bun" ? "ubuntu-bun" : "bun-mirror"} <ref> (ou construa: bun run runner-image:ensure)`
    step(`origem (${artifact.key})`, "fail", detail)
    return finish("unavailable", detail, [detail])
  }
  result.facts.sources = resolved

  // ── segurança: nada de produção, nada de resíduo de ensaio ───────────────
  const leftovers = listContainers({ run: runFn }).filter((c) =>
    String(c.project ?? "").startsWith(PROJECT_PREFIX),
  )
  if (leftovers.length > 0) {
    const stuck = removeContainers({ names: leftovers.map((c) => c.name), run: runFn, sleep })
    step(
      "resíduo de ensaio anterior",
      stuck.length === 0 ? "ok" : "fail",
      stuck.length === 0
        ? `${leftovers.length} container(es) do prefixo '${PROJECT_PREFIX}' removido(s)`
        : `${stuck.length} container(es) NÃO puderam ser removidos (${stuck.map((s) => s.name).join(", ")})`,
    )
    if (stuck.length > 0) {
      const detail = `há resíduo de ensaio anterior que este host não deixa remover (${stuck.map((s) => s.name).join(", ")})`
      return finish("unavailable", detail, [detail])
    }
  }
  const prodProject = dirname(GITEA_COMPOSE).split("/").filter(Boolean).pop() ?? "deploy"
  const blocker = blockerDoEnsaio({
    containers: listContainers({ run: runFn }),
    giteaContainerName: giteaContainer,
    ownPrefix: PROJECT_PREFIX,
    prodProject,
  })
  if (blocker) {
    step("segurança (produção)", "fail", blocker)
    return finish("unavailable", blocker, [blocker])
  }
  step(
    "segurança (produção)",
    "ok",
    `'${giteaContainer}' livre e nenhuma stack de '${prodProject}' rodando neste host`,
  )

  // ── o material do ensaio (efêmero, fora do repositório) ──────────────────
  const overridePath = join(work, "override.compose.yml")
  const envEphemeral = join(work, "env.gitea")
  const stackFiles = [composePath, overridePath]
  const volumeKeys = Object.keys(base.config.volumes ?? {})
  writeFileSync(
    overridePath,
    renderRegistryOverride({ project, port, volumeKeys, giteaContainerName: giteaContainer, host }),
  )
  writeFileSync(
    envEphemeral,
    `${ephemeralEnvFile(readFile(envPath), { token: "PLACEHOLDER" }).text}\n`,
  )

  // ── a DECLARAÇÃO do registry embutido (medida, não presumida) ───────────
  //
  // O ensaio NÃO liga o registry por override: ele exige que a STACK o declare
  // e mede o render nos DOIS caminhos — com o env do host (o template) e sem a
  // declaração (o default do compose, que é o que vale no host cujo env é mais
  // velho que o template). Ver `registryDeclaration`. Falhando aqui, o ensaio
  // PARA antes de subir nada: um registry desligado faria o 401 do `/v2/` vir
  // de uma rota inexistente, e o relatório diria "não provado" por um motivo
  // que ninguém pediu.
  const envSemRegistry = join(work, "env.gitea-sem-registry")
  const semDeclaracao = envSemDeclaracaoDoRegistry(readFile(envEphemeral))
  writeFileSync(envSemRegistry, `${semDeclaracao}\n`)
  const renderPadrao = renderCompose({
    project,
    files: stackFiles,
    envFile: envSemRegistry,
    run: runFn,
  })
  const declaracao = registryDeclaration({
    values,
    renderedDeclarado: giteaService.environment ?? {},
    renderedPadrao: renderPadrao.ok
      ? (renderPadrao.config?.services?.[GITEA_SERVICE]?.environment ?? {})
      : null,
    renderPadraoFalhou: renderPadrao.ok ? null : renderPadrao.detail,
  })
  if (!declaracao.ok) {
    step("registry embutido declarado", "fail", declaracao.detail)
    // Nada foi criado ainda (nenhum container, nenhum volume): a limpeza é o
    // diretório de trabalho, e não o `cleanup()` do projeto.
    rmSync(work, { recursive: true, force: true })
    return finish("unavailable", declaracao.detail, [declaracao.detail])
  }
  step("registry embutido declarado", "ok", declaracao.detail)
  result.facts.registryDeclaration = declaracao

  const projectContainers = () =>
    listContainers({ run: runFn }).filter(
      (c) => c.project === project || c.name.startsWith(`${project}-`),
    )
  const cleanup = ({ keep = opts.keep } = {}) => {
    if (keep) {
      log(`  ⏭️  stack mantida (--keep): projeto ${project}, Gitea em ${host}`)
      return
    }
    runFn(
      "docker",
      composeArgs({
        project,
        files: stackFiles,
        envFile: envEphemeral,
        rest: ["down", "-v", "--remove-orphans"],
      }),
      { timeout: 180_000 },
    )
    const stuck = removeContainers({
      names: projectContainers().map((c) => c.name),
      run: runFn,
      sleep,
    })
    const orphanVolumes = removeVolumes({
      names: listProjectVolumes({ namePrefix: `${project}-`, run: runFn }),
      run: runFn,
    })
    const leftover = [
      ...stuck.map((c) => `${c.name} (container)`),
      ...orphanVolumes.map((v) => `${v} (volume)`),
    ]
    if (leftover.length > 0) {
      log(
        `  ⚠️  resíduo: ${leftover.length} item(ns) não puderam ser removidos neste host — remova à mão: ${leftover.join(", ")}`,
      )
      result.residue = leftover
    }
    rmSync(work, { recursive: true, force: true })
  }

  try {
    const up = runFn(
      "docker",
      composeArgs({
        project,
        files: stackFiles,
        envFile: envEphemeral,
        rest: ["up", "-d", GITEA_SERVICE],
      }),
      { timeout: 300_000 },
    )
    if (up.error || up.status !== 0) {
      const detail = `docker compose up -d ${GITEA_SERVICE} falhou: ${(up.stderr || up.stdout || up.error?.message || "").trim().split("\n").slice(-1)[0] || "sem saída"}`
      step("Gitea efêmero", "fail", detail)
      cleanup()
      return finish("unavailable", detail, [detail])
    }
    const healthy = await waitForGitea({ port, timeoutS: 180, sleep })
    if (!healthy.ok) {
      step("Gitea efêmero", "fail", healthy.detail)
      cleanup()
      return finish("unavailable", healthy.detail, [healthy.detail])
    }
    step("Gitea efêmero", "ok", `${healthy.detail} · projeto ${project}`)

    // O DONO do pacote é o namespace declarado (não um usuário inventado).
    const createUser = runFn(
      "docker",
      [
        "exec",
        "-u",
        "git",
        giteaContainer,
        "gitea",
        "admin",
        "user",
        "create",
        "--username",
        targets.namespace,
        "--password",
        OWNER_PASSWORD,
        "--email",
        `${targets.namespace}@example.com`,
        "--admin",
        "--must-change-password=false",
      ],
      { timeout: 120_000 },
    )
    if (createUser.error || createUser.status !== 0) {
      const detail = `não consegui criar o dono '${targets.namespace}' no Gitea efêmero: ${(createUser.stderr || createUser.stdout || createUser.error?.message || "").trim().split("\n")[0]}`
      step("dono do pacote", "fail", detail)
      cleanup()
      return finish("unavailable", detail, [detail])
    }
    step("dono do pacote", "ok", `'${targets.namespace}' criado dentro do Gitea efêmero`)

    const challenge = await fetchWithTimeout(`http://${host}/v2/`, { fetchImpl, timeoutMs: 15_000 })
    const wwwAuth = challenge.headers?.get?.("www-authenticate") ?? ""
    const challengeOk = challenge.status === 401 && /Bearer/.test(wwwAuth)
    result.facts.challenge = { status: challenge.status, wwwAuthenticate: wwwAuth }
    step(
      "desafio do registry",
      challengeOk ? "ok" : "fail",
      challengeOk
        ? `/v2/ responde 401 com Bearer e realm efêmero`
        : `o /v2/ não desafiou como registry (${challenge.detail}) — ${wwwAuth || "sem header WWW-Authenticate"}`,
    )
    if (!challengeOk) {
      cleanup()
      const detail = `o registry embutido não respondeu ao desafio do /v2/ (status ${challenge.status})`
      return finish("unavailable", detail, [detail])
    }

    const login = dockerCall({
      docker: opts.docker,
      args: ["login", host, "-u", targets.namespace, "--password-stdin"],
      run: (command, args, o) => runFn(command, args, { ...o, input: `${OWNER_PASSWORD}\n` }),
      timeoutMs: 60_000,
    })
    if (login.code !== 0) {
      const detail = `o docker login em ${host} falhou: ${login.output.split("\n").slice(-1)[0] || "sem saída"}`
      step("docker login", "fail", detail)
      cleanup()
      return finish("unavailable", detail, [detail])
    }
    step("docker login", "ok", `credencial de '${targets.namespace}' aceita pelo registry embutido`)

    for (const artifact of targets.artifacts) {
      const record = {
        key: artifact.key,
        role: artifact.role,
        source: resolved[artifact.key].source,
        built: resolved[artifact.key].built,
        destRef: artifact.destRef,
        digest: null,
        manifest: null,
        platform: null,
        blobs: null,
        pullBack: null,
        evidence: null,
        controls: [],
        wrongs: [],
        unavailable: null,
      }
      result.artifacts.push(record)

      const pushed = pushArtifact({
        sourceRef: resolved[artifact.key].source,
        target: artifact,
        docker: opts.docker,
        run: runFn,
        timeoutMs: opts.timeoutS * 1000,
      })
      if (!pushed.ok) {
        record.unavailable = `o push de '${artifact.destRef}' não aconteceu: ${pushed.detail}`
        step(`publish (${artifact.key})`, "fail", record.unavailable)
        continue
      }
      record.digest = pushed.digest
      step(`publish (${artifact.key})`, "ok", `${artifact.destRef} → ${pushed.digest}`)

      const scope = `repository:${artifact.repository}:pull`
      const token = await registryToken({
        baseUrl: `http://${host}`,
        user: targets.namespace,
        password: OWNER_PASSWORD,
        scope,
        fetchImpl,
        timeoutMs: 20_000,
      })
      if (!token.ok) {
        record.unavailable = `não consegui token de pull para '${artifact.repository}': ${token.detail}`
        step(`API (${artifact.key})`, "fail", record.unavailable)
        continue
      }
      const byTag = await registryManifest({
        baseUrl: `http://${host}`,
        repository: artifact.repository,
        reference: artifact.tag,
        token: token.token,
        fetchImpl,
        timeoutMs: 30_000,
      })
      if (!byTag.ok) {
        record.wrongs.push(
          `o registry não serve o manifest da tag '${artifact.tag}' (${byTag.detail})`,
        )
        step(`API (${artifact.key})`, "fail", record.wrongs.slice(-1)[0])
        continue
      }
      record.manifest = { digest: byTag.digest, mediaType: byTag.mediaType }
      if (byTag.digest !== record.digest) {
        record.wrongs.push(
          `o registry serve o digest ${byTag.digest ?? "<sem header>"} para a tag '${artifact.tag}', e o push registrou ${record.digest}`,
        )
      } else {
        step(
          `API (${artifact.key})`,
          "ok",
          `a tag '${artifact.tag}' aponta para o digest do push (${byTag.digest}) · ${byTag.mediaType}`,
        )
      }

      const platform = await platformManifestOf({
        baseUrl: `http://${host}`,
        repository: artifact.repository,
        manifest: byTag.body,
        token: token.token,
        fetchImpl,
        timeoutMs: 30_000,
      })
      if (!platform.ok) {
        record.wrongs.push(`não consegui resolver o manifest da plataforma: ${platform.detail}`)
        step(`blobs (${artifact.key})`, "fail", record.wrongs.slice(-1)[0])
        continue
      }
      record.platform = platform.digest
      const blobs = await verifyBlobs({
        baseUrl: `http://${host}`,
        repository: artifact.repository,
        manifest: platform.body,
        token: token.token,
        fetchImpl,
        timeoutMs: 120_000,
      })
      record.blobs = {
        totalBytes: blobs.totalBytes,
        count: blobs.blobs.length,
        hashed: blobs.hashed,
        detail: blobs.detail,
      }
      if (!blobs.ok) {
        for (const p of blobs.problems ?? [blobs.detail]) record.wrongs.push(`blob: ${p}`)
        step(`blobs (${artifact.key})`, "fail", blobs.detail)
      } else {
        step(`blobs (${artifact.key})`, "ok", blobs.detail)
      }

      const untag = untagRef({ ref: artifact.destRef, docker: opts.docker, run: runFn })
      if (!untag.ok) {
        record.unavailable = `não consegui remover a tag local: ${untag.detail}`
        step(`untag (${artifact.key})`, "fail", record.unavailable)
        continue
      }
      step(`untag (${artifact.key})`, "ok", untag.detail)

      const controlDigest = pullRef({
        ref: `${artifact.repoRef}@${fabricatedDigest(`${artifact.repository}-nao-publicado`)}`,
        docker: opts.docker,
        run: runFn,
        timeoutMs: 180_000,
      })
      const digestControlOk = !controlDigest.ok
      record.controls.push({
        name: "digest-inexistente",
        ok: digestControlOk,
        detail: digestControlOk
          ? `o pull por um digest inexistente FALHOU (${controlDigest.detail})`
          : "o pull por um digest inexistente PASSOU — o registry estaria servindo qualquer coisa",
      })
      const tagControlOk = !pullRef({
        ref: artifact.destRef.replace(/:([^:/]+)$/, ":prova-nunca-publicada"),
        docker: opts.docker,
        run: runFn,
        timeoutMs: 180_000,
      }).ok
      record.controls.push({
        name: "tag-nunca-publicada",
        ok: tagControlOk,
        detail: tagControlOk
          ? "o pull de uma tag nunca publicada FALHOU"
          : "o pull de uma tag nunca publicada PASSOU",
      })
      step(
        `controles (${artifact.key})`,
        digestControlOk && tagControlOk ? "ok" : "fail",
        record.controls.map((c) => `${c.name}=${c.ok ? "recusou" : "PASSOU"}`).join(" · "),
      )

      const pulled = pullRef({
        ref: `${artifact.repoRef}@${record.digest}`,
        docker: opts.docker,
        run: runFn,
        timeoutMs: opts.timeoutS * 1000,
      })
      if (!pulled.ok) {
        record.wrongs.push(`o PULL-BACK por digest falhou (${pulled.detail})`)
        step(`pull-back (${artifact.key})`, "fail", record.wrongs.slice(-1)[0])
        continue
      }
      const refs = repoDigestsOf({
        ref: `${artifact.repoRef}@${record.digest}`,
        docker: opts.docker,
        run: runFn,
      })
      const repoDigestOk = refs.includes(`${artifact.repoRef}@${record.digest}`)
      if (!repoDigestOk)
        record.wrongs.push(
          `o objeto puxado não declara ${artifact.repoRef}@${record.digest} (RepoDigests: ${refs.join(", ") || "vazio"})`,
        )
      record.pullBack = { ok: true, detail: pulled.detail, repoDigests: refs }
      step(
        `pull-back (${artifact.key})`,
        repoDigestOk ? "ok" : "fail",
        `${pulled.detail} · RepoDigests ${repoDigestOk ? "confere" : "DIVERGE"}`,
      )

      const spec = ARTIFACTS.find((a) => a.key === artifact.key)
      const evidence = artifactEvidence({
        spec,
        ref: `${artifact.repoRef}@${record.digest}`,
        version: targets.version,
        docker: opts.docker,
        run: runFn,
        tmpDir: work,
        timeoutMs: opts.timeoutS * 1000,
      })
      record.evidence = evidence
      if (!evidence.ok)
        record.wrongs.push(`o artefato puxado não é o declarado: ${evidence.detail}`)
      step(`artefato (${artifact.key})`, evidence.ok ? "ok" : "fail", evidence.detail)
      record.controls.forEach((c) => result.controls.push({ ...c, artifact: artifact.key }))
    }

    // O artefato CONSTRUÍDO pelo ensaio não fica no store local: a tag era o
    // endereço da origem, não um resultado do ensaio (quem publica em produção é
    // o `sync-bun-mirror.yml`). Um artefato que veio por `--bun-mirror` é do
    // operador, e não se toca.
    for (const artifact of targets.artifacts) {
      if (!resolved[artifact.key]?.built) continue
      const dropped = dockerCall({
        docker: opts.docker,
        args: ["rmi", artifact.declaredSource],
        run: runFn,
        timeoutMs: 120_000,
      })
      const record = result.artifacts.find((a) => a.key === artifact.key)
      if (record) record.sourceDropped = dropped.code === 0
    }

    cleanup()
    const summary = summarizePublish({
      artifacts: result.artifacts,
      controls: result.controls.map((c) => ({
        name: `${c.artifact}/${c.name}`,
        ok: c.ok,
        detail: c.detail,
      })),
    })
    const detail =
      summary.verdict === "proven"
        ? `as ${targets.artifacts.length} imagens foram publicadas no registry embutido de um Gitea efêmero e voltaram por DIGEST, com o artefato medido e os controles recusando o que não existe`
        : summary.verdict === "violated"
          ? `a etapa 1 não fecha: ${summary.wrongs.slice(0, 3).join(" | ")}`
          : `não deu para fechar as duas metades: ${summary.unavailable.slice(0, 2).join(" | ") || "medição incompleta"}`
    return finish(summary.verdict, detail, summary.wrongs)
  } catch (error) {
    step("ensaio", "fail", `erro fatal: ${error?.message ?? error}`)
    cleanup()
    return finish("unavailable", `erro fatal no ensaio: ${error?.message ?? error}`, [
      String(error?.message ?? error),
    ])
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. CLI e relatório
// ═══════════════════════════════════════════════════════════════════════════

export const USAGE = `prove-gitea-registry — publica as DUAS imagens no registry embutido de um Gitea efêmero
                              e puxa as duas de volta POR DIGEST

Usage:
  node scripts/prove-gitea-registry.mjs [opções]

Opções:
  --json                 mesmo veredito em JSON plano
  --keep                 não derruba a stack efêmera no fim (para inspeção)
  --ubuntu-bun <ref>     artefato de origem da imagem do runner (default: o DECLARADO no template)
  --bun-mirror <ref>     artefato de origem do mirror do Bun (default: o DECLARADO no template)
  --no-build             não constrói o mirror ausente a partir do Dockerfile.bun-mirror
  --timeout <s>          orçamento por operação de docker/registry (default: ${DEFAULT_TIMEOUT_S})
  --gitea-image <ref>    força a imagem do Gitea (default: a do compose da forja)
  --help, -h             esta ajuda

Exit codes:
  0 — PROVADO: as duas imagens publicadas e puxadas por digest no registry embutido
  1 — VIOLADO: um digest/blob/artefato divergiu, ou um controle negativo PASSOU
  2 — INDETERMINADO: sem docker, imagem/artefato ausente, produção no host, tempo esgotado
  3 — uso inválido
`

/**
 * @param {string[]} argv
 */
export function parseArgs(argv) {
  const opts = {
    json: false,
    keep: false,
    ubuntuBun: null,
    bunMirror: null,
    build: true,
    timeoutS: DEFAULT_TIMEOUT_S,
    giteaImage: null,
    docker: "docker",
    help: false,
    error: null,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const value = () => {
      const v = argv[i + 1]
      if (v === undefined || v.startsWith("--")) {
        opts.error = `${arg} exige um valor`
        return null
      }
      i += 1
      return v
    }
    switch (arg) {
      case "--json":
        opts.json = true
        break
      case "--keep":
        opts.keep = true
        break
      case "--ubuntu-bun": {
        const v = value()
        if (v !== null) opts.ubuntuBun = v
        break
      }
      case "--bun-mirror": {
        const v = value()
        if (v !== null) opts.bunMirror = v
        break
      }
      case "--no-build":
        opts.build = false
        break
      case "--timeout": {
        const v = value()
        if (v === null) break
        const n = Number(v)
        if (!Number.isFinite(n) || n <= 0)
          opts.error = `--timeout exige um número de segundos (recebi '${v}')`
        else opts.timeoutS = n
        break
      }
      case "--gitea-image": {
        const v = value()
        if (v !== null) opts.giteaImage = v
        break
      }
      case "--help":
      case "-h":
        opts.help = true
        break
      default:
        opts.error = `argumento desconhecido: ${arg}`
    }
    if (opts.error) break
  }
  return opts
}

/** O relatório: o veredito, o que foi medido em cada artefato, os desvios e os limites. */
export function renderReport(result, { emit = console.log } = {}) {
  const line = (s = "") => emit(s)
  const badge =
    result.verdict === "proven"
      ? "✅ PROVADO"
      : result.verdict === "violated"
        ? "❌ VIOLADO"
        : "⚠️  INDETERMINADO"
  line("")
  line("═".repeat(78))
  line(`  prove-gitea-registry — ${badge}`)
  line("═".repeat(78))
  line(`  projeto efêmero : ${result.project ?? "<não subiu>"}`)
  line(
    `  Gitea local     : ${result.facts?.targets?.host ?? "?"} (efêmero; nada de produção foi tocado)`,
  )
  line(`  registry        : embutido (o MESMO processo do Gitea, no /v2/ da mesma porta)`)
  line(
    `  alvos           : dono '${result.facts?.targets?.namespace ?? "?"}' · tag ${result.facts?.targets?.version ?? "?"} · registry declarado ${result.facts?.targets?.declaredRegistry ?? "?"}`,
  )
  line(`  duração         : ${(result.durationMs / 1000).toFixed(1)}s`)
  line("")
  for (const s of result.steps)
    line(`  ${s.state === "ok" ? "✅" : s.state === "skip" ? "⏭️ " : "❌"} ${s.name}: ${s.detail}`)
  if (result.artifacts.length > 0) {
    line("")
    line("  artefatos (as DUAS imagens da etapa 1):")
    for (const a of result.artifacts) {
      line(`   • ${a.key} — ${a.role}`)
      line(`     origem  : ${a.source}${a.built ? " (CONSTRUÍDO do Dockerfile.bun-mirror)" : ""}`)
      line(`     destino : ${a.destRef}`)
      line(`     digest  : ${a.digest ?? "<sem push>"}`)
      line(
        `     registry: ${a.manifest ? `manifest da tag = ${a.manifest.digest} (${a.manifest.mediaType})` : "<não lido>"}${a.platform ? ` · plataforma ${a.platform}` : ""}`,
      )
      line(`     blobs   : ${a.blobs ? a.blobs.detail : "<não verificado>"}`)
      line(`     pull-back: ${a.pullBack ? a.pullBack.detail : "<não feito>"}`)
      line(`     artefato : ${a.evidence ? a.evidence.detail : "<não medido>"}`)
      for (const c of a.controls) line(`     controle : ${c.name} — ${c.detail}`)
    }
  }
  line("")
  line(`  VEREDITO: ${badge} — ${result.detail ?? ""}`)
  if (result.deviations.length > 0) {
    line("")
    line("  Desvios declarados (o ensaio muda isto em relação à stack declarada):")
    for (const d of result.deviations)
      line(`   • ${d.key}: ${d.from ?? "<ausente>"} → ${d.to} — ${d.why}`)
  }
  line("")
  line("  Limites declarados (o que este ensaio NÃO prova):")
  line(
    "   • a VPS (git.severinno.cloud): publicar lá e definir as repository variables nas duas forjas seguem sendo os dois atos de operação da etapa 1",
  )
  line("   • TLS/Caddy, DNS e firewall: a stack sobe só o serviço gitea, em HTTP no loopback")
  line("   • o act_runner: quem puxa a imagem do job é o DAEMON do host, com a credencial DELE")
  line(
    "   • a visibilidade do pacote: o anônimo é recusado (medido); torná-lo público é decisão de operação",
  )
  if (result.residue && result.residue.length > 0) {
    line("")
    line(`  Resíduo (o host recusou remover): ${result.residue.join(", ")}`)
  }
  if (result.blockers.length > 0) {
    line("")
    line("  Bloqueios/violações:")
    for (const b of result.blockers) line(`   • ${b}`)
  }
  line("═".repeat(78))
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.error) {
    console.error(`❌ ${opts.error}`)
    console.error(USAGE)
    process.exit(EXIT.USAGE)
  }
  if (opts.help) {
    console.log(USAGE)
    process.exit(EXIT.OK)
  }

  if (!opts.json) {
    console.log("")
    console.log("═".repeat(78))
    console.log("  prove-gitea-registry — as duas imagens no registry EMBUTIDO de um Gitea efêmero")
    console.log("═".repeat(78))
    console.log(
      "  stack : o MESMO deploy/docker-compose.gitea.yml, efêmero (volumes, porta e ROOT_URL próprios)",
    )
    console.log(
      "  prova : push dos dois artefatos + pull-back POR DIGEST, com os controles negativos",
    )
  }

  // Em `--json` o passo a passo NÃO sai no stdout: o relatório JSON é o único
  // documento (uma linha de log antes dele deixaria de ser "JSON plano", e o
  // `check:prove-docs` executa este caminho a cada PR).
  const result = await proveGiteaRegistry({ opts, log: opts.json ? () => {} : undefined })
  if (opts.json) console.log(JSON.stringify(result, null, 2))
  else renderReport(result)
  process.exit(exitCodeFor(result.verdict))
}

const IS_DIRECT_RUN = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url
if (IS_DIRECT_RUN) {
  main().catch((error) => {
    console.error(`❌ erro fatal no ensaio: ${error?.message ?? error}`)
    process.exit(EXIT.UNAVAILABLE)
  })
}
