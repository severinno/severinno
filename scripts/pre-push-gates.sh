#!/usr/bin/env bash
# Pre-push gates — espelha no push os gates rápidos que o CI roda num PR
# (validate-cache-manifest, check-js-budget e os testes unitários das áreas
# tocadas), para o push não quebrar o pipeline depois de já estar localmente
# verde.
#
# Ordem: igual à do CI (cache manifest → budget de JS → testes das áreas
# tocadas). O Gate 3 reusa o mapeamento do pre-commit (pre-commit-tests.mjs)
# com --scope push: staged + HEAD + range do push (commits que serão
# enviados, via PRE_PUSH_REMOTE_SHA capturado do stdin do hook). Áreas
# tocadas em vez da suíte completa — o pre-commit já limita às áreas tocadas;
# o CI roda a suíte completa como rede de segurança.
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

echo "── Gate 3/3: testes unitários das áreas tocadas (staged + HEAD + range do push) ──"
# --since recebe o remote sha da 1ª linha de refs do stdin do hook
# ("<local ref> <local sha> <remote ref> <remote sha>"), capturado pelo
# .husky/pre-push. Ausente ou zeros (1º push de branch / rodada manual) →
# fallback para staged + HEAD (trabalho não commitado). Skip honesto quando
# nada mapeia (docs-only) — mesma semântica do pre-commit.
node scripts/pre-commit-tests.mjs --scope push --since "${PRE_PUSH_REMOTE_SHA:-}"

echo "✅ pre-push: todos os gates passaram"
