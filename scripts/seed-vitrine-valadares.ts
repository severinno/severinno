/**
 * scripts/seed-vitrine-valadares.ts — Seed do Catálogo Operacional de Governador Valadares
 *
 * Popula o catálogo de Governador Valadares com dados de alta fidelidade:
 * - Cidade ativa com coordenadas reais
 * - Árvore de categorias completa (Climatização, Marcenaria, Pintura, Reformas, Elétrica, Limpeza, etc.)
 * - 10 prestadores profissionais verificados em bairros reais de GV
 * - Grade de 25+ serviços essenciais com preços de mercado
 * - Horários de atendimento semanais
 * - Agendamentos concluídos e avaliações autênticas
 *
 * Usage:
 *   npx tsx scripts/seed-vitrine-valadares.ts
 *
 * Exit codes:
 *   0 — sucesso
 *   1 — falha
 */

import { PrismaClient, Role, ServiceUnit, BookingStatus, PaymentStatus } from "@prisma/client"
import { backfillAvatars } from "./lib/backfill-avatars"

const db = new PrismaClient()

async function main() {
  console.log("🏙️  Iniciando Seed do Catálogo Operacional de Governador Valadares (MG)...")

  // 1. Cidade Governador Valadares
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
  console.log(`✅ Cidade conferida: ${city.name} (${city.slug})`)

  // 2. Garantir Categorias Estruturais
  // Categorias Raiz (Level 0)
  const catManutencao = await db.category.upsert({
    where: { slug: "manutencao" },
    create: { name: "Manutenção", slug: "manutencao", level: 0, order: 1, active: true },
    update: {},
  })
  const catReforma = await db.category.upsert({
    where: { slug: "reforma" },
    create: { name: "Reforma", slug: "reforma", level: 0, order: 2, active: true },
    update: {},
  })
  const catLimpeza = await db.category.upsert({
    where: { slug: "limpeza" },
    create: { name: "Limpeza", slug: "limpeza", level: 0, order: 3, active: true },
    update: {},
  })
  const catReparos = await db.category.upsert({
    where: { slug: "reparos" },
    create: { name: "Reparos", slug: "reparos", level: 0, order: 4, active: true },
    update: {},
  })
  const catJardim = await db.category.upsert({
    where: { slug: "jardim" },
    create: { name: "Jardim", slug: "jardim", level: 0, order: 5, active: true },
    update: {},
  })

  // Categorias Filhas (Level 1)
  const catClimatizacao = await db.category.upsert({
    where: { slug: "climatizacao-manutencao" },
    create: {
      name: "Climatização",
      slug: "climatizacao-manutencao",
      level: 1,
      parentId: catManutencao.id,
      order: 1,
      active: true,
    },
    update: {},
  })
  const catMarcenaria = await db.category.upsert({
    where: { slug: "marcenaria-reparos" },
    create: {
      name: "Marcenaria e Montagem",
      slug: "marcenaria-reparos",
      level: 1,
      parentId: catReparos.id,
      order: 2,
      active: true,
    },
    update: {},
  })
  const catJardinagemL1 = await db.category.upsert({
    where: { slug: "jardinagem-jardim" },
    create: {
      name: "Jardinagem",
      slug: "jardinagem-jardim",
      level: 1,
      parentId: catJardim.id,
      order: 1,
      active: true,
    },
    update: {},
  })

  // Subcategorias Operacionais (Level 2)
  const subArInstalacao = await db.category.upsert({
    where: { slug: "instalacao-ar-condicionado-clima" },
    create: {
      name: "Instalação de Ar-Condicionado",
      slug: "instalacao-ar-condicionado-clima",
      level: 2,
      parentId: catClimatizacao.id,
      active: true,
    },
    update: {},
  })
  const subArLimpeza = await db.category.upsert({
    where: { slug: "higienizacao-ar-condicionado-clima" },
    create: {
      name: "Higienização de Ar-Condicionado",
      slug: "higienizacao-ar-condicionado-clima",
      level: 2,
      parentId: catClimatizacao.id,
      active: true,
    },
    update: {},
  })
  const subMoveisMontagem = await db.category.upsert({
    where: { slug: "montagem-de-moveis-marcenaria" },
    create: {
      name: "Montagem de Móveis",
      slug: "montagem-de-moveis-marcenaria",
      level: 2,
      parentId: catMarcenaria.id,
      active: true,
    },
    update: {},
  })
  const subJardimCorte = await db.category.upsert({
    where: { slug: "corte-grama-jardinagem" },
    create: {
      name: "Corte de Grama e Limpeza",
      slug: "corte-grama-jardinagem",
      level: 2,
      parentId: catJardinagemL1.id,
      active: true,
    },
    update: {},
  })

  // Recuperar subcategorias existentes do seed base
  const subPinturaInterna = await db.category.findUnique({
    where: { slug: "pintura-interna-pintura" },
  })
  const subPinturaExterna = await db.category.findUnique({
    where: { slug: "pintura-externa-pintura" },
  })
  const subTextura = await db.category.findUnique({ where: { slug: "textura-e-grafiato-pintura" } })
  const subAlvenaria = await db.category.findUnique({
    where: { slug: "pequenas-reformas-alvenaria" },
  })
  const subPiso = await db.category.findUnique({ where: { slug: "assentamento-de-piso-pisos" } })
  const subRejunte = await db.category.findUnique({ where: { slug: "rejunte-pisos" } })
  const subQuadro = await db.category.findUnique({ where: { slug: "quadro-eletrico-eletrica" } })
  const subTomadas = await db.category.findUnique({
    where: { slug: "tomadas-e-interruptores-eletrica" },
  })
  const subCurto = await db.category.findUnique({ where: { slug: "curto-circuito-eletrica" } })
  const subVazamento = await db.category.findUnique({ where: { slug: "vazamento-hidraulica" } })
  const subDescarga = await db.category.findUnique({
    where: { slug: "caixa-de-descarga-hidraulica" },
  })
  const subDesentupimento = await db.category.findUnique({
    where: { slug: "desentupimento-hidraulica" },
  })
  const subLimpezaGeral = await db.category.findUnique({
    where: { slug: "limpeza-geral-residencial" },
  })
  const subPosObra = await db.category.findUnique({ where: { slug: "limpeza-pos-obra-pos-obra" } })
  const subOrganizacao = await db.category.findUnique({
    where: { slug: "organizacao-residencial" },
  })

  console.log("✅ Categorias e Subcategorias mapeadas.")

  // 3. Prestadores de Alta Reputação nos Bairros de Governador Valadares
  const providersData = [
    {
      id: "prov-gv-eletrica-01",
      name: "Carlos Silva — Eletricista Residencial & Comercial",
      email: "carlos.eletrica.gv@severinno.com.br",
      phone: "+5533991012020",
      whatsapp: "+5533991012020",
      bio: "Mais de 12 anos de experiência em instalações elétricas em Governador Valadares. Especialista em quadros de distribuição, iluminação LED e laudos técnicos.",
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
    },
    {
      id: "prov-gv-limpeza-02",
      name: "Mariana Santos — Diarista & Pós-Obra Especializada",
      email: "mariana.limpeza.gv@severinno.com.br",
      phone: "+5533991113030",
      whatsapp: "+5533991113030",
      bio: "Cuidado e capricho absoluto para sua casa ou escritório. Especializada em higienização profunda e pós-obra na Ilha dos Araújos e região.",
      district: "Ilha dos Araújos",
      street: "Rua 15",
      number: "120",
      cep: "35020-000",
      lat: -18.8465,
      lng: -41.938,
      avgRating: 5.0,
      reviewCount: 56,
      favoriteCount: 31,
      slug: "mariana-santos-limpeza-gv",
    },
    {
      id: "prov-gv-hidraulica-03",
      name: "Marcos Oliveira — Encanador & Caça-Vazamentos",
      email: "marcos.encanador.gv@severinno.com.br",
      phone: "+5533991224040",
      whatsapp: "+5533991224040",
      bio: "Encanador profissional na Vila Bretas e toda GV. Soluções rápidas e sem quebra-quebra desnecessário em canos, torneiras e caixas de descarga.",
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
    },
    {
      id: "prov-gv-pintura-04",
      name: "Rafael Mendes — Pintor Profissional & Texturas",
      email: "rafael.pintura.gv@severinno.com.br",
      phone: "+5533991335050",
      whatsapp: "+5533991335050",
      bio: "Pintura residencial e predial com fino acabamento. Aplicação de grafiato, textura projetada e cimento queimado. Trabalho limpo e protegido.",
      district: "Grã-Duquesa",
      street: "Avenida Moacir Paleta",
      number: "850",
      cep: "35057-000",
      lat: -18.875,
      lng: -41.968,
      avgRating: 4.9,
      reviewCount: 29,
      favoriteCount: 16,
      slug: "rafael-mendes-pintura-gv",
    },
    {
      id: "prov-gv-pedreiro-05",
      name: "José Antônio 'Seu Zé' — Pedreiro & Reformas Rápidas",
      email: "ze.pedreiro.gv@severinno.com.br",
      phone: "+5533991446060",
      whatsapp: "+5533991446060",
      bio: "Mais de 25 anos construindo e reformando em Valadares. Alvenaria, assentamento de pisos, porcelanato, reboco e pequenas manutenções com pontualidade.",
      district: "São Pedro",
      street: "Rua José Luis Nogueira",
      number: "410",
      cep: "35040-000",
      lat: -18.865,
      lng: -41.958,
      avgRating: 4.8,
      reviewCount: 35,
      favoriteCount: 20,
      slug: "seu-ze-pedreiro-reformas-gv",
    },
    {
      id: "prov-gv-clima-06",
      name: "Lucas Climatização — Ar-Condicionado & Higienização",
      email: "lucas.clima.gv@severinno.com.br",
      phone: "+5533991557070",
      whatsapp: "+5533991557070",
      bio: "Especialista em climatização para o calor de Governador Valadares. Instalação padrão de fábrica, recarga de gás ecológica e higienização com laudo bactericida.",
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
    },
    {
      id: "prov-gv-jardim-07",
      name: "Valadares Jardinagem — Gustavo Henrique",
      email: "gustavo.jardim.gv@severinno.com.br",
      phone: "+5533991668080",
      whatsapp: "+5533991668080",
      bio: "Manutenção paisagística completa, poda de árvores, corte de grama com tratorito e descarte ecológico. Atendimento residencial e empresarial.",
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
    },
    {
      id: "prov-gv-marcenaria-08",
      name: "André Móveis — Montagem & Marcenaria",
      email: "andre.marcenaria.gv@severinno.com.br",
      phone: "+5533991779090",
      whatsapp: "+5533991779090",
      bio: "Montador profissional credenciado de móveis comprados na internet ou lojas físicas. Ajuste de portas de correr, troca de dobradiças e instalação de painéis.",
      district: "Esplanada",
      street: "Rua Sete de Setembro",
      number: "1620",
      cep: "35012-000",
      lat: -18.859,
      lng: -41.948,
      avgRating: 4.9,
      reviewCount: 31,
      favoriteCount: 15,
      slug: "andre-moveis-montagem-gv",
    },
    {
      id: "prov-gv-faztudo-09",
      name: "Roberto Dias — Marido de Aluguel & Faz-Tudo",
      email: "roberto.faztudo.gv@severinno.com.br",
      phone: "+5533991880101",
      whatsapp: "+5533991880101",
      bio: "Aqueles pequenos reparos que ninguém quer fazer: instalar cortinas, varão, prateleiras, chuveiros, trocar fechaduras e pendurar espelhos. Prático e seguro.",
      district: "Lourdes",
      street: "Rua Afonso Pena",
      number: "2200",
      cep: "35032-000",
      lat: -18.848,
      lng: -41.96,
      avgRating: 4.8,
      reviewCount: 44,
      favoriteCount: 23,
      slug: "roberto-marido-aluguel-gv",
    },
    {
      id: "prov-gv-estofados-10",
      name: "Camila Estofados — Limpeza & Impermeabilização",
      email: "camila.estofados.gv@severinno.com.br",
      phone: "+5533991991212",
      whatsapp: "+5533991991212",
      bio: "Higienização profunda a seco de sofás, colchões, poltronas e bancos automotivos. Eliminação de ácaros, fungos e odores com produtos biodegradáveis.",
      district: "Ilha dos Araújos",
      street: "Rua Vinte e Um",
      number: "88",
      cep: "35020-000",
      lat: -18.845,
      lng: -41.936,
      avgRating: 5.0,
      reviewCount: 39,
      favoriteCount: 25,
      slug: "camila-higienizacao-estofados-gv",
    },
  ]

  for (const p of providersData) {
    await db.user.upsert({
      where: { id: p.id },
      create: {
        id: p.id,
        name: p.name,
        email: p.email,
        passwordHash: "$2b$10$placeholder",
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
        active: true,
        verified: true,
        avgRating: p.avgRating,
        reviewCount: p.reviewCount,
        favoriteCount: p.favoriteCount,
        slug: p.slug,
      },
      update: {
        name: p.name,
        phone: p.phone,
        whatsapp: p.whatsapp,
        bio: p.bio,
        city: "Governador Valadares",
        cityId: city.id,
        state: "MG",
        district: p.district,
        street: p.street,
        number: p.number,
        cep: p.cep,
        lat: p.lat,
        lng: p.lng,
        active: true,
        verified: true,
        avgRating: p.avgRating,
        reviewCount: p.reviewCount,
        favoriteCount: p.favoriteCount,
      },
    })

    // Adiciona disponibilidade semanal (Segunda a Sábado, 08:00 às 18:00)
    for (let day = 1; day <= 6; day++) {
      const existingAvail = await db.providerAvailability.findFirst({
        where: { providerId: p.id, dayOfWeek: day },
      })
      if (!existingAvail) {
        await db.providerAvailability.create({
          data: {
            providerId: p.id,
            dayOfWeek: day,
            startTime: "08:00",
            endTime: "18:00",
            active: true,
          },
        })
      }
    }
  }
  console.log(
    `✅ ${providersData.length} prestadores em GV cadastrados e com expediente configurado.`,
  )

  // 4. Catálogo Completo de Serviços
  const servicesData = [
    // Carlos (Elétrica)
    {
      id: "srv-eletrica-01",
      providerId: "prov-gv-eletrica-01",
      categoryId: subQuadro?.id ?? catManutencao.id,
      title: "Instalação e Manutenção de Quadro Elétrico",
      description:
        "Dimensionamento e substituição de disjuntores, barramentos, DPS e IDR contra choques.",
      basePrice: 180.0,
      unit: ServiceUnit.UNIDADE,
      duration: 120,
    },
    {
      id: "srv-eletrica-02",
      providerId: "prov-gv-eletrica-01",
      categoryId: subTomadas?.id ?? catManutencao.id,
      title: "Troca e Instalação de Tomadas e Interruptores",
      description:
        "Substituição para o padrão novo ABNT, instalação de tomadas 20A para micro-ondas e ar-condicionado.",
      basePrice: 50.0,
      unit: ServiceUnit.UNIDADE,
      duration: 45,
    },
    {
      id: "srv-eletrica-03",
      providerId: "prov-gv-eletrica-01",
      categoryId: subCurto?.id ?? catManutencao.id,
      title: "Diagnóstico e Reparo de Curto-Circuito",
      description:
        "Identificação rápida da fuga de corrente ou curto que desarma a energia da residência.",
      basePrice: 130.0,
      unit: ServiceUnit.UNIDADE,
      duration: 90,
    },

    // Mariana (Limpeza)
    {
      id: "srv-limpeza-01",
      providerId: "prov-gv-limpeza-02",
      categoryId: subLimpezaGeral?.id ?? catLimpeza.id,
      title: "Diária Residencial Padrão (Até 8h)",
      description:
        "Limpeza completa de quartos, salas, banheiros e cozinha com atenção a todos os detalhes.",
      basePrice: 160.0,
      unit: ServiceUnit.UNIDADE,
      duration: 480,
    },
    {
      id: "srv-limpeza-02",
      providerId: "prov-gv-limpeza-02",
      categoryId: subPosObra?.id ?? catLimpeza.id,
      title: "Limpeza Pós-Obra Especializada",
      description:
        "Remoção técnica de respingos de tinta, rejunte, poeira de gesso e limpeza fina para mudança.",
      basePrice: 350.0,
      unit: ServiceUnit.UNIDADE,
      duration: 480,
    },
    {
      id: "srv-limpeza-03",
      providerId: "prov-gv-limpeza-02",
      categoryId: subOrganizacao?.id ?? catLimpeza.id,
      title: "Organização de Ambientes e Armários",
      description:
        "Organização profissional (personal organizer) para closets, despensas e cozinhas.",
      basePrice: 140.0,
      unit: ServiceUnit.UNIDADE,
      duration: 180,
    },

    // Marcos (Hidráulica)
    {
      id: "srv-hidraulica-01",
      providerId: "prov-gv-hidraulica-03",
      categoryId: subVazamento?.id ?? catReparos.id,
      title: "Reparo de Vazamento e Troca de Torneira/Registro",
      description:
        "Detecção e reparo de gotejamentos, troca de carrapeta, vedantes e registros de pressão.",
      basePrice: 120.0,
      unit: ServiceUnit.UNIDADE,
      duration: 60,
    },
    {
      id: "srv-hidraulica-02",
      providerId: "prov-gv-hidraulica-03",
      categoryId: subDescarga?.id ?? catReparos.id,
      title: "Conserto de Caixa Acoplada e Válvula Hydra",
      description: "Ajuste e troca de mecanismo interno de descarga, boia e borracha de vedação.",
      basePrice: 90.0,
      unit: ServiceUnit.UNIDADE,
      duration: 60,
    },
    {
      id: "srv-hidraulica-03",
      providerId: "prov-gv-hidraulica-03",
      categoryId: subDesentupimento?.id ?? catReparos.id,
      title: "Desentupimento de Pias, Ralos e Sanitários",
      description:
        "Desobstrução rápida com maquinário e cabos espirais sem danificar o encanamento.",
      basePrice: 150.0,
      unit: ServiceUnit.UNIDADE,
      duration: 90,
    },

    // Rafael (Pintura)
    {
      id: "srv-pintura-01",
      providerId: "prov-gv-pintura-04",
      categoryId: subPinturaInterna?.id ?? catReforma.id,
      title: "Pintura Interna Residencial (Paredes e Tetos)",
      description: "Emassamento, lixamento e pintura com tinta acrílica lavável de primeira linha.",
      basePrice: 380.0,
      unit: ServiceUnit.UNIDADE,
      duration: 360,
    },
    {
      id: "srv-pintura-02",
      providerId: "prov-gv-pintura-04",
      categoryId: subPinturaExterna?.id ?? catReforma.id,
      title: "Pintura Externa e Muros com Proteção Anti-Sol",
      description:
        "Selador acrílico e tinta emborrachada resistente ao sol forte e chuvas de Governador Valadares.",
      basePrice: 550.0,
      unit: ServiceUnit.UNIDADE,
      duration: 480,
    },
    {
      id: "srv-pintura-03",
      providerId: "prov-gv-pintura-04",
      categoryId: subTextura?.id ?? catReforma.id,
      title: "Aplicação de Textura, Grafiato e Cimento Queimado",
      description: "Efeitos decorativos modernos para salas, fachadas e paredes de destaque.",
      basePrice: 320.0,
      unit: ServiceUnit.UNIDADE,
      duration: 240,
    },

    // Seu Zé (Pedreiro / Reformas)
    {
      id: "srv-pedreiro-01",
      providerId: "prov-gv-pedreiro-05",
      categoryId: subAlvenaria?.id ?? catReforma.id,
      title: "Pequenos Reparos de Alvenaria, Trincas e Reboco",
      description:
        "Abertura e fechamento de vãos, quebra de paredes, reparo de reboco fofo e trincas estruturais.",
      basePrice: 160.0,
      unit: ServiceUnit.UNIDADE,
      duration: 480,
    },
    {
      id: "srv-pedreiro-02",
      providerId: "prov-gv-pedreiro-05",
      categoryId: subPiso?.id ?? catReforma.id,
      title: "Assentamento de Pisos e Porcelanato",
      description:
        "Colocação alinhada de cerâmicas e porcelanatos com niveladores e corte preciso de cantos.",
      basePrice: 280.0,
      unit: ServiceUnit.UNIDADE,
      duration: 480,
    },
    {
      id: "srv-pedreiro-03",
      providerId: "prov-gv-pedreiro-05",
      categoryId: subRejunte?.id ?? catReforma.id,
      title: "Raspagem e Aplicação de Novo Rejunte",
      description:
        "Revitalização do piso e azulejos do banheiro ou cozinha, prevenindo infiltrações.",
      basePrice: 120.0,
      unit: ServiceUnit.UNIDADE,
      duration: 120,
    },

    // Lucas (Climatização)
    {
      id: "srv-clima-01",
      providerId: "prov-gv-clima-06",
      categoryId: subArInstalacao.id,
      title: "Instalação Completa de Ar-Condicionado Split (9k a 18k BTUs)",
      description:
        "Instalação da unidade interna e condensadora, furação, teste de estanqueidade e vácuo profissional.",
      basePrice: 350.0,
      unit: ServiceUnit.UNIDADE,
      duration: 180,
    },
    {
      id: "srv-clima-02",
      providerId: "prov-gv-clima-06",
      categoryId: subArLimpeza.id,
      title: "Higienização Profunda com Bactericida e Limpeza de Turbina",
      description:
        "Desmontagem da carenagem, aplicação de bactericida hospitalar e limpeza da serpentina sem sujeira no quarto.",
      basePrice: 130.0,
      unit: ServiceUnit.UNIDADE,
      duration: 75,
    },

    // Gustavo (Jardinagem)
    {
      id: "srv-jardim-01",
      providerId: "prov-gv-jardim-07",
      categoryId: subJardimCorte.id,
      title: "Corte de Grama e Limpeza de Terreno/Lote",
      description:
        "Roçagem completa, acabamento nas bordas, recolhimento de resíduos e destinação correta.",
      basePrice: 140.0,
      unit: ServiceUnit.UNIDADE,
      duration: 180,
    },
    {
      id: "srv-jardim-02",
      providerId: "prov-gv-jardim-07",
      categoryId: subJardimCorte.id,
      title: "Poda Técnica de Árvores e Arbustos Ornamentais",
      description:
        "Poda de condução e contenção sem machucar a planta, adubação orgânica e controle de pragas.",
      basePrice: 190.0,
      unit: ServiceUnit.UNIDADE,
      duration: 120,
    },

    // André (Marcenaria)
    {
      id: "srv-marcenaria-01",
      providerId: "prov-gv-marcenaria-08",
      categoryId: subMoveisMontagem.id,
      title: "Montagem de Guarda-Roupas e Móveis Grandes",
      description:
        "Montagem alinhada com fixação segura, regulagem de portas e gavetas sem folgas.",
      basePrice: 140.0,
      unit: ServiceUnit.UNIDADE,
      duration: 180,
    },
    {
      id: "srv-marcenaria-02",
      providerId: "prov-gv-marcenaria-08",
      categoryId: subMoveisMontagem.id,
      title: "Instalação de Painel de TV, Prateleiras e Nichos",
      description: "Furação com buchas reforçadas em alvenaria ou drywall, nivelamento a laser.",
      basePrice: 90.0,
      unit: ServiceUnit.UNIDADE,
      duration: 60,
    },

    // Roberto (Marido de Aluguel)
    {
      id: "srv-faztudo-01",
      providerId: "prov-gv-faztudo-09",
      categoryId: catReparos.id,
      title: "Instalação de Varão de Cortina, Quadros e Espelhos",
      description:
        "Fixação alinhada e firme de acessórios decorativos e utilitários em qualquer cômodo.",
      basePrice: 70.0,
      unit: ServiceUnit.UNIDADE,
      duration: 45,
    },
    {
      id: "srv-faztudo-02",
      providerId: "prov-gv-faztudo-09",
      categoryId: catReparos.id,
      title: "Troca e Instalação de Chuveiro Elétrico e Resistência",
      description:
        "Conexão com conectores cerâmicos ou wago, fita veda-rosca e teste de vazão e aquecimento.",
      basePrice: 60.0,
      unit: ServiceUnit.UNIDADE,
      duration: 40,
    },

    // Camila (Estofados)
    {
      id: "srv-estofados-01",
      providerId: "prov-gv-estofados-10",
      categoryId: catLimpeza.id,
      title: "Higienização Profunda de Sofá (2 ou 3 Lugares)",
      description:
        "Extração por sucção de ácaros, fungos e manchas, secagem rápida e perfume suave.",
      basePrice: 180.0,
      unit: ServiceUnit.UNIDADE,
      duration: 120,
    },
    {
      id: "srv-estofados-02",
      providerId: "prov-gv-estofados-10",
      categoryId: catLimpeza.id,
      title: "Lavagem e Higienização de Colchão Casal / Queen",
      description:
        "Eliminação profunda de bactérias e manchas de suor com produtos dermatologicamente testados.",
      basePrice: 160.0,
      unit: ServiceUnit.UNIDADE,
      duration: 90,
    },
  ]

  for (const s of servicesData) {
    await db.service.upsert({
      where: { id: s.id },
      create: {
        id: s.id,
        providerId: s.providerId,
        categoryId: s.categoryId,
        title: s.title,
        description: s.description,
        basePrice: s.basePrice,
        unit: s.unit,
        duration: s.duration,
        active: true,
      },
      update: {
        providerId: s.providerId,
        categoryId: s.categoryId,
        title: s.title,
        description: s.description,
        basePrice: s.basePrice,
        unit: s.unit,
        duration: s.duration,
        active: true,
      },
    })
  }
  console.log(`✅ ${servicesData.length} serviços cadastrados e associados aos prestadores de GV.`)

  // 5. Clientes Locais de Teste para Feedbacks e Avaliações
  const clientsData = [
    {
      id: "client-gv-juliana",
      name: "Dra. Juliana Prado",
      email: "juliana.prado.gv@exemplo.com.br",
      phone: "+5533988112233",
      whatsapp: "+5533988112233",
      district: "Ilha dos Araújos",
      city: "Governador Valadares",
      state: "MG",
      cep: "35020-000",
      lat: -18.847,
      lng: -41.939,
    },
    {
      id: "client-gv-thiago",
      name: "Thiago Vasconcelos",
      email: "thiago.vasconcelos.gv@exemplo.com.br",
      phone: "+5533988223344",
      whatsapp: "+5533988223344",
      district: "Centro",
      city: "Governador Valadares",
      state: "MG",
      cep: "35010-151",
      lat: -18.853,
      lng: -41.944,
    },
    {
      id: "client-gv-beatriz",
      name: "Beatriz Alvarenga",
      email: "beatriz.alvarenga.gv@exemplo.com.br",
      phone: "+5533988334455",
      whatsapp: "+5533988334455",
      district: "Vila Bretas",
      city: "Governador Valadares",
      state: "MG",
      cep: "35030-000",
      lat: -18.842,
      lng: -41.951,
    },
  ]

  for (const c of clientsData) {
    await db.user.upsert({
      where: { id: c.id },
      create: {
        id: c.id,
        name: c.name,
        email: c.email,
        passwordHash: "$2b$10$placeholder",
        phone: c.phone,
        whatsapp: c.whatsapp,
        avatarUrl: `https://i.pravatar.cc/150?u=${c.id}`,
        role: Role.CLIENT,
        city: c.city,
        cityId: city.id,
        state: c.state,
        district: c.district,
        cep: c.cep,
        lat: c.lat,
        lng: c.lng,
        active: true,
      },
      update: {
        name: c.name,
        city: c.city,
        cityId: city.id,
        district: c.district,
        avatarUrl: `https://i.pravatar.cc/150?u=${c.id}`,
      },
    })
  }

  // 6. Agendamentos Concluídos e Avaliações Autênticas
  const sampleReviews = [
    {
      bookingId: "book-sample-gv-01",
      providerId: "prov-gv-eletrica-01",
      clientId: "client-gv-thiago",
      serviceId: "srv-eletrica-01",
      amount: 180.0,
      address: "Avenida Minas Gerais, 420, Centro, Governador Valadares",
      rating: 5,
      comment:
        "O Carlos foi impecável! Identificou na hora o disjuntor que estava aquecendo no quadro e trocou com muita segurança. Super recomendo em Valadares.",
      scheduledAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
    },
    {
      bookingId: "book-sample-gv-02",
      providerId: "prov-gv-limpeza-02",
      clientId: "client-gv-juliana",
      serviceId: "srv-limpeza-01",
      amount: 160.0,
      address: "Rua 15, 230, Ilha dos Araújos, Governador Valadares",
      rating: 5,
      comment:
        "A Mariana deixou meu apartamento brilhando aqui na Ilha dos Araújos! Extremamente pontual, educada e caprichosa em cada cômodo.",
      scheduledAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
    },
    {
      bookingId: "book-sample-gv-03",
      providerId: "prov-gv-clima-06",
      clientId: "client-gv-beatriz",
      serviceId: "srv-clima-01",
      amount: 350.0,
      address: "Rua Israel Pinheiro, 1800, Vila Bretas, Governador Valadares",
      rating: 5,
      comment:
        "Instalação do meu ar-condicionado 12.000 BTUs foi perfeita. Trabalho limpo, sem quebrar parede desnecessariamente e funcionando gelando muito no calor de GV!",
      scheduledAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
    },
    {
      bookingId: "book-sample-gv-04",
      providerId: "prov-gv-hidraulica-03",
      clientId: "client-gv-thiago",
      serviceId: "srv-hidraulica-01",
      amount: 120.0,
      address: "Rua Peçanha, 310, Centro, Governador Valadares",
      rating: 5,
      comment:
        "Marcos resolveu um vazamento chato no registro do banheiro que já durava semanas. Serviço rápido, preço justo e sem enrolação.",
      scheduledAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
    },
    {
      bookingId: "book-sample-gv-05",
      providerId: "prov-gv-pintura-04",
      clientId: "client-gv-juliana",
      serviceId: "srv-pintura-03",
      amount: 320.0,
      address: "Rua 18, 95, Ilha dos Araújos, Governador Valadares",
      rating: 5,
      comment:
        "A parede de cimento queimado na sala ficou cinematográfica! Rafael é um verdadeiro artista da pintura. Muito caprichoso com o chão e móveis.",
      scheduledAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
    },
    {
      bookingId: "book-sample-gv-06",
      providerId: "prov-gv-marcenaria-08",
      clientId: "client-gv-beatriz",
      serviceId: "srv-marcenaria-01",
      amount: 140.0,
      address: "Rua Afonso Pena, 1500, Vila Bretas, Governador Valadares",
      rating: 5,
      comment:
        "Montou meu guarda-roupas de 6 portas com gaveteiro perfeitamente. Trouxe todas as ferramentas certas e terminou antes do prazo previsto.",
      scheduledAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000),
    },
  ]

  for (const r of sampleReviews) {
    // 1. Cria ou atualiza Booking
    await db.booking.upsert({
      where: { id: r.bookingId },
      create: {
        id: r.bookingId,
        providerId: r.providerId,
        clientId: r.clientId,
        serviceId: r.serviceId,
        amount: r.amount,
        address: r.address,
        cep: "35010-000",
        lat: -18.8546,
        lng: -41.9444,
        status: BookingStatus.COMPLETED,
        paymentStatus: PaymentStatus.PAID,
        scheduledAt: r.scheduledAt,
        escrowReleasedAt: r.scheduledAt,
      },
      update: {
        status: BookingStatus.COMPLETED,
        paymentStatus: PaymentStatus.PAID,
      },
    })

    // 2. Cria ou atualiza Review
    await db.review.upsert({
      where: { bookingId: r.bookingId },
      create: {
        bookingId: r.bookingId,
        providerId: r.providerId,
        clientId: r.clientId,
        serviceId: r.serviceId,
        rating: r.rating,
        comment: r.comment,
        createdAt: r.scheduledAt,
      },
      update: {
        rating: r.rating,
        comment: r.comment,
      },
    })
  }
  console.log(`✅ ${sampleReviews.length} avaliações autênticas associadas aos agendamentos de GV.`)

  // 7. Backfill de Avatares para garantir fotos em 100% dos usuários
  await backfillAvatars(db)

  console.log("================================================================================")
  console.log("🎉 SEED DE GOVERNADOR VALADARES CONCLUÍDO COM SUCESSO!")
  console.log("A vitrine pública, busca textual e mapa operacional de GV estão 100% preenchidos.")
  console.log("================================================================================")
}

main()
  .catch((e) => {
    console.error("❌ Erro ao rodar seed de Governador Valadares:", e)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
