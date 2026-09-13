// =============================================================================
// actrc-sync-issue.test.ts
//
// Testes do scripts/actrc-sync-issue.mjs — o lado GitHub do guard periódico de
// espelhos: o drift de `vars.BUN_VERSION` vira ISSUE, não um `::warning::`
// dentro de um run verde.
//
// O que precisa ser provado (o script pode "parecer" certo e não alertar):
//   1. a assinatura do drift é ESTÁVEL (duas runs com o mesmo drift → mesma
//      assinatura; senão o dedup não funciona e a issue vira ruído semanal);
//   2. a fonte das regras é ÚNICA — o script importa `mirrorDriftReport` do
//      guard, então a issue e o log não podem discordar;
//   3. o corpo é ACIONÁVEL e o remédio difere por espelho (o `deploy/.env.gitea`
//      do host exige RE-REGISTRO; o template comitado, o `bump-bun.sh`);
//   4. o caso "variável não configurada" não manda rodar `bump-bun.sh` com
//      versão vazia — o remédio é CRIAR a variável;
//   5. o workflow do GitHub realmente invoca o script, com `if: always()` e
//      permissão de issue (o buraco que este script fecha é justamente esse);
//   6. a forja NÃO usa o script de issue (lá não existe canal de issue — ela
//      falha o run, de propósito).
// =============================================================================

import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterAll, describe, expect, it } from "vitest"

import {
  ISSUE_LABEL,
  driftBody,
  driftTitle,
  hasAnyMarker,
  hasSignature,
  issueBodies,
  issueHasAnyMarker,
  issueHasSignature,
  markerOf,
  reconcileDebt,
  remedyFor,
  resolutionComment,
  signatureOf,
} from "../../../scripts/actrc-sync-issue.mjs"
import { mirrorDriftReport } from "../../../scripts/check-actrc-sync.mjs"

const ROOT = process.cwd()
const SCRIPT = join(ROOT, "scripts", "actrc-sync-issue.mjs")
const GUARD = join(ROOT, "scripts", "check-actrc-sync.mjs")

const tmpDirs: string[] = []
afterAll(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** Árvore mínima da forja: `.actrc` + template com os valores que o teste quiser. */
function forgeTree({
  actrc = "1.3.14",
  template = "1.3.14",
  deployed = null,
}: { actrc?: string; template?: string; deployed?: string | null } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "actrc-sync-issue-"))
  tmpDirs.push(dir)
  mkdirSync(join(dir, "deploy"), { recursive: true })
  writeFileSync(join(dir, ".actrc"), `--var BUN_VERSION=${actrc}\n`, "utf8")
  writeFileSync(
    join(dir, "deploy", "env.gitea.example"),
    `RUNNER_TOKEN=TOK\nIMAGE_REGISTRY=ghcr.io\nIMAGE_NAMESPACE=severinno\nBUN_VERSION=${template}\n`,
    "utf8",
  )
  if (deployed !== null) {
    writeFileSync(
      join(dir, "deploy", ".env.gitea"),
      `RUNNER_TOKEN=TOK\nIMAGE_REGISTRY=ghcr.io\nIMAGE_NAMESPACE=severinno\nBUN_VERSION=${deployed}\n`,
      "utf8",
    )
  }
  return dir
}

/** O diagnóstico REAL do guard, para o corpo/assinatura serem testados sobre ele. */
function reportOf(dir: string, expected: string) {
  return mirrorDriftReport({ cwd: dir, expected })
}

describe("signatureOf — o dedup depende dela ser estável", () => {
  it("a ordem dos avisos não muda a assinatura (duas runs do mesmo drift)", () => {
    const a = signatureOf({ warnings: ["aviso 1", "aviso 2"] })
    const b = signatureOf({ warnings: ["aviso 2", "aviso 1"] })
    expect(a).toBe(b)
  })

  it("drift DIFERENTE → assinatura diferente (a dívida mudou; comentar é o correto)", () => {
    const v = reportOf(forgeTree({ template: "1.3.15" }), "1.3.14")
    const v2 = reportOf(forgeTree({ template: "1.3.16" }), "1.3.14")
    expect(signatureOf(v)).not.toBe(signatureOf(v2))
  })

  it("sem avisos → assinatura vazia (é o sinal de 'não publica nada')", () => {
    expect(signatureOf({ warnings: [] })).toBe("")
  })
})

describe("markerOf / hasSignature", () => {
  it("o marcador da assinatura sobrevive ao round-trip no corpo", () => {
    const signature = signatureOf({ warnings: ["a", "b"] })
    expect(hasSignature(`corpo\n${markerOf(signature)}\n`, signature)).toBe(true)
  })

  it("marcador de OUTRO drift não exime a publicação", () => {
    const mine = signatureOf({ warnings: ["meu"] })
    const other = markerOf(signatureOf({ warnings: ["outro"] }))
    expect(hasSignature(`corpo\n${other}\n`, mine)).toBe(false)
  })

  it("corpo ausente/não-string não exime", () => {
    expect(hasSignature(undefined, "x")).toBe(false)
  })
})

describe("issueBodies / issueHasSignature / issueHasAnyMarker — o marcador também mora em COMENTÁRIO", () => {
  const issue = (over: Record<string, unknown> = {}) => ({
    number: 1,
    body: "corpo",
    ...over,
  })

  it("os corpos são o principal E os comentários (nesta ordem)", () => {
    expect(issueBodies(issue({ comments: [{ body: "c1" }, { body: "c2" }] }))).toEqual([
      "corpo",
      "c1",
      "c2",
    ])
    expect(issueBodies(undefined)).toEqual([undefined])
  })

  it("assinatura no corpo principal → reconhecida", () => {
    const sig = signatureOf({ warnings: ["drift"] })
    expect(issueHasSignature(issue({ body: markerOf(sig) }), sig)).toBe(true)
  })

  it("assinatura num COMENTÁRIO → reconhecida (é o caso do segundo drift)", () => {
    const sig = signatureOf({ warnings: ["drift novo"] })
    const i = issue({ body: "corpo com OUTRO marcador", comments: [{ body: markerOf(sig) }] })
    expect(issueHasSignature(i, sig)).toBe(true)
  })

  it("assinatura de OUTRO drift não exime (nem no corpo nem nos comentários)", () => {
    const mine = signatureOf({ warnings: ["meu"] })
    const i = issue({
      body: markerOf(signatureOf({ warnings: ["a"] })),
      comments: [{ body: markerOf(signatureOf({ warnings: ["b"] })) }],
    })
    expect(issueHasSignature(i, mine)).toBe(false)
  })

  it("issue nossa com marcador só em comentário continua NOSSA (o fechamento depende disso)", () => {
    expect(
      issueHasAnyMarker(issue({ body: "reescrito", comments: [{ body: markerOf("algo") }] })),
    ).toBe(true)
    expect(issueHasAnyMarker(issue({ body: "sem marcador", comments: [] }))).toBe(false)
  })
})

describe("driftTitle", () => {
  it("NÃO carrega versão nem arquivo (senão cada bump abriria uma issue nova)", () => {
    const title = driftTitle()
    expect(title).not.toMatch(/\d+\.\d+\.\d+/)
    expect(title).not.toContain("env.gitea")
    expect(title).toContain("BUN_VERSION")
  })
})

describe("remedyFor — o remédio difere por espelho", () => {
  it("espelho do HOST exige RE-REGISTRO (o label é estado do registro)", () => {
    const text = remedyFor({ deployed: true })
    expect(text).toContain("--re-register")
    expect(text).toContain(".runner")
  })

  it("template comitado aponta o bump-bun.sh (um escritor para os dois espelhos)", () => {
    expect(remedyFor({ deployed: false })).toContain("bump-bun.sh")
  })
})

describe("driftBody — o ticket tem de ser acionável", () => {
  it("nomeia o esperado, cada espelho e a versão de cada um", () => {
    const dir = forgeTree({ template: "1.3.15", deployed: "1.3.15" })
    const body = driftBody(reportOf(dir, "1.3.14"))
    expect(body).toContain("vars.BUN_VERSION='1.3.14'")
    expect(body).toContain("`.actrc`: `1.3.14`")
    expect(body).toContain("`deploy/env.gitea.example` (template comitado): `1.3.15`")
    expect(body).toContain("`deploy/.env.gitea` (host): `1.3.15`")
    expect(body).toContain("### Corrigir (o remédio difere por espelho)")
    expect(body).toContain("--re-register")
  })

  it("carrega o marcador da MESMA assinatura (dedup sem drift de implementação)", () => {
    const dir = forgeTree({ template: "1.3.15" })
    const report = reportOf(dir, "1.3.14")
    expect(hasSignature(driftBody(report), signatureOf(report))).toBe(true)
  })

  it("sem divergência real → não há seção de remédio por espelho", () => {
    const body = driftBody(reportOf(forgeTree(), "1.3.14"))
    expect(body).not.toContain("### Corrigir (o remédio difere por espelho)")
  })

  it("VARIÁVEL NÃO CONFIGURADA → o remédio é criar a variável, nunca `bump-bun.sh` sem versão", () => {
    const body = driftBody(reportOf(forgeTree(), ""))
    expect(body).toContain("NÃO está configurada")
    expect(body).toContain("Settings")
    // O comando só pode aparecer COM uma versão: `bump-bun.sh` seguido de nada
    // (ou de comentário) é a instrução sem sentido que este caso tinha.
    expect(body).not.toMatch(/bump-bun\.sh\s*(?:#|$)/m)
    expect(body).toContain("bump-bun.sh <versão>")
  })
})

describe("hasAnyMarker — quem escreveu a issue (o fechamento automático depende disso)", () => {
  it("marcador de QUALQUER assinatura identifica a issue como nossa", () => {
    expect(hasAnyMarker(`corpo\n${markerOf(signatureOf({ warnings: ["a"] }))}\n`)).toBe(true)
    expect(hasAnyMarker(`corpo\n${markerOf("outra assinatura")}\n`)).toBe(true)
  })

  it("issue que só ganhou o label (sem marcador) NÃO é nossa", () => {
    expect(hasAnyMarker("issue de outra pessoa, com o label aplicado à mão")).toBe(false)
    expect(hasAnyMarker("")).toBe(false)
    expect(hasAnyMarker(undefined)).toBe(false)
  })
})

describe("resolutionComment — o desfecho carrega a prova, não só 'resolvido'", () => {
  it("nomeia a variável e CADA espelho comparado, com o valor de cada um", () => {
    const comment = resolutionComment(reportOf(forgeTree({ deployed: "1.3.14" }), "1.3.14"))
    expect(comment).toContain("vars.BUN_VERSION='1.3.14'")
    expect(comment).toContain(".actrc")
    expect(comment).toContain("deploy/env.gitea.example")
    expect(comment).toContain("deploy/.env.gitea")
    expect(comment).toContain("check-actrc-sync.mjs --expected 1.3.14")
  })

  it("declara o ESCOPO do fechamento (o host é gitignored e pode não ter sido comparado)", () => {
    const comment = resolutionComment(reportOf(forgeTree(), "1.3.14"))
    expect(comment).toContain("gitignored")
    expect(comment).toContain("ESPELHOS COMPARADOS")
    expect(comment).toContain("doctor --gitea-env")
  })

  it("diz que a recorrência abre issue NOVA (o fechamento não silencia o futuro)", () => {
    const comment = resolutionComment(reportOf(forgeTree(), "1.3.14"))
    expect(comment).toContain("Fechada automaticamente")
    expect(comment).toContain("issue nova")
  })

  it("sem NENHUM espelho de env descoberto, o comentário diz que só o .actrc entrou", () => {
    const dir = mkdtempSync(join(tmpdir(), "actrc-sync-issue-"))
    tmpDirs.push(dir)
    writeFileSync(join(dir, ".actrc"), "--var BUN_VERSION=1.3.14\n", "utf8")
    const comment = resolutionComment(reportOf(dir, "1.3.14"))
    expect(comment).toContain("só o `.actrc` entrou na comparação")
  })
})

// ── a reconciliação: fechar a dívida quando ela caduca ────────────────────

describe("reconcileDebt — sem drift, o que este script abriu deixa de existir", () => {
  /** `gh` dublê: registra as chamadas e responde conforme o roteiro. */
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

  const ours = (number: number, signature = "sig") => ({
    number,
    title: driftTitle(),
    body: `corpo\n${markerOf(signature)}\n`,
  })

  const report = () => reportOf(forgeTree(), "1.3.14")
  const silent = () => {}

  it("fecha a issue que abrimos, COMENTANDO ANTES (a prova entra antes do fechamento)", () => {
    const gh = fakeGh({ open: [ours(7)] })
    const res = reconcileDebt({ report: report(), gh: gh.fn, log: silent })
    expect(res.closed).toEqual([7])
    const comment = gh.calls.findIndex((c) => c[1] === "comment")
    const close = gh.calls.findIndex((c) => c[1] === "close")
    expect(comment).toBeGreaterThan(-1)
    expect(close).toBeGreaterThan(comment)
    expect(gh.calls[comment]).toEqual([
      "issue",
      "comment",
      "7",
      "--body",
      resolutionComment(report()),
    ])
    expect(gh.calls[close]).toEqual(["issue", "close", "7", "--reason", "completed"])
  })

  it("fecha TODAS as nossas (ambas as forjas do relatório podem ter aberto)", () => {
    const gh = fakeGh({ open: [ours(1), ours(2, "outra")] })
    const res = reconcileDebt({ report: report(), gh: gh.fn, log: silent })
    expect(res.closed).toEqual([1, 2])
  })

  it("fecha a issue cujo marcador está em COMENTÁRIO (sem isso ela seria 'alheia')", () => {
    // É assim que fica a issue depois de um drift que MUDOU: o corpo perde o
    // marcador original e o novo mora num comentário.
    const gh = fakeGh({
      open: [
        {
          number: 3,
          title: driftTitle(),
          body: "corpo reescrito por alguém",
          comments: [{ body: markerOf(signatureOf({ warnings: ["drift antigo"] })) }],
        },
      ],
    })
    const res = reconcileDebt({ report: report(), gh: gh.fn, log: silent })
    expect(res.closed).toEqual([3])
    expect(gh.calls.filter((c) => c[1] === "close")).toHaveLength(1)
  })

  it("NÃO toca em issue alheia (label aplicado à mão) — e o diz no log", () => {
    const gh = fakeGh({ open: [{ number: 9, title: "outra coisa", body: "sem marcador" }] })
    const logged: string[] = []
    const res = reconcileDebt({ report: report(), gh: gh.fn, log: (m: string) => logged.push(m) })
    expect(res.closed).toEqual([])
    expect(res.foreign).toEqual([9])
    expect(gh.calls.filter((c) => c[1] === "comment" || c[1] === "close")).toEqual([])
    expect(logged.join("\n")).toContain("NÃO foi aberta por este script")
  })

  it("nada aberto → nada a fechar, e nenhuma chamada de escrita", () => {
    const gh = fakeGh({ open: [] })
    const res = reconcileDebt({ report: report(), gh: gh.fn, log: silent })
    expect(res).toEqual({ closed: [], foreign: [], alreadyClear: true })
    expect(gh.calls).toHaveLength(1)
    expect(gh.calls[0][1]).toBe("list")
  })

  it("falha no COMENTÁRIO → erro, e a issue NÃO é fechada em silêncio", () => {
    const gh = fakeGh({ open: [ours(7)], failOn: /issue comment/ })
    expect(() => reconcileDebt({ report: report(), gh: gh.fn, log: silent })).toThrow(
      /issue comment falhou/,
    )
    expect(gh.calls.some((c) => c[1] === "close")).toBe(false)
  })

  it("falha no FECHAMENTO → erro (a dívida aberta tem de aparecer no run, não sumir)", () => {
    const gh = fakeGh({ open: [ours(7)], failOn: /issue close/ })
    expect(() => reconcileDebt({ report: report(), gh: gh.fn, log: silent })).toThrow(
      /issue close falhou/,
    )
  })

  it("a lista é pedida por LABEL e por estado ABERTO (não varre issues fechadas)", () => {
    const gh = fakeGh({ open: [] })
    reconcileDebt({ report: report(), gh: gh.fn, log: silent })
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
      // `comments` ENTRA: é onde mora o marcador do segundo drift em diante.
      "number,title,body,comments",
    ])
  })
})

// ── o gh DUBLÊ: a única forma de provar o dedup entre runs ────────────────
//
// POR QUE UM CLI DUBLÊ E NÃO UMA FUNÇÃO INJETADA: o dedup não é uma conta, é
// um CICLO — a run 2 precisa enxergar o que a run 1 criou, e a 3 o que a 2
// comentou. Com o `gh` dublado por função, cada teste começa do zero e o ciclo
// nunca acontece; é justamente entre runs que o defeito aparecia (comentar o
// MESMO drift a cada semana, porque o marcador estava no comentário e o dedup
// só olhava o corpo).

interface FakeIssue {
  number: number
  title: string
  body: string
  labels: string[]
  state: "open" | "closed"
  comments: { body: string }[]
}

/**
 * Instala um `gh` fake no PATH, com ESTADO em arquivo (issues) e LOG de
 * chamadas. O fake é ESTRITO: qualquer subcomando que ele não modela sai 1 — um
 * dublê permissivo esconderia uma chamada nova que o script passasse a fazer.
 */
function makeFakeGh(initial: FakeIssue[] = []) {
  const binDir = mkdtempSync(join(tmpdir(), "gh-fake-"))
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
    issues: (): FakeIssue[] => JSON.parse(readFileSync(statePath, "utf8")) as FakeIssue[],
    open: (): FakeIssue[] =>
      (JSON.parse(readFileSync(statePath, "utf8")) as FakeIssue[]).filter(
        (i) => i.state === "open",
      ),
    calls: (): string[][] =>
      readFileSync(logPath, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as string[]),
    /** Só as chamadas de uma família (`create`, `comment`, `close`, `list`…). */
    callsOf: (verb: string): string[][] =>
      readFileSync(logPath, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as string[])
        .filter((c) => c[0] === "issue" && c[1] === verb),
  }
}

describe("CLI + gh dublê — runs repetidas do MESMO drift não duplicam issue", () => {
  /** Roda o publisher REAL contra o fixture, com o gh fake no PATH. */
  function run(dir: string, fake: { binDir: string }, args: string[] = []) {
    return spawnSync(process.execPath, [SCRIPT, "--expected", "1.3.14", ...args], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, PATH: `${fake.binDir}:${process.env.PATH ?? ""}` },
    })
  }

  it("run 1 sem nada aberto → CRIA uma issue (e o label é garantido antes)", () => {
    const dir = forgeTree({ template: "1.3.15" })
    const fake = makeFakeGh()
    const res = run(dir, fake)

    expect(res.status).toBe(0)
    expect(res.stdout).toContain("Issue criada")
    expect(fake.callsOf("create")).toHaveLength(1)
    expect(fake.open()).toHaveLength(1)
    // O label idempotente vem ANTES: sem ele o `create --label` falharia.
    expect(fake.calls().some((c) => c[0] === "label" && c[1] === "create")).toBe(true)
  })

  it("run 2 com o MESMO drift → NÃO cria e NÃO comenta (a assinatura no corpo basta)", () => {
    const dir = forgeTree({ template: "1.3.15" })
    const fake = makeFakeGh()
    expect(run(dir, fake).status).toBe(0)
    const second = run(dir, fake)

    expect(second.status).toBe(0)
    expect(second.stdout).toContain("já reportado na issue #1")
    expect(fake.callsOf("create")).toHaveLength(1)
    expect(fake.callsOf("comment")).toHaveLength(0)
    expect(fake.open()).toHaveLength(1)
  })

  it("drift que MUDOU → comenta UMA vez; repetir a run não comenta de novo", () => {
    const dir = forgeTree({ template: "1.3.15" })
    const fake = makeFakeGh()
    run(dir, fake) // abre a issue com o drift A

    // O drift muda (outra versão de template): vira COMENTÁRIO na issue aberta.
    writeFileSync(
      join(dir, "deploy", "env.gitea.example"),
      `RUNNER_TOKEN=TOK\nIMAGE_REGISTRY=ghcr.io\nIMAGE_NAMESPACE=severinno\nBUN_VERSION=1.3.16\n`,
      "utf8",
    )
    const changed = run(dir, fake)
    expect(changed.stdout).toContain("Comentário adicionado à issue #1")
    expect(fake.callsOf("comment")).toHaveLength(1)
    expect(fake.callsOf("create")).toHaveLength(1)

    // A RUN REPETIDA do mesmo drift B: o marcador está no COMENTÁRIO — e é isso
    // que o dedup precisa enxergar (sem isso o cron comentaria toda semana).
    const repeat = run(dir, fake)
    expect(repeat.stdout).toContain("já reportado na issue #1")
    expect(fake.callsOf("comment")).toHaveLength(1)
    expect(fake.callsOf("create")).toHaveLength(1)
    expect(fake.open()[0].comments).toHaveLength(1)
  })

  it("três runs seguidas do mesmo drift → UMA issue e nenhum comentário", () => {
    const dir = forgeTree({ template: "1.3.15" })
    const fake = makeFakeGh()
    for (let i = 0; i < 3; i++) expect(run(dir, fake).status).toBe(0)

    expect(fake.open()).toHaveLength(1)
    expect(fake.callsOf("create")).toHaveLength(1)
    expect(fake.callsOf("comment")).toHaveLength(0)
    // E o `list` é consultado em TODAS as runs (é ele que decide).
    expect(fake.callsOf("list")).toHaveLength(3)
  })

  it("espelhos de volta em sincronia → COMENTA a prova e FECHA (o ciclo fecha entre runs)", () => {
    const dir = forgeTree({ template: "1.3.15" })
    const fake = makeFakeGh()
    run(dir, fake)
    expect(fake.open()).toHaveLength(1)

    writeFileSync(join(dir, "deploy", "env.gitea.example"), "BUN_VERSION=1.3.14\n", "utf8")
    const resolved = run(dir, fake)
    expect(resolved.status).toBe(0)
    expect(resolved.stdout).toContain("issue #1 fechada")
    expect(fake.open()).toHaveLength(0)
    // A prova entra ANTES do fechamento e fica registrada no comentário.
    const closed = fake.issues()[0]
    expect(closed.comments.at(-1)?.body).toContain("Resolvido")

    // E a run seguinte não acha nada a fechar (nem a reabre):
    const again = run(dir, fake)
    expect(again.stdout).toContain("nenhuma dívida aberta")
    expect(fake.callsOf("close")).toHaveLength(1)
  })

  it("drift que RECORRE depois de fechado → issue NOVA (o dedup é entre as ABERTAS)", () => {
    const dir = forgeTree({ template: "1.3.15" })
    const fake = makeFakeGh()
    run(dir, fake)
    writeFileSync(join(dir, "deploy", "env.gitea.example"), "BUN_VERSION=1.3.14\n", "utf8")
    run(dir, fake) // fecha

    writeFileSync(join(dir, "deploy", "env.gitea.example"), "BUN_VERSION=1.3.15\n", "utf8")
    const recurred = run(dir, fake)
    expect(recurred.stdout).toContain("Issue criada")
    expect(fake.callsOf("create")).toHaveLength(2)
    expect(fake.open()).toHaveLength(1)
    expect(fake.open()[0].number).toBe(2)
  })

  it("issue ALHEIA com o label (marcador só nosso em NENHUM corpo) fica intocada", () => {
    const dir = forgeTree()
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
    const res = run(dir, fake)

    expect(res.stdout).toContain("NÃO foi aberta por este script")
    expect(fake.callsOf("close")).toHaveLength(0)
    expect(fake.callsOf("comment")).toHaveLength(0)
    expect(fake.open()).toHaveLength(1)
  })

  it("issue NOSSA cujo marcador mora num COMENTÁRIO → continua nossa e é fechada", () => {
    const dir = forgeTree()
    const fake = makeFakeGh([
      {
        number: 7,
        title: driftTitle(),
        body: "corpo reescrito por alguém",
        labels: [ISSUE_LABEL],
        state: "open",
        comments: [{ body: `${markerOf(signatureOf({ warnings: ["drift antigo"] }))}` }],
      },
    ])
    const res = run(dir, fake)

    expect(res.stdout).toContain("issue #7 fechada")
    expect(fake.callsOf("close")).toHaveLength(1)
  })

  it("o `list` pede os COMENTÁRIOS (sem eles o dedup e o fechamento seriam cegos)", () => {
    const dir = forgeTree()
    const fake = makeFakeGh()
    run(dir, fake)
    const list = fake.callsOf("list")[0]
    expect(list[list.indexOf("--json") + 1]).toBe("number,title,body,comments")
  })
})

describe("CLI (--dry-run): decide sozinho, sem depender do exit code do guard", () => {
  function run(dir: string, args: string[]) {
    return spawnSync(process.execPath, [SCRIPT, ...args], { cwd: dir, encoding: "utf8" })
  }

  it("drift no template → exit 0, corpo impresso e nenhuma chamada ao gh", () => {
    const dir = forgeTree({ template: "1.3.15" })
    const res = run(dir, ["--expected", "1.3.14", "--dry-run"])
    expect(res.status).toBe(0)
    expect(res.stdout).toContain("Drift detectado")
    expect(res.stdout).toContain("deploy/env.gitea.example")
    expect(res.stdout).toContain("(dry-run: nenhuma chamada ao gh)")
  })

  it("espelhos em sincronia → exit 0 e mensagem de 'sem drift'", () => {
    const dir = forgeTree()
    const res = run(dir, ["--expected", "1.3.14", "--dry-run"])
    expect(res.status).toBe(0)
    expect(res.stdout).toContain("Sem drift")
  })

  it("sem drift e --dry-run → anuncia a RECONCILIAÇÃO e continua sem chamar o gh", () => {
    const dir = forgeTree()
    const res = run(dir, ["--expected", "1.3.14", "--dry-run"])
    expect(res.status).toBe(0)
    expect(res.stdout).toContain("nenhuma chamada ao gh")
    expect(res.stdout).toContain(ISSUE_LABEL)
    expect(res.stdout).not.toContain("issue #")
  })

  it("--expected ausente → exit 1 (fail-closed: um erro de uso não pode passar por 'sem drift')", () => {
    const res = run(forgeTree(), ["--dry-run"])
    expect(res.status).toBe(1)
    expect(res.stderr).toContain("--expected")
  })

  it("--expected VAZIO → drift (exit 0 em dry-run), não erro de uso", () => {
    const res = run(forgeTree(), ["--expected", "", "--dry-run"])
    expect(res.status).toBe(0)
    expect(res.stdout).toContain("NÃO configurada")
  })
})

describe("fonte única das regras e contrato dos workflows", () => {
  it("o script IMPORTa mirrorDriftReport do guard (a issue não reimplementa a comparação)", () => {
    const source = readFileSync(SCRIPT, "utf8")
    expect(source).toContain('import { mirrorDriftReport } from "./check-actrc-sync.mjs"')
    // E o guard exporta a função que o CLI dele também usa.
    expect(readFileSync(GUARD, "utf8")).toContain("export function mirrorDriftReport")
  })

  it("ISSUE_LABEL é actrc-sync-drift (constante usada no create e no dedup)", () => {
    expect(ISSUE_LABEL).toBe("actrc-sync-drift")
  })

  it("o job semanal do GITHUB invoca o script, com if: always() e permissão de issue", () => {
    const workflow = readFileSync(
      join(ROOT, ".github", "workflows", "benchmark-weekly.yml"),
      "utf8",
    )
    const start = workflow.indexOf("  actrc-sync:")
    expect(start, "job actrc-sync não encontrado").toBeGreaterThan(-1)
    const job = workflow.slice(start, workflow.indexOf("\n  seed-guards:", start))
    expect(job).toContain("node scripts/actrc-sync-issue.mjs")
    expect(job).toContain("if: always()")
    expect(job).toContain("issues: write")
    // O fechamento automático depende de rodar de VERDADE (um `--dry-run` no
    // step desligaria a reconciliação em silêncio — o defeito que este turno
    // corrige, na sua forma mais barata de voltar).
    expect(job).not.toContain('actrc-sync-issue.mjs --expected "${{ vars.BUN_VERSION }}" --dry-run')
    expect(job).toContain('actrc-sync-issue.mjs --expected "${{ vars.BUN_VERSION }}"')
    // A anotação continua (é o log humano) e o guard NÃO falha: o canal do
    // GitHub é a issue, não o status do run.
    expect(job).toContain("node scripts/check-actrc-sync.mjs")
    expect(job).not.toContain("--fail")
  })

  it("a FORJA não usa o publicador de issue (lá não há canal de issue: ela falha o run)", () => {
    const forge = readFileSync(join(ROOT, ".gitea", "workflows", "actrc-sync.yml"), "utf8")
    expect(forge).not.toContain("actrc-sync-issue.mjs")
    expect(forge).toContain("--fail")
  })
})
