# Triagem do run 35922847378 — o job `Stack Per-Commit` que o runner levou no meio

A PERGUNTA: o job `Stack Per-Commit (cada commit sozinho)` reprovou. É **defeito real
dos commits** ou **artefato do runner que morreu no meio**? Medido localmente, com a
mesma régua, contra a mesma base.

A RESPOSTA, em uma linha: **o vermelho é real e reproduz byte a byte; o que o runner
levou foi o RELATÓRIO, 101 dos 146 commits — e a conta não fecha em nenhum dos dois
extremos.** Há ainda uma terceira coisa, que não é nem o commit nem o runner: o
próprio harness cobra de 13 commits um gate que nasceu DEPOIS deles.

---

## 1. O run (o que o log do job diz)

- `workflow_dispatch`, branch `feature/tres-classes-base` (PR #30). O topo medido foi
  o commit cujo assunto é:

  `chore(bench): o ato versiona a matriz de 41 sub-tests com a árvore COMITADA — a proveniência de cada forma fecha`

- **51 jobs: 48 cancelados, 2 falhas, 1 sucesso.** Os 48 ficaram enfileirados às
  21:30:23 e foram cancelados em 2026-09-24 às 11:02:34 — **13h32m depois, sem nunca
  pegar runner**. Só três jobs chegaram a rodar:

  | job                                      | duração | desfecho                                                                                 |
  | ---------------------------------------- | ------- | ---------------------------------------------------------------------------------------- |
  | `Blob CRLF history (zero-CRLF)`          | 10s     | ✅ verde                                                                                 |
  | `Seed Test Hooks Guard (no prod leak)`   | 8s      | ❌ exit 2 — **ambiente**: `js-yaml` não carregável ("este arquivo nao pode ser julgado") |
  | `Stack Per-Commit (cada commit sozinho)` | 7m17s   | ❌ o passo morreu por sinal                                                              |

- O passo `Cada commit da pilha, sozinho` termina em
  `##[error]The runner has received a shutdown signal` + `Process completed with exit code 143` — **143 é SIGTERM**. O prover **não chegou a imprimir o relatório**.
- O log carrega **45 linhas de commit** (`  ❌ <sha> vermelho`). Essas linhas são
  emitidas **a cada commit**, e só quando o prover roda **sem `--json`** (é a mesma
  razão de o relatório não existir: ele é impresso no fim, e o fim não chegou). A
  pilha tinha **146 commits**: o que se mediu foi o terço mais antigo.

## 2. A medição local (a mesma régua, até o fim)

Reproduzida a execução com o **prover do próprio topo medido** (a versão do script
mudou 365 linhas desde então — rodar a de hoje mediria outra coisa), a mesma base e o
mesmo head. A base foi conferida, não presumida: **o pai do commit mais antigo medido
é o `origin/main` local (`8a3710cd`), e a pilha tem os mesmos 146 commits**.

```
node scripts/prove-stack-per-commit.mjs --base origin/main --head <topo> --medir
```

|                    | o CI alcançou  | a medição local |
| ------------------ | -------------- | --------------- |
| commits medidos    | 45 de 146      | **146 de 146**  |
| verdes / vermelhos | 14 / 31        | **87 / 59**     |
| veredito           | (morreu antes) | **REPROVADA**   |
| custo              | 7m17s (morto)  | ~16 min         |

**Os 45 commits que o CI alcançou medir reproduzem EXATAMENTE: mesmo sha, mesmo
veredito, mesma ordem — 0 divergências.** O vermelho do job não é um falso vermelho.

O topo do branch **passa sozinho** (0 teste afetado). O vermelho nasce no MEIO da
pilha — que é, literalmente, o fato que este job existe para contar.

## 3. O que os 59 vermelhos SÃO

| classe                                      | quantos | o que é                                  |
| ------------------------------------------- | ------- | ---------------------------------------- |
| gate do `sempre` **presente e reprovando**  | **24**  | 19 `mutation-count`, 5 `forge-parity`    |
| `vitest` **reprovando** na árvore do commit | **22**  | falha de teste de verdade naquele commit |
| **gate AUSENTE na árvore**                  | **13**  | 9 `forge-parity`, 4 `script-headers`     |

As duas primeiras classes são medição de fato. Exemplos colhidos no relatório:

- `mutation-count` em `766dffb0`: `README.md:787: '15 sub-tests' ≠ 18 (ref viva divergente)` — a prosa derivada contra a matriz viva daquele commit, exatamente a classe de deriva que o gate existe para pegar;
- `vitest` em `f1bb5f44`: `issue-publish-github-board.test.ts:362` reprova (18,2s,
  40 arquivos medidos);
- `vitest` em `a6a8e511` não aparece: esse é da terceira classe.

### A terceira classe é o INSTRUMENTO, não o commit

Nos 13 casos, o que reprova é o harness pedindo uma conta que a árvore não tem como
pagar:

- `scripts/check-forge-parity.mjs` **nasce em `3d1b2e06`** (12/09/2026) — os commits
  anteriores a ele (9 vermelhos) antecipam o gate;
- `scripts/check-script-headers.mjs` **nasce em `563d65a8`** (13/09/2026) — 4
  vermelhos do mesmo tipo;
- e `3d1b2e06`, o commit que CRIA o `check-forge-parity.mjs`, é vermelho porque
  `check-script-headers.mjs` ainda não existia.

O mecanismo é chato e vale ser dito: o `CONJUNTO_SEMPRE` é uma **lista declarada**,
aplicada incondicionalmente. `node` existe na máquina e o arquivo não existe na
árvore, então o processo sai 1 com `MODULE_NOT_FOUND` — e o prover lê **exit 1 como
"vermelho"**. Ele já sabe tratar "não consegui medir" de outras formas (`node_modules`
ausente vira INDETERMINADO), mas não essa: **"o arquivo do gate não existe nesta
árvore" não é "a invariante foi violada"**. A resposta honesta para essas árvores é
INDETERMINADO — a mesma disciplina de "nunca verde por não saber", do outro lado.

Dos vermelhos que o CI **alcançou** medir, **12 são dessa classe** e 19 são medição de
fato. Isto é: da amostra que sobreviveu ao runner, quase 40% era do instrumento.

## 4. Veredito

1. **O vermelho do job não é artefato do runner.** Reproduz linha a linha; se o runner
   tivesse sobrevivido, o job sairia 1 do mesmo jeito.
2. **O que o runner levou foi o relatório e 101 dos 146 commits.** O job reprovou sem
   nomear o gate de NENHUM commit (o que nomeia é o relatório, que não foi impresso) e
   sem cobrir o resto da pilha. E o run inteiro é casco de infraestrutura: 48 de 51
   jobs nunca pegaram runner, e a outra falha também é de ambiente.
3. **13 dos 59 vermelhos são do harness**, não do commit (a seção 3). Isto não muda o
   veredito da pilha — ela continua REPROVADA por 46 medições de fato —, mas muda o que
   se pode concluir de cada linha vermelha.

## 5. O que fica aberto (não medido aqui)

- O prover **não sabe dizer quantos commits NÃO mediu** quando morre no meio: não há
  retomada nem checkpoint, e o vermelho do job não carrega o tamanho da própria
  cobertura. Um job que reprova em 45 de 146 lê igual a um que reprova em 146 de 146.
- O `CONJUNTO_SEMPRE` **não declara** (nem protege) o caso "o comando é mais novo que a
  árvore" — o limite 3 do cabeçalho do prover fala da bateria inteira, não deste.
  **(FECHADO no mesmo dia — ver a seção 7.)**
- O log do CI só tem as linhas por commit porque o job roda **sem `--json`**: a versão
  estruturada, com os motivos, é justamente o que se perde quando o processo é morto.

## 6. Fechado depois: o instrumento passou a medir a própria repetibilidade

A classe que a seção 3 mostrou do lado do HARNESS — o instrumento acusando o que não
pode julgar — reapareceu no mesmo dia do lado do VEREDITO: um flake de Docker/Gitea foi
publicado como "regressão" de um commit que, re-medido sozinho, saiu verde 4/4. Fechado
no mesmo dia, no prover: o vermelho passou a ser re-medido **uma vez**, e a segunda
tentativa é PUBLICADA — `tentativas` e `flaky` no `--json`, e `[2 tentativas: repetiu o veredito]` na
prosa (a linha por commit do streaming e a tabela do relatório). A régua é a REPETIÇÃO,
nunca a segunda tentativa sozinha: vermelho+vermelho é defeito do COMMIT, vermelho+verde
é INDETERMINADO (nunca verde por não saber), e o verde não é re-medido.

**A primeira medição da pilha INTEIRA com a régua nova já pegou um flake no ato** — de
uma classe diferente da que motivou a mudança (aquela era Docker/Gitea):

- `2d289f6d` — 1.ª tentativa vermelha em `vitest(3 arquivo(s))`, 2.ª **PASSOU** na MESMA
  árvore; publicado como **flake** (`indeterminado` + `flaky: true`), não como regressão;
- os **4 vermelhos de verdade REPETIRAM** (mesmo gate, mesma contagem de arquivos — o
  `motivo` diz `2ª tentativa REPETIU`) e seguem classificados como as dívidas declaradas
  `8dd4f5e5`, `98878d98`, `2604a370` e `0997cd4a`: **0 regressões**;
- o custo: 390s → **498s**. 33 dos 38 commits foram medidos UMA vez; só os 5 vermelhos
  foram re-medidos — o custo extra fica do lado do vermelho, como o cabeçalho declara.

Sem a re-medição, `2d289f6d` teria entrado como a 5.ª regressão da pilha — o mesmíssimo
carimbo falso que a seção 3 desta triagem mostrou do outro lado: o instrumento dizendo
"reprovou" quando não podia julgar.

## 7. Fechado depois: o gate que a árvore não carrega não reprova mais

A terceira classe da seção 3 (13 dos 59 vermelhos) era o harness cobrando de um commit um
gate que NASCEU DEPOIS dele: o `check-forge-parity.mjs` nasce em 12/09 e o
`check-script-headers.mjs` em 13/09, e um commit anterior a essa data não carrega o
arquivo — o `node` existe, o arquivo não, e o processo morre com `MODULE_NOT_FOUND` e exit
1, que o prover lia como "vermelho do commit".

Agora essa leitura tem nome: `gateAusente` mede o **alvo declarado do comando** (o
primeiro argumento que é um caminho de arquivo) contra a árvore do commit, e um alvo
ausente sai **INDETERMINADO com a razão nomeada** — "o gate não existe NESTA árvore
(`scripts/check-forge-parity.mjs` ausente do commit) — não medido, não reprovado". Três
detalhes da régua, todos medidos:

- a varredura **continua** depois de um ausente: um vermelho de verdade VENCE o "não
  consegui julgar" (um gate ausente não pode esconder o defeito de um gate presente);
- o alvo é a EXISTÊNCIA do arquivo, não o exit code: um comando sem alvo (`node -e 0`) não
  tem o que estar ausente, e o gate presente que reprova continua vermelho;
- o alvo ABSOLUTO (um `--sempre "node /tmp/x.mjs"`, fora da árvore medida) é resolvido
  contra a raiz — medido: com o `join` do worktree ele era lido como ausente e um gate
  que reprovava de verdade saía indeterminado.

**Prova por mutação (a 8.ª metade da suíte).** O fixture roda o TOPO — que passa sozinho —
com um `--sempre` que aponta para um script que a árvore dele não carrega:

| leitura                                        | veredito                                                             |
| ---------------------------------------------- | -------------------------------------------------------------------- |
| gate AUSENTE (a régua nova)                    | INDETERMINADO, exit 2, **zero vermelhos**, motivo nomeando o arquivo |
| gate PRESENTE que reprova (controle)           | **vermelho** (o ausente não amolece o que existe)                    |
| gate ausente com o classificador removido (M8) | **vermelho** — o commit acusado de um gate que ele não tem           |

Sem a metade, o vermelho do runner não mudava com a mutação; com ela, o veredito MUDA nos
dois sentidos, e é isso que a metade trava. Limite declarado: um gate que existe mas
importa um módulo que o commit ainda não tem continua vermelho — a ausência é medida no
alvo do comando, não no que ele importa (a classe vizinha pede a própria metade).

## 8. O achado do lado do ATO: o mestre de mutação mede UM tiro

Ao re-medi-lo (a coluna de metades é derivada da matriz, e a suíte da pilha ganhou a
8.ª metade), o `bench-guard-timing --only mutations` mostrou a mesma classe de defeito que
o prover da pilha tinha — **um tiro por sub-test, sem repetição**:

| execução | sub-test           | medido                                | ao rodar sozinho agora |
| -------- | ------------------ | ------------------------------------- | ---------------------- |
| 1.ª      | `pre-commit-proof` | exit 1 em **7,6s** (o normal é ~137s) | exit 0 em **135,8s**   |
| 2.ª      | `doc-hashes`       | exit 1 em **1,1s** (o normal é ~1,5s) | exit 0                 |     | 3.ª | —   | nenhum: só o `workflow-run-syntax` (exit 1) | (ele é vermelho também no HEAD, e a causa é a sujeira local do `.tmp/mineracao` — declarada) |

A 3.ª execução saiu limpa fora o vermelho pré-existente: os dois da 1.ª e da 2.ª eram
transientes. **O registro versionado ficou diferente do HEAD só onde ele tinha de ficar** —
a coluna de metades (derivada da matriz, 265, com 8 na forma da pilha) e os custos
re-medidos. O `check-mutation-count` volta a fechar.

Em duas execuções seguidas um sub-test DIFERENTE morreu cedo e entrou no registro
versionado como vermelho, com o custo do pedaço que rodou — e é o registro que alimenta a
tabela derivada do `docs/GUARDS.md` e o parágrafo de custo do README. O próprio ato já
avisa ("o custo deles não julga nada"), mas **avisa depois**: o número já está lá, e nada
re-mede.

O prover da pilha fecha essa lacuna do lado dele (a seção 6 e a seção 7 acima: o vermelho é
re-medido uma vez e a segunda tentativa é publicada). O mestre de mutação **não**: um
vermelho de sub-test é um tiro único, e as duas execuções acima são a medida de que isso
custa uma linha falsa no registro a cada rodada. O remédio é o mesmo, e o lugar é o
próprio mestre — a classe já está nomeada aqui.

## Como reproduzir

```
# o prover do próprio commit medido (a versão de hoje mede outra coisa)
git show <topo>:scripts/prove-stack-per-commit.mjs > /tmp/prover-do-topo.mjs
node /tmp/prover-do-topo.mjs --root "$PWD" --base origin/main --head <topo> --medir
```

Medido em 25/09/2026, no checkout de `feature/forja-gates-e-regua-unica-reduzido`.
