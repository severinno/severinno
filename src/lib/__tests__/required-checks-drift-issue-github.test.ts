/**
 * Prova de que o drift do branch protection FECHA sozinho no GITHUB quando o
 * manifesto volta a bater — a outra metade de
 * `required-checks-drift-issue-gitea.test.ts`.
 *
 * POR QUE FALTAVA: o fechamento automático vem do contrato compartilhado
 * (`issue-publish.mjs`), mas só a forja (Gitea) era provada, com o CLI real
 * contra um Gitea dublê. No lado GitHub a única asserção era a de SELEÇÃO
 * (`backendFor({ backend: "github" }).name === "github"`). Selecionar não é
 * fechar: entre as duas coisas há `gh issue list` (o dedup), `comment` (a prova)
 * e `close` — e é essa costura, no default do CLI e no default do workflow do
 * cron, que este arquivo prova.
 *
 * POR QUE UM `gh` DUBLÊ NO PATH (e não uma função injetada): o ciclo não é uma
 * conta — a run 2 precisa enxergar o que a run 1 deixou. Com o `gh` dublado por
 * função, cada caso começa do zero e o fechamento ENTRE RUNS nunca acontece, que
 * é exatamente onde a dívida fica mentindo no board. O dublê é um executável de
 * verdade num diretório temporário e de estado, então quem roda é o CLI REAL do
 * repositório — sem `--backend`, como o workflow semanal faz.
 *
 * O que fecha é o MESMO contrato da forja: a prova COMPARADA (o que o manifesto
 * exigia × a diferença medida), comentada ANTES do fechamento.
 */

import { afterAll, describe, expect, it } from "vitest"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import {
  ISSUE_LABEL,
  driftTitle,
  markerOf,
  signatureOf,
} from "../../../scripts/required-checks-drift-issue.mjs"

const ROOT = process.cwd()
const SCRIPT = resolve(ROOT, "scripts", "required-checks-drift-issue.mjs")

const tmpDirs: string[] = []
afterAll(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "drift-gh-"))
  tmpDirs.push(dir)
  return dir
}

// ── o `gh` DUBLÊ: estado em disco, para o ciclo valer ENTRE runs ────────────
//
// Modela só o que o backend usa — `label create`, `issue list/create/comment/
// close` — e RECUSA qualquer outro subcomando (um `gh` que aceita tudo esconde
// justamente a chamada que mudou de forma).

interface FakeGhIssue {
  number: number
  title: string
  body: string
  labels: string[]
  state: "open" | "closed"
  comments: { body: string }[]
}

function makeFakeGh(initial: FakeGhIssue[] = []) {
  const binDir = makeTmpDir()
  const statePath = join(binDir, "issues.json")
  const logPath = join(binDir, "calls.jsonl")
  writeFileSync(statePath, JSON.stringify(initial), "utf8")
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
const flag = (name) => {
  const i = args.indexOf(name)
  return i === -1 ? null : args[i + 1]
}
const save = () => writeFileSync(STATE, JSON.stringify(state, null, 2))
const fail = (msg) => {
  process.stderr.write("gh fake: " + msg + "\\n")
  process.exit(1)
}

if (args[0] === "label" && args[1] === "create") process.exit(0)
if (args[0] !== "issue") fail("subcomando nao modelado: " + args.join(" "))

if (args[1] === "list") {
  const label = flag("--label")
  const want = flag("--state") ?? "open"
  const out = state
    .filter((i) => i.state === want && (!label || i.labels.includes(label)))
    .map(({ number, title, body, comments }) => ({ number, title, body, comments }))
  process.stdout.write(JSON.stringify(out))
  process.exit(0)
}

if (args[1] === "create") {
  const number = state.reduce((max, i) => Math.max(max, i.number), 0) + 1
  state.push({
    number,
    title: flag("--title") ?? "",
    body: flag("--body") ?? "",
    labels: [flag("--label")],
    state: "open",
    comments: [],
  })
  save()
  process.stdout.write("https://github.com/severinno/severinno/issues/" + number + "\\n")
  process.exit(0)
}

if (args[1] === "comment" || args[1] === "close") {
  const issue = state.find((i) => String(i.number) === args[2])
  if (!issue) fail("issue #" + args[2] + " nao existe")
  if (args[1] === "comment") issue.comments.push({ body: flag("--body") ?? "" })
  else issue.state = "closed"
  save()
  process.exit(0)
}

fail("comando nao modelado: " + args.join(" "))
`,
    { mode: 0o755 },
  )

  const readLog = (): string[][] =>
    readFileSync(logPath, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as string[])

  return {
    binDir,
    issues: (): FakeGhIssue[] => JSON.parse(readFileSync(statePath, "utf8")) as FakeGhIssue[],
    calls: readLog,
    callsOf: (verb: string): string[][] =>
      readLog().filter((c) => c[0] === "issue" && c[1] === verb),
  }
}

// ── relatórios (a mesma forma do `apply-required-checks --check --json`) ────

const DESIRED = ["Repo Guards", "PII Allowlist Guard", "TypeCheck (tsc --noEmit)"]

function report({ inSync }: { inSync: boolean }) {
  return {
    mode: "CHECK",
    manifest: "ci/required-checks.json",
    branches: ["main"],
    drift: !inSync,
    forges: {
      github: {
        workflow: ".github/workflows/ci.yml",
        desired: DESIRED,
        branches: [
          {
            branch: "main",
            configured: true,
            inSync,
            missing: inSync ? [] : ["PII Allowlist Guard"],
            extra: [],
            applied: false,
          },
        ],
      },
    },
    errors: [],
  }
}

function writeReport(name: string, contents: unknown): string {
  const dir = tmpDirs.length > 0 ? tmpDirs[0] : makeTmpDir()
  const path = join(dir, name)
  writeFileSync(path, JSON.stringify(contents, null, 2), "utf8")
  return path
}

/** Roda o CLI REAL, com o `gh` dublê à frente do PATH. Sem `--backend`. */
function run(binDir: string, reportPath: string, extra: string[] = []) {
  return spawnSync(process.execPath, [SCRIPT, "--report", reportPath, ...extra], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, PATH: `${binDir}:${process.env.PATH ?? ""}` },
  })
}

describe("o drift de required checks fecha sozinho no GitHub (CLI real + gh dublê)", () => {
  it("run 1 abre a dívida; run 2 (em sincronia) COMENTA a prova e FECHA", () => {
    const fake = makeFakeGh()
    const drifted = report({ inSync: false })
    const synced = report({ inSync: true })

    const created = run(fake.binDir, writeReport("drift.json", drifted))
    expect(created.status, created.stderr).toBe(0)
    expect(fake.issues()).toHaveLength(1)

    const opened = fake.issues()[0]
    expect(opened.title).toBe(driftTitle())
    expect(opened.labels).toEqual([ISSUE_LABEL])
    // O marcador é o CONTRATO do dedup e do fechamento: sem ele na issue, a run
    // 2 não a reconheceria como NOSSA e a dívida ficaria aberta para sempre.
    expect(opened.body).toContain(markerOf(signatureOf(drifted)))

    const closed = run(fake.binDir, writeReport("synced.json", synced))
    expect(closed.status, closed.stderr).toBe(0)
    expect(closed.stdout).toContain("issue #1 fechada")
    expect(fake.issues()[0].state).toBe("closed")

    // A prova COMPARADA no comentário: os dois lados, não só "resolvido".
    const proof = fake.issues()[0].comments.at(-1)?.body ?? ""
    expect(proof).toContain("Resolvido")
    expect(proof).toContain("github")
    expect(proof).toContain("em sincronia")
    expect(proof).toContain("exigidos pelo manifesto")
    for (const context of DESIRED) expect(proof).toContain(context)

    expect(fake.callsOf("close")).toEqual([["issue", "close", "1", "--reason", "completed"]])
  })

  it("a prova entra ANTES do fechamento (o pior caso é dívida aberta COM a prova)", () => {
    const fake = makeFakeGh([
      {
        number: 7,
        title: driftTitle(),
        body: `corpo\n${markerOf(signatureOf(report({ inSync: false })))}\n`,
        labels: [ISSUE_LABEL],
        state: "open",
        comments: [],
      },
    ])

    const closed = run(fake.binDir, writeReport("synced.json", report({ inSync: true })))
    expect(closed.status, closed.stderr).toBe(0)

    // Se o fechamento viesse primeiro e o comentário falhasse, a issue ficaria
    // fechada SEM dizer por quê — o modo de falha que a ordem do contrato evita.
    const all = fake.calls()
    const commentAt = all.findIndex((c) => c[0] === "issue" && c[1] === "comment")
    const closeAt = all.findIndex((c) => c[0] === "issue" && c[1] === "close")
    expect(commentAt).toBeGreaterThanOrEqual(0)
    expect(closeAt).toBeGreaterThan(commentAt)
    expect(fake.issues()[0].comments.at(-1)?.body).toContain("Resolvido")
  })

  it("run seguinte sem dívida: nada a fechar e NENHUMA escrita nova (idempotente)", () => {
    const fake = makeFakeGh()
    const synced = report({ inSync: true })

    expect(run(fake.binDir, writeReport("d.json", report({ inSync: false }))).status).toBe(0)
    expect(run(fake.binDir, writeReport("s.json", synced)).status).toBe(0)
    const afterClose = fake.calls().length

    const again = run(fake.binDir, writeReport("s2.json", synced))
    expect(again.status, again.stderr).toBe(0)
    expect(again.stdout).toContain("nenhuma dívida aberta")

    // A única chamada é a LISTAGEM — é ela que decide se há dívida a fechar.
    const rest = fake.calls().slice(afterClose)
    expect(rest).toEqual([
      [
        "issue",
        "list",
        "--label",
        ISSUE_LABEL,
        "--state",
        "open",
        "--limit",
        "100",
        "--json",
        "number,title,body,comments,createdAt",
      ],
    ])
    expect(fake.callsOf("close")).toHaveLength(1)
  })

  it("issue ALHEIA com o label (sem marcador) não é fechada — e o log diz por quê", () => {
    const fake = makeFakeGh([
      {
        number: 42,
        title: "outra coisa",
        body: "sem marcador nenhum",
        labels: [ISSUE_LABEL],
        state: "open",
        comments: [{ body: "comentário de outra pessoa" }],
      },
    ])

    const res = run(fake.binDir, writeReport("synced.json", report({ inSync: true })))

    expect(res.status, res.stderr).toBe(0)
    expect(res.stdout).toContain("NÃO foi aberta por este script")
    expect(fake.issues()[0].state).toBe("open")
    expect(fake.callsOf("comment")).toEqual([])
    expect(fake.callsOf("close")).toEqual([])
  })

  it("--dry-run sem drift não chama o gh (só DIZ o que a reconciliação faria)", () => {
    const fake = makeFakeGh([
      {
        number: 3,
        title: driftTitle(),
        body: `corpo\n${markerOf(signatureOf(report({ inSync: false })))}\n`,
        labels: [ISSUE_LABEL],
        state: "open",
        comments: [],
      },
    ])

    const res = run(fake.binDir, writeReport("synced.json", report({ inSync: true })), [
      "--dry-run",
    ])

    expect(res.status, res.stderr).toBe(0)
    expect(res.stdout).toContain("reconciliação fecharia")
    expect(fake.calls()).toEqual([])
    expect(fake.issues()[0].state).toBe("open")
  })
})
