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
| 11 | Fuzz — **fuzz:ci BATCHADO** (o `run-all-fuzz.mjs` de UMA invocação vitest da seção 11.12, `--reporter=json` + split) | O runner batchado nunca ter rodado no CI real (a adoção era medida só localmente) | Nenhuma injeção — branch `ci-proof/fuzz-batch` em `28ab2c8` (única ref com o runner novo) + dispatch manual do pr-check | Run [**31397642499**](https://github.com/severinno/severinno/actions/runs/31397642499) (`PR Check`, event `workflow_dispatch`, branch scratch) | ✅ job `Fuzz Tests` = success: `$ node scripts/run-all-fuzz.mjs --json` (runner novo), artifact `fuzz-results.json` arquivado (ID 9066288893), job ~47s; verde no mesmo run: Fragile Range Guard, Geo Benchmark, utf8-check, Docs Encoding (`check`/`Security Headers` falharam por causas pré-existentes alheias à prova); revertido (branch remota + local deletadas) |
| 12 | pr-check COMPLETO do **estado atual** (8 suítes test:guard, fuzz batchado, contrato co-location, merge PROOF+CONTRACT) | A re-medição local (8.1/8.4/11.x) dos tempos reais no CI — e se o estado atual roda verde de ponta a ponta | Nenhuma injeção — branch scratch `ci-proof/pr-check-live` @ 7b6ebd7 (commit do estado da thread sobre 28ab2c8) + dispatch manual do pr-check | Run [**31411254090**](https://github.com/severinno/severinno/actions/runs/31411254090) (`PR Check`, event `workflow_dispatch`, branch scratch) | ✅ tempos confirmados: test:guard **158 testes em 9s** (o "148" citado era pré-batch-runner/pré-contrato-5), fuzz batchado **10s** (estimado ~14s), utf8-check 14s; ❌ **2 ACHADOS REAIS de plataforma** no check (verde local/Windows, vermelho CI/Linux): (a) integrity guard EXTRANEOUS falso-positivo em deps opcionais hoistadas no Linux (`@napi-rs/lzma-linux-x64-gnu` + `@tabby_ai/hijri-converter` — 5 dos 6 testes vermelhos), (b) blame-ignore-revs "every listed hash resolves" em checkout SHALLOW (check job sem `fetch-depth: 0`); + 2 falhas pré-existentes documentadas (Lint use-balance-pulse, Security Headers); revertido byte-identical |
| 13 | Guard de integridade — **SPEC-FORMAT contract** (`check-node-modules-integrity.test.ts` `--check-lock`) | Um spec não-registry NOVO (fora da fronteira `lockKeyFor`) entrar no `package.json` sem decisão explícita SKIP-vs-include — passando como nome registry e quebrando silenciosamente o count-pin 98 | `"custom-pkg": "custom:foo@1.0.0"` injetado no `devDependencies` do package.json REAL (branch scratch `ci-proof/spec-format`, 2af1c62) | **Local** (prova de manifest REAL — o teste lê o package.json do repo; a rota sintética via `NODE_MODULES_ROOT` já é pinada hermeticamente pelo mutation test) | ✅ `--check-lock UNVERIFIABLE custom-pkg - resolved version not found in bun.lock` → exit 1; vitest: `AssertionError: expected 99 to be 98` (SPEC-FORMAT contract) + `AssertionError: expected 1 to be +0` (BASELINE --check-lock); revertido byte-identical (md5 30a16a0f...) → 4/4 verde + CLI `clean (98 direct packages match bun.lock; 0 skipped non-registry)` exit 0 |
| 14 | Guard do push net — **FRAGILE GUARD NEEDS** (`scan-guard-gates.mjs` rule 5) | Um `needs:` voltar no job `fragile-guard` do pr-check.yml (ex.: `needs: check`) — o skip vector da classe que o job standalone existe para fechar (o check pode falhar no lint antes dos testes) | `needs: check` injetado no job `fragile-guard` do pr-check.yml REAL (branch scratch `ci-proof/guard-needs`, 2af1c62) | **Local** (prova de workflow REAL — o CLI + o REAL-REPO CONTRACT leem os arquivos reais; rota sintética já pinada hermeticamente pelo mutation test) | ✅ CLI: `guard-gates: FRAGILE GUARD NEEDS in .github/workflows/pr-check.yml (needs: check - o job standalone nao pode depender de outro...)` → exit 1; vitest: `AssertionError: expected 1 to be +0` (REAL-REPO CONTRACT; 1 failed | 17 passed; o mutation hermético segue verde); revertido byte-identical (md5 a2d3aba4...) → CLI clean exit 0 + suíte 18/18 verde |
| 15 | Guard do push net — **FRAGILE GUARD NEEDS via CI real** (`scan-guard-gates.mjs` rule 5 + REAL-REPO CONTRACT no pr-check) | O `needs:` voltar no `fragile-guard` do pr-check.yml **no CI real** (o lado CI da Prova 15: a mesma injeção num `workflow_dispatch`, não só local) | `needs: check` no job `fragile-guard` do pr-check.yml REAL (branch scratch `ci-proof/guard-needs-ci`, 2af1c62) via **`ci-proof-run.mjs`** (o helper: ciclo prova-CI num comando) | Run [**31430040398**](https://github.com/severinno/severinno/actions/runs/31430040398) (`PR Check`, event `workflow_dispatch`, branch scratch) | ✅ conclusion=`failure`; job `check` (step Unit tests): `× REAL-REPO CONTRACT ... → expected 1 to be +0` (scan-guard-gates **E** run-precommit-guards — DOIS guards vermelhos) + `+ guard-gates: FRAGILE GUARD NEEDS in .github/workflows/pr-check.yml (needs: check ...)` no log (5×); ACHADO: o **pre-commit hook local bloqueou o commit da mutação** na 1ª tentativa (rule 5 = tripla: hook + CLI + REAL-REPO CONTRACT) → re-run com `HUSKY=0` (CI = autoridade); revertido byte-identical |
| 16 | Guard do push net — **multi-violação AGREGADA live** (`scan-guard-gates.mjs` rules 1-4, 6-9 no CLI real, repo REAL) | O CLI listar SÓ a primeira violação quando VÁRIAS regras estão quebradas ao mesmo tempo — o comportamento multi-violação como contrato (a Prova 15 provou rule 5; rules 1-4/6-9 só tinham prova sintética) | Run 1: guard-gates.yml DELETADO + pr-check.yml sem fragile-guard/fuzz/benchmark/utf8-check + ci.yml sem utf8-check + test:guard sem a suite (rules 1,3,4,6,7,8,9); Run 2: guard-gates.yml restaurado com `paths:` + sem o step test:guard (rules 2,3) | **Local** (prova de workflow REAL — o CLI + os arquivos reais, revert byte-identical via backup md5) | ✅ **Run 1**: exit 1 listando **8 sinais num único run** com os caminhos exatos (`WORKFLOW MISSING` guard-gates.yml, `TEST GUARD STEP MISSING` pr-check.yml, `FRAGILE GUARD JOB MISSING` pr-check.yml, `GUARD SUITE MISSING` package.json, `FUZZ JOB MISSING`, `BENCHMARK JOB MISSING`, `ENCODING CALL SITE MISSING` ci.yml + pr-check.yml); **Run 2**: exit 1 com `PATHS FILTER in guard-gates.yml:51` + `TEST GUARD STEP MISSING in guard-gates.yml` + as mesmas 6 do lado PR; revertido byte-identical (md5 + git diff vazio) |
| 17 | Pre-push — **integrity ANTES do fuzz mapeado** (simulação de pre-push real com node_modules divergente, sec. 11.19) | Um node_modules divergente gastar ~6-14s de fuzz mapeado ANTES de o integrity falhar — a ORDEM do hook decidida nas secs. 11.17/11.18 | `node_modules/react` instalado em 19.2.99 vs locked 19.2.3 num repo sintético via `NODE_MODULES_ROOT` + stdin de push REAL (1 ref não-deleção) no hook `.husky/pre-push` completo | **Local** (hook REAL; repo real intocado — fixtures em /tmp via `cygpath -w`, a classe 8.5 é local) | ✅ exit 1 com `DIVERGENT react installed=19.2.99 locked=19.2.3` + CURE como **última** saída; `run-mapped-fuzz` **nunca invocado** (0 execuções; as 6 menções a fuzz no log são nomes de gate files no ASCII-OK do verify-encoding); wall-clock 6.45s sem os ~6-14s do fuzz; controle: root clean → `clean (react/react-dom match bun.lock: 19.2.3/19.2.3; 0 extraneous)` exit 0 |
| 18 | Guard do push net — **GUARD GATES JOB NEEDS via push real** (`scan-guard-gates.mjs` rule 5, lado PUSH NET — o par da Prova 16 fechado no OUTRO lado da rede) | Um `needs:` voltar no job `guard-gates` do guard-gates.yml — pior que no PR: o guard-gates.yml tem UM único job, então um `needs: check` referencia job INEXISTENTE e o GitHub INVALIDA o workflow inteiro (o BASELINE nem chega a rodar — órfão total) | `needs: check` injetado no job `guard-gates` do guard-gates.yml REAL (branch scratch `ci-proof/guard-gates-needs`, 3742cfd sobre e1bd036 — o commit com a rule 5 estendida) + push REAL temporário a `develop` (o trigger `push: [main, develop]`; `main` dispararia deploy; `develop` é o caminho seguro da Prova 7) | Run [**31439238631**](https://github.com/severinno/severinno/actions/runs/31439238631) (Guard Gates, event `push`, branch `develop`) + Run [**31439239592**](https://github.com/severinno/severinno/actions/runs/31439239592) (CI/CD, event `push`, branch `develop`) | ✅ **Guard Gates**: failure em **0s** — `This run likely failed because of a workflow file issue` (o `needs: check` invalida o workflow no parse; o BASELINE não roda — a classe do órfão em dobro); **CI/CD (job Tests)**: `× REAL-REPO CONTRACT ... → expected 1 to be +0` (scan-guard-gates **E** run-precommit-guards REAL-REPO CONTRACT + GROWTH CONTRACTs — mesma raiz: o guard novo pega o `needs:` no arquivo real); **UTF-8 Check**: success (gate de encoding limpo, isolando a falha ao contrato); revertido byte-identical (md5 773542ee...) |
| 19 | ci-proof-run — **`--only-jobs` EARLY-EXIT live no CI real** (Prova 20, sec 11.20; o poll termina no JOB, não no run) | O ciclo de prova esperar o run INTEIRO (9:12 na referência 31430040398, dominado pelo Security Headers 9:08 — job sem relação com o sinal) mesmo quando o sinal vive num job (check 2:47): ~9min por prova quando ~3.5min bastam — o furo que o `--only-jobs` (sec 11.20) fechou no código, agora com prova viva | `needs: check` no job `fragile-guard` do pr-check.yml REAL (branch scratch `ci-proof/only-jobs-live`) via **`ci-proof-run --only-jobs check --expect failure --expect-log 'REAL-REPO CONTRACT'`** (o helper + a mutação conhecida da Prova 16, com `--no-verify` porque o pre-commit local bloqueia o commit da mutação) | Run [**31442006152**](https://github.com/severinno/severinno/actions/runs/31442006152) (`PR Check`, event `workflow_dispatch`, branch scratch) | ✅ **wall-clock do ciclo: 207.28s (~3.5min)** medido com `time -p` (branch scratch → mutação → push → dispatch → poll do job → captura job-scoped → verify → revert); helper **exit 0**; job `check`: `× REAL-REPO CONTRACT ... → expected 1 to be +0` no log capturado (o sinal exato; integrity + workflow-contracts no mesmo run); conclusion=`failure` como esperado; revertido byte-identical (pr-check.yml md5 a2d3aba4... + o delta uncommitted `--only-jobs` restaurado do backup md5-identical) |
| 20 | Guard do push net — **FUZZ JOB NEEDS + FUZZ STEP MISSING via CI real** (Prova 21, sec 8.16; `scan-guard-gates.mjs` rule 7, o lado CI da classe FUZZ — o par da Prova 17 fechado no pr-check real) | A classe FUZZ (needs: + step errado no job fuzz do pr-check.yml) ter prova só sintética — a Prova 17 provou a multi-violação AGREGADA local; faltava o lado CI: a MESMA injeção combinada num `workflow_dispatch` real, com o `Fuzz Tests: skipped` como prova viva do skip vector | `needs: check` + step `bun run fuzz:ci` trocado por `bun run lint` no job `fuzz` do pr-check.yml REAL (branch scratch `ci-proof/fuzz-needs-live`) via **`ci-proof-run --only-jobs check --expect failure --expect-log 'REAL-REPO CONTRACT' --no-verify`** | Run [**31444762608**](https://github.com/severinno/severinno/actions/runs/31444762608) (`PR Check`, event `workflow_dispatch`, branch scratch) | ✅ **wall-clock 206.76s (~3.5min)** com `time -p`; helper **exit 0**; job `check` (~2:51, 00:05:04→00:07:55) conclusion=`failure` com os DOIS sinais no log job-scoped: `guard-gates: FUZZ JOB NEEDS in .github/workflows/pr-check.yml (needs: check ...)` + `guard-gates: FUZZ STEP MISSING in .github/workflows/pr-check.yml (run: bun run fuzz:ci required ...)` + `scan-guard-gates.test.ts (30 tests | 1 failed)` (REAL-REPO CONTRACT); **`Fuzz Tests: skipped`** (00:07:55) — o `needs: check` fez o fuzz depender do check falho, o skip vector provado vivo; revertido byte-identical (11 arquivos do delta restaurados do backup md5-identical) |
| 21 | Guard do push net — **multi-violação AGREGADA via CI real** (Prova 22, sec 8.17; `scan-guard-gates.mjs` rules 1-4, 6-9 — o lado CI da Prova 17, que era local) | A Prova 17 provou a multi-violação AGREGADA no CLI real LOCALMENTE (8 sinais num run, repo real, revert byte-identical); faltava o lado CI: a MESMA injeção agregada num `workflow_dispatch` real, com o job check (REAL-REPO CONTRACT) **E** o batch runner (run-precommit-guards) falhando com os mesmos sinais | A MESMA injecao da Prova 17 Run 1 (guard-gates.yml DELETADO + pr-check.yml sem utf8-check/fuzz/benchmark/fragile-guard + ci.yml sem utf8-check + package.json test:guard sem scan-push-full-suite) via **`ci-proof-run --branch ci-proof/aggr-live --only-jobs check --expect failure --expect-log 'REAL-REPO CONTRACT' --no-verify`** (mutation script `scripts/prova22-mutate.mjs` TEMP, CRLF-safe + **self-delete** antes do `git add -A` — nunca entrou no commit scratch) | Run [**31446588931**](https://github.com/severinno/severinno/actions/runs/31446588931) (`PR Check`, event `workflow_dispatch`, branch scratch) | ✅ **wall-clock 204.91s (~3.4min)** com `time -p`; helper **exit 0**; job `check` conclusion=`failure` com **88 linhas `guard-gates:` no log job-scoped** — os **8 sinais** da agregacao (WORKFLOW MISSING + TEST GUARD STEP MISSING + FRAGILE GUARD JOB MISSING + GUARD SUITE MISSING + FUZZ JOB MISSING + BENCHMARK JOB MISSING + ENCODING CALL SITE MISSING ×2 + ENCODING WORKFLOW MISSING) — e as DUAS suites vermelhas: `scan-guard-gates.test.ts (30 tests | 1 failed)` (REAL-REPO CONTRACT, 1115ms) **E** `run-precommit-guards.test.ts (7 tests | 7 failed)` (o batch runner — TODOS os 7 guards vermelhos, incluindo o REAL-REPO CONTRACT do batch); os GROWTH CONTRACTs do workflow-contracts também vermelhos (mesma raiz: guard-gates.yml sumiu); revertido byte-identical (13 arquivos do delta restaurados do backup md5 **OK 13/13**; mutation script self-deletado; `git status` = delta original intacto) |
| 22 | Guard do veredito da 11.17 — **SEGUNDO NODE GUARD live** (`scan-prepush-batch.mjs`, o guard novo wired no batch do pre-commit) | O NEGATIVO INCONDICIONAL do REFINAMENTO da 11.17 (um 2º node guard no `.husky/pre-push` fora do `ALLOWED_NODE_GUARDS` falha MESMO com a nota ADOTADO — a LISTA é o pin estrutural, o espelho do HOOK_ALLOWLIST da 11.16) só tinha prova sintética (fixtures) | `node scripts/scan-new-guard.mjs` anexado ao `.husky/pre-push` REAL como linha 87 (backup md5 `74df8979...`) | **Local** — prova de hook REAL (o CLI + o batch runner + o REAL-REPO CONTRACT leem os arquivos reais; a rota sintética já está pinada pelos mutation tests) | ✅ CLI real: `SECOND NODE GUARD at .husky/pre-push:87: node scripts/scan-new-guard.mjs (... edit ALLOWED_NODE_GUARDS ...)` → **exit 1**; batch runner real (7º guard) **exit 1** com o mesmo sinal; vitest: **2 failed | 12 passed** — `DERIVATION PIN` (`expected [ 'check-push-deletion.mjs', …(3) ] to deeply equal [ 'check-push-deletion.mjs', …(2) ]`) + `REAL-REPO CONTRACT` (`expected 1 to be +0`); revertido byte-identical (md5 `74df8979...`) → CLI `clean` exit 0 + suíte 14/14 verde |
| 23 | Guard da agregação — **lado PUSH NET via push real** (Prova 24, sec 8.19; a MESMA agregação da Prova 22 no OUTRO lado da rede — o par fechado como as Provas 16/19 fizeram para o needs:) | O órfão TOTAL do push net: deletar o guard-gates.yml faz o GitHub NÃO criar run NENHUM do Guard Gates (o workflow some silenciosamente) e o ci.yml (o backstop do push) fica INVÁLIDO no parse porque build/budget ainda citam `needs: [..., utf8-check, ...]` — a agregação quebra o pipeline inteiro sem o guard sequer rodar | A MESMA injecao da Prova 22 (guard-gates.yml DELETADO + pr-check.yml sem utf8-check/fuzz/benchmark/fragile-guard + ci.yml sem utf8-check + test:guard sem scan-push-full-suite) via **push REAL temporario a develop** (branch scratch `ci-proof/aggr-push-live`, commit 70fe6c5; mutation script TEMP CRLF-safe self-delete — o ACHADO da sec 8.17) | Run [**31461526068**](https://github.com/severinno/severinno/actions/runs/31461526068) (`CI/CD`, event `push`, branch develop) + [31461526553](https://github.com/severinno/severinno/actions/runs/31461526553) (`UTF-8 Check`) | ✅ **CI/CD = failure com 0 jobs** (o workflow foi rejeitado no parse — build/budget ainda tem `needs: [..., utf8-check, ...]` mas o job foi removido = a classe (inferida) "workflow file issue" da Prova 18; nenhum job rodou, nem o REAL-REPO CONTRACT); **UTF-8 Check = success** (encoding limpo, isolando a falha ao contrato); **NENHUM run do Guard Gates criado para o sha 70fe6c5** (gh run list --workflow guard-gates.yml = vazio — o órfão total provado vivo: deletar o push net não deixa rastro de run); revertido byte-identical (md5 8/8, develop deletado, scratch deletada) |

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

## 8.1 Custo por push (medição 2026-08-09, re-medido 2026-08-10) — por que o no-filter continua

**Primeira medição** (breakdown por step do run 31336318902 — Prova 7, 2 suítes, 66 testes):

| Step | Tempo | Observação |
|---|---|---|
| Set up job | 1s | overhead fixo do runner |
| checkout | 4s | sempre roda |
| setup-bun | 2s | sempre roda |
| Cache node_modules (restore) | 11s | sempre roda |
| **Install deps** | 9s | `bun install --frozen-lockfile` |
| **Run guard vitest suites** | **4s** | `bun run test:guard` (66 testes, 2 suítes) |
| Post Cache (upload) | 10s | sempre roda |
| **Total job** | **~41s** | (45s com fila/overhead) |

**Re-medição 2026-08-10** (breakdown por step do run 31406545988 — prova viva com 8 suítes,
155 testes — push temporário a `develop`, mesmo método da Prova 7):

| Step | Tempo | Observação |
|---|---|---|
| Set up job | 1s | overhead fixo do runner |
| checkout | 8s | sempre roda |
| setup-bun | 2s | sempre roda |
| Cache node_modules (restore) | 15s | sempre roda |
| **Install deps** | ~0.5s | `bun install --frozen-lockfile` (cache hit → quase instantâneo) |
| **Run guard vitest suites** | **7s** | `bun run test:guard` (155 testes, 8 suítes: fragile-range-guard + golden-copy-utils + scan-push-full-suite + scan-lint-staged-loader + scan-guard-gates + fuzz-mapped + run-all-fuzz + scan-hook-parallel-race) |
| **Scan subprocess-heavy tests** | **0.8s** | `node scripts/scan-timeouts.mjs --ci` (step adicionado após a medição original) |
| Post Cache (upload) | 10s | sempre roda |
| **Total job** | **~45s** | (50s com fila/overhead; 5s a mais que a 1a medição — o crescimento deve-se ao cache mais lento + ~3s extras nos steps de vitest/scan-timeouts) |

**Re-medição 2026-08-11** (breakdown por step do run
[31453991361](https://github.com/severinno/severinno/actions/runs/31453991361) — prova viva com
**13 suítes / 236 testes** — push temporário a `develop` do estado atual da thread
(commit 6e347ce), mesmo método da Prova 7):

| Step | Tempo | Observação |
|---|---|---|
| Set up job | 1s | overhead fixo do runner |
| checkout | 3s | sempre roda |
| setup-bun | 2s | sempre roda |
| Cache node_modules (restore) | 14s | sempre roda |
| **Install deps** | ~1s | `bun install --frozen-lockfile` (cache hit → quase instantâneo) |
| **Run guard vitest suites** | **20s** | `bun run test:guard` (236 testes, 13 suítes: fragile-range-guard + fuzz-mapped + golden-copy-utils + guard-gates-exclusivity + manifest-registry + run-all-fuzz + scan-batch-coverage + scan-prepush-batch + scan-fuzz-precommit + scan-guard-gates + scan-hook-parallel-race + scan-lint-staged-loader + scan-push-full-suite) |
| **Scan subprocess-heavy tests** | ~1s | `node scripts/scan-timeouts.mjs --ci` |
| **Scan gate-script curls** | <1s | `node scripts/scan-curl-timeouts.mjs --ci` |
| **Scan string \n anchors** | <1s | `node scripts/scan-eol-anchor.mjs --ci` |
| **Total job** | **~43s** | job 02:58:57 → 02:59:40 — o crescimento das suítes (7s → 20s) foi absorvido pelo cache mais rápido + install ~0; total estável vs a re-medição anterior |

A re-medição 2026-08-11 confirma que a **conclusão não muda**: o custo REAL
das suítes subiu para **~22s de CI** (20s test:guard + ~2s dos 3 scanners)
— as suítes cresceram 8 → 13 (+62%) e os testes 155 → 236 (+52%), e o
custo do test:guard acompanhou (7s → 20s, ~2.9x) — mas o job continua
dominado pelo setup fixo (~20s: checkout + setup-bun + cache + post) que um
filtro `paths:` não reduziria, e o total por push ficou **estável** (~45s →
~43s). A economia máxima teórica de um filtro é ~22s por push que toca só
docs (o único push skipável sem perda) — e a superfície não cobre docs
mesmo. O net incondicional mantém o BASELINE estruturalmente garantido de
rodar em todo merge: o custo multiplicou ~3x (7s → 20s) enquanto as suítes
cresceram +62% e os testes +52% — crescimento que um filtro por superfície
derivada não conteria sem reintroduzir o ponto de drift que o SPREAD
CONTRACT elimina.

Ground truth local (Windows, cache quente, 2026-08-11):
`bun run test:guard` 41.2s (236 testes, 13 suítes; 1º run frio 57.5s, 2º
run warm 41.2s) + `node scripts/scan-timeouts.mjs --ci` 1.3s + `bun
install --frozen-lockfile` ~1.2s (warm).

**Decisão (avaliada, 2026-08-09, re-avaliada 2026-08-10 e 2026-08-11): o
no-filter documentado continua correto.** Um filtro `paths:` por superfície
de gate file teria que replicar a superfície derivada (`TARGET_DIRS` + gate
files) num segundo lugar — um novo ponto de drift (a classe que o SPREAD
CONTRACT elimina) — e um push tocando só uma árvore que o filtro esqueceu
skiparia o net em silêncio: o risco de órfão que o workflow existe para
fechar. Com o guard net custando ~22s de CI (20s test:guard + ~2s dos
scanners), a economia máxima teórica de um filtro é ~22s por push que toca
a superfície — e o único push skipável sem perda seria um docs-only (que a
superfície não cobre mesmo). O net incondicional mantém o BASELINE
estruturalmente garantido de rodar em todo merge; o crescimento das suítes
(8 → 13) não mudou a equação: o total por push permaneceu estável (~43s).

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

### RE-MEDIÇÃO 3 — pós Type F (28ab2c8), fuzz:ci batchado medido (medição 2026-08-10, hook REAL end-to-end)

A RE-MEDIÇÃO 2 mediu em `93eb00e`; esta re-mede no HEAD pós-migração
(`28ab2c8` — single-package-manager bun + integridade extraneous), mesmo
cenário e mesmo método (worktree scratch + touch benigno em
`src/lib/radius-expansion.ts` + hook real com stdin sintético, remote sha
= base). O fuzz:ci BATCHADO (11.12) foi medido à parte nesta sessão:
`bun run fuzz:ci` = **16.63s** local (o 26.16s citado era a medição
11.12; a máquina variou para baixo — o baseline same-session da 11.12 já
tinha registrado 13.01s).

| Gate (ordem real do hook) | RE-MEDIÇÃO 3 (28ab2c8) | RE-MEDIÇÃO 2 (93eb00e) |
|---|---|---|
| verify-encoding | **4.77s** | 3.37s |
| check-docs-encoding | **0.82s** | 0.65s |
| check-node-modules-integrity | **0.31s** | 0.17s |
| fuzz MAPEADO (radius tocado → 2 suites, 16 testes) | **7.50s** | 4.62s |
| pre-push:gates (Gate 1+2+3, 1 teste mapeado, 18 testes) | **6.52s** | 4.53s |
| **Total hook E2E (exit 0)** | **30.90s cold → 17.85s → 17.42s warm** | 22.46s cold → 13.69s warm |

Soma per-gate ~19.9s vs E2E warm 17.42s (a diferença é o boot por-spawn
nas medições isoladas + a cadeia do hook compartilhar alguns boots) — a
ordem de grandeza é a mesma. Os números subiram vs a RE-MEDIÇÃO 2 (~+3-4s
total): estado de máquina + a camada EXTRANEOUS nova da integridade
(~+0.14s) — não é regressão de hook (a cadeia é a mesma; o diff real do
push de lib é idêntico). **O balanceamento se mantém**: nenhum gate
isola domina (4.8 + 7.5 + 6.5).

**Veredito**: total por push ~**17.4s warm** (típico de lib) — vs os ~82s
do pior caso (gate files) e os ~74s originais (fuzz:ci 53s). O Gate 3
mapeado se MANTÉM; o CI fresco continua a autoridade. O piso real do hook
é ~17s, não ~13.7s — o número da RE-MEDIÇÃO 2 era o mesmo cenário com
máquina mais livre; a faixa honesta para o push típico de lib é
**~13.7-17.4s** dependendo do estado de máquina.

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

## 8.9 Prova 12 — fuzz:ci BATCHADO live no CI real (dispatch do pr-check, run 31397642499, 2026-08-10)

A adoção da 11.12 trocou o `run-all-fuzz.mjs` de 6 spawns (~60s) por UMA
invocação vitest única (`--reporter=json` + split por suite, seção 11.12) —
mas a mudança nunca tinha sido validada no CI DE VERDADE. Prova viva no
fluxo estabelecido (namespace `ci-proof/*`, Type E = push não dispara nada):

1. Branch `ci-proof/fuzz-batch` criada em `28ab2c8` (o HEAD da thread — a
   ÚNICA ref com o `run-all-fuzz.mjs` batchado; `origin/release/v0.4.0`
   pré-data a adoção) e empurrada (pre-push hook local passou; Type E
   garante que o push não disparou nenhum workflow — o dispatch é manual).
2. `gh workflow run pr-check.yml --ref ci-proof/fuzz-batch` → **run
   31397642499** (dispatch OK: o workflow existe no default branch, o
   pré-requisito da Prova 7).
3. Job **`Fuzz Tests` = success**: o log confirma o runner NOVO —
   `$ node scripts/run-all-fuzz.mjs --json` (não o spawn por suite), com o
   banner do runner e o artifact `fuzz-results.json` arquivado (artifact ID
   9066288893). Job completo em ~47s (checkout + bun install inclusos).

Os dois jobs failure do run (`check` — dívida de lint pré-existente; e
`Security Headers` — o flake documentado) são ALHEIOS à prova: o job fuzz
roda independente e passou com o runner novo. Suites verdes no mesmo run:
Fragile Range Guard, Geo Benchmark, utf8-check, Docs Encoding.

**Gap fechado**: a 11.12 tinha medido o batching LOCALMENTE (40.4s →
14.45s); agora o CI real confirma que o job `fuzz:ci` executa o runner
batchado e passa — a rede que autoridade o Gate 2 mapeado do pre-push
(11.11) roda o formato novo de ponta a ponta. Reversão completa: branch
remota + local deletadas, `git status` limpo.

## 8.10 Prova 13 — pr-check COMPLETO do estado atual no CI real (run 31411254090, 2026-08-10)

- **Gate sob prova**: o `pr-check.yml` INTEIRO com o estado atual da thread
  — 8 suítes `test:guard` (incl. batch runner 11.13, contrato co-location
  11.15, merge PROOF+CONTRACT 11.14), fuzz:ci batchado (11.12), guards de
  contrato — para confirmar os TEMPOS REAIS dos jobs no CI (a re-medição
  8.1/8.4/11.x foi local) e se o estado atual roda verde de ponta a ponta.
- **Run**: [31411254090](https://github.com/severinno/severinno/actions/runs/31411254090)
  (`PR Check`, event `workflow_dispatch`, branch scratch
  `ci-proof/pr-check-live` @ 7b6ebd7 = commit do estado da thread sobre
  28ab2c8).
- **Disparo**: branch scratch criado com o estado UNCOMMITTED da thread
  (stash → branch → apply → commit → push `--no-verify`) + `gh workflow
  run "PR Check" --ref ci-proof/pr-check-live`. Reversão completa após a
  extração: stash pop (trabalho da thread restaurado no branch principal
  byte-identical), branch remota + local deletadas, `git status` igual ao
  pré-prova.

### Tempos reais por job/step (timestamps do log do run)

| Job | Step | Tempo real | Veredito |
|---|---|---|---|
| Fragile Range Guard | Run guard vitest suites | **9s** (16:53:51 → 16:54:00) | ✅ **158 testes / 8 suítes** |
| Fragile Range Guard | Scan subprocess-heavy tests | <1s | ✅ |
| Fuzz Tests | Run fuzz tests (batchado) | **10s** (16:53:57 → 16:54:07) | ✅ runner novo |
| check | Unit tests | **47s** | ❌ 3 files / 6 testes (ACHADOS abaixo) |
| check | Lint | 60s | ❌ 1 erro PRÉ-EXISTENTE (`use-balance-pulse.ts:49`) |
| check | Type check | 32s | ✅ |
| utf8-check | (reusable) | 14s | ✅ |
| Docs Encoding | (informativo) | 8s | ✅ |
| Geo Benchmark | (baseline vs main) | 51s | ✅ |
| Security Headers | (curl prod) | 7s | ❌ PRÉ-EXISTENTE (DNS→WordPress, docs/security-headers-gate-2026-08.md) |

**Confirmações vs premissas do pedido**: test:guard citado como "148
TESTES" — o real no estado atual é **158** (148 + 7 do batch runner +
3 do contrato co-location), verde em **9s** no CI; fuzz:ci batchado
estimado ~14s — real **10s** no step (job total 46s com install/cache).

### ACHADO 1 (real, plataforma): integrity guard EXTRANEOUS falso-positivo no Linux

**5 dos 6 testes vermelhos têm a MESMA causa raiz**: o
`check-node-modules-integrity` BASELINE + o REAL-REPO CONTRACT e os 3
AGREGACAO/ISOLAMENTO do `run-precommit-guards` (o batch runner agrega o
worst-exit do integrity guard). No CI Linux, `bun install
--frozen-lockfile` hoista deps opcionais/platform-específicas para o
TOP-LEVEL do node_modules:

```
check-node-modules-integrity: EXTRANEOUS @napi-rs/lzma-linux-x64-gnu
  installed at node_modules/@napi-rs/lzma-linux-x64-gnu but NOT in bun.lock
check-node-modules-integrity: EXTRANEOUS @tabby_ai/hijri-converter
  installed at node_modules/@tabby_ai/hijri-converter but NOT in bun.lock
```

No Windows local essas dirs NÃO existem (deps opcionais só do Linux) → o
guard fica verde local e vermelho no CI: a classe é a comparação "0
extraneous top-level" contra o set de DIRETAS do package.json — precisa
comparar contra o set COMPLETO do lock (incluindo opcionais/transitivas
hoistadas). **Follow-up**: corrigir o guard para ignorar deps do lock
não-diretas hoistadas (ou pinar o falso-positivo no teste) e re-provar.

### ACHADO 2 (real, ambiente): blame-ignore-revs falha em checkout SHALLOW

O teste `every listed hash resolves to a real commit in this repo`
(`blame-ignore-revs.test.ts:121`, `expected false to be true`)
roda verde local (8/8) e vermelho no CI: o job `check` usa
`actions/checkout@v4` SEM `fetch-depth: 0` → clone shallow (depth 1) → os
commits antigos listados no `.git-blame-ignore-revs` (2fa5e48, f17ffdd)
não existem no clone → `git rev-parse` falha → `commitExists` false. **O
job benchmark já usa fetch-depth: 0; o check job precisa do mesmo** (ou o
teste deve detectar shallow e skipar honesto). **Follow-up**: adicionar
`fetch-depth: 0` ao checkout do job check e re-provar.

### Veredito honesto

Os TEMPOS da re-medição local foram CONFIRMADOS no CI (test:guard 158 em
9s, fuzz batchado 10s — bem abaixo do pior caso 77.58s da 8.4), mas a
prova revelou que **o estado atual NÃO está 100% verde no CI Linux**: 2
classes reais de plataforma (EXTRANEOUS falso-positivo de opcionais
hoistadas; blame em shallow clone) + 2 falhas pré-existentes documentadas
(Lint use-balance-pulse:49, Security Headers). Os 2 achados viram
follow-ups de fix com re-prova — exatamente o valor da prova viva: a
re-medição local sozinha teria deixado o estado vermelho no CI
silenciosamente.

## 8.11 Prova 14 — SPEC-FORMAT contract live (manifest REAL, local, 2026-08-10)

**Pergunta da prova:** o count-pin `registry === 98` do teste SPEC-FORMAT
contract (que lê o `package.json` REAL do repo) pega de verdade um spec
não-registry novo entrando no manifest — ou só a fixture sintética trip?
O contrato (8.10 da tabela acima) já provava a consequência CLI com repo
sintético via `NODE_MODULES_ROOT`; esta prova fecha o OUTRO lado: o
manifest real vivo.

**Injeção (branch scratch `ci-proof/spec-format` @ 2af1c62, do HEAD da
thread):** `"custom-pkg": "custom:foo@1.0.0"` adicionado ao
`devDependencies` do `package.json` real. O spec `custom:foo@1.0.0` NÃO
casa com a fronteira `lockKeyFor` (`/^(workspace:|link:|file:|git(?:[+:@]|$)|github:|http)/`)
e não é `npm:` — exatamente a classe "undecided" que o contrato pina:
ele passa pelo classificador como se fosse nome registry, então o que
tripa é o COUNT-PIN (98 → 99) no teste e o fail-safe UNVERIFIABLE no CLI.

**Sinais capturados (todos com a injeção no ar):**

```
$ node scripts/check-node-modules-integrity.mjs --check-lock
check-node-modules-integrity: --check-lock UNVERIFIABLE custom-pkg - resolved version not found in bun.lock (lock format changed? update the guard)
CLI_EXIT=1

$ npx vitest run scripts/__tests__/check-node-modules-integrity.test.ts --config vitest.config.unit.ts -t SPEC-FORMAT
× SPEC-FORMAT contract: every direct dep spec today is registry (98/98, 0 weird)...
  → AssertionError: expected 99 to be 98 // Object.is equality
  ✓ SPEC-FORMAT mutation (CLI level): ... exit 1 UNVERIFIABLE, NEVER silent clean (104ms)
      Tests  1 failed | 1 passed | 26 skipped (28)

$ npx vitest run ... -t BASELINE
× BASELINE: real repo (no env override) --check-lock -> exit 0, ALL 98 direct packages...
  → AssertionError: expected 1 to be +0 // Object.is equality
  ✓ BASELINE: real repo (no env override) -> exit 0, react/react-dom... (168ms)
      Tests  1 failed | 1 passed | 26 skipped (28)
```

Leitura dos sinais:
1. **CLI real exit 1** — a consequência viva do fail-safe: spec undecided
   vira chave grep-able que não existe no lock → `UNVERIFIABLE custom-pkg`
   com o caminho exato (nunca clean silencioso).
2. **SPEC-FORMAT contract `expected 99 to be 98`** — o count-pin é o que
   pega a regressão REAL no manifest: o classificador sozinho não distingue
   `custom:foo@1.0.0` de nome registry (a mutation do mesmo teste prova
   isso hermeticamente), então sem o pin o contrato ficaria mudo.
3. **BASELINE `expected 1 to be +0`** — o mesmo count-pin no teste do
   manifest vivo; o default-mode BASELINE (par react/react-dom) segue
   verde, isolando a falha ao `--check-lock`.

**Revert (byte-identical):** a linha injetada foi removida e o `git diff
package.json | md5sum` voltou a `30a16a0f...` (igual ao baseline pré-
injeção). Pós-revert: `-t "SPEC-FORMAT|BASELINE"` → **4/4 verde** e o CLI
real → `--check-lock clean (98 direct packages match bun.lock; 0 skipped
non-registry)` exit 0. Branch scratch deletado (remoto nunca tocado).

**Veredito:** o contrato SPEC-FORMAT pega regressão REAL no manifest (o
count-pin 98 e o fail-safe UNVERIFIABLE, em camadas), não só fixture — a
prova viva fecha a pergunta "quem protege o manifest?" para o caso
undecided. Sem run number de CI (prova local, como a Prova 6/9/11); a
mesma injeção num workflow_dispatch do pr-check produziria a falha
idêntica no job `check` (test:unit roda a suíte) — não repetido por
custo/ruído, já que a prova local exercita exatamente o mesmo código.

## 8.12 Prova 15 — FRAGILE GUARD NEEDS live (workflow REAL, local, 2026-08-10)

**Pergunta da prova:** o contrato rule 5 do scan-guard-gates (o job
`fragile-guard` do pr-check.yml NÃO pode ter `needs:`) pega de verdade um
`needs:` voltando ao workflow REAL — ou só a fixture sintética trip? O
mutation test hermético já provava o comportamento em repo sintético; esta
prova fecha o OUTRO lado: os arquivos reais que o CLI e o REAL-REPO
CONTRACT leem.

**Injeção (branch scratch `ci-proof/guard-needs` @ 2af1c62, do HEAD da
thread):** `needs: check` inserido como primeira propriedade do job
`fragile-guard:` (linha 302 do pr-check.yml real), antes de `name:`.

**Sinais capturados (todos com a injeção no ar):**

```
$ node scripts/scan-guard-gates.mjs
guard-gates: FRAGILE GUARD NEEDS in .github/workflows/pr-check.yml (needs: check - o job standalone nao pode depender de outro; um needs: cria o skip vector da classe que o job existe para fechar)
guard-gates: guard-gates.yml + pr-check.yml (fragile-guard + fuzz) must run incondicionalmente (no paths filter, no needs:) com o test:guard completo (scan-push-full-suite incluso) - a premissa da recalibracao 8.4/11.11
CLI_EXIT=1

$ npx vitest run scripts/__tests__/scan-guard-gates.test.ts --config vitest.config.unit.ts
✓ MUTATION: job fragile-guard com needs: check -> exit 1 com 'FRAGILE GUARD NEEDS' (120ms)  [hermético, segue verde]
× REAL-REPO CONTRACT: ... pr-check.yml com o job fragile-guard -> exit 0 (regressao futura falha aqui)
  → AssertionError: expected 1 to be +0 // Object.is equality
      Tests  1 failed | 17 passed (18)
```

Leitura dos sinais:
1. **CLI real exit 1** — o contrato lê os arquivos reais e sinaliza o
   `needs: check` com o caminho exato (`.github/workflows/pr-check.yml`) e
   o valor (`needs: check`) — nunca silencioso.
2. **REAL-REPO CONTRACT `expected 1 to be +0`** — o teste que pina o estado
   real do repo quebra ao vivo; o mutation hermético do mesmo contrato
   segue verde, provando que a detecção não depende do fixture.
3. O resto da rede (workflow presente, sem paths filter, test:guard step,
   fuzz job standalone) permanece intacto — a falha é isolada à rule 5.

**Revert (byte-identical):** a linha injetada foi removida e o md5 do
pr-check.yml voltou a `a2d3aba4...` (igual ao baseline pré-injeção).
Pós-revert: CLI → `guard-gates: clean (... fragile-guard job present
without needs: ...)` exit 0; suíte → **18/18 verde**. Branch scratch
deletado (remoto nunca tocado).

**Veredito:** o contrato FRAGILE GUARD NEEDS pega regressão REAL no
workflow (o skip vector do lint não volta em silêncio), não só fixture — a
prova viva fecha a pergunta "quem protege a imunidade do job guard?" para
o lado vivo. Sem run number de CI (prova local, como a Prova 6/9/11/14); a
mesma injeção num workflow_dispatch do pr-check não mudaria o sinal — o
scan-guard-gates roda nas suítes de guard de ambos os jobs (check via
test:unit, guard via test:guard), e a prova local exercita exatamente o
mesmo código. **Confirmação posterior (Prova 16, sec 8.13):** o sinal NO CI
real bateu com a previsão — run 31430040398, conclusion=failure, `FRAGILE
GUARD NEEDS` no log do job `check`; o custo/ruído que justificava não repetir
caiu quando o `ci-proof-run.mjs` (o helper) automatizou o ciclo.

## 8.13 Prova 16 — FRAGILE GUARD NEEDS live via CI real (workflow_dispatch do pr-check, 2026-08-10)

**Pergunta da prova:** a Prova 15 (8.12) fechou o lado local (CLI + REAL-REPO
CONTRACT sobre os arquivos reais) com veredito "sem run number de CI — o
dispatch não mudaria o sinal". Esta prova fecha o OUTRO lado com o CI real:
workflow_dispatch do pr-check com a MESMA injeção `needs: check`, usando o
`ci-proof-run.mjs` (o helper que automatiza o ciclo prova-CI — branch scratch
→ mutate → push → dispatch → poll → capture → verify → revert, com Type E e
a Prova 7 travadas).

**Injeção (branch scratch `ci-proof/guard-needs-ci` @ 2af1c62, do HEAD da
thread):** `needs: check` como primeira propriedade do job `fragile-guard:`
do pr-check.yml real (linha 302, antes do `name:` — a MESMA mutação da Prova
15), via `--mutate "node scripts/prova16-mutate.mjs"` do helper (script
temporário EOL-preserving, criado só para a prova e removido no revert).

**ACHADO 1 — a camada local bloqueou o commit da própria mutação (na 1ª
tentativa):** o `git commit` do helper disparou o pre-commit hook completo —
e o batch runner (`run-precommit-guards.mjs`, que inclui o `scan-guard-gates`
no batch da sec 11.13/11.16) pegou o `needs: check` injetado e falhou a cadeia
(`guard-gates: FRAGILE GUARD NEEDS ...` + husky exit 1) ANTES do push. Ou
seja: a rule 5 tem **tripla proteção** — o hook local já impede o commit de um
`needs:` no pr-check.yml. Para a prova do lado CI, o commit precisou de
`HUSKY=0` (o bypass oficial do husky: o shim `.husky/_/h` tem
`[ "${HUSKY-}" = "0" ] && exit 0`) — o CI é a autoridade e a prova é sobre o
CI, não sobre o hook (que já estava provado localmente).

**Travado (2026-08-10):** o helper `ci-proof-run.mjs` ganhou a flag
`--no-verify` — o HUSKY=0 virou first-class (seta `HUSKY=0` no env de TODOS
os spawns do ciclo: commit + push + push --delete), com o wiring provado por
E2E hermético (`husky.log` do fixture: o triplo git de escrita herda o env) e
a cadeia do trip pinada por REAL-REPO CONTRACT (`.husky/pre-commit` →
`run-precommit-guards.mjs` → `scan-guard-gates`). O próximo usuário não
redescobre o bloqueio: `--no-verify` é a resposta documentada na própria
usage do helper.

**Sinais capturados no CI (run 31430040398, log com 5686 linhas):**

```
check · Unit tests: × scan-guard-gates.mjs - push net guard-gates.yml incondicional (sec 8.4/11.11) >
  REAL-REPO CONTRACT: guard-gates.yml real sem paths filter + ... -> exit 0 (regressao futura falha aqui)
     → expected 1 to be +0 // Object.is equality
check · Unit tests: × run-precommit-guards.mjs - batch runner dos 4 guards node (sec 11.13) >
  REAL-REPO CONTRACT: sem env override -> exit 0, TODOS os 4 veredictos clean na ORDEM do hook
     → expected 1 to be +0 // Object.is equality
check · Unit tests: + guard-gates: FRAGILE GUARD NEEDS in .github/workflows/pr-check.yml
  (needs: check - o job standalone nao pode depender de outro; um needs: cria o skip vector
  da classe que o job existe para fechar)   [4× no diff do assertion + 1× no titulo do teste hermetico]
```

Leitura dos sinais:
1. **conclusion = `failure`** — o run inteiro caiu; o `--expect failure
   --expect-log "REAL-REPO CONTRACT"` do helper casou (`verify:
   conclusion=failure + log casou`).
2. **DOIS REAL-REPO CONTRACTs vermelhos no job check** — não só o
   `scan-guard-gates`: o `run-precommit-guards` (o batch runner) também varre
   o workflow real e saiu 1 — o mesmo furo pego por DOIS guards independentes
   no CI (defesa em profundidade: o guard da rede e o guard do batch).
3. **A linha exata do CLI no log do CI** (`FRAGILE GUARD NEEDS in
   .github/workflows/pr-check.yml (needs: check ...)`) — o stdout do guard
   aparece **4× no diff do assertion** (o teste imprime o output recebido) + 1×
   no título do teste hermético (que segue verde) — o caminho exato provado
   no CI, não só local.
4. **O mutation hermético seguiu verde** (`✓ MUTATION: job fragile-guard com
   needs: check -> exit 1 com 'FRAGILE GUARD NEEDS'`) — a detecção não
   depende de fixture.

**Revert (byte-identical):** o helper revertiu sozinho — remote
`ci-proof/guard-needs-ci` deletado, de volta a
`freebuff/new-thread-thmsitz5qutoia`, branch local deletada. O pr-check.yml
pós-revert com **0 ocorrências de `needs: check`**. O working tree voltou
exatamente ao estado pré-prova (o delta de 25 arquivos da thread estava
stasheado durante a prova e foi reposto; `git status --porcelain` bate 1:1
com o snapshot pré-prova).

**Veredito:** a Prova 15 (local) + esta Prova 16 (CI real, run 31430040398)
fecham o par: o contrato FRAGILE GUARD NEEDS pega o `needs:` nos DOIS lados,
com o caminho exato no log do CI. Bônus estrutural da 1ª tentativa: o
pre-commit hook local também bloqueia o commit do furo — a rule 5 é tripla
(hook local + CLI + REAL-REPO CONTRACT). Com o `ci-proof-run.mjs`, a prova
completa virou UM comando (run number no summary, log capturado no tmpdir,
revert automático) — o padrão manual das Provas 6-12 não precisa voltar.

## 8.14 Prova 17 — multi-violação AGREGADA live (rules 1-4, 6-9 no CLI real, local, 2026-08-10)

- **Gate**: `scripts/scan-guard-gates.mjs` — o guard do CONTRATO do push net
  (rules 1-9). A Prova 15 provou a rule 5 (FRAGILE GUARD NEEDS) ao vivo; as
  rules 1-4 e 6-9 (workflow presente, no paths filter, test:guard step, job
  fragile-guard presente, guard suite no test:guard, fuzz job standalone,
  encoding call sites, benchmark job) só tinham prova **sintética** (fixtures
  herméticas). Esta prova injeta TODAS as violações de uma vez no repo real e
  confirma que o CLI lista todas com os caminhos exatos — o comportamento
  multi-violação vira contrato.
- **Run 1 (rules 1,3,4,6,7,8,9)** — mutação via `scripts/prova17-mutate.mjs`
  (TEMP, deletado após a prova): guard-gates.yml DELETADO (rule 1: WORKFLOW
  MISSING — o net não pode sumir); pr-check.yml reescrito SEM os jobs
  utf8-check/fuzz/benchmark/fragile-guard (rules 4,7,9 + encoding call site);
  ci.yml sem o call site utf8-check (rule 8); `package.json` test:guard sem a
  suite scan-push-full-suite (rule 6). CLI real → exit 1 com **8 sinais no
  MESMO run**, cada um com o caminho exato:

```
guard-gates: WORKFLOW MISSING - .github/workflows/guard-gates.yml nao existe (a guard net, sec 8.4/11.11)
guard-gates: TEST GUARD STEP MISSING in .github/workflows/pr-check.yml (run: bun run test:guard required - the guard net, sec 8.4/11.11)
guard-gates: FRAGILE GUARD JOB MISSING in .github/workflows/pr-check.yml:? (job fragile-guard: required - o twin PR do push net, sec 8.4/11.11)
guard-gates: GUARD SUITE MISSING in package.json test:guard (scan-push-full-suite.test.ts required - the 8.4 REAL-REPO CONTRACT lock)
guard-gates: FUZZ JOB MISSING in .github/workflows/pr-check.yml (job fuzz: required - a autoridade fuzz:ci batchado, sec 11.11/11.12, standalone em qualquer PR)
guard-gates: BENCHMARK JOB MISSING in .github/workflows/pr-check.yml (job benchmark: required - o gate geo do merge path, sec scan-surfaces.md Type C - auditoria da rede 2026-08)
guard-gates: ENCODING CALL SITE MISSING in .github/workflows/ci.yml (job utf8-check: com uses: ./.github/workflows/utf8-check.yml required - o gate de encoding, sec scan-surfaces.md Type C - auditoria da rede 2026-08)
guard-gates: ENCODING CALL SITE MISSING in .github/workflows/pr-check.yml (job utf8-check: com uses: ./.github/workflows/utf8-check.yml required - o gate de encoding, sec scan-surfaces.md Type C - auditoria da rede 2026-08)
```

  O CLI NÃO short-circuita na primeira violação — reporta TODAS, provando o
  contrato multi-violação (um refactor futuro que pare no primeiro erro
  quebraria esta prova E o teste MUTATION COMBINADA da suíte).
- **Run 2 (rules 2,3)** — o par rule 1 ⊥ rule 2 é mutuamente exclusivo por
  construção (deletar o arquivo = WORKFLOW MISSING; manter com paths = PATHS
  FILTER — a mesma exclusividade da rule 4 ⊥ 5). O Run 2 restaura o
  guard-gates.yml do backup e injeta `paths:` no on.push (rule 2) + remove o
  step `run: bun run test:guard` (rule 3); pr-check/ci/pkg permanecem no
  estado do Run 1. CLI real → exit 1 com:

```
guard-gates: PATHS FILTER in .github/workflows/guard-gates.yml:51: paths:
guard-gates: TEST GUARD STEP MISSING in .github/workflows/guard-gates.yml (run: bun run test:guard required - the guard net, sec 8.4/11.11)
```

  + as mesmas 6 linhas do lado PR (FRAGILE GUARD JOB MISSING, GUARD SUITE
  MISSING, FUZZ JOB MISSING, BENCHMARK JOB MISSING, ENCODING CALL SITE MISSING
  ci.yml + pr-check.yml). O `PATHS FILTER` veio com file:line exato
  (`:51` — a linha real do paths: no on.push após a injeção).
- **Cobertura fechada**: entre os dois runs, TODAS as rules 1-9 têm prova
  viva no repo real (rule 5 já tinha a Prova 15; as demais agora também). A
  exclusividade estrutural rule 1 ⊥ rule 2 (e rule 4 ⊥ rule 5) é a razão dos
  DOIS runs — não um gap.
- **ACHADO de método**: o guard-gates.yml real é CRLF no working tree (git
  autocrlf) — a 1ª tentativa de injeção com âncora `\n` falhou silenciosamente
  (o replace não casou no `\r\n`); o script passou a normalizar para LF antes
  das substituições (o restore via `git checkout`/backup devolve o estado
  git-canonical, confirmado por md5 + `git diff` vazio).
- **Reversão**: `git checkout` dos 4 arquivos + `rm scripts/prova17-mutate.mjs`;
  md5 byte-identical vs o snapshot pré-prova (guard-gates.yml
  `773542ee...`, pr-check.yml `a2d3aba4...`, package.json `2d158d31...`; o
  ci.yml difere no md5 cru por normalização de EOL LF→CRLF do git, mas `git
  diff` vazio confirma a árvore idêntica — único arquivo modificado: o teste
  FUZZ combinado da thread, pré-existente).
- **Gap protegido**: um futuro refactor que faça o guard parar na PRIMEIRA
  violação (early-return) deixaria de listar as demais — a classe que esta
  prova (e o teste MUTATION COMBINADA da suíte) trava.

### 8.14.1 CONTRATO DERIVADO da matriz de exclusividade (prova vitest, 2026-08-10)

A sec 8.14 documentava as exclusividades em prosa — "rule 1 ⊥ rule 2 e rule
4 ⊥ rule 5 mutuamente exclusivos por construção" — como a razão dos DOIS
runs (deletar o arquivo = WORKFLOW MISSING; manter com paths = PATHS
FILTER). Esta subseção transforma a prosa em **contrato DERIVADO**: a suíte
`scripts/__tests__/guard-gates-exclusivity.test.ts` (15 testes, wired no
`test:guard` — roda no push net e no twin PR) deriva a matriz do próprio
código e valida a prosa contra ela.

**Mecanismo** (a classe de drift que a suíte elimina): o guard foi
refatorado para expor `emittedSignals(facts, ctx)` — a MESMA função de
emissão que o `main()` do CLI consome (o CLI é byte-identical, pinado pelos
30 testes de stdout do scan-guard-gates.test.ts). A suíte de exclusividade
enumera o ESPAÇO ALCANÇÁVEL de resultados do scan (um modelo documentado
das invariantes estruturais do scanGuardGates, ~112k estados — cada
restrição citada ao código que espelha), roda `emittedSignals` em cada
estado, computa co-ocorrência e deriva o conjunto EXCLUSIVO (pares que
nunca co-emitem num único scan): **45 pares** pinados num SNAPSHOT (regra:
regenere do modelo, nunca ajuste à mão para casar a doc).

**Validações da prosa (sec 8.14)**:
- rule 4 ⊥ rule 5: FRAGILE GUARD JOB MISSING ⊥ FRAGILE GUARD NEEDS —
  DERIVADO e validado (needs implica present: o prGuardJob só seta needs
  dentro do bloco do job).
- rule 1 ⊥ rule 2 — REFINAMENTO honesto derivado: a exclusividade é
  POR-ALVO, não global. A forma precisa (WORKFLOW MISSING@guard-gates.yml ⊥
  PATHS FILTER — o scan de paths só roda se o arquivo existe) vale; a forma
  global (WORKFLOW MISSING@pr-check.yml ⊥ PATHS FILTER) NÃO vale — deletar o
  twin não remove o scan de paths do push net, os dois co-emitem num scan.
  Anchors REAIS em fixtures de disco provam o modelo contra o scan real
  (padrão hermético + REAL da rede).

**Invariantes modelados (com a fonte no guard)**: missingWorkflow é o
PRIMEIRO ausente na ordem do guardNet (push antes do twin); missingStep@push
depende do step NO ARQUIVO (file-level) e não do job guard-gates existir (o
fallback de stepPresent do prGuardJob é twin-only — a divergência de modelo
corrigida nesta thread); needs/stepPresent só dentro de bloco de job
presente; encodingBad carrega UM kind por rel (workflow/job/step/needs) —
por isso as 4 signals de encoding são pairwise-exclusivas POR-REL mas
coexistem across rels.

**Fecho da classe**: qualquer rule change que altere UMA exclusividade (novo
sinal, condição de emissão mudada, job renomeado) quebra o SNAPSHOT de 45
pares — a matriz documentada deixa de ser prosa e vira pin testado, no
padrão dos demais contratos derivados da rede.

**Re-validação**: `NO_COLOR=1 npx vitest run
scripts/__tests__/guard-gates-exclusivity.test.ts --config
vitest.config.unit.ts` → 15/15; guard byte-identical: `npx vitest run
scripts/__tests__/scan-guard-gates.test.ts --config vitest.config.unit.ts`
→ 30/30.

## 8.15 Prova 19 — GUARD GATES JOB NEEDS live via push REAL a develop (o par da Prova 16 fechado no push net, 2026-08-10)

- **Gate**: `scripts/scan-guard-gates.mjs` rule 5 — agora cobre os DOIS lados
  da rede (a extensão desta thread): o twin do PR (`fragile-guard` no
  pr-check.yml, Prova 15/16) E o job `guard-gates` do próprio push net
  (`guard-gates.yml`). O job key do push net é um fato do manifest
  (`GUARD_NET_PUSH_JOB` em workflow-contracts.mjs, consumido pelo guard via
  `pushNetJobKey`), e o guard emite `GUARD GATES JOB MISSING` / `GUARD GATES
  JOB NEEDS` para o workflow do push.
- **Por que o push net é pior que o PR**: o guard-gates.yml tem UM ÚNICO job
  (`guard-gates`) — um `needs: check` referencia um job que NÃO EXISTE no
  workflow, e o GitHub **invalida o workflow inteiro no parse** (a run nem
  cria jobs). O BASELINE de 0 offenders fica órfão em DOBRO: o job não roda
  por injeção direta E o workflow inteiro é descartado pelo GitHub. A
  IMMUNITY a skip do push net (standalone, sem `needs:`) não é só
  cosmética — é o que mantém o workflow parseável.
- **Runs**: [31439238631](https://github.com/severinno/severinno/actions/runs/31439238631)
  (workflow `Guard Gates`, event `push`, branch `develop`) +
  [31439239592](https://github.com/severinno/severinno/actions/runs/31439239592)
  (workflow `CI/CD`, event `push`, branch `develop`).
- **Injeção** (2026-08-10): branch scratch `ci-proof/guard-gates-needs`
  (3742cfd sobre e1bd036 — o commit com a rule 5 estendida, SEM a qual a
  injeção passaria despercebida pelo contrato: o gap que esta prova fecha é
  o guard ANTIGO não vendo o `needs:` do push net), com `needs: check`
  injetado no job `guard-gates` do guard-gates.yml REAL (a mesma classe da
  Prova 15/16, agora no workflow do push). Disparo: `git push --no-verify
  origin HEAD:develop` — o trigger real do guard-gates.yml é `push:
  branches: [main, develop]`; `main` dispararia o deploy.yml (risco alto,
  Prova 7), `develop` não existe no remote e não tem deploy atrelado — o
  caminho seguro documentado na seção 10.
- **Observado**:

  Run 31439238631 (Guard Gates) — failure em **0s**, sem nenhum job
  executado:

```
X develop Guard Gates · 31439238631
Triggered via push
X This run likely failed because of a workflow file issue.
```

  Run 31439239592 (CI/CD, job Tests, step Unit tests — test:run, o
  REAL-REPO CONTRACT roda em todo push):

```
× scan-guard-gates.mjs - push net guard-gates.yml incondicional (sec 8.4/11.11)
  > REAL-REPO CONTRACT: guard-gates.yml real sem paths filter + test:guard com
    a suite + pr-check.yml com fragile-guard/fuzz/benchmark standalone + ...
    → expected 1 to be +0 // Object.is equality
× run-precommit-guards.mjs - batch runner dos 7 guards node (sec 11.13)
  > REAL-REPO CONTRACT: sem env override -> exit 0, TODOS os 7 veredictos
    clean na ORDEM do hook
    → expected 1 to be +0
× workflow-contracts GROWTH CONTRACT (5th GUARD_NET / 3rd ENCODING_NET)
    → expected 1 to be +0
```

  Run 31439239455 (UTF-8 Check) — **success** (o gate de encoding ficou
  limpo: a falha é isolada ao contrato do guard, não contaminação do
  arquivo mutado).

  Confirmação local pré-push (mesma mutação, no working tree):

```
guard-gates: GUARD GATES JOB NEEDS in .github/workflows/guard-gates.yml
  (needs: check - o job standalone do push net nao pode depender de outro;
  um needs: para um job inexistente INVALIDA o workflow (guard-gates.yml
  tem UM job) e o BASELINE nem roda ...) → exit 1
```

- **O que isto prova**: (a) o guard NOVO vê o `needs:` do push net — o
  REAL-REPO CONTRACT falha no CI real com o caminho exato
  (`.github/workflows/guard-gates.yml`), fechando o par da Prova 16 nos
  DOIS lados da rede; (b) a classe do órfão em dobro é real: o GitHub
  invalida o workflow no parse (0s, `workflow file issue`), então um
  `needs:` não só skiparia o BASELINE — o descartaria por completo; (c) a
  extensão do guard (GUARD_NET_PUSH_JOB + `GUARD GATES JOB NEEDS`) é a
  PRÉ-CONDIÇÃO da prova: sem ela, a injeção passaria despercebida (o guard
  antigo só olhava o twin do PR) — o gap que a tarefa fechou antes de
  provar.
- **Reversão**: `git push --no-verify origin --delete develop` (remote de
  volta ao estado original, sem branch develop) + `git checkout
  freebuff/new-thread-thmsitz5qutoia` + `git branch -D
  ci-proof/guard-gates-needs`; md5 do guard-gates.yml byte-identical
  (`773542ee...` — o snapshot pré-prova), `git status` limpo.
- **Gap protegido**: um `needs:` que volte no job `guard-gates` do push net
  agora falha o guard (exit 1, `GUARD GATES JOB NEEDS`) no pre-commit
  (batch runner) E no CI (REAL-REPO CONTRACT do test:unit/test:guard) — a
  classe da invalidação silenciosa do workflow não pode mais entrar.

## 8.16 Prova 21 — FUZZ JOB NEEDS + FUZZ STEP MISSING live via CI real (a classe FUZZ fechada no lado CI, 2026-08-11)

- **Gate**: `scripts/scan-guard-gates.mjs` rule 7 (FUZZ JOB STANDALONE) — o
  pr-check.yml DEVE ter o job `fuzz:` no nível raiz, SEM `needs:` e com o
  step `run: bun run fuzz:ci` (a autoridade fuzz:ci batchada, sec 11.11/
  11.12, standalone em qualquer PR). Sinais: `FUZZ JOB MISSING` /
  `FUZZ JOB NEEDS` / `FUZZ STEP MISSING` com o caminho exato.
- **Por que esta prova**: a Prova 17 (8.14) provou a multi-violação AGREGADA
  localmente (CLI real, repo real); as Provas 15/16 provaram o lado CI da
  classe FRAGILE GUARD NEEDS. A classe FUZZ (needs: + step errado no job
  fuzz) tinha prova só sintética no lado CI — o furo que esta prova fecha
  com a MESMA injeção combinada num `workflow_dispatch` real.
- **Run**: [31444762608](https://github.com/severinno/severinno/actions/runs/31444762608)
  (workflow `PR Check`, event `workflow_dispatch`, branch scratch
  `ci-proof/fuzz-needs-live`).
- **Injeção combinada** (2026-08-11): branch scratch `ci-proof/fuzz-needs-live`
  criada via **`ci-proof-run.mjs`** com `--only-jobs check --expect failure
  --expect-log 'REAL-REPO CONTRACT' --no-verify` (o helper + o early-exit da
  Prova 20 + `--no-verify` porque o pre-commit local bloqueia o commit da
  mutação — achado da Prova 16). A mutação (`prova21-mutate.mjs`, CRLF-safe):
  `needs: check` injetado logo após a chave `  fuzz:` do pr-check.yml REAL +
  o step `run: bun run fuzz:ci > fuzz-results.json` trocado por
  `run: bun run lint` — as DUAS violações da rule 7 juntas, no arquivo real.
  Confirmação local pré-helper (a mesma mutação no working tree):

```
guard-gates: FUZZ JOB NEEDS in .github/workflows/pr-check.yml (needs: check
  - o job fuzz standalone nao pode depender de outro; um needs: tornaria o
  resultado do fuzz dependente do job check)
guard-gates: FUZZ STEP MISSING in .github/workflows/pr-check.yml (run: bun
  run fuzz:ci required - a autoridade fuzz:ci batchado, sec 11.11/11.12)
→ exit 1
```

- **Observado**: wall-clock do ciclo **206.76s (~3.5min)** medido com
  `time -p` (branch scratch → mutação → push → dispatch → poll do job →
  captura job-scoped → verify → revert); helper **exit 0**. Job `check`
  (~2:51, 00:05:04 → 00:07:55) conclusion=`failure`, e o log job-scoped
  (5580 linhas) contém os DOIS sinais com o caminho exato:
  `guard-gates: FUZZ JOB NEEDS in .github/workflows/pr-check.yml` +
  `guard-gates: FUZZ STEP MISSING in .github/workflows/pr-check.yml` +
  `scan-guard-gates.test.ts (30 tests | 1 failed)` — o REAL-REPO CONTRACT
  (o teste de 923ms que varre o arquivo real). **  `Fuzz Tests: skipped`**
  (00:07:55, sem duração) — o `needs: check` fez o job fuzz depender do
  check que falhou: o skip vector da classe provado VIVO no CI (a autoridade
  fuzz:ci não rodou). Os jobs independentes (utf8-check, Docs Encoding, Geo
  Benchmark) passaram — isolando a falha ao contrato FUZZ. O **Fragile Range
  Guard também falhou** no mesmo run (00:04:58→00:05:55) — pela MESMA raiz:
  ele roda o test:guard, que inclui o REAL-REPO CONTRACT (o mesmo guard que
  o check; Prova 16/20 mostraram o par). Security Headers falhou rápido
  (8s, dívida pré-existente de DNS documentada no security-headers-gate).
- **O que isto prova**: (a) o REAL-REPO CONTRACT pega a injeção combinada
  no CI real com os DOIS sinais + o caminho exato; (b) o skip vector é
  observável: `Fuzz Tests: skipped` no próprio run — um `needs: check`
  silenciosamente faz o fuzz:ci completo (a rede estocástica da 11.11)
  deixar de rodar quando o check falha no lint, a classe que a rule 7
  existe para matar; (c) o early-exit da Prova 20 segurou o ciclo em
  ~3.5min (o sinal vive no job check, não no run inteiro).
- **Reversão**: revert automático do helper (remote `ci-proof/fuzz-needs-live`
  deletado + `git checkout freebuff/new-thread-thmsitz5qutoia` + branch
  local deletado); o `git add -A` do helper varreu o delta uncommitted da
  thread (11 arquivos: security-headers + curl-timeouts + --only-jobs) para
  o commit scratch — restaurado do backup `/tmp` com md5 byte-identical em
  TODOS os 11 (verificado OK 11/11). `git status` = o delta original intacto.
- **Gap protegido**: um `needs:` OU um step fuzz:ci trocado que voltem ao
  job fuzz do pr-check.yml agora falham o guard (exit 1, `FUZZ JOB NEEDS` /
  `FUZZ STEP MISSING`) no pre-commit (batch runner) E no CI (REAL-REPO
  CONTRACT do test:unit/test:guard + o job fragile-guard) — a classe do fuzz
  silenciosamente skipado não pode mais entrar.

## 8.17 Prova 22 — multi-violação AGREGADA live via CI real (run 31446588931, 2026-08-11)

- **Por que esta prova**: a Prova 17 (8.14) provou a multi-violação AGREGADA
  no CLI real LOCALMENTE (8 sinais num run, repo real, revert byte-identical)
  — mas sem run de CI. Esta prova fecha o lado CI: a MESMA injeção agregada
  num branch scratch + `workflow_dispatch` do pr-check, com o job check
  (REAL-REPO CONTRACT) **E** o batch runner (run-precommit-guards) falhando
  com os MESMOS sinais.
- **A injeção** (`scripts/prova22-mutate.mjs`, TEMP, deletado após a prova) —
  a MESMA da Prova 17 Run 1 (CRLF-safe, reescreve com LF): guard-gates.yml
  DELETADO (rule 1); pr-check.yml reescrito SEM os jobs
  utf8-check/fuzz/benchmark/fragile-guard (rules 3,4,7,9 + encoding call
  site) mantendo o job check + `workflow_dispatch` no `on:` (o dispatch
  resolve contra o DEFAULT branch e roda o ref scratch); ci.yml sem o job
  utf8-check (rule 8, lado ci); package.json test:guard sem a suite
  scan-push-full-suite (rule 6). **Self-delete antes do `git add -A` do
  helper**: o script nunca entrou no commit scratch (a superfície de
  executáveis classificaria um .mjs solto como não-classificado e poluiria o
  sinal — o `git status` pós-prova confirma: zero resíduos).
- **Comando**: `node scripts/ci-proof-run.mjs --branch ci-proof/aggr-live
  --workflow .github/workflows/pr-check.yml --mutate 'node
  scripts/prova22-mutate.mjs' --only-jobs check --expect failure
  --expect-log 'REAL-REPO CONTRACT' --no-verify` — **wall-clock 204.91s
  (~3.4min)** com `time -p`, helper **exit 0** (o early-exit da Prova 20
  segurando o ciclo no job; o Security Headers segue rodando em background).
- **O sinal (log job-scoped, 5978 linhas)**: job `check` conclusion=`failure`
  com **88 linhas `guard-gates:`** — os **8 sinais** da agregação, cada um
  com o caminho exato (WORKFLOW MISSING guard-gates.yml, TEST GUARD STEP
  MISSING pr-check.yml, FRAGILE GUARD JOB MISSING, GUARD SUITE MISSING
  package.json, FUZZ JOB MISSING, BENCHMARK JOB MISSING, ENCODING CALL SITE
  MISSING ci.yml + pr-check.yml, ENCODING WORKFLOW MISSING). As DUAS suites
  vermelhas no job:
  - `scan-guard-gates.test.ts (30 tests | 1 failed)` — o **REAL-REPO
    CONTRACT** (1115ms): o teste que roda o CLI real contra o repo real
    esperava exit 0 e pegou o exit 1 da agregação.
  - `run-precommit-guards.test.ts (7 tests | 7 failed)` — o **batch runner**
    (480ms): TODOS os 7 guards vermelhos (AGREGACAO + ISOLAMENTO + o
    REAL-REPO CONTRACT do batch) — a mesma raiz da agregação atingindo o
    runner inteiro, não só o guard direto.
  - Os **GROWTH CONTRACTs do workflow-contracts** também vermelhos (mesma
    raiz: guard-gates.yml sumiu) — ruído esperado e isolável da agregação.
- **ACHADO de método**: a Prova 17 local reescrevia os arquivos e revertia
  via `git checkout`; no CI a mutação vai no commit scratch — o self-delete
  do script de mutação é o que mantém o sinal LIMPO (sem resíduos de
  tooling da prova no CI tree).
- **Reversão**: revert automático do helper (remote `ci-proof/aggr-live`
  deletado + `git checkout freebuff/new-thread-thmsitz5qutoia` + branch
  local deletado); o `git add -A` do helper varreu o delta uncommitted da
  thread (13 arquivos: fixture-extraction + security-headers + curl-timeouts)
  para o commit scratch — restaurado do backup `/tmp/prova22-backup` com md5
  byte-identical em TODOS os 13 (verificado OK 13/13). `git status` = o
  delta original intacto; mutation script self-deletado (zero resíduos).
- **Gap protegido**: a Prova 17 (local) + esta Prova 22 (CI real) formam o
  par da classe multi-violação — um refactor futuro que faça o guard parar
  na PRIMEIRA violação (early-return) quebraria as DUAS (e o teste MUTATION
  COMBINADA da suíte), em vez de só a local.

## 8.18 Prova 23 — SEGUNDO NODE GUARD live no pre-push real (o guard novo da 11.17, local, 2026-08-11)

- **Gate**: `scripts/scan-prepush-batch.mjs` — o guard do veredito da 11.17
  (pre-push NÃO batchado), wired no batch runner do pre-commit como 7º guard
  (e no `test:guard`/push net via `scan-prepush-batch.test.ts`). A classe
  protegida: o NEGATIVO INCONDICIONAL do REFINAMENTO — um node guard NOVO
  no `.husky/pre-push` fora do `ALLOWED_NODE_GUARDS` (integrity +
  check-push-deletion + run-mapped-fuzz — a taxonomia da 11.17) falha com o
  caminho exato MESMO com a nota ADOTADO no gates-proofs.md (a nota
  documenta, a lista pina — o espelho do HOOK_ALLOWLIST da 11.16). O
  REFINAMENTO da 11.17 deixou de ser só teste sintético; esta prova exerce o
  hook REAL.
- **Injeção** (local, 2026-08-11): `node scripts/scan-new-guard.mjs` anexado
  ao `.husky/pre-push` REAL como linha 87 (backup em `/tmp/prepush-backup.bak`;
  md5 do original `74df8979c4098e5cb7328e9a3bb2b083`).
- **Comandos**:

```bash
node scripts/scan-prepush-batch.mjs        # CLI real (esperado: exit 1)
node scripts/run-precommit-guards.mjs      # batch runner real (o guard como 7o; esperado: exit 1)
NO_COLOR=1 npx vitest run scripts/__tests__/scan-prepush-batch.test.ts --config vitest.config.unit.ts
```

- **Observado** (local, 2026-08-11):

```
CLI: prepush-batch: SECOND NODE GUARD at .husky/pre-push:87: node scripts/scan-new-guard.mjs (a 2nd cheap node guard makes the batch worth it - sec 11.17; edit ALLOWED_NODE_GUARDS to allow it - the ADOTADO note documents but does not bypass)
CLI_EXIT=1
BATCH_EXIT=1   (mesmo sinal via run-precommit-guards.mjs)
```

  Vitest: **2 failed | 12 passed** — exatamente os dois pins vivos que a
  injeção deve quebrar: `DERIVATION PIN` (`expected [ 'check-push-deletion.mjs', …(3) ]
  to deeply equal [ 'check-push-deletion.mjs', …(2) ]` — a lista derivada agora
  tem 4 spawns) e `REAL-REPO CONTRACT` (`expected 1 to be +0` — o guard real
  saiu 1). Os 12 testes sintéticos seguem verdes (fixtures isoladas).
- **Reversão**: `cp` do backup de volta; md5 **byte-identical**
  (`74df8979c4098e5cb7328e9a3bb2b083`); `git status --porcelain .husky/` vazio;
  re-run → CLI `prepush-batch: clean` exit 0 + suíte 14/14 verde.
- **Gap protegido**: um dev adicionar um 2º node guard (ex.: um guard novo
  <0.2s) no `.husky/pre-push` sem editar o `ALLOWED_NODE_GUARDS` (mesmo com
  uma seção `11.x` ADOTADO) quebra o guard REAL no pre-commit (via batch
  runner), no `test:guard`/push net e no pre-push (via DERIVATION PIN) — a
  re-medição consciente da 11.17 travada estruturalmente, não só na doc.

## 8.19 Prova 24 — agregação no lado PUSH NET via push real (run 31461526068, 2026-08-11)

- **Por que esta prova (a avaliação VALE ADOTAR)**: a Prova 22 (8.17) provou a
  agregação multi-violação no lado PR (workflow_dispatch do pr-check). O MESMO
  contrato tem um irmão no push net guard-gates.yml — e o par 16/19 (needs:)
  fechou os dois lados da rede; faltava o par da agregação. O lado push tem um
  observável ÚNICO que o lado PR não pode mostrar: a agregação **DELETA** o
  guard-gates.yml (rule 1 WORKFLOW MISSING), então o push net não gera run
  NENHUM — e o ci.yml (o backstop do push) fica **INVÁLIDO no parse** porque
  build/budget ainda citam `needs: [..., utf8-check, ...]` mas o job foi
  removido (rule 8) → o CI/CD rejeita o workflow em ~0s (a classe "workflow
  file issue" da Prova 18), sem rodar job nenhum — nem o REAL-REPO CONTRACT. O
  sinal do lado push é a REJEIÇÃO da plataforma + o órfão silencioso, não o
  guard listando os sinais (que é o sinal do lado PR).
- **A injeção** (branch scratch `ci-proof/aggr-push-live`, commit 70fe6c5): a
  MESMA da Prova 22 (mutation script TEMP CRLF-safe self-delete — o ACHADO da
  sec 8.17): guard-gates.yml DELETADO; pr-check.yml reescrito SEM os jobs
  utf8-check/fuzz/benchmark/fragile-guard mantendo check + docs-encoding +
  security-headers + workflow_dispatch no on:; ci.yml SEM o job utf8-check
  (build/budget com needs pendurado); package.json test:guard sem a suite
  scan-push-full-suite.
- **Disparo**: push REAL temporário a `develop` (`git push origin HEAD:develop`
  com HUSKY=0 — o trigger push: [main, develop] do ci.yml; develop é o caminho
  seguro documentado da Prova 7/18; main dispararia deploy). O guard-gates.yml
  DELETADO não está no ref pusheado → o GitHub não cria run do Guard Gates.
- **O sinal (2026-08-11 05:24Z)** — dois runs criados pelo push:
  - **CI/CD (run 31461526068) = `failure` com 0 jobs**: `gh run view
    31461526068 --json jobs` → `jobs_count=0` e `gh run view --log` → "log not
    found" — o workflow foi rejeitado no parse ANTES de qualquer job rodar
    (build/budget citam `needs: [..., utf8-check, ...]` que a agregação
    removeu). A mensagem exata do GitHub não foi capturada (log not found): a
    classe "workflow file issue" da Prova 18/19 é INFERIDA dos 0 jobs + needs
    pendurado, não observada literalmente. Nem o REAL-REPO CONTRACT chegou a
    rodar — a plataforma aborta o workflow inteiro.
  - **UTF-8 Check (run 31461526553) = `success`**: o gate de encoding correto
    (o utf8-check.yml tem trigger push próprio e a agregação não sujou
    encoding) — isolando a falha ao contrato de workflow, não ao encoding.
  - **NENHUM run do Guard Gates para o sha 70fe6c5**: `gh run list
    --workflow guard-gates.yml` + select por headSha = **vazio** — o órfão
    TOTAL provado vivo: deletar o push net não deixa rastro de run nenhum no
    GitHub (a classe que o workflow existe para fechar, agora demonstrada no
    seu pior caso: o próprio net deletado).
- **Reversão**: revert manual byte-identical — `git push origin --delete
  develop` + `git checkout freebuff/new-thread-thmsitz5qutoia` + `git branch -D
  ci-proof/aggr-push-live`; os 8 arquivos do delta da thread (que o `git add -A`
  do commit scratch varreu, o padrão da Prova 22) restaurados do backup
  `/tmp/prova24-backup` com md5 **byte-identical 8/8**; `git status` = o delta
  original intacto; mutation script TEMP self-deletado (zero resíduos).
- **Gap protegido**: a Prova 22 (PR, dispatch) + esta Prova 24 (push net, push
  real) formam o par da classe agregação nos dois lados da rede — o mesmo
  tratamento que as Provas 16/19 deram ao needs:. Um refactor futuro que faça o
  guard parar na PRIMEIRA violação (early-return) quebraria a Prova 22 (os 8
  sinais no CLI); uma regressão que remova o utf8-check do ci.yml sem ajustar o
  needs do build/budget agora tem esta prova documentando a classe "workflow
  file issue" no push — e o órfão total do push net (deletar o workflow =
  silêncio de run) fica registrado como comportamento observado, não só
  inferido.

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

**Re-medição 3 (2026-08-10, mesma sessão) — pós 6º guard do batch (sec 11.16) e
set staged real da thread (25 arquivos):** o pedido era o total de ponta a
ponta por commit com o batch em produção (6 guards em 1 invocação — o 6º
guard `scan-batch-coverage` da sec 11.16 somou ~0.02s ao batch). Protocolo
idêntico (stage do set real + md5 snapshot antes → 3 runs completas → md5
byte-identical após → unstage; working tree verificado intacto). 3 runs
completas do `.husky/pre-commit`:

| Run | Total real | Nota |
|---|---|---|
| RUN1 | 124.8s | boot one-time: tsc cold/rebuild do tsbuildinfo + daemon eslintd cold + vitest cold |
| RUN2 | 74.3s | regime warm |
| RUN3 | 68.2s | regime warm |
| **Regime estável** | **~68-74s** | o custo real por commit com o set atual |

Componentes (mesma sessão, runs isoladas):

| Componente | Re-medição 2 | Re-medição 3 | Δ |
|---|---|---|---|
| verify-encoding | 4.07s | 2.62s | -1.4s (máquina menos carregada) |
| check-docs-encoding + scan-lucide + check-next-types | 1.11s | 0.88s | ~igual |
| **batch (6 guards em 1 invocação)** | — (row separada na 2) | **0.21s** | o corte do batch mantido com 6 guards: 6 SEQUENCIAIS extrapolados ~0.8-1.2s (baseline 11.13: 4 sequenciais 0.54-0.81s + 2 guards ~0.3-0.4s) vs 6 BATCHADOS 0.21s; o 6º guard (sec 11.16) custa ~0.02s |
| **tsc --incremental (warm)** | **~27s (26.9-28.0)** | **16.11s** | -11s — estado de máquina (a faixa 10.9-16.5s da 11.10) |
| **lint-staged (shim warm)** | **1.8s (5.9s na 1ª run pós-restart)** | **4.73s (25 arquivos staged)** | +2.9s — mais arquivos staged no set da thread |
| **pre-commit:test** | **11.6s (3 suites/35 testes)** | **45.41s (12 suites/246 testes)** | **+33.8s — o dominante mudou de novo** |
| **Total wall (lint ∥ tsc)** | **~46-51s** | **~65-74s** | |

Soma: 3.71 (gates de encoding) + max(16.11, 4.73) (lint ∥ tsc) + 45.41
(pre-commit:test) = **~65.2s** — bate com o RUN3 (68.2s, +3s de overhead).

**Por que o total subiu (46-51 → 68-74s) apesar do batch mais barato?** O
dominante INVERTEU pela TERCEIRA vez: pre-commit:test agora é **~66% do
wall** (45.4s) porque o set staged desta thread (25 arquivos, incluindo
muitos `scripts/__tests__/*.test.ts`) mapeia **12 suítes / 246 testes** — vs
3 suítes/35 testes na re-medição 2. NÃO é regressão do hook: é o escopo do
mapping (a regra de co-locação da 11.15 — tocar suites de teste mapeia as
suítes, correto). O batch segue o corte documentado (6 guards em 0.21s vs
0.54-0.81s de 4 spawns sequenciais — o 6º guard custa ~0.02s, irrelevante);
encoding (~3.7s) e tsc (~16s) são estáveis. O teto estrutural continua não
sendo o tsc — é o mapping de testes do set staged: commit que toca muitas
suítes custa ~45s de testes; commit docs-only continua instantâneo (skip).

**Re-medição 4 (2026-08-11) — o total real de ponta a ponta + CORREÇÃO DE PREMISSA:
`scan-curl-timeouts`/`scan-eol-anchor` são CI-ONLY, não estão no batch do pre-commit.**

O pedido assumia que o pre-commit ganhou 2 guards novos (`scan-curl-timeouts` +
`scan-eol-anchor`) no batch runner. **A premissa está incorreta** — verificado nos
arquivos reais: os 2 guards estão wired SÓ no CI (`guard-gates.yml` e
`pr-check.yml` como steps `node scripts/scan-curl-timeouts.mjs --ci` e `node
scripts/scan-eol-anchor.mjs --ci`, sec 8.1), e suas suítes vitest
(`scan-curl-timeouts.test.ts` + `scan-eol-anchor.test.ts`) rodam no
`test:unit` (job `check`) e `test:run` (job `Tests`) — NÃO no `test:guard` (a
lista do script tem 13 suítes e não os inclui) e NÃO no `.husky/pre-commit` (o `run-precommit-guards.mjs`
segue com os MESMOS 7 guards; o hook não os chama). O custo do pre-commit local é
portanto INALTERADO por esses guards — a medição abaixo é o ground truth atual do
hook de ponta a ponta (protocolo das re-medições 1-3: stage do set real + md5
snapshot 8/8 → 3 runs → md5 byte-identical 8/8 + unstage):

| Run | Total real | Nota |
|---|---|---|
| RUN1 | 166.7s | boot one-time: tsc cold/rebuild do tsbuildinfo + daemon eslintd cold + vitest cold (mais pesado que os ~124s das re-medições 2-3 — máquina mais carregada) |
| RUN2 | 63.1s | regime warm |
| RUN3 | 55.6s | regime warm |
| **Regime estável** | **~56-63s** | o custo real por commit com o set atual (8 arquivos staged) |

Componentes (mesma sessão, runs isoladas):

| Componente | Re-medição 3 | Re-medição 4 | Δ |
|---|---|---|---|
| verify-encoding | 2.62s | 2.55s | ~igual |
| check-docs-encoding + scan-lucide + check-next-types | 0.88s | 0.90s | ~igual |
| **batch (7 guards em 1 invocação)** | **0.21s** | **0.21s** | estável — o 7º guard (sec 11.17) custa ~0.02s; o batch NÃO carrega curl-timeouts/eol-anchor (CI-only) |
| **tsc --incremental (warm)** | **16.11s** | **12.72s** | -3.4s — estado de máquina (faixa 10.9-16.5s da 11.10) |
| **lint-staged (shim warm)** | **4.73s (25 arquivos staged)** | **3.71s (6 ts staged)** | ~igual por arquivo |
| **pre-commit:test** | **45.41s (12 suites/246 testes)** | **33.50s (5 suites/124 testes)** | **-11.9s — escopo do mapping (8 arquivos staged desta thread)** |
| **Total wall (lint ∥ tsc)** | **~65-74s** | **~56-63s** | |

Soma: 3.66 (gates) + max(12.72, 3.71) (lint ∥ tsc) + 33.50 (pre-commit:test) =
**~49.9s** — bate com o RUN3 (55.6s, +5.7s de overhead).

**Veredito honesto**: o total caiu (65-74 → 56-63s) NÃO por causa de guards novos
no hook (não há — os 2 são CI-only), mas pelo escopo do mapping de testes do set
staged (12 suites/246 → 5 suites/124 testes) e pelo estado de máquina do tsc
(16.11 → 12.72s). O teto estrutural segue sendo o pre-commit:test (~60% do wall)
quando o commit toca muitas suítes; o batch segue o corte documentado (7 guards em
0.21s). Se o intento era ter `curl-timeouts`/`eol-anchor` LOCAIS também, isso é
uma decisão separada (adicioná-los ao `run-precommit-guards.mjs` — custo marginal
~0.05-0.1s) — não foi o que o pedido fez, e a re-medição documenta o estado real.

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

**Medição CI vs LOCAL same-session (run 31397642499, branch
ci-proof/fuzz-batch, 2026-08-10):** o run que provou o fuzz batchado no CI
tem o job "Fuzz Tests" com 47s TOTAL, mas o step puro "Run fuzz tests"
levou **9s** — a maior parte do job é setup fixo, não fuzz:

| Step (job Fuzz Tests, run 31397642499) | Duração |
|---|---|
| Set up job | 1s |
| actions/checkout@v4 | 3s |
| oven-sh/setup-bun@v2 | 2s |
| Cache node_modules | 10s |
| Install deps | 11s |
| **Run fuzz tests (o fuzz:ci puro)** | **9s** |
| Archive fuzz results | 1s |
| Post Cache + post setup-bun + post checkout + complete | ~8s |

Local SAME-SESSION (Windows, 3 runs quentes): **13.10s / 12.60s /
12.50s** (~12.5-13.1s; o 55.45s do 1º run era cold com reify/startup,
mesma classe do cold documentado na 8.3). Os DOIS lados rodam as mesmas 6
suites (mesmo manifest fuzz-targets); local 62 testes / 0 failed
(JSON do runner); o CI concluiu o job com success (0 failed) — os counts
exatos do lado CI não foram lidos do artifact, só o conclusion.

**Veredito:** o fuzz EM SI é comparável — o CI (9s) é até um pouco mais
rápido que o local warm (~12.5-13.1s) no step puro, a diferença esperada
de runner Linux vs Windows local. A comparação ingênua "47s CI vs 13.7s
local" mistura o custo do AMBIENTE (checkout+setup-bun+cache+install+post
≈ 34s + ~4s de Set up/Archive/overhead = ~38s fixos por job, que nenhuma
otimização de runner remove) com o custo do FUZZ (9s CI). Para medir
ganho de runner no futuro, comparar SEMPRE o step "Run fuzz tests"
isolado contra o local warm — nunca o total do job.

## 11.13 Os 4 guards node do pre-commit — batch runner em 1 invocação (medição 2026-08-10)

O pre-commit rodava 4 guards node como 4 SPAWNS SEQUENCIAIS:
`check-node-modules-integrity`, `scan-push-full-suite`,
`scan-lint-staged-loader` e `scan-guard-gates`. Cada guard é puro node
(sem deps, <10ms de scan), então o custo real é o BOOT do node — e 4 boots
sequenciais pagavam o preço 4x.

### Medição (3 runs cada, saída descartada, node 22.23.1 / Windows)

| Forma | Run 1 | Run 2 | Run 3 |
|---|---|---|---|
| check-node-modules-integrity (isolado) | 0.47s | 0.20s | 0.63s |
| scan-push-full-suite (isolado) | 0.20s | 0.16s | 0.22s |
| scan-lint-staged-loader (isolado) | 0.17s | 0.15s | 0.14s |
| scan-guard-gates (isolado) | 0.17s | 0.16s | 0.14s |
| **4 SEQUENCIAIS (a forma antiga do hook)** | **0.81s** | **0.56s** | **0.54s** |
| 4 PARALELOS (`&` + `wait`) | 0.24s | 0.24s | 0.34s |
| **BATCH (1 invocação node)** | **0.22s** | **0.24s** | **0.26s** |
| Boot node puro (baseline `node -e ""`) | 0.15s | 0.13s | 0.13s |

### Veredito: ADOTADO — batch runner, não paralelo

O boot do node (~0.14s) domina cada guard isolado; o scan puro é <10ms. O
batch (`scripts/run-precommit-guards.mjs`, 1 boot + 4 scans em sequência)
fica em ~0.22-0.26s — ~2.7x mais rápido que o sequencial (~0.6-0.8s) e
marginalmente mais rápido que o paralelo (~0.24-0.34s). O batch ganhou do
paralelo por DETERMINISMO, não por velocidade: a saída segue a ordem do
hook (integrity → push-suite → lint-loader → guard-gates) sem interleave de
stdout num hook `set -euo pipefail` — uma falha lê com o contexto exato de
qual guard falhou, e o aggregate worst-exit (todos rodam SEMPRE) não esconde
nenhuma falha atrás da primeira.

### Implementação

- `scripts/run-precommit-guards.mjs` (NOVO): importa os 4 guards (todos
exportam `main()` com entry-point guard próprio — importar não executa) e
agrega os exit codes (OR lógico, 0|1). O `check-node-modules-integrity`
ganhou entry-point guard (antes rodava `process.exitCode = main()`
incondicionalmente — um side effect no import que quebraria o batch).
- `.husky/pre-commit`: os 4 `node scripts/*.mjs` viram UM
`node scripts/run-precommit-guards.mjs` (comentário consolidado com as
referências de seção de cada guard).
- Contrato: o `scan-push-full-suite` ganhou o GATE_CONTRACT 'guards node
batchados (1 invocacao)' — NEGATIVO: um spawn individual de qualquer um dos
4 no pre-commit = violação (a regressão de custo que o batch mata);
POSITIVO: `run-precommit-guards.mjs` presente = o batch não pode sumir.
- Testes: `run-precommit-guards.test.ts` (agregação + isolamento por guard
via env override sintético + REAL-REPO CONTRACT com os 4 veredictos na
ordem do hook) e mutations do contrato novo no `scan-push-full-suite.test.ts`.

### Re-mediar quando?

O contrato trava a forma (batch, não 4 spawns), mas o CUSTO absoluto pode
recalibrar: re-rodar a tabela acima quando um 5º guard node entrar no batch
ou quando o boot do node mudar de ordem de grandeza (ex.: node 24 com
snapshot startup). O CI não precisa deste gate — checkout fresco não tem
hook; a rede do push net (guard-gates.yml) cobre a regressão de contrato.

## 11.14 verify-encoding.test.ts (Gate 3) — o split mutation/contrato é REFUTADO pela medição; merge PROOF+CONTRACT (medição 2026-08-10)

**A pergunta** (da RE-MEDIÇÃO 2026-08-10): o `verify-encoding.test.ts`
(~36.5s citados, 15 cassetes) domina o Gate 3 quando o diff toca suítes de
teste. Avaliar dividir os cassetes de MUTATION numa suíte separada de
"custo baixo", deixando só os "contratos rápidos" no caminho quente do
mapeado.

### Medição por cassete (vitest --reporter=json, um shell, Windows, 2026-08-10)

| Cassete | Custo | Spawna o gate? |
|---|---|---|
| REVERSE MUTATION (wrapper) | 5.9s | sim (module copy) |
| MUTATION utf8 layer | 3.9s | sim |
| PROOF (real repo) | 3.7s | **sim** |
| MUTATION mjs clean | 3.7s | sim |
| CONTRACT --dir derivado | 3.6s | **sim** |
| WORST-EXIT | 3.6s | **sim** |
| MUTATION mjs dirty | 3.4s | sim |
| MUTATION YAML clean | 3.4s | sim |
| MUTATION YAML dirty | 3.3s | sim |
| MUTATION proof layer | 3.2s | sim |
| MUTATION fragile root | 3.1s | sim |
| MUTATION fragile dir | 2.7s | sim |
| SYNC | 0.6s | não (routing) |
| SYNC-MIXED | 0.2s | não (refusal) |
| bash -n | 0.1s | não (syntax) |

### Veredito: REFUTADO — a premissa "contratos rápidos" não existe

O custo de cada cassete é o SPAWN COMPLETO do gate (~3-4.5s), não uma
classe de cassete: PROOF (3.7s), CONTRACT (3.6s) e WORST-EXIT (3.6s) são
CONTRATOS que também pagam o gate inteiro — o split deixaria ~8s de
"contratos" no caminho quente (PROOF+CONTRACT+WORST-EXIT), não o "custo
baixo" prometido, e moveria as mutations para uma suíte irmã que o CI
rodaria de qualquer forma (`test:unit` roda a árvore inteira). O custo é
por-spawn, não por-tipo.

**Onde o ~3s por spawn vai** (perfil por camada do gate real): spawns
bash/node ~0.9s (4 bash + 3 node; boot bash 0.10s / node 0.17s no
Windows/git-bash) + L1 check-utf8 python 0.42s (653 arquivos, count-only
para .ts — surpresa: o script NÃO abre .ts, só os enumera) + L2 proof
~1.0s + L3 fragile ~1.0s + L4 yaml 0.24s + L5 mjs 0.28s ≈ **4.5s/gate**.
O gate completo domina; o python sozinho é barato.

### O que foi aplicado (zero perda de cobertura)

**Merge PROOF + CONTRACT numa única cassete**: as duas spawnam a MESMA
invocação (`runGate(["--ci", "src/"])` sem env) e assertam saídas
diferentes do mesmo run — 2 spawns (~7.3s) para 1 run de output. Mergidas
numa cassete só (todas as 9 asserções preservadas, 14 testes agora): a
regra nova no docblock é *qualquer cassete que precise do real-repo clean
asserta sobre o run desta cassete, nunca re-spawn* (o mesmo princípio do
batch runner dos guards).

### Medição pós-merge

Suíte: **14 passed** (era 15); run quente ~50s (ruído Windows ±10s: o
somatório por-cassete era 44.4s e a suíte oscilou entre 36.5s e 50s nas
medições — o merge economiza ~3.6s, encoberto pela variância). Gate 3 com
`verify-encoding.test.ts` no diff: ~50s → ~47s (uma cassete a menos).

**Conclusão honesta**: o merge é o único win de cassete com zero custo de
cobertura. O lever REAL de custo do Gate 3 é o gate por-spawn (~4.5s × 13
spawns ≈ o custo total) — reduzir isso (ex.: paralelizar as 5 camadas
independentes do wrapper, todas read-only, com saída ordenada por
captura-em-arquivo) cortaria TODOS os cassetes de uma vez, é o candidato
natural de próxima rodada (com prova de determinismo de saída antes de
adotar).

## 11.15 Gate 3 mapeado por CO-LOCATION — decisão travada, não suite-heavy por gate file (medição 2026-08-10)

**O problema** (RE-MEDIÇÃO 2026-08-10, seção 8.4): o dominante do push
inverteu do fuzz para o Gate 3 — quando o diff toca suítes de teste
DIRETAMENTE (o mapeamento selecionou 14 arquivos / 258 cassetes; o maior
bloco é `verify-encoding.test.ts` ~36.5s, uma suíte que spawna o gate
completo — seção 11.14), o Gate 3 isolado foi medido **66.5s (cold) / 75s
(warm)** e o `pre-push:gates` completo (Gate 1 + 2 + 3) **77.58s** — vs
**20.8s** do caso calibrado.

**A decisão travada**: o Gate 3 mapeia por **CO-LOCATION** — um source
tocado mapeia os testes co-localizados (`<name>.test.ts` / `__tests__/`),
NUNCA uma suite pesada arbitrariamente. Um push de GATE FILES (`.sh`/`.yml`
dos hooks/workflows) deve mapear pouca ou nenhuma suite — o custo comum do
push NÃO pode virar o pior caso por causa de um gate file tocado.

**A classe de regressão travada**: adicionar `.sh` (ou `.yml`) ao
`SOURCE_RE` do `pre-commit-tests.mjs` (hoje `\.(ts|tsx|mjs)$`) faria
`scripts/verify-encoding.sh` mapear `scripts/__tests__/verify-encoding.test.ts`
(~36.5s, a suite que spawna o gate completo — seção 11.14) em TODO push de
gate files — o custo comum de ~20.8s viraria ~77s. O mesmo raciocínio vale
para o fuzz mapeado (11.11) e para qualquer suite subprocess-heavy nova.

**Contrato nº 5** (scan-push-full-suite.mjs, GATE_CONTRACTS):

- NEGATIVO: `SOURCE_RE` do `pre-commit-tests.mjs` sem `sh`/`yml`/`yaml`
  (gate files nunca mapeiam suite co-localizada) — violação com o
  file:line exato.
- POSITIVO: o pin exato da declaração `SOURCE_RE = /\.(ts|tsx|mjs)$/`
  (mudar a superfície de origem — renomear/expandir — falha 'MISSING').

O guard roda no pre-commit (batch runner) E no CI via `test:unit`/
`test:guard` (REAL-REPO CONTRACT). **Re-mediar quando?** quando uma suite
subprocess-heavy nova entrar no repo ou o perfil por-spawn do gate mudar —
não quando o contrato falhar (a falha É o sinal de regressão).

## 11.16 scan-batch-coverage — contrato de crescimento do batch (2026-08-10)

O contrato 4 do scan-push-full-suite pina os guards do batch por REGEX FIXO
(os nomes hardcoded no `.husky/pre-commit`). A classe de drift que isso deixa
aberta é exatamente a que o SPREAD CONTRACT dos TARGET_DIRS mata: um guard
NOVO adicionado direto ao hook (sem entrar no batch) escapa do regex — o
spawn individual passa, os boots voltam a somar, e nenhum gate acusa.

### Decisão: DERIVAÇÃO, não regex fixo (mesmo padrão do spread dos TARGET_DIRS)

`scripts/scan-batch-coverage.mjs` (6º guard do batch — o guard de cobertura é
ele próprio batchado, rodando na MESMA invocação que ele policia) deriva a
lista do batch dos IMPORTS VIVOS do `run-precommit-guards.mjs` (`import { main
as X } from "./X.mjs"`) — nunca de uma lista copiada. Um guard adicionado ao
batch fica automaticamente coberto; um guard fora do batch falha até entrar.

Contrato bidirecional:
- NEGATIVO: um `node scripts/X.mjs` direto no `.husky/pre-commit` onde X não é
o batch runner. Duas subclasses:
  - X está no batch DERIVADO → `ALREADY BATCHED` (o spawn direto é redundante,
  double-run — o mesmo guard roda 2x por commit; remover a linha).
  - X não está no batch nem na allowlist → `GUARD OUTSIDE BATCH` com o caminho
exato (file:line + conteúdo) — o guard novo precisa ENTRAR no batch.
- POSITIVO: o batch runner DEVE estar wired no hook (remover = `BATCH RUNNER
MISSING` — os guards voltariam a custar N boots).
- HOOK_ALLOWLIST (as 2 exceções deliberadas, pinadas com rationale):
`scan-lucide-icons.mjs --check` (geração do mock a11y, ordem pré-batch) e
`check-next-types.mjs --fix` (auto-heal do .next/types, ordem pré-tsc). Um 3º
guard fora do batch exige editar a allowlist com justificativa (o padrão
EXCLUDED_TREES do fragile-range).

### Implementação

- `scripts/scan-batch-coverage.mjs` (NOVO): `deriveBatchGuards(runnerSource)`
(derivação pura, exportada) + `scanBatchCoverage(root)` + `main()` com env
override `BATCH_COVERAGE_SCAN_ROOT` (repo sintético p/ o vitest). Saída ASCII
pura, puro node, <10ms.
- `run-precommit-guards.mjs`: 6º import + chamada (o guard de cobertura é
batchado) e correção de drift real do header (dizia "4 guards", rodava 5 →
agora 6).
- `.husky/pre-commit`: comentário 5→6 guards + bullet do scan-batch-coverage.
- `scan-push-full-suite.mjs` contrato 4: regex ganhou `scan-batch-coverage`
(a lista fixa segue como camada histórica dos 6 conhecidos; a derivação é a
camada de crescimento que cobre o 7º).
- Testes: `scan-batch-coverage.test.ts` (REAL-REPO CONTRACT + GROWTH mutation
com caminho exato + ALREADY BATCHED + SPREAD com runner patcheado de 7º
import + SPREAD CONTROL sem o import + allowlist pinada + comentário-não-tripa
+ positivo + DERIVATION PIN dos 6 imports) e `run-precommit-guards.test.ts`
atualizado para 6 veredictos na ordem.

### Re-mediar quando?

Quando um 7º guard entrar no batch: o DERIVATION PIN (os 6 imports) falha
primeiro e força a atualização consciente; o SPREAD CONTRACT já prova que a
derivação cobre o 7º sem mudar o guard. A allowlist é o único ponto de
decisão manual (um guard fora do batch exige justificativa documentada).

## 11.17 Pre-push NÃO é batchado — por que a assimetria é correta (avaliação 2026-08-10)

**A pergunta**: o batch runner (11.13/11.16) cobre só o pre-commit; o
`.husky/pre-push` ainda spawna `check-node-modules-integrity`
INDIVIDUALMENTE (deliberado — antes do fuzz mapeado), além do
`verify-encoding.sh` e do `run-mapped-fuzz.mjs`. Merecem o mesmo tratamento
batch?

**Medição** (mesma sessão, isolado, node 22.23.1 / Windows):

| Gate do pre-push | Custo medido | Nota |
|---|---|---|
| check-node-modules-integrity (o ÚNICO node guard do pre-push) | 0.18 / 0.18 / 0.22s | ~0.19s já com boot node |
| verify-encoding.sh --dry-run --ci src/ | 2.94s | gate BASH multi-camada (node+python internos), não node guard |
| run-mapped-fuzz.mjs --since | 0.41s (skip: diff sem superfície fuzz) | invocação vitest pesada, não node guard |

**O lever do batch não tem superfície aqui.** O batch economiza o BOOT node
(~0.14s) consolidando N spawns em 1 — o pre-commit tinha 4-6 guards, logo
4-6 boots. O pre-push tem EXATAMENTE UM node guard (integrity), que já custa
~0.19s com boot: batchar economizaria ~0.14s num hook de dezenas de
segundos — ruído. `verify-encoding` é um gate bash multi-camada (não é
importável num runner node) e `run-mapped-fuzz` é uma invocação vitest
pesada (categoria diferente do agregador síncrono de exit codes — não cabe
no runner).

**Veredito: manter a assimetria — o custo já é aceitável.** Os três gates do
pre-push são classes diferentes (node guard de <0.2s, gate bash de ~3s,
runner vitest de ~6s típico — ~14.5s no pior caso, sec 11.11) e o único
batchável (integrity) é irrelevante de custo. Além disso, a ORDEM importa por design: integrity roda
ANTES do fuzz mapeado para não gastar ~6s de fuzz num node_modules
divergente (a classe da 8.5) — o batch pré-fuzz teria que preservar essa
ordem de qualquer forma, sem ganho.

**Já travado estruturalmente**: o contrato 4 do `scan-push-full-suite`
(guards node batchados) tem o NEGATIVO (spawn individual) e o POSITIVO
(batch wired) escopados a `.husky/pre-commit` — o spawn individual do
integrity no `.husky/pre-push` fica FORA da superfície do contrato por
design, sem precisar de allowlist (a mesma asimetria deliberada documentada
no header do run-precommit-guards.mjs). Se um dia o pre-push ganhar um
segundo node guard (<0.2s cada), aí o batch passa a valer — até lá, spawn
individual é o certo.

**LOCK ESTRUTURAL (2026-08-10)**: a condição acima agora é um guard
(`scripts/scan-prepush-batch.mjs`, wired no batch runner do pre-commit
como 7º guard — o scan-batch-coverage deriva a lista dos imports vivos, e
os pins do DERIVATION PIN/order test acompanharam): um node guard novo no
`.husky/pre-push` fora do conjunto pinado (integrity + check-push-deletion
+ run-mapped-fuzz — a taxonomia da 11.17) falha com o caminho exato; o
integrity continua pinado como spawn individual lá (positivo relaxado sob
a nota). O veredito não vive mais só na doc — reverter a 11.17 exige
EDItAR a rede estrutural, não só documentar.

**REFINAMENTO 2026-08-10 (a nota DOCUMENTA, a lista PINA — o espelho do
HOOK_ALLOWLIST da 11.16)**: a 1ª versão deste lock deixava a nota ADOTADO
SUPRIMIR o negativo (um guard novo + uma seção `11.x` com `pre-push` +
`ADOTADO` passava sem tocar na lista) — um bypass em prosa: bastava uma
seção de adoção não-relacionada com a palavra ADOTADO na linha do header
para um 4º guard entrar sem editar o `ALLOWED_NODE_GUARDS`. A 2ª versão
fechou o furo: o NEGATIVO é INCONDICIONAL — um guard fora da lista falha
MESMO com a nota presente; um 4º guard legítimo (com nota ADOTADO)
EXIGE editar o `ALLOWED_NODE_GUARDS` conscientemente (a mesma semântica
da HOOK_ALLOWLIST: exceções vivem NA LISTA com rationale, nunca em regex
de doc). A nota só relaxa o POSITIVO (o integrity pode ir para dentro do
batch na adoção legítima). Testes: a MUTATION "NOTA SOZINHA NAO bypassa"
prova o negativo (nota + guard novo SEM editar a lista → exit 1 com
`edit ALLOWED_NODE_GUARDS`); o teste do seam `PREPUSH_ALLOWLIST_EXTRA`
prova o positivo (a MESMA mutação com a lista editada → exit 0).

**DERIVATION PIN (2026-08-10)**: a claim "exatamente UM node guard" agora
é um teste: o `scan-prepush-batch.mjs` exporta `derivePrepushSpawns` (o
padrão do `deriveBatchGuards` do pre-commit aplicado ao OUTRO hook — a
lista de node guards do `.husky/pre-push` é DERIVADA dos spawns reais,
nunca hardcoded), o scan consome a MESMA derivação (fonte única) e o
`scan-prepush-batch.test.ts` pina a lista viva: os 3 spawns na ordem
(checker de deleção, integrity, runner vitest) com EXATAMENTE 1 node guard
(o integrity). Um 2º guard no pre-push muda a lista derivada e o pin
quebra antes de o scan precisar — o spread contract dos TARGET_DIRS
aplicado aos node guards do pre-push.

**REFINAMENTO 2026-08-11 (o sub-caminho 11.18 ganha positivo próprio)**: o
DERIVATION PIN já pegava a REMOÇÃO do checker de deleção no CI (a lista
derivada encolheria de 3 para 2 e o `toEqual` quebraria), mas sem sinal
LOCAL no batch do pre-commit — um dev removendo o `check-push-deletion.mjs`
do `.husky/pre-push` veria o hook perder o skip de deleção pura da 8.4
(todo push de housekeeping volta a pagar ~74s) com o guard reportando
"clean". O guard ganhou o positivo `DELETION SHORTCUT MISSING` (espelho do
`INTEGRITY GUARD MISSING`): o atalho DEVE existir como spawn individual,
relaxado sob a nota ADOTADO como o integrity (a adoção legítima move o
checker para dentro do batch também). Testes: "DELETION SHORTCUT DELETADO"
(remover o spawn → exit 1 com `DELETION SHORTCUT MISSING in .husky/pre-push`
+ sole-failure pin: 0 SECOND NODE GUARD / 0 INTEGRITY GUARD MISSING) +
"DELETION DELETADO + NOTA" (→ exit 0, espelho do INTEGRITY DELETADO + NOTA)
+ o REAL-REPO CONTRACT agora pina os DOIS positivos vivos no hook real
(integrity E checker de deleção presentes).

## 11.18 O sub-caminho de housekeeping de branches — deleção pura vs misto, o checker entra no batch? (medição 2026-08-10)

**A pergunta**: a 11.17 mediu o custo do node guard do pre-push (integrity
~0.19s com boot de ~0.14s) e manteve o spawn individual. O
`check-push-deletion.mjs` (atalho de deleção pura) também é um node spawn
no pre-push — o caminho completo de housekeeping de branches (deleção pura
vs misto) merece a mesma análise de custo: o batch de gate files do
pre-push vale a pena NESSE sub-caminho?

**Medição** (mesma sessão, isolado, node 22.23.1 / Windows, 3 runs — o 1º
run frio de cada entrada é o boot do node + cold fs):

| Caminho | 3 runs | Média warm | Nota |
|---|---|---|---|
| boot node puro (`node -e ""`) | 102 / 75 / 67ms | ~0.07s | o piso do spawn |
| checker puro — DELEÇÃO PURA (1 ref all-zeros) | 318 / 83 / 87ms | ~0.08s | exit 0 = skip da cadeia; boot-domínio (lógica ~10ms) |
| checker puro — MISTO (deleção + ref real) | 86 / 88 / 82ms | ~0.08s | exit 1 = cadeia roda |
| checker puro — stdin vazio (manual) | 84 / 87 / 87ms | ~0.08s | exit 1 = cadeia roda |
| integrity (comparação, sec 11.17) | 171 / 163 / 160ms | ~0.16s | o node guard do caminho de código |
| batch runner (7 guards em 1 boot, sec 11.13) | 188 / 170 / 170ms | ~0.17s | 7 guards ≈ 1 integrity: o boot é o piso |
| **batch sintético checker+integrity (2 guards, 1 boot, DELEÇÃO PURA) — MEDIDO 2026-08-11** | 180 / 200 / 170ms | **~0.18s** (média das 3 runs; o 1º run não era frio — o sanity precedeu, spread é ruído; runs 2-3 = 200/170 → ~0.19s) | substitui a extrapolação: 2 guards ≈ 7 guards ≈ 1 integrity — o boot é o piso, confirmado por medição direta (sanity: checker exit 0 + integrity clean → batch exit 0) |
| **caminho completo do hook — DELEÇÃO PURA** (stdin capture + awk + checker exit 0 + skip) | 231 / 215 / 208ms | **~0.21s** | o housekeeping de branches inteiro |
| caminho completo do hook — MISTO (checker exit 1, ANTES da cadeia) | 214 / 206 / 201ms | ~0.20s | o checker é ~0.2s de um push de dezenas de segundos |

**O que os números dizem**:

1. **O caminho de deleção pura já é o mínimo.** Housekeeping completo
   (stdin + awk + checker + exit 0 + skip) ≈ ~0.21s warm — o checker é o
   ÚNICO node spawn desse caminho (integrity nem roda: a cadeia é pulada).
   Não há N boots para consolidar — há UM.

2. **Batchar NÃO economiza aqui — e o argumento honesto é semântico, não
   de custo.** O batch checker+integrity foi MEDIDO diretamente
   (2026-08-11, batch sintético com a MESMA forma do run-precommit-guards:
   1 boot, main()s importados, agregação worst-exit, stdin de deleção pura
   pipado como no hook real): **180 / 200 / 170ms, ~0.18s warm** — no
   caminho de deleção pura é LIGEIRAMENTE mais barato que o ~0.21s atual
   (o boot é amortizado; a extrapolação anterior de ~0.17-0.19s, derivada
   do batch de 7 guards, foi confirmada pelo número medido). O ponto não é
   wall-clock: o batch é um agregador worst-exit que roda TODOS os guards
   — não pode pular o integrity condicionalmente após a decisão de skip.
   Forçaria o integrity (scan real de ~0.09s sobre o boot) a rodar num
   push que carrega ZERO código — exatamente o desperdício que o atalho
   existe para evitar (o checker short-circuita o hook ANTES de qualquer
   gate). Batchar trocaria uma economia de ~0.02-0.03s (0.21 → 0.18 medido)
   por rodar um scan real em housekeeping vazio.

3. **O misto é dominado pela cadeia.** O passo de detecção (~0.2s
   incluindo captura+awk; o checker puro ~0.08s) é ~0.4% de um push misto
   de dezenas de segundos (fuzz ~6-14s + gates + encoding). Batchar
   economizaria ~1 boot (~0.07s) num push de ~53s — ruído, a mesma
   conclusão da 11.17.

4. **O checker é uma DECISÃO DE BRANCH, não um gate agregável.** Seu exit
   code decide SKIP vs RODA-A-CADEIA (short-circuit do hook) — categoria
   diferente do agregador síncrono de exit codes do batch (que roda todos
   e OR os resultados). Mesmo que coubesse no batch, o runner teria que
   devolver o controle ao hook com a decisão de skip — a semântica não
   compõe com o worst-exit.

**Veredito: manter o spawn individual — a assimetria da 11.17 se estende ao
housekeeping.** A condição que tornaria o batch válido é a MESMA da 11.17
(travada pelo scan-prepush-batch.mjs): se o pre-push ganhar um 2º node
guard <0.2s no caminho de deleção (o checker + mais um), aí o batch passa
a valer NESSE sub-caminho. Até lá, o checker individual (~0.08s + decisão
de skip no hook) é o certo — e a ORDEM importa por design: o checkerroda ANTES de qualquer gate para a deleção pura não gastar nem o encoding.

## 11.19 Prova 18 — integrity falha ANTES do fuzz mapeado (simulação de pre-push real com node_modules divergente, local, 2026-08-10)

**A pergunta**: a 11.17 (e a 11.18, para o housekeeping) decidiu que o
integrity roda como node guard INDIVIDUAL no pre-push, ANTES do fuzz mapeado
— mas a decisão vivia como medição de custo, sem prova viva. Esta prova
simula um pre-push real com node_modules divergente e confirma que o
integrity falha ANTES do `run-mapped-fuzz` (exit 1 sem gastar ~6-14s de
fuzz) — o lado viva da decisão.

**Método** (sem tocar no repo real — a classe 8.5 é LOCAL e o CI instala do
lock fresco em checkout):

1. Repo sintético `/tmp/nmi-proof/{divergent,clean}`: `bun.lock` REAL copiado
   (resolve react/react-dom@19.2.3) + `node_modules/react/package.json` em
   19.2.99 (divergente) ou 19.2.3 (clean); react-dom em 19.2.3 nos dois.
2. `NODE_MODULES_ROOT` apontado para o root sintético (o env override do
   guard, via `cygpath -w` — o node no Windows resolve `C:\...`, não o
   `/tmp` do git-bash).
3. Hook `.husky/pre-push` REAL executado com stdin de push real (1 ref
   não-deleção: `refs/heads/ci-proof <local-sha> refs/heads/ci-proof
   <parent-sha>`) — a cadeia completa roda de verdade.

**Observado** (node 22.23.1 / Windows, git-bash, 2026-08-10):

```
$ { time -p printf '%s\n' "$STDIN_LINE" | NODE_MODULES_ROOT="$WIN_DIVERGENT" bash .husky/pre-push; } 2> time
HOOK_EXIT=1
real 6.45
...
check-push-deletion: not a pure deletion (0/1 refs are deletions) - run gates   <- nao e delecao: a cadeia roda
check-utf8: done (all clean)                                                     <- verify-encoding (UTF-8)
fragile-range: clean (150 gate files + 476 target files, ...)                    <- verify-encoding (layer 3)
UTF8-OK ... (~75 arquivos)                                                       <- check-docs-encoding (informativo)
check-node-modules-integrity: DIVERGENT react installed=19.2.99 locked=19.2.3    <- integrity: ULTIMA saida
check-node-modules-integrity: CURE: rm -rf node_modules && bun install --frozen-lockfile
```

**Evidências**:

1. **exit 1 e o integrity é a ÚLTIMA linha de saída** — o hook aborta ali
   (`set -euo pipefail`); o `run-mapped-fuzz` (linha 79 do hook) NUNCA é
   invocado: 0 execuções no log (as 6 menções a "fuzz" são os NOMES dos
   gate files listados pelo ASCII-OK do verify-encoding — run-fuzz.sh,
   format-fuzz-results.mjs, fuzz-targets.mjs, run-all-fuzz.mjs,
   run-mapped-fuzz.mjs, scan-fuzz-precommit.mjs).
2. **Wall-clock 6.45s** (verify-encoding + docs-encoding + integrity) — sem
   os ~6-14s típicos do fuzz mapeado (11.11): o integrity curto-circuitou o
   hook no 4º passo, exatamente o design da 11.17. Se o fuzz rodasse, o
   total seria ~12-20s.
3. **Controle (fixture válida)**: root clean → `clean (react/react-dom
   match bun.lock: 19.2.3/19.2.3; 0 extraneous top-level packages)` exit 0
   — o fixture sintético funciona; SÓ a divergência tripa.
4. **Ordem estrutural**: integrity na linha 66 do `.husky/pre-push`, fuzz
   na linha 79 — o integrity SEMPRE roda antes (e o DERIVATION PIN do
   scan-prepush-batch.test.ts trava a lista dos spawns).

**Gap protegido**: um node_modules divergente nunca mais gasta ~6-14s de
fuzz mapeado antes de falhar — o integrity (o guard da classe 8.5) aborta o
push no passo 4 com o caminho de cura exato, e o `run-mapped-fuzz` só roda
com layout íntegro. Repo real intocado (fixtures em /tmp, removidas ao
final; `git status` limpo).

## 11.20 ci-proof-run — custo real do ciclo por prova e o lever `--only-jobs` (medição 2026-08-10)

**A pergunta**: o ciclo ci-proof-run.mjs roda ~5-10min por prova (install +
suíte completa do pr-check + fuzz + benchmark). Medir o custo real de ponta
a ponta (run 31430040398 como referência) e avaliar se um modo `--only-jobs`
ou um dispatch direcionado ao job `check` cortaria o custo sem perder o sinal.

**A medição** (run 31430040398 — Prova 16, `PR Check` workflow_dispatch,
2026-08-10, breakdown por job via API):

| Job | Duração | Observação |
|---|---|---|
| utf8-check | 7s | o gate de encoding (rápido, sem deps) |
| Docs Encoding (informational) | 9s | nunca bloqueia |
| Fuzz Tests | 53s | batchado (11.12) |
| Geo Benchmark | 48s | gate geo |
| **check (o SINAL da prova)** | **2min47s** | `× REAL-REPO CONTRACT → expected 1 to be +0` — a prova já concluiu AQUI |
| Fragile Range Guard | skipped | `needs: check` da injeção da Prova 16 (check falhou) |
| **Security Headers** | **9min08s** | 🔴 **domina o run** — NENHUMA relação com guard proofs |
| **Total do run** | **9min12s** | o poll do helper espera o run inteiro |

**O achado central**: o sinal da prova (o job `check`) conclui em **2min47s**;
os outros **~6.4min** do ciclo são esperar o **Security Headers (9min08s)** —
um job que (a) não tem relação com o contrato sob prova, (b) falha por
causas pré-existentes (docs/security-headers-gate-2026-08.md) e (c) nem
rodou o sinal. O poll do helper (`gh run list ... até completed`) espera o
run INTEIRO, então o custo por prova é ~9.2min quando o sinal estava pronto
em ~2.8min.

**Veredito: ADOTAR `--only-jobs` (helper puro) — o dispatch direcionado é
REFUTADO.**

1. **`--only-jobs <job>`** (implementado neste delta): o poll termina quando
   o JOB alvo conclui (`gh run view <id> --json jobs` → break no
   `status: completed` do job), a conclusão verificada passa a ser a do JOB
   (não a do run — que pode nem ter terminado), e o log capturado é o do
   JOB (`--job <jobId> --log`). Custo do ciclo cai de ~9.2min para
   **~3min** (o check + overhead do poll) — **~3x mais rápido**, SEM
   nenhuma mudança de workflow (o pr-check.yml fica intocado: zero
   superfície de contrato tocada). O sinal não muda: o `--expect-log` casa
   no log do job, exatamente as linhas que a prova pina.
2. **Dispatch direcionado ao job `check`** (avaliado e REFUTADO): o GitHub
   Actions não tem dispatch por job nativo — exigiria um input
   `jobs:`/`check` no `workflow_dispatch` + `if:` em TODOS os jobs do
   pr-check.yml (um arquivo PINADO por contrato — scan-guard-gates rules
   1-9 + REAL-REPO CONTRACT). O ganho de wall-clock seria o mesmo do
   `--only-jobs`, mas: (a) tocaria um gate file com contrato (risco de
   drift/regressão que o `--only-jobs` não tem), (b) não economizaria os
   CI-minutes do Security Headers (o job ainda existiria no PR normal — a
   economia seria só no dispatch de prova, um caminho raro), e (c) o
   `--only-jobs` alcança o MESMO ~3min sem tocar em nada. O custo real do
   ciclo não é o CI billing (o run segue rodando Security Headers em
   background mesmo após o helper retornar) — é o wall-clock do dev
   esperando o sinal; é exatamente esse wall-clock que o `--only-jobs` corta.

**Nota honesta de fronteira**: o `--only-jobs` NÃO cancela o run — o
Security Headers (9:08) segue consumindo runner em background até o fim (o
helper só não ESPERA por ele). Se o objetivo for também economizar
CI-minutes (não só wall-clock), o caminho correto é tratar o
security-headers como o problema próprio dele (ver docs/security-headers-gate-2026-08.md),
não mascarar via input de dispatch.

**Comando (o ciclo agora termina no job, não no run):**

```bash
node scripts/ci-proof-run.mjs --branch ci-proof/<nome> --workflow pr-check.yml \
  --only-jobs check --expect failure --expect-log "REAL-REPO CONTRACT"
# o poll termina quando o job 'check' conclui (~3min vs ~9.2min do run inteiro)
# o nome casa com o DISPLAY name do job (name: ou o key quando não há name:)
# ex.: --only-jobs check e --only-jobs "Fuzz Tests" funcionam; o key cru "fuzz" não
```

**Default de `--timeout` calibrado (2026-08-10)**: o poll do `--only-jobs`
passou a usar **300s** como default (antes 900s do ciclo completo) — o job
alvo nunca passou de ~3min nas provas 13-19 (check concluiu em 2:47 no run
31430040398), então um default de 900s deixaria o poll esperar até 15min por
um job que nunca conclui. Nota de precisão: o 2:47 medido é a duração do
JOB (start→completed) — a janela real do poll inclui também fila/startup
do runner antes do primeiro `completed` (no run 31430040398 a fila foi
~4s, mas dias de fila cheia comem margem); 300s deixa ~2min de cabeça
sobre o job + fila típica, e o `--timeout` explícito existe para casos
patológicos de fila.

**Medição da fila real via API (2026-08-11, job started_at vs run
created_at — a lacuna margem documentada ↔ observada fechada):**

| Run | fila run→job (s) | job check (s) | janela total (s) | headroom 300s |
|---|---|---|---|---|
| Prova 16 (31430040398) | 4 | 167 | 171 | 129 |
| Prova 20 (31442006152) | 4 | 182 | 186 | 114 |
| Prova 21 (31444762608) | 9 | 171 | 180 | 120 |
| Prova 22 (31446588931) | 3 | 178 | 181 | 119 |

**Os três achados**: (1) a fila observada (3–9s, mediana 4s) **confirma**
o "~4s" documentado — o run criado e o job começam na mesma dezena de
segundos nos 4 runs; (2) o "2:47" documentado era o **mínimo** — o job
real variou 167–182s (o check não é determinístico em duração); (3) a
janela real run→completed é 171–186s, deixando **114–129s de headroom**
sobre o default de 300s (~1.6× a pior janela observada — 300/186). Para o
300s estourar num dia de fila cheia, a fila precisaria crescer **~14–41×**
sobre o observado (a derivação por linha: o 300s estoura quando fila >
300−job → Prova 16: 133/4 = 33×, Prova 20: 118/4 = 30×, Prova 21: 129/9 =
14×, Prova 22: 122/3 = 41× — o pior caso é o da Prova 21, fila 9s com job
171s) — a margem documentada "~2min de cabeça" é **confirmada pela
medição**, não só estimada; o `--timeout` explícito continua sendo a
válvula para o caso patológico. A
resolução vive numa função única (`resolveTimeout` em ci-proof-run.mjs,
compartilhada por parseArgs e planSteps — regra dos 2 usos): sem
`--only-jobs` o default continua 900s (o ciclo completo pode incluir jobs
lentos — Security Headers 9:08), e um `--timeout` explícito SEMPRE vence o
default calibrado. Travado no vitest (parseArgs: 300 com only-jobs / 900 sem
/ explícito vence; planSteps: o plano renderiza o timeout resolvido, não um
número pendente).

**Travado estruturalmente**: o `--only-jobs` é pinado no vitest (5 testes
novos no ci-proof-run.test.ts, suíte 31 testes): parseArgs (flag + usage),
planSteps (poll/captura job-scoped), E2E EARLY-EXIT (run in_progress
para sempre + job concluído → exit 0 no 1º poll do job — o coração do
lever), E2E job não encontrado (run completou sem o job → exit 3 com a
lista), E2E job in_progress até timeout (exit 3). O fixture fake-bins
modela `run view --json jobs` e `run view --job <id> --log` — a semântica
hermética, sem CI real.

**Prova 20 — o EARLY-EXIT ao vivo no CI real (2026-08-10, run
[31442006152](https://github.com/severinno/severinno/actions/runs/31442006152)):**
a prova viva que faltava à sec 11.20 (o EARLY-EXIT estava travado só
hermeticamente). Ciclo completo via `ci-proof-run --branch
ci-proof/only-jobs-live --workflow .github/workflows/pr-check.yml --mutate
'node <tmp>/prova20-mutate.mjs' --only-jobs check --expect failure
--expect-log 'REAL-REPO CONTRACT' --no-verify`, com a mutação conhecida da
Prova 16 (`needs: check` no job `fragile-guard` do pr-check.yml REAL — o
skip vector que a rule 5 existe para fechar; `--no-verify` porque o
pre-commit local bloqueia o commit da mutação, Prova 16 first-class no
helper).

- **Wall-clock medido com `time -p`: 207.28s (~3.5min)** para o ciclo
  INTEIRO (criação da branch scratch → mutação → commit → push → dispatch
  → poll → captura → verify → revert) — vs **9m12s** do run de referência
  31430040398 (que esperava o run inteiro, dominado pelo Security Headers
  9:08, job sem relação com o sinal). O lever corta ~2.7x o wall-clock da
  prova.
- **O sinal**: job `check` concluiu em **~3min** (started 23:21:14,
  completed 23:24:16) com conclusion=`failure`; no log job-scoped capturado
  (tmpdir, 5548 linhas): `× REAL-REPO CONTRACT ... → expected 1 to be +0`
  (o pin do pr-check.yml real sem `needs:`) + os mesmos guards irmãos
  (check-node-modules-integrity BASELINE + workflow-contracts LIVE
  TREE/GROWTH CONTRACTs — mesma raiz: o guard novo pega o `needs:` no
  arquivo real). O verify (`--expect failure` + `--expect-log
  'REAL-REPO CONTRACT'`) casou → **helper exit 0**.
- **A nota honesta da janela**: o run 31442006152 totalizou 3m07s porque o
  Security Headers FALHOU RÁPIDO (7s, dívida pré-existente do gate de rede)
  — o early-exit não foi exercitado contra um tail longo NESTE run. Mas o
  contrato que ele prova é estrutural: o poll termina quando o JOB alvo
  conclui (o run pode seguir in_progress), e a referência 31430040398 é a
  prova do caso em que o tail longo existia (9:08 de Security Headers) — o
  lever corta exatamente esse caso.
- **Revert byte-identical**: pr-check.yml md5 `a2d3aba4...` restaurado,
  branch scratch deletada (remote + local), de volta em
  `freebuff/new-thread-thmsitz5qutoia`; o delta uncommitted `--only-jobs`
  (4 arquivos) foi restaurado do backup (md5-identical) — o helper faz
  `git add -A` na branch scratch, então o delta foi varrido para o commit
  scratch e precisa de restauro pós-revert (detalhe documentado para o
  próximo ciclo com árvore suja).

## 11.21 O front path do pre-push: o awk do remote sha movido para dentro do checker (medição 2026-08-11)

**Pergunta**: o `.husky/pre-push` rodava `cat` + `printf|awk` + `printf|node` (3 subprocessos) no front path — o awk derivava o `PRE_PUSH_REMOTE_SHA` (base do `--since` do Gate 3) e o checker decidia a deleção pura. Avaliar mover o awk para dentro do `check-push-deletion.mjs` (1 spawn node no lugar de spawn node + subprocess awk), medindo o ganho no caminho de deleção pura e no misto.

**A/B honesto** (2026-08-11, node 22.23.1, Git Bash, 3 runs cada, fiacao exata do hook — stdin sintético pipado; warm = runs 2-3):

| Caminho | 3 runs | Média warm | Veredito |
|---|---|---|---|
| ANTIGO deleção pura (cat + awk + node) | 483 / 290 / 282ms | ~0.29s | — |
| NOVO deleção pura (1 spawn node) | 165 / 169 / 174ms | **~0.17s** | — |
| ANTIGO misto (cat + awk + node) | 289 / 283 / 279ms | ~0.28s | — |
| NOVO misto (1 spawn node) | 197 / 171 / 170ms | **~0.17s** | — |

**Decisão: ADOTADO.** O front path cai de 3 subprocessos (cat + printf|awk + printf|node) para **1 spawn node** — ~0.28s → ~0.17s warm (deleção pura E misto; o boot do node é o piso, a derivação em JS é <10ms). A derivação `deriveRemoteSha()` replica o awk byte-a-byte (a mesma regra `NR == 1 { first = $4 } $2 !~ /^0+$/ { real = $4 } END { print (real != "" ? real : first) }` em JS puro, validada contra 4 casos discriminantes no vitest — incluindo o push MISTO com deleção na 1ª linha, que o awk antigo acertava e um `NR == 1 { print $4 }` ingênuo erraria).

**O novo contrato de saída do checker**: stdout = o remote sha APENAS (o hook captura como `PRE_PUSH_REMOTE_SHA` para o Gate 3 — mensagens no stdout virariam um remote sha multi-linha e quebrariam o `--since`); stderr = mensagens; exit 0 = deleção pura (skip), exit 1 = roda gates. O footgun do awk antigo (o `exit` no corpo do awk imprimindo DUAS linhas) some: o checker tem um único `stdout.write`.

**Alterações**: `scripts/check-push-deletion.mjs` (novo `deriveRemoteSha()` exportado + main() escreve o sha no stdout e mensagens no stderr), `.husky/pre-push` (o bloco cat+awk substituído por `if PRE_PUSH_REMOTE_SHA="$(node scripts/check-push-deletion.mjs)"; then`), `scripts/__tests__/check-push-deletion.test.ts` (o describe que spawnava o awk virou pin puro de `deriveRemoteSha`; os asserts do CLI migraram stdout→stderr). O DERIVATION PIN do scan-prepush-batch (sec 11.17) continua passando: o spawn continua `node scripts/check-push-deletion.mjs` em linha não-comentário — só a frente mudou de 3 processos para 1.

**Custo por push**: o front path é o custo fixo de TODO push (deleção, misto, normal) — economiza ~0.11s/push. Pequeno, mas é o único spawn de subprocesso removível do caminho quente do hook (o integrity e o fuzz mapeado são gates reais, não fundíveis).

**Simulação viva pós-rewire** (2026-08-11, hook REAL, stdin sintético pipado): deleção pura → exit 0 com `[skip] pre-push: push de delecao pura` em **0.21s** (sem rodar a cadeia); misto (1 deleção + 1 ref real) → exit 0 com a cadeia RODANDO e passando (`[OK] pre-push: todos os gates passaram`, 0 `[skip]`) — o checker retorna exit 1 no misto e o hook corretamente roda os gates em vez de pular.

## 11.22 Poll adaptativo no ci-proof-run — avaliado e RECUSADO pela medição (avaliação 2026-08-11)

**A pergunta**: o `POLL_INTERVAL_MS` do ci-proof-run.mjs é fixo em 10s. Avaliar um poll adaptativo — frequente no início (5s até 60s de ciclo), espaçado depois (20s) — para o `--only-jobs` detectar a conclusão do job "~2x mais rápido" sem multiplicar as chamadas à API do GitHub em ciclos longos.

**A simulação honesta** (modelo fiel do loop: 1ª poll imediata em t=0, depois sleep do intervalo a cada iteração; detecção = 1ª poll com t >= conclusão; calls = polls até a detecção):

| Conclusão do job | fixed 10s | adapt 5s→60s→20s | Delta detecção | Delta calls |
|---|---|---|---|---|
| 7s (utf8-check) | 10s / 2 | 10s / 3 | 0s | +1 |
| 12s | 20s / 3 | 15s / 4 | **−5s** | +1 |
| 30s | 30s / 4 | 30s / 7 | 0s | +3 |
| 60s (fronteira) | 60s / 7 | 60s / 13 | 0s | +6 |
| **167s (o job check — o SINAL de toda prova, sec 11.20)** | **170s / 18** | **180s / 19** | **+10s MAIS LENTO** | +1 |
| 300s (timeout default do --only-jobs) | 300s / 31 | 300s / 25 | 0s | −6 |
| 552s (run completo 9:12) | 560s / 57 | 560s / 38 | 0s | −19 |
| 900s (timeout do ciclo completo) | 900s / 91 | 900s / 55 | 0s | −36 |

**O achado honesto**: a premissa "~2x mais rápido" vale só para jobs que concluem entre ~11-15s — a janela de 5s de granularidade fina antes do salto. O job que TODAS as provas esperam (o `check`, ~2:47 = 167s, sec 11.20) cai DENTRO da fase lenta (20s após 60s): detecção 180s vs 170s — **+10s PIOR** com +1 chamada. O adaptativo troca latência de detecção por parsimônia de API no EXATO caso que o helper existe para acelerar; e a economia de chamadas (−36 no run de 900s) vive no modo ciclo-completo que o `--only-jobs` (11.20) foi criado para evitar — onde 91 vs 55 chamadas por prova é ruído frente ao rate limit do GitHub (5.000/h autenticado; o ciclo de prova roda no máximo algumas vezes por sessão).

**Decisão: RECUSADO — `POLL_INTERVAL_MS` fixo em 10s mantido.** O lever real do wall-clock de prova não é o intervalo do poll (a detecção adiciona no máximo UM intervalo ao ciclo: 10s de ~3.5min = ~5%), é o próprio job (o `check`, 167s) e o setup do run. O 10s fixo é o ponto médio honesto entre granularidade (a detecção nunca atrasa mais que 10s além da conclusão) e volume de chamadas (≤91 num ciclo de 900s completo — irrelevante para rate limit). Um adaptativo que desse o "2x" prometido (5s fixo até a fronteira certa) multiplicaria as chamadas por ~2 na fase que importa — o trade que a proposta tenta evitar. Se um dia o run completo (sem --only-jobs) dominar as provas de novo, re-avaliar ancorando o threshold na DURAÇÃO REAL do job alvo — e a âncora DEVE passar da conclusão esperada (ex.: 5s até ~1.2× a mediana do check), nunca ficar abaixo (um threshold < conclusão manda o job alvo para a fase lenta e piora a detecção — o 0.8× avaliado aqui seria auto-derrotante: 134s < 167s → detecção ~175s, pior que o 170s fixo). Mesmo assim, com 5s até 1.2× a detecção só EMPATA com o 10s fixo ao custo de ~2× as chamadas — o 10s fixo continua o ponto médio honesto; a re-avaliação só valeria se o job alvo mudar de ordem de grandeza.

**Re-validação**: a decisão é doc-only (nenhum código mudou — o `POLL_INTERVAL_MS = Number(process.env.CI_PROOF_POLL_MS || 10_000)` e o seam `CI_PROOF_POLL_MS` dos testes E2E ficam intactos); `gates-proofs-ordering.test.ts` valida a monotonia da nova seção 11.22 (antes de 12).

## 11.23 Calibração de timeout por forma de ciclo — exclusiva do ci-proof-run (avaliação 2026-08-11)

**A pergunta**: o `resolveTimeout()` do ci-proof-run.mjs é o single source do default calibrado por forma de ciclo (900s ciclo completo, 300s com `--only-jobs`, um `--timeout` explícito sempre vence — sec 11.20) — mas só o helper o usa. Avaliar se o mesmo padrão deveria valer para outros waits de prova: o "poll do guard-gates no pre-commit" e o timeout do vitest nos E2E — ou documentar por que a calibração é exclusiva do helper de prova-CI.

**A checagem de premissa (a varredura dos waits reais do repo)**:

1. **Não existe poll no pre-commit (nem no pre-push).** O `.husky/pre-commit` é uma cadeia SÍNCRONA de gates locais (encoding + docs + lucide + next-types + batch runner + lint ∥ tsc + testes mapeados); o scan-guard-gates roda dentro do batch runner (run-precommit-guards.mjs) lendo arquivos, sem `setTimeout`/`sleep`/loop de espera. O grep de `while|until|sleep|poll|timeout` nos dois hooks é **vazio** — não há wait para calibrar onde a premissa sugere que exista.
2. **Os E2E não têm espera externa.** Os testes subprocess-heavy do ci-proof-run já carregam timeout EXPLÍCITO (`, 60000` — 22 ocorrências na suíte, o padrão do scan-timeouts guard que varreu 137 testes da classe de flake) e o `vitest.config.unit.ts` tem o `testTimeout: 30000` global como safety net documentado. Mas o ciclo E2E é hermético (fake bins + `CI_PROOF_POLL_MS=50`): cada teste conclui em segundos — o 60000 é um TETO DE FALHA para CI lento (fail loud), não um wait cuja duração a calibração deva otimizar. "Calibrar por forma de ciclo" ali seria calibrar nada.
3. **O único wait remoto do repo é o poll do ci-proof-run.** A varredura de `setTimeout|sleep|--poll|poll(` nos scripts (fora de __tests__) confirma: só o `ci-proof-run.mjs:505` espera um sistema EXTERNO (a API do GitHub) cuja duração é controlada pelos runners do GitHub — não-limitável localmente, não-observável sem poll. (O `setTimeout` de compare-benchmarks.mjs:303 é um teto de kill do subprocesso benchmark, local — não um wait externo; os `sleep` de backup-db.sh/check-health.sh/deploy.sh e demais scripts de ops são cadência operacional, fora do escopo de prova.)

**Decisão: RECUSADO — a calibração por forma de ciclo é exclusiva do helper de prova-CI, e por construção.** O `resolveTimeout` existe porque o ci-proof-run é o ÚNICO script com um wait cujo custo é wall-clock por prova (o poll remoto) e cuja duração vem de fora (GitHub). Um default calibrado só tem o que calibrar onde o wait é (a) externo e não-limitável, e (b) o gargalo do custo do ciclo — as duas condições só o poll do helper satisfaz. Os gates locais (pre-commit/pre-push) são síncronos e limitados pelo runtime local (fs + node + vitest): um default por forma não teria o que otimizar. Os timeouts do vitest são limites de FALHA (fail loud em CI lento), já padronizados pelo scan-timeouts guard (explicito 60000 + safety net 30000) — propósito oposto ao do default de espera, que otimiza o caso de sucesso.

**Condição de fronteira documentada**: se um SEGUNDO script ganhar um poll remoto (ex.: um futuro ci-helper de outro gate), o padrão do `resolveTimeout` deve ser EXTRAÍDO para um módulo compartilhado (a regra dos 2 usos do repo — como `parseRefLines`/`expectedTargetFiles`), NÃO duplicado — e o default por forma calibrado com a medição daquele wait específico. Até lá, o single source do ci-proof-run é o lugar certo e único.

**Re-validação**: a decisão é doc-only (nenhum código mudou — `resolveTimeout` segue exportado e consumido por parseArgs + planSteps dentro do helper, o single source da regra dos 2 usos); `gates-proofs-ordering.test.ts` valida a monotonia da nova seção 11.23 (11.22 antes, 12 depois).

## 11.24 writeGuardGatesWorkflow extraído — o 2º shape do push net (decisão 2026-08-11)

**A pergunta**: a família de fixtures do golden-copy-utils cobre o pr-check.yml (o twin PR — writePRWorkflow + irmãs), mas o guard-gates.yml (o push net) ainda era montado INLINE nos testes do scan-guard-gates (o writeWorkflow local). Avaliar se um 2º shape de mutação do push net já existe e merece um `writeGuardGatesWorkflow` irmão no golden-copy-utils, no mesmo padrão da regra dos usos.

**A checagem (o inventário dos shapes do push net — 3 suítes, 2 shapes + 1 variante)**:

1. **scan-guard-gates.test.ts — writeWorkflow local (~27 call sites)**: a base CLEAN (name: Guard Gates, on.push, jobs.guard-gates com o step test:guard) + o padrão `extra` de re-entry append (paths/paths-ignore/needs/comentários anexados após a linha 10 — o PIN `:10` do PATHS FILTER depende da base byte-identical: 9 linhas de conteúdo + o elemento vazio final que vira o `\n` antes do extra).
2. **guard-gates-exclusivity.test.ts — writePush local (3 call sites)**: o SEGUNDO shape — a mesma base do writeWorkflow MAS com `runs-on: ubuntu-latest` no job block, `paths` INLINE (após branches, não em extra) e o toogle `step:false` (o step lint no lugar do test:guard). 3 call sites (MODEL ANCHOR, REAL ANCHOR rule 4, REAL ANCHOR coexistencia).
3. **run-precommit-guards.test.ts — writeBadGuardNet (1 site)**: o push net com `runs-on` + step ERRADO (echo no test:guard) — a variante que dispara o TEST GUARD STEP MISSING no batch runner.

**Decisão: VALE ADOTAR — a regra dos usos está satisfeita (2 shapes repetidas × 3 suítes).** O `writeGuardGatesWorkflow(dir, opts)` extraído cobre as 3: a base byte-identical ao writeWorkflow antigo (o PIN `:10` do PATHS FILTER sobrevive — 9 linhas + `\n` + extra), com opts `{ name?, runsOn?, step?, extra? }`. O scanner ancora o step no `run:` key (TEST_GUARD_STEP_RE), NUNCA no nome do step — então o toogle `step:false` (lint step) e o `runsOn` são seguros para as 3 suítes sem mudar os sinais.

**O que cada consumidor ganhou**: scan-guard-gates perdeu o writeWorkflow local (27 call sites → helper, extra → `{ extra }`, o STEP MISSING inline → `{ step: false }`); o exclusivity perdeu o writePush local (3 call sites → `{ runsOn: true }` + paths via extra — o shape paths INLINE morreu, unificado no mecanismo extra que preserva o pin `:10`); o run-precommit perdeu o inline do push net do writeBadGuardNet (→ `{ name: "guard-gates", runsOn: true, step: false }`). **Ficou de fora por design** (regra dos usos — variantes single-use): o fixture do GUARD GATES JOB MISSING (job `lint:` no lugar de `guard-gates:` — shape distinta, 1 uso) e o twin PR (que já tem a família própria).

**Re-validação**: `golden-copy-utils.test.ts` (divergence guards) + `scan-guard-gates.test.ts` (30 stdout pins) + `guard-gates-exclusivity.test.ts` (matriz derivada + REAL anchors) + `run-precommit-guards.test.ts` (batch runner) — todas verdes; `gates-proofs-ordering.test.ts` valida a monotonia da nova seção 11.24 (11.23 antes, 12 depois).

## 11.25 Contrato fixture-vs-real — os blocos compartilhados vs os workflows reais (decisão 2026-08-11)

**A pergunta**: os job-blocks sintéticos (PR_JOB_BLOCKS no golden-copy-utils) espelham a shape real do pr-check.yml, mas nada garantia isso se o workflow real mudasse (ex.: novo job, step renomeado) — o fixture ficaria testando uma shape que o workflow real não tem mais. Avaliar um teste de contrato que compare os blocos compartilhados contra o pr-check.yml real via canonicalProgram — fechando o drift fixture-vs-real na mesma classe dos golden copies.

**O design (subset canônico, NÃO igualdade — o ponto honesto)**: os fixtures são MINIMAL por design — os jobs reais carregam checkout/setup-bun/cache/install que as fixtures omitem de propósito — então o contrato é: **cada linha canônica do fixture deve aparecer no bloco do job real** (subset), nunca igualdade (que quebraria por excesso de linhas reais). O helper `realJobBlock` extrai o bloco real do job key até o próximo job key de 2 espaços (ou EOF) e falha LOUD se o key sumiu (renomeio/remoção de job é fail-loud, nunca bloco vazio silencioso); `assertFixtureSubset` compara via canonicalProgram (indent/CRLF/comentários colapsam, token muda).

**O que o contrato pega** (a classe de drift dos golden copies aplicada aos fixtures): step renomeado (a linha do fixture deixa de aparecer), job key renomeado (realJobBlock lança), run: value mudado (o anchor que o scanner lê), job removido. **O que ele NÃO pega (e não deve)**: novas linhas reais (checkout etc.) — subset tolera por construção.

**Implementação**: `PR_JOB_BLOCKS` + `GUARD_PUSH_BASE` agora EXPORTADOS do golden-copy-utils.ts (o contrato precisa deles); novo describe no golden-copy-utils.test.ts com 6 testes: 2 REAL (PR twin + push net), 1 SHAPE PIN (a família cobre EXATAMENTE os 5 jobs ancorados pelo scanner — um 6º job ancorado precisa crescer o record E o pin, a direção de crescimento), 3 MUTATION (step renomeado, job key renomeado, run: value mudado).

**Re-validação**: `golden-copy-utils.test.ts` (32 testes, incl. o novo contrato) + `scan-timeouts.test.ts` (BASELINE) + suites irmãs (scan-guard-gates 30, exclusivity 15, run-precommit 7) — todas verdes; `gates-proofs-ordering.test.ts` valida a monotonia da nova seção 11.25 (11.24 antes, 12 depois).

## 11.26 O twin do writeBadGuardNet consome a família writePRWorkflow (decisão 2026-08-11)

**A pergunta**: o run-precommit-guards.test.ts também monta um pr-check.yml sintético (o twin PR do writeBadGuardNet) — avaliar se ele pode consumir a família writePRWorkflow do golden-copy-utils em vez do próprio inline, ou documentar por que a variante é shape única por design.

**O ACHADO (a razão de a resposta ser VALE ADOTAR)**: o twin inline antigo carregava um fragile-guard QUEBRADO (`- run: echo no test:guard` em vez do step test:guard) — mas esse step era **INERTE para o sinal**: o `missingStep` do scanner é SINGLE-VALUED (o PRIMEIRO workflow da rede sem o step, na ordem do manifest — GUARD_NET[0] = push net primeiro). O push net já reclama o missingStep, então o step quebrado do twin nunca aparecia na saída — o sole-failure pin ("a única violação é o TEST GUARD STEP MISSING do push net") valia APESAR do twin quebrado, não por causa dele.

**Decisão: VALE ADOTAR — o twin vira a shape CLEAN compartilhada (`writePRWorkflow(dir)`).** Benefícios vs o inline quebrado: (1) o pin sole-failure é PRESERVADO (a única violação continua sendo o push net — o twin limpo não adiciona linha nenhuma); (2) o twin limpo ganha a cobertura de drift da sec 11.25 (os blocos compartilhados são validados contra o pr-check.yml REAL — o twin antigo estava FORA dessa rede de proteção); (3) o inline de 24 linhas morre — o writeBadGuardNet agora usa só helpers compartilhados (writeGuardGatesWorkflow pro push net + writePRWorkflow pro twin) + o ci.yml (única variante que fica inline, a mesma decisão de fronteira da 11.24).

**Fronteira documentada (o que NÃO migrou)**: o ci.yml do writeBadGuardNet continua inline — é a 3ª shape de ci.yml (writeCIWorkflow no scan-guard-gates, writeCi no exclusivity, esta no run-precommit), a candidata a um writeCIWorkflow irmão quando a regra dos usos pedir (3 shapes já existem — decisão de extração em aberto, não desta seção).

**Re-validação**: `run-precommit-guards.test.ts` (7 testes, o teste do writeBadGuardNet asserta `TEST GUARD STEP MISSING in ${GUARD_PUSH_NET}` — inalterado) + `golden-copy-utils.test.ts` (32, o contrato fixture-vs-real agora cobre o twin limpo do batch runner) + `scan-guard-gates.test.ts` (30) + `scan-timeouts.test.ts` (BASELINE) — todas verdes; `gates-proofs-ordering.test.ts` valida a monotonia da nova seção 11.26 (11.25 antes, 12 depois).

## 11.27 `--mutate-self-delete` — o self-delete do script TEMP como contrato do runner (decisão 2026-08-11)

**A pergunta**: o ACHADO da Prova 22 (sec 8.17) — o script de mutação TEMP
(`scripts/prova22-mutate.mjs`) precisa se auto-deletar antes do `git add -A`
do helper, senão um `.mjs` solto entra no commit scratch (a superfície de
executáveis classificaria o arquivo e poluiria o sinal) — vive SÓ na prosa do
doc. A próxima prova teria que re-derivar o método. Avaliar uma flag
`--mutate-self-delete` (ou um helper de mutation script) no `ci-proof-run.mjs`
que embuta o self-delete como contrato.

**A decisão (VALE ADOTAR — flag, não helper de script)**: o self-delete vira
**propriedade do runner**, não do script. A flag `--mutate-self-delete <path>`
remove o path ANTES do `git status`/`git add -A` do ciclo (a ordem exata do
Prova 22), com **fail-loud**: se o path não existir após a mutação (ou não
for um arquivo — o guard de `lstatSync().isFile()` cobre diretório, que
passaria no `existsSync` e lançaria ERR_FS_EISDIR não tratado), exit 3
com a nota — um path errado deixaria um temp script real escapar no commit
(o no-op silencioso é a classe que o flag fecha). O script de mutação NÃO
deve mais se auto-deletar (o contrato é único — do runner); a docblock do
helper registra essa fronteira.

**Implementação** (`ci-proof-run.mjs` + `ci-proof-run.test.ts`): parseArgs
(flag + usage + validação `requer --mutate` — sem mutação não há script TEMP
a remover) · planSteps (passo `self-delete:` renderizado ENTRE o `shell:` e o
`git: add -A && commit` — a ordem do contrato no dry-run) · main()
(`path.resolve` + `fs.existsSync` fail-loud + `fs.rmSync` ANTES do `git
status --porcelain`). Testes: 3 PURE (parse/usage + requer --mutate; planSteps
com/sem a flag) · 3 FAKE-BIN E2E (sucesso: mutate cria script TEMP num tmpdir
hermético → runner o remove → commit acontece SEM o script, exit 0; fail-loud:
path inexistente → exit 3 SEM add/commit/push; usage: sem --mutate → exit 2,
zero invocations) · 1 REAL-REPO CONTRACT (o CLI real tem `fs.rmSync` ANTES do
`git status` + a flag no usage).

**Fronteira honesta**: a flag assume que a mutação cria o script no path
passado — o fail-loud cobre o caso de path errado (o recurso mais barato de
proteger). O helper de mutation script (gerar o script + auto-delete embutido)
foi recusado: a flag é 10 linhas, o helper seria um segundo caminho de
criação de script a manter — a regra dos usos ainda não pede (1 uso real: a
Prova 22).

**Re-validação**: `ci-proof-run.test.ts` (46 testes — 39 + 7 novos) +
`scan-timeouts.test.ts` (BASELINE) — verdes; `gates-proofs-ordering.test.ts`
valida a monotonia da nova seção 11.27 (11.26 antes, 12 depois); tsc 0;
eslint 0 erros; UTF-8 do doc OK.

## 11.28 O self-delete SCRIPT-OWNED — o padrão ORIGINAL da Prova 22 como contrato (decisão 2026-08-11)

**A pergunta**: a 11.27 travou o self-delete **do runner** (`--mutate-self-delete`
+ fail-loud — o script NÃO deve se auto-deletar quando a flag existe), mas o
método ORIGINAL da Prova 22 (sec 8.17) era **script-owned**: o
`scripts/prova22-mutate.mjs` se auto-deletava como última linha
(`fs.rmSync` de si mesmo via `fileURLToPath(import.meta.url)`), sem flag
nenhuma — e o CI tree ficava limpo. Nenhum teste pinava esse lado: o único
contrato de limpeza do tree era o do runner. Avaliar um teste de contrato
que prove que um mutate script auto-deletado não aparece no git status
pós-ciclo.

**A decisão (VALE ADOTAR — E2E hermético do caminho script-owned, sem código
novo)**: o par é mutuamente exclusivo POR DESIGN — flag + script que se
auto-deleta = fail-loud exit 3 (o path sumiu durante o spawn, antes de o
runner verificar — a classe que a 11.27 fecha) · sem flag + script que se
auto-deleta = o script próprio mantém o tree limpo e o ciclo segue. O teste
novo pina o SEGUNDO lado: um script REAL (num tmpdir hermético) que escreve
um marcador E se auto-deleta como última linha, rodado via `--mutate "node
<path>"` SEM flag. O observável: o script EXISTE antes do ciclo, o spawn do
mutate o roda (o marcador prova que executou) e o self-delete o remove
DURANTE o spawn — o `git status`/`git add -A` do ciclo (sequencial, DEPOIS
do spawn) nunca o vê. Asserts: exit 0 · marcador existe · `fs.existsSync` do
script = false pós-ciclo · stdout SEM a mensagem de remoção do runner (a
remoção foi do SCRIPT, não do runner) · commit aconteceu depois do spawn.

**Implementação** (`ci-proof-run.test.ts`, 46 → 47 testes): 1 FAKE-BIN E2E
novo (`E2E self-delete SCRIPT-OWNED`) ao lado dos três da 11.27 — o mesmo
padrão de tmpdir hermético + `MUT_MARKER` env para provar que o script
rodou antes de sumir.

**Fronteira honesta**: o contrato prova o SUMIÇO do script do disco e a
ordem do ciclo (spawn → status → add → commit) — não a saída textual do
`git status` (o fake bin scripta o status via `CI_PROOF_FAKE_DIRTY`; a
asserção real é que o arquivo não existe quando o add varre). A limpeza do
CI tree fica travada pelos dois caminhos: o do runner (11.27) e o do script
(11.28).

**Re-validação**: `ci-proof-run.test.ts` (47) + `scan-timeouts.test.ts`
(BASELINE) — verdes; `gates-proofs-ordering.test.ts` valida a monotonia da
nova seção 11.28 (11.27 antes, 12 depois); tsc 0; eslint 0 erros; UTF-8 do
doc OK.

## 11.29 O padrão `$HEALTH_URL` parametrizável — o guard pega o curl sem timeout MESMO via variável (decisão 2026-08-11)

**A pergunta**: o `scan-curl-timeouts` chaveia no token `curl` + flag
`--max-time` na linha lógica — mas o `health-check.sh:39` usa `$HEALTH_URL`
parametrizável (`HTTP_CODE=$(curl ... --max-time 20 --connect-timeout 10
"$HEALTH_URL" ...)`). Avaliar um teste de contrato que prove que o guard NÃO
deixa um curl sem timeout escapar via variável (o padrão que o incidente
original usava — o curl do test-security-headers.sh sem bound).

**O achado (por que VALE ADOTAR com 3 testes, não 1)**: o detector é
FLAG-based, não URL-form-based — o `maskBashStrings` mascarara o conteúdo da
string `"$HEALTH_URL"` mas o token `curl` (fora de string) e a flag
`--max-time` (literal na linha lógica) são o que conta. Logo o formato do
URL (literal vs variável) é IRRELEVANTE para a detecção — a indireção por
variável do URL não cria escape. O que faltava era NOMEAR essa fronteira: o
mutation `GATE_CURL` existente já usava `"$url"` (variável) e era flagado,
mas de forma incidental. Os 3 testes novos fecham a classe explicitamente:

1. **MUTATION (o padrão do incidente)**: `curl ... "$HEALTH_URL"` SEM
   `--max-time` → 1 violação na linha 3 (o URL ser variável não contrabandeia
   um curl sem bound).
2. **MUTATION (positiva)**: o MESMO formato com `--max-time "$HEALTH_TIMEOUT"
   --connect-timeout "$HEALTH_CONNECT"` (valores TAMBÉM parametrizados) →
   clean — o contrato é a PRESENÇA da flag literal, nunca o valor ou o
   formato do URL. Parametrizar o VALOR do timeout é o padrão saudável
   (single source of truth), nunca um bypass.
3. **REAL-REPO CONTRACT**: o `health-check.sh` real — o `--max-time` divide a
   MESMA linha lógica do `"$HEALTH_URL"` e o guard varre o arquivo real
   clean; um refactor futuro que mova o URL para variável SEM manter a flag
   na linha da invocação quebra o BASELINE — a fronteira vira contrato
   nomeado, não implicita pelo scan da superfície inteira.

**Fronteira honesta**: o escape que o guard NÃO cobre é o oposto do pedido —
esconder o TOKEN `curl` (não o URL) dentro de uma string avaliada depois
(ex.: `CMD="curl ..."; eval "$CMD"`): o `curl` mascarado não é uma
invocação real para o detector. Nenhum gate script do repo usa essa forma
hoje (mesma fronteira já documentada do masking: "a real invocation outside a
string counts") — e o custo de fechá-la (rastrear `eval` de strings com
`curl`) é alto demais para uma forma que não existe na superfície. A classe
que o pedido fechou — o URL parametrizável — está travada pelos 3 testes
acima.

**Implementação** (`scan-curl-timeouts.test.ts`, 14 → 17 testes): 3 novos ao
lado do mutation existente — 2 PURE (scanGateScript com root sintético) + 1
REAL-REPO (lê o health-check.sh real, asserta a linha do curl com `$HEALTH_URL`
e a flag na mesma linha).

**Re-validação**: `scan-curl-timeouts.test.ts` (17) + `scan-timeouts.test.ts`
(BASELINE) — verdes; `gates-proofs-ordering.test.ts` valida a monotonia da
nova seção 11.29 (11.28 antes, 12 depois); tsc 0; eslint 0 erros; UTF-8 do
doc OK.

## 12. Referências

- Investigação da falha contínua do `security-headers`: `docs/security-headers-gate-2026-08.md`
  (DNS aponta para WordPress na Hostinger, não para o VPS — não é regressão do app).
- Gates de encoding: `scripts/verify-encoding.sh`, `scripts/scan-non-ascii.mjs`,
  `scripts/fragile-range-patterns.mjs`, `scripts/verify-ascii-proof.sh`.
- Guard de bundle: `scripts/check-js-budget.mjs` + `docs/bundle-report.md`.

