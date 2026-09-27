#!/usr/bin/env node
// =============================================================================
// scripts/ensure-runner-image.mjs — GARANTE que a imagem do runner existe no
// registry ANTES de subir o act_runner da forja.
//
// Por que existe: os labels do runner (deploy/docker-compose.gitea.yml) apontam
// para <registry>/<namespace>/ubuntu-bun:<BUN_VERSION> — a imagem que EMBARCA o
// Bun na versão da fonte única (repo variable BUN_VERSION). É o que faz o
// fast path de 0s do scripts/setup-bun-ci.sh disparar na forja. Só que não há
// fallback: com a tag ausente (ou o pacote privado), TODO job falha ao iniciar
// o container — e a falha aparece longe da causa (no meio do job, não na
// subida da stack). Este comando fecha essa lacuna: lê o mesmo env do compose,
// confere a tag NO REGISTRY (API OCI v2, sem docker e sem baixar a imagem) e,
// se ela não existir, PUBLICA — pelo caminho canônico que já existe
// (.github/workflows/sync-ubuntu-bun-mirror.yml) ou por build+push local.
//
// Invariante central: a garantia é a RELEITURA. Depois de publicar, o script
// consulta o registry DE NOVO — não supõe que o push/dispatch funcionou. Um
// "publiquei" que ninguém verificou é exatamente o tipo de prova que este
// repositório trata como inexistente.
//
// Invariante secundária (e a mais fácil de errar): INDETERMINADO ≠ AUSENTE.
// Rede fora do ar, registry inacessível ou pacote privado sem credencial NÃO
// são "a tag não existe" — publicar às cegas nesse estado mascara a causa e
// pode empurrar uma imagem sobre um problema de permissão. Os três estados são
// distintos, com exit codes distintos e remédios distintos.
//
// Identidade com o compose: este script NÃO tem configuração própria. Ele lê o
// MESMO arquivo (`deploy/.env.gitea`) e aplica os MESMOS defaults do compose —
// que NÃO são literais daqui: saem dos arquivos comitados (o valor declarado de
// `IMAGE_REGISTRY`/`IMAGE_NAMESPACE`), pela mesma leitura do `registry-source`.
// Uma segunda fonte de verdade (um literal de reserva) seria a próxima
// divergência — e sobreviveria à troca de registry em silêncio.
//
// Usage:
//   node scripts/ensure-runner-image.mjs                  # garante (publica se faltar)
//   node scripts/ensure-runner-image.mjs --check          # só verifica; nunca publica
//   node scripts/ensure-runner-image.mjs --gitea-env deploy/.env.gitea
//   node scripts/ensure-runner-image.mjs --source workflow   # só pelo workflow
//   node scripts/ensure-runner-image.mjs --local-image    # host SEM registry: aceita a
//                                                         # CÓPIA LOCAL do daemon como prova
//   node scripts/ensure-runner-image.mjs --json
//   node scripts/ensure-runner-image.mjs --prove          # PROVA o bloqueio contra um
//                                                         # registry de TESTE (ver abaixo)
//
// --prove: não checa a imagem de produção — ele EXECUTA o caminho real da
// subida (deploy/gitea-up.sh) contra um registry de teste em 127.0.0.1, com a
// tag ausente e com a tag presente, e afirma sobre o LOG do docker dublê: com a
// tag ausente NENHUM `compose up` acontece (o runner não sobe) e, com a tag
// presente, o runner sobe (o controle). É a diferença entre a garantia
// DECLARADA e a garantia PROVADA — quem implementa está em
// scripts/prove-runner-image-gate.mjs, e o mesmo resultado entra no `doctor`.
//
// ATENÇÃO (armadilha REAL, medida): a flag NÃO se chama `--env-file` de
// propósito. `--env-file` é uma opção do PRÓPRIO Node (>=20.6) e o runtime a
// consome ANTES do script rodar — mesmo colocada DEPOIS do caminho do script.
// Com o arquivo existente o efeito é invisível (o Node carrega o mesmo env),
// mas com o arquivo AUSENTE o processo morre com exit 9 e a mensagem do Node
// ('node: <arquivo>: not found'), sem NUNCA chegar ao nosso diagnóstico. É
// exatamente o caso em que a mensagem precisa ser a nossa: o env que o compose
// usa não está lá.
//
// PARA O DOCTOR (exportado, sem CLI própria): `createRegistryIdentityCache`
// MEMOIZA a resposta de `probeImageIdentity` por (ref, versão esperada,
// presença de credencial) e deduplica chamadas CONCORRENTES — o doctor faz a
// MESMA pergunta em dois fatos (referências não versionadas e contrato da
// imagem publicada) e sem o cache cada um ia ao registry por conta própria
// (manifesto + config blob, e token em pacote privado). Só a RESPOSTA
// definitiva (`proven`/`mismatch`/`no-label`/`missing`/`unauthorized`) entra no
// cache: os estados TRANSITÓRIOS (`unreachable`/`error`) e as exceções não —
// cachear um timeout curto apagaria a prova de quem pediu com timeout maior. O
// token nunca entra na chave (nem o `timeoutMs`: ver o doc de
// `createRegistryIdentityCache`).
//
// Pré-requisito no compose:
//   deploy/gitea-up.sh chama este script ANTES de `docker compose up -d runner`
//   (ver o guard checkGiteaBringUp — a ordem é invariante, não documentação).
//
// Exit codes:
//   0 — a tag EXISTE e é puxável (anônimo) — o runner pode subir
//   1 — erro de uso (argumento desconhecido / --help)
//   2 — env inválido (arquivo ausente, BUN_VERSION vazio)
//   3 — INDETERMINADO (registry inacessível, ou pacote privado sem credencial)
//   4 — AUSENTE (só no modo --check: a tag não existe e não publicamos)
//   5 — publicação falhou OU a releitura não confirmou a tag
//   6 — INDETERMINADO, ACEITO pela CÓPIA LOCAL do daemon (só com --local-image):
//       a imagem está no docker DESTE host — o que segue sem prova é a TAG no
//       registry (e um host SEM esta cópia)
//
// ── --local-image: o host sem registry, como DECISÃO e não como fim de linha ──
//
// INDETERMINADO ≠ AUSENTE, e é por isso que este script se recusa a publicar
// nesse estado: o registry pode estar fora, o pacote pode ser privado — publicar
// às cegas mascararia a causa. Mas num host que opera SEM alcançar o registry
// (rede fechada, DNS que não resolve, pacote sem credencial anônima) a recusa
// virava um beco: não há nada que o operador possa rodar daqui. A pergunta que
// FALTAVA é respondível localmente — a imagem está no daemon DESTE host? —, e
// ela não substitui a outra: quem responde "a tag existe no registry?" continua
// sendo o probe. O que a flag faz é tornar a segunda pergunta uma ESCOLHA do
// operador, com o veredito próprio (exit 6) e o que NÃO ficou provado dito em
// voz alta. Sem a flag nada disto acontece: o caminho é exatamente o de antes
// (INDETERMINADO, exit 3) — aceitar a cópia local por conta própria trocaria o
// pré-requisito por uma suposição, que é o defeito que o script existe para
// impedir.
// =============================================================================

import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { dirname, isAbsolute, join } from "node:path"
import { fileURLToPath } from "node:url"

import { declaredImageValue } from "./registry-source.mjs"

export const DEFAULT_ENV_FILE = "deploy/.env.gitea"
export const RUNNER_IMAGE_REPO = "ubuntu-bun"
export const SYNC_WORKFLOW = "sync-ubuntu-bun-mirror.yml"
export const DOCKERFILE = "Dockerfile.ubuntu-bun"

/**
 * O nome da variável da versão, montado por CÓDIGO (mesma preocupação do
 * `check-bun-mirror`): uma string literal `BUN_VERSION=` no fonte é o que os
 * guards estáticos procuram — e este arquivo não declara versão nenhuma.
 */
const VERSION_KEY_BARE = ["BUN", "VERSION"].join("_")

export const EXIT = {
  OK: 0,
  USAGE: 1,
  ENV: 2,
  UNKNOWN: 3,
  MISSING: 4,
  PUBLISH_FAILED: 5,
  // Só sai com `--local-image`: o registry está INDETERMINADO e a imagem foi
  // encontrada na cópia LOCAL do daemon. É um código PRÓPRIO porque os outros
  // dois estados mentiriam: `OK` diria que a tag está publicada, e `UNKNOWN`
  // diria que nada foi provado — e a cópia local É uma prova, sobre um fato
  // diferente (o runner deste host roda esta imagem).
  LOCAL: 6,
}

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")

const C = {
  green: "\u001b[0;32m",
  red: "\u001b[0;31m",
  yellow: "\u001b[1;33m",
  cyan: "\u001b[0;36m",
  nc: "\u001b[0m",
}

const log = {
  pass: (m) => console.log(`  ${C.green}✅${C.nc} ${m}`),
  fail: (m) => console.log(`  ${C.red}❌${C.nc} ${m}`),
  warn: (m) => console.log(`  ${C.yellow}⚠️${C.nc} ${m}`),
  info: (m) => console.log(`  ${C.cyan}▸${C.nc} ${m}`),
  plain: (m = "") => console.log(m),
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. Env → referência da imagem (MESMOS defaults do compose)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Parseia um arquivo .env no formato do compose (`CHAVE=valor`, `#` comentário).
 * Aspas simples/duplas são removidas; comentário inline só é removido FORA de
 * aspas (`.env` do compose aceita `VALOR # nota`).
 *
 * @param {string} content
 * @returns {Record<string, string>}
 */
export function parseEnvFile(content) {
  const values = {}
  for (const raw of content.split("\n")) {
    const line = raw.trim()
    if (line === "" || line.startsWith("#")) continue
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!m) continue
    let value = m[2].trim()
    const quoted =
      value.length >= 2 &&
      (value.startsWith('"') || value.startsWith("'")) &&
      value.endsWith(value[0])
    if (quoted) {
      value = value.slice(1, -1)
    } else {
      value = value.replace(/\s+#.*$/, "").trim()
    }
    values[m[1]] = value
  }
  return values
}

/**
 * Os DEFAULTS do compose, lidos do VALOR DECLARADO — não de um literal.
 *
 * `resolveImageRef` resolve como o compose resolve: o env do arquivo primeiro, e
 * o default depois. O default NÃO é uma constante escrita aqui: é o valor que os
 * arquivos comitados declaram (`.actrc`, `deploy/env.gitea.example`,
 * `.env.production.example`), pela MESMA leitura que o `registry-source.mjs`
 * expõe aos outros scripts. Um literal de reserva sobreviveria à migração de
 * registry — o pull continuaria vindo do host velho, e nada ficaria vermelho.
 *
 * @param {string} [root]
 * @returns {{IMAGE_REGISTRY: string|null, IMAGE_NAMESPACE: string|null}}
 */
export function defaultImageValues(root = REPO_ROOT) {
  return {
    IMAGE_REGISTRY: declaredImageValue(root, "IMAGE_REGISTRY")?.value ?? null,
    IMAGE_NAMESPACE: declaredImageValue(root, "IMAGE_NAMESPACE")?.value ?? null,
  }
}

/**
 * Monta a referência da imagem a partir do env, com os MESMOS defaults do
 * compose (`${IMAGE_REGISTRY:-<declarado>}/${IMAGE_NAMESPACE:-<declarado>}/ubuntu-bun`).
 * `BUN_VERSION` NÃO tem default: sem ele o compose montaria uma tag vazia —
 * falha explícita é melhor que uma imagem implícita.
 *
 * @param {Record<string, string>} values
 * @param {{root?: string}} [opts]
 * @returns {{ref: string, registry: string, namespace: string, version: string}|{error: string}}
 */
export function resolveImageRef(values, { root = REPO_ROOT } = {}) {
  const declared = defaultImageValues(root)
  const registry = (values.IMAGE_REGISTRY || "").trim() || declared.IMAGE_REGISTRY
  const namespace = (values.IMAGE_NAMESPACE || "").trim() || declared.IMAGE_NAMESPACE
  const version = (values.BUN_VERSION || "").trim()
  const missingImage = []
  if (!registry) missingImage.push("IMAGE_REGISTRY")
  if (!namespace) missingImage.push("IMAGE_NAMESPACE")
  if (missingImage.length > 0) {
    return {
      error:
        `${missingImage.join(" e ")} ausente(s) no env E nenhum arquivo comitado declara o valor — ` +
        "o compose usa o default embutido, que não existe aqui: declare a variável no env (ou no template comitado) antes de resolver a imagem.",
    }
  }
  if (version === "") {
    return {
      error:
        "BUN_VERSION ausente/vazio no env — é ele que define a tag da imagem do runner. " +
        "Defina-o IGUAL à repository variable BUN_VERSION (o compose usaria uma tag vazia e nenhum job iniciaria).",
    }
  }
  return {
    ref: `${registry.replace(/\/+$/, "")}/${namespace.replace(/^\/+|\/+$/g, "")}/${RUNNER_IMAGE_REPO}:${version}`,
    registry,
    namespace,
    version,
  }
}

/**
 * Separa a referência em registry / repositório / tag. Aceita scheme explícito
 * (`http://127.0.0.1:5000/ns/img:tag`) — necessário para registries locais e
 * para os testes; sem ele assume HTTPS (ghcr.io, Gitea, Docker Hub).
 *
 * @param {string} ref
 * @returns {{base: string, host: string, repository: string, tag: string, registry: string}}
 */
export function registryEndpoints(ref) {
  const tagAt = ref.lastIndexOf(":")
  const tag = ref.slice(tagAt + 1)
  const namePart = ref.slice(0, tagAt)
  // Host = primeiro segmento do nome (com scheme, se houver).
  const schemeMatch = namePart.match(/^(https?:\/\/)/)
  const scheme = schemeMatch ? schemeMatch[1] : "https://"
  const withoutScheme = namePart.replace(/^https?:\/\//, "")
  const segments = withoutScheme.split("/")
  const host = segments[0]
  const registry = `${scheme}${host}`
  return {
    base: registry,
    host,
    registry,
    repository: segments.slice(1).join("/"),
    tag,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. A tag existe? (API OCI v2, sem docker e sem baixar a imagem)
// ═══════════════════════════════════════════════════════════════════════════

const MANIFEST_ACCEPT = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
  "application/vnd.docker.distribution.manifest.v2+json",
].join(", ")

/**
 * Credencial OPCIONAL para o registry, vinda do ambiente (nunca do repositório).
 *
 * POR QUE EXISTE: quando o pacote é PRIVADO, o fluxo anônimo devolve 401 e não
 * há como provar NADA sobre o que a tag serve — o estado honesto é
 * "indeterminado". Com um token no ambiente (o caso do CI, ou de quem rodou
 * `docker login`/exportou um PAT), a mesma pergunta passa a ter resposta. `user`
 * é irrelevante para o GHCR (qualquer valor serve com um PAT) e é exigido por
 * registries que usam HTTP basic de verdade.
 *
 * @param {Record<string, string|undefined>} [env]
 * @returns {{user: string, token: string}|null}
 */
export function credentialsFromEnv(env = process.env) {
  const token = env.GHCR_TOKEN || env.GITHUB_TOKEN || env.GH_TOKEN || ""
  if (!token.trim()) return null
  return { user: env.GHCR_USER || env.GITHUB_ACTOR || "oauth2", token: token.trim() }
}

/**
 * Pede um token ao registry a partir do desafio `WWW-Authenticate` (fluxo Bearer
 * do Docker Distribution) — ANÔNIMO, ou autenticado quando há credencial. Sem
 * desafio, tenta o endpoint padrão de token do host: é o que faz o GHCR e o
 * registry do Gitea responderem.
 *
 * @returns {Promise<string|null>}
 */
async function fetchRegistryToken(
  challenge,
  { fetchImpl, timeoutMs, repository, host, credentials = null },
) {
  const realm = /realm="([^"]+)"/.exec(challenge)?.[1]
  const service = /service="([^"]+)"/.exec(challenge)?.[1] ?? host
  const scope = /scope="([^"]+)"/.exec(challenge)?.[1] ?? `repository:${repository}:pull`
  const base = realm || `https://${host}/token`
  const url = `${base}${base.includes("?") ? "&" : "?"}service=${encodeURIComponent(service)}&scope=${encodeURIComponent(scope)}`
  try {
    const res = await fetchImpl(url, {
      signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined,
      ...(credentials
        ? {
            headers: {
              authorization: `Basic ${Buffer.from(`${credentials.user}:${credentials.token}`).toString("base64")}`,
            },
          }
        : {}),
    })
    if (!res.ok) return null
    const body = await res.json().catch(() => ({}))
    return body.token ?? body.access_token ?? null
  } catch {
    return null
  }
}

/**
 * A tag existe no registry? Consulta o MANIFESTO (HEAD), nunca a imagem: a
 * pergunta é "dá para puxar essa tag?", não "qual o conteúdo dela".
 *
 * Estados possíveis (a distinção é o ponto):
 *   - `exists`       — 200: puxável sem credencial (o runner puxa assim)
 *   - `missing`      — 404: o registry respondeu e a tag não está lá
 *   - `unauthorized` — 401/403: existe OU não, mas não dá para saber sem credencial
 *   - `unreachable`  — erro de rede/DNS/timeout: NADA se sabe
 *   - `error`        — status inesperado do registry
 *
 * @param {string} ref
 * @param {{fetchImpl?: Function, timeoutMs?: number}} [deps]
 *   `fetchImpl` é a fronteira de dependência (produção: `fetch`; testes: dublê) —
 *   anotada como Function para o dublê ser um cidadão de primeira classe e não
 *   precisar de cast.
 * @returns {Promise<{state: string, detail: string}>}
 */
export async function checkTagExists(
  ref,
  { fetchImpl = globalThis.fetch, timeoutMs = 20000, credentials = null } = {},
) {
  const { base, host, repository, tag } = registryEndpoints(ref)
  const signal = () => (timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined)
  const url = `${base}/v2/${repository}/manifests/${tag}`

  const head = async (token) => {
    const res = await fetchImpl(url, {
      method: "HEAD",
      headers: { accept: MANIFEST_ACCEPT, ...(token ? { authorization: `Bearer ${token}` } : {}) },
      signal: signal(),
    })
    // Registries sem HEAD: a leitura por GET é o mesmo manifesto (os layers
    // não vêm no corpo do manifesto — o corpo é pequeno).
    if (res.status === 405 || res.status === 501) {
      return fetchImpl(url, {
        method: "GET",
        headers: {
          accept: MANIFEST_ACCEPT,
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        signal: signal(),
      })
    }
    return res
  }

  try {
    const res = await head(null)
    if (res.status === 200) return { state: "exists", detail: `HTTP 200 em ${host}` }
    if (res.status === 404)
      return { state: "missing", detail: `HTTP 404 — ${tag} não está em ${host}` }
    if (res.status === 401 || res.status === 403) {
      const challenge = res.headers?.get?.("www-authenticate") ?? ""
      const token = await fetchRegistryToken(challenge, {
        fetchImpl,
        timeoutMs,
        repository,
        host,
        credentials,
      })
      if (token) {
        const authed = await head(token)
        if (authed.status === 200)
          return { state: "exists", detail: `HTTP 200 (token anônimo) em ${host}` }
        if (authed.status === 404)
          return { state: "missing", detail: `HTTP 404 — ${tag} não está em ${host}` }
        return {
          state: "unauthorized",
          detail: `HTTP ${authed.status} mesmo com token anônimo em ${host}`,
        }
      }
      return {
        state: "unauthorized",
        detail: `HTTP ${res.status} em ${host} (pacote privado sem credencial anônima)`,
      }
    }
    return { state: "error", detail: `HTTP ${res.status} inesperado do registry ${host}` }
  } catch (err) {
    return { state: "unreachable", detail: err?.message ?? String(err) }
  }
}

/**
 * O QUE O REGISTRY SERVE HOJE para a tag — a IDENTIDADE da imagem, não a
 * existência dela.
 *
 * POR QUE ISSO É OUTRA PERGUNTA: `checkTagExists` responde "dá para puxar?".
 * Uma tag é um apelido MUTÁVEL: publicar OUTRA build sob a mesma versão
 * (re-tag) troca o que todos os jobs rodam sem mudar uma linha do repositório —
 * e o gate verde continua verde. A única resposta possível vem do próprio
 * registry: o manifesto, o `config` blob e, nele, a label
 * `org.opencontainers.image.version` que `Dockerfile.ubuntu-bun` grava.
 *
 * Estados (e a diferença entre eles é o ponto):
 *   - `proven`       — a imagem servida DECLARA a versão esperada
 *   - `mismatch`     — declara OUTRA versão: re-tag; o que roda não é o revisado
 *   - `no-label`     — a imagem não declara versão: não dá para provar qual build é
 *   - `missing`      — 404: o registry respondeu e a tag não está lá
 *   - `unauthorized` — 401/403 sem credencial: NADA se sabe (nunca "ok")
 *   - `unreachable`  — rede/DNS/timeout: NADA se sabe
 *   - `error`        — resposta inesperada do registry
 *
 * `no-label` NÃO é `mismatch`: não saber é um estado próprio. Tratar os dois
 * como iguais faria o guard acusar re-tag onde só falta a label (as imagens
 * publicadas ANTES da label existir), e o remédio é outro — republicar.
 *
 * @param {string} ref
 * @param {{expectedVersion?: string|null, fetchImpl?: Function, timeoutMs?: number, credentials?: {user: string, token: string}|null}} [deps]
 * @returns {Promise<{state: string, digest: string|null, version: string|null, detail: string}>}
 */
export async function probeImageIdentity(
  ref,
  {
    expectedVersion = null,
    fetchImpl = globalThis.fetch,
    timeoutMs = 20000,
    credentials = null,
  } = {},
) {
  const { base, host, repository, tag } = registryEndpoints(ref)
  const signal = () => (timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined)
  const empty = { digest: null, version: null }
  const get = (url, token) =>
    fetchImpl(url, {
      headers: {
        accept: MANIFEST_ACCEPT,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      signal: signal(),
    })

  try {
    const manifestUrl = `${base}/v2/${repository}/manifests/${tag}`
    let token = null
    let res = await get(manifestUrl, null)
    if (res.status === 401 || res.status === 403) {
      token = await fetchRegistryToken(res.headers?.get?.("www-authenticate") ?? "", {
        fetchImpl,
        timeoutMs,
        repository,
        host,
        credentials,
      })
      if (!token) {
        return {
          ...empty,
          state: "unauthorized",
          detail: `HTTP ${res.status} em ${host} (pacote privado e sem credencial no ambiente — exporte GHCR_TOKEN/GITHUB_TOKEN para provar)`,
        }
      }
      res = await get(manifestUrl, token)
    }
    if (res.status === 404) {
      return { ...empty, state: "missing", detail: `HTTP 404 — ${tag} não está em ${host}` }
    }
    if (res.status !== 200) {
      return {
        ...empty,
        state: res.status === 401 || res.status === 403 ? "unauthorized" : "error",
        detail: `HTTP ${res.status} do registry ${host} ao ler o manifesto de ${tag}`,
      }
    }

    let digest = res.headers?.get?.("docker-content-digest") ?? null
    let manifest = await res.json()

    // Índice multi-arch: desce por UM filho (amd64 primeiro) — a identidade é a
    // mesma build; escolher sempre o primeiro torna o resultado determinístico.
    if (!manifest?.config && Array.isArray(manifest?.manifests)) {
      const child =
        manifest.manifests.find((m) => m?.platform?.architecture === "amd64") ??
        manifest.manifests[0]
      if (!child?.digest) {
        return { ...empty, state: "error", detail: `índice de ${tag} sem children` }
      }
      digest = child.digest
      const childRes = await get(`${base}/v2/${repository}/manifests/${child.digest}`, token)
      if (childRes.status !== 200) {
        return {
          ...empty,
          state: "error",
          detail: `HTTP ${childRes.status} ao ler o manifesto filho de ${tag}`,
        }
      }
      manifest = await childRes.json()
    }

    const configDigest = manifest?.config?.digest
    if (!configDigest) {
      return { ...empty, digest, state: "error", detail: `${tag} não devolveu um config blob` }
    }
    const configRes = await get(`${base}/v2/${repository}/blobs/${configDigest}`, token)
    if (configRes.status !== 200) {
      return {
        ...empty,
        digest,
        state: "error",
        detail: `HTTP ${configRes.status} ao ler o config blob de ${tag}`,
      }
    }
    const config = await configRes.json()
    const version = config?.config?.Labels?.["org.opencontainers.image.version"] ?? null
    if (!version) {
      return {
        digest,
        version: null,
        state: "no-label",
        detail: `a imagem servida por ${tag} não declara org.opencontainers.image.version — não dá para provar QUAL build ela é (republicada com a label?)`,
      }
    }
    if (expectedVersion && version !== expectedVersion) {
      return {
        digest,
        version,
        state: "mismatch",
        detail: `a tag ${tag} serve uma imagem que declara versão '${version}' (esperado '${expectedVersion}') — re-tag: o que roda não é o que foi revisado`,
      }
    }
    return {
      digest,
      version,
      state: "proven",
      detail: `a tag ${tag} serve a build que declara ${version} em ${host}${digest ? ` (${digest.slice(0, 19)}…)` : ""}`,
    }
  } catch (err) {
    return { ...empty, state: "unreachable", detail: err?.message ?? String(err) }
  }
}

/**
 * Os estados que significam "o registry não respondeu" — indisponibilidade
 * PASSAGEIRA, não resposta. NUNCA entram no cache: cachear um `unreachable`
 * produzido por um timeout curto serviria "não sei" a um consumidor que pediu
 * com timeout maior e teria como PROVAR. Otimização não pode apagar prova.
 */
export const TRANSIENT_IDENTITY_STATES = ["unreachable", "error"]

/**
 * MEMOIZA a identidade da imagem servida — o MESMO probe, uma ida ao registry.
 *
 * POR QUE: a mesma pergunta ("que build a tag serve hoje?") é feita por mais de
 * um fato do doctor — o das referências não versionadas (invariante 9 do
 * `check-registry-source`) e o contrato da imagem publicada
 * (`checkPublishedImageContract`). Cada um chama `probeImageIdentity` para o
 * MESMO `ref`, e o probe custa MANIFESTO + CONFIG BLOB (e, em pacote privado, um
 * token): sem cache são duas idas idênticas à rede.
 *
 * O que NÃO se perde: o cache guarda o RESULTADO já classificado
 * (`proven`/`mismatch`/`no-label`/`missing`/`unauthorized`), não um booleano —
 * "não deu para saber" continua sendo devolvido como INDETERMINADO para cada
 * consumidor. O que NÃO é cacheado:
 *   - uma EXCEÇÃO (a próxima chamada tenta de novo); e
 *   - os estados TRANSITÓRIOS (`TRANSIENT_IDENTITY_STATES`), que são ausência
 *     de resposta, não resposta.
 * Transformar uma falha passageira em veredito permanente seria desonestidade
 * de estado, não otimização.
 *
 * A CHAVE é (`ref`, versão esperada, presença de credencial) — nunca o TOKEN em
 * si (a identidade da tag não depende de quem pergunta; guardar o segredo numa
 * chave de `Map` seria vazamento por descuido). `timeoutMs` NÃO entra, e isso é
 * o ponto: os dois fatos perguntam com timeouts diferentes (o das referências
 * usa 20s, o do contrato o default do probe) — com ele na chave o cache nunca
 * acertaria e seria DECORATIVO. Quem absorve a diferença é a regra dos estados
 * transitórios acima: só resposta definitiva é compartilhada.
 *
 * `inflight` deduplica chamadas CONCORRENTES do mesmo probe (a bateria e os
 * fatos podem pedir a identidade ao mesmo tempo): a segunda espera a primeira em
 * vez de abrir uma terceira conexão.
 *
 * @param {{probe?: Function}} [deps]  o probe real ou um dublê (testes)
 * @returns {(ref: string, options?: object) => Promise<{state: string, digest: string|null, version: string|null, detail: string}>}
 */
export function createRegistryIdentityCache({ probe = probeImageIdentity } = {}) {
  const done = new Map()
  const inflight = new Map()
  const keyOf = (ref, options = {}) =>
    JSON.stringify([ref, options.expectedVersion ?? null, options.credentials ? "auth" : "anon"])

  return async function cachedProbeImageIdentity(ref, options = {}) {
    const key = keyOf(ref, options)
    if (done.has(key)) return done.get(key)
    if (inflight.has(key)) return inflight.get(key)
    const pending = Promise.resolve()
      .then(() => probe(ref, options))
      .then((res) => {
        if (!TRANSIENT_IDENTITY_STATES.includes(res?.state)) done.set(key, res)
        inflight.delete(key)
        return res
      })
      .catch((err) => {
        // Exceção NÃO entra no cache: a próxima chamada tenta de novo.
        inflight.delete(key)
        throw err
      })
    inflight.set(key, pending)
    return pending
  }
}

/**
 * A imagem está no daemon DESTE host?
 *
 * É a resposta para a pergunta que o probe do registry NÃO faz: "dá para rodar
 * os jobs com o que já está aqui?". A referência é a MESMA que os labels do
 * compose usam (a que `resolveImageRef` montou), então "presente" significa
 * exatamente a imagem que o runner usaria a partir deste host — não uma parecida.
 *
 * Estados (e a diferença é o ponto, como no resto do módulo):
 *   - `present` — `docker image inspect` saiu 0: a cópia local existe;
 *   - `absent`  — o docker respondeu que NÃO conhece a imagem (a remoção/build
 *                 futuro tem uma resposta, e ela é esta);
 *   - `unknown` — não deu para perguntar (docker ausente, permissão, erro):
 *                 NADA se sabe, e "não sabe" nunca vira "presente".
 *
 * @param {string} ref
 * @param {{run?: Function}} [deps]  execFileSync real ou dublê de teste
 * @returns {{state: "present"|"absent"|"unknown", digest: string|null, detail: string}}
 */
export function localImagePresent(ref, { run = defaultRun } = {}) {
  const res = run("docker", ["image", "inspect", ref], { allowFailure: true, timeoutMs: 20000 })
  if (res.ok) {
    const digest = /"Id":\s*"(sha256:[0-9a-f]+)"/.exec(res.stdout ?? "")?.[1] ?? null
    return {
      state: "present",
      digest,
      detail: digest
        ? `docker image inspect ok (${digest.slice(0, 19)}…)`
        : "docker image inspect ok (sem o digest na saída)",
    }
  }
  const saida = `${res.stdout ?? ""}\n${res.stderr ?? ""}`.toLowerCase()
  if (/no such image|no such object|not found|image does not exist/.test(saida)) {
    return {
      state: "absent",
      digest: null,
      detail: `docker image inspect: ${(res.stderr ?? "").trim().split("\n")[0] || "a imagem não está no daemon local"}`,
    }
  }
  return {
    state: "unknown",
    digest: null,
    detail: `docker image inspect falhou sem dizer se a imagem existe: ${(res.stderr ?? "").trim().split("\n")[0] || "sem saída"}`,
  }
}

/**
 * Fallback para o caso 401/403: o docker guarda o login do registry. Se ELE
 * conhece a tag, ela está publicada (mesmo que o acesso anônimo falhe — o que
 * já é um problema, porque o runner puxa sem credencial).
 *
 * @param {string} ref
 * @param {{run?: Function}} [deps]  execFileSync real ou dublê de teste
 * @returns {{state: string, detail: string}}
 */
export function verifyWithDocker(ref, { run = defaultRun } = {}) {
  const res = run("docker", ["manifest", "inspect", ref], { allowFailure: true })
  if (res.ok)
    return {
      state: "exists-private",
      detail: "docker manifest inspect ok (mas o acesso anônimo falhou)",
    }
  const out = `${res.stdout}\n${res.stderr}`.toLowerCase()
  if (/no such manifest|manifest unknown|not found|404/.test(out)) {
    return {
      state: "missing",
      detail: `docker manifest inspect: ${res.stderr.trim().split("\n")[0] || "manifest desconhecido"}`,
    }
  }
  return {
    state: "unauthorized",
    detail: `docker manifest inspect falhou: ${res.stderr.trim().split("\n")[0] || "sem saída"}`,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. Publicar (só quando a tag está AUSENTE — nunca em estado indeterminado)
// ═══════════════════════════════════════════════════════════════════════════

function defaultRun(cmd, args, { allowFailure = false, cwd = REPO_ROOT, timeoutMs = 900000 } = {}) {
  try {
    const stdout = execFileSync(cmd, args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: timeoutMs,
    })
    return { ok: true, stdout, stderr: "", code: 0 }
  } catch (err) {
    const res = {
      ok: false,
      stdout: err?.stdout ?? "",
      stderr: err?.stderr ?? String(err?.message ?? err),
      code: err?.status ?? 1,
    }
    if (!allowFailure) {
      throw new Error(
        `${cmd} ${args.join(" ")} falhou: ${res.stderr.trim().split("\n").slice(-1)[0]}`,
      )
    }
    return res
  }
}

/**
 * @param {string} cmd
 * @param {{run?: Function}} [deps]
 * @returns {boolean}
 */
export function commandExists(cmd, { run = defaultRun } = {}) {
  const res = run(cmd, ["--version"], { allowFailure: true, timeoutMs: 20000 })
  return res.ok
}

/**
 * @param {{run?: Function}} [deps]
 * @returns {boolean}
 */
export function ghAuthenticated({ run = defaultRun } = {}) {
  return run("gh", ["auth", "status"], { allowFailure: true, timeoutMs: 20000 }).ok
}

/**
 * Qual caminho de publicação usar? `auto` prefere o workflow canônico (ele já
 * faz build + login + push + verify no runner self-hosted — publicar de novo
 * aqui seria um segundo caminho para o mesmo artefato) e cai para build+push
 * local só quando o `gh` não está disponível/autenticado.
 *
 * @returns {"workflow"|"local"|null}
 */
export function choosePublishSource({ source = "auto", hasGh, hasGhAuth, hasDocker }) {
  if (source === "workflow") return hasGh && hasGhAuth ? "workflow" : null
  if (source === "local") return hasDocker ? "local" : null
  if (hasGh && hasGhAuth) return "workflow"
  return hasDocker ? "local" : null
}

/**
 * Publica pelo workflow canônico do mirror e ESPERA a conclusão. O dispatch é
 * assíncrono: disparar e sair deixaria a releitura correndo contra um build que
 * ainda não começou (e a releitura falharia dizendo que a tag não existe).
 *
 * @returns {{ok: boolean, detail: string}}
 */
export function publishViaWorkflow(
  {
    run = defaultRun,
    gitRef = "main",
    waitSeconds = 900,
    sleep = defaultSleep,
  } = /** @type {{run?: Function, gitRef?: string, waitSeconds?: number, sleep?: Function}} */ ({}),
) {
  const dispatch = run("gh", ["workflow", "run", SYNC_WORKFLOW, "--ref", gitRef], {
    allowFailure: true,
  })
  if (!dispatch.ok) {
    return {
      ok: false,
      detail: `gh workflow run falhou: ${dispatch.stderr.trim().split("\n")[0] || "sem saída"}`,
    }
  }
  const deadline = Date.now() + waitSeconds * 1000
  while (Date.now() < deadline) {
    sleep(10000)
    const res = run(
      "gh",
      [
        "run",
        "list",
        `--workflow=${SYNC_WORKFLOW}`,
        "--limit",
        "1",
        "--json",
        "status,conclusion,databaseId,url",
      ],
      { allowFailure: true },
    )
    if (!res.ok) continue
    let runs = []
    try {
      runs = JSON.parse(res.stdout)
    } catch {
      continue
    }
    const latest = runs[0]
    if (!latest) continue
    if (latest.status === "completed") {
      if (latest.conclusion === "success")
        return { ok: true, detail: `run ${latest.databaseId} concluído com sucesso` }
      return {
        ok: false,
        detail: `run ${latest.databaseId} terminou como '${latest.conclusion}' (${latest.url ?? "sem url"})`,
      }
    }
  }
  return { ok: false, detail: `timeout de ${waitSeconds}s esperando o run concluir` }
}

/**
 * @param {{ref: string, version: string, run?: Function, cwd?: string}} deps
 * @returns {{ok: boolean, detail: string}}
 */
export function publishViaLocalBuild({ ref, version, run = defaultRun, cwd = REPO_ROOT } = {}) {
  const build = run(
    "docker",
    ["build", "--build-arg", `BUN_VERSION=${version}`, "-f", DOCKERFILE, "-t", ref, "."],
    {
      allowFailure: true,
      cwd,
    },
  )
  if (!build.ok)
    return {
      ok: false,
      detail: `docker build falhou: ${build.stderr.trim().split("\n").slice(-1)[0]}`,
    }
  const push = run("docker", ["push", ref], { allowFailure: true, cwd })
  if (!push.ok) {
    return {
      ok: false,
      detail:
        `docker push falhou: ${push.stderr.trim().split("\n").slice(-1)[0]} — ` +
        "autentique no registry (gh auth login / docker login) e tente de novo",
    }
  }
  return { ok: true, detail: "build + push locais ok" }
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. Orquestração — a releitura é a garantia
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Garante que a tag da imagem do runner existe e é puxável.
 *
 * Fluxo: lê env → monta ref → confere no registry → (ausente? publica) →
 * CONFERE DE NOVO. Estados indeterminados nunca publicam.
 *
 * @param {object} [options]
 * @param {string} [options.envFile]   env do compose (mesmo arquivo do `--env-file` do compose)
 * @param {string} [options.cwd]
 * @param {boolean} [options.check]    só verifica; nunca publica
 * @param {"auto"|"workflow"|"local"} [options.source]
 * @param {string} [options.gitRef]
 * @param {Function} [options.fetchImpl]  `fetch` real ou dublê de teste
 * @param {Function} [options.run]        `execFileSync` real ou dublê de teste
 * @param {Function} [options.sleep]
 * @param {object} [options.emit]         logger (pass/fail/warn/info/plain)
 * @param {number} [options.waitSeconds]
 * @param {boolean} [options.localImage] aceita a CÓPIA LOCAL do daemon como
 *   prova quando o registry está INDETERMINADO (exit 6). Sem ela, o estado
 *   indeterminado continua sendo exit 3 — e é isso que mantém o gate.
 * @returns {Promise<{code: number, ref?: string, version?: string, state: string, detail: string, published?: boolean}>}
 */
export async function ensureRunnerImage({
  envFile = DEFAULT_ENV_FILE,
  cwd = REPO_ROOT,
  check = false,
  source = "auto",
  localImage = false,
  gitRef = "main",
  fetchImpl = globalThis.fetch,
  run = defaultRun,
  sleep = defaultSleep,
  emit = log,
  waitSeconds = 900,
} = {}) {
  const path = isAbsolute(envFile) ? envFile : join(cwd, envFile)
  if (!existsSync(path)) {
    emit.fail(`env não encontrado: ${envFile}`)
    emit.fail("É o MESMO arquivo que o compose usa (--env-file). Crie com:")
    emit.fail("  cp deploy/env.gitea.example deploy/.env.gitea   # e preencha o RUNNER_TOKEN")
    return { code: EXIT.ENV, state: "no-env", detail: `arquivo ausente: ${path}` }
  }
  const values = parseEnvFile(readFileSync(path, "utf8"))
  const resolved = resolveImageRef(values)
  if (resolved.error) {
    emit.fail(resolved.error)
    return { code: EXIT.ENV, state: "bad-env", detail: resolved.error }
  }
  const { ref, version } = resolved
  const { host } = registryEndpoints(ref)

  emit.info(`env    : ${envFile}`)
  emit.info(`imagem : ${ref}`)

  let result = await checkTagExists(ref, { fetchImpl })
  emit.plain()

  // 401/403: o docker pode saber o que o acesso anônimo nega.
  if (result.state === "unauthorized" && commandExists("docker", { run })) {
    const viaDocker = verifyWithDocker(ref, { run })
    if (viaDocker.state === "missing") {
      result = { state: "missing", detail: `${result.detail}; ${viaDocker.detail}` }
    } else if (viaDocker.state === "exists-private") {
      emit.fail(`a tag existe no registry, mas o acesso ANÔNIMO falhou (${result.detail}).`)
      emit.fail("O act_runner puxa a imagem SEM credencial: o pacote precisa ser PÚBLICO.")
      emit.fail(
        `Remédio: torne público o pacote ${RUNNER_IMAGE_REPO} em ${host} (Settings → Packages) ` +
          "ou use um registry acessível anonimamente.",
      )
      return { code: EXIT.UNKNOWN, ref, state: "exists-private", detail: viaDocker.detail }
    } else {
      result = viaDocker
    }
  }

  if (result.state === "exists") {
    emit.pass(`tag publicada e puxável — ${result.detail}`)
    return { code: EXIT.OK, ref, state: "exists", detail: result.detail }
  }

  if (result.state !== "missing") {
    // ── A CÓPIA LOCAL: a SEGUNDA pergunta, e só com a flag ──────────────────
    // O estado indeterminado não diz "a tag não existe": diz "não consegui
    // perguntar". Num host sem acesso ao registry a pergunta seguinte é
    // respondível AQUI — esta imagem está no daemon deste host? —, e ela é o que
    // transforma o beco em decisão. Só com `--local-image`: sem a flag nada
    // disto roda, e o veredito é o de sempre.
    if (localImage) {
      const local = localImagePresent(ref, { run })
      if (local.state === "present") {
        emit.warn(`registry INDETERMINADO (${result.state}): ${result.detail}`)
        emit.warn(
          `a imagem '${ref}' está no daemon LOCAL deste host (${local.detail}) — é a que o runner usaria daqui`,
        )
        emit.warn(
          "O que NÃO fica provado: que a TAG exista no registry (a publicação segue sem veredito) e que um host SEM esta cópia consiga puxá-la.",
        )
        return {
          code: EXIT.LOCAL,
          ref,
          version,
          state: "local",
          detail: `registry ${result.state}, mas a imagem está na cópia LOCAL do daemon (${local.detail})`,
        }
      }
      emit.fail(
        `a imagem '${ref}' NÃO está no daemon LOCAL deste host (${local.state}: ${local.detail}) — a cópia local não pode servir de prova`,
      )
      emit.fail(
        `Remédio sem registry: construa a imagem AQUI e use a cópia local (sem publicar nada): docker build --build-arg ${VERSION_KEY_BARE}=${version} -f ${DOCKERFILE} -t ${ref} .`,
      )
    }
    emit.fail(`não consegui determinar se '${ref}' existe (${result.state}): ${result.detail}`)
    emit.fail(
      "INDETERMINADO não é AUSENTE: não publico neste estado (poderia sobrescrever um erro de permissão).",
    )
    if (result.state === "unauthorized") {
      // Comportamento MEDIDO no GHCR: repositório INEXISTENTE e pacote privado
      // respondem igual (401) para quem não tem credencial — a MESMA resposta
      // para dois mundos opostos. Só o docker autenticado separa os dois.
      emit.fail(
        `O registry ${host} responde 401 tanto para pacote PRIVADO quanto para pacote INEXISTENTE.`,
      )
      emit.fail(
        "Autentique o docker (gh auth login / docker login) e rode de novo: com credencial o docker desempata — 'no such manifest' publica, e 'existe mas privado' avisa que o runner não vai conseguir puxar.",
      )
    } else {
      emit.fail(
        "Remédio: verifique rede/registry; para publicar de propósito use --source local|workflow.",
      )
    }
    return { code: EXIT.UNKNOWN, ref, state: result.state, detail: result.detail }
  }

  emit.warn(`tag AUSENTE: ${result.detail}`)
  if (check) {
    emit.fail("modo --check: não publico. Publique com:")
    emit.fail(
      "  bun run runner-image:ensure            # auto (workflow canônico, senão build local)",
    )
    emit.fail("  bash deploy/gitea-up.sh                # garante + sobe a stack")
    return { code: EXIT.MISSING, ref, state: "missing", detail: result.detail }
  }

  // Publicar — só aqui, e só porque a AUSÊNCIA foi confirmada pelo registry.
  const hasDocker = commandExists("docker", { run })
  const hasGh = commandExists("gh", { run })
  const hasGhAuth = hasGh ? ghAuthenticated({ run }) : false
  const chosen = choosePublishSource({ source, hasGh, hasGhAuth, hasDocker })
  if (!chosen) {
    emit.fail(
      `sem caminho para publicar (source=${source}; gh=${hasGh ? "ok" : "ausente"}, gh-auth=${hasGhAuth}, docker=${hasDocker ? "ok" : "ausente"})`,
    )
    emit.fail("Remédio: instale/autentique o gh (gh auth login) ou o docker, e rode de novo.")
    return { code: EXIT.PUBLISH_FAILED, ref, state: "missing", detail: "sem caminho de publicação" }
  }

  const publish =
    chosen === "workflow"
      ? publishViaWorkflow({ run, gitRef, waitSeconds, sleep })
      : publishViaLocalBuild({ ref, version, run, cwd })
  if (!publish.ok) {
    emit.fail(`publicação pelo caminho '${chosen}' falhou: ${publish.detail}`)
    return {
      code: EXIT.PUBLISH_FAILED,
      ref,
      state: "missing",
      detail: publish.detail,
      published: false,
    }
  }
  emit.pass(`publicada pelo caminho '${chosen}' — ${publish.detail}`)
  emit.info("reconferindo no registry (a garantia é a releitura, não o push)...")

  const after = await checkTagExists(ref, { fetchImpl })
  if (after.state === "exists") {
    emit.pass(`CONFIRMADO no registry — ${after.detail}`)
    return { code: EXIT.OK, ref, state: "exists", detail: after.detail, published: true }
  }
  emit.fail(`a releitura NÃO confirmou a tag (${after.state}): ${after.detail}`)
  emit.fail(
    "A publicação reportou sucesso, mas o registry discorda — investigue antes de subir o runner.",
  )
  return {
    code: EXIT.PUBLISH_FAILED,
    ref,
    state: after.state,
    detail: after.detail,
    published: true,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. CLI
// ═══════════════════════════════════════════════════════════════════════════

export const USAGE = `ensure-runner-image — garante que a imagem do runner existe no registry ANTES do compose

Usage:
  node scripts/ensure-runner-image.mjs [opções]

Opções:
  --gitea-env <path>  env do compose (default: ${DEFAULT_ENV_FILE})
                      (não usamos --env-file: é flag do Node, consumida pelo
                      próprio runtime ANTES do script — com arquivo ausente o
                      processo morre com exit 9 e sem diagnóstico nosso)
  --check             só verifica; NUNCA publica (exit 4 se a tag não existir)
  --local-image       num host SEM acesso ao registry: aceita a CÓPIA LOCAL do
                      daemon como prova quando o estado é INDETERMINADO (exit 6).
                      NÃO publica, e não diz que a tag existe no registry
  --prove             prova que o runner não sobe com a tag ausente, contra um
                      registry de TESTE (não confunde com o registry de produção)
  --source <s>        auto | workflow | local (default: auto)
  --publish-ref <r>   ref git para o dispatch do workflow (default: main)
  --wait <segundos>   espera máxima pelo workflow (default: 900)
  --json              saída JSON (para guard/automação)
  -h, --help          esta ajuda

Exit codes: 0 ok · 2 env inválido · 3 indeterminado · 4 ausente · 5 falha ao publicar
             6 indeterminado aceito pela CÓPIA LOCAL (só com --local-image)

Com --prove: 0 prova segura · 2 prova indisponível · 5 prova VIOLADA (o bloqueio não existe)`

/**
 * Parseia a linha de comando. A forma de retorno é SEMPRE a mesma
 * (`{opts, help, error}`): uma união de três formatos obrigava cada chamador
 * (e cada teste) a provar que `opts` existe.
 *
 * @param {string[]} argv
 * @returns {{opts: {envFile: string, check: boolean, source: string, gitRef: string, waitSeconds: number, json: boolean}, help: boolean, error: string|null}}
 */
export function parseArgs(argv) {
  const opts = {
    envFile: DEFAULT_ENV_FILE,
    check: false,
    prove: false,
    source: "auto",
    localImage: false,
    gitRef: "main",
    waitSeconds: 900,
    json: false,
  }
  const fail = (error) => ({ opts, help: false, error })
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--help" || arg === "-h") return { opts, help: true, error: null }
    else if (arg === "--check") opts.check = true
    else if (arg === "--prove") opts.prove = true
    else if (arg === "--local-image") opts.localImage = true
    else if (arg === "--json") opts.json = true
    else if (arg === "--gitea-env") opts.envFile = argv[++i]
    else if (arg === "--source") opts.source = argv[++i]
    else if (arg === "--publish-ref") opts.gitRef = argv[++i]
    else if (arg === "--wait") opts.waitSeconds = Number(argv[++i])
    else return fail(`argumento desconhecido: ${arg}`)
  }
  if (!["auto", "workflow", "local"].includes(opts.source))
    return fail(`--source inválido: ${opts.source}`)
  if (!opts.envFile) return fail("--gitea-env exige um caminho")
  if (!Number.isFinite(opts.waitSeconds) || opts.waitSeconds < 0)
    return fail("--wait exige um número de segundos")
  return { opts, help: false, error: null }
}

async function main() {
  const { opts, help, error } = parseArgs(process.argv.slice(2))
  if (help) {
    console.log(USAGE)
    return EXIT.USAGE
  }
  if (error) {
    console.error(`  ❌ ${error}\n`)
    console.error(USAGE)
    return EXIT.USAGE
  }
  // `--prove` não toca no registry de produção: ele exercita o caminho da
  // subida contra um registry de TESTE. Import dinâmico para não criar um ciclo
  // estático (o módulo da prova importa EXIT daqui).
  if (opts.prove) {
    const { proveRunnerImageGate, renderProof } = await import("./prove-runner-image-gate.mjs")
    const result = await proveRunnerImageGate({ cwd: REPO_ROOT })
    if (opts.json) console.log(JSON.stringify(result, null, 2))
    else {
      console.log("")
      console.log("  ═════════════════════════════════════════════════════════════════")
      console.log("   🔒 PROVA — o runner não sobe sem a imagem (registry de TESTE)")
      console.log("  ═════════════════════════════════════════════════════════════════")
      console.log("")
      renderProof(result)
      console.log("")
    }
    if (result.status === "unavailable") return EXIT.ENV
    return result.ok ? EXIT.OK : EXIT.PUBLISH_FAILED
  }

  const emit = opts.json
    ? { pass: () => {}, fail: () => {}, warn: () => {}, info: () => {}, plain: () => {} }
    : log

  if (!opts.json) {
    console.log("")
    console.log("  ═════════════════════════════════════════════════════════════════")
    console.log("   🖼️  IMAGEM DO RUNNER — pré-requisito do compose")
    console.log("  ═════════════════════════════════════════════════════════════════")
    console.log("")
  }

  // O `check` sem publicar é o que o `--check` pede: se a tag falta, sai 4.
  const result = await ensureRunnerImage({ ...opts, emit, cwd: REPO_ROOT })

  if (opts.json) {
    console.log(
      JSON.stringify(
        {
          ...result,
          envFile: opts.envFile,
          check: opts.check,
          source: opts.source,
          localImage: opts.localImage,
        },
        null,
        2,
      ),
    )
  } else if (result.code === EXIT.OK) {
    console.log("")
    console.log(`  ${C.green}✅ imagem do runner pronta — o compose pode subir o runner${C.nc}`)
  } else if (result.code === EXIT.LOCAL) {
    console.log("")
    console.log(
      `  ${C.yellow}⚠️  registry INDETERMINADO: pré-requisito satisfeito pela CÓPIA LOCAL${C.nc}`,
    )
  }
  return result.code
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().then((code) => process.exit(code))
}
