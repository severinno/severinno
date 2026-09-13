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
cp /home/deploy/severinno/deploy/env.gitea.example /opt/gitea/.env

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
# REPO = checkout deste repositorio na VPS (ex.: /home/deploy/severinno).
# O gitea-up.sh GARANTE a imagem do runner (publica se faltar) ANTES de subir
# a stack — um `docker compose up -d runner` seco subiria o container e todo
# job falharia ao iniciar, longe da causa.
ENV_FILE=/opt/gitea/.env COMPOSE_FILE=/opt/gitea/docker-compose.yml \
  bash $REPO/deploy/gitea-up.sh
```

### 3.1. Runner: a imagem que roda os jobs (tier-1 fast path)

Os labels do runner em `deploy/docker-compose.gitea.yml` apontam para
`<IMAGE_REGISTRY>/<IMAGE_NAMESPACE>/ubuntu-bun:<BUN_VERSION>` — a **mesma**
imagem que o act local usa (`-P ubuntu-latest=...`, ver `Dockerfile.ubuntu-bun`).

Por que: o setup do Bun (`scripts/setup-bun-ci.sh`) tem 3 camadas, e a primeira
so engaja se `bun` ja estiver no PATH na versao pedida. Com o label anterior
(`node:20-bullseye`) o Bun NUNCA vinha na imagem e **todo job pagava o tier 3**
(~1-3s pelo mirror OCI, ~5-10s pelo release do GitHub). Com a imagem custom o
setup resolve em ~0s — e o ganho maximo possivel.

A imagem precisa embarcar **duas** coisas, e as duas sao conferidas no BUILD
(nao na fe da imagem): o **Bun** da variable (tier-1) e o **plugin
`compose`** — sem ele o job `guards` da forja nao consegue provar a invariante 7
(o render do compose vira INDETERMINADO, e a invariante deixa de ser verificada
dentro de um job verde). A base `catthehacker/ubuntu:act-latest` ja entrega o
plugin (medido em 09/2026), e o `Dockerfile.ubuntu-bun` falha se isso mudar;
nao ha instalacao com versao literal de proposito (seria um segundo ponto de
verdade — a mesma regra do BUN_VERSION).

Pre-requisitos, NESTA ordem:

1. A tag precisa existir no registry **antes** de subir o runner — e isso nao
   se resolve "publicando de cabeca": o comando `bash deploy/gitea-up.sh` (ou
   `bun run runner-image:ensure`) **garante** o pre-requisito. Ele le o MESMO
   env do compose, confere a tag no registry pela API OCI v2 (sem docker, sem
   baixar a imagem), e se ela faltar **publica** (workflow canonico
   `sync-ubuntu-bun-mirror.yml`; fallback build+push local) e **RE-CONFERE** no
   registry — a garantia e a releitura, nao o push. Para so verificar, sem
   publicar nem subir nada: `bun run runner-image:check` (exit 4 = ausente).
   E, para PROVAR que a subida depende dela — sem docker, sem rede externa,
   contra um registry de teste em `127.0.0.1`: `bun run runner-image:prove`
   (exit 0 = com a tag ausente o runner NAO sobe; o mesmo resultado entra no
   `doctor`, secao `4/5`). A prova cobre **os dois caminhos**: a subida simples
   e o `--re-register` — nele, sem a imagem NADA e apagado, e com a imagem a
   ordem e `rm -sf runner` -> `volume rm` -> `up -d runner`.
   Estado **indeterminado** (registry inacessivel, ou pacote privado sem
   credencial) nunca publica: o comando falha com o remedio, porque "nao sei"
   nao e "nao existe". Pacote privado e um erro por si: quem puxa a imagem e o
   daemon do runner, **sem credencial**.
2. `BUN_VERSION` no `.env.gitea` precisa ser **igual** a repository variable
   `BUN_VERSION` do repositorio. Os espelhos da variavel sao comparados pelo
   guard `check-actrc-sync.mjs`, que roda **nos dois lados**: no GitHub pelo job
   semanal `actrc-sync` do `benchmark-weekly.yml` (modo aviso + **issue**, via
   `scripts/actrc-sync-issue.mjs` — o run fica verde de proposito, entao a
   anotacao sozinha nao alerta ninguem; e quando os espelhos voltarem a
   concordar, o MESMO script comenta a prova e FECHA a issue, porque divida
   resolvida que continua aberta mente no board) e na propria forja,
   `.gitea/workflows/actrc-sync.yml` (mesmo cron, **modo `--fail`** — na forja
   nao ha canal de issue, entao o unico sinal lido e o status do run: drift =>
   run vermelho).

   O guard DESCOBRE os espelhos: o arquivo COMITADO
   (`deploy/env.gitea.example`, de onde este `.env.gitea` deriva), o `.actrc` e
   — **quando presente no checkout** — o `deploy/.env.gitea` do host. Num
   runner do GitHub esse ultimo nao existe (gitignored); no checkout da forja
   ele existe, e era justamente ali que ele ficava invisivel: o guard conferia
   so o template e dizia "em sincronia" enquanto a versao que o runner usa de
   verdade podia estar outra.

   Para conferir ARQUIVO por ARQUIVO (ex.: o `/opt/gitea/.env` de outro host):
   `node scripts/check-actrc-sync.mjs --expected <versao da variable> --gitea-env /opt/gitea/.env`.
   Em runtime, quem prova a igualdade e o smoke (Prova 3, abaixo).

3. O `.env.gitea` DESTE host precisa estar em sincronia com o template comitado
   (`deploy/env.gitea.example`) — **em todas** as variaveis, nao so no
   `BUN_VERSION`. O gate de interpolacao (`bun run check:registry-source`)
   compara os DOIS arquivos: o MESMO conjunto de nomes, os MESMOS valores nas
   variaveis que o compose consome, e o label renderizado identico dos dois
   lados (o render com este env x o render com o template). Divergir e exit 1,
   com o remedio impresso — porque divergir aqui significa que **o que este host
   interpola nao e o que o repositorio declara**: namespace trocado, versao
   velha ou variavel que o template ja nao declara, tudo com o sintoma longe da
   causa (o runner roda outra imagem — e o setup do Bun funciona igual, so mais
   lento).

   Numa variavel comum, DIVERGIR e o defeito; num **segredo** (o
   `RUNNER_TOKEN`), IGUALAR e o defeito: o template e comitado, e o placeholder
   dele nunca pode ir para o host — um runner que sobe com o placeholder **nao
   se registra**. Por isso o segredo e conferido por PRESENCA (nao vazio) e por
   DIFERENCA do template.

   A metade do REPOSITORIO (o template declara tudo o que o compose consome)
   vale em qualquer checkout, inclusive no CI — onde este arquivo nao existe. A
   comparacao roda mesmo sem o plugin `compose`, e para apontar o env de outro
   host (ex.: `/opt/gitea/.env`):

   ```bash
   bun run doctor --gitea-env /opt/gitea/.env    # compara ESTE env com o template
   node scripts/check-registry-source.mjs --gitea-env /opt/gitea/.env
   ```

   E o proprio `doctor` confere o VALOR deste espelho contra a variavel, pela
   MESMA funcao do guard (`--expected "$(gh variable get BUN_VERSION)"`, secao
   `5/5`): divergir aqui **bloqueia**, porque e este arquivo que o compose le.

**A troca de label exige RE-REGISTRAR o runner.** O act_runner envia os labels
no registro e depois usa os que ficaram gravados em `/data/.runner` — um
`docker compose restart runner` NAO aplica a imagem nova:

```bash
cd /opt/gitea
# Mesmo comando da subida, no modo de re-registro: GARANTE a imagem (publica se
# faltar) e so entao apaga o container + o registro gravado e sobe o runner.
ENV_FILE=/opt/gitea/.env COMPOSE_FILE=/opt/gitea/docker-compose.yml \
  bash $REPO/deploy/gitea-up.sh --re-register
```

NAO faca essa sequencia a mao. Runbooks antigos a traziam como: remover o
container, apagar o volume do registro, rodar `ensure-runner-image.mjs --check`
e depois subir o runner. O defeito dela era sutil: o `--check` apenas CONFERE —
ele sai 4 quando a tag falta — e a linha seguinte subia o runner do mesmo jeito,
porque nada ligava a conferencia a decisao. O "pre-requisito" ali era decorativo
exatamente no momento em que se troca a versao, que e quando a tag tem mais
chance de nao existir.

O `--re-register` usa o caminho que PUBLICA e RE-CONFERE no registry antes de
subir, e para se nao conseguir. Ele tambem deriva o nome do volume do proprio
compose (nao de uma copia aqui) e FALHA se o volume do registro sobreviver ao
`rm` — em vez de subir o runner com os labels velhos.

Essas duas promessas — _nada e apagado quando a imagem falta_ e _o runner nao
sobe com o registro preso_ — sao provadas por COMPORTAMENTO, nao por leitura do
script: o duble do docker tem estado de volume (`volume inspect`/`volume rm`,
com um modo em que o docker diz que removeu e o volume continua la), e
`bun run runner-image:prove` roda o caminho real nos quatro casos do
re-registro. Uma mutacao que apague o registro antes de conferir a imagem, ou
que suba o runner antes do `rm`, faz a prova cair — e o teste que exige isso
esta em `src/lib/__tests__/prove-runner-image-gate.test.ts`.

(Equivalente pela UI: **Site Administration -> Runners ->** apague `vps-runner`
e crie outro, colando o token novo em `RUNNER_TOKEN`.)

### 3.2. Antes de confiar o merge à forja: `bun run doctor`

Cada peça da forja tem seu guard, e **todos verdes ainda não respondem a
pergunta que importa** — se a forja pode bloquear o merge. O `doctor` junta as
peças num veredito:

```bash
bun run doctor                                   # relatorio completo
bun run doctor --expected "$(gh variable get BUN_VERSION)"   # + o VALOR da variavel
bun run doctor --gitea-env /opt/gitea/.env       # com o env DESTE host
bun run doctor --json | jq .verdict              # para script/pipeline
```

`--expected` e o valor de `vars.BUN_VERSION`, e sem ele a secao `5/5` so prova
que os espelhos existem e concordam entre si — dois espelhos iguais podem estar
os DOIS velhos em relacao a variavel, e o veredito fica **INDETERMINADA** por
isso (nunca "em sincronia" por omissao). Com o valor, a comparacao e a MESMA do
job semanal `actrc-sync` (a funcao `mirrorDriftReport`), e divergir no env da
forja **bloqueia**: o runner roda uma imagem com outra versao do Bun e o fast
path de 0s do tier-1 desliga sem sintoma. Na forja, onde a variavel existe em
runtime, o valor sai do proprio workflow (`vars.BUN_VERSION`).

Ele executa a bateria de guards **derivada da propria pipeline** que decide o
merge (o job `guards` de `.gitea/workflows/ci.yml`). Confere o contrato de merge
(`ci/required-checks.json`) **nos dois lados** — o que o repositorio DECLARA e o
que a forja de fato REGISTRA: le a **branch protection** de cada forja pelo MESMO
aplicador do cron de drift (`apply-required-checks.mjs --check --json`) e, se o
registrado divergir do manifesto, o veredito e BLOQUEADA com o remedio
(`bun run ci:required-checks -- --apply`). E o unico estado que faz um merge
esperar; sem essa metade, renomear o `name:` de um job deixava o manifesto
exigindo um check que nunca roda — o PR trava para sempre e nenhum teste de PR
acusa (ver `docs/GUARDS.md`, secao 13).

Depois dele vem o resto, e o doctor nao para no primeiro verde: **renderiza o
compose da forja com o proprio docker** (`docker compose config`, a invariante 7
do `check:registry-source`: e assim que se descobre se a label do runner resolve
para a versao da variavel ou para uma tag vazia/literal) e, quando o `.env.gitea`
do checkout existe, o compara com o template comitado (invariante 7b: o que o VPS
interpola x o que o repositorio declara); le as referencias que vivem em
**configuracao NAO VERSIONADA** (invariante 9: as repository variables x os
espelhos comitados, o `.env.production.local`/`.env` da APLICACAO x o template
dela, e o default embutido do compose x o valor declarado); compara o
**registro do act_runner** (`/data/.runner`) com o que o compose declara — a
mesma funcao da Prova 5 do smoke: um registro **velho ou vazio** (runner orfao)
**bloqueia**, porque e ele que decide a imagem de cada job — e, pelo MESMO guard
com `--forge github`, o **registro do runner auto-hospedado do GitHub** contra o
`RUNNER_LABELS` do script de setup (la o registro vive no servidor: um runner
ausente ou OFFLINE tambem bloqueia, porque os checks obrigatorios do GitHub so
rodam nele); `--no-runner-labels` pula as **duas** leituras rebaixando o veredito; e sobe a
consulta ao registry para o veredito — `--no-registry-probe` a desliga e **rebaixa** o
veredito, porque um fato "provado" que nao olhou a tag diria `pronta` com a
pergunta em aberto; **roda o contrato do build DENTRO do artefato publicado** —
resolve o DIGEST que a tag serve hoje e executa `docker run <repo>@<digest>` com
o mesmo bloco `RUN` do `Dockerfile.ubuntu-bun`, provando plugin `compose`, versao
do Bun e o caminho `/usr/local/bin/bun` na imagem que o job realmente baixa (sem
com a execucao o build e a label provam o ARQUIVO, nao o artefato; sem daemon ou
sem credencial o veredito e INDETERMINADA e `--no-image-contract` pula
rebaixando); consulta a tag da imagem do runner no
registry e — na secao `4/5` — **prova que a subida depende dela**: roda o
`deploy/gitea-up.sh` real contra um registry de TESTE em `127.0.0.1`, com a tag
ausente e com a tag presente, e afirma sobre o log do `docker` duble. A tag
existir agora nao prova que o runner nao sobe sem ela; essa secao prova. Na
secao `5/5` ele compara os espelhos do `BUN_VERSION` com o VALOR da variavel
(`--expected`), pela mesma funcao do job semanal. O exit
code **e** o veredito: `0` pronta, `1` bloqueada, `2` indeterminada.

Se quiser so a prova, sem o resto do relatorio:

```bash
bun run runner-image:prove     # exit 0 = com a tag ausente o runner NAO sobe
```

Os tres estados nao sao decoracao. `BLOQUEADA` inclui a **imagem ausente**
(exit 4): sem ela nenhum job inicia, entao nao existe gate nenhum rodando — o
sintoma e a fila parada, longe da causa. `INDETERMINADA` e o estado de "nao
consegui provar" (registry inacessivel, pacote privado sem credencial, variavel
do repositorio que nao esta no ambiente deste processo, gate nao executado,
branch protection nao lida por falta de token): ele nunca vira `pronta`, porque
um veredito otimista aqui e pior que nenhum. O que faz a lista ser confiavel e a
distincao que ela carrega: um arquivo **gitignored por desenho** (o `.env.gitea`,
o `.env.production.local`) que nao existe neste checkout aparece como _nao
aplicavel_ — nao como pendencia, senao a pendencia pareceria maior do que e (na
VPS, onde os dois existem, eles sao comparados de verdade).

O relatorio termina dizendo o que o veredito **nao** cobre, e vale ler: a
**permissao do token** sobre a forja (a protecao e lida com o aplicador, que
exige escopo de administracao — sem ele o doctor diz `nao foi lida`, e isso e
INDETERMINADA, nunca "em sincronia"; veja o requisito de token em
`docs/GUARDS.md`, secao 13), o smoke (tier-1 em runtime) e o `.env.gitea` de um
host DIFERENTE deste checkout (o do proprio checkout o doctor compara com o
template; outro host entra
por `--gitea-env`, e sem o arquivo a secao do compose diz `host x template: …`
em vez de fingir que conferiu). O que a secao `3/5` **prova** do render e o plugin
`compose` no artefato publicado (o contrato acima); o que segue fora do alcance
do doctor e o **socket** do job, e quem o exercita e a Prova 4 do smoke.

**Nao ha fallback.** A `node:20-bullseye` existe no Docker Hub e sempre subia —
lenta, mas sempre. A imagem custom troca isso por velocidade: tag errada,
ausente, ou pacote privado sem `docker login` faz **todos** os jobs falharem ao
INICIAR (antes do primeiro step). O caminho de volta e apontar os labels de novo
para `node:20-bullseye` e re-registrar.

Para confirmar que o tier-1 esta de pe, rode o smoke (**Actions -> Forge Smoke
(manual) -> Run workflow**): a **Prova 2 falha com `tier-1 NAO disparou`** se a
imagem do runner nao embarcar a versao da variable — o setup funcionaria do
mesmo jeito (tier 2/3), entao sem essa prova a perda de performance seria
silenciosa.

E como o registro e ESTADO GRAVADO (nao configuracao do container), o tier-1 de
pe nao prova por si que os labels registrados sao os do compose: as **Provas 2 e
3 veem o EFEITO** e so do label que o job pediu (`runs-on: ubuntu-latest`). Um
segundo label registrado ao lado — ou um label que ninguem usa — nao e olhado
por ninguem, e e exatamente ali que um registro velho sobrevive. Quem fecha isso
e a **Prova 5**, que compara o `/data/.runner` com o compose. Ela tambem roda
fora do smoke, sozinha:

```bash
bun run runner-labels:check        # 0 provado · 1 registro velho/vazio · 3 nao provado
```

**Zero label de um lado e divergencia, nao sincronia.** Um runner no ar e
registrado **sem label nenhum** e um runner ORFAO: existe na instancia e nao e
atribuido a job algum (a fila para, e nada acusa). Pelo mesmo motivo, um compose
que perdeu `GITEA_RUNNER_LABELS` nao tem o que comparar — e comparar vazio com
vazio nunca provou que a stack esta no ar. Os dois saem **1** (DIVERGENTE), com o
remedio de cada caso nas linhas `→` do relatorio: registro vazio ⇒
`bash deploy/gitea-up.sh --re-register`; compose sem a variavel ⇒ declare os
labels no servico `runner` e so entao re-registre (o registro so pega os labels
na SUBIDA).

A entrada e `runner-labels:check` (e nao `check:...`) DE PROPOSITO: um comando sob
`check:` e lido como gate portatil, e este so tem sentido no **host da forja** (a
mesma familia de `runner-image:ensure/check/prove`, que tambem dependem do
ambiente). Fora da forja ele sai **3** — nao conhece o registro, e nao inventa.

**O MESMO guard cobre o runner auto-hospedado do GITHUB** (`--forge github`, a
entrada `runner-labels:check:github`): la o registro nao tem arquivo — o `.runner`
do `actions/runner` nao guarda label nenhum —, entao o lado REGISTRADO vem da API
(`GET /repos/<owner>/<repo>/actions/runners`) e o DECLARADO, do
`RUNNER_LABELS` de `deploy/setup-github-runner.sh`. Mesmos exit codes e mesma
regra (sem token de self-hosted runners e **3**, nunca "em sincronia"; um runner
registrado mas OFFLINE e divergente). Detalhes em `deploy/GITHUB_RUNNER.md`.

### 3.3. Antes de publicar a imagem: `bun run forge-runtime:prove`

O doctor mede o repositorio, o registry e ESTE host. Ele nao mede o **runtime do
job**: os guards rodam num container, como outro usuario, com o `docker` do
runner e o workspace montado em outro caminho. Enquanto isso nao for ensaiado,
"os guards passam aqui" e uma promessa sobre a maquina de quem desenvolve.

```bash
bun run forge-runtime:prove                     # build + contrato + o job guards inteiro
bun run forge-runtime:prove --install           # fiel tambem no node_modules (roda bun install dentro; o node_modules
                                                # passa a pertencer ao usuario do container — use um clone de ensaio)
bun run forge-runtime:prove --only check:runner-base
bun run forge-runtime:prove --no-build          # reusa a imagem local (uma tag local pode estar velha)
```

Ele faz tres coisas, nesta ordem — e a ordem importa: **constroi** o
`Dockerfile.ubuntu-bun` com o `BUN_VERSION` declarado e marca a imagem com a
referencia que o compose pede; roda as **assercoes do contrato dentro do
artefato** (o mesmo bloco `RUN`, pelo mesmo guard da base); e so entao roda o
job `guards` **inteiro** dentro da imagem. Se o contrato nao passa, o job nem
roda: ensaiar a bateria contra um artefato suspeito diria "os gates passam la"
sobre a imagem errada.

A bateria nao e uma lista aqui: sai do job `guards` da propria pipeline que
decide o merge (`forgeRuntime:prove` usa a mesma derivacao do `doctor`), com o
comando vindo da linha `run:` — as flags sobrevivem. O relatorio mostra o
**ambiente** medido dentro do container (usuario, cwd, node, bun e caminho,
docker, plugin `compose`, socket, git, node_modules) e um resultado POR GATE, com
a saida do gate que falhou.

O socket do docker do host e montado como o runner faz (`/var/run/docker.sock`):
sem ele um gate que use o docker falharia por uma limitacao do ENSAIO, nao do
runtime. `--no-docker-sock` desliga e o relatorio declara isso.

Exit codes: `0` provado, `1` o contrato ou um gate quebrou dentro da imagem, `2`
nao deu para ensaiar (sem docker, build falhou, imagem ausente). Todo desfecho
tem o mesmo formato, entao `--json` serve de script. O que ele **nao** cobre esta
escrito no relatorio: o runner em si (registro, labels, agendamento), o valor real
de `vars.BUN_VERSION` (aqui vem do env local) e o `node_modules` da forja sem
`--install`.

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

O guard `bun run check:registry-source` falha se um `ghcr.io` solto voltar — e,
para nenhum alvo ficar invisivel por estar num diretorio nao varrido, exige uma
DECISAO ESCRITA (`OUT_OF_SCOPE_ALLOWLIST`, com motivo) para cada arquivo fora do
escopo que referencie imagem nossa. E,
na mesma passada, renderiza o `deploy/docker-compose.gitea.yml` com o
`docker compose config` para provar o que a label do runner **resolve**:
variavel vazia (um `${BUN_VERSIO}` de typo) ou tag literal (um
`${BUN_VERSION:-1.4.0}`) sao violacao, mesmo com o texto do compose parecendo
correto. Sem a ferramenta no ambiente o passo fica INDETERMINADO — avisa, nao
falha, e o `doctor` registra "interpolacao nao provada" —, **mas nao na forja**:
la o render e exigido (`--require-compose`, usado pela Prova 4 do smoke), porque
a imagem do job embarca o plugin. O contrato do plugin e do BUILD da imagem
(`Dockerfile.ubuntu-bun`, que falha sem ele) e conferido de novo na imagem
**publicada** pelo step `Verify mirror digest` do `sync-ubuntu-bun-mirror.yml`.
Ver `docs/GUARDS.md` secao 6.

### Checks obrigatorios para merge

A lista e declarada em `ci/required-checks.json` e aplicada com
`node scripts/apply-required-checks.mjs --forge gitea` (dry-run por padrao;
`--apply` exige token com permissao de administracao). Os contextos exigidos sao
os `name:` dos jobs — hoje `Lint`, `Repo Guards`, `TypeCheck`, `Tests`, `Build`.
O guard `check:forge-parity` garante que um gate novo nao fique so em uma das
pipelines (GitHub x esta forja).

### Smoke test da forja (manual)

Os guards leem YAML; eles nao veem o RUNTIME desta forja. Quatro pressupostos so
existem quando o pipeline roda de verdade: o contexto `vars` hidratar, a cadeia
do setup funcionar por `run:` (com o tier-1 da imagem do runner engajando), o
runtime instalado ser exatamente o da variable, e o **registro do act_runner**
(`/data/.runner`) ser o que o compose declara. O workflow
`.gitea/workflows/forge-smoke.yml` prova os quatro.

Como rodar: **Actions** -> **Forge Smoke (manual)** -> **Run workflow**
(`workflow_dispatch`, na branch `main`). Leva ~1 min.

| Passo                                 | O que prova                                                                               | Se falhar                                                                                                                                        | Remedio                                                                                                                                                                                                                                                                        |
| ------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1 — `vars.BUN_VERSION` resolve        | o contexto `vars` existe nesta instancia                                                  | valor vazio = a variable nao foi criada (ou o runner e antigo)                                                                                   | criar a variable em **Settings -> Actions -> Variables**; se o job morrer ANTES do passo 1 com `Unknown Variable Access vars`, a instancia nao suporta o contexto — recriar o container `runner` na versao 1.22+ (`docker compose pull runner && docker compose up -d runner`) |
| 2 — composite local executa           | `uses: ./.github/actions/setup-bun` resolve relativo ao checkout                          | o job falha ao resolver o action (antes de rodar qualquer comando)                                                                               | ver **"Se o passo 2 falhar"** abaixo — renomear o diretorio **NAO** resolve                                                                                                                                                                                                    |     |
| 3 — runtime == variable               | mesmo commit -> mesmo runtime em qualquer pipeline                                        | `bun x.y.z != BUN_VERSION`                                                                                                                       | a imagem do runner embarca outro Bun e ele vem antes no PATH, ou o cache do Bun nao invalidou (key `bun-<versao>-<os>-<arch>`)                                                                                                                                                 |
| 4 — install + guards (render EXIGIDO) | o runner resolve dependencias, roda os guards e RENDERIZA o compose (`--require-compose`) | erro de rede/registry; ou `--require-compose` sem o render provado = a imagem nao embarca o plugin `compose`, ou o job nao tem o docker socket   | liberar o registry de pacotes e o espelho OCI no runner; para o render, reconstruir a imagem (o build exige o plugin) e checar o socket do job — `container.docker_host: -` no `config.yaml` do runner **desliga** a montagem que faz isso funcionar                           |
| 5 — registro == compose               | os labels GRAVADOS no runner sao os que o compose declara                                 | `REGISTRO VELHO` = o job roda na imagem antiga, sem tier-1, sem outro sintoma; `NÃO PROVADO` = sem docker/socket no job, ou container fora do ar | `bash deploy/gitea-up.sh --re-register` (para o registro velho); para o não-provado, dar ao job o acesso ao docker socket — `container.docker_host: -` no `config.yaml` do runner **desliga** a montagem que faz isso funcionar                                                |

**Se o passo 2 falhar (o composite local nao resolve).** O act_runner resolve um
action local como `filepath.Join(Config.Workdir, uses)` — verificado em
`gitea/act`, `pkg/runner/step_action_local.go`, o fork que o act_runner usa. O
**nome do diretorio nao participa** dessa decisao: criar
`.gitea/actions/setup-bun/` e apontar os call sites para lá **nao muda o
resultado** — com o mesmo `Config.Workdir`, ou os dois caminhos resolvem, ou
nenhum resolve. (`FORGE_ACTIONS_DIRS` cobre `.gitea/actions` nos guards para que
uma action local escrita lá nao fique invisivel; nao e um plano B de resolucao.)

Causas reais, em ordem de probabilidade:

| Causa                                                                                                                          | Sintoma                                                      | Remedio                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `Config.Workdir` do runner nao e a raiz do checkout (modo host com `workdir_parent`, ou job container com workspace diferente) | o erro cita um caminho fora do repositorio                   | alinhar o `config.yaml` do runner para que o Workdir seja o checkout, ou rodar em container mode |
| O checkout nao contem `.github/actions/` (sparse checkout, espelho com filtro de path, checkout parcial)                       | o diretorio simplesmente nao existe no job                   | garantir checkout completo — é aqui que um espelho que exclui `.github/` apareceria              |
| act_runner antigo, sem suporte a composite action local                                                                        | o runner trata o `uses:` como action remota e tenta baixa-la | subir o runner (`docker compose pull runner && docker compose up -d runner`)                     |

**Se nenhum `uses: ./` resolver**, a saida estrutural nao e renomear o diretorio —
é deixar de depender do resolvedor de actions: mover o setup para um script do
repositorio e chama-lo por `run:` (o `run:` nunca passa pelo resolvedor). É um
refactor maior (o composite tem 3 tiers e os guards leem seus call sites), entao
vale confirmar antes; em troca é a unica alternativa que de fato remove a
dependencia.

Saida esperada (verde):

```
✅ vars.BUN_VERSION = 1.3.14
   registry desta forja: ghcr.io
✅ Bun pré-instalado: 1.3.14 (0s, sem download)     # ou o tier 2/3
✅ bun 1.3.14 == vars.BUN_VERSION
check-registry-source: ✅ interpolacao do compose da forja provada — 3 fases ok ...   # Prova 4, com --require-compose
check-runner-labels: ✅ o registro do act_runner é o do compose — 2 label(s) registrado(s) idênticos ao compose.
============================== FORGE SMOKE ==============================
BUN_VERSION      : 1.3.14   (vars.BUN_VERSION)
IMAGE_REGISTRY   : ghcr.io (fallback = ghcr.io)
=========================================================================
```

O relatorio final imprime `IMAGE_REGISTRY` resolvido — resposta direta para
"a variable do registry ja foi criada ou ainda estou no default?".

**NUNCA torne este job um required check.** Ele so roda por `workflow_dispatch`:
um required check que nao reporta status num PR nao falha, ele faz o PR ESPERAR
para sempre. Pelo mesmo motivo ele nao esta em `ci/required-checks.json` (o
applier resolve os contextos a partir do `ci.yml`, e recusaria um job que nao
existe la).

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

# Ensaio do runtime (build + contrato + a bateria de guards DENTRO da imagem)
bun run forge-runtime:prove
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
