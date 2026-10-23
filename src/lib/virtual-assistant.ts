/**
 * Virtual Assistant Domain Knowledge Engine for Severinno Marketplace.
 *
 * Provides instant, high-quality, resilient conversational responses
 * when external LLM providers (ZAI, Groq, OpenAI) are unconfigured,
 * rate-limited, or experiencing outages.
 */

export interface ChatHistoryMessage {
  role: "user" | "assistant"
  content: string
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
}

/**
 * Generates an intelligent, context-aware Portuguese response for the Severinno assistant.
 */
export function generateVirtualAssistantResponse(
  message: string,
  history: ChatHistoryMessage[] = [],
): string {
  const norm = normalize(message)

  // Also check previous user message for follow-up context
  const previousUserMsg = [...history]
    .reverse()
    .find((m) => m.role === "user" && m.content !== message)
  const prevNorm = previousUserMsg ? normalize(previousUserMsg.content) : ""

  // 1. Saudações e Small Talk
  if (
    /^(oi|ola|opa|e ai|bom dia|boa tarde|boa noite|tudo bem|fala|alo|coe|hello|hi)[!?.\s]*$/i.test(
      norm,
    ) ||
    /^(oi|ola|opa),?\s+(tudo bem|como vai|beleza)/i.test(norm)
  ) {
    return (
      "Olá! 👋 Seja muito bem-vindo ao **Severinno**!\n\n" +
      "Sou o assistente virtual da plataforma e posso te ajudar a:\n" +
      "• Encontrar prestadores de serviço verificados em Governador Valadares\n" +
      "• Entender como solicitar orçamentos gratuitos\n" +
      "• Tirar dúvidas sobre prazos, formas de pagamento e garantia de serviço\n\n" +
      'Como posso te ajudar hoje? Você pode digitar o que precisa (ex: *"preciso de um eletricista"* ou *"como funciona?"*).'
    )
  }

  // 2. Agradecimento / Fechamento
  if (
    /^(obrigad[oa]|valeu|muito obrigado|show|otimo|perfeito|maravilha|top|agradeco)/i.test(norm)
  ) {
    return (
      "Disponha sempre! 😊 Se precisar de mais alguma coisa ou quiser encontrar outro profissional, estou por aqui.\n\n" +
      "Você também pode navegar pelas categorias na vitrine a qualquer momento. Tenha um ótimo dia com o **Severinno**!"
    )
  }

  // 3. Como funciona a plataforma
  if (
    /como funciona|o que e|explicar|passo a passo|como contrato|como usar|plataforma/i.test(norm)
  ) {
    return (
      "O **Severinno** conecta você aos melhores profissionais autônomos e empresas de Governador Valadares com segurança garantida!\n\n" +
      "Veja como é simples:\n" +
      "1. 🔍 **Busca Inteligente:** Escolha a categoria desejada (Eletricista, Encanador, Pintor, etc.) e filtre pelo seu raio de distância.\n" +
      "2. 💬 **Orçamento Direto:** Fale com o prestador pelo chat ou WhatsApp da plataforma para detalhar o serviço.\n" +
      "3. 🛡️ **Pagamento Protegido (Escrow):** O pagamento (PIX ou cartão) fica retido em segurança pela plataforma e só é liberado para o prestador após a conclusão e sua aprovação!\n" +
      "4. ⭐ **Avaliação Real:** Você avalia o atendimento recebido ajudando a manter a qualidade da comunidade.\n\n" +
      "Quer que eu te recomende profissionais para algum serviço agora?"
    )
  }

  // 4. Eletricista / Elétrica
  if (
    /eletric|chuveiro|fiacao|tomada|disjuntor|curto|cemig|quadro de forca|lampada|ventilador de teto/i.test(
      norm,
    ) ||
    (/quanto custa|preco|valor/i.test(norm) && /eletric/i.test(prevNorm))
  ) {
    return (
      "Temos excelentes **Eletricistas Verificados** em Governador Valadares prontos para te atender!\n\n" +
      "⚡ **Serviços atendidos:** Troca de resistência e instalação de chuveiro, fiação elétrica, instalação de tomadas e interruptores, disjuntores, padrões CEMIG, luminárias e reparos em quadros de distribuição.\n\n" +
      "💰 **Valores de referência:**\n" +
      "• Troca/instalação de chuveiro ou tomadas: R$ 60 a R$ 120\n" +
      "• Troca de disjuntor ou reparo de curto: R$ 80 a R$ 180\n" +
      "• Revisão completa ou instalação de quadro: R$ 250 a R$ 600\n\n" +
      "👉 Você pode filtrar a categoria **Elétrica** na barra de categorias da vitrine para ver os profissionais mais próximos da sua região!"
    )
  }

  // 5. Encanador / Hidráulica / Vazamentos
  if (
    /encanad|hidraul|vazamento|cano|torneira|desentup|infiltracao|sifao|caixa d'?agua|registro|esgoto/i.test(
      norm,
    ) ||
    (/quanto custa|preco|valor/i.test(norm) && /encanad|hidraul/i.test(prevNorm))
  ) {
    return (
      "Precisa de um **Encanador**? Nossa equipe de parceiros atende serviços emergenciais e de rotina em toda GV!\n\n" +
      "🔧 **Principais atendimentos:** Conserto de vazamentos, troca de torneiras e registros, desentupimento de ralos e pias, instalação de louças e limpeza/instalação de caixa d'água.\n\n" +
      "💰 **Valores médios:**\n" +
      "• Troca de torneira, sifão ou reparo simples: R$ 70 a R$ 140\n" +
      "• Desentupimento padrão: R$ 90 a R$ 220\n" +
      "• Localização e reparo de vazamento embutido: a partir de R$ 150 (sob visita técnica)\n\n" +
      "👉 Acesse a categoria **Hidráulica** para solicitar um orçamento rápido e tirar dúvidas diretamente pelo chat!"
    )
  }

  // 6. Pintor / Pintura
  if (
    /pint|massa corrida|textura|verniz|emassar|parede/i.test(norm) ||
    (/quanto custa|preco|valor/i.test(norm) && /pint/i.test(prevNorm))
  ) {
    return (
      "Na categoria **Pintura**, você encontra pintores residenciais e comerciais com portfólio comprovado!\n\n" +
      "🎨 **Serviços:** Pintura interna e externa, aplicação de massa corrida ou acrílica, efeitos decorativos (cimento queimado, textura), lixamento e pintura de portas/portões.\n\n" +
      "💡 **Como funciona o preço:** Geralmente os pintores orçam por diária (média de R$ 140 a R$ 230 por dia para o profissional) ou por m² (R$ 15 a R$ 35/m² dependendo do acabamento).\n\n" +
      "Você pode enviar fotos do espaço na conversa com o prestador para receber um orçamento bem detalhado!"
    )
  }

  // 7. Diarista / Limpeza / Faxina
  if (
    /diarista|faxina|limpeza|passadeira|faxineira|pos obra/i.test(norm) ||
    (/quanto custa|preco|valor/i.test(norm) && /diarista|faxina|limpeza/i.test(prevNorm))
  ) {
    return (
      "Temos profissionais de **Limpeza e Diaristas** rigorosamente verificadas para cuidar da sua casa ou escritório!\n\n" +
      "🧹 **Modalidades disponíveis:**\n" +
      "• **Faxina Padrão:** Manutenção do dia a dia, limpeza de cômodos, pisos e banheiros.\n" +
      "• **Limpeza Pesada:** Higienização profunda de azulejos, vidros, armários e eletrodomésticos.\n" +
      "• **Limpeza Pós-Obra:** Remoção de resíduos de tinta, rejunte e poeira fina.\n\n" +
      "💰 As diárias em Governador Valadares costumam variar entre R$ 130 e R$ 220 (mais transporte), dependendo do tamanho do imóvel e das tarefas solicitadas."
    )
  }

  // 8. Pedreiro / Alvenaria / Reformas
  if (
    /pedreiro|alvenaria|reforma|piso|azulejo|porcelanato|reboco|contrapiso|muro|assentar/i.test(
      norm,
    ) ||
    (/quanto custa|preco|valor/i.test(norm) && /pedreiro|alvenaria/i.test(prevNorm))
  ) {
    return (
      "Para obras e reformas, o Severinno conta com **Pedreiros e Mestres de Obras** experientes em Governador Valadares.\n\n" +
      "🏗️ **Atendimentos:** Assentamento de pisos e porcelanatos, reboco, levantamento de paredes, consertos estruturais, colocação de bancadas e pequenas reformas residenciais.\n\n" +
      "💡 Para serviços de alvenaria, o mais recomendado é solicitar uma visita técnica sem compromisso para medição e levantamento de materiais."
    )
  }

  // 9. Ar-condicionado / Refrigeração
  if (/ar condicionado|ar-condicionado|climatizacao|refrigeracao|split/i.test(norm)) {
    return (
      "Com o clima de Governador Valadares, o ar-condicionado é indispensável! Temos técnicos especializados em **Climatização e Refrigeração**.\n\n" +
      "❄️ **Serviços mais pedidos:**\n" +
      "• Higienização e limpeza completa com bactericida: R$ 120 a R$ 200\n" +
      "• Instalação de ar Split (até 12.000 BTUs): R$ 250 a R$ 450\n" +
      "• Carga de gás e diagnóstico de vazamento: R$ 150 a R$ 280\n\n" +
      "Consulte nossos técnicos verificados diretamente na vitrine para agendar um atendimento rápido!"
    )
  }

  // 10. Marido de Aluguel / Reparos Gerais / Chaveiro / Montador
  if (
    /marido de aluguel|pequenos reparos|chaveiro|montador|fechadura|cortina|varal|pendurar quadro|moveis/i.test(
      norm,
    )
  ) {
    return (
      "Para aqueles consertos rápidos e instalações do dia a dia, temos especialistas em **Pequenos Reparos e Montagem**!\n\n" +
      "🔨 Montagem e desmontagem de móveis, instalação de cortinas, persianas, suportes de TV, espelhos, varais de teto e troca de fechaduras.\n\n" +
      "💰 Esses serviços costumam ser combinados por hora ou por pacote de itens (média de R$ 70 a R$ 150 para instalações básicas)."
    )
  }

  // 11. Segurança, Garantia e Confiabilidade (É seguro?)
  if (/segur|garantia|confia|golpe|fraude|proteg|reclamac|furto/i.test(norm)) {
    return (
      "Sim, é **100% seguro** contratar pelo Severinno! A segurança é nossa prioridade número um:\n\n" +
      "🛡️ **Verificação de Identidade (KYC):** Todos os prestadores passam por validação de documentos, antecedentes e histórico profissional antes de receberem o selo verificado.\n\n" +
      "🔒 **Custódia Severinno Escrow:** Seu pagamento fica retido com segurança na plataforma. O profissional só recebe após o serviço ser concluído e você aprovar no app!\n\n" +
      "⭐ **Avaliações Auditadas:** Só quem realmente contratou e pagou pode avaliar o prestador, garantindo notas e opiniões reais.\n\n" +
      "Se houver qualquer divergência, nosso time de suporte atua como mediador imparcial."
    )
  }

  // 12. Preços, Orçamentos e Formas de Pagamento
  if (
    /quanto custa|preco|valor|orcamento|pagar|pagamento|pix|cartao|taxa|gratis|gratuito/i.test(norm)
  ) {
    return (
      "No **Severinno**, solicitar orçamentos é **100% gratuito** para os clientes!\n\n" +
      "💳 **Como funciona o pagamento:**\n" +
      "• Aceitamos **PIX** (com aprovação imediata) e **Cartão de Crédito** em até 12x.\n" +
      "• O valor combinado fica protegido no sistema de **Custódia (Escrow)**.\n" +
      "• O prestador realiza o trabalho e você só libera o pagamento após checar que tudo ficou excelente.\n\n" +
      "Sem taxas surpresa ou cobranças indevidas. Transparência total do início ao fim!"
    )
  }

  // 13. Região de Atendimento / Governador Valadares
  if (/valadares|gv|bairro|onde atende|cidade|regiao|localizacao/i.test(norm)) {
    return (
      "Atendemos toda a cidade de **Governador Valadares e municípios vizinhos**!\n\n" +
      "📍 Prestadores ativos nos bairros: Centro, Ilha dos Araújos, Vila Isa, Santa Rita, Grã-Duquesa, São Pedro, Esperança, Castanheiras, Lourdes, São Geraldo e toda a região metropolitana do Vale do Rio Doce.\n\n" +
      "Você pode usar o seletor de **Raio de Distância (km)** no topo da página para priorizar profissionais que estejam bem perto da sua localização!"
    )
  }

  // 14. Suporte / Atendimento Humano
  if (/humano|atendente|suporte|falar com alguem|telefone|whatsapp/i.test(norm)) {
    return (
      "Você pode falar diretamente com os prestadores pelo chat e WhatsApp da plataforma a qualquer momento!\n\n" +
      "Se precisar de suporte administrativo com a equipe Severinno sobre pedidos, pagamentos ou cancelamentos, envie uma mensagem para nosso canal de atendimento:\n" +
      "📧 **E-mail:** suporte@severinno.com.br\n" +
      "💬 Ou utilize a opção **Ajuda** no menu da sua conta."
    )
  }

  // 15. Resposta Geral Contextual
  return (
    "Entendi perfeitamente! No **Severinno**, conectamos você aos melhores prestadores de serviço de Governador Valadares com verificação e pagamento protegido.\n\n" +
    "Principais áreas que atendemos:\n" +
    "• ⚡ **Elétrica:** Chuveiros, tomadas, fiação e quadros\n" +
    "• 🔧 **Hidráulica:** Vazamentos, desentupimentos e canos\n" +
    "• 🎨 **Pintura:** Residencial, comercial e texturas\n" +
    "• 🧹 **Limpeza:** Diaristas e pós-obra\n" +
    "• 🏗️ **Alvenaria:** Pedreiros, reformas e pisos\n\n" +
    "Você pode navegar pelas categorias na vitrine ou me dizer exatamente o que precisa reparar ou instalar que eu te guio!"
  )
}
