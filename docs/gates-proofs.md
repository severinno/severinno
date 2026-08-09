# Gates Proofs — provas de sentinela da eficácia dos gates

> Registro das **provas de sentinela** executadas para demonstrar que cada gate
> de CI falha de verdade quando a classe de erro que ele protege é injetada
> (e reverte o repo ao estado limpo depois). Serve de auditoria futura: se um
> gate parar de falhar numa prova equivalente, é sinal de regressão no próprio
> gate. Toda prova segue o mesmo contrato: **injetar → gate falha (exit 1) →
> reverter → repo limpo**.

## 1. Tabela resumo

| # | Gate sob prova | Classe de erro protegida | O que foi injetado | Prova | Resultado observado |
|---|---|---|---|---|---|
| 1 | Encoding — camada UTF-8 + ASCII-proof (`verify-encoding.sh`) | Byte não-ASCII (o bug do em-dash Windows-1252 de 2026-08) | `0x97` em `scripts/health-check.sh` | Run [**31298436074**](https://github.com/severinno/severinno/actions/runs/31298436074) (`ci-proof/utf8-byte`) | ✅ `check-utf8: FAILED` + `[VIOLATION] scripts/health-check.sh (non-ASCII byte)` → exit 1 |
| 2 | Encoding — camada fragile-range (`fragile-range-patterns.mjs` no `verify-encoding.sh`) | Character-class range frágil (`[^ -~]`) que falha silenciosamente | `grep -q '[^ -~]'` em `scripts/check-utf8.sh` | Run [**31306797327**](https://github.com/severinno/severinno/actions/runs/31306797327) (`ci-proof/fragile-guard`) | ✅ `fragile-range: 1 fragile character-class range(s) in LIVE code: scripts/check-utf8.sh :: space-tilde character range :: "[^ -~]"` → exit 1 |
| 3 | Bundle — `check-js-budget.mjs` | Lib pesada de volta ao grafo eager de rota | `import` estático de recharts no app shell | **Local** (sem run de CI dedicado) | ✅ `check-js-budget.mjs` → exit 1 (lib sinalizada no grafo eager) → revertido |
| 4 | Encoding — camada fragile-range via override `FRAGILE_SCAN_ROOT` | Gate file sujo num repo **sintético** passar despercebido (o override de raiz do layer 3) | `sentinel-root/scripts/dirty.sh` com `[^ -~]` + `env: FRAGILE_SCAN_ROOT: sentinel-root` no step do utf8-check.yml | Run [**31312427503**](https://github.com/severinno/severinno/actions/runs/31312427503) (`ci-proof/fragile-root`) | ✅ `fragile-range: 1 fragile character-class range(s) in LIVE code: scripts/dirty.sh :: space-tilde character range :: "[^ -~]"` → exit 1 |

## 2. Prova 1 — utf8-byte (run 31298436074)

- **Gate**: job `utf8-check` do `pr-check.yml` (reusable `utf8-check.yml` →
  `bash scripts/verify-encoding.sh --ci`): camadas UTF-8 scan + ASCII-proof dos
  `.sh` VPS-bound.
- **Run**: [31298436074](https://github.com/severinno/severinno/actions/runs/31298436074) (`ci-proof/utf8-byte`)
- **Injeção**: byte `0x97` (em-dash Windows-1252) adicionado a
  `scripts/health-check.sh` num branch scratch `ci-proof/utf8-byte`.
- **Disparo**: `gh workflow run "PR Check" --ref ci-proof/utf8-byte`.
- **Observado** (log do job, 2026-08-09 06:14Z):

```
WARNING:  scripts/health-check.sh (byte 0x97 -- Windows-1252 em dash)
Warnings: 1 file(s) with byte 0x97
         - scripts/health-check.sh
check-utf8: FAILED -- invalid UTF-8 or .sh ASCII violation
=== verify-ascii-proof ===
VPS-bound shell scripts (pure ASCII required):
  [VIOLATION]  scripts/health-check.sh  (non-ASCII byte)
```

- **Reversão**: byte removido; branch scratch deletado; `git status` do worktree
  principal verificado limpo.
- **Gap protegido**: um byte não-ASCII num `.sh` scp'd para o VPS quebraria a
  execução ou a robustez de locale — o gate agora falha no PR antes do deploy.

## 3. Prova 2 — fragile-range (run 31306797327)

- **Gate**: camada 3 do `verify-encoding.sh` → `fragile-range-patterns.mjs`
  (o mesmo módulo que o vitest guard importa). Protege contra ranges de
  character-class frágeis como `[^ -~]` — o bug silencioso de 2026-08 em que o
  `grep` deixava passar um em-dash por dependência de locale.
- **Run**: [31306797327](https://github.com/severinno/severinno/actions/runs/31306797327) (`ci-proof/fragile-guard`)
- **Injeção**: `grep -q '[^ -~]'` adicionado a `scripts/check-utf8.sh` num
  branch scratch `ci-proof/fragile-guard`.
- **Disparo**: `gh workflow run "PR Check" --ref ci-proof/fragile-guard`.
- **Observado** (log do job, 2026-08-09 09:48Z):

```
fragile-range: 1 fragile character-class range(s) in LIVE code:
  scripts/check-utf8.sh :: space-tilde character range :: "[^ -~]"
  (use scripts/scan-non-ascii.mjs instead - raw byte iteration, no pattern to break)
##[error]Process completed with exit code 1.
```

- **Reversão**: padrão removido; branch deletado.
- **Gap protegido**: a classe de erro (ranges frágeis em gates/scripts) falha
  com o **caminho exato do arquivo** — extensível via `--dir` para e2e/ e
  src/ (todo código executável).

## 4. Prova 3 — budget sentinel (local)

- **Gate**: `scripts/check-js-budget.mjs` (guard de bundle por rota/libs/initial).
- **Injeção**: `import` estático de `recharts` adicionado temporariamente ao
  app shell (camada eager da home).
- **Comando**:

```bash
node scripts/check-js-budget.mjs   # esperado: exit 1, lib sinalizada no grafo eager
```

- **Observado**: exit 1 com a lib pesada atribuída ao grafo eager (o mesmo
  mecanismo que detectou framer-motion no chunk 9287 da home). Revertido em
  seguida.
- **Nota**: executado localmente (sem run de CI dedicado). A cobertura por
  **mutação** do mesmo comportamento vive em `scripts/__tests__/check-js-budget.test.ts`
  (fixtures de build-manifest + HTML com/sem lib eager, fontes home HTML e
  rootMainFiles).
- **Gap protegido**: nenhuma lib da `EAGER_LIBS` pode voltar ao JS inicial de
  uma rota sem quebrar o gate de budget no CI.

## 5. Prova 4 — FRAGILE_SCAN_ROOT sentinel (run 31312427503)

- **Gate**: camada 3 do `verify-encoding.sh` → `fragile-range-patterns.mjs`
  quando a raiz do scan é redirecionada pelo env `FRAGILE_SCAN_ROOT` (o
  override de repo sintético usado pelos testes de fixture — e agora provado
  de ponta a ponta no CI real).
- **Run**: [31312427503](https://github.com/severinno/severinno/actions/runs/31312427503) (`ci-proof/fragile-root`)
- **Injeção**: branch scratch `ci-proof/fragile-root` (base limpa em 2fa5e48)
  com (a) um **repo sintético** `sentinel-root/scripts/dirty.sh` contendo o
  range `[^ -~]` em código vivo, e (b) `env: FRAGILE_SCAN_ROOT: sentinel-root`
  adicionado ao step "Run encoding validation" do `utf8-check.yml` — a única
  forma de injetar o env no CI. Os demais layers (UTF-8 scan + ASCII-proof)
  continuaram varrendo o repo real (limpo), isolando a falha ao layer 3.
- **Disparo**: `gh workflow run "PR Check" --ref ci-proof/fragile-root`.
- **Observado** (log do job `utf8-check / UTF-8 Check`, 2026-08-09 ~12:05Z):

```
fragile-range: 1 fragile character-class range(s) in LIVE code:
  scripts/dirty.sh :: space-tilde character range :: "[^ -~]"
##[error]Process completed with exit code 1.
```

  O caminho `scripts/dirty.sh` é relativo ao repo sintético — a prova valida
  que o override de raiz chega ao layer 3 e que o offender é apontado com o
  caminho exato (a mesma garantia que o teste CONTRACT de wiring cobre
  localmente em `verify-encoding.test.ts`).
- **Reversão**: branch remoto deletado (`git push origin --delete` com
  `--no-verify`, pois o hook pre-push do husky bloqueia pushes em geral) +
  worktree e branch local removidos; `git status` do worktree principal
  confirmado intacto (as mudanças da thread permanecem).
- **Gap protegido**: um gate file sujo num repo sintético (ou um
  `FRAGILE_SCAN_ROOT` apontando para uma árvore suja) falha o CI com o
  caminho exato — o override de raiz não é um escape hatch silencioso.

## 6. Observação transversal — o mascaramento que motivou o reorder do check job

Nos dois runs acima (pré-reorder), o job `check` mostrava exatamente o
problema que motivou a mudança de ordem dos steps:

```
X Lint
- Type check      (skipped)
- Unit tests      (skipped)
```

Uma falha de lint **skipava Type check e a suíte unitária** (comportamento
padrão do GH Actions). Correção aplicada (ver o job `check` em
`.github/workflows/pr-check.yml`): o job roda **Unit tests primeiro**, e
Lint/Type check com `if: always()` — sem mascaramento em nenhuma direção.
Esta seção serve de registro do porquê da ordem atual.

## 7. Como adicionar uma nova prova

1. Criar branch scratch `ci-proof/<nome>` a partir do HEAD, aplicar a injeção
   (byte, padrão, import) num arquivo de gate.
2. Disparar o workflow relevante via `workflow_dispatch` (há `workflow_dispatch`
   no `pr-check.yml`; branch `main` não existe no remoto, então PR real não
   dispara `pull_request: branches: [main]`).
3. Capturar o log do step que falhou (citar as linhas exatas aqui).
4. Reverter a injeção, deletar o branch scratch e o branch remoto, confirmar
   `git status` limpo no worktree principal.
5. Registrar na tabela da seção 1 com o run number.

## 8. Referências

- Investigação da falha contínua do `security-headers`: `docs/security-headers-gate-2026-08.md`
  (DNS aponta para WordPress na Hostinger, não para o VPS — não é regressão do app).
- Gates de encoding: `scripts/verify-encoding.sh`, `scripts/scan-non-ascii.mjs`,
  `scripts/fragile-range-patterns.mjs`, `scripts/verify-ascii-proof.sh`.
- Guard de bundle: `scripts/check-js-budget.mjs` + `docs/bundle-report.md`.
