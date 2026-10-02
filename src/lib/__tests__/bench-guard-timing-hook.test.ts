/**
 * bench-guard-timing-hook.test.ts
 *
 * Trava o CONTRATO da família `hook` do `bench-guard-timing.mjs`: o custo que a
 * OFERTA de remendo acrescentou ao caminho de cada commit, nos dois caminhos —
 * o comum (nada reprova) e o de falha (defeito mecânico no índice).
 *
 * O QUE ESTE TESTE PROTEGE (e o que o número versionado passa a afirmar):
 *   1. o CONTRAFACTUAL é uma transformação do PRÓPRIO hook, ancorada no texto
 *      dele — `sem-oferta` remove o bloco da oferta e MANTÉM o veredito (a fase
 *      reprovada segue bloqueando, com o mesmo exit), e `wait agregado` muda só a
 *      ESTRUTURA da espera (o mesmo conjunto de PIDs). Sem as âncoras, a medição
 *      se declara NÃO MEDIDA em vez de comparar o hook com ele mesmo;
 *   2. as formas são medidas por EXECUÇÃO num repositório git de verdade, com o
 *      hook REAL e o fixture da prova (binários das fases dublados, remédio real):
 *      o caminho comum passa e o de falha BLOQUEIA;
 *   3. o não-zero do caminho de falha é do DEFEITO, não de um fixture quebrado —
 *      o remédio roda de fato ("SEM TERMINAL"), nunca um "module not found"; e a
 *      REVALIDAÇÃO é observável na saída (o veredito do gate dono aparece duas
 *      vezes: a medição e a re-execução);
 *   4. a comparação casa as formas por PAPEL (o caminho do commit), não por
 *      posição na lista, e uma forma que regride é regressão;
 *   5. `--no-hook` torna o veredito PARCIAL (a família da baseline não medida é
 *      NOMEADA) e a família herdada sai dele;
 *   6. o contrato da família acusa: forma do caminho comum que não passa, oferta
 *      sendo paga com as duas fases verdes, e medição que ESCREVEU no repositório.
 *
 * Execução focada:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/bench-guard-timing-hook.test.ts
 */

import { describe, expect, it } from "vitest"

import {
  ESPERA_AGREGADA,
  ESPERA_SINTAXE,
  HOOK_FORMS,
  HOOK_RUIDO_MS,
  LATEST_FILE,
  OFERTA_FIM,
  OFERTA_INICIO,
  REUSED_FAMILY_LABELS,
  compareTimings,
  hookCostViolations,
  hookSemOferta,
  hookWaitAgregada,
  hookWhatItAdded,
  linhaDaEsperaA,
  measureHookCost,
  reuseFamilies,
  vereditoDaDeteccao,
} from "../../../scripts/bench-guard-timing.mjs"
import {
  REMEDY,
  REMEDY_STUB_ENV,
  WORKFLOW,
  WORKFLOW_CICATRIZ,
  WORKFLOW_VALIDO,
  hookSource,
  novoRepo,
} from "../../../scripts/pre-commit-proof.mjs"
import {
  COMPLETOU,
  cleanupFixtures,
  runSourcedHook,
  shellParses,
  stage,
} from "../../../scripts/hook-simulator.mjs"

type Forma = {
  role: string
  path: string
  ms: number
  exit: number | null
  ok: boolean
  bloqueou: boolean
  runs: { ms: number; exit: number | null }[]
}

type HookCost = {
  measured: boolean
  reason: string | null
  forms: Forma[]
  deltas: {
    ofertaComumMs: number | null
    esperaMs: number | null
    ofertaFalhaMs: number | null
    revalidacaoMs: number | null
  } | null
  detection: {
    cmd: string
    ms: number
    exit: number | null
    completou: boolean
    medido: boolean
    escreveu: boolean | null
    veredito: string
  } | null
  violations: string[]
  whatItAdded: string[]
}

/** O hook versionado. Ausente é falha ALTA: o teste mediria o vazio. */
const fonte = (): string => {
  const texto = hookSource()
  if (texto === null) throw new Error(".husky/pre-commit não existe neste checkout")
  return texto as string
}

const medir = (opts: { samples?: number; fonte?: string | null } = {}): HookCost =>
  measureHookCost(opts as never) as unknown as HookCost

// ── 1. Os contrafactuais: transformação ANCORADA no texto do hook ──────────

describe("bench-guard-timing — os contrafactuais do hook", () => {
  it("`sem-oferta` tira a oferta INTEIRA (remédio e revalidação) e mantém o veredito", () => {
    const hook = fonte()
    const sem = hookSemOferta(hook) as string

    expect(sem).not.toBeNull()
    // A oferta saiu: nenhuma chamada ao remédio e nenhuma re-execução.
    expect(sem).not.toContain(`node scripts/${REMEDY}`)
    expect(sem).not.toContain(OFERTA_INICIO)
    // ...e o VEREDITO ficou, com os MESMOS exits: o hook continua bloqueando o
    // commit defeituoso. Um contrafactual que deixasse passar mediria outro hook.
    // A fase A entra na corrente desde que a oferta passou a cobri-la: o hook real
    // encerra com o veredito DELA primeiro, e o contrafactual tem de fazer o mesmo.
    expect(sem).toContain('exit "$FASE_A"')
    expect(sem).toContain('exit "$SINTAXE"')
    expect(sem).toContain('exit "$FASE_B"')
    // O que vem DEPOIS da oferta (a fase sequencial) não foi tocado.
    expect(sem.slice(sem.indexOf(OFERTA_FIM))).toBe(hook.slice(hook.indexOf(OFERTA_FIM)))
    // A transformação mede o CUSTO do commit: se o texto não parseia, ela mediria
    // o parsing.
    expect(shellParses(sem)).toBe(true)
  })

  it("`wait agregado` muda SÓ a estrutura da espera (o mesmo conjunto de PIDs)", () => {
    const hook = fonte()
    const agr = hookWaitAgregada(hook) as string
    // A linha do `wait_all` vive indentada DENTRO da função `fase_a` — a âncora
    // guarda a indentação (a transformação é textual) e a leitura normaliza.
    const linhaDoWait = (texto: string) =>
      texto.split("\n").find((l) => l.trimStart().startsWith("wait_all $PID_")) as string

    expect(agr).not.toBeNull()
    // A linha da espera da fase A sai do PRÓPRIO hook (`linhaDaEsperaA`), e não de
    // uma lista à mão: a lista envelheceu no dia em que a fase A ganhou um guard
    // (o `$PID_LINTSCOPE`), e a medição passou a se declarar NÃO MEDIDA em vez de
    // medir a espera errada. O que a agregação faz é DERIVADO daqui: a mesma linha
    // mais o PID do gate de sintaxe.
    const esperaA = linhaDaEsperaA(hook) as string
    expect(esperaA).not.toBeNull()
    expect(linhaDoWait(hook)).toBe(esperaA)
    expect(linhaDoWait(agr)).toBe(`${esperaA} $PID_RUNSYNTAX`)
    // A espera separada foi SUBSTITUÍDA: o gate de sintaxe passou a ser aguardado
    // pelo mesmo `wait_all` da fase A.
    expect(agr).not.toContain(ESPERA_SINTAXE)
    expect(agr).toContain(ESPERA_AGREGADA)
    // O conjunto aguardado é o MESMO + o gate de sintaxe (que antes era aguardado
    // na linha de baixo): nenhum PID da fase A é reescrito ou perdido. É isso que
    // faz o delta medir a ESTRUTURA da espera, e não outro trabalho.
    expect(
      linhaDoWait(agr)
        .match(/\$PID_[A-Z]+/g)
        ?.sort(),
    ).toEqual([...(esperaA.match(/\$PID_[A-Z]+/g) ?? []), "$PID_RUNSYNTAX"].sort())
    // Fora das duas âncoras, as duas formas são byte a byte o mesmo hook: uma
    // causa por delta.
    // A ordem importa: a linha AGREGADA CONTÉM a separada (o PID do gate entra no
    // MESMO `wait_all`), então a âncora maior tem de sair primeiro — ao contrário,
    // a menor substituiria o prefixo dela e sobraria o ` $PID_RUNSYNTAX` de fora,
    // como se as duas formas diferissem em mais do que a estrutura da espera.
    // Cada forma é normalizada pela SUA PRIMEIRA linha de espera — a da fase A
    // (uma âncora fixa para as duas tropeçaria no fato de a agregada CONTER a
    // separada como prefixo, e derivá-la forma a forma pararia de funcionar na
    // agregada, que já não carrega o bloco separado do gate). A espera da fase B
    // continua no texto: a comparação não esconde uma diferença lá.
    const normalizado = (texto: string) =>
      texto
        .replace(/^[ \t]*wait_all \$(?:PID_[A-Z]+)(?: \$(?:PID_[A-Z]+))*[ \t]*$/m, "@")
        .split(ESPERA_SINTAXE)
        .join("@")
        .split(ESPERA_AGREGADA)
        .join("@")
    expect(normalizado(agr)).toBe(normalizado(hook))
    expect(shellParses(agr)).toBe(true)
  })

  it("um texto SEM as âncoras se declara NÃO MEDIDO", () => {
    expect(hookSemOferta("#!/bin/sh\necho oi\n")).toBeNull()
    expect(hookWaitAgregada("#!/bin/sh\necho oi\n")).toBeNull()
  })

  it("a family se declara NÃO MEDIDA (com o motivo) quando o hook não tem as âncoras", () => {
    const res = medir({ samples: 1, fonte: "#!/bin/sh\necho oi\n" })

    expect(res.measured).toBe(false)
    expect(res.reason).toContain("âncoras")
    expect(res.forms).toEqual([])
    expect(res.deltas).toBeNull()
    expect(res.whatItAdded.join(" ")).toContain("NÃO MEDIDO")
  })
})

// ── 2. As formas, medidas por EXECUÇÃO (o fixture da prova do hook) ────────

describe("bench-guard-timing — as formas do hook medidas por execução", () => {
  it("o caminho comum passa e o de falha bloqueia (contrato das formas)", () => {
    const res = medir({ samples: 1 })

    expect(res.measured).toBe(true)
    expect(res.forms.length).toBe(HOOK_FORMS.length)
    for (const form of res.forms) expect(form.ok).toBe(true)

    for (const form of res.forms.filter((f) => f.path === "comum")) {
      expect(form.exit).toBe(0)
      expect(form.bloqueou).toBe(false)
    }
    for (const form of res.forms.filter((f) => f.path === "falha")) {
      expect(form.bloqueou).toBe(true)
    }
    // Os DELTAS são o dado da família: a oferta NÃO é paga no caminho comum, e é
    // paga quando há defeito.
    expect(typeof res.deltas?.ofertaComumMs).toBe("number")
    expect(res.deltas?.ofertaComumMs).toBeLessThanOrEqual(HOOK_RUIDO_MS)
    expect(typeof res.deltas?.ofertaFalhaMs).toBe("number")
    expect(res.violations).toEqual([])
    expect(res.whatItAdded.join("\n")).toContain("NÃO é alcançada")
  })

  it("o fixture roda o REMÉDIO de verdade e a REVALIDAÇÃO é observável na saída", () => {
    const hook = fonte()
    const dir = novoRepo()
    try {
      stage(dir, WORKFLOW, WORKFLOW_CICATRIZ)
      const hoje = runSourcedHook(dir, hook, {})
      const remedioVerde = runSourcedHook(dir, hook, { [REMEDY_STUB_ENV]: "0" })

      // O não-zero é do DEFEITO, não de um fixture quebrado: sem estas linhas, um
      // "module not found" do remédio passaria por oferta medida.
      expect(hoje.output).not.toContain("Cannot find module")
      expect(hoje.output).toContain("SEM TERMINAL")
      // A REVALIDAÇÃO, medida e não afirmada: o veredito do gate DONO aparece duas
      // vezes quando o remédio sai verde (a primeira medição e a re-execução) e uma
      // vez no caminho fail-closed (que nem chega a revalidar).
      const veredito = (saida: string) => saida.split(`✖ ${WORKFLOW}`).length - 1
      expect(veredito(hoje.output)).toBe(1)
      expect(veredito(remedioVerde.output)).toBe(2)
      // E o commit segue BLOQUEADO nas duas: a re-execução não transforma "ainda
      // reprova" em verde, e o hook não atravessa as fases.
      expect(hoje.status).not.toBe(0)
      expect(remedioVerde.status).not.toBe(0)
      expect(hoje.output).not.toContain(COMPLETOU)
      expect(remedioVerde.output).not.toContain(COMPLETOU)
    } finally {
      cleanupFixtures()
    }
  })

  it("o caminho COMUM atravessa as fases (o fixture sabe commitar quando não há defeito)", () => {
    const hook = fonte()
    const dir = novoRepo()
    try {
      stage(dir, WORKFLOW, WORKFLOW_VALIDO)
      for (const forma of [
        { nome: "hoje", texto: hook },
        { nome: "sem-oferta", texto: hookSemOferta(hook) as string },
        { nome: "wait agregado", texto: hookWaitAgregada(hook) as string },
      ]) {
        const r = runSourcedHook(dir, forma.texto, {})
        expect(r.status, `forma ${forma.nome}`).toBe(0)
        expect(r.output).toContain(COMPLETOU)
        // A oferta não é oferecida quando nada reprova: sem "SEM TERMINAL", sem
        // remédio — é o custo que o caminho comum NÃO paga.
        expect(r.output).not.toContain("SEM TERMINAL")
      }
    } finally {
      cleanupFixtures()
    }
  })

  it("a detecção contra a árvore real mede e NÃO escreve", () => {
    const res = medir({ samples: 1 })

    expect(res.detection?.medido).toBe(true)
    expect(res.detection?.completou).toBe(true)
    // `false` é uma MEDIÇÃO (a árvore foi comparada antes e depois); `null` seria
    // "não deu para medir" — e nenhum dos dois pode ser "não escreveu" afirmado.
    expect(res.detection?.escreveu).toBe(false)
    expect(res.detection?.veredito).not.toBe("não classificado")
  })
})

// ── 3. Registro: comparação casada por PAPEL e herança da família ─────────

describe("bench-guard-timing — a família `hook` no registro", () => {
  const forma = (role: string, ms: number, label = `forma ${role}`) => ({
    role,
    label,
    ms,
    ok: true,
    exit: 0,
    runs: [{ ms, exit: 0 }],
  })
  const comHook = (ms: Record<string, number>) => ({
    meta: {
      tool: "bench-guard-timing",
      version: 4,
      commit: "cccc3333",
      timestamp: "2026-09-17T10:00:00.000Z",
      reused: {},
    },
    summary: {
      totalMs: 10_000,
      hookOfferComumMs: 0,
      hookEsperaMs: 0,
      hookOfferFalhaMs: 120,
      hookRevalidacaoMs: 90,
      hookDetectionMs: 200,
    },
    guards: [],
    doctor: null,
    lint: null,
    rulers: { typecheck: null, tests: null },
    hook: {
      measured: true,
      forms: Object.entries(ms).map(([role, valor]) => forma(role, valor)),
      deltas: { ofertaComumMs: 0, esperaMs: 0, ofertaFalhaMs: 120, revalidacaoMs: 90 },
      detection: { ms: 200, medido: true, completou: true, escreveu: false },
    },
  })

  const kinds = (cmp: unknown) => (cmp as { forms: { kind: string }[] }).forms.map((f) => f.kind)

  it("cada forma entra na comparação casada por PAPEL (não por posição)", () => {
    const current = comHook({ "comum-hoje": 110, "falha-hoje": 330 })
    const baseline = {
      ...comHook({ "falha-hoje": 300, "comum-hoje": 100 }),
      hook: {
        measured: true,
        // As MESMAS formas, com outros rótulos e em outra ORDEM: o pareamento é
        // pelo papel, então o delta tem de sair (e não um "novo no baseline").
        forms: [
          forma("falha-hoje", 300, "rótulo antigo da falha"),
          forma("comum-hoje", 100, "rótulo antigo do comum"),
        ],
        detection: { ms: 180, medido: true, completou: true },
      },
    }
    const cmp = compareTimings(current as never, baseline as never) as unknown as {
      forms: { kind: string; label: string; isNew: boolean; deltaMs: number | null }[]
    }

    expect(kinds(cmp)).toContain("hook")
    expect(kinds(cmp)).toContain("hook-detection")
    const comum = cmp.forms.find((f) => f.label === "forma comum-hoje")
    expect(comum?.isNew).toBe(false)
    expect(comum?.deltaMs).toBe(10)
  })

  it("uma forma que regride é REGRESSÃO (>= 50ms e +20%)", () => {
    const cmp = compareTimings(
      comHook({ "comum-hoje": 900 }) as never,
      comHook({ "comum-hoje": 100 }) as never,
    ) as unknown as { regressions: { label: string }[] }

    expect(cmp.regressions.map((r) => r.label)).toContain("forma comum-hoje")
  })

  it("sem a família nesta rodada, o veredito é PARCIAL e ela é NOMEADA", () => {
    const current = { ...comHook({ "comum-hoje": 100 }), hook: null }
    const cmp = compareTimings(
      current as never,
      comHook({ "comum-hoje": 100 }) as never,
    ) as unknown as {
      measured: boolean
      reason: string | null
    }

    expect(cmp.measured).toBe(false)
    expect(cmp.reason).toContain(REUSED_FAMILY_LABELS.hook)
  })

  it("a família herdada (`--no-hook --merge`) sai do veredito e é marcada com a origem", () => {
    const anterior = comHook({ "comum-hoje": 100 })
    const atual = { ...comHook({}), hook: null }
    const merged = reuseFamilies(atual as never, [
      { source: LATEST_FILE, report: anterior },
    ]) as unknown as {
      hook: { forms: { role: string }[] } | null
      meta: { reused: Record<string, { commit: string }> }
      summary: { hookOfferFalhaMs: number | null }
    }

    // Herdada com procedência (o número é de outro commit)...
    expect(Object.keys(merged.meta.reused)).toEqual(["hook"])
    expect(merged.meta.reused.hook.commit).toBe("cccc3333")
    // ...e o resumo descreve o arquivo gravado, não metade dele.
    expect(merged.hook?.forms.length).toBe(1)
    expect(merged.summary.hookOfferFalhaMs).toBe(120)
  })
})

// ── 4. O contrato da família e a direção das frases ───────────────────────

describe("bench-guard-timing — o contrato da oferta no commit", () => {
  it("acusa a forma do caminho comum que não passa", () => {
    const v = hookCostViolations({
      forms: [{ label: "hoje — índice ok", ok: false, exit: 1, expect: "zero" }],
    })

    expect(v.length).toBe(1)
    expect(v[0]).toContain("exit 0")
  })

  it("acusa a oferta sendo PAGA com as duas fases verdes", () => {
    const v = hookCostViolations({
      forms: [{ label: "hoje — índice ok", ok: true, exit: 0, expect: "zero" }],
      deltas: { ofertaComumMs: HOOK_RUIDO_MS + 1 },
    })

    expect(v.length).toBe(1)
    expect(v[0]).toContain("caminho COMUM")
  })

  it("acusa a medição que ESCREVEU no repositório", () => {
    const v = hookCostViolations({
      detection: { cmd: "node scripts/pre-commit-remedy.mjs", escreveu: true },
    })

    expect(v.length).toBe(1)
    expect(v[0]).toContain("read-only")
  })

  it("a mesma família sem defeito não acusa nada", () => {
    expect(
      hookCostViolations({
        forms: [{ label: "hoje — índice ok", ok: true, exit: 0, expect: "zero" }],
        deltas: { ofertaComumMs: 0 },
        detection: { cmd: "node scripts/pre-commit-remedy.mjs", escreveu: false },
      }),
    ).toEqual([])
    // ...e NEM acusa a medição que veio ABAIXO da referência (delta negativo
    // além do ruído): a oferta não foi paga — mais rápido que o esperado não é
    // a classe que este gate fecha. Pino da regressão da rodada 40: o texto
    // (julgado na direção oposta, ver abaixo) flacou com −58ms.
    expect(
      hookCostViolations({
        deltas: { ofertaComumMs: -(HOOK_RUIDO_MS + 8) },
      }),
    ).toEqual([])
  })

  it("as frases dão a DIREÇÃO de cada delta (e o não medido é dito)", () => {
    const ok = hookWhatItAdded({
      deltas: { ofertaComumMs: 0, esperaMs: -3, ofertaFalhaMs: 140, revalidacaoMs: 90 },
      detection: {
        ms: 200,
        medido: true,
        escreveu: false,
        veredito: "nada a remendar neste commit",
      },
    })
    expect(ok.join("\n")).toContain("NÃO é alcançada quando nada reprova")
    // A unidade é a do número (ms), não a de uma casa decimal: o hook e os deltas
    // dele vivem em dezenas de milissegundos.
    expect(ok.join("\n")).toContain("+140ms")
    expect(ok.join("\n")).toContain("-3ms")
    expect(ok.join("\n")).toContain("200ms")
    expect(ok.join("\n")).toContain("não escreveu nada")

    const pago = hookWhatItAdded({
      deltas: { ofertaComumMs: 300, esperaMs: 0, ofertaFalhaMs: 0, revalidacaoMs: 0 },
    })
    expect(pago.join("\n")).toContain("ATENÇÃO")

    // A direção do texto é a do GATE (só POSITIVO acima do ruído acusa): delta
    // negativo além do ruído é o hook mais rápido que a referência — nunca a
    // oferta paga. Na rodada 40 (task 264) um −58ms publicava "ATENÇÃO: ela
    // está sendo alcançada" com violações [] e o teste da linha 229 flacou;
    // na 41 (task 271), dentro do ruído, passou — oscilação que era o bug.
    const negativo = hookWhatItAdded({
      deltas: { ofertaComumMs: -(HOOK_RUIDO_MS + 8), esperaMs: 0, ofertaFalhaMs: 0, revalidacaoMs: 0 },
    })
    expect(negativo.join("\n")).toContain("NÃO é alcançada")
    expect(negativo.join("\n")).not.toContain("ATENÇÃO")

    expect(hookWhatItAdded({}).join("\n")).toContain("NÃO MEDIDO")
  })

  it("o veredito da detecção distingue os estados (o número sozinho não diz qual)", () => {
    expect(vereditoDaDeteccao("❌ SEM TERMINAL: o remédio exige confirmação")).toContain(
      "fail-closed",
    )
    expect(vereditoDaDeteccao("⚠️  Este commit carrega defeito(s) MECÂNICO(s)")).toContain(
      "há defeito",
    )
    expect(vereditoDaDeteccao("✅ nada a remendar: nenhum dos gates")).toContain("nada a remendar")
    expect(vereditoDaDeteccao("Sem medição não há remédio")).toContain("INDETERMINADO")
    expect(vereditoDaDeteccao("")).toBe("não classificado")
  })
})
