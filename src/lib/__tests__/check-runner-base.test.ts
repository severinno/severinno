// =============================================================================
// check-runner-base.test.ts
//
// Testes do scripts/check-runner-base.mjs — o guard que prova que a BASE da
// imagem do runner está PINADA POR DIGEST e que o contrato da imagem (o plugin
// `compose`, que a invariante 7 do check:registry-source usa para renderizar o
// compose da forja) é FAIL-CLOSED.
//
// O que precisa ser provado sobre o guard (e é o ponto todo):
//   1. `catthehacker/ubuntu:act-latest` é uma tag FLUTUANTE: sem digest, o
//      rebuild da base troca a imagem — e o plugin — sem nenhuma linha do
//      repositório mudar. O guard REPROVA o FROM sem digest;
//   2. o digest fixado é comparado com o que a TAG SERVE hoje (índice ou filho
//      da plataforma) e um pin velho/de outra imagem é violação, não aviso;
//   3. as MUTAÇÕES do pin são todas detectadas — e a mutação que NÃO muda o
//      arquivo é FALHA (prova vácua), não sucesso;
//   4. a troca do ref acontece na INSTRUÇÃO `FROM`, nunca no primeiro texto
//      igual do arquivo: o cabeçalho MENCIONA a mesma tag, e mutar o comentário
//      deixaria o `FROM` intacto — o guard provaria nada contra nada;
//   5. o bloco do contrato é provado por EXECUÇÃO, com bases dubladas: a base
//      com o plugin passa, a SEM o plugin falha nomeando a consequência, e a
//      sem o CLI falha no primeiro ramo — com o PATH do sandbox CONTENDO SÓ os
//      dublês (senão o `docker` do host responderia no lugar da base);
//   6. "não consegui olhar o registry" NUNCA vira "conforme": é `unknown` (exit
//      3) quando a prova é exigida, e o relatório DECLARA que não conferiu.
//
// SEM rede e SEM docker: o `fetch` é dublado por tabela de rotas e o sandbox
// usa dublês de `docker`/`bun` no PATH. O único processo externo é o `bash` que
// executa o bloco REAL do Dockerfile (é a prova; dublá-la seria não provar).
// =============================================================================

import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import {
  BUN_PATH,
  DIGEST_RE,
  DOCKERFILE,
  EXIT,
  HUB_API,
  SANDBOX_MODES,
  checkRunnerBase,
  contractBlock,
  contractShape,
  dockerStub,
  evaluate,
  exitCodeFor,
  instructions,
  parseArgs,
  parseImageRef,
  pinMutations,
  proveContract,
  provePinMutations,
  readBase,
  renderReport,
  replaceBaseRef,
  resolveTagDigests,
  runContractBlock,
  writePin,
} from "../../../scripts/check-runner-base.mjs"

// ── fixtures ────────────────────────────────────────────────────────────────

/** O Dockerfile REAL do repositório — é ele que o guard lê em produção. */
const REAL = readFileSync(join(process.cwd(), DOCKERFILE), "utf8")

/** O digest que o repositório fixa hoje (extraído, não cravado). */
const PINNED = readBase(REAL).froms[0].parsed.digest as string

/** Outro digest, de forma válida: é o que trocar por outra imagem produz. */
const FOREIGN = `sha256:${"0".repeat(64)}`

/** O índice que a tag serve nos testes em que a rede é dublada. */
const SERVED_INDEX = PINNED

/** O filho linux/amd64 de um índice — o outro lado do aceite do pin. */
const SERVED_CHILD = `sha256:${"1".repeat(64)}`

/** A linha (1-based) do `FROM` no Dockerfile real. */
const FROM_LINE = readBase(REAL).froms[0].line as number

// ── dublês ──────────────────────────────────────────────────────────────────

type Route = { status: number; headers?: Record<string, string>; body?: unknown }

/**
 * `fetch` dublado por TABELA DE ROTAS, não por ordem: cada teste declara só o
 * que a resposta daquela URL é, e uma URL não dublada falha alto (em vez de
 * devolver algo plausível que faria o teste passar por engano).
 */
function fakeFetch(routes: Record<string, Route>) {
  const calls: string[] = []
  const fetchImpl = async (url: string) => {
    calls.push(url)
    const route = routes[url]
    if (!route) throw new Error(`rota não dublada: ${url}`)
    return {
      status: route.status,
      ok: route.status >= 200 && route.status < 300,
      headers: {
        get: (name: string) => route.headers?.[name.toLowerCase()] ?? null,
      },
      json: async () => route.body ?? {},
    }
  }
  return { fetchImpl, calls }
}

const MANIFEST_URL = `https://${HUB_API}/v2/catthehacker/ubuntu/manifests/act-latest`

/** A resposta do registry para a tag: um ÍNDICE com o filho linux/amd64. */
function indexRoute(overrides: Partial<Route> = {}): Record<string, Route> {
  return {
    [MANIFEST_URL]: {
      status: 200,
      headers: {
        "docker-content-digest": SERVED_INDEX,
        "content-type": "application/vnd.oci.image.index.v1+json",
      },
      body: {
        manifests: [
          { digest: `sha256:${"9".repeat(64)}`, platform: { os: "linux", architecture: "arm64" } },
          { digest: SERVED_CHILD, platform: { os: "linux", architecture: "amd64" } },
        ],
      },
      ...overrides,
    },
  }
}

/** As linhas que MUDARAM entre dois textos — a régua do "onde a troca bateu". */
function changedLines(a: string, b: string): number[] {
  const left = a.split("\n")
  const right = b.split("\n")
  const out: number[] = []
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    if (left[i] !== right[i]) out.push(i + 1)
  }
  return out
}

const cli = (args: string[], env: Record<string, string> = {}) =>
  spawnSync("node", ["scripts/check-runner-base.mjs", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, PATH: process.env.PATH ?? "", ...env },
  })

// ── 1. leitura do ref: o Docker Hub não tem host no nome ───────────────────

describe("parseImageRef — o ref do FROM", () => {
  it("sem host, o nome oficial mora sob library/ e a API é registry-1.docker.io", () => {
    const parsed = parseImageRef("ubuntu:24.04")
    expect(parsed).toMatchObject({
      ok: true,
      host: "docker.io",
      apiHost: HUB_API,
      repository: "library/ubuntu",
      registryId: `docker.io/library/ubuntu`,
      tag: "24.04",
      digest: null,
    })
  })

  it("com namespace, o caminho é o namespace e a API continua a do Hub", () => {
    const parsed = parseImageRef("catthehacker/ubuntu:act-latest")
    expect(parsed.repository).toBe("catthehacker/ubuntu")
    expect(parsed.apiHost).toBe(HUB_API)
    expect(parsed.registryId).toBe("docker.io/catthehacker/ubuntu")
  })

  it("separara TAG e DIGEST: `nome:tag@sha256:…` tem os dois", () => {
    const parsed = parseImageRef(`catthehacker/ubuntu:act-latest@${FOREIGN}`)
    expect(parsed.tag).toBe("act-latest")
    expect(parsed.digest).toBe(FOREIGN)
    expect(parsed.name).toBe("catthehacker/ubuntu")
  })

  it("um host explícito (registry próprio) não é confundido com namespace", () => {
    const parsed = parseImageRef("git.severinno.cloud/ns/img:1.2.3")
    expect(parsed).toMatchObject({
      host: "git.severinno.cloud",
      apiHost: "git.severinno.cloud",
      repository: "ns/img",
    })
  })

  it("uma tag com dígitos no nome:porta não vira tag (o ':' depois da última '/')", () => {
    expect(parseImageRef("localhost:5000/img")?.tag).toBeNull()
  })

  it("ref vazio ou sem nome é ilegível", () => {
    expect(parseImageRef("  ").ok).toBe(false)
    expect(parseImageRef(":tag").ok).toBe(false)
  })
})

// ── 2. instruções: a unidade que o docker executa (continuação de linha) ────

describe("instructions / readBase", () => {
  it("une as continuações de linha e ignora comentários", () => {
    const text = ["# FROM comentado/x:1", "FROM a/b:1 \\", "  AS base", "RUN echo oi"].join("\n")
    const list = instructions(text)
    expect(list.map((i) => i.kind)).toEqual(["FROM", "RUN"])
    expect(list[0].body).toBe("FROM a/b:1 \\\n  AS base")
    // `FROM ... AS base` continua sendo um ref legível (o alias não é o nome).
    expect(readBase(text).froms[0].parsed.name).toBe("a/b")
  })

  it("o Dockerfile real tem UM FROM, pinado por digest canônico", () => {
    const base = readBase(REAL)
    expect(base.ok).toBe(true)
    expect(base.froms).toHaveLength(1)
    expect(base.froms[0].parsed.tag).toBe("act-latest")
    expect(DIGEST_RE.test(base.froms[0].parsed.digest as string)).toBe(true)
  })

  it("arquivo sem FROM é ilegível (o pin é sobre o FROM)", () => {
    const base = readBase("RUN echo oi\n")
    expect(base.ok).toBe(false)
    expect(base.detail).toContain("nenhum FROM")
  })
})

// ── 3. a troca do ref: na INSTRUÇÃO, nunca no primeiro texto igual ─────────

describe("replaceBaseRef — a troca bate na instrução, não no comentário", () => {
  it("troca o ref do FROM e SÓ ele, mesmo com a tag citada no cabeçalho", () => {
    // O cabeçalho do Dockerfile MENCIONA `catthehacker/ubuntu:act-latest`. Um
    // `String.replace` textual mutaria o COMENTÁRIO e deixaria o FROM intacto.
    const header =
      REAL.split("\n").findIndex((l) => l.includes("catthehacker/ubuntu:act-latest")) + 1
    expect(header).toBeGreaterThan(0)
    expect(header).not.toBe(FROM_LINE)

    const mutated = replaceBaseRef(REAL, `catthehacker/ubuntu:act-latest@${FOREIGN}`)
    const from = readBase(mutated).froms[0].parsed
    expect(from.digest).toBe(FOREIGN)
    expect(changedLines(REAL, mutated)).toEqual([FROM_LINE])
    // e o cabeçalho continua dizendo de onde o digest veio
    expect(mutated.split("\n")[header - 1]).toBe(REAL.split("\n")[header - 1])
  })

  it("sem FROM, devolve o texto sem tocar (não inventa um ref)", () => {
    expect(replaceBaseRef("RUN echo oi\n", "x/y:1")).toBe("RUN echo oi\n")
  })
})

// ── 4. a forma do contrato: fail-closed conferido no TEXTO ─────────────────

describe("contractShape — o contrato é fail-closed?", () => {
  it("o bloco real do Dockerfile satisfaz a forma", () => {
    const shape = contractShape(REAL)
    expect(shape.violations).toEqual([])
    expect(shape.ok).toBe(true)
    expect(contractBlock(REAL).block).toContain("docker compose version")
    expect(contractBlock(REAL).block).toContain(BUN_PATH)
  })

  it("sem `set -euo pipefail`, um `docker compose version` que falha NÃO aborta", () => {
    // A troca MANTÉM a continuação de linha (`\`): apagar a linha inteira
    // desmontaria a instrução e o guard acusaria outra coisa (bloco ausente).
    const shape = contractShape(REAL.replace("set -euo pipefail; \\", "true; \\"))
    expect(shape.ok).toBe(false)
    expect(shape.violations.join(" ")).toContain("set -euo pipefail")
  })

  it("menos de dois `exit 1` = um dos dois ramos deixou de FALHAR o build", () => {
    // Âncora de DUAS linhas de propósito: o bloco de build do Bun também tem um
    // `exit 1`, e uma âncora de uma linha só mutaria o bloco errado.
    const shape = contractShape(REAL.replace("exit 1; \\\n    fi; \\", "true; \\\n    fi; \\"))
    expect(shape.ok).toBe(false)
    expect(shape.violations.join(" ")).toContain("exit 1")
  })

  it("a falha tem de NOMEAR a consequência (a invariante 7 INDETERMINADA)", () => {
    const shape = contractShape(REAL.replace("INDETERMINADA dentro do runner da forja", "algo"))
    expect(shape.ok).toBe(false)
    expect(shape.violations.join(" ")).toContain("não NOMEIA a consequência")
  })

  it("a asserção do CAMINHO do bun é parte do contrato", () => {
    const shape = contractShape(
      REAL.replace('test "$(command -v bun)" = "/usr/local/bin/bun"; \\', ""),
    )
    expect(shape.ok).toBe(false)
    expect(shape.violations.join(" ")).toContain(BUN_PATH)
  })

  it("bloco ausente (a asserção foi removida do arquivo) é violação", () => {
    // O bloco é achado por ÂNCORA (a asserção do plugin) e a âncora é a
    // CHAMADA: trocar `docker compose version` por outra coisa no `RUN` deixa o
    // guard sem sujeito — e ele acusa, em vez de passar a conferir o nada.
    const shape = contractShape(
      REAL.replace(
        "if ! docker compose version >/dev/null 2>&1; then",
        "if ! docker info >/dev/null 2>&1; then",
      ).replace("plugin compose ($(docker compose version))", "plugin compose"),
    )
    expect(shape.ok).toBe(false)
    expect(shape.violations.join(" ")).toContain("nenhum RUN confere")
    expect(contractShape("FROM a/b:1\nRUN echo oi\n").ok).toBe(false)
  })
})

// ── 5. a prova por EXECUÇÃO: o bloco real contra bases dubladas ────────────

describe("runContractBlock / proveContract — a troca do digest quebra o contrato", () => {
  it("a base COM o plugin passa (o controle: o caminho verde existe)", () => {
    const res = runContractBlock({ block: contractBlock(REAL).block as string, mode: "plugin" })
    expect(res.code).toBe(0)
    expect(res.output).toContain("Contrato da imagem ok")
  })

  it("a base SEM o plugin FALHA nomeando a consequência (o plugin ausente)", () => {
    const res = runContractBlock({ block: contractBlock(REAL).block as string, mode: "no-plugin" })
    expect(res.code).not.toBe(0)
    expect(res.output).toContain("PLUGIN 'compose' não está na imagem")
  })

  it("sem o CLI `docker`, falha no primeiro ramo — e o docker DO HOST não responde", () => {
    // Este caso só é honesto porque o PATH do sandbox tem SÓ o diretório dos
    // dublês: com o PATH do host, o `docker` de verdade seria encontrado e este
    // ramo sairia 0 (verde por engano — foi o que aconteceu na primeira versão).
    const res = runContractBlock({ block: contractBlock(REAL).block as string, mode: "no-cli" })
    expect(res.code).not.toBe(0)
    expect(res.output).toContain("o CLI 'docker' não está na imagem")
  })

  it("os três modos são exercitados, cada um pelo motivo certo", () => {
    const proof = proveContract({ text: REAL })
    expect(proof.ok).toBe(true)
    expect(proof.cases.map((c) => [c.id, c.code, c.ok])).toEqual([
      ["plugin", 0, true],
      ["no-plugin", 1, true],
      ["no-cli", 1, true],
    ])
  })

  it("modo desconhecido é erro de programação, não um caso silencioso", () => {
    expect(() => runContractBlock({ block: "true", mode: "outro" })).toThrow(/modo desconhecido/)
    expect(SANDBOX_MODES).toEqual(["plugin", "no-plugin", "no-cli"])
  })

  it("o contrato deu prova sobre o bloco do ARQUIVO (não sobre uma cópia)", () => {
    // Se alguém trocar a âncora do bloco, a prova tem de morrer — não provar
    // outro trecho. Aqui: o bloco deixa de conferir o plugin.
    const proof = proveContract({
      text: REAL.replace(
        "if ! docker compose version >/dev/null 2>&1; then",
        "if ! docker info >/dev/null 2>&1; then",
      ),
    })
    expect(proof.ok).toBe(false)
  })

  it("o dublê do docker responde só o que o contrato usa", () => {
    expect(dockerStub("plugin")).toContain("Docker Compose version")
    expect(dockerStub("no-plugin")).toContain("is not a docker command")
  })
})

// ── 6. as mutações do pin: cada uma tem de FALHAR o guard ──────────────────

describe("pinMutations / provePinMutations — o guard é cego para alguma troca?", () => {
  it("as quatro mutações existem e mudam o FROM (e só ele)", () => {
    const mutations = pinMutations(REAL)
    expect(mutations.map((m) => m.id)).toEqual([
      "sem-digest",
      "digest-malformado",
      "digest-trocado",
      "contrato-afrouxado",
    ])
    for (const mutation of mutations) {
      expect(mutation.text, mutation.id).not.toBe(REAL)
    }
    // A régua: trocar o pin tem de bater NA LINHA DO FROM. Se o cabeçalho (que
    // cita a mesma tag) for o que muda, o `FROM` fica intacto e a mutação prova
    // nada contra nada.
    expect(changedLines(REAL, mutations[0].text)).toEqual([FROM_LINE])
    // A do contrato afrouxa o bloco `RUN`, que vive DEPOIS do FROM.
    expect(changedLines(REAL, mutations[3].text)).not.toContain(FROM_LINE)
    expect(changedLines(REAL, mutations[3].text).length).toBeGreaterThan(0)
  })

  it("cada mutação é REPROVADA pelo guard, com a razão própria", () => {
    const proof = provePinMutations({ text: REAL })
    expect(proof.ok).toBe(true)
    expect(proof.cases.map((c) => c.id)).toHaveLength(4)
    expect(proof.cases.every((c) => c.ok)).toBe(true)
    expect(proof.cases[0].detail).toContain("não está pinado por digest")
    expect(proof.cases[1].detail).toContain("não é um digest canônico")
    expect(proof.cases[2].detail).toContain("NÃO é o que a tag serve hoje")
    expect(proof.cases[3].detail).toContain("exit 1")
  })

  it("mutação que NÃO muda o arquivo é FALHA (prova vácua), não sucesso", () => {
    // Âncora do contrato removida: a mutação `contrato-afrouxado` deixa de ter
    // onde bater — e sem isso o guard ficaria "provado" por nada.
    const tightened = REAL.replace(/exit 1; \\/g, "true; \\")
    const proof = provePinMutations({ text: tightened })
    expect(proof.ok).toBe(false)
    const noop = proof.cases.find((c) => c.id === "contrato-afrouxado")
    expect(noop?.ok).toBe(false)
    expect(noop?.detail).toContain("ÂNCORA")
  })

  it("arquivo sem FROM: nenhuma mutação é construível (fail-closed)", () => {
    const proof = provePinMutations({ text: "RUN echo oi\n" })
    expect(proof.ok).toBe(false)
    expect(proof.detail).toContain("nenhuma mutação")
  })
})

// ── 7. o probe: o que a TAG serve hoje (índice e filho) ────────────────────

describe("resolveTagDigests — o registry é a única resposta para 'a base de hoje'", () => {
  it("lê o digest do ÍNDICE e o filho da plataforma do runner", async () => {
    const { fetchImpl } = fakeFetch(indexRoute())
    const res = await resolveTagDigests({ ref: "catthehacker/ubuntu:act-latest", fetchImpl })
    expect(res.state).toBe("proven")
    expect(res.index).toBe(SERVED_INDEX)
    expect(res.child).toBe(SERVED_CHILD)
    expect(res.detail).toContain("linux/amd64")
  })

  it("manifesto único (sem `manifests[]`) não inventa filho", async () => {
    const { fetchImpl } = fakeFetch({
      [MANIFEST_URL]: {
        status: 200,
        headers: {
          "docker-content-digest": SERVED_INDEX,
          "content-type": "application/vnd.oci.image.manifest.v1+json",
        },
        body: {},
      },
    })
    const res = await resolveTagDigests({ ref: "catthehacker/ubuntu:act-latest", fetchImpl })
    expect(res).toMatchObject({ state: "proven", index: SERVED_INDEX, child: null })
  })

  it("404 é `missing` (a tag não existe) — não é um pin conforme", async () => {
    const { fetchImpl } = fakeFetch({ [MANIFEST_URL]: { status: 404 } })
    const res = await resolveTagDigests({ ref: "catthehacker/ubuntu:act-latest", fetchImpl })
    expect(res).toMatchObject({ state: "missing", index: null })
  })

  it("401 com desafio Bearer: pede token e relê (o Hub é anônimo por padrão)", async () => {
    const tokenUrl = `https://auth.docker.io/token?service=registry.docker.io&scope=repository%3Acatthehacker%2Fubuntu%3Apull`
    let served = 0
    const fetchImpl = async (url: string) => {
      if (url === tokenUrl)
        return {
          status: 200,
          ok: true,
          headers: { get: () => null },
          json: async () => ({ token: "t" }),
        }
      if (url !== MANIFEST_URL) throw new Error(`rota não dublada: ${url}`)
      served++
      if (served === 1) {
        return {
          status: 401,
          ok: false,
          headers: {
            get: (h: string) =>
              h.toLowerCase() === "www-authenticate"
                ? 'Bearer realm="https://auth.docker.io/token",service="registry.docker.io"'
                : null,
          },
          json: async () => ({}),
        }
      }
      const route = indexRoute()[MANIFEST_URL]
      return {
        status: 200,
        ok: true,
        headers: { get: (h: string) => route.headers?.[h.toLowerCase()] ?? null },
        json: async () => route.body,
      }
    }
    const res = await resolveTagDigests({ ref: "catthehacker/ubuntu:act-latest", fetchImpl })
    expect(res.state).toBe("proven")
    expect(res.index).toBe(SERVED_INDEX)
  })

  it("sem token obtível, `unauthorized` (não olhei ≠ conforme)", async () => {
    const { fetchImpl } = fakeFetch({
      [MANIFEST_URL]: {
        status: 401,
        headers: { "www-authenticate": 'Bearer realm="https://auth.docker.io/token"' },
      },
      "https://auth.docker.io/token?service=registry.docker.io&scope=repository%3Acatthehacker%2Fubuntu%3Apull":
        {
          status: 401,
        },
    })
    const res = await resolveTagDigests({ ref: "catthehacker/ubuntu:act-latest", fetchImpl })
    expect(res.state).toBe("unauthorized")
    expect(res.index).toBeNull()
  })

  it("rede fora do ar é `unreachable`, com a causa registrada", async () => {
    const fetchImpl = async () => {
      throw new Error("ENOTFOUND registry-1.docker.io")
    }
    const res = await resolveTagDigests({ ref: "catthehacker/ubuntu:act-latest", fetchImpl })
    expect(res.state).toBe("unreachable")
    expect(res.detail).toContain("ENOTFOUND")
  })

  it("ref sem tag não é consultável (não há o que a tag sirva)", async () => {
    const res = await resolveTagDigests({ ref: `a/b@${FOREIGN}`, fetchImpl: async () => ({}) })
    expect(res.state).toBe("error")
  })
})

// ── 8. a decisão estática: o pin é o que a tag serve? ─────────────────────

describe("evaluate — o digest fixado × o que a tag serve", () => {
  it("sem digest, a violação NOMEIA a consequência (a base muda sem o repo mudar)", () => {
    const res = evaluate({ text: REAL.replace(/@sha256:[0-9a-f]{64}/, "") })
    expect(res.ok).toBe(false)
    expect(res.violations.join(" ")).toContain("não está pinado por digest")
    expect(res.violations.join(" ")).toContain("FLUTUANTE")
  })

  it("digest malformado (40 hex) passa a olho e não pina nada", () => {
    const res = evaluate({
      text: REAL.replace(/@sha256:[0-9a-f]{64}/, `@sha256:${"a".repeat(40)}`),
    })
    expect(res.ok).toBe(false)
    expect(res.violations.join(" ")).toContain("não é um digest canônico")
  })

  it("o pin que é o ÍNDICE da tag é conforme", () => {
    const res = evaluate({
      text: REAL,
      resolved: { ok: true, index: PINNED, child: SERVED_CHILD, detail: "a tag serve o índice" },
    })
    expect(res.ok).toBe(true)
    expect(res.info.matchesIndex).toBe(true)
  })

  it("o pin do FILHO da plataforma também é imutável (e é conforme)", () => {
    // O índice servido é OUTRO digest: assim o pin só pode ser conforme pelo
    // lado do filho linux/amd64 — que é o outro aceite do `FROM ...@sha256:`.
    const res = evaluate({
      text: REAL,
      resolved: { ok: true, index: SERVED_CHILD, child: PINNED, detail: "a tag serve o índice" },
    })
    expect(res.ok).toBe(true)
    expect(res.info.matchesIndex).toBe(false)
    expect(res.info.matchesChild).toBe(true)
  })

  it("pin velho (ou de OUTRA imagem) é violação: o build verifica outra imagem", () => {
    const res = evaluate({
      text: REAL,
      resolved: { ok: true, index: FOREIGN, child: null, detail: `a tag serve ${FOREIGN}` },
    })
    expect(res.ok).toBe(false)
    expect(res.violations.join(" ")).toContain("NÃO é o que a tag serve hoje")
  })

  it("dois FROM: o pin (e a prova) é de UM só — a prova rodaria sobre outra imagem", () => {
    const res = evaluate({ text: `${REAL}\nFROM debian:12\n` })
    expect(res.ok).toBe(false)
    expect(res.violations.join(" ")).toContain("2 FROM")
  })

  it("o caminho feliz do arquivo real, sem probe: só a forma é afirmada", () => {
    const res = evaluate({ text: REAL, resolved: null })
    expect(res.ok).toBe(true)
    expect(res.info.matchesIndex).toBeNull()
  })
})

// ── 9. a decisão completa: offline, com probe, e a exigência dele ──────────

describe("checkRunnerBase — o veredito e o que ele NÃO provou", () => {
  it("offline: conforme no pin/contrato, e o aviso DIZ que a tag não foi conferida", async () => {
    const res = await checkRunnerBase({ cwd: process.cwd(), probe: false })
    expect(res.state).toBe("proven")
    expect(res.warnings.join(" ")).toContain("--no-registry-probe")
    expect(res.proofs?.contract.ok).toBe(true)
    expect(res.proofs?.mutations.ok).toBe(true)
  })

  it("com probe dublado servindo o MESMO digest: conforme e dito", async () => {
    const { fetchImpl } = fakeFetch(indexRoute())
    const res = await checkRunnerBase({
      cwd: process.cwd(),
      run: spawnSync,
      probe: true,
      fetchImpl,
    })
    expect(res.state).toBe("proven")
    expect(res.info.matchesIndex).toBe(true)
    expect(res.probe?.state).toBe("proven")
    expect(res.warnings).toEqual([])
  })

  it("com probe servindo OUTRO digest: violação (pin velho)", async () => {
    const { fetchImpl } = fakeFetch(indexRoute({ headers: { "docker-content-digest": FOREIGN } }))
    const res = await checkRunnerBase({
      cwd: process.cwd(),
      probe: true,
      prove: false,
      fetchImpl,
    })
    expect(res.state).toBe("violated")
    expect(res.violations.join(" ")).toContain("pin está velho")
  })

  it("sem conseguir olhar a tag e com a prova EXIGIDA: INDETERMINADO (exit 3)", async () => {
    const fetchImpl = async () => {
      throw new Error("ENOTFOUND")
    }
    const res = await checkRunnerBase({
      cwd: process.cwd(),
      probe: true,
      prove: false,
      requireRegistry: true,
      fetchImpl,
    })
    expect(res.state).toBe("unknown")
    expect(res.violations).toEqual([])
    expect(res.warnings.join(" ")).toContain("unreachable")
    expect(exitCodeFor(res)).toBe(EXIT.UNKNOWN)
  })

  it("a mesma cena SEM exigir a prova: verde DECLARANDO o não-provado", async () => {
    const fetchImpl = async () => {
      throw new Error("ENOTFOUND")
    }
    const res = await checkRunnerBase({ cwd: process.cwd(), probe: true, prove: false, fetchImpl })
    expect(res.state).toBe("proven")
    expect(res.warnings.join(" ")).toContain("não pôde ser conferida")
  })

  it("arquivo ausente: violação (fail-closed), nunca 'conforme'", async () => {
    const dir = mkdtempSync(join(tmpdir(), "runner-base-"))
    try {
      const res = await checkRunnerBase({ cwd: dir, probe: false, prove: false })
      expect(res.state).toBe("violated")
      expect(res.detail).toContain("não existe")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("contrato afrouxado no arquivo: violação listando a FRASE da forma", async () => {
    const res = await checkRunnerBase({
      text: REAL.replace("set -euo pipefail; \\", "true; \\"),
      probe: false,
      prove: false,
    })
    expect(res.state).toBe("violated")
    expect(res.violations.join(" ")).toContain("set -euo pipefail")
  })

  it("o relatório nunca escreve 'conforme' sobre o pin sem ter olhado a tag", async () => {
    const res = await checkRunnerBase({ cwd: process.cwd(), probe: false, prove: false })
    const report = renderReport(res)
    expect(report).toContain("não foi conferido contra a tag")
    expect(report).not.toContain("é o que a tag serve hoje")
  })

  it("o relatório INDETERMINADO é explícito no header", async () => {
    const res = await checkRunnerBase({
      cwd: process.cwd(),
      probe: false,
      requireRegistry: true,
      prove: false,
    })
    expect(renderReport(res)).toContain("INDETERMINADO")
  })
})

// ── 10. o `--write`: atualizar o pin é resolver E validar ──────────────────

describe("writePin — o pin se atualiza em um passo, validando o novo valor", () => {
  it("já pinado no que a tag serve: não muda nada", async () => {
    const { fetchImpl } = fakeFetch(indexRoute())
    const res = await writePin({ text: REAL, fetchImpl })
    expect(res.ok).toBe(true)
    expect(res.changed).toBe(false)
    expect(res.detail).toContain("já é o que a tag serve")
  })

  it("base despinada: escreve o digest no FROM e NÃO no comentário", async () => {
    const unpinned = replaceBaseRef(REAL, "catthehacker/ubuntu:act-latest")
    expect(readBase(unpinned).froms[0].parsed.digest).toBeNull()
    const { fetchImpl } = fakeFetch(indexRoute())
    const res = await writePin({ text: unpinned, fetchImpl })
    expect(res.ok).toBe(true)
    expect(res.changed).toBe(true)
    expect(changedLines(unpinned, res.text as string)).toEqual([FROM_LINE])
    expect(readBase(res.text as string).froms[0].parsed.digest).toBe(SERVED_INDEX)
  })

  it("tag que a rede não responde: NÃO escreve (um pin às cegas é o mesmo trabalho manual)", async () => {
    const fetchImpl = async () => {
      throw new Error("ENOTFOUND")
    }
    const res = await writePin({
      text: replaceBaseRef(REAL, "catthehacker/ubuntu:act-latest"),
      fetchImpl,
    })
    expect(res.ok).toBe(false)
    expect(res.text).toBeUndefined()
    expect(res.detail).toContain("unreachable")
  })

  it("tag inexistente: também não escreve", async () => {
    const { fetchImpl } = fakeFetch({ [MANIFEST_URL]: { status: 404 } })
    const res = await writePin({
      text: replaceBaseRef(REAL, "catthehacker/ubuntu:act-latest"),
      fetchImpl,
    })
    expect(res.ok).toBe(false)
    expect(res.detail).toContain("missing")
  })

  it("arquivo sem FROM: erro de uso, não um ref inventado", async () => {
    const res = await writePin({ text: "RUN echo oi\n" })
    expect(res.ok).toBe(false)
  })
})

// ── 11. a CLI (sem rede): os exit codes são o contrato ────────────────────

describe("check-runner-base — CLI e exit codes", () => {
  it("os flags são lidos e um flag desconhecido é uso inválido", () => {
    expect(parseArgs([])).toMatchObject({ probe: true, requireRegistry: false, write: false })
    expect(parseArgs(["--no-registry-probe", "--require-registry", "--json"]).json).toBe(true)
    expect(parseArgs(["--nope"]).error).toContain("desconhecido")
    expect(parseArgs(["--dockerfile"]).error).toContain("exige um caminho")
  })

  it("exitCodeFor é o contrato: 0 conforme, 1 violação, 3 indeterminado", () => {
    expect(exitCodeFor({ state: "proven" })).toBe(EXIT.OK)
    expect(exitCodeFor({ state: "violated" })).toBe(EXIT.VIOLATION)
    expect(exitCodeFor({ state: "unknown" })).toBe(EXIT.UNKNOWN)
  })

  it("offline: exit 0 no repositório real e o JSON traz as provas", () => {
    const res = cli(["--no-registry-probe", "--json"])
    expect(res.status).toBe(EXIT.OK)
    const parsed = JSON.parse(res.stdout as string)
    expect(parsed.state).toBe("proven")
    expect(parsed.exitCode).toBe(EXIT.OK)
    expect(parsed.proofs.contract.ok).toBe(true)
    expect(parsed.proofs.mutations.ok).toBe(true)
    expect(parsed.info.digest).toBe(PINNED)
  })

  it("offline + --require-registry: exit 3 (não provou, não afirma)", () => {
    const res = cli(["--no-registry-probe", "--require-registry"])
    expect(res.status).toBe(EXIT.UNKNOWN)
    expect(res.stdout).toContain("INDETERMINADO")
  })

  it("um Dockerfile apontado por flag, despinado: exit 1", () => {
    const dir = mkdtempSync(join(tmpdir(), "runner-base-cli-"))
    try {
      const file = join(dir, "Dockerfile.probe")
      writeFileSync(file, replaceBaseRef(REAL, "catthehacker/ubuntu:act-latest"), "utf8")
      const res = cli(["--dockerfile", file, "--no-registry-probe"])
      expect(res.status).toBe(EXIT.VIOLATION)
      expect(res.stdout).toContain("não está pinado por digest")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("caminho inexistente é violação (não um verde sem sujeito)", () => {
    const res = cli([
      "--dockerfile",
      join(tmpdir(), "nao-existe-Dockerfile"),
      "--no-registry-probe",
    ])
    expect(res.status).toBe(EXIT.VIOLATION)
    expect(res.stderr).toContain("não existe")
  })

  it("flag desconhecido: exit 2 com a ajuda", () => {
    const res = cli(["--nope"])
    expect(res.status).toBe(EXIT.USAGE)
    expect(res.stderr).toContain("Usage")
  })

  it("--help: exit 0 e o contrato de exit codes documentado", () => {
    const res = cli(["--help"])
    expect(res.status).toBe(EXIT.OK)
    expect(res.stdout).toContain("check-runner-base")
    expect(res.stdout).toContain("3 — indeterminado")
  })
})
