# 📋 Checklist de Deploy em Produção — Severinno v0.4.0

> Checklist completo para colocar o Severinno Marketplace em produção.
> Marque cada item conforme for concluído.

---

## 📊 Panorama Geral

```
┌──────────────────────────────────────────────────────────┐
│                    SEVERINNO PRODUCTION                   │
├──────────────────────────────────────────────────────────┤
│  Domínio:    severinno.com.br                            │
│  Subdomínios: www.severinno.com.br, glitchtip.severinno. │
│               com.br                                     │
│  Serviços:   17 containers | 3 perfis | 10 volumes       │
│  Secrets:    12 Docker secrets                           │
│  Backup:     PostgreSQL diário (retenção 30 dias)        │
│  Monitoria:  GlitchTip (Sentry self-hosted) + health     │
│               checks                                     │
│  CI/CD:      GitHub Actions (tag v*)                      │
└──────────────────────────────────────────────────────────┘
```

---

## 🔴 FASE 1 — GitHub (5 itens)

> **Tempo estimado:** 15 min
> **Responsável:** Quem tiver acesso admin ao repositório

| # | Item | ❓ Status | 📋 Como Fazer |
|:-:|:-----|:---------:|:--------------|
| 1.1 | 📦 **Criar repositório** `severinno/severinno` | 🔲 | `https://github.com/new` → Nome: `severinno` → **Private** |
| 1.2 | 🔑 **Adicionar chave SSH do VPS** | 🔲 | `Settings → SSH and GPG keys → New SSH key` |
| 1.3 | 🔐 **Configurar GitHub Secrets** | 🔲 | `Settings → Secrets and variables → Actions` |

| Secret | Valor | Obrigatório |
|:-------|:------|:-----------:|
| `DEPLOY_HOST` | IP do VPS | ✅ |
| `DEPLOY_USER` | Usuário SSH do VPS | ✅ |
| `DEPLOY_KEY` | Chave privada SSH | ✅ |
| `SENTRY_AUTH_TOKEN` | Token de autenticação (source maps) | ❌ Opcional |
| `SENTRY_ORG` | Organização no Sentry | ❌ Opcional |
| `SENTRY_PROJECT` | Projeto no Sentry | ❌ Opcional |

| # | Item | ❓ Status | 📋 Como Fazer |
|:-:|:-----|:---------:|:--------------|
| 1.4 | 🚀 **Push do release branch + tag** | 🔲 | `git push origin release/v0.4.0 --tags` |
| 1.5 | 🤖 **CI/CD acionado automaticamente** | 🔲 | `Actions` → workflow `Release & Deploy` |

---

## 🟠 FASE 2 — Servidor VPS (11 itens)

> **Tempo estimado:** 30 min
> **Acessar:** `ssh root@<IP_DO_VPS>`

### 📦 Requisitos Mínimos

| Recurso | Mínimo | Recomendado |
|:--------|:------:|:-----------:|
| **vCPU** | 2 | 4 |
| **RAM** | 4 GB | 8 GB |
| **SSD** | 50 GB | 100 GB |
| **SO** | Ubuntu 24.04 LTS | Ubuntu 24.04 LTS |
| **Docker** | 24+ | 27+ |

### 📋 Passo a Passo

```bash
# ── Conectar ──────────────────────────────────────────────
ssh root@<IP_DO_VPS>

# ── 2.1: SO atualizado ───────────────────────────────────
apt update && apt upgrade -y

# ── 2.2: Docker + Docker Compose ─────────────────────────
curl -fsSL https://get.docker.com | sh
systemctl enable docker

# ── 2.3: Firewall (UFW) ──────────────────────────────────
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp       # SSH
ufw allow 80/tcp       # HTTP
ufw allow 443/tcp      # HTTPS
ufw --force enable

# ── 2.4: Fail2ban ────────────────────────────────────────
apt install fail2ban -y

# ── 2.5: Dependências ────────────────────────────────────
apt install git curl jq postgresql-client -y

# ── 2.6: Git + Clone ─────────────────────────────────────
ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519 -N ""
cat ~/.ssh/id_ed25519.pub
# → Adicione a chave acima no GitHub: Settings → SSH Keys

ssh -T git@github.com
# → Hi severinno! You've successfully authenticated...

git clone git@github.com:severinno/severinno.git
cd severinno
git checkout release/v0.4.0

# ── 2.7: Fail2ban config ────────────────────────────────
mkdir -p /etc/fail2ban/filter.d
cp config/fail2ban/jail.local /etc/fail2ban/
cp config/fail2ban/filter.d/*.conf /etc/fail2ban/filter.d/
systemctl restart fail2ban

# ── 2.8: Logrotate ───────────────────────────────────────
cp config/logrotate/caddy /etc/logrotate.d/caddy
logrotate -d /etc/logrotate.d/caddy   # dry-run (verificar)

# ── 2.9: Diretório de logs ───────────────────────────────
mkdir -p /var/log/caddy
mkdir -p /var/backups/severinno/postgres
```

> 💡 **Dica:** Salve estes comandos como um script: `scripts/setup-vps.sh`

---

## 🟡 FASE 3 — Secrets e Config (13 itens)

> **Tempo estimado:** 20 min
> **Local:** Diretório `~/severinno/secrets/` no VPS

### 🔐 Gerar Todos os Secrets

```bash
cd ~/severinno

# Copiar templates
for f in secrets/*.example; do
  cp "$f" "${f%.example}"
done

# Gerar senhas aleatórias
openssl rand -base64 32 > secrets/postgres_password.secret
openssl rand -base64 32 > secrets/session_secret.secret
openssl rand -base64 32 > secrets/rabbitmq_pass.secret
openssl rand -base64 32 > secrets/s3_secret_key.secret
openssl rand -base64 32 > secrets/cron_secret.secret
openssl rand -base64 32 > secrets/lytex_client_secret.secret
openssl rand -base64 32 > secrets/glitchtip_db_password.secret
openssl rand -base64 32 > secrets/glitchtip_s3_secret_key.secret
openssl rand -base64 32 > secrets/glitchtip_secret_key.secret
```

### 🔑 Secrets que Precisam de Input Manual

| # | Secret | Como Gerar | Importante |
|:-:|:-------|:-----------|:-----------|
| 3.10 | 🔐 `vapid_private_key.secret` | `npx web-push generate-vapid-keys` | Guardar **private key** + **public key** para `.env` |
| 3.11 | 🔐 `smtp_pass.secret` | Senha SMTP do provedor de email | Mailtrap, SendGrid, AWS SES, etc. |
| 3.12 | 🔐 `evolution_api_key.secret` | Painel Evolution API | Se usar WhatsApp |

### 📄 Configurar `.env` de Produção

```bash
# Copiar template
cp .env.production .env.production.local

# Preencher TODAS as variáveis
nano .env.production.local

# Verificar vars obrigatórias (checar se não tem <MUDE_AQUI>)
grep -n "<MUDE_AQUI>" .env.production.local || echo "✅ Todas preenchidas!"
```

📖 **Variáveis obrigatórias no `.env.production.local`:**

| Categoria | Variável | Exemplo | Fonte |
|:----------|:---------|:--------|:------|
| **Domínio** | `NEXT_PUBLIC_APP_URL` | `https://severinno.com.br` | Domínio |
| **Domínio** | `NEXT_PUBLIC_SITE_URL` | `https://severinno.com.br` | Domínio |
| **Domínio** | `NEXT_PUBLIC_WS_URL` | `wss://severinno.com.br` | Domínio |
| **Banco** | `DATABASE_URL` | `postgresql://severinno@pgbouncer:6432/severinno` | Via PgBouncer |
| **Banco** | `DIRECT_URL` | `postgresql://severinno@postgres:5432/severinno` | Direto (Prisma Migrate) |
| **VAPID** | `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | `BC...` | `secrets/vapid_private_key.secret` |
| **GlitchTip** | `SENTRY_DSN` | `https://key@glitchtip.severinno.com.br/id` | Após setup do GlitchTip |
| **S3** | `S3_ENDPOINT` | `http://minio:9000` | Interno (MinIO) |
| **RabbitMQ** | `RABBITMQ_URL` | `amqp://severinno:pass@rabbitmq:5672` | `secrets/rabbitmq_pass.secret` |

---

## 🟢 FASE 4 — DNS (3 itens)

> **Tempo estimado:** 5 min (propagação: até 24h)
> **Local:** Painel do provedor de domínio (registro.br, Cloudflare, etc.)

| # | Item | Tipo | TTL | Valor |
|:-:|:-----|:----:|:---:|:------|
| 4.1 | 🌐 **Domínio principal** | `A` | 300s | `IP_DO_VPS` |
| 4.2 | 🌐 **Subdomínio www** | `CNAME` | 300s | `severinno.com.br` |
| 4.3 | 🌐 **Subdomínio GlitchTip** | `A` | 300s | `IP_DO_VPS` |

```
severinno.com.br.       A     300   <IP_DO_VPS>
www.severinno.com.br.   CNAME 300   severinno.com.br.
glitchtip.severinno     A     300   <IP_DO_VPS>
```

> ⚠️ **Importante:** O Caddy obtém certificados SSL automaticamente assim que o DNS propagar. A propagação pode levar de 5 min a 24h.

---

## 🔵 FASE 5 — Deploy (6 itens)

> **Tempo estimado:** 30 min
> **Após:** Fase 1, 2, 3, 4 concluídas

### Opção A — Deploy Manual (recomendado na 1ª vez)

```bash
cd ~/severinno

# ── 5.1: Build da imagem ─────────────────────────────────
docker compose -f docker-compose.prod.yml build app

# ── 5.2: Subir serviços core ────────────────────────────
docker compose -f docker-compose.prod.yml up -d postgres redis minio rabbitmq
docker compose -f docker-compose.prod.yml up -d pgbouncer
docker compose -f docker-compose.prod.yml up -d caddy

# ── 5.3: Rodar migrations ───────────────────────────────
docker compose -f docker-compose.prod.yml run --rm app \
  bunx prisma migrate deploy

# ── 5.4: Subir app + realtime ───────────────────────────
docker compose -f docker-compose.prod.yml up -d app realtime
docker compose -f docker-compose.prod.yml up -d email-worker notification-worker search-index-worker

# ── 5.5: Subir GlitchTip (opcional) ─────────────────────
docker compose -f docker-compose.prod.yml --profile glitchtip \
  --env-file .env.glitchtip up -d

# ── 5.6: Verificar health ───────────────────────────────
curl -s http://localhost:3000/api/health/detailed | jq .
```

### Opção B — Deploy via CI/CD (após configurar GitHub Secrets)

O workflow `.github/workflows/release-deploy.yml` é acionado automaticamente ao fazer push de uma tag `v*`:

```bash
git tag v0.4.0
git push origin v0.4.0
```

**Pipeline:**
1. ✅ UTF-8 check (paralelo)
2. ✅ Quality gate (paralelo)
3. ✅ Lint (paralelo)
4. ✅ TypeCheck (paralelo)
5. ✅ Tests + Coverage badge (paralelo)
6. ✅ Docker build & push para GHCR
7. ✅ DB migrations no VPS (via SSH)
8. ✅ Deploy (pull + restart containers)

---

## 🟣 FASE 6 — Pós-Deploy (8 itens)

> **Tempo estimado:** 30 min
> **Após:** Deploy concluído e serviços rodando

### 6.1 — Verificar SSL

```bash
# Certificado SSL ativo?
curl -sI https://severinno.com.br | grep -i "strict-transport-security"

# Nota SSL via API (pode levar alguns minutos)
# https://www.ssllabs.com/ssltest/analyze.html?d=severinno.com.br
```

**HSTS preload (opcional, recomendado antes do go-live público):**

```bash
# Verificação pré-submissão (exit 0 = apto a submeter)
bash scripts/verify-hsts-preload.sh --ci
```

- [ ] `verify-hsts-preload.sh --ci` → exit 0 para **todos** os hosts
- [ ] `www.severinno.com.br` emite HSTS idêntico (CDN Hostinger — apontar para o apex se não emitir)
- [ ] Submeter em https://hstspreload.org/ — processo completo em `docs/HSTS-PRELOAD.md`

### 6.2 — Verificar Security Headers

```bash
curl -sI https://severinno.com.br | grep -E "^(strict|content-security|x-|permissions|referrer)"
```

Esperado:
```
strict-transport-security: max-age=31536000; includeSubDomains; preload
x-content-type-options: nosniff
x-frame-options: DENY
content-security-policy: default-src 'self'; ...
permissions-policy: camera=(), microphone=(), geolocation=(self)
referrer-policy: strict-origin-when-cross-origin
```

### 6.3 — Configurar GlitchTip

```bash
cd ~/severinno

# Criar admin
bash scripts/glitchtip-setup.sh create-admin

# Criar projeto + obter DSN
bash scripts/glitchtip-setup.sh create-project

# Adicionar DSN ao .env.production.local:
#   SENTRY_DSN=https://<KEY>@glitchtip.severinno.com.br/<ID>
#   NEXT_PUBLIC_SENTRY_DSN=https://<KEY>@glitchtip.severinno.com.br/<ID>

# Reiniciar app
docker compose -f docker-compose.prod.yml up -d app
```

### 6.4 — Configurar Backup Automático

```bash
# Adicionar cron job
(crontab -l 2>/dev/null; echo "0 3 * * * /opt/severinno/scripts/backup-db.sh --cron >> /var/log/severinno-backup.log 2>&1") | crontab -

# Testar backup manual
bash scripts/backup-db.sh
```

### 6.5 — Verificar Todos os Serviços

```bash
# Healthcheck detalhado (via Docker)
docker compose -f docker-compose.prod.yml ps

# Healthcheck via API (requer app rodando)
curl -s http://localhost:3000/api/health/detailed | jq .

# Ver logs de cada serviço
docker compose -f docker-compose.prod.yml logs --tail=30 app
docker compose -f docker-compose.prod.yml logs --tail=30 caddy
docker compose -f docker-compose.prod.yml logs --tail=30 pgbouncer
```

### 6.6 — Verificar Fail2ban

```bash
# Status de todos os jails
fail2ban-client status

# Verificar se os jails estão ativos
fail2ban-client status sshd
fail2ban-client status caddy-access
fail2ban-client status caddy-badbots
fail2ban-client status caddy-404-scan
fail2ban-client status caddy-glitchtip
fail2ban-client status recidive
```

### 6.7 — Testar Notificações Push

```bash
# Testar push via API
curl -X POST http://localhost:3000/api/push/test \
  -H "Content-Type: application/json" \
  -d '{"title":"Teste Produção","body":"Notificação de teste via CLI"}'
```

### 6.8 — Verificar Logrotate

```bash
# Simular rotação (dry-run)
logrotate -d /etc/logrotate.d/caddy

# Forçar rotação (teste)
logrotate -f /etc/logrotate.d/caddy
```

---

## ⚫ FASE 7 — Monitoramento Contínuo (7 itens)

> **Tempo estimado:** Contínuo
> **Após:** Deploy em produção

| # | Item | Ferramenta | Como Verificar |
|:-:|:-----|:-----------|:---------------|
| 7.1 | 📊 **Dashboard admin** | `/admin` no app | Status dos serviços, push analytics, performance |
| 7.2 | 🔥 **Error tracking** | GlitchTip | `glitchtip.severinno.com.br` |
| 7.3 | 💾 **Backups** | Cron + pg_dump | `ls -lah /var/backups/severinno/postgres/` |
| 7.4 | 📝 **Logs do Caddy** | fail2ban | `tail -f /var/log/caddy/severinno-access.log` |
| 7.5 | 🔐 **SSL renovação** | Automático (Caddy) | Certificates em `/data/caddy` |
| 7.6 | 🐳 **Docker health** | Healthchecks | `docker ps --format "table {{.Names}}\t{{.Status}}"` |
| 7.7 | 📈 **Recursos** | `htop`, `df -h` | CPU, RAM, disco |

---

## 📋 Resumo Visual do Stack

```
┌─────────────────────────────────────────────────────────────┐
│                       INTERNET                               │
│                       :80 :443                               │
└────────────────────────┬────────────────────────────────────┘
                         │
┌────────────────────────┴────────────────────────────────────┐
│                        CADDY                                 │
│              (proxy reverso + SSL automático)                 │
├─────────────┬──────────────┬────────────────┬───────────────┤
│  /socket.io │  /api/*      │  /*            │ glitchtip.*   │
├─────────────┼──────────────┼────────────────┼───────────────┤
│   Realtime  │    App       │    App         │  GlitchTip     │
│   :3003     │   :3000      │   :3000        │  :8000         │
└──────┬──────┴──────┬───────┴───────┬────────┴───────┬───────┘
       │             │               │                │
┌──────┴──────┐ ┌────┴────┐ ┌───────┴───────┐ ┌──────┴──────┐
│  RabbitMQ   │ │  Redis  │ │   PgBouncer    │ │   MinIO     │
│  :5672      │ │ :6379   │ │   :6432        │ │  :9000      │
└──────┬──────┘ └─────────┘ └───────┬───────┘ └─────────────┘
       │                            │
┌──────┴──────┐           ┌────────┴────────┐
│   Workers   │           │   PostgreSQL    │
│  (3 perfis) │           │   :5432         │
└─────────────┘           └─────────────────┘
```

---

## 📊 Estimativa de Recursos

| Serviço | vCPU | RAM | Disco |
|:--------|:----:|:---:|:-----:|
| Caddy | 0.5 | 256 MB | ~1 GB (logs) |
| PostgreSQL | 1.0 | 1 GB | Dados + backup |
| PgBouncer | 0.5 | 256 MB | — |
| Redis | 0.5 | 256 MB | — |
| RabbitMQ | 0.5 | 512 MB | — |
| MinIO | 0.5 | 512 MB | ~5 GB (S3) |
| App (Next.js) | 1.0 | 1 GB | — |
| Realtime | 0.5 | 256 MB | — |
| 3 Workers | 1.5 | 768 MB | — |
| **Core total** | **~6.5** | **~4.8 GB** | **~6 GB** |
| GlitchTip stack | 2.0 | 2 GB | ~2 GB |
| **Total c/ GlitchTip** | **~8.5** | **~6.8 GB** | **~8 GB** |

> 💡 **Recomendação:** VPS com **4 vCPU / 8 GB RAM / 100 GB SSD** para rodar tudo com GlitchTip.

---

## 🔄 Rollback

### Se algo der errado no deploy:

```bash
# 1. Identificar versão anterior estável
docker images | grep severinno

# 2. Subir versão anterior
docker compose -f docker-compose.prod.yml up -d app:anterior

# 3. Se for banco, restaurar backup
bash scripts/backup-db.sh --restore /var/backups/severinno/postgres/severinno-db_20240101_030000.sql.gz

# 4. Reverter tag no GitHub (se necessário)
git tag -d v0.4.0
git push origin :refs/tags/v0.4.0
```

---

## ✅ Checklist Final

> Marque todos antes de considerar o deploy concluído.

```
🔴 GITHUB
   [ ] 1.1 Repositório criado (severinno/severinno)
   [ ] 1.2 Chave SSH do VPS adicionada
   [ ] 1.3 GitHub Secrets configurados (DEPLOY_HOST, USER, KEY)
   [ ] 1.4 Push do release/v0.4.0 + tag v0.4.0
   [ ] 1.5 CI/CD acionado (Actions)

🟠 VPS
   [ ] 2.1 SO atualizado
   [ ] 2.2 Docker + Compose instalados
   [ ] 2.3 Firewall configurado (22, 80, 443)
   [ ] 2.4 Fail2ban instalado + configurado
   [ ] 2.5 Dependências (git, curl, jq, pg_dump)
   [ ] 2.6 Git clone + checkout release/v0.4.0
   [ ] 2.7 Fail2ban filters copiados + restart
   [ ] 2.8 Logrotate configurado
   [ ] 2.9 Diretórios de log e backup criados

🟡 SECRETS
   [ ] 3.1 Templates copiados (.example → sem extensão)
   [ ] 3.2 postgres_password.secret
   [ ] 3.3 session_secret.secret
   [ ] 3.4 rabbitmq_pass.secret
   [ ] 3.5 s3_secret_key.secret
   [ ] 3.6 vapid_private_key.secret (mais VAPID keys no .env)
   [ ] 3.7 smtp_pass.secret
   [ ] 3.8 cron_secret.secret
   [ ] 3.9 lytex_client_secret.secret
   [ ] 3.10 glitchtip_db_password.secret
   [ ] 3.11 glitchtip_s3_secret_key.secret
   [ ] 3.12 glitchtip_secret_key.secret
   [ ] 3.13 evolution_api_key.secret (opcional)
   [ ] 3.14 .env.production.local preenchido

🟢 DNS
   [ ] 4.1 severinno.com.br → A → IP do VPS
   [ ] 4.2 www.severinno.com.br → CNAME
   [ ] 4.3 glitchtip.severinno.com.br → A → IP do VPS

🔵 DEPLOY
   [ ] 5.1 Docker images buildadas
   [ ] 5.2 Serviços core rodando (postgres, redis, minio, rabbitmq)
   [ ] 5.3 PgBouncer configurado
   [ ] 5.4 Migrations executadas
   [ ] 5.5 App + realtime rodando
   [ ] 5.6 Workers rodando (email, notification, search-index)
   [ ] 5.7 Caddy com SSL ativo
   [ ] 5.8 Healthcheck passando (200 OK)

🟣 PÓS-DEPLOY
   [ ] 6.1 SSL/HSTS verificados
   [ ] 6.2 Security Headers verificados (CSP, HSTS, etc.)
   [ ] 6.3 GlitchTip configurado (admin + projeto + DSN)
   [ ] 6.4 Backup automático configurado (cron)
   [ ] 6.5 Status de todos os serviços OK
   [ ] 6.6 Fail2ban ativo em todos os jails
   [ ] 6.7 Push notifications testadas
   [ ] 6.8 Logrotate funcionando

⚫ MONITORAMENTO
   [ ] 7.1 Dashboard admin acessível (/admin)
   [ ] 7.2 GlitchTip recebendo erros
   [ ] 7.3 Backup rodando diariamente
   [ ] 7.4 Logs do Caddy sendo rotacionados
   [ ] 7.5 SSL renovando automaticamente
   [ ] 7.6 Healthchecks periódicos OK
   [ ] 7.7 Recursos monitorados (CPU, RAM, disco)
```

---

> **Total: 43 itens** | ⏱️ **Tempo estimado total: ~2h + 24h propagação DNS**
>
> ⚡ **Próximo passo:** Adquirir o VPS e começar pela Fase 2!
