/**
 * Backfill de avatares para usuários de seed (CLIENT + PROVIDER).
 *
 * Wrapper standalone do módulo compartilhado `scripts/lib/backfill-avatars.ts`
 * (a MESMA lógica roda automaticamente como etapa final do seed de
 * Governador Valadares). Preenche `avatarUrl` de quem está sem foto usando
 * a convenção dos cards: https://i.pravatar.cc/150?u=<userId>.
 *
 * Idempotente: quem já tem avatarUrl é ignorado.
 *
 * Usage:
 *   npx tsx scripts/populate-seed-avatars.ts
 *
 * Exit codes:
 *   0 — success
 *   1 — failure
 */

import { PrismaClient } from "@prisma/client"

import { backfillAvatars } from "./lib/backfill-avatars"

const prisma = new PrismaClient()

async function main() {
  await backfillAvatars(prisma)
}

main()
  .catch((err) => {
    console.error("❌ Backfill de avatares falhou:", err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
