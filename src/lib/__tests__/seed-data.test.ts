/**
 * seed-data.test.ts
 *
 * Travam a lógica COMPARTILHADA entre os dois seeds (prisma/seed.ts dev e
 * prisma/seed-prod.ts produção). Se categorySlug/categoryOrder mudarem,
 * os catálogos de dev e prod divergem silenciosamente — estes testes
 * fixam os valores canônicos conhecidos.
 */

import { describe, it, expect } from "vitest"
import {
  slugify,
  CATEGORY_SPEC,
  DEFAULT_SETTINGS,
  categorySlug,
  categoryOrder,
  buildSeedPlan,
  type CategorySeedInput,
  type CurrentCategoryRow,
  type CurrentSettingRow,
} from "../../../prisma/seed-data"

/** Estado atual "canônico": tudo igual ao spec — plano deve ser 100% unchanged. */
function canonicalCurrentState(): {
  categories: CurrentCategoryRow[]
  settings: CurrentSettingRow[]
} {
  const categories: CurrentCategoryRow[] = CATEGORY_SPEC.map((c) => ({
    slug: categorySlug(c),
    name: c.name,
    level: c.level,
    parentName: c.parent ?? null,
    icon: c.icon ?? null,
    order: categoryOrder(c),
    active: true,
  }))
  const settings: CurrentSettingRow[] = DEFAULT_SETTINGS.map((s) => ({
    key: s.key,
    value: s.value,
  }))
  return { categories, settings }
}

describe("slugify", () => {
  it("normaliza acentos, lowercase e espaços", () => {
    expect(slugify("Tomadas e interruptores")).toBe("tomadas-e-interruptores")
    expect(slugify("Elétrica")).toBe("eletrica")
    expect(slugify("Pós-Obra")).toBe("pos-obra")
  })
})

describe("categorySlug", () => {
  it("pais usam apenas o próprio nome", () => {
    expect(categorySlug({ name: "Reparos", level: 0 })).toBe("reparos")
  })

  it("filhos herdam o slug do pai", () => {
    const c: CategorySeedInput = {
      name: "Tomadas e interruptores",
      parent: "Elétrica",
      level: 2,
    }
    expect(categorySlug(c)).toBe("tomadas-e-interruptores-eletrica")
  })
})

describe("categoryOrder", () => {
  it("level 0 segue a ordem canônica Reparos=0, Limpeza=1, Reforma=2", () => {
    expect(categoryOrder({ name: "Reparos", level: 0 })).toBe(0)
    expect(categoryOrder({ name: "Limpeza", level: 0 })).toBe(1)
    expect(categoryOrder({ name: "Reforma", level: 0 })).toBe(2)
  })

  it("níveis > 0 usam order 0", () => {
    expect(categoryOrder({ name: "Elétrica", parent: "Reparos", level: 1 })).toBe(0)
  })
})

describe("CATEGORY_SPEC", () => {
  it("contém 27 categorias (3+7+17)", () => {
    expect(CATEGORY_SPEC.length).toBe(27)
    expect(CATEGORY_SPEC.filter((c) => c.level === 0)).toHaveLength(3)
    expect(CATEGORY_SPEC.filter((c) => c.level === 1)).toHaveLength(7)
    expect(CATEGORY_SPEC.filter((c) => c.level === 2)).toHaveLength(17)
  })

  it("todo pai existe no spec com level estritamente menor (ordenação estável)", () => {
    const levelByName = new Map(CATEGORY_SPEC.map((c) => [c.name, c.level]))
    for (const c of CATEGORY_SPEC) {
      if (c.parent) {
        expect(levelByName.has(c.parent)).toBe(true)
        expect(levelByName.get(c.parent)!).toBeLessThan(c.level)
      }
    }
  })

  it("slugs são únicos na árvore", () => {
    const slugs = CATEGORY_SPEC.map((c) => categorySlug(c))
    expect(new Set(slugs).size).toBe(slugs.length)
  })
})

describe("DEFAULT_SETTINGS", () => {
  it("contém 9 settings com keys únicas", () => {
    expect(DEFAULT_SETTINGS.length).toBe(9)
    const keys = DEFAULT_SETTINGS.map((s) => s.key)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys).toContain("site_name")
    expect(keys).toContain("payment_pix_key")
  })
})

describe("buildSeedPlan", () => {
  it("banco vazio → tudo create (27 categorias + 9 settings)", () => {
    const plan = buildSeedPlan([], [])
    expect(plan.categories).toHaveLength(27)
    expect(plan.settings).toHaveLength(9)
    expect(plan.summary.categoriesCreate).toBe(27)
    expect(plan.summary.categoriesUpdate).toBe(0)
    expect(plan.summary.categoriesUnchanged).toBe(0)
    expect(plan.summary.settingsCreate).toBe(9)
    expect(plan.summary.settingsUpdate).toBe(0)
    expect(plan.summary.settingsUnchanged).toBe(0)
    // todos os creates têm slug canônico
    expect(plan.categories.every((a) => a.action === "create")).toBe(true)
  })

  it("banco canônico → tudo unchanged (idempotência do upsert)", () => {
    const current = canonicalCurrentState()
    const plan = buildSeedPlan(current.categories, current.settings)
    expect(plan.summary.categoriesCreate).toBe(0)
    expect(plan.summary.categoriesUpdate).toBe(0)
    expect(plan.summary.categoriesUnchanged).toBe(27)
    expect(plan.summary.settingsCreate).toBe(0)
    expect(plan.summary.settingsUpdate).toBe(0)
    expect(plan.summary.settingsUnchanged).toBe(9)
  })

  it("detecta update quando name/level/icon/order/parent divergem", () => {
    const current = canonicalCurrentState()
    // Divergência: Reparos (level 0) — muda order e icon
    const reparos = current.categories.find((c) => c.slug === "reparos")!
    reparos.order = 99
    reparos.icon = "different-icon"
    // Divergência: Elétrica (level 1) — muda level e parent
    // slug canônico: filhos herdam o slug do pai → "eletrica-reparos"
    const eletrica = current.categories.find((c) => c.slug === "eletrica-reparos")!
    eletrica.level = 3
    eletrica.parentName = "Reforma"
    // Divergência: site_name — muda value
    const siteName = current.settings.find((s) => s.key === "site_name")!
    siteName.value = "Severinno 2.0"

    const plan = buildSeedPlan(current.categories, current.settings)
    const reparosAction = plan.categories.find((a) => a.slug === "reparos")!
    // slug canônico de "Elétrica" (level 1, parent Reparos) → "eletrica-reparos"
    const eletricaAction = plan.categories.find((a) => a.slug === "eletrica-reparos")!
    const siteNameAction = plan.settings.find((a) => a.key === "site_name")!

    expect(reparosAction.action).toBe("update")
    if (reparosAction.action === "update") {
      expect(reparosAction.changes.sort()).toEqual(["icon", "order"])
    }
    expect(eletricaAction.action).toBe("update")
    if (eletricaAction.action === "update") {
      expect(eletricaAction.changes.sort()).toEqual(["level", "parent"])
    }
    expect(siteNameAction.action).toBe("update")
    if (siteNameAction.action === "update") {
      expect(siteNameAction.changes).toEqual(["value"])
    }
    expect(plan.summary.categoriesUpdate).toBe(2)
    expect(plan.summary.settingsUpdate).toBe(1)
    expect(plan.summary.categoriesUnchanged).toBe(25)
    expect(plan.summary.settingsUnchanged).toBe(8)
  })

  it("create preserva parent/icon/order corretos para subcategorias", () => {
    const plan = buildSeedPlan([], [])
    const tomadas = plan.categories.find((a) => a.slug === "tomadas-e-interruptores-eletrica")!
    expect(tomadas.action).toBe("create")
    if (tomadas.action === "create") {
      expect(tomadas.parent).toBe("Elétrica")
      expect(tomadas.level).toBe(2)
      expect(tomadas.icon).toBeNull()
      expect(tomadas.order).toBe(0)
    }
  })

  it("categoria inativa no banco NÃO é marcada como update (active fora do reconcile)", () => {
    const current = canonicalCurrentState()
    const limpeza = current.categories.find((c) => c.slug === "limpeza")!
    limpeza.active = false
    const plan = buildSeedPlan(current.categories, current.settings)
    const limpezaAction = plan.categories.find((a) => a.slug === "limpeza")!
    // active não é comparado — então continua unchanged (não há mudanças de estrutura)
    expect(limpezaAction.action).toBe("unchanged")
  })
})
