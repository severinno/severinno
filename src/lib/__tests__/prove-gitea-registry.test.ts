// =============================================================================
// prove-gitea-registry.test.ts
//
// Testes do scripts/prove-gitea-registry.mjs — o ensaio que publica as DUAS
// imagens da etapa 1 no registry embutido de um Gitea EFÊMERO e as puxa de volta
// por DIGEST, sem tocar produção e sem depender de um registry local.
//
// O que precisa ser provado (e é o ponto todo):
//   1. os ALVOS são derivados do template comitado — sem dono, tag ou registry
//      declarado o ensaio não inventa valor (fail-closed), e a origem default de
//      cada artefato é a ref DECLARADA, não um literal;
//   2. o OVERRIDE do compose é o mínimo para ser efêmero (nome do container,
//      porta no loopback, volumes próprios) e os três desvios de `environment`
//      são declarados COM o valor de origem — o `ROOT_URL` é o que decide para
//      onde o `docker login` vai, então mudá-lo em silêncio mediria outra coisa;
//   3. o digest do push é lido dos DOIS caminhos (a linha do push e o
//      `RepoDigests` FILTRADO pelo destino) e discordar é violação: o
//      `RepoDigests` é uma lista por repositório, e o índice 0 costuma ser de
//      outro registry (medido: um pull por ele falha);
//   4. o que o REGISTRY serve é medido pela API (`/v2/`): o
//      `Docker-Content-Digest` da tag tem de ser o digest do push, os blobs têm
//      de estar no HEAD e o CONTEÚDO de dois deles é baixado e hasheado — sem
//      isso, "publiquei" seria o que o docker disse, não o que o registry serve;
//   5. o veredito é TRI-ESTADO e a regra do controle negativo é a que sustenta a
//      prova: um controle que PASSA é violação (o pull por digest inexistente
//      teria de falhar), e um único artefato não medido é INDETERMINADO, nunca
//      verde;
//   6. a SEGURANÇA e o resíduo: nome de container ocupado ou a stack da forja
//      RODANDO bloqueiam antes de subir nada, e um volume que não sai entra no
//      relatório — nunca é presumido removido.
//
// SEM docker, SEM Gitea e SEM rede: `run` e `fetchImpl` são injetados. O único
// teste que toca o repositório real lê o compose da forja e o template do env.
// =============================================================================

import { readFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import {
  ARTIFACTS,
  BLOB_HASH_CAP_BYTES,
  DEFAULT_TIMEOUT_S,
  MANIFEST_ACCEPT,
  PROJECT_PREFIX,
  REPO_ROOT,
  USAGE,
  artifactEvidence,
  blockerDoEnsaio,
  digestForRepo,
  envSemDeclaracaoDoRegistry,
  fabricatedDigest,
  parseArgs,
  parsePushDigest,
  platformManifestOf,
  pushArtifact,
  registryBlobHash,
  registryDeclaration,
  registryDeviations,
  registryManifest,
  registryTargets,
  registryToken,
  removeVolumes,
  renderRegistryOverride,
  summarizePublish,
  verifyBlobs,
} from "../../../scripts/prove-gitea-registry.mjs"

const COMPOSE_TEXT = readFileSync(join(REPO_ROOT, "deploy/docker-compose.gitea.yml"), "utf8")
const ENV_TEXT = readFileSync(join(REPO_ROOT, "deploy/env.gitea.example"), "utf8")

/** Os valores do template, lidos como o ensaio lê (não cravados no teste). */
function envValues(text = ENV_TEXT) {
  const out: Record<string, string> = {}
  for (const line of text.split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) out[m[1]] = m[2].trim()
  }
  return out
}

/** Um `run` dublê que responde por prefixo de comando (e registra as chamadas). */
function fakeRun(responses: Record<string, { status?: number; stdout?: string; stderr?: string }>) {
  const calls: string[][] = []
  const run = (command: string, args: string[]) => {
    calls.push([command, ...args])
    const key = [command, ...args].join(" ")
    const found = Object.entries(responses).find(([pattern]) => key.startsWith(pattern))
    const res = found?.[1] ?? { status: 1, stdout: "", stderr: "sem resposta" }
    return {
      status: res.status ?? 0,
      stdout: res.stdout ?? "",
      stderr: res.stderr ?? "",
      error: null,
    }
  }
  return { run, calls }
}

/** Uma resposta HTTP de mentira, no shape que o `fetchWithTimeout` consome. */
function httpResponse({
  status = 200,
  headers = {},
  body = "",
}: {
  status?: number
  headers?: Record<string, string | number>
  body?: string | Buffer
}) {
  const map = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)]))
  return {
    status,
    headers: { get: (name: string) => map.get(String(name).toLowerCase()) ?? null },
    text: async () => (Buffer.isBuffer(body) ? body.toString("utf8") : String(body)),
    arrayBuffer: async () => {
      const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body))
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    },
  }
}

/** Um `fetch` dublê que responde por substring da URL (e registra as URLs). */
function fakeFetch(routes: Array<{ match: string; method?: string; response: unknown }>) {
  const urls: string[] = []
  const fetchImpl = async (url: string, init: { method?: string } = {}) => {
    const method = init.method ?? "GET"
    urls.push(`${method} ${url}`)
    const hit = routes.find((r) => url.includes(r.match) && (!r.method || method === r.method))
    if (!hit) return httpResponse({ status: 404, body: "not found" })
    return typeof hit.response === "function" ? hit.response() : hit.response
  }
  return { fetchImpl, urls }
}

const sha256 = (text: string | Buffer) =>
  `sha256:${createHash("sha256").update(text).digest("hex")}`

// ── 1. os alvos: derivados do template, fail-closed ────────────────────────

describe("os alvos do ensaio saem do template comitado", () => {
  it("o template da forja declara dono, tag e registry (o ensaio não inventa nenhum)", () => {
    const values = envValues()
    for (const key of ["IMAGE_REGISTRY", "IMAGE_NAMESPACE", "BUN_VERSION"])
      expect(values[key], `${key} ausente do template`).toBeTruthy()
  })

  it("monta um alvo por artefato: destino no Gitea efêmero e origem DECLARADA", () => {
    const values = envValues()
    const out = registryTargets({ values, port: 5188 })
    expect(out.ok).toBe(true)
    expect(out.host).toBe("127.0.0.1:5188")
    const artifacts = out.artifacts ?? []
    expect(artifacts).toHaveLength(ARTIFACTS.length)
    for (const artifact of artifacts) {
      expect(artifact.repoRef).toBe(`127.0.0.1:5188/${values.IMAGE_NAMESPACE}/${artifact.name}`)
      expect(artifact.destRef).toBe(`${artifact.repoRef}:${values.BUN_VERSION}`)
      // A origem default NÃO é um literal: é o registry declarado no template.
      expect(artifact.declaredSource).toBe(
        `${values.IMAGE_REGISTRY}/${values.IMAGE_NAMESPACE}/${artifact.name}:${values.BUN_VERSION}`,
      )
    }
  })

  it("fail-closed: sem IMAGE_NAMESPACE (ou registry/tag) ele diz o que falta, sem alvo nenhum", () => {
    const values = envValues()
    delete (values as Record<string, string>).IMAGE_NAMESPACE
    const out = registryTargets({ values, port: 5188 })
    expect(out.ok).toBe(false)
    expect(out.detail).toContain("IMAGE_NAMESPACE")
    expect(out.artifacts).toBeUndefined()
  })

  it("a ordem dos artefatos é a do documento (runner primeiro, mirror depois)", () => {
    expect(ARTIFACTS.map((a) => a.name)).toEqual(["ubuntu-bun", "bun"])
    expect(ARTIFACTS.map((a) => a.evidence)).toEqual(["run", "extract"])
  })
})

// ── 2. o override efêmero e os desvios declarados ──────────────────────────

describe("o override é o mínimo para ser efêmero", () => {
  const override = renderRegistryOverride({
    project: "prova-x",
    port: 5188,
    volumeKeys: ["gitea_data", "gitea_config"],
    giteaContainerName: "prova-x-gitea",
  })

  it("prende o container ao loopback e dá volumes próprios (nada de produção)", () => {
    expect(override).toContain("container_name: prova-x-gitea")
    expect(override).toContain("127.0.0.1:5188:3000")
    expect(override).toContain("name: prova-x-gitea_data")
    expect(override).toContain("name: prova-x-gitea_config")
    // Nenhuma porta em 0.0.0.0: o ensaio não expõe o Gitea efêmero ao host.
    expect(override).not.toMatch(/^\s*-\s*'?5188:3000/m)
  })

  it("declara as duas chaves de environment que a prova exige diferentes", () => {
    const deviations = registryDeviations({
      baseEnv: {},
      host: "127.0.0.1:5188",
    }).map((d) => d.key)
    for (const key of deviations) expect(override).toContain(`${key}:`)
    expect(deviations).toEqual(["GITEA__server__ROOT_URL", "GITEA__server__DOMAIN"])
    // E o REGISTRY não entra: ele deixou de ser desvio. A stack o DECLARA, e o
    // ensaio mede o render nos dois caminhos — sobrepor o valor aqui faria a
    // prova passar por cima da declaração, que é justamente o que ela mede.
    expect(override).not.toContain("GITEA__registry__ENABLED")
  })

  it("cada desvio traz valor de ORIGEM, destino e motivo escrito", () => {
    const base = { GITEA__server__ROOT_URL: "https://git.severinno.cloud/" }
    const deviations = registryDeviations({ baseEnv: base, host: "127.0.0.1:5188" })
    const rootUrl = deviations.find((d) => d.key === "GITEA__server__ROOT_URL")!
    expect(rootUrl.from).toBe("https://git.severinno.cloud/")
    expect(rootUrl.to).toBe("http://127.0.0.1:5188/")
    expect(rootUrl.why).toMatch(/realm|login/)
    for (const d of deviations) {
      expect(d.why.length).toBeGreaterThan(20)
      expect(d.to).toBeTruthy()
    }
  })

  it("o compose da forja tem o serviço do Gitea com volumes próprios", () => {
    expect(COMPOSE_TEXT).toMatch(/^\s+gitea:/m)
    expect(COMPOSE_TEXT).toMatch(/volumes:/)
  })

  it("o compose DECLARA o registry embutido consumindo o valor do template (o par por valor)", () => {
    // O achado que este ensaio trouxe (o registry dependia do default da série)
    // está FECHADO: a linha do compose consome a variável com o MESMO valor que
    // o template declara — é o par que o `check:registry-source` compara por
    // valor (`checkComposeValueDefaults`), e é o que faz o caminho do DEFAULT
    // (host com o env mais velho que o template) subir o registry LIGADO.
    const linha = COMPOSE_TEXT.split(/\r?\n/).find((l) => l.includes("GITEA__registry__ENABLED"))
    expect(linha).toBeDefined()
    expect(linha).toMatch(/\$\{GITEA__registry__ENABLED:-true\}/)
    expect(ENV_TEXT).toContain("GITEA__registry__ENABLED=true")
  })
})

// ── 2b. a DECLARAÇÃO do registry: quatro recusas e o caminho verde ────────

describe("registryDeclaration — a stack declara o registry, e o render prova", () => {
  const okArgs = {
    values: { GITEA__registry__ENABLED: "true" },
    renderedDeclarado: { GITEA__registry__ENABLED: "true" },
    renderedPadrao: { GITEA__registry__ENABLED: "true" },
  }

  it("verde: declarado no template e entregue pelo render NOS DOIS caminhos", () => {
    const r = registryDeclaration(okArgs)
    expect(r.ok).toBe(true)
    expect(r.value).toBe("true")
    expect(r.detail).toMatch(/DOIS caminhos/)
  })

  it("RECUSA quando o template não declara (o valor seria o default da série)", () => {
    const r = registryDeclaration({ ...okArgs, values: {} })
    expect(r.ok).toBe(false)
    expect(r.declared).toBeNull()
    expect(r.detail).toMatch(/não DECLARA GITEA__registry__ENABLED/)
    expect(r.detail).toMatch(/deploy\/env\.gitea\.example/)
  })

  it("RECUSA um registry DESLIGADO declarado (a etapa 1 depende dele ligado)", () => {
    const r = registryDeclaration({
      ...okArgs,
      values: { GITEA__registry__ENABLED: "false" },
      renderedDeclarado: { GITEA__registry__ENABLED: "false" },
      renderedPadrao: { GITEA__registry__ENABLED: "false" },
    })
    expect(r.ok).toBe(false)
    expect(r.detail).toMatch(/DESLIGADO|registry DESLIGADO/)
  })

  it("RECUSA quando o render não entrega a variável (literal no compose ignora o env)", () => {
    const r = registryDeclaration({ ...okArgs, renderedDeclarado: {} })
    expect(r.ok).toBe(false)
    expect(r.detail).toMatch(/não entregou GITEA__registry__ENABLED/)
  })

  it("RECUSA quando o DEFAULT do compose diverge do declarado (o host sem a linha)", () => {
    const r = registryDeclaration({
      ...okArgs,
      renderedPadrao: { GITEA__registry__ENABLED: "false" },
    })
    expect(r.ok).toBe(false)
    expect(r.detail).toMatch(/o DEFAULT do compose entrega/)
  })

  it("RECUSA declarando o limite quando o render do caminho default falha", () => {
    const r = registryDeclaration({
      ...okArgs,
      renderedPadrao: null,
      renderPadraoFalhou: "docker compose config falhou: exit 1",
    })
    expect(r.ok).toBe(false)
    expect(r.detail).toMatch(/caminho DEFAULT .* falhou/)
  })

  it("o env SEM a declaração é o mesmo env menos essa linha (e nada mais)", () => {
    const env = [
      "IMAGE_REGISTRY=git.severinno.cloud",
      "GITEA__registry__ENABLED=true",
      "RN=1",
      "",
    ].join("\n")
    const sem = envSemDeclaracaoDoRegistry(env)
    expect(sem).not.toContain("GITEA__registry__ENABLED")
    expect(sem).toContain("IMAGE_REGISTRY=git.severinno.cloud")
    expect(sem).toContain("RN=1")
    // Um `export` ou indentação não driblam a remoção (o caminho default tem de
    // ser de fato o caminho default).
    expect(envSemDeclaracaoDoRegistry("export GITEA__registry__ENABLED=true")).toBe("")
    expect(envSemDeclaracaoDoRegistry("  GITEA__registry__ENABLED = true")).toBe("")
  })
})

// ── 3. o digest do push: os dois caminhos e o filtro pelo destino ──────────

describe("o digest amarra a publicação ao que o registry serve", () => {
  it("lê o digest da linha do push", () => {
    const line =
      "The push refers to repository [127.0.0.1:5/x/y]\n1.3.14: digest: sha256:" +
      "a".repeat(64) +
      " size: 123"
    expect(parsePushDigest(line)).toBe(`sha256:${"a".repeat(64)}`)
    expect(parsePushDigest("sem digest aqui")).toBe(null)
  })

  it("no RepoDigests vale a entrada do DESTINO, não o índice 0", () => {
    const digest = `sha256:${"b".repeat(64)}`
    const repoDigests = [
      "127.0.0.1:5177/prova/bun@sha256:" + "c".repeat(64),
      `127.0.0.1:5/x/y@${digest}`,
    ]
    expect(digestForRepo(repoDigests, "127.0.0.1:5/x/y")).toBe(digest)
    expect(digestForRepo(repoDigests, "127.0.0.1:9/nao/existe")).toBe(null)
  })

  it("push ok quando a linha e o RepoDigests concordam (e o alvo manda)", () => {
    const digest = `sha256:${"d".repeat(64)}`
    const { run } = fakeRun({
      "docker tag": { status: 0 },
      "docker push": { status: 0, stdout: `digest: ${digest} size: 10` },
      "docker inspect": {
        status: 0,
        stdout: `127.0.0.1:5177/outro/x@sha256:${"e".repeat(64)}\n127.0.0.1:5/x/y@${digest}\n`,
      },
    })
    const out = pushArtifact({
      sourceRef: "origem:1",
      target: { destRef: "127.0.0.1:5/x/y:1", repoRef: "127.0.0.1:5/x/y" },
      docker: "docker",
      run,
    })
    expect(out.ok).toBe(true)
    expect(out.digest).toBe(digest)
  })

  it("discordar é VIOLAÇÃO nomeando os dois digests (o registry serviu outro manifest)", () => {
    const pushed = `sha256:${"f".repeat(64)}`
    const inspected = `sha256:${"1".repeat(64)}`
    const { run } = fakeRun({
      "docker tag": { status: 0 },
      "docker push": { status: 0, stdout: `digest: ${pushed}` },
      "docker inspect": { status: 0, stdout: `127.0.0.1:5/x/y@${inspected}` },
    })
    const out = pushArtifact({
      sourceRef: "origem:1",
      target: { destRef: "127.0.0.1:5/x/y:1", repoRef: "127.0.0.1:5/x/y" },
      docker: "docker",
      run,
    })
    expect(out.ok).toBe(false)
    expect(out.detail).toContain(pushed)
    expect(out.detail).toContain(inspected)
  })

  it("sem digest nenhum (nem na linha, nem no RepoDigests do destino) não há push julgado ok", () => {
    const { run } = fakeRun({
      "docker tag": { status: 0 },
      "docker push": { status: 0, stdout: "no digest line" },
      "docker inspect": { status: 0, stdout: "" },
    })
    const out = pushArtifact({
      sourceRef: "origem:1",
      target: { destRef: "127.0.0.1:5/x/y:1", repoRef: "127.0.0.1:5/x/y" },
      docker: "docker",
      run,
    })
    expect(out.ok).toBe(false)
    expect(out.detail).toMatch(/digest nenhum/)
  })

  it("o controle negativo usa um digest FABRICADO (e ele é determinístico)", () => {
    expect(fabricatedDigest("x")).toBe(fabricatedDigest("x"))
    expect(fabricatedDigest("x")).not.toBe(fabricatedDigest("y"))
    expect(fabricatedDigest("x")).toMatch(/^sha256:[0-9a-f]{64}$/)
  })
})

// ── 4. a API do registry: token, manifest, blobs ───────────────────────────

describe("a API do registry embutido é quem responde pelo veredito", () => {
  it("o token saiu por basic auth do dono do pacote (200 com campo token)", async () => {
    const { fetchImpl, urls } = fakeFetch([
      { match: "/v2/token", response: httpResponse({ body: JSON.stringify({ token: "abc" }) }) },
    ])
    const out = await registryToken({
      baseUrl: "http://127.0.0.1:5",
      user: "severinno",
      password: "p",
      scope: "repository:severinno/bun:pull",
      fetchImpl,
    })
    expect(out.ok).toBe(true)
    expect(out.token).toBe("abc")
    expect(urls[0]).toContain("scope=repository%3Aseverinno%2Fbun%3Apull")
  })

  it("token recusado ou resposta ilegível nunca vira token", async () => {
    const denied = fakeFetch([
      { match: "/v2/token", response: httpResponse({ status: 401, body: "unauthorized" }) },
    ])
    const out1 = await registryToken({
      baseUrl: "http://x",
      user: "u",
      password: "p",
      scope: "s",
      fetchImpl: denied.fetchImpl,
    })
    expect(out1.ok).toBe(false)
    expect(out1.token).toBe(null)

    const garbage = fakeFetch([
      { match: "/v2/token", response: httpResponse({ body: "não é json" }) },
    ])
    const out2 = await registryToken({
      baseUrl: "http://x",
      user: "u",
      password: "p",
      scope: "s",
      fetchImpl: garbage.fetchImpl,
    })
    expect(out2.ok).toBe(false)
    expect(out2.detail).toMatch(/JSON/)
  })

  it("o manifest da tag responde pelo header Docker-Content-Digest", async () => {
    const digest = `sha256:${"2".repeat(64)}`
    const { fetchImpl } = fakeFetch([
      {
        match: "/v2/severinno/bun/manifests/1.3.14",
        response: httpResponse({
          headers: {
            "docker-content-digest": digest,
            "content-type": "application/vnd.oci.image.index.v1+json",
          },
          body: JSON.stringify({
            mediaType: "application/vnd.oci.image.index.v1+json",
            manifests: [],
          }),
        }),
      },
    ])
    const out = await registryManifest({
      baseUrl: "http://127.0.0.1:5",
      repository: "severinno/bun",
      reference: "1.3.14",
      token: "t",
      fetchImpl,
    })
    expect(out.ok).toBe(true)
    expect(out.digest).toBe(digest)
    expect(out.mediaType).toContain("oci.image.index")
  })

  it("404 é 'o registry não serve este manifest', dito com o status", async () => {
    const { fetchImpl } = fakeFetch([])
    const out = await registryManifest({
      baseUrl: "http://127.0.0.1:5",
      repository: "severinno/bun",
      reference: "nao-existe",
      token: "t",
      fetchImpl,
    })
    expect(out.ok).toBe(false)
    expect(out.status).toBe(404)
  })

  it("índice com filho linux/amd64: os blobs moram no FILHO (senão a conferência passaria vazia)", async () => {
    const child = `sha256:${"3".repeat(64)}`
    const { fetchImpl, urls } = fakeFetch([
      {
        match: `/v2/severinno/bun/manifests/${child}`,
        response: httpResponse({
          headers: {
            "docker-content-digest": child,
            "content-type": "application/vnd.oci.image.manifest.v1+json",
          },
          body: JSON.stringify({
            config: { digest: `sha256:${"4".repeat(64)}`, size: 10 },
            layers: [],
          }),
        }),
      },
    ])
    const out = await platformManifestOf({
      baseUrl: "http://127.0.0.1:5",
      repository: "severinno/bun",
      manifest: {
        manifests: [{ digest: child, platform: { os: "linux", architecture: "amd64" } }],
      },
      token: "t",
      fetchImpl,
    })
    expect(out.ok).toBe(true)
    expect(out.digest).toBe(child)
    expect(urls[0]).toContain(child)
  })

  it("manifest de imagem (sem índice) passa direto", async () => {
    const manifest = { config: { digest: "sha256:x", size: 1 }, layers: [] }
    const out = await platformManifestOf({
      baseUrl: "http://127.0.0.1:5",
      repository: "severinno/bun",
      manifest,
      token: "t",
      fetchImpl: fakeFetch([]).fetchImpl,
    })
    expect(out.ok).toBe(true)
    expect(out.body).toBe(manifest)
    expect(out.digest).toBe(null)
  })

  it("os blobs estão lá: HEAD de todos e o CONTEÚDO do config hasheado", async () => {
    const config = "conteudo-do-config"
    const layer = "camada"
    const configDigest = sha256(config)
    const layerDigest = sha256(layer)
    const { fetchImpl } = fakeFetch([
      {
        match: `/blobs/${configDigest}`,
        method: "HEAD",
        response: httpResponse({ headers: { "content-length": config.length } }),
      },
      {
        match: `/blobs/${layerDigest}`,
        method: "HEAD",
        response: httpResponse({ headers: { "content-length": layer.length } }),
      },
      { match: `/blobs/${configDigest}`, response: httpResponse({ body: config }) },
      { match: `/blobs/${layerDigest}`, response: httpResponse({ body: layer }) },
    ])
    const out = await verifyBlobs({
      baseUrl: "http://127.0.0.1:5",
      repository: "severinno/bun",
      manifest: {
        config: { digest: configDigest, size: config.length },
        layers: [{ digest: layerDigest, size: layer.length }],
      },
      token: "t",
      timeoutMs: 60_000,
      fetchImpl,
    })
    expect(out.ok).toBe(true)
    expect(out.blobs).toHaveLength(2)
    expect(out.hashed.map((h) => h.kind)).toEqual(["config", "layer"])
    expect(out.totalBytes).toBe(config.length + layer.length)
  })

  it("um blob que não está lá reprova, dizendo qual", async () => {
    const configDigest = sha256("c")
    const missing = `sha256:${"5".repeat(64)}`
    const { fetchImpl } = fakeFetch([
      {
        match: `/blobs/${configDigest}`,
        method: "HEAD",
        response: httpResponse({ headers: { "content-length": 1 } }),
      },
    ])
    const out = await verifyBlobs({
      baseUrl: "http://127.0.0.1:5",
      repository: "severinno/bun",
      manifest: {
        config: { digest: configDigest, size: 1 },
        layers: [{ digest: missing, size: 9 }],
      },
      token: "t",
      timeoutMs: 60_000,
      fetchImpl,
    })
    expect(out.ok).toBe(false)
    expect((out.problems ?? []).join(" ")).toContain(missing)
  })

  it("comprimento que não bate com o manifest é problema (não é 'tem o blob')", async () => {
    const digest = sha256("c")
    const { fetchImpl } = fakeFetch([
      {
        match: `/blobs/${digest}`,
        method: "HEAD",
        response: httpResponse({ headers: { "content-length": 999 } }),
      },
      { match: `/blobs/${digest}`, response: httpResponse({ body: "c" }) },
    ])
    const out = await verifyBlobs({
      baseUrl: "http://127.0.0.1:5",
      repository: "severinno/bun",
      manifest: { config: { digest, size: 1 }, layers: [] },
      token: "t",
      timeoutMs: 60_000,
      fetchImpl,
    })
    expect(out.ok).toBe(false)
    expect((out.problems ?? []).join(" ")).toContain("999")
  })

  it("camada acima do teto declarado não é baixada (o teto é limite dito, não presumido)", async () => {
    const configDigest = sha256("cfg")
    const big = `sha256:${"6".repeat(64)}`
    const { fetchImpl, urls } = fakeFetch([
      {
        match: `/blobs/${configDigest}`,
        method: "HEAD",
        response: httpResponse({ headers: { "content-length": 3 } }),
      },
      { match: `/blobs/${configDigest}`, response: httpResponse({ body: "cfg" }) },
      {
        match: `/blobs/${big}`,
        method: "HEAD",
        response: httpResponse({ headers: { "content-length": BLOB_HASH_CAP_BYTES + 1 } }),
      },
    ])
    const out = await verifyBlobs({
      baseUrl: "http://127.0.0.1:5",
      repository: "severinno/bun",
      manifest: {
        config: { digest: configDigest, size: 3 },
        layers: [{ digest: big, size: BLOB_HASH_CAP_BYTES + 1 }],
      },
      token: "t",
      timeoutMs: 60_000,
      fetchImpl,
    })
    expect(out.ok).toBe(true)
    expect(out.hashed).toHaveLength(1)
    expect(urls.some((u) => u.startsWith("GET") && u.includes(big))).toBe(false)
  })

  it("o hash do blob baixado confere com o digest (e divergir reprova)", async () => {
    const digest = sha256("certo")
    const ok = await registryBlobHash({
      baseUrl: "http://x",
      repository: "r",
      digest,
      token: "t",
      timeoutMs: 20_000,
      fetchImpl: fakeFetch([{ match: "/blobs/", response: httpResponse({ body: "certo" }) }])
        .fetchImpl,
    })
    expect(ok.ok).toBe(true)
    const bad = await registryBlobHash({
      baseUrl: "http://x",
      repository: "r",
      digest,
      token: "t",
      timeoutMs: 20_000,
      fetchImpl: fakeFetch([{ match: "/blobs/", response: httpResponse({ body: "outro" }) }])
        .fetchImpl,
    })
    expect(bad.ok).toBe(false)
    expect(bad.detail).toMatch(/DIVERGE/)
  })

  it("o Accept do manifest cobre índice e manifest (OCI e docker v2)", () => {
    for (const mediaType of [
      "application/vnd.oci.image.index.v1+json",
      "application/vnd.docker.distribution.manifest.list.v2+json",
      "application/vnd.oci.image.manifest.v1+json",
      "application/vnd.docker.distribution.manifest.v2+json",
    ])
      expect(MANIFEST_ACCEPT).toContain(mediaType)
  })
})

// ── 5. o veredito: tri-estado e o controle negativo ────────────────────────

describe("o veredito nunca vira verde sem as duas metades", () => {
  it("controls que RECUSAM o que não existe + artefatos limpos = provado", () => {
    const out = summarizePublish({
      artifacts: [{ key: "ubuntu-bun", wrongs: [], unavailable: null }],
      controls: [{ name: "x/digest-inexistente", ok: true, detail: "falhou" }],
    })
    expect(out.verdict).toBe("proven")
  })

  it("um controle que PASSOU é violação (o pull aceitou o que não existe)", () => {
    const out = summarizePublish({
      artifacts: [{ key: "ubuntu-bun", wrongs: [], unavailable: null }],
      controls: [{ name: "x/tag-nunca-publicada", ok: false, detail: "PASSOU" }],
    })
    expect(out.verdict).toBe("violated")
    expect(out.wrongs.join(" ")).toContain("tag-nunca-publicada")
  })

  it("violação vence indeterminado (o que foi medido errado não é 'não deu para medir')", () => {
    const out = summarizePublish({
      artifacts: [
        { key: "ubuntu-bun", wrongs: ["o digest divergiu"], unavailable: null },
        { key: "bun", wrongs: [], unavailable: "o push não aconteceu" },
      ],
      controls: [],
    })
    expect(out.verdict).toBe("violated")
    expect(out.unavailable.join(" ")).toContain("push não aconteceu")
  })

  it("metade não medida é INDETERMINADO, nunca verde", () => {
    const out = summarizePublish({
      artifacts: [{ key: "bun", wrongs: [], unavailable: "sem token de pull" }],
      controls: [],
    })
    expect(out.verdict).toBe("unavailable")
    expect(out.wrongs).toEqual([])
    expect(out.unavailable.length).toBe(1)
  })
})

// ── 6. segurança, resíduo e argumentos ─────────────────────────────────────

describe("a segurança de produção e o resíduo são fato, não promessa", () => {
  it("container homônimo de projeto alheio bloqueia (o ensaio não adota container)", () => {
    const blocker = blockerDoEnsaio({
      containers: [{ name: "prova-x-gitea", running: true, project: "deploy" }],
      giteaContainerName: "prova-x-gitea",
      ownPrefix: PROJECT_PREFIX,
      prodProject: "deploy",
    })
    expect(blocker).toMatch(/já existe neste host/)
  })

  it("a stack da forja RODANDO bloqueia (o ensaio não divide recurso com a produção)", () => {
    const blocker = blockerDoEnsaio({
      containers: [{ name: "deploy-gitea-1", running: true, project: "deploy" }],
      giteaContainerName: "prova-x-gitea",
      ownPrefix: PROJECT_PREFIX,
      prodProject: "deploy",
    })
    expect(blocker).toMatch(/RODANDO/)
  })

  it("resíduo do PRÓPRIO ensaio e produção parada não bloqueiam", () => {
    expect(
      blockerDoEnsaio({
        containers: [
          { name: `${PROJECT_PREFIX}-abc-gitea`, running: true, project: `${PROJECT_PREFIX}-abc` },
          { name: "deploy-gitea-1", running: false, project: "deploy" },
        ],
        giteaContainerName: "prova-x-gitea",
        ownPrefix: PROJECT_PREFIX,
        prodProject: "deploy",
      }),
    ).toBe(null)
  })

  it("volume que não sai entra no relatório (não é presumido removido)", () => {
    const { run } = fakeRun({
      "docker volume rm": { status: 0, stdout: "x" },
      "docker volume inspect": { status: 0, stdout: "prova-x_gitea_data" },
    })
    expect(removeVolumes({ names: ["prova-x_gitea_data"], run })).toEqual(["prova-x_gitea_data"])

    const gone = fakeRun({
      "docker volume rm": { status: 0, stdout: "x" },
      "docker volume inspect": { status: 1 },
    })
    expect(removeVolumes({ names: ["prova-x_gitea_data"], run: gone.run })).toEqual([])
  })

  it("a evidência do mirror é a EXTRAÇÃO (o scratch não roda: rodá-lo falharia por desenho)", () => {
    const { run } = fakeRun({
      "docker create": { status: 0, stdout: "abc123\n" },
      "docker cp": { status: 0, stdout: "" },
      "docker rm": { status: 0, stdout: "" },
    })
    const out = artifactEvidence({
      spec: ARTIFACTS.find((a) => a.evidence === "extract")!,
      ref: "127.0.0.1:5/x/bun@sha256:z",
      version: "1.3.14",
      docker: "docker",
      timeoutMs: 30_000,
      // O `/bun` EXTRAÍDO é executado como se fosse um binário do host: fora do
      // `docker`, quem responde é o dublê com a versão declarada.
      run: (command: string, args: string[]) =>
        command === "docker"
          ? run(command, args)
          : { status: 0, stdout: "1.3.14\n", stderr: "", error: null },
      tmpDir: "/tmp/prova-x",
    })
    expect(out.ok).toBe(true)
    expect(out.version).toBe("1.3.14")
  })

  it("o artefato puxado com versão diferente do declarado é violação dita", () => {
    const { run } = fakeRun({
      "docker run": { status: 0, stdout: "1.2.0\n" },
      "docker inspect": { status: 0, stdout: "1.2.0\n" },
    })
    const out = artifactEvidence({
      spec: ARTIFACTS.find((a) => a.evidence === "run")!,
      ref: "127.0.0.1:5/x/ubuntu-bun@sha256:z",
      version: "1.3.14",
      docker: "docker",
      timeoutMs: 30_000,
      run,
      tmpDir: "/tmp/prova-x",
    })
    expect(out.ok).toBe(false)
    expect(out.detail).toContain("1.3.14")
  })
})

describe("a CLI e o contrato de saída", () => {
  it("defaults: ensaio completo, com build do mirror, timeout declarado", () => {
    const opts = parseArgs([])
    expect(opts).toMatchObject({
      json: false,
      keep: false,
      build: true,
      timeoutS: DEFAULT_TIMEOUT_S,
      error: null,
    })
  })

  it("aceita os artefatos de origem, o --no-build, o --keep e a imagem do Gitea", () => {
    const opts = parseArgs([
      "--json",
      "--keep",
      "--no-build",
      "--ubuntu-bun",
      "ghcr.io/x/y:1",
      "--bun-mirror",
      "ghcr.io/x/z:1",
      "--gitea-image",
      "gitea/gitea:1.22",
      "--timeout",
      "60",
    ])
    expect(opts).toMatchObject({
      json: true,
      keep: true,
      build: false,
      ubuntuBun: "ghcr.io/x/y:1",
      bunMirror: "ghcr.io/x/z:1",
      giteaImage: "gitea/gitea:1.22",
      timeoutS: 60,
      error: null,
    })
  })

  it("argumento inválido é erro de USO (exit 3), nunca ensaio mudo", () => {
    expect(parseArgs(["--timeout", "abc"]).error).toMatch(/--timeout/)
    expect(parseArgs(["--nao-existe"]).error).toMatch(/desconhecido/)
    expect(parseArgs(["--ubuntu-bun"]).error).toMatch(/exige um valor/)
  })

  it("a ajuda declara os quatro exit codes e as duas metades do ensaio", () => {
    expect(USAGE).toContain("registry embutido")
    for (const code of ["0 —", "1 —", "2 —", "3 —"]) expect(USAGE).toContain(code)
    expect(USAGE).toContain("--json")
  })
})
