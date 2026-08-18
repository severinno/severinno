/* eslint-disable no-console */
/**
 * Severinno Marketplace — Script de povoamento completo
 * Run with: bun prisma/populate.ts
 *
 * Cria:
 *   - 1 admin
 *   - 10 clientes (com foto de perfil)
 *   - 12 prestadores (com foto de perfil, 6 serviços cada = 72 serviços)
 *   - Categorias (3 níveis, expandidas para cobrir 12 profissões)
 *   - Disponibilidade semanal para cada prestador
 *   - 12 orçamentos (QuoteRequest + QuoteItem)
 *   - 12 agendamentos (Booking) — variados status, com avaliações
 *   - 12 transações (Payment) — uma por agendamento
 *   - Favoritos, notificações e settings
 *
 * Senhas:
 *   admin@severinno.com     / admin123
 *   cliente{N}@severinno.com / cliente123   (N = 1..10)
 *   {provider}@severinno.com / provider123
 */

import { PrismaClient } from "@prisma/client"
import { hashPassword } from "../src/lib/crypto"

const db = new PrismaClient()

// São Paulo reference
const SP_LAT = -23.55
const SP_LNG = -46.63

function jitter(base: number, delta: number): number {
  return Number((base + (Math.random() * 2 - 1) * delta).toFixed(5))
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

function randPhone(prefix: string): string {
  return `${prefix} 9${Math.floor(1000 + Math.random() * 8999)}-${Math.floor(1000 + Math.random() * 8999)}`
}

function randCpf(): string {
  const n = (len: number) =>
    Array.from({ length: len }, () => Math.floor(Math.random() * 10)).join("")
  return `${n(3)}.${n(3)}.${n(3)}-${n(2)}`
}

// ---------------------------------------------------------------------------
// Dados dos 10 clientes
// ---------------------------------------------------------------------------

const CLIENTES = [
  {
    nome: "Ana Beatriz Souza",
    email: "cliente1@severinno.com",
    avatar: 5,
    cep: "01310-100",
    rua: "Avenida Paulista",
    num: "1000",
    bairro: "Bela Vista",
  },
  {
    nome: "Bruno Carvalho",
    email: "cliente2@severinno.com",
    avatar: 12,
    cep: "04547-130",
    rua: "Rua Funchal",
    num: "320",
    bairro: "Vila Olímpia",
  },
  {
    nome: "Carla Mendes Ferreira",
    email: "cliente3@severinno.com",
    avatar: 9,
    cep: "05407-002",
    rua: "Rua Cardeal Arcoverde",
    num: "1750",
    bairro: "Pinheiros",
  },
  {
    nome: "Diego Santos Lima",
    email: "cliente4@severinno.com",
    avatar: 14,
    cep: "02012-000",
    rua: "Rua Voluntários da Pátria",
    num: "500",
    bairro: "Santana",
  },
  {
    nome: "Eduarda Alves Rocha",
    email: "cliente5@severinno.com",
    avatar: 20,
    cep: "04094-050",
    rua: "Rua Joaquim Nabuco",
    num: "215",
    bairro: "Brooklin",
  },
  {
    nome: "Felipe Gomes Oliveira",
    email: "cliente6@severinno.com",
    avatar: 15,
    cep: "03333-001",
    rua: "Rua Tuiuti",
    num: "700",
    bairro: "Tatuapé",
  },
  {
    nome: "Gabriela Pinto Martins",
    email: "cliente7@severinno.com",
    avatar: 25,
    cep: "05652-000",
    rua: "Avenida Eliseu de Almeida",
    num: "1900",
    bairro: "Vila Sônia",
  },
  {
    nome: "Henrique Dias Cardoso",
    email: "cliente8@severinno.com",
    avatar: 33,
    cep: "02982-000",
    rua: "Rua Parapuã",
    num: "120",
    bairro: "Vila Anastácio",
  },
  {
    nome: "Isabela Castro Nunes",
    email: "cliente9@severinno.com",
    avatar: 45,
    cep: "01404-000",
    rua: "Rua Augusta",
    num: "2500",
    bairro: "Jardins",
  },
  {
    nome: "João Pedro Barbosa",
    email: "cliente10@severinno.com",
    avatar: 51,
    cep: "04116-080",
    rua: "Rua Vergueiro",
    num: "3300",
    bairro: "Vila Mariana",
  },
]

// ---------------------------------------------------------------------------
// Dados dos 12 prestadores (cada um com 6 serviços)
// ---------------------------------------------------------------------------

type PrestadorData = {
  nome: string
  email: string
  profissao: string
  bio: string
  avatar: number
  coverSeed: string
  cep: string
  rua: string
  bairro: string
  radiusKm: number
  servicos: {
    titulo: string
    desc: string
    preco: number
    unidade: string
    subCat: string
    fotoSeed: string
  }[]
}

const PRESTADORES: PrestadorData[] = [
  {
    nome: "Carlos Encanador",
    email: "carlos@severinno.com",
    profissao: "Encanador",
    avatar: 11,
    bio: "Encanador com 15 anos de experiência em reparos hidráulicos, desentupimento e instalação de caixas de descarga. Atendo toda a zona sul de São Paulo.",
    coverSeed: "encanador-cover",
    cep: "04094-050",
    rua: "Rua Joaquim Nabuco",
    bairro: "Brooklin",
    radiusKm: 12,
    servicos: [
      {
        titulo: "Desentupimento de ralo e pia",
        desc: "Desentupimento de ralos, pias e vasos sanitários com equipamento profissional. Garantia de 30 dias.",
        preco: 120,
        unidade: "UNIDADE",
        subCat: "Desentupimento",
        fotoSeed: "enc-serv-1",
      },
      {
        titulo: "Localização e reparo de vazamento",
        desc: "Detecção de vazamentos com equipamento acústico e reparo completo. Atendimento de emergência.",
        preco: 200,
        unidade: "UNIDADE",
        subCat: "Vazamento",
        fotoSeed: "enc-serv-2",
      },
      {
        titulo: "Troca de caixa de descarga",
        desc: "Substituição de caixa de descarga hidra ou de embutir. Inclui peça e mão de obra.",
        preco: 180,
        unidade: "UNIDADE",
        subCat: "Caixa de descarga",
        fotoSeed: "enc-serv-3",
      },
      {
        titulo: "Instalação de coluna de banheiro",
        desc: "Instalação de coluna e registro de banheiro completo.",
        preco: 350,
        unidade: "UNIDADE",
        subCat: "Vazamento",
        fotoSeed: "enc-serv-4",
      },
      {
        titulo: "Troca de registro de gaveta",
        desc: "Substituição de registros de gaveta e pressão antigos por novos.",
        preco: 90,
        unidade: "UNIDADE",
        subCat: "Vazamento",
        fotoSeed: "enc-serv-5",
      },
      {
        titulo: "Limpeza de caixa de gordura",
        desc: "Limpeza e desobstrução de caixa de gordura residencial e comercial.",
        preco: 150,
        unidade: "UNIDADE",
        subCat: "Desentupimento",
        fotoSeed: "enc-serv-6",
      },
    ],
  },
  {
    nome: "EletricaTech — Ricardo",
    email: "ricardo@severinno.com",
    profissao: "Eletricista",
    avatar: 13,
    bio: "Eletricista predial e residencial. Instalações elétricas, troca de quadros, manutenção preventiva e correção de curtos-circuitos. NR-10 atualizada.",
    coverSeed: "eletricista-cover",
    cep: "02012-000",
    rua: "Rua Voluntários da Pátria",
    bairro: "Santana",
    radiusKm: 15,
    servicos: [
      {
        titulo: "Troca de tomadas e interruptores",
        desc: "Substituição de tomadas e interruptores com fiação revisada. Padrão novo (3 pinos).",
        preco: 25,
        unidade: "UNIDADE",
        subCat: "Tomadas e interruptores",
        fotoSeed: "ele-serv-1",
      },
      {
        titulo: "Diagnóstico e reparo de curto-circuito",
        desc: "Identificação da causa do curto, reparo da fiação e testes de segurança.",
        preco: 250,
        unidade: "UNIDADE",
        subCat: "Curto-circuito",
        fotoSeed: "ele-serv-2",
      },
      {
        titulo: "Instalação de quadro de distribuição",
        desc: "Montagem e instalação de quadro elétrico com disjuntores NBR 5410.",
        preco: 600,
        unidade: "UNIDADE",
        subCat: "Quadro elétrico",
        fotoSeed: "ele-serv-3",
      },
      {
        titulo: "Troca de disjuntor",
        desc: "Substituição de disjuntores antigos ou danificados por novos dimensionados.",
        preco: 80,
        unidade: "UNIDADE",
        subCat: "Quadro elétrico",
        fotoSeed: "ele-serv-4",
      },
      {
        titulo: "Instalação de luminária",
        desc: "Instalação de luminárias, plafons e pendentes. Inclui fiação.",
        preco: 70,
        unidade: "UNIDADE",
        subCat: "Tomadas e interruptores",
        fotoSeed: "ele-serv-5",
      },
      {
        titulo: "Aterramento elétrico",
        desc: "Instalação de sistema de aterramento para proteção de equipamentos.",
        preco: 450,
        unidade: "UNIDADE",
        subCat: "Curto-circuito",
        fotoSeed: "ele-serv-6",
      },
    ],
  },
  {
    nome: "Pinturas Lima",
    email: "lima@severinno.com",
    profissao: "Pintor",
    avatar: 15,
    bio: "Pintor residencial e comercial. Pintura interna e externa, textura, grafiato e preparação de paredes. Orçamento sem compromisso.",
    coverSeed: "pintor-cover",
    cep: "05407-002",
    rua: "Rua Cardeal Arcoverde",
    bairro: "Pinheiros",
    radiusKm: 20,
    servicos: [
      {
        titulo: "Pintura interna de parede",
        desc: "Pintura de paredes internas com tinta acrílica. Preparo, massa corrida e 2 demãos.",
        preco: 35,
        unidade: "METRO_QUADRADO",
        subCat: "Pintura interna",
        fotoSeed: "pint-serv-1",
      },
      {
        titulo: "Pintura externa de fachada",
        desc: "Pintura de fachadas com tinta acrílica Premium. Resistente a intempéries.",
        preco: 65,
        unidade: "METRO_QUADRADO",
        subCat: "Pintura externa",
        fotoSeed: "pint-serv-2",
      },
      {
        titulo: "Aplicação de textura e grafiato",
        desc: "Aplicação de textura decorativa ou grafiato em paredes. Material incluso.",
        preco: 55,
        unidade: "METRO_QUADRADO",
        subCat: "Textura e grafiato",
        fotoSeed: "pint-serv-3",
      },
      {
        titulo: "Massa corrida e preparação",
        desc: "Preparação de paredes com massa corrida, lixamento e fundo preparador.",
        preco: 20,
        unidade: "METRO_QUADRADO",
        subCat: "Pintura interna",
        fotoSeed: "pint-serv-4",
      },
      {
        titulo: "Pintura de teto",
        desc: "Pintura de tetos com tinta látex branca. Inclui reparo de trincas.",
        preco: 30,
        unidade: "METRO_QUADRADO",
        subCat: "Pintura interna",
        fotoSeed: "pint-serv-5",
      },
      {
        titulo: "Pintura de portas e esquadrias",
        desc: "Pintura de portas de madeira e esquadrias metálicas com esmalte.",
        preco: 80,
        unidade: "UNIDADE",
        subCat: "Pintura externa",
        fotoSeed: "pint-serv-6",
      },
    ],
  },
  {
    nome: "Diarista Fernanda",
    email: "fernanda@severinno.com",
    profissao: "Diarista",
    avatar: 16,
    bio: "Diarista com referências. Limpeza residencial, pós-obra e organização. Trabalho com produtos próprios.",
    coverSeed: "diarista-cover",
    cep: "03333-001",
    rua: "Rua Tuiuti",
    bairro: "Tatuapé",
    radiusKm: 10,
    servicos: [
      {
        titulo: "Diária de limpeza residencial",
        desc: "Diária de 8 horas para limpeza geral de apartamentos e casas. Produtos inclusos.",
        preco: 180,
        unidade: "UNIDADE",
        subCat: "Limpeza geral",
        fotoSeed: "dia-serv-1",
      },
      {
        titulo: "Limpeza pós-obra completa",
        desc: "Limpeza profunda após reforma: remoção de resíduos, cimento e poeira. Até 100m².",
        preco: 650,
        unidade: "UNIDADE",
        subCat: "Limpeza pós-obra",
        fotoSeed: "dia-serv-2",
      },
      {
        titulo: "Organização de closets e armários",
        desc: "Organização profissional de closets, armários e despensas.",
        preco: 250,
        unidade: "UNIDADE",
        subCat: "Organização",
        fotoSeed: "dia-serv-3",
      },
      {
        titulo: "Limpeza de vidros e janelas",
        desc: "Limpeza de vidros, janelas e esquadrias internas/externas.",
        preco: 120,
        unidade: "UNIDADE",
        subCat: "Limpeza geral",
        fotoSeed: "dia-serv-4",
      },
      {
        titulo: "Faxina pesada",
        desc: "Faxina completa de cozinha, banheiros e áreas de serviço.",
        preco: 300,
        unidade: "UNIDADE",
        subCat: "Limpeza geral",
        fotoSeed: "dia-serv-5",
      },
      {
        titulo: "Passadoria de roupas",
        desc: "Passadoria de roupas por diária. Inclui até 30 peças.",
        preco: 100,
        unidade: "UNIDADE",
        subCat: "Organização",
        fotoSeed: "dia-serv-6",
      },
    ],
  },
  {
    nome: "Jardins Vida — Pedro",
    email: "pedro@severinno.com",
    profissao: "Jardineiro",
    avatar: 17,
    bio: "Jardineiro especializado em paisagismo, poda de árvores, controle de pragas e manutenção de jardins residenciais e comerciais.",
    coverSeed: "jardineiro-cover",
    cep: "05652-000",
    rua: "Avenida Eliseu de Almeida",
    bairro: "Vila Sônia",
    radiusKm: 18,
    servicos: [
      {
        titulo: "Poda de árvores e arbustos",
        desc: "Poda de manutenção e limpeza de arbustos. Inclui remoção dos galhos.",
        preco: 150,
        unidade: "UNIDADE",
        subCat: "Poda de árvores",
        fotoSeed: "jard-serv-1",
      },
      {
        titulo: "Paisagismo e jardinagem",
        desc: "Projeto e execução de jardins com plantas ornamentais.",
        preco: 800,
        unidade: "UNIDADE",
        subCat: "Poda de árvores",
        fotoSeed: "jard-serv-2",
      },
      {
        titulo: "Controle de pragas em jardins",
        desc: "Aplicação de produtos para controle de formigas, cupins e fungos.",
        preco: 120,
        unidade: "UNIDADE",
        subCat: "Poda de árvores",
        fotoSeed: "jard-serv-3",
      },
      {
        titulo: "Irrigação automatizada",
        desc: "Instalação de sistema de irrigação automática para jardins.",
        preco: 1200,
        unidade: "UNIDADE",
        subCat: "Poda de árvores",
        fotoSeed: "jard-serv-4",
      },
      {
        titulo: "Manutenção mensal de jardim",
        desc: "Pacote mensal de manutenção: poda, adubação e limpeza.",
        preco: 400,
        unidade: "UNIDADE",
        subCat: "Poda de árvores",
        fotoSeed: "jard-serv-5",
      },
      {
        titulo: "Plantio de grama",
        desc: "Plantio de grama esmeralda ou são carlos em áreas até 50m².",
        preco: 18,
        unidade: "METRO_QUADRADO",
        subCat: "Poda de árvores",
        fotoSeed: "jard-serv-6",
      },
    ],
  },
  {
    nome: "Pedreiro Antônio",
    email: "antonio@severinno.com",
    profissao: "Pedreiro",
    avatar: 18,
    bio: "Pedreiro experiente em alvenaria, revestimentos, contrapiso e pequenas reformas. Garantia de serviço e notas fiscais.",
    coverSeed: "pedreiro-cover",
    cep: "02982-000",
    rua: "Rua Parapuã",
    bairro: "Vila Anastácio",
    radiusKm: 25,
    servicos: [
      {
        titulo: "Assentamento de piso cerâmico",
        desc: "Assentamento de pisos e azulejos cerâmicos. Inclui preparo do contrapiso.",
        preco: 45,
        unidade: "METRO_QUADRADO",
        subCat: "Assentamento de piso",
        fotoSeed: "ped-serv-1",
      },
      {
        titulo: "Execução de contrapiso",
        desc: "Preparo e execução de contrapiso nivelado para assentamento de piso.",
        preco: 60,
        unidade: "METRO_QUADRADO",
        subCat: "Contrapiso",
        fotoSeed: "ped-serv-2",
      },
      {
        titulo: "Pequenas reformas",
        desc: "Reformas de banheiros, cozinhas e áreas de serviço. Inclui demolição e reconstrução.",
        preco: 5000,
        unidade: "UNIDADE",
        subCat: "Pequenas reformas",
        fotoSeed: "ped-serv-3",
      },
      {
        titulo: "Rejunte de piso e azulejo",
        desc: "Rejuntamento completo de pisos e azulejos com rejunte premium.",
        preco: 15,
        unidade: "METRO_QUADRADO",
        subCat: "Rejunte",
        fotoSeed: "ped-serv-4",
      },
      {
        titulo: "Construção de muro e mureta",
        desc: "Construção de muros e muretas de alvenaria ou blocos.",
        preco: 350,
        unidade: "METRO_QUADRADO",
        subCat: "Pequenas reformas",
        fotoSeed: "ped-serv-5",
      },
      {
        titulo: "Regularização de piso",
        desc: "Regularização de pisos irregulares com argamassa niveladora.",
        preco: 40,
        unidade: "METRO_QUADRADO",
        subCat: "Contrapiso",
        fotoSeed: "ped-serv-6",
      },
    ],
  },
  {
    nome: "Marcenaria Bela Madeira",
    email: "marceneiro@severinno.com",
    profissao: "Marceneiro",
    avatar: 60,
    bio: "Marceneiro artesanal especializado em móveis planejados, consertos e reformas de móveis. Trabalho com madeira maciça e MDF.",
    coverSeed: "marceneiro-cover",
    cep: "01153-000",
    rua: "Rua Ribeiro de Lima",
    bairro: "Barra Funda",
    radiusKm: 20,
    servicos: [
      {
        titulo: "Móvel planejado",
        desc: "Projeto e fabricação de móveis planejados (cozinha, dormitório, home office).",
        preco: 450,
        unidade: "METRO_LINEAR",
        subCat: "Pequenas reformas",
        fotoSeed: "mar-serv-1",
      },
      {
        titulo: "Conserto de móveis",
        desc: "Reparo de portas, gavetas, dobradiças e estruturas de móveis.",
        preco: 120,
        unidade: "UNIDADE",
        subCat: "Pequenas reformas",
        fotoSeed: "mar-serv-2",
      },
      {
        titulo: "Instalação de portas",
        desc: "Instalação de portas internas, de correr e de madeira maciça.",
        preco: 200,
        unidade: "UNIDADE",
        subCat: "Pequenas reformas",
        fotoSeed: "mar-serv-3",
      },
      {
        titulo: "Pintura de móveis",
        desc: "Pintura e envernizamento de móveis de madeira.",
        preco: 150,
        unidade: "UNIDADE",
        subCat: "Pintura interna",
        fotoSeed: "mar-serv-4",
      },
      {
        titulo: "Fabricação de estante",
        desc: "Fabricação de estantes e prateleiras sob medida.",
        preco: 300,
        unidade: "METRO_LINEAR",
        subCat: "Pequenas reformas",
        fotoSeed: "mar-serv-5",
      },
      {
        titulo: "Troca de fechaduras",
        desc: "Substituição de fechaduras e dobradiças em portas de madeira.",
        preco: 80,
        unidade: "UNIDADE",
        subCat: "Pequenas reformas",
        fotoSeed: "mar-serv-6",
      },
    ],
  },
  {
    nome: "ArqPaula Projetos",
    email: "arquiteta@severinno.com",
    profissao: "Arquiteta",
    avatar: 48,
    bio: "Arquiteta e urbanista com 10 anos de experiência em projetos residenciais e comerciais. CAU ativo.",
    coverSeed: "arquiteta-cover",
    cep: "01404-000",
    rua: "Rua Augusta",
    bairro: "Jardins",
    radiusKm: 30,
    servicos: [
      {
        titulo: "Projeto residencial completo",
        desc: "Projeto de arquitetura completo: planta, fachada, hidráulica e elétrica.",
        preco: 8000,
        unidade: "UNIDADE",
        subCat: "Pequenas reformas",
        fotoSeed: "arq-serv-1",
      },
      {
        titulo: "Projeto de interiores",
        desc: "Projeto de interiores para residências: mobiliário, iluminação e acabamentos.",
        preco: 3500,
        unidade: "UNIDADE",
        subCat: "Pequenas reformas",
        fotoSeed: "arq-serv-2",
      },
      {
        titulo: "Consultoria de reforma",
        desc: "Consultoria técnica para reformas: visita, diagnóstico e orientação.",
        preco: 500,
        unidade: "UNIDADE",
        subCat: "Pequenas reformas",
        fotoSeed: "arq-serv-3",
      },
      {
        titulo: "Aprovação na prefeitura",
        desc: "Protocolo e acompanhamento de projetos na prefeitura.",
        preco: 1500,
        unidade: "UNIDADE",
        subCat: "Pequenas reformas",
        fotoSeed: "arq-serv-4",
      },
      {
        titulo: "Projeto de fachada",
        desc: "Projeto de fachada residencial ou comercial com render 3D.",
        preco: 2500,
        unidade: "UNIDADE",
        subCat: "Pintura externa",
        fotoSeed: "arq-serv-5",
      },
      {
        titulo: "Vistoria técnica",
        desc: "Vistoria técnica de imóvel com laudo detalhado.",
        preco: 800,
        unidade: "UNIDADE",
        subCat: "Pequenas reformas",
        fotoSeed: "arq-serv-6",
      },
    ],
  },
  {
    nome: "Gesso & Cia — Marcelo",
    email: "gesseiro@severinno.com",
    profissao: "Gesseiro",
    avatar: 36,
    bio: "Gesseiro especializado em forro de gesso, divisórias, sancas e molduras. Trabalho limpo e com prazo.",
    coverSeed: "gesseiro-cover",
    cep: "02712-200",
    rua: "Av. Eng. Caetano Álvares",
    bairro: "Limão",
    radiusKm: 22,
    servicos: [
      {
        titulo: "Forro de gesso",
        desc: "Instalação de forro de gesso liso ou rebaixado. Inclui acabamento.",
        preco: 55,
        unidade: "METRO_QUADRADO",
        subCat: "Pequenas reformas",
        fotoSeed: "ges-serv-1",
      },
      {
        titulo: "Sanca de gesso",
        desc: "Execução de sancas decorativas para iluminação indireta.",
        preco: 80,
        unidade: "METRO_LINEAR",
        subCat: "Pequenas reformas",
        fotoSeed: "ges-serv-2",
      },
      {
        titulo: "Divisória de gesso",
        desc: "Construção de divisórias em gesso acartonado (drywall).",
        preco: 70,
        unidade: "METRO_QUADRADO",
        subCat: "Pequenas reformas",
        fotoSeed: "ges-serv-3",
      },
      {
        titulo: "Moldura de gesso",
        desc: "Aplicação de molduras decorativas em teto e paredes.",
        preco: 25,
        unidade: "METRO_LINEAR",
        subCat: "Pintura interna",
        fotoSeed: "ges-serv-4",
      },
      {
        titulo: "Reparo de gesso",
        desc: "Reparo de trincas, buracos e danos em forro de gesso.",
        preco: 100,
        unidade: "UNIDADE",
        subCat: "Pequenas reformas",
        fotoSeed: "ges-serv-5",
      },
      {
        titulo: "Iluminação embutida em gesso",
        desc: "Instalação de spots e fitas LED embutidas em forro de gesso.",
        preco: 45,
        unidade: "UNIDADE",
        subCat: "Tomadas e interruptores",
        fotoSeed: "ges-serv-6",
      },
    ],
  },
  {
    nome: "Antenas & TV — Roberto",
    email: "antenista@severinno.com",
    profissao: "Antenista",
    avatar: 53,
    bio: "Antenista especializado em instalação de antenas digitais, TV a cabo e reparo de sinal. Atendimento rápido.",
    coverSeed: "antenista-cover",
    cep: "03806-000",
    rua: "Rua São João",
    bairro: "Jardim Santo Eduardo",
    radiusKm: 35,
    servicos: [
      {
        titulo: "Instalação de antena digital",
        desc: "Instalação de antena digital UHF/VHF com sinal de alta definição.",
        preco: 250,
        unidade: "UNIDADE",
        subCat: "Tomadas e interruptores",
        fotoSeed: "ant-serv-1",
      },
      {
        titulo: "Reparo de sinal de TV",
        desc: "Diagnóstico e reparo de problemas de sinal de TV aberta ou fechada.",
        preco: 150,
        unidade: "UNIDADE",
        subCat: "Curto-circuito",
        fotoSeed: "ant-serv-2",
      },
      {
        titulo: "Instalação de TV na parede",
        desc: "Instalação de suporte e fixação de TV na parede. Inclui cabeamento.",
        preco: 200,
        unidade: "UNIDADE",
        subCat: "Tomadas e interruptores",
        fotoSeed: "ant-serv-3",
      },
      {
        titulo: "Configuração de smart TV",
        desc: "Configuração de smart TV, apps e redes Wi-Fi.",
        preco: 100,
        unidade: "UNIDADE",
        subCat: "Tomadas e interruptores",
        fotoSeed: "ant-serv-4",
      },
      {
        titulo: "Instalação de antena coletiva",
        desc: "Instalação e manutenção de antenas coletivas em prédios.",
        preco: 1200,
        unidade: "UNIDADE",
        subCat: "Tomadas e interruptores",
        fotoSeed: "ant-serv-5",
      },
      {
        titulo: "Passagem de cabos",
        desc: "Passagem de cabos coaxiais e de rede embutidos na parede.",
        preco: 120,
        unidade: "UNIDADE",
        subCat: "Tomadas e interruptores",
        fotoSeed: "ant-serv-6",
      },
    ],
  },
  {
    nome: "Serralheria Aço Forte",
    email: "serralheiro@severinno.com",
    profissao: "Serralheiro",
    avatar: 68,
    bio: "Serralheiro especializado em portões, grades e estruturas metálicas. Trabalho sob medida com garantia.",
    coverSeed: "serralheiro-cover",
    cep: "03087-000",
    rua: "Rua Canonhão",
    bairro: "Tatuapé",
    radiusKm: 25,
    servicos: [
      {
        titulo: "Portão de ferro",
        desc: "Fabricação e instalação de portões de ferro basculantes ou de correr.",
        preco: 1800,
        unidade: "UNIDADE",
        subCat: "Pequenas reformas",
        fotoSeed: "ser-serv-1",
      },
      {
        titulo: "Grade de janela",
        desc: "Fabricação e instalação de grades de segurança para janelas.",
        preco: 250,
        unidade: "METRO_QUADRADO",
        subCat: "Pequenas reformas",
        fotoSeed: "ser-serv-2",
      },
      {
        titulo: "Estrutura metálica",
        desc: "Fabricação de estruturas metálicas para mezaninos e coberturas.",
        preco: 350,
        unidade: "METRO_QUADRADO",
        subCat: "Pequenas reformas",
        fotoSeed: "ser-serv-3",
      },
      {
        titulo: "Pintura de portão",
        desc: "Pintura e tratamento anticorrosivo de portões de ferro.",
        preco: 300,
        unidade: "UNIDADE",
        subCat: "Pintura externa",
        fotoSeed: "ser-serv-4",
      },
      {
        titulo: "Conserto de portão",
        desc: "Reparo de portões automáticos e manuais, motores e dobradiças.",
        preco: 200,
        unidade: "UNIDADE",
        subCat: "Pequenas reformas",
        fotoSeed: "ser-serv-5",
      },
      {
        titulo: "Corrimão de ferro",
        desc: "Fabricação e instalação de corrimãos de ferro para escadas.",
        preco: 180,
        unidade: "METRO_LINEAR",
        subCat: "Pequenas reformas",
        fotoSeed: "ser-serv-6",
      },
    ],
  },
  {
    nome: "Vidraçaria CristalLar",
    email: "vidraceiro@severinno.com",
    profissao: "Vidraceiro",
    avatar: 71,
    bio: "Vidraceiro especializado em box, espelhos, janelas e portas de vidro. Vidros temperados e comuns.",
    coverSeed: "vidraceiro-cover",
    cep: "01548-000",
    rua: "Rua do Grito",
    bairro: "Ipiranga",
    radiusKm: 28,
    servicos: [
      {
        titulo: "Box de vidro temperado",
        desc: "Fabricação e instalação de box de banheiro em vidro temperado.",
        preco: 1200,
        unidade: "UNIDADE",
        subCat: "Pequenas reformas",
        fotoSeed: "vid-serv-1",
      },
      {
        titulo: "Espelho sob medida",
        desc: "Corte e instalação de espelhos sob medida para banheiro e quarto.",
        preco: 180,
        unidade: "METRO_QUADRADO",
        subCat: "Pequenas reformas",
        fotoSeed: "vid-serv-2",
      },
      {
        titulo: "Janela de vidro",
        desc: "Instalação de janelas de vidro temperado ou comum.",
        preco: 350,
        unidade: "UNIDADE",
        subCat: "Pequenas reformas",
        fotoSeed: "vid-serv-3",
      },
      {
        titulo: "Porta de vidro",
        desc: "Instalação de portas de vidro temperado com ferragens.",
        preco: 1500,
        unidade: "UNIDADE",
        subCat: "Pequenas reformas",
        fotoSeed: "vid-serv-4",
      },
      {
        titulo: "Troca de vidro quebrado",
        desc: "Substituição de vidros quebrados em janelas, portas e box.",
        preco: 200,
        unidade: "UNIDADE",
        subCat: "Pequenas reformas",
        fotoSeed: "vid-serv-5",
      },
      {
        titulo: "Vidro jateado",
        desc: "Aplicação de jateado decorativo em vidros para privacidade.",
        preco: 120,
        unidade: "METRO_QUADRADO",
        subCat: "Pintura interna",
        fotoSeed: "vid-serv-6",
      },
    ],
  },
]

// ---------------------------------------------------------------------------
// Categorias (3 níveis, expandidas)
// ---------------------------------------------------------------------------

const CATEGORIAS = [
  // nivel 0 (pais)
  { nome: "Reparos", level: 0, icon: "wrench" },
  { nome: "Limpeza", level: 0, icon: "sparkles" },
  { nome: "Reforma", level: 0, icon: "hammer" },
  // nivel 1 (filhas)
  { nome: "Elétrica", parent: "Reparos", level: 1, icon: "zap" },
  { nome: "Hidráulica", parent: "Reparos", level: 1, icon: "droplet" },
  { nome: "Pintura", parent: "Reparos", level: 1, icon: "brush" },
  { nome: "Residencial", parent: "Limpeza", level: 1, icon: "home" },
  { nome: "Pós-Obra", parent: "Limpeza", level: 1, icon: "broom" },
  { nome: "Pisos", parent: "Reforma", level: 1, icon: "square" },
  { nome: "Alvenaria", parent: "Reforma", level: 1, icon: "brick" },
  // nivel 2 (subcategorias)
  { nome: "Tomadas e interruptores", parent: "Elétrica", level: 2 },
  { nome: "Curto-circuito", parent: "Elétrica", level: 2 },
  { nome: "Quadro elétrico", parent: "Elétrica", level: 2 },
  { nome: "Desentupimento", parent: "Hidráulica", level: 2 },
  { nome: "Vazamento", parent: "Hidráulica", level: 2 },
  { nome: "Caixa de descarga", parent: "Hidráulica", level: 2 },
  { nome: "Pintura interna", parent: "Pintura", level: 2 },
  { nome: "Pintura externa", parent: "Pintura", level: 2 },
  { nome: "Textura e grafiato", parent: "Pintura", level: 2 },
  { nome: "Limpeza geral", parent: "Residencial", level: 2 },
  { nome: "Organização", parent: "Residencial", level: 2 },
  { nome: "Limpeza pós-obra", parent: "Pós-Obra", level: 2 },
  { nome: "Assentamento de piso", parent: "Pisos", level: 2 },
  { nome: "Rejunte", parent: "Pisos", level: 2 },
  { nome: "Pequenas reformas", parent: "Alvenaria", level: 2 },
  { nome: "Contrapiso", parent: "Alvenaria", level: 2 },
  { nome: "Poda de árvores", parent: "Alvenaria", level: 2 },
]

async function main() {
  console.log("🌱 Severinno — povoamento completo iniciando...")

  // --- wipe -------------------------------------------------------
  console.log("   • limpando dados existentes...")
  await db.payment.deleteMany()
  await db.review.deleteMany()
  await db.message.deleteMany()
  await db.notification.deleteMany()
  await db.favorite.deleteMany()
  await db.quoteItem.deleteMany()
  await db.quoteRequest.deleteMany()
  await db.booking.deleteMany()
  await db.providerAvailability.deleteMany()
  await db.service.deleteMany()
  await db.setting.deleteMany()
  await db.category.deleteMany()
  await db.user.deleteMany()

  // --- senha única ------------------------------------------------
  const adminPw = await hashPassword("admin123")
  const clientPw = await hashPassword("cliente123")
  const providerPw = await hashPassword("provider123")

  // --- ADMIN ------------------------------------------------------
  console.log("   • criando admin...")
  const admin = await db.user.create({
    data: {
      email: "admin@severinno.com",
      passwordHash: adminPw,
      name: "Administrador Severinno",
      role: "ADMIN",
      verified: true,
      active: true,
      phone: "(11) 4000-0000",
      whatsapp: "(11) 90000-0000",
      city: "São Paulo",
      state: "SP",
      avatarUrl: "https://i.pravatar.cc/300?img=68",
    },
  })

  // --- 10 CLIENTES ------------------------------------------------
  console.log("   • criando 10 clientes com foto de perfil...")
  const clientes = []
  for (let i = 0; i < CLIENTES.length; i++) {
    const c = CLIENTES[i]!
    const cliente = await db.user.create({
      data: {
        email: c.email,
        passwordHash: clientPw,
        name: c.nome,
        role: "CLIENT",
        verified: true,
        active: true,
        cpfCnpj: randCpf(),
        whatsapp: randPhone("(11)"),
        phone: randPhone("(11)"),
        cep: c.cep,
        street: c.rua,
        number: c.num,
        district: c.bairro,
        city: "São Paulo",
        state: "SP",
        lat: jitter(SP_LAT, 0.015),
        lng: jitter(SP_LNG, 0.015),
        avatarUrl: `https://i.pravatar.cc/300?img=${c.avatar}`,
      },
    })
    clientes.push(cliente)
  }

  // --- 12 PRESTADORES ---------------------------------------------
  console.log("   • criando 12 prestadores com foto de perfil...")
  const prestadores = []
  for (const p of PRESTADORES) {
    const prestador = await db.user.create({
      data: {
        email: p.email,
        passwordHash: providerPw,
        name: p.nome,
        role: "PROVIDER",
        verified: true,
        active: true,
        bio: p.bio,
        avatarUrl: `https://i.pravatar.cc/300?img=${p.avatar}`,
        coverUrl: `https://picsum.photos/seed/${p.coverSeed}/800/300`,
        cep: p.cep,
        street: p.rua,
        number: String(Math.floor(Math.random() * 1500) + 100),
        district: p.bairro,
        city: "São Paulo",
        state: "SP",
        lat: jitter(SP_LAT, 0.035),
        lng: jitter(SP_LNG, 0.035),
        radiusKm: p.radiusKm,
        whatsapp: randPhone("(11)"),
        phone: randPhone("(11)"),
        cpfCnpj: randCpf(),
      },
    })
    prestadores.push({ user: prestador, data: p })
  }

  // --- DISPONIBILIDADE (seg-sáb) ----------------------------------
  console.log("   • criando disponibilidades...")
  for (const p of prestadores) {
    for (const dow of [1, 2, 3, 4, 5, 6]) {
      await db.providerAvailability.create({
        data: {
          providerId: p.user.id,
          dayOfWeek: dow,
          startTime: "08:00",
          endTime: dow === 6 ? "12:00" : "18:00",
          active: true,
        },
      })
    }
  }

  // --- CATEGORIAS -------------------------------------------------
  console.log("   • criando categorias (3 níveis)...")
  const catByName: Record<string, string> = {}
  const sortedCats = [...CATEGORIAS].sort((a, b) => a.level - b.level)
  for (const c of sortedCats) {
    const created = await db.category.create({
      data: {
        name: c.nome,
        slug: slugify(c.nome) + (c.parent ? "-" + slugify(c.parent!) : ""),
        parentId: c.parent ? catByName[c.parent] : null,
        level: c.level,
        icon: c.icon ?? null,
        order: c.level === 0 ? ["Reparos", "Limpeza", "Reforma"].indexOf(c.nome) : 0,
        active: true,
      },
    })
    catByName[c.nome] = created.id
  }

  // --- SERVIÇOS (6 por prestador = 72 total) ----------------------
  console.log("   • criando 72 serviços (6 por prestador)...")
  const allServices: { id: string; providerId: string; basePrice: number; title: string }[] = []
  for (const p of prestadores) {
    for (const s of p.data.servicos) {
      const catId = catByName[s.subCat]
      if (!catId) {
        console.warn(`   ⚠ categoria não encontrada: ${s.subCat}`)
        continue
      }
      const created = await db.service.create({
        data: {
          providerId: p.user.id,
          categoryId: catId,
          title: s.titulo,
          description: s.desc,
          basePrice: s.preco,
          unit: s.unidade as any,
          photos: [
            `https://picsum.photos/seed/${s.fotoSeed}-1/800/600`,
            `https://picsum.photos/seed/${s.fotoSeed}-2/800/600`,
          ],
          active: true,
        },
      })
      allServices.push({
        id: created.id,
        providerId: p.user.id,
        basePrice: s.preco,
        title: s.titulo,
      })
    }
  }

  // --- 12 ORÇAMENTOS (QuoteRequest + QuoteItem) -------------------
  console.log("   • criando 12 orçamentos...")
  const now = Date.now()
  const daysAgo = (n: number) => new Date(now - n * 24 * 60 * 60 * 1000)
  const daysAhead = (n: number) => new Date(now + n * 24 * 60 * 60 * 1000)
  const quoteStatuses = ["PENDING", "RESPONDED", "APPROVED", "REJECTED", "EXPIRED"]
  const createdQuotes: { id: string }[] = []

  for (let i = 0; i < 12; i++) {
    const cliente = clientes[i % clientes.length]!
    const prestador = prestadores[i % prestadores.length]!
    const service = allServices.find((s) => s.providerId === prestador.user.id)
    if (!service) continue

    const status = quoteStatuses[i % quoteStatuses.length]!
    const createdAt = daysAgo(30 - i * 2)

    const quote = await db.quoteRequest.create({
      data: {
        clientId: cliente.id,
        providerId: prestador.user.id,
        status: status as any,
        address: `${cliente.street ?? "Endereço"}, ${cliente.number ?? "s/n"}`,
        cep: cliente.cep ?? "00000-000",
        lat: cliente.lat ?? SP_LAT,
        lng: cliente.lng ?? SP_LNG,
        expiresAt: new Date(createdAt.getTime() + 7 * 24 * 60 * 60 * 1000),
        createdAt,
      },
    })

    // QuoteItem
    await db.quoteItem.create({
      data: {
        requestId: quote.id,
        providerId: prestador.user.id,
        serviceId: service.id,
        description: `Orçamento para ${service.title}`,
        quantity: 1,
        unit: "UNIDADE",
        price: status === "RESPONDED" || status === "APPROVED" ? service.basePrice : null,
        providerNote:
          status === "RESPONDED" || status === "APPROVED"
            ? "Valor dentro do orçamento. Pode agendar."
            : null,
        status:
          status === "APPROVED"
            ? "ACCEPTED"
            : status === "REJECTED"
              ? "REJECTED"
              : status === "RESPONDED"
                ? "QUOTED"
                : "PENDING",
        createdAt,
      },
    })
    createdQuotes.push({ id: quote.id })
  }

  // --- 12 AGENDAMENTOS (Booking) + 12 TRANSAÇÕES (Payment) --------
  console.log("   • criando 12 agendamentos + 12 transações + avaliações...")
  const bookingStatuses = [
    "COMPLETED",
    "COMPLETED",
    "COMPLETED",
    "CONFIRMED",
    "IN_PROGRESS",
    "PENDING",
    "COMPLETED",
    "CANCELLED",
    "COMPLETED",
    "CONFIRMED",
    "COMPLETED",
    "IN_PROGRESS",
  ]
  const paymentStatuses: Record<string, string> = {
    COMPLETED: "PAID",
    CONFIRMED: "PAID",
    IN_PROGRESS: "PAID",
    PENDING: "PENDING",
    CANCELLED: "REFUNDED",
  }
  const comentarios = [
    "Excelente trabalho! Profissional pontual e dedicado. Recomendo!",
    "Ótimo serviço, resolveu o problema rapidamente. Valeu cada centavo.",
    "Muito atencioso e profissional. Deixou tudo limpo após o serviço.",
    "Chegou no horário, fez o orçamento correto e executou com qualidade.",
    "Super recomendado! Trabalho de altíssima qualidade e preço justo.",
    "Profissional excelente! Com certeza contratarei novamente.",
  ]

  for (let i = 0; i < 12; i++) {
    const cliente = clientes[i % clientes.length]!
    const prestador = prestadores[i % prestadores.length]!
    const service = allServices.find((s) => s.providerId === prestador.user.id)
    if (!service) continue

    const status = bookingStatuses[i]!
    const scheduledAt = i < 7 ? daysAgo(25 - i * 2) : daysAhead((i - 6) * 3)
    const amount = service.basePrice * (1 + Math.random() * 0.3)
    const payStatus = paymentStatuses[status]!

    const booking = await db.booking.create({
      data: {
        clientId: cliente.id,
        providerId: prestador.user.id,
        serviceId: service.id,
        scheduledAt,
        status: status as any,
        address: `${cliente.street ?? "Endereço"}, ${cliente.number ?? "s/n"}`,
        cep: cliente.cep ?? "00000-000",
        lat: cliente.lat ?? SP_LAT,
        lng: cliente.lng ?? SP_LNG,
        amount,
        paymentMethod: i % 2 === 0 ? "PIX" : "CARD",
        paymentStatus: payStatus as any,
        notes: "Agendamento realizado via marketplace Severinno.",
      },
    })

    // Payment (transação)
    await db.payment.create({
      data: {
        bookingId: booking.id,
        amount,
        method: i % 2 === 0 ? "PIX" : "CARD",
        status: payStatus as any,
        transactionId: "TX" + booking.id.toUpperCase().slice(-10),
      },
    })

    // Review (apenas para COMPLETED)
    if (status === "COMPLETED") {
      await db.review.create({
        data: {
          bookingId: booking.id,
          clientId: cliente.id,
          providerId: prestador.user.id,
          serviceId: service.id,
          rating: 4 + (i % 2),
          comment: comentarios[i % comentarios.length]!,
        },
      })
    }

    // Notificação para o prestador
    await db.notification.create({
      data: {
        userId: prestador.user.id,
        type: status === "PENDING" ? "BOOKING_REQUEST" : "BOOKING_CONFIRMED",
        title: `Novo agendamento: ${service.title}`,
        body: `Cliente: ${cliente.name} · ${new Date(scheduledAt).toLocaleString("pt-BR")}`,
        read: false,
      },
    })
  }

  // --- FAVORITOS --------------------------------------------------
  console.log("   • criando favoritos...")
  for (let i = 0; i < 10; i++) {
    const cliente = clientes[i]!
    const prestador = prestadores[i % prestadores.length]!
    try {
      await db.favorite.create({
        data: { clientId: cliente.id, providerId: prestador.user.id },
      })
    } catch {
      // unique constraint — ignore duplicates
    }
  }

  // --- NOTIFICAÇÕES DE BOAS-VINDAS --------------------------------
  console.log("   • criando notificações de boas-vindas...")
  for (const u of [admin, ...clientes, ...prestadores.map((p) => p.user)]) {
    await db.notification.create({
      data: {
        userId: u.id,
        type: "WELCOME",
        title: `Bem-vindo ao Severinno, ${u.name.split(" ")[0]}!`,
        body: "Sua conta foi criada com sucesso. Comece a explorar o marketplace agora mesmo.",
        read: false,
      },
    })
  }

  // --- SETTINGS ---------------------------------------------------
  console.log("   • criando configurações...")
  const settings = [
    { key: "site_name", value: "Severinno" },
    { key: "site_tagline", value: "Marketplace de serviços com geolocalização" },
    { key: "support_email", value: "suporte@severinno.com" },
    { key: "payment_pix_key", value: "suporte@severinno.com" },
    { key: "nominatim_enabled", value: "true" },
    { key: "viacep_enabled", value: "true" },
    { key: "default_search_radius_km", value: "15" },
    { key: "quote_default_expiry_hours", value: "72" },
  ]
  for (const s of settings) {
    await db.setting.create({
      data: { key: s.key, value: s.value, updatedBy: admin.id },
    })
  }

  // --- RESUMO -----------------------------------------------------
  const counts = {
    users: await db.user.count(),
    clients: await db.user.count({ where: { role: "CLIENT" } }),
    providers: await db.user.count({ where: { role: "PROVIDER" } }),
    admins: await db.user.count({ where: { role: "ADMIN" } }),
    categories: await db.category.count(),
    services: await db.service.count(),
    availabilities: await db.providerAvailability.count(),
    quotes: await db.quoteRequest.count(),
    quoteItems: await db.quoteItem.count(),
    bookings: await db.booking.count(),
    payments: await db.payment.count(),
    reviews: await db.review.count(),
    favorites: await db.favorite.count(),
    notifications: await db.notification.count(),
    settings: await db.setting.count(),
  }

  console.log("")
  console.log("✅ Povoamento concluído com sucesso!")
  console.log("   📊 Resumo:")
  console.log(
    `      • Usuários:     ${counts.users} (1 admin + ${counts.clients} clientes + ${counts.providers} prestadores)`,
  )
  console.log(`      • Categorias:   ${counts.categories}`)
  console.log(`      • Serviços:     ${counts.services}`)
  console.log(`      • Disponibilidades: ${counts.availabilities}`)
  console.log(`      • Orçamentos:   ${counts.quotes} (${counts.quoteItems} itens)`)
  console.log(`      • Agendamentos: ${counts.bookings}`)
  console.log(`      • Transações:   ${counts.payments}`)
  console.log(`      • Avaliações:   ${counts.reviews}`)
  console.log(`      • Favoritos:    ${counts.favorites}`)
  console.log(`      • Notificações: ${counts.notifications}`)
  console.log(`      • Configurações: ${counts.settings}`)
  console.log("")
  console.log("   🔑 Credenciais de acesso:")
  console.log("      admin@severinno.com      / admin123")
  console.log("      cliente{1-10}@severinno.com / cliente123")
  console.log("      carlos@severinno.com     / provider123")
  console.log("      ricardo@severinno.com    / provider123")
  console.log("      lima@severinno.com       / provider123")
  console.log("      fernanda@severinno.com   / provider123")
  console.log("      pedro@severinno.com      / provider123")
  console.log("      antonio@severinno.com    / provider123")
  console.log("      marceneiro@severinno.com / provider123")
  console.log("      arquiteta@severinno.com  / provider123")
  console.log("      gesseiro@severinno.com   / provider123")
  console.log("      antenista@severinno.com  / provider123")
  console.log("      serralheiro@severinno.com / provider123")
  console.log("      vidraceiro@severinno.com / provider123")
}

main()
  .catch((e) => {
    console.error("❌ Erro no povoamento:", e)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
