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

## Os labels do runner: a comparação (`runner-labels:check:github`)

Os labels do runner auto-hospedado **não ficam em arquivo nenhum** no host: o
`.runner` do `actions/runner` guarda `agentId`/`agentName`/`poolName`/`serverUrl`
— e nenhum label. Eles vivem no **servidor**, mandados no `config.sh --labels`.
É por isso que um runner re-registrado à mão (ou um host restaurado de backup, ou
um `config.sh` sem `--labels`) continua funcionando e **ninguém percebe**: o
workflow que pede um label que sumiu não falha — ele **espera para sempre**, e o
que já existe continua verde.

O guard compara as duas pontas e é o mesmo comando da forja, com `--forge`:

```bash
# o DECLARADO sai de deploy/setup-github-runner.sh (RUNNER_LABELS/RUNNER_NAME/REPO_URL)
# o REGISTRADO sai da API: recomenda-se um PAT com scope `repo` (ou fine-grained com
# 'Self-hosted runners: read' NO REPOSITÓRIO) — o GITHUB_TOKEN de um run não serve
# o REPO sai do REPO_URL do script (ou de --gh-repo); com o script sem REPO_URL, o
# canal é GH_REPOSITORY — o GITHUB_REPOSITORY do ambiente NÃO é lido (num runner da
# Gitea ele aponta para o repositório da forja, e a consulta seria do repo errado)
export GITHUB_TOKEN="<pat>"
bun run runner-labels:check:github
# 0 provado · 1 registro velho/vazio/runner ausente ou offline · 2 env/uso · 3 não provado
```

Estados e o que fazer:

| Desfecho                    | O que significa                                                                                           | Remédio                                                                      |
| :-------------------------- | :-------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------- |
| **0** provado               | o registro tem os labels do script (case-insensitive)                                                     | —                                                                            |
| **1** label faltando/a mais | um `runs-on` que pede o label que sumiu fica esperando; um label a mais é resíduo de um `config.sh` à mão | `bash deploy/setup-github-runner.sh` (registra com `--replace`)              |
| **1** registro VAZIO        | runner órfão: existe no painel e nenhum job é atribuído a ele                                             | re-registre (mesmo comando)                                                  |
| **1** runner ausente        | o nome declarado não está registrado (renomeado/removido)                                                 | re-registre, ou corrija `RUNNER_NAME`                                        |
| **1** OFFLINE               | registrado mas não conectado — é a causa do "no runner available"                                         | `sudo systemctl restart actions.runner.*` e `journalctl -u actions.runner.*` |
| **3** não provado           | sem token (escopo de self-hosted runners) ou API fora                                                     | exporte `GITHUB_TOKEN` e rode onde a API é alcançável                        |

O rótulo `self-hosted` e os read-only (`Linux`, `X64`) são normalizados em caixa
pelo próprio GitHub: o guard compara **case-insensitive**, porque um alarme falso
é o que ensina a ignorar o guard. O `doctor` carrega este mesmo fato no veredito
de prontidão (e `--no-runner-labels` pula os registros das duas forjas).

### A versão do runner: o `version` do registro × o `RUNNER_VERSION` do script

O mesmo comando compara a **terceira ponta** do registro. O payload da API
devolve, por runner, o campo `version`: é a versão que o **serviço aceitou** (o
runner se atualiza sozinho para ela). O `RUNNER_VERSION` de
`deploy/setup-github-runner.sh` é o **pin** que este repositório declara, e os dois
têm de casar.

**MEDIDO em 22/09/2026:** com o pin em `2.320.0` o runner **registrou, pegou o
primeiro job e se auto-atualizou para `2.337.0` no MEIO dele**. O update derruba o
worker, o job fica **preso** em `in_progress` segurando o único runner — e o cancel
do run e o remove do runner respondem `422 "is currently running a job"`, então só
`force-cancel` + DELETE do run limpam a atribuição. A forja fica **parada**, não
vermelha. O `version` do registro é legível na própria API, e é ele que o pin tem
de casar:

```bash
gh api repos/<owner>/<repo>/actions/runners --jq '.runners[] | {name,status,version}'
```

| Desfecho                  | O que significa                                                                                           | Remédio                                                                       |
| :------------------------ | :-------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------- |
| **0** versão = pin        | o registro responde a mesma versão que o script pina                                                      | —                                                                             |
| **1** versão ≠ pin        | o serviço **recusou o pin**: o runner se auto-atualiza no meio do primeiro job e o job fica **preso**     | alinhe `RUNNER_VERSION` à versão que o serviço aceita e **então** re-registre |
| **3** `no-pin` / `unread` | o script não declara o pin, ou a API não devolveu o campo `version` (nenhum dos dois vira "em sincronia") | declare o `RUNNER_VERSION`, ou rode onde a API devolve o registro completo    |

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
