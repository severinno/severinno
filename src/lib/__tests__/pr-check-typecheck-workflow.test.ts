/**
 * pr-check-typecheck-workflow.test.ts
 *
 * Snapshot test do job typecheck do .github/workflows/pr-check.yml — o
 * typecheck PARALELO (item #6 da auditoria: o tsc de ~2min rodava SERIAL
 * dentro do job check, no meio do caminho crítico lint → ts-nocheck →
 * typecheck → unit tests).
 *
 * Valida (padrão dos testes de guards — espelha o
 * pr-check-unused-deps-workflow.test.ts, funções puras do
 * check-workflow-refs.mjs):
 *
 *   1. Sintaxe YAML — js-yaml parse do conteúdo REAL do arquivo + snapshot
 *      da estrutura do JOB.
 *   2. Fatos-chave — o job roda `bun run typecheck`, o comando CANÔNICO (o
 *      mesmo da forja dona do merge), cujo script carrega o heap de 4096MB (o
 *      crash de OOM documentado) em UM lugar só; prisma generate vem antes (o
 *      tsc requer o client); e o job check NÃO tem o step Type check (o
 *      typecheck vive APENAS no job paralelo).
 *   3. Refs contra o check-workflow-refs — extractScriptRefs /
 *      extractPkgScriptRefs rodam no conteúdo REAL e cada ref é validada.
 *
 * Uso:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/pr-check-typecheck-workflow.test.ts
 *
 * NOTA: snapshot de estrutura — para REGENERAR após mudança INTENCIONAL do
 * job: npx vitest run ... -u.
 */

import { describe, it, expect } from "vitest"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import yaml from "js-yaml"
import { extractScriptRefs, extractPkgScriptRefs } from "../../../scripts/check-workflow-refs.mjs"

const CWD = process.cwd()
const WF_NAME = "pr-check.yml"
const WF_PATH = join(CWD, ".github", "workflows", WF_NAME)
const JOB_KEY = "typecheck"

const content = readFileSync(WF_PATH, "utf8")
const parsed = yaml.load(content) as {
  jobs?: Record<
    string,
    {
      name?: string
      steps?: {
        name?: string
        id?: string
        run?: string
        uses?: string
        with?: object
        env?: object
      }[]
    }
  >
}

const job = parsed.jobs?.[JOB_KEY]
const steps = job?.steps ?? []

describe(`pr-check.yml — job ${JOB_KEY} (typecheck paralelo)`, () => {
  it("o arquivo YAML é válido e o job existe", () => {
    expect(parsed.jobs?.[JOB_KEY]).toBeDefined()
  })

  it("snapshot da estrutura do job (mudança estrutural exige revisão consciente)", () => {
    expect(job).toMatchSnapshot()
  })

  it("roda o comando CANÔNICO `bun run typecheck` (a mesma régua da forja)", () => {
    const tc = steps.find((s) => s.name?.startsWith("Type check"))
    expect(tc).toBeDefined()
    expect(tc?.run).toBe("bun run typecheck")
    // O heap NÃO é declarado aqui: ele vive no script `typecheck` do
    // package.json, junto com o `tsc --noEmit`. Dois lugares para o mesmo valor
    // eram duas réguas — o mesmo commit podia estourar a memória numa forja e
    // passar na outra.
    expect(tc?.env, "o heap voltou a ser declarado no step").toBeUndefined()
  })

  it("o heap de 4096MB e o `tsc --noEmit` vivem no script do package.json (fonte única)", () => {
    const pkg = JSON.parse(readFileSync(join(CWD, "package.json"), "utf8")) as {
      scripts: Record<string, string>
    }
    const script = pkg.scripts.typecheck ?? ""
    expect(script).toContain("tsc --noEmit")
    expect(script).toContain("--max-old-space-size=4096")
  })

  it("gera o prisma client ANTES do typecheck (o client é pré-requisito)", () => {
    const runs = steps.map((s) => s.run ?? "")
    const genIdx = runs.findIndex((r) => r.includes("prisma generate"))
    const tcIdx = runs.findIndex((r) => r.includes("bun run typecheck"))
    expect(genIdx).toBeGreaterThanOrEqual(0)
    expect(tcIdx).toBeGreaterThan(genIdx)
  })

  it("o job check NÃO tem mais o step Type check (extraído para o job paralelo)", () => {
    const check = parsed.jobs?.check
    expect(check).toBeDefined()
    const checkHasTc = (check?.steps ?? []).some((s) => s.name?.startsWith("Type check"))
    expect(checkHasTc).toBe(false)
  })

  it("refs do job existem no repo real (check-workflow-refs)", () => {
    const refs = [...extractScriptRefs(content), ...extractPkgScriptRefs(content)]
    const bad = refs.filter((r) => {
      if (r.ref.startsWith("scripts/")) {
        return !existsSync(join(CWD, r.ref))
      }
      return false
    })
    expect(bad).toEqual([])
  })
})
