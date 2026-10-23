/**
 * engine.ts — Motor de Inteligência e Contexto Regional da Severinno.
 *
 * Mapeia e adapta a vitrine para qualquer estado/cidade do Brasil:
 * - Timezone real (com conversão solar UTC-2 a UTC-5)
 * - Condição climática e meteorológica inteligente
 * - Tom de voz, costumes e vocabulário regional
 * - Bairros de referência locais para simulação de preços
 * - Integração com eventos vivos da plataforma
 */

import { detectBrazilianTimezone, type BrazilianTimezone } from "@/lib/geo-timezone-pure"
import type {
  MacroRegion,
  WeatherCondition,
  SolarPeriod,
  RegionalTone,
  CityHubProfile,
  WeatherTriggerConfig,
  PlatformCityEventMetrics,
  RegionalContext,
} from "./types"

// ── 1. Mapeamento de Estados para Macro-Regiões ────────────────────────────

const STATE_TO_MACRO_REGION: Record<string, MacroRegion> = {
  // Sudeste
  MG: "sudeste",
  SP: "sudeste",
  RJ: "sudeste",
  ES: "sudeste",
  // Nordeste
  BA: "nordeste",
  PE: "nordeste",
  CE: "nordeste",
  RN: "nordeste",
  PB: "nordeste",
  AL: "nordeste",
  SE: "nordeste",
  PI: "nordeste",
  MA: "nordeste",
  // Sul
  RS: "sul",
  SC: "sul",
  PR: "sul",
  // Centro-Oeste
  GO: "centro-oeste",
  MT: "centro-oeste",
  MS: "centro-oeste",
  DF: "centro-oeste",
  // Norte
  AM: "norte",
  PA: "norte",
  RO: "norte",
  AC: "norte",
  RR: "norte",
  AP: "norte",
  TO: "norte",
}

// ── 2. Perfis de Cidades-Polo e Capitais com Bairros Reais ─────────────────

export const CITY_HUBS: Record<string, CityHubProfile> = {
  "governador-valadares": {
    id: "governador-valadares",
    name: "Governador Valadares",
    state: "MG",
    macroRegion: "sudeste",
    timezone: "America/Sao_Paulo",
    defaultNeighborhoods: [
      "Centro",
      "Ilha dos Araújos",
      "Grã-Duquesa",
      "São Pedro",
      "Vila Isa",
      "Santa Rita",
      "Esplanada",
      "Lourdes",
      "Morada do Vale",
      "Esperança",
      "Vila Bretas",
      "Altinópolis",
    ],
    climateTendency: "heatwave", // GV é historicamente muito quente (36-40°C no verão)
    typicalEmergencyServices: [
      "Técnico de Ar-Condicionado",
      "Eletricista Residencial",
      "Chaveiro 24h",
    ],
  },
  "belo-horizonte": {
    id: "belo-horizonte",
    name: "Belo Horizonte",
    state: "MG",
    macroRegion: "sudeste",
    timezone: "America/Sao_Paulo",
    defaultNeighborhoods: [
      "Savassi",
      "Lourdes",
      "Buritis",
      "Pampulha",
      "Sion",
      "Funcionários",
      "Castelo",
      "Belvedere",
      "Serra",
      "Anchieta",
    ],
    climateTendency: "temperate",
    typicalEmergencyServices: ["Desentupidora", "Eletricista Predial", "Encanador 24h"],
  },
  ipatinga: {
    id: "ipatinga",
    name: "Ipatinga",
    state: "MG",
    macroRegion: "sudeste",
    timezone: "America/Sao_Paulo",
    defaultNeighborhoods: [
      "Horto",
      "Canaã",
      "Bom Retiro",
      "Cariru",
      "Iguaçu",
      "Veneza",
      "Cidade Nobre",
      "Ideal",
    ],
    climateTendency: "heatwave",
    typicalEmergencyServices: ["Ar-Condicionado", "Eletricista", "Pintor"],
  },
  vitoria: {
    id: "vitoria",
    name: "Vitória",
    state: "ES",
    macroRegion: "sudeste",
    timezone: "America/Sao_Paulo",
    defaultNeighborhoods: [
      "Praia do Canto",
      "Jardim da Penha",
      "Mata da Praia",
      "Jardim Camburi",
      "Enseada do Suá",
      "Centro",
      "Bento Ferreira",
    ],
    climateTendency: "heatwave",
    typicalEmergencyServices: ["Manutenção Predial & Maresia", "Ar-Condicionado", "Encanador"],
  },
  "sao-paulo": {
    id: "sao-paulo",
    name: "São Paulo",
    state: "SP",
    macroRegion: "sudeste",
    timezone: "America/Sao_Paulo",
    defaultNeighborhoods: [
      "Pinheiros",
      "Moema",
      "Vila Mariana",
      "Perdizes",
      "Tatuapé",
      "Bela Vista",
      "Itaim Bibi",
      "Santana",
      "Morumbi",
    ],
    climateTendency: "rainstorm",
    typicalEmergencyServices: ["Desentupimento & Esgoto", "Eletricista 24h", "Chaveiro Rápido"],
  },
  "rio-de-janeiro": {
    id: "rio-de-janeiro",
    name: "Rio de Janeiro",
    state: "RJ",
    macroRegion: "sudeste",
    timezone: "America/Sao_Paulo",
    defaultNeighborhoods: [
      "Tijuca",
      "Copacabana",
      "Botafogo",
      "Barra da Tijuca",
      "Méier",
      "Flamengo",
      "Recreio",
      "Ipanema",
      "Campo Grande",
    ],
    climateTendency: "heatwave",
    typicalEmergencyServices: ["Ar-Condicionado Split", "Eletricista", "Chaveiro 24h"],
  },
  salvador: {
    id: "salvador",
    name: "Salvador",
    state: "BA",
    macroRegion: "nordeste",
    timezone: "America/Sao_Paulo",
    defaultNeighborhoods: [
      "Pituba",
      "Barra",
      "Rio Vermelho",
      "Brotas",
      "Caminho das Árvores",
      "Itaigara",
      "Graça",
      "Imbuí",
      "Cabula",
    ],
    climateTendency: "heatwave",
    typicalEmergencyServices: [
      "Ar-Condicionado & Ventilação",
      "Proteção Contra Maresia",
      "Eletricista",
    ],
  },
  recife: {
    id: "recife",
    name: "Recife",
    state: "PE",
    macroRegion: "nordeste",
    timezone: "America/Sao_Paulo",
    defaultNeighborhoods: [
      "Boa Viagem",
      "Madalena",
      "Casa Forte",
      "Espinheiro",
      "Graças",
      "Pina",
      "Torre",
      "Candeias",
    ],
    climateTendency: "rainstorm",
    typicalEmergencyServices: ["Impermeabilização & Calhas", "Ar-Condicionado", "Encanador"],
  },
  curitiba: {
    id: "curitiba",
    name: "Curitiba",
    state: "PR",
    macroRegion: "sul",
    timezone: "America/Sao_Paulo",
    defaultNeighborhoods: [
      "Batel",
      "Bigorrilho",
      "Água Verde",
      "Portão",
      "Mercês",
      "Cabral",
      "Juvevê",
      "Santa Felicidade",
    ],
    climateTendency: "coldfront",
    typicalEmergencyServices: ["Aquecedor a Gás", "Resistência de Chuveiro", "Revisão Elétrica"],
  },
  "porto-alegre": {
    id: "porto-alegre",
    name: "Porto Alegre",
    state: "RS",
    macroRegion: "sul",
    timezone: "America/Sao_Paulo",
    defaultNeighborhoods: [
      "Moinhos de Vento",
      "Petrópolis",
      "Menino Deus",
      "Bela Vista",
      "Cidade Baixa",
      "Mont'Serrat",
      "Higienópolis",
    ],
    climateTendency: "coldfront",
    typicalEmergencyServices: ["Telhados & Calhas", "Aquecedores", "Eletricista"],
  },
  brasilia: {
    id: "brasilia",
    name: "Brasília",
    state: "DF",
    macroRegion: "centro-oeste",
    timezone: "America/Sao_Paulo",
    defaultNeighborhoods: [
      "Asa Sul",
      "Asa Norte",
      "Águas Claras",
      "Sudoeste",
      "Lago Sul",
      "Guará",
      "Noroeste",
      "Taguatinga",
    ],
    climateTendency: "dryspell",
    typicalEmergencyServices: ["Higienização de Sofás & Tapetes", "Ar-Condicionado", "Pintura"],
  },
  cuiaba: {
    id: "cuiaba",
    name: "Cuiabá",
    state: "MT",
    macroRegion: "centro-oeste",
    timezone: "America/Cuiaba", // UTC-4
    defaultNeighborhoods: [
      "Goiabeiras",
      "Santa Rosa",
      "Bosque da Saúde",
      "Araés",
      "Quilombo",
      "Jardim das Américas",
      "Consil",
    ],
    climateTendency: "heatwave",
    typicalEmergencyServices: ["Ar-Condicionado", "Manutenção de Refrigeração", "Eletricista"],
  },
  manaus: {
    id: "manaus",
    name: "Manaus",
    state: "AM",
    macroRegion: "norte",
    timezone: "America/Manaus", // UTC-4
    defaultNeighborhoods: [
      "Adrianópolis",
      "Ponta Negra",
      "Vieiralves",
      "Parque 10 de Novembro",
      "Flores",
      "Aleixo",
      "Chapada",
    ],
    climateTendency: "heatwave",
    typicalEmergencyServices: [
      "Ar-Condicionado Inverter",
      "Controle de Mofo e Umidade",
      "Eletricista",
    ],
  },
}

// ── 3. Tom de Voz e Comunicação Regional ("A Cara do Cliente") ──────────────

export const REGIONAL_TONES: Record<MacroRegion, RegionalTone> = {
  sudeste: {
    region: "sudeste",
    greetingPrefix: "O que você precisa resolver hoje?",
    headlineSuffix: "perto de você, sem enrolação.",
    trustStatement: "Preço justo, serviço bem feito e pagamento seguro na custódia.",
    emergencyBadge: "🚨 Plantão Rápido na Sua Cidade",
    colloquialTerms: ["uai", "sô", "trabalho caprichado", "sem dor de cabeça"],
  },
  nordeste: {
    region: "nordeste",
    greetingPrefix: "O que você precisa ajeitar hoje?",
    headlineSuffix: "com profissionais arretados e de confiança.",
    trustStatement: "Serviço de primeira, com garantia blindada do início ao fim.",
    emergencyBadge: "⚡ Socorro Rápido no Seu Bairro",
    colloquialTerms: ["arretado", "de primeira", "na hora", "confiança total"],
  },
  sul: {
    region: "sul",
    greetingPrefix: "O que você precisa resolver hoje?",
    headlineSuffix: "com pontualidade, qualidade e capricho.",
    trustStatement: "Profissionais verificados, compromisso no horário e garantia total.",
    emergencyBadge: "🛡️ Atendimento Imediato na Região",
    colloquialTerms: ["caprichado", "bem feito", "pontual", "de confiança"],
  },
  "centro-oeste": {
    region: "centro-oeste",
    greetingPrefix: "O que você quer consertar ou renovar hoje?",
    headlineSuffix: "com rapidez e preço transparente.",
    trustStatement: "Profissionais avaliados perto de você com pagamento após o serviço.",
    emergencyBadge: "🚨 Plantão Ágil na Cidade",
    colloquialTerms: ["rápido", "garantido", "sem complicação"],
  },
  norte: {
    region: "norte",
    greetingPrefix: "Qual serviço você precisa para sua casa hoje?",
    headlineSuffix: "com atendimento ágil e seguro.",
    trustStatement: "Garantia de custódia Severinno: você só paga depois de tudo pronto.",
    emergencyBadge: "⚡ Plantão Emergencial Ativo",
    colloquialTerms: ["ágil", "seguro", "de confiança"],
  },
}

// ── 4. Gatilhos Climáticos e Meteorológicos ───────────────────────────────

export const WEATHER_CONFIGS: Record<WeatherCondition, WeatherTriggerConfig> = {
  heatwave: {
    condition: "heatwave",
    badge: "☀️ Calor Intenso na Sua Região",
    headlinePrefix: "Altas temperaturas hoje?",
    highlightText: "Técnicos de ar e refrigeração prontos para atender.",
    subtext:
      "Limpeza de filtros, recarga de gás e manutenção de freezers e geladeiras com atendimento rápido no seu bairro.",
    priorityServices: [
      {
        id: "ar-condicionado",
        title: "Técnico de Ar-Condicionado",
        categorySlug: "reparos-e-instalacoes",
        avgPrice: 150,
        unit: "serviço",
        badge: "🔥 Mais Solicitado no Calor",
      },
      {
        id: "refrigeracao",
        title: "Conserto de Geladeira & Freezer",
        categorySlug: "reparos-e-instalacoes",
        avgPrice: 130,
        unit: "visita/reparo",
        badge: "⚡ Urgente",
      },
      {
        id: "ventilador-teto",
        title: "Instalação de Ventilador de Teto",
        categorySlug: "reparos-e-instalacoes",
        avgPrice: 90,
        unit: "ponto",
        badge: "💨 Pronta Entrega",
      },
      {
        id: "piscina",
        title: "Limpeza & Tratamento de Piscina",
        categorySlug: "limpeza-e-casa",
        avgPrice: 120,
        unit: "diária",
        badge: "💦 Alta Procura",
      },
    ],
  },
  rainstorm: {
    condition: "rainstorm",
    badge: "🌧️ Alerta de Chuvas & Temporais",
    headlinePrefix: "Goteiras, vazamentos ou curto-circuito?",
    highlightText: "Plantão de emergência para chuvas e temporais.",
    subtext:
      "Encanadores, desentupidoras e eletricistas com chegada rápida para conter infiltrações e restabelecer sua energia.",
    priorityServices: [
      {
        id: "desentupidora",
        title: "Desentupimento de Ralos & Esgoto",
        categorySlug: "emergencia-24h",
        avgPrice: 140,
        unit: "ponto",
        badge: "🚨 Plantão Chuva",
      },
      {
        id: "telhado-calhas",
        title: "Reparo de Telhado & Calhas",
        categorySlug: "reforma-e-construcao",
        avgPrice: 180,
        unit: "serviço",
        badge: "💧 Anti-Infiltração",
      },
      {
        id: "curto-circuito",
        title: "Eletricista de Emergência",
        categorySlug: "emergencia-24h",
        avgPrice: 120,
        unit: "atendimento",
        badge: "⚡ Chegada em 30 min",
      },
      {
        id: "bomba-dreno",
        title: "Conserto de Bombas de Drenagem",
        categorySlug: "reparos-e-instalacoes",
        avgPrice: 160,
        unit: "serviço",
        badge: "🛡️ Garantido",
      },
    ],
  },
  coldfront: {
    condition: "coldfront",
    badge: "❄️ Queda de Temperatura",
    headlinePrefix: "Chuveiro queimou ou aquecedor falhou?",
    highlightText: "Eletricistas e técnicos com atendimento no mesmo dia.",
    subtext:
      "Troca de resistência de chuveiros, revisão de tomadas de alta potência e manutenção de aquecedores a gás.",
    priorityServices: [
      {
        id: "resistencia-chuveiro",
        title: "Troca de Resistência de Chuveiro",
        categorySlug: "emergencia-24h",
        avgPrice: 70,
        unit: "ponto",
        badge: "🚿 Atendimento Hoje",
      },
      {
        id: "aquecedor-gas",
        title: "Manutenção de Aquecedor a Gás",
        categorySlug: "reparos-e-instalacoes",
        avgPrice: 180,
        unit: "revisão",
        badge: "🔥 Segurança Checada",
      },
      {
        id: "eletrica-geral",
        title: "Revisão Elétrica de Circuitos",
        categorySlug: "reparos-e-instalacoes",
        avgPrice: 110,
        unit: "circuito",
        badge: "⚡ Sem Riscos",
      },
    ],
  },
  dryspell: {
    condition: "dryspell",
    badge: "💨 Tempo Seco & Baixa Umidade",
    headlinePrefix: "Proteja sua família contra poeira e ácaros:",
    highlightText: "Higienização profunda de estofados e tapetes.",
    subtext:
      "Remova ácaros e alérgenos de colchões, sofás e cortinas com equipamento de extração e secagem rápida no local.",
    priorityServices: [
      {
        id: "sofas-colchoes",
        title: "Higienização de Sofás & Colchões",
        categorySlug: "acabamento-e-decoracao",
        avgPrice: 160,
        unit: "unidade",
        badge: "✨ Saúde Respiratória",
      },
      {
        id: "limpeza-pos-obra",
        title: "Limpeza Pós-Obra & Fachada",
        categorySlug: "limpeza-e-casa",
        avgPrice: 220,
        unit: "diária",
        badge: "🧹 Poeira Zero",
      },
      {
        id: "pintura-externa",
        title: "Pintura Externa & Selador",
        categorySlug: "reforma-e-construcao",
        avgPrice: 190,
        unit: "diária",
        badge: "☀️ Clima Ideal",
      },
    ],
  },
  temperate: {
    condition: "temperate",
    badge: "⭐ Marketplace de Serviços Verificados",
    headlinePrefix: "Prestadores de serviço verificados,",
    highlightText: "perto de você.",
    subtext:
      "Compare avaliações reais, peça orçamento grátis e agende — encanador, eletricista, pintor e mais. Você escolhe o profissional.",
    priorityServices: [
      {
        id: "reparos-instalacoes",
        title: "Reparos & Instalações Rápidas",
        categorySlug: "reparos-e-instalacoes",
        avgPrice: 90,
        unit: "serviço",
        badge: "🔧 Dia a Dia",
      },
      {
        id: "diarista",
        title: "Diarista & Faxina Residencial",
        categorySlug: "limpeza-e-casa",
        avgPrice: 150,
        unit: "diária",
        badge: "🏠 Casa Limpa",
      },
      {
        id: "chaveiro",
        title: "Chaveiro Residencial & Auto",
        categorySlug: "emergencia-24h",
        avgPrice: 80,
        unit: "abertura",
        badge: "🔑 24 Horas",
      },
    ],
  },
}

// ── 5. Utilitário de Cálculo do Fuso e Período Solar ────────────────────────

export function calculateLocalSolarContext(
  date: Date = new Date(),
  timezone: BrazilianTimezone = "America/Sao_Paulo",
): {
  solarPeriod: SolarPeriod
  localTimeString: string
  hours: number
  isWeekend: boolean
} {
  // Formatador com fuso local IANA
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour12: false,
    hour: "numeric",
    minute: "numeric",
    weekday: "short",
  })

  const parts = formatter.formatToParts(date)
  const hourPart = parts.find((p) => p.type === "hour")?.value ?? "12"
  const minutePart = parts.find((p) => p.type === "minute")?.value ?? "00"
  const weekdayPart = parts.find((p) => p.type === "weekday")?.value ?? "Mon"

  const hours = parseInt(hourPart, 10)
  const isWeekend = weekdayPart === "Sat" || weekdayPart === "Sun"

  let solarPeriod: SolarPeriod
  if (hours >= 18 || hours < 6) {
    solarPeriod = "night_emergency"
  } else if (isWeekend) {
    solarPeriod = "weekend"
  } else if (hours < 12) {
    solarPeriod = "morning"
  } else {
    solarPeriod = "afternoon"
  }

  const localTimeString = `${hourPart.padStart(2, "0")}:${minutePart.padStart(2, "0")}`

  return { solarPeriod, localTimeString, hours, isWeekend }
}

// ── 6. Resolução do Contexto Regional Completo ──────────────────────────────

export type ResolveRegionalOptions = {
  lat?: number | null
  lng?: number | null
  city?: string | null
  state?: string | null
  forcedWeather?: WeatherCondition
  platformEvents?: Partial<PlatformCityEventMetrics>
}

export function resolveRegionalContext(options: ResolveRegionalOptions = {}): RegionalContext {
  const { lat, lng, city: rawCity, state: rawState, forcedWeather, platformEvents } = options

  // 1. Detectar Timezone preciso por coordenadas geográficas
  let timezone: BrazilianTimezone = "America/Sao_Paulo"
  if (typeof lat === "number" && typeof lng === "number") {
    timezone = detectBrazilianTimezone(lat, lng).timezone
  }

  // 2. Resolver Cidade e Estado
  let city = rawCity?.trim() || "Governador Valadares"
  let state = (rawState?.trim().toUpperCase() || "MG").slice(0, 2)

  // Normalizar slug de busca de cidade
  const citySlug = city
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "-")
    .replace(/-+/g, "-")

  const hubProfile = CITY_HUBS[citySlug]
  if (hubProfile) {
    city = hubProfile.name
    state = hubProfile.state
    timezone = hubProfile.timezone
  }

  // 3. Resolver Macro-Região
  const macroRegion: MacroRegion =
    hubProfile?.macroRegion || STATE_TO_MACRO_REGION[state] || "sudeste"

  // 4. Calcular contexto solar no fuso horário real do cliente
  const solar = calculateLocalSolarContext(new Date(), timezone)

  // 5. Determinar Condição Climática
  const weather: WeatherCondition = forcedWeather || hubProfile?.climateTendency || "temperate"
  // Se for à noite, a urgência noturna tem prioridade operacional
  const isNight = solar.solarPeriod === "night_emergency"
  const weatherConfig = WEATHER_CONFIGS[weather] || WEATHER_CONFIGS.temperate
  const tone = REGIONAL_TONES[macroRegion] || REGIONAL_TONES.sudeste

  // 6. Formular Headings e Micro-copys com persuasão e tom regional
  let heroHeadline = `${tone.greetingPrefix}`
  let heroHighlight = `${weatherConfig.highlightText}`
  let heroSubtext = weatherConfig.subtext
  let weatherBadge = weatherConfig.badge

  if (isNight) {
    weatherBadge = `🌙 Plantão Noturno & Emergência em ${city}`
    heroHeadline = `Precisa de conserto urgente agora à noite em ${city}?`
    heroHighlight = `Plantão chega em até 30 min.`
    heroSubtext = `Chaveiros, eletricistas e encanadores de prontidão com chegada rápida e pagamento seguro pela plataforma.`
  } else if (solar.solarPeriod === "weekend") {
    weatherBadge = `☀️ Atendimento de Fim de Semana em ${city}`
    heroHeadline = `Serviços e reparos no fim de semana em ${city},`
    heroHighlight = `com agenda aberta hoje.`
    heroSubtext = `Diaristas, montadores de móveis e técnicos com horários livres para atendimento imediato ou agendamento.`
  } else if (weather !== "temperate") {
    weatherBadge = `${weatherConfig.badge} (${city})`
    heroHeadline = `${weatherConfig.headlinePrefix} em ${city},`
  }

  // 7. Bairros da Cidade
  const neighborhoods = hubProfile?.defaultNeighborhoods || [
    "Centro",
    "Bairro Principal",
    "Zona Sul",
    "Zona Norte",
    "Zona Leste",
    "Zona Oeste",
  ]

  // 8. Eventos da Plataforma
  const finalPlatformEvents: PlatformCityEventMetrics = {
    activeProvidersNearby: platformEvents?.activeProvidersNearby ?? 18,
    bookingsLast24h: platformEvents?.bookingsLast24h ?? 27,
    topTrendingServiceName:
      platformEvents?.topTrendingServiceName ??
      weatherConfig.priorityServices[0]?.title ??
      "Técnico Especializado",
    demandSpike: platformEvents?.demandSpike ?? (weather !== "temperate" || isNight),
    recentSocialProofNotice:
      platformEvents?.recentSocialProofNotice ||
      `Mais de ${platformEvents?.bookingsLast24h ?? 27} serviços agendados em ${city} nas últimas 24h`,
  }

  return {
    city,
    state,
    macroRegion,
    timezone,
    solarPeriod: solar.solarPeriod,
    localTimeString: solar.localTimeString,
    weather,
    weatherBadge,
    heroHeadline,
    heroHighlight,
    heroSubtext,
    neighborhoods,
    tone,
    priorityServiceChips: weatherConfig.priorityServices.map((s) => ({
      id: s.id,
      title: s.title,
      categorySlug: s.categorySlug,
      badge: s.badge,
    })),
    platformEvents: finalPlatformEvents,
  }
}
