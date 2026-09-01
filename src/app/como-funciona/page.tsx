import type { Metadata } from "next"
import Footer from "@/components/shared/footer"

export const revalidate = 3600 // ISR: revalidate every hour

export const metadata: Metadata = {
  title: "Como funciona — Severinno",
  description: "Encontre e agende serviços profissionais online com facilidade e segurança.",
}

export default function ComoFunciona() {
  return (
    <>
      <div className="mx-auto max-w-3xl px-4 py-12">
        <h1 className="text-3xl font-bold">Como funciona</h1>
        <div className="mt-8 space-y-8">
          <Step
            number={1}
            title="Busque um profissional"
            desc="Encontre o profissional ideal para o serviço que você precisa. Filtre por categoria, localização e avaliação."
          />
          <Step
            number={2}
            title="Solicite um orçamento"
            desc="Envie os detalhes do serviço e receba orçamentos personalizados dos profissionais."
          />
          <Step
            number={3}
            title="Agende o serviço"
            desc="Escolha a melhor data e horário. O pagamento é processado com segurança."
          />
          <Step
            number={4}
            title="Avalie o trabalho"
            desc="Após a conclusão, avalie o profissional e ajude outros clientes a escolherem."
          />
        </div>
      </div>
      <Footer />
    </>
  )
}

function Step({ number, title, desc }: { number: number; title: string; desc: string }) {
  return (
    <div className="flex gap-4">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-lg font-bold text-white">
        {number}
      </div>
      <div>
        <h2 className="text-xl font-semibold">{title}</h2>
        <p className="text-muted-foreground mt-1">{desc}</p>
      </div>
    </div>
  )
}
