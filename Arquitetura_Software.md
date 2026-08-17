# 📄 Documento de Arquitetura de Software: Marketplace SaaS

Versão: 1.2 (Revisão FOSS \+ Geolocalização GPS)  
Escopo: Definição de arquitetura de Backend, Frontend, Gerenciamento de Estado, User Interface (UI) e Serviços Geoespaciais.  
Filosofia Central: Pragmatismo operacional no MVP com preparação para escalabilidade assíncrona. Zero dependência de licenças proprietárias ou _Bloqueio de fornecedores_.

---

## 1\. Visão Geral da Arquitetura

A arquitetura baseia-se em um Monolito Modular Orientado a Eventos. Com a introdução da geolocalização, o banco de dados ganha capacidades espaciais (GIS) e o frontend passa a renderizar mapas vetoriais interativos, tudo utilizando a stack OpenStreetMap, Docker, React e Node.js.

---

## 2\. Arquitetura de Backend e Dados Geoespaciais

### 2.1. Padrão Estrutural: Monolito Modular

O backend será implantado como uma única unidade, dividido em módulos independentes (Auth, 'CatálogoCatalog, , OrdersPayments, , NotificationsGeo/Shipping). A comunicação entre módulos ocorre via interfaces ou eventos.

### 2.2. Banco de Dados Espacial (PostGIS)

Para consultas geográficas de alta performance (ex: "Ache todos os vendedores num raio de 10km do usuário X"), um banco de dados tradicional não serve.

- Ferramenta: PostgreSQL \+ Extensão PostGIS (Licença GPL).
- \*\*CapaCapacidades: Permite armazenar Pontos (lat/longo), PolígonosST\_DWithin para calcular distâncias).

### 2.3. Serviços de Roteamento e Geocoding (Self-Hosted)

Em vez de usar a API do Google para converter CEP em coordenadas (Geocoding) ou calcular rotas de entrega, usaremos ferramentas 100% Open Source:

- Geocoding (Endereço \-\> Coordenadas): \*\*IndicadoNominatim ou Pelias (OpenStreetMap). Retorna a latitude/longitude exata do endereço digitado pelo usuário.
- Roteamento e Fretes (Distância real): \*\*OSRM (Roteamento de Código AbertoOSRM (Máquina de Roteamento de Código Aberto). Calcule

### 2.4. Padrão de Comunicação: Event-Driven

- Ferramenta: RabbitMQ (Licença MPL 2.0).
- Fluxo com GPS: Quando um pedido é pago, o evento PaymentApproved é disparado. O módulo Envie este evento, consulta ou OSRMShipping

---

## 3\. Arquitetura de Frontend: Gerenciamento de Estado

Incluindo os novos estados de geolocalização, todas as ferramentas abaixo são 100% Open Source (Licença MIT):

| Tipo de Estado              | Responsabilidade                                    | Hardware de Código Aberto | Uso no Marketplace                                                                                                                                                                                          |
| :-------------------------- | :-------------------------------------------------- | :------------------------ | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status do servidor          | Cache e sincronização de dados da API.              | Consulta TanStack         | Lista de produtos, histórico de pedidos, busca de vendedores próximos (recebe coords do PostGIS).                                                                                                           |
| Estado Global (UI/Auth/GPS) | Dados do usuário, preferências e localização atual. | Condição                  | Armazena a role e dados do usuário da sessão (cookie HMAC-SHA256 `severinno_session`, sem JWT), itens do carrinho e as coordenadas GPS atuais do dispositivo do usuário (atualizadas via API do navegador). |
| Fluxos Críticos             | Controle de etapas e regras rígidas.                | XState                    | Fluxo de Checkout (com seleção de local no mapa) e Rastreamento de Entrega em tempo real.                                                                                                                   |
| Estado de Formulários       | Inputs e validação.                                 | Forma Gancho React \+ Zod | Endereçamento e validação de CEP/Coordenadas.                                                                                                                                                               |

---

## 4\. Arquitetura de Frontend: User Interface (UI) e Mapas

A UI da Vitrine e do Painel SaaS utilizará Tailwind CSS e shadcn/ui. Para a renderização de mapas, substituímos o Google Maps por alternativas gratuitas de altíssimo desempenho.

### 4.1. Renderização de Mapas (Frontend)

- Ferramenta: MapLibre GL JS (Licença BSD) ou Leaflet.js (Licença BSD).
  - _MapLibre_ é altamente recomendado por renderizar mapas vetoriais (suaves e rápidos) usando WebGL.
- Provedor de Tiles (Imagens do Mapa): \*\*AbraOpenStreetMap ou servidores de tiles gratuitos como o da Maptiler (com limite gratuito elevado) ou tiles auto-hospedados.
- Integração React: Biblioteca react-map-gl (envoltória React para MapLibre).

### 4.2. Justificativa e Aplicação

- Apresentação: Mapa interativo mostrando "Produtos perto de você". O usuário pode desenhar um polígono no mapa para definir a área de busca.
- Painel do Vendedor: Mapa para definir as "Áreas de Cobertura de Frete" (desenhando círculos ou polígonos no mapa que são salvos no PostGIS).
- Rastreamento (Comprador): Tela de acompanhamento de pedido com o ícone do entregador se movendo em tempo real no mapa (MapLibre \+ WebSocket).

### 4.3. Ferramentas de UI Específicas

- Tabelas de Dados: \*\*EntãoTabela TanStack.
- Gráficos e Dashboards: Recharts ou .Nível
- Notificações: Sonner.

---

## 5\. Roadmap de Evolução Arquitetural (Infraestrutura FOSS)

- Fase 1 (MVP e Validação):
  - Monolito Modular empacotado em containers Docker.
  - Banco de dados PostgreSQL \+ PostGIS.
  - Corretor de Mensagens RabbitMQ.
  - Mapas renderizados via MapLibre GL JS consumindo OpenStreetMap.
  - Geocoding básico via API gratuita do Nominatim (OpenStreetMap).
- Fase 2 (Crescimento e Logística Própria):
  - Implantação de instâncias self-hosted do OSRM para cálculo preciso de fretes rodoviários.
  - Autohospedagem fazPelias para geocoding reverso rápido e sem limites de requisição.
  - Cache geoespacial com Valkey (fork Open Source do Redis).
- Fase 3 (Escala Empresarial):
  - Extração do módulo Shipping/Tracking para um microsserviço dedicado, conversando via WebSocket com o Frontend (Socket.io).
  - Geração de mapas de calor de vendas usando dados massivos do PostGIS.

---

## 6\. Resumo da Stack Tecnológica (100% Open Source)

| Camada                    | Tecnologia                                    | Licença Open Source      |
| :------------------------ | :-------------------------------------------- | :----------------------- |
| Frontend Framework        | Reage / Next.js                               | COM                      |
| Mapas de Frontend         | MapLibre GL JS \+ react-map-gl                | BSD / MIT                |
| Componentes da interface  | CSS Tailwind \+ shadcn/ui                     | COM                      |
| Estado Cliente            | Condição                                      | COM                      |
| Estado do servidor        | Consulta TanStack                             | COM                      |
| Máquinas de Estados       | XState                                        | COM                      |
| Estrutura de Backend      | Node.js (NestJS) ou Java (Spring Boot)        | MIT / Apache 2.0         |
| Banco de Dados (Espacial) | PostgreSQL \+ PostGIS                         | PostgreSQL License / GPL |
| Roteamento (Fretes)       | OSRM (Máquina de Roteamento de Código Aberto) | COM                      |
| Geocodificação            | Nominatim / Pelias (OpenStreetMap)            | GPL / Apache 2.0         |
| Corretor de Mensagens     | RabbitMQ                                      | MPL 2.0                  |
| Cache (Futuro)            | Valkey                                        | 3-Cláusula BSD           |
| Containerização           | Docker \+ Kubernetes                          | Apache 2.0               |

_Com esta arquitetura, o Marketplace SaaS possui capacidade de rastreamento logístico nível "iFood/Uber", cálculo de frete dinâmico e busca por proximidade, sem pagar um centavo em licenças de mapas ou servidores GIS proprietários._
