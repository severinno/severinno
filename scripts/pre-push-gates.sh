#!/usr/bin/env bash
# Pre-push gates — espelha no push os gates rápidos que o CI roda num PR
# (validate-cache-manifest, check-js-budget e a suíte unitária completa),
# para o push não quebrar o pipeline depois de já estar localmente verde.
#
# Ordem: igual à do CI (cache manifest → budget de JS → suíte unitária).
# `set -euo pipefail` (herdado da chamada no .husky/pre-push): a primeira
# falha aborta o script e bloqueia o push.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "── Gate 1/3: validate-cache-manifest ──"
bun scripts/validate-cache-manifest.ts

echo "── Gate 2/3: check-js-budget (JS bundle budgets) ──"
# check-js-budget lê .next/analyze/client.html do build ANALYZE. Se o
# relatório não existir (dev nunca rodou o build com ANALYZE), não há dado
# comparável — pulamos com aviso em vez de bloquear o push com exit 2 do
# script: o CI roda o budget no build fresco de qualquer forma. Mesma
# semântica de "honest skip" que o próprio budget usa no fallback
# rootMainFiles.
if [ -f .next/analyze/client.html ]; then
  # AVISO: um relatório DESATUALIZADO roda contra artefatos antigos (falso
  # pass/fail) — se o build local for antigo, rode o ANALYZE antes de confiar.
  node scripts/check-js-budget.mjs
else
  echo "⚠️  .next/analyze/client.html não encontrado — pulando check-js-budget."
  echo "   Rode 'ANALYZE=true next build --webpack' localmente para validar;"
  echo "   o CI roda o budget no build fresco de qualquer forma."
fi

echo "── Gate 3/3: suíte unitária completa ──"
bun run test:unit

echo "✅ pre-push: todos os gates passaram"
