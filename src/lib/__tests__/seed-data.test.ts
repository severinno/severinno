/**
 * seed-data.test.ts
 *
 * Travam a lógica COMPARTILHADA entre os dois seeds (prisma/seed.ts dev e
 * prisma/seed-prod.ts produção). Se categorySlug/categoryOrder mudarem,
 * os catálogos de dev e prod divergem silenciosamente — estes testes
 * fixam os valores canônicos conhecidos.
 */

import { describe, it, expect, vi } from "vitest"
import {
  slugify,
  CATEGORY_SPEC,
  DEFAULT_SETTINGS,
  buildPatchedSpec,
  categorySlug,
  categoryOrder,
  buildSeedPlan,
  printPlan,
  validateCategorySpec,
  assertValidCategorySpec,
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

describe("buildPatchedSpec", () => {
  it("retorna CATEGORY_SPEC inalterado quando raw é ausente", () => {
    expect(buildPatchedSpec(undefined, true)).toBe(CATEGORY_SPEC)
    expect(buildPatchedSpec("", true)).toBe(CATEGORY_SPEC)
  })

  it("retorna CATEGORY_SPEC inalterado quando o patch está desabilitado (produção)", () => {
    const raw = JSON.stringify([{ name: "Reparos", order: 5 }])
    expect(buildPatchedSpec(raw, false)).toBe(CATEGORY_SPEC)
  })

  it("aplica icon/order em update in-place (mesmo slug, sem duplicar)", () => {
    const spec = buildPatchedSpec(
      JSON.stringify([
        { name: "Elétrica", icon: "bolt" },
        { name: "Reparos", order: 5 },
      ]),
      true,
    )
    expect(spec).toHaveLength(CATEGORY_SPEC.length)
    const eletrica = spec.find((c) => c.name === "Elétrica")!
    expect(eletrica.icon).toBe("bolt")
    expect(categorySlug(eletrica)).toBe("eletrica-reparos")
    const reparos = spec.find((c) => c.name === "Reparos")!
    expect(reparos.order).toBe(5)
    expect(categorySlug(reparos)).toBe("reparos")
    // itens não patchados permanecem intactos
    const limpeza = spec.find((c) => c.name === "Limpeza")!
    expect(limpeza.icon).toBe("sparkles")
    expect(limpeza.order).toBeUndefined()
  })

  it("renameTo renomeia o item e reparenta os filhos em cascata (um nível)", () => {
    const spec = buildPatchedSpec(
      JSON.stringify([{ name: "Elétrica", renameTo: "Eletricidade" }]),
      true,
    )
    expect(spec).toHaveLength(CATEGORY_SPEC.length)
    // item renomeado — slug embute o pai
    const eletricidade = spec.find((c) => c.name === "Eletricidade")!
    expect(eletricidade.parent).toBe("Reparos")
    expect(categorySlug(eletricidade)).toBe("eletricidade-reparos")
    // filhos passam a referenciar o nome novo (cascata)
    const tomadas = spec.find((c) => c.name === "Tomadas e interruptores")!
    expect(tomadas.parent).toBe("Eletricidade")
    expect(categorySlug(tomadas)).toBe("tomadas-e-interruptores-eletricidade")
    // a árvore patchada continua estruturalmente válida (fail-fast não dispara)
    expect(() => assertValidCategorySpec(spec)).not.toThrow()
  })

  it("lança Error para JSON inválido (fail-fast antes de qualquer escrita)", () => {
    expect(() => buildPatchedSpec("{não é json", true)).toThrow(/SEED_SPEC_PATCH inválido/)
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

describe("validateCategorySpec", () => {
  it("spec canônico é válido (zero issues)", () => {
    expect(validateCategorySpec(CATEGORY_SPEC)).toEqual([])
  })

  it("detecta nomes duplicados (ambiguidade do catByName por nome)", () => {
    const spec: CategorySeedInput[] = [
      { name: "Reparos", level: 0 },
      // segundo "Residencial" — resolução de parent por nome ficaria ambígua
      { name: "Residencial", parent: "Reparos", level: 1 },
      { name: "Residencial", parent: "Reparos", level: 1, icon: "x" },
    ]
    const issues = validateCategorySpec(spec)
    expect(issues.some((i) => i.includes("nome duplicado 'Residencial'"))).toBe(true)
    // assertValidCategorySpec lança (fail-fast antes de qualquer escrita)
    expect(() => assertValidCategorySpec(spec)).toThrow(/CATEGORY_SPEC inválido/)
  })

  it("detecta parent inexistente (typo viraria parentId=null silencioso)", () => {
    const spec: CategorySeedInput[] = [
      { name: "Reparos", level: 0 },
      { name: "Elétrica", parent: "Repparos", level: 1 }, // typo
    ]
    const issues = validateCategorySpec(spec)
    expect(issues.some((i) => i.includes("parent inexistente 'Repparos'"))).toBe(true)
    expect(() => assertValidCategorySpec(spec)).toThrow()
  })

  it("detecta parent com level >= filho (árvore quebrada)", () => {
    const spec: CategorySeedInput[] = [
      { name: "Reparos", level: 0 },
      { name: "Elétrica", parent: "Reparos", level: 1 },
      { name: "Tomadas", parent: "Elétrica", level: 1 }, // deveria ser level 2
    ]
    const issues = validateCategorySpec(spec)
    expect(
      issues.some((i) => i.includes("'Tomadas' (level 1) tem parent 'Elétrica' (level 1)")),
    ).toBe(true)
  })

  it("detecta level 0 com parent (pais só podem ser raiz)", () => {
    const spec: CategorySeedInput[] = [
      { name: "Reparos", level: 0 },
      { name: "Limpeza", parent: "Reparos", level: 0 }, // level 0 não pode ter parent
    ]
    const issues = validateCategorySpec(spec)
    expect(issues.some((i) => i.includes("é level 0 mas tem parent"))).toBe(true)
  })

  it("detecta level > 0 sem parent (filhos só existem sob um pai)", () => {
    const spec: CategorySeedInput[] = [
      { name: "Reparos", level: 0 },
      { name: "Elétrica", level: 1 }, // sem parent
    ]
    const issues = validateCategorySpec(spec)
    expect(issues.some((i) => i.includes("não tem parent"))).toBe(true)
  })

  it("não acusa falsa colisão quando nomes slugificam igual mas em níveis/país diferentes", () => {
    // "Pós-Obra" (level 0) e "Pos Obra" (filho de "Pós-Obra") têm nomes que
    // slugificam para o mesmo token, mas os slugs NÃO colidem porque o filho
    // herda o slug do pai ("pos-obra-pos-obra" ≠ "pos-obra").
    const spec: CategorySeedInput[] = [
      { name: "Pós-Obra", level: 0 },
      { name: "Pos Obra", parent: "Pós-Obra", level: 1 },
    ]
    expect(validateCategorySpec(spec)).toEqual([])
  })

  it("detecta colisão real de slug (dois filhos do MESMO parent com slugify igual)", () => {
    const spec: CategorySeedInput[] = [
      { name: "Reparos", level: 0 },
      { name: "Pós-Obra", parent: "Reparos", level: 1 },
      { name: "Pos Obra", parent: "Reparos", level: 1 },
    ]
    const issues = validateCategorySpec(spec)
    expect(issues.some((i) => i.includes("slug duplicado 'pos-obra-reparos'"))).toBe(true)
    expect(() => assertValidCategorySpec(spec)).toThrow()
  })

  it("assertValidCategorySpec passa sem lançar no spec canônico", () => {
    expect(() => assertValidCategorySpec(CATEGORY_SPEC)).not.toThrow()
  })
})

describe("printPlan", () => {
  /** Captura console.log durante a execução de fn (printPlan é console-only). */
  function captureLog(fn: () => void): string[] {
    const lines: string[] = []
    const spy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "))
    })
    try {
      fn()
    } finally {
      spy.mockRestore()
    }
    return lines
  }

  it("controle negativo: estado canônico não dispara aviso de renomeação", () => {
    const current = canonicalCurrentState()
    const plan = buildSeedPlan(current.categories, current.settings)
    const lines = captureLog(() => printPlan(plan, current))
    const out = lines.join("\n")

    expect(out).not.toContain("POSSÍVEL RENOMEAÇÃO")
    // Header do bloco de extras (casing real do printPlan — "categoria(s)"
    // minúsculo); validar também a linha de settings extras para cobrir
    // AMBAS as seções "Fora do spec" no controle negativo.
    expect(out).not.toContain("Fora do spec")
    expect(out).not.toContain("categoria(s) extra(s)")
    expect(out).not.toContain("setting(s) extra(s)")
    expect(out).toContain("DRY-RUN — nenhuma escrita será feita no banco")
    expect(out).toContain("27 inalteradas")
  })

  it("renomeação com um único filho mostra a contagem singular", () => {
    const current = canonicalCurrentState()
    // "Pintura" (level 1, parent Reparos) tem 3 filhos no spec — remove 2
    // do estado atual para deixar apenas 1 apontando para ela.
    // (filtra por NAME: o slug canônico embute o slug do pai, então
    // "pintura-interna-pintura" ≠ "pintura-interna-reparos".)
    const pinturaKids = ["Pintura interna", "Pintura externa"]
    current.categories = current.categories.filter((c) => !pinturaKids.includes(c.name))
    const pintura = current.categories.find((c) => c.slug === "pintura-reparos")!
    pintura.slug = "pintura-reforma" // renomeação: parent era "Reforma"

    const plan = buildSeedPlan(current.categories, current.settings)
    const lines = captureLog(() => printPlan(plan, current))
    const out = lines.join("\n")

    expect(out).toContain(
      "• 'Pintura': banco tem slug 'pintura-reforma', o spec quer 'pintura-reparos'",
    )
    expect(out).toContain("1 filho(s) no banco ainda aponta(m) para a linha antiga")
  })

  it.each([
    // Quantos filhos de "Elétrica" permanecem no estado atual apontando para a
    // linha antiga — null (sem sufixo), 1, 2 e 3 (todos os filhos do spec).
    { kids: 0, expected: null },
    { kids: 1, expected: "1 filho(s) no banco ainda aponta(m) para a linha antiga" },
    { kids: 2, expected: "2 filho(s) no banco ainda aponta(m) para a linha antiga" },
    { kids: 3, expected: "3 filho(s) no banco ainda aponta(m) para a linha antiga" },
  ])("renomeação com $kids filho(s) no banco → contagem correta no aviso", ({ kids, expected }) => {
    const current = canonicalCurrentState()
    // Filhos do spec sob "Elétrica" (level 2) — controlam a contagem do aviso.
    const eletricaKids = ["Tomadas e interruptores", "Curto-circuito", "Quadro elétrico"]
    // Remove (3 - kids) filhos do estado atual; kids=3 mantém todos.
    const toRemove = eletricaKids.slice(0, eletricaKids.length - kids)
    current.categories = current.categories.filter((c) => !toRemove.includes(c.name))
    // Renomeação: "Elétrica" existe no banco sob um slug antigo.
    const eletrica = current.categories.find((c) => c.slug === "eletrica-reparos")!
    eletrica.slug = "eletrica-eletricidade"

    const plan = buildSeedPlan(current.categories, current.settings)
    const lines = captureLog(() => printPlan(plan, current))
    const out = lines.join("\n")

    expect(out).toContain("⚠️  POSSÍVEL RENOMEAÇÃO DETECTADA")
    expect(out).toContain(
      "• 'Elétrica': banco tem slug 'eletrica-eletricidade', o spec quer 'eletrica-reparos'",
    )
    // Aviso de órfã — emitido uma vez, fora do loop de renomeações (vale p/ todos os casos)
    expect(out).toContain("O upsert CRIARÁ a linha nova e DEIXARÁ a antiga órfã")
    if (expected !== null) {
      expect(out).toContain(expected)
    } else {
      // kids=0 → printPlan NÃO adiciona o sufixo de contagem
      expect(out).not.toContain("filho(s) no banco ainda aponta(m)")
    }
  })

  it("categoria inativa no banco exibe o aviso 'O seed NÃO as reativa' sem marcar update no plano", () => {
    const current = canonicalCurrentState()
    const limpeza = current.categories.find((c) => c.slug === "limpeza")!
    limpeza.active = false

    const plan = buildSeedPlan(current.categories, current.settings)
    const lines = captureLog(() => printPlan(plan, current))
    const out = lines.join("\n")

    // active NÃO é comparado no reconcile → ação continua unchanged, nunca update
    const limpezaAction = plan.categories.find((a) => a.slug === "limpeza")!
    expect(limpezaAction.action).toBe("unchanged")
    expect(plan.summary.categoriesUpdate).toBe(0)

    // Bloco de inativas do printPlan (linhas 482-490 do seed-data.ts)
    expect(out).toContain("1 categoria(s) inativa(s) no banco: Limpeza")
    expect(out).toContain(
      "O seed NÃO as reativa (reconcile seguro preserva a desativação do admin).",
    )
  })
})
