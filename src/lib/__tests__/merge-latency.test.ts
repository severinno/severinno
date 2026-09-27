/**
 * merge-latency.test.ts
 *
 * O modelo da LATÊNCIA DE MERGE: o grafo sai da pipeline real, a duração sai do
 * modelo declarado confrontado com o benchmark, e a conta é o que o PR espera —
 * não a soma dos gates.
 *
 * O que estes testes prendem, além da aritmética:
 *   1. nenhum job pode ficar INVISÍVEL (rodando no PR, pulado ou não classificado
 *      — a soma dos três tem de fechar contra o arquivo);
 *   2. um job sem duração NÃO é instantâneo: o veredito fica indeterminado e o
 *      nome dele aparece;
 *   3. `on: push` não é job (o defeito que a primeira versão tinha);
 *   4. o MESMO gate invocado de duas formas (`bun run check:x` × `node
 *      scripts/check-x.mjs`) é um instrumento só — sem isso o confronto
 *      declarado × derivado acusaria todo job, e alarme que sempre toca não é
 *      alarme;
 *   5. o `if:` lido é o do JOB (chave filha direta), NUNCA o de um passo: um
 *      `if:` dentro de `steps:` fazia um job incondicional parecer condicional,
 *      e o veredito ficava indeterminado por causa de um passo;
 *   6. o TETO (`timeout-minutes` do próprio job) é a última porta antes de "não
 *      sei" — o número entra como LIMITE SUPERIOR, NOMEADO, e é CONFRONTADO com
 *      o `timeout-minutes` da pipeline para a cópia não envelhecer em silêncio;
 *   7. um job declarado por PASSOS (`steps`) tem o total composto: o passo com
 *      `from:` LÊ o número da forma versionada do benchmark (não o repete), a
 *      cobertura é EXATA nos dois sentidos (um `run:` novo custaria zero; um passo
 *      declarado que sumiu mediria outra coisa) e um `ms` junto de `steps` é
 *      recusado — dois totais do mesmo job teriam de concordar.
 */

import { describe, expect, it } from "vitest"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  BENCH_PATH,
  FORGES,
  MERGE_OWNER_ROLE,
  MODEL_PATH,
  STATE,
  benchIndex,
  classifyOnPr,
  criticalPath,
  deriveMs,
  resolveFrom,
  instrumentKey,
  makespan,
  measure,
  measureForge,
  parseArgs,
  parseJobs,
  resolveDurations,
} from "../../../scripts/merge-latency.mjs"

const ROOT = process.cwd()

function model() {
  return JSON.parse(readFileSync(join(ROOT, MODEL_PATH), "utf8"))
}

/** O benchmark REAL — sem ele os jobs que só ele mede ficam sem duração, e o
 * veredito vira INDETERMINADO (que é o comportamento honesto, testado abaixo). */
function benchReal() {
  return JSON.parse(readFileSync(join(ROOT, BENCH_PATH), "utf8"))
}

/** Uma pipeline mínima e explícita, com o MESMO formato dos workflows reais. */
const PIPELINE = [
  "name: x",
  "on:",
  "  push:",
  "    branches: [main]",
  "  pull_request:",
  "jobs:",
  "  lint:",
  "    runs-on: ubuntu-latest",
  "    steps:",
  "      - run: bun run lint",
  "  guards:",
  "    steps:",
  "      - run: node scripts/check-bun-mirror.mjs",
  "      - run: node scripts/check-que-nao-existe.mjs",
  "        if: steps.changes.outputs.changed == 'true'",
  "  build:",
  "    needs: [lint, guards]",
  "    timeout-minutes: 3",
  "    if: always()",
  "    steps:",
  "      - run: bun run build",
  "  deploy:",
  "    needs: [build]",
  "    if: github.ref == 'refs/heads/main' && github.event_name == 'push'",
  "    steps:",
  "      - run: echo deploy",
  "  manual:",
  "    if: github.event_name == 'workflow_dispatch'",
  "    steps:",
  "      - run: echo manual",
  "  estranho:",
  "    if: ${{ inputs.algo }}",
  "    steps:",
  "      - run: echo estranho",
  "",
].join("\n")

describe("parseJobs — o que É job e o que não é", () => {
  it("os gatilhos de `on:` NÃO viram jobs", () => {
    const names = parseJobs(PIPELINE).map((j) => j.name)
    expect(names).not.toContain("push")
    expect(names).not.toContain("pull_request")
    expect(names).toContain("lint")
    expect(names).toContain("build")
  })

  it("`needs` inline e em bloco, e o `if:` do job", () => {
    const jobs = parseJobs(PIPELINE)
    expect(jobs.find((j) => j.name === "build")?.needs).toEqual(["lint", "guards"])
    expect(jobs.find((j) => j.name === "deploy")?.needs).toEqual(["build"])
    expect(jobs.find((j) => j.name === "lint")?.ifLine).toBeNull()
    expect(jobs.find((j) => j.name === "build")?.ifLine).toContain("always()")
  })

  it("o `if:` de um PASSO não é o `if:` do job", () => {
    // O defeito que isto prende: `guards` TEM um `if:` — mas dentro de `steps:`,
    // no passo. Lido como se fosse do job, ele fazia o job inteiro parecer
    // condicional (e o veredito ficava indeterminado por causa de um passo).
    const jobs = parseJobs(PIPELINE)
    expect(jobs.find((j) => j.name === "guards")?.ifLine).toBeNull()
    expect(classifyOnPr(jobs.find((j) => j.name === "guards")!).onPr).toBe(true)
    // O `if:` do job continua sendo lido onde ele É do job.
    expect(jobs.find((j) => j.name === "deploy")?.ifLine).toContain("refs/heads/main")
  })

  it("o `timeout-minutes` do job é lido (a régua do teto)", () => {
    const jobs = parseJobs(PIPELINE)
    expect(jobs.find((j) => j.name === "build")?.timeoutMinutes).toBe(3)
    expect(jobs.find((j) => j.name === "lint")?.timeoutMinutes).toBeNull()
  })

  it("os comandos `run:` são lidos, com e sem `- `", () => {
    const jobs = parseJobs(PIPELINE)
    expect(jobs.find((j) => j.name === "guards")?.runLines).toEqual([
      "node scripts/check-bun-mirror.mjs",
      "node scripts/check-que-nao-existe.mjs",
    ])
  })
})

describe("classifyOnPr — roda no PR? (`null` quando não se sabe)", () => {
  it("sem `if:` roda; `always()` roda", () => {
    expect(classifyOnPr({ ifLine: null }).onPr).toBe(true)
    expect(classifyOnPr({ ifLine: "if: always() # mede mesmo se falhou" }).onPr).toBe(true)
  })

  it("push para main e `workflow_dispatch` NÃO rodam em PR", () => {
    expect(
      classifyOnPr({ ifLine: "if: github.ref == 'refs/heads/main' && github.event_name == 'push'" })
        .onPr,
    ).toBe(false)
    expect(classifyOnPr({ ifLine: "if: github.event_name == 'workflow_dispatch'" }).onPr).toBe(
      false,
    )
  })

  it("um `if:` que não se entende é `null` — não se sabe, e não se presume", () => {
    const c = classifyOnPr({ ifLine: "if: ${{ inputs.algo }}" })
    expect(c.onPr).toBeNull()
    expect(c.why).toContain("não classificado")
  })

  it("o override declarado no modelo vence a inferência", () => {
    expect(classifyOnPr({ ifLine: "if: ${{ inputs.x }}" }, true).onPr).toBe(true)
    expect(classifyOnPr({ ifLine: null }, false).onPr).toBe(false)
  })
})

describe("instrumentKey — o mesmo gate, duas invocações", () => {
  it("a entry do package.json e o script direto são o MESMO instrumento", () => {
    expect(instrumentKey("bun run check:registry-source")).toBe(
      instrumentKey("node scripts/check-registry-source.mjs"),
    )
    expect(instrumentKey("bun run check:workflow-refs:internal")).toBe(
      instrumentKey("node scripts/check-workflow-refs.mjs --pkg-internal"),
    )
  })

  it("o nome interno do entry (`check:a:b`) casa com o script `check-a`", () => {
    expect(instrumentKey("bun run check:workflow-refs:internal")).toBe("check-workflow-refs")
  })

  it("instrumentos diferentes continuam diferentes", () => {
    expect(instrumentKey("bun run lint")).not.toBe(
      instrumentKey("node scripts/check-bun-mirror.mjs"),
    )
  })
})

describe("deriveMs — a soma do que o benchmark conhece", () => {
  const index = benchIndex({
    guards: [{ cmd: "node scripts/check-bun-mirror.mjs", ms: 100 }],
    rulers: {},
  })

  it("soma os passos conhecidos e NOMEIA os que ficaram de fora", () => {
    const job = parseJobs(PIPELINE).find((j) => j.name === "guards")!
    const d = deriveMs(job, index)
    expect(d.ms).toBe(100)
    expect(d.unmatched).toEqual(["node scripts/check-que-nao-existe.mjs"])
  })

  it("sem nenhum passo conhecido não deriva nada (não devolve 0)", () => {
    const job = parseJobs(PIPELINE).find((j) => j.name === "lint")!
    expect(deriveMs(job, index).ms).toBeNull()
  })
})

describe("resolveDurations — declarado manda, derivado confronta", () => {
  const jobs = parseJobs(PIPELINE)
  const bench = { guards: [{ cmd: "node scripts/check-bun-mirror.mjs", ms: 100 }], rulers: {} }

  it("sem declaração, usa o derivado e diz que é derivado", () => {
    const { byJob, missing } = resolveDurations(
      jobs,
      { jobs: {}, overhead: { perJobMs: 0 } },
      "x",
      benchIndex(bench),
    )
    expect(byJob.get("guards")!.ms).toBe(100)
    expect(byJob.get("guards")!.provenance).toContain("derivado")
    expect(missing).toContain("lint")
    expect(byJob.get("lint")!.ms).toBeNull()
  })

  it("declarado vence, e a divergência só acusa quando os DOIS cobrem a mesma coisa", () => {
    const m = {
      overhead: { perJobMs: 0 },
      jobs: {
        x: {
          guards: { ms: 100, provenance: "declarado", source: "s", date: "2026-09-17" },
        },
      },
    }
    const { byJob } = resolveDurations(jobs, m, "x", benchIndex(bench))
    expect(byJob.get("guards")!.ms).toBe(100)
    expect(byJob.get("guards")!.diverges).toBe(false)
  })

  it("um `ms` SEM a PRÓPRIA data indetermina o job — a idade não se mede por decurso", () => {
    // O `meta.date` do arquivo é a data do ATO, não a da medição: herdá-la seria
    // datar o número por decurso, e a régua da idade (`bench-freshness.mjs`) não
    // teria de onde contar a idade DELE.
    const { byJob, missing } = resolveDurations(
      jobs,
      {
        meta: { date: "2026-09-17" },
        overhead: { perJobMs: 0 },
        jobs: { x: { guards: { ms: 100, provenance: "declarado", source: "s" } } },
      },
      "x",
      benchIndex(bench),
    )
    expect(byJob.get("guards")!.ms).toBeNull()
    expect(missing).toContain("guards")
    expect(byJob.get("guards")!.stepProblems!.join(" ")).toContain("SEM data própria")
  })

  it("o TETO continua fora da regra da data: ele NÃO é uma medição", () => {
    const { byJob } = resolveDurations(
      jobs,
      {
        meta: { date: "2026-09-17" },
        overhead: { perJobMs: 0 },
        jobs: {
          x: {
            build: {
              ms: 180_000,
              provenance: "declarado (TETO: timeout-minutes)",
              ceiling: true,
              source: "s",
            },
          },
        },
      },
      "x",
      benchIndex(bench),
    )
    expect(byJob.get("build")!.ms).toBe(180_000)
    expect(byJob.get("build")!.ceiling).toBe(true)
  })

  it("o TETO declarado é confrontado com o `timeout-minutes` da pipeline", () => {
    const m = (ms: number) => ({
      meta: { date: "2026-09-17" },
      overhead: { perJobMs: 0 },
      jobs: {
        x: {
          build: {
            ms,
            provenance: "declarado (TETO: timeout-minutes)",
            ceiling: true,
            source: "s",
          },
        },
      },
    })
    // Confere com o `timeout-minutes: 3` da fixture: é teto, e não está velho.
    const ok = resolveDurations(jobs, m(180_000), "x", benchIndex(bench))
    expect(ok.byJob.get("build")!.ceiling).toBe(true)
    expect(ok.byJob.get("build")!.ceilingAged).toBeUndefined()
    // O teto declarado com OUTRO número (o job mudou o orçamento): a cópia
    // envelheceu — e o fato é nomeado, não aceito por decurso.
    const velho = resolveDurations(jobs, m(60_000), "x", benchIndex(bench))
    expect(velho.byJob.get("build")!.ceilingAged).toEqual({
      declaredMs: 60_000,
      pipelineMs: 180_000,
    })
  })

  it("divergência além da tolerância é sinalizada, com o derivado marcado como PISO", () => {
    const m = {
      overhead: { perJobMs: 0 },
      jobs: {
        x: {
          guards: { ms: 1000, provenance: "declarado", source: "s", date: "2026-09-17" },
        },
      },
    }
    const { byJob } = resolveDurations(jobs, m, "x", benchIndex(bench))
    const d = byJob.get("guards")!
    expect(d.diverges).toBe(true)
    // O job tem um passo fora do benchmark ⇒ o derivado é piso (100 < 1000).
    expect(d.derivedUnmatched).toBe(1)
  })
})

// ── o grafo: caminho crítico × makespan ─────────────────────────────────────

describe("caminho crítico e makespan — a soma não é a latência", () => {
  const jobs = [
    { name: "a", needs: [] },
    { name: "b", needs: [] },
    { name: "c", needs: ["a", "b"] },
  ]
  const durations = new Map<string, { ms: number | null }>([
    ["a", { ms: 10_000 }],
    ["b", { ms: 20_000 }],
    ["c", { ms: 5_000 }],
  ])

  it("o caminho crítico é a cadeia mais longa (b → c)", () => {
    const p = criticalPath(jobs, durations)
    expect(p!.path).toEqual(["b", "c"])
    expect(p!.ms).toBe(25_000)
  })

  it("com 1 runner o PR espera a SOMA — o paralelismo não vale nada", () => {
    expect(makespan(jobs, durations, 1)).toBe(35_000)
  })

  it("com runners suficientes o PR espera o CAMINHO CRÍTICO", () => {
    expect(makespan(jobs, durations, 3)).toBe(25_000)
    // E `a` roda ao lado de `b` (2 runners já bastam para o caminho crítico).
    expect(makespan(jobs, durations, 2)).toBe(25_000)
  })

  it("uma duração faltante contamina os dois números (nada de zero)", () => {
    const comBuraco = new Map(durations)
    comBuraco.set("a", { ms: null })
    expect(makespan(jobs, comBuraco, 2)).toBeNull()
    expect(criticalPath(jobs, comBuraco)).toBeNull()
  })
})

// ── a forja real ────────────────────────────────────────────────────────────

describe("measureForge — a pipeline real, com o modelo real", () => {
  const gitea = FORGES.find((f) => f.id === "gitea")!
  const content = readFileSync(join(ROOT, gitea.file), "utf8")

  // A medição REAL da forja usa o benchmark versionado (é de lá que sai a
  // duração dos jobs que o modelo não declara) — igual ao `measure()`.
  function giteaReport(runners: number | null = null, bench: object | null = benchReal()) {
    return measureForge({ forge: gitea, content, model: model(), bench, runners })
  }

  it("NENHUM job fica invisível: rodando + pulado + não classificado = declarados", () => {
    const r = giteaReport()
    const declarados = parseJobs(content).length
    expect(r.jobs.length + r.skippedOnPr.length + r.unclassified.length).toBe(declarados)
  })

  it("`deploy` (só push em main) sai da latência — e sai NOMEADO", () => {
    const r = giteaReport()
    expect(r.skippedOnPr.map((s) => s.name)).toEqual(["deploy"])
    expect(r.jobs.map((j) => j.name)).not.toContain("deploy")
  })

  it("a forja é PRONTA: todo job do PR tem duração declarada ou derivada", () => {
    const r = giteaReport()
    expect(r.missing, `sem duração: ${r.missing.join(", ")}`).toEqual([])
    expect(r.state).toBe(STATE.READY)
  })

  it("com 1 runner a latência é a SOMA (a forja sobe um act_runner)", () => {
    const r = giteaReport()
    expect(r.runners).toBe(1)
    expect(r.latencyMs).toBe(r.sumOfGatesMs)
    expect(r.parallelismSavingMs).toBe(0)
  })

  it("sem benchmark, os jobs que só ele mede ficam NOMEADOS e o veredito é indeterminado", () => {
    // A outra face da PRONTIDÃO: um job sem duração NÃO entra como zero. Com o
    // benchmark ausente, os quatro jobs que ele cobre saem nomeados em `missing`,
    // e os dois números que dependem do conjunto completo (latência e soma)
    // ficam nulos em vez de mentirem para menos.
    const r = giteaReport(null, null)
    expect(r.missing).toEqual(expect.arrayContaining(["lint", "typecheck", "test"]))
    expect(r.state).toBe(STATE.UNKNOWN)
    expect(r.sumComplete).toBe(false)
    expect(r.latencyMs).toBeNull()
    expect(r.serialMs).toBeNull()
    expect(r.unknowns.some((u) => u.includes("NÃO tem duração"))).toBe(true)
  })

  it("com runners de sobra a latência cai para o CAMINHO CRÍTICO (e é menor)", () => {
    const r = giteaReport(FORCES_RUNNERS)
    expect(r.latencyMs).toBe(r.criticalPathMs)
    expect(r.latencyMs!).toBeLessThan(r.sumOfGatesMs)
    // O caminho crítico é a CADEIA MAIS LONGA do grafo, e desde 21/09/2026 quem
    // o fecha é o `guards` — não mais o `build`: a matriz de provas por mutação
    // medida DENTRO do job (381.0s) fez o `guards` (414.8s) passar a cadeia do
    // build (test 134.9s + build 246.0s = 380.9s). Os DOIS lados ficam nomeados
    // com o número, para o dia em que o custo mudar de lado o teste dizer QUEM
    // passou na frente em vez de só acusar uma string diferente.
    const ms = (nome: string) => r.jobs.find((j) => j.name === nome)!.ms ?? 0
    expect(r.criticalPath).toEqual(["guards"])
    expect(ms("guards")).toBeGreaterThan(ms("test") + ms("build"))
  })

  it("a latência é maior que qualquer gate sozinho — e menor que a soma com paralelismo", () => {
    const r = giteaReport(FORCES_RUNNERS)
    const maiorGate = Math.max(...r.jobs.map((j) => j.ms ?? 0))
    expect(r.latencyMs!).toBeGreaterThanOrEqual(maiorGate)
    expect(r.latencyMs!).toBeLessThanOrEqual(r.sumOfGatesMs)
  })
})

const FORCES_RUNNERS = 8

describe("measure — o relatório das duas forjas", () => {
  it("as DUAS forjas são PRONTAS: todo job do PR tem duração (com procedência)", () => {
    const report = measure(model())
    const gitea = report.sections.find((s) => s.forge === "gitea")!
    const github = report.sections.find((s) => s.forge === "github")!
    expect(gitea.state).toBe(STATE.READY)
    expect(github.state).toBe(STATE.READY)
    expect(github.missing).toEqual([])
    expect(gitea.missing).toEqual([])
    // Nenhum job pode ficar SEM procedência declarada: o número publicado tem
    // de dizer de onde veio (medido, derivado, piso ou teto).
    for (const s of report.sections) {
      for (const j of s.jobs) expect(j.provenance).toBeTruthy()
    }
  })

  it("o espelho NOMEIA os jobs que entraram por TETO — a latência é um limite", () => {
    const report = measure(model())
    const github = report.sections.find((s) => s.forge === "github")!
    // O custo que só se conhece pelo orçamento do runner (act, PostGIS, matrix
    // do seed) entra pelo `timeout-minutes` — e o relatório diz isso em vez de
    // deixar o número parecer medido.
    expect(github.ceilings.length).toBeGreaterThan(0)
    for (const c of github.ceilings)
      expect(c.timeoutMinutes === null || c.ms % 60_000 === 0).toBe(true)
    // Sem os tetos, a soma é a que continua comparável com uma medição.
    expect(github.sumWithoutCeilingsMs).toBeLessThan(github.sumOfGatesMs)
  })

  it("sem a declaração do espelho, o veredito dele volta a ser INDETERMINADO", () => {
    // A outra face: o que faz o espelho ser PRONTO é a declaração de cada job.
    // Apagando as durações, os nomes aparecem — nenhum job vira zero silencioso.
    const m = model()
    m.jobs.github = {}
    const report = measure(m)
    const github = report.sections.find((s) => s.forge === "github")!
    expect(github.state).toBe(STATE.UNKNOWN)
    expect(github.missing.length).toBeGreaterThan(0)
    expect(github.unknowns.some((u) => u.includes("tem duração"))).toBe(true)
  })

  it("`--runners 1` no --json: a latência é a soma, e o caminho crítico continua medido", () => {
    const report = measure(model(), { runners: 1 })
    for (const s of report.sections) {
      if (s.state === STATE.READY) expect(s.latencyMs).toBe(s.sumOfGatesMs)
      expect(s.criticalPathMs === null || s.criticalPathMs <= (s.latencyMs ?? Infinity)).toBe(true)
    }
  })
})

// ── o GATE: `--check` só julga o dono do merge ──────────────────────────────

/**
 * Um repositório SINTÉTICO mínimo: é assim que o gate é exercitado sem tocar a
 * árvore real — e é o que permite injetar o defeito que o gate existe para pegar
 * (um job novo no PR sem duração).
 */
function fixtureRoot({ modeloExtra = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), "merge-latency-"))
  mkdirSync(join(root, ".gitea/workflows"), { recursive: true })
  mkdirSync(join(root, ".github/workflows"), { recursive: true })
  mkdirSync(join(root, "docs/benchmarks"), { recursive: true })
  mkdirSync(join(root, "ci"), { recursive: true })
  writeFileSync(
    join(root, ".gitea/workflows/ci.yml"),
    [
      "name: ci",
      "on:",
      "  pull_request:",
      "jobs:",
      "  guards:",
      "    steps:",
      "      - run: node scripts/check-bun-mirror.mjs",
      "  novo:",
      "    steps:",
      "      - run: bun run algo-que-ninguem-mede",
      "",
    ].join("\n"),
  )
  writeFileSync(
    join(root, ".github/workflows/pr-check.yml"),
    [
      "name: pr-check",
      "on:",
      "  pull_request:",
      "jobs:",
      "  check:",
      "    steps:",
      "      - run: bun run test:run",
      "",
    ].join("\n"),
  )
  // O benchmark não conhece nenhum dos comandos: nada é derivado aqui.
  writeFileSync(join(root, BENCH_PATH), JSON.stringify({ guards: [], rulers: {} }))
  writeFileSync(
    join(root, MODEL_PATH),
    JSON.stringify({
      meta: { tool: "merge-latency", version: 1, date: "2026-09-16" },
      overhead: { perJobMs: 0 },
      concurrency: { gitea: { runners: 1, source: "fixture" } },
      jobs: {
        gitea: {
          guards: { ms: 1000, provenance: "declarado", source: "fixture", date: "2026-09-16" },
        },
        github: {},
      },
      ...modeloExtra,
    }),
  )
  return root
}

describe("`--check` — o gate do PR (o dono do merge)", () => {
  const declarado = (ms: number) => ({
    ms,
    provenance: "declarado",
    source: "fixture",
    date: "2026-09-16",
  })

  it("um job novo no PR sem duração deixa o dono do merge INDETERMINADO e o NOMEIA", () => {
    // O defeito que o gate pega: um job entra na pipeline e o número publicado
    // continua "cobrindo o PR" porque o denominador encolheu em silêncio.
    const root = fixtureRoot()
    try {
      const r = measure(model(), { root })
      expect(r.mergeOwner!.forge).toBe("gitea")
      expect(r.mergeOwner!.state).toBe(STATE.UNKNOWN)
      expect(r.mergeOwner!.missing).toEqual(["novo"])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("com a duração do job novo declarada, o dono do merge fica PRONTA", () => {
    const root = fixtureRoot()
    try {
      const m = JSON.parse(readFileSync(join(root, MODEL_PATH), "utf8"))
      m.jobs.gitea.novo = declarado(2000)
      writeFileSync(join(root, MODEL_PATH), JSON.stringify(m))
      const r = measure(m, { root })
      expect(r.mergeOwner!.state).toBe(STATE.READY)
      expect(r.mergeOwner!.missing).toEqual([])
      // Com 1 runner a latência é a soma dos dois jobs (1000 + 2000).
      expect(r.mergeOwner!.latencyMs).toBe(3000)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("o veredito do dono do merge NÃO é contaminado pelo espelho", () => {
    // O espelho tem o job `check` sem medição (a fixture não o declara): o
    // relatório completo é INDETERMINADO, mas o gate do PR só olha quem mergeia.
    // Sem essa separação, o espelho parcial travaria o merge da forja para sempre.
    const root = fixtureRoot()
    try {
      const m = JSON.parse(readFileSync(join(root, MODEL_PATH), "utf8"))
      m.jobs.gitea.novo = declarado(2000)
      const r = measure(m, { root })
      const github = r.sections.find((s) => s.forge === "github")!
      expect(github.state).toBe(STATE.UNKNOWN)
      expect(r.state).toBe(STATE.UNKNOWN)
      expect(r.mergeOwner!.state).toBe(STATE.READY)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("o papel do dono do merge é UM (uma segunda forja com o papel é ambígua)", () => {
    const donos = FORGES.filter((f) => f.role === MERGE_OWNER_ROLE)
    expect(donos.map((f) => f.id)).toEqual(["gitea"])
  })

  it("`--check` e `--forge` são escopos concorrentes (falha de uso, não veredito)", () => {
    expect(() => parseArgs(["--check", "--forge", "github"])).toThrow(/concorrentes/)
    expect(parseArgs(["--check"]).check).toBe(true)
    expect(parseArgs(["--check"]).forges.length).toBe(FORGES.length)
    // `--runners` NÃO é escopo: ele muda a FILA, não quem é julgado.
    expect(parseArgs(["--check", "--runners", "8"]).check).toBe(true)
  })
})

// ── o job declarado por PASSOS: o número do passo vem do benchmark ───────────

/**
 * A forma `mutation-count` da família `mutations` — o sub-test que MEDE a suíte
 * do count dentro do master, com o commit de origem ao lado.
 *
 * O defeito que estes testes prendem: o passo do job declarava 3870ms enquanto
 * esta forma publicava 3897ms, e nenhum dos dois era derivado do outro — dois
 * números do MESMO passo, 27ms de diferença de contexto que ninguém via.
 */
function benchComForma({ ms = 3897, commit = "2757e3a5" } = {}): Record<string, unknown> {
  return {
    meta: {
      tool: "bench-guard-timing",
      version: 1,
      commit,
      commitDate: "2026-09-21T10:27:18-03:00",
      families: { mutations: { act: "measured", commit, commitDate: null, source: null } },
    },
    guards: [],
    mutations: {
      measured: true,
      cmd: "bash scripts/test-mutation-guards.sh --json",
      forms: [
        {
          role: "mutation-count",
          label: "mutation-count",
          ms,
          exit: 0,
          ok: true,
          runs: [{ ms, ok: true }],
        },
      ],
    },
  }
}

/** Os `run:` do job — inclusive o bloco (`|`), que o parser devolve como veio. */
const RUNS_DO_COUNT = [
  'bash scripts/setup-bun-ci.sh "${{ vars.BUN_VERSION }}"',
  "bun install --frozen-lockfile",
  "bash scripts/test-mutation-mutation-count.sh",
  "node scripts/check-mutation-count.mjs",
  "|",
]

const JOB = { name: "count", runLines: RUNS_DO_COUNT }

const ENTRY = {
  provenance: "declarado + derivado (benchmark)",
  date: "2026-09-21",
  source: "fixture",
  steps: [
    {
      run: 'bash scripts/setup-bun-ci.sh "${{ vars.BUN_VERSION }}"',
      ms: 17_175,
      date: "2026-09-17",
      source: "fixture",
    },
    { run: "bun install --frozen-lockfile", ms: 62, date: "2026-09-21", source: "fixture" },
    {
      run: "bash scripts/test-mutation-mutation-count.sh",
      from: { family: "mutations", form: "mutation-count" },
    },
    { run: "node scripts/check-mutation-count.mjs", ms: 93, date: "2026-09-21", source: "fixture" },
    { run: "|", ms: 98, date: "2026-09-21", source: "fixture" },
  ],
}

function comPassos(
  entry: Record<string, unknown>,
  bench: Record<string, unknown> = benchComForma(),
) {
  const model = {
    meta: { tool: "merge-latency", version: 1, date: "2026-09-21" },
    overhead: { perJobMs: 0 },
    jobs: { github: { count: entry } },
  }
  return resolveDurations([JOB], model, "github", benchIndex(bench))
}

describe("o job declarado por PASSOS — o passo LIGADO ao benchmark", () => {
  it("o número do passo sai da FORMA versionada e o total é a soma dos passos", () => {
    const { byJob, missing } = comPassos(ENTRY)
    const d = byJob.get("count")!
    expect(missing).toEqual([])
    expect(d.ms).toBe(17_175 + 62 + 3897 + 93 + 98)
    expect(d.provenance).toBe("declarado + derivado (benchmark)")
    // O derivado é SÓ o passo ligado (é ele que o benchmark conhece).
    expect(d.derivedMs).toBe(3897)
    const ligado = d.steps!.find((p) => p.derived)!
    expect(ligado.label).toBe("mutations/mutation-count")
    // A PROCEDÊNCIA do derivado: o commit que a FAMÍLIA descreve.
    expect(ligado.commit).toBe("2757e3a5")
  })

  it("a forma MUDA na baseline e o job move junto (o número não está no modelo)", () => {
    // O witness da derivação: nenhum campo do modelo muda entre as duas medidas.
    const base = comPassos(ENTRY).byJob.get("count")!.ms
    const outra = comPassos(ENTRY, benchComForma({ ms: 12_000 })).byJob.get("count")!.ms
    expect(base).toBe(17_175 + 62 + 3897 + 93 + 98)
    expect(outra).toBe(17_175 + 62 + 12_000 + 93 + 98)
    expect(outra! - base!).toBe(12_000 - 3897)
  })

  it("a forma AUSENTE do benchmark indetermina o job — e a causa nomeia a forma", () => {
    const semForma: Record<string, unknown> = {
      meta: { commit: "2757e3a5", families: {} },
      guards: [],
      mutations: { measured: false, forms: [] },
    }
    const { byJob, missing } = comPassos(ENTRY, semForma)
    expect(missing).toEqual(["count"])
    expect(byJob.get("count")!.ms).toBeNull()
    expect(byJob.get("count")!.stepProblems!.join(" ")).toContain("mutation-count")
  })

  it("uma família desconhecida em `from:` é RECUSADA (não cai como sem derivação)", () => {
    const index = benchIndex(benchComForma())
    expect(resolveFrom({ family: "mutations", form: "nao-existe" }, index).error).toContain(
      "não está",
    )
    expect(resolveFrom({ family: "guardas" }, index).error).toContain(
      "declaradas: mutations, guards",
    )
    expect(
      resolveFrom({ family: "guards", cmd: "node scripts/check-bun-mirror.mjs" }, index).error,
    ).toContain("guards")
  })

  it("um `run:` NOVO na pipeline indetermina: ele custaria ZERO na conta do PR", () => {
    const job = {
      name: "count",
      runLines: [...RUNS_DO_COUNT, "node scripts/check-periodic-alerts.mjs"],
    }
    const model = { overhead: { perJobMs: 0 }, jobs: { github: { count: ENTRY } } }
    const { byJob, missing } = resolveDurations([job], model, "github", benchIndex(benchComForma()))
    expect(missing).toEqual(["count"])
    expect(byJob.get("count")!.ms).toBeNull()
    expect(byJob.get("count")!.stepProblems!.join(" ")).toContain("custaria zero")
  })

  it("um passo DECLARADO que sumiu da pipeline também indetermina (a cobertura é exata)", () => {
    const job = {
      name: "count",
      runLines: RUNS_DO_COUNT.filter((l) => !l.startsWith("bun install")),
    }
    const model = { overhead: { perJobMs: 0 }, jobs: { github: { count: ENTRY } } }
    const { byJob } = resolveDurations([job], model, "github", benchIndex(benchComForma()))
    expect(byJob.get("count")!.stepProblems!.join(" ")).toContain("não existe (mais) na pipeline")
  })

  it("`ms` E `steps` no mesmo job indetermina: dois totais do mesmo número", () => {
    const { byJob, missing } = comPassos({ ...ENTRY, ms: 21_198 })
    expect(missing).toEqual(["count"])
    expect(byJob.get("count")!.stepProblems!.join(" ")).toContain("a segunda fonte do mesmo número")
  })
})

describe("no REPO REAL: o job do count é composto, não um número medido à parte", () => {
  it("o total é a soma dos passos e o derivado aponta a forma e o commit da família", () => {
    const bench = benchReal()
    const forma = (bench.mutations.forms as { role: string; ms: number }[]).find(
      (f) => f.role === "mutation-count",
    )!
    const r = measureForge({
      forge: FORGES.find((f) => f.id === "github")!,
      content: readFileSync(join(ROOT, ".github/workflows/pr-check.yml"), "utf8"),
      model: model(),
      bench,
    })
    const job = r.jobs.find((j) => j.name === "mutation-count-guard")!
    const passos = job.steps as { ms: number; derived: boolean; commit: string | null }[]
    expect(job.stepProblems).toEqual([])
    expect(job.ms).toBe(passos.reduce((acc, p) => acc + p.ms, 0))
    expect(job.derivedMs).toBe(forma.ms)
    const ligado = passos.find((p) => p.derived)!
    expect(ligado.ms).toBe(forma.ms)
    // A PROCEDÊNCIA do número derivado: o commit DA FAMÍLIA quando o ato o grava,
    // e a ÂNCORA do registro quando a família foi MEDIDA nesta rodada (v7: um
    // commit não contém o próprio hash, então o índice publica o `parentCommit` —
    // o topo sobre o qual o ato rodou —, o MESMO fallback do `benchCommit`).
    const esperado = bench.meta.families.mutations.commit ?? bench.meta.parentCommit
    expect(esperado).not.toBeNull()
    expect(ligado.commit).toBe(esperado)
  })

  it("nenhum job do PR declara passos que não fecham (a cobertura é exata na árvore real)", () => {
    const r = measure(model(), { root: ROOT })
    const comProblemas = r.sections.flatMap((s) =>
      s.jobs.filter((j) => (j.stepProblems ?? []).length > 0),
    )
    expect(comProblemas.map((j) => j.name)).toEqual([])
  })
})
