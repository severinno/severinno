/**
 * demo-accounts.ts
 *
 * Gate central para as contas de demonstração (admin@severinno.com/admin123,
 * cliente@severinno.com/cliente123, joao@severinno.com/provider123).
 *
 * Contas demo com senha conhecida são DEV/STAGING ONLY:
 *   - Expor uma credencial de ADMIN permanente em produção convida brute
 *     force e é bloqueador de release (ver docs/SECURITY.md e
 *     docs/SECRET_ROTATION.md).
 *   - O usuário demo NÃO deve existir no banco de produção (seed recusa).
 *
 * Consumidores:
 *   - src/components/modals/auth-modal.tsx  → esconde o bloco de credenciais
 *   - prisma/seed.ts                        → recusa semear usuários demo em prod
 *   - src/app/api/auth/login/route.ts       → bloqueia login de conta demo em prod
 *   - src/app/api/auth/register/route.ts    → bloqueia cadastro com email demo em prod
 *   - src/app/api/auth/forgot-password/route.ts → não envia reset para contas demo
 *   - src/lib/auth.ts (verifyUserActive)    → invalida sessões existentes de contas demo
 *
 * Nota de build: o Next.js substitui `process.env.NODE_ENV` por uma string
 * estática em tempo de build, então em produção esta função dobra para
 * `false` e o bloco demo pode ser eliminado como dead-code pelo bundler.
 */
export function isDemoAccountsEnabled(env: string | undefined = process.env.NODE_ENV): boolean {
  return env !== "production"
}

/**
 * Emails das contas demo — usados SERVER-SIDE para bloquear login/registro
 * em produção, mesmo que o usuário exista no banco (ex.: banco clonado de
 * dev/staging ou seed antigo). A UI esconder o bloco não basta: a credencial
 * admin@severinno.com/admin123 é pública, então a rota de auth precisa
 * recusar por conta própria.
 *
 * Mantenha sincronizado com o array DEMO_ACCOUNTS do auth-modal.tsx.
 */
export const DEMO_ACCOUNT_EMAILS: ReadonlySet<string> = new Set([
  "admin@severinno.com",
  "cliente@severinno.com",
  "joao@severinno.com",
])

/**
 * True se o email pertence a uma conta demo. Normaliza (trim + lowercase)
 * para casar com a normalização aplicada nas rotas de auth.
 */
export function isDemoAccountEmail(email: string | null | undefined): boolean {
  if (!email) return false
  return DEMO_ACCOUNT_EMAILS.has(email.trim().toLowerCase())
}
