# Severinno Marketplace SaaS — Worklog (Fase 1 / MVP)

Projeto: Marketplace de serviços com geolocalização (Clientes ↔ Prestadores verificados).
Stack adaptada ao ambiente: Next.js 16 + Prisma (SQLite) + MapLibre + shadcn/ui + WebSocket (mini-service porta 3003).
Arquitetura-alvo (PostGIS/RabbitMQ/OSRM) referenciada na doc arquitetural; MVP entrega funcionalidade equivalente nesta stack.

Convenções:

- Apenas a rota `/` é visível (SPA com view-switching via Zustand).
- Cor primária: emerald (serviços/confiança) — NUNCA indigo/azul.
- APIs em `src/app/api/**` (não server actions).
- z-ai-web-dev-sdk apenas no backend.

---

Task ID: CRLF-NORM
Agent: orchestrator (normalização de checkout)
Task: Normalizar o working tree deste checkout — converter os 415 .ts/.tsx com w/crlf para LF. O artefato de checkout (w/crlf) some sem tocar no histórico (blobs i/lf intocados).

Work Log:

- Diagnóstico: `git ls-files --eol '*.ts' '*.tsx'` → 415 arquivos `w/crlf`, 406 `w/lf`; TODOS os blobs `i/lf` (checkout Windows pré-.gitattributes — o atributo `*.ts text eol=lf` já garantia LF no blob/commit).
- Rodou `NORMALIZE_CRLF_EXTS=".ts .tsx" ./scripts/normalize-crlf.sh --dry-run` → confirmou exatamente 415 arquivos.
- Rodou o fix real (mesma var de escopo): converteu os 415 w/crlf → LF no disco e executou `git add --renormalize` nos 415 (só EOL-only vira renormalize — conteúdo real preservado unstaged).
- Pós-fix: `git ls-files --eol '*.ts' '*.tsx'` → 821/821 `w/lf` (zero w/crlf); `NORMALIZE_CRLF_EXTS=".ts .tsx" ./scripts/normalize-crlf.sh --check` → exit 0.
- Prova de que o histórico NÃO foi tocado: `git diff --quiet -- src/app/layout.tsx` e `src/lib/geo.ts` → limpos (zero diff — blob LF + working tree LF = nada a comparar).
- Únicas mudanças .ts/.tsx no status: as EDIÇÕES REAIS desta thread — 2 modificados (check-blob-crlf.test.ts +57, check-crlf.test.ts +68 — testes de CRLF/escopo adicionados) e 2 novos (check-crlf-scope.test.ts, check-readme-repro-marker.test.ts) — todos preservados unstaged pelo renormalize.
- Escopo: .ts/.tsx apenas (conforme pedido). Os .md (README.md, docs/*.md, worklog.md) seguem w/crlf no disco (blobs i/lf) — deliberadamente não tocados aqui; o mesmo vale para qualquer artefato de checkout não-escopado (a normalização completa de um checkout usa o default `.sh .ts .md` de `normalize-crlf.sh`).

Stage Summary:

- **Antes**: 415 .ts/.tsx `w/crlf` (todos `i/lf`). **Depois**: 821/821 `w/lf` — zero CRLF no working tree de .ts/.tsx.
- **Histórico intocado**: nenhum blob alterado; `git status` .ts/.tsx mostra só as edições reais da thread (2 M + 2 untracked novos).
- **Guard**: `normalize-crlf.sh --check` (escopo .ts/.tsx) → exit 0.

---

Task ID: 2
Agent: general-purpose (websocket mini-service)
Task: Set up WebSocket mini-service (port 3003, path /) with socket.io for realtime messaging/booking/quote/tracking events; provide singleton React client hook; start service in background and verify.

Work Log:

- Read worklog.md and examples/websocket/server.ts + examples/websocket/frontend.tsx to lock the exact Caddy-friendly pattern (path "/", XTransformPort query param).
- Created `/home/z/my-project/mini-services/realtime/` as an independent bun project.
- Wrote `package.json` (deps: socket.io; scripts: dev=`bun --hot index.ts`).
- Wrote `index.ts` (socket.io server, port 3003, path "/", cors *) implementing events:
  - `join { userId, role }` -> joins rooms `user:{userId}` + `role:{role}`, ack `{ ok: true }`
  - `message:send { fromId, toId, content, bookingId? }` -> emits `message:new` (id+timestamp) + `notification:new` to `user:{toId}`
  - `booking:update { bookingId, clientId, providerId, status }` -> emits `booking:updated` to both `user:{clientId}` and `user:{providerId}`
  - `quote:update { quoteId, clientId, providerId, status }` -> emits `quote:updated` to both rooms
  - `tracking:position { bookingId, clientId, lat, lng }` -> emits `tracking:position` to `user:{clientId}`
  - `ping` -> ack `{ pong: true, t: Date.now() }`
  - `disconnect` -> logs reason
  - connection logs socket id; SIGTERM/SIGINT graceful shutdown (io.close + httpServer.close + safety timeout).
- Ran `bun install` in the mini-service folder (installed socket.io@4.8.3 + lockfile).
- Started service in background: `nohup bun run dev > service.log 2>&1 &`. Verified log shows `WebSocket server running on port 3003`. HTTP poll on `/?EIO=4&transport=polling` returned 200.
- Installed `socket.io-client` in the main project (`bun add socket.io-client`).
- Created `/home/z/my-project/src/hooks/use-realtime.ts` — singleton client hook:
  - Uses `io("/?XTransformPort=3003")` with path "/" (default), transports websocket+polling, reconnection enabled.
  - SSR guard (`typeof window === 'undefined'`), singleton via module-level `socketRef`.
  - Returns `{ socket, isConnected, status, join, sendMessage, updateBooking, updateQuote, sendTrackingPosition, ping, emit, on, off, disconnect }`.
  - `join` and `ping` use acknowledgements. `on` returns an unsubscribe fn.
- Typecheck (`tsc --noEmit -p tsconfig.json`): no errors from our new files (pre-existing errors in examples/ and skills/ are unrelated to this task).
- Ran integration smoke test (two clients join, sender emits message:send/booking:update/ping): PASS — receiver got `message:new`, `notification:new`, and `booking:updated` correctly.
- Did NOT touch src/app/page.tsx, src/app/layout.tsx, Prisma, or other agents' files.

Stage Summary:

- Files created:
  - `/home/z/my-project/mini-services/realtime/package.json`
  - `/home/z/my-project/mini-services/realtime/index.ts`
  - `/home/z/my-project/mini-services/realtime/service.log` (runtime log)
  - `/home/z/my-project/src/hooks/use-realtime.ts`
- How to run:
  - Service: `cd mini-services/realtime && bun run dev` (already running in background, port 3003, path "/")
  - Frontend: import `useRealtime` from `@/hooks/use-realtime`; call `useRealtime()` and use `join({ userId, role })` on connect.
- Port: 3003 (hard). Path: "/" (hard, required by Caddy). Frontend connects via `io("/?XTransformPort=3003")`.
- Events supported (client->server): `join`, `message:send`, `booking:update`, `quote:update`, `tracking:position`, `ping`.
- Events emitted (server->client): `message:new`, `notification:new`, `booking:updated`, `quote:updated`, `tracking:position`.
- Status: RUNNING (verified by HTTP 200 on polling endpoint + integration smoke test PASS).

---

Task ID: 1
Agent: full-stack-developer (foundation)
Task: Construir a fundação do Severinno Marketplace SaaS — Prisma schema (SQLite, sem enum nativo), seed com 1 admin + 2 clients + 6 providers + categorias 3-níveis + services + bookings/reviews, design system emerald, Zustand stores (auth/geo/view/ui) e lib utilities (crypto scrypt, auth HMAC cookie, geo ViaCEP/Nominatim/haversine, format pt-BR, constants, validators Zod 4).

Work Log:

- Leu worklog.md, package.json, schema.prisma atual, layout.tsx, globals.css, db.ts, tsconfig.json, eslint.config.mjs, dev.log e page.tsx (não modificado).
- Criou `prisma/schema.prisma` com 13 modelos marketplace (User, Category, Service, ProviderAvailability, QuoteRequest, QuoteItem, Booking, Review, Favorite, Message, Notification, Payment, Setting), todos enums como String + comentário, indexes nas colunas de busca.
- Rodou `bunx prisma db push --accept-data-loss` → ok; `bun run db:generate` → ok (Prisma 6.19.2).
- Criou `src/lib/crypto.ts` (scrypt N=16384, salt 16B, timing-safe verify).
- Criou `src/lib/auth.ts` (server-only, cookie httpOnly `severinno_session` com HMAC-SHA256, getSession/requireUser/requireRole/getOptionalSession/destroySession).
- Criou `src/lib/geo.ts` (server-only, haversineKm, formatDistance, geocodeCEP ViaCEP, reverseGeocode Nominatim com User-Agent, formatCurrencyBRL).
- Criou `src/lib/format.ts` (formatBRL/Date/DateTime/Time/Relative + formatHHmm, date-fns locale ptBR).
- Criou `src/lib/constants.ts` (labels/cores pt-BR de roles, units, quote/booking/payment statuses, weekdays, notification types, APP_NAME).
- Criou `src/lib/validators.ts` (Zod 4: login, register com refine, providerProfile, service, category, quote, quoteItemResponse, booking, review, message, setting, availability).
- Criou `prisma/seed.ts` idempotente (wipes na ordem de FKs) + script `db:seed` em package.json. Rodou com sucesso: 9 users, 27 categorias, 13 services, 36 availabilities, 4 bookings+reviews+payments, 2 favorites, 9 notifications, 9 settings.
- Atualizou `src/app/globals.css`: primary emerald `oklch(0.55 0.15 160)` (light) / `oklch(0.7 0.16 160)` (dark), ring/sidebar-primary/accent/chart-1 alinhados, scrollbar thin/rounded com hover emerald, estilos `.map-popup`.
- Atualizou `src/app/layout.tsx`: metadata pt-BR (title "Severinno Marketplace", locale pt_BR, keywords), `<html lang="pt-BR" suppressHydrationWarning>`, wrap children em `<Providers>`.
- Criou `src/components/providers.tsx` combinando next-themes + @tanstack/react-query + sonner Toaster.
- Criou 4 Zustand stores em `src/store/`: auth (persist), geo (persist), view (persist só view+params), ui (não persiste). Centralizou exports em `src/store/index.ts`.
- Rodou `bunx tsc --noEmit` — meus arquivos limpos.
- Rodou `bunx eslint` nos meus arquivos — zero erros. Único erro de lint restante no projeto está em `src/hooks/use-realtime.ts` (não meu, regra `react-hooks/refs`).

Stage Summary:

- **Schema**: `prisma/schema.prisma` — 13 modelos, SQLite-safe (sem enum), indexes em campos de busca. Pushed + Prisma Client gerado.
- **Seed**: `bun run db:seed` (idempotente). Logins: admin@severinno.com/admin123, cliente@severinno.com/cliente123, maria@severinno.com/cliente123, [provider]@severinno.com/provider123.
- **Design system**: `src/app/globals.css` — primary emerald, scrollbar custom, `.map-popup` MapLibre.
- **Layout**: `src/app/layout.tsx` + `src/components/providers.tsx` — ThemeProvider + QueryClientProvider + SonnerToaster, metadata pt-BR.
- **Libs**: `src/lib/{crypto,auth,geo,format,constants,validators}.ts` — prontos para uso por APIs e UI.
- **Stores**: `src/store/{auth,geo,view,ui,index}.ts` — prontos para uso por UI. auth/geo/view persistem em localStorage (`severinno:*`).
- **Agent record**: `/home/z/my-project/agent-ctx/1-foundation.md` — detalhes completos, incluindo 10 caveats para próximos agentes (SQLite sem enum, geo.ts é server-only, SESSION_SECRET em prod, Nominatim User-Agent/limite 1 req/s, etc).
- **Caveats**: (a) `src/lib/geo.ts` importa `server-only` — não usar em client components. (b) `src/hooks/use-realtime.ts` tem erro lint `react-hooks/refs` (fora do escopo Task 1). (c) `src/app/page.tsx` intencionalmente não modificado. (d) zod 4 API: `z.enum([...], { message })` em vez de `errorMap`.

---

Task ID: 3
Agent: full-stack-developer (api routes)
Task: Criar TODAS as rotas de API backend do Severinno Marketplace SaaS (Fase 1 / MVP) sob `src/app/api/**` usando Next.js 16 App Router route handlers + Prisma (SQLite) + Zod, alinhadas ao contrato esperado pela UI (foundation `src/lib/api.ts`).

Work Log:

- Leu worklog.md, agent-ctx/1-foundation.md, prisma/schema.prisma, src/lib/{auth,crypto,geo,constants,validators,db}.ts e os componentes UI que consomem a API (vitrine/, modals/) para inferir o contrato de resposta esperado por `apiGet<T>`.
- Descobriu que `src/lib/api.ts` é o **wrapper tipado client-side** da foundation (apiGet/apiPost/apiPatch/apiDelete + tipos ProviderCard/ProviderDetail/ProviderService/Category/PagedResult/FavoriteResponse/CepResult) — NÃO deve ser tocado.
- Criou `src/lib/api-server.ts` (novo) com helpers server-only: HttpError, handleError (mapeia UNAUTHORIZED→401, FORBIDDEN→403, ZodError→400, HttpError→status), badRequest/unauthorized/forbidden/notFound/conflict, parsePagination, USER_PUBLIC_SELECT, publicUser, getCategoryDescendants (BFS sobre a árvore de categorias).
- Criou 29 route handlers em `src/app/api/` cobrindo: auth (register/login/logout/me), categories (GET público + POST/PATCH/DELETE admin), providers (list com filtros geo/categoria/radius/sort + detail + favorite toggle), services (list/create/patch/delete com regra "preço só sobe"), geo (cep ViaCEP + reverse Nominatim), quotes (create com items + list por role + detail + patch status + item response), bookings (create + list + detail + patch com transition table + pay simulado), reviews (create com validação "uma por booking COMPLETED" + list), messages (conversas + thread com auto-mark-read + send com notificação), notifications (list unread-first + mark read), favorites (list flat), admin (stats agregadas + users paginado + user patch/delete + settings upsert many), upload (multipart → sharp → webp 1200px q80 em public/uploads).
- Alinhou os shapes de resposta ao contrato da UI: categorias/services/favorites retornam arrays flat; providers retorna `{items,total,page,limit}`; provider detail retorna `ProviderDetail` direto com `reviews[].author` (alias para `client`); geo/cep e geo/reverse retornam objetos flat (sem wrapper `address`).
- Tratou erros: `passwordHash` sempre stripado; auth errors via throw "UNAUTHORIZED"/"FORBIDDEN" mapeados por handleError; Zod errors com details; HttpError com status custom; upload com fallback 400 para FormData não-multipart e sharp em imagem corrompida.
- Validou transições de status de booking (PROVIDER: PENDING→CONFIRMED/IN_PROGRESS/CANCELLED; CLIENT: PENDING/CONFIRMED→CANCELLED, CONFIRMED/IN_PROGRESS→COMPLETED). CONFIRM seta paymentStatus=PAID (simulado); CANCEL em booking PAID seta REFUNDED e sincroniza Payment.
- Quote items: validou serviceId pertence ao providerId; status PENDING→RESPONDED automático quando provider responde um item; expiresAt default now+7d.
- Executou `bunx tsc --noEmit` — 0 erros em src/app/api/** e src/lib/api-server.ts (erros remanescentes em src/components/modals/{auth,quote}-modal.tsx e src/components/vitrine/providers-map.tsx são do escopo UI).
- Executou `bunx eslint src/app/api src/lib/api-server.ts` — 0 erros. `bun run lint` só acusa o pré-existente `react-hooks/refs` em src/hooks/use-realtime.ts (Task 2, fora de escopo).
- Smoke tests via curl no dev server (porta 3000) — todos os fluxos críticos OK: categories flat array, providers com filtros/sort/distância/category tree, provider detail com reviews[].author, favorite toggle, auth login+me com cookie, favorites 401→200 com auth, geo/cep flat, quote create+list, booking list, review duplicate guard, message send+notification, notifications list+unreadCount, admin stats+users, upload (401/400/400/201 webp).
- NÃO tocou em src/app/page.tsx, src/app/layout.tsx, src/components/**, src/store/**, src/hooks/**, ou qualquer lib da foundation (src/lib/auth/crypto/geo/constants/validators/db/format.ts e o client-side src/lib/api.ts).

Stage Summary:

- **Arquivos criados**:
  - `src/lib/api-server.ts` — helpers server-only (HttpError, handleError, badRequest/unauthorized/forbidden/notFound/conflict, parsePagination, USER_PUBLIC_SELECT, publicUser, getCategoryDescendants).
  - `src/app/api/auth/{register,login,logout,me}/route.ts` — auth completo (POST register/login/logout, GET me).
  - `src/app/api/categories/route.ts` + `[id]/route.ts` — GET público (array flat), POST/PATCH/DELETE admin (DELETE bloqueia se tem filhas ou serviços → 409).
  - `src/app/api/providers/route.ts` — catálogo público com filtros (q, categoryId subtree, radius haversine), sort (rating|distance), paginação, agregados (rating/reviewCount/favoriteCount/distanceKm).
  - `src/app/api/providers/[id]/route.ts` — detail com services, availability, reviews (author), favorited flag.
  - `src/app/api/providers/[id]/favorite/route.ts` — toggle (CLIENT).
  - `src/app/api/services/route.ts` + `[id]/route.ts` — list (array flat), create (PROVIDER/ADMIN), patch (preço só sobe), delete.
  - `src/app/api/geo/{cep,reverse}/route.ts` — ViaCEP + Nominatim (resposta flat).
  - `src/app/api/quotes/route.ts` + `[id]/route.ts` + `[id]/items/[itemId]/route.ts` — create com items, list por role, detail, patch status, item response (PENDING→RESPONDED).
  - `src/app/api/bookings/route.ts` + `[id]/route.ts` + `[id]/pay/route.ts` — create + payment PENDING, list por role, detail, patch com transition table + side effects (CONFIRM→PAID, CANCEL→REFUNDED), pay simulado.
  - `src/app/api/reviews/route.ts` — create (uma por booking COMPLETED do cliente), list por provider/booking.
  - `src/app/api/messages/route.ts` — conversas (last msg + unread per peer) ou thread (auto mark-read), send com notificação MESSAGE.
  - `src/app/api/notifications/route.ts` + `[id]/read/route.ts` — list unread-first com unreadCount, mark read.
  - `src/app/api/favorites/route.ts` — list flat de ProviderCard com distanceKm opcional.
  - `src/app/api/admin/{stats,users,users/[id],settings}/route.ts` — stats agregadas, users paginado, user patch/delete, settings upsert many.
  - `src/app/api/upload/route.ts` — multipart → sharp → webp 1200px q80 em public/uploads/<uuid>.webp.
- **Decisões chave**:
  - Helpers server-only em arquivo novo (`api-server.ts`) para não tocar o wrapper client-side `api.ts` da foundation.
  - Shapes de resposta alinhados 1:1 ao que `apiGet<T>` (UI) espera — flat arrays p/ categorias/services/favorites, wrapped `{items,total,page,limit}` p/ providers/bookings/quotes/admin, flat object p/ provider detail e geo.
  - Reviews em provider detail renomeadas `client`→`author` (UI usa `r.author.name`).
  - Booking status transitions hard-coded em PROVIDER_NEXT/CLIENT_NEXT (admin pode tudo).
  - Payment simulado: `/api/bookings/[id]/pay` e CONFIRM ambos setam PAID; CANCEL em PAID seta REFUNDED.
  - Quote items: outer providerId usado para todos os items (per-item providerId enviado pela UI é stripped pelo Zod; multi-provider quote é feature futura).
- **Caveats**:
  - `src/lib/api.ts` (foundation) é client-side; NÃO importar de route handlers — use `@/lib/api-server`.
  - Alguns shapes são flat arrays e outros wrapped — não alterar sem checar o consumer.
  - Erros remanescentes de tsc/lint estão todos em arquivos UI (modals/vitrine) e em `src/hooks/use-realtime.ts` (Task 2) — fora de escopo.
  - `public/uploads/` não é versionado em prod (precisaria de CDN/object storage).

---

Task ID: 5
Agent: full-stack-developer (flow modals)
Task: Construir os Flow Modals do Severinno Marketplace SaaS (Fase 1/MVP): Quote flow, Booking flow, Provider Profile modal, Auth modal e bits compartilhados (star-rating, file-photos, address-form) + orchestrator modals-host. Next.js 16 + shadcn/ui + Tailwind 4 + react-hook-form + Zod 4 + TanStack Query + framer-motion. Primary emerald, pt-BR, mobile-first.

Work Log:

- Leu worklog.md + agent-ctx/1-foundation.md para entender stores (useAuthStore/useGeoStore/useUIStore/useViewStore), libs (format/constants/validators) e componentes shadcn disponíveis.
- Verificou que `src/lib/api.ts` já existia (parallel agent) com apiGet/apiPost/apiPatch/apiDelete + fetchProviderDetail/fetchProviders/fetchCategories/toggleFavorite/fetchCep + tipos ProviderCard/ProviderDetail/ProviderService/ProviderAvailability/ProviderReview/Category/CepResult. Estendeu `ProviderService` com `description?` e `photos?` para refletir o contrato real.
- Criou `src/components/modals/star-rating.tsx`: StarRatingDisplay (clip-based, meia estrela via % width) + StarRatingInput (radiogroup ARIA, teclado ←→↑↓ e 1–5, hover preview).
- Criou `src/components/modals/file-photos.tsx`: uploader com preview grid (max N, default 4), 5MB/foto, POST /api/upload com FormData via fetch direto (apiPost existente não suporta FormData porque sempre seta Content-Type: application/json). Fallback para URL.createObjectURL se upload falhar.
- Criou `src/components/modals/address-form.tsx`: CEP com auto-fill ViaCEP (apiGet /api/geo/cep), botão GPS (useGeoStore.setFromGPS + apiGet /api/geo/reverse), campos rua/número/complemento/bairro/cidade/UF (Select). Tipagem AddressFormValue exportada para reuso.
- Criou `src/components/modals/auth-modal.tsx`: Dialog sm:max-w-md com Tabs Login/Cadastrar. Role toggle Cliente/Prestador (cartões animados framer-motion). Campos condicionais para provider (cpfCnpj/whatsapp/cidade/UF) via AnimatePresence. Valida com loginSchema/registerSchema. Chama useAuthStore.login/register, fetchMe, navigate para client.dashboard ou provider.dashboard. "Esqueci a senha" com toast info (no-op MVP).
- Criou `src/components/modals/provider-profile-modal.tsx`: Dialog sm:max-w-3xl (Sheet full-screen mobile via useIsMobile). Cover+avatar+BadgeCheck verified+StarRatingDisplay+distância/cidade. Header actions: Heart favorito (toggle UI), Share2 (navigator.share || clipboard). Tabs: Serviços (Accordion por categoria, Carousel de fotos por serviço, botões Orçamento/Agendar que fecham este modal e abrem quote/booking com preset providerId+serviceId), Sobre (bio+endereço+raio+whatsapp), Avaliações (lista com avatar+nome+stars+comentário+data), Expediente (Table 7 dias com slots em Badge). Footer sticky: Pedir orçamento + Agendar serviço. useQuery /api/providers/:id.
- Criou `src/components/modals/quote-modal.tsx`: multi-item (useFieldArray, max 5, animação add/remove framer-motion). Cada item: ProviderCombobox (Popover+Command, async search via useQuery /api/providers?q=), ServiceSelect (Select dependente do provider, useQuery /api/services?providerId=), descrição textarea (min 10), quantidade+unidade (Select), FilePhotos (max 4). Seção 2: AddressForm reusado. Seção 3: Resumo (lista de itens + endereço). Footer sticky com total + submit. POST /api/quotes. Toast success + navigate client.quotes. Auth gate: se não logado → toast info + openAuth('register','CLIENT'). Resolver cast `as unknown as Resolver<T>` por known issue Zod 4 com z.coerce.number().
- Criou `src/components/modals/booking-modal.tsx`: 3-step stepper inline (dots animados + linha + Progress bar). Step 1: Calendar (react-day-picker, pt-BR, disable past) + slots 60min gerados da availability do dia selecionado (mensagem "Prestador não atende neste dia" se vazio). Step 2: card resumo (provider avatar+name, service title+price+unit, data/hora, valor), quantidade, AddressForm, notes textarea. Step 3: RadioGroup PIX/Cartão (PaymentOption cards com ícone). Cartão mock (número formatado, validade MM/AA, CVV) marcado "Demonstração". PIX com QR placeholder + copiar chave + "Já paguei". Amount summary (service × qty + fees=0 + total). POST /api/bookings. Toast + navigate client.bookings. Auth gate no início do flow. Validação por step (step1Valid/step2Valid/step3Valid), Continuar disabled se inválido.
- Criou `src/components/modals/modals-host.tsx`: <ModalsHost /> monta os 4 modais (Auth, Provider, Quote, Booking). Cada modal lê seu open-state do useUIStore. Sem props.
- Corrigiu 3 warnings de unused eslint-disable directives (file-photos, provider-profile-modal x2, quote-modal x1).
- TypeScript: 2 erros iniciais em auth-modal (Resolver mismatch por z.coerce) + 4 erros em quote-modal (idem + AddressFormValue lat/lng null vs undefined). Corrigidos com: cast `as unknown as Resolver<T>`, schema lat/lng com `.nullable().optional()`, e schema complement/district como `z.string().default("")` (não optional) para match com AddressFormValue.
- Verificação final: `bun run lint` → 0 erros nos meus arquivos (2 erros pre-existing em use-realtime.ts não meu). `bunx tsc --noEmit` → 0 erros nos meus arquivos (2 erros pre-existing em vitrine/providers-map.tsx não meu). Dev server log mostra /api/providers, /api/categories, /api/upload, /api/messages, /api/bookings funcionando.

Stage Summary:

- **Modais criados** (todos client components, SSR-safe):
  - `src/components/modals/star-rating.tsx` — StarRatingDisplay + StarRatingInput
  - `src/components/modals/file-photos.tsx` — FilePhotos uploader (FormData via fetch, fallback object URL)
  - `src/components/modals/address-form.tsx` — AddressForm (CEP + GPS + UF select)
  - `src/components/modals/auth-modal.tsx` — AuthModal (Tabs login/register, role toggle)
  - `src/components/modals/provider-profile-modal.tsx` — ProviderProfileModal (Dialog/Sheet, 4 tabs, accordion+carousel)
  - `src/components/modals/quote-modal.tsx` — QuoteModal (multi-item useFieldArray, combobox provider, dependent service select)
  - `src/components/modals/booking-modal.tsx` — BookingModal (3-step stepper, calendar+slots, address, payment mock)
  - `src/components/modals/modals-host.tsx` — ModalsHost (orchestrator, mount once)
- **Key UX decisions**: Dialog desktop + Sheet mobile (useIsMobile), emerald accent everywhere, framer-motion para item add/remove + step transition + role toggle, auth gate (prevention heuristic) antes de submeter quote/booking, validation per-step no booking, sticky footer com submit + total, fallback gracioso em uploads.
- **Caveats**:
  (a) ModalsHost precisa ser montado no app shell (importar `@/components/modals/modals-host`).
  (b) `/api/upload` em paralelo ainda intermitente — FilePhotos faz fallback para blob URL.
  (c) Resolver cast `as unknown as Resolver<T>` em 3 resolvers (login/register/quote) por known issue Zod 4 + z.coerce.
  (d) ProviderService estendido em src/lib/api.ts (paralelo) com `description?` e `photos?`.
  (e) Booking slots: 60min fixo, não checa conflitos com bookings existentes (MVP).
  (f) Pagamento totalmente mock (card form não envia para gateway; PIX usa chave fixa).
  (g) Favorito no provider modal é toggle UI-only (não chama /api/favorites ainda).
  (h) Share usa navigator.share quando disponível, senão clipboard.

---

Task ID: 4
Agent: full-stack-developer (vitrine) [completed files; verification record added by orchestrator after agent cancellation]
Task: Build the public storefront (vitrine) with MapLibre map, provider cards, filters, hero, topbar, footer.

Work Log:

- Installed maplibre-gl.
- Created src/lib/api.ts (typed fetch wrapper + shared API types: ProviderCard, Service, etc.).
- Created src/components/vitrine/{topbar,hero,category-showcase,how-it-works,filters,provider-card,providers-map,vitrine-results,vitrine}.tsx
- Created src/components/shared/footer.tsx (sticky footer for min-h-screen flex-col layout).
- maplibre map uses OSM raster tiles with attribution; SSR-guarded; emerald markers; fitBounds; popups.
- All fetches RELATIVE via TanStack Query.

Stage Summary:

- Vitrine complete and lint-clean (0 eslint errors).
- Components: Topbar (search+GPS+auth), Hero (emerald gradient + search), CategoryShowcase, HowItWorks, Filters (3-level category cascade + radius + sort), ProviderCard (cover+avatar+rating+distance+accordion services+Orçamento/Agendar), ProvidersMap (maplibre), VitrineResults (list/map toggle + pagination), Vitrine orchestrator.
- Sticky footer at src/components/shared/footer.tsx.
- Caveat: providers-map.tsx had pre-existing tsc notes (per Task 5 agent) — to be re-checked in final verification.

---

Task ID: 7
Agent: full-stack-developer (provider panel)
Task: Construir o PAINEL DO PRESTADOR do Severinno Marketplace SaaS (Fase 1 / MVP): 10 views (dashboard, expediente, agenda, bookings, quotes, services, finance, messages, reviews, profile) + orquestrador provider-panel + 3 rotas API (availability GET/POST, availability/[id] DELETE, users/me GET/PATCH) + shared MessagesView. Next.js 16 + shadcn/ui + Tailwind 4 + recharts + react-hook-form + Zod 4 + TanStack Query. Primary emerald, pt-BR, mobile-first.

Work Log:

- Leu worklog.md + agent-ctx/1-foundation.md + stores (auth/view/ui) + libs (api, api-server, auth, validators, constants, format) + rotas API existentes (services, bookings, quotes, messages, notifications, reviews, categories, auth/me) + componentes shared (footer) + modais (file-photos, star-rating, address-form) + hooks (use-realtime, use-mobile) + UI primitives (sidebar, card, avatar, button, table, tabs, dialog, alert-dialog, dropdown-menu, popover, switch, input, textarea, select, slider, scroll-area, separator, tooltip, pagination).
- Confirmou que `src/app/api/users/me/route.ts` NÃO existia → criou. Confirmou que `src/app/api/availability/*` NÃO existia → criou as 2 rotas.
- Confirmou que `src/components/shared/dashboard-shell.tsx` foi criado EM PARALELO pelo Task 6 (Client Panel) — e eles sobrescreveram minha versão inicial com uma API diferente (`panelLabel` + `panelIcon` em vez de `headerLabel`). Adaptei o `provider-panel.tsx` para respeitar o contrato final deles (read-first, never-overwrite respeitado).
- Criou `src/components/shared/messages-view.tsx` (chat 2-pane reutilizável com realtime via useRealtime).
- Criou 10 views em `src/components/provider/`:
  1. `provider-dashboard.tsx` — KPIs (hoje/semana, orçamentos pendentes, avaliação média, receita recebida) + 2 charts (recharts: agendamentos 7 dias bar, receita por mês line) + 3 listas recentes (próximos agendamentos, orçamentos pendentes, últimas avaliações) + quick actions.
  2. `provider-expediente.tsx` — 7 cards de dia da semana (Dom-Sáb), cada um com lista de slots {startTime, endTime, active}, add/remove slot, Switch de ativo, "Copiar para dias úteis", aviso de sobreposição, validação startTime < endTime, POST /api/availability upsert.
  3. `provider-agenda.tsx` — Calendar grid mensal (date-fns) com dots coloridos por status, navegação mês anterior/próximo, tabs Hoje/Semana/Mês, lista do dia selecionado, mapa OpenStreetMap link nos detalhes. Read-only.
  4. `provider-bookings.tsx` — Tabs por status (Pendentes/Confirmados/Em andamento/Concluídos/Cancelados/Todos), cards com avatar+cliente+serviço+data+endereço+valor+status, ações em dropdown (Confirmar, Iniciar, Cancelar, Ver detalhes, Enviar mensagem), dialog de detalhes com link "Abrir no mapa", paginação.
  5. `provider-quotes.tsx` — Tabs por status (Pendentes/Respondidos/Aprovados/Rejeitados/Todos), cards expandíveis por request, cada item com formulário de resposta (price + note + Enviar orçamento) para PENDING, mostra preço/nota para QUOTED, link "Enviar mensagem ao cliente".
  6. `provider-services.tsx` — CRUD completo: lista com thumbnail, título, categoria, preço+unidade, active toggle inline, editar/excluir; Dialog form com cascade 3-nível (pai → filha → subcategoria) usando Select, validação serviceSchema, FilePhotos (max 4), preço só sobe (alerta se menor que atual), AlertDialog de exclusão, busca textual.
  7. `provider-finance.tsx` — Cards de resumo (Recebido/A receber/Estornado no ano), chart de receita por mês (recharts bar), filtros por status+mês+ano, tabela de transações com cliente+serviço+método+status+valor.
  8. `provider-messages.tsx` — Wrapper do MessagesView shared com initialPeerId vindo dos params (para navegar a partir de bookings/quotes).
  9. `provider-reviews.tsx` — Card de avaliação média + distribuição (5★-1★ com barras), lista de reviews com avatar+nome+stars+comentário+data+serviço+booking, empty state.
  10. `provider-profile.tsx` — Cover+avatar preview, SinglePhoto uploader para avatar e cover, formulário com name/bio/whatsapp/phone, campos read-only (email, cpfCnpj, verified badge), AddressForm fields (CEP/rua/número/complemento/bairro/cidade/UF), Slider de raio de atendimento, botão GPS, PATCH /api/users/me.
- Criou `provider-panel.tsx` (orquestrador): mapeia `useViewStore.view` → view correspondente, monta DashboardShell com nav items (10 itens com ícones Lucide: LayoutDashboard, Clock, CalendarDays, CalendarCheck, FileText, Wrench, Wallet, MessageSquare, Star, User) + badges dinâmicos (pendingQuotes, pendingBookings) + breadcrumbs + headerLabel "Painel do Prestador".
- Criou 3 rotas API:
  - `src/app/api/availability/route.ts` — GET (own availability) + POST (upsert array, replace strategy via $transaction deleteMany + create, valida startTime < endTime, schema availabilitySchema).
  - `src/app/api/availability/[id]/route.ts` — DELETE (owner check).
  - `src/app/api/users/me/route.ts` — GET (USER_PUBLIC_SELECT) + PATCH (providerProfileSchema, only owner).
- Coordenação com Task 6: meu dashboard-shell.tsx inicial foi sobrescrito pelo Task 6 (eles criaram a versão final). Adaptei provider-panel.tsx para o contrato final deles (`panelLabel` + `panelIcon` em vez de `headerLabel`). Meu messages-view.tsx permanece intacto e reutilizável por ambos os painéis.
- Verificação:
  - `bunx tsc --noEmit` → 0 erros nos meus arquivos (erros remanescentes em examples/, skills/, src/components/vitrine/providers-map.tsx, src/components/client/client-dashboard.tsx — todos fora do meu escopo).
  - `bunx eslint src/components/provider src/components/shared/messages-view.tsx src/app/api/availability src/app/api/users/me` → 0 erros, 0 warnings.
  - `bun run lint` (projeto inteiro) → só 2 erros pre-existing em `src/hooks/use-realtime.ts` (Task 2, `react-hooks/refs`).
  - Dev server compilando sem erros novos (apenas warnings pré-existentes em /api/upload).
- Correções durante o lint:
  - Removido `now` do deps array de `useMemo` em provider-finance.tsx (React Compiler preserve-manual-memoization).
  - Removidos 4 `// eslint-disable-next-line @next/next/no-img-element` unused directives (provider-quotes, provider-profile x2, provider-services).
  - Trocado `form.watch("basePrice")` por `useWatch({ control, name: "basePrice" })` em provider-services.tsx (react-hooks/incompatible-library warning).
- Não tocou em src/app/page.tsx, src/app/layout.tsx, vitrine, modais, stores, foundation lib, ou arquivos do painel client/admin.

Stage Summary:

- **Views criadas** (`src/components/provider/`):
  - `provider-dashboard.tsx` — overview com KPIs + 2 charts (recharts) + 3 listas recentes
  - `provider-expediente.tsx` — gerenciamento de disponibilidade semanal (7 dias, add/remove slots, ativo toggle, copiar para dias úteis)
  - `provider-agenda.tsx` — calendário mensal + lista do dia (date-fns, read-only)
  - `provider-bookings.tsx` — gestão de agendamentos com tabs por status + ações (confirmar/iniciar/cancelar/detalhes/mensagem)
  - `provider-quotes.tsx` — gestão de orçamentos com tabs por status + formulário de resposta por item
  - `provider-services.tsx` — CRUD de serviços com cascade 3-nível de categorias + FilePhotos + AlertDialog de exclusão
  - `provider-finance.tsx` — financeiro com cards de resumo + chart mensal + filtros + tabela de transações
  - `provider-messages.tsx` — wrapper do MessagesView shared
  - `provider-reviews.tsx` — avaliações recebidas com média + distribuição + lista
  - `provider-profile.tsx` — edição de perfil com avatar/cover + address + radius + GPS
  - `provider-panel.tsx` — orquestrador que mapeia view → componente, monta DashboardShell com nav + badges + breadcrumbs
- **API routes criadas**:
  - `src/app/api/availability/route.ts` — GET + POST (upsert)
  - `src/app/api/availability/[id]/route.ts` — DELETE
  - `src/app/api/users/me/route.ts` — GET + PATCH (criada porque não existia)
- **Shared components criados**:
  - `src/components/shared/messages-view.tsx` — chat 2-pane reutilizável (client + provider) com realtime via useRealtime hook, conversas list + thread + composer.
- **Caveats**:
  (a) `dashboard-shell.tsx` foi criado EM PARALELO pelo Task 6 — minha versão inicial foi sobrescrita pela deles. Adaptei-me ao contrato final deles (`panelLabel` + `panelIcon`). Se outro agente precisar usar o shell, leia o header do arquivo para o contrato atual.
  (b) `users/me` route: criada por mim (Task 7) já que Task 6 não havia criado quando comecei. Se Task 6 também criou, há risco de merge conflict — meu conteúdo prevaleceu (escrito depois).
  (c) Availability POST usa strategy "delete all + create all" (idempotente). IDs mudam a cada save — frontend nunca reutiliza IDs para atualização local.
  (d) Provider dashboard deriva KPIs de 3 chamadas (bookings/quotes/reviews) com limit=200 — suficiente para MVP, mas pode precisar de endpoints agregados dedicados em escala.
  (e) Quote items mostram TODOS os items do request (não só os do provider logado). Backend já filtra requests via OR no providerId, mas items array vem completo. Defensivo: provider só pode responder aos próprios items (validação server-side).
  (f) Bookings: provider NÃO pode concluir (apenas cliente) — UI mostra nota explicativa e esconde o botão Concluir.
  (g) Mensagens: MessagesView invalida queries em tempo real via socket `message:new`. Refetch interval de 10-15s como fallback.
  (h) Profile: avatar/cover usam fetch direto (não apiPost) porque apiPost sempre seta Content-Type JSON. Mesmo padrão do FilePhotos.
  (i) Não implementei paginação nos quotes (limit=50) — se ultrapassar, precisará de paginação real. Bookings tem paginação (10 por página).
  (j) Mapa nos detalhes de booking é um link externo para OpenStreetMap (sem maplibre inline para manter o bundle leve).

---

Task ID: 6
Agent: full-stack-developer (client panel) [files complete; agent stopped during reporting — record added by orchestrator]
Task: Build the Client panel (dashboard, bookings, quotes, services, finance, messages, reviews, favorites, profile).

Work Log:

- Created src/components/shared/dashboard-shell.tsx (sidebar + topbar + notifications + user dropdown, reusable by all panels).
- Created 11 files in src/components/client/: client-dashboard, client-bookings, client-quotes, client-services, client-finance, client-reviews, client-favorites, client-messages, client-profile, client-panel (orchestrator), review-dialog.
- client-panel maps useViewStore.view ('client.*') to views; nav items with lucide icons + emerald accent.

Stage Summary:

- DashboardShell at src/components/shared/dashboard-shell.tsx (API: navItems, currentView, title, subtitle, breadcrumbs, user, onNavigate, panelLabel, panelIcon).
- Client panel complete. 11 views. Uses TanStack Query + realtime hook for messages/notifications.
- review-dialog for post-completion reviews.

---

Task ID: 8
Agent: full-stack-developer (admin panel) [files complete; agent stopped during reporting — record added by orchestrator]
Task: Build the Admin panel (dashboard, taxonomy tree, users, providers, services, bookings, settings).

Work Log:

- Created 8 files in src/components/admin/: admin-dashboard, admin-taxonomy (3-level tree, flagship), admin-users, admin-providers, admin-services, admin-bookings, admin-settings (.env-like config console), admin-panel (orchestrator).
- admin-panel maps useViewStore.view ('admin.*') to views; nav: Visão geral, Taxonomia, Usuários, Prestadores, Serviços, Agendamentos, Configurações.

Stage Summary:

- Admin panel complete. 8 views.
- Flagship: admin-taxonomy.tsx (3-level autoconfigurable category tree with pai›filha›subcategoria, inline edit, delete with 409 guard, service counts).
- admin-settings.tsx: dynamic .env-like configuration console (grouped by prefix, inline edit, add/delete).

---

Task ID: 9
Agent: orchestrator (main route integration)
Task: Integrate all surfaces into the single / route (SPA view-switching) + app shell + footer.

Work Log:

- Rewrote src/app/page.tsx as the AppShell: hydration gate (useSyncExternalStore), initial fetchMe, view-based routing (vitrine / client.* / provider.* / admin.*), auth guard for panel views (gated on mounted+initialized to avoid hydration race), realtime room join on auth, global ModalsHost mount.
- Fixed use-realtime.ts lint errors (react-hooks/refs + set-state-in-effect) by removing the exposed `socket` ref and extracting socket-status sync into a callback.
- Added src/types/css-modules.d.ts for maplibre-gl CSS import.
- Fixed providers API bug: radius filter was excluding all providers when lat/lng absent (now only applies when hasGeo).
- Fixed auth-modal navigation: LoginForm now navigates by role (was missing entirely); RegisterForm now handles ADMIN role (was hardcoding client/provider). Removed redundant fetchMe() after login that could null out the user.

Stage Summary:

- Single / route fully functional: vitrine (default), client/provider/admin panels via view-switching.
- Auth guard robust against hydration timing (mounted gate).
- Post-login navigation routes to the correct panel per role.

---

Task ID: 10
Agent: orchestrator (E2E verification)
Task: End-to-end browser verification of all surfaces and flows.

Work Log:

- Verified with Agent Browser + VLM (image analysis):
  - Vitrine: topbar (logo, search, GPS, Entrar/Cadastrar, category nav), hero (emerald gradient, search, trust badges), 6 provider cards (cover, avatar, rating stars, distance, services accordion, Orçamento/Agendar buttons), footer (sticky, all sections, Open Source attribution).
  - Provider profile modal: cover, avatar, name, 5.0 rating, 4 tabs (Serviços/Sobre/Avaliações/Expediente), service list, Pedir orçamento/Agendar buttons.
  - Auth modal: login/register tabs, email/password, role toggle.
  - Admin panel: dashboard with KPIs (9 usuários, R$ 720 receita, 4 agendamentos), sidebar, charts. Taxonomy tree (3-level: Reparos→Elétrica/Hidráulica/Pintura, +Nova categoria, edit/delete/toggle). Settings console.
  - Client panel: dashboard with KPIs (agendamentos, orçamentos, serviços, total investido), charts, all 9 nav items.
  - Provider panel: dashboard with KPIs (hoje, orçamentos pendentes, avaliação, receita), all 10 nav items. Services CRUD with 3-level category cascade, title/description/price/unit/photo upload.
- Lint: 0 errors. Dev log: clean (all 200s, no errors). Realtime service: accepting connections.

Stage Summary:

- FASE 1 (MVP) fully verified end-to-end. All 3 personas (Cliente, Prestador, Admin) functional. Vitrine with MapLibre-ready map, provider cards, quote/booking flows, realtime service running on port 3003.

---

Task ID: F0
Agent: orchestrator (frontend focus — auth fix)
Task: Fix auth store persistence race condition causing guard to fire on reload after cookie-based login.

Work Log:

- Root cause: `initialized: true` was persisted, so on reload the guard saw initialized=true + user=null (when login happened via cookie, not store) and reset the view to vitrine + opened auth modal.
- Fix: removed `initialized` from the persist partialize. Now `initialized` always starts false on mount and flips to true only after fetchMe() verifies the session cookie. The guard in page.tsx (gated on `mounted && initialized`) waits for this before evaluating.
- Verified: client.dashboard view now persists across reload after cookie login.

Stage Summary:

- Auth guard race condition resolved. Panel navigation now robust.

---

Task ID: F1
Agent: frontend-styling-expert (vitrine polish)
Task: Polish the vitrine (storefront) visual design — topbar, hero, category showcase, how-it-works, provider card, filters, vitrine-results, footer — to production-polished level. Edit existing files surgically; preserve all component APIs, props, exports, and data logic.

Work Log:

- src/components/vitrine/topbar.tsx: tighter sticky header (`bg-background/80 backdrop-blur-md`), emerald pill location chip (`bg-emerald-50 text-emerald-700 border-emerald-200`) with prominent mobile shortcut button; aligned Entrar (ghost) and Cadastrar (default) at same h-9 size sm; category nav now relative with fade-edge gradients; pills tightened (h-8, hover:text-primary); mobile sheet auth reordered (Entrar outline, Cadastrar primary, both h-11); mobile location uses emerald outline card; logo button shrinks correctly.
- src/components/vitrine/hero.tsx: stronger typographic hierarchy (`text-3xl md:text-5xl font-bold tracking-tight` title + `font-light` subtitle on emerald-50/90); gradient extended to teal-800; search card is pure white `rounded-2xl shadow-2xl p-2` with `h-12` left-aligned inputs and prominent `h-12` emerald Buscar button; GPS link is now a subtle `text-emerald-50 hover:text-white hover:underline` pill (LocateFixed icon); trust badges get larger `size-8 bg-white/10 ring-1 ring-white/15` circles and `text-sm` labels; section padding tightened to `py-12 md:py-16`.
- src/components/vitrine/category-showcase.tsx: section title bumped to `text-2xl md:text-3xl`; cards now `min-w-[140px]` and flex (horizontal scroll) on mobile → grid on sm+; emerald circle icons (`bg-emerald-50 text-emerald-700`); shadow-sm baseline + hover lift + emerald-300 hover border + `bg-emerald-50/40` hover tint.
- src/components/vitrine/how-it-works.tsx: dropped the wrapper card in favor of a cleaner centered header + 3-col grid; each step card `rounded-xl border p-6 text-center shadow-sm hover:shadow-md`; numbered badge (1/2/3) as `size-6 rounded-full ring-1 ring-primary/30` on the icon's corner; tighter `py-12 gap-6`.
- src/components/vitrine/provider-card.tsx: card now `rounded-xl shadow-sm hover:shadow-md hover:border-emerald-200`; cover fixed `h-32 md:h-36` with subtle bottom gradient overlay; verified badge replaced with `bg-emerald-500` pill + ShieldCheck icon (top-left); favorite heart is `bg-white/90 backdrop-blur shadow-sm hover:bg-white`, active state `fill-rose-500 text-rose-500`; avatar `size-14 -mt-7 ml-4 border-4 border-card` (overlapping cover, counter moved into rating line as `(reviewCount)`); rating line `Star amber-400 + number + count text-xs`; distance uses `text-emerald-600`; service rows `border-b last:border-b-0` with price in `text-emerald-700 font-medium`; footer buttons all `h-9 size sm` with Orçamento outline emerald-tinted, Agendar solid, Ver perfil ghost; skeleton updated to match the new shorter cover + avatar cutout.
- src/components/vitrine/filters.tsx: removed redundant badge import; labels now `text-xs font-medium text-muted-foreground`; radius live value is an emerald pill chip; sort is a 2-col segmented control (`SortOption`) replacing the plain select; added a breadcrumb chip (`border-emerald-200 bg-emerald-50/60 text-emerald-800`) showing the selected category path with X to clear; verified-only row hover border-emerald-200; gap scale tightened to gap-5.
- src/components/vitrine/vitrine-results.tsx: removed Badge import; active filter chips restyled to emerald pill chips (`border-emerald-200 bg-emerald-50 text-emerald-800`); view-toggle segmented control now always visible (was `hidden sm:inline-flex`) with `shadow-sm`; results grid `gap-5` and `sm:grid-cols-2 xl:grid-cols-3`; map view height bumped to `h-[500px]` with `rounded-xl overflow-hidden`; selection ring rounded-xl; sidebar has shadow-sm; empty state gets `size-16` emerald circle with SearchX + emerald-tinted "Limpar filtros" CTA; result count title `tracking-tight`.
- src/components/vitrine/vitrine.tsx: untouched (orchestrator) — visual polish comes from children.
- src/components/shared/footer.tsx: converted to dark `bg-slate-900 text-slate-300 border-t border-slate-800`; brand text white, body text `slate-400 hover:text-white`, headers `slate-500`; social icons `border-slate-700 hover:border-primary hover:text-primary`; bottom bar `border-slate-800 mt-8 pt-6 text-xs text-slate-500` with MapLibre/OSM links `slate-400 hover:text-white`; tightened gaps to gap-2.5 between links.

Stage Summary:

- All 9 owned files surgically polished; component APIs (props/exports), data logic, query hooks, mutations and event handlers untouched.
- `bunx tsc --noEmit` — 0 errors in src/components/vitrine/** and src/components/shared/footer.tsx (only pre-existing baseline errors in examples/ and skills/ remain).
- `bun run lint` — passes with 0 errors.
- Visual language is now consistent: emerald primary throughout, slate-900 footer for contrast, amber-400 rating stars, emerald pills for active chips/badges, shadow-sm cards with hover:shadow-md and emerald-tinted hover borders, consistent rounded-xl on cards and rounded-lg on inner controls.
- Mobile-first verified: topbar collapses to hamburger + emerald location icon shortcut, hero stacks single-column with full-width search, category showcase horizontal-scrolls, filters move into a Sheet, results grid collapses to 1 col, footer grid → 2 cols.
- Caveats: framer-motion was NOT introduced (existing components use CSS transitions for hover lifts; kept performance predictable). Providers-map.tsx was NOT touched (outside owned scope). No API/data changes.

---

Task ID: F3
Agent: full-stack-developer (modals polish)
Task: Refine visual design, layout density, transitions, and form UX of all flow modals (auth, provider profile, quote, booking) plus shared bits (file-photos, address-form, star-rating, modals-host) to a production-polished level. Emerald primary, pt-BR, mobile-first, Nielsen heuristics.

Work Log:

- src/components/modals/auth-modal.tsx: rebuilt header with brand mark (emerald gradient + Wrench tile), pill-style tab toggle (rounded-full, active = bg-primary text-primary-foreground), Mail/Lock icons inside h-10 inputs, full-width h-11 emerald submit buttons, role toggle as large selectable cards (icon + label + description, selected = border-primary bg-primary/5 ring-1 ring-primary), inline helper text, animated form-level error messages via framer-motion, provider fields helper badges reformatted as an emerald-tinted alert.
- src/components/modals/provider-profile-modal.tsx: cover with gradient overlay, avatar border-4 border-card + shadow-sm, name text-xl font-bold, distance now uses Navigation icon, custom action row (close X + share + favorite) so Dialog default close is hidden via showCloseButton={false}; on mobile Sheet default close hidden via [&_[data-slot=sheet-close]]:hidden; pill-style scrollable tabs (active = bg-primary text-primary-foreground); ReviewsTab now shows big-number summary + 5★→1★ distribution bars + reviews list; HoursTab adds a status column (Aberto/Fechado badge) and "hoje" highlight on current weekday; AboutTab adds a small radius visual (concentric circles) and uses uppercase section labels; service cards show price as text-emerald-700 font-semibold (no longer a Badge).
- src/components/modals/quote-modal.tsx: dialog header subtitle changed to "Solicite orçamentos de um ou mais serviços."; new auth-gate alert (amber-50 bg, amber-200 border) with "Entrar / Cadastrar" button shown when user is not authenticated; ItemCard padding standardized to rounded-xl border p-4; "Adicionar item" button uses border-dashed border-primary/30 hover:border-primary hover:bg-primary/5; AddressForm wrapped in rounded-xl border bg-card p-4; sticky footer button is h-11 emerald; footer count now uses unique provider count via Set; button label changed to "Enviar orçamentos".
- src/components/modals/booking-modal.tsx: dialog width sm:max-w-lg (was sm:max-w-2xl); slot grid uses rounded-lg border p-2 text-sm text-center, selected = border-primary bg-primary/10 text-primary (was solid emerald); no-slots state uses CalendarOff icon + "Prestador não atende neste dia"; payment option cards now use border-primary bg-primary/5 ring-1 ring-primary when selected (was emerald-600); card form is rounded-xl border p-4 with "Demonstração — não processa pagamento real" badge; PIX QR placeholder is rounded-lg bg-slate-100 p-8 text-center; footer buttons h-11 emerald.
- src/components/modals/file-photos.tsx: replaced tiny square buttons with a full-width drag-drop zone (border-2 border-dashed, hover:border-primary hover:bg-primary/5, UploadCloud icon, drag state styling); preview grid is grid-cols-4 gap-2 with aspect-square rounded-lg overflow-hidden cells; max indicator reads "X/4 fotos"; supports keyboard activation (Enter/Space) on the drop zone; preserved value/onChange/max/label/hint/disabled API.
- src/components/modals/address-form.tsx: tightened grid to gap-3; all inputs h-10 text-sm; GPS button uses border-primary/30 text-primary hover:bg-primary/5 styling for prominence; UF select now in 2-col grid alongside a "Localização confirmada" status pill (or hint when no coords); errors shown under UF select.
- src/components/modals/star-rating.tsx: default StarRatingInput size bumped to 32 (size-8 per spec); added ml-1.5 spacing for value label.
- src/components/modals/modals-host.tsx: untouched (no design changes needed; only mounts the four modals).

Stage Summary:

- Visual: pill tabs, large role/payment cards, polished header/cover with custom action buttons, distribution bars on reviews, status badges on expediente, drag-drop photo zone — all aligned to emerald primary and shadcn tokens.
- Form UX: consistent h-10 inputs + text-sm, h-11 emerald submit buttons, helper text, inline error text, animated transitions (framer-motion for tab/form errors and step changes preserved), auth gate visible on quote flow, GPS button visually prominent.
- Mobile: provider profile uses full-screen Sheet on mobile with the default close hidden (custom close X lives in the cover); other modals keep standard Sheet close.
- Verification: `bunx eslint src/components/modals/` exits 0; `bunx tsc --noEmit` reports no errors in src/components/modals/* (pre-existing errors in admin-dashboard.tsx and skills/ examples are out of scope for F3).
- Caveats: Did not change any component APIs (props, exports, store actions, API calls). The drag-drop FilePhotos uses native HTML5 drag events (works on desktop; mobile falls back to tap-to-pick). Booking step 1 calendar selection color comes from --primary (emerald) via shadcn Calendar tokens — no override needed.

---

Task ID: F2
Agent: frontend-styling-expert (dashboard polish)
Task: Polish the three dashboard panels (client / provider / admin) and the shared DashboardShell to a production-polished level — KPI cards, charts, spacing, hierarchy, sidebar/topbar, notifications dropdown.

Work Log:

- `src/components/shared/dashboard-shell.tsx`:
  - Added `next-themes` `useTheme` import + `framer-motion` `motion` import; added Sun/Moon + CheckCheck icons (removed unused LocateFixed).
  - Sidebar nav: `SidebarMenuButton` now uses `size="lg"` with `rounded-lg`, emerald-tinted active state (`!bg-primary/10 !text-primary font-medium`) + a `size-1` left emerald indicator bar; icons `size-4`, labels `text-sm`; group label uppercase tracking.
  - Sidebar header: rounded-xl emerald icon tile (size-9) + panel name + APP_NAME.
  - Sidebar footer (desktop + mobile Sheet): avatar + name + role badge (Badge variant=secondary) + ghost logout button; mobile Sheet nav restyled to match desktop (rounded-lg + left indicator bar).
  - Topbar: `h-14 border-b bg-background/80 backdrop-blur`; page title bumped to `text-base md:text-lg font-semibold tracking-tight` + subtitle `text-xs text-muted-foreground`. Avatar trigger is now borderless (`p-0.5 rounded-full`), location chip uses `border bg-card rounded-full` with MapPin (not LocateFixed).
  - Added theme toggle (Sun/Moon) between location chip and notifications bell.
  - NotificationsBell: redesigned to `w-80 p-0` dropdown with header (title + "X novas" emerald badge + "Marcar todas" button), unread dot in emerald with ring border for read items, `text-[10px]` relative time, type badge. Added `onMarkAllRead` mutation (parallel PATCHes).
  - StatCard: rewritten to spec — `rounded-xl bg-card p-5 shadow-sm hover:shadow-md` wrapper, `size-10 rounded-lg bg-primary/10 text-primary` icon tile, `text-2xl font-bold tracking-tight tabular-nums` value, `text-xs uppercase tracking-wide text-muted-foreground` label, optional `text-xs` hint; wrapped in framer-motion `motion.div` with `delay: index * 0.05` stagger; added optional `trend` pill (up/down arrow).
  - SectionTitle: bumped to `text-base md:text-lg font-semibold tracking-tight` + `text-xs` description.

- `src/components/client/client-dashboard.tsx`:
  - Replaced inline PIE_COLORS with emerald family palette (emerald-400/500/600, teal-400/500/600, lime-400).
  - Added shared `CHART_TOOLTIP_STYLE` constant (popover bg, border, 12px font, soft shadow).
  - KPI grid: gap-4, each StatCard passes `index` for stagger; full labels shown (no truncation).
  - Charts row: each Card is `rounded-xl shadow-sm p-5`, with an icon-tile + `text-sm font-semibold uppercase tracking-wide text-muted-foreground` title.
  - Area chart (bookings/month): switched to `var(--primary)` for stroke/fill, gradient 0.35→0.02 opacity, dashed cursor, axis ticks `fill: var(--muted-foreground)`, grid `var(--border)`.
  - Donut (spending by category): `innerRadius=60 outerRadius=90`, `stroke=var(--background) strokeWidth=2`, legend below in 2-col grid with color dots + values.
  - Activity list + upcoming bookings preview: polished cards with `rounded-xl shadow-sm hover:shadow-md`, emerald avatar fallbacks, consistent status badges.

- `src/components/provider/provider-dashboard.tsx`:
  - Removed local `StatCard` + unused imports (`Bell`, `Link`, `addDays`, `formatTime`, `LineChart`/`Line`, `CardDescription`/`CardHeader`/`CardTitle`, `BOOKING_STATUS_LABELS`); switched to shared `StatCard` from dashboard-shell.
  - KPI row relabeled per spec: "Agendamentos hoje", "Orçamentos pendentes", "Avaliação média" (with `N avaliações` hint), "Receita recebida" (formatBRL).
  - Charts: Bar (7-day bookings) + Area (revenue/month, was LineChart) with emerald `var(--primary)` palette, consistent axis ticks/grid, dashed cursor for area, `barSize=28`, styled tooltip.
  - Quick action buttons: removed oversaturated `bg-emerald-600 hover:bg-emerald-700` from Expediente (now uses default primary token).
  - Three recent lists (upcoming / pending quotes / latest reviews): cards are `rounded-xl shadow-sm p-5`, headers `text-sm font-semibold uppercase tracking-wide`, list items `rounded-lg border bg-card p-2.5 hover:bg-accent/40`; avatars use `bg-primary text-primary-foreground` fallback; "Ver todos" buttons use emerald-tinted ghost style.

- `src/components/admin/admin-dashboard.tsx`:
  - Removed shadcn `ChartContainer`/`ChartTooltip`/`ChartTooltipContent`/`ChartConfig` imports + `CardHeader`/`CardTitle`/`CardDescription` + `QUOTE_STATUS_LABELS`; added recharts `ResponsiveContainer` + `Tooltip as RTooltip`.
  - Replaced 8-card KpiCard grid with spec'd 5-card primary KPI row (Total de usuários with role breakdown subtext, Prestadores verificados, Serviços ativos, Receita total, Agendamentos totais) using shared `StatCard` (staggered).
  - Added a 4-card secondary `MiniStat` row (Orçamentos, Ticket médio, Prestadores em destaque, Taxa de conclusão) — compact, no animation, preserves the metrics that no longer fit the primary row.
  - Charts: switched all to direct recharts + `var(--primary)` palette with shared `CHART_TOOLTIP_STYLE`, dashed `var(--border)` grid, `var(--muted-foreground)` ticks. Donut (status) uses emerald family palette (`DONUT_COLORS`) with `innerRadius=60 outerRadius=90`, legend below with color dots + counts + percentages.
  - Removed unused `KpiCard` function; DashboardSkeleton updated to reflect new layout (5 primary + 4 secondary + 4 charts).
  - Recent activity: "Últimos agendamentos" (5) + "Top prestadores" (5) lists in `rounded-xl overflow-hidden shadow-sm` cards with border-b header bar + `text-xs` "Ver todos" emerald ghost button.
  - Added page header (title + subtitle) for hierarchy.

Stage Summary:

- All four files lint clean (`bun run lint` → 0 errors) and type-check clean (`bunx tsc --noEmit` reports no errors in `src/components/{client,provider,admin,shared}/`).

---

Task ID: Memory System
Agent: Buffy (AI coding assistant)
Task: Configurar sistema de memória persistente para retomar contexto entre threads.

Work Log:

- Criou `.agents/memory/` com 5 arquivos de memória persistente:
  - `MEMORY.md`: índice central com entradas para projeto, stack, user, decisions e topic files
  - `project-conventions.md`: stack completo, design system, estrutura de diretórios, regras de código, credenciais de teste
  - `tech-decisions.md`: 10 decisões arquiteturais com rationale (rota única, SQLite MVP, auth HMAC, WebSocket path "/", etc.)
  - `user-preferences.md`: perfil do desenvolvedor, preferências técnicas, estilo de comunicação
  - `session-history.md`: resumo de todas as 14 sessões/tasks anteriores + esta sessão

Stage Summary:

- Sistema de memória persistente configurado em `.agents/memory/`.
- Agora qualquer agente que iniciar uma nova thread pode ler `.agents/memory/MEMORY.md` para obter contexto completo do projeto.
- worklog.md mantido como registro detalhado de cada task.

---

Task ID: MEDIO-PRAZO-3A
Agent: Buffy (orchestrator — parecer + 3 ações recomendadas)
Task: Executar as 3 ações de médio prazo recomendadas no parecer técnico: (1) consolidar o meta-tooling com doc do "porquê" de cada família de guard, (2) revisar o useViewStore (performance/histórico), (3) ampliar a auditoria de segredos com classificação de severidade.

Work Log:

- **Ação 1 — Consolidação do meta-tooling**: criado `docs/GUARDS.md` catalogando as famílias de guard de `scripts/` (check-_, test-mutation-_, audit-_, validate-_, run-*) com o "porquê" de cada uma: encoding/cache (check-bun-mirror, check-crlf, check-blob-crlf, check-utf8, check-single-line-out-assign, normalize-crlf), doc-symmetry (check-encoding-guards-badge, check-hooks-symmetry, check-readme-anchors/toc/images, check-mutation-jobs, check-workflow-refs), segredos (audit-secret-leaks + check-secret-leaks-baseline), infra (check-tier1-fastpath, check-tier2-cache-restore, check-e2e-counts) e benchs (act-startup-bench, bench-setup-bun). Seção 7 documenta a correção da premissa do parecer: o guard semanal de segredos NÃO gateia só o total — gateia por assinatura (qualquer achado novo falha, incluindo todos os de severidade alta); o `--min-severity` é opt-out para quem quiser relaxar deliberadamente.
- **Ação 2 — Revisão do useViewStore** (`src/store/view.ts`): adicionado `HISTORY_LIMIT = 50` com cap FIFO do histórico (impede crescimento ilimitado em navegação longa) e dedupe de navegação repetida (navigate para a MESMA view + mesmos params é no-op, evitando entradas duplicadas no histórico e re-renders desnecessários). `sameViewAndParams` compara params shallowly (objetos/arrays nunca colidem — sem falso-positivo de dedupe). Testes adicionados em `src/store/__tests__/view.test.ts` (cap + dedupe, incluindo o math exato do off-by-one `client.view-19`). Sem mudança de API — nenhum call site tocado.
- **Ação 3 — Severidade na auditoria de segredos**:
  - `scripts/audit-secret-leaks.mjs`: patterns refatorados para objetos `{ id, severity, re }` (PRIVATE_KEY/PREFIX_TOKEN = alta, SECRET_ASSIGN = média); `scanHistory` usa `pat.re` com backward-compat (`pat.re ?? pat`); findings agora carregam `severity`; JSDoc `@returns` e HELP atualizados; campo `label` removido (redundante com `id`) após review.
  - `scripts/check-secret-leaks-baseline.mjs`: novos exports `SEVERITY_ORDER`, `severityRank` (severidade desconhecida → ALTA fail-closed — padrão novo no audit nunca escapa do gate) e `splitBySeverity(newFindings, minSeverity) → { blocking, warnings }`; flag `--min-severity` (default `baixa` = comportamento histórico: QUALQUER achado novo falha); `buildBaseline` persiste severidade; JSON output adiciona `minSeverity`/`blockingCount`/`blocking`; output texto distingue blocking vs warnings (warnings exit 0).
  - `.github/workflows/benchmark-weekly.yml`: job secret-leaks-audit RODA NO DEFAULT (sem `--min-severity alta` — o review provou que isso ENFRAQUECERIA o gate para achados médios; o default já falha em qualquer achado novo, incluindo todos os altos, que é exatamente o pedido do parecer). Comentário no YAML explica a correção da premissa.
  - `docs/security/secret-leaks-baseline.json` regenerado com `--update`: count 141 preservado, TODOS os findings agora carregam `severity`, sem drift de commit/line (diff severity-only).
  - Testes: `src/lib/__tests__/audit-secret-leaks.test.ts` e `check-secret-leaks-baseline.test.ts` ganharam asserções de severidade (incluindo `severityRank(undefined) = ALTA` fail-closed e `splitBySeverity` com `--min-severity alta`).

Stage Summary:

- **Ação 1**: `docs/GUARDS.md` criado — catálogo de famílias de guard com o "porquê" de cada uma (156 scripts explicados por família, não por script).
- **Ação 2**: `src/store/view.ts` — `HISTORY_LIMIT = 50` + dedupe de navegação; API intacta; testes novos verdes.
- **Ação 3**: auditoria com severidade (alta/média), guard com `--min-severity` fail-closed, baseline 141 findings com severidade, job semanal no default (gate mais forte) — premissa do parecer corrigida na doc.
- **Validação**: vitest 3 suítes (audit-secret-leaks 20 + check-secret-leaks-baseline 18 + view 15 = 53/53) ✓ · tsc --noEmit 0 erros ✓ · prettier 0 nos 8 arquivos ✓ · guards reais (hooks-symmetry, badge, workflow-refs, mutation-jobs) exit 0 ✓ · guard real default e --min-severity alta exit 0 ✓ · 3 rodadas de code review (pontos críticos aplicados: job revertido para default, fail-safe invertido p/ ALTA, backward-compat do patterns, cleanup do label).

---

Task ID: SEED-COUNT-LITERALS
Agent: Buffy (orchestrator — guard de refs órfãos de counts)
Task: Criar um guard (padrão check-e2e-counts) que varre TODO o repo — scripts/, docs/, .github/ — por literais 115/123 de counts de seed que não batam com a derivação real, evitando que um bump futuro deixe outro ref órfão como a âncora ficou.

Work Log:

- **Contexto**: a derivação real dá prod=128, dev=162 (bun scripts/seed-e2e-count.ts --json); o check-e2e-counts.mjs cobre SÓ os workflows + script local (SCAN_FILES explícito), mas não varre docs/ nem todos os scripts/ — o incidente histórico (doc dizia 128, âncora de teste esperava 123) deixou um literal órfão sem ninguém perceber. Audit: únicos refs numéricos "N checks" no repo são 128/162 (UTF-8 checks não têm número); prosa histórica do GUARDS.md ("doc dizia 128, âncora esperava 123") não tem "checks" adjacente.
- **Guard criado** (`scripts/check-seed-count-literals.mjs`): varre scripts/, docs/, .github/ recursivamente (TEXT_EXTS + SKIP_DIRS node_modules/.git/tool-results/etc) extraindo literais de count EM CONTEXTO e validando contra o conjunto {prod, dev} da derivação. REUSA runDerivation do check-e2e-counts.mjs (fonte única — um só ponto de derivação, nunca literal). Fail-closed: derivação indisponível → exit 1.
- **Padrões anti-falso-positivo** (3 rodadas de review): (1) principal `/(?:^|[^\w-])(\d{2,})\s+checks?\b/gi` — prefixo `[^\w-]` bloqueia "UTF-8 check" (hífen) e números colados; `\d{2,}` bloqueia single-digit ("run 3 checks", flag '1') e deixa teto aberto p/ counts de 4+ dígitos num bump futuro; (2)+(3) ternary ESPECÍFICO da matrix `'prod' && '(\d{2,})'` e `|| '(\d{2,})' }} checks` — ternaries genéricos (SKIP_PRISMA_GENERATE `&& '1'`) não casam. Mock data (CVC 123, endereços, rgba, senhas) e prosa histórica sem "checks" adjacente não são flags.
- **Self-scan tripwire evitado**: o guard varre scripts/ (inclui a si mesmo) — o header usa "N checks" genérico (não "128 checks") para um bump futuro não transformar a doc do guard num tripwire (nota documentada no header).
- **Testes**: `src/lib/__tests__/check-seed-count-literals.test.ts` (7 unit: extract + checkLiterals + fixtures de falsos positivos UTF-8/ternary '1'/mock/prosa) e `check-seed-count-literals-cli.test.ts` (6 CLI: fake repos com stub da derivação — docs stale exit 1, workflow stale exit 1, clean+noise exit 0, derivação falha/JSON inválido fail-closed, repo real exit 0). Bugs reais pegos no caminho: padrão ternary casando `'prod' && '1'` e asserção CLI errada ("divergente" vs "fora da derivação") + escape `\${{` em template literals (esbuild).
- **Wiring**: package.json `check:seed-count-literals`; pr-check.yml job novo `seed-count-literals-guard` (logo após e2e-counts-guard, com setup-bun + node script); docs/GUARDS.md seção 5 atualizada (check-e2e-counts + check-seed-count-literals).

Stage Summary:

- **Guard**: `scripts/check-seed-count-literals.mjs` — varre scripts/, docs/, .github/ por literais de count em contexto fora de {prod: 128, dev: 162}; exit 0 sincronizado / 1 com arquivo:linha + Ação (ou fail-closed se a derivação falhar).
- **Testes**: 13 novos (7 unit + 6 CLI) + regressão check-e2e-counts 8+8 → 29/29 verdes. tsc 0, prettier 0 (6 arquivos), CRLF 0, node --check OK.
- **Validação**: guard real exit 0 ("Counts de seed sincronizados em scripts, docs, .github (prod=128, dev=162)") · check-e2e-counts exit 0 (comentário novo do job não confunde os TARGET_PATTERNS) · check-workflow-refs exit 0 · mutation-jobs exit 0 · hooks-symmetry exit 0 · 3 rodadas de code review (fixes: \d{2,3}→\d{2,} teto aberto, self-scan tripwire do header, \${{ escapes).

---

Task ID: SINGLE-LINE-CONTRATO
Agent: Buffy (orchestrator — contrato do último ref de count não auditado)
Task: Conferir se o exemplo '128 checks' nos comentários do check-single-line-out-assign.sh (L11/L15) reflete o estado atual dos workflows e documentar o contrato — fechando o último ref de count não auditado.

Work Log:

- **Verificação**: a derivação real dá prod=128, dev=162; `validate-seed-guards-matrix-local.sh` (L143) tem a string exata `cell "Rodando prod E2E (128 checks)..."` — o exemplo do header é ATUAL (não drift). Extração direta via check-seed-count-literals.mjs: 4 literais 128 no arquivo (L11/L15/header novo/fim), zero violações contra {128, 162}.
- **Contrato documentado**: novo bloco 'CONTRATO DE COUNTS' no header do check-single-line-out-assign.sh — o exemplo "128 checks" é um ref VIVO (não ilustração genérica): o check-seed-count-literals.mjs varre TODO o repo e falha se qualquer literal "N checks" sair do conjunto válido {prod, dev}; num bump do seed, o exemplo DEVE ser atualizado junto com os workflows. O bloco de correção no fim do script usa "N checks" genérico de propósito (sem dígito, evita segundo ref a sincronizar).
- **Decisões do review**: referência grep-able (`grep -n 'Rodando prod E2E' scripts/validate-seed-guards-matrix-local.sh`) em vez de "(L143)" hardcoded (drift); parenthetical documentando que o snapshot "hoje" é deliberado — prosa sem "checks" adjacente não é flag (igual à prosa histórica do GUARDS.md).

Stage Summary:

- **Arquivo**: scripts/check-single-line-out-assign.sh — header com bloco CONTRATO DE COUNTS (ref vivo auditado, atualizar em bump).
- **Validação**: bash -n OK · guard real exit 0 (4×128, zero violações) · CRLF 0 · prettier 0 · review SHIP.
- **Estado**: todos os refs de count do repo agora são auditados — os workflows pelo check-e2e-counts, e TODO o repo (scripts/, docs/, .github/) pelo check-seed-count-literals (incluindo os exemplos de doc deste guard).

---

Stage: MUTATION-COORD-UPDATE
Agent: orchestrator
Task: Mutation test do contrato de atualização COORDENADA dos counts de seed — prova que o seed-e2e-count.test.ts pega o cenário exato do bug histórico (atualizar SÓ os comentários dos workflows 128→N sem tocar a âncora do teste).

Work Log:

- **Problema**: o incidente 123/128 (anchor stale) mostrou que a doc dos workflows e o anchor do teste precisam ser atualizados JUNTOS num bump — mas não havia prova end-to-end de que a atualização unilateral é pega. O mutation-seed-dev-e2e prova sensibilidade do E2E ao seed; faltava provar a sensibilidade do seed-e2e-count.test.ts à generalização da doc.
- **Script novo**: scripts/test-mutation-coord-update.sh (padrão seed-dev-e2e: backup + trap EXIT com cp, NUNCA git checkout) — CONTROLE (vitest real no seed-e2e-count.test.ts deve passar, exit 0) → mutação in-place dos 3 SCAN_FILES (pr-check.yml, seed-guards.yml, validate-seed-guards-matrix-local.sh): "128 checks"→"N checks" + ternary '128'→'N' (fail-fast se o padrão não existir) → MUTAÇÃO (deve FALHAR com "piso prod violado" — o piso de sites prod ≥ 8 quebra quando os sites somem da extração; o anchor de valor 128 NÃO muda, a derivação é do código). Exit 0 = mutação detectada; 1 = guard cego ou infra.
- **Por que o piso falha**: extractDocumentedCounts perde os sites de prod quando a doc vira "N checks" → o teste "piso de sites documentados por alvo" falha com arquivo:linha. A âncora de sanidade (prod=128) continua passando (vem do código) — prova que o contrato é coordenado, não duplicado.
- **Wiring**: package.json "test:mutation-coord-update" (após test:mutation-seed-dev-e2e) + job mutation-coord-update no seed-guards.yml (checkout + setup-bun + cache node_modules + bun install + run + summary). NÃO vai na matriz node-pura do master mutation-guards (roda vitest real, precisa de node_modules). Sem postgis: teste unitário, não toca banco.
- **Decisões do review**: wording do comentário do job corrigido — "em cópia" → "IN-PLACE no working tree (é assim que o teste lê os arquivos via process.cwd(); cópia em temp quebraria a premissa)".

Stage Summary:

- **Arquivos**: scripts/test-mutation-coord-update.sh (novo) · package.json (script test:mutation-coord-update) · .github/workflows/seed-guards.yml (job mutation-coord-update).
- **Validação**: mutation test real exit 0 (controle OK → mutação DETECTADA "piso prod violado" → 2 failed/20 passed no run mutado → SCAN_FILES restaurados) · bash -n OK · check-mutation-jobs exit 0 (16 mutation tests cobertos) · check-e2e-counts exit 0 (prod=128, dev=162) · prettier --ignore-unknown OK · CRLF 0 · 2 rodadas de review (SHIP).
- **Estado**: contrato de atualização coordenada enforced — um PR que atualize SÓ os comentários dos workflows falha o seed-e2e-count.test.ts no CI, obrigando doc + anchor a andarem juntos.

---

Stage: MUTATION-COORD-UPDATE-B (direção inversa)
Agent: orchestrator
Task: Estender o mutation test do contrato coordenado para a DIREÇÃO INVERSA — mutar SÓ a âncora do teste (.toBe(128)→.toBe(129)) sem tocar a doc dos workflows, provando o contrato nas 2 direções em um único script.

Work Log:

- **Cenário A (já existia)**: doc dos workflows 128→N (SCAN_FILES) → teste deve FALHAR com "piso prod violado" (sites de prod somem da extração).
- **Cenário B (novo)**: muta SÓ a âncora de sanidade do teste (`.toBe(128)` → `.toBe(129)` no seed-e2e-count.test.ts) com backup + sed in-place; verifica que a doc ficou INTACTA ("128 checks" presente — a falha tem que vir só da âncora, isolando a causa); roda o vitest real e exige FALHA com "anchor prod desatualizado" (a derivação real continua 128, o literal esperado virou 129). Fail-fast se o padrão `.toBe(128)` não existir (teste refatorado → mensagem clara em vez de guard cego).
- **Refactor do script**: restore dividido em restore_scan/restore_anchor/restore_all (backup keys scan-$i e anchor); helper expect_failure() compartilhado com o veredicto de 3 casos (exit 0 = guard cego; falhou mas asserção errada = infra; asserção certa = detectado); restore_scan explícito entre cenários (B precisa da doc íntegra); restore_anchor explícito antes das mensagens finais (claim verdadeiro no print; trap EXIT redundante e seguro).
- **Wiring**: seed-guards.yml — job mutation-coord-update renomeado para "contrato coordenado — doc↔anchor, 2 direções", comentário e Publish summary com 2 linhas (A e B). Script name inalterado → check-mutation-jobs continua cobrindo (16 tests).

Stage Summary:

- **Arquivos**: scripts/test-mutation-coord-update.sh (2 direções) · .github/workflows/seed-guards.yml (job + summary 2 direções).
- **Validação**: mutation test real exit 0 (controle OK → A detectado "piso prod violado" → B detectado "anchor prod desatualizado" → todos os arquivos restaurados; git status só mostra os 2 arquivos intencionais) · bash -n OK · prettier --ignore-unknown OK · CRLF 0 · check-mutation-jobs exit 0 (16 cobertos) · check-e2e-counts exit 0 · 2 rodadas de review (SHIP + nit de restore aplicado).
- **Estado**: contrato de atualização coordenada enforced nas 2 direções — doc sem anchor e anchor sem doc falham o seed-e2e-count.test.ts no CI, obrigando os dois lados a andarem juntos em qualquer bump.

---

Stage: MUTATION-COORD-2ELOS (guard estático + vitest)
Agent: orchestrator
Task: Fechar os DOIS elos da cadeia de validação no mesmo mutation test — rodar o guard estático check-e2e-counts.mjs contra a doc mutada e exigir que ele FALHE com exit 1, além do vitest.

Work Log:

- **Achado empírico ANTES do fix**: o guard estático NÃO falhava na doc generalizada 128→N — a extração (extractDocumentedCounts) perdia TODOS os sites de prod ("N checks" não casa `\d+ checks`), zero sites encontrados = zero violações no checkCounts → exit 0 ("✅ sincronizados") com a doc esvaziada. Blind spot REAL: só o piso do vitest pegava.
- **Guard estendido**: MIN_DOCUMENTED_SITES={prod:8, dev:6} (MESMO piso do seed-e2e-count.test.ts) + função pura checkSitePisos(documented, minimums) → main() agrega allDocumented nos SCAN_FILES e sai com exit 1 ("piso por alvo violado") quando um alvo fica abaixo do piso. Mensagem de ação clara (restaure o site ou ajuste o piso se a simplificação foi legítima/deliberada).
- **Mutation test com 2 elos**: GUARD_CMD=(node scripts/check-e2e-counts.mjs) + expect_failure reusado (mensagem CEGO generalizada para "a validação passou" — antes dizia "seed-e2e-count.test.ts passou", enganoso quando o GUARD é quem passa). CONTROLE roda vitest E guard (ambos exit 0); CENÁRIO A exige que AMBOS falhem (vitest 'piso prod violado' + guard 'piso por alvo violado'); CENÁRIO B exige que o guard PASSE com a doc íntegra (exit 0) — isolando a causa da falha na âncora e provando que o guard não quebrou (falha de A vem SÓ da doc mutada).
- **Wiring**: seed-guards.yml job mutation-coord-update — comentário + step name atualizados ("2 direções, 2 elos"). Script name inalterado → check-mutation-jobs continua cobrindo (16).
- **Fixtures do checkSitePisos**: os 2 testes que falharam primeiro passavam só sites de prod — o checkSitePisos valida AMBOS os alvos (alvo ausente = found 0 = violação); fixtures corrigidas com dev no piso para isolar a violação de prod.

Stage Summary:

- **Arquivos**: scripts/check-e2e-counts.mjs (piso + header) · src/lib/**tests**/check-e2e-counts.test.ts (+4 testes) · scripts/test-mutation-coord-update.sh (2 elos) · .github/workflows/seed-guards.yml (comentário).
- **Validação**: mutation test exit 0 ×3 (controle vitest+guard pass → A: ambos falham com seus pisos → B: vitest falha 'anchor prod desatualizado' + guard exit 0 → arquivos restaurados; git status só com os 4 arquivos intencionais) · vitest 37 passados (2 suites) · guard real exit 0 · node --check OK · prettier --ignore-unknown OK · CRLF 0 nos 4 arquivos · check-mutation-jobs exit 0 (16 cobertos) · 3 rodadas de review (SHIP).
- **Estado**: os 2 elos da cadeia agora concordam — um PR que generaliza a doc dos workflows falha o guard estático (piso) E o teste de integração (piso) no mesmo mutation test; a âncora mutada falha o vitest com o guard passando (causa isolada).

---

Stage: MUTATION-COORD-MEASURE (overhead por PR)
Agent: orchestrator
Task: Medir o tempo real do job mutation-coord-update (payload) e documentar o overhead por PR na seção de mutation tests do docs/GUARDS.md.

Work Log:

- **Limitação honesta**: gh NÃO está autenticado neste worktree ("auth fantasma" já documentado; repo privado → API sem token dá 404). Timings reais do GitHub Actions não puderam ser buscados — o padrão do repo (README) é act como proxy CI com caveat explícito. O job roda em ubuntu-latest (NÃO usa a imagem ubuntu-bun — essa é só do tier-1 local/act), então não há pull de imagem custom no CI deste job.
- **Medições locais (Windows host)**: payload do mutation test = **21s** total (3 vitest: controle 5.0s + A 3.4s + B 3.4s + 3 guard runs ~0.3-0.4s cada) · bun install warm = 7s · guard isolado ~320-408ms.
- **Proxy act (imagem catthehacker em cache)**: checkout 24.6s* · setup-bun composite 36.6s* (cache emulado 26.0s) · cache node_modules 19.0s* · bun install 5m58s* (frio, emulado) · **payload mutation test 17.1s** · summary 0.8s. O act travou no "Post Cache node_modules" (tar do cache emulado — overhead pós-step que não existe no CI real). * = overhead de emulação.
- **Número confiável**: payload do mutation test **~17-21s por PR** (17.1s container / 21s local) — os demais componentes (checkout/setup-bun/cache/install) são os mesmos de qualquer job com bun install (~1-2s cada no CI real).
- **Doc**: docs/GUARDS.md seção 3 (Mutation tests) ganhou sub-bloco "Overhead por PR do job mutation-coord-update (medido 08/2026)" com tabela Local × act × CI real, caveats de emulação (marcados * e nota ¹ do setup-bun tier-2) e o aviso de auth fantasma.

Stage Summary:

- **Arquivo**: docs/GUARDS.md (sub-bloco de overhead na seção 3).
- **Validação**: prettier --ignore-unknown OK · CRLF 0 · check-readme-anchors docs/GUARDS.md exit 0 (15 headings, forward) · check-readme-toc exit 0 · review SHIP.
- **Estado**: overhead por PR documentado com evidência (payload 17-21s) e sem overclaim — timings reais do GH Actions pendentes de gh auth (comando de medição documentado no padrão do repo).

---

Stage: BARREL-LINT-PRE-LINTSTAGED
Agent: orchestrator
Task: Mover o barrel-lint (guard de headers Usage/Exit codes nas 50 primeiras linhas) para ANTES do lint-staged no pre-commit — a violação de header pega com arquivo:linha cedo, sem o prettier já ter reformatado o working tree.

Work Log:

- **Problema**: no commit anterior o barrel-lint travou o commit com 3 scripts sem header válido — mas rodava DEPOIS do lint-staged (o prettier já tinha reformatado o working tree quando o erro aparecia). Pedido: reordenar para falhar cedo.
- **Mudança**: .husky/pre-commit — `bun run barrel-lint` movido de depois para ANTES do `bun x lint-staged` (ordem: staged bun-guard → staged mutation-jobs → run-encoding-guards → barrel-lint → lint-staged → direct-rtl-import → typecheck → snapshot). Comentário atualizado com o rationale.
- **Prova imediata do valor**: o barrel-lint reordenado pegou de cara uma violação REAL pré-existente — scripts/test-mutation-coord-update.sh com o bloco Usage/Exit codes além da linha 50 (a prosa dos 2 elos empurrou o bloco para baixo; mesma classe de erro que travou o commit anterior). Corrigido movendo o bloco para logo após o título (conteúdo idêntico, posição correta — padrão dos outros scripts corrigidos).
- **Sem impacto de simetria**: o check-hooks-symmetry é order-independent (presença, não ordem) — tabela README continua batendo (16 compartilhados + reverse OK).

Stage Summary:

- **Arquivos**: .husky/pre-commit (reordenação) · scripts/test-mutation-coord-update.sh (header Usage/Exit codes movido para o topo).
- **Validação**: bash -n OK (ambos) · bun run barrel-lint exit 0 (antes exit 3 com a violação do coord-update — o reorder provou o valor imediatamente) · check-hooks-symmetry exit 0 · CRLF 0 · prettier --ignore-unknown OK · mutation test exit 0 (header movido não quebrou nada; arquivos restaurados) · review SHIP.
- **Estado**: violação de header agora falha o pre-commit ANTES do lint-staged, com arquivo:linha — o dev corrige sobre o working tree limpo, não sobre arquivos já formatados pelo prettier.

## MUTATION-COORD-CENARIO-C — triângulo doc↔anchor↔código fechado (08/2026)

- scripts/test-mutation-coord-update.sh: +CENÁRIO C — muta a DERIVAÇÃO de verdade
  (sed comenta a 1ª asserção `expect(` real do scripts/test-seed-prod-e2e.ts via
  `0,/^[[:space:]]*expect(/s//\/\/ MUTATION-C: expect(/` → prod cai 128→127). Doc
  dos workflows E âncora do teste verificados INTACTOS (isolamento) → vitest deve
  falhar com "cada count documentado bate" E guard estático com "divergente(s)
  entre workflows e derivação" (2 elos). restore_derivation + trap EXIT.
- Header/pipeline/exit-codes/banner atualizados para o triângulo de 3 direções.
- .github/workflows/seed-guards.yml: job mutation-coord-update renomeado para
  "doc↔anchor↔código, 3 direções"; comentário, step e summary com a linha C.
- Validação: mutation test exit 0 (A piso 2 elos, B sanidade guard passa, C
  derivação 2 elos), vitest 37/37, barrel-lint 0, prettier 0, CRLF 0, review SHIP.

## MUTATION-COORD-CENARIO-D — independência do teste vs guard (08/2026)

- scripts/test-mutation-coord-update.sh: +CENÁRIO D (4º) — prova que o vitest
  do seed-e2e-count NÃO depende do guard estático: muta a doc (128→N, como em
  A) E neutraliza o piso do guard (GUARD_PISO_PATTERN { prod: 8, dev: 6 } →
  { prod: 0, dev: 6 } via sed no check-e2e-counts.mjs). Com piso zero e sem
  sites de prod para divergir, o guard fica CEGO (exit 0, verificado) mas o
  vitest CONTINUA falhando ("piso prod violado") — o piso do TESTE é próprio
  (hardcoded ≥ 8 no seed-e2e-count.test.ts), não herdado do guard.
- restore_guard + trap EXIT; header/pipeline/banner/result para 4 cenários.
- .github/workflows/seed-guards.yml: job renomeado "4 cenários"; comentário,
  step e summary com a linha D (independência).
- Validação: mutation test exit 0 ×2 (A piso 2 elos, B sanidade guard passa,
  C derivação 2 elos, D independência guard cego), vitest 37/37, barrel-lint 0,
  prettier 0, CRLF 0, guard real exit 0 com piso restaurado, review SHIP ×2.

## MUTATION-COORD-CENARIO-E — contrato estendido ao count de DEV (08/2026)

- scripts/test-mutation-coord-update.sh: +CENÁRIO E (5º) — o contrato de
  atualização coordenada agora vale para AMBOS os counts: além de prod (128,
  cenário A), o DEV (162) também é auditado. MUTATION_SED_DEV ("162 checks"
  → "N checks" + ternary '162' → 'N') ataca SÓ os sites de dev (5
  literais + o ternary dev do seed-guards.yml L211); prod ("128 checks") e a
  âncora dev (.toBe(162)) ficam INTACTAS (isolamento verificado) → vitest
  falha com "piso dev violado" (hardcoded ≥ 6 no seed-e2e-count.test.ts) E
  guard falha com "piso por alvo violado" (dev 0 < 6) — os 2 elos no par.
- Header/pipeline/banner/result para 5 cenários; fail-fast "162 checks".
- .github/workflows/seed-guards.yml: bullet (E), job "5 cenários", step,
  summary com a linha E (contrato p/ prod E dev).
- Validação: mutation test exit 0 ×2 (5 cenários, pós-prettier), vitest 37/37,
  barrel-lint 0, prettier 0, CRLF 0, guard real exit 0, 162 restaurado,
  review SHIP ×2. Prosa "162 checks" no comentário (E) confirmada INERTE
  (nenhum TARGET_PATTERN extrai; guard/vitest exit 0).
- MUTATION-COORD-ACT-CI (08/2026): rodado o job mutation-coord-update via act com a
  imagem ubuntu-bun:1.3.14. O run REVELOU um bug real de portabilidade: no container
  (GITHUB_ACTIONS=true) o reporter padrão do vitest vira o github-actions, que
  URL-encodea o TITLE do ::error (espaços → %20); o EXPECTED_FAILURE_DERIVATION
  ('cada count documentado bate') é o NOME do teste (no title), então o grep do
  cenário C não achava a asserção (cenários A/B/D/E falham por mensagens no body,
  não-encoded). FIX: VITEST_CMD ganhou --reporter=basic (determinístico em qualquer
  ambiente — testado com decoy: nome literal 3x, 0 %20, mesmo com GITHUB_ACTIONS).
- Validação pós-fix: mutation test exit 0 local com GITHUB_ACTIONS=true (5 cenários,
  arquivos restaurados) E no container via act (log '✅ Mutation test passou',
  summary com os 5 cenários ✅, step 'Success [4m37.56s]'; o job foi morto pelo
  timeout de 900s SÓ no Post Cache emulado — tar do bind mount, pós-step, não existe
  no CI real). setup-bun atingiu tier-1 fast path ('Bun já instalado no runner').
- GUARDS.md (seção 3): tabela de overhead atualizada do estado stale ('2 direções',
  3 vitest runs, 17.1s) para o real de 5 cenários: local medido 51s, act/ubuntu-bun
  4m37.6s (overhead de emulação /mnt/c documentado), CI real ~35-45s (estimado, a
  medir com gh). Prettier reflow fundiu uma linha da tabela — corrigido e revalidado
  (8 linhas × 6 campos, prettier 0, CRLF 0, anchors/toc/images 0). Review SHIP ×4.
- README-MUTATION-COORD-CI (08/2026): pedido de medir o tempo REAL do job
  mutation-coord-update no CI via gh run view. MEDIÇÃO BLOQUEADA e confirmada:
  gh sem auth (hosts.yml ausente — auth fantasma), repo PRIVADO (API sem auth →
  404), nenhum GH/GITHUB_TOKEN em .env/env. Premissa do pedido ('3 execuções de
  vitest: controle + 2 cenários') estava OBSOLETA — o job roda 5 cenários (A–E)
  = 6 runs de vitest + 6 do guard (corrigido na doc). Entregue a parte
  documentável: bloco novo no README (seção Git Hooks) 'Overhead do job
  mutation-coord-update' com local 51s (medido), act+ubuntu-bun 4m37.6s (step),
  CI real '~35-45s (est.)¹ pendente de medição real' + one-liner gh para quando
  autenticado + comparação ~16× vs 16 fast gates (3.2s). Prettier 0, CRLF 0,
  anchors/toc/images 0, hooks-symmetry 0, badge 0. Review SHIP ×2.
- AUTH-FANTASMA-RESOLVIDO (08/2026): `gh auth login` completado NO ambiente do
  worktree com autorização humana (device flow: código 6125-781F em
  https://github.com/login/device → hosts.yml GRAVADO em %AppData%\GitHub CLI).
  Confirmado: conta severinno, scopes 'gist','read:org','repo', gh api exit 0.
  O bug documentado em Bugs conhecidos era FALTA de interação humana, não falha
  do gh — a entrada do README foi marcada RESOLVIDO com a evidência.
- MEDICAO-CI-MUTATION-COORD (08/2026): o one-liner de medição (gh run view
  --jq) foi VALIDADO de ponta a ponta num run real (bench-setup-bun 30765242263:
  timings reais de steps capturados). MAS mutation-coord-update NUNCA rodou no
  CI real: seed-guards.yml não existe na branch default (release/v0.4.0 — só
  neste branch do worktree, nunca mergeado) → GitHub API 404, zero runs. A
  estimativa ~35-45s da tabela de overhead NÃO pôde ser substituída por dado
  real — o bloqueio mudou de 'gh sem auth' para 'workflow não mergeado'. Docs
  atualizadas: README (bloco mutation tests + footnote ¹ + Bugs conhecidos) e
  GUARDS.md seção 3 com o estado verdadeiro. Prettier 0, CRLF 0, anchors/toc/
  images 0, hooks-symmetry 0, badge 0, zero ocorrências de 'gh sem auth'.
- MUTATION-COORD-TIMING-JOB (08/2026): re-medição SEMANAL do tempo real do step
  'Run mutation test (contrato coordenado)' do seed-guards.yml SEM depender de
  auth local — o gh do runner usa o GITHUB_TOKEN do próprio Actions. Novo
  scripts/measure-mutation-timing.mjs (node puro): extrai o step do payload da
  jobs API pelos MARKERS de contrato (JOB/STEP_NAME_MARKER = nomes reais do
  seed-guards.yml), modos --jobs-file (teste/fixtures) e --run (spawn gh api
  repos/X/actions/runs/<id>/jobs --per-page 100, retry 5×10s inclusive em erro
  transiente, sleep via Atomics.wait), exit 0 achado / 1 infra fail-closed /
  2 drift de contrato ('não achado' não é 'limpo'). Novo job mutation-coord-
  timing no benchmark-weekly.yml: needs: seed-guards + if: always() (mede
  também quando o seed-guards falhou — timeout é o alvo), permissions actions:
  read, GH_TOKEN: ${{ github.token }}, --run github.run_id (jobs do reusable
  workflow aparecem no run do chamador), artifact + Summary (if: always()).
  Testes: 16 unit (extract/compute/CLI real incl. infra exit 1 e drift exit 2)
  - 13 snapshot de workflow (YAML, contrato needs/if/permissions/GH_TOKEN,
    markers vs seed-guards.yml com busca por sufixo exato — o arquivo tem DOIS
    jobs 'Mutation Test', seed-dev-e2e vem antes; refs vs check-workflow-refs).
    Review: 1 blocking (markers .find pega o job errado) + 1 médio (--paginate
    quebra com >30 jobs: gh aplica jq por página e concatena objetos → JSON
    inválido; trocado por --per-page 100) + barrel-lint (header exigia 'Usage:'
    literal, usava 'Uso:') — todos corrigidos. 29/29 testes, prettier 0, barrel-
    lint 0, refs 0, anchors/toc/images/hooks-symmetry/badge 0, CRLF 0, .snap
    criado (benchmark-weekly-mutation-timing-workflow.test.ts.snap — incluir no
    commit). Review final SHIP ×2.
- MUTATION-COORD-TIMING-BUDGET (08/2026): GATE de budget de payload do step
  'Run mutation test (contrato coordenado)' — falha se ultrapassar 180s (3
  min), prevenindo regressão de overhead do contrato coordenado ANTES do
  merge. Timing NATIVO do Actions (started_at/completed_at da jobs API — o
  mesmo da UI), medido pelo measure-mutation-timing.mjs com a nova flag
  --max SECS (relatório ganha budgetSecs + exceeded; exit 1 fail-closed) e
  --warn-only (::warning:: + exit 0 — alerta não-bloqueante p/ dispatch).
  Gate: novo job mutation-coord-timing-guard no pr-check.yml (needs:
  seed-guards + if: always(), permissions actions: read, GH_TOKEN,
  --max 180, artifact + Summary com linha EXCEDIDO) + o semanal
  mutation-coord-timing (benchmark-weekly.yml) agora também passa --max 180
  (re-gateia semanalmente). Testes: +6 unit de budget (dentro/fora/warn-only/
  uso inválido — 22 no total) + novo pr-check-mutation-timing-guard-workflow.
  test.ts (snapshot: contrato needs/if/permissions/--max 180/not --warn-only)
  - weekly atualizado (asserção --max 180) + snapshots regenerados (-u).
    README: parágrafo 'Budget de payload (gate 180s)' no bloco de overhead —
    fonte da verdade com os 4 lugares coordenados de tuning (2 jobs + 2 testes)
    e o racional de ~4× headroom (~35-45s esperado). Corrigidos no review: 2
    testes (--help com strings novas de exit code; parse do JSON do budget —
    regex de chaves, o merge stdout+stderr poluía o slice) + ::error:: no gate
    (convenção do repo) + doc gap do README (a nota TUINING referenciava o
    README como fonte da verdade sem o bloco existir). 45/45 testes (22+13+10),
    prettier 0, barrel-lint 0, refs 0, guards de docs 0, CRLF 0, 2 .snap
    presentes. Review SHIP ×2.

## Overhead consolidado de TODOS os gates por PR (README, 08/2026)

Extensão da seção Git Hooks/CI do README com o custo real de TODOS os
gates pesados do pr-check.yml + e2e-cache.yml, na metodologia do repo
(mediana 3 runs warm local + act com ubuntu-bun --pull=false):

- Tabela de mutation tests atualizada: master agora 10 sub-tests (era 9 —
  o cenário workflow-refs já existia), local ≈40.75s (39.5–42.9, mediana
  3 warm) vs 15.8s antigo de 5 sub-tests, step act ≈9.1s (era 4.4s);
  footnote ² com a re-medição completa (actionlint 3.61s, utf8-check
  7.46s no mesmo atmo).
- NOVA tabela consolidada 'Custo de TODOS os gates por PR': 16 fast
  guards 3.2s · utf8-check 0.92s/7.46s · actionlint 0.51s/3.61s ·
  mutation-guards 40.75s/9.1s · mutation-coord-update 51s/4m37.6s
  (CI ~35-45s est.) · e2e-cache 4m6s só build (1 run, condicional via
  paths no trigger, timeout 15min). Pior caso node-puro ≈1m32s vs 3.2s
  dos fast guards — por design (cada mutation roda o guard REAL).
- Honestidade nos nits do review: checkout@v4 0.03s quente/32.2s frio
  (footnote * separa os dois runs do act), e2e-cache marcado como 1 run
  (não estabilizado), footnotes ²/¹/³ desambiguadas entre as 3 tabelas.
  Validação: prettier 0, CRLF 0, 7 guards de docs 0 (anchors/toc/images/
  hooks-symmetry/badge/reverse-baseline/seed-count-literals). Review SHIP ×2.

## Guard de default branch — workflows de medição mergeados? (08/2026)

Previne o falso estado 'pendente de medição' que ocorreu neste thread: o
gh run list --workflow=seed-guards.yml responde '404: workflow not found
on the default branch' quando o workflow NÃO foi mergeado — o bloqueio
real é o MERGE, não a falta de run. Novo guard scripts/check-default-
branch-workflows.mjs (node-puro) valida via gh api que os workflows de
medição (default: seed-guards.yml) EXISTEM na branch default do repo.

- Exit codes fail-closed: 0 = todos presentes; 1 = AUSENTE (GATE com
  ::error:: citando MERGE + o 404 — causa raiz explícita); 2 = infra
  (gh indisponível/API) ou uso. Flags: --repo (default GITHUB_REPOSITORY),
  --workflow (repetível), --default-branch (override — evita chamada gh),
  --fixture-dir (modo TESTE determinístico, classe do --jobs-file),
  --json, --warn-only (::warning:: + exit 0). Exports puros testados:
  extractDefaultBranch, classifyExistenceCheck (404=ausente apenas porque
  o caller resolve a branch primeiro — assunção documentada), e a const
  DEFAULT_MEASUREMENT_WORKFLOWS.
- Job semanal default-branch-workflow-guard no benchmark-weekly.yml:
  permissions contents: read, GH_TOKEN github.token, --repo
  github.repository --workflow seed-guards.yml, artifact + Summary
  (if: always(), linha 'BLOQUEIO REAL'). Comentário no job explica por
  que NÃO passa --default-branch (schedule tem github.event.repository
  VAZIO — resolve via gh api, único caminho confiável no cron).
- Testes 38/38: 17 unit (funções puras + CLI com fixtures: presente→0,
  ausente→1 com MERGE/404, warn-only→0, multi-workflow, infra→2,
  sem args→2, --help, --json, override de branch) + 8 do workflow
  (snapshot + contrato GH_TOKEN/invocação/artifact/summary + asserção do
  header com normalização que remove marcadores '//' — o /\s+/ sozinho
  deixava '//' literal no meio da frase) + 13 de regressão do timing.
- Review: 2 rodadas SHIP (nits aplicados: comentário do schedule no job,
  assunção 404 no docstring; 1 teste quebrado corrigido com strip de
  '// ' por linha antes do toContain). Validação: vitest 38/38, prettier
  0, barrel-lint 0, check-workflow-refs 0, node --check OK, CRLF 0,
  guards de docs 0, .snap criado.

## Device flow humano documentado (README, seção medição do setup-bun, 08/2026)

Passo a passo EXATO do gh auth device flow na seção 'Fluxo completo
(auth → push → medição → cleanup)' do setup-bun — para o 'auth fantasma'
não voltar em ambientes futuros: blockquote com 4 passos (1. gh auth
login --web imprime o código de um só uso; 2. abrir github.com/login/
device e digitar o CÓDIGO exibido pelo CLI (não o token); 3. autorizar
com scopes repo+workflow; 4. hosts.yml gravado + auth status completa) + ⚠️
alerta: o código EXPIRA em ~15 min — sem autorização humana o processo
fica pendurado, o token nunca é gravado (sintoma do auth fantasma) e é
preciso reiniciar com gh auth login --web (código NOVO). Menciona o
preflight --dry-run (exit 4 = API bloqueada) e linka #bugs-conhecidos.
Passo 1 do bash atualizado para gh auth login --web (era gh auth login).
Review SHIP com 1 nit de convenção (⚠️ dentro do bold: '> **⚠️ ...' —
padrão do repo) aplicado. Validação: prettier 0, CRLF 0, 7 guards de
docs 0.

## Mutation test do gate de budget 180s (timing-budget, 08/2026)

Prova o GATE de overhead do contrato coordenado end-to-end no CI (não só
no teste unitário): scripts/test-mutation-timing-budget.sh gera fixtures
da jobs API em mktemp com os MARKERS reais do seed-guards.yml e valida 3
direções do measure-mutation-timing.mjs --max 180: CONTROLE 35s → exit 0

- exceeded:false (gate não é over-eager); MUTAÇÃO 300s → exit 1 +
  'budget de payload EXCEDIDO' + exceeded:true (regressão DETECTADA — o
  contrato coordenado ficou lento e ninguém percebeu); WARN-ONLY mesma
  mutação → exit 0 + ::warning:: (alerta sem mascarar a detecção). Sem
  tocar arquivos reais (fixtures em mktemp, trap EXIT). Wire no master:
  SUBTESTS ganhou a entrada timing-budget (11 no total) + comentário da
  matriz + mensagem final; check-mutation-jobs cobre transitivamente via
  matriz do master (JOBS:0). README: 10→11 sub-tests em 4 pontos (lista
  L739, tabela L751, footnote ² — reescrita sem run-on: medição com os 10
  originais + nota do 11º adicionado depois, 'fixtures JSON em mktemp' em
  vez do impreciso 'git reais' —, tabela consolidada L837). Nits do review
  aplicados: header do master 10→11; diagnóstico de DRIFT DE CONTRATO
  (exit 2 — markers não casam) separado de GUARD CEGA no caminho de falha.
  Validação: bash -n OK, granular exit 0, master --scenario exit 0, --list
  = 11, prettier 0, CRLF 0, guards de docs 0, refs 0. Review SHIP ×2.

### [08/2026] Gate de budget em DUAS FAIXAS (--max 240 duro + --warn 180 soft)

Extensão do measure-mutation-timing.mjs: faixa SOFT (warn < d <= max) emite
::warning:: + exit 0 (zone 'warn' — ruído de runner tolerado SEM perder o
gate); faixa DURO (d > max) continua ::error:: + exit 1 (zone 'fail'). O
relatório ganha warnSecs/zone/warned. Validações: --warn exige --max; --warn
deve ser < --max; usage() documenta 'budget duro excedido'. Coordenação:
pr-check.yml + benchmark-weekly.yml passam --max 240 --warn 180; Summary dos
2 jobs agora imprime zone (fail/warn/ok) + duração com ambos os budgets;
comentário TUINING DO BUDGET reescrito (240/180, cinco lugares). Mutation
test test-mutation-timing-budget.sh: 4 direções (CONTROLE 35s→zone ok, FAIXA
SOFT 200s→exit 0 + ::warning:: + zone warn, MUTAÇÃO 300s→exit 1 + zone fail,
WARN-ONLY→exit 0); BUDGET_MAX=240/BUDGET_WARN=180. README: parágrafo Budget
reescrito com as duas faixas + limites exatos (soft: warn < d <= max — d==max
é warn; dura: d > max) + cinco lugares coordenados (inclui constantes do
mutation test). Nome do job/step alinhado para 'budget 240/180s'. Validação:
bash -n OK, mutation granular exit 0 (4 direções), vitest 51/51 (unit 23 + 2
workflow 28) com snapshots regenerados, prettier 0, CRLF 0, guards de docs 0,
refs 0, scan de stale 180s limpo. Review SHIP ×2 (nits aplicados: asserção
--help 'budget duro excedido', 5º lugar coordenado no README, ordenação do
nome, precisão do limite).

## [2026-08-05] Medição do budget do mutation test VIA ACT (--act-log) — PRs sem seed-guards na default

Adicionado ao measure-mutation-timing.mjs o modo `--act-log FILE` + `--act-exit CODE`:
re-execução do job mutation-coord-update via act (imagem ubuntu-bun) e extração da
duração do step da linha 'Success - Main Run mutation test ... [X.XXs]' (reusa
extractDurationFromLine do check-setup-bun-common.mjs — mesma técnica do tier1).
Cobre PRs que ainda NÃO têm o seed-guards.yml na branch default (reusable não roda
no CI real → jobs API não mede). --act-exit != 0 sem evidência = act morreu antes do
step (infra, exit 1 com diagnóstico); exit 0 sem evidência = drift (exit 2). O MESMO
gate de duas faixas (--max 240 --warn 180).

Novo job mutation-coord-timing-act-guard no pr-check.yml: path filter
origin/main...HEAD, act v0.2.89 pinado, --eventpath mínimo ({workflow_call:{}}) para
o seed-guards.yml workflow_call-only, -P imagem ubuntu-bun, ACT_EXIT → GITHUB_OUTPUT,
guard com --act-log --max 240 --warn 180 --act-exit. permissions packages: read.

Refactor do review: bloco de gate duplicado (~30 linhas) extraído para o helper
compartilhado applyBudgetGate(report, args, stepName, viaSuffix) — fonte única da
verdade das zonas (ok/warn/fail) entre os modos jobs-file/run e act-log; validação
--act-exit exige --act-log (simétrica ao --warn exige --max) + teste unitário.

Testes: pr-check-mutation-timing-act-workflow.test.ts (novo, snapshot + contrato);
measure-mutation-timing.test.ts ganhou seção 1b extractMutationStepFromActLog + 5b
CLI --act-log + validação --act-exit; mutation test timing-budget agora com 7 direções
(+act-log 300s fail, 35s ok, infra exit 1). README: 'sete lugares coordenados'.

Fix barrel-lint: headers do measure-mutation-timing.mjs e test-mutation-guards.sh
tiveram Usage:/Exit codes: movidos para as 50 primeiras linhas (a doc do --act-log e
a entrada timing-budget na matriz os tinham empurrado para fora).

Validação: bash -n OK, mutation granular exit 0 (7 direções), vitest 76/76 (unit +
3 workflow tests), prettier 0, barrel-lint 0, CRLF 0, 6 guards de docs 0, refs 0.
Review SHIP ×2 (nits aplicados: helper applyBudgetGate, validação --act-exit, teste
do nit, headers < 50 linhas).

## [2026-08-05] Baseline auto-atualizado do budget (--publish-baseline via gh variable set)

Estendido o measure-mutation-timing.mjs para PUBLICAR o tempo real medido como
repository variable quando o budget passa — o gate consulta a variável em vez do
literal 180, tolerando variação de runner.

Script: flags --publish-baseline NAME (regex ^[A-Z][A-Z0-9_]_$; rejeitado com
--act-log) + --baseline-margin FRAC (default 0.2; exige --publish-baseline).
computeBaselineValue(duration, margin, max) = ceil(d_(1+margin)), min 1s, clamp
para SEMPRE < max (faixa warn nunca vira vazia). maybePublishBaseline spawna
'gh variable set NAME <valor> --repo <repo>' (GH_TOKEN do env); FAIL-SOFT
(::warning:: + published:false, exit inalterado); dry-run para testes via env
MEASURE_MUTATION_TIMING_DRY_PUBLISH=1 (published:'dry-run'). Trigger dentro do
applyBudgetGate (após zone) — publica SÓ quando zone != fail (run lento não
ratcheta o baseline). Report ganha baseline: {name, value, published}.

Workflows: benchmark-weekly mutation-coord-timing agora com permissions actions:
WRITE (gh variable set), --warn ${{ vars.MUTATION_TIMING_BASELINE || '180' }} +
--publish-baseline MUTATION_TIMING_BASELINE --baseline-margin 0.2. pr-check
(mutation-coord-timing-guard + mutation-coord-timing-act-guard) renomeados para
'budget 240/baseline', consultam a var (fallback 180) e NÃO publicam (PR não
muta repo state).

Testes: unit (computeBaselineValue pura com clamp, validações de parseArgs,
CLI dry-run: 35s→baseline 42 published dry-run; 300s fail→sem baseline+exit 1);
3 workflow tests (asserções --warn baseline var + publish no semanal + sem
publish no PR + nomes); mutation test timing-budget agora com 9 direções
(+PUBLISH: 35s→42 publicado, 300s→não publica). Snapshots regenerados (nomes de
jobs mudaram). README reescrito (baseline var, semanal publica, tuning = max +
margem; baseline em si auto-atualiza).

Review 8 rodadas (SHIP): bug crítico da validação de --baseline-margin (presença
explícita via null default + ?? 0.2) corrigido; nits aplicados (param morto,
Summary title, header < 50 linhas para barrel-lint, NOVE direções, typo,
convenção uppercase, refs stale).

Validação: bash -n OK, mutation granular exit 0 (9 direções), vitest 85/85 (4
arquivos, snapshots regenerados), prettier 0, barrel-lint 0, CRLF 0, 6 guards de
docs 0, workflow-refs 0, stale-scan limpo (só menções intencionais de fixtures).

Round 9 (fechamento do baseline auto-atualizado): aplicados os 2 últimos nits do
review — (1) validação `--publish-baseline exige --max` no parseArgs (era no-op
silencioso sem --max: maybePublishBaseline só dispara dentro do applyBudgetGate,
que retorna cedo quando max é null) + teste unitário novo (exit 2 com a mensagem
exata); (2) Summary do semanal agora exibe baseline.published. Review 9 SHIP com
1 nit de paridade de doc (header do --publish-baseline agora diz 'Exige --max',
paridade com o --warn) + nota de verificação (o 4º arquivo de teste,
pr-check-mutation-timing-act-workflow.test.ts, estava fora da bateria por nome
errado — rodado: 86/86). Prettier --write aplicado em 2 arquivos (reformat
neutro), prettier --check 0 em 9 arquivos, vitest pós-reformat 86/86, CRLF 0,
barrel 0, guards de docs 0, workflow-refs 0.
