# Guards do repo — catálogo e PORQUÊ de cada família

> Meta-tooling consolidado (2026-08). O repo tem ~150 scripts; este documento
> explica o **porquê** de cada família de guard, para que o crescimento seja
> deliberado: um guard NOVO deve caber numa família existente (ou justificar
> uma nova com este doc atualizado). Antes de criar `scripts/check-foo.mjs`,
> pergunte: "qual família cobre este risco?".

## Como ler este catálogo

Cada família lista: **o que protege**, **por que existe** (o incidente/regressão
que motivou), **onde roda** (hooks/CI/cron/manual) e **como testar**. O critério
de aceite de um guard novo: ele precisa ter (1) teste unitário das funções
puras, (2) teste CLI quando aplicável (spawn real, exit code), e (3) quando
possível um **mutation test** (scripts/test-mutation-*.sh) provando que o guard
REALMENTE pega a regressão.

---

## 1. Encoding guards — `check-utf8`, `check-crlf`, `check-blob-crlf`, `check-single-line-out-assign`

**O que protege:** zero CRLF/UTF-8 quebrado no working tree, no staged e no
histórico; padrão `out=` de um só arquivo.

**Por que existe:** Windows + Git sem `core.autocrlf` consistente gerava blobs
CRLF commitados que quebravam builds Linux e diff em PRs. O guard trava o
presente (CRLF/UTF-8), o escopo (`src/` só para utf8, `scripts/` só para
single-line), o staged (pre-commit) e o histórico (audit de blobs — o histórico
não pode ser reescrito por CI, então é auditoria periódica + rotação manual).

**Onde roda:** `.husky/pre-commit` + `.husky/pre-push` via
`scripts/run-encoding-guards.sh` (orquestrador único); jobs no pr-check.yml e
cron no benchmark-weekly.yml (auditoria histórica `--all-text`).

**Família relacionada:** `check-encoding-guards-badge` valida que a tabela do
README (Encoding Guards) bate com os guards reais dos hooks — doc não pode
driftar do código.

---

## 2. Mirror do Bun / fonte única — `check-bun-mirror`, `check-actrc-sync`, `check-no-setup-bun`, `check-setup-bun-common`, `check-setup-bun-warm`

**O que protege:** a versão do Bun tem UMA fonte de verdade
(`vars.BUN_VERSION`); mirror GHCR e Dockerfiles alinhados; setup-bun sem
literal.

**Por que existe:** versões hardcoded (bun@1.2 no Dockerfile, bun-1.3.14- nas
cache keys, bun-version: 1.3.14 nos workflows) criavam múltiplos pontos de
verdade — bump da variável não invalidava caches nem imagens. O guard caça
literais em workflows, Dockerfiles, .actrc e lockfiles estrangeiros
(package-lock.json/pnpm-lock.yaml são proibidos; só bun.lock).

**A varredura que faltava: SCRIPTS e COMPOSES (invariantes 15/16).** O workflow
já era caçado, mas o **script** e o **compose** não — e o sintoma deles é o pior
possível, porque nada fica vermelho: o script continua FUNCIONANDO depois do
bump (só com a versão antiga) e o compose continua subindo (só com o build arg
errado). Medido na auditoria de 09/2026: 11 literais vivos, entre eles
`process.env.BUN_VERSION || "1.3.14"`, `ACTRC_BUN="${ACTRC_BUN:-1.3.14}"`,
`bunVersion = "1.3.14"` num sandbox, exemplos de ajuda que se passavam por
versão vigente, e **dois composes divergentes** — `docker-compose.hostinger.yml`
com default `1.4.0` [divergente] e `docker-compose.staging.yml` com
`BUN_VERSION: "1.4.0"` [divergente]
PURO (sem `${...}`: nenhum bump jamais o alcançaria) enquanto o repositório
declara 1.3.14.

A regra do CÓDIGO: literal **PREFIXADO** pelo nome (`bun-1.3.14`, `bun@1.3.14`,
`bun-v1.3.14`, `ubuntu-bun:1.3.14`) ou semver **COMPLETO** numa linha de código
que fala do Bun (`|| "1.3.14"`, `:-1.3.14`, `= "1.3.14"`). Duas exclusões são
estruturais e escritas no header: **comentário** (é onde o comportamento aparece
como exemplo — e é julgado pela invariante 17, abaixo) e **SENTINELA** — um valor
com sufixo não-numérico (`9.9.9-sentinel`) não é uma AFIRMAÇÃO de versão, e é
assim que uma fixture precisa de um valor falso sem cravar o número da vez. O
remédio dos scripts é o
módulo `scripts/bun-version.mjs`: `requireBunVersion()` resolve env → `.actrc` →
`deploy/env.gitea.example` e **LANÇA** quando não há declaração — o default
silencioso era justamente o defeito. Nos composes, o default continua permitido
(mesmo desenho do `checkComposeImageDefaults` do `check-registry-source`), mas
só se for **igual ao declarado** no espelho; um literal puro é violação sempre.
Os defaults dos composes entraram no `bump-bun.sh` (o default é um espelho: se o
bump não o escrevesse, o próprio bump terminaria vermelho). A varredura roda no
modo global E no `--staged` — é na EDIÇÃO que o literal nasce.

**A metade que sobrava: os EXEMPLOS DE VERSÃO EM PROSA (invariante 17).** O
comentário era excluído da regra de código de propósito — e é exatamente onde o
cabeçalho de um script, o README e este doc ENSINAM o comando. Depois do bump a
doc seguia imprimindo `BUN_VERSION=1.3.14`, `--expected 1.3.14`,
`ubuntu-bun:1.3.14`, e **nada ficava vermelho**: doc não executa, então o sintoma
é quem copia o exemplo medir/rodar a versão antiga. A regra aqui é a INVERSÃO da
invariante 15 — na prosa a menção **ancorada** (o valor preso a um token do Bun:
`BUN_VERSION=…`/`: …`/`${…:-…}`, `bun-version: …`, `--expected`/`--bun-version`,
`bun[-@:/]v?X.Y.Z` — inclusive `ubuntu-bun:` —, o argumento do `setup-bun-ci.sh`,
o argumento do `bump-bun.sh` e a transição `1.3.14 → 1.3.15`) tem de **bater com
o valor declarado** nos espelhos. Semver solto que não fala do Bun
(`act 0.2.89`, `lodash 4.17.21`, `release/v0.4.0`) não é exemplo da versão e não
é julgado — exigir a coincidência de todo semver faria o guard brigar com a
prosa que ele existe para proteger. Um exemplo que precisa divergir declara o
PAPEL na própria linha, e o papel é checado nos DOIS sentidos (marcar o vigente
como contra-exemplo é tão falso quanto o exemplo velho sem marca):
**`[divergente]`** = contra-exemplo (tem de DIFERIR do vigente);
**`[próxima]`** = alvo do bump (tem de ser MAIOR, em comparação semver — um alvo
igual ao vigente é um exemplo que não faz nada). O doc `docs/BUN_BUMP.md` é um
**cenário declarado** (`PROSE_SCENARIO_DOCS`, com data e motivo no header): o
walkthrough cita o alvo ponta a ponta, então ali vale o vigente OU um valor
maior, e nada mais — uma decisão datada em vez de 15 marcadores no meio do
procedimento. As fontes são os `*.md` do worktree (menos `PROSE_IGNORED_DIRS`:
saída de build/medição não é doc do repo) e os **comentários** dos scripts,
inclusive o de FIM DE LINHA; um doc canônico que existe e para de citar a versão
derruba o piso de cobertura (verde por vazio é o defeito, não a ausência de
exemplo). **Prova por mutação** (`test-mutation-bun-literal.sh`, STEP 7): no repo
fixture, um exemplo desatualizado no README reprova o guard nomeando o arquivo, e
a cópia do guard sem a chamada da varredura passa — enquanto o literal de
workflow segue reprovado na mesma cópia (a mutação é cirúrgica).

**O valor, que o estático não alcança:** as variáveis que o compose da forja
consome têm espelhos no working tree — `.actrc` (o act local não lê as
variables do repositório) e o env da forja: `deploy/env.gitea.example` (o
template comitado) e `deploy/.env.gitea` (o arquivo do HOST que o compose lê de
verdade, gitignored — logo só existe nocheckout que roda a stack). O `check-actrc-sync` compara os VALORES de cada um com a repository variable
correspondente (a variável remota só existe em runtime, então nenhum guard
estático pode fazer isso) e DESCOBRE o env do host quando ele está presente; um
aviso que não nomeia QUAL arquivo drifta não é acionável.
Aqui os modos de falha são silenciosos: o `.actrc` desatualizado faz o act
testar outra versão, e o env desatualizado desliga o fast path de 0s do tier-1
da forja sem deixar o CI vermelho (o setup-bun funciona igual, só mais lento).

**Não é só a versão — TODA variável do compose tem o VALOR comparado.**
`BUN_VERSION`, `IMAGE_REGISTRY` e `IMAGE_NAMESPACE` são as três que o compose
da forja consome (`${...}` em `deploy/docker-compose.gitea.yml`) e montam a tag
da imagem do runner. Até esta extensão, registry e namespace só passavam pelo
`check-registry-source` (que exige a **existência** da flag no `.actrc` e a
declaração do nome no template): um valor trocado — outro registry, outro
namespace — atravessava tudo em silêncio, e o sintoma é o pior tipo, porque o
pull da imagem só falha quando um job tenta iniciar, longe da causa. O conjunto
comparado não é lista à mão: sai de `COMPOSE_ENV_VARIABLES` (derivado das
referências do compose) menos o segredo declarado, e um teste FALHA se um nome
novo no compose não estiver classificado — variável nova não entra apenas com a
checagem de existência. Onde cada variável é espelhada é uma decisão escrita
(`MIRROR_VARIABLE_RULES`): `IMAGE_NAMESPACE` **não** vive no `.actrc` (os
workflows a usam com fallback `vars.IMAGE_NAMESPACE || github.repository_owner`
e o act local resolve pelo fallback) — cobrá-la ali seria um aviso permanente
que o procedimento documentado não consegue silenciar. `RUNNER_TOKEN` fica
FORA e a exclusão é declarada (`SECRET_MIRROR_VARIABLES`): no template é
placeholder e no host é o token real — comparar valor exigiria versioná-lo
(quem confere presença e diferença é o `check-env-mirror.mjs`, no bring-up).
Uma variável cujo valor NÃO foi passado à run sai como NÃO COMPARADA e é
nomeada no log — nunca apresentada como conferida.

**Roda nos DOIS lados, com o mesmo script e as mesmas regras:** no GitHub pelo
job semanal `actrc-sync` (`benchmark-weekly.yml`) e na forja por
`.gitea/workflows/actrc-sync.yml` (mesmo cron). A forja precisa disso por ser
dona do merge _e_ o único host cujo checkout tem o `deploy/.env.gitea`.

**O que muda entre os lados é só o CANAL, e a diferença é deliberada:**

| lado       | guard                                    | canal acionável                                                                                                                                                           |
| :--------- | :--------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **forja**  | mesmo script, **`--fail`**               | status do run — lá não existe canal de issue, e `::warning::` dentro de um run verde não é lido por ninguém                                                               |
| **GitHub** | mesmo script, modo aviso (`::warning::`) | **issue** publicada por `actrc-sync-issue.mjs` (label `actrc-sync-drift`), com dedup por assinatura — e **fechada automaticamente** quando os espelhos voltam a concordar |

**A regra é uma só (defeito real, medido e corrigido):** a documentação e o
header da forja já diziam "no GitHub o alerta acionável é a ISSUE aberta pelo job
irmão" — e **não existia job irmão nenhum**. O drift saía como `::warning::`
dentro de um run VERDE: um alerta mudo, exatamente o que o
`required-checks-drift-issue.mjs` e o `readme-reverse-issue.mjs` existem para
evitar. Hoje o step `if: always()` do job roda `actrc-sync-issue.mjs`, que
importa `mirrorDriftReport` **do próprio guard** — a issue e o log não podem
discordar, porque quem decide o que é drift é uma função só (o CLI e o
publicador consomem o mesmo diagnóstico). A assinatura do drift é estável
(duas runs do mesmo drift → mesma assinatura), então a issue é o **estado da
dívida até ser fechada**, não ruído semanal.

**A assinatura mora no CORPO e nos COMENTÁRIOS — e isso é uma correção, não um
detalhe.** O primeiro drift abre a issue (marcador no corpo); um drift
**diferente** (outra versão, outro arquivo) vira comentário, e o marcador fica
lá. Enquanto o dedup comparava só o corpo, a run seguinte via "assinatura
desconhecida", não achava o comentário da run anterior e **comentava de novo —
todo cron semanal**. Pelo mesmo motivo o reconciliador precisa dos comentários:
uma issue nossa com o marcador só num comentário era tratada como **alheia** e
nunca fecharia. A prova disso é um `gh` **dublê com estado** no teste: o dedup
não é uma conta, é um **ciclo** entre runs, e o defeito só aparece na segunda
(ver `src/lib/__tests__/actrc-sync-issue.test.ts`).

**E o fechamento é parte do alerta (o outro lado, corrigido depois):** publicar
sem fechar deixava uma dívida **mentindo** no board depois de resolvida — quem
abre o filtro do label acha que o drift existe, o próximo bump é investigado
duas vezes, e um alerta cujo procedimento documentado não consegue limpar acaba
ignorado (mesmo raciocínio do leitor sem escritor, acima). Quando o diagnóstico
não tem aviso nenhum, o mesmo script **reconcilia**: comenta o que foi comparado
(os espelhos, com o valor de cada um — a prova) e fecha as issues **que ele
mesmo abriu**. Três decisões que fazem o fechamento ser confiável:

- **comenta ANTES de fechar** — o pior caso de uma falha no meio é uma dívida
  aberta COM a prova anexada, nunca uma issue fechada em silêncio;
- **só fecha o que é NOSSO**, identificado pelo marcador que o próprio script
  deixou no corpo — label é etiqueta de triagem, e alguém pode aplicá-lo numa
  issue que não é de drift: essa é reportada no log e fica **intocada**;
- **declara o ESCOPO** no comentário: num runner do GitHub o `deploy/.env.gitea`
  do VPS não existe (gitignored), então o espelho do **host** não entra naquela
  comparação — a issue é fechada porque os espelhos **comparados** concordam, e o
  comentário diz como conferir o host (`doctor --gitea-env`).

A recorrência **não fica muda**: o dedup é entre as issues ABERTAS, então um
drift que volta abre uma issue nova, com a assinatura do momento.

**O re-registro é o outro caminho que sobe o runner:** trocar a label (ou a
`BUN_VERSION`) é quando a tag tem mais chance de faltar, e o act_runner guarda
os labels do registro em `/data/.runner` — então o procedimento precisa apagar
container **e** volume, e passar pela garantia da imagem. O `checkReRegisterPath`
prende as duas metades: no script, `rm -sf runner` antes de `up -d runner`; no
runbook, `deploy/GITEA.md` tem de mandar o operador pelo `--re-register` e não
pode ensinar a sequência à mão (um bloco cercado com `rm -sf runner` + `docker
compose ... up -d runner` cru é violação — a prosa em volta pode até explicar o
caminho antigo, mas o que se copia tem de ser o garantido).

**Os dois donos de cada espelho (prende a assimetria):** cada espelho tem um
ESCRITOR (`scripts/bump-bun.sh`, no bump) e um LEITOR-VERIFICADOR
(`scripts/check-actrc-sync.mjs`, no job semanal). O `check-bun-mirror` exige que
os dois conjuntos sejam o MESMO arquivo a arquivo — porque a assimetria é
silenciosa nos dois sentidos: leitor sem escritor transforma todo bump num
`::warning::` **permanente** (um aviso que o procedimento documentado não
consegue silenciar acaba ignorado), e escritor sem leitor deixa o valor escrito
sem nenhuma conferência.

**Onde roda:** pre-commit/pre-push (modo `--staged` pega key/literal/call site
introduzidos pelo PR), CI (job dedicado), cron (tier-1 fastpath), e no semanal
`actrc-sync` — no GitHub (aviso + issue com dedup) e na forja (`--fail`),
comparando o valor de todos os espelhos descobertos, incluindo o env do host.
Sem drift, o publicador do GitHub também **fecha** a dívida que ele abriu
(ver acima) — um canal sem o outro lado é meia-volta.

**A PONTA QUE NINGUÉM VIA: a CADEIA DE BUILD (invariante 18).** As invariantes
13/15/16 julgam o valor ESCRITO (no Dockerfile, no script, no compose) — e um
build site que **não passa o arg** não tem valor escrito NENHUM, então não havia
o que julgar enquanto ele herdava o default do Dockerfile, em silêncio. Foi esta
a origem do `1.4.0` [divergente] que viveu em staging, hostinger, package.json e
no pipeline arquivado: a versão nunca foi ESCOLHIDA — ela entrou como **default do
`ARG BUN_VERSION`** do Dockerfile (introduzido para _remover_ um literal
hardcoded, com o valor do dia preenchendo o default) e foi copiada, na mesma
semana, por quem precisava passar o arg. Na staging, o app
(`web-staging`) buildava o `Dockerfile` **sem** `args:` — o valor rodava sem
estar escrito em nenhum arquivo da cadeia de deploy —, enquanto os dois workers
da MESMA stack já tinham o literal. A auditoria de 15/16 alinhou os workers e
deixou o app no default: a stack passou a buildar com **dois Buns** e nada ficou
vermelho (a assimetria era invisível — nenhum arquivo dizia a versão do app).

A régua, nas duas pontas: **(a)** nenhum Dockerfile declara VALOR para a versão —
nem o default do ARG (`ARG BUN_VERSION=<v>`) nem um default embutido na
referência (`${BUN_VERSION:-<v>}`), que a rodada anterior **aceitava** como
"forma válida do ARG" (era o buraco: o valor de hoje entrava no arquivo que
deveria só consumir a variável); sem default, um build que não passa o arg
**falha alto** (`oven/bun:-alpine`) em vez de rodar outro Bun. **(b)** todo build
site de um Dockerfile que declara `ARG BUN_VERSION` tem de **PASSAR** o arg,
derivado da variável — e o fallback do compose é comparado por VALOR pela
invariante 16, como todo compose. **(c)** a declaração de TOOLCHAIN
(`"packageManager"` do `package.json`) diz o valor declarado: nada a consome em
tempo de build (o bun não a impõe), então ela envelhecia sem sintoma — e é o
primeiro campo que alguém lê para saber qual Bun o repo usa. Ela tem recorte
PRÓPRIO no `--staged` (`checkStagedPackageManagerVersion`), porque mais nenhuma
pathspec do recorte olha o `package.json`: a **linha** que o diff introduz com
outro valor reprova nomeando arquivo e linha, e a **REMOÇÃO** do campo — o
ÍNDICE sem ele contra o HEAD com ele — também, que é a mesma cegueira da (b)
(o que o commit TIRA não aparece em linha adicionada nenhuma) e era por ali que
apagar a única declaração de qual Bun este repo usa passava o commit e só
encontrava o PR. O arquivo que NUNCA teve o campo e é editado por outro motivo
não vira violação AQUI (o commit não introduz a ausência) — quem cobra a
existência da declaração é a varredura global, e a régua do valor é UMA só
(`judgePackageManager`) para os dois modos. No `--staged` da
(a) o alvo é a lista `DOCKERFILES` (o default nasce num commit, como todo
literal); o recorte da (b) é **declarado**: os blocos de build que o DIFF toca,
lidos do **ÍNDICE** (o `args:` e o `dockerfile:` são linhas diferentes, e o
pre-commit julga o que será commitado, não o disco). E a **REMOÇÃO** do arg tem
régua própria (`checkStagedRemovedBuildArgs`): ela compara o bloco do **ÍNDICE**
com o bloco de **HEAD** e reprova o serviço que passava o arg num Dockerfile que
o exige e não passa mais — o recorte das linhas ADICIONADAS não veria uma
remoção pura (o bloco perde uma linha e não ganha nenhuma), e era por ali que
remover o arg passava o commit e só encontrava a varredura global do PR. Remover
o `args:` inteiro, trocar o serviço por um que builda um Dockerfile sem
`ARG BUN_VERSION`, apagar o serviço e adicionar um arquivo NOVO não são
violação; índice ou HEAD ilegível para o veredito com exit 2, como sempre.

**A CLASSE QUE ESTAVA FORA: os usos da versão num pipeline de TERCEIRO
(invariante 19).** O `.woodpecker.yml` já era alvo do `check:registry-source`
(o host do registry), mas a VERSÃO do Bun nele não era julgada por ninguém: lá
a versão aparece como **tag de imagem** (`image: oven/bun:<v>`, uma vez por
passo) e como **build arg** (`BUN_VERSION=<v>`), espalhada em TREZE usos — e foi
por isso que o arquivo acabou com uma ISENÇÃO escrita no próprio cabeçalho
("arquivado — não copie os literais daqui"). Fora da varredura, os treze usos
envelheceram **sete versões** atrás do repositório (`1.4.0` [divergente] contra
o `1.3.14` declarado) sem que nada ficasse vermelho. A régua é a MESMA da
invariante 16 — comparação por VALOR contra o espelho: `${BUN_VERSION}` é
derivação e passa, `${BUN_VERSION:-<x>}` passa quando o fallback é o declarado,
e um valor literal tem de ser o declarado. A diferença vem do FORMATO e fica
escrita: num `image:` de pipeline de terceiro o literal **igual** ao declarado
PASSA — ali não existe a variável do operador que a 16 protege, o valor tem de
estar escrito; o que não pode é ser OUTRO número (um pipeline de terceiro é
**consumidor** da versão, não um segundo ponto de verdade). Como nos espelhos
declarados, o que faz do literal uma derivação é o par **escritor** +
**comparação por valor**: a seção 2e do `bump-bun.sh` reescreve os treze usos no
mesmo passo dos outros espelhos e CONFERE a reescrita (o que sobrar com outro
número é exit 1 do bump, nunca um `::warning::` que o próximo bump herda).
Fail-closed na LEITURA: um pipeline que existe e não pode ser lido é violação
(e um symlink entra na enumeração com o alvo ausente só para sair NOMEADO, em
vez de desaparecer da varredura) — enquanto a AUSÊNCIA do arquivo não é
violação, porque a alternativa arquivada pode ser apagada. Comentário fica fora,
inclusive o passo COMENTADO e a prosa que NOMEIA as formas (`image: oven/bun:<v>`,
`BUN_VERSION=<v>`) — que é exatamente o que o cabeçalho do arquivo real faz.

**A COBERTURA da varredura (o que o RESULTADO não conta).** A invariante 19
sabe dizer o resultado dela — nenhum uso da versão divergindo do declarado — e
não sabia dizer o **alcance**: quantos tipos de pipeline de terceiro ela conhece,
quais, e se algum CI presente no repositório está fora deles. A diferença não é
cosmética: um `.gitlab-ci.yml` (ou um `Jenkinsfile`) que entra no repositório fica
cego, e o verde da invariante 19 fica **idêntico** — a varredura responde sobre o
que olhou, e nada perguntava o que ela não olhou. A metade nova são duas tabelas
declaradas em `scripts/check-bun-mirror.mjs`:

- `THIRD_PARTY_PIPELINE_TYPES` — os tipos que a varredura **julga**. Cada tipo
  aponta para o **mesmo padrão** que o sweep usa (`THIRD_PARTY_PIPELINE_RE`):
  duas regexes divergiriam no primeiro pipeline novo, e o veredito declararia uma
  cobertura que não existe — o que é pior que não declarar nenhuma. Um tipo nesta
  tabela é um tipo com régua de valor, e é por isso que declarar um tipo que
  ninguém varre é impossível;
- `THIRD_PARTY_CI_CANDIDATES` — os CI canônicos que o repositório **reconhece
  pelo nome do arquivo** (GitLab, Jenkins, Drone, CircleCI, Travis, Azure
  Pipelines, Buildkite, Bitbucket) e que nenhum tipo declarado cobre. O
  reconhecimento é por nome canônico, nunca por conteúdo: um YAML que cite
  "gitlab" em prosa não é um pipeline.

A medição é `thirdPartyPipelineCoverage`: varredura recursiva do repositório (a
mesma lista de diretórios ignorados da varredura de prosa — um `Jenkinsfile`
aninhado é um pipeline de verdade, e `node_modules` não é CI do repositório),
os arquivos que cada tipo cobre e a lista dos que ficam **fora**. O doctor publica
isso como **fato próprio** (seção **8/9**): quantos tipos, quais e quantos
arquivos cada um cobre; um CI detectado fora deles **BLOQUEIA** o veredito com o
remédio (declarar o tipo, ou remover o pipeline); um diretório ilegível vira
**INDETERMINADA**, porque "não consegui ler" não é "não existe".

**Família relacionada:** `check-tier1-fastpath`, `check-tier2-cache-restore`
(performance do setup-bun — ver família 10).

**Como testar:** `src/lib/__tests__/check-bun-mirror.test.ts` (as formas e o
escopo das invariantes 15/16, o recorte `--staged` delas e o veredito contra o
REPOSITÓRIO real — "nenhum literal nos scripts nem nos composes" é asserção,
não promessa), `src/lib/__tests__/check-bun-mirror-prose.test.ts` (a invariante
17: as formas ancoradas, os dois papéis checados nos dois sentidos, o cenário
declarado, o piso do doc canônico e o `--staged`),
`src/lib/__tests__/check-bun-mirror-build-chain.test.ts` (a invariante 18: o
`embeddedVersionDefault`, o default do ARG e o embutido na referência, o parser
dos build sites, o recorte `addedLines`, o ÍNDICE do `--staged` — incluindo o
"não consegui ler" —, a **REMOÇÃO** do arg comparando o bloco do índice com o de
HEAD (o serviço removido, o bloco que deixou de buildar um Dockerfile que exige o
arg e o arquivo novo não são violação), o `packageManager` (o global e a régua
`judgePackageManager` que ele compartilha com o recorte),
`checkStagedPackageManagerVersion` (o campo REMOVIDO pelo commit, a linha
ADICIONADA com outro valor, o campo que sobrevive, o arquivo que nunca teve o
campo, o arquivo novo, o índice/HEAD ilegível e o fora do recorte) e o REPOSITÓRIO real:
a remoção do arg de um build site de verdade reprova NOMEANDO o serviço),
`src/lib/__tests__/check-bun-mirror-third-party-pipeline.test.ts` (a invariante
19: o extrator das duas formas — imagem e build arg — e dos NÃO-usos, o literal
igual ao declarado que passa, o divergente que reprova por uso, a derivação e o
fallback comparado por valor, o comentário e o passo comentado, o pipeline
ilegível e o repo real: os treze usos no valor declarado e UM número trocado
derrubando o guard com arquivo e linha) e
`src/lib/__tests__/bun-version.test.ts` (a cadeia de resolução do resolvedor:
env → espelhos, e o LANÇAR em vez de um default).
**Prova por mutação:** `scripts/test-mutation-bun-literal.sh` — cinco fases: (A)
o literal de workflow, (B) o CONTROLE do guard limpo, (C) `M3`: um script do
fixture com literal é reprovado, e a MESMA cópia do guard SEM a chamada da
invariante 15 passa (a varredura é load-bearing) — enquanto o literal de
workflow segue reprovado na cópia mutada (a mutação é cirúrgica, e não deixa
resíduo: o guard real nunca é tocado), e (D) `M4`: um exemplo de versão
DESATUALIZADO no README do fixture reprova nomeando o arquivo, e a cópia sem a
chamada da invariante 17 passa — a mesma dupla, para a metade que julga a prosa,
e (E) `M5`: as QUATRO metades da cadeia de build (o default do ARG de volta, o
build site sem o arg, o `packageManager` divergente e o default embutido na
referência) reprovam com as quatro mensagens, o build site NOVO sem o arg é
recusado já no `--staged` (o pre-commit nomeia o serviço), e a cópia do guard com
as SEIS linhas neutralizadas (as quatro do `M5a–d` mais as duas das remoções)
passa com todas em disco — cada metade é
load-bearing, e a mutação é cirúrgica (o literal de workflow segue reprovado na
mesma cópia) —, mais o `M5e` no MESMO passo: o commit que **REMOVE** o arg de um
build site é recusado no `--staged` (o recorte que o pre-commit roda) nomeando o
serviço, e a cópia sem a comparação ÍNDICE×HEAD o deixa passar (a metade da
remoção é load-bearing, e é ela que fez o commit deixar de ser cego), e o `M5f`
no MESMO passo, em fixture PRÓPRIO (o defeito do `M5e` está staged e um segundo
defeito no mesmo índice tornaria as duas leituras indistinguíveis): o commit que
**APAGA** a declaração de TOOLCHAIN (`"packageManager"`) é recusado no
`--staged` nomeando o arquivo, e a cópia sem a linha registrada no recorte o
deixa passar — a última ponta da 18 no commit deixa de ser cega —, e o **REMENDO**
do que foi apagado no MESMO passo (`M5g/M5h/M5i`, em fixtures próprios com git de
verdade): o `--fix` pré-visualiza sem gravar e restaura o trecho apagado na
árvore, e com o remendo ESTAGIADO o `--staged` do dono volta verde (o ciclo
fecha); a **chave-pai** apagada junto volta com a declaração — e a cópia com a
extensão para a chave neutralizada grava a declaração ÓRFÃ (o YAML quebrado que o
fixture mediu); e a **âncora ambígua** (a linha de apoio aparecendo 2x na árvore)
faz o fixer RECUSAR sem tocar no arquivo — a cópia sem a recusa insere a
declaração no bloco do SERVIÇO ERRADO (medido: cai no `worker-novo`, que nunca
teve o arg). As três metades do remendo são load-bearing como as da recusa —, e
(F) `M6`: as três metades da invariante 19 — a comparação por
VALOR (imagem e build arg divergentes reprovam, e a cópia com a comparação
cegada passa), a EXCLUSÃO do comentário (o fixture com o cabeçalho citando a
versão velha passa no guard real e reprova na cópia sem a exclusão, citando a
linha da prosa e a do passo comentado) e o recorte `--staged` (a linha nova com
outra versão é recusada no commit, e a cópia sem o recorte passa) — mais o
CONTROLE que exige o relatório NOMEANDO a classe varrida, porque um arquivo fora
da enumeração deixaria a régua verde por vacuidade.

**`check:registry-source` (mesma família — fonte única, agora do registry OCI):**

**O que protege:** o host do registry das imagens da aplicação (app, worker,
realtime) e dos mirrors de toolchain (bun, ubuntu-bun, postgis) tem UMA fonte
de verdade (`IMAGE_REGISTRY`): repository variable nos workflows, variável de
`.env.production` no compose da VPS, `--var` no `.actrc` e secret
`image_registry` no Woodpecker.

**Por que existe:** as imagens eram referenciadas com o host hardcoded
(`ghcr.io/...`, ~85 ocorrências). Isso acoplava o projeto a um registry
proprietário com cota de armazenamento/egress no plano free, e transformava
trocar de registry numa caçada de referências. Agora o flip é uma variável — e
o guard falha se um `ghcr.io` solto voltar (a forma correta é o próprio default
da variável: `${{ vars.IMAGE_REGISTRY || 'ghcr.io' }}` / `${IMAGE_REGISTRY:-ghcr.io}`).

**Por que o escopo é declarado:** o guard varre os **sites de resolução**
(compose, workflows do GitHub e do Gitea, composite actions, `.woodpecker.yml`),
todos YAML — onde comentário é inequívoco (`#`). Com o runner rodando imagem
custom, o escopo inclui **`deploy/`**: o compose da forja
(`deploy/docker-compose.gitea.yml`) entra no mesmo gate, e **tag literal** na
imagem nossa ali é violação — a tag tem de vir da variável (`ubuntu-bun:${BUN_VERSION}`,
não `ubuntu-bun:1.3.14`). O porquê é o sintoma: um literal em `deploy/` não
quebra o repositório, quebra a subida da stack — o runner passa a rodar outra
versão e o fast path do setup desliga **em silêncio** (o setup funciona igual
com ou sem Bun pré-instalado; só muda a velocidade). `scripts/*.mjs` ficam FORA de
propósito: neles a string aparece também em prosa de mensagens de erro, e
prosa não é configurável — um guard com falso positivo acaba desligado. O
caminho de código real dos scripts honra `process.env.IMAGE_REGISTRY`.

**Onde roda:** pre-commit (fase paralela, node puro, ~0,8s — inclui a varredura
de decisões de escopo), CI (`pr-check.yml`, job `workflow-refs-guard`) e nos
pipelines das outras forjas.

**Imagens de terceiros:** consumo do GHCR que NÃO é nosso (ex.:
`ghcr.io/project-osrm/osrm-backend`) vive em `THIRD_PARTY_ALLOWLIST`, uma por
uma — allowlist por prefixo de host esconderia a regressão. Cada entrada
também registra `addedAt` e envelhece pela MESMA regra das decisões de escopo
(ver "A data da decisão e a revisão vencida", abaixo) — a pergunta é outra
("esta imagem ainda é de terceiros e o consumo ainda é consciente?"), o
defeito é o mesmo.

**A metade dinâmica (mesmo gate, invariante 7):** além da varredura do texto, o
gate renderiza `deploy/docker-compose.gitea.yml` com o `docker compose config` e
falha se uma variável resolver **vazia** ou se o registry/tag resolver para um
**literal**. A tag existir no registry não diz o que o compose _pede_ — ver a
seção 6, onde as três fases (declarado · sentinela · sem versão) estão
detalhadas, junto do que acontece quando o ambiente não tem a ferramenta
(INDETERMINADO, nunca "passou") e de `--require-compose`, que troca esse aviso
por falha onde o render é obrigatório (o job da forja). A mesma seção documenta a
outra metade (invariante 7b): o env do **HOST** comparado com o template
comitado — onde o arquivo do host existe, o template deixava de ser renderizado
por ninguém, e "o que o VPS interpola" podia não ser "o que o repositório
declara". A metade do repositório (o template declara tudo o que o compose
consome) vale em **qualquer** checkout, inclusive no CI.

**Alvo fora do escopo exige DECISÃO ESCRITA (invariante 8):** o escopo declarado
(YAML, onde comentário é inequívoco) é cego em qualquer diretório **novo** — um
arquivo que monte uma imagem nossa fora dele fica invisível. Por isso todo
arquivo fora do escopo que referencie imagem nossa precisa de uma entrada em
`OUT_OF_SCOPE_ALLOWLIST` **com o motivo escrito**; não decidir é violação, e
decisão que envelheceu (o arquivo existe e não referencia mais a imagem) também.
A varredura do repo inteiro é o que garante que o próximo alvo apareça **antes**
de virar incidente — foi ela que encontrou um `ghcr.io/...` cravado em código no
harness de benchmark do `act`, escondido em `scripts/` (diretório excluído do
escopo estrito de propósito, por causa da prosa das mensagens de erro). Prosa e
fixture de teste são excluídas **por regra**, com razão escrita (a string da
imagem ali não resolve nada) — uma entrada por arquivo de teste viraria uma
lista que envelhece a cada teste novo.

A MESMA classe cobre as **provas por mutação** (`scripts/test-mutation-*.sh`): o
literal da imagem ali é o **payload** que a prova entrega ao guard, e julgá-lo
seria o guard acusando o teste que o exercita (a saída óbvia seria mutar o
fixture para escapar da régua, cegando o guard exatamente onde ele é
exercitado). A classe é declarada **uma vez** e consultada pelas **duas**
varreduras do guard (os defaults da imagem e as referências fora do escopo) —
excluir num lugar só deixaria a outra metade cega, e um matcher escrito em dois
lugares divergiria no dia em que a convenção do nome mudasse. A exclusão é
**estreita** (um subdiretório, outra extensão ou outro diretório seguem
julgados — é o que as metades M8/M9 da suíte do guard medem, uma em cada
direção) e **nomeada em voz alta**: o relatório imprime, por regra, quantos
arquivos ficaram fora da varredura e um exemplo de cada (`referências fora da
varredura por REGRA: N arquivo(s) — \`test-fixture\` …, \`mutation-proof\` …`),
porque uma exclusão por classe que ninguém vê é um alvo invisível com outro nome.

**A data da decisão e a revisão vencida (invariante 8 e as três allowlists):**
cada entrada de `OUT_OF_SCOPE_ALLOWLIST` registra também `addedAt` (ISO
`YYYY-MM-DD`, quando a decisão foi tomada) — uma isenção sem data não tem como
envelhecer, e "esqueci de registrar" seria o jeito de nunca precisar revisar. A
data é validada fail-closed (ausente, malformada, transbordada como
`2026-02-30`, ou **no futuro** = violação, nos dois modos). Passada a janela
(180 dias), a decisão está **SEM REVISÃO**:

- **run normal** (pre-commit, pr-check, forja) — o guard **avisa**
  (`::warning::`) e segue verde: uma data não pode bloquear o commit e o PR de
  todo mundo;
- **modo `--review`** — a decisão vencida vira **violação** (exit 1). É o canal
  do job semanal `registry-allowlist-review` (`benchmark-weekly.yml`), porque um
  aviso dentro de um run verde é **alerta mudo** — exatamente a classe que o
  `check:periodic-alerts` proíbe. Reafirmar é revisar o motivo e atualizar o
  `addedAt`; se o motivo caducou, a entrada sai.

A REGRA não é copiada: mora em `scripts/allowlist-review.mjs` (parser da data,
janela, e a prosa das duas violações) e as **três allowlists do repositório** a
usam — `OUT_OF_SCOPE_ALLOWLIST` e `THIRD_PARTY_ALLOWLIST` (este guard) e a
`ALLOWLIST` de uso implícito do `check-unused-deps` (seção 12). Três cópias do
parser divergem no dia em que uma aceita `2026-02-30`; o job semanal roda os
dois guards no modo estrito (uma linha por guard), e o registro
ausente/inválido é violação em **qualquer** modo — só a janela vencida tem
dois desfechos, porque uma data não bloqueia o PR de todo mundo.

**Referências em configuração NÃO versionada (invariante 9): o que o repositório
não contém.** Tudo o que as invariantes 6, 7 e 7b provam vive em arquivo
comitado. Mas a imagem também é resolvida em três lugares que o repositório não
tem — e nos três, **presumir é o defeito**: o guard lê quando pode e diz
INDETERMINADO quando não pode (nunca "conforme") — a mesma gramática do resto do
arquivo.

| Fonte (fora do repo)                                                                         | O que o guard prova                                                                                                                                                                           | Quando não consegue                                                                                                                                                                                                                                                                  |
| :------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **repository variables** (`vars.IMAGE_REGISTRY`, `vars.IMAGE_NAMESPACE`, `vars.BUN_VERSION`) | o valor que está no **ambiente** × o que os espelhos comitados declaram (`.actrc`, `deploy/env.gitea.example`, `.env.production.example`)                                                     | o valor vive na forja (Settings → Variables). O guard diz o remédio; por isso os passos de CI das **duas** forjas passam `vars.*` no `env:` do passo — entregar o valor é o que transforma "não provado" em prova (o fallback escrito no YAML é **intenção declarada, nunca valor**) |
| **env do HOST da aplicação** (`.env.production.local` ou `.env`)                             | `IMAGE_REGISTRY`/`IMAGE_NAMESPACE` contra o template comitado — a app puxa de outro registry que o repo declara?                                                                              | ausente: é gitignored por desenho, existe só onde a stack roda ⇒ `absent` (não aplicável), **não** uma pendência                                                                                                                                                                     |
| **o que o registry SERVE para a tag**                                                        | manifesto + label OCI `org.opencontainers.image.version` (gravada no `Dockerfile.ubuntu-bun`) contra a tag que o repo declara: `mismatch`/`missing` são violação (re-tag, tag que não existe) | sem rede, sem credencial ou imagem sem label ⇒ INDETERMINADO, com o remédio nomeado. A tag sai do env do host da forja quando existe; sem ele, do template comitado — senão a prova só existiria no VPS (justamente onde o drift de tag passa despercebido)                          |

Duas assimetrias que são **desenho**, não casos especiais: (a) a lista de
consumidas é derivada do próprio compose, e o **default embutido**
(`${IMAGE_REGISTRY:-ghcr.io}`) é comparado com o valor que o template declara —
onde a variável não existe é o default que vale, e é este projeto que está
migrando de registry (o default velho é justamente o que fica para trás);
(b) o env do host **não** declarar uma variável da imagem não é violação quando o
default a cobre (senão todo `.env` de desenvolvimento seria reprovado) — o que é
violação é **divergir** do template, ou declarar uma variável que o template não
tem. A versão do Bun (`BUN_VERSION`) fica fora das comparações **de arquivo**
deste gate: ela tem guard próprio (família 10, `check-bun-mirror` + o espelho
períódico), e no compose da aplicação é `build.args` do Dockerfile, não
referência de imagem.

**A varredura dos defaults EM ARQUIVO (`sweepImageDefaultValues`): a mesma régua,
em quatro famílias.** A comparação por par sabe qual template é a fonte, mas só
cobre as duas stacks que alguém cadastrou. A varredura cobre o que **não** tem par
— e é aí que um default velho sobrevive a uma migração de registry:

| Família                                       | O que é default                 | O que a violação significa                                                                                                                                   |
| :-------------------------------------------- | :------------------------------ | :----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **compose** (QUALQUER `*.yml` com `compose`)  | `${NOME:-valor}`                | uma stack nova (ex.: `docker-compose.hostinger.yml`) entra sem lista à mão; os dois pares declarados seguem com a comparação por par, que sabe a fonte deles |
| **shell** (`scripts/` e `deploy/`, `*.sh`)    | `${NOME:-valor}`                | o pull/push de um script passa a vir do host velho — e como a imagem continua existindo lá, nada fica vermelho                                               |
| **script JS** (`scripts/`, `deploy/`, `.mjs`) | `X \|\| "valor"` (ou `??`)      | **violação mesmo com o valor certo**: o repositório tem resolvedor (`registry-source.mjs`), e o literal volta a envelhecer na próxima migração               |
| **workflow** (YAML das duas forjas)           | `${{ vars.NOME \|\| 'valor' }}` | o fallback do YAML vira o valor onde a variable não existe; o fallback **dinâmico** (`\|\| github.repository_owner`) é contado como fora da comparação       |

Três coisas são CONTADAS e ditas no log, nunca julgadas como valor: a forma que
casa em OUTRA família (o `${NOME:-x}` dentro de uma mensagem de erro é prosa, não
default — a forma vale por família, e era um falso positivo real do guard), o
fallback dinâmico do YAML e os arquivos de **prova por mutação** (`scripts/test-mutation-*.sh`,
cujo texto é o PAYLOAD que alimenta o guard — a exclusão é declarada e estreita:
`deploy/*.sh` com o mesmo texto continua sendo julgado). O veredito é o de sempre
(`proven`/`violated`/`indeterminate`): sem nenhum arquivo comitado declarando a
variável o default passa a ser a única fonte, e isso sai como aviso com o remédio,
**nunca** como "conforme".

**O RESOLVEDOR (`scripts/registry-source.mjs`)** é o caminho pelo qual um script
descobre de onde puxar: **ambiente → espelho comitado → erro**. Não existe default
de reserva, e isso é o contrato: o literal de reserva sobrevive à troca de
registry (o script continua puxando do host VELHO, e a imagem velha continua
lá — o sintoma aparece longe da causa). `requireImageSource` **lança** nomeando as
variáveis e os espelhos onde declará-las, e o `ensure-runner-image` usa o valor
declarado como default do compose em vez de uma constante.

O gate é **portátil**: sem docker ou sem rede ele avisa e sai 0 — mas a consulta
ao registry é a única parte que depende de rede, e `--no-registry-probe` a
desliga **declarando-se** (`absent`, nunca "conforme"). Onde a prova é
obrigatória, `--require-image` só aceita `proven`; combinada com
`--no-registry-probe` é uso inválido (exit 3) — pedir a prova e pedir para não
provar são instruções contraditórias, e resolver isso em silêncio seria escolher
por quem pediu.

**`runner-labels:check` (a mesma família, um passo além — do TEXTO para o
ESTADO):** as invariantes 6 e 7 provam o que o compose **declara** e o que a
interpolação resolve. Nenhuma das duas prova o que o runner **gravou**: os
labels do act_runner são ESTADO (`/data/.runner`, no volume), enviados no
registro e nunca relidos do compose — e o `up -d runner` recria o container com
o env NOVO deixando o registro VELHO no lugar (o volume sobrevive ao `rm`).
O resultado é o pior tipo de falha: nenhum sintoma. O job roda, o setup do Bun
funciona, os testes passam — na imagem antiga, sem o tier-1, com o download de
volta em TODO job. `scripts/check-runner-labels.mjs` compara as DUAS pontas
(o `docker compose config` do checkout, a mesma fonte única do invariante 7, e o
`/data/.runner` lido DENTRO do container em execução) nome por nome e imagem por
imagem, e aponta qual label aponta para qual imagem. O container e o arquivo de
registro saem do **compose** (o `container_name` e o único volume NOMEADO do
serviço): com dois volumes nomeados ele não escolhe — falha alto, porque ler o
arquivo errado e comparar seria pior que não comparar. `INDETERMINADO` (sem
docker, sem socket no job, sem container, registro ilegível) nunca vira
"provado". No runtime quem o executa é a **Prova 5** do smoke da forja — e ali
"não provado" **falha a etapa** de propósito (ver `deploy/GITEA.md`).

**CONJUNTO VAZIO NÃO É SINCRONIA** — e este era um verde falso: com **zero**
labels dos dois lados a comparação dizia "0 label(s) registrados idênticos ao
compose" e imprimia ✅. Só que aí não há nada provado, e o sintoma é o pior da
família: um runner **órfão** (no ar, registrado, sem label nenhum) existe na
instância e **não é atribuído a job algum** — a forja fica parada enquanto o
smoke dá "prova de sincronia". O outro lado fecha pelo mesmo raciocínio: um
compose que perdeu `GITEA_RUNNER_LABELS` não tem o que comparar, e comparar
vazio com vazio nunca prova que a stack está no ar. Os dois são **exit 1**
(DIVERGENTE), com remédios **distintos** — registro vazio ⇒ `--re-register`
(o registro só pega os labels na subida); compose sem a variável ⇒ declarar os
labels **e então** re-registrar —, e o registro vazio ganha uma violação ÚNICA
nomeando o runner órfão, em vez de N linhas "o compose declara X e o registro
não tem" que escondem a causa raiz.

**A OUTRA FORJA — o runner auto-hospedado do GitHub (`--forge github`):** a
mesma comparação, por um motivo que NÃO se repete na forja: o runner do GitHub
não grava label nenhum em arquivo. O `.runner` do `actions/runner`
(`RunnerSettings`) guarda AgentId, AgentName, PoolName, ServerUrl, GitHubUrl,
WorkFolder — e nenhum campo de labels: eles vivem no **SERVIDOR**, mandados no
`config.sh --labels`. Então o lado REGISTRADO só existe na API
(`GET /repos/<owner>/<repo>/actions/runners`, que devolve `status` e `labels[]`
por runner — o estado que ATRIBUI job), e o lado DECLARADO é o `RUNNER_LABELS`
de `deploy/setup-github-runner.sh` (a fonte única do repositório: um segundo
declarante divergiria no dia do bump), comparado por NOME e
**case-insensitive** — a API devolve `Linux`/`X64` para o que o script declara
em minúsculas, e alarme falso é o que ensina a ignorar o guard. Mesmos estados e
mesmos exit codes da forja. Duas decisões próprias: um runner registrado mas
**OFFLINE** é DIVERGENTE com remédio PRÓPRIO (`systemctl restart`, o sintoma é o
"no runner available" do `deploy/GITHUB_RUNNER.md`), e registro VAZIO é UMA
violação (runner órfão), não N labels faltando. A credencial é a MESMA do
`apply-required-checks` (`GITHUB_TOKEN`/`GH_TOKEN`, `GH_API_URL`) e exige
permissão de self-hosted runners no repositório — o `GITHUB_TOKEN` de um run NÃO
a tem: sem token é **exit 3** ("não olhei"), nunca "em sincronia". E o REPO vem
do CANAL (`GH_REPOSITORY`, com `--gh-repo` à frente e o `REPO_URL` do script de
setup como fonte comitada), **nunca** do `GITHUB_REPOSITORY` compartilhado: no
runner da forja essa variável aponta para o repositório DO GITEA (o contexto
emulado), e lê-la consultaria o registro de outro repositório — a resposta seria
o registro vazio de um repo que não é o nosso, publicada como se fosse o nosso.

**E a VERSÃO registrada × o PIN do script — a terceira pergunta ao MESMO
registro, e a única cujo sintoma aparece LONGE daqui.** O payload da API traz, por
runner, o `version` que o SERVIÇO aceitou (o runner se atualiza sozinho para ela),
e o `RUNNER_VERSION` de `deploy/setup-github-runner.sh` é o pin que o repositório
declara: os dois têm de casar — por **VALOR**, porque o `v` de uma tag de release e
o espaço em volta não são drift, e um alarme falso é o que ensina a ignorar o
guard. MEDIDO em 22/09/2026: com o pin em `2.320.0` o runner **registrou, pegou o
primeiro job e se AUTO-ATUALIZOU para 2.337.0 no MEIO dele** — o update derruba o
worker, o job fica **PRESO** em `in_progress` segurando o único runner (o cancel do
run e o remove do runner respondem 422 "is currently running a job") e a forja fica
**PARADA em vez de vermelha**: ninguém percebe, e nenhum check acusa. Por isso o
drift entra numa lista PRÓPRIA (`versionViolations`, **exit 1**) com o remédio do
PIN — **alinhar o pin** à versão que o serviço aceita e só então re-registrar;
re-registrar com o mesmo pin recusado reproduz o defeito —, enquanto `violations`
segue significando "problemas de LABEL" (somar as duas faria `violations.length`
deixar de significar o que ele diz). E "não deu para julgar" tem estado próprio
(`no-pin` quando o script não declara o pin, `unread` quando a API não devolveu o
campo, `null` quando nenhum runner chegou a ser selecionado): **nunca** "em
sincronia" — é o que o doctor publica como não-provado, com a declaração datada
`github-runner-version`.

**E a VERSÃO do BINÁRIO do act_runner × a TAG que o compose declara — o irmão
da pergunta acima, do lado da forja, e com um mecanismo oposto.** O container do
act_runner **não se auto-atualiza**: quem decide a versão do binário é a
**IMAGEM**, e é por isso que uma tag que não declara versão é o furo. O compose
da forja declarava `gitea/act_runner:latest`, e `latest` não é uma versão — é o
nome de uma promessa: o `docker compose pull` de um dia qualquer troca a versão
que roda **sem uma linha do repositório mudar** e sem sintoma nenhum na forja.
MEDIDO em 22/09/2026 neste host: a imagem `latest` reportava `v0.6.1` e a tag
`0.2.11` reporta `v0.2.11` — as duas convivem no disco, e era o compose que não
dizia qual delas a stack sobe. **O REMÉDIO foi APLICADO no mesmo dia:** a tag
passou a `gitea/act_runner:0.6.1` — o MESMO digest que o `latest` do dia servia
(`sha256:b5c35d6d…`), então a stack segue rodando exatamente o binário que
rodava, agora DECLARADO (e `v0.6.1` NÃO existe no registry, medido: `not found` —
o `v` seria um pin quebrado). Com a imagem pinada a medição do guard dá
`versao do binario: 0.6.1 = tag 0.6.1 (proven)`, e o que a lacuna datada passa a
cobrir é a LEITURA: com a tag pinada e sem container o estado deixa de ser
`floating` (a declaração pendente que o pin resolveu) e passa a ser `unread` ("o
que RODA não foi julgado") — a leitura é da stack. O guard lê o
`act_runner --version` **dentro do container em execução** (o mesmo `docker exec`,
sem shell, do `cat` do registro) e compara com
a tag do **render** do compose, por **valor** (`v0.6.1` = `0.6.1`; o `v` e o
espaço em volta não são drift). São SEIS estados: `proven` (a tag pina a versão
que o binário reporta), `drift` (**exit 1**, em `versionViolations` — o remédio é
alinhar a **tag**, e re-registrar não muda a versão de um milímetro), `floating`
(a tag não piná versão: **declaração pendente**, nem verde nem divergência),
`digest` (a imagem é pinada por CONTEÚDO — imutável, mas um digest não declara
versão: jogá-lo em `floating` faria o relatório afirmar que "a versão que roda é a
que o pull do dia tiver servido", o que é falso num pin imutável), `no-image` (o
render não declara imagem do runner) e `unread` (o binário não respondeu).
A versão é lida **antes** do registro — ela é um fato do CONTAINER, não do
arquivo —, então um registro ilegível não esconde um drift. E o estado conta para
o veredito do doctor: o drift é **BLOQUEIO** (linha própria, com o remédio da
tag), os outros quatro **rebaixam** nomeando o estado, e a lacuna vive datada
como `act-runner-version` (`ci/unproven.json`) — ela fecha **por medição**, só
quando o binário reporta a versão da tag declarada.

**Qual container — e a SONDA.** O nome do container do runner era derivado do
`container_name` do compose (e, sem ele, do service label que o próprio compose
põe). Isso amarra a medição à STACK: o container tem de ser o dela, com o nome que
ela usa, e uma **sonda** — o ensaio da metade da VERSÃO contra um container de
teste com a imagem pinada, ou um runner de outra stack — não tinha como se
declarar sem TOMAR esse nome. Agora a ordem é **declarado vence derivado**:
`--container` (a CLI) → a variável **`GITEA_RUNNER_CONTAINER`** → o
`container_name` do compose → o service label. A variável é a forma declarada dos
DOIS consumidores: o mesmo guard rodado direto e o `forge-doctor`, que ganhou o
`--container` e entrega o valor ao guard pelo mesmo parâmetro (ele não
reimplementa a resolução). A **fonte** viaja até o veredito da versão —
`no container 'x' (declarado por GITEA_RUNNER_CONTAINER)` —, porque medir uma
sonda NÃO é medir a stack: a metade da versão contra uma sonda diz o que a IMAGEM
pinada roda, não o que a forja está rodando.

**A prova por MUTAÇÃO** (`scripts/test-mutation-runner-labels.sh`, a metade
`ordem-declarada`): uma precedência passa em silêncio quando o declarado perde —
bastaria pôr o compose na frente para a sonda voltar a ser ignorada, e o veredito
da versão passaria a dizer "o binário do runner reporta X" sobre um container que
ninguém declarou medir. A suíte muta o guard (a declaração deixa de ser lida, o
`if` que a lê nunca abre) e exige as duas testemunhas: a LEITURA por execução
passa a nomear `container_name do compose` no lugar da sonda — e o veredito perde
a fonte —, e a suíte unitária fica VERMELHA na âncora da ordem (`o DECLARADO vence
o container_name do compose`). O CONTROLE mede a mesma leitura íntegra: a sonda
vence sem chamar `docker`, o branco cai para o compose, e o service label responde
quando o render não nomeia.

A entrada se chama `runner-labels:check`, e NÃO `check:runner-labels`: um comando
sob `check:` é lido como gate PORTÁTIL (roda na bateria de qualquer checkout), e
este só tem sentido no host da forja — mesma família de
`runner-image:ensure/check/prove`. Onde ele roda e o que ele decide está no
exit code — **0** provado, **1** registro velho/vazio/runner ausente ou offline
(ou declaração sem labels), **3** não provado —, e o pior desfecho seria um verde
que não olhou nada. Para o GitHub a entrada é `runner-labels:check:github`
(`--forge github`), documentada em `deploy/GITHUB_RUNNER.md`.

**`check:runner-tag` (a DECLARAÇÃO do pin — a metade que não precisa da stack):**
as duas perguntas acima medem ESTADO e RESOLUÇÃO (`runner-labels:check` lê o
`/data/.runner` DENTRO do container; o `check:registry-source` resolve a
interpolação do render), e as duas exigem docker no host. Faltava a pergunta que
se responde lendo o TEXTO do compose — a única que cabe no job de guards, a cada
PR, nas duas forjas: a tag do serviço `runner` DECLARA versão? A linha é a que
decide o que a forja RODA (o act_runner não se auto-atualiza: quem decide a
versão do binário é a IMAGEM), e `scripts/check-runner-tag.mjs` recusa (exit 1)
justamente os estados que não pinam — `latest`/`stable`, a imagem SEM tag (o
`latest` implícito do docker), o valor interpolado (`${…}`: o pin sairia do texto
do repositório) e o serviço sem `image:` —, cada um com o remédio escrito
(`bash deploy/gitea-up.sh --re-register`). O DIGEST passa, com aviso: ele pina
por CONTEÚDO (é o estado `digest` do `runner-labels:check`, onde a comparação com
a versão do binário não se aplica), e tratar um pin mais forte como violação
seria alarme falso. Compose ausente ou ilegível é **INFRA** (exit 2, fail-closed):
sem o artefato não há veredito a cunhar. A régua ("a tag declara versão?") é
**importada** do `check-runner-labels.mjs` — `isVersionTag`/`imageTag`/
`imageDigest` —, uma implementação só: uma segunda régua divergiria no primeiro
caso de borda (tag ausente, digest, o `v` de prefixo) e os dois vereditos
passariam a falar de coisas diferentes com o mesmo nome. Dois limites
declarados: ele **não** julga as outras imagens do compose (uma regra geral de
"declara versão" acusaria tags legítimas com sufixo, `postgres:16-alpine`) e
**não** consulta o registry (o que a tag serve hoje é do `check-runner-base`; o
que o binário reporta é do `runner-labels:check`). É invariante do CORE e roda
nas DUAS pipelines, ao lado do irmão `check-runner-base` — e, desde 27/09/2026,
também no **pre-commit** (fase B do `.husky/pre-commit`), com a MESMA linha do
CI: o comando canônico do invariante, reconhecido por IGUALDADE no
`check-hook-ci-parity` (sem recorte, e por isso sem entrada em `HOOK_DECLARED`).
Ele **não** leva `--staged`, e os dois motivos são declarados: (a) a linha do hook
é a do CI, e não há uma segunda semântica para divergir; (b) o
`check-mirror-coverage` **deriva** o recorte do hook — toda linha `--staged` dele
— para decidir se cada espelho é julgado, e esta guarda não julga espelho nenhum
(julga a declaração de UMA imagem). O que o hook lê é o artefato da ÁRVORE (o CI
lê o conteúdo mergeado): o caso que escapa do local é um `git add -p` que
deixasse no ÍNDICE uma tag diferente da árvore — janela estreita, e nomeada em vez
de escondida. E ele só consegue rodar lá porque o fixture passou a
**materializar os artefatos que os guards do hook LEEM** (derivados por execução —
ver "O FIXTURE QUE NÃO CARREGA"): antes disso a cópia tinha só o fecho de
`scripts/`, a guarda lia o ramo de INFRA (compose ausente = exit 2, fail-closed) e
o vermelho seria do FIXTURE — a razão pela qual ela estava declarada em
`HOOK_NOT_RUN`.

A prova de que a guarda RODA no hook (e de que é a linha dele que recusa) está em
`src/lib/__tests__/pre-commit-runner-tag-blocks.test.ts`: o hook REAL, somado,
com o compose materializado na cópia — o CONTROLE com a tag pinada sai 0 e traz a
manchete da guarda, a tag flutuante/`${…}`/`image:` ausente é recusada, o artefato
removido da cópia cai em INFRA (o fail-closed, medido), e a mutação que troca a
linha do hook por `true &` faz o defeito PASSAR.

**A prova por MUTAÇÃO** (`scripts/test-mutation-runner-tag.sh`, a metade `M1`):
um guard cujo valor é a REGRA ("a tag pina uma versão?") passa a valer só para o
arquivo de hoje no dia em que a régua some da execução — a metade desliga o
`if (!isVersionTag(tag))` e exige que o comportamento MUDE: `latest` volta a sair
`proven` nas duas testemunhas (a leitura por execução, que importa o guard mutado
e julga cinco declarações sintéticas sem docker nenhum, e a suíte unitária, que
fica VERMELHA na âncora `UMA TAG QUE NÃO É VERSÃO É VIOLAÇÃO`). O CONTROLE mede a
mesma leitura íntegra: a versão passa e sai 0, `latest` sai 1 com o remédio no
texto, o digest passa com aviso e o interpolado é violação.

**`check:runner-base` (a mesma família, do outro lado do build — CONTRA O QUE o
build verifica):** o `Dockerfile.ubuntu-bun` responde por duas coisas ao mesmo
tempo: o tier-1 do setup-bun (o fast path de 0s) e o **contrato da imagem** (o
plugin `compose`, sem o qual a invariante 7 fica INDETERMINADA dentro do runner
da forja). A asserção do contrato roda no BUILD — e o build é o lugar certo para
falhar. O que faltava era a outra metade: `FROM catthehacker/ubuntu:act-latest`
é uma tag **FLUTUANTE**, e quem garantia que o plugin está lá era a sorte de qual
build a tag servia no dia do build. Um rebuild/re-tag da base troca a imagem
inteira — inclusive o plugin — **sem uma linha do repositório mudar**: o build
passa a verificar OUTRA imagem, e o único jeito de saber é o dia em que ele
começar a falhar. É a mesma classe do re-tag da NOSSA imagem, que o
`probeImageIdentity` (acima) cobre: o apelido é mutável, o artefato não.

O guard fixa as quatro invariantes do pin e do contrato:

| Invariante                                      | O que ela pega                                                      | Como                                                                                                                                                                                                                         |
| :---------------------------------------------- | :------------------------------------------------------------------ | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1. o `FROM` é `nome:tag@sha256:<64 hex>`**    | a tag volta a ser flutuante                                         | forma do ref, com a tag mantida como documentação de ONDE o digest veio                                                                                                                                                      |
| **2. o digest fixado é o que a tag SERVE hoje** | pin VELHO (a base foi republicada) ou pin de OUTRA imagem           | manifesto no registry: aceita o ÍNDICE (o que `docker images --digests` mostra) ou o filho `linux/amd64`; sem rede/credencial ⇒ INDETERMINADO, nunca "conforme" por omissão (`--require-registry` transforma isso em exit 3) |
| **3. o contrato do Dockerfile é FAIL-CLOSED**   | o `RUN` que virou decorativo (`exit 1` → `echo`), o bloco que sumiu | **executando o bloco REAL** do arquivo (verbatim, achado por âncora — nunca por posição) contra bases dubladas: com o plugin sai 0, **sem o plugin FALHA nomeando a consequência**, sem o CLI falha no primeiro ramo         |
| **4. as mutações do pin são todas reprovadas**  | o guard cego: um pin que muda e ele não acusa                       | `sem-digest` · `digest-malformado` (40 hex passa a olho) · `digest-trocado` (forma válida, outra imagem) · `contrato-afrouxado`                                                                                              |

O **PATH do sandbox contém SÓ os dublês** — sem isso o `docker` do host
responderia no caso "sem o CLI" e o teste passaria verde por engano (foi o que
aconteceu na primeira medição). E a troca do ref acontece na **instrução `FROM`**,
nunca no primeiro texto igual do arquivo: o cabeçalho do Dockerfile **menciona** a
mesma tag, e um `replace` textual mutaria o COMENTÁRIO enquanto o `FROM` ficava
intacto — as mutações "passariam" sem mudar nada que o build lê. Uma mutação que
NÃO muda o arquivo é **FALHA** (prova vácua), não sucesso: significa que a âncora
dela deixou de existir.

Atualizar o pin é um passo, não um ritual: **`bun run runner-base:pin`** resolve a
tag e reescreve o `FROM` — resolvendo e VALIDANDO (um `--write` que escrevesse
sem conferir o pin novo seria o mesmo trabalho manual com outra roupa). O gate
`check:runner-base` roda nas **duas** forjas (é node-puro) e é **CORE** no
`check:forge-parity`: a base é a mesma nas duas, e um pin velho não é assunto de
uma pipeline só. O probe da tag é o único passo que depende de rede — sem ele o
passo continua verde **DECLARANDO** que não conferiu o pin contra o que a tag
serve (o pin, o contrato e as mutações são offline).

**A COBERTURA DO RECORTE — `check-mirror-coverage.mjs` (a quarta tabela: o `env-mirror`).**

Os guards desta família declaram, cada um, a própria tabela de "onde o valor está
espelhado" (`BUN_MIRRORS`, `IMAGE_MIRRORS`, `MIRROR_VARIABLE_RULES`) — e um espelho
pode existir só na varredura GLOBAL. Aí um commit que troca ou APAGA aquela linha
passa pelo pre-commit (o hook é o recorte) e o defeito só aparece no CI, quando
aparece: o que o commit TIRA não está em linha adicionada nenhuma. O
`check:mirror-coverage` pergunta exatamente isso, **por execução**: num worktree
temporário, cada espelho é mutado (a troca do valor e a REMOÇÃO da linha),
estagiado, e os comandos do recorte (derivados da `fase_a()` do hook) decidem se
alguém o julga. O worktree é montado no **COMMIT PENDENTE** (índice + working tree,
via `git stash create`) e não no HEAD: as tabelas são lidas VIVAS, então um espelho
recém-declarado aparece na medição no mesmo instante — e medir o HEAD diria que o
arquivo "não tem a linha" quando ele tem (a mentira é do estado, não do espelho).
O limite: `git stash create` cobre arquivo RASTREADO.

O que a extensão acrescentou é a **quarta tabela**, derivada do COMPOSE
(`composeEnvVariables`), e não de uma lista à mão: são os nomes que o compose do
Gitea lê — `BUN_VERSION`, `IMAGE_REGISTRY`, `IMAGE_NAMESPACE`, o `RUNNER_TOKEN` e o
`GITEA__registry__ENABLED` (o par de VALOR declarado da etapa 1 do corte: o default
do compose tem de ser igual à linha do template, e quem os compara é o
`check:registry-source`).
O segredo é o motivo de a tabela existir: nenhuma das três tabelas anteriores o
cobria, e o par (template comitado ↔ env do host) é um espelho cujo lado
VERSIONADO um commit muda. A regra de valor das três variáveis da imagem **não é
reescrita**: a tabela LÊ a decisão de `MIRROR_VARIABLE_RULES[name].env` (duas
listas divergiriam no primeiro dia). E o raciocínio do segredo é OUTRO: no template
o valor é um PLACEHOLDER por desenho, então trocá-lo não é defeito — a mutação que
morde é a REMOÇÃO, e o pulo da outra só vale com o motivo escrito (`swap`
ignorado sem razão é violação; as DUAS ignoradas é "verde por vazio", também
violação).

**O CONTROLE, e por que ele é metade da medição.** Antes de mutar qualquer coisa,
os comandos do recorte rodam na árvore INTACTA. Um comando que falha ali falha por
AMBIENTE (dependência não instalada, ferramenta fora do PATH) — e contá-lo como
detector faria de uma suíte vermelha de ambiente uma **cobertura verde**. Medido:
num worktree sem `node_modules`, o `check-mutation-jobs --staged` falha SEM mutação
e seria atribuído a todas elas; com o controle ele sai da medição e o processo NÃO
termina verde (exit 2, INDETERMINADO). Um espelho que declara o recorte por um
desses comandos também é violação: a declaração não pode ser confirmada nem
refutada onde o guard não roda.

O veredito é **por tabela**: quantos espelhos cada tabela declara, quantos têm
regra no recorte e QUAIS ficam sem ela (nomeados), mais os que estão fora do
commit (o `deploy/.env.gitea` não versionado), que entram declarados em vez de
sumir da conta. Na árvore real: **8 espelhos medíveis, 0 com regra no recorte, 1
fora do commit** — e cada ausência tem decisão escrita (fail-closed: espelho sem
decisão, decisão que a medição não confirma e ausência declarada que a medição
contradiz são violação). O que a medição NÃO responde: quem cobre o espelho FORA
do recorte (a varredura global do PR, o `check-env-mirror` no bring-up) — isso está
declarado no motivo de cada linha, e medir esse outro degrau é o passo seguinte.

**Onde roda, e por que não no hook.** É invariante **CORE** do
`check:forge-parity` (mesmo comando nas duas pipelines), nos jobs `guards` (forja
dona do merge) e `check` (espelho) — os dois **instalam dependências**, e essa é a
condição da medição: ela SPAWNA os guards do recorte, e sem `node_modules` o
CONTROLE acusa (exit 2, INDETERMINADO) em vez de dar um verde falso. No hook ela
não entra: ~6s e ~80 invocações de guard por commit no caminho de cada
commit — a decisão está escrita em `HOOK_NOT_RUN` (o hook roda o gate de
paridade, que exige a classificação de um gate novo). Custo medido nesta árvore:
**5,2–5,5s** (controle) por rodada.

**Prova por mutação das três réguas que sustentam o veredito**
(`scripts/test-mutation-mirror-coverage.sh`, matriz do master). O guard passar
hoje prova que ele não acusou — não que as três réguas do contrato estão no
lugar. Um **driver** importa o `check-mirror-coverage.mjs` (mutado, quando há
mutação) e mede contra uma **BANCADA**: um repo git temporário com o espelho
`KEY=` e três comandos de recorte que se distinguem pelo que pegam (um só a
TROCA do valor, um só a REMOÇÃO da linha e um que falha **sempre** — o caso
"ambiente"). O que se lê é o RESULTADO (o que o controle nomeia, o que é
atribuído a cada mutação, as violações do contrato e a soma por tabela), nunca o
texto do arquivo — e a suíte unitária é a segunda testemunha, com âncoras (o
vermelho tem de ser o da metade mutada; as outras seguem verdes).

| metade | o que ela desliga                                                         | o que acontece sem ela                                                                                                                                                                      |
| :----- | :------------------------------------------------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **M1** | o CONTROLE (`confiaveis`: o comando que falha SEM mutação sai da medição) | o comando que só falha por ambiente passa a ser **ATRIBUÍDO** como detector de tudo — a cobertura sai verde por acidente de ambiente, que é o modo de falha que a régua existe para impedir |
| **M2** | a SOMA POR TABELA (a decisão do recorte dentro de `resumoTabelas`)        | todo espelho medível conta como "com regra" e a lista dos sem-regra fica **VAZIA**: a tabela publica cobertura que não existe, e sem nenhuma violação                                       |
| **M3** | a RECUSA DO PULO SEM MOTIVO                                               | o pulo sem razão passa como decisão — a porta pela qual uma lacuna deixa de ser medida sem ninguém decidir                                                                                  |

Cada metade é CIRÚRGICA (alvo com 0 ou 2+ ocorrências = a suíte PARA em vez de
medir outra coisa; o guard mutado tem de continuar válido) e a árvore volta por
**checksum** no trap `EXIT`. O CONTROLE FINAL exige as três leituras íntegras de
volta e o guard restaurado.

**LIMITE DECLARADO:** a precedência do `exit 2` (INDETERMINADO) não é injetada —
o CLI não aceita `--root`, então ele mede a árvore real, onde nenhum comando do
recorte falha por ambiente; e a precedência é o ANÚNCIO do mesmo fato (o guard
imprime o `⚠️ INDETERMINADO` com ou sem ela), não uma segunda cegueira. O que
cega é o filtro, e é ele que a M1 injeta.

---

## 3. Mutation tests — `test-mutation-*.sh` + `check-mutation-jobs`

**O que protege:** os guards NÃO são cosméticos — cada `test-mutation-*.sh`
muta um fixture (injeta literal, remove input, quebra âncora, apaga script) e
exige que o guard FALHE pela asserção certa. Guard cego (passa com a mutação)
bloqueia o CI.

**Por que existe:** guards sem prova de detecção viram dead code — um dev
remove/enfraquece a checagem e ninguém percebe. O master
`scripts/test-mutation-guards.sh` roda a matriz completa num job só do
pr-check; `check-mutation-jobs` valida que todo mutation script TEM job no
pr-check (um mutation novo sem job = falha).

**Onde roda:** CI (pr-check), local (`bash scripts/test-mutation-guards.sh`).

#### A re-medição do vermelho — um tiro não é veredito

Um sub-test que sai vermelho é **re-medido UMA vez** antes de virar veredito, a
mesma disciplina que o prover da pilha aplica a um commit. A razão é medida, não
estética: as suítes desta matriz sobem fixture, criam container e batem em
porta/memória, e um vermelho pode nascer do AMBIENTE — o instrumento acusando um
defeito que não existe, que é a direção cara do erro (manda consertar o que não
quebrou).

A régua é a **repetição**, nunca a segunda tentativa sozinha:

| 1ª tentativa | 2ª tentativa        | veredito                                                                           |
| ------------ | ------------------- | ---------------------------------------------------------------------------------- |
| verde        | (não roda)          | **VERDE** — o verde não é re-medido, e o custo fica de um tiro                     |
| vermelho     | vermelho            | **VERMELHO** (exit 1) — o vermelho é da ÁRVORE: repetiu                            |
| vermelho     | verde               | **INDETERMINADO** (exit 2, `flake: true`) — as duas se contradizem na MESMA árvore |
| vermelho     | não rodou (126/127) | **VERMELHO** — a 2ª não contradisse a 1ª                                           |

O flake **não vale verde nem reprovação**: publicar "verde" sobre um tiro esconde
uma regressão intermitente, e publicar "reprovado" sobre um flake manda consertar
o que passou na segunda tentativa. Por isso o exit da matriz distingue os três
desfechos — 0 todos verdes, 1 algum REPROVOU (depois de re-medido), 2 nenhum
reprovou e algum ficou indeterminado, 3 uso inválido — e o flake tem marca própria
(🌀) na tabela e no resumo (`Flaky: N`).

E o que foi repetido é **DITO** nos dois lugares: no `--json` cada sub-test leva
`tentativas`, `exit1`/`exit2`, `ms1`/`ms2` e `flake` (o `ms` publicado é a SOMA das
tentativas — o custo é o que o job pagou), e a família `mutations` do benchmark
versiona os mesmos campos na baseline, com a frase da família nomeando o flake
(`🌀 … FLAKY: …`) ou a re-medição que repetiu (`↺ … RE-MEDIDA(s)`). Um flake
também **não julga custo** na comparação: o `ms` dele são duas tentativas, e
chamar isso de "o sub-test ficou mais lento" seria vender a re-medição como
regressão.

#### O `name:` do job é o CONTEXTO do required check — o count NÃO mora nele

O nome de um job é o **contexto do status check**, e é esse contexto que o
branch protection exige (`ci/required-checks.json` →
`apply-required-checks.mjs`). Enquanto o job `mutation-guards` se chamava
`Mutation guards master (27 node-pure mutation tests)`, CADA bump da matriz
reescrevia o contexto protegido: a proteção aplicada na forja passava a exigir
um check que já não existe, e o PR travava esperando para sempre — bastava
adicionar um sub-test, sem que nenhuma linha de gate parecesse errada.

A régua agora é o INVERSO: o `name:` é **count-free** e o número é PROIBIDO ali
(quem cobra é `check-mutation-count`, que também deriva N e confere o count onde
ele é diagnóstico — summary do job, comentário, header do master e README). Um
segundo caso real caiu na mesma classe quando a regra passou a existir: o job
`mutation-coord-update` (required check) dizia
`..., 5 cenários` — e o contrato coordenado **ganha um cenário por release**, ou
seja, o contexto protegido mudava a cada release por desenho. Os dois nomes
perderam o número, e a `check-required-checks` recusa qualquer `name:` de
required check que carregue uma contagem — `TypeCheck (tsc --noEmit)` continua
passando, porque o parêntese não é uma contagem.

#### A descrição das metades é DERIVADA do próprio script (e a doc é conferida contra ela)

A prosa que descrevia cada sub-test vivia em TRÊS lugares à mão — o array
`SUBTESTS` do master, o bloco de prosa do cabeçalho dele e esta doc — e
acrescentar uma mutação deixava os três desatualizados **em silêncio** (a
contagem por extenso, então, envelhecia sem ninguém ver: no dia em que esta
regra passou a existir, a prosa dizia "DUAS metades" para uma suíte que já
declarava quinze).

Agora a fonte única é o **próprio script granular**: cada suíte declara

```bash
METADES=(
  'M1|a regra que a metade tira do lugar'
)
```

uma linha por metade, `'id|descrição'` — **em aspas simples**, e isso não é
estilo: o bloco é um array de BASH num script com `set -euo pipefail`, e em
aspas duplas o shell **expande** a descrição antes de guardá-la. Uma descrição
que cita o código da mutação (`echo $OUT | grep -Fq`, `${{ ... }}`,
`SCRIPT_DIR=$(dirname $0)`) faz a suíte estourar com `variável não associada` sob
`set -u` — o defeito **medido** que quatro suítes do repositório carregavam, com
a descrição virando o defeito e o gate verde sobre um script que não rodava. Em
aspas simples nada é expandido, e a régua **recusa a forma** (nomeando a
expansão e o remédio) em vez de aceitar uma declaração que mata a suíte. Dali
saem, sem texto à mão:

- a **descrição de cada sub-test** do master (a entrada do `SUBTESTS` voltou a
  ser `id|script`, e uma entrada com descrição escrita é violação — a prosa não
  pode renascer);
- o **resumo final do master** (a tabela `METADES DECLARADAS`, com o total por
  sub-test);
- o que o **`check-mutation-count` confere na doc**: no parágrafo que cita a
  suíte, a contagem declarada na forma canônica (`em <N> direções`, `declara <N>
metades`) tem de bater com o bloco — os números por extenso ("VINTE E QUATRO")
  estão no mapa da régua, e uma contagem que ela não sabe ler é violação, não
  omissão — e um id citado da MESMA FAMÍLIA (`M25` num bloco que vai até `M24`)
  tem de existir no bloco, nomeando o id e a lista declarada.

A régua é uma só (`scripts/metades.mjs`), usada pelo master (para imprimir) e
pelo guard (para conferir) — e a suíte que **não declara** o bloco falha nos dois
(fail-closed: bloco ausente, vazio, com linha fora do formato, com id repetido ou
com descrição curta demais é violação, nunca "nenhuma metade"). **Limite
declarado:** a prosa fala de SUBCONJUNTOS e de CONTROLES com as mesmas palavras
("as duas direções são exigidas em cada rodada", "o controle H1"); a régua
confere a forma da DECLARAÇÃO do total e ignora o id de um controle, de
propósito — cobrar toda ocorrência daria falso positivo em texto correto.

**Como é provado:** `scripts/test-mutation-mutation-count.sh` (mutação G: a suíte
sem o bloco falha nomeando a falta; H: bloco ilegível; I: a doc declarando um
total que não bate, com o delta na mensagem; J: a entrada em **aspas duplas** — a
forma que o shell expandiria e que mataria a suíte — é recusada nomeando a
expansão e o remédio) e `check-mutation-count.test.ts` (42 testes, cada regra com
o seu CONTROLE na direção oposta).

#### O count não pode ser PARTIDO entre dois commits locais — o recorte `--staged`

O N da matriz e as refs dele são **um número em seis arquivos**: o summary e o
comentário do job no `pr-check.yml`, o header do master, as refs do README e a
contagem declarada na doc das metades. Até aqui o guard rodava **só no CI** (o
job `mutation-count-guard`, espelhado na forja dona do merge) — e isso deixava
uma janela local: commitar a **matriz** num commit e as **refs** no seguinte. O
primeiro commit sozinho está inconsistente; quem o aprova na forja recebe um
vermelho por um número que o commit seguinte ia consertar, e um
`rebase`/`cherry-pick` do primeiro leva o count partido para outro ramo — o CI
é quem descobria, nunca o commit.

O recorte `--staged` fecha a janela: o veredito é o **conteúdo do ÍNDICE**. O
mesmo `run()` de sempre roda sobre uma árvore do índice materializada num
diretório temporário (`git show :path` de cada arquivo que o veredito lê: o
master, **as 37 suítes que o master cita**, o `pr-check.yml`, o README e a doc),
com o working tree **fora** — a diferença entre os dois escopos é o ponto, e ela
é medida nos dois sentidos (`check-mutation-count.test.ts`: o WIP partido da
árvore com o índice coerente passa; a árvore já consertada com o índice partido
— matriz estagiada, refs não — **reprova**, nomeando o delta).

**LIMITES DECLARADOS.** Um arquivo que o veredito lê e o índice **não tem** é
**violação nomeada**, nunca "nada a julgar" — o caso real é a suíte nova de um
sub-test novo escrita na árvore e ainda não estagiada: o commit da matriz
apontaria para um arquivo que ele não carrega (e o remédio está na mensagem: o
`git add`). O master ausente do índice é **exit 2** (infra). A **régua das
metades** (`scripts/metades.mjs`) é lida da árvore, não do índice: ela não é o que
este recorte julga (a contagem é), e quem a julga inteira são as duas pipelines.
Fora de um repositório git o modo sai 2 — nunca um verde por não saber.

**A prova por MUTAÇÃO** (`test-mutation-mutation-count.sh`, metades K/L/M, contra um
repositório git de verdade — o mesmo fixture + commit base): o **ESCOPO** (com o
recorte lendo a ÁRVORE o commit partido **passa**: a árvore coerente e o índice
partido do MESMO repositório dão vereditos opostos, e é isso que separa os dois
escopos), o **arquivo que o COMMIT não carrega** (a suíte nova na árvore e fora do
índice: o controle reprova **nomeando o índice** como a causa e o modo árvore
passa; sem o registro, o veredito perde a causa e sobra a acusação ao arquivo “que
não existe” — que existe, o commit é que não o carrega) e o **FAIL-CLOSED** (o
master fora do índice é exit 2; mutado para devolver “nada a julgar”, o recorte
fica **verde**). As três mutam o guard no lugar (backup + restauração conferida por
checksum) e exigem a suíte `check-mutation-count.test.ts` **vermelha**, que é a
segunda testemunha de que a regressão não passaria no PR em silêncio.

#### A matriz × o ATO que a versiona — a prosa certa sobre a matriz errada

O N da matriz e a prosa dele são **um número em seis arquivos**, e o guard acima
compara todos com o derivado — mas havia um **terceiro lugar** onde a matriz é
declarada e que nenhum deles via: o **registro versionado do ato**
(`docs/benchmarks/guard-timing-baseline.json`, família `mutations`, uma FORMA por
sub-test com o custo medido). A prosa pode estar toda certa enquanto o registro
segue com as formas do ato ANTERIOR — e foi exatamente o que aconteceu em
22/09/2026: a matriz ganhou o `doc-hashes` e o `stack-per-commit`, o registro
ficou com as 37 formas do ato anterior, e o número declarado do job (e o **PISO**
do job `guards` da forja dona do merge, que dele se soma) passou a descrever uma
matriz que já não existia. Nada acendia: o count na prosa batia consigo mesmo.

Agora o `run()` entrega a **matriz** (os ids do `SUBTESTS`, derivados como
todo o resto) e o **registro** à mesma régua, e a defasagem é violação nomeada:
`a matriz tem N sub-test(s) que o ATO não versionou (<ids>)`, com o comando do ato
como remédio (`node scripts/bench-guard-timing.mjs --only mutations --json
--baseline --merge`, com a árvore **JÁ COMMITADA** — o registro é uma medição, e
uma medição sobre o working tree grava um commit de origem que não tem o que ela
mediu). O count GRAVADO da família tem de ser o da matriz, e as formas e o count
têm de descrever a MESMA matriz.

**A COLUNA DE METADES É DERIVADA DA MATRIZ.** Até 23/09/2026 ela era “a do ATO” —
saía da rodada que mediu o CUSTO, e isso valia como limite declarado enquanto a
_única_ leitura da unidade fosse o bloco `METADES=(...)` da própria suíte. O
problema é que o custo **herda** e a unidade **não**: numa gravação que herda a
família (`--merge`, `--only`) a coluna viajava junto com o custo, e uma unidade
acrescentada à suíte DEPOIS daquela medição ficava escrita como a anterior — o
registro dizia **oito** metades para uma suíte que já declarava **dez**. Agora o
ato **reescreve** a coluna (e o total da família) a partir da matriz, depois da
herança: o custo continua o da rodada que o mediu (é o que `meta.reused`
descreve), a unidade passa a ser a da suíte **desta árvore**, e o próprio registro
diz o que fez (`metadesDaMatriz: {total, atualizadas, semDerivacao, naoMedidas}`).
A régua é uma só — `scripts/metades.mjs`, via `metadesDaMatriz` em
`bench-families.mjs`, lida pelo ato e pelo guard: duas derivações divergiriam no
dia em que uma das duas fosse ajustada. E é isso que dá ao guard o que julgar: a
coluna divergente é violação nomeada (`a forma '<id>' GRAVOU N metade(s) e a
matriz declara M`), com o ato como remédio.

**LIMITES DECLARADOS (e de propósito).** A derivação não inventa número: a forma
cujo id a matriz **não conhece** fica intocada e é dita em `semDerivacao`, e a
unidade que a matriz **não conseguiu medir** (suíte citada e ausente, bloco
`METADES` ilegível) fica intocada e é dita em `naoMedidas` — zero ali apagaria o
número que o registro já tinha, e “não medido” não é “zero metades”. O que a
coluna **não** carrega é a COBERTURA (quais ids cada forma protege): o registro
guarda a contagem, a lista é do bloco da suíte, e quem a confere é a doc. Uma forma
que **SOBRA**
(um sub-test que saiu da matriz e continua no registro) existe até o próximo ato, e
o resultado a lista em `sobrando` para o relatório poder dizê-lo, sem virar
violação. A coluna cuja unidade a derivação **não conseguiu medir** (suíte citada
e ausente, bloco ilegível) não é acusada de divergir: ali a leitura é que falhou, e
a lista `metadesNaoMedidas` a DIZ — o guard já nomeia essa falta na metade das
METADES, e acusar a coluna seria acusar a leitura. O total da família é conferido
contra a **coluna do próprio registro** (as duas leituras da mesma medição) — não
contra a soma da derivação, que incluiria a forma que **sobra** e que é tolerada
até o próximo ato. O registro **fora da árvore** não é violação — mas o veredito DIZ que a
ligação não foi julgada (`present: false`, com o caminho nomeado), porque o
silêncio de uma metade que não rodou é indistinguível de um verde. Um registro
**presente e corrompido** é **exit 2** (INFRA), nunca “nada a julgar”: a ausência é
declarada, a corrupção não — a mesma distinção do `readOrDie`. No recorte
`--staged` o caminho entra na materialização do índice: se o COMMIT carrega o
registro, é o conteúdo DELE que é julgado (e, ausente do índice, vale a ausência
declarada da árvore).

**Como é provado:** `bench-guard-timing-mutations.test.ts` (a derivação do ato, em
fixture: a unidade que entrou depois da medição é corrigida com o TOTAL e a frase; o
CUSTO não é tocado; a forma que a matriz não conhece e a que ela não conseguiu
medir ficam intocadas e são DITAS; sem derivação a família sai pela MESMA
referência e COM derivação sai OUTRA, com a marca `metadesDaMatriz` (nada mudou ≠
não rodou); e, contra o registro real, o único vermelho é a coluna — a derivação do
ato é o que faz o veredito do guard **passar**, sem reescrever número à mão),
`check-mutation-count.test.ts` (a régua pura — o ausente dito,
o `measured: false`, o count gravado divergente, a família que não existe, o que
sobra sem virar violação, e a COLUNA: o delta nomeado, o CONTROLE derivado, a forma
sem número de metades, o total que não fecha e a ausência da derivação (que passa e
é DITA como não julgada) —, o ato no ÍNDICE contra a árvore coerente, o registro
ilegível como INFRA e o veredito VERDE publicando o ato) e
`test-mutation-mutation-count.sh` (metades **N**, **O**, **Q** e **R**): o CONTROLE com a matriz
inteira versionada passa E o verde diz o que o ato versionou; a **defasagem**
(matriz 14 × registro com 13 formas) FALHA nomeando `sub-14` e o comando do ato; a
**ligação DESLIGADA** (o `run()` deixando de entregar a matriz ao registro) faz a
mesma defasagem **passar** — a ligação é load-bearing, não o fixture; o
**fail-closed** do registro corrompido (exit 2) mutado para devolver a ausência
torna a defasagem **verde**; a **COLUNA herdada** (a `sub-1` grava 1 metade onde a
suíte declara 2, com as 13 formas versionadas e o count certo) FALHA nomeando a
forma e o delta, e sem a derivação passada à régua ela **passa**; e o **TOTAL** que
não soma a própria coluna FALHA com os dois números — fora da régua, o mesmo
fixture passa. As quatro mutam o guard no lugar (backup + restauração
conferida por checksum) e exigem a suíte **vermelha**.

Roda na **fase A do pre-commit** (`node scripts/check-mutation-count.mjs
--staged`, recorte declarado em `HOOK_DECLARED` do `check-hook-ci-parity`), custo
medido de **~0,2s** (um `git show` por arquivo do veredito, em paralelo com os
outros guards da fase); o comando **inteiro** continua sendo o do CI, nos
dois jobs de mutation.

#### A PROVA-DE-APLICAÇÃO é UMA — a régua hoisted e o gabarito que a mede

Toda suíte de mutação substitui um trecho do alvo por outro e precisa **provar
que a substituição entrou**: o alvo pode casar e a escrita falhar (permissão,
disco, um `open` que não trunca), e uma mutação que NÃO aplicou seria medida
contra o alvo ÍNTEGRO — a suíte passaria em **VÁCUO**, com o verde sobre uma
árvore que ninguém mutou. Até 27/09/2026 essa prova vivia **COPIADA** em cada
suíte: a mesma dezena de linhas (`mutar` com a cirurgia em python, o `grep` do
marcador `MUTACAO` e a conferência do checksum), reimplementada dezenove vezes —
e com uma variação a cada cópia (o nome da variável do arquivo, o da variável do
checksum, o idioma do marcador, a checagem de sintaxe presente ou não). Medido:
das **44 suítes** que injetam uma mutação cujo payload CARREGA o marcador, só
**18** verificavam que ele chegou ao arquivo; e uma cópia que simplesmente
SUMISSE não deixava rastro — a suíte seguia verde, medindo o alvo íntegro.

Hoje a prova é **UMA**: `scripts/mutacao-prova.sh`, SOURCED pelas suítes, com as
três provas **fail-closed** na ordem — a **CIRURGIA** (o `<antes>` casa UM e só um
lugar: zero ou dois é mutação não-cirúrgica e a suíte PARA em vez de medir outra
coisa), a **APLICAÇÃO** (o arquivo passa a carregar o marcador `MUTACAO`, a prova
de que a ESCRITA entrou) e o **CONTEÚDO** (o checksum mudou). Cada prova é um
**predicado com nome** cobrado numa LINHA só, porque é esse sítio que o gabarito
desliga para medir — e nenhuma suíte reimplementa a prova: quem a perde perde o
veredito, e o gabarito `scripts/test-mutation-mutacao-prova.sh` declara **3
metades** (o MARCADOR, o CONTEÚDO e a CIRURGIA): desligar uma delas, uma por vez,
faz a recusa virar **ACEITE** — o único veredito que prova que a prova é
**load-bearing**; desligar a prova e a recusa continuar é a metade NÃO detectada.
A biblioteca é mutada PELA PRÓPRIA régua (com a prova de que a escrita entrou) e
restaurada por checksum entre as metades. **18 suítes** provam a aplicação pela
régua única, e a lista viva delas é o bloco `PROVA_DE_APLICACAO` do master.

**O que impede a perda em SILÊNCIO** é o `check-mutation-count` (a regra 4b do
`run()`), e são três conferências: (1) NENHUMA suíte carrega a cópia PRIVADA do
`grep` do marcador — uma cópia que nasce não é medida por gabarito nenhum, e a
mensagem aponta a linha e o remédio (`mutacao_aplicar` traz a cirurgia, o
MARCADOR e o CONTEÚDO juntos); (2) a lista DECLARADA no master é conferida nos
**DOIS sentidos** contra as suítes que chamam `mutacao_aplicar` — tirar a chamada
de uma suíte (e a prova com ela) deixa a entrada órfã, e acrescentar a chamada sem
declarar também reprova; (3) a doc declara o NÚMERO da lista, e é ele que uma
suíte a menos derruba. As suítes que NÃO estão na lista são as que injetam mutação
por conta própria, sem reivindicar a prova do marcador (o payload que não é
comentável, por exemplo): elas ficam ditas pelo que **não** declaram, nunca por
omissão.

#### O ATO × A ÁRVORE QUE ELE DECLARA TER MEDIDO — o instrumento que se cobra

A régua acima compara o **registro** com a **matriz da árvore** — as duas coisas
na árvore em que as duas estão. Isso deixa de pé a terceira afirmação do mesmo
registro: **a ÂNCORA**, o commit em que a medição teria acontecido. `MEDIDO: N
sub-tests` e `medido no commit X` podem divergir, e a divergência é **invisível
para qualquer guard que lê uma árvore só**: o registro e a matriz concordam entre
si, e mesmo assim a árvore de X não carrega a matriz declarada. Medido neste
repositório: a rodada gravou uma origem cuja árvore não tinha a nona metade
que o próprio registro declara ter medido — o veredito passou a falar de uma
árvore que não existiu, e o número em jogo é a **proveniência** que o merge lê.

O `check-act-origin` **abre a árvore da ÂNCORA** e confere a matriz
declarada contra ela, em sete regras nomeadas no veredito: a origem **resolve**
(R1 — um nome morto de reescrita não sustenta medição nenhuma), pertence à
**história** do HEAD (R2), e para cada forma declarada ela **existe** naquela
árvore (R3a), tem as **mesmas metades** (R3b), a árvore não carrega forma que o
registro **omite** (R3c) e o **total** `subtests` bate (R3d). A matriz de lá sai
das DUAS leituras da casa (`deriveSubtestCount` e `metadesDeclaradas`) e nunca de
uma segunda. O que fica fora é DECLARADO, não presumido: a forma cuja suíte de lá
não declara `METADES=(...)` entra no relatório como **não julgada**, e a
proveniência por família (`meta.reused`) não é o sujeito daqui — o sujeito é a
matriz do ato.

**AS SETE REGRAS SÃO PREDICADOS DE UMA LINHA**, e
`scripts/test-mutation-act-origin.sh` cega **uma por vez** e exige que o MESMO
registro desonesto deixe de ser recusado — as nove metades da 42ª entrada da
matriz (sub-test `act-origin`). Sem isso, um gate verde sobre um registro que
descreve uma árvore que não existiu é **pior** que não ter gate: ele afirma o que
não mediu. A M1 é a única medida pela **acusação** e não pelo exit, e isso é do
fenômeno, não da suíte: uma origem que não resolve é, por construção, também fora
da história (e sem árvore), então cegar R1 não faz o registro passar — faz ele
ser acusado pela regra seguinte, com o nome errado. A M9 é a metade da **ÂNCORA
RESOLVIDA**: o registro vai para um commit cuja árvore carrega TRÊS formas
declarando DUAS, e a procedência aponta um commit que carrega exatamente as duas
— cegar a resolução faz o gate julgar o **pai** (o comportamento do esquema v6) e
o registro desonesto PASSAR.

**A ÂNCORA É RESOLVIDA, NÃO DIGITADA — e é isso que dispensa a re-rodada.** O
`--baseline` mede a árvore **suja** (a matriz já está na árvore, e o commit que a
carrega ainda não existe), então o hash do commit que CARREGA o registro não é
gravável dentro dele: **um commit não pode conter o próprio hash** (o campo entra
no blob, o blob no tree, o tree no commit). Até o esquema v6 o registro gravava o
**pai** — a árvore de lá não carrega a matriz declarada, e este gate recusava,
com razão, TODA rodada honesta: o preço era rodar o ato DE NOVO na árvore já
commitada, **dois commits para uma medição só**. A v7 declara a REGRA
(`meta.anchor = "carrier"`) e a PROCEDÊNCIA (`meta.parentCommit`, o topo sobre o
qual o ato rodou), e este gate **resolve o PORTADOR** pela história
(`origemDoRegistro`/`commitQueCarrega`, a MESMA régua que a idade e o `formOrigin`
usam): as três regras passam a valer para a árvore do commit que de fato carrega o
registro, e a medição cabe em **um** commit. O caminho antigo segue julgado (o
`meta.commit` gravado de um registro v6 ainda responde), e a ausência das duas
declarações é violação nomeada — não há fallback mudo. Por isso ele **não roda no
pre-commit**: no hook o commit que carrega o registro ainda não existe, e a
resolução do portador é do commit (a decisão está escrita em `HOOK_NOT_RUN`). Ele
roda nas **duas** pipelines, como invariante do CORE.

#### O OUTRO LADO da mesma lei: a reaplicação da proteção é DECLARADA

A regra acima protege o contexto contra a contagem — mas ela vale para o FUTURO
do nome, e o defeito que resta é o PASSADO dele: quem bloqueia o merge não é o
`ci/required-checks.json`, é a proteção **APLICADA** na forja, que exige o
contexto de status. Renomear o `name:` de um job required (ou pôr/tirar um job da
lista) muda o contexto exigido, e a forja segue exigindo o ANTIGO: o PR trava num
check que nunca mais roda, sem nenhuma linha de gate parecer errada. Até agora
dois horários cobriam isso e nenhum deles era o PR — o `apply-required-checks
--check` (no cron de drift, com token) lia a forja e o **doctor** publicava o
drift, os dois **depois do merge**.

Por isso a reaplicação passou a ser **declarada no repositório**:
`ci/required-checks-applied.json` guarda os contextos que a forja exige (e as
BRANCHES protegidas — uma branch nova no manifesto é a mesma classe: a proteção
dela não foi aplicada), escritos por `apply-required-checks.mjs --apply` (quem de
fato reaplica — o arquivo nunca é editado à mão, senão "declarado" deixaria de
significar "aplicado"). O `check-required-checks` julga as DUAS metades no mesmo
veredito: o manifesto contra os workflows (offline, o que o repo DECLARA) e a
declaração contra os contextos/branches derivados AGORA. Uma mudança que renomeia sem reaplicar fica
**vermelha** nomeando o job, o contexto novo e o contexto velho que ficaria
órfão, com o remédio (`bun run ci:required-checks -- --apply`).

Três decisões que o desenho tomou, e por quê:

- **o `--apply` escreve a declaração, e só quando o CONTEXTO muda.** Um carimbo de
  data novo a cada reaplicação sujaria a árvore com um diff de uma linha — e um
  arquivo que se mexe sozinho ensina o operador a ignorá-lo (um arquivo ignorado
  não declara nada). Uma forja FORA do alvo (`--forge gitea`) mantém a declaração
  anterior: a proteção dela não foi tocada nem lida nesta rodada;
- **a declaração ausente ou ilegível é PROBLEMA, nunca "nada a comparar".** Sem
  ela não há como distinguir "reaplicado" de "esquecido", e um verde por ausência
  de arquivo é exatamente o modo de falha que este gate existe para fechar. JSON
  inválido, `version` errada, `contexts` que não é lista, contexto duplicado,
  declaração de outra pipeline e forja sem entrada também são violações próprias;
- **os dois horários continuam com papéis distintos.** O PR cobra a DECLARAÇÃO
  (o que o repo tem de cumprir), o cron de drift cobra a FORJA (o que ela tem de
  ter): declarar sem aplicar não fecha o ciclo — quem fecha é o `--check`, com
  token, e a divergência vira issue;
- **a forja que RECUSA a feature é um ESTADO DECLARADO, não um aborto.** O GitHub
  deste repositório é privado num plano sem branch protection: nenhum required
  check pode ser aplicado nem LIDO (403 `Upgrade to GitHub Pro or make this
repository public`, que **nenhum** token resolve). Antes, o `--apply` apenas
  falhava — e a consequência era dura: o manifesto não podia exigir **nem um**
  gate daquela forja (o guard reprova o contexto novo sem a declaração), e a
  cobertura que roda fora do contrato de merge ficava vermelha sem bloquear nada.
  Agora o `--apply` DECLARA o estado (`unsupported: {reason, readAt}` na entrada
  da forja, ao lado dos contextos que passam a descrever a INTENÇÃO), e o
  veredito o publica em toda rodada com o remédio que não é código
  (plano/visibilidade). O estado MUDO é violação própria: sem motivo e sem data,
  "não há portão" vira mais um verde que esconde o fato. E as duas pontas do
  mesmo cuidado: a forja FORA do alvo **conserva** o marcador lido antes (apagá-lo
  faria o "sem portão" sumir sem ninguém ter medido que ele acabou) e a forja que
  **nunca foi lida** não ganha entrada nenhuma (o verde por omissão desta classe).

**E o HOOK LOCAL passou a cobrar o mesmo (`--staged`).** O rename era invisível
no commit: `required-checks` estava em `HOOK_NOT_RUN` com a justificativa de que
"o hook já roda a paridade de gates, que pega o efeito" — e ela é **falsa para o
rename**. A paridade (`check:forge-parity`) julga a CLASSIFICAÇÃO de um gate
(CORE/GITHUB_ONLY, a régua do comando), e renomear o `name:` não muda
classificação nenhuma: o efeito é no CONTEXTO que a forja exige, e quem o mede é
este guard. Sem o recorte, o commit saía do hook e a divergência só aparecia no
CI — ou, num PR cuja base não é `main` (o filtro de `branches` das pipelines),
**no cron semanal**, que é exatamente o que não podia continuar acontecendo.

O modo `--staged` julga o **ÍNDICE** (`git show :path` — o que o commit vai
gravar, não a árvore: um rename corrigido na árvore e ainda no índice É deste
commit; um rename só na árvore NÃO é) e roda **só quando o commit toca o
contrato**: o manifesto, a declaração ou qualquer YAML (o alcance da comparação é
o repo inteiro nos dois casos — o recorte é da RELEVÂNCIA do commit, não do
escopo; e "qualquer YAML" é deliberadamente amplo, porque o predicado de workflow
da fonte única mora num módulo que carrega `js-yaml` no grafo e este script roda
em jobs que **não instalam** `node_modules` — medido: o import reprovava os dois
crons de drift no `check:job-deps`). Nos outros commits: um
`git diff --cached --name-only` e um aviso, ~30ms. Índice ilegível (fora de um
repositório) é **exit 2**, nunca "nada a julgar".

**A prova:** `src/lib/__tests__/required-checks-staged-cli.test.ts` prova o
recorte contra um git de VERDADE: rename staged sem a declaração fica vermelho
(nomeando o job, o contexto novo e o órfão), o mesmo rename com a declaração
reaplicada junto passa, o veredito LÊ O ÍNDICE (com o índice carregando o rename
e a árvore revertida ele ainda reprova; com o rename só na árvore, passa) e o
índice ilegível é exit 2. E
`src/lib/__tests__/required-checks-applied.test.ts` mede as três
direções do rename por EXECUÇÃO da CLI (`--root` num repositório temporário):
em sincronia passa, sem a declaração o PR fica vermelho nomeando `job "lint"` e
os dois contextos, e a MESMA mudança com a declaração reaplicada passa — mais o
fluxo inteiro (renomear → `writeAppliedRecord` → verde), a ausência de churn e
cada caso de falha-closed. A fixture do `test-mutation-mutation-count.sh` declara
a proteção em sincronia, para o cenário do count continuar com UMA causa de
vermelho.

**A prova por MUTAÇÃO:** `scripts/test-mutation-required-checks-applied.sh` (o
29º sub-test do master) muta as DEZ metades que sustentam esse veredito — as
duas réguas da comparação (a do contexto derivado e a do órfão), o fio que as
julga em `main()`, o fail-closed do carregamento, o ALVO do `--forge` e o CARIMBO
sem churn, as duas da forja que RECUSA a feature (o marcador é GRAVADO pelo
applier, e ele não pode ser MUDO — razão e data obrigatórias), mais as duas do
veredito LOCAL: a FONTE dele é o ÍNDICE (mutado para
ler a árvore, o fato do índice cai) e o fail-closed do índice (mutado para
devolver lista vazia, "não consegui ler" vira "nada a julgar" e o fato do índice
ilegível cai) — cada uma com a testemunha certa (as duas últimas rodam o
`required-checks-staged-cli.test.ts`) e exigindo a suíte VERMELHA **pela âncora
de cada metade**, com as OUTRAS metades seguindo verdes: é isso que separa "esta
régua morreu" de "a suíte explodiu inteira". Cada mutação é cirúrgica (uma ocorrência, checksum
conferido) e a árvore é restaurada no mesmo trap; sem `vitest` o ensaio se declara
NÃO JULGÁVEL em vez de sair verde.

#### A TESTEMUNHA de uma mutação não é o exit code (09/2026)

Quando a suíte é a testemunha, "o comando saiu ≠ 0" **não** é veredito: o
exit code é não-zero por ambiente sem `node_modules`, por `bun` fora do PATH,
por import quebrado e por filtro que não casa teste nenhum — e ler isso como
"mutação detectada" faz o script **passar verde provando nada**. A regra é a
mesma em todas as suítes que usam ferramenta instalada: a testemunha é lida
pelo **JSON do vitest** (`--reporter=json` → `status`) ou pela **mensagem
específica** do guard, e a **ÂNCORA é exigida VIVA** (presente uma única vez — o
número de testes que casam é conferido — e PASSANDO com a fonte íntegra) antes
de o mutante ser injetado; sem isso a detecção seria vácuo. Foi medido em
`test-mutation-reconciliation.sh`, o único que lia exit code como veredito: com
`bun`/vitest indisponíveis ele imprimia "3 mutações DETECTADAS / MUTATION TEST
PASSED" sem a suíte existir.

**O FIXTURE QUE NÃO CARREGA é a mesma classe, e foi medido em 26/09/2026.** Duas
suítes montam um fixture com o guard **COPIADO** (`test-mutation-doc-hashes.sh` e
`test-mutation-act-origin.sh`) e levavam os vizinhos por uma **lista à mão**
(`FECHO_GUARD=(...)`). Quando a entrega do gerado fez o `bench-table.mjs` — vizinho
de **SEGUNDO grau** do `check-mutation-count.mjs` — importar o formatador do
repositório, a cópia ficou **incompleta**: o guard morria com
`ERR_MODULE_NOT_FOUND` e o exit 1 do **NODE** passava por veredito do guard. As
duas pontas passaram a ser fechadas, e nenhuma delas é uma lista:
**(1)** o fecho é **DERIVADO do grafo** (`scripts/fecho-imports.mjs`): quem copia um
módulo copia o que o importador importa, transitivamente, e uma aresta relativa que
não resolve (ou um bare de PACOTE, que o fixture sem `node_modules` não roda) sai 2
— meio fecho mede outra coisa;
**(2)** a suíte mede a **EXECUÇÃO**: `ERR_MODULE_NOT_FOUND` na saída da cópia PARA
a suíte em 2 (infra declarada), nunca veredito. A checagem mora FORA do `rodar` de
propósito: ele é chamado em substituição de comando (`$(rodar …)`) e um `exit` lá
dentro terminaria o SUBSHELL, deixando o pai seguir com o fixture morto — medido no
ensaio, o `exit 2` "saía" e a suíte terminava 1, com o defeito do fixture lido como
falha de mutação.

**A RÉGUA PASSOU A SER UMA SÓ, também para os outros dois fixtures que copiam
módulo.** A prova do `pre-commit` e o recorte do `pre-push` conferiam a completude
com uma **descida própria** — regex de `from` e de `new URL` numa, regex de `from`
na outra —, e a diferença entre duas réguas apareceu na primeira medição com a
régua única: a derivação do fecho do `pre-commit` devolveu **42 módulos contra 41**
da lista, e o que faltava era `prove-runner-image-gate.mjs`, carregado por
`await import("./…")` **LITERAL** no `ensure-runner-image.mjs` — uma aresta que as
regexes locais não leem, e que o fixture precisaria ter no dia em que aquele
caminho fosse exercido. Para não perder a forma que a descida antiga cobria, a
régua passou a seguir também `new URL("./x.mjs", import.meta.url)` (como o remédio
do pre-commit referencia o guard vizinho): uma aresta a MAIS para todo consumidor,
em vez de um caso a menos por régua. E o bare de pacote — que a régua recusa por
desenho — é **permitido por declaração** no caso do `pre-commit`
(`permitirPacotes`): aquele fixture roda com o `node_modules` da instalação, e quem
responde pelos pacotes dele é o `naoRelativos()` com o probe do teste, que os
nomeia.

Os dois fixtures foram além da conferência, e cada um no limite do que o grafo
alcança. O recorte do `pre-push` **deixou de declarar lista**: ele copia a
derivação do grafo (`fechoDoRecorte`, o mesmo que as suítes de mutação fazem com o
`mapfile`), então não há lista para envelhecer — e uma derivação que não fecha
LEVANTA com os problemas nomeados (aresta que não resolve, bare de pacote, caminho
fora da raiz), que o `catch` da prova e o do `readPrePushBlock` publicam como
`unavailable`, nunca como meio fixture medido. A prova do `pre-commit` copia a derivação
que sai das duas ENTRADAS (o guard do índice e o remédio) MAIS as SEMENTES que
import nenhum liga a elas (`CLOSURE_SEM_GRAFO`) — e as sementes são o limite do
que o grafo não vê: as declarações de classe e do canal, carregadas por CAMINHO
CALCULADO (a varredura de diretório não é estática), os guards que o dublê do hook
SPAWNA e os encoders de SHELL/PYTHON (não há import a derivar; declaração e guard
dono andam em par). MEDIDO (27/09/2026): a lista à mão que existia ali tinha 42
linhas, o grafo das ENTRADAS alcançava 15, e a derivação com as SEMENTES devolve
**46** — as 42 de então mais a guarda da declaração da imagem do runner
(`check-runner-tag.mjs`, que o hook roda na fase B) e as TRÊS dependências que ela
puxa pelo grafo (`check-runner-labels.mjs`, `check-actrc-sync.mjs`,
`check-registry-source.mjs`) — com a poda conferida uma a uma (nenhuma semente é
alcançada pelas outras). O que a catraca acrescenta: uma semente que a derivação SEM ela já traz
sai NOMEADA como linha redundante — foi assim que o `prove-runner-image-gate.mjs`
(que entrara à mão pelo `import()` LITERAL) foi visto —, em vez de envelhecer em
silêncio.

**E o fixture passou a MATERIALIZAR ARTEFATOS do repositório — DERIVADOS, e já não
por lista à mão.** O fecho cobre `scripts/`; um guard fail-closed sobre um arquivo
FORA dele — o compose da forja, que a guarda da tag da imagem do runner abre por
caminho — lia, na cópia, o ramo de INFRA (artefato ausente = exit 2) e o vermelho
seria do FIXTURE, não do defeito. Era essa a razão de o `runner-tag` estar em
`HOOK_NOT_RUN`; com o artefato na cópia a guarda roda no hook, na fase B, com a
MESMA linha do CI.

Até 27/09/2026 essa materialização saía de `ARTEFATOS_DO_FIXTURE = [GITEA_COMPOSE]`
— uma LISTA À MÃO, e o motivo de ela existir era dito no próprio código: "o guard
abre um caminho calculado em runtime, não há aresta de import a derivar". Isso é
verdade sobre o GRAFO e falso sobre o FIXTURE: o que não se deriva do fonte se MEDE
da EXECUÇÃO. Quem responde agora é o `scripts/artefatos-do-hook.mjs`:

1. lê os comandos de node do TEXTO do hook (cada guard é uma linha — a mesma fonte
   que o `check-hook-commands` julga), deriva o **fecho de imports** de cada um
   (fail-closed: aresta que não resolve, bare de pacote ou comando ausente do
   checkout LEVANTA, em vez de devolver uma lista parcial) e monta um fixture com
   esse fecho e **nenhum** artefato;
2. roda cada comando atrás de um **pré-carregador** que registra toda TENTATIVA de
   abertura (`readFileSync`/`openSync`/`readFile`/`createReadStream`/`existsSync`),
   e o link `--require` vai no argv do processo que ele mesmo spawna (sem depender
   de `NODE_OPTIONS`, que teria de citar um caminho de tmpdir);
3. o artefato é o caminho que um guard ABRIU, não achou na cópia e **existe no
   repositório** — e cada entrada sai com o COMANDO que a abriu (`porComando`),
   então uma sobra sem leitor deixou de passar em silêncio.

MEDIDO na árvore de hoje: **9 artefatos** (o compose, `.actrc`, os quatro
`Dockerfile*`, `mini-services/realtime/Dockerfile`, `deploy/env.gitea.example` e
`.woodpecker.yml`), todos com leitor nomeado. O que ele **não vê** é declarado no
cabeçalho do módulo: só processos de NODE (os comandos `bun`/`bash` do hook operam
sobre a própria cópia) e nenhum processo filho de um guard.

E uma recusa é DECLARADA, não filtrada em silêncio: o `package.json` é aberto por
três comandos e **não** entra na lista (`NAO_SAO_ARTEFATOS`, com o motivo). Medido
com o terminal de verdade: materializá-lo deixa o par (`.husky/`, `package.json`)
completo, e aí o remédio passa a julgar o hook DA CÓPIA — que é o DUBÊ do harness,
nao o hook do repositório — acusando o harness e derrubando três casos da suíte do
pty em que a resposta correta é "nada a remendar". O par responde pelo mesmo motivo
que o `.husky/` está fora do escopo: o hook da cópia é a FONTE SOB TESTE, e quem o
julga é a prova da mutação, não a prontidão do commit.

O que faz a lista à mão **não** voltar é um teste, não uma promessa
(`src/lib/__tests__/artefatos-do-hook.test.ts`): num root sintético, uma guarda que
NÃO EXISTE no repositório mais um hook que a chama fazem o artefato dela entrar
SOZINHO — e o par contra-prova (o mesmo root com o artefato e a guarda na árvore,
e um hook que NÃO a chama) mostra que a derivação segue o HOOK, e não uma varredura
de diretório. Um comando citado pelo hook e ausente do checkout não vira lista
parcial: a derivação LEVANTA, e o `artefatosDoFixture()` do fixture também — a
cópia não se monta com meio fecho.

**A DERIVAÇÃO ela mesma virou metade da matriz — e a suíte declara 3 metades, de
propósito** (`scripts/test-mutation-artefatos-do-hook.sh`, as metades `M1`, `M2` e
`M3`).
A régua da derivação é um MECANISMO, e um mecanismo que devolve vazio por regressão
é o pior desfecho: o fixture perde os artefatos, a guarda fail-closed lê INFRA na
cópia e o vermelho deixa de falar do defeito — a lista à mão volta pela porta de
trás sem que ninguém edite uma linha de lista. A metade `M1` esvazia o RETORNO da
derivação. A metade `M2` é o caso VIL, e é por isso que ela existe SEPARADA: a
COLETA para de registrar UM leitor e a lista derivada perde o
`deploy/docker-compose.gitea.yml` — os OUTROS OITO artefatos seguem lá, a derivação
não acusa problema nenhum e o fixture materializa oito de nove. Uma lista com um
item a menos passaria como "lista menor" se só a lista VAZIA fosse vigiada; o que a
barra é o artefato que o fixture PRECISA (fail-closed por dependência, não por
tamanho de lista). As metades `M1` e `M2` exigem que o veredito MUDE, cada uma com
as mesmas duas testemunhas: a leitura por execução (node-pura) importa a derivação e o
fixture REAIS, materializa a cópia e RODA O HOOK — no CONTROLE o fixture fica VERDE
(exit 0, a guarda da tag cunha o veredito do pin e o hook completa), e com CADA
metade ele fica VERMELHO pelo INFRA do artefato ausente ("não existe em" / "sem o
artefato não há veredito a cunhar", e o hook NÃO completa), com a lista mutada
conferida contra a do CONTROLE menos UM item NOMEADO; e a suíte do FIXTURE
(`pre-commit-runner-tag-blocks.test.ts`) fica VERMELHA na âncora que exige o
artefato na cópia. Sem elas, um PR que devolvesse a lista vazia — ou que perdesse um
artefato dela — passaria no CI em silêncio.

A metade `M3` não muta a derivação: ela arranca a **PROVA-DE-APLICAÇÃO** — a troca
deixa de carregar o marcador `MUTACAO` que o `mutar` exige para saber que a mutação
APLICOU — e o que se exige é o **VERMELHO da PRÓPRIA suíte**. Sem esse marcador, uma
mutação que não aplicasse seria medida contra o guard ÍNTEGRO: o vermelho do fixture
viria do defeito e a detecção da metade seria **vácuo**. É a única entrada da matriz
que cobra o vermelho do harness em vez do veredito do guard, e é o gabarito de que as
outras não passam em vácuo — o motivo da recusa é conferido na saída (um vermelho por
outra causa, como a troca não-cirúrgica, não é esta metade).

#### Mutation tests que precisam de `node_modules` (fora da matriz node-pura)

A matriz do master é **node-pura** (não instala deps). Cinco mutation tests
rodam o **vitest REAL** e por isso vivem em jobs próprios do
`seed-guards.yml` (reusable chamado pelo pr-check, com `bun install`):

- `scripts/test-mutation-coord-update.sh` (job `mutation-coord-update`) — o
  contrato coordenado doc↔anchor↔código dos counts E2E;
- `scripts/test-mutation-doctor-mirrors.sh` (job `mutation-doctor-mirrors`) —
  remove a **comparação de valor** dos espelhos do `forge-doctor.mjs`
  (`.actrc`, `deploy/env.gitea.example` e o `.env.gitea` do host contra as
  repository variables) e exige a suíte `forge-doctor.test.ts` **VERMELHA**,
  com o teste do valor DECLARADO falhando e o de EXISTÊNCIA seguindo verde
  (mutação cirúrgica). Sem essa comparação, dois espelhos que concordam entre
  si mas estão os dois velhos passam por "em sincronia" e o fast path de 0s do
  tier-1 desliga sem sintoma;
- `scripts/test-mutation-doctor-facts.sh` (job `mutation-doctor-facts`) —
  corta os **quatro fios do veredito**, um por vez, com uma mutação cada:
  **(A) violação→bloqueio** — troca o coletor `const blockers = []` DENTRO de
  `summarize` por um objeto com `push` no-op, o que neutraliza TODO
  `blockers.push(...)` de uma vez (é o mesmo fio: as seções só diferem no que
  empurram). O doctor continua rodando e imprimindo tudo — passa a dizer
  **PRONTA com a forja quebrada**, e nenhum fato acusa sozinho porque quem
  acusa é a SOMA. Entre as seções que esse fio transporta estão os **dois elos
  locais** (`pre-commit` e `pre-push`) quando o recorte é o do merge: no `--ci`
  um elo que não saia `proven` — `unavailable`, `skipped` por flag ou fato
  ausente — vai para os bloqueios, e a mutação A tem de acender a âncora que
  mede isso (sem ela, apagar o `.husky/pre-push` ou pôr um `--no-pre-push-proof`
  no YAML do job deixava o PR verde com a promessa do push extinta).
  **(B) a honestidade do veredito** — o ternário do veredito
  deixa de consultar `unknowns.length`: o relatório segue LISTANDO cada fato não
  provado (gate que não executou, env ausente, prova indisponível, registro
  ilegível, protection sem token, dívida aberta no board) e o veredito passa a
  dizer PRONTA sobre o que o doctor **não conseguiu medir** — a falsa segurança
  que nenhum bloqueio errado iguala, porque "bloqueada" alguém investiga e
  "pronta" ninguém olha. **(C) o que o relatório NÃO cobre** — o retorno de
  `summarize` passa a devolver `unproven: []`: o veredito fica **intacto** de
  propósito (PRONTA segue PRONTA, BLOQUEADA segue BLOQUEADA) e só some a
  declaração do limite (a permissão do token, o smoke, o env de outro host, o
  socket do job, o recorte do `--ci` e cada seção pulada por flag). **(D) o CANAL
  de repo** — a lista de variáveis do contexto compartilhado vira vazia em
  `channelEnv`, e o ambiente que cada leitura recebe volta a carregar
  `GITHUB_REPOSITORY`/`GITHUB_API_URL`: a branch protection, o board, os labels
  do runner e a consulta ao registry passam a poder resolver o repositório pela
  **forja emulada** (num runner da Gitea, o repositório da Gitea). É a mutação
  mais silenciosa da família: nada bloqueia, nada fica INDETERMINADO e o
  veredito sai **idêntico** — só a ORIGEM da consulta muda, e ela só divergiria
  no dia em que os dois slugs deixassem de coincidir.

  Para CADA fio a suíte tem de ficar **VERMELHA** com o âncora de CADA FATO
  falhando — os mesmos fatos, vistos dos dois lados: **15** violações
  (contrato de merge, guards, imagem ausente, prova do bloqueio, o gate do
  bring-up no contrato de merge, espelhos, referências não versionadas,
  contrato da imagem publicada, registro do act_runner, registro do runner do
  GitHub, a VERSÃO do runner fora do pin do setup, interpolação do compose,
  branch protection registrada, o
  pré-requisito 0 do bring-up e os dois elos locais no recorte do merge),
  **14** não-provados
  (o caminho honesto de cada uma dessas seções, incluindo a versão do runner
  que a leitura não julgou), **10** limites declarados e **6** consultas do
  canal (a régua sozinha, a origem de cada consulta no fluxo completo, as duas
  proteções, os labels do runner do GitHub e o board) —,
  e as âncoras **CIRÚRGICAS** seguindo verdes: o caminho **SAUDÁVEL**
  (`forja completa e registry 200 → PRONTA`) e o da **VIOLAÇÃO**
  (`check:required-checks` vermelho BLOQUEIA pelo contrato). Sem as intactas, o
  que morreu poderia ter sido o veredito inteiro em vez do fio nomeado. Cada
  âncora tem de casar **exatamente um** teste: uma âncora renomeada (ou
  ambígua) faz o script falhar no CONTROLE, em vez de a detecção virar vácuo. O
  outro `const blockers = []` do arquivo (o do `readMirrors`) é conferido para
  SOBREVIVER — se o patch pegasse os dois, a mutação não seria cirúrgica;

- `scripts/test-mutation-doctor-ci.sh` (job `mutation-doctor-ci`) — o irmão do
  anterior **para o perfil `--ci`**, e o único que sai da suíte e **executa o
  job de PR das duas forjas**. O `check-doctor-ci.mjs` é o gate que roda a cada
  PR na forja (`guards`) e no GitHub (`doctor-mirrors-guard`), e a pergunta
  dele é uma: o **VALOR** das repository variables continua o que o repositório
  declara? Essa comparação tem **três metades**, e cada uma degrada em
  **silêncio** se for mexida sozinha:
  1. **a régua entregue pelo gate** — `doctorFlags` monta
     `--expected`/`--expected-var` com o valor das `vars.*`; sem elas o doctor
     não estoura, ele cai no ramo "não comparado" e o relatório continua
     verde. A mutação esvazia essa entrega (`return { flags, missing }` →
     `flags: []`, preservando `missing`);
  2. **o critério do "não comparado"** — o `unproven` do `mirrorDriftReport`
     (a função COMPARTILHADA: mesmo código do guard semanal, do CLI dele e do
     publicador de issue) diz QUAIS variáveis ficaram sem valor passado.
     Removê-lo não falha nada: o relatório simplesmente para de dizer o que não
     foi comparado, e "não medi" passa a parecer "está certo";
  3. **a troca da função compartilhada** — `mirrorDriftReport(...)` substituído
     por uma versão local que devolve "sem drift": mata o bloqueio do espelho E
     o `unproven` de uma vez, e o doctor diz que comparou sem comparar.

  Para CADA metade a prova tem duas testemunhas. A **suíte** — do gate para a
  metade 1, do doctor para as metades 2 e 3 — fica **VERMELHA** com as âncoras
  da metade falhando e as cirúrgicas (nome da variável ausente, caminho
  saudável, tradução do veredito, bloqueio direto do espelho ausente) seguindo
  verdes; cada âncora tem de casar exatamente um teste, e o total de testes do
  controle é conferido (arquivo que não roda inteiro é infra, não detecção). E o
  **job**: a linha `run:` que cada forja de fato executa — **extraída do YAML**,
  não escrita à mão — roda nos três modos e o que se mede é o FATO, não o texto:
  valor DECLARADO → 0; `vars.BUN_VERSION` ERRADO → ≠ 0 nomeando a variável, com
  as duas réguas no relatório; env PARCIAL → 0 com o `::warning::` e o **naming**
  do que não foi comparado. Com a metade 1 removida o job de cada forja
  **continua vermelho** (a régua some do relatório e a segunda régua bloqueia);
  com a metade 2 o veredito fica **intacto** e o naming some (o silêncio é
  medido, e a suíte é a única testemunha); com a metade 3 a régua **chega**
  (`▸ comparados com vars.…`) e o bloqueio **não sai** — de novo a segunda régua
  impede o buraco. Nenhuma das metades passa em silêncio, e nenhuma abre buraco
  no merge;

- `scripts/test-mutation-gate-contracts.sh` (job `mutation-gate-contracts`) —
  as **três regras** do contrato de gates CORE, que é o que o doctor responde na
  seção 1/7 ("o que o manifesto EXIGE é CORE e roda o comando certo?"):
  **(A) a FORJA DECLARANTE** — um contrato só é conferido contra as forjas que
  **declaram** aquele job (`declared.filter(df => df.jobIds.includes(jobId))`).
  Sem o recorte, um job que só o GitHub exige (o `lint-guard`) passa a ser
  cobrado da Gitea ("a forja gitea NÃO exige o job 'lint-guard'") e o fato
  acusa um defeito que não existe — **falso positivo num gate de merge** é o
  pior desfecho para um diagnóstico, porque ensina o operador a ignorá-lo;
  **(B) a RÉGUA** — `expectedCommand: inv.command`, o **COMANDO CANÔNICO** (com
  os argumentos), o **mesmo** para toda forja que declara aquele job. É o
  `command` da invariante, não o `matches`: este é a **identidade** do gate
  (deliberadamente frouxo, responde "o gate está classificado?"), e trocá-lo
  pela régua do job deixaria passar a invocação com **outros argumentos** — a
  mesma assimetria, por outro caminho. Enfraquecer a régua (aceitar qualquer
  `run:`) reabre a assimetria que o repositório já pagou uma vez: o mesmo commit
  aprovado no merge da Gitea e rejeitado no GitHub, liberado pelo lado **laxo**;
  **(C) o CONTRATO por INVARIANTE×JOB** — a chave é `${inv.id}|${jid}`, não o
  job: **seis** invariantes (ts-nocheck, required-checks, registry-source,
  runner-base, forge-parity, forge-workflow-scope) compartilham o job `guards`
  da Gitea, e deduplicando pelo job cinco delas saem da lista de contratos e
  passam a aparecer como **cobertas sem nunca terem sido medidas**.

  Para CADA regra a suíte `forge-doctor.test.ts` tem de ficar **VERMELHA** pelo
  âncora da **própria regra** e as âncoras **INTACTAS** seguindo verdes (a outra
  regra do mesmo fato e o veredito — `summarize`), o que prova que a mutação é
  cirúrgica e não matou o arquivo: a forja declarante derruba 3 de 204 testes
  com 3 intactas, a régua derruba 5 com 2 intactas, e a chave invariante×job
  derruba **exatamente 1** com 6 intactas — a mutação mais cirúrgica das três, e
  a que mede a regressão mais barata de cometer (o relatório segue dizendo que
  mediu). Cada âncora casa **exatamente um** teste (renomear um teste falha no
  CONTROLE, em vez de a detecção virar vácuo) e o total de testes do controle é
  conferido;

- `scripts/test-mutation-env-mirror.sh` (job `mutation-env-mirror`) — as
  **quatro defesas** do `check-env-mirror.mjs`, uma mutação cada: **(A) o portão
  da conta** (`applyFix` recusa escrever quando sobra violação que o plano não
  explicou — sem ele, a dúvida é apagada por uma escrita); **(B) a defesa do
  segredo** (`applyFix` recusa qualquer plano que inclua um nome de
  `SECRET_ENV_VARIABLES` — o único valor que o host receberia é o placeholder
  comitado); **(C) `maskSecrets`** (o valor real de um segredo que caia no
  CONTEXTO do diff sai mascarado — sem a máscara ele viaja no patch, para o
  terminal, o PR ou o chat); e **(D) o segredo ausente no host**, que vira
  decisão humana e nunca `add` com o valor do template (num segredo, o
  placeholder). Nenhuma delas muda o exit code do caso comum — quem as mede são
  a suíte e o `--fix` —, então a prova exige a suíte **VERMELHA** pela âncora da
  prova mutada (duas no caso C: a unidade e a ponta da CLI) e as **INTACTAS**
  PASSING, que são as outras três defesas e o caminho saudável (`plano que fecha
a conta → escreve`): sem elas, o que teria morrido poderia ser o comando
  inteiro, não a defesa nomeada. São **13 âncoras** conferidas no controle (4
  provas + 9 intactas — a mesma intacta se repete em casos diferentes, porque
  cada caso confere por si). O ramo do segredo-ausente é mutado com escopo de
  laço e o script CONFERE que a mesma linha do passo 4 SOBREVIVEU — se o patch
  pegasse as duas, a mutação mediria outra coisa.

#### O que EXIGE deps fora dos jobs com `bun install` (medido em checkout limpo)

Em um worktree limpo (checkout de `HEAD` **sem** `node_modules`, 09/2026) a
matriz do master **não é node-pura de ponta a ponta: 12 dos 24 sub-tests
falham** (medido: `rc=1` do master, com a metade restante verde). Metade
deles exige ferramenta instalada — `lint-guard` (prettier/eslint),
`reconciliation`, `nested-guard` e `merge-latency` (vitest),
`workflow-run-syntax` (o guard importa `js-yaml`; a metade da suíte usa vitest)
— e a outra metade roda um guard que lê YAML e morre com `exit 2 — YAML NAO
VALIDADO (rode bun install)`: `workflow-refs`, `mutation-jobs`,
`pipefail-sigpipe`, `workflow-defaults`, `hook-ci-parity` (importa
`check-forge-parity`), `bun-literal` (`check-bun-mirror`) e `no-setup-bun`.
Nenhum deles degrada em silêncio: **saem ≠ 0 nomeando o ambiente** (e cada um
exige a mensagem certa do guard, então um guard que morre por ambiente não é
confundido com "mutação detectada"), nunca verdes.

Consequência declarada: onde o job **não** instala deps, o comando morre no
ambiente antes de medir a mutação. No `pr-check.yml` são sete jobs nessa
condição (nenhum passo instala e nenhum engole a falha — sem
`continue-on-error`, sem `|| true`): `workflow-refs-guard`,
`workflow-run-syntax`, `no-setup-bun-guard`, `bun-mirror-guard`,
`mutation-jobs-staged-guard`, `mutation-jobs-guard` e `mutation-guards`. Verde
honesto eles não dão nunca; medem de verdade nos jobs com `bun install`
(`seed-guards.yml` e o job `guards` da forja).

#### Overhead por PR do job `mutation-coord-update` (medido 08/2026)

O job roda em `ubuntu-latest` (hosted runner — **NÃO** usa a imagem custom
`ubuntu-bun`; essa imagem é só para o tier-1 local/act). O custo real por PR é
dominado pelo **payload do mutation test**: 5 cenários (controle + A + B + C + D

- E) = 6 runs de vitest + 6 runs do guard estático (`check-e2e-counts.mjs`,
  ~0.3-0.4s cada). Medido no act com a imagem `ubuntu-bun:1.3.14` (08/2026):

| Componente do job                      | Local (Windows, node frio) | act (ubuntu-bun, container) | CI real (GH hosted) |
| :------------------------------------- | :------------------------: | :-------------------------: | :-----------------: |
| checkout@v4                            |             —              |            49ms             |    ~1-2s (real)     |
| setup-bun (composite, tier-1)          |             —              |     13.5s (fast path)¹      |  ~1-2s (esperado)¹  |
| Cache node_modules (restore+save)      |             —              |           17.4s*            |    ~1-2s (real)     |
| bun install (warm, cache hit)          |             7s             |           12.8s*            |  ~2-5s (esperado)   |
| **Mutation test payload (5 cenários)** |          **51s**           |        **4m37.6s***         | ~35-45s (estimado)² |
| Publish summary                        |             —              |            0.6s             |         <1s         |

¹ Na imagem ubuntu-bun o setup-bun atinge o **tier-1 fast path** (log: `Bun já
instalado no runner (1.3.14) — fast path`) — os 13.5s do act são o overhead de
EMULAÇÃO do composite (docker exec), não download/cache; no CI real o tier-1 não
existe (runner hosted), então o setup-bun real é o tier-2 com cache REAL do
GitHub (~1-2s esperado — ver a tabela de medição do setup-bun no README).

*Overhead de EMULAÇÃO do act: docker cp do worktree no checkout + bind mount
lento (`/mnt/c` no Docker Desktop) + actions/cache emulado. É por isso que o
payload do mutation test dispara de ~21s (local) para 4m37s no act: cada um dos 6
runs de vitest paga I/O de bind mount (SSD do host → ext4 do container, ~46s por
run emulado vs ~3.4-5.0s local). O act ainda travou no "Post Cache node_modules"
(tar do cache emulado) após o step do mutation test — overhead pós-step que não
existe no CI real. O GitHub Actions real usa filesystem nativo do runner, então o
payload esperado no CI é da ordem do local (~21s, escalando com os 5 cenários).

² Estimado por extrapolação do local medido (51s com 6 vitest runs + 6 guard runs
≈ ~8s/run de vitest a frio no runner hosted) — a medir com `gh` autenticado (ver
abaixo). O step do mutation test roda no CI com bun install WARM (cache real do
GitHub), então a I/O não é o gargalo; a expectativa é o payload ficar no mesmo
patamar do local (dezenas de segundos, não minutos).

⚠️ Timing REAL do GitHub Actions não medido aqui — o `gh` está autenticado (auth
fantasma RESOLVIDO em 08/2026, ver Bugs conhecidos no README), mas o
`seed-guards.yml` não existe na branch default (`release/v0.4.0` — nunca
mergeado), então o job nunca rodou no CI real (zero runs); o act é o proxy
local, no padrão do README. O
número confiável é o **payload do mutation test no container: 4m37.6s** (o step
`Run mutation test` completou `✅ Success` com os 5 cenários; o job só foi morto
depois, no Post Cache emulado). No CI real, com cache warm e FS nativo, o payload
esperado é ~21-25s (ver nota ²).

Quando o `gh` estiver autenticado, medir o CI real é um one-liner:
`gh run list --workflow=seed-guards.yml --limit 1` → pegar o run id →
`gh run view <id> --json jobs --jq '.jobs[] | select(.name | contains("contrato")) | .steps[] | select(.name | contains("Run mutation test")) | {name, startedAt, completedAt}'`
— o passo `Run mutation test (contrato coordenado — 5 cenários, 2 elos)` dá o
tempo real do payload; os steps `actions/checkout@v4` e `setup-bun` dão o overhead
fixo do job (troque o filtro do `.steps[]` pelo nome do step desejado). Atualize a
tabela acima quando medir.

---

## 4. README/docs guards — `check-readme-anchors`, `check-readme-toc`, `check-readme-images`, `check-readme-reverse-baseline`, `check-readme-repro-marker`, `check-script-headers`

**O que protege:** links internos (#slug) resolvem, TOCs apontam para headings
reais, imagens existem, e o reverse (semântico) detecta label apontando para o
heading errado. `check-script-headers` estende a mesma ideia aos scripts: o
arquivo tem de dizer de si MESMO como se usa e o que devolve.

**Por que existe:** o README é a porta de entrada do repo; heading renomeado
sem atualizar o link = link morto silencioso. O guard roda o algoritmo do
GitHub slugger exato (sem depender de lib externa).

**Onde roda:** pre-commit (staged), pre-push, CI; `--reverse`/`--reverse-strict`
em job semanal com baseline (alerta, não gate de PR).

**O achado novo vira TICKET, e o ticket FECHA quando o achado caduca.** O job
semanal `readme-reverse-audit` roda `scripts/readme-reverse-issue.mjs` no step
`if: always()`: cada achado novo vira **UMA issue** (label `readme-drift`) com o
link, o heading atual e a sugestão, deduplicada por assinatura `file:slug:label`
— a MESMA `signatureOf` do baseline guard (importada: a issue e o baseline não
podem discordar). Publicar sem fechar deixava a issue aberta depois de o link ser
corrigido (ou de o achado ser registrado no baseline como deliberado) — dívida
mentindo no board e reinvestigada. Por isso, a cada run, o script
**reconcilia**: um achado que **deixou de ser reportado** já não é dívida, e a
issue é fechada com a prova no comentário. O marcador aqui é texto simples
(`<!-- readme-drift:file:slug:label -->`), NÃO o base64 dos outros publicadores:
as issues abertas já usam esse formato, e trocá-lo as tornaria invisíveis para o
dedup (duplicatas) e para o fechamento — o que é compartilhado é o **ciclo**
(listar, separar o que é nosso, comentar a prova, fechar), não o selo.

### 4.1. Cabeçalho de script — `check-script-headers` (`scripts/check-script-headers.mjs`)

**O que protege:** todo script sob `scripts/` (extensões `.mjs`, `.ts`, `.sh`,
`.py`, `.ps1`) documenta, no **BLOCO DE DOCUMENTAÇÃO LÍDER**, uma seção `Usage:`
e uma seção `Exit code`. A região são as linhas de comentário do topo — até a
PRIMEIRA linha de código; shebang não conta como código.

**Por que o contrato é ESTRUTURAL, não posicional:** a regra anterior olhava as
"primeiras 50 linhas". Isso media a POSIÇÃO do bloco, não o que o arquivo diz —
e num repo onde o topo carrega o "por que existe" inteiro (decisões, defeitos
cometidos, números medidos) um preamble honesto de 80 linhas reprovava, deixando
como remédio óbvio mover a documentação para agradar o gate. A regra nova é mais
rigorosa nas duas pontas: um cabeçalho de 200 linhas passa, e um `Usage:` citado
no CORPO do arquivo — dentro de uma função — não conta, mesmo na linha 3.

**Por que ele foi extraído do `barrel-lint` (o defeito que ele fecha):** o
contrato morava dentro do agregador do hook, e o CI tratava o exit 3 dele como
AVISO (`quality-gate.yml`: "non-blocking (fix in progress)"); no pre-commit o
peso era nulo por outro motivo (o `wait` de vários PIDs devolve o status do
ÚLTIMO). Era um contrato que nenhuma forja aplicava — o mesmo desenho de "gate
que parece gate" que este catálogo persegue. Além disso, embutido no
`barrel-lint`, ele era INVISÍVEL ao `check:forge-parity`: o nome não casa o
prefixo `check-`, então o gate não era descoberto e não precisava de
classificação. Extraído, ele virou gate do **CORE** — exigido nas duas
pipelines, com o `quality-gate.yml` fail-closed (o exit code do `barrel-lint` é
o veredito, e só o 0 é verde).

**Uma fonte só:** o `barrel-lint` IMPORTA a regra daqui (não tem cópia própria),
e a lista de exceções continua sendo o `.barrel-lint-ignore` (nome legado; a
mesma lista lida pelos dois). O relatório sempre declara quantos arquivos ficaram
fora do contrato: a diferença entre "documentado" e "não olhado" não pode ficar
só no `--json`.

**Onde roda:** job `guards` da forja dona do merge e `workflow-refs-guard` do
`pr-check.yml` (as duas pipelines, `node` direto — guard node-puro, sem
`node_modules`) e o `barrel-lint` do `quality-gate.yml`; localmente pelo hook,
via `barrel-lint`.

---

## 5. E2E counts / seed — `check-e2e-counts`, `check-seed-count-literals`, `check-seed-hooks`, `validate-seed-guards-matrix-local`

**O que protege:** os counts derivados dos E2Es de seed (prod/dev) batem com o
documentado; os guards comparam por DERIVAÇÃO (nunca literal hardcoded):
`check-e2e-counts` cobre os comentários/echos dos workflows e do script local;
`check-seed-count-literals` varre TODO o repo (scripts/, docs/, .github/) por
literais de count em contexto ("N checks" / ternary da matrix) fora do
conjunto válido {prod, dev}.

**Por que existe:** count drifted (doc dizia 128, âncora de teste esperava 123)
sem ninguém perceber — a derivação é a fonte da verdade e os guards falham se
o número documentado divergir. O check-e2e-counts cobre os workflows; o
check-seed-count-literals fecha o buraco de docs/ e scripts/ não-varridos
(um literal órfão após bump — ex.: 123 — falha o PR na hora).

**Onde roda:** pre-push, CI.

---

## 6. Workflow refs — `check-workflow-refs`, `validate-workflows.py`

**O que protege:** toda `run:`/`uses:` de workflow aponta para script/arquivo
que EXISTE (par transitivo fechado: entry do package.json → scripts/X).

**Por que existe:** script deletado/renomeado sem atualizar o workflow = job
quebrado no runtime, descoberto só no push. O guard pega no PR, antes do merge.

**Onde roda:** pre-push, CI.

**Comentário não é referência:** o guard ignora a LINHA de comentário e o
comentário de **FIM DE LINHA** (`- run: # node scripts/x.mjs`) — os dois não
executam nada, e uma ref vinda daí VALIDA um script que a pipeline nunca roda. A
leitura é a mesma do `check-forge-parity` (`executableLines`), que já ignorava o
comentário de fim de linha; a divergência entre os dois era o furo (um passo
comentado virava ref validada e, se o arquivo não existisse, uma violação falsa).

**Como testar:** `src/lib/__tests__/check-workflow-refs.test.ts` (os quatro
extratores, incluindo o comentário de linha e o de fim de linha) e
`src/lib/__tests__/check-workflow-refs-cli.test.ts` (a CLI e o `--pkg-internal`).

**O YAML do arquivo, hoje, é julgado pela porta do ESCOPO** —
`workflowYamlValidity` no `readWorkflowScan` (§21, "A OUTRA PORTA"): um workflow
que não faz parsing sai NOMEADO e o guard sai 2, em vez de ler linha a linha um
arquivo que o runner nunca executa. Medido: o `scripts/validate-workflows.py`
(YAML syntax + uses + órfão + âncora) **não é invocado por pipeline nenhuma** —
`grep` em `.github/`, `.gitea/` e `package.json` não acha call site —, e ele cobre
só `.github/workflows`; a porta do escopo cobre as DUAS forjas e é o que os
guards de workflow de fato consultam antes de cunhar veredito.

**Prova por mutação:** `scripts/test-mutation-workflow-refs.sh` (sub-test
`workflow-refs` da matriz do master). Os Cenários 1 e 2 mutam a **fixture** e
cobram o vermelho do guard (par transitivo workflow → entry → script; entry órfã
do `--pkg-internal`). O Cenário 3 muta o **próprio guard** (com backup e
restauração **conferida por checksum** — a mutação é aplicada no lugar, porque o
objeto da prova é o arquivo real) e prende os **dois sentidos** da regra de
comentário de fim de linha, um por fixture:

| Mutação                                                      | Fixture                                            | Guard real                                                      | Guard mutado                                                                                   |
| :----------------------------------------------------------- | :------------------------------------------------- | :-------------------------------------------------------------- | :--------------------------------------------------------------------------------------------- |
| **M1** — a regra REMOVIDA (`replace(/(^\|\s)#.*$/, …)`)      | `run: echo ok # node scripts/ghost-comentario.mjs` | **PASSA** (o comentário não gera ref)                           | **ACUSA** a ref do comentário (`pr-check.yml:6`) — o veredito deixa de ser sobre o que EXECUTA |
| **M2** — a regra perde a ÂNCORA de espaço (`(^\|\s)#` → `#`) | `run: echo "a#b" ; node scripts/ghost-real.mjs`    | **REPROVA** (o `#` entre aspas não é comentário: a ref executa) | **PASSA** com a referência quebrada — **CEGO**                                                 |

As duas direções têm nome, e são diferentes de propósito: o M1 é um **FALSO
POSITIVO** (o guard não fica verde, ele inventa violação para código morto) e o
M2 é a **CEGUEIRA** da casa (verde onde deveria reprovar). Um controle do guard
real ANTES e OUTRO depois de restaurar fecha cada cenário — sem eles, um guard
que já falhasse por outro motivo faria o PASS do mutado parecer a cegueira que
ele mede. E é o M2 que dá preço à âncora: sem o `(^|\s)`, a regra corta no `#` de
DENTRO de aspas e o guard perde a ref que executa.

---

**`check:registry-source` (mesma família — fonte única do registry OCI):**

**O que protege:** o host do registry das imagens da aplicação (app, worker,
realtime) e dos mirrors de toolchain (bun, ubuntu-bun, postgis) tem UMA fonte de
verdade (`IMAGE_REGISTRY`): repository variable nos workflows, variável de
`.env.production` no compose da VPS, `--var` no `.actrc` e secret
`image_registry` no Woodpecker.

**Por que existe:** as imagens eram referenciadas com o host hardcoded
(`ghcr.io/...`, ~85 ocorrências), acoplando o projeto a um registry proprietário
com cota de armazenamento/egress no plano free e transformando a troca de
registry numa caçada de referências. A forma correta é o default dentro da
própria variável (`${{ vars.IMAGE_REGISTRY || 'ghcr.io' }}` /
`${IMAGE_REGISTRY:-ghcr.io}`) — um `ghcr.io` solto é regressão.

**Por que o escopo é declarado:** o guard varre os **sites de resolução**
(compose, workflows do GitHub e do Gitea, composite actions, `.woodpecker.yml`),
todos YAML — onde comentário é inequívoco. Com o runner rodando imagem custom, o
escopo inclui **`deploy/`**: o compose da forja entrou no mesmo gate, e **tag
literal** na imagem nossa ali é violação — a tag tem de vir da variável
(`ubuntu-bun:${BUN_VERSION}`, não `ubuntu-bun:1.3.14`), senão o runner roda uma
imagem que não corresponde à versão declarada e o fast path do setup desliga em
silêncio.

**O escopo de SCRIPT entrou com a invariante 9 — e não pela string solta.**
`scripts/**.mjs` era mantido FORA de propósito: nele a mesma `ghcr.io` aparece em
prosa de mensagem de erro e em comentário, e um guard com falso positivo acaba
desligado. O que entrou foi o **default embutido**
(`process.env.IMAGE_REGISTRY || "ghcr.io"`), que é violação mesmo com o valor
certo — o repositório tem resolvedor (`registry-source.mjs`) e o literal volta a
envelhecer no dia da próxima migração. As duas armadilhas que sustentavam a
exclusão estão resolvidas **e medidas**: a régua do comentário segue a LINGUAGEM
do arquivo (`//`, `/*` e o `*` de doc num `.mjs`; só `#` em YAML/shell/compose — o
header que ENSINA o resolvedor era acusado como se fosse um default), e cada
forma de default vale na SUA família (`${NOME:-x}` em compose/shell,
`X || "valor"` em JS, `vars.NOME || 'valor'` em YAML). Cada mecanismo tem mutação
própria (`scripts/test-mutation-registry-defaults.sh`, sub-test 26 do master):
remover a régua do comentário ACUSA o são, desligar a regra do script JS CEGA o
gate, e as duas direções são exigidas em cada rodada.

**A régua de valor não julga a sintaxe do CI, e o TIPO é da tabela.** As duas
metades dessa frase são medidas, porque cada uma falha em silêncio:

- **grafia** — `vars.NOME || 'x'` e `vars.NOME || "x"` são a MESMA declaração:
  o que se compara é o valor, não como o arquivo o escreveu. Antes da correção, a
  forma entre **aspas duplas** (que o corpus ainda não tinha) caía no grupo do
  token cru e saía `fallback: null` — contada como **dinâmica**, isto é, fora da
  comparação. O default divergente passava em silêncio, e o relatório ainda dava
  uma razão errada para o verde. A **M7** cega exatamente isso (aceitar só as
  aspas simples faz a forma inédita voltar a ser "dinâmica") e é cirúrgica: o
  gêmeo na grafia já vista segue reprovado;
- **tipo** — a régua é genérica: ela compara um NOME contra o que a **tabela**
  declara (`IMAGE_VARIABLES`/`IMAGE_MIRRORS` no resolvedor,
  `NON_VERSIONED_IMAGE_VARIABLES` no guard). O **Controle C** declara um tipo que
  o repositório não tem (uma tag) numa forma que o corpus não tem (aspas duplas,
  num CI fictício), aplica o remendo **só na tabela** e exige que o julgamento
  aconteça — medindo de quebra que a **soma do corpo de `defaultValueVerdict`
  ficou byte a byte igual**. Sem essa soma, "o tipo novo é julgado" não
  distinguiria "a régua é genérica" de "alguém ensinou a régua a conhecer a
  tag". O outro lado é o **C4**: sem o tipo na tabela o fixture NÃO é julgado —
  o tipo não é adivinhado por um arquivo que o acaso menciona (a leitura fica
  `indeterminate`, nomeando o remédio, nunca verde por omissão).

**A metade DINÂMICA (invariante 7): `docker compose config` no compose da
forja.** A varredura acima prova que a linha do label **referencia**
`${BUN_VERSION}`. Ela não prova o que a interpolação **resolve** — e os dois
modos de falha que sobram são invisíveis no texto:

| Defeito no compose                                     | O que o texto parece         | O que o docker resolve                                                     |
| :----------------------------------------------------- | :--------------------------- | :------------------------------------------------------------------------- |
| `${BUN_VERSIO}` (typo / variável órfã)                 | correto ("tem uma variável") | `ubuntu-bun:` — **tag vazia**; o runner registra imagem que não existe     |
| `${BUN_VERSION:-1.4.0}` [divergente] (default literal) | correto ("tem BUN_VERSION")  | `ubuntu-bun:1.4.0` [divergente] — a variável **deixou** de ser fonte única |

Por isso o gate renderiza o compose com o **próprio docker** (quem interpola em
produção) em três fases, com ambiente **controlado** (um `BUN_VERSION` exportado
no shell de quem roda o guard não pode mudar o resultado):

1. **declarado** — com o env da forja (`deploy/.env.gitea` se existir, senão o
   template): **nenhuma** variável pode resolver vazia (é o próprio docker que
   avisa `variable is not set. Defaulting to a blank string` — detecção genérica,
   vale até para variável que o guard não conhece) e a tag tem de ser a versão
   declarada;
2. **sentinela** — registry/namespace/versão/token trocados por valores que não
   existem no repo: o label tem de carregá-los. Se o render mostrar qualquer outra
   coisa, o que não veio da variável está **literal** no compose;
3. **sem versão** — com `BUN_VERSION` ausente a tag tem de sair **vazia**
   (a variável é obrigatória de fato). Uma versão aqui é um default literal.

**Sem docker o passo é INDETERMINADO, não falha:** numa máquina sem a
ferramenta a interpolação não pode ser provada — o guard emite `::warning::` e
sai 0, e o relatório do doctor diz **"interpolação não provada"**. Ausência de
prova não é prova de falha (a mesma regra do registry inacessível), e um gate
vermelho só porque a máquina não tem a ferramenta ensinaria a equipe a
ignorá-lo. Para pular o passo deliberadamente: `--no-compose-render`.

**E onde "não provei" passa a ser FALHA — `--require-compose`:** o job `guards`
da forja roda nesta mesma imagem, e lá o render **não é opcional**. A imagem do
job embarca o plugin `compose` — medido em 09/2026:
a base `catthehacker/ubuntu:act-latest` entrega
`/usr/libexec/docker/cli-plugins/docker-compose` (`docker compose version`
responde 5.4.0-2) — e o **build** do `Dockerfile.ubuntu-bun` agora FALHA se isso
mudar, com o motivo escrito (antes era um acidente de uma tag flutuante: o
próprio projeto da base fechou como "not planned" o pedido de incluí-lo,
catthehacker/docker_images#70). E o `FROM` **da base** está pinado por digest,
para o build não verificar uma imagem diferente a cada rebuild da tag — quem
prende isso é o `check:runner-base` (seção 2). Com a flag, só `proven` passa: sem ela, a
invariante 7 degradaria para um `::warning::` **dentro de um job verde** — um
gate que deixou de verificar sem ninguém notar. Quem a usa é a Prova 4 do smoke
da forja, e as duas flags juntas (`--require-compose --no-compose-render`)
falham em vez de escolher uma precedência em silêncio. Que a exigência **não seja
decorativa** é o que o `smoke-render:prove` prova, injetando um container **sem o
plugin** e cobrando o vermelho (seção 15).

**A outra metade — o env do HOST × o template comitado (invariante 7b).** As três
fases acima usam o env da forja, que **é** o arquivo do HOST onde ele existe
(`deploy/.env.gitea`, no VPS). Elas provam que esse arquivo é
auto-consistente; **não** provam que ele é o mesmo que o repositório declara — e
onde o arquivo do host existe, o template comitado deixava de ser renderizado por
ninguém: o gate dizia "interpolação provada" enquanto o runner registrava outra
imagem (namespace trocado, versão velha, variável que o template já não declara).
O formato de falha favorito deste repo: verde, com o sintoma longe da causa (o
tier-1 desligado; o setup funciona igual, só mais lento).

| Metade                                                                                             | Precisa de docker? | O que prende                                               |
| :------------------------------------------------------------------------------------------------- | :----------------- | :--------------------------------------------------------- |
| **declarações** — mesmo conjunto de nomes e mesmos **valores** nas variáveis que o compose consome | não                | a divergência entre o que o VPS usa e o que o repo declara |
| **render** — o label que o runner registra, com os dois envs lado a lado                           | sim                | o EFEITO: o que cada env interpola de fato                 |

A lista de variáveis **consumidas** é **derivada do próprio compose**
(`composeEnvVariables`: `${NOME}` em linha de código, comentário ignorado,
default embutido descartado) — não de uma lista escrita à mão, que envelheceria
deixando a próxima variável fora em silêncio. Do outro lado, o default do
comparador é **conferir o VALOR**: isentar exige nomear a variável em
`SECRET_ENV_VARIABLES`.

**A assimetria dos segredos é o desenho, não um caso especial:** numa variável
comum, DIVERGIR é o defeito; num **segredo**, IGUALAR é o defeito — o template é
comitado e o host tem de ter o valor real. Comparar o valor exigiria versionar o
segredo (o oposto do que se quer), e um host que ficou com o placeholder do
template sobe um runner que **não se registra**. Por isso o segredo é conferido
por presença (não vazio) e por **diferença** do template.

**Onde cada metade roda:** a comparação de arquivos acontece **antes** do docker
de propósito — uma divergência tem de falhar até onde o plugin `compose` falta,
senão o "não provei" do render esconderia o drift justamente na máquina onde ele
importa. A metade do **repositório** (o template declara tudo o que o compose
consome) vale em qualquer checkout, e é ela que o job `guards` da forja prova; no
VPS a metade do host entra sozinha (o arquivo existe lá). `--gitea-env <caminho>`
aponta outro arquivo (ex.: `/opt/gitea/.env`), e um caminho **inexistente** falha
o uso com exit 2: a pergunta foi explícita, e ler "em sincronia" de uma
comparação que não houve seria pior que falhar. Sem o arquivo do host o estado é
`hostCompare: absent` — nunca "em sincronia" por omissão —, e o **doctor** o
reporta como não provado.

**Prova por mutação** (arquivo real, restaurado byte-idêntico por sha256):
`${BUN_VERSION:-1.4.0}` [divergente] → exit 1 com "DEFAULT LITERAL"; `${BUN_VERSIO}` → exit 1
nomeando a variável; registry literal no label → exit 1 pelas duas metades
(estática e dinâmica); token literal no compose → exit 1 (segredo versionado).
Para a 7b, com o host sintético: `BUN_VERSION` diferente → exit 1 nomeando o
valor dos dois lados; variável faltando no host (o compose cairia no default) →
exit 1; variável sobrando no host → exit 1; `RUNNER_TOKEN` vazio no host → exit 1;
`RUNNER_TOKEN` **igual** ao placeholder do template → exit 1; template sem uma
das variáveis que o compose consome → exit 1 (e é a metade que roda no CI); host
em sincronia → exit 0 com `host x template em sincronia`.

**`check:forge-parity` (mesma família — consistência entre pipelines):**

**O que protege:** o desenho é a forja self-hosted (Gitea/Forgejo) como **dona do
merge** e o GitHub como espelho. O guard **descobre** os gates das duas pipelines
e exige que cada um esteja classificado. Três desfechos:

| Desfecho      | Consequência                                            |
| :------------ | :------------------------------------------------------ |
| `CORE`        | precisa rodar nas **duas** pipelines                    |
| `GITHUB_ONLY` | isento, **com razão escrita** (não pode rodar na forja) |
| nada          | **VIOLAÇÃO** — o PR falha até alguém classificar        |

**Por que existe:** um gate que roda em uma pipeline e não na outra é o pior tipo
de falha — **silenciosa**: o PR fica verde por onde rodou e ninguém vê a
invariante que ficou de fora.

**O erro que este guard cometeu primeiro — e que vale ler antes de mexer:** a
primeira versão comparava as pipelines contra uma lista `CORE` escrita **à mão**.
A lista tinha 10 itens; o `pr-check.yml` executava ~30 gates. Os ~20 restantes
eram **invisíveis** ao guard, e ele passava verde — dando a impressão de que a
forja bloqueava o merge quando faltavam lá, entre outros:

- `check-bun-audit-baseline` (dependência vulnerável);
- `rotate-secrets --check` (segredo versionado);
- `check-seed-hooks` (`SEED_SPEC_PATCH` chegando a um caminho de **deploy**).

A causa foi tratar "está no arquivo do GitHub" como "é do GitHub". A
_implementação_ de `dependency-review` é da plataforma; a _capacidade_ (não
aceitar dependência vulnerável) não é. Um guard que dá falsa segurança é pior
que guard nenhum: converte "não verificado" em "parece verificado".

**O que conta como gate** (regra declarada, não lista à mão): `scripts/<nome>`
com prefixo `check-`/`validate-`/`audit-`/`test-mutation-`/`run-`; qualquer
comando com `--check`/`--ci`; `bun run <entry>` com prefixo correspondente ou as
entradas estruturais (`lint`, `test:*`); `tsc --noEmit`; e
`uses: ./<forge>/workflows/<arquivo>.yml`. Plumbing (`install`, `db:generate`,
`build`, `docker`) **não** é gate — não declara verificação.

**Prosa não conta:** o guard remove comentários antes de casar — mencionar o
gate num comentário não é o gate rodando.

**Cada invariante do CORE tem DUAS réguas, e elas respondem perguntas
diferentes** (é o que o `CORE_INVARIANTS` declara por invariante):

| Campo     | Contra o quê é testado                            | Responde                                            |
| :-------- | :------------------------------------------------ | :-------------------------------------------------- |
| `matches` | o **rótulo** do gate descoberto (`discoverGates`) | "este gate está **classificado**?" (`classifyGate`) |
| `command` | as linhas de **`run:`** das duas pipelines        | "a invariante roda **com o comando canônico**?"     |

O `matches` é **frouxo de propósito**: ali só se decide se o gate foi
**nomeado** (CORE, GITHUB_ONLY ou nada), e uma regex que exigisse o literal
inteiro acusaria "gate não classificado" para a mesma coisa invocada por outro
caminho. O `command` é **ancorado nas duas pontas** (`^…$`) e é a régua que
decide: ele é medido nas **duas** pipelines **e** contra o `run:` do job exigido
no manifesto (o `forge-doctor`, via `coreGateContracts`). Sem essa separação,
uma régua só teria de servir aos dois papéis — e servia mal aos dois.

**Um comando só, nas duas forjas.** Duas divergências reais foram fechadas por
essa régua:

- **`typecheck`** — a forja rodava `bun run typecheck` e o espelho rodava
  `bunx tsc --noEmit` com o heap de 4GB declarado **inline no step** (`env:
NODE_OPTIONS`). O comando (e o heap) passaram para o script `typecheck` do
  `package.json`, e **três** workflows que repetiam a forma inline
  (`pr-check.yml`, `.github/workflows/ci.yml`, `release-deploy.yml`) passaram a
  invocar o script — uma fonte só, uma régua só;
- **`tests`** — a forja rodava `bun run test:run` (`vitest run`, que
  **inclui** `src/components/**`) e o espelho rodava `bun run test:unit` (config
  unit, que **exclui** os componentes). O comando canônico é o **mais amplo**, o
  da forja dona do merge: o espelho não pode ser o lado **mais fraco** do par.

O diagnóstico da invariante ausente **imprime o comando esperado**, porque "não
roda aqui" faz quem lê procurar um gate que está lá — só invocado por outra
forma. A invocação **indireta** (`bun run check:x`) e a **com argumentos
diferentes** (`node scripts/check-workflow-refs.mjs` sem o `--pkg-internal`) são
divergências: o guard não pode comparar a entrada do `package.json` com a linha
sem interpretá-la, e aceitar as duas formas é reabrir a segunda régua.

**A prova por mutação das TRÊS regras — e o job que a carrega.**
`scripts/test-mutation-forge-parity.sh` roda o guard **real** contra uma cópia
fiel das duas pipelines (`--root`), e o **CONTROLE** (cópia sem mutação → exit 0)
prova que o fixture é fiel: sem ele, um guard que falhasse "de qualquer jeito"
passaria como detecção. **Dez** mutações, cada uma derivando uma regra (as três
primeiras da classificação, D/E1/E2 da régua do comando canônico, F do CORE no
dono do merge e G1–G3 do CANAL do remédio — a quinta regra):

| mutação | o que injeta na cópia                                             | o que o guard tem de dizer                                                  |
| :------ | :---------------------------------------------------------------- | :-------------------------------------------------------------------------- |
| **A**   | gate novo **sem classificação** na forja (dona do merge)          | `NAO CLASSIFICADO`, nomeando o gate                                         |
| **B**   | gate novo **sem classificação** no espelho GitHub                 | `NAO CLASSIFICADO`                                                          |
| **C**   | gate `GITHUB_ONLY` **rodando** na forja                           | classificação **stale**                                                     |
| **D**   | invariante do CORE com o **comando canônico removido**            | `invariante do CORE 'X' NAO roda aqui` + a **linha esperada** e a pipeline  |
| **E1**  | o mesmo invariante por invocação **indireta** (`bun run check:…`) | a **mesma** mensagem — e **não** `NAO CLASSIFICADO`                         |
| **E2**  | o comando canônico **sem o argumento** (`--pkg-internal`)         | idem, com a linha canônica **completa** no diagnóstico                      |
| **F**   | a **matriz de mutation tests** removida da forja (dona do merge)  | `invariante do CORE 'mutation-matrix' NAO roda aqui` + a linha e a pipeline |
| **G1**  | o **canal do remédio** removido da forja                          | `o CANAL DO REMEDIO nao roda aqui`, nomeando o passo e a pipeline           |
| **G2**  | a cobertura do canal trocada por `--all` → `--fixer <um>`         | o fixer que ficou **FORA** sai nomeado — **lido do REGISTRO**               |
| **G3**  | o canal com o `--backend` da **outra** forja                      | `backend de OUTRA forja`, com o esperado no diagnóstico                     |

A **quinta regra** (G1–G3) existe porque o canal **não** é um gate: ele não
verifica nada, publica o patch do remédio no PR, e por isso não entra em
`discoverGates`/`CORE_INVARIANTS` — nenhuma das quatro regras o alcançava. A
cobertura dele vinha de uma lista escrita nos DOIS workflows (um passo por fixer),
e um fixer novo só chegava ao PR se alguém lembrasse de copiar o passo nas duas
pontas. Hoje o passo invoca o REGISTRO (`--all`), e a prova lê o nome do fixer que
deve sair nomeado **de `FIXERS`** (um literal no harness envelheceria junto com o
registro e passaria a medir outra coisa) e ainda exige que a mensagem **não**
esteja invertida (quem aponta o fixer deixado na linha é a mutação, não a régua).

As duas últimas medem a **régua**, não a classificação: a forma divergente continua
casando o `matches` do invariante, então o gate sai classificado e quem reprova é o
`command`. O script **exige** que o veredito de E1/E2 não contenha `NAO CLASSIFICADO`
— se contivesse, a prova estaria pegando o defeito pela regra errada (e passaria a
provar a classificação enquanto diz medir a régua).

**Onde roda, e por que em job PRÓPRIO (fora do master) no espelho:** job
`forge-parity-mutation` do `pr-check.yml`, com entrada em `ci/required-checks.json`.
Ela era um sub-test da matriz do master (**23 → 22** naquela medição); saiu porque é
a única prova do repositório cujo sujeito é o **contrato de merge em si** — quais
gates podem pular uma forja e com que forma de comando. Um vermelho dentro da matriz
diz "alguma mutação falhou"; como job próprio ela diz **qual** regra de classificação
quebrou, e vira check **com nome** no contrato de merge. Custo medido: ≈**0.33s**
(node-puro, sem docker, sem `node_modules`).

**NAS DUAS FORJAS (a isenção que caiu).** Ela — e a matriz de 39 sub-tests — eram
`GITHUB_ONLY` com a razão _"os jobs de mutation test existem apenas no pipeline do
GitHub (custo/duração)"_, que é a razão de **conveniência** que a classe
`GITHUB_ONLY` proíbe por escrito. O furo era concreto: quem mergeia na forja podia
ficar **verde com um guard cego**, porque a única coisa do repositório que mede se um
guard _morde_ (a mutação que ele tem de pegar) rodava só no espelho. Hoje as duas
são invariantes do **CORE** (`mutation-matrix`, `forge-parity-mutation`): rodam no
job `guards` da forja (já required, então bloqueiam o merge **sem tocar a proteção
aplicada**) e nos jobs próprios do espelho, com o **mesmo comando**. O que continua
isento tem razão sobre o **sujeito**, não sobre custo: os rótulos dedicados das
suítes que a matriz já prova nas duas forjas, as três que provam guards **sem
contrato de merge** (jsdom drift, unused deps, bun audit — os jobs deles não são
required checks de forja nenhuma) e os dois guards que conferem os jobs de mutation
test e o nome/summary/comentário count-free do job `mutation-guards`, que existem só
lá. A mutação **F** é o que trava essa decisão: remover a matriz da forja volta a
falhar o guard, em vez de a isenção antiga voltar em silêncio.

**Inventário:** `node scripts/check-forge-parity.mjs --gates` lista o que o
guard enxerga, com a classificação de cada gate — para a decisão ser revisável,
não um ato de fé.

**Gates que o guard promoveu do GitHub para a forja** (estavam só no espelho, e
não por serem específicos da plataforma): auditoria de dependências, baseline de
segredos, hooks de seed, sentinel producer, fonte única do Bun, proibição do
`oven-sh/setup-bun`, simetria de hooks e — a maior delas — a **prova por mutação**:
a matriz de 39 sub-tests e a prova das três regras de classificação, que rodavam
só no espelho e deixavam o PR da forja mergear com um guard cego. O custo entrou
no modelo (`ci/merge-latency.json`, job `guards`), e o **runtime** da imagem
foi re-medido antes de a mudança valer: o MESMO comando dentro do container da
`ubuntu-bun` (a imagem que o runner da forja mapeia para `ubuntu-latest`) rodou a
matriz completa (era de 32 sub-tests) com **32/32** verdes em **238.7s** contra os 248s
medidos nativos no runner do espelho — ~4% de diferença, e o número maior é o que
fica. O que faz do valor do dono do merge um **PISO** não é o runtime: são os
passos fora da soma (o `check:pipefail-sigpipe`, o `bun install` e o checkout).

---

**`check:forge-workflow-scope` (mesma família — escopo da varredura):**

**O que protege:** nenhum script pode **cravar** um diretório de workflow de
forja. A lista de forjas vive em `scripts/forge-workflows.mjs` (FONTE ÚNICA) e
é de lá que todo guard tira o escopo.

**Por que existe:** o buraco não foi um bug pontual — foi uma **classe**. 14
guards tinham `.github/workflows` cravado no escopo. Quando a forja
self-hosted (Gitea/Forgejo) passou a ser **dona do merge**, a pipeline que
decide o merge ficou fora da cobertura de todos eles de uma vez. O resultado
observado, sem um único guard reclamar:

| Sintoma na forja                                          | Guard que deveria pegar |
| :-------------------------------------------------------- | :---------------------- |
| `BUN_VERSION: "1.4.0"` [divergente] literal (2 workflows) | `check-bun-mirror`      |
| `oven-sh/setup-bun@v2` em 6 call sites                    | `check-no-setup-bun`    |
| `check:ts-nocheck` ausente da pipeline                    | _nenhum_                |

Corrigir os 14 casos resolve o sintoma; este guard resolve a classe — inclusive
para a próxima forja que nascer.

**O que é permitido:** referenciar um **arquivo** específico de uma forja
(`".github/workflows/pr-check.yml"`), porque há guards legitimamente sobre UM
workflow. O proibido é o **diretório** — e `join(root, ".gitea", "workflows")`
também é, mesmo montado por segmentos.

**Prosa não conta:** comentários são ignorados (documentar a regra não é
violá-la).

**Guards que passaram a varrer todas as forjas:** `check-bun-mirror` (fonte
única do Bun, incl. o pathspec do modo `--staged`), `check-no-setup-bun`,
`check-seed-hooks`, `check-sentinel-producer`, `check-workflow-refs`,
`check-mutation-jobs` e `check-registry-source`.

**A label aponta para uma imagem que pode NÃO EXISTIR:**
`checkGiteaRunnerImage` (mesma família, dentro de `check-bun-mirror`) prova que os
labels apontam para `ubuntu-bun:<BUN_VERSION>`; ele **não** prova que a tag está
publicada. Sem a imagem, o act_runner nem inicia o container — e a falha aparece
no meio do job, longe da causa. Quem fecha isso é o comando
`scripts/ensure-runner-image.mjs`, e o guard `checkGiteaBringUp` prende a ORDEM:
`deploy/gitea-up.sh` tem de **garantir** a imagem antes de `up -d runner`, e o
instalador (`deploy/setup-gitea.sh`) tem de apontar para o bring-up em vez de
ensinar um `docker compose up -d runner` seco.

**E o env do host tem de ESPELHAR o template comitado — antes até da imagem.**
O ensure resolve `IMAGE_REGISTRY`/`IMAGE_NAMESPACE`/`BUN_VERSION` do env do host:
com um env divergente ele garantiria a **imagem errada**, e a stack subiria
apontando para ela. O determinante já existia (a invariante 7b do
`check:registry-source`), mas só rodava no CI — quem subia a stack tinha de
lembrar de rodá-lo. Agora o bring-up executa `scripts/check-env-mirror.mjs` como
pré-requisito **0** e recusa a subida quando diverge. O comando é uma casca fina
sobre as **mesmas** funções do guard (`composeEnvVariables`,
`parseEnvAssignments`, `compareEnvMirrorDeclarations`), então a fonte única da
regra — inclusive a assimetria dos segredos (numa variável comum DIVERGIR é o
defeito; num segredo, IGUALAR é) — continua sendo uma só. E `checkGiteaBringUp`
passou a prender os quatro: a invocação **existe** (linha de comando, não prosa),
passa `--host` **e** `--template`, aponta o default de `TEMPLATE_FILE` para o
template comitado, e vem **antes** da garantia da imagem.

**E a ORDEM virou COMPORTAMENTO, não só texto.** `checkGiteaBringUp` prende a
ordem e os argumentos no **TEXTO** do `gitea-up.sh` — e texto não distingue
"recusa" de "está quebrado": um bring-up que aborta por qualquer outro motivo
também não sobe o runner, e passaria. Quem fecha isso é o job **`bring-up-proof`**,
nas **duas** forjas: ele executa o bring-up REAL contra um env **DIVERGENTE** (com
a imagem PRESENTE, de propósito — se a stack não sobe com a imagem no registry, a
causa só pode ser o passo 0) e falha se o passo 0 não recusar. As asserções são
sobre o REGISTRO das chamadas, não sobre a saída: **zero** `compose up`, **zero**
idas ao registry e **zero** chamadas ao binário `docker` — e é o zero de idas ao
registry que prova a ORDEM (a recusa veio ANTES do ensure, não depois). O job é
required check (está no `ci/required-checks.json`, nas duas forjas) e a invariante
do CORE `bring-up-env-gate-proof` obriga as duas pipelines a mantê-lo: tirá-lo de
uma delas vira drift no `check:forge-parity`, não silêncio. Quem editar o
`gitea-up.sh` e remover o passo 0 derruba este job.

**E o host SEM REGISTRY deixou de ser um beco — virou DECISÃO.** O pré-requisito 1
recusa quando o registry não responde, e está certo: "não consegui perguntar" não é
"a tag existe" (o ensure nunca publica nesse estado). Só que num host que opera
sem alcançar o registry (rede fechada, DNS que não resolve, pacote privado sem
credencial anônima) a recusa não deixava NADA que o operador pudesse rodar daqui.
A flag `--local-image` desse host AFIRMA que a imagem está na cópia local, e o
bring-up cobra a prova: o ensure confere a MESMA referência dos labels do compose
no daemon DESTE host e devolve um estado próprio (exit 6) — a subida segue, com o
que NÃO ficou provado dito em voz alta (que a TAG exista no registry e que um host
sem esta cópia a puxe). Sem a flag, o veredito é EXATAMENTE o de antes:
INDETERMINADO recusa e nada sobe. AUSENTE (4) e falha ao publicar (5) NÃO são
afrouxados pela flag — a cópia local responde por "não consegui perguntar", não
por "o registry respondeu que não tem" —, e `--local-image` com `--no-runner` é
recusado (um afirma a imagem do runner, o outro a deixa de fora).

**E o operador deixou de corrigir o env à mão.** O comando ganhou `--patch` (o
diff que reconcilia o host; o **STDOUT leva só o patch** e o relatório vai para o
STDERR, para `--patch > fix.patch` produzir um arquivo com o diff) e `--fix`
(aplica ao host, **atômico** — tmp + rename no mesmo diretório — e idempotente).
O plano sai da **mesma** regra lida ao contrário, e cada achado tem um destino
explícito: **edição mecânica** (variável comum que diverge passa a valer o valor
do template; variável declarada no template e ausente no host é acrescentada no
**fim**, de onde o `--env-file` a lê — no meio ela ficaria sombreada pela última
ocorrência, que é a que vence) ou **decisão humana**, que o comando recusa por
escrito: o **segredo** (nunca escrito, nunca copiado do template — o valor real só
o operador tem), a variável **a mais** no host (apagar configuração de quem opera
não é reconciliar) e o **template** que não declara o que o compose consome (o
lado a corrigir não é o host). Três invariantes prendem isso, e as três são
testadas por cenário: cada edição fecha **exatamente uma** violação e nenhuma
cria; o que sobra é exatamente o que o plano nomeou como manual; e o que sobra é
**subconjunto** do que havia — o plano pode fazer violação **sumir**, nunca trocar
uma por outra (uma edição que "consertasse" a contagem substituindo `não existe`
por `igual ao placeholder` passaria na conta e estaria errada). O `--fix` só
escreve quando essa conta fecha: uma divergência que ele não explique **não vira
escrita silenciosa**, e a defesa em profundidade recusa qualquer plano que inclua
um nome de `SECRET_ENV_VARIABLES`. O patch é **byte-exato** (aplicável com
`git apply -p0`) enquanto nenhum segredo cair no **contexto** do diff; quando cai
— o segredo a menos de três linhas de uma correção —, o valor sai **mascarado** e
o patch passa a ser artefato de **revisão**, porque mascarar o contexto é o que
preserva o segredo e custa a aplicabilidade literal.Nos dois casos quem aplica é o
`--fix`. **A prova por mutação deixou de ser manual:** o job
`mutation-env-mirror` (`scripts/test-mutation-env-mirror.sh`, no reusable
`seed-guards.yml` chamado pelo pr-check) muta cada defesa — o portão da conta
vira no-op, a defesa do segredo vira no-op, `maskSecrets` vira no-op e o segredo
ausente vira `add` (gravaria o placeholder no host) — e exige a suíte
**VERMELHA** pela âncora da prova mutada, com as outras três defesas e o caminho
saudável seguindo **verdes**. Antes o argumento vivia na prosa; agora uma
degradação que corte qualquer uma das quatro falha o PR.

As âncoras do controle casam exatamente um teste cada (13 conferidas, entre
provas e intactas) e as quatro mutações são cirúrgicas: o que cai é a defesa
nomeada, não o comando.

**E o drift de OPERAÇÃO ganhou cron — o furo que os dois gates acima não
fechavam.** As duas comparações host × template que já existiam rodam em
**EVENTO**: o gate de PR (invariante 7b, no job `guards`) e o pré-requisito 0 do
`gitea-up.sh`. Os dois olham o momento em que o REPOSITÓRIO muda. Só que o env do
VPS também muda SOZINHO — uma edição no host para "resolver rápido" um namespace,
uma versão colada à mão, um `RUNNER_TOKEN` rotacionado —, e **depois do merge não
há PR nenhum** para o gate olhar: a subida só recusaria no dia em que alguém a
disparasse, e até lá o compose interpola outra coisa que o repositório declara.
O cron `.gitea/workflows/env-mirror-drift.yml` (segunda 06:41 UTC, na forja, onde
o `deploy/.env.gitea` vive) roda o **MESMO comando** do pré-requisito 0 em `--json`
e transforma o drift em **issue acionável** (`scripts/env-mirror-drift-issue.mjs`,
label `env-mirror-drift`), com o **mesmo ciclo de reconciliação** dos outros
alertas: quando o env volta a espelhar o template, o mesmo step comenta a prova e
**FECHA** a issue. Três decisões fecham o desenho: **(a)** o publicador **não
reimplementa** a comparação — ele consome o relatório do guard, então a issue e a
mensagem da subida não podem discordar sobre o que é divergência; **(b)** `absent`
(o env do host não está visível no checkout, ou o template não está) **não abre
issue e não fecha nada**, mas **FALHA o run** — um cron que não conseguiu medir não
pode passar por verde, e a guarda do fechamento é explícita (`resolution.when` só
libera com `in-sync`, nunca por ausência: fechar com base numa medição que não
aconteceu apagaria a dívida); **(c)** o canal está **declarado** no
`ci/periodic-alerts.json` (canal `issue`, evidência = o publicador), então um cron
novo continua obrigando a decisão escrita em vez de entrar em silêncio.

**E a PRONTIDÃO inteira virou pré-requisito da subida — não um comando que
alguém precisa lembrar de rodar.** O doctor responde à pergunta completa (guards,
contrato de merge registrado, registry, imagem publicada, registro do runner) e
diz o que não provou; a subida passou a executá-lo como pré-requisito **2**,
depois da garantia da imagem e antes de qualquer `docker compose up`. A ordem é
contratual nos dois sentidos: o doctor trata a tag **ausente** como violação —
que é exatamente o que o passo 1 conserta —, então rodá-lo primeiro travaria o
remédio pelo estado que ele cura (o mesmo impasse do `--re-register`); e subir
depois de um `BLOQUEADA` publicaria o estado que a checagem existe para recusar. O que recusa é a **violação provada**: `BLOQUEADA`
(exit 1) e um doctor que nem rodou (exit >=3). `INDETERMINADA` (exit 2) **avisa e
segue** — um veredito que recusasse também o "não consegui provar agora"
tornaria a subida impossível offline, que é justamente quando ela é o remédio. Os
dois detalhes que o desenho exige: o doctor é chamado **INTEIRO** — a seção 4
dele (a prova do bloqueio) roda junto — e com `--no-runner-labels` no
`--re-register` (o registro gravado é o que aquele modo conserta; a isenção é do
fato que ele cura, não do resto do veredito). Rodar o doctor inteiro dentro do
bring-up só é possível porque a prova **DUBLA o doctor** que passa ao bring-up
que ela executa (`DOCTOR_SCRIPT` apontando para um dublê que não roda a prova): é
isso que faz `bring-up → doctor → prova → bring-up` terminar em **um** nível. O
corte é **medido**, não prometido — cada caso da prova exige que o doctor
invocado tenha sido o dublê, e a cadeia completa (com o doctor REAL dentro do
bring-up) é provada por execução —, e o `checkDoctorCycleCut` prende as duas
metades da dublagem, porque o modo de falha dela (a forca de processos) não dá
sintoma antes de ser catastrófico. A dublagem é o corte **primário**; a marca de
recursão que a prova grava é uma **defesa em profundidade** que sobrevive à
quebra do dublê. Ela vale por **dois canais** — a env var `FORGE_DOCTOR_NESTED`
(o padrão, para quem controla o ambiente do filho) **ou** a flag
`--proof-nested` no argv (para um wrapper, um `spawn` que não propaga o `env` ou
um script de diagnóstico) —, e os dois caem no mesmo `isNestedDoctorInvocation`
(exit 3). Sem o canal do argv, o caminho que não seta env ficava SEM a defesa e o
ciclo aparecia como exaustão de processos, não como a causa. E o guard não fica
em **silêncio**: ele EMITE o relatório da recursão no mesmo canal do veredito
(stdout, ou o JSON de `--json`), com o fato `nestedGuard` e um bloqueador que a
nomeia — o exit 3 sozinho é o MESMO código de uso inválido, então sem o relatório
quem lê a prontidão não distinguia a recursão de uma flag errada. Só esse fato
entra: as seções não foram coletadas, e o `unproven` declara isso em vez de
fingir cobertura.

**O mesmo fato diz que a defesa EXISTE — e não só que ela disparou.** O
`nestedGuard` tem **três estados**, porque são três perguntas diferentes:
`fired` (o guard disparou NESTA invocação — o relatório da recursão, acima),
`armed` (o guard está no caminho e responde aos dois canais — o relatório
NORMAL) e `disarmed` (algum canal deixou de ser respondido). O relatório normal
declara `armed` com os **canais nomeados**, e o fato é MEDIDO: o doctor sonda a
MESMA função do caminho quente (`isNestedDoctorInvocation`) com uma entrada
sintética por canal, em vez de reimplementar a regra (uma segunda implementação
mediria a si mesma). Sem esse fato, um veredito de forja saudável não dizia nada
sobre a defesa: se o guard saísse do caminho quente, ou se um dos canais
deixasse de responder, o relatório ficaria idêntico e a prontidão não mudaria uma
linha. Desarmado em qualquer canal **BLOQUEIA** (pelo canal que não responde, o
ciclo recursa até a exaustão de processos) e ausente vira **INDETERMINADA**
("pronta" sobre o que não foi olhado é a falsa segurança que este doctor recusa).
O que o fato **não** prova está escrito no próprio `detail`: a POSIÇÃO do corte
— que o check roda antes de coletar. Essa metade não se mede de dentro: medir a
defesa dando a volta no ciclo é o que a defesa impede (um filho sem o corte É a
recursão), e o diagnóstico não pode virar o defeito; quem prende a posição são
os testes que executam os dois canais de fora.

**O que a subida da stack promete, e como isso é executado:** cada uma dessas
promessas tem teste de execução —
o doctor é dublado por `DOCTOR_SCRIPT` e devolve 0/1/2/3, e o teste vê se a stack
subiu — e o `checkGiteaBringUp` prende a invocação, as flags e a **ordem** (depois
da imagem, antes de qualquer `up`). Um dublê em bash, e não `.mjs`, morreria no
parser do Node (`SyntaxError` → exit 1) e o teste leria "BLOQUEADA" de um dublê
quebrado: o dublê tem de falar a mesma língua do alvo. O guard lê **linhas de comando**
(comentário que explica a ordem não a satisfaz) e o comando separa três estados
que se confundem: tag **existe** (puxável anônima), tag **ausente** (publica e
**reconfere** no registry) e **indeterminado** (registry inacessível, ou pacote
privado — 401 é a resposta do GHCR tanto para pacote privado quanto para pacote
inexistente). Indeterminado nunca publica: "não sei" não é "não existe".

As **duas metades** da cadeia são provadas por execução, e não só a que dá certo.
Com a dublagem no lugar, o teste do irmão mede o CORTE PRIMÁRIO: o doctor real é
invocado **uma** vez e todas as descidas vão para o dublê da prova. E com a
dublagem **ausente** (`DOCTOR_SCRIPT` não passado — a falha que a defesa em
profundidade existe para cobrir), o `gitea-bring-up-recursion.test.ts` roda o
`deploy/gitea-up.sh` REAL com o doctor **COMITADO**, o `docker` dublado e um
registry de teste, e exige: a cadeia TERMINA, o **relatório de recursão sai no
stdout** com o canal que a marcou, **nenhuma seção foi coletada**, o bring-up **não
desceu** um segundo nível (a contagem é a prova do corte), **nenhum `up`** chegou
ao docker e **nenhum sintoma de exaustão** (`EAGAIN`, `ENOMEM`, `Maximum call
stack`, `fork: retry`) aparece no output. Um controle com o guard DESLIGADO na
cópia do doctor prende a CAUSA: a mesma invocação marcada passa a **coletar** em
vez de recusar, então o verde do teste principal não pode vir do ambiente.

**O limite desta família, e o que cobre o resto:** guard estático lê **texto**.
Ele não vê o `vars` do act_runner hidratando, nem `./.github/actions/setup-bun`
resolvendo relativo ao workspace, nem o runtime realmente instalado — os três só
existem quando a pipeline roda. `check-bun-mirror` prova que a versão do Bun tem
**um** ponto de verdade no repositório; ele não prova que a forja **usa** essa
versão. Quem prova isso é o smoke manual
`.gitea/workflows/forge-smoke.yml` (**Actions → Forge Smoke (manual) → Run
workflow**), que falha apontando qual premissa quebrou. Ele é `workflow_dispatch`
por desenho — um job de dispatch nunca reporta status num PR, então exigi-lo como
required check travaria todo PR (travado em teste). Contrato e remédios em
`deploy/GITEA.md` § "Smoke test da forja".

---

### 6.1. Sintaxe do shell — corpo `run:` E scripts versionados — `check-workflow-run-syntax` (`scripts/check-workflow-run-syntax.mjs`)

**O que protege:** TODO o shell versionado do repositório faz **parsing em
`bash -n`** (2026-09), nos DOIS escopos, com UM parser e UM veredito:

1. os **corpos `run:`** dos workflows das duas forjas;
2. os **scripts de shell** — `*.sh`/`*.bash` + os hooks do `.husky/` (arquivos
   SEM extensão e ainda assim shell), pela MESMA lista do `check-pipefail-sigpipe`
   (`listShellScripts`): o corpo de um passo morre no RUNNER, e um script morre no
   **PASSO que o executa** (`bash scripts/x.sh`), depois do setup e longe da
   causa — a mesma classe de defeito, um passo adiante.

O modo **`--staged`** julga só o que o **ÍNDICE** tem (workflows E scripts),
lendo o conteúdo **do commit** (`git show :path`) e não o working tree — é o
recorte do pre-commit (`HOOK_DECLARED` do `check-hook-ci-parity`), e sem
git/índice ele é **fail-closed** (exit 2), porque "0 violações" sem ter lido o
índice seria uma afirmação sobre nada.

**O ESCOPO é do REPOSITÓRIO, não da árvore.** O que o próprio repositório
declara **LOCAL** pelo `.gitignore` — o scratch de uma sessão num checkout
compartilhado, o cache — sai da varredura das três fontes de **ARQUIVO**. O
defeito medido (26/09/2026): um PATCH salvo com extensão `.sh` dentro de `.tmp/`
era julgado por `bash -n` e pintava o local de vermelho num arquivo que o CI nunca
vê. Quem decide o corte é o **git**, em duas perguntas (`semLocaisIgnorados`, do
dono da varredura de shell): o **ÍNDICE** (`git ls-files`) mantém o VERSIONADO
mesmo que uma regra o case — o CI o carrega, e tirá-lo seria varrer menos do que
parece —, e o **IGNORE** (`git check-ignore -v --stdin`) tira o resto. O corte é
**NOMEADO** no relatório e no `--json` (no `--list`, no STDERR: o STDOUT ali é
uma lista de caminhos), porque gate que varre menos sem dizer mente pelo que não
diz; git que não responde (uma fixture fora de repositório) devolve a lista
**INTEIRA** com o motivo — a varredura fica mais **AMPLA**, nunca mais estreita —,
e com `--staged` o corte é vazio por construção (o índice não carrega caminho
ignorado).

**Por que existe:** o repositório reescreve corpo de `run:` por MÁQUINA, de
propósito — o `--fix` do `check-pipefail-sigpipe` (seção 20) trocou **216**
ocorrências de `PRODUTOR | grep -q P` por `grep -q P <<< "$(PRODUTOR)"`. É
exatamente onde entra um `<<<` desbalanceado, um `"` a mais, uma continuação
(`\`) que engoliu a linha seguinte ou um `<<'EOF'` sem terminador — e nenhum
guard que LÊ o YAML enxerga isso: para o `check-workflow-refs`, o
`check-forge-parity` e o doctor, um corpo sintaticamente quebrado continua sendo
um `run:` válido. O erro só aparecia quando o runner executava o passo: depois do
setup (minutos), no meio do job e longe da causa.

**Como mede:** os corpos saem da MESMA leitura dos outros guards
(`workflowRunSteps`/`workflowDefaultShells` e a lista de
`scripts/forge-workflows.mjs`), e a CLI roda `bash -n` com o corpo no stdin.
Três decisões que são o gate:

1. **o AVISO conta tanto quanto o ERRO.** `bash -n` sai **0** para um heredoc sem
   terminador (é aviso, não erro) — e um corpo truncado é um passo que roda outra
   coisa. Julgar pelo exit code deixaria passar a classe que a reescrita mecânica
   mais produz, então `ok` exige exit 0 **E** stderr vazio (medido: 0 avisos hoje);
2. **a expressão do runner (`${{ ... }}`) é MASCARADA.** Ela não é sintaxe de
   shell — o runner a resolve antes de o bash existir —, então julgar as chaves
   seria julgar um texto que nunca chega ao interpretador. A máscara é uma
   PALAVRA (preserva o contexto: um erro real em volta continua sendo pego; há
   teste para as duas metades);
3. **`LC_ALL=C` pinado:** a mensagem do parser vai para o relatório e para os
   testes; "erro de sintaxe" vs "syntax error" conforme o `LANG` do runner faria
   o diagnóstico depender do ambiente de quem roda.

**O `shell:` declarado é julgado contra o que o runner MEDIU** — é a classe que o
parsing não pega: `bash -n` julga o CORPO, não a existência do interpretador, e
um passo com `shell: pwsh` num runner sem `pwsh` saía como "pulado" e morria com
`command not found` DEPOIS do setup, no meio do job. Três desfechos:

| `shell:` declarado                                   | desfecho                                                  |
| :--------------------------------------------------- | :-------------------------------------------------------- |
| `bash`/`sh`/ausente                                  | o corpo é PARSEADO (a premissa do runner é `bash -e {0}`) |
| não-bash **presente** na imagem                      | PULADO **e nomeado**, com o caminho medido                |
| nome que a medição achou **AUSENTE** (`pwsh`, `zsh`) | **VIOLAÇÃO** (exit 1), com o que o runner faria           |
| nome **fora da medição** (`mytool {0}`)              | **INDETERMINADO** — nomeado, nunca presumido              |

O conjunto não é presumido do documentado nem do `command -v` de quem roda o
guard (isso publicaria como fato do repositório uma propriedade da MÁQUINA): ele
tem **ref, digest, data e o comando que mediu**, impressos por `--shells` — o
dia em que a base mudar, o caminho é RE-MEDIR, não ajustar o número no olho.

**E quem re-mede é um CRON, não a memória de alguém:** o job semanal
**`runner-shells-drift`** (`benchmark-weekly.yml`, domingo 03:00 UTC) roda o
MESMO probe DENTRO da imagem (`scripts/runner-shells.mjs`, dono da declaração — o
gate a importa, não a copia), compara com o que está declarado e publica a
divergência como **issue acionável** (`scripts/runner-shells-issue.mjs`, label
`runner-shells-drift`), com o **mesmo ciclo de reconciliação** dos outros
publicadores: a issue se FECHA quando a medição voltar a bater com o declarado,
com a tabela medida no comentário de prova. E a dívida aparece na **prontidão**:
`DEBT_SUBJECTS` (o registro do doctor) lê a label e a reporta como fato próprio da
seção de dívida aberta, com `crossCheck: null` **declarado** — o doctor não puxa a
imagem, então ele não tem como medir a caducidade; o registro diz isso em vez de
presumir que a issue velha já se resolveu. A dívida que ele cobre tem duas
direções, e as duas são invisíveis para todos os outros gates (a declaração só
governa o veredito do PRÓPRIO gate): declarar **presente** o que a imagem não tem
faz o gate **PASSAR** um passo `shell:` que morre com `command not found` depois do
setup; declarar **ausente** o que a imagem tem faz o gate **REPROVAR** um passo
legítimo. `unavailable` (sem docker, imagem não puxável, `BUN_VERSION` sem valor)
NÃO abre issue — ele **falha o run** com o motivo nomeado: um cron que não mediu
não pode passar por verde. A

forma CUSTOM (`perl {0}`) não é um quarto desfecho: o que o gate julga é o NOME
que ela invoca (`perl {0}` passa; `pwsh {0}` reprova).

**Nos ARQUIVOS, quem declara o interpretador é o SHEBANG** — o análogo do
`shell:` de um passo, que num arquivo não existe (a declaração muda de FONTE: de
uma chave de YAML para a primeira linha do arquivo). Quatro desfechos, nenhum
silencioso: shebang bash/sh é julgado pelo **MESMO** `isBashShell`; shebang de
outra linguagem (`python3` num `*.sh`) é **PULADO e nomeado** (o `bash -n` não
julga o que não é bash); arquivo **sem shebang** (o caso dos hooks do husky, que
os roda com `sh -e`) cai na **premissa** e é julgado; e arquivo **VAZIO** sai
nomeado (nada executa, não há sintaxe a julgar). Duas diferenças deliberadas em
relação aos corpos: o arquivo vai ao parser **CRU** (num script não há runner para
resolver `${{ ... }}` antes do bash — a máscara existe do lado do TEMPLATE, não do
lado do arquivo) e o que se julga é o **ARQUIVO INTEIRO**, não um passo.

**E o shell EMBUTIDO** — o texto que não é corpo de passo nem arquivo, e que por
isso não era julgado por NINGUÉM: a instrução **`RUN` de um Dockerfile** (o shell
do BUILD, entregue a `/bin/sh -c`: uma cicatriz mecânica ali só aparece no meio
de um build de minutos, e o Dockerfile continua sendo um Dockerfile válido) e o
**payload LITERAL de um `sh -c`/`bash -c`** (num script, num corpo `run:` ou num
`entrypoint:` de compose — para o `bash -n` do arquivo que o contém ele é uma
STRING, e é por isso que um `bash -c "if [ x ]; then"` truncado passava por todos
os gates anteriores). As premissas mudam por FONTE, e é isso que mantém o veredito
honesto:

| fonte do texto               | o que o shell recebe                                                                                                                        |
| :--------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------ |
| `RUN` de Dockerfile          | a instrução **JUNTADA** (a continuação `\` faz parte, o comentário dela é descartado como o docker faz) e sem as flags `--mount=` do docker |
| payload de `run:`            | o texto com `${{ ... }}` **mascarado** (o runner resolve antes)                                                                             |
| payload de compose           | o texto com `$$` **desescapado** (a interpolação do compose resolve antes)                                                                  |
| payload de script/Dockerfile | o texto **CRU**                                                                                                                             |

Um **compose** é lido por ESTRUTURA (`js-yaml`, a mesma porta dos workflows):
varrer o TEXTO leria a sintaxe do YAML como programa — medido, um `entrypoint:`
em lista (três elementos, o último um bloco `\|`) entregava a marca de lista (`-`)
e um flow (`["CMD", "python3", "-c", ...]`) não entregava nada. A lista de
Dockerfiles vem da **ÁRVORE** (qualquer `Dockerfile*`, em qualquer diretório), não
de uma lista à mão: um Dockerfile novo cai na varredura sem editar nada. Um
payload que só existe em runtime (`bash -c "$cmd"`) sai **INDETERMINADO** (com o
motivo), a forma EXEC sem shell e o `-c` de um `python3` saem **PULADOS e
nomeados**, e o corpo de um **heredoc** é DADO (nunca programa).

Sem allowlist: o repositório passa inteiro — **570 corpos** das duas forjas (e
todos os `shell:` declarados existem), **145 arquivos de shell** (142 `*.sh` + os
3 hooks do `.husky/`) **e 35 textos de shell embutido** (14 instruções `RUN` +
21 payloads de `sh -c`, com 2 indeterminados nomeados: os dois `bash -c "$cmd"`
dos scripts de banco, cujo texto é montado em execução), sem erro E sem aviso. Um
gate que nasce absoluto não tem cota para envelhecer — cota aqui significaria
declarar que um corpo (ou um script, ou um `RUN` de build) quebrado pode ficar
quebrado.

**O `--fix` remenda a cicatriz MECÂNICA — e mede o efeito antes e depois de
gravar.** A cicatriz é um **operador pendente** no fim do corpo (`\`, `&&`,
`||`, `|`, `<<`, `<<<`, `>`, `>>`, `<`) — a impressão digital de uma linha
ENGOLIDA pela reescrita, onde o bash sai com `unexpected end of file`. `&` e `;`
ficam **fora**: eles FECHAM comando (`sleep 1 &` é válido) e remendar um deles
inventaria intenção. Ele NUNCA reconstrói a linha engolida — tira a cicatriz que
impedia o parsing e diz que o diff é o que se revisa.

Quatro condições, e nenhuma é opcional: (1) o corpo só é tocado em bloco
**LITERAL** (`run: |`), onde a linha do arquivo É a linha do corpo — a forma
dobrada (`>`) e a escalar inline juntam/dividem linhas; (2) a última linha do
corpo tem de casar com a linha do arquivo; (3) o corpo remendado tem de voltar a
fazer parsing, medido em memória; (4) **depois de gravar**, o arquivo é RELIDO e
re-julgado — e a gravação é **DESFEITA** se o corpo no disco não passar. As
recusas saem **com motivo escrito** (heredoc: o texto é DADO; forma não-literal;
`then` sem `fi`: a intenção não é reconstruível dali; remendo que deixaria o
corpo VAZIO: o passo deixaria de rodar o que diz). Num **arquivo de shell** o
fixer **RECUSA**, com motivo escrito: a cicatriz que ele conhece é UMA linha
ancorada no bloco `run: |`, e num arquivo a reescrita pode ter engolido qualquer
linha — remendar a última sem ver a causa inventaria intenção. A recusa é
**veredito** (exit 1), nunca um `✓` que esconde o script quebrado. `--fix` com
`--staged` ou `--json` é uso inválido (exit 3) — ele escreve na ÁRVORE e relata em
texto.

**O pre-commit OFERECE esse remendo — quando um gate do hook reprova o commit por
um defeito MECÂNICO, com confirmação explícita.** `scripts/pre-commit-remedy.mjs`
(o comando `LOCAL` declarado em `HOOK_DECLARED`) é o caminho pelo qual o operador
chega ao fixer NO MOMENTO em que a cicatriz aparece: sem ele, o hook reprovava o
commit e a correção era reescrever à mão exatamente a linha que a máquina remenda
— com a chance de introduzir um erro NOVO na mesma linha.

Ele cobre as **oito classes mecânicas** que o repositório já sabe consertar por
máquina, e nenhuma régua é reimplementada: a detecção e o remendo são SEMPRE o
guard DONO — rodado como o hook o roda, ou IMPORTADO quando o dono é um módulo
(`fixAll` da sintaxe, `fixAll` do SIGPIPE, `fixAll` das citações de commit,
`planoDeRemendo`/`aplicarRemendo` dos comandos do hook, `fixRemovedMirrors` da
declaração de espelho): um remendo que
re-derivasse o alvo de um defeito divergiria da diagnose que o gate acusa.

**O que faz uma classe ser OFERECÍVEL é o guard dono RODAR no hook.** O `--fix`
sozinho não basta: o remédio só é invocado quando uma fase do commit reprova, então
um fixer cujo guard não é executado ali nunca chega ao operador — o remendo existe
só no CI, onde ninguém tem terminal para confirmar. Foi por isso que a sexta classe
(`pipefail-sigpipe`, o `PRODUTOR | grep -q` sob pipefail) entrou junto com o guard
dela na **fase B** do `.husky/pre-commit` (o MESMO comando do CI, medido em ~0,14s);
e a sétima (`bun-mirror-removal`) é o outro lado da mesma regra: o guard dono JÁ
rodava na **fase A** (o `check-bun-mirror.mjs --staged`, um dos seis dela) e o que
lhe faltava era o `--fix`, declarado no mesmo commit em que a classe nasceu — a
detecção e o remendo, portanto, no MESMO lugar onde o índice é recusado (medido:
com o arg `BUN_VERSION` apagado de um build site, a fase A recusa, o remendo volta
ao índice e o `--staged` do dono revalida verde). A fase A, que era o argumento de
"fixer cujo guard não roda no hook nunca chega ao operador", passou a ter um. O gate
**SEM FIXER**, porém, deixou de custar a oferta: a
falha da fase A **não** encerra mais o hook antes dela. A oferta é das **classes
presentes no commit**, não do gate que reprovou — é o que a torna independente de
quem recusou. Medido por execução: com a fase A vermelha por um defeito real (o
`BUN_VERSION` removido de um build site do compose) e uma classe remendável no
MESMO índice (a cicatriz de SIGPIPE), o remédio é oferecido igual, com o caminho à
mão dela; a mutação que devolve o hook ao estado do HEAD (`[ "$FASE_A" -eq 0 ] ||
exit "$FASE_A"` antes da oferta) mostra o que se perdia — mesmo veredito, sem oferta.

**A OFERTA DAS CLASSES É DERIVADA, e o dono da declaração é o guard que remenda.**
Cada classe é um módulo em `scripts/remedy-classes/<id>.mjs` — o NOME do arquivo é o
`id` —, declarado ao lado do `--fix` que ele usa, e o `pre-commit-remedy.mjs`
descobre a oferta VARRENDO o diretório (`remedy-classes.mjs`). Antes disto a lista
era escrita à mão dentro do remédio: um guard novo que já sabia se consertar ficava
FORA da oferta até alguém editar aquele arquivo, e a regressão não acusava nada —
um remédio que não oferece o conserto é indistinguível de um defeito sem conserto.
O bloco de classes da **ajuda** sai da MESMA oferta (`blocoClasses()`): uma lista
escrita à mão ali divergiria da que o remédio executa.

**A oferta também é uma superfície MEDIDA** (`--oferta`): a MESMA detecção do
primeiro passo, com o guard dono de cada classe, publicada em **JSON no stdout**,
sem pergunta e sem escrever na árvore nem no índice. Ela existe porque quem mede a
oferta de fora — a prova do lugar, DENTRO do runtime do CI — não tem como lê-la do
texto sem transformar prosa em requisito, nem do exit code sem saber QUAL classe
foi oferecida; o JSON responde as duas: `classes` (id, rótulo, fixer do dono,
ofensores, violações e o relatório do dono), `notApplicable`, `unmeasured`,
`semRemendo` e `problems`. A semântica acompanha o modo: `0` diz que a oferta foi
**medida** (mesmo vazia — "nada a remendar" é um fato, e quem exige a classe é
quem mede) e `2` que alguma classe não pôde ser medida ou que a oferta está
incompleta (o commit não é julgado por uma oferta menor). O remédio interativo
segue com a semântica dele (`1` quando não há nada a remendar) — medir não é
remendar.

A declaração é validada na descoberta, e o contrato é curto: nome do arquivo = `id`;
`ordem` ÚNICA (a ordem das mensagens não pode depender do sistema de arquivos); os
campos que o driver consome existem e têm o tipo certo; `estagio` é um dos três; o
guard dono existe e declara `--fix`; e o comando do fixer CITA o guard dono. Uma
declaração inválida **não sai da oferta em silêncio**: ela entra em
`CLASSES_PROBLEMAS` e a rodada é RECUSADA (exit 2) nomeando o arquivo e o que falta
— um commit julgado por uma oferta incompleta ofereceria MENOS do que o repositório
sabe remendar (e "nada a remendar" passaria a significar "nenhuma classe"). Pelo
mesmo motivo diretório ilegível ou vazio é PROBLEMA, nunca "nenhuma classe".

A prova é `src/lib/__tests__/remedy-classes-discovery.test.ts`: ele escreve uma
declaração nova — com o guard dono dela — no FIXTURE e mede a CLI do remédio
EXECUTANDO a classe nova, sem que ninguém edite o remédio; e mede cada caso de
declaração inválida, e a recusa (exit 2) que impede o veredito. Como o par
"declaração + guard dono" ANDA JUNTO, o fecho dos fixtures traz as declarações
e os guards donos: um fixture com as declarações e sem os donos é uma
árvore inconsistente, e o não-zero viria da oferta, não do defeito.

| classe               | o defeito                                                                                  | o fixer (guard dono)                                | estágio do remendo                          |
| :------------------- | :----------------------------------------------------------------------------------------- | :-------------------------------------------------- | :------------------------------------------ |
| `run-syntax`         | operador pendente no fim do corpo `run:` em bloco literal                                  | `check-workflow-run-syntax.mjs --fix`               | `git add`                                   |
| `crlf`               | CR/CRLF no working tree dos `.sh`/`.bash` rastreados                                       | `check-crlf.sh --fix`                               | `git add --renormalize`                     |
| `blob-crlf`          | CRLF/mixed no BLOB do ÍNDICE dos `.sh`/`.bash`                                             | `check-blob-crlf.sh --fix`                          | o PRÓPRIO fixer (`git add --renormalize`)   |
| `utf8`               | byte 0x97 (em dash do Windows-1252) nos `.ts`/`.tsx` de `src/`                             | `check-utf8.sh --fix src/`                          | `git add`                                   |
| `hook-commands`      | caminho TIPADO num comando de hook (vizinho inequívoco)                                    | `check-hook-commands.mjs --fix`                     | `git add` — e **RELANÇAMENTO** (ver abaixo) |
| `pipefail-sigpipe`   | `PRODUTOR                                                                                  | grep -q`sob`set -o pipefail` (SIGPIPE intermitente) | `check-pipefail-sigpipe.mjs --fix`          | `git add` |
| `bun-mirror-removal` | arg `BUN_VERSION` de um build site do compose / `"packageManager"` **APAGADO** pelo commit | `check-bun-mirror.mjs --fix`                        | `git add`                                   |
| `doc-hashes`         | citação de commit ÓRFÃ na prosa (a dobra trocou o NOME do commit)                          | `check-doc-hashes.mjs --fix`                        | `git add`                                   |

Sete vivem na **fase B** do hook (as de encoding pelo `run-encoding-guards.sh`; as
demais por serem guardas globais daquela fase); a oitava vive na **fase A**,
onde o guard dono recusa o índice — e é por isso que a extensão da oferta vale:
quem abre um commit com CRLF, com o byte corrompido, com um caminho tipado num hook,
com a cicatriz de SIGPIPE, com a declaração de espelho apagada ou com a prosa
citando um nome que a dobra matou não tinha caminho
nenhum além do `--fix` à mão. As três classes de encoding se SOBREPÕEM por construção (o CR do
working tree suja também o blob), e o remédio leva o arquivo ao índice **uma vez**,
sem acusar de retido o que uma classe anterior já estagiou.

**A oitava classe (`doc-hashes`) tem uma regra que as outras não têm: a régua dela
é o GRAFO do repositório.** O remendo é a troca do IDENTIFICADOR — o token hex
antigo vira o commit de MESMO assunto que está na história (o nome que a dobra
deixou), e nada mais da linha é tocado: um remendo que reescrevesse a prosa em
volta do hash estaria inventando texto. O que NÃO tem remendo sai nomeado, nunca
sumindo: a citação órfã sem commit de mesmo assunto na história (o remédio não
adivinha o nome) e o hash que não existe como commit nenhum. E por ser a HISTÓRIA
a régua, uma árvore sem commit em `HEAD` faz a classe se declarar **INAPLICÁVEL**
— não UNMEASURED: ali o guard dono já dá o veredito dele (fail-closed, exit 2) e
“não consegui medir” não pode ser o nome de “não há o que medir” (medido: sem esta
declaração, uma rodada do remédio numa árvore assim saía `infra`, exit 2, com o
guard respondendo). No repositório real a classe é OFFERECIDA como as outras,
porque o guard dono roda na **fase B** do hook desde que nasceu (o par declaração

- guard rodando é o que torna o remendo oferecível — seção 30).

**A classe `bun-mirror-removal` mede dois limites, e os dois são da mesma
natureza** (um remendo que adivinha é o defeito, não o remédio): a **chave-pai** — o
commit pode apagar o bloco INTEIRO (`args:` e o arg), e o remendo devolve o trecho
que ESTE commit tirou (a declaração mais as chaves-pai apagadas do caminho;
a extensão para na primeira linha que não é chave, que sobreviveu no índice ou é
comentário); e a **âncora única** — a declaração só volta abaixo de uma linha que
aparece **exatamente uma vez** na árvore. Sem candidata, ou com candidata ambígua
(a linha de apoio em dois blocos), o fixer **RECUSA** e o commit segue bloqueado
com o motivo por arquivo (o `semRemendo`), em vez de escolher um lugar plausível.
O que ela **não** cobre está declarado: a linha que apenas TROCA o valor é
DIVERGÊNCIA, não apagamento — não entra na classe, e quem a nomeia é o veredito
`--staged` do próprio guard dono, com o valor novo no relatório.

As duas classes que **estagiam por conta própria** (`blob-crlf`, cujo fixer roda
`git add --renormalize`) ficam **RETIDAS** quando algum ofensor tem WIP ou não é
deste commit: não há como separar o que ela estagiaria, e um `git add` ali levaria
junto trabalho que não é do commit. As outras são re-estagiadas só se não tinham
modificação não estagiada ANTES do remendo.

**A classe `hook-commands` tem uma consequência que as outras não têm: ela
REESCREVE O ARQUIVO QUE A CASCA ESTÁ EXECUTANDO.** Medido: uma casca de 12.957
bytes reescrita no meio da própria execução (`sh -e`, como o husky usa) sai **127**
com um `B39: not found` numa linha POSTERIOR — o interpretador lê o arquivo por
DESLOCAMENTO, e mudar o tamanho desalinha o que ele ainda vai ler (sem a
reescrita, o MESMO arquivo sai 0). A classe declara `exigeRelancamento`, e o
driver, depois de aplicar e re-estagiar, **NÃO deixa o commit seguir**: ele diz
RE-RODE e bloqueia. O remendo está na ÁRVORE e no ÍNDICE, e quem mede o commit
corrigido é um `git commit` NOVO — a revalidação de uma fase qualquer mediria
bytes que não são os do arquivo. Sem essa metade, o veredito do remédio seria dado
por uma casca que já não é a que está rodando.

A sequência é dita ANTES da pergunta, porque é ela que o "sim" autoriza:

1. **PREVIEW** com o MESMO caminho de decisão do fixer (`fixAll` com `dry`): o que
   o preview promete é o que a gravação faz — uma régua paralela prometeria um remendo
   que a gravação recusaria. **Nada é gravado aqui** (e há teste medindo isso);
2. **sem cicatriz remendável ele NÃO pergunta** (uma pergunta cuja resposta não
   muda nada ensina o operador a responder sem ler): sai vermelho com o motivo da
   recusa por arquivo — inclusive para a classe que este fixer não toca (`shell:` que
   o runner não tem). Índice **verde** é o único caso em que ele sai 0 sem remendar;
3. **pergunta UMA VEZ** (s/n; o default é o NÃO) para TODAS as classes de uma vez —
   a lista de cada uma com o seu relatório já está na tela —, dizendo os TRÊS
   efeitos: remenda a ÁRVORE, re-estagia (`git add`) os arquivos e **revalida as
   classes tocadas**;
4. **aplica, re-estagia SÓ o que não tinha modificação não estagiada ANTES do
   remendo** — num arquivo com WIP o `git add` levaria para dentro do commit
   trabalho que não é dele (o remendo fica na árvore e o operador é avisado para
   revisar);
5. **REVALIDA com o guard dono de cada classe** (a sintaxe pelo `--staged` do gate,
   em subprocesso; as de encoding re-DETECTADAS pelo guard dono): o veredito e o
   relatório são os dele, não uma segunda implementação aqui. Quando o índice e a
   árvore divergem de linha, quem recusa é o próprio fixer (a linha do arquivo não
   é a do corpo) — o remédio não grava na linha errada nem com o índice deslocado.

**E quem diz se a FASE passou é a FASE, rodada de novo pelo hook.** O remédio
só LEVANTA a falha que ele mediu — o exit 0 dele não é veredito de fase nenhuma. Por
isso as **duas** fases vivem em **função** (`fase_a`, `fase_b`): depois de um remédio
verde o hook reexecuta **as fases que estavam vermelhas** — nem mais (pagar o
instrumento de um veredito que já é verde), nem menos —, e é o veredito DELAS que
decide. Sem isso, um remendo verde esconderia um gate IRMÃO da fase que continua
vermelho — e o `run-encoding-guards.sh` para no PRIMEIRO guard que falha (`set -e`),
então é justamente na reexecução que os seguintes são medidos. A fase A entra na
reexecução pela mesma regra, e um remédio verde **não** a levanta: medido por
mutação — sem a reexecução dela, o commit com o gate do índice vermelho PASSA.

E a fase B que a fase A vermelha deixou **sem medição** (o custo dela não é pago por
um commit já bloqueado) é medida no fim do bloco, com o remendo já no índice: nenhuma
fase fica sem veredito, e se ela reprovar é ela que encerra o hook. Esse ramo só é
alcançável quando a reexecução da fase A volta verde — estado que nenhuma classe
produz hoje (nenhuma remenda um guard do índice), então ele é provado do jeito que a
cultura da casa exige para código que espera um fato futuro: **por mutação**, com um
fixer da fase A SIMULADO no hook (as duas metades — a remedição medindo a fase B real
que reprova, e a mutação que a remove deixando o commit passar com a fase nunca lida).

A pergunta, por isso, vem depois das fases — e a fase que não chegou a rodar é medida
logo depois do remédio: um prompt competindo com guards escrevendo é um prompt que
ninguém lê.

**A resposta vem do TERMINAL DE CONTROLE.** O stdin do hook **não** é um terminal
(nem uma fonte confiável: num hook ele pode ser um pipe, ou o terminal de outro
processo), então o remédio abre o **`/dev/tty`** e pergunta **ali** — que é o
terminal do operador. Só quando esse `open` falha (sessão **sem** terminal de
controle: CI, `ssh` sem tty) ele imprime a lista e o **caminho à mão** (`--fix` +
o `git add` que leva o remendo ao commit) e mantém o commit **bloqueado**,
fail-closed. O fim do stdin (Ctrl-D) e o **teto da espera** (2 minutos,
`TTY_WAIT_MS`, porque o `/dev/tty` não tem fim de arquivo) resolvem como **NÃO** —
um hook que pergunta a um terminal onde ninguém está não pode pendurar o commit.

**E o terminal do operador NÃO chega ao stdin do hook (fato medido) — por isso o
`/dev/tty`.** Um `git commit` invoca o hook com o fd 0 ligado em `/dev/null` — os
descritores 1 e 2 são o terminal, o 0 **não** é. Consultar o STDIN, então, deixava
a oferta interativa morta justamente no fluxo REAL do operador; quem decide agora é
o terminal de CONTROLE, que existe nesse fluxo (a pergunta acontece num `git
commit`). O outro lado não muda: numa sessão sem terminal de controle (`setsid`, o
caso do CI) o `/dev/tty` não abre e não há pergunta.

Há ainda um **desligamento declarado** da pergunta: `PRE_COMMIT_REMEDY_NO_PROMPT`
(`1`/`true`/`yes`/`sim`/`on`) — para quem tem terminal mas **não tem operador**
(um `git commit` dentro de um script, uma esteira que aloca tty). Com ela ligada o
remédio não abre o `/dev/tty` e cai no caminho à mão, e o relatório diz que o
motivo foi a variável (e não "não havia terminal"). O simulador de hook
(`scripts/hook-simulator.mjs`) a liga nas provas — um teste não pode depender de
alguém responder um prompt —, e o ensaio do pty a passa **vazia** para medir a
pergunta acontecendo.

As **direções** são medidas por
`src/lib/__tests__/pre-commit-remedy-pty.test.ts`, que aloca um **pty de verdade**
(`scripts/pty_answer.py`, com a porta Node em `scripts/pty-harness.mjs`) em vez de
injetar `isTTY` num dublê — uma injeção prova a lógica, não o terminal, e foi ela
que manteve esta distinção invisível até agora: (a) o remédio direto sob o
terminal — o "sim" remenda a árvore, re-estagia e revalida (exit 0), e o
"não"/ENTER não toca em nada; (b) o **`git commit`** com o fd 0 em `/dev/null` e o
pty no 1 e no 2 — a pergunta **aparece**, o "sim" no terminal remenda e o commit
**ENTRA** (com o corpo remendado no OBJETO), o "não" bloqueia; (c) a mesma sessão
medida por dois filhos: um que herda o terminal de controle (abre o `/dev/tty`) e
um em sessão própria (`setsid`, o do CI) que **não** abre — é essa diferença que
separa "pergunta" de "SEM TERMINAL", e ela é medida, não presumida; (d) o caminho
da **fase B**, com o runner de encoding reprovando por dublê declarado e os guards
de encoding REAIS no fixture: a pergunta acontece, o remédio remenda e leva o
remendo ao índice, e **quem dá o veredito é a fase reexecutada** — uma fase que
volta a reprovar bloqueia o commit mesmo com o remédio verde, e uma que passa na
SEGUNDA medição deixa o commit entrar. A metade que torna isso load-bearing é uma
**mutação** no mesmo arquivo: apagada a linha da reexecução, o primeiro cenário
passa a commitar — a reexecução é o que separa "o remédio levantou" de "a fase
ficou verde". O harness se
declara INDISPONÍVEL com o motivo nomeado onde não há `pty` (Windows) — nunca um
verde por omissão.

E o bloqueio é do **HOOK**, não do remédio: a variável que autoriza o commit nasce
"não provou nada" e só é zerada pelo **exit 0** do remédio (é por isso que a linha
do hook é `node … && REMEDIO=0 || true`: o `|| VAR=$?` registraria o FRACASSO,
nunca o sucesso, e o `|| true` mantém o `set -e` fora do caminho para o veredito
explícito — que sai com o código do GATE — ser quem decide). As duas direções são
medidas: o remédio que sai 0 **LEVANTA** a falha (o hook segue) e **apagar a
chamada não aprova o commit** (sem ela, ninguém zerou a variável).

**Onde roda:** job **`workflow-run-syntax`** do `pr-check.yml` (espelho) e job
`guards` da forja (dona do merge) — o mesmo literal nas duas, como invariante do
CORE (`workflow-run-syntax`); o `check:forge-parity` declara o `jobIds` por forja
e cobra o comando canônico no job declarado. Como a bateria do doctor é DERIVADA
do job `guards`, o gate entra no relatório de prontidão sozinho. E o
**pre-commit** roda o recorte `--staged` na fase paralela: o commit que introduz
o corpo (ou o script) quebrado é bloqueado **antes** de virar PR — recorte
DECLARADO, com o escopo escrito no `why` (o CI continua sendo a varredura inteira:
as duas forjas + todos os scripts). O status do gate é capturado SEPARADO dos
outros quatro da fase A (o `wait_all` devolve o primeiro não-zero, e só ele tem
remédio) e o status da fase B em separado também (`fase_b || FASE_B=$?`): é o que
permite oferecer UMA pergunta cobrindo as classes das duas fases e reexecutar só a
fase que reprovou.

**Por que um job PRÓPRIO no espelho:** o veredito do PR passa a ser um check com o
NOME do defeito. Antes ele era um passo dentro do `workflow-refs-guard`, que cobre
seis invariantes: um PR que quebrava um corpo `run:` derrubava um job que não diz
qual delas caiu. E, sendo job, ele entra no `ci/required-checks.json` — renomear
ou remover deixa de ser drift silencioso no contrato de merge. Na forja o
invariante continua sendo passo do `guards`, que é o gate único dela por desenho
(um runner, 40 guards); o que a paridade exige é o MESMO COMANDO, não a mesma
granularidade de job.

**O remédio chega ao PR, não só ao log do job (o comentário reconciliado).** O
`--fix` existe onde há terminal e operador (o hook), e é LOCAL: quem abre o PR via
o check vermelho, o log do bash e nada mais — e reescrevia à mão exatamente a linha
que o repo já sabe remendar. `--fix --dry-run` é o MESMO preview do remédio do
pre-commit na CLI, e o que ele imprime é o **PATCH exato** (as linhas `--- a/…`,
`+++ b/…` e o hunk de uma linha saem do MESMO `fixWorkflow` que a gravação usa —
"uma régua, dois consumidores"): ele vai para **STDOUT limpo** (`… --fix --dry-run |
git apply` aplica sem arquivo intermediário) e o relatório inteiro para **STDERR**,
para o `|` valer. `scripts/pr-remedy-comment.mjs` publica esse patch como
**COMENTÁRIO** no PR — em `.github/` **e** na forja, com o `--backend` da vez, no
MESMO job do gate, com `if: always()`: o caso de uso é o gate VERMELHO, e com ele
verde o passo só retira o comentário que ficou para trás. Quem decide o que
publicar é o SCRIPT (não um `if: failure()` no workflow, que deixaria o comentário
velho aberto no PR que já consertou o defeito).

O canal é **UM módulo com um REGISTRO de fixers** (`FIXERS`, em
`pr-remedy-comment.mjs`): cada gate mecânico entra com o seu marcador, o seu nome
de job, o seu comando de `--fix` e a SUA medição (`--fixer <id>`, default
declarado). Um script por remédio divergiria na primeira correção que um
recebesse — e a reconciliação, a decisão e o tratamento de canal são justamente
onde isso dói. Depois do fixer do `bash -n` vieram o **`pipefail-sigpipe`**
(seção 20) e o **`doc-hashes`** (seção 30): o mesmo mecanismo, o mesmo `--dry-run`,
o mesmo ciclo.

**O REGISTRO É DESCOBERTO, não escrito à mão** (`scripts/pr-fixers.mjs`).
Enquanto o `FIXERS` morava dentro do publicador, um gate que já sabia consertar
(`--fix`) e produzir o PATCH (`remedyPatch`) ficava FORA do canal até alguém
editar aquele arquivo — e nada acusa essa regressão, porque um remédio que não
publica é indistinguível de um defeito sem remédio. Agora cada remendo é
declarado em **`scripts/remedy-canal/<id>.mjs`** (a prosa do comentário:
`marker`, `gateJob`, `titulo`, `achado`, `naoCobre`, `rodape`, e o `default`), e
a descoberta a casa com a **CLASSE de mesmo id** (`scripts/remedy-classes/`, a
mesma que o pre-commit oferece) — de onde saem o guard dono, o comando do `--fix`
e a `ordem`. O `id` é o NOME do arquivo nas duas pontas: um fixer novo entra no
commit em que as duas declarações existem, sem editar registro nenhum (é a
metade que a lista à mão não conseguia cumprir).

A régua morde nas DUAS direções, fail-closed: a declaração do canal sem a classe
de mesmo id (ou com um dono que não exporta `remedyPatch`) **não entra** e sai
nomeada em `CANAL_PROBLEMAS` — que o publicador transforma em **exit 2** (o PR
nunca é julgado por um canal incompleto); e o dono que SABE produzir o patch e
**não tem** declaração de canal também sai nomeado (senão ele ficaria fora do PR
em silêncio). O `default` do `fixerOf()` sem argumento é **declarado**
(`default: true` em exatamente UM fixer) — zero é "ninguém sabe qual é" e dois é a
escolha feita por ordem de arquivo, que muda entre hosts.

**Quem precisa só dos IDs não passa pela descoberta.** O `pr-fixers.mjs` é
assíncrono por natureza (`import()` de caminhos descobertos em runtime) e usa
top-level await; e um módulo com TLA que seja ALCANÇÁVEL a partir do grafo de uma
classe (`remedy-classes/<id>.mjs` → guard dono → `check-hook-ci-parity` →
`check-forge-parity`) fecha um ciclo com o `remedy-classes.mjs` (também TLA) e o
node sai **13** sem imprimir nada — o `pre-commit-remedy.mjs` do hook morre junto
(medido). Por isso o leitor dos IDs é uma FOLHA (`scripts/remedy-canal.mjs`), que
varre o diretório sem importar declaração nenhuma, e é ela que o
`check-forge-parity` consome na quinta regra (a cobertura do canal). Duas leituras
do MESMO diretório — a folha, no guard, e a descoberta, no publicador — e o teste
compara as duas.

O comentário é **RECONCILIADO** pelo marcador `<!-- run-syntax-remedy -->`: cria na
primeira vez, ATUALIZA quando o patch muda, não repete quando é idêntico (reescrever
gastaria uma chamada e mudaria a data do rodapé sem motivo) e **RETIRA** quando a
cicatriz some — o ciclo é fechado, não deixado aberto. Duplicata de dois runs
concorrentes é retirada. As **RECUSAS** (heredoc, forma dobrada `run: >`, arquivo de
shell, shell embutido) vão no MESMO comentário com o motivo de cada uma, e o
excedente do teto é CONTADO: um comentário que só mostrasse o patch diria que o
remendo cobre tudo o que o job achou. E o que NÃO foi medido (sem `bash`, arquivo
ilegível, YAML inválido) NÃO retira o comentário anterior: ausência de medição nunca
vira "não há nada aqui".

**Por que PATCH e não um "Apply suggestion":** o botão do GitHub/de Gitea só existe
em comentário de REVISÃO ancorado na linha do diff — e uma âncora errada aplicaria
uma edição ERRADA com um clique, silenciosamente. O patch se aplica IDENTICAMENTE
nas duas forjas. Os desfechos de canal são opostos de propósito: sem token, sem
número de PR ou sem forja reconhecida o canal não existe (`::notice::` e exit 0 — o
GATE é o veredito); 401/403 (token sem escrita: PR de fork) é `::warning::`; e 5xx
é publicação QUEBRADA: `::error::` e o passo falha.

**Como testar:** `src/lib/__tests__/check-workflow-run-syntax.test.ts` — leitura
dos corpos (escalar/bloco/vazio, e o `defaults: run:` fora), as duas metades da
máscara, o aviso do heredoc, o `unavailable` fail-closed (bash que não executa) e
os exit codes da CLI (1/2/3), a semântica do `shell:` (os três desfechos, a forma
CUSTOM julgada pelo nome, o `--shells` com a proveniência e o `--json` dos três)
e o `--fix` (o remendo gravado, as recusas com motivo, o arquivo INTACTO na
recusa e a gravação DESFEITA quando o corpo no disco não passa), além do
repositório inteiro. A **segunda fonte** tem testes próprios: o shebang como
declaração (`env` desembrulhado, `python3` pulado com motivo, sem shebang caindo
na premissa), o arquivo vazio nomeado, o escopo que NÃO desce em
`node_modules`/artefato, o aviso do heredoc contando num arquivo, o `--fix` que
recusa sem tocar no arquivo e o `--json` com os dois escopos no mesmo payload. O
recorte `--staged`
tem teste PRÓPRIO, contra um repo git REAL:
`src/lib/__tests__/check-workflow-run-syntax-staged-cli.test.ts` prova as DUAS
direções do escopo (corpo quebrado no índice reprova **mesmo** com a árvore já
corrigida; defeito só na árvore passa o recorte e o gate da árvore reprova o
mesmo repo) e o fail-closed fora de um repositório git.
O `--fix --dry-run` e o comentário do PR têm teste PRÓPRIO:
`src/lib/__tests__/check-workflow-run-syntax-dry-run.test.ts` prova as três
propriedades que fazem o patch valer como remendo — ele APLICA (`git apply` de
verdade num repo de verdade, e o arquivo passa a fazer `bash -n`), ele é **byte a
byte** o que o `--fix` gravaria em outro fixture idêntico, e ele **não grava nada**
(arquivo intacto) nem polui o STDOUT (só o patch; o relatório em STDERR) —, além de
a recusa continuar recusa no preview (exit 1) e do `--dry-run` sem `--fix` ser uso
inválido. `src/lib/__tests__/pr-remedy-comment.test.ts` prende o corpo (marcador,
patch, bloco de aplicação, recusas com motivo e o excedente CONTADO), a decisão pura
nas quatro respostas e o CICLO ponta a ponta contra uma API dublê — criar, não
repetir, atualizar e retirar —, com os desfechos de canal (5xx = erro, 403 =
`ChannelDenied`) e a resolução de `--pr`/`PR_NUMBER`/payload/`GITHUB_REF`.
O **fixer do SIGPIPE** tem os seus: `src/lib/__tests__/check-pipefail-sigpipe-remedy.test.ts`
prende o preview (o patch aplica pelo `git apply` **inclusive com o defeito no
MEIO do arquivo**, o arquivo fica byte a byte igual ao do `--fix`, NADA é gravado
e o STDOUT carrega só o patch), a FORMA do resultado nos DOIS fixers, o arquivo
que a varredura não conseguiu ler (sai nomeado, não vira "nada a remendar") e a
construção do diff no `unifiedPatch` (contexto, compressão, fusão de janelas, o
`\r` fora, o `\n` final que não cria linha vazia). E o registro de fixers é
medido no `pr-remedy-comment.test.ts`: marcadores PRÓPRIOS, `--fixer` escolhendo o
defeito (com o default intacto), id desconhecido sendo erro de uso, os dois
fixers no MESMO PR sem um tocar o comentário do outro, e cada um medindo pela SUA
régua.

**A DESCOBERTA do registro tem teste próprio**
(`src/lib/__tests__/canal-fixers-discovery.test.ts`): no repositório real, o
registro é o dos ARQUIVOS declarados e a leitura da folha (`remedyFixers()`)
concorda com ele — duas leituras do MESMO diretório não podem divergir; num
fixture, um fixer NOVO (declaração + classe + dono) entra com id, marcador,
comando, ordem e medidor, e o próprio módulo do registro não cita o id novo (quem
o faz entrar é o diretório); e cada campo tem o seu caso de recusa (marker que não
é comentário HTML ou repetido, `gateJob` vazio, `achado` que não é função,
`default` não-booleano, dois ou zero `default: true`, declaração sem classe, dono
sem `remedyPatch`, diretório vazio e ilegível).

**A prova de que ela MORDE** (`scripts/test-mutation-canal-fixers.sh`, matriz do
master): as SEIS metades são load-bearing — a varredura do diretório trocada por
ids literais (o fixer novo da bancada DESAPARECE: é o registro à mão de volta), a
exigência da classe de mesmo id (sem ela a declaração órfã some em SILÊNCIO), a
régua do dono (sem ela publica-se um fixer com o MEDIDOR indefinido), a direção
OPOSTA (o dono que sabe produzir o patch e não tem declaração não some calado), o
`default` único (sem ele o default vira ordem de arquivo) e o leitor folha (o
diretório ilegível devolvendo `[]`, isto é, "não consegui ler" virando "nenhuma
declaração"). O registro é medido POR EXECUÇÃO contra uma BANCADA (um repo
temporário fora do projeto), e o checksum do registro, do publicador e do leitor é
conferido no fim: o fixer novo entrou SEM EDIÇÃO — é isso que a suíte declara por
medição, não por prosa.
O **HOOK** tem prova por EXECUÇÃO, e não por leitura:
`src/lib/__tests__/pre-commit-run-syntax-blocks.test.ts` soma o `.husky/pre-commit`
REAL num repositório temporário com o defeito STAGED e exige o exit **VIOLATIONS**
(1) nomeando arquivo e linha — e o mesmo repo com o corpo são sai 0 **imprimindo a
manchete do guard no modo `--staged`** (é essa segunda metade que impede o falso
positivo: um hook que falhasse por "script não encontrado" também sairia não-zero).
O guard roda com o `node` real e o fecho transitivo copiado; o que é dublê está
DECLARADO (os irmãos de fase e o `bun` devolvem 0 — num repo temporário eles não
existem, e não são o assunto; e o desfecho do REMÉDIO é afirmável por um dublê,
`REMEDY_STUB`, porque no harness o stdin do hook é um pipe E a pergunta está
desligada por variável — o remédio real nunca sai 0 ali).
O MESMO harness prova o recorte de COMPOSE que o hook roda na fase A:
`src/lib/__tests__/pre-commit-compose-arg-removal-blocks.test.ts` monta um repo com
um build site de compose que PASSA o `BUN_VERSION` e comita esse estado (o HEAD de
que a remoção sai), depois tira o arg e pede o veredito ao hook REAL: exit não-zero
nomeando arquivo, linha e serviço, e o CONTROLE com o arg no lugar saindo 0 com a
manchete do guard no modo `--staged` (a segunda metade que desmente um não-zero por
ambiente). Duas mutações fecham a prova: sem a chamada ao guard do Bun no hook, e
sem a comparação ÍNDICE×HEAD no guard, o commit que APAGA o arg **passa**. O fixture
pede esse guard pelo `passthrough` do `pre-commit-proof.mjs` — nada muda no fixture
dos testes irmãos, e a cópia do guard é a do fixture (o repositório real nunca é
tocado). O MESMO harness prova a outra declaração que um commit pode APAGAR:
`src/lib/__tests__/pre-commit-toolchain-removal-blocks.test.ts` comita o
`package.json` com o `packageManager` alinhado ao `.actrc` e depois o remove — o
hook REAL sai não-zero nomeando o arquivo, o campo, a palavra `REMOVIDA` e o valor
declareado no remédio; o CONTROLE com o campo no lugar sai 0 com a manchete do
`--staged`, a árvore que re-adiciona o campo e esquece o `git add` NÃO engana o
veredito (o commit carrega a remoção), o arquivo NOVO não é julgado pela remoção
(não há de onde remover) e a linha TROCADA por outro valor reprova nomeando
`package.json:3`. As mesmas duas mutações fecham: sem a chamada ao guard no hook,
e sem o recorte registrado no guard, o commit que apaga a declaração **passa**.

O elo de BAIXO — o que o GIT faz com o exit code do hook — tem prova própria:
`src/lib/__tests__/pre-commit-git-commit-blocks.test.ts` roda um `git commit` de
VERDADE num repo temporário com `core.hooksPath` apontando para os hooks, e mede o
veredito no **OBJETO**: com o corpo `run:` quebrado no índice o commit falha e
`git cat-file --batch-all-objects` conta **ZERO objeto de commit** (só `commit` —
blobs e árvores do `git add` já existem e não são o que se promete), com o índice
intacto; o CONTROLE exige o commit **criado** (1 objeto) e a manchete do guard no
modo `--staged`, e o MESMO repo aceita o commit quando o defeito é corrigido — é
o que desmente uma recusa por ambiente (identidade, hooks, índice). Duas mutações
mostram o outro lado: sem a chamada ao guard e sem o `--staged` o defeito é
**COMMITADO** (o conteúdo do objeto é lido com `git show HEAD:`), e as DUAS
premissas que fariam a prova medir o vazio são medidas na direção contrária: um
`pre-commit` sem o modo 0755 é IGNORADO por git (o commit entra com o defeito — por
isso o fixture aplica o modo e o teste o confere) e um `core.hooksPath` apontado
para outro diretório faz git NÃO procurar o hook (também entra).
As provas do hook usam a MESMA régua: o **simulador** compartilhado
(`helpers/hook-simulator.ts` — repositório git temporário, dublê com passagem
declarada para o processo real e as medições no banco do git) e, sobre ele, uma
camada fina com as constantes de cada hook (`helpers/pre-commit-fixture.ts` traz
o guard, o remédio, o fecho e as linhas de comando do `.husky/pre-commit`) — uma
cópia por prova divergiria no dia em que uma delas fosse ajustada.
O **`pre-push`** tem prova de EXECUÇÃO na mesma máquina
(`src/lib/__tests__/pre-push-git-push-blocks.test.ts`, sobre a camada
compartilhada `scripts/pre-push-proof.mjs` — o MESMO módulo de onde o doctor
executa `provePushBlocks()` para publicar o fato): um `git push` de verdade
para um remoto **bare**, com `core.hooksPath` apontando para os hooks, e a
promessa medida do outro lado — o git consulta o remoto ANTES de rodar o hook e
só manda o pack DEPOIS dele, então o que se mede é o que CHEGOU. Typecheck
reprovando (o defeito é o CONTEÚDO versionado, `ERRO_DE_TIPO` no `src/foo.ts` do
fixture) ⇒ o push falha, o hook morre antes do sentinela e o remoto fica com
**zero ref e zero objeto** (`refsOf`/`countObjects`); a árvore verde ⇒ o ref
`refs/heads/main`, o conteúdo e o sentinela chegam, e o MESMO repo aceita o push
quando o defeito é corrigido (o que desmente uma recusa por ambiente). O que é
REAL e o que é dublê é declarado: `bun run typecheck` roda o binário de verdade e
o `package.json` do fixture aponta o script para um payload que REGISTRA cada
invocação (é o rastro que prova que o processo rodou — o CONTROLE conta 2, a fase
2 e o fast path), enquanto o runner dos encoding guards e o `curl` do advisory do
Lighthouse são funções que devolvem 0 e 1. SEIS mutações provam as metades: o
**gate do typecheck** (M1 com a fase 2 removida — o fast path tem de segurar; M1b
com a fase 2 removida E o fast path de volta à forma que engole — o defeito entra;
e M1c sem invocação NENHUMA — o defeito entra sem veredito), o `hooksPath` para
outro diretório (o hook não é procurado), o hook sem o modo 0755 (git o ignora em
silêncio) e o dublê **deixando de liberar** o processo real (a árvore vermelha
passa e o payload nunca roda — é a passagem que torna o veredito o do comando,
não o de um dublê).

**O veredito é do COMANDO, não do FILTRO (o `| head` que engolia).** No fast path
do smart-skip o typecheck rodava como `bun run typecheck 2>&1 | head -5` e, numa
pipeline, o status é o do ÚLTIMO comando: o `head` devolvia 0 com o tsc
**REPROVANDO**, então aquele gate era um **no-op** — o push levava a árvore
vermelha para a forja. Agora a saída é CAPTURADA (`if ! TYPE_OUT=$(bun run
typecheck 2>&1)`) e o recorte do `head` sai por **HERESTRING**
(`head -5 <<< "$TYPE_OUT"` — sem pipe, logo sem produtor vivo para levar SIGPIPE,
a mesma régua do `check-pipefail-sigpipe`), com o `exit 1` bloqueando. A
invocação CANÔNICA da fase 2 segue numa linha própria — é ela que o
`check-hook-ci-parity` lê como "o hook roda o typecheck do CI".

**O veredito MUDOU, e a mutação mede o NOVO:** **M1** (a fase 2 sai) deixou de
abrir o buraco — o fast path SEGURA o defeito, e o que se assere é o push
RECUSADO com zero objeto no remoto, citando a reprovação do payload E o fast path
como o caminho que correu (defesa em profundidade). **M1b** isola a FORMA: o único
delta contra M1 é voltar o fast path à pipeline que engole, e o resultado
INVERTE — o conteúdo vermelho chega ao ref do remoto com o rastro da reprovação no
log. **M1c** preserva o sujeito original (o gate do typecheck é load-bearing): sem
NENHUMA invocação — fase 2 e fast path — o defeito entra sem veredito nenhum sobre
a árvore.

⚠️ **Achado medido, DECLARADO no próprio hook (não consertado neste passo):** a
linha dos testes afetados (`bun run vitest run --reporter=verbose $AFFECTED_TESTS
2>&1 | tail -5`) carrega o MESMO defeito de veredito — o `tail` devolve 0, então
uma suíte afetada VERMELHA não bloqueia o push. O conserto é a mesma captura, e
ela moveria a invocação para dentro de um `$()`: o `check-hook-ci-parity` declara
esta linha por regex **ANCORADA** em `^bun run vitest…`, e sem a âncora o
invariante `tests` sumiria do inventário do hook (o guard passaria a exigir uma
declaração de "não roda" para um comando que roda). O fecho copiado são os `.mjs` — e, com eles, o **`node_modules` real do
repositório** (link no fixture, não `NODE_PATH`): o `require` do guard resolve
pelo diretório do próprio arquivo, e sem o parser de YAML TODO workflow passa a
NÃO JULGÁVEL (exit 2), de modo que o veredito medido seria do fixture e não do
defeito. Não é presumido: a premissa LÊ os especificadores não relativos do fecho
no próprio fonte e MEDE, num `node` real com o diretório do fixture, que cada um
resolve e que o parser de fato parseia — uma dependência nova entra nessa conta
sozinha, em vez de degradar o guard em silêncio. QUATRO mutações provam as metades que a leitura não vê: deixar de CHAMAR o
guard e perder o `--staged` (esta última sobre o defeito que só o ÍNDICE carrega,
o commit que a árvore consertada esconde); e, na metade do remédio, deixar de
CHAMAR o remédio (o commit continua bloqueado — o remédio é conveniência, não o
caminho do bloqueio) e perder o **veredito do gate** (aí o commit com a cicatriz
entra: é o bloco que reergue a falha do guard). Cada mutação exige, além de
`mutado !== original`, que o hook mutado **ainda faça parsing** (`bash -n`): uma
mutação que quebrasse a sintaxe do hook sairia vermelha por PARSING, não pelo
veredito que ela mede. O mesmo arquivo exercita o remédio DENTRO do hook nas DUAS
direções: com a cicatriz no índice e a pergunta **desligada** (o simulador liga
`PRE_COMMIT_REMEDY_NO_PROMPT` — um teste não pode depender de alguém responder um
prompt), o hook sai 1, **não pergunta** e imprime o caminho à mão, nomeando a
variável como o motivo; e com o remédio AFIRMADO como exit 0 (o dublê afirma o
desfecho sem remendar nada) o hook **não acredita nele**: o gate é reexecutado
sobre o índice que continua com a cicatriz e o commit segue BLOQUEADO. A direção
oposta — o remédio de verdade remendando e o commit ENTRANDO — é medida sob um pty
de verdade, porque é lá que existe terminal para responder.

`src/lib/__tests__/pre-commit-remedy.test.ts` é a prova do REMÉDIO, com
o caminho INTERATIVO exercitado pela função (deps injetadas — num subprocesso o
stdin nunca é um terminal): "sim" com arquivo limpo remenda, re-estagia e revalida
o ÍNDICE (exit 0); "não" e resposta vazia não tocam em nada; sem cicatriz
remendável **não pergunta**; índice verde sai 0 sem remendar; WIP na árvore faz o
`git add` ser RETIDO (o WIP não sobe para o commit e a árvore fica remendada);
a árvore DESLOCADA faz o fixer recusar sozinho; a **fonte da resposta** tem teste
próprio com o terminal injetado (stdin não-terminal + `/dev/tty` pergunta ali;
`openTty` devolvendo `null` mantém o bloqueio; **SEM RESPOSTA no teto** assume NÃO;
a variável de desligamento não abre o `/dev/tty`; e o stdin-terminal tem
PRECEDÊNCIA, sem abrir o dispositivo); e a CLI prova o contrato do exit code
(usage 3, infra 2, o `--help` e o **SEM TERMINAL** — medido numa sessão PRÓPRIA,
sem terminal de controle). O mesmo arquivo pina a **premissa do hook**: a linha
exata da chamada, a ORDEM (as duas fases medem antes da pergunta; o gate e a fase
voltam a rodar depois dela) e a integridade da função `fase_b` (os nove comandos
da fase B dentro dela — um guard que ficasse de fora faria a reexecução medir outra
fase).

**As classes mecânicas têm prova por EXECUÇÃO contra os guards de verdade:**
`src/lib/__tests__/pre-commit-remedy-classes.test.ts` monta repositórios git reais
com os guards de encoding copiados e o remédio de verdade. Ele mede o que um teste
de leitura não vê: o PARSE da lista de ofensores é pinado contra a saída do guard
dono (a classe `crlf` pelo `  - <path>` do `check-crlf.sh`, a `utf8` pelo `WOULD
FIX:` do `--fix --dry-run`); o "sim" leva o conteúdo remendado ao **ÍNDICE** (o
blob muda de fato: CRLF → LF, byte 0x97 → em dash), não só ao disco; o "não" não
toca em nada; as classes que se SOBREPÕEM levam o arquivo ao índice UMA vez e não
o acusam de retido; a classe que ESTAGIA POR CONTA PRÓPRIA se **retém** com WIP
(e o fixer dela não roda); UTF-8 inválido que o fixer NÃO remenda não vira "nada
remendável" (segue bloqueado, com o motivo, sem pergunta); o APAGAMENTO da
declaração de espelho é restaurado da HEAD, levado ao **ÍNDICE** e o guard dono
rodado de verdade (`--staged`) revalida verde — com a **âncora ambígua** bloqueando
sem pergunta e a **divergência** (valor trocado, sem apagamento) ficando FORA desta
classe, nomeada pelo veredito do próprio guard; uma classe
**não aplicável** (fixture sem os guards) não roda o guard do repositório de quem
executa — mediria OUTRA árvore; e SEM TERMINAL o caminho à mão sai com o `--fix`
E o `git add` **de cada classe**.
**Prova por mutação:** `scripts/test-mutation-workflow-run-syntax.sh` (roda NO
JOB, depois do gate real, e também como sub-test da matriz do master) **declara 15
metades** no bloco `METADES` do próprio script — a descrição de cada uma sai de lá
(é o master que a deriva, e o `check-mutation-count` confere a doc contra ela).
(A) SENSIBILIDADE — o guard REAL reprova as fixtures de defeito e passa
no corpo são: `if` sem `fi` (ERRO, citando arquivo e linha), heredoc sem terminador
(AVISO: o script MEDE que o `bash -n` sai **0** e só avisa — um gate que olhasse
só o exit code o aprovaria) e o defeito entre DUAS expressões do runner (prova
que a máscara para no primeiro `}}`). (B) MUTAÇÃO DO PRÓPRIO GUARD, aplicada no
lugar com backup e restauração VERIFICADA por checksum: matar a metade do AVISO
(`ok` só pelo exit code) CEGA o guard no heredoc e nada mais; tirar o corpo do
STDIN do `bash -n` CEGA todas as classes (o bash julga um programa vazio);
tornar a máscara GULOSA (`[^}]*` → `[\s\S]*`) engole o defeito que estivesse
entre duas expressões e CEGA o guard também; ler a **ÁRVORE** onde o recorte
deve ler o **ÍNDICE** CEGA o pre-commit (o commit com o corpo quebrado passa
porque o editor já consertou o arquivo — e só o recorte o pegaria); aceitar
qualquer nome como **presente na imagem** CEGA a metade semântica (o passo com
`shell: pwsh` passa com a headline de sucesso); e remover a **guarda do corpo
vazio** no `--fix` CEGA o fixer de um jeito que se paga no gate — ele grava um
corpo vazio, o vazio deixa de ter sintaxe a julgar e o passo que já não roda nada
sai como ✅; tirar a **segunda fonte** (a varredura dos arquivos de shell) CEGA o
gate para o script quebrado — que passa a sair com a headline de sucesso contando
os arquivos que NÃO julgou; forçar `isBashShell` a `true` julga o passo python
legítimo (o corpo do fixture é `print(1)`) e o gate **ACUSA quem não tem defeito**
— a assinatura INVERSA das outras mutações: não é cegueira, é violação FALSA, com
o pulo nomeado desaparecendo do relatório; e tirar a **decisão do ARQUIVO**
(`if (!isBashShell(interp.command))` → `if (false)`) faz o mesmo com o outro lado
da régua — um `.sh` que declara `#!/usr/bin/env python3` é legítimo no
interpretador DELE e inválido para o bash, e julgá-lo inventa uma violação para um
arquivo são (o relatório acusa citando `interpretador: python3`, e o repositório
perde a única classificação que distingue "script de outra linguagem com nome
`.sh`" de "script bash quebrado"). Essa é a **simetria** da anterior: o `shell:`
de um passo e o SHEBANG de um arquivo são a mesma decisão com FONTES diferentes —
uma mutação muda a função (que atende os dois), a outra muda só a decisão do
ARQUIVO, e cada uma exige a outra metade VIVA ao lado (o passo não-bash segue
pulado e nomeado; o arquivo bash quebrado segue reprovado). Cada mutação é
CIRÚRGICA — as outras metades seguem mordendo — e o script exige que o veredito
MUDE: um mecanismo que, mutado, não muda nada é decoração e falha o PR (exit 1).
As DUAS mutações do pulo nomeado (o passo e o arquivo) têm **duas testemunhas**
cada: o gate por EXECUÇÃO (node-puro, sempre roda) e a **suíte unitária**, que tem
de ficar VERMELHA — ela roda quando o `vitest` está instalado e, onde não está, o
script DIZ que não julgou essa metade (uma testemunha vermelha por ambiente
"mataria" o mutante, e o teste passaria por engano). (Medido: remover
a máscara por inteiro **não** muda o
veredito — `bash -n` aceita `${{ ... }}` —, por isso a mutação da máscara é o seu
LIMITE, não a sua ausência.)

---

## 7. Segredos — `audit-secret-leaks`, `check-secret-leaks-baseline`, `rotate-secrets`

**O que protege:** segredos NÃO entram no histórico (rotina de rotação);
QUALQUER achado NOVO falha o job semanal — o gate já cobre TODOS os de
severidade ALTA (chaves privadas, tokens sk-*), que era o pedido do parecer.

**Por que existe:** um segredo commitado uma vez fica no histórico para sempre
(filter-repo + rotação são operações deliberadas). O baseline documenta os
vazamentos JÁ conhecidos
(`docs/security/secret-leaks-baseline.json` — **o número vive no arquivo, nunca
nesta prosa**: ele é derivado, e `--update` o regenera); o guard
protege o FUTURO comparando por **assinatura de conteúdo**
(`arquivo:linha:padrão:chave:valor-mascarado` — o **commit NÃO entra**). O commit
fica no baseline só como **proveniência**, e quando ele deixa de ser alcançável
o guard reporta isso como **motivo próprio** no relatório, em vez de acusar os
achados conhecidos como NOVOS — antes, com o commit dentro da assinatura, um
rebase/filter-repo transformava o baseline inteiro em "assinatura desconhecida"
e só um `--update` apagava o sintoma (destruindo a evidência de que a história
tinha mudado).

A proveniência ausente tem **quatro** estados, e dois deles são separados de
propósito: `intacta` (todo commit do baseline alcançável), `indeterminado` (não
deu para listar — git ausente), `reescrita` (história reescrita / branch apagado)
e **`raso`** — o mesmo fato num **clone raso** (`git rev-parse
--is-shallow-repository` = true). Eles não se colapsam porque a AÇÃO é outra: um
manda rodar `git fetch --unshallow`, o outro manda procurar o filter-repo.
Colapsar os dois faria o relatório mandar caçar uma reescrita que nunca
aconteceu — diagnóstico errado é pior que diagnóstico ausente, porque é seguido.
**Nenhum dos quatro falha o gate:** o que falha é conteúdo novo, e só isso.
NOTA (parecer 08/2026): a premissa "hoje gateia só
o total" era FALSA — o guard já falhava em qualquer achado novo por
assinatura, não por count. Por isso o job semanal roda o DEFAULT (falha em
tudo, incluindo alta) e NÃO usa `--min-severity alta` (isso ENFRAQUECERIA o
gate, deixando novos de severidade média passar). A classificação de
severidade (alta/média) existe como OPÇÃO de relaxamento deliberado:
`node scripts/check-secret-leaks-baseline.mjs --min-severity alta`.

**Onde roda:** job semanal (benchmark-weekly.yml, gate default), manual
(auditoria), operação de rotação (scripts/rotate-secrets.mjs).

---

## 8. Hook symmetry / README tabela — `check-hooks-symmetry`, `check-encoding-guards-badge`

**O que protege:** a tabela do README (Git Hooks / Encoding Guards) bate com o
conteúdo REAL do `.husky/pre-commit` e `.husky/pre-push` — nos dois sentidos
(guard sem linha na doc E linha da doc sem guard real).

**Por que existe:** guard novo adicionado sem atualizar a doc = devs não sabem
que o guard existe; linha stale = doc promete proteção que não existe.

**Onde roda:** pre-commit, pre-push, CI.

**`check-hook-ci-parity` (`scripts/check-hook-ci-parity.mjs`) — o veredito LOCAL e o do MERGE não
podem divergir.** A tabela do README prova que o guard está **documentado**; este
prova que ele roda o **MESMO COMANDO** do CI. Para cada comando que
`.husky/pre-commit` e `.husky/pre-push` executam, o guard **resolve a entrada do
package.json** (`bun run X` → o script real) e compara com o comando **canônico**
do invariante do CORE — a MESMA fonte que o `forge-doctor` usa (`inv.command`).
Três desfechos:

- **mesmo-comando** — não precisa declaração: não existem dois comandos para
  divergir;
- **recorte** — o MESMO instrumento com outro escopo (`--staged`), que exige
  **decisão escrita** em `HOOK_DECLARED`;
- **local** — o CI não roda, ou roda por outro caminho (um reusable), que também
  exige decisão.

Na direção oposta, todo invariante do CORE que o hook **não** roda precisa estar
em `HOOK_NOT_RUN` com a razão: um gate novo do contrato de merge não pode entrar
sem que alguém decida se o hook o executa. Reconhecer o recorte tem duas metades
e o guard cobra as duas: o **instrumento** (`subjectOf` — outro script/binário é
**outro gate**, não um recorte) e a **razão** (um `why` de menos de 40 caracteres
não é decisão).

**4. O SUB-GUARD DE UM RUNNER.** Quando o comando que a pipeline escreve é um
**RUNNER** (`bash scripts/x.sh`), tudo o que ele executa **por dentro** ficava sem
dono: nem o hook, nem `HOOK_NOT_RUN` (que fala dos invariantes do CORE, uma lista
declarada). O guard deriva das **duas pipelines** os runners que elas chamam
(resolvendo a entrada do package.json: `bun run test:mutation-guards` →
`bash scripts/test-mutation-guards.sh` — sem isso o runner mais pesado do
contrato nem apareceria) e **desce** neles com a **mesma régua** do
`check-hook-commands` (`SHELL_INTERPRETERS`, `alvosProvaveis`, `variaveisDoArquivo`,
`MAX_SCRIPT_DEPTH` — o ciclo de imports entre os dois é de módulo, não de
execução, e está declarado no guard). Todo arquivo alcançado exige **decisão
local**, e as três formas são medidas: (a) o **hook o executa** — inclusive
**pela descida**, porque o hook também chama runners (`run-encoding-guards.sh` →
`check-utf8.sh` → `check_utf8.py`/`.mjs`); (b) o invariante do CORE dele está em
`HOOK_NOT_RUN`; (c) a ausência está escrita em `RUNNER_SUBGUARD` com a razão (e a
declaração **stale**, que não casa com sub-guard nenhum, é violação).

**A leitura do alvo é a da CLASSE, não a da FORMA.** Os **valores** da descida já
vinham da régua do dono (`alvosProvaveis`), mas **quem era runner** era lido inline
e por forma — `!alvo.endsWith(".sh") || alvo.startsWith("/") ||
`alvo.includes("$")`na derivação das pipelines,`tokens[1]?.endsWith(".sh")`na bateria local e`alvo.endsWith(".sh")` na recursão. A classe do alvo (`classeDoAlvo`, a mesma do
veredito) passou a decidir quem desce — e o que não dá para provar sai **nomeado**
com a classe (ou com o motivo do flag). Medido em fixture, nos dois sentidos:

| alvo na pipeline                   | antes                                                 | depois                                                        |
| :--------------------------------- | :---------------------------------------------------- | :------------------------------------------------------------ |
| `bash scripts/runner.sh`           | runner, desce                                         | igual                                                         |
| `bash scripts/runner` (sem sufixo) | **invisível** (nem runner, nem limite)                | runner, desce (o shebang confirma que dá para ler como shell) |
| `bash -u scripts/runner.sh`        | **invisível** (o `-u` era lido como o alvo)           | runner, desce                                                 |
| `bash -n scripts/runner.sh`        | invisível                                             | limite nomeado: “o `-n` só CONFERE a sintaxe”                 |
| `bash scripts/*.sh`                | runner `scripts/*.sh` + limite “o arquivo não existe” | limite nomeado com a CLASSE: “padrão, não um caminho”         |
| `bash /opt/tool.sh`                | invisível                                             | limite nomeado: “caminho absoluto, fora do repositório”       |
| `bash "$RUNNER"` (não atribuída)   | invisível                                             | limite nomeado: “a variável `RUNNER` não é atribuída aqui”    |

No repositório de hoje as duas réguas dão o **mesmo** conjunto (12 runners, 9
sub-guards, 40 arquivos de bateria local — nenhum alvo sem sufixo, nenhum com flag
antes do arquivo, nenhum glob): o que muda de fato é o **motivo** de um dos dois
limites — o `bash -n "$TMP_DIR/b-heredoc.sh"` acusava o alvo de “não ser um arquivo
do repositório” (o arquivo está ali, atrás do flag) e passou a dizer que o `-n` só
confere a sintaxe.

**O idioma do `SCRIPT_DIR` deixou de ser um limite.** A régua de caminho
(`check-hook-commands`, a mesma para toda descida) passou a ler o idioma com que
os scripts da casa chegam na **raiz** — `SCRIPT_DIR="$(cd "$(dirname "$0")/.."
&& pwd)"` — e o alvo `node "$GUARD"` que sai dele; e a leitura da atribuição
passou a parar no **primeiro word** (o shell corta o valor no primeiro espaço não
citado: `GUARD="$GUARD" ALVO="$1" python3 …` atribui `"$GUARD"`, não a linha
inteira), com a **auto-referência** (`GUARD="$GUARD"`, o prefixo de ambiente de
uma linha) não acrescentando valor nenhum. Medido no repositório: os limites
da descida caíram de **18 para 2**, os arquivos alcançados subiram de **2 para
9**, e os **dois** que sobraram são os bloqueios que não são idioma — a variável
de laço do master (`${rest#*|}`, montada em runtime) e o `bash -n` sobre um
arquivo **temporário**. Nenhum dos nove segue sem decisão: seis pelas regras (a)
e (b) e **três pela tabela** (`RUNNER_SUBGUARD`: o `audit-blob-crlf-history.sh`,
que varre o HISTÓRICO e não o commit, o `check-jsdom-baseline.mjs`, que mede a
ÁRVORE inteira, e a **régua das metades** `metades.mjs`, que não é gate nenhum —
é biblioteca pura, executada pelo master de mutação e pelo `check:mutation-count`,
e nenhum dos dois roda no hook) — os dois primeiros eram **invisíveis** enquanto
o idioma não era lido, e o terceiro **apareceu** quando a descida passou a
alcançá-lo (o guard acusou o próprio repositório antes de a tabela existir).

**O que a descida NÃO consegue provar sai nomeado** (`limitesDaDescida`, impresso
no relatório e no `--json`): os bloqueios que restam, cada um com o motivo. Um
limite que ninguém lê não é limite declarado — e o dia em que um sub-guard não
for alcançado localmente, ele acende nomeando o arquivo, o runner e o comando do
CI que o executa.

**Por que existe (o caso real):** `.husky/pre-push` rodava `bunx tsc --noEmit` —
**sem** o heap de 4GB que o script `typecheck` carrega. Os dois lados citavam "o
typecheck" e tinham **réguas diferentes**: o mesmo commit estourava a memória no
push (SIGABRT, exit **134**) e passava no merge. O hook existe para **antecipar**
o veredito do CI; com duas réguas ele antecipa **outro** veredito, e o sintoma
("passou aqui e quebrou lá") aponta para o commit, não para a divergência.

**O que NÃO promete:** um recorte declarado continua sendo um recorte — o hook
mede **menos** que o CI (`--staged` vê o índice, não a árvore inteira). A
declaração não iguala os vereditos; torna a **diferença visível e revisável**, que
é o que uma decisão de escopo precisa ser.

**A QUARTA REGRA, DERIVADA — projeto nomeado, ainda não implementado.** O
recoverado da pilha de 19/09 (minerado do dump `.tmp/stash-19-09-completo.diff`
em 25/09/2026) declara a regra que falta: todo guard que as **DUAS pipelines
executam** tem de ter uma decisão LOCAL — bateria (o hook o roda, ou recorte em
`HOOK_DECLARED`), ausência declarada (`HOOK_NOT_RUN`) ou isenção com razão
(`NOT_A_GATE`). O domínio dela é **derivado por INSTRUMENTO** (`subjectOf`), não
por interseção de texto — é o que a pega o guard que evita a convenção de nome
(`bash scripts/verify-x.sh`) e o mesmo instrumento em formas diferentes (`bun run
db:generate` na forja, `bunx prisma generate` no espelho). Medido em 25/09/2026:
a interseção literal das duas pipelines tem **43 comandos comuns**, e **25
instrumentos** deles não têm linha de hook hoje — implementar é classificar os
25 (bateria/ausência/não-gate) e declarar as isenções de infra (`setup-bun-ci.sh`,
`bun install`, o prisma nas duas formas, o comentário do remédio). O teste
derivado da regra (13 casos, entre os artefatos minerados) é o contrato a
desenvolver; a suíte exige que a derivação nunca seja MENOR que a interseção
literal (anti-vacuidade).

**Prova por mutação:** `bash scripts/test-mutation-hook-ci-parity.sh` — sub-test
`hook-ci-parity` do master `mutation-guards`. Nove mutações, cada uma
exigindo a asserção da **própria regra** e medindo as irmãs (as linhas do
relatório não podem encolher: um guard que aborta cedo também "falha", só que
por não ter medido):

| Mutação | O que volta                                                                | Detecção                                                                                                                                                             |
| ------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A       | `bun run typecheck` → `bunx tsc --noEmit` nos dois hooks (a segunda régua) | **dupla**: o comando não é o do CI **E** o invariante `typecheck` fica sem cobertura                                                                                 |
| B       | comando novo no hook sem entrada em `HOOK_DECLARED`                        | 1 violação, nomeando o comando                                                                                                                                       |
| C       | `why` de um recorte esvaziado                                              | 1 violação "SEM razão escrita"; o recorte segue reconhecido como o MESMO instrumento                                                                                 |
| D       | `match` de uma entrada que não casa com comando nenhum                     | 2 violações: a declaração **stale** e o comando que perdeu a decisão                                                                                                 |
| E       | id removido de `HOOK_NOT_RUN`                                              | 1 violação: gate do CORE que não roda em lugar nenhum                                                                                                                |
| F       | `HOOKS` aponta para um hook inexistente                                    | 1 violação (fail-closed: não se varre o que não se leu)                                                                                                              |
| G       | um runner da pipeline passa a executar uma sonda que existe                | 1 violação nomeando o sub-guard, o runner e o comando do CI que o executa                                                                                            |
| H       | a descida do lado **local** deixa de acontecer (o hook "para" no runner)   | 2 violações: os dois sub-guards do `check-utf8.sh` perdem a decisão local (as "executado direto" seguem de pé: elas não passam pela descida)                         |
| I       | um runner **SEM sufixo `.sh`** entra na pipeline executando uma sonda      | 1 violação nomeando o sub-guard e o runner — e, com a leitura por **FORMA** de volta no guard, o MESMO defeito passa **verde**: a classe é o que sustenta o vermelho |

A árvore é restaurada por backup + `trap` (nunca `git checkout`) e conferida por
`cksum` contra o hash de origem — um mutation test que deixa o worktree sujo é
pior que nenhum.

**Onde roda:** pre-commit (~0.05s, node puro, na fase paralela) e as **duas**
pipelines — job `guards` da forja (dona do merge) e `workflow-refs-guard` do
espelho.

---

## 9. Sentinel / producer — `check-sentinel-producer`, `validate-all-text-alert`

**O que protege:** todo sentinel grepeado nos workflows (`grep -Fq '...'`) tem
o sentinel correspondente no produtor (script/python que o emite); o fluxo do
alerta é reproduzível num script único.

**Por que existe:** workflow que grepa um sentinel que o produtor não emite =
job sempre falha ou nunca detecta — drift silencioso entre produtor e
consumidor.

**Onde roda:** CI, local (validate-all-text-alert.sh).

---

## 10. Performance / benchmark — `check-tier1-fastpath`, `check-tier2-cache-restore`, `bench-*`, `run-benchmark`, `audit-playwright`

**O que protege:** o setup-bun mantém o fast path (tier-1, imagem custom com bun
embarcado) — regressão de tier (cache/download) falha o guard; benchmarks de
startup/encoding rodam em cron com limiar.

**Por que existe:** a otimização de startup (imagem ubuntu-bun vs catthehacker)
é uma decisão medida; sem guard, um bump de imagem poderia reverter o ganho
silenciosamente. Benchmarks também medem o overhead dos próprios guards (para
manter o hook <1s).

**Onde roda:** cron (benchmark-weekly.yml), CI (tier1-fastpath-guard em PR que
toca Dockerfile/setup-bun).

**`bench:guard-timing` (`scripts/bench-guard-timing.mjs`)** — benchmark de
wall time do doctor (perfil --ci), de CADA guard individual, do **custo das TRÊS
unificações de régua** — o lint, o typecheck (o comando inteiro, com o heap,
dentro do script) e a suíte de testes (`bun run test:run`, que INCLUI
`src/components/**`) — e do **custo da oferta de remendo no pre-commit** (a
família `hook`). Mede o tempo real de execução de cada gate da bateria
(18 guards), do doctor e das formas de cada família (a régua de hoje, a régua
anterior e a metade nova isolada), registra em JSON versionado
(`docs/benchmarks/guard-timing-{latest,baseline}.json`) com commit hash +
timestamp + as características da MÁQUINA (cpus, RAM, heap default do node — um
wall time sem elas não é comparável entre runners), e compara contra um baseline
com limiar de 20% para detecção de regressão.

**Por que existe:** a suíte do doctor e a bateria de guards são os gates que
decidem o merge. Uma regressão de tempo nelas afeta CADA PR — mas sem
medição versionada, a degradação é impressão, não dado comparável entre
commits. O benchmark transforma o wall time em dado estruturado: cada guard
tem o seu tempo, o doctor tem o seu, e a comparação nomeia QUAL guard
piorou e de quanto.

**Custo da unificação do lint — medido, não impresso:** desde `eefc6408` o
`lint` deixou de ser `eslint .` (sem prettier, sem teto de warnings) e passou a
ser o par completo (`bun run lint`), que as DUAS forjas invocam. Quatro call
sites passaram a pagar a metade que não pagavam — o `lint` da Gitea, o `lint` do
`ci.yml` do GitHub, o passo `Lint` do job `check` do `pr-check.yml` e o
`release-deploy`; o `lint-guard` do MESMO `pr-check.yml` já rodava o par inline
(era a única fonte da régua) e por isso não entra na conta. Medido em `eefc6408`
com 3 amostras por forma (mediana alta):

| forma medida                                     | wall time  |
| ------------------------------------------------ | ---------- |
| par completo (`bun run lint`)                    | 52.3s      |
| régua anterior (`eslint .`)                      | 31.5s      |
| **acrescentado por call site**                   | **+20.8s** |
| **acrescentado por rodada de CI (4 call sites)** | **+83.3s** |
| `prettier --check` isolado (a metade nova)       | 20.9s      |

O número VIVO é o do JSON versionado
(`docs/benchmarks/guard-timing-latest.json`, seção `lint`), refeito a cada
execução do benchmark — a tabela acima é a leitura da rodada registrada. O delta
por call site variou entre **20,1s e 20,8s** em rodadas da mesma sessão, na mesma
máquina: é essa a resolução do instrumento, e por isso o que a conta afirma é a
ORDEM de grandeza (a metade do prettier), não o décimo de segundo.

A ATRIBUIÇÃO é conferida pelo próprio script: se o delta medido não fechar com a
metade nova (tolerância de 10%, campo `attributionMatches`), o número tem outra
causa e o relatório diz que NÃO confere — em vez de apresentar o total como
preço da unificação. Dois fatos que sustentam a conta são MEDIDOS, não
presumidos: a lista de call sites vem dos próprios workflows (`runCommands`
sobre os diretórios da fonte única `forge-workflows`), e cada arquivo declarado
como pagante é provado contra ela; e a régua laxa não pode aparecer em workflow
nenhum — se aparecer, a unificação está incompleta, o delta tem mais de uma
causa e o relatório lista a violação.

**Custo da unificação do typecheck — medido, e ele NÃO é wall time.** Desde
`2f85d803` o `typecheck` é UM comando nas duas forjas e no veredito local: o
comando INTEIRO (o `tsc` com o heap de 4GB) vive no script `typecheck` do
package.json. Antes, o heap era um `env: NODE_OPTIONS` inline em QUATRO
workflows, e o hook de push rodava `bunx tsc --noEmit` SEM o heap. A medição
separa as duas metades da pergunta — e a resposta muda de sentido entre elas:

| forma medida (FRIA: o cache do tsc é removido antes de cada amostra) | wall time |
| -------------------------------------------------------------------- | --------- |
| script de hoje (`bun run typecheck`, heap 4096MB no script)          | 24.3s     |
| heap INLINE em `env:` (contrafactual dos 4 workflows)                | 24.2s     |
| **acrescentado por call site (4 pipelines)**                         | **+0.1s** |
| sem heap nenhum (`bunx tsc --noEmit` — a régua que só o hook tinha)  | 24.2s     |

O que a unificação acrescentou de wall time nas pipelines é **ruído**: o
MESMO comando com o MESMO heap — ela moveu um VALOR, não trabalho. O que ela
acrescentou no **hook** (`.husky/pre-push`) foi o **heap**, e isso só muda algo
onde o default do node NÃO basta: o default vem da RAM da máquina. Por isso o
relatório mede os dois — o heap default do node (aqui: **4144MB**) e o exit code
da régua sem heap (**0 = COMPLETOU**) — e diz **INDETERMINADO** para o SIGABRT
134 do runner em vez de afirmá-lo: a régua sem heap completa nesta máquina e
morre naquela, e um número que só vale numa delas não pode ser publicado como
fato do repositório. Em qualquer das duas, o hook roda o comando canônico: é
essa a asserção que o benchmark prende.

**Custo da unificação da suíte — medido, e o sinal é NEGATIVO.** Desde
`2f85d803` as duas forjas rodam `bun run test:run` (config do app, que INCLUI
`src/components/**`); o check EXIGIDO do GitHub rodava `bun run test:unit`
(config unit, que EXCLUI `src/components/**`) — o lado mais FRACO do par era o
que decidia o merge no espelho. A conta, medida em 16/09/2026 nesta máquina
(16 cpus, 32GB, sem contrafactual nenhum presumido):

| forma medida                                | wall time   |
| ------------------------------------------- | ----------- |
| suíte completa de hoje (`bun run test:run`) | 131.5s      |
| metade nova isolada (`src/components/**`)   | 17.9s       |
| régua anterior (`bun run test:unit`)        | 433.5s      |
| **acrescentado por rodada (1 call site)**   | **−302.0s** |

O job que upgrade não ficou mais caro: ele ficou **302s mais BARATO**, apesar de
passar a rodar 781 testes a mais. O que explica o sinal não é o escopo (a metade
nova custa 17.9s) e sim a CONFIG: o `vitest.config.unit.ts` roda com
`maxWorkers: 1` e o config do app com `maxWorkers: 4` — o delta tem mais de uma
causa, e por isso a atribuição é reportada como **NÃO conferida**
(`attributionMatches: false`, 1786% de diferença) em vez de a suíte de
componentes levar o crédito. É o exemplo exato do que a conferência existe para
pegar: sem ela, o número publicado diria "+17.9s" e a realidade é "−302s".

O **contrafactual da suíte** roda com `maxWorkers: 1`: são ~7min sozinho, e ele
NÃO roda em pipeline nenhuma (é uma régua aposentada). Por isso ele é medido sob
demanda (`--counterfactual`) e o JSON registra qual foi o caso — sem ele o delta
e a atribuição saem `null` (INDETERMINADO), nunca preenchidos com um número de
outra rodada.

**Custo da OFERTA de remendo no pre-commit — medido nos DOIS caminhos do
commit.** O hook passou a OFERECER o remédio dos defeitos mecânicos (as seis
classes, numa pergunta só) DEPOIS das duas fases, e a dar o veredito da fase
reprovada pela FASE RODADA DE NOVO com o remendo já no índice. As duas coisas
vivem no caminho de CADA commit, então a família `hook` as mede onde elas são
pagas: no hook DE VERDADE, num repositório git temporário (o mesmo fixture da
prova do hook — binários das fases dublados, remédio REAL), com o contrafactual
sendo uma TRANSFORMAÇÃO do próprio hook, ancorada no texto dele (`hookSemOferta`:
o MESMO veredito sem o bloco da oferta; `hookWaitAgregada`: o gate de sintaxe de
volta ao `wait_all` da fase A). Medido em 18/09/2026 nesta máquina, com o hook já
carregando o guard do SIGPIPE na fase B e a sexta classe na oferta:

| forma medida (mediana de 3 amostras)                    | wall time |
| ------------------------------------------------------- | --------- |
| caminho COMUM, hoje (índice ok)                         | 81ms      |
| caminho COMUM, sem a oferta (contrafactual)             | 79ms      |
| caminho COMUM, sintaxe agregada ao `wait_all`           | 80ms      |
| caminho de FALHA, hoje (defeito no índice, fail-closed) | 220ms     |
| caminho de FALHA, sem a oferta (contrafactual)          | 77ms      |
| remédio VERDE — a fase rodada de novo (dublê declarado) | 148ms     |
| detecção contra a ÁRVORE REAL (read-only, conferida)    | 305ms     |

**Os dois deltas que importam.** No caminho COMUM a oferta custa **+2ms (≈0)**:
ela NÃO é alcançada quando nada reprova (o `if` só abre com fase vermelha), que é
o que faz o custo dela ser pago por quem TEM defeito e não em todo commit — e o
guard novo da fase B, no fixture, é dublê (o custo real dele está medido abaixo). E
a espera SEPARADA do gate de sintaxe contra a agregação no `wait_all` custa **+1ms**
— as duas esperam o MESMO conjunto de PIDs, e o teto é o `max`: a estrutura da
espera não muda o tempo, e agora isso é dado versionado em vez de premissa. No
caminho de FALHA a oferta custa **+143ms** (fail-closed: sem terminal ela não
pergunta nem remenda) e, depois de um remédio VERDE, a fase rodada de novo custa
**+71ms** — ali só o gate de sintaxe é reexecutado; a fase B, que o fixture
dubla, tem o custo medido nas famílias de guardas. Duas rodadas da mesma sessão
dão ±3ms nestes números: é essa a resolução do instrumento, e por isso o que a
família afirma é a ORDEM de grandeza (o caminho comum não paga a oferta; o de
falha paga dezenas de milissegundos), não o milissegundo.

**O que a sexta classe custou, e onde.** A detecção do remédio roda TODAS as
classes quando é invocada, e a do SIGPIPE varre o repositório inteiro (o veredito
dela é o ESTADO da árvore, não o do commit — é o mesmo `scanRoot` que o CI roda):
por isso a linha "detecção contra a ÁRVORE REAL" subiu de **201ms para 305ms** e o
caminho de FALHA (que inclui a detecção) de **211ms para 220ms** — o custo é pago
onde a oferta é alcançada, nunca no caminho comum. A invocação do guard no hook
custa **~0,14s** medidos à parte (129 scripts + 33 workflows), em paralelo com as
outras guardas da fase B. A baseline versionada foi MOVIDA nesta rodada para a
família `hook` (as outras herdadas, com a procedência marcada em `meta.reused`):
um número de referência desatualizado transformaria uma decisão medida numa
alerta falsa.

**Quatro afirmações que o contrafactual precisa sustentar** (e que o teste
prende): as duas transformações são ancoradas no TEXTO do hook, e sem as âncoras
a família se declara **NÃO MEDIDA** em vez de comparar o hook com ele mesmo (um
delta 0 "perfeito" que não mediu nada); o contrafactual `sem-oferta` MANTÉM o
veredito, com os mesmos exits — ele mede custo, não outra política; a
**REVALIDAÇÃO é observável na saída** (o veredito do gate dono aparece DUAS vezes
quando o remédio sai verde e UMA no fail-closed), em vez de ser afirmada; e a
detecção contra a árvore real é read-only por construção, com o
`git status --porcelain` conferido antes e depois — `escreveu: true` é VIOLAÇÃO da
família, não um detalhe do log.

**Custo de CADA sub-test do master de mutação — medido, e versionado por
sub-test.** O job `mutation-guards` é o mais caro do PR, e era a única conta do
repositório que ninguém media POR PASSO: o modelo de latência declarava um total
e o que um sub-test novo tinha acrescentado vinha de medições avulsas (`--scenario`,
uma a uma) **escritas à mão na prosa** do modelo. Agora o próprio master mede
(`--json`) e o benchmark **versiona sub-test a sub-test** (família `mutations`,
esquema v6, em `docs/benchmarks/guard-timing-baseline.json`). Uma rodada só, com
TODOS os sub-tests — medir um a um custaria uma subida de harness POR sub-test, e o
harness é exatamente o que a conta à mão esquece. A tabela é o ato VIVO **E** o
VERSIONADO — o mesmo comando, com a árvore COMMITADA: o ato de **23/09/2026**
re-ancorou a família nesta máquina (**39/39 verdes**), com o commit de origem na
`d06cc118` e **238 metades** — e é este total que o modelo de latência
deriva. **A coluna de metades é DERIVADA da MATRIZ** (§ anterior): o ato reescreve
a coluna (e o total) a partir de `scripts/metades.mjs` depois da herança e DIZ o
que fez no próprio registro (`metadesDaMatriz: {total, atualizadas, ...}` — nesta
rodada `atualizadas: 0`, porque a coluna MEDIDA já era a da matriz), e o
`check:mutation-count` julga forma a forma: a unidade que entra na suíte depois da
medição deixa de ficar escondida atrás do número antigo. É esse mesmo mecanismo
que fechou a defasagem que esta prosa declarava à mão até aqui (o ato de
`8e76c9a6` guardava 231 metades contra as 236 da árvore): a coluna deixou de
precisar de nota. O ato de 37,
por comparação, deixava SETE metades fora dele — as CINCO da pilha commit a commit (M1–M5, a 38.ª entrada da matriz,
cujo custo havia sido medido por execução em 22/09/2026: **3.3s**) e as DUAS do
teto derivado da régua da idade (M7 e M8, com a suíte a **22.8s** contra os 17.3s
daquele ato) —, e
todas as sete entraram MEDIDAS no ato de 39. O LIMITE do ato é declarado: o
`doc-hashes` estava no ÍNDICE (não em `8e76c9a6`), então o commit de origem NOMEIA
a árvore de onde o master foi lido e essa foi a única das 39 que não existia
naquele commit — e é por isso que o ato passou a gravar, além da procedência, o
ESTADO DA ÁRVORE e as formas medidas que a origem não contém (`forms:fora`, o
mesmo fato que a régua da idade lê no doctor):

<!-- bench:mutations:tabela — DERIVADA do registro (`mutations` da baseline); não edite à mão: o ato a reescreve -->

Cada sub-test do master, MEDIDO e VERSIONADO — o ato de 27/09/2026, medido sobre `7023f088` (a âncora é o commit que CARREGA este registro, resolvida pela história): **47/47 verdes**, **282 metades**.

| sub-test                                                                  |  wall time | fatia | metades |
| ------------------------------------------------------------------------- | ---------: | ----: | ------: |
| `job-deps`                                                                |     204.3s |   23% |      12 |
| `pre-commit-proof` (a declaração dos recusadores, a descida e o CONTROLE) |     167.9s |   19% |       3 |
| `workflow-run-syntax`                                                     |      77.9s |    9% |      15 |
| `hook-commands`                                                           |      66.2s |    8% |      27 |
| `local-image`                                                             |      47.8s |    5% |       4 |
| `bench-freshness` (a régua da idade e o CONTEÚDO da origem)               |      46.1s |    5% |      12 |
| `remedy-tty`                                                              |      36.4s |    4% |       2 |
| `registry-defaults`                                                       |      27.7s |    3% |       9 |
| `artefatos-do-hook`                                                       |      23.9s |    3% |       3 |
| `required-applied`                                                        |      20.4s |    2% |      10 |
| `nested-guard`                                                            |      19.4s |    2% |       2 |
| `cut-stages` (as três invariantes duras do corte do GitHub)               |      18.3s |    2% |       3 |
| `github-deps` (a catraca do inventário do GitHub)                         |      13.3s |    2% |       9 |
| `mirror-coverage` (o CONTROLE, a soma por tabela e o pulo sem motivo)     |      11.1s |    1% |       3 |
| `lint-scope` (o escopo do lint derivado do próprio comando)               |      10.8s |    1% |       6 |
| `mutation-count`                                                          |      10.3s |    1% |      18 |
| `canal-fixers`                                                            |       9.6s |    1% |       6 |
| `stack-per-commit` (a prova de cada commit da pilha passar sozinho)       |       9.2s |    1% |       8 |
| `reconciliation`                                                          |       9.2s |    1% |       3 |
| `gate-registration`                                                       |       8.1s |    1% |       5 |
| `runner-labels`                                                           |       5.2s |    1% |       1 |
| `merge-latency`                                                           |       4.5s |    1% |       5 |
| `hook-ci-parity`                                                          |       3.5s |    0% |       9 |
| `runner-tag`                                                              |       3.1s |    0% |       1 |
| `pipefail-sigpipe`                                                        |       2.3s |    0% |      22 |
| `act-origin`                                                              |       2.3s |    0% |       9 |
| `doc-hashes` (a régua do hash citado na prosa)                            |       2.1s |    0% |       9 |
| `bun-literal`                                                             |       1.8s |    0% |       5 |
| `workflow-defaults`                                                       |       1.0s |    0% |       7 |
| `lint-guard`                                                              |       0.9s |    0% |       3 |
| `archived-pipeline`                                                       |       0.8s |    0% |       6 |
| `timing-budget`                                                           |       0.7s |    0% |       5 |
| `readme-reverse`                                                          |       0.6s |    0% |       3 |
| `commit-import-exports`                                                   |       0.5s |    0% |       5 |
| `workflow-refs`                                                           |       0.5s |    0% |       4 |
| `mutation-jobs`                                                           |       0.4s |    0% |       4 |
| `readme`                                                                  |       0.4s |    0% |       3 |
| `no-setup-bun`                                                            |       0.2s |    0% |       2 |
| `runner-base`                                                             |       0.2s |    0% |       4 |
| `mutacao-prova`                                                           |       0.2s |    0% |       3 |
| `no-leaked-imports`                                                       |       0.1s |    0% |       3 |
| `utf8-scope`                                                              |       0.1s |    0% |       2 |
| `bun-removal`                                                             |       0.1s |    0% |       1 |
| `producer-sent`                                                           |       0.1s |    0% |       1 |
| `hooks-symmetry`                                                          |       0.1s |    0% |       2 |
| `docs-anchor`                                                             |       0.1s |    0% |       1 |
| `e2e-cache-budget`                                                        |       0.0s |    0% |       2 |
| **soma dos 47 sub-tests**                                                 | **869.8s** |  100% | **282** |
| harness (parse das metades, tabelas, subida do master)                    |       5.4s |       |         |
| **total do master**                                                       | **875.2s** |       |         |

**Dez** sub-tests pagam **83%** da conta e a mediana é **3.1s**: a cauda é barata, e o harness sai da DIFERENÇA entre o total e a soma dos sub-tests, não de uma constante. O sub-test NOVO entra na rodada seguinte **MEDIDO**, e o PRÓXIMO acrescenta **~18.6s** (PROJEÇÃO: a média dos scripts medidos mais o harness por sub-test). A marca **↺** na linha é sub-test RE-MEDIDO (a régua é a REPETIÇÃO: o ms é a soma das tentativas) e **🌀** é FLAKE (não vale verde nem reprovação). A coluna de metades é DERIVADA da matriz (§ acima) — o ato a reescreve depois da herança e diz o que fez (`metadesDaMatriz`). Esta TABELA (e esta leitura) é **DERIVADA do registro**: quem a reescreve é o ATO, e o `check:mutation-count` recusa o commit em que ela divirja dele — a prosa não tem número próprio.
<!-- /bench:mutations:tabela -->

**E a derivação desceu ao PASSO.** O mesmo mecanismo, um nível abaixo: o job
`mutation-count-guard` do espelho passou a declarar os seus **PASSOS**, e o passo
da suíte não tem número próprio — ele **LÊ** a forma `mutation-count` desta mesma
tabela (**9.083s** na rodada de 23/09/2026, com o commit `d06cc118` ao lado),
como o `benchIndex` já fazia com
o total do master. O defeito que a ligação elimina é o de dois números do MESMO
passo: até 22/09/2026 o declarado dizia 3870ms contra os 3897ms da forma, e nenhum
dos dois era derivado do outro — 27ms de diferença de contexto que ninguém veria
até alguém comparar dois arquivos (e o número de hoje só muda porque a MEDIÇÃO
mudou: o mesmo campo é lido, não reescrito à mão).

**O que isso muda no veredito.** O sub-test NOVO não precisa de conta nenhuma:
ele entra na rodada seguinte **MEDIDO**, e a comparação o publica como forma nova
(`➕`) com o ms dele ao lado da baseline — o número do job deixa de vir de uma soma
que alguém montou à mão. O modelo de latência passou a **DERIVAR** o passo do
master desta medição (`benchIndex` lê o total da família), o que já confronta o
declarado do espelho: **0%** — o ato de 22/09/2026 (`--only mutations --json
--baseline --merge`, com a árvore commitada em `8e76c9a6`, as duas entradas novas
da matriz e as sete metades que faltavam medidas juntas) re-declarou o job em
**412394ms**, que é a própria medição; antes dele o ato de 37 (`6125c9da`)
declarava 394959ms, o de 36 sub-tests (`2757e3a5`) declarava 380950ms e o primeiro
ato desta série guardava a medição de OUTRO commit (**271.8s** com 33 sub-tests
contra um derivado de 380.9s), onde a comparação NOMEAVA os **28% de divergência**
em vez de escondê-los. O mesmo ato
re-declarou o PISO do job `guards` da forja dona do merge (**446315ms**: a bateria
re-medida de 30.9s + o gate de sintaxe + a matriz de 412.4s + a paridade das regras
de classificação), e o ato de **23/09/2026** o moveu para **562423ms** (a bateria de
30.9s + o gate de sintaxe + a matriz de 528.5s + a paridade de 0.524s), com a matriz
em **39/39 verdes** e **238 metades**. A projeção do
PRÓXIMO sub-test (**13.6s**) é dita como **PROJEÇÃO**, não medição: ela é a média dos
scripts já medidos mais o harness por sub-test, e os dois lados saem de medição.
A família segue a **mesma régua de cobertura** das outras: sem ela nesta rodada (ou
com o master sem produzir o JSON) a comparação fica `measured: false` e **nomeia**
`sub-tests do master (custo por sub-test)` — não medido ≠ resolvido, e a issue de
tempo não fecha. Um master VERMELHO continua medido (o `--json` sai antes do
veredito, e o `exit` fica gravado no resultado), com a violação nomeando o sub-test
que não passou: um sub-test que morre no meio fica RÁPIDO, e chamar isso de
"melhorou" seria publicar como ganho um trabalho que não foi feito. O contrato
ainda acusa o sub-test **sem metades declaradas** (custo sem o que ele protege) e a
conta que não fecha (total menor que a soma dos sub-tests).

**Medir em partes (máquina lenta / timeout de runner).** As famílias de régua
medem comandos INTEIROS e uma rodada completa tem dezenas de minutos (a `hook` é
a exceção: segundos). Três
afirmações resolvem isso sem enfraquecer a procedência: `--only FAMÍLIA` mede só
aquelas famílias (e pula a bateria de guards+doctor); **gravar nunca perde** — o
que esta rodada não mediu entra no arquivo herdado, com procedência; e o que foi
herdado vai para `meta.reused` com o **arquivo de origem, o commit e o timestamp**,
aparece nomeado no relatório e é **excluído do veredito** — um número de outro
momento não pode passar por "a medição de agora", e é justamente o que um veredito
otimista esconderia.

**A CADEIA da herança — e o defeito medido que a definiu (09/2026).** A ordem é
`[baseline, latest]`, e ela não é arbitrária: a **baseline vem primeiro** porque é
o **PISO e a precedência** — uma família que a régua versionada tem **nunca chega
`null` ao arquivo gravado**, e quando as duas fontes têm o número, o que vale é o
**dela** (uma rodada de scratch não rebaixa a régua); o `latest` entra como segunda
fonte em toda gravação que não seja **só** da régua (ele é o predecessor do
próprio `latest` e quem preenche o arquivo com data). Numa gravação só da
baseline, é o `--merge` que a faz absorver o `latest` — promover para a régua o que
foi medido em partes é ato DELIBERADO. O caso que exigiu isto, com as duas pontas
medidas: uma rodada `--only hook --json` (ou o `--no-lint` do dispatch semanal)
gravava as seções que **não** mediu como `null`, e a rodada seguinte (`--only
mutations --baseline --merge`) herdava o **VAZIO** — o `rulers` da BASELINE saía
`{typecheck: null, tests: null}` e o consumidor quebrava (`merge-latency.mjs` itera
`Object.values(bench.rulers)`: o `null` derrubava com "Cannot read properties of
null"), deixando a suíte vermelha por um arquivo e não por uma medição. A herança
da **bateria** (guards+doctor) segue a mesma cadeia e a mesma régua de "foi
medida?" (guards vazios com doctor nulo não é medição), e o `summary` gravado
descreve o arquivo INTEIRO — um `summary` da rodada parcial ao lado de uma seção
herdada seria uma incoerência gerada pelo próprio benchmark.

A mesma regra vale nas duas **pontas** do veredito, não só na lista de formas:
uma família herdada não julga o **TOTAL** (que é a soma de guards+doctor, e esse
número é de ontem) e deixa a comparação `measured: false`, o que **recusa o
fechamento** da issue de tempo; e uma família que a baseline tem e a rodada não
mediu _nem herdou_ (o `--no-lint` do dispatch) faz o mesmo. Herdar continua
permitido; **fechar a dívida com número herdado, não** — sem isso, um
`--only tests --merge` daria por resolvida uma dívida de guards que aquela rodada
nunca mediu.

**Forma não medida nunca é REGRESSÃO — nem com o ms acima do limiar.** Um guard
que não terminou (`ok: false`) tem o ms do pedaço que rodou; se esse pedaço for
maior que a baseline, o número passa do limiar e _não_ é medição. A régua marca a
forma `unmeasured` E a exclui do julgamento, e o motivo da comparação **nomeia** a
família que faltou (`bateria (guards+doctor)`, `lint`, `typecheck`, `suíte`,
`hook (oferta de remendo)`, `sub-tests do master (custo por sub-test)`) —
"medição incompleta" sem o nome transfere a investigação para quem lê a issue.
As famílias
typecheck e suíte medem **uma amostra por forma** (`samplesPerForm: 1`),
declarado: cada amostra é um comando inteiro. O `--samples` continua sendo o
controle da mediana das formas de lint, que rodam em segundos.

**O estado de cada família é EXPLÍCITO no JSON:** `counterfactual`
(`measured`/`not-measured`), `cold: true` + `cacheFile` na do typecheck, o exit
da régua sem heap (`legacyBareExit`) e o heap default do node
(`nodeHeapLimitMb`). Um campo `null` significa **não medido** — nunca zero, e
nunca um valor herdado sem a marca de procedência. Essa marca é `meta.families`
(o **ato** e o **commit de origem** de cada família), com `meta.act` ao lado
dizendo o **comando** que produziu o arquivo: sem os dois, um número de wall time
não diz de que rodada nem de que árvore ele é.

**A comparação das famílias novas é do COMANDO CANÔNICO**, não do delta: aqui
"regressão de tempo" significa "o gate ficou mais lento", e o contrafactual não
roda mais em pipeline nenhuma. (No lint a forma comparada continua sendo o custo
por rodada, que é o que a unificação acrescentou lá.) No `hook`, a comparação é
FORMA por FORMA, casada por PAPEL (o caminho do commit — `comum-hoje` com o
`comum-hoje` da baseline, não com o que estiver na linha de cima), e os DELTAS
entre formas ficam fora do veredito de propósito: delta é diferença de duas
medianas, e julgar regressão sobre ele multiplicaria o ruído — o que a comparação
julga é o custo ABSOLUTO de cada forma, e o delta diz de onde ele veio.

**O ESTADO DA BASELINE É DADO, não impressão.** A baseline versionada está no
**esquema v6**: ela carrega as seis famílias e, por família, `meta.families` com
o **ATO** que mediu o número (`measured` nesta rodada · `reused` herdada de outra
por `--merge` · `not-measured`) e o **COMMIT de origem**, ao lado de `meta.act`
(o comando que produziu o arquivo) e do carimbo da máquina. O **ESTADO DA ÁRVORE**
que o ato encontrou entra no mesmo registro (`meta.treeState`) com o **TRABALHO**
não commitado (`staged`/`unstaged` — o que um commit carregaria e a origem não
tem) e o **ARTEFATO LOCAL DECLARADO** (`declared`, com a regra versionada que o
declara e o motivo de cada entrada) SEPARADOS: o que o repositório declara local
não suja a árvore e sai NOMEADO em vez de acusado, e o que casar a tabela sem
prova versionada sai contado em `undeclared`. A régua de "esta
família foi medida?" é **UMA SÓ** (`FAMILY_MEASURED`) — a mesma que a comparação
usa para dizer que falta cobertura, e a mesma que a procedência grava: a
procedência e o veredito não podem divergir sobre o que foi medido, e uma seção
presente com `measured: false` (as âncoras do contrafactual sumiram) é
**não-medida**, não uma medição. Mover a baseline é ato DELIBERADO
(`bun run bench:guard-timing:baseline`, que grava o `latest` junto quando
recebe `--json`): antes da v5 a baseline não tinha nenhuma família de régua (v1) e
as formas delas saíam como **NOVAS** no relatório (`➕`) em toda comparação. Uma
suíte VERMELHA deixa a
família `unmeasured` — e a comparação inteira fica `measured: false`, o que
segura o fechamento automático da issue de tempo: se o gate que decide o merge
está vermelho, o tempo dele não é a pergunta.

**O que o doctor NÃO mede aqui:** o registro `DEBT_SUBJECTS` traz
`guard-timing-regression` com `crossCheck: null` — o doctor não cronometra os
gates (mediria esta máquina contra uma baseline de outra), então a issue de tempo
aparece na prontidão sem cruzamento de caducidade, e isso está dito lá.

**Usage:** `bun run bench:guard-timing` (mede) · `--no-lint` /
`--no-typecheck` / `--no-tests` / `--no-hook` / `--no-mutations` (pula famílias)
· `--only FAMÍLIA` (mede só
elas, sem a bateria; `--only mutations` mede a matriz de mutação inteira, ~4min) ·
`--counterfactual` (mede também a régua anterior da
suíte, ~7min) · `--merge` (a gravação **só** da régua absorve também o `latest`; a herança do
predecessor e o piso da baseline valem em toda gravação, marcadas e fora do
veredito) · `--samples N` (amostras por forma de lint; padrão 2) ·
`bun run bench:guard-timing:baseline` (salva a baseline **e**, com `--json`, o
`latest` — mover a baseline é o ato que decide que os números de agora passam a
ser a régua) · `bun run bench:guard-timing:compare` (compara) ·
`bun run bench:guard-timing:full` (salva + compara)

**Onde roda:** o job **`guard-timing-alert`** (`benchmark-weekly.yml`, semanal)
mede (`--json`, versionando o run em `guard-timing-latest.json`) e publica as
**duas** dívidas deste ativo como **issue**, num único passo: a regressão de tempo
(`scripts/guard-timing-issue.mjs`) e a **idade** de cada **declaração datada** —
as famílias do bench, os números do modelo de latência e as tabelas de custo do
README (`scripts/bench-freshness-issue.mjs`, issue `bench-freshness-drift`). São duas
perguntas do MESMO arquivo — a comparação de
percentual responde "o número subiu?" e não responde "de quando é o número?" —, e
o step agrega os dois `rc` sem curto-circuitar: um publicador que falha não
impede o outro de publicar, mas o passo fica vermelho se QUALQUER um falhou (não
medir não pode passar por verde). O checkout deste job — e o do `doctor` da
Gitea, que mede a **mesma régua** na seção 9/9 — é feito com a história inteira
(`fetch-depth: 0`): a idade se conta em commits, e um clone raso responderia "sem
idade" para sempre. Manual:
`bun run bench:guard-timing` / `:compare` / `:full`. O exit 1 do `--compare`
continua sendo o sinal de regressão >20% em algum guard, no doctor, no custo do
lint por rodada ou no comando canônico das famílias nova — mas ele NÃO é o canal
do cron: tempo de execução não é
corretude, e um cron que termina vermelho por overhead apaga a diferença entre "o
overhead subiu" e "o build quebrou".

**A régua é UMA só (`compareTimings`).** O relatório impresso e o publicador da
issue leem a MESMA função — inclusive o **piso de ruído** de 50ms
além do percentual (duas réguas para a mesma pergunta divergem no dia em que
alguém ajustar uma delas, e a divergência apareceria como "o CI diz regressão e a
issue está fechada", sem teste vermelho). O piso existe porque a bateria é medida
com UMA amostra por guard: 20% de 40ms são 8ms, que é escalonamento do sistema
operacional — sem ele, o canal semanal abriria dívida para `check:barato +50%`
(40ms → 60ms) toda semana, e um alerta que mente é o alerta mudo com outro nome.

**O TOTAL é DERIVADO, não medido:** ele só é julgado quando todas as formas que
ele soma foram. Uma bateria com um guard que não terminou (`ok: false`) tem um
total menor por um motivo que não é velocidade — julgá-lo daria "melhoria no
agregado" com regressão nas partes, duas leituras contraditórias do mesmo run.

**O ciclo da dívida é o do contrato de issues** (`issue-publish.mjs`, como
`actrc-sync-issue`, `required-checks-drift-issue`, `mutation-trend-issue` e
`blob-crlf-scope-issue`):

- **abre** a issue com o guard, o **delta** (segundos e %) e a medição inteira —
  "está lento" sem o delta transfere a investigação;
- **deduplica por FAIXA** (dezena do pior % acima do limiar), não pelo número:
  o wall time oscila a cada run e uma assinatura pelo valor exato comentaria toda
  semana. A faixa muda só quando a severidade muda de ordem — e aí comentar é o
  certo. QUAL forma piorou vai no corpo, que é onde quem investiga lê;
- **comenta a prova e FECHA** quando nenhuma forma medida passa do limiar. A
  guarda do fechamento é `comparison.measured`: baseline ausente, forma sem número
  ou comando que não terminou **não** fecham a dívida ("não medido" não é
  evidência de que o tempo voltou ao normal).

**O que NÃO prova:** que a máquina do runner é a mesma do baseline. A baseline é
UM run, não uma mediana — o limiar de 20% e o piso de 50ms absorvem ruído de
medição, não uma troca de hardware; uma baseline velha debaixo de um runner novo
aparece como regressão até alguém mover a baseline DE PROPÓSITO
(`bench:guard-timing:baseline`), que é decisão registrada, não efeito do tempo.

### 10.1. Latência de MERGE — `bench:merge-latency` (`scripts/merge-latency.mjs`)

**O que protege:** o número que o repositório PUBLICA sobre o custo dos gates.
A tabela de overhead abaixo lista o custo de cada gate e convida a **somar** —
mas o PR não paga a soma: ele paga o **caminho crítico** do grafo `needs:` e, com
poucos runners, a **fila**. São duas contas diferentes, e a segunda é a que
decide se alguém espera 3 minutos ou 12.

**Por que existe:** um job novo na pipeline do PR sem duração declarada (nem
derivável do benchmark) faz a latência publicada **encolher** em silêncio — o
denominador diminui, e o número fica MENOR justamente quando ficou mais
incompleto. É a mesma classe que a soma de gates independentes já escondia.

**Como mede — três decisões que o desenho carrega:**

1. **O grafo sai da pipeline REAL** (`.gitea/workflows/ci.yml`,
   `.github/workflows/pr-check.yml`), não de uma cópia aqui: renomear um job ou
   acrescentar um `needs:` muda a latência sem este arquivo ser tocado — e uma
   cópia envelheceria em silêncio. A leitura do YAML é a MESMA dos outros guards
   (`forge-workflows.mjs`), não uma segunda régua.
2. **A duração tem PROCEDÊNCIA — e a procedência diz QUE TIPO de número é.** O
   `provenance` de cada job é um de: `derivado (benchmark)` (a soma dos passos
   que o benchmark versionado conhece), `declarado (MEDIDO)` (medido NESTE
   repositório, com os comandos e a data na fonte), `declarado (PISO: passo não
medido)` (soma dos passos medidos, com o passo que ficou de fora NOMEADO na
   fonte) e `declarado (TETO: timeout-minutes)` (o limite que a própria pipeline
   declara — item 4). `ci/merge-latency.json` declara `ms` + `fonte` + `data`; o
   benchmark versionado (`docs/benchmarks/guard-timing-latest.json`) é a SEGUNDA
   fonte, usada para CONFRONTAR o declarado. Divergência além de 25% sai como
   aviso — e o derivado é marcado como **PISO** quando o job tem passo fora do
   benchmark (um alarme que sempre toca não é alarme).
   Há ainda uma QUARTA forma, para o job cujo número JÁ vive no benchmark: o job
   declarado por **PASSOS** (`steps`), com `provenance` `declarado + derivado
(benchmark)`. Cada passo ou tem `ms` (medido neste repositório, com fonte e
   data) ou tem `from: { family, form }` — e aí o número é **LIDO** da forma
   versionada, nunca repetido aqui. Foi assim que o passo da suíte do
   `mutation-count-guard` deixou de ter DOIS números: o declarado dizia 3870ms
   enquanto a forma `mutation-count` da baseline publicava 3897ms (27ms de
   diferença de CONTEXTO) e, antes, 155ms contra 447ms da sub-test de `d9356e8d`
   (**3x**) — nenhum dos dois derivado do outro, então a divergência era
   invisível por construção. Com a ligação, o custo da suíte muda nos dois lugares
   ao mesmo tempo (é o mesmo número), e a procedência do passo nomeia a forma e o
   **commit** dela.
   A cobertura é **EXATA nos dois sentidos**: todo `run:` do job tem de estar
   contado por um passo declarado (um passo novo custaria **ZERO** na conta do PR —
   a mesma classe do denominador que encolhe) e todo passo declarado tem de
   existir na pipeline. O que não fecha deixa o job **sem duração**, com a causa
   NOMEADA no relatório (`stepProblems` no `--json`) — e um `ms` junto de `steps`
   é recusado, porque dois totais do mesmo job teriam de concordar.
3. **Os dois extremos são reportados.** Com 1 runner (o `act_runner` que o
   compose da forja sobe) o makespan degenera na SOMA e o paralelismo não
   economiza nada; com runners de sobra ele converge para o caminho crítico. Um
   número só seria uma aposta entre os dois.
4. **O TETO é a última porta antes de "não sei".** Há custo que não se mede fora
   do runner: baixar e rodar `act`, subir PostGIS, a matrix do seed. Para esses,
   o modelo declara o `timeout-minutes` que a PRÓPRIA pipeline escreve no job
   (`ceiling: true` no modelo) — um LIMITE SUPERIOR, nunca confundido com
   medição: o relatório imprime `⚠ 'job': TETO declarado pela pipeline`, o
   `--json` carrega `ceilings`, o veredito diz que a latência é um LIMITE
   SUPERIOR, e a soma sem os tetos é publicada ao lado. O teto declarado é
   CONFRONTADO com o `timeout-minutes` da pipeline: se o job mudar o orçamento e
   o modelo não, sai o fato `ceilingAged` — a cópia não envelhece em silêncio.
   Um job sem duração E sem `timeout-minutes` continua indeterminando o veredito:
   é exatamente o que o gate existe para pegar.

**O gate (`--check`) julga SÓ o dono do merge.** O espelho declara todos os jobs
do PR (os 19 que faltavam ganharam MEDIDO, PISO ou TETO, e a concorrência dele —
1 runner auto-hospedado — passou a estar no modelo), então o veredito dele é
PRONTO **com 4 jobs por TETO**: a latência publicada do espelho é um LIMITE
SUPERIOR, e a soma sem os tetos aparece ao lado. O dono do merge, não: se ele não
cobrir todos os jobs do PR, o número publicado mede menos pipeline do que existe.

O primeiro job do repositório declarado por PASSOS é o `mutation-count-guard` do
espelho: `setup-bun` (17.175s, 17/09), `install` (62ms), `check-mutation-count`
(93ms) e o `Summary` (98ms, um bloco) são MEDIDOS, e o passo da suíte (3.897s) é
LIDO da forma `mutation-count` da baseline — a mesma sub-test que o master mede,
com o commit `2757e3a5` ao lado. O `Summary` estava FORA do total declarado antes
(a conta antiga, 21198ms = setup + install + suíte + check, não o contava) e a
cobertura exata o trouxe para dentro: é exatamente para isso que a regra existe.

No dono, o job `guards` é o PISO declarado: o benchmark versionado não cobre
`check:workflow-run-syntax` nem `check:pipefail-sigpipe`, e o job também roda
`install`/checkout. O gate de sintaxe entrou na soma com os **2464ms MEDIDOS**
(17/09/2026, quando ele passou a julgar TAMBÉM o shell embutido — os 124 scripts
de shell vinham da mudança anterior, e eram 2280ms), e o que segue fora é NOMEADO
na fonte: os dois guards que o benchmark não tem e o `install`/checkout. PISO não
é ponto medido: é a soma do que se mediu, com o que falta dito.
O `--check` roda com o
MESMO COMANDO nas duas forjas (`node scripts/merge-latency.mjs --check`), e é o
que impede um PR do GitHub de furar a conta da forja editando
`.gitea/workflows/ci.yml` sem nada falhar.

**Onde roda:** passo do job `guards` da forja + passo do `workflow-refs-guard` do
GitHub (invariante `merge-latency` do CORE). No pre-commit é
**lacuna declarada** (`HOOK_NOT_RUN`): o veredito é uma propriedade da pipeline
INTEIRA, não do commit — um commit de componente não o muda, e não há recorte,
porque o `--check` lê os dois arquivos fixos de qualquer jeito.

**Como testar:** `bun run bench:merge-latency` (relatório), `bun run
bench:merge-latency:json` (o `mergeOwner` sai como fato próprio), `bun run
check:merge-latency` (o veredito do gate). Testes unitários em
`src/lib/__tests__/merge-latency.test.ts` (47 casos), com repositório SINTÉTICO
para injetar o defeito que o gate existe para pegar.

**Prova por mutação** (`scripts/test-mutation-merge-latency.sh`, sub-test
`merge-latency` do master): as CINCO metades do gate são load-bearing, e cada
uma tem de ser vista por uma das duas testemunhas independentes — o **gate por
EXECUÇÃO** (`--check --root <fixture sintética>`, com um job do PR sem duração)
e a **suíte unitária**. M1 remove a DETECÇÃO da cobertura (`missing.push`) ⇒ o
gate sai 0 (cego) e a suíte fica vermelha; M2 fixa o EXIT CODE do `--check` em 0
⇒ o CI passa com o veredito INDETERMINADA; M3 troca o PAPEL do dono do merge ⇒
o gate deixa de recusar quem mergeia e passa a julgar o espelho; M4 lê o `if:` de
QUALQUER profundidade ⇒ o `if:` de um PASSO vira o do job, o espelho passa a
"poder ou não rodar" e o relatório dele recusa (exit 2) nomeando um `if:` que
não existe no job — a testemunha aqui é o RELATÓRIO do espelho, porque o gate do
dono já sai 2 por outro motivo e não distinguiria; M5 dá ao passo da suíte um
número PRÓPRIO no lugar da forma versionada (3870ms contra os 3897ms da baseline)
⇒ o `--json` do dono passa a trazer 3870 no passo derivado e a suíte fica
vermelha — a testemunha de execução é o próprio `--json`, que mostra se o modelo
LEU o arquivo ou repetiu um número. Cada mutação é
CIRÚRGICA (o injetor recusa alvo ausente/ambíguo, o arquivo mutado tem de seguir
com sintaxe válida) e é restaurada entre as medições, com o gate mordendo de
novo no controle final.

**O que NÃO prova:**

- a latência de **wall clock** real do runner. O modelo é construído sobre
  durações declaradas/derivadas de medições LOCAIS; ele diz a FORMA da conta
  (quem espera por quem) e o nº de runners declarado no modelo, não o tempo que o
  runner da forja leva.
- a cobertura do **espelho** está declarada, mas nem toda por medição: 13 jobs do
  PR do `pr-check.yml` saíram de MEDIDO neste host e 2 de PISO (o
  `security-headers`, que faz requisições ao ALVO do CI e não se mede contra
  produção daqui; o `benchmark-gist`, cujo módulo de geo vive em outro branch) e
  4 de TETO (`tier1-fastpath-guard`, `mutation-coord-timing-act-guard`,
  `seed-guards` e `mutation-coord-timing-guard` — custo dominado por `act`,
  PostGIS e matrix, declarado pelo `timeout-minutes` da própria pipeline). O TETO
  é o orçamento do runner, NÃO uma medição: por isso a latência do espelho é um
  limite superior, e a soma sem os tetos sai ao lado no relatório.
- o custo **por-lado** de um job que é um `uses:` de workflow reutilizável com
  matrix: o modelo conta UM job, e o teto do `seed-guards` é a soma das 4 pernas
  (2h), que só é o caso porque no runner self-hospedado elas são seriais.
- o **overhead por job** (checkout + cache + setup): não tem medição própria
  neste repositório. O `overhead.perJobMs` do modelo é 0 e diz isso; o derivado do
  benchmark é a soma dos comandos conhecidos, então leia-o como PISO.

---

## 11. Fuzz / encoding runtime — `run-all-fuzz`, `run-encoding-guards.sh`

**O que protege:** fuzz dos parsers de encoding + execução orquestrada dos
encoding guards.

**Por que existe:** parsers (regex de CRLF/UTF-8/out=) com inputs malformados
não podem crashar; o orquestrador garante ordem determinística e saída
agregada para hooks e CI.

**Onde roda:** pre-push (fuzz:ci), pre-commit/pre-push (orquestrador).

---

## 12. Dependências — `check-unused-deps`

**O que protege:** zero órfãs no `package.json` — toda dep (`dependencies` +
`devDependencies`) tem pelo menos UMA referência real no código do repo
(src/, scripts/, e2e/, mini-services/, configs, workflows, hooks, Dockerfiles).
Dep adicionada e não usada = falha (exit 1); não existe baseline de órfãs.

**Por que existe:** dep órfã é lockfile que cresce sem uso, superfície de
ataque (deps nunca atualizadas no audit) e confusão para o próximo dev
(qual dep é runtime de verdade?). O guard trava o lockfile ENCOLHENDO — a
política é ZERO-órfãs, não "N órfãs toleradas".

**Onde roda:** job `unused-deps-guard` do pr-check.yml (mutation test
`test-mutation-unused-deps.sh` + guard real) — fora do pre-commit por ser um
scan repo-wide mais lento; checagem local pontual: `bun run check:unused-deps`.

**A data da decisão e a revisão vencida (`--review`):** cada entrada da
`ALLOWLIST` registra `addedAt` (ISO `YYYY-MM-DD`) — "esta dep tem uso
IMPLÍCITO, não a importe" não tem prazo por natureza, e uma isenção concedida
hoje continua valendo amanhã porque ninguém voltou nela. A regra é a MESMA das
outras duas allowlists, do módulo compartilhado `allowlist-review.mjs`. O
registro ausente/inválido/no futuro é **violação nos dois modos** (fail-closed);
passada a janela `UNUSED_DEPS_REVIEW_DAYS` (180 dias) a entrada está **SEM
REVISÃO** — o scan normal **avisa** (`::warning::`) e o modo `--review` a
escala a **violação** (exit 1). É o canal do job semanal
`registry-allowlist-review` (`benchmark-weekly.yml`), que roda este guard ao
lado do `check-registry-source` — um aviso dentro de um run verde é alerta
mudo. O modo `--staged` (pre-commit) **não** roda a revisão: ele responde só
"esta dep NOVA é órfã?", com custo proporcional ao diff.

**Política completa (fluxo ao adicionar dep: use / remova / allowlist com
razão; allowlist de uso implícito; as 5 deps removidas no bump 0.4.0; as
limitações do scan):** veja a seção [Auditoria de dependências — política
ZERO-órfãs](../README.md#auditoria-de-dependências-política-zero-órfãs) —
fonte única, sem duplicação neste catálogo para não driftar.

### 12.1. As dependências de um JOB — `check-job-deps` (`scripts/check-job-deps.mjs`)

**O que protege:** um job que RODA um comando cujo veredito exige
`node_modules` tem de INSTALAR as dependências — ou a isenção tem de estar
**DECLARADA** com data e janela de revisão. Sem `bun install` no job e sem
isenção, é violação (exit 1).

**Por que existe (a classe é MEDIDA, não suposta):** `node
scripts/check-*.mjs` PARECE "node puro" — os guards leem LINHA, e a prosa dos
workflows diz literalmente "node puro, sem bun install; roda em <5s". Mas oito
deles perguntam ao `js-yaml` se o YAML é válido (`readWorkflowScan` →
`workflowYamlValidity`, a porta fail-closed da classe do "não consegui
julgar"). Num checkout SEM `node_modules`, medido guard por guard, esses oito
saem **exit 2** ("NÃO JULGÁVEL") e os `test-mutation-*.sh` morrem no binário
ausente. O mesmo comando tem, portanto, DOIS desfechos sem dependências — e
nenhum deles está escrito no workflow. O verde de um job que não instala não
tem causa no repositório; tem causa no `node_modules` do AMBIENTE (o workspace
de outro job, ou a máquina de quem roda o runner). O sintoma que o operador vê
é "NÃO JULGÁVEL", nunca "faltou instalar". Este guard transforma a prosa em
CONTRATO — e é o **par do `check-no-setup-bun`**: aquele proíbe a ação externa
que ninguém declarou, este exige a DECLARAÇÃO de onde o `node_modules` vem.

**O que ele decide, por job:**

- **INSTALA** (`bun install`, `npm ci`, … em qualquer passo do job) → OK;
- **NÃO INSTALA** e nenhum comando exige `node_modules` → OK, medido;
- **NÃO INSTALA** e algum comando exige → a isenção tem de estar em
  `JOB_DEPS_ALLOWLIST` com `addedAt` e motivo escrito; sem isso é VIOLAÇÃO;
- **isenção VERIFICADA contra o grafo de imports**: `semDeps: "passa"` é
  provadamente FALSA se o grafo tem um `import` de TOPO ou um BINÁRIO de
  dependência — os dois carregam no START, sem caminho alternativo. Uma isenção
  que não pode ser verdadeira não pode ser declarada;
- **isenção SEM OBJETO** (o job passou a não exigir nada) também é violação: a
  declaração que sobrou mente sobre o presente.

**O SEGUNDO CONTRATO DO MESMO JOB — o CAMINHO (desde 24/09/2026):** o
`node_modules` é uma metade; a outra é **onde o veredito RODA**. Um gate de
**LEITURA DE YAML** não usa docker, não sobe serviço e não fala com a rede — ele
só LÊ o repositório. Preso ao runner da forja, ele passa a depender da
infraestrutura dela: **medido** em 24/09/2026, com o runner `hostinger-runner`
**offline**, os 50 jobs do `pr-check` ficaram ~35 min em `queued` e os gates de
leitura não cunharam veredito nenhum (a forja não erra: ela ESPERA, e nada fica
vermelho — o vermelho que apareceu foi o de um job que roda _sem_ instalar, e a
mensagem é "NÃO JULGÁVEL").

A classe é **DERIVADA, não enumerada**, e são dois fatos do próprio job:

- **ele LÊ YAML**: algum passo roda um leitor (`node scripts/<X>.mjs`) cujo fecho
  de imports RELATIVOS alcança a leitura compartilhada (`forge-workflows.mjs`, a
  fonte única do YAML validado) ou importa `js-yaml` direto. A detecção é por
  **SPECIFIER** — um comentário que cita o arquivo não faz um job ler YAML;
- **ele não tem NENHUM fato que exija a imagem da forja**: nada de `services:`,
  nada de docker (comando ou `uses: docker/*`), nada de suíte de mutação, nada de
  `bun x <pacote>` e nenhum shell além do plumbing do Bun
  (`scripts/setup-bun-ci.sh`). Um shell QUALQUER tira o job da classe — o que o
  corpo dele executa este contrato não prova, e presumir "só leitura" ali seria a
  aposta que este repositório não faz.

**O veredito:** classe verdadeira + `runs-on` que pede a forja (`self-hosted`) =
VIOLAÇÃO. O remédio é o caminho hospedado (`ubuntu-latest`) **mais** o par
canônico de install (o hospedado chega sem `node_modules` nenhum — e sem o par,
o leitor de YAML sai 2), ou a exceção declarada em `RUNNER_PATH_ALLOWLIST` com
`addedAt` e motivo, que segue a MESMA janela de revisão do outro contrato. Uma
exceção **sem objeto** (o job já roda no caminho hospedado, ou saiu da classe) é
violação: a declaração que sobra mente sobre o presente.

**Onde o contrato NÃO se aplica, declarado:** o escopo são os workflows do
ESPELHO (`.github/workflows/*`) com gatilho de `pull_request` — os gates do
MERGE. Do lado da forja dona do merge o `runs-on: ubuntu-latest` **É** o
`act_runner` dela (o label mapeia para a imagem `ubuntu-bun`), então a regra não
tem o que decidir lá; e um cron não bloqueia merge (a decisão dele é a dívida
declarada, noutro canal). Um job sem `runs-on` lido sai NOMEADO em
`foraDoEscopo`.

**O que a classe MEDIU nesta árvore** (o número sai do `--json`): **10 jobs**
leem YAML no espelho, TODOS no caminho hospedado — **0** com exceção declarada
desde a migração de 25/09/2026, que levou os dois últimos ao caminho que não
depende do runner (o `check`, que EXECUTA a stack: o `check-mirror-coverage`
spawna os guards do recorte em worktrees; e o `pre-commit-in-runner-proof`, cujo
`docker run` vive no corpo do script — fora do scan de passo — porque o que ele
mede É a imagem da forja, e na forja dona do merge o `ubuntu-latest` É o
container da imagem, o caso 1 que o próprio script da prova declara suportar). A derivação achou **4 gates que a varredura manual tinha deixado para
trás** (`secrets-guard`, `workflow-refs-guard`, `mutation-jobs-staged-guard` e o
próprio `check`): é o que uma classe derivada compra — um gate novo entra no
julgamento por FATO, não por alguém lembrar de movê-lo.

**A FILA DE MIGRAÇÃO é publicada no PRÓPRIO veredito** (desde 24/09/2026): quem
AINDA pede a forja sem que nenhum fato exija a imagem dela sai NOMEADO na linha
verde do guard (e no `--json`, `resumo.filaMigracao` + `caminho.filaMigracao`) —
em ordem determinística, cada linha com o `runs-on` que pede, o leitor de YAML
que o classifica e o REMÉDIO. A exceção declarada fica NA FILA de propósito: a
declaração tira o job do VERMELHO, não da lista — é exatamente o job
verde-declarado que o próximo a migrar precisa ver, e publicar a fila no veredito
é o que dispensa cruzar `RUNNER_PATH_ALLOWLIST` com os workflows à mão. A fila
ENVELHECE sozinha: migrado o job, o verde fica sem a linha (a fila vazia não
imprime nada); entrado um gate novo na classe, a fila o nomeia sozinha. Na
medição desta árvore a fila está VAZIA — a migração de 25/09/2026 levou as 2
exceções ao caminho hospedado, e o verde envelheceu até o absoluto (a allowlist
vazia: exceção sem objeto é violação, então a declaração saiu com o objeto). A mutação **M12** da
suíte prova a publicação: com a derivação da fila morta, o verde deixa de
nomear — e a suíte unitária fica vermelha no PR.

**O GRAU é um FATO, não um detalhe:** `binario` (o binário do `node_modules`:
`vitest`, `tsc`), `estatico` (`import` de topo — carrega sempre, o desfecho sem
deps é o CRASH `ERR_MODULE_NOT_FOUND`) e `tardio` (specifier alcançado só
dentro de função: pode nunca ser percorrido, e por isso admite `passa`).

**A data da decisão e a revisão vencida (`--review`):** a `JOB_DEPS_ALLOWLIST`
segue a MESMA regra das outras allowlists, do módulo compartilhado
`allowlist-review.mjs` — registro ausente/inválido/no futuro é violação nos
dois modos (fail-closed); passada a janela `JOB_DEPS_REVIEW_DAYS` (180 dias), o
scan normal **avisa** (`::warning::`) e o `--review` escala a **violação**. É o
canal do job semanal `registry-allowlist-review` (`benchmark-weekly.yml`), ao
lado dos outros quatro; e a lista entra no `declared-debt.mjs` (a idade da
dívida aparece no relatório do doctor).

**O QUE FICA FORA, declarado e nomeado na saída (nunca escondido):** comando
cujo alvo o guard não classifica (programa desconhecido, alvo montado em
`${{ }}`) sai em `foraDoEscopo` com a CATEGORIA e o motivo — um job que só tem
comandos fora do escopo NÃO ganha isenção implícita; `sh -c`/`node -e`
(payload inline) ficam fora, porque não há transitividade de dependência a
seguir num payload (INDETERMINADO por construção, não por limitação do guard); e
o estado REAL do runner (se a imagem embarca `node_modules`) fica fora por
construção — o guard lê o REPOSITÓRIO, e é exatamente por isso que a isenção
precisa de motivo: quem responde "de onde vem" é quem assina a decisão.

**A CATEGORIA de um comando com flag na frente do programa sai da CLASSE do flag**
— a MESMA régua do `check-hook-commands` (`alvoDoLancador` → `classeDoFlag`, por
interpretador), no lugar de um `tokens[0].startsWith("-")`. O que muda no
veredito desta árvore (117 jobs, 120 comandos fora do escopo, medido):

| comando                                                       | antes                                              | agora                                                                                                                                  |
| :------------------------------------------------------------ | :------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------- |
| `node -e`, `node -`, `python3 -c` (13)                        | `payload-inline`                                   | `payload-inline` — agora PROVADO pela classe (o `-e` do node é o eval DELE)                                                            |
| `node --version` (3)                                          | `payload-inline`                                   | `sem-alvo`: o programa se apresenta e sai — o rótulo antigo dizia “o script vive no argumento” de um comando que não lê arquivo nenhum |
| `bash -n x.sh`, `node --check x.mjs`                          | `payload-inline`                                   | `conferencia-de-sintaxe`: nada é executado, não há interior a seguir                                                                   |
| `bash -o pipefail x.sh`, `node -r x.mjs`                      | `payload-inline`                                   | `flag-nao-provado`: o flag pode consumir o token seguinte — o alvo não é chutado                                                       |
| `bash -u x.sh`, `node --no-warnings x.mjs`, `python3 -B x.py` | `payload-inline` (**fora do escopo, sem decisão**) | **JULGADO**: o flag não é o alvo, e o arquivo atrás dele entra no grafo (o corpo do shell conta)                                       |

O TOTAL de comandos fora do escopo não muda (120) — o que muda é QUEM entra no
julgamento (o alvo que estava atrás do flag) e COMO cada um é nomeado: nomear
errado é pior que nomear, porque a categoria é o que o operador lê para decidir
se declara a isenção.

**Onde roda:** passo `Job dependencies (install or declared exemption)` do job
`guards` nas DUAS forjas (`ci.yml` da Gitea e `pr-check.yml` do GitHub) — a
Gitea instala, o GitHub espelha, e a varredura cobre os jobs das duas (a
assimetria é justamente o que o gate torna mecânica). A revisão vencida roda no
job semanal. Mutation test: `scripts/test-mutation-job-deps.sh` (12 mutações — o
install que some, o `addedAt` que some, a leitura do grafo de imports, a regra
do sem-objeto, a escalada do `--review` e a CLASSE do alvo: com o flag voltando a
ser lido como alvo, um `bash -u scripts/corpo.sh` que roda `pg` de topo sai do
escopo e o job sem install passa; e as três do CAMINHO — o `runs-on` mutado, a
classe derivada mutada, que ACUSA o job são, e a exceção sem objeto), na matriz
do master. Leitura
fail-closed de sempre (arquivo ilegível ou YAML inválido NÃO vira "nada a
julgar") e a MESMA extração de comandos
([`shellCommands`](#24-os-comandos-que-os-hooks-executam-têm-de-resolver--check-hook-commands-scriptscheck-hook-commandsmjs))
e o MESMO resolvedor de bare specifiers
(`extractBareSpecifiers`/`resolveImport`) — não existe uma segunda régua do que
é um comando nem do que é um import.

---

## 13. O agregador de prontidão — `doctor` (`scripts/forge-doctor.mjs`)

**Isto NÃO é um guard.** É o comando que roda a bateria da forja e junta os
veredictos num só: `bun run doctor`. Ele existe porque cada peça tinha seu
guard e ninguém respondia à pergunta inteira ("a forja está pronta para
bloquear o merge?") — e as respostas parciais alinhavam num sentido falso:
`check-forge-parity` prova que a pipeline da forja **contém** as invariantes do
CORE (não que elas passam agora); `check-required-checks` prova que o manifesto
aponta para jobs que existem (não que a forja aplicou o manifesto — isso o doctor
lê agora); `runner-image:ensure` prova a imagem (e não sabe nada sobre os
guards).

**A bateria é DERIVADA, não listada:** o doctor fatia o job `guards` de
`.gitea/workflows/ci.yml` — a pipeline dona do merge — e executa os gates que
estão lá, usando a mesma classificação do `check-forge-parity`
(`discoverGates`). Um guard novo na pipeline entra no doctor sozinho; um guard
removido de lá some daqui. Não existe lista paralela para envelhecer.

**A bateria roda CONCORRENTE, e a otimização não muda o veredito:** os gates
saem do mesmo `discoverGates` e rodam com **paralelismo limitado**
(`runGatesConcurrent`, `DEFAULT_GATE_CONCURRENCY = 4` — processos `bun`/`node`
que já usam vários cores cada um; um por core satura a máquina e piora o wall
time). Quatro é conservador para caber num runner compartilhado e suficiente
para o teto do tempo passar a ser o gate mais lento, não a soma das durações
(medido aqui: a bateria de 16 gates cai de **3,8s para 1,3s**). O que faz disso
uma otimização e não uma mudança de contrato: os resultados voltam na **ordem da
bateria** (`results[i]`, não por ordem de conclusão), o shape é o mesmo do
caminho síncrono (`shapeGateResult`), um gate que estoura vira **NÃO
VERIFICADO** (`code: null`) sem derrubar os outros, e o `run` **injetado** (o
dublê síncrono dos testes) desvia para o caminho sequencial (`runGuards`) — um
dublê é determinístico e observa a ordem de chamada; paralelizá-lo só mudaria o
que os testes veem.

**E a identidade da imagem é MEMOIZADA:** a mesma pergunta ("que build a tag
serve hoje?") era feita por **dois** fatos (a invariante 9 das referências e o
contrato da imagem publicada), cada um abrindo a própria ida ao registry
(manifesto + config blob, e token em pacote privado). Agora os dois dividem
`createRegistryIdentityCache` — e o cache guarda a **resposta classificada**
(`proven`/`mismatch`/`no-label`/`missing`/`unauthorized`), não um booleano:
"não deu para saber" continua sendo devolvido como **INDETERMINADO** a cada
consumidor. A chave inclui `ref`, a versão esperada e se
há credencial — **nunca o token**; **exceção** e os estados **transitórios**
(`unreachable`/`error`, que são ausência de resposta) não são cacheados — uma
falha passageira não pode virar veredito permanente, e cachear o `unreachable`
de um timeout curto apagaria a prova de quem pediu com timeout maior; e chamadas
**concorrentes** do mesmo probe deduplicam (a segunda espera a primeira).

O `timeoutMs` fica **fora** da chave de propósito, e é o que faz o cache existir
de fato: o fato das referências pergunta com 20s e o do contrato com o default do
probe — com o timeout na chave o cache **nunca acertaria** e seria decorativo, sem
nenhum sintoma. Há um teste que conta as idas ao registry pelos **dois** fatos e
exige **uma** (com o `timeoutMs` de volta na chave ele fica vermelho: provado por
mutação).

**A trava que ele carrega (defeito real, cometido e corrigido):** o rótulo que
o descobridor devolve para uma invocação direta é só o CAMINHO —
`node scripts/rotate-secrets.mjs --check` vira o rótulo `scripts/rotate-secrets.mjs`,
com o lançador e a flag descartados. Executar o rótulo como comando rodaria o script na
modalidade de EFEITO (no caso do `rotate-secrets`, preparando uma rotação de
segredos como efeito colateral de um relatório). Por isso o doctor executa a
LINHA `run:` (que preserva as flags) e ainda exige um modo de verificação
(`--check`/`--ci`, entrada `check:`, ou script `check-`/`validate-`/`audit-`/
`test-mutation-`/`run-`) — sem isso ele NÃO executa, e diz por quê.

**A PROVA do bloqueio (seção 4/7 do relatório):** a seção da imagem dizia se a
tag existe AGORA — o que não responde "a subida da stack depende dela?", que é a
pergunta que importa. O doctor executa então `proveRunnerImageGate`
(`scripts/prove-runner-image-gate.mjs`, o mesmo que `runner-image:prove`): ele roda o
`deploy/gitea-up.sh` REAL contra um registry de TESTE em 127.0.0.1, com a tag
ausente e com a tag presente, e afirma sobre o LOG do `docker` dublê — com a tag
ausente NENHUM `compose up` acontece; com a tag presente, `up -d runner` sim. É o
CONTROLE que faz disso uma prova: sem ele, "o runner não subiu" seria satisfeito
por um script quebrado.

**E o GATE que a cobra no merge (o outro lado do item 4/7):** a prova acima mede
o COMPORTAMENTO da subida, mas o doctor não cobria o elo que faz dela um gate —
o job `bring-up-proof` estar no **contrato de merge** (`ci/required-checks.json`),
a linha `run:` do job executar a prova **E a branch protection da forja REGISTRAR
o check**. Três frestas, todas fechadas:

1. o manifesto deixa de exigir o job → o PR passa sem a prova (o manifesto fica
   **válido e menor**, a proteção em sincronia com ele e o check verde);
2. o job exigido deixou de executar a prova → o check fica verde sem medir nada
   (gate decorativo);
3. o contrato exige o job E o job roda a prova, mas a branch protection da forja
   **NÃO registra o check** → o merge passa sem a prova (o manifesto é a
   intenção; a proteção é quem obedece).

As duas primeiras são o `readBringUpGate` original; a terceira cruza o gate com
o `readProtection` (seção 1) — se o contexto do `bring-up-proof` aparece entre
os checks que faltam na branch protection, a violação é nomeada. O fato responde
independente da prova ter rodado agora: `--no-proof` (removida) **não** escondia um gate
fora do contrato. `--no-protection` faz o fato cair em `unavailable` (a
proteção não foi lida, o registro não pode ser confirmado).

**E A PROVA DO BLOQUEIO LOCAL (a outra metade da seção 4/7): o pre-commit × o
corpo `run:` quebrado no ÍNDICE.** A garantia de que um `git commit` carregando
um corpo `run:` quebrado no índice é RECUSADO existia só em
`src/lib/__tests__/pre-commit-git-commit-blocks.test.ts` — uma promessa sobre
quem lembra de rodar a suíte, invisível para o veredito de prontidão. Agora o
doctor **executa a mesma prova** (`proveCommitBlocks`, de
`scripts/pre-commit-proof.mjs`, o MÓDULO que o teste importa: uma régua, dois
consumidores) e publica o desfecho com o vocabulário de sempre:

- `proven` — um `git commit` de verdade com o corpo quebrado no índice é
  recusado (exit ≠ 0, **zero objetos de commit**, HEAD ausente) **E** o mesmo
  commit com o corpo fechado ENTRA (exit 0, um objeto, conteúdo conferido em
  HEAD). A segunda metade é o CONTROLE: sem ela, "não commitou" seria
  indistinguível de um fixture que não sabe commitar;
- `violated` — o defeito ENTROU no histórico (o hook deixou passar): BLOQUEIA o
  veredito, com a prova de que o corpo quebrado está em HEAD (e, se o hook não
  executa mais a linha do guard, o relatório diz isso também);
- `unavailable` — não deu para provar: sem `.husky/pre-commit`, sem o fecho do
  guard, sem `node_modules`, sem git/bash, ou CONTROLE que não comitou. Vira
  falta de prova NOMEADA, nunca verde.

O que a prova NÃO presume: ela mede o COMPORTAMENTO, não a linha literal — um
hook reestruturado que continue bloqueando segue `proven` (e o relatório diz que
o caminho não é mais a linha conhecida). O que ela não alcança está dito: quem
cobra o comando do hook no contrato de merge é o `check-hook-commands` (seção
24), e o CI **não** executa o hook — a prova é local, e é justamente por isso que
ela entra ATÉ no perfil `--ci` (barata: ~0,3s, sem rede e sem credencial).
`--no-pre-commit-proof` a pula e o veredito fica INDETERMINADA nomeando o fato
que ficou fora (no recorte do merge, BLOQUEIA: ver a regra do `--ci` abaixo).

**E O OUTRO ELO LOCAL: o pre-push × a ÁRVORE vermelha.** O commit e o push medem
promessas DIFERENTES num lugar diferente, e é por isso que são DUAS PARTES de um
MESMO fato, cada uma com estado e prova próprios, e não uma linha do mesmo. No
commit o veredito é "nenhum objeto de COMMIT foi criado",
e ele vive no banco local. No push, o git **consulta o remoto ANTES de rodar o
hook** e só manda o pack **DEPOIS** dele: um hook de push que passa (ou que
falha) não deixa rastro nenhum no repositório local — o que ele promete só existe
DO OUTRO LADO. A prova (`provePushBlocks`, de `scripts/pre-push-proof.mjs`, o
módulo que o teste `pre-push-git-push-blocks.test.ts` importa) empurra duas vezes
contra um remoto **bare** e mede no REMOTO:

- `proven` — o push com a árvore VERMELHA é recusado (exit ≠ 0, **zero ref e
  zero objeto** no remoto, `refsOf`/`countObjects`) **E** o mesmo push com a
  árvore verde CHEGA (a ref `refs/heads/main`, o conteúdo conferido na ref e o
  CONTROLE com o typecheck rodando de verdade — sem ele, "nada chegou" seria
  indistinguível de um fixture que não sabe empurrar);
- `violated` — o defeito CHEGOU ao remoto (o hook deixou a árvore vermelha
  passar): BLOQUEIA o veredito, com a contagem do que chegou;
- `unavailable` — não deu para provar: sem `.husky/pre-push`, sem `bun` no PATH
  (a fase do typecheck morreria com `command not found` e o não-zero seria do
  AMBIENTE, não do defeito), sem git/bash, ou CONTROLE que não chegou. Falta de
  prova NOMEADA, nunca verde.

A recusa só conta como veredito se a saída do hook CITAR a reprovação do
typecheck (`TYPECHECK_DO_FIXTURE_REPROVOU`) **e** o processo real tiver registrado
a invocação no fixture: um não-zero por ambiente bloquearia por outro motivo e a
prova estaria medindo o fixture. Como no commit, a prova mede COMPORTAMENTO e não
a linha literal — um hook reestruturado que continue bloqueando segue `proven`.
Ela entra ATÉ no perfil `--ci` pelo mesmo motivo e ao mesmo preço (~0,2s, sem
rede e sem credencial: o hook roda na máquina de quem empurra, e o CI não o
executa). `--no-pre-push-proof` a pula e o veredito fica INDETERMINADA nomeando a
PARTE que ficou fora — a mesma disciplina do elo do commit: cada parte tem estado
PRÓPRIO dentro do fato, e pular ou violar uma não esconde a outra (o estado do
fato é o PIOR das partes, que é o que o veredito lê).

**E A TERCEIRA PARTE DO FATO É O LIMITE DESSA PROMESSA — MEDIDO.** As duas partes
anteriores respondem "o hook bloqueia?", e a resposta é sim. O que elas NÃO
dizem — e que um veredito não pode deixar implícito — é que o git entrega ao
próprio autor do push o interruptor que desliga o bloqueio: **`git push
--no-verify` não executa o hook**. Se o repositório confundisse "o pre-push está
provado" com "a árvore vermelha não chega a `main`", a barreira seria a mais
frágil possível — ela só valeria para quem não a desliga. Então o mesmo módulo
mede as duas metades do limite (`provePushBypass`, o MESMO fixture):

1. **o defeito CHEGA.** No fixture em que o push COM o hook é recusado (o
   controle: exit ≠ 0, **zero objeto** no remoto), o MESMO push com a flag sai
   **exit 0**, o remoto ganha a ref e os OBJETOS, o conteúdo com o marcador é o
   que está na ref — e as invocações do payload do typecheck continuam as do
   controle: o hook **não rodou** (é o que separa "contornou" de "o gate
   deixou passar", duas coisas diferentes);
2. **quem barra é o CI.** O conteúdo que chegou é julgado ONDE o merge o julgaria:
   um **CLONE do remoto** (não a árvore de trabalho de quem empurrou) roda o
   comando do gate, e o veredito dele é lido ali — reprovado. O relatório NOMEIA
   o job (a invariante CORE `typecheck` do `CORE_INVARIANTS`, uma fonte só), em
   vez de dizer "o CI" no vazio.

As duas metades de "quem barra depois" são medidas em LUGARES DIFERENTES e
nenhuma substitui a outra: o **sinal** (o conteúdo que chegou reprova o comando do
gate) é medido aqui, sobre os bytes que viajaram; o **efeito na forja** (um PR com
o check required vermelho não mergeia) é a prova `prove-gitea-merge-gate`, contra
um Gitea efêmero de verdade. O que impede o buraco de reabrir em silêncio é o
segundo lado continuar no **contrato de merge** — e é isso que a linha do "NÃO
CUBRE" cobra de quem lê.

O `state` dessa parte segue o vocabulário do resto: `proven` é o limite medido e
**o CI barrando**; `violated` é o defeito passar pelos **dois** lados (o hook
contornado E o gate do CI sem reprovar o que chegou) — aí não há rede nenhuma, e
o veredito BLOQUEIA; `unavailable` é não ter dado para medir (e, no recorte do
merge, também bloqueia: medir o contorno usa o mesmo fixture dos elos). Contornar
o hook NÃO bloqueia — isso é o desenho do git, e é justamente o que a parte
declara. No relatório ela sai como linha própria ("limite (git push --no-verify)"
com o contorno medido e "quem barra: 'bun run typecheck' … → exit 1") e, no
`--json`, dentro do MESMO fato `localContract`. Quando medida, ela também entra
na lista do "NÃO CUBRE", em texto: é a conclusão que o fato, sem essa linha,
deixaria o leitor tirar sozinho.

**E as partes são UM fato só — o `localContract`.** Antes este assunto vivia em
TRÊS lugares: os dois fatos de topo (`preCommitBlock` e `prePushBlock`, um por
elo) e o contrato dos COMANDOS dos hooks, que só existia no gate
(`check-hook-commands`, §24) e **nem era declarado** na prontidão — o relatório
dizia uma coisa e a bateria outra, sem ninguém para arbitrar. Agora é um fato de
topo com as QUATRO partes (os dois elos EXECUTADOS + o que cada hook RODA + o
LIMITE do gate local, medido), e o
veredito — bloqueios, faltas de prova, relatório impresso e `--json` — consulta
esse fato, e só ele. A **régua não foi recopiada**: a parte dos comandos é o
`analyze` do `check-hook-commands` importado (o dono da régua), com a mesma
descida nos scripts que os hooks chamam; a parte dos elos é o mesmo
`proveCommitBlocks`/`provePushBlocks` das suítes. Um comando que NÃO resolve — o
"passo que nunca roda" — virou parte do fato pelo mesmo motivo: é o mesmo
assunto, medido no mesmo lugar, e um hook quebrado bloqueia como um elo quebrado.
O `skip` de cada elo entrou para DENTRO do fato (`links['pre-commit'].state =
'skipped'`, nomeado com a flag que o pulou), em vez de viver numa flag paralela do
relatório — é isso que faz o `--ci` ver `skipped` como **elo quebrado** em vez de
"falta de prova".

**E no recorte do MERGE (`--ci`) o CONTRATO LOCAL INTEIRO — os dois elos
EXECUTADOS e o que cada hook RODA — tem de sair PROVADO.** Aqui a disciplina é a
INVERSA da do perfil completo, e por um motivo que se mede: no `--ci` as QUATRO
partes do fato só precisam de git/bash/bun e do próprio checkout — não há rede,
credencial nem docker que justifiquem um `unavailable`. E é exatamente este
recorte que o job do PR roda a cada merge: se `unavailable` valesse como "falta de
prova", bastaria o YAML do job ganhar um
`--no-pre-commit-proof`/`--no-pre-push-proof` para o elo quebrado passar **verde
no merge** (a flag vira `skipped`, e `skipped` ≠ provado); bastaria a metade
dos COMANDOS não ser lida para o "passo que nunca roda" deixar de ser cobrado no
portão; e bastaria a parte do LIMITE não ser medida para o veredito voltar a
calar quem barra o defeito depois do hook. Com `--ci`, então, todo estado que não seja `proven` — `unavailable`,
`skipped`, parte ou fato ausente — vai para os **bloqueios**, nomeando o elo (ou
o hook), a flag que o tirou de cena e o conserto; `violated` continua bloqueando
pelo motivo dele (o defeito chegou), sem linha duplicada. Fora do `--ci` a regra é
no-op: no perfil completo falta de prova segue INDETERMINADA, porque lá o doctor
cobre o que depende do HOST e "não deu para medir" é o veredito honesto.

**E o mesmo contrato vale para TODO gate CORE, não só o bring-up.** O fato é
DERIVADO dos `CORE_INVARIANTS` (uma fonte só): cada invariante que declara
`jobIds` vira um contrato verificável, e o doctor responde a mesma tríade para
cada um — o job está no manifesto? o job RODA o comando? a proteção o registra?
Três regras fazem a resposta ser sobre o job REAL, e cada uma nasceu de um falso
positivo que deixava o veredito **BLOQUEADO para sempre** — e um veredito que
sempre acende não bloqueia nada (o bring-up recusa subir, o cron abre issue toda
semana, e a violação verdadeira se perde no meio):

1. **só as forjas que DECLARAM o job.** Uma invariante pode existir numa pipeline
   e não na outra (as isenções GitHub-only, com razão escrita, do
   `check:forge-parity`): conferir o `lint` da Gitea no manifesto do GitHub acusava
   "a forja github NÃO exige o job 'lint'" — verdade inútil, e oito delas de uma vez.
   **O que FALTA numa pipeline é pergunta do `check:forge-parity`**; este fato
   pergunta pelo que o manifesto EXIGE e se o exigido roda o que promete.
2. **a régua é DA INVARIANTE — a MESMA nas duas forjas.** O comando compartilhado é
   o script `lint` do `package.json` — prettier --check MAIS eslint com
   `--max-warnings 0`, na mesma linha —, e as duas forjas rodam exatamente
   `bun run lint`. Houve aqui uma tabela de
   régua por forja (`matchesByForge`, no `CORE_INVARIANTS`) que declarava o comando
   de cada lado — e ela EXISTIA porque os comandos eram de fato diferentes: o
   `lint` do `package.json` era só `eslint .` (sem o teto de warnings, sem
   prettier) e o par completo vivia INLINE no job `lint-guard` do GitHub. O
   resultado era o pior desenho possível de um gate: o mesmo commit passava no
   merge da Gitea e era rejeitado no GitHub — dois vereditos para um merge só, e
   quem liberava era o lado mais fraco. A tabela descrevia a assimetria com
   precisão e, ao fazê-lo, a transformava em contrato. Hoje a régua mora em UM
   lugar e as duas forjas a INVOCAM; se um dia uma forja precisar de outra coisa,
   o conserto é mudar o comando COMPARTILHADO — reabrir a segunda régua é reabrir
   o furo.
3. **um contrato por (invariante × job), não por job.** Oito invariantes CORE
   vivem no MESMO job `guards` da Gitea: deduplicando pelo job, sete apareciam como
   cobertas sem nunca terem sido medidas — a régua da primeira respondia pelas
   outras sete. Hoje as 18 pontas (invariante × job declarado no manifesto) são
   conferidas uma a uma, e a remoção do comando de UMA derruba a régua daquela, não
   a do vizinho.

E o comando vem do JOB, não do RÓTULO do passo: o job `check` do GitHub tem o
passo "Guard: no @ts-nocheck in non-generated files" ANTES do que roda a suíte, e
casar pelo rótulo acusava de "gate trocado" um job que executa `bun run test:run`
— a busca pela régua vem primeiro e o rótulo só serve para NOMEAR a linha na
violação. A suíte (`forge-doctor.test.ts`) mede isso contra uma fixture FIEL às
duas pipelines — duas pipelines, uma por forja, cada job com o comando que roda
lá —, com o CONTROLE que remove o comando e exige a violação: o fixture antigo
escrevia os jobs do GitHub com os comandos da Gitea, e era por isso que este fato
podia acusar o repositório real sem que a suíte visse nada.

**E o "NÃO CONFERIDO" de CLASSE sai UMA vez: uma causa, uma linha.** Quando a
branch protection de uma forja não pôde ser lida (ou o recurso não existe),
TODOS os gates que ela declara saem pelo MESMO motivo. MEDIDO no perfil completo
em 22/09/2026 (com `GITHUB_REPOSITORY` resolvida e a Gitea sem token): **71
linhas de "não provado", 64 delas repetindo duas causas** — a mesma frase 64
vezes. Uma causa repetida N vezes não são N problemas: é UM, e o muro escondia o
resto do veredito (que tem onze assuntos). O veredito passou a publicar **uma
linha por (causa, forja)** — as 64 caíram para **2** (os **30** gates da forja
sem o recurso e os **36** da forja não lida) —, com a CONTAGEM e as invariantes
alcançadas, e o gate que tem DUAS causas aparece nas duas linhas — são duas
lacunas, com remédios diferentes (dar o token × tornar o repositório
público/Pro). O detalhe por gate continua no FATO (`gateContracts.results[]`,
com a `detail` própria): o que mudou é o que o veredito PUBLICA, não o que ele
MEDE — e é por isso que a agregação vive numa função do dono do veredito
(`gateContractUnknowns`), alimentada por um campo DECLARADO (`causes[]`), nunca
por casamento de prosa.

O par de causas da PROTEÇÃO saiu do mesmo conserto: elas eram um `else if`, e
com o espelho sem o recurso (403) e a Gitea sem token o veredito publicava só a
primeira — a leitura que FALTAVA (a que fecha com `GITEA_TOKEN`) desaparecia das
linhas dele. Agora cada causa tem a sua linha, nomeando as forjas de cada uma.

**E a promessa do registro passou a ser medida pelo lado das LINHAS:** no estado
medido do perfil completo, **nenhuma** das três listas (bloqueios, não-provados e
"o veredito não cobre") sai sem data — e é isso que o teste `COBERTURA TOTAL`
exige, com os fatos daquele dia (as duas causas de proteção, o env ausente, os
espelhos sem valor, o contrato da imagem e os dois registros de runner sem
leitura). Uma causa NOVA que passe a ser publicada sem declaração datada que a
cubra falha o PR aqui, e não depois, num relatório que ninguém lê.

**E o PRÉ-REQUISITO 0 (família `env-mirror`):** três casos rodam com o env do host
DIVERGENTE e a imagem PRESENTE — a subida normal, o `--check-only` e o SEGREDO com
o mesmo valor do placeholder do template (a assimetria da regra: num segredo,
IGUALAR é o defeito). A imagem está lá de propósito: se a stack não sobe mesmo
assim, a causa só pode ser o passo 0 — e o zero de idas ao registry prova que a
recusa veio ANTES do ensure. A mutação que tira o bloqueio do passo 0 (`if false`
no lugar da recusa) derruba os três casos, e o teste da prova exige exatamente
isso.

**E o RE-REGISTRO (o caminho que troca os labels):** ele APAGA o registro gravado
antes de subir, e um registro que fica para trás mantém os labels antigos com o
tier-1 desligado — sem sintoma. A prova cobre esse caminho com **quatro casos**, e
para isso o dublê do docker ganha ESTADO (`volume inspect`/`volume rm`, com um
modo `stuck` em que o docker diz que removeu e o volume continua lá). Três coisas
que só o comportamento diz, nenhuma delas visível no texto do script:

| Promessa do re-registro                                                               | Como a prova a quebra                                   |
| :------------------------------------------------------------------------------------ | :------------------------------------------------------ |
| **sem a imagem garantida NADA é destruído** (nenhum `compose rm`, nenhum `volume rm`) | mutação que apaga o registro antes de conferir a imagem |
| **com a imagem, a ordem é `rm -sf runner` → `volume rm` → `up -d runner`**            | mutação que sobe o runner antes de apagar o registro    |
| **registro que não sai ⇒ o script RECUSA subir**                                      | mutação que ignora o volume sobrevivente                |

Invertida a ordem, o runner sobe com o registro ANTIGO e nada acusa; apagado
antes da garantia, a falha leva consigo o registro que funcionava (o oposto do
runbook antigo, que apagava primeiro e conferia depois). Cada promessa tem a sua
mutação do `gitea-up.sh`, e o teste exige que a prova caia junto com ela.

**E o HOST SEM REGISTRY (família `registry-offline`): a DECISÃO, medida nos dois
sentidos.** O registry de teste ganhou um terceiro modo — **inalcançável** (a
porta existe e não responde; é o estado em que o ensure nunca publica) —, e o
dublê do docker um estado de cópia local. Três casos, e nenhum é dispensável: sem
a flag, o gate de sempre recusa (exit 3, **zero** docker e **zero** idas ao
registry); com a flag e **sem** a cópia local, ainda recusa — a flag não é cheque
em branco — e o remédio que constrói a imagem aqui é impresso (é ele que fecha o
beco); com a flag e a cópia, a stack SOBE — o CONTROLE, sem o qual "recusou"
passaria por "o gate funciona" num bring-up quebrado. A decisão tem DUAS metades,
uma por arquivo — o **bring-up decide** (repassa a flag, reconhece o exit 6 e o
nomeia) e o **ensure prova** (o probe local, dono do estado) —, e o teste da prova
mede as duas, com uma mutação cada: tirar o REPASSE da flag derruba o CONTROLE (a
cópia deixa de ser pedida); aceitar o INDETERMINADO cru (`-eq 3` no lugar do
exit 6) derruba a recusa de sempre (o beco viraria permissão silenciosa); o ensure
não devolver o estado próprio derruba o CONTROLE (a cópia vira UNKNOWN); e o probe
local respondendo `present` sempre faz da flag um cheque em branco (o caso SEM a
cópia sobe). As duas últimas mutam o ARQUIVO do ensure, não o bring-up: mutar uma
metade só deixaria a outra sem medida.

**A prova por MUTAÇÃO** (`scripts/test-mutation-local-image.sh`, as metades `M1`,
`M2`, `M3` e `M4`): a suíte unitária diz que o comportamento de HOJE está certo;
ela não diz que as REGRAS que o sustentam seguem no caminho — e é aí que a
decisão degrada em silêncio. O sub-test da matriz desliga uma regra de cada vez e
exige que o veredito MUDE: o REPASSE da flag (`M1`: o `--local-image` deixa de
chegar ao ensure e o CONTROLE cai, o host sem registry voltando ao beco), a
ACEITAÇÃO do INDETERMINADO (`M2`: o exit 3 cru passa por decisão e a recusa de
sempre cai) e as duas metades do ensure, o ESTADO próprio (`M3`: a cópia local
vira UNKNOWN) e o PROBE local (`M4`: responder `present` sempre faz da flag um
cheque em branco). A leitura por execução roda a PROVA REAL
(`prove-runner-image-gate.mjs`) contra o registry de teste e o daemon dublê e lê o
RESULTADO por caso — o exit, se o runner subiu, os `ensureArgs` que o ensure
RECEBEU e a falha nomeada; a segunda testemunha é o describe da decisão na suíte
unitária, que tem de ficar VERMELHA na âncora da metade mutada. Sem as quatro, um
PR que devolvesse o beco (o repasse da flag fora do bring-up, ou a cópia local
aceita sem prova) passaria no CI em silêncio.

**E as FLAGS deixaram de ser uma leitura do texto.** O guard `checkGiteaBringUp`
prende no TEXTO do `gitea-up.sh` que a linha do espelho tem `--host`/`--template`,
que a do doctor tem `--gitea-env` (sem flags --no-* que escondam fatos), e que o `--re-register`
acrescenta `--no-runner-labels`. A prova agora mede isso no **argv do processo que
rodou**: o espelho e o ensure são envolvidos por **espiões** (que delegam ao script
REAL do repositório — a família `env-mirror` julga o comportamento deles, e um
dublê que só gravasse o argv trocaria a recusa por um "sim") e o dublê do doctor já
gravava a própria invocação. Cada caso declara o que o bring-up TINHA de ter
passado, com os arquivos DESTA subida — um `--gitea-env` apontado para outro arquivo
**passa no desfecho e cai na medida** (é o teste que existe para isso), e
`--env-file` no ensure é violação explícita (é flag do Node: com o arquivo ausente
ela mata o processo em exit 9, sem a mensagem do bring-up). O relatório imprime a
linha recebida por cada filho, junto de "parou ANTES do passo 2" quando o caso
recusa antes do doctor — a ORDEM (espelho → ensure → doctor → `up`) vira um fato do
registro ordenado, e não uma inferência do exit.

**E as INSTRUÇÕES (família `instructions`): o comando que se copia é EXECUTADO.**
O instalador (`deploy/setup-gitea.sh`) e o runbook (`deploy/GITEA.md`) trazem os
comandos prontos, e o guard de texto só provava que eles **mencionavam** o
bring-up — o que não distingue "o caminho que ele imprime funciona" de "está
quebrado". A prova agora **extrai** a instrução do documento (só linhas de `echo`
no instalador, só o bloco CERCADO no runbook; forma inesperada **não é executada**:
é erro) e a **roda**: o instalador com `$GITEA_DIR`/`$REPO_DIR` resolvidos nos
diretórios do caso (com o compose copiado e o `.env` criados, que é o estado que a
instrução pressupõe), o runbook com as FLAGS que ele ensina contra o registry de
teste. Um `--re-register --turbo` ensinado na doc **continua contendo a string que
o guard de texto exige** e mesmo assim derruba a prova: o bring-up recusa a flag, e
o relatório diz de qual instrução ela veio. Duas instruções do instalador (a de
subida e a de conferência) e uma do runbook — nenhuma delas "menciona", todas rodam.

Uma prova VIOLADA bloqueia o veredito — é o caso mais grave da família, porque o
remédio não é publicar imagem nenhuma, é consertar a
subida. Sem `bash`/bring-up o estado é `unavailable` (INDETERMINADA), nunca
"provada"; a prova sempre roda em invocação manual — quem precisa de recorte usa --ci.

**AS DUAS METADES do contrato de merge (seção 1/7):** a seção 1 mostra, lado a
lado, o que o repositório **DECLARA** e o que a forja **REGISTRA**. A primeira
metade é o manifesto (`check:required-checks`); a segunda — `readProtection` — é
o **branch protection de verdade**, o único estado que faz um merge esperar.
Sem ela, o modo de falha é o pior desta família: o `name:` de um job renomeado
muda o **contexto de status**, o manifesto passa a exigir um check que nunca
roda e o PR trava **para sempre** — nenhum teste de PR enxerga isso (no PR o job
novo existe e passa), e o `check-required-checks` continua verde porque o
workflow existe.

A leitura NÃO reimplementa a comparação: chama `apply-required-checks.mjs
--check --forge <forja> --json` — o **mesmo** comando que o cron de drift usa nos
dois lados (`required-checks-drift.yml`). Um segundo comparador divergiria do
primeiro justamente no dia do drift. As forjas lidas saem do **manifesto** (uma
fonte): uma terceira forja entra na leitura sozinha.

O cron que vigia esse estado não termina o run só com o diff no log: ele publica
a dívida como **ISSUE** com dedup por assinatura — no GitHub pela CLI `gh`
(histórico) e **na forja pela API do Gitea** (`--backend gitea`), com o MESMO
`required-checks-drift-issue.mjs`: o que é drift, o texto e a assinatura são uma
fonte só, e o backend apenas troca quem cria o ticket. Era o elo que faltava —
quem bloqueia o merge é a forja, e ali o drift terminava como cron vermelho, o
alerta mudo que este repositório trata como defeito. A publicação acontece ANTES
do `exit 1` (depois dele, o step da issue nunca rodaria) e o `GITEA_TOKEN`
precisa de escrita em issues.

**E o cron também FECHA a dívida (o outro lado):** o step da issue roda
`always()` — inclusive no run **em sincronia**, que é justamente quando não há
drift nenhum a reportar. É ali que o publicador **reconcilia**: comenta o que
foi comparado (a prova) e fecha as issues que ele mesmo abriu. Condicionar o
step ao `exit_code != '0'` faria o fechamento sumir em silêncio — a issue ficaria
aberta para sempre depois de resolvida, e o próximo rename seria investigado
duas vezes. Só fecha o que é NOSSO (marcador, nunca só o label), comenta ANTES de
fechar (uma falha no meio deixa a dívida aberta COM a prova, nunca fechada em
silêncio) e, se o drift voltar, abre uma issue nova (o dedup é entre as ABERTAS).

**A prova do fechamento é uma COMPARAÇÃO, não uma afirmação.** O comentário não
diz só "resolvido": ele nomeia os **dois lados** — os contextos que o manifesto
exigia (`desired`) e a diferença medida em cada branch (`faltando` / `a mais`).
A diferença sai dos **dados**, nunca do veredito `inSync`: um relatório que se
diga "em sincronia" com itens faltando é **desmentido pela própria prova** que o
fecha. E uma lista **ausente** no relatório sai como "não informado no relatório":
`nenhum` é reservado para a lista que veio **vazia de fato** — a prova não pode
afirmar mais do que sabe.

O fechamento é provado **nas duas forjas**, cada metade com a técnica que enxerga
o defeito dela: na **forja**, o CLI real contra um Gitea dublê com estado
(`required-checks-drift-issue-gitea.test.ts`); no **GitHub**, o CLI real com um
`gh` dublê no `PATH` e estado entre runs
(`required-checks-drift-issue-github.test.ts`) — o default do CLI e do workflow,
onde antes só havia a asserção de que o backend é _selecionado_, e selecionar não
é fechar. As duas provam o ciclo **entre runs** (a run 2 enxerga o que a run 1
deixou) e a **ordem** (comentar antes de fechar).

Três resultados, e eles não se confundem: **drift** (falta um check, sobra um, ou
o aplicador sinaliza drift sem nomear contexto) **BLOQUEIA**, nomeando a forja e
o remédio (`bun run ci:required-checks -- --apply`); **em sincronia** não muda o
veredito; **não lida** (sem token de administração, aplicador que não terminou,
forja ausente do relatório) é **INDETERMINADA** — nunca "em sincronia", que seria
a mentira otimista. O token precisa de permissão de **administração** no repo (o
`GITHUB_TOKEN` padrão não a tem), e é por isso que esse caso é estado próprio.\
`--no-protection` pula a leitura e rebaixa o veredito, declarando-se no "NÃO
cobre".

**O REMÉDIO da issue é separado por espécie de erro** (`splitErrors`), porque dar o
mesmo conselho para os dois manda o operador para o lugar errado — a classe de
defeito que este repositório persegue. O erro de **token/permissão** ("não deu para
ler") mantém o conselho antigo: corrija a credencial. O erro de forja **sem o
recurso** (`unsupported`: repo privado num plano sem branch protection) sai em
seção própria, com o remédio de verdade — **nenhum token resolve**, o que falta é
plano (`Upgrade to GitHub Pro`) ou o repositório ser público, e enquanto isso
aquela forja **não tem portão de merge nenhum**. Medido no GitHub deste
repositório com um token que é administrador: `GET` e `PATCH` devolvem `403
Upgrade to GitHub Pro or make this repository public`. Antes, a issue mandava
"corrija o token antes de fechar esta issue" — caçar uma credencial que já estava
certa. Quando só há erro de forja sem recurso, a issue também avisa que o
`--apply` vai falhar com o **mesmo** 403.

**AS REFERÊNCIAS NÃO VERSIONADAS, no veredito (seção 3/7):** o doctor transporta o
fato da **invariante 9** (repository variables × espelhos, env do host da
aplicação × template, e o que o **registry** serve para a tag declarada) para o
veredito, sem reimplementar nada: quem decide é `checkNonVersionedImageRefs`, a
mesma função que o gate `check:registry-source` usa. **Violação bloqueia**
(valor provado errado é pior que valor não provado); **INDETERMINADO rebaixa para
INDETERMINADA** e nomeia o que faltou — e um arquivo gitignored que não existe
neste checkout aparece como `absent` (não aplicável), **fora** da lista de
pendências: listá-lo faria a pendência parecer maior do que é. `--no-registry-probe`
pula só a consulta ao registry e **rebaixa o veredito declarando-se** — sem isso,
um fato "provado" que não olhou a tag diria "pronta" com a pergunta em aberto.

**OS ESPELHOS DAS VARIÁVEIS DA IMAGEM, contra o VALOR declarado (seção 5/7):** o
doctor já sabia que os espelhos existem e concordam entre si — o que **não** é a
mesma pergunta que o guard periódico faz. Dois espelhos que concordam entre si
podem estar os **dois velhos** em relação à repository variable, e é exatamente
assim que o tier-1 (fast path de 0s) desliga na forja sem sintoma nenhum (ou o
runner puxa de outro registry, e o pull só falha quando um job tenta iniciar).
Então o doctor aceita os valores por flag — `--expected <versão>` para o atalho
histórico e `--expected-var NOME=VALOR` para as demais (`IMAGE_REGISTRY`,
`IMAGE_NAMESPACE`) — e compara com eles usando `mirrorDriftReport`, a **mesma
função** do `check-actrc-sync.mjs` (job semanal `actrc-sync`) e do publicador de
issue. Nada de uma segunda comparação: os avisos viajam no fato, no texto do
guard, para o log do doctor e a issue não poderem discordar. Uma variável **sem
valor passado** fica em `unproven`, nominalmente — a metade que prova existência
nunca passa por prova de valor.

A **gravidade segue o espelho**, como antes (misturar os dois seria mentir): o
env da forja divergente (`deploy/env.gitea.example`, e o `deploy/.env.gitea` do
checkout) **BLOQUEIA** — é ele que alimenta a label do runner, então o runner
roda OUTRA imagem; o `.actrc` divergente é **INDETERMINADA**, porque é o act
local, não o merge. A descoberta é a do guard (template comitado + o env do host
quando existe) — o doctor **não** usa `envPath`, de propósito: apontar um arquivo
substituiria a descoberta e largaria o template fora da comparação justamente no
host onde ele importa.

E **sem** o valor o doctor não inventa "em sincronia": ele diz que o VALOR não
foi comparado (a variável vive no Actions, não no checkout) e o veredito fica
INDETERMINADA. Existência não é valor.

**E o PRÉ-REQUISITO 0 do bring-up entrou no veredito — nomeado, com o comando e
com o remédio (seção 5/7):** o `deploy/gitea-up.sh` **RECUSA** a subida quando o
env do host não espelha o template comitado. É o pré-requisito 0, e ele existe
porque o `ensure-runner-image` resolve a imagem **DESTE** arquivo: com um env
divergente a subida garantiria a imagem **ERRADA**. O doctor já **media** isso (a
metade host × template da interpolação, seção 3/7); o que faltava não era a
medição, era o **nome** do pré-requisito, o **comando** que o reproduz e o
**remédio** — e é isso que o fato derivado acrescenta. Ele é **DERIVADO** de
`compose.hostCompare`, nunca uma segunda sonda: medir a mesma pergunta duas vezes
é como duas verdades começam a divergir (e o repo já pagou esse preço uma vez).
Os estados são os do resto do doctor, com o peso de cada um: **`violated`**
(divergente) **BLOQUEIA** — e a linha diz que é a **consequência** da divergência
já listada, não um segundo problema —; **`absent`** (o env do host é gitignored e
mora no host de deploy) é **INDETERMINADA**, nomeando o comando **e onde rodá-lo**;
**`proven`** não rebaixa; **`skipped`** declara a omissão; e
**`not-applicable`** (não há a stack neste checkout) não cobra nada de quem não a
tem. O relatório imprime o **estado**, o **comando** e o **remédio**
(`bun run env-mirror:check --patch` para revisar, `--fix` para aplicar) — o mesmo
par que o `deploy/gitea-up.sh` sugere quando recusa.

**A INTERPOLAÇÃO do compose (na seção 3/7):** a seção da imagem responde "dá
para puxar a tag?". Ela não responde **"o compose PEDE a tag certa?"** — e é
isso que o runner registra no `/data/.runner`. O doctor chama
`checkComposeInterpolation` (o mesmo código da invariante 7 do
`check:registry-source`, uma fonte só) e mostra o veredito dessa renderização ao
lado do estado da imagem. Uma interpolação **VIOLADA bloqueia** (variável vazia
ou valor literal: com a tag existindo no registry, o runner puxa outra imagem);
sem docker/compose no ambiente o estado é `unavailable` → **INDETERMINADA**, e
`--no-compose-render` rebaixa o veredito do mesmo jeito que `--no-guards`.

Junto vem a **outra metade (invariante 7b)**: `hostCompare` diz se o env do
**HOST** foi comparado com o template comitado (`in-sync` / `diverged` /
`absent`) e o relatório imprime as duas linhas. `diverged` bloqueia — é o VPS
interpolando outra coisa que o repositório declara. `absent` (o caso de todo
checkout que não seja o VPS) é reportado como **não provado**, nunca escondido:
quem aponta outro arquivo é `--gitea-env <caminho>`, que já existia para a
imagem e agora alimenta também esta comparação (uma flag, um env).

**OS REGISTROS DO RUNNER (na seção 3/7) — as DUAS forjas:** o doctor carrega o
registro do act_runner E o do runner auto-hospedado do GitHub, pelos MESMOS
`checkRunnerLabels` / `checkGithubRunnerLabels` que os CLIs usam (uma fonte por
forja; um segundo comparador divergiria no dia do registro velho). Os pesos são
os mesmos dos CLIs — violação BLOQUEIA, não-prova é INDETERMINADA —, e
`--no-runner-labels` pula **as duas**: uma flag só, de propósito, e o "NÃO cobre"
nomeia as duas (duas flags fariam a segunda ser esquecida).

**O REGISTRO do act_runner (a primeira forja):** a interpolação acima diz o que
o compose **PEDE**; ela não diz o que o runner **GRAVOU**. Os labels são estado
(`/data/.runner`, no volume), enviados no registro — um `up -d runner` recria o
container com o env novo e deixa o registro velho no lugar, e daí em diante TODO
job inicia na imagem antiga, sem gate vermelho. O doctor chama
`checkRunnerLabels` (o mesmo código da Prova 5 do smoke, o mesmo exit code — um
segundo comparador divergiria no dia do registro velho) e mostra o estado da
**quarta** pergunta do relatório, com onde o arquivo foi lido e o remédio do
caso. Registro **velho ou vazio** (runner órfão: existe na instância e não é
atribuído a job nenhum) **BLOQUEIA**, igual ao compose sem os labels; sem
docker/container ou registro ilegível é `unavailable` → **INDETERMINADA** —
estado que não foi lido nunca é "está certo".

**O REGISTRO do runner do GITHUB (a segunda forja):** o mesmo fato irmão, e por
um motivo que não se repete: lá o registro não tem arquivo (o `.runner` do
`actions/runner` não guarda label nenhum), então quem decide é a API. O doctor
carrega `checkGithubRunnerLabels` — o declarado é o `RUNNER_LABELS` de
`deploy/setup-github-runner.sh` — com os MESMOS pesos: registro velho, vazio,
runner ausente ou OFFLINE **BLOQUEIA**; sem token de self-hosted runners (ou com
a API fora) é `unavailable` → **INDETERMINADA**, a mesma regra da branch
protection, e nunca "em sincronia". O relatório imprime as duas linhas lado a
lado na seção 3/7 justamente para isso: uma forja em sincronia e a outra não é
drift, e não pode ficar invisível.

**A FILA PARADA (o TERCEIRO fato do runner — o registro diz QUEM está registrado,
não se alguém está PUXANDO):** os dois fatos acima provam que a forja SABE quem
deve rodar os jobs — labels gravados no `/data/.runner`, versão do binário × a tag
do compose, o `RUNNER_LABELS` × a API. Nenhum deles pergunta pela FILA. Medido em
24/09/2026: `hostinger-runner` com `status=offline` e `busy=false` e **5 runs em
`queued`** (a mais antiga de 23/09 21:30) — o doctor dizia PRONTA com a forja
parada, porque este defeito não tem sintoma: o job fica em `queued`, nada falha,
nada fica vermelho — e a fila de um self-hosted não é infinita (o GitHub descarta
o run sem runner por volta de 24h), então quem espera PERDE a execução em
silêncio. O fato entra ATÉ no perfil `--ci`: é no PR que a fila parada importa,
porque quem a espera é o check do PR.

O fato tem DUAS metades, e as duas são a MESMA pergunta
(`scripts/runner-queue.mjs`): a **FILA** (no GitHub,
`/repos/:repo/actions/runs?status=queued` — pelo MESMO canal do board, API com
`GH_TOKEN` + `GH_REPOSITORY` ou a CLI `gh`; na Gitea,
`action_run_job.task_id = 0 AND status = 5 waiting`, porque a 1.22 **não expõe a
fila em REST** — medido no `swagger.v1.json` dela: `/actions/tasks` → HTTP 404 — e
a leitura é o BANCO da stack pelo mesmo `docker exec … sqlite3` do registro) e
**QUEM A PUXARIA** (no GitHub a lista de runners vem do **MESMO GET** do fato do
registro — uma consulta, dois fatos; na Gitea, `action_runner.last_online` ×
`last_active` contra a régua da PRÓPRIA forja: 1 minuto = offline, 10 segundos =
idle, `models/actions/runner.go` v1.22.6). **Cinco estados, e a ORDEM importa:**
**fila vazia é `ociosa`** e é medida ANTES do estado do puxador — zero espera não
é dívida nem com a forja no chão, e ler o contrário abriria bloqueio no item mais
comum de todos (a fila vazia de todo dia); **`parada`** (fila cheia e NENHUM runner
online) **BLOQUEIA**, com a idade do item mais antigo e o comando de RE-REGISTRO na
própria linha; `drenando` (runner online pegando job) é a forja trabalhando e não
gera linha; `sem-puxador` (fila cheia, runner online e ninguém pegando) é pergunta
EM ABERTO e não bloqueio — pode ser a janela do poll, ou nenhum runner casar com os
`runs-on` da fila; e `unread` é a leitura que não aconteceu, NOMEADA com a causa —
jamais "sem fila": um repositório ausente do banco devolveria zero itens, e zero
itens é o verde FALSO desta pergunta (é por isso que a consulta do repositório vem
ANTES da fila). As duas metades que não são medidas daqui estão declaradas como
item datado em `ci/unproven.json` (`runner-queue-gitea`, `runner-queue-github`),
cada uma com o `proveWith` — `bash deploy/gitea-up.sh` e
`bash deploy/setup-github-runner.sh`, os mesmos comandos que a linha do bloqueio
publica.

**A FILA DA GITEA É `action_run_job`, NUNCA `action_task`** — medido ao vivo em
26/09/2026 numa 1.22.6 e confirmado no código dela: `InsertRun` cria UMA linha de
job por job do workflow, com `status = waiting` (5), no push;
`CreateTaskForRunner` só materializa a linha de `action_task` quando um runner
PEGA o job — e ela nasce `running` (6), indo direto para um desfecho. Ler a fila
em `action_task` (o que este fato fazia até 26/09) mostrava a tabela VAZIA com o
runner fora do ar: o doctor dizia `ociosa` com job esperando, que é o defeito que
este fato existe para não deixar passar. E `blocked` (7) não conta como espera: é
o job que espera `needs`/aprovação (`InsertRun`), que re-registro nenhum destrava.

**O CICLO, PROVADO LOCAL (forja efêmera, zero efeito externo):**
`scripts/prove-runner-queue-cycle.mjs` prova as duas metades do fato e o remédio
ponta a ponta, numa Gitea 1.22 + `gitea/act_runner` efêmeros desta máquina — a
fase A espera o push virar job NA FILA e mede uma janela de silêncio (20s) com o
runner fora do ar, exigindo que NENHUMA linha de `action_task` nasça (uma linha
só nasce quando um runner pega); a fase B lê o MESMO `readRunnerQueue` do doctor
e exige `parada` com o `bash deploy/gitea-up.sh` na linha do bloqueio; a fase C
sobe o serviço `runner` do compose comitado e espera o `Runner registered
successfully.`; a fase D exige o desfecho `success` E a marca do job lida do log.
O log tem DUAS casas na 1.22, e o ensaio lê a certa pelo `log_in_storage` da
`action_task`: no DBFS do banco (`dbfs_meta`/`dbfs_data`) enquanto o runner não
fecha o stream, e em `actions_log/<arquivo>` depois do `TransferLogs`. Limite
declarado: a 1.22 não tem `workflow_dispatch` (HTTP 404, medido), então o gatilho
do ensaio é um `push` numa branch do repositório efêmero — o dispatch fica
declarado no workflow para quem o entende. Rodar:
`node scripts/prove-runner-queue-cycle.mjs --sem-no-new-privileges --job-image <ref>`
(as duas flags existem por medição: o hardening `no-new-privileges` do serviço
`runner` quebra o job em alguns hosts, e a imagem do job precisa EXISTIR no host —
a do compose aponta para o registry da forja). O ensaio roda o ciclo INTEIRO
(~4min) e é `indeterminado` sem docker: o bloco documentado é o do cenário em que
não há o que medir.

<!-- prove-doc: runner-queue:prove
     run: --json
     exit: 2
     cenario: docker-ausente
     desfecho: indeterminado
-->

```text
"verdict": "unavailable"
docker indisponível
```

**O CONTRATO DA IMAGEM PUBLICADA (seção 3/7) — o build promete, o ARTEFATO
prova:** todas as provas acima são sobre o **repositório** — o `FROM` pinado por
digest, o bloco do contrato fail-closed, as mutações do pin, a identidade que a
label declara. Nenhuma delas olha o que o job **baixa**, e todas continuam
verdadeiras se a imagem que o registry serve for OUTRA build: o pin continua
certo, o contrato continua fail-closed, a label pode até concordar — e o runner
executa um artefato sem o plugin `compose` ou com outro Bun. Quem responde é
`checkPublishedImageContract` (`scripts/check-runner-base.mjs`, o guard da base):
ele resolve o **DIGEST** que a tag serve hoje — pela MESMA `probeImageIdentity`
que o invariante 9 usa, com a credencial do ambiente — e **RODA**
`docker run <host>/<repo>@<digest>` com o **mesmo bloco `RUN` do Dockerfile**
(nunca uma cópia: o probe e o build veriam contratos diferentes no dia do bump),
com `BUN_VERSION` passado por `-e`. O sucesso exige a **MARCA** que o bloco
imprime no stdout (sair 0 sem ela é violação — um bloco que virou `true` também
sai 0); o vermelho vem com os **NÚMEROS** (um segundo `docker run` lê caminho do
Bun, versão e plugin — as duas `test` mudas do bloco não têm mensagem própria).

Três decisões que esse fato carrega, e o que cada uma evita:

| Decisão                                                                                | O que ela impede                                                                                                                                 |
| :------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------- |
| o alvo é o **digest** que a tag serve, não a tag                                       | `docker run <tag>` provaria o **cache desta máquina** — uma build velha local passaria como "o artefato publicado"                               |
| **`proven` exige a marca do bloco** no stdout, não só `exit 0`                         | um `RUN` que deixou de conferir (virou `true`, perdeu o `exit 1`) sairia 0 e o relatório diria "o artefato cumpre o contrato"                    |
| a falha do **docker** (`unavailable`) é separada da falha do **contrato** (`violated`) | sem credencial, sem daemon ou com pull negado o veredito seria uma **acusação falsa** — e o remédio é outro (`docker login ghcr.io`, GHCR_TOKEN) |

A **label** entra no relatório como contexto, não como veredito: um `mismatch`
de identidade **não** impede a prova (quem decide é a execução) e o doctor diz o
que a label declara ao lado do que o binário responde — declaração e prova, na
mesma linha. Violação **BLOQUEIA** (o job roda uma imagem que não cumpre a
promessa do build: sem o plugin, o job `guards` fica INDETERMINADO lá dentro);
não conseguir rodar é **INDETERMINADA**; `--no-image-contract` pula e rebaixa o
veredito declarando-se no "NÃO cobre". O custo é dito: se a imagem não estiver
local, o primeiro run a baixa.

**E a MEDIÇÃO é provada por execução — `image-contract:prove`.** Todo o acima
descreve o CAMINHO (resolver o digest, puxar por digest, rodar o bloco dentro do
artefato). Até esta prova, quem o exercitava era a suíte unitária, que **injeta
um `run` dublê** — e um dublê não valida a invocação do docker: um `--entrypoint`
errado, uma flag no lugar errado ou um alvo resolvido para a TAG (em vez do
digest) passariam com a suíte inteira verde. O comando sobe um **registry de
verdade** (`registry:2`, porta sorteada, efêmero), empurra o artefato e roda o
`checkPublishedImageContract` **real** com o docker **real**, em cinco casos: o
CONTROLE (tem de sair `proven`, e os três fatos são MEDIDOS dentro do artefato —
bun-path, bun-version e o plugin —, não narrados), três sabotagens cirúrgicas
(sem o plugin, com o Bun fora de `/usr/local/bin`, e a versão divergindo) e a tag
existente **no registry** mas não publicada (`unavailable` — o 404 nunca vira
veredito). Cada sabotagem tem de ficar vermelha **nomeando o fato sabotado**: um
vermelho genérico provaria que algo quebrou, não que ESTE fato é verificado. O
caminho provado exige docker e a imagem do runner (`bun run image-contract:prove`);
sem eles a prova é `INDETERMINADA`, nunca "está certo" — e o que ela NÃO cobre é
dito no relatório: aqui o "publicado" é um artefato empurrado para um registry
LOCAL, sem TLS nem a credencial do pacote privado; quem mede a build que o GHCR
serve hoje é o doctor no cron, com a credencial da forja.

**Três veredictos, e a diferença é o ponto:** `BLOQUEADA` quando uma invariante
falha, quando a imagem do runner está AUSENTE (sem imagem nenhum job inicia —
não é um gate vermelho, é a fila parada), quando a branch protection REGISTRADA
diverge do manifesto (o merge é bloqueado pelo motivo errado, ou não é
bloqueado), quando o runner de uma das forjas está **FORA DO AR com run na FILA**
(o job fica em `queued` para sempre e a execução se perde em silêncio), quando o
**contrato da imagem PUBLICADA** não é executado pelo
artefato que o job baixa, ou quando a PROVA do bloqueio é violada
(a garantia da imagem é decorativa); `INDETERMINADA` quando nada falhou mas
algo não pôde ser provado (env ausente neste checkout, registry inacessível,
gate não executado, guards pulados por `--no-guards`, prova pulada por
branch protection não lida ou pulada por `--no-protection`,
interpolação pulada/não provada, o contrato publicado não provado (sem daemon,
sem credencial, pull negado) ou pulado por `--no-image-contract`, **a FILA de uma
forja não lida** (sem a stack de pé ou sem o canal do espelho o fato diz "não
lida", com a causa), registro do
act_runner **ou o do runner do GitHub** não lido (este também quando falta token
de self-hosted runners) ou pulado por `--no-runner-labels`, **a dívida aberta no
board** (uma issue de drift que ninguém fechou — não prova que o merge pode ser
furado, mas é dívida que o repositório já conhece) ou o board não lido ou pulado
por `--no-open-debt`, ou prova não executável); `PRONTA` só com tudo provado. O exit code é o veredicto (0/1/2),
então ele serve de gate de operação.

**O que ele NÃO cobre, e por isso está escrito no relatório:** o **valor de
`vars.BUN_VERSION`** quando `--expected` não é passado (a seção 5/7 diz isso na
primeira linha, e o veredito fica parcial — a existência dos espelhos não prova
o valor que o runner usa), a **PERMISSÃO do
token** sobre a forja (o doctor lê a protection COM o aplicador; sem token de
administração ele diz "não lida", e é essa a diferença entre "não consegui
olhar" e "está certo"), o smoke (tier-1 em
runtime é um job da própria forja), o `.env.gitea` de um host DIFERENTE deste
checkout (o do próprio checkout ele compara com o template — invariante 7b —, e
sem o arquivo a seção do compose diz que a comparação não aconteceu) e o render do
compose feito com o **docker do runner** da forja — aqui o render usa este
docker. O que faz aquele render funcionar está garantido em três lugares: o
**build** da imagem do job exige o plugin `compose` (`Dockerfile.ubuntu-bun`), a
`Verify mirror digest` do mirror confere na imagem PUBLICADA, e o contrato
daquele artefato é **executado** pelo próprio doctor (o fato acima: plugin, Bun e
caminho resolvido). O que segue fora do alcance daqui é o **socket** do job: é a
Prova 4 do smoke que o exercita, no host, exigindo o render
(`--require-compose`) em vez de aceitar o aviso.

**O VEREDITO COMO ISSUE (o cron semanal da forja):** o doctor responde a pergunta
inteira, mas só o lê quem lembrou de rodá-lo — e a forja é um sistema VIVO: a
branch protection registrada pode ser editada no painel, o `/data/.runner` pode
ficar velho, a tag que o registry serve hoje pode não ser a declarada, um espelho
do `BUN_VERSION` pode divergir da variable. Nada disso aparece em PR e nada
disso deixa gate vermelho. Então `bun scripts/forge-doctor-issue.mjs` transforma o
veredito em **ISSUE ACIONÁVEL** (label `forge-doctor-verdict`, dedup por
assinatura) e `.gitea/workflows/forge-doctor.yml` o roda como **cron semanal**
(segunda 07:07 UTC) com `--expected "$BUN_VERSION"` — o valor, não só a
existência.

Seis decisões, e o que cada uma evita:

| Decisão                                                                                                               | O que ela impede                                                                                                                                                                                                                                                      |
| :-------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **INDETERMINADA também abre issue**                                                                                   | o cron ficar verde justamente quando a medição está faltando — um fato não medido não pode estar certo nem errado, e é onde o drift se esconde                                                                                                                        |
| a publicação vem **antes do `exit 1`**                                                                                | o step da issue nunca rodar no run que falha — o cron vermelho sem ticket que este workflow elimina                                                                                                                                                                   |
| o step da issue roda nos **DOIS sentidos** (`always()`, modulado pelo RELATÓRIO existir — nunca pelo exit code)       | o FECHAMENTO ser inalcançável: condicionado ao exit code, o step só rodava no run que abre a dívida, nunca no único que pode fechá-la                                                                                                                                 |
| a assinatura **exclui `unproven`** (constante entre runs) e inclui o veredito + bloqueadores + não-provados ordenados | o dedup não reconhecer a dívida já reportada (issue nova toda semana) ou, no extremo oposto, um bloqueador NOVO virar comentário numa issue lida                                                                                                                      |
| **sem relatório o publicador FALHA** (exit 3 SEM relatório, JSON inválido, arquivo ausente)                           | um corpo vazio sair como alerta publicado: "não consegui medir" não pode parecer verde                                                                                                                                                                                |
| a **RECURSÃO tem veredito, título e assinatura próprios** (o fato `nestedGuard`, com o canal que a marcou)            | (a) o alerta mais importante sumir: o `exit 3` é o MESMO código de uso inválido, e tratá-lo por código transformava a recusa em "erro de uso"; (b) a dívida da recursão se perder dentro da issue do veredito — com o título do veredito, ela viraria COMENTÁRIO nele |

**O `exit 3` do doctor tem DOIS significados, e quem os separa é o RELATÓRIO**
— não o código, que é o mesmo. Com o fato `nestedGuard` em `state: fired`, é
**recursão**: o doctor
rodou DENTRO da própria prova, o guard cortou o ciclo antes de coletar qualquer
seção, e o que existe é um alerta acionável — a prontidão não foi MEDIDA. Sem
relatório, é **uso/erro interno**, e aí não há medição nenhuma a publicar. Os dois
caem em caminhos diferentes de propósito: o publicador lê o FATO (o caminho
`--report` nem tem exit code para consultar) e o workflow grava `nested=1|0` só
para o vermelho nomear qual dos dois foi — um log que dissesse "o veredito não é
PRONTA" na recursão mandaria procurar o problema no lugar errado, porque ali não
houve veredito. A issue da recursão **nomeia o canal que marcou a invocação**
(`FORGE_DOCTOR_NESTED` no ambiente ou `--proof-nested` no argv) e manda cortar o
ciclo na dublagem (`DOCTOR_SCRIPT`) — nunca nos comandos de credencial do veredito,
que seriam o remédio da peça errada. Sem o detalhe do canal no relatório, o corpo
diz que ele **não foi declarado** e nomeia os dois candidatos: canal chutado leva ao
lugar errado.

A mecânica de issue (o marcador invisível que carrega a assinatura, a decisão de
dedup e os backends do `gh` e da API do Gitea) **não é deste publicador**: mora em
`scripts/issue-publish.mjs`, compartilhada com os publicadores de drift/de
README. O que é dele é o label, o título e a prosa. A ordem da decisão é o
contrato: **primeiro a assinatura** (o mesmo problema não repete) e só então o
título (um problema novo comenta na issue aberta em vez de abrir uma segunda).
IGUALMENTE compartilhado é o **fechamento** (`reconcileDebt`): comentar a prova e
fechar o que é nosso, com o recorte do publicador (`isExpired`) — o publicador do
README, que abre uma issue por achado, fecha só as que caducaram. **O veredito do
doctor fecha pelo mesmo ciclo:** quando volta a PRONTA, o step da issue RECONCILIA
e o publicador comenta a prova e FECHA, para a dívida não ficar aberta mentindo no
board. A prova que viaja com o fechamento é MEDIDA, não afirmada: cada fato que o
relatório trouxe sai com o estado medido agora, e um fato que ele NÃO trouxe não é
inventado (dizer `proven` de um fato não medido é a mesma mentira, ao contrário).

**O fechamento era INALCANÇÁVEL — e esse era o defeito, não a falta dele:** o
step da issue rodava com `if: steps.doctor.outputs.exit_code != '0'`, ou seja, só
no run que ABRE a dívida — nunca no único run capaz de fechá-la. O fechamento
estava provado no publicador e nunca chegava a rodar no cron. Hoje quem o modula é
o **RELATÓRIO existir** (`report`, gravado pelo step do doctor; `exit 3` **sem**
relatório = uso/erro interno, que não produz medição — `exit 3` **com** o relatório
é a recursão, e essa PUBLICA) e a alegação "o step roda no run PRONTA" é provada por
**EXECUÇÃO**, não por leitura do YAML: um teste roda as etapas do cron nos dois
sentidos, com o script extraído do próprio workflow, o `bun` dublado (devolve o
relatório canônico e o exit code do veredito) e o publicador REAL contra o Gitea
dublê — e exige o comentário com a prova e a issue FECHADA.

**A DÍVIDA CONHECIDA (seção 6/7) tem DUAS metades** — o que o repositório já
sabe que deve (DECLARADA) e o que um cron já publicou (ABERTA no board) —, e as
duas ficam no MESMO lugar justamente para uma não passar pela outra: a medição
diz se o problema é vivo, a issue diz que alguém foi avisado.

**A DECLARADA (a IDADE das isenções)** é o outro lado do que o repositório já
decidiu não consertar agora: as duas listas do `check-registry-source`, a
`ALLOWLIST` do `check-unused-deps` e a dívida declarada do
`check-pipefail-sigpipe`. Cada uma registra QUANDO a decisão foi tomada
(`addedAt`/`declaredAt`) e a janela de revisão (180 dias, do módulo
compartilhado `allowlist-review.mjs`), mas essa idade só existia no run semanal
que as revisa: o PR, o doctor e o board viam "nada a fazer", e a isenção a
**179 dias** (ou vencida ontem) era invisível fora dali.

O doctor lê esse fato pelo **mesmo módulo que o publicador da issue consome**
(`scripts/declared-debt.mjs` → `collectDeclaredDebt`, a MESMA função nos dois),
sobre os **donos** das listas (o `entries()` de cada guard, não uma cópia em
disco): uma leitura a mais divergiria no dia em que alguém ajustasse uma delas.
Quatro estados, e nenhum deles é otimista: `proven` (datas presentes e dentro da
janela), `aged` (alguma venceu — vira `::warning::` no run normal e VIOLAÇÃO no
job semanal, e é o que a issue publica), `invalid` (decisão **sem registro**: não
há como envelhecer, então BLOQUEIA), `unread` (a lista não pôde ser lida —
ausência de prova, **jamais "sem dívida"**). Uma lista vazia é `sem-divida`, que
não é um estado melhor: é a AUSÊNCIA de declaração. No relatório, a seção nomeia
cada lista com o estado, a idade da entrada mais antiga e a janela; e o fato
entra até no perfil `--ci` (é leitura de arquivo, sem rede), porque é no PR que a
isenção vencida precisa aparecer — não só no cron.

**A ABERTA NO BOARD:** tudo o mais mede a forja AGORA; nada disso enxerga a issue
que um cron já abriu e ninguém fechou. Então o doctor LÊ o board — as labels do
registro `DEBT_SUBJECTS` (a fonte única, varrida contra os `scripts/*-issue.mjs`
por um teste), pela **mesma consulta dos publicadores** (`listIssuesByLabel`, de
`issue-publish.mjs`; o leitor e quem escreve enxergam o mesmo board). Três
escolhas, todas com o mesmo motivo:

**Ler o board do GitHub DE DENTRO da forja exigiu canal próprio — e é onde a
seção antes falhava em silêncio.** `readme-drift` e `mutation-trend-drift` são
crons do `.github/`: as issues delas existem SÓ lá, e o runner da forja não tem a
CLI `gh`. A leitura daquele board saía `NÃO lida` em todo cron, com duas dívidas
reais escondidas atrás do aviso. Agora `listIssuesByLabel` escolhe o canal de
forma explícita: a **API REST** com `GH_TOKEN` + `GH_REPOSITORY` quando os dois
existem (o único canal possível na forja), a **CLI `gh`** quando não existem.
Quatro decisões, todas fail-closed:

- os nomes são **`GH_*` e nunca `GITHUB_*`** — o runner da forja EMULA o contexto
  do GitHub, e ali `GITHUB_REPOSITORY`/`GITHUB_TOKEN` são o repositório e o token
  do **GITEA**: aceitá-los apontaria a leitura para o board errado, e a falha
  apareceria como "não lida" sem dizer por quê;
- **PULL REQUEST não é dívida** — no modelo do GitHub ela também é uma issue, e o
  campo `pull_request` é o que a denuncia. Sem esse filtro, o PR que CONSERTA o
  alvo morto viraria "dívida nova" justamente quando alguém a resolve;
- os **comentários** entram (uma chamada por issue, como no backend do Gitea): é
  neles que mora o marcador de um problema que MUDOU, e sem eles o fechamento
  automático ficaria cego para uma issue NOSSA;
- **sem nenhum dos dois canais o erro nomeia os dois** e o que falta em cada um
  (`sem GH_TOKEN e GH_REPOSITORY para a API, e a CLI \`gh\` falhou (…)`), e a seção
  sai como NÃO lida (INDETERMINADA) — nunca como "sem dívida".

**COMO se leu** é fato do relatório (`via`: `api` ou `cli`, dito na própria linha
da seção), e sai do MESMO resolvedor que a leitura usa (`githubReadConfig`): um
relatório não pode declarar um canal que não foi o usado.

- **Só o que é NOSSO conta como dívida** (o marcador do publicador, não a label):
  uma label aplicada à mão numa issue alheia é REPORTADA, mas nunca fechada por
  automatismo — o mesmo critério do `reconcileDebt`;
- **dívida aberta NÃO bloqueia, mas impede PRONTA**: uma issue aberta não prova
  que a forja falha em bloquear o merge, prova que existe dívida pendente;
  bloqueá-la ensinaria o operador a ignorar o veredito. Ela entra como
  INDETERMINADA **com o número e a IDADE** ("aberta há 47 dias" é o que separa a
  dívida ativa da esquecida);
- **a issue velha não passa por problema vivo**: para as labels cujo assunto o
  doctor mede por conta própria (`required-checks-drift` → a branch protection
  REGISTRADA, `actrc-sync-drift` → os espelhos do `BUN_VERSION`,
  `declared-debt-review` → a IDADE das isenções, o cruzamento mais forte do
  registro) a seção mostra a MEDIÇÃO ao lado da issue — `Parece CADUCADA` (o
  doctor mede limpo agora), `Fala de um problema VIVO` (mede e continua) ou
  `Caducidade NÃO verificada` (não mediu nesta run: **nunca vira "caducou"** —
  dizer que caducou sem ter medido é a dívida que mente, do outro lado). Não
  medir inclui o fato `unread`: uma lista ilegível não vira "a dívida acabou".

A label do **próprio veredito** (`forge-doctor-verdict`) fica FORA da leitura, e a
razão vai escrita no relatório: ela existe porque o veredito não é PRONTA, então
lê-la faria o doctor alimentar o próprio alerta — INDETERMINADA para sempre, por
construção. O ciclo daquela issue é do PUBLICADOR (que a abre e comenta), não do
diagnóstico. É esse o único assunto que exige uma exclusão: um teste percorre
`scripts/*-issue.mjs` e FALHA se a label de um publicador não estiver nem no
registro nem numa exclusão declarada.

**Onde roda:** manual/operador (`bun run doctor`) antes de confiar o merge à
forja e no runbook de deploy (`deploy/GITEA.md`), **como cron semanal na forja**
(`.gitea/workflows/forge-doctor.yml`), que publica a issue quando o veredito não
é PRONTA e a FECHA quando ele volta a PRONTA, e — só na fatia local — **no CI de
PR, pelo perfil `--ci`** (abaixo). O
cron roda o doctor INTEIRO (sem `--no-*`), que é onde vale pagar a prova do
bloqueio e o contrato da imagem publicada. O VEREDITO INTEIRO fica **fora do CI
de PR** de propósito: depende do registry, de credencial de administração e do
env do host, e um job agendado nunca reporta status num PR (exigi-lo como
required check travaria todo PR para sempre — invariante travada em
`src/lib/__tests__/forge-doctor-issue.test.ts`). O veredito completo, como
veredito, também não tem par no `.github/`: ele é sobre ESTA forja — dona do
merge, onde a stack roda e onde a branch protection que bloqueia vive.

**O PERFIL `--ci` — a fatia que roda a CADA PR (e o que ela acrescenta):** a
pergunta "o espelho ainda diz o que a repository variable diz?" era do cron
semanal — e um PR que mexe no template (ou uma variable trocada na forja) podia
esperar dias pelo veredito, com o defeito silencioso esse tempo todo. O doctor
ganhou o perfil `--ci` (`CI_PROFILE_SKIPS`): ele DESLIGA as OITO seções que um
runner de PR não prova — a bateria de guards (é o próprio job que o chama:
recursão), a prova do bloqueio (executa o `gitea-up.sh`, que executa o doctor:
recursão), a branch protection registrada, o registro do runner, o contrato da
imagem publicada, o probe do registry e o board — e mantém o que um PR consegue
medir: contrato de merge, env mirror, render do compose e o **VALOR** das
variáveis nos espelhos e nas referências não versionadas. O perfil reduz o
ESCOPO, nunca a régua: uma divergência de valor continua BLOQUEANDO, e cada
seção que saiu aparece NOMEADA em `unproven` (com uma linha própria dizendo que
o recorte foi do PERFIL, e não de sete flags esquecidas no YAML).

O **gate** que o liga é `scripts/check-doctor-ci.mjs`
(`node scripts/check-doctor-ci.mjs` — o **comando canônico**, o MESMO literal nas
duas forjas), invariante **CORE** do `check:forge-parity`:
roda no job `guards` de `.gitea/workflows/ci.yml` (onde a resposta decide o merge)
e num job próprio do `.github/workflows/pr-check.yml` (a MESMA pergunta é
agnóstica de forja). Ele lê os valores do AMBIENTE (o workflow exporta `vars.*`
sem fallback — comparar contra um `|| 'ghcr.io'` do YAML é comparar contra
intenção), **nomeia** a variável que não chegou (`::warning::`, porque um
comparador com régua vazia diria "não perguntado") e traduz o veredito do doctor
em decisão de pipeline: `0`/`2` → **segue** (2 é o INDETERMINADA por DESENHO do
perfil — as seções do cron estão declaradas; tratá-lo como fracasso faria todo PR
nascer vermelho), `1` (BLOQUEADA) → **bloqueia**, e `3`/outros → **bloqueia**
(sem veredito não há gate). A lógica mora no script, e não no `run:` do YAML, por
um motivo estrutural: o doctor executa a bateria do job `guards` por **lista de
argumentos** e exige que cada gate seja uma linha `run: <cmd>` — um `run: |` com
o comando dentro é INVISÍVEL para ele (teste em
`src/lib/__tests__/doctor-ci-workflow.test.ts`).

**O que o gate de PR NÃO promete**: ele não prova a imagem publicada, a branch
protection registrada, o registro do runner, o board nem o bloqueio da subida —
isso é do cron e do `deploy/gitea-up.sh`. E quando uma variável não está criada
em uma das forjas, o valor dela não é conferido: o gate fica verde **dizendo
qual** ficou de fora (o guard semanal acusa o mesmo, em modo `--fail` na forja).

**A HERANÇA DE SHELL DOS WORKFLOWS (seção 7/9): o que a prontidão passou a cobrar
que antes vivia só no relatório do guard.** O `check-pipefail-sigpipe` (seção 20)
diz, no relatório dele, de ONDE vem o shell de cada passo — do `shell:` do
PRÓPRIO passo, do `defaults:` do JOB, do `defaults:` do ARQUIVO, ou do shell
default do RUNNER (a premissa `bash -e`, que **não é deste repositório**) — e
reprova a declaração de `defaults:` que LIGA o pipefail, porque ela reclassifica
todos os passos do escopo numa linha sem que um passo sequer mude no diff. Essa
promessa era **invisível para o veredito**: quem decide se o merge pode ser
confiado à forja não tinha como saber que a premissa de um escopo inteiro mudou
de uma vez — e no perfil `--ci`, onde a bateria de guards está pulada, ela só
apareceria no cron semanal.

O doctor publica esse fato por **WORKFLOW**, e a medição é a **MESMA** função
(`workflowShellInheritance`, exportada pelo guard — o `scanRoot` a chama item a
item): não existe uma segunda leitura do YAML, e um teste exige que os
contadores dos dois coincidam sobre a mesma árvore. Três estados, com o peso de
sempre: `proven` (todos os arquivos lidos e nenhuma declaração que ligue o
pipefail — e o relatório diz a CONTA: quantos passos por cada fonte, quantos sob
pipefail), `violated` (**BLOQUEIA**: a declaração que liga o pipefail, ou a de
forma INLINE que o guard não consegue ler — fail-closed: presumir "sem pipefail"
ali seria uma aposta), e `unread` (**INDETERMINADA**: a lista ou um arquivo não
pôde ser lido — nunca "o repositório não declara shell default nenhum"). O fato
entra ATÉ no perfil `--ci` (é leitura de checkout, sem rede nem credencial), e a
AUSÊNCIA dele no relatório também vira dúvida, como a do guard de recursão: dizer
"pronta" sobre o que não foi olhado é o que este doctor recusa.

**A COBERTURA DA VARREDURA DE TERCEIRO (seção 8/9): a prontidão declara o
ALCANCE, não só o resultado.** A invariante 19 (seção 13) publica o resultado
dela — nenhum uso da versão do Bun divergindo num pipeline de terceiro —, e o
resultado **não muda** quando um pipeline novo aparece fora do alcance dela: um
`.gitlab-ci.yml` que entra no repositório fica cego, e o verde continua igual.
O doctor publica a cobertura com a MESMA leitura do guard
(`thirdPartyPipelineCoverage`, da mesma tabela de tipos — duas listas divergiriam
no primeiro pipeline novo): quantos tipos são declarados, **quais**, e quantos
arquivos cada um cobre. Três estados, com o peso de sempre: `proven` (os tipos
nomeados, um a um, e nenhum CI detectado fora deles), `violated` (**BLOQUEIA**:
um CI de terceiro detectado fora dos tipos declarados — o remédio diz onde
declarar —, ou a tabela vazia, que seria "nenhum CI fora dos tipos" por vazio) e
`unread` (**INDETERMINADA**: um diretório não pôde ser lido; pode haver pipeline
escondido ali). Entra ATÉ no perfil `--ci`: é leitura de checkout, e é no PR que
a lacuna precisa aparecer — ali a bateria de guards está pulada.

**A IDADE DAS DECLARAÇÕES DATADAS (seção 9/9): a prontidão declara QUANDO o
número que ela própria cita foi medido.** Esta é a fenda por onde a divergência de
**28%** passou (o `mutation-guards` do modelo de latência declarado em
**271.755ms** com a árvore medindo **380.700ms**): a comparação de tempo é por
PERCENTUAL, e percentual não sabe datas — um número velho e um número de agora
diferem na mesma proporção, seja qual for o tempo que os separa. O doctor publica
por família MEDIDA a idade do commit de origem que a baseline grava
(`scripts/bench-families.mjs` é a régua das famílias, e
`scripts/bench-freshness.mjs` a da idade) e o veredito dela não fica no relatório
sozinho: uma família além do teto **DERIVADO do ritmo** do repositório — a
política declara **2 ciclos** do cron semanal e mede os commits por ciclo numa
janela de **28 dias**, com **piso de 20/ciclo**; quando o git não responde o
ritmo o número cai na reserva declarada de **150 commits** e a origem sai dita
(`teto.origem`) — **entra nas dúvidas** e vira issue
(`bench-freshness-issue.mjs`), no mesmo ciclo de
reconciliação das outras dívidas: o publicador carrega `crossCheck:
"benchFreshness"`, então o doctor mede o MESMO par na prontidão e a issue se
fecha sozinha quando a régua volta ao teto, em vez de depender de alguém lembrar
do número.

Quatro estados, com o peso de sempre: `measured` (todas as declarações medidas têm
idade — a mais antiga dentro do teto é fato declarado, a mais antiga FORA dele é
dúvida com o remédio junto), `unknown` (**INDETERMINADA**: a sonda git não
conseguiu responder — um clone raso é o caso típico —, e "não consegui medir"
nunca é "está fresca"; é também o estado de uma FONTE ilegível — o modelo
truncado ou o README ilegível viram uma unidade `fonte-ilegivel` nomeando o
arquivo, e não a omissão de um conjunto que ninguém viu — e o de uma declaração
SEM origem — o `ms` sem a própria `date` e a tabela de custo sem âncora entram
como `declaracao-sem-origem`, porque um número não tem de ser datado por decurso
—), `diverged` (**BLOQUEIA**: o commit de origem gravado não
está na história de `HEAD` — a história foi reescrita e o número declarado não se
reproduz nesta árvore) e `skipped` (o `--no-bench-freshness` paga o preço
declarado).

**E a régua não mede só o bench: qualquer número DECLARADO entra no MESMO fato.**
O `kind` de cada unidade diz de onde ela vem, e são três: `bench-family` (a
origem é o `commit` que a baseline grava), `declared-number` (cada `ms` de
`ci/merge-latency.json`, com a origem DERIVADA DA DATA DELE) e `declared-table`
(cada tabela do README que DECLARA duração, com a origem derivada da âncora
datada do bloco dela — a tabela mais as `BLOCK_LOOKBACK` = 12 linhas acima). A
data vira commit por `git rev-list -1 --before` e é esse commit que a MESMA sonda
mede (`commitAge`): uma segunda régua de idade divergiria da primeira no dia em
que uma das duas fosse ajustada. Duas exclusões são deliberadas, e cada uma tem
régua própria: a célula que só CITA uma duração no meio de uma frase não é tabela
de custo (o tempo tem de COMEÇAR a célula, senão a régua pediria data de origem
para prosa que só cita um limiar) e o `ceiling: true` do modelo (o
`timeout-minutes` da pipeline) fica FORA — a origem de um limite é o próprio
workflow, e cobrar frescor de um número que não se mediu seria ruído.

**O TETO É POR TIPO, porque o ritmo de cada declaração difere:** o teto derivado
do ritmo para `bench-family` e `declared-number` (os dois são re-medidos no mesmo
ato em que o guard ou o job muda — o que o tipo declara é a POLÍTICA "segue a
idade", nunca o número: ele sai de `ciclos × commits por ciclo`, medido) e **sem
teto** para `declared-table` — a prosa de custo do
README é re-medida quando o GUARD muda, não por calendário, e as âncoras vivas
hoje vão de 79 a 412 commits: um teto em commits compararia o ritmo do CÓDIGO com
o da DOC e acenderia alerta permanente. O que a régua cobra da tabela é a
ÂNCORA, e a idade sai PUBLICADA (`ceiling: null` no relatório, `sem teto (a idade
é publicada)`); quem decide se o número ainda vale é o dono dele.

**E ela NÃO entra no perfil `--ci` — é a oitava declaração de `CI_PROFILE_SKIPS`,
e o motivo é o instrumento, não o custo.** A idade se conta em COMMITS de `HEAD`
(`git rev-list --count <origem>..HEAD`), e o checkout de um PR não é
garantidamente profundo: num clone raso o commit de origem não está ali e o fato
sairia **SEM idade em todo PR** — um indeterminado PERMANENTE por falta de
checkout, que é a forma mais barata de ensinar o operador a ignorar a lista
`unproven`. Quem mede a idade é o cron semanal (o job `guard-timing-alert`) e o
doctor INTEIRO — o local e o da forja, cujos checkouts passam a exigir a história
inteira (`fetch-depth: 0`) justamente para que a seção 9/9 não responda "sem
idade" onde a resposta existe. A seção pulada no PR sai NOMEADA em `unproven`,
nunca em silêncio.

**O marcador da issue congela a chave que a assinatura usa.** A assinatura do
publicador (`signatureOf`) lista as declarações vencidas sob a chave
`families=`, nome que nasceu quando o fato só tinha as famílias do bench: mudá-lo
faria o publicador PERDER a issue aberta (a assinatura é o contrato do ciclo
abrir/fechar). O que a chave lista hoje são todas as declarações vencidas, e o
`kind` de cada linha da tabela diz de que tipo ela é.

**A SEGUNDA PERGUNTA: a idade diz de QUANDO é o número, não o que aquela origem
CONTÉM.** A idade conta COMMITS, e distância em commits não é conteúdo — a
fenda MEDIDA: em 22/09/2026 a baseline gravava `commit: 8e76c9a6` e uma das 39
formas medidas, a `doc-hashes`, **não existia naquele commit** (a suíte estava no
ÍNDICE quando o ato rodou). O número declarado descrevia uma matriz que o commit
de origem não carrega, e nenhuma régua olhava isso: o frescor da origem é
PASSADO, não conteúdo. O ATO passou a gravar **o estado da árvore**
(`meta.treeState`: `git status --porcelain --ignored=matching` como DADO — o
**TRABALHO**, com `clean` e os caminhos separados em `staged` (o que o PRÓXIMO
commit carrega) e `unstaged` (o que nem isso), porque um número medido sobre eles
não descreve o commit que a origem grava — fail-closed: `git` que não respondeu
sai `unavailable`, nunca "limpa"). A árvore tem **duas coisas**, e só a primeira
é dívida: o **ARTEFATO LOCAL DECLARADO** (`declared`) — o scratch de um ensaio, o
estado do doctor, o cache do tsc — é o que o PRÓPRIO repositório declara local
(regra de `.gitignore` VERSIONADA, com arquivo e linha), não suja a árvore, e o
ato o NOMEIA porque um vermelho local explicado por scratch (o
`workflow-run-syntax` que o `.tmp/mineracao` derrubou em 25/09/2026) tem de ter de
onde vir no registro. A tabela (`ARTEFATOS_LOCAIS_DECLARADOS`) é MOTIVADA — só
entra o artefato que PODE MUDAR o que o ato mede — e a entrada não basta: o git
PROVA a declaração (ignorado, com regra versionada), o que casar a tabela sem
essa prova sai CONTADO em `undeclared` (o `.git/info/exclude` local ou um ignore
global é declaração da máquina, não do repositório), e um caminho VERSIONADO que
case um prefixo continua no trabalho: a declaração não ignora o que o índice
carrega. E, **por forma**, se ela existe no commit de origem (`meta.formOrigin`,
com o `script` de cada forma entrando no registro em vez de a fonte ser
adivinhada por convenção de nome: o id `readme` mede
`test-mutation-readme-guards.sh`).

**A régua de "de qual arquivo veio esta forma?" é UMA SÓ, e as duas pontas a
usam.** Ela mora na FOLHA (`fonteDaForma`/`FORM_SECTION` em
`scripts/bench-families.mjs`): o ATO a aplica à árvore que acabou de medir e a
régua da idade (`scripts/bench-freshness.mjs`) a aplica ao COMMIT de origem —
duas derivações divergiriam no dia em que uma fosse ajustada, e a divergência
apareceria como "o ato diz que está no commit e a régua diz que não". A ORDEM da
régua é deliberada: o `script` que a forma declara responde por si (é o dado mais
próximo); sem ele, a família que tem um mapa (`mutations`) nomeia pelo `id` lido do
master DAQUELE commit; e o id que **não está** naquele master é uma RESPOSTA, não
uma ausência (`ausente-do-master` — a forma foi medida numa árvore que aquela
origem não carrega). O que não é resposta é o master que **não pôde ser lido**
(`sem-master`, contado em `semResposta`): a pergunta que não deu para fazer NÃO
vale como "está no commit", e é o que impede um commit sem o mapa de fechar
dívida. As famílias cujas formas medem COMANDOS (o hook, o lint, o tsc, a suíte
unitária) não nomeiam arquivo próprio: elas contam em `notJudged` — o LIMITE
DECLARADO da régua, dito na mesma linha onde as outras saem julgadas.

**A classe abre item datado e entra como dúvida, com o remédio junto.** O item
`bench-forma-fora-do-commit` (`ci/unproven.json`) fecha pelo predicado
`forma-no-commit-de-origem` — e ele exige `state: measured`, `missing` ZERO **e**
`semResposta` ZERO: "não perguntei" não fecha. O doctor publica a linha ao lado da
idade (a idade vencida não pode MASCARAR uma forma que a origem não tem — foi
assim que a `doc-hashes` viveu) e o remédio que ele nomeia é o do ato: **commite a
árvore e rode o ato de novo** — a medição descreve a árvore da frente, e uma
medição sobre o working tree grava um commit de origem que não tem o que ela mediu.
A régua não é código novo para esta pergunta: ela REUSA `git show`/`git cat-file`
sobre o commit de origem, e a linha sai também no relatório do próprio ATO
("Estado da árvore no ato × o commit de origem"), para o operador ver a diferença
onde ele a produziu.

**LIMITES DECLARADOS, e são dois.** (1) O `meta.treeState` e o `formOrigin`
entram no registro versionado no ato de 26/09/2026 (`eecb7d09`), que mede a
árvore LIMPA e grava os 3 artefatos locais DECLARADOS nomeados (regra e porquê)
e `undeclared` vazio: a baseline ANTERIOR (`405de5c3`) carregava o `treeState`
sem estes campos, e um registro que não os tenha não é lido como "árvore
limpa" por régua nenhuma, e o que abre o item é derivado das FORMAS (o
`missing`/`semResposta` do fato), não do estado gravado. O estado da árvore é o
que o próprio ATO publica ao medir, medido nesta árvore:
`⚠️ TRABALHO não commitado no ato: 3 caminho(s) no ÍNDICE (staged) e 80 só na
árvore (unstaged)` — e o artefato declarado sai em linha PRÓPRIA
(`🗂 N artefato(s) local(is) DECLARADO(s) na árvore — não é dívida`), sem nunca
entrar em `staged`/`unstaged`: o registro deixa de acusar como sujeira o que o
repositório declara local. `clean` responde só pelo TRABALHO — uma árvore com
artefato declarado e sem trabalho sai limpa e NOMEANDO o que estava vestido. (2)
A pergunta é sobre a EXISTÊNCIA do arquivo no commit, não sobre o CONTEÚDO: uma
forma cujo arquivo existe na origem mas foi medido com uma versão modificada no
índice sai como "no commit" — o `staged` do `meta.treeState` é quem denuncia
isso, e é por isso que ele é gravado em vez de a régua confiar só no `cat-file`.

**A TERCEIRA PERGUNTA: a matriz ANDOU? — e ela abre ITEM DATADO, não uma linha
anônima.** As duas réguas acima são de CONTEÚDO: o `check:mutation-count` compara
ids, contagem e metades (ele acusa quando um sub-test **ENTRA** na matriz) e o item
das formas pergunta se o commit de origem **CARREGA** as suítes medidas. Nenhuma
das duas olha o TEMPO: um sub-test cujo ALVO muda (`id|scripts/outro.sh`) ou um
corpo de suíte que muda de CUSTO deixam o número declarado — e o PISO do job que
dele se soma — descrevendo uma matriz que esta árvore não tem mais, **sem mexer em
contagem nenhuma**; e a única idade que existia media contra `HEAD` (o teto de 150
commits do repositório, meses de calendário). O relógio da matriz é o dela: o
escopo é o master **e as suítes que ele cita** (na origem e agora — é nelas que o
custo mora), o ritmo é contado nos commits DAQUELES caminhos e o teto sai da MESMA
aritmética do teto de idade com a política DELA (piso de **1** commit por ciclo: a
matriz muda quando um sub-test entra ou quando uma suíte muda de forma, nenhum dos
dois é um evento por ciclo).

**O que o doctor abre é o ITEM `bench-ato-na-matriz` — e a data dele é DERIVADA da
história.** O item sai no relatório (seção 9/9), no veredito (como dúvida, com o
remédio) e no corpo da issue do doctor; a frase é a MESMA nos três
(`matrixItemLine`, do dono da régua), porque o relatório e o canal não podem contar
o mesmo item com dois textos. A decisão de desenho é a DATA: ela é o primeiro
commit que a matriz ganhou depois da origem do ato (`since.date`), **nunca o
relógio da run** — um item que se re-datasse a cada execução nunca envelheceria, que
é exatamente o defeito que o registro datado existe para não ter. E ele é
**declarável como qualquer outra dívida datada**: com `kind: lacuna`, o
`declaredAt` da data derivada e `closedBy: ato-na-matriz`, o predicado que já está
implementado (`scripts/doctor-unproven.mjs`) fecha por **MEDIÇÃO** — o relatório
que mede o relógio dentro do teto prova o item, em vez de uma janela de calendário
correr sozinha. As duas saídas vão nomeadas no item: re-rodar o ato
(`bun run bench:guard-timing:baseline`, com a árvore JÁ COMMITADA) ou declarar a
lacuna no registro e deixar o fechamento por medição. FAIL-CLOSED em cada passo:
sem a família `mutations` medida, sem commit de origem ou com o commit fora do
checkout, o fato sai `unavailable` — nunca "está na matriz" —, e o canal suspende o
fechamento; `aged: false` só fecha o item declarado com `state: measured`, porque
uma medição que não aconteceu não prova que o registro descreve a matriz de agora.

**Prova por mutação das regras do veredito**
(`scripts/test-mutation-bench-freshness.sh` — a suíte declara **12 metades**). Esta
suíte existe porque o sujeito é
o único em que o verde CEGO é indistinguível do verde honesto: uma régua de idade
que ficasse cega não acusaria nada, e o repositório seguiria publicando o mesmo
verde sobre um número que ninguém re-mediu. Cada REGRA que o veredito consome é
desligada no lugar, e o vermelho é exigido — são **em DOZE direções** (M1–M12):

| metade  | a regra que ela desliga                                 | o vermelho que ela exige (medido)                                                                                                                           |
| :------ | :------------------------------------------------------ | :---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **M1**  | a DERIVAÇÃO da origem pela data (`commitOfDate`)        | datando tudo por HEAD, toda declaração fica a ZERO commits atrás — a régua declara frescor sem ter medido nada                                              |
| **M2**  | a ÂNCORA de mês (`anchorBefore`)                        | com `mm/aaaa` resolvendo no PRIMEIRO dia, a origem cai um mês atrás do que o dono declarou e a idade sai MAIOR do que é                                     |
| **M3**  | o TETO POR TIPO (`FRESHNESS_CEILINGS`)                  | com o teto das famílias na prosa do README, a mesma âncora de 412 commits passa a vencer e o canal abre dívida para sempre                                  |
| **M4**  | a FRONTEIRA do teto (`isAged`)                          | com `>=`, a declaração exatamente NO teto vira dívida (no teto é fresca; no teto + 1, vencida)                                                              |
| **M5**  | o fail-closed da FONTE (`readFreshness`)                | sem a unidade `fonte-ilegivel`, "não consegui ler" vira "nada a julgar" e o estado sai MEDIDO sobre um arquivo que ninguém leu                              |
| **M6**  | o fail-closed da DECLARAÇÃO (`modelDeclarations`)       | sem a unidade, o `ms` sem a própria `date` some do veredito em silêncio                                                                                     |
| **M7**  | o TETO DERIVADO do ritmo (`tetoDoRitmo`)                | com o literal, o teto deixa de seguir o repositório: com 314 commits na janela o CLI saiu **150** onde o produto medido é **157**                           |
| **M8**  | a PROCEDÊNCIA do teto (`teto.origem`)                   | com a reserva se dizendo "medido", o teto de fail-closed (o git não respondeu o ritmo) sai com a cara de uma medição de agora                               |
| **M9**  | a FONTE da forma no commit de origem                    | assumindo "a origem é o HEAD", a `doc-hashes` (medida com a suíte no ÍNDICE) volta a passar: a classe sai **0 forma(s) fora** contra as 1 do controle       |
| **M10** | o fail-closed da PERGUNTA (sem o master daquele commit) | sem o mapa id→script daquela origem, uma pergunta que NÃO pôde ser feita passa a valer como "está no commit"                                                |
| **M11** | o ESCOPO da matriz (`paths`)                            | com o master sozinho, as 39 suítes que ele cita saem do relógio (o escopo caiu de 40 para **1** caminho) e a suíte que mudou de custo passa sem ninguém ver |
| **M12** | a DATA do item datado (`matrixItem.declaredAt`)         | com o relógio da RUN no lugar do primeiro commit que a matriz ganhou depois do ato, o item se re-data a cada execução e a dívida nunca envelhece            |

**Duas testemunhas, e o teste exige a que a mutação atinge.** A régua por
EXECUÇÃO — o CLI (`node scripts/bench-freshness.mjs --json`) sobre o repositório
REAL, que é o fato que o doctor e o publicador consomem: para o fail-closed da
FONTE ele recebe `--file` apontando para um arquivo que não existe, e o caminho
"não consegui ler" é medido de ponta a ponta. E a suíte unitária
(`src/lib/__tests__/bench-freshness.test.ts` e
`src/lib/__tests__/bench-form-origin.test.ts`), a única testemunha das metades que
o repositório de hoje NÃO consegue mostrar sozinho (são CINCO das doze — M4,
M6, M8, M10 e a M12: nenhum item está aberto enquanto o relógio da matriz está
dentro do teto, e é o fixture da matriz vencida que mede a data do item; as outras
sete são vistas também pela régua por execução) — nenhuma
declaração está exatamente num teto fixo, todos os números do modelo já carregam
a data deles (que é, em si, a prova de que a regra é seguida), o ritmo de hoje dá
**um** número (o produto e a coincidência ficariam indistinguíveis sem os dois
lados — ritmo alto × piso), o caminho da RESERVA só aparece quando o git não
responde e o master da origem de uma forma **ilegível** só existe num fixture —
nos dois lados da pergunta nova (o M10) o repositório de hoje mostra o caminho
FELIZ (o master daquela origem é legível: `semResposta` zero). Cada mutação é CIRÚRGICA (o alvo tem de
aparecer UMA vez, e o arquivo mutado tem de seguir com sintaxe válida) e a régua é
RESTAURADA entre as medições, com o CONTROLE final medindo o mesmo fato (412
commits, e a mesma forma fora da origem) de novo. A suíte é a **39.ª** da matriz do master:
custava **23.7s** sozinha (as oito metades) no ato de então — a MESMA ordem de grandeza que os **17.7s**
medidos pelo `--scenario` isolado antes de ela entrar na matriz — e, com as DEZ metades,
media **36.9s** (uma execução, `real 0m36,905s`). Aquele número era dito com a
procedência DELE — medição à parte — porque o registro versionado ainda carregava os
23.7s das oito. **O ato JÁ RE-MEDIU**: a suíte declara hoje doze metades e a coluna
de custo do registro versionado carrega **46.6s** com elas — o número deixou de ser
uma medição à parte e é o que o job paga.

**LIMITE DECLARADO:** a régua mede **frescor**, não exatidão. Um commit a mais
pode não mudar nada do que a família mede, e o teto é um contrato de RITMO, não
uma prova de que o número reflete a árvore: ele impede o silêncio de um número
que ninguém re-mediu enquanto o repositório andava, o que é precisamente o
silêncio em que os 28% viveram. O teto é o das famílias e dos números declarados;
as tabelas do README não o têm de propósito, e é por isso que a idade delas sai
publicada sem acender dívida. Quem acusa a divergência de tempo é o `--compare`;
quem acusa a **idade** da declaração é este fato.

**O REGISTRO DATADO DO QUE O VEREDITO NÃO COBRE (`ci/unproven.json` + a régua
`scripts/doctor-unproven.mjs`).** O doctor termina com duas listas honestas e
**anônimas no tempo**: `unproven` (o que ele não promete) e `unknowns` (o que não
conseguiu medir). Sem data, uma lacuna nunca é reafirmada, nunca vence e nunca
fecha — o ciclo de reconciliação das outras dívidas (issue aberta, fechada por
MEDIÇÃO) não a alcança, e o cron repete a mesma lista para sempre. O registro
transforma cada uma delas em uma **declaração datada**, e o estado de cada
item sai dos PRÓPRIOS fatos do relatório (o `closedBy`, um predicado nomeado —
`gitea-forja-lida`, `github-protection-suportada`, `host-env-presente`,
`act-runner-lido`, `github-runner-registrado`, `github-runner-na-versao-do-pin`,
`imagem-publicada-prova`, `espelhos-com-valor`, `referencias-versionadas`): o
doctor não consulta a forja uma segunda vez para julgar o registro.

**Duas CLASSES, e a diferença é o que se pode esperar de cada uma.** `lacuna`
(o estado que a prova exige não está ao alcance deste checkout: falta
credencial, o env do host, a stack de pé — **envelhece**, e o remédio é
reafirmar a data ou fechar a lacuna) e `limite` (por DESENHO o veredito não
cobre aquilo a partir de um checkout: o histórico da forja, o smoke em runtime,
o docker do job, o `--no-verify` do gate local — datado e **sem janela**, porque
uma fronteira da medição não é uma dívida).

**Cinco estados, com a disciplina de sempre:** `proven` (o fato que o item
declarava fora de alcance FOI medido: a entrada virou **letra morta** e o
remédio é removê-la), `open` (dentro da janela: o que ele acrescenta ao veredito
é a DATA), `aged` (**INDETERMINADA**, com a data, a janela e o que fecha),
`invalid` (**BLOQUEIA**: data ausente/impossível/no futuro, `kind` ou `closedBy`
desconhecido — fail-closed: uma declaração que o dado não julga nunca vence nem
fecha) e `unread` (**BLOQUEIA**: o registro não pôde ser lido — ausência de prova,
JAMAIS "nada fora de alcance"). A janela (`reviewAfterDays`) e a régua da data
são as compartilhadas de `allowlist-review.mjs`: uma segunda cópia divergiria no
dia em que alguém ajustasse uma delas.

**A data chega à linha onde o operador lê, e por TRECHO.** Cada item declara o
`matches`: o trecho estável da linha que o veredito publica sobre ele — uma
string, ou uma **lista de alternativas** quando o mesmo assunto muda de linha
conforme o estado medido (`github-self-hosted-runner`: `unknown` quando não deu
para ler, **BLOQUEIO** quando deu). A data é aplicada na hora de IMPRIMIR (nas
TRÊS listas: bloqueios, não-provados e dúvidas) e **não** no dado do veredito —
a assinatura da issue é derivada dele, e uma assinatura que mudasse com o
calendário comentaria toda semana na MESMA issue. O teste da suíte exige que cada
declaração VIVA case com **exatamente uma** linha do relatório de verdade: prosa
reescrita sem a data falha o PR em vez de envelhecer calada.

**E a data viaja também para o CORPO DA ISSUE — pela MESMA régua.** O canal da
reconciliação é a issue do veredito, e uma linha de "não provado" publicada ali
sem data deixaria o operador exatamente onde ele estava: sem saber se a lacuna
nasceu ontem ou se venceu a janela e ninguém a reafirmou. O publicador
(`forge-doctor-issue.mjs`) aplica o `datarLinhas` com o fato que viaja **no
próprio relatório** (`facts.unprovenDebt`) — nunca com uma segunda leitura de
`ci/unproven.json`, que poderia divergir da que o veredito acabou de medir. A
assinatura do dedup continua saindo do veredito CRU (`verdictSignatureOf`), e é
por isso que datar a prosa não comenta de novo na mesma issue a cada dia que
passa.

**O ciclo de reconciliação é o mesmo das outras dívidas, e já existia:** uma
declaração vencida vira linha de dúvida, a linha viaja no corpo da issue do
veredito (`forge-doctor-issue.mjs`, cron da forja), e a issue se **FECHA** quando
o veredito volta a PRONTA — o comentário de resolução passa a nomear o estado do
registro (`facts.unprovenDebt.state`) como prova de que nenhuma lacuna venceu ou
ficou morta no caminho. Ele entra ATÉ no perfil `--ci` (é leitura de checkout,
um JSON), e é ali que ele mais serve: no PR a lista de não-provados é a única
coisa que o veredito publica, e sem o registro ela sai sem data.

**E o que a primeira medição de verdade ENCONTROU (22/09/2026, perfil completo,
com `GH_TOKEN` + `GH_REPOSITORY`): as duas forjas, hoje, NÃO têm portão de
merge confirmado.** _(A medição é anterior à régua de canal: hoje o doctor não lê
mais o `GITHUB_REPOSITORY` do ambiente, e o comando que a repete passa
`GH_REPOSITORY`.)_ A Gitea (a dona do merge) porque a leitura da branch
protection exige `GITEA_TOKEN`; e o GitHub porque o repositório é **PRIVADO num
plano sem branch protection** — medido: `gh api
repos/severinno/severinno/branches/main/protection/required_status_checks`
responde **HTTP 403** ("Upgrade to GitHub Pro or make this repository public"), o
que é o **mesmo estado** que o applier já declarava em
`ci/required-checks-applied.json` (`unsupported: {reason, readAt}`) desde 20/09.
Nenhuma credencial resolve o segundo: é decisão de plano × visibilidade. As duas
lacunas estão datadas no registro, com a prova e o remédio de cada uma.

**E a RE-MEDIÇÃO do mesmo dia, já com a régua fechada (o perfil completo, com
`GH_TOKEN` + `GH_REPOSITORY` + `--expected 1.3.14`): veredito `BLOQUEADA`,
um bloqueio — o runner auto-hospedado do GitHub não está registrado (o setup
declara 4 labels e `repos/severinno/severinno/actions/runners` devolve
`total_count: 0`, medido com `gh api`) —, e as **19 linhas** das três listas
(1 bloqueio + 11 não-provados + 7 "o veredito não cobre") saem **todas
datadas**: os 14 itens de `ci/unproven.json` foram consumidos, nenhum ficou órfão.
As duas causas de proteção aparecem as duas (a forja sem o recurso e a forja não
lida), os 66 gates viram 2 linhas, e a `image-mirror-values` segue **aberta e
medida no mesmo dia** (`gh variable list` continua devolvendo só `BUN_VERSION` e
`HOSTINGER_VM_ID`). O limite do exercício continua declarado: nenhuma das
duas lacunas de forja fecha com o que existe NESTE checkout — uma pede o plano, a
outra o token do VPS.

**E a medição do dia seguinte mostra o mecanismo FECHANDO (o ciclo inteiro).**
Com o runner auto-hospedado JÁ registrado e a versão registrada igual ao pin do
script, o registro passou a **16 itens** — 8 abertos, 6 limites e **2 provados**
(`github-self-hosted-runner` e `github-runner-version`): os dois saem no veredito
como **letra morta**, instruindo a remoção da entrada, porque a lacuna que eles
declaravam foi MEDIDA — é a reconciliação das outras dívidas operando sobre o
registro, e não um alerta que ninguém fecha. A LINHA da letra morta também sai
datada: o `matches` de um item pode nomear o **próprio id** (é ele que a linha
publica), então nem o fechamento de uma declaração a tira do tempo. E a classe
volta a ser declarada se o serviço voltar a recusar o pin — o guard continua
comparando e BLOQUEANDO o drift, com item ou sem ele.

**E a medição achou um furo de CANAL na própria leitura da proteção.** O
aplicador resolve o repo por `GITHUB_REPOSITORY` (github) e `GITEA_REPOSITORY`
(gitea) — e `GITHUB_REPOSITORY`, **num runner da Gitea**, aponta para o
repositório DA GITEA (o contexto emulado é o da forja). O doctor que rodasse ali
com o token do GitHub iria ler o repositório errado, e só continuaria correto
enquanto os dois slugs coincidissem (aqui coincidem — o que é exatamente o tipo
de defeito que passa despercebido até o dia em que não coincidirem). A leitura
passou a mandar o repo de cada forja pelo CANAL DELA (`GH_REPOSITORY` /
`GITEA_REPOSITORY`, os mesmos que o board e o publicador de issue usam) via
`--repo`, que vence o ambiente no aplicador — com teste que exige os dois canais
e que **nenhum `--repo` é inventado** quando o canal não está declarado.

**E o canal deixou de ser de UMA leitura: ele é a régua de TODAS.** A proteção
foi o primeiro fato a precisar dele, mas o defeito era da classe inteira — o
mesmo runner da Gitea responde `GITHUB_REPOSITORY`/`GITHUB_API_URL` com os valores
da FORJA, e **qualquer** consulta que os usasse como origem acertaria só enquanto
os dois slugs coincidissem. Hoje o doctor resolve o canal uma vez
(`forgeRepo(forge, env)`, com o NOME da variável viajando junto do valor) e o
leva a cada leitura que consulta um repositório: a **proteção** (`--repo`), o
**board** (`repo` explícito, que também impede o `gh` de resolver o repo pelo
REMOTO do checkout — no runner da forja, o remoto do Gitea), os **labels do
runner** (o guard passou a ler `GH_REPOSITORY`; `GITHUB_REPOSITORY` deixou de ser
lido, e a ausência do canal é `env-missing` NOMEANDO a variável que falta) e as
leituras de **registry/imagem** (que recebem o ambiente sem o contexto
compartilhado, e cuja credencial — `GHCR_TOKEN`/`GITHUB_TOKEN`/`GHCR_USER` — é
preservada de propósito: credencial não é localizador de repositório). O
ambiente que sai para elas é uma CÓPIA sem `GITHUB_REPOSITORY`/`GITHUB_API_URL`
(`channelEnv`), feita UMA vez no `diagnose`: com oito fatos montando a própria
cópia, o nono divergiria. E o relatório não pode carregar o slug da forja
emulada em lugar nenhum — **nem na mensagem herdada do aplicador**, que dizia
"defina `GITHUB_REPOSITORY`" justamente sobre a variável que o doctor recusa ler.

A prova disso é de fora para dentro, no fluxo COMPLETO: com o decoy
(`GITHUB_REPOSITORY: forja-emulada/decoy`) e o canal (`GH_REPOSITORY`) no mesmo
ambiente, cada consulta (as duas proteções, as duas leituras do board, o canal do
board e os labels do runner) recebe **o canal** e um `env` sem o contexto
compartilhado — e o decoy não aparece no que elas receberam **nem no veredito que
saiu delas**. O lado oposto tem teste próprio: sem canal e **com** o decoy, o repo
vai NULO (a consulta não acontece) em vez de virar o repositório da forja.

---

## 14. O ensaio do runtime — `prove-forge-runtime` (`scripts/prove-forge-runtime.mjs`)

**Isto também NÃO é um guard.** É o comando que responde à pergunta que o doctor
NÃO responde: `bun run forge-runtime:prove`. E a diferença entre os dois é o
sujeito da medição — o doctor mede o **repositório, o registry e o HOST** ("a
forja pode bloquear o merge?"); este comando mede o **RUNTIME do job**: o job
`guards` inteiro executado DENTRO da imagem que o runner usa, com o repositório
montado, e não na máquina de quem desenvolve.

**Por que a distância existe (cinco diferenças que nenhum guard estático vê):**

| O que muda lá                                             | O que passa a ser falso aqui                                                                                |
| :-------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------- |
| o `docker` do RUNNER, com o **socket** montado            | sem o socket, um gate que use o docker falha por limitação do ENSAIO (alarme falso ensina a ignorar o gate) |
| o plugin `compose` que a invariante 7 usa para renderizar | sem ele o render fica INDETERMINADO dentro de um job verde                                                  |
| o `node`/`bun` que a imagem embarca (não os do host)      | um gate que dependa do runtime do host passa aqui e quebra lá                                               |
| o workspace em OUTRO caminho, como OUTRO usuário          | `git` recusa o repo por _dubious ownership_; cwd relativo deixa de valer                                    |
| o `node_modules` que a forja tem (ou não)                 | um gate que use uma dep instalada à mão passa só nesta máquina                                              |

**As três etapas, em ordem — e a ordem é a decisão:**

1. **CONSTRÓI** o `Dockerfile.ubuntu-bun` (com o `BUN_VERSION` declarado) e marca
   a imagem com a referência que o compose pede (`resolveImageRef` — a MESMA
   função do `runner-image:ensure`, então o alvo ensaiado é o alvo publicado);
2. roda as **ASSERÇÕES do contrato DENTRO do artefato** — o mesmo bloco `RUN` do
   Dockerfile, pelo mesmo `runContractInImage`/`classifyImageRun` do
   `check:runner-base`. `proven` exige a MARCA do bloco, não só `exit 0`;
3. só então roda o job `guards` INTEIRO no container, medindo o **ambiente**
   (usuário, cwd, node, bun e caminho, docker, plugin, socket, git, node_modules)
   e um resultado POR GATE, com a saída do gate que falhou.

O **3 depois do 2** não é ordem de conveniência: ensaiar a bateria contra um
artefato que não passou no contrato diria "os gates passam lá" sobre a imagem
errada — o pior verde possível.

**A bateria é DERIVADA, como no doctor:** sai do job `guards` da pipeline dona do
merge (`forgeGates`), com o COMANDO vindo da linha `run:` (que preserva flags —
`node scripts/rotate-secrets.mjs --check` roda COM o `--check`; executar o rótulo
rodaria a modalidade de EFEITO). Não existe lista paralela: um gate novo na
pipeline entra no ensaio sozinho, e um gate cujo `run:` sumiu faz o ensaio
**RECUSAR** (`unavailable`) em vez de rodar uma bateria menor do que ele diz.

**Tri-estado, como o resto da família:** `proven` (exit 0) · `failed` (exit 1 — o
contrato ou um gate quebrou DENTRO da imagem, nomeando qual) · `unavailable`
(exit 2 — sem docker, build que falhou, imagem ausente: ausência de prova, nunca
"está pronto"). Todo desfecho tem o MESMO formato (`rehearsalResult`), então o
`--json` de um indeterminado não muda de shape.

**O que ele NÃO cobre, e o relatório escreve isso:** o **RUNNER** em si (registro,
labels, agendamento — é o job de verdade e o smoke), o **valor real de
`vars.BUN_VERSION`** (aqui vem do env local ou de `--bun-version`) e o
`node_modules` da forja quando `--install` não é passado (o container vê o do
host). Sem socket, o relatório acrescenta uma linha própria: nenhum gate que use
o docker foi provado ali.

**Onde roda:** manual/operador (`bun run forge-runtime:prove`), antes de publicar
a imagem do runner e no primeiro contato com uma forja nova. Fora do CI de
propósito: ele constrói imagem, monta o socket do docker e pode rodar a bateria
inteira — é ensaio, não gate.

---

## 15. A Prova 4 do smoke sob mutação — `prove-smoke-render-gate` (`scripts/prove-smoke-render-gate.mjs`)

**Isto também NÃO é um guard.** É o comando que responde a uma pergunta que só a
injeção responde: `bun run smoke-render:prove`. A Prova 4 do smoke exige o render
do compose DENTRO do job (`--require-compose`) — mas _um gate que exige é um gate
que falha?_ Se ele passar numa imagem **sem** o plugin `compose`, a exigência é
decorativa e a invariante 7 segue não verificada **dentro de um job verde**. A
única prova é injetar a falha e ver o vermelho.

**As duas passadas, no MESMO container e com o MESMO comando** — extraído do
próprio `forge-smoke.yml` (âncora na linha `- name:`, nunca na prosa: o cabeçalho
do workflow cita "Prova 4" ao explicar a flag, e ancorar ali mediria o
comentário):

| Passada      | O que roda                                          | Resultado que a prova exige               |
| :----------- | :-------------------------------------------------- | :---------------------------------------- |
| **CONTROLE** | a imagem do runner, com o plugin que ela embarca    | o render é **PROVADO** (marca de sucesso) |
| **MUTAÇÃO**  | a mesma imagem, com o plugin `compose` **removido** | o passo fica **VERMELHO** (marca da flag) |

**O controle não é cerimônia.** Sem ele, um vermelho na mutação poderia vir de
qualquer outra coisa — imagem ausente, docker sem socket, repo ilegível — e a
prova atribuiria ao plugin um defeito que não é dele. É o mesmo cuidado do
contrato da imagem publicada: separar **violação** de **não-prova**.

**A leitura do desfecho é pelo TEXTO do gate**, não pelo exit code sozinho
(`classifyRenderRun`): um passo que deixou de conferir pode sair 0 e ser lido
como prova. As marcas vêm do guard que as imprime
(`COMPOSE_RENDER_PROVEN_MARK`/`REQUIRE_COMPOSE_FAIL_MARK`), para quem mede não
reescrever a frase e passar a medir o vazio.

**Tri-estado, como a família:** `proven` (o controle prova E o mutante morde) ·
`violated` (o mutante passou num container sem o plugin, ou o controle não provou
o render) · `unavailable` (sem docker ou sem a imagem do runner — ausência de
prova, nunca "está certo"). O `--json` tem o mesmo shape nos três.

**O vermelho que ele produz** — este é o resultado esperado da mutação, e é o que
a prova existe para ver:

```
  controle : ✅ proven — o render do compose foi PROVADO dentro do container
  mutacao  : ✅ not-provable — o render NAO foi provado (exit 1) e o gate acusou, como pedido
             check-registry-source: ❌ --require-compose: o render do deploy/docker-compose.gitea.yml
             NAO foi provado (unavailable) — docker compose indisponivel: docker: unknown command: docker compose.
             error: script "check:registry-source" exited with code 1

  ✅ PROVEN: com o plugin o deploy/docker-compose.gitea.yml renderiza; sem ele a Prova 4 fica VERMELHA
```

**O que ele NÃO cobre, e o relatório escreve isso:** a linha
`bun install --frozen-lockfile` do passo (escreveria `node_modules` no worktree e
não tem como influenciar a existência do plugin — o comando sob prova é a LINHA
que decide o status da etapa), o resto do smoke (Provas 1-3 e 5) e o **socket**
do job. O repositório é montado **read-only**: a prova mede o checkout sem
alterá-lo.

**Onde roda:** manual/operador (`bun run smoke-render:prove`), no host que tem a
imagem do runner — junto do `forge-runtime:prove`, antes de confiar o merge à
forja e em toda mudança do `Dockerfile.ubuntu-bun`. Fora do CI de propósito:
depende de docker e da imagem local.

---

## 16. O merge bloqueia mesmo? — `prove-gitea-merge-gate` (`scripts/prove-gitea-merge-gate.mjs`)

**Isto também NÃO é um guard.** É o comando que responde à pergunta que nenhum
arquivo responde: `bun run merge-gate:prove`. `ci/required-checks.json` declara os
checks e `apply-required-checks.mjs` os aplica — mas declarar e aplicar **não é**
bloquear: a exigência mora na forja, e o que a forja faz com ela só se sabe
rodando. (O que foi aplicado fica DECLARADO em `ci/required-checks-applied.json`,
escrito pelo próprio applier e cobrado no PR pela `check:required-checks` — ver a
seção 1: uma mudança de contexto que venha sem essa declaração deixa a forja
exigindo o check antigo.) O comando sobe um **Gitea efêmero** (docker), aplica o manifesto com o
**APLIADOR DE VERDADE** (a CLI, com `GITEA_URL`/`GITEA_TOKEN` no ambiente) e tenta
mergear quatro PRs de verdade contra a **API de verdade**.

| Caso                          | Status do check exigido | Merge esperado |
| :---------------------------- | :---------------------- | :------------- |
| CONTROLE — todos verdes       | `success`               | PERMITIDO      |
| GATE VERMELHO                 | `failure`               | RECUSADO       |
| GATE AUSENTE                  | (nenhum)                | RECUSADO       |
| EXIGÊNCIA DESLIGADA (mutação) | `failure`               | PERMITIDO      |

**A última linha é o ponto.** No Gitea, `status_check_contexts` guarda a LISTA
exigida e `enable_status_check` é quem a transforma em bloqueio — e o default da
API é `false`. Medido contra um Gitea 1.22 real: com os contextos e o booleano
desligado, um PR com `Repo Guards=failure` **mergeia** (HTTP 200); com o booleano
ligado, a recusa é `not allowed to merge [reason: Not all required status checks
successful]`. Por isso o applier **envia** o booleano e o trata como drift, e por
isso a prova demonstra a diferença em vez de afirmá-la.

**O controle não é cerimônia.** Sem ele, um "recusado" poderia ser qualquer outra
coisa — PR não mergeável, branch desatualizada, API fora — e a prova atribuiria ao
gate um bloqueio que não é dele. Cada caso ESPERA a mergeability assentar antes de
tentar: contra um PR recém-criado a forja responde `405 Please try again later`,
que **não** é o gate (é a forja calculando se o PR mergeia), e tratar essa recusa
como "o gate morde" daria verde falso no caso que deve mergear **e** vermelho falso
num caso barrado por outro motivo.

**O applier é exercitado como PROCESSO, não como cópia da chamada** — o caminho é
o que o operador roda. Depois de aplicar, o `--check` do MESMO applier tem de
reportar sincronia (a aplicação é idempotente) e — com a exigência desligada pela
mutação — tem de reportar **drift** acusando `enable_status_check`. Um detector que
não vê o modo silencioso não protege nada.

**O REGISTRO é CONFERIDO, não só lido.** Logo depois de aplicar, a prova compara a
lista que a proteção **registra** (`status_check_contexts`) com a do manifesto,
nome a nome (`registrationDelta`): contexto a **menos** (o job roda e o merge
passa), contexto a **mais** (o PR trava para sempre esperando um check que nunca
roda — o modo de falha do nome instável) e contexto com **CONTAGEM** no nome. Os
dois lados entram na varredura do número: ele pode vir do manifesto (defeito de
origem) ou de um registro velho que o applier não corrigiu.

Medido contra o Gitea 1.22 real que a prova sobe, com o manifesto de hoje:
`registro : 7/7 contextos registrados, sem contagem`. Antes desta metade a prova
apenas **imprimia** o registro — uma aplicação que registrasse um SUBCONJUNTO
saía verde, e o único jeito de descobrir era ler o relatório à mão.

**Tri-estado, como a família:** `proven` (a matriz bate e o applier está íntegro) ·
`violated` (o gate vermelho mergeou, o controle não mergeou, um caso não foi medido,
ou o applier não ligou a exigência) · `unavailable` (sem docker, imagem ausente,
API não subiu). O relatório humano e o `--json` têm o mesmo shape nos três.

**A regressão mais importante é travada por teste** (`prove-gitea-merge-gate.test.ts`,
hospedado com docker e API dublados): um applier que regride para o payload sem o
booleano sai **VIOLADO** — e não `unavailable`, que faria a regressão parecer
falta de medida —, um applier que registra um SUBCONJUNTO do manifesto sai
VIOLADO **nomeando o contexto que ficou fora**, e uma proteção cujo registro
carrega CONTAGEM sai VIOLADA citando o contexto e o trecho. Os testes também fixam
que `enable_status_check=false`, com os contextos registrados, é tratado como
drift pelo `--check`.

**E a régua do REGISTRO tem prova por MUTAÇÃO**
(`scripts/test-mutation-gate-registration.sh`, sub-test `gate-registration` do
master). Ela mede as CINCO metades e cada uma cai no seu fato:

| metade                                            | mutação                        | o que acontece sem ela                                                                                                      |
| :------------------------------------------------ | :----------------------------- | :-------------------------------------------------------------------------------------------------------------------------- |
| o contexto a **MENOS** (`missing`)                | a lista sai vazia              | o registro que perdeu um contexto do manifesto sai **PROVADO** — o job roda e o merge passa com ele vermelho                |
| o contexto a **MAIS** (`extra`)                   | a lista sai vazia              | o PR que trava para sempre deixa de ser **NOMEADO** (o sintoma ainda aparece na matriz; o que morre é a CAUSA no relatório) |
| a **CONTAGEM** no nome (`withCount`)              | a lista sai vazia              | `Lint (3 checks)` registrado e nenhuma palavra sobre o número que muda sozinho                                              |
| o **FIO** do veredito (`if (!registration.ok)`)   | o delta é calculado e ignorado | é o defeito ORIGINAL: a prova lê o registro, imprime e segue verde com um subconjunto                                       |
| a régua da contagem **GULOSA** (`countInContext`) | qualquer dígito vira contagem  | o contexto editorial legítimo (`… (pré-requisito 0, por execução)`) é **ACUSADO**: violação FALSA numa proteção correta     |

O veredito é medido **por execução**, não por leitura: `scripts/merge-gate-fake-forge.mjs`
roda o MOTOR da prova (`proveGiteaMergeGate`, o mesmo caminho de código que o cron
executa) contra uma forja DUBLADA sobre um checkout sintético cujo manifesto
declara os contextos — docker, CLI do Gitea e API HTTP dublados, **sem docker e
sem `node_modules`** (roda no master mesmo num job sem install). O dublê não
decide nada da régua: ele responde como um Gitea 1.22, inclusive a REGRA de merge
(exige `success` de TODOS os contextos registrados e bloqueia só com
`enable_status_check` ligado). A segunda testemunha é a suíte unitária, com
ÂNCORAS: o vermelho tem de ser o da metade mutada e as outras metades seguem
verdes (sem `vitest` instalado, ela se declara NÃO JULGÁVEL em voz alta e o
veredito por execução segue medindo).

Limites declarados: (a) o TRANSPORTE é dublado — o Gitea efêmero de verdade é
medido pelo `merge-gate-proof` (cron semanal e PR que toca os caminhos da prova),
e um caminho novo na prova cai no 404 `nao mapeado` do dublê, o que muda o
veredito de forma VISÍVEL em vez de virar verde por acaso; (b) a mutação roda NO
LUGAR, então ela vive no master (matriz serial dentro de UM job) e não num job ao
lado do `merge-gate-proof` — dois jobs do mesmo workflow rodariam em paralelo e a
prova do Gitea poderia ler o guard mutado (a árvore é restaurada por checksum); e
(c) a régua de QUAL contexto o manifesto declara é de outro guard
(`check-required-checks`), com prova própria.

**O que NÃO cobre, e o relatório escreve:** o act_runner (aqui os status são
postados pela API — que é o que o job faria), a forja de produção (o container é
efêmero e local) e o resto do branch protection (reviews obrigatórios, push
restrito). Um `violated` é acionável: ou a forja não bloqueia, ou o applier
regrediu — nos dois casos, não confie o merge à forja.

**O CONTEXTO tem de ser ESTÁVEL, e isso é guardado antes do merge.** Um required
check é identificado pelo `name:` do job; um nome que carrega uma **contagem**
("(27 node-pure mutation tests)", ", 5 cenários", "(40 guards)") faz o
**contrato de merge** mudar quando o número muda — e neste repositório esses
números são derivados e crescem. O modo de falha é o pior desta família: a
proteção da forja passa a exigir um check que não existe e o PR trava para
sempre, sem nenhuma linha de workflow parecer errada (o defeito está no NOME, não
no gate). Por isso `contagemNoContexto`/`validateManifest` do
`check-required-checks` recusam o padrão no manifesto, e a proteção aplicada na
forja é lida por `apply-required-checks --check` para que a divergência apareça
como **issue** de drift em vez de esperar por alguém.

Dois nomes reais carregavam contagem e foram corrigidos por essa regra:
`mutation-guards` (`Mutation guards master (27 …)` → `Mutation guards master`) e
`mutation-coord-update` (`… doc↔anchor↔código, 5 cenários` →
`… doc↔anchor↔código`). O count continua onde é DIAGNÓSTICO — summary do job,
comentário, header do master, README e o nome do STEP do contrato coordenado,
que não é contexto de required check.

**Onde roda:** manual/operador (`bun run merge-gate:prove`), no host com docker —
antes de confiar o merge à forja e em toda mudança do applier ou do manifesto.
Uso inválido sai **3**; um `--keep` deixa o container no ar para inspeção.

**E num CRON, com o ciclo de reconciliação das outras dívidas.** A prova era boa e
sem testemunha: rodava sob demanda, no host de quem já desconfia — e o que ela mede
é CÓDIGO (o applier) cujo efeito ninguém vê no PR. O job `merge-gate-proof`
(`.github/workflows/merge-gate-proof.yml`, semanal) roda esta prova e entrega o
veredito ao publicador `merge-gate-issue.mjs`: **violado** abre/atualiza a issue
(o corpo traz o contexto exigido, o delta nas três direções — o que falta, o que
sobra e o que carrega CONTAGEM —, a matriz caso a caso e os LIMITES da prova,
que saem do MESMO relatório que a CLI imprime em `--json`); **provado** comenta a
prova e FECHA o que ele mesmo abriu; **`unavailable`** (sem docker, imagem não
puxável, API fora) não publica e não fecha — ele FALHA o run nomeando o caso, e
nada é fechado por um veredito que não mediu. Duas naturezas de falha são dois
títulos e duas assinaturas (`registro` e `matriz`), porque os remédios são
diferentes: uma falha de matriz não pode virar comentário na dívida do registro.

**E no PR — a outra ponta do mesmo veredito.** A issue chega na segunda-feira, e
quem mudou o applier está num PR HOJE: o MESMO relatório (sem segunda medição,
compartilhado pelo caminho do job) vira um COMENTÁRIO RECONCILIADO no PR pelo
`merge-gate-comment.mjs`. **violado** publica o contexto e o delta onde o autor
lê — o corpo sai das MESMAS funções puras do relatório que a issue usa
(`deltaOf`/`registrationOf`/`natureOf`), porque uma segunda leitura do JSON
divergiria no dia em que o campo fosse renomeado, e os dois canais passariam a
discordar sobre o mesmo ensaio. **provado** RETIRA o comentário (o delta sumiu).
**`unavailable`** não publica e NÃO retira: apagar o último aviso com base numa
medição que não aconteceu é o falso verde desta classe — no PR o caso é AVISO
nomeado, e quem FALHA por não medir é o cron. O marcador é PRÓPRIO (o remédio do
pre-commit pode viver no mesmo PR, e um marcador comum faria a reconciliação de um
retirar o comentário do outro), e o corpo é ESTÁVEL (sem data nem URL do run):
duas medições com o mesmo delta dão `noop` em vez de reescrever o comentário a
cada run. O trigger de PR filtra os CAMINHOS que a prova mede (o applier, o
manifesto, o guard do contrato, os publicadores e o compose do ensaio) — um PR
que não os toca não paga o custo de subir o Gitea efêmero.

**Por que a forja do GitHub, e não um par no `.gitea/`:** a prova exige docker, e
nesta forja os jobs rodam DENTRO do container da imagem `ubuntu-bun`, sem o socket
montado (a assimetria é a mesma que o `pre-commit-in-runner-proof` documenta) — lá
o veredito seria `unavailable` para sempre. Aqui o runner é `self-hosted` e tem
docker. A prova não mede a proteção do GITHUB: ela mede a PEÇA (o applier e o
manifesto) contra uma forja descartável; quem mede a proteção real é o
`required-checks-drift`.

---

## 17. Jobs periódicos — todo alerta tem canal (`check:periodic-alerts`)

**O que protege:** que nenhum job de workflow AGENDADO termine VERDE por
DESENHO sem canal acionável. Um `::warning::` (ou um `continue-on-error`, ou um
guard que "só avisa") dentro de um run que passou é alerta **MUDO** — ninguém
abre o log de um cron verde. É o mesmo defeito que o repositório corrigiu dez
vezes (`actrc-sync-issue.mjs`, `readme-reverse-issue.mjs`,
`required-checks-drift-issue.mjs`, `forge-doctor-issue.mjs`,
`mutation-trend-issue.mjs`, `blob-crlf-scope-issue.mjs`,
`env-mirror-drift-issue.mjs`, `guard-timing-issue.mjs`, `bench-freshness-issue.mjs`,
`runner-shells-issue.mjs`,
`merge-gate-issue.mjs`, `github-dependencies-issue.mjs`) — mas a REGRA vivia na
cabeça de quem escreveu cada job, então o décimo primeiro caso entraria em
silêncio.

**A auditoria (32 jobs em 13 workflows agendados, duas forjas).** O que foi
encontrado e o desfecho de cada um:

| Canal       | Jobs                                                                                                                                                                                                                                                                                                                                                                         | Por que                                                                                                            |
| :---------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------- |
| **`issue`** | `benchmark` (regressão PostGIS), `readme-reverse-audit`, `actrc-sync`, `mutation-coord-timing` + `mutation-coord-trend` (via `mutation-coord-alert`), `drift` (GitHub e Gitea), `doctor` (forja), `blob-crlf-all-text-alert`, `actrc-sync` (forja), `env-mirror-drift` (forja), `guard-timing-alert`, `runner-shells-drift`, `merge-gate-proof`, `github-dependencies-audit` | o run fica verde de propósito (tendência/aviso não bloqueia); a issue é o canal, com dedup e fechamento automático |
| **`fail`**  | `smoke`, `setup-bun-warm`, `act-startup-bench`, `blob-crlf-history-audit`, `secret-leaks-audit`, `seed-guards`, `default-branch-workflow-guard`, `benchmark-all`, `benchmark` (GiST), `mirror` (×3), `guard` (tier-1)                                                                                                                                                        | o sinal é violação de corretude/configuração: o run vermelho é a resposta certa                                    |

**Os dois defeitos que a auditoria fechou (não eram só teóricos):**

| Job                                         | Defeito medido                                                                                                                                                                                                                                           | Remédio                                                                                                   |
| :------------------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------- |
| `mutation-coord-trend` / `-timing`          | o `measure-mutation-trend` emite `::warning::` e sai 0 quando o drift passa do limiar; o de budget faz o mesmo na faixa SOFT. Verdes por desenho, **sem canal nenhum** — o drift lento (40s→55s→75s) só aparecia ao cruzar o teto duro                   | novo job `mutation-coord-alert` publica a issue (`mutation-trend-issue.mjs`) e FECHA quando volta à faixa |
| `benchmark` (GiST, `benchmark-gist-weekly`) | o step de validação usa `continue-on-error: true` e o único canal era o Sentry, **condicional a `SENTRY_DSN`** — sem o secret, o job terminava verde; pior: o "Update baseline" reescrevia o baseline com a medição ruim, e o drift virava o novo NORMAL | step `Fail on crossover regression` ANTES do update do baseline (o GitHub pula os steps seguintes)        |

**Por que UM publicador, alimentado pelos DOIS relatórios, e não um por job:**
os dois medidores leem o MESMO step com limiares **diferentes** (margem relativa
vs drift % por var). Se cada um publicasse/reconciliasse por si, o mais frouxo
fecharia a dívida que o mais estrito acabou de abrir — e, como o limiar é
variável, essa aninhagem não pode ser presumida. O job de alerta espera os dois
(`needs`), baixa os artifacts `if: always()` e passa os relatórios juntos:
`warned` = algum fora da faixa; reconciliar exige **todos medidos e nenhum fora**.
`found: false` (medidor quebrado) **nunca** reconcilia — "não medido" não é
evidência de "normal", e é assim que um alerta otimista apagaria a dívida.

**A decisão é ESCRITA e verificável, como no `ci/required-checks.json`:**
`ci/periodic-alerts.json` lista cada job agendado com o **canal**
(`fail`/`issue`/`comment`) e uma **evidência** — um literal que precisa existir no
bloco DAQUELE job (o step que falha, o publicador, o step de comentário), não no
arquivo: a evidência de outro job não vale. Um `via` declara que o canal vive em
outro job do mesmo workflow (é o caso dos dois medidores → `mutation-coord-alert`),
e aí a evidência é procurada no bloco do `via`.

**A COBERTURA é a parte que impede a regressão:** um job agendado sem entrada no
manifesto **falha** o guard, e o teste trava a contagem (**31**). Um cron novo no
`.github/` ou no `.gitea/` não entra em silêncio — ele obriga alguém a escrever
qual é o canal dele, ou a descobrir que não tem nenhum.

**O que NÃO prova:** que o canal FUNCIONA — isso é dos testes de ciclo de cada
publicador (contra um backend dublê). Prova que a decisão existe, que o canal é
um dos três aceitos e que a evidência declarada está de fato no workflow.

**Onde roda:** `bun run check:periodic-alerts` (auditoria legível, `--json` para
máquina, exit 1 em violação) e — o gate de verdade — via `test:unit`
(`src/lib/__tests__/periodic-alert-channels.test.ts`), que já roda em toda PR nas
duas forjas. Não precisou de job próprio justamente por isso: o agregador de
testes É o gate, e um job novo só somaria superfície.

**Fonte única das pastas:** a varredura usa `allWorkflowFiles` de
`scripts/forge-workflows.mjs` — a mesma lista que a paridade e o escopo de forja
usam, então uma forja nova entra na auditoria sozinha.

---

## 18. O contrato de documentação das provas — `check:prove-docs`

**O que protege:** a família `prove-*`/`doctor` só vale pelo que ela PROMETE —
"a forja pode confiar o merge a este gate?". Cada comando dessa família devolve
um tri-estado (provado / violado / indeterminado) e um texto que quem opera a
forja lê. Duas coisas dão errado em silêncio:

1. **COBERTURA** — um comando novo entra sem resultado esperado documentado: quem
   lê a doc não sabe o que ele imprime nem o que cada desfecho significa, e o
   comando passa a se explicar só para quem o roda;
2. **FIDELIDADE** — a doc continua descrevendo a saída de ANTES (um `--json` que
   trocou de shape, um veredito que passou a sair por outro caminho). A doc vira
   uma mentira com aparência de rigor — pior que a ausência dela, porque quem
   confia no bloco documentado confia em nada.

**Por que existe:** as duas falhas acima não têm sintoma. O bloco documentado
não é prosa: é a **asserção**. O guard EXECUTA o comando e compara com ela.

**A família é DERIVADA, não listada:** os scripts de `package.json` que invocam
uma prova (`scripts/prove-*.mjs`), o `--prove` do `ensure-runner-image.mjs` (a
prova do bloqueio da imagem) ou o `forge-doctor.mjs`. Um comando novo entra
sozinho — e falha até alguém escrever o bloco dele. O inverso também fecha: um
bloco que aponta para comando fora da família é violação (doc descrevendo o que
não existe). O `doctor:issue` fica de fora de propósito: ele PUBLICA o veredito,
não o mede.

**O bloco (formato):** imediatamente antes da cerca de saída esperada, em
qualquer Markdown de `docs/` (ou no README):

````md
<!-- prove-doc: <nome do comando em package.json>
     run: <argumentos acrescentados ao comando>
     exit: <n>|<n>...
     cenario: ambiente|docker-ausente
     desfecho: provado|indeterminado
-->

```text
<linha que tem de aparecer na saída REAL>
```
````

O guard exige: **um** bloco por comando (nem zero, nem dois), campos válidos,
cerca não vazia, e — o confronto — `exit` real entre os declarados e **cada**
linha exigida presente na saída (substring, com espaços normalizados, para o
pretty-print não virar falso negativo). Divergir é exit 1, com o diff dito.

### Os blocos — um por COMANDO (a família é derivada)

**`doctor`** — o perfil `--ci` (o recorte que roda a cada PR). As duas linhas
prendem o que o perfil NÃO pode perder: que ele se declara (o `ciProfile`) e que
NOMEIA o recorte em `unproven` (nenhuma seção some por omissão). O exit admite
`2` (INDETERMINADA por desenho do perfil) e `1` (BLOQUEADA, quando um fato do
escopo local acusa).

<!-- prove-doc: doctor
     run: --ci --json
     exit: 1|2
     cenario: ambiente
     desfecho: indeterminado
-->

```text
"ciProfile": true
o PERFIL --ci: o recorte local (sem rede, credencial ou estado do HOST)
```

**`runner-image:prove`** — a prova do bloqueio da imagem, do PRÉ-REQUISITO 0 e
DAS INSTRUÇÕES do bring-up. É a única da família completa sem docker NEM imagem
local: ela sobe um registry de TESTE em `127.0.0.1` e um `docker` dublê, e por
isso é `desfecho: provado` aqui. As linhas prendem os dois lados do que ela
afirma: o veredito (`ok`/`holds`) e as SEIS famílias de caso — a subida simples
(`check-only`), o RE-REGISTRO (`re-register`), que é onde o risco mora, o passo 0
(`env-divergente`), que é o que roda no gate `bring-up-proof` das duas forjas, as
INSTRUÇÕES (`installer-check-only`), que são extraídas do instalador e do
runbook e EXECUTADAS — `"invokedAs"` é a linha que diz QUAL comando do documento
produziu aquele exit (é o `--re-register` do `deploy/GITEA.md`, e não a prosa que
citava a flag, que está em execução) — e o MODO `--no-runner` (`no-runner`),
que sobe Gitea+Caddy pula os pré-requisitos do runner, provando que o
`SKIP_RUNNER_PREREQS` funciona como a flag manda (ZERO idas ao registry, ZERO
chamadas ao docker para o runner). As COMBINAÇÕES CONTRADITÓRIAS
(`re-register-check-only`, `re-register-no-runner`) recusam ANTES de QUALQUER
docker — ZERO chamadas ao binário, ZERO idas ao registry, com o motivo na saída.

<!-- prove-doc: runner-image:prove
     run: --json
     exit: 0
     cenario: ambiente
     desfecho: provado
-->

```text
"ok": true
"status": "holds"
"id": "check-only"
"id": "re-register"
"id": "env-divergente"
"id": "installer-check-only"
"id": "no-runner"
"id": "re-register-check-only"
"invokedAs": "runbook --re-register"
```

**`forge-runtime:prove`** — o ensaio do job `guards` DENTRO da imagem do runner.
Exige docker e a imagem; o guard o executa em `--no-build` com o docker
**ausente de propósito** e cobra o desfecho que ele DOCUMENTA ter aí.

<!-- prove-doc: forge-runtime:prove
     run: --no-build --json
     exit: 2
     cenario: docker-ausente
     desfecho: indeterminado
-->

```text
"verdict": "unavailable"
--no-build pedido
```

**`smoke-render:prove`** — a Prova 4 do smoke sob mutação (container sem o plugin
`compose`). Exige docker e a imagem do runner.

<!-- prove-doc: smoke-render:prove
     run: --json
     exit: 2
     cenario: docker-ausente
     desfecho: indeterminado
-->

```text
"verdict": "unavailable"
NAO existe localmente
```

**`merge-gate:prove`** — o merge bloqueia mesmo? Sobe um Gitea efêmero (docker).

<!-- prove-doc: merge-gate:prove
     run: --json
     exit: 2
     cenario: docker-ausente
     desfecho: indeterminado
-->

```text
"verdict": "unavailable"
o container nao subiu
```

**`image-contract:prove`** — o contrato da imagem PUBLICADA contra um registry de
verdade (e não contra um `run` dublado). Exige docker e a imagem do runner.

<!-- prove-doc: image-contract:prove
     run: --json
     exit: 2
     cenario: docker-ausente
     desfecho: indeterminado
-->

```text
"verdict": "unavailable"
sem docker
```

### `cenario: docker-ausente` — por que sete blocos o declaram

Sete provas da família exigem docker, imagem do runner ou um Gitea efêmero —
não são reproduzíveis num runner de PR. O guard **não finge** que são: ele as
EXECUTA com um `docker` de mentira (exit 127) no começo do PATH e exige o
desfecho `indeterminado` que elas declaram ter nesse cenário. A invariante
verificada é a que este repositório mais trata como regra: **ausência de prova
NUNCA vira sucesso**. Um comando que passe a sair `0` sem ter provado nada é pego
AQUI, de forma hermética e em ~1s. O caminho PROVADO dessas sete exige docker e
é do operador (`bun run forge-runtime:prove`, `bun run smoke-render:prove`,
`bun run image-contract:prove`, `bun run merge-gate:prove`,
`bun run forge-smoke:prove`, `bun run pre-commit-in-runner:prove` e
`bun run gitea-registry:prove`) — a doc de cada uma diz o que ele exige.
O número não é decorativo: ele é o tamanho do conjunto que o `check:prove-docs`
EXECUTA a cada PR, e um bloco que troque de cenário muda essa conta.

**O desfecho é REPORTADO, nunca presumido:** um bloco `desfecho: indeterminado`
que casa conta como "indeterminado (declarado)" e NÃO como "a prova passou" — o
relatório separa as duas contagens, porque a única mentira que este guard não
pode cometer é a que ele existe para impedir.

**Recursão dita:** o guard executa `doctor --ci`, e o doctor no perfil `--ci`
PULA a bateria de guards (é a mesma razão do `--no-guards` do perfil) — por isso
este gate não se chama a si mesmo nem quando o doctor roda a bateria inteira.

**Onde roda:** job `guards` das duas forjas (`.gitea/workflows/ci.yml` e
`.github/workflows/pr-check.yml`) — e, por estar lá, entra sozinho na bateria que
o próprio `doctor` executa. Local: `bun run check:prove-docs`.

---

## 19. O smoke inteiro contra um act_runner efêmero — `forge-smoke:prove` (`scripts/prove-forge-smoke-ephemeral.mjs`)

**O buraco.** O `.gitea/workflows/forge-smoke.yml` prova cinco pressupostos de
AMBIENTE que nenhum guard estático enxerga: (1) o contexto `vars` hidrata, (2) o
setup por `run:` engaja o tier-1 da imagem do runner, (3) o runtime é o da
variable, (4) o job roda os guards por inteiro — inclusive o render do compose
com `--require-compose` — e (5) o REGISTRO do runner (`/data/.runner`) é o que o
compose declara. O `forge-runtime:prove` cobre o runtime do container, mas roda
na máquina de quem o executa e não tem runner nenhum. E o smoke é
`workflow_dispatch`: num PR ele não roda (um dispatch não reporta status, e
viraria um required check que ESPERA para sempre). Na prática, as cinco provas
dependiam de alguém clicar "Run workflow" na forja de PRODUÇÃO e ler o log a olho.

**O que este comando faz.** Sobe uma stack EFÊMERA — Gitea + act_runner — a
partir do MESMO `deploy/docker-compose.gitea.yml`, empurra um snapshot do
repositório (worktree, ou `HEAD` com `--source`) e roda o smoke COMITADO de
ponta a ponta, lendo o veredito de onde ele é de fato gravado.

- **a stack é DERIVADA, não redeclarada.** O override é gerado e contém só o que
  precisa ser efêmero: nomes de volume do projeto, uma porta local livre
  (127.0.0.1) e o nome do container do Gitea (o declarado pode estar ocupado por
  um container PARADO no host, e o ensaio não remove container alheio). Labels,
  imagens e serviços continuam vindo do compose real. O **runner NÃO é
  renomeado** de propósito: é o nome dele que a Prova 5 procura;
- **o env sai do template comitado** (`deploy/env.gitea.example`), com o
  `RUNNER_TOKEN` que o PRÓPRIO Gitea efêmero gerou. As repository variables do
  ensaio são as `vars.<NOME>` que o workflow USA (derivadas do arquivo) e o valor
  vem do template: um `vars.X` novo no smoke entra sozinho — e o ensaio recusa
  rodar se ele não existir no template, em vez de inventar valor;
- **o `config.yaml` do runner é GERADO** (e semeado no volume efêmero, com
  `CONFIG_FILE` no serviço, antes do runner subir). Ele existe por um fato
  medido: sem `container.network`, o act_runner cria uma rede POR JOB e o
  container do job nasce fora da rede do projeto — onde o nome do serviço
  `gitea` resolve —, e o primeiro passo do smoke (`actions/checkout@v4`) morre
  com `Could not resolve host: gitea`, sem que nenhuma das 5 provas rode. O
  arquivo declara SÓ esse campo: o resto é o default do próprio binário
  (`runner.file`, capacidade, timeout, cache ligado e o `docker_host` vazio, que
  acha o socket e o MONTA no job — é ele que a Prova 5 usa). Na PRODUÇÃO esse
  arquivo é do OPERADOR, no volume dele — é o `config.yaml` que a doc de remédio
  já cita, e sem essa linha nenhum job resolve a forja;
- **o veredito não é texto.** Ele vem de `action_task.status` no banco do Gitea
  efêmero (1 = sucesso, 2 = falha; MEDIDO na série 1.22 — e todo outro código é
  "ainda não terminou", incluindo o 6, que aparece com o job rodando) e o log
  COMPLETO do job — lido de ONDE a 1.22 o guarda: o ARQUIVO
  `actions_log/<log_filename>` quando a transferência já aconteceu, ou o DBFS do
  banco (`dbfs_meta`/`dbfs_data`, com os blocos de 32KB CONCATENADOS pela ordem
  de `blob_offset`) enquanto ela não acontece. As duas casas são tentadas na
  MESMA leitura, e o relatório diz de qual veio; ler só o arquivo saía
  INDETERMINADO por um lugar de leitura, não por um fato da forja (MEDIDO duas
  vezes: `No such file or directory` com a tarefa já terminal e o log inteiro no
  DBFS). E só um log ESTÁVEL — dois lados da mesma medida — é aceito: um log
  ainda em curso leria como "passo não rodou";
- **as expectativas vêm do arquivo.** Quem diz "este passo EXECUTOU" é o GRUPO
  que o runner abre para cada passo (`::group::Run <rótulo>`), exigido por
  CONTAGEM: os três primeiros `run:` do smoke abrem com o mesmo
  `set -euo pipefail`, e "a linha existe" deixaria um run onde só o primeiro
  rodou passar como se todos tivessem rodado. O rótulo é derivado do TIPO do passo — `uses:` sem nome → a
  referência, `uses:` com nome → o nome, `run:` → a primeira linha do script —
  porque é assim que o runner o deriva. O `⭐ Run Main <nome>` **não** serve de
  régua (medido: o runner o grava para o PRIMEIRO passo do job e para os estágios
  `Post` — e não para os demais). Além dele, cada `echo "✅ …"` e cada `echo
"::error:: …"` do smoke
  entram truncados na primeira interpolação — e as linhas de ECO do script (o
  act imprime o script antes de executá-lo) são DESCONTADAS: sem isso todo run
  verde traria os sete literais de `::error::` do próprio smoke e o ensaio
  reprovaria a forja que ele existe para julgar. Um `✅` novo passa a ser exigido
  sozinho; um passo que não rodou vira vermelho DIZENDO qual — e com que
  contagem;
- **o gatilho é a ÚNICA diferença do arquivo empurrado.** O Gitea 1.22 não tem
  `workflow_dispatch` — nem UI, nem API (medido: 404 em todas as rotas de
  dispatch da instância, e nenhuma delas existe no swagger). O ensaio ACRESCENTA
  `push: branches: [prova/smoke]` ao bloco `on:` e confere linha a linha que o
  resto é idêntico (`assertOnlyAddition`). O que se prova é o CORPO do smoke, e o
  relatório DIZ isso — em vez de dar a impressão de que o dispatch foi exercitado;
- **a prova é falsificável (a sentinela).** Antes do smoke, o ensaio empurra em
  `prova/sentinela` um workflow que FALHA de propósito e exige que o canal o veja
  como falha (status 2 + o marcador no log). Se o runner não executar
  job ALGUM, o desfecho é INDETERMINADO — não "o canal está cego" nem "a forja
  está quebrada": uma falha SEM nenhum passo rodado é problema de HOST, e o
  ensaio nomeia isso;
- **`--mutacao-labels` (fase 2).** Re-registra o runner com um label A MAIS que
  o compose não declara — o defeito invisível da Prova 5 (um label que ninguém
  usa não é visto pelas provas 2 e 3) — e exige o smoke VERMELHO com as provas
  1–4 ainda verdes. Vermelho NÃO basta: a linha `::error::REGISTRO VELHO` tem de
  estar no log, ou o vermelho não diz QUAL prova caiu. A fase já mordeu um
  defeito REAL do próprio smoke: o act roda cada `run:` com o shell
  `bash --noprofile --norc -e -o pipefail {0}` e `set -uo pipefail` NÃO desliga
  esse `-e` — o `OUT="$(…)"` da Prova 5 morria NA ATRIBUIÇÃO, o `case` era
  código morto e o job saía vermelho sem NENHUMA das três mensagens (MEDIDO:
  status 2 e `hitFailure` só com o marcador de job falho). O passo fecha com
  `+e`, e a suíte do smoke carrega a régua: todo `run:` que decide por `$?` tem
  de desligar o errexit que o runner impõe. O log da mutação passou a ir no
  relatório — um veredito violado tem de ser diagnosticável sem re-rodar.

**Desvios declarados (o relatório lista todos).** O gatilho acrescentado; a
sentinela (artefato do ensaio, não do repositório); o container do Gitea
renomeado; o `config.yaml` do runner (GERADO pelo ensaio e semeado no volume
`runner-data` do projeto — na produção esse arquivo é do operador, e o ensaio só
pode provar o que ele mesmo põe lá); e — só com `--sem-no-new-privileges` — a
stack do ensaio DIFERE da produção em uma linha: `security_opt:
no-new-privileges:true` do serviço `runner`. A flag existe porque em hosts com confinamento do daemon (medido:
Docker 29 sob snap) esse hardening impede QUALQUER `exec` dentro do container —
`tini`, `sh` e o `alpine` puro falham com `operation not permitted` — e o runner
nunca sobe. Sem a flag o ensaio DIZ isso, com o estado do container e a última
linha do log no veredito, e sai INDETERMINADO.

**Exit codes.** 0 = as provas rodaram e fecharam verdes (e a sentinela provou que
um vermelho é visto); 1 = alguma prova não deixou o desfecho positivo (ou a
sentinela não foi vista, ou a mutação de labels não derrubou a Prova 5); 2 =
não deu para ensaiar (sem docker/compose/imagem, produção no host, runner que não
registra, job que não termina a tempo); 3 = uso inválido.

**Onde roda.** Manual/operador — `bun run forge-smoke:prove` — com docker; em CI
de runner com docker disponível. O caminho `docker-ausente` é coberto a cada PR
pelo `check:prove-docs`, que o EXECUTA com um `docker` de mentira e cobra o
INDETERMINADO que ele documenta ter aí.

<!-- prove-doc: forge-smoke:prove
     run: --json
     exit: 2
     cenario: docker-ausente
     desfecho: indeterminado
-->

```text
"verdict": "unavailable"
docker indisponível
```

**O que NÃO cobre** (dito no relatório, não escondido): o gatilho
`workflow_dispatch` (não existe na série 1.22); a forja de PRODUÇÃO (o ensaio
RECUSA rodar se houver stack da forja no host — container `gitea-runner`
ocupado, ou projeto `deploy` RODANDO); TLS/Caddy, DNS e firewall (a stack sobe só
`gitea` + `runner`); e os jobs `guards`/CI reais — aqui roda o smoke, que é o que
ele se propõe.

---

## 20. A classe SIGPIPE — `check-pipefail-sigpipe` (`scripts/check-pipefail-sigpipe.mjs`)

**O que protege:** num contexto com `set -o pipefail`, `algo | grep -q PADRAO`
pode terminar **141 (SIGPIPE) MESMO com o padrão encontrado** — e de forma
**intermitente**.

**Por que existe (a mecânica, porque o defeito parece impossível):** `grep -q`
fecha o stdin no PRIMEIRO casamento (é o ponto de `-q`: parar de ler). Se o
produtor ainda tem bytes para escrever quando o leitor some, o kernel entrega
SIGPIPE a ele: o produtor morre com 141 e, sob `pipefail`, a soma do pipeline
passa a 141. Com pouco texto não acontece nada (tudo cabe no buffer do pipe e o
`write` termina antes de o grep sair) — e é por isso que o defeito SOBREVIVE: ele
depende do TAMANHO da saída (> `PIPE_BUF`, 4 KiB, basta para o `write` ser
fatiado). No mesmo script, uma rodada passa e a seguinte falha.

**O defeito real (09/2026):** os `test-mutation-*.sh` capturam a saída do
`vitest`/`bash` em variável e a empurram para um grep quieto
(`echo "$OUTPUT" | grep -Fq ...`). Com a suíte grande, o
`test-mutation-coord-update.sh` era vermelho em ~1 de cada 3 execuções, e o
diagnóstico apontava para asserções de CONTAGEM — a causa (SIGPIPE) não aparecia
em lugar nenhum da mensagem. A correção foi **herestring** (`grep -Fq PADRAO <<< "$OUTPUT"`):
nenhum pipe, nenhum produtor para levar o sinal, a mesma asserção.

**O remédio, e por que não `|| true`:** `<<< "$VAR"` entrega o texto por um
descritor que o PRÓPRIO bash preenche; não existe processo produtor para levar
SIGPIPE. `|| true` desliga a asserção junto com o defeito. Produtor vivo
(`docker ps | grep -q x`) é CAPTURADO antes: `out=$(docker ps); grep -q x <<< "$out"`.
O guard imprime a linha reescrita, não só a regra.

**Onde roda:** job `guards` da forja (dona do merge) e job `workflow-refs-guard`
do GitHub — as duas pontas do CORE, classificadas no `check:forge-parity`. E,
desde que a sexta classe do remédio entrou na oferta, **a fase B do
`.husky/pre-commit`** — com o MESMO comando do CI (sem recorte: metade do escopo
são corpos `run:`, e o veredito é do ESTADO da árvore, como o das outras guardas
globais daquela fase), medido em **~0,14s** (129 scripts + 33 workflows). Foi o
guard dono que saiu de `HOOK_NOT_RUN`: a razão antiga era de custo ("~1s no CI,
ruído no caminho de cada commit") e de escopo ("não muda por commit de código"), e
as duas foram medidas de novo — o custo é 7× menor, e a cicatriz NASCE num commit
de código (uma reescrita mecânica de scripts). O que faltava era o caminho até o
fixer: quem a introduzia corrigia à mão exatamente a linha que a máquina remenda. A
JANELA da dívida declarada (quando existir) roda no job semanal
`registry-allowlist-review`, com `--review` (o gate vermelho) **e** com o
publicador `scripts/declared-debt-issue.mjs` (o canal acionável) — ao lado das
outras três allowlists. A IDADE da mesma decisão é também um fato do `doctor`
(seção 6/7) — ver "As três condições", abaixo.

**Escopo (declarado, porque gate que varre menos do que parece mente):**

1. `.sh`/`.bash` que **declaram** pipefail — sem pipefail a soma do pipeline é o
   status do grep e o SIGPIPE do produtor não é observado, então não é a classe;
   um `set +o pipefail` (que DESLIGA) também não é acusado;
2. os hooks do `.husky/` (arquivos SEM extensão que o git roda) — são scripts
   como os outros, e um deles (`post-checkout`) já tinha a classe;
3. os corpos `run:` dos workflows das **duas** forjas
   (`scripts/forge-workflows.mjs`), inclusive os passos escritos com a chave na
   própria linha do item (`- run: ...`, 36 no repositório), quando o pipefail
   está ativo: `shell: bash` no passo (o runner gera
   `bash --noprofile --norc -eo pipefail {0}`), um `defaults: run: shell:` que
   **liga** o pipefail, ou o próprio corpo fazendo `set -o pipefail`. O passo
   **sem** pipefail não fica fora: ele reprova pelo mesmo padrão, porque a
   segurança dele dependeria do shell default do **runner** (hoje `bash -e`) —
   uma premissa que não é deste repositório.

**A premissa do shell default é FATO, não suposição.** `defaults: run: shell:`
(no arquivo e no job) é lido, e uma declaração que **liga** o pipefail **FALHA** o
gate — nomeando o escopo e quantos passos ela reclassificou **de uma vez**, porque
ela troca a premissa de todos os passos do escopo numa linha, sem que um passo
sequer mude no diff. O remédio é dizer no passo (`shell: bash`, que é onde a
classe é esperada) ou remover a declaração. A forma **inline**
(`defaults: {run: {shell: bash}}`) sai **INDETERMINADA**: não ler não é o mesmo
que não haver, e presumir "sem pipefail" ali seria a mesma aposta que este guard
existe para acabar. O relatório diz, passo a passo, de **onde** vem o shell: do
passo, do `defaults:` do job, do `defaults:` do arquivo ou do runner.

Duas armadilhas de varredura textual que o guard trata, porque errá-las produz
falso positivo em massa: a linha de continuação (`\` no fim — o `|` mora na linha
seguinte) é juntada antes da análise; e o corpo de **heredoc** é TEXTO, não código
— sem isso o guard acusaria os próprios mutation tests, que escrevem fixtures com
o padrão dentro.

**O ESCOPO da varredura é medido, e o que fica fora sai NOMEADO** — porque o valor
deste guard não é o que ele acusa, é o que ele _não_ acusa. Duas classes de "varre
menos do que parece" fecharam aqui, e as duas eram invisíveis no caminho **verde**
(que é exatamente onde um gate que olha de menos se esconde):

1. **`run:` DECLARADO com corpo VAZIO** — não há sintaxe a julgar, mas o passo
   também não pode sumir da conta: um passo a menos no denominador é um gate que
   varre menos do que diz. Ele entra em `foraDoEscopo` com arquivo, linha, job e
   motivo, e o relatório imprime a lista ("N passo(s) DECLARADO(s) fora do escopo").
   O invariante é a **soma**: `comPipefail + semPipefail + corpoVazio = passos
`run:` declarados` — medido hoje no repositório: **87 + 384 + 0 = 471**;
2. **`- run:` INLINE com continuação** — o YAML dobra `run: cmd` + as linhas mais
   indentadas num escalar ÚNICO (a quebra vira espaço), e ler só a PRIMEIRA linha
   julgava o passo por METADE: o `| grep -q` da segunda ficava invisível. O corpo
   agora é lido até a primeira linha no nível da chave, e a `\` de continuação é
   removida antes do remédio (mantê-la gravaria `<<< "$(docker ps \)"` — um
   conselho que o `--fix` escreveria no arquivo). Medido no repositório: **0
   casos hoje** — e é por isso que a prova abaixo precisa de fixture sintético.

**A prova de cobertura** (`src/lib/__tests__/check-pipefail-sigpipe-cobertura.test.ts`,
13 testes, roda na suíte unit do merge) é **diferencial**: um workflow que mistura
`defaults:` de arquivo e de job, `- uses:`, `- run:` inline, `- run: |` com
continuação, heredoc, corpo vazio e `shell:` DEPOIS do `run:` — e cada passo
DECLARA o que ele é (de onde vem o shell, se liga pipefail, se o corpo tem a
classe). O guard tem de concordar com a declaração passo a passo, nenhuma violação
pode cair numa linha que não seja de um passo `run:` (passo FANTASMA), e a soma
fecha contra a própria fixture em vez de contra um número escrito à mão.

**E a prova morde — medido por mutação do próprio guard** (a seção `H` do
`scripts/test-mutation-pipefail-sigpipe.sh`, matriz do master): tirar a conta do
corpo vazio faz o passo **desaparecer** do relatório (H2), e limitar a leitura do
`run:` inline à primeira linha faz a ocorrência da continuação **desaparecer**
(H3) — nos dois casos o controle correspondente (H1/H3 com o guard intacto) vai a
vermelho, que é o que transforma "a prova passa" em "a prova prende a regressão".
O H1 conta os passos declarados **da própria fixture** (`grep -c '^ *- run:'`): um
literal no teste envelheceria em silêncio no dia em que a fixture mudasse, e a
prova passaria a medir a si mesma.

**A dívida foi DECLARADA e depois APOSENTADA — o gate hoje é ABSOLUTO:** o
padrão já estava no repositório quando o gate nasceu (216 ocorrências em 47
arquivos, 95 delas nos mutation tests). Corrigir tudo de uma vez seria uma
reescrita de ~200 linhas, então a dívida primeiro foi **declarada** —
`docs/quality/pipefail-sigpipe-baseline.json`, com **quantidade por arquivo**
(nunca por linha: uma linha nova acima não pode acusar dívida que não mudou) — e
o guard falhava só no que passasse da cota.

O `--fix` então aposentou o caso mecânico e o baseline foi **REMOVIDO**: não há
mais cota, allowlist nem exceção — **qualquer** ocorrência reprova o PR, em
qualquer arquivo. O mecanismo de baseline continua no código (`--update` ainda
cria um) para o dia em que exista um caso que realmente não possa ser consertado
agora — declarado, justificado por escrito e com revisão vencível.

**As três condições deixaram de ser prosa e viraram mecanismo** (a comporta que
podia reabrir a dívida por digitação agora exige decisão):

1. **DECLARADO** — `--update` com alguma ocorrência a declarar **recusa sem
   `--reason`** (exit 3) e **não grava nada**; a mensagem oferece as duas saídas
   (consertar com `--fix`, ou declarar dizendo o porquê). Quem quer só "deixar o
   gate verde" tem de escolher entre consertar e se explicar;
2. **JUSTIFICADO** — a razão vai para o **arquivo** (`reason`), não para a caixa
   de entrada de quem rodou o comando: uma justificativa que só existe na máquina
   de quem declarou não é decisão registrada. Dívida com `total > 0` e sem
   `reason` é **violação nos dois modos** (fail-closed) — apagar o campo seria o
   jeito silencioso de declarar exceção sem decidir nada;
3. **VENCÍVEL** — a data e a janela vêm do módulo **compartilhado**
   (`allowlist-review.mjs`, 180 dias — a MESMA regra das outras três allowlists,
   e o MESMO parser: `2026-02-30` é recusado, porque `Date.UTC` transborda para
   `2026-03-02` e um guard que aceita a data que o autor não digitou mede outra
   coisa). Passada a janela, o run normal emite **`::warning::`** e o
   `--review` — que roda no job semanal `registry-allowlist-review`, ao lado das
   outras allowlists — faz da decisão vencida **VIOLAÇÃO**. Sem esse degrau, a
   janela seria decorativa: a dívida venceria em silêncio, que é o defeito que
   uma cota sem prazo tem.

**A janela tem DOIS consumidores, e nenhum deles é o operador lembrando:** o
run semanal faz dela um gate vermelho E publica a decisão vencida como **ISSUE
ACIONÁVEL** (`scripts/declared-debt-issue.mjs`, com o ciclo de reconciliação do
`issue-publish.mjs` — ela também **FECHA** quando nenhuma decisão está vencida,
porque publicar sem fechar deixa a dívida mentindo no board). E o **doctor** a
carrega como fato próprio da seção 6/7 (`--no-declared-debt` a pula, e aí o
veredito diz que pulou em vez de omitir): a isenção a **179 dias** aparece na
prontidão, no PR e no cron, em vez de só no run semanal.

**O `--fix` aposenta a dívida em vez de conviver com ela**
(`node scripts/check-pipefail-sigpipe.mjs --fix`). Ele troca
`PRODUTOR | grep -q PADRAO` por `grep -q PADRAO <<< "$(PRODUTOR)"` — a mesma
semântica (o texto do produtor vira a entrada do grep) sem o pipe que dá SIGPIPE
ao produtor — e é conservador de propósito:

- só toca **CÓDIGO**: corpo de heredoc é texto (nos mutation tests ele contém o
  padrão como FIXTURE) — ele nunca reescreve o que o guard não acusa;
- é **fail-closed**: cada reescrita tem de REDUZIR a contagem de ocorrências do
  comando **e** preservar as **expressões do runner** (`${{ ... }}`) na ordem —
  perder, duplicar ou reordenar uma muda o comando sem mudar nada que o bash
  veja. O arquivo não é gravado se qualquer das duas não se cumprir;
- **comprime** a linha de continuação (`\`) numa linha: o `\` existia para o
  pipeline caber, e o remédio tira o pipeline;
- é uso **LOCAL**, como o `--update`: o PR que aposenta dívida revisa o diff.

**O mesmo remédio chega ao PR (o canal é UM só, com dois fixers).**
`--fix --dry-run` imprime o **PATCH exato** que o `--fix` gravaria (as linhas
`--- a/…`, `+++ b/…` e os hunks saem do MESMO `fixAll` da gravação — "uma régua,
dois consumidores"; `dry` decide só se o arquivo é gravado) e ele vai para
**STDOUT limpo**, para `… --fix --dry-run | git apply` aplicar sem arquivo
intermediário. A construção do diff é a **mesma** do outro fixer
(`scripts/unified-patch.mjs`): um cabeçalho por arquivo, o **contexto** de cada
hunk e a fusão de janelas vizinhas. Sem contexto o `git apply` **recusa** o hunk
— e antes disso o patch do comentário aplicava só quando a cicatriz era a ÚLTIMA
linha do arquivo. `scripts/pr-remedy-comment.mjs` publica esse patch como
comentário no PR, e **cada fixer tem o SEU marcador**: um marcador comum faria a
reconciliação de um retirar o comentário do outro, que ainda valia.

**A pipeline invoca o REGISTRO, e não uma lista de fixers** (`--all`, um passo por
pipeline, com o `--backend` da forja). A enumeração à mão tinha o custo exato que a
descoberta das CLASSES do remédio já tinha resolvido do outro lado: um fixer novo
só chegava ao PR se alguém lembrasse de copiar o passo nas DUAS pontas — e o passo
copiado de uma forja para a outra publicaria no canal errado (o PR da Gitea
comentado no espelho, com o token da outra) sem nenhum veredito, porque o canal
não é um gate. Quem mede isso agora é a **quinta regra do `check-forge-parity`**
(o canal não passa por `discoverGates`, então as quatro regras de classificação
não o alcançavam): exatamente UM passo por pipeline, `--all`, a cobertura IGUAL à
do registro (o fixer que ficar de fora sai NOMEADO, lido do DIRETÓRIO das
declarações — nunca de uma lista do guard; a leitura é a folha `remedy-canal.mjs`,
e não o registro montado, pelo ciclo de import com TLA que o cabeçalho daquela
seção descreve) e o `--backend` da própria forja; a régua do comando canônico
(uma régua, e o backend é o único argumento que muda) fecha a paridade. As
mutações **G1–G3** provam as três pontas: o passo removido da forja, a cobertura
estreitada para `--fixer <um>` e o backend da outra forja.

**A prova de que ele morde** (`scripts/test-mutation-pipefail-sigpipe.sh`, matriz
do master): o guard roda contra fixtures, e a evidência é o EXIT CODE dele —
mutação A (`.sh` com pipefail + `echo "$OUT" | grep -Fq`) tem de FALHAR nomeando
arquivo e sugerindo o herestring; mutação B (`shell: bash` + pipe quieto no
workflow) tem de FALHAR; mutação C (duas ocorrências com cota 1 no baseline) tem
de FALHAR só o excedente; a **mutação F** cobre a premissa do shell default
(fixtures com passos **limpos**, para o exit 1 só poder vir da declaração):
`defaults:` no arquivo e no job ligando o pipefail têm de FALHAR nomeando escopo e
contagem, a forma inline tem de sair INDETERMINADA, e o passo `- run: |` com
`shell:` depois do corpo tem de entrar na varredura com o rótulo certo — com o
controle de `defaults: run: shell: bash -e {0}`, que **passa** e diz que a fonte é
a declaração. E os controles provam que ele NÃO acusa o que não é a classe:
herestring, script sem pipefail, heredoc que escreve o padrão, e cota igual à
dívida declarada. Já o passo **sem** `shell:` **reprova** por desenho, e a
ocorrência sai marcada como premissa do **runner** (é esse o controle que mede o
rótulo, não a tolerância).

A **seção R** mede o CANAL — a outra ponta do `--fix`, e a que vai ao PR: **R1**
exige que o patch do preview **APLIQUE** pelo `git apply` (num repo git de
verdade, com a cicatriz no MEIO do arquivo, e que o gate saia **0** no repo
remendado); a mutação correspondente tira o **contexto** do hunk
(`unified-patch.mjs`) e exige que o `git apply` **recuse** — o mutante prova que
é o contexto que torna o remendo aplicável. **R2** exige que o preview **NÃO
grave** (a cicatriz segue no arquivo e o checksum é o mesmo); a mutação troca o
`dry: true` do `remedyPatch` por `dry: false` e exige que a árvore **mude**. **R3**
roda a reconciliação contra um canal dublê com o comentário do `bash -n` (id 11) e
o do SIGPIPE (id 22) no MESMO PR, com a cicatriz do SIGPIPE já resolvida: com
marcadores próprios SÓ o 22 sai; a mutação iguala os marcadores e exige que o
comentário do **outro** gate (id 11) caia junto. As três fontes mutadas
(`check-pipefail-sigpipe.mjs`, `unified-patch.mjs` e `pr-remedy-comment.mjs`) têm
cópia de segurança com `cksum` no `trap`, como o guard e a régua.

A **mutação G** prova a outra metade do `--fix`: o produtor com expressão do
runner (`docker exec ${{ job.services.postgres.id }} psql ... | grep -qx 1`) tem
de sair **inteiro** dentro de `<<< "$(...)"`. O defeito real que ela prende veio
deste próprio trabalho: a extração shell-aware lia `{{`/`}}` como estrutura e
reescrevia `if docker exec ${{ grep -qx 1 <<< "$(job.services.postgres.id }} ...`
— reduzia a contagem, passava no fail-closed e quebrava o workflow no runner. O
conserto é a **máscara** das expressões, e a prova desfaz a máscara com `sed` e
exige que a reescrita **saia corrompida**: se ela não sair, o caso G não estaria
medindo a máscara (o teste tem de morder).

A **mutação E** prova o outro lado — que a dívida não se re-declara em silêncio,
executando o comando real contra fixtures e medindo o EXIT CODE: `--update` sem
`--reason` sai **3** e **não cria arquivo**; com `--reason`, grava razão + data +
a janela **lida do módulo compartilhado** (o teste lê `DEFAULT_REVIEW_DAYS`, não
repete o número); uma decisão declarada há `janela + 30` dias passa no run normal
com **`::warning::`** e **sai 1** no `--review`; dívida sem `reason` e dívida com
`declaredAt` impossível (`2026-02-30`) saem **1**; e `--reason ""` sai **3**.

O `--fix` tem as mesmas provas, pelo mesmo método: ele REESCREVE o caso mecânico
(produtor vivo incluso) e o guard então sai 0; ele **não** toca o corpo de
heredoc (o fixture continua com o padrão, e a contagem cai exatamente do que foi
reescrito); ele **comprime** a continuação; e ele **não grava** quando a
reescrita não reduz (fail-closed).

A **seção H** prova a COBERTURA da varredura — o que ela não julga e o que ela lê
pela metade —, e a evidência é o que o guard DEIXA de dizer. **H1** roda o guard
INTEIRO contra a fixture mista (limpa de propósito: o relatório do escopo só sai
no caminho verde) e exige que o corpo vazio saia nomeado com arquivo e linha, que
a soma feche contra os passos `run:` **contados da própria fixture** (`grep -c
'^ *- run:'`, nunca um literal) e que o `shell:` depois do `run:` seja lido como do
PASSO. **H2** tira a conta do corpo vazio do guard e exige que o nome **suma** do
relatório; **H3** limita a leitura do `run:` inline à primeira linha e exige que a
ocorrência da continuação **suma**. O guard é mutado NO LUGAR (o `--root` é do
fixture; o arquivo mutado é o do repositório), com backup e restauração conferida
por `cksum` no MESMO `trap` — um `exit` no meio do caminho não pode deixar a
mutação na árvore.

---

## 21. O que NÃO é passo — `defaults: run: shell:` (`scripts/forge-workflows.mjs`)

**O que protege:** `defaults:` declara o **shell do escopo** (do arquivo ou do
job) — e declaração não é passo. Uma leitura única (`defaultsBlocks` +
`defaultsRunLines`, em `forge-workflows.mjs`, a mesma casa da lista de
diretórios de workflow) diz a TODOS os guards que leem YAML de workflow quais
linhas são a declaração.

**Por que existe (o defeito não é ruído, é gate falso):** os guards extraem
comandos de `run:` por regex, linha a linha. A forma escalar que o YAML aceita
(`defaults:\n  run: <comando>`) é lida por qualquer um desses scaners como um
COMANDO — e o pior caso não é o passo fantasma (`defaults:\n  run: bash` virava
o comando literal `bash`), é a **forja de gate**:

```yaml
defaults:
  run: node scripts/check-workflow-refs.mjs --pkg-internal
```

fazia `runCommands`/`discoverGates` relatarem um gate que a pipeline **não
executa** (a invariante do CORE satisfeita por uma declaração de shell), o
`extractWorkflowRunRefs` contar cobertura de mutation test que nenhum job roda, o
`extractScriptRefs` validar um script que nunca é chamado, e o **doctor** aceitar
a linha como "o job RODA o comando esperado" — o veredito de prontidão para
bloquear o merge saindo de uma declaração.

**As três formas, e o que o guard faz com cada uma:**

| forma                                        | leitura                                                                             |
| :------------------------------------------- | :---------------------------------------------------------------------------------- |
| `defaults:` / `run:` / `shell: bash` (bloco) | o shell é LIDO (`workflowDefaultShells`, do `check-pipefail-sigpipe`, compõe daqui) |
| `defaults: {run: {shell: bash}}` (em linha)  | `unparsed: true` — não ler **não** é o mesmo que não haver                          |
| `defaults:` / `run: <comando>` (escalar)     | `unparsed: true`, e **nunca** passo: é a forma que fabrica gate                     |

**Quem consulta a leitura:** `check-forge-parity` (`runCommands` e
`discoverGates`, via `executableLines(lines, defaultsRunLines(content))`),
`forge-doctor` (`gateRunLine`, `firstRunLine` e o inventário de `run:` do job que
alimenta o contrato de merge), `check-mutation-jobs` (`extractWorkflowRunRefs`) e
`check-workflow-refs` (os quatro extratores). O `check-pipefail-sigpipe` compõe o
shell default daqui, para a premissa do runner não ter duas implementações.

**Quem NÃO consulta, e por quê:** `check-script-headers` **não lê YAML de
workflow** — ele varre um diretório (`scripts/`) —, então o shell default não tem
como virar passo para ele. Está registrado aqui para o próximo leitor não sair
procurando a fiação que não existe.

**Onde roda:** local (`bash scripts/test-mutation-workflow-defaults.sh`) e na
matriz node-pura do master (`workflow-defaults`, o 23º sub-test).

**A prova de que ele morde** (`scripts/test-mutation-workflow-defaults.sh`): a
árvore de julgamento é GERADA a partir das invariantes do CORE
(`canonicalCommandOf`), de modo que o fixture de controle é **verde de
verdade** — a única diferença entre o verde e o vermelho é a linha proibida e a
mutação. Os **dois controles**: (1) a declaração LEGAL em bloco (arquivo e job)
→ exit 0, senão adotar `defaults: run: shell:` seria impossível; (2) a declaração
escalar no escopo do JOB → nenhum dos seis guards a vê como passo, gate, ref ou
comando, e o comando do PASSO segue visível. As **seis mutações**, cada uma
red pela asserção da própria regra:

| mutação | o que ela degrada                                                                                   | como o guard acusa                                                                                                                                                                                                  |
| :------ | :-------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **A**   | `defaultsRunLines` devolve vazio (a leitura compartilhada para de ler)                              | `--root` sai 1 com `gate 'scripts/check-fantasma.mjs' NAO CLASSIFICADO` nas DUAS pipelines, e o `--gates` nomeia o fantasma                                                                                         |
| **B**   | o guard de paridade deixa de CONSULTAR (o argumento some de `executableLines`, nos DOIS call sites) | o mesmo 1 — leitura certa num módulo não protege guard que não a chama                                                                                                                                              |
| **C**   | o doctor deixa de pular (3 sites: `gateRunLine`, `firstRunLine`, o inventário do job)               | `firstRunLine`/`gateRunLine` passam a devolver a linha da declaração                                                                                                                                                |
| **D1**  | o `check-workflow-refs` volta a ler a declaração (o pulo próprio, nos 4 call sites)                 | a declaração vira ref de script — e o CONTROLE da metade prende que a cobertura de mutation test segue limpa: o `check-mutation-jobs` NÃO tem pulo próprio, a imunidade dele é a régua                              |
| **D2**  | a régua de PASSO deixa de exigir ITEM DE LISTA (`workflowRunBodies`)                                | a declaração vira passo para quem a consome e `extractWorkflowRunRefs` passa a contar a ref fantasma como COBERTURA — com o guard de refs (intacto) seguindo limpo, provando que as duas leituras são independentes |
| **E**   | a leitura só vê o escopo do ARQUIVO                                                                 | a declaração do JOB volta a virar passo → 1 nomeando o fantasma                                                                                                                                                     |

As mutações são IN-PLACE nos módulos REAIS (é o módulo real que os guards
importam; um mutante numa cópia mediria outro guard), com backup + trap, e a
restauração é **provada** por `cksum` arquivo a arquivo.

**Limite declarado:** o fixture exercita as funções que DECIDEM (`firstRunLine`,
`gateRunLine`, os extratores) por execução; o CLI do doctor não é invocado no
mutation test porque ele exige a forja inteira (env, credencial, docker) — o
contrato do doctor com a declaração está travado nos testes unitários
(`forge-doctor.test.ts`) e a paridade do guard é medida pelo CLI real contra o
fixture.

**A COBERTURA dos quatro guards é medida por um invariante só** —
`src/lib/__tests__/workflow-yaml-guards-cobertura.test.ts` (42 testes, roda na
suíte unit do merge), irmão do
`check-pipefail-sigpipe-cobertura.test.ts`. Um gate que leia MENOS do que diz fica
verde pelo mesmo motivo que um gate honesto: nada falhou — e os quatro leem o
mesmo texto com o mesmo ponto cego. O invariante é um só, e é uma SOMA:

```
julgados + fora do escopo (NOMEADOS) = declarados
```

O lado direito é o que o arquivo DECLARA; o esquerdo tem de fechar. Quando uma
forma nova de escrever um passo/job/ref não entra em nenhum dos dois, ela não
aparece como violação — ela **SOME**, e o denominador encolhe em silêncio. Cada
guard tem a sua versão da conta, e cada uma é medida contra a PRÓPRIA fixture
(nunca contra um número escrito à mão, que envelheceria calado):

| guard                    | a soma                                                                                           | o que ela prende                                                                                                     |
| :----------------------- | :----------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------- |
| `check-forge-parity`     | classificados + NÃO classificados = gates descobertos, e descoberta = declaração                 | o gate que a descoberta não acha nunca precisa de classificação — então um gate novo pula a forja sem que nada falhe |
| `check-mutation-jobs`    | cobertos + órfãos NOMEADOS = scripts declarados (partição fechada; a cobertura transitiva conta) | o script que existe e não é referenciado por nada tem de sair nomeado, em vez de sumir do denominador                |
| `check-workflow-refs`    | extraídas = declaradas, e resolvidas + quebradas = extraídas                                     | a ref que não é julgada nem reportada — e, pior, a ref FABRICADA a partir de uma linha que não executa               |
| `check-pipefail-sigpipe` | julgados + corpo vazio = passos `run:` declarados                                                | o passo que sai da conta em vez de sair nomeado                                                                      |

Além da soma, dois invariantes de ATRIBUIÇÃO em cada guard, porque apontar para
o lugar errado é pior que calar: **nenhuma violação pode cair numa linha que não
seja de um elemento declarado** (o elemento FANTASMA do lado do diagnóstico), e
todo nome citado numa violação tem de existir no fixture ou na lista declarada do
repositório (nenhum id inventado pela régua).

O que fica FORA do escopo é medido como DECISÃO, não como esquecimento: a
fixture declara cada linha fora (a declaração `defaults.run`, o comentário solto,
o comentário bash dentro do bloco, a linha só com `${{ }}`) e o teste cobra que
ela **não produza elemento nenhum** — e, quando a leitura compartilhada existe
(`defaultsRunLines`), que a linha seja VISTA como declaração. O último bloco do
arquivo fecha o ciclo: o MESMO `defaults: run: <comando>` é submetido aos quatro
guards e nenhum deles o lê como passo — a prova de que a leitura é uma só.

Duas correções nasceram desta prova (o fixture sintético é onde a classe
aparece):

1. **`check-workflow-refs` validava ref de COMENTÁRIO DE FIM DE LINHA.**
   `- run: # node scripts/comentario.mjs` é um passo que não executa nada, e a
   ref extraída dali era validada (ou acusada) como se a pipeline a rodasse — o
   guard afirmando conserto sobre código morto. O `scannableLine` passou a
   remover o comentário de fim de linha, a MESMA leitura do `executableLines` do
   `check-forge-parity` (que já a fazia): uma régua só para "o que EXECUTA".
2. **o fixture só vale se ele misturar as formas** — cada bloco começa
   afirmando que a mistura existe (os três desfechos de classificação, as duas
   origens de ref, as duas classes que não podem contar); sem isso a prova
   passaria medindo a si mesma.

### A OUTRA PORTA: o arquivo que o guard **não consegue** julgar

A soma acima prova o que cada gate VÊ. Ela não diz nada sobre o arquivo que ele
**não viu** — e é aí que a mesma conta se perde, porque a soma fecha em cima de um
escopo que o guard leu: o que ficou ilegível não entra nem num lado nem no outro,
entra como **verde**. Duas classes, uma saída errada só:

| classe            | o que é                                                        | o que os guards faziam antes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| :---------------- | :------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ILEGÍVEL**      | o arquivo existe e não abre (permissão), ou não é UTF-8 válido | o `readFileSync(..., "utf8")` **não falha** com byte inválido: ele troca por U+FFFD e entrega ao guard um texto que ninguém escreveu. Medido: `check-workflow-refs`, `check-mutation-jobs`, `check-pipefail-sigpipe`, `check-no-setup-bun`, `check-sentinel-producer`, `check-seed-hooks`, `check-registry-source`, `check-bun-mirror` e `check-hook-ci-parity` já saíam 2 NOMEANDO — a leitura fail-closed (`readJudgedFile`) já existia. Os dois que liam o workflow por conta própria, **não**: `check-forge-parity` (mojibake silencioso) e `check-workflow-run-syntax` (idem) |
| **YAML INVÁLIDO** | o texto abre inteiro, mas não faz parsing em YAML              | **nenhum** guard perguntava. Como a leitura é LINHA a LINHA (o §22), as linhas de um arquivo que não é workflow eram julgadas como passos — medido: os NOVE guards que varrem workflow por `cwd` saíam **0** com um YAML quebrado no escopo, e a paridade julgava a pipeline declarada como se tivesse um contrato                                                                                                                                                                                                                                                                 |

**Onde a recusa mora:** numa porta só — `workflowYamlValidity` (em
`forge-workflows.mjs`, validando com o `js-yaml` — que os testes já usavam como
dep transitiva e que esta porta tornou **declarado** no `package.json`, para o
parser não depender de quem o instala por tabela) chamada
pelo `readWorkflowScan`, de modo que os guardas que consomem a varredura
compartilhada herdam a recusa sem código novo. O desfecho é um OBJETO
(`{ok:false, motivo}`), nunca um booleano: o motivo viaja até o relatório, com a
linha do erro quando o parser a dá. O parser indisponível também é `ok:false` —
"não pude provar que o YAML é válido" não é "o YAML é válido" —, e o guard prefere
o vermelho explicado ao verde presumido. Os dois guards com leitor próprio passaram
a usar a **mesma** porta (`check-forge-parity` na sua sonda do escopo declarado,
`check-workflow-run-syntax` no corpo e no `--fix`), e o
`check-sentinel-producer` — que também varre por conta própria — idem.

**O que muda no veredito:** o arquivo ilegível ou sem parsing deixa de ser "0
violações" e passa a **NÃO JULGÁVEL — exit 2**, com o arquivo NOMEADO. Na
paridade, os três desfechos de um arquivo declarado ficam distintos: **ausente** é
violação do contrato (exit 1, "pipeline declarada nao existe"), **ilegível/YAML
inválido** é ausência de veredito (exit 2). No repositório real: **0 mudanças** —
os 33 workflows das duas forjas fazem parsing (medido), então a porta fecha sobre
um escopo que já era legível.

**Como a prova mede isso:** por EXECUÇÃO do guard real (processo + exit code)
sobre fixtures **diferenciais** — o mesmo guard no fixture LIMPO e no SUJO, que só
diferem pelo arquivo ruim. Onde o limpo é verde, o sujo tem de **deixar de ser**;
quando o fixture mínimo não basta para o guard (ele sai não-zero por outro motivo),
o fato medido é a **CITAÇÃO** do arquivo — que é o ponto: o guard NOMEOU o que não
julgou. O fixture limpo também é o CONTROLE do diferencial: se ele citasse o
arquivo ruim, a citação do sujo não provaria nada. Somam-se as provas por mutação
da porta (medidas: remover a validade do leitor compartilhado deixa **9 testes**
vermelhos, um por guard; devolver o `readFileSync(..., "utf8")` ao
`check-workflow-run-syntax` e a leitura crua à paridade deixa **2**).

---

## 22. A régua única de leitura de YAML — linha, passo, declaração (`scripts/forge-workflows.mjs`)

**O que protege:** a pergunta _"esta linha de workflow EXECUTA algo?"_ tem **uma**
resposta no repositório. Comentário (de linha e de fim de linha), expressão do
runner (`${{ ... }}`), item de lista, corpo de bloco (`|` e `>`), `shell:` do
passo e declaração de `defaults:` — cada um desses constructos é lido **num
lugar só**, e cada guard diz qual SINTAXE varre em vez de reimplementar a regra.

**O que existia antes (medido, não hipotético):** QUATRO funções diferentes para
ler um passo e CINCO cópias da regra de comentário, e as cópias já divergiam
entre si:

| guard                            | o que considerava comentário                                                                                                                                                                            |
| :------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `check-crlf-scope`               | `#`, `//`, `*`                                                                                                                                                                                          |
| `check-utf8-scope`               | `#`, `//`, `*`                                                                                                                                                                                          |
| `check-forge-workflow-scope`     | `//`, `/*`, `*`, `#`                                                                                                                                                                                    |
| `check-registry-source`          | só `#`                                                                                                                                                                                                  |
| `check-registry-source` (inline) | `stripTrailingComment` — o MESMO regex do `parity`                                                                                                                                                      |
| `check-pipefail-sigpipe`         | `workflowRunSteps` (leitura de passo própria)                                                                                                                                                           |
| `check-mutation-jobs`            | `RUN_SINGLE_RE`/`RUN_BLOCK_RE` (só `run: \|`, sem `>`)                                                                                                                                                  |
| `check-forge-parity`             | `executableLines` + `runCommands` (pula o corpo)                                                                                                                                                        |
| `check-workflow-run-syntax`      | reusa o `workflowRunSteps`, mas com a sua máscara                                                                                                                                                       |
| `check-bun-mirror`               | `trim().startsWith("#")` — em CINCO scanners de linha de workflow, e um deles com o alinhamento escrito no código (_"mesmo tratamento do check-no-setup-bun.mjs"_), que é o que o próximo ajuste quebra |
| `check-no-setup-bun`             | `trim().startsWith("#")`                                                                                                                                                                                |
| `check-mutation-jobs` (corpo)    | segunda regra de comentário dentro do `collect` — morta pelo `executableLine` do chamador, mas capaz de voltar a divergir                                                                               |

**O que a régua é, agora:**

| função (em `forge-workflows.mjs`)                    | responde                                                                     |
| :--------------------------------------------------- | :--------------------------------------------------------------------------- |
| `stripTrailingComment(line)`                         | onde termina o código na linha (`#` precedido de espaço)                     |
| `codeLine(line)`                                     | o CÓDIGO da linha, com a EXPRESSÃO preservada (a porta de quem quer o valor) |
| `executableLine(line)` / `executableLines(lines, ?)` | a linha como o runner a executaria (comentário fora, expressão fora)         |
| `isCommentLine(line, {slash})`                       | é comentário? — a SINTAXE é declarada no call site (`//`, `/*`, `*`)         |
| `DYNAMIC_EXPR_RE`                                    | o padrão da expressão do runner (remover, mascarar, desmascarar)             |
| `workflowRunBodies(content)`                         | os passos com `run:`: item, coluna, bloco (`\|`/`>`), `shell:`, fim          |
| `defaultsBlocks` / `defaultsRunLines`                | §21 — o que é DECLARAÇÃO e não pode ser passo                                |

**O que muda no veredito** (cada linha foi medida antes e depois, contra o
repositório real e contra fixture próprio):

| mudança                                                                  | veredito                                                                                                                                                                                                                                                                                                                                                                                        |
| :----------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| a régua de COMANDO passa a ver o corpo do `run: \|`                      | um gate invocado **só** dentro de um bloco deixa de ser invisível. Medido: **11 arquivos** tinham gate com rótulo (`discoverGates`) SEM comando correspondente (`runCommands`) — o mesmo YAML com dois vereditos no mesmo guard. O `check-forge-parity` segue verde no repositório (nenhuma invariante do CORE vivia só em bloco), e a fixture do teste prova o caso que passaria a ser acusado |
| a régua de LINHA mascara `${{ ... }}`                                    | um alvo lido de dentro da expressão do runner deixa de ser afirmação do repositório — e uma linha que só tem expressão deixa de executar. No repositório: **0 mudanças de veredito** (medido)                                                                                                                                                                                                   |
| `stripTrailingComment` mantém o `trimEnd` das duas implementações        | nenhuma — é o que preserva o texto que o `check-registry-source` já comparava                                                                                                                                                                                                                                                                                                                   |
| a régua de PASSO passa a conhecer o bloco DOBRADO (`run: >`)             | a cobertura de mutation test passa a contar o alvo dentro de um `>` (antes: invisível). No repositório: **0 casos** — é hardening com fixture                                                                                                                                                                                                                                                   |
| `check-sentinel-producer` passa a ignorar comentário de FIM DE LINHA     | um `run: echo ok # grep -Fq 'x' arquivo` deixa de ser **demanda** de sentinel (era violação falsa: o guard cobrava do producer um sentinel que ninguém pede). No repositório: **0 casos** — as ocorrências reais são linha de comentário inteira, que já era pulada                                                                                                                             |
| `check-hook-ci-parity` compara os comandos **executados**                | a comparação hook ↔ CI passa a enxergar os comandos que vivem em bloco (o lado do CI só GANHA comandos → menos falso "não roda"). No repositório: verde antes e depois                                                                                                                                                                                                                          |
| as quatro `isCommentLine` viram uma, com a sintaxe declarada             | três respostas para a mesma pergunta viram uma; `/*` passa a ser comentário também em `check-crlf-scope`/`check-utf8-scope` (declarado, e sem nenhuma linha desses arquivos com `/*`)                                                                                                                                                                                                           |
| `checkLiteralBunLine` lê o CÓDIGO da linha (`codeLine`)                  | a prosa de um `#` no fim deixa de valer como DECLARAÇÃO: `bun-version: ${{ vars.BUN_VERSION }} # legado: 1.3.14` deixa de ser violação de literal (era a regra local só olhando o INÍCIO da linha). O literal no código da mesma linha continua violação — a régua tira a prosa, não a linha. No repositório: **0 casos** (medido)                                                              |
| `check-no-setup-bun` lê o código da linha, sem mascaramento              | um `#` de fim de linha com a key `uses:` deixa de fabricar violação (`run: echo ok # uses: oven-sh/setup-bun@v2` era acusado como uso REAL). O mascaramento do `executableLine` **não** entra aqui de propósito: a expressão fica inteira porque o guard quer vê-la                                                                                                                             |
| o bloco de `actions/cache` lê `path:`/`restore-keys:` pelo código        | um `# nota` no fim de um path entrava INTEIRO na comparação de toolchain e o guard acusava um path que a pipeline não declara. No repositório: **0 casos** (medido) — é hardening com fixture                                                                                                                                                                                                   |
| `findBunLiteralDefaultInScript` / `checkReRegisterPath` (`.sh`)          | o `1.3.14` de um `# exemplo` no fim de uma linha de shell deixa de valer como default do script (em shell, `#` precedido de espaço é comentário). No repositório: **0 casos** (medido)                                                                                                                                                                                                          |
| o `collect` do `check-mutation-jobs` perde a segunda regra de comentário | a invocação real DENTRO da prosa (`echo ok # bash scripts/test-mutation-x.sh`) já não conta como cobertura (o chamador entrega o corpo pelo `executableLine`) — era o caso em que um script de mutation test parecia coberto por uma linha que a pipeline nunca roda                                                                                                                            |
| `isCommentOrDocLine` do `check-bun-mirror` vira a régua declarada        | `isCommentLine(…, { slash: true })` — a quinta cópia da função, cuja diferença com as outras era ACIDENTAL (uma sem `//`, outra sem `#`)                                                                                                                                                                                                                                                        |
| Dockerfile fica FORA do corte de fim de linha                            | declarado: em Dockerfile o `#` só é comentário no INÍCIO da linha, então `RUN echo bun-1.2 # nota` é comando inteiro e tratá-lo como prosa cegaria o guard                                                                                                                                                                                                                                      |

**Onde roda:** é módulo puro — não tem CLI nem job próprio. Ele decide o
veredito de quem o consome, e é por isso que a prova é sobre os CONSUMIDORES.

**Como testar:** `src/lib/__tests__/forge-workflows-ruler.test.ts` (19 testes) —
um fixture com TODOS os constructos, o veredito de cada guard conferido contra
ele, e três invariantes estruturais que fazem a unificação não poder voltar:

1. cada guard importa a régua (o teste falha quando o import volta a ser cópia);
2. o regex do comentário de fim de linha existe em **um** arquivo;
3. o padrão da expressão dinâmica existe em **um** arquivo.

As três invariantes varrem `scripts/*.mjs` inteiro — nenhuma lista à mão —, de
modo que um guard NOVO que nasça com a cópia do regex derruba o teste sem que
ninguém precise registrá-lo aqui.

**Limite declarado:** a régua decide o que EXECUTA, não o que o shell faz com o
comando (o `logicalCommands` do `check-pipefail-sigpipe` segue dono de heredoc e
continuação dentro de um corpo), e a leitura continua sendo **linha a linha** por
regex: um passo montado por lógica de matriz (`${{ matrix.cmd }}` resolvendo o
comando) é expressão do runner, e por desenho não é prova de execução.

A régua também NÃO é um parser de YAML: a validade do arquivo é uma PORTA DO
ESCOPO (`workflowYamlValidity`, aplicada no `readWorkflowScan` e nos dois guards
com leitor próprio), não uma segunda leitura dos passos. Um arquivo que não faz
parsing sai NOMEADO como não-julgável — ele nunca chega a ser lido linha a linha,
que é o defeito que essa porta fecha (ver "A OUTRA PORTA", §21).

---

## 23. O teardown do Gitea efêmero é VEREDITO — `helpers/gitea-ephemeral.ts`

Os suites de integração do Gitea real (issue de drift, actrc, doctor,
env-mirror-drift) sobem um container por arquivo e o removem em `afterAll`. O que
existia: `docker rm -f` e, quando ele falhava, **uma linha no stderr** — o
container ficava de pé e o arquivo terminava **VERDE**. MEDIDO neste host: 669
containers `gitea-ephemeral-*` Up de uma vez (~33GB, swap esgotado), e a suíte
inteira passou a morrer por OOM com o vermelho LONGE da causa (`Worker exited
unexpectedly`, sem nenhum teste reprovado). O `rm` que falha em silêncio era o
defeito; a linha de aviso já existia e não bastava.

**Três desfechos, nenhum em silêncio:**

| desfecho            | quando                                                                                             | veredito                                                                                                                                                                                                                    |
| :------------------ | :------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rm`                | o `docker rm -f` funciona (ou o container já não existe)                                           | removido (caminho normal)                                                                                                                                                                                                   |
| `parada-por-dentro` | o daemon NÃO consegue matar, mas o PID 1 do container TRATA SIGTERM (o `s6-svscan` do gitea trata) | removido: `docker exec <c> sh -c 'kill -TERM 1'`, o container sai 0 sozinho, e um container PARADO é removido sem `-f`                                                                                                      |
| `nao-removido`      | nem um nem outro                                                                                   | **FALHA**: o `cleanup()` LANÇA (o arquivo reprova), o sweep deixa o código de saída da execução em `1` (`131` se o processo foi abortado por sinal) e o relatório nomeia container, motivo do daemon e a RECEITA de limpeza |

**Por que o daemon nega (medido, não suposto):** neste host `docker rm -f`,
`docker kill` e `docker stop` falham com `could not kill container: permission
denied` para QUALQUER container — inclusive um recém-criado pelo próprio daemon.
Duas consequências medidas: toda tentativa de kill gasta o timeout de stop do
daemon (10,02s cronometrados por chamada) e, por isso, o `rm -f` tem orçamento de
3s — o teardown dos quatro arquivos de integração roda em `afterAll`, que passou
a ter **60s** de orçamento próprio: com o padrão do vitest (10s) o hook morreria
por TIMEOUT antes de o caminho por dentro rodar, deixando o container vivo e o
vermelho apontando para o lugar errado (a mesma classe de falha que este bloco
existe para eliminar).

**O veredito não é "não" na primeira negativa:** a remoção pode estar EM CURSO
(o `rm -f` do daemon continua do lado dele depois do abort, e o `rm` seguinte
responde "removal in progress"), então há uma **checagem final** que espera o
container sumir antes de reprovar — reprovar na primeira resposta negativa daria
um vermelho FALSO sobre um container que sai sozinho um instante depois, e
vermelho falso ensina a ignorar vermelho.

**Provas:** `src/lib/__tests__/gitea-ephemeral-teardown-falha.test.ts` (8 testes)
executa o caminho REAL com um docker dublê roteirizado (daemon que nega o kill;
container que para por dentro × container que não para) e mede: a ORDEM das
chamadas, o motivo LITERAL do daemon, o `cleanup()` que LANÇA, o CONTROLE (com a
remoção funcionando, nada é reportado nem se tenta uma segunda porta) e o CÓDIGO
DE SAÍDA de um processo de verdade
(`helpers/gitea-ephemeral-teardown-child.ts`). O bloco do docker real mede a
premissa do host pelo PRÓPRIO veredito (`caminho`): onde ele é
`parada-por-dentro`, o sucesso só é explicável por esse caminho — sem sonda extra
e sem +10s de timeout do daemon.

**A mutação é da própria prova:** silenciar o retorno de falha numa CÓPIA do
helper faz o processo voltar a sair `0` com o container vivo — a metade do código
de saída deixa de morder, que é exatamente o defeito original. O alvo da mutação
é asserido ANTES de aplicar (alvo que sumiu = prova que passaria medindo o código
original). E, no sentido oposto, qualquer regressão de verdade no veredito
reprova o arquivo: o `it` do helper real exige código `1`, `reprovou: true` e o
relatório nomeando o container no stderr.

**Onde roda:** `test:run` nas duas forjas (é teste de unidade; os blocos que
exigem docker se declaram sem docker, no padrão dos outros testes Gitea). O teste
de SINAL (`gitea-ephemeral-signal.test.ts`) passou a medir a capacidade do host
pela MESMA porta (`removerContainer`) e aceita 130 (sweep limpo) ou 131 (sweep
com falha, que exige o relatório nomeado) — antes ele dava a remoção deste host
como "INDETERMINADA" porque a media com um `rm -f` cru.

---

## 24. Os comandos que os hooks executam têm de RESOLVER — `check-hook-commands` (`scripts/check-hook-commands.mjs`)

**O que protege:** todo comando de `.husky/` aponta para algo que EXISTE — o
script de um `node`/`bash`, a entrada de `bun run` (e o que ela executa), o
binário de `bun x`, o arquivo de um `source`, a função do próprio hook — **e o
mesmo vale para dentro dos scripts de SHELL que o hook chama** (a descida: ver
abaixo).

**Por que existe (a classe):** o hook é o único lugar do repositório onde um
comando aponta para um arquivo do PRÓPRIO repositório e nada o confere. Um
caminho errado ali não é "um script que não roda": é um **PASSO que nunca roda**
— e o sintoma nunca diz o nome dele. Quatro casos concretos:

1. `node scripts/check-bun-mirrorX.mjs --staged` (typo): o guard do índice deixa
   de existir e o commit passa achando que foi verificado;
2. um script do `package.json` apontando para um arquivo RENOMEADO
   (`"fuzz": "bash scripts/run-fuzz.sh"` com o `.sh` movido): o hook chama
   `bun run fuzz` e executa um caminho que não existe mais;
3. uma função do hook chamada e não definida (`wait_all` com o corpo removido
   num refactor): a fase vira um "command not found" que o `set -e` só reporta
   depois de metade dela ter rodado;
4. `source scripts/x.sh` de um arquivo que sumiu: as definições que ele traz não
   existem, e cada uso falha em outro lugar, longe da causa.

**O que mede (e a régua):** a extração é a de **tokens de shell** compartilhada
(`shellTokens`, a mesma do gate de sintaxe — comentário, heredoc, quote
multi-linha e operador resolvidos) mais a segmentação nos operadores de lista, o
redirecionamento descartado (`2>/dev/null` não é um comando chamado `2`) e o
`$( ... )` julgado como comando próprio (ele EXECUTA: `X=$(node scripts/typo.mjs)`
não escapa por estar à direita de um `=`). Cada comando resolvido sai com a
PROVENIÊNCIA (`script do node`, `entrada \`fuzz\` do package.json`, `binário de
dependência (prettier)`, `função do próprio hook`, `ferramenta externa
declarada`), e uma violação nomeia arquivo, linha e o **vizinho mais próximo**
(`o mais próximo é \`check-bun-mirror.mjs\``) — o erro de digitação se corrige
sozinho com a mensagem.

**A DESCIDA: o que os scripts CHAMADOS executam por dentro.** O hook real não
lista os 17 guards de encoding — ele chama UM runner
(`bash scripts/run-encoding-guards.sh`) que chama os outros. Parar no ALVO do
`bash` era a mesma cegueira um nível abaixo: uma linha tipada DENTRO do runner
(`bash scripts/check-utf8-sh`, ou um `check-utf8-scope.mjs` renomeado) é o passo
que nunca roda, invisível, num arquivo que roda em **todo** commit. O guard desce
por `bash`/`sh`/`dash`/`zsh` e por `source`/`.` (transitivo, cada script julgado
UMA vez, com a proveniência de quem o chamou: `origem` =
`.husky/pre-commit:98`), e o que ele não desce é uma superfície DECLARADA: um
`node scripts/x.mjs` tem o caminho conferido e o que ele roda por dentro fica para
os guards que leem o grafo de imports — descer só no que um interpretador de
SHELL lê é uma régua, não uma lista de arquivos escolhidos a mão.

**O ALVO de um lançador é o primeiro token que não é FLAG.** Enquanto o alvo era
`tokens[0]`, um flag à frente do arquivo **virava** o alvo: `bash -n "$TMP/x.sh"`
era lido como “o alvo é `-n`”, e o limite da descida saía com a afirmação FALSA de
que o alvo “não é um arquivo do repositório” — o arquivo estava ali, atrás do flag.
A classe do flag (`alvoDoLancador`) é uma só para o veredito do comando e para a
descida, e são quatro as direções, todas medidas:

| comando                 | o que a classe decide                                                                     |
| :---------------------- | :---------------------------------------------------------------------------------------- |
| `bash -u x.sh`          | `-u` não consome o alvo: o shell EXECUTA `x.sh` (desce)                                   |
| `bash -n x.sh`          | `-n` só CONFERE a sintaxe: não desce, e o motivo DIZ isso                                 |
| `bash -c 'texto'`       | payload inline: o script vive no argumento (INDETERMINADO declarado, como o `python3 -c`) |
| `bash -o pipefail x.sh` | o flag pode CONSUMIR o token seguinte: não é adivinhado, sai nomeado                      |

De quebra, o `-e` saiu da lista do payload inline: ele é o `errexit` com o arquivo
EXECUTADO (`bash -e x.sh`), e o veredito dizia “payload inline (bash -e)” de um
comando cujo alvo é um arquivo do repositório. A lista dos flags com payload é
derivada da classe (não escrita à mão) — a mesma que o `check-hook-ci-parity` usa
na descida das pipelines.

**A classe é POR INTERPRETADOR** — o MESMO flag não significa a mesma coisa em
dois deles: `-e` no `bash` é o `errexit` (com o arquivo EXECUTADO) e no `node` é o
eval do payload; `-p` é `privileged` no bash e `print` no node. São cinco classes
(`classeDoFlag`): **EXECUTA** (o arquivo seguinte roda), **CONFERE** (só a sintaxe:
`bash -n`, `node --check`), **SEM_ARQUIVO** (o payload vem do argumento/stdin:
`bash -c`, `node -e`, `python3 -c`, `node -`), **SEM_ALVO** (`--version`/`--help`:
o programa não lê arquivo nenhum — e o motivo DIZ isso, em vez de “pode consumir o
token seguinte”, que seria falso) e **DESCONHECIDA** (pode consumir o token
seguinte: o alvo não é provado por leitura). Além das listas, duas regras de FORMA
provam o alvo sem enumerar as flags de cada interpretador: `--flag=valor` (o valor
vem no MESMO token) e `--no-algo` (negação de booleano) **não consomem** o token
seguinte — é o que faz `node --no-warnings x.mjs` ser julgado em vez de sair
“sem arquivo de script” (que, sem declaração em `INDETERMINATE`, era VIOLAÇÃO de
um comando provável).

Quem consome esta régua são DOIS guards: este (o veredito do comando e a descida)
e o `check-job-deps` (as dependências do passo do workflow), que até 09/2026
lia `tokens[0].startsWith("-")` e chamava de “payload inline” todo comando com um
flag na frente do programa — o `node --version` (sem arquivo nenhum) e o
`bash -u x.sh` (cujo alvo É o arquivo) no mesmo rótulo.

**E a descida segue o alvo que a RESOLUÇÃO acabou de PROVAR.** `bash
"$SCRIPT_DIR/x.sh"` saía `resolvido` (o caminho foi provado por leitura!) e o
interior do `x.sh` não era julgado por ninguém — a metade mais útil deste guard
desligada justamente onde o caminho é mais indireto. Agora os DOIS alvos caem no
mesmo lugar: o LITERAL e os valores que as atribuições do próprio arquivo provam
(TODOS — o conjunto vale aqui como vale para o alvo do interpretador, cada script
julgado uma vez, com ciclo e teto nomeados). O que NÃO desce é dito pelo veredito
do comando, nunca por um silêncio: um valor absoluto ou um glob não é arquivo do
repositório, e um programa que não é shell (um `node "$ALVO"`) não entra na
descida — a régua é a do interpretador de SHELL. E o motivo NOMEIA a CLASSE
(`absoluto`, `padrao`) em vez do genérico “não é um arquivo do repositório”: um
glob não é um arquivo que falta, é um CONJUNTO que só o runtime expande.

O que muda no veredito, medido: o veredito do comando que CHAMA continua o mesmo
(ele já era `resolvido` — a descida não reescreve a resolução), e o que muda é o
INTERIOR entrar na conta — um defeito dentro do script provado vira violação
atribuída ao **arquivo e à linha do script**, com a `origem` apontando para a
linha do chamador. `bash "$ALVO"` com dois valores prováveis desce nos dois
(2 scripts, cada um uma vez). No repositório REAL o número não se move: **5
scripts** descem (e nenhum deles era um alvo provado — a classe é latente aqui);
em fixture, cada valor provado acrescenta o seu script ao julgamento.

Três propriedades da descida que são régua, não detalhe de implementação: (1) as
**funções visíveis** dependem da FORMA da chamada — `bash script.sh` cria um
processo NOVO (o script vê só as funções que ele mesmo define) e `source` roda no
MESMO shell (herda as do chamador), porque herdar sempre deixaria um
`command not found` passar como resolvido; (2) um `case` é parsing de argumento em
TODO script da casa, e os PADRÕES (`--ci)`, `-h|--help)`) não são comandos — o
CORPO dos ramos é julgado normalmente; (3) a cadeia tem teto
(`MAX_SCRIPT_DEPTH = 4`) e guarda de ciclo, e quando um dos dois morde o limite é
**NOMEADO** no relatório (`limites`, impresso na saída normal e no `--json`) —
nunca um "não fui olhar" que se lê como "não havia o que julgar".

**O que NÃO promete (escopo declarado):** julga o COMANDO, não os argumentos de
ferramentas externas — um `find .next/static/chunks` cita um caminho que não
existe por DESENHO (artefato de build, gitignored), e julgar argumentos exigiria
uma allowlist de caminhos-que-não-existem (um guard que reclama de `.next/` é
desligado pela equipe). Dos argumentos só o que INVOCA algo é julgado. O que ele
não prova por LEITURA — o payload de runtime (`node -e`, `python3 -c`) e o valor
de variável que o próprio arquivo não deixa estático — sai `indeterminado` e exige
a decisão datada: o que ele não prova, ele NOMEIA.

**O REMENDO (`--fix`): a mensagem já diz o vizinho; o remendo fecha a distância.**
O guard responde "o mais próximo é `check-bun-mirror.mjs`"; o `--fix` TROCA o token
por ele, mostra o antes/depois e **PERGUNTA** antes de gravar. A régua dele é mais
ESTRITA que a da mensagem, e isso é decisão, não descuido: a mensagem SUGERE com
teto de distância 4 (um aviso errado custa uma leitura) e o remendo GRAVA — um
remendo errado num hook muda o que roda em **todo** commit. Ele só grava com:

- distância de até **2** caracteres (`FIX_MAX_DISTANCE`);
- **UM** candidato nessa distância — empate é **RECUSA** (dois nomes plausíveis =
  o remendo estaria sorteando; quem escolhe é o operador), e a recusa cita os dois
  com o prefixo do diretório, para ser copiável;
- o candidato sendo **ARQUIVO** (um diretório não é alvo de `node`/`source`);
- o token **localizado sem ambiguidade** na linha (uma ocorrência, delimitada por
  caracteres que não são de caminho — `check-x.mjs.bak` não é `check-x.mjs`),
  varrendo a linha LÓGICA (a do comando mais as continuações `\`);
- o token sendo **DESTE hook**: o alvo de um comando INTERNO (o que uma entrada de
  `bun run` executa) tem a linha do TEXTO do script do `package.json`, e a linha do
  relatório é a do hook — sem esse escopo o remendo procuraria o token no hook pela
  linha do OUTRO arquivo, e no caso-limite (o mesmo texto na mesma linha, dentro de
  um comentário) reescreveria o comentário por causa de um defeito que vive no
  `package.json`.

O que ele **NÃO** remenda sai NOMEADO no plano, com o motivo: a entrada de
`bun run` que não existe (trocar uma entrada por outra MUDA o que o hook executa —
`bun run <binário>` e `bun run <script>` não são a mesma coisa), a função chamada e
não definida, o binário sem fornecedor e o payload de runtime não declarado. E a
escrita é **cirúrgica**: só o token troca, no lugar dele — o hook é um arquivo de
comentários que explicam decisões, e uma reescrita que passasse por um formatador
destruiria justamente o que não se reconstrói. As trocas de um arquivo são
aplicadas do FIM para o COMEÇO (os offsets valem no texto original) e são
**all-or-nothing por arquivo**: se uma não localiza mais, nenhuma outra dele é
gravada (meia correção deixa o arquivo num estado que ninguém autorizou).

A confirmação é a MESMA pergunta do remédio do pre-commit
(`scripts/confirm-prompt.mjs`, um dono só para as duas: o guard não pode importar o
remédio — o grafo dele é o do hook inteiro —, e duas cópias da régua divergiriam
num lugar onde o desfecho é um hook esperando resposta que ninguém sabe que foi
pedida). Sem terminal de controle **não há pergunta e nada é gravado** (exit 1,
com o caminho à mão); `--yes` é a confirmação DECLARADA por quem chama; e
`PRE_COMMIT_REMEDY_NO_PROMPT=1` desliga a pergunta (o MESMO desligamento, na mesma
variável). O veredito não é "eu escrevi": depois de gravar, o guard é
**re-analisado e a conta tem de FECHAR** — as violações caem exatamente no número
de trocas aplicadas; cair menos (uma troca que não resolveu) ou mais (uma troca que
revelou outro defeito) sai com o número na tela e sem verde. O `--json` publica o
plano (`remendos`) e o que ele recusa (`remendosRecusados`) — é dele que o remédio
do pre-commit lê os MESMOS alvos, em vez de re-derivar um plano próprio.

**O `.husky/` É O ARQUIVO QUE O HOOK EXECUTA — e o remendo o reescreve.** Medido:
uma casca de 12.957 bytes reescrita no meio da própria execução (`sh -e`, como o
husky usa) sai **127** com um `B39: not found` numa linha POSTERIOR — o
interpretador lê o arquivo por DESLOCAMENTO, e mudar o tamanho desalinha o que ele
ainda vai ler (sem a reescrita, o MESMO arquivo sai 0). Por isso a classe do
remédio carrega `exigeRelancamento`: o remendo vai para a ÁRVORE e para o ÍNDICE, e
o veredito do commit é o de um **`git commit` NOVO** — nunca a continuação desta
execução.

**Runtime é DECISÃO, não silêncio:** o que não se prova por leitura
(`bash -c "$cmd"`, `node -e`, payload de `-c`) tem de estar em `INDETERMINATE` com
`addedAt` + motivo; sem a entrada, é VIOLAÇÃO. As duas listas (`ALLOWLIST` para o
que existe fora do repositório — hoje o `bunx @lhci/cli` do advisory do Lighthouse
— e `INDETERMINATE`, hoje DUAS entradas) usam a data e a JANELA de revisão do
módulo compartilhado (`allowlist-review.mjs`, 180 dias): uma isenção sem revisão
vira violação nomeada em vez de permanente por esquecimento. As duas que sobraram
são a MESMA classe — o probe `python3|python -c "import sys"` dos `check-*.sh` e o
`python3 -c` do advisory do `pre-push` —, e o motivo de serem o PISO da lista é
estrutural: um payload não é um caminho. Julgar o TEXTO dele seria julgar uma
string, e nenhuma leitura o baixa mais.

**As VARIÁVEIS DE CAMINHO são RESOLVIDAS (o alvo provado, não declarado).** Até
agora o guard tinha QUATRO decisões datadas para comando que EXISTE e RODA nos
`check-*.sh` — `python3 "$PYTHON_SCRIPT"`, `node "$SCRIPT_DIR/check_utf8.mjs"` e
`"$PY" "$PY_SCRIPT"` —, e todas diziam a mesma coisa: "o arquivo existe, mas eu não
provei". Ele agora lê as ATRIBUIÇÕES do arquivo julgado e prova: `PYTHON_SCRIPT`
vale `$SCRIPT_DIR/check_utf8.py`, e `$SCRIPT_DIR` é o idioma DECLARADO do
"diretório DESTE arquivo" (`$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)` — o único
`$( )` que ele traduz, porque é um idioma, não uma heurística). As três entradas
saíram da lista e as quatro decisões viraram fato medido em todo commit. Três
regras seguram o veredito:

1. **O valor tem de ser ESTÁTICO por leitura** (literal, referência a outra
   variável resolvível, ou o idioma do diretório do arquivo). Qualquer outra
   substituição de comando é irresolúvel — e o motivo NOMEIA a variável e a LINHA
   da atribuição que falhou.
2. **FAIL-CLOSED:** se UMA atribuição da variável não é provável, a variável
   INTEIRA é irresolúvel (um valor que o guard não leu pode ser o que roda; provar
   o resto seria provar uma parte e chamar de todo).
3. **O conjunto é um CONJUNTO:** `PY` atribuído em três ramos vale os três
   valores, e TODOS têm de resolver — `"$PY" "$PY_SCRIPT"` sai verde porque
   `python3`, `python` e `node` são interpretadores declarados e os dois
   `check_crlf.{py,mjs}` existem. Valor que o guard não conhece, alvo que não
   existe no disco, conjunto ACIMA DO TETO (`MAX_VALORES = 8`) e variável que pode
   ser VAZIA mantêm o comando fora do verde, cada um com o seu motivo — e as duas
   últimas recusas são fail-closed por um motivo **MEDIDO**, não por precaução:
   (i) o teto existe porque provar um conjunto que não foi enumerado é uma leitura
   que não aconteceu (o verde viria do TAMANHO, não do disco); (ii) o VAZIO é o
   caso mais perigoso dos valores prováveis, porque `""` não é caminho nem nome e
   o guard o resolveria por **ACIDENTE**: `binInstalado(root, "")` é o DIRETÓRIO
   `node_modules/.bin` (`join(root, "node_modules", ".bin", "")`), que existe em
   qualquer checkout instalado — sem a recusa, um `bun run "$ENTRADA"` cuja
   entrada pode ser vazia sai **VERDE**. As duas têm mutação própria (M18/M19) e o
   CONTROLE na direção oposta: dentro do teto / sem a atribuição vazia, o MESMO
   comando resolve.
4. **A CLASSE do alvo é UMA SÓ — a mesma do alvo literal.** Um valor provado cai
   em uma de três classes (`classeDoAlvo`, a régua que o alvo literal já usava e
   que a descida já usava como filtro): `repositorio` (caminho relativo — a única
   que se PROVA no disco), `absoluto` (o `/etc/hosts` de uma atribuição —
   **fora do repositório**, resolvido, como o literal) e `padrao` (o
   `scripts/*.sh` de uma atribuição — **padrão, não um caminho**, indeterminado,
   como o literal, com a decisão datada exigida). Julgar o valor provado só pela
   EXISTÊNCIA acusava o são DUAS vezes: o `/etc/hosts` de uma atribuição saía
   "NÃO existe no repositório" (um caminho que nunca prometeu estar lá) e o
   `scripts/*.sh` ganhava até a sugestão de um vizinho (`a.sh`), que é a distância
   entre um glob e um nome. O fail-closed NÃO mudou: um padrão no conjunto impede
   o `resolvido` de uma parte (ele pode ser o ramo que o runtime expande) e um
   caminho do repositório que FALTA reprova antes de qualquer classe. As duas têm
   mutação própria (M26/M27).

**A HERANÇA: o escopo do shell não é o arquivo, e o guard passou a modelá-lo.**
Um script chamado com `bash`/`sh` roda num processo NOVO: ele vê o AMBIENTE (só o
que o pai `export`ou), e não as variáveis do pai. Julgar `$SCRIPT_DIR` dentro dele
sem isso era escolher entre ACUSAR um script que roda e dar VERDE a um valor que
não atravessa — nenhum dos dois. O guard passa o que atravessa, e o motivo diz de
ONDE veio (`pelas atribuições de \`$SCRIPT_DIR\` herdadas de \`.husky/pre-commit\``)
para o operador não procurar a linha no arquivo errado. As três formas contam:
`export VAR=x`na linha, o`export VAR`SOZINHO (o atributo é do NOME, então a
ordem das linhas não importa) e o`source`/`.`— que roda no MESMO shell e por isso
herda TUDO,`export`ado ou não. E o valor herdado não APAGA a atribuição do filho:
a régua é a UNIÃO, porque a atribuição pode estar num ramo que não roda, e herdar
a menos seria inventar um verde.

**O DIRETÓRIO VIAJA CONGELADO — e essa era a metade perigosa de errar.** O idioma
`$(cd $(dirname ${BASH_SOURCE[0]}) && pwd)` vale o diretório de QUEM O ESCREVEU: o
bash exporta o **VALOR**. Resolver o idioma no USO (o que basta quando o valor só
existe no arquivo julgado) estava ERRADO para o valor que atravessa a herança: um
`SCRIPT_DIR` exportado por `scripts/lib.sh` chegava ao filho em `scripts/sub/`
ainda com a **EXPRESSÃO**, e o filho a re-avaliava no diretório DELE — "provando"
`scripts/sub/ok.mjs`, um caminho que o processo novo NUNCA pode ver. Se o
repositório tivesse o arquivo NAQUELE lugar, o guard saía **VERDE** para um alvo
impossível: um falso verde que só aparece quando o arquivo existe no lugar errado
— a pior forma de descobri-lo. O congelamento passou a acontecer no PARSE
(`comDirCongelado`, o único ponto onde o diretório de quem escreveu está na mão) e
a herança resolve o marcador com o diretório de quem EXPORTOU: dois elos da mesma
corrente, cada um com a sua mutação (M20/M21), e as duas medições apontam para o
MESMO verde falso.

E os LIMITES, declarados em vez de implícitos: (a) o escopo é o que ATRAVESSA —
sem `export` a variável do pai não vale no filho (o veredito diz isso, e não
adivinha), e as atribuições do filho valem só nele; (b) a resolução estende a
DESCIDA, mas só no alvo do comando: o que um script chamado EXECUTA é lido com as
variáveis DELE (mais o que herdou), não com as do chamador; e (c) a variável de
CAMINHO não é uma variável de ENTRADA: `bun run "$ENTRADA"` não resolve pela régua
do caminho, e sim pela da entrada (abaixo), e vice-versa.

**A ENTRADA de `bun run` montada em `$VAR` é PROVADA — a última classe que era
"outra régua" deixou de ser uma isenção.** `bun run "$ENTRADA"` saía
`indeterminado` porque a variável não nomeia um CAMINHO, e sim o NOME de um script
de `scripts`. Só que a decisão datada que a cobria não distinguia a entrada que
EXISTE da que foi REMOVIDA no mesmo commit: as duas achavam a MESMA linha de
`INDETERMINATE`, e o passo-que-nunca-roda voltava escondido atrás de uma lista que
ninguém tem motivo para reler. A régua nova é a MESMA da entrada literal, aplicada
a CADA valor provável: o valor tem de ser entrada de `scripts`, binário de
dependência declarada ou subcomando nativo do gerenciador (na forma sem `run` —
`BIN=vitest` é variável legítima, e exigir uma entrada de `scripts` ali seria
violação falsa), e o que ele EXECUTA é julgado recursivamente, com a proveniência
inteira na mensagem (`entrada provável \`$ENTRADA\` → \`typecheck\` (em
\`scripts\`) → script do node \`scripts/sumiu.mjs\` NÃO existe — o mais próximo é
\`sumiuX.mjs\``). O que NÃO é estático (leitura de runtime) continua sendo decisão
datada, como qualquer runtime.

**Onde roda:** o pre-commit (fase paralela, node-puro e read-only, ~0,1s) e o CI
nas duas pontas do CORE — job `guards` da forja (dona do merge) e job
`workflow-refs-guard` do GitHub — classificados no `check:forge-parity` com o
MESMO literal de comando nas duas. O `post-checkout` também entra (a lista é lida
DO DIRETÓRIO: um hook novo é julgado sem ninguém lembrar de uma lista à mão); o
`.husky/_` fica fora (são shims do husky, não comandos nossos).

**Como é provado:** `src/lib/__tests__/check-hook-commands.test.ts` — cada classe
de violação tem um caso (caminho, entrada de `scripts`, entrada apontando para
arquivo removido, entrada de `bun run` montada em variável — a que existe, a que
não existe e a que executa um arquivo removido —, alvo de `bash` montado em
variável — que desce e acha o defeito lá dentro, o conjunto de valores, o
`source` que herda funções e o que não desce —, função ausente, `source` ausente,
binário sem fornecedor, payload não declarado) e cada um tem o CONTROLE na direção oposta (o mesmo
fixture sem o defeito sai verde), que é o que desmente um não-zero vindo do
FIXTURE. A HERANÇA tem as duas direções e o caso que separa as duas leituras do
diretório: o `export` que o filho resolve (com a proveniência no motivo), o
CONTROLE sem `export` (o processo novo não vê nada, e o veredito é a decisão
datada), o diretório que viaja **do exportador** — mesma forma com o alvo
existindo SÓ no diretório do filho: o veredito é VIOLAÇÃO nomeando
`scripts/ok.mjs`, que é o alvo verdadeiro (era aqui que o guard saía verde), a
UNIÃO com a atribuição do filho, o `source` sem `export` e o `export VAR` sozinho. A régua de extração é medida separadamente (comentário, heredoc, quebra
de linha, `$( )`, `case`, função, continuação). E o repositório REAL é julgado com
um **PISO de cobertura** (`comandos >= 200`, os três hooks e os scripts descidos nomeados): se a extração
ou a descida pararem de funcionar, a contagem cai e o guard "passa" — o piso é o
que impede o verde por vazio. Em produção: **273 comandos** (128 nos 3 hooks +
145 dentro dos 5 scripts chamados), **267 resolvidos** e **6 indeterminados
DECLARADOS** (as quatro decisões de caminho viraram prova; sobraram os payloads de
`-c`).

**OS NÚMEROS DE PRODUÇÃO DESTA SEÇÃO SÃO DERIVADOS — e conferidos.** O total de
comandos, os resolvidos, os indeterminados, os hooks e os scripts descidos saem do
próprio `analyze()`: a frase acima é lida na FORMA CANÔNICA (`**<N> comandos**`,
`<N> nos <N> hooks`, `<N> dentro dos <N> scripts chamados`, `**<N> resolvidos**`,
`**<N> indeterminados`), cada número é comparado com o medido e o guard falha
nomeando **o arquivo, a linha e o delta**. Um número escrito à mão aqui não é um
detalhe de prosa: é por ele que o leitor confere a ESCALA deste guard, e um total
que envelhece para BAIXO faz um guard cego parecer saudável — a mesma classe do
piso de cobertura, um nível acima (no piso o guard mede o vazio; aqui ele mede
cheio e a doc conta outra coisa). A regra nasceu de um caso **medido**: a prosa
dizia 250 comandos / 244 resolvidos / 105 nos hooks quando o medido era
251 / 245 / 106. É fail-closed nas três direções: número divergente é violação,
forma que **sumiu** da prosa é violação (a doc parou de publicar), e duas
declarações **diferentes** da mesma forma também são (a régua não escolhe uma).
**Limite declarado:** num `--root` de fixture a doc não existe e a regra não
mede nada (o relatório diz isso em voz alta); no repositório, doc ausente é
violação.

**Prova por mutação:** `scripts/test-mutation-hook-commands.sh` muta o próprio
guard em VINTE E SETE direções, cada uma com as testemunhas do veredito do CLI
sobre uma fixture e a suíte unitária, que tem de ficar VERMELHA.

As QUATRO primeiras são do lado que DETECTA: três na direção de CEGAR —
`arquivoExiste` devolvendo sempre `true` (o caminho tipado passa), a entrada de
`scripts` ausente aceita (o `bun run tipecheck` que ninguém criou passa) e o
indeterminado devolvido sem olhar a lista (o payload de runtime não declarado
passa) — e UMA na direção OPOSTA: ignorar a regra da função do próprio hook faz o
guard ACUSAR O SÃO no hook real (`wait_all` do `pre-commit` vira violação).

As TRÊS seguintes são da DESCIDA (M9–M11), e cada uma mede uma das propriedades
acima. As TRÊS SEGUINTES são das VARIÁVEIS DE CAMINHO (M12–M14) — a metade que
PROVA o alvo do interpretador em vez de declará-lo: sem a resolução o repositório
REAL passa a ser acusado (as decisões datadas que cobriam esses comandos não
existem mais), sem a conferência de disco a variável que aponta para arquivo
inexistente passa como resolvida, e sem o fail-closed descartar a atribuição
ilegível faz o guard provar a metade que sobrou.

As DUAS SEGUINTES (M15–M16) são da ENTRADA montada em variável: aceitar o valor
provável sem conferir faz a entrada REMOVIDA no mesmo commit passar (a classe que
antes vivia numa decisão datada), e parar no NOME da entrada deixa o defeito que
ela executa um nível ADIANTE do verde. A M17 é o alvo PROVADO da descida: sem
resolver o `$ALVO` da chamada, o interior do script provado deixa de ser julgado.
As DUAS SEGUINTES (M18–M19) são as recusas que existem para o verde não vir de um
conjunto que o guard NÃO LEU: sem a regra do VAZIO o `""` é aceito como valor (e
o `binInstalado(root, "")` — o diretório `.bin` — faz o comando sair verde), e sem
o TETO o guard "prova" 9 valores que não enumerou. E as DUAS ÚLTIMAS (M20–M21)
são os dois elos do congelamento do diretório: a fixture tem o alvo verdadeiro
AUSENTE e o caminho que o filho veria se re-avaliasse a expressão PRESENTE — cada
mutação, sozinha, faz o guard sair VERDE apontando para um alvo que o processo
novo nunca pode ver.

As **DUAS DO MEIO** (M26–M27) medem a CLASSE do alvo provado — a régua que o
veredito passou a compartilhar com o alvo literal: a M26 julga o valor ABSOLUTO
de uma atribuição pela existência (o `/etc/hosts` de um `ALVO=` vira "NÃO existe
no repositório" e o caso SÃO é ACUSADO) e a M27 aceita o PADRÃO como caminho
PROVADO (o `scripts/*.sh` de uma atribuição sai verde, sem a decisão datada que o
alvo literal exige). A M26 é na direção OPOSTA (como M4/M11/M12/M23/M24): sem a
classe, o guard fica mais ESTRITO que a verdade.

A **ÚLTIMA** (M25) é a única mutação **na doc** e não no guard: ela devolve o total
de comandos ao valor escrito à mão (um a menos que o medido) e exige o vermelho
nomeando a linha da prosa e o delta. Ela não tem fixture — o
número de produção é do repositório REAL —, e é por isso que ela entra no MESMO
backup por checksum do guard (a prosa é restaurada junto, mesmo se o script
morrer no meio).

As **TRÊS ÚLTIMAS DO GUARD** (M22–M24) são o idioma `SCRIPT_DIR` e a leitura da
atribuição — a régua que fez os limites da descida caírem de 18 para 2: a M22
mapeia o idioma do PAI (`$(cd "$(dirname "$0")/.." && pwd)`) para o diretório do
ARQUIVO (a fixture tem o alvo existindo SÓ no caminho errado — e ele é provado), e
as M23–M24 medem a leitura do valor: por INTEIRO, a atribuição do prefixo de
ambiente (`GUARD="$GUARD" ALVO="$1" …`) cita o próprio nome e vira CICLO, e a
auto-referência sozinha faz o guard ACUSAR o são. As duas últimas são na direção
OPOSTA (como a M4 e a M11): sem elas o guard fica mais ESTRITO que a verdade.

As do lado que **GRAVA** (`--fix` — M5 a M8) medem uma regra do remendo, o único
lugar do repositório onde uma mutação pode fazer o repositório ESCREVER o que não
deve; as demais medem o lado que JULGA. A tabela, na ordem do script:

| mutação | a regra que ela tira do lugar                                          | o que acontece sem ela                                                      |
| :------ | :--------------------------------------------------------------------- | :-------------------------------------------------------------------------- |
| M5      | a UNICIDADE do vizinho (empate é recusa)                               | o remendo grava um dos empatados, SORTEADO — onde tinha de recusar          |
| M6      | o TETO de distância (a mensagem sugere; o remendo não grava sugestão)  | o remendo troca o caminho por um PARENTE distante                           |
| M7      | a CONFIRMAÇÃO (sem terminal e sem `--yes` não grava)                   | o remendo grava sem perguntar a ninguém                                     |
| M8      | o ESCOPO do token (o de outro arquivo não é deste hook)                | o remendo reescreve um COMENTÁRIO do hook por um defeito do `package.json`  |
| M9      | a DESCIDA (parar no alvo do `bash`)                                    | o caminho tipado DENTRO do runner passa a sair verde                        |
| M10     | o ESCOPO das funções de um script EXECUTADO                            | o nome que o shell nunca acharia passa a resolver dentro do script          |
| M11     | os PADRÕES de um `case` não são comandos                               | o `-h\|--help)` de um script bem escrito ACUSA o repositório REAL           |
| M12     | a RESOLUÇÃO das variáveis de caminho                                   | as decisões datadas já não cobrem esses comandos e o repositório REAL acusa |
| M13     | a EXISTÊNCIA do alvo PROVADO (a resolução é promessa sobre o disco)    | a variável que aponta para arquivo inexistente passa como resolvida         |
| M14     | o FAIL-CLOSED da resolução (uma atribuição ilegível é a variável toda) | descartar a atribuição que falhou faz o guard provar a metade que sobrou    |
| M15     | a EXISTÊNCIA da entrada provável (`bun run "$ENTRADA"`)                | a entrada REMOVIDA no mesmo commit passa (a decisão datada cobria as duas)  |
| M16     | a DESCIDA na entrada provável (o que ela EXECUTA)                      | a entrada que aponta para arquivo removido fica um nível adiante do verde   |
| M17     | o alvo PROVADO por variável na descida (`bash "$SCRIPT_DIR/x.sh"`)     | o interior do script que a resolução provou deixa de ser julgado            |
| M18     | o valor VAZIO da resolução                                             | o `""` é aceito como valor (o `.bin` é um diretório) e o comando sai VERDE  |
| M19     | o TETO de combinações (`MAX_VALORES`)                                  | o guard prova um conjunto que NÃO enumerou (o verde vem do tamanho)         |
| M20     | o CONGELAMENTO do diretório no parse (`comDirCongelado`)               | o filho re-avalia a EXPRESSÃO no diretório dele: VERDE num alvo impossível  |
| M21     | a RESOLUÇÃO do marcador na herança (`herancaPara.resolvidos`)          | o `@DIR@` atravessa cru e o filho o resolve no diretório dele: mesmo VERDE  |
| M22     | o MAPEAMENTO do idioma do PAI (`marca: MARCA_DIR_PAI`)                 | o `$SCRIPT_DIR` vale o diretório do arquivo e um alvo que existe sai VERDE  |
| M23     | a leitura do PRIMEIRO WORD da atribuição                               | o prefixo de ambiente vira CICLO e o guard ACUSA o são (violação falsa)     |
| M24     | a AUTO-REFERÊNCIA não acrescenta valor                                 | o `GUARD="$GUARD"` de uma linha vira CICLO e o alvo fica sem julgamento     |
| M25     | o total de comandos da prosa é DERIVADO do medido (não à mão)          | a doc publica 250 onde o guard mede 251: a ESCALA dele mente para quem lê   |
| M26     | a CLASSE do alvo provado (o ABSOLUTO é "fora do repositório")          | o `/etc/hosts` de uma atribuição é ACUSADO de não existir no repositório    |
| M27     | a CLASSE do alvo provado (o PADRÃO é "padrão, não um caminho")         | o `scripts/*.sh` de uma atribuição é aceito como caminho PROVADO (cegueira) |

A testemunha da M8 é o **CONTEÚDO do arquivo**, não o exit code — nos dois casos
o veredito é 1 (a violação de verdade continua lá) e é o `cmp` contra os bytes
esperados que separa "recusou" de "gravou" (e isso é declarado no script, não
escondido). A M11 também é na direção OPOSTA (como a M4): sem a régua do `case`, o
guard fica mais ESTRITO do que a verdade e o repositório real vira vermelho. Cada
mutação é cirúrgica (as outras metades seguem reprovando), o arquivo é restaurado
por checksum e o total roda em ~30s. A regressão que reintroduzir qualquer uma
dessas vinte e sete metades morre no job, não no hook de quem commita.

**E a PERGUNTA tem um dono só, fora do remédio.** `scripts/confirm-prompt.mjs` é
onde vive a régua da confirmação — o terminal de CONTROLE, o default NÃO, o teto
da espera, o sentinela de `TIMEOUT` e o desligamento declarado —, e ela é
reexportada pelo remédio (a superfície que os testes e o ensaio sob `pty` já
importavam). O dono saiu do remédio porque o `check-hook-commands --fix` faz a
MESMA pergunta: o guard não pode importar o remédio (o grafo dele é o do hook
inteiro, e o guard roda em fase paralela e no CI), e duas cópias da régua
divergiriam no dia em que uma delas passasse a aceitar uma resposta diferente —
num lugar onde o desfecho é um hook esperando uma resposta que ninguém sabe que
foi pedida.

**E o doctor EXECUTA a outra prova (a de ponta a ponta).** Este guard responde
"todo comando do hook RESOLVE?" — que é diferente de "o hook de fato BLOQUEIA o
commit defeituoso?". A segunda pergunta era respondida só pelo teste
`pre-commit-git-commit-blocks.test.ts` (um `git commit` de verdade, com o veredito
lido no objeto); ela agora é a parte dos elos do fato `localContract` da seção 4/7
do relatório de prontidão — o doctor roda o MESMO `proveCommitBlocks()` de
`scripts/pre-commit-proof.mjs` que o teste importa (régua única, dois
consumidores) e publica provado/violado/indisponível. E as duas perguntas — as
duas provas EXECUTADAS e a régua dos comandos que este guard responde — são
publicadas no MESMO fato: o `localContract` lê este `analyze` (importado, não
recopiado) e o veredito consulta esse fato, e só ele. Ver a §13.

---

## 25. A prova do bloqueio do pre-commit DENTRO da imagem do runner — `pre-commit-in-runner:prove` (`scripts/prove-pre-commit-in-runner.mjs`)

**O que protege:** a promessa "um corpo `run:` quebrado no índice não vira
commit" — medida no **runtime que julga o merge**, e não só na máquina de quem
commita.

**Por que existe (a distância entre os dois ambientes).** O doctor já publica o
fato do bloqueio do pre-commit e EXECUTA a prova de verdade
(`proveCommitBlocks`, de `pre-commit-proof.mjs`); a suíte dos hooks importa o
mesmo módulo. Mas os dois rodam ONDE o operador roda. E a diferença entre a
máquina dele e o CI é exatamente onde esta classe já mordeu: `git` ausente, um
`bash` de outra implementação, o `node` de outro caminho, o hook sem bit de
execução — que o git **ignora em SILÊNCIO** (o commit entra como se o hook
tivesse passado). Aqui o MESMO módulo de prova é lançado dentro da imagem do
runner (`Dockerfile.ubuntu-bun`), com um `git commit` de verdade invocando o
hook REAL do checkout.

**O lugar é ESCOLHIDO E DECLARADO** (é o que o comando acrescenta ao módulo da
prova):

1. **Já dentro da imagem** — o caso do job da FORJA. O label `docker://` do
   `GITEA_RUNNER_LABELS` faz o job rodar NO container da imagem, e o socket do
   docker **não** está montado nele: a prova roda em lugar, e o docker não é
   consultado. Os marcadores do runtime são **verificados**, nunca presumidos —
   estar num container (`/.dockerenv` ou `/run/.containerenv`) E sobre a base do
   runner (`/opt/acttoolcache`, o mesmo caminho que a medição dos shells
   registrou para o `node`). Faltando um, `--in-image` **RECUSA** (exit 2): um
   `--in-image` numa máquina hospedeira devolveria `proven` para uma medição
   feita no lugar errado;
2. **`docker run`** — o caso do espelho do GitHub, cujo runner self-hosted é uma
   MÁQUINA com docker (`self-hosted,linux,x64,docker`): o mesmo comando roda com
   `--in-image` DENTRO de um container da ref derivada
   (`runnerImageRef`: `IMAGE_REGISTRY`/`IMAGE_NAMESPACE`/`BUN_VERSION`), com o
   checkout montado **NO MESMO CAMINHO** — o `node_modules` do fixture é um link
   ABSOLUTO, e montar em outro caminho faria o guard morrer de "module not
   found", com o não-zero vindo do fixture em vez do defeito.

**DUAS FORMAS, e a diferença é o que cada uma MEDE.** Sem flag, o hook do
checkout é rodado SOMADO ao dublê do simulador: os guards irmãos do defeito
devolvem 0 (declarado), e quem roda de verdade é o guard do defeito
(`check-workflow-run-syntax.mjs --staged`, com o `node` REAL do runtime) e o
REMÉDIO — é a forma BARATA, e o fixture não tem o `package.json` do projeto (a
fase C real, `lint-staged`/`typecheck`, não caberia nele).

Com `--sem-duble`, o hook é o **REAL** sobre uma **CÓPIA do checkout**
(`proveRealHookBlocks`): sem wrapper e sem dublê, as **DUAS fases** rodam de
VERDADE — os seis guards de fase A, o gate e os **dez membros da fase B**
(inclusive o runner de encoding, que a fase A nem toca) —, e a fase C
(lint-staged, typecheck) roda real, porque a cópia tem o `package.json` e o
`node_modules` (LINKADO, não copiado).

**A forma padrão mede DUAS metades**, e o exit code é o da PIOR delas
(`combineStates`: `violated` vence `unavailable`, que vence `proven` — uma metade
que não pôde ser medida nunca vira verde pela outra). A primeira é o BLOQUEIO
(acima). A segunda é a **OFERTA do remédio** (`proveRemedyOffered`) — a metade que
até aqui só era medida no SIMULADOR (a suíte e o ensaio do pty), e que é o que o
job mede agora DENTRO do runtime:

1. o commit que **APAGA** o arg `BUN_VERSION` do build site de um compose é
   RECUSADO pelo **guard dono** (`check-bun-mirror.mjs`) rodando de verdade no
   recorte `--staged`, com o HEAD intacto (a contagem de objetos é RELATIVA: o
   fixture tem o commit BASE com a declaração, e o defeito é a remoção dele);
2. a **OFERTA** tem de nomear a classe `bun-mirror-removal`, com os ofensores e o
   fixer do dono — medida pela CLI `--oferta` do `pre-commit-remedy.mjs` (a cópia
   do FIXTURE, byte a byte, o mesmo script que o hook executa, no mesmo runtime)
   —, e o **vínculo com o hook** é medido no lado dele: a saída do commit CITA a
   classe. O bloco da oferta é **UMA escrita** do remédio (é por isso que ele
   pode ser requisito sem ser flaky; as linhas `✅`/`❌` dos guards paralelos
   seguem evidência, como no resto do arquivo);
3. o **CONTROLE**: o `--fix` do dono, rodado de verdade no runtime, devolve a
   declaração ao ÍNDICE, o `--staged` do dono volta a **0** e o commit de
   controle ENTRA (conteúdo conferido em HEAD). Ele soma uma **mudança benigna**
   ao índice de propósito: o remédio RESTAURA o que o commit apagava, então o
   commit sozinho seria **VAZIO** para o git (medido: `nada adicionado ao envio`) —
   o que se mede é o veredito do hook com a declaração de volta.

**Custo da metade: ≈0,61s** (mediana de 3 execuções warm neste host, 09/2026 —
um fixture com o guard dono real, dois `git commit` e uma invocação da CLI da
oferta), pago **uma vez** pelo passo padrão do job; a forma `--sem-duble` não a
roda.

O caminho exercitado é o **NÃO interativo** (`NO_PROMPT` do simulador): o commit
do fixture não tem operador e o remédio é fail-closed nesse ramo (imprime o
caminho à mão e mantém o commit bloqueado). O **caminho interativo** é medido pelo
ensaio do pty, e as metades de FALHA (bloqueio cego, oferta sem a classe, hook que
não a publica, fixer que não restaura, `--staged` que continua vermelho, controle
que não entra) são exercitadas por INJEÇÃO em
`src/lib/__tests__/prove-remedy-offer.test.ts` — uma prova que só mede o caminho
feliz não distingue "a oferta existe" de "a oferta aconteceu por acaso".

**Como a recusa é ATRIBUÍDA nesta forma (por exit code, não por prosa):**

1. o **defeito de fase A** — um corpo `run:` aberto num workflow **NOVO**
   (`.github/workflows/prova-fase-a-real.yml`, para o refutador ser ÚNICO: num
   workflow existente outros guards reprovariam junto e a recusa deixaria de ser
   atribuível) — é RECUSADO: exit não-zero e o **HEAD intacto**. A contagem de
   objetos de commit NÃO mede isso aqui: na cópia a fase C roda de verdade e o
   `lint-staged` cria objetos por conta própria (o stash interno dele);
2. os **seis** guards de fase A e o **gate**, rodados DIRETAMENTE com o mesmo
   `--staged` sobre o MESMO índice, têm de sair **0,0,0,0,0,0** e **não-zero** —
   respectivamente. É a metade que responde "quem recusa": sem ela, um irmão que
   também reprovasse (ou que nem rodasse) ficaria invisível;
3. o **CONTROLE** (o mesmo arquivo com o corpo fechado) ENTRA — sem ele,
   "recusou" seria indistinguível de um ambiente que não sabe commitar;
4. o **defeito de fase B** — duas classes, um byte `0x97` num `.ts` NOVO
   (`src/lib/prova-fase-b-utf8.ts`, ENCODING) e um link interno quebrado num `.md`
   NOVO (`docs/prova-fase-b-link.md`, LINK) — também é RECUSADO, com o HEAD
   intacto. Até aqui a fase B só era medida pelo lado que PASSA (o controle da
   metade 3 entrava); a metade nova é a que diz **quem recusa** um defeito da
   classe dela;
5. a **ATRIBUIÇÃO da fase B**: os **dez membros** da fase B (o runner de encoding,
   os oito `bun`/`node` e o `prettier --check` sobre a lista do índice) rodados
   DIRETO sobre o MESMO índice, com o veredito por exit code, e a **DESCIDA** do
   runner — os comandos que o PRÓPRIO `run-encoding-guards.sh` declara, rodados um
   a um — **nomeando o guard** que recusou (`check-utf8.sh` para o encoding,
   `check-readme-anchors.mjs` para o link). O conjunto medido tem de ser o
   DECLARADO nos dois sentidos: um membro declarado que ficasse verde e um
   vermelho não declarado derrubam a prova com o nome do guard (fail-closed contra
   surpresa). A fase A e o gate têm de estar verdes nesse índice — a recusa é da
   fase B, não de um irmão —, e o CONTROLE de cada defeito (o arquivo REMENDADO)
   ENTRA;
6. o **BUMP DE MATRIZ sem o ato que a versiona** — o defeito que só o COMMIT local
   produz: a matriz (o `SUBTESTS` do master, o summary e o comentário do job no
   `pr-check.yml` e as **refs vivas** do README, mais o ARQUIVO da suíte nova,
   tudo derivado do PRÓPRIO guard) num commit e o registro versionado do custo no
   seguinte. O índice do bump tem de ser RECUSADO, e a recusa tem de ser do
   `check-mutation-count.mjs --staged`: exit não-zero e a saída dele trazendo o
   **marcador da defasagem** e o **sub-test novo nomeado** (o vermelho de outra
   regra do mesmo guard não serve — `citouMarcador`/`citouSubTest` são medidos).
   A atribuição aqui é mais larga que nas outras metades, e por medição: com a
   suíte nova sem cabeçalho (`Usage:`/`Exit code:`) o `barrel-lint` da fase B
   reprovava o MESMO índice, e como a fase A recusa ANTES de a fase B rodar, a
   recusa teria ficado atribuída ao guard da contagem sem ser dele — então os
   **cinco irmãos** (os de fase A SEM o dono), os **dez membros de fase B** e o
   **gate** entram todos verdes no MESMO índice, além do guard dono vermelho; e o CONTROLE — o
   MESMO índice com o **ato versionado** (a forma nova na família `mutations` do
   `guard-timing-baseline.json`) — ENTRA, com a forma conferida em HEAD.

O TEXTO do hook (os `✅`/`❌` dele) entra como **evidência** e como rigor EXTRA
(um refutador que não seja o do gate derruba a prova), nunca como requisito: a
escrita de um processo num PIPE é assíncrona e uma linha pode se perder (medido —
num stub mínimo os `✅` variaram de 3 a 5 entre execuções). Um requisito de
texto seria flaky por construção; o exit code não é.

**A ponte entre os dois processos.** O processo de dentro (que roda no
container) imprime linhas `PROVA-<CHAVE>=<valor>` — modo, estado, marcadores, o
runtime MEDIDO (`/opt/acttoolcache/node/<versão>/x64/bin/node`, o `git` da
imagem, o `bash` do harness), o defeito e o controle. Na forma sem dublê saem
também a **forma** (`PROVA-VARIANTE`), a **atribuição** (`PROVA-REFUTADORES`, o
número de refutadores no relatório do hook; `PROVA-IRMAOS`, quantos dos seis
saíram 0) e o **HEAD** de cada metade (`PROVA-HEAD=defeito:intacto
controle:avancou`). O **bump de matriz** sai em chave própria
(`PROVA-MATRIZ=sub-test:… exit:… head:… refutador:… marcador:… irmas:5/5
membros:10/10 gate:0` e `PROVA-MATRIZ-CONTROLE=exit:… formas-no-ato:…
formas-em-head:…`): a metade só existe na forma sem dublê, e um leitor do
container não deve deduzir do estado composto o que ninguém mediu — chave
ausente é "esta forma não mede isso", chave presente é proveniência — o número de objetos fica na evidência como o que ele é
(objetos do repositório), não como veredito de "o commit entrou". Da metade do
remédio saem chaves PRÓPRIAS (`PROVA-REMEDEIO`, `PROVA-OFERTA` com os ids das
classes, `PROVA-OFERTA-FIXER` e `PROVA-OFERTA-CONTROLE=fixer:… guarda:… exit:…
objetos:… head:restaurada`): o estado composto não diz o que cada metade publicou,
e é a evidência que permite conferir a oferta sem reexecutar o container. A chave
admite HÍFEN (`PROVA-OFERTA-FIXER`) — achatar o nome em `OFERTAFIXER` esconderia
a relação entre os campos justamente de quem lê a evidência. O **exit code**
continua sendo o veículo do veredito (o docker o propaga) e as linhas são a
proveniência: `null` de exit (timeout, sinal) e código desconhecido (125 do
docker, 127 de binário ausente) são **INDETERMINADO**, nunca verde.

**Provas.** Os dois modos rodaram DE VERDADE: `--in-image` fora do runtime
RECUSA nomeando os dois marcadores que faltaram, e o modo automático neste host
(sem marcadores, com docker) lançou o container da imagem e fechou **exit 0**
com o defeito recusado (exit 1, zero objetos de commit) e o CONTROLE entrando
(exit 0, um objeto, conteúdo conferido em HEAD) — o `git version 2.55.0` da
evidência é o da IMAGEM (o do host é 2.43.0), o que por si só mostra onde o
commit aconteceu. No CI o job roda nas duas forjas (é CORE: invariante
`pre-commit-in-runner-proof`, o mesmo comando nas duas pipelines) e o doctor
confirma o contrato: o job está no manifesto e roda a régua da invariante.

A metade do remédio foi medida nas DUAS formas, no container da imagem:
o relatório publica `PROVA-REMEDEIO=proven`, `PROVA-OFERTA=bun-mirror-removal`,
`PROVA-OFERTA-FIXER=node scripts/check-bun-mirror.mjs --fix` e
`PROVA-OFERTA-CONTROLE=fixer:0 guarda:0 exit:0 objetos:1 head:restaurada` — com o
`git version 2.55.0` da IMAGEM na evidência do runtime, e o exit code do comando
em **0**. O `--sem-duble` NÃO publica essas chaves (a oferta não é o escopo
daquela forma): ela sai com `PROVA-STATE=proven` pelo bloqueio real, o que é a
medição de que a composição de estados não misturou as metades.

O fixture da metade usa uma **SENTINELA** (`9.9.9-sentinel`) como versão, e não um
literal: o guard da fonte única lê `scripts/` — um `1.3.14` cravado numa fixture
envelheceria em silêncio depois de um bump, e foi o PRÓPRIO guard que o apontou
(`check:bun-mirror`, 2 violações) na primeira medição desta metade.

**O que NÃO cobre (declarado no relatório, não escondido).** A forma PADRÃO
declara que os guards IRMÃOS rodam no dublê do simulador — e o limite diz ONDE
ele é fechado: **o `--sem-duble`, que roda os seis de verdade**. Quem é a forma
padrão é o fixture do simulador, não o checkout do PR; a ref é a DECLARADA (o
digest sai como proveniência medida, mas quem prova qual imagem o runner
registrou é o `check-runner-labels`/o smoke); e no modo `docker run` a imagem tem
de estar local ou ser baixável — pull que falha é INDETERMINADO com a dica da
credencial.

A forma SEM DUBLÊ declara o escopo DELA (não herda os de cima): os defeitos são
arquivos NOVOS — o workflow da fase A e o `.ts`/o `.md` da fase B (o mesmo motivo
da atribuição única), e o bump da matriz escreve a forma do ato **pelo mesmo
caminho** que o ato escreveria sem EXECUTAR o ato (o custo do sub-test é do
`bench-guard-timing`, e quem cobra a existência dele é o `check:mutation-count`
sobre a árvore); a árvore é uma CÓPIA do
checkout com commit base sintético (quem mede o commit do PR são as pipelines do
merge); o REMÉDIO fica sem operador (`NO_PROMPT_ENV` do simulador — a prova mede
o caminho NÃO interativo, e quem mede o interativo é o ensaio do pty); e o teto de
tempo por comando do simulador (`runGit`, 60s) faz um controle mais lento que isso
sair como INDETERMINADO.

**O que ela já pegou.** Na primeira medição de verdade o `--sem-duble` saiu
INDETERMINADO não por causa da prova, mas do CHECKOUT: um `: ` dentro do escalar
plano de um `run:` do Summary quebrou o YAML das DUAS pipelines, e os três guards
de varredura de workflow responderam `NÃO JULGÁVEL` (a classe que o `readWorkflowScan`
existe para nomear). O bloco apareceu no relatório da prova — e foi corrigido no
mesmo turno. É o desenho funcionando: "não conseguir julgar" nunca vira "nada a
julgar", nem dentro de uma prova que roda no runtime do CI.

**Prova por mutação das três réguas do veredito**
(`scripts/test-mutation-pre-commit-proof.sh`, matriz do master). As metades que o
`--sem-duble` afirma — a recusa, a atribuição e o CONTROLE — são medidas hoje em
dia por casos de fixture que mutam a ENTRADA (o hook sem a fase B, o guard do
encoding cego, o gate cego); nenhum deles muta a RÉGUA, e é isso que esta suíte
fecha. Cada régua é desligada **no lugar** e o que se exige é o vermelho:

| metade | o que ela desliga                                                                                                                             | onde o vermelho aparece (medido)                                                                                                                                                                                                       |
| :----- | :-------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **M1** | a DECLARAÇÃO dos recusadores (a comparação do conjunto medido com o `recusadoresEsperados`)                                                   | sem ela a atribuição vira um relatório: a suíte cai em _um refutador DECLARADO que fica verde_ e em _um refutador NÃO declarado_                                                                                                       |
| **M2** | a DESCIDA do runner (`descidaDoEncodingRunner` deixa de NOMEAR quem recusou)                                                                  | o runner devolve UM exit code (o `set -e` para no primeiro guard): sem a nomeação, a suíte cai nas duas metades da fase B (`ENCODING` e `LINK`) e no caso do gate + controle                                                           |
| **M3** | o PREDICADO do CONTROLE — as **quatro cláusulas** da mesma régua (status/HEAD e conteúdo do controle da fase A e o de cada defeito da fase B) | a prova sai **VERDE** sobre um hook que recusa até o commit correto; a testemunha é o caso novo _um hook que recusa TAMBÉM o commit do CONTROLE_, que nasceu com esta suíte (nenhum caso do fixture fazia o commit do CONTROLE falhar) |

**A M2 é medida por DUAS testemunhas:** um driver node-puro — que importa o
módulo e roda a descida contra uma bancada (um runner que declara um comando que
passa e um que falha) e exige o recusador **nomeado** —, e a suíte unitária. É o
único driver do repositório que mede esta prova, e ele existe porque a descida é
uma função exportada: no job do ESPELHO (`mutation-guards`, que não instala
dependências) a testemunha unitária se declara não julgada e a M2 continua medida
por execução. A M1 e a M3 vivem DENTRO de `proveRealHookBlocks`, cujo único
harness é o fixture da suíte — montar um segundo checkout sintético aqui seria a
mesma fixture em dois lugares (a classe de defeito que o `check-hook-ci-parity`
existe para não deixar voltar), e é por isso que elas medem onde o vitest existe.
A suíte é node+bash e roda no master (matriz serial), com a árvore restaurada por
checksum no trap.

**Onde roda.** Job `pre-commit-in-runner-proof` (nome `Pre-commit Proof (dentro
da imagem do runner)`) nas duas pipelines, e é **required check**
(`ci/required-checks.json`). No espelho, `permissions: packages: read` para o
pull da imagem privada, e `bun install --frozen-lockfile` — a prova precisa do
`node_modules` (o guard importa o parser), e é o `check-job-deps` quem cobra isso
de todo job. O job roda os DOIS passos: a prova (dublê) e a prova `--sem-duble`
— nenhum contexto novo de required check entra no contrato (é o MESMO job), e é
por isso que o rename/bump da matriz não toca a branch protection.

**Custo (medido neste host, 09/2026, com a imagem já local).** O comando inteiro
da forma sem dublê (o `docker run` + a prova dentro dele) leva **66s** — o mesmo
comando levava **31s** quando media SÓ a fase A, e as duas metades da fase B
são o que acrescentou: cópia do checkout (~95MB, com o `node_modules` LINKADO) + o
commit do defeito A (~3s — a fase A recusa antes da fase C) + os seis guards
diretos (~2s) + o CONTROLE A (~25s, que é a fase C real: `lint-staged` +
`typecheck`) + **o defeito e o controle de CADA classe da fase B** (dois defeitos
curtos — a fase B recusa antes da fase C — e dois controles que rodam a fase C
inteira; ~37s, medido aqui pelo delta de 36s para 73s na forma local). Ela RODA o
typecheck do repositório de verdade — o que, na primeira
execução, reprovou o CONTROLE por um erro de tipo real introduzido no mesmo
turno (JSDoc sem o campo novo), e o pegou antes de qualquer outra rede.

<!-- prove-doc: pre-commit-in-runner:prove
     run: --json
     exit: 2
     cenario: docker-ausente
     desfecho: indeterminado
-->

```text
"state": "unavailable"
não dá para provar o bloqueio dentro do runtime do CI
o docker não respondeu
```

**`stack-per-commit:prove`** — cada commit da pilha passa SOZINHO? O PR mede o TOPO, e
a pilha tem commits no MEIO: um commit que nasce vermelho só aparece muitos commits
acima (medido — o `2757e3a5` pôs o `check-mutation-count` na bateria local, invalidou a
expectativa do teste da descida, e o vermelho viajou **12 commits** até o topo, que era o
único lugar onde ele era olhado).

O comando materializa CADA commit da pilha num `git worktree` próprio (com o
`node_modules` do repo medido ligado por symlink) e mede, por commit, o que ele sozinho
quebra:

1. os **TESTES AFETADOS** pelo diff dele, derivados por duas réguas — o **grafo de
   imports** (o teste que importa um arquivo que o commit mudou, pela mesma régua de
   código-vs-string do `check-tla-closure`) e a **convenção de nome**
   (`scripts/check-foo.mjs` → `check-foo*.test.ts`; `src/lib/foo.ts` → `foo.test.ts`);
2. o **CONJUNTO SEMPRE** (declarado): três invariantes de **árvore** que qualquer commit
   pode quebrar SEM tocar o guard que as possui — a contagem da matriz, a paridade das
   forjas e a prosa da versão. A bateria inteira (48 guards) por commit custaria horas, e
   o que fica de fora está nomeado no limite do próprio script.

O veredito é por commit: `verde` (passa sozinho), `vermelho` (nomeia o commit e o gate
que reprovou) e `indeterminado` — worktree que não abriu, comando ausente, timeout ou **o
gate que a árvore do commit não carrega** (o `CONJUNTO_SEMPRE` é o do HEAD, e um commit
anterior à criação de um gate não tem o arquivo dele: lá o `node` morre com
`MODULE_NOT_FOUND` e exit 1, que lido como vermelho ACUSA o commit de um defeito que ele
não tem — medido: 13 dos 59 vermelhos de um run real eram desta classe). Esses NUNCA
valem verde, e o ausente também não vale reprovação: sai com a razão NOMEADA (o arquivo) e
a varredura continua, porque um vermelho de verdade VENCE o "não consegui julgar". A pilha
REPROVA se algum commit não passar sozinho, e fica
INDETERMINADA (exit 2) se algum não pôde ser medido ou se a pilha estoura o teto de
commits (um job que não cabe no tempo não vira verde por não ter sido olhado).

**O VERMELHO É MEDIDO DUAS VEZES — e a segunda tentativa é DECLARADA.** Um vermelho pode
nascer do commit ou do AMBIENTE: um teste de integração que sobe container devolve
veredito DIFERENTE para a MESMA árvore entre execuções, e sem re-medir o flake é
publicado como "regressão" — o instrumento acusa um defeito que não existe, e um
instrumento que acusa o que não existe ensina a ignorá-lo (medido: a re-medição da pilha
acusou um flake de Docker/Gitea como regressão de um commit que, re-medido sozinho, saiu
verde 4/4). A régua é a REPETIÇÃO, nunca a segunda tentativa sozinha: **vermelho +
vermelho** é vermelho DO COMMIT; **vermelho + verde** é INDETERMINADO — nunca verde por
não saber, e as duas tentativas ficam no `motivo`, porque elas se CONTRADIZEM. O verde
NÃO é re-medido (o custo extra é só do vermelho, e um verde que seja flake ninguém mede:
quem mede a taxa é uma série de execuções, não uma re-medição). E nada sai em silêncio:
cada commit publica `tentativas` e `flaky` no `--json`, e a PROSA — a linha por commit do
streaming e a tabela do relatório — escreve `[2 tentativas: repetiu o veredito]` no
vermelho repetido e `flake` onde o flake foi declarado, para quem lê o log do CI poder
distinguir "medido uma vez" de "medido duas vezes".

**O ESCOPO DO BLOCO ABAIXO É DECLARADO, e ele é o CONJUNTO SEMPRE.** Os testes
afetados são o custo DOMINANTE e ele é função do diff do commit: medido no tip que
introduziu esta prova (15 arquivos), a derivação alcançou **25 arquivos de teste e
201s** — acima do teto de 180s do próprio `check-prove-docs`, isto é, um bloco de
doc com custo ilimitado, que reprovaria o guard por TEMPO quando o tip crescesse.
Com `--sem-afetados` o bloco mede o CONJUNTO SEMPRE do HEAD de verdade (worktree,
as três invariantes de árvore, o veredito e o `--json` reais) em **0,8s**, e os
testes afetados seguem medidos onde eles SÃO a pergunta: o job `stack-per-commit`
das duas forjas e a suíte de mutação. No escopo SEMPRE o relatório escreve
`afetados — (NÃO MEDIDOS: escopo --sem-afetados)` e o `--json` marca
`escopo: "sempre"`: um `0` ali NUNCA é "o diff não alcança teste nenhum".

<!-- prove-doc: stack-per-commit:prove
     run: --only HEAD --sem-afetados --json
     exit: 0
     cenario: ambiente
     desfecho: provado
-->

```text
"commits": 1
"veredito": "ok"
```

**O que ele mediu na primeira subida** (a cadeia do `#25`, 16 commits entre a base da
pilha e o topo): o gate achou **três commits que não passam sozinhos** — `4962399e`,
`5cb3abf2` e `a318c9c2` (nomes daquela série; hoje `4962399e`, `5cb3abf2` e `a318c9c2`) —
todos pela MESMA causa: a régua da idade do bench acusa a origem gravada na baseline como
fora da história, porque a reescrita de uma rebase troca o hash do commit em que o ato foi
medido. O topo é verde (o ato re-datou a proveniência), e é EXATAMENTE isso que o topo
esconde: um commit do meio que nasceu vermelho. A dobra que move um conserto para baixo
também reescreve esses hashes, e o mesmo gate pegou o efeito dela: o ato re-datado para o
commit PRÉ-dobra ficou órfão, e o topo passou a acusar.

**A dobra foi feita — e medida.** A re-dating passou a viajar DENTRO dos commits que a
carregam (o valor pré-dobra é re-datado onde ele NASCE, não num commit solto no topo), e os
**20 commits que a dobra produziu passam SOZINHOS**: `--only <sha>` em cada um, **0
vermelhos** — mais o commit da doc que declara isso —, e o pre-push do recorte não tem mais
o que recusar. O mesmo gate mediu, no caminho, as DUAS
causas que o primeiro vermelho ESCONDIA — as duas da MESMA classe, uma asserção que viaja
antes do que ela mede: o caso `a POLÍTICA do teto é a que a doc declara` nasceu no commit
do MECANISMO, com a prosa que ele lê chegando dois commits acima (a asserção foi para o
commit da doc), e o bloco de doc do `stack-per-commit:prove` estourava o teto de **180s** do
`check:prove-docs` no PRÓPRIO commit que o criou — medido: 15 arquivos de diff → 25 de teste
→ **201s** (o escopo passou a ser declarado, `--sem-afetados`, e o commit caiu para
**20,4s**).

**Prova por mutação:** `scripts/test-mutation-stack-per-commit.sh` tira cada regra do
veredito do lugar, uma por vez, e exige que o veredito MUDE — são **em OITO direções**
(M1–M8): a **régua nomeada** e a **do grafo** fora da DERIVAÇÃO dos testes afetados
(em M1 o commit vermelho que só o nome alcança sai ✅; em M2, o que só o import alcança),
o **veredito por commit** (M3: os dois commits que nascem vermelhos saem ✅ e a pilha sai
APROVADA) e o **da série** (M4: o relatório segue dizendo os dois vermelhos e o exit vira
0 — o job ficaria verde com dois commits vermelhos dentro), e o **TETO** (M5: acima dele
o gate sai 0 sem ter medido um único commit, quando a regra é INDETERMINADO), a
**REPETIÇÃO** (M6: tirando o ramo que lê a 2ª tentativa, os dois vermelhos REPETÍVEIS
passam a sair como flake e a série vira INDETERMINADA), a **RE-MEDIÇÃO** (M7: sem ela o
commit FLAKY do fixture volta a ser publicado como **vermelho repetível** — a "regressão"
que não existe) e o **GATE AUSENTE** (M8: sem o classificador, o commit cujo gate a árvore
dele não carrega volta a ser **reprovado**; o controle mede os dois lados da régua — o
gate PRESENTE que reprova continua vermelho, e o alvo é a EXISTÊNCIA do arquivo, não o
exit code).

**O RECORTE NO PUSH — o MEIO medido onde o defeito nasce.** As duas medições acima vivem
DEPOIS do push: o job mede o topo do PR e o harness mede a pilha inteira quando alguém o
chama. Quem empurra não via o commit do meio nascer vermelho. O `.husky/pre-push` passou a
chamar o MESMO módulo com `--pushed`: as refs que saem chegam pelo stdin (o protocolo do
git) e o recorte é a união `remote_sha..local_sha` **sem o topo** — a árvore do topo é o que
as outras fases do hook e o PR já medem, e é no MEIO que o vermelho vive. Um ref NOVO (sha do
remoto todo zero) não delimita pilha nenhuma: a base dele sai da base declarada, e sem base
resolvida o recorte é INDETERMINADO (nunca "medir a história inteira e chamá-la de pilha
deste push").

O que faz o recorte CABER no caminho do push é a **AMOSTRA declarada** (`PILHA_PUSH_MAX`,
default **6**; `--amostra N`): no máximo N commits medidos, escolhidos **deterministicamente**
(o mais antigo sempre dentro, os outros espaçados por igual) e com os **PULADOS NOMEADOS** no
relatório — pulado não é verde, é NÃO MEDIDO, e o veredito diz quantos mediu de quantos o push
leva. **Custo medido neste host (09/2026):** um push de UM commit não tem meio — o recorte é
vazio e sai em **0,04s** (é o caminho comum); a amostra cheia de 6 custou **37,8s** (6,3s por
commit, medidos na própria cadeia).

**O que ele BARRA, provado por execução** (`pre-push-stack-recorte-blocks.test.ts`, sobre o
harness de `pre-push-proof.mjs`): o fixture é uma pilha de TRÊS commits em que o do MEIO nasce
vermelho e o TOPO o conserta, com o remoto já em posse da BASE (senão o ref seria NOVO e a
metade do defeito seria "o remoto estava vazio") — um `git push` de verdade é **RECUSADO**, o
remoto fica com os MESMOS objetos de antes e a ref PARADA, o veredito **NOMEIA o commit do
meio** e o rastro do runner mostra o meio medido com o teste que a régua dos afetados derivou.
O **CONTROLE** é o mesmo fixture com o meio verde: ele **CHEGA** (ref atualizada, objetos no
banco, conteúdo conferido na ref) — sem isso, a recusa poderia ser de outro gate.

`indeterminado` (worktree que não abriu, gate ausente) **e** o caso em que o próprio recorte
não chega a um veredito (fecho incompleto, flag inválida) SEGUEM o push e são NOMEADOS — a
mesma postura declarada do `--no-verify`, com o job `stack-per-commit` do CI medindo a pilha
inteira. O bloqueio exige as DUAS coisas (exit 1 **e** o veredito no relatório): foi um achado
medido — a primeira execução da prova morreu com `ERR_MODULE_NOT_FOUND` e o hook tratou o
não-zero como "um commit do meio é vermelho", isto é, uma prova que mede o ambiente virando
uma ACUSAÇÃO ao commit.

**O RESÍDUO — o defeito que o próprio instrumento criou, e a varredura que o fecha.** O
`rmSync` do fim nunca roda numa execução MORTA (o teto de 180s do `check:prove-docs`, um
`kill -9`, a sessão que cai), e o resíduo se acumulou em silêncio: medido neste repositório,
**151 worktrees** e ~**11 GB** em `/tmp/pilha-*`. O nome do diretório não diz de quem ele é
nem se o dono ainda vive — varrer por padrão de nome mataria a medição de OUTRO processo (o
pre-push de outra thread), e não varrer nada é exatamente o que produziu o acúmulo.

Agora o worktree nasce com o **DONO DECLARADO** ao lado (`<tmp>/pilha-XXXX/dono.json`:
ferramenta, pid, host, sha, repo, início e `keep`), e a execução **varre o resíduo ANTES de
medir**, julgando pelo marcador — nunca pelo nome: pid **VIVO no MESMO host** fica (é outra
execução medindo agora); `keep: true` fica e é DITO (o `--keep` deixa de ser letra morta);
marcador de outra ferramenta ou ilegível **NÃO é tocado**; e o resto é varrido — o
diretório, o `git worktree remove --force` e o metadado órfão que o `prune` recolhe. A
varredura sai no relatório e no `--json` (campo `limpeza`) nos DOIS caminhos, inclusive no
recorte vazio — que é justamente o caminho comum. Custo medido neste host: o caminho comum
(recorte vazio, 4 entradas em `/tmp`) segue em **0,04–0,05s**, sem ordem de grandeza nova.

E o resíduo deixou de NASCER: a medição em curso é removida no SINAL
(SIGINT/SIGTERM/SIGHUP). **Provado por execução** (o 4.º grupo de
`prove-stack-per-commit.test.ts`): um filho DE VERDADE cria o worktree pelo módulo e fica
vivo — sob **SIGTERM** ele morre com 143 e não deixa nada em disco; sob **`kill -9`**o resíduo NASCE (o diretório fica, o git continua listando o worktree) e a varredura seguinte
o recolhe, NOMEANDO-o. E uma remoção que o HOST nega não sai como "varrido": ela é conferida
no disco e DITA (`⚠️ resíduo que NÃO pôde ser varrido`) — o `rmSync` que falhava em silêncio
com o relatório dizendo limpo era a mesma leitura falsa do resíduo silencioso.

**Prova por mutação (em NOVE direções, medido):** o dono vivo, o dono morto, o host, o
`--keep`, o marcador alheio, a limpeza no sinal, o relatório do recorte vazio, a conferência
da remoção negada e a linha do não-varrido — cada uma põe a suíte VERMELHA no teste que a
nomeia (a remoção negada derruba as duas últimas), e o arquivo restaurado volta a verde.

**A suíte limpa o que ela CRIOU — inclusive num vermelho.** Os casos de execução registram
worktrees no git do repositório REAL (é ele que a prova mede), e o `rmSync` do fim de um caso
não roda quando o caso FALHA: medido nos runs vermelhos das mutações, isso deixou **77
`tmp` (1,5 GB)** e **18 metadados** de worktree órfão. O `afterAll` da suíte remove os
worktrees que ela criou (pelo caminho, não pela lista), restaura o bit de escrita do caso da
remoção negada e roda o `prune` — medido num run VERMELHO: 0 `tmp` e 0 metadado a mais. Sem
isso, a suíte que prova a varredura seria ela mesma uma fonte de resíduo.

**O que o recorte mediu na primeira subida** (na própria série desta thread, os 12 commits
acima da dobra): **dois commits do MEIO vermelhos** — `5cb3abf2` e `7c10eb29` (os mesmos
dois, sob os nomes que a dobra deixou) — ambos pela causa já nomeada acima (a origem gravada na baseline
que a dobra tornou órfã), e nenhum dos dois é visível no topo. A consequência foi a promessa
do gate EM ATO: o push daquela série saiu RECUSADO até o conserto nascer no commit que
quebrou o invariante — a re-dating da proveniência tinha de viajar DENTRO dos commits que a
carregam (uma nova dobra). Foi o que aconteceu: a dobra está feita e a série inteira passa
SOZINHA, então o recorte **não tem mais nada a recusar** — a promessa do gate não precisou do
`--no-verify` nem do CI para valer.

O **fixture é um repositório git de verdade**, com uma pilha de **três commits sobre uma
base sã** onde **dois NASCEM vermelhos** — e cada um quebra **um** dos dois testes, por
uma régua diferente, o que torna as réguas separáveis: derrubar uma da derivação tira do
veredito **um** vermelho, e não os dois. O **TOPO** os conserta, e um controle roda o gate
com `--only` no topo: ele passa sozinho (exit 0) — é a classe do defeito medida, o topo
verde escondendo o vermelho do meio. A detecção é o **CONJUNTO de commits vermelhos**
(não o exit code: com uma régua só fora, o outro vermelho ainda reprova a pilha) e a
**DERIVAÇÃO lida na fonte**: o runner do fixture registra, por commit, os arquivos que
recebeu. O fixture DECLARA o próprio `vitest` (um script no `package.json` dele que
importa os arquivos e reprova se algum levantar): o sujeito é o veredito do gate sobre o
exit code do runner, e um fixture que exigisse `node_modules` iria a vermelho por
AMBIENTE num job sem dependências. A suíte é a **38.ª sub-test** da matriz do master, e
por isso roda com o MESMO comando nas DUAS forjas (o job `guards` da dona do merge e o
`mutation-guards` do espelho).

**`cut-stages:prove`** — cada etapa do corte do GitHub é shippable sozinha? Aplica as
cinco etapas de `docs/GITHUB_CUT.md` §3, EM SEQUÊNCIA, numa cópia da árvore rastreada
(nunca na árvore real) e mede o veredito dos contratos em cada passo com as MESMAS
funções que as pipelines executam: os gates da forja dona do merge (derivação do
`doctor`), a paridade (`discoverGates`/`findParityViolations`) e os contextos de required
check (`check-required-checks`). Duas invariantes valem em TODAS as etapas — os gates da
dona do merge e os required checks dela —, e a etapa 5 só fica verde com a declaração
(`PIPELINES`) atualizada no mesmo ato. Não precisa de docker nem de rede: o veredito é
dos CONTRATOS da árvore (quem executa os gates dentro da imagem é o `forge-runtime:prove`).

<!-- prove-doc: cut-stages:prove
     run: --json
     exit: 0
     cenario: ambiente
     desfecho: provado
-->

```text
"dona": "gitea"
"estado": "declarado"
"paridade": 0
```

**Prova por mutação:** `scripts/test-mutation-cut-stages.sh` injeta, uma por vez, a
mudança que cada invariante dura existe para pegar — e exige que o VEREDITO mude: são
**em TRÊS direções** (M1–M3), cada uma com a segunda metade que DESLIGA a invariante e
prova que o vermelho vinha dela. A suíte é o 34.º sub-test da matriz do master, e por
isso roda com o MESMO comando nas DUAS forjas (o job `guards` da dona do merge e o
`mutation-guards` do espelho): um guard cego para as invariantes duras do corte não
passa no espelho enquanto a forja muda — medido, ela custa **17.6s** sozinha pelo
caminho do master (3 metades).

A injeção é a mudança na ÁRVORE, não no guard: (M1) um passo de gate a MAIS no job
`guards` da forja DONA DO MERGE — os gates da dona vão de 28 para 29 e a paridade
medida segue em 0, então é a invariante 1 sozinha que denuncia (a direção da REMOÇÃO
NÃO isola: todo gate da dona é um invariante do CORE, e tirá-lo quebra a paridade
junto — medido); (M2) um job A MENOS no manifesto da dona (`ci/required-checks.json`:
os required checks resolvidos caem de 7 para 6); (M3) o BLOCO de um passo do espelho
removido (o gate do `check-e2e-counts.mjs`: o espelho cai de 56 para 55 gates) numa
etapa cuja declaração é `espelhoGates: null`. Nas três, a metade seguinte desliga a
invariante correspondente no `classifyStage` e exige o VERDE com a MESMA injeção no
lugar — sem ela, "ficou vermelho" poderia ser um crash.

**Por que a injeção não mora num FIXTURE (medido, e é o desenho):** as invariantes
comparam o ANTES e o DEPOIS do passo (`runStage` copia, aplica e mede; o
`classifyStage` compara essa medição com a linha de base). Uma árvore de fixture já
quebrada aparece IGUAL na base e no depois — não muda veredito nenhum. O excesso entra
DURANTE o passo, na linha do `copyTree` do `runStage` (o mesmo lugar em que a
transformação escreve), e a âncora é fail-closed: se o texto casar 0 vezes a metade
FALHA nomeando o motivo. A cirurgia é conferida por checksum (0 ou 2+ ocorrências
param a suíte) e a restauração é verificada no `trap EXIT`; onde o vitest não está
instalado, a segunda testemunha é DITA como não julgada.

---

## 26. As CONDIÇÕES de cada passo do retrato arquivado — `check:archived-pipeline` (`scripts/check-archived-pipeline.mjs`)

**O QUE É O RETRATO.** `.woodpecker.yml` é a alternativa ao Gitea/Forgejo
**avaliada e ARQUIVADA**: a forja adotada reaproveita a sintaxe dos workflows, o
Woodpecker exigiria reescrever todos. O arquivo continua versionado como
registro — e um registro que descreve a pipeline continua sendo lido como se
fosse verdade. Havia **duas** coisas julgando esse arquivo: a invariante 19 do
`check-bun-mirror` (o **VALOR** da versão do Bun em cada uso — treze usos que
envelheceram sete versões) e o `check:registry-source` (o **host** do registry).
O terceiro campo — o `when:` de cada passo, isto é, **QUANDO** o passo roda —
**não era julgado por ninguém**, e é exatamente o que envelhece sozinho: a
forja muda o `on:` de um workflow (ou acrescenta um `workflow_dispatch`) e o
retrato segue afirmando o gatilho antigo, sem nada ficar vermelho.

**A RÉGUA.** Cada passo do retrato declara a sua condição em `when:` — uma
**LISTA de cláusulas** (a semântica do Woodpecker: qualquer entrada que case
dispara o passo) —, e essa condição tem de ser **IGUAL** à que a forja aplica ao
trabalho daquele passo. Igual, não parecida: o veredito é sobre o conjunto de
cláusulas normalizado (`push@[main, develop] ∪ pull_request@[main]`), e a
mensagem mostra **os dois lados** quando diverge.

**DE ONDE VEM A CONDIÇÃO DA FORJA (derivada, nunca lista à mão).** Do próprio
`.gitea/workflows/`: **(a)** cada gatilho do `on:` vira uma cláusula, com o
filtro de `branches:` quando existe; **(b)** o `if:` do job **estreita** essas
cláusulas, com a gramática declarada — `github.event_name ==/!= '<e>'`,
`github.ref`/`github.ref_name ==/!= 'refs/heads/<b>'`, `&&`, `||`, parênteses. A
diferença entre as duas formas de erro importa: um termo sobre `github.ref`
numa cláusula **sem** filtro de branch não é falso, é **indecidível** (o ref
pode ser qualquer um), e é por isso que a avaliação tem TRÊS valores. O
`if: github.ref == 'refs/heads/main' && github.event_name == 'push'` do job
`deploy` do `ci.yml` transforma `push@[main, develop] ∪ pull_request@[main]` em
`push@[main]` — sem o estreitamento, um retrato que declara a condição LARGA
passaria verde sobre um job que só roda em `main`.

**O QUE SAI DA GRAMÁTICA É NOMEADO, NUNCA ADIVINHADO.** Função de STATUS
(`failure()`, `success()`), `startsWith`, contexto que o guard não conhece: se
aquele job for a contraparte de um passo, o guard sai **2** (`NÃO JULGÁVEL`)
nomeando o workflow, o job e a **expressão** — e o motivo é escrito. Sem isso, a
cláusula entraria (ou sairia) no escuro e o verde seria sobre um texto que
ninguém decidiu. Um evento da forja sem tradução (`release`, `tags`) também é
violação nomeada, não um gatilho presumido.

**A TRADUÇÃO (declarada UMA vez, no guard e no cabeçalho do retrato):**

| retrato (Woodpecker) | forja (Gitea/Forgejo Actions) |
| :------------------- | :---------------------------- |
| `push`               | `push`                        |
| `pull_request`       | `pull_request`                |
| `cron`               | `schedule`                    |
| `manual`             | `workflow_dispatch`           |

O `branch:` do retrato casa com o `branches:` da forja (e é o branch ALVO num
`pull_request`, como no Woodpecker); os dois eventos sem filtro de branch
(`cron`/`schedule` e `manual`/`workflow_dispatch`) são declarados **sem**
`branch:` — um branch ali seria uma restrição inventada.

**COMO UM PASSO ENCONTRA A SUA CONTRAPARTE (descoberta).** **(1)** pelo COMANDO:
o guard canonicaliza os dois lados — uma entrada do `package.json` que resolve
para UMA invocação vale pela invocação (`bun run check:registry-source` ≡
`node scripts/check-registry-source.mjs`, `bun run typecheck` ≡ `tsc --noEmit`),
e uma que é uma CADEIA de shell (`lint` = prettier + eslint) vale por si mesma.
O job da forja com a **maior** sobreposição é a contraparte; **empate** (o mesmo
comando em dois jobs — `check:registry-source` roda no `guards` do PR e no
`smoke`, que é só disparo manual) é AMBÍGUO e o passo precisa **declarar**.
**(2)** por MARCADOR, em comentário (o arquivo continua YAML válido para o
Woodpecker, que nunca lê comentário):
`# espelha: .gitea/workflows/deploy.yml#build` — e o alvo é conferido nos dois
sentidos: o arquivo existe, o job existe e, quando o job TEM comandos, ele roda
algum comando do passo (um marcador que aponta para o job que faz outro trabalho
é violação, não desempate). **(3)** SEM CONTRAPARTE, declarada com motivo:
`# fora da forja: <motivo>` — a classe `GITHUB_ONLY` desta régua, conferida no
lado conferível: um passo cujos comandos a forja RODA não pode se declarar fora
dela. **(4)** nada disso → VIOLAÇÃO: um passo novo não passa por omissão.

**O QUE MUDOU NO ARQUIVO (e o que ele NÃO dizia).** Das 15 condições declaradas,
14 são provadas contra os jobs da forja e **1 é declarada sem contraparte** (o
passo de notificação, que filtra por `status:` — a forja avisa por ISSUE, não
por passo de pipeline). Duas metades que o retrato **não dizia** apareceram na
medição: o cron do `required-checks-drift` também aceita **disparo manual**
(`workflow_dispatch`), e os três passos do deploy idem — o retrato declarava só
`cron`/`push a main`, isto é, descrevia uma pipeline mais estreita que a da
forja. As dez condições do CI (os guards, o typecheck, o teste e o build) estão
escritas passo a passo, cada uma com as **duas** cláusulas do `on:` do `ci.yml`.

**FAIL-CLOSED NA LEITURA.** Retrato ausente, ilegível, com byte inválido ou com
YAML que não faz parsing → **exit 2** NOMEADO (a mesma doutrina do resto do
repositório: _não conseguir julgar não é não haver nada a julgar_). A leitura
ESTRUTURAL usa o parser único (`parseYamlDocument`), porque a condição é
ESTRUTURA: uma segunda leitura linha-a-linha divergiria no dia em que o formato
mudasse.

**LIMITES DECLARADOS (cada um com o dono da cobrança).** **(a)** o CONJUNTO de
passos: a forja tem jobs que o retrato não tem (o `migrate` do `deploy.yml`, os
`bring-up-proof`/`pre-commit-in-runner-proof` do `ci.yml`) **e isso não é
julgado aqui** — esta régua julga as CONDIÇÕES de quem existe; a cobertura do
conjunto é outra régua; **(b)** `needs:` não é condição (dependência não é
gatilho); **(c)** o espelho do GitHub é do `check-forge-parity` (a régua é
contra a forja DONA DO MERGE); **(d)** `when` nos DOIS níveis (pipeline e passo)
é violação, não interseção implícita; **(e)** passo de plugin (`settings:`) não
tem comando: a contraparte dele só existe por marcador, e o guard DIZ isso no
relatório.

**Como testar.** `src/lib/__tests__/check-archived-pipeline.test.ts` — a
tradução (as cláusulas, o evento sem tradução, o `branch:` inventado, a chave
desconhecida, o `status:` lido à parte), a condição derivada (os gatilhos, o
`if:` que estreita, o `||` do `deploy.yml`, o `if:` fora da gramática, o branch
sem filtro INDECIDÍVEL), o casamento por comando (a canonicalização das duas
formas, o empate AMBÍGUO e o CONTROLE com o marcador), cada classe de mentira
com o seu CONTROLE na direção oposta (passo sem `when:`, condição divergente,
sem contraparte, marcador tipado, marcador para o job errado, `fora da forja`
sem motivo e contraditada pelo disco, `status:` sem declaração, `when` nos dois
níveis, chave de topo não classificada), o fail-closed (retrato ausente, YAML
inválido nos dois lados, `if:` fora da gramática com o CONTROLE do `if:`
entendido) e o **repositório real** — inclusive a MUTAÇÃO por fixture: trocar
**só** o `on:` do `ci.yml` real derruba o retrato real.
**Prova por mutação:** `scripts/test-mutation-archived-pipeline.sh` — seis
mutações (a EXIGÊNCIA de declarar, o ESTREITAMENTO do `if:`, a EXISTÊNCIA do
alvo do marcador, o MESMO trabalho do alvo, o fail-closed da leitura e o
desempate do casamento ambíguo), cada uma CEGANDO a sua classe com as vizinhas
seguindo vermelhas e o passo SÃO do fixture (o controle) imune em todas; o guard
é restaurado byte a byte por checksum.
**No CI:** job `guards` da forja e o job `workflow-refs-guard` do espelho
(`check:forge-parity` já o cobra como invariante do CORE nas duas pipelines).

**Família relacionada:** `check-bun-mirror` (invariante 19 — o VALOR da versão
no mesmo arquivo), `check-registry-source` (o host do registry nele),
`check-forge-parity` (a classificação obrigatória do gate novo) e
`check-pipefail-sigpipe`/`check-workflow-run-syntax` (os outros guards que
DERIVAM o que a pipeline executa, em vez de ler uma lista).

---

## 27. O corte do GitHub — `check:github-dependencies` (`scripts/check-github-dependencies.mjs`)

**O que protege:** o **inventário** do que o GitHub sustenta no repositório, como
**catraca**: nenhuma dependência nova entra sem a ETAPA do corte e o SUBSTITUTO
escritos, e nenhuma declaração pode envelhecer em silêncio. O plano narrativo
está em [`docs/GITHUB_CUT.md`](./GITHUB_CUT.md) e a tabela declarada em
`ci/github-dependencies.json`.

**Por que existe:** o projeto não usa tecnologia paga e a **forja dona do merge é
a Gitea** — o `check:forge-parity` exige o MESMO comando das 32 invariantes do
CORE nas duas pipelines. Mesmo assim o GitHub sustenta 27 workflows, 9 crons, 14
actions de terceiro, o GHCR como registry, o `gh` em 14 scripts, o **runner
auto-hospedado de todos os jobs** e 7 serviços que não portam por `git push`
(Dependabot, github-script, dependency-review, actionlint, artifact, runner, Gist).
O defeito que o guard fecha é o do dia seguinte: um PR que acrescenta um workflow,
um cron ou uma action AUMENTA o custo do corte sem ninguém decidir — e um
descarte (uma migration para o registry próprio, um cron migrado) que não
derruba o número junto deixa o inventário mentindo sobre o que ainda existe.

**O que mede (8 classes, das fontes do repositório):** `workflows`, `crons`
(`- cron:` derivado dos arquivos, com a expressão inteira), `marketplace-actions`
e `reusable-local` (os `uses:`, com a régua de comentário compartilhada — o
`- uses:` da lista e o `uses:` de bloco contam igual), `ghcr-images`
(ocorrências em CÓDIGO: `docs/`, testes e provas fora — **e a prosa do próprio
auditor também**, `ARQUIVOS_DO_AUDITOR`: o cabeçalho deste guard e o `porque` da
declaração _citam_ o padrão para explicar a classe, e contá-los subia o medido de
50 para 52 no próprio commit que declarou a classe — documentar a classe é editar
doc, não introduzir dependência), `gh-cli` (scripts +
hooks, com o `//` do JS e o `#` do shell), `actions-plane`
(`vars.`/`secrets.`/token) e `github-services` (presença de cada serviço por
regra própria).

**As duas direções são violação:** item medido que não está declarado é
dependência nova; item declarado que sumiu é **declaração envelhecida** (o corte
aconteceu e o inventário não acompanhou — `--update` no MESMO commit, como o
`runner-base:pin`). Classe medida sem declaração, ou declarada sem `estagio` ou
sem `substituto`, também reprova: é a porta pela qual um TIPO novo de dependência
entraria sem plano. O `--update` reescreve **só** o campo medido: classificar um
tipo novo de dependência é decisão humana.

**Onde roda:** invariante do **CORE** (`check:forge-parity`), job `guards` na
forja dona do merge e `workflow-refs-guard` no espelho — node-puro, sem
node_modules, `<0,5s` (mesma classe dos outros guards que leem o repositório). No
hook não entra: a decisão está escrita em `HOOK_NOT_RUN` (o hook já roda o
`check:forge-parity`, que é quem obriga a CLASSIFICAR um gate novo).

**Como testar:** `npx vitest run --config vitest.config.unit.ts
src/lib/__tests__/check-github-dependencies.test.ts` — a medição (comentário,
escopo de código, `gh` sem confundir `gist`, presença de serviço), as duas
direções da catraca, a classe sem etapa/substituto e o inventário REAL deste
repositório (o teste fica vermelho se a declaração divergir do medido).

**Prova por mutação:** `scripts/test-mutation-github-dependencies.sh` (sub-test
`github-deps` da matriz do master) — as **nove** metades da catraca, cada uma com
o defeito injetado no **dado versionado** (o CLI não aceita `--root`; o dado é
restaurado por checksum no fim de cada bloco): a comparação de **conjuntos** (o
item NOVO e o item SUMIDO), a do **contador** (`medido > declarado`), a
**nomeação** do item novo e a do delta (`(N a mais)`), o **escopo da contagem**
(o auditor que volta a contar a própria prosa infla o medido — 52 contra 50, `(2 a
mais)`) e os **três** fail-closed do dado — o AUSENTE, o ILEGÍVEL e o contador que
não é número. Cada mutação é
cirúrgica (1 ocorrência exata, marcador próprio e checksum mudado) e o CLI é
medido **antes e depois** dela: sem a comparação de conjuntos o item novo passa em
silêncio (exit 1 → 0); sem a nomeação o vermelho fica **genérico** (exit 1 dos
dois lados — só o texto muda); sem o fail-closed o dado ausente ou corrompido
**vira veredito** (exit 2 → 1, em vez de INDETERMINADO). A suíte unitária é a
segunda testemunha, e ela roda com o dado **já restaurado** — senão o vermelho
dela viria do defeito injetado, e não da mutação (a leitura falsa que uma prova
por mutação não pode ter).

**O ciclo de reconciliação (a dívida tem canal acionável):** a catraca sozinha
só deixa um run VERMELHO — e ninguém abre o log de um cron. O job
`github-dependencies-audit` (`.github/workflows/benchmark-weekly.yml`, semanal,
declarado em `ci/periodic-alerts.json` com o canal `issue`) roda
`scripts/github-dependencies-issue.mjs`, que remede o inventário pelo MESMO guard
e publica **uma issue por item novo** (label `github-dependency-new`): o corpo
carrega a CLASSE, a ETAPA do corte (id, título e entrega) e o DELTA (`(N a mais)`
no contador; o item nomeado na lista). A assinatura é por ITEM na lista e por
CLASSE+FAIXA no contador (um contador que cresce dentro da faixa é a mesma
dívida) — é ela que dá o dedup e o FECHAMENTO: quando o item sai do repositório
(cortado, ou absorvido pela declaração no mesmo commit), o publicador comenta a
prova e FECHA a issue; o ticket não fica para trás. Inventário ILEGÍVEL não fecha
nada — "não medido" não é evidência de resolvido. O doctor lê esta label como
dívida do board (`DEBT_SUBJECTS`, `crossCheck: "gate"`): ele executa o MESMO
guard nesta run, então a issue sai declarada CADUCADA quando o gate passa e VIVA
quando ele falha — e `null` (guards pulados por `--no-guards`/perfil `--ci`)
nunca vira "caducou".

**Família relacionada:** `check-forge-parity` (a paridade que o corte reduz a uma
forja), `check-registry-source` (a etapa 1 do corte) e `check-hook-ci-parity`
(que cobra a decisão do hook para o gate novo).

**Limite declarado:** o inventário mede o que um COMMIT pode criar ou remover.
O que o GitHub sustenta fora do repositório — issues, PRs, as repository
variables e secrets, as releases, o runner no VPS e os `refs/pull/*` do purge —
não é arquivo versionado e não aparece aqui.

---

## 28. As duas imagens no registry EMBUTIDO da forja — `gitea-registry:prove` (`scripts/prove-gitea-registry.mjs`)

**O buraco.** O Ato 1b do corte do GitHub (`docs/GITHUB_CUT.md` §3) publicou os
dois artefatos da etapa 1 e declarou, no mesmo parágrafo, o limite: _"a publicação
acima aconteceu num registry local"_. Um `registry:2` prova a MECÂNICA do OCI — e
deixa de fora exatamente o que o registry embutido da forja acrescenta: o **token**
(o `realm` do `/v2/` sai do `ROOT_URL`), o **pacote sob um dono**, e o **digest que
ELE serve** para a tag. Enquanto isso a etapa 1 promete outra coisa: as duas
imagens no registry OCI embutido da Gitea — que é o que o runner da forja e o
tier-3 do `setup-bun-ci.sh` consomem. Quem puxa, no fim, não é um registry de
teste: é o da forja.

**O QUE A PROVA MEDE (não narra).** Ela sobe a stack da forja **efêmera** (o MESMO
`deploy/docker-compose.gitea.yml` da produção, com nome de container, porta,
volumes e três chaves de `environment` próprios), publica os DOIS artefatos no
registry embutido daquele Gitea e os puxa de volta **pelo digest**:

1. o `/v2/` responde **401 com Bearer** e o `realm` aponta para o endereço
   EFÊMERO — o `docker login` do ensaio não sai para a produção;
2. o **token de pull** sai por basic auth do dono do pacote (o pacote nasce
   privado: o anônimo é recusado — medido);
3. o **digest do push** é lido por DOIS caminhos e os dois têm de concordar: a
   linha do push e o `RepoDigests` **filtrado pelo destino** (aquela lista é por
   repositório, e o índice 0 costuma ser de outro registry — medido);
4. a MESMA pergunta pela **API**: o `Docker-Content-Digest` da tag tem de ser o
   digest do push. Sem isso, "publiquei" seria o que o _docker_ disse, não o que o
   _registry_ serve;
5. os **blobs** estão lá: `HEAD` em todos (com o comprimento conferido contra o
   manifest) e o CONTEÚDO de dois baixado e **hasheado** (o config e a menor
   camada até o teto declarado de 64MB) — é esta metade que compensa o cache do
   daemon no pull-back, porque `untag` não apaga camada;
6. o **pull-back por digest**: a tag local é REMOVIDA antes, e o pull é feito por
   `<host>/<dono>/<imagem>@sha256:…`;
7. o **artefato**: o `bun --version` DENTRO do que voltou é a versão declarada, e a
   label `org.opencontainers.image.version` responde pelo mesmo valor. O mirror é
   `scratch`, então a evidência dele é a **extração** do `/bun` (o caminho do
   consumidor) — rodar a imagem inteira falha por desenho;
8. os **CONTROLES NEGATIVOS**: um digest inexistente e uma tag nunca publicada têm
   de FALHAR. Controle que passa é **violação**: sem ele, um pull que aceitasse
   qualquer coisa passaria por prova.

**DE ONDE VEM O QUE O ENSAIO SOBE (derivado, não uma segunda declaração).** O
compose é o comitado + um override GERADO que muda só o que precisa ser efêmero;
os alvos (dono, tag, registry) saem do **template** `deploy/env.gitea.example` —
sem `IMAGE_NAMESPACE`, `BUN_VERSION` ou `IMAGE_REGISTRY` o ensaio **não inventa
valor**: ele diz o que falta (exit 2). Cada desvio em relação à stack declarada sai
no relatório **com o valor de origem** — o `ROOT_URL` é o que decide para onde o
`docker login` vai, e mudá-lo em silêncio seria medir outra coisa. Os artefatos de
origem são ENTRADA (`--ubuntu-bun`/`--bun-mirror`; o ensaio não baixa imagem por
conta própria) e o mirror ausente é construído do `Dockerfile.bun-mirror` com o
binário do `oven/bun:<versão>` local.

**O ATO (executado, não prometido).** Aqui o ensaio rodou completo: **exit 0**, 37,5s,
52 passos verdes, num Gitea `gitea/gitea:1.22` efêmero (projeto
`prova-gitea-registry-…`, `/v2/` em `127.0.0.1:<porta sorteada>`, volumes
descartados no teardown):

| artefato      | destino no registry embutido    | digest servido pela TAG             | blobs               | evidência DENTRO do que voltou              |
| :------------ | :------------------------------ | :---------------------------------- | :------------------ | :------------------------------------------ |
| `ubuntu-bun`  | `…/severinno/ubuntu-bun:1.3.14` | `sha256:fd027ee77b52…` (índice OCI) | 9 (603649165 bytes) | `bun --version` → `1.3.14` · label `1.3.14` |
| mirror do Bun | `…/severinno/bun:1.3.14`        | `sha256:b79e21c5b0b1…` (índice OCI) | 2 (36607127 bytes)  | `/bun` extraído → `1.3.14`                  |

Os dois controles recusaram nas duas vezes (`digest-inexistente` → `not found`,
`tag-nunca-publicada` → falhou), e o teardown deixou **zero** container e volume:
num host cujo daemon recusa sinalizar container (o `docker rm -f` responde
`permission denied`), o ensaio reusa o teardown que fala de dentro
(`docker exec <c> kill 1`) e o que NÃO sai entra no relatório como resíduo — nunca
é presumido removido.

**O ACHADO QUE O ENSAIO TROUXE — e que está FECHADO.** `GITEA__registry__ENABLED`
não era declarado em lugar nenhum do repositório (nem no compose da forja, nem no
template), e o ensaio o ligava por OVERRIDE: o registry embutido da forja — o
substituto do GHCR da etapa 1 — dependia do default da série, e default não é
promessa escrita. Hoje a stack o **DECLARA** e o ensaio **não o sobrepõe mais**:

- `deploy/env.gitea.example` declara `GITEA__registry__ENABLED=true`;
- `deploy/docker-compose.gitea.yml` o CONSOME na forma
  `${GITEA__registry__ENABLED:-true}` — o MESMO valor como default;
- o `check:registry-source` cobra o par **por VALOR** (`checkComposeValueDefaults`,
  a mesma régua dos defaults de `IMAGE_REGISTRY`), nos dois sentidos: template sem
  a linha, compose que deixou de consumi-la (literal ignora o env do host) e
  default divergente do declarado;
- o `check:mirror-coverage` mede o espelho novo (`GITEA__registry__ENABLED` na
  tabela do `env-mirror`, cuja decisão de recorte é DERIVADA do par: sem regra no
  `--staged`, coberto pela varredura GLOBAL do guard dono);
- o **ensaio** virou o dono da EXIGÊNCIA: sem a declaração (ou com o registry
  desligado, ou com o default divergindo do declarado) ele PARA antes de subir a
  stack — e mede o render nos DOIS caminhos, com o env do host e sem a declaração
  (o default, que é o que vale no host cujo `.env.gitea` é mais velho que o
  template). Sobrepor o valor no override faria a prova passar por cima da
  declaração, que é exatamente o que ela tem de medir.

**O QUE NÃO COBRE** (o relatório imprime): a **VPS** (`git.severinno.cloud`) —
publicar lá e definir `IMAGE_REGISTRY`/`IMAGE_NAMESPACE` como repository variables
nas duas forjas seguem sendo os dois atos de OPERAÇÃO; TLS/Caddy, DNS e firewall (a
stack sobe só o serviço `gitea`, em HTTP no loopback); o **act_runner** (quem puxa
a imagem do job é o DAEMON do host, com a credencial DELE — o ensaio declara isso e
puxa com login explícito, o mesmo caminho de credencial); e a **visibilidade do
pacote** (o anônimo é recusado — medido; torná-lo público é decisão de operação). A
segurança de produção é fail-closed: nome de container ocupado por projeto alheio
ou a stack da forja RODANDO neste host fazem o ensaio parar ANTES de subir nada.

**Onde roda:** manual/operador (`bun run gitea-registry:prove`), em host com
docker. Sem docker ele é INDETERMINADO — nunca verde. O caminho `docker-ausente` é
cobrado a cada PR pelo `check:prove-docs`, que o EXECUTA com um `docker` de mentira
e cobra o INDETERMINADO que ele documenta ter aí.

<!-- prove-doc: gitea-registry:prove
     run: --json
     exit: 2
     cenario: docker-ausente
     desfecho: indeterminado
-->

```text
"verdict": "unavailable"
docker indisponível
```

---

## 29. O fecho de TLA das declarações do remédio — `check:tla-closure` + `tla-cycle:prove`

**A régua que existia só em PROSA.** O cabeçalho do loader das classes
(`scripts/remedy-classes.mjs`) e o do canal (`scripts/pr-fixers.mjs`) avisam, cada
um no seu parágrafo, que o módulo "usa top-level await" e que a descoberta é
assíncrona por natureza. O aviso está certo e é inútil do jeito que está: quem
escreve a linha que quebra o hook não é obrigado a ler o cabeçalho de um arquivo
que ele nem abriu. A regra escrita é: **nenhum módulo com TOP-LEVEL AWAIT pode
ser ALCANÇÁVEL a partir de uma declaração de classe (`remedy-classes/`) ou de
canal (`remedy-canal/`)**. O `check:tla-closure` a transforma em veredito.

**O fato medido, e é por isso que a régua existe.** O `await import()` do loader
espera a declaração; se a declaração (ou o fecho dela) alcança um módulo que
volta ao loader, o ciclo com `await` no meio trava a avaliação — e o `node` não
reclama: ele sai com **exit 13 e ZERO bytes** nos dois fluxos. O operador vê o
pre-commit falhar SEM a oferta do remédio e sem nenhuma causa impressa. Os dois
casos, medidos por execução (`tla-cycle:prove`, que copia a árvore e injeta a
aresta de volta na CÓPIA):

| o grafo                                                     | `node`                          | o guard    |
| :---------------------------------------------------------- | :------------------------------ | :--------- |
| árvore intacta (CONTROLE)                                   | rc=0, 0B                        | ✅ verde   |
| TLA alcançável **sem** aresta de volta                      | rc=0 — **não mata**             | ❌ recusa  |
| a declaração de CLASSE importa o loader das classes (CICLO) | **rc=13, stdout 0B, stderr 0B** | ❌ `CICLO` |
| a declaração de CANAL importa o loader do canal (CICLO)     | **rc=13, stdout 0B, stderr 0B** | ❌ `CICLO` |

**O CONSERVADORISMO É DELIBERADO, e está medido acima.** O que MATA é o ciclo;
mas a régua recusa os DOIS casos de TLA alcançado (com e sem volta) — é a forma
escrita na prosa, e a diferença entre eles é UMA aresta que ninguém revisa: a
próxima importação escrita DENTRO do módulo TLA fecha o ciclo, e quem paga é o
hook (não este commit). Recusar o caso conservador custa uma declaração datada;
deixar o fatal passar custa a oferta do remédio inteira, em silêncio. O veredito
NOMEIA qual dos dois é o caso (`CICLO · cadeia` ou `sem volta · cadeia`),
porque um vermelho que não distingue os dois ensina o operador a contornar o
guard.

**A dívida do repositório, datada e declarada.** Três pares já alcançam TLA
hoje — as declarações `hook-commands` e `run-syntax` chegam ao
`scripts/runner-shells.mjs` pelo guard dono (`check-hook-commands.mjs` →
`check-workflow-run-syntax.mjs`), cujo `await` é de ENTRADA (`if (IS_DIRECT_RUN)`)
e **não volta** ao loader —, e a classe `doc-hashes` alcança o **próprio guard
dono** (`check-doc-hashes.mjs`), que ela IMPORTA para o remédio ser o mesmo do
veredito: o `await` dele também é de entrada (`await confirma()`, atrás do
`IS_DIRECT_RUN`) e a carga da declaração não executa o CLI. Os três estão em
`ALCANCE_DECLARADO` com motivo e data,
e o guard confere os DOIS sentidos: um par declarado que deixou de existir é
violação ("dívida paga não fica no papel") e uma aresta nova de OUTRA declaração
é caso novo.

**A CATRACA (a segunda metade, e a que impede a régua de cegar em silêncio).**
Se nenhuma declaração alcançar TLA, a primeira metade tem ZERO achados — e uma
régua sem achado não prova que ela ainda VÊ. Por isso o conjunto de módulos com
TLA sob `scripts/` é DERIVADO a cada rodada (29 hoje: 25 `entrada-cli`, 2
`descoberta`, 2 `carga`) e classificado contra `TLA_CLASSES` nos dois sentidos:
um módulo TLA em forma NÃO declarada é violação, e um `declarados` que a régua
deixou de ver (a detecção cegou) também. Um TLA nasce de um `if (IS_DIRECT_RUN)
await main()` copiado; a forma padrão entra na classe derivada, e o que NÃO for
padrão é obrigado a ser declarado por nome, com o motivo.

**LIMITES DECLARADOS** (escritos no cabeçalho do guard, para não virar verde por
omissão): o grafo segue imports **ESTÁTICOS** (`import`, `export … from`);
`import()` dinâmico não é seguido (é preguiçoso por construção e o caso que
importa — o `await import()` da própria descoberta — está do outro lado); a
detecção de TLA é **LÉXICA**, sem parser (e é a catraca que denuncia um falso
negativo); só caminhos **RELATIVOS** são seguidos (um bare é folha: não pode
importar de volta um módulo do repositório); e um specifier que não resolve para
arquivo existente é CONTADO no relatório, nunca presumido.

**Onde roda.** O **guard** é o MESMO comando nos três lugares — `bun run
check:tla-closure`: a fase paralela do pre-commit (~1,1s medidos, ao lado do
`pipefail-sigpipe` e do `archived-pipeline`), o job `guards` da forja DONA DO
MERGE e o job `check` do espelho. Ele é do CORE nas duas forjas (`tla-closure`
em `check-forge-parity`), e não está em `HOOK_NOT_RUN` porque a decisão foi
RODAR local: o defeito muda por commit (uma linha numa declaração), e o hook
alcança o alcance antes do PR. **A prova** (`tla-cycle:prove`, ~6s: ela COPIA
`scripts/` duas vezes) roda nas duas forjas pelo contrato do `check:prove-docs`
— é ele que EXECUTA cada bloco `prove-doc` documentado, e o bloco do
`tla-cycle:prove` está logo abaixo. Ela **não** tem invariante própria no CORE
nem `HOOK_NOT_RUN`, e isso é a decisão: a régua do `doctor` recusa um `prove-*`
como comando de gate da bateria do dono do merge (`isVerificationCommand` — a
bateria roda por lista de argumentos, e um passo que o doctor recusa seria
decorativo no job), então uma invariante exigiria um JOB próprio nas duas forjas
só para hospedar o comando, com o mesmo veredito e mais superfície. O que muda
por commit é o ALCANCE, e esse o hook julga.

<!-- prove-doc: tla-cycle:prove
     run: --json
     exit: 0
     cenario: ambiente
     desfecho: provado
-->

```text
"ok": true
"nome": "ciclo-classe"
"nodeRc": 13
"stderrBytes": 0
"nome": "ciclo-canal"
"estado": "provado"
```

---

## 30. A citação de commit na prosa pertence à HISTÓRIA — `check:doc-hashes` (`scripts/check-doc-hashes.mjs`)

**A classe, medida em 22/09/2026.** A DOBRA da proveniência (levar o registro do
ato para dentro do commit que o carrega) reescreveu **12 commits** citados em
**12 arquivos** versionados. O assunto de cada commit ficou igual; o NOME mudou. E
nenhuma das **21 citações órfãs** falhava nada: um `git cat-file -e` continua
dizendo "existe" — o objeto antigo segue no repositório, segurado pelo reflog e
pelos branches antigos —, e o link quebrado só aparecia para quem tentasse abrir o
commit citado, um a um. A doc descrevia um ato que ninguém conseguia ler, com a
aparência de precisão de um hash.

**A régua (a prosa contra a história VIVA, não um catálogo de hashes).** Um token
`[0-9a-f]{7,40}` no escopo é CITAÇÃO DE COMMIT — salvo três casos, os três
DECLARADOS no guard:

1. **NÚMERO PURO.** Um commit não tem 7+ dígitos e zero letras; `pareceCommit`
   exige uma letra `a-f`. Sem isso, `86400000` (ms de um dia), `31536000` (um ano
   de cache) e `1581578731548` (timestamp) viram citação — são **78 falsos
   positivos** medidos no corpus em 22/09/2026;
2. **DIGEST de ARTEFATO** (`sha256:`/`sha512:`/`sha1:`/`md5:`): o
   `sha256:fd027ee7…` da imagem servida pelo registry descreve o ARTEFATO, não
   uma revisão;
3. as **NÃO-CITAÇÕES declaradas** (`abc1234`, `a1b2c3d`, `ed25519`): exemplos de
   FORMATO — mais o **head MORTO** da nota de auditoria de 26/09 (`e8419d5c`, a
   branch `feature/tres-classes-base` apagada): ele não pertence à história POR
   CONSTRUÇÃO, o MESMO patch vive em `30447a57` (que é ancestral, mas descreve
   outro commit) e o que a nota mede é o RUN `35990702155`, não um ato do
   repositório. Um literal novo aqui é DECISÃO com motivo — a lista não é uma
   allowlist de arquivo.

**Os dois defeitos são separados, porque o remédio difere.** `git cat-file` diz se
o token existe como commit; `merge-base --is-ancestor` diz se ele pertence à
história do HEAD. EXISTE e fora da história → **ÓRFÃO de rewrite**, e o guard
NOMEIA o commit de MESMO assunto que está na história — é o nome que a rewrite
deixou, e é o remédio exato para quem está editando a prosa. NÃO existe → hash
sem commit nenhum (typo, cópia truncada de outro identificador, prosa inventada).

**O escopo** são os diretórios que carregam prosa versionada: `README.md`,
`docs/`, `ci/`, `scripts/`, `.husky/` e os dois diretórios de workflow. Ficam FORA,
por construção: o `src/` (o TEXTO de um defeito é dado de prova — a mesma régua do
`check-github-dependencies`) e os arquivos de CÓDIGO/FIXTURE do `scripts/` (`.ts`:
id de seed em formato ObjectId, exemplo sintético de 24 hex). Duas EXCLUSÕES de
arquivo, com o motivo: a baseline de vazamento de segredo (o sha1 ali é
fingerprint de CONTEÚDO) e o cache do instrumento de medição (o `commitHash` é a
origem do ato e o arquivo é reescrito a cada medição). O **próprio auditor** não se
conta: o cabeçalho dele cita os nomes órfãos para DESCREVER a classe, e contá-lo
faría o guard reprovar a si mesmo pelo exemplo que explica a regra.

**A OUTRA METADE da prosa versionada: as MENSAGENS de commit.** O arquivo é
julgado sempre; a mensagem, nos commits que **nenhuma ref remota alcança** — a
prosa que a próxima rewrite ainda pode corrigir. A história já publicada fica fora
por DECISÃO, com dois motivos MEDIDOS: ela não tem remédio (reescrever um commit
publicado é reescrever a história de todos) e é onde mora o ruído de FORMA (as
mensagens de seed cujo assunto é um UUID — o último segmento de 12 hex é hex de
tamanho de commit e não é revisão nenhuma). **A classe, medida em 25/09/2026:** nos
34 commits fora do publicado de uma série, 8 citações no CORPO de mensagem, **7
delas órfãs** — cada uma descrevia numa linha o ato medido num commit que a
dobra havia renomeado ("o registro anterior (…) foi medido com a fatia no
ÍNDICE"), e TODOS os gates da árvore diziam verde: nenhum guard abre uma mensagem.

**O remédio da mensagem NÃO é o do arquivo.** Trocar o token de uma citação em
arquivo é um `--fix`; trocá-lo numa mensagem é reescrever a HISTÓRIA
(rebase/`--amend`). Por isso a órfã de mensagem sai **nomeada com o candidato vivo
de mesmo assunto** — o autor abre a linha, reescreve o commit — e entra nas
RECUSAS do remédio em vez de sumir: o `--fix` não a toca, e o relatório diz por
quê. E o nome vivo é escrito **COMPLETO** (40 hex), não no curto do `%h`: a régua
lê uma citação por FORMA (`[0-9a-f]{7,40}` com uma letra `a-f`), e um nome curto
pode sair SÓ de algarismos — **medido: 2 dos 6 nomes curtos** daquela passada
saíram sem nenhuma letra, e uma citação assim não é lida por guard nenhum (o
defeito que este trabalho fecha, de volta).

**Fail-closed.** git sem resposta, `HEAD` ilegível, arquivo do escopo que não abre
ou uma entrada declarada SEM motivo valem **exit 2** — "não consegui julgar"
nunca vira "está tudo na história". A CLI tem `--json` (o dado), `--all`
(as não-citações e os digests lidos) e `--root` (o fixture dos testes).

**O REMÉDIO MECÂNICO (`--fix`), porque o candidato não é palpite.** O guard já
NOMEIA o commit de MESMO assunto na história — o nome que a rewrite deixou —, e o
`--fix` faz exatamente essa troca: o token hex vira o nome vivo, na linha onde ele
está (duas citações do mesmo ato na mesma linha viram UMA troca; nada mais da linha
é tocado). É a mesma régua do resto do repositório em três pontos: (a) ele **pede
CONFIRMAÇÃO EXPLÍCITA** — a pergunta vai ao terminal de controle quando o stdin não
é um terminal (o `git commit` entrega o fd 0 em `/dev/null`), e sem terminal nenhum
NADA é autorizado: caminho à mão, commit bloqueado; (b) `--fix --dry-run` é a
PREVISÃO, o **PATCH exato** em STDOUT limpo (`… --fix --dry-run | git apply` aplica)
com o relatório em STDERR, e NADA é gravado — o mesmo patch que o publicador do PR
consome do módulo (`remedyPatch`), para o comentário não prometer um remendo que a
gravação recusaria; (c) o que ele **RECUSA** sai nomeado, nunca omitido: o órfão SEM
commit de mesmo assunto na história (o remédio não inventa um nome), o hash que não
existe como commit e o arquivo que a varredura não conseguiu ler — este último é
recusa, não "nada a remendar". O remédio vai à oferta do `pre-commit` (classe
`doc-hashes`), que é onde há operador para confirmar, e ao canal do PR (o fixer
`doc-hashes` do registro DESCOBERTO), que é onde o autor da mudança está.

**A prova do remédio** é `src/lib/__tests__/check-doc-hashes-remedy.test.ts`, sobre
o fixture compartilhado (`helpers/doc-hashes-fixture.ts`, um repo git de verdade
com a citação órfã): o patch APLICA com `git apply` e a prosa fica byte a byte igual
à do `--fix`; o preview não grava e o STDOUT carrega só o patch; o módulo publica o
MESMO patch que a CLI imprime; sem `--yes` e sem terminal a árvore fica intacta
(exit 1, com o caminho à mão na mensagem) e com `--yes` o remédio grava,
reestagia e REVALIDA com a mesma régua; o órfão sem candidato não é remendado e
não desaparece; e as duas pontas do mesmo remédio — a oferta (com antes/depois,
e o `semRemendo` quando não há candidato) e o comentário do PR (marcador, gate,
comando e o patch que aplica de verdade).

**Onde ele roda, e por quê.** O comando canônico (`node
scripts/check-doc-hashes.mjs`) é uma invariante do CORE nas **duas** pipelines
(job `guards` na forja dona do merge e `workflow-refs-guard` no espelho) e entra na
**bateria do `pre-commit`**: a outra metade da classe nasce no commit — um hash
que não existe (typo, cópia truncada) é escrito ali, e o remédio é do autor.
Custo MEDIDO da invocação no hook: **~0,9s** (97 citações em 416 arquivos do
escopo + as 8 citações nas mensagens dos 34 commits fora do publicado, medido em
25/09/2026), em paralelo com o resto da fase. A metade das MENSAGENS entra pelo
MESMO comando e no MESMO ponto do caminho: o escopo dela é exatamente o que o push
leva (os commits que o remoto não tem), então o defeito é medido antes de sair da
máquina — depois do push, aquela prosa deixa de ser reescrevível e sai do escopo.

**A prova por mutação** (`scripts/test-mutation-doc-hashes.sh`, o 39º sub-test do
master) mede **as NOVE metades** — cada uma com o CONTROLE antes (o fixture são
sai 0 e o defeito sai 1/2) e a direção do veredito depois:

- **M1** a regra da HISTÓRIA (o commit que existe e está fora dela);
- **M2** o NÚMERO PURO (o TTL volta a virar citação);
- **M3** o DIGEST de artefato;
- **M4** o fail-closed sem git (árvore que não é repositório);
- **M5** o auditor que não se conta (a prosa que descreve a classe cita órfãos);
- **M6** a extensão fora do escopo (o `.ts` de fixture);
- **M7** o PREVIEW do `--fix` (sem o `dry`, o `--dry-run` GRAVA e o patch que o
  comentário do PR publica passa a mentir sobre o que ele faria);
- **M8** a CONFIRMAÇÃO explícita (com ela inócua, o remédio se aplica sozinho: sem
  `--yes` e sem terminal a árvore muda — que é o que ela barra);
- **M9** a PROSA DA MENSAGEM (`commitsForaDoPublicado`): o README.md do fixture
  fica LIMPO de propósito e a citação órfã mora só no CORPO do commit — sem a
  varredura das mensagens, o veredito volta a 0 e o órfão passa em silêncio (o
  controle sai 1 e a metade cegada sai 0). É a única das nove que mede a metade
  que nenhuma outra alcança.

M7 e M8 medem uma direção diferente das sete primeiras: o veredito do guard NÃO
muda (o defeito continua acusado), o que muda é o **remendo** — e a régua do caso é
o CONTEÚDO da árvore (o `cksum` do arquivo antes/depois), não o exit code. O
fixture do remédio precisa do **par** (o commit citado e o de MESMO assunto que a
dobra deixou), que é o que a M1 não precisa: por isso a suíte tem os dois
construtores, e ambos garantem um hash cuja forma é uma CITAÇÃO (sem letra `a-f`
um hash de 7 dígitos não é citação, e o defeito do fixture desapareceria em ~2%
das execuções — medido: 2 falhas em 10 rodadas da suíte do remédio, com o guard
julgando `citacoes: 0` sobre um README.md que citava `2415416`).

Cada mutação é FAIL-CLOSED sobre si mesma: o marcador tem de existir UMA vez no
guard, o arquivo tem de MUDAR e o resultado tem de continuar parseável — uma
mutação que não muta é pior que nenhuma. O fixture é um repositório git de VERDADE
num `mktemp` (a régua é do git), e **nenhum arquivo do repositório real é tocado** —
e o guard COPIADO para lá leva o fecho de imports dele, **DERIVADO do grafo**
(`scripts/fecho-imports.mjs`): quem diz o que a cópia precisa é a aresta do
próprio guard — `confirm-prompt.mjs` e `unified-patch.mjs` (que o `--fix` trouxe) e
o formatador. A lista à mão que fazia esse papel envelheceu sem aviso e deixou a
cópia MORTA quando a aresta do gerado entrou (ver §3, "O FIXTURE QUE NÃO
CARREGA"): sem os vizinhos, a cópia morre com `ERR_MODULE_NOT_FOUND` e o exit 1 do
NODE passaria por veredito do guard.

**O guard pegou a própria suíte de mutação** — que citava o id de seed (12 hex)
no cabeçalho e no fixture da M6 —, e o desfecho NÃO foi declará-lo: uma declaração
imunizaria justamente a metade que a M6 muta (o filtro por EXTENSÃO deixaria de ser
load-bearing, e a mutação ficaria verde por um motivo que não é o dela). A suíte
monta o id em DUAS metades de 6 hex, e o fixture o recebe inteiro em tempo de
execução: o defeito continua medido e a suíte deixa de ser, ela mesma, uma citação.

---

## 31. O ESCOPO do lint cobre o que o HOOK julga — `check:lint-scope` (`scripts/check-lint-scope.mjs`)

**A classe, medida em 23/09/2026.** O hook julga **todo arquivo estagiado** (a
perna do `prettier --check` do `pre-commit`, antes do `lint-staged`) e o `bun run
lint` — o comando que as DUAS forjas rodam — julhava uma **lista à mão de 10
globs**. A consequência não é estética: um arquivo pode ser recusado pelo hook e
ACEITO no merge, porque as duas réguas veem escopos diferentes. O caso que expôs a
classe: o `ci/unproven.json` fora do padrão — `ci/` não estava na lista — saiu do
`bun run lint` VERDE, e quem o recusou foi o hook. Medido nesta árvore (2048
arquivos versionados): **13 diretórios** com arquivo que o prettier julga ficavam
fora da lista — `.gitea/` (as workflows da forja DONA DO MERGE), `ci/`, `deploy/`,
`e2e/`, `monitoring/`, `loadtest/`, `agent-ctx/`, `types/`, `config/`,
`examples/`, `k6/`, `mini-services/`, `public/`, `secrets/` — mais as extensões de
raiz `*.cjs`/`*.js` e o `.prettierrc` (que só o ORÁCULO do prettier encontra: o
nome dele não termina numa extensão que uma lista a mão adivinharia).

**O remédio não é acrescentar o diretório que faltou hoje** — é derivar a
pergunta, para o próximo diretório também a responder. O escopo do `lint` passou a
cobrir tudo o que o hook julga, e o guard DERIVA as três fontes, nenhuma à mão:

1. **os globs** do próprio script `lint` do `package.json` (o comando lido, não
   uma cópia — mover a régua para outro lugar não deixa o guard medindo um
   fantasma);
2. **os arquivos**: `git ls-files` na varredura global e
   `git diff --cached --name-only --diff-filter=ACMR` no recorte `--staged`;
3. **o que o prettier julga**: o ORÁCULO é o próprio prettier
   (`getFileInfo` → `inferredParser`, com o `ignored` do `.prettierignore`), e ele
   é consultado **só para os arquivos que nenhum glob cobre** — no estado são não
   há candidato, então o caminho comum custa um `git ls-files` (**0,14s** medido).

**A isenção é DECLARADA.** Um diretório que o prettier julga e que fica fora do
lint de propósito entra em `EXEMPT` com o motivo escrito (o desenho do
`check-forge-workflow-scope`), e a tabela é conferida nas DUAS direções: diretório
fora da lista sem isenção é violação, e isenção que não casa com arquivo nenhum é
**stale** — a declaração que ninguém revisa. A tabela está vazia de propósito:
hoje o lint cobre tudo o que o hook julga.

**A declaração de IGNORADOS é a outra metade do escopo — e é conferida.** O
`.prettierignore` estava em **UTF-16LE** (BOM `ff fe` + NUL entre os bytes): o
prettier o lê como UTF-8, todo padrão vira lixo binário e **nenhum dos três
ignores valia**. Um guard de escopo medindo contra uma declaração que não declara
nada mediria nada, então a forma ilegível é violação — e o arquivo foi reparado
(o artefato GERADO, `public/openapi.json`, passou a ser o ignore de verdade: quem
manda no formato dele é o `scripts/generate-openapi.ts`, com
`JSON.stringify(…, 2)` — 830 linhas diferentes do formato do prettier —, e
reformatá-lo sai do lint e volta vermelho na geração seguinte).

**O recorte `--staged` e o das duas metades.** O hook julga o **índice** (a árvore
pode carregar WIP que não é o commit): o diretório NOVO aparece em arquivo
estagiado. E a **declaração** que o commit move é lida **do índice**
(`git show :package.json`, `git show :.prettierignore`) — o conteúdo do commit —,
com o **recorte por RELEVÂNCIA**: mexer no escopo não abre buraco num arquivo do
commit, abre em TODO o repositório (um globo removido não está em arquivo
estagiado nenhum), então nesse caso o guard julga a **árvore**. É o mesmo desenho
do `check-required-checks --staged`.

**Os números que a extensão custou.** A perna do prettier passou de 26,1s para
27,7s (**+1,6s**, medidos na mesma máquina, mesma árvore) para cobrir 91 arquivos
em 13 diretórios e 2 extensões de raiz. Doze arquivos que a lista antiga escondia
ficaram em conformidade (formatação apenas: 7 `.md` do `agent-ctx/`, 2 `.spec.ts`
do `e2e/`, 2 `README.md`, 1 `.cjs`).

**A prova por mutação** (`scripts/test-mutation-lint-scope.sh`, o 40º sub-test do
master) mede **as SEIS metades**, cada uma com o CONTROLE antes (a
bancada sã sai 0 e o buraco sai 1) e a direção do veredito depois:

- **M1** o ORÁCULO (sem perguntar ao prettier, o PNG da bancada vira "julgado":
  falso positivo no são);
- **M2** a COBERTURA (com todo caminho coberto, o diretório novo desaparece do
  veredito — a cegueira exata do defeito);
- **M3** a DECLARAÇÃO de escopo (o `.prettierignore` ilegível passa em silêncio);
- **M4** o RECORTE `--staged` (lendo a árvore, um commit que não abre o buraco é
  bloqueado por ele);
- **M5** a ISENÇÃO ÓRFÃ (a tabela stale passa sem ninguém decidir);
- **M6** o RECORTE POR RELEVÂNCIA (mexer na declaração deixa de julgar a árvore e
  o globo removido no commit passa).

A bancada é um repositório git de FIXTURE num `mktemp` (o oráculo é o prettier
REAL, resolvido do `node_modules` do repo porque o import é do lugar do guard), e
nenhum arquivo do repositório é mutado: o que se injeta é a **régua** do guard, e a
restauração é conferida por `cksum` no `trap EXIT`.

**No hook e no CI.** O invariante `lint-scope` do CORE exige o comando nas DUAS
pipelines — ele roda no job do LINT (`lint` na Gitea, `lint-guard` no GitHub),
que é o único lugar onde a pergunta é sobre ESTE comando e onde o `bun install` já
aconteceu. No hook ele é o **7º** guard da fase A, com o recorte `--staged`
declarado no `check-hook-ci-parity`.

---

## 32. Nenhum módulo importa um nome que a ÁRVORE do commit ainda não exporta — `check:commit-import-exports` (`scripts/check-commit-import-exports.mjs`)

**A classe, medida em 26/09/2026.** Um commit que importa um nome que a PRÓPRIA
árvore dele ainda não exporta é um commit que **não carrega**: o topo da pilha
passa (o `export` entra num commit ACIMA) e o commit do MEIO quebra no `import`,
antes de qualquer asserção. O vermelho só aparecia quando alguém RE-MEDIA a pilha
commit a commit (`scripts/prove-stack-per-commit.mjs` — a série de 43 commits
acima de `30447a57` custa ~11 minutos), e o relatório dizia "o commit X reprovou"
sem dizer que a causa era um import sem export: era a classe que o re-stack
descobria por medição. O caso real desta árvore é o `8dd4f5e5`
(`scripts/pre-commit-proof.mjs`), que importa `{ BENCH_PATH }` de
`scripts/check-mutation-count.mjs` — e o alvo só passa a exportar `BENCH_PATH`
num commit ACIMA.

**A régua da série é a MESMA do prover (régua única):** `--base` → `GITHUB_BASE_REF`
→ `CI_MERGE_REQUEST_TARGET_BRANCH_NAME` (a env da forja dona do merge) →
`origin/main` → `main` local, com o recorte `merge-base(base, HEAD)..HEAD`; o
`--head`/`PILHA_HEAD` é resolvido por `git rev-parse --verify --quiet
'<ref>^{commit}'`. SEM base ou head resolvidos o guard sai **2** e diz o que
falta — fail-closed: um recorte chutado mediria a coisa errada, e o head da fila
declarada não pode ficar verde por um sha que não resolve.

**Medições desta árvore.** `--only HEAD` (varredura da árvore inteira): **0
violações**, 25 não-julgáveis (alvos com `export *`). A série `--base 30447a57`:
**43 commits, 1 violação — 0 novas —, 9 não-julgáveis**, em **4,2s** (antes: ~11
minutos de re-stack para descobrir o mesmo fato). A violação é a dívida
DECLARADA em `ci/commit-import-exports-baseline.json` (uma entrada, com o
motivo), PUBLICADA no relatório — nunca escondida. Duas catracas: violação que
não está na baseline reprova, e entrada da baseline que NÃO reproduz na série
medida reprova (dívida declarada que já não existe é dívida que ninguém apagou:
a lista não vira cemitério).

**A SÉRIE LARGA — a que o CI mede — tem a MESMA classe, e ela foi re-medida em
27/09/2026:** `origin/main..HEAD` são **195 commits, 12 violações — 0 novas — e
13 não-julgáveis**, e as 11 que não estavam na baseline vieram de TRÊS commits de
117 a 180 atrás (`f0650ba8`, oito nomes, todos no `forge-doctor`; `1f9ac5ee`, um;
`136735bb`, dois). Cada uma foi medida uma a uma — o alvo não exporta o nome NO
commit, o importador o importa, e o `export` entra de **1 a 3 commits ACIMA** — e
cada entrada da baseline nomeia em qual (é a mesma classe do `8dd4f5e5`; o que
muda é a base da série). A régua ESTREITA publicada acima media só a entrada do
`8dd4f5e5` porque a base dela (`30447a57`) começa depois desses três: a lição é
da régua, não do código — **o número de violações declaradas depende da base que
se mede**, e é a base do CI que manda. O remédio de verdade segue sendo a
reescrita (mover cada `export` para dentro do commit que o importa), decisão do
operador; até lá a dívida fica PUBLICADA, nunca escondida.

**O que o parser teve de fechar para a régua não mentir** (todas as classes
MEDIDAS na própria árvore, cada uma com o comentário no código):

- **strings e comentários** (`estadoDeComentario`): um `"/*"` ou um template com
  `*/` abria um bloco que nunca fechava e CEGAVA o resto do arquivo — medido em
  **209 falsos positivos** no topo, todos "o alvo não exporta o nome" (o topo
  compila); a linha que FECHA o bloco e carrega código depois
  (` */ export function f…`) conta dos DOIS lados (import e export);
- **a cláusula multilinha** (o prettier quebra listas) vale até **200 linhas** — o
  limite anterior truncava listas REAIS (a do `select.tsx`, a do `_shared.ts`);
  e uma cláusula que promete `from` e não fecha no limite vira **NÃO-JULGÁVEL
  declarada**, nunca ignorada;
- **`import type { X }`** não é default import: a palavra `type` sobrava como
  binding e virava um default exigido do alvo — o bug dos **209 falsos "default
  de X"**, e é a classe que a metade M3 da suíte de mutação conserva como
  CONTROLE;
- **a direção do `as` é o CONTRÁRIO nos dois sentidos**: em `import { run as
runCountGuard }` o alvo deve `run` (o apelido é LOCAL); em `export { x as y }`
  o publicado é `y` — o lado errado acusava o apelido dezenas de vezes. E no
  RE-EXPORT `export { activeTier as currentTier } from "./client"` quem é cobrado
  do alvo é `activeTier` (quem publica `currentTier` é o outro lado, lido pelo
  `parseExports`);
- **corpo não é cláusula**: `export const X = { … }` tem `{` no CORPO e não
  promete `from` — tratá-lo como cláusula declarou **3252 não-julgáveis falsos**
  nesta árvore;
- **`@typedef` do JSDoc publica TIPO**: é assim que `scripts/hook-simulator.mjs`
  serve `HookFile`/`StubSpec`/`RunResult`/`RepoOptions` ao helper tipado
  `src/lib/__tests__/helpers/hook-simulator.ts`;
- o specifier é resolvido com o mapeamento do mundo **NodeNext** (`./x.js` →
  `./x.ts`, medido em `scripts/geo-benchmark-real.mjs`), com `@/` → `src/`, e o
  alvo é provado **BLOB** (`git cat-file -t`) antes de ser lido como módulo —
  `git show rev:dir` devolve a LISTAGEM do diretório, e um diretório lido como
  módulo viraria "módulo sem o export".

**O que ele NÃO julga** (declarado, e o relatório CONTA cada um): alvo com
`export * from` é OPACO (import não-julgável); specifier externo (bare, `node:`,
subpath de pacote) não é árvore; alvo de ASSET (`.css`, `.json`, `.svg`, `.md`…)
não promete export nomeado; namespace e import de efeito só exigem que o módulo
exista; a invariante no PAI do primeiro commit da série é ASSUMIDA (o que já está
na base passou pela régua na época em que foi medido); e a classe ao CONTRÁRIO (o
commit TIRA um export que outro módulo importa) é julgada para os importadores que
o `git grep` acha — a busca é por specifier textual, então um import escrito de
forma exótica não é achado.

**A prova por mutação** (`scripts/test-mutation-commit-import-exports.sh`, o 43º e
último sub-test do master) declara 5 metades, e a mutação é do MUNDO — um repo git
de FIXTURE construído commit a commit num `mktemp`, não a régua do guard:

- **M1** o commit do MEIO da série: o import que só o commit de CIMA satisfaz
  deixa de reprovar — e o CONTROLE roda a MESMA série com o export no meio: o
  vermelho tem de vir da mutação, nunca de um fixture quebrado;
- **M2** a DIREÇÃO do `as` no re-export: o alvo passa a ser cobrado pelo nome
  PUBLICADO, não pelo de origem;
- **M3** o CONTROLE da classe: lista longa além do limite antigo, `@typedef` do
  JSDoc e `import type` viram falso positivo;
- **M4** a violação DECLARADA na baseline deixa de ser publicada como dívida e
  volta a reprovar;
- **M5** a entrada OBSOLETA da baseline (a que não reproduz) deixa de reprovar a
  catraca.

**Na forja e no CI.** O invariante `commit-import-exports` do CORE exige o comando
`node scripts/check-commit-import-exports.mjs` nas DUAS pipelines, no job
`stack-per-commit` — o mesmo que já mede cada commit da pilha SOZINHO — com
`env: PILHA_HEAD` apontando o sha REAL do PR (não o merge): é o mesmo head que o
prover da pilha mede, e é o commit do MEIO que esta régua existe para pegar. No
`package.json` o comando é `check:commit-import-exports`.

---

## 33. O GERADO sai DENTRO do lint — `check:generated-format` (`scripts/check-generated-format.mjs` + `scripts/prettier-format.mjs`)

**A classe, medida em 26/09/2026.** Um gerador montava o arquivo com
`JSON.stringify(dados, null, 2)` e o versionado NASCIA reprovando o `bun run
lint`: o prettier colapsa o que cabe na largura (um `"staged": ["a.sh",
"b.sh"]` vira UMA linha, um `runs: [1, 2, 3]` idem) e o `JSON.stringify`
expande TUDO. O caso real é o `scripts/bench-guard-timing.mjs`: ele gravou a
baseline assim, o HOOK
RECUSOU o commit e o remédio ficou local àquele arquivo. A medição que
dimensionou a classe: naquele dia TODOS os gerados versionados passavam no
prettier — mas QUASE NENHUM gerador usava o formatador. O produto estava certo
por sorte de largura; o CAMINHO que o produz é que reintroduz o defeito no
próximo `--update`, no `ms` a mais que não couber na linha, no dev que copiar o
idioma antigo.

**A régua é o formatador do PRÓPRIO repositório** (`scripts/prettier-format.mjs`):
`escreverFormatado(caminho, conteudo)` grava e formata NO LUGAR com o binário
pinado (`node_modules/.bin/prettier`, a versão lida do pacote — 3.9.6 hoje), e
`escreverJsonFormatado` é o atalho de JSON (`JSON.stringify(…, 2)` + a
formatação). Formatar PELO ARQUIVO (e não em memória) é decisão declarada: é
assim que o prettier resolve a MESMA configuração daquele caminho
(`.prettierrc`, o parser inferido pela extensão e as exclusões do
`.prettierignore`) que o `lint` usa — um `format()` em memória teria de
reconstruir essa decisão e uma reconstrução divergente gravaria um texto que o
lint reprova. Sem o binário o helper DIZ que não formatou (`motivo`,
`formatado: false`) — quem FALHA é o guard (fail-closed): nunca um verde por
dependência ausente. A CLI do helper é uma CONSULTA (publica onde o formatador
mora e a versão medida), e nada nela julga repositório.

**O guard mede TRÊS metades, e nenhuma é a leitura da intenção:**

1. **o ARTEFATO** (empírico): cada `saidas` da tabela é um arquivo VERSIONADO
   (`git ls-files`), coberto pelos globs do script `lint` (a régua do
   `check-lint-scope`, importada — não uma segunda cópia), NÃO ignorado pelo
   `.prettierignore` e SAINDO como o prettier o deixa (`--check` com o binário
   do repositório). `reescreve` cobre o gerador cujo alvo é um diretório/arquivo
   reescrito sem lista exata (o fixer de citações, o de comandos): o prefixo tem
   de estar coberto;
2. **o CAMINHO DE ESCRITA** (estrutural, e DITO como tal): quem declara saída
   passa pelo formatador, e cada chamada CRUA da fonte
   (`writeFileSync`/`appendFileSync`/`writeFile`) casa EXATAMENTE a lista
   `escritasCruas` da entrada (com o motivo) — escrita crua nova reprova e
   declaração que não existe mais é STALE. É a metade que pega o gerador NOVO
   antes de alguém regenerar o arquivo; o LIMITE é declarado (a forma do
   caminho, não o efeito — o efeito quem mede é a metade 1);
3. **a COBERTURA** (bidirecional): o conjunto de candidatos é DERIVADO da
   árvore — scripts `.mjs` versionados que gravam E citam caminho que existe
   como arquivo versionado. Candidato fora da tabela reprova (um gerador que
   ninguém declarou) e entrada que não declara saída E não é candidata é STALE.
   LIMITE declarado da derivação: ela vê o caminho LITERAL no próprio script —
   o gerador que recebe o destino de um módulo compartilhado entra na tabela
   pela DECLARAÇÃO, que é conferida contra a árvore.

**Estado medido desta árvore:** **34** geradores declarados, **13** saídas
versionadas e **27** candidatos derivados — todos cobertos (o verde publica os
três números).

**A fiação (o caminho de escrita de cada família).** Passaram a gravar pelo
helper: as BASELINES e os registros versionados (`check-bun-audit-baseline`,
`check-secret-leaks-baseline`, `check-jsdom-baseline`,
`check-readme-reverse-baseline`, `check-github-dependencies`,
`check-required-checks`); os BLOCOS DERIVADOS da doc (`check-encoding-guards-badge`
— o badge do README, `check-doc-hashes` — as citações reescritas,
`check-hook-commands` — o remendo dos comandos, `bench-table` — a tabela do
custo e a prosa derivada); os BENCHMARKS (`run-benchmark`, `search-benchmark`,
`cache-benchmark`, `geo-benchmark`, `geo-benchmark-real`,
`geo-pipeline-benchmark`, `measure-mutation-timing`) e o REGISTRO do ato
(`bench-guard-timing`, que originou o módulo).

**Na forja e no CI.** O invariante `generated-format` do CORE exige `node
scripts/check-generated-format.mjs` nas DUAS pipelines, no job do LINT (`lint`
na Gitea, `lint-guard` no GitHub) ao lado do `lint-scope`: é o único lugar onde
a pergunta é sobre o comando do lint e onde o `bun install` já aconteceu (o
guard precisa do binário do prettier). No `package.json` o comando é
`check:generated-format`. No hook ele é uma LACUNA DECLARADA (`HOOK_NOT_RUN`)
com o custo medido — **~4,4s** nesta árvore (13 saídas, uma invocação do
prettier por saída) —, e a metade que ele acrescentaria ao caminho de cada
commit é ESTRUTURAL (o caminho de escrita e a cobertura da tabela), não a
forma: um artefato fora do padrão o hook já recusa no estagiado — foi assim
que o defeito apareceu.

**A prova por mutação** (`scripts/test-mutation-generated-format.sh`) declara
SETE metades, cada uma nas DUAS direções: a bancada mutada com o guard INTACTO
tem de REPROVAR (exit 1) pela âncora da metade, e a MESMA bancada com a metade
CEGADA tem de PASSAR (exit 0) — a metade é load-bearing, não o fixture:

- **M1** o ARTEFATO fora da forma do prettier;
- **M2** o gerador que volta a gravar CRU (com a escrita declarada: a única
  regra em jogo é a do formatador);
- **M3** a saída declarada FORA do `git` (não versionada);
- **M4** o candidato NOVO fora da tabela;
- **M5** a entrada STALE;
- **M6** o `reescreve` fora dos globs do lint;
- **M7** o artefato no `.prettierignore` (a segunda metade do escopo).

A bancada é um repositório git de FIXTURE num `mktemp` (o prettier que mede e o
que escreve é o REAL, via symlink de `node_modules`), e nenhum arquivo do
repositório é mutado: o que se muta é o GUARD, com backup e restauração
conferida por checksum no `trap EXIT`. A suíte fecha com a INTEGRAÇÃO (o guard
real na árvore real, o MESMO comando do CI) e com a testemunha unitária
(`check-generated-format.test.ts`, 17 testes).

---

## Regra de ouro para guards novos

1. **Cabe numa família existente?** Se sim, estenda a família (com teste +
   mutation test) — não crie `check-foo.mjs` avulso.
2. **É uma família nova?** Atualize ESTE documento com o porquê, e atualize a
   tabela do README (o `check-hooks-symmetry` e o `check-encoding-guards-badge`
   FALHAM se a doc não bater com o código).
3. **Todo guard precisa de:** teste unitário + teste CLI (quando há exit code)
   - mutation test (quando o guard é de detecção). O `check-mutation-jobs`
     valida o último no CI.
4. **Todo guard novo precisa de um job** no pr-check.yml (o `check-mutation-jobs`
   falha se um `test-mutation-*.sh` não tiver job).
