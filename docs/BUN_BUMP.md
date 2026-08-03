# Bun Version Bump — Severinno Marketplace

> Procedimento completo e auditável para trocar a versão do Bun no CI — da
> repository variable até a validação dos guards. A versão do Bun vive em **um
> único lugar** (`vars.BUN_VERSION`); este documento cobre os 3 passos de
> execução (variável, `.actrc`, mirrors GHCR) e o que o guard verifica.
> Última atualização: 2026-08-02 | Referência: README → [Bun Toolchain](../README.md#bun-toolchain--fonte-única-repository-variable-bun_version)

## Sumário

1. [Princípio: fonte única (`vars.BUN_VERSION`)](#1-princípio-fonte-única-varsbun_version)
2. [Pré-requisitos](#2-pré-requisitos)
3. [Procedimento passo a passo](#3-procedimento-passo-a-passo)
4. [O que NÃO precisa ser editado](#4-o-que-não-precisa-ser-editado)
5. [O que o guard verifica (`check-bun-mirror.mjs`)](#5-o-que-o-guard-verifica-check-bun-mirrormjs)
6. [Aviso semanal de drift (`actrc-sync`)](#6-aviso-semanal-de-drift-actrc-sync)
7. [Troubleshooting](#7-troubleshooting)
8. [Checklist final de auditoria](#8-checklist-final-de-auditoria)

---

## 1. Princípio: fonte única (`vars.BUN_VERSION`)

A versão pinada do Bun é a **repository variable** `BUN_VERSION`
(Settings → Secrets and variables → Actions). Trocar o Bun = alterar a variável
em **um lugar** — nada de editar 40+ ocorrências. Todos os consumidores
derivam dela:

| Consumidor                              | Como lê a versão                                                                 |
| --------------------------------------- | -------------------------------------------------------------------------------- |
| Workflows (`bun-version:` no setup-bun) | `${{ vars.BUN_VERSION }}`                                                        |
| Cache keys `bun-`/`prisma-`             | `bun-${{ vars.BUN_VERSION }}-${{ hashFiles(...) }}`                              |
| Mirror GHCR (`sync-bun-mirror.yml` env) | `BUN_VERSION: ${{ vars.BUN_VERSION }}`                                           |
| Mirror ubuntu-bun (`--build-arg`)       | `BUN_VERSION: ${{ vars.BUN_VERSION }}` (Dockerfile falha sem ela)                |
| Composite action `setup-bun`            | resolve do input `bun-version` (callers resolvem `vars.BUN_VERSION` no workflow) |
| Act local (`.actrc`)                    | `--var BUN_VERSION=<versão>` (espelho local da variável)                         |

O guard `scripts/check-bun-mirror.mjs` (PR Check + `utf8-check.yml` + pre-commit

- pre-push) **falha o PR por drift**: qualquer literal de versão em workflow,
  key ou metadata é bloqueado antes do merge.

---

## 2. Pré-requisitos

- Acesso ao repositório real com `gh` autenticado:
  ```bash
  gh auth status          # "Logged in to github.com"
  gh api repos/<owner>/<repo>   # exit 0 = acesso ok (404 = conta sem acesso)
  ```
- A variável `BUN_VERSION` **já existe** no repositório (o bump é uma
  atualização de valor, não a criação):
  ```bash
  gh variable list -R <owner>/<repo> | grep BUN_VERSION
  ```
- Um checkout/worktree com o working tree LF (guards de CRLF) e o `.actrc`
  presente na raiz.

---

## 3. Procedimento passo a passo

### 3.1 — Atualizar a repository variable (fonte única)

```bash
gh variable set BUN_VERSION 1.3.15 -R <owner>/<repo>   # ex.: 1.3.14 → 1.3.15
gh variable list -R <owner>/<repo> | grep BUN_VERSION  # confirma
```

Esta é a **única edição obrigatória** no CI. A partir daqui:

- cache keys `bun-`/`prisma-` viram cache miss automaticamente (toolchain nova
  ≠ chave nova) e re-populam com as chaves novas;
- os call sites do setup-bun não mudam (todos passam `bun-version:
${{ vars.BUN_VERSION }}`);
- o `action.yml` não muda (metadata estática, sem `default:` — resolve do
  input em runtime).

### 3.2 — Atualizar o espelho local do act (`.actrc`)

```bash
# .actrc — raiz do repositório
--var BUN_VERSION=1.3.15
```

Sem isso, o act local roda com a versão **antiga** enquanto o CI usa a nova —
o guard estático só valida a EXISTÊNCIA da linha, não o valor. Se você esquecer,
o job semanal `actrc-sync` (`benchmark-weekly.yml`) avisa via `::warning::`
(ver [seção 6](#6-aviso-semanal-de-drift-actrc-sync)).

### 3.3 — Re-sincronizar os mirrors GHCR

Os dois mirrors leem `vars.BUN_VERSION` — basta **re-dispará-los** (o cron
semanal de segunda-feira também roda sozinho, mas não espere por ele num bump):

```bash
# 1. Mirror do binário (imagem scratch ghcr.io/<owner>/bun:<versão> — tier 3 do setup-bun)
gh workflow run sync-bun-mirror.yml -R <owner>/<repo>
# gh run watch sem run id vigia o ÚLTIMO run do repo — capture o id do workflow certo
RUN_ID=$(gh run list -R <owner>/<repo> --workflow sync-bun-mirror.yml --limit 1 --json databaseId -q '.[0].databaseId')
gh run watch --exit-status "$RUN_ID" -R <owner>/<repo>   # aguarda concluir (exit 0 = ok)

# 2. Mirror da imagem runner (ghcr.io/<owner>/ubuntu-bun:<versão> — tier-1 fast path no act local)
gh workflow run sync-ubuntu-bun-mirror.yml -R <owner>/<repo>
RUN_ID=$(gh run list -R <owner>/<repo> --workflow sync-ubuntu-bun-mirror.yml --limit 1 --json databaseId -q '.[0].databaseId')
gh run watch --exit-status "$RUN_ID" -R <owner>/<repo>
```

> **Pacotes GHCR privados por padrão:** pacotes criados via `GITHUB_TOKEN`
> nascem PRIVADOS. O pull anônimo (runners do GitHub e act local) só funciona
> em pacotes PÚBLICOS — se for a 1ª vez, torne público em
> `https://github.com/orgs/<owner>/packages` (Settings → change visibility →
> public). Não é bloqueante: o tier 3 do action tem fallback para o download
> direto do GitHub Releases.

### 3.4 — Verificar o resultado dos mirrors

Cada workflow termina com um passo **Verify** que puxa a imagem publicada e
executa o binário:

```bash
# Mirror bun: docker cp /bun e executa --version
docker pull ghcr.io/<owner>/bun:1.3.15
docker run --rm ghcr.io/<owner>/bun:1.3.15   # CMD = /bun --help

# Mirror ubuntu-bun: node + bun + bunx no PATH
docker run --rm ghcr.io/<owner>/ubuntu-bun:1.3.15 bash -lc 'bun --version'
```

### 3.5 — Primeira execução do CI após o bump

A 1ª execução roda com **cache miss em todas as keys `bun-*`/`prisma-*`**
(custo único de ~20-30s por job) e re-popula o cache com as chaves novas —
o preço deliberado de nunca servir toolchain errada de cache. É esperado e
não é regressão.

### 3.6 — Validar localmente antes de commitar (guarda `--staged` do pre-commit)

O pre-commit agora começa com o guard **`--staged`** (`node
scripts/check-bun-mirror.mjs --staged`) como **PRIMEIRO passo** — antes dos 11
guards de encoding, do lint-staged e do typecheck. Ele inspeciona `git diff
--cached` e **aborta o commit** se o diff introduzir cache key antiga
(`bun-1.3.14-...`), literal de versão do Bun, call site do setup-bun sem
`bun-version:` ou par key↔path quebrado — mesmo que o working tree global já
esteja migrado.

Overhead medido (bench local, 2026-08-03):

- caminho feliz: ~320–800ms por commit (~0,3–0,7% do hook completo de ~115s);
- caminho de rejeição: commit abortado em **~3s** com a lista exata das
  violações — nenhum guard caro (encoding/typecheck) chega a rodar.

Simulação manual (repo local, não toca no histórico):

```bash
# 1. Cria um workflow temporário com key antiga e dá git add (staged)
cat > .github/workflows/tmp-bench-literal.yml <<'EOF'
name: Bench Temp
on:
  workflow_dispatch:
jobs:
  bench:
    runs-on: ubuntu-latest
    steps:
      - name: Cache node_modules
        uses: actions/cache@v4
        with:
          path: node_modules
          key: bun-1.3.14-${{ hashFiles('bun.lock') }}
          restore-keys: bun-1.3.14-
EOF
git add .github/workflows/tmp-bench-literal.yml

# 2. Tenta o commit — o pre-commit DEVE rejeitar (exit 1, 4 violações)
#    e o HEAD permanece intacto (nenhum commit é criado)
git commit -m "bench: pre-commit literal key"
# ❌ Diff com 4 violação(ões) de cache key/literal/...
# husky - pre-commit script failed (code 1)

# 3. Limpa o arquivo temporário (working tree volta ao estado anterior)
git reset -q HEAD -- .github/workflows/tmp-bench-literal.yml
rm -f .github/workflows/tmp-bench-literal.yml
```

> **Nota:** o guard `--staged` só enxerga o que está **staged** (`git add`).
> Com nada staged, `node scripts/check-bun-mirror.mjs --staged` retorna
> `✅ Diff ok` — a simulação acima é o que prova o caminho de rejeição real.

---

## 4. O que NÃO precisa ser editado

| Artefato                                                        | Por quê                                                           |
| --------------------------------------------------------------- | ----------------------------------------------------------------- |
| Cache keys `bun-`/`prisma-` nos workflows                       | derivam de `${{ vars.BUN_VERSION }}` — viram miss sozinhas        |
| `.github/actions/setup-bun/action.yml`                          | sem `default:` literal; resolve do input `bun-version` em runtime |
| Call sites do setup-bun                                         | todos passam `bun-version: ${{ vars.BUN_VERSION }}` (guard exige) |
| `Dockerfile.bun-mirror` / `Dockerfile.ubuntu-bun`               | versionados pela variável no build, não hardcoded                 |
| `scripts/check-bun-mirror.mjs` / `scripts/check-actrc-sync.mjs` | lógica, não versão                                                |

---

## 5. O que o guard verifica (`check-bun-mirror.mjs`)

Roda no PR Check, `utf8-check.yml`, pre-commit e pre-push. Falha (exit 1) se:

1. o mirror `sync-bun-mirror.yml` tiver `BUN_VERSION` **literal** em vez de
   `${{ vars.BUN_VERSION }}`;
2. o action `setup-bun` tiver `default:` literal (metadata de action não
   avalia `${{ }}`);
3. o action não referenciar `inputs.bun-version` no step de resolve (o
   composite NÃO lê `vars` internamente — act 0.2.89 não resolve vars em
   composite actions);
4. o action (tier 3) não referenciar o mirror GHCR
   (`ghcr.io/<owner>/bun:<versão>`);
5. o `Dockerfile.bun-mirror` não existir;
6. qualquer cache key `bun-`/`prisma-` não referenciar
   `${{ vars.BUN_VERSION }}` (um literal `bun-1.3.14-...` não seria invalidado
   pela troca da variável);
7. o `path:` de um bloco actions/cache não fechar o par key↔path da toolchain
   (bun → `node_modules`/`~/.bun`; prisma → `node_modules/.prisma` +
   `node_modules/@prisma/client`);
8. qualquer workflow tiver versão literal do Bun (`bun-version: 1.3.14`,
   `bun-1.3.14-...`, `BUN_VERSION: "1.3.14"`);
9. o `.actrc` não definir `BUN_VERSION` (o act local quebraria);
10. TODO call site do setup-bun não passar `bun-version:
${{ vars.BUN_VERSION }}` (omitir o input ou usar literal é violação — o
    scan é GLOBAL, não só staged);
11. (modo `--staged` / PR diff) cache keys, literais, call sites e pares
    key↔path **introduzidos pelo diff** não seguirem a fonte única — uma key
    antiga adicionada pelo próprio PR falha antes do merge. O pre-commit
    local executa este modo como **primeiro passo** (ver seção 3.6).

Validação local antes de abrir PR:

```bash
node scripts/check-bun-mirror.mjs            # invariantes globais
node scripts/check-bun-mirror.mjs --staged   # diff staged (1º passo do pre-commit)
node scripts/check-actrc-sync.mjs --expected "$(gh variable get BUN_VERSION -R <owner>/<repo> || echo 1.3.14)"  # .actrc vs variável real
```

---

## 6. Aviso semanal de drift (`actrc-sync`)

O job `actrc-sync` do `benchmark-weekly.yml` (node-puro, sem setup-bun) compara
o `.actrc` do working tree com `vars.BUN_VERSION` e emite `::warning::`
**não-bloqueante** (exit 0) se divergirem — cobre o caso que o guard estático
não alcança (o VALOR, não a existência da linha). Variável ausente no
repositório também vira `::warning::`. Simulação local:

```bash
node scripts/check-actrc-sync.mjs --expected 1.3.15          # exit 0 (ok)
node scripts/check-actrc-sync.mjs --expected 1.3.14 --fail   # exit 1 (drift)
```

---

## 7. Troubleshooting

| Sintoma                                                                   | Causa e correção                                                                                                                                                                                |
| :------------------------------------------------------------------------ | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `::error::Repository variable BUN_VERSION não definida` no mirror         | Variável não criada no repo (ou criada em outra org). Criar: `gh variable set BUN_VERSION 1.3.15 -R <owner>/<repo>` e re-disparar o workflow.                                                   |
| Guard `check-bun-mirror` falha com "versão literal"                       | Sobrou literal do bump anterior (ex.: `bun-1.3.14-...` numa key) — atualizar para `${{ vars.BUN_VERSION }}`.                                                                                    |
| Guard falha com "`.actrc` NÃO define BUN_VERSION"                         | `.actrc` sem a linha `--var BUN_VERSION=...` — restaurar (espelho local).                                                                                                                       |
| `::warning::check-actrc-sync: .actrc define BUN_VERSION='1.3.14' mas ...` | Bump feito na variável sem atualizar `.actrc` — aplicar [3.2](#32--atualizar-o-espelho-local-do-act-actrc).                                                                                     |
| `docker pull ghcr.io/...` pede login (denied)                             | Pacote GHCR privado — tornar público em `https://github.com/orgs/<owner>/packages` (não-bloqueante: tier 3 tem fallback p/ GitHub Releases).                                                    |
| Cache miss em todas as keys após o bump                                   | **Esperado** — 1ª execução pós-bump re-popula o cache (ver [3.5](#35--primeira-execução-do-ci-após-o-bump)).                                                                                    |
| `Unknown Variable Access vars` ao parsear `action.yml` no act             | Token `${{ vars.BUN_VERSION }}` com chaves dentro do composite action (proibido no act 0.2.89) — o action lê só o input `bun-version`; nunca edite o `action.yml` para \"resolver\" a variável. |

---

## 8. Checklist final de auditoria

```bash
# 1. Variável atualizada e visível
gh variable list -R <owner>/<repo> | grep BUN_VERSION

# 2. Mirrors re-disparados e concluídos (Verify ok)
gh run list -R <owner>/<repo> --workflow sync-bun-mirror.yml --limit 1
gh run list -R <owner>/<repo> --workflow sync-ubuntu-bun-mirror.yml --limit 1

# 3. Espelho local sincronizado
grep BUN_VERSION .actrc

# 4. Guard estático passa
node scripts/check-bun-mirror.mjs && node scripts/check-actrc-sync.mjs --expected 1.3.15

# 5. Guards de encoding (se mexeu em .sh/.md)
bash scripts/check-crlf.sh --ci && bash scripts/check-utf8.sh --ci src/

# 6. Testes da suite (recomendado antes do PR)
bun run test:unit
```

> **Auditabilidade:** cada bump fica registrado em DOIS lugares consultáveis —
> o histórico da repository variable (`gh variable list` captura o valor atual;
> o history completo fica no GitHub Settings) e o commit do `.actrc` no git
> (`git log -p -- .actrc`). Registre o bump no `worklog.md` com a versão
> anterior → nova e a data.
