import { describe, expect, it } from "vitest"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { run } from "../../../scripts/check-mutation-count.mjs"

/**
 * Fixture mínimo: um repo com os 3 arquivos que o guard lê.
 * defaultCount define o nº de entradas no SUBTESTS do master.
 */
interface FixtureOpts {
  count?: number
  /**
   * Sufixo do `name:` do job. O DEFAULT é vazio — o contexto do required check
   * é COUNT-FREE de propósito: um número aqui re-acopla o tamanho da matriz ao
   * contrato de merge (o branch protection exige o nome do job como contexto).
   */
  workflowNameSuffix?: string
  workflowSummary?: number | null
  workflowComment?: number | null
  masterHeader?: number | null
  readmeLive?: number | null
  readmeHistorical?: number | null
  /** omite TODAS as linhas de count do README (testa o caminho 'perdeu o count') */
  readmeOmitCount?: boolean
}

function makeFixture({
  count = 13,
  workflowNameSuffix = "",
  workflowSummary = null,
  workflowComment = null,
  masterHeader = null,
  readmeLive = null,
  readmeHistorical = null,
  readmeOmitCount = false,
}: FixtureOpts = {}) {
  const dir = mkdtempSync(join(tmpdir(), "mutation-count-"))
  mkdirSync(join(dir, "scripts"), { recursive: true })
  mkdirSync(join(dir, ".github/workflows"), { recursive: true })
  const entries = []
  for (let i = 0; i < count; i++) {
    entries.push(`  "sub-${i}|Desc ${i}|scripts/test-mutation-sub-${i}.sh"`)
  }
  const master = `#!/usr/bin/env bash
# Roda os ${masterHeader ?? count} mutation tests node-puro dos guards de CI num ÚNICO script
SUBTESTS=(
${entries.join("\n")}
)
`
  writeFileSync(join(dir, "scripts/test-mutation-guards.sh"), master)

  const prCheck = `jobs:
  mutation-guards:
    name: Mutation guards master${workflowNameSuffix}
    steps:
      - run: bash scripts/test-mutation-guards.sh
      - name: Summary
        run: echo "✅ All ${workflowSummary ?? count} node-pure mutation tests passed (...)."
`
  // comentário do job — o guard busca "Roda os N mutation tests node-puro"
  const prCheckWithComment = prCheck.replace(
    "jobs:",
    `# Roda os ${workflowComment ?? count} mutation tests node-puro dos guards de CI num JOB SÓ via`,
  )
  writeFileSync(join(dir, ".github/workflows/pr-check.yml"), prCheckWithComment)

  const live = readmeLive ?? count
  const hist = readmeHistorical ?? null
  const readme = readmeOmitCount
    ? `# Repo
Sem nenhuma ref de count aqui.
`
    : `# Repo
**${live} sub-tests node-puro** via \`scripts/test-mutation-guards.sh\`
| master \`mutation-guards\` (${live} sub-tests) | x |
${hist ? `era de ${hist} sub-tests e o timing-budget foi adicionado após a medição de ${hist}.` : ""}
`
  writeFileSync(join(dir, "README.md"), readme)
  return dir
}

describe("check-mutation-count", () => {
  it("passa com fixture consistente (todas as refs = derivado)", () => {
    const dir = makeFixture()
    const r = run(dir)
    expect(r.ok).toBe(true)
    expect(r.derivedCount).toBe(13)
    expect(r.violations).toEqual([])
  })

  it("deriva o count de uma matriz de 5 entradas", () => {
    const dir = makeFixture({ count: 5 })
    const r = run(dir)
    expect(r.ok).toBe(true)
    expect(r.derivedCount).toBe(5)
  })

  it("passa com o name do job COUNT-FREE (o contexto do required check é estável)", () => {
    const dir = makeFixture()
    const r = run(dir)
    expect(r.ok).toBe(true)
    expect(r.refs.prCheck.context).toBe("Mutation guards master")
  })

  it("falha quando o name do job volta a carregar o count (matriz 13)", () => {
    const dir = makeFixture({ workflowNameSuffix: " (13 node-pure mutation tests)" })
    const r = run(dir)
    expect(r.ok).toBe(false)
    expect(r.derivedCount).toBe(13)
    // A violação NOMEIA o acoplamento: o contexto protegido passaria a mudar a
    // cada bump de matriz.
    expect(
      r.violations.some((v) => v.includes("name do job") && v.includes("required check")),
    ).toBe(true)
  })

  it("falha mesmo com o count CERTO no name — nenhum número pode viver ali", () => {
    // O caso que o guard antigo APROVAVA: name coerente com a matriz. O contrato
    // de merge muda do mesmo jeito quando a matriz sobe, então o número é
    // proibido independentemente de estar correto hoje.
    const dir = makeFixture({ count: 14, workflowNameSuffix: " (14 node-pure mutation tests)" })
    const r = run(dir)
    expect(r.ok).toBe(false)
    expect(r.violations.some((v) => v.includes("name do job"))).toBe(true)
  })

  it("falha quando o name do job é outro texto (contexto renomeado ou job ausente)", () => {
    const dir = makeFixture({ workflowNameSuffix: " (renomeado)" })
    const r = run(dir)
    expect(r.ok).toBe(false)
    expect(r.violations.some((v) => v.includes("name do job"))).toBe(true)
  })

  it("falha quando o summary diverge", () => {
    const dir = makeFixture({ workflowSummary: 11 })
    const r = run(dir)
    expect(r.ok).toBe(false)
    expect(r.violations.some((v) => v.includes("summary"))).toBe(true)
  })

  it("falha quando o comentário do job diverge", () => {
    const dir = makeFixture({ workflowComment: 9 })
    const r = run(dir)
    expect(r.ok).toBe(false)
    expect(r.violations.some((v) => v.includes("comentário"))).toBe(true)
  })

  it("falha quando o header do master diverge", () => {
    const dir = makeFixture({ masterHeader: 7 })
    const r = run(dir)
    expect(r.ok).toBe(false)
    expect(r.violations.some((v) => v.includes("header"))).toBe(true)
  })

  it("falha com ref viva divergente no README (12 sub-tests ≠ 13)", () => {
    const dir = makeFixture({ readmeLive: 12 })
    const r = run(dir)
    expect(r.ok).toBe(false)
    expect(r.violations.some((v) => v.includes("README.md:") && v.includes("≠ 13"))).toBe(true)
  })

  it("ignora ref HISTÓRICA no README (era de 5 sub-tests)", () => {
    const dir = makeFixture({ readmeHistorical: 5 })
    const r = run(dir)
    expect(r.ok).toBe(true)
    expect(r.refs.readmeHistorical.length).toBe(1)
    expect(r.refs.readmeHistorical[0].number).toBe(5)
  })

  it("falha quando o README perdeu toda ref viva com o count atual (SEM refs)", () => {
    const dir = makeFixture({ readmeOmitCount: true })
    const r = run(dir)
    expect(r.ok).toBe(false)
    // ISOLADO: sem refs divergentes (nenhuma linha de count existe), a ÚNICA
    // violação é a do count sumido da doc.
    expect(r.violations).toHaveLength(1)
    expect(r.violations[0]).toContain("perdeu o count")
  })

  it("exit 2 (INFRA) quando o master está ausente", () => {
    const dir = makeFixture()
    rmSync(join(dir, "scripts/test-mutation-guards.sh"), { force: true })
    expect(() => run(dir)).toThrow(/arquivo ausente: scripts\/test-mutation-guards.sh/)
  })

  it("exit 2 (INFRA) quando o array SUBTESTS não existe", () => {
    const dir = makeFixture()
    const masterPath = join(dir, "scripts/test-mutation-guards.sh")
    const master = readFileSync(masterPath, "utf8").replace("SUBTESTS=(", "NOTHING=(")
    writeFileSync(masterPath, master)
    expect(() => run(dir)).toThrow(/SUBTESTS/)
  })
})
