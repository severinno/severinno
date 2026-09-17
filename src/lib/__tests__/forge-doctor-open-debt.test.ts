import { readdirSync } from "node:fs"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { describe, expect, it } from "vitest"

import {
  DEBT_EXCLUDED,
  DEBT_SUBJECTS,
  openDebtUnknowns,
  parseArgs,
  readOpenDebt,
  recursionGuardFacts,
  renderReport,
  summarize,
  VERDICT,
} from "../../../scripts/forge-doctor.mjs"

/**
 * A DÍVIDA ABERTA NO BOARD — o fato que faz uma issue de drift esquecida
 * aparecer na PRONTIDÃO em vez de viver só no board.
 *
 * Três camadas, e cada uma cobre o que a outra não vê:
 *   1. o REGISTRO (quais labels o doctor lê) contra os publicadores reais —
 *      uma label nova/renomeada não pode nascer invisível;
 *   2. a LEITURA (`readOpenDebt`) com a `list` dublada — estados, idade,
 *      marcador, e o cruzamento com o que o doctor mede agora (caducidade);
 *   3. o PESO no veredito e o que aparece na seção 6/7 do relatório.
 */

const REPO_ROOT = resolve(__dirname, "..", "..", "..")
const SCRIPTS = join(REPO_ROOT, "scripts")
const NOW = Date.parse("2026-09-13T00:00:00Z")

// ── 1. O REGISTRO (fonte única com os publicadores) ───────────────────────

/**
 * Todo `scripts/*-issue.mjs` é um PUBLICADOR (abre issue por cron) e por isso a
 * sua label é dívida que o doctor tem de enxergar — ou uma exclusão declarada.
 *
 * O teste varre o diretório em vez de listar os quatro conhecidos: um publicador
 * NOVO (ou uma label renomeada) falha aqui sem ninguém lembrar de vir até este
 * arquivo. É a mesma disciplina que o repositório usa para os gates de CI.
 */
async function publishers() {
  const files = readdirSync(SCRIPTS)
    .filter((f) => f.endsWith("-issue.mjs"))
    .sort()
  return Promise.all(
    files.map(async (file) => {
      const mod = (await import(pathToFileURL(join(SCRIPTS, file)).href)) as Record<string, unknown>
      return {
        file,
        label: mod.ISSUE_LABEL as string,
        // O marcador de cada publicador tem um nome próprio (`DRIFT_MARKER_ID`,
        // `ACTRC_MARKER_ID`...): aqui basta que o id usado pelo doctor esteja
        // entre as constantes exportadas — assim renomear o marcador de lá e
        // deixar o registro para trás falha.
        markerIds: Object.values(mod).filter((v): v is string => typeof v === "string"),
      }
    }),
  )
}

describe("o REGISTRO da dívida é o dos publicadores (fonte única)", () => {
  it("cada publicador está no registro — ou numa exclusão com razão escrita", async () => {
    const found = await publishers()
    expect(found.length).toBeGreaterThan(3)
    const known = new Set([...DEBT_SUBJECTS.map((s) => s.label), DEBT_EXCLUDED.label])
    for (const pub of found) {
      expect(pub.label, `${pub.file} não exporta ISSUE_LABEL`).toBeTruthy()
      expect(
        known.has(pub.label),
        `${pub.file}: a label '${pub.label}' não é lida pelo doctor nem declarada em DEBT_EXCLUDED — a dívida desse cron nasce invisível para a prontidão`,
      ).toBe(true)
    }
  })

  it("o marcador de cada assunto é o do publicador (ler a label não basta)", async () => {
    const found = await publishers()
    for (const subject of DEBT_SUBJECTS) {
      const pub = found.find((p) => p.label === subject.label)
      expect(pub, `nenhum publicador usa a label '${subject.label}'`).toBeTruthy()
      expect(pub?.markerIds).toContain(subject.markerId)
    }
  })

  it("a exclusão é a do PRÓPRIO doctor, e tem razão escrita", async () => {
    const found = await publishers()
    const own = found.find((p) => p.file === "forge-doctor-issue.mjs")
    expect(DEBT_EXCLUDED.label).toBe(own?.label)
    expect(DEBT_EXCLUDED.why.length).toBeGreaterThan(40)
  })

  it("todo assunto diz ONDE a label existe e como cruzar com o que o doctor mede", () => {
    for (const subject of DEBT_SUBJECTS) {
      expect(subject.forges.length).toBeGreaterThan(0)
      expect(subject.subject.length).toBeGreaterThan(10)
      expect([null, "protection", "mirrors", "declaredDebt"]).toContain(subject.crossCheck)
    }
  })
})

// ── 2. A LEITURA ──────────────────────────────────────────────────────────

/** Uma issue como o backend a entrega (o marcador no corpo). */
function issue(number: number, body: string, createdAt: string | null = "2026-09-12T00:00:00Z") {
  return { number, title: `issue ${number}`, body, comments: [], createdAt }
}

/** A `list` dublê: um mapa label → issues, e o registro do que foi perguntado. */
function listStub(byLabel: Record<string, unknown[]> = {}) {
  const asked: string[] = []
  const list = async ({ forge, label }: { forge: string; label: string }) => {
    asked.push(`${forge}:${label}`)
    return byLabel[label] ?? []
  }
  return { list, asked }
}

describe("readOpenDebt — a leitura do board", () => {
  it("nenhuma issue aberta → clear, e a leitura pergunta SÓ as labels daquela forja", async () => {
    const stub = listStub()
    const debt = await readOpenDebt({ deps: { list: stub.list, now: () => NOW } })
    expect(debt.state).toBe("clear")
    expect(debt.items).toEqual([])
    expect(openDebtUnknowns(debt)).toEqual([])
    // A label que NÃO existe na forja não é perguntada: perguntá-la devolveria
    // vazio, e o vazio passaria por "sem dívida" num board que nunca foi lido.
    expect(stub.asked.sort()).toEqual(
      [
        "gitea:env-mirror-drift",
        "gitea:required-checks-drift",
        "github:actrc-sync-drift",
        "github:crlf-scope-drift",
        "github:declared-debt-review",
        "github:guard-timing-regression",
        "github:mutation-trend-drift",
        "github:readme-drift",
        "github:required-checks-drift",
      ].sort(),
    )
  })

  it("issue ABERTA com o marcador → open, com número e IDADE em dias", async () => {
    const stub = listStub({
      "readme-drift": [issue(12, "<!-- readme-drift:file:slug -->", "2026-08-01T00:00:00Z")],
    })
    const debt = await readOpenDebt({ deps: { list: stub.list, now: () => NOW } })
    expect(debt.state).toBe("open")
    const item = debt.items[0] as {
      open: number
      ours: number
      issues: { days: number }[]
      detail: string
    }
    expect(item.open).toBe(1)
    expect(item.issues[0].days).toBe(43)
    expect(item.detail).toContain("#12")
    expect(item.detail).toContain("43 dia(s)")
    expect(openDebtUnknowns(debt)).toHaveLength(1)
  })

  it("sem a data de abertura → idade DESCONHECIDA (nunca 0, que se confundiria com hoje)", async () => {
    const stub = listStub({ "readme-drift": [issue(12, "<!-- readme-drift:x -->", null)] })
    const debt = await readOpenDebt({ deps: { list: stub.list, now: () => NOW } })
    const item = debt.items[0] as { issues: { days: number | null }[]; detail: string }
    expect(item.issues[0].days).toBeNull()
    expect(item.detail).not.toContain("há 0 dia")
  })

  it("issue com a label e SEM o marcador → é dívida, mas NÃO é nossa (um automatismo não a fecha)", async () => {
    const stub = listStub({ "readme-drift": [issue(12, "corpo sem marcador")] })
    const debt = await readOpenDebt({ deps: { list: stub.list, now: () => NOW } })
    const item = debt.items[0] as { ours: number; foreign: number; detail: string }
    expect(item.ours).toBe(0)
    expect(item.foreign).toBe(1)
    expect(item.detail).toContain("SEM o marcador do publicador")
    // E continua aparecendo no veredito: alguém pôs aquele label ali.
    expect(openDebtUnknowns(debt)).toHaveLength(1)
  })

  it("a label de UM publicador não engole a issue do outro (o marcador manda)", async () => {
    const stub = listStub({
      "readme-drift": [issue(12, "<!-- mutation-trend-drift:QUJD -->")],
    })
    const debt = await readOpenDebt({ deps: { list: stub.list, now: () => NOW } })
    const item = debt.items[0] as { ours: number; foreign: number }
    expect(item.ours).toBe(0)
    expect(item.foreign).toBe(1)
  })

  it('forja ILEGÍVEL → unavailable, e o unknown diz o porquê (nunca "sem dívida")', async () => {
    const list = async () => {
      throw new Error("gh issue list falhou (exit 4):\n  gh auth login")
    }
    const debt = await readOpenDebt({ deps: { list, now: () => NOW } })
    expect(debt.state).toBe("unavailable")
    const unknowns = openDebtUnknowns(debt)
    expect(unknowns).toHaveLength(2)
    expect(unknowns.join(" ")).toContain("NÃO foi lida")
    // A mensagem do erro vem com quebra de linha; o relatório é lido em terminal
    // e colado em issue, então ela tem de sair numa linha só.
    expect(unknowns.join(" ")).not.toContain("\n")
  })

  it("uma forja lida e a outra não → partial (a leitura parcial não passa por completa)", async () => {
    const list = async ({ forge }: { forge: string }) => {
      if (forge === "github") throw new Error("sem `gh` autenticado")
      return []
    }
    const debt = await readOpenDebt({ deps: { list, now: () => NOW } })
    expect(debt.state).toBe("partial")
    expect(debt.detail).toContain("NÃO lida")
  })
})

// ── 3. A CADUCIDADE (o cruzamento com o que o doctor mede AGORA) ───────────

const DRIFT_ISSUE = { "required-checks-drift": [issue(7, "<!-- required-checks-drift:QUJD -->")] }
const MIRROR_ISSUE = { "actrc-sync-drift": [issue(9, "<!-- actrc-sync-drift:QUJD -->")] }
const DEBT_REVIEW_ISSUE = {
  "declared-debt-review": [issue(21, "<!-- declared-debt-review:QUJD -->")],
}

describe("readOpenDebt — a issue velha não passa por problema vivo", () => {
  it("proteção EM SINCRONIA agora + issue de drift aberta → caducada", async () => {
    const stub = listStub(DRIFT_ISSUE)
    const debt = await readOpenDebt({
      deps: { list: stub.list, now: () => NOW },
      protection: { forges: [{ forge: "gitea", state: "in-sync" }] },
    })
    const item = debt.items[0] as { stale: boolean | null; detail: string }
    expect(item.stale).toBe(true)
    expect(item.detail).toContain("Parece CADUCADA")
  })

  it("proteção em DRIFT agora → a issue fala de um problema VIVO", async () => {
    const stub = listStub(DRIFT_ISSUE)
    const debt = await readOpenDebt({
      deps: { list: stub.list, now: () => NOW },
      protection: { forges: [{ forge: "gitea", state: "drift" }] },
    })
    const item = debt.items[0] as { stale: boolean | null; detail: string }
    expect(item.stale).toBe(false)
    expect(item.detail).toContain("VIVO")
  })

  it('proteção não lida nesta run → caducidade NÃO verificada (e não "caducou")', async () => {
    const stub = listStub(DRIFT_ISSUE)
    const debt = await readOpenDebt({ deps: { list: stub.list, now: () => NOW }, protection: null })
    const item = debt.items[0] as { stale: boolean | null; detail: string }
    expect(item.stale).toBeNull()
    expect(item.detail).toContain("Caducidade NÃO verificada")
  })

  it("espelhos limpos COM o valor comparado → caducada; sem --expected → não verificada", async () => {
    const stub = listStub(MIRROR_ISSUE)
    const clean = await readOpenDebt({
      deps: { list: stub.list, now: () => NOW },
      mirrors: { expected: "1.3.14", blockers: [], unknowns: [] },
    })
    expect((clean.items[0] as { stale: boolean | null }).stale).toBe(true)

    const noValue = await readOpenDebt({
      deps: { list: stub.list, now: () => NOW },
      mirrors: { expected: null, blockers: [], unknowns: [] },
    })
    expect((noValue.items[0] as { stale: boolean | null }).stale).toBeNull()

    const dirty = await readOpenDebt({
      deps: { list: stub.list, now: () => NOW },
      mirrors: { expected: "1.3.14", blockers: ["divergiu"], unknowns: [] },
    })
    expect((dirty.items[0] as { stale: boolean | null }).stale).toBe(false)
  })

  it("assunto que só o publicador vê → caducidade não pode ser declarada daqui", async () => {
    const stub = listStub({ "readme-drift": [issue(12, "<!-- readme-drift:x -->")] })
    const debt = await readOpenDebt({ deps: { list: stub.list, now: () => NOW } })
    const item = debt.items[0] as { stale: boolean | null; detail: string }
    expect(item.stale).toBeNull()
    expect(item.detail).toContain("não é medido pelo doctor")
  })

  it("isenções DENTRO da janela + issue aberta → caducada; alguma vencida → VIVA", async () => {
    const stub = listStub(DEBT_REVIEW_ISSUE)
    const limpo = await readOpenDebt({
      deps: { list: stub.list, now: () => NOW },
      declaredDebt: { state: "proven", sources: [{}, {}], aged: [], invalid: [], total: 4 },
    })
    const caduca = limpo.items[0] as { stale: boolean | null; detail: string }
    expect(caduca.stale).toBe(true)
    expect(caduca.detail).toContain("MESMAS isenções")

    const vencido = await readOpenDebt({
      deps: { list: stub.list, now: () => NOW },
      declaredDebt: {
        state: "aged",
        sources: [{}],
        aged: [{ id: "a", days: 200 }],
        invalid: [],
        total: 4,
      },
    })
    const viva = vencido.items[0] as { stale: boolean | null; detail: string }
    expect(viva.stale).toBe(false)
    expect(viva.detail).toContain("VIVO")
  })

  it('isenções NÃO medidas nesta run → caducidade NÃO verificada (nunca "caducou")', async () => {
    const stub = listStub(DEBT_REVIEW_ISSUE)
    // Três caminhos, e os três têm de responder `null`: o fato ausente, o
    // pulado por flag, e o `unread` (uma lista que não pôde ser lida). Dizer
    // "caducou" em qualquer um deles seria a dívida que mente, do outro lado.
    for (const declaredDebt of [
      null,
      { state: "skipped", sources: [], aged: [], invalid: [], total: 0 },
      { state: "unread", sources: [], aged: [], invalid: [], total: 0 },
    ]) {
      const debt = await readOpenDebt({
        deps: { list: stub.list, now: () => NOW },
        declaredDebt,
      })
      const item = debt.items[0] as { stale: boolean | null; detail: string }
      expect(item.stale, `declaredDebt=${JSON.stringify(declaredDebt)}`).toBeNull()
      expect(item.detail).toContain("não foi medida nesta run")
    }
  })
})

// ── 4. O PESO NO VEREDITO e o relatório ───────────────────────────────────

/** O mínimo que o `summarize`/`renderReport` leem (o resto tem os seus testes). */
function baseFacts() {
  return {
    contract: { forges: [] as unknown[], failures: [] as string[], unknown: null as string | null },
    guards: { results: [], error: null },
    image: { code: 0, state: "present", ref: null, lines: [] },
    proof: { status: "holds", cases: [] },
    mirrors: { expected: "1.3.14", blockers: [], unknowns: [], mirrors: [], warnings: [] },
    protection: { state: "in-sync", detail: "em sincronia", forges: [] },
    // O guard de recursão armado — o `summarize` também o lê (existência da
    // defesa, e não só o disparo dela): sem o fato, o veredito fica
    // INDETERMINADA, e a fixture diria que "o mínimo" era menor do que é.
    nestedGuard: recursionGuardFacts(),
    // A idade das isenções: o `summarize` também a lê (a isenção vencida não
    // deixa o veredito PRONTA), e a leitura do board a usa como SEGUNDA
    // TESTEMUNHA — sem o fato, a fixture não seria "o mínimo" que o doctor lê.
    declaredDebt: {
      state: "proven",
      sources: [
        {
          id: "out-of-scope",
          listName: "OUT_OF_SCOPE_ALLOWLIST",
          owner: "scripts/check-registry-source.mjs",
          state: "proven",
          total: 1,
          reviewDays: 180,
          aged: [],
          invalid: [],
          oldest: { id: "docs/quality/x.md", addedAt: "2026-08-01", days: 43 },
          detail: "scripts/check-registry-source.mjs: 1 decisão(ões) na OUT_OF_SCOPE_ALLOWLIST",
        },
      ],
      aged: [],
      invalid: [],
      unread: [],
      total: 1,
    }, // A herança de shell dos workflows: presente e LIMPA. Ausente, o fato vira
    // dúvida ("não está declarada no relatório") — e a fixture que se diz "o
    // mínimo que o summarize lê" tem de carregar tudo o que ele lê. O próprio
    // fato tem testes em `forge-doctor.test.ts`.
    shellInheritance: {
      state: "proven",
      workflows: [],
      totals: {
        workflows: 0,
        steps: 0,
        noPasso: 0,
        porDefaultDoJob: 0,
        porDefaultDoArquivo: 0,
        peloRunner: 0,
        comPipefail: 0,
        premissas: 0,
        ilegiveis: 0,
        unread: 0,
      },
      violations: [],
      detail: "0 workflow(s) de forja neste checkout",
      error: null,
    },
    // A prova do bloqueio LOCAL (o pre-commit × o corpo `run:` quebrado):
    // presente e PROVADA. Ausente, o fato vira dúvida — a mesma disciplina da
    // herança de shell acima, e a razão de a fixture "o mínimo que o summarize
    // lê" carregar tudo o que ele lê. O próprio fato tem testes em
    // `forge-doctor.test.ts`.
    preCommitBlock: {
      state: "proven",
      detail: "um 'git commit' com o corpo quebrado é recusado e o controle entra",
      evidence: null,
      remedies: [],
    },
    openDebt: {
      state: "clear",
      detail: "sem dívida",
      reads: [],
      items: [],
      labels: [],
      excluded: DEBT_EXCLUDED,
    },
  }
}

const OPEN_DEBT = {
  state: "open",
  detail: "1 assunto(s) com dívida ABERTA no board",
  labels: DEBT_SUBJECTS.map((s) => s.label),
  excluded: DEBT_EXCLUDED,
  reads: [
    {
      forge: "github",
      labels: ["readme-drift"],
      state: "read",
      open: 1,
      foreign: 0,
      detail: "1 dívida(s) ABERTA(S)",
    },
  ],
  items: [
    {
      forge: "github",
      label: "readme-drift",
      subject: "a auditoria reversa do README achou um alvo morto",
      open: 1,
      ours: 1,
      foreign: 0,
      issues: [{ number: 12, title: "Alvo morto", days: 43 }],
      stale: null,
      staleDetail: "o assunto não é medido pelo doctor",
      detail: "1 dívida(s) ABERTA(S) no github com a label 'readme-drift' — #12 (há 43 dia(s))",
    },
  ],
}

describe("summarize — a dívida do board nunca bloqueia, mas nunca vira PRONTA", () => {
  it("board limpo não muda o veredito (o caminho verde existe)", () => {
    expect(summarize(baseFacts() as never).verdict).toBe(VERDICT.READY)
  })

  it("dívida ABERTA → INDETERMINADA, com zero bloqueios", () => {
    const v = summarize({ ...baseFacts(), openDebt: OPEN_DEBT } as never)
    expect(v.verdict).toBe(VERDICT.UNKNOWN)
    expect(v.blockers).toEqual([])
    expect(v.unknowns.join(" ")).toContain("#12")
  })

  it("um bloqueio REAL continua BLOQUEADO (a dívida não esconde a violação)", () => {
    const facts = baseFacts()
    facts.contract.failures = ["o manifesto aponta para um job que não existe"]
    const v = summarize({ ...facts, openDebt: OPEN_DEBT } as never)
    expect(v.verdict).toBe(VERDICT.BLOCKED)
    expect(v.unknowns.join(" ")).toContain("readme-drift")
  })

  it('forja ilegível entra como NÃO PROVADO, e o skip entra no "NÃO CUBRE"', () => {
    const unread = {
      ...baseFacts(),
      openDebt: {
        ...OPEN_DEBT,
        state: "unavailable",
        items: [],
        reads: [
          {
            forge: "gitea",
            state: "unread",
            detail: "a dívida aberta no gitea NÃO foi lida: sem token",
          },
        ],
      },
    }
    expect(summarize(unread as never).unknowns.join(" ")).toContain("sem token")

    const skipped = summarize({
      ...baseFacts(),
      openDebt: { state: "skipped", reads: [], items: [] },
      skippedOpenDebt: true,
    } as never)
    expect(skipped.verdict).toBe(VERDICT.UNKNOWN)
    expect(skipped.unknowns.join(" ")).toContain("--no-open-debt")
    expect(skipped.unproven.join(" ")).toContain("dívida aberta no board")
  })

  it("o CLI tem a flag do offline", () => {
    expect((parseArgs([]) as { openDebt: boolean }).openDebt).toBe(true)
    expect((parseArgs(["--no-open-debt"]) as { openDebt: boolean }).openDebt).toBe(false)
  })
})

describe("renderReport — a dívida tem seção própria", () => {
  function report(facts: object) {
    const lines: string[] = []
    renderReport(
      { facts, verdict: summarize(facts as never) },
      { emit: (s: string) => lines.push(s) },
    )
    return lines.join("\n")
  }

  it("a seção 6/7 nomeia as labels, a exclusão, a issue e a IDADE", () => {
    const out = report({ ...baseFacts(), openDebt: OPEN_DEBT })
    expect(out).toContain("6/7  Dívida conhecida (DECLARADA no repositório × ABERTA no board)")
    expect(out).toContain(DEBT_SUBJECTS.map((s) => s.label).join(", "))
    expect(out).toContain(DEBT_EXCLUDED.label)
    expect(out).toContain("#12")
    expect(out).toContain("aberta há 43 dia(s)")
  })

  it("as OUTRAS seções continuam numeradas contra o MESMO total", () => {
    // O denominador é UM só para o relatório inteiro: uma seção nova (a herança
    // de shell, a 7ª) que não entrasse na conta deixaria as outras seis dizendo
    // "/6" para um relatório de sete — e o leitor contaria as seções para
    // descobrir qual está mentindo.
    const out = report({ ...baseFacts(), openDebt: OPEN_DEBT })
    for (const n of [1, 2, 3, 4, 5, 6, 7]) expect(out).toContain(`  ${n}/7  `)
  })

  it("--no-open-debt aparece dito, em vez de a seção sumir calada", () => {
    const out = report({
      ...baseFacts(),
      openDebt: {
        state: "skipped",
        reads: [],
        items: [],
        labels: DEBT_SUBJECTS.map((s) => s.label),
        excluded: DEBT_EXCLUDED,
      },
      skippedOpenDebt: true,
    })
    expect(out).toContain("pulada por --no-open-debt")
  })
})
