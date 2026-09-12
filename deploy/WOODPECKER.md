# Woodpecker CI — Setup Completo

> ## ⚠️ STATUS: AVALIADO E ARQUIVADO — NÃO É O CAMINHO ADOTADO
>
> A forja/CI escolhida é **Gitea/Forgejo Actions** (`.gitea/workflows/`), porque
> reaproveita a sintaxe dos 26 workflows que já existem. O Woodpecker usa um
> modelo de configuração **diferente**: adotá-lo exigiria reescrever todos eles,
> pagando meses de tradução sem ganhar capacidade nova.
>
> Este documento fica como registro da alternativa avaliada. **Dois pontos do
> rascunho `.woodpecker.yml` não rodam como escritos** (ver o header do arquivo):
> `plugins/docker` está descontinuado (use `woodpeckerci/plugin-docker-buildx`) e
> `appleboy/ssh-action` é um GitHub Action, não um plugin Woodpecker.
>
> **Se o Woodpecker for retomado, corrija primeiro a Etapa 1 abaixo:** ela manda
> criar um **OAuth App no GitHub** e configurar `WOODPECKER_GITHUB_CLIENT`. Isso
> contradiz o objetivo da migração — o login deve usar **OAuth do Gitea/Forgejo**
> (o Woodpecker é forge-agnóstico e suporta Gitea/Forgejo nativamente), senão a
> "alternativa open source" continua dependendo do GitHub para autenticar.

## Visão Geral

Woodpecker CI é uma ferramenta de CI/CD **100% open source** (Apache 2.0) que roda no seu próprio VPS. É uma alternativa gratuita ao GitHub Actions para repositórios privados.

---

## Pré-Requisitos

1. **Docker** instalado no VPS
2. **Conta GitHub** com acesso ao repositório
3. **Domínio ou IP** para acessar o Woodpecker

---

## Etapa 1: Criar OAuth App no GitHub

1. Acesse: `https://github.com/settings/developers`
2. Clique em **"New OAuth App"**
3. Preencha:
   - **Application name:** `Severinno CI`
   - **Homepage URL:** `http://severinno.cloud:8000`
   - **Authorization callback URL:** `http://severinno.cloud:8000/api/auth`
4. Clique em **"Register application"**
5. Copie o **Client ID**
6. Clique em **"Generate a new client secret"**
7. Copie o **Client Secret**

---

## Etapa 2: Configurar no VPS

1. Conecte ao VPS:

   ```bash
   ssh root@severinno.cloud
   ```

2. Execute o script de instalação:

   ```bash
   curl -sSL https://raw.githubusercontent.com/severinno/severinno/main/deploy/setup-woodpecker.sh | bash
   ```

3. Configure o arquivo `.env`:

   ```bash
   nano /opt/woodpecker/.env
   ```

4. Preencha:

   ```
   WOODPECKER_HOST=http://severinno.cloud:8000
   WOODPECKER_GITHUB_CLIENT=SEU_CLIENT_ID
   WOODPECKER_GITHUB_SECRET=SEU_CLIENT_SECRET
   WOODPECKER_AGENT_SECRET=SEU_AGENT_SECRET
   ```

5. Inicie o Woodpecker:
   ```bash
   cd /opt/woodpecker && docker compose up -d
   ```

---

## Etapa 3: Acessar e Configurar

1. Acesse: `http://severinno.cloud:8000`
2. Clique em **"Login with GitHub"**
3. Autorize o acesso
4. Vá em **"Repos"** e ative o repositório `severinno/severinno`

---

## Etapa 4: Configurar Secrets no Woodpecker

No painel do Woodpecker, vá em **"Secrets"** e adicione:

| Nome            | Valor             | Descrição                                      |
| --------------- | ----------------- | ---------------------------------------------- |
| `ghcr_username` | `severinno`       | Usuário do GHCR                                |
| `ghcr_token`    | `ghp_...`         | Token do GitHub com permissão `write:packages` |
| `deploy_host`   | `severinno.cloud` | IP ou domínio do VPS                           |
| `deploy_user`   | `deploy`          | Usuário SSH do VPS                             |
| `deploy_key`    | `-----BEGIN...`   | Chave privada SSH                              |

---

## Comandos Úteis

```bash
# Ver logs do servidor
docker logs -f woodpecker-server

# Ver logs do agent
docker logs -f woodpecker-agent

# Reiniciar
cd /opt/woodpecker && docker compose restart

# Parar
cd /opt/woodpecker && docker compose down

# Atualizar
cd /opt/woodpecker && docker compose pull && docker compose up -d
```

---

## Troubleshooting

### Woodpecker não inicia

- Verifique os logs: `docker logs woodpecker-server`
- Verifique se o OAuth App está configurado corretamente
- Verifique se a porta 8000 está aberta no firewall

### Pipeline não roda

- Verifique se o repositório está ativado no Woodpecker
- Verifique se os secrets estão configurados
- Verifique se o agent está conectado

### Erro de autenticação

- Verifique o Client ID e Client Secret
- Verifique se o callback URL está correto
- Verifique se o usuário tem acesso ao repositório

---

## Segurança

- O Woodpecker roda com Docker isolamento
- Secrets são armazenados de forma segura
- Agent roda com acesso mínimo ao Docker

---

## Custos

- **Woodpecker CI:** $0 (open source)
- **VPS:** Custo fixo mensal do Hostinger
- **Manutenção:** Atualizações manuais via Docker

---

## Referências

- [Documentação Woodpecker](https://woodpecker-ci.org/)
- [GitHub OAuth Apps](https://github.com/settings/developers)
- [Docker Compose](https://docs.docker.com/compose/)
