/**
 * prove-image-contract.test.ts
 *
 * Testes da prova por EXECUÇÃO do contrato da imagem PUBLICADA — as partes puras
 * de `scripts/prove-image-contract.mjs` e o FLUXO inteiro com o docker, o
 * registry, o probe e o guard injetados (sem subir container nenhum).
 *
 * O que está sob teste NÃO é o contrato (isso é a prova executada, que exige
 * docker, registry e a imagem do runner): é o CONTRATO DA PROVA — que a
 * sabotagem é cirúrgica e vem de FONTE ÚNICA (a lista de diretórios de plugin do
 * `prove-smoke-render-gate`), que o veredito só é `proven` quando o CONTROLE
 * prova os três fatos E cada sabotagem fica vermelha NOMEANDO o fato dela, e que
 * ausência de prova (sem docker, sem imagem, sem registry) nunca vira sucesso.
 *
 * O caso mais importante é o do meio: uma sabotagem que PASSA em silêncio. É o
 * modo de falha que a prova existe para pegar — a verificação daquele fato seria
 * decorativa, com o relatório dizendo que o artefato cumpre o contrato.
 *
 * Usage:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/prove-image-contract.test.ts
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { BUN_PATH } from "../../../scripts/check-runner-base.mjs"
import { PLUGIN_DIRS } from "../../../scripts/prove-smoke-render-gate.mjs"
import {
  CONTRACT_CASES,
  DEFAULT_ENV_FILE,
  DEFAULT_REGISTRY_IMAGE,
  EXIT,
  REGISTRY_NAMESPACE,
  REGISTRY_REPO,
  classifyCase,
  exitCodeFor,
  freePort,
  parseArgs,
  proofResult,
  proveImageContract,
  removeRegistry,
  sabotageDockerfile,
  summarizeProof,
} from "../../../scripts/prove-image-contract.mjs"

const REPO_ROOT = process.cwd()

/** O caso do controle, que todo veredito precisa. */
const CONTROL = CONTRACT_CASES.find((c) => c.id === "controle") as (typeof CONTRACT_CASES)[number]

/** Um resultado de caso no shape que o `classifyCase` consome. */
function caseResult(id: string, state: string, detail: string, extra: object = {}) {
  return { id, ok: true, state, detail, wrong: [], ...extra }
}

// ── o docker dublê do fluxo ───────────────────────────────────────────────

type SpawnResult = {
  status: number | null
  stdout: string
  stderr: string
  pid: number
  signal: null
  output: (string | null)[]
}

function spawnResult(status: number | null, stdout = "", stderr = ""): SpawnResult {
  return { status, stdout, stderr, pid: 1, signal: null, output: [null, stdout, stderr] }
}

/**
 * O `docker` dublê: só responde o que o fluxo pergunta — e REGISTRA cada
 * chamada, porque a asserção mais importante aqui é sobre o que NÃO foi
 * empurrado (a tag que fica de fora de propósito) e sobre a sabotagem ter sido
 * CONSTRUÍDA (e não apenas nomeada).
 */
function fakeRun(overrides: Partial<Record<string, SpawnResult>> = {}) {
  const calls: { cmd: string; args: string[] }[] = []
  const run = (cmd: string, args: string[]) => {
    calls.push({ cmd, args })
    const key = args[0] === "image" ? `image-${args[1]}` : args[0]
    if (key && overrides[key]) return overrides[key] as SpawnResult
    if (args[0] === "version") return spawnResult(0, "29.6.1\n")
    if (args[0] === "run") return spawnResult(0, "container-id\n")
    return spawnResult(0, "")
  }
  return { run, calls }
}

/** O `fetch` dublê do registry de teste: responde, ou nao ha registry nenhum. */
const okFetch = async () => ({ ok: true })
const noFetch = async () => ({ ok: false })

/** O contrato, no desfecho que cada id de caso deve ter. */
function fakeCheck(
  map: Record<string, { state: string; detail: string; findings?: object | null }>,
) {
  const refs: string[] = []
  const check = async ({ ref }: { ref: string }) => {
    refs.push(ref)
    const tag = ref.slice(ref.lastIndexOf(":") + 1)
    const hit = map[tag] ?? { state: "proven", detail: "a imagem PUBLICADA executa o contrato" }
    return {
      state: hit.state,
      detail: hit.detail,
      target: `${ref.slice(0, ref.lastIndexOf(":"))}@sha256:${"a".repeat(64)}`,
      digest: `sha256:${"a".repeat(64)}`,
      findings: hit.findings ?? null,
    }
  }
  return { check, refs }
}

/** A medição dos três fatos dentro do artefato (o `runEvidence` dublê). */
const fakeEvidence = (bunPath: string, bunVersion: string, compose: string) => () => ({
  code: 0,
  output: `bun-path=${bunPath}\nbun-version=${bunVersion}\ncompose=${compose}\n`,
})

// ── a sabotagem é cirúrgica e vem de fonte única ──────────────────────────

describe("sabotageDockerfile — a sabotagem tem de ser CIRÚRGICA", () => {
  it("a do plugin remove o `compose` de TODOS os diretórios (fonte única)", () => {
    const text = sabotageDockerfile("plugin", "ghcr.io/x/ubuntu-bun:1.0.0")
    expect(text).toContain("FROM ghcr.io/x/ubuntu-bun:1.0.0")
    expect(text).toContain("RUN rm -f ")
    for (const dir of PLUGIN_DIRS) expect(text).toContain(`${dir}/docker-compose`)
    // Deixar um caminho para trás faria o "sem o plugin" ser, na verdade, "com o
    // plugin em outro lugar" — e o mutante passaria por um motivo FALSO.
    expect(text.split("docker-compose").length - 1).toBe(PLUGIN_DIRS.length)
  })

  it("a do caminho move o Bun de /usr/local/bin (não o apaga: o tier-1 tem de PARAR de achar)", () => {
    const text = sabotageDockerfile("bun-path", "ghcr.io/x/ubuntu-bun:1.0.0")
    expect(text).toContain(`mv ${BUN_PATH} ${BUN_PATH}.fora-do-caminho`)
    expect(text).not.toContain("rm ")
  })

  it("sabotagem desconhecida é ERRO (nunca um Dockerfile vazio, que 'passaria')", () => {
    expect(() => sabotageDockerfile("qualquer-coisa" as never, "x")).toThrow(
      /sabotagem desconhecida/,
    )
  })
})

// ── o caso mede DUAS coisas: o estado E o fato nomeado ────────────────────

describe("classifyCase — o vermelho genérico não conta", () => {
  it("estado esperado E fato nomeado → o caso mediu o que diz medir", () => {
    const spec = CONTRACT_CASES.find((c) => c.id === "plugin-ausente")!
    const result = classifyCase(spec, caseResult(spec.id, "violated", spec.mustName[0]) as never)
    expect(result.ok).toBe(true)
    expect(result.wrong).toEqual([])
  })

  it("estado certo mas SEM nomear o fato → NÃO mediu (algo quebrou, não este fato)", () => {
    const spec = CONTRACT_CASES.find((c) => c.id === "plugin-ausente")!
    const result = classifyCase(spec, caseResult(spec.id, "violated", "deu ruim") as never)
    expect(result.ok).toBe(false)
    expect(result.wrong.join(" ")).toContain("NAO nomeia")
  })

  it("estado errado → não mediu, e o diff diz o esperado", () => {
    const spec = CONTRACT_CASES.find((c) => c.id === "tag-ausente")!
    const result = classifyCase(spec, caseResult(spec.id, "proven", "nao foi resolvido") as never)
    expect(result.ok).toBe(false)
    expect(result.wrong.join(" ")).toContain("esperado e 'unavailable'")
  })
})

// ── o veredito ────────────────────────────────────────────────────────────

describe("summarizeProof — a prova só é PROVEN quando o controle E as sabotagens mordem", () => {
  const control = caseResult("controle", "proven", "executa o contrato")

  it("sem caso nenhum é INDETERMINADO — nunca 'esta certo'", () => {
    expect(summarizeProof({ cases: [] }).verdict).toBe("unavailable")
  })

  it("o motivo declarado (skip) vence: sem prova não há veredito", () => {
    const summary = summarizeProof({ cases: [control], skipped: "sem docker" })
    expect(summary.verdict).toBe("unavailable")
    expect(summary.detail).toContain("sem docker")
  })

  it("controle sem a marca vira VIOLADO (um vermelho sem verde não é atribuível ao fato)", () => {
    const summary = summarizeProof({
      cases: [caseResult("controle", "violated", "sem a marca", { ok: false }), control],
    })
    expect(summary.verdict).toBe("violated")
    expect(summary.blockers.join(" ")).toContain("CONTROLE")
  })

  it("sabotagem que PASSA em silêncio vira VIOLADO — é o modo de falha que a prova existe para pegar", () => {
    const summary = summarizeProof({
      cases: [
        control,
        caseResult("plugin-ausente", "proven", "nao mordeu", {
          ok: false,
          wrong: ["saiu 'proven'"],
        }),
      ],
    })
    expect(summary.verdict).toBe("violated")
    expect(summary.blockers.join(" ")).toContain("plugin-ausente")
    expect(summary.blockers.join(" ")).toContain("NAO mediu o que diz medir")
  })

  it("controle provado e cada sabotagem nomeando o fato → PROVEN", () => {
    const summary = summarizeProof({
      cases: [
        control,
        caseResult("plugin-ausente", "violated", "o PLUGIN 'compose' nao esta na imagem"),
        caseResult(
          "bun-fora-do-caminho",
          "violated",
          `bun resolve de 'AUSENTE' (o contrato promete ${BUN_PATH})`,
        ),
        caseResult("versao-diferente", "violated", "bun --version = '1.3.14' (o esperado e 'x')"),
        caseResult("tag-ausente", "unavailable", "o digest da tag nao foi resolvido"),
      ],
    })
    expect(summary.verdict).toBe("proven")
    expect(summary.blockers).toEqual([])
  })
})

// ── o contrato dos CASOS (a lista é o contrato da prova) ──────────────────

describe("CONTRACT_CASES — o conjunto é o contrato", () => {
  it("um CONTROLE e quatro sabotagens, com ids únicos", () => {
    expect(CONTRACT_CASES.map((c) => c.id)).toEqual([
      "controle",
      "plugin-ausente",
      "bun-fora-do-caminho",
      "versao-diferente",
      "tag-ausente",
    ])
    expect(new Set(CONTRACT_CASES.map((c) => c.id)).size).toBe(CONTRACT_CASES.length)
  })

  it("o controle exige `proven` e os três fatos; toda sabotagem nomeia o fato dela", () => {
    expect(CONTROL.expect).toBe("proven")
    expect(CONTROL.mustName.join(" ")).toContain("plugin `compose`")
    expect(CONTROL.mustName.join(" ")).toContain(BUN_PATH)
    const plugin = CONTRACT_CASES.find((c) => c.id === "plugin-ausente")!
    expect(plugin.expect).toBe("violated")
    expect(plugin.mustName.join(" ")).toContain("PLUGIN")
    const path = CONTRACT_CASES.find((c) => c.id === "bun-fora-do-caminho")!
    expect(path.mustName.join(" ")).toContain(BUN_PATH)
    const version = CONTRACT_CASES.find((c) => c.id === "versao-diferente")!
    expect(version.mustName.join(" ")).toContain("bun --version")
    // A tag ausente NÃO é violação: um 404 do registry é ausência de prova.
    const missing = CONTRACT_CASES.find((c) => c.id === "tag-ausente")!
    expect(missing.expect).toBe("unavailable")
    for (const c of CONTRACT_CASES) expect(c.mustName.length).toBeGreaterThan(0)
  })
})

// ── formato e CLI ─────────────────────────────────────────────────────────

describe("formato e CLI", () => {
  it("o shape é o mesmo em qualquer desfecho (o --json não muda de shape)", () => {
    const result = proofResult()
    expect(Object.keys(result)).toEqual([
      "verdict",
      "blockers",
      "detail",
      "ref",
      "version",
      "envFile",
      "registry",
      "registryImage",
      "cases",
      "reused",
      "cleanup",
    ])
    expect(result.verdict).toBe("unavailable")
    expect(result.reused).toBe(false)
    expect(result.cleanup).toBeNull()
  })

  it("o exit code segue o veredito", () => {
    expect(exitCodeFor("proven")).toBe(EXIT.OK)
    expect(exitCodeFor("violated")).toBe(EXIT.FAILED)
    expect(exitCodeFor("unavailable")).toBe(EXIT.UNAVAILABLE)
  })

  it("parseArgs: defaults e erros", () => {
    const opts = parseArgs([])
    expect(opts.envFile).toBe(DEFAULT_ENV_FILE)
    expect(opts.registryImage).toBe(DEFAULT_REGISTRY_IMAGE)
    expect(opts.build).toBe(false)
    expect(parseArgs(["--nope"]).error).toContain("opcao desconhecida")
    expect(parseArgs(["--image"]).error).toContain("--image")
    expect(parseArgs(["--timeout", "0"]).error).toContain("--timeout")
    expect(parseArgs(["--bun-version", "1.3.14"]).bunVersion).toBe("1.3.14")
  })

  it("freePort devolve uma porta utilizável em 127.0.0.1", async () => {
    const port = await freePort()
    expect(port).toBeGreaterThan(0)
  })
})

// ── o fluxo inteiro, com docker/registry/guard injetados ─────────────────

describe("proveImageContract — o fluxo", () => {
  const opts = () => ({ cwd: REPO_ROOT, envFile: DEFAULT_ENV_FILE })

  it("sem docker é INDETERMINADO (a linha que a doc declara)", async () => {
    const { run } = fakeRun({ version: spawnResult(127, "", "docker: not found") })
    const result = await proveImageContract({ ...opts(), run })
    expect(result.verdict).toBe("unavailable")
    expect(exitCodeFor(result.verdict)).toBe(EXIT.UNAVAILABLE)
    expect(result.detail).toContain("sem docker")
    expect(result.cases).toEqual([])
  })

  it("imagem local ausente sem --build é INDETERMINADO, com o remédio escrito", async () => {
    const { run } = fakeRun({ "image-inspect": spawnResult(1, "", "No such image") })
    const result = await proveImageContract({ ...opts(), run, check: fakeCheck({}).check })
    expect(result.verdict).toBe("unavailable")
    expect(result.detail).toContain("--build")
  })

  it("registry de teste que não sobe é INDETERMINADO (sem registry não há artefato publicado)", async () => {
    const { run } = fakeRun({ run: spawnResult(125, "", "port is already allocated") })
    const result = await proveImageContract({
      ...opts(),
      run,
      check: fakeCheck({}).check,
      fetchImpl: noFetch,
    })
    expect(result.verdict).toBe("unavailable")
    expect(result.detail).toContain("registry de teste nao subiu")
  })

  it("registry já respondendo na porta fixa é REUSADO — e um reuso não tenta remover o que não subiu", async () => {
    // O `rm` do dublê FALHA de propósito: num reuso ele nem chega a ser chamado,
    // e a nota de limpeza tem de continuar nula (o container é de outra run).
    const { run, calls } = fakeRun({ rm: spawnResult(1, "", "permission denied") })
    const { check } = fakeCheck({
      controle: {
        state: "proven",
        detail: `a imagem PUBLICADA executa o contrato: plugin \`compose\`, bun 1.3.14 em ${BUN_PATH}`,
      },
      "plugin-ausente": { state: "violated", detail: "o PLUGIN 'compose' nao esta na imagem" },
      "bun-fora-do-caminho": {
        state: "violated",
        detail: `bun resolve de 'AUSENTE' (o contrato promete ${BUN_PATH})`,
      },
      "versao-diferente": {
        state: "violated",
        detail: "bun --version = '1.3.14' (o esperado e 'x')",
      },
      "tag-ausente-nunca-empurrada": {
        state: "unavailable",
        detail: "o digest da tag nao foi resolvido",
      },
    })
    const result = await proveImageContract({
      ...opts(),
      run,
      check,
      fetchImpl: okFetch,
      evidence: fakeEvidence(BUN_PATH, "1.3.14", "compose"),
    })
    expect(result.verdict).toBe("proven")
    expect(result.reused).toBe(true)
    expect(result.cleanup).toBeNull()
    // Nenhum `docker run` do registry — o que já estava de pé foi usado.
    expect(calls.filter((c) => c.args[0] === "run")).toHaveLength(0)
    expect(calls.filter((c) => c.args[0] === "rm")).toHaveLength(0)
  })

  it("o caminho feliz: CONTROLE provado com os três fatos MEDIDOS e as quatro sabotagens medidas", async () => {
    const { run, calls } = fakeRun()
    // O probe de reuso falha UMA vez (nada escutando na porta fixa) e responde
    // depois de o container subir: a run SOBE o registry — o caminho que a
    // limpeza depois tem de cobrir — em vez de reusar.
    let probes = 0
    const fetchAfterStart = async () => ({ ok: ++probes > 1 })
    const { check, refs } = fakeCheck({
      // O detalhe do `proven` é o do guard REAL: é ele que o CONTROLE tem de casar
      // (o `mustName` exige os três fatos nomeados, não só o estado).
      controle: {
        state: "proven",
        detail:
          "a imagem PUBLICADA (127.0.0.1/prova/ubuntu-bun@sha256:…) executa o contrato: " +
          "plugin `compose`, bun 1.3.14 em /usr/local/bin/bun (a label da imagem declara 1.3.14)",
      },
      "plugin-ausente": {
        state: "violated",
        detail: "o PLUGIN 'compose' nao esta na imagem (o job 'guards' da fica INDETERMINADO)",
        findings: { bunPath: BUN_PATH, bunVersion: "1.3.14", composeVersion: "AUSENTE" },
      },
      "bun-fora-do-caminho": {
        state: "violated",
        detail: `bun resolve de 'AUSENTE' (o contrato promete ${BUN_PATH})`,
      },
      "versao-diferente": {
        state: "violated",
        detail: "bun --version = '1.3.14' (o esperado e 'x')",
      },
      "tag-ausente-nunca-empurrada": {
        state: "unavailable",
        detail: "o digest da tag nao foi resolvido (missing)",
      },
    })
    const result = await proveImageContract({
      ...opts(),
      run,
      check,
      fetchImpl: fetchAfterStart,
      evidence: fakeEvidence(BUN_PATH, "1.3.14", "Docker Compose version 5.4.0-2"),
    })

    expect(result.verdict).toBe("proven")
    // O registry foi SUBIDO nesta run (e por isso a limpeza se aplica a ele).
    expect(result.reused).toBe(false)
    expect(result.cleanup).toBeNull()
    expect(calls.filter((c) => c.args[0] === "run")).toHaveLength(1)
    expect(calls.filter((c) => c.args[0] === "rm")).toHaveLength(1)
    expect(result.cases).toHaveLength(CONTRACT_CASES.length)
    expect(result.ref).toBe("ghcr.io/severinno/ubuntu-bun:1.3.14")
    // O CONTROLE passou pelos TRÊS fatos medidos dentro do artefato — não narrados.
    const control = result.cases.find((c) => c.id === "controle")!
    expect(control.ok).toBe(true)
    expect(control.findings).toMatchObject({
      bunPath: BUN_PATH,
      composeVersion: "Docker Compose version 5.4.0-2",
    })

    // Cada caso foi medida contra um alvo no registry de TESTE (nunca a imagem local).
    const tags = refs.map((r) => r.slice(r.lastIndexOf(":") + 1))
    expect(tags).toEqual([
      "controle",
      "plugin-ausente",
      "bun-fora-do-caminho",
      "versao-diferente",
      "tag-ausente-nunca-empurrada",
    ])
    expect(refs.every((r) => r.startsWith("http://127.0.0.1:"))).toBe(true)
    expect(refs.every((r) => r.includes(`/${REGISTRY_NAMESPACE}/${REGISTRY_REPO}:`))).toBe(true)

    // As duas sabotagens de ARTEFATO foram CONSTRUÍDAS (não só nomeadas) — cada uma
    // a partir do Dockerfile derivado (o CONTEÚDO dele é provado no bloco puro).
    const built = calls.filter((c) => c.args[0] === "build").map((c) => c.args.join(" "))
    expect(built).toHaveLength(2)
    expect(built.join(" ")).toContain("plugin-ausente.Dockerfile")
    expect(built.join(" ")).toContain("bun-fora-do-caminho.Dockerfile")

    // …e a tag ausente é a ÚNICA que não foi empurrada — por desenho.
    const pushed = calls.filter((c) => c.args[0] === "push").map((c) => c.args[1])
    expect(pushed).toHaveLength(CONTRACT_CASES.length - 1)
    expect(pushed.some((p) => p.endsWith("tag-ausente-nunca-empurrada"))).toBe(false)
  })

  it("sabotagem que passa em silêncio vira VIOLADO (a verificação seria decorativa)", async () => {
    const { run } = fakeRun()
    const { check } = fakeCheck({
      // O contrato NÃO acusou o plugin removido: a imagem sem o plugin passaria.
      "plugin-ausente": { state: "proven", detail: "a imagem PUBLICADA executa o contrato" },
      "bun-fora-do-caminho": {
        state: "violated",
        detail: `bun resolve de 'AUSENTE' (o contrato promete ${BUN_PATH})`,
      },
      "versao-diferente": {
        state: "violated",
        detail: "bun --version = '1.3.14' (o esperado e 'x')",
      },
      "tag-ausente-nunca-empurrada": {
        state: "unavailable",
        detail: "o digest da tag nao foi resolvido",
      },
    })
    const result = await proveImageContract({
      ...opts(),
      run,
      check,
      fetchImpl: okFetch,
      evidence: fakeEvidence(BUN_PATH, "1.3.14", "compose"),
    })
    expect(result.verdict).toBe("violated")
    expect(result.blockers.join(" ")).toContain("plugin-ausente")
  })

  it("o build da sabotagem que falha NÃO vira caso verde: o caso não mediu nada", async () => {
    const { run } = fakeRun()
    // O PRIMEIRO build (o do plugin) falha; o resto do caminho não importa.
    let builds = 0
    const countingRun = (cmd: string, args: string[]) => {
      if (args[0] === "build") {
        builds += 1
        if (builds === 1) return spawnResult(1, "", "o build da sabotagem explodiu")
      }
      return run(cmd, args)
    }
    const { check } = fakeCheck({
      "bun-fora-do-caminho": {
        state: "violated",
        detail: `bun resolve de 'AUSENTE' (o contrato promete ${BUN_PATH})`,
      },
      "versao-diferente": {
        state: "violated",
        detail: "bun --version = '1.3.14' (o esperado e 'x')",
      },
      "tag-ausente-nunca-empurrada": {
        state: "unavailable",
        detail: "o digest da tag nao foi resolvido",
      },
    })
    const result = await proveImageContract({
      ...opts(),
      run: countingRun,
      check,
      fetchImpl: okFetch,
      evidence: fakeEvidence(BUN_PATH, "1.3.14", "compose"),
    })
    expect(result.verdict).toBe("violated")
    expect(result.blockers.join(" ")).toContain("plugin-ausente")
  })
})

// ── a limpeza do registry (uma falha de limpeza não pode ser invisível) ──

describe("removeRegistry — a limpeza é REPORTADA, não presumida", () => {
  it("removido com sucesso → nenhuma nota", () => {
    const { run } = fakeRun()
    expect(removeRegistry({ container: "prova-x", run })).toBeNull()
  })

  it("não removido → a nota diz o container e o remédio (o veredito não muda)", () => {
    const { run } = fakeRun({ rm: spawnResult(1, "", "permission denied") })
    const note = removeRegistry({ container: "prova-x", run })
    expect(note).toContain("permission denied")
    expect(note).toContain("docker rm -f prova-x")
  })
})

// ── o fio até o package.json (a família do check:prove-docs é derivada) ──

describe("wiring", () => {
  it("o comando está no package.json apontando para o script (a família é derivada disso)", () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
      scripts: Record<string, string>
    }
    expect(pkg.scripts["image-contract:prove"]).toBe("node scripts/prove-image-contract.mjs")
  })
})
