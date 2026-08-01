/**
 * seed-e2e-utils.test.ts
 *
 * Testes unitários para scripts/seed-e2e-utils.ts — o helper compartilhado
 * entre os E2Es dos seeds (test-seed-prod-e2e.ts / test-seed-dev-e2e.ts).
 *
 * Cobre as funções PURAS (sem banco):
 *   - UPDATE_PATCHES / RENAME_PATCHES + JSONs derivados (paridade com o
 *     seed-data: patchedUpdateSpec / patchedRenameSpec via buildPatchedSpec)
 *   - Slugs canônicos (ELETRICA_SLUG, REPAROS_SLUG, ELETRICIDADE_SLUG)
 *   - FILHOS_ELETRICA / TOTAL_RENAME / renamedChildSlug (cascata do rename)
 *   - deriveRenameContext (contexto agregado do rename)
 *   - assertPatchedUpdatePlan (3 asserções: 0 create, icon, order) — com um
 *     reporter fake validando sucesso e falha
 *
 * Usage:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/seed-e2e-utils.test.ts
 *
 * Exit codes:
 *   0 — todos os testes passaram
 *   1 — pelo menos um teste falhou
 */

import { describe, it, expect, vi } from "vitest"
import {
  UPDATE_PATCHES,
  UPDATE_PATCH,
  RENAME_PATCHES,
  RENAME_PATCH,
  ELETRICA_SLUG,
  REPAROS_SLUG,
  ELETRICIDADE_SLUG,
  FILHOS_ELETRICA,
  TOTAL_RENAME,
  renamedChildSlug,
  deriveRenameContext,
  assertPatchedUpdatePlan,
  patchedUpdateSpec,
  patchedRenameSpec,
} from "../../../scripts/seed-e2e-utils"
import {
  CATEGORY_SPEC,
  buildPatchedSpec,
  buildSeedPlan,
  categorySlug,
  type CurrentCategoryRow,
} from "../../../prisma/seed-data"

describe("seed-e2e-utils — patches (paridade com o seed-data)", () => {
  it("UPDATE_PATCHES: Elétrica troca icon para bolt e Reparos ganha order 5", () => {
    const byName = new Map(UPDATE_PATCHES.map((p) => [p.name, p]))
    expect(byName.get("Elétrica")?.icon).toBe("bolt")
    expect(byName.get("Reparos")?.order).toBe(5)
  })

  it("UPDATE_PATCH serializa os patches (round-trip via buildPatchedSpec)", () => {
    const viaJson = buildPatchedSpec(UPDATE_PATCH, true)
    const elétrica = viaJson.find((c) => c.name === "Elétrica")
    const reparos = viaJson.find((c) => c.name === "Reparos")
    expect(elétrica?.icon).toBe("bolt")
    expect(reparos?.order).toBe(5)
    expect(viaJson.length).toBe(CATEGORY_SPEC.length)
  })

  it("patchedUpdateSpec() coincide com buildPatchedSpec(UPDATE_PATCH, true)", () => {
    expect(patchedUpdateSpec()).toEqual(buildPatchedSpec(UPDATE_PATCH, true))
  })

  it("RENAME_PATCHES: Elétrica renomeia para Eletricidade", () => {
    expect(RENAME_PATCHES[0]).toMatchObject({ name: "Elétrica", renameTo: "Eletricidade" })
  })

  it("RENAME_PATCH serializa o rename e cascateia nos filhos (via buildPatchedSpec)", () => {
    const viaJson = buildPatchedSpec(RENAME_PATCH, true)
    const eletricidade = viaJson.find((c) => c.name === "Eletricidade")
    expect(eletricidade).toBeDefined()
    expect(eletricidade?.parent).toBe("Reparos")
    // Filhos da antiga 'Elétrica' passam a referenciar 'Eletricidade'
    const filhos = viaJson.filter((c) => c.parent === "Eletricidade")
    expect(filhos.length).toBe(FILHOS_ELETRICA.length)
    expect(viaJson.some((c) => c.name === "Elétrica")).toBe(false)
  })

  it("patchedRenameSpec() coincide com buildPatchedSpec(RENAME_PATCH, true)", () => {
    expect(patchedRenameSpec()).toEqual(buildPatchedSpec(RENAME_PATCH, true))
  })
})

describe("seed-e2e-utils — slugs canônicos", () => {
  it("ELETRICA_SLUG é o slug canônico de 'Elétrica' sob 'Reparos'", () => {
    expect(ELETRICA_SLUG).toBe(categorySlug({ name: "Elétrica", parent: "Reparos", level: 1 }))
  })

  it("REPAROS_SLUG é o slug canônico de 'Reparos' (level 0)", () => {
    expect(REPAROS_SLUG).toBe(categorySlug({ name: "Reparos", level: 0 }))
  })

  it("ELETRICIDADE_SLUG é o slug canônico de 'Eletricidade' sob 'Reparos'", () => {
    expect(ELETRICIDADE_SLUG).toBe(
      categorySlug({ name: "Eletricidade", parent: "Reparos", level: 1 }),
    )
  })

  it("os 3 slugs são distintos entre si", () => {
    expect(new Set([ELETRICA_SLUG, REPAROS_SLUG, ELETRICIDADE_SLUG]).size).toBe(3)
  })
})

describe("seed-e2e-utils — cascata do rename", () => {
  it("FILHOS_ELETRICA contém todos os filhos de 'Elétrica' do spec", () => {
    const expected = CATEGORY_SPEC.filter((c) => c.parent === "Elétrica")
    expect(FILHOS_ELETRICA).toHaveLength(expected.length)
    expect(FILHOS_ELETRICA.length).toBeGreaterThanOrEqual(1)
    for (const f of FILHOS_ELETRICA) expect(f.parent).toBe("Elétrica")
  })

  it("TOTAL_RENAME = 1 (pai) + filhos", () => {
    expect(TOTAL_RENAME).toBe(1 + FILHOS_ELETRICA.length)
  })

  it("renamedChildSlug embute o slug do pai renomeado", () => {
    const filho = FILHOS_ELETRICA[0]
    const expected = categorySlug({ ...filho, parent: "Eletricidade" })
    expect(renamedChildSlug(filho)).toBe(expected)
    expect(renamedChildSlug(filho)).not.toBe(categorySlug(filho))
  })

  it("deriveRenameContext expõe oldSlug/newSlug/filhos/totalRename consistentes", () => {
    const ctx = deriveRenameContext()
    expect(ctx.oldSlug).toBe(ELETRICA_SLUG)
    expect(ctx.newSlug).toBe(ELETRICIDADE_SLUG)
    expect(ctx.filhos).toEqual(FILHOS_ELETRICA)
    expect(ctx.totalRename).toBe(TOTAL_RENAME)
  })
})

describe("seed-e2e-utils — assertPatchedUpdatePlan", () => {
  /** Monta um reporter fake que registra ok/bad. */
  function fakeReporter() {
    const ok = vi.fn()
    const bad = vi.fn()
    return { ok, bad, expect: (cond: boolean, msg: string) => (cond ? ok(msg) : bad(msg)) }
  }

  /** Estado canônico do banco (como se o seed já tivesse rodado). */
  function canonicalCurrentRows(): CurrentCategoryRow[] {
    return CATEGORY_SPEC.map((c) => ({
      slug: categorySlug(c),
      name: c.name,
      level: c.level,
      parentName: c.parent ?? null,
      icon: c.icon ?? null,
      order: 0,
      active: true,
    }))
  }

  it("passa quando o plano patchado acusa update (0 create + icon + order)", () => {
    const rep = fakeReporter()
    const plan = buildSeedPlan(canonicalCurrentRows(), [], patchedUpdateSpec())
    expect(plan.summary.categoriesCreate).toBe(0)
    assertPatchedUpdatePlan(rep, plan, ELETRICA_SLUG, REPAROS_SLUG)
    expect(rep.ok).toHaveBeenCalledTimes(3)
    expect(rep.bad).toHaveBeenCalledTimes(0)
  })

  it("falha (bad) quando o plano acusa create — banco vazio", () => {
    const rep = fakeReporter()
    const plan = buildSeedPlan([], [], patchedUpdateSpec())
    expect(plan.summary.categoriesCreate).toBeGreaterThan(0)
    assertPatchedUpdatePlan(rep, plan, ELETRICA_SLUG, REPAROS_SLUG)
    expect(rep.bad).toHaveBeenCalledTimes(3)
    expect(rep.ok).toHaveBeenCalledTimes(0)
  })

  it("mensagens de falha descrevem a causa (0 create esperado)", () => {
    const rep = fakeReporter()
    const plan = buildSeedPlan([], [], patchedUpdateSpec())
    assertPatchedUpdatePlan(rep, plan, ELETRICA_SLUG, REPAROS_SLUG)
    expect(rep.bad).toHaveBeenCalledWith(expect.stringContaining("plano patchado não cria linhas"))
  })
})
