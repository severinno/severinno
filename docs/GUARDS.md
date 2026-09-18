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
deixa passar — a última ponta da 18 no commit deixa de ser cega —, e (F) `M6`: as três metades da invariante 19 — a comparação por
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
`apply-required-checks` (`GITHUB_TOKEN`/`GH_TOKEN`, `GITHUB_API_URL`,
`GITHUB_REPOSITORY`) e exige permissão de self-hosted runners no repositório —
o `GITHUB_TOKEN` de um run NÃO a tem: sem token é **exit 3** ("não olhei"),
nunca "em sincronia".

A entrada se chama `runner-labels:check`, e NÃO `check:runner-labels`: um comando
sob `check:` é lido como gate PORTÁTIL (roda na bateria de qualquer checkout), e
este só tem sentido no host da forja — mesma família de
`runner-image:ensure/check/prove`. Onde ele roda e o que ele decide está no
exit code — **0** provado, **1** registro velho/vazio/runner ausente ou offline
(ou declaração sem labels), **3** não provado —, e o pior desfecho seria um verde
que não olhou nada. Para o GitHub a entrada é `runner-labels:check:github`
(`--forge github`), documentada em `deploy/GITHUB_RUNNER.md`.

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
  corta os **três fios do veredito**, um por vez, com uma mutação cada:
  **(A) violação→bloqueio** — troca o coletor `const blockers = []` DENTRO de
  `summarize` por um objeto com `push` no-op, o que neutraliza TODO
  `blockers.push(...)` de uma vez (é o mesmo fio: as seções só diferem no que
  empurram). O doctor continua rodando e imprimindo tudo — passa a dizer
  **PRONTA com a forja quebrada**, e nenhum fato acusa sozinho porque quem
  acusa é a SOMA. **(B) a honestidade do veredito** — o ternário do veredito
  deixa de consultar `unknowns.length`: o relatório segue LISTANDO cada fato não
  provado (gate que não executou, env ausente, prova indisponível, registro
  ilegível, protection sem token, dívida aberta no board) e o veredito passa a
  dizer PRONTA sobre o que o doctor **não conseguiu medir** — a falsa segurança
  que nenhum bloqueio errado iguala, porque "bloqueada" alguém investiga e
  "pronta" ninguém olha. **(C) o que o relatório NÃO cobre** — o retorno de
  `summarize` passa a devolver `unproven: []`: o veredito fica **intacto** de
  propósito (PRONTA segue PRONTA, BLOQUEADA segue BLOQUEADA) e só some a
  declaração do limite (a permissão do token, o smoke, o env de outro host, o
  socket do job, o recorte do `--ci` e cada seção pulada por flag).

  Para CADA fio a suíte tem de ficar **VERMELHA** com o âncora de CADA FATO
  falhando — os mesmos fatos, vistos dos dois lados: **13** violações
  (contrato de merge, guards, imagem ausente, prova do bloqueio, o gate do
  bring-up no contrato de merge, espelhos, referências não versionadas,
  contrato da imagem publicada, registro do act_runner, registro do runner do
  GitHub, interpolação do compose, branch protection registrada e o
  pré-requisito 0 do bring-up), **13** não-provados
  (o caminho honesto de cada uma dessas seções) e **10** limites declarados —,
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
passaria como detecção. Seis mutações, cada uma derivando uma regra:

| mutação | o que injeta na cópia                                             | o que o guard tem de dizer                                                 |
| :------ | :---------------------------------------------------------------- | :------------------------------------------------------------------------- |
| **A**   | gate novo **sem classificação** na forja (dona do merge)          | `NAO CLASSIFICADO`, nomeando o gate                                        |
| **B**   | gate novo **sem classificação** no espelho GitHub                 | `NAO CLASSIFICADO`                                                         |
| **C**   | gate `GITHUB_ONLY` **rodando** na forja                           | classificação **stale**                                                    |
| **D**   | invariante do CORE com o **comando canônico removido**            | `invariante do CORE 'X' NAO roda aqui` + a **linha esperada** e a pipeline |
| **E1**  | o mesmo invariante por invocação **indireta** (`bun run check:…`) | a **mesma** mensagem — e **não** `NAO CLASSIFICADO`                        |
| **E2**  | o comando canônico **sem o argumento** (`--pkg-internal`)         | idem, com a linha canônica **completa** no diagnóstico                     |

As duas últimas medem a **régua**, não a classificação: a forma divergente continua
casando o `matches` do invariante, então o gate sai classificado e quem reprova é o
`command`. O script **exige** que o veredito de E1/E2 não contenha `NAO CLASSIFICADO`
— se contivesse, a prova estaria pegando o defeito pela regra errada (e passaria a
provar a classificação enquanto diz medir a régua).

**Onde roda, e por que em job PRÓPRIO (fora do master):** job
`forge-parity-mutation` do `pr-check.yml`, com entrada em `ci/required-checks.json`.
Ela era um sub-test da matriz do master (**23 → 22** naquela medição); saiu porque é
a única prova do repositório cujo sujeito é o **contrato de merge em si** — quais
gates podem pular uma forja e com que forma de comando. Um vermelho dentro da matriz
diz "alguma mutação falhou"; como job próprio ela diz **qual** regra de classificação
quebrou, e vira check **com nome** no contrato de merge. Custo medido: ≈**0.33s**
(node-puro, sem docker, sem `node_modules`).

**Inventário:** `node scripts/check-forge-parity.mjs --gates` lista o que o
guard enxerga, com a classificação de cada gate — para a decisão ser revisável,
não um ato de fé.

**Gates que o guard promoveu do GitHub para a forja** (estavam só no espelho, e
não por serem específicos da plataforma): auditoria de dependências, baseline de
segredos, hooks de seed, sentinel producer, fonte única do Bun, proibição do
`oven-sh/setup-bun` e simetria de hooks.

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
dia em que a base mudar, o caminho é RE-MEDIR, não ajustar o número no olho. A
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

Sem allowlist: o repositório passa inteiro — **482 corpos** das duas forjas (e
todos os `shell:` declarados existem), **124 arquivos de shell** (121 `*.sh` + os
3 hooks do `.husky/`) **e 33 textos de shell embutido** (14 instruções `RUN` +
19 payloads de `sh -c`, com 2 indeterminados nomeados: os dois `bash -c "$cmd"`
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

**O pre-commit OFERECE esse remendo — quando o recorte `--staged` reprova o
commit, com confirmação explícita.** `scripts/pre-commit-run-syntax-remedy.mjs`
(o comando `LOCAL` declarado em `HOOK_DECLARED`) é o caminho pelo qual o operador
chega ao fixer NO MOMENTO em que a cicatriz aparece: sem ele, o hook reprovava o
commit e a correção era reescrever à mão exatamente a linha que a máquina remenda
— com a chance de introduzir um erro NOVO na mesma linha. A sequência é dita
ANTES da pergunta, porque é ela que o "sim" autoriza:

1. **PREVIEW** com o MESMO caminho de decisão do fixer (`fixAll` com `dry`): o que
   o preview promete é o que a gravação faz — uma régua paralela prometeria um remendo
   que a gravação recusaria. **Nada é gravado aqui** (e há teste medindo isso);
2. **sem cicatriz remendável ele NÃO pergunta** (uma pergunta cuja resposta não
   muda nada ensina o operador a responder sem ler): sai vermelho com o motivo da
   recusa por arquivo — inclusive para a classe que este fixer não toca (`shell:` que
   o runner não tem). Índice **verde** é o único caso em que ele sai 0 sem remendar;
3. **pergunta** (s/n; o default é o NÃO), dizendo os TRÊS efeitos: remenda a
   ÁRVORE, re-estagia (`git add`) os arquivos e **revalida o recorte `--staged`**;
4. **aplica, re-estagia SÓ o que não tinha modificação não estagiada ANTES do
   remendo** — num arquivo com WIP o `git add` levaria para dentro do commit
   trabalho que não é dele (o remendo fica na árvore e o operador é avisado para
   revisar);
5. **REVALIDA rodando o guard DE VERDADE** (`--staged`, em subprocesso): o
   veredito e o relatório finais são os do gate, não uma segunda implementação do
   veredito aqui. Quando o índice e a árvore divergem de linha, quem recusa é o
   próprio fixer (a linha do arquivo não é a do corpo) — o remédio não grava na
   linha errada nem com o índice deslocado.

**SEM TERMINAL não há pergunta** — o remédio **não** lê de um stdin que não é um
terminal (num hook ele pode ser um pipe, ou o terminal de outro processo: um
prompt ali trava o commit ou consome entrada que não é dele). Nesse caso ele
imprime a lista e o **caminho à mão** (`--fix` + o `git add` que leva o remendo ao
commit) e mantém o commit **bloqueado**, fail-closed. O fim do stdin (Ctrl-D)
resolve como **NÃO**, em vez de pendurar o commit esperando uma resposta que não
vem.

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
outros quatro da fase (o `wait_all` devolve o primeiro não-zero, e só o de sintaxe
tem remédio) e a pergunta vem depois de os cinco terem terminado — um prompt
competindo com quatro guards escrevendo é um prompt que ninguém lê.

**Por que um job PRÓPRIO no espelho:** o veredito do PR passa a ser um check com o
NOME do defeito. Antes ele era um passo dentro do `workflow-refs-guard`, que cobre
seis invariantes: um PR que quebrava um corpo `run:` derrubava um job que não diz
qual delas caiu. E, sendo job, ele entra no `ci/required-checks.json` — renomear
ou remover deixa de ser drift silencioso no contrato de merge. Na forja o
invariante continua sendo passo do `guards`, que é o gate único dela por desenho
(um runner, 40 guards); o que a paridade exige é o MESMO COMANDO, não a mesma
granularidade de job.

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
O **HOOK** tem prova por EXECUÇÃO, e não por leitura:
`src/lib/__tests__/pre-commit-run-syntax-blocks.test.ts` soma o `.husky/pre-commit`
REAL num repositório temporário com o defeito STAGED e exige o exit **VIOLATIONS**
(1) nomeando arquivo e linha — e o mesmo repo com o corpo são sai 0 **imprimindo a
manchete do guard no modo `--staged`** (é essa segunda metade que impede o falso
positivo: um hook que falhasse por "script não encontrado" também sairia não-zero).
O guard roda com o `node` real e o fecho transitivo copiado; o que é dublê está
DECLARADO (os irmãos de fase e o `bun` devolvem 0 — num repo temporário eles não
existem, e não são o assunto; e o desfecho do REMÉDIO é afirmável por um dublê,
`REMEDY_STUB`, porque no harness o stdin do hook é um pipe e o remédio real nunca
sai 0).
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
(`src/lib/__tests__/pre-push-git-push-blocks.test.ts`): um `git push` de verdade
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
Lighthouse são funções que devolvem 0 e 1. QUATRO mutações provam as metades:
deixar de CHAMAR o typecheck (o defeito é PUSHADO, e o conteúdo vermelho é lido no
ref do remoto), o `hooksPath` para outro diretório (o hook não é procurado), o
hook sem o modo 0755 (git o ignora em silêncio) e o dublê **deixando de liberar**
o processo real (a árvore vermelha passa e o payload nunca roda — é a passagem que
torna o veredito o do comando, não o de um dublê). ⚠️ **Achado medido, não
consertado aqui:** no fast path do smart-skip o typecheck roda como
`bun run typecheck 2>&1 | head -5` e, sem `pipefail`, o status da pipeline é o do
`head` — o não-zero dele é MASCARADO (medido na mutação M1: o payload reprova com
o rastro da invocação e o push entra); quem segura o push é só a linha da fase 2. O fecho copiado são os `.mjs` — e, com eles, o **`node_modules` real do
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
direções: com a cicatriz no índice e **sem terminal** (o stdin do hook é um pipe),
o hook sai 1, **não pergunta** e imprime o caminho à mão; e com o remédio
AFIRMADO como exit 0, o hook **levanta** a falha e o commit segue.

`src/lib/__tests__/pre-commit-run-syntax-remedy.test.ts` é a prova do REMÉDIO, com
o caminho INTERATIVO exercitado pela função (deps injetadas — num subprocesso o
stdin nunca é um terminal): "sim" com arquivo limpo remenda, re-estagia e revalida
o ÍNDICE (exit 0); "não" e resposta vazia não tocam em nada; sem cicatriz
remendável **não pergunta**; índice verde sai 0 sem remendar; WIP na árvore faz o
`git add` ser RETIDO (o WIP não sobe para o commit e a árvore fica remendada);
a árvore DESLOCADA faz o fixer recusar sozinho; e a CLI prova o contrato do exit
code (usage 3, infra 2, o `--help` e o **SEM TERMINAL**).
**Prova por mutação:** `scripts/test-mutation-workflow-run-syntax.sh` (roda NO
JOB, depois do gate real, e também como sub-test da matriz do master) tem DUAS
metades. (A) SENSIBILIDADE — o guard REAL reprova as fixtures de defeito e passa
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

**Prova por mutação:** `bash scripts/test-mutation-hook-ci-parity.sh` — sub-test
`hook-ci-parity` do master `mutation-guards`. Seis mutações, cada uma
exigindo a asserção da **própria regra** e medindo as irmãs (as linhas do
relatório não podem encolher: um guard que aborta cedo também "falha", só que
por não ter medido):

| Mutação | O que volta                                                                | Detecção                                                                             |
| ------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| A       | `bun run typecheck` → `bunx tsc --noEmit` nos dois hooks (a segunda régua) | **dupla**: o comando não é o do CI **E** o invariante `typecheck` fica sem cobertura |
| B       | comando novo no hook sem entrada em `HOOK_DECLARED`                        | 1 violação, nomeando o comando                                                       |
| C       | `why` de um recorte esvaziado                                              | 1 violação "SEM razão escrita"; o recorte segue reconhecido como o MESMO instrumento |
| D       | `match` de uma entrada que não casa com comando nenhum                     | 2 violações: a declaração **stale** e o comando que perdeu a decisão                 |
| E       | id removido de `HOOK_NOT_RUN`                                              | 1 violação: gate do CORE que não roda em lugar nenhum                                |
| F       | `HOOKS` aponta para um hook inexistente                                    | 1 violação (fail-closed: não se varre o que não se leu)                              |

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
wall time do doctor (perfil --ci), de CADA guard individual e do **custo das TRÊS
unificações de régua**: o lint, o typecheck (o comando inteiro, com o heap,
dentro do script) e a suíte de testes (`bun run test:run`, que INCLUI
`src/components/**`). Mede o tempo real de execução de cada gate da bateria
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

**Custo da unificação do lint — medido, não impresso:** desde `586b7c07` o
`lint` deixou de ser `eslint .` (sem prettier, sem teto de warnings) e passou a
ser o par completo (`bun run lint`), que as DUAS forjas invocam. Quatro call
sites passaram a pagar a metade que não pagavam — o `lint` da Gitea, o `lint` do
`ci.yml` do GitHub, o passo `Lint` do job `check` do `pr-check.yml` e o
`release-deploy`; o `lint-guard` do MESMO `pr-check.yml` já rodava o par inline
(era a única fonte da régua) e por isso não entra na conta. Medido em `586b7c07`
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
`f8d4ce7d` o `typecheck` é UM comando nas duas forjas e no veredito local: o
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
`f8d4ce7d` as duas forjas rodam `bun run test:run` (config do app, que INCLUI
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

**Medir em partes (máquina lenta / timeout de runner).** As duas famílias novas
medem comandos INTEIROS e uma rodada completa tem dezenas de minutos. Três
afirmações resolvem isso sem enfraquecer a procedência: `--only FAMÍLIA` mede só
aquelas famílias (e pula a bateria de guards+doctor); `--merge` HERDA do arquivo
o que esta rodada não mediu; e o que foi herdado vai para `meta.reused` com o
**commit e o timestamp de origem**, aparece nomeado no relatório e é **excluído do
veredito** — um número de outro momento não pode passar por "a medição de
agora", e é justamente o que um veredito otimista esconderia.

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
família que faltou (`bateria (guards+doctor)`, `lint`, `typecheck`, `suíte`) —
"medição incompleta" sem o nome transfere a investigação para quem lê a issue.
As famílias
typecheck e suíte medem **uma amostra por forma** (`samplesPerForm: 1`),
declarado: cada amostra é um comando inteiro. O `--samples` continua sendo o
controle da mediana das formas de lint, que rodam em segundos.

**O estado de cada família é EXPLÍCITO no JSON:** `counterfactual`
(`measured`/`not-measured`), `cold: true` + `cacheFile` na do typecheck, o exit
da régua sem heap (`legacyBareExit`) e o heap default do node
(`nodeHeapLimitMb`). Um campo `null` significa **não medido** — nunca zero, e
nunca um valor herdado sem a marca de procedência.

**A comparação das famílias novas é do COMANDO CANÔNICO**, não do delta: aqui
"regressão de tempo" significa "o gate ficou mais lento", e o contrafactual não
roda mais em pipeline nenhuma. (No lint a forma comparada continua sendo o custo
por rodada, que é o que a unificação acrescentou lá.) Uma suíte VERMELHA deixa a
família `unmeasured` — e a comparação inteira fica `measured: false`, o que
segura o fechamento automático da issue de tempo: se o gate que decide o merge
está vermelho, o tempo dele não é a pergunta.

**O que o doctor NÃO mede aqui:** o registro `DEBT_SUBJECTS` traz
`guard-timing-regression` com `crossCheck: null` — o doctor não cronometra os
gates (mediria esta máquina contra uma baseline de outra), então a issue de tempo
aparece na prontidão sem cruzamento de caducidade, e isso está dito lá.

**Usage:** `bun run bench:guard-timing` (mede) · `--no-lint` /
`--no-typecheck` / `--no-tests` (pula famílias) · `--only FAMÍLIA` (mede só
elas, sem a bateria) · `--counterfactual` (mede também a régua anterior da
suíte, ~7min) · `--merge` (herda do arquivo o que não foi medido, marcado e
fora do veredito) · `--samples N` (amostras por forma de lint; padrão 2) ·
`bun run bench:guard-timing:baseline` (salva baseline) ·
`bun run bench:guard-timing:compare` (compara) ·
`bun run bench:guard-timing:full` (salva + compara)

**Onde roda:** o job **`guard-timing-alert`** (`benchmark-weekly.yml`, semanal)
mede (`--json`, versionando o run em `guard-timing-latest.json`) e publica a
regressão como **issue** (`scripts/guard-timing-issue.mjs`). Manual:
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
`src/lib/__tests__/merge-latency.test.ts` (38 casos), com repositório SINTÉTICO
para injetar o defeito que o gate existe para pegar.

**Prova por mutação** (`scripts/test-mutation-merge-latency.sh`, sub-test
`merge-latency` do master): as QUATRO metades do gate são load-bearing, e cada
uma tem de ser vista por uma das duas testemunhas independentes — o **gate por
EXECUÇÃO** (`--check --root <fixture sintética>`, com um job do PR sem duração)
e a **suíte unitária**. M1 remove a DETECÇÃO da cobertura (`missing.push`) ⇒ o
gate sai 0 (cego) e a suíte fica vermelha; M2 fixa o EXIT CODE do `--check` em 0
⇒ o CI passa com o veredito INDETERMINADA; M3 troca o PAPEL do dono do merge ⇒
o gate deixa de recusar quem mergeia e passa a julgar o espelho; M4 lê o `if:` de
QUALQUER profundidade ⇒ o `if:` de um PASSO vira o do job, o espelho passa a
"poder ou não rodar" e o relatório dele recusa (exit 2) nomeando um `if:` que
não existe no job — a testemunha aqui é o RELATÓRIO do espelho, porque o gate do
dono já sai 2 por outro motivo e não distinguiria. Cada mutação é
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
seguir; e o estado REAL do runner (se a imagem embarca `node_modules`) fica
fora por construção — o guard lê o REPOSITÓRIO, e é exatamente por isso que a
isenção precisa de motivo: quem responde "de onde vem" é quem assina a
decisão.

**Onde roda:** passo `Job dependencies (install or declared exemption)` do job
`guards` nas DUAS forjas (`ci.yml` da Gitea e `pr-check.yml` do GitHub) — a
Gitea instala, o GitHub espelha, e a varredura cobre os jobs das duas (a
assimetria é justamente o que o gate torna mecânica). A revisão vencida roda no
job semanal. Mutation test: `scripts/test-mutation-job-deps.sh` (7 mutações — o
install que some, o `addedAt` que some, a leitura do grafo de imports, a regra
do sem-objeto e a escalada do `--review`), na matriz do master. Leitura
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
que ficou fora.

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
bloqueado), quando o **contrato da imagem PUBLICADA** não é executado pelo
artefato que o job baixa, ou quando a PROVA do bloqueio é violada
(a garantia da imagem é decorativa); `INDETERMINADA` quando nada falhou mas
algo não pôde ser provado (env ausente neste checkout, registry inacessível,
gate não executado, guards pulados por `--no-guards`, prova pulada por
branch protection não lida ou pulada por `--no-protection`,
interpolação pulada/não provada, o contrato publicado não provado (sem daemon,
sem credencial, pull negado) ou pulado por `--no-image-contract`, registro do
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
ganhou o perfil `--ci` (`CI_PROFILE_SKIPS`): ele DESLIGA as sete seções que um
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

**A HERANÇA DE SHELL DOS WORKFLOWS (seção 7/7): o que a prontidão passou a cobrar
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
rodando. O comando sobe um **Gitea efêmero** (docker), aplica o manifesto com o
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

**Tri-estado, como a família:** `proven` (a matriz bate e o applier está íntegro) ·
`violated` (o gate vermelho mergeou, o controle não mergeou, um caso não foi medido,
ou o applier não ligou a exigência) · `unavailable` (sem docker, imagem ausente,
API não subiu). O relatório humano e o `--json` têm o mesmo shape nos três.

**A regressão mais importante é travada por teste** (`prove-gitea-merge-gate.test.ts`,
26 casos herméticos com docker e API dublados): um applier que regride para o
payload sem o booleano sai **VIOLADO** — e não `unavailable`, que faria a regressão
parecer falta de medida. Os testes também fixam que `enable_status_check=false`,
com os contextos registrados, é tratado como drift pelo `--check`.

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

---

## 17. Jobs periódicos — todo alerta tem canal (`check:periodic-alerts`)

**O que protege:** que nenhum job de workflow AGENDADO termine VERDE por
DESENHO sem canal acionável. Um `::warning::` (ou um `continue-on-error`, ou um
guard que "só avisa") dentro de um run que passou é alerta **MUDO** — ninguém
abre o log de um cron verde. É o mesmo defeito que o repositório corrigiu sete
vezes (`actrc-sync-issue.mjs`, `readme-reverse-issue.mjs`,
`required-checks-drift-issue.mjs`, `forge-doctor-issue.mjs`,
`mutation-trend-issue.mjs`, `blob-crlf-scope-issue.mjs`,
`env-mirror-drift-issue.mjs`, `guard-timing-issue.mjs`) — mas a REGRA vivia na
cabeça de quem escreveu cada job, então o nono caso entraria em silêncio.

**A auditoria (30 jobs em 12 workflows agendados, duas forjas).** O que foi
encontrado e o desfecho de cada um:

| Canal       | Jobs                                                                                                                                                                                                                                                                                                                        | Por que                                                                                                            |
| :---------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------- |
| **`issue`** | `benchmark` (regressão PostGIS), `readme-reverse-audit`, `actrc-sync`, `mutation-coord-timing` + `mutation-coord-trend` (via `mutation-coord-alert`), `drift` (GitHub e Gitea), `doctor` (forja), `blob-crlf-all-text-alert`, `actrc-sync` (forja), `env-mirror-drift` (forja), `guard-timing-alert`, `runner-shells-drift` | o run fica verde de propósito (tendência/aviso não bloqueia); a issue é o canal, com dedup e fechamento automático |
| **`fail`**  | `smoke`, `setup-bun-warm`, `act-startup-bench`, `blob-crlf-history-audit`, `secret-leaks-audit`, `seed-guards`, `default-branch-workflow-guard`, `benchmark-all`, `benchmark` (GiST), `mirror` (×3), `guard` (tier-1)                                                                                                       | o sinal é violação de corretude/configuração: o run vermelho é a resposta certa                                    |

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
manifesto **falha** o guard, e o teste trava a contagem (**29**). Um cron novo no
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

### Os seis blocos

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

### `cenario: docker-ausente` — por que quatro blocos o declaram

Quatro provas da família exigem docker, imagem do runner ou um Gitea efêmero —
não são reproduzíveis num runner de PR. O guard **não finge** que são: ele as
EXECUTA com um `docker` de mentira (exit 127) no começo do PATH e exige o
desfecho `indeterminado` que elas declaram ter nesse cenário. A invariante
verificada é a que este repositório mais trata como regra: **ausência de prova
NUNCA vira sucesso**. Um comando que passe a sair `0` sem ter provado nada é pego
AQUI, de forma hermética e em ~1s. O caminho PROVADO dessas quatro exige docker e
é do operador (`bun run forge-runtime:prove`, `bun run smoke-render:prove`,
`bun run image-contract:prove`, `bun run merge-gate:prove`) — a doc de cada uma diz
o que ele exige.

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
- **o veredito não é texto.** Ele vem de `action_task.status` no banco do Gitea
  efêmero (1 = sucesso, 2 = falha; MEDIDO na série 1.22 — e todo outro código é
  "ainda não terminou", incluindo o 6, que aparece com o job rodando) e o log
  COMPLETO do job, que o Gitea guarda (`actions_log/<log_filename>`);
- **as expectativas vêm do arquivo.** O ensaio exige cada passo (`⭐ Run Main
<nome>`) e cada `echo "✅ …"` do smoke, e proíbe cada `echo "::error:: …"` —
  tudo truncado na primeira interpolação, porque é a parte literal que dá para
  exigir. Um `✅` novo passa a ser exigido sozinho; um passo que não rodou vira
  vermelho DIZENDO qual;
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
  1–4 ainda verdes.

**Desvios declarados (o relatório lista todos).** O gatilho acrescentado; a
sentinela (artefato do ensaio, não do repositório); o container do Gitea
renomeado; e — só com `--sem-no-new-privileges` — a stack do ensaio DIFERE da
produção em uma linha: `security_opt: no-new-privileges:true` do serviço
`runner`. A flag existe porque em hosts com confinamento do daemon (medido:
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
do GitHub — as duas pontas do CORE, classificadas no `check:forge-parity`. A
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
escalar no escopo do JOB → nenhum dos cinco guards a vê como passo, gate, ref ou
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

**O que NÃO promete (escopo declarado):** julga o COMANDO, não os argumentos de
ferramentas externas — um `find .next/static/chunks` cita um caminho que não
existe por DESENHO (artefato de build, gitignored), e julgar argumentos exigiria
uma allowlist de caminhos-que-não-existem (um guard que reclama de `.next/` é
desligado pela equipe). Dos argumentos só o que INVOCA algo é julgado.

**Runtime é DECISÃO, não silêncio:** o que não se prova por leitura
(`bash -c "$cmd"`, `node -e`, caminho em `$VAR`) tem de estar em
`INDETERMINATE` com `addedAt` + motivo; sem a entrada, é VIOLAÇÃO. As duas
listas (`ALLOWLIST` para o que existe fora do repositório — hoje o
`bunx @lhci/cli` do advisory do Lighthouse — e `INDETERMINATE` para o payload
inline — hoje o `python3 -c` do mesmo bloco) usam a data e a JANELA de revisão do
módulo compartilhado (`allowlist-review.mjs`, 180 dias): uma isenção sem revisão
vira violação nomeada em vez de permanente por esquecimento.

**Onde roda:** o pre-commit (fase paralela, node-puro e read-only, ~0,1s) e o CI
nas duas pontas do CORE — job `guards` da forja (dona do merge) e job
`workflow-refs-guard` do GitHub — classificados no `check:forge-parity` com o
MESMO literal de comando nas duas. O `post-checkout` também entra (a lista é lida
DO DIRETÓRIO: um hook novo é julgado sem ninguém lembrar de uma lista à mão); o
`.husky/_` fica fora (são shims do husky, não comandos nossos).

**Como é provado:** `src/lib/__tests__/check-hook-commands.test.ts` — cada classe
de violação tem um caso (caminho, entrada de `scripts`, entrada apontando para
arquivo removido, função ausente, `source` ausente, binário sem fornecedor,
payload não declarado) e cada um tem o CONTROLE na direção oposta (o mesmo
fixture sem o defeito sai verde), que é o que desmente um não-zero vindo do
FIXTURE. A régua de extração é medida separadamente (comentário, heredoc, quebra
de linha, `$( )`, `case`, função, continuação). E o repositório REAL é julgado com
um **PISO de cobertura** (`comandos >= 60` e os três hooks nomeados): se a
extração parar de funcionar, a contagem vai a zero e o guard "passa" — o piso é o
que impede o verde por vazio. Em produção: **92 comandos** em 3 hooks, 91
resolvidos e 1 indeterminado DECLARADO.

**Prova por mutação:** `scripts/test-mutation-hook-commands.sh` muta o próprio
guard em QUATRO direções, cada uma com duas testemunhas (o veredito do CLI sobre
uma fixture e a suíte unitária, que tem de ficar VERMELHA): três na direção de
CEGAR — `arquivoExiste` devolvendo sempre `true` (o caminho tipado passa), a
entrada de `scripts` ausente aceita (o `bun run tipecheck` que ninguém criou
passa) e o indeterminado devolvido sem olhar a lista (o payload de runtime não
declarado passa) — e UMA na direção OPOSTA: ignorar a regra da função do próprio
hook faz o guard ACUSAR O SÃO no hook real (`wait_all` do `pre-commit` vira
violação). Cada mutação é cirúrgica (as outras metades seguem reprovando), o
arquivo é restaurado por checksum e o total roda em ~6s. A regressão que
reintroduzir qualquer uma dessas quatro metades morre no job, não no hook de quem
commita.

**E o doctor EXECUTA a outra prova (a de ponta a ponta).** Este guard responde
"todo comando do hook RESOLVE?" — que é diferente de "o hook de fato BLOQUEIA o
commit defeituoso?". A segunda pergunta era respondida só pelo teste
`pre-commit-git-commit-blocks.test.ts` (um `git commit` de verdade, com o veredito
lido no objeto); ela agora é o fato `preCommitBlock` da seção 4/7 do relatório de
prontidão — o doctor roda o MESMO `proveCommitBlocks()` de
`scripts/pre-commit-proof.mjs` que o teste importa (régua única, dois
consumidores) e publica provado/violado/indisponível. Ver a §13.

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
