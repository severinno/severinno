# Auditoria — Camada 1: Frontend (React 19 + Next.js 16)

**Data:** 2026-08-18
**Auditor:** Buffy (Codebuff)
**Status Geral:** 🟢 Saudável (Enterprise-grade SPA with SSR)

---

## Resumo Executivo

O frontend é **bem projetado** com App Router, SSR Streaming, code-splitting via `dynamic()`, Zustand para state management, React Query para server-state, 48 componentes shadcn/ui, e PWA completa. Identificadas **0 vulnerabilidades P0**, **0 vulnerabilidades P1** e **4 melhorias P2/P3**.

---

## Itens Verificados

### 1. App Router

- ✅ **Root layout**: Geist fonts, Providers, `suppressHydrationWarning`
- ✅ **Home page**: SSR Streaming com `Suspense` + `dynamic()` para AppShell
- ✅ **Loading states**: `loading.tsx`, `loading-shell.tsx`, `loading-global.tsx`, `loading-base.tsx`
- ✅ **Error boundaries**: `error.tsx`, `global-error.tsx`
- ✅ **Not found**: `not-found.tsx`
- ✅ **SEO metadata**: title, description, keywords, OpenGraph, Twitter card
- ✅ **PWA**: manifest, icons (152, 167, 180), apple-mobile-web-app-capable

### 2. SSR Streaming

- ✅ **Server Component**: `page.tsx` é Server Component com Suspense
- ✅ **Dynamic import**: AppShell carregado via `dynamic()` com SSR habilitado
- ✅ **Loading fallback**: `LoadingShell` exibido durante carregamento
- ✅ **Progressive loading**: Seções interativas carregam sob demanda

### 3. Component Architecture

#### UI Primitives (48 componentes shadcn/ui)

- ✅ **Radix UI**: Todas as primitivas baseadas em Radix
- ✅ **Consistência**: naming, variant patterns (CVA), className com tailwind-merge
- ✅ **Cobertura**: accordion, alert-dialog, avatar, badge, button, calendar, card, chart, checkbox, command, context-menu, dialog, drawer, dropdown-menu, form, hover-card, input, input-otp, label, menubar, navigation-menu, pagination, popover, progress, radio-group, resizable, scroll-area, select, separator, sheet, sidebar, skeleton, slider, sonner, switch, table, tabs, textarea, toast, toggle, toggle-group, tooltip

#### Vitrine (Home Page)

- ✅ **28 componentes**: hero, category-showcase, provider-card, filters, vitrine-results, topbar, etc.
- ✅ **SEO**: Páginas públicas com metadata (busca, categorias, providers)
- ✅ **Address autocomplete**: Componente com cache CEP + geo
- ✅ **Providers map**: MapLibre GL para visualização geoespacial
- ✅ **Compare bar/modal**: Comparação de providers

#### Admin Panel

- ✅ **40+ componentes**: dashboard, bookings, finance, providers, services, settings, etc.
- ✅ **Charts**: Recharts com tema customizado
- ✅ **Push management**: Send, schedule, recurring, analytics, webhooks

#### Client Panel

- ✅ **Dashboard**: Bookings, quotes, favorites, messages
- ✅ **Checkout**: Fluxo de pagamento integrado

#### Provider Panel

- ✅ **Dashboard**: Bookings, services, availability, wallet
- ✅ **Profile**: Edição com upload de fotos

### 4. State Management

#### Zustand Stores

- ✅ **`auth.ts`**: User, status, login/register/logout/fetchMe — persist localStorage
- ✅ **`view.ts`**: SPA navigation (dotted view strings), history stack com cap 50, URL sync
- ✅ **`ui.ts`**: Modal states (quote, booking, provider, auth), sidebar
- ✅ **`geo.ts`**: Geolocation state
- ✅ **`compare.ts`**: Provider comparison
- ✅ **`recently-viewed.ts`**: Recently viewed providers

#### React Query

- ✅ **Config**: staleTime 30s, retry 1, refetchOnWindowFocus false
- ✅ **Provider**: QueryClientProvider no root

#### XState

- ✅ **Machines**: Para fluxos complexos (booking flow, etc.)

### 5. Custom Hooks

- ✅ **`use-realtime.ts`**: Socket.io singleton com auto-reconnect
- ✅ **`use-geo-search.ts`**: Busca geo com cache
- ✅ **`use-checkout.ts`**: Fluxo de pagamento
- ✅ **`use-tracking.ts`**: Tracking de localização
- ✅ **`use-auto-cache-sweep.ts`**: Sweep automático de caches
- ✅ **`use-animation.ts`**: Animações com framer-motion
- ✅ **`use-favicon-badge.ts`**: Badge no favicon para notificações

### 6. SEO

- ✅ **Sitemap**: Dinâmico com providers, categorias, subcategorias (1000 max)
- ✅ **Robots.txt**: Permite `/`, bloqueia `/api/`, `/dashboard/`, `/admin/`
- ✅ **GPTBot**: Bloqueado (disallow: /)
- ✅ **OpenGraph**: title, description, siteName, locale pt_BR
- ✅ **Twitter card**: summary_large_image
- ✅ **Keywords**: marketplace, prestadores, encanador, eletricista, etc.
- ✅ **Canonical URLs**: Via metadata

### 7. Performance

- ✅ **Dynamic imports**: Vitrine, ClientPanel, ProviderPanel, AdminPanel, ModalsHost
- ✅ **SSR streaming**: Shell carrega imediatamente, interatividade sob demanda
- ✅ **Image optimization**: AVIF/WebP formats, deviceSizes configurados
- ✅ **Bundle analyzer**: `ANALYZE=true` disponível
- ✅ **optimizePackageImports**: lucide-react, recharts, date-fns, framer-motion

### 8. PWA

- ✅ **Manifest**: `/manifest.json` com icons, theme_color, background_color
- ✅ **Service Worker**: `/sw.js` registrado no mount
- ✅ **Push notifications**: VAPID keys, subscribe/unsubscribe
- ✅ **Offline**: Service worker cache para tiles e assets
- ✅ **Install banner**: PWAInstallBanner para Android Chrome

### 9. Accessibility

- ✅ **A11y tests**: vitest-axe + @axe-core/playwright
- ✅ **ARIA labels**: Componentes shadcn/ui com labels
- ✅ **Keyboard navigation**: shadcn/ui primitives suportam
- ✅ **Dark mode**: next-themes com class strategy

### 10. Realtime Integration

- ✅ **RealtimeProvider**: Socket.io connection no root
- ✅ **Silent notifications**: SW manda message ao invés de browser notification
- ✅ **Query invalidation**: Notificações invalidam React Query cache

---

## Findings Detalhados

### F-001: AppShell carrega TODOS os painéis via dynamic import

- **Severidade:** P2 (Melhoria)
- **Camada:** 1
- **Descrição:** O `AppShell` importa Vitrine, ClientPanel, ProviderPanel, AdminPanel e ModalsHost via `dynamic()`. Todos são carregados sob demanda, mas o bundle inicial inclui o código de routing para decidir qual painel mostrar. Para usuários que ficam apenas na vitrine, o código do admin/provider é carregado desnecessariamente.
- **Impacto:** Bundle size maior que o necessário para usuários da vitrine
- **Recomendação:** Usar `next/dynamic` com `ssr: false` para painéis autenticados (já feito para ModalsHost)
- **Esfroço:** 2h

### F-002: View store.syncUrlWithView pode falhar em sandboxes restritos

- **Severidade:** P3 (Baixa)
- **Camada:** 1
- **Descrição:** `syncUrlWithView` tenta acessar `window.history` — em iframes restritos ou sandboxes CSP, isso pode falhar silenciosamente (catch vazio).
- **Impacto:** Navegação pode não sincronizar com URL em ambientes restritos
- **Recomendação:** Manter como está (catch já existe, fallback funcional)
- **Esfroço:** 0h

### F-003: Robots.txt bloqueia GPTBot mas não outros bots de IA

- **Severidade:** P2 (Melhoria)
- **Camada:** 1
- **Descrição:** Apenas `GPTBot` é bloqueado no robots.txt. Outros bots de IA (Claude-Web, PerplexityBot, etc.) podem indexar o conteúdo.
- **Impacto:** Conteúdo pode ser usado por outros engines de IA
- **Recomendação:** Adicionar Claude-Web, PerplexityBot ao disallow se desejar bloquear todos os bots de IA
- **Esfroço:** 0.5h

### F-004: Auth store persiste user no localStorage (XSS risk)

- **Severidade:** P3 (Baixa)
- **Camada:** 1
- **Descrição:** O `auth.ts` store persiste `user` e `status` no localStorage via `zustand/persist`. Se um XSS for explorado, o attacker pode ler dados do usuário (id, name, email, role).
- **Impacto**: Baixo — cookie de sessão é HttpOnly (não acessível via JS), localStorage contém apenas dados não-sensíveis
- **Recomendação**: Manter como está (dados no localStorage são non-sensitive, session está no HttpOnly cookie)
- **Esfroço**: 0h

---

## Resumo por Prioridade

### P0 (Imediato)

- Nenhum finding P0 identificado

### P1 (Próxima sprint)

- Nenhum finding P1 identificado

### P2 (Backlog)

1. **F-001:** Otimizar code-splitting do AppShell
2. **F-003:** Adicionar mais bots de IA ao robots.txt

### P3 (Melhoria contínua)

3. **F-002:** syncUrlWithView em sandboxes (informativo)
4. **F-004:** Auth store localStorage (informativo)

---

## Estatísticas

| Métrica                   | Valor                           |
| ------------------------- | ------------------------------- |
| UI components (shadcn/ui) | 48                              |
| Vitrine components        | 28                              |
| Admin components          | 40+                             |
| Zustand stores            | 6                               |
| Custom hooks              | 11                              |
| Dynamic imports           | 5 (AppShell panels)             |
| PWA features              | 4 (manifest, SW, push, install) |

## Padrões Positivos

1. **SSR Streaming**: Server Component com Suspense para carregamento progressivo
2. **Code-splitting**: Todos os painéis carregados via dynamic()
3. **State management**: Zustand (client) + React Query (server) + XState (flows)
4. **URL sync**: View store sincroniza com URL (back/forward funciona)
5. **History cap**: Máximo 50 entradas previne localStorage unbounded
6. **PWA completa**: Manifest, SW, push notifications, install banner
7. **SEO dinâmico**: Sitemap com providers, categorias, subcategorias
8. **A11y**: Tests com vitest-axe + @axe-core/playwright
9. **Dark mode**: next-themes com class strategy
10. **Realtime**: Socket.io integration com silent notifications via SW
