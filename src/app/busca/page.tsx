import type { Metadata } from "next"
import { SearchPage } from "./search-page"

export const metadata: Metadata = {
  title: "Buscar profissionais — Severinno",
  description:
    "Encontre profissionais perto de você. Busque por serviços, categorias ou profissionais.",
}

export default function Page() {
  return <SearchPage />
}
