import type { Metadata } from "next"
import { LoginPageClient } from "./login-page-client"

export const metadata: Metadata = {
  title: "Entrar — Severinno",
  description:
    "Entre na sua conta Severinno para acessar o painel, gerenciar agendamentos e solicitar orçamentos.",
  openGraph: {
    title: "Entrar — Severinno",
    description: "Entre na sua conta para acessar o painel.",
  },
}

export default function LoginPage() {
  return <LoginPageClient />
}
