#!/usr/bin/env bash
# =============================================================================
# Fix Docker AppArmor Signal — Severinno Marketplace
# =============================================================================
# Conserta o `docker stop` / `docker kill` / `docker rm -f` que respondem
# "permission denied" neste host. É remédio de HOST (roda com sudo), não de
# repositório: nenhum arquivo versionado muda por causa dele.
#
# O DEFEITO (medido, não inferido)
#
# Este host tem DOIS dockerd vivos:
#
#   snap.docker.dockerd.service        /snap/docker/current/bin/dockerd
#     perfil AppArmor: snap.docker.dockerd
#     data-root: /var/snap/docker/common/var-lib-docker
#     dono de /var/run/docker.sock  <- o daemon que o CLI do dia a dia fala
#
#   docker.service (docker-ce do apt)  /usr/bin/dockerd -H fd://
#     perfil AppArmor: unconfined
#     data-root: /var/lib/docker
#     socket inalcançável (o bind do snap substituiu o caminho do systemd)
#
# Os dois instalam o perfil AppArmor `docker-default` — o que os containers
# vestem — e QUEM SOBE POR ÚLTIMO VENCE. O template embutido no dockerd preenche
# o peer da regra de sinal com o perfil de QUEM RENDERIZA:
#
#   # runc may send signals to container processes (for "docker stop").
#   signal (receive) peer=runc,
#   # crun may send signals... (for "docker stop" when used with crun).
#   signal (receive) peer=crun,
#   # dockerd may send signals to container processes (for "docker kill").
#   signal (receive) peer="{{.DaemonProfile}}",   # <-- o renderizador
#   # Container processes may send signals amongst themselves.
#   signal (send,receive) peer="{{.Name}}",
#
# O daemon do apt é `unconfined`, então o perfil carregado ficou com
# `peer=unconfined`: o daemon do snap (perfil `snap.docker.dockerd`) NÃO tem
# permissão de sinalizar o init dos containers e todo stop/kill vira EPERM
# ("unable to signal init: permission denied").
#
# Medições que sustentam o diagnóstico (este host, 2026-09-20):
#   docker stop, perfil docker-default                -> rc=1, permission denied
#   docker stop, mesmo container apparmor=unconfined  -> rc=0
#   docker exec <c> kill -TERM 1 (de DENTRO do c.)    -> rc=0, redis sai em 565ms
#   journal do snap.docker.dockerd                    -> "unable to signal init: permission denied"
#
# REMENDO DE EMERGÊNCIA (sem root): `docker exec <c> kill -TERM 1`. O remetente
# é um processo de DENTRO do container — mesmo perfil `docker-default`, que o
# template permite (`signal (send,receive) peer="{{.Name}}"`). Vale quando o
# PID 1 trata TERM (medido: redis sai gracioso em 565ms); num PID 1 que ignora
# TERM (um `sleep`) NÃO há rota sem root, porque o init do namespace descarta
# sinais sem handler — e o `kill` do host não ajuda: para um usuário comum ele
# é EPERM por uid (o processo do container roda como root), não por AppArmor.
#
# O QUE ESTE SCRIPT FAZ
#
#   1. recusa rodar fora do desenho medido (fail-closed: só age se o socket for
#      do daemon do snap; qualquer outro arranjo é `indisponível`, não remendo);
#   2. inventaria o data-root do apt (os containers que param junto) e quem
#      estava rodando agora;
#   3. `systemctl disable --now` + `mask` nas units do apt — sem o mask, o
#      daemon do apt volta no próximo boot e re-renderiza o perfil errado;
#   4. reinicia `snap.docker.dockerd.service`, para ELE re-renderizar o
#      `docker-default` com `peer=snap.docker.dockerd`;
#   5. religa o que o restart tiver parado;
#   6. PROVA por execução: `docker stop` gracioso (PID 1 que trata TERM),
#      `docker kill`, `docker rm -f` num container rodando e a recriação com o
#      mesmo nome, com o rc de cada um e o estado depois de cada passo (os
#      provisórios usam `sleep 30` de propósito: no host quebrado eles saem
#      sozinhos em vez de ficarem presos para sempre);
#   7. diz o que precisa ser recriado na forja que ficou (o apt parou).
#
# PARA VOLTAR ATRÁS
#
#   `--revert` desmascara e reabilita as units do apt — mas ele NÃO reconserta:
#   com o daemon do apt de volta, o perfil errado volta junto e o stop quebra de
#   novo no próximo boot. O remédio do outro lado (usar o daemon do apt como
#   daemon único) exige migrar o data-root dos containers do snap — é outro
#   remendo, fora do escopo deste.
#
# Usage:
#   sudo bash scripts/fix-docker-apparmor-signal.sh            # conserta + prova
#   bash scripts/fix-docker-apparmor-signal.sh --check         # só diagnostica
#   bash scripts/fix-docker-apparmor-signal.sh --prove         # só a prova
#   sudo bash scripts/fix-docker-apparmor-signal.sh --revert   # devolve as units
#
# Exit codes:
#   0 — conserto aplicado e provado / estado já correto (--check) / prova passou
#   1 — host no estado quebrado (--check) ou a prova de stop/kill falhou
#   2 — indisponível: sem root para consertar, sem systemd, com menos de dois
#       daemons (nada a separar) ou com o socket em outro daemon (outro desenho)
#   3 — uso inválido
# =============================================================================

set -euo pipefail

SNAP_UNIT="snap.docker.dockerd.service"
SNAP_ROOT="/var/snap/docker/common/var-lib-docker"
APT_ROOT="/var/lib/docker"
APT_UNITS=(docker.socket docker.service)
PROFILE_GLOB="/sys/kernel/security/apparmor/policy/profiles/docker-default.*/raw_data"
SOCKET_WAIT_SECONDS=180
DAEMON_COUNT=0

usage() {
  sed -n '/^# Usage:/,/^# Exit codes:/p' "$0" | sed 's/^# \{0,1\}//' | sed '$d'
}

have() { command -v "$1" >/dev/null 2>&1; }

dockerd_pids() { pgrep -x dockerd 2>/dev/null || true; }

profile_of() { cat "/proc/$1/attr/current" 2>/dev/null | tr -d '\n' || true; }

unit_of() {
  local cg
  cg=$(sed -n 's#^0::##p' "/proc/$1/cgroup" 2>/dev/null || true)
  printf '%s' "${cg##*/}"
}

data_root_of() {
  local cmd
  cmd=$(tr '\0' ' ' < "/proc/$1/cmdline" 2>/dev/null || true)
  case "$cmd" in
    *--data-root=*) printf '%s' "${cmd#*--data-root=}" | cut -d' ' -f1 ;;
    *) printf '%s' "$APT_ROOT" ;;
  esac
}

socket_root() { docker info --format '{{.DockerRootDir}}' 2>/dev/null || true; }

state_of() { docker inspect -f '{{.State.Status}}' "$1" 2>/dev/null || echo "ausente"; }

report_daemons() {
  local p n=0
  echo "🐳 daemons dockerd vivos:"
  for p in $(dockerd_pids); do
    n=$((n + 1))
    printf '   pid=%-6s unit=%-32s perfil=%-22s data-root=%s\n' \
      "$p" "$(unit_of "$p")" "$(profile_of "$p")" "$(data_root_of "$p")"
  done
  if [ "$n" -eq 0 ]; then echo "   (nenhum)"; fi
  DAEMON_COUNT=$n
}

apt_container_names() {
  local f
  for f in "$APT_ROOT"/containers/*/config.v2.json; do
    [ -e "$f" ] || continue
    # sem `head` aqui de propósito: um consumidor que sai cedo fecha o pipe e o
    # `grep` morre com SIGPIPE sob `set -o pipefail` (mesma classe do guard de
    # pipefail-sigpipe). O `sed` lê tudo e o `sort -u` deduplica depois.
    grep -o '"Name":"[^"]*"' "$f" 2>/dev/null | sed 's/.*:"//; s/"$//' || true
  done | sort -u
}

expected_peer() {
  local p want=0
  for p in $(dockerd_pids); do
    if [ "$(data_root_of "$p")" = "$(socket_root)" ]; then profile_of "$p"; want=1; break; fi
  done
  if [ "$want" -eq 0 ]; then printf '%s' "docker-default"; fi
}

peers_report() {
  local f
  for f in $PROFILE_GLOB; do
    [ -r "$f" ] || continue
    echo "   [$f]"
    grep -E 'signal \(receive\) peer=' "$f" | sed 's/^/     /' || true
  done
}

# O perfil carregado admite o peer do daemon que atende o socket?
peers_ok() {
  local want f seen=0
  want=$(expected_peer)
  for f in $PROFILE_GLOB; do
    [ -r "$f" ] || continue
    seen=1
    if grep -qE "signal \(receive\) peer=\"?${want}\"?," "$f"; then return 0; fi
  done
  if [ "$seen" -eq 0 ]; then echo "   (perfil ilegível ou AppArmor desligado — julgue pela prova)"; fi
  return 1
}

wait_for_socket() {
  local i=0 limit=$((SOCKET_WAIT_SECONDS * 2))
  while [ "$i" -lt "$limit" ]; do
    if [ -n "$(socket_root)" ]; then printf '   daemon respondeu em %ss\n' "$((i / 2))"; return 0; fi
    sleep 0.5
    i=$((i + 1))
  done
  printf '❌ o daemon não voltou a responder em %ss\n' "$SOCKET_WAIT_SECONDS"
  return 1
}

require_root() {
  if [ "$(id -u)" -ne 0 ]; then
    echo "❌ este modo precisa de root (é remédio de HOST, não de repositório):" >&2
    echo "   sudo bash $0 $1" >&2
    exit 2
  fi
}

check() {
  local rc=0 root
  report_daemons
  root=$(socket_root)
  if [ -z "$root" ]; then
    echo "❌ nenhum daemon atende o socket — o Docker está fora do ar"
    return 2
  fi
  echo "🔌 socket atendido pelo daemon de data-root=$root"
  if [ "$DAEMON_COUNT" -ge 2 ]; then
    echo "❌ DOIS daemons dockerd: é o desenho que quebra o stop (o outro re-renderiza o docker-default)"
    rc=1
  else
    echo "✅ um daemon só"
  fi
  if [ "$(id -u)" -eq 0 ]; then
    peers_report
    if peers_ok; then
      echo "✅ o perfil docker-default admite o sinal do daemon que atende o socket"
    else
      echo "❌ o perfil docker-default NÃO admite o sinal do daemon que atende o socket"
      rc=1
    fi
  else
    echo "ℹ️  sem root não leio o perfil carregado (raw_data); para o veredito do perfil rode com sudo"
    if [ "$rc" -eq 0 ]; then rc=2; fi
  fi
  return "$rc"
}

# Os provisórios morrem sozinhos (`sleep 30`): no host quebrado o `rm -f` não
# consegue sinalizar o init, e um container de prova preso para sempre seria
# lixo — assim ele sai sozinho e a limpeza seguinte o remove.
limpar_probe() {
  local name="$1"
  if docker rm -f "$name" >/dev/null 2>&1; then
    echo "   🧹 removido $name"
  elif [ "$(state_of "$name")" = "ausente" ]; then
    echo "   🧹 $name já não estava no host"
  else
    echo "   ⚠️ $name não pôde ser removido agora (é o defeito); ele sai sozinho em ≤30s"
    echo "      e depois sai com 'docker rm -f $name'"
  fi
}

prove() {
  local rc=0 t0 t1 st code tag stop killc
  tag="$$"
  stop="prova-stop-fix-$tag"
  killc="prova-kill-fix-$tag"

  echo ""
  echo "🧪 PROVA A — docker stop gracioso (PID 1 que trata TERM): $stop"
  t0=$(date +%s%N)
  if docker image inspect redis:7-alpine >/dev/null 2>&1; then
    echo "   imagem: redis:7-alpine"
    if ! docker run -d --name "$stop" redis:7-alpine >/dev/null; then
      echo "   ❌ não consegui criar o container de prova"
      rc=1
    fi
  else
    echo "   imagem: alpine (trap TERM)"
    if ! docker run -d --name "$stop" alpine sh -c 'trap "exit 0" TERM; while :; do sleep 1; done' >/dev/null; then
      echo "   ❌ não consegui criar o container de prova"
      rc=1
    fi
  fi
  if [ "$(state_of "$stop")" = "running" ]; then
    if docker stop -t 5 "$stop"; then
      echo "   ✅ docker stop rc=0"
    else
      echo "   ❌ docker stop rc≠0 — 'permission denied' é o defeito que este script conserta"
      rc=1
    fi
    for _ in $(seq 1 40); do
      st=$(state_of "$stop")
      if [ "$st" != "running" ]; then break; fi
      sleep 0.5
    done
    t1=$(date +%s%N)
    st=$(state_of "$stop")
    code=$(docker inspect -f '{{.State.ExitCode}}' "$stop" 2>/dev/null || echo "?")
    echo "   estado: $st exit=$code ($(((t1 - t0) / 1000000))ms)"
    if [ "$st" != "exited" ] || [ "$code" != "0" ]; then
      echo "   ❌ esperava exited com exit=0 (stop gracioso de verdade)"
      rc=1
    fi
  fi
  limpar_probe "$stop"

  echo ""
  echo "🧪 PROVA B — docker kill: $killc"
  if docker run -d --name "$killc" alpine sleep 30 >/dev/null 2>&1; then
    t0=$(date +%s%N)
    if docker kill "$killc"; then
      echo "   ✅ docker kill rc=0"
    else
      echo "   ❌ docker kill rc≠0"
      rc=1
    fi
    t1=$(date +%s%N)
    st=$(state_of "$killc")
    code=$(docker inspect -f '{{.State.ExitCode}}' "$killc" 2>/dev/null || echo "?")
    echo "   estado: $st exit=$code ($(((t1 - t0) / 1000000))ms)"
    if [ "$st" != "exited" ]; then
      echo "   ❌ esperava exited"
      rc=1
    fi
  else
    echo "   ❌ não consegui criar o container de prova"
    rc=1
  fi
  limpar_probe "$killc"

  echo ""
  echo "🧪 PROVA C — docker rm -f em container RODANDO + recriação com o mesmo nome"
  limpar_probe "$killc"
  if [ "$(state_of "$killc")" = "ausente" ]; then
    if docker run -d --name "$killc" alpine sleep 30 >/dev/null 2>&1; then
      if docker rm -f "$killc" >/dev/null; then
        echo "   ✅ docker rm -f (rodando) rc=0"
      else
        echo "   ❌ docker rm -f (rodando) rc≠0 — 'could not kill container: permission denied' é o defeito"
        rc=1
      fi
    else
      echo "   ❌ não consegui criar o container de prova"
      rc=1
    fi
  else
    echo "   ⏭️  pulada: o provisório '$killc' ainda existe ($(state_of "$killc")) e o defeito impede removê-lo"
    rc=1
  fi
  if [ "$(state_of "$killc")" = "ausente" ]; then
    if docker run -d --name "$killc" alpine sleep 20 >/dev/null 2>&1 && [ "$(state_of "$killc")" = "running" ]; then
      echo "   ✅ recriar com o mesmo nome rc=0"
    else
      echo "   ❌ recriar com o mesmo nome falhou"
      rc=1
    fi
  fi
  limpar_probe "$killc"

  # Os provisórios de execuções anteriores que já se auto-encerraram saem aqui;
  # os que ainda estão vivos só saem quando o defeito for consertado.
  sweep=$(docker ps -a --format '{{.Names}}' | grep -cE '^prova-(stop|kill)-fix' || true)
  sweep=${sweep:-0}
  if [ "$sweep" -gt 0 ]; then
    docker rm -f $(docker ps -aq --filter 'name=prova-stop-fix' --filter 'name=prova-kill-fix') >/dev/null 2>&1 || true
    echo "   🧹 provisórios antigos: $sweep antes, $(docker ps -a --format '{{.Names}}' | grep -cE '^prova-(stop|kill)-fix' || true) depois"
  fi

  echo ""
  if [ "$rc" -eq 0 ]; then
    echo "✅ PROVA: stop, kill, rm -f e recriação todos funcionam neste host"
  else
    echo "❌ PROVA: o host ainda não para containers pelo daemon (veja os rc acima)"
  fi
  return "$rc"
}

fix() {
  require_root "--fix"
  local root running_before n

  echo "🔎 1/7 estado atual"
  report_daemons
  root=$(socket_root)
  echo "   socket -> data-root=$root"
  if [ "$root" != "$SNAP_ROOT" ]; then
    echo "❌ fail-closed: este remendo só vale quando o socket é do daemon do snap ($SNAP_ROOT)"
    exit 2
  fi
  if [ "$DAEMON_COUNT" -lt 2 ]; then
    echo "ℹ️  só um daemon: não há conflito a separar. Confirmando com a prova."
    prove
    exit $?
  fi

  echo ""
  echo "📦 2/7 containers no data-root do apt ($APT_ROOT) — param quando o daemon do apt sair:"
  if [ -n "$(apt_container_names)" ]; then
    apt_container_names | sed 's/^/   - /'
    echo "   (recrie-os na forja que fica: docker compose -f docker-compose.monitoring.yml up -d --no-deps <serviço>)"
  else
    echo "   (nenhum)"
  fi
  running_before=$(docker ps --format '{{.Names}}')
  echo "   rodando agora: $(printf '%s\n' "$running_before" | grep -c . || true) container(s)"

  echo ""
  echo "🚫 3/7 tirando o daemon do apt do caminho (disable --now + mask)"
  systemctl disable --now "${APT_UNITS[@]}" || echo "   ⚠️ disable reclamou (idempotência) — sigo e confiro o estado abaixo"
  systemctl mask "${APT_UNITS[@]}" || echo "   ⚠️ mask reclamou (idempotência) — sigo e confiro o estado abaixo"
  printf '   is-enabled: %s\n' "$(systemctl is-enabled "${APT_UNITS[@]}" 2>&1 | tr '\n' ' ')"
  printf '   is-active:  %s\n' "$(systemctl is-active "${APT_UNITS[@]}" 2>&1 | tr '\n' ' ')"

  echo ""
  echo "🔄 4/7 reiniciando $SNAP_UNIT (para ele re-renderizar o docker-default)"
  systemctl restart "$SNAP_UNIT"
  wait_for_socket

  echo ""
  echo "🧷 5/7 religando o que o restart tiver parado"
  for n in $running_before; do
    if [ "$(state_of "$n")" != "running" ]; then
      if docker start "$n" >/dev/null 2>&1; then echo "   ⏫ $n"; fi
    fi
  done
  echo "   rodando agora: $(docker ps -q | grep -c . || true) container(s)"

  echo ""
  echo "🔬 6/7 perfil carregado (quem pode sinalizar o init dos containers)"
  peers_report
  if peers_ok; then
    echo "   ✅ o perfil admite o peer do daemon que atende o socket"
  else
    echo "   ⚠️  não consegui confirmar o peer no perfil — o veredito fica com a prova abaixo"
  fi

  echo ""
  echo "🧪 7/7 prova por execução"
  prove
}

revert() {
  require_root "--revert"
  echo "↩️  devolvendo as units do apt (unmask + enable)"
  systemctl unmask "${APT_UNITS[@]}"
  systemctl enable "${APT_UNITS[@]}"
  printf '   is-enabled: %s\n' "$(systemctl is-enabled "${APT_UNITS[@]}" 2>&1 | tr '\n' ' ')"
  echo "⚠️  reverter NÃO reconserta: com o daemon do apt de volta, ele volta a"
  echo "    re-renderizar o docker-default com peer=unconfined e o stop quebra de novo."
}

case "${1:-}" in
  ""|--fix) fix ;;
  --check) check ;;
  --prove) prove ;;
  --revert) revert ;;
  -h|--help) usage ;;
  *)
    echo "❌ uso inválido: $1" >&2
    usage >&2
    exit 3
    ;;
esac
