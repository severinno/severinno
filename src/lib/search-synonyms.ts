/**
 * search-synonyms.ts — Dicionário de Sinônimos Populares & Busca Preditiva Coloquial
 *
 * Mapeia termos do cotidiano do cliente brasileiro ("chuveiro queimado", "pia vazando",
 * "trocar disjuntor", "limpeza pós-obra", "chave emperrada") para as categorias,
 * subcategorias e especialidades canônicas correspondentes.
 */

export type SynonymSuggestion = {
  keyword: string
  normalized: string
  targetCategorySlug: string
  targetCategoryName: string
  macroDomainSlug: string
  macroDomainName: string
  exampleServices: string[]
}

export const POPULAR_SYNONYMS: SynonymSuggestion[] = [
  // ELÉTRICA / REPAROS
  {
    keyword: "chuveiro queimado",
    normalized: "chuveiro queimado",
    targetCategorySlug: "eletrica",
    targetCategoryName: "Elétrica & Instalações",
    macroDomainSlug: "reparos-e-instalacoes",
    macroDomainName: "Reparos e Instalações",
    exampleServices: ["Troca de Resistência de Chuveiro", "Instalação de Chuveiro Elétrico"],
  },
  {
    keyword: "disjuntor caindo",
    normalized: "disjuntor caindo",
    targetCategorySlug: "eletrica",
    targetCategoryName: "Elétrica & Instalações",
    macroDomainSlug: "reparos-e-instalacoes",
    macroDomainName: "Reparos e Instalações",
    exampleServices: ["Troca e Dimensionamento de Disjuntor", "Revisão do Quadro de Luz"],
  },
  {
    keyword: "trocar tomada",
    normalized: "trocar tomada",
    targetCategorySlug: "eletrica",
    targetCategoryName: "Elétrica & Instalações",
    macroDomainSlug: "reparos-e-instalacoes",
    macroDomainName: "Reparos e Instalações",
    exampleServices: ["Instalação de Tomadas 10A/20A", "Troca de Interruptores"],
  },

  // HIDRÁULICA / REPAROS
  {
    keyword: "vazamento pia",
    normalized: "vazamento pia",
    targetCategorySlug: "hidraulica",
    targetCategoryName: "Hidráulica & Encanamento",
    macroDomainSlug: "reparos-e-instalacoes",
    macroDomainName: "Reparos e Instalações",
    exampleServices: ["Reparo de Sifão e Válvula de Pia", "Eliminação de Vazamentos"],
  },
  {
    keyword: "torneira pingando",
    normalized: "torneira pingando",
    targetCategorySlug: "hidraulica",
    targetCategoryName: "Hidráulica & Encanamento",
    macroDomainSlug: "reparos-e-instalacoes",
    macroDomainName: "Reparos e Instalações",
    exampleServices: ["Troca de Carrapeta/Reparo de Torneira", "Instalação de Torneira Gourmet"],
  },
  {
    keyword: "vaso entupido",
    normalized: "vaso entupido",
    targetCategorySlug: "emergencia-24h",
    targetCategoryName: "Emergência 24h & Desentupimento",
    macroDomainSlug: "emergencia-24h",
    macroDomainName: "Emergência 24h",
    exampleServices: ["Desentupimento Mecânico de Vaso", "Desentupimento de Ralos e Esgoto"],
  },

  // LIMPEZA / CASA
  {
    keyword: "faxina pesada",
    normalized: "faxina pesada",
    targetCategorySlug: "limpeza-e-casa",
    targetCategoryName: "Limpeza Residencial & Diarista",
    macroDomainSlug: "limpeza-e-casa",
    macroDomainName: "Limpeza e Casa",
    exampleServices: ["Diária Completa Residencial", "Limpeza Pesada e Desinfecção"],
  },
  {
    keyword: "faxina pós-obra",
    normalized: "faxina pos obra",
    targetCategorySlug: "limpeza-e-casa",
    targetCategoryName: "Limpeza Pós-Obra",
    macroDomainSlug: "limpeza-e-casa",
    macroDomainName: "Limpeza e Casa",
    exampleServices: ["Limpeza Fina Pós-Obra", "Remoção de Respingos e Rejunte"],
  },
  {
    keyword: "lavar sofa",
    normalized: "lavar sofa",
    targetCategorySlug: "limpeza-e-casa",
    targetCategoryName: "Higienização de Estofados",
    macroDomainSlug: "limpeza-e-casa",
    macroDomainName: "Limpeza e Casa",
    exampleServices: ["Higienização e Impermeabilização de Sofá", "Limpeza de Colchões"],
  },

  // PINTURA & ACABAMENTO
  {
    keyword: "pintar parede",
    normalized: "pintar parede",
    targetCategorySlug: "acabamento-e-decoracao",
    targetCategoryName: "Pintura & Acabamento",
    macroDomainSlug: "acabamento-e-decoracao",
    macroDomainName: "Acabamento e Decoração",
    exampleServices: ["Pintura Interna Látex/Acrílica", "Aplicação de Massa Corrida"],
  },
  {
    keyword: "colocar cortina",
    normalized: "colocar cortina",
    targetCategorySlug: "reparos-e-instalacoes",
    targetCategoryName: "Pequenos Reparos (Marido de Aluguel)",
    macroDomainSlug: "reparos-e-instalacoes",
    macroDomainName: "Reparos e Instalações",
    exampleServices: [
      "Instalação de Varão e Trilho de Cortina",
      "Fixação de Prateleiras e Quadros",
    ],
  },

  // JARDIM & PISCINA
  {
    keyword: "cortar grama",
    normalized: "cortar grama",
    targetCategorySlug: "jardim-e-piscina",
    targetCategoryName: "Jardinagem & Poda",
    macroDomainSlug: "jardim-e-piscina",
    macroDomainName: "Jardim e Piscina",
    exampleServices: ["Poda e Corte de Gramado", "Manutenção de Canteiros e Jardim"],
  },
  {
    keyword: "limpar piscina",
    normalized: "limpar piscina",
    targetCategorySlug: "jardim-e-piscina",
    targetCategoryName: "Tratamento de Piscinas",
    macroDomainSlug: "jardim-e-piscina",
    macroDomainName: "Jardim e Piscina",
    exampleServices: ["Aspiração e Controle de Cloro/pH", "Limpeza Física e Decantação"],
  },

  // MUDANÇA / FRETE
  {
    keyword: "fazer frete",
    normalized: "fazer frete",
    targetCategorySlug: "mudanca-e-organizacao",
    targetCategoryName: "Fretes & Carretos",
    macroDomainSlug: "mudanca-e-organizacao",
    macroDomainName: "Mudança e Organização",
    exampleServices: ["Pequenos Carretos Urbanos em GV", "Transporte com Ajudante"],
  },

  // EMERGÊNCIA 24H
  {
    keyword: "chaveiro urgente",
    normalized: "chaveiro urgente",
    targetCategorySlug: "emergencia-24h",
    targetCategoryName: "Chaveiro 24 Horas",
    macroDomainSlug: "emergencia-24h",
    macroDomainName: "Emergência 24h",
    exampleServices: ["Abertura Residencial de Emergência", "Troca Imediata de Fechadura"],
  },
  {
    keyword: "porta trancada",
    normalized: "porta trancada",
    targetCategorySlug: "emergencia-24h",
    targetCategoryName: "Chaveiro 24 Horas",
    macroDomainSlug: "emergencia-24h",
    macroDomainName: "Emergência 24h",
    exampleServices: ["Destravamento de Porta sem Danos", "Cópia e Troca de Segredo"],
  },
]

/**
 * Busca sugestões preditivas com base no texto digitado pelo usuário.
 */
export function matchSynonymSuggestions(input: string, maxResults = 4): SynonymSuggestion[] {
  if (!input || input.trim().length < 2) return []
  const cleanInput = input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, " ")
    .replace(/\s+/g, " ")
    .trim()

  const words = cleanInput.split(/\s+/).filter((w) => w.length >= 2)

  return POPULAR_SYNONYMS.filter((s) => {
    const sNorm = s.normalized.replace(/[^a-z0-9]/g, " ")
    // Casamento exato ou por substring no termo normalizado
    if (sNorm.includes(cleanInput) || cleanInput.includes(sNorm)) {
      return true
    }
    // Casamento se qualquer palavra-chave relevante bater
    return words.some(
      (w) => w.length >= 3 && (sNorm.includes(w) || s.keyword.toLowerCase().includes(w)),
    )
  }).slice(0, maxResults)
}
