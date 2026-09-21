/**
 * bench-guard-timing-mutations.test.ts
 *
 * Trava o CONTRATO da família `mutations` do `bench-guard-timing.mjs`: o custo de
 * CADA sub-test do master de mutação (`scripts/test-mutation-guards.sh`), que
 * passou a ser MEDIDO pelo próprio master (`--json`) e VERSIONADO na baseline —
 * em vez de um job cujo custo alguém compunha à mão.
 *
 * O QUE ESTE TESTE PROTEGE (e o que o número versionado passa a afirmar):
 *   1. o comando medido é o do JOB (derivado das duas pipelines), e o modo máquina
 *      é o `--json` do master — não uma variação que só o benchmark conhece;
 *   2. cada sub-test vira uma FORMA com o id dele (o papel que a comparação casa),
 *      o ms, o exit e as metades — e o harness sai da diferença entre o total do
 *      master e a soma dos sub-tests, não de uma constante;
 *   3. fail-closed: sem o JSON (comando que não termina, saída ilegível, matriz
 *      vazia) a família é NÃO MEDIDA com o motivo — nunca uma lista vazia que
 *      passaria por "nenhum sub-test custa nada";
 *   4. o master VERMELHO ainda é medido (o `--json` sai antes do veredito) e o
 *      contrato acusa: sub-test que não passou, sub-test sem metades declaradas e
 *      a conta que não fecha (total menor que a soma);
 *   5. na comparação, o sub-test NOVO entra com o ms MEDIDO (forma nova) e um
 *      sub-test que não passou não julga custo nenhum;
 *   6. a baseline versionada carrega a família sub-test a sub-test, com o ato e o
 *      commit de origem;
 *   7. o modelo de latência deriva o passo do master DESTA medição (e não deriva
 *      nada quando a família não está no arquivo).
 *
 * Execução focada:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/bench-guard-timing-mutations.test.ts
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterAll, describe, expect, it } from "vitest"

import {
  FAMILY_MEASURED,
  MUTATION_CMD,
  MUTATION_MASTER_CMD,
  REUSED_FAMILY_LABELS,
  compareTimings,
  familyProvenance,
  measureMutationCost,
  mutationCostViolations,
  mutationWhatItAdded,
  parseOnly,
  reuseFamilies,
} from "../../../scripts/bench-guard-timing.mjs"
import { benchIndex, instrumentKey } from "../../../scripts/merge-latency.mjs"

const REPO_ROOT = join(__dirname, "..", "..", "..")

const jsonDo = (rel: string) => JSON.parse(readFileSync(join(REPO_ROOT, rel), "utf8"))

// ── O fixture de um master: o JSON que o `--json` publica ─────────────────

type Subtest = { id: string; script: string; ms: number; exit: number; metades: number }

/**
 * A forma do que a família publica — o contrato tipado que o `--json` da baseline
 * carrega. O `measureMutationCost` devolve `object` na JSDoc (o arquivo é `.mjs`,
 * importado sem tipos gerados), então o teste declara a forma que ele AFIRMA e faz
 * a asserção contra ela: um campo renomeado no guard quebra aqui, não em silêncio.
 */
type FormaMedida = {
  role: string
  label: string
  ms: number
  exit: number
  metades: number
  ok: boolean
  runs: { ms: number; ok: boolean }[]
}
type Deltas = {
  subtestsMs: number
  harnessMs: number
  totalMs: number
  wallMs: number
  proximoSubtestProjetadoMs: number
  maisCaro: string | null
  maisCaroMs: number | null
  medianaMs: number | null
}
type Medicao = {
  measured: boolean
  reason: string | null
  cmd: string
  exit: number | null
  wallMs: number
  subtests: number
  metades: number
  forms: FormaMedida[]
  deltas: Deltas | null
  violations: string[]
  whatItAdded: string[]
}

/** A mesma coisa para a comparação (`forms` sai como `object[]` na JSDoc). */
type FormaCmp = {
  kind: string
  label: string
  currentMs: number | null
  baselineMs: number | null
  deltaMs: number | null
  pct: number | null
  isNew: boolean
  unmeasured: boolean
  regression: boolean
}
const comparar = (current: object, baseline: object) =>
  compareTimings(current as never, baseline as never) as unknown as {
    measured: boolean
    reason: string | null
    forms: FormaCmp[]
  }

/**
 * Um master de mentira: um arquivo com o JSON e o `cmd` que o imprime (`cat`).
 *
 * O `measureMutationCost` roda `bash -c <cmd>` no repositório, então o fixture é
 * o MESMO caminho do de verdade (spawn + stdio + parse), sem pagar os ~4min da
 * matriz real.
 */
function masterFalso(subtests: Subtest[], { falha = null as string | null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "bench-mut-"))
  const subtestsMs = subtests.reduce((acc, s) => acc + s.ms, 0)
  const summary = {
    count: subtests.length,
    passed: subtests.filter((s) => s.exit === 0).length,
    failed: subtests.filter((s) => s.exit !== 0).map((s) => s.id),
    metades: subtests.reduce((acc, s) => acc + s.metades, 0),
    subtestsMs,
    harnessMs: 1500,
    totalMs: subtestsMs + 1500,
  }
  const arquivo = join(dir, "master.json")
  writeFileSync(arquivo, JSON.stringify({ tool: "test-mutation-guards", subtests, summary }))
  const cmd = falha === null ? `cat ${arquivo}` : `cat ${arquivo}; exit ${falha}`
  return { cmd, dir }
}

const TRES: Subtest[] = [
  {
    id: "workflow-run-syntax",
    script: "scripts/test-mutation-workflow-run-syntax.sh",
    ms: 58_000,
    exit: 0,
    metades: 14,
  },
  {
    id: "hook-commands",
    script: "scripts/test-mutation-hook-commands.sh",
    ms: 41_500,
    exit: 0,
    metades: 24,
  },
  {
    id: "archived-pipeline",
    script: "scripts/test-mutation-archived-pipeline.sh",
    ms: 1_000,
    exit: 0,
    metades: 2,
  },
]

const criados: string[] = []
const comFalso = (subtests: Subtest[], opts: { falha?: string | null } = {}): Medicao => {
  const f = masterFalso(subtests, opts)
  criados.push(f.dir)
  return measureMutationCost({ cmd: f.cmd }) as unknown as Medicao
}

afterAll(() => {
  for (const dir of criados) rmSync(dir, { recursive: true, force: true })
})

// ── 1. O comando medido é o do JOB ────────────────────────────────────────

describe("bench-guard-timing — a régua da família `mutations`", () => {
  it("o comando medido é o que as DUAS pipelines rodam (derivado, não escrito aqui)", () => {
    // O número só vale para o job se o comando for o MESMO: um benchmark que
    // medisse uma variação (`--scenario`, outro shell) versionaria o custo de
    // outra coisa — a mesma classe que a família do typecheck fecha ao medir o
    // comando canônico do invariante.
    for (const pipeline of [".github/workflows/pr-check.yml", ".gitea/workflows/ci.yml"]) {
      const linhas = readFileSync(join(REPO_ROOT, pipeline), "utf8")
        .split("\n")
        .map((l) => l.trim())
      expect(linhas).toContain(`run: ${MUTATION_MASTER_CMD}`)
    }
    // E o modo máquina é o `--json` do master (o que publica o custo): o mesmo
    // script, com a flag que dá o dado.
    expect(MUTATION_CMD).toBe(`${MUTATION_MASTER_CMD} --json`)
  })

  it("a família é SELECIONÁVEL no `--only` (o contrário exigiria a rodada inteira)", () => {
    expect(parseOnly("mutations")).toEqual({ families: ["mutations"], error: null })
    // Uma família que existe no relatório mas não na lista do `--only` obrigaria
    // quem só quer o custo dela a pagar as outras famílias inteiras.
    expect(parseOnly("hook,mutations").families).toEqual(["hook", "mutations"])
    expect(parseOnly("bogus").error).toContain("mutations")
  })

  it("o master é quem sabe rodar `--json` (o benchmark não inventa a flag)", () => {
    const fonte = readFileSync(join(REPO_ROOT, "scripts", "test-mutation-guards.sh"), "utf8")
    expect(fonte).toContain("--json")
    expect(fonte).toContain("subtestsMs")
    // O JSON sai ANTES do veredito: é isso que faz um master vermelho ainda ter
    // custo medido (o teste do contrato abaixo depende deste contrato).
    expect(fonte.indexOf("imprime_json")).toBeLessThan(
      fonte.indexOf('if [ "${#FAILED_LIST[@]}" -gt 0 ]'),
    )
  })
})

// ── 2. Cada sub-test medido, o harness por diferença ──────────────────────

describe("bench-guard-timing — o custo de CADA sub-test", () => {
  it("cada sub-test vira uma forma com o seu ID (o papel da comparação)", () => {
    const r = comFalso(TRES)

    expect(r.measured).toBe(true)
    expect(r.exit).toBe(0)
    expect(r.subtests).toBe(3)
    expect(r.metades).toBe(40)
    expect(r.forms.map((f) => f.role)).toEqual([
      "workflow-run-syntax",
      "hook-commands",
      "archived-pipeline",
    ])
    for (const form of r.forms) {
      expect(form.label).toBe(form.role)
      expect(form.ok).toBe(true)
      expect(form.ms).toBeGreaterThan(0)
      expect(form.metades).toBeGreaterThan(0)
    }
  })

  it("o harness sai da DIFERENÇA (total do master − soma dos sub-tests)", () => {
    const r = comFalso(TRES)
    const d = r.deltas!

    expect(d.subtestsMs).toBe(100_500)
    // O total é o do master (`summary.totalMs`), não o wall time do spawn: o que
    // se versiona é o custo do master, e o harness é o que sobra dele.
    expect(d.totalMs).toBe(102_000)
    expect(d.harnessMs).toBe(1_500)
    expect(d.maisCaro).toBe("workflow-run-syntax")
    expect(d.maisCaroMs).toBe(58_000)
    // A mediana da TABELA ordenada por custo (índice do meio): 41.5s entre 58s
    // e 1s — o sub-test do meio, não a média.
    expect(d.medianaMs).toBe(41_500)
  })

  it("o que o PRÓXIMO sub-test acrescenta é dito como PROJEÇÃO (não como medição)", () => {
    const r = comFalso(TRES)

    expect(r.deltas!.proximoSubtestProjetadoMs).toBe(
      Math.round(100_500 / 3) + Math.round(1_500 / 3),
    )
    // Dois pedaços MEDIDOS (a média dos scripts que existem + o harness por
    // sub-test) e nenhum deles é o custo de um sub-test que ainda não existe —
    // por isso a frase diz PROJEÇÃO e reserva "MEDIDO" para a lista.
    const frase = r.whatItAdded.join(" ")
    expect(frase).toContain("MEDIDO, sub-test a sub-test")
    expect(frase).toContain("PROJEÇÃO")
    expect(frase).toContain("entra MEDIDO na primeira rodada que o tiver")
  })

  it("um sub-test que não passou sai com `ok: false` no próprio registro", () => {
    const r = comFalso([
      ...TRES,
      { id: "cego", script: "scripts/x.sh", ms: 900, exit: 1, metades: 3 },
    ])

    expect(r.forms.find((f) => f.role === "cego")!.ok).toBe(false)
    expect(r.forms.find((f) => f.role === "workflow-run-syntax")!.ok).toBe(true)
  })
})

// ── 3. Fail-closed: não medido não vira "nada a medir" ────────────────────

describe("bench-guard-timing — a família `mutations` quando não dá para medir", () => {
  it("um stdio que não é o JSON do `--json` sai NÃO MEDIDO com o motivo", () => {
    const dir = mkdtempSync(join(tmpdir(), "bench-mut-"))
    criados.push(dir)
    const r = measureMutationCost({ cmd: "printf '🏁 nao e json'" }) as unknown as Medicao

    expect(r.measured).toBe(false)
    expect(r.reason).toContain("nao e o JSON")
    expect(r.forms).toEqual([])
    expect(r.whatItAdded[0]).toContain("NÃO MEDIDO")
  })

  it("uma matriz VAZIA é não-medida (um master que não reportou sub-test nenhum)", () => {
    const dir = mkdtempSync(join(tmpdir(), "bench-mut-"))
    criados.push(dir)
    const arquivo = join(dir, "vazio.json")
    writeFileSync(
      arquivo,
      JSON.stringify({ tool: "test-mutation-guards", subtests: [], summary: { totalMs: 10 } }),
    )
    const r = measureMutationCost({ cmd: `cat ${arquivo}` }) as unknown as Medicao

    expect(r.measured).toBe(false)
    expect(r.reason).toContain("matriz vazia")
    expect(r.deltas).toBeNull()
  })

  it("o master VERMELHO ainda é medido — e o exit fica dito no resultado", () => {
    // O `--json` sai antes do veredito: a suíte é que fica vermelha, não a
    // medição. Perder o custo por causa de um sub-test vermelho apagaria
    // exatamente o custo que originou a investigação.
    const r = comFalso(
      [...TRES, { id: "cego", script: "scripts/x.sh", ms: 900, exit: 1, metades: 3 }],
      {
        falha: "1",
      },
    )

    expect(r.measured).toBe(true)
    expect(r.exit).toBe(1)
    expect(r.subtests).toBe(4)
  })
})

// ── 4. O contrato da família ──────────────────────────────────────────────

describe("bench-guard-timing — o contrato da família `mutations`", () => {
  const formas = (ms: number[]) =>
    ms.map((m, i) => ({ label: `s${i}`, ms: m, exit: 0, metades: 3, ok: true }))

  it("acusa o sub-test que NÃO passou (o custo dele não julga nada)", () => {
    const v = mutationCostViolations({
      // Com as metades declaradas: o único defeito aqui é o exit (senão a
      // violação das metades viria junto e o teste mediria duas coisas).
      forms: [{ label: "cego", ms: 10, exit: 3, metades: 3, ok: false }],
      summary: { totalMs: 20, subtestsMs: 10 },
      harnessMs: 10,
    })

    expect(v).toHaveLength(1)
    expect(v[0]).toContain("cego (exit 3)")
    expect(v[0]).toContain("NÃO passaram")
  })

  it("acusa o sub-test SEM metades declaradas (custo sem o que ele protege)", () => {
    const v = mutationCostViolations({
      forms: [{ label: "mudo", ms: 10, exit: 0, metades: 0, ok: true }],
      summary: { totalMs: 20, subtestsMs: 10 },
      harnessMs: 10,
    })

    expect(v).toHaveLength(1)
    expect(v[0]).toContain("mudo")
    expect(v[0]).toContain("SEM metades")
  })

  it("acusa a conta que não fecha (o harness sairia negativo)", () => {
    const v = mutationCostViolations({
      forms: formas([100, 100]),
      summary: { totalMs: 150, subtestsMs: 200 },
      harnessMs: -50,
    })

    expect(v).toHaveLength(1)
    expect(v[0]).toContain("não fecha")
  })

  it("sem defeito não acusa nada — e as frases dão o mais caro e a mediana", () => {
    const forms = formas([10_000, 5_000, 1_000])
    const deltas = {
      subtestsMs: 16_000,
      harnessMs: 1_000,
      totalMs: 17_000,
      maisCaro: "s0",
      maisCaroMs: 10_000,
      medianaMs: 5_000,
      proximoSubtestProjetadoMs: 5_666,
    }

    expect(
      mutationCostViolations({
        forms,
        summary: { totalMs: 17_000, subtestsMs: 16_000 },
        harnessMs: 1_000,
      }),
    ).toEqual([])

    const frases = mutationWhatItAdded({ forms, deltas, subtests: 3, metades: 9 })
    expect(frases[0]).toContain("3 sub-test(s) · 9 metade(s)")
    expect(frases[1]).toContain("o mais caro: s0 (10.0s)")
    expect(frases[1]).toContain("a mediana: 5.0s")
    expect(frases[2]).toContain("~5.7s")
  })
})

// ── 5. Na comparação: o sub-test novo entra MEDIDO ────────────────────────

describe("bench-guard-timing — o sub-test novo e a comparação", () => {
  const familiaMedida = (forms: { role: string; label: string; ms: number; ok: boolean }[]) => ({
    measured: true,
    reason: null,
    exit: 0,
    cmd: MUTATION_CMD,
    forms: forms.map((f) => ({ ...f, metades: 3, exit: f.ok ? 0 : 1, runs: [] })),
    deltas: {
      subtestsMs: forms.reduce((acc, f) => acc + f.ms, 0),
      harnessMs: 1_000,
      totalMs: forms.reduce((acc, f) => acc + f.ms, 0) + 1_000,
      proximoSubtestProjetadoMs: 1,
    },
    violations: [],
    whatItAdded: [],
  })

  const relatorio = (mutations: unknown) => ({
    meta: {
      tool: "bench-guard-timing",
      version: 6,
      commit: "aaaa1111",
      commitDate: "2026-09-21 09:00:00 -0300",
      timestamp: "2026-09-21T12:00:00.000Z",
      act: "bench-guard-timing --only mutations --json",
      reused: {},
      families: {},
    },
    summary: { totalMs: 20_000 },
    guards: [{ label: "check:x", ms: 100, ok: true, exit: 0 }],
    doctor: { ms: 3000, exit: 0, ok: true },
    lint: null,
    rulers: { typecheck: null, tests: null },
    hook: null,
    mutations,
  })

  it("o sub-test que NÃO estava na baseline entra como forma NOVA, com o ms medido", () => {
    const baseline = relatorio(
      familiaMedida([
        { role: "workflow-run-syntax", label: "workflow-run-syntax", ms: 58_000, ok: true },
        { role: "hook-commands", label: "hook-commands", ms: 41_000, ok: true },
      ]),
    )
    const atual = relatorio(
      familiaMedida([
        { role: "workflow-run-syntax", label: "workflow-run-syntax", ms: 58_400, ok: true },
        { role: "hook-commands", label: "hook-commands", ms: 41_200, ok: true },
        // A 33ª: entrou agora. Ninguém precisou compor a conta dela — a rodada
        // que a tem mede, e ela aparece aqui com o número dela.
        { role: "gate-registration", label: "gate-registration", ms: 7_900, ok: true },
      ]),
    )

    const cmp = comparar(atual, baseline)
    const nova = cmp.forms.find((f) => f.label === "sub-test gate-registration")!

    expect(nova.isNew).toBe(true)
    expect(nova.currentMs).toBe(7_900)
    expect(nova.baselineMs).toBeNull()
    expect(nova.unmeasured).toBe(false)
    // Forma nova não é regressão (não havia com o que comparar) — nem some do
    // relatório: é ela que documenta o custo que a mudança acrescentou.
    expect(nova.regression).toBe(false)
    expect(cmp.forms.filter((f) => f.kind === "mutation")).toHaveLength(3)
  })

  it("o sub-test que fica mais lento é REGRESSÃO (>= 50ms e +20%)", () => {
    const baseline = relatorio(
      familiaMedida([{ role: "hook-commands", label: "hook-commands", ms: 10_000, ok: true }]),
    )
    const atual = relatorio(
      familiaMedida([{ role: "hook-commands", label: "hook-commands", ms: 40_000, ok: true }]),
    )

    const cmp = comparar(atual, baseline)
    const form = cmp.forms.find((f) => f.label === "sub-test hook-commands")!

    expect(form.regression).toBe(true)
    expect(form.pct).toBeCloseTo(3, 5)
  })

  it("o sub-test que NÃO passou não julga custo (nem rápido nem lento)", () => {
    const baseline = relatorio(
      familiaMedida([{ role: "hook-commands", label: "hook-commands", ms: 40_000, ok: true }]),
    )
    const atual = relatorio(
      familiaMedida([{ role: "hook-commands", label: "hook-commands", ms: 900, ok: false }]),
    )

    const form = comparar(atual, baseline).forms.find((f) => f.label === "sub-test hook-commands")!

    // Um sub-test que morre no meio fica RÁPIDO — chamar isso de "melhorou" seria
    // publicar como ganho um trabalho que não foi feito.
    expect(form.unmeasured).toBe(true)
    expect(form.regression).toBe(false)
  })

  it("sem a família nesta rodada o veredito é PARCIAL e ela é NOMEADA; herdada, sai dele", () => {
    const baseline = relatorio(
      familiaMedida([{ role: "hook-commands", label: "hook-commands", ms: 40_000, ok: true }]),
    )
    const semFamilia = relatorio(null)
    const cmp = comparar(semFamilia, baseline)

    expect(cmp.measured).toBe(false)
    expect(cmp.reason).toContain(REUSED_FAMILY_LABELS.mutations)

    const herdada = reuseFamilies(relatorio(null) as never, baseline as never) as unknown as {
      meta: {
        reused: Record<string, unknown>
        families: Record<string, { act: string; commit: string | null }>
      }
    }
    expect(herdada.meta.families.mutations.act).toBe("reused")
    expect(herdada.meta.families.mutations.commit).toBe("aaaa1111")

    const cmpHerdada = comparar(herdada as object, baseline as object)
    expect(cmpHerdada.measured).toBe(false)
    expect(cmpHerdada.reason).toContain(REUSED_FAMILY_LABELS.mutations)
    // A herdada não entra como forma: o número é de outra rodada.
    expect(cmpHerdada.forms.some((f) => f.kind === "mutation")).toBe(false)
  })

  it("a família tem ATO em toda rodada — a lista de famílias cobrem o mesmo conjunto", () => {
    const p = familyProvenance({ result: relatorio(null) as never })

    expect(Object.keys(FAMILY_MEASURED)).toContain("mutations")
    expect(Object.keys(p).sort()).toEqual(Object.keys(FAMILY_MEASURED).sort())
    expect(p.mutations.act).toBe("not-measured")
    expect(p.mutations.commit).toBeNull()
  })
})

// ── 6. A baseline versionada: o custo de cada sub-test ────────────────────

describe("bench-guard-timing — a baseline versionada carrega CADA sub-test", () => {
  const baseline = jsonDo("docs/benchmarks/guard-timing-baseline.json")

  it("a baseline tem a família `mutations` medida, com o ato e o commit de origem", () => {
    expect(baseline.meta.version).toBeGreaterThanOrEqual(6)
    expect(Object.keys(baseline.meta.families).sort()).toEqual(Object.keys(FAMILY_MEASURED).sort())
    // O ATO diz qual comando mediu — sem ele o número não é auditável.
    expect(baseline.meta.families.mutations.act).toBe("measured")
    expect(baseline.meta.families.mutations.commit).toBe(baseline.meta.commit)
    expect(baseline.mutations.cmd).toBe(MUTATION_CMD)
  })

  it("o custo está versionado por SUB-TEST (id + ms), não só como soma", () => {
    const subs: { role: string; label: string; ms: number; exit: number; metades: number }[] =
      baseline.mutations.forms

    expect(subs.length).toBe(baseline.mutations.subtests)
    expect(subs.length).toBeGreaterThan(30)
    for (const s of subs) {
      expect(s.role).toBe(s.label)
      expect(Number.isFinite(s.ms)).toBe(true)
      expect(s.ms).toBeGreaterThan(0)
      expect(s.exit).toBe(0)
      expect(s.metades).toBeGreaterThan(0)
    }
    // As somas da baseline FECHAM com as formas que ela guarda: `harnessMs` é a
    // diferença entre o total do master e a soma — se alguém editar um sub-test à
    // mão, a conta para de fechar e este teste cai.
    const soma = subs.reduce((acc, s) => acc + s.ms, 0)
    expect(baseline.mutations.deltas.subtestsMs).toBe(soma)
    expect(baseline.mutations.deltas.totalMs).toBe(soma + baseline.mutations.deltas.harnessMs)
    // O modelo de latência lê o total daqui: ele tem de ser o do master.
    expect(baseline.mutations.deltas.wallMs).toBeGreaterThan(0)
  })

  it("o sub-test mais caro e a mediana versionados são os das formas guardadas", () => {
    const ordenadas = [...baseline.mutations.forms].sort(
      (a: { ms: number }, b: { ms: number }) => b.ms - a.ms,
    )

    expect(baseline.mutations.deltas.maisCaro).toBe(ordenadas[0].role)
    expect(baseline.mutations.deltas.maisCaroMs).toBe(ordenadas[0].ms)
    expect(baseline.mutations.deltas.medianaMs).toBe(ordenadas[Math.floor(ordenadas.length / 2)].ms)
  })
})

// ── 7. O modelo de latência deriva o passo do master desta medição ────────

describe("merge-latency — o passo do master vem da MEDIÇÃO, não da conta à mão", () => {
  const bench = jsonDo("docs/benchmarks/guard-timing-baseline.json")

  it("o índice casa o passo do job (`bash scripts/test-mutation-guards.sh`) com o total medido", () => {
    const { byCmd } = benchIndex(bench)

    // O passo do job e o comando MEDIDO (com `--json`) são o mesmo script: a
    // chave do índice é o script, então o derivado é a medição por sub-test.
    expect(instrumentKey(MUTATION_MASTER_CMD)).toBe("test-mutation-guards")
    expect(byCmd.get("test-mutation-guards")).toBe(bench.mutations.deltas.totalMs)
  })

  it("sem a família no arquivo não se deriva nada (não herda um número de lugar nenhum)", () => {
    const { byCmd } = benchIndex({ ...bench, mutations: undefined })
    expect(byCmd.get("test-mutation-guards")).toBeUndefined()

    const naoMedida = benchIndex({ ...bench, mutations: { measured: false, deltas: null } })
    expect(naoMedida.byCmd.get("test-mutation-guards")).toBeUndefined()
  })
})
