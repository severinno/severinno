/**
 * benchmark-weekly-all-text-crlf-workflow.test.ts
 *
 * Snapshot test do job PERIÓDICO blob-crlf-all-text-alert do
 * .github/workflows/benchmark-scheduled.yml — o ALERTA semanal de ALCANCE do
 * CRLF no histórico (modo --all-text do audit-blob-crlf-history: audita os
 * tipos do .gitattributes com 'text eol=lf', não só .sh/.bash).
 *
 * Valida (padrão dos testes de guards — espelha o
 * tier1-fastpath-guard-workflow.test.ts, funções puras do
 * check-workflow-refs.mjs):
 *
 *   1. Sintaxe YAML — js-yaml parse do conteúdo REAL do arquivo (lança se
 *      inválido) + snapshot da estrutura do JOB. Qualquer mudança estrutural
 *      no job (step renomeado, condicional alterado, sentinel trocado)
 *      exige revisão consciente do snapshot — impede drift silencioso entre
 *      o que o CI executa e o que este teste espera.
 *   2. Condicionais — sintaxe dos `if:` do job: o passo ALERTA dispara quando
 *      report_exit != '0' OU found_crlf == 'true'; o Summary (limpo) exige
 *      report_exit == '0' E found_crlf != 'true' — EXATAMENTE o complemento
 *      lógico do gate (report_exit == '0' && found_crlf != 'true' é
 *      !(report_exit != '0' || found_crlf == 'true')).
 *   3. Refs contra o check-workflow-refs — extractScriptRefs /
 *      extractPkgScriptRefs / extractWorkflowUses / extractActionUses rodam
 *      no conteúdo REAL, e cada ref é validada contra o repo real. Uma
 *      referência quebrada no workflow falha este teste ANTES do CI.
 *   4. Sentinel 'com CRLF' + gate de report_exit TRAVADOS:
 *      - o passo REPORT (id: alltext) usa `grep -Fq 'com CRLF'` sobre o
 *        all-text-report.txt — o sentinel SÓ existe no output do produtor
 *        quando há achados (linha 289 do audit_blob_crlf_history.py:
 *        'N bloco(s) com CRLF no histórico'); o estado limpo imprime
 *        'sem CRLF no histórico' (linha 296) — sem o sentinel. O teste
 *        verifica a CONSISTÊNCIA produtor↔job: se alguém reformular a frase
 *        do produtor, o grep do job fica cego E este teste quebra.
 *      - report_exit é capturado com PIPESTATUS[0] → GITHUB_OUTPUT — sem
 *        ele, um exit 2 da auditoria (stream cat-file truncado) passaria
 *        como 'limpo' (falso positivo da classe que o repo bloqueia em
 *        act-repro-setup-bun/STEP_MISSING).
 *
 * Uso:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/benchmark-weekly-all-text-crlf-workflow.test.ts
 *
 * NOTA: snapshot de estrutura — para REGENERAR após mudança INTENCIONAL do
 * job: npx vitest run ... -u (atualiza o .snap). O snapshot captura a
 * estrutura parsed (js-yaml) do JOB (não do arquivo inteiro — o
 * benchmark-weekly tem 9 jobs e qualquer adição invalidaria o snapshot
 * inteiro sem relação com este job).
 */

import { describe, it, expect } from "vitest"
import { readFileSync, existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import yaml from "js-yaml"
import {
  extractScriptRefs,
  extractPkgScriptRefs,
  extractWorkflowUses,
  extractActionUses,
} from "../../../scripts/check-workflow-refs.mjs"

// js-yaml é dep transitiva SEM @types — a declaração ambiente mínima vive em
// js-yaml.d.ts (mesmo diretório; .d.ts global, não inline, para evitar TS2665).

const CWD = process.cwd()
const WF_NAME = "benchmark-scheduled.yml"
const WF_PATH = join(CWD, ".github", "workflows", WF_NAME)
const JOB_KEY = "blob-crlf-all-text-alert"
const PY_PATH = join(CWD, "scripts", "audit_blob_crlf_history.py")

// ── Fixtures reais (lidas do repo) ──────────────────────────────────────

const content = readFileSync(WF_PATH, "utf8")
const parsed = yaml.load(content) as {
  name?: string
  on?: Record<string, unknown>
  jobs?: Record<
    string,
    {
      name?: string
      steps?: { name?: string; id?: string; if?: string; run?: string; uses?: string }[]
    }
  >
}

const job = parsed.jobs?.[JOB_KEY]
const steps = job?.steps ?? []

/**
 * Nega uma condicional do GitHub Actions `if:` no formato
 * `steps.<id>.outputs.<a> <op> '<v>' ||/&& steps.<id>.outputs.<b> <op> '<v>'`
 * via De Morgan — troca == por != (e vice-versa) e || por && (e vice-versa).
 * Usada para provar que o Summary é o complemento lógico exato do ALERTA.
 */
function negateConditional(cond: string): string {
  const negateSide = (side: string) =>
    side.includes("==")
      ? side.replace(/==\s*'[^']*'/, (m) => m.replace("==", "!="))
      : side.replace(/!=\s*'[^']*'/, (m) => m.replace("!=", "=="))
  return cond
    .split(/\s*\|\|\s*/)
    .map((group) =>
      group
        .split(/\s*&&\s*/)
        .map(negateSide)
        .join(" || "),
    )
    .join(" && ")
}

/** Contexto real do repo (mesmos artefatos que o guard valida em main()). */
const ctx = (() => {
  const wfDir = join(CWD, ".github", "workflows")
  const names = readdirSync(wfDir).filter((f) => f.endsWith(".yml"))
  const scripts = new Set(readdirSync(join(CWD, "scripts")))
  const pkgScripts = new Set(
    Object.keys(JSON.parse(readFileSync(join(CWD, "package.json"), "utf8")).scripts ?? {}),
  )
  const workflowCall = new Set(
    names.filter((n) => readFileSync(join(wfDir, n), "utf8").includes("workflow_call")),
  )
  const actionsDir = join(CWD, ".github", "actions")
  const actions = new Set(
    existsSync(actionsDir)
      ? readdirSync(actionsDir).filter((d) => existsSync(join(actionsDir, d, "action.yml")))
      : [],
  )
  return { scripts, pkgScripts, workflows: new Set(names), workflowCall, actions }
})()

// ── 1. Sintaxe YAML + snapshot da estrutura do job ──────────────────────

describe("benchmark-scheduled.yml — job blob-crlf-all-text-alert (sintaxe YAML + snapshot)", () => {
  it("parseia como YAML válido e o job casa com o snapshot da estrutura", () => {
    expect(job).toBeDefined()
    expect(job).toMatchSnapshot()
  })

  it("estrutura mínima: job com 4 steps (checkout, REPORT, ALERTA, Summary)", () => {
    expect(job?.name).toBe("Blob CRLF all-text (alcance, aviso)")
    expect(steps.length).toBe(4)
  })

  it("triggers: schedule semanal + workflow_dispatch (nenhum push/pr)", () => {
    const triggers = Object.keys(parsed.on ?? {})
    expect(triggers).toContain("schedule")
    expect(triggers).toContain("workflow_dispatch")
    expect(triggers).not.toContain("push")
    expect(triggers).not.toContain("pull_request")
  })

  it("checkout tem fetch-depth: 0 (o audit varre TODO o histórico)", () => {
    const checkout = steps[0]
    expect(checkout?.uses).toBe("actions/checkout@v4")
    expect(steps[0]).toMatchObject({ uses: "actions/checkout@v4", with: { "fetch-depth": 0 } })
  })
})

// ── 2. Condicionais do job (sintaxe + complementaridade lógica) ─────────

describe("benchmark-scheduled.yml — condicionais do job blob-crlf-all-text-alert", () => {
  function stepRun(idOrName: string): string {
    const s = steps.find((x) => x.id === idOrName || x.name === idOrName)
    if (!s) throw new Error(`step '${idOrName}' não encontrado no job`)
    return s.run ?? ""
  }

  it("passo REPORT (id: alltext) NÃO tem condicional (roda sempre) e captura report_exit via PIPESTATUS", () => {
    const report = steps.find((s) => s.id === "alltext")
    expect(report).toBeDefined()
    expect(report?.if).toBeUndefined()
    const run = stepRun("alltext")
    expect(run).toContain("bash scripts/audit-blob-crlf-history.sh --all-text")
    expect(run).toContain("report_exit=${PIPESTATUS[0]}")
    expect(run).toContain('echo "report_exit=$report_exit" >> "$GITHUB_OUTPUT"')
    expect(run).toContain("set +e")
    expect(run).toContain("set -e")
  })

  it("passo ALERTA dispara quando report_exit != '0' OU found_crlf == 'true' (gate do report_exit)", () => {
    const alert = steps.find((s) => s.name?.startsWith("Alertar sobre CRLF"))
    expect(alert).toBeDefined()
    expect(alert?.if).toBe(
      "steps.alltext.outputs.report_exit != '0' || steps.alltext.outputs.found_crlf == 'true'",
    )
    const run = stepRun("Alertar sobre CRLF ou falha do audit (--all-text)")
    expect(run).toContain("exit 1")
    expect(run).toContain("::error::")
  })

  it("passo Summary (limpo) exige report_exit == '0' E found_crlf != 'true' — complemento lógico do ALERTA", () => {
    const summary = steps.find((s) => s.name?.startsWith("Summary"))
    expect(summary).toBeDefined()
    expect(summary?.if).toBe(
      "steps.alltext.outputs.report_exit == '0' && steps.alltext.outputs.found_crlf != 'true'",
    )
    // Complementaridade: Summary é EXATAMENTE a negação lógica do ALERTA
    // (De Morgan): !(A != '0' || B == 'true')  =  (A == '0' && B != 'true')
    const alertIf = steps.find((s) => s.name?.startsWith("Alertar"))?.if ?? ""
    const summaryIf = summary?.if ?? ""
    expect(summaryIf).toBe(negateConditional(alertIf))
    // Sintaxe: operadores válidos e refs apenas de steps.alltext.outputs
    for (const cond of [alertIf, summaryIf]) {
      expect(cond).toMatch(
        /^steps\.alltext\.outputs\.(report_exit|found_crlf) (==|!=) '[^']+' (\|\||&&) steps\.alltext\.outputs\.(report_exit|found_crlf) (==|!=) '[^']+'$/,
      )
    }
  })
})

// ── 3. Refs de script/package.json/workflows/actions contra o repo real ─

describe("benchmark-scheduled.yml — refs contra o check-workflow-refs", () => {
  it("todo script invocado existe em scripts/ (refs resolvem no repo real)", () => {
    const refs = extractScriptRefs(content)
    expect(refs.length).toBeGreaterThan(0)
    for (const r of refs) {
      expect(ctx.scripts.has(r.ref), `script ausente: ${r.ref} (linha ${r.line})`).toBe(true)
    }
  })

  it("o job all-text referencia audit-blob-crlf-history.sh (a ref central existe) e o invoca com --all-text", () => {
    const refs = extractScriptRefs(content)
    expect(refs.map((r) => r.ref)).toContain("audit-blob-crlf-history.sh")
    // O passo REPORT do JOB (não outra parte do arquivo) é quem invoca com
    // --all-text — o modo REPORT que este teste protege.
    const reportRun = steps.find((s) => s.id === "alltext")?.run ?? ""
    expect(reportRun).toContain("bash scripts/audit-blob-crlf-history.sh --all-text")
  })

  it("nenhuma entry de package.json quebrada (bun run <entry>)", () => {
    const refs = extractPkgScriptRefs(content)
    for (const r of refs) {
      expect(
        ctx.pkgScripts.has(r.ref),
        `entry ausente em package.json: ${r.ref} (linha ${r.line})`,
      ).toBe(true)
    }
  })

  it("nenhum reusable workflow local quebrado (uses: ./.github/workflows/)", () => {
    const refs = extractWorkflowUses(content)
    for (const r of refs) {
      expect(ctx.workflows.has(r.ref), `workflow ausente: ${r.ref} (linha ${r.line})`).toBe(true)
      expect(
        ctx.workflowCall.has(r.ref),
        `workflow sem on: workflow_call: ${r.ref} (linha ${r.line})`,
      ).toBe(true)
    }
  })

  it("nenhum composite action local quebrado (uses: ./.github/actions/)", () => {
    const refs = extractActionUses(content)
    for (const r of refs) {
      expect(ctx.actions.has(r.ref), `action ausente: ${r.ref} (linha ${r.line})`).toBe(true)
    }
  })
})

// ── 4. Sentinel 'com CRLF' + gate de report_exit TRAVADOS ───────────────

describe("benchmark-scheduled.yml — sentinel 'com CRLF' e gate de report_exit", () => {
  it("o passo REPORT grepa o sentinel 'com CRLF' (grep -Fq literal) sobre o report", () => {
    const run = steps.find((s) => s.id === "alltext")?.run ?? ""
    expect(run).toContain("grep -Fq 'com CRLF' all-text-report.txt")
    expect(run).toContain('echo "found_crlf=true" >> "$GITHUB_OUTPUT"')
    expect(run).toContain('echo "found_crlf=false" >> "$GITHUB_OUTPUT"')
  })

  it("CONSISTÊNCIA produtor↔job: o produtor imprime o sentinel só com achados e 'sem CRLF' no limpo", () => {
    const py = readFileSync(PY_PATH, "utf8")
    // Linha 289 (achados): 'N bloco(s) com CRLF no histórico' — o grep do job
    // casa 'com CRLF' exatamente neste caminho.
    expect(py).toContain("bloco(s) com CRLF no histórico")
    // Linha 296 (limpo): 'sem CRLF no histórico' — NÃO contém o sentinel
    // 'com CRLF' (senão o grep do job acenderia em estado limpo).
    expect(py).toContain("sem CRLF no histórico")
    const cleanLine = py.split("\n").find((l) => l.includes("sem CRLF no histórico"))
    expect(cleanLine).toBeDefined()
    expect(cleanLine).not.toContain("com CRLF")
  })

  it("gate de report_exit: o ALERTA trata exit != 0 como falha — 'não achado' não é 'limpo'", () => {
    const run = steps.find((s) => s.name?.startsWith("Alertar"))?.run ?? ""
    // O gate cobre o exit 2 (auditoria quebrada) SEM sentinel: a mensagem de
    // erro distingue 'FALHOU' (exit) de 'CRLF encontrado' (sentinel).
    expect(run).toContain("steps.alltext.outputs.report_exit")
    expect(run).toContain("::error::")
    expect(run).toContain("exit 1")
    // Se o report_exit não fosse capturado (PIPESTATUS), o gate estaria cego.
    const reportRun = steps.find((s) => s.id === "alltext")?.run ?? ""
    expect(reportRun).toContain("report_exit=${PIPESTATUS[0]}")
  })
})
