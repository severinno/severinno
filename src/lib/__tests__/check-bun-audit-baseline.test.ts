/**
 * check-bun-audit-baseline.test.ts
 *
 * Testes do guard de drift de vulnerabilidades de deps
 * (scripts/check-bun-audit-baseline.mjs) — roda o `bun audit --json` REAL e
 * falha SOMENTE se achados NOVOS (ou ESCALADOS) de severidade >=
 * --min-severity (default high = high/critical) aparecerem, comparando por
 * ASSINATURA (pacote:url-do-advisory) contra um baseline commitado
 * (docs/security/bun-audit-baseline.json).
 *
 * Cobre:
 *   - parseAuditJson: shape `{ [pacote]: [advisory] }` → achados
 *     normalizados; dedupe por pacote:url preservando a pior severidade;
 *     advisory sem url ignorado; JSON inválido lança
 *   - signatureOf: assinatura estável (pacote:url)
 *   - severityRank: info < low < moderate < high < critical; desconhecida
 *     = critical (fail-closed)
 *   - buildBaseline / parseBaseline: round-trip + validação
 *   - findNewFindings: igualdade por assinatura; achado novo detectado;
 *     achado removido (bump de dep) NÃO falha; mesmo count com url nova = novo
 *   - findSeverityEscalations: advisory CONHECIDO que sobe de severidade
 *     (moderate → high) é detectado; severidade igual/abaixo não escala
 *   - splitBySeverity: min high bloqueia high/critical e vira aviso em
 *     moderate; min low bloqueia tudo
 *   - CLI real (spawnSync + fixtures de --results-file):
 *       - exit 0 quando nenhum achado novo além do baseline
 *       - exit 1 quando um advisory HIGH novo aparece (mutation)
 *       - exit 0 quando um advisory MODERATE novo aparece com
 *         --min-severity high (aviso, não falha)
 *       - exit 1 quando um advisory CRITICAL novo aparece
 *       - exit 1 quando um advisory CONHECIDO ESCALA moderate → high
 *       - --update regenera o baseline (count atual)
 *       - exit 2 quando o baseline está ausente (fail-closed)
 *       - exit 2 quando --results-file não existe
 *       - exit 2 quando --min-severity é inválido
 *
 * O modo --results-file lê o JSON do bun audit de um FIXTURE em vez de
 * spawnar o audit real (rede) — é o que torna o teste unitário e o mutation
 * test rápidos e determinísticos.
 *
 * Usage:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/check-bun-audit-baseline.test.ts
 */

import { describe, it, expect, afterEach } from "vitest"
import { spawnSync } from "node:child_process"
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import {
  parseAuditJson,
  signatureOf,
  severityRank,
  buildBaseline,
  parseBaseline,
  findNewFindings,
  findSeverityEscalations,
  splitBySeverity,
  SEVERITY_ORDER,
} from "../../../scripts/check-bun-audit-baseline.mjs"

type Advisory = { url?: string; severity?: string; title?: string }

const SCRIPT = resolve(process.cwd(), "scripts/check-bun-audit-baseline.mjs")
const tmpDirs: string[] = []

/** Fixture base do bun audit (shape real: { [pacote]: [advisory] }). */
const BASE_AUDIT: Record<string, Advisory[]> = {
  lodash: [
    {
      url: "https://github.com/advisories/GHSA-lodash-1",
      severity: "moderate",
      title: "proto pollution",
    },
  ],
  next: [
    { url: "https://github.com/advisories/GHSA-next-1", severity: "high", title: "next vuln" },
  ],
}

function makeResults(audit: Record<string, Advisory[]>): string {
  return JSON.stringify(audit)
}

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "bun-audit-base-"))
  tmpDirs.push(dir)
  return dir
}

function runCheck(dir: string, args: string[]) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: dir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

// ── parseAuditJson ────────────────────────────────────────────────────────

describe("parseAuditJson", () => {
  it("achata { [pacote]: [advisory] } em achados normalizados", () => {
    const findings = parseAuditJson(makeResults(BASE_AUDIT))
    expect(findings).toHaveLength(2)
    expect(findings[0]).toMatchObject({ package: "lodash", severity: "moderate" })
    expect(findings[1]).toMatchObject({ package: "next", severity: "high" })
  })

  it("dedupe por pacote:url preservando a pior severidade (mesmo GHSA listado 2x)", () => {
    const findings = parseAuditJson(
      makeResults({
        lodash: [
          { url: "https://github.com/advisories/GHSA-x", severity: "moderate", title: "a" },
          { url: "https://github.com/advisories/GHSA-x", severity: "high", title: "a (range 2)" },
        ],
      }),
    )
    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe("high")
  })

  it("ignora advisory sem url (defensivo)", () => {
    const findings = parseAuditJson(makeResults({ lodash: [{ severity: "high" }] }))
    expect(findings).toEqual([])
  })

  it("JSON inválido lança (fail-closed no main)", () => {
    expect(() => parseAuditJson("not json")).toThrow()
  })
})

// ── signatureOf / severityRank ────────────────────────────────────────────

describe("signatureOf", () => {
  it("é estável: pacote:url", () => {
    expect(signatureOf({ package: "lodash", url: "https://github.com/advisories/GHSA-aaa" })).toBe(
      "lodash:https://github.com/advisories/GHSA-aaa",
    )
  })
})

describe("severityRank", () => {
  it("ordena info < low < moderate < high < critical", () => {
    expect(SEVERITY_ORDER).toEqual(["info", "low", "moderate", "high", "critical"])
    expect(severityRank("info")).toBe(0)
    expect(severityRank("low")).toBe(1)
    expect(severityRank("moderate")).toBe(2)
    expect(severityRank("high")).toBe(3)
    expect(severityRank("critical")).toBe(4)
  })

  it("severidade desconhecida/ausente é tratada como CRITICAL (fail-closed)", () => {
    expect(severityRank(undefined)).toBe(4)
    expect(severityRank("??")).toBe(4)
  })
})

// ── buildBaseline / parseBaseline ─────────────────────────────────────────

describe("buildBaseline / parseBaseline", () => {
  const FINDINGS = [
    {
      package: "lodash",
      url: "https://github.com/advisories/GHSA-1",
      severity: "moderate",
      title: "t",
    },
  ]

  it("buildBaseline gera count + updatedAt + findings (round-trip com parseBaseline)", () => {
    const bl = buildBaseline(FINDINGS)
    expect(bl.count).toBe(1)
    expect(bl.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(bl.findings[0]).toMatchObject({ package: "lodash", severity: "moderate" })

    const parsed = parseBaseline(JSON.stringify(bl))
    expect(parsed.count).toBe(1)
    expect(parsed.findings).toHaveLength(1)
  })

  it("parseBaseline falha com JSON inválido / sem findings", () => {
    expect(() => parseBaseline("not json")).toThrow()
    expect(() => parseBaseline('{"count": 1}')).toThrow("findings")
  })
})

// ── findNewFindings (a regra do guard) ────────────────────────────────────

describe("findNewFindings", () => {
  const baselineFindings = [
    { package: "lodash", url: "https://github.com/advisories/GHSA-1" },
    { package: "next", url: "https://github.com/advisories/GHSA-2" },
  ]

  it("nenhum novo quando tudo já está no baseline", () => {
    expect(findNewFindings(baselineFindings, baselineFindings)).toEqual([])
  })

  it("detecta achado NOVO (assinatura ausente)", () => {
    const current = [
      ...baselineFindings,
      { package: "sharp", url: "https://github.com/advisories/GHSA-3" },
    ]
    const news = findNewFindings(current, baselineFindings)
    expect(news).toHaveLength(1)
    expect(news[0]).toMatchObject({ package: "sharp" })
  })

  it("achado REMOVIDO (bump de dep) NÃO falha — só novos", () => {
    const current = [baselineFindings[0]] // o GHSA-2 (next) sumiu após bump
    expect(findNewFindings(current, baselineFindings)).toEqual([])
  })

  it("mesmo count mas advisory DIFERENTE = achado novo (não compara count)", () => {
    const current = [
      baselineFindings[0],
      { package: "next", url: "https://github.com/advisories/GHSA-NOVA" },
    ]
    const news = findNewFindings(current, baselineFindings)
    expect(news).toHaveLength(1)
    expect((news[0] as { url?: string }).url).toContain("GHSA-NOVA")
  })
})

// ── findSeverityEscalations (advisory conhecido que SOBE de severidade) ──

describe("findSeverityEscalations", () => {
  const baselineFindings = [
    { package: "lodash", url: "https://github.com/advisories/GHSA-1", severity: "moderate" },
    { package: "next", url: "https://github.com/advisories/GHSA-2", severity: "high" },
  ]

  it("detecta advisory CONHECIDO que sobe de severidade (moderate → high)", () => {
    const current = [
      { package: "lodash", url: "https://github.com/advisories/GHSA-1", severity: "high" },
      { package: "next", url: "https://github.com/advisories/GHSA-2", severity: "high" },
    ]
    const escalations = findSeverityEscalations(current, baselineFindings)
    expect(escalations).toHaveLength(1)
    expect(escalations[0]).toMatchObject({
      baselineSeverity: "moderate",
      finding: { package: "lodash", severity: "high" },
    })
  })

  it("severidade igual ou MENOR não escala", () => {
    const current = [
      { package: "lodash", url: "https://github.com/advisories/GHSA-1", severity: "moderate" },
      { package: "next", url: "https://github.com/advisories/GHSA-2", severity: "low" },
    ]
    expect(findSeverityEscalations(current, baselineFindings)).toEqual([])
  })

  it("assinatura NOVA não é escalação (é achado novo — findNewFindings cobre)", () => {
    const current = [
      ...baselineFindings,
      { package: "sharp", url: "https://github.com/advisories/GHSA-3", severity: "high" },
    ]
    expect(findSeverityEscalations(current, baselineFindings)).toEqual([])
  })
})

// ── splitBySeverity (o filtro de severidade) ──────────────────────────────

describe("splitBySeverity", () => {
  const critical = { package: "a", severity: "critical" }
  const high = { package: "b", severity: "high" }
  const moderate = { package: "c", severity: "moderate" }
  const semSev = { package: "d" } // sem severity → critical (fail-closed)

  it("min=high (default): só high/critical/desconhecida bloqueiam; moderate vira aviso", () => {
    const { blocking, warnings } = splitBySeverity([critical, high, moderate, semSev], "high")
    expect(blocking).toHaveLength(3)
    expect(blocking.map((f) => (f as { severity?: string }).severity)).toEqual([
      "critical",
      "high",
      undefined,
    ])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toBe(moderate)
  })

  it("min=low: TODO achado novo bloqueia (comportamento histórico dos guards)", () => {
    const { blocking, warnings } = splitBySeverity([moderate], "low")
    expect(blocking).toHaveLength(1)
    expect(warnings).toHaveLength(0)
  })

  it("lista vazia → nada bloqueia", () => {
    expect(splitBySeverity([], "high")).toEqual({ blocking: [], warnings: [] })
  })
})

// ── CLI real (temp dir + fixtures de --results-file) ───────────────────────

describe("check-bun-audit-baseline.mjs — CLI real (fixtures)", () => {
  it("exit 0: nenhum achado novo além do baseline gerado por --update", () => {
    const dir = makeRepo()
    writeFileSync(join(dir, "audit.json"), makeResults(BASE_AUDIT), "utf8")
    const upd = runCheck(dir, [
      "--baseline",
      "baseline.json",
      "--results-file",
      "audit.json",
      "--update",
    ])
    expect(upd.status).toBe(0)
    const bl = JSON.parse(readFileSync(join(dir, "baseline.json"), "utf8"))
    expect(bl.count).toBe(2)

    const check = runCheck(dir, ["--baseline", "baseline.json", "--results-file", "audit.json"])
    expect(check.status).toBe(0)
    expect(check.stdout).toContain("nenhum NOVO")
  })

  it("exit 1: advisory HIGH novo commitado (a mutação que o guard pega)", () => {
    const dir = makeRepo()
    writeFileSync(join(dir, "audit.json"), makeResults(BASE_AUDIT), "utf8")
    runCheck(dir, ["--baseline", "baseline.json", "--results-file", "audit.json", "--update"])

    // MUTAÇÃO: um advisory HIGH novo (pacote novo com vuln alta)
    const mutated = {
      ...BASE_AUDIT,
      sharp: [
        {
          url: "https://github.com/advisories/GHSA-sharp-new",
          severity: "high",
          title: "sharp RCE",
        },
      ],
    }
    writeFileSync(join(dir, "audit.json"), makeResults(mutated), "utf8")
    const check = runCheck(dir, ["--baseline", "baseline.json", "--results-file", "audit.json"])
    expect(check.status).toBe(1)
    expect(check.stderr).toContain("NOVO")
    expect(check.stderr).toContain("sharp")
  })

  it("exit 0: advisory MODERATE novo com --min-severity high (aviso, não falha)", () => {
    const dir = makeRepo()
    writeFileSync(join(dir, "audit.json"), makeResults(BASE_AUDIT), "utf8")
    runCheck(dir, ["--baseline", "baseline.json", "--results-file", "audit.json", "--update"])

    const mutated = {
      ...BASE_AUDIT,
      uuid: [
        {
          url: "https://github.com/advisories/GHSA-uuid-new",
          severity: "moderate",
          title: "uuid issue",
        },
      ],
    }
    writeFileSync(join(dir, "audit.json"), makeResults(mutated), "utf8")
    const check = runCheck(dir, [
      "--baseline",
      "baseline.json",
      "--results-file",
      "audit.json",
      "--min-severity",
      "high",
    ])
    expect(check.status).toBe(0)
    expect(check.stderr).toContain("não bloqueiam")
  })

  it("exit 1: advisory CONHECIDO que ESCALA moderate → high (a escalação que o guard pega)", () => {
    const dir = makeRepo()
    writeFileSync(join(dir, "audit.json"), makeResults(BASE_AUDIT), "utf8")
    runCheck(dir, ["--baseline", "baseline.json", "--results-file", "audit.json", "--update"])

    // MUTAÇÃO: o GHSA conhecido do lodash (moderate no baseline) sobe p/ high
    const mutated = {
      ...BASE_AUDIT,
      lodash: [
        {
          url: "https://github.com/advisories/GHSA-lodash-1",
          severity: "high",
          title: "proto pollution (reclassificado)",
        },
      ],
    }
    writeFileSync(join(dir, "audit.json"), makeResults(mutated), "utf8")
    const check = runCheck(dir, ["--baseline", "baseline.json", "--results-file", "audit.json"])
    expect(check.status).toBe(1)
    expect(check.stderr).toContain("ESCALAÇÃO")
    expect(check.stderr).toContain("moderate → high")
  })

  it("exit 1: advisory CRITICAL novo com --min-severity high", () => {
    const dir = makeRepo()
    writeFileSync(join(dir, "audit.json"), makeResults(BASE_AUDIT), "utf8")
    runCheck(dir, ["--baseline", "baseline.json", "--results-file", "audit.json", "--update"])

    const mutated = {
      ...BASE_AUDIT,
      next: [
        ...(BASE_AUDIT.next ?? []),
        {
          url: "https://github.com/advisories/GHSA-next-crit",
          severity: "critical",
          title: "next critical",
        },
      ],
    }
    writeFileSync(join(dir, "audit.json"), makeResults(mutated), "utf8")
    const check = runCheck(dir, [
      "--baseline",
      "baseline.json",
      "--results-file",
      "audit.json",
      "--min-severity",
      "high",
    ])
    expect(check.status).toBe(1)
    expect(check.stderr).toContain("[critical]")
  })

  it("--update regenera o baseline com o count atual e o guard passa", () => {
    const dir = makeRepo()
    writeFileSync(join(dir, "audit.json"), makeResults(BASE_AUDIT), "utf8")
    const upd = runCheck(dir, [
      "--baseline",
      "base.json",
      "--results-file",
      "audit.json",
      "--update",
    ])
    expect(upd.status).toBe(0)
    const bl = JSON.parse(readFileSync(join(dir, "base.json"), "utf8"))
    expect(bl.count).toBe(2)

    const check = runCheck(dir, ["--baseline", "base.json", "--results-file", "audit.json"])
    expect(check.status).toBe(0)
  })

  it("exit 2: baseline ausente sem --update (fail-closed com instrução)", () => {
    const dir = makeRepo()
    writeFileSync(join(dir, "audit.json"), makeResults(BASE_AUDIT), "utf8")
    const res = runCheck(dir, ["--baseline", "missing.json", "--results-file", "audit.json"])
    expect(res.status).toBe(2)
    expect(res.stderr).toContain("Baseline ausente")
    expect(res.stderr).toContain("--update")
  })

  it("exit 2: --results-file inexistente (fail-closed)", () => {
    const dir = makeRepo()
    const res = runCheck(dir, ["--baseline", "base.json", "--results-file", "nope.json"])
    expect(res.status).toBe(2)
    expect(res.stderr).toContain("--results-file")
  })

  it("exit 2: --min-severity inválido (flag inválida)", () => {
    const dir = makeRepo()
    writeFileSync(join(dir, "audit.json"), makeResults(BASE_AUDIT), "utf8")
    const res = runCheck(dir, [
      "--baseline",
      "base.json",
      "--results-file",
      "audit.json",
      "--min-severity",
      "crítica",
    ])
    expect(res.status).toBe(2)
    expect(res.stderr).toContain("--min-severity")
  })
})
