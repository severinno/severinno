/**
 * prod-seed.ts
 *
 * Guard do seed de PRODUÇÃO (prisma/seed-prod.ts).
 *
 * Diferente do seed de dev (que RECUSA rodar em produção por criar contas
 * demo), o seed-prod é a operação legítima para o banco de produção:
 * popula apenas categorias + settings, SEM usuários demo.
 *
 * Como é um script destrutivo de baixa frequência contra o banco produtivo,
 * ele só roda com NODE_ENV=production explícito — nunca em dev/test/staging
 * (evita que um `bun run db:seed:prod` acidental polua um banco de dev).
 *
 * Para validação local contra um banco efêmero (CI/seed-prod-guard), use
 * `PROD_SEED_ALLOW_DEV=1` como override explícito.
 */
export function isProdSeedAllowed(
  env: string | undefined = process.env.NODE_ENV,
  allowDev: string | undefined = process.env.PROD_SEED_ALLOW_DEV,
): boolean {
  return env === "production" || allowDev === "1"
}
