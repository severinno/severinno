# Parecer técnico — varredura profunda por camadas (2026-10-05)

Varredura independente, camada por camada, do repositório Severinno no estado
`457415bb` (HEAD da branch `feature/forja-gates-e-regua-unica-reduzido`).
Método: leitura de código, execução de typecheck/lint/suítes no tree e em
worktree limpo do HEAD, contagem de órfãos por resolução real de imports,
introspecção do schema e da stack de infra. O working tree contém ~339
arquivos de WIP de outras threads (realtime, migração withRoute, pagamentos
em construção) — quando a distinção importa, o número do **HEAD commitado**
é medido em worktree separado.

## Resumo executivo

- **Nota geral do projeto: 7.5/10** — engenharia acima da média para o
  estágio; MVP avançado com infraestrutura de produto.
- **Achado crítico #1 (governança)**: `bun run lint` (o MESMO comando do CI,
  `--max-warnings 0`) está **vermelho no HEAD commitado** desde `d580d8a9`
  (03/10). Causa: `scripts/sync-maplibre-worker.mjs` versiona bundles
  minificados (`public/maplibre/*.js`) fora da tabela de geradores, e o eslint
  reprova neles (1 error + ~4.700 warnings). Com o required check "Lint"
  aplicado, PRs para `main` estão travados nesse check.
- **Achado crítico #2 (governança)**: 5 testes de meta-guard falham no **HEAD
  limpo** (não é ruído de WIP): `check-generated-format` ×2 (mesma causa do
  lint), `check-prove-docs` ×1 (`cut-stages:prove` diverge da doc — documenta
  `exit 0`, a saída real é `exit 1`), `forge-doctor` ×2 (invariantes
  `realtime-*`/`route-handler-style` sem régua medida).
- **Nenhuma falha de produto**: typecheck **RC=0**; 9.758/9.772 testes passam
  no tree (as 12 falhas são os meta-guards acima, agravados por WIP alheio).
- **Segurança sólida no que existe**: sessão HMAC própria com
  `httpOnly`/`sameSite=lax`/`secure`, `timingSafeEqual`, rotação de cookie,
  `sessionVersion` para invalidação; 4 sinks `dangerouslySetInnerHTML`
  auditados (3 sanitizados com `sanitizeForJsonLd`, 1 só com constantes);
  zero `eval`/`new Function`; `$queryRawUnsafe` usados no padrão
  parametrizado (`$n` + `params.push`).
- **Dead code relevante**: 56 arquivos órfãos RASTREADOS (de 57 flagados —
  1 era artefato local gitignored) — ~30 componentes shadcn/ui nunca usados,
  módulos aspiracionais (`cities.ts` multi-cidade completo e nunca importado,
  `loyalty.ts`, `chat.ts`, `alert-webhook.ts`), barrels duplicados (o par
  rastreado ×7 foi removido; `lib/db/index.ts` era artefato local), workers
  de fila mantidos vivos só por testes.

## Notas por camada

| #   | Camada                     | Nota | Veredito curto                                          |
| --- | -------------------------- | ---- | ------------------------------------------------------- |
| 1   | Configuração & ferramental | 8.5  | TS estrito, 215 scripts, typecheck limpo                |
| 2   | Dados (Prisma/PostGIS)     | 8.0  | 31 modelos, 92 índices, 33 migrações                    |
| 3   | API (rotas)                | 7.5  | 192 rotas, withRoute em migração (116/192)              |
| 4   | Auth & segurança           | 8.0  | Sessão própria correta; LGPD operacional ausente        |
| 5   | Frontend                   | 7.5  | Bundle controlado, a11y boa, 57 órfãos                  |
| 6   | Observabilidade            | 7.5  | GlitchTip + health checks + RUM novo                    |
| 7   | Qualidade & testes         | 8.5  | 9.772 testes; 5 guardas vermelhos no HEAD               |
| 8   | Infra & escala             | 8.5  | PgBouncer, RabbitMQ, MinIO, Caddy, Redis                |
| 9   | CI/CD & governança         | 7.0  | Paridade dual-forge forte; 3 gates vermelhos            |
| 10  | Produto                    | 7.0  | MVP avançado; sem pagamentos; multi-cidade aspiracional |

## Camada 1 — Configuração & ferramental: 8.5/10

- Next.js 16 + React 19 + TanStack v5 + Bun; TypeScript estrito com
  `typecheck RC=0` tanto no tree (com 339 arquivos de WIP) quanto no HEAD.
- 215 scripts npm — cobertura rara de tarefas (mutation suites, guards,
  e2e, seeds, doctor). Risco: a superfície de scripts é grande e exige
  manutenção; o doctor existe exatamente para medi-la.
- 85 deps runtime / 29 devDeps. Triagem de não-usadas: `graphql` (a rota
  `/api/graphql` usa schema artesanal via yoga), `uuid` (usa
  `crypto.randomUUID`), `prisma` (CLI usado por scripts — manter). Falso
  positivo: `server-only` (bare imports).

## Camada 2 — Dados: 8.0/10

- `prisma/schema.prisma`: 992 linhas, 31 modelos, 33 migrações, 92
  `@@index`, 17 únicos, 36 `onDelete` explícitos, 11 `Decimal` (dinheiro
  sem float), PostGIS para geo (KNN por raio medido em ~15 ms).
- ~14 relações sem `onDelete` explícito (default `RESTRICT`) — menor, mas
  vale padronizar.
- `search_reindex_queue` com drift já resolvido (commit `d580d8a9`).
- Seed mono-cidade (Governador Valadares) por design; o registry
  multi-cidade (`src/lib/cities.ts`) existe mas **não é importado por
  ninguém** (órfão).

## Camada 3 — API: 7.5/10

- 192 rotas; 116 usam `withRoute` (60%); as 76 restantes são a migração em
  voo de outra thread (213 arquivos WIP em `src/app/api`). Amostra das sem
  wrapper mostra guard manual (`requireRole`) — não é buraco de auth.
- `$queryRawUnsafe` ×55: amostra de `sql-builder.ts` confirma o padrão
  parametrizado (`$${n}` placeholders + `params.push(sanitized)`) — seguro.
- Endpoint RUM auditado: whitelist zod, caps de tamanho/contagem, 204 sem
  estado, sem PII por construção.
- N+1 não foi medido sistematicamente — recomendo um job de detecção.

## Camada 4 — Auth & segurança: 8.0/10

- Sessão HMAC-SHA256 própria (sem lib JWT): formato
  `userId.role.expiresAt.sessionVersion.signature`, `timingSafeEqual`,
  rotação aos 15 dias, invalidação por `sessionVersion`, cache Redis,
  `SESSION_SECRET` obrigatório (falha alto se ausente).
- Cookie: `httpOnly: true`, `sameSite: "lax"`, `secure` em produção. Bom.
- 4 sinks `dangerouslySetInnerHTML`: 3 usam `sanitizeForJsonLd` (escapa
  `<>&'`), 1 só com constantes estáticas. Sem `eval`.
- PII allowlist guard no CI (projeção de payload de usuário).
- Riscos: verificação de identidade envia documento + selfie para MinIO
  **sem política de retenção/base legal visível** — risco LGPD; sem fluxo
  de exclusição/anonimização de dados no produto (só menções em FAQ).

## Camada 5 — Frontend: 7.5/10

- 246 arquivos, ~76k linhas. Bundle medido hoje: rota da vitrine 86.4 KB
  (orçamento ≤120 KB), maplibre 1 MB **lazy** (import dinâmico em cadeia).
- A11y da troca de resultados (página + busca/filtro) com foco gerenciado,
  anúncio `role="alert"` sempre montado, testes 5/5 e e2e p1→p10.
- Dead code: 57 órfãos commitados — 12 componentes shadcn/ui
  (`aspect-ratio`, `context-menu`, `menubar`, `resizable`…), 6 admin
  (`admin-gateway`, `admin-metrics`…), `loading-global.tsx`,
  `use-geo-search`, `use-service-worker`, `providers-map`, e módulos de
  negócio não integrados (`loyalty`, `chat`, `cities`, `notification-digest`,
  `retry`, `alert-webhook`).
- Barrels duplicados: 8 pares flagados — 7 rastreados (`lib/auth/index.ts`
  etc., removidos no desdobramento) + 1 artefato local gitignored
  (`lib/db/index.ts`, regra `db/` do .gitignore). Higiene, não bug.

## Camada 6 — Observabilidade: 7.5/10

- GlitchTip self-hosted (`docker-compose.glitchtip.yml`), `instrumentation.ts`
  carrega `sentry.server.config.ts`; health checks `/api/health` e
  `/health/detailed` (inclui S3/MinIO); RUM leve da vitrine (amostragem 0.1,
  `sendBeacon`, sem PII); métricas geo com snapshots em disco (527
  carregados — atenção: cache em disco não escala horizontalmente sem
  volume compartilhado).
- `sentry.client.config.ts` sem `withSentryConfig` — verificar se o init do
  client acontece (com GlitchTip o SDK funciona direto, mas o arquivo
  precisa ser carregado).

## Camada 7 — Qualidade & testes: 8.5/10

- 533 arquivos de teste / 9.772 casos; **9.758 passam** no tree. As 12
  falhas são meta-guards que julgam o repositório real.
- No **HEAD limpo**: 5 falhas pré-existentes commitadas —
  `check-generated-format` ×2, `check-prove-docs` ×1, `forge-doctor` ×2.
- 33 specs e2e (Playwright), suites de mutação (156/156), guards de CI com
  48 invariantes CORE + 24 isenções, prova por commit (`stack-per-commit`).
- O aparato de qualidade é excepcional; o débito é que **ele está
  parcialmente vermelho no HEAD** (ver Camada 9).

## Camada 8 — Infra & escala: 8.5/10

- `docker-compose.prod.yml`: `frontend`, `backend`, `caddy`, `postgres`,
  `redis`, `rabbitmq`, `minio`, `pgbouncer` — arquitetura de produção real.
- Stateless-friendly: sessão em cookie, rate-limit distribuído em Redis
  (fallback in-memory por instância, aceitável), filas em RabbitMQ,
  uploads em MinIO/S3 (documento+selfie da identidade), pooling via
  PgBouncer.
- `k6/load-test.js` e `loadtest/geo-benchmark.sh` presentes.
- Ressalvas: realtime em construção usa socket.io-client **sem server
  socket.io nem redis-adapter visível** — se for multi-instância, precisará
  de adapter; métricas geo com persistência em disco local pede volume.

## Camada 9 — CI/CD & governança: 7.0/10

- Paridade dual-forge (Gitea + GitHub) com gate de invariantes — raro e
  forte. Prova por commit, required checks com applier, drift cron.
- **Mas**: 3 famílias de gates vermelhos no HEAD commitado, sem dívida
  declarada em `ci/unproven.json`:
  1. `lint` (CI roda `bun run lint`) — bundles maplibre fora do lint e
     fora da tabela de geradores (`d580d8a9`, 03/10);
  2. `check-prove-docs` — `cut-stages:prove` (GUARDS.md:8486) documenta
     `exit 0`/`provado`/`paridade: 0`; a saída real é `exit 1` sem as linhas;
  3. `forge-doctor` — invariantes `realtime-*` e `route-handler-style` sem
     régua medida.
- Consequência prática: com o required check "Lint" aplicado na Gitea,
  todo PR para `main` fica travado até o item 1 ser corrigido.

## Camada 10 — Produto: 7.0/10

- Fluxos presentes: vitrine com busca geo/raio/categorias, onboarding de
  prestador com verificação de identidade (documento+selfie), bookings,
  contratos, notificações (digest/email/push), chat com detecção de fraude,
  painel admin extenso.
- Ausências que definem o estágio: **sem gateway de pagamento** (escrow
  apenas em migração/script), multi-cidade não integrado, LGPD operacional
  (retenção/exclusão) não implementada, pagamentos `bookings/[id]/pay` em
  construção.

## Respostas às perguntas

### 1) É MVP ou produto?

**MVP avançado** (não MVP cru, ainda não produto). Evidências: núcleo
funcional completo e testado (busca, perfis, booking, identidade,
notificações), infraestrutura de produção pronta (compose com
pgbouncer/rabbitmq/minio), mas **sem monetização implementada** (nenhum
gateway de pagamento nos deps), multi-cidade aspiracional e LGPD
operacional ausente. Veredito: pronto para **piloto pago controlado** numa
cidade, com o item crítico de pagamentos antes de GA.

### 2) Suporta escala horizontal?

**Sim, por arquitetura.** App stateless (sessão em cookie assinado),
estado distribuído em Redis (rate-limit, cache), filas em RabbitMQ, uploads
em MinIO/S3, pooling com PgBouncer, proxy Caddy. Para escalar: réplicas do
`frontend`/`backend` atrás do Caddy + Postgres/Redis gerenciados ou
HA. Ressalvas: (a) realtime em construção precisa de adapter Redis (ou SSE
puro) para múltiplas instâncias; (b) métricas geo persistidas em disco
local exigem volume compartilhado; (c) cron/consumers devem rodar como
deployment único (não replicado) — `consumer.ts` já é entrypoint separado,
o que facilita.

### 3) Pode ser implantado em todo o Brasil?

**Tecnicamente sim.** A geo não é hardcoded: busca por coordenada/raio via
PostGIS KNN; a cidade nos metadados do `layout.tsx` é só SEO default.
Um deploy em região São Paulo (sa-east-1) atende o país com latência
adequada; CDN para estáticos. Barreiras reais para operar nacionalmente:
(i) dados por cidade (seed é mono-cidade; o registry multi-cidade existe
mas não está integrado); (ii) LGPD (retenção de biometria, base legal,
exclusão); (iii) pagamentos; (iv) capacidade de suporte/operação
multi-cidade. Ou seja: **sim em engenharia, não ainda em operação**.

## Top 5 ações recomendadas (ordem de impacto)

1. **Fechar o lint vermelho**: declarar `sync-maplibre-worker` na tabela
   GERADORES do `check-generated-format` e excluir `public/maplibre/**` do
   eslint (ou ignorar bundles gerados) — destrava o check "Lint" e o PR.
2. **Reancorar `cut-stages:prove`** na doc (GUARDS.md:8486) ou declarar a
   dívida em `ci/unproven.json` — fecha o `check-prove-docs`.
3. **Régua medida para as invariantes novas** (`realtime-*`,
   `route-handler-style`) — fecha o `forge-doctor` quando o WIP pousar.
4. **Higiene de dead code**: ~30 componentes shadcn + 27 módulos/órfãos —
   deletar ou integrar (o `cities.ts` merece decisão de produto).
5. **Pagamentos + LGPD operacional** — os dois portões para virar produto.

## Desdobramento (2026-10-05, mesma sessão)

Os itens acionáveis do parecer foram fechados na sequência:

- **Lint vermelho fechado** — `415c35e7`: o guard `check-generated-format`
  ganhou o campo `saidasCruas` (saída versionada deliberadamente fora do
  lint, com oráculo INVERTIDO: tem de estar no `.prettierignore`), o
  `sync-maplibre-worker` foi declarado (3 saídas + escritas cruas), o eslint
  passou a ignorar `public/maplibre/**` e 4 warnings pré-existentes foram
  fechados. Prova: `bun run lint` em worktree do HEAD + fixes → **RC=0**;
  suíte do guard **21/21**.
- **Higiene de dead code (subset seguro)** — `16a4f51e`: 8 barrels órfãos
  rastreados de `lib/` removidos (0 importadores em código e testes).
  Componentes shadcn/ui, módulos aspiracionais e diretórios mortos de
  componentes ficam para decisão de produto/dono.
- **Prova do `--apply` contra forja de teste** — a suíte
  `required-checks-apply-cli` (forja dublê efêmera) cobre o caminho
  completo: os contextos CHEGAM à forja antes da declaração ser reescrita,
  a forja que recusa não deixa declaração, `--check` não escreve, e sem
  token a CLI recusa antes de tocar a forja — **verde**.
- **Dívidas declaradas** em `ci/unproven.json` para os 3 commits desta
  série (mesma causa dos pais: realtime/route-handler-style são WIP de
  outra thread e só fecham com o landing dela).

**Permanecem bloqueados (por desenho, não por código):**

1. A virada do required check (`--apply`) — exige `GITEA_TOKEN` admin +
   `GITEA_URL`/`GITEA_REPOSITORY`; sem eles o `applied.json` não pode ser
   reescrito com honestidade (o applier é o único escritor sancionado).
2. O vermelho residual no HEAD limpo de `cut-stages:prove` (paridade 6),
   `forge-doctor` (régua medida) e `ci-workflow` (snapshot) — todos medidos
   no tree como **verdes**; são o estado do WIP alheio e fecham no landing.

## Limitações desta varredura

- O tree contém WIP ativo de outras threads; medidas no HEAD foram feitas
  em worktree limpo. Falhas de meta-guard agravadas por WIP foram separadas
  das pré-existentes.
- N+1, índices parciais e profundidade de query não foram medidos em
  runtime; lint/typecheck cobrem estático.
- Sem credenciais das forjas, não inspecionei runs reais de CI — a
  conclusão de lint vermelho no CI é inferida do comando idêntico rodando
  localmente no HEAD.
