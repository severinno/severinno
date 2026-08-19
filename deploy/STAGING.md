# 🚀 Severinno Marketplace — Staging Deployment Guide

## Pré-requisitos

- Docker + Docker Compose v2
- Acesso ao registry de imagens (GHCR)
- Variáveis de ambiente configuradas (`.env.staging`)

## Setup Rápido

```bash
# 1. Clonar e configurar
git clone https://github.com/severinno/severinno.git
cd severinno
git checkout main

# 2. Configurar variáveis de ambiente
cp deploy/staging.env.example .env.staging
# Editar .env.staging com valores reais

# 3. Configurar secrets
cp secrets/*.secret.example secrets/*.secret
# Preencher valores nos arquivos .secret

# 4. Build e deploy
docker compose -f docker-compose.staging.yml --env-file .env.staging build
docker compose -f docker-compose.staging.yml --env-file .env.staging up -d

# 5. Verificar saúde
docker compose -f docker-compose.staging.yml ps
curl -f http://localhost:3000/api/health
```

## Verificação Pós-Deploy

```bash
# 1. Health check
curl -s http://localhost:3000/api/health | jq .

# 2. Métricas Prometheus
curl -s http://localhost:3000/api/metrics/prometheus | head -20

# 3. Logs
docker compose -f docker-compose.staging.yml logs -f app

# 4. Testes E2E (opcional)
npx playwright test e2e/payment-flow.spec.ts --project=chromium
```

## Rollback

```bash
# Parar todos os serviços
docker compose -f docker-compose.staging.yml down

# Revert para versão anterior
git checkout <previous-commit>
docker compose -f docker-compose.staging.yml --env-file .env.staging build
docker compose -f docker-compose.staging.yml --env-file .env.staging up -d
```

## Monitoramento

### Grafana (se habilitado)

```bash
# Iniciar stack de monitoramento
docker compose -f docker-compose.monitoring.yml up -d

# Acessar Grafana
open http://localhost:3001
# Login: admin/admin
```

### Logs Estruturados

```bash
# Logs com request ID
docker compose -f docker-compose.staging.yml logs app | grep requestId

# Erros apenas
docker compose -f docker-compose.staging.yml logs app | grep '"level":50'
```

## Variáveis Críticas

| Variável              | Descrição                          | Obrigatória |
| --------------------- | ---------------------------------- | ----------- |
| `DATABASE_URL`        | Conexão PostgreSQL                 | ✅          |
| `REDIS_URL`           | Conexão Redis                      | ✅          |
| `SESSION_SECRET`      | Segredo das sessões (min 32 chars) | ✅          |
| `LYTEX_CLIENT_ID`     | ID do cliente Lytex                | ✅          |
| `LYTEX_CLIENT_SECRET` | Segredo do cliente Lytex           | ✅          |
| `SENTRY_DSN`          | DSN do Sentry/GlitchTip            | ❌          |

## Troubleshooting

### App não inicia

```bash
# Verificar logs
docker compose -f docker-compose.staging.yml logs app

# Verificar variáveis
docker compose -f docker-compose.staging.yml exec app env | grep DATABASE
```

### Database connection refused

```bash
# Verificar PgBouncer
docker compose -f docker-compose.staging.yml logs pgbouncer

# Verificar PostgreSQL
docker compose -f docker-compose.staging.yml logs postgres
```

### Redis connection refused

```bash
# Verificar Redis
docker compose -f docker-compose.staging.yml logs redis

# Testar conexão
docker compose -f docker-compose.staging.yml exec redis redis-cli ping
```
