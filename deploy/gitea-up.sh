#!/usr/bin/env bash
# =============================================================================
# deploy/gitea-up.sh — Sobe a stack da forja GARANTINDO antes que a imagem do
# runner existe no registry.
#
# Por que existe: o `depends_on` do compose só ordena containers, não o mundo
# externo. Os labels do runner apontam para
# <registry>/<namespace>/ubuntu-bun:<BUN_VERSION> e, se a tag não estiver
# publicada (ou o pacote estiver privado), TODO job falha ao iniciar o
# container — longe da causa. Este script torna a publicação um PRÉ-REQUISITO
# mecânico: o env tem de espelhar o template comitado, a imagem tem de existir
# no registry (`scripts/ensure-runner-image.mjs` confirma e publica se preciso) e
# a prontidão da forja tem de estar provada (`scripts/forge-doctor.mjs`) — só
# então o Gitea/Caddy sobem e, por último, o runner.
#
# A ordem é invariante (o guard checkGiteaBringUp falha se ela for invertida):
# o `up -d runner` NÃO pode vir antes da garantia da imagem, e nenhum `up` pode
# vir antes do veredito de prontidão (o doctor).
#
# Usage:
#   bash deploy/gitea-up.sh                     # confere env + imagem + prontidão + sobe tudo
#   bash deploy/gitea-up.sh --check-only        # só confere (env + imagem + prontidão); não sobe nada
#   bash deploy/gitea-up.sh --no-runner         # sobe só Gitea + Caddy (pula os pré-requisitos do runner)
#   bash deploy/gitea-up.sh --re-register       # confere + garante + re-registra o runner
#   bash deploy/gitea-up.sh --local-image       # host SEM REGISTRY: aceita a CÓPIA LOCAL da
#                                               # imagem como prova do pré-requisito 1
#   ENV_FILE=deploy/.env.gitea bash deploy/gitea-up.sh
#
# TRÊS PRÉ-REQUISITOS, nesta ordem:
#   0. o env do host ESPELHA o template comitado (scripts/check-env-mirror.mjs) —
#      o ensure resolve a imagem DESTE arquivo; um env divergente garantiria a
#      imagem errada. Recusar aqui torna o pré-requisito mecânico (o gate
#      `check:registry-source` é o relatório completo, mas dependia de alguém
#      lembrar de rodá-lo);
#   1. a imagem do runner EXISTE no registry (scripts/ensure-runner-image.mjs);
#   2. a PRONTIDÃO da forja está provada (scripts/forge-doctor.mjs) — o veredito
#      BLOQUEADA recusa a subida. Sem este passo, a subida dependia de alguém
#      lembrar de rodar o doctor: a stack subia num estado que não segura o merge,
#      e o único sinal era um comando que ninguém rodou.
#
# O doctor é chamado INTEIRO (sem flags --no-* que escondam fatos) e com `--no-runner-labels`
# quando --re-register — o registro velho é EXATAMENTE o que o re-registro
# conserta, e bloquear aqui travaria o remédio pelo estado que ele cura.
#
# POR QUE O DOCTOR INTEIRO (sem --no-proof — flag removida): a prova do bloqueio dele EXECUTA
# este script, então desligá-la parecia a única forma de não recursar. Não é: a
# prova DUBLA o doctor que ela passa ao bring-up (`DOCTOR_SCRIPT` apontando para
# um dublê que NÃO executa a prova), e é essa dublagem que faz
# `bring-up → doctor → prova → bring-up` terminar em UM nível. O corte é MEDIDO,
# não prometido: cada caso da prova exige que o doctor invocado tenha sido o
# dublê, e a cadeia inteira — com o doctor REAL aqui dentro — é provada por
# execução em `src/lib/__tests__/prove-runner-image-gate.test.ts`. Com a prova
# ligada o veredito desta subida deixa de ser parcial POR CONSTRUÇÃO: ele cobre o
# próprio portão que garante a imagem.
#
# INDETERMINADA (exit 2) NÃO recusa: é "não consegui provar agora" (registry
# fora, sem token, um recorte pedido pelo operador), e bloquear aí tornaria a
# subida impossível offline — o aviso diz o que o portão de hoje não cobre. Quem
# recusa é a violação provada. Um doctor que nem rodou (exit >=3) recusa: sem
# veredito não há prontidão.
#
# O HOST SEM REGISTRY (--local-image): INDETERMINADO é um estado PRÓPRIO, não um
# fim de linha. O pré-requisito 1 recusa quando o registry não responde — e está
# certo: "não consegui perguntar" não é "a tag existe" (o ensure nunca publica
# nesse estado). Só que num host que opera SEM alcançar o registry (rede fechada,
# DNS que não resolve, pacote privado sem credencial anônima) a recusa não deixa
# NADA que o operador possa rodar daqui: o beco. Com --local-image o operador
# AFIRMA "este host tem a imagem na cópia local" e o bring-up cobra a prova
# disso: o ensure confere a MESMA referência que os labels do compose usam no
# daemon DESTE host e devolve um estado próprio (exit 6, `pré-requisito
# satisfeito pela CÓPIA LOCAL`) — a subida segue, com o que NÃO ficou provado
# dito em voz alta (que a TAG exista no registry e que um host sem a cópia a
# puxe). Sem a flag, o veredito é EXATAMENTE o de antes: INDETERMINADO recusa e
# nada sobe. A decisão é explícita nos dois sentidos — não há caminho em que a
# cópia local sirva de prova por conta própria.
#
# O 6 NÃO sai daqui: ele é o estado que a flag autoriza, e a subida continua.
# AUSENTE (4) e falha ao publicar (5) NÃO são afrouxados pela flag: a cópia local
# responde por "não consegui perguntar", não por "o registry respondeu que não
# tem".
#
# --re-register: para quem TROCOU os labels (ou a BUN_VERSION) e precisa que o
# runner envie o registro de novo. O act_runner envia os labels NO REGISTRO e
# depois usa os que ficaram gravados em /data/.runner — `restart` não aplica
# label novo, e o volume sobrevive ao `rm` do container. Então este modo apaga
# o container E o registro gravado antes de subir, e a garantia da imagem
# continua valendo (o passo 1 roda igual).
# CONFLITA com --check-only e --no-runner (ambos dizem "não subir o runner").
#
# Flags repassadas ao ensure:
#   --source auto|workflow|local   (default: auto)
#
# Exit codes:
#   0 — stack no ar (ou env+imagem+prontidão em ordem no --check-only)
#   1 — uso/arquivo/ESTADO LOCAL (flag contraditória, volume do registro que
#       não sai, compose ou env ausente), OU a prontidão BLOQUEADA (doctor exit
#       1) / o doctor não conseguiu rodar (exit >=3) — NADA é subido
#   >=2 — código do ensure-runner-image.mjs (2 env, 3 indeterminado,
#         4 ausente no --check-only, 5 falha ao publicar) — NADA é subido.
#         O 6 (INDETERMINADO aceito pela CÓPIA LOCAL) só existe com
#         --local-image e NÃO é propagado: ele é o estado que autoriza a subida
# =============================================================================

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"

COMPOSE_FILE="${COMPOSE_FILE:-$SCRIPT_DIR/docker-compose.gitea.yml}"
ENV_FILE="${ENV_FILE:-$SCRIPT_DIR/.env.gitea}"
ENSURE_SCRIPT="${ENSURE_SCRIPT:-$REPO_DIR/scripts/ensure-runner-image.mjs}"
# O template COMITADO que o env do host precisa espelhar (passo 0). Sobrescrever
# existe para teste; em produção é o arquivo do repositório.
TEMPLATE_FILE="${TEMPLATE_FILE:-$SCRIPT_DIR/env.gitea.example}"
MIRROR_SCRIPT="${MIRROR_SCRIPT:-$REPO_DIR/scripts/check-env-mirror.mjs}"
# O veredito de prontidão (passo 2). Sobrescrever existe para teste — em
# produção é o doctor do repositório.
DOCTOR_SCRIPT="${DOCTOR_SCRIPT:-$REPO_DIR/scripts/forge-doctor.mjs}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-180}"
SOURCE="auto"
CHECK_ONLY=0
NO_RUNNER=0
RE_REGISTER=0
LOCAL_IMAGE=0
# 1 quando o pré-requisito 1 foi satisfeito pela CÓPIA LOCAL (exit 6 do ensure):
# o estado entra no resumo final, para a subida não parecer uma garantia de
# registry que ninguém deu.
IMAGEM_LOCAL=0

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

pass() { echo -e "  ${GREEN}✅${NC} $1"; }
fail() { echo -e "  ${RED}❌${NC} $1"; }
warn() { echo -e "  ${YELLOW}⚠️${NC} $1"; }
info() { echo -e "  ${CYAN}▸${NC} $1"; }

# Wall time total da subida (医療 bulletin ao final do script)
SECONDS=0

# Imprime o header de comentário INTEIRO (do 2º separador '# ====' para trás).
# Não usar uma faixa fixa de linhas: ela corta o bloco Usage quando o header
# cresce — e o usuário veria a ajuda pela metade sem nenhum sinal de que falta
# pedaço (foi o que aconteceu ao documentar --re-register).
usage() {
  END_SEP="$(grep -n '^# ====' "${BASH_SOURCE[0]}" | sed -n '2p' | cut -d: -f1)"
  [ -n "$END_SEP" ] || {
    echo "gitea-up: separadores do header não encontrados — não consigo imprimir a ajuda" >&2
    exit 1
  }
  sed -n "2,$((END_SEP - 1))p" "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

while [ $# -gt 0 ]; do
  case "$1" in
    --check-only) CHECK_ONLY=1 ;;
    --no-runner) NO_RUNNER=1 ;;
    --re-register) RE_REGISTER=1 ;;
    --local-image) LOCAL_IMAGE=1 ;;
    --env-file) ENV_FILE="${2:-}"; shift ;;
    --source) SOURCE="${2:-}"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) fail "argumento desconhecido: $1"; usage; exit 1 ;;
  esac
  shift
done

# Combinações contraditórias: --re-register pressupõe subir o runner depois de
# apagar o registro; as duas outras flags dizem o contrário. Falhar aqui vale
# mais que escolher uma precedência silenciosa.
if [ "$RE_REGISTER" -eq 1 ] && [ "$CHECK_ONLY" -eq 1 ]; then
  fail "--re-register e --check-only são contraditórios (um re-registra, o outro não toca em nada)"
  exit 1
fi
if [ "$RE_REGISTER" -eq 1 ] && [ "$NO_RUNNER" -eq 1 ]; then
  fail "--re-register e --no-runner são contraditórios (um sobe o runner, o outro o deixa de fora)"
  exit 1
fi
# A flag AFIRMA algo sobre a imagem do runner; o --no-runner pula o pré-requisito
# inteiro. Coexistir seria prometer uma prova que ninguém vai pedir (e o operador
# leria "imagem conferida" onde nada foi conferido).
if [ "$LOCAL_IMAGE" -eq 1 ] && [ "$NO_RUNNER" -eq 1 ]; then
  fail "--local-image e --no-runner são contraditórios (um afirma a imagem do runner, o outro deixa o runner de fora)"
  exit 1
fi

echo ""
echo "  ═════════════════════════════════════════════════════════════════"
echo "   🐳 FORJA — subir com a imagem do runner GARANTIDA"
echo "  ═════════════════════════════════════════════════════════════════"
echo ""

# ── Pré-condições locais ───────────────────────────────────────────────────
[ -f "$COMPOSE_FILE" ] || { fail "compose não encontrado: $COMPOSE_FILE"; exit 1; }
[ -f "$ENV_FILE" ] || {
  fail "env não encontrado: $ENV_FILE"
  fail "Crie com: cp $SCRIPT_DIR/env.gitea.example $ENV_FILE  (e preencha RUNNER_TOKEN)"
  exit 1
}
command -v docker >/dev/null 2>&1 || { fail "docker não encontrado no PATH"; exit 1; }
command -v node >/dev/null 2>&1 || { fail "node não encontrado no PATH (o ensure roda em node)"; exit 1; }
[ -f "$ENSURE_SCRIPT" ] || { fail "ensure não encontrado: $ENSURE_SCRIPT"; exit 1; }
[ -f "$MIRROR_SCRIPT" ] || { fail "guard do espelho não encontrado: $MIRROR_SCRIPT"; exit 1; }
[ -f "$TEMPLATE_FILE" ] || { fail "template do env não encontrado: $TEMPLATE_FILE"; exit 1; }
[ -f "$DOCTOR_SCRIPT" ] || { fail "doctor não encontrado: $DOCTOR_SCRIPT"; exit 1; }

info "compose : $COMPOSE_FILE"
info "env     : $ENV_FILE"
info "template: $TEMPLATE_FILE"
info "doctor  : $DOCTOR_SCRIPT"
echo ""

# --no-runner (a partir daqui) pula os dois pré-requisitos do runner: sem ele
# não há imagem a garantir nem labels a conferir, então nada desta seção é
# pré-requisito de nada nesta execução.
SKIP_RUNNER_PREREQS=0
[ "$NO_RUNNER" -eq 1 ] && [ "$CHECK_ONLY" -eq 0 ] && SKIP_RUNNER_PREREQS=1

# ── 0. PRÉ-REQUISITO: o env do host ESPELHA o template comitado ─────────────
# Antes da garantia da imagem, e não depois, por um motivo concreto: o ensure
# resolve IMAGE_REGISTRY/IMAGE_NAMESPACE/BUN_VERSION DESTE arquivo. Com um env
# divergente ele garantiria a imagem ERRADA — e a stack subiria apontando para
# ela. A regra é a do `check:registry-source` (invariante 7b), num comando que o
# bring-up executa sozinho: quem sobe a stack não tem de lembrar de rodar o gate.
if [ "$SKIP_RUNNER_PREREQS" -eq 1 ]; then
  warn "--no-runner: pulando a conferência do env (o runner não vai subir)"
else
  info "conferindo o env do host contra o template comitado..."
  echo ""
  # --host/--template explícitos: os MESMOS arquivos que o compose vai ler
  # (`$ENV_FILE`) e o template comitado. Sem `--host` a descoberta poderia achar
  # outro arquivo e a checagem mediria algo que esta subida não usa.
  node "$MIRROR_SCRIPT" --host "$ENV_FILE" --template "$TEMPLATE_FILE"
  MIRROR_CODE=$?
  echo ""
  if [ "$MIRROR_CODE" -ne 0 ]; then
    fail "o env do host NÃO espelha o template comitado (exit ${MIRROR_CODE}) — NADA foi subido."
    fail "A stack interpolaria outra coisa que o repositório declara (imagem, versão, segredo)."
    fail "Relatório completo: bun run check:registry-source"
    # O REMÉDIO (para não corrigir à mão): --patch mostra o diff que reconcilia o
    # host; --fix aplica (atômico). Ele nunca escreve o segredo — isso fica para
    # quem tem o valor real, e o relatório acima já nomeia o que ficou pendente.
    fail "Veja o que muda:  bun run env-mirror:check --patch"
    fail "Aplique o diff:    bun run env-mirror:check --fix   (o segredo nunca é tocado)"
    exit 1
  fi
fi

# ── 1. PRÉ-REQUISITO: a imagem do runner existe no registry ────────────────
# --gitea-env (e não --env-file): `--env-file` é flag do PRÓPRIO Node e o
# runtime a consome antes do script — com o arquivo ausente o processo morreria
# com exit 9, sem a nossa mensagem.
ENSURE_ARGS=(--gitea-env "$ENV_FILE" --source "$SOURCE")
[ "$CHECK_ONLY" -eq 1 ] && ENSURE_ARGS+=(--check)
# A flag vai para o ensure, que é quem resolve a referência da imagem (e o dono
# do probe local): sem repassá-la, o estado de cópia local nunca existiria.
[ "$LOCAL_IMAGE" -eq 1 ] && ENSURE_ARGS+=(--local-image)

ENSURE_CODE=0
if [ "$SKIP_RUNNER_PREREQS" -eq 1 ]; then
  warn "--no-runner: pulando a garantia da imagem (o runner não vai subir)"
else
  info "garantindo a imagem do runner (publica se necessário)..."
  echo ""
  node "$ENSURE_SCRIPT" "${ENSURE_ARGS[@]}"
  ENSURE_CODE=$?
  echo ""
  if [ "$ENSURE_CODE" -eq 6 ]; then
    # ACEITO PELA CÓPIA LOCAL — o estado que SÓ existe com --local-image. O
    # registry está INDETERMINADO ("não consegui perguntar", não "a tag não
    # existe") e a imagem está no daemon DESTE host: é ela que os jobs rodam
    # aqui. O veredito é NOMEADO e a subida segue — o pré-requisito 2 (o doctor)
    # continua no caminho, e ele reporta o que não alcança.
    IMAGEM_LOCAL=1
    warn "pré-requisito 1 satisfeito pela CÓPIA LOCAL da imagem (registry INDETERMINADO — exit 6)."
    warn "NÃO fica provado: que a TAG exista no registry, nem que um host SEM esta cópia a puxe."
  elif [ "$ENSURE_CODE" -ne 0 ]; then
    fail "imagem do runner NÃO garantida (exit ${ENSURE_CODE}) — NADA foi subido."
    fail "O runner subiria e todos os jobs falhariam ao iniciar o container."
    if [ "$LOCAL_IMAGE" -eq 1 ] && [ "$ENSURE_CODE" -eq 3 ]; then
      # A flag foi dada e MESMO ASSIM recusou: a cópia local não foi encontrada
      # (ou o docker não respondeu). O remédio está na saída do ensure acima —
      # construa a imagem localmente e a cópia local passa a existir.
      fail "--local-image foi dada: o ensure só recusaria se a cópia local NÃO servisse de prova (veja o remédio acima)."
    fi
    exit "$ENSURE_CODE"
  fi
fi

# ── 2. PRÉ-REQUISITO: a PRONTIDÃO da forja (doctor) ─────────────────────────
# POR QUE O DOCTOR E NÃO UM SEGUNDO CONJUNTO DE CHECKS AQUI: ele é a resposta
# para a pergunta inteira (guards + contrato de merge + registry + imagem
# publicada + registro do runner) e diz o que NÃO provou. Repetir as regras aqui
# seria uma lista paralela para envelhecer — e a subida voltaria a depender de
# alguém lembrar de rodar o relatório completo.
#
# DEPOIS da garantia da imagem, de propósito — e não é estética: o doctor trata
# a tag AUSENTE como violação, que é EXATAMENTE a condição que o passo 1 existe
# para consertar. Rodá-lo primeiro criaria o mesmo impasse do --re-register: o
# remédio (publicar a imagem) ficaria travado pelo estado que ele cura. E o
# código do ensure (2..5) continua sendo reportado sem ser mascarado por um
# veredito de prontidão.
# As flags base ficam NA linha da invocação (e não só num array) para que a
# regra seja legível e conferível por quem lê o script: `--gitea-env` para o
# doctor ler o MESMO arquivo que o compose vai ler. E o doctor roda INTEIRO —
# O doctor roda INTEIRO — o ciclo é cortado pela dublagem do
# doctor dentro da prova (ver o header), e desligar a prova aqui trocaria isso
# por um veredito parcial POR CONSTRUÇÃO — a subida aconteceria sem que o portão
# de bloqueio tivesse sido provado.
DOCTOR_ARGS=()
# --re-register: o label GRAVADO em /data/.runner é o que este modo conserta.
# Sem esta isenção, o doctor diria BLOQUEADA pelo registro velho e o remédio
# ficaria travado pelo estado que ele cura — indefinidamente.
[ "$RE_REGISTER" -eq 1 ] && DOCTOR_ARGS+=(--no-runner-labels)

if [ "$SKIP_RUNNER_PREREQS" -eq 1 ]; then
  warn "--no-runner: pulando o veredito de prontidão (o runner não vai subir)"
else
  info "checando a prontidão da forja (doctor)..."
  echo ""
  DOCTOR_START=$SECONDS
  node "$DOCTOR_SCRIPT" --gitea-env "$ENV_FILE" "${DOCTOR_ARGS[@]}"
  DOCTOR_CODE=$?
  DOCTOR_ELAPSED=$(( SECONDS - DOCTOR_START ))
  echo ""
  if [ "$DOCTOR_CODE" -eq 0 ]; then
    pass "prontidão da forja: PRONTA (doctor exit 0) — ${DOCTOR_ELAPSED}s"
  elif [ "$DOCTOR_CODE" -eq 2 ]; then
    # "não consegui provar agora" (registry fora, sem token, um recorte pedido
    # pelo operador) NÃO é violação. O aviso é honesto, não ruído: diz que o
    # portão de hoje é "nenhuma violação", e o que isso NÃO cobre. E o veredito
    # já não é parcial por construção: a prova do bloqueio roda aqui dentro (o
    # ciclo é cortado pela dublagem do doctor na prova).
    warn "prontidão INDETERMINADA (doctor exit 2, ${DOCTOR_ELAPSED}s): nenhuma violação, mas algo não ficou provado."
    warn "Sigo porque INDETERMINADA não é violação — recusar aqui tornaria a subida impossível offline."
  elif [ "$DOCTOR_CODE" -eq 1 ]; then
    fail "a prontidão da forja está BLOQUEADA (doctor exit 1, ${DOCTOR_ELAPSED}s) — NADA foi subido."
    fail "Subir assim publicaria uma forja num estado que NÃO segura o merge."
    fail "Relatório completo: node scripts/forge-doctor.mjs --gitea-env \"$ENV_FILE\""
    exit 1
  else
    fail "o doctor não conseguiu rodar (exit ${DOCTOR_CODE}, ${DOCTOR_ELAPSED}s) — sem veredito não há prontidão, e NADA foi subido."
    fail "Relatório: node scripts/forge-doctor.mjs --gitea-env \"$ENV_FILE\""
    exit 1
  fi
fi

if [ "$CHECK_ONLY" -eq 1 ]; then
  echo ""
  if [ "$IMAGEM_LOCAL" -eq 1 ]; then
    pass "check-only: env espelhado + imagem pela CÓPIA LOCAL (registry INDETERMINADO) + prontidão conferida, stack NÃO foi tocada."
  else
    pass "check-only: env espelhado + imagem em ordem + prontidão conferida, stack NÃO foi tocada."
  fi
  exit 0
fi

DOCKER_COMPOSE=(docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE")

# ── 3. Gitea + Caddy ───────────────────────────────────────────────────────
info "subindo gitea + caddy..."
"${DOCKER_COMPOSE[@]}" up -d gitea caddy || { fail "docker compose up (gitea caddy) falhou"; exit 1; }

info "aguardando o Gitea responder em http://localhost:3000/api/healthz ..."
READY=0
for _ in $(seq 1 $((HEALTH_TIMEOUT / 3))); do
  if curl -fsS -o /dev/null http://localhost:3000/api/healthz 2>/dev/null; then
    READY=1
    break
  fi
  sleep 3
done
if [ "$READY" -eq 1 ]; then
  pass "Gitea no ar"
else
  warn "Gitea não respondeu em ${HEALTH_TIMEOUT}s — verifique: docker compose -f $COMPOSE_FILE logs gitea"
fi

# ── 4. Runner — SÓ DEPOIS da imagem garantida no passo 1 ───────────────────
if [ "$NO_RUNNER" -eq 1 ]; then
  echo ""
  pass "gitea + caddy no ar (runner não subiu: --no-runner)"
  exit 0
fi

# ── 4a. Re-registro: apaga o container E o registro GRAVADO ────────────────
# POR QUE apagar o volume: o runner guarda os labels que recebeu no REGISTRO em
# /data/.runner e depois usa ESSES — não relê o compose. Sem apagar o volume, o
# container sobe com os labels ANTIGOS e o tier-1 continua desligado, sem
# nenhum sintoma (o setup-bun funciona igual, só mais lento). Apagar só o
# container não basta: o volume sobrevive ao `rm`.
if [ "$RE_REGISTER" -eq 1 ]; then
  # O nome sai do COMPOSE (esta fixado em `runner-data: name: <nome>`), não de
  # uma cópia aqui — um rename no compose tem de chegar até nós.
  RUNNER_VOLUME="$(grep -A2 -E '^  runner-data:' "$COMPOSE_FILE" | sed -n 's/^[[:space:]]*name:[[:space:]]*//p' | head -1)"
  if [ -z "$RUNNER_VOLUME" ]; then
    fail "não consegui ler o nome do volume do registro em $COMPOSE_FILE (procurei 'runner-data:' seguido de 'name:')."
    fail "Sem apagar o volume o runner voltaria com os labels ANTIGOS — prefiro falhar a re-registrar em silêncio."
    exit 1
  fi

  warn "re-registrando: removendo o container do runner..."
  "${DOCKER_COMPOSE[@]}" rm -sf runner || { fail "docker compose rm -sf runner falhou"; exit 1; }

  if docker volume inspect "$RUNNER_VOLUME" >/dev/null 2>&1; then
    docker volume rm "$RUNNER_VOLUME" >/dev/null 2>&1 || true
    if docker volume inspect "$RUNNER_VOLUME" >/dev/null 2>&1; then
      fail "o volume '$RUNNER_VOLUME' ainda existe — o registro antigo sobreviveria e os labels NÃO seriam aplicados"
      fail "Remédio: docker volume rm $RUNNER_VOLUME (com o container parado) e rode de novo."
      exit 1
    fi
    pass "registro apagado ($RUNNER_VOLUME) — o próximo 'up' envia os labels do compose"
  else
    info "volume do registro ainda não existe (primeira subida) — nada a apagar"
  fi
fi

info "subindo o act_runner (a imagem já foi confirmada no registry)..."
"${DOCKER_COMPOSE[@]}" up -d runner || { fail "docker compose up (runner) falhou"; exit 1; }

echo ""
if [ "$RE_REGISTER" -eq 1 ]; then
  pass "stack no ar — runner RE-REGISTRADO com os labels do compose (tier-1 ativo)"
  info "se o runner não aparecer em Site Administration → Runners, o RUNNER_TOKEN está velho: gere outro na UI e repita"
else
  pass "stack no ar — runner rodando a imagem com o Bun pré-instalado (tier-1 ativo)"
fi
info "confirme em: Site Administration → Runners (o runner envia os labels no REGISTRO)"

if [ "$IMAGEM_LOCAL" -eq 1 ]; then
  warn "imagem: pré-requisito satisfeito pela CÓPIA LOCAL (registry INDETERMINADO) — os jobs DESTE host rodam a cópia local; publique a tag para a forja de outro host poder puxá-la"
fi

echo ""
info "wall time total da subida: ${SECONDS}s (doctor: ${DOCTOR_ELAPSED:-N/A}s)"
info "smoke da forja: rode o workflow 'Forge Smoke' e leia a prova do tier-1"
