#!/usr/bin/env bash
# Pre-push gates - espelha no push os gates rapidos que o CI roda num PR
# (validate-cache-manifest, check-js-budget e os testes unitarios das areas
# tocadas), para o push nao quebrar o pipeline depois de ja estar localmente
# verde.
#
# Ordem: igual a do CI (cache manifest -> budget de JS -> testes das areas
# tocadas). O Gate 3 reusa o mapeamento do pre-commit (pre-commit-tests.mjs)
# com --scope push: staged + HEAD + range do push (commits que serao
# enviados, via PRE_PUSH_REMOTE_SHA capturado do stdin do hook). Areas
# tocadas em vez da suite completa - o pre-commit ja limita as areas tocadas;
# o CI roda a suite completa como rede de seguranca.
# `set -euo pipefail` (herdado da chamada no .husky/pre-push): a primeira
# falha aborta o script e bloqueia o push.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "-- Gate 1/3: validate-cache-manifest --"
bun scripts/validate-cache-manifest.ts

echo "-- Gate 2/3: check-js-budget (JS bundle budgets) --"
# check-js-budget le .next/analyze/client.html do build ANALYZE. Se o
# relatorio nao existir (dev nunca rodou o build com ANALYZE), nao ha dado
# comparavel - pulamos com aviso em vez de bloquear o push com exit 2 do
# script: o CI roda o budget no build fresco de qualquer forma. Mesma
# semantica de "honest skip" que o proprio budget usa no fallback
# rootMainFiles.
if [ -f .next/analyze/client.html ]; then
  # AVISO: um relatorio DESATUALIZADO roda contra artefatos antigos (falso
  # pass/fail) - se o build local for antigo, rode o ANALYZE antes de confiar.
  node scripts/check-js-budget.mjs
else
  echo "[!]  .next/analyze/client.html nao encontrado - pulando check-js-budget."
  echo "   Rode 'ANALYZE=true next build --webpack' localmente para validar;"
  echo "   o CI roda o budget no build fresco de qualquer forma."
fi

echo "-- Gate 3/3: testes unitarios das areas tocadas (staged + HEAD + range do push) --"
# --since recebe o remote sha da 1a linha de refs do stdin do hook
# ("<local ref> <local sha> <remote ref> <remote sha>"), capturado pelo
# .husky/pre-push. Ausente ou zeros (1o push de branch / rodada manual) ->
# fallback para staged + HEAD (trabalho nao commitado). Skip honesto quando
# nada mapeia (docs-only) - mesma semantica do pre-commit.
node scripts/pre-commit-tests.mjs --scope push --since "${PRE_PUSH_REMOTE_SHA:-}"

echo "[OK] pre-push: todos os gates passaram"
