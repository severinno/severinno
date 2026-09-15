/**
 * env-mirror-drift-issue.test.ts
 *
 * Testes do `scripts/env-mirror-drift-issue.mjs` — o publicador que transforma o
 * drift do env do HOST da forja (`deploy/.env.gitea`) contra o template comitado
 * (`deploy/env.gitea.example`) em ISSUE acionável, no cron semanal
 * `.gitea/workflows/env-mirror-drift.yml`.
 *
 * POR QUE ISSO PRECISA DE TESTE (o script pode "parecer" certo e não alertar):
 *   1. a assinatura do drift é ESTÁVEL (mesmo conjunto → mesma assinatura) e o
 *      dedup entre runs não duplica issue;
 *   2. `absent` (não havia o que comparar) NÃO abre issue e NÃO fecha nada —
 *      mas NUNCA passa por "em sincronia" (a prosa diz o estado);
 *   3. o fechamento automático COMENTA A PROVA ANTES de fechar, só toca nas
 *      issues que ESTE publicador escreveu, e é fail-closed nos dois passos;
 *   4. o corpo é ACIONÁVEL (lista o que divergiu, o que foi comparado e o
 *      remédio — o MESMO par que o `gitea-up.sh` imprime quando recusa subir);
 *   5. o workflow REAL invoca o publicador com `if: always()`, e o
 *      `ci/periodic-alerts.json` classifica o job como canal `issue` — a decisão
 *      escrita, sem a qual o guard de alertas periódicos derruba a suíte.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterAll, describe, expect, it } from "vitest"

import {
  ISSUE_LABEL,
  MARKER_PREFIX,
  driftBody,
  driftTitle,
  hasAnyMarker,
  hasSignature,
  inSyncProse,
  isActionable,
  markerOf,
  readReportFile,
  reconcileDebt,
  remedy,
  resolutionComment,
  shouldReconcile,
  signatureOf,
} from "../../../scripts/env-mirror-drift-issue.mjs"
import { MANIFEST_PATH, jobBlock } from "../../../scripts/check-periodic-alerts.mjs"
import { getJob, getSteps, loadWorkflow, readWorkflowContent } from "./helpers/workflow-execution"

const ROOT = process.cwd()
const WF = ".gitea/workflows/env-mirror-drift.yml"
const JOB = "env-mirror-drift"

const tmpDirs: string[] = []
afterAll(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** Um relatório com a forma REAL do `check-env-mirror.mjs --json` (MirrorResult). */
function reportOf(overrides: Record<string, unknown> = {}) {
  return {
    state: "diverged",
    violations: ["BUN_VERSION: host='1.3.12' x template='1.3.14'"],
    consumed: ["BUN_VERSION", "IMAGE_REGISTRY", "IMAGE_NAMESPACE"],
    host: "deploy/.env.gitea",
    template: "deploy/env.gitea.example",
    detail: "1 divergencia(s)",
    plan: { edits: [], patch: "" },
    remaining: [],
    ...overrides,
  }
}

// ── 1. A assinatura (dedup estável) ───────────────────────────────────────

describe("signatureOf — a assinatura é estável entre runs com o MESMO drift", () => {
  it("a ORDEM das violações não muda a assinatura", () => {
    const a = signatureOf({ violations: ["b", "a"] })
    const b = signatureOf({ violations: ["a", "b"] })
    expect(a).toBe(b)
  })

  it("um drift DIFERENTE produz outra assinatura (comentar é o comportamento certo)", () => {
    const um = signatureOf(reportOf())
    const outro = signatureOf(reportOf({ violations: ["IMAGE_REGISTRY: host='x' x template='y'"] }))
    expect(um).not.toBe(outro)
  })

  it("sem violação a assinatura é vazia (nada a deduplicar)", () => {
    expect(signatureOf(reportOf({ state: "in-sync", violations: [] }))).toBe("")
    expect(signatureOf(undefined)).toBe("")
  })

  it("o marcador carrega a assinatura e é reconhecido pela MESMA regra", () => {
    const sig = signatureOf(reportOf())
    const body = driftBody(reportOf())
    expect(body).toContain(markerOf(sig))
    expect(hasSignature(body, sig)).toBe(true)
    expect(hasSignature(body, "outra-coisa")).toBe(false)
    expect(hasAnyMarker(body)).toBe(true)
    expect(MARKER_PREFIX.startsWith("<!--")).toBe(true)
    expect(markerOf(sig).startsWith(MARKER_PREFIX)).toBe(true)
  })
})

// ── 2. O que é (e o que NÃO é) dívida ─────────────────────────────────────

describe("isActionable — só a DIVERGÊNCIA abre dívida", () => {
  it("diverged com violações → acionável", () => {
    expect(isActionable(reportOf())).toBe(true)
  })

  it("in-sync → NÃO acionável", () => {
    expect(isActionable(reportOf({ state: "in-sync", violations: [] }))).toBe(false)
  })

  it("absent → NÃO acionável (não havia o que comparar não é defeito do operador)", () => {
    expect(isActionable(reportOf({ state: "absent", violations: [], host: null }))).toBe(false)
  })

  it("diverged SEM violação relatada → NÃO acionável (não publica dívida vazia)", () => {
    expect(isActionable(reportOf({ violations: [] }))).toBe(false)
  })
})

// ── 3. A prosa do ciclo: in-sync não pode parecer 'não comparado' ──────────

describe("a prosa do ciclo distingue SINCRONIA de NÃO COMPARADO", () => {
  it("em sincronia diz host x template e quantas variáveis do compose foram conferidas", () => {
    const texto = inSyncProse(reportOf({ state: "in-sync", violations: [] }))
    expect(texto).toContain("Em sincronia")
    expect(texto).toContain("deploy/.env.gitea")
    expect(texto).toContain("3 variável(is)")
  })

  it("absent NÃO diz 'em sincronia' — nomeia o estado e o remédio (--host)", () => {
    const texto = inSyncProse(
      reportOf({ state: "absent", violations: [], detail: "nao havia o que comparar" }),
    )
    expect(texto).not.toContain("Em sincronia")
    expect(texto).toContain("NÃO COMPARADO")
    expect(texto).toContain("--host")
  })
})

// ── 4. O corpo é acionável ────────────────────────────────────────────────

describe("driftBody — a issue diz o que divergiu, o que foi comparado e o remédio", () => {
  const body = driftBody(reportOf())

  it("nomeia o par comparado e lista cada violação", () => {
    expect(body).toContain("deploy/.env.gitea")
    expect(body).toContain("deploy/env.gitea.example")
    expect(body).toContain("BUN_VERSION: host='1.3.12' x template='1.3.14'")
  })

  it("declara POR QUE não há PR para pegar isso (o drift de operação)", () => {
    expect(body).toContain("não há PR")
  })

  it("traz o remédio do próprio repositório (--patch / --fix) e o re-registro quando é imagem", () => {
    expect(body).toContain("env-mirror:check --patch")
    expect(body).toContain("env-mirror:check --fix")
    expect(body).toContain("--re-register")
  })

  it("liga o drift ao pré-requisito 0 do bring-up (a consequência)", () => {
    expect(body).toContain("PRÉ-REQUISITO 0")
    expect(body).toContain("gitea-up.sh")
  })

  it("o remédio é o MESMO par que o bring-up imprime (uma fonte para a correção)", () => {
    // `remedy()` é exportado justamente para não existir um segundo texto: a
    // issue e a mensagem da subida não podem mandar o operador para caminhos
    // diferentes.
    expect(remedy()).toContain("env-mirror:check --fix")
    expect(remedy()).toContain("--re-register")
  })

  it("o comentário de resolução carrega a PROVA (host, template, variáveis conferidas)", () => {
    const comment = resolutionComment(reportOf({ state: "in-sync", violations: [] }))
    expect(comment).toContain("Resolvido")
    expect(comment).toContain("deploy/.env.gitea")
    expect(comment).toContain("deploy/env.gitea.example")
    expect(comment).toContain("3 variável(is)")
    expect(comment).toContain("bun run env-mirror:check")
  })
})

// ── 5. O relatório de entrada ─────────────────────────────────────────────

describe("readReportFile — fail-closed no que não dá para ler", () => {
  it("arquivo ausente → erro (nunca 'sem drift')", () => {
    expect(() => readReportFile("/tmp/nao-existe-env-mirror.json")).toThrow(/não encontrado/)
  })

  it("JSON sem `violations` → erro (um relatório inválido NÃO vira 'sem drift')", () => {
    const dir = mkdtempSync(join(tmpdir(), "envmirror-report-"))
    tmpDirs.push(dir)
    const p = join(dir, "r.json")
    writeFileSync(p, JSON.stringify({ state: "in-sync" }), "utf8")
    expect(() => readReportFile(p)).toThrow(/violations/)
  })

  it("JSON sem `state` → erro (o estado é o que decide publicar ou fechar)", () => {
    const dir = mkdtempSync(join(tmpdir(), "envmirror-report-"))
    tmpDirs.push(dir)
    const p = join(dir, "r.json")
    writeFileSync(p, JSON.stringify({ violations: [] }), "utf8")
    expect(() => readReportFile(p)).toThrow(/state/)
  })

  it("um relatório REAL é lido pelo contrato do publicador", () => {
    const dir = mkdtempSync(join(tmpdir(), "envmirror-report-"))
    tmpDirs.push(dir)
    const p = join(dir, "r.json")
    const original = reportOf()
    writeFileSync(p, JSON.stringify(original, null, 2), "utf8")
    expect(readReportFile(p)).toEqual(original)
  })
})

// ── 6. O fechamento automático (reconciliação) ─────────────────────────────

describe("reconcileDebt — o env voltou a espelhar, o que abrimos deixa de existir", () => {
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

  const ours = (number: number) => ({
    number,
    title: driftTitle(),
    body: `corpo\n${markerOf(signatureOf(reportOf()))}\n`,
  })
  const clean = () => reportOf({ state: "in-sync", violations: [] })
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

  it("NÃO toca em issue alheia (label aplicado à mão, sem o nosso marcador)", async () => {
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

  it("a GUARDA do fechamento só libera com `in-sync` EXPLÍCITO", () => {
    // O outro estado sem violações é `absent` ("não havia o que comparar") — e
    // fechar por ele apagaria a dívida com base numa medição que NÃO aconteceu.
    expect(shouldReconcile(reportOf({ state: "in-sync" }))).toBe(true)
    expect(shouldReconcile(reportOf())).toBe(false)
    expect(shouldReconcile(reportOf({ state: "absent" }))).toBe(false)
  })
})

// ── 7. O contrato do workflow REAL e a decisão escrita do canal ───────────

describe("o workflow REAL da forja", () => {
  const wf = loadWorkflow(WF)

  it("o job publica em `always()` (senão o fechamento sumiria em silêncio)", () => {
    const steps = getSteps(getJob(wf, JOB))
    const publish = steps.find((s) => (s.run ?? "").includes("env-mirror-drift-issue.mjs"))
    expect(publish, "nenhum step invoca o publicador").toBeTruthy()
    expect(publish?.if ?? "").toContain("always()")
  })

  it("o diagnóstico roda o MESMO comando do pré-requisito 0, em --json", () => {
    const content = readWorkflowContent(WF)
    expect(content).toContain("scripts/check-env-mirror.mjs --json")
  })

  it("o step que FALHA é o ÚLTIMO (a issue tem de rodar antes)", () => {
    const steps = getSteps(getJob(wf, JOB))
    const publishIdx = steps.findIndex((s) => (s.run ?? "").includes("env-mirror-drift-issue.mjs"))
    const failIdx = steps.findIndex((s) => (s.name ?? "").startsWith("Fail on drift"))
    expect(publishIdx).toBeGreaterThan(-1)
    expect(failIdx).toBeGreaterThan(publishIdx)
  })

  it("`absent` também falha o run (um cron que não mediu não pode passar por verde)", () => {
    const content = readWorkflowContent(WF)
    expect(content).toContain("Não havia o que comparar")
  })

  it("o cron está agendado e é disparável à mão", () => {
    const content = readWorkflowContent(WF)
    expect(content).toContain("schedule:")
    expect(content).toContain("workflow_dispatch:")
  })

  it("o canal do job está DECLARADO no manifesto de alertas periódicos", () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, MANIFEST_PATH), "utf8"))
    const entries = [...(manifest.forges?.github ?? []), ...(manifest.forges?.gitea ?? [])]
    const entry = entries.find((e) => e.workflow === WF && e.job === JOB)
    expect(entry, `${WF}::${JOB} não está classificado`).toBeTruthy()
    expect(entry.channel).toBe("issue")
    // A EVIDÊNCIA declarada tem de existir no bloco DAQUELE job: um canal que
    // aponta para outro arquivo seria uma decisão escrita sobre nada.
    const block = jobBlock(readWorkflowContent(WF), JOB)
    expect(block).toContain(entry.evidence)
  })
})
