import "server-only"

/**
 * WhatsApp Template Catalog & Dynamic Message Renderer
 *
 * Biblioteca de templates padronizados para notificações transacionais,
 * comunicados administrativos e campanhas segmentadas do Severinno Marketplace.
 */

export type WhatsAppTemplateId =
  | "system_maintenance"
  | "platform_announcement"
  | "provider_incentive"
  | "client_welcome"
  | "booking_summary"

export type WhatsAppTemplate = {
  id: WhatsAppTemplateId
  title: string
  description: string
  category: "ANNOUNCEMENT" | "MARKETING" | "TRANSACTIONAL"
  variables: string[]
  defaultText: string
  render: (vars: Record<string, string>) => string
}

export const WHATSAPP_TEMPLATES: Record<WhatsAppTemplateId, WhatsAppTemplate> = {
  system_maintenance: {
    id: "system_maintenance",
    title: "Aviso de Manutenção Programada",
    description: "Informa usuários sobre janelas de manutenção técnica",
    category: "ANNOUNCEMENT",
    variables: ["dataHora", "tempoEstimado"],
    defaultText:
      "⚠️ *Aviso Importante - Severinno Marketplace*\n\n" +
      "Informamos que realizaremos uma manutenção preventiva em nossos servidores em *{{dataHora}}* (duração estimada: *{{tempoEstimado}}*).\n\n" +
      "Durante este período, o aplicativo poderá apresentar instabilidades temporárias. Agradecemos a compreensão! 🛠️",
    render: (vars) =>
      `⚠️ *Aviso Importante - Severinno Marketplace*\n\n` +
      `Informamos que realizaremos uma manutenção preventiva em nossos servidores em *${vars.dataHora || "breve"}* (duração estimada: *${vars.tempoEstimado || "1 hora"}*).\n\n` +
      `Durante este período, o aplicativo poderá apresentar instabilidades temporárias. Agradecemos a compreensão! 🛠️`,
  },
  platform_announcement: {
    id: "platform_announcement",
    title: "Comunicado Geral da Plataforma",
    description: "Novidades, novos recursos e comunicados para a comunidade",
    category: "ANNOUNCEMENT",
    variables: ["titulo", "detalhes", "linkAcao"],
    defaultText:
      "📢 *Novidade no Severinno: {{titulo}}*\n\n" +
      "{{detalhes}}\n\n" +
      "👉 Acesse agora para conferir: {{linkAcao}}",
    render: (vars) =>
      `📢 *Novidade no Severinno: ${vars.titulo || "Novos Recursos Disponíveis"}*\n\n` +
      `${vars.detalhes || "Atualizamos o aplicativo com novas facilidades para você."}\n\n` +
      `👉 Acesse agora para conferir: ${vars.linkAcao || "https://severinno.com"}`,
  },
  provider_incentive: {
    id: "provider_incentive",
    title: "Incentivo e Oportunidades para Profissionais",
    description: "Avisa profissionais sobre alta demanda de serviços na sua região",
    category: "MARKETING",
    variables: ["categoria", "cidade"],
    defaultText:
      "🚀 *Alta Demanda de Serviços - Severinno*\n\n" +
      "Notamos um aumento expressivo de pedidos para a área de *{{categoria}}* em *{{cidade}}*!\n\n" +
      "Abra o app Severinno Profissional para visualizar novos orçamentos e conquistar novos clientes hoje mesmo. 💼",
    render: (vars) =>
      `🚀 *Alta Demanda de Serviços - Severinno*\n\n` +
      `Notamos um aumento expressivo de pedidos para a área de *${vars.categoria || "Serviços Gerais"}* em *${vars.cidade || "sua região"}*!\n\n` +
      `Abra o app Severinno Profissional para visualizar novos orçamentos e conquistar novos clientes hoje mesmo. 💼`,
  },
  client_welcome: {
    id: "client_welcome",
    title: "Boas-vindas ao Cliente",
    description: "Mensagem de recepção para novos clientes cadastrados",
    category: "TRANSACTIONAL",
    variables: ["nomeCliente"],
    defaultText:
      "👋 *Olá, {{nomeCliente}}! Seja muito bem-vindo ao Severinno.*\n\n" +
      "Aqui você encontra eletricistas, encanadores, pintores, diaristas e dezenas de outros profissionais verificados.\n\n" +
      "🛡️ Todos os seus pagamentos contam com o *Severinno Escrow*, onde seu dinheiro só é liberado após a sua aprovação final do serviço!\n\n" +
      "Precisa de ajuda? Digite *MENU* aqui para ver nossos comandos rápidos.",
    render: (vars) =>
      `👋 *Olá, ${vars.nomeCliente || "Cliente"}! Seja muito bem-vindo ao Severinno.*\n\n` +
      `Aqui você encontra eletricistas, encanadores, pintores, diaristas e dezenas de outros profissionais verificados.\n\n` +
      `🛡️ Todos os seus pagamentos contam com o *Severinno Escrow*, onde seu dinheiro só é liberado após a sua aprovação final do serviço!\n\n` +
      `Precisa de ajuda? Digite *MENU* aqui para ver nossos comandos rápidos.`,
  },
  booking_summary: {
    id: "booking_summary",
    title: "Resumo Consolidado do Atendimento",
    description: "Detalhes do serviço e protocolo de segurança",
    category: "TRANSACTIONAL",
    variables: ["codigo", "servico", "profissional", "dataHora"],
    defaultText:
      "📋 *Resumo do seu Agendamento - Severinno*\n\n" +
      "• Código: *#{{codigo}}*\n" +
      "• Serviço: *{{servico}}*\n" +
      "• Profissional: *{{profissional}}*\n" +
      "• Horário: *{{dataHora}}*\n\n" +
      "Para acompanhar em tempo real, acesse o app: https://severinno.com/?view=client.bookings",
    render: (vars) =>
      `📋 *Resumo do seu Agendamento - Severinno*\n\n` +
      `• Código: *#${vars.codigo || "00000000"}*\n` +
      `• Serviço: *${vars.servico || "Serviço"}*\n` +
      `• Profissional: *${vars.profissional || "Profissional"}*\n` +
      `• Horário: *${vars.dataHora || "A combinar"}*\n\n` +
      `Para acompanhar em tempo real, acesse o app: https://severinno.com/?view=client.bookings`,
  },
}

export function listAvailableTemplates(): Array<{
  id: WhatsAppTemplateId
  title: string
  description: string
  category: string
  variables: string[]
  defaultText: string
}> {
  return Object.values(WHATSAPP_TEMPLATES).map((t) => ({
    id: t.id,
    title: t.title,
    description: t.description,
    category: t.category,
    variables: t.variables,
    defaultText: t.defaultText,
  }))
}
