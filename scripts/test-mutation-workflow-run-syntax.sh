#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-workflow-run-syntax.sh — Mutation test do guard de
# sintaxe dos corpos `run:` (scripts/check-workflow-run-syntax.mjs)
#
# Usage:
#   ./scripts/test-mutation-workflow-run-syntax.sh
#
# Exit codes:
#   0 — as TREZE mutações foram DETECTADAS (pelo gate e/ou pela suíte) e os
#       controles passaram ✅
#   1 — guard INDIFERENTE a alguma mutação (não cegou) OU controle falso ❌
#
# O QUE ISTO PROVA (e por que não basta o guard passar hoje)
#
# Um gate que roda e sai 0 prova que ele não ACUSOU — não prova que ele MEDIU.
# Este script muta CADA mecanismo do guard e exige que o gate fique CEGO: se
# mutar um deles não muda o veredito, aquele mecanismo não sustenta nada (é
# decoração), e some do repositório no primeiro refactor sem ninguém notar.
#
# Os mecanismos que a varredura promete e que são medidos aqui:
#
#   M1 — A METADE DO AVISO (`ok` exige exit 0 E stderr vazio). `bash -n` sai 0
#        para um heredoc SEM terminador: é AVISO, não erro, e o corpo truncado
#        rodaria outra coisa. Mutar `ok` para olhar só o exit code CEGA o guard
#        nesse caso — e SÓ nele (o erro de sintaxe continua reprovado).
#   M2 — O STDIN DO BASH (o corpo vai como `input` do `bash -n`). Sem ele o
#        bash lê um programa VAZIO para todo passo: todo corpo passa, de todas
#        as classes. É o mecanismo comum — mutá-lo cega o guard INTEIRO.
#   M3 — A MÁSCARA DA EXPRESSÃO (`${{ ... }}` vira uma PALAVRA). A máscara
#        dentro da expressão é LAZY (`[^}]*`): ela para no primeiro `}}` e o que
#        está FORA continua sendo julgado. Torná-la GULOSA (`[\s\S]*`) engole
#        tudo até o ÚLTIMO `}}` do corpo — e um defeito que esteja no meio
#        (entre duas expressões) desaparece do julgamento: guard CEGO.
#   M4 — O ÍNDICE DO RECORTE `--staged` (o modo do pre-commit). O recorte julga
#        os workflows do ÍNDICE e lê o conteúdo DO COMMIT (`git show :path`),
#        não o working tree — porque o corpo quebrado nasce de uma reescrita
#        mecânica em massa ANTES do commit, e é o commit que o carrega. Ler a
#        ÁRVORE no lugar do índice CEGA o recorte: o commit com o defeito passa
#        porque o editor já consertou o arquivo. O fixture precisa de um repo
#        git de verdade (índice com o corpo quebrado + árvore corrigida).
#   M5 — O CONJUNTO DE SHELLS DA IMAGEM (`RUNNER_SHELLS`). O gate julga o
#        `shell:` declarado contra o que a imagem do runner MEDIU: um passo com
#        `shell: pwsh` num runner sem `pwsh` morre com `command not found` DEPOIS
#        do setup — e `bash -n` nunca vê isso (ele julga o CORPO, não a existência
#        do interpretador). Aceitar qualquer nome como "presente" CEGA o gate: o
#        passo que quebra o job passa com a headline de sucesso. A metade do
#        PARSING segue mordendo (mutação cirúrgica).
#   M6 — A GUARDA DO CORPO VAZIO no `--fix`. Quando o remendo deixaria o corpo
#        SEM NADA (a cicatriz era o corpo inteiro: `&&` sozinho), o fixer tem de
#        RECUSAR — o passo deixaria de rodar o que diz. Remover essa guarda CEGA
#        o fixer de um jeito que se paga no gate: ele grava um corpo vazio, o
#        corpo vazio deixa de ser julgado (não há sintaxe a julgar) e o gate sai
#        VERDE com o passo que já não roda mais nada. É a diferença entre
#        "remendar a cicatriz" e "apagar o passo".
#   M7 — A SEGUNDA FONTE (os scripts de shell versionados). O MESMO `bash -n`
#        julga, além dos corpos `run:`, os arquivos que o passo EXECUTA
#        (`bash scripts/x.sh`) — a lista é a do `listShellScripts`. Tirar essa
#        metade da varredura CEGA o gate para um script quebrado: ele passa a
#        publicar a headline de sucesso contando os arquivos que NÃO julgou
#        ("124 arquivo(s) de shell passam") — a pior forma de mentira, a que
#        conta o que não olhou. A metade dos corpos segue mordendo (cirúrgica).
#        Assinatura da mutação: o gate fica VERMELHO (violação falsa), não cego.
#   M8 — O PULO NOMEADO do passo NÃO-bash (`isBashShell`). O gate julga o corpo
#        de um passo pelo interpretador que ele DECLARA: `shell: python3` num
#        corpo python é legítimo e sai como PULADO e NOMEADO (com o caminho
#        medido na imagem). Forçar `isBashShell` a `true` faz o gate julgar todo
#        corpo como bash — e o passo python legítimo vira uma VIOLAÇÃO FALSA
#        (o `bash -n` recusa `print(1)`). É a assinatura INVERSA das outras
#        mutações: aqui o gate não fica cego, ele acusa quem não tem defeito.
#        DUAS testemunhas: o GATE por execução (node-puro, sempre) e a SUÍTE
#        UNITÁRIA, que tem de ficar VERMELHA — a segunda roda quando o vitest
#        está instalado e DIZ quando não está, porque uma testemunha que falha
#        por ambiente seria lida como "mutante morto".
#   M9 — A TERCEIRA FONTE, metade do BUILD (a instrução `RUN` de um Dockerfile).
#        O shell do build é o texto da instrução JUNTADO (a continuação `\` faz
#        parte) e entregue a `/bin/sh -c`: a cicatriz mecânica de uma reescrita
#        (`&& \` que engole a linha seguinte) só aparece no meio de um build de
#        minutos. Tirar esta fonte CEGA o gate: o Dockerfile quebrado passa.
#   M10 — A TERCEIRA FONTE, metade do PAYLOAD (o `sh -c` embutido num script).
#        Para o `bash -n` do arquivo que o contém o payload é uma STRING — é por
#        isso que ele passava por todos os outros gates. Desligar a varredura de
#        payload CEGA o gate: o script com o payload quebrado passa, com o
#        `bash -n` do próprio arquivo verde ao lado.
#   M11 — A LEITURA DO YAML (o `entrypoint:` de um compose). O shell de um
#        compose mora num ELEMENTO de lista (`- /bin/sh` / `- -c` / `- |`): ler o
#        arquivo como TEXTO entrega a sintaxe do YAML (`-`) em vez do script, e
#        um flow (`["CMD", "python3", "-c", ...]`) não entrega nada. Tirar a
#        leitura por ESTRUTURA cega o gate para o compose.
#   M12 — O ESCAPE DO COMPOSE (`$$` → `$`). A assinatura é o FALSO POSITIVO: sem
#        desfazer o escape, o gate julga `$$(curl ...)` (que para o bash seria
#        PID + parêntese solto) em vez do `$(curl ...)` que o shell RECEBE. É uma
#        premissa MEDIDA: foi assim que esta meia-linha nasceu (o repositório
#        acusou um payload são em `docker-compose.prod.yml`).
#   M13 — O PULO DO HEREDOC (o corpo é DADO, não código). A assinatura também é
#        o FALSO POSITIVO, e ele cai em cima de quem escreve FIXTURE: os próprios
#        mutation tests do repositório escrevem shell quebrado dentro de heredoc
#        de propósito. Sem o pulo, o gate acusa um script são.
#
# NOTA HONESTA sobre M3 (medido, não suposto): remover a máscara POR INTEIRO
# NÃO cega o guard — `bash -n` aceita `[ "${{ vars.MODE || 'a}b' }}" = "1" ]`
# (exit 0). A máscara não existe para "aceitar" o que o bash aceitaria: ela
# existe para que o gate julgue SHELL e não o template do runner. O que a torna
# load-bearing é o seu LIMITE — a partir de onde ela deixa de mascarar. É esse
# limite (lazy, no primeiro `}}`) que a mutação gulosa remove, e é isso que o
# Cenário M3 prende. (Um teste que mutasse "sem máscara" ficaria verde por
# acidente — a mutação tem de ser a que MUDA o veredito.)
#
# COMO (e por que assim): o guard REAL é executado com `--root` contra um
# mini-repo fixture em mktemp (nunca contra o worktree) e a evidência é o EXIT
# CODE dele — não a leitura do código do guard. Um harness que LÊ o código mede
# a intenção; este mede o comportamento. As mutações são aplicadas NO LUGAR, no
# arquivo do repositório, com backup + restauração VERIFICADA por checksum
# (trap EXIT): um `exit` no meio não pode deixar a árvore com a mutação dentro.
#
# Pipeline:
#   1. CONTROLE A — o guard REAL passa no repositório de verdade (sem dívida)
#   2. CONTROLE B (SENSIBILIDADE) — o guard REAL REPROVA as três fixtures de
#      defeito: `if` sem `fi` (ERRO), heredoc sem terminador (AVISO) e o defeito
#      entre duas expressões (máscara). Sem esta metade, "ficou cego" não
#      significaria nada (um guard já cego passaria em tudo).
#   3. MUTAÇÃO M1 (a metade do AVISO) — remove o `stderr === ""`:
#      o heredoc passa (CEGO) e o `if` sem `fi` continua reprovado (cirúrgica)
#   4. MUTAÇÃO M2 (o stdin do bash) — troca `input: body` por `input: ""`:
#      TODAS as três fixtures passam (CEGO no mecanismo comum)
#   5. MUTAÇÃO M3 (a máscara gulosa) — `[^}]*` → `[\s\S]*`:
#      o defeito entre as expressões passa (CEGO); as outras duas seguem
#      reprovadas e o corpo SÃO segue passando (cirúrgica nos dois sentidos)
#   6. MUTAÇÃO M4 (o índice do `--staged`) — lê a ÁRVORE em vez do ÍNDICE:
#      o recorte aprova um commit que ainda carrega o corpo quebrado (CEGO),
#      e o gate da ÁRVORE segue reprovando o mesmo defeito (cirúrgica)
#   7. MUTAÇÃO M5 (o conjunto de shells) — aceita qualquer nome como presente:
#      o passo com `shell: pwsh` passa (CEGO) e o `if` sem `fi` segue reprovado
#   8. MUTAÇÃO M6 (a guarda do corpo vazio no `--fix`) — grava um corpo VAZIO:
#      o passo que já não roda nada passa a sair como ✅ (CEGO)
#   9. MUTAÇÃO M7 (a SEGUNDA fonte) — tira a varredura dos arquivos de shell:
#      o script quebrado passa (CEGO) e o corpo `run:` quebrado segue reprovado
#  10. MUTAÇÃO M8 (o PULO NOMEADO) — `isBashShell` sempre true: o passo python
#      legítimo passa a ser ACUSADO (violação falsa) com a suíte unitária
#      VERMELHA, e o corpo bash quebrado segue reprovado (cirúrgica)
#  11. Restauração VERIFICADA (checksum) + CONTROLE FINAL: o guard volta a
#      reprovar o `if` sem `fi`, provando que a árvore ficou como estava
#  12. Cleanup (trap EXIT — restaura o guard e remove o temp, mesmo com falha)
# =============================================================================

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
GUARD="$SCRIPT_DIR/scripts/check-workflow-run-syntax.mjs"
# A RÉGUA do que EXECUTA (comentário fora, expressão do runner) vive na FONTE
# ÚNICA, e o M3 muta ELA, não o guard: o guard importa `DYNAMIC_EXPR_RE` de lá,
# então mutar o PADRAO só muda o veredito se o guard de fato o consome — uma
# cópia local sobreviveria à mutação e o script falharia como CEGO. É essa a
# prova de que a máscara é uma só.
RULER="$SCRIPT_DIR/scripts/forge-workflows.mjs"

TMP_DIR="$(mktemp -d)"
FX="$TMP_DIR/fx"
WF="$FX/.github/workflows/pr-check.yml"

# Asserções que o guard DEVE emitir. Fonte (scripts/check-workflow-run-syntax.mjs):
#   EXPECTED_HEADLINE — headline de main(): 'N corpo(s) `run:` NÃO passam em `bash -n`'
#   EXPECTED_ERRO     — a contagem das violações de parsing
#   EXPECTED_AVISO    — o heredoc sem terminador (o bash sai 0 e o guard reprova)
#   EXPECTED_PASS     — headline de sucesso de main(): 'N corpo(s) `run:` passam em ...'
#
# ⚠️ Source-coupled: estas strings reproduzem o texto EXATO do guard. Se a
# mensagem for reformulada em scripts/check-workflow-run-syntax.mjs, o mutation
# test falha com "não pela asserção esperada" (não é guard cego — é o esperado
# por acoplamento; atualizar as duas juntas).
EXPECTED_HEADLINE="NÃO passam em"
EXPECTED_ERRO="ERRO de sintaxe"
EXPECTED_AVISO="com AVISO"
EXPECTED_PASS="passam em"
# A violação de SHELL (M5): headline própria — a classe não é de parsing.
EXPECTED_SHELL='declaram um `shell:` que o runner NÃO tem'
EXPECTED_SHELL_MOTIVO="command not found"
# O remendo recusado por deixar o corpo VAZIO (M6) e o desfecho do fixer.
EXPECTED_FIX_OK="remendo aplicado"
EXPECTED_FIX_VAZIO="VAZIO"
# A SEGUNDA fonte (M7): a headline dos ARQUIVOS de shell — o relatório separa as
# duas classes, e é a dos arquivos que tem de sair (a dos corpos `run:` não
# provaria nada sobre um `.sh`).
EXPECTED_SCRIPTS='arquivo(s) de shell NÃO passam'
# O PULO NOMEADO do passo não-bash (M8): a headline que o gate REAL emite para o
# passo que ele NÃO julga — e que a mutação tem de FAZER DESAPARECER.
EXPECTED_PULAR='shell NÃO-bash PRESENTE no runner'
# A segunda testemunha do M8: o arquivo que a suíte unitária julga.
SUITE_ARQUIVO="src/lib/__tests__/check-workflow-run-syntax.test.ts"
# A TERCEIRA fonte (o shell EMBUTIDO): as duas headlines próprias — a do shell do
# BUILD (a instrução `RUN`) e a do payload de um `sh -c`.
EXPECTED_EMBUTIDO_RUN='instrução(ões) EMBUTIDA(s)'
EXPECTED_EMBUTIDO_PAYLOAD='payload(s) de `sh -c`/`bash -c`'

# ── Colors ────────────────────────────────────────────────────────────────

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

pass() { echo -e "  ${GREEN}✅${NC} $1"; }
fail() { echo -e "  ${RED}❌${NC} $1"; }
info() { echo -e "  ${YELLOW}ℹ️${NC} $1"; }
header() { echo -e "\n${CYAN}═══ $1 ═══${NC}"; }

# ── Backup das FONTES + restauração VERIFICADA (trap EXIT) ────────────────
# As mutações são aplicadas NO LUGAR (o `--root` é da fixture; os arquivos
# mutados são os do repositório). O backup e a restauração entram no MESMO trap,
# porque um `exit` no meio do caminho não pode deixar a árvore mutada. O backup
# mora em $TMP_DIR porque NADA aqui apaga esse diretório no meio da prova (só o
# cleanup, depois de restaurar).
guard_backup="$TMP_DIR/guard.original.mjs"
ruler_backup="$TMP_DIR/ruler.original.mjs"
cp "$GUARD" "$guard_backup"
cp "$RULER" "$ruler_backup"
guard_sum="$(cksum "$GUARD" | cut -d' ' -f1)"
ruler_sum="$(cksum "$RULER" | cut -d' ' -f1)"

cleanup() {
  cp -f "$guard_backup" "$GUARD" 2>/dev/null || true
  cp -f "$ruler_backup" "$RULER" 2>/dev/null || true
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

restaurar_originais() {
  cp -f "$guard_backup" "$GUARD"
  cp -f "$ruler_backup" "$RULER"
  if [ "$(cksum "$GUARD" | cut -d' ' -f1)" != "$guard_sum" ] || [ "$(cksum "$RULER" | cut -d' ' -f1)" != "$ruler_sum" ]; then
    fail "RESTAURAÇÃO FALHOU (checksum diverge) — restaure a partir de $TMP_DIR"
    exit 1
  fi
}

# ── mutar_guard: substituição CIRÚRGICA (exatamente 1 ocorrência) ─────────
# Uma mutação que casa 0 ou 2+ vezes não é cirúrgica: o script para em vez de
# medir outra coisa. O marcador "MUTACAO M" no texto novo é o que prova que a
# mutação APLICOU (o alvo pode existir e a escrita falhar).
mutar_guard() {
  GUARD="$GUARD" ALVO="$1" NOVO="$2" python3 - <<'PY'
import os
p = os.environ["GUARD"]
old, new = os.environ["ALVO"], os.environ["NOVO"]
s = open(p).read()
n = s.count(old)
if n != 1:
    raise SystemExit(f"mutacao nao-cirurgica no guard: {n} ocorrencia(s) do alvo (esperado 1)")
open(p, "w").write(s.replace(old, new))
PY
  if ! grep -qF 'MUTACAO M' "$GUARD"; then
    fail "a mutação não aplicou no guard (nada a medir)"
    exit 1
  fi
  if [ "$(cksum "$GUARD" | cut -d' ' -f1)" = "$guard_sum" ]; then
    fail "a mutação não alterou o guard (checksum idêntico) — o alvo casou mas a escrita não"
    exit 1
  fi
}

# ── mutar_regua: o mesmo contrato, mas sobre a RÉGUA (fonte única) ────────
# Usado pelo M3: o alvo é a LINHA DA RÉGUA, e o checksum de referência é o
# DELA — sem isso, uma mutação que não aplicasse passaria como "guard imune".
mutar_regua() {
  ARQ="$RULER" ALVO="$1" NOVO="$2" python3 - <<'PY'
import os
p = os.environ["ARQ"]
old, new = os.environ["ALVO"], os.environ["NOVO"]
s = open(p).read()
n = s.count(old)
if n != 1:
    raise SystemExit(f"mutacao nao-cirurgica na regua: {n} ocorrencia(s) do alvo (esperado 1)")
open(p, "w").write(s.replace(old, new))
PY
  if ! grep -qF 'MUTACAO M' "$RULER"; then
    fail "a mutação não aplicou na régua (nada a medir)"
    exit 1
  fi
  if [ "$(cksum "$RULER" | cut -d' ' -f1)" = "$ruler_sum" ]; then
    fail "a mutação não alterou a régua (checksum idêntico) — o alvo casou mas a escrita não"
    exit 1
  fi
}

# ── mkfixture_raiz: um workflow com UM passo cujo corpo é o arquivo dado ──
# O corpo é escrito num ARQUIVO e indentado para dentro do bloco YAML: o YAML
# come a indentação, então o bash recebe o TEXTO EXATO do arquivo — que é
# também o que o Controle B mede direto com `bash -n`.
mkfixture_raiz() {
  local raiz="$1" nome="$2" corpo="$3"
  mkdir -p "$raiz/.github/workflows"
  {
    printf 'jobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n'
    printf '      - name: %s\n        run: |\n' "$nome"
    sed 's/^/          /' "$corpo"
  } > "$raiz/.github/workflows/pr-check.yml"
}

# O fixture padrão (M1/M2/M3 e controles) — sem git, julgado pelo modo ÁRVORE.
mkfixture() {
  mkfixture_raiz "$FX" "$1" "$2"
}

# ── rodar_guard: roda o guard (real ou mutado) contra a fixture (ÁRVORE) ──
# Devolve exit e saída em GUARD_EXIT / GUARD_OUT (globais).
rodar_guard() {
  set +e
  GUARD_OUT="$(node "$GUARD" --root "$FX" 2>&1)"
  GUARD_EXIT=$?
  set -e
}

# ── rodar_staged: roda o guard no recorte `--staged` contra um repo git ──
# O `--root` explícito (e não o cwd) mantém o teste livre de cd global.
rodar_staged() {
  set +e
  GUARD_OUT="$(node "$GUARD" --staged --root "$1" 2>&1)"
  GUARD_EXIT=$?
  set -e
}

# ── rodar_guard_em: igual ao rodar_guard, mas contra OUTRA raiz ───────────
# A fixture da segunda fonte (M7) não pode ser a dos corpos: o veredito que
# sobra tem de ser o do ARQUIVO, e não o de um `run:` quebrado do mesmo lado.
rodar_guard_em() {
  set +e
  GUARD_OUT="$(node "$GUARD" --root "$1" 2>&1)"
  GUARD_EXIT=$?
  set -e
}

# ── rodar_suite: a segunda testemunha do M8 (a suíte unitária do guard) ────
# Devolve o exit code do vitest em SUITE_EXIT e as últimas linhas em SUITE_OUT.
# Só é CHAMADA quando o vitest está instalado: sem ele a suíte não julga o
# invariante, e tratar "não rodou" como "mutante morto" seria a mentira mais
# fácil de todas (uma suíte vermelha por ambiente mata qualquer mutação).
rodar_suite() {
  set +e
  SUITE_OUT="$(cd "$SCRIPT_DIR" && bun x vitest run --config vitest.config.unit.ts "$SUITE_ARQUIVO" 2>&1 | tail -8)"
  SUITE_EXIT=$?
  set -e
}

# ── exigir_pulado_nomeado: o passo não-bash PASSA e sai NOMEADO como pulado ──
exigir_pulado_nomeado() {
  local cenario="$1"
  if [ "$GUARD_EXIT" -ne 0 ]; then
    fail "CONTROLE FALSO ($cenario): o gate REPROVOU um passo python legítimo (exit $GUARD_EXIT)."
    fail "Sem um pulo correto, o 'virou violação falsa' do M8 mede nada."
    echo "$GUARD_OUT" | tail -12
    exit 1
  fi
  if ! grep -qF "$EXPECTED_PULAR" <<<"$GUARD_OUT"; then
    fail "$cenario: passou, mas SEM nomear o pulo ('$EXPECTED_PULAR')."
    echo "$GUARD_OUT" | tail -12
    exit 1
  fi
  if ! grep -qF "python3" <<<"$GUARD_OUT"; then
    fail "$cenario: o pulo não diz QUAL shell foi pulado (nem que a imagem o tem)."
    echo "$GUARD_OUT" | tail -12
    exit 1
  fi
}

# ── exigir_falso_positivo: com a mutação o gate tem de ACUSAR o que pulava ──
# A assinatura aqui é o INVERSO das outras mutações: o gate não fica verde, ele
# inventa uma violação para um passo legítimo. As DUAS metades são exigidas (a
# violação pelo PARSING e o pulo nomeado DESAPARECIDO) — só uma delas deixaria
# passar um gate que acusasse por outro motivo, ou que acusasse E pulasse junto.
exigir_falso_positivo() {
  local cenario="$1"
  if [ "$GUARD_EXIT" -eq 0 ]; then
    fail "GUARD INDIFERENTE ($cenario): com isBashShell forçado a true o gate AINDA"
    fail "passou (exit 0) — o pulo nomeado não é o que sustenta este veredito."
    echo "$GUARD_OUT" | tail -12
    exit 1
  fi
  if [ "$GUARD_EXIT" -ne 1 ]; then
    fail "$cenario: exit $GUARD_EXIT — o contrato é 1 (violação), não infra errada."
    echo "$GUARD_OUT" | tail -12
    exit 1
  fi
  if ! grep -qF "$EXPECTED_ERRO" <<<"$GUARD_OUT"; then
    fail "$cenario: reprovou, mas NÃO pela asserção do parsing ('$EXPECTED_ERRO')."
    echo "$GUARD_OUT" | tail -12
    exit 1
  fi
  if grep -qF "$EXPECTED_PULAR" <<<"$GUARD_OUT"; then
    fail "$cenario: o pulo nomeado SAINDO junto com a violação é contraditório —"
    fail "o gate julgou o passo E disse que o pulou."
    echo "$GUARD_OUT" | tail -12
    exit 1
  fi
}

# ── exigir_aprovado: CONTROLE — a fixture passa, com a headline de sucesso ──
# É o par do `exigir_cego` para as mutações cuja assinatura é o FALSO POSITIVO
# (M12/M13): antes de medir que a mutação acusa, é preciso provar que SEM ela o
# mesmo fixture passa — o defeito medido é o do gate, não o da fixture.
exigir_aprovado() {
  local cenario="$1"
  if [ "$GUARD_EXIT" -ne 0 ]; then
    fail "CONTROLE FALSO ($cenario): o gate REPROVOU uma fixture sem defeito de parsing (exit $GUARD_EXIT)."
    fail "Sem este verde, o 'virou violação falsa' da mutação mede nada."
    echo "$GUARD_OUT" | tail -12
    exit 1
  fi
  if ! grep -qF "$EXPECTED_PASS" <<<"$GUARD_OUT"; then
    fail "$cenario: exit 0, mas SEM a headline de sucesso — o 0 veio de outro caminho."
    echo "$GUARD_OUT" | tail -12
    exit 1
  fi
}

# ── exigir_reprovado_embutido: reprovado pela TERCEIRA fonte (headline própria) ──
# As duas metades que identificam a classe: a headline do shell EMBUTIDO (`RUN`
# ou payload) e o ARQUIVO que o contém — sem o arquivo, o vermelho poderia vir
# de outra das três fontes e a mutação passaria medindo outra coisa.
exigir_reprovado_embutido() {
  local cenario="$1" headline="$2" arquivo="$3"
  if [ "$GUARD_EXIT" -eq 0 ]; then
    fail "CONTROLE FALSO ($cenario): o shell EMBUTIDO PASSOU (exit 0)."
    fail "Sem esta metade o 'ficou cego' da mutação mede nada (um gate já cego passaria)."
    echo "$GUARD_OUT" | tail -12
    exit 1
  fi
  if [ "$GUARD_EXIT" -ne 1 ]; then
    fail "$cenario: exit $GUARD_EXIT — o contrato é 1 (violação), não infra errada."
    echo "$GUARD_OUT" | tail -12
    exit 1
  fi
  if ! grep -qF "$headline" <<<"$GUARD_OUT"; then
    fail "$cenario: reprovou, mas NÃO pela headline da terceira fonte ('$headline')."
    echo "$GUARD_OUT" | tail -12
    exit 1
  fi
  if ! grep -qF "$arquivo" <<<"$GUARD_OUT"; then
    fail "$cenario: reprovou, mas NÃO citou o arquivo do texto embutido ('$arquivo')."
    echo "$GUARD_OUT" | tail -12
    exit 1
  fi
}

# ── exigir_falso_positivo_embutido: a mutação ACUSA um texto que é SÃO ────────
# A assinatura é o INVERSO da cegueira (M9-M11): o gate não fica verde, ele
# inventa uma violação de shell EMBUTIDO para um texto que o shell recebe sem
# defeito nenhum. A headline é a da terceira fonte — exigir a dos corpos `run:`
# mediria outra coisa (a mensagem de lá quebra em duas linhas, e por isso o
# `EXPECTED_ERRO` não serve aqui: o veredito é o do shell embutido).
exigir_falso_positivo_embutido() {
  local cenario="$1"
  if [ "$GUARD_EXIT" -eq 0 ]; then
    fail "GUARD INDIFERENTE ($cenario): com a mutação aplicada o gate AINDA passou (exit 0)."
    fail "Então o mecanismo mutado não é o que sustenta o 'não acusar' do veredito normal."
    echo "$GUARD_OUT" | tail -12
    exit 1
  fi
  if [ "$GUARD_EXIT" -ne 1 ]; then
    fail "$cenario: exit $GUARD_EXIT — o contrato é 1 (violação), não infra errada."
    echo "$GUARD_OUT" | tail -12
    exit 1
  fi
  if ! grep -qF "$EXPECTED_EMBUTIDO_PAYLOAD" <<<"$GUARD_OUT"; then
    fail "$cenario: reprovou, mas NÃO pela headline do shell embutido ('$EXPECTED_EMBUTIDO_PAYLOAD')."
    echo "$GUARD_OUT" | tail -12
    exit 1
  fi
}

# ── exigir_reprovado_script: reprovado pela SEGUNDA fonte, pelo motivo certo ──
exigir_reprovado_script() {
  local cenario="$1"
  if [ "$GUARD_EXIT" -eq 0 ]; then
    fail "CONTROLE FALSO ($cenario): o PARSE do arquivo de shell PASSOU (exit 0)."
    fail "Sem esta metade o 'ficou cego' do M7 mede nada (um gate já cego passaria)."
    echo "$GUARD_OUT" | tail -12
    exit 1
  fi
  if [ "$GUARD_EXIT" -ne 1 ]; then
    fail "$cenario: exit $GUARD_EXIT — o contrato é 1 (violação), não infra errada."
    echo "$GUARD_OUT" | tail -12
    exit 1
  fi
  if ! grep -qF "$EXPECTED_SCRIPTS" <<<"$GUARD_OUT"; then
    fail "$cenario: reprovou, mas NÃO pela asserção do arquivo ('$EXPECTED_SCRIPTS')."
    echo "$GUARD_OUT" | tail -12
    exit 1
  fi
  if ! grep -qF "scripts/quebrado.sh" <<<"$GUARD_OUT"; then
    fail "$cenario: reprovou, mas NÃO citou o ARQUIVO do script."
    echo "$GUARD_OUT" | tail -12
    exit 1
  fi
  if ! grep -qF 'interpretador: `bash`' <<<"$GUARD_OUT"; then
    fail "$cenario: reprovou, mas não disse QUAL interpretador julgou o arquivo."
    echo "$GUARD_OUT" | tail -12
    exit 1
  fi
}

# ── exigir_reprovado: o guard REAL tem de REPROVAR, pelo motivo certo ─────
exigir_reprovado() {
  local cenario="$1" esperado="$2"
  if [ "$GUARD_EXIT" -eq 0 ]; then
    fail "CONTROLE FALSO ($cenario): o guard PASSOU (exit 0) numa fixture de defeito."
    fail "A sensibilidade do guard caiu — sem ela o 'ficou cego' da mutação mede nada."
    echo "$GUARD_OUT" | tail -12
    exit 1
  fi
  if [ "$GUARD_EXIT" -ne 1 ]; then
    fail "$cenario: exit $GUARD_EXIT — o contrato é 1 (violação), não infra errada."
    echo "$GUARD_OUT" | tail -12
    exit 1
  fi
  if ! grep -qF "$EXPECTED_HEADLINE" <<<"$GUARD_OUT"; then
    fail "$cenario: reprovou, mas NÃO pela asserção esperada ('$EXPECTED_HEADLINE')."
    echo "$GUARD_OUT" | tail -12
    exit 1
  fi
  if ! grep -qF "$esperado" <<<"$GUARD_OUT"; then
    fail "$cenario: reprovou, mas NÃO citou '$esperado' (o diagnóstico não diz o que houve)."
    echo "$GUARD_OUT" | tail -12
    exit 1
  fi
  if ! grep -qF "pr-check.yml" <<<"$GUARD_OUT"; then
    fail "$cenario: reprovou, mas NÃO citou o ARQUIVO do passo."
    echo "$GUARD_OUT" | tail -12
    exit 1
  fi
}

# ── exigir_reprovado_shell: reprovado pelo motivo do SHELL (classe própria) ──
exigir_reprovado_shell() {
  local cenario="$1"
  if [ "$GUARD_EXIT" -eq 0 ]; then
    fail "CONTROLE FALSO ($cenario): o passo com um shell que o runner NÃO tem PASSOU."
    fail "Sem esta metade o 'ficou cego' do M5 mede nada (um gate já cego passaria em tudo)."
    echo "$GUARD_OUT" | tail -12
    exit 1
  fi
  if [ "$GUARD_EXIT" -ne 1 ]; then
    fail "$cenario: exit $GUARD_EXIT — o contrato é 1 (violação), não infra errada."
    echo "$GUARD_OUT" | tail -12
    exit 1
  fi
  if ! grep -qF "$EXPECTED_SHELL" <<<"$GUARD_OUT"; then
    fail "$cenario: reprovou, mas NÃO pela asserção do shell ('$EXPECTED_SHELL')."
    echo "$GUARD_OUT" | tail -12
    exit 1
  fi
  if ! grep -qF "$EXPECTED_SHELL_MOTIVO" <<<"$GUARD_OUT"; then
    fail "$cenario: reprovou, mas não disse o que o runner faria ('$EXPECTED_SHELL_MOTIVO')."
    echo "$GUARD_OUT" | tail -12
    exit 1
  fi
  if ! grep -qF "pr-check.yml" <<<"$GUARD_OUT"; then
    fail "$cenario: reprovou, mas NÃO citou o ARQUIVO do passo."
    echo "$GUARD_OUT" | tail -12
    exit 1
  fi
}

# ── rodar_fix: roda o `--fix` REAL contra a fixture (ÁRVORE) ────────────
rodar_fix() {
  set +e
  GUARD_OUT="$(node "$GUARD" --root "$FX" --fix 2>&1)"
  GUARD_EXIT=$?
  set -e
}

# ── exigir_cego: com a mutação aplicada o guard TEM de PASSAR ────────────
# "Cego" exige as DUAS coisas: exit 0 E a headline de SUCESSO. Um exit 0 que
# viesse de outro caminho (flag, --root) não é a mesma afirmação.
exigir_cego() {
  local cenario="$1"
  if [ "$GUARD_EXIT" -ne 0 ]; then
    fail "GUARD INDIFERENTE ($cenario): com a mutação aplicada o gate AINDA"
    fail "reprovou (exit $GUARD_EXIT) — o mecanismo mutado não é o que sustenta"
    fail "este veredito (ele é redundante — ou a mutação não fez o que dizia)."
    echo "$GUARD_OUT" | tail -12
    exit 1
  fi
  if ! grep -qF "$EXPECTED_PASS" <<<"$GUARD_OUT"; then
    fail "$cenario: exit 0, mas SEM a headline de sucesso — o 0 veio de outro caminho."
    echo "$GUARD_OUT" | tail -12
    exit 1
  fi
}

echo ""
echo "  ═════════════════════════════════════════════════════════════════"
echo "   🧪 SEVERINNO — MUTATION TEST (check-workflow-run-syntax deve CEGAR)"
echo "  ═════════════════════════════════════════════════════════════════"

# ═════════════════════════════════════════════════════════════════════════
# CONTROLE A — o guard REAL passa no repositório de verdade
# ═════════════════════════════════════════════════════════════════════════

header "CONTROLE A: o guard passa no repositório real (sem dívida)"

if (cd "$SCRIPT_DIR" && node "$GUARD") > "$TMP_DIR/ctrl-real.txt" 2>&1; then
  pass "guard PASS no repositório real (exit 0)"
else
  ctrl_exit=$?
  fail "guard FALHOU no repositório real (exit $ctrl_exit) — a mutação não pode"
  fail "prosseguir sobre uma árvore já vermelha (não se saberia o que cegou o quê)."
  cat "$TMP_DIR/ctrl-real.txt"
  exit 1
fi

# ═════════════════════════════════════════════════════════════════════════
# CONTROLE B — SENSIBILIDADE: as três fixtures de defeito são REPROVADAS
# ═════════════════════════════════════════════════════════════════════════

header "CONTROLE B: o guard REAL reprova as três fixtures de defeito"

# Corpo SÃO, com expressão do runner que tem `}` DENTRO — o corpo que uma
# máscara gulosa "engole" e um mascaramento certo preserva.
cat > "$TMP_DIR/b-valido.sh" <<'BODY'
if [ "${{ vars.MODE || 'a}b' }}" = "1" ]; then
  echo ok
fi
BODY

# ERRO de sintaxe: `if` sem `fi` (o bash sai 2).
cat > "$TMP_DIR/b-sem-fi.sh" <<'BODY'
if [ 1 = 1 ]; then
  echo ok
BODY

# AVISO: heredoc SEM terminador — o bash SAI 0 e só avisa (Cenário M1).
cat > "$TMP_DIR/b-heredoc.sh" <<'BODY'
cat <<'EOF'
conteudo
BODY

# MÁSCARA: defeito REAL entre DUAS expressões do runner na MESMA linha. Com a
# máscara LAZY (a do repositório) a aspa aberta sobrevive ao mascaramento e é
# julgada; com a GULOSA (Cenário M3) ela é engolida junto com o trecho entre as
# duas expressões — e o defeito desaparece.
cat > "$TMP_DIR/b-mascara.sh" <<'BODY'
echo "${{ vars.A }}" ; echo "nao fecha ; echo "${{ vars.B }}"
BODY

mkfixture "Passo são" "$TMP_DIR/b-valido.sh"
rodar_guard
if [ "$GUARD_EXIT" -ne 0 ]; then
  fail "CONTROLE FALSO: o guard reprovou o corpo SÃO (exit $GUARD_EXIT) — o"
  fail "mascaramento está inventando erro num corpo válido."
  echo "$GUARD_OUT" | tail -12
  exit 1
fi
pass "CONTROLE B.0: o corpo SÃO passa (exit 0) — o mascaramento não inventa erro"

mkfixture "If sem fi" "$TMP_DIR/b-sem-fi.sh"
rodar_guard
exigir_reprovado "CONTROLE B.1 (ERRO)" "$EXPECTED_ERRO"
pass "CONTROLE B.1: \`if\` sem \`fi\` REPROVADO por ERRO de sintaxe (arquivo + linha)"

mkfixture "Heredoc truncado" "$TMP_DIR/b-heredoc.sh"
rodar_guard
exigir_reprovado "CONTROLE B.2 (AVISO)" "$EXPECTED_AVISO"
pass "CONTROLE B.2: heredoc sem terminador REPROVADO por AVISO (o bash saiu 0)"

# A premissa do B.2, medida no PRÓPRIO corpo: o exit code do bash NÃO bastaria.
set +e
BASH_ERR="$(LC_ALL=C bash -n "$TMP_DIR/b-heredoc.sh" 2>&1)"
BASH_EXIT=$?
set -e
if [ "$BASH_EXIT" -ne 0 ]; then
  fail "A premissa do cenário caiu: \`bash -n\` saiu $BASH_EXIT (esperado 0 — AVISO)."
  echo "$BASH_ERR"
  exit 1
fi
if ! grep -qi "warning" <<<"$BASH_ERR"; then
  fail "A premissa do cenário caiu: o bash saiu 0 e NÃO avisou (sem heredoc aberto?)."
  echo "$BASH_ERR"
  exit 1
fi
pass "Medido: o \`bash -n\` DESSE corpo sai 0 e só AVISA — o exit code sozinho o aprovaria"

mkfixture "Defeito entre expressões" "$TMP_DIR/b-mascara.sh"
rodar_guard
exigir_reprovado "CONTROLE B.3 (máscara)" "$EXPECTED_ERRO"
pass "CONTROLE B.3: o defeito ENTRE as duas expressões é REPROVADO (a máscara para no primeiro \`}}\`)"

# ═════════════════════════════════════════════════════════════════════════
# MUTAÇÃO M1 — a METADE DO AVISO (`ok` = exit 0 E stderr vazio)
# ═════════════════════════════════════════════════════════════════════════

header "MUTAÇÃO M1: sem a metade do AVISO o heredoc truncado passa"

mutar_guard '    ok: r.status === 0 && stderr === "",' '    ok: r.status === 0, // MUTACAO M1: só o exit code'

mkfixture "Heredoc truncado" "$TMP_DIR/b-heredoc.sh"
rodar_guard
exigir_cego "M1 no heredoc truncado"
pass "M1 DETECTADA: sem \`stderr === \"\"\` o corpo que o bash APROVOU passa (CEGO)"

mkfixture "If sem fi" "$TMP_DIR/b-sem-fi.sh"
rodar_guard
exigir_reprovado "M1 cirúrgica" "$EXPECTED_ERRO"
pass "M1 CIRÚRGICA: o ERRO de sintaxe continua reprovado — morreu só a metade do AVISO"

restaurar_originais
pass "fontes RESTAURADAS (os dois checksums conferem)"

# ═════════════════════════════════════════════════════════════════════════
# MUTAÇÃO M2 — o STDIN do bash (o corpo como `input` do `bash -n`)
# ═════════════════════════════════════════════════════════════════════════

header "MUTAÇÃO M2: sem o corpo no stdin o bash julga um programa VAZIO"

mutar_guard '    input: body,' '    input: "", // MUTACAO M2: o corpo nao chega ao bash'

for fixture in "If sem fi:b-sem-fi.sh" "Heredoc truncado:b-heredoc.sh" "Defeito entre expressões:b-mascara.sh"; do
  nome="${fixture%%:*}"
  arquivo="${fixture##*:}"
  mkfixture "$nome" "$TMP_DIR/$arquivo"
  rodar_guard
  exigir_cego "M2 em '$nome'"
done
pass "M2 DETECTADA: com stdin vazio TODO corpo passa (CEGO em erro, em aviso e entre expressões)"

mkfixture "Passo são" "$TMP_DIR/b-valido.sh"
rodar_guard
if [ "$GUARD_EXIT" -ne 0 ]; then
  fail "M2 quebrou o CONTROLE: um corpo SÃO passou a ser reprovado — a mutação"
  fail "não é 'julgar menos', é julgar outra coisa (não se pode concluir cegueira)."
  echo "$GUARD_OUT" | tail -12
  exit 1
fi
pass "M2 não inventa violação: o corpo SÃO segue passando (a cegueira é só para baixo)"

restaurar_originais
pass "fontes RESTAURADAS (os dois checksums conferem)"

# ═════════════════════════════════════════════════════════════════════════
# MUTAÇÃO M3 — a MÁSCARA gulosa (`[^}]*` → `[\s\S]*`)
# ═════════════════════════════════════════════════════════════════════════

header "MUTAÇÃO M3: com a máscara gulosa o defeito entre expressões desaparece"

mutar_regua 'export const DYNAMIC_EXPR_RE = /\$\{\{[^}]*\}\}/g' 'export const DYNAMIC_EXPR_RE = /\$\{\{[\s\S]*\}\}/g /* MUTACAO M3: mascara GULOSA (engole alem da expressao) */'

mkfixture "Defeito entre expressões" "$TMP_DIR/b-mascara.sh"
rodar_guard
exigir_cego "M3 no defeito entre expressões"
pass "M3 DETECTADA: a máscara gulosa engoliu o defeito junto com o trecho (CEGO)"

mkfixture "If sem fi" "$TMP_DIR/b-sem-fi.sh"
rodar_guard
exigir_reprovado "M3 cirúrgica (erro)" "$EXPECTED_ERRO"
mkfixture "Passo são" "$TMP_DIR/b-valido.sh"
rodar_guard
if [ "$GUARD_EXIT" -ne 0 ]; then
  fail "M3 quebrou o CONTROLE: o corpo SÃO passou a ser reprovado."
  echo "$GUARD_OUT" | tail -12
  exit 1
fi
pass "M3 CIRÚRGICA: o ERRO de sintaxe segue reprovado e o corpo SÃO segue passando"

restaurar_originais
pass "fontes RESTAURADAS (os dois checksums conferem)"

# ═════════════════════════════════════════════════════════════════════════
# MUTAÇÃO M4 — o ÍNDICE do recorte `--staged` (o modo do pre-commit)
# ═════════════════════════════════════════════════════════════════════════

header "MUTAÇÃO M4: ler a ÁRVORE no --staged cega o recorte do pre-commit"

# Fixture PRÓPRIA, com git de verdade: o ÍNDICE carrega o corpo QUEBRADO e a
# árvore já tem a versão corrigida — o instante em que o commit leva um defeito
# que o editor já consertou. É o caso que só o recorte pega.
FXS="$TMP_DIR/fx-staged"
mkfixture_raiz "$FXS" "If sem fi" "$TMP_DIR/b-sem-fi.sh"
if ! (cd "$FXS" && git init -q . && git add -A) > /dev/null 2>&1; then
  fail "o fixture git do M4 não pôde ser criado (git init/add) — sem índice não há recorte a medir"
  exit 1
fi
if [ -z "$(cd "$FXS" && git diff --cached --name-only)" ]; then
  fail "o M4 não aplicou: nada no ÍNDICE (o `git add` não pegou o workflow)"
  exit 1
fi
pass "Fixture git criado: o ÍNDICE tem o corpo quebrado (git add antes da correção)"

# O editor corrige a ÁRVORE — o commit continua com o defeito.
mkfixture_raiz "$FXS" "Passo são" "$TMP_DIR/b-valido.sh"

rodar_staged "$FXS"
exigir_reprovado "CONTROLE M4 (índice quebrado, árvore corrigida)" "$EXPECTED_ERRO"
pass "CONTROLE M4: o recorte reprova o corpo do ÍNDICE mesmo com a árvore corrigida"

mutar_guard '      conteudo = staged ? readIndexFile(root, w.path) : readJudgedFile(join(root, w.path), w.path)' '      conteudo = readJudgedFile(join(root, w.path), w.path) // MUTACAO M4: a arvore, nao o indice'
rodar_staged "$FXS"
exigir_cego "M4 no recorte --staged"
pass "M4 DETECTADA: lendo a árvore, o recorte APROVA o commit que ainda carrega o defeito (CEGO)"

# Cirúrgica: a mutação derrubou só o caminho do ÍNDICE — o gate da ÁRVORE (o
# que o CI roda) segue reprovando o MESMO defeito.
mkfixture "If sem fi" "$TMP_DIR/b-sem-fi.sh"
rodar_guard
exigir_reprovado "M4 cirúrgica (árvore)" "$EXPECTED_ERRO"
pass "M4 CIRÚRGICA: o gate da ÁRVORE segue reprovando (a mutação matou só o índice)"

restaurar_originais
pass "fontes RESTAURADAS (os dois checksums conferem)"

# ═════════════════════════════════════════════════════════════════════════
# MUTAÇÃO M5 — o CONJUNTO DE SHELLS (o `shell:` declarado existe no runner?)
# ═════════════════════════════════════════════════════════════════════════

header "MUTAÇÃO M5: aceitar qualquer shell declarado cega o gate da SEMÂNTICA"

# O fixture: um passo com `shell: pwsh` num runner que a MEDIÇÃO diz não ter
# `pwsh`. O corpo é irrelevante (o bash não é o interpretador dele) — o que o
# passo AFIRMA é sobre o RUNNER, e é essa afirmação que o gate julga.
cat > "$TMP_DIR/b-shell.sh" <<'BODY'
Write-Host oi
BODY
mkfixture_shell() {
  mkdir -p "$FX/.github/workflows"
  {
    printf 'jobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n'
    printf '      - name: passo com shell que o runner NAO tem\n        shell: pwsh\n        run: |\n'
    sed 's/^/          /' "$TMP_DIR/b-shell.sh"
  } > "$WF"
}

mkfixture_shell
rodar_guard
exigir_reprovado_shell "CONTROLE M5 (shell que o runner não tem)"
pass "CONTROLE M5: o passo com \`shell: pwsh\` é REPROVADO (o runner não tem \`pwsh\`)"

mutar_guard '      const caminho = RUNNER_SHELLS[info.command]' '      const caminho = RUNNER_SHELLS[info.command] || "/usr/bin/qualquer" // MUTACAO M5: aceita qualquer shell'

mkfixture_shell
rodar_guard
exigir_cego "M5 no shell que o runner não tem"
pass "M5 DETECTADA: aceitando qualquer nome como presente, o passo que quebraria o job PASSA (CEGO)"

# Cirúrgica: a mutação matou só a metade do SHELL — o parsing continua mordendo.
mkfixture "If sem fi" "$TMP_DIR/b-sem-fi.sh"
rodar_guard
exigir_reprovado "M5 cirúrgica (parsing)" "$EXPECTED_ERRO"
pass "M5 CIRÚRGICA: o ERRO de sintaxe segue reprovado (a mutação matou só a semântica)"

restaurar_originais
pass "fontes RESTAURADAS (os dois checksums conferem)"

# ═════════════════════════════════════════════════════════════════════════
# MUTAÇÃO M6 — a GUARDA DO CORPO VAZIO no `--fix`
# ═════════════════════════════════════════════════════════════════════════

header "MUTAÇÃO M6: sem a guarda do corpo vazio o fixer APAGA o passo e o gate fica verde"

# A cicatriz que é o corpo INTEIRO: uma reescrita que engoliu o comando deixando
# só o operador. O corpo `&&` sozinho é erro de sintaxe — e o remendo que tira o
# operador deixaria o corpo SEM NADA (é o caso que a guarda existe para recusar).
cat > "$TMP_DIR/b-vazio.sh" <<'BODY'
&&
BODY

mkfixture "Corpo que viraria vazio" "$TMP_DIR/b-vazio.sh"
rodar_guard
exigir_reprovado "CONTROLE M6 (corpo com o operador sozinho)" "$EXPECTED_ERRO"
pass "CONTROLE M6: o corpo \`&&\` sozinho é REPROVADO por ERRO de sintaxe"

rodar_fix
if [ "$GUARD_EXIT" -ne 1 ]; then
  fail "CONTROLE M6 (fixer): esperado exit 1 (recusa), veio $GUARD_EXIT."
  echo "$GUARD_OUT" | tail -12
  exit 1
fi
if ! grep -qF "$EXPECTED_FIX_VAZIO" <<<"$GUARD_OUT"; then
  fail "CONTROLE M6 (fixer): o fixer não recusou pelo motivo certo (corpo VAZIO)."
  echo "$GUARD_OUT" | tail -12
  exit 1
fi
if ! grep -qF '&&' "$WF"; then
  fail "CONTROLE M6 (fixer): o arquivo foi ALTERADO apesar da recusa."
  exit 1
fi
pass "CONTROLE M6 (fixer): o fixer RECUSA e o arquivo fica como estava"

mutar_guard '  if (novo.trim() === "") {' '  if (false) { // MUTACAO M6: deixa remendar para um corpo VAZIO'

mkfixture "Corpo que viraria vazio" "$TMP_DIR/b-vazio.sh"
rodar_guard
exigir_reprovado "M6 controle (antes do fix)" "$EXPECTED_ERRO"
rodar_fix
if [ "$GUARD_EXIT" -ne 0 ]; then
  fail "M6: o fixer mutado não terminou em 0 (exit $GUARD_EXIT) — a cegueira não se deu."
  echo "$GUARD_OUT" | tail -12
  exit 1
fi
if ! grep -qF "$EXPECTED_FIX_OK" <<<"$GUARD_OUT"; then
  fail "M6: o fixer mutado não relatou remendo — o 0 veio de outro caminho."
  echo "$GUARD_OUT" | tail -12
  exit 1
fi
pass "M6 (fixer): o fixer mutado GRAVA o remendo e RELATA sucesso"

# O que isso custa no GATE: o corpo virou VAZIO, e um corpo vazio não tem
# sintaxe a julgar — o passo que já não roda nada sai como ✅.
rodar_guard
exigir_cego "M6 no gate depois do fix"
if grep -qF '&&' "$WF"; then
  fail "M6: o arquivo ainda tem o operador — o remendo não aplicou (nada foi provado)."
  exit 1
fi
pass "M6 DETECTADA: o passo foi ESVAZIADO e o gate passa a dar VERDE para ele (CEGO)"

restaurar_originais
pass "fontes RESTAURADAS (os dois checksums conferem)"

# ═════════════════════════════════════════════════════════════════════════
# MUTAÇÃO M7 — a SEGUNDA FONTE (os scripts de shell que o passo executa)
# ═════════════════════════════════════════════════════════════════════════

header "MUTAÇÃO M7: tirar a segunda fonte cega o gate para um script quebrado"

# Fixture PRÓPRIA: UM script quebrado e NENHUM workflow. O veredito que sobra é
# o da segunda fonte — o que o repositório tinha fora do radar, porque
# `bash scripts/x.sh` morre no PASSO (depois do setup) e nenhum parser de YAML
# vê isso.
FXS2="$TMP_DIR/fx-script"
mkdir -p "$FXS2/scripts"
cat > "$FXS2/scripts/quebrado.sh" <<'BODY'
#!/usr/bin/env bash
if [ 1 = 1 ]; then
  echo sem fi
BODY

rodar_guard_em "$FXS2"
exigir_reprovado_script "CONTROLE M7 (script sem fi)"
pass "CONTROLE M7: o ARQUIVO de shell é REPROVADO (com o arquivo e o interpretador)"

mutar_guard '    for (const script of arquivos.scripts) {' '    for (const script of []) { // MUTACAO M7: a segunda fonte fora da varredura'

rodar_guard_em "$FXS2"
exigir_cego "M7 no script quebrado"
pass "M7 DETECTADA: sem a segunda fonte o gate APROVA o script quebrado (CEGO)"

# Cirúrgica: a mutação matou só a segunda fonte — o parsing dos corpos `run:`
# (a metade que já existia) segue reprovando o mesmo tipo de defeito.
mkfixture "If sem fi" "$TMP_DIR/b-sem-fi.sh"
rodar_guard
exigir_reprovado "M7 cirúrgica (corpo run:)" "$EXPECTED_ERRO"
pass "M7 CIRÚRGICA: o corpo \`run:\` quebrado segue reprovado (morreu só o arquivo)"

restaurar_originais
pass "fontes RESTAURADAS (os dois checksums conferem)"

# ═════════════════════════════════════════════════════════════════════════
# MUTAÇÃO M8 — o PULO NOMEADO do passo NÃO-bash (`isBashShell`)
# ═════════════════════════════════════════════════════════════════════════

header "MUTAÇÃO M8: forçar isBashShell a true julga o passo que deveria ser PULADO"

# O fixture: um passo com `shell: python3` — um shell que a imagem MEDIDA tem —
# e um corpo que o PYTHON aceita e o BASH recusa (`print(1)`). É esse par que
# separa "julgar" de "pular": o corpo é legítimo no interpretador DELE, e
# julgar todo shell como bash inventaria uma violação para um passo são.
cat > "$TMP_DIR/b-python.sh" <<'BODY'
print(1)
BODY

mkfixture_python() {
  mkdir -p "$FX/.github/workflows"
  {
    printf 'jobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n'
    printf '      - name: passo python legitimo\n        shell: python3\n        run: |\n'
    sed 's/^/          /' "$TMP_DIR/b-python.sh"
  } > "$WF"
}

mkfixture_python
rodar_guard
exigir_pulado_nomeado "CONTROLE M8 (passo python legítimo)"
pass "CONTROLE M8: o passo python PASSA e sai NOMEADO como pulado (com o shell que o runner tem)"

# A SEGUNDA TESTEMUNHA precisa estar VIVA antes de medir: uma suíte que já está
# vermelha por ambiente "mata" qualquer mutante, e o teste passaria por engano.
# Onde o vitest não está instalado, o motivo é DITO (nunca silencioso).
suite_disponivel() { [ -d "$SCRIPT_DIR/node_modules/vitest" ]; }
suite_disponivel && rodar_suite
if suite_disponivel; then
  if [ "$SUITE_EXIT" -ne 0 ]; then
    fail "CONTROLE M8 (suíte): a suíte unitária está VERMELHA com o guard INTACTO (exit $SUITE_EXIT)."
    fail "Uma testemunha já vermelha mata qualquer mutante — ela mediria nada."
    echo "$SUITE_OUT"
    exit 1
  fi
  pass "CONTROLE M8 (suíte): VERDE com o guard intacto — a segunda testemunha está viva"
else
  info "CONTROLE M8 (suíte): NÃO julgada — node_modules/vitest ausente neste job (declarado, nunca silencioso)"
fi

mutar_guard '  return /^(?:[\w./-]*\/)?(?:bash|sh)(?:\s|$)/.test(s)' '  return true // MUTACAO M8: todo shell passa por bash'

mkfixture_python
rodar_guard
exigir_falso_positivo "M8 no passo python"
pass "M8 DETECTADA pelo GATE: com todo shell virando bash ele ACUSA o passo python (violação FALSA)"

if suite_disponivel; then
  rodar_suite
  if [ "$SUITE_EXIT" -eq 0 ]; then
    fail "M8 NÃO DETECTADA pela suíte: a testemunha unitária PASSOU com isBashShell forçado a true."
    echo "$SUITE_OUT"
    exit 1
  fi
  pass "M8 DETECTADA também pela SUÍTE (exit $SUITE_EXIT) — as duas testemunhas concordam"
fi

# Cirúrgica: a mutação matou só o PULO — o parsing dos corpos segue mordendo.
mkfixture "If sem fi" "$TMP_DIR/b-sem-fi.sh"
rodar_guard
exigir_reprovado "M8 cirúrgica (corpo bash)" "$EXPECTED_ERRO"
pass "M8 CIRÚRGICA: o corpo bash quebrado segue reprovado (a mutação matou só o pulo)"

restaurar_originais
pass "fontes RESTAURADAS (os dois checksums conferem)"

# ═════════════════════════════════════════════════════════════════════════
# MUTAÇÃO M9 — a TERCEIRA FONTE: a instrução `RUN` de um Dockerfile
# ═════════════════════════════════════════════════════════════════════════

header "MUTAÇÃO M9: tirar o \`RUN\` da varredura cega o gate no shell do BUILD"

# Fixture PRÓPRIA: UM Dockerfile com a cicatriz MECÂNICA que a reescrita produz
# (a continuação `\` que engole a linha seguinte) e NENHUM workflow. O veredito
# que sobra é o do shell EMBUTIDO — o texto que morre no MEIO de um
# `docker build`, depois de minutos, e que nenhum guard que LÊ o Dockerfile vê
# (o arquivo continua sendo um Dockerfile válido).
FXDF="$TMP_DIR/fx-dockerfile"
mkdir -p "$FXDF"
cat > "$FXDF/Dockerfile" <<'DOCKERFILE'
FROM alpine
RUN set -euo pipefail && \
  echo dois &&
DOCKERFILE

rodar_guard_em "$FXDF"
exigir_reprovado_embutido "CONTROLE M9 (RUN com operador pendente)" "$EXPECTED_EMBUTIDO_RUN" "Dockerfile:2"
pass "CONTROLE M9: a instrução RUN é REPROVADA (a continuação é juntada antes do bash)"

mutar_guard '    if (DOCKERFILE_RE.test(rel)) {' '    if (false) { // MUTACAO M9: o RUN do Dockerfile fora da varredura'

rodar_guard_em "$FXDF"
exigir_cego "M9 no RUN quebrado"
pass "M9 DETECTADA: sem o shell do BUILD na varredura o gate APROVA o Dockerfile (CEGO)"

# Cirúrgica: morreu só o `RUN` — o corpo `run:` sem `fi` (a PRIMEIRA fonte) segue
# reprovando o mesmo tipo de defeito.
mkfixture "If sem fi" "$TMP_DIR/b-sem-fi.sh"
rodar_guard
exigir_reprovado "M9 cirúrgica (corpo run:)" "$EXPECTED_ERRO"
pass "M9 CIRÚRGICA: o corpo \`run:\` quebrado segue reprovado (morreu só o Dockerfile)"

restaurar_originais
pass "fontes RESTAURADAS (os dois checksums conferem)"

# ═════════════════════════════════════════════════════════════════════════
# MUTAÇÃO M10 — o PAYLOAD de um `sh -c` embutido num SCRIPT
# ═════════════════════════════════════════════════════════════════════════

header "MUTAÇÃO M10: tirar o payload da varredura cega o gate para o shell embutido"

# Fixture PRÓPRIA: UM script cujo `bash -n` PASSA (a metade da segunda fonte
# fica verde) e cujo payload de `sh -c` NÃO faz parsing. É exatamente o buraco:
# para o parser do arquivo, o payload é uma STRING — nenhum dos oito guards
# anteriores o julga.
FXPL="$TMP_DIR/fx-payload"
mkdir -p "$FXPL/scripts"
cat > "$FXPL/scripts/quebra.sh" <<'BODY'
#!/usr/bin/env bash
set -euo pipefail
sh -c "if [ 1 = 1 ]; then echo sem fi"
BODY

rodar_guard_em "$FXPL"
exigir_reprovado_embutido "CONTROLE M10 (payload com if sem fi)" "$EXPECTED_EMBUTIDO_PAYLOAD" "scripts/quebra.sh:3"
pass "CONTROLE M10: o PAYLOAD é REPROVADO (e o arquivo que o contém passa no \`bash -n\`)"

mutar_guard '      emb = embeddedPayloads(conteudo)' '      emb = { payloads: [], pular: [], indeterminado: [] } // MUTACAO M10: o payload fora da varredura'

rodar_guard_em "$FXPL"
exigir_cego "M10 no payload embutido"
pass "M10 DETECTADA: sem a terceira fonte o gate APROVA o script com o payload quebrado"

# Cirúrgica: os corpos `run:` seguem mordendo.
mkfixture "If sem fi" "$TMP_DIR/b-sem-fi.sh"
rodar_guard
exigir_reprovado "M10 cirúrgica (corpo run:)" "$EXPECTED_ERRO"
pass "M10 CIRÚRGICA: o corpo \`run:\` quebrado segue reprovado (morreu só o payload)"

restaurar_originais
pass "fontes RESTAURADAS (os dois checksums conferem)"

# ═════════════════════════════════════════════════════════════════════════
# MUTAÇÃO M11 — o payload de um COMPOSE (a leitura do YAML)
# ═════════════════════════════════════════════════════════════════════════

header "MUTAÇÃO M11: tirar a leitura do YAML cega o gate no \`entrypoint:\` do compose"

# O `entrypoint` em LISTA é o caso que uma varredura de TEXTO erra: ela lê a
# sintaxe do YAML (`- /bin/sh`, `- -c`, `- |`) como se fosse shell. Aqui o texto
# do script é um elemento de lista, e é ele que tem de ser julgado.
FXCP="$TMP_DIR/fx-compose"
mkdir -p "$FXCP"
cat > "$FXCP/docker-compose.dev.yml" <<'BODY'
services:
  a:
    entrypoint:
      - /bin/sh
      - -c
      - |
        if [ 1 = 1 ]; then
          echo sem fi
BODY

rodar_guard_em "$FXCP"
exigir_reprovado_embutido "CONTROLE M11 (entrypoint em lista)" "$EXPECTED_EMBUTIDO_PAYLOAD" "docker-compose.dev.yml"
pass "CONTROLE M11: o CORPO do \`- |\` é REPROVADO (não a marca de lista do YAML)"

mutar_guard '      emb = yamlEmbeddedPayloads(parsed.doc, conteudo)' '      emb = { payloads: [], pular: [], indeterminado: [] } // MUTACAO M11: o YAML nao entra na varredura'

rodar_guard_em "$FXCP"
exigir_cego "M11 no entrypoint em lista"
pass "M11 DETECTADA: sem a leitura do YAML o gate APROVA o compose quebrado"

restaurar_originais
pass "fontes RESTAURADAS (os dois checksums conferem)"

# ═════════════════════════════════════════════════════════════════════════
# MUTAÇÃO M12 — o ESCAPE do compose (`$$`) não é sintaxe de shell
# ═════════════════════════════════════════════════════════════════════════

header "MUTAÇÃO M12: sem desfazer o \`\$\$\` do compose o gate ACUSA um texto são"

# A assinatura desta mutação é o FALSO POSITIVO (como o M8): sem desfazer o
# escape, o texto que o shell RECEBE (`$(...)`) é julgado como está escrito
# (`$$(...)`) — e para o bash `$$` é o PID, então o parêntese fica solto. Medido
# no repositório: é exatamente o que aconteceu em `docker-compose.prod.yml`
# antes desta metade existir.
FXESC="$TMP_DIR/fx-escape"
mkdir -p "$FXESC"
cat > "$FXESC/docker-compose.dev.yml" <<'BODY'
services:
  a:
    entrypoint: >
      /bin/sh -c "
      RESPONSE=$$(curl -s http://x)
      "
BODY

rodar_guard_em "$FXESC"
exigir_aprovado "CONTROLE M12 (payload com o escape do compose)"
pass "CONTROLE M12: o payload com \`\$\$\` PASSA (o shell do container recebe \`\$(...)\`)"

mutar_guard '  return String(text ?? "").replace(/\$\$/g, "$")' '  return String(text ?? "") // MUTACAO M12: o escape do compose nao e desfeito'

rodar_guard_em "$FXESC"
exigir_falso_positivo_embutido "M12 no payload com $$ do compose"
pass "M12 DETECTADA pelo GATE: sem o de-escape ele ACUSA um payload são (violação FALSA)"

restaurar_originais
pass "fontes RESTAURADAS (os dois checksums conferem)"

# ═════════════════════════════════════════════════════════════════════════
# MUTAÇÃO M13 — o corpo do HEREDOC é DADO, não código
# ═════════════════════════════════════════════════════════════════════════

header "MUTAÇÃO M13: ler o heredoc como código ACUSA os fixtures que escrevem shell"

# Sem o pulo do heredoc, o TEXTO de dado vira programa — e o falso positivo cai
# em cima de quem escreve fixture: os próprio mutation tests do repositório
# escrevem shell quebrado DENTRO de heredoc de propósito (o caso do M10 acima).
# A fixture é a MESMA do M10: um script cujo heredoc contém o payload quebrado e
# cujo código NÃO tem defeito nenhum.
FXHD="$TMP_DIR/fx-heredoc"
mkdir -p "$FXHD/scripts"
cat > "$FXHD/scripts/fixture.sh" <<'BODY'
#!/usr/bin/env bash
set -euo pipefail
cat > /tmp/x.sh <<'FIXTURE'
sh -c "if [ 1 = 1 ]; then echo sem fi"
FIXTURE
bash -n /tmp/x.sh
BODY

rodar_guard_em "$FXHD"
exigir_aprovado "CONTROLE M13 (heredoc com shell quebrado como DADO)"
pass "CONTROLE M13: o heredoc com shell quebrado dentro NÃO vira violação (é dado)"

mutar_guard '      if (heredocs.length > 0) pulaHeredoc()' '      if (false) pulaHeredoc() // MUTACAO M13: o corpo do heredoc vira codigo'

rodar_guard_em "$FXHD"
exigir_falso_positivo_embutido "M13 no heredoc"
pass "M13 DETECTADA pelo GATE: sem o pulo ele ACUSA o heredoc de um fixture são"

restaurar_originais
pass "fontes RESTAURADAS (os dois checksums conferem)"

# ═════════════════════════════════════════════════════════════════════════
# CONTROLE FINAL — a árvore voltou ao comportamento original
# ═════════════════════════════════════════════════════════════════════════

header "CONTROLE FINAL: o guard restaurado volta a reprovar o \`if\` sem \`fi\`"

mkfixture "If sem fi" "$TMP_DIR/b-sem-fi.sh"
rodar_guard
exigir_reprovado "CONTROLE FINAL" "$EXPECTED_ERRO"
pass "CONTROLE FINAL: depois das TREZE mutações o guard reprova de novo (árvore íntegra)"

# ── Veredito ──────────────────────────────────────────────────────────────

echo ""
echo "  ═════════════════════════════════════════════════════════════════"
echo -e "   ${GREEN}✅ MUTATION TEST PASSOU${NC} — os TREZE mecanismos são LOAD-BEARING:"
echo "      • a metade do AVISO (heredoc truncado, bash sai 0) → mutá-la cega"
echo "      • o stdin do bash (o corpo julgado) → mutá-lo cega tudo"
echo "      • a máscara LAZY (para no primeiro }}) → torná-la gulosa cega"
echo "      • o ÍNDICE do recorte --staged (o commit) → ler a árvore cega o hook"
echo "      • o conjunto de SHELLS medido na imagem → aceitar qualquer nome cega"
echo "      • a guarda do corpo VAZIO no --fix → sem ela o fixer apaga o passo"
echo "      • a SEGUNDA fonte (os scripts de shell) → tirá-la cega o arquivo que o passo executa"
echo "      • o PULO NOMEADO do passo não-bash → forçá-lo a julgar ACUSA um passo são"
echo "      • a TERCEIRA fonte, o RUN do Dockerfile → tirá-la cega o shell do BUILD"
echo "      • a TERCEIRA fonte, o payload do sh -c → tirá-la cega o que o bash -n do arquivo não vê"
echo "      • a leitura por ESTRUTURA do YAML → ler o texto lê a sintaxe do YAML no lugar do script"
echo "      • o de-escape do compose (\$\$) → sem ele o gate julga o texto que o shell NÃO recebe"
echo "      • o pulo do HEREDOC (o corpo é dado) → sem ele o gate acusa os próprios fixtures"
echo "      e cada mutação é CIRÚRGICA: as outras metades seguem mordendo."
echo "  ═════════════════════════════════════════════════════════════════"
echo ""
