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
