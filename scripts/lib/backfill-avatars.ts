/**
 * Backfill de avatares para usuários de seed (CLIENT + PROVIDER).
 *
 * Preenche `avatarUrl` de usuários que estão sem foto usando a MESMA
 * convenção dos cards de prestador (provider-card.tsx):
 *   https://i.pravatar.cc/150?u=<userId>
 * — determinística por usuário, já liberada no CSP (csp.ts) e no
 * next.config images.remotePatterns.
 *
 * Idempotente: quem já tem avatarUrl é ignorado. Extraído como módulo
 * para o seed de Governador Valadares rodar o backfill como última
 * etapa automática (e para scripts standalone reutilizarem).
 */

import type { PrismaClient } from "@prisma/client"

const BATCH = 200

export function avatarFor(userId: string): string {
  return `https://i.pravatar.cc/150?u=${userId}`
}

/**
 * Preenche avatarUrl de todos os CLIENT/PROVIDER sem foto, em batches.
 * @returns quantidade de usuários atualizados.
 */
export async function backfillAvatars(prisma: PrismaClient): Promise<number> {
  const total = await prisma.user.count({
    where: { avatarUrl: null, role: { in: ["CLIENT", "PROVIDER"] } },
  })
  if (total === 0) {
    console.log("  🖼️  Nenhum usuário sem avatar — nada a fazer.")
    return 0
  }
  console.log(`  🖼️  Backfill de avatares para ${total} usuários (CLIENT/PROVIDER)...`)

  let updated = 0
  for (let skip = 0; skip < total + updated; skip += BATCH) {
    const users = await prisma.user.findMany({
      where: { avatarUrl: null, role: { in: ["CLIENT", "PROVIDER"] } },
      select: { id: true },
      take: BATCH,
      orderBy: { createdAt: "asc" },
    })
    if (users.length === 0) break
    await prisma.$transaction(
      users.map((u) =>
        prisma.user.update({
          where: { id: u.id },
          data: { avatarUrl: avatarFor(u.id) },
          select: { id: true },
        }),
      ),
    )
    updated += users.length
  }

  console.log(`    ✅ ${updated} usuários com avatar.`)
  return updated
}
