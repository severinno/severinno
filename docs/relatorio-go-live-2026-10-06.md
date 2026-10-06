# Relatório Go-Live — Severinno Marketplace

**Data:** 2026-10-06 · **Branch:** `feature/forja-gates-e-regua-unica-reduzido` · **HEAD:** `205fcb1b`

## Resposta direta

**Sim, existiam impeditivos — e todos os que estavam sob controle do código/infraestrutura estão RESOLVIDOS e provados em produção.** Restam pendências que **só o usuário** pode executar (DNS, credenciais de serviços externos e a decisão de merge). A aplicação está no ar, saudável e com workers funcionando no VPS.

## Impeditivos RESOLVIDOS (com prova)

| #   | Impeditivo                                                                                                              | Solução                                                                                                                                                                                         | Prova                                                                                                                                    |
| --- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `next build` dentro do buildkit tarpita (postcss/Turbopack: 6+ GB RSS, CPU 100%)                                        | Build no host + montagem das imagens sobre os artefatos (`.next/standalone` + static + public + prisma)                                                                                         | Imagens no ar: app `8350028c3c45`, worker `6a91c31d1c2b`                                                                                 |
| 2   | Compose zerava o Cmd do app (entrypoint custom) → loop "Starting: " vazio                                               | `command: ["node","server.js"]` explícito + entrypoint `/scripts/docker-entrypoint.sh`                                                                                                          | App `Up (healthy)`                                                                                                                       |
| 3   | Healthcheck do deploy usava `curl` (bookworm-slim não tem)                                                              | `node -e fetch(...)` no compose e no pipeline                                                                                                                                                   | `/api/health` **HTTP 200**, todos os checks ok                                                                                           |
| 4   | PgBouncer sem `userlist` real → "SASL authentication failed"                                                            | `auth_type=scram-sha-256` + `auth_file` + `userlist.txt` gerado de `pg_authid` + bind mount                                                                                                     | `select 1` via pgbouncer OK                                                                                                              |
| 5   | Banco de produção drifted (14 migrations antigas, sem tabelas do squash)                                                | Delta `migrate diff` aplicado + SQL comportamental + migrations marcadas                                                                                                                        | **"No pending migrations to apply."**                                                                                                    |
| 6   | `prisma migrate` travava em `pg_advisory_lock` (transaction pooling)                                                    | `directUrl = env("DIRECT_URL")` no `schema.prisma` → migrate vai direto ao postgres:5432                                                                                                        | Migrate executa sem deadlock                                                                                                             |
| 7   | Banco fresh quebraria com P3018 (índice de `WalletTransaction` antes da tabela)                                         | Guard `to_regclass` na migration 0724 + índice movido para o fim da baseline 0813                                                                                                               | Corrigido e commitado                                                                                                                    |
| 8   | Workers crashavam: (a) `Cannot find module '@/lib/db'` (imagem velha); (b) broker fechava conexão (`vhost / not found`) | (a) force-recreate com a imagem nova (tsconfig para o alias `@/*`, server-only no-op); (b) usuário no broker + **vhost `severinno` na `RABBITMQ_URL`** (compose E entrypoint leitor-de-secrets) | email: `listening on queue=emails`; notification: `listening on queue=notifications`; 2 conexões ativas no broker                        |
| 9   | Sem edge unificado (app fora do Caddy da forja)                                                                         | Caddyfile unificado + `gitea-caddy-1` conectado à rede `severinno_backend`                                                                                                                      | `git.severinno.com` → **200**; `severinno.com.br` rota **308→https** provada; upstreams `app:3000` e `realtime:3003` respondem pelo nome |
| 10  | Cron LGPD dependia de curl (inexistente no app)                                                                         | Cron root usa `node -e fetch` no container, lendo `/run/secrets/cron_secret`                                                                                                                    | Ativo no crontab                                                                                                                         |
| 11  | Fixes de deploy não versionados                                                                                         | Commit `205fcb1b` (8 arquivos, stage cirúrgico, guards verdes) + `c723bef2`                                                                                                                     | HEAD contém Dockerfile, Dockerfile.worker, pipelines das 2 forjas, schema, 2 migrations, entrypoint (+exec-bit)                          |

## Pendências que SÓ O USUÁRIO resolve

1. **DNS (bloqueia o lançamento público):** apontar `severinno.com` e `severinno.com.br` (registros A de `@` e `www`) → **187.127.16.136**. Hoje o `.com` está parkeado na Hostinger (2.57.91.91) e o `.br` só tem IPv6 de outra máquina; `git.severinno.com` já OK. Após o DNS, o Caddy emite o certificado TLS sozinho (ACME, ~1–2 min) — nenhuma ação técnica extra.
2. **`SMTP_PASS` real** (e-mail transacional: verificação, recuperação, notificações).
3. **`LYTEX_CLIENT_ID` / `LYTEX_SECRET`** (pagamentos PIX/cartão).
4. **`EVOLUTION_API_KEY`** (WhatsApp).
5. **`GROQ_API_KEY`** (IA).
6. **GlitchTip:** DSN + DNS do host de erros (observabilidade opcional — o app sobe sem ele).
7. **Decisão OpenSearch:** habilitar ou manter desabilitado por design (health reporta "disabled" — não é erro).
8. **Merge → `main`** para disparar o pipeline oficial de deploy (push nunca será executado por agente sem autorização explícita).

## Riscos e dívida documentada

- **Tarpit do buildkit:** o `next build` dentro do buildkit segue instável (também reproduzido em glibc). O risco está documentado no job `build` da forja ([deploy.yml](../.gitea/workflows/deploy.yml)) e no [Dockerfile](../Dockerfile), com o fallback **host-artifacts** já medido (~2 min, RC=0). Se o pipeline pendurar no build, aplicar o fallback.
- **Drift VPS ↔ repo (vive só na VPS, re-aplicar se a stack for recriada do repo):**
  - `docker-compose.hostinger.yml` da VPS: entrypoints em cadeia, `command` explícito, healthcheck node, secrets `640 root:1001`, `RABBITMQ_URL` com `/severinno`, bind do `userlist.txt`;
  - `config/pgbouncer/pgbouncer.ini` (scram + auth_file) + `userlist.txt` do host;
  - `config/rabbitmq/rabbitmq.conf` (`default_user/pass/vhost = severinno`) — o broker existente foi criado ANTES do conf, por isso o usuário foi garantido via `rabbitmqctl`;
  - `/opt/gitea/Caddyfile` unificado (backups em `/opt/gitea/Caddyfile.bak.*`).
  - Nota: o compose do **repo** está em WIP de outro autor (não commitado aqui) — não foi tocado.
- **GitHub sem portão de merge** (limitação de plano do GitHub, apontada pelo guard `required-checks`): o merge governante é a forja Gitea.

## Estado final da stack (provas de hoje)

```
severinno-app-1                Up (healthy)   /api/health → 200 (db, postgis, redis, rabbitmq, nominatim, viacep, s3)
severinno-email-worker-1       Up (healthy)   listening on queue=emails
severinno-notification-worker  Up (healthy)   listening on queue=notifications
severinno-pgbouncer-1          Up (healthy)   SCRAM provado
severinno-postgres-1           Up (healthy)   migrations em sync
severinno-rabbitmq-1           Up (healthy)   2 conexões ativas (vhost severinno)
severinno-realtime-1           Up (healthy)   socket.io handshake OK
gitea-caddy-1                  Up (healthy)   git 200 · app 308→https · upstreams OK
```

**Conclusão:** infraestrutura e aplicação prontas para produção. O lançamento público depende apenas dos 8 itens da seção "Só o usuário" — o primeiro (DNS) desbloqueia o tráfego real e o TLS automático na sequência.
