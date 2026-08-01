/**
 * scripts/seed-e2e-utils.ts
 *
 * Helpers compartilhados entre os E2Es dos seeds — elimina o espelhamento
 * verbatim dos cenários de SEED_SPEC_PATCH (UPDATE/RENAME mid-cycle):
 *   - scripts/test-seed-prod-e2e.ts  (cenários 7 e 8)
 *   - scripts/test-seed-dev-e2e.ts   (cenários 9 e 10)
 *
 * Centraliza:
 *   - UPDATE_PATCHES / RENAME_PATCHES + os JSONs derivados (UPDATE_PATCH /
 *     RENAME_PATCH) — o patch enviado ao seed e o spec usado no plano
 *     derivam do MESMO array (sem risco de drift entre os dois)
 *   - patchedUpdateSpec / patchedRenameSpec — via buildPatchedSpec do
 *     seed-data (a MESMA função que os seeds usam — sem o .map manual)
 *   - Slugs canônicos (ELETRICA_SLUG, REPAROS_SLUG, ELETRICIDADE_SLUG) e
 *     o contexto do rename (FILHOS_ELETRICA, TOTAL_RENAME, renamedChildSlug)
 *   - buildPatchedUpdatePlan — estado atual do banco → buildSeedPlan com o
 *     spec patchado (extrai o fetch + mapeamento duplicado)
 *   - assertPatchedUpdatePlan — as 3 asserções do plano (0 create, icon,
 *     order) — mesmas mensagens dos E2Es originais
 *
 * Usage:
 *   Este módulo NÃO é um script executável — é um helper importado pelos
 *   E2Es (test-seed-dev-e2e.ts / test-seed-prod-e2e.ts). Entry points:
 *   bash scripts/test-seed-dev-e2e.sh
 *   bash scripts/test-seed-prod-e2e.sh
 *
 * Exit codes:
 *   N/A — sem exit code próprio; as asserções usam o TreeReporter injetado
 *   (ok/bad/expect) e os E2Es decidem o exit final (0 — passou, 1 — falhou).
 */

import type { PrismaClient } from "@prisma/client"
import {
  CATEGORY_SPEC,
  buildPatchedSpec,
  buildSeedPlan,
  categorySlug,
  type CategorySeedInput,
  type SeedPlan,
  type SpecPatchInput,
} from "../prisma/seed-data"
import type { TreeReporter } from "./seed-e2e-common"

// ---------------------------------------------------------------------------
// Patches — fonte ÚNICA para o JSON enviado ao seed E para o spec do plano
// ---------------------------------------------------------------------------

/** Patch de UPDATE (icon/order) — usado nos cenários 7 (prod) e 9 (dev). */
export const UPDATE_PATCHES: SpecPatchInput[] = [
  { name: "Elétrica", icon: "bolt" },
  { name: "Reparos", order: 5 },
]

/** JSON enviado ao seed via SEED_SPEC_PATCH para o cenário de update. */
export const UPDATE_PATCH = JSON.stringify(UPDATE_PATCHES)

/** Patch de RENAME (renameTo) — usado nos cenários 8 (prod) e 10 (dev). */
export const RENAME_PATCHES: SpecPatchInput[] = [{ name: "Elétrica", renameTo: "Eletricidade" }]

/** JSON enviado ao seed via SEED_SPEC_PATCH para o cenário de rename. */
export const RENAME_PATCH = JSON.stringify(RENAME_PATCHES)

// ---------------------------------------------------------------------------
// Slugs canônicos — derivados do spec (nunca hardcoded)
// ---------------------------------------------------------------------------

/** Slug de 'Elétrica' sob 'Reparos' (antes do rename). */
export const ELETRICA_SLUG = categorySlug({ name: "Elétrica", parent: "Reparos", level: 1 })

/** Slug de 'Reparos' (level 0). */
export const REPAROS_SLUG = categorySlug({ name: "Reparos", level: 0 })

/** Slug de 'Eletricidade' sob 'Reparos' (depois do rename). */
export const ELETRICIDADE_SLUG = categorySlug({
  name: "Eletricidade",
  parent: "Reparos",
  level: 1,
})

/** Filhos de 'Elétrica' no spec — base da cascata de rename. */
export const FILHOS_ELETRICA: CategorySeedInput[] = CATEGORY_SPEC.filter(
  (c) => c.parent === "Elétrica",
)

/** Total de linhas novas no rename: pai renomeado + filhos (cascata 1 nível). */
export const TOTAL_RENAME = 1 + FILHOS_ELETRICA.length

/**
 * Slug canônico de um filho APÓS o rename do pai — o slug do filho embute o
 * slug do pai ('Eletricidade' em vez de 'Elétrica'). Equivale a:
 *   categorySlug({ ...filho, parent: "Eletricidade" })
 */
export function renamedChildSlug(child: CategorySeedInput): string {
  return categorySlug({ ...child, parent: "Eletricidade" })
}

// ---------------------------------------------------------------------------
// UPDATE — plano + asserções (cenário 7 prod / 9 dev)
// ---------------------------------------------------------------------------

/**
 * Carrega o estado atual do banco e monta o buildSeedPlan com o spec
 * PATCHADO (via buildPatchedSpec do seed-data — mesma fonte do seed).
 *
 * Retorna o plano + os slugs canônicos usados nas asserções de update
 * (e reusados no re-run canônico de restauração).
 */
export async function buildPatchedUpdatePlan(db: PrismaClient): Promise<{
  plan: SeedPlan
  eletricaSlug: string
  reparosSlug: string
}> {
  const currentCats = await db.category.findMany({
    include: { parent: { select: { name: true } } },
  })
  const currentSettings = await db.setting.findMany()

  const plan = buildSeedPlan(
    currentCats.map((c) => ({
      slug: c.slug,
      name: c.name,
      level: c.level,
      parentName: c.parent?.name ?? null,
      icon: c.icon,
      order: c.order,
      active: c.active,
    })),
    currentSettings.map((s) => ({ key: s.key, value: s.value })),
    buildPatchedSpec(UPDATE_PATCH, true),
  )

  return { plan, eletricaSlug: ELETRICA_SLUG, reparosSlug: REPAROS_SLUG }
}

/**
 * As 3 asserções do plano patchado (0 create + update de icon na 'Elétrica'
 * + update de order na 'Reparos') — mesmas mensagens dos E2Es originais.
 */
export function assertPatchedUpdatePlan(
  rep: TreeReporter,
  plan: SeedPlan,
  eletricaSlug: string,
  reparosSlug: string,
): void {
  rep.expect(
    plan.summary.categoriesCreate === 0,
    `plano patchado não cria linhas (0 create — obtido ${plan.summary.categoriesCreate})`,
  )
  const elétricaPlan = plan.categories.find((a) => a.slug === eletricaSlug)
  rep.expect(
    elétricaPlan?.action === "update" && elétricaPlan.changes.includes("icon"),
    "plano detecta update de icon na 'Elétrica'",
  )
  const reparosPlan = plan.categories.find((a) => a.slug === reparosSlug)
  rep.expect(
    reparosPlan?.action === "update" && reparosPlan.changes.includes("order"),
    "plano detecta update de order na 'Reparos'",
  )
}

// ---------------------------------------------------------------------------
// RENAME — contexto (cenário 8 prod / 10 dev)
// ---------------------------------------------------------------------------

/**
 * Nº de asserções FIXAS de assertPatchedUpdatePlan (3 rep.expect) — usado
 * pela derivação de counts (scripts/seed-e2e-count.ts): a derivação soma os
 * sites do E2E + loops + validateTree + validateUsers + este PLAN_ASSERT_COUNT.
 */
export const PLAN_ASSERT_COUNT = 3

/**
 * Contexto completo do rename de 'Elétrica' → 'Eletricidade':
 *   - oldSlug: slug da linha antiga (preservada pelo seed-prod)
 *   - newSlug: slug da linha nova criada em cascata
 *   - filhos: filhos de 'Elétrica' no spec (base da cascata)
 *   - totalRename: 1 (pai) + filhos.length
 */
export function deriveRenameContext(): {
  oldSlug: string
  newSlug: string
  filhos: CategorySeedInput[]
  totalRename: number
} {
  return {
    oldSlug: ELETRICA_SLUG,
    newSlug: ELETRICIDADE_SLUG,
    filhos: FILHOS_ELETRICA,
    totalRename: TOTAL_RENAME,
  }
}

// Re-export para quem precisar do spec patchado em memória (testes unitários)
export function patchedUpdateSpec(): CategorySeedInput[] {
  return buildPatchedSpec(UPDATE_PATCH, true)
}

export function patchedRenameSpec(): CategorySeedInput[] {
  return buildPatchedSpec(RENAME_PATCH, true)
}
