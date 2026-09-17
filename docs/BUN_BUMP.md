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

| Consumidor                              | Como lê a versão                                                                                                              |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Workflows (`bun-version:` no setup-bun) | `${{ vars.BUN_VERSION }}`                                                                                                     |
| Cache keys `bun-`/`prisma-`             | `bun-${{ vars.BUN_VERSION }}-${{ hashFiles(...) }}`                                                                           |
| Mirror GHCR (`sync-bun-mirror.yml` env) | `BUN_VERSION: ${{ vars.BUN_VERSION }}`                                                                                        |
| Mirror ubuntu-bun (`--build-arg`)       | `BUN_VERSION: ${{ vars.BUN_VERSION }}` (Dockerfile falha sem ela)                                                             |
| Composite action `setup-bun`            | resolve do input `bun-version` (callers resolvem `vars.BUN_VERSION` no workflow)                                              |
| Act local (`.actrc`)                    | `--var BUN_VERSION=<versão>` (espelho local da variável)                                                                      |
| Build da app/worker (`--build-arg`)     | `BUN_VERSION: ${{ vars.BUN_VERSION }}` na pipeline; nos composes, `${BUN_VERSION:-1.3.14}` — o Dockerfile **não** tem default |
| Toolchain declarado (`package.json`)    | `"packageManager": "bun@1.3.14"` (o `check-bun-mirror` exige o MESMO valor dos espelhos; o bump o escreve no passo 2d)        |

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

### 3.2 — Atualizar os espelhos da versão (`.actrc` e o env da forja)

A variável tem **dois espelhos** no working tree, um por consumidor:

| Espelho                    | Consumidor                                                   |
| :------------------------- | :----------------------------------------------------------- |
| `.actrc` (raiz)            | o act local (ele não lê as variables do repositório)         |
| `deploy/env.gitea.example` | a label do runner da forja (a imagem que roda TODOS os jobs) |

```bash
# .actrc — raiz do repositório
--var BUN_VERSION=1.3.15

# deploy/env.gitea.example
BUN_VERSION=1.3.15
```

O caminho automatizado é o script, que faz os 4 passos deste procedimento
(inclusive esta edição nos DOIS arquivos) e valida no fim:

```bash
./scripts/bump-bun.sh 1.3.15                    # variável + espelhos + mirrors + validação
./scripts/bump-bun.sh 1.3.15 --skip-actrc       # deixa o .actrc para depois
./scripts/bump-bun.sh 1.3.15 --skip-env         # deixa o env da forja para depois
```

Sem isso, cada espelho falha de um jeito próprio — e **os dois em silêncio**:

- `.actrc` desatualizado → o act local roda a versão **antiga** enquanto o CI
  usa a nova;
- `deploy/env.gitea.example` desatualizado → o runner da forja roda uma imagem
  que embarca **outra** versão do Bun. Isto **não** deixa o CI vermelho: o
  setup-bun funciona igual com ou sem Bun pré-instalado, então o fast path de 0s
  do tier-1 apenas **desliga** — todo job da forja volta a pagar o download.

Em ambos os casos o guard estático só valida a EXISTÊNCIA da linha, não o
valor; quem compara os VALORES é o job semanal `actrc-sync`
(`benchmark-weekly.yml`), que avisa via `::warning::`
(ver [seção 6](#6-aviso-semanal-de-drift-actrc-sync)).

### 3.2b — Os DEFAULTS dos composes (espelhos derivados)

Além dos dois arquivos acima, os composes dão um default a `BUN_VERSION` nos
build args (`dev`, `test`, `prod`, `hostinger`):

```yaml
BUN_VERSION: ${BUN_VERSION:-1.3.15}
```

O default é o que **vale onde a variável não existe** (um host sem
`BUN_VERSION` no `.env`), então ele é um espelho como os outros — e o
`check-bun-mirror` exige que ele seja **igual** ao valor declarado em
`deploy/env.gitea.example`. `./scripts/bump-bun.sh` reescreve esses defaults no
mesmo passo (é o que mantém o bump verde no fim: o script roda o guard).

Um `BUN_VERSION: "1.4.0"` **sem** `${...}` não é espelho, é um segundo valor:
nem o bump o alcança, nem nenhum guard o via até a auditoria de 09/2026 — o
compose builda com o Bun que ficou escrito ali, em silêncio. O conserto é à mão
(trocar pela forma derivada).

O mesmo vale para os **scripts** do repositório: eles resolvem a versão com
`scripts/bun-version.mjs` (`requireBunVersion()`, cadeia env → `.actrc` →
env da forja, com erro se não houver) — nenhum default literal de reserva, e
fixtures usam uma sentinela (`9.9.9-sentinel`).

### 3.2c — Os BUILD SITES e o toolchain declarado (invariante 18)

Duas obrigações a mais que o bump precisa deixar no lugar:

- **todo serviço de compose que builda um Dockerfile com `ARG BUN_VERSION` tem de
  PASSAR o arg** (`args: BUN_VERSION: ${BUN_VERSION:-…}`). Um serviço sem o arg
  não tem valor escrito NENHUM: ele herda o default do Dockerfile em SILÊNCIO.
  Foi assim que o app da staging passou a rodar um Bun que nenhum arquivo da
  cadeia de deploy declarava — enquanto os dois workers da MESMA stack já tinham
  o literal alinhado, e nada ficava vermelho (a stack buildava com DOIS Buns e a
  assimetria não aparecia em nenhum diff). É por isso que os Dockerfiles **não
  declaram default** (`ARG BUN_VERSION`, sem valor): sem default, um build que não
  passa o arg **falha alto** (`oven/bun:-alpine`) em vez de rodar outro Bun.
- **o `packageManager` do `package.json`** diz o valor dos espelhos. Nada o
  consome em tempo de build (o bun não o impõe), então ele envelhecia sem
  sintoma — e é o primeiro campo que alguém lê para saber qual Bun este repo usa.
  `./scripts/bump-bun.sh` o reescreve no mesmo passo dos outros espelhos (2d).

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

### 3.7 — Os EXEMPLOS DE VERSÃO da prosa (invariante 17)

Depois do bump, a prosa que ENSINA o comando passa a mentir — e doc não executa,
então nada ficava vermelho: quem copiava `--expected 1.3.14` do cabeçalho de um
script ou do README media/rodava a versão antiga. A invariante 17 julga as
menções **ancoradas** (`BUN_VERSION=…`, `bun-version: …`, `--expected`/
`--bun-version`, `bun[-@:/]v?X.Y.Z`, o argumento do `setup-bun-ci.sh`, o do
`bump-bun.sh` e a transição `1.3.14 → 1.3.15`) contra o valor **vigente** dos
espelhos, nos `*.md` do worktree e nos **comentários** dos scripts (inclusive o
de fim de linha). A varredura é parte do mesmo guard, roda no PR e no
`--staged`: o commit que introduz o exemplo velho é barrado antes do merge.

O que cada forma pede:

| Forma da menção                                        | O que a invariante exige                            |
| :----------------------------------------------------- | :-------------------------------------------------- |
| `BUN_VERSION=…`, `bun-version: …`, `--expected …`, tag | **o valor vigente** (o que os espelhos declaram)    |
| `./scripts/bump-bun.sh <v>`                            | um valor **MAIOR** que o vigente (é o alvo)         |
| `1.3.14 → 1.3.15`                                      | o antes = vigente; o depois **MAIOR** que ele       |
| valor + `[divergente]`                                 | um contra-exemplo: tem de **DIFERIR** do vigente    |
| valor + `[próxima]`                                    | o alvo do bump: tem de ser **MAIOR**                |
| `9.9.9-sentinel`                                       | fora: sufixo não-numérico não é afirmação de versão |

O doc `docs/BUN_BUMP.md` é um **cenário declarado** (`PROSE_SCENARIO_DOCS`): o
walkthrough cita o alvo (`1.3.15`) ponta a ponta, então ali vale o vigente OU um
valor maior. Nos outros docs, o exemplo que precisa divergir carrega o marcador
na própria linha — e um exemplo do valor vigente que deixe de ser atualizado no
próximo bump falha o PR nomeando arquivo e linha.

---

## 4. O que NÃO precisa ser editado

| Artefato                                                        | Por quê                                                                                               |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Cache keys `bun-`/`prisma-` nos workflows                       | derivam de `${{ vars.BUN_VERSION }}` — viram miss sozinhas                                            |
| `.github/actions/setup-bun/action.yml`                          | sem `default:` literal; resolve do input `bun-version` em runtime                                     |
| Call sites do setup-bun                                         | todos passam `bun-version: ${{ vars.BUN_VERSION }}` (guard exige)                                     |
| `Dockerfile.bun-mirror` / `Dockerfile.ubuntu-bun`               | versionados pela variável no build, não hardcoded                                                     |
| `Dockerfile` / `Dockerfile.worker` / `realtime`                 | só `ARG BUN_VERSION` + `${BUN_VERSION}` (sem default: o valor entra pelo build site — invariante 18b) |
| `scripts/check-bun-mirror.mjs` / `scripts/check-actrc-sync.mjs` | lógica, não versão                                                                                    |

> **Exceção que deixou de existir:** a PROSA (cabeçalhos de ajuda, README,
> docs) que cita a versão antiga agora **precisa** ser editada — ver §3.7. O
> sintoma era invisível (doc não executa), e a invariante 17 do `check-bun-mirror`
> passou a reprovar o PR até os exemplos acompanharem o bump.

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
    local executa este modo como **primeiro passo** (ver seção 3.6);
12. algum **script** (`scripts/**` + hooks do `.husky/**`) carregar literal da
    versão do Bun ou da TAG da imagem do runner (invariante 15) — o único caso
    em que o defeito não aparece em nenhum diff de workflow;
13. algum **compose** com valor de `BUN_VERSION` que não derive (invariante
    16): literal puro, ou default divergente do declarado nos espelhos;
14. algum **Dockerfile** declarar VALOR para a versão (invariante 18a): o default
    do ARG (`ARG BUN_VERSION=<v>`) ou um default embutido na referência
    (`${BUN_VERSION:-<v>}`) — é o valor que todo build sem o arg herda em
    silêncio, e que nenhum bump alcança;
15. algum **build site** de um Dockerfile com `ARG BUN_VERSION` não passar o arg
    (invariante 18b), ou o **`packageManager`** do `package.json` divergir do
    valor declarado (invariante 18c). No `--staged`, o recorte da (b) são os
    blocos que o diff TOCA (lidos do ÍNDICE); a REMOÇÃO do arg é pega pela
    varredura global, que roda no PR.

Validação local antes de abrir PR:

```bash
node scripts/check-bun-mirror.mjs            # invariantes globais
node scripts/check-bun-mirror.mjs --staged   # diff staged (1º passo do pre-commit)
node scripts/check-actrc-sync.mjs \
  --expected "$(gh variable get BUN_VERSION -R <owner>/<repo> || echo 1.3.14)" \
  --expected-var "IMAGE_REGISTRY=$(gh variable get IMAGE_REGISTRY -R <owner>/<repo> || echo ghcr.io)" \
  --expected-var "IMAGE_NAMESPACE=$(gh variable get IMAGE_NAMESPACE -R <owner>/<repo> || echo <owner>)"  # os espelhos vs as 3 variáveis reais
```

---

## 6. Aviso semanal de drift (`actrc-sync`)

O job `actrc-sync` do `benchmark-weekly.yml` (node-puro, sem setup-bun) compara
os **espelhos** do working tree com o valor de **cada variável que o compose da
forja consome** — `vars.BUN_VERSION`, `vars.IMAGE_REGISTRY` e
`vars.IMAGE_NAMESPACE` — e emite `::warning::` **não-bloqueante** (exit 0) se
divergirem. Cobre o caso que os guards estáticos não alcançam (o VALOR, não a
existência da linha/flag):

| Espelho                    | Quem lê                                                      | O que custa divergir                                                                                                                                                                                                                                                                                    |
| :------------------------- | :----------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `.actrc`                   | o act local (ele não lê as variables do repositório)         | o act testa uma **versão** ou um **registry** diferente da produção (o `.actrc` espelha `BUN_VERSION` e `IMAGE_REGISTRY` — o namespace não vive ali: os workflows o usam com fallback)                                                                                                                  |
| `deploy/env.gitea.example` | a label do runner da forja (a imagem que roda TODOS os jobs) | a imagem embarca outra **versão** do Bun e o fast path de 0s do tier-1 desliga **em silêncio** — o setup-bun funciona igual, só mais lento (todo job volta a pagar o download); um **registry/namespace** trocado só aparece quando um job tenta puxar a imagem (antes só havia checagem de existência) |

Um espelho ausente é **ignorado**, não acusado: ausência de arquivo não é o
drift que este job caça (o guard estático é que exige a linha dentro dele), e
um checkout parcial não deve virar aviso. A variável `RUNNER_TOKEN` fica FORA da
comparação (é segredo — o template comitado traz placeholder e o host o token
real; presença e diferença do template são do `check-env-mirror.mjs`). Variável
ausente no repositório vira `::warning::`, e uma variável **sem valor passado à
run** sai como NÃO COMPARADA — nomeada no log, nunca como conferida. Simulação
local:

```bash
node scripts/check-actrc-sync.mjs --expected 1.3.15 --expected-var IMAGE_REGISTRY=ghcr.io --expected-var IMAGE_NAMESPACE=severinno   # exit 0 (ok)
node scripts/check-actrc-sync.mjs --expected 1.3.14 --fail   # exit 1 (drift)
node scripts/check-actrc-sync.mjs --expected 1.3.15 --gitea-env deploy/.env.gitea  # o env do VPS (sem --expected-var: registry/namespace saem NÃO COMPARADAS)
```

---

## 7. Troubleshooting

| Sintoma                                                                                              | Causa e correção                                                                                                                                                                                                                                                                 |
| :--------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `::error::Repository variable BUN_VERSION não definida` no mirror                                    | Variável não criada no repo (ou criada em outra org). Criar: `gh variable set BUN_VERSION 1.3.15 -R <owner>/<repo>` e re-disparar o workflow.                                                                                                                                    |
| Guard `check-bun-mirror` falha com "versão literal"                                                  | Sobrou literal do bump anterior (ex.: `bun-1.3.14-...` numa key) — atualizar para `${{ vars.BUN_VERSION }}`.                                                                                                                                                                     |
| Guard falha com "`.actrc` NÃO define BUN_VERSION"                                                    | `.actrc` sem a linha `--var BUN_VERSION=...` — restaurar (espelho local).                                                                                                                                                                                                        |
| `::warning::check-actrc-sync: .actrc define BUN_VERSION='1.3.14' mas ...`                            | Bump feito na variável sem atualizar `.actrc` — aplicar [3.2](#32--atualizar-os-espelhos-da-versão-actrc-e-o-env-da-forja).                                                                                                                                                      |
| `::warning::check-actrc-sync: deploy/env.gitea.example define BUN_VERSION='1.3.14' mas ...`          | Bump feito na variável sem atualizar o espelho do runner — o fast path de 0s do tier-1 desliga em silêncio (o CI continua verde, só mais lento). Atualize `BUN_VERSION` em `deploy/env.gitea.example` (e no `deploy/.env.gitea` do VPS, que dele deriva) e re-registre o runner. |
| `docker pull ghcr.io/...` pede login (denied)                                                        | Pacote GHCR privado — tornar público em `https://github.com/orgs/<owner>/packages` (não-bloqueante: tier 3 tem fallback p/ GitHub Releases).                                                                                                                                     |
| Cache miss em todas as keys após o bump                                                              | **Esperado** — 1ª execução pós-bump re-popula o cache (ver [3.5](#35--primeira-execução-do-ci-após-o-bump)).                                                                                                                                                                     |
| `Unknown Variable Access vars` ao parsear `action.yml` no act                                        | Token `${{ vars.BUN_VERSION }}` com chaves dentro do composite action (proibido no act 0.2.89) — o action lê só o input `bun-version`; nunca edite o `action.yml` para \"resolver\" a variável.                                                                                  |
| Guard falha com "o serviço 'x' builda 'Dockerfile', que declara `ARG BUN_VERSION`, SEM passar o arg" | O compose builda um Dockerfile que consome a versão e não passa o arg (invariante 18b) — o build herdaria o default do Dockerfile. Adicione `args:` com `BUN_VERSION: ${BUN_VERSION:-<declarado>}`; ver [3.2c](#32c--os-build-sites-e-o-toolchain-declarado-invariante-18).      |
| Guard falha com "'ARG BUN_VERSION=<v>' é um DEFAULT no Dockerfile"                                   | O default voltou (invariante 18a): ele é o valor que TODO build sem o arg herda em silêncio. Declare `ARG BUN_VERSION` **sem** valor — o default pertence ao build site, onde o guard o compara por valor.                                                                       |
| Guard falha com "`\"packageManager\": \"bun@<v>\"` diz uma versão diferente da declarada"            | O toolchain declarado ficou para trás (invariante 18c). Alinhe com o espelho — `./scripts/bump-bun.sh` faz isso no passo 2d.                                                                                                                                                     |

---

## 8. Checklist final de auditoria

```bash
# 1. Variável atualizada e visível
gh variable list -R <owner>/<repo> | grep BUN_VERSION

# 2. Mirrors re-disparados e concluídos (Verify ok)
gh run list -R <owner>/<repo> --workflow sync-bun-mirror.yml --limit 1
gh run list -R <owner>/<repo> --workflow sync-ubuntu-bun-mirror.yml --limit 1

# 3. Espelhos sincronizados (os DOIS + o toolchain declarado)
grep BUN_VERSION .actrc
grep BUN_VERSION deploy/env.gitea.example
grep packageManager package.json    # o bump escreve no passo 2d (invariante 18c)

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
