# Corte do GitHub — o que ele sustenta hoje e o plano, em etapas

> **Data**: 2026-09-20
> **Por quê**: o projeto não usa tecnologia paga nem componente proprietário, e a
> **forja dona do merge é a Gitea** (o `ci/required-checks.json` tem uma lista por
> forja e o `check:forge-parity` exige o MESMO comando das invariantes do CORE nas
> duas). Mesmo assim, o GitHub sustenta coisas que nenhum PR mostra: 27 workflows,
> 9 crons, 14 actions de terceiro, o GHCR como registry, o `gh` em 14 scripts, o
> **runner auto-hospedado de todos os jobs** e 7 serviços que não portam por
> `git push`. Este documento é o inventário **medido** disso e o plano de saída.
> **Medido por**: `bun run check:github-dependencies` — a tabela declarada vive em
> `ci/github-dependencies.json`, e o guard **falha** quando uma dependência nova
> do GitHub entra sem etapa e substituto escritos.

---

## 1. O que o GitHub sustenta hoje (medido)

| classe                               | medido | onde vive                                                                                                                                                                 | etapa |
| :----------------------------------- | -----: | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----: |
| **workflows**                        |     27 | `.github/workflows/*.yml` — a pipeline do espelho                                                                                                                         |     5 |
| **crons**                            |      9 | `schedule:` nesses workflows (benchmarks, espelhos, auditorias)                                                                                                           |     2 |
| **actions de terceiro**              |     14 | `uses:` de marketplace (`actions/*`, `docker/*`, `appleboy/`, `hostinger/`, `docker://rhysd/actionlint:latest`) — inclui `actions/checkout` em **duas** versões (v4 e v5) |     4 |
| **workflows reusáveis**              |      3 | `uses: ./.github/workflows/*.yml` (quality-gate, seed-guards, utf8-check)                                                                                                 |     5 |     | **`ghcr.io`** | 50  | ocorrências em arquivo de código (composes, Dockerfiles, workflows com fallback, scripts) — **63** antes do flip da etapa 1; o que sobrou é prosa e terceiro declarado | 1   |
| **`gh` CLI**                         |     14 | scripts que falam a API do GitHub com credencial de administração                                                                                                         |     3 |
| **plano de configuração do Actions** |    420 | ocorrências de `vars.`/`secrets.`/token nos workflows do GitHub                                                                                                           |     2 |
| **serviços do GitHub**               |      7 | Dependabot, github-script, dependency-review, actionlint, transporte de artifact, runner auto-hospedado, Gist                                                             |     3 |

Os 7 serviços, cada um com o substituto que **não** é o mesmo dos outros:

| serviço                | o que ele faz hoje                      | substituto                                                                          |
| :--------------------- | :-------------------------------------- | :---------------------------------------------------------------------------------- |
| Dependabot             | bump de dependência                     | Renovate (open source, self-hostável) ou a automação de bump do próprio repositório |
| github-script          | passo com script inline no runner       | o canal de comentário próprio (`pr-comment-channel.mjs`)                            |
| dependency-review      | advisory de dependência no PR           | o `bun-audit` CORE (já roda nas duas forjas)                                        |
| actionlint             | lint de workflow pelo container oficial | os guards de YAML da casa (julgam mais)                                             |
| transporte de artifact | passar arquivo entre jobs               | volume/tmp do runner próprio                                                        |
| runner auto-hospedado  | executa **todos** os 27 workflows       | o act_runner da Gitea (já roda as 7 pipelines de lá)                                |
| Gist                   | publicação do benchmark do espelho      | o próprio repositório/registry como fonte                                           |

## 2. O que já está a meio caminho (medido)

| já existe                   | medido                                                                                                                   |
| :-------------------------- | :----------------------------------------------------------------------------------------------------------------------- |
| paridade de gates           | **32 invariantes do CORE** com o MESMO comando nas duas pipelines (`check:forge-parity`)                                 |
| contrato de merge por forja | `ci/required-checks.json` com lista por forja; o drift vira **issue** quando a proteção registrada diverge               |
| canais acionáveis           | **13 scripts** falam as duas forjas (`--backend`/`--forja`); **5** ainda só o GitHub (abaixo)                            |
| registry                    | `IMAGE_REGISTRY`/`IMAGE_NAMESPACE` parametrizados, `check:registry-source` como guard e o `env-mirror` no bring-up       |
| stack da forja              | `deploy/docker-compose.gitea.yml` (Gitea 1.22 + act_runner + Caddy), `deploy/gitea-up.sh`, **7 workflows** e **4 crons** |
| doutor                      | `check:doctor-ci` publica o estado e, no cron, a issue pelo canal que a marcou (`--backend gitea`)                       |

Os 5 scripts que ainda só falam GitHub (o corte da **etapa 3**): `bench-setup-bun.mjs`,
`measure-mutation-timing.mjs`, `measure-mutation-trend.mjs`,
`check-default-branch-workflows.mjs` e `readme-reverse-issue.mjs` — este último é o
único **publicador** sem `--backend gitea`. (O canal compartilhado
`issue-publish.mjs`, por onde passam todos os publicadores de dívida, chama o `gh` — e
é ele que o corte da etapa 3 tem de levar para a forja primeiro: com ele no alvo, os
publicadores já migrados passam a escrever na forja **sem edição**.)

## 3. O plano, em 5 etapas

Cada etapa é **shippable sozinha** e tem um ato próprio no inventário. A ordem não é
estética: a etapa 1 muda o _valor_ (de onde a imagem vem), a 2 muda o _agendador_, a 3
muda os _canais_, a 4 desacopla os _serviços de Actions_ e a 5 desliga a _pipeline do
espelho_. Inverter 5 antes de 2 deixaria os crons rodando num lado sem veredito.

### Etapa 1 — Registry próprio + as duas imagens

- **Entrega**: as duas imagens (mirror do Bun e `ubuntu-bun` do runner) publicadas no
  registry OCI embutido da Gitea/Forgejo; flip de `IMAGE_REGISTRY`/`IMAGE_NAMESPACE`
  (uma variável cada — o desenho já é parametrizado e tem guard).
- **O que muda no veredito**: `check:registry-source` e o `env-mirror` do bring-up
  passam a comparar contra o registry próprio; o doctor para de depender de credencial
  do GHCR para provar a tag.
- **Prova**: o valor do default e das referências passa a bater com o registry próprio, e a
  tag é resolvida no registry novo. As duas imagens publicadas **no registry embutido de
  uma forja de verdade** voltam por `@sha256:` — é o que o `gitea-registry:prove` mede
  (Ato 1b-bis abaixo), contra um Gitea 1.22 EFÊMERO.
- **Pela metade**: com o flip feito e uma imagem não publicada, o runner sobe com
  `pull` falhando — a etapa só fecha com as **duas** imagens lá.

#### Ato 1a — o flip do valor declarado (feito em 2026-09-20, neste commit)

O valor saiu de `ghcr.io` em **todos** os lugares onde o repositório AFIRMA um valor
(não só onde ele o consome):

| onde                                                                                           | o que mudou                                                                                                    |
| :--------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------- |
| `.actrc`                                                                                       | `--var IMAGE_REGISTRY=git.severinno.cloud` (o espelho local do act)                                            |
| `deploy/env.gitea.example`, `.env.production.example`                                          | o valor declarado dos dois templates (o GHCR passou a ser a linha de ROLLBACK, com o motivo escrito)           |
| `deploy/docker-compose.gitea.yml` + `docker-compose.prod.yml` + `docker-compose.hostinger.yml` | 10 defaults `${IMAGE_REGISTRY:-…}` (inclusive os `GITEA_RUNNER_LABELS`, que decidem a imagem que roda os jobs) |
| `scripts/setup-bun-ci.sh`, `scripts/act-startup-bench.sh`, `scripts/publish-ubuntu-bun.sh`     | o default/resolução do registry (este último tinha `ghcr.io` CRAVADO — sobrevivia à virada)                    |
| 10 workflows (8 GitHub + 2 Gitea)                                                              | 13 fallbacks declarados `\|\| 'ghcr.io'`                                                                       |

**Evidência medida** (o guard, no mesmo commit): a classe `ghcr-images` do inventário caiu
de **63 → 50** (`check:github-dependencies --update` é o ato que congela o número; o último
dos 13 caiu quando a checagem de `RepoDigest` do publisher passou a comparar contra o
registry DECLARADO em vez do literal). O escopo da contagem é o **código que roda** — a
prosa do PRÓPRIO auditor (o cabeçalho do guard e o `porque` da classe) fica fora dele
(`ARQUIVOS_DO_AUDITOR`): ela _descreve_ o número, e contá-la subia o medido de 50 para 52 no
próprio commit que declarou a classe. E a
régua de valor continua verde — `check:registry-source`: **27 defaults em 14 arquivos,
nenhum divergente do declarado**, com o render do compose provado (`declarado =
deploy/env.gitea.example`). O `--update` também registrou **420 → 419** em
`actions-plane`, e a ocorrência que caiu é um `vars.IMAGE_REGISTRY` citado num COMENTÁRIO
(a contagem lê o arquivo inteiro) — está escrito no `porque` da classe.

#### Ato 1b — a publicação das duas imagens (evidência executada aqui)

Os dois artefatos foram publicados num **registry OCI de verdade** (`registry:2`, a mesma
forma que o `image-contract:prove` usa), com a tag local REMOVIDA antes do pull-back — o
que se lê abaixo é o artefato que o registry serve, não o cache local:

| imagem                  | ref publicada                        | digest servido     | evidência DENTRO do artefato puxado                                         |
| :---------------------- | :----------------------------------- | :----------------- | :-------------------------------------------------------------------------- |
| `ubuntu-bun` (o runner) | `<registry>/prova/ubuntu-bun:1.3.14` | `sha256:fd027ee7…` | `bun --version` → `1.3.14`                                                  |
| mirror do Bun           | `<registry>/prova/bun:1.3.14`        | `sha256:e497cb4d…` | `docker create`+`docker cp` → `bun --version` → `1.3.14` (91.802.480 bytes) |

O mirror é publicado como `scratch` (o consumidor é o `docker cp` do tier-3 do
`setup-bun-ci.sh`), então a evidência dele é a EXTRAÇÃO do artefato publicado e a versão
que sai do binário extraído — rodar a imagem inteira não é o caminho do consumidor
e falha por desenho (não há libc no `scratch`).

Fato do host onde o ato rodou: o daemon **recusou matar o container** do registry de prova
(`permission denied` em `kill`/`stop`) — a MESMA limitação que o `image-contract:prove` já
declara (e a razão da porta FIXA `5177` com reuso, em vez de porta sorteada). O container
fica vivo naquela porta e quem tiver permissão o remove com
`docker rm -f prova-publicacao-registry`; nada da prova depende dele depois do pull.

### Etapa 2 — Os 9 crons e as vars do Actions

- **Entrega**: os agendadores migrados (benchmarks, espelhos de toolchain, auditoria de
  required checks, guard do fast path) e as repository variables replicadas na forja.
- **O que muda no veredito**: o cron que hoje reporta por issue passa a rodar na forja
  dona do merge; a divergência de `vars` deixa de ter duas fontes.
- **Prova**: cada comando migrado roda verde no agendador novo **e** o inventário da
  classe `crons` cai no mesmo commit (o `--update` é o ato).
- **Pela metade**: um cron migrado e o antigo ainda ativo = duas issues para o mesmo
  defeito (e ninguém sabe qual é a canônica).

### Etapa 3 — Os canais só-GitHub e o `gh`

- **Entrega**: os 5 scripts acima falando a forja (o `readme-reverse-issue` é o único
  publicador) e o `issue-publish.mjs` com backend de forja; Dependabot substituído; `gh`
  fora do fluxo versionado.
- **O que muda no veredito**: nenhum canal acionável depende de credencial de outra
  forja; a issue de dívida passa a nascer no lado onde a mudança aconteceu.
- **Prova**: o mesmo defeito publicado nas duas forjas (o padrão já existe nos testes de
  canal: dublê de forja + corpo reconciliado).
- **Pela metade**: um canal migrado e o outro não = o mesmo drift abre **duas** issues,
  ou abre uma no lugar errado.

### Etapa 4 — Serviços acoplados a Actions

- **Entrega**: transporte de artifact, `github-script`, `dependency-review`, `actionlint`
  e Gist resolvidos por ferramenta do repositório (o `dependency-review` e o `actionlint`
  caem sozinhos: o `bun-audit` e os guards de YAML já cobrem).
- **O que muda no veredito**: o CI do espelho deixa de depender de código de terceiro
  baixado a cada job; as tags (`@v4`, `latest`) deixam de envelhecer sozinhas.
- **Prova**: os passos equivalentes rodando no runner próprio com o mesmo veredito.
- **Pela metade**: artifact migrado e `needs:` do job ainda lendo o transporte antigo =
  job que passa por não receber nada.

### Etapa 5 — O runner auto-hospedado e a pipeline do espelho

- **Entrega**: jobs do GitHub desligados, `deploy/GITHUB_RUNNER.md` e
  `setup-github-runner.sh` removidos; o repositório fica como **espelho read-only** do
  bundle (a rede de segurança da migração).
- **O que muda no veredito**: a paridade deixa de ser MEDIDA entre duas pipelines e passa
  a ser por DESENHO (uma pipeline só) — o `check:forge-parity` continua rodando como
  contrato do que sobrou, e o manifesto por forja fica com uma lista.
- **Prova**: o `merge-gate:prove` rodando contra a única forja e o required check
  aplicado (o cron de drift confirma).
- **Pela metade**: espelho sem runner e ainda com `required checks` no GitHub = PRs
  travados esperando um check que nunca mais roda.

## 4. Durabilidade ≠ colaboração (o que o corte NÃO é)

Um **repositório local** (bare mirror, `git bundle`) não substitui a forja: sem PR,
checks, issues e UI não existe o portão de merge que este repositório passou a
construir — e é justamente o portão que a thread inteira mediu (o `pre-commit`
bloqueando de verdade, o `merge-gate:prove`, o cron de drift dos required checks). O
espelho local é a camada de **durabilidade** (backup offsite, recuperação), e ela
convive com qualquer forja. O que sai no corte é a forja que **não** é dona do merge,
não a ideia de forja.

Depois da etapa 5, o que sobra do lado GitHub é: o histórico (`git push` do bundle, ou
nada), as **issues** antigas e os `refs/pull/*` do
[`GITHUB_SUPPORT_PURGE.md`](./GITHUB_SUPPORT_PURGE.md) — que continuam sendo pedido ao
suporte, não trabalho de repositório.

## 5. Como isso fica medido (a catraca)

`scripts/check-github-dependencies.mjs` mede as 8 classes **das fontes do repositório**
(nunca de uma lista à mão) e confere contra `ci/github-dependencies.json`:

| direção                                | o que significa                                 | o que fazer                                                   |
| :------------------------------------- | :---------------------------------------------- | :------------------------------------------------------------ |
| item medido **novo**                   | uma dependência nova do GitHub entrou           | declarar a etapa e o substituto **antes** de mergear          |
| item declarado que **sumiu**           | o corte aconteceu e o inventário não acompanhou | `--update` no MESMO commit (revisando o diff)                 |
| contador medido **maior**              | a classe cresceu                                | a catraca só anda para baixo                                  |
| contador medido **menor**              | o número mente sobre o que ainda existe         | `--update` no mesmo commit                                    |
| classe medida **sem declaração**       | um TIPO novo de dependência                     | decisão humana: etapa + substituto + por quê                  |
| classe sem **etapa** ou **substituto** | dependência sem plano                           | escrever o plano (é o que este documento existe para impedir) |

**`--update` é o ato mecânico do corte**: ele reescreve só o campo medido
(`declarado`), preservando a prosa — e ele **não** cria classe nova, porque classificar
um tipo novo de dependência é decisão de gente.

## 6. Limites declarados (o que este documento NÃO promete)

- **A contagem é por classe e por regra**: `docs/`, os testes e as provas por mutação
  ficam fora (o texto do defeito é _payload_ de teste), então uma menção a `ghcr.io` em
  prosa não é medida — o `README.md` da raiz, porém, conta: ele é a porta de entrada e
  diz de onde puxar a imagem. E um teste que dubla o `gh` não conta como dependência;
  o escopo do `gh` é `scripts/` + `.husky/`.
- **O que o GitHub sustenta fora do repositório não aparece aqui**: issues, PRs, as
  repository variables e secrets, as releases, o runner no VPS e os `refs/pull/*` do
  purge são estado da forja, não arquivo versionado — o inventário mede o que um commit
  pode criar ou remover.
- **O documento não promete que o corte será feito**: ele promete que o corte **não anda
  para trás em silêncio** e que cada etapa tem entrega, prova e o que fica quebrado pela
  metade.
- **A ordem não é uma data**: cada etapa é shippable sozinha, e a decisão de qual vem
  primeiro é de operação (a documentação da etapa 1 e 2 é a mais barata de executar).
- **O medidor das etapas mede CONTRATOS, não as pipelines rodando**: ele lê os gates, a
  paridade e os contextos da árvore transformada; quem executa os gates de verdade dentro
  da imagem é o `forge-runtime:prove`. As transformações também são TEXTUAIS (um `uses:`
  substituído vira um passo `run:` e o `with:` vizinho fica, porque o que se mede é o
  veredito dos contratos). E ele **não é um step das pipelines**: `prove-cut-stages` seria
  descoberto como gate novo e exigiria classificação CORE nas duas forjas — decisão que
  esta etapa não toma.
