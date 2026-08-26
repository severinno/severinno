# Self-hosted GitHub Actions Runner

Runner self-hosted com Docker-in-Docker para o repo `severinno/severinno`.

## Por que?

O repo é **privado** e os GitHub-hosted runners estão em fila (limite de minutos
mensais do plano gratuito). Um runner self-hosted elimina:
- Fila de espera (runs iniciam imediatamente)
- Limite de minutos mensais
- Restrições de permissão do GITHUB_TOKEN

## Setup

### 1. Gerar registration token

```bash
gh api -X POST repos/severinno/severinno/actions/runners/registration-token --jq '.token'
```

### 2. Configurar o token

```bash
cd .github/runner
cp .env.example .env
# Edite .env com o token gerado
```

### 3. Iniciar o runner

```bash
docker compose up -d
```

### 4. Verificar status

```bash
docker compose logs -f runner
# Procurar por: "Listening for jobs"
```

Ou via API:
```bash
gh api repos/severinno/severinno/actions/runners --jq '.runners[] | {name, status, labels}'
```

## Labels disponíveis

O runner registra com as labels:
- `self-hosted`
- `linux`
- `x64`
- `docker`

Use nos workflows:
```yaml
runs-on: [self-hosted, docker]
```

## Arquitetura

```
┌─────────────────────────────────────┐
│  severinno-runner (myoung34/...)    │
│  ┌─────────────────────────────┐    │
│  │  Runner process             │    │
│  │  (executa workflow steps)   │    │
│  └──────────────┬──────────────┘    │
│                 │ DOCKER_HOST=tcp   │
├─────────────────┼───────────────────┤
│  severinno-dind (docker:27-dind)   │
│  ┌──────────────┴──────────────┐    │
│  │  Docker daemon (privileged) │    │
│  │  docker build/push/run      │    │
│  └─────────────────────────────┘    │
└─────────────────────────────────────┘
```

## Manutenção

### Atualizar o runner
```bash
docker compose pull
docker compose up -d
```

### Parar o runner
```bash
docker compose down
```

### Ver logs
```bash
docker compose logs -f runner
docker compose logs -f dind
```

## Segurança

- O runner roda em container isolado (não afeta o host)
- Docker-in-Docker é `privileged` (necessário para Docker daemon)
- O token de registro expira em 1h e é válido para 1 uso
- Labels limitam quais workflows podem usar o runner
