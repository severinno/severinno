/**
 * mutation-trend-issue.test.ts
 *
 * Prova que o `::warning::` dos jobs semanais de overhead do mutation-coord
 * deixou de ser alerta mudo: vira ISSUE acionável (dedup por assinatura) e
 * FECHA quando o overhead volta à faixa.
 *
 * O ciclo é medido com um `gh` DUBLÊ em disco (estado + log de chamadas), como
 * no `actrc-sync-issue.test.ts`: o dedup e o fechamento não são uma conta, são
 * um CICLO entre runs — com o `gh` dublado por função cada teste começaria do
 * zero e o defeito (comentar/abrir toda semana) seria invisível.
 */

import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import { afterAll, describe, expect, it } from "vitest"

import {
  ISSUE_LABEL,
  MARKER_ID,
  allMeasured,
  bandOf,
  isActionable,
  loadReports,
  measured,
  resolutionComment,
  signatureOf,
  trendBody,
  trendTitle,
  zoneOf,
} from "../../../scripts/mutation-trend-issue.mjs"

const SCRIPT = resolve(process.cwd(), "scripts", "mutation-trend-issue.mjs")
const tmpDirs: string[] = []

afterAll(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

// ── relatórios (mesma FORMA dos medidores) ─────────────────────────────────

const trend = (over: Record<string, unknown> = {}) => ({
  runId: "999",
  repo: "org/repo",
  window: 4,
  maxDriftPct: 30,
  current: { found: true, durationSecs: 78 },
  history: [{ runId: "1", durationSecs: 52 }],
  medianSecs: 52,
  driftPct: 50,
  warned: true,
  ...over,
})

const timing = (over: Record<string, unknown> = {}) => ({
  found: true,
  stepName: "Run mutation test (contrato coordenado)",
  durationSecs: 61,
  conclusion: "success",
  runId: "999",
  budgetSecs: 240,
  warnSecs: 58,
  zone: "warn",
  driftPct: 17.3,
  ...over,
})

describe("zoneOf / measured / isActionable", () => {
  it("drift acima do limiar (warned) e faixa SOFT do medidor de budget são acionáveis", () => {
    expect(zoneOf(trend())).toBe("warn")
    expect(zoneOf(timing())).toBe("warn")
    expect(isActionable([trend()])).toBe(true)
    expect(isActionable([timing()])).toBe(true)
  })

  it("teto duro estourado (zone fail) também é acionável (o vermelho é mudo; a issue é o canal)", () => {
    expect(zoneOf(timing({ zone: "fail" }))).toBe("fail")
    expect(isActionable([timing({ zone: "fail" })])).toBe(true)
  })

  it("dentro da faixa → ok, não acionável", () => {
    expect(zoneOf(trend({ warned: false, driftPct: 4 }))).toBe("ok")
    expect(zoneOf(timing({ zone: "ok" }))).toBe("ok")
    expect(isActionable([trend({ warned: false })])).toBe(false)
  })

  it("'não medido' NUNCA é acionável nem reconciliável", () => {
    const failed = { runId: "999", repo: "org/repo", found: false, error: "gh fora" }
    expect(measured(failed)).toBe(false)
    expect(zoneOf(failed)).toBe("unmeasured")
    expect(isActionable([failed])).toBe(false)
    // Reconciliar exige TODOS medidos: um medidor quebrado não prova que o
    // overhead voltou ao normal.
    expect(allMeasured([failed])).toBe(false)
    expect(allMeasured([trend(), failed])).toBe(false)
    expect(allMeasured([trend({ warned: false }), timing({ zone: "ok" })])).toBe(true)
  })
})

describe("signatureOf — estável por FAIXA (a duração oscila a cada run)", () => {
  it("duas runs com o mesmo grau de drift → MESMA assinatura (sem ruído semanal)", () => {
    expect(signatureOf([trend({ driftPct: 41 })])).toBe(signatureOf([trend({ driftPct: 48 })]))
  })

  it("piora de ordem (outra dezena) → assinatura diferente (a dívida mudou)", () => {
    expect(signatureOf([trend({ driftPct: 41 })])).not.toBe(signatureOf([trend({ driftPct: 71 })]))
  })

  it("teto duro estourado domina a assinatura", () => {
    expect(signatureOf([timing({ zone: "fail" })])).toContain("zone=fail")
  })

  it("bandOf é a dezena (e 0 sem número — nunca NaN no marcador)", () => {
    expect(bandOf(trend({ driftPct: 47.9 }))).toBe(4)
    expect(bandOf({ found: false })).toBe(0)
    expect(bandOf(trend({ driftPct: -12 }))).toBe(0)
  })
})

describe("corpo e desfecho são acionáveis", () => {
  it("o corpo traz a duração, a mediana, o drift e os limiares dos dois relatórios", () => {
    const body = trendBody([trend(), timing()])
    expect(body).toContain("mutation-coord")
    expect(body).toContain("**78s**")
    expect(body).toContain("mediana dos runs anteriores: 52s")
    expect(body).toContain("50.0%")
    expect(body).toContain("limiar de tendência: 30%")
    expect(body).toContain("teto duro: 240s")
    expect(body).toContain("faixa soft: 58s")
    expect(body).toContain(`<!-- ${MARKER_ID}:`)
  })

  it("o título é ESTÁVEL (sem números — senão cada run abriria uma issue)", () => {
    expect(trendTitle()).not.toMatch(/\d+s/)
    expect(trendTitle()).toContain("mutation-coord")
  })

  it("o comentário de resolução carrega a prova (o que foi medido agora)", () => {
    const comment = resolutionComment([
      trend({ warned: false, driftPct: 3, current: { found: true, durationSecs: 54 } }),
    ])
    expect(comment).toContain("Resolvido")
    expect(comment).toContain("**54s**")
    expect(comment).toContain("abre uma issue nova")
  })
})

describe("loadReports — fail-closed", () => {
  it("sem --report é erro (sem medição não há alerta)", () => {
    expect(() => loadReports([])).toThrow(/nenhum --report/)
  })

  it("arquivo ausente é erro (o job esperava medição ali)", () => {
    expect(() => loadReports([join(tmpdir(), "nao-existe-xyz.json")])).toThrow(/arquivo não existe/)
  })

  it("JSON que não é objeto é erro", () => {
    const dir = mkdtempSync(join(tmpdir(), "mti-"))
    tmpDirs.push(dir)
    const path = join(dir, "r.json")
    writeFileSync(path, "[]", "utf8")
    expect(() => loadReports([path])).toThrow(/JSON inválido/)
  })
})

// ── CLI + gh dublê: o ciclo fecha entre runs ───────────────────────────────

interface FakeIssue {
  number: number
  title: string
  body: string
  labels: string[]
  state: "open" | "closed"
  comments: { body: string }[]
}

function makeFakeGh() {
  const binDir = mkdtempSync(join(tmpdir(), "gh-fake-mti-"))
  tmpDirs.push(binDir)
  const statePath = join(binDir, "issues.json")
  const logPath = join(binDir, "calls.jsonl")
  writeFileSync(statePath, "[]", "utf8")
  writeFileSync(logPath, "", "utf8")

  writeFileSync(
    join(binDir, "gh"),
    `#!/usr/bin/env node
import { appendFileSync, readFileSync, writeFileSync } from "node:fs"
const STATE = ${JSON.stringify(statePath)}
const LOG = ${JSON.stringify(logPath)}
const args = process.argv.slice(2)
appendFileSync(LOG, JSON.stringify(args) + "\\n")
const state = JSON.parse(readFileSync(STATE, "utf8"))
const flag = (n) => { const i = args.indexOf(n); return i === -1 ? null : args[i + 1] }
const save = () => writeFileSync(STATE, JSON.stringify(state, null, 2))
const fail = (m) => { process.stderr.write("gh fake: " + m + "\\n"); process.exit(1) }
if (args[0] === "label" && args[1] === "create") process.exit(0)
if (args[0] !== "issue") fail("subcomando nao modelado: " + args.join(" "))
if (args[1] === "list") {
  const label = flag("--label")
  const want = flag("--state") ?? "open"
  process.stdout.write(JSON.stringify(state
    .filter((i) => i.state === want && (!label || i.labels.includes(label)))
    .map(({ number, title, body, comments }) => ({ number, title, body, comments }))))
  process.exit(0)
}
if (args[1] === "create") {
  const number = state.reduce((m, i) => Math.max(m, i.number), 0) + 1
  state.push({ number, title: flag("--title") ?? "", body: flag("--body") ?? "", labels: [flag("--label")], state: "open", comments: [] })
  save()
  process.stdout.write("https://github.com/o/r/issues/" + number + "\\n")
  process.exit(0)
}
if (args[1] === "comment" || args[1] === "close") {
  const issue = state.find((i) => String(i.number) === args[2])
  if (!issue) fail("issue inexistente")
  if (args[1] === "comment") issue.comments.push({ body: flag("--body") ?? "" })
  else issue.state = "closed"
  save()
  process.exit(0)
}
fail("comando nao modelado: " + args.join(" "))
`,
    { mode: 0o755 },
  )

  return {
    binDir,
    issues: (): FakeIssue[] => JSON.parse(readFileSync(statePath, "utf8")) as FakeIssue[],
    callsOf: (verb: string): string[][] =>
      readFileSync(logPath, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as string[])
        .filter((c) => c[0] === "issue" && c[1] === verb),
  }
}

describe("CLI + gh dublê — o aviso vira issue e a dívida FECHA quando resolve", () => {
  function writeReport(dir: string, name: string, report: object) {
    const path = join(dir, name)
    writeFileSync(path, JSON.stringify(report, null, 2), "utf8")
    return path
  }

  function run(dir: string, binDir: string, reports: string[]) {
    const args = reports.flatMap((r) => ["--report", r])
    return spawnSync(process.execPath, [SCRIPT, ...args], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, PATH: `${binDir}:${process.env.PATH ?? ""}` },
    })
  }

  it("cria a issue com o label e a assinatura; run repetida não duplica", () => {
    const dir = mkdtempSync(join(tmpdir(), "mti-run-"))
    tmpDirs.push(dir)
    const fake = makeFakeGh()
    const warned = writeReport(dir, "trend.json", trend())

    const first = run(dir, fake.binDir, [warned])
    expect(first.status, first.stderr).toBe(0)
    expect(first.stdout).toContain("Issue criada")
    expect(fake.issues()).toHaveLength(1)
    expect(fake.issues()[0].labels).toEqual([ISSUE_LABEL])
    expect(fake.issues()[0].body).toContain(`<!-- ${MARKER_ID}:`)

    const second = run(dir, fake.binDir, [warned])
    expect(second.stdout).toContain("já reportado")
    expect(fake.issues()).toHaveLength(1)
    expect(fake.issues()[0].comments).toEqual([])
  })

  it("os DOIS relatórios alimentam o mesmo canal: um só fora da faixa basta", () => {
    const dir = mkdtempSync(join(tmpdir(), "mti-run-"))
    tmpDirs.push(dir)
    const fake = makeFakeGh()
    const healthyTrend = writeReport(dir, "trend.json", trend({ warned: false, driftPct: 2 }))
    const warnedTiming = writeReport(dir, "timing.json", timing())

    const res = run(dir, fake.binDir, [healthyTrend, warnedTiming])
    expect(res.status, res.stderr).toBe(0)
    expect(fake.issues()).toHaveLength(1)
    // O corpo nomeia a faixa que disparou (a soft do medidor de budget).
    expect(fake.issues()[0].body).toContain("faixa `warn`")
  })

  it("dentro da faixa com TODOS medidos → COMENTA a prova e FECHA (o ciclo fecha)", () => {
    const dir = mkdtempSync(join(tmpdir(), "mti-run-"))
    tmpDirs.push(dir)
    const fake = makeFakeGh()
    const warned = writeReport(dir, "a.json", trend())
    run(dir, fake.binDir, [warned])
    expect(fake.issues()[0].state).toBe("open")

    const healthy = writeReport(
      dir,
      "b.json",
      trend({ warned: false, driftPct: 1, current: { found: true, durationSecs: 53 } }),
    )
    const resolved = run(dir, fake.binDir, [healthy])
    expect(resolved.status, resolved.stderr).toBe(0)
    expect(resolved.stdout).toContain("issue #1 fechada")
    expect(fake.issues()[0].state).toBe("closed")
    expect(fake.issues()[0].comments.at(-1)?.body).toContain("Resolvido")

    // Run seguinte: nada a fechar (idempotente).
    const again = run(dir, fake.binDir, [healthy])
    expect(again.stdout).toContain("nenhuma dívida aberta")
    expect(fake.callsOf("close")).toHaveLength(1)
  })

  it("'não medido' NÃO fecha a dívida (medidor quebrado não é evidência de normal)", () => {
    const dir = mkdtempSync(join(tmpdir(), "mti-run-"))
    tmpDirs.push(dir)
    const fake = makeFakeGh()
    run(dir, fake.binDir, [writeReport(dir, "a.json", trend())])
    expect(fake.issues()[0].state).toBe("open")

    const failed = writeReport(dir, "b.json", {
      runId: "999",
      repo: "o/r",
      found: false,
      error: "gh fora do ar",
    })
    const res = run(dir, fake.binDir, [failed])

    expect(res.status, res.stderr).toBe(0)
    expect(res.stdout).toContain("NÃO reconciliando")
    expect(fake.issues()[0].state).toBe("open")
    expect(fake.callsOf("close")).toHaveLength(0)
  })

  it("--no-reconcile publica mas não fecha (quem fecha é o job com TODOS os relatórios)", () => {
    const dir = mkdtempSync(join(tmpdir(), "mti-run-"))
    tmpDirs.push(dir)
    const fake = makeFakeGh()
    run(dir, fake.binDir, [writeReport(dir, "a.json", trend())])

    const healthy = writeReport(dir, "b.json", trend({ warned: false, driftPct: 1 }))
    const res = spawnSync(process.execPath, [SCRIPT, "--report", healthy, "--no-reconcile"], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, PATH: `${fake.binDir}:${process.env.PATH ?? ""}` },
    })

    expect(res.status, res.stderr).toBe(0)
    expect(res.stdout).toContain("--no-reconcile")
    expect(fake.issues()[0].state).toBe("open")
  })

  it("--dry-run imprime o corpo e não toca o gh (nem exige credencial)", () => {
    const dir = mkdtempSync(join(tmpdir(), "mti-run-"))
    tmpDirs.push(dir)
    const fake = makeFakeGh()
    const res = spawnSync(
      process.execPath,
      [SCRIPT, "--report", writeReport(dir, "a.json", trend()), "--dry-run"],
      {
        cwd: dir,
        encoding: "utf8",
        env: { ...process.env, PATH: `${fake.binDir}:${process.env.PATH ?? ""}` },
      },
    )

    expect(res.status, res.stderr).toBe(0)
    expect(res.stdout).toContain("dry-run")
    expect(res.stdout).toContain("50.0%")
    expect(fake.callsOf("list")).toHaveLength(0)
    expect(fake.issues()).toHaveLength(0)
  })
})
