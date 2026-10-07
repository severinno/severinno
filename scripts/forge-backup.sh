#!/usr/bin/env bash
# forge-backup.sh — o BACKUP DA FORJA na própria VPS.
#
# O QUE FAZ (duas famílias de artefato, um manifest):
#   1. `gitea dump` — o export OFICIAL e consistente da forja inteira
#      (sqlite via dump SQL, app.ini, anexos, avatares e os repos bare).
#      É o artefato de RESTAURAÇÃO da forja.
#   2. `git bundle create --all` por repositório — cada repo como um
#      bundle AUTO-CONTIDO e verificável (`git bundle verify`). É o
#      artefato de CONFERÊNCIA e de clonagem seca (um bundle é um remote).
#
# POR QUE OS DOIS: o dump é monolítico e depende do gitea da MESMA série
# para restaurar; o bundle é do formato git e sobrevive a qualquer forja.
# Um backup sem verificação é uma esperança: o manifest carrega o sha256
# de cada artefato e o resultado do `git bundle verify` de cada bundle.
#
# FAIL-CLOSED: qualquer passo que falhe sai 1 e o manifest DIZ onde. Um
# backup silenciosamente partido é pior que nenhum — ele é descoberto no
# dia do desastre.
#
# FORJA VAZIA NÃO É FALHA: é um estado declarado no manifest
# (`repos: 0`), não um erro — a forja de bring-up novo nasce sem repos.
#
# Uso (na VPS, como root):
#   bash /root/forge-backup.sh            # roda e escreve em /root/backups-forja
#   crontab: 30 4 * * * /root/forge-backup.sh >> /var/log/forge-backup.log 2>&1
#
# Retenção: 14 dias (diário). O OFF-SITE é o forge-backup-pull.sh na
# máquina local — este script só garante os artefatos na VPS.
#
# Usage:
#   bash /root/forge-backup.sh                        # backup completo de hoje
#   DEST=/tmp/teste bash scripts/forge-backup.sh      # destino alternativo (teste)
#
# Exit codes:
#   0 — artefatos escritos e verificados (manifest + sha256sums)
#   1 — pré-condição, dump, bundle ou checksum falhou (o manifest DIZ onde)
set -euo pipefail

DEST="${DEST:-/root/backups-forja}"
RETENCAO_DIAS="${RETENCAO_DIAS:-14}"
HOJE="$(date +%F)"
SAIDA="$DEST/$HOJE"
CONTAINER="${CONTAINER:-gitea}"
VOLUME_RE="${VOLUME_RE:-gitea-data$}"

mkdir -p "$SAIDA"
MANIFEST="$SAIDA/manifest.txt"
: > "$MANIFEST"

diz() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$MANIFEST"; }

# ── 0. PRÉ-CONDIÇÕES: o container e o volume da forja existem ────────────
docker inspect "$CONTAINER" >/dev/null 2>&1 || {
  diz "ERRO: container '$CONTAINER' não existe — a forja não está de pé"
  exit 1
}
VOLUME="$(docker volume ls --format '{{.Name}}' | grep -E "$VOLUME_RE" | head -1 || true)"
MP=""
if [ -n "$VOLUME" ]; then
  MP="$(docker volume inspect -f '{{.Mountpoint}}' "$VOLUME")"
fi
diz "container=$CONTAINER volume=${VOLUME:-AUSENTE} mountpoint=${MP:-—}"

# ── 1. GITEA DUMP (o export oficial, dentro do container, como git) ──────
# O dir de repos tem de EXISTIR para o dump — a forja de bring-up novo
# nasce sem ele (medido: "open /data/git/repositories: no such file").
diz "gitea dump: iniciando"
docker exec "$CONTAINER" su git -c \
  'mkdir -p /data/git/repositories && gitea dump -f /tmp/forge-dump.zip --tempdir /tmp' \
  >> "$MANIFEST" 2>&1
docker cp "$CONTAINER:/tmp/forge-dump.zip" "$SAIDA/forge-dump.zip" >> "$MANIFEST" 2>&1
docker exec "$CONTAINER" rm -f /tmp/forge-dump.zip >> "$MANIFEST" 2>&1
diz "gitea dump: $(du -h "$SAIDA/forge-dump.zip" | cut -f1) em forge-dump.zip"

# ── 2. GIT BUNDLES (um por repo, verificáveis) ───────────────────────────
REPOS_DIR="${MP:+$MP/git/repositories}"
BUNDLES=0
if [ -n "$REPOS_DIR" ] && [ -d "$REPOS_DIR" ]; then
  shopt -s nullglob
  for repo in "$REPOS_DIR"/*/*.git; do
    nome="$(basename "$repo" .git)"
    dono="$(basename "$(dirname "$repo")")"
    if [ -z "$(git -C "$repo" for-each-ref)" ]; then
      diz "bundle: $dono/$nome vazio (0 refs — estado declarado, pulado)"
      continue
    fi
    # bare repos são do usuário do container (uid 1000): sem isto, o git do host
    # recusa com "dubious ownership" e o backup perde os bundles
    git config --global safe.directory "*" >/dev/null 2>&1 || true
    alvo="$SAIDA/git-${dono}-${nome}.bundle"
    if git -C "$repo" bundle create "$alvo" --all >> "$MANIFEST" 2>&1 \
       && git -C "$repo" bundle verify "$alvo" >> "$MANIFEST" 2>&1; then
      BUNDLES=$((BUNDLES + 1))
      diz "bundle ok: git-${dono}-${nome}.bundle ($(du -h "$alvo" | cut -f1))"
    else
      diz "ERRO: bundle de $dono/$nome falhou (create ou verify)"
      exit 1
    fi
  done
  shopt -u nullglob
fi
if [ "$BUNDLES" -eq 0 ]; then
  diz "bundles: 0 repositorio(s) — FORJA VAZIA (estado declarado, não é falha)"
else
  diz "bundles: $BUNDLES repositorio(s)"
fi

# ── 3. CHECKSUMS de tudo ─────────────────────────────────────────────────
( cd "$SAIDA" && sha256sum forge-dump.zip git-*.bundle > sha256sums.txt ) \
  || ( cd "$SAIDA" && sha256sum forge-dump.zip > sha256sums.txt )
diz "checksums: $(wc -l < "$SAIDA/sha256sums.txt") artefato(s) em sha256sums.txt"

# ── 4. RETENÇÃO (14 dias de diário) ──────────────────────────────────────
find "$DEST" -mindepth 1 -maxdepth 1 -type d -name '20*' -mtime +"$RETENCAO_DIAS" -exec rm -rf {} + 2>/dev/null || true
diz "retenção: mantidos os últimos $RETENCAO_DIAS dias em $DEST"

diz "FIM OK — $SAIDA"
