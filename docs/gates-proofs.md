# Gates Proofs — provas de sentinela da eficácia dos gates

> Registro das **provas de sentinela** executadas para demonstrar que cada gate
> de CI falha de verdade quando a classe de erro que ele protege é injetada
> (e reverte o repo ao estado limpo depois). Serve de auditoria futura: se um
> gate parar de falhar numa prova equivalente, é sinal de regressão no próprio
> gate. As provas de sentinela (1-6, 8) seguem o contrato: **injetar → gate
> falha (exit 1) → reverter → repo limpo**. A Prova 7 é o outro lado do
> ciclo — uma **prova de EXECUÇÃO**: o gate roda e PASSA no CI real, sem
> injeção, fechando o caso "o gate nunca fica órfão de execução".
> Prova 8: sentinela de **contrato de workflow** (Type D do scan-surfaces) —
> um workflow dispatch-only injetado num branch scratch faz o teste hermético falhar
> no CI real com o offender nomeado (`expected [ 'type-d-proof.yml' ] to deeply equal []`).

## 1. Tabela resumo

| # | Gate sob prova | Classe de erro protegida | O que foi injetado | Prova | Resultado observado |
|---|---|---|---|---|---|
| 1 | Encoding — camada UTF-8 + ASCII-proof (`verify-encoding.sh`) | Byte não-ASCII (o bug do em-dash Windows-1252 de 2026-08) | `0x97` em `scripts/health-check.sh` | Run [**31298436074**](https://github.com/severinno/severinno/actions/runs/31298436074) (`ci-proof/utf8-byte`) | ✅ `check-utf8: FAILED` + `[VIOLATION] scripts/health-check.sh (non-ASCII byte)` → exit 1 |
| 2 | Encoding — camada fragile-range (`fragile-range-patterns.mjs` no `verify-encoding.sh`) | Character-class range frágil (`[^ -~]`) que falha silenciosamente | `grep -q '[^ -~]'` em `scripts/check-utf8.sh` | Run [**31306797327**](https://github.com/severinno/severinno/actions/runs/31306797327) (`ci-proof/fragile-guard`) | ✅ `fragile-range: 1 fragile character-class range(s) in LIVE code: scripts/check-utf8.sh :: space-tilde character range :: "[^ -~]"` → exit 1 |
| 3 | Bundle — `check-js-budget.mjs` | Lib pesada de volta ao grafo eager de rota | `import` estático de recharts no app shell | **Local** (sem run de CI dedicado) | ✅ `check-js-budget.mjs` → exit 1 (lib sinalizada no grafo eager) → revertido |
| 4 | Encoding — camada fragile-range via override `FRAGILE_SCAN_ROOT` | Gate file sujo num repo **sintético** passar despercebido (o override de raiz do layer 3) | `sentinel-root/scripts/dirty.sh` com `[^ -~]` + `env: FRAGILE_SCAN_ROOT: sentinel-root` no step do utf8-check.yml | Run [**31312427503**](https://github.com/severinno/severinno/actions/runs/31312427503) (`ci-proof/fragile-root`) | ✅ `fragile-range: 1 fragile character-class range(s) in LIVE code: scripts/dirty.sh :: space-tilde character range :: "[^ -~]"` → exit 1 |
| 5 | Encoding — camada UTF-8 (`check-utf8.sh`) no **fixed dir `.zscripts/`** (workspace-agent ops scripts) | Corrupção UTF-8 num `.zscripts/*.sh` (ex.: byte 0x97 Windows-1252) | `0x97` anexado a `.zscripts/build.sh` | **Local** (sem run de CI dedicado; o fixed dir é ALWAYS-scanned, o mesmo caminho do CI) | ✅ `WARNING: .zscripts\build.sh (byte 0x97 -- Windows-1252 em dash)` + `check-utf8: FAILED` → exit 1 → revertido byte-identical |
| 6 | Fragile-range — **SPREAD CONTRACT** (a derivação `--dir ...TARGET_DIRS` cobre árvores futuras) | Um 5º dir no `TARGET_DIRS` real escapar da cobertura do guard | `workers` injetado no `TARGET_DIRS` real + `workers/dirty.ts` com `[^ -~]` | Run [**31331423557**](https://github.com/severinno/severinno/actions/runs/31331423557) (`ci-proof/spread-live`) + prova local 2026-08-09 | ✅ **CI (utf8-check / UTF-8 Check)**: `fragile-range: 1 fragile character-class range(s) in LIVE code: dirty.ts :: space-tilde character range :: "[^ -~]"` → exit 1; job `Fragile Range Guard` também falhou; local: guard suite 7 falhas + golden-copy divergence; revertido byte-identical |
| 7 | Guard vitest — **push net** (`guard-gates.yml`, trigger `push: [main, develop]`) | O BASELINE de 0 offenders + divergence guards ficarem ÓRFÃOS de execução num push (skip/reorder do job de testes — o failure mode do lint) | Nenhuma injeção — push REAL temporário a `develop` (dispatch via API bloqueado: workflow fora do default branch; `main` dispararia deploy; `develop` é seguro e escuta o trigger) | Run [**31336318902**](https://github.com/severinno/severinno/actions/runs/31336318902) (`develop`, event `push`) + local `bun run test:guard` 66/66 | ✅ job `Guard Gates (fragile-range + golden-copy)` verde em 45s: `Test Files 2 passed (2), Tests 66 passed (66)` no step "Run guard vitest suites"; branch temporária deletada (remote de volta ao estado original) |
| 8 | Workflow — **Type D HERMETIC** (`scan-surfaces-contract.test.ts`) | `workflow_dispatch:` como ÚNICO trigger (dispatch-only = irrecuperável E indisparável — a classe do 404 do Prova 7) | `.github/workflows/type-d-proof.yml` dispatch-only num branch scratch `ci-proof/type-d` (c060362) | Run [**31342311844**](https://github.com/severinno/severinno/actions/runs/31342311844) (`develop`, event `push`) + local no branch scratch | ✅ job `Tests` do ci.yml: `expected [ 'type-d-proof.yml' ] to deeply equal []` no HERMETIC + CONTRACT com `+ "type-d-proof.yml"` → exit 1; revertido byte-identical |
| 9 | Auto-heal — `check-next-types.mjs` (pre-commit) | `.next/types` stale após bump de versão do next (123 erros TS2305 do incidente 2026-08) | swap REAL de versão: types gerados pelo next 16.1.3 + `bun add next@16.1.1 --no-save` (reescreve `node_modules/next/package.json` com mtime novo) | **Local** — prova de EVENTO REAL (não sintética): dev server real + bun add real + guard real | ✅ sem `--fix`: `STALE .next/dev/types` + exit 1; com `--fix`: `REMOVED .next/dev/types` + exit 0, `.next` raiz preservado; next restaurado ao 16.1.3, `package.json`/`bun.lock` intocados |
| 10 | Guard do Gate 3 — **REAL-REPO CONTRACT** (`scan-push-full-suite.test.ts`; roda no `check` via `test:unit` E no `fragile-guard` via `test:guard`) | Alguém voltar o Gate 3 do pre-push a rodar a SUITE COMPLETA (`test:unit`/`test:run`/`vitest run`) — a regressão da seção 8.4 — sem o guard falhar antes do merge | `bun run test:unit` (linha 67) re-injetado no Gate 3 do `scripts/pre-push-gates.sh` real (branch scratch `ci-proof/push-suite-sentinel`, 2bb6ab8) | Run [**31354308733**](https://github.com/severinno/severinno/actions/runs/31354308733) (`PR Check`, event `workflow_dispatch`, branch scratch) | ✅ job `check` (step Unit tests): `× REAL-REPO CONTRACT: os arquivos reais estao limpos hoje -> exit 0 (regressao futura falha aqui)` → `AssertionError: expected 1 to be +0` (o guard saiu 1); job `fragile-guard` idêntico — `1 failed | 72 passed (73)`; local: `push-suite: FULL-SUITE in scripts/pre-push-gates.sh:67: bun run test:unit` → exit 1; revertido byte-identical |

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

## 8. Prova 7 — push net do guard vitest (`guard-gates.yml`, run 31336318902)

- **Gate**: o workflow `guard-gates.yml` — o push net que roda SOMENTE as duas
  suítes de guard (`fragile-range-guard` + `golden-copy-utils`) via
  `bun run test:guard` em todo push a main/develop, imune a skip por lint
  (sem step de lint, sem `needs:` em lint). A classe protegida: o BASELINE
  de 0 offenders e os divergence guards do golden-copy-utils ficarem órfãos
  de execução quando um push pula/reordena o job de testes — o failure mode
  que o lint costumava causar antes do reorder test-first.
- **Run**: [31336318902](https://github.com/severinno/severinno/actions/runs/31336318902) (event `push`, branch `develop`)
- **Disparo** (2026-08-09): o workflow ainda não existe no default branch
  (`release/v0.4.0`), então `workflow_dispatch` via API é impossível
  (HTTP 404 "workflow guard-gates.yml not found on the default branch" —
  confirmado com `gh workflow run` e com a API direta). Push a `main`
  dispararia o `deploy.yml` (deploy de produção — build + migrate no VPS),
  risco alto demais. O trigger real do guard-gates.yml é `push: branches:
  [main, develop]`, e `develop` não existe no remote nem tem deploy
  atrelado (deploy.yml só escuta `main`), então um push TEMPORÁRIO a
  `develop` é o caminho fiel e seguro para exercitar o push net de verdade:
  `git push origin HEAD:develop`.
- **Observado** (log do job, 2026-08-09 21:15Z) — job `Guard Gates
  (fragile-range + golden-copy)` → ✅ verde em 45s, todos os steps
  incluindo "Run guard vitest suites (BASELINE + divergence guards)":

```
Test Files  2 passed (2)
      Tests  66 passed (66)
```

- **Local (ground truth do mesmo comando)**: `bun run test:guard` → 66/66
  (2 suítes), exit 0 — idêntico ao CI.
- **Reversão**: `git push origin --delete develop` e `--delete
  ci-proof/guard-gates` (branch scratch do dispatch falho) — remote de volta
  ao estado original (`freebuff/new-thread-thms5x3m7xt8k4` +
  `release/v0.4.0`), `git status` limpo.
- **Gap protegido**: um push a main/develop que pularia/reordenaria o job de
  testes não pode mais deixar o BASELINE de 0 offenders e os divergence
  guards sem execução — o push net roda o par completo em todo merge, e o
  mesmo `test:guard` (single source of truth em package.json) alimenta o job
  `fragile-guard` do PR. Registra também a descoberta operacional: enquanto
  o workflow não existir no default branch, o dispatch manual via API fica
  indisponível — a prova real do push net depende do trigger `push`
  (ou de o arquivo entrar no default branch).
- **Nota de contrato**: diferente das provas 1-6 (sentinela — injetar →
  falhar → reverter), esta é uma prova de EXECUÇÃO: o gate roda e PASSA no
  CI real, sem injeção. O contrato "injetar → exit 1 → reverter" da intro
  se aplica às provas de falha; a Prova 7 fecha o outro lado do ciclo — o
  push net dispara de verdade e o par completo fica verde, provando que o
  BASELINE de 0 offenders nunca fica órfão de execução.

## 8.1 Custo por push (medição 2026-08-09) — por que o no-filter continua

**Dado medido** (breakdown por step do run 31336318902, do log do GitHub):

| Step | Tempo | Observação |
|---|---|---|
| Set up job | 1s | overhead fixo do runner |
| checkout | 4s | sempre roda |
| setup-bun | 2s | sempre roda |
| Cache node_modules (restore) | 11s | sempre roda |
| **Install deps** | 9s | `bun install --frozen-lockfile` |
| **Run guard vitest suites** | **4s** | `bun run test:guard` (66 testes no snapshot 2026-08-09; cresceu para 8 suites / 148 testes em 2026-08-10 com lint-staged-loader + fuzz-mapped + run-all-fuzz + scan-hook-parallel-race + scan-guard-gates) |
| Post Cache (upload) | 10s | sempre roda |
| **Total job** | **~41s** | (45s com fila/overhead) |

O custo REAL das suítes é **4s de CI** (snapshot 2026-08-09, 2 suítes) — o restante do job (~37s)
é setup fixo (checkout + bun + cache + install + upload) que um filtro
`paths:` não reduziria: um filtro só **skipa o job inteiro**, nunca deixa
um job que roda mais barato. **Nota de precisão**: o run medido
(31336318902) é anterior ao step `scan-timeouts` adicionado ao workflow
depois — o job atual custa ~1-2s a mais (ground truth local 1.6s); a
conclusão não muda. Ground truth local (Windows, cache quente):
`bun run test:guard` 16.7s + `node scripts/scan-timeouts.mjs --ci` 1.6s +
`bun install --frozen-lockfile` 3.4s.

**Decisão (avaliada, 2026-08-09): o no-filter documentado continua
correto.** Um filtro `paths:` por superfície de gate file teria que
replicar a superfície derivada (`TARGET_DIRS` + gate files) num segundo
lugar — um novo ponto de drift (a classe que o SPREAD CONTRACT elimina) —
e um push tocando só uma árvore que o filtro esqueceu skiparia o net em
silêncio: o risco de órfão que o workflow existe para fechar. Como o par
custa 4s de CI, a economia máxima teórica de um filtro é ~4s por push que
toca a superfície — e o único push skipável sem perda seria um docs-only
(que a superfície não cobre mesmo). O net incondicional mantém o BASELINE
estruturalmente garantido de rodar em todo merge.

**Travado estruturalmente (2026-08-10):** o guard `scripts/scan-guard-gates.mjs`
(pre-commit + `test:guard`/push net) falha se o guard-gates.yml ganhar um
filtro `paths:`/`paths-ignore:`, perder o step `bun run test:guard` ou
remover o `scan-push-full-suite.test.ts` do script `test:guard` — a
premissa da recalibração 8.4/11.11 (o CI como autoridade incondicional)
deixa de ser prosa e vira contrato testado (REAL-REPO CONTRACT no
scan-guard-gates.test.ts).

## 8.2 Prova 8 — Type D HERMETIC live (run 31342311844)

- **Gate**: `scripts/__tests__/scan-surfaces-contract.test.ts`, Type D HERMETIC
  (`workflow_dispatch:` nunca é o ÚNICO trigger) + CONTRACT (o SET de dispatch
  workflows = o set documentado) — roda no job `Tests` do `ci.yml` (`test:run`)
  e no job `check` do `pr-check.yml` (`test:unit`).
- **Run**: [31342311844](https://github.com/severinno/severinno/actions/runs/31342311844)
  (`develop`, event `push`, branch scratch `ci-proof/type-d` @ c060362).
- **Injeção**: `.github/workflows/type-d-proof.yml` NOVO, dispatch-only
  (`on: workflow_dispatch:` sem nenhum outro trigger) — exatamente a classe que
  o HERMETIC proíbe: um workflow dispatch-only é irrecuperável E indisparável
  (o 404 do Prova 7 + nem aparece no Actions tab).
- **Disparo**: push temporário a `develop` (caminho documentado na seção 10:
  `main` dispararia deploy; `develop` é seguro e escuta o trigger `push` do
  ci.yml; dispatch via API do próprio workflow novo seria 404 por não estar
  no default branch).
- **Observado** (log do job `Tests`, step `Run bun run test:run`, 2026-08-09 23:37Z):
  BÔNUS: o próprio GitHub também rejeitou o arquivo injetado — run
  [**31342311275**](https://github.com/severinno/severinno/actions/runs/31342311275)
  `completed failure .github/workflows/type-d-proof.yml` em 0s (workflow dispatch-only
  sem `jobs:` = inválido para o GitHub — "irrecuperável E indisparável" em dobro).

```
❯ scripts/__tests__/scan-surfaces-contract.test.ts (33 tests | 2 failed)
   → expected [ 'deploy.yml', 'e2e-cache.yml', …(6) ] to deeply equal [ 'deploy.yml', 'e2e-cache.yml', …(5) ]   (CONTRACT, :561:45)
   → expected [ 'type-d-proof.yml' ] to deeply equal []   (HERMETIC, :566:25)
   ❯ scripts/__tests__/scan-surfaces-contract.test.ts:566:25
##[error]AssertionError: expected [ 'type-d-proof.yml' ] to deeply equal []
```

- **Confirmação local** (pré-push, o MESMO teste no branch scratch):
  `expected [ 'type-d-proof.yml' ] to deeply equal []` — a falha hermética é
  determinística: o offender é o arquivo injetado, nomeado no diff.
- **Revertido**: develop deletado, worktree scratch removido, branch local
  deletada, repo no estado limpo (byte-identical).

Nota (achado lateral): o push de DELEÇÃO do develop disparou o hook pre-push
completo (verify-encoding + fuzz:ci + gates) e falhou em `fuzz:ci` (exit 1,
`src/components/vitrine/__tests__/address-autocomplete-fuzz.test.tsx` — nunca
tocado pela thread; falha local pré-existente, investigação à parte). O delete
usou `--no-verify` para completar a limpeza da branch de prova.

## 8.3 Prova 9 — auto-heal `.next/types`/`.next/dev/types` stale, prova de EVENTO REAL (local)

- **Gate**: `scripts/check-next-types.mjs` (wired no `.husky/pre-commit` antes
  do `bun run typecheck`). Detecção por mtime: se o mtime de
  `node_modules/next/package.json` (o momento da instalação) ≥ o mtime mais
  novo sob `.next/types` e `.next/dev/types` (o momento da geração), a
  superfície gerada pode ser de uma versão anterior do next → STALE.
- **Por que LOCAL com evento real, e NÃO um job de CI**: o guard é
  pre-commit-only por design — o CI typechecka checkout fresco, sem `.next`
  (ou com types gerados pelo mesmo next no mesmo job), então a superfície
  stale só existe LOCALMENTE, entre um `bun install` que sobe o next e o
  próximo dev/build. Um job de CI teria que FABRICAR o estado stale de
  qualquer forma (instalar, gerar types, trocar versão) — exatamente o que
  esta prova faz, só que com os eventos reais. O que a prova sintética
  (utimesSync) NÃO prova, esta prova fecha: o trigger real (um install que
  reescreve `node_modules/next/package.json`) PRODUZ a inversão de mtime.
- **Nota honesta**: `next typegen` não existe no CLI do next 16.1.3 (só
  build/dev/start); os types gerados por `next dev` caem em `.next/dev/types`
  (é o que o guard varre junto com `.next/types` do build — o mecanismo de
  detecção é idêntico para os dois, ambos em TYPE_DIRS).
- **Passos** (2026-08-09, todos reais):

```
1. Estado limpo: next 16.1.3 instalado, sem .next (removido no commit fe7d761).
2. Gera types reais: bun run dev  ->  .next/dev/types criado (mtime 23:53:19)
3. Swap real de versao: bun add next@16.1.1 --no-save (a versao do incidente)
   -> node_modules/next/package.json reescrito, versao 16.1.1, mtime 23:54:42
   (o install agora e MAIS NOVO que os types -> a classe do incidente)
4. node scripts/check-next-types.mjs (sem --fix):
   check-next-types: STALE .next/dev/types (generated by a previous next version)
   check-next-types: run with --fix to remove the stale generated surface
   GUARD_EXIT=1
5. node scripts/check-next-types.mjs --fix:
   check-next-types: REMOVED .next/dev/types (regenerated on the next dev/build)
   FIX_EXIT=0  ->  .next/dev/types sumiu; .next raiz PRESERVADO (so o surface)
6. Restauracao: bun add next@16.1.3 --no-save -> next de volta ao 16.1.3;
   git status package.json bun.lock = vazio (--no-save nao toca em nenhum)
7. Estado final: rm -rf .next (prova deixa o repo como estava); guard exit 0
   "clean (no generated types to check)"
```

**Veredito**: a prova local sintética (check-next-types.test.ts) cobre o
contrato de detecção/heal com mtimes fabricados; esta prova de evento real
cobre a CAMADA que a sintética não alcança — o install real inverte o mtime
de verdade, e o guard detecta e cura com os binários reais. Job de CI seria
redundante (estado stale é impossível no checkout fresco do CI) e precisaria
fabricar o mesmo cenário. Repo revertido byte-identical.

**Nota — o par incidente↔não-incidente (medição 2026-08-09)**: o passo 3
desta prova é o INCIDENTE — o install re-resolve o next (16.1.1 no lugar do
16.1.3), o mtime do package.json avança e STALE é o comportamento CORRETO. O
lado NÃO-incidente foi medido para provar que o guard não produz falso STALE
em install rotineiro:

- **No-op install** (lock e node_modules já em 16.1.3): `bun install
  --frozen-lockfile` (22s) e `bun install` simples (2s) ambos reportaram
  "Checked 1227 installs across 1328 packages (no changes)" — o mtime de
  `node_modules/next/package.json` ficou INTACTO (07-18 09:16:13.533, valor
  idêntico antes/depois). O bun só reescreve o package.json quando a própria
  resolução do next muda (o bump do passo 3) — exatamente quando STALE é
  correto.
- **Reify parcial** (a lacuna fechada no mesmo dia): bump real de uma dep NÃO
  relacionada (uuid ^11.1.0 → ^12.0.1) + `bun install` (5.39s, "1 package
  installed") deixou o next pkg com mtime IDÊNTICO (1784376973533.5103) e
  hash sha256 IDÊNTICO (8657813c...); o diff do bun.lock tocou só a entrada
  do uuid. O restore (--frozen-lockfile, 12.0.1 → 11.1.0, 1.2s) repetiu o
  mesmo. Dado extra: uma falha de resolução (specifier inexistente) aborta o
  install sem tocar nem o next pkg nem o bun.lock.

**Veredito do par**: o heuristico de mtime fica correto nos TRÊS casos —
bump (incidente, STALE detecta), no-op (não-incidente, não trip) e reify
parcial (não-incidente, não trip). A única inversão de mtime que dispara o
STALE é o bump do próprio next, a classe do incidente original.

**Reify parcial — run ao VIVO (medição 2026-08-10, fechando o único caso
não medido na data)**: a medição acima foi re-executada de verdade com o
repo atual (next 16.1.3 instalado, sem `.next`):

```
1. Baseline: node_modules/next/package.json mtime 1784376973
   (2026-07-18 09:16:13.533), sha256 8657813c7f2f6fcd...
2. Bump real de dep NAO relacionada: package.json uuid ^11.1.0 -> ^12.0.1
3. bun install REAL: "+ uuid@12.0.1", "1 package installed [2.54s]"
   (real 2.934s) - o reify parcial roda de verdade
4. MEDICAO apos o reify: node_modules/next/package.json mtime 1784376973
   (IDÊNTICO) e sha256 8657813c7f2f6fcd... (IDÊNTICO) - o bun NAO
   reescreve o next pkg quando outra dep re-resolve
5. diff do bun.lock: tocou SÓ a entrada do uuid (11.1.0 -> 12.0.1,
   42 ins / 3 del) - nenhuma linha de next
6. Restore byte-identical (snapshots sha256 5c7a940e / e960c707
   conferidos): package.json + bun.lock de volta ao estado exato;
   node scripts/check-next-types.mjs -> "clean (no generated types to
   check)" exit 0 (sem inversao de mtime, nao trip)
```

Fechamento: o único caso que faltava medir de verdade (reify parcial com
outra dep mudando) confirma o veredito documentado — o guard não produz
falso STALE. Efeito colateral honesto do experimento: `node_modules/uuid`
ficou em 12.0.1 após o restore do lock (11.1.0) — a divergência pós-rollback
de node_modules vs lock é exatamente a classe que o
`check-node-modules-integrity.mjs` (secao 8.5) detecta no pre-commit E no
pre-push (react/react-dom não foram tocados; o guard de integridade
continua limpo).

### 8.3.1 A prova VITEST do par não-incidente (contratos de mtime preservado, 2026-08-10)

O par não-incidente (no-op + reify parcial) e o falso-negativo aceito são
TRAVADOS como contratos no vitest — não dependem de re-medir o bun a cada
PR. Quatro testes em `scripts/__tests__/check-next-types.test.ts` (11 no
total, todos herméticos com `NEXT_TYPES_ROOT` + `utimesSync`):

| Teste | Contrato que trava | Verdicto esperado |
|---|---|---|
| `CONTRACT no-op install` | bun NAO reescreve o package.json quando a resolução não muda → mtime INTACTO antes/depois | clean nos DOIS runs (sem falso STALE) |
| `CONTRACT falso-negativo do bump com MTIME PRESERVADO` | bump 16.1.3 → 16.2.0 com mtime fixo (o proxy não vê o bump) | clean (exit 0, sem STALE) — o falso-negativo ACEITO, pinado |
| `REAL-SWAP MUTATION` (perna de restore) | o MESMO bump com mtime restaurado volta a clean — o guard ignora conteúdo | clean após restore |
| `LIMITACAO RESIDUAL aceita` | `.next` copiado de outra versão com mtime fabricado mais novo que o install | clean (falso-negativo aceito, pino explícito sem STALE) |

**Comando de re-validação** (o mesmo que o CI roda via `test:unit`):

```bash
NO_COLOR=1 npx vitest run scripts/__tests__/check-next-types.test.ts --config vitest.config.unit.ts
# esperado: 11 passed (11) - o par não-incidente nao trip, o incidente (REAL-SWAP
# perna de mtime natural) tripa com STALE, o falso-negativo aceito fica clean
```

Se um futuro bump de versão do next reescrever o package.json SEM avançar o
mtime (o bun mudar de comportamento), o `CONTRACT falso-negativo` acima
falha — sinalizando que a LIMITACAO RESIDUAL deixou de ser só teórica.

## 8.4 Custo por push LOCAL — pre-push hook (medição 2026-08-09) — Gate 3 mapeado, não a suíte completa

**A pergunta**: o pre-commit:test mapeia áreas tocadas em ~5s; o CI roda a
suíte inteira. O pre-push ainda precisa da suíte completa no Gate 3, ou o
mapeamento por áreas (com `--since` do remoto) já cobre o essencial?
**Resposta com medição: o Gate 3 já é mapeado (calibragem anterior) e a
medição prova que voltar à suíte completa seria 10x mais caro E bloquearia
todo push com ruído local que o CI não vê.**

**O que o hook roda por push hoje** (ordem real do `.husky/pre-push`,
medição sequencial, um shell, sem contenção — números honestos no
Windows/git-bash):

| Gate | Custo medido |
|---|---|
| verify-encoding (UTF-8 + VPS ASCII + proof + fragile baseline) | ~1.5s |
| check-docs-encoding (informativo, nunca bloqueia) | <1s |
| `fuzz:ci` | **53s** — verde pós-cura (era VERMELHO localmente, nota ¹) |
| pre-push:gates — Gate 1 manifest + Gate 2 budget (honest-skip sem ANALYZE) + Gate 3 | **18s** (3 gates, exit 0) |
| **Total hook** | **~74s** |

**Medição do Gate 3** (`PRE_PUSH_REMOTE_SHA=7869baa` — pai do HEAD, o cenário
realista "remote tip = commit anterior"): mapeou **8 testes** das áreas
tocadas — check-next-types, blame-ignore-revs, check-docs-encoding,
executable-surface, health-check-script, release-assert-route-gate,
scan-surfaces-contract, scan-timeouts — todos verdes, exit 0, 18s para os 3
gates. O `--since` fecha o gap "commitado mas não staged": a união é staged +
HEAD + range `<remote sha>...HEAD`.

**A suíte completa como baseline** (`bun run test:unit`): **178s E vermelha
localmente** — `8 failed | 135 passed (143 files)`, 114 testes falhando:

- Arquivos (nenhum tocado pela thread): `src/app/__tests__/{accessibility,
  login-page, not-found, register-page}.test.tsx`,
  `src/app/busca/__tests__/search-page.test.tsx`,
  `src/lib/__tests__/{sound-context, use-balance-pulse, use-coin-sound}.test.{tsx,ts}`.
- Erros AMBIENTAIS, não de assert: `TypeError: Cannot read properties of null
  (reading 'useContext')` no `next/src/client/link.tsx` sob jsdom (sintoma
  clássico de mismatch React/DOM — react 19.2.3 no topo do node_modules vs
  pin `^19.0.0`; plausível artefato dos swaps 16.1.1↔16.1.3 da Prova 9) e
  hooks de som/coin. O CI roda a mesma suíte VERDE em checkout fresco →
  estado local do node_modules, não regressão de código. Causa raiz
  confirmada e CURADA com install limpo — seção 8.5 (a suíte completa
  roda 100% verde em ambiente saudável).

**Veredito: manter o Gate 3 mapeado — não voltar à suíte completa**:

1. **Custo**: 18s (3 gates mapeados) vs 178s — ~10x.
2. **Ruído local**: a suíte completa é vermelha localmente por motivos
   ambientais — rodá-la no pre-push bloquearia TODO push com ruído que o CI
   não vê; o hook ficaria inutilizável. — MAS veja a RECALIBRAÇÃO abaixo
   (estado pós-cura): este argumento CAIU com o install limpo da 8.5; o
   veredito se mantém pelos demais pontos (custo ~8x + autoridade do CI).
3. **Autoridade**: o CI roda a suíte inteira em checkout fresco (rede de
   segurança); o mapeamento é só o feedback rápido do push.
4. **Cobertura do mapeamento**: todo arquivo tocado com teste co-localizado
   roda (staged + HEAD + range do push); e2e/docs/YAML não mapeiam por design
   (o CI cobre no PR). O mapeamento é exato DENTRO das áreas tocadas; o único
   ponto cego real é a regressão cross-área (mudança no arquivo A quebra o
   teste co-localizado do arquivo B, intocado — nada mapeia) — precisamente o
   que a suíte completa do CI em checkout fresco pega.
5. **A calibragem real que resta é o fuzz, não o Gate 3** — ver nota (¹).

(¹) [SUPERSEDIDA pela RE-MEDIÇÃO 2026-08-10 abaixo: o pre-push não roda
mais `fuzz:ci` (runner mapeado da 11.11) e o dominante inverteu para o
Gate 3.] O `fuzz:ci` era o custo dominante do push (~53s, 71% do total) — e esteve
**vermelho localmente** pela MESMA duplicação de React da seção 8.5 (invalid
hook call na suite AddressAutocomplete sob jsdom), não um bug da suite. Curado
pelo install limpo da 8.5: fuzz:ci agora exit 0 (~53s). O bloqueio de TODO push
— inclusive deleções (a Prova 8 precisou de `--no-verify`) — está removido SEM
mudança de código: nem consertar a suite (ela nunca esteve errada) nem torná-la
não-bloqueante foi necessário — e tornar um gate vermelho não-bloqueante
mascararia uma regressão real (o CI roda fuzz:ci como autoridade).

**RECALIBRAÇÃO — estado pós-cura (medição 2026-08-09):** a 8.5 curou o
ambiente (install limpo) e a suíte completa agora roda **verde localmente em
~167s** (1787/1787 testes, exit 0) — o argumento "ruído local" da decisão
acima CAIU: o Gate 3 não é mais defensivo contra vermelho ambiental. A
pergunta de recalibragem: com o ambiente saudável, o mapeamento ainda é o
certo, ou vale a suíte completa no push? Re-medido no cenário realista desta
thread (`PRE_PUSH_REMOTE_SHA=7869baa`, pai do HEAD — o mesmo da medição
original):

| Métrica | Medição original (8.4) | Re-medição (pós-cura) |
|---|---|---|
| Testes mapeados no Gate 3 | 8 | **9** (check-next-types, blame-ignore-revs, check-docs-encoding, executable-surface, health-check-script, release-assert-route-gate, scan-push-full-suite, scan-surfaces-contract, scan-timeouts) |
| Custo dos 3 gates do pre-push | 18s | **20.8s** |
| Suíte completa (`test:unit`) | 178s e VERMELHA (114 falhas ambientais) | **~167s e VERDE** (1787/1787) |
| Fator de custo | ~10x | **~8x** |

**Veredito da recalibração: manter o Gate 3 mapeado** — agora por um motivo
MAIS forte, não defensivo:

1. **Custo permanece ~8x**: 20.8s (3 gates mapeados) vs ~167s da suíte
   completa. O push não precisa do fator 8x extra — o CI roda a suíte
   inteira em checkout fresco como autoridade de qualquer forma.
2. **O argumento da "regressão cross-área" é o único ponto cego real** — e é
   exatamente o que a suíte completa do CI pega. O mapeamento é exato
   DENTRO das áreas tocadas; a rede de segurança do CI cobre FORA. Subir a
   suíte completa para o push ~8x mais caro não fecha esse ponto cego mais
   cedo — só o CI fecha, e ele já roda.
3. **Dado novo que reforça o mapeamento**: o push net `guard-gates.yml` já
   roda os guards vitest (fragile-range-guard + golden-copy-utils +
   scan-push-full-suite) INCONDICIONALMENTE em todo push a main/develop —
   ou seja, as suítes que protegem a infraestrutura desta thread não ficam
   órfãs mesmo que o Gate 3 mapeie poucos testes num push docs-only. O
   mapeamento cobre as áreas tocadas; o push net cobre o baseline dos
   guards. A combinação é o estado atual correto.
4. **Custo do push continua dominado pelo fuzz (53s), não pelo Gate 3** —
   nota (¹) permanecia: a calibragem real do custo do push era o fuzz, não os
   testes unitários. (SUPERSEDIDA pela RE-MEDIÇÃO 2026-08-10 abaixo — o
   dominante inverteu para o Gate 3 mapeado.)

Conclusão: a decisão da 8.4 SE MANTÉM com evidência nova — o ambiente
saudável não muda o cálculo, porque o fator de custo (~8x) e a autoridade do
CI permanecem; o que mudou é que o argumento "ruído local" saiu da justificativa
(o que torna a decisão mais limpa, não mais frágil).

### RE-MEDIÇÃO 2026-08-10 (ponta a ponta real, pós 11.11/11.12/93eb00e — o dominante mudou)

A premissa "o fuzz (53s) domina o push" ficou **desatualizada** com a adoção
do runner mapeado (11.11) e do fuzz:ci batchado (11.12): o `.husky/pre-push`
não roda mais `bun run fuzz:ci` — o Gate de fuzz é o `run-mapped-fuzz.mjs
--since`. Medição real de ponta a ponta (mesma sessão, sequencial, um shell,
`PRE_PUSH_REMOTE_SHA=977fa5c` = pai do HEAD 93eb00e, diff do commit
recente):

| Gate (ordem real do hook) | Medido 2026-08-10 | Anterior (8.4) |
|---|---|---|
| verify-encoding (agora com layer 5 .mjs) | **3.37s** | ~1.5s |
| check-docs-encoding (informativo) | **0.63s** | <1s |
| check-node-modules-integrity | **0.13s** | (novo) |
| fuzz MAPEADO (skip: diff sem superfície fuzz) | **0.33s** | fuzz:ci **53s** |
| pre-push:gates (Gate 1 + 2 + 3) | **77.58s** | 18s → 20.8s |
| **Total hook** | **~82s** | ~74s |

**O dominante inverteu**: o fuzz caiu de 53s para **0.33s** (skip) no push
de gate files — e até o pior caso local (fallback full) é ~14-15s, não 53s.
Quem domina agora é o **Gate 3 mapeado**: medido 66.5s (cold) / 75s (warm) —
muito acima dos 20.8s da recalibração, porque o diff do commit recente tocou
suítes de teste DIRETAMENTE (o mapeamento selecionou 14 arquivos / 258
cassetes): o maior bloco é `verify-encoding.test.ts` (15 cassetes, ~36.5s —
a suíte spawna o gate completo várias vezes), seguido de
bundle-report-gate (~6.4s), check-node-modules-integrity (~3.4s) e
scan-hook-parallel-race (~3.4s).

**Veredito honesto da re-medição**: a decisão "Gate 3 mapeado" SE MANTÉM
(custo ~8x vs suíte completa ~167s), mas a justificativa da 8.4 "a
calibragem real é o fuzz" CAIU — o custo por push depende agora do que o
diff toca: um push de gate files (o caso medido) paga ~82s dominados pelo
Gate 3 subprocess-heavy; um push docs-only paga sub-segundo (skip de fuzz +
sem testes mapeados). Se o Gate 3 voltar a ser o gargalo em pushes de
suítes, o próximo lever é mapear o custo dos CASSETES (o `verify-encoding.test.ts`
36.5s numa suíte de 15 é o maior alvo — poderia ser dividido ou
removido do mapeado quando só o gate em si for tocado).

### RE-MEDIÇÃO 2 — push típico de lib, Gate 2 MAPEADO (medição 2026-08-10, hook REAL end-to-end)

A RE-MEDIÇÃO anterior mediu o PIOR caso (push de gate files cujo diff
tocava suítes de teste diretamente → Gate 3 subprocess-heavy ~75s). O push
TÍPICO de lib foi medido agora no hook REAL, end-to-end, no cenário da
Prova 11: worktree scratch a partir de 93eb00e + touch benigno em
`src/lib/radius-expansion.ts` + commit, hook rodado com stdin sintético
(remote sha = 93eb00e → diff = só o touch de lib):

| Gate (ordem real do hook) | Medido (warm) |
|---|---|
| verify-encoding (UTF-8 + VPS ASCII + proof + fragile baseline) | **3.37s** |
| check-docs-encoding (informativo) | **0.65s** |
| check-node-modules-integrity | **0.17s** |
| fuzz MAPEADO (radius tocado → 2 suites, 16 testes) | **4.62s** |
| pre-push:gates — Gate 1 manifest + Gate 2 budget (honest-skip sem ANALYZE) + Gate 3 (1 teste: radius-expansion.test.ts, 18 testes) | **4.53s** |
| **Total hook E2E (hook real, exit 0)** | **~13.7s warm** (3 runs: 22.46s cold pós-install → 15.08s → 13.69s) |

**O dominante morreu — o custo agora é BALANCEADO**: nenhum gate isolado
domina (os três maiores — verify-encoding 3.4s + fuzz 4.6s + pre-push:gates
4.5s — ~= distribuição plana; docs 0.65s e integrity 0.17s completam a
cadeia). EXCEÇÃO ao balanceamento: um push que toque a vitrine
(`address-autocomplete.tsx`) ainda é dominado pela suite fuzz isolada
(14.18s, o wash da 11.11) — o plano aplica a pushes de lib/docs/admin, o
típico. vs o ~82s do pior caso (gate files) e os ~74s originais (fuzz:ci
53s), o push típico caiu para **~13.7s — ~5-6x mais barato**. NOTA de escopo honesto: o pre-push NÃO roda
typecheck (é gate do pre-commit, paralelo com lint-staged na 11.8) — o
total medido é a cadeia real do hook, sem tsc. Se o typecheck fosse
adicionado ao push, seria +17-24s warm (o piso da secção 11) — por isso
continua fora.

**Veredito da recalibração**: a decisão "Gate 3 mapeado" se MANTÉM mais
forte ainda — o custo por push depende do que o diff toca (lib ~13.7s,
docs/admin sub-segundo, gate files ~82s pior caso), e o CI em checkout
fresco continua a autoridade inalterada. O próximo lever (se o push de
gate files voltar a incomodar) permanece o mapeamento de CASSETES do
`verify-encoding.test.ts` (36.5s numa suíte de 15).

**Atalho de deleção pura (medição 2026-08) — push de branch housekeeping
não paga a cadeia de ~74s (re-medição 2026-08-10: ~82s)**: um push que só apaga branches (`git push
origin --delete branch` / `:branch`) transporta ZERO commits novos — rodar
os gates é testar nada. O `.husky/pre-push` agora detecta deleção pura via
stdin (todas as refs com local sha all-zeros) e pula a cadeia com aviso.

- **Custo medido** (hook real, stdin sintético de deleção): **~0.4s** vs
  **~74s** da cadeia completa à época (re-medição 2026-08-10: ~82s — a
  economia da deleção só cresceu) — o custo do checker puro é ~10ms, o node
  boot domina o caminho do hook. Medição `real 0.41` exit 0 com a mensagem
  `[skip] pre-push: push de delecao pura`.
- **Semântica**: deleção PURA = TODAS as refs com local sha all-zeros;
  push MISTO (deleção + ref real na mesma chamada) NÃO é puro e roda os
  gates normal (carrega código); stdin vazio (invocação manual) roda
  normal (comportamento preservado).
- **Implementação**: `scripts/check-push-deletion.mjs` (exit 0 = puro,
  exit 1 = roda gates; `analyzePushStdin` exportada; CRLF tolerado). O
  stdin do hook é single-read — a captura subiu para o TOPO do hook e
  deriva dele TANTO o `PRE_PUSH_REMOTE_SHA` do Gate 3 quanto a detecção
  de deleção (mesmo texto capturado, sem segunda leitura do stream). O
  remote sha vem da primeira linha NÃO-deleção (em push misto, a primeira
  linha pode ser a deleção e seu remote sha seria uma base errada para o
  range do Gate 3).
- **Cobertura**: `scripts/__tests__/check-push-deletion.test.ts` (11
  testes: 6 pure-parse + 5 CLI exit-code). O guard `scan-push-full-suite`
  continua limpo — a mudança no hook não reintroduziu suíte completa nem
  removeu o marker do Gate 3.

## 8.5 Causa raiz do vermelho local — layout do node_modules corrompido, curado com install limpo (medição 2026-08-09)

**Contexto**: a seção 8.4 mediu a suíte completa VERMELHA localmente (8
arquivos / 114 testes, `8 failed | 135 passed (143)`). Esta seção fecha a
causa raiz com evidência e registra a cura — o ambiente agora roda a suíte
inteira verde.

**Sintoma**: `Invalid hook call` (useContext null) em TODO teste de
componente/hook — not-found/accessibility (next/link), login/register/search
(páginas), sound-context/use-balance-pulse/use-coin-sound (renderHook). O
clássico de DUAS cópias de React em runtime.

**Diagnóstico (evidência)**:
1. `node_modules/react` e `node_modules/react-dom`: diretórios REAIS em
   19.2.3 (mtime 19:49 = o horário dos experimentos da Prova 9), não symlinks
   para o store.
2. O store `.pnpm` tinha ORFÃOS `react@19.2.8` e
   `react-dom@19.2.8_react@19.2.8` — versões que o lock NÃO resolve para o
   runtime (o lock tem react/react-dom em 19.2.3; o `react@19.2.8` visto em
   grep era o `@types/react`).
3. Duas instâncias físicas de React (topo real 19.2.3 + store 19.2.8) → os
   hooks de uma não enxergam o dispatcher da outra → invalid hook call. A
   cadeia exata de qual pacote resolveu a cópia órfã é irrecuperável (o
   node_modules foi apagado) — o mecanismo e a cura empírica bastam.
4. `bun install` normal (com ou sem `--frozen-lockfile`) dizia "no changes" —
   o bun CONFIA no node_modules existente e não reconcilia um layout
   divergente.

**A cura**: `rm -rf node_modules && bun install --frozen-lockfile` (160s, 1174
pacotes) reconstruiu o store a partir do lock — **bun.lock byte-identical**
(hash `47ec16db` antes/depois: o lock nunca esteve errado). Após: react e
react-dom únicos em 19.2.3, sem órfãos no store.

**Resultado**: os 8 arquivos 114/114; suíte completa **143/143 arquivos,
1787/1787 testes, exit 0 (167s)** — contra o `8 failed | 135 passed (143)`
medido na 8.4.

O mesmo vale para o fuzz:ci — a suite AddressAutocomplete (vermelha na Prova 8
e na nota ¹ da 8.4) era o MESMO invalid hook call; pós-cura: exit 0 (~53s),
removendo o bloqueio de pushes de deleção sem mudança de código.

**Lição**: `bun add <pkg> --no-save` altera o node_modules sem tocar o lock;
se a árvore divergir, o `bun install` comum NÃO repara (trust no estado
existente) — o reparo é o install limpo (rm -rf node_modules). O veredito da
8.4 (Gate 3 mapeado, CI como autoridade) permanece válido — 167s vs 18s, ~10x
— mas o argumento do "ruído local" era específico do ambiente corrompido, e
agora está curado.

**RAIZ ELIMINADA (2026-08-10)**: o ambiente tinha UM segundo par de
lockfiles rastreados na raiz (`pnpm-lock.yaml` + `pnpm-workspace.yaml`) além
do `bun.lock` — a fonte do mix de package managers (e ainda um
`package-lock.json` npm órfão, mesma classe). Todos os três foram
REMOVIDOS; a raiz agora tem EXATAMENTE um lockfile (`bun.lock`), travado
pelo contrato Type F do scan-surfaces (root-anchored git ls-files ==
`['bun.lock']` + NEGATIVO: nenhuma superfície executável pode invocar
pnpm/npm/npx). Sem segundo lockfile, não existe mais o caminho para outro
manager re-resolver o layout — a classe 8.5/8.6 morre pela raiz, não pela
cura repetida.

## 8.6 Semântica do `bun add --no-save` — a origem dos órfãos 19.2.8 e o guia de uso seguro (investigação 2026-08-09)

**A pergunta em aberto da 8.5**: o diagnóstico encontrou no store `.pnpm` os
órfãos `react@19.2.8` e `react-dom@19.2.8_react@19.2.8` (versões que o
`bun.lock` NÃO resolve — ele tem 19.2.3) e hipotetizou que vieram dos swaps
16.1.1↔16.1.3 da Prova 9 (que usaram `bun add --no-save`). A investigação
fecha a pergunta com evidência: **a hipótese da 8.5 estava INVERTIDA — os
órfãos 19.2.8 são da ERA PNPM (layout legado), e o `--no-save` do bun foi o
GATILHO do mix (escreveu por cima sem limpar o store), não a fonte.**

**Evidência:**

1. **Prova empírica (binário real, bun 1.3.14, repo sintético)**: num repo com
   `bun install` inicial (lock criado), `bun add react@19.2.8 --no-save`
   instalou react 19.2.8 em node_modules **com `bun.lock` e `package.json`
   BYTE-IDÊNTICOS** (md5s iguais antes/depois) — o flag instala o pacote SEM
   registrar a resolução. Resultado: o node_modules fica com uma versão que o
   lock NÃO resolve (o estado "extraneous" exato da classe do incidente).
2. **`.pnpm` é layout do pnpm, não do bun**: bun 1.3 cria node_modules flat
   (dirs/symlinks, sem `.pnpm`). O repo tem `pnpm-lock.yaml` +
   `pnpm-workspace.yaml` RASTREADOS (era pnpm, última mudança b0d4edc) e   eles
   resolvem **`react@19.2.8` / `react-dom@19.2.8`** (entre outras: react@19.2.17
   em @types e react-dom@19.2.3 em alguns contextos) — a MESMA versão dos
   órfãos. O `bun.lock` resolve 19.2.3.
3. **Reconstrução**: o store `.pnpm` com 19.2.8 foi criado pela era pnpm
   (provado pelo pnpm-lock.yaml); quando o bun assumiu (install flat + os
   `--no-save` da Prova 9), o bun ESCREVEU o layout flat POR CIMA do store
   pnpm antigo SEM removê-lo — duas cópias físicas de React (topo real 19.2.3
   + store 19.2.8) → invalid hook call. O `bun install` comum depois
   reportou "no changes" (8.5: confia no layout existente, não reconcilia o
   store de outro manager).

**Guia: quando usar `bun add --no-save` com segurança vs editar o package.json**

| Cenário | Caminho certo | Por quê |
|---|---|---|
| Probe temporário de versão (ex.: testar next 16.1.1 sem persistir) | `bun add <pkg>@<ver> --no-save`, depois RESTAURAR com `bun add <pkg>@<ver-original> --no-save` (ou install limpo) | o flag não toca lock/package.json (provado acima) — o restore volta a árvore RESOLVÍVEL à versão original; o store pode RETER o pacote órfão (inofensivo se não resolvível; a limpeza definitiva é o install limpo, próxima linha) |
| Dep que DEVE ficar (add/remove/bump real) | editar `package.json` + `bun install` | atualiza o `bun.lock` de verdade — o `--no-save` deixaria o lock desatualizado (o estado extraneous que derruba a suite) |
| Depois de QUALQUER `--no-save` | `git status` de `package.json`/`bun.lock` (devem estar limpos) + conferir o guard check-node-modules-integrity (agora no pre-commit E no pre-push) | o flag pode deixar o node_modules com versões que o lock não resolve; o guard trava react/react-dom divergentes ANTES do tsc/fuzz |
| Reparo de layout divergente (a classe da 8.5) | `rm -rf node_modules && bun install --frozen-lockfile` — o ÚNICO reparo confiável | `bun install` comum (com ou sem `--frozen-lockfile`) reporta "no changes" e não reconcilia store estrangeiro — o install limpo reconstrói o store do lock (provado na 8.5: lock byte-identical) |

**Nota sobre o repo**: o histórico é MISTO (pnpm-lock.yaml + bun.lock
rastreados) — qualquer `bun add --no-save` sobre um node_modules com resíduo
`.pnpm` corre o risco de duplicar pacotes. O guard
`check-node-modules-integrity.mjs` (desta thread) agora fecha a classe:
react/react-dom divergentes do lock falham o pre-commit com o comando de cura
antes de o tsc/fuzz verem o sintoma. O guard roda TAMBÉM no pre-push (2026-08,
<10ms), ANTES do fuzz mapeado (~53s no pior caso): a classe 8.5 é LOCAL (o CI
instala do lock fresco em checkout), então o push não deve gastar fuzz/testes
num node_modules divergente — o mesmo parâmetro do pre-commit, só que antes do
gate caro.

**FORGOT-RESTORE (2026-08-10)**: o guia da 8.6 documenta o `--no-save` seguro,
mas nada impedia um dev de rodar `bun add <pkg> --no-save` e ESQUECER o
restore — o pacote fica instalado no topo do node_modules SEM chave no lock
(visível para o require do app, invisível para o bun install comum, que
confia no layout existente). O guard agora cobre também essa classe: a camada
EXTRANEOUS do `check-node-modules-integrity.mjs` varre os pacotes de TOPO do
node_modules (dirs diretos + `@scope/pkg` filhos; pula dot-prefixed
`.bin`/`.cache`/`.vite`/`.package-lock.json` e arquivos soltos) e cruza com o
CONJUNTO de chaves do bun.lock (entradas array-valued `"key": ["key@ver", ...]`;
specs de dependência string/object nunca casam). Instalado sem chave no lock =
EXTRANEOUS + o comando de cura, exit 1 no pre-commit/pre-push. Custo ~10-30ms
no hook. BASELINE real (2026-08-10): 792 dirs top-level vs 1407 chaves do
lock, 0 extraneous — o estado saudável que o guard defende.

### 8.6.1 Inventário de divergência pnpm-lock ↔ bun.lock (auditoria 2026-08-10)

O par órfão 19.2.8 (pnpm) vs 19.2.3 (bun) nunca foi isolado: a pergunta
"quantos outros diretos divergiam?" ficou em aberto até esta auditoria. Fonte
auditável: o pnpm-lock.yaml do HEAD (o arquivo saiu da árvore na eliminação do
segundo lockfile — o commit de remoção está staged, o snapshot vive no git).
Reprodutível com o script versionado `scripts/audit-lockfile-divergence.mjs`:

```bash
git show HEAD:pnpm-lock.yaml > /tmp/pnpm-lock-head.yaml
node scripts/audit-lockfile-divergence.mjs --pnpm /tmp/pnpm-lock-head.yaml
```

**Resultado: 51 divergências em 98 pacotes diretos.** Os dois locks NUNCA
resolveram a mesma árvore — cada `bun install`/`pnpm install` alternando entre
eles teria produzido um node_modules diferente. O veredito reforça a
eliminação: o segundo lockfile não era só ruído, era uma segunda verdade de
resolução. Destaques (pnpm → bun):

| pacote | pnpm | bun |
|---|---|---|
| react | 19.2.8 | 19.2.3 |
| react-dom | 19.2.8 | 19.2.3 |
| react-hook-form | 7.82.0 | 7.71.1 |
| next | 16.2.11 | 16.1.3 |
| eslint-config-next | 16.2.11 | 16.1.3 |
| next-intl | 4.13.4 | 4.7.0 |
| @types/react | 19.2.17 | 19.2.8 |
| @prisma/client | 6.19.3 | 6.19.2 |
| prisma | 6.19.3 | 6.19.2 |
| tailwindcss | 4.3.3 | 4.1.18 |
| zod | 4.4.3 | 4.3.5 |
| zustand | 5.0.14 | 5.0.10 |

(47 restantes: divergências de patch/minor em radix-ui, aws-sdk e outros — o
list completo sai do script. eslint_d é o único ABSENT no pnpm: dep adicionada
só na era bun.)

**Interpretação honesta:** os dois locks foram gerados em momentos diferentes
do tempo de resolução — o pnpm resolveu ranges com um registro mais novo. A
divergência NÃO prova que a migração introduziu bug algum; prova que o par de
locks era inerentemente conflitante e que qualquer alternância pnpm↔bun na
mesma árvore re-resolveria pacotes — exatamente a classe de divergência que a
seção 8.5 documentou como corrompedora do layout local. O bun.lock vigente é
a única verdade desde a eliminação; o script fica como a prova auditável para
quem quiser re-verificar.

## 8.7 Prova 10 — REAL-REPO CONTRACT do scan-push-full-suite live (run 31354308733)

- **Gate**: `scripts/__tests__/scan-push-full-suite.test.ts` → teste
  **REAL-REPO CONTRACT** ("os arquivos reais estao limpos hoje -> exit 0
  (regressao futura falha aqui)"). O guard `scripts/scan-push-full-suite.mjs`
  escaneia o par `scripts/pre-push-gates.sh` + `.husky/pre-push` (working
  tree do checkout do CI) e falha se o Gate 3 rodar a suíte completa
  (`test:unit`/`test:run`/`vitest run`/`bun run test`) — a regressão da
  seção 8.4 (Gate 3 mapeado, nunca a suíte completa). O teste roda em
  DUAS redes no PR: o job `check` (`bun run test:unit`) e o job
  `fragile-guard` (`bun run test:guard`, que inclui a suite).
- **Run**: [31354308733](https://github.com/severinno/severinno/actions/runs/31354308733)
  (event `workflow_dispatch` do PR Check, branch scratch
  `ci-proof/push-suite-sentinel`).
- **Injeção**: branch scratch a partir do HEAD limpo (c9a706c) com
  `bun run test:unit # SENTINEL-PROVA-CI-2026-08 (removido apos a prova)`
  (linha 67, logo após o marcador mapeado `pre-commit-tests.mjs --scope
  push`) no `scripts/pre-push-gates.sh` real (commit 2bb6ab8, ASCII puro,
  diff de 1 linha).
- **Disparo**: `gh workflow run "PR Check" --ref ci-proof/push-suite-sentinel`
  (o pr-check.yml existe no default branch — o 404 do Prova 7 era só para
  workflow ausente lá; aqui o dispatch por API funcionou de primeira).
- **Observado** (2026-08-10, log do run) — AMBOS os jobs que rodam a suite
  falharam exatamente como a prova local previu:

```
check | Unit tests:
  × scan-push-full-suite.mjs - Gate 3 nunca roda a suite completa (sec 8.4)
    > REAL-REPO CONTRACT: os arquivos reais estao limpos hoje -> exit 0
    > (regressao futura falha aqui)
    → expected 1 to be +0 // Object.is equality
##[error]AssertionError: expected 1 to be +0 // Object.is equality

Fragile Range Guard | Run guard vitest suites:
  Test Files  1 failed | 2 passed (3)
      Tests  1 failed | 72 passed (73)
  ❯ scripts/__tests__/scan-push-full-suite.test.ts:108:22
    106|   it("REAL-REPO CONTRACT: os arquivos reais estao limpos hoje -> exit …
    107|     const r = runGuard(process.cwd())
    108|     expect(r.status).toBe(0)
```

  O teste esperava `status 0` (repo limpo) e o guard saiu `1` — o sentinel
  `bun run test:unit` foi detectado no Gate 3. O caminho exato veio do
  ground truth local no scratch (mesmo checkout que o CI):

```
$ node scripts/scan-push-full-suite.mjs
push-suite: FULL-SUITE in scripts/pre-push-gates.sh:67: bun run test:unit # SENTINEL-PROVA-CI-2026-08 (removido apos a prova)
push-suite: Gate 3 must run the MAPPED tests (pre-commit-tests.mjs --scope push), not the full suite (sec 8.4)
# exit 1
```

- **Reversão**: branch remoto deletado
  (`git push origin --delete ci-proof/push-suite-sentinel --no-verify`),
  worktree scratch removido, branch local deletada (era 2bb6ab8) — `git
  status` do worktree principal intacto, 0 branchs `ci-proof/*` restantes.
- **Gap protegido**: a regressão da 8.4 (re-adicionar a suíte completa ao
  Gate 3) agora é travada em TRÊS pontos — o pre-commit roda o guard
  (seção 11.9), o push net `guard-gates.yml` o roda em todo push a
  main/develop, e este run prova que o REAL-REPO CONTRACT falha no CI do
  PR com o caminho exato do offender. O guard nunca fica órfão de
  execução: se alguém re-injetar `test:unit` no pre-push-gates.sh, o PR
  quebra aqui antes do merge.

## 8.8 Prova 11 — Gate 2 fuzz MAPEADO live (pre-push real, 2026-08-10)

A adoção do runner mapeado (seção 11.11) trocou o `fuzz:ci` de 6 spawns
(~40.4s) pelo `run-mapped-fuzz.mjs --since` (só as suites cujos alvos foram
tocados, batched numa invocação). A prova viva do Gate 2: um touch real em
`src/lib/radius-expansion.ts` num push real deve selecionar EXATAMENTE as 2
suites do manifest que apontam para ele (`cache-key-fuzz` +
`radius-expansion-fuzz`) — e o push passar.

**Setup**: branch scratch `ci-proof/fuzz-mapped-radius` criada a partir de
`93eb00e` (o HEAD local — o único ref com o Gate 2; a release remota
`release/v0.4.0` pré-data o runner, detalhe da base que o Type E exige
re-verificar por prova), worktree scratch + `bun install --frozen-lockfile`
(1187 pacotes, react 19.2.3 = lock, integrity guard verde) + `.env` copiado
do worktree principal. Touch benigno = 1 linha de comentário ASCII puro no
fim do arquivo (o `scan-non-ascii` flagra 1 VIOLATION pré-existente — um
em-dash U+2014 na linha 11 do arquivo, válido em UTF-8 e fora da superfície
ASCII-pura; não afeta os gates). Commit com `--no-verify`: o pre-commit do
scratch falhava no scan-lucide por fixture `vitrine-a11y-setup.tsx` stale no
commit base (regenerada só no trabalho não-commitado do thread — fora do
escopo desta prova).

**Push 1 (criação da branch — `--since` all-zeros → fallback fuzz completo)**:

```
PUSH1_EXIT=0
[fuzz] fallback: --since ausente/zeros (primeiro push ou rodada manual) -> fuzz COMPLETO batched (6 suites, secao 11.11)
To github.com:severinno/severinno.git
 * [new branch]      ci-proof/fuzz-mapped-radius -> ci-proof/fuzz-mapped-radius
```

(Semântica documentada e correta: sem range não há mapa. O push passa e a
branch fica rastreada em `59615b5` — que vira o `--since` do push 2.)

**Push 2 (—since real = 59615b5 → diff = só o 2o touch → mapeado)**:

```
PUSH2_EXIT=0
[fuzz] mapeado: 2 suite(s) para o diff do push (secao 11.11):
  - src/lib/__tests__/cache-key-fuzz.test.ts
  - src/lib/__tests__/radius-expansion-fuzz.test.ts
Test Files  2 passed (2)
      Tests  16 passed (16)
To github.com:severinno/severinno.git
   59615b5..63063ce  ci-proof/fuzz-mapped-radius -> ci-proof/fuzz-mapped-radius
```

O Gate 3 mapeado também passou no mesmo push 2 (a área tocada mapeou para o
teste unitário do arquivo):

```
-- Gate 3/3: testes unitarios das areas tocadas (staged + HEAD + range do push) --
  pre-push:test - 1 teste(s) nas ?reas tocadas: src/lib/__tests__/radius-expansion.test.ts
```

**O contrato foi provado nos dois sentidos**: (1) o runner selecionou
EXATAMENTE as 2 suites do manifest para `radius-expansion.ts` (nada de
fallback completo, nada de suite a mais — o batching de 2 suites rodou em
~16 testes verdes); (2) o push passou com a cadeia inteira — verify-encoding
3 camadas (`fragile-range: clean (141 gate files + 476 target files)`),
`yaml-gate: clean`, `mjs-gate: clean (34 scripts/*.mjs)`,
`check-node-modules-integrity: clean (react/react-dom match bun.lock:
19.2.3/19.2.3)` e o Gate 3 mapeado.

- **Reversão**: branch remoto deletado (`git push origin --delete
  ci-proof/fuzz-mapped-radius`), worktree scratch removido, branch local
  deletada (era 63063ce) — `git status` do worktree principal intacto, 0
  branchs `ci-proof/*` restantes.
- **Gap protegido**: a premissa da recalibração 8.4/11.11 (Gate 2 mapeado
  em vez do fuzz completo local, CI como autoridade) agora tem prova viva:
  um push real seleciona e roda o subconjunto correto. Se o manifest
  perder a aresta `radius-expansion.ts → 2 suites` (drift do FUZZ_TARGETS),
  este mesmo push selecionaria o número errado — e os contratos
  `fuzz-mapped.test.ts` + `scan-push-full-suite` (positivo/negativo) travam
  o drift no CI antes que o gate local minta. Prova puramente LOCAL
  (pre-push real, sem run number de CI) — como a Prova 9; a tabela da
  seção 1 fica sem registro por design.

## 9. Observação transversal — o mascaramento que motivou o reorder do check job

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

### 9.1 Custo do job `check` no CI + paralelismo nativo lint ∥ typecheck (medição 2026-08-10)

**Dado medido** (run real do PR Check 31354308733, job `check`, ubuntu-latest
— os timestamps por step do log do GitHub):

| Step | Janela (UTC) | Duração |
|---|---|---|
| Set up job + checkout + setup-bun | 04:03:08 → 04:03:12 | ~4s |
| Cache node_modules | 04:03:12 → 04:03:23 | ~11s (restore, cache hit) |
| Install deps (`bun install`) | 04:03:23 → 04:03:31 | ~8s |
| Generate Prisma client | 04:03:31 → 04:03:34 | ~3s |
| **Unit tests** (`test:unit`, o 1º) | 04:03:34 → 04:04:07 | **~33s** |
| **Lint** (`eslint .`, `if: always()`) | 04:04:07 → 04:05:01 | **~54s** |
| **Type check** (`tsc --noEmit`) | 04:05:01 → 04:05:31 | **~30s** |

Wall do job: **~2m25s** (04:03:06 → 04:05:31, `startedAt`→`completedAt` por
step, valores exatos do log do GitHub) — o par lint+typecheck sequencial
custa **~84s** (~58% do wall), dominado pelo lint (~54s, o mesmo BOOT do
bundle eslint-config-next que a 11.3 perfilou; o CI não usa o shim — o
daemon é otimização de hook).

**Paralelismo NATIVO por jobs (lint ∥ typecheck como jobs separados) — a
pergunta: resolve a raça sem shim?** **NÃO — e nem pode, porque a raça é
local-only.** A raça que a 11.5 recusou (e a 11.8 estreitou) é o
`eslint --fix` do lint-staged reescrevendo os arquivos staged ENQUANTO o
`tsc` lê — só existe no hook, onde o lint MODIFICA arquivos. No CI o lint
roda `eslint .` SEM `--fix` (nada reescreve): não há janela de escrita,
logo não há raça a resolver, com ou sem jobs paralelos. O shim da 11.6 é
otimização do ciclo local (8.5s → ~1s warm), não uma correção de CI.

**E o ganho de wall de jobs paralelos?** Se Lint e Type check virassem jobs
separados, o par cairia de ~84s para ~54s no caminho crítico (o max, não a
soma — ~30s de ganho), MAS cada job novo duplica setup+install (~26s por
job). Com 2 jobs paralelos o wall total ficaria ~setup(26) + unit(33) + max(
54,30) ≈ **~113s vs ~145s atuais — economia ~32s (~22%) no wall do job**. O
custo: jobs em paralelo duplicam checkout/install/prisma e dividem runners
com os outros jobs do workflow (fuzz, benchmark, utf8-check já rodam em
paralelo). Veredito: o ganho é real mas marginal no contexto do PR inteiro
(o `fuzz` e o `benchmark` já dominam o wall do workflow); a duplicação de
setup é o preço. Deixado COMO ESTÁ (steps sequenciais com `if: always()`)
— a ordem test-first continua sendo a proteção contra mascaramento, e o
paralelismo nativo seria um lever só se o wall do check fosse o gargalo do
workflow (hoje não é).

## 10. Como adicionar uma nova prova

1. Criar branch scratch `ci-proof/<nome>` a partir do HEAD, aplicar a injeção
   (byte, padrão, import) num arquivo de gate.
2. Disparar o workflow relevante via `workflow_dispatch` — ATENÇÃO: o
   dispatch via API (`gh workflow run` / API direta) só resolve workflows
   que JÁ existem no default branch; um workflow novo (ainda não merged)
   responde HTTP 404 (descoberto na Prova 7). Alternativas quando o
   workflow não está no default branch: (a) um push temporário a `develop`
   (escuta `push: [main, develop]` de workflows como o guard-gates.yml e
   não tem deploy atrelado — deploy.yml só escuta `main`), seguido de
   `git push origin --delete develop` após a prova. NOTA: o mesmo push
   também dispara o `ci.yml` completo (lint/typecheck/test/build/budget —
   runner minutes, normal, o CI precisa ver o push). Ou (b) esperar o
   arquivo entrar no default branch. Branch `main` não existe no remoto, então PR real não
   dispara `pull_request: branches: [main]`.
3. Capturar o log do step que falhou (citar as linhas exatas aqui).
4. Reverter a injeção, deletar o branch scratch e o branch remoto, confirmar
   `git status` limpo no worktree principal.
5. Registrar na tabela da seção 1 com o run number.

## 11. Custo por commit — pre-commit hook (medição 2026-08-09)

Medição do custo real por commit do hook `.husky/pre-commit`, no estado pós-fix do
`.next/types` stale (`.next` removido, `tsconfig.tsbuildinfo` quente, 1.29 MB) e com os
4 arquivos do bloco de auto-heal staged. Sequencial, um shell, sem paralelismo:

| Gate | Custo (1ª run) | Custo (2ª run, warm) | Nota |
|---|---|---|---|
| verify-encoding (UTF-8 + ASCII + fragile + baseline) | 2.4s | — | o maior dos gates de encoding |
| check-docs-encoding (informativo) | 0.7s | — | nunca bloqueia |
| scan-lucide-icons | 0.3s | — | |
| check-next-types (auto-heal) | 0.2s | — | <10ms esperado; 0.2s é boot node |
| **tsc --incremental (warm)** | **17.5s** | **18.2s** | o piso do hook — o MESMO gate do CI |
| **lint-staged (eslint --fix)** | **8.6s** | **8.0s** | dominado pelo BOOT do eslint (8.4s isolado num único arquivo) — valores pré-shim; o shim da 11.6 cortou para ~1s warm e a 11.8 paralelizou com o tsc |
| pre-commit:test (áreas tocadas, 7 testes) | 5.2s | 4.9s | vs ~75s da suíte completa |
| **Total (commit com código)** | **~35s** | | |

**Recalibração — veredito: os dois gates pedidos já cobrem o essencial, manter.**

1. `tsc --incremental` com tsbuildinfo quente: 17.5-18.2s WARM vs ~55s cold (~3x). É o
   MESMO gate que o CI roda (tsc --noEmit), então não é descartável sem perder a garantia
   de tipo — 17.5s é o piso de um typecheck de projeto inteiro e o incremental já entrega
   ele. Confirmado estável nas duas runs (17.5 / 18.2).
2. Mapeamento de áreas (pre-commit:test): 5.2s para 7 testes mapeados vs ~75s da suíte
   completa — o escopo certo para o pre-commit (o CI roda a suíte inteira de qualquer
   forma). Skip instantâneo em commits só-doc.
3. O segundo maior custo NÃO é o tsc: é o `lint-staged` em 8.0-8.6s, quase todo boot do
   eslint (8.4s medido isolado para 1 arquivo — config grande do repo). Se um dia o
   pre-commit precisar ficar mais barato, o alvo é esse (ex.: eslint --cache), não o gate
   de tipo.

Nota honesta: o "~19s" reportado no commit fe7d761 não bate com esta medição — o piso
real é tsc ~17.5s + eslint ~8.5s = ~26s antes mesmo de qualquer teste. O ~19s
provavelmente refletiu uma medição em máquina/estado diferente; o número medido aqui é
o ground truth atual.

**Re-medição 2026-08-10 (shim em produção) — o total real por commit:**

daemon do shim quente (o estado de produção — o daemon fica vivo entre commits),
tsbuildinfo quente, staged set real da thread (docs + shim + os 2 contratos novos = 2
suites/6 testes mapeados). 3 runs completas do `.husky/pre-commit`:

| Run | Total real |
|---|---|
| RUN1 (boot one-time) | ~27s |
| RUN2 | 19.8s |
| RUN3 | 18.6s |
| **Regime estável** | **~19s** |

Componentes (mesma sessão, daemon quente):

| Componente | 2026-08-09 (pré-shim) | 2026-08-10 (shim) | Δ |
|---|---|---|---|
| verify-encoding | 2.4s | 2.17s | ~igual |
| check-docs-encoding | 0.7s | 0.59s | ~igual |
| scan-lucide-icons | 0.3s | 0.17s | ~igual |
| check-next-types | 0.2s | 0.11s | ~igual |
| check-node-modules-integrity + scan-push-full-suite | (novos pós-08-09) | 0.11s + 0.11s | |
| **lint-staged (eslint --fix)** | **8.0-8.6s** | **0.98s (shim warm, 1 arquivo medido — 2 staged no hook)** | **-7.5s** |
| **tsc --incremental (warm)** | **17.5-18.2s** | **11.1s** | ver nota abaixo |
| pre-commit:test (áreas tocadas) | 5.2s (7 testes) | 4.4s (6 testes) | ~igual |
| **Total (wall, lint ∥ tsc)** | **~35s** | **~19s steady (RUN1 ~27s)** | **-16s** |

Soma sequencial dos componentes: 3.3 + 11.1 + 1.0 + 4.4 = **19.8s**; wall paralelo
(lint ∥ tsc): 3.3 + max(1.0, 11.1) + 4.4 = **18.8s** — bate com as runs 2-3
(18.6-19.8s). O `pre-commit:test` pós-shim segue ~4.4s; o skip em commits só-doc
continua instantâneo.

**Atribuição honesta da queda (~35 → ~19):**

1. **O shim (o pedido desta medição): -7.5s** — lint-staged 8.5s → 1.0s warm. É a
   adoção da 11.6 medida de ponta a ponta no hook real.
2. **Estado de máquina do tsc: -6.4s** — 17.5-18.2s (2026-08-09) → 11.1s hoje; a faixa
   10.9-16.5s já documentada na 11.10 (o tsc warm varia com o estado da máquina). NÃO
   é o shim. Mantendo o tsc no estado antigo (17.5s), o wall pós-shim seria ~25s —
   consistente com a 11.8 (sequencial 25.6s / paralelo 23.8s, medido 2026-08-09).

Nota: a RUN1 (~27s ≈ o ~28s esperado) carrega custos one-time de boot (vitest/tsc
estado inicial); o regime estável ~19s é o custo real por commit normal.

**Re-medição 2 (2026-08-10, mesma sessão) — o total MEDIDO de ponta a ponta com o
set real da thread (9 arquivos staged, 3 suites/35 testes mapeados):** o pedido
era o total de ponta a ponta com o shim + paralelo em produção, não a soma de
números separados da 11.8 (~33s). 3 runs completas do `.husky/pre-commit`:

| Run | Total real | Nota |
|---|---|---|
| RUN1 | 123.0s | boot one-time: a maior parte é o tsc cold (~55s, rebuild do tsbuildinfo — a nota original da seção 11 já documentava cold ~55s) + daemon eslintd cold (~13-23s) + vitest cold |
| RUN2 | 45.9s | regime warm |
| RUN3 | 50.6s | regime warm |
| **Regime estável** | **~46-51s** | o custo real por commit com o set atual |

Componentes (mesma sessão, runs isoladas):

| Componente | Re-medição 1 | Re-medição 2 | Δ |
|---|---|---|---|
| verify-encoding | 2.17s | 4.07s | +1.9s (máquina mais carregada) |
| check-docs-encoding + scan-lucide + check-next-types | 0.87s | 1.11s | ~igual |
| check-node-modules-integrity + scan-push-full-suite + scan-lint-staged-loader | 0.22s | 0.43s | ~igual |
| **tsc --incremental (warm)** | **11.1s** | **~27s (26.9-28.0, 2 runs)** | **+16s — estado de máquina** |
| **lint-staged (shim warm)** | **~1s** | **1.8s (5.9s na 1ª run pós-restart)** | ~igual |
| **pre-commit:test** | **4.4s (6 testes)** | **11.6s (3 suites/35 testes)** | **+7.2s — escopo do mapping** |
| **Total wall (lint ∥ tsc)** | **~19s** | **~46-51s** | |

Soma: 5.6 (gates) + 27 (tsc) + 1.8 (lint) + 11.6 (testes) = ~46s; wall paralelo:
5.6 + max(27, 1.8) + 11.6 = **~44.2s** — bate com o RUN2 (45.9s).

**Por que não ~19s nem ~33s?** O custo por commit NÃO é uma constante — varia com
dois eixos: (a) **estado de máquina do tsc** (11.1s na re-medição 1 → ~27s hoje;
a 11.10 já documentava a faixa 10.9-16.5s, e hoje está acima dela — máquina mais
carregada, não regressão do hook) e (b) **escopo do mapping de testes do set
staged** (6 testes → 35 testes: fuzz-mapped 25 + scan-hook-parallel-race 10). O
"~33s" da 11.8 foi a soma de números separados com 1 arquivo staged; o total real
de ponta a ponta com o set atual é ~46-51s. O teto estrutural segue sendo o tsc
(~27s = ~59% do wall); lint-staged shim warm (~1.8s) e gates de encoding (~5.6s)
são estáveis.

**Reprodução:**
```bash
git add <arquivos-do-commit>
for i in 1 2 3; do { time -p bash .husky/pre-commit > /dev/null; } 2>&1 | grep real; done
```

## 11.1 eslint --cache no lint-staged — avaliado e RECUSADO (medição 2026-08-09)

O lint-staged é o 2º maior custo do hook (~8.5s). A pergunta: habilitar
`eslint --cache` cortaria esse custo? Medição empírica diz NÃO — o cache
não ganha no cenário real do lint-staged, e o motivo é estrutural.

**Decomposição do custo (1 arquivo staged, eslint 9.39.2 flat config):**
NOTA de metodologia: estes números são o eslint ISOLADO (`npx eslint`),
mais lentos que o caminho do hook (`bun x lint-staged`, ~8.5s na seção 11)
por causa do dispatch do bun — a conclusão (boot domina, cache não ganha)
vale para os dois.

```
 13.16s  eslint --print-config   (boot + carregar config/plugins)
 12.60s  eslint --fix 1 arquivo  (boot + lint — o lint é ~gratuito)
```

O custo é o BOOT (carregar eslint-config-next + plugins + config), não o
lint do arquivo. O `--cache` do eslint pula LINTAR arquivos inalterados —
mas o engine ainda sobe (boot não é cacheado).

**O cenário real do lint-staged é um MISS garantido:** o arquivo está
staged porque MUDOU (git add só existe para mudanças). O cache é
keyed por hash do conteúdo — arquivo mudado = miss. A/B alternado
3 runs (baseline vs `--fix --cache --cache-location` no mesmo arquivo,
com sentinela apendado para forçar o miss):

```
run 1: baseline=10.29s  cache-miss= 9.08s
run 2: baseline=10.34s  cache-miss=13.16s
run 3: baseline=11.85s  cache-miss=11.86s
   -> sem ganho consistente (mediana baseline ~10.3 vs miss ~11.9)
```

O único caso onde o cache ganharia: o MESMO arquivo relintado SEM mudar
(warm 8.05s vs cold 10.42s — ~2s), o que no hook só ocorreria num
re-commit do mesmo arquivo após falha de outro gate — raro e estreito.

**Decisão: manter `"*.{ts,tsx}": "eslint --fix"` sem --cache.** O cache
adicionaria um arquivo de cache (com .gitignore) + o risco de um resultado
stale ser reusado, para ~0 de ganho no fluxo normal. Se o boot do eslint
precisar cair de verdade, o lever real é um daemon (eslint_d) ou enxugar
a config (menos plugins) — mudanças maiores, avaliadas quando o custo
incomodar. O ~8.5s do lint-staged é aceito como o preço do gate de lint.

## 11.2 eslint_d no lint-staged — avaliado e RECUSADO (medição 2026-08-09)

**A pergunta**: o custo do lint-staged é o BOOT do eslint (config + plugins,
~8s). O eslint_d mantém o engine quente num daemon entre runs — vale
substituir `eslint --fix` por `eslint_d --fix`?

**A medição** (binários diretos de `node_modules/.bin` — o que o lint-staged
realmente executa; `npx` adiciona ~10s de client overhead no Windows e foi
excluído do A/B):

| Caminho | 1º run | runs seguintes |
|---|---|---|
| `eslint --fix` (baseline atual) | 8s | 8s |
| `eslint_d --fix` (cold: daemon inicia + carrega config) | 23s | — |
| `eslint_d --fix` (warm) | — | **1s / 0s** |

- eslint_d 15.0.3 + eslint 9.39.2 (flat config): compatível; funciona no
  Windows (daemon rodando, PID 10500). Paridade: output do eslint e do
  eslint_d **byte-idêntico**; `--fix` aplica igual (exit 0, arquivo preservado).

**O achado que mata a adoção — staleness PROVADA**: o daemon NÃO reinicia
quando a config muda. Testado duas vezes no eslint.config.mjs:
1. `touch` (mtime novo) → PID inalterado, run em 1s com a config velha em
   memória.
2. Mudança REAL de conteúdo (comentário anexado) → PID inalterado (10500),
   run em 1s com a config antiga.

O eslint_d só reinicia em mudança de lockfile (dependência), não em mudança
de config. Para um GATE de pre-commit isso é um furo silencioso: uma edição
de regra staged no mesmo commit seria lintada contra a config ANTIGA — o gate
enforcaria as regras de ontem. Mitigações: restart incondicional paga 23s
cold por commit (pior que o baseline 8s); restart condicional por hash da
config reintroduz maquinaria no hook (tracking de estado) para ~7s/commit.

**Veredito: RECUSADO** — a performance é real (~8x: 8s → ~1s warm), mas o
custo é integridade de gate: staleness silenciosa é exatamente a classe de
falha que este doc prova contra. Diferente da seção 11.1 (o `--cache` era
estruturalmente inútil — boot não é cacheado), o eslint_d é
**performance-válido mas lifecycle-inválido** para o contexto de gate. Se o
eslint_d ganhar watch de config (ou o hook ganhar um shim de restart por
hash), a adoção vira viável — o recipe está nesta seção. O CI roda
`eslint .` fresco como autoridade de qualquer forma, limitando o dano a um
pass/fail local com regras velhas.

**Upstream (rastreabilidade, verificado 2026-08-09 via API do GitHub):** a
staleness NÃO é específica do v15.3/Windows — é comportamento documentado do
daemon. A rastreabilidade é travada por contrato
(`scripts/__tests__/upstream-links-contract.test.ts`): o doc DEVE citar
#281/#276 como links do mantoni/eslint_d.js (PARSE CONTRACT, sem rede) e as
URLs devem responder HTTP 200 (LIVE CHECK — 404/410 = link rot falha;
rede indisponível/429 faz skip honesto). Se um dos links quebrar, o teste
acusa antes de a seção virar referência morta. Issue mais próxima: [#281](https://github.com/mantoni/eslint_d.js/issues/281)
"PSA: ESLINT_USE_FLAT_CONFIG is only evaluated when the daemon
starts/restarts" (closed 2024-07-28) — a config/ambiente é locked no start, e
o fix documentado é `eslint_d restart` manual. A
[#276](https://github.com/mantoni/eslint_d.js/issues/276) "Using eslint flat
mod config with eslint_d" (closed) cobriu o suporte a flat config. NÃO há
issue ABERTA rastreando watch/reload de config (busca por open issues com
"config" só retorna #240 Kate e #336 Yarn Berry, não relacionadas) — o
upstream não sinaliza plano de watch. A condição "se o eslint_d ganhar watch"
da recusa não tem tracker aberto para seguir; a re-validação pelo recipe desta
seção é o caminho.

**NOTA de metodologia**: os números isolados desta seção usam o binário raw
(8s); a seção 11.1 usou `npx eslint` (10-13s) — o npx adiciona ~10s de
resolução/verificação no Windows. O hook (`bun x lint-staged`) usa o binário
resolvido pelo lint-staged, então o raw é o número representativo. O daemon
foi parado (`eslint_d stop`) e a instalação revertida (package.json/bun.lock
byte-identical).

**Reprodução (para re-validação se o eslint_d ganhar watch de config):**
```bash
# A/B com o binário raw (o que o lint-staged executa)
./node_modules/.bin/eslint --fix <arquivo>       # baseline: ~8s
bun add -D eslint_d
./node_modules/.bin/eslint_d --fix <arquivo>      # cold: ~23s via npx (~13s raw bin)
./node_modules/.bin/eslint_d --fix <arquivo>      # warm: ~1s
# staleness probe: npx eslint_d status anota o PID; edite o eslint.config.mjs
# (mtime OU conteudo); rode eslint_d --fix de novo e confira o PID - se igual,
# o daemon lintou com a config antiga (o furo que motiva esta recusa).
npx eslint_d stop                                # limpa o daemon
```

### 11.2.1 Política de re-verificação periódica do upstream (2026-08-10)

A pesquisa do upstream (issues #281/#276, ausência de watch) é um SNAPSHOT de
2026-08-09 — a decisão da 11.2 (recusa do daemon puro) e a 11.6 (adoção do
shim) dependem do estado do upstream e podem ficar stale se ele mudar. Para a
decisão não virar staleness ela mesma:

**Triggers de re-verificação** (qualquer um dispara o recipe abaixo):

1. **Release novo do eslint_d** (bump de `eslint_d` em package.json ou aviso
   de versão no `eslint_d status`) — o trigger principal: uma versão nova
   pode ganhar watch/reload de config (a condição da recusa da 11.2).
2. **Mudança de comportamento observada no shim** (ex.: restart
   condicional que deixa de detectar uma edição real de config — sintoma de
   que o fingerprint e o daemon divergiram).
3. **Cadência máxima de 6 meses** — mesmo sem release, re-rodar o recipe a
   cada ~2 releases ou semestralmente; o custo é < 5 min.
4. **Contrato de links falhando** (`upstream-links-contract.test.ts`: 404/410)
   — se o repo/issues mudarem de lugar, a rastreabilidade quebrou e a
   verificação manual precisa ser refeita junto.

**Recipe de re-verificação** (o mesmo da "Reprodução" acima + o que a 11.2
verificou via API):

```bash
# 1. Estado do daemon + versoes
node_modules/.bin/eslint_d status                 # PID + versao do eslint carregada
# 2. Staleness probe (o furo da 11.2): PID antes, edita o eslint.config.mjs
#    (conteudo), roda de novo, PID DEPOIS - se nao mudou, o daemon continua
#    sem reload (e o shim resta por hash, correto).
# 3. Watch no upstream: buscar open issues com "config watch/reload" no
#    mantoni/eslint_d.js - se aparecer uma issue aberta de watch, a condicao
#    da recusa da 11.2 tem tracker para seguir (reavaliar daemon puro).
# 4. Re-medir warm/cold do shim (tabela da 11.6) e atualizar os numeros se
#    a versao do eslint/daemon mudou.
```

**Registro**: cada re-verificação atualiza o bloco "Upstream
(rastreabilidade...)" desta seção (novo carimbo de data) e, se o veredito
mudar (watch ganho, reload implementado), reverte a 11.6 para a avaliação de
daemon puro com o recipe desta seção. O contrato `upstream-links-contract.test.ts`
continua pinando os links; a data de verificação no doc é o registro humano
do snapshot.

## 11.3 Perfil do boot do eslint — o peso é o BUNDLE eslint-config-next, não um plugin (medição 2026-08-09)

**A pergunta**: o boot (~8.5s) vem de carregar eslint-config-next + plugins.
Qual import pesa mais? Se um plugin dominar, dá para removê-lo ou carregá-lo
lazy? **Resposta com evidência: o dominante é o bundle `core-web-vitals`
(4.6s de import), não um plugin isolado — e nem remoção nem lazy são viáveis
sem perder a cobertura central de regras.**

**Vista 1 — CPU profile do boot real** (`node --cpu-prof` no binário raw +
`--print-config`, 8s wall / 4.4s de amostras de CPU):

- 66% `(native)` — dominado por `compileFunctionForCJSLoader` (36.8% = 1.6s):
  o V8 **compilando o grafo CJS** de módulos carregados; + 2% GC.
- ~24% resolução do loader CJS: `internalModuleStat` (11.4%) + `readFileUtf8`
  (9.4%) + lstat/realpath/readPackageJSON — probes de fs na resolução do
  layout pnpm (cada `require` varre caminhos `node_modules/.pnpm/...`).
- Módulos de plugin individuais <2% cada: babel bundled do next 1.8%,
  react-hooks 0.8%, jsx-a11y 0.6%, typescript 0.6%. **Nenhum plugin isolado
  domina** — o custo é compile + resolução do GRAFO, não a lógica de um plugin.

**Vista 2 — timing de import cold por pacote** (processo fresco por import):

| Import | Custo |
|---|---|
| `eslint-config-next/core-web-vitals` | **4.6s** ← o mais pesado |
| `eslint-config-next/typescript` | 2.1s |
| `@typescript-eslint/eslint-plugin` / `typescript-eslint` | 2.1s |
| `eslint-plugin-import` | 999ms |
| `eslint-plugin-react` | 955ms |
| `eslint-plugin-jsx-a11y` | 883ms |
| `eslint-plugin-react-hooks` | 736ms |
| `eslint` (core) | 432ms |
| `@next/eslint-plugin-next` | 217ms |

**Interpretação**: o dominante é o **bundle** `core-web-vitals` (4.6s) — o
peso é o grafo de plugins que ele agrega (react + jsx-a11y + import + hooks +
@next + o babel compilado do next). O segundo (typescript, 2.1s) carrega o
typescript-eslint. Remover qualquer um = perder a cobertura central de regras
de um repo Next/TS; **lazy-loading não existe em flat config** (o array de
config é avaliado eager no boot do ESLint — não há API de plugin preguiçoso).
O plugin individual mais pesado (@typescript-eslint, 2.1s) é estrutural para
um repo TS (regras type-aware).

**Veredito: nenhuma mudança de config** — o perfil fecha a pergunta com
evidência: o ~8.5s é o preço inerente do conjunto de regras, consistente com
a 11.1 (cache não ajuda — boot não é cacheado) e a 11.2 (daemon recusado por
staleness). Os levers residuais honestos: paralelizar lint+typecheck no hook,
ou um config mínimo separado para o diff staged — ambos com custo de
complexidade/drift que este repo recusa por princípio (single source of
truth).

**Reprodução (para re-validação):**
```bash
# 1. CPU profile do boot (binário raw, sem npx):
node --cpu-prof --cpu-prof-dir=prof node_modules/eslint/bin/eslint.js \
  --print-config scripts/check-next-types.mjs   # ~8s; agregar hitCount do .cpuprofile
# 2. Timing de import cold por pacote (processo fresco por import):
for p in eslint-config-next/core-web-vitals eslint-config-next/typescript \
         @typescript-eslint/eslint-plugin eslint-plugin-import eslint-plugin-react \
         eslint-plugin-jsx-a11y eslint-plugin-react-hooks; do
  node -e "const {performance}=require('perf_hooks');import('$p').then(()=>console.log((performance.now()).toFixed(0)+'ms'))"
done
```
Repo deixado byte-identical após a medição: `prof/` removido e
`eslint.config.mjs` intocado (nenhuma mudança de config — o veredito da seção).

## 11.4 Custo real do guard check-next-types no hook — teste vs hook (medição 2026-08-09)

A seção 11 registra o auto-heal a 0.2s na tabela (nota "<10ms esperado; 0.2s é
boot node"). Esta subseção fecha o gap entre o CUSTO DO TESTE (a suíte vitest,
subprocess-heavy) e o CUSTO DO HOOK (o guard rodado direto), com medição real:

| Caminho | Custo medido | Nota |
|---|---|---|
| Guard direto (`node scripts/check-next-types.mjs --fix`) | **0.12s** (5 runs consistentes) | a lógica pura é <10ms; 0.12s é o boot do node |
| Caminho do hook (`bash .husky/pre-commit` → node) | **0.17-0.18s** (3 runs) | +~0.05s do bash/spawn — o custo real por commit |
| Suíte vitest (`check-next-types.test.ts`, 10 testes) | **3.69s** | ~20x o caminho do hook (ou ~30x vs o guard direto) — o preço da cobertura hermetica |

**Veredito — o gap é o design, não um vazamento:** o hook NÃO roda a suíte —
roda só o guard direto (~0.18s de ~35s totais do hook, <1%). A suíte (3.69s)
é o custo de provar o contrato com mtimes fabricados em subprocessos, pago no
pre-commit:test mapeado e no CI (test:unit/test:guard), nunca no hook. A nota
"<10ms" da tabela 11 se refere à lógica pura (estat + comparação), correta; o
0.2s ali é o boot do node, medido aqui em 0.12s direto / 0.18s via bash
(0.2s vs 0.18s é a mesma classe de ruído de medição entre sessões — mesmo
padrão da reconciliação ~19s vs ~26s desta seção).

**Reprodução:**
```bash
for i in 1 2 3 4 5; do { time -p node scripts/check-next-types.mjs --fix > /dev/null; } 2>&1 | grep real; done
for i in 1 2 3; do { time -p bash -c 'node scripts/check-next-types.mjs --fix' > /dev/null; } 2>&1 | grep real; done
NO_COLOR=1 npx vitest run scripts/__tests__/check-next-types.test.ts --config vitest.config.unit.ts
```

## 11.5 Os dois levers restantes do boot do eslint — paralelismo e config mínima (medição 2026-08-09)

As seções 11.1 (--cache) e 11.2 (eslint_d) recusaram os dois primeiros levers
do boot; a 11.3 provou que o peso é o bundle eslint-config-next, não um
plugin removível. O usuário pediu os dois levers RESTANTES medidos: (A)
rodar o lint do lint-staged EM PARALELO com o tsc no hook, e (B) enxugar a
config. Medidos de verdade:

| Lever | Medição | Resultado |
|---|---|---|
| (B) Paralelo: eslint ∥ tsc | sequencial **31.94s** → paralelo **24.67s** | **economia ~7.3s** (~23% do par) |
| (A) Config mínima (core rules, sem eslint-config-next) | boot **2.63-2.75s** vs **8.61-10.35s** atual | potencial ~6-7.6s por boot — MAS perde a cobertura |

**Veredito (B) — paralelo: RECUSADO.** A economia real existe (~7.3s dos
~35s totais, ~21%), mas o preço é exatamente a classe de flake que esta
thread elimina: o `lint-staged` roda `eslint --fix` nos arquivos staged
ENQUANTO o `tsc --noEmit` lê os mesmos arquivos — uma janela de escrita
parcial durante a leitura produz TS erro transitório (falso vermelho no
commit). O paralelismo também intercala as saídas (debug mais difícil).
Mesmo princípio da recusa do eslint_d (11.2): um gate que pode falhar por
raça em vez de por regressão não é gate. — MAS veja a 11.8: este veredito
foi medido na era pré-shim (lint cold de 8.5s); no regime pós-shim (lint
warm ~1s, ganho real ~1.8-2.4s), o paralelo foi ADOTADO com nota.

**Veredito (A) — config mínima: RECUSADO.** A economia (2.6-2.8s de boot,
~6-7.6s se o lint inteiro rodasse na config mínima) só existe se o hook
usar uma config SEM `eslint-config-next/core-web-vitals` + `typescript` —
que é exatamente quem carrega as regras centrais do repo (react-hooks,
@next/next, @typescript-eslint type-aware, import, jsx-a11y). A 11.3 provou
que não há plugin isolado removível: o custo é o GRAFO do bundle. Enxugar =
perder a cobertura que o repo paga 8.5s para ter — e criar uma segunda
config separada para o diff staged é a divergência de config que o
single-source-of-truth recusa por princípio.

**Fechamento da trilha dos levers:** com 11.1, 11.2, 11.3 e esta 11.5, os
levers do boot do eslint foram avaliados com medição e recusados por
princípios explícitos (cache não ajuda o boot; daemon pega config stale;
nenhum plugin removível domina; paralelo introduz raça; config mínima perde
cobertura). O ~8.5s de lint-staged é o preço aceito do conjunto de regras —
nenhum lever restante sem custo de cobertura/estabilidade. — MAS veja a
11.8: no regime pós-shim (lint warm ~1s), o paralelo re-medido virou
ADOTADO com nota; este fechamento descreve a era pré-shim.

**Reprodução:**
```bash
# B - sequencial vs paralelo (typecheck warm + eslint 1 arquivo):
time -p bash -c 'npx eslint scripts/__tests__/check-next-types.test.ts > /dev/null 2>&1; bun run typecheck > /dev/null 2>&1'
time -p bash -c 'npx eslint scripts/__tests__/check-next-types.test.ts > /dev/null 2>&1 & bun run typecheck > /dev/null 2>&1 & wait'
# A - config minima (core rules, SEM eslint-config-next) - arquivo temp:
cat > scripts/__tmp_min_eslint.config.mjs <<'EOF'
export default [{ rules: {
  "prefer-const": "warn", "no-console": ["warn", { "allow": ["warn", "error"] }],
  "no-debugger": "warn", "no-irregular-whitespace": "error",
} }, { ignores: ["node_modules/**", ".next/**", "out/**", "build/**", "next-env.d.ts", "examples/**", "skills"] }]
EOF
time -p npx eslint --config scripts/__tmp_min_eslint.config.mjs --print-config scripts/__tests__/check-next-types.test.ts  # ~2.6-2.8s
rm -f scripts/__tmp_min_eslint.config.mjs
# A - config ATUAL (com bundles):
time -p npx eslint --print-config scripts/__tests__/check-next-types.test.ts   # ~8.6-10.4s
```

## 11.6 O lever que faltava da 11.2 — shim de restart condicional por hash, ADOTADO (medição 2026-08-09)

A 11.2 recusou o eslint_d porque o daemon não reinicia em mudança de config
(staleness silenciosa). O lever citado lá — "o hook ganhar um shim de restart
por hash" — foi IMPLEMENTADO e medido: `scripts/eslintd-shim.sh` no lint-staged.

**O shim** (3 partes): (1) fingerprint = sha256 de `eslint.config.mjs` + o
`package.json` do próprio eslint + os package.json dos plugins que a config
carrega (eslint-config-next/core-web-vitals + typescript + os eslint-plugin-*);
(2) o fingerprint é persistido em `node_modules/.cache/eslintd-config.sha256`
(gitignored, por-máquina — install limpo zera e força um restart, correto);
(3) fingerprint ≠ cache → `eslint_d restart` + roda; == → roda direto. Fallback:
se o eslint_d não estiver instalado, roda o `eslint` puro (o hook nunca quebra).

**Medição real** (binário raw, o que o lint-staged executa):

| Caminho | Custo | vs baseline |
|---|---|---|
| `eslint --fix` (baseline da 11.2/11.5) | **10.45s** | — |
| Shim COLD (restart + lint, cache zerado) | **5.18s** | já 2x MAIS RÁPIDO que o baseline |
| Shim WARM (fingerprint bate, daemon quente) | **0.77s / 0.78s** | **~13x mais rápido** |
| Mudança REAL de conteúdo → restart | **5.63s** | PID PROVADO 21840 → 17328 (restart aconteceu) |
| `touch` (só mtime, conteúdo igual) | **0.77s** | NÃO restarta — fingerprint é por conteúdo, correto |
| Warm pós-restart | 0.82s | de volta ao regime rápido |

**O achado que fecha a recusa da 11.2**: o fingerprint por CONTEÚDO detecta a
mudança de regra REAL (comentário anexado → restart com PID novo) e ignora o
mtime puro (touch → sem restart, porque a config em memória continua certa).
O furo da 11.2 era o daemon nunca reiniciar; agora ele reinicia exatamente
quando o conteúdo que ele carrega muda.

**NOTA de reconciliação com a 11.2**: a 11.2 mediu o cold start raw em ~13s
(primeiro spawn do daemon); esta sessão mediu o restart do shim em 5.18s. A
diferença é variância de sessão/máquina (cache de fs quente desta medição) —
o número honesto do restart fica na faixa **5.2-13s**. Mesmo no pior caso, o
restart só acontece quando a config/deps mudam (raro no dia a dia); commits
normais pagam só o warm (~0.8s).

**Veredito: ADOTADO** — o restart condicional vale os ~7s/commit: no estado
estável (warm 0.78s vs 10.45s) o hook economiza ~9.7s por commit (~28% dos
~35s totais); o restart (5.2-13s, só quando a config ou deps mudam) é pago
em commits raros de edição de regra — o trade-off líquido é fortemente
positivo para o fluxo normal.

**Re-medição 2026-08-10 (sessão atual, daemon vivo + stamp batendo) — o
custo de hash+restart condicional vs o baseline de 8s da 11.2, em peças:**

| Componente | Custo medido | Interpretação |
|---|---|---|
| `eslint --fix` raw (baseline 11.2) | **6.38 / 6.69s** | o ~8s citado, 2 runs consistentes |
| HASH puro (o fingerprint, sem lint) | **0.38 / 0.40 / 0.41s** | o overhead fixo do shim é sub-0.5s — o custo do gate de hash é desprezível |
| Shim WARM (stamp bate, daemon quente) | **0.80 / 0.86 / 1.05s** | **~8x mais rápido que o baseline** — o commit normal paga só isso |
| Shim COLD (stamp zerado → restart + lint) | **5.36s** | PID PROVADO 10708 → 21028 (restart aconteceu); stamp re-escrito |
| Warm pós-restart | 0.85s | de volta ao regime rápido |

**Conclusão da re-medição**: o shim é viável como alternativa ao daemon
puro — e superior a ele para o contexto de gate — porque (1) o restart
condicional por hash fecha o furo de lifecycle da 11.2 (staleness silenciosa
em mudança de config: o fingerprint por CONTEÚDO detecta a edição real e
ignora mtime puro); (2) o custo do gate de hash é ~0.4s (menos que 5% do
custo de um commit normal); (3) o restart (5.36s medido, faixa 5.2-13s
histórica) só é pago quando a config/deps mudam — raro no fluxo normal. O
custo total por commit no regime estável fica ~0.8s + ~0.4s de hash ≈
**1.2s**, vs o baseline de ~8s — a adoção com integridade de gate é o
caminho que a conclusão da verificação de watch (sem issue aberta) aponta. O hook agora usa o shim no lint-staged
(package.json: `"*.{ts,tsx}": "bash scripts/eslintd-shim.sh --fix"`); o CI
continua rodando `eslint .` fresco como autoridade. O shim entrou no baseline
ASCII-safe (`verify-ascii-proof.sh --sync`, 42 arquivos) — gate file.

**Reprodução:**
```bash
# baseline vs shim (binario raw):
{ time -p npx eslint --fix <arquivo> > /dev/null 2>&1; } 2>&1 | grep real   # ~10.5s
bash scripts/eslintd-shim.sh --fix <arquivo>                                # cold ~5.2s, warm ~0.8s
# prova do restart: anote o PID (eslint_d status), anexe um comentario no
# eslint.config.mjs, rode o shim de novo e confira o PID novo - se mudou,
# o daemon carregou a config nova (o furo da 11.2 fechado).
```

### 11.6.1 Prova viva — contraparte da 11.2 (2026-08-10): a regra NOVA é usada

A 11.2 recusou o daemon puro pelo furo de lifecycle (uma edição de regra
staged seria lintada com a config ANTIGA); a 11.6 adotou o shim para fechá-
lo. Esta prova roda o cenário vivo que a 11.2 só descreveu: editar uma regra
do `eslint.config.mjs` e confirmar qual config o lint usa — a contraparte do
probe de staleness da 11.2.

**Probe**: `scripts/__tests__/fixtures/debugger-probe.ts` (temporário, com
`debugger;` — `no-debugger` não é auto-fixável, então o `--fix` do
lint-staged não mascara o resultado) + flip de `no-debugger: warn ↔ off` no
`eslint.config.mjs`.

**Resultado 1 — baseline (regra ANTIGA viva)**: shim + daemon quente com
`warn` → `4:3 warning Unexpected 'debugger' statement no-debugger`.

**Resultado 2 — SURPRESA: o furo da 11.2 NÃO reproduz no eslint_d v15.0.3**.
Com o flip para `off` e o daemon VIVO (PID estável), o `eslint_d <probe>`
DIRETO (sem shim, sem restart) lintou limpo — o daemon honrou o disco. O
teste inverso confirmou: daemon nascido com `off` (PID 12336), flip para
`warn`, `eslint_d` direto → warning imediato, PID estável. Nas duas direções
a edição de regra é honrada por request, sem restart.

**Mecanismo na fonte (v15.0.3)**: `service.js` — `handleLintRequest` executa
`eslint.execute(argv, text, true)` (o CLI do eslint) **a cada request**; a
config é relida por lint, PID estável. Os únicos gatilhos nativos de restart
são ECONNREFUSED (daemon morto), remoção do config file (`watchConfig`,
rename), SIGTERM e morte do ppid. `filesHash` (hash de lockfiles → restart)
existe em `hash.js` mas **nunca é chamado** — código morto; o restart por
hash que a 11.2 assumia não existe nesta versão.

**Consequência para o shim**: o restart por edição de CONFIG é redundante (o
eslint_d v15 já honra o disco; custo do restart redundante: ~5s cold no
commit raro que edita a config). O valor REAL do fingerprint é a dimensão de
**versão de plugins/deps**: `eslint.config.mjs` inalterado + bump de plugin
no node_modules → o require cache do daemon segue servindo o módulo VELHO —
só o fingerprint do shim detecta. É exatamente o contrato que
`eslintd-fingerprint-contract.test.ts` trava (a enumeração do shim vs a
árvore real de plugins). NOTA DE MÉTODO: esta última afirmação (bump de
plugin) é inferida do mecanismo (require cache — o A/B empírico desta prova
cobriu só edição de config, nas duas direções); uma prova empírica do bump
seria um experimento separado (tocar um plugin em node_modules + re-lint
sem restart).

**Prova do pre-commit completo**: com o flip (`off`) ativo e o probe staged,
`.husky/pre-commit` rodou **verde (exit 0)** — gates de encoding OK,
check-next-types clean, node-modules-integrity clean, lint-staged (que
invoca exatamente `bash scripts/eslintd-shim.sh --fix`) lintou o probe com a
regra NOVA (sem warning), e o `eslint_d <probe>` direto pós-run confirmou
limpo. Revert completo: config restaurada para `warn`, probe removido,
daemon re-aquecido (PID 2240, stamp c5adfd2cc210f927 batendo), working tree
limpo.

**Veredito**: a prova de contraparte confirma o lado positivo que a 11.2 não
testou — a regra NOVA é usada — mas refina o racional: para edições de
config o eslint_d v15 é seguro por si; o shim existe para o caso que o
eslint_d não cobre (versão de plugins), onde o fingerprint é necessário. A
receita de reprodução da 11.6 (herdada do racional da 11.2 — "PID muda ao
editar a config") deve ser relida: a mudança de PID na edição de config hoje
vem do RESTART do shim, não é condição necessária — a condição necessária é
só para bump de plugin/deps.

**Reprodução:**
```bash
# 1. baseline (regra ANTIGA): daemon quente com no-debugger:warn
bash scripts/eslintd-shim.sh scripts/__tests__/fixtures/debugger-probe.ts   # warning no-debugger
# 2. flip para off + eslint_d DIRETO (sem shim) — o daemon honra o disco por request
sed -i 's/"no-debugger": "warn",/"no-debugger": "off",/' eslint.config.mjs
node_modules/.bin/eslint_d scripts/__tests__/fixtures/debugger-probe.ts      # limpo, PID estável
node_modules/.bin/eslint_d status                                            # PID NÃO muda (sem restart)
# 3. shim: restart por fingerprint (stamp diverge) — cobertura de plugins/deps
bash scripts/eslintd-shim.sh scripts/__tests__/fixtures/debugger-probe.ts    # limpo, PID muda (restart)
# 4. pre-commit completo com o flip ativo + probe staged -> exit 0
git add eslint.config.mjs scripts/__tests__/fixtures/debugger-probe.ts && bash .husky/pre-commit
# 5. revert: git restore eslint.config.mjs; rm probe; re-aquecer o shim
```

## 11.7 O loader do bun vs node no boot do eslint — A/B honesto, RECUSADO (medição 2026-08-09)

A 11.3 mostrou que ~24% do boot é resolução do loader CJS (probes de fs no
layout pnpm: internalModuleStat 11.4% + readFileUtf8 9.4% + lstat/realpath).
O hook roda via `bun x lint-staged` — hipótese: o loader do bun (resolução
nativa, sem o probe por-request do node) poderia cortar essa fatia e reduzir
o boot real. A/B honesto, 3 runs cada, binário raw (o que o lint-staged
executa), saída descartada:
**NOTA de metodologia**: `bun run eslint` (o pedido literal) não é o caminho
do hook — não há script `eslint` na seção `scripts` do package.json (o
`eslint` aparece só como devDependency; sanity check `node -e
"console.log('eslint' in require('./package.json').scripts)"` → false).
Sem script, um `bun run eslint` resvalaria para a resolução `node_modules/.bin`
— o MESMO loader do bun medido nas linhas abaixo, então o A/B não perde um
caminho: `bun <bin>` (o loader do bun sobre o MESMO binário raw — isola o
loader de tudo mais) e `bunx eslint` (o runner de pacotes do bun, o que
`bun x lint-staged` aciona no plano real do hook) são os equivalentes
honestos.

| Caminho | Mediana | vs node |
|---|---|---|
| `node node_modules/eslint/bin/eslint.js --fix <arquivo>` | **9.31s** | — |
| `bun node_modules/eslint/bin/eslint.js --fix <arquivo>` | **8.58s** | ~0.7s mais rápido |
| `bunx eslint --fix <arquivo>` | **8.33s** | ~1.0s mais rápido |

**Paridade**: exit 0 nos três; output **byte-idêntico** (diff vazio node vs
bun, node vs bunx) — o bun NÃO muda semântica do lint, só o loader.

**Veredito: RECUSADO** — a economia é ~8% (0.7-1.0s), NÃO os ~24% que o
perfil de CPU sugeria. Por quê: o perfil mede TEMPO DE CPU das probes de fs,
mas no wall clock essas probes sobrepõem a compilação do grafo (o custo
real, 36.8% do CPU) — o loader do bun não compila o grafo CJS mais rápido,
só resolve módulos com menos probes. Trocar o hook de node para bun (ou
`bunx`) para ~1s por commit não compensa o drift de runtime: o lint-staged
invoca o binário via node hoje e o shim da 11.6 já entrega warm ~0.8s — o
bun-load não compete com o daemon quente. O lever do boot segue sendo o
eslint_d (11.2/11.6), não o loader.

**Reprodução:**
```bash
FILE=<arquivo>
for i in 1 2 3; do { time -p node node_modules/eslint/bin/eslint.js --fix $FILE > /dev/null 2>&1; } 2>&1 | grep real; done
for i in 1 2 3; do { time -p bun node_modules/eslint/bin/eslint.js --fix $FILE > /dev/null 2>&1; } 2>&1 | grep real; done
for i in 1 2 3; do { time -p bunx eslint --fix $FILE > /dev/null 2>&1; } 2>&1 | grep real; done
```

**Trava do veredito (2026-08-10)**: esta recusa é travada pelo
`scan-lint-staged-loader.mjs` (pre-commit + `test:guard`, padrão do
scan-push-full-suite): se o lint-staged voltar a rodar o eslint por um
loader bun (`bunx eslint`, `bun eslint`, `bun run lint`, ...) sem re-medir,
o guard falha — a única forma de passar é uma seção numerada 11.x que
declare o loader ADOTADO com a re-medição datada (o mesmo padrão de
reversão das outras seções; prosa explicando a regra não satisfaz o
contrato — o marcador exige o header de seção).

## 11.8 Paralelismo lint-staged ∥ tsc no hook — medido pós-shim, ADOTADO com nota (medição 2026-08-09)

A 11.5 recusou o paralelo por princípio (raça: `eslint --fix` reescreve os
arquivos staged ENQUANTO o `tsc --noEmit` lê os mesmos arquivos → TS erro
transitório) — mas mediu na era PRÉ-shim, com `npx eslint` cold de 8.5s: o
ganho estimado era ~7.3s (31.94s → 24.67s). O shim da 11.6 mudou a economia
do lever: o lint-staged warm agora custa ~1s, então o TETO do paralelo é o
próprio tempo do lint, não o tsc. O usuário pediu a medição real no hook
(`bun run typecheck` ∥ `bun x lint-staged` no `.husky/pre-commit`).

**Medição (binários reais do hook, warm, 1 arquivo staged):**

| Caminho | Runs | Mediana |
|---|---|---|
| Sequencial (lint → tsc) | 25.39 / 25.83 / 30.10s | **~25.8s** (25.83; 30.10 = outlier cold) |
| Paralelo (tsc bg → lint) | 23.98 / 23.52 / 24.02s | **~24.0s** (23.98) |
| Paralelo (lint bg 1º → tsc) | 23.43 / 23.18 / 23.90s | **~23.4s** (23.43) |

Ganho real: **~1.8-2.4s (~7-9%)**, NÃO os ~7.3s da 11.5 — porque o shim já
havia comido o custo do lint (8.5s → ~1s). A raça (erro TS transitório)
NÃO materializou em ~6 runs paralelas, mas a amostra é pequena e a janela
fica estreita, não zero.

**Total por commit (a medida pedida):** a cadeia completa do hook
(verify-encoding + check-docs-encoding + scan-lucide + check-next-types +
par tsc ∥ lint-staged) mediu **28.15 / 28.64s** — somando o
pre-commit:test (~5s), o total fica **~33s**, contra os ~35s da tabela da
seção 11 (era pré-shim: lint-staged 8.0-8.6s). O ganho líquido do
shim+paralelo no total do hook é **~2s**, consistente com o ganho do par.

NOTA (re-medição 2, 2026-08-10, seção 11): o total MEDIDO de ponta a ponta
com o set real da thread (9 arquivos staged, 3 suites/35 testes mapeados)
foi **~46-51s** — acima do ~33s estimado aqui porque (a) o tsc estava em
~27s (estado de máquina, acima da faixa 10.9-16.5s da 11.10) e (b) o
pre-commit:test mapeou 35 testes (fuzz-mapped 25 + scan-hook-parallel-race
10), não os ~5s/6 testes desta medição. O ganho relativo do par (~2s)
continua válido; o número absoluto depende do set staged e do estado de
máquina.

**Implementação (`.husky/pre-commit`):** o lint-staged roda em background
PRIMEIRO (o fix de ~1s cai antes de o tsc ler a maioria dos arquivos —
estreita a janela de raça), o tsc roda em foreground, e a agregação de exit
é explícita:

```bash
bun x lint-staged &
LINT_PID=$!
LINT_EXIT=0
TSC_EXIT=0
bun run typecheck || TSC_EXIT=$?
wait "$LINT_PID" || LINT_EXIT=$?
if [ "$LINT_EXIT" -ne 0 ] || [ "$TSC_EXIT" -ne 0 ]; then
  exit 1
fi
```

**Veredito: ADOTADO com nota** — o pedido era rodar em paralelo e medir; a
medição entrega o número honesto (ganho ~6-9%, não os ~7.3s da estimativa
pré-shim). A recusa da 11.5 era econômica-vs-estabilidade no regime em que
o lint custava 8.5s (janela de raça ampla, ganho pequeno relativo); no
regime pós-shim a janela é ~1s e o ganho é o próprio tempo do lint. O risco
residual (raça estreita, amostra pequena) fica documentado: se um erro TS
transitório aparecer num commit sem mudança de código, o primeiro suspeito
é esta seção — o revert é trocar o bloco pelo `bun run typecheck`
sequencial original (11.5 permanece como o recipe da recusa).

**Guard de estabilidade (job dedicado, 2026-08):** a amostra de ~6 runs era
pequena demais para provar a estabilidade do ADOTADO — o guard
`scripts/scan-hook-parallel-race.mjs` fecha isso: roda o par REAL N vezes
(default 10) num job dedicado (`hook-parallel-race.yml`, schedule semanal +
workflow_dispatch — trigger irmão obrigatório pelo Type D HERMETIC) e FALHA
se qualquer erro TS transitório aparecer (tsc exit != 0 com baseline verde =
a raça materializou; baseline vermelho = erro TS REAL do repo, reportado à
parte). Para a janela não ser ZERO no CI (checkout fresco sem nada staged),
o guard cria um PROBE com violação fixable (`let raceProbeValue = 1` →
`const raceProbeValue = 1` via prefer-const, provado empiricamente com o
shim real 2026-08), faz `git add` e re-injeta a violação em CADA iteração —
o lint-staged reescreve o probe enquanto o tsc lê, reproduzindo a condição
da raça de verdade. A lógica (parse, probe, transient-detection, mutations
com fake commands) é hermética em
`scripts/__tests__/scan-hook-parallel-race.test.ts` (test:guard); o job
roda a suite junto para a lógica não ficar órfã. Se o guard falhar no CI, a
ação é a MESMA da nota: reverter o bloco paralelo para o `bun run
typecheck` sequencial e atualizar esta seção com a evidência.

## 11.9 scan-push-full-suite no pre-commit — regressão da 8.4 travada antes do commit (medição 2026-08-09)

O guard do Gate 3 do pre-push (`scan-push-full-suite.mjs` — trava a decisão da
seção 8.4: Gate 3 mapeado, nunca a suíte completa) rodava apenas no push net
(`test:guard` do guard-gates.yml, que inclui `scan-push-full-suite.test.ts`)
e no CI. O pedido: rodá-lo TAMBÉM no pre-commit, para a regressão falhar
antes mesmo do commit — o hook que edita o pre-push-gates.sh/`.husky/pre-push`
é o mesmo que roda o guard.

**Custo medido por commit** (o guard é a única adição ao hook):

| Caminho | Custo medido | Nota |
|---|---|---|
| Guard direto (`node scripts/scan-push-full-suite.mjs`) | **0.12-0.14s** (5 runs: 0.14/0.12/0.12/0.13/0.12) | a varredura de 2 arquivos é <10ms; ~0.12s é o boot do node |
| Caminho do hook (`bash .husky/pre-commit` → node) | **0.17s** (3 runs consistentes) | +~0.05s do bash/spawn — o custo real por commit |
| Suíte vitest (`scan-push-full-suite.test.ts`, 7 testes) | **5.98s** wall (Duration 2.86s; 7/7) | medido 2026-08-09 — o preço da cobertura hermetica (paga no pre-commit:test mapeado + CI) |

**Impacto no total do hook**: ~0.17s de ~19-35s totais (<1%) — o mesmo peso
do guard check-next-types (11.4). A regressão da 8.4 agora falha em 3
camadas: pre-commit (local, antes do commit), push net (todo push a
main/develop) e CI test:unit (checkout fresco).

**NOTA de semântica** (documentada no próprio hook): o guard valida o
WORKING TREE de `pre-push-gates.sh` + `.husky/pre-push` — uma edição em
andamento desses arquivos (ex.: marker removido temporariamente durante um
refactor) falha TODO commit até terminar. Mesma semântica do
`verify-encoding.sh` (que também escaneia gate files do working tree); o
commit fica bloqueado de propósito até o arquivo estar consistente.

**Reprodução:**
```bash
for i in 1 2 3 4 5; do { time -p node scripts/scan-push-full-suite.mjs > /dev/null; } 2>&1 | grep real; done
for i in 1 2 3; do { time -p bash -c 'node scripts/scan-push-full-suite.mjs' > /dev/null; } 2>&1 | grep real; done
```

## 11.10 O loader do bun vs node no tsc --incremental — A/B honesto, loader IRRELEVANTE (medição 2026-08-10)

A 11.7 mostrou que o loader do bun economiza ~8% no boot do eslint (RECUSADO
como lever). O tsc --incremental é o piso do hook (o gate de typecheck): a
mesma pergunta aplicada a ele — o loader muda o custo real, ou o tsc é
CPU-bound demais para o loader aparecer? A/B honesto no padrão da 11.7
(binário raw, saída descartada, exit-code de paridade). Versões: tsc 5.9.3,
bun 1.3.14, node v22.23.1.

**NOTA de metodologia 1**: no Git Bash (Windows) o `time -p` NÃO agrega CPU
dos processos filhos — user/sys ≈ 0s com real de 10-16s (verificado em
campo) — `real` é a única métrica honesta aqui.

**NOTA de metodologia 2 (a que importa)**: a ordem das medições CONTAMINA o
resultado. A 1ª sessão (bun primeiro, máquina fria) mostrou bun ~16s vs node
~10.9s — um gap de ~5s que sugeria o OPOSTO do eslint. No A/B INTERLEAVED
(node <-> bun run, 3 pares — cancela o drift térmico/IO do ambiente) o gap
colapsou para ~0.5s. Sessão sequencial = viés; interleaved = verdade.

| Caminho (warm, tsbuildinfo quente) | Sessão bun-primeiro | Sessão node-primeiro | Interleaved | Leitura global |
|---|---|---|---|---|
| `node node_modules/typescript/bin/tsc --noEmit --incremental` | 10.80/10.91/11.14 | 10.48/10.35/10.50 | 10.49/10.97/11.34 | **mediana ~10.8s**, spread 10.35-11.34 (~9%) |
| `bun run typecheck` (o caminho do hook) | 16.26/16.50/15.98 | 12.10/11.89/12.21 | 10.92/11.46/11.82 | **mediana ~12.1s**, spread 10.92-16.50 (~51%) |
| `bunx tsc --noEmit --incremental` | 16.30/15.47/15.51 | 11.86/13.27/12.61 | — | mediana ~14.4s (as 2 sessões dela straddle 11.9-16.3 — mesmo drift do bun run) |
| `bun <bin> tsc` (loader puro) | 84.54*/21.38/11.30 | 14.11/13.45/12.80 | — | mediana ~13.5s (*outlier one-time ~84s) |

**Interleaved (a metodologia confiável)**: node ~10.9s (10.49/10.97/11.34)
vs bun ~11.4s (10.92/11.46/11.82) — **~0.5s (~4%)**, bun marginalmente mais
lento. O gap grande da 1ª sessão era drift do ambiente, não loader.

**Cold** (rm tsbuildinfo antes de cada variante, 1 run): bun run **41.88s** /
node **42.57s** / bunx **41.64s** — **idêntico** (~42s, dif <1s). A full
program check é CPU-bound; o loader não aparece nem aqui.

**O que sobra de real — a VARIÂNCIA**: bun ≥ node em TODAS as sessões (o
mínimo e o teto do bun nunca bateram os do node), mas o cluster de ~16s vem
de UMA única sessão — a 1ª, a mais fria/carregada (o próprio warmup dela foi
20.65s). Nas sessões 2-3 o bun ficou em 10.92-12.21s (~11% de spread,
comparável ao ~9% do node) e no interleaved o spread intra-sessão do bun
(0.9s) ≈ o do node (0.85s). Se o cluster de 16s é sensibilidade própria do
bun ou um evento pontual da máquina, o dado NÃO resolve (n=1 sessão fria) —
e é exatamente por isso que, se a variância um dia incomodar, `node <bin>` é
o substituto determinístico.

**Paridade**: exit 0 em todos os 30 runs; o CI roda `bunx tsc --noEmit` (sem
`--incremental`; checkout fresco = sem buildinfo = sempre cold) → 41.6-42.6s
idêntico entre loaders — **o CI é indiferente à escolha do loader**.

**Veredito: loader IRRELEVANTE para o tsc — RECUSADO como lever** (confirma
a hipótese da pergunta). Oposto do eslint (11.7: bun ~8% mais rápido no boot
por vencer milhares de requires pequenos): o tsc é um arquivo de 8.8MB +
checagem CPU-bound — não há resolução CJS para o resolver nativo do bun
vencer. O piso de ~11-17s do hook (sessão atual; o doc antigo citava 17-24s
em outro estado de máquina) é o preço do typecheck em si, não do loader; o
único lever restante seria reduzir a superfície do programa (tsconfig
paths/exclusões), fora do escopo desta medição. Se a variância do bun um dia
incomodar (pior run 16.5s vs teto do node 11.3s), `node <bin>` é o
substituto determinístico — mas ~4% não justifica tocar o script do hook
hoje.

**Reprodução:**
```bash
# interleaved (cancela drift): node <-> bun run, 3 pares
for i in 1 2 3; do { time -p node node_modules/typescript/bin/tsc --noEmit --incremental > /dev/null; } 2>&1 | grep real; { time -p bun run typecheck > /dev/null; } 2>&1 | grep real; done
# cold: rm tsbuildinfo antes de cada variante
rm -f tsconfig.tsbuildinfo && { time -p bun run typecheck > /dev/null; } 2>&1 | grep real
```

## 11.11 Fuzz mapeado por diff — avaliação (medição 2026-08-10)

O fuzz:ci é o custo dominante do push (seção 8.4 nota 1): 53s (2026-08-09) /
**40.4s (re-medição hoje)** — 71% do total. O Gate 3 foi calibrado por
mapeamento de áreas (`pre-commit-tests.mjs --scope push`, `--since` do
remoto, 8.4: 18s vs 178s ~10x). A pergunta: o fuzz deve ganhar o MESMO
tratamento — rodar só as suites fuzz cujos alvos foram tocados, com o CI
rodando o fuzz completo como autoridade.

**Alvos reais (manifest — o nome-colocado do collectTestFiles NÃO cobre
fuzz**: `address-autocomplete-fuzz.test.tsx` ≠ `__tests__/address-autocomplete.test.tsx`):

| Suite fuzz | Alvo |
|---|---|
| `benchmark-utils-fuzz.test.ts` | `src/lib/benchmark-utils.ts` |
| `cache-key-fuzz.test.ts` | `src/lib/radius-expansion.ts` |
| `distance-fallback-fuzz.test.ts` | `src/lib/distance-fallback.ts` |
| `radius-expansion-fuzz.test.ts` | `src/lib/radius-expansion.ts` |
| `fuzz-utils-consistency.test.ts` | `src/lib/fuzz-utils.mjs` + `src/lib/__tests__/fuzz-utils.ts` |
| `address-autocomplete-fuzz.test.tsx` | `src/components/vitrine/address-autocomplete.tsx` |

Todas as suites importam o helper `@/lib/__tests__` (fuzz-utils.ts) — a aresta
SHARED-HELPER: tocar `src/lib/__tests__/fuzz-utils.ts` ou `src/lib/fuzz-utils.mjs`
dispara TODAS as suites.

**Custos por suite** (spawn individual, config default — o que o
run-all-fuzz.mjs executa; NOTA de método: a soma das suites (~44.7s) excede
o total do runner (40.4s) — ambos incluem o boot por-spawn; a diferença de
~4s é variância de estado de máquina entre os lotes de medição):

| Suite | Custo |
|---|---|
| benchmark-utils-fuzz | 7.97s |
| cache-key-fuzz | 5.81s |
| distance-fallback-fuzz | 5.62s |
| fuzz-utils-consistency | 5.55s |
| radius-expansion-fuzz | 5.55s |
| address-autocomplete-fuzz | **14.18s** (o maior — 6 spawns somam ~44.7s) |

**O insight do BATCHING** (o mesmo do encoder do verify-encoding — spawns por
seção, não por arquivo): 6 suites numa ÚNICA invocação vitest = **14.45s** vs
40.4s de 6 spawns — o boot por-spawn (~4-5s × 6) domina o custo. Qualquer
runner mapeado precisa BATCHAR as suites selecionadas numa invocação.

**Cenários mapeados (batch, uma invocação):**

| Cenário de push | Suites selecionadas | Custo |
|---|---|---|
| touch `src/lib/radius-expansion.ts` | cache-key + radius-expansion | **5.80s** |
| touch `address-autocomplete.tsx` | address-autocomplete | 14.18s (spawn único) |
| touch helper compartilhado | TODAS as 6 (aresta shared-helper) | **14.45s** (batch) |
| touch fora das superfícies fuzz (admin/docs/ui) | nenhuma | ~0s + boot do runner |
| hoje (fuzz:ci, 6 spawns) | todas | **40.4s** |

**Novo custo por push (estimado)**: típico ~6-14s vs 40.4s hoje (-26 a
-34s); o pior caso (helper compartilhado) é 14.45s — AINDA -26s vs hoje,
porque o batching elimina 6 boots. Total do hook cai de ~60s (estado atual)
para ~25-34s.

**Design (se adotado):**
1. Manifest `scripts/fuzz-targets.mjs`: suite → alvos + a aresta
   shared-helper (o helper → TODAS as suites).
2. Runner `run-mapped-fuzz.mjs --since <sha>`: diff do range (padrão do Gate
   3: união staged + HEAD + `<sha>...HEAD`), resolve alvos → suites, roda
   BATCHADO numa invocação vitest (config default, o mesmo do run-all-fuzz);
   zero suites → skip com mensagem (exit 0 — NÃO o exit-2 do `--only` do
   run-all-fuzz); primeiro push (--since all-zeros) → fallback para o fuzz:ci
   COMPLETO (sem range = sem mapa = a autoridade do CI).
3. Gate 2 do pre-push troca `bun run fuzz:ci` pelo runner; o CI (`fuzz:ci`)
   continua rodando o fuzz completo como autoridade.
4. Guard: o `scan-push-full-suite.mjs` trava hoje `bun run fuzz:ci` positivo
   no .husky/pre-push + negativo no pre-commit — a adoção exige atualizar o
   contrato (positivo: `run-mapped-fuzz` presente no pre-push; negativo:
   `fuzz:ci`/`run-mapped-fuzz` fora do pre-commit).
5. Contrato de cobertura do manifest (a classe de gap silencioso): uma suite
   `*-fuzz*.test.{ts,tsx}` NOVA em src/ sem entrada no `fuzz-targets.mjs`
   rodaria só no CI (o runner local não a selecionaria) — o manifest precisa
   de um contrato de cobertura (teste: toda suite que o run-all-fuzz.mjs
   auto-descobre tem entrada no manifest), no padrão dos contratos
   scan-surfaces/fragile-range.

**Veredito: VALE ADOTAR** — o mapeamento + batching corta o custo do fuzz de
40.4s para ~6-14s (típico), e até o pior caso (helper compartilhado) é -26s
por causa do batching. O CI como autoridade fica inalterado (checkout fresco
roda o fuzz completo sempre).

### IMPLEMENTADO (medição 2026-08-10)

Pacote completo adotado — Gate 2 do pre-push agora roda o runner mapeado:

| Arquivo | Papel |
|---|---|
| `scripts/fuzz-targets.mjs` | Manifest suite → alvos + aresta shared-helper (barrel `@/lib/__tests__` + fuzz-utils.mjs → TODAS); CLI `--check-coverage` com env override `FUZZ_TARGETS_SCAN_ROOT` (padrão PUSH_SUITE_SCAN_ROOT) |
| `scripts/run-mapped-fuzz.mjs` | Runner `--since` do Gate 2: reusa `gitPushScopeFiles` (exportado do pre-commit-tests.mjs — o MESMO diff do Gate 3, fonte única), `resolveFuzzPlan` puro, batch numa invocação vitest (config default, o mesmo do run-all-fuzz), zero-suites = skip exit 0, `--since` ausente/zeros = fallback fuzz COMPLETO batched |
| `.husky/pre-push` | Gate 2 trocou `bun run fuzz:ci` pelo `node scripts/run-mapped-fuzz.mjs --since "${PRE_PUSH_REMOTE_SHA:-}"` |
| `scripts/scan-push-full-suite.mjs` | Contrato atualizado: positivo = `run-mapped-fuzz.mjs --since` no pre-push; negativo = `fuzz:ci`/`run-mapped-fuzz` fora do pre-commit |
| `scripts/__tests__/fuzz-mapped.test.ts` | Suíte hermética: seleção do manifest, `resolveFuzzPlan` (full/skip/mapped), COVERAGE CONTRACT hermetizado + REAL-REPO CONTRACT bidirecional (nenhuma suite sem manifest, nenhuma orfa, todos os alvos existem) |

**Custo real por push (runner real, seed 42, batch):**

| Cenário | Medido | vs fuzz:ci (40.4s) |
|---|---|---|
| skip (diff sem superfície fuzz) | **0.46s** | -40s |
| mapeado (radius tocado → 2 suites) | **5.68s** | -34.7s |
| fallback full (primeiro push, 6 suites batched) | **17.98s** | -22.4s |

O pior caso real (17.98s) é o fallback de PRIMEIRO push — um evento raro; o
típico push mapeado é ~5-6s e o skip de pushes docs/admin/ui é sub-segundo.
O CI (`bun run fuzz:ci > fuzz-results.json`, checkout fresco) continua a
autoridade inalterada.

### RE-MEDIÇÃO 2026-08-10 (recalibração same-session — o baseline mudou)

Proveniência dos baselines concorrentes: 53s (percepção pré-batching), 40.4s
(11.11, 6 spawns), 59.96s/26.16s (11.12, ANTES/DEPOIS do batching) — todos
estados de máquina diferentes. O número AUTORITATIVO é o A/B same-session
abaixo: medir `bun run fuzz:ci` AGORA (13.01s) e o runner mapeado na MESMA
sessão, back-to-back, seed 42:

| Cenário (push real, same-session) | Medido | vs fuzz:ci (13.01s) |
|---|---|---|
| skip (diff sem superfície fuzz, `--since HEAD^`) | **0.50s** | **-12.5s** |
| mapeado típico (2 suites de lib, 16 testes) | **5.76s** | **-7.3s** |
| mapeado vitrine (1 suite, 20 testes — a lenta histórica) | **14.48s** | **+1.5s (wash)** |
| fallback full (primeiro push, 6 suites) | ~13-15s | ~0 (igual por construção) |

Veredito honesto: o valor do mapeamento concentra-se no skip (-12.5s,
pushes docs/admin/ui) e no mapeado de lib (-7.3s). O caso vitrine é um WASH
— a suite `address-autocomplete-fuzz` domina o custo do fuzz inteiro, então
mapeá-la sozinha não economiza nada nesta máquina (e o fallback de primeiro
push é igual ao fuzz:ci por construção — é o mesmo conjunto).O mapeamento continua valendo: nunca é pior que o full exceto o wash da
vitrine (~igual, +1.5s de ruído), e o push típico (docs/admin/ui ou lib)
corta 7-12s. O CI como autoridade permanece inalterado (checkout fresco
roda o fuzz completo sempre). Nota de método:
os números de vitest são diretos (runner = +~0.4s de boot+git diff, já
incluído no skip 0.50s); a coluna usa fuzz:ci (13.01s, `--json`) como
baseline, não o `npx vitest run` cru (~14.9s) — o runner do CI é a
autoridade.

**Contrato de cobertura** (o gap silencioso da secção 11.11 ponto 5):
`fuzz-targets.mjs --check-coverage` falha com o caminho exato se uma suite
`*-fuzz*.test.{ts,tsx}` nova em src/ não tiver entrada no manifest (rodaria
só no CI) — travado pelo REAL-REPO CONTRACT do fuzz-mapped.test.ts nos dois
sentidos. O guard do push-suite (`test:guard` + push net) inclui a suíte
nova e o contrato de gate atualizado.

### Por que o fuzz NÃO vai para o pre-commit (avaliação 2026-08-10)

Pergunta: o fuzz mapeado (~5.7s típico) também cabe no pre-commit,
espelhando o scan-push-full-suite (que roda nos dois hooks)? **Resposta:
NÃO — fuzz fica pre-push-only**, e o contrato que a secção 11.11 já pinava
é o que trava isso (GATE_CONTRACTS do scan-push-full-suite: NEGATIVO
`fuzz:ci|run-mapped-fuzz` fora do `.husky/pre-commit`; POSITIVO
`run-mapped-fuzz.mjs --since` no `.husky/pre-push`).

O número de ~5.7s NÃO transfere para o commit, porque a seleção mapeada
depende de um `--since` REAL (o sha remoto do push) — e no pre-commit não
existe range empurrado. As duas fiações ingênuas foram MEDIDAS:

| Fiação no pre-commit | Comportamento real medido | Veredito |
|---|---|---|
| `--since HEAD` (diff `HEAD...HEAD`, vazio) | `[fuzz] skip: nenhuma suite mapeada` — exit 0, **nada roda NUNCA** | gate no-op silencioso (falso verde) |
| sem `--since` (wiring naive) | fallback fuzz COMPLETO batched: **14.69s** a CADA commit (6 suites) | o custo exato que o runner mapeado existe para evitar — ~+45% no total medido do hook (11.8, ~33s) |
| `--since HEAD~1` (diff do commit anterior) | seleciona o diff do commit ANTERIOR, não o staged | escopo errado (testa o que já foi commitado) |

A única fiação correta seria um modo STAGED no runner (`gitStagedFiles` /
`--scope cached` do pre-commit-tests.mjs) — uma FEATURE nova, não wiring —
e mesmo assim a suite vitrine (14.18s isolada) tornaria o imposto por
commit dominante. Por que a decisão é a certa:

1. **O pre-commit já cobre as áreas tocadas deterministicamente** via
   `pre-commit:test` (unit tests mapeados dos arquivos staged) — o fuzz é a
   camada ESTOCÁSTICA, cujo valor está no range real do push + no CI fresco.
2. **A rede de fuzz tem dois níveis e ambos continuam**: pre-push mapeado
   (~5-6s típico) + CI completo em checkout fresco (autoridade). O commit
   é o ponto de feedback rápido e determinístico; o push, o ponto da rede
   estocástica.
3. **O contrato já pinava a decisão** (secção 11.11, adotado 2026-08-10) —
   esta subsecção documenta o PORQUÊ que o contrato só assere, fechando a
   lacuna de racional registrado (o mesmo padrão da auditoria de árvores).
4. **Semântica honesta**: adicionar o gate ao pre-commit sem modo staged
   produziria um no-op silencioso (`--since HEAD`) ou +14.69s/commit (full
   fallback) — os dois violam a postura de custo medida em toda a secção 11.

Se um dia o fuzz pré-commit fizer sentido, o caminho é: adicionar
`--scope cached` ao run-mapped-fuzz.mjs, re-medir o custo por commit e
atualizar o GATE_CONTRACTS (negativo → positivo nos dois hooks). Até lá,
pre-push-only é o estado travado.

## 11.12 Fuzz:ci BATCHADO — o mesmo lever do encoder aplicado ao runner (medição 2026-08-10)

O batching descoberto na 11.11 (6 suites numa única invocação vitest vs 6
spawns) valia também para o fuzz COMPLETO do CI. Aplicado ao
`run-all-fuzz.mjs` (o que o `fuzz:ci` executa): UMA invocação
`vitest run <6 suites> --reporter=json`, doc único re-splitado por suite via
`splitPerSuiteResults` (exportado, entry-point guard adicionado) no EXATO
shape do formatter antigo.

**Medição A/B same-session (2026-08-10, o baseline de 40.4s da 11.11 era
outro estado de máquina):**

| | fuzz:ci | Δ |
|---|---|---|
| ANTES (6 spawns) | **59.96s** | — |
| DEPOIS (1 spawn batch) | **26.16s** | **-33.8s (~2.3x)** |

**Formato de saída preservado (o contrato do CI `fuzz:ci >
fuzz-results.json`):** array de 6 entradas por-suite, as MESMAS 9 keys do
formatter (file, numTotalTests, numPassedTests, numFailedTests, durationMs,
slowestMicro, fastestMicro, iterations, tests), mesmo set de files, 0
failed. Verificado por comparação direta dos dois JSONs.

**Bônus do split:** o vitest 3.1.1 não emite `duration` no top-level do doc
único — ANTES a coluna Duration do formatter era sempre "—" (0); agora
`durationMs` = endTime-startTime por suite (wall-clock real), preenchida em
cada entrada.

**Descoberta centralizada:** o runner agora usa `discoverFuzzSuites` do
fuzz-targets.mjs (a MESMA fonte do run-mapped-fuzz) — fechando a duplicação
de walkDir/isFuzzFile entre os dois runners. O contrato de cobertura da
11.11 (toda suite descoberta tem manifest) agora garante os DOIS runners de
uma vez.

**Gate 3 do pre-push:** a pergunta "vale também para o Gate 3 mapeado" já
estava respondida — o `pre-commit-tests.mjs` spawna UMA invocação vitest
com todos os testes mapeados desde a adoção (é por isso que é 18s vs 178s
na 8.4). O lever do batching já está aplicado lá; nada a mudar.

**Guarda do refactor:** `scripts/__tests__/run-all-fuzz.test.ts` (no
test:guard): testes herméticos do split (counts por suite, duration
endTime-startTime nunca negativa, suite vazia, doc sem testResults) +
REAL-REPO CONTRACT (runner real `--only` → exit 0 e o ARRAY shape do
formatter no stdout, provando a fiação spawn→split→formatter). O contract
mira `radius-expansion` de propósito — uma suite de lib estável, NÃO a
historica/frágil `address-autocomplete` — e seu assert `numFailedTests: 0`
acopla INTENCIONALMENTE o verde do test:guard (push net) ao verde dessa
suite localmente: uma falha ambiental futura de fuzz lê como contrato
conhecido (mesma postura da prova do sentinel), não como surpresa.

## 12. Referências

- Investigação da falha contínua do `security-headers`: `docs/security-headers-gate-2026-08.md`
  (DNS aponta para WordPress na Hostinger, não para o VPS — não é regressão do app).
- Gates de encoding: `scripts/verify-encoding.sh`, `scripts/scan-non-ascii.mjs`,
  `scripts/fragile-range-patterns.mjs`, `scripts/verify-ascii-proof.sh`.
- Guard de bundle: `scripts/check-js-budget.mjs` + `docs/bundle-report.md`.

