# GitHub Actions Self-Hosted Runner

## Visão Geral

O Self-Hosted Runner permite rodar workflows do GitHub Actions **no seu próprio VPS**, eliminando custos de minutos do GitHub Actions.

---

## Pré-Requisitos

1. **GitHub Personal Access Token (PAT)**
2. **Docker instalado no VPS**
3. **Acesso SSH ao VPS**

---

## Etapa 1: Criar Personal Access Token (PAT)

1. Acesse: `https://github.com/settings/tokens`
2. Clique em **"Generate new token (classic)"**
3. Dê um nome: `hostinger-runner`
4. Selecione permissões:
   - ✅ `repo` (full control)
   - ✅ `admin:repo_hook`
   - ✅ `workflow`
5. Clique em **"Generate token"**
6. **Copie o token** (não será mostrado novamente!)

---

## Etapa 2: Instalar Runner no VPS

1. Conecte ao VPS via SSH:

   ```bash
   ssh deploy@severinno.cloud
   ```

2. Baixe e execute o script de instalação:

   ```bash
   curl -sSL https://raw.githubusercontent.com/severinno/severinno/main/deploy/setup-github-runner.sh | sudo bash
   ```

3. Cole o PAT quando solicitado

4. Aguarde a instalação completar

---

## Etapa 3: Verificar no GitHub

1. Acesse: `https://github.com/severinno/severinno/settings/actions/runners`
2. O runner deve aparecer como **"Online"**
3. Nome: `hostinger-runner`
4. Labels: `self-hosted, linux, x64, docker`

---

## Comandos Úteis

```bash
# Ver status do runner
sudo systemctl status actions.runner.*.service

# Reiniciar runner
sudo systemctl restart actions.runner.*.service

# Ver logs
sudo journalctl -u actions.runner.*.service -f

# Parar runner
sudo systemctl stop actions.runner.*.service
```

---

## Troubleshooting

### Runner não aparece no GitHub

- Verifique se o token está correto
- Verifique se o VPS tem acesso à internet (porta 443)
- Reinicie o serviço: `sudo systemctl restart actions.runner.*.service`

### Workflow falha com "no runner available"

- Verifique se o runner está online no GitHub
- Verifique se os labels estão corretos
- Verifique se o runner está com espaço em disco

### Docker não funciona no runner

- Verifique se o usuário `github-runner` está no grupo docker
- Reinicie o runner após adicionar ao grupo

---

## Segurança

- O runner roda como **usuário não-root** (`github-runner`)
- O token é armazenado em arquivo seguro com permissões restritas
- O Docker socket é montado com acesso controlado

---

## Custos

- **GitHub Actions:** $0 (runner roda no seu VPS)
- **VPS:** Custo fixo mensal do Hostinger
- **Manutenção:** Atualizações manuais do runner

---

## Atualizar Runner

Para atualizar o runner para a versão mais recente:

```bash
# Parar runner
sudo systemctl stop actions.runner.*.service

# Baixar nova versão
cd /home/github-runner/actions-runner
sudo -u github-runner curl -L -o actions-runner-linux-x64.tar.gz \
  https://github.com/actions/runner/releases/latest/download/actions-runner-linux-x64.tar.gz

# Extrair
sudo -u github-runner tar xzf actions-runner-linux-x64.tar.gz

# Reiniciar
sudo systemctl start actions.runner.*.service
```
