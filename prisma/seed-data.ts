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
  description?: string
  /** Ordem de exibição explícita (opcional) — sobrescreve o default do level 0. */
  order?: number
}

export const CATEGORY_ROOTS = [
  "Reforma e Construção",
  "Reparos e Instalações",
  "Acabamento e Decoração",
  "Limpeza e Casa",
  "Jardim e Piscina",
  "Mudança e Organização",
  "Emergência 24h",
] as const

export const CATEGORY_SPEC: CategorySeedInput[] = [
  // ── 1. 🏗️ Reforma e Construção ──────────────────────────────────────────
  {
    name: "Reforma e Construção",
    level: 0,
    icon: "hard-hat",
    description: "Do projeto à obra pronta",
    order: 0,
  },
  {
    name: "Projetos e Regularização",
    parent: "Reforma e Construção",
    level: 1,
    icon: "ruler",
    description: "Projetos arquitetônicos, estruturais e laudos técnicos",
  },
  { name: "Arquiteto e Projetos", parent: "Projetos e Regularização", level: 2 },
  { name: "Design de Interiores", parent: "Projetos e Regularização", level: 2 },
  { name: "Projeto de Iluminação", parent: "Projetos e Regularização", level: 2 },
  { name: "Projeto Estrutural", parent: "Projetos e Regularização", level: 2 },
  { name: "Laudos e Perícias", parent: "Projetos e Regularização", level: 2 },
  { name: "ART e RRT", parent: "Projetos e Regularização", level: 2 },
  { name: "Legalização de Obra", parent: "Projetos e Regularização", level: 2 },
  { name: "Vistoria de Imóvel Novo", parent: "Projetos e Regularização", level: 2 },
  { name: "Fiscalização de Obra", parent: "Projetos e Regularização", level: 2 },
  {
    name: "Obra",
    parent: "Reforma e Construção",
    level: 1,
    icon: "brick",
    description: "Estruturas, fundações, alvenaria e demolição",
  },
  { name: "Fundações", parent: "Obra", level: 2 },
  { name: "Lajes e Estruturas", parent: "Obra", level: 2 },
  { name: "Mezaninos Metálicos", parent: "Obra", level: 2 },
  { name: "Alvenaria", parent: "Obra", level: 2 },
  { name: "Reboco", parent: "Obra", level: 2 },
  { name: "Demolição", parent: "Obra", level: 2 },
  { name: "Remoção de Entulho", parent: "Obra", level: 2 },

  // ── 2. 🔧 Reparos e Instalações ─────────────────────────────────────────
  {
    name: "Reparos e Instalações",
    level: 0,
    icon: "wrench",
    description: "Consertos rápidos e instalações",
    order: 1,
  },
  {
    name: "Elétrica",
    parent: "Reparos e Instalações",
    level: 1,
    icon: "zap",
    description: "Instalações elétricas, quadros e energia",
  },
  { name: "Eletricista", parent: "Elétrica", level: 2 },
  { name: "Quadro de Energia", parent: "Elétrica", level: 2 },
  { name: "Aumento de Carga", parent: "Elétrica", level: 2 },
  { name: "Para-raios e Aterramento", parent: "Elétrica", level: 2 },
  { name: "Carregador para Carro Elétrico", parent: "Elétrica", level: 2 },
  { name: "Energia Solar", parent: "Elétrica", level: 2 },
  { name: "Gerador e Nobreak", parent: "Elétrica", level: 2 },
  {
    name: "Hidráulica",
    parent: "Reparos e Instalações",
    level: 1,
    icon: "droplet",
    description: "Encanamento, desentupimento e caça-vazamentos",
  },
  { name: "Encanador", parent: "Hidráulica", level: 2 },
  { name: "Detecção de Vazamentos", parent: "Hidráulica", level: 2 },
  { name: "Desentupimento", parent: "Hidráulica", level: 2 },
  { name: "Louças e Metais", parent: "Hidráulica", level: 2 },
  { name: "Bombas d'Água", parent: "Hidráulica", level: 2 },
  { name: "Prumadas", parent: "Hidráulica", level: 2 },
  {
    name: "Clima e Gás",
    parent: "Reparos e Instalações",
    level: 1,
    icon: "fan",
    description: "Ar-condicionado, ventilação e aquecedores a gás",
  },
  { name: "Instalação de Ar-Condicionado", parent: "Clima e Gás", level: 2 },
  { name: "Manutenção de Ar-Condicionado", parent: "Clima e Gás", level: 2 },
  { name: "Higienização de Ar-Condicionado", parent: "Clima e Gás", level: 2 },
  { name: "Rede de Gás", parent: "Clima e Gás", level: 2 },
  { name: "Aquecedor", parent: "Clima e Gás", level: 2 },
  { name: "Conversão de Fogão", parent: "Clima e Gás", level: 2 },
  { name: "Exaustores e Ventiladores", parent: "Clima e Gás", level: 2 },
  {
    name: "Tecnologia e Acesso",
    parent: "Reparos e Instalações",
    level: 1,
    icon: "shield",
    description: "Câmeras, alarmes, redes Wi-Fi e fechaduras digitais",
  },
  { name: "Wi-Fi e Redes", parent: "Tecnologia e Acesso", level: 2 },
  { name: "Câmeras e Alarmes", parent: "Tecnologia e Acesso", level: 2 },
  { name: "Cerca Elétrica", parent: "Tecnologia e Acesso", level: 2 },
  { name: "Fechadura Digital", parent: "Tecnologia e Acesso", level: 2 },
  { name: "Interfone", parent: "Tecnologia e Acesso", level: 2 },
  { name: "Portão Automático", parent: "Tecnologia e Acesso", level: 2 },
  { name: "Portaria Remota", parent: "Tecnologia e Acesso", level: 2 },
  { name: "Suporte de TI", parent: "Tecnologia e Acesso", level: 2 },
  {
    name: "Pequenos Reparos",
    parent: "Reparos e Instalações",
    level: 1,
    icon: "tool",
    description: "Marido de aluguel, montagem de móveis e fixações",
  },
  { name: "Marido de Aluguel", parent: "Pequenos Reparos", level: 2 },
  { name: "Montagem de Móveis", parent: "Pequenos Reparos", level: 2 },
  { name: "Fixar TV e Prateleiras", parent: "Pequenos Reparos", level: 2 },
  { name: "Acessórios e Vedação", parent: "Pequenos Reparos", level: 2 },

  // ── 3. 🎨 Acabamento e Decoração ────────────────────────────────────────
  {
    name: "Acabamento e Decoração",
    level: 0,
    icon: "paint-roller",
    description: "Deixe sua casa como nova",
    order: 2,
  },
  {
    name: "Pintura",
    parent: "Acabamento e Decoração",
    level: 1,
    icon: "brush",
    description: "Pintura residencial, predial e texturas",
  },
  { name: "Pintura Residencial", parent: "Pintura", level: 2 },
  { name: "Pintura Predial", parent: "Pintura", level: 2 },
  { name: "Textura e Efeitos", parent: "Pintura", level: 2 },
  {
    name: "Pisos",
    parent: "Acabamento e Decoração",
    level: 1,
    icon: "square",
    description: "Porcelanatos, laminados, vinílicos e decks",
  },
  { name: "Porcelanato e Cerâmica", parent: "Pisos", level: 2 },
  { name: "Piso Vinílico e Laminado", parent: "Pisos", level: 2 },
  { name: "Piso de Madeira", parent: "Pisos", level: 2 },
  { name: "Deck", parent: "Pisos", level: 2 },
  { name: "Epóxi e Cimento Queimado", parent: "Pisos", level: 2 },
  { name: "Mármores e Granitos", parent: "Pisos", level: 2 },
  {
    name: "Forro e Divisórias",
    parent: "Acabamento e Decoração",
    level: 1,
    icon: "box",
    description: "Gesso, sancas, drywall e acústica",
  },
  { name: "Gesso e Sancas", parent: "Forro e Divisórias", level: 2 },
  { name: "Drywall", parent: "Forro e Divisórias", level: 2 },
  { name: "Isolamento Acústico", parent: "Forro e Divisórias", level: 2 },
  {
    name: "Marcenaria e Vidro",
    parent: "Acabamento e Decoração",
    level: 1,
    icon: "door-closed",
    description: "Móveis planejados, box, espelhos e esquadrias",
  },
  { name: "Móveis Planejados", parent: "Marcenaria e Vidro", level: 2 },
  { name: "Restauração de Móveis", parent: "Marcenaria e Vidro", level: 2 },
  { name: "Box e Espelhos", parent: "Marcenaria e Vidro", level: 2 },
  { name: "Vidro de Sacada", parent: "Marcenaria e Vidro", level: 2 },
  { name: "Esquadrias de Vidro", parent: "Marcenaria e Vidro", level: 2 },
  { name: "Reparo de Vidro", parent: "Marcenaria e Vidro", level: 2 },
  {
    name: "Estofados e Têxteis",
    parent: "Acabamento e Decoração",
    level: 1,
    icon: "sofa",
    description: "Limpeza, impermeabilização, reforma e cortinas",
  },
  { name: "Limpeza de Estofados", parent: "Estofados e Têxteis", level: 2 },
  { name: "Reforma de Estofados", parent: "Estofados e Têxteis", level: 2 },
  { name: "Impermeabilização", parent: "Estofados e Têxteis", level: 2 },
  { name: "Limpeza de Tapetes e Cortinas", parent: "Estofados e Têxteis", level: 2 },
  { name: "Cortinas e Persianas", parent: "Estofados e Têxteis", level: 2 },

  // ── 4. 🧼 Limpeza e Casa (Itens diretos level 1) ─────────────────────────
  {
    name: "Limpeza e Casa",
    level: 0,
    icon: "sparkles",
    description: "Casa limpa e protegida",
    order: 3,
  },
  { name: "Diarista e Faxina", parent: "Limpeza e Casa", level: 1 },
  { name: "Faxina Pós-Obra", parent: "Limpeza e Casa", level: 1 },
  { name: "Vidros e Fachadas", parent: "Limpeza e Casa", level: 1 },
  { name: "Lavanderia e Passadoria", parent: "Limpeza e Casa", level: 1 },
  { name: "Personal Chef", parent: "Limpeza e Casa", level: 1 },
  { name: "Dedetização", parent: "Limpeza e Casa", level: 1 },
  { name: "Cupim", parent: "Limpeza e Casa", level: 1 },
  { name: "Roedores", parent: "Limpeza e Casa", level: 1 },
  { name: "Pombos e Morcegos", parent: "Limpeza e Casa", level: 1 },
  { name: "Captura de Enxames", parent: "Limpeza e Casa", level: 1 },
  { name: "Sanitização", parent: "Limpeza e Casa", level: 1 },

  // ── 5. 🌿 Jardim e Piscina ──────────────────────────────────────────────
  {
    name: "Jardim e Piscina",
    level: 0,
    icon: "trees",
    description: "Sua área externa dos sonhos",
    order: 4,
  },
  {
    name: "Jardim",
    parent: "Jardim e Piscina",
    level: 1,
    icon: "leaf",
    description: "Jardinagem, paisagismo, podas e irrigação",
  },
  { name: "Jardineiro", parent: "Jardim", level: 2 },
  { name: "Poda de Árvores", parent: "Jardim", level: 2 },
  { name: "Paisagismo", parent: "Jardim", level: 2 },
  { name: "Jardim Vertical", parent: "Jardim", level: 2 },
  { name: "Tratamento de Jardins", parent: "Jardim", level: 2 },
  { name: "Irrigação", parent: "Jardim", level: 2 },
  { name: "Lago e Fonte", parent: "Jardim", level: 2 },
  {
    name: "Piscina e Lazer",
    parent: "Jardim e Piscina",
    level: 1,
    icon: "waves",
    description: "Piscina, ofurô, churrasqueira e lazer externo",
  },
  { name: "Limpeza de Piscina", parent: "Piscina e Lazer", level: 2 },
  { name: "Manutenção de Piscina", parent: "Piscina e Lazer", level: 2 },
  { name: "Aquecimento de Piscina", parent: "Piscina e Lazer", level: 2 },
  { name: "Spa e Ofurô", parent: "Piscina e Lazer", level: 2 },
  { name: "Churrasqueira", parent: "Piscina e Lazer", level: 2 },
  { name: "Forno de Pizza", parent: "Piscina e Lazer", level: 2 },
  { name: "Lareira", parent: "Piscina e Lazer", level: 2 },
  { name: "Limpeza de Coifas", parent: "Piscina e Lazer", level: 2 },

  // ── 6. 📦 Mudança e Organização (Itens diretos level 1) ─────────────────
  {
    name: "Mudança e Organização",
    level: 0,
    icon: "truck",
    description: "Mude sem estresse",
    order: 5,
  },
  { name: "Frete e Mudança", parent: "Mudança e Organização", level: 1 },
  { name: "Içamento de Móveis", parent: "Mudança e Organização", level: 1 },
  { name: "Personal Organizer", parent: "Mudança e Organização", level: 1 },
  { name: "Descarte Ecológico", parent: "Mudança e Organização", level: 1 },
  { name: "Aluguel de Equipamentos", parent: "Mudança e Organização", level: 1 },

  // ── 7. 🚨 Emergência 24h (Card fixo de atendimento imediato) ────────────
  {
    name: "Emergência 24h",
    level: 0,
    icon: "siren",
    description: "Atendimento imediato",
    order: 6,
  },
  { name: "Eletricista 24h", parent: "Emergência 24h", level: 1 },
  { name: "Encanador 24h", parent: "Emergência 24h", level: 1 },
  { name: "Desentupimento 24h", parent: "Emergência 24h", level: 1 },
  { name: "Chaveiro 24h", parent: "Emergência 24h", level: 1 },
  { name: "Extintores e Hidrantes", parent: "Emergência 24h", level: 1 },
  { name: "Luz de Emergência", parent: "Emergência 24h", level: 1 },
]

/**
 * Slug canônico de uma categoria: filhos herdam o slug do pai
 * (ex.: "Tomadas e interruptores" sob "Elétrica" → "tomadas-e-interruptores-eletrica").
 */
export function categorySlug(c: CategorySeedInput): string {
  return slugify(c.name) + (c.parent ? "-" + slugify(c.parent) : "")
}

/**
 * Ordem de exibição de uma categoria — 0 por padrão.
 * Um `order` explícito no spec sobrescreve o default; sem ele,
 * pais seguem a ordem canônica dos 7 macro-domínios e demais níveis ficam em 0.
 */
export function categoryOrder(c: CategorySeedInput): number {
  if (c.order !== undefined) return c.order
  return c.level === 0 ? CATEGORY_ROOTS.indexOf(c.name as (typeof CATEGORY_ROOTS)[number]) : 0
}

// ---------------------------------------------------------------------------
// SEED_SPEC_PATCH — hook de teste para cenários de UPDATE/RENAME (E2E)
// ---------------------------------------------------------------------------
// Função compartilhada entre os DOIS seeds (dev wipe+recreate e prod
// upsert idempotente) — evita divergência no comportamento do hook.
export type SpecPatchInput = {
  name: string
  renameTo?: string
  icon?: string
  order?: number
}

/**
 * Aplica um patch opcional ao CATEGORY_SPEC (env SEED_SPEC_PATCH — hook de
 * teste usado pelos E2Es scripts/test-seed-{prod,dev}-e2e.ts). Suporta:
 *   - icon/order: update in-place (mesmo slug — converge sem duplicar)
 *   - renameTo: muda o NOME → o slug muda (categoria + filhos herdam o slug
 *     do pai) → o upsert CRIA a linha nova e a antiga vira órfã. A cascata
 *     é INTENCIONALMENTE de um nível (árvore fixa de 3 níveis): filhos cujo
 *     `parent` referenciava o nome antigo passam a referenciar o nome novo —
 *     senão o assertValidCategorySpec recusaria o spec patchado.
 * Retorna CATEGORY_SPEC inalterado quando raw é ausente OU enabled é false —
 * em produção o patch é INERTE (os seeds recusam fora do ambiente de
 * teste/override ANTES de qualquer escrita no banco). Função PURA e testável.
 */
export function buildPatchedSpec(raw: string | undefined, enabled: boolean): CategorySeedInput[] {
  if (!raw || !enabled) return CATEGORY_SPEC
  try {
    const patches = JSON.parse(raw) as SpecPatchInput[]
    const byName = new Map(patches.map((p) => [p.name, p]))
    // Renomeação em cascata: nome antigo → nome novo (aplicado ao item e
    // aos filhos cujo `parent` referenciava o nome antigo).
    const renameMap = new Map(
      patches.filter((p) => p.renameTo).map((p) => [p.name, p.renameTo as string]),
    )
    return CATEGORY_SPEC.map((c) => {
      const p = byName.get(c.name)
      const newName = renameMap.get(c.name) ?? c.name
      const newParent = c.parent ? (renameMap.get(c.parent) ?? c.parent) : undefined
      const out: CategorySeedInput = {
        name: newName,
        level: c.level,
        ...(newParent !== undefined ? { parent: newParent } : {}),
        ...(p?.icon !== undefined
          ? { icon: p.icon }
          : c.icon !== undefined
            ? { icon: c.icon }
            : {}),
        ...(p?.order !== undefined ? { order: p.order } : {}),
      }
      return out
    })
  } catch (e) {
    throw new Error(`SEED_SPEC_PATCH inválido (JSON): ${e instanceof Error ? e.message : e}`)
  }
}

// ---------------------------------------------------------------------------
// Settings padrão (admin dynamic config)
// ---------------------------------------------------------------------------
export type SettingSeedInput = { key: string; value: string }

export const DEFAULT_SETTINGS: SettingSeedInput[] = [
  /**
   * Manutenção preventiva ATIVADA por default — o marketplace nasce INACESSÍVEL
   * ao público até que um admin desative explicitamente via painel
   * (POST /api/admin/maintenance-mode { enabled: false }).
   *
   * Segurança fail-closed: nenhum deploy novo expõe o site sem revisão humana.
   */
  { key: "maintenance_mode", value: "true" },
  { key: "site_name", value: "Severinno" },
  { key: "site_tagline", value: "Marketplace de serviços com geolocalização" },
  { key: "support_email", value: "suporte@severinno.com" },
  { key: "payment_pix_key", value: "suporte@severinno.com" },
  { key: "nominatim_enabled", value: "true" },
  { key: "viacep_enabled", value: "true" },
  { key: "default_search_radius_km", value: "15" },
  { key: "quote_default_expiry_hours", value: "72" },
]

// ---------------------------------------------------------------------------
// Usuários demo do seed DEV — emails esperados por role
// ---------------------------------------------------------------------------
// Emails demo usados pelo prisma/seed.ts (seed de desenvolvimento). Vive AQUI
// (fonte pura, sem imports) porque o scripts/seed-e2e-count.ts (derivação dos
// counts de checks dos E2Es) precisa ler a contagem de emails/roles SEM puxar
// o @prisma/client — a derivação roda no CI sem node_modules.
//
// seed-e2e-common.ts re-exporta (validateUsers usa como default param).
export const EXPECTED_EMAILS: Record<string, string[]> = {
  ADMIN: ["admin@severinno.com"],
  CLIENT: ["cliente@severinno.com", "maria@severinno.com"],
  PROVIDER: [
    "carlos@severinno.com",
    "ricardo@severinno.com",
    "lima@severinno.com",
    "fernanda@severinno.com",
    "pedro@severinno.com",
    "antonio@severinno.com",
  ],
}

// ---------------------------------------------------------------------------
// Validação estrutural do spec — proteção contra corrupção da árvore
// ---------------------------------------------------------------------------
// Cenários de produção que estas validações bloqueiam (fail-fast ANTES de
// qualquer escrita no banco):
//
//   1. NOVAS categorias mid-cycle (spec cresce entre deploys): seguro — o
//      upsert por slug simplesmente cria as novas sem tocar nas existentes.
//      Nenhuma proteção necessária além do próprio upsert idempotente.
//
//   2. RENOMEAR uma categoria: PERIGOSO. O slug é derivado do nome (filhos
//      herdam o slug do pai), então renomear muda o slug → o upsert cria uma
//      NOVA linha e a antiga vira órfã (services continuam apontando para a
//      antiga). Não é bloqueável por validação (é uma decisão de migração),
//      mas está documentado no header do seed-prod — renomear exige migração
//      manual de parentId/foreign keys, não re-run do seed.
//
//   3. NOMES duplicados no spec: AMBÍGUO. O seed resolve parent por NOME
//      (catByName) — dois nomes iguais fariam o último vencer silenciosamente
//      e filhos apontariam para o parent errado. → BLOQUEADO aqui.
//
//   4. Parent inexistente (typo no spec): o catByName[c.parent] retornaria
//      undefined → parentId null SILENCIOSO (categoria órfã no level errado).
//      → BLOQUEADO aqui (e reforçado no loop de upsert).
//
//   5. Parent com level >= filho: quebra a árvore 3-níveis. → BLOQUEADO aqui.
//
//   6. level 0 com parent / level > 0 sem parent: inconsistência estrutural
//      (pais só podem ser raiz; filhos só existem sob um pai). → BLOQUEADO.
//
//   7. Slugs duplicados (colisão de slugify, ex.: "Pós-Obra" vs "Pos Obra"):
//      upsert por slug colidiria. → BLOQUEADO aqui.

/**
 * Valida a integridade estrutural do CATEGORY_SPEC (ou qualquer spec).
 * Retorna lista de problemas (vazia = spec válido). Função PURA e testável.
 */
export function validateCategorySpec(spec: CategorySeedInput[] = CATEGORY_SPEC): string[] {
  const issues: string[] = []

  // 1. Nomes únicos — catByName é chaveado por nome EXATO; dois iguais
  //    tornariam a resolução de parent ambígua (último vence, filhos errados).
  const nameCount = new Map<string, number>()
  for (const c of spec) nameCount.set(c.name, (nameCount.get(c.name) ?? 0) + 1)
  for (const [name, n] of nameCount) {
    if (n > 1) {
      issues.push(`nome duplicado '${name}' (${n}x) — resolução de parent por nome ficaria ambígua`)
    }
  }

  // 2. Slugs únicos — upsert por slug; colisão de slugify criaria overwrite.
  const slugCount = new Map<string, number>()
  for (const c of spec) {
    const s = categorySlug(c)
    slugCount.set(s, (slugCount.get(s) ?? 0) + 1)
  }
  for (const [slug, n] of slugCount) {
    if (n > 1) issues.push(`slug duplicado '${slug}' (${n}x) — upsert por slug colidiria`)
  }

  // 3-6. Árvore bem-formada: parent existe, level menor, coerência level↔parent.
  const byName = new Map(spec.map((c) => [c.name, c]))
  for (const c of spec) {
    if (!c.parent) {
      if (c.level !== 0) {
        issues.push(`'${c.name}' é level ${c.level} mas não tem parent (esperado level 0)`)
      }
      continue
    }
    if (c.level === 0) {
      issues.push(`'${c.name}' é level 0 mas tem parent '${c.parent}' (pais não podem ter parent)`)
      continue
    }
    const parent = byName.get(c.parent)
    if (!parent) {
      issues.push(`'${c.name}' referencia parent inexistente '${c.parent}'`)
    } else if (parent.level >= c.level) {
      issues.push(
        `'${c.name}' (level ${c.level}) tem parent '${c.parent}' (level ${parent.level}) — parent deve ter level menor`,
      )
    }
  }

  return issues
}

/** Lança Error se o spec tiver qualquer problema estrutural (fail-fast). */
export function assertValidCategorySpec(spec: CategorySeedInput[] = CATEGORY_SPEC): void {
  const issues = validateCategorySpec(spec)
  if (issues.length > 0) {
    throw new Error(
      "CATEGORY_SPEC inválido — recusando seed para evitar corrupção da árvore:\n  - " +
        issues.join("\n  - "),
    )
  }
}

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
  spec: CategorySeedInput[] = CATEGORY_SPEC,
): SeedPlan {
  const catBySlug = new Map(currentCategories.map((c) => [c.slug, c]))
  const setByKey = new Map(currentSettings.map((s) => [s.key, s]))

  const categories: CategoryPlanAction[] = []
  const sorted = [...spec].sort((a, b) => a.level - b.level)

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

// ---------------------------------------------------------------------------
// Dry-run plan — exibição legível (printPlan)
// ---------------------------------------------------------------------------
// Função PURA (console.log + dados do spec) — sem banco. Movida do
// seed-prod.ts para cá para ser testável em isolamento (o seed-prod executa
// main() no import, impossível importar em teste). Consome o retorno de
// buildSeedPlan; o aviso de renomeação detecta categorias cujo NOME casa com
// o spec mas cujo SLUG difere do canônico (nome embute o slug do pai).

/** Exibe o plano de dry-run em formato legível para revisão. */
export function printPlan(
  plan: ReturnType<typeof buildSeedPlan>,
  current: { categories: CurrentCategoryRow[]; settings: CurrentSettingRow[] },
  spec: CategorySeedInput[] = CATEGORY_SPEC,
): void {
  console.log("")
  console.log("🧾 DRY-RUN — nenhuma escrita será feita no banco")
  console.log("")

  console.log(`📂 CATEGORIAS (${spec.length} no spec)`)
  for (const a of plan.categories) {
    if (a.action === "create") {
      console.log(
        `   ➕ criar    ${a.slug.padEnd(38)} ${a.name.padEnd(26)} level ${a.level} parent=${a.parent ?? "—"} icon=${a.icon ?? "—"} order=${a.order}`,
      )
    } else if (a.action === "update") {
      console.log(
        `   🔄 atualizar ${a.slug.padEnd(36)} ${a.name.padEnd(26)} mudanças: ${a.changes.join(", ")}`,
      )
    } else {
      console.log(`   ⏹ inalterada ${a.slug.padEnd(35)} ${a.name}`)
    }
  }

  console.log("")
  console.log(`⚙️  SETTINGS (${DEFAULT_SETTINGS.length} no spec)`)
  for (const a of plan.settings) {
    if (a.action === "create") {
      console.log(`   ➕ criar    ${a.key.padEnd(30)} = ${a.value}`)
    } else if (a.action === "update") {
      console.log(
        `   🔄 atualizar ${a.key.padEnd(28)} = ${a.value} (mudanças: ${a.changes.join(", ")})`,
      )
    } else {
      console.log(`   ⏹ inalterado ${a.key.padEnd(27)} = ${a.value}`)
    }
  }

  const s = plan.summary
  console.log("")
  console.log("📊 RESUMO")
  console.log(
    `   Categorias: ${s.categoriesCreate} criar, ${s.categoriesUpdate} atualizar, ${s.categoriesUnchanged} inalteradas (total ${spec.length})`,
  )
  console.log(
    `   Settings:   ${s.settingsCreate} criar, ${s.settingsUpdate} atualizar, ${s.settingsUnchanged} inalterados (total ${DEFAULT_SETTINGS.length})`,
  )

  const inactive = current.categories.filter((c) => !c.active)
  if (inactive.length > 0) {
    console.log("")
    console.log(
      `   ℹ️  ${inactive.length} categoria(s) inativa(s) no banco: ${inactive.map((c) => c.name).join(", ")}`,
    )
    console.log("      O seed NÃO as reativa (reconcile seguro preserva a desativação do admin).")
  }

  // ── Renomeações em andamento (nome bate com o spec, slug difere) ──────
  // Cenário PERIGOSO documentado no header: o slug é derivado do nome, então
  // renomear uma categoria (ou o parent dela) muda o slug → o upsert cria uma
  // NOVA linha e a antiga vira órfã, com services ainda apontando para ela.
  // Aqui detectamos a renomeação na HORA da revisão: uma categoria no banco
  // cujo nome casa com o spec mas cujo slug não é o canônico do spec.
  // ⚠️ LIMITAÇÃO: a detecção dispara via FILHOS — o nome deles continua no
  // spec, mas o slug muda porque embute o slug do pai. Um pai renomeado SEM
  // filhos é indistinguível de uma categoria removida do spec (sem o spec
  // anterior não há como saber) — ele só aparece na seção 'Fora do spec'.
  const specByName = new Map(spec.map((c) => [c.name, c]))
  // Filhos por nome de parent — para detectar pais renomeados que ficaram
  // órfãos com filhos ainda apontando para eles no banco.
  const childrenByParent = new Map<string, number>()
  for (const c of current.categories) {
    if (c.parentName) {
      childrenByParent.set(c.parentName, (childrenByParent.get(c.parentName) ?? 0) + 1)
    }
  }
  const renameSlugs = new Set<string>()
  const renames: { dbSlug: string; specSlug: string; name: string }[] = []
  for (const c of current.categories) {
    const specEntry = specByName.get(c.name)
    if (!specEntry) continue // nome nem existe no spec — tratado em 'Fora do spec'
    const canonical = categorySlug(specEntry)
    if (c.slug !== canonical) {
      renames.push({ dbSlug: c.slug, specSlug: canonical, name: c.name })
      renameSlugs.add(c.slug)
    }
  }
  if (renames.length > 0) {
    console.log("")
    console.log("   ⚠️  POSSÍVEL RENOMEAÇÃO DETECTADA — atenção antes de rodar:")
    for (const r of renames) {
      const kids = childrenByParent.get(r.name) ?? 0
      console.log(
        `      • '${r.name}': banco tem slug '${r.dbSlug}', o spec quer '${r.specSlug}'` +
          (kids > 0 ? ` — ${kids} filho(s) no banco ainda aponta(m) para a linha antiga` : ""),
      )
    }
    console.log(
      "      O upsert CRIARÁ a linha nova e DEIXARÁ a antiga órfã — services" +
        " continuam apontando para a antiga. Renomear exige migração manual" +
        " de parentId/FKs, NUNCA re-run do seed.",
    )
  }

  // Entradas extras no banco (fora do spec) — o seed NÃO as toca; só avisa.
  // Linhas já listadas como renomeação ficam de fora para não duplicar.
  const specCatSlugs = new Set(spec.map((c) => categorySlug(c)))
  const extraCats = current.categories.filter(
    (c) => !specCatSlugs.has(c.slug) && !renameSlugs.has(c.slug),
  )
  const specSetKeys = new Set(DEFAULT_SETTINGS.map((s) => s.key))
  const extraSettings = current.settings.filter((s) => !specSetKeys.has(s.key))
  if (extraCats.length > 0 || extraSettings.length > 0) {
    console.log("")
    console.log(`   ℹ️  Fora do spec (não serão tocadas pelo seed):`)
    if (extraCats.length > 0) {
      const extraWithKids = extraCats.map((c) => {
        const kids = childrenByParent.get(c.name) ?? 0
        return kids > 0 ? `${c.name} (${kids} filho(s) no banco — possível pai renomeado)` : c.name
      })
      console.log(`      • ${extraCats.length} categoria(s) extra(s): ${extraWithKids.join(", ")}`)
    }
    if (extraSettings.length > 0) {
      console.log(
        `      • ${extraSettings.length} setting(s) extra(s): ${extraSettings.map((s) => s.key).join(", ")}`,
      )
    }
  }
  console.log("")
}
