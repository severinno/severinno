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
| 5 | Encoding — camada UTF-8 (`check-utf8.sh`) no **fixed dir `.zscripts/`** (workspace-agent ops scripts) | Corrupção UTF-8 num `.zscripts/*.sh` (ex.: byte 0x97 Windows-1252) | `0x97` anexado a `.zscripts/build.sh` | **Local** (sem run de CI dedicado; o fixed dir é ALWAYS-scanned, o mesmo caminho do CI) | ✅ `WARNING: .zscripts\build.sh (byte 0x97 -- Windows-1252 em dash)` + `check-utf8: FAILED` → exit 1 → revertido byte-identical |
| 6 | Fragile-range — **SPREAD CONTRACT** (a derivação `--dir ...TARGET_DIRS` cobre árvores futuras) | Um 5º dir no `TARGET_DIRS` real escapar da cobertura do guard | `workers` injetado no `TARGET_DIRS` real + `workers/dirty.ts` com `[^ -~]` | Run [**31331423557**](https://github.com/severinno/severinno/actions/runs/31331423557) (`ci-proof/spread-live`) + prova local 2026-08-09 | ✅ **CI (utf8-check / UTF-8 Check)**: `fragile-range: 1 fragile character-class range(s) in LIVE code: dirty.ts :: space-tilde character range :: "[^ -~]"` → exit 1; job `Fragile Range Guard` também falhou; local: guard suite 7 falhas + golden-copy divergence; revertido byte-identical |

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

## 6. Prova 5 — .zscripts fixed-dir 0x97 sentinel (local)

- **Gate**: camada 1 do `verify-encoding.sh` → `check-utf8.sh` (`check_utf8.py`),
  que varre os **fixed dirs** sempre-escaneados — `scripts/`, `.github/workflows/`
  e `.zscripts/` (derivados do manifest `scripts/encoding-surface.mjs
  --print-always-dirs`, single source of truth). A prova exercita o fixed dir
  `.zscripts/` — os scripts operacionais do workspace-agent, que têm banners
  CJK **legítimos** (valid UTF-8) e ficam FORA do ASCII proof por design — mas
  a corrupção (byte 0x97) é inválida e DEVE falhar.
- **Injeção**: byte `0x97` (em-dash Windows-1252) anexado a `.zscripts/build.sh`
  (backup em `/tmp` antes; md5 do original `020c91b48659ec19832ebf9b46195285`).
- **Comando**: `bash scripts/check-utf8.sh --ci src/`
- **Observado** (local, 2026-08):

```
WARNING:  .zscripts\build.sh (byte 0x97 -- Windows-1252 em dash)
Warnings: 1 file(s) with byte 0x97
         - .zscripts\build.sh
check-utf8: FAILED -- invalid UTF-8 or .sh ASCII violation
```

  → **exit 1 com o caminho exato do arquivo** (`.zscripts\build.sh`).
- **Reversão**: `cp` do backup de volta; md5 **byte-identical** ao original
  (`020c91b48659ec19832ebf9b46195285`); `git diff --stat .zscripts/` vazio;
  re-run → `check-utf8: done (all clean)`, exit 0.
- **Gap protegido**: corrupção UTF-8 num `.zscripts/*.sh` não pode entrar de
  mansinho — o fixed dir é ALWAYS-scanned (não overridable por arg posicional)
  e o gate falha com o path exato, mesmo que o arquivo carregue CJK legítimo.

## 7. Prova 6 — SPREAD CONTRACT live (5º dir no TARGET_DIRS real, local)

- **Gate**: o guard vitest (`scripts/__tests__/fragile-range-guard.test.ts`) —
  o repo-wide/BASELINE scan e o REAL-REPO CONTRACT `--dir ...TARGET_DIRS` —
  mais a **golden-copy divergence guard** (`golden-copy-utils.test.ts`, que
  pina as declarações `TARGET_DIRS`/`TARGET_EXTS` vivas contra
  `fixtures/fragile-range-scope.txt`). A classe protegida: a derivação
  SPREAD (`...TARGET_DIRS`) que o teste de contrato real e o `--dir` do
  `verify-encoding.sh` (via `--print-target-dirs`) usam — uma árvore nova
  adicionada ao `TARGET_DIRS` deve ser coberta automaticamente, nunca
  escapar por uma segunda lista hardcoded.
- **Injeção** (local, 2026-08-09): (a) `"workers"` adicionado ao
  `TARGET_DIRS` real em `scripts/fragile-range-patterns.mjs` (backup do
  original em `/tmp`; md5 `cb22a420d37a5c8d5a50f3297147e4c6`); (b)
  `workers/dirty.ts` criado com `const re = /[^ -~]/` (o 5º dir agora
  escaneado carrega um range space-tilde genuíno — sole-failure-source).
- **Comando**:

```bash
node scripts/fragile-range-patterns.mjs --print-target-dirs   # agora: e2e src mini-services .zscripts workers
node scripts/fragile-range-patterns.mjs --ci --dir e2e src mini-services .zscripts workers; echo CLI_EXIT=$?
NO_COLOR=1 npx vitest run scripts/__tests__/fragile-range-guard.test.ts --config vitest.config.unit.ts
NO_COLOR=1 npx vitest run scripts/__tests__/golden-copy-utils.test.ts --config vitest.config.unit.ts
```

- **Observado** (local, 2026-08-09):

```
CLI: fragile-range: 1 fragile character-class range(s) in LIVE code:
  workers/dirty.ts :: space-tilde character range :: "[^ -~]"
CLI_EXIT=1
```

  Guard suite: **7 falhas** (39 passed) — exatamente os testes
  REAL-SURFACE que a injeção deve quebrar: `repo-wide` (offender
  `workers/dirty.ts :: space-tilde character range`), `BASELINE`
  (`expected [ Array(1) ] to deeply equal []`), `REAL-REPO CONTRACT`
  (o `--dir ...TARGET_DIRS` spread agora varre `workers/` e o verdict deixa
  de ser clean), `SPREAD CONTRACT` (o fixture sintético agora TRIPA com o
  módulo real carregando 5 dirs — a própria prova do crescimento, invertida),
  os dois `REVERSE MUTATION` (o patch de módulo detecta a declaração
  alterada — `could not locate the TARGET_DIRS/TARGET_EXTS declarations`)
  e `TARGET_DIRS covers e2e specs...` (o pin absoluto `toEqual([...4 dirs])`
  quebra). Golden-copy divergence guard: **falhou** com `Error: REVERSE
  MUTATION: could not locate the TARGET_DIRS/TARGET_EXTS declarations in
  fragile-range-patterns.mjs (structural shape changed)` — o golden copy
  pina as declarações vivas e a edição as moveu.
- **Reversão**: `cp` do backup de volta; md5 **byte-identical**
  (`cb22a420d37a5c8d5a50f3297147e4c6`); `rm -rf workers`;
  `--print-target-dirs` de volta a `e2e src mini-services .zscripts`;
  re-run → guard 46/46 + golden 12/12 (58/58) + gate real
  `verify-encoding.sh --ci src/` exit 0 (`fragile-range: clean (112 gate
  files + 476 target files)`); `git status` limpo.
- **Prova 6 no CI real** — run
  [31331423557](https://github.com/severinno/severinno/actions/runs/31331423557)
  (`ci-proof/spread-live`): branch scratch a partir do HEAD limpo (6cbf584)
  com `"workers"` adicionado ao `TARGET_DIRS` real + `workers/dirty.ts` com
  `const re = /[^ -~]/` (commit `2a133be`), `workflow_dispatch` do
  `pr-check.yml`. **Observado** (log do job `utf8-check / UTF-8 Check`, 2026-08-09 19:21Z):

```
fragile-range: 1 fragile character-class range(s) in LIVE code:
  dirty.ts :: space-tilde character range :: "[^ -~]"
##[error]Process completed with exit code 1.
```

  O path `dirty.ts` é relativo ao dir alvo (a `scanDirectory` reporta por
  dir, igual ao teste SPREAD CONTRACT pina) — o arquivo é `workers/dirty.ts`,
  o 5º dir que a derivação `--print-target-dirs` passou a incluir. O job
  `Fragile Range Guard` (vitest do guard) também falhou, como a prova local
  previu (repo-wide/BASELINE/REAL-REPO CONTRACT/SPREAD CONTRACT/REVERSE
  MUTATION/TARGET_DIRS covers + golden-copy divergence). **Reversão**: branch
  remoto deletado (`git push origin --delete` com `--no-verify` — o pre-push
  local rodaria o mesmo gate provado contra o sentinel e bloquearia o push),
  worktree +
  branch local removidos; `TARGET_DIRS` do worktree principal verificado sem
  `workers` e `git status` intacto.
- **Gap protegido**: a derivação SPREAD não é só um detalhe de teste — o
  crescimento de `TARGET_DIRS` (5ª árvore) quebra o guard **no CI real**
  (job utf8-check, a camada 3 do verify-encoding.sh) com o offender
  apontado no log, além das 7 falhas do guard vitest + golden-copy
  divergence (declaração divergente apontada com diff) — forçando a decisão
  explícita de incluir a árvore (e registrá-la no snapshot). Um futuro 5º
  dir não pode escapar silenciosamente nem do gate nem do CI.

## 8. Observação transversal — o mascaramento que motivou o reorder do check job

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

## 9. Como adicionar uma nova prova

1. Criar branch scratch `ci-proof/<nome>` a partir do HEAD, aplicar a injeção
   (byte, padrão, import) num arquivo de gate.
2. Disparar o workflow relevante via `workflow_dispatch` (há `workflow_dispatch`
   no `pr-check.yml`; branch `main` não existe no remoto, então PR real não
   dispara `pull_request: branches: [main]`).
3. Capturar o log do step que falhou (citar as linhas exatas aqui).
4. Reverter a injeção, deletar o branch scratch e o branch remoto, confirmar
   `git status` limpo no worktree principal.
5. Registrar na tabela da seção 1 com o run number.

## 10. Referências

- Investigação da falha contínua do `security-headers`: `docs/security-headers-gate-2026-08.md`
  (DNS aponta para WordPress na Hostinger, não para o VPS — não é regressão do app).
- Gates de encoding: `scripts/verify-encoding.sh`, `scripts/scan-non-ascii.mjs`,
  `scripts/fragile-range-patterns.mjs`, `scripts/verify-ascii-proof.sh`.
- Guard de bundle: `scripts/check-js-budget.mjs` + `docs/bundle-report.md`.
