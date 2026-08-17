# Taxonomia de Serviços - Marketplace Residencial

**Versão:** 1.0
**Foco:** 100% Prestação de Serviços Residenciais (Casas e Apartamentos)
**Estrutura:** Hierarquia em 3 Níveis (Categoria Pai > Categoria Filha > Subcategoria)

---

## 📖 Visão Geral

Este documento define a estrutura oficial de categorias do marketplace. O objetivo é garantir que o usuário final encontre o serviço desejado em no máximo 3 cliques, ao mesmo tempo em que fornece aos prestadores uma categorização precisa para suas habilidades.

**Regra de Nomenclatura:**

- **Nível 1 (Categoria Pai):** Máximo 2 palavras (ex: _Obras e Reformas_).
- **Nível 2 (Categoria Filha):** Máximo 3 palavras (ex: _Pisos e Revestimentos_).
- **Nível 3 (Subcategoria):** Ação direta do serviço (ex: _Assentar Pisos e Porcelanatos_).

Chegamos ao ponto de **"Polimento Fino"**. A estrutura atual está excelente para o banco de dados, mas podemos fazer uma **otimização semântica focada em SEO (Google) e Conversão (Botões de Call-to-Action)**.

Quando um usuário tem um problema, ele não pensa em verbos ("Assentar"), ele pensa no **objeto do desejo** ou na **dor** ("Piso Vinílico", "Caça-Vazamento", "Dedetizadora").

Aqui estão as **3 últimas otimizações de alta performance** para a taxonomia, e logo abaixo o documento final atualizado:

### Otimização 1: Nomenclatura Híbrida (Ação + Substantivo de Busca)

Vamos misturar o verbo de ação com as palavras-chave mais buscadas no Google. Isso aumenta drasticamente o ranqueamento orgânico do seu marketplace.

- _Antes:_ Controlar Insetos Rasteiros e Voadores
- _Otimizado:_ Dedetização (Baratas, Formigas, etc)
- _Antes:_ Fazer Tratamento contra Cupins e Brocas
- _Otimizado:_ Descupinização (Solo e Madeira)
- _Antes:_ Controlar Ratos e Roedores Urbanos
- _Otimizado:_ Desratização (Ratos e Camundongos)

### Otimização 2: Termos Coloniais de Alta Conversão

No Brasil, certos serviços têm "nomes populares" que são buscados 10x mais que o nome técnico. Precisamos incluir esses termos diretamente na subcategoria.

- _Inclusão:_ "Marido de Aluguel e Faz-Tudo" (em vez de só "Pequenos Reparos").
- _Inclusão:_ "Diarista e Faxina" (em vez de só "Limpeza Residencial").
- _Inclusão:_ "Caça-Vazamento" (já incluído, mas é o termo universal).
- _Inclusão:_ "Montador de Móveis" (em vez de só "Montagem").

### Otimização 3: Desmembramento de "Reformas e Acabamentos"

Esta categoria Pai ficou muito "pesada" (com 5 categorias filhas). Vamos desmembrar "Projetos e Engenharia" para uma categoria própria, pois o público que busca um pintor é diferente do público que busca um arquiteto.

---

### 🏆 TAXONOMIA FINAL OTIMIZADA (VERSÃO DE PRODUÇÃO)

> **⚠️ Proposta vs. produção:** a árvore abaixo é uma **proposta otimizada** (14
> categorias de nível 1) — **não é a taxonomia em produção**. A taxonomia REAL
> está definida em `prisma/seed-data.ts` (`CATEGORY_SPEC`) e contém **27
> categorias: 3 pais + 7 filhas + 17 subcategorias**:
>
> - **Reparos** → Elétrica (Tomadas e interruptores, Curto-circuito, Quadro elétrico) · Hidráulica (Desentupimento, Vazamento, Caixa de descarga) · Pintura (Pintura interna, Pintura externa, Textura e grafiato)
> - **Limpeza** → Residencial (Limpeza geral, Organização) · Pós-Obra (Limpeza pós-obra)
> - **Reforma** → Pisos (Assentamento de piso, Rejunte) · Alvenaria (Pequenas reformas, Contrapiso, Poda de árvores)
>
> A proposta abaixo pode ser usada como referência de evolução futura da árvore;
> qualquer mudança em produção deve passar por `prisma/seed-data.ts`.

### 1. Reformas e Acabamentos

- **Pisos e Revestimentos**
  - Assentar Pisos, Azulejos e Porcelanatos
  - Instalar Pisos Laminados, Vinílicos (LVT) e Tapetes
  - Instalar Decks de Madeira ou WPC
  - Raspar, Calafetar e Revitalizar Tacos/Assoalho
  - Polir e Cristalizar Mármore, Granito e Granilite
  - Aplicar Revestimentos Epóxi e Cimento Queimado
- **Alvenaria, Estruturas e Demolição**
  - Levantar Paredes e Muros (Alvenaria/Vedação)
  - Rebocar, Emboçar e Chapiscar Paredes
  - Demolir Paredes, Pisos e Estruturas
  - Remover Entulho e Limpar Terreno
  - Construir Lajes, Mezaninos e Vigas
- **Pintura e Texturas**
  - Pintar Paredes, Tetos e Esquadrias
  - Pintar Fachadas e Áreas Externas
  - Aplicar Massa Corrida e Acrílica
  - Aplicar Textura, Grafiato e Efeitos Decorativos
- **Gesso, Drywall e Isolamento**
  - Aplicar Gesso Liso em Paredes e Tetos
  - Instalar Forros de Gesso, Drywall ou PVC
  - Instalar Molduras, Sancas e Cortineiros
  - Reparar Furos e Rachaduras em Gesso
  - Aplicar Isolamento Térmico e Acústico

### 2. Projetos, Engenharia e Legalização

- **Arquitetura e Design de Interiores**
  - Elaborar Projetos Arquitetônicos e de Reforma
  - Elaborar Projetos de Interiores e Decoração (3D)
  - Consultoria de Cores, Texturas e Iluminação
- **Engenharia e Gestão de Obras**
  - Gerenciar e Fiscalizar Obras
  - Elaborar Projetos Complementares (Elétrica/Hidráulica)
  - Calcular Estruturas (Concreto/Metálica)
- **Legalização e Laudos**
  - Legalizar Imóveis (Alvarás, Habite-se)
  - Emitir Laudos e Perícias Técnicas (ART/RRT)
  - Fazer Vistoria de Vizinhança

### 3. Instalações e Manutenção Técnica

- **Bombeiro Hidráulico e Encanamento**
  - Instalar Louças, Metais e Torneiras
  - Caça-Vazamentos (Detecção e Reparo)
  - Desentupir Ralos, Vasos, Pias e Esgotos
  - Limpar e Desinfetar Caixas d'Água
  - Instalar Redes de Água Quente e Fria
- **Eletricista e Energia**
  - Fazer Recabeamento e Instalar Quadros de Distribuição
  - Instalar Tomadas, Interruptores e Disjuntores
  - Instalar Iluminação (Lustres, LED, Painéis)
  - Aumentar Carga Elétrica e Instalar Wallbox (Carro Elétrico)
  - Instalar e Manter Painéis Solares Fotovoltaicos
- **Gás e Aquecimento**
  - Instalar Redes de Gás (Cobre/PEX)
  - Fazer Teste de Estanqueidade de Gás
  - Converter Fogão/Cooktop (GN para GLP)
  - Instalar e Consertar Aquecedores e Boilers
- **Climatização e Refrigeração**
  - Instalar Ar-Condicionado (Split, Cassete, Piso-Teto)
  - Fazer Manutenção e Higienização de Ar-Condicionado
  - Instalar Exaustores e Ventiladores de Teto

### 4. Marcenaria, Móveis e Reparos

- **Marcenaria e Moveleiro**
  - Projetar e Fabricar Móveis Planejados
  - Restaurar e Laquear Móveis de Madeira
  - Instalar Portas e Janelas de Madeira
- **Montador de Móveis e Faz-Tudo (Marido de Aluguel)**
  - Montar Móveis de Loja (IKEA, Mobly, MadeiraMadeira)
  - Ajustar Portas, Gavetas e Corrediças
  - Fixar Quadros, TVs e Cortinas na Parede
  - Instalar Acessórios de Banheiro (Barras, Porta-toalhas)
  - Aplicar Silicone e Vedar Pias, Cubas e Boxes
- **Organização Profissional (Personal Organizer)**
  - Organizar Closets, Cozinhas e Despensas
  - Planejar Organização de Pós-Mudança

### 5. Limpeza e Conservação

- **Diarista e Faxina**
  - Limpeza Residencial (Rotina e Faxina Pesada)
  - Limpeza Pós-Obra
  - Faxina de Mudança (Pré/Pós)
  - Limpar Vidros, Janelas e Fachadas
- **Estofados e Têxteis**
  - Higienizar Colchões e Estofados
  - Lavar Tapetes, Carpetes e Cortinas
  - Impermeabilizar e Reformar Sofás
- **Costura e Ajustes Domiciliares**
  - Fazer Ajustes e Reparos de Roupas (Costureira no Local)
  - Confeccionar e Ajustar Cortinas e Almofadas
- **Utilidades Domésticas**
  - Passar Roupas em Domicílio
  - Cozinhar Refeições Diárias em Casa

### 6. Eletrodomésticos e Assistência

- **Linha Branca**
  - Consertar Geladeiras, Freezers e Adegas
  - Consertar Máquinas de Lavar e Secadoras
  - Consertar Máquinas de Lavar Louça
- **Linha Cozinha e Quente**
  - Consertar Fogões, Cooktops e Fornos
  - Consertar Micro-ondas e Fornos Elétricos

### 7. Áreas Externas e Lazer

- **Jardinagem e Paisagismo**
  - Roçar Terrenos e Cortar Gramado
  - Podar Árvores, Arbustos e Palmeiras
  - Poda em Altura e Remoção de Árvores
  - Adubar e Tratar Solo e Plantas
  - Controlar Pragas de Jardim e Doenças
  - Remover Entulho Verde
  - Projetar e Implantar Jardins (3D e Consultoria)
  - Instalar Jardins Verticais e Floreiras
  - Plantar Gramado Natural (Placas/Rolos)
  - Instalar Grama Sintética
  - Instalar e Manter Sistemas de Irrigação
  - Construir Lagos Ornamentais e Fontes
- **Piscinas**
  - Aspirar e Limpar Piscinas
  - Tratar Quimicamente a Água
  - Instalar e Consertar Bombas e Filtros
  - Instalar Iluminação e Aquecimento de Piscina
- **Área Gourmet e Lazer**
  - Construir Churrasqueiras e Fornos a Lenha
  - Construir Lareiras (Alvenaria ou Ecológica)
  - Limpar e Consertar Coifas e Chaminés

### 8. Telhados, Vidraçaria e Serralheria

- **Serralheria e Esquadrias Metálicas**
  - Fabricar e Instalar Grades, Portões e Corrimãos
  - Fazer Soldagem e Reparos Metálicos
- **Vidraçaria e Fechamentos**
  - Instalar Box de Banheiro e Espelhos
  - Instalar Janelas e Portas de Vidro
  - Fazer Fechamento de Sacadas e Varandas
  - Instalar Claraboias e Coberturas de Vidro
  - Instalar Redes de Proteção e Telas Mosquiteiras
  - Trocar e Reparar Vidros Quebrados
- **Telhados, Coberturas e Calhas**
  - Instalar e Reparar Telhados (Cerâmica, Fibrocimento)
  - Construir Pergolados e Coberturas (Policarbonato/Lona)
  - Instalar e Limpar Calhas e Rufos
  - Impermeabilizar Lajes e Paredes (Manta Asfáltica/Líquida)
  - Caça-Infiltrações e Reparos de Goteiras

### 9. Segurança, Tecnologia e Acessos

- **Chaveiro Residencial**
  - Abrir Portas e Cadeados (Emergência 24h)
  - Fazer Cópia de Chaves e Codificadas
  - Instalar e Trocar Fechaduras e Segredos
- **Segurança Eletrônica**
  - Instalar Câmeras e Sistemas CFTV/IP
  - Instalar Alarmes e Sensores de Presença
  - Instalar Cercas Elétricas e Concertinas
  - Instalar Interfones e Videoporteiros
- **Casa Inteligente (Smart Home)**
  - Automatizar Iluminação e Tomadas Inteligentes
  - Instalar Motores para Portões e Cortinas
  - Configurar Home Theater e Sonorização
  - Integrar Assistentes Virtuais (Alexa/Google)
- **Infraestrutura de TI e Redes**
  - Instalar Cabeamento Estruturado e Redes Wi-Fi Mesh
  - Organizar Racks de TI
  - Montar e Configurar Computadores (Home Office)

### 10. Mudanças e Logística

- **Mudanças e Transportes**
  - Fazer Mudança Residencial (Local ou Interestadual)
  - Embalar Itens e Desmontar/Montar Móveis
  - Içar Cargas e Móveis Pesados por Sacada
- **Descarte e Retirada**
  - Retirar Móveis Velhos e Eletrodomésticos
  - Coletar Lixo Eletrônico e Sucata

### 11. Controle de Pragas e Sanitização

- **Dedetização e Descupinização**
  - Dedetização (Baratas, Formigas, Mosquitos, Percevejos)
  - Descupinização (Cupim de Solo e de Madeira Seca)
  - Controle de Pulgas e Carrapatos
- **Desratização e Sinantrópicos**
  - Desratização (Ratos e Camundongos)
  - Afastar Pombos e Morcegos (Barreiras Físicas)
  - Capturar Abelhas e Vespas
- **Sanitização**
  - Sanitização e Desinfecção de Ambientes (Vírus/Bactérias)

### 12. Acessibilidade e Adaptações Residenciais

- **Adaptações de Mobilidade**
  - Alargar Portas e Vãos para Cadeirantes
  - Construir Rampas de Acesso Residenciais
  - Instalar Elevadores e Plataformas Residenciais
- **Banheiros Acessíveis**
  - Instalar Barras de Apoio e Assentos Elevados
  - Adaptar Boxes para PCD e Idosos

### 13. Cuidados, Pessoas e Pets (Em Domicílio)

- **Pet Care no Local**
  - Banho e Tosa em Domicílio (Pet Shop Móvel)
  - Passear com Cães (Dog Walker)
  - Creche e Hospedagem (Pet Sitting)
- **Cuidados com Pessoas**
  - Cuidar de Idosos (Acompanhamento e Higiene)
  - Babá e Cuidadora Infantil
- **Saúde e Estética Domiciliar**
  - Fisioterapia em Casa
  - Massagem (Massoterapia) em Domicílio
  - Cabeleireiro e Manicure em Casa
- **Aulas e Eventos em Casa**
  - Personal Trainer em Casa
  - Aulas Particulares (Reforço, Idiomas, Música)
  - Chef Personal e Cozinheiro de Eventos
  - Garçom e Ajudante para Festas

### 14. Aluguel de Equipamentos Residenciais

- **Maquinário e Ferramentas**
  - Alugar Andaimes e Escadas
  - Alugar Ferramentas Elétricas (Marteletes, Serras)
  - Alugar Máquinas de Limpeza (Lavadoras, Extratoras)

---

## ⚙️ Otimizações de Banco de Dados e Backend

### 1. Mapeamento de Sinônimos (Dicionário de Busca - SEO)

O sistema de busca (PostgreSQL `tsvector` + OpenSearch) deve reconhecer os seguintes sinônimos populares e redirecioná-los para a subcategoria oficial:

| Termo Buscado pelo Usuário | Redirecionar para Subcategoria (Nível 3)                      |
| :------------------------- | :------------------------------------------------------------ |
| Encanador / Bombeiro       | `Bombeiro Hidráulico e Encanamento > Instalações Hidráulicas` |
| Faz-tudo / Bricoleiro      | `Pequenos Reparos > Fixação e Instalação`                     |
| Quebra-quebra / Pedreiro   | `Alvenaria, Estruturas e Demolição > Demolição e Remoção`     |
| Dedetizadora               | `Dedetização e Descupinização > Insetos Rasteiros e Voadores` |
| Montador de móveis         | `Marcenaria e Moveleiro > Montagem e Ajustes`                 |
| Caça-vazamento / Vazamento | `Bombeiro Hidráulico > Caça-Vazamentos e Reparos`             |
| Colocador de piso / Lajota | `Pisos e Revestimentos > Azulejista e Pastilhas`              |

### 2. Tags e Atributos (Filtros Avançados)

Para evitar a proliferação de subcategorias, usar sistema de _Tags_ booleanas ou multivaloradas no perfil do prestador. Filtros laterais exibidos ao usuário na página de resultados:

- **Urgência:** `[ ] Atende 24h` / `[ ] Atende Finais de Semana`
- **Documentação:** `[ ] Emite Nota Fiscal` / `[ ] Pessoa Jurídica (CNPJ)` / `[ ] Profissional Autônomo`
- **Logística:** `[ ] Material por conta do cliente` / `[ ] Profissional fornece material`
- **Orçamento:** `[ ] Faz orçamento grátis` / `[ ] Visita técnica cobrada`

### 3. Serviços de Emergência (Flag 24h)

Configurar flag no banco de dados (`is_emergency = true`) para as subcategorias críticas. Estas categorias devem aparecer em um botão de acesso rápido na Home do aplicativo ("Preciso de ajuda urgente agora"):

1. _Bombeiro Hidráulico > Caça-Vazamentos e Reparos_ (Inundação/Tubo estourado)
2. _Chaveiro Residencial > Abertura de Portas_ (Trancado fora de casa)
3. _Elétrica > Infraestrutura Elétrica_ (Curto-circuito / Sem energia)
4. _Bombeiro Hidráulico > Desentupimento_ (Esgoto/Vaso entupido/Transbordando)

### 4. Cross-Selling (Venda Cruzada Automática)

Regra de negócio no backend para sugerir serviços complementares no checkout ou na visualização do perfil do prestador:

- Contratou `Assentar Pisos` ➔ Sugestão: `Faxina Pós-Obra`
- Contratou `Marcenaria Planejada` ➔ Sugestão: `Iluminação (Fitas LED)`
- Contratou `Dedetização de Cupins` ➔ Sugestão: `Restauração de Móveis`
- Contratou `Mudança Residencial` ➔ Sugestão: `Personal Organizer (Pós-mudança)`
- Contratou `Pintura Padrão` ➔ Sugestão: `Gesso e Forros (Sancas)`

```

```
