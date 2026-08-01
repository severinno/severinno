# Rotação de Secrets — Procedimento de Emergência e Rotina

> **Contexto:** os arquivos `.env` e `.env.production` estiveram rastreados pelo
> git com secrets reais. Mesmo após `git rm --cached`, os valores antigos
> permanecem no **histórico** do repositório — a única remediação real é
> **rotacionar cada secret exposto** e aplicar os novos valores nos
> provedores/instâncias.
>
> Última atualização: 2026-07-31

## ⚠️ Regra de Ouro

```
NUNCA commite arquivos .env*.
.gitignore cobre .env* (exceto *.example — templates seguros).
Se um .env vazar para o git → ROTACIONE os secrets, não apenas remova do índice.
```

## 1. Visão Geral do Fluxo

```bash
# 1. Verificar se o git ainda rastreia algum .env (CI guard)
bun run secrets:check

# 2. Remover do índice (se ainda estiver trackeado)
git rm --cached .env .env.production

# 3. Dry-run — mostra o que será rotacionado (valores mascarados)
bun run secrets:rotate

# 4. Aplicar — grava .env.rotated e .env.production.rotated (originais intactos)
bun run secrets:rotate:apply
```

O script `scripts/rotate-secrets.mjs` divide os secrets em 3 categorias:

| Categoria  | Comportamento                                                                                                                                | Exemplos                                                                                                                                                  |
| :--------- | :------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AUTO**   | Gera novo valor localmente (base64url) e reescreve senhas embutidas em URLs (`DATABASE_URL`, `DIRECT_URL`, `RABBITMQ_URL`, `OPENSEARCH_URL`) | `SESSION_SECRET`, `CRON_SECRET`, `PAYMENT_WEBHOOK_SECRET`, `GLITCHTIP_SECRET`, `DB_PASSWORD`, `POSTGRES_PASSWORD`, `RABBITMQ_PASS`, `OPENSEARCH_PASSWORD` |
| **VAPID**  | Gera par público/privado com `web-push` (as 3 chaves precisam combinar)                                                                      | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`                                                                                   |
| **MANUAL** | Não é gerável localmente — criar o novo valor no **painel do provedor** e colar no `.rotated`                                                | `SENTRY_AUTH_TOKEN`, `EVOLUTION_API_KEY`, `LYTEX_CLIENT_SECRET`, `GROQ_API_KEY`, `WHATSAPP_API_KEY`, `SMTP_PASS`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`        |

> **O script NUNCA altera o arquivo original.** Ele grava `<arquivo>.rotated`;
> o operador revisa o diff, aplica os valores manuais e faz o swap.

## 2. Procedimento Manual por Serviço Externo (MANUAL)

### Sentry (`SENTRY_AUTH_TOKEN`)

1. Acesse [sentry.io](https://sentry.io) → **Settings → Auth Tokens**.
2. **Create New Token** com scopes `project:releases`, `event:admin` (ou o escopo usado no deploy).
3. Atualize `SENTRY_AUTH_TOKEN` no `.env.production.rotated`.
4. Revogue o token antigo **depois** de validar o novo no deploy.

### Evolution API (`EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE`, `EVOLUTION_API_URL`)

1. Dashboard da Evolution → **Instância → API Key**.
2. **Regenerate API Key** → copie o novo valor.
3. Atualize `EVOLUTION_API_KEY` no `.rotated`; confira `EVOLUTION_INSTANCE` e `EVOLUTION_API_URL` (apontando para a instância correta).
4. Reinicie o worker/consumer que consome o webhook (`src/app/api/webhooks/evolution/route.ts`).

### Lytex (`LYTEX_CLIENT_ID`, `LYTEX_CLIENT_SECRET`)

1. Painel Lytex → **Credenciais da conta** (Client ID / Client Secret).
2. **Generate New Client Secret**.
3. Atualize `LYTEX_CLIENT_SECRET` no `.rotated` (mantenha `LYTEX_CLIENT_ID` se não mudou).
4. **Importante:** o webhook de pagamentos usa HMAC com `LYTEX_CLIENT_SECRET` — reconfigure o webhook no painel Lytex se a chave foi regenerada no lado deles.

### GROQ (`GROQ_API_KEY`)

1. [console.groq.com](https://console.groq.com) → **API Keys**.
2. **Create Key** → copie.
3. Atualize `GROQ_API_KEY` no `.rotated` e revogue a antiga.

### WhatsApp (`WHATSAPP_API_KEY`, `WHATSAPP_API_URL`)

1. Provedor WhatsApp/Evolution → **conexão → API Key**.
2. Gere uma nova key, atualize no `.rotated`, valide o envio de teste e revogue a antiga.

### SMTP (`SMTP_PASS`)

1. Provedor de e-mail (Gmail app password, Mailgun, etc.) → gere uma nova **senha de aplicativo / API key**.
2. Atualize `SMTP_PASS` no `.rotated`; rode `bun scripts/test-email.ts` para validar.

### S3 / MinIO (`S3_ACCESS_KEY`, `S3_SECRET_KEY`)

1. Console S3/MinIO → **Access Keys → Create Access Key**.
2. O provedor gera o par — copie ambos (o secret key só é mostrado uma vez).
3. Atualize `S3_ACCESS_KEY` + `S3_SECRET_KEY` no `.rotated` **juntos**.
4. Valide o upload (rota de fotos) e **depois** revogue o par antigo.

## 3. Rotação de Secrets com Impacto Específico

| Secret                              | Impacto da rotação                                                                                    | Mitigação                                                                                      |
| :---------------------------------- | :---------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------- |
| `SESSION_SECRET`                    | **Invalida TODAS as sessões ativas** (usuários são deslogados)                                        | Aplicar em janela de baixo tráfego                                                             |
| `VAPID_PRIVATE_KEY`                 | **Invalida todas as subscriptions push existentes** (browsers param de receber push até re-subscribe) | Enviar push de aviso antes; forçar re-registro do service worker                               |
| `DB_PASSWORD` / `POSTGRES_PASSWORD` | Queda de conexões ativas com o banco                                                                  | Aplicar junto com `DATABASE_URL`/`DIRECT_URL` (o script reescreve) e reiniciar app + pgbouncer |
| `RABBITMQ_PASS`                     | Consumers/queues caem até reconectar                                                                  | Atualizar também `RABBITMQ_URL` (script reescreve) e reiniciar consumers                       |

## 4. Checklist Pós-Rotação

- [ ] `bun run secrets:check` → exit 0 (nenhum `.env` rastreado)
- [ ] `.env.rotated` / `.env.production.rotated` revisados e swaps aplicados
- [ ] Valores MANUAIS colados dos painéis dos provedores
- [ ] `bun run build` OK com as novas envs
- [ ] `bun run db:push` / `db:migrate` OK (senha do banco nova)
- [ ] Teste de envio de email (`bun scripts/test-email.ts`)
- [ ] Teste de push notification (`bun scripts/test-push.ts`)
- [ ] Teste de upload S3 (fotos de perfil/serviço)
- [ ] Webhook Lytex respondendo 200 (HMAC com novo secret)
- [ ] Webhook Evolution roteando mensagens
- [ ] Histórico: se o repo for **público** ou houver risco de forks, reescrever o histórico com `git filter-repo`:
  ```bash
  git filter-repo --path .env --path .env.production --invert-paths --force
  ```
  (repo privado: rotação + untrack costuma ser suficiente, mas a rotação é **obrigatória** de qualquer forma)

## 5. Prevenção (Não Acontecer de Novo)

- [ ] `.gitignore` cobre `.env*` + `!.env.glitchtip.example` ✅
- [ ] CI guard `secrets:check` rodando no pipeline (ex.: `.github/workflows/pr-check.yml`)
- [ ] `.env.production` nunca mais criado na raiz — usar Docker secrets (`./secrets/*.secret` + `scripts/setup-secrets.sh`) ou o vault da plataforma de deploy
- [ ] Secrets expostos no histórico antigo considerados **comprometidos para sempre** (rotação obrigatória, não é opcional)
