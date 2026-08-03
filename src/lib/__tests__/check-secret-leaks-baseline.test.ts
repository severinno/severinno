/**
 * check-secret-leaks-baseline.test.ts
 *
 * Testes do guard semanal scripts/check-secret-leaks-baseline.mjs — falha
 * SOMENTE se achados NOVOS de segredos aparecerem no histórico do git,
 * comparando por ASSINATURA (commit+file+line+id+key) contra um baseline
 * commitado (docs/security/secret-leaks-baseline.json).
 *
 * Cobre:
 *   - signatureOf: assinatura estável (commit:file:line:id:key)
 *   - buildBaseline: estrutura do arquivo (count, updatedAt, findings)
 *   - parseBaseline: valida JSON + findings
 *   - findNewFindings: igualdade por assinatura; achado novo detectado;
 *     achado removido (história reescrita) NÃO falha; key null não colide
 *   - CLI real (spawnSync + temp git repo com secrets FAKE):
 *       - exit 0 quando nenhum achado novo além do baseline
 *       - exit 1 quando um secret NOVO é commitado (mutation)
 *       - --update regenera o baseline (count atual)
 *       - exit 2 quando o baseline está ausente (fail-closed)
 *
 * ATENÇÃO: os "segredos" usados nos fixtures são FAKES (sk-test-...,
 * ghp_TEST_...), nunca valores reais — o mesmo padrão do audit-secret-leaks.
 *
 * Usage:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/check-secret-leaks-baseline.test.ts
 */

import { describe, it, expect, afterEach } from "vitest"
import { execFileSync, spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import {
  signatureOf,
  buildBaseline,
  parseBaseline,
  findNewFindings,
} from "../../../scripts/check-secret-leaks-baseline.mjs"

/** Forma mínima dos achados do baseline (props restantes opcionais). */
type LeakFinding = {
  commit?: string
  file?: string
  line?: number
  id?: string
  key?: string | null
  masked?: string
}

const SCRIPT = resolve(process.cwd(), "scripts/check-secret-leaks-baseline.mjs")
const tmpDirs: string[] = []

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "sec-base-"))
  tmpDirs.push(dir)
  execFileSync("git", ["init", "-q"], { cwd: dir })
  execFileSync("git", ["config", "user.email", "t@t"], { cwd: dir })
  execFileSync("git", ["config", "user.name", "t"], { cwd: dir })
  return dir
}

function commitFile(dir: string, file: string, content: string, msg: string) {
  const full = join(dir, file)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, content, "utf8")
  execFileSync("git", ["add", file], { cwd: dir })
  execFileSync("git", ["commit", "-qm", msg], { cwd: dir })
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
  it("é estável: commit:file:line:id:key", () => {
    expect(
      signatureOf({
        commit: "abc123",
        file: ".env",
        line: 3,
        id: "atribuição de secret",
        key: "DB_PASSWORD",
      }),
    ).toBe("abc123:.env:3:atribuição de secret:DB_PASSWORD")
  })

  it("normaliza key null/undefined para string vazia (padrão de 1 grupo)", () => {
    expect(
      signatureOf({ commit: "a", file: "t", line: 1, id: "token com prefixo", key: null }),
    ).toBe("a:t:1:token com prefixo:")
    expect(signatureOf({ commit: "a", file: "t", line: 1, id: "token com prefixo" })).toBe(
      "a:t:1:token com prefixo:",
    )
  })
})

// ── buildBaseline / parseBaseline ─────────────────────────────────────────

describe("buildBaseline / parseBaseline", () => {
  const FINDINGS = [
    {
      commit: "abc",
      file: ".env",
      line: 2,
      id: "atribuição de secret",
      key: "SESSION_SECRET",
      masked: "SESS…17 chars",
    },
  ]

  it("buildBaseline gera count + updatedAt + findings (round-trip com parseBaseline)", () => {
    const bl = buildBaseline(FINDINGS)
    expect(bl.count).toBe(1)
    expect(bl.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect((bl.findings[0] as LeakFinding).key).toBe("SESSION_SECRET")
    expect((bl.findings[0] as LeakFinding).masked).toBe("SESS…17 chars")

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
    { commit: "aaa", file: ".env", line: 1, id: "atribuição de secret", key: "DB_PASSWORD" },
    { commit: "bbb", file: "config.json", line: 5, id: "token com prefixo", key: null },
  ]

  it("nenhum novo quando tudo já está no baseline", () => {
    const current = [...baselineFindings]
    expect(findNewFindings(current, baselineFindings)).toEqual([])
  })

  it("detecta achado NOVO (assinatura ausente)", () => {
    const current = [
      ...baselineFindings,
      { commit: "ccc", file: ".env", line: 9, id: "atribuição de secret", key: "API_KEY" },
    ]
    const news = findNewFindings(current, baselineFindings)
    expect(news).toHaveLength(1)
    expect((news[0] as LeakFinding).key).toBe("API_KEY")
  })

  it("achado REMOVIDO (história reescrita) NÃO falha — só novos", () => {
    const current = [baselineFindings[0]] // o token bbb sumiu do histórico
    expect(findNewFindings(current, baselineFindings)).toEqual([])
  })

  it("mesmo count mas linha/arquivo diferentes = achado novo (não compara count)", () => {
    // count igual (2), mas o achado do commit bbb está em OUTRA linha — a
    // assinatura muda → novo. É exatamente o caso que count-only perderia.
    const current = [
      baselineFindings[0],
      { commit: "bbb", file: "config.json", line: 6, id: "token com prefixo", key: null },
    ]
    const news = findNewFindings(current, baselineFindings)
    expect(news).toHaveLength(1)
    expect((news[0] as LeakFinding).line).toBe(6)
  })
})

// ── CLI real (temp git repo com secrets FAKE) ─────────────────────────────

describe("check-secret-leaks-baseline.mjs — CLI real", () => {
  it("exit 0: nenhum achado novo além do baseline gerado por --update", () => {
    const dir = makeRepo()
    commitFile(dir, "config.json", '{"apiKey": "sk-test-deadbeefcafe0000"}\n', "adds token")
    // baseline do estado atual (1 achado conhecido)
    const upd = runCheck(dir, ["--baseline", "baseline.json", "--update"])
    expect(upd.status).toBe(0)
    expect(JSON.parse(readFileSync(join(dir, "baseline.json"), "utf8")).count).toBe(1)

    // mesmo histórico → nenhum novo → exit 0
    const check = runCheck(dir, ["--baseline", "baseline.json"])
    expect(check.status).toBe(0)
    expect(check.stdout).toContain("nenhum NOVO")
  })

  it("exit 1: secret NOVO commitado após o baseline (a mutação que o guard pega)", () => {
    const dir = makeRepo()
    commitFile(dir, "config.json", '{"apiKey": "sk-test-deadbeefcafe0000"}\n', "adds token")
    runCheck(dir, ["--baseline", "baseline.json", "--update"])

    // MUTAÇÃO: um commit NOVO adiciona outro secret — assinatura nova
    commitFile(dir, "app.env", "SESSION_SECRET=sk-test-newsecret00001111\n", "adds another secret")
    const check = runCheck(dir, ["--baseline", "baseline.json"])
    expect(check.status).toBe(1)
    expect(check.stderr).toContain("NOVO")
    expect(check.stderr).toContain("app.env")
  })

  it("exit 2: baseline ausente sem --update (fail-closed com instrução)", () => {
    const dir = makeRepo()
    commitFile(dir, "config.json", '{"apiKey": "sk-test-deadbeefcafe0000"}\n', "adds token")
    const res = runCheck(dir, ["--baseline", "missing.json"])
    expect(res.status).toBe(2)
    expect(res.stderr).toContain("Baseline ausente")
    expect(res.stderr).toContain("--update")
  })

  it("--update regenera baseline com count atual e o guard passa", () => {
    const dir = makeRepo()
    commitFile(dir, "a.env", "DB_PASSWORD=supersecretpassword123\n", "adds")
    commitFile(dir, "b.env", "API_KEY=sk-test-secondsecret9999\n", "adds 2nd")

    const upd = runCheck(dir, ["--baseline", "base.json", "--update"])
    expect(upd.status).toBe(0)
    const bl = JSON.parse(readFileSync(join(dir, "base.json"), "utf8"))
    expect(bl.count).toBe(2)

    const check = runCheck(dir, ["--baseline", "base.json"])
    expect(check.status).toBe(0)
  })
})
