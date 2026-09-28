#!/usr/bin/env bash
# =============================================================================
# scripts/preflight-bun-path.sh — o preflight do bun no PATH dos jobs de meta-suítes.
#
# Ele existe para NOMEAR cedo a causa que senão sai engolida: as meta-suítes
# (doctor-ci, forge-doctor, pre-push-blocks, prove-runner-image, pre-commit-real-proof)
# rodam provas reais que invocam `bun` por `spawnSync`, e uma prova sem o binário
# sai `unavailable` FAIL-CLOSED (por desenho — nunca falseia veredito). O job
# recebe então um vermelho de suíte cuja mensagem real (`spawnSync bun ENOENT`)
# só aparece enterrada no evidence — medido num checkout local (28/09/2026,
# bun em ~/.bun/bin fora do PATH de shells não-interativos: 5 das 6 meta-suítes
# caem exatamente assim). O preflight falha ANTES com a razão nomeada, e a
# disciplina fail-closed fica intacta: nada é stubado, nada é pulado.
#
# O alvo é o BINÁRIO RESOLVÍVEL, não um caminho: `command -v bun` é o mesmo
# mecanismo de resolução do `spawnSync` que as provas usam (PATH, sem depender
# de onde o bun foi instalado). E a VERSÃO é ecoada no veredito: um job que
# sobe com outro bun do que a variável declara é um diagnóstico que hoje só
# aparece muito depois.
#
# Usage:
#   bash scripts/preflight-bun-path.sh
#
# Exit codes:
#   0 — o bun resolve pelo PATH (a versão vai no stdout)
#   1 — o bun NÃO resolve pelo PATH (a causa nomeada vai no stderr)
# =============================================================================

set -euo pipefail

if ! ALVO="$(command -v bun 2>/dev/null)"; then
  echo "❌ preflight-bun-path: 'bun' NÃO resolve pelo PATH — as provas reais das meta-suítes " >&2
  echo "   (doctor-ci, forge-doctor, pre-push-blocks, prove-runner-image, pre-commit-real-proof) " >&2
  echo "   invocam o binário por spawnSync e sairiam fail-closed ('unavailable') sem ele. " >&2
  echo "   Remédio local: 'ln -sf ~/.bun/bin/bun ~/.local/bin/bun' (o ~/.local/bin já está no PATH " >&2
  echo "   de shells não-interativos); no CI: o passo 'Setup Bun' (setup-bun-ci.sh) tem de rodar " >&2
  echo "   ANTES deste job/step. Ver README 'Testing → Bun no PATH' e o issue #32." >&2
  exit 1
fi

VERSAO="$(bun --version 2>/dev/null || echo '?')"
echo "✅ preflight-bun-path: bun ${VERSAO} em ${ALVO}"
