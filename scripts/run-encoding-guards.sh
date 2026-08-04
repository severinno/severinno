#!/usr/bin/env bash
# =============================================================================
# run-encoding-guards.sh
#
# Runner compartilhado dos 16 guards de encoding/CI que os hooks locais
# executam de forma IDÊNTICA — .husky/pre-commit e .husky/pre-push chamam
# este script em vez de duplicar a lista. Adicionar um guard novo = editar
# UM lugar (aqui), sem risco de drift entre os dois hooks.
#
# A lista espelha os fast gates do .github/workflows/utf8-check.yml (CI):
#
#   1. check-utf8.sh            — UTF-8 válido em todos os .ts/.tsx (byte 0x97)
#   2. check-utf8-scope.mjs      — escopo do check-utf8 travado em src/
#   3. check-crlf.sh            — working tree sem CRLF em .sh/.bash
#   4. check-crlf-scope.mjs      — escopo dos guards CRLF travado em *.sh/*.bash
#   5. check-blob-crlf.sh       — blobs commitados sem CRLF (i/crlf, i/mixed)
#   6. check-single-line-out-assign.sh — sem `cmd "..." out=$(...)` em 1 linha
#   7. check-encoding-guards-badge.mjs — badge do README ↔ tabela Encoding Guards
#   8. check-readme-repro-marker.mjs   — sem repro de bug corrigido sem marcador
#   9. check-readme-anchors.mjs   — links internos #slug do README ↔ headings reais
#  10. check-readme-toc.mjs        — TOCs do README ↔ headings (forward + reverse + label)
#  11. check-readme-images.mjs      — imagens do README ↔ arquivos/URLs reais
#  12. check-no-setup-bun.mjs   — sem oven-sh/setup-bun@v2 nos workflows
#  13. check-bun-mirror.mjs     — fonte única Bun (vars.BUN_VERSION) ok
#  14. scan-lucide-icons.mjs    — ícones lucide do vitrine sincronizados
#  15. check-hooks-symmetry.mjs  — tabela '## Git Hooks' do README ↔ hooks reais
#  16. check-mutation-jobs.mjs   — todo test-mutation-*.sh tem job no CI
#
# Usage:
#   bash scripts/run-encoding-guards.sh
#
# Exit codes:
#   0 — todos os guards passaram
#   1 — pelo menos um guard falhou (set -e interrompe no primeiro)
# =============================================================================

set -euo pipefail

bash scripts/check-utf8.sh --dry-run --ci src/
node scripts/check-utf8-scope.mjs
bash scripts/check-crlf.sh --ci
node scripts/check-crlf-scope.mjs
bash scripts/check-blob-crlf.sh --ci
bash scripts/check-single-line-out-assign.sh --ci
node scripts/check-encoding-guards-badge.mjs
node scripts/check-readme-repro-marker.mjs
node scripts/check-readme-anchors.mjs
node scripts/check-readme-toc.mjs
node scripts/check-readme-images.mjs
node scripts/check-no-setup-bun.mjs
node scripts/check-bun-mirror.mjs
node scripts/scan-lucide-icons.mjs --check
node scripts/check-hooks-symmetry.mjs
node scripts/check-mutation-jobs.mjs

echo "✅ Todos os 16 guards de encoding/CI passaram (run-encoding-guards.sh)."
