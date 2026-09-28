#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-guards.sh — Mutation tests MASTER dos guards node-puro
#
# Roda os 47 mutation tests node-puro dos guards de CI num ÚNICO script com
# MATRIZ de sub-tests — o pr-check passa a rodar UM job só (mutation-guards)
# em vez de 5 jobs separados, reduzindo o overhead de setup por job
# (checkout + container por job) SEM perder a granularidade de diagnóstico:
# cada sub-test roda o seu script granular original (que imprime os STEPS
# detalhados de CONTROLE/MUTAÇÃO) e o harness reporta o verdict por sub-test
# + tabela final.
#
# Usage:
#   ./scripts/test-mutation-guards.sh                    # matriz completa
#   ./scripts/test-mutation-guards.sh --scenario readme  # 1 sub-test
#   ./scripts/test-mutation-guards.sh --list             # lista a matriz
#   ./scripts/test-mutation-guards.sh --json             # o CUSTO de cada sub-test
#
# Exit codes:
#   0 — todos os sub-tests passaram (mutações detectadas) ✅
#   1 — pelo menos um sub-test REPROVOU numa MEDIÇÃO depois de re-medido (guard
#       cego / asserção quebrada) ❌
#   2 — nenhum reprovou, mas ≥1 ficou INDETERMINADO — FLAKE 🌀 (a 1ª tentativa
#       reprovou e a re-medição PASSOU na MESMA árvore) ou INFRA 🚧 (nenhuma
#       tentativa MEDIU: ver abaixo) ◐
#   3 — uso inválido (--scenario com id desconhecido, flag desconhecida)
#
# A RE-MEDIÇÃO DO VERMELHO (a mesma disciplina do prover da pilha): um sub-test
# que sai vermelho é re-medido UMA vez antes de virar veredito. Um vermelho pode
# nascer do AMBIENTE — as suítes desta matriz sobem fixture, criam container e
# batem em porta/memória —, e publicar o 1º tiro como veredito acusa um defeito
# que não existe (o instrumento mente para o lado caro: manda consertar o que não
# quebrou). A régua é a REPETIÇÃO, nunca a 2ª tentativa sozinha:
#   · verde               → VERDE (o verde NÃO é re-medido: 1 tentativa);
#   · vermelho + vermelho → VERMELHO (o vermelho é da ÁRVORE — repetiu);
#   · vermelho + verde    → INDETERMINADO (`flake: true`): as duas se
#     CONTRADIZEM na mesma árvore — não vale verde nem vale reprovação, e o
#     exit 2 é o único que diz isso (um 1 aqui seria uma regressão inventada);
#   · vermelho + tentativa que nem rodou (exit 126/127) → VERMELHO: a 2ª não
#     contradisse a 1ª.
#
# O QUE **NÃO** É MEDIÇÃO — a classe INFRA 🚧. Um `exit 2` de suíte é o INFRA que
# o CABEÇALHO dela declara: ela NÃO conseguiu medir e saiu fail-closed (`git`/
# `node`/`python3` ausentes do PATH, o checkout compartilhado contendido, a
# bancada que não monta). 126/127 é a tentativa que nem rodou. A tentativa que não
# mediu NÃO é vermelho (não houve medição que reprovasse) e NÃO é verde (não houve
# medição que aprovasse) — e o veredito segue as tentativas que MEDIRAM:
#   · nenhuma mediu             → INFRA (exit 2, `infra: true`): NÃO é defeito da
#     árvore, e a prosa não pode dizer "o vermelho repetiu" sobre um tiro que
#     nunca foi disparado — é a acusação ao que não foi medido, e ela manda
#     consertar o que não quebrou;
#   · uma mediu (verde)         → VERDE, com `tentativas: 2` e o `exit1`/`exit2`
#     publicando QUAL tentativa não mediu (o `flake` NÃO acende: não houve
#     contradição, houve ausência);
#   · uma mediu (vermelho)      → VERMELHO pela tentativa que MEDIU, e a prosa diz
#     que a outra NÃO MEDIU (nunca que "repetiu").
# O que foi MEDIDO/RE-MEDIDO é DITO nos dois lugares: no `--json` cada sub-test
# leva `tentativas`, `exit1`, `exit2`, `ms1`, `ms2`, `flake` e `infra` — e o `ms`
# publicado é a SOMA das tentativas, porque o custo do job é o que ele pagou —, e
# o log marca o flake com 🌀 e a não-medição com 🚧, com `Flaky: N` e `Infra: N`
# no resumo.
#
# O CUSTO DE CADA SUB-TEST (`--json`): o modo máquina mede o wall time de CADA
# sub-test e do TOTAL, junto com os sub-tests que falharam, os que ficaram
# INDETERMINADOS (FLAKES 🌀 ou INFRA 🚧) e as TENTATIVAS de cada um (1 ou 2, pela
# re-medição).
# Ele existe para o
# custo do job `mutation-guards` não ser composto à mão: quem entra com um
# sub-test novo (ou paga o job no modelo de latência) lê o custo MEDIDO, com o
# id de quem o pagou. O stdout é SÓ o JSON — toda a saída humana vai para o
# stderr, então `--json | jq` funciona sem filtrar as 32 tabelas.
#
# A MATRIZ É DERIVADA — e por isso não há prosa de sub-test para envelhecer:
# cada entrada traz `id|script`, e a DESCRIÇÃO sai do bloco `METADES=(...)` do
# PRÓPRIO script granular (o dono diz o que cada metade dele tira do lugar).
# `--list` imprime a matriz inteira com a descrição derivada; o sub-test que não
# declara metade nenhuma FALHA aqui, e o `check-mutation-count` recusa o mesmo
# caso no PR (uma régua só, a de `scripts/metades.mjs`). Acrescentar uma mutação
# = uma linha no bloco da suíte (a descrição se atualiza sozinha nos dois lugares).
# Cada script granular é a FONTE ÚNICA do seu cenário (sem duplicação de
# fixtures/mutações/asserções — o harness só orquestra). TODOS os sub-tests
# rodam mesmo se um falhar (fail-CONTINUE, não fail-fast) — o exit final é
# agregado: 0 se TODOS passarem, 1 se QUALQUER um reprovar (a re-medição do
# cabeçalho decide isso), 2 se nenhum reprovou e algum ficou INDETERMINADO.
#
# O SCRATCH DAS FIXTURES É ESTÁVEL E FORA DO `/tmp` — e FORA DO REPOSITÓRIO.
#
# O DEFEITO MEDIDO (28/09/2026): o `/tmp` é limpo por FORA do repositório e a
# rodada LONGA é a que paga — duas passadas desta matriz caíram com fixture
# SUMIDA no meio da medição (o diretório da bancada deixou de existir entre dois
# passos da MESMA suíte), e cada suíte acusada passa sozinha. Cada suíte cria o
# fixture root em `$MUT_SCRATCH` (`mktemp -d "$MUT_SCRATCH/mut-XXXXXX"`, a MESMA
# raiz para rodada e suíte), e cada RODADA do master cria a sua PRÓPRIA raiz
# DENTRO da base (`run-XXXXXX`): o master NUNCA esvazia a base. Esvaziar era o
# desenho anterior, e ele REINTRODUZIA o mesmo defeito por outra porta — MEDIDO:
# com a base compartilhada, um segundo master (e há TESTES UNITÁRIOS que sobem o
# master de verdade, na cópia do ensaio) apagou o fixture de um sub-test EM VOO, e
# o guard real acusou `--root inexistente: .../mut-mZHkzn/fx`, deixando a matriz
# com um vermelho que não é da árvore. A sobra de uma rodada MORTA (kill, timeout
# do CI) é podada por IDADE — `-mtime +0` —, nunca no meio de uma medição viva.
#
# POR QUE A RAIZ NÃO É DENTRO DO REPO — MEDIDO, e é o que faz este parágrafo
# existir: uma fixture dentro da árvore deixa de ser um pedaço de FORA do projeto
# e passa a ser alcançada por ele. `no-leaked-imports` mede um worktree ANINHADO
# (e passou a achar o `node_modules` DESTE repo), `lint-guard` mede o
# prettier/eslint DO PROJETO sobre um arquivo de fixture, e `registry-defaults`
# roda o guard real sobre a árvore real — que passou a ler fixture de outra suíte
# como artefato versionado: as TRÊS ficaram vermelhas, e as três voltam verdes com
# a raiz fora. O corte de escopo dos guards (`scriptsDoRepositorio`) também trata
# o que o `.gitignore` declara local como NÃO sendo do repositório — a fixture
# sumiria do escopo —, e o `.tmp/` do repo é declarado scratch de SESSÃO: outra
# sessão pode limpá-lo, que é o Mesmo defeito de novo. O `GIT_CEILING_DIRECTORIES`
# consertaria só as fixtures "sem repositório" (a classe dos controles de
# `doc-hashes` e `act-origin`), nunca as de cima.
#
# A raiz BASE é `${XDG_CACHE_HOME:-$HOME/.cache}/severinno-mutacao`: estável e
# a fixture segue sendo uma árvore de FORA — nenhum guard, nenhum `node_modules`
# e nenhum prettier do projeto a alcança. O master cria a raiz DA RODADA dentro
# dela e é ELA que as suítes herdam (o `MUT_SCRATCH` exportado), com a rodada
# limpando SÓ o que é dela (trap EXIT): sem essa separação, uma rodada qualquer
# apaga a fixture da outra, e o vermelho que sobra é do instrumento. Um
# `MUT_SCRATCH` explícito no ambiente continua vencendo (a suíte que roda
# sozinha usa ele direto); se a raiz não puder ser criada, a suíte sai 2 (INFRA
# declarada) em vez de um vermelho inventado.
# =============================================================================

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# ── O SCRATCH DAS FIXTURES (o motivo inteiro está no cabeçalho) ────────────
# A raiz BASE é ESTÁVEL, fora do `/tmp` (que é limpo por fora) e fora do
# repositório (uma fixture dentro dele muda de semântica). Cada RODADA cria a sua
# PRÓPRIA raiz dentro da base, e é ELA que as suítes herdam pelo `MUT_SCRATCH`
# (exportado): o master apaga só o que é da sua rodada, no trap EXIT — um
# `rm -rf` da BASE apagaria as fixtures de outra rodada em andamento (medido:
# `--root inexistente` num sub-test em voo, com a base compartilhada). A sobra de
# uma rodada MORTA é podada por IDADE, nunca por varredura cega.
MUT_SCRATCH="${MUT_SCRATCH:-${XDG_CACHE_HOME:-${HOME:-}/.cache}/severinno-mutacao}"
case "$MUT_SCRATCH" in
  / | "" | "${HOME:-}" | "$SCRIPT_DIR")
    echo "❌ MUT_SCRATCH aponta para um diretório que não pode ser a raiz do scratch: $MUT_SCRATCH (infra declarada)" >&2
    exit 2
    ;;
esac
if ! mkdir -p "$MUT_SCRATCH" 2>/dev/null; then
  echo "❌ o scratch das fixtures não pôde ser criado: $MUT_SCRATCH (infra declarada)" >&2
  exit 2
fi
# A poda é por IDADE: `-mtime +0` exige mais de 24h, então nenhuma rodada VIVA
# (nem a de outro job no mesmo host) perde fixture por causa dela.
find "$MUT_SCRATCH" -mindepth 1 -maxdepth 1 -mtime +0 -exec rm -rf {} + 2>/dev/null || true
MUT_SCRATCH_RUN="$(mktemp -d "$MUT_SCRATCH/run-XXXXXX")" || {
  echo "❌ a raiz DESTA rodada não pôde ser criada em: $MUT_SCRATCH (infra declarada)" >&2
  exit 2
}
# Daqui para baixo, o `MUT_SCRATCH` que as suítes leem é a raiz DA RODADA.
MUT_SCRATCH="$MUT_SCRATCH_RUN"
export MUT_SCRATCH
trap 'rm -rf "$MUT_SCRATCH_RUN" 2>/dev/null || true' EXIT

# ── A DESCRIÇÃO DE CADA SUB-TEST (derivada, nunca escrita à mão) ──────────
# A fonte única é o bloco `METADES=(...)` do PRÓPRIO script granular — a mesma
# régua que o `check-mutation-count` usa para conferir a doc (`scripts/metades.`
# `mjs`). Uma suíte que não declara metade nenhuma sai nomeada, e o sub-test
# FALHA: fail-closed — "não li o bloco" nunca vale como "não há metade".

descricao_de() { # $1 = script granular relativo a SCRIPT_DIR
  local rel="$1"
  node "$SCRIPT_DIR/scripts/metades.mjs" "$SCRIPT_DIR/$rel" --descricao 2>&1
}

escreve_a_descricao() { # a descrição: derivada, ou o motivo da FALTA escrita
  local rel="$1" texto
  if texto="$(descricao_de "$rel")"; then
    printf '%s' "$texto"
    return 0
  fi
  printf '%s' "❌ NÃO DECLARA as metades (bloco METADES=(...) ausente/ilegível): $texto"
  return 1
}

# O número de metades da suíte (a MESMA leitura da tabela final e do `--json`:
# duas derivações divergiriam no dia em que o formato da descrição mudasse).
contagem_de() { # $1 = script granular relativo a SCRIPT_DIR
  local rel="$1" desc n
  desc="$(descricao_de "$rel" 2>/dev/null || echo "0 metade(s)")"
  n="${desc%% metade*}"
  case "$n" in '' | *[!0-9]*) n=0 ;; esac
  printf '%s' "$n"
}

# O RELÓGIO da medição de custo: milissegundos desde a época. `date +%s%N` é o
# caminho barato (GNU coreutils, o do runner); a máquina que imprime o literal
# `N` cai no python3 — melhor um spawn por sub-test do que um número que não é
# tempo (e o `%3N` do GNU não existe no BSD, que imprime `N` do mesmo jeito).
agora_ms() {
  local n
  n="$(date +%s%N 2>/dev/null || echo N)"
  case "$n" in
    *N) python3 -c 'import time; print(int(time.time() * 1000))' ;;
    *) printf '%s' "$((n / 1000000))" ;;
  esac
}

# O JSON do `--json`, no stdout ORIGINAL (o fd 3 aberto no parse das flags): o
# stdout corrente é o stderr desde que o modo máquina ligou, então a saída humana
# e o dado não se misturam e o run é um só.
imprime_json() {
  [ "$JSON_OUT" = true ] || return 0
  printf '%s\n' "${REGISTROS[@]}" | {
    CUSTO_MS="$CUSTO_TOTAL_MS" PASSED="$PASSED" METADES="$TOTAL_METADES" FALHAS="${FAILED_LIST[*]:-}" FLAKES="${FLAKY_LIST[*]:-}" INFRA="${INFRA_LIST[*]:-}" node -e '
const fs = require("node:fs")
const linhas = fs.readFileSync(0, "utf8").split("\n").filter((l) => l.trim() !== "")
const subtests = linhas.map((linha) => {
  const [id, script, ms, exit, metades, tentativas, exit1, exit2, ms1, ms2, flake, infra] = linha.split("|")
  return {
    id,
    script,
    ms: Number(ms),
    exit: Number(exit),
    metades: Number(metades),
    // AS TENTATIVAS: o `--json` publica a re-medição (ver o cabeçalho) — o
    // `exit` é o da ÚLTIMA tentativa (o que o veredito leu) e a CLASSE vai em
    // `flake`, do mesmo jeito que o prover da pilha publica um commit re-medido:
    // quem lê o registro distingue "medido uma vez" de "medido duas vezes" sem
    // depender de prosa.
    tentativas: Number(tentativas),
    exit1: Number(exit1),
    exit2: exit2 === "" ? null : Number(exit2),
    ms1: Number(ms1),
    ms2: ms2 === "" ? null : Number(ms2),
    flake: flake === "true",
    // A INFRA é a classe que o EXIT NÃO carrega sozinho com honestidade: a suíte
    // saiu 2 porque NÃO MEDIU (o INFRA declarado no cabeçalho dela), e quem lê o
    // registro não pode confundir a ausência de medição com uma reprovação.
    infra: infra === "true",
  }
})
// O custo dos sub-tests e o SOBRANTE do harness sao separados: o proximo
// sub-test entra com o custo MEDIDO dele, e a diferenca entre a soma e o total
// do master e o que o harness (variedade de fixtures, parse das metades) custa.
const subtestsMs = subtests.reduce((acc, s) => acc + s.ms, 0)
const totalMs = Number(process.env.CUSTO_MS)
const summary = {
  count: subtests.length,
  passed: Number(process.env.PASSED),
  failed: (process.env.FALHAS || "").split(/\s+/).filter(Boolean),
  // Os FLAKES contam À PARTE: eles não são "não passou" (a 2ª tentativa
  // passou) nem "passou" (a 1ª reprovou) — somá-los a qualquer um dos dois é
  // a mentira que a re-medição existe para não publicar.
  flakes: (process.env.FLAKES || "").split(/\s+/).filter(Boolean),
  // A INFRA conta à parte dos DOIS lados, pela mesma razão do flake — e com mais
  // força: somá-la a `failed` seria afirmar que a árvore tem um defeito que
  // ninguém mediu.
  infra: (process.env.INFRA || "").split(/\s+/).filter(Boolean),
  // Quantas tentativas a matriz pagou no total (uma re-medição por vermelho):
  // o custo do job cresce com isso, e o número fica dito em vez de deduzido.
  tentativas: subtests.reduce((acc, s) => acc + (s.tentativas || 1), 0),
  metades: Number(process.env.METADES),
  subtestsMs,
  harnessMs: totalMs - subtestsMs,
  totalMs,
}
process.stdout.write(
  JSON.stringify({ tool: "test-mutation-guards", subtests, summary }, null, 2) + "\n",
)
'
  } 1>&3
}

# ── Matriz de sub-tests ───────────────────────────────────────────────────
# Formato: id|script granular (relativo a SCRIPT_DIR). SEM descrição escrita à
# mão: ela é DERIVADA do bloco METADES da própria suíte (ver `descricao_de`).
# Adicionar um mutation test node-puro novo = UMA linha aqui + o bloco METADES
# no script granular (que já deve existir com exit 0 = mutação detectada).
SUBTESTS=(
  "bun-literal|scripts/test-mutation-bun-literal.sh"
  "bun-removal|scripts/test-mutation-bun-removal.sh"
  "hooks-symmetry|scripts/test-mutation-hooks-symmetry.sh"
  "readme|scripts/test-mutation-readme-guards.sh"
  "readme-reverse|scripts/test-mutation-readme-reverse.sh"
  "docs-anchor|scripts/test-mutation-readme-docs-anchor.sh"
  "producer-sent|scripts/test-mutation-producer-sentinel.sh"
  "mutation-jobs|scripts/test-mutation-mutation-jobs.sh"
  "workflow-refs|scripts/test-mutation-workflow-refs.sh"
  "utf8-scope|scripts/test-mutation-utf8-scope.sh"
  "timing-budget|scripts/test-mutation-timing-budget.sh"
  "e2e-cache-budget|scripts/test-mutation-e2e-cache-budget.sh"
  "lint-guard|scripts/test-mutation-lint-guard.sh"
  "mutation-count|scripts/test-mutation-mutation-count.sh"
  "no-setup-bun|scripts/test-mutation-no-setup-bun.sh"
  "runner-base|scripts/test-mutation-runner-base.sh"
  "runner-labels|scripts/test-mutation-runner-labels.sh"
  "no-leaked-imports|scripts/test-mutation-no-leaked-imports.sh"
  "reconciliation|scripts/test-mutation-reconciliation.sh"
  "nested-guard|scripts/test-mutation-nested-guard.sh"
  "pipefail-sigpipe|scripts/test-mutation-pipefail-sigpipe.sh"
  "hook-ci-parity|scripts/test-mutation-hook-ci-parity.sh"
  "hook-commands|scripts/test-mutation-hook-commands.sh"
  "workflow-defaults|scripts/test-mutation-workflow-defaults.sh"
  "workflow-run-syntax|scripts/test-mutation-workflow-run-syntax.sh"
  "merge-latency|scripts/test-mutation-merge-latency.sh"
  "registry-defaults|scripts/test-mutation-registry-defaults.sh"
  "job-deps|scripts/test-mutation-job-deps.sh"
  "remedy-tty|scripts/test-mutation-remedy-tty.sh"
  "canal-fixers|scripts/test-mutation-canal-fixers.sh"
  "required-applied|scripts/test-mutation-required-checks-applied.sh"
  "gate-registration|scripts/test-mutation-gate-registration.sh"
  "archived-pipeline|scripts/test-mutation-archived-pipeline.sh"
  "doc-hashes|scripts/test-mutation-doc-hashes.sh"
  "github-deps|scripts/test-mutation-github-dependencies.sh"
  "cut-stages|scripts/test-mutation-cut-stages.sh"
  "mirror-coverage|scripts/test-mutation-mirror-coverage.sh"
  "pre-commit-proof|scripts/test-mutation-pre-commit-proof.sh"
  "bench-freshness|scripts/test-mutation-bench-freshness.sh"
  "stack-per-commit|scripts/test-mutation-stack-per-commit.sh"
  "lint-scope|scripts/test-mutation-lint-scope.sh"
  "act-origin|scripts/test-mutation-act-origin.sh"
  "commit-import-exports|scripts/test-mutation-commit-import-exports.sh"
  "runner-tag|scripts/test-mutation-runner-tag.sh"
  "local-image|scripts/test-mutation-local-image.sh"
  "artefatos-do-hook|scripts/test-mutation-artefatos-do-hook.sh"
  "mutacao-prova|scripts/test-mutation-mutacao-prova.sh"
)

# ── A PROVA-DE-APLICAÇÃO: as suítes que chamam a RÉGUA ÚNICA ──────────────
# A prova de que uma mutação APLICOU (o `grep` do marcador MUTACAO, a cirurgia
# literal e a conferência do checksum) vivia COPIADA em cada suíte — dezenove
# cópias com uma variação a cada uma, e uma cópia que simplesmente SUMISSE não
# deixava rastro: a suíte seguia verde, medindo o alvo ÍNTEGRO (o verde em
# VÁCUO). Hoje ela é UMA (`scripts/mutacao-prova.sh`, com o gabarito próprio na
# suíte `mutacao-prova` da matriz), e esta lista é a DECLARAÇÃO viva de quem a
# chama. O `check-mutation-count` a confere nos DOIS sentidos contra as suítes
# que chamam `mutacao_aplicar` — tirar a chamada de uma suíte sem tirar a linha
# daqui (ou o contrário) é violação, nunca silêncio — e o NÚMERO de entradas
# está declarado na doc (`**N suítes** provam a aplicação pela régua única`).
# As que NÃO estão aqui são as que injetam mutação por conta própria, sem
# reivindicar a prova do marcador (payload que não é comentável, por exemplo).
PROVA_DE_APLICACAO=(
  "workflow-refs"
  "mutation-count"
  "runner-labels"
  "pipefail-sigpipe"
  "hook-commands"
  "workflow-defaults"
  "workflow-run-syntax"
  "merge-latency"
  "registry-defaults"
  "job-deps"
  "remedy-tty"
  "canal-fixers"
  "required-applied"
  "gate-registration"
  "github-deps"
  "cut-stages"
  "mirror-coverage"
  "pre-commit-proof"
  "bench-freshness"
  "stack-per-commit"
  "lint-scope"
  "runner-tag"
  "local-image"
  "artefatos-do-hook"
  "archived-pipeline"
  "reconciliation"
  "nested-guard"
  "hook-ci-parity"
)

# ── O CAMINHO DECLARADO (sem marcador): o alvo que o payload não deixa marcar ──
# `mutacao_aplicar_sem_marcador` existe para o caso em que o texto NOVO não tem
# onde carregar o marcador `MUTACAO`. O que o caminho declarado cobra é a CIRURGIA
# (o alvo casa UMA vez) e o CONTEÚDO (o checksum mudou) — as mesmas provas de todo
# caminho; o que ele NÃO cobra é o marcador, porque não há texto novo para
# carregá-lo. São CAMINHOS de `scripts/test-mutation-*.sh` (o diretório inteiro,
# não só a matriz): o `check-mutation-count` exige que quem chama o caminho
# declarado esteja NESTA lista, e que cada linha daqui realmente o chame.
#
# A DISPENSA É JUSTIFICADA NA CHAMADA, e não só aqui: o MOTIVO é argumento
# obrigatório de `mutacao_aplicar_sem_marcador` (vazio → fail-closed, a metade M6
# do gabarito), e o TEXTO da linha abaixo é o mesmo que a suíte carrega e passa
# (o `check-mutation-count` exige o motivo no FONTE da suíte, entre aspas). Sem
# isso, o atalho seria uma segunda forma de aplicar mutação — declarada numa
# lista e muda no lugar onde ela acontece. A RECUSA do payload marcado é a outra
# metade (M5): quem pode carregar o marcador usa `mutacao_aplicar`.
SEM_MARCADOR=(
  'scripts/test-mutation-forge-parity.sh|os dois payloads entram numa linha run: de YAML do fixture: a remoção não tem texto novo onde o marcador caiba, e o comentário na troca mudaria o texto que a régua da paridade lê CRU'
  # O GABARITO também entra: ele chama o caminho declarado PARA MEDI-LO (controle,
  # M5 e M6), e quem chama é declarado como qualquer outro chamador. A dispensa
  # aqui não é de uma suíte que muta um alvo: é a do CASO que exercita o caminho.
  'scripts/test-mutation-mutacao-prova.sh|o caso do gabarito mede o caminho DECLARADO com um payload que não comporta o marcador: a linha é uma remoção, e não há texto novo onde ele caiba'
  # O `hook-ci-parity` tem TRÊS payloads que o guard da paridade lê CRU — a linha
  # de comando dos DOIS hooks, a chamada injetada no runner da pipeline e o passo
  # de YAML do workflow. O marcador entraria no texto MEDIDO (a paridade compara o
  # comando do hook com o do CI). As mutações no guard `.mjs` vão pelo caminho
  # ESTRITO: lá o comentário não muda o que ele mede.
  'scripts/test-mutation-hook-ci-parity.sh|o payload é uma linha de HOOK/YAML lida CRUA pelo guard da paridade: um comentário de marcador entraria no texto medido'
)

# ── AS SUÍTES FORA DA RÉGUA: por que cada uma NÃO chama a régua única ───────
# Formato: "id|motivo". A régua é a cópia ÚNICA da prova-de-aplicação, e uma
# suíte que fica FORA dela tem de DIZER por quê: `check-mutation-count` confere
# esta lista nos DOIS sentidos contra a matriz — toda suíte do `SUBTESTS` é da
# régua (`PROVA_DE_APLICACAO`), ou o gabarito (`mutacao-prova`), ou uma linha
# daqui; e uma linha daqui cuja suíte passe a CHAMAR a régua é violação (a lista
# não pode envelhecer). Sem a declaração, "não usa a régua" e "perdeu a régua"
# seriam a mesma coisa em silêncio.
#
# Os motivos vêm em três classes: (a) o alvo mutado é a CÓPIA do fixture no
# scratch (a régua é a prova do alvo da ÁRVORE, e a cópia já morre com o tmp);
# (b) a mutação é a CONSTRUÇÃO do fixture (o arquivo mutado nasce escrito, não há
# troca num alvo); (c) a suíte ORQUESTRA outras suítes e não injeta mutação
# própria. As três linhas marcadas PENDENTE são troca na ÁRVORE por helper
# privado — o caso exato da régua, ainda não convertido.
FORA_DA_REGUA=(
  'bun-literal|muta a CÓPIA do fixture no scratch (`node -e`/`sed -i`), não a árvore'
  'bun-removal|a mutação é a CONSTRUÇÃO do fixture (o workflow mutado nasce escrito)'
  'hooks-symmetry|o hook mutado é o do FIXTURE (`printf`), não o da árvore'
  'readme|NÃO injeta mutação própria: ela ORQUESTRA as três suítes de README'
  'readme-reverse|a troca é `sed -i` no fixture COPIADO para o scratch'
  'docs-anchor|a seção mutada é a do fixture (`$TMP_DIR/docs/api.md`)'
  'producer-sent|os dois scripts mutados são CÓPIAS em `$MUT_DIR`'
  'mutation-jobs|o job mutado é o do FIXTURE (`printf`), não o do repositório'
  'utf8-scope|a troca é `sed -i` no fixture do scratch'
  'timing-budget|o fixture é quem carrega a mutação (`printf`)'
  'e2e-cache-budget|a mutação é a CONSTRUÇÃO do fixture (o orçamento mutado nasce escrito)'
  'lint-guard|o arquivo violador é ESCRITO no fixture (`node -e`), não trocado na árvore'
  'no-setup-bun|a mutação é a CONSTRUÇÃO do fixture (heredoc), com ajustes de `sed` nele'
  'runner-base|a troca é `sed -i` no fixture (`$dir`/`$FIXTURE`)'
  'no-leaked-imports|a mutação é a CONSTRUÇÃO de um worktree ANINHADO no scratch'
  'commit-import-exports|a mutação é a CONSTRUÇÃO do fixture (`cat >`/`printf`)'
  'doc-hashes|o guard mutado é a CÓPIA do fixture (`mutar_linha`: `sed -i` ancorado por marcador)'
  'act-origin|o gate mutado é a CÓPIA do fixture (`mutar_linha`: linha inteira por `python3`)'
)

# ── Colors ────────────────────────────────────────────────────────────────

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

pass() { echo -e "  ${GREEN}✅${NC} $1"; }
fail() { echo -e "  ${RED}❌${NC} $1"; }
info() { echo -e "  ${YELLOW}ℹ️${NC} $1"; }

# ── Parse de flags ────────────────────────────────────────────────────────

LIST_ONLY=false
SELECTED_ID=""
JSON_OUT=false

while [ $# -gt 0 ]; do
  case "$1" in
    --list)
      LIST_ONLY=true
      shift
      ;;
    --json)
      JSON_OUT=true
      shift
      ;;
    --scenario)
      if [ $# -lt 2 ]; then
        fail "Uso: --scenario <id> (falta o id)"
        exit 3
      fi
      SELECTED_ID="$2"
      shift 2
      ;;
    *)
      fail "Flag desconhecida: $1 (use --scenario <id> | --list | --json)"
      exit 3
      ;;
  esac
done

# ── --json: o stdout fica SÓ com o JSON ───────────────────────────────────
# O fd 3 guarda o stdout ORIGINAL e o fd 1 passa a ser o stderr: toda a saída
# humana (as 32 tabelas, o resumo, as metades) continua visível como diagnóstico
# — mas em `--json | jq` ela não contamina o dado. O humano e a máquina leem o
# MESMO run, sem duas execuções do master (que custa minutos).
if [ "$JSON_OUT" = true ]; then
  exec 3>&1 1>&2
fi

# O relógio do master INTEIRO (o custo do job é este, não a soma dos sub-tests).
INICIO_MS="$(agora_ms)"

# ── --list: imprime a matriz e sai ────────────────────────────────────────

if [ "$LIST_ONLY" = true ]; then
  echo ""
  info "Matriz de sub-tests do test-mutation-guards.sh:"
  echo ""
  for entry in "${SUBTESTS[@]}"; do
    id="${entry%%|*}"
    script="${entry#*|}"
    desc="$(escreve_a_descricao "$script" || true)"
    printf "   %-10s %s\n" "• $id" "— $desc"
  done
  echo ""
  exit 0
fi

# ── Valida --scenario (id conhecido?) ─────────────────────────────────────

if [ -n "$SELECTED_ID" ]; then
  FOUND=false
  for entry in "${SUBTESTS[@]}"; do
    id="${entry%%|*}"
    if [ "$id" = "$SELECTED_ID" ]; then
      FOUND=true
      break
    fi
  done
  if [ "$FOUND" = false ]; then
    fail "Sub-test desconhecido: '$SELECTED_ID'. Sub-tests disponíveis:"
    for entry in "${SUBTESTS[@]}"; do
      id="${entry%%|*}"
      echo "   - $id"
    done
    exit 3
  fi
fi

echo ""
echo "  ═════════════════════════════════════════════════════════════════"
echo "   🧪 SEVERINNO — MUTATION TESTS MASTER (guards node-puro)"
echo "  ═════════════════════════════════════════════════════════════════"
info "raiz desta rodada (MUT_SCRATCH): $MUT_SCRATCH"
echo ""

# ── Executa a matriz (fail-CONTINUE: todos rodam, exit agregado) ────────

# ── UMA TENTATIVA de um sub-test (a re-medição chama isto duas vezes) ────
# O output COMPLETO do script granular é impresso como sempre (é a
# granularidade de diagnóstico do master); o par `ms|exit` sai por
# TENTATIVA_MS/TENTATIVA_EXIT, que o laço lê para decidir o veredito.
TENTATIVA_MS=0
TENTATIVA_EXIT=0

roda_tentativa() { # $1 = script granular, $2 = rótulo da tentativa
  local script="$1" rotulo="$2" inicio="" saida=""
  inicio="$(agora_ms)"
  # `set +e` só aqui: o exit do script granular É o dado desta tentativa, e sob
  # `set -e` o master morreria no primeiro vermelho (fail-fast — o oposto do que
  # a matriz promete).
  set +e
  saida="$(bash "$SCRIPT_DIR/$script" 2>&1)"
  TENTATIVA_EXIT=$?
  set -e
  TENTATIVA_MS=$(( $(agora_ms) - inicio ))
  printf '%s\n' "$saida"
  info "$rotulo: exit $TENTATIVA_EXIT em ${TENTATIVA_MS}ms"
}

# A tentativa MEDIU? Esta é a régua da CLASSE INFRA (ver o cabeçalho): um `exit
# 2` é o INFRA que o cabeçalho da suíte declara (git/node/bancada ausentes,
# fail-closed) e 126/127 é a tentativa que nem rodou — nenhum dos três é uma
# medição, então nenhum deles pode virar "o vermelho repetiu".
tentativa_mediu() { # $1 = exit de uma tentativa
  case "$1" in
    2 | 126 | 127) return 1 ;;
    *) return 0 ;;
  esac
}

# O rótulo da 2ª tentativa. A que NÃO MEDIU não contradisse a 1ª: o veredito é o
# da tentativa que mediu, mas a prosa não pode afirmar que ela "repetiu" — ela
# não mediu nada.
rotulo_da_repeticao() { # $1 = exit da 1ª tentativa, $2 = exit da 2ª
  if tentativa_mediu "$2"; then
    printf 'a 2ª tentativa REPETIU o vermelho (exit %s → %s)' "$1" "$2"
  else
    printf 'a 2ª tentativa NÃO MEDIU (exit %s) — o vermelho não foi contradito' "$2"
  fi
}

TOTAL=0
PASSED=0
FAILED_LIST=()
# Os FLAKES (a 1ª reprovou e a 2ª PASSOU na MESMA árvore) ficam À PARTE dos dois
# lados: não são "não passou" e não são "passou" — ver o cabeçalho.
FLAKY_LIST=()
# A INFRA (nenhuma tentativa MEDIU — exit 2 declarado pela suíte, 126/127) fica à
# parte dos mesmos dois lados, e por um motivo mais forte: o que existe não é uma
# medição, é a AUSÊNCIA dela. Chamar isso de vermelho da árvore acusa o que
# ninguém mediu.
INFRA_LIST=()
# Os registros do `--json`: `id|script|ms|exit|metades|tentativas|exit1|exit2|ms1|ms2|flake|infra`
# por sub-test, na ordem da matriz (`ms` = SOMA das tentativas, `exit` = o da
# última). O esquema é montado pelo node no fim (um JSON montado à mão em bash
# escapa errado no dia em que um id tiver aspas).
REGISTROS=()
# O total é o WALL TIME do master inteiro (não a soma dos sub-tests): a diferença
# entre os dois é o que o harness custa, e é ela que diz quanto o próximo
# sub-test acrescenta ao job — não só o tempo do script dele.
CUSTO_TOTAL_MS=0

for entry in "${SUBTESTS[@]}"; do
  id="${entry%%|*}"
  script="${entry#*|}"
  if desc="$(descricao_de "$script")"; then
    BLOCO_OK=true
  else
    BLOCO_OK=false
    desc="❌ NÃO DECLARA as metades (o bloco METADES=(...) é a fonte única da descrição): $desc"
  fi

  if [ -n "$SELECTED_ID" ] && [ "$id" != "$SELECTED_ID" ]; then
    continue
  fi

  TOTAL=$((TOTAL + 1))

  echo "  ───────────────────────────────────────────────────────────────"
  printf "   ${CYAN}▶ Sub-test [%s]${NC} — %s\n" "$id" "$desc"
  echo "  ───────────────────────────────────────────────────────────────"

  # ── A 1ª tentativa ───────────────────────────────────────────────────
  # O relógio cerca a execução do script granular (não a leitura do bloco, que
  # é o mesmo trabalho para todos).
  roda_tentativa "$script" "custo do sub-test [$id]"

  TENTATIVAS=1
  EXIT1="$TENTATIVA_EXIT"
  MS1="$TENTATIVA_MS"
  # Vazio (e não 0) quando NÃO houve 2ª tentativa: no `--json` o campo sai
  # `null`, que é "não houve", e um 0 diria "mediu em 0ms".
  EXIT2=""
  MS2=""
  FLAKE=false
  INFRA=false
  SUBTEST_EXIT="$EXIT1"
  SUBTEST_MS="$MS1"

  # ── A RE-MEDIÇÃO: o 1º tiro vermelho NÃO é veredito (ver o cabeçalho) ───
  if [ "$EXIT1" -ne 0 ]; then
    info "sub-test [$id] VERMELHO (exit $EXIT1) — RE-MEDINDO uma vez: a régua é a repetição, nunca o 1º tiro"
    roda_tentativa "$script" "2ª tentativa do sub-test [$id]"

    TENTATIVAS=2
    EXIT2="$TENTATIVA_EXIT"
    MS2="$TENTATIVA_MS"
    # O `ms` publicado é a SOMA: uma re-medição custa o que ela custou, e o
    # número versionado tem de ser o que o job pagou por este sub-test.
    SUBTEST_MS=$((MS1 + MS2))
    # O `exit` publicado é o da ÚLTIMA tentativa (é o veredito que o master leu):
    # um flake sai com `exit: 0` MAIS `flake: true` — a classe não se esconde
    # dentro do exit, e quem lê o registro sabe qual dos dois casos é.
    SUBTEST_EXIT="$EXIT2"
    # O FLAKE exige as DUAS tentativas MEDINDO: a 1ª reprovou e a 2ª passou na
    # MESMA árvore. Uma 1ª que NÃO mediu (exit 2) e uma 2ª verde não são uma
    # contradição — a 1ª não afirmou nada: o veredito é o VERDE da que mediu.
    if [ "$EXIT2" -eq 0 ] && tentativa_mediu "$EXIT1"; then
      FLAKE=true
    fi
    # NENHUMA das duas mediu: a classe é INFRA, e ela NÃO é vermelho.
    if ! tentativa_mediu "$EXIT1" && ! tentativa_mediu "$EXIT2"; then
      INFRA=true
    fi
  fi

  REGISTROS+=("$id|$script|$SUBTEST_MS|$SUBTEST_EXIT|$(contagem_de "$script")|$TENTATIVAS|$EXIT1|$EXIT2|$MS1|$MS2|$FLAKE|$INFRA")

  if [ "$INFRA" = true ]; then
    fail "Sub-test [$id] INDETERMINADO (🚧 INFRA): NENHUMA das $TENTATIVAS tentativa(s) MEDIU"
    fail "  (exit $EXIT1 → ${EXIT2:-—}) — exit 2 é o INFRA que a suíte declara (git/node/bancada ausentes, fail-closed)"
    fail "  e 126/127 é a tentativa que nem rodou. Isto NÃO é defeito da árvore: o vermelho NÃO existe,"
    fail "  o que existe é o instrumento que não respondeu. Re-rode a matriz onde ele responde."
    INFRA_LIST+=("$id")
  elif [ "$FLAKE" = true ]; then
    fail "Sub-test [$id] INDETERMINADO (🌀 FLAKE): a 1ª tentativa reprovou (exit $EXIT1) e a 2ª"
    fail "  PASSOU na MESMA árvore — as duas se CONTRADIZEM: não vale verde (a regressão"
    fail "  existiu) nem reprovação (ela não repetiu). Repita a suíte [$id] para decidir."
    FLAKY_LIST+=("$id")
  elif [ "$SUBTEST_EXIT" -ne 0 ]; then
    if [ "$TENTATIVAS" -eq 2 ]; then
      fail "Sub-test [$id] FALHOU (exit $EXIT2) — $(rotulo_da_repeticao "$EXIT1" "$EXIT2")"
    else
      fail "Sub-test [$id] FALHOU (exit $EXIT1)"
    fi
    FAILED_LIST+=("$id")
  elif [ "$BLOCO_OK" = true ]; then
    pass "Sub-test [$id] PASS (exit 0)"
    # PASS depois de uma tentativa que NÃO MEDIU: o veredito é o da que mediu, e
    # a ausência fica DITA (sem ela, o `tentativas: 2` do registro pareceria uma
    # re-medição de vermelho).
    if [ "$TENTATIVAS" -eq 2 ] && ! tentativa_mediu "$EXIT1"; then
      info "  (a 1ª tentativa NÃO MEDIU — exit $EXIT1: o veredito é o da tentativa que mediu, e o ms soma as duas)"
    fi
    PASSED=$((PASSED + 1))
  else
    fail "Sub-test [$id] FALHOU: a suíte passou, mas ela não DECLARA as metades"
    fail "  (a descrição do sub-test e a prosa da doc derivam do bloco METADES)"
    FAILED_LIST+=("$id")
  fi
  echo ""
done

# ── Tabela final ─────────────────────────────────────────────────────────

echo "  ═════════════════════════════════════════════════════════════════"
echo "   📊 RESUMO — mutation tests master (guards node-puro)"
echo "  ═════════════════════════════════════════════════════════════════"
printf "   %-10s %-6s %s\n" "Sub-test" "Result" "Status"
for entry in "${SUBTESTS[@]}"; do
  id="${entry%%|*}"
  if [ -n "$SELECTED_ID" ] && [ "$id" != "$SELECTED_ID" ]; then
    continue
  fi
  # Verdict da célula = SOMENTE a pertença a FAILED_LIST/FLAKY_LIST (sem gate de
  # PASSED: com todos os sub-tests falhando, PASSED=0 — um gate `$PASSED
  # -gt 0 &&` faria a condição curto-circuitar e TODAS as linhas sairiam
  # como PASS no momento exato em que tudo falhou).
  # O FLAKE tem marca PRÓPRIA (🌀): ele não é PASS (a regressão existiu) nem FAIL
  # (ela não repetiu) — quem lê a tabela precisa distinguir os dois de longe.
  # Herestring (não pipe): sob `set -o pipefail`, `printf | grep -qx` pode
  # falhar por SIGPIPE (o grep -q fecha o stdin cedo) — flaky pelo tamanho.
  if grep -qx "$id" <<<"$(printf '%s\n' "${INFRA_LIST[@]:-}")"; then
    printf "   %-10s ${YELLOW}%-6s${NC} 🚧\n" "$id" "INFRA"
  elif grep -qx "$id" <<<"$(printf '%s\n' "${FLAKY_LIST[@]:-}")"; then
    printf "   %-10s ${YELLOW}%-6s${NC} 🌀\n" "$id" "FLAKE"
  elif grep -qx "$id" <<<"$(printf '%s\n' "${FAILED_LIST[@]}")"; then
    printf "   %-10s ${RED}%-6s${NC} ❌\n" "$id" "FAIL"
  else
    printf "   %-10s ${GREEN}%-6s${NC} ✅\n" "$id" "PASS"
  fi
done
echo ""
printf "   Total: %d | Passed: %d | Failed: %d | Flaky: %d | Infra: %d\n" \
  "$TOTAL" "$PASSED" "${#FAILED_LIST[@]}" "${#FLAKY_LIST[@]}" "${#INFRA_LIST[@]}"
echo ""

# ── As METADES declaradas por cada sub-test (derivadas, uma a uma) ────────
#
# A tabela acima responde "o sub-test passou?". Esta responde "o que ele
# protege?" — e a resposta sai do bloco METADES da própria suíte, do mesmo
# jeito que a descrição do cabeçalho de cada sub-test. Nada aqui foi escrito à
# mão: acrescentar uma mutação muda este resumo sem ninguém editar o master.

echo "  ═════════════════════════════════════════════════════════════════"
echo "   🧬 METADES DECLARADAS (a descrição de cada sub-test vem daqui)"
echo "  ═════════════════════════════════════════════════════════════════"
TOTAL_METADES=0
for entry in "${SUBTESTS[@]}"; do
  id="${entry%%|*}"
  script="${entry#*|}"
  if [ -n "$SELECTED_ID" ] && [ "$id" != "$SELECTED_ID" ]; then
    continue
  fi
  desc="$(descricao_de "$script" || echo "0 metade(s)")"
  n="$(contagem_de "$script")"
  TOTAL_METADES=$((TOTAL_METADES + n))
  printf "   %-10s %4s metade(s)  — %s\n" "$id" "$n" "${desc#*metade(s): }" | cut -c1-150
done
echo ""
printf "   %d metade(s) declarada(s) em %d sub-test(s) — a régua é scripts/metades.mjs\n" \
  "$TOTAL_METADES" "$TOTAL"
echo ""

CUSTO_TOTAL_MS=$(( $(agora_ms) - INICIO_MS ))

# O DADO (o custo de cada sub-test) sai ANTES do veredito: um sub-test vermelho
# ainda tem custo medido (é a suíte que fica vermelha, não a medição), e o
# consumidor do `--json` precisa do retrato inteiro nos dois caminhos.
imprime_json

if [ "${#FAILED_LIST[@]}" -gt 0 ]; then
  fail "MUTATION TESTS FALHARAM: ${FAILED_LIST[*]} — um sub-test não detectou a"
  fail "mutação (guard cego / asserção quebrada) numa MEDIÇÃO, e a re-medição a"
  fail "confirmou (ou ela não mediu: o vermelho que existe é o da que mediu)."
  if [ "${#FLAKY_LIST[@]}" -gt 0 ]; then
    fail "${#FLAKY_LIST[@]} sub-test(s) ficaram INDETERMINADOS (FLAKE 🌀) e seguem NOMEADOS:"
    fail "  ${FLAKY_LIST[*]} — o veredito da matriz é o dos vermelhos, o flake não vira verde nem"
    fail "  some dentro deles: repita a suíte de cada um para decidir o que ele é."
  fi
  if [ "${#INFRA_LIST[@]}" -gt 0 ]; then
    fail "${#INFRA_LIST[@]} sub-test(s) NÃO MEDIRAM (🚧 INFRA) e NÃO entram neste vermelho:"
    fail "  ${INFRA_LIST[*]} — exit 2/126/127 é a AUSÊNCIA de medição (git/node/bancada), e acusar"
    fail "  a árvore por ela seria mandar consertar o que ninguém mediu."
  fi
  exit 1
fi

# INDETERMINADO (exit 2): nada foi reprovado por uma MEDIÇÃO, e há um dos dois
# casos em que a matriz NÃO publica veredito — a contradição (FLAKE 🌀) ou a
# ausência de medição (INFRA 🚧).
if [ "${#FLAKY_LIST[@]}" -gt 0 ] || [ "${#INFRA_LIST[@]}" -gt 0 ]; then
  if [ "${#FLAKY_LIST[@]}" -gt 0 ]; then
    fail "MUTATION TESTS INDETERMINADOS (exit 2): ${FLAKY_LIST[*]} — a 1ª tentativa reprovou"
    fail "e a 2ª PASSOU na MESMA árvore (FLAKE 🌀). As duas se CONTRADIZEM: não é regressão"
    fail "(o vermelho não repetiu) e não é verde (ele existiu). Repita a suíte para decidir —"
    fail "a matriz não publica veredito sobre UM tiro, e é este exit 2 que separa o flake"
    fail "da regressão de verdade."
  fi
  if [ "${#INFRA_LIST[@]}" -gt 0 ]; then
    fail "MUTATION TESTS NÃO MEDIDOS (exit 2, 🚧 INFRA): ${INFRA_LIST[*]} — a(s) tentativa(s)"
    fail "saíram com o exit 2 que a suíte declara como INFRA (git/node/bancada ausentes,"
    fail "fail-closed) ou nem rodaram (126/127). Isto NÃO é defeito da árvore: o vermelho"
    fail "não existe, o que existe é o instrumento que não respondeu — e é por isso que a"
    fail "matriz não publica veredito sobre a AUSÊNCIA de medição. Re-rode onde ele responde."
  fi
  exit 2
fi

pass "MUTATION TESTS PASSED — os $TOTAL sub-test(s) node-puro detectaram as mutações,"
pass "e as $TOTAL_METADES metade(s) estão DECLARADAS no próprio script (bloco METADES)."
pass "A prosa deste resumo é derivada delas: acrescentar uma mutação é acrescentar"
pass "uma linha no bloco da suíte — o master e a doc não têm texto à mão para envelhecer."
exit 0
