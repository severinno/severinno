# Task 7 — Provider Panel (full-stack-developer)

## Entregáveis

### 10 Views em `src/components/provider/`

1. **`provider-dashboard.tsx`** — Overview com 4 KPI cards (agendamentos hoje/semana, orçamentos pendentes, avaliação média, receita recebida) + 2 charts recharts (bar de agendamentos 7 dias, line de receita por mês) + 3 listas recentes (próximos agendamentos, orçamentos pendentes, últimas avaliações) + quick actions (Novo serviço, Expediente).
2. **`provider-expediente.tsx`** — 7 cards Dom-Sáb com slots {startTime, endTime, active}. Add/remove slot, Switch ativo, "Copiar para dias úteis", aviso de sobreposição, validação startTime < endTime. POST /api/availability upsert (replace strategy).
3. **`provider-agenda.tsx`** — Calendar grid mensal (date-fns) com dots coloridos por status. Tabs Hoje/Semana/Mês. Lista do dia selecionado. Read-only.
4. **`provider-bookings.tsx`** — Tabs por status (Pendentes/Confirmados/Em andamento/Concluídos/Cancelados/Todos). Cards com avatar+cliente+serviço+data+endereço+valor+status. Dropdown actions (Confirmar/Iniciar/Cancelar/Ver detalhes/Enviar mensagem). Dialog detalhes com link OSM. Paginação 10/página.
5. **`provider-quotes.tsx`** — Tabs por status. Cards expandíveis. Formulário de resposta (price + note + status=QUOTED) para items PENDING. Mostra preço/nota para QUOTED. Link "Enviar mensagem ao cliente".
6. **`provider-services.tsx`** — CRUD completo. Cascade 3-nível (Selects: pai → filha → subcategoria). serviceSchema + react-hook-form + zodResolver. FilePhotos max 4. Preço só sobe (alerta frontend + backend enforce). AlertDialog de exclusão. Active toggle inline. Busca textual.
7. **`provider-finance.tsx`** — Cards de resumo (Recebido/A receber/Estornado). Chart bar de receita por mês. Filtros status+mês+ano. Tabela de transações.
8. **`provider-messages.tsx`** — Wrapper do MessagesView shared com initialPeerId dos params.
9. **`provider-reviews.tsx`** — Card de avaliação média + distribuição (5★-1★ com barras) + lista de reviews.
10. **`provider-profile.tsx`** — Cover+avatar preview + SinglePhoto uploader + form (name/bio/whatsapp/phone/address/radiusKm) + read-only (email, cpfCnpj, verified) + GPS button. PATCH /api/users/me.

### Orquestrador
- **`provider-panel.tsx`** — Lê `useViewStore.view`, mapeia para a view correspondente, monta `DashboardShell` com nav items (10 itens, badges dinâmicos para quotes/bookings pendentes) + breadcrumbs. Header "Painel do Prestador".

### Rotas API (`src/app/api/`)
- **`availability/route.ts`** — GET (own) + POST (upsert array, replace strategy via $transaction, valida startTime < endTime, availabilitySchema).
- **`availability/[id]/route.ts`** — DELETE (owner check).
- **`users/me/route.ts`** — GET (USER_PUBLIC_SELECT) + PATCH (providerProfileSchema, only owner). Criada porque não existia.

### Shared components (`src/components/shared/`)
- **`messages-view.tsx`** — Chat 2-pane reutilizável. Left: lista de conversas com unread badge. Right: thread + composer. Realtime via useRealtime hook (subscribes `message:new`). Invalida TanStack Query em tempo real. Refetch interval 10-15s como fallback.

## Decisões chave
- DashboardShell: minha versão inicial foi sobrescrita pelo Task 6 (Client Panel). Adaptei ao contrato final deles: `panelLabel` + `panelIcon` (REQUIRED), `breadcrumbs: {label, onClick?}[]`, `onNavigate: (view) => void`.
- Availability POST usa replace strategy (deleteMany + create all em $transaction). IDs mudam a cada save.
- Dashboard deriva KPIs de 3 chamadas separadas (bookings/quotes/reviews, limit=200). Sem endpoint agregado dedicado (MVP).
- Quote items: UI mostra todos os items do request. Backend já filtra requests via OR. Provider só responde aos próprios items (validação server-side no PATCH).
- Bookings: provider NÃO pode concluir (só cliente). UI mostra nota e esconde botão Concluir.
- Mapa: link externo OpenStreetMap nos detalhes (sem maplibre inline).
- SinglePhoto (profile) usa fetch direto (não apiPost) porque apiPost sempre seta Content-Type JSON.

## Como rodar
```bash
# Login provider (seed)
# carlos@severinno.com / provider123  (ou qualquer [profession]@severinno.com)
# Navegar: painel do prestador aparece em view='provider.dashboard'
```

## Verificações
- `bunx tsc --noEmit` → 0 erros nos meus arquivos.
- `bunx eslint src/components/provider src/components/shared/messages-view.tsx src/app/api/availability src/app/api/users/me` → 0 erros, 0 warnings.
- `bun run lint` → só 2 erros pre-existing em use-realtime.ts (Task 2, fora de escopo).

## Caveats
1. DashboardShell API: ver header do arquivo para contrato atual (Task 6 dono).
2. users/me: criado por mim (Task 7). Se Task 6 também criou, minha versão prevaleceu (escrita depois).
3. Availability: IDs mudam a cada save (replace strategy). Frontend nunca reusa IDs localmente.
4. Quote items: backend filtra requests via OR no providerId, mas items array vem completo.
5. Mapa nos bookings: link externo OSM, sem maplibre inline (bundle leve).
6. Paginação só em bookings (10/página). Quotes usa limit=50 sem paginação real.
