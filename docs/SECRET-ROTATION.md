# Rotação de Segredos — Vazamento no Histórico do Git

> **Status:** 🔴 EM AÇÃO — `.env` e `.env.production` estiveram trackeados no
> repositório e foram **removidos do index** (`git rm --cached`), mas **os
> valores permanecem em TODO o histórico do git** — incluindo commits já
> enviados para o remoto (`github.com/severinno/severinno`). Remover do index
> NÃO purga o histórico: **a rotação é a única correção real**.

---

## 1. O que vazou (arquivos + commits)

| Arquivo | Commits no histórico | Contexto |
|---|---|---|
| `.env.production` | `d547476` (release v0.4.0), `db69205` | Segredos de **produção** completos |
| `.env` (dev) | `7604f33` (Initial), `7026f0e`, `695d983`, `1dc893a`, `4fdfec6`, `e30b691`, `4cfbbbc`, `db69205` | Segredos de **dev** (evoluíram ao longo do tempo) |

Remediado no working tree (já aplicado):
- `git rm --cached .env .env.production` → fora do index, **mantidos no disco**.
- `.gitignore` linha 34 (`.env*`) já cobre ambos — confirmado via
  `git check-ignore -v` e `git add -n` (ignored). Nenhuma mudança no `.gitignore`.

> ⚠️ **Pendente:** o commit com os `D` staged ainda não foi feito. Após
> commitar, considere **reescrita de histórico** (`git filter-repo`/BFG +
> force-push) — só efetiva se o repo não tiver forks/clones antigos e exige
> coordenação com o time (invalida SHAs de todos os clones).

---

## 2. LISTA DE ROTAÇÃO (segredos que vazaram no histórico)

> Regra: **qualquer segredo que apareceu em QUALQUER commit deve ser
> rotacionado**, mesmo que o valor atual no `.env` seja diferente — quem tem
> acesso ao histórico (repo público, ex-colaboradores, CI logs antigos) pode
> recuperar o valor antigo.
>
> 🔴 ROTACIONAR (segredos de verdade):

| Variável | Onde vive | O que rotacionar |
|---|---|---|
| `DB_PASSWORD` / `POSTGRES_PASSWORD` | Postgres (dev + prod) | Nova senha do banco; atualizar `DATABASE_URL`/`DIRECT_URL` |
| `DATABASE_URL` / `DIRECT_URL` | Prisma | Regenerar URL completa com a nova senha (a URL antiga embute a senha vazada) |
| `REDIS_URL` | Redis | Se embutir senha — trocar credencial + URL |
| `RABBITMQ_PASS` / `RABBITMQ_URL` | RabbitMQ | Nova senha do broker + URL |
| `OPENSEARCH_PASSWORD` / `OPENSEARCH_URL` | OpenSearch | Nova senha do cluster; se a URL embutir `user:pass`, regenerar a URL completa |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | S3/MinIO (uploads) | Par de chaves novo (IAM/MinIO) |
| `SESSION_SECRET` | Auth (assinatura de sessão) | Novo segredo → invalida todas as sessões |
| `CRON_SECRET` | Jobs agendados | Novo segredo de autenticação de cron |
| `PAYMENT_WEBHOOK_SECRET` | Webhooks Lytex | Nova chave de assinatura de webhook |
| `LYTEX_CLIENT_SECRET` | Integração Lytex (pagamentos) | Regenerar client secret no painel Lytex |
| `SMTP_PASS` | E-mail transacional | Nova senha/app-password do provedor SMTP |
| `VAPID_PRIVATE_KEY` | Push notifications (web-push) | Regenerar par de chaves VAPID → atualizar TAMBÉM `NEXT_PUBLIC_VAPID_PUBLIC_KEY` e re-registrar subscriptions |
| `GROQ_API_KEY` (dev) | LLM (dev) | Nova chave no painel Groq |
| `WHATSAPP_API_KEY` (dev) | Evolução/WhatsApp (dev) | Nova chave da API |
| `EVOLUTION_API_KEY` (prod) | Evolução/WhatsApp (prod) | Nova chave da API |
| `GLITCHTIP_SECRET` (dev) | GlitchTip (dev) | Nova chave |
| `SENTRY_AUTH_TOKEN` | Upload de source maps | Novo token de auth (nunca commitar) |
| `SENTRY_DSN` / `GLITCHTIP_DSN` / `NEXT_PUBLIC_SENTRY_DSN` / `NEXT_PUBLIC_GLITCHTIP_DSN` | Error monitoring | Regenerar DSN no GlitchTip (a chave embutida no DSN vazou) |

🟡 NÃO ROTACIONAR (público por design / não-segredo):
`NEXT_PUBLIC_*` (exceto DSNs acima), `VAPID_PUBLIC_KEY`, `S3_BUCKET`, `S3_REGION`,
`S3_ENDPOINT`, `S3_PUBLIC_URL`, `POSTGRES_USER`, `POSTGRES_DB`, `OPENSEARCH_USERNAME`,
`SMTP_HOST/PORT/USER/FROM`, URLs de serviço (`OSRM_BASE_URL`, `LYTEX_BASE_URL`,
`REALTIME_URL`, `NEXT_PUBLIC_WS_URL`), `NODE_ENV`, `LOG_LEVEL`, `PORT`,
`BATCH_SIZE`, `POLL_INTERVAL_MS`, `MAX_UPLOAD_SIZE`, `SENTRY_ORG/PROJECT/RELEASE`.

---

## 3. Procedimento de rotação (ordem recomendada)

1. **Banco de dados primeiro** (maior risco de exfiltração): nova senha
   Postgres → atualizar `DATABASE_URL`/`DIRECT_URL`/`DB_PASSWORD` no
   `.env.production` (no servidor) e no secret store do CI.
2. **Redis/RabbitMQ/OpenSearch**: trocar credenciais + URLs.
3. **S3/MinIO**: rotacionar par de chaves (operação reversível, testar uploads).
4. **Integrações externas** (Lytex, SMTP, Groq, WhatsApp/Evolução, GlitchTip/Sentry):
   regenerar em cada painel de fornecedor.
5. **Segredos do app**: `SESSION_SECRET` (logout geral), `CRON_SECRET`,
   `PAYMENT_WEBHOOK_SECRET`, `VAPID_PRIVATE_KEY` (regenerar par + re-registrar
   push subscriptions).
6. **Atualizar .env.production no servidor** e todos os secrets de CI
   (GitHub Actions secrets) — nunca commitar os novos valores.
7. **Validar:** `docker compose -f docker-compose.prod.yml config` +
   `scripts/test-security-headers.sh` + smoke test do checkout/push.

---

## 4. Pós-rotação (prevenção de reincidência)

- [ ] Commit do `git rm --cached .env .env.production` (D staged, pendente).
- [ ] (Opcional) Reescrita de histórico com `git filter-repo --path .env --path .env.production --invert-paths` + force-push (apenas se sem forks/clones antigos).
- [ ] Confirmar visibilidade do repo no GitHub (privado?) e checar se há
      forks/stargazers que tenham copiado a história.
- [ ] Verificar `git log --all -- .env*` para garantir que nenhum outro
      env/segredo foi commitado no passado (ex.: `.env.local`).
- [ ] Scan periódico com gitleaks/trufflehog no CI (pre-commit + PR) para
      nunca mais commitar segredos.
- [ ] `src/lib/env.ts` (schema Zod) já valida vars — manter `.env.example`
      e `.env.glitchtip.example` sincronizados SEM valores (ambos trackeados,
      templates com placeholders — seguros para permanecer).

---

## 5. Referências

- [GitHub — Removing sensitive data from a repository](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository)
- [git filter-repo](https://github.com/newren/git-filter-repo)
- [OWASP — Secrets Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html)
- [Gitleaks](https://github.com/gitleaks/gitleaks) (scan de segredos no CI)
