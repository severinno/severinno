# 🔐 Docker Secrets — Severinno

Este diretório gerencia segredos de produção para o Severinno Marketplace usando **Docker Secrets**.

## Estrutura

```
secrets/
├── .gitignore                            # Ignora *.secret, permite *.example
├── README.md                             # Este arquivo
├── postgres_password.secret.example      ← Template (versionado)
├── postgres_password.secret              ← Valor real (NÃO versionado)
├── session_secret.secret.example
├── session_secret.secret
├── ...                                   # Outros secrets
```

- Arquivos `*.secret.example` — templates com placeholders, **versionados no git**
- Arquivos `*.secret` — valores reais, **ignorados pelo git** (via `.gitignore`)

## Setup rápido (Docker Compose)

```bash
# 1. Copie todos os templates
for f in secrets/*.example; do
  cp "$f" "${f%.example}"
done

# 2. Preencha os valores reais
nano secrets/postgres_password.secret
nano secrets/session_secret.secret
# ... repita para cada secret

# 3. Suba os serviços
docker compose -f docker-compose.prod.yml --env-file .env.production up -d
```

## Setup em produção (Docker Swarm)

```bash
# 1. Copie os templates e preencha os valores
for f in secrets/*.example; do
  cp "$f" "${f%.example}"
done
nano secrets/postgres_password.secret
# ... preencha todos

# 2. Use o script de setup
./scripts/setup-secrets.sh

# 3. Verifique os secrets criados
./scripts/setup-secrets.sh --list

# 4. Faça o deploy da stack
docker stack deploy -c docker-compose.prod.yml severinno
```

## Como funciona

1. **Docker Compose (file:)** — os secrets são montados em `/run/secrets/<nome>` dentro do container
2. **Entrypoint customizado** (`scripts/docker-entrypoint.sh`) — lê `/run/secrets/*`, exporta como env vars, e reconstrói URLs de conexão
3. **Serviços com suporte nativo a `_FILE`** (PostgreSQL, RabbitMQ, MinIO) — usam `*_FILE: /run/secrets/<nome>` diretamente

### Serviços que usam o entrypoint

| Serviço | Secrets montados |
|---------|-----------------|
| app | postgres_password, rabbitmq_pass, s3_secret_key, session_secret, vapid_private_key, smtp_pass, cron_secret, lytex_client_secret, realtime_emit_token |
| email-worker | postgres_password, rabbitmq_pass, smtp_pass |
| notification-worker | postgres_password, rabbitmq_pass, vapid_private_key |
| realtime | session_secret, realtime_emit_token (via `_FILE`) |

### Serviços com suporte nativo a `_FILE`

| Serviço | Secret | Variável |
|---------|--------|----------|
| postgres | postgres_password | `POSTGRES_PASSWORD_FILE` |
| rabbitmq | rabbitmq_pass | `RABBITMQ_DEFAULT_PASS_FILE` |
| minio | s3_secret_key | `MINIO_ROOT_PASSWORD_FILE` |
| glitchtip-db | glitchtip_db_password | `POSTGRES_PASSWORD_FILE` |
| glitchtip-minio | glitchtip_s3_secret_key | `MINIO_ROOT_PASSWORD_FILE` |

### ⚠️ Limitação: GlitchTip (imagens third-party)

Os serviços `glitchtip-web`, `glitchtip-worker` e `glitchtip-migrate` usam a imagem oficial `glitchtip/glitchtip:v5.2` (Django). Como são imagens third-party, **não usam o entrypoint customizado**.

Para esses serviços, as senhas ainda são passadas via interpolação do Docker Compose no `.env.glitchtip`:

```env
GLITCHTIP_DB_PASSWORD=...
GLITCHTIP_SECRET_KEY=...
```

Isso é uma limitação conhecida. A longo prazo, podemos:
- Fazer fork da imagem e adicionar suporte a `_FILE` ou entrypoint
- Usar Docker Swarm configs + env_file gerado dinamicamente
- Migrar para Sentry SaaS (sem self-hosting)

## Lista completa de secrets

| Secret | Serviços que usam | Template |
|--------|-------------------|----------|
| `postgres_password` | postgres, app, workers | `postgres_password.secret.example` |
| `session_secret` | app | `session_secret.secret.example` |
| `s3_secret_key` | minio, app | `s3_secret_key.secret.example` |
| `vapid_private_key` | app, notification-worker | `vapid_private_key.secret.example` |
| `smtp_pass` | app, email-worker | `smtp_pass.secret.example` |
| `lytex_client_secret` | app | `lytex_client_secret.secret.example` |
| `cron_secret` | app | `cron_secret.secret.example` |
| `realtime_emit_token` | app, realtime | `realtime_emit_token.secret.example` |
| `rabbitmq_pass` | rabbitmq, app, workers | `rabbitmq_pass.secret.example` |
| `evolution_api_key` | notification-worker | `evolution_api_key.secret.example` |
| `glitchtip_db_password` | glitchtip-db | `glitchtip_db_password.secret.example` |
| `glitchtip_s3_secret_key` | glitchtip-minio | `glitchtip_s3_secret_key.secret.example` |
| `glitchtip_secret_key` | ⚠️ NÃO montado como secret (imagem third-party — use .env.glitchtip) | `glitchtip_secret_key.secret.example` |

## Boas práticas

- **Nunca commite** arquivos `*.secret` (o `.gitignore` já bloqueia)
- **Gere senhas fortes**: `openssl rand -base64 32`
- **Rotacione periodicamente**: atualize o `.secret` e re-deploy
- **Não use o mesmo secret** em múltiplos ambientes (dev/staging/prod)
- **Mantenha backups** offline dos valores dos secrets

## Troubleshooting

### "docker-compose config" reclama de variável não definida

As variáveis `${POSTGRES_PASSWORD}` etc. no `docker-compose.prod.yml` são interpolação do Compose e resultam em string vazia em produção — **isso é esperado**. O entrypoint reconstrói as URLs com os valores reais dos secrets.

Para silenciar os warnings, você pode definir defaults:

```env
POSTGRES_PASSWORD=resolved-via-secret
S3_SECRET_KEY=resolved-via-secret
# ...
```

### Container não sobe — "secret not found"

Verifique se:
1. O arquivo `.secret` existe no caminho correto
2. O arquivo não é `.example` (que é ignorado)
3. O nome do secret no `secrets:` do compose corresponde ao nome do arquivo

### Secret montado, mas app não reconhece

Verifique se:
1. O entrypoint está configurado: `entrypoint: ["./scripts/docker-entrypoint.sh"]`
2. O volume do entrypoint está montado: `- ./scripts/docker-entrypoint.sh:/app/scripts/docker-entrypoint.sh:ro`
3. O secret está listado em `secrets:` para aquele serviço
