---
type: project
created: 2026-07-25
updated: 2026-07-25
---

# Project Conventions — Severinno Marketplace SaaS

> Marketplace de serviços com geolocalização (Clientes ↔ Prestadores verificados)

---

## Tech Stack

| Camada | Tecnologia |
|--------|-----------|
| **Frontend** | Next.js 16 (App Router), shadcn/ui, Tailwind CSS 4 |
| **State** | Zustand (stores), TanStack Query (server state) |
| **Forms** | react-hook-form + Zod 4 |
| **Animation** | framer-motion (motion/react) |
| **Charts** | recharts |
| **Database** | Prisma ORM + SQLite (MVP) / PostgreSQL + PostGIS (arquitetura-alvo) |
| **Realtime** | WebSocket mini-service (socket.io, porta 3003) |
| **Ícones** | Lucide React |
| **Mapa** | MapLibre GL (vitrine) |

---

## Design System

- **Cor primária:** Emerald (`oklch(0.55 0.15 160)` light / `oklch(0.7 0.16 160)` dark)
- **NUNCA usar:** indigo, azul, ou purple como cor primária
- **Rating stars:** Amber-400
- **Footer:** Slate-900 escuro
- **Cards:** `rounded-xl shadow-sm hover:shadow-md` com borda hover emerald
- **Tema:** Suporte light/dark mode via next-themes

---

## Estrutura de Diretórios

```
src/
├── app/
│   ├── api/           # Route handlers (REST)
│   ├── globals.css     # Design tokens Tailwind
│   ├── layout.tsx      # Root layout (pt-BR)
│   └── page.tsx        # Rota única SPA (AppShell)
├── components/
│   ├── admin/          # Admin panel views
│   ├── client/         # Client panel views
│   ├── modals/         # Flow modals (auth, quote, booking, etc.)
│   ├── provider/       # Provider panel views
│   ├── shared/         # Shared components (footer, dashboard-shell, messages-view)
│   └── vitrine/        # Public storefront components
├── hooks/              # Custom hooks (use-realtime, use-mobile)
├── lib/                # Libraries (api, auth, crypto, geo, format, constants, validators, api-server)
└── store/              # Zustand stores (auth, geo, view, ui)
prisma/
├── schema.prisma       # 13 modelos de dados
└── seed.ts             # Seed idempotente
mini-services/
└── realtime/           # WebSocket service (porta 3003)
```

---

## Regras de Código

### Geral
- **Rota única `/`** — SPA com view-switching via `useViewStore` (Zustand)
- **APIs em `src/app/api/**`** — route handlers do Next.js (NUNCA server actions)
- **pt-BR** — locale português brasileiro (labels, constantes, formatação)
- **Emerald primary** — consistente em todo o projeto

### SQLite / Prisma
- Sem enum nativo — usar `String` + comentário no schema
- Índices em colunas de busca
- Migrations via `prisma db push` (MVP)

### API
- Server-side: helpers em `src/lib/api-server.ts` (HttpError, handleError, etc.)
- Client-side: wrapper tipado em `src/lib/api.ts` (apiGet, apiPost, apiPatch, apiDelete)
- Shapes de resposta consistentes (flat arrays ou `{items, total, page, limit}`)

### Stores
- `auth`: user, login, register, logout, fetchMe (persiste: só tokens)
- `geo`: location, address, geocode (persiste)
- `view`: view atual + params (persiste só view+params)
- `ui`: UI state efêmero (modais abertos, não persiste)

### WebSocket (porta 3003)
- Path: "/" (hard, requisito Caddy)
- Frontend conecta via `io("/?XTransformPort=3003")`
- Eventos: join, message:send, booking:update, quote:update, tracking:position
- Singleton hook: `useRealtime()` em `src/hooks/use-realtime.ts`

---

## Credenciais de Teste (Seed)

| Role | Email | Senha |
|------|-------|-------|
| Admin | admin@severinno.com | admin123 |
| Cliente | cliente@severinno.com | cliente123 |
| Cliente | maria@severinno.com | cliente123 |
| Prestador | [nome]@severinno.com | provider123 |
