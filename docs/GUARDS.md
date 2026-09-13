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

**O valor, que o estático não alcança:** a variável tem espelhos no working
tree — `.actrc` (o act local não lê as variables do repositório) e o env da
forja: `deploy/env.gitea.example` (o template comitado) e `deploy/.env.gitea`
(o arquivo do HOST que o compose lê de verdade, gitignored — logo só existe no
checkout que roda a stack). O `check-actrc-sync` compara os VALORES de cada um
com `vars.BUN_VERSION` (a variável remota só existe em runtime, então nenhum
guard estático pode fazer isso) e DESCOBRE o env do host quando ele está
presente; um aviso que não nomeia QUAL arquivo drifta não é acionável.
Aqui os modos de falha são silenciosos: o `.actrc` desatualizado faz o act
testar outra versão, e o env desatualizado desliga o fast path de 0s do tier-1
da forja sem deixar o CI vermelho (o setup-bun funciona igual, só mais lento).

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

**Família relacionada:** `check-tier1-fastpath`, `check-tier2-cache-restore`
(performance do setup-bun — ver família 10).

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
uma — allowlist por prefixo de host esconderia a regressão.

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

## 4. README/docs guards — `check-readme-anchors`, `check-readme-toc`, `check-readme-images`, `check-readme-reverse-baseline`, `check-readme-repro-marker`

**O que protege:** links internos (#slug) resolvem, TOCs apontam para headings
reais, imagens existem, e o reverse (semântico) detecta label apontando para o
heading errado.

**Por que existe:** o README é a porta de entrada do repo; heading renomeado
sem atualizar o link = link morto silencioso. O guard roda o algoritmo do
GitHub slugger exato (sem depender de lib externa).

**Onde roda:** pre-commit (staged), pre-push, CI; `--reverse`/`--reverse-strict`
em job semanal com baseline (alerta, não gate de PR).

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
silêncio. `scripts/*.mjs` ficam FORA de
propósito: neles a mesma string aparece em prosa de mensagem de erro, e um guard
com falso positivo acaba desligado. O caminho de código real dos scripts honra
`process.env.IMAGE_REGISTRY`.

**A metade DINÂMICA (invariante 7): `docker compose config` no compose da
forja.** A varredura acima prova que a linha do label **referencia**
`${BUN_VERSION}`. Ela não prova o que a interpolação **resolve** — e os dois
modos de falha que sobram são invisíveis no texto:

| Defeito no compose                        | O que o texto parece         | O que o docker resolve                                                 |
| :---------------------------------------- | :--------------------------- | :--------------------------------------------------------------------- |
| `${BUN_VERSIO}` (typo / variável órfã)    | correto ("tem uma variável") | `ubuntu-bun:` — **tag vazia**; o runner registra imagem que não existe |
| `${BUN_VERSION:-1.4.0}` (default literal) | correto ("tem BUN_VERSION")  | `ubuntu-bun:1.4.0` — a variável **deixou** de ser fonte única          |

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
falham em vez de escolher uma precedência em silêncio.

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
`${BUN_VERSION:-1.4.0}` → exit 1 com "DEFAULT LITERAL"; `${BUN_VERSIO}` → exit 1
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

| Sintoma na forja                             | Guard que deveria pegar |
| :------------------------------------------- | :---------------------- |
| `BUN_VERSION: "1.4.0"` literal (2 workflows) | `check-bun-mirror`      |
| `oven-sh/setup-bun@v2` em 6 call sites       | `check-no-setup-bun`    |
| `check:ts-nocheck` ausente da pipeline       | _nenhum_                |

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
ensinar um `docker compose up -d runner` seco. O guard lê **linhas de comando**
(comentário que explica a ordem não a satisfaz) e o comando separa três estados
que se confundem: tag **existe** (puxável anônima), tag **ausente** (publica e
**reconfere** no registry) e **indeterminado** (registry inacessível, ou pacote
privado — 401 é a resposta do GHCR tanto para pacote privado quanto para pacote
inexistente). Indeterminado nunca publica: "não sei" não é "não existe".

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

## 7. Segredos — `audit-secret-leaks`, `check-secret-leaks-baseline`, `rotate-secrets`

**O que protege:** segredos NÃO entram no histórico (rotina de rotação);
QUALQUER achado NOVO falha o job semanal — o gate já cobre TODOS os de
severidade ALTA (chaves privadas, tokens sk-*), que era o pedido do parecer.

**Por que existe:** um segredo commitado uma vez fica no histórico para sempre
(filter-repo + rotação são operações deliberadas). O baseline documenta os 141
vazamentos conhecidos; o guard protege o FUTURO comparando por assinatura
(commit+file+line+id+key). NOTA (parecer 08/2026): a premissa "hoje gateia só
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

**Política completa (fluxo ao adicionar dep: use / remova / allowlist com
razão; allowlist de uso implícito; as 5 deps removidas no bump 0.4.0; as
limitações do scan):** veja a seção [Auditoria de dependências — política
ZERO-órfãs](../README.md#auditoria-de-dependências-política-zero-órfãs) —
fonte única, sem duplicação neste catálogo para não driftar.

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

**A trava que ele carrega (defeito real, cometido e corrigido):** o rótulo que
o descobridor devolve para uma invocação direta é só o CAMINHO —
`bun scripts/rotate-secrets.mjs --check` vira o rótulo `scripts/rotate-secrets.mjs`,
com a flag descartada. Executar o rótulo como comando rodaria o script na
modalidade de EFEITO (no caso do `rotate-secrets`, preparando uma rotação de
segredos como efeito colateral de um relatório). Por isso o doctor executa a
LINHA `run:` (que preserva as flags) e ainda exige um modo de verificação
(`--check`/`--ci`, entrada `check:`, ou script `check-`/`validate-`/`audit-`/
`test-mutation-`/`run-`) — sem isso ele NÃO executa, e diz por quê.

**A PROVA do bloqueio (seção 4/5 do relatório):** a seção da imagem dizia se a
tag existe AGORA — o que não responde "a subida da stack depende dela?", que é a
pergunta que importa. O doctor executa então `proveRunnerImageGate`
(`scripts/prove-runner-image-gate.mjs`, o mesmo que `runner-image:prove`): ele roda o
`deploy/gitea-up.sh` REAL contra um registry de TESTE em 127.0.0.1, com a tag
ausente e com a tag presente, e afirma sobre o LOG do `docker` dublê — com a tag
ausente NENHUM `compose up` acontece; com a tag presente, `up -d runner` sim. É o
CONTROLE que faz disso uma prova: sem ele, "o runner não subiu" seria satisfeito
por um script quebrado.

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

Uma prova VIOLADA bloqueia o veredito — é o caso mais grave da família, porque o
remédio não é publicar imagem nenhuma, é consertar a
subida. Sem `bash`/bring-up o estado é `unavailable` (INDETERMINADA), nunca
"provada"; `--no-proof` também rebaixa o veredito e é declarado no "NÃO cobre".

**AS DUAS METADES do contrato de merge (seção 1/5):** a seção 1 mostra, lado a
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

Três resultados, e eles não se confundem: **drift** (falta um check, sobra um, ou
o aplicador sinaliza drift sem nomear contexto) **BLOQUEIA**, nomeando a forja e
o remédio (`bun run ci:required-checks -- --apply`); **em sincronia** não muda o
veredito; **não lida** (sem token de administração, aplicador que não terminou,
forja ausente do relatório) é **INDETERMINADA** — nunca "em sincronia", que seria
a mentira otimista. O token precisa de permissão de **administração** no repo (o
`GITHUB_TOKEN` padrão não a tem), e é por isso que esse caso é estado próprio.\
`--no-protection` pula a leitura e rebaixa o veredito, declarando-se no "NÃO
cobre".

**AS REFERÊNCIAS NÃO VERSIONADAS, no veredito (seção 3/5):** o doctor transporta o
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

**OS ESPELHOS DA VERSÃO, contra o VALOR declarado (seção 5/5):** o doctor já
sabia que os espelhos do `BUN_VERSION` existem e concordam entre si — o que
**não** é a mesma pergunta que o guard periódico faz. Dois espelhos que
concordam entre si podem estar os **dois velhos** em relação à
`vars.BUN_VERSION`, e é exatamente assim que o tier-1 (fast path de 0s) desliga
na forja sem sintoma nenhum. Então o doctor aceita o valor por flag —
`--expected <versão>` — e compara com ele usando `mirrorDriftReport`, a **mesma
função** do `check-actrc-sync.mjs` (job semanal `actrc-sync`) e do publicador de
issue. Nada de uma segunda comparação: os avisos viajam no fato, no texto do
guard, para o log do doctor e a issue não poderem discordar.

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

**A INTERPOLAÇÃO do compose (na seção 3/5):** a seção da imagem responde "dá
para puxar a tag?". Ela não responde **"o compose PEDE a tag certa?"** — e é
isso que o runner registra no `/data/.runner`. O doctor chama
`checkComposeInterpolation` (o mesmo código da invariante 7 do
`check:registry-source`, uma fonte só) e mostra o veredito dessa renderização ao
lado do estado da imagem. Uma interpolação **VIOLADA bloqueia** (variável vazia
ou valor literal: com a tag existindo no registry, o runner puxa outra imagem);
sem docker/compose no ambiente o estado é `unavailable` → **INDETERMINADA**, e
`--no-compose-render` rebaixa o veredito do mesmo jeito que `--no-guards` e
`--no-proof`.

Junto vem a **outra metade (invariante 7b)**: `hostCompare` diz se o env do
**HOST** foi comparado com o template comitado (`in-sync` / `diverged` /
`absent`) e o relatório imprime as duas linhas. `diverged` bloqueia — é o VPS
interpolando outra coisa que o repositório declara. `absent` (o caso de todo
checkout que não seja o VPS) é reportado como **não provado**, nunca escondido:
quem aponta outro arquivo é `--gitea-env <caminho>`, que já existia para a
imagem e agora alimenta também esta comparação (uma flag, um env).

**OS REGISTROS DO RUNNER (na seção 3/5) — as DUAS forjas:** o doctor carrega o
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
lado na seção 3/5 justamente para isso: uma forja em sincronia e a outra não é
drift, e não pode ficar invisível.

**Três veredictos, e a diferença é o ponto:** `BLOQUEADA` quando uma invariante
falha, quando a imagem do runner está AUSENTE (sem imagem nenhum job inicia —
não é um gate vermelho, é a fila parada), quando a branch protection REGISTRADA
diverge do manifesto (o merge é bloqueado pelo motivo errado, ou não é
bloqueado) ou quando a PROVA do bloqueio é violada
(a garantia da imagem é decorativa); `INDETERMINADA` quando nada falhou mas
algo não pôde ser provado (env ausente neste checkout, registry inacessível,
gate não executado, guards pulados por `--no-guards`, prova pulada por
`--no-proof`, branch protection não lida ou pulada por `--no-protection`,
interpolação pulada/não provada, registro do act_runner **ou o do runner do
GitHub** não lido (este também quando falta token de self-hosted runners) ou
pulado por `--no-runner-labels`, ou prova não executável);
`PRONTA` só com tudo provado. O exit code é o veredicto (0/1/2), então ele serve
de gate de operação.

**O que ele NÃO cobre, e por isso está escrito no relatório:** o **valor de
`vars.BUN_VERSION`** quando `--expected` não é passado (a seção 5/5 diz isso na
primeira linha, e o veredito fica parcial — a existência dos espelhos não prova
o valor que o runner usa), a **PERMISSÃO do
token** sobre a forja (o doctor lê a protection COM o aplicador; sem token de
administração ele diz "não lida", e é essa a diferença entre "não consegui
olhar" e "está certo"), o smoke (tier-1 em
runtime é um job da própria forja), o `.env.gitea` de um host DIFERENTE deste
checkout (o do próprio checkout ele compara com o template — invariante 7b —, e
sem o arquivo a seção do compose diz que a comparação não aconteceu) e o render do
compose feito com o **docker do runner** da forja — aqui o render usa este
docker. O que faz aquele render funcionar está garantido em dois lugares: o
**build** da imagem do job exige o plugin `compose` (`Dockerfile.ubuntu-bun`, e
a `Verify mirror digest` do mirror confere na imagem PUBLICADA), e o **socket**
do job é exercitado pela Prova 4 do smoke, que exige o render
(`--require-compose`) em vez de aceitar o aviso.

**Onde roda:** manual/operador (`bun run doctor`), antes de confiar o merge à
forja e no runbook de deploy (`deploy/GITEA.md`). Fora do CI de propósito: ele
depende do registry e do env do host.

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
