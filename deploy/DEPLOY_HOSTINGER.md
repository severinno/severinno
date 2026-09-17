# Deploy para VPS Hostinger — Checklist

## Pré-Requisitos

- [ ] Acesso SSH ao VPS (root)
- [ ] Domínio registrado e acessível
- [ ] Repositório GitHub com código atualizado

---

## Fase 1: Setup do VPS

```bash
# No seu terminal local, copie o script para o VPS:
scp deploy/setup-vps.sh root@<IP_VPS>:/root/

# Conecte e execute:
ssh root@<IP_VPS>
bash /root/setup-vps.sh
```

- [ ] Script executou sem erros
- [ ] Docker + Docker Compose instalados
- [ ] Usuário `deploy` criado com acesso ao Docker
- [ ] Chave SSH gerada (copiada para o GitHub)
- [ ] Firewall configurado (22, 80, 443)
- [ ] Secrets gerados em `/home/deploy/severinno/secrets/`

---

## Fase 2: Configurar `.env.production`

```bash
ssh deploy@<IP_VPS>
cd /home/deploy/severinno
cp .env.example .env.production
nano .env.production
```

Valores obrigatórios:

- [ ] `NEXT_PUBLIC_APP_URL=https://severinno.com`
- [ ] `SESSION_SECRET` — gerado pelo setup script
- [ ] `DATABASE_URL=postgresql://severinno:<SENHA>@postgres:5432/severinno`
- [ ] `REDIS_URL=redis://redis:6379`
- [ ] `RABBITMQ_URL=amqp://severinno:<SENHA>@rabbitmq:5672`
- [ ] `S3_ENDPOINT=http://minio:9000`

> A `<SENHA>` do PostgreSQL está em `secrets/postgres_password.secret`
> A `<SENHA>` do RabbitMQ está em `secrets/rabbitmq_password.secret`

---

## Fase 3: GitHub Secrets

No GitHub → **Settings** → **Secrets and variables** → **Actions**:

- [ ] `DEPLOY_HOST` = IP público do VPS
- [ ] `DEPLOY_USER` = `deploy`
- [ ] `DEPLOY_KEY` = chave privada SSH (output do setup script)
- [ ] `DEPLOY_PATH` = `/home/deploy/severinno`

Variables:

- [ ] `BUN_VERSION` = `1.3.14`

---

## Fase 4: DNS

No painel do registrador do domínio:

- [ ] Registro `A` → `@` → `<IP_VPS>`
- [ ] Registro `A` → `www` → `<IP_VPS>`
- [ ] Propagação DNS concluída (`dig severinno.com +short`)

---

## Fase 5: Primeiro Deploy

```bash
ssh deploy@<IP_VPS>
cd /home/deploy/severinno

# Build e iniciar toda a stack
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build

# Verificar status
docker compose -f docker-compose.prod.yml ps

# Verificar logs da aplicação
docker compose -f docker-compose.prod.yml logs -f app

# Testar health check
curl http://localhost:3000/api/health
```

- [ ] Todos os containers running
- [ ] Health check retorna HTTP 200
- [ ] Caddy emitiu certificado HTTPS
- [ ] Site acessível via `https://severinno.com`

---

## Fase 6: Validar CI/CD Automático

```bash
# No seu terminal local:
echo "# deploy test" >> README.md
git add README.md
git commit -m "test: validate CI/CD pipeline"
git push origin main
```

- [ ] GitHub Actions disparou o workflow Deploy
- [ ] Build da imagem Docker concluído
- [ ] Push para GHCR concluído
- [ ] SSH deploy executou migrations
- [ ] Containers reiniciados
- [ ] Health check passou

---

## Troubleshooting

### Caddy não emite certificado

```bash
# Verificar logs do Caddy
docker compose -f docker-compose.prod.yml logs caddy

# Verificar se as portas 80/443 estão acessíveis externamente

curl -I http://<IP_VPS>
```

### Container app não inicia

```bash
# Ver logs detalhados
docker compose -f docker-compose.prod.yml logs --tail=50 app


# Entrar no container
docker compose -f docker-compose.prod.yml exec app sh
```

### Database connection refused

```bash
# Verificar se o PostgreSQL está running
docker compose -f docker-compose.prod.yml ps postgres

# Testar conexão
docker compose -f docker-compose.prod.yml exec postgres pg_isready
```
