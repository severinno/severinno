#!/usr/bin/env bash
# =============================================================================
# setup-bun-ci.sh — setup do Bun para CI, SEM composite action local.
#
# POR QUE ESTE ARQUIVO EXISTE (no lugar do ./.github/actions/setup-bun)
#   `uses: ./<path>` depende do resolvedor de ACTIONS LOCAIS do runner. Um
#   `run:` NÃO passa por esse resolvedor — ele só precisa do arquivo no
#   checkout. Trocar o setup para cá remove essa dependência nas DUAS forjas.
#
#   (Verificado em gitea/act, pkg/runner/step_action_local.go: action local é
#   resolvido como filepath.Join(Config.Workdir, uses). Ou seja, renomear o
#   diretório do composite NÃO muda nada — por isso a saída é tirar o `uses:`.)
#
# AS 3 CAMADAS (as mesmas do composite, na mesma ordem e com os mesmos sinais)
#   1. PRE-INSTALLED — `bun` já no PATH na versão pedida (imagem que embarca
#      Bun: runner auto-hospedado ou a imagem <registry>/<owner>/ubuntu-bun)
#      → ~0s, ZERO download e ZERO I/O de cache.
#   2. CACHE — `~/.bun/bin/bun` na versão pedida, restaurado por um step
#      `actions/cache@v4` ANTES deste → ~1-2s. A key canônica é
#      `bun-<versão>-<os>-<arch>` — a MESMA do composite, para que caches já
#      quentes continuem válidos (ver o guard check:bun-mirror, que trava a key).
#   3. COLD — mirror OCI (docker pull + docker cp, ~1-3s, sem rate limit do
#      GitHub Releases) e, se o mirror faltar ou não houver docker, o download
#      direto do release (~5-10s).
#
# O par canônico no workflow (a key e a versão vêm da fonte única):
#
# Usage:
#   - uses: actions/cache@v4
#     with:
#       path: ~/.bun
#       key: bun-${{ vars.BUN_VERSION }}-${{ runner.os }}-${{ runner.arch }}
#   - name: Setup Bun
#     shell: bash
#     run: bash scripts/setup-bun-ci.sh "${{ vars.BUN_VERSION }}"
#
#   O step de cache é OPCIONAL: sem ele o script simplesmente começa no tier 2
#   (falha a checagem de cache) e vai para o tier 3.
#
# Uso local (sem runner) — para teste manual do script:
#   bash scripts/setup-bun-ci.sh 1.3.14
#   (sem GITHUB_PATH o script apenas reporta, não escreve no PATH do job)
#
# Exit codes:
#   0 — Bun disponível na versão pedida
#   1 — plataforma não suportada, ou download/extração falhou
#   2 — uso inválido (falta o argumento de versão)
# =============================================================================
set -euo pipefail

VERSION="${1:-}"

if [ -z "$VERSION" ]; then
  echo "::error::setup-bun: versão do Bun não informada."
  echo "  Passe a versão como argumento — ela vem da FONTE ÚNICA (variable BUN_VERSION):"
  echo '    run: bash scripts/setup-bun-ci.sh "${{ vars.BUN_VERSION }}"'
  exit 2
fi

BUN_BIN="$HOME/.bun/bin/bun"
BUNX_LINK="$HOME/.bun/bin/bunx"

# Adiciona ~/.bun/bin ao PATH do job. Fora do runner (GITHUB_PATH ausente) só
# reporta — é o que permite testar este script localmente sem efeito colateral.
add_to_path() {
  if [ -n "${GITHUB_PATH:-}" ]; then
    echo "$HOME/.bun/bin" >>"$GITHUB_PATH"
  else
    echo "  (GITHUB_PATH ausente — execução local: PATH do job não alterado)"
  fi
}

# ── Camada 1: Bun pré-instalado na imagem ────────────────────────────────────
# Marcador estável: o guard periódico check:tier1-fastpath casa exatamente
# 'Usando Bun pré-instalado: <versão>' para provar que o fast path engajou.
if command -v bun >/dev/null 2>&1; then
  FOUND="$(bun --version 2>/dev/null || true)"
  if [ "$FOUND" = "$VERSION" ]; then
    echo "✅ Usando Bun pré-instalado: ${FOUND} (0s, sem download)"
    exit 0
  fi
  echo "::notice::Bun ${FOUND:-?} pré-instalado difere da versão pedida (${VERSION}) — seguindo para o cache"
fi

# ── Camada 2: cache restaurado (actions/cache@v4 rodou ANTES deste step) ─────
if [ -x "$BUN_BIN" ]; then
  FOUND="$("$BUN_BIN" --version 2>/dev/null || true)"
  if [ "$FOUND" = "$VERSION" ]; then
    # Cache antigo (pré-fix) pode ter o bun sem o symlink bunx — idempotente e
    # barato. Sem ele, `bunx ...` falha com exit 127.
    [ -e "$BUNX_LINK" ] || ln -sf "$BUN_BIN" "$BUNX_LINK"
    add_to_path
    echo "✅ Bun do cache: ${FOUND} (sem download)"
    exit 0
  fi
  echo "::notice::cache tem Bun ${FOUND:-?}, pedido ${VERSION} — baixando o release exato"
fi

# ── Camada 3: download do release exato ──────────────────────────────────────
# Mapeia runner.os/arch → nome do asset bun-<os>-<arch>.zip. Fora do runner
# (teste local) cai no uname.
OS_RAW="${RUNNER_OS:-$(uname -s)}"
ARCH_RAW="${RUNNER_ARCH:-$(uname -m)}"
case "$OS_RAW" in
  Linux | linux) OS=linux ;;
  Darwin | darwin) OS=darwin ;;
  Windows) OS=windows ;;
  *)
    echo "::error::OS não suportado: $OS_RAW" >&2
    exit 1
    ;;
esac
case "$ARCH_RAW" in
  X64 | x86_64 | amd64) ARCH=x64 ;;
  ARM64 | aarch64 | arm64) ARCH=aarch64 ;;
  *)
    echo "::error::arch não suportado: $ARCH_RAW" >&2
    exit 1
    ;;
esac

mkdir -p "$HOME/.bun/bin"

# ── 3a. Mirror OCI (linux/x64 apenas) ───────────────────────────────────────
# Pull da imagem scratch (docker create + docker cp extrai /bun). O mirror é
# OTIMIZAÇÃO, não requisito: sem docker ou sem a imagem, cai no 3b.
# O host do mirror vem de IMAGE_REGISTRY (fonte única do registry de imagens).
if [ "$OS" = "linux" ] && [ "$ARCH" = "x64" ] && command -v docker >/dev/null 2>&1; then
  OWNER="${GITHUB_REPOSITORY_OWNER:-severinno}"
  MIRROR="${IMAGE_REGISTRY:-ghcr.io}/${OWNER}/bun:${VERSION}"
  echo "::group::Puxando Bun ${VERSION} do mirror OCI (${MIRROR})"
  if docker pull "$MIRROR" >/dev/null 2>&1; then
    CID="$(docker create "$MIRROR" 2>/dev/null || true)"
    if [ -n "$CID" ] && docker cp "$CID:/bun" "$BUN_BIN" >/dev/null 2>&1; then
      chmod +x "$BUN_BIN" 2>/dev/null || true
      ln -sf "$BUN_BIN" "$BUNX_LINK"
      echo "  ✅ Mirror OCI ok — bun $("$BUN_BIN" --version 2>/dev/null || echo '?')"
      docker rm -f "$CID" >/dev/null 2>&1 || true
      echo "::endgroup::"
      add_to_path
      exit 0
    fi
    [ -n "$CID" ] && docker rm -f "$CID" >/dev/null 2>&1 || true
  fi
  echo "  ⚠️ Mirror OCI indisponível (${MIRROR}) — fallback p/ GitHub Releases"
  echo "::endgroup::"
fi

# ── 3b. Fallback: download direto do GitHub Releases ────────────────────────
URL="https://github.com/oven-sh/bun/releases/download/bun-v${VERSION}/bun-${OS}-${ARCH}.zip"
echo "::group::Baixando Bun ${VERSION} (${OS}-${ARCH}) do GitHub Releases"
echo "URL: ${URL}"
TMP_DIR="$(mktemp -d)"
curl -fsSL "$URL" -o "$TMP_DIR/bun.zip"
unzip -qo "$TMP_DIR/bun.zip" -d "$HOME/.bun"
rm -rf "$TMP_DIR"

# O zip extrai para uma pasta (ex.: bun-linux-x64/bun) — normaliza para o
# layout do instalador oficial, ~/.bun/bin/bun, que é o MESMO caminho que o
# actions/cache salva (mantendo a key compatível).
find "$HOME/.bun" -type f -name bun -exec mv -f {} "$BUN_BIN" \; 2>/dev/null || true
chmod +x "$BUN_BIN" 2>/dev/null || true

# CRÍTICO: o zip do release contém APENAS o binário `bun`; o `bunx` é um
# symlink do instalador oficial. Sem ele, steps que usam `bunx` (bunx prisma
# generate, bunx tsc) morrem com exit 127 — foi um bug real de CI.
ln -sf "$BUN_BIN" "$BUNX_LINK"

"$BUN_BIN" --version
echo "bunx -> $(readlink -f "$BUNX_LINK" 2>/dev/null || echo "$BUNX_LINK")"
echo "::endgroup::"

add_to_path
