import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Contato — Severinno",
}

export default function Contato() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-3xl font-bold">Contato</h1>
      <p className="mt-2 text-muted-foreground">Entre em contato com a equipe Severinno.</p>
      <div className="mt-8 grid gap-6 sm:grid-cols-2">
        <ContactCard
          title="E-mail"
          desc="Resposta em até 24h"
          value="contato@severinno.com.br"
          href="mailto:contato@severinno.com.br"
        />
        <ContactCard
          title="WhatsApp"
          desc="Atendimento rápido"
          value="(11) 99999-9999"
          href="https://wa.me/5511999999999"
        />
      </div>
    </div>
  )
}

function ContactCard({ title, desc, value, href }: { title: string; desc: string; value: string; href: string }) {
  return (
    <a href={href} className="rounded-lg border p-6 transition-colors hover:bg-accent" target="_blank" rel="noopener noreferrer">
      <h2 className="font-semibold">{title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
      <p className="mt-2 text-emerald-600 font-medium">{value}</p>
    </a>
  )
}
