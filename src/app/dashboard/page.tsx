import { getSessionExpiresAt } from "@/lib/auth"
import { DashboardPageClient } from "./dashboard-page-client"

export const metadata = {
  title: "Dashboard — Severinno",
  description: "Gerencie seus agendamentos, orçamentos e avaliações.",
}

/**
 * SSR: lê o expiresAt do cookie (sem side effects — RSC não pode reemitir
 * cookie) e passa o countdown inicial ao client. O DashboardPageClient semeia
 * o auth store com esse valor, então o banner/pill de sessão renderiza no
 * PRIMEIRO paint sem esperar o fetchMe (evita o flash de carregamento).
 */
export default async function DashboardPage() {
  const initialSessionExpiresAt = await getSessionExpiresAt()
  return <DashboardPageClient initialSessionExpiresAt={initialSessionExpiresAt} />
}
