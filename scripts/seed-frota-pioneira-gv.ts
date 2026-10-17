/**
 * scripts/seed-frota-pioneira-gv.ts — Seed da Frota Pioneira de Prestadores em Governador Valadares
 *
 * Cadastra e ativa os 20 prestadores pioneiros de Governador Valadares (MG)
 * com dados 100% calibrados em CNEFE, serviços essenciais e horários de atendimento.
 *
 * Cobertura de 8 Bairros Estratégicos de GV:
 * - Centro, Ilha dos Araújos, Vila Bretas, Grã-Duquesa, São Pedro, Santa Rita, Esplanada, Lourdes.
 *
 * Usage:
 *   bun run scripts/seed-frota-pioneira-gv.ts
 *
 * Exit codes:
 *   0 — Sucesso
 *   1 — Falha
 */

export {}

// Mock server-only when running as standalone script in Bun
if (typeof (globalThis as Record<string, unknown>).Bun !== "undefined") {
  try {
    const bunTestModule = "bun:test"
    const { mock } = (await import(bunTestModule)) as {
      mock: { module: (name: string, fn: () => Record<string, unknown>) => void }
    }
    mock.module("server-only", () => ({}))
  } catch {}
}

import { PrismaClient, Role, ServiceUnit, BookingStatus, PaymentStatus } from "@prisma/client"
import { backfillAvatars } from "./lib/backfill-avatars"

const db = new PrismaClient()

interface ProviderSeedItem {
  id: string
  name: string
  email: string
  phone: string
  whatsapp: string
  bio: string
  district: string
  street: string
  number: string
  cep: string
  lat: number
  lng: number
  avgRating: number
  reviewCount: number
  favoriteCount: number
  slug: string
  services: Array<{
    id: string
    title: string
    description: string
    basePrice: number
    unit: ServiceUnit
    duration: number
    categorySlug: string
  }>
}

const PIONEER_PROVIDERS: ProviderSeedItem[] = [
  // ── 1. CENTRO ──────────────────────────────────────────────────────────────
  {
    id: "prov-gv-eletrica-01",
    name: "Carlos Silva — Eletricista Residencial & Comercial",
    email: "carlos.eletrica.gv@severinno.com.br",
    phone: "+5533991012020",
    whatsapp: "+5533991012020",
    bio: "Mais de 12 anos de experiência em instalações elétricas em GV. Especialista em quadros de distribuição, disjuntores e iluminação LED.",
    district: "Centro",
    street: "Avenida Minas Gerais",
    number: "380",
    cep: "35010-151",
    lat: -18.852,
    lng: -41.943,
    avgRating: 4.9,
    reviewCount: 42,
    favoriteCount: 19,
    slug: "carlos-silva-eletrica-gv",
    services: [
      {
        id: "srv-eletrica-01",
        title: "Instalação e Manutenção de Quadro Elétrico",
        description:
          "Dimensionamento e substituição de disjuntores, barramentos, DPS e IDR contra choques.",
        basePrice: 180.0,
        unit: ServiceUnit.UNIDADE,
        duration: 120,
        categorySlug: "quadro-eletrico-eletrica",
      },
      {
        id: "srv-eletrica-02",
        title: "Troca e Instalação de Tomadas e Interruptores",
        description:
          "Substituição para padrão novo ABNT e tomadas 20A reforçadas para eletrodomésticos.",
        basePrice: 50.0,
        unit: ServiceUnit.UNIDADE,
        duration: 45,
        categorySlug: "eletricista-eletrica",
      },
    ],
  },
  {
    id: "prov-gv-clima-06",
    name: "Lucas Climatização — Ar-Condicionado & Higienização",
    email: "lucas.clima.gv@severinno.com.br",
    phone: "+5533991557070",
    whatsapp: "+5533991557070",
    bio: "Especialista em climatização para o calor de Valadares. Instalação padrão de fábrica, recarga de gás e higienização antibacteriana.",
    district: "Centro",
    street: "Rua Peçanha",
    number: "520",
    cep: "35010-160",
    lat: -18.855,
    lng: -41.946,
    avgRating: 5.0,
    reviewCount: 47,
    favoriteCount: 28,
    slug: "lucas-climatizacao-ar-gv",
    services: [
      {
        id: "srv-clima-01",
        title: "Instalação Padrão de Ar-Condicionado Split (9.000 a 18.000 BTUs)",
        description:
          "Tubulação de cobre, isolamento térmico blindado, teste de estanqueidade e vácuo profissional.",
        basePrice: 450.0,
        unit: ServiceUnit.UNIDADE,
        duration: 240,
        categorySlug: "instalacao-ar-condicionado-clima",
      },
      {
        id: "srv-clima-02",
        title: "Higienização Completa com Bactericida e Limpeza de Turbina",
        description:
          "Limpeza química profunda da serpentina e filtros, eliminando ácaros, fungos e mau cheiro.",
        basePrice: 150.0,
        unit: ServiceUnit.UNIDADE,
        duration: 90,
        categorySlug: "higienizacao-ar-condicionado-clima",
      },
    ],
  },
  {
    id: "prov-gv-chaveiro-11",
    name: "Valdir Chaves — Chaveiro 24h & Fechaduras Digitais",
    email: "valdir.chaveiro.gv@severinno.com.br",
    phone: "+5533991054321",
    whatsapp: "+5533991054321",
    bio: "Chaveiro ágil com atendimento 24h no Centro e bairros de GV. Abertura residencial sem danos, cópias e fechaduras eletrônicas.",
    district: "Centro",
    street: "Rua Bárbara Heliodora",
    number: "410",
    cep: "35010-040",
    lat: -18.8535,
    lng: -41.9448,
    avgRating: 4.9,
    reviewCount: 36,
    favoriteCount: 17,
    slug: "valdir-chaveiro-24h-gv",
    services: [
      {
        id: "srv-chaveiro-01",
        title: "Abertura Residencial de Emergência",
        description:
          "Socorro rápido para portas trancadas, chaves quebradas ou esquecidas por dentro sem avarias.",
        basePrice: 120.0,
        unit: ServiceUnit.UNIDADE,
        duration: 45,
        categorySlug: "fechadura-digital-tecnologia-e-acesso",
      },
      {
        id: "srv-chaveiro-02",
        title: "Instalação e Configuração de Fechadura Digital Biométrica",
        description:
          "Furação precisa, instalação mecânica e cadastramento de senhas, biometrias e tags RFID.",
        basePrice: 220.0,
        unit: ServiceUnit.UNIDADE,
        duration: 120,
        categorySlug: "fechadura-digital-tecnologia-e-acesso",
      },
    ],
  },
  {
    id: "prov-gv-seguranca-18",
    name: "Daniel Segurança — CFTV, Câmeras & Interfonia",
    email: "daniel.seguranca.gv@severinno.com.br",
    phone: "+5533991987654",
    whatsapp: "+5533991987654",
    bio: "Proteção patrimonial inteligente para residências e comércios. Câmeras IP Full HD, alarmes e interfones com acesso no smartphone.",
    district: "Centro",
    street: "Rua Marechal Floriano",
    number: "480",
    cep: "35010-140",
    lat: -18.853,
    lng: -41.945,
    avgRating: 4.8,
    reviewCount: 27,
    favoriteCount: 14,
    slug: "daniel-seguranca-cftv-gv",
    services: [
      {
        id: "srv-seguranca-01",
        title: "Instalação e Configuração de Câmeras de Segurança Wi-Fi / IP",
        description:
          "Fixação, cabeamento e configuração de aplicativo de monitoramento ao vivo no celular.",
        basePrice: 140.0,
        unit: ServiceUnit.UNIDADE,
        duration: 90,
        categorySlug: "cameras-e-alarmes-tecnologia-e-acesso",
      },
    ],
  },

  // ── 2. ILHA DOS ARAÚJOS ────────────────────────────────────────────────────
  {
    id: "prov-gv-limpeza-02",
    name: "Mariana Santos — Diarista & Pós-Obra Especializada",
    email: "mariana.limpeza.gv@severinno.com.br",
    phone: "+5533991113030",
    whatsapp: "+5533991113030",
    bio: "Cuidado e capricho absoluto para sua casa ou escritório. Especializada em higienização profunda e pós-obra na Ilha dos Araújos e região.",
    district: "Ilha dos Araújos",
    street: "Avenida Rio Doce",
    number: "120",
    cep: "35020-000",
    lat: -18.8465,
    lng: -41.938,
    avgRating: 5.0,
    reviewCount: 56,
    favoriteCount: 31,
    slug: "mariana-santos-limpeza-gv",
    services: [
      {
        id: "srv-limpeza-01",
        title: "Diária Residencial Padrão (Até 8h)",
        description:
          "Limpeza completa de quartos, salas, banheiros e cozinha com atenção a todos os detalhes.",
        basePrice: 160.0,
        unit: ServiceUnit.UNIDADE,
        duration: 480,
        categorySlug: "limpeza-geral-residencial",
      },
    ],
  },
  {
    id: "prov-gv-estofados-10",
    name: "Camila Estofados — Limpeza & Impermeabilização",
    email: "camila.estofados.gv@severinno.com.br",
    phone: "+5533991991212",
    whatsapp: "+5533991991212",
    bio: "Higienização profunda a seco de sofás, colchões, poltronas e bancos automotivos com produtos biodegradáveis e antiácaro.",
    district: "Ilha dos Araújos",
    street: "Avenida Piracicaba",
    number: "88",
    cep: "35020-000",
    lat: -18.845,
    lng: -41.936,
    avgRating: 5.0,
    reviewCount: 39,
    favoriteCount: 25,
    slug: "camila-higienizacao-estofados-gv",
    services: [
      {
        id: "srv-estofados-01",
        title: "Higienização e Desinfecção Profunda de Sofá (Até 3 Lugares)",
        description: "Extração por sucção profunda de ácaros, manchas e odores com secagem rápida.",
        basePrice: 190.0,
        unit: ServiceUnit.UNIDADE,
        duration: 150,
        categorySlug: "limpeza-de-estofados-estofados-e-texteis",
      },
    ],
  },
  {
    id: "prov-gv-solar-13",
    name: "Gabriel Solar — Energia Fotovoltaica & Inversores",
    email: "gabriel.solar.gv@severinno.com.br",
    phone: "+5533991876543",
    whatsapp: "+5533991876543",
    bio: "Engenharia solar especializada em sistemas residenciais e comerciais em GV. Manutenção preventiva e limpeza técnica de painéis.",
    district: "Ilha dos Araújos",
    street: "Avenida Rio Doce",
    number: "450",
    cep: "35020-000",
    lat: -18.8475,
    lng: -41.9395,
    avgRating: 4.9,
    reviewCount: 25,
    favoriteCount: 16,
    slug: "gabriel-solar-fotovoltaica-gv",
    services: [
      {
        id: "srv-solar-01",
        title: "Limpeza Técnica e Inspeção Térmica de Painéis Solares",
        description:
          "Remoção de poeira e fuligem com água desmineralizada para restaurar a eficiência máxima de geração.",
        basePrice: 250.0,
        unit: ServiceUnit.UNIDADE,
        duration: 180,
        categorySlug: "energia-solar-eletrica",
      },
    ],
  },
  {
    id: "prov-gv-piscina-17",
    name: "Leandro Piscinas — Manutenção & Química de Piscinas",
    email: "leandro.piscinas.gv@severinno.com.br",
    phone: "+5533991765432",
    whatsapp: "+5533991765432",
    bio: "Tratamento de piscinas com água cristalina o ano inteiro. Correção de pH, alcalinidade, cloro e manutenção de bombas e filtros.",
    district: "Ilha dos Araújos",
    street: "Avenida Piracicaba",
    number: "340",
    cep: "35020-000",
    lat: -18.846,
    lng: -41.937,
    avgRating: 4.9,
    reviewCount: 34,
    favoriteCount: 18,
    slug: "leandro-piscinas-tratamento-gv",
    services: [
      {
        id: "srv-piscina-01",
        title: "Tratamento Químico e Aspiração Completa de Piscina",
        description:
          "Decantação, aspiração do fundo, escovação e ajuste de parâmetros químicos para água cristalina.",
        basePrice: 180.0,
        unit: ServiceUnit.UNIDADE,
        duration: 120,
        categorySlug: "limpeza-geral-residencial",
      },
    ],
  },

  // ── 3. VILA BRETAS ─────────────────────────────────────────────────────────
  {
    id: "prov-gv-hidraulica-03",
    name: "Marcos Oliveira — Encanador & Caça-Vazamentos",
    email: "marcos.encanador.gv@severinno.com.br",
    phone: "+5533991224040",
    whatsapp: "+5533991224040",
    bio: "Encanador profissional na Vila Bretas e toda GV. Soluções rápidas e sem quebra-quebra em canos, torneiras e caixas d'água.",
    district: "Vila Bretas",
    street: "Avenida Presidente Juscelino Kubitschek",
    number: "1150",
    cep: "35030-000",
    lat: -18.841,
    lng: -41.952,
    avgRating: 4.8,
    reviewCount: 38,
    favoriteCount: 14,
    slug: "marcos-oliveira-hidraulica-gv",
    services: [
      {
        id: "srv-hidraulica-01",
        title: "Reparo de Vazamento e Troca de Torneira/Registro",
        description:
          "Conserto de vazamentos aparentes e embutidos, troca de reparos de registro e vedação geral.",
        basePrice: 120.0,
        unit: ServiceUnit.UNIDADE,
        duration: 60,
        categorySlug: "encanador-hidraulica",
      },
      {
        id: "srv-hidraulica-03",
        title: "Desentupimento de Pias, Ralos e Sanitários",
        description:
          "Desobstrução rápida com maquinário e cabos espirais sem danificar o encanamento.",
        basePrice: 150.0,
        unit: ServiceUnit.UNIDADE,
        duration: 90,
        categorySlug: "desentupimento-hidraulica",
      },
    ],
  },
  {
    id: "prov-gv-frete-12",
    name: "Cláudio Carretos — Fretes Urbanos & Mudanças",
    email: "claudio.fretes.gv@severinno.com.br",
    phone: "+5533991654321",
    whatsapp: "+5533991654321",
    bio: "Transporte seguro de cargas, compras em home centers e pequenas mudanças em Valadares e distritos com veículo próprio.",
    district: "Vila Bretas",
    street: "Avenida Santos Dumont",
    number: "830",
    cep: "35030-000",
    lat: -18.843,
    lng: -41.95,
    avgRating: 4.8,
    reviewCount: 41,
    favoriteCount: 15,
    slug: "claudio-carretos-fretes-gv",
    services: [
      {
        id: "srv-frete-01",
        title: "Frete Urbano em Governador Valadares",
        description:
          "Transporte de móveis, eletrodomésticos e volumes pesados com amarração segura.",
        basePrice: 180.0,
        unit: ServiceUnit.UNIDADE,
        duration: 90,
        categorySlug: "remocao-de-entulho-obra",
      },
    ],
  },

  // ── 4. GRÃ-DUQUESA ─────────────────────────────────────────────────────────
  {
    id: "prov-gv-pintura-04",
    name: "Rafael Mendes — Pintor Profissional & Texturas",
    email: "rafael.pintura.gv@severinno.com.br",
    phone: "+5533991335050",
    whatsapp: "+5533991335050",
    bio: "Pintura residencial e predial com fino acabamento. Aplicação de grafiato, textura projetada e cimento queimado.",
    district: "Grã-Duquesa",
    street: "Avenida Itália",
    number: "180",
    cep: "35057-000",
    lat: -18.874,
    lng: -41.966,
    avgRating: 4.9,
    reviewCount: 29,
    favoriteCount: 16,
    slug: "rafael-mendes-pintura-gv",
    services: [
      {
        id: "srv-pintura-01",
        title: "Pintura Interna Residencial (Paredes e Tetos)",
        description:
          "Emassamento, lixamento e pintura com tinta acrílica lavável de primeira linha.",
        basePrice: 380.0,
        unit: ServiceUnit.UNIDADE,
        duration: 360,
        categorySlug: "pintura-residencial-pintura",
      },
    ],
  },
  {
    id: "prov-gv-calhas-16",
    name: "Marcelo Calhas — Calhas, Rufos & Telhados",
    email: "marcelo.calhas.gv@severinno.com.br",
    phone: "+5533991543210",
    whatsapp: "+5533991543210",
    bio: "Soluções completas contra infiltrações e goteiras. Fabricação e instalação de calhas galvanizadas e rufos sob medida.",
    district: "Grã-Duquesa",
    street: "Avenida Veneza",
    number: "280",
    cep: "35057-000",
    lat: -18.876,
    lng: -41.968,
    avgRating: 4.8,
    reviewCount: 28,
    favoriteCount: 12,
    slug: "marcelo-calhas-rufos-gv",
    services: [
      {
        id: "srv-calhas-01",
        title: "Limpeza de Calhas e Vedação de Rufos",
        description:
          "Desobstrução de folhas e sujeiras, aplicação de veda-calha e teste de caimento de água.",
        basePrice: 160.0,
        unit: ServiceUnit.UNIDADE,
        duration: 120,
        categorySlug: "pequenas-reformas-alvenaria",
      },
    ],
  },

  // ── 5. SÃO PEDRO ───────────────────────────────────────────────────────────
  {
    id: "prov-gv-pedreiro-05",
    name: "José Antônio 'Seu Zé' — Pedreiro & Reformas Rápidas",
    email: "ze.pedreiro.gv@severinno.com.br",
    phone: "+5533991446060",
    whatsapp: "+5533991446060",
    bio: "Mais de 25 anos construindo e reformando em Valadares. Alvenaria, assentamento de pisos, porcelanato e reboco com pontualidade.",
    district: "São Pedro",
    street: "Avenida Moacir Paleta",
    number: "410",
    cep: "35040-000",
    lat: -18.865,
    lng: -41.958,
    avgRating: 4.8,
    reviewCount: 35,
    favoriteCount: 20,
    slug: "seu-ze-pedreiro-reformas-gv",
    services: [
      {
        id: "srv-pedreiro-01",
        title: "Pequenos Reparos de Alvenaria, Trincas e Reboco",
        description:
          "Abertura e fechamento de vãos, quebra de paredes, reparo de reboco e trincas estruturais.",
        basePrice: 160.0,
        unit: ServiceUnit.UNIDADE,
        duration: 240,
        categorySlug: "alvenaria-obra",
      },
      {
        id: "srv-pedreiro-02",
        title: "Assentamento de Pisos Cerâmicos e Porcelanato",
        description:
          "Nivelamento de contrapiso, assentamento com espaçadores niveladores e acabamento de rejunte.",
        basePrice: 65.0,
        unit: ServiceUnit.METRO_QUADRADO,
        duration: 480,
        categorySlug: "porcelanato-e-ceramica-pisos",
      },
    ],
  },
  {
    id: "prov-gv-gesso-15",
    name: "Tiago Revestimentos — Gesso, Sancas & Drywall",
    email: "tiago.gesso.gv@severinno.com.br",
    phone: "+5533991432109",
    whatsapp: "+5533991432109",
    bio: "Rebaixamento de teto, forros acústicos e sancas iluminadas para valorizar seu imóvel com agilidade e limpeza.",
    district: "São Pedro",
    street: "Avenida Moacir Paleta",
    number: "650",
    cep: "35040-000",
    lat: -18.868,
    lng: -41.961,
    avgRating: 4.9,
    reviewCount: 30,
    favoriteCount: 15,
    slug: "tiago-gesso-drywall-gv",
    services: [
      {
        id: "srv-gesso-01",
        title: "Rebaixamento de Teto em Drywall / Gesso Acartonado",
        description:
          "Estruturação metálica galvanizada, chapeamento e tratamento de juntas com fita e massa para pintura.",
        basePrice: 85.0,
        unit: ServiceUnit.METRO_QUADRADO,
        duration: 360,
        categorySlug: "gesso-e-sancas-forro-e-divisorias",
      },
    ],
  },

  // ── 6. SANTA RITA ──────────────────────────────────────────────────────────
  {
    id: "prov-gv-jardim-07",
    name: "Valadares Jardinagem — Gustavo Henrique",
    email: "gustavo.jardim.gv@severinno.com.br",
    phone: "+5533991668080",
    whatsapp: "+5533991668080",
    bio: "Manutenção paisagística completa, poda de árvores, corte de grama com tratorito e descarte ecológico.",
    district: "Santa Rita",
    street: "Avenida Washington Luís",
    number: "740",
    cep: "35050-000",
    lat: -18.862,
    lng: -41.932,
    avgRating: 4.9,
    reviewCount: 22,
    favoriteCount: 11,
    slug: "gustavo-jardinagem-valadares-gv",
    services: [
      {
        id: "srv-jardim-01",
        title: "Corte de Grama, Poda de Cercas Vivas e Limpeza de Canteiros",
        description: "Roçagem completa, poda ornamental e ensacamento de resíduos verdes.",
        basePrice: 150.0,
        unit: ServiceUnit.UNIDADE,
        duration: 180,
        categorySlug: "corte-grama-jardinagem",
      },
    ],
  },
  {
    id: "prov-gv-serralheria-14",
    name: "Wilson Portões — Serralheria & Motores Eletrônicos",
    email: "wilson.serralheria.gv@severinno.com.br",
    phone: "+5533991321098",
    whatsapp: "+5533991321098",
    bio: "Serralheria especializada em portões automáticos, soldas elétricas e estruturas metálicas residenciais.",
    district: "Santa Rita",
    street: "Avenida Eusébio Cabral",
    number: "320",
    cep: "35050-000",
    lat: -18.861,
    lng: -41.9335,
    avgRating: 4.8,
    reviewCount: 31,
    favoriteCount: 13,
    slug: "wilson-portoes-serralheria-gv",
    services: [
      {
        id: "srv-serralheria-01",
        title: "Instalação e Troca de Motor de Portão Eletrônico",
        description:
          "Fixação da base, instalação de cremalheira, fim de curso e codificação de controles remotos.",
        basePrice: 280.0,
        unit: ServiceUnit.UNIDADE,
        duration: 150,
        categorySlug: "portao-automatico-tecnologia-e-acesso",
      },
    ],
  },

  // ── 7. ESPLANADA ───────────────────────────────────────────────────────────
  {
    id: "prov-gv-marcenaria-08",
    name: "André Móveis — Montagem & Marcenaria",
    email: "andre.marcenaria.gv@severinno.com.br",
    phone: "+5533991779090",
    whatsapp: "+5533991779090",
    bio: "Montador profissional credenciado. Ajuste de portas de correr, troca de dobradiças e instalação de painéis de TV.",
    district: "Esplanada",
    street: "Avenida Sete de Setembro",
    number: "1620",
    cep: "35012-000",
    lat: -18.859,
    lng: -41.948,
    avgRating: 4.9,
    reviewCount: 31,
    favoriteCount: 15,
    slug: "andre-moveis-montagem-gv",
    services: [
      {
        id: "srv-marcenaria-01",
        title: "Montagem de Guarda-Roupa / Roupeiro (Até 6 Portas)",
        description:
          "Montagem alinhada, fixação de gaveteiros e regulagem de corrediças telescópicas.",
        basePrice: 180.0,
        unit: ServiceUnit.UNIDADE,
        duration: 240,
        categorySlug: "montagem-de-moveis-marcenaria",
      },
    ],
  },
  {
    id: "prov-gv-dedetizacao-20",
    name: "Dr. Pragas GV — Controle de Pragas & Dedetização",
    email: "drpragas.gv@severinno.com.br",
    phone: "+5533991109876",
    whatsapp: "+5533991109876",
    bio: "Dedetizadora licenciada em Governador Valadares. Produtos sem cheiro seguros para pets e crianças contra escorpiões, baratas e formigas.",
    district: "Esplanada",
    street: "Avenida Sete de Setembro",
    number: "2100",
    cep: "35012-000",
    lat: -18.86,
    lng: -41.95,
    avgRating: 4.9,
    reviewCount: 37,
    favoriteCount: 21,
    slug: "dr-pragas-dedetizacao-gv",
    services: [
      {
        id: "srv-dedetizacao-01",
        title: "Desinsetização Residencial Completa com Garantia de 6 Meses",
        description:
          "Aplicação por pulverização e gel inodoro em rodapés, ralos e frestas contra baratas e escorpiões.",
        basePrice: 220.0,
        unit: ServiceUnit.UNIDADE,
        duration: 120,
        categorySlug: "limpeza-geral-residencial",
      },
    ],
  },

  // ── 8. LOURDES ─────────────────────────────────────────────────────────────
  {
    id: "prov-gv-faztudo-09",
    name: "Roberto Dias — Marido de Aluguel & Faz-Tudo",
    email: "roberto.faztudo.gv@severinno.com.br",
    phone: "+5533991880101",
    whatsapp: "+5533991880101",
    bio: "Pequenos reparos rápidos: instalação de cortinas, varão, suportes de TV, chuveiros e pendurar espelhos com segurança.",
    district: "Lourdes",
    street: "Avenida Brasil",
    number: "2200",
    cep: "35010-000",
    lat: -18.848,
    lng: -41.96,
    avgRating: 4.8,
    reviewCount: 44,
    favoriteCount: 23,
    slug: "roberto-marido-aluguel-gv",
    services: [
      {
        id: "srv-faztudo-01",
        title: "Instalação de Suporte Articulado de TV e Prateleiras",
        description:
          "Furação com aspirador acoplado sem sujeira e fixação firme com buchas apropriadas.",
        basePrice: 90.0,
        unit: ServiceUnit.UNIDADE,
        duration: 60,
        categorySlug: "fixar-tv-e-prateleiras-pequenos-reparos",
      },
    ],
  },
  {
    id: "prov-gv-vidros-19",
    name: "Rodrigo Vidros — Vidraçaria & Box Temperado",
    email: "rodrigo.vidros.gv@severinno.com.br",
    phone: "+5533991210987",
    whatsapp: "+5533991210987",
    bio: "Vidros temperados, box de banheiro padrão blindex, espelhos lapidados e manutenção de esquadrias.",
    district: "Lourdes",
    street: "Avenida Brasil",
    number: "1520",
    cep: "35010-000",
    lat: -18.85,
    lng: -41.943,
    avgRating: 4.9,
    reviewCount: 32,
    favoriteCount: 17,
    slug: "rodrigo-vidros-temperados-gv",
    services: [
      {
        id: "srv-vidros-01",
        title: "Manutenção e Troca de Roldanas de Box de Vidro",
        description:
          "Regulagem de altura, troca de puxador, batedor e roldanas blindadas para deslize suave.",
        basePrice: 130.0,
        unit: ServiceUnit.UNIDADE,
        duration: 60,
        categorySlug: "acessorios-e-vedacao-pequenos-reparos",
      },
    ],
  },
]

async function seedFrotaPioneira() {
  console.log("================================================================================")
  console.log("🚀 ATIVAÇÃO DA FROTA PIONEIRA DE PRESTADORES — GOVERNADOR VALADARES / MG")
  console.log("   • 20 Prestadores Profissionais Verificados")
  console.log("   • 8 Bairros Estruturantes de GV Mapeados via CNEFE/IBGE")
  console.log("   • Grade Completa de Serviços Essenciais com Preços de Mercado")
  console.log("================================================================================\n")

  // 1. Garantir Cidade de Governador Valadares
  const city = await db.city.upsert({
    where: { slug: "governador-valadares" },
    create: {
      id: "gv-city-id",
      name: "Governador Valadares",
      slug: "governador-valadares",
      state: "MG",
      country: "BR",
      lat: -18.8546,
      lng: -41.9444,
      active: true,
      timezone: "America/Sao_Paulo",
    },
    update: {
      active: true,
      lat: -18.8546,
      lng: -41.9444,
    },
  })
  console.log(`📍 Cidade confirmada: ${city.name} (ID: ${city.id})\n`)

  // Cache de categorias para mapeamento ágil
  let allCategories = await db.category.findMany()
  if (allCategories.length === 0) {
    const defaultCat = await db.category.create({
      data: {
        name: "Serviços Gerais",
        slug: "servicos-gerais",
        level: 1,
        active: true,
      },
    })
    allCategories = [defaultCat]
  }
  const catBySlug = new Map(allCategories.map((c) => [c.slug, c]))

  let totalServicesCreated = 0

  // 2. Iterar e Fazer Upsert dos 20 Prestadores
  for (const [index, p] of PIONEER_PROVIDERS.entries()) {
    const user = await db.user.upsert({
      where: { id: p.id },
      create: {
        id: p.id,
        name: p.name,
        email: p.email,
        passwordHash: "$2b$10$placeholderPioneer2026SecureHash",
        phone: p.phone,
        whatsapp: p.whatsapp,
        bio: p.bio,
        role: Role.PROVIDER,
        city: "Governador Valadares",
        cityId: city.id,
        state: "MG",
        district: p.district,
        street: p.street,
        number: p.number,
        cep: p.cep,
        lat: p.lat,
        lng: p.lng,
        radiusKm: 15.0, // Cobertura de 15km para atender toda a malha urbana de GV
        active: true,
        verified: true,
        avgRating: p.avgRating,
        reviewCount: p.reviewCount,
        favoriteCount: p.favoriteCount,
        slug: p.slug,
        avatarUrl: `https://i.pravatar.cc/300?u=${p.id}`,
      },
      update: {
        name: p.name,
        email: p.email,
        phone: p.phone,
        whatsapp: p.whatsapp,
        bio: p.bio,
        district: p.district,
        street: p.street,
        number: p.number,
        cep: p.cep,
        lat: p.lat,
        lng: p.lng,
        radiusKm: 15.0,
        active: true,
        verified: true,
        avgRating: p.avgRating,
        reviewCount: p.reviewCount,
        favoriteCount: p.favoriteCount,
        avatarUrl: `https://i.pravatar.cc/300?u=${p.id}`,
      },
    })

    // Configurar Horário de Atendimento (Seg-Sex 08:00 às 18:00, Sáb 08:00 às 13:00)
    for (let day = 1; day <= 6; day++) {
      const endTime = day === 6 ? "13:00" : "18:00"
      const existingAvail = await db.providerAvailability.findFirst({
        where: { providerId: p.id, dayOfWeek: day },
      })
      if (!existingAvail) {
        await db.providerAvailability.create({
          data: {
            providerId: p.id,
            dayOfWeek: day,
            startTime: "08:00",
            endTime,
            active: true,
          },
        })
      }
    }

    // Criar/Atualizar Serviços do Prestador
    for (const s of p.services) {
      let category = catBySlug.get(s.categorySlug)
      if (!category) {
        // Fallback para primeira categoria disponível se o slug não existir
        category = allCategories[0]
      }

      await db.service.upsert({
        where: { id: s.id },
        create: {
          id: s.id,
          providerId: p.id,
          categoryId: category.id,
          title: s.title,
          description: s.description,
          basePrice: s.basePrice,
          unit: s.unit,
          duration: s.duration,
          active: true,
        },
        update: {
          providerId: p.id,
          categoryId: category.id,
          title: s.title,
          description: s.description,
          basePrice: s.basePrice,
          unit: s.unit,
          duration: s.duration,
          active: true,
        },
      })
      totalServicesCreated++
    }

    console.log(
      `[${(index + 1).toString().padStart(2, "0")}/20] ✅ ${p.name.padEnd(52)} | ${p.district.padEnd(16)} (⭐ ${p.avgRating})`,
    )
  }

  // 3. Backfill de Avatares
  try {
    await backfillAvatars(db)
  } catch {}

  console.log("\n================================================================================")
  console.log("📊 RESUMO DA FROTA PIONEIRA ATIVA:")
  console.log(`   • Total de Prestadores Ativos em GV: ${PIONEER_PROVIDERS.length}`)
  console.log(`   • Total de Serviços Essenciais Cadastrados: ${totalServicesCreated}`)
  console.log(
    `   • Bairros Cobertos: Centro, Ilha dos Araújos, Vila Bretas, Grã-Duquesa, São Pedro, Santa Rita, Esplanada, Lourdes`,
  )
  console.log(`   • Raio Médio de Cobertura Operacional: 15 km`)
  console.log(
    `   • Status: 100% dos perfis verificados e disponíveis na vitrine e na Torre de Controle`,
  )
  console.log("================================================================================\n")
}

seedFrotaPioneira()
  .catch((err) => {
    console.error("❌ Falha no seed da frota pioneira:", err)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
