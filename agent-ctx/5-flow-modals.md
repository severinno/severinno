# Task 5 — Flow Modals (full-stack-developer)

Construiu os **Flow Modals** do Severinno Marketplace SaaS (Fase 1 / MVP):
Quote flow, Booking flow, Provider Profile modal, Auth modal e bits
compartilhados.

## Stack/decisões

- **Next.js 16 + shadcn/ui + Tailwind 4** (sem indigo/azul — primary
  emerald).
- **react-hook-form + Zod 4** para form state e validação.
- **TanStack Query** para cache de fetches (provider detail, services,
  providers list, CEP lookup).
- **framer-motion** para transições sutis (item add/remove, step change,
  role toggle).
- **Dialog (desktop) + Sheet (mobile full-screen)** — switch via
  `useIsMobile()`.
- Todos os fetches **relativos** (`/api/...`) — passam pelo Caddy em prod.

## Arquivos criados (todos em `src/components/modals/`)

| Arquivo                      | Função                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `star-rating.tsx`            | `<StarRatingDisplay>` (clip-based, suporta meia estrela) + `<StarRatingInput>` (teclado: ←→, 1–5; radiogroup ARIA)                                                                                                                                                                                                                                                                                                                                                           |
| `file-photos.tsx`            | `<FilePhotos>` — uploader com preview grid, max N (default 4), 5MB/foto, POST `/api/upload` (FormData); fallback para `URL.createObjectURL` se o endpoint falhar                                                                                                                                                                                                                                                                                                             |
| `address-form.tsx`           | `<AddressForm>` — CEP com auto-fill ViaCEP, botão GPS (usa `useGeoStore.setFromGPS` + reverse geocode), campos rua/número/complemento/bairro/cidade/UF (select)                                                                                                                                                                                                                                                                                                              |
| `auth-modal.tsx`             | `<AuthModal>` — Dialog `sm:max-w-md`, Tabs Login/Cadastrar, role toggle Cliente/Prestador (cartões animados), campos condicionais para provider (cpfCnpj/whatsapp/cidade/UF), valida com `loginSchema`/`registerSchema`, chama `useAuthStore.login`/`register`, navega para client.dashboard ou provider.dashboard                                                                                                                                                           |
| `provider-profile-modal.tsx` | `<ProviderProfileModal>` — Dialog `sm:max-w-3xl` (Sheet full-screen no mobile), cover+avatar+verified+rating+distância, Tabs: Serviços (accordion por categoria + carousel de fotos por serviço, botões Orçamento/Agendar), Sobre, Avaliações, Expediente (tabela 7 dias). Header: favorito + share. Footer sticky: Pedir orçamento + Agendar serviço. `useQuery` `/api/providers/:id`                                                                                       |
| `quote-modal.tsx`            | `<QuoteModal>` — multi-item (useFieldArray, max 5), cada item: combobox async de providers (Popover+Command), select de services dependente do provider (useQuery `/api/services?providerId=`), descrição textarea (min 10), quantidade+unidade, fotos; seção endereço (reusa `AddressForm`); resumo; footer sticky com submit. POST `/api/quotes`. Toast + navigate `client.quotes`. Se não autenticado → `openAuth('register','CLIENT')` + toast                           |
| `booking-modal.tsx`          | `<BookingModal>` — stepper 3 passos com Progress + dots animados. Step 1: Calendar (react-day-picker, pt-BR, disable past) + slots gerados da availability (60min). Step 2: card resumo (provider+service+data/hora+preço), quantidade, endereço, notes. Step 3: radio PIX/Cartão; cartão mock (número formatado, validade MM/AA, CVV) marcado "Demonstração"; PIX com QR placeholder + copiar chave + "Já paguei". POST `/api/bookings`. Toast + navigate `client.bookings` |
| `modals-host.tsx`            | `<ModalsHost>` — monta os 4 modais; cada um lê seu open-state do `useUIStore`. Sem props — mount once no app shell                                                                                                                                                                                                                                                                                                                                                           |

## Pequena modificação em arquivo de outro agente

- `src/lib/api.ts` (do parallel agent): adicionei `description?: string | null`
  e `photos?: string[]` ao tipo `ProviderService` para refletir o contrato
  real da API (`GET /api/providers/:id` retorna Service com esses campos).
  Sem quebra de compat — apenas fields opcionais adicionados.

## UX decisions (Nielsen heuristics)

- **Visibility of system status**: loaders (Loader2 spin) em todos os
  fetches; stepper progress bar no booking; total/fee/total no payment.
- **Match real world**: pt-BR everywhere, formatBRL/formatDate/formatTime,
  labels "Pedir orçamento" / "Agendar serviço" / "Confirmar e agendar".
- **User control & freedom**: botão "Voltar" em stepper, "Remover item"
  em quote, "Esqueci a senha" (toast info no MVP), Sheet/Dialog
  dismissable.
- **Error prevention**: validação por step (step1Valid/step2Valid/step3Valid);
  gates "Continuar" disabled; auth check antes de submeter (toast +
  openAuth).
- **Recognition over recall**: cards de provider no combobox mostram
  nome + cidade + serviço + badge "Verificado"; resumo sempre visível.
- **Aesthetic & minimalist**: emerald accent, espaçamento consistente,
  sem clutter, sem indigo/azul.
- **Help users recognize/recover from errors**: `aria-invalid`, mensagens
  vermelhas próximas ao campo, toast com mensagem do servidor (ApiError).

## Acessibilidade

- `aria-label`, `aria-checked`, `aria-pressed`, `aria-expanded`,
  `role="radiogroup"`, `role="radio"`.
- Modal Dialog tem `DialogTitle`/`DialogDescription` em `sr-only` quando
  header é custom (provider/quote/booking).
- StarRatingInput navegável por teclado (←→↑↓, 1–5).
- Touch targets ≥36px (botões sm:size-8 = 32px aprox; aceitável em
  contexto de listas densas — uso principalmente size-default = 36px).
- Focus rings mantidos nos componentes shadcn.

## Verificação

- `bun run lint`: ✅ meus arquivos limpos. Únicos erros restantes estão
  em `src/hooks/use-realtime.ts` (Task 2, `react-hooks/refs` — fora do
  meu escopo, documentado em worklog Task 1 caveat 7).
- `bunx tsc --noEmit`: ✅ meus arquivos sem erros. Únicos erros TS
  restantes estão em `src/components/vitrine/providers-map.tsx`
  (`maplibre-gl` CSS module + AttributionControl) — não meu.

## Caveats / notas para próximos agentes

1. **ModalsHost** precisa ser montado uma vez no app shell. Importar de
   `@/components/modals/modals-host` e renderizar `<ModalsHost />` ao
   lado da view principal (em `src/app/page.tsx` ou no app shell).
2. **`/api/upload`** está sendo construído em paralelo e tem falhas
   intermitentes (auth 401, formatos não suportados, etc.). Meu
   `FilePhotos` faz fallback para `URL.createObjectURL` quando o upload
   falha, então o UX do modal não quebra — mas o submit pode enviar
   URLs `blob:` que o backend deve validar/rejeitar.
3. **`ProviderService`** estendido com `description` e `photos` em
   `src/lib/api.ts` — qualquer outro agente que consuma essa lista já
   terá acesso aos campos.
4. **Resolver cast**: usei `as unknown as Resolver<T>` em 3 resolvers
   (login, register, quote) por causa de um known issue do Zod 4 com
   `z.coerce.number().optional()` que infere input como `unknown`. Não
   é bonito mas é a workaround documentada; se migrar para Zod 5 um
   dia, remover os casts.
5. **APIs ainda em paralelo**: vi no dev.log que `/api/providers/:id`,
   `/api/services?providerId=`, `/api/categories`, `/api/geo/cep`,
   `/api/geo/reverse`, `/api/quotes`, `/api/bookings`, `/api/upload`
   estão sendo construídos. Meu código consome todos eles; se algum
   ainda não estiver pronto, a UI mostra loaders/erros gracefully.
6. **Booking step1 slots**: gera slots de 60min entre start-end de cada
   bloco de availability do dia selecionado. Não checa conflitos com
   bookings já existentes (MVP — paralelo ao agendamento).
7. **Pagamento**: totalmente mock. Card form não envia para gateway;
   PIX usa chave fixa `severinno@exemplo.com`. Botão "Já paguei" é
   trust-only (não valida recebimento).
8. **Favorito/share** no provider modal: favorito é só toggle de UI
   (não chama API ainda — `/api/favorites` POST provavelmente existe,
   mas deixei como toast para não acoplar com endpoint incerto do
   parallel agent). Share usa `navigator.share` quando disponível,
   senão copia URL.
9. **Stepper sem componente próprio**: construí inline no booking-modal
   (dots + linha + Progress bar). Se quiser reutilizar, extrair para
   `src/components/ui/stepper.tsx`.
