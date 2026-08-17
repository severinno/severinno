# Deployment Guide — Severinno Marketplace

> Guia completo para deploy em produção do Severinno Marketplace.
> Stack: Docker Compose + Caddy (SSL automático) + PostgreSQL + Redis + RabbitMQ.
> Última atualização: 2026-07-28 | Versão: v0.4.0

## Pré-requisitos

- **Servidor:** Linux (Ubuntu 24.04 LTS recomendado)
- **Docker:** 24+ com Docker Compose v2
- **Domínio:** severinno.com.br (com DNS apontando para o servidor)
- **Portas:** 80 (HTTP) e 443 (HTTPS) abertas no firewall

### Instalação Rápida

```bash
# Atualizar sistema
apt update && apt upgrade -y

# Instalar Docker
curl -fsSL https://get.docker.com | bash

# Verificar instalação
docker --version && docker compose version
```

---

## Estrutura de Arquivos

```bash
/opt/severinno/
├── docker-compose.prod.yml      # Orquestração de produção
├── Caddyfile.prod                # Configuração do Caddy (SSL + headers)
├── .env.production               # Variáveis de ambiente (NUNCA commitar)
├── secrets/                      # Docker secrets (montados em /run/secrets/)
│   ├── postgres_password.secret
│   ├── session_secret.secret
│   ├── s3_secret_key.secret
│   ├── vapid_private_key.secret
│   ├── rabbitmq_pass.secret
│   ├── smtp_pass.secret
│   ├── cron_secret.secret
│   └── lytex_client_secret.secret
├── scripts/
│   ├── docker-entrypoint.sh      # Entrypoint que lê secrets
│   └── setup-secrets.sh          # Gera secrets aleatórios
├── config/
│   └── pgbouncer/
│       └── pgbouncer.ini         # Config do pooler de conexões
└── prisma/
    └── migrations/               # Migrations do banco
```

---

## 1. Configurar Ambiente

### 1.1 Variáveis de Ambiente

Copie o template e preencha:

```bash
cp .env.production.example .env.production
nano .env.production
```

**Variáveis OBRIGATÓRIAS:**

```env
# App
NEXT_PUBLIC_APP_URL=https://severinno.com.br
SESSION_SECRET=<min 32 caracteres, gerar com: openssl rand -hex 32>

# Database
POSTGRES_PASSWORD=<gerar senha forte>
DATABASE_URL=postgresql://severinno:<POSTGRES_PASSWORD>@pgbouncer:6432/severinno

# Cache
REDIS_URL=redis://redis:6379

# Queue
RABBITMQ_PASS=<gerar senha forte>
RABBITMQ_URL=amqp://severinno:<RABBITMQ_PASS>@rabbitmq:5672

# Storage (MinIO)
S3_ACCESS_KEY=severinno
S3_SECRET_KEY=<gerar chave forte>
S3_BUCKET=severinno-uploads
S3_ENDPOINT=http://minio:9000
S3_PUBLIC_URL=https://s3.severinno.com.br

# Web Push (VAPID)
VAPID_PUBLIC_KEY=<gerar com: npx web-push generate-vapid-keys>
VAPID_PRIVATE_KEY=<chave privada>
NEXT_PUBLIC_VAPID_PUBLIC_KEY=<mesmo valor de VAPID_PUBLIC_KEY>

# Error Monitoring
NEXT_PUBLIC_GLITCHTIP_DSN=https://<key>@glitchtip.severinno.com.br/<id>

# CRON
CRON_SECRET=<gerar secreto>

# Lytex (Pagamentos)
LYTEX_CLIENT_ID=<id do painel Lytex>
LYTEX_CLIENT_SECRET=<secret do painel Lytex>
PAYMENT_WEBHOOK_SECRET=<secret para webhook>
```

### 1.2 Docker Secrets

```bash
# Setup automático (gera secrets aleatórios para valores não preenchidos)
./scripts/setup-secrets.sh

# Ou manualmente:
echo "minha-senha-forte-aqui" > secrets/postgres_password.secret
echo "meu-session-secret-32-caracteres-minimo" > secrets/session_secret.secret
# ... preencher todos os .secret
```

---

## 2. Deploy Inicial

```bash
# 1. Clone o repositório
git clone https://github.com/severinno/severinno.git /opt/severinno
cd /opt/severinno

# 2. Configure secrets e env
./scripts/setup-secrets.sh
nano .env.production  # Preencher variáveis

# 3. Baixar imagens mais recentes
docker compose -f docker-compose.prod.yml --env-file .env.production pull

# 4. Iniciar todos os serviços
docker compose -f docker-compose.prod.yml --env-file .env.production up -d

# 5. Verificar status
docker compose -f docker-compose.prod.yml ps

# 6. Ver logs iniciais
docker compose -f docker-compose.prod.yml logs --tail=50
```

### Primeiro Acesso

```bash
# Aguardar Caddy obter certificado SSL (1-2 min)
# Acessar: https://severinno.com.br
# Verificar health: https://severinno.com.br/api/health/detailed
```

---

## 3. Database Migrations

```bash
# Executar migrations no banco de produção
docker compose -f docker-compose.prod.yml exec app npx prisma migrate deploy

# Verificar status
docker compose -f docker-compose.prod.yml exec app npx prisma migrate status
```

---

## 4. Gerenciamento de Serviços

### Comandos Úteis

```bash
# Status de todos os serviços
docker compose -f docker-compose.prod.yml ps

# Logs em tempo real
docker compose -f docker-compose.prod.yml logs -f

# Logs de serviço específico
docker compose -f docker-compose.prod.yml logs -f app
docker compose -f docker-compose.prod.yml logs -f caddy
docker compose -f docker-compose.prod.yml logs -f postgres

# Reiniciar serviço
docker compose -f docker-compose.prod.yml restart app

# Atualizar imagem e reiniciar
docker compose -f docker-compose.prod.yml pull app
docker compose -f docker-compose.prod.yml up -d app

# Parar tudo
docker compose -f docker-compose.prod.yml down
```

### Workers (Processamento em Background)

```bash
# Workers são iniciados automaticamente via docker-compose.prod.yml
# Verificar consumidores ativos via RabbitMQ:
# Acessar http://severinno.com.br:15672 (admin:severinno)

# Ou via health check:
curl https://severinno.com.br/api/health/detailed | jq '.services[] | select(.name=="workers")'
```

---

## 5. Atualização (Zero Downtime)

```bash
# 1. Baixar nova imagem
docker compose -f docker-compose.prod.yml pull app

# 2. Reiniciar app (Caddy faz graceful shutdown)
docker compose -f docker-compose.prod.yml up -d --no-deps app

# 3. Executar migrations (se houver)
docker compose -f docker-compose.prod.yml exec app npx prisma migrate deploy

# 4. Verificar health
curl https://severinno.com.br/api/health
```

---

## 6. Backup e Restore

### PostgreSQL

```bash
# Backup manual
docker exec -t severinno-postgres-1 pg_dump -U severinno severinno > backup_$(date +%Y%m%d).sql

# Restore
cat backup.sql | docker exec -i severinno-postgres-1 psql -U severinno severinno
```

### Backup Automático (pgbackup)

O docker-compose.prod.yml inclui um perfil `backup` que executa backups diários:

```bash
docker compose --profile backup up -d pgbackup
```

### Redis

```bash
# Backup (RDB snapshot)
docker exec severinno-redis-1 redis-cli SAVE
cp /volume/redis_data/dump.rdb ./backup_redis_$(date +%Y%m%d).rdb
```

---

## 7. Monitoramento

### Health Check

Endpoint: `GET /api/health/detailed`

Retorna status de 10 serviços:

| Serviço   |  Criticidade  | O que verifica                 |
| :-------- | :-----------: | :----------------------------- |
| app       |  🔴 Crítica   | Processo rodando, PID, memória |
| database  |  🔴 Crítica   | `SELECT 1` via Prisma          |
| redis     | 🟡 Degradável | PING                           |
| rabbitmq  | 🟡 Degradável | Conexão, filas, consumidores   |
| pgbouncer | 🟡 Degradável | Conexão via pooler             |
| realtime  | 🟡 Degradável | Healthcheck HTTP               |
| minio     | 🟡 Degradável | Healthcheck live               |
| caddy     | 🟡 Degradável | Healthcheck interno :8080      |
| disk      |    🟡 Info    | Memória RSS/Heap               |
| workers   |    🟡 Info    | Consumidores RabbitMQ ativos   |

### Prometheus / OpenMetrics

```bash
curl https://severinno.com.br/api/health/detailed?format=prometheus
# Retorna métricas no formato OpenMetrics para scrape direto
```

### Error Monitoring (GlitchTip)

- **URL:** https://glitchtip.severinno.com.br
- **Configurado em:** `sentry.client.config.ts` + `sentry.server.config.ts`
- **Alertas:** GlitchTip pode enviar alertas via webhook ou email

### Logs

```bash
# Logs do Caddy (para fail2ban)
/var/log/caddy/access.log
/var/log/caddy/error.log

# Logs do Docker
docker compose -f docker-compose.prod.yml logs --tail=100 app
```

---

## 8. Segurança em Produção

### fail2ban (Recomendado)

```ini
# /etc/fail2ban/jail.local
[caddy-proxy]
enabled = true
port = http,https
filter = caddy-auth
logpath = /var/log/caddy/access.log
maxretry = 10
bantime = 3600

[caddy-botsearch]
enabled = true
port = http,https
filter = caddy-botsearch
logpath = /var/log/caddy/access.log
maxretry = 5
bantime = 86400
```

### Firewall (UFW)

```bash
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 22/tcp    # SSH
ufw deny 2019       # Caddy admin (não expor)
ufw enable
```

---

## 9. Troubleshooting

### SSL Certificate Issues

```bash
# Verificar status do certificado
docker compose -f docker-compose.prod.yml exec caddy caddy cert-info severinno.com.br

# Forçar renovação
docker compose -f docker-compose.prod.yml exec caddy caddy renew --force
```

### Database Connection Issues

```bash
# Verificar PgBouncer
docker compose -f docker-compose.prod.yml logs pgbouncer

# Conectar direto no PostgreSQL
docker exec -it severinno-postgres-1 psql -U severinno severinno

# Verificar conexões ativas
SELECT count(*) FROM pg_stat_activity;
```

### App Not Starting

```bash
# Verificar logs
docker compose -f docker-compose.prod.yml logs app --tail=100

# Verificar healthcheck
docker compose -f docker-compose.prod.yml ps app
```
