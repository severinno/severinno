/**
 * Severinno Marketplace — seed script (Fase 1 / MVP)
 * Run with: bun run db:seed  (or: bun prisma/seed.ts)
 *
 * Creates: 1 admin, 2 clients, 6 providers (Brazilian service businesses),
 * categories (3-level tree), services, availabilities, ~4 completed bookings
 * with reviews, and a few admin settings.
 */

import { PrismaClient } from "@prisma/client"
import { Redis, Cluster } from "ioredis"
import { hashPassword } from "../src/lib/crypto"
import { isDemoAccountsEnabled } from "../src/lib/demo-accounts"
import {
  DEFAULT_SETTINGS,
  buildPatchedSpec,
  categorySlug,
  categoryOrder,
  assertValidCategorySpec,
  slugify,
  type CategorySeedInput,
} from "./seed-data"

const db = new PrismaClient()

// ── SEED_SPEC_PATCH: hook de teste p/ cenários de UPDATE e RENAME ────────
// Mesmo padrão do seed-prod (helper compartilhado buildPatchedSpec em
// seed-data.ts): permite ao E2E (scripts/test-seed-dev-e2e.ts) validar que o
// loop de criação de categorias reflete um spec mutado. O seed de dev faz
// wipe+recreate, então o patch flui direto pela criação — sem órfãs (diferente
// do upsert do seed-prod). SÓ é aplicado fora de produção: o gate usa o mesmo
// isDemoAccountsEnabled do guard abaixo — em NODE_ENV=production o SPEC ===
// CATEGORY_SPEC e o guard de contas demo recusa ANTES de qualquer escrita.
const SPEC: CategorySeedInput[] = buildPatchedSpec(
  process.env.SEED_SPEC_PATCH,
  isDemoAccountsEnabled(),
)

// São Paulo downtown reference (-23.55, -46.63)
const SP_LAT = -23.55
const SP_LNG = -46.63

function jitter(base: number, delta: number): number {
  return Number((base + (Math.random() * 2 - 1) * delta).toFixed(5))
}

/**
 * Padrões de cache do catálogo público que ficam STALE após um re-seed.
 *
 * Todo dado derivado de tabelas que o seed apaga/recria (User/Service/
 * Category/Review/Booking) precisa ser invalidado ao final — senão o
 * servidor dev continua servindo IDs ANTIGOS da vitrine por até o TTL de
 * cada cache (services 30s, providers:count 120s, proximity 60s,
 * categories/cat:desc 10min, reviews:recent 60s).
 *
 * Excluídos de propósito (espelho da ALLOWLIST do guard
 * scripts/check-cache-patterns.mjs — mantenha em sync):
 *   - `geo:*` (cep/search/reverse/structured) — cacheiam resultado de APIs
 *     EXTERNAS (ViaCEP/Nominatim), não dados derivados do seed; invalidar
 *     forçaria re-busca externa sem benefício. Edge conhecido: se a API
 *     externa estava FORA no momento de uma request anterior, o fallback
 *     local (que lê providers do DB) ficou cacheado sob `geo:*` com TTL de
 *     7d/24h — esse caso fica stale após re-seed, mas é caminho degradado
 *     e auto-expira; invalidar sempre forçaria re-busca externa à toa.
 *   - `user:active:*` / `realtime:renewed:*` / `realtime:revoked:*` /
 *     `push:payload:*` / `cron:cooldown:*` / `geo:metrics:*` — estado de
 *     sessão/push/ops, não catálogo (IDs antigos órfãos são inofensivos).
 *   - `distance:*` / `postgis:available` — distância usuário-a-usuário
 *     (IDs não estáveis entre re-seeds — órfãos inofensivos) e flag de
 *     capacidade do PostGIS (não é dado derivado do seed).
 */
const CACHE_PATTERNS: readonly string[] = [
  "services:*",
  "providers:count:*",
  "proximity:*",
  "categories:*",
  "cat:desc:*",
  "reviews:recent:*",
]

/**
 * Invalida os padrões de cache do catálogo público pós-re-seed (best-effort).
 *
 * O seed roda como processo standalone (bun prisma/seed.ts) e NÃO pode
 * importar `@/lib/redis`: a cadeia redis.ts → sentry.ts → "server-only" lança
 * fora do runtime do Next.js. Este helper replica o padrão cluster-aware do
 * `scanKeys` do redis.ts usando apenas ioredis (já é dependência):
 *   - standalone → KEYS + DEL
 *   - cluster     → SCAN em cada master + DEL (evita CROSSSLOT)
 *
 * Best-effort: se o Redis estiver fora do ar, loga um aviso e NÃO falha o
 * seed (o re-seed continua válido; as janelas de staleness apenas persistem).
 */
async function invalidateCachePatterns(patterns: readonly string[]): Promise<void> {
  const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379"
  const CLUSTER_MODE = process.env.REDIS_CLUSTER_MODE === "true"
  const CLUSTER_NODES = process.env.REDIS_CLUSTER_NODES || "localhost:6379"

  let client: Redis | Cluster | null = null
  try {
    if (CLUSTER_MODE) {
      const nodes = CLUSTER_NODES.split(",").map((s) => {
        const [host, portStr] = s.trim().split(":")
        return { host: host || "localhost", port: Number(portStr) || 6379 }
      })
      const cluster = new Cluster(nodes, {
        enableOfflineQueue: false,
        clusterRetryStrategy: () => null, // fail fast — best-effort
        redisOptions: { lazyConnect: true, connectTimeout: 3_000, maxRetriesPerRequest: 1 },
      })
      client = cluster
      await cluster.connect()

      // SCAN cada master por padrão (cluster-safe — KEYS geraria CROSSSLOT)
      const masters = cluster.nodes("master")
      for (const pattern of patterns) {
        const keysByNode = await Promise.all(
          masters.map(async (node) => {
            const keys: string[] = []
            let cursor = 0
            do {
              const [next, batch] = await node.scan(cursor, "MATCH", pattern)
              cursor = Number(next)
              for (const k of batch) if (!keys.includes(k)) keys.push(k)
            } while (cursor !== 0)
            return keys
          }),
        )
        const keys = keysByNode.flat()
        if (keys.length > 0) await cluster.del(...keys)
        console.log(`   🧹 cache ${pattern} invalidado (cluster, ${keys.length} chave(s))`)
      }
    } else {
      const redis = new Redis(REDIS_URL, {
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
        retryStrategy: () => null, // fail fast — best-effort
        lazyConnect: true,
        connectTimeout: 3_000,
      })
      client = redis
      await redis.connect()

      for (const pattern of patterns) {
        const keys = await redis.keys(pattern)
        if (keys.length > 0) await redis.del(...keys)
        console.log(`   🧹 cache ${pattern} invalidado (${keys.length} chave(s))`)
      }
    }
  } catch (err) {
    console.log(
      `   ⚠️  caches ${patterns.join(", ")} NÃO invalidados (Redis indisponível) — janelas de staleness persistem: ${(err as Error).message}`,
    )
  } finally {
    try {
      await client?.disconnect()
    } catch {
      /* ignore */
    }
  }
}

async function main() {
  console.log("🌱 Severinno seed — starting...")

  // ── Guard: nunca semear contas demo em produção ─────────────────
  // admin@severinno.com/admin123 é uma credencial CONHECIDA — criá-la em
  // produção é bloqueador de release (ver docs/SECURITY.md). O guard roda
  // ANTES do wipe para nunca destruir um banco de produção.
  if (!isDemoAccountsEnabled()) {
    console.error(
      "❌ Seed recusado: produção não pode criar contas demo (admin@severinno.com/admin123).",
    )
    console.error("   Rode o seed apenas em development/test (NODE_ENV !== production).")
    // Throw (não return): o catch abaixo faz process.exit(1) — CI/deploy que
    // rode o seed em produção DEVE falhar, não reportar sucesso.
    throw new Error("Seed recusado: produção não pode criar contas demo")
  }

  // ── Validação estrutural do spec (fail-fast ANTES de qualquer escrita) ──
  // Mesma proteção do seed-prod: nomes duplicados / parent inexistente /
  // level incoerente corromperiam a árvore silenciosamente (catByName é
  // chaveado por nome — um typo viraria parentId=null sem esta validação).
  // Valida o SPEC efetivo (CATEGORY_SPEC ou o patchado via SEED_SPEC_PATCH).
  assertValidCategorySpec(SPEC)

  // --- wipe (order matters for FKs) -------------------------------
  console.log("   • wiping existing data...")
  await db.payment.deleteMany()
  await db.review.deleteMany()
  await db.message.deleteMany()
  await db.notification.deleteMany()
  await db.favorite.deleteMany()
  await db.quoteItem.deleteMany()
  await db.quoteRequest.deleteMany()
  await db.booking.deleteMany()
  await db.providerAvailability.deleteMany()
  await db.service.deleteMany()
  await db.setting.deleteMany()
  await db.category.deleteMany()
  await db.user.deleteMany()

  // --- USERS ------------------------------------------------------
  console.log("   • creating users...")
  const adminPw = await hashPassword("admin123")
  const clientPw = await hashPassword("cliente123")

  const admin = await db.user.create({
    data: {
      email: "admin@severinno.com",
      passwordHash: adminPw,
      name: "Administrador Severinno",
      slug: slugify("Administrador Severinno"),
      role: "ADMIN",
      // Demo do limite por plano do realtime: o admin é PREMIUM (5 sessões)
      // enquanto os demais users do seed ficam no default FREE (fallback ao
      // per-role). Conta demo — em produção o plano vem do billing/tenant.
      plan: "PREMIUM",
      verified: true,
      active: true,
      phone: "(11) 4000-0000",
      whatsapp: "(11) 90000-0000",
      city: "São Paulo",
      state: "SP",
    },
  })

  const client1 = await db.user.create({
    data: {
      email: "cliente@severinno.com",
      passwordHash: clientPw,
      name: "João Cliente",
      slug: slugify("João Cliente"),
      role: "CLIENT",
      verified: true,
      active: true,
      cpfCnpj: "123.456.789-09",
      whatsapp: "(11) 98888-1111",
      phone: "(11) 3888-1111",
      cep: "01310-100",
      street: "Avenida Paulista",
      number: "1000",
      district: "Bela Vista",
      city: "São Paulo",
      state: "SP",
      lat: jitter(SP_LAT, 0.01),
      lng: jitter(SP_LNG, 0.01),
      avatarUrl: "https://i.pravatar.cc/150?img=12",
    },
  })

  const client2 = await db.user.create({
    data: {
      email: "maria@severinno.com",
      passwordHash: clientPw,
      name: "Maria Aparecida",
      slug: slugify("Maria Aparecida"),
      role: "CLIENT",
      verified: true,
      active: true,
      cpfCnpj: "987.654.321-00",
      whatsapp: "(11) 97777-2222",
      phone: "(11) 3777-2222",
      cep: "04547-130",
      street: "Rua Funchal",
      number: "320",
      district: "Vila Olímpia",
      city: "São Paulo",
      state: "SP",
      lat: jitter(SP_LAT, 0.012),
      lng: jitter(SP_LNG, 0.012),
      avatarUrl: "https://i.pravatar.cc/150?img=5",
    },
  })

  // --- PROVIDERS --------------------------------------------------
  type ProviderSeed = {
    name: string
    email: string
    bio: string
    avatarImg: number
    coverSeed: string
    profession: string
    cep: string
    street: string
    district: string
    radiusKm: number
  }

  const providersData: ProviderSeed[] = [
    {
      name: "Carlos Encanador",
      email: "carlos@severinno.com",
      bio: "Encanador com 15 anos de experiência em reparos hidráulicos, desentupimento e instalação de caixas de descarga. Atendo toda a zona sul de São Paulo.",
      avatarImg: 11,
      coverSeed: "encanador",
      profession: "Encanador",
      cep: "04094-050",
      street: "Rua Joaquim Nabuco",
      district: "Brooklin",
      radiusKm: 12,
    },
    {
      name: "EletricaTech — Ricardo",
      email: "ricardo@severinno.com",
      bio: "Eletricista predial e residencial. Instalações elétricas, troca de quadros, manutenção preventiva e correção de curtos-circuitos. NR-10 atualizada.",
      avatarImg: 13,
      coverSeed: "eletricista",
      profession: "Eletricista",
      cep: "02012-000",
      street: "Rua Voluntários da Pátria",
      district: "Santana",
      radiusKm: 15,
    },
    {
      name: "Pinturas Lima",
      email: "lima@severinno.com",
      bio: "Pintor residencial e comercial. Pintura interna e externa, textura, grafiato e preparação de paredes. Orçamento sem compromisso.",
      avatarImg: 15,
      coverSeed: "pintor",
      profession: "Pintor",
      cep: "05407-002",
      street: "Rua Cardeal Arcoverde",
      district: "Pinheiros",
      radiusKm: 20,
    },
    {
      name: "Diarista Fernanda",
      email: "fernanda@severinno.com",
      bio: "Diarista com referências. Limpeza residencial, pós-obra e organização. Trabalho com produtos próprios. Atendo manhãs e tardes.",
      avatarImg: 16,
      coverSeed: "diarista",
      profession: "Diarista",
      cep: "03333-001",
      street: "Rua Tuiuti",
      district: "Tatuapé",
      radiusKm: 10,
    },
    {
      name: "Jardins Vida — Pedro",
      email: "pedro@severinno.com",
      bio: "Jardineiro especializado em paisagismo, poda de árvores, controle de pragas e manutenção de jardins residenciais e comerciais.",
      avatarImg: 17,
      coverSeed: "jardineiro",
      profession: "Jardineiro",
      cep: "05652-000",
      street: "Avenida Eliseu de Almeida",
      district: "Vila Sônia",
      radiusKm: 18,
    },
    {
      name: "Pedreiro Antônio",
      email: "antonio@severinno.com",
      bio: "Pedreiro experiente em alvenaria, revestimentos, contrapiso e pequenas reformas. Garantia de serviço e notas fiscais.",
      avatarImg: 18,
      coverSeed: "pedreiro",
      profession: "Pedreiro",
      cep: "02982-000",
      street: "Rua Parapuã",
      district: "Vila Anastácio",
      radiusKm: 25,
    },
  ]

  const providers: Record<string, Awaited<ReturnType<typeof db.user.create>>> = {}

  for (const p of providersData) {
    providers[p.profession] = await db.user.create({
      data: {
        email: p.email,
        passwordHash: await hashPassword("provider123"),
        name: p.name,
        slug: slugify(p.name),
        role: "PROVIDER",
        verified: true,
        active: true,
        bio: p.bio,
        avatarUrl: `https://i.pravatar.cc/150?img=${p.avatarImg}`,
        coverUrl: `https://picsum.photos/seed/${p.coverSeed}/800/300`,
        cep: p.cep,
        street: p.street,
        number: String(Math.floor(Math.random() * 1500) + 100),
        district: p.district,
        city: "São Paulo",
        state: "SP",
        lat: jitter(SP_LAT, 0.03),
        lng: jitter(SP_LNG, 0.03),
        radiusKm: p.radiusKm,
        whatsapp:
          "(11) 9" +
          Math.floor(1000 + Math.random() * 8999) +
          "-" +
          Math.floor(1000 + Math.random() * 8999),
        phone:
          "(11) 3" +
          Math.floor(1000 + Math.random() * 8999) +
          "-" +
          Math.floor(1000 + Math.random() * 8999),
        cpfCnpj:
          "0" +
          String(Math.floor(100000000 + Math.random() * 89999999)) +
          "-" +
          String(Math.floor(10 + Math.random() * 89)),
      },
    })
  }

  // --- AVAILABILITY for each provider -----------------------------
  console.log("   • creating availabilities...")
  const daysMonToSat = [1, 2, 3, 4, 5, 6] // Mon-Fri 08-18, Sat 08-12
  for (const p of Object.values(providers)) {
    for (const dow of daysMonToSat) {
      const isSaturday = dow === 6
      await db.providerAvailability.create({
        data: {
          providerId: p.id,
          dayOfWeek: dow,
          startTime: "08:00",
          endTime: isSaturday ? "12:00" : "18:00",
          active: true,
        },
      })
    }
  }

  // --- CATEGORIES (3-level tree) ----------------------------------
  console.log("   • creating categories...")
  const catByName: Record<string, { id: string }> = {}
  // sort so parents come first (SPEC pode ser o canônico ou o patchado)
  const sorted = [...SPEC].sort((a, b) => a.level - b.level)
  for (const c of sorted) {
    const parent = c.parent ? catByName[c.parent] : null
    const created = await db.category.create({
      data: {
        name: c.name,
        slug: categorySlug(c),
        parentId: parent?.id ?? null,
        level: c.level,
        icon: c.icon ?? null,
        order: categoryOrder(c),
        active: true,
      },
    })
    catByName[c.name] = { id: created.id }
  }

  // --- SERVICES ---------------------------------------------------
  console.log("   • creating services...")
  type ServiceSeed = {
    providerKey: string
    subCat: string
    title: string
    description: string
    basePrice: number
    unit: string
    photoSeed: string
  }

  const servicesData: ServiceSeed[] = [
    {
      providerKey: "Encanador",
      subCat: "Desentupimento",
      title: "Desentupimento de ralo e pia",
      description:
        "Desentupimento de ralos, pias e vasos sanitários com equipamento profissional. Inclui diagnóstico e garantia de 30 dias.",
      basePrice: 120,
      unit: "UNIDADE",
      photoSeed: "service-1",
    },
    {
      providerKey: "Encanador",
      subCat: "Vazamento",
      title: "Localização e reparo de vazamento",
      description:
        "Detecção de vazamentos com equipamento acústico e reparo completo. Atendimento de emergência disponível.",
      basePrice: 200,
      unit: "UNIDADE",
      photoSeed: "service-2",
    },
    {
      providerKey: "Encanador",
      subCat: "Caixa de descarga",
      title: "Troca de caixa de descarga",
      description:
        "Substituição de caixa de descarga hidra ou de embutir. Inclui peça de qualidade e mão de obra.",
      basePrice: 180,
      unit: "UNIDADE",
      photoSeed: "service-3",
    },
    {
      providerKey: "Eletricista",
      subCat: "Tomadas e interruptores",
      title: "Troca de tomadas e interruptores",
      description:
        "Substituição de tomadas e interruptores com fiação revisada. Atende padrão novo (3 pinos).",
      basePrice: 25,
      unit: "UNIDADE",
      photoSeed: "service-4",
    },
    {
      providerKey: "Eletricista",
      subCat: "Curto-circuito",
      title: "Diagnóstico e reparo de curto-circuito",
      description:
        "Identificação da causa do curto, reparo da fiação e testes de segurança. Atendimento de emergência.",
      basePrice: 250,
      unit: "UNIDADE",
      photoSeed: "service-5",
    },
    {
      providerKey: "Eletricista",
      subCat: "Quadro elétrico",
      title: "Instalação de quadro de distribuição",
      description:
        "Montagem e instalação de quadro elétrico com disjuntores dimensionados conforme NBR 5410.",
      basePrice: 600,
      unit: "UNIDADE",
      photoSeed: "service-6",
    },
    {
      providerKey: "Pintor",
      subCat: "Pintura interna",
      title: "Pintura interna de parede",
      description:
        "Pintura de paredes internas com tinta acrílica de primeira linha. Preparo, massa corrida e 2 demãos.",
      basePrice: 35,
      unit: "METRO_QUADRADO",
      photoSeed: "service-7",
    },
    {
      providerKey: "Pintor",
      subCat: "Textura e grafiato",
      title: "Aplicação de textura e grafiato",
      description:
        "Aplicação de textura decorativa ou grafiato em paredes internas/externas. Material incluso.",
      basePrice: 55,
      unit: "METRO_QUADRADO",
      photoSeed: "service-8",
    },
    {
      providerKey: "Diarista",
      subCat: "Limpeza geral",
      title: "Diária de limpeza residencial",
      description:
        "Diária de 8 horas para limpeza geral de apartamentos e casas. Produtos de limpeza inclusos.",
      basePrice: 180,
      unit: "UNIDADE",
      photoSeed: "service-9",
    },
    {
      providerKey: "Diarista",
      subCat: "Limpeza pós-obra",
      title: "Limpeza pós-obra completa",
      description:
        "Limpeza profunda após reforma: remoção de resíduos, cimento, tinta e poeira. Até 100m².",
      basePrice: 650,
      unit: "UNIDADE",
      photoSeed: "service-10",
    },
    {
      providerKey: "Jardineiro",
      subCat: "Poda de árvores",
      title: "Poda de árvores e arbustos",
      description:
        "Poda de manutenção e limpeza de arbustos. Inclui remoção dos galhos. Orçamento por visita.",
      basePrice: 150,
      unit: "UNIDADE",
      photoSeed: "service-11",
    },
    {
      providerKey: "Pedreiro",
      subCat: "Assentamento de piso",
      title: "Assentamento de piso cerâmico",
      description:
        "Assentamento de pisos e azulejos cerâmicos porcelanatos. Inclui preparo do contrapiso.",
      basePrice: 45,
      unit: "METRO_QUADRADO",
      photoSeed: "service-12",
    },
    {
      providerKey: "Pedreiro",
      subCat: "Contrapiso",
      title: "Execução de contrapiso",
      description: "Preparo e execução de contrapiso nivelado para posterior assentamento de piso.",
      basePrice: 60,
      unit: "METRO_QUADRADO",
      photoSeed: "service-13",
    },
  ]

  const createdServices: { id: string; providerId: string }[] = []
  for (const s of servicesData) {
    const provider = providers[s.providerKey]
    const category = catByName[s.subCat]
    if (!provider || !category) {
      console.warn(`   ⚠ skipping service "${s.title}" — missing provider or category`)
      continue
    }
    const created = await db.service.create({
      data: {
        providerId: provider.id,
        categoryId: category.id,
        title: s.title,
        description: s.description,
        basePrice: s.basePrice,
        unit: s.unit,
        photos: [
          `https://picsum.photos/seed/${s.photoSeed}/800/600`,
          `https://picsum.photos/seed/${s.photoSeed}-2/800/600`,
        ],
        active: true,
      },
    })
    createdServices.push({ id: created.id, providerId: provider.id })
  }

  // --- BOOKINGS + REVIEWS -----------------------------------------
  console.log("   • creating bookings + reviews...")
  const encanador = providers["Encanador"]
  const eletricista = providers["Eletricista"]
  const encanadorServices = createdServices.filter((s) => s.providerId === encanador.id)
  const eletricistaServices = createdServices.filter((s) => s.providerId === eletricista.id)

  const now = Date.now()
  const daysAgo = (n: number) => new Date(now - n * 24 * 60 * 60 * 1000)

  const bookings = [
    {
      client: client1,
      provider: encanador,
      service: encanadorServices[0],
      scheduledAt: daysAgo(20),
      amount: 120,
      rating: 5,
      comment:
        "Excelente trabalho! Resolveu o vazamento rapidamente e ainda me deu dicas de manutenção.",
    },
    {
      client: client2,
      provider: encanador,
      service: encanadorServices[1],
      scheduledAt: daysAgo(15),
      amount: 220,
      rating: 4,
      comment: "Bom serviço, chegou um pouco atrasado mas resolveu tudo. Recomendo.",
    },
    {
      client: client1,
      provider: eletricista,
      service: eletricistaServices[0],
      scheduledAt: daysAgo(10),
      amount: 100,
      rating: 5,
      comment: "Profissional muito atencioso, trocou 4 tomadas em 1 hora. Super recomendado!",
    },
    {
      client: client2,
      provider: eletricista,
      service: eletricistaServices[1],
      scheduledAt: daysAgo(5),
      amount: 280,
      rating: 5,
      comment: "Curto-circuito resolvido na hora. Garantia de 90 dias fornecida.",
    },
  ]

  for (const b of bookings) {
    if (!b.service) continue
    const booking = await db.booking.create({
      data: {
        clientId: b.client.id,
        providerId: b.provider.id,
        serviceId: b.service.id,
        scheduledAt: b.scheduledAt,
        status: "COMPLETED",
        address: `${b.client.street ?? "Endereço"}, ${b.client.number ?? "s/n"}`,
        cep: b.client.cep ?? "00000-000",
        lat: b.client.lat ?? SP_LAT,
        lng: b.client.lng ?? SP_LNG,
        amount: b.amount,
        paymentMethod: "PIX",
        paymentStatus: "PAID",
        notes: "Serviço agendado via marketplace Severinno.",
      },
    })
    await db.payment.create({
      data: {
        bookingId: booking.id,
        amount: b.amount,
        method: "PIX",
        status: "PAID",
        transactionId: "TX" + booking.id.toUpperCase().slice(-10),
      },
    })
    await db.review.create({
      data: {
        bookingId: booking.id,
        clientId: b.client.id,
        providerId: b.provider.id,
        serviceId: b.service.id,
        rating: b.rating,
        comment: b.comment,
      },
    })
  }

  // --- FAVORITES --------------------------------------------------
  console.log("   • creating favorites...")
  await db.favorite.create({
    data: { clientId: client1.id, providerId: encanador.id },
  })
  await db.favorite.create({
    data: { clientId: client2.id, providerId: eletricista.id },
  })

  // --- NOTIFICATIONS (welcome) ------------------------------------
  for (const u of [admin, client1, client2, ...Object.values(providers)]) {
    await db.notification.create({
      data: {
        userId: u.id,
        type: "WELCOME",
        title: `Bem-vindo ao Severinno, ${u.name}!`,
        body: "Sua conta foi criada com sucesso. Comece a explorar o marketplace agora mesmo.",
        read: false,
      },
    })
  }

  // --- SETTINGS ---------------------------------------------------
  console.log("   • creating settings...")
  for (const s of DEFAULT_SETTINGS) {
    await db.setting.create({
      data: { key: s.key, value: s.value, updatedBy: admin.id },
    })
  }

  // ── Sync PostGIS location column (batch-inserted rows bypass trigger) ──
  console.log("   • syncing PostGIS location columns...")
  try {
    await db.$executeRawUnsafe(`
      UPDATE "User"
      SET location = ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography
      WHERE lat IS NOT NULL AND lng IS NOT NULL AND location IS NULL;
    `)
    await db.$executeRawUnsafe(`
      UPDATE "Booking"
      SET location = ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography
      WHERE lat IS NOT NULL AND lng IS NOT NULL AND location IS NULL;
    `)
    await db.$executeRawUnsafe(`
      UPDATE "QuoteRequest"
      SET location = ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography
      WHERE lat IS NOT NULL AND lng IS NOT NULL AND location IS NULL;
    `)
    console.log("   ✅ PostGIS locations synced")
  } catch (_e) {
    // PostGIS may not be available (e.g. SQLite) — non-fatal
    console.log("   ⚠️  PostGIS sync skipped (extension not available)")
  }

  // ── Invalida o cache Redis do catálogo público (fecha as janelas de stale) ──
  // Vários endpoints da vitrine cacheiam com withCache (services 30s,
  // providers:count 120s, proximity 60s, categories/cat:desc 10min,
  // reviews:recent 60s); sem esta invalidação, um re-seed deixaria o servidor
  // dev servindo IDs ANTIGOS por até o maior TTL — exatamente a janela
  // documentada no spec E2E (e2e/realtime-notification.spec.ts). Best-effort:
  // se o Redis estiver fora, o seed conclui normalmente e apenas loga o aviso.
  console.log("   • invalidating public catalog caches...")
  await invalidateCachePatterns(CACHE_PATTERNS)

  console.log("")
  console.log("✅ Seed completed successfully!")
  console.log(`   • Users:    1 admin + 2 clients + 6 providers`)
  console.log(`   • Categories: ${Object.keys(catByName).length} (3-level tree)`)
  console.log(`   • Services:  ${createdServices.length}`)
  console.log(`   • Bookings:  ${bookings.length} (all completed, with reviews)`)
  console.log(`   • Settings:  ${DEFAULT_SETTINGS.length}`)
  console.log("")
  console.log("   🔑 Login credentials:")
  console.log("      admin@severinno.com   / admin123")
  console.log("      cliente@severinno.com / cliente123")
  console.log("      maria@severinno.com   / cliente123")
  console.log("      [provider]@severinno.com / provider123")
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
