/**
 * bench-guard-timing-lint.test.ts
 *
 * Trava o CONTRATO da medição do custo da unificação do lint em
 * scripts/bench-guard-timing.mjs — a medição que sustenta o número que a
 * documentação apresenta como preço da régua única (+20,1s por call site,
 * +80,4s por rodada de CI).
 *
 * POR QUE o teste importa o SCRIPT em vez de repetir a lista: o número só vale
 * se a LISTA de call sites for DERIVADA dos próprios workflows. Uma pipeline que
 * passe a rodar `bun run lint` entra na conta sozinha — e é este teste que falha
 * quando isso acontece sem que os pagantes declarados sejam revistos, em vez de
 * o número continuar sendo publicado com uma lista que envelheceu.
 *
 * Execução focada:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/bench-guard-timing-lint.test.ts
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"

import { check, resolveConfig } from "prettier"
import { describe, expect, it } from "vitest"

import {
  LINT_CANONICAL_CMD,
  LINT_LEGACY_CMD,
  LINT_PRETTIER_CMD,
  LINT_UPGRADED_SITES,
  legacyCallSites,
  lintCallSites,
  lintCostViolations,
} from "../../../scripts/bench-guard-timing.mjs"

const REPO_ROOT = join(__dirname, "..", "..", "..")

describe("bench-guard-timing — o custo da unificação do lint", () => {
  it("mede o comando CANÔNICO do invariante lint (a mesma fonte do CI)", () => {
    // O `bun run lint` do package.json é a régua; o benchmark não pode medir uma
    // variação dela (por exemplo o par inline, que não existe mais).
    expect(LINT_CANONICAL_CMD).toBe("bun run lint")
  })

  it("deriva os call sites dos workflows: 5 em 4 pipelines", () => {
    const sites = lintCallSites()

    expect(sites.map((s) => s.file).sort()).toEqual([
      ".gitea/workflows/ci.yml",
      ".github/workflows/ci.yml",
      ".github/workflows/pr-check.yml",
      ".github/workflows/release-deploy.yml",
    ])
    // O pr-check.yml tem DOIS call sites (`lint-guard` e o job `check`): o
    // número de pipelines não é o número de call sites, e a conta do custo é por
    // call site — por isso os dois campos existem separados.
    expect(sites.find((s) => s.file === ".github/workflows/pr-check.yml")?.count).toBe(2)
    expect(sites.reduce((acc, s) => acc + s.count, 0)).toBe(5)
  })

  it("prova cada pagante declarado contra a lista medida", () => {
    const declared = new Set(lintCallSites().map((s) => s.file))

    expect(LINT_UPGRADED_SITES.length).toBe(4)
    for (const site of LINT_UPGRADED_SITES) {
      expect(declared.has(site.file)).toBe(true)
      // A razão fica no relatório: um pagante sem razão é um número sem causa.
      expect(site.where.length).toBeGreaterThan(10)
    }
  })

  it("a régua LAXA (`eslint .`) não aparece em workflow nenhum", () => {
    // É o que prova que o "antes" medido é contrafactual e não um segundo gate
    // rodando em paralelo: se a régua laxa voltasse a uma pipeline, a
    // unificação estaria incompleta e o delta medido teria mais de uma causa.
    expect(legacyCallSites()).toEqual([])
    expect(LINT_LEGACY_CMD).not.toBe(LINT_CANONICAL_CMD)
  })

  it("a metade nova é LIDA do script lint do package.json", () => {
    const scripts = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")).scripts
    const entry: string = scripts.lint

    // Se o escopo do prettier mudar no package.json, a metade medida acompanha —
    // sem cópia em dois lugares para divergir.
    expect(LINT_PRETTIER_CMD).toBe(`bunx ${entry.split(" && ")[0].trim()}`)
    expect(LINT_PRETTIER_CMD.startsWith("bunx prettier --check")).toBe(true)
    // A outra metade do script é o eslint com o teto de warnings: o que a
    // unificação acrescentou foi só o prettier, e é o benchmark que confere se o
    // delta medido fecha com ele.
    expect(entry.split(" && ")[1]).toMatch(/^eslint \. --max-warnings 0$/)
  })

  it("o JSON versionado passa no lint do repositório (forma prettier-estável)", async () => {
    // O benchmark ESCREVE este arquivo e ele é commitado: se a forma que o
    // `JSON.stringify(…, 2)` produz não for a que o prettier produz, quem
    // commitar o resultado quebra o `bun run lint` — inclusive o do CI da
    // forja. Aconteceu: amostras como array de escalares são colapsadas pelo
    // prettier e expandidas pelo stringify. O teste fecha a porta.
    const file = join(REPO_ROOT, "docs", "benchmarks", "guard-timing-latest.json")
    const source = readFileSync(file, "utf8")
    const config = await resolveConfig(file)

    await expect(check(source, { ...config, parser: "json" })).resolves.toBe(true)
  })

  it("o contrato da conta MORDE: um pagante declarado que sumiu é violação", () => {
    // Mutação: a árvore real passa (0 violações), mas tirar da lista medida o
    // arquivo que o declara como pagante tem de produzir a violação — senão o
    // "× 4 call sites" seria um multiplicador sem lastro.
    const sites = lintCallSites()
    expect(lintCostViolations(sites)).toEqual([])

    const semAPipeline = sites.filter((s) => s.file !== LINT_UPGRADED_SITES[0].file)
    const violations = lintCostViolations(semAPipeline)
    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain(LINT_UPGRADED_SITES[0].file)
    expect(violations[0]).toContain(LINT_CANONICAL_CMD)
  })
})
