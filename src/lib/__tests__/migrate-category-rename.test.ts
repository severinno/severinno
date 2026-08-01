/**
 * migrate-category-rename.test.ts
 *
 * Testes unitários das funções PURAS do scripts/migrate-category-rename.mjs:
 *   - slugify / categorySlug: DEVEM espelhar exatamente o prisma/seed-data.ts
 *     (o script deriva o slug canônico da nova linha — divergência criaria
 *     uma árvore inconsistente com o CATEGORY_SPEC)
 *   - buildMigrationPlan: monta o plano de migração (nova linha + filhos
 *     re-apontados com slug corrigido + services) sem tocar no banco
 *
 * O script principal NÃO dispara main() no import (guard IS_DIRECT_RUN),
 * então podemos importar as funções puras em isolamento.
 */

import { describe, it, expect } from "vitest"
import {
  slugify,
  categorySlug,
  buildMigrationPlan,
} from "../../../scripts/migrate-category-rename.mjs"
import {
  slugify as seedSlugify,
  categorySlug as seedCategorySlug,
  CATEGORY_SPEC,
} from "../../../prisma/seed-data"

describe("slugify (sync com seed-data)", () => {
  it("produz o mesmo resultado do seed-data para todas as categorias do spec", () => {
    for (const c of CATEGORY_SPEC) {
      expect(slugify(c.name)).toBe(seedSlugify(c.name))
    }
  })

  it("normaliza acentos, lowercase e espaços como o seed-data", () => {
    for (const input of ["Tomadas e interruptores", "Elétrica", "Pós-Obra", "Curto-circuito"]) {
      expect(slugify(input)).toBe(seedSlugify(input))
    }
  })

  it("manipula edge cases (vazio, só espaços, símbolos)", () => {
    for (const input of ["", "   ", "áéíóú", "123 abc", "A--B", "ç"]) {
      expect(slugify(input)).toBe(seedSlugify(input))
    }
  })
})

describe("categorySlug (sync com seed-data)", () => {
  it("produz o mesmo resultado do seed-data para pais e filhos", () => {
    for (const c of CATEGORY_SPEC) {
      const parentName = c.parent ?? null
      expect(categorySlug(c.name, parentName)).toBe(
        seedCategorySlug({ name: c.name, parent: parentName ?? undefined, level: c.level }),
      )
    }
  })
})

describe("buildMigrationPlan", () => {
  const oldCat = {
    id: "cat-old-1",
    name: "Elétrica",
    slug: "eletrica-reparos",
    parentId: "parent-reparos",
    level: 1,
    icon: "zap",
    order: 0,
    description: "Serviços elétricos",
  }

  it("deriva o slug canônico do novo nome (embutindo o parent)", () => {
    const plan = buildMigrationPlan({
      oldCat,
      newName: "Eletricidade",
      parentName: "Reparos",
    })
    expect(plan.newSlug).toBe("eletricidade-reparos")
    expect(plan.created.slug).toBe("eletricidade-reparos")
    expect(plan.created.name).toBe("Eletricidade")
    expect(plan.created.parentId).toBe("parent-reparos")
    expect(plan.created.level).toBe(1)
    expect(plan.created.icon).toBe("zap")
    expect(plan.created.description).toBe("Serviços elétricos")
  })

  it("re-aponta filhos e corrige o slug deles (embutem o slug do pai)", () => {
    const plan = buildMigrationPlan({
      oldCat,
      newName: "Eletricidade",
      parentName: "Reparos",
      children: [
        {
          id: "child-1",
          name: "Tomadas e interruptores",
          slug: "tomadas-e-interruptores-eletrica",
        },
        { id: "child-2", name: "Curto-circuito", slug: "curto-circuito-eletrica" },
      ],
      serviceCount: 5,
    })
    expect(plan.children).toHaveLength(2)
    expect(plan.children[0]).toEqual({
      id: "child-1",
      name: "Tomadas e interruptores",
      oldSlug: "tomadas-e-interruptores-eletrica",
      newSlug: "tomadas-e-interruptores-eletricidade",
    })
    expect(plan.children[1].newSlug).toBe("curto-circuito-eletricidade")
    expect(plan.serviceCount).toBe(5)
  })

  it("sem filhos e sem services → planos vazios", () => {
    const plan = buildMigrationPlan({
      oldCat,
      newName: "Eletricidade",
      parentName: "Reparos",
    })
    expect(plan.children).toEqual([])
    expect(plan.serviceCount).toBe(0)
  })

  it("categoria raiz (sem parent) → slug sem sufixo de parent", () => {
    const root = {
      ...oldCat,
      id: "cat-root",
      parentId: null,
      name: "Reparos",
      slug: "reparos",
      level: 0,
    }
    const plan = buildMigrationPlan({ oldCat: root, newName: "Repair", parentName: null })
    expect(plan.newSlug).toBe("repair")
  })

  it("--move-to (novo parent): parentId e slug derivam do parent DESTINO", () => {
    const plan = buildMigrationPlan({
      oldCat,
      newName: "Eletricidade",
      parentName: "Reforma", // parent NOVO
      parentId: "parent-reforma", // id do parent novo
    })
    expect(plan.newSlug).toBe("eletricidade-reforma") // slug embute o parent NOVO
    expect(plan.created.slug).toBe("eletricidade-reforma")
    expect(plan.created.parentId).toBe("parent-reforma") // NÃO o parentId antigo
    expect(plan.created.name).toBe("Eletricidade")
    expect(plan.created.level).toBe(1) // level preservado
  })

  it("--move-to sem rename (nome preservado): slug muda só pelo parent novo", () => {
    const plan = buildMigrationPlan({
      oldCat,
      newName: "Elétrica", // mesmo nome — move-only
      parentName: "Reforma",
      parentId: "parent-reforma",
    })
    expect(plan.newSlug).toBe("eletrica-reforma") // slug muda (parent novo embutido)
    expect(plan.created.name).toBe("Elétrica")
    expect(plan.created.parentId).toBe("parent-reforma")
  })

  it("--move-to: filhos re-apontados mantêm o NOME do pai no slug (move-only não muda slug deles)", () => {
    // Move-only: o nome do pai NÃO muda, então os filhos mantêm o slug atual
    // (embutem o NOME do pai, não o slug do pai). O guard de colisão precisa
    // excluir os próprios filhos — senão acusaria colisão falsa.
    const plan = buildMigrationPlan({
      oldCat,
      newName: "Elétrica", // mesmo nome — move-only
      parentName: "Reforma",
      parentId: "parent-reforma",
      children: [
        {
          id: "child-1",
          name: "Tomadas e interruptores",
          slug: "tomadas-e-interruptores-eletrica",
        },
      ],
      serviceCount: 2,
    })
    expect(plan.children[0].newSlug).toBe("tomadas-e-interruptores-eletrica") // inalterado
    expect(plan.serviceCount).toBe(2)
  })
})
