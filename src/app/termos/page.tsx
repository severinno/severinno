import type { Metadata } from "next"

// ISR — static marketing content; revalidate daily (content changes rarely)
export const revalidate = 86400

export const metadata: Metadata = {
  title: "Termos de Uso — Severinno",
}

export default function Termos() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-12 prose prose-gray dark:prose-invert">
      <h1>Termos de Uso</h1>
      <p>Última atualização: julho de 2026</p>
      <h2>1. Aceitação dos Termos</h2>
      <p>Ao acessar ou usar a plataforma Severinno, você concorda com estes termos.</p>
      <h2>2. Cadastro e Conta</h2>
      <p>Você é responsável por manter a confidencialidade de seus dados de acesso.</p>
      <h2>3. Serviços</h2>
      <p>A Severinno conecta clientes a profissionais. Não somos responsáveis pela execução dos serviços agendados.</p>
      <h2>4. Pagamentos</h2>
      <p>Os pagamentos são processados pela Lytex. Valores ficam retidos até a conclusão do serviço.</p>
      <h2>5. Cancelamentos</h2>
      <p>Cancelamentos com até 24h de antecedência são gratuitos. Após esse prazo, pode haver taxa.</p>
    </article>
  )
}
