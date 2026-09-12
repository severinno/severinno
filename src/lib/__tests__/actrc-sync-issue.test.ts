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
  hasSignature,
  markerOf,
  remedyFor,
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
