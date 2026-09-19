/**
 * prove-gitea-merge-gate.test.ts
 *
 * Testes da prova de que um gate vermelho NÃO mergeia — as funções PURAS de
 * `scripts/prove-gitea-merge-gate.mjs`, o `httpJson` contra um servidor HTTP de
 * verdade (local e efêmero) e o FLUXO inteiro com o docker e a API dublados.
 *
 * O que está sob teste aqui não é a forja (isso é a prova executada, que sobe um
 * Gitea efêmero): é o CONTRATO do ensaio — a matriz de casos, a leitura do
 * desfecho (em que "Please try again later" NÃO é o gate), o veredito e a
 * atribuição que separa "o gate morde" de "o applier não ligou a exigência".
 *
 * Três casos de regressão ficam travados aqui:
 *   1. com `enable_status_check=false` o `--check` do applier TEM de acusar drift
 *      (medido: sem isso, um PR com gate vermelho mergeia);
 *   2. o applier que NÃO liga a exigência tem de sair VIOLADO — e não
 *      "indeterminado", que faria a regressão parecer falta de medida;
 *   3. a proteção tem de REGISTRAR o manifesto: um contexto a menos, um a mais ou
 *      um com CONTAGEM no nome sai VIOLADO e nomeado (antes, o registro era só
 *      impresso — um subconjunto registrado passava verde).
 *
 * Usage:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/prove-gitea-merge-gate.test.ts
 */

import { createServer } from "node:http"
import { describe, expect, it } from "vitest"
import {
  DEFAULT_IMAGE,
  EXIT,
  OWNER,
  REPO_NAME,
  casesPlan,
  classifyMerge,
  containerArgs,
  countInContext,
  exitCodeFor,
  httpJson,
  parseAccessToken,
  parseArgs,
  proveGiteaMergeGate,
  registrationDelta,
  summarizeMatrix,
  uniqueContainerName,
} from "../../../scripts/prove-gitea-merge-gate.mjs"

const CONTEXTS = [
  "Lint",
  "Repo Guards",
  "Bring-up Gate Proof (pré-requisito 0, por execução)",
  "Pre-commit Proof (dentro da imagem do runner)",
  "TypeCheck",
  "Tests",
  "Build",
]
const REPO = `${OWNER}/${REPO_NAME}`

// ── 1. O plano ───────────────────────────────────────────────────────────

describe("casesPlan", () => {
  it("a matriz: verde mergeia, vermelho e ausente NÃO, e a mutação volta a mergear", () => {
    const cases = casesPlan(CONTEXTS)
    expect(cases.map((c) => c.id)).toEqual([
      "controle-verde",
      "gate-vermelho",
      "gate-ausente",
      "exigencia-desligada",
    ])
    expect(cases[0]).toMatchObject({ statuses: "all-success", expect: "merged", prep: null })
    expect(cases[1]).toMatchObject({ statuses: "failure:Lint", expect: "blocked" })
    expect(cases[2]).toMatchObject({ statuses: "none", expect: "blocked" })
    // é a MESMA falha do caso 2, com a exigência desligada: se mergear, o que
    // bloqueava era o enable_status_check
    expect(cases[3]).toMatchObject({
      statuses: "failure:Lint",
      expect: "merged",
      prep: "disable-enforcement",
    })
  })

  it("o primeiro contexto vem do manifesto (não de um literal)", () => {
    expect(casesPlan(["Repo Guards", "Tests"])[1].statuses).toBe("failure:Repo Guards")
  })
})

// ── 2. A leitura do desfecho ─────────────────────────────────────────────

describe("classifyMerge", () => {
  it("200 é merge aceito", () => {
    expect(classifyMerge({ status: 200, body: '{"merged":true}' })).toMatchObject({
      state: "merged",
      http: 200,
    })
  })

  it("405 do GATE é recusa, com o motivo extraído", () => {
    const out = classifyMerge({
      status: 405,
      body: '{"message":"not allowed to merge [reason: Not all required status checks successful]"}',
    })
    expect(out.state).toBe("blocked")
    expect(out.reason).toBe("Not all required status checks successful")
  })

  it("405 de mergeability ('try again later') NÃO é o gate — é 'other'", () => {
    const out = classifyMerge({ status: 405, body: '{"message":"Please try again later"}' })
    expect(out.state).toBe("other")
    expect(out.detail).toContain("NAO e do gate")
  })

  it("sem resposta da API é indeterminado, não bloqueio", () => {
    expect(classifyMerge({ status: null, body: "timeout" }).state).toBe("unavailable")
    expect(classifyMerge({ status: 500, body: "boom" }).state).toBe("other")
  })
})

// ── 3. O veredito ────────────────────────────────────────────────────────

describe("summarizeMatrix", () => {
  const withOutcomes = (states: Record<string, string>) =>
    casesPlan(CONTEXTS).map((c) => ({
      ...c,
      outcome: { state: states[c.id] ?? c.expect, http: 200, reason: null, detail: "" },
    }))

  it("aprova quando todas as células batem", () => {
    const v = summarizeMatrix(withOutcomes({}))
    expect(v.verdict).toBe("proven")
    expect(v.blockers).toEqual([])
  })

  it("reprova quando o gate vermelho MERGEOU (o modo que a prova existe para pegar)", () => {
    const v = summarizeMatrix(withOutcomes({ "gate-vermelho": "merged" }))
    expect(v.verdict).toBe("violated")
    expect(v.blockers.join(" ")).toContain("MERGEOU quando deveria ser recusado")
  })

  it("reprova quando o controle NÃO mergeou (o bloqueio não é do gate)", () => {
    const v = summarizeMatrix(withOutcomes({ "controle-verde": "blocked" }))
    expect(v.verdict).toBe("violated")
    expect(v.blockers.join(" ")).toContain("nao e do gate")
  })

  it("caso não medido não passa por caso aprovado", () => {
    const v = summarizeMatrix(withOutcomes({ "gate-ausente": "unavailable" }))

    expect(v.verdict).toBe("violated")
    expect(v.blockers.join(" ")).toContain("NAO MEDIDO")
  })
})

// ── 4. O container efêmero e a CLI ───────────────────────────────────────

// ── 1b. A régua do registro ───────────────────────────────────────────────

describe("countInContext", () => {
  it("acha a contagem onde ela mora", () => {
    expect(countInContext("Mutation guards master (24 node-pure mutation tests)")).toBe(
      "(24 node-pure mutation tests)",
    )
    expect(
      countInContext("Mutation Test (contrato coordenado — doc↔anchor↔código, 5 cenários)"),
    ).toBe("(contrato coordenado — doc↔anchor↔código, 5 cenários)")
  })

  it("NÃO acusa os contextos legítimos que só têm parênteses", () => {
    for (const context of [
      "Bring-up Gate Proof (pré-requisito 0, por execução)",
      "Pre-commit Proof (dentro da imagem do runner)",
      "Mutation Test (contrato coordenado — doc↔anchor↔código)",
      "Mutation Test (seed dev E2E pega regressões?)",
      "Seed E2E ${{ matrix.seed }} · ${{ matrix.variant }}",
      "Lint",
    ]) {
      expect(countInContext(context)).toBeNull()
    }
  })
})

describe("registrationDelta — a proteção registra o manifesto?", () => {
  it("em sincronia: nem falta, nem sobra, nem contagem", () => {
    const d = registrationDelta({ expected: CONTEXTS, registered: [...CONTEXTS] })
    expect(d).toEqual({ ok: true, missing: [], extra: [], withCount: [] })
  })

  it("a ORDEM do registro não é defeito (o conjunto é)", () => {
    const d = registrationDelta({ expected: CONTEXTS, registered: [...CONTEXTS].reverse() })
    expect(d.ok).toBe(true)
  })

  it("contexto a MENOS: o job roda e o merge passa — nomeado", () => {
    const d = registrationDelta({ expected: CONTEXTS, registered: CONTEXTS.slice(0, -1) })
    expect(d.ok).toBe(false)
    expect(d.missing).toEqual(["Build"])
    expect(d.extra).toEqual([])
  })

  it("contexto a MAIS: o PR trava para sempre — nomeado", () => {
    const d = registrationDelta({
      expected: CONTEXTS,
      registered: [...CONTEXTS, "Mutation guards master (24 node-pure mutation tests)"],
    })
    expect(d.ok).toBe(false)
    expect(d.extra).toEqual(["Mutation guards master (24 node-pure mutation tests)"])
    // O mesmo elemento aparece nas DUAS listas: sobrou (a régua velha) e carrega
    // contagem (o nome que muda sozinho). São dois motivos, um só defeito.
    expect(d.withCount).toEqual([
      {
        context: "Mutation guards master (24 node-pure mutation tests)",
        count: "(24 node-pure mutation tests)",
      },
    ])
  })

  it("CONTAGEM no lado do MANIFESTO também reprova (o defeito é de origem)", () => {
    const d = registrationDelta({
      expected: [...CONTEXTS, "Mutation guards master (24 node-pure mutation tests)"],
      registered: [...CONTEXTS, "Mutation guards master (24 node-pure mutation tests)"],
    })
    expect(d.ok).toBe(false)
    expect(d.missing).toEqual([])
    expect(d.extra).toEqual([])
    expect(d.withCount).toHaveLength(1)
  })

  it("registro VAZIO não passa por 'nada a conferir'", () => {
    const d = registrationDelta({ expected: CONTEXTS, registered: [] })
    expect(d.ok).toBe(false)
    expect(d.missing).toEqual(CONTEXTS)
  })
})

describe("containerArgs", () => {
  const args = containerArgs({ name: "prova-x", port: 3390, image: DEFAULT_IMAGE })

  it("torna a instância inofensiva: instalada, sem cadastro e offline", () => {
    expect(args).toContain("GITEA__database__DB_TYPE=sqlite3")
    expect(args).toContain("GITEA__security__INSTALL_LOCK=true")
    expect(args).toContain("GITEA__service__DISABLE_REGISTRATION=true")
    expect(args).toContain("GITEA__server__OFFLINE_MODE=true")
  })

  it("publica a porta só em loopback e termina com a imagem", () => {
    expect(args[args.indexOf("-p") + 1]).toBe("127.0.0.1:3390:3000")
    expect(args[args.indexOf("--name") + 1]).toBe("prova-x")
    expect(args[args.length - 1]).toBe(DEFAULT_IMAGE)
  })
})

describe("uniqueContainerName", () => {
  it("não colide entre execuções (nome estável + sufixo injetado)", () => {
    expect(uniqueContainerName(() => 0)).toMatch(/^prova-merge-gate-0000$/)
    expect(uniqueContainerName(() => 0.5)).toMatch(/^prova-merge-gate-7fff$/)
    expect(uniqueContainerName()).not.toBe(uniqueContainerName())
  })
})

describe("parseAccessToken", () => {
  it("lê o token do texto do CLI e recusa o que não é token", () => {
    const hex = "a".repeat(40)
    expect(parseAccessToken(`Access token was successfully created: ${hex}\n`)).toBe(hex)
    expect(parseAccessToken("erro qualquer")).toBeNull()
    expect(parseAccessToken(`curto: ${"a".repeat(39)}`)).toBeNull()
  })
})

describe("parseArgs", () => {
  it("defaults: porta e nome automáticos (sem colisão com execução anterior)", () => {
    expect(parseArgs([])).toMatchObject({
      json: false,
      keep: false,
      port: null,
      name: null,
      image: DEFAULT_IMAGE,
      timeoutS: 90,
    })
  })

  it("aceita as flags documentadas", () => {
    expect(parseArgs(["--keep", "--json"])).toMatchObject({ keep: true, json: true })
    expect(parseArgs(["--port", "3500", "--timeout", "30"])).toMatchObject({
      port: 3500,
      timeoutS: 30,
    })
    expect(parseArgs(["--name", "x", "--image", "gitea/gitea:1.21"])).toMatchObject({
      name: "x",
      image: "gitea/gitea:1.21",
    })
  })

  it("falha em flag desconhecida, argumento solto e valor inválido", () => {
    expect(parseArgs(["--nope"]).error).toContain("flag desconhecida")
    expect(parseArgs(["limbo"]).error).toContain("argumento inesperado")
    expect(parseArgs(["--port", "abc"]).error).toContain("--port invalido")
    expect(parseArgs(["--image"]).error).toContain("--image")
  })
})

describe("exitCodeFor", () => {
  it("mapeia o tri-estado da família", () => {
    expect(exitCodeFor("proven")).toBe(EXIT.OK)
    expect(exitCodeFor("violated")).toBe(EXIT.FAILED)
    expect(exitCodeFor("unavailable")).toBe(EXIT.UNAVAILABLE)
  })
})

// ── 5. httpJson (servidor real, local) ───────────────────────────────────

describe("httpJson", () => {
  const withServer = async (handler: Parameters<typeof createServer>[1]) => {
    const server = createServer(handler)
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()))
    const address = server.address()
    const port = typeof address === "object" && address ? address.port : 0
    return { port, close: () => new Promise<void>((r) => server.close(() => r())) }
  }

  it("devolve status, JSON parseado e o texto para um 201", async () => {
    const { port, close } = await withServer((_req, res) => {
      res.writeHead(201, { "Content-Type": "application/json" })
      res.end('{"number":7}')
    })
    try {
      const out = await httpJson({ port, method: "POST", path: "/pulls", body: { a: 1 } })
      expect(out.status).toBe(201)
      expect(out.data).toEqual({ number: 7 })
      expect(out.text).toBe('{"number":7}')
    } finally {
      await close()
    }
  })

  it("transporte que não responde vira status null (o laço de espera decide)", async () => {
    const { port, close } = await withServer(() => {
      // nunca responde
    })
    try {
      const out = await httpJson({ port, method: "GET", path: "/version", timeoutMs: 200 })
      expect(out.status).toBeNull()
      expect(out.text).toContain("timeout")
    } finally {
      await close()
    }
  })

  it("porta fechada vira status null em vez de rejeição", async () => {
    const { port, close } = await withServer((_req, res) => res.end("ok"))
    await close()
    const out = await httpJson({ port, method: "GET", path: "/version", timeoutMs: 500 })
    expect(out.status).toBeNull()
  })
})

// ── 6. O fluxo inteiro, com docker e API dublados ────────────────────────

/** Um Gitea de mentira: guarda os status por commit e aplica a MESMA regra. */
function fakeGitea({ startEnforced = true } = {}) {
  const state = {
    enforced: startEnforced,
    contexts: [] as string[],
    statuses: new Map<string, Map<string, string>>(),
    prs: 0,
    calls: [] as string[],
  }
  const json = (status: number, data: unknown) => ({
    status,
    data,
    text: JSON.stringify(data),
  })
  const request = async ({ method, path, body }: any) => {
    state.calls.push(`${method} ${path}`)
    if (path === "/version") return json(200, { version: "1.22.6" })
    if (path === "/user/repos") return json(201, { name: REPO_NAME })
    if (path === `/repos/${REPO}/branch_protections`) {
      if (method === "GET")
        return json(200, [
          {
            branch_name: "main",
            status_check_contexts: state.contexts,
            enable_status_check: state.enforced,
          },
        ])
      state.enforced = body?.enable_status_check === true
      state.contexts = body?.status_check_contexts ?? state.contexts
      return json(201, { enable_status_check: state.enforced })
    }
    if (path === `/repos/${REPO}/branch_protections/main`) {
      state.enforced = body?.enable_status_check === true
      if (body?.status_check_contexts) state.contexts = body.status_check_contexts
      return json(200, { enable_status_check: state.enforced })
    }
    if (path === `/repos/${REPO}/branches`) return json(201, {})
    if (path.startsWith(`/repos/${REPO}/contents/`)) return json(201, {})
    if (path === `/repos/${REPO}/pulls` && method === "POST") {
      state.prs += 1
      state.statuses.set(`sha-${state.prs}`, new Map())
      return json(201, { number: state.prs, head: { sha: `sha-${state.prs}` } })
    }
    const pull = /^\/repos\/[^/]+\/[^/]+\/pulls\/(\d+)$/.exec(path)
    if (pull && method === "GET") return json(200, { mergeable: true })
    const merge = /^\/repos\/[^/]+\/[^/]+\/pulls\/(\d+)\/merge$/.exec(path)
    if (merge) {
      const posted = state.statuses.get(`sha-${merge[1]}`) ?? new Map()
      const incomplete = state.contexts.filter((c) => posted.get(c) !== "success")
      // A REGRA da forja: só bloqueia com a exigência LIGADA.
      if (state.enforced && incomplete.length > 0) {
        return {
          status: 405,
          data: null,
          text: '{"message":"not allowed to merge [reason: Not all required status checks successful]"}',
        }
      }
      return json(200, { merged: true })
    }
    const status = /^\/repos\/[^/]+\/[^/]+\/statuses\/(.+)$/.exec(path)
    if (status) {
      state.statuses.get(status[1])?.set(body.context, body.state)
      return json(201, {})
    }
    return json(404, { message: `nao mapeado: ${method} ${path}` })
  }
  return { request, state }
}

/** docker + CLI do Gitea dublados. O `--apply` do applier é quem configura. */
function fakeDocker({
  applyStatus = 0,
  checkInSync = 0,
  checkDisabledStatus = 1,
  checkDisabledOutput = "! enable_status_check=false — os contextos estão registrados e NÃO bloqueiam",
  gitea = fakeGitea(),
  // O que a proteção passa a REGISTRAR depois do `--apply`. É o knob que simula
  // a regressão que a prova existe para pegar: um applier que registra menos.
  appliedContexts = CONTEXTS,
} = {}) {
  const calls: string[][] = []
  const run = (_cmd: string, args: string[]) => {
    calls.push(args)
    return { status: 0, stdout: "container-id\n", stderr: "" }
  }
  const spawn = (_cmd: string, args: string[]) => {
    calls.push(args)
    if (args[0] === "exec" && args.includes("generate-access-token")) {
      return {
        status: 0,
        stdout: `Access token was successfully created: ${"b".repeat(40)}\n`,
        stderr: "",
      }
    }
    if (args[0] === "exec") return { status: 0, stdout: "New user created\n", stderr: "" }
    // O APLIADOR REAL seria o binário; aqui ele é o efeito: aplicar = configurar.
    if (args.some((a) => a.endsWith("apply-required-checks.mjs"))) {
      if (args.includes("--apply")) {
        if (applyStatus === 0) {
          gitea.state.contexts = appliedContexts
          gitea.state.enforced = true
        }
        return {
          status: applyStatus,
          stdout: "gitea main: → aplicado (contextos + enable_status_check)\n",
          stderr: "",
        }
      }
      const enforcementOff = gitea.state.enforced !== true
      return {
        status: enforcementOff ? checkDisabledStatus : checkInSync,
        stdout: enforcementOff ? checkDisabledOutput : "gitea main: já em sincronia\n",
        stderr: "",
      }
    }
    return { status: 1, stdout: "", stderr: "inesperado" }
  }
  return { run, spawn, calls, gitea }
}

const fastOptions = { sleepMs: () => Promise.resolve(), timeoutS: 4, keep: true }

describe("proveGiteaMergeGate — fluxo com docker e API dublados", () => {
  it("PROVEN: verde mergeia, vermelho e ausente não, e a exigência desligada volta a mergear", async () => {
    const { run, spawn, gitea } = fakeDocker()
    const result = await proveGiteaMergeGate({
      ...fastOptions,
      run,
      spawn,
      request: gitea.request,
    })
    expect(result.verdict).toBe("proven")
    expect(result.contexts).toEqual(CONTEXTS)
    expect(result.enforcement).toMatchObject({ enabled: true })
    expect(result.cases.map((c: any) => [c.id, c.outcome.state])).toEqual([
      ["controle-verde", "merged"],
      ["gate-vermelho", "blocked"],
      ["gate-ausente", "blocked"],
      ["exigencia-desligada", "merged"],
    ])
    expect(result.applier).toMatchObject({
      applied: true,
      checkInSync: true,
      checkSeesDisabled: true,
    })
    // E o registro foi CONFERIDO, não só lido: 7/7, sem contagem.
    expect(result.registration).toEqual({ ok: true, missing: [], extra: [], withCount: [] })
    expect(result.enforcement).toEqual({ enabled: true, contexts: CONTEXTS })
  })

  it("REGRESSÃO: applier que registra um SUBCONJUNTO sai VIOLADO, nomeando o que ficou fora", async () => {
    const { run, spawn, gitea } = fakeDocker({ appliedContexts: CONTEXTS.slice(0, -1) })
    const result = await proveGiteaMergeGate({
      ...fastOptions,
      run,
      spawn,
      request: gitea.request,
    })
    expect(result.verdict).toBe("violated")
    expect(result.blockers.join(" ")).toContain("NAO registrou 1 contexto(s) do manifesto")
    expect(result.blockers.join(" ")).toContain("'Build'")
    expect(result.registration).toMatchObject({ ok: false, missing: ["Build"] })
    expect(result.detail).toContain("o registro nao bate com o manifesto")
    expect(result.cases).toEqual([]) // a matriz nem chega a rodar
  })

  it("REGRESSÃO: proteção registrada com CONTAGEM sai VIOLADA (o nome muda sozinho)", async () => {
    const velho = "Mutation guards master (24 node-pure mutation tests)"
    const { run, spawn, gitea } = fakeDocker({ appliedContexts: [...CONTEXTS, velho] })
    const result = await proveGiteaMergeGate({
      ...fastOptions,
      run,
      spawn,
      request: gitea.request,
    })
    expect(result.verdict).toBe("violated")
    expect(result.blockers.join(" ")).toContain("carrega CONTAGEM")
    expect(result.blockers.join(" ")).toContain(velho)
    expect(result.registration?.withCount).toEqual([
      { context: velho, count: "(24 node-pure mutation tests)" },
    ])
  })

  it("REGRESSÃO: applier que não liga a exigência sai VIOLADO (não 'indeterminado')", async () => {
    const gitea = fakeGitea({ startEnforced: false })
    const { run, spawn } = fakeDocker({ gitea })
    // o "applier" dublê recria a proteção com o booleano DESLIGADO
    const spawnWithoutEnforcement = (cmd: string, args: string[]) => {
      const res = spawn(cmd, args)
      if (args.includes("--apply")) gitea.state.enforced = false
      return res
    }
    const result = await proveGiteaMergeGate({
      ...fastOptions,
      run,
      spawn: spawnWithoutEnforcement,
      request: gitea.request,
    })
    expect(result.verdict).toBe("violated")
    expect(result.blockers.join(" ")).toContain("enable_status_check")
    expect(result.cases).toEqual([]) // a matriz nem chega a rodar
  })

  it("o --check do applier que não vê a exigência desligada reprova a prova", async () => {
    const { run, spawn, gitea } = fakeDocker({ checkDisabledOutput: "gitea main: já em sincronia" })
    const result = await proveGiteaMergeGate({
      ...fastOptions,
      run,
      spawn,
      request: gitea.request,
    })
    expect(result.verdict).toBe("violated")
    expect(result.blockers.join(" ")).toContain("modo silencioso passa pelo detector")
  })

  it("container que não sobe é INDETERMINADO, com o motivo", async () => {
    const { spawn, gitea } = fakeDocker()
    const result = await proveGiteaMergeGate({
      ...fastOptions,
      run: () => ({ status: 125, stdout: "", stderr: "Conflict: name already in use" }),
      spawn,
      request: gitea.request,
    })
    expect(result.verdict).toBe("unavailable")
    expect(result.detail).toContain("nao subiu")
    expect(result.cases).toEqual([])
  })

  it("API que nunca responde é INDETERMINADO — nunca silêncio verde", async () => {
    const { run, spawn } = fakeDocker()
    const result = await proveGiteaMergeGate({
      ...fastOptions,
      run,
      spawn,
      request: async () => ({ status: null, data: null, text: "timeout" }),
    })
    expect(result.verdict).toBe("unavailable")
    expect(result.detail).toContain("nao subiu")
  })
})
