# Configurar Secrets do Hostinger no GitHub

## Variaveis Necessarias

### Secrets (Dados Sensiveis)

| Nome                | Valor                                              | Descricao                 |
| ------------------- | -------------------------------------------------- | ------------------------- |
| `HOSTINGER_API_KEY` | `mxmnWRspFwyhbQZwHGLnTfRr41InhVbTQyZ4PvQX2e1795d2` | Chave de API do Hostinger |

### Variables (Nao Sensiveis)

| Nome              | Valor     | Descricao              |
| ----------------- | --------- | ---------------------- |
| `HOSTINGER_VM_ID` | `1917826` | ID do VPS no Hostinger |

## Como Configurar

1. Acesse o repositorio no GitHub
2. Va em **Settings** -> **Secrets and variables** -> **Actions**
3. Clique em **New repository secret** para adicionar:
   - Name: `HOSTINGER_API_KEY`
   - Secret: `mxmnWRspFwyhbQZwHGLnTfRr41InhVbTQyZ4PvQX2e1795d2`
4. Clique em **New repository variable** para adicionar:
   - Name: `HOSTINGER_VM_ID`
   - Value: `1917826`

## Verificar Configuracao

Apos configurar, faca um push para `main` e verifique se o workflow `Deploy to Hostinger` foi acionado em **Actions**.

## Servicos Incluidos

O deploy inclui todos os servicos de producao:

- Caddy (Reverse Proxy + SSL)
- PostgreSQL + PostGIS
- Redis
- RabbitMQ
- MinIO (S3)
- PgBouncer (Connection Pooler)
- Realtime (WebSocket)
- App (Next.js)
- Email Worker
- Notification Worker

## Variaveis de Ambiente

As variaveis de ambiente sao configuradas via `.env.production` no VPS. Certifique-se de que o arquivo existe em `/home/deploy/severinno/.env.production` com todos os valores necessarios.

Consulte o arquivo `deploy/STAGING.md` para mais detalhes sobre as variaveis de ambiente.
