# Memory Index — Severinno Marketplace SaaS

> Índice de memória persistente do projeto. Cada entrada aponta para um topic file com detalhes.
> Atualizado: 25/07/2026

---

## Projeto

- [project] Marketplace de serviços com geolocalização (Clientes ↔ Prestadores verificados) → project-conventions.md
- [project] Fase 1 / MVP completa — todas as 3 personas funcionais (Cliente, Prestador, Admin) → session-history.md

## Stack

- [project] Next.js 16 + Prisma/SQLite + MapLibre + shadcn/ui + Tailwind 4 → project-conventions.md
- [project] WebSocket mini-service (socket.io, porta 3003, path "/") → project-conventions.md
- [project] Zustand + TanStack Query + Zod 4 + framer-motion + recharts → project-conventions.md

## User

- [user] Desenvolvedor brasileiro, projeto em português (pt-BR) → user-preferences.md
- [user] Prefere soluções práticas e diretas → user-preferences.md
- [user] Cor primária: emerald (NUNCA indigo/azul) → user-preferences.md

## Decisions

- [decision] Rota única `/` com SPA view-switching via Zustand → tech-decisions.md
- [decision] APIs em `src/app/api/**` (não server actions) → tech-decisions.md
- [decision] SQLite no MVP (PostGIS/ RabbitMQ/OSRM na arquitetura-alvo) → tech-decisions.md
- [decision] Prisma schema sem enum nativo (SQLite-safe, String + comentário) → tech-decisions.md
- [decision] Auth com HMAC-SHA256 cookie httpOnly (não JWT) → tech-decisions.md
- [decision] WebSocket na porta 3003 com path "/" (requisito Caddy) → tech-decisions.md

---

## Topic Files

| File | Conteúdo |
|------|----------|
| project-conventions.md | Stack, regras de código, design system, estrutura de diretórios |
| tech-decisions.md | Decisões arquiteturais e trade-offs |
| session-history.md | Resumo do que foi feito em cada sessão/task |
| user-preferences.md | Preferências do usuário, estilo de comunicação |
