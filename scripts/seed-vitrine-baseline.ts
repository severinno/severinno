/**
 * scripts/seed-vitrine-baseline.ts — dataset do baseline de paginação da vitrine
 *
 * O guard `scripts/check-vitrine-pagination-baseline.mjs` foi medido com a
 * vitrine em **415 prestadores visíveis (47 páginas de 9)** e a rotina precisa
 * de pelo menos 4 páginas para existir: o seek pousa na p3, o walk reverso
 * parte dela e o walk-interno encadeia p1→p4. O seed base (`prisma/seed.ts`)
 * cria 6 prestadores de demonstração — uma única página — e é por isso que o
 * job de CI morria no locator `Próxima` antes de medir qualquer coisa.
 *
 * Este seed completa o catálogo de forma DETERMINÍSTICA e IDEMPOTENTE: apaga
 * apenas os prestadores que ele mesmo criou (prefixo de e-mail reservado) e
 * cria a diferença entre os visíveis atuais e `--total` (default 415). Rodar
 * duas vezes não duplica ninguém e o dataset não muda entre rodadas — o
 * baseline compara medições como-como.
 *
 * Visível = a mesma definição do catálogo público (`src/lib/sql-builder.ts`):
 * `role = PROVIDER`, `active = true`, `verified = true`, `deletedAt IS NULL`.
 *
 * Usage:
 *   bun scripts/seed-vitrine-baseline.ts
 *   bun scripts/seed-vitrine-baseline.ts --total 415
 *   bun scripts/seed-vitrine-baseline.ts --help
 *
 * Exit codes:
 *   0 — dataset garantido (≥ 4 páginas de 9)
 *   1 — DATABASE_URL ausente, argumento inválido ou catálogo insuficiente
 */

import { PrismaClient } from "@prisma/client"
import { pathToFileURL } from "node:url"

/** Prefixo reservado: o seed só apaga (e só conta como seu) o que ele criou. */
export const EMAIL_PREFIX = "vitrine-baseline."
const EMAIL_DOMAIN = "@baseline.severinno.invalid"

/** O doc do baseline declara 415 prestadores em 47 páginas de 9. */
export const DEFAULT_TOTAL = 415
export const PAGE_SIZE = 9
/** A rotina do guard navega até a p4 (walk-interno) e volta da p3 (walk). */
export const MIN_PAGES = 4

/** Bairros reais de Governador Valadares (mesma cidade da seed do baseline). */
const BAIRROS = [
  { nome: "Centro", lat: -18.8566, lng: -41.9455 },
  { nome: "Boa Sorte", lat: -18.848, lng: -41.938 },
  { nome: "Cidade Nova", lat: -18.865, lng: -41.935 },
  { nome: "Alto Boa Sorte", lat: -18.84, lng: -41.93 },
  { nome: "Jardim Palácia", lat: -18.87, lng: -41.95 },
  { nome: "Eldorado", lat: -18.85, lng: -41.96 },
  { nome: "São José", lat: -18.862, lng: -41.925 },
  { nome: "Cidade dos Meninos", lat: -18.875, lng: -41.94 },
  { nome: "Nova Vista", lat: -18.855, lng: -41.92 },
  { nome: "Progresso", lat: -18.845, lng: -41.955 },
  { nome: "Belvedere", lat: -18.868, lng: -41.96 },
  { nome: "Castelo Branco", lat: -18.872, lng: -41.92 },
  { nome: "Vila Betânia", lat: -18.835, lng: -41.945 },
  { nome: "Santa Bárbara", lat: -18.88, lng: -41.955 },
  { nome: "Aeroporto", lat: -18.88, lng: -41.92 },
  { nome: "Morada do Sol", lat: -18.842, lng: -41.965 },
  { nome: "Vila Istanbul", lat: -18.858, lng: -41.97 },
  { nome: "Pousada do Sol", lat: -18.85, lng: -41.915 },
  { nome: "Bela Vista", lat: -18.863, lng: -41.945 },
  { nome: "Laranjeiras", lat: -18.87, lng: -41.93 },
]

const PRIMEIROS_NOMES = [
  "Ana",
  "Carlos",
  "Fernanda",
  "João",
  "Luciana",
  "Marcos",
  "Patrícia",
  "Rafael",
  "Sandra",
  "Thiago",
  "Vanessa",
  "Wagner",
]

const SOBRENOMES = [
  "Silva",
  "Santos",
  "Oliveira",
  "Souza",
  "Pereira",
  "Costa",
  "Rodrigues",
  "Almeida",
  "Nascimento",
  "Lima",
  "Araújo",
  "Fernandes",
]

/** Hash de placeholder: estes prestadores nunca fazem login (só listam). */
const PASSWORD_HASH = "$2b$10$vitrine-baseline.placeholder.not-for-login"

export type SeedOptions = { total: number }

export function parseArgs(
  argv: string[],
): { ok: true; opts: SeedOptions } | { ok: false; error: string } {
  const opts: SeedOptions = { total: DEFAULT_TOTAL }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "-h" || arg === "--help") {
      return { ok: false, error: "" }
    }
    if (arg === "--total") {
      const raw = argv[++i]
      const n = Number(raw)
      if (!Number.isInteger(n) || n <= 0) {
        return { ok: false, error: `--total exige inteiro positivo (recebido: ${raw ?? "nada"})` }
      }
      opts.total = n
    } else {
      return { ok: false, error: `argumento desconhecido: ${arg}` }
    }
  }
  return { ok: true, opts }
}

/** Páginas completas de 9 para N prestadores visíveis (piso: 1). */
export function pagesOf(total: number): number {
  return Math.max(1, Math.ceil(total / PAGE_SIZE))
}

/** Nome determinístico por índice (sem Math.random: o dataset não muda). */
export function nameOf(index: number): string {
  const primeiro = PRIMEIROS_NOMES[index % PRIMEIROS_NOMES.length]!
  const sobrenome = SOBRENOMES[(index * 7 + 3) % SOBRENOMES.length]!
  return `${primeiro} ${sobrenome}`
}

/** Dados do prestador `index` — todos os campos derivam do índice. */
export function providerOf(index: number) {
  const bairro = BAIRROS[index % BAIRROS.length]!
  const deslocamento = ((index % 11) - 5) * 0.0008
  return {
    email: `${EMAIL_PREFIX}${index}${EMAIL_DOMAIN}`,
    passwordHash: PASSWORD_HASH,
    name: nameOf(index),
    role: "PROVIDER" as const,
    city: "Governador Valadares",
    state: "MG",
    district: bairro.nome,
    lat: Number((bairro.lat + deslocamento).toFixed(6)),
    lng: Number((bairro.lng - deslocamento).toFixed(6)),
    radiusKm: 10 + (index % 20),
    verified: true,
    active: true,
    bio: `Profissional de serviços em ${bairro.nome}, Governador Valadares — ${1 + (index % 15)} anos de experiência.`,
    // Rating/review determinísticos: o keyset ordena por (avgRating, id) e
    // precisa de valores variados para exercitar o desempate por id.
    avgRating: Number((3 + (index % 21) / 10).toFixed(1)),
    reviewCount: index % 37,
  }
}

/** Linhas necessárias para levar os visíveis de `existing` a `total`.
 *  O índice começa em `existing` para que o e-mail (`prefixo.<n>`) seja único
 *  mesmo quando outro seed já contribuiu com prestadores visíveis. */
export function rowsToCreate(existing: number, total: number) {
  const need = Math.max(0, total - existing)
  return Array.from({ length: need }, (_, k) => providerOf(existing + k))
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2))
  if (!parsed.ok) {
    if (parsed.error) {
      console.error(`seed-vitrine-baseline: ${parsed.error}`)
      process.exit(1)
    }
    console.log(
      [
        "seed-vitrine-baseline — garante o dataset do baseline de paginação da vitrine",
        "",
        "Usage:",
        "  bun scripts/seed-vitrine-baseline.ts [--total N]",
        "",
        `  --total <n>  prestadores VISÍVEIS no catálogo (default ${DEFAULT_TOTAL} ⇒ ${pagesOf(DEFAULT_TOTAL)} páginas de ${PAGE_SIZE})`,
        "  -h, --help   esta ajuda",
        "",
        "Idempotente: apaga só os prestadores com prefixo de e-mail reservado e",
        "cria a diferença até --total. Visível = PROVIDER ativo, verificado, não",
        "deletado (a definição do catálogo público).",
      ].join("\n"),
    )
    process.exit(0)
  }

  if (!process.env.DATABASE_URL) {
    console.error("seed-vitrine-baseline: DATABASE_URL ausente")
    process.exit(1)
  }

  const { total } = parsed.opts
  const db = new PrismaClient()
  try {
    const removidos = await db.user.deleteMany({
      where: { email: { startsWith: EMAIL_PREFIX } },
    })

    const existentes = await db.user.count({
      where: { role: "PROVIDER", active: true, verified: true, deletedAt: null },
    })

    const rows = rowsToCreate(existentes, total)
    if (rows.length > 0) {
      await db.user.createMany({ data: rows })
    }

    const visiveis = await db.user.count({
      where: { role: "PROVIDER", active: true, verified: true, deletedAt: null },
    })
    const paginas = pagesOf(visiveis)

    console.log(
      `vitrine-baseline: ${visiveis} prestadores visíveis (${paginas} páginas de ${PAGE_SIZE}) — ` +
        `${rows.length} criados, ${existentes} já existentes, ${removidos.count} removidos do próprio seed`,
    )

    if (visiveis < total) {
      console.error(
        `vitrine-baseline: catálogo insuficiente — ${visiveis}/${total} visíveis ` +
          `(restam prestadores de outra origem? nenhum é criado além do default)`,
      )
      process.exit(1)
    }
    if (paginas < MIN_PAGES) {
      console.error(
        `vitrine-baseline: ${paginas} páginas < ${MIN_PAGES} — a rotina do guard ` +
          `(seek p3 + walk reverso + walk-interno p4) não tem onde acontecer`,
      )
      process.exit(1)
    }
  } finally {
    await db.$disconnect()
  }
}

// True apenas quando executado diretamente — importar as funções puras (testes)
// não dispara banco nenhum.
const IS_DIRECT_RUN =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (IS_DIRECT_RUN) {
  main().catch((err) => {
    console.error("seed-vitrine-baseline: falhou —", err)
    process.exit(1)
  })
}
