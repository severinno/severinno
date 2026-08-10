#!/usr/bin/env bash
# eslintd-shim.sh - eslint_d com restart condicional por hash de config (2026-08)
#
# WHY: a secao 11.2 do gates-proofs.md RECUSOU o eslint_d no lint-staged porque
# o daemon NAO reinicia em mudanca de config (staleness silenciosa: uma edicao
# de regra staged no mesmo commit seria lintada com a config ANTIGA). O lever
# que faltava (citado na 11.2 e medido na 11.6): este shim detecta a mudanca
# entre runs e roda `eslint_d restart` SO quando mudou - fechando o furo de
# lifecycle sem pagar o cold start em todo commit.
#
# FINGERPRINT: sha256 de eslint.config.mjs + os package.json dos plugins que
# a config carrega (as deps de plugin do node_modules - se um plugin muda de
# versao, o daemon precisa reiniciar tambem). O fingerprint e persistido em
# node_modules/.cache/eslintd-config.sha256 (gitignored, por-maquina) - se o
# cache sumir (install limpo), o proximo run restarta, exatamente o correto.
#
# FLOW: fingerprint atual == cache -> roda eslint_d direto (warm, ~1s).
# fingerprint != cache -> eslint_d restart (cold, ~13-23s) + roda. Fallback:
# se eslint_d NAO estiver instalado (ex.: dev sem o binario), roda o eslint
# puro (o baseline, ~8s) - o hook nunca quebra por ausencia do daemon.
#
# Saida ASCII pura (gate file). Puro bash + sha256sum, sem deps.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ESLINTD="$ROOT/node_modules/.bin/eslint_d"
ESLINT="$ROOT/node_modules/.bin/eslint"

# Fallback: sem eslint_d, usa o eslint puro (comportamento baseline da 11.2).
if [ ! -x "$ESLINTD" ]; then
  exec "$ESLINT" "$@"
fi

# Fingerprint da config + deps de plugin (os imports da config).
# eslint.config.mjs importa os bundles do eslint-config-next; o que muda a
# config em runtime sao esses arquivos + as versoes de plugin no node_modules.
FINGERPRINT="$(
  {
    cat "$ROOT/eslint.config.mjs"
    # o proprio eslint + o eslint_d (o daemon): se qualquer um bump sem
    # plugin mudar, o daemon precisa reiniciar tambem (o status do daemon
    # reporta a versao que ele carregou)
    for pkg_path in "$ROOT/node_modules/eslint/package.json" "$ROOT/node_modules/eslint_d/package.json"; do
      if [ -f "$pkg_path" ]; then cat "$pkg_path"; fi
    done
    # deps de plugin: os package.json das packages que a config pode carregar
    for p in eslint-config-next/core-web-vitals eslint-config-next/typescript; do
      pkg="$ROOT/node_modules/$p/package.json"
      if [ -f "$pkg" ]; then cat "$pkg"; fi
    done
    for p in eslint-plugin-react eslint-plugin-react-hooks eslint-plugin-jsx-a11y \
             eslint-plugin-import @typescript-eslint/eslint-plugin @next/eslint-plugin-next \
             eslint-plugin-react-compiler; do
      pkg="$ROOT/node_modules/$p/package.json"
      if [ -f "$pkg" ]; then cat "$pkg"; fi
    done
  } | sha256sum | cut -d' ' -f1
)"

CACHE_DIR="$ROOT/node_modules/.cache"
STAMP="$CACHE_DIR/eslintd-config.sha256"
mkdir -p "$CACHE_DIR"

if [ ! -f "$STAMP" ] || [ "$(cat "$STAMP")" != "$FINGERPRINT" ]; then
  # Config/deps mudaram desde o ultimo run: restart para o daemon carregar
  # o estado novo (o furo da 11.2 fechado). Se o daemon nao estava rodando,
  # o restart inicia; se ja estava com a config certa (cache apagado), o
  # restart e custoso mas correto.
  # SO escreve o stamp se o restart SUCEDER: se ele falhar (daemon velho
  # ainda vivo), o proximo run tenta restart de novo - a direcao fail-safe
  # (restart sempre tentado) em vez de mascarar a falha e lintear com a
  # config antiga.
  if "$ESLINTD" restart >/dev/null 2>&1; then
    printf '%s' "$FINGERPRINT" > "$STAMP"
  fi
fi

exec "$ESLINTD" "$@"
