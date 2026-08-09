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
ANALYZE_HTML=".next/analyze/client.html"
# Honest-skip do budget (motivo varia: arquivo ausente ou artefato stale). O
# CI roda o budget no build fresco de qualquer forma, entao pular localmente
# so perde um sanity check rapido - nunca mascara o CI. Mensagem unica para
# os dois casos (DRY: futura mudanca de texto em um so lugar).
skip_budget() {
  echo "[!]  $ANALYZE_HTML $1 - pulando check-js-budget."
  echo "   Rode 'ANALYZE=true next build --webpack' localmente para validar;"
  echo "   o CI roda o budget no build fresco de qualquer forma."
}
if [ -f "$ANALYZE_HTML" ]; then
  # STALENESS GUARD (medicao 2026-08): o gate falhava contra um relatorio
  # de ontem - um artefato antigo roda check-js-budget contra dados que nao
  # refletem o codigo atual (falso pass OU falso fail, os dois silenciosos).
  # Definicao precisa de stale: o relatorio e mais velho que o ultimo commit
  # (mtime < HEAD commit time) - nao um threshold de tempo de calendario, que
  # deixaria um report de 23h passar mesmo depois de um commit novo. Comparar
  # contra HEAD e deterministico: o relatorio so e confiavel se foi gerado a
  # partir do codigo atual (ou posterior a ele). Honest-skip com o mesmo
  # aviso do caso "arquivo ausente": o CI roda o budget no build fresco de
  # qualquer forma, entao um relatorio stale so pode enganar o dev local.
  HEAD_CT="$(git log -1 --format=%ct 2>/dev/null || echo 0)"
  REPORT_MT="$(stat -c %Y "$ANALYZE_HTML" 2>/dev/null || echo 0)"
  if [ "$REPORT_MT" -lt "$HEAD_CT" ]; then
    skip_budget "e mais antigo que o ultimo commit (artefato stale)"
  else
    node scripts/check-js-budget.mjs
  fi
else
  skip_budget "nao encontrado"
fi

echo "-- Gate 3/3: testes unitarios das areas tocadas (staged + HEAD + range do push) --"
# --since recebe o remote sha da 1a linha de refs do stdin do hook
# ("<local ref> <local sha> <remote ref> <remote sha>"), capturado pelo
# .husky/pre-push. Ausente ou zeros (1o push de branch / rodada manual) ->
# fallback para staged + HEAD (trabalho nao commitado). Skip honesto quando
# nada mapeia (docs-only) - mesma semantica do pre-commit.
node scripts/pre-commit-tests.mjs --scope push --since "${PRE_PUSH_REMOTE_SHA:-}"

echo "[OK] pre-push: todos os gates passaram"
