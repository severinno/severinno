/**
 * seed-data.ts
 *
 * Dados compartilhados entre os scripts de seed:
 *   - prisma/seed.ts      → seed completo de desenvolvimento (com usuários demo)
 *   - prisma/seed-prod.ts → seed de PRODUÇÃO (apenas categorias + settings)
 *
 * Manter como ÚNICA fonte de verdade para a árvore de categorias e os
 * settings padrão — evita divergência entre os dois scripts.
 */

// ---------------------------------------------------------------------------
// slugify — slug de categoria (mesma regra usada historicamente no seed)
// ---------------------------------------------------------------------------
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

// ---------------------------------------------------------------------------
// Categorias — árvore de 3 níveis (pai → filha → subcategoria)
// ---------------------------------------------------------------------------
export type CategorySeedInput = {
  name: string
  parent?: string
  level: number
  icon?: string
}

export const CATEGORY_SPEC: CategorySeedInput[] = [
  // pais (level 0)
  { name: "Reparos", level: 0, icon: "wrench" },
  { name: "Limpeza", level: 0, icon: "sparkles" },
  { name: "Reforma", level: 0, icon: "hammer" },
  // filhas (level 1)
  { name: "Elétrica", parent: "Reparos", level: 1, icon: "zap" },
  { name: "Hidráulica", parent: "Reparos", level: 1, icon: "droplet" },
  { name: "Pintura", parent: "Reparos", level: 1, icon: "brush" },
  { name: "Residencial", parent: "Limpeza", level: 1, icon: "home" },
  { name: "Pós-Obra", parent: "Limpeza", level: 1, icon: "broom" },
  { name: "Pisos", parent: "Reforma", level: 1, icon: "square" },
  { name: "Alvenaria", parent: "Reforma", level: 1, icon: "brick" },
  // subcategorias (level 2)
  { name: "Tomadas e interruptores", parent: "Elétrica", level: 2 },
  { name: "Curto-circuito", parent: "Elétrica", level: 2 },
  { name: "Quadro elétrico", parent: "Elétrica", level: 2 },
  { name: "Desentupimento", parent: "Hidráulica", level: 2 },
  { name: "Vazamento", parent: "Hidráulica", level: 2 },
  { name: "Caixa de descarga", parent: "Hidráulica", level: 2 },
  { name: "Pintura interna", parent: "Pintura", level: 2 },
  { name: "Pintura externa", parent: "Pintura", level: 2 },
  { name: "Textura e grafiato", parent: "Pintura", level: 2 },
  { name: "Limpeza geral", parent: "Residencial", level: 2 },
  { name: "Organização", parent: "Residencial", level: 2 },
  { name: "Limpeza pós-obra", parent: "Pós-Obra", level: 2 },
  { name: "Assentamento de piso", parent: "Pisos", level: 2 },
  { name: "Rejunte", parent: "Pisos", level: 2 },
  { name: "Pequenas reformas", parent: "Alvenaria", level: 2 },
  { name: "Contrapiso", parent: "Alvenaria", level: 2 },
  { name: "Poda de árvores", parent: "Alvenaria", level: 2 }, // for jardineiro fallback
]

/**
 * Slug canônico de uma categoria: filhos herdam o slug do pai
 * (ex.: "Tomadas e interruptores" sob "Elétrica" → "tomadas-e-interruptores-eletrica").
 */
export function categorySlug(c: CategorySeedInput): string {
  return slugify(c.name) + (c.parent ? "-" + slugify(c.parent) : "")
}

/** Ordem de exibição no level 0 (pais) — 0 por padrão. */
export function categoryOrder(c: CategorySeedInput): number {
  return c.level === 0 ? ["Reparos", "Limpeza", "Reforma"].indexOf(c.name) : 0
}

// ---------------------------------------------------------------------------
// Settings padrão (admin dynamic config)
// ---------------------------------------------------------------------------
export type SettingSeedInput = { key: string; value: string }

export const DEFAULT_SETTINGS: SettingSeedInput[] = [
  { key: "site_name", value: "Severinno" },
  { key: "site_tagline", value: "Marketplace de serviços com geolocalização" },
  { key: "support_email", value: "suporte@severinno.com" },
  { key: "payment_pix_key", value: "suporte@severinno.com" },
  { key: "nominatim_enabled", value: "true" },
  { key: "viacep_enabled", value: "true" },
  { key: "default_search_radius_km", value: "15" },
  { key: "platform_fee_percent", value: "10" },
  { key: "quote_default_expiry_hours", value: "72" },
]

// ---------------------------------------------------------------------------
// Dry-run plan — o que o seed-prod FARIAM, sem escrever no banco
// ---------------------------------------------------------------------------
// Usado pelo modo --dry-run / DRY_RUN=1 do prisma/seed-prod.ts para revisar
// o plano de escrita ANTES de tocar o banco produtivo. Função PURA (sem
// banco): recebe o estado atual e devolve o plano create/update/unchanged.

export type CurrentCategoryRow = {
  slug: string
  name: string
  level: number
  parentName: string | null
  icon: string | null
  order: number
  active: boolean
}

export type CurrentSettingRow = {
  key: string
  value: string
}

export type CategoryPlanAction =
  | {
      action: "create"
      slug: string
      name: string
      level: number
      parent: string | null
      icon: string | null
      order: number
    }
  | {
      action: "update"
      slug: string
      name: string
      level: number
      parent: string | null
      icon: string | null
      order: number
      changes: string[]
    }
  | { action: "unchanged"; slug: string; name: string }

export type SettingPlanAction =
  | { action: "create"; key: string; value: string }
  | { action: "update"; key: string; value: string; changes: string[] }
  | { action: "unchanged"; key: string; value: string }

export type SeedPlan = {
  categories: CategoryPlanAction[]
  settings: SettingPlanAction[]
  summary: {
    categoriesCreate: number
    categoriesUpdate: number
    categoriesUnchanged: number
    settingsCreate: number
    settingsUpdate: number
    settingsUnchanged: number
  }
}

/**
 * Calcula o plano de escrita do seed-prod sem tocar no banco.
 *
 * Espelha EXATAMENTE a semântica do upsert do prisma/seed-prod.ts:
 *   - categorias: upsert por slug; comparam name/level/icon/order/parent
 *     (o flag `active` NÃO é comparado nem forçado no update — reconcile
 *     seguro preserva desativações manuais do admin)
 *   - settings: upsert por key; compara value
 */
export function buildSeedPlan(
  currentCategories: CurrentCategoryRow[],
  currentSettings: CurrentSettingRow[],
): SeedPlan {
  const catBySlug = new Map(currentCategories.map((c) => [c.slug, c]))
  const setByKey = new Map(currentSettings.map((s) => [s.key, s]))

  const categories: CategoryPlanAction[] = []
  const sorted = [...CATEGORY_SPEC].sort((a, b) => a.level - b.level)

  for (const c of sorted) {
    const slug = categorySlug(c)
    const icon = c.icon ?? null
    const order = categoryOrder(c)
    const parent = c.parent ?? null
    const existing = catBySlug.get(slug)

    if (!existing) {
      categories.push({ action: "create", slug, name: c.name, level: c.level, parent, icon, order })
      continue
    }

    const changes: string[] = []
    if (existing.name !== c.name) changes.push("name")
    if (existing.level !== c.level) changes.push("level")
    if ((existing.parentName ?? null) !== parent) changes.push("parent")
    if ((existing.icon ?? null) !== icon) changes.push("icon")
    if (existing.order !== order) changes.push("order")

    if (changes.length === 0) {
      categories.push({ action: "unchanged", slug, name: c.name })
    } else {
      categories.push({
        action: "update",
        slug,
        name: c.name,
        level: c.level,
        parent,
        icon,
        order,
        changes,
      })
    }
  }

  const settings: SettingPlanAction[] = []
  for (const s of DEFAULT_SETTINGS) {
    const existing = setByKey.get(s.key)
    if (!existing) {
      settings.push({ action: "create", key: s.key, value: s.value })
    } else if (existing.value === s.value) {
      settings.push({ action: "unchanged", key: s.key, value: s.value })
    } else {
      settings.push({ action: "update", key: s.key, value: s.value, changes: ["value"] })
    }
  }

  return {
    categories,
    settings,
    summary: {
      categoriesCreate: categories.filter((a) => a.action === "create").length,
      categoriesUpdate: categories.filter((a) => a.action === "update").length,
      categoriesUnchanged: categories.filter((a) => a.action === "unchanged").length,
      settingsCreate: settings.filter((a) => a.action === "create").length,
      settingsUpdate: settings.filter((a) => a.action === "update").length,
      settingsUnchanged: settings.filter((a) => a.action === "unchanged").length,
    },
  }
}
