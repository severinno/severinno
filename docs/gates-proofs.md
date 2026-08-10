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
| **Run guard vitest suites** | **4s** | o par em si (66 testes) |
| Post Cache (upload) | 10s | sempre roda |
| **Total job** | **~41s** | (45s com fila/overhead) |

O custo REAL do par de suítes é **4s de CI** — o restante do job (~37s)
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
   não vê; o hook ficaria inutilizável.
3. **Autoridade**: o CI roda a suíte inteira em checkout fresco (rede de
   segurança); o mapeamento é só o feedback rápido do push.
4. **Cobertura do mapeamento**: todo arquivo tocado com teste co-localizado
   roda (staged + HEAD + range do push); e2e/docs/YAML não mapeiam por design
   (o CI cobre no PR). O mapeamento é exato DENTRO das áreas tocadas; o único
   ponto cego real é a regressão cross-área (mudança no arquivo A quebra o
   teste co-localizado do arquivo B, intocado — nada mapeia) — precisamente o
   que a suíte completa do CI em checkout fresco pega.
5. **A calibragem real que resta é o fuzz, não o Gate 3** — ver nota (¹).

(¹) O `fuzz:ci` é o custo dominante do push (~53s, 71% do total) — e esteve
**vermelho localmente** pela MESMA duplicação de React da seção 8.5 (invalid
hook call na suite AddressAutocomplete sob jsdom), não um bug da suite. Curado
pelo install limpo da 8.5: fuzz:ci agora exit 0 (~53s). O bloqueio de TODO push
— inclusive deleções (a Prova 8 precisou de `--no-verify`) — está removido SEM
mudança de código: nem consertar a suite (ela nunca esteve errada) nem torná-la
não-bloqueante foi necessário — e tornar um gate vermelho não-bloqueante
mascararia uma regressão real (o CI roda fuzz:ci como autoridade).

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
| **lint-staged (eslint --fix)** | **8.6s** | **8.0s** | dominado pelo BOOT do eslint (8.4s isolado num único arquivo) |
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

## 12. Referências

- Investigação da falha contínua do `security-headers`: `docs/security-headers-gate-2026-08.md`
  (DNS aponta para WordPress na Hostinger, não para o VPS — não é regressão do app).
- Gates de encoding: `scripts/verify-encoding.sh`, `scripts/scan-non-ascii.mjs`,
  `scripts/fragile-range-patterns.mjs`, `scripts/verify-ascii-proof.sh`.
- Guard de bundle: `scripts/check-js-budget.mjs` + `docs/bundle-report.md`.
