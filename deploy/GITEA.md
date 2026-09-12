# =============================================================================

# GITEA.md — Guia de Instalacao e Configuracao do Gitea

# =============================================================================

# Gitea e uma alternativa open source ao GitHub, 100% self-hosted.

# Com Gitea Actions, voce tem CI/CD gratuito (compativel com GitHub Actions).

#

# Stack: Gitea 1.22 + Caddy (HTTPS) + Act Runner

# =============================================================================

## Arquitetura

```
Internet
    │
    ▼
┌─────────┐     ┌─────────┐     ┌──────────────┐
│  Caddy  │────▶│  Gitea  │────▶│ Act Runner   │
│  :443   │     │  :3000  │     │ (Docker)     │
│  (HTTPS)│     │  (Git)  │     └──────────────┘
└─────────┘     └─────────┘
     │
     └── HTTPS automatico (Let's Encrypt)
```

## Pre-requisitos

- VPS com Docker + Docker Compose instalados
- DNS `git.severinno.cloud` apontando para o IP do VPS
- Portas 80 e 443 abertas no firewall
- ~500MB de RAM livre

## Instalacao Rapida

### Opcao 1: Script Automatico (Recomendado)

```bash
# No VPS como root:
scp deploy/setup-gitea.sh root@<IP_VPS>:/root/
ssh root@<IP_VPS> bash /root/setup-gitea.sh
```

### Opcao 2: Manual

```bash
# Criar diretorio
mkdir -p /opt/gitea && cd /opt/gitea

# Copiar arquivos do repositorio
cp /home/deploy/severinno/deploy/Caddyfile.gitea /opt/gitea/Caddyfile
cp /home/deploy/severinno/deploy/docker-compose.gitea.yml /opt/gitea/docker-compose.yml
cp /home/deploy/severinno/deploy/.env.gitea.example /opt/gitea/.env

# Iniciar Gitea + Caddy
docker compose up -d gitea caddy
```

## Configuracao Inicial

### 1. Configurar DNS

No painel do registrador do dominio:

| Registro | Tipo | Valor         |
| -------- | ---- | ------------- |
| `git`    | A    | `<IP_DO_VPS>` |

Aguarde a propagacao DNS (pode levar ate 48h, geralmente <1h).

### 2. Criar Usuario Admin

1. Acesse: `https://git.severinno.cloud`
2. Preencha:
   - Username: `severinno`
   - Email: `admin@severinno.cloud`
   - Password: (use uma senha forte)
3. Clique em "Create Account"

### 3. Configurar Gitea Actions (Runner)

1. Va em: **Site Administration** → **Runner** → **Create new Runner**
2. Copie o token de registro
3. No VPS:

```bash
cd /opt/gitea
sed -i 's|COLE_O_TOKEN_AQUI|SEU_TOKEN_AQUI|' .env
docker compose up -d runner
```

### 4. Importar Repositorio do GitHub

1. Va em: **New Repository** → **Import Repository**
2. Selecione **Import from GitHub**
3. Cole o token do GitHub
4. Selecione o repositorio `severinno/severinno`
5. Aguarde a importacao completar

### 5. Configurar Secrets do Actions

No Gitea, va em: **Settings** → **Actions** → **Secrets**

Adicione:

| Secret        | Valor                    | Descricao                 |
| ------------- | ------------------------ | ------------------------- |
| `DEPLOY_HOST` | `<IP_DO_VPS>`            | Host do VPS               |
| `DEPLOY_USER` | `deploy`                 | Usuario SSH               |
| `DEPLOY_KEY`  | `(chave SSH privada)`    | Chave SSH para deploy     |
| `DEPLOY_PATH` | `/home/deploy/severinno` | Caminho do projeto no VPS |

### 6. Copiar Secrets do GitHub para o Gitea

Para que o CI/CD funcione igual ao GitHub, copie estes secrets:

| Secret GitHub | Secret Gitea  | Valor                    |
| ------------- | ------------- | ------------------------ |
| `DEPLOY_HOST` | `DEPLOY_HOST` | IP do VPS                |
| `DEPLOY_USER` | `DEPLOY_USER` | `deploy`                 |
| `DEPLOY_KEY`  | `DEPLOY_KEY`  | Chave SSH privada        |
| `DEPLOY_PATH` | `DEPLOY_PATH` | `/home/deploy/severinno` |

## Workflow CI/CD

O pipeline esta em `.gitea/workflows/ci.yml` e faz:

1. **Lint** → ESLint
2. **Repo Guards** → invariantes do repositorio (node puro): manifesto dos
   required checks ↔ jobs reais, fonte unica do registry de imagens
   (`check:registry-source`), referencias workflow→script
   (`check:workflow-refs`), ausencia de `@ts-nocheck`, e **paridade de gates**
   com o espelho do GitHub (`check:forge-parity`)
3. **TypeCheck** → tsc --noEmit
4. **Test** → guard de PII + auto-prova do guard + vitest com PostgreSQL + Redis
5. **Build** → next build
6. **Deploy** → SSH no VPS para atualizar containers

O pipeline de deploy esta em `.gitea/workflows/deploy.yml`:

- Build da imagem Docker
- Push para o registry configurado (`vars.IMAGE_REGISTRY`)
- Migrate do banco de dados
- Deploy via SSH

### Registry de imagens (fonte unica)

O destino das imagens **nao** e hardcoded: vem de `IMAGE_REGISTRY`.

| Onde                     | Como                                                        |
| ------------------------ | ----------------------------------------------------------- |
| Workflows (Gitea/GitHub) | variable `IMAGE_REGISTRY` do repositorio; default `ghcr.io` |
| Compose da VPS           | `IMAGE_REGISTRY` / `IMAGE_NAMESPACE` no `.env.production`   |
| act local                | `--var IMAGE_REGISTRY=...` no `.actrc`                      |
| Woodpecker (arquivado)   | secret `image_registry`                                     |

Para usar o **registry OCI embutido** desta instancia (sem cota de GHCR):

```bash
docker login git.severinno.cloud          # uma vez, na VPS
# variable IMAGE_REGISTRY=git.severinno.cloud no repositorio
# e IMAGE_REGISTRY=git.severinno.cloud no .env.production
# secrets IMAGE_REGISTRY_USER / IMAGE_REGISTRY_TOKEN se o pacote for privado
```

O guard `bun run check:registry-source` falha se um `ghcr.io` solto voltar.

### Checks obrigatorios para merge

A lista e declarada em `ci/required-checks.json` e aplicada com
`node scripts/apply-required-checks.mjs --forge gitea` (dry-run por padrao;
`--apply` exige token com permissao de administracao). Os contextos exigidos sao
os `name:` dos jobs — hoje `Lint`, `Repo Guards`, `TypeCheck`, `Tests`, `Build`.
O guard `check:forge-parity` garante que um gate novo nao fique so em uma das
pipelines (GitHub x esta forja).

## Acesso

| Servico | URL                                   | Porta |
| ------- | ------------------------------------- | ----- |
| Web UI  | `https://git.severinno.cloud`         | 443   |
| SSH     | `ssh -p 2222 git@git.severinno.cloud` | 2222  |

## Comandos Uteis

```bash
# Ver logs do Gitea
docker logs gitea -f

# Ver logs do Caddy
docker logs caddy -f

# Ver logs do runner
docker logs gitea-runner -f

# Reiniciar tudo
cd /opt/gitea && docker compose restart

# Atualizar
cd /opt/gitea && docker compose pull && docker compose up -d

# Parar
cd /opt/gitea && docker compose down
```

## Seguranca

### HTTPS

HTTPS e automatico via Caddy + Let's Encrypt. O certificado e renovado automaticamente.

### Backup

```bash
# Backup do banco de dados
docker exec gitea sqlite3 /data/gitea/gitea.db ".backup /data/backup/gitea-$(date +%Y%m%d).db"

# Backup completo
tar -czf gitea-backup-$(date +%Y%m%d).tar.gz /opt/gitea/

# Backup dos dados do Gitea (inclui repositorios)
docker exec gitea tar -czf /tmp/gitea-data-backup.tar.gz /data
docker cp gitea:/tmp/gitea-data-backup.tar.gz ./backups/
```

### Firewall

```bash
# Portas necessarias
ufw allow 80/tcp    # HTTP (redireciona para HTTPS)
ufw allow 443/tcp   # HTTPS
ufw allow 2222/tcp  # SSH do Gitea
```

## Troubleshooting

### HTTPS nao funciona

1. Verifique se o DNS `git.severinno.cloud` aponta para o IP do VPS
2. Verifique se as portas 80 e 443 estao abertas
3. Verifique os logs do Caddy: `docker logs caddy -f`
4. Verifique se o Caddy conseguiu obter o certificado

### Runner nao conecta

```bash
# Verificar logs
docker logs gitea-runner

# Reiniciar runner
cd /opt/gitea && docker compose restart runner

# Verificar se o token esta correto no .env
cat /opt/gitea/.env
```

### Actions nao executam

1. Verifique se o runner esta online em **Site Administration** → **Runner**
2. Verifique se o workflow esta em `.gitea/workflows/`
3. Verifique os logs do runner: `docker logs gitea-runner -f`

### Erro de permissao

```bash
# Corrigir permissoes
docker exec gitea chown -R git:git /data/gitea
```

### Container nao inicia

```bash
# Ver logs detalhados
docker compose -f /opt/gitea/docker-compose.yml logs --tail=50 gitea

# Verificar se o SQLite esta corrompido
docker exec gitea sqlite3 /data/gitea/gitea.db "PRAGMA integrity_check;"
```

## Referencias

- [Documentacao do Gitea](https://docs.gitea.com)
- [Gitea Actions](https://docs.gitea.com/usage/actions/overview)
- [Caddy Documentation](https://caddyserver.com/docs)
- [Docker Compose](https://docs.docker.com/compose/)

## Proximos Passos

1. Instalar Gitea
2. Configurar DNS + HTTPS
3. Criar usuario admin
4. Configurar Runner
5. Importar repositorio
6. Configurar Secrets
7. Testar pipeline
8. Configurar backup automatico
