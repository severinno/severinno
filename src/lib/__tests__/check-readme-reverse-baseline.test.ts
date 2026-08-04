/**
 * check-readme-reverse-baseline.test.ts
 *
 * Testes do guard semanal scripts/check-readme-reverse-baseline.mjs — falha
 * SOMENTE se achados NOVOS de drift semântico de links do README aparecerem
 * (links que RESOLVEM mas apontam para o heading semanticamente errado),
 * comparando por ASSINATURA (file+slug+label) contra um baseline commitado
 * (docs/security/readme-reverse-baseline.json).
 *
 * Cobre:
 *   - signatureOf: assinatura estável (file:slug:label) — a LINHA NÃO
 *     participa (o README cresce e as linhas migram a cada edição)
 *   - buildBaseline: estrutura do arquivo (count, updatedAt, findings)
 *   - parseBaseline: valida JSON + findings
 *   - findNewFindings: igualdade por assinatura; achado novo detectado;
 *     achado corrigido (link arrumado) NÃO falha; linha migrada NÃO é novo
 *   - CLI real (spawnSync + temp dir com README.md FAKE):
 *       - exit 0 quando nenhum achado novo além do baseline
 *       - exit 1 quando um link semanticamente errado é adicionado
 *       - --update regenera o baseline (count atual)
 *       - exit 2 quando o baseline está ausente (fail-closed)
 *       - exit 2 quando o README tem link QUEBRADO (forward) — fail-closed
 *         no input inválido, DISTINTO do exit 1 (achados novos de drift)
 *
 * Usage:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/check-readme-reverse-baseline.test.ts
 */

import { describe, it, expect, afterEach } from "vitest"
import { spawnSync } from "node:child_process"
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import {
  signatureOf,
  buildBaseline,
  parseBaseline,
  findNewFindings,
} from "../../../scripts/check-readme-reverse-baseline.mjs"

const SCRIPT = resolve(process.cwd(), "scripts/check-readme-reverse-baseline.mjs")
const tmpDirs: string[] = []

/** README semanticamente limpo (forward + reverse ok). */
const CLEAN_README = [
  "## Encoding Guards",
  "",
  "- [CRLF Guard](#crlf-guard)",
  "- [Auditoria histórica](#auditoria-histórica)",
  "",
  "### CRLF Guard",
  "### Auditoria histórica",
].join("\n")

/** README com um link que RESOLVE mas aponta para o heading errado. */
const DRIFT_README = [
  "## Encoding Guards",
  "",
  "- [CRLF Guard](#normalizador)", // resolve, mas 'CRLF Guard' ≠ 'Normalizador'
  "- [Auditoria histórica](#auditoria-histórica)",
  "",
  "### CRLF Guard",
  "### Auditoria histórica",
  "### Normalizador",
].join("\n")

function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "rrv-base-"))
  tmpDirs.push(dir)
  return dir
}

function writeReadme(dir: string, content: string) {
  writeFileSync(join(dir, "README.md"), content, "utf8")
}

function runCheck(dir: string, args: string[] = []) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: dir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

// ── signatureOf ────────────────────────────────────────────────────────────

describe("signatureOf", () => {
  it("é estável: file:slug:label — a LINHA não participa", () => {
    expect(signatureOf({ file: "README.md", slug: "normalizador", label: "CRLF Guard" })).toBe(
      "README.md:normalizador:CRLF Guard",
    )
  })

  it("dois achados do MESMO link em linhas DIFERENTES têm a MESMA assinatura", () => {
    // O README cresce e as linhas migram — linha migrada NÃO é achado novo
    const a = signatureOf({ file: "README.md", slug: "normalizador", label: "CRLF Guard" })
    const b = signatureOf({
      file: "README.md",
      slug: "normalizador",
      label: "CRLF Guard",
    })
    expect(a).toBe(b)
  })
})

// ── buildBaseline / parseBaseline ─────────────────────────────────────────

describe("buildBaseline / parseBaseline", () => {
  const FINDINGS = [
    {
      file: "README.md",
      line: 3,
      slug: "normalizador",
      label: "CRLF Guard",
      heading: "Normalizador",
      suggestion: "crlf-guard",
    },
  ]

  it("buildBaseline gera count + updatedAt + findings (round-trip com parseBaseline)", () => {
    const bl = buildBaseline(FINDINGS)
    expect(bl.count).toBe(1)
    expect(bl.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect((bl.findings[0] as { slug: string }).slug).toBe("normalizador")
    expect((bl.findings[0] as { suggestion: string }).suggestion).toBe("crlf-guard")

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
    {
      file: "README.md",
      line: 3,
      slug: "normalizador",
      label: "CRLF Guard",
      heading: "Normalizador",
    },
    { file: "README.md", line: 9, slug: "x", label: "Y", heading: "Z" },
  ]

  it("nenhum novo quando tudo já está no baseline", () => {
    const current = [...baselineFindings]
    expect(findNewFindings(current, baselineFindings)).toEqual([])
  })

  it("detecta achado NOVO (assinatura ausente)", () => {
    const current = [
      ...baselineFindings,
      { file: "README.md", line: 20, slug: "alvo", label: "Label Novo", heading: "Alvo" },
    ]
    const news = findNewFindings(current, baselineFindings)
    expect(news).toHaveLength(1)
    expect((news[0] as { slug: string }).slug).toBe("alvo")
  })

  it("achado CORRIGIDO (link arrumado) NÃO falha — só novos", () => {
    const current = [baselineFindings[0]] // o achado 'x' sumiu (link corrigido)
    expect(findNewFindings(current, baselineFindings)).toEqual([])
  })

  it("mesmo link em LINHA DIFERENTE = mesmo achado (linha não participa da assinatura)", () => {
    // count igual (2), mas o achado do baseline mudou de linha (o README
    // cresceu) — a assinatura NÃO muda → nenhum novo. É o caso que a
    // comparação por linha geraria falso alarme a cada edição do doc.
    const current = [
      baselineFindings[0],
      { file: "README.md", line: 500, slug: "x", label: "Y", heading: "Z" }, // linha migrou
    ]
    expect(findNewFindings(current, baselineFindings)).toEqual([])
  })
})

// ── CLI real (temp dir com README.md fake) ────────────────────────────────

describe("check-readme-reverse-baseline.mjs — CLI real", () => {
  it("exit 0: README limpo + baseline gerado por --update → nenhum novo", () => {
    const dir = makeTmpDir()
    writeReadme(dir, CLEAN_README)
    const upd = runCheck(dir, ["--baseline", "baseline.json", "--update"])
    expect(upd.status).toBe(0)
    expect(JSON.parse(readFileSync(join(dir, "baseline.json"), "utf8")).count).toBe(0)

    const check = runCheck(dir, ["--baseline", "baseline.json"])
    expect(check.status).toBe(0)
    expect(check.stdout).toContain("nenhum NOVO")
  })

  it("exit 1: link semanticamente errado adicionado após o baseline (a mutação que o guard pega)", () => {
    const dir = makeTmpDir()
    writeReadme(dir, CLEAN_README)
    runCheck(dir, ["--baseline", "baseline.json", "--update"])

    // MUTAÇÃO: o link agora aponta para #normalizador — resolve, mas errado
    writeReadme(dir, DRIFT_README)
    const check = runCheck(dir, ["--baseline", "baseline.json"])
    expect(check.status).toBe(1)
    expect(check.stderr).toContain("NOVO")
    expect(check.stderr).toContain("normalizador")
    expect(check.stderr).toContain("CRLF Guard")
  })

  it("exit 2: baseline ausente sem --update (fail-closed com instrução)", () => {
    const dir = makeTmpDir()
    writeReadme(dir, CLEAN_README)
    const res = runCheck(dir, ["--baseline", "missing.json"])
    expect(res.status).toBe(2)
    expect(res.stderr).toContain("Baseline ausente")
    expect(res.stderr).toContain("--update")
  })

  it("--update regenera baseline com count atual e o guard passa", () => {
    const dir = makeTmpDir()
    writeReadme(dir, DRIFT_README) // baseline já nasce com o drift conhecido
    const upd = runCheck(dir, ["--baseline", "base.json", "--update"])
    expect(upd.status).toBe(0)
    const bl = JSON.parse(readFileSync(join(dir, "base.json"), "utf8"))
    expect(bl.count).toBe(1)

    const check = runCheck(dir, ["--baseline", "base.json"])
    expect(check.status).toBe(0)
  })

  it("FAIL-CLOSED no FORWARD: README com link QUEBRADO (forward-only) → exit 2 com mensagem clara (infra ≠ exit 1)", () => {
    // Um link quebrado (forward: `#nao-existe` sem heading) invalida o audit
    // de drift semântico — o input está quebrado, o guard NÃO pode comparar
    // reverse sobre um README com link morto. Fail-closed: EXIT 2 (infra),
    // DISTINTO do exit 1 (achados novos de drift — que criam issue no job
    // semanal). O forward já é gate de PR (utf8-check/hooks); chegar aqui =
    // o working tree/PR mergeado quebrou um link — alerta de infra, não
    // silêncio. Este teste trava a assinatura de falha: exit 2, NÃO 1.
    const BROKEN_README = [
      "## Encoding Guards",
      "",
      "- [CRLF Guard](#nao-existe)", // forward violation (resolve NÃO)
      "",
      "### CRLF Guard",
    ].join("\n")
    const dir = makeTmpDir()
    writeReadme(dir, BROKEN_README)

    // PREMISSA do fixture travada: o anchors guard acusa o link quebrado
    // como FORWARD (não reverse) — sem isso, o teste poderia false-passar
    // com um fixture acidentalmente limpo (count 0 de qualquer jeito).
    const anchorsJson = spawnSync(
      process.execPath,
      [resolve(process.cwd(), "scripts/check-readme-anchors.mjs"), "--json", "README.md"],
      {
        cwd: dir,
        encoding: "utf8",
      },
    )
    expect(anchorsJson.status).toBe(0)
    const anchorsOut = JSON.parse(anchorsJson.stdout ?? "")
    expect(anchorsOut.count).toBe(1)
    expect(anchorsOut.findings[0]).toMatchObject({ type: "forward", slug: "nao-existe" })

    // o baseline existe (vazio) — a falha NÃO é por baseline ausente, é pelo
    // input inválido (link quebrado): exit 2 com a mensagem clara que lista
    // o link morto e explica a distinção exit 2 vs exit 1.
    writeFileSync(
      join(dir, "baseline.json"),
      JSON.stringify({ count: 0, updatedAt: "2026-01-01", findings: [] }),
      "utf8",
    )

    const check = runCheck(dir, ["--baseline", "baseline.json"])
    expect(check.status).toBe(2)
    expect(check.stderr).toContain("QUEBRADO")
    expect(check.stderr).toContain("[CRLF Guard](#nao-existe)")
    expect(check.stderr).toContain("DISTINTO do exit 1")

    // --update TAMBÉM falha-closed no input quebrado (a checagem do forward
    // roda ANTES do branch de update): não se regenera baseline de um README
    // com link morto — o fail-closed do forward vale para os dois modos.
    const upd = runCheck(dir, ["--baseline", "baseline.json", "--update"])
    expect(upd.status).toBe(2)
    expect(upd.stderr).toContain("QUEBRADO")
  })
})
