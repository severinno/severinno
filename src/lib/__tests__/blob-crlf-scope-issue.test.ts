/**
 * blob-crlf-scope-issue.test.ts
 *
 * Testes do scripts/blob-crlf-scope-issue.mjs — o publicador que transforma o
 * ALCANCE do CRLF no histórico (o `--all-text` do audit) em ISSUE acionável,
 * no job semanal `blob-crlf-all-text-alert` do benchmark-weekly.yml.
 *
 * O que precisa ser provado (o script pode "parecer" certo e não alertar):
 *   1. o PARSER do relatório do audit é fiel — conta os achados
 *      (`<hash>  <path>`), inclusive com espaços no path, e NÃO confunde o
 *      resumo/prosa com achado;
 *   2. a assinatura do alcance é ESTÁVEL (mesmo conjunto → mesma assinatura) e
 *      o dedup entre runs não duplica issue;
 *   3. `não medido ≠ resolvido`: um audit quebrado (exit != 0) NÃO publica e
 *      NÃO fecha — a guarda do fechamento;
 *   4. o corpo é ACIONÁVEL (lista os blobs, os tipos e o remédio de reescrita);
 *   5. o workflow REAL invoca o script com `if: always()` e o relatório/exit do
 *      audit, e o `ci/periodic-alerts.json` classifica o job como canal `issue`.
 */

import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterAll, describe, expect, it } from "vitest"

import {
  CRLF_SCOPE_PUBLISHER,
  ISSUE_LABEL,
  MARKER_PREFIX,
  collectReport,
  driftTitle,
  hasAnyMarker,
  hasSignature,
  issueHasAnyMarker,
  issueHasSignature,
  markerOf,
  parseAuditOutput,
  reconcileDebt,
  resolutionComment,
  scopeBody,
  scopeOf,
  scopeProse,
  signatureOf,
  typeOf,
} from "../../../scripts/blob-crlf-scope-issue.mjs"
import { getJob, getSteps, readWorkflowContent, loadWorkflow } from "./helpers/workflow-execution"
import { MANIFEST_PATH, jobBlock } from "../../../scripts/check-periodic-alerts.mjs"

const ROOT = process.cwd()
const SCRIPT = join(ROOT, "scripts", "blob-crlf-scope-issue.mjs")
const WF = ".github/workflows/benchmark-weekly.yml"
const JOB = "blob-crlf-all-text-alert"

const tmpDirs: string[] = []
afterAll(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/**
 * Hashes de blob no formato do produtor (12 hex). O parser exige um hash
 * plausível na linha de achado — é o que separa uma linha de ACHADO do resumo e
 * da prosa do REPORT.
 */
const H1 = "a1b2c3d4e5f6"
const H2 = "1122334455aa"
const H3 = "998877665544"

/** Um stdout de audit com achados (o formato REAL do produtor: `<hash>  <path>`). */
function foundOutput(entries: [string, string][]): string {
  const lines = entries.map(([blob, path]) => `${blob}  ${path}`)
  return (
    lines.join("\n") +
    `\n\n${entries.length} bloco(s) com CRLF no histórico (escopo: *.md,*.ts).\n` +
    "Modo REPORT (--all-text): CRLF em tipos benignos não quebra toolchain —\n" +
    "o gate de CI é o .sh/.bash (default). Correção retroativa: ver README.\n"
  )
}

/** Um stdout de audit limpo (o formato REAL do produtor no caminho sem achados). */
function cleanOutput(scanned = 2962): string {
  return (
    `OK — ${scanned} blobs únicos sem CRLF no histórico ` +
    "(rev-list --all; escopo: *.md,*.ts,Makefile).\n"
  )
}

/** Um relatório a partir de um stdout (medido, exit 0), sem tocar o histórico. */
function reportOf(stdout: string, exit = 0) {
  return collectReport({ reportText: stdout, reportExit: exit })
}

// ── 1. Parser do relatório do audit ───────────────────────────────────────

describe("parseAuditOutput — o relatório do produtor é lido fielmente", () => {
  it("extrai blob e path de cada linha de achado", () => {
    const { findings } = parseAuditOutput(foundOutput([["a1b2c3d4e5f6", "docs/x.md"]]))
    expect(findings).toEqual([{ blob: "a1b2c3d4e5f6", path: "docs/x.md" }])
  })

  it("preserva path com ESPAÇOS (o separador é o par de espaços, não o path)", () => {
    const { findings } = parseAuditOutput(foundOutput([[H2, "docs/legacy/nota antiga.md"]]))
    expect(findings[0].path).toBe("docs/legacy/nota antiga.md")
  })

  it("NÃO confunde a linha de resumo nem a prosa do REPORT com achado", () => {
    const { findings, foundCount } = parseAuditOutput(foundOutput([["a1b2c3d4e5f6", "x.md"]]))
    expect(findings).toHaveLength(1)
    expect(foundCount).toBe(1)
  })

  it("no caminho limpo devolve o total varrido e nenhum achado", () => {
    const { findings, scanned } = parseAuditOutput(cleanOutput(1234))
    expect(findings).toEqual([])
    expect(scanned).toBe(1234)
  })
})

describe("typeOf / scopeOf — o alcance em tipos e paths", () => {
  it("deriva a extensão (com ponto) e o basename quando não há extensão", () => {
    expect(typeOf("src/a/b/thing.ts")).toBe(".ts")
    expect(typeOf("Makefile")).toBe("Makefile")
    expect(typeOf(".prettierignore")).toBe(".prettierignore")
  })

  it("agrega paths e tipos ÚNICOS e ordenados (a assinatura depende da ordem)", () => {
    const scope = scopeOf([
      { blob: H1, path: "b.ts" },
      { blob: H2, path: "a.md" },
      { blob: H3, path: "a.md" },
    ])
    expect(scope.paths).toEqual(["a.md", "b.ts"])
    expect(scope.types).toEqual([".md", ".ts"])
    expect(scope.count).toBe(3)
  })
})

// ── 2. collectReport / assinatura ─────────────────────────────────────────

describe("collectReport — medido vs não medido", () => {
  it("exit 0 → medido, com os achados do relatório", () => {
    const report = reportOf(foundOutput([["a1b2c3d4e5f6", "x.md"]]))
    expect(report.measured).toBe(true)
    expect(report.measuredExit).toBe(0)
    expect(report.scope.paths).toEqual(["x.md"])
  })

  it("exit != 0 → NÃO medido (uma auditoria quebrada não é evidência de limpo)", () => {
    const report = reportOf(foundOutput([["a1b2c3d4e5f6", "x.md"]]), 2)
    expect(report.measured).toBe(false)
    expect(report.measuredExit).toBe(2)
  })

  it("o exit nulo do spawn vira 2 (fail-closed), nunca 0", () => {
    const report = collectReport({
      runAudit: () => ({ status: null, stdout: "", stderr: "ENOENT" }),
    })
    expect(report.measured).toBe(false)
    expect(report.measuredExit).toBe(2)
  })
})

describe("signatureOf — o dedup depende dela ser estável", () => {
  it("a ORDEM dos achados não muda a assinatura (duas runs do mesmo alcance)", () => {
    const a = reportOf(
      foundOutput([
        [H1, "a.md"],
        [H2, "b.ts"],
      ]),
    )
    const b = reportOf(
      foundOutput([
        [H2, "b.ts"],
        [H1, "a.md"],
      ]),
    )
    expect(signatureOf(a)).toBe(signatureOf(b))
  })

  it("um achado NOVO muda a assinatura (a dívida mudou; comentar é o correto)", () => {
    const a = reportOf(foundOutput([[H1, "a.md"]]))
    const b = reportOf(
      foundOutput([
        [H1, "a.md"],
        [H2, "b.ts"],
      ]),
    )
    expect(signatureOf(a)).not.toBe(signatureOf(b))
  })

  it("alcance limpo → assinatura vazia (é o sinal de 'não publica nada')", () => {
    expect(signatureOf(reportOf(cleanOutput()))).toBe("")
  })
})

// ── 3. A guarda do contrato: não medido ≠ resolvido ───────────────────────

describe("CRLF_SCOPE_PUBLISHER — as duas guardas do contrato", () => {
  // `defineDebtPublisher` é JS puro: o tipo é `object`. Este recorte declara só
  // o que os testes leem, sem afrouxar o resto.
  const PUB = CRLF_SCOPE_PUBLISHER as unknown as {
    actionable: (input: unknown) => boolean
    scope: { kind: string }
    resolution: { when: (input: unknown) => boolean }
  }

  it("acionável SÓ com medição válida E achados", () => {
    const found = reportOf(foundOutput([[H1, "a.md"]]))
    expect(PUB.actionable(found)).toBe(true)
    expect(PUB.actionable(reportOf(cleanOutput()))).toBe(false)
    // Com achado MAS audit quebrado: NÃO publica (medição não confiável).
    expect(PUB.actionable(reportOf(foundOutput([[H1, "a.md"]]), 2))).toBe(false)
  })

  it("resolution.when: NÃO fecha sem uma medição que terminou", () => {
    expect(PUB.resolution.when(reportOf(cleanOutput()))).toBe(true)
    expect(PUB.resolution.when(reportOf(cleanOutput(), 2))).toBe(false)
  })

  it("o escopo é SINGLE (o alcance é UM estado do histórico, não um item por blob)", () => {
    expect(PUB.scope.kind).toBe("single")
  })
})

// ── 4. marcador (o selo de quem escreveu) ─────────────────────────────────

describe("markerOf / hasSignature", () => {
  it("o marcador da assinatura sobrevive ao round-trip no corpo", () => {
    const signature = signatureOf(
      reportOf(
        foundOutput([
          [H1, "a.md"],
          [H2, "b.ts"],
        ]),
      ),
    )
    expect(hasSignature(`corpo\n${markerOf(signature)}\n`, signature)).toBe(true)
    expect(hasAnyMarker(`corpo\n${markerOf(signature)}\n`)).toBe(true)
    expect(MARKER_PREFIX).toContain("blob-crlf-scope-drift")
  })

  it("marcador de OUTRO alcance não exime a publicação", () => {
    const mine = signatureOf(reportOf(foundOutput([[H1, "a.md"]])))
    const other = markerOf(signatureOf(reportOf(foundOutput([[H2, "z.ts"]]))))
    expect(hasSignature(`corpo\n${other}\n`, mine)).toBe(false)
  })

  it("corpo ausente/não-string não exime", () => {
    expect(hasSignature(undefined, "x")).toBe(false)
  })

  it("issueHasSignature/isAnyMarker enxergam o marcador em COMENTÁRIO", () => {
    const signature = signatureOf(reportOf(foundOutput([[H1, "a.md"]])))
    const issue = {
      number: 1,
      title: driftTitle(),
      body: "sem marcador",
      comments: [{ body: markerOf(signature) }],
    }
    expect(issueHasSignature(issue, signature)).toBe(true)
    expect(issueHasAnyMarker(issue)).toBe(true)
  })
})

// ── 5. A prosa é acionável ────────────────────────────────────────────────

describe("scopeProse / resolutionComment — a issue diz o que fazer", () => {
  const report = reportOf(
    foundOutput([
      [H1, "docs/legacy/nota.md"],
      [H2, "old.ts"],
    ]),
  )

  it("o corpo lista cada blob ofensor, os tipos e o remédio de reescrita", () => {
    const body = scopeProse(report)
    expect(body).toContain("docs/legacy/nota.md")
    expect(body).toContain("a1b2c3d4e5f6")
    expect(body).toContain("`.md`")
    expect(body).toContain("`.ts`")
    expect(body).toContain("git filter-repo")
    expect(body).toContain("reescrita de história")
  })

  it("o corpo COMPLETO (com marcador) é o que a issue carrega", () => {
    const body = scopeBody(report)
    expect(hasAnyMarker(body)).toBe(true)
    expect(hasSignature(body, signatureOf(report))).toBe(true)
  })

  it("o comentário de resolução é a PROVA do estado limpo", () => {
    const comment = resolutionComment(reportOf(cleanOutput(2962)))
    expect(comment).toContain("0 blob(s) com CRLF")
    expect(comment).toContain("2962")
    expect(comment).toContain("audit:blob-crlf-history:all-text")
  })
})

// ── 6. A reconciliação contra um `gh` dublê ───────────────────────────────

describe("reconcileDebt — o alcance voltou ao limpo, o que abrimos deixa de existir", () => {
  function fakeGh({
    open = [],
    failOn = null,
  }: {
    open?: { number: number; title?: string; body?: string; comments?: { body: string }[] }[]
    failOn?: RegExp | null
  } = {}) {
    const calls: string[][] = []
    const fn = (args: string[]) => {
      calls.push(args)
      if (args[0] === "issue" && args[1] === "list") {
        return { status: 0, stdout: JSON.stringify(open), stderr: "" }
      }
      if (failOn && failOn.test(args.join(" "))) {
        return { status: 1, stdout: "", stderr: "boom" }
      }
      return { status: 0, stdout: "", stderr: "" }
    }
    return { fn, calls }
  }

  const ours = (
    number: number,
    signature = signatureOf(reportOf(foundOutput([[H1, "a.md"]]))),
  ) => ({
    number,
    title: driftTitle(),
    body: `corpo\n${markerOf(signature)}\n`,
  })
  const clean = () => reportOf(cleanOutput())
  const silent = () => {}

  it("fecha a issue que abrimos, COMENTANDO A PROVA ANTES", async () => {
    const gh = fakeGh({ open: [ours(7)] })
    const res = await reconcileDebt({ report: clean(), gh: gh.fn, log: silent })
    expect(res.closed).toEqual([7])
    const comment = gh.calls.findIndex((c) => c[1] === "comment")
    const close = gh.calls.findIndex((c) => c[1] === "close")
    expect(comment).toBeGreaterThan(-1)
    expect(close).toBeGreaterThan(comment)
  })

  it("NÃO toca em issue alheia (label aplicado à mão)", async () => {
    const gh = fakeGh({ open: [{ number: 9, title: "outra", body: "sem marcador" }] })
    const res = await reconcileDebt({ report: clean(), gh: gh.fn, log: silent })
    expect(res.closed).toEqual([])
    expect(res.foreign).toEqual([9])
  })

  it("a lista é pedida por LABEL e por estado ABERTO", async () => {
    const gh = fakeGh({ open: [] })
    await reconcileDebt({ report: clean(), gh: gh.fn, log: silent })
    expect(gh.calls[0]).toEqual([
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
    ])
  })

  it("falha no COMENTÁRIO → erro, e a issue NÃO é fechada em silêncio", async () => {
    const gh = fakeGh({ open: [ours(7)], failOn: /issue comment/ })
    await expect(reconcileDebt({ report: clean(), gh: gh.fn, log: silent })).rejects.toThrow(
      /issue comment falhou/,
    )
    expect(gh.calls.some((c) => c[1] === "close")).toBe(false)
  })
})

// ── 7. O `gh` DUBLÊ: o dedup entre runs ───────────────────────────────────
//
// O dedup não é uma conta, é um CICLO — a run 2 precisa enxergar o que a run 1
// criou. Um dublê com ESTADO em arquivo é o que prova isso.

interface FakeIssue {
  number: number
  title: string
  body: string
  labels: string[]
  state: "open" | "closed"
  comments: { body: string }[]
}

function makeFakeGh(initial: FakeIssue[] = []) {
  const binDir = mkdtempSync(join(tmpdir(), "gh-fake-crlf-"))
  tmpDirs.push(binDir)
  const statePath = join(binDir, "issues.json")
  writeFileSync(statePath, JSON.stringify(initial), "utf8")

  writeFileSync(
    join(binDir, "gh"),
    `#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs"
const STATE = ${JSON.stringify(statePath)}
const args = process.argv.slice(2)
const state = JSON.parse(readFileSync(STATE, "utf8"))
const flag = (name) => {
  const i = args.indexOf(name)
  return i === -1 ? null : args[i + 1]
}
const save = () => writeFileSync(STATE, JSON.stringify(state, null, 2))
const fail = (msg) => { process.stderr.write("gh fake: " + msg + "\\n"); process.exit(1) }
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
  state.push({ number, title: flag("--title") ?? "", body: flag("--body") ?? "", labels: [flag("--label")], state: "open", comments: [] })
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

  return {
    binDir,
    open: (): FakeIssue[] =>
      (JSON.parse(readFileSync(statePath, "utf8")) as FakeIssue[]).filter(
        (i) => i.state === "open",
      ),
    issues: (): FakeIssue[] => JSON.parse(readFileSync(statePath, "utf8")) as FakeIssue[],
  }
}

describe("CLI + gh dublê — runs repetidas do MESMO alcance não duplicam issue", () => {
  /** Escreve um relatório e roda o publisher REAL contra o `gh` fake. */
  function runReport(fake: { binDir: string }, stdout: string, extra: string[] = []) {
    const dir = mkdtempSync(join(tmpdir(), "crlf-report-"))
    tmpDirs.push(dir)
    const reportPath = join(dir, "all-text-report.txt")
    writeFileSync(reportPath, stdout, "utf8")
    return spawnSync(process.execPath, [SCRIPT, "--report", reportPath, ...extra], {
      cwd: ROOT,
      encoding: "utf8",
      env: { ...process.env, PATH: `${fake.binDir}:${process.env.PATH ?? ""}` },
    })
  }

  it("run 1 com achados → CRIA uma issue", () => {
    const fake = makeFakeGh()
    const res = runReport(fake, foundOutput([["a1b2c3d4e5f6", "docs/x.md"]]))
    expect(res.status).toBe(0)
    expect(res.stdout).toContain("Issue criada")
    expect(fake.open()).toHaveLength(1)
    expect(fake.open()[0].labels).toContain(ISSUE_LABEL)
  })

  it("run 2 com o MESMO alcance → NÃO cria e NÃO comenta", () => {
    const fake = makeFakeGh()
    const stdout = foundOutput([["a1b2c3d4e5f6", "docs/x.md"]])
    expect(runReport(fake, stdout).status).toBe(0)
    const second = runReport(fake, stdout)
    expect(second.stdout).toContain("já reportado na issue #1")
    expect(fake.open()).toHaveLength(1)
    expect(fake.issues()[0].comments).toHaveLength(0)
  })

  it("alcance que MUDOU → comenta UMA vez; repetir não comenta de novo", () => {
    const fake = makeFakeGh()
    runReport(fake, foundOutput([[H1, "a.md"]]))
    const changed = runReport(
      fake,
      foundOutput([
        [H1, "a.md"],
        [H2, "b.ts"],
      ]),
    )
    expect(changed.stdout).toContain("Comentário adicionado à issue #1")
    expect(fake.issues()[0].comments).toHaveLength(1)
    // A repetição (o marcador agora mora no COMENTÁRIO) não comenta de novo.
    runReport(
      fake,
      foundOutput([
        [H1, "a.md"],
        [H2, "b.ts"],
      ]),
    )
    expect(fake.issues()[0].comments).toHaveLength(1)
  })

  it("alcance de volta ao LIMPO → comenta a prova e FECHA o que abrimos", () => {
    const fake = makeFakeGh()
    runReport(fake, foundOutput([[H1, "a.md"]]))
    const clean = runReport(fake, cleanOutput())
    expect(clean.stdout).toContain("Reconciliado")
    expect(fake.open()).toHaveLength(0)
    expect(fake.issues()[0].state).toBe("closed")
    // A prova entra num comentário ANTES do fechamento.
    expect(fake.issues()[0].comments.some((c) => c.body.includes("0 blob(s) com CRLF"))).toBe(true)
  })

  it("audit QUEBRADO (--audit-exit 2) → não abre E não fecha (não medido ≠ resolvido)", () => {
    const fake = makeFakeGh()
    runReport(fake, foundOutput([[H1, "a.md"]])) // abre a dívida
    const broken = runReport(fake, cleanOutput(), ["--audit-exit", "2"])
    expect(broken.status).toBe(0)
    expect(broken.stdout).toContain("NÃO reconciliando")
    // A dívida continua ABERTA: uma medição quebrada não prova limpeza.
    expect(fake.open()).toHaveLength(1)
  })

  it("relatório inexistente → erro (exit 1), sem chamada ao gh", () => {
    const fake = makeFakeGh()
    const res = spawnSync(process.execPath, [SCRIPT, "--report", "/tmp/nao-existe-crlf.txt"], {
      cwd: ROOT,
      encoding: "utf8",
      env: { ...process.env, PATH: `${fake.binDir}:${process.env.PATH ?? ""}` },
    })
    expect(res.status).toBe(1)
    expect(res.stderr).toContain("inexistente")
    expect(fake.open()).toHaveLength(0)
  })
})

// ── 8. O contrato do workflow e do manifesto ──────────────────────────────

describe("workflow REAL — o job publica a issue e o manifesto a classifica", () => {
  const wf = loadWorkflow(WF)
  const content = readWorkflowContent(WF)
  const job = getJob(wf, JOB)
  const steps = getSteps(job)

  it("o step do publicador roda com `if: always()` e passa o relatório + o exit do audit", () => {
    const step = steps.find((s) => (s.run ?? "").includes("blob-crlf-scope-issue.mjs"))
    expect(step, "o publicador sumiu do job").toBeDefined()
    expect(step?.if).toContain("always()")
    expect(step?.run ?? "").toContain("--report all-text-report.txt")
    expect(step?.run ?? "").toContain("--audit-exit")
    // O relatório vem do step de REPORT (o MESMO arquivo teed).
    expect(step?.run ?? "").toContain("steps.alltext.outputs.report_exit")
  })

  it("o job tem permissão de ESCRITA em issues (sem ela a issue não nasce)", () => {
    expect((job as { permissions?: Record<string, string> }).permissions?.issues).toBe("write")
  })

  it("o manifesto classifica o job como canal `issue`, com o publicador como evidência", () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, MANIFEST_PATH), "utf8")) as {
      forges: { github: { workflow: string; job: string; channel: string; evidence: string }[] }
    }
    const entry = manifest.forges.github.find((e) => e.workflow === WF && e.job === JOB)
    expect(entry, "o job sumiu do manifesto de alerts periódicos").toBeDefined()
    expect(entry?.channel).toBe("issue")
    expect(entry?.evidence).toBe("scripts/blob-crlf-scope-issue.mjs")
    // A evidência declarada EXISTE no bloco do job (o guard exige literal).
    const block = jobBlock(content, JOB) ?? ""
    expect(block).toContain(entry?.evidence ?? "")
  })
})
