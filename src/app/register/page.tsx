import type { Metadata } from "next"
import { RegisterPageClient } from "./register-page-client"

export const metadata: Metadata = {
  title: "Cadastro — Severinno",
  description:
    "Crie sua conta Severinno. Cadastre-se como cliente ou prestador de serviços e comece a usar a plataforma.",
  openGraph: {
    title: "Cadastro — Severinno",
    description: "Crie sua conta e comece a usar a plataforma.",
  },
}

export default function RegisterPage() {
  return <RegisterPageClient />
}
