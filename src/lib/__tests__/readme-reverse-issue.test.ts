/**
 * readme-reverse-issue.test.ts
 *
 * Testes do scripts/readme-reverse-issue.mjs — publica achados NOVOS de
 * drift semântico do README (detectados pelo guard semanal
 * readme-reverse-audit via check-readme-reverse-baseline.mjs) como GitHub
 * Issues acionáveis (gh issue create, label readme-drift), transformando o
 * "job falhou" (alerta mudo) em ticket com o link + a sugestão do heading.
 *
 * Cobre:
 *   - buildIssueTitle: estável (file+slug+label, SEM linha — o README cresce)
 *   - buildIssueBody: link, heading atual, sugestão do heading correto e o
 *     marcador <!-- readme-drift:signature --> (dedup de próximas runs)
 *   - filterNewToCreate: dedup por assinatura (issue aberta → NÃO duplica)
 *   - CLI --dry-run: com report pré-gerado (--report), imprime o que criaria
 *     SEM chamar gh (sem rede) — exit 0
 *   - CLI --dry-run: report SEM achados novos → exit 0 sem output de issue
 *   - Contrato de assinatura: o marcador usa a MESMA signatureOf do baseline
 *     guard (importada — sem drift entre dedup e baseline)
 */

import { describe, it, expect, afterEach } from "vitest"
import { spawnSync } from "node:child_process"
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import {
  buildIssueTitle,
  buildIssueBody,
  filterNewToCreate,
  hasAnyMarker,
  isExpired,
  markerOf,
  resolutionComment,
  signaturesOf,
  ISSUE_LABEL,
} from "../../../scripts/readme-reverse-issue.mjs"
import { signatureOf } from "../../../scripts/check-readme-reverse-baseline.mjs"

const SCRIPT = resolve(process.cwd(), "scripts/readme-reverse-issue.mjs")
const tmpDirs: string[] = []

function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "rri-"))
  tmpDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

// ── buildIssueTitle ──────────────────────────────────────────────────────

describe("buildIssueTitle", () => {
  it("identifica o link por file+slug+label, SEM linha (estável entre runs)", () => {
    const f = { file: "README.md", line: 40, slug: "normalizador", label: "CRLF Guard" }
    expect(buildIssueTitle(f)).toBe(
      "README drift semântico: [CRLF Guard](#normalizador) → heading errado (README.md)",
    )
  })

  it("não depende da linha (o README cresce e as linhas migram)", () => {
    const a = buildIssueTitle({ file: "README.md", line: 10, slug: "x", label: "X" })
    const b = buildIssueTitle({ file: "README.md", line: 999, slug: "x", label: "X" })
    expect(a).toBe(b)
  })
})

// ── buildIssueBody ───────────────────────────────────────────────────────

describe("buildIssueBody", () => {
  const f = {
    file: "README.md",
    line: 40,
    slug: "normalizador",
    label: "CRLF Guard",
    heading: "Normalizador",
    suggestion: "crlf-guard",
  }

  it("inclui link, heading atual e a sugestão do heading correto", () => {
    const body = buildIssueBody(f)
    expect(body).toContain("README.md:40")
    expect(body).toContain("[CRLF Guard](#normalizador)")
    expect(body).toContain("Normalizador")
    // formato real da sugestão: heading mais provável com slug em code
    expect(body).toContain("Sugestão (heading mais provável)")
    expect(body).toContain("#crlf-guard")
    expect(body).toContain("readme-reverse-baseline.json")
  })

  it("inclui o marcador de assinatura com a MESMA signatureOf do baseline (dedup sem drift)", () => {
    const body = buildIssueBody(f)
    expect(body).toContain(`<!-- readme-drift:${signatureOf(f)} -->`)
    expect(signatureOf(f)).toBe("README.md:normalizador:CRLF Guard")
  })

  it("sem sugestão → omite o bloco de sugestão mas mantém o marcador", () => {
    const body = buildIssueBody({ ...f, suggestion: null })
    expect(body).not.toContain("Sugestão (heading mais provável)")
    expect(body).toContain(`<!-- readme-drift:${signatureOf(f)} -->`)
  })
})

// ── filterNewToCreate (dedup por assinatura) ─────────────────────────────

describe("filterNewToCreate", () => {
  const f1 = { file: "README.md", slug: "normalizador", label: "CRLF Guard" }
  const f2 = { file: "README.md", slug: "gate", label: "Guard" }

  it("issue aberta com o marcador → achado NÃO duplica (dívida até fechar)", () => {
    const bodies = [`Algum texto\n<!-- readme-drift:${signatureOf(f1)} -->\nfim`]
    expect(filterNewToCreate([f1, f2], bodies)).toEqual([f2])
  })

  it("sem issue aberta → todos os achados novos são criados", () => {
    expect(filterNewToCreate([f1, f2], [])).toEqual([f1, f2])
  })

  it("marcador com assinatura de OUTRO achado não exime", () => {
    const bodies = [`<!-- readme-drift:README.md:gate:Guard -->`]
    expect(filterNewToCreate([f1], bodies)).toEqual([f1])
  })
})

// ── CLI --dry-run (sem rede: report pré-gerado via --report) ─────────────

describe("readme-reverse-issue.mjs CLI (--dry-run)", () => {
  it("report com achados novos → exit 0, imprime [dry-run] por achado, SEM chamar gh", () => {
    const dir = makeTmpDir()
    const report = {
      count: 2,
      baselineCount: 1,
      newCount: 1,
      newFindings: [
        {
          file: "README.md",
          line: 40,
          slug: "normalizador",
          label: "CRLF Guard",
          heading: "Normalizador",
          suggestion: "crlf-guard",
        },
      ],
    }
    const reportPath = join(dir, "report.json")
    writeFileSync(reportPath, JSON.stringify(report), "utf8")
    const res = spawnSync(process.execPath, [SCRIPT, "--dry-run", "--report", reportPath], {
      encoding: "utf8",
    })
    expect(res.status).toBe(0)
    expect(res.stdout ?? "").toContain("[dry-run] criaria issue")
    expect(res.stdout ?? "").toContain("CRLF Guard")
    expect(res.stdout ?? "").toContain("nenhuma chamada gh feita")
  })

  it("report SEM achados novos → exit 0, mensagem de nenhuma issue, sem [dry-run]", () => {
    const dir = makeTmpDir()
    const report = { count: 0, baselineCount: 0, newCount: 0, newFindings: [] }
    const reportPath = join(dir, "report.json")
    writeFileSync(reportPath, JSON.stringify(report), "utf8")
    const res = spawnSync(process.execPath, [SCRIPT, "--dry-run", "--report", reportPath], {
      encoding: "utf8",
    })
    expect(res.status).toBe(0)
    expect(res.stdout ?? "").toContain("nenhum achado NOVO")
    expect(res.stdout ?? "").not.toContain("[dry-run]")
  })

  it("--report AUSENTE → exit 1 (fail-closed) com mensagem clara", () => {
    const dir = makeTmpDir()
    const res = spawnSync(
      process.execPath,
      [SCRIPT, "--dry-run", "--report", join(dir, "nope.json")],
      {
        encoding: "utf8",
      },
    )
    expect(res.status).toBe(1)
    expect(res.stderr ?? "").toContain("--report ausente")
  })
})

// ── a reconciliação: fechar a dívida quando o achado caduca ───────────────

describe("markerOf / hasAnyMarker / signaturesOf", () => {
  const f = { file: "README.md", slug: "normalizador", label: "CRLF Guard" }

  it("o marcador é TEXTO SIMPLES (compatível com as issues já abertas)", () => {
    // Migrar para base64 tornaria as issues abertas invisíveis para o dedup e
    // para o fechamento — abrindo duplicatas justamente das dívidas vivas.
    expect(markerOf(signatureOf(f))).toBe("<!-- readme-drift:README.md:normalizador:CRLF Guard -->")
  })

  it("extrai a assinatura (que contém `:`) do corpo e dos comentários", () => {
    const issue = {
      body: `texto\n${markerOf("README.md:normalizador:CRLF Guard")}\nfim`,
      comments: [{ body: markerOf("README.md:gate:Guard") }],
    }
    expect(signaturesOf(issue)).toEqual([
      "README.md:normalizador:CRLF Guard",
      "README.md:gate:Guard",
    ])
  })

  it("reconhece o que é NOSSO (e ignora o que não tem marcador)", () => {
    expect(hasAnyMarker(markerOf("x"))).toBe(true)
    expect(hasAnyMarker("corpo sem marcador")).toBe(false)
    expect(hasAnyMarker(undefined)).toBe(false)
    expect(signaturesOf({ body: "sem marcador" })).toEqual([])
  })
})

describe("isExpired — o achado que sumiu do report não é mais dívida", () => {
  const f = { file: "README.md", slug: "normalizador", label: "CRLF Guard" }
  const issue = { body: markerOf(signatureOf(f)) }

  it("achado ainda reportado → a issue fica ABERTA", () => {
    expect(isExpired(issue, new Set([signatureOf(f)]))).toBe(false)
  })

  it("achado corrigido/registrado no baseline → a dívida CADUCOU", () => {
    expect(isExpired(issue, new Set())).toBe(true)
  })

  it("issue SEM assinatura nenhuma não é fechada (não é nossa para fechar)", () => {
    expect(isExpired({ body: "sem marcador" }, new Set())).toBe(false)
  })
})

describe("resolutionComment — a prova entra antes do fechamento", () => {
  it("diz o motivo, lista as assinaturas e como reconferir", () => {
    const comment = resolutionComment(["README.md:normalizador:CRLF Guard"])
    expect(comment).toContain("Resolvido")
    expect(comment).toContain("corrigido")
    expect(comment).toContain("baseline")
    expect(comment).toContain("README.md:normalizador:CRLF Guard")
    expect(comment).toContain("check-readme-reverse-baseline.mjs --json")
    expect(comment).toContain("abre uma issue nova")
  })
})

describe("readme-reverse-issue.mjs — contrato do label", () => {
  it("ISSUE_LABEL é readme-drift (constante usada no gh issue create e no dedup)", () => {
    expect(ISSUE_LABEL).toBe("readme-drift")
  })

  it("o script existe e o baseline guard (com signatureOf) também — os dois lados do dedup", () => {
    expect(existsSync(SCRIPT)).toBe(true)
    expect(existsSync(resolve(process.cwd(), "scripts/check-readme-reverse-baseline.mjs"))).toBe(
      true,
    )
    // prova que o import de signatureOf funciona no runtime (não só no typecheck)
    expect(typeof signatureOf).toBe("function")
    expect(readFileSync(SCRIPT, "utf8")).toContain("import { signatureOf }")
  })
})

// ── o gh DUBLÊ: a única forma de provar o fechamento entre runs ───────────
//
// POR QUE UM CLI DUBLÊ E NÃO UMA FUNÇÃO INJETADA: o ciclo não é uma conta — a
// run 2 precisa enxergar o que a run 1 criou. Com o `gh` dublado por função,
// cada teste começa do zero e o fechamento nunca acontece; é justamente entre
// runs que a dívida fica mentindo no board.

interface FakeGhIssue {
  number: number
  title: string
  body: string
  labels: string[]
  state: "open" | "closed"
  comments: { body: string }[]
}

function makeFakeGh(initial: FakeGhIssue[] = []) {
  const binDir = mkdtempSync(join(tmpdir(), "gh-fake-rri-"))
  tmpDirs.push(binDir)
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

  return {
    binDir,
    issues: (): FakeGhIssue[] => JSON.parse(readFileSync(statePath, "utf8")) as FakeGhIssue[],
    callsOf: (verb: string): string[][] =>
      readFileSync(logPath, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as string[])
        .filter((c) => c[0] === "issue" && c[1] === verb),
  }
}

const FINDING = {
  file: "README.md",
  line: 40,
  slug: "normalizador",
  label: "CRLF Guard",
  heading: "Normalizador",
  suggestion: "crlf-guard",
}

function writeReport(dir: string, name: string, newFindings: object[]) {
  const path = join(dir, name)
  writeFileSync(
    path,
    JSON.stringify({
      count: newFindings.length,
      baselineCount: 0,
      newCount: newFindings.length,
      newFindings,
    }),
    "utf8",
  )
  return path
}

describe("CLI + gh dublê — o ciclo fecha quando o achado caduca", () => {
  function run(dir: string, binDir: string, reportPath: string) {
    return spawnSync(process.execPath, [SCRIPT, "--report", reportPath], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, PATH: `${binDir}:${process.env.PATH ?? ""}` },
    })
  }

  it("cria a issue e, quando o achado some do report, COMENTA a prova e FECHA", () => {
    const dir = makeTmpDir()
    const fake = makeFakeGh()
    const withFinding = writeReport(dir, "a.json", [FINDING])
    const resolved = writeReport(dir, "b.json", [])

    const created = run(dir, fake.binDir, withFinding)
    expect(created.status, created.stderr).toBe(0)
    expect(created.stdout).toContain("issue criada")
    expect(fake.issues()).toHaveLength(1)
    expect(fake.issues()[0].state).toBe("open")

    const closed = run(dir, fake.binDir, resolved)
    expect(closed.status, closed.stderr).toBe(0)
    expect(closed.stdout).toContain("issue #1 fechada")
    expect(fake.issues()[0].state).toBe("closed")
    // A prova entra ANTES do fechamento e fica no comentário.
    expect(fake.issues()[0].comments.at(-1)?.body).toContain("Resolvido")
    expect(fake.issues()[0].comments.at(-1)?.body).toContain(signatureOf(FINDING))
    expect(fake.callsOf("close")).toHaveLength(1)

    // Run seguinte: nada a fechar, nenhuma escrita nova.
    const again = run(dir, fake.binDir, resolved)
    expect(again.stdout).toContain("nenhuma dívida aberta")
    expect(fake.callsOf("close")).toHaveLength(1)
  })

  it("achado que CONTINUA reportado → a issue fica aberta (nada de fechar dívida viva)", () => {
    const dir = makeTmpDir()
    const fake = makeFakeGh()
    const report = writeReport(dir, "a.json", [FINDING])

    expect(run(dir, fake.binDir, report).status).toBe(0)
    const second = run(dir, fake.binDir, report)

    expect(second.status, second.stderr).toBe(0)
    expect(second.stdout).toContain("já com issue aberta")
    expect(fake.issues()[0].state).toBe("open")
    expect(fake.callsOf("close")).toHaveLength(0)
    expect(fake.callsOf("create")).toHaveLength(1)
  })

  it("issue ALHEIA com o label (sem marcador) não é fechada — e o log diz por quê", () => {
    const dir = makeTmpDir()
    const fake = makeFakeGh([
      {
        number: 9,
        title: "outra coisa",
        body: "sem marcador",
        labels: [ISSUE_LABEL],
        state: "open",
        comments: [{ body: "comentário de outra pessoa" }],
      },
    ])

    const res = run(dir, fake.binDir, writeReport(dir, "empty.json", []))

    expect(res.status, res.stderr).toBe(0)
    expect(res.stdout).toContain("NÃO foi aberta por este script")
    expect(fake.issues()[0].state).toBe("open")
    expect(fake.callsOf("close")).toHaveLength(0)
  })
})
