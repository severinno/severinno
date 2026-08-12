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
| 24 | Encoding — **scan-eol-anchor BASELINE live no CI real** (Prova 25, sec 8.20; `scan-eol-anchor.mjs --ci` no job fragile-guard — a MESMA classe de step que a rule 10/sec 11.32 pina nos dois lados da rede) | O BASELINE local do eol-anchor (fixtures sintéticas) sem contraparte viva: um `.replace("...\n...")` cru commitado num teste seria pego localmente, mas faltava o guard `--ci` real falhar de ponta a ponta no CI com o caminho exato | `scripts/__tests__/prova25-eol-anchor.test.ts` com a âncora crua `.replace("...\n...")` na linha 7 (branch scratch `ci-proof/eol-anchor-live` via **`ci-proof-run --only-jobs "Fragile Range Guard" --expect failure --expect-log 'eol-anchor: string anchor with newline escape' --no-verify`**; mutation script `scripts/prova25-mutate.mjs` TEMP + self-delete — o ACHADO da sec 8.17; delta rule-10 stashed antes do ciclo para o `git add -A` do commit scratch não o varrer) | Run [**31480438465**](https://github.com/severinno/severinno/actions/runs/31480438465) (`PR Check`, event `workflow_dispatch`, branch scratch) | ✅ job `Fragile Range Guard` conclusion=`failure` — `eol-anchor: string anchor with newline escape in scripts/__tests__/prova25-eol-anchor.test.ts:7 (CRLF gate files silently no-op on newline anchors - Prova 17 ACHADO, sec 8.14; use replaceEolAgnostic from golden-copy-utils.ts)` → exit 1 com o caminho :7 exato (log via `gh api .../actions/jobs/93743904484/logs` — o capture job-scoped do helper veio vazio porque o run ainda estava in_progress quando o job Fragile Range Guard concluiu; ACHADO do helper na sec 8.20); revertido byte-identical (delta rule-10 restaurado do stash, 7 arquivos intactos, mutation script self-deletado) |
| 26 | Decisão da 11.31 — **`--connect-timeout` SOZINHO falha observado no pipeline real** (Prova 27, sec 8.22; `scan-curl-timeouts.mjs --ci` no job `Guard Gates` — a decisão da matriz como comportamento OBSERVADO no CI, não só no teste hermético) | A 11.31 travou a decisão no teste (linha da matriz) e no header; faltava a contraparte viva: o `--ci` REAL no pipeline com um gate script usando `curl --connect-timeout 10` SEM `--max-time` falhando com o caminho exato | linha `HTTP_CODE=$(curl -s -o /dev/null --connect-timeout 10 "$HEALTH_URL" 2>/dev/null || echo "000")` anexada ao fim do `scripts/health-check.sh` REAL (linha 57; branch scratch `ci-proof/connect-timeout-live` via **`ci-proof-run --workflow guard-gates.yml --expect failure --expect-log 'CURL WITHOUT --max-time in scripts/health-check.sh:57' --no-verify`**; mutation script `scripts/prova27-mutate.mjs` TEMP + self-delete — o ACHADO da sec 8.17) | Run [**31487497462**](https://github.com/severinno/severinno/actions/runs/31487497462) (`Guard Gates`, event `workflow_dispatch`, branch scratch; ciclo do helper com poll) | ✅ job `Guard Gates (fragile-range + golden-copy)` conclusion=`failure` — step `Scan gate-script curls for explicit timeouts`: `CURL WITHOUT --max-time in scripts/health-check.sh:57: HTTP_CODE=$(curl -s -o /dev/null --connect-timeout 10 ...` → exit 1 — a DECISÃO da 11.31 (connect-timeout sozinho NÃO bounds o total) observada no pipeline com o caminho :57 exato; **0 linhas `EVAL CURL` no log** — o tripwire não tripou (sem eval), só o DETECTOR falhou (o que prova que é a decisão da matriz, não o early-warning); revertido byte-identical (delta de 13 arquivos stashado ANTES do ciclo — o padrão da Prova 25 — e restaurado no pop, health-check.sh de volta a 56 linhas, mutation script self-deletado, branch deletada) | | A 11.30 provou localmente (probe + vitest) que o guard --max-time não vê o curl escondido em string avaliada depois; faltava a contraparte viva: o comportamento do `--ci` REAL no pipeline com um gate script usando `CMD="curl ..."; eval "$CMD"` sem timeout — a premissa original ('exit 0') estava SUPERSEDED pela 11.36 (o tripwire falha a forma) | linha `CMD="curl -s -o /dev/null -w \"%{http_code}\" \"$HEALTH_URL\" 2>/dev/null"; eval "$CMD"` anexada ao fim do `scripts/health-check.sh` REAL (linha 57; branch scratch `ci-proof/eval-live` via **`ci-proof-run --workflow guard-gates.yml --expect failure --expect-log 'EVAL CURL' --no-verify`**; mutation script `scripts/prova26-mutate.mjs` TEMP + self-delete — o ACHADO da sec 8.17) | Run [**31485163704**](https://github.com/severinno/severinno/actions/runs/31485163704) (`Guard Gates`, event `workflow_dispatch`, branch scratch; ciclo do helper **1m15s** — inclui o poll; a duração do job no run é menor, a convenção da sec 11.20) | ✅ job `Guard Gates (fragile-range + golden-copy)` conclusion=`failure` — step `Scan gate-script curls for explicit timeouts`: `EVAL CURL (sec 11.30) in scripts/health-check.sh:57: CMD="curl ..."; eval` → exit 1; **0 linhas `CURL WITHOUT --max-time` no log inteiro** — o falso-negativo do DETECTOR (11.30) observado vivo (o token mascarado realmente não gera violação de timeout) MAS o tripwire (11.36) falha a forma: o 'exit 0' da 11.30 está SUPERSEDED (virou exit 1 com o aviso); revertido byte-identical (13 arquivos do delta restaurados do commit scratch 86ff0b3, health-check.sh de volta a 56 linhas, branch deletada) |
| 27 | Regra 11 — **DANGLING NEEDS: a prova viva é ESTRUTURALMENTE IMPOSSÍVEL com a regra só no delta** (Prova 28, sec 8.23 — o ACHADO: o CI roda o HEAD, não o working tree; uma regra que vive só no delta não-commitado NUNCA chega ao CI pelo ciclo do helper) | A regra 11 (sec 11.33) só tinha prova sintética + REAL-REPO CONTRACT (o contrato falha LOCALMENTE com a mutação — o working tree tem a regra); faltava o lado vivo: o sinal `DANGLING NEEDS` no pipeline real | mutação `deleted-job-xyz` no `needs:` do job build do `.github/workflows/ci.yml` (linha 125; branch scratch `ci-proof/dangling-needs-live` via **`ci-proof-run --only-jobs check --expect failure --expect-log 'DANGLING NEEDS' --no-verify --timeout 900`**; mutation script `scripts/prova28-mutate.mjs` TEMP + self-delete; delta de 13 arquivos STASHADO antes do ciclo — o padrão da Prova 25) | Run [**31488081528**](https://github.com/severinno/severinno/actions/runs/31488081528) (`PR Check`, event `workflow_dispatch`, branch scratch; `--only-jobs check`) | ❌ **INCONCLUSIVA — o sinal NÃO pode disparar**: job `check` conclusion=`failure` MAS `DANGLING NEEDS` = **0 ocorrências** em 4458 linhas de log — o scratch branch nasce de HEAD via `git checkout -b` (helper) e o delta (com a regra 11) estava stashado: o CI rodou o scanner do HEAD de3994c, que NÃO tem a regra (grep `DANGLING NEEDS`: **0 no HEAD** vs **6 no working tree**); as 8 falhas do job (3 arquivos) foram AMBIENTAIS, NÃO da mutação: check-node-modules-integrity BASELINE (`expected 1 to be +0` — classe EXTRANEOUS hoist, Prova 13) + 6 cascatas no run-precommit-guards (o integrity sai 1 → batch sai 1) + blame-ignore-revs (shallow, Prova 13); scan-guard-gates.test.ts **passou** (a versão do HEAD não tem o contrato da regra 11 — a divergência com o probe local explicada); revertido byte-identical (delta restaurado do stash, branch deletada) — **a receita**: commit do delta primeiro, depois re-rodar o MESMO ciclo (ver sec 8.23) |
| 28 | Tripwire eval+curl — **lado PR no CI real** (Prova 29, sec 8.24; `scan-curl-timeouts.mjs --ci` no job `Fragile Range Guard` do pr-check — o par da Prova 26 fechado no OUTRO lado da rede, como as Provas 16/19) | A Prova 26 (sec 8.21, run 31485163704) provou o tripwire `EVAL CURL (sec 11.30)` no lado PUSH NET (guard-gates.yml); faltava o lado PR: o MESMO step `scan-curl-timeouts --ci` no job fragile-guard do pr-check falhando com a forma `CMD="curl ..."; eval "$CMD"` commitada | linha `CMD="curl -s -o /dev/null -w \"%{http_code}\" \"$HEALTH_URL\" 2>/dev/null"; eval "$CMD"` anexada ao fim do `scripts/health-check.sh` REAL (linha 58; branch scratch `ci-proof/eval-pr-live` via **`ci-proof-run --workflow pr-check.yml --only-jobs "Fragile Range Guard" --expect failure --expect-log 'EVAL CURL' --no-verify --timeout 600`**; mutation script `scripts/prova29-mutate.mjs` TEMP + self-delete runner-owned — o ACHADO da sec 8.17; delta com o tripwire varrido para o scratch pelo `git add -A` (padrão da Prova 26 — o CI roda o scanner COM o tripwire), backup md5 `cd1ed6a6...` tomado antes) | Run [**31492035257**](https://github.com/severinno/severinno/actions/runs/31492035257) (`PR Check`, event `workflow_dispatch`, branch scratch; `--only-jobs` — o run seguia em background quando o job concluiu) | ✅ job `Fragile Range Guard` conclusion=`failure` — step `Scan gate-script curls for explicit timeouts`: `EVAL CURL (sec 11.30) in scripts/health-check.sh:58: CMD="curl -s -o /dev/null -w "%{http_code}" "$HEALTH_URL" 2>/dev/null"; eval` → exit 1 (o caminho :58 exato; log via `gh api .../actions/jobs/93780586908/logs` — o capture job-scoped do helper veio vazio porque o run ainda estava in_progress, o MESMO ACHADO da sec 8.20/Prova 25; helper exit 1 no verify, sinal confirmado pelo fallback da API); **0 linhas `CURL WITHOUT --max-time`** — o falso-negativo do DETECTOR (11.30) E o tripwire (11.36) convivendo no MESMO step do lado PR; revertido byte-identical (delta restaurado do patch backup md5 pré=pós `cd1ed6a6...`, health-check.sh de volta a 56 linhas, mutation script self-deletado, branch deletada) |
| 29 | Residual split-form do tripwire — **exit 0 observado no pipeline real** (Prova 30, sec 8.25; `scan-curl-timeouts.mjs --ci` no job `Fragile Range Guard` do pr-check — a contraparte viva do exit 0 que a 11.30 prometia e a 11.36 removeu para a forma de linha única) | A Prova 29 (sec 8.24) provou o tripwire falhando a forma de LINHA ÚNICA (`CMD="curl ..."; eval "$CMD"` → exit 1); faltava o lado inverso: a residual ACEITA — `CMD="curl ..."` numa linha e `eval "$CMD"` na seguinte SEM continuação — passando no `--ci` REAL (o tripwire checa cada linha lógica com eval E curl juntos; o split tem curl na linha 58 e eval na 59, nenhuma tripa) | linhas `CMD="curl -s -o /dev/null -w \"%{http_code}\" \"$HEALTH_URL\" 2>/dev/null"` + `eval "$CMD"` em linhas SEPARADAS SEM continuação anexadas ao fim do `scripts/health-check.sh` REAL (linhas 58-59; branch scratch `ci-proof/split-live` via **`ci-proof-run --workflow pr-check.yml --only-jobs "Fragile Range Guard" --expect success --no-verify --timeout 600`**; mutation script `scripts/prova30-mutate.mjs` TEMP + self-delete runner-owned — o ACHADO da sec 8.17; dry-run local ANTES do ciclo: `SCAN_EXIT=0` + `EVAL CURL warnings: 0`; backup md5 `e15ea80b...` tomado antes) | Run [**31496492582**](https://github.com/severinno/severinno/actions/runs/31496492582) (`PR Check`, event `workflow_dispatch`, branch scratch; `--only-jobs` — o run seguia em background quando o job concluiu) | ✅ job `Fragile Range Guard` conclusion=`success` — step `Scan gate-script curls for explicit timeouts`: `curl-timeouts: clean (6 gate script(s) from workflows, every curl has --max-time and no eval+curl form - sec security-headers-gate ADOTADO / 11.36)` → exit 0 com o split-form commitado (log via `gh api .../actions/jobs/93795421197/logs` — o capture job-scoped do helper veio vazio/1-linha, o MESMO ACHADO da sec 8.20/Prova 25; sinal confirmado pelo fallback da API); **0 linhas `EVAL CURL` e 0 `CURL WITHOUT`** — a residual ACEITA (sec 11.36, split-form) atravessou o pipeline inteiro; o par fechado: linha única → exit 1 (Prova 29), split sem continuação → exit 0 (esta prova); revertido byte-identical (delta de 5 arquivos varrido para o scratch pelo `git add -A` do helper e restaurado do patch backup md5 pré=pós `e15ea80b...`, health-check.sh de volta a 56 linhas, mutation script self-deletado pelo runner, branch deletada) |
| 30 | Continuation-form do tripwire — **exit 1 observado no pipeline real** (Prova 31, sec 8.26; `scan-curl-timeouts.mjs --ci` no job `Fragile Range Guard` do pr-check — a contraparte viva do caso 2 da 11.36) | A Prova 30 (sec 8.25) provou a residual SEM continuação passando exit 0; o TERCEIRO caso da fronteira (sec 11.36, sondado 2026-08-11) — `CMD="curl ..." \` (backslash no fim da linha) + `eval "$CMD"` na linha seguinte COM continuação — é exatamente o que o joinContinuations junta numa linha lógica: o tripwire DEVERIA tripar na linha inicial; faltava a prova viva | linhas `CMD="curl -s -o /dev/null -w \"%{http_code}\" \"$HEALTH_URL\" 2>/dev/null" \` + `  eval "$CMD"` (linhas 57-59, o `\n` inicial do append cria a 57 vazia; branch scratch `ci-proof/cont-live` via **`ci-proof-run --workflow pr-check.yml --only-jobs "Fragile Range Guard" --expect failure --expect-log "EVAL CURL (sec 11.30) in scripts/health-check.sh:58" --no-verify --stash-uncommitted --timeout 600`**; mutation script `$TMPDIR/prova31-cont-mutate.mjs` fora do repo (nunca varrido pelo stash do `--stash-uncommitted` nem pelo `git add -A`) + self-delete runner-owned; dry-run local ANTES do ciclo: `SCAN_EXIT=1` + `EVAL CURL (sec 11.30) in scripts/health-check.sh:58`; backup md5 `54534137...` tomado antes) | Run [**31506284327**](https://github.com/severinno/severinno/actions/runs/31506284327) (`PR Check`, event `workflow_dispatch`, branch scratch; `--only-jobs` — o poll termina quando o job conclui) | ❌ job `Fragile Range Guard` conclusion=`failure` — `EVAL CURL (sec 11.30) in scripts/health-check.sh:58` no log do step `Scan gate-script curls for explicit timeouts` (log via `gh api .../actions/jobs/93828572718/logs` — o capture job-scoped do helper veio 1-linha, o MESMO ACHADO da sec 8.20/Prova 25; sinal confirmado pelo fallback da API); **o tripwire TRIPOU na linha INICIAL do comando lógico (58)** — o joinContinuations dobrou o par COM continuação numa linha lógica, o caso 2 da 11.36; o par fechado: linha única → exit 1 (Prova 29), split SEM continuação → exit 0 (Prova 30), continuação `\` → exit 1 (esta prova) — o que separa a residual do tripwire é a linha LÓGICA; revertido byte-identical (md5 `54534137...` pré=pós, health-check.sh de volta a 56 linhas, mutation script removido do tmpdir, branch deletada remote + local) |
| 31 | Lado POSITIVO do guard da sec 11.41 provado ao vivo: ciclo `ci-proof-run --stash-uncommitted` REAL com o delta não-commitado da thread — o stash preserva o delta durante o ciclo e o revert o restaura **byte-identical** (exit 0, run 31511149307) | O guard da sec 11.41 tinha prova LOCAL só do lado negativo (fail-loud exit 3 no repo real SEM a flag); o lado positivo (`--stash-uncommitted` preserva + restaura) tinha apenas prova hermética (E2Es com fake bins) — faltava a prova viva com um delta real | working tree com o delta de 12 arquivos da thread (10 M + 2 untracked); ciclo `ci-proof-run --branch ci-proof/stash-live2 --workflow pr-check.yml --only-jobs "utf8-check / UTF-8 Check" --expect success --stash-uncommitted --timeout 420`; baseline md5 pré-ciclo: STATUS `2c5fdcca...` + DELTA `2897b9b9...` + STASH 19 | Run [**31511149307**](https://github.com/severinno/severinno/actions/runs/31511149307) (`PR Check`, event `workflow_dispatch`, branch scratch `ci-proof/stash-live2`) | ✅ **exit 0** — `delta nao-commitado stasheado (git stash push -u)` → ciclo (job `utf8-check / UTF-8 Check` completed success) → `delta nao-commitado restaurado (git stash pop - sec 8.21)` + `revertido (... delta restaurado)`; pós-ciclo: STATUS `2c5fdcca...` (idêntico), DELTA `2897b9b9...` (**byte-identical**), STASH 19 (os pré-existentes intactos, o stash do helper consumido pelo pop), branch de volta em `freebuff/new-thread-thmsitz5qutoia`, remote limpo; ACHADO duplo na sec 8.27 (o nome composto dos reusable workflow calls + a re-normalização de EOL no round-trip do stash) |
| 32 | DOC COVERAGE do scan-exit-claims **falha com a seção exata no CI real** (Prova 33, sec 8.28; `workflow_dispatch` do pr-check com uma claim fake na sec 11.99 — o lado CI da classe 'claim de doc sem pin' da 11.42) | O DOC COVERAGE (doc → manifest: toda claim detectada tem entrada no EXIT_CLAIMS) tinha prova LOCAL sintética + o ACHADO do 1º run mostrou a premissa errada (a suíte é untracked, o CI roda o tree commitado SEM ela) — faltava o lado CI: uma claim fake injetada numa secção 11.x da doc real derrubando o teste no pipeline | ACHADO DO RUN 1 (#31515253099): `scripts/scan-exit-claims.mjs` + `scan-exit-claims.test.ts` são UNTRACKED (delta não-commitado da thread) — o CI roda o tree COMMITADO onde a suíte não existe, então o DOC COVERAGE NUNCA rodou (8 falhas pré-existentes de outras suítes, zero do scan-exit-claims); FIX: a mutação materializa os 12 arquivos do delta no scratch (o estado verde local) + injeta a secção fake `## 11.99 Claim fake da prova viva` com `**Exit codes**: exit code 3` antes do `## 12.` (branch scratch `ci-proof/exit-claims-live2` via **`ci-proof-run --workflow pr-check.yml --only-jobs check --expect failure --expect-log "doc -> manifest" --no-verify --stash-uncommitted --timeout 900`**; mutation script `$TMPDIR/prova33b-ec-mutate.mjs` fora do repo, lê os 12 arquivos de `/tmp/ec-src` copiados antes do ciclo; pre-flight hermético com `EXIT_CLAIMS_DOC` → `claim na secao 11.99 nao esta no EXIT_CLAIMS`) | Run [**31516054686**](https://github.com/severinno/severinno/actions/runs/31516054686) (`PR Check`, event `workflow_dispatch`, branch scratch; `--only-jobs` — o poll termina quando o job conclui) | ❌ job `check` conclusion=`failure` — no log do step `Unit tests`: `× scripts/scan-exit-claims.mjs - DOC COVERAGE bidirecional (sec 11.42) > doc -> manifest: toda claim de exit code detectada no doc REAL tem entrada no manifest` + `→ expected [ '11.99' ] to deeply equal []` (a SEÇÃO EXATA no assertion); 3 testes do scan-exit-claims falharam pela MESMA raiz (doc → manifest + checkExitClaims + REAL-REPO CONTRACT do CLI — todas flagrando a 11.99 não registrada); revertido byte-identical (STATUS `2c5fdcca...` e DELTA `8431a460...` pré=pós, STASH 19, branch de volta, remote limpo) |
| 33 | Tri-caso do tripwire **AGREGADO observado no pipeline real** (Prova 34, sec 8.29; `scan-curl-timeouts.mjs --ci` no job `Fragile Range Guard` do pr-check — as 3 formas na MESMA branch, em gate scripts DISTINTOS) | As Provas 29/30/31 provaram cada forma isolada em branch separada (linha única → exit 1, split → exit 0, continuação → exit 1); faltava o comportamento MULTI-FORMA num único pipeline: injetar os 3 casos de uma vez e confirmar que o job reporta EXATAMENTE os 2 que devem falhar e passa o split | 3 linhas anexadas ao fim de 3 gate scripts distintos numa branch scratch `ci-proof/tricase-live` via **`ci-proof-run --workflow pr-check.yml --only-jobs "Fragile Range Guard" --expect failure --expect-log "EVAL CURL (sec 11.30) in scripts/health-check.sh:58" --no-verify --stash-uncommitted --timeout 600`** (mutation script `$TMPDIR/prova34-tricase-mutate.mjs` fora do repo, self-delete runner-owned, caminho Windows via `cygpath -w` — o ACHADO da Prova 33); dry-run local ANTES do ciclo: `SCAN_EXIT=1` + exatamente **2 `EVAL CURL`** (health-check.sh:58 linha única + test-security-headers.sh:439 continuação) + zero para o split (check-utf8.sh) | Run [**31518328191**](https://github.com/severinno/severinno/actions/runs/31518328191) (`PR Check`, event `workflow_dispatch`, branch scratch; `--only-jobs` — o poll termina quando o job conclui) | ❌ job `Fragile Range Guard` conclusion=`failure` — log via `gh api .../actions/jobs/93868917658/logs` (o capture job-scoped do helper veio 1-linha, o MESMO ACHADO da sec 8.20/Prova 25): `curl-timeouts: 2 eval+curl form(s)` com **`EVAL CURL (sec 11.30) in scripts/health-check.sh:58`** E **`EVAL CURL (sec 11.30) in scripts/test-security-headers.sh:439`** — as 2 formas que devem trip, juntas, e **ZERO menção ao check-utf8.sh** (o split sem continuação passou na MESMA árvore); o comportamento multi-forma observado = a soma dos singles das Provas 29/31 com a residual da 30, agora num único pipeline; revertido byte-identical (STATUS `b67aa585...` pré=pós, STASH 19, alvos de volta a 56/437/167 linhas, branch deletada remote + local) |
| 34 | O push net **roda test:guard com as 13 suítes do package.json** (Prova 35, sec 8.30; `guard-gates.yml` via `workflow_dispatch` no job `Guard Gates` — a premissa invertida da sec 8.1, "scan-exit-claims FORA do test:guard", agora com prova viva) | O veredito da sec 8.1 ("test:guard = 13 suítes; o scan-exit-claims é um guard de batch do pre-commit que roda via test:unit, não no push net") tinha só prova local (grep + medição); faltava o log do CI mostrando o vitest rodando EXATAMENTE o conjunto do package.json — a evidência de que o 8º guard não pode entrar silenciosamente no net sem mudar o package.json | ciclo **`ci-proof-run --branch ci-proof/tg-suite-list --workflow guard-gates.yml --only-jobs "Guard Gates (fragile-range + golden-copy)" --expect success --stash-uncommitted --timeout 360`** (SEM mutação — a prova é o dispatch do workflow real na branch scratch; `--stash-uncommitted` preserva o delta da thread) | Run [**31526224328**](https://github.com/severinno/severinno/actions/runs/31526224328) (`Guard Gates`, event `workflow_dispatch`, branch scratch `ci-proof/tg-suite-list`; `--only-jobs` — o poll termina quando o job conclui) | ✅ job `Guard Gates` conclusion=`success` — log: **`Test Files 13 passed (13)`**; as 13 suítes listadas = **byte-exatas** às 13 do `test:guard` do package.json (fragile-range-guard, fuzz-mapped, golden-copy-utils, guard-gates-exclusivity, manifest-registry, run-all-fuzz, scan-batch-coverage, scan-prepush-batch, scan-fuzz-precommit, scan-guard-gates, scan-hook-parallel-race, scan-lint-staged-loader, scan-push-full-suite); **0 ocorrências de `scan-exit-claims`** no log inteiro (288 linhas) — a premissa da sec 8.1 confirmada no pipeline real; revertido byte-identical (STASH 19, branch deletada remote + local) |
| 35 | Guard do push net — **o sufixo `--since` no test:guard falha no CI real** (Prova 36, sec 8.31; `guard-gates.yml` via `workflow_dispatch` no job `Guard Gates` — a prova viva da sec 11.47) | A sec 11.47 registrou o veredito do lock (sufixo → `TEST GUARD STEP MISSING` com o path exato) mas sem prova viva no CI; faltava a contraparte observada: o sufixo `--since main` commitado no guard-gates.yml real fazendo o job do push net falhar de ponta a ponta no pipeline | `run: bun run test:guard` → `run: bun run test:guard --since main` no `guard-gates.yml` REAL (branch scratch `ci-proof/tg-suffix-live` via **`ci-proof-run --workflow guard-gates.yml --expect failure --expect-log "CACError" --no-verify --stash-uncommitted --timeout 360`**; mutation script `/tmp/prova36-suffix-mutate.mjs` fora do repo + self-delete runner-owned — o ACHADO da sec 8.17; pre-flight local: CLI real reporta `TEST GUARD STEP MISSING in .github/workflows/guard-gates.yml`) | Run [**31533234250**](https://github.com/severinno/severinno/actions/runs/31533234250) (`Guard Gates`, event `workflow_dispatch`, branch scratch `ci-proof/tg-suffix-live`; `--only-jobs` — o poll termina quando o job conclui) | ❌ job `Guard Gates` conclusion=`failure` — **ACHADO: o lock da 11.47 é DUPLO** — o step `Run guard vitest suites` rodou `bun run test:guard --since main` e o **vitest 3.1.1 NÃO tem a flag `--since`** (só `--changed`): `$ vitest run ... --since main` → `CACError: Unknown option '--since'` → exit 1 ANTES de qualquer suíte rodar (**0 ocorrências de `TEST GUARD STEP MISSING` no log — o guard nem chegou a rodar**; a classe do sufixo é travada pelo regex do scanner E pelo próprio CLI do vitest, dois locks independentes); revertido byte-identical (`run: bun run test:guard` de volta na linha 99, 0 ocorrências de `--since`, STASH 19 restaurado, branch deletada remote + local) |
| 36 | Guard git-based do doc commitado — **claim fake 11.99 bloqueia o push no pre-push local** (Prova 37, sec 8.32; `check-exit-claims-push.mjs` — a prova viva da sec 11.49, o guard local-only no hook) | A sec 11.49 tinha prova hermética (mutações + REAL-REPO CONTRACT do CLI) e real-repo local (controle `clean` exit 0), mas sem prova viva: faltava um commit REAL feito com HUSKY=0 escondendo uma claim nova ser bloqueado pelo push ANTES do fuzz mapeado — a classe 'commit com HUSKY=0/--no-verify esconde claim nova' | scratch `ci-proof/exit-claims-live` com o delta materializado (commit `40ad1d0`, o estado verde local — padrão da Prova 33) + claim fake `## 11.99` com `**Exit codes**: exit code 3` injetada antes do `## 12.` e **COMMITADA via `HUSKY=0 git commit`** (commit `ffb58de` — o commit que esconde a claim; o pre-commit local teria tripado o batch, daí o HUSKY=0) | **Local** — prova de hook REAL (o guard roda no `.husky/pre-push`; o CI nunca executa hooks locais — o padrão da Prova 17): push simulado `printf 'refs/heads/ci-proof/exit-claims-live <ffb58de> refs/heads/ci-proof/exit-claims-live <40ad1d0>' | bash .husky/pre-push` com `time -p` | ✅ hook **exit 1 em 4.47s real** — encoding gates limpos (UTF-8 OK + mjs-gate clean 47 files + fragile-range clean + yaml-gate clean) + integrity `clean` + **`exit-claims-push: 1 claim(s) NAO-registrada(s) no doc COMMITADO (HEAD) - sec 11.42/11.49:` → `claim na secao 11.99 nao esta no EXIT_CLAIMS (doc commitado - um commit com HUSKY=0/--no-verify pode ter escondido; registrar a claim - sec 11.49)`** → o hook morreu NO GUARD (`set -euo pipefail`): **0 execuções do run-mapped-fuzz** (as únicas menções a fuzz no log são os listings `ASCII-OK scripts/run-mapped-fuzz.mjs` da varredura mjs-gate, não o runner — o bloqueio veio ANTES do fuzz mapeado de ~6-14s); stderr: `check-push-deletion: not a pure deletion (0/1 refs are deletions) - run gates` (o atalho de deleção pura não interferiu); revertido byte-identical (MD5_IDENTICAL pré=pós nos 4 arquivos + STATUS_IDENTICAL, branch deletada, delta restaurado do patch + untracked) |
| 37 | Guard do push net — **a linha CURE como ÚLTIMA saída do bloqueio** (Prova 38, sec 8.33; `check-exit-claims-push.mjs` no pre-push local — a prova viva da CURE da sec 11.54/11.55 no hook) | A CURE da sec 11.54 foi pinada hermeticamente (testes do CLI + guard) mas sem prova viva no hook: faltava confirmar que o bloqueio do pre-push com a claim fake termina com a linha CURE no stdout — o dev bloqueado sabe EXATAMENTE como curar na hora, não só que foi bloqueado | claim fake `## 11.99 Claim fake da prova viva` / `**Exit codes**: exit code 3` injetada antes do `## 12.` e **COMMITADA via `HUSKY=0 git commit`** (commit `f00b59c` — o commit que esconde; scratch `ci-proof/cure-live` com o delta materializado `20e1e46`, o padrão da Prova 37) | **Local** — prova de hook REAL (o guard roda no `.husky/pre-push`; o CI nunca executa hooks locais — o padrão da Prova 17): push simulado `printf 'refs/heads/ci-proof/cure-live <f00b59c> refs/heads/ci-proof/cure-live <20e1e46>' | bash .husky/pre-push` com `time -p` | ✅ hook **exit 1 em 5.05s real** — encoding gates limpos (UTF-8 OK + mjs-gate clean, o listing ASCII-OK no log confirma que a varredura rodou e passou) + integrity `clean` + **`exit-claims-push: 1 claim(s) NAO-registrada(s) no doc COMMITADO (HEAD)` → `claim na secao 11.99 ...` → `CURE: registre a claim no EXIT_CLAIMS de scripts/scan-exit-claims.mjs (sec 11.42) e confirme com: node scripts/scan-exit-claims.mjs --check`** como **linha 210, a ÚLTIMA saída do guard** (nada roda depois — `set -euo pipefail` mata o hook ali); **0 execuções do run-mapped-fuzz** (só o listing ASCII-OK); pre-flight: guard exit 1 com a CURE na última linha; revert byte-identical (MD5 pré=pós + STATUS_IDENTICAL, branch deletada, delta restaurado) + controle pós-ciclo: guard exit 0 clean |
| 38 | Guard do push net — **o PAR CURE+stale no CLI real** (Prova 39, sec 8.34; `scan-exit-claims.mjs --check` contra a seção renumerada — a prova viva da sec 11.55, o pointer do stale no mesmo caminho de erro da CURE) | A sec 11.55 adicionou o pointer stale (a CURE de registrar é ENGANOSA para a classe stale — direção oposta) com pin hermético, mas sem prova viva: faltava confirmar que o CLI real, contra uma seção renumerada no doc COMMITADO, imprime o pointer stale JUNTO com a CURE — o dev vê os dois comandos no mesmo run | rename `## 11.42 ` → `## 11.98 ` no doc REAL (a seção 11.42 vira stale — entrada no EXIT_CLAIMS sem claim detectada — e a 11.98 vira unregistered — claim sem registro; **1 rename produz os DOIS sinais**, o par) COMMITADO via `HUSKY=0 git commit` (commit `befec6e` — o commit que esconde; scratch `ci-proof/stale-live` com o delta materializado `1bb6bbb`, o padrão da Prova 38) | **Local** — prova de CLI REAL (o mesmo detector que o batch do pre-commit e o test:unit rodam; a classe stale é CLI-only por design — o guard do push é direction-unique `.unregistered`, sec 11.49): `node scripts/scan-exit-claims.mjs --check` no scratch | ✅ CLI **exit 1** com o par completo: **`claim na secao 11.98` + `CURE: registre a claim no EXIT_CLAIMS...`** (bloco unregistered) **E** **`entrada 11.42 sem claim no doc atual` + `stale nao tem CURE de registrar - a secao foi renumerada/removida: atualize a secao no EXIT_CLAIMS ou remova a entrada (sec 11.42/11.55)`** (bloco stale) — as 4 linhas-chave, 1 ocorrência cada, no MESMO run; **o CONTRASTE**: o guard do push (`check-exit-claims-push.mjs`) no MESMO scratch lista SO o 11.98 (unregistered) e **0 menções a stale** — a divisão de trabalho da sec 11.49 (stale = ruído de delta, direction-unique) observada viva; revert byte-identical (STATUS IDENTICO + MD5 PRE=POS nos 5 arquivos, branch deletada, delta restaurado) + controle pós-ciclo: CLI `clean (27 claims)` exit 0 + 0 headers `## 11.98` reais |
| 39 | Guard do push net — **o CONTRASTE CURE + 0 stale via `hook-proof-run --mutate-doc-renumber`** (Prova 40, sec 8.35; renumber `11.58` → `11.98` — a prova viva da sec 11.59, o irmão automatizado da Prova 39) | A sec 11.59 adicionou o `--mutate-doc-renumber` (o irmão do `--mutate-doc-claim` da 11.58) com pin hermético (a suite + o dry-run), mas sem prova viva no hook: faltava confirmar que o ciclo completo num comando (backup → scratch → renumber commitado via HUSKY=0 → push simulado no hook real → revert byte-identical) produz o MESMO contraste da Prova 39 — o hook falha com a CURE do unregistered + 0 menções a stale | `node scripts/hook-proof-run.mjs --branch ci-proof/renumber-live --mutate-doc-renumber 11.58 --to 11.98 --expect-cure --expect-log 'claim na secao 11.98'` (scratch `ci-proof/renumber-live` com o delta da thread materializado; **o ACHADO do pedido**: o pedido citou 11.59, mas a sec 11.59 é claim-free (sem entrada no EXIT_CLAIMS, corpo sem token `exit N`) — renumerar seção claim-free produz ZERO sinal (sem unregistered, sem CURE); a fonte claim-bearing é a 11.58 (a 28ª claim, `current`), cujo body tem `exit code 0/1/2/3` detectáveis | **Local** — prova de hook REAL via o helper (o push simulado via stdin, sem rede): `time node scripts/hook-proof-run.mjs ...` | ✅ helper **exit 0 em 13.9s real** — hook **exit 1** com **`claim na secao 11.98` + `CURE: registre a claim no EXIT_CLAIMS...`** (linhas 210-211 do log capturado) e **0 menções a stale** (o contraste da sec 11.49: guard direction-unique `.unregistered`); fuzz mapeado NÃO rodou (só o listing ASCII-OK do mjs-gate — o bloqueio veio antes, `set -euo pipefail`); revert byte-identical (git status 13 linhas = snapshot do delta da thread) + controle pós-ciclo: CLI `clean (28 claims)` exit 0 + 0 headers `## 11.98` reais |
| 40 | Guard do renumber — **a COLISÃO de target fail-loud no repo REAL via `hook-proof-run`** (Prova 41, sec 8.36; renumber `11.58` → `11.42` — o 2º fail-loud da sec 11.59 com prova de pipeline) | A colisão de target (`to` já existente no doc) tinha E2E hermético (o teste da sec 11.59 + o irmão do no-op da 11.59) mas sem prova viva no repo REAL: faltava confirmar que o helper roda a mutação contra o doc real e o THROW vira exit 3 fail-loud com o caminho exato — fechando a classe com prova de pipeline, não só hermética | `node scripts/hook-proof-run.mjs --branch ci-proof/collision-live --mutate-doc-renumber 11.58 --to 11.42 --hook .husky/pre-push` (o doc REAL: a 11.42 existe — a colisão dispara o `toRe.test` da sec 11.59) | **Local** — prova de hook REAL via o helper (o doc real, o push simulado via stdin, sem rede) | ✅ helper **exit 3 fail-loud** — `renumberDocSection: secao '## 11.42 ' JA existe no doc (ou e a propria secao - no-op, sec 11.59) - a renumeracao criaria um header duplicado` com o `scratchLeftNote` (backup em tmp + a receita de limpeza); **o hook NUNCA rodou** (a mutação morre na etapa 4, antes do push simulado); **ACHADO do ciclo**: o fail(3) da mutação NÃO roda o revertCycle (por desenho — a scratch fica com a nota de limpeza), então o revert foi MANUAL no padrão do revertCycle: checkout da original + branch -D + `git apply delta.patch` + untracked restaurados do byte-copy (o `git add -A` do delta commit engoliu os 9 arquivos untracked da thread — a etapa que o revertCycle faz e o manual precisa lembrar) + doc do byte-copy → **byte-identical (md5 do doc OK + git status 17 linhas = snapshot, de volta em `freebuff/new-thread-thmsitz5qutoia`)** |
| 41 | doc-revalidate — **o caminho de ESCRITA real: upsert datado + idempotência do mesmo dia** (Prova 42, sec 8.37; `node scripts/doc-revalidate.mjs --doc <backup> --section 8.34` — o primeiro caminho de escrita REAL exercitado, contra um backup byte-identical do doc) | O helper tinha só prova hermética (funções puras + E2Es com fakes) + o REAL-REPO CONTRACT do `--dry-run` (que valida mas NADA escreve): o upsert datado e a idempotência por data nunca tinham tocado um doc real de verdade | `node scripts/doc-revalidate.mjs --doc /tmp/drv-proof-*.md --section 8.34` (backup byte-identical do doc real; CLI real do scan-exit-claims via EXIT_CLAIMS_DOC + a suite hermética do par) | **Local** — backup do doc real em /tmp, helper REAL (CLI + suite), doc da thread intocado (md5 pré=pós) | ✅ run 1 **upsertou** a linha automática `**Re-validação (2026-08-11, 28 claims)**` no fim da 8.34 (a linha manual `datada` INTACTA — prefixos diferentes, sec 11.61); **run 2 do MESMO dia idempotente** (1 auto line, REPLACE, a secão não cresceu); doc real **byte-identical (md5 OK)** + backup removido; **ACHADO**: o caminho da SUITE quebrava no Windows — o `DEFAULT_SUITE_CMD` usava o prefixo POSIX `NO_COLOR=1 ` que o cmd.exe rejeita (`'NO_COLOR' não é reconhecido`) — corrigido (NO_COLOR via env no spawn, nunca prefixo shell) |
| 42 | hook-proof-run — **o REVERT-FAIL no repo REAL: patch corrompido injetado → exit 3 fail-loud com o backup apontado** (Prova 43, sec 8.38; `--mutate` corrompe o `delta.patch` do backup do PRÓPRIO ciclo — o apply do revert falha) | O revertCycle tem 4 fail paths (checkout, branch -D, apply, status divergente) mas NENHUM tinha prova viva — só síntese (o fake-bins hermético nunca falha o apply): faltava confirmar o exit 3 fail-loud com o `- backup em <dir>` no repo real | `node scripts/hook-proof-run.mjs --branch ci-proof/revert-proof --mutate "node -e 'corrompe o delta.patch do hook-proof-* mais novo no tmpdir'" --expect-exit 0` (o mutate roda na etapa 4, APÓS o backup e ANTES do revert — o seam de injeção; hook real exit 0) | **Local** — ciclo real via o helper (delta real commitado no scratch + patch corrompido + hook real via stdin, sem rede) | ✅ helper **exit 3 fail-loud** — `git apply delta.patch falhou: error: No valid patches in input (allow with "--allow-empty") - backup em C:\...\hook-proof-JY7L0i` + scratchLeftNote; **ACHADO do ciclo**: o revert-fail roda DEPOIS do `branch -D` — a scratch já foi deletada com o commit do delta dentro (reflog `7074dab`) e o apply falhou → o working tree voltou LIMPO sem o delta; recuperado via safety diff externo (`git apply /tmp/prova43-safety.diff`) → **byte-identical (git status 12 linhas = snapshot, de volta em `freebuff/new-thread-thmsitz5qutoia`)** |
| 43 | hook-proof-run — **a prova viva do guard da 11.72: docblock `3 = falha de` removido no helper REAL → a suite falha com o caminho exato** (Prova 44, sec 8.39) | O guard da sec 11.72 (o contrato PROOF_HELPERS — as 3 partes do fail-loud por helper de prova) tinha prova hermética (MUTATIONs sobre cópias em tmp) mas sem prova viva no repo REAL: faltava confirmar que a suite le o docblock do ARQUIVO real e falha quando o `3 = falha de` some do `Exit codes:` | `cp scripts/hook-proof-run.mjs /tmp/prova44-hpr.bak && sed -i '68s/3 = falha de/X = falha de/' scripts/hook-proof-run.mjs && npx vitest run scripts/__tests__/proof-helpers-contract.test.ts --config vitest.config.unit.ts && mv /tmp/prova44-hpr.bak scripts/hook-proof-run.mjs` (a suite real contra o arquivo real mutado) | **Local** — mutacao do arquivo real + suite real, sem rede | ✅ suite **exit 1** — `hook-proof-run.mjs: o docblock deve documentar os exit codes 0-3` (o caminho exato do guard da 11.72, a parte (a) do EXIT_CODES_RE); restore byte-identical → suite verde de novo |
| 44 | scan-guard-gates — **a prova viva dos guards 11.73/11.82: hook-proof-run.test.ts ADICIONADO ao test:guard do package.json real → a suite falha com os 6 testes exatos** (Prova 45, sec 8.40) | Os pins da sec 11.73 (a divisão test:guard vs test:unit — o hook-proof-run NÃO pode entrar na lista curada) e da sec 11.82 (o ABS PIN das 14 suites) tinham prova hermética + REAL-REPO CONTRACT, mas sem prova viva: faltava confirmar que a suite lê o package.json REAL e falha quando a 15ª suite entra no test:guard — o cenário exato da MUTATION da 11.73 | `cp package.json /tmp/prova45-pkg.bak && node -e "...adicionar ' scripts/__tests__/hook-proof-run.test.ts' apos o doc-revalidate.test.ts no test:guard..." && npx vitest run scripts/__tests__/scan-guard-gates.test.ts --config vitest.config.unit.ts && mv /tmp/prova45-pkg.bak package.json` (a suite real contra o package.json real mutado) | **Local** — mutacao do package.json real + suite real, sem rede | ✅ suite **exit 1** — **6 testes falham** (REAL-REPO CONTRACT 11.73 + MUTATION 11.73 + REAL-REPO CONTRACT 11.82 + as 3 MUTATIONs 11.82 — 47 passam, 6 falham, todos no `scripts/__tests__/scan-guard-gates.test.ts`); restore byte-identical → suite verde de novo (53/53) |
| 45 | hook-proof-run — **o STATUS-DIVERGENTE ao vivo: flip do `.gitignore` no `--mutate` → stray.tmp sobrevive ao revert → git status diverge → exit 3 com a CURE do snapshot** (Prova 46, sec 8.41) | O stage `status` do `revertLeftNote` (sec 11.75) só tinha prova sintética (a matriz) — o apply-fail teve a Prova 43 ao vivo, o status nunca falhou no repo REAL: faltava a CURE do snapshot (`PASSou` + `status-before.txt` + reflog fallback) como comportamento de pipeline | `node scripts/hook-proof-run.mjs --branch ci-proof/hpr-statusdiv3 --mutate "touch stray.tmp && echo stray.tmp >> .gitignore" --expect-exit 0` (o FLIP: o `git add -A` do commit de mutação ignora o arquivo — um `touch` cru seria varrido e REMOVIDO pelo checkout do revert; o ACHADO do mecanismo veio do probe empírico) | **Local** — ciclo real via o helper (delta real commitado no scratch + flip injetado + hook real via stdin, sem rede) | ✅ helper **exit 3 fail-loud** — `git status divergiu do snapshot pre-ciclo` + a CURE do snapshot na mesma linha (o delta do ciclo JA esta na arvore + `status-before.txt` + reflog/cherry-pick fallback + safety diff externo); `rm stray.tmp` + git status byte-identical (17 linhas = snapshot, de volta em `freebuff/new-thread-thmsitz5qutoia`) |
| 46 | hook-proof-run — **o SAFETY-DIFF ao vivo: --mutate corrompe o delta.patch do backup → exit 3 com a CURE citando o safety diff → `git apply <sd>` recupera o delta TRACKED byte-identical** (Prova 47, sec 8.42)
| 47 | ci-proof-run — **o guard da 11.72 ao vivo no LADO ci: docblock `Exit codes:` mutado no ci-proof-run.mjs real → a suite da 11.72 falha com o path exato** (Prova 48, sec 8.43) | A Prova 44 (sec 8.39) provou o guard da 11.72 no hook-proof-run; o IRMÃO ci-proof-run do mesmo contrato (as 3 partes do fail-loud) seguia só com prova hermética — faltava confirmar que a suite lê o ci-proof-run.mjs REAL e falha quando o docblock perde o `3 =` | `cp scripts/ci-proof-run.mjs /tmp/prova48-cipr.bak && sed -i 's/3 = falha de/X = falha de/' scripts/ci-proof-run.mjs && npx vitest run scripts/__tests__/proof-helpers-contract.test.ts --config vitest.config.unit.ts` (o MESMO alvo do MUTATION hermético, a única ocorrência de `3 = ` no arquivo) | **Local** — mutação do source real + suite real, sem rede | ✅ suite **exit 1** — **1 teste falha** (`todo helper da DERIVADA tem as 3 partes`) com a mensagem exata `ci-proof-run.mjs: o docblock deve documentar os exit codes 0-3`; revert → sha1 `4bed5df4ac21` byte-identical, 0 ocorrências de `X = falha de` | | A fronteira da 11.77 (o revertCycle usa o backup; o safety diff é recuperação manual) vivia em prosa + teste hermético — faltava o pipeline real: o CLI apontando o safety diff NA CURE e o `git apply <path>` restaurando o delta de verdade | `node scripts/hook-proof-run.mjs --branch ci-proof/sd-live-proof --safety-diff <sd> --mutate "node -e \"const fs=require('fs'),os=require('os'),p=require('path');const d=fs.readdirSync(os.tmpdir()).filter(x=>x.startsWith('hook-proof-')).map(x=>({x,m:fs.statSync(p.join(os.tmpdir(),x)).mtimeMs})).sort((a,b)=>b.m-a.m)[0].x;fs.writeFileSync(p.join(os.tmpdir(),d,'delta.patch'),'corrompido')\"" --expect-exit 0` + `git apply <sd>` (a recuperação manual da 11.77) | **Local** — ciclo real via o helper (delta real de 17 linhas + safety diff externo + corrupção injetada + hook real via stdin, sem rede) | ✅ helper **exit 3 fail-loud** com a CURE 2-NÍVEIS citando `git apply <sd>`; `git apply <sd>` → diff sha256 byte-identical ao pré-ciclo (ca04632…); **ACHADO**: o safety diff recupera o TRACKED, mas os 5 untracked sumiram da árvore pós-revert — restaurados do `backup/untracked/` (a classe que o `--safety-backup` da 11.89 fecha); hook exit 1 por byte não-ASCII no DELTA PENDENTE da PRÓPRIA thread (`guard-remeasure.mjs:67` — a classe do mjs-gate), CORRIGIDO nesta registração |
| 48 | scan-unit-config — **a nota SERIALIZED POOL removida do config real → a suite da 11.80 falha com o path exato** (Prova 49, sec 8.44) | O pin da nota do singleFork (sec 11.80 poolNotePresent) e o pin da citação da planura (sec 11.95) tinham prova hermética (MUTATIONs sobre strings do config), mas sem prova viva — faltava confirmar que a suite da 11.80 lê o vitest.config.unit.ts REAL e falha quando a nota SOME (o cenário que o 10º guard do batch, scan-unit-config da sec 11.96, protege no pre-commit) | `cp vitest.config.unit.ts /tmp/prova49-vitest.bak && node -e "...remover do índice de '// SERIALIZED POOL' até a linha 'Pinned by scripts/__tests__/unit-surface-contract.test.ts.'..." && npx vitest run scripts/__tests__/unit-surface-contract.test.ts --config vitest.config.unit.ts` (a remoção do bloco = o MESMO alvo do MUTATION da 11.80, com o singleFork: true real intacto) | **Local** — mutação do config real + suite real, sem rede | ✅ suite **exit 1** — **4 testes falham** (REAL-REPO 11.80 + REAL-REPO 11.95 + 2 MUTATIONs da 11.95 em cascata) com o path `scripts/__tests__/unit-surface-contract.test.ts`; CLI `scan-unit-config: 1 violacao` com `vitest.config.unit.ts: o bloco '// SERIALIZED POOL' da nota (sec 11.80) ausente` + CURE; revert → sha1 `508929d5` byte-identical, CLI clean exit 0 |
| 49 | hook-proof-run — **revert-fail apply ao vivo com delta.patch do backup INTEGRO (sem knob): poison commit no branch original -> apply-fail exit 3; `git apply <backup>/delta.patch` (nivel 1) recupera byte-identical** (Prova 50, sec 8.45) | A CURE em 2 níveis da sec 11.75 (o nível 1 = `git apply <backup>/delta.patch` quando o patch é íntegro) só tinha pin hermético + a Prova 47 provou o caminho do patch CORROMPIDO (o nível 2) — faltava o pipeline real do nível 1: um revert-fail de apply com o delta.patch do backup INTEGRO (a injeção por conflito de árvore real, sem o knob hermético) e a recuperação via `git apply` | `node scripts/hook-proof-run.mjs --branch ci-proof/* --safety-diff /tmp/prova50-safety.diff --mutate ...` (a mutação commitou o poison `df9792d` na branch original — `scan-exit-claims.mjs` reduzido a `// POISON-L1`, um dos 16 arquivos do delta.patch) + recuperação: `git reset --hard 373bd74` + `git apply /tmp/hook-proof-RsCDqA/delta.patch` | **Local** — ciclo real via o helper (hook real passou via stdin; o revert falhou no apply com o patch íntegro; a recuperação nível 1 executada nesta continuação) | ✅ `git apply <backup>/delta.patch` → `APPLY_L1_OK`; `git status --porcelain` == snapshot (21 linhas = 16 M + 5 untracked); `git diff` sha256 == safety diff (`44c23838…`) — o delta recuperado byte-identical |

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

## 8.1 Custo por push (medição 2026-08-09, re-medido 2026-08-10/11/12) — por que o no-filter continua

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

**Re-medição 2026-08-11 (2)** (breakdown por step do run
[31522760166](https://github.com/severinno/severinno/actions/runs/31522760166) — prova viva com
**13 suítes / 269 testes** — dispatch do guard-gates.yml via ci-proof-run
numa branch scratch `ci-proof/guard-remed`, mesmo estado commitado
0508202, método da Prova 7):

| Step | Tempo | Observação |
|---|---|---|
| Set up job | 1.0s | overhead fixo do runner |
| checkout | 2.5s | sempre roda |
| setup-bun | 1.8s | sempre roda |
| Cache node_modules (restore) | 9.6s | sempre roda |
| **Install deps** | **9.8s** | `bun install --frozen-lockfile` (miss de cache do runner NESTE run — a variância do setup fixo, não das suítes) |
| **Run guard vitest suites** | **20.9s** | `bun run test:guard` (269 testes, 13 suítes) |
| **Scan subprocess-heavy tests** | 0.8s | `node scripts/scan-timeouts.mjs --ci` |
| **Scan gate-script curls** | 0.1s | `node scripts/scan-curl-timeouts.mjs --ci` |
| **Scan string \\n anchors** | 0.4s | `node scripts/scan-eol-anchor.mjs --ci` |
| Post Cache (upload) | 8.5s | sempre roda |
| **Total job** | **~57s** | job 18:26:58 → 18:27:55 — a variância vs ~43s da medição anterior é do SETUP fixo (install 9.8s vs ~1s neste run), não das suítes |

**A premissa do pedido invertida (medido)**: o 8º guard do batch
(scan-exit-claims, sec 11.42) NÃO entrou no test:guard — `grep
scan-exit-claims package.json` = 0. Ele é um guard do pre-commit
(run-precommit-guards.mjs), e a suíte dele (`scan-exit-claims.test.ts`)
roda via test:unit (config padrão), não no push net. O push net segue com
**13 suítes** — MAS os testes internos cresceram **236 → 269 (+33,
+14%)**, vindo das suítes do test:guard modificadas na thread
(scan-guard-gates regras 10/11, scan-batch-coverage DERIVATION PIN 7→8,
run-all-fuzz, etc.). O step test:guard ficou **plano**: 20.9s vs 20s
(+0.9s para +33 testes) — o +14% foi absorvido sem custo marginal
mensurável (a leitura "pelo paralelismo do vitest" está SUPERSEDED: sec
11.48 + re-medição (5) — `singleFork: true` desliga o file-parallelism,
a planura foi absorção de testes baratos; ver a Calibração CI-vs-local
abaixo). A variância do TOTAL (~57s vs ~43s)
é 100% do setup fixo (install 9.8s vs ~1s — miss de cache do runner), a
classe que um filtro `paths:` não reduziria. **O no-filter continua
calibrado — agora mais forte**: o 8º guard nem toca o push net (é
pre-commit + test:unit), e o crescimento interno foi absorvido com custo
plano.

Ground truth local (Windows, cache quente, 2026-08-11):
`bun run test:guard` 53.2s (269 testes, 13 suítes; 1º run frio 77.3s, 2º
run warm 53.2s) + `node scripts/scan-timeouts.mjs --ci` ~1.3s + `bun
install --frozen-lockfile` ~1.2s (warm). O local quente subiu 41.2s →
53.2s (+29% — as duas medições são de sessões DIFERENTES com variância
de carga, não um A/B limpo do +14% de testes; a CI absorveu o mesmo
crescimento com step plano 20→20.9s — a leitura "pelo paralelismo
multi-runner" está SUPERSEDED: o `singleFork: true` desliga o
file-parallelism (sec 11.48 + re-medição (5)), a planura foi absorção de
testes baratos, não workers; ver a Calibração CI-vs-local abaixo).

**Re-medição 2026-08-12** (breakdown por step do run
[31559349720](https://github.com/severinno/severinno/actions/runs/31559349720) — prova viva com
**14 suítes / 297 testes** — dispatch do guard-gates.yml via ci-proof-run
numa branch scratch `ci-proof/guard-remed3` (ciclo do helper 113s),
estado commitado do HEAD 1bb18de, mesmo método das re-medições anteriores):

| Step | Tempo | Observação |
|---|---|---|
| Set up job | 2s | overhead fixo do runner |
| checkout | 4s | sempre roda |
| setup-bun | 1s | sempre roda |
| Cache node_modules (restore) | 16s | sempre roda |
| **Install deps** | **13s** | `bun install --frozen-lockfile` (miss de cache do runner NESTE run — a variância do setup fixo, não das suítes) |
| **Run guard vitest suites** | **19s** | `bun run test:guard` (297 testes, 14 suítes) |
| **Scan subprocess-heavy tests** | ~1s | `node scripts/scan-timeouts.mjs --ci` |
| **Scan gate-script curls** | <1s | `node scripts/scan-curl-timeouts.mjs --ci` |
| **Scan string \n anchors** | <1s | `node scripts/scan-eol-anchor.mjs --ci` |
| Post Cache (upload) | 9s | sempre roda |
| **Total job** | **~65s** | job 03:12:37 → 03:13:42 — a variância vs ~57s da re-medição (2) é 100% do setup fixo (cache 9.6→16s + install 9.8→13s), NÃO das suítes (que CAÍRAM 20.9→19s) |

**Re-medição 2026-08-12 (4)** (breakdown por step do run
[31585318096](https://github.com/severinno/severinno/actions/runs/31585318096) — prova viva com
**14 suítes / 304 testes** — dispatch do guard-gates.yml via ci-proof-run
numa branch scratch `ci-proof/guard-remetric-4` (ciclo com
`--stash-uncommitted`, mesmo método das re-medições anteriores), estado
commitado do HEAD e50a186 — os +7 testes que a re-medição (3) viu no
working tree (doc-revalidate.test.ts) agora estão COMMITADOS: 297 → 304.
O hook-proof-run segue FORA do test:guard (`grep hook-proof-run
package.json` = 0 — é suíte de contrato via test:unit): medido 57 testes
commitados (64 com o delta da thread), não 48).

| Step | Tempo | Observação |
|---|---|---|
| Set up job | 1.2s | overhead fixo do runner |
| checkout | 3.5s | sempre roda |
| setup-bun | 1.8s | sempre roda |
| Cache node_modules (restore) | 12.2s | sempre roda |
| **Install deps** | **10.1s** | `bun install --frozen-lockfile` (miss de cache do runner NESTE run — a variância do setup fixo, não das suítes) |
| **Run guard vitest suites** | **22.2s** | `bun run test:guard` (304 testes, 14 suítes) |
| **Scan subprocess-heavy tests** | 0.7s | `node scripts/scan-timeouts.mjs --ci` |
| **Scan gate-script curls** | 0.1s | `node scripts/scan-curl-timeouts.mjs --ci` |
| **Scan string \n anchors** | 0.3s | `node scripts/scan-eol-anchor.mjs --ci` |
| Post Cache (upload) | 9.6s | sempre roda |
| **Total job** | **62s** | job 09:58:23 → 09:59:25 UTC — o setup fixo (1.2+3.5+1.8+12.2+10.1+9.6 = 38.4s) domina o total; o conteúdo guard = 23.3s (22.2 + 0.7 + 0.1 + 0.3) |

**A leitura honesta (a 1ª subida desde a re-medição (2))**: o step
test:guard SUBIU: 19s → 22.2s para +7 testes (+2.4% de carga, +17% de
step) — a série 20 → 20.9 → 19 → 22.2s quebra o padrão plano/queda das
re-medições 2-3. O custo absoluto (~22s) segue DENTRO da faixa de variância observada
do runner (banda 19-22.2s das re-medições 2-4; a variance de cache
commitada do workflow é 16.7-53.2s local) e o TOTAL (62s) é dominado pelo
setup fixo (38.4s) — a classe que um filtro `paths:` não reduziria. **O
no-filter continua calibrado, com o ALERTA de monitoramento**: se a
próxima re-medição confirmar a subida (e não variance), a decisão deve
ser re-aberta (a leitura original "o paralelismo estará saturando nos
workers" está SUPERSEDED: não há workers para saturar — `singleFork:
true`, sec 11.48 + re-medição (5); o alerta vigora pela banda, não pela
saturação).

Ground truth local 2026-08-12 (4) (Windows, cache quente, estado
COMMITADO do HEAD e50a186 — o delta da thread não toca suítes do
test:guard): `bun run test:guard` = 14 suítes / 304 testes, exit 0 — o
count do CI (#31585318096) bate exatamente com o commitado.

**Re-medição 2026-08-12 (5) — o paralelismo do vitest sob a lupa:
`--maxWorkers=1` vs default** (breakdown por step do run
[31587061757](https://github.com/severinno/severinno/actions/runs/31587061757) — prova viva com
**14 suítes / 304 testes (301 passam / 3 FALHAM — o trip do contrato, ver
abaixo)** — dispatch do guard-gates.yml via ci-proof-run numa branch
scratch `ci-proof/maxworkers-1`, com a MUTAÇÃO `bun run test:guard
--maxWorkers=1` no step, `--expect failure`, mesmo estado commitado do
HEAD e50a186):

| Step | Tempo | Observação |
|---|---|---|
| Set up job | 1.4s | overhead fixo do runner |
| checkout | 3.4s | sempre roda |
| setup-bun | 1.8s | sempre roda |
| Cache node_modules (restore) | 11.2s | sempre roda |
| **Install deps** | **8.2s** | `bun install --frozen-lockfile` (cache HIT neste run) |
| **Run guard vitest suites** | **23.5s** | `bun run test:guard --maxWorkers=1` (304 testes — 3 falham pelo trip do contrato) |
| Post Run checkout | 0.2s | sempre roda |
| **Total job** | **~50s** | job 10:21:44 → 10:22:34 UTC — NÃO comparável ao 62s da re-medição (4): o step test:guard FALHOU (3 trips de contrato) e o GitHub encerrou o job — os scanners (~1.1s) e o Post Cache (upload, ~9.6s na re-medição (4)) NUNCA rodaram. O gap ~12s é a truncagem (o cache hit responde por só ~3s: 11.2+8.2 vs 12.2+10.1). O A/B do STEP (23.5 vs 22.2s) não é afetado — o step rodou até o fim — e é a base da decisão. |

**O A/B medido (o número que o pedido pedia)**:

| Modo | Local (Windows, warm, 3 runs, working tree com o delta da thread — nenhum arquivo do delta está nas 14 suítes do test:guard) | CI (ubuntu, step test:guard, estado commitado do HEAD e50a186) |
|---|---|---|
| default (`singleFork: true` no config) | 57.4 / 53.3 / 53.4s (média **54.7s**) | **22.2s** (run 31585318096, re-medição (4)) |
| `--maxWorkers=1` | 54.5 / 50.1 / 48.1s (média **50.9s**) | **23.5s** (run 31587061757, este bloco) |
| `VITEST_MAX_FORKS=1` (env no step, `run:` intacto) | — (não re-medido — o A/B local da (5) já cobre a paridade) | **22.5s SUCCESS** (run 31595541005, re-medição (6) — o lado POSITIVO) |

**O ACHADO estrutural (a premissa do pedido estava invertida)**: o
`vitest.config.unit.ts` pina `pool: "forks"` + `singleFork: true` — o
test:guard JÁ roda num fork único; `--maxWorkers` é **no-op estrutural**.
O A/B confirma em ambas as pontas: local 54.7 vs 50.9s (ranges
sobrepostos, zero sinal — a diferença é ruído de sessão, o `--maxWorkers=1`
foi até MAIS rápido na média) e CI 23.5 vs 22.2s (dentro da banda
19-23.5s das re-medições 2-5). A narrativa "o paralelismo do vitest absorve
o crescimento" (re-medição (3) e o comentário do guard-gates.yml) está
**ERRADA**: não há paralelismo de arquivos no test:guard (singleFork). A
planura observada (20.9 → 19s com +28 testes) foi **absorção de testes
baratos** (fs/regex asserts), não workers.

**O trip do contrato (prova viva da barreira de pinar)**: pinar
`--maxWorkers` no step quebraria o regex EXATO
`/^\s+run:\s+bun run test:guard\s*$/m` do REAL-REPO CONTRACT
(scan-guard-gates.test.ts) + LIVE TREE (workflow-contracts.test.ts) — e o
run #31587061757 PROVOU ao vivo: **3 testes de contrato falharam**
(scan-guard-gates + guard-gates-exclusivity + o 3º file) com o sufixo no
`run:`.

**A decisão — RECUSADO o pin do `--maxWorkers`**: (1) é no-op estrutural
(o `singleFork: true` do config já é o pin de worker — o flag não muda o
pool); (2) o CI mede 23.5 vs 22.2s — dentro da banda de variância, ganho
zero; (3) pinar exigiria um REVERSAL consciente do regex exato para
benefício zero; (4) a variância da sec 8.1 (banda 19-23.5s) é
runner-side (cache/install/hardware), não de workers — o lever de
variância NÃO é o `--maxWorkers`. O pin REAL de worker já existe no
config (`singleFork: true`), e ele é a fonte da planura — não o flag.

**A premissa do pedido invertida (medido)**: o hook-proof-run (44 testes,
sec 11.58/11.69) NÃO entrou no test:guard — `grep hook-proof-run
package.json` = 0 (é suíte de contrato via test:unit, rodada nos guards de
pre-commit/push, não no push net). O crescimento real do test:guard foi a
14ª suíte (doc-revalidate, commitada no HEAD 1bb18de): 13 → 14 suítes e
269 → 297 testes (+28, +10%). O step test:guard ficou **plano/leve
queda**: 20.9s → 19s (−1.9s para +28 testes) — a planura (o
"paralelismo do vitest absorveu" está SUPERSEDED: sec 11.48 + re-medição
(5) — absorção de testes baratos, não workers) segue o MESMO padrão da
re-medição (2) (20 → 20.9s para +33 testes). A variância do TOTAL (~65s vs ~57s) é
100% do setup fixo (cache restore 16s + install 13s neste run), a classe
que um filtro `paths:` não reduziria. **O no-filter continua calibrado —
na re-medição (3): o custo das suítes nem subiu (caiu), e o guard novo que
o pedido citava nem toca o push net (a re-medição (4) acima mostra a 1ª
subida — ver o ALERTA de monitoramento).**

Ground truth local 2026-08-12 (Windows, cache quente, working tree com o
delta da thread): `bun run test:guard` **51.93s** (304 testes, 14 suítes —
+7 vs o commitado porque o doc-revalidate.test.ts não-commitado tem testes
novos) — abaixo do 53.2s de 13/269 da re-medição (2) — a leitura "o
paralelismo do vitest absorve o crescimento" está SUPERSEDED (sec 11.48
+ re-medição (5): `singleFork: true`, sem file-parallelism; a planura
foi absorção de testes baratos, não workers — ver a Calibração abaixo).

**Re-medição 2026-08-12 (6) — o lado POSITIVO do no-op do `--maxWorkers`:
workers forçado via env de step → SUCCESS limpo com a MESMA duração**
(run
[31595541005](https://github.com/severinno/severinno/actions/runs/31595541005)
— dispatch do guard-gates.yml via ci-proof-run numa branch scratch
`ci-proof/maxworkers-env`, `--expect success`, mesmo estado commitado do
HEAD e50a186):

- **A lacuna que a (5) deixou**: a re-medição (5) provou o no-op do
  `--maxWorkers` com um run de CI, mas o run FALHOU POR DESIGN (o sufixo
  `--maxWorkers=1` no `run:` tripou o regex EXATO do REAL-REPO CONTRACT —
  3 testes de contrato falharam). O lado POSITIVO faltava: forçar o env de
  workers SEM mutar o `run:` e confirmar SUCCESS + mesma duração.
- **A mutação contract-safe**: `env: VITEST_MAX_FORKS: 1` adicionado ao
  step test:guard do guard-gates.yml (o `run: bun run test:guard` INTACTO —
  o regex `/^\s+run:\s+bun run test:guard\s*$/m` das secs 8.4/11.47
  continua casando; pré-verificado localmente ANTES do ciclo: 72/72 testes
  de contrato verdes + CLI scan-guard-gates clean com a mutação aplicada).
  `VITEST_MAX_FORKS` é o env do pool FORKS (o pool ativo do `singleFork`);
  `VITEST_MAX_THREADS` não se aplicaria (pool threads não usado — o env
  errado provaria o no-op pelo motivo errado, o honesto é o var do pool).
- **O resultado**: job **success** — step test:guard **22.5s** (início
  12:15:34.49Z → fim 12:15:56.96Z; vitest reporta Duration 21.87s), 14
  suítes / **304 testes**, 0 warning-lines do step (o único `##[warning]`
  do log é a deprecação do Node 20 no `Complete job` — infra do runner,
  não do step).**Dentro da banda 19-23.5s das re-medições 2-6, idêntico
ao default 22.2s da (4)** — o env de workers forçado NÃO mudou nada.
- **O no-op fechado nos DOIS lados**: a (5) provou que `--maxWorkers=1`
  não muda a duração (run falho por trip de contrato — o sinal foi o
  tempo, não o exit); a (6) prova que forçar o env de workers tampouco
  muda (run SUCCESS limpo). O veredito da 11.48 (singleFork = o pin de
  worker, flag/env inertes) agora tem a contraparte viva positiva.

**Calibração CI-vs-local (2026-08-12) — o fato calibrado**: para a MESMA
lista (14 suítes / 304 testes), o local Windows quente mede ~50-55s e o
step do CI mede **19-23.5s** (re-medições 2-6: 20 → 20.9 → 19 → 22.2 →
23.5 → 22.5s — a (6) entrou na mesma banda com SUCCESS). A divergência (~2.5-3x) NÃO é paralelismo — o `singleFork: true`
do vitest.config.unit.ts desliga o file-parallelism e o `--maxWorkers` é
no-op estrutural (sec 11.48 + re-medição (5): CI A/B 22.2 vs 23.5s,
mesma banda). A divergência é hardware/plataforma (ubuntu runner vs local
Windows) + variância de carga de sessão (o local variou 41.2 → 53.2 →
51.93s em sessões DIFERENTES para a MESMA carga). **A regra de ouro**:
para decisões de CUSTO, medir SEMPRE no CI (o step de um run real — o
controle estável da banda 19-23.5s); o local é paridade/sanidade (counts
e exit code), NUNCA a baseline de custo. **Por que NÃO há teste de "lista
idêntica nos dois lados" (avaliado)**: o step do workflow roda `bun run
test:guard` (o script do package.json, a fonte única) — a lista NÃO tem
segundo lugar para driftar; o regex EXATO da 8.4 (REAL-REPO CONTRACT) +
a sec 11.73 já pinam a composição. Um teste de identidade de listas seria
uma tautologia (assertar que uma fonte única é igual a si mesma) — a
cobertura estrutural da lista (a fonte única + os pins citados) já
existe.

**Decisão (avaliada, 2026-08-09, re-avaliada 2026-08-10, 2026-08-11 e
2026-08-12): o
no-filter documentado continua correto.** Um filtro `paths:` por superfície
de gate file teria que replicar a superfície derivada (`TARGET_DIRS` + gate
files) num segundo lugar — um novo ponto de drift (a classe que o SPREAD
CONTRACT elimina) — e um push tocando só uma árvore que o filtro esqueceu
skiparia o net em silêncio: o risco de órfão que o workflow existe para
fechar. Com o guard net custando ~23s de CI (22.2s test:guard + ~1s dos
scanners, re-medição (4)), a economia máxima teórica de um filtro é ~23s
por push que toca a superfície — e o único push skipável sem perda seria
um docs-only (que a superfície não cobre mesmo). O net incondicional
mantém o BASELINE estruturalmente garantido de rodar em todo merge; o
crescimento das suítes (8 → 14) não mudou a equação: o total por push
permaneceu estável na faixa ~43-65s — a variância é 100% do setup fixo
(cache + install), não das suítes (que ficaram na faixa 19-22.2s: 20 →
20.9 → 19 → 22.2s — a re-medição (4) mostra a 1ª subida, ver o ALERTA de
monitoramento).

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

## 8.20 Prova 25 — eol-anchor BASELINE live no CI real (run 31480438465, 2026-08-11)

- **Por que esta prova (a avaliação VALE ADOTAR)**: o scan-eol-anchor (o guard
  de âncoras de string com newline em gate files — o ACHADO da Prova 17, sec
  8.14) tinha BASELINE local (fixtures sintéticas em
  `scan-eol-anchor.test.ts`) mas nenhuma prova viva no CI real: um
  `.replace("...\n...")` cru commitado num teste seria pego LOCALMENTE pelo
  pre-commit, mas faltava o lado CI — o step `node scripts/scan-eol-anchor.mjs
  --ci` do job fragile-guard (a MESMA classe de step que a rule 10/sec 11.32
  pina nos dois lados da rede) falhar de ponta a ponta no pipeline com o
  caminho exato.
- **A injeção** (branch scratch `ci-proof/eol-anchor-live`): mutation script
  TEMP `scripts/prova25-mutate.mjs` (CRLF-safe, self-delete antes do `git add
  -A` — o ACHADO da sec 8.17) que escreve `scripts/__tests__/prova25-eol-anchor.test.ts`
  com a âncora crua na linha 7: `.replace("...\n...")` — o escape de newline
  em string que o guard sinaliza.
- **Disparo**: **`ci-proof-run --branch ci-proof/eol-anchor-live --workflow
  .github/workflows/pr-check.yml --only-jobs "Fragile Range Guard" --expect
  failure --expect-log 'eol-anchor: string anchor with newline escape'
  --no-verify`** (o delta rule-10 uncommitted foi STASHED antes do ciclo — o
  `git add -A` do commit scratch varreria o delta para o commit de prova e o
  perderia no revert; restaurado do stash após, como nas Provas 22/24 com o
  backup md5). O `--only-jobs` mirou o job Fragile Range Guard (display name do
  job fragile-guard — o mesmo que roda o eol-anchor `--ci`), não o run inteiro.
- **O sinal (2026-08-11 10:03Z)** — job `Fragile Range Guard` (job
  93743904484) conclusion=`failure`, step `node scripts/scan-eol-anchor.mjs
  --ci`:

```
eol-anchor: string anchor with newline escape in scripts/__tests__/prova25-eol-anchor.test.ts:7 (CRLF gate files silently no-op on newline anchors - Prova 17 ACHADO, sec 8.14; use replaceEolAgnostic from golden-copy-utils.ts)
```

  → **exit 1 com o caminho :7 exato** — o guard `--ci` real falhou com a
  MESMA mensagem do BASELINE local (probe local pré-ciclo: o MESMO sinal,
  exit 1). O ACHADO da sec 8.14 agora tem prova viva do outro lado do ciclo:
  o pre-commit local E o CI real travam a classe.
- **ACHADO do helper (captura job-scoped)**: o `--job --log` do ci-proof-run
  capturou **1 linha** (`run 31480438465 is still in progress; logs will be
  available when it is complete`) — o run INTEIRO ainda estava in_progress
  quando o job Fragile Range Guard concluiu (o job `check` seguia rodando), e
  o `gh run view --job --log` se recusa a capturar enquanto o RUN (não o job)
  não completou. O log foi obtido via a API de logs do job — `gh api
  repos/severinno/severinno/actions/jobs/93743904484/logs` — que funciona
  mid-run. O sinal está no log API (linha 299), não no log do helper.
  Consequência honesta: o helper saiu **exit 1** (o `--expect-log` não casou
  com a captura vazia — o verify do helper falhou, mas o revert aconteceu
  mesmo assim, o contrato do helper: a branch scratch nunca fica no remote).
  Limitação real do helper a considerar (decisão de fix à parte, registrada
  aqui como comportamento observado).
- **Reversão**: revert byte-identical — o ciclo reverteu (push --delete da
  scratch, checkout da original, branch -D); o delta rule-10 (7 arquivos
  modificados) restaurado do stash com `git status` idêntico ao pré-ciclo
  (stash pop → 7 arquivos M exatos); mutation script TEMP self-deletado (zero
  resíduos).
- **Gap protegido**: o BASELINE do eol-anchor agora tem prova viva do outro
  lado do ciclo — o guard `--ci` no job fragile-guard falha de verdade no CI
  real com o caminho exato quando a classe é injetada, e a MESMA superfície
  (os 3 scanner steps `--ci`) é pinada pela rule 10/sec 11.32 nos dois lados
  da rede (remover o step do workflow quebra o contrato do push net).

## 8.21 Prova 26 — o falso-negativo do `eval` observado no pipeline real (run 31485163704, 2026-08-11)

**A pergunta**: a 11.30 provou localmente (probe + vitest) que o guard
--max-time NÃO vê um curl escondido em string avaliada depois
(`CMD="curl ..."; eval "$CMD"` — o token vive DENTRO da string, o
maskBashStrings o consome). Faltava a contraparte viva: o comportamento do
`scan-curl-timeouts --ci` REAL no pipeline com a forma num gate script de
verdade.

**A premissa corrigida (medição antes de decidir)**: o pedido assumia
'confirme que passa (exit 0)' — a premissa da 11.30. MAS a 11.36 (o
tripwire) mudou o comportamento do CLI: a forma agora FALHA (exit 1) com o
aviso `EVAL CURL (sec 11.30)`. A prova viva não confirma o exit 0 — ela
observa a fronteira COMO ESTÁ hoje: o falso-negativo do DETECTOR (nenhum
`CURL WITHOUT --max-time`) E o tripwire (o aviso) convivendo no MESMO step.

**A mutação**: linha `CMD="curl -s -o /dev/null -w \"%{http_code}\"
\"$HEALTH_URL\" 2>/dev/null"; eval "$CMD"` (a forma EXATA da 11.30)
anexada ao fim do `scripts/health-check.sh` real (linha 57), branch scratch
`ci-proof/eval-live`, via **`ci-proof-run --workflow guard-gates.yml
--expect failure --expect-log 'EVAL CURL' --no-verify`** (mutation script
TEMP + self-delete, o ACHADO da sec 8.17). O dispatch do guard-gates.yml
(workflow_dispatch, job único) roda o step `node scripts/scan-curl-timeouts.mjs
--ci` de ponta a ponta no runner real — sem test:guard na frente que
masque o step (o scan-curl-timeouts.test.ts NÃO está no test:guard, só no
test:unit — medido no package.json).

**O resultado observado** (run 31485163704, ciclo do helper 1m15s — o wall-clock LOCAL do ci-proof-run inclui o poll; a duração do job no run é menor, convenção da sec 11.20 —, helper exit 0):
1. **Step `Scan gate-script curls for explicit timeouts` → failure**:
   `EVAL CURL (sec 11.30) in scripts/health-check.sh:57: CMD="curl -s -o
   /dev/null -w \"%{http_code}\" \"$HEALTH_URL\" 2>/dev/null"; eval` →
   exit 1 (job `Guard Gates (fragile-range + golden-copy)`
   conclusion=failure).
2. **0 linhas `CURL WITHOUT --max-time` no log inteiro** — o falso-negativo
   do DETECTOR (11.30) observado no pipeline: o curl eval'd realmente não
   gera violação de timeout (o token mascarado é invisível ao
   scanGateScript). A ÚNICA razão do exit 1 é o tripwire (11.36).
3. Revertido byte-identical: o `git add -A` do commit scratch varreu TODO o
   delta não-commitado da thread (13 arquivos) — recuperado do commit
   scratch 86ff0b3 (cherry-pick -n + unstage + `git checkout HEAD --
   scripts/health-check.sh` para desfazer a mutação); git status = delta
   original intacto, health-check.sh 56 linhas. **FECHADO pela sec 11.41**
   (o runner agora tem o guard da árvore suja — fail-loud exit 3 antes do
   ciclo — + `--stash-uncommitted`: o delta é preservado e restaurado no
   revert; a classe não volta a ocorrer).

**O veredito**: a fronteira está documentada como comportamento OBSERVADO
no pipeline: a 11.30 (falso-negativo do detector) continua verdadeira em CI
(sem CURL WITHOUT) — mas o CLI exit 0 da 11.30 está SUPERSEDED pela 11.36
(o tripwire falha a forma com o aviso). O par fecha: quem ler a 11.30 vê o
mecanismo real no pipeline; quem ler a 11.36 vê que a forma não passa mais
em silêncio (EVAL CURL, exit 1).

## 8.22 Prova 27 — a decisão do `--connect-timeout` sozinho observada no pipeline real (run 31487497462, 2026-08-11)

**A pergunta**: a 11.31 travou a decisão do `--connect-timeout` sozinho
(FALHA — ele bounds apenas a fase de connect, um stall de corpo pós-
connect ainda penduraria o CI; só o `--max-time` bounds o TOTAL, a classe-
killer) como contrato no teste (a linha da matriz) e no header. Faltava a
contraparte viva: o comportamento do `scan-curl-timeouts --ci` REAL no
pipeline com a forma num gate script de verdade.

**A prova** (branch scratch `ci-proof/connect-timeout-live` via
`ci-proof-run --workflow guard-gates.yml --expect failure --expect-log
'CURL WITHOUT --max-time in scripts/health-check.sh:57' --no-verify`;
mutation script `scripts/prova27-mutate.mjs` TEMP + self-delete — o ACHADO
da sec 8.17; o delta de 13 arquivos da thread foi STASHADO antes do ciclo —
o padrão da Prova 25 — para o `git add -A` do commit scratch não o varrer):

1. **A mutação**: a forma da decisão — `HTTP_CODE=$(curl -s -o /dev/null
   --connect-timeout 10 "$HEALTH_URL" 2>/dev/null || echo "000")` —
   anexada ao fim do `scripts/health-check.sh` REAL (linha 57; o mesmo
gate script e a mesma posição da Prova 26).
2. **O observado** (run 31487497462): job `Guard Gates (fragile-range +
   golden-copy)` → **failure**; step `Scan gate-script curls for explicit
timeouts`: `CURL WITHOUT --max-time in scripts/health-check.sh:57:
HTTP_CODE=$(curl -s -o /dev/null --connect-timeout 10 "$HEALTH_URL"
2>/dev/null` → exit 1 com o caminho :57 exato. **E 0 linhas `EVAL CURL`
no log inteiro** — o tripwire (11.36) não tripou (sem eval na linha); a
falha é SÓ do detector, o que prova que é a DECISÃO da matriz (connect-
timeout sozinho não bounds o total) observada no pipeline, não o early-
warning.
3. **Revertido byte-identical**: `git stash pop` restaurou o delta de 13
   arquivos intacto (o stash antes do ciclo — o padrão da Prova 25 que
   evita o incidente de sweep da Prova 26); health-check.sh de volta a 56
   linhas; mutation script self-deletado; branch scratch deletada.

**O veredito**: a decisão da 11.31 está documentada como comportamento
OBSERVADO no pipeline — a forma `--connect-timeout` sozinha falha com o
caminho exato no CI real, exatamente como a linha da matriz do teste pina.
O par fecha com a Prova 26: quem ler a 11.31 vê a decisão; quem ler a 8.22
vê o mesmo sinal vivo; e o `0 EVAL CURL` separa as duas classes (a decisão
da matriz vs o early-warning do tripwire).

## 8.23 Prova 28 — a regra 11 só no delta: o CI roda o HEAD, não o working tree (run 31488081528, 2026-08-11)

**A pergunta**: prova viva da regra 11 (DANGLING NEEDS, sec 11.33) no
padrão das Provas 26/27: um `needs:` pendurado no ci.yml real + `--expect-log
'DANGLING NEEDS'`.

**A mutação**: `deleted-job-xyz` adicionado ao `needs:` do job build do
`.github/workflows/ci.yml` (linha 125) — verificada LOCALMENTE primeiro
(guard real com a mutação: exit 1, `DANGLING NEEDS in
.github/workflows/ci.yml:125 (job build: needs deleted-job-xyz nao
existe...)`, revertido antes do ciclo).

**O ciclo**: `ci-proof-run --only-jobs check --expect failure --expect-log
'DANGLING NEEDS' --no-verify --timeout 900` na branch scratch
`ci-proof/dangling-needs-live`; delta de 13 arquivos stashado antes (padrão
Prova 25).

**O observado** (run 31488081528): job `check` conclusion=`failure` — MAS
`DANGLING NEEDS` = **0 ocorrências** em 4458 linhas de log. As 8 falhas (3
arquivos) foram ambientais e NÃO da mutação:

- `check-node-modules-integrity.test.ts` (1): BASELINE `expected 1 to be
  +0` — a classe EXTRANEOUS hoist (Prova 13) no CI.
- `run-precommit-guards.test.ts` (6): cascata — o integrity sai 1
  ambientalmente → o batch sai 1 → o REAL-REPO CONTRACT e os isolamentos
  falham juntos.
- `blame-ignore-revs.test.ts` (1): shallow (classe Prova 13).
- `scan-guard-gates.test.ts` **passou** (entre os 164 passed/167): a versão
  do HEAD não tem o contrato da regra 11 — a MESMA mutação que falha o
  contrato LOCALMENTE (working tree com a regra) passa no CI (HEAD sem a
  regra).

**O ACHADO** (a raiz, medida não conjectura): o `git checkout -b` do helper
(linha 29-30 do ci-proof-run.mjs) cria a branch scratch A PARTIR do HEAD —
o commit scratch carrega o HEAD + o script de mutação, NUNCA o working
tree não-commitado (que estava stashado). A regra 11 existe SÓ no delta
(grep: 0 no HEAD vs 6 no working tree). Logo: **uma prova viva de uma
regra que vive só no delta é estruturalmente impossível** — o CI nunca
executa o código da regra, e o `--expect-log` não pode casar um sinal que
o scanner do HEAD não conhece. (Contraste: as Provas 26/27 provaram guards
que já estavam commitados — o scan-curl-timeouts era HEAD-state no commit
5ca9400.)

**A receita**: commit do delta primeiro (a regra 11 entra no HEAD), depois
re-rodar o MESMO ciclo — aí o scratch branch carrega a regra, o REAL-REPO
CONTRACT falha com `DANGLING NEEDS in .github/workflows/ci.yml:125` e o
`--expect-log` casa. A prova fica PENDENTE do commit do delta (o estado
natural do fluxo: a regra é commitada, depois provada).

**Revert**: byte-identical — delta restaurado do stash (13 arquivos
intactos), mutation script self-deletado, branch scratch deletada, ci.yml
de volta ao estado do HEAD.

**Consequência metodológica** (o valor da prova): documenta a fronteira do
helper — o ci-proof-run prova o estado COMMITADO do repo, não o working
tree. É a mesma família dos ACHADOs das sec 8.20 (capture job-scoped
vazio) e 8.17 (sweep do `git add -A`): o ciclo do helper tem uma superfície
de validade que agora está nomeada.

## 8.24 Prova 29 — o tripwire `eval`+`curl` observado no lado PR do pipeline real (run 31492035257, 2026-08-11)

**A pergunta**: a Prova 26 (sec 8.21, run 31485163704) provou o tripwire
`EVAL CURL (sec 11.30)` no lado PUSH NET — o job `Guard Gates` do
guard-gates.yml. O mesmo contrato tem um irmão no pr-check.yml: o job
`fragile-guard` (display `Fragile Range Guard`) roda o MESMO step `node
scripts/scan-curl-timeouts.mjs --ci` (o mirror do push net, single source
of truth). Faltava a prova viva do lado PR — o par fechado nos DOIS lados
da rede, como as Provas 16/19 fizeram para o `needs:` e a 22/23 para a
agregação.

**A premissa (o ACHADO da Prova 28 aplicado)**: o tripwire vive SÓ no
delta não-commitado da thread (grep `scanEvalCurl`: 0 no HEAD de3994c vs 5
no working tree) — o CI roda o HEAD, não o working tree. A receita é o
PADRÃO da Prova 26: NÃO stashar, deixar o `git add -A` do commit scratch
varrer o delta (com o tripwire) para o scratch, e restaurar o delta do
backup md5 no revert. Backup tomado ANTES do ciclo (`git diff >
/tmp/pre-prova29-delta.patch`, 13 arquivos, md5 `cd1ed6a6...`).

**A mutação**: linha `CMD="curl -s -o /dev/null -w \"%{http_code}\"
\"$HEALTH_URL\" 2>/dev/null"; eval "$CMD"` (a forma EXATA da 11.30)
anexada ao fim do `scripts/health-check.sh` real (derived gate script: 3
workflows o citam), branch scratch `ci-proof/eval-pr-live`, via
**`ci-proof-run --workflow pr-check.yml --only-jobs "Fragile Range Guard"
--expect failure --expect-log 'EVAL CURL' --no-verify --timeout 600`**
(mutation script `scripts/prova29-mutate.mjs` TEMP, runner-owned
self-delete via `--mutate-self-delete` — o ACHADO da sec 8.17). NOTA de
precisão: o script anexou `\n`+linha+`\n` a um arquivo que termina em
`exit 1\n`, então a linha caiu na **58** (não 57 como nas Provas 26/27 —
o sinal independe do número, o tripwire reporta o file:line real).

**O resultado observado** (run 31492035257, `--only-jobs` — o poll termina
quando o JOB conclui, não o run; o run inteiro seguia em background):
1. **Job `Fragile Range Guard` conclusion=`failure`** — step `Scan
gate-script curls for explicit timeouts`: `EVAL CURL (sec 11.30) in
scripts/health-check.sh:58: CMD="curl -s -o /dev/null -w
\"%{http_code}\" \"$HEALTH_URL\" 2>/dev/null"; eval` → exit 1 (o
caminho :58 exato, o mesmo formato da Prova 26).
2. **0 linhas `CURL WITHOUT --max-time` no log inteiro** — o
falso-negativo do DETECTOR (11.30) observado de novo no pipeline, agora no
lado PR: a ÚNICA razão do exit 1 é o tripwire (11.36).
3. **ACHADO do helper (o MESMO da sec 8.20/Prova 25)**: o capture
job-scoped do ci-proof-run veio vazio (1 linha) porque o run ainda estava
in_progress quando o job Fragile Range Guard concluiu — o helper saiu exit
1 (verify falhou no log vazio), MAS o sinal foi confirmado via o fallback
documentado: `gh api repos/severinno/severinno/actions/jobs/93780586908/logs`
→ o `EVAL CURL` com o caminho exato no log do step.
4. Revertido byte-identical: delta restaurado do patch backup (md5
`cd1ed6a6...` pré = pós, `cmp` OK — 13 arquivos intactos), health-check.sh
de volta a 56 linhas, mutation script self-deletado pelo runner, branch
scratch deletada (remote + local), git status = delta original intacto.

**O veredito**: o tripwire está documentado como comportamento OBSERVADO
nos DOIS lados da rede — Prova 26 (guard-gates.yml / push net) + Prova 29
(pr-check.yml / PR, job Fragile Range Guard). A fronteira 11.36 (fail-loud
na FORMA eval+curl) vale nos dois jobs que rodam `scan-curl-timeouts
--ci`; quem ler a 11.36 vê o mecanismo; quem ler as Provas 26 + 29 vê o
par fechado.

## 8.25 Prova 30 — a residual split-form do tripwire atravessa o pipeline real (exit 0, run 31496492582, 2026-08-11)

**A pergunta**: a Prova 29 (sec 8.24) provou o tripwire falhando a forma
de LINHA ÚNICA (`CMD="curl ..."; eval "$CMD"` → exit 1). O lado INVERSO
da decisão — a residual ACEITA da 11.36: `CMD="curl ..."` numa linha e
`eval "$CMD"` na seguinte SEM continuação — tem só prova hermética (o
teste TRIPWIRE boundary com contrafactual embutido, sec 11.36). A
contraparte viva: o `--ci` REAL no pipeline com o split-form commitado
passando (exit 0) — o exit 0 que a 11.30 prometia e a 11.36 removeu para
a forma de linha única, agora observado para a forma que ficou de fora
por decisão.

**A premissa (medida ANTES do ciclo, dry-run local)**: anexar o split-form
ao health-check.sh REAL → `node scripts/scan-curl-timeouts.mjs --ci` =
`SCAN_EXIT=0` + `scanEvalCurl("scripts/health-check.sh")` = `EVAL CURL
warnings: 0` — o tripwire checa cada LINHA LÓGICA com eval E curl juntos;
o split tem curl na linha 58 e eval na 59, nenhuma linha lógica tem
ambos (sem continuação, `joinContinuations` não junta nada; o `\n`
inicial do append cria a linha 57 vazia — CMD cai na 58 e eval na 59, o
MESMO offset da Prova 29).

**A mutação**: linhas `CMD="curl -s -o /dev/null -w \"%{http_code}\"
\"$HEALTH_URL\" 2>/dev/null"` (linha 58) + `eval "$CMD"` (linha 59) em
linhas SEPARADAS SEM continuação anexadas ao fim do
`scripts/health-check.sh` REAL — o MESMO conteúdo da Prova 29, só que
dividido (branch scratch `ci-proof/split-live` via **`ci-proof-run
--workflow pr-check.yml --only-jobs "Fragile Range Guard" --expect
success --no-verify --timeout 600`**; mutation script
`scripts/prova30-mutate.mjs` TEMP + self-delete runner-owned — o ACHADO
da sec 8.17; backup md5 `e15ea80b...` tomado antes — o delta de 5
arquivos foi varrido para o scratch pelo `git add -A` do helper, o padrão
da Prova 26/29).

**O resultado observado** (run [31496492582](https://github.com/severinno/severinno/actions/runs/31496492582),
`--only-jobs` — o poll termina quando o job conclui; o run seguia em
background quando o job terminou):

- job `Fragile Range Guard` conclusion=`success` — step `Scan gate-script
  curls for explicit timeouts`: `curl-timeouts: clean (6 gate script(s)
  from workflows, every curl has --max-time and no eval+curl form - sec
  security-headers-gate ADOTADO / 11.36)` → **exit 0** com o split-form
  commitado (log via `gh api .../actions/jobs/93795421197/logs` — o
  capture job-scoped do helper veio vazio/1-linha, o MESMO ACHADO da sec
  8.20/Prova 25; sinal confirmado pelo fallback da API);
- **0 linhas `EVAL CURL` e 0 linhas `CURL WITHOUT --max-time`** no log do
  step inteiro — a residual atravessou o pipeline sem nenhum early-warning
  disparar (nem o detector, nem o tripwire);
- **O PAR FECHADO**: linha única `; eval` → exit 1 `EVAL CURL` (Prova 29,
  sec 8.24); split em duas linhas SEM continuação → exit 0 clean (esta
  prova) — a fronteira da 11.36 é provadamente a LINHA, nunca o conteúdo;
- revertido byte-identical (delta de 5 arquivos restaurado do patch
  backup md5 pré=pós `e15ea80b...`, health-check.sh de volta a 56 linhas,
  mutation script removido pelo runner antes do `git add -A`, branch
  scratch deletada remote + local).

**O veredito**: a residual ACEITA da 11.36 está documentada como
comportamento OBSERVADO no pipeline real — o exit 0 que a 11.30 prometia
para o eval vale EXATAMENTE para a forma que o tripwire deixou de fora
por decisão (rastreamento de variáveis = custo recusado, forma com 0 usos
na superfície). O par linha-única/split está fechado nos DOIS sentidos
com prova viva: quem ler a 11.36 vê a decisão + o teste com contrafactual;
quem ler as Provas 29 + 30 vê a fronteira da linha observada no CI.

## 8.26 Prova 31 — o continuation-form do tripwire falha no pipeline real (exit 1, run 31506284327, 2026-08-11)

**A pergunta**: a sec 11.36 nomeia o tri-caso da linha lógica — (1) linha
única → TRIPA (Prova 29), (2) continuação `\` → dobra e TRIPA na linha
inicial (sondado local, probe real 2026-08-11), (3) split SEM continuação
→ residual ACEITA, NÃO tripa (Prova 30). Os casos 1 e 3 têm prova viva no
CI; o caso 2 — `CMD="curl ..." \` (backslash no fim da linha) + `eval
"$CMD"` na linha seguinte COM continuação — é exatamente o que o
joinContinuations dobra numa linha lógica única, então o tripwire DEVERIA
tripar na linha inicial. Faltava a contraparte viva no pipeline real.

**A premissa (medida ANTES do ciclo, dry-run local)**: anexar o
continuation-form ao health-check.sh REAL → `node
scripts/scan-curl-timeouts.mjs --ci` = `SCAN_EXIT=1` + `EVAL CURL (sec
11.30) in scripts/health-check.sh:58` — o tripwire checa cada linha
LÓGICA com eval E curl juntos; o joinContinuations une a linha 58 (CMD
com `\` final) + 59 (eval) numa ÚNICA linha lógica que começa na 58 — o
tripwire tripa na linha INICIAL do comando lógico (o `\n` inicial do
append cria a 57 vazia, CMD cai na 58).

**A mutação**: linhas `CMD="curl -s -o /dev/null -w \"%{http_code}\"
\"$HEALTH_URL\" 2>/dev/null" \` (linha 58, com backslash final) + `
  eval "$CMD"` (linha 59) anexadas ao fim do `scripts/health-check.sh`
REAL — o MESMO conteúdo da Prova 30, só que com a continuação `\` (branch
scratch `ci-proof/cont-live` via **`ci-proof-run --workflow pr-check.yml
--only-jobs "Fragile Range Guard" --expect failure --expect-log "EVAL
CURL (sec 11.30) in scripts/health-check.sh:58" --no-verify
--stash-uncommitted --timeout 600`**; mutation script
`$TMPDIR/prova31-cont-mutate.mjs` FORA do repo — o delta não-commitado da
thread foi stasheado pelo `--stash-uncommitted` e o script no tmpdir nunca
é varrido nem pelo stash (só varre o repo) nem pelo `git add -A` do
commit scratch; self-delete runner-owned removendo-o antes do commit — o
padrão da sec 8.17; backup md5 `54534137...` tomado antes).

**O resultado observado** (run [31506284327](https://github.com/severinno/severinno/actions/runs/31506284327),
`--only-jobs` — o poll termina quando o job conclui):

- job `Fragile Range Guard` conclusion=`failure` — step `Scan gate-script
  curls for explicit timeouts`: `curl-timeouts: 1 eval+curl form(s) em
  linha logica...` + **`EVAL CURL (sec 11.30) in scripts/health-check.sh:58`**
  → **exit 1** com o continuation-form commitado (log via `gh api
  .../actions/jobs/93828572718/logs` — o capture job-scoped do helper veio
  1-linha, o MESMO ACHADO da sec 8.20/Prova 25; sinal confirmado pelo
  fallback da API);
- **1 linha `EVAL CURL` e 0 linhas `CURL WITHOUT --max-time`** no log do
  step — o tripwire disparou na forma COM continuação, o detector
  permaneceu mudo (o token mascarado, a fronteira 11.30 intacta);
- **O TRI-CASO FECHADO**: linha única `; eval` → exit 1 `EVAL CURL`
  (Prova 29, sec 8.24); split em duas linhas SEM continuação → exit 0
  clean (Prova 30, sec 8.25); continuação `\` (o joinContinuations dobra
  numa linha lógica) → exit 1 `EVAL CURL` na linha inicial (esta prova) —
  a fronteira da 11.36 é provadamente a LINHA LÓGICA: continuar com `\` é
  JUNTAR (tripwire), quebrar sem `\` é SEPARAR (residual);
- revertido byte-identical (md5 `54534137...` pré=pós, health-check.sh de
  volta a 56 linhas, mutation script removido do tmpdir, branch scratch
  deletada remote + local, delta não-commitado restaurado pelo stash pop).

**O veredito**: o caso 2 da 11.36 está documentado como comportamento
OBSERVADO no pipeline real — a forma COM continuação TRIPA no `--ci`
(exit 1) exatamente na linha inicial do comando lógico, o espelho da
residual da Prova 30. NOTA de honestidade (o mesmo espírito dos ACHADOs):
o ciclo saiu com `CYCLE_EXIT=1` — o verify do `--expect-log` no nível do
helper NÃO casou a regex porque o capture job-scoped veio com 1 linha (o
ACHADO da sec 8.20/Prova 25); a evidência da prova é a conclusão
`failure` observada (o `--expect failure` casou) + o sinal `EVAL CURL
(sec 11.30) in scripts/health-check.sh:58` confirmado pelo fallback da
API. Quem re-rodar o comando documentado verá exit 1 no helper e a
conclusão failure no run — não é uma prova falha, é o capture ACHADO. O
tri-caso da linha lógica está fechado nos DOIS sentidos com prova viva:
quem ler a 11.36 vê a decisão + o teste com contrafactual; quem ler as
Provas 29 + 30 + 31 vê a fronteira da linha observada no CI — continuar
com `\` é juntar (tripwire), quebrar sem `\` é separar (residual).

## 8.27 Prova 32 — o lado POSITIVO do guard da sec 11.41 ao vivo: `--stash-uncommitted` preserva e o revert restaura byte-identical (exit 0, run 31511149307, 2026-08-11)

**A pergunta**: o guard da árvore suja (sec 11.41) foi provado LOCALMENTE no
lado negativo — working tree suja SEM a flag = fail-loud exit 3 no repo
real. O lado positivo (`--stash-uncommitted` preserva o delta não-commitado
durante o ciclo e o revert o restaura) tinha apenas prova hermética (os
E2Es com fake bins da suíte do ci-proof-run). Faltava a prova viva com um
delta REAL na working tree: exatamente a classe que a sec 8.21 (o ACHADO
da Prova 26) descreve — o delta que o `git add -A` do commit scratch
varreria e o revert apagaria.

**O estado**: nenhuma mutação — o delta real da thread (12 arquivos: 10
modificados + 2 untracked, o trabalho acumulado das rodadas) já vivia na
working tree da branch `freebuff/new-thread-thmsitz5qutoia`. Baseline
pré-ciclo: STATUS_MD5 `2c5fdcca...`, DELTA_MD5 `2897b9b9...`, STASH_COUNT
19 (os 19 stashes pré-existentes — lint-staged backups + antigos), branch
atual resolvida como destino do revert.

**O ciclo** (`ci-proof-run --branch ci-proof/stash-live2 --workflow
pr-check.yml --only-jobs "utf8-check / UTF-8 Check" --expect success
--stash-uncommitted --timeout 420`): `delta nao-commitado stasheado (git
stash push -u)` → checkout da scratch → push → dispatch → poll → job
`utf8-check / UTF-8 Check` completed (success) → verify `conclusion=success`
→ revert: `delta nao-commitado restaurado (git stash pop - sec 8.21)` +
`revertido (remote deletado, de volta em freebuff/new-thread-thmsitz5qutoia,
local deletado, delta restaurado)` → **DONE run=31511149307
conclusion=success** → **CYCLE_EXIT=0**. Pós-ciclo: STATUS_MD5
`2c5fdcca...` (idêntico), DELTA_MD5 `2897b9b9...` (**byte-identical**),
STASH_COUNT 19 (o stash do helper consumido pelo pop, os 19 antigos
intactos), branch restaurada, remote sem leftover (`REMOTE_LEFTOVER=0`).

**ACHADO 1 — o nome composto dos reusable workflow calls**: a primeira
tentativa usou `--only-jobs utf8-check` e saiu exit 3 (`job 'utf8-check'
nao encontrado no run #31510668278`) — MESMO com o job concluindo
success. O display name na API de um job que é um reusable workflow call
(`uses: ./.github/workflows/utf8-check.yml`) é o composto **`utf8-check /
UTF-8 Check`** (key / name interno), não a key crua — e o `--only-jobs`
casa com o display name. Um proof futuro mirando um reusable call precisa
do nome composto. O revert aconteceu MESMO no exit 3 (o delta foi
restaurado na 1ª tentativa também — o md5 diferiu só pelo EOL, ACHADO 2).

**ACHADO 2 — a re-normalização de EOL no round-trip do stash**: o 1º ciclo
mudou o DELTA_MD5 (`2e84e454` → `2897b9b9`) com o STATUS_MD5 idêntico — o
round-trip `stash push -u` → `checkout` → `stash pop` re-normalizou os
arquivos de LF (o estado em que o sed da thread os deixou) para **CRLF**
(o `text=auto` do .gitattributes converte no checkout em Windows — o
estado natural do repo; o index normaliza EOL, então `git diff` não vê
diferença). A 2ª rodada com o baseline CRLF-estável (já `2897b9b9`)
fechou byte-identical pré=pós. Lição: o md5 de working-tree inclui o EOL;
a identidade funcional do delta é provada pelo diff/index normalizado +
os md5 com baseline estável.

**Re-validação**: `npx vitest run scripts/__tests__/ci-proof-run.test.ts --config vitest.config.unit.ts`
(o guard da sec 11.41 + os E2Es de stash) + `gates-proofs-ordering.test.ts`
valida a monotonia 8.26 → 8.27 → 9; tsc 0; eslint 0 erros; UTF-8 do doc
OK; ASCII-OK nos gate files.

## 8.28 Prova 33 — o DOC COVERAGE do scan-exit-claims falha com a seção exata no CI real (run 31516054686, 2026-08-11)

**A pergunta**: o DOC COVERAGE (sec 11.42, doc → manifest: toda claim de
exit code detectada no doc REAL tem entrada no EXIT_CLAIMS) tinha prova
local sintética (fixtures + o CLI com `EXIT_CLAIMS_DOC` apontando um doc
mutado) mas nenhuma prova no CI real — o pr-check.yml roda `test:unit` no
job `check` (que inclui o scan-exit-claims), então uma claim fake injetada
numa secção 11.x da doc real deveria derrubar o teste no pipeline. O
pedido: a prova viva do lado CI da classe 'claim de doc sem pin'.

**O ACHADO do RUN 1 (#31515253099) — a premissa estava errada**: o ciclo
rodou com a mutação que injetava a `## 11.99` na doc (o commit scratch
c326ffa tinha a secção, confirmado via `git show`), o job `check` falhou
mas as 8 falhas do test:unit eram de OUTRAS suítes (blame-ignore-revs por
shallow clone `--depth=1`, check-node-modules-integrity, run-precommit-
guards) — **zero do scan-exit-claims**. A causa: `scripts/scan-exit-
claims.mjs` e `scan-exit-claims.test.ts` são UNTRACKED (parte do delta
não-commitado da thread) e o CI roda o tree COMMITADO — a suíte não
existia no run, então o DOC COVERAGE nunca rodou. A premissa "o pr-check
roda test:unit que inclui o scan-exit-claims" só vale para o tree
commitado; no ciclo de prova a suíte precisa ser MATERIALIZADA.

**A decisão (o fix do método)**: a mutação do RUN 2 materializa os 12
arquivos do delta da thread no working tree do scratch (copiados para
`/tmp/ec-src` ANTES do ciclo — o mesmo padrão Prova 31 do script fora do
repo, agora para um CONJUNTO) + injeta a secção fake `## 11.99 Claim
fake da prova viva (nao registrada, injetada 2026-08-11)` com `**Exit
codes**: exit code 3` antes do `## 12.` (o eol-aware, aceita CRLF/LF).
Com a suíte presente no tree do scratch, o DOC COVERAGE roda e o detector
acha a 11.99 que o manifest não registra — a falha com a seção exata.

**O ciclo (RUN 2)**: branch scratch `ci-proof/exit-claims-live2` via
`ci-proof-run --workflow pr-check.yml --only-jobs check --expect failure
--expect-log "doc -> manifest" --no-verify --stash-uncommitted --timeout
900` — `--only-jobs check` (o job que roda test:unit ANTES de lint/tsc,
que ficam com `if: always()`), `--expect failure` + `--expect-log "doc ->
manifest"` (o título do teste no output do vitest, o sinal pinado),
`--stash-uncommitted` (o delta da thread preservado e restaurado),
`--no-verify` (o pre-commit local bloquearia o commit da doc mutada via
mapped tests). Exit 0 = failure observado E revertido.

**Evidência** (job `check` conclusion=`failure`, step `Unit tests`): `×
scripts/scan-exit-claims.mjs - DOC COVERAGE bidirecional (sec 11.42) >
doc -> manifest: toda claim de exit code detectada no doc REAL tem
entrada no manifest` + `→ expected [ '11.99' ] to deeply equal []` — a
SEÇÃO EXATA no assertion do vitest. 3 testes do scan-exit-claims falham
pela MESMA raiz (doc → manifest + checkExitClaims + REAL-REPO CONTRACT
do CLI, todos flagrando a 11.99 não registrada) — o detector acha, o
manifest não registra, o teste derruba no pipeline. As falhas
pré-existentes do RUN 1 (shallow clone etc.) seguem presentes no RUN 2
(ruído de ambiente, não da mutação) — o `--expect-log` pina o sinal do
DOC COVERAGE entre elas.

**Revert byte-identical**: STATUS_MD5 `2c5fdcca...` pré=pós, DELTA_MD5
`8431a460...` pré=pós, STASH 19 (os pré-existentes intactos, o stash do
ciclo consumido pelo pop), branch de volta em
`freebuff/new-thread-thmsitz5qutoia`, remote limpo (REMOTE_LEFTOVER=0).

**Re-validação**: `npx vitest run scripts/__tests__/scan-exit-claims.test.ts --config vitest.config.unit.ts`
(o DOC COVERAGE contra a doc real sem a 11.99 — 14/14 verde) +
`gates-proofs-ordering.test.ts` valida a monotonia 8.27 → 8.28 → 9; tsc
0; eslint 0 erros; UTF-8 do doc OK; ASCII-OK nos gate files.

## 8.29 Prova 34 — o tri-caso do tripwire AGREGADO observado no pipeline real (run 31518328191, 2026-08-11)

**A pergunta**: a sec 11.36 nomeia o tri-caso da linha lógica — (1) linha
única `CMD="curl ..."; eval "$CMD"` TRIP, (2) continuação `\` + eval na
linha seguinte (o joinContinuations junta numa linha lógica) TRIP na linha
inicial, (3) split sem continuação (curl na linha N, eval na N+1) PASSA —
e as Provas 29/30/31 provaram cada forma ISOLADA em branch separada. Faltava
o comportamento MULTI-FORMA num único pipeline: as 3 formas na MESMA branch
em gate scripts DISTINTOS, para o CI observar a soma dos singles de uma vez.

**A prova**: branch scratch `ci-proof/tricase-live` com 3 anexos no fim de 3
gate scripts distintos (o mutation script em `$TMPDIR` fora do repo,
self-delete runner-owned, caminho Windows via `cygpath -w` — o ACHADO da
Prova 33): `CMD="curl ..."; eval "$CMD"` numa linha em
`scripts/health-check.sh` (forma 1), `CMD="curl ..." \` + `  eval "$CMD"`
em `scripts/test-security-headers.sh` (forma 2, continuação), e o split
`CMD="curl ..."` / `eval "$CMD"` em linhas separadas SEM continuação em
`scripts/check-utf8.sh` (forma 3, residual). Ciclo via
**`ci-proof-run --workflow pr-check.yml --only-jobs "Fragile Range Guard"
--expect failure --expect-log "EVAL CURL (sec 11.30) in
scripts/health-check.sh:58" --no-verify --stash-uncommitted --timeout 600`**
(o `--no-verify` garante que o hook local não interfere — o
scan-curl-timeouts não roda no pre-commit, é step `--ci` dos workflows; o
CI é a autoridade; o `--stash-uncommitted` preserva o delta da thread).

**Dry-run local ANTES do ciclo** (contra cópia, `CURL_TIMEOUTS_SCAN_ROOT`):
`SCAN_EXIT=1` com exatamente **2 `EVAL CURL`** — `health-check.sh:58`
(linha única) e `test-security-headers.sh:439` (continuação) — e **zero**
para o check-utf8.sh (o split não tripa). O sinal esperado pinado antes do
ciclo gastar um poll.

**Observado no pipeline real** (run [**31518328191**](https://github.com/severinno/severinno/actions/runs/31518328191)):
job `Fragile Range Guard` conclusion=`failure`, log via `gh api
.../actions/jobs/93868917658/logs` (o capture job-scoped do helper veio
1-linha — o MESMO ACHADO da sec 8.20/Prova 25, confirmado pelo fallback da
API): `curl-timeouts: 2 eval+curl form(s) em linha logica` com **`EVAL CURL
(sec 11.30) in scripts/health-check.sh:58`** E **`EVAL CURL (sec 11.30) in
scripts/test-security-headers.sh:439`** — as 2 formas que devem trip,
reportadas JUNTAS no mesmo job — e **ZERO menção ao check-utf8.sh** (o
split sem continuação passou na MESMA árvore). O comportamento multi-forma
é a soma dos singles das Provas 29 (linha única) e 31 (continuação) com a
residual da Prova 30 (split) — agora observado num único pipeline.

**ACHADO (o capture 1-linha de novo)**: o `gh run view --job <id> --log` do
helper devolveu 1 linha de novo — o sinal do job só apareceu via `gh api
.../actions/jobs/<id>/logs` (o mesmo fallback das Provas 25/31/33). O
verify saiu 1 (a regex não casou no log 1-linha) mas o revert aconteceu por
design (a branch scratch nunca fica no remote) — o run number + o log via
API são a prova, não o exit do helper.

**Revert**: byte-identical (STATUS `b67aa585...` pré=pós, STASH 19, os 3
alvos de volta a 56/437/167 linhas, branch deletada remote + local).

## 8.30 Prova 35 — o push net roda test:guard com as 13 suítes do package.json, sem scan-exit-claims (run 31526224328, 2026-08-11)

Prova viva da premissa invertida da sec 8.1: o veredito "o scan-exit-claims
NÃO está no test:guard" tinha prova local (grep no package.json + medição
local do run 31522760166), mas nenhum log de CI mostrava o conjunto real
que o push net executa. Esta prova fecha o lado CI: dispatch do
`guard-gates.yml` real numa branch scratch e inspeção do log do step "Run
guard vitest suites".

**O que foi observado** (ciclo via **`ci-proof-run --branch
ci-proof/tg-suite-list --workflow guard-gates.yml --only-jobs "Guard Gates
(fragile-range + golden-copy)" --expect success --stash-uncommitted
--timeout 360`** — SEM mutação: a prova é o dispatch do workflow real na
branch scratch; `--stash-uncommitted` preserva o delta da thread):

- Run [**31526224328**](https://github.com/severinno/severinno/actions/runs/31526224328),
  job `Guard Gates (fragile-range + golden-copy)`, conclusion=`success`.
- **`Test Files 13 passed (13)`** — o vitest rodou **exatamente 13 suítes**
  no step "Run guard vitest suites".
- As 13 suítes listadas no log são **byte-exatas** às 13 do `test:guard` do
  package.json (a fonte única da invocação, o comentário do step: "the
  SAME script as pr-check.yml's fragile-guard job"): fragile-range-guard,
  fuzz-mapped, golden-copy-utils, guard-gates-exclusivity,
  manifest-registry, run-all-fuzz, scan-batch-coverage, scan-prepush-batch,
  scan-fuzz-precommit, scan-guard-gates, scan-hook-parallel-race,
  scan-lint-staged-loader, scan-push-full-suite.
- **0 ocorrências de `scan-exit-claims`** nas 288 linhas do log — o 8º guard
  do batch do pre-commit (sec 11.42) não faz parte do net por construção:
  ele está no `test:unit` (check job, ci.yml + pr-check.yml) e no batch
  runner local, não no `test:guard`. Um dev que queira o detector no push
  net precisaria editar o `test:guard` do package.json — a mudança visível
  e revisável que a sec 8.1 pressupõe.

**Bônus da prova (custo)**: os timestamps do log DESTE run medem o step
"Run guard vitest suites" em **~20.5s** (19:07:41.687 → 19:08:02.148) com
as 269 testes — a mesma faixa flat da medição da sec 8.1 (20.9s no run
31522760166, 236 testes): o vitest absorve o +14% de testes sem custo
adicional no net, e o job total segue dominado pelo setup fixo (install
~9.8s vs ~1s da run com cache hit — a classe que um paths filter não
reduz).

**Revert**: byte-identical (STASH 19, branch `ci-proof/tg-suite-list`
deletada remote + local, delta restaurado).

## 8.31 Prova 36 — o sufixo `--since` no test:guard falha no CI real, com o lock DUPLO observado (run 31533234250, 2026-08-11)

Prova viva da sec 11.47: o veredito do lock (qualquer sufixo no step
`run: bun run test:guard` do push net → `TEST GUARD STEP MISSING` com o
path exato) tinha prova hermética (mutações 11.47, push net + twin IRMÃ)
e pre-flight local do CLI real, mas nenhum log de CI mostrava o
comportamento observado. Esta prova fecha o lado CI: mutação do
`guard-gates.yml` real com `--since main` e dispatch numa branch scratch
segura.

**O que foi observado** (ciclo via **`ci-proof-run --workflow guard-gates.yml
--expect failure --expect-log "CACError" --no-verify --stash-uncommitted
--timeout 360`** na branch scratch `ci-proof/tg-suffix-live`; mutation
script `/tmp/prova36-suffix-mutate.mjs` fora do repo + self-delete
runner-owned — o ACHADO da sec 8.17; o pre-commit local foi ignorado com
`--no-verify` porque o guard rule 5 trava o commit da mutação — o ACHADO
da Prova 16; `--stash-uncommitted` preserva o delta da thread; pre-flight
local ANTES do ciclo com o probe `/tmp/preflight-tg.mjs`: o CLI real contra
o workflow mutado reporta `TEST GUARD STEP MISSING in
.github/workflows/guard-gates.yml` — o sinal da 11.47 no caminho exato):

- Run [**31533234250**](https://github.com/severinno/severinno/actions/runs/31533234250),
  job `Guard Gates (fragile-range + golden-copy)`, conclusion=`failure`.
- O step `Run guard vitest suites (BASELINE + divergence guards)` rodou
  `bun run test:guard --since main` → o bun expandiu para
  `$ vitest run <13 suítes> --config vitest.config.unit.ts --since main`.
- **`CACError: Unknown option '--since'`** (cac.DK21mt6F.js:403) →
  `error: script "test:guard" exited with code 1` → `Process completed with
  exit code 1`.

**O ACHADO (o lock DUPLO)**: o sinal observado no CI real NÃO foi o
`TEST GUARD STEP MISSING` do scanner — foi o **próprio vitest rejeitando a
flag**. O vitest 3.1.1 não tem `--since` (só `--changed`), então o step
mutado morre no parse do CLI ANTES de qualquer suíte rodar: **0 ocorrências
de `TEST GUARD STEP MISSING` nas 253 linhas do log** (o scan-guard-gates
nem chegou a executar). Ou seja, a classe do sufixo da 11.47 é travada por
DOIS locks independentes: (1) o regex do scanner (`TEST_GUARD_STEP_RE`,
hermético + mutações nos dois lados da rede) e (2) o próprio CLI do vitest,
que não aceita a flag inventada. A regressão precisaria vencer os DOIS para
entrar silenciosamente.

**Revert**: byte-identical — `run: bun run test:guard` de volta na linha
99 do guard-gates.yml (0 ocorrências de `--since` no arquivo), STASH 19
restaurado, branch `ci-proof/tg-suffix-live` deletada remote + local, delta
da thread intacto.

## 8.32 Prova 37 — a claim fake 11.99 commitada via HUSKY=0 bloqueia o push no pre-push local, ANTES do fuzz mapeado (2026-08-11)

Prova viva da sec 11.49: o guard `check-exit-claims-push.mjs` (o 4º node
guard do pre-push, `ALLOWED_NODE_GUARDS`) tinha prova hermética (mutações
+ REAL-REPO CONTRACT do CLI com `CHECK_EXIT_CLAIMS_PUSH_DOC`) e real-repo
local (controle `clean` exit 0), mas nenhuma prova viva do ciclo completo:
um commit REAL com a claim fake 11.99 (feito com HUSKY=0, bypassando o
batch do pre-commit que teria tripado) sendo bloqueado pelo hook de push.
Esta prova é **local por design** — o guard roda no `.husky/pre-push`, que
o CI nunca executa (o mesmo padrão da Prova 17, sec 8.19): o "CI" da
classe é o hook local, e a prova simula o push real via stdin.

**O que foi observado** (ciclo manual com backup do delta ANTES — o padrão
da Prova 33):

- Scratch `ci-proof/exit-claims-live` criado de HEAD com o delta da thread
  materializado num commit (`40ad1d0`, `HUSKY=0 git commit` — o estado
  verde local, sem `.probe-tmp`).
- Claim fake `## 11.99 Claim fake da prova viva` + `**Exit codes**: exit
  code 3 aqui.` injetada no `docs/gates-proofs.md` REAL antes do `## 12.`
  (CRLF-safe via node) e **commitada via `HUSKY=0 git commit`**
  (`ffb58de`). O pre-commit local teria tripado o batch (o 8º guard, sec
  11.42) na working tree — o HUSKY=0 é exatamente a classe: o commit que
  esconde a claim. Pre-flight ANTES do ciclo: `node
  scripts/check-exit-claims-push.mjs` contra o HEAD do scratch → exit 1
  com `claim na secao 11.99`.
- Push simulado real no hook:
  `printf 'refs/heads/ci-proof/exit-claims-live <ffb58de>
  refs/heads/ci-proof/exit-claims-live <40ad1d0>' | bash .husky/pre-push`
  (1 ref não-deleção, `time -p`).

**O resultado**: hook **exit 1 em 4.47s real**. A cadeia que RODOU antes
do guard: check-push-deletion (não é deleção pura → roda gates),
verify-encoding (UTF-8 OK, fragile-range clean, mjs-gate clean 47 files,
yaml-gate clean), check-docs-encoding, integrity `clean` — todos verdes. O
guard então bloqueou com o sinal EXATO da 11.49: `exit-claims-push: 1
claim(s) NAO-registrada(s) no doc COMMITADO (HEAD) - sec 11.42/11.49:` e
`claim na secao 11.99 nao esta no EXIT_CLAIMS (doc commitado - um commit
com HUSKY=0/--no-verify pode ter escondido; registrar a claim - sec
11.49)`. `set -euo pipefail` matou o hook ali: **0 execuções do
run-mapped-fuzz** — as únicas menções a fuzz nas 4.47s de log são os
listings `ASCII-OK scripts/run-mapped-fuzz.mjs` e `format-fuzz-results.mjs`
da varredura mjs-gate (nomes de arquivo, não o runner). O push foi
bloqueado ANTES de gastar os ~6-14s do fuzz mapeado — a mesma classe de
custo que a Prova 17 provou para o integrity.

**Revert**: byte-identical — branch deletada (`git branch -D
ci-proof/exit-claims-live`), delta restaurado (`git apply` do patch de
1249 linhas + untracked copiados de volta + `.probe-tmp` limpo), MD5
pré=pós idêntico nos 4 arquivos (docs/gates-proofs.md, guard, pre-push,
scan-exit-claims.mjs) e `git status` idêntico ao snapshot pré-ciclo.

## 8.33 Prova 38 — a CURE como ÚLTIMA saída do bloqueio do pre-push (2026-08-11)

Prova viva da CURE da sec 11.54/11.55 no hook real: a sec 11.54 adicionou o
`EXIT_CLAIMS_CURE` compartilhado (CLI stderr + guard stdout) e a 11.55 o
pointer do stale — ambos pinados HERMETICAMENTE (os testes do CLI e do
guard exigem a CURE), mas sem prova viva no hook: faltava confirmar que o
bloqueio do pre-push com a claim fake termina com a linha CURE no stdout —
o dev bloqueado sabe EXATAMENTE como curar no momento do bloqueio, não só
que foi bloqueado.

**O ciclo (padrão Prova 37 — backup do delta antes)**:
1. **Backup**: patch do delta tracked (1604 linhas) + untracked copiados
   (`.probe-tmp/t.md`, `check-exit-claims-push.test.ts`,
   `scan-cures-contract.test.ts`, `check-exit-claims-push.mjs`) + md5
   baseline + snapshot do `git status`.
2. **Scratch** `ci-proof/cure-live`: delta materializado num commit
   (`20e1e46`, o estado verde local — o guard COM a CURE, pois o
   check-exit-claims-push.mjs e o scan-exit-claims.mjs fazem parte do delta).
3. **A classe exata**: claim fake `## 11.99 Claim fake da prova viva` /
   `**Exit codes**: exit code 3` injetada no doc REAL antes do `## 12.`
   (linha 6744) e **commitada via `HUSKY=0 git commit`** (`f00b59c` — o
   commit que esconde; o pre-commit local teria tripado o batch com o
   8º guard da sec 11.42).
4. **Pre-flight**: guard real contra o HEAD do scratch → **exit 1** com a
   claim listada e a CURE como última linha.
5. **Push simulado**: `printf 'refs/heads/ci-proof/cure-live <f00b59c>
   refs/heads/ci-proof/cure-live <20e1e46>' | bash .husky/pre-push`.

**O resultado**: hook **exit 1 em 5.05s real** (`time -p`). A cadeia antes
do guard passou (encoding gates UTF-8 OK + mjs-gate clean — o listing
`ASCII-OK` do run-mapped-fuzz.mjs no log confirma que a varredura rodou e
passou — + integrity `clean`) e o guard bloqueou com a sequência completa
no stdout:
```
exit-claims-push: 1 claim(s) NAO-registrada(s) no doc COMMITADO (HEAD) - sec 11.42/11.49:
  claim na secao 11.99 nao esta no EXIT_CLAIMS (doc commitado - um commit com HUSKY=0/--no-verify pode ter escondido; registrar a claim - sec 11.49)
  CURE: registre a claim no EXIT_CLAIMS de scripts/scan-exit-claims.mjs (sec 11.42) e confirme com: node scripts/scan-exit-claims.mjs --check
```
A **linha 210 do log do hook é a CURE — a ÚLTIMA saída do guard** (nada
roda depois; `set -euo pipefail` mata o hook ali): a prova de que a CURE
chega ao dev no MOMENTO do bloqueio, não só no teste hermético. **0
execuções do run-mapped-fuzz** (a única menção a fuzz no log é o listing
`ASCII-OK scripts/run-mapped-fuzz.mjs` da varredura mjs-gate — o nome do
arquivo, não o runner): o push foi bloqueado antes de gastar os ~6-14s do
fuzz mapeado, com a cura à mão.

**Revert**: byte-identical (branch `ci-proof/cure-live` deletada, patch
re-aplicado, untracked restaurados — MD5 pré=pós nos 5 arquivos +
`git status` idêntico ao snapshot). **Controle pós-ciclo**: guard real exit
0 `clean` no HEAD da thread + 0 headers `## 11.99` reais na doc (as 2
menções restantes são as registros históricos das Provas 33/34, não o
header injetado).

**O que a prova cobre (e o que a Prova 37 já cobria)**: a 37 provou o
bloqueio ANTES do fuzz (o guard pára o push); esta prova adiciona o elo
final da cadeia de cura — a linha `CURE:` é a última coisa que o dev vê
antes do exit 1, tornando o bloqueio auto-suficiente (o fix está nopróprio erro, sem consultar a doc). Registro de evento 8.x (fronteira de
escopo da sec 11.51: Provas = registros de evento, não claims de
comportamento) — sem entrada no EXIT_CLAIMS.

## 8.34 Prova 39 — o PAR CURE+stale no CLI real, com a seção renumerada (2026-08-11)

Prova viva da sec 11.55 (o pointer do stale) no CLI real — a prova irmã da
Prova 38: a 38 provou a CURE da sec 11.54 no hook (pre-push); esta prova
fecha o OUTRO sinal do MESMO caminho de erro — o pointer do stale — no CLI
(o mesmo detector que o batch do pre-commit e o test:unit rodam). A classe
stale é CLI-only por design (sec 11.49: o guard do push é direction-unique
`.unregistered`, o stale é ruído de delta), então a prova viva é o CLI real
contra o doc COMMITADO com a mutação.

**O ciclo (padrão Prova 38 — backup do delta antes)**:
1. **Backup**: patch do delta tracked (1667 linhas) + untracked copiados +
   md5 baseline (5 arquivos) + snapshot do `git status`.
2. **Scratch** `ci-proof/stale-live`: delta materializado num commit
   (`1bb6bbb`, o estado verde local — o CLI com a CURE e o pointer stale).
3. **A classe exata — 1 rename produz o PAR**: `## 11.42 ` → `## 11.98 `
   no doc REAL (a seção 11.42, linha 5962 do scratch — a SELF-GUARD do
   próprio contrato, a escolha deliberada: renumerar a seção que descreve
   o CLI). O rename gera os DOIS sinais de uma vez: a entrada 11.42 no
   EXIT_CLAIMS fica STALE (sem claim detectada — a seção mudou de número)
   e a 11.98 vira UNREGISTERED (claim detectada sem entrada no manifest).
   Commitado via `HUSKY=0 git commit` (`befec6e` — o commit que esconde; o
   pre-commit local teria tripado o batch).
4. **Pre-flight**: CLI real contra o doc mutado → exit 1 com o par.

**O resultado**: CLI **exit 1** com as 4 linhas-chave do par, 1 ocorrência
cada, no MESMO run:
```
exit-claims: 1 claim(s) de exit code SEM registro no manifest (sec 11.42):
  claim na secao 11.98 nao esta no EXIT_CLAIMS
  CURE: registre a claim no EXIT_CLAIMS de scripts/scan-exit-claims.mjs (sec 11.42) e confirme com: node scripts/scan-exit-claims.mjs --check
exit-claims: 1 entrada(s) do manifest SEM claim detectada no doc (secao renumerada/removida - sec 11.42/11.55):
  entrada 11.42 sem claim no doc atual
  stale nao tem CURE de registrar - a secao foi renumerada/removida: atualize a secao no EXIT_CLAIMS ou remova a entrada (sec 11.42/11.55)
```
O dev vê os DOIS comandos no mesmo erro: a CURE (para a claim nova) E o
pointer que desambigua (para a entrada órfã) — a divisão de cura da sec
11.54/11.55 observada viva.

**O CONTRASTE (a divisão de trabalho da sec 11.49 observada)**: o guard do
push (`check-exit-claims-push.mjs`) no MESMO scratch lista SO o 11.98
(unregistered, com a CURE) e **0 menções a stale** — o guard é
direction-unique `.unregistered` por design (o stale false-positivaria com
o delta da working tree). A prova observa os DOIS lados no mesmo estado:
CLI = superfície completa (CURE + stale pointer), guard = só unregistered.

**Revert**: byte-identical (branch `ci-proof/stale-live` deletada, patch
re-aplicado, untracked restaurados — MD5 pré=pós nos 5 arquivos +
`git status` idêntico ao snapshot). **Controle pós-ciclo**: CLI `clean (27
claims)` exit 0 + 0 headers `## 11.98` reais na doc (a única menção
restante é este registro histórico). Registro de evento 8.x (fronteira de
escopo da sec 11.51) — sem entrada no EXIT_CLAIMS.

**Re-validação datada (2026-08-11, 28 claims)**: o controle pós-ciclo
acima foi capturado com o manifest em 27 claims; a 28ª (a claim da sec
11.58 — o hook-proof-run, `current`, registrada com a decisão 11.58)
entrou no EXIT_CLAIMS depois. Re-validado no estado atual: CLI `clean (28
claims registradas em 25 current + 1 superseded + 2 measurement - sec
11.42)` exit 0 no repo real (o mesmo comando do controle, verbatim) + a
suite hermética do par
(`scan-exit-claims.test.ts`, as MUTATIONs da sec 11.42/11.55 — a classe
que a Prova 39 provou viva) 21/21 verde. O par CURE+stale segue
calibrado: o count subiu de 27→28 por uma claim NOVA (a 11.58), não por
drift de seção — o `--check` continua clean e o pointer stale segue
intacto (nenhuma seção renumerada desde a Prova 39). Registro de evento
8.x — continua sem entrada no EXIT_CLAIMS (fronteira da sec 11.51, o
detector é 11.x-only por desenho).

**Re-validação (2026-08-12, 29 claims)**: o EXIT_CLAIMS cresceu de 28
para 29 — a claim da sec 11.93 (o scan-proof-helpers, o 9o guard do
batch, o contrato 11.72 no pre-commit). Re-validado no estado atual: CLI
`clean (29 claims registradas em 26 current + 1 superseded + 2
measurement - sec 11.42)` exit 0 no repo real (verbatim) + a suite
hermética do par verde — `--check` continua clean (0 unregistered + 0
stale): o par CURE+stale segue calibrado por claims novas, sem drift de
seção. Registro de evento 8.x — sem entrada no EXIT_CLAIMS (fronteira da
sec 11.51, detector 11.x-only por desenho).


## 8.35 Prova 40 — o CONTRASTE CURE + 0 stale via `hook-proof-run --mutate-doc-renumber`, o irmão automatizado da Prova 39 (2026-08-11)

Prova viva da sec 11.59 (o `--mutate-doc-renumber <sec> --to <nova>` do
hook-proof-run) — o irmão automatizado da Prova 39: a 39 fez o rename com
sed MANUAL no CLI; esta prova roda o MESMO contraste num comando, através
do hook REAL. O helper (backup → scratch → delta materializado → renumber
commitado via HUSKY=0 → push simulado no hook real → verify → revert
byte-identical) foi construído exatamente para este ciclo (sec 11.58/11.59).

**O ACHADO do pedido (o porquê da fonte 11.58, não 11.59)**: o pedido
citou `--mutate-doc-renumber 11.59 --to 11.98`, mas a sec 11.59 é
CLAIM-FREE por desenho (sem entrada no EXIT_CLAIMS; o corpo usa
`código de saída`, nunca o token `exit N` que o EXIT_CLAIM_RE casa — a
mesma disciplina das 11.56/11.57). Renumerar uma seção claim-free move o
header mas NENHUMA claim muda de seção: sem claim detectada → sem
unregistered → sem CURE → o hook PASSARIA (exit 0) e o `--expect-cure`
falharia — a prova se perderia por razão errada. A fonte claim-bearing é a
11.58 (a 28ª claim, `current`): o body tem os tokens `exit code 0/1/2/3`
detectáveis, então o rename `11.58 → 11.98` move a claim para a seção nova
→ unregistered → CURE. A mesma classe de premissa que a 11.30 (SUPERSEDED)
documentou: o pedido citou a seção errada, o probe verificou antes de rodar.

**O ciclo (helper exit 0 em 13.9s real)**:
```
node scripts/hook-proof-run.mjs --branch ci-proof/renumber-live \
  --mutate-doc-renumber 11.58 --to 11.98 \
  --expect-cure --expect-log 'claim na secao 11.98'
```
O helper: backup do delta (patch + untracked + status snapshot + doc
byte-copy) → scratch `ci-proof/renumber-live` → delta commitado
(HUSKY=0) → renumber aplicado via `renumberDocSection` + commitado
(HUSKY=0) → push simulado `refs/heads/ci-proof/renumber-live <new>
refs/heads/ci-proof/renumber-live <old>` no hook real → verify → revert
byte-identical.

**O resultado**: hook **exit 1** com a CURE + 0 stale — o log capturado
(212 linhas) tem `claim na secao 11.98 nao esta no EXIT_CLAIMS` (linha
210) e a CURE (linha 211, a última saída do guard — o `set -euo pipefail`
mata o hook ali) e **0 menções a stale** (o contraste da sec 11.49: o
guard do push é direction-unique `.unregistered`; o par completo
CURE+stale é CLI-only, observado na Prova 39). Fuzz mapeado NÃO rodou (a
única ocorrência de `run-mapped-fuzz` no log é o listing ASCII-OK da
varredura mjs-gate, não o runner — o bloqueio veio ANTES do fuzz de
~6-14s). Revert byte-identical (git status 13 linhas = snapshot do delta
da thread; `git apply` + untracked + doc byte-copy) + controle pós-ciclo:
CLI `clean (28 claims)` exit 0 + 0 headers `## 11.98` reais na doc.

Registro de evento 8.x (fronteira de escopo da sec 11.51) — sem entrada no
EXIT_CLAIMS; registrada no PROOF_CLASSES (sec 11.60, classe
hook-proof-run, Prova 40).

**Re-validação (2026-08-12, 29 claims)**: a 29a claim (a sec 11.93, o
scan-proof-helpers — o 9o guard do batch, o contrato 11.72 no pre-commit)
exigiu a re-validacao datada DESTA secao (o mecanismo da sec 11.66/11.67:
a 8.35 cita `clean (28 claims)` e o count subiu para 29). Re-validado no
estado atual: CLI `clean (29 claims registradas em 26 current + 1
superseded + 2 measurement - sec 11.42)` exit 0 no repo real (verbatim) +
a suite hermetica do par verde. Registro de evento 8.x — sem entrada no
EXIT_CLAIMS (fronteira da sec 11.51, detector 11.x-only por desenho).


## 8.36 Prova 41 — a COLISÃO de target fail-loud no repo REAL via `hook-proof-run` (2026-08-11)

Prova viva da sec 11.59 (a colisão de target do `renumberDocSection`) — o
2º fail-loud do renumber com prova de pipeline, depois da Prova 40 (que
provou o CONTRASTE CURE+0stale do caminho feliz do renumber). A colisão
tinha E2E hermético (o teste da sec 11.59 + o irmão do no-op), mas faltava
o repo REAL: o helper rodando a mutação contra o doc real e o THROW virando
código de saída 3 fail-loud com o caminho exato.

**O ciclo (helper exit 3 fail-loud real)**:
```
node scripts/hook-proof-run.mjs --branch ci-proof/collision-live \
  --mutate-doc-renumber 11.58 --to 11.42 --hook .husky/pre-push
```
A mutação lê o doc REAL (a 11.42 existe — é a seção do EXIT_CLAIMS da sec
11.42) e o `toRe.test` da sec 11.59 casa: `renumberDocSection: secao
'## 11.42 ' JA existe no doc (ou e a propria secao - no-op, sec 11.59) - a
renumeracao criaria um header duplicado` → o try/catch do main() converte
em código de saída 3. O hook NUNCA rodou (a mutação morre na etapa 4,
antes do push simulado) — o mesmo espirito da sec 8.14: a mutação no-op
não pode passar como prova.

**O ACHADO do ciclo (a limpeza MANUAL do fail de mutação)**: o fail(3) da
mutacão NÃO roda o revertCycle — por desenho (o `scratchLeftNote` imprime
a receita: `git checkout <original> && git branch -D <scratch>` + o backup
em `<tmp>/hook-proof-*`). A limpeza manual é o MESMO revertCycle em
passos: checkout da original + branch -D + `git apply delta.patch` +
untracked restaurados do byte-copy + doc do byte-copy. O passo dos
untracked é o que o revertCycle faz e o manual precisa LEMBRAR: o `git add
-A` do commit do delta engoliu os 9 arquivos untracked da thread (o
`doc-revalidate.mjs`, o `hook-proof-run.mjs`, o `proofs-manifest.mjs`, os
fixtures e os testes) — eles sobrevivem no `<tmp>/hook-proof-*/untracked`
e precisam ser copiados de volta (a classe que o revertCycle cobre e a
Prova 38 provou byte-identical).

**O controle pós-ciclo (byte-identical)**: md5 do doc pré=pós (OK) + `git
status --porcelain` idêntico ao snapshot pré-ciclo (17 linhas) + branch de
volta em `freebuff/new-thread-thmsitz5qutoia` + scratch `ci-proof/`
deletada. Controle: `node scripts/scan-exit-claims.mjs --check` → clean (28
claims) + `node scripts/proofs-manifest.mjs --check` → clean (a Prova 41
registrada).

Registro de evento 8.x (fronteira de escopo da sec 11.51) — sem entrada no
EXIT_CLAIMS; registrada no PROOF_CLASSES (sec 11.60, classe
hook-proof-run, Prova 41).

**Re-validação (2026-08-12, 29 claims)**: re-rodou o CLI real no estado atual → `clean (29 claims registradas em 26 current + 1 superseded + 2 measurement - sec 11.42)` exit 0 (verbatim) — `--check` continua clean (0 unregistered + 0 stale): o par CURE+stale segue calibrado por claims novas, sem drift de seção. Registro de evento 8.x — sem entrada no EXIT_CLAIMS (fronteira da sec 11.51, detector 11.x-only por desenho).


## 8.37 Prova 42 — o caminho de ESCRITA real do doc-revalidate: upsert datado + idempotência do mesmo dia (2026-08-11)

**O pedido**: o doc-revalidate tinha prova hermética (funções puras + os
E2Es com fakes via `DOC_REVALIDATE_CLI_CMD`/`DOC_REVALIDATE_SUITE_CMD`) e o
REAL-REPO CONTRACT do `--dry-run --no-suite` — que valida CLI + count mas
NADA escreve. O caminho de escrita — o upsert datado da linha gerada na
seção alvo + a idempotência por data do re-run do mesmo dia — nunca tinha
sido exercitado contra um doc real de verdade (o helper tocando disco).

**A prova (executada no repo real)**: backup byte-identical do
`gates-proofs.md` em `/tmp/drv-proof-*.md` + 2 runs do helper REAL (CLI
real do scan-exit-claims via `EXIT_CLAIMS_DOC` apontando o backup + a
suite hermética do par) contra a sec 8.34:

1. **Run 1 (upsert)**: `node scripts/doc-revalidate.mjs --doc <backup>
   --section 8.34` → exit 0 com `linha 2026-08-11 (28 claims) upsertada`.
   A linha automática `**Re-validação (2026-08-11, 28 claims)**`
   (marcador SEM o 'datada') foi inserida no FIM do conteúdo da 8.34,
   DEPOIS da linha manual `**Re-validação datada (...)**` — que ficou
   INTACTA (1 linha; os prefixos diferentes garantem a não-colisão, o
   desenho da sec 11.61). O conteúdo da linha: o quote verbatim do CLI
   (`clean (28 claims registradas em 25 current + 1 superseded + 2
   measurement - sec 11.42)`) + a cláusula da suite (`26/26 verde` — o
   total real da suite do par).
2. **Run 2 (mesmo dia, idempotência)**: re-run com o MESMO `--date` →
   exit 0, a linha automática REPLACE (1 auto line, a seção não cresceu)
   e a manual segue intacta — o mesmo par que o teste hermético pina,
   agora com o CLI real + a suite real tocando um doc real.
3. **Controle pós-ciclo**: md5 do doc da thread pré=pós
   (`c34a4d173c5d87de44f38a399855175b`) — byte-identical (o `--doc`
   apontava o backup; o doc do repo nunca foi tocado) — + backup removido.

**O ACHADO (o que a prova viva pegou que a hermética não podia)**: o
caminho da SUITE do helper quebrava no Windows — o `DEFAULT_SUITE_CMD`
era `NO_COLOR=1 npx vitest run ...`, o prefixo POSIX de env que o
`cmd.exe` (o shell padrão do `spawnSync` no Windows) rejeita com
`'NO_COLOR' não é reconhecido como um comando interno ou externo`. O
caminho real da suite nunca tinha sido exercitado: os E2Es herméticos
usam fakes via env e o REAL-REPO CONTRACT roda `--no-suite`. Corrigido
nesta prova: `NO_COLOR` vai no ENV do spawn (`runCmd(suiteCmd, {
NO_COLOR: "1" })`), nunca como prefixo shell — cross-platform por
construção, o mesmo tratamento do HOOK_PROOF_GIT do hook-proof-run.

Registro de evento 8.x (fronteira de escopo da sec 11.51) — sem entrada no
EXIT_CLAIMS; registrada no PROOF_CLASSES (sec 11.60, classe
doc-revalidate — a classe NOVA do registry — Prova 42).

**Re-validação (2026-08-12, 29 claims)**: re-rodou o CLI real no estado atual → `clean (29 claims registradas em 26 current + 1 superseded + 2 measurement - sec 11.42)` exit 0 (verbatim) — `--check` continua clean (0 unregistered + 0 stale): o par CURE+stale segue calibrado por claims novas, sem drift de seção. Registro de evento 8.x — sem entrada no EXIT_CLAIMS (fronteira da sec 11.51, detector 11.x-only por desenho).


## 8.38 Prova 43 — o REVERT-FAIL do hook-proof-run no repo REAL: patch corrompido injetado → exit 3 fail-loud com o backup apontado (2026-08-12)

**O que foi provado**: o 4º fail path do `revertCycle` (a etapa 8 do ciclo do
`hook-proof-run`, sec 11.58 — os outros 3 são checkout, branch -D e status
divergente) — o **apply-fail** — com o delta REAL da thread (12 arquivos do
WIRED SURFACE) e um patch corrompido INJETADO via `--mutate` (o seam de
mutação da etapa 4, que roda APÓS o backup e ANTES do revert): o
`git apply delta.patch` falha e o ciclo sai **exit 3 fail-loud com o caminho
do backup apontado na mensagem**.

**O ciclo** (o padrão das Provas 37-41: backup + scratch ci-proof/* + delta
commitado via HUSKY=0 + mutação + push SIMULADO via stdin + revert):

```bash
node scripts/hook-proof-run.mjs --branch ci-proof/revert-proof --mutate "node -e \"const fs=require('fs'),os=require('os'),path=require('path');const t=os.tmpdir();const ds=fs.readdirSync(t).filter(d=>d.startsWith('hook-proof-')).map(d=>path.join(t,d)).sort((a,b)=>fs.statSync(b).mtimeMs-fs.statSync(a).mtimeMs);const dir=ds[0];fs.writeFileSync(path.join(dir,'delta.patch'),'CORRUPTED PATCH not a diff');console.log('corrupted:'+dir)\"" --expect-exit 0
```

O `--mutate` roda um one-liner node (acima, o comando EXATO da prova) que
localiza o backup dir do PRÓPRIO ciclo (o `hook-proof-*` mais novo no
`os.tmpdir()` — 290 dirs no ambiente, mas o do ciclo atual é sempre o mais
recente) e SOBRESCREVE o `delta.patch` com `CORRUPTED PATCH not a diff` — o
backup deixa de ser um patch válido. O hook REAL rodou **exit 0** (o delta é
verde — a rede de guards passa) e o revert então encontra o patch corrompido.

**Por que o apply é o membro REPRESENTATIVO da classe (o framing
"agregada")**: os 4 fail paths do `revertCycle` (checkout, branch -D, apply,
status divergente) NÃO são todos injetáveis de forma determinística num repo
real — o checkout de uma branch existente e o `branch -D` de uma scratch
recém-criada não falham naturalmente, e o status divergente exigiria
interferência externa concorrente. O apply é o único membro com um seam de
injeção limpo (o `--mutate` na etapa 4, que roda APÓS o backup e ANTES do
revert — o mesmo padrão de fronteira das secs 11.30/11.36). Os outros 3
continuam cobertos por síntese (o guard de forma da sec 11.65 pina a
`scratchLeftNote` em TODOS os fail paths POS-scratch, incluindo os 4 do
revert).

**O sinal observado** (stdout/stderr do helper):

```
hook-proof-run: hook exit 0 - log em C:\Users\X\AppData\Local\Temp\hook-proof-JY7L0i\hook.log (269 linhas)
hook-proof-run: verify: hook exit 0
hook-proof-run: git apply delta.patch falhou: error: No valid patches in input (allow with "--allow-empty") - backup em C:\Users\X\AppData\Local\Temp\hook-proof-JY7L0i - a branch scratch pode ter ficado: git checkout freebuff/new-thread-thmsitz5qutoia && git branch -D ci-proof/revert-proof (backup do delta em C:\Users\X\AppData\Local\Temp\hook-proof-JY7L0i)
```

**exit 3 fail-loud confirmado** (o `CYCLE_EXIT=3` do processo) com o backup
apontado DUAS vezes na mensagem (no fail do apply E na scratchLeftNote).

**O ACHADO do ciclo (a honestidade do revert-fail)**: o `revertCycle` roda o
`git branch -D <scratch>` ANTES do `git apply` — então quando o apply falha,
a scratch JÁ FOI deletada com o commit do delta dentro (o reflog mostra
`7074dab commit: hook-proof: ci-proof/revert-proof (delta)`) e o working tree
volta LIMPO **sem o delta** (o status pós-ciclo tinha 0 linhas vs 12 do
snapshot). A scratchLeftNote diz "git checkout <orig> && git branch -D
<branch>" — mas o checkout já voltou e o branch -D já rodou: a nota é
GENÉRICA (o mesmo template dos fail paths de infra) e não descreve o estado
real deste fail path. A recuperação real do delta é o **reflog do commit
órfão** (`git cherry-pick 7074dab` / `git fsck`) ou um **safety diff externo**
— nesta prova, o delta foi restaurado via `git apply /tmp/prova43-safety.diff`
(2046 linhas salvas ANTES do ciclo) → **byte-identical (git status 12 linhas
= snapshot, de volta em `freebuff/new-thread-thmsitz5qutoia`)**. O backup
apontado NÃO é a fonte de recuperação do delta (o delta.patch dele é o
corrompido) — só os untracked + doc + status-before (que nesta prova estavam
vazios/intactos).

Registro de evento 8.x (fronteira de escopo da sec 11.51) — sem entrada no
EXIT_CLAIMS; registrada no PROOF_CLASSES (sec 11.60, classe hook-proof-run —
Prova 43).

## 8.39 Prova 44 — o guard da 11.72 ao vivo: docblock `3 = falha de` removido
no hook-proof-run REAL → a suite falha com o caminho exato (2026-08-12)

**O que foi provado**: o guard da sec 11.72 (o contrato PROOF_HELPERS — as 3
partes do fail-loud por helper de prova: docblock `Exit codes:` cobrindo 0..3
em ordem, nota de limpeza LeftNote, E2E do caminho) tinha prova hermetica
(MUTATIONs sobre copias em tmp) mas sem prova viva: faltava confirmar que a
suite da 11.72 le o docblock do ARQUIVO REAL (nao uma copia) e falha quando o
`3 = falha de` some da linha 68 do `Exit codes:` — o mesmo padrao da Prova 43
(mutacao real + suite real + restore byte-identical).

**O ciclo** (o padrao das Provas 37-43: backup + mutacao + suite + restore):

```bash
cp scripts/hook-proof-run.mjs /tmp/prova44-hpr.bak        # backup byte-identical
sed -i '68s/3 = falha de/X = falha de/' scripts/hook-proof-run.mjs   # mutacao
NO_COLOR=1 npx vitest run scripts/__tests__/proof-helpers-contract.test.ts --config vitest.config.unit.ts
mv /tmp/prova44-hpr.bak scripts/hook-proof-run.mjs        # restore
```

**O sinal observado** (o assert da parte (a) da 11.72):

```
hook-proof-run.mjs: o docblock deve documentar os exit codes 0-3
```

**suite exit 1 confirmado** — o `EXIT_CODES_RE` da 11.72 nao encontra mais a
sequencia `3 = falha de` no docblock real e a parte (a) falha com o caminho
exato do helper (o path:line aponta o arquivo mutado, nao um resumo); o
restore byte-identical devolveu a suite ao verde (md5 pre=pos do arquivo +
git status limpo).

Registro de evento 8.x (fronteira de escopo da sec 11.51) — sem entrada no
EXIT_CLAIMS; registrada no PROOF_CLASSES (sec 11.60, classe hook-proof-run —
Prova 44).

## 8.40 Prova 45 — os guards 11.73/11.82 ao vivo: hook-proof-run.test.ts
ADICIONADO ao test:guard do package.json REAL → a suite falha com os 6
testes exatos (2026-08-12)

**O que foi provado**: os pins da sec 11.73 (a divisão de trabalho test:guard
vs test:unit — o hook-proof-run.test.ts NÃO pode entrar na lista curada do
push net) e da sec 11.82 (o ABS PIN das 14 suites, derivado e pinado no
scan-guard-gates.test.ts) tinham prova hermética (MUTATIONs sobre cópias em
tmp) + REAL-REPO CONTRACT (a suite lê o package.json real e asserta o estado
limpo), mas sem prova VIVA: faltava confirmar que a suite falha quando o
package.json REAL ganha a 15ª suite — o cenário exato que a MUTATION da
11.73 injeta sinteticamente, agora no arquivo real.

**O ciclo (o mesmo padrão da Prova 44 — o pin é de SUITE, então o veículo é
a suite contra o arquivo real mutado, não um ciclo git/hook)**:

1. **Backup byte-identical**: `cp package.json /tmp/prova45-pkg.bak` (sha256
   confirmado pre=pos).
2. **Mutação**: `node -e` inserindo ` scripts/__tests__/hook-proof-run.test.ts`
   após o `doc-revalidate.test.ts` no script test:guard (o MESMO replace da
   MUTATION da 11.73, no arquivo real) — confirmado: 15 suites, carries
   hook-proof-run = true.
3. **A suite real contra o arquivo real mutado**: `npx vitest run
   scripts/__tests__/scan-guard-gates.test.ts --config vitest.config.unit.ts`.
4. **Restore byte-identical**: `mv /tmp/prova45-pkg.bak package.json`
   (sha256 volta ao original; git diff package.json = 0) + suite verde de
   novo.

**O sinal observado (exit 1, 6 testes falham / 47 passam)**: a mutação
derrubou EXATAMENTE os pins que leem o package.json real — o `REAL-REPO
CONTRACT (sec 11.73)` (o `testGuardCarriesSuite(tg, "hook-proof-run.test.ts")`
deixa de ser false), a `MUTATION (sec 11.73)` (a mesma asserção no tg real),
o `REAL-REPO CONTRACT (sec 11.82)` (a derivada tem 15, o ABS PIN tem 14) e
as 3 MUTATIONs da 11.82 — todos com o caminho exato no stdout do vitest
(`scripts/__tests__/scan-guard-gates.test.ts > ... > REAL-REPO CONTRACT
(sec 11.73): o hook-proof-run NAO esta no test:guard...`). O resto da suite
(47 testes — os MUTATIONs herméticos de workflow/paths/needs e o CLI
sintético) não foi afetado: o pin é preciso no alvo.

**O veredito**: o guard 11.73/11.82 é um guard de SUITE (o push net roda o
test:guard no CI, e o scan-guard-gates.test.ts roda DENTRO dele — a suite
que se auto-protege). O falso-negativo da classe (adicionar a 15ª suite)
falha no repo real com o caminho exato — a divisão de trabalho é
estrutural, não só sintética. O restore devolveu o estado byte-identical
(git status limpo, package.json sem resíduos).

Registro de evento 8.x (fronteira de escopo da sec 11.51) — sem entrada no
EXIT_CLAIMS; registrada no PROOF_CLASSES (sec 11.60, classe scan-guard-gates
— Prova 45).


## 8.41 Prova 46 — o status-divergente do revert-fail ao vivo: o flip do
.gitignore faz o untracked sobreviver ao revert → git status diverge → exit
3 com a CURE do snapshot (2026-08-12)

**Pedido**: o stage `status` do `revertLeftNote` (a CURE stage-aware da sec
11.75) só tinha prova sintética (a matriz de stages no teste — apply-fail e
status-fail → CURE; checkout/branchD → receita genérica). O apply-fail teve
a Prova 43 ao vivo (sec 8.38 — patch corrompido, exit 3 com o backup
apontado), mas o status-divergente nunca falhou no repo REAL: faltava
confirmar que o CLI imprime a CURE do snapshot (`PASSou` + `status-before.txt`
+ reflog como fallback) quando o revert morre na comparação do status —
fechando o par de stages pos-branch-D com prova de pipeline.

**O desenho da prova — o ACHADO do mecanismo (probe empírico)**: injetar um
arquivo extra pós-revert via `--mutate` NÃO é trivial: um `--mutate "touch
stray.tmp"` cru é varrido pelo `git add -A` do commit de mutação (etapa 4 do
ciclo) e o `git checkout <orig>` do revert o REMOVE (o arquivo virou tracked
no scratch commit — probe empírico: após o checkout, `ls` não mostra o
arquivo). O FLIP do `.gitignore` resolve: `--mutate "touch stray.tmp && echo
stray.tmp >> .gitignore"` — o `git add -A` do commit de mutação IGNORA o
arquivo (o próprio mutate o colocou no .gitignore), então o stray.tmp nunca
entra no scratch commit; o revert restaura o .gitignore do branch original
(sem a linha) mas o stray.tmp fica no working tree como UNTRACKED → o `git
status --porcelain` pós-revert tem `?? stray.tmp` a mais vs o snapshot → a
comparação diverge → stage `status`. Probe empírico confirmou: com o flip, o
arquivo sobrevive ao checkout (`?? stray2.tmp` no status pós-checkout).

**O ciclo executado** (repo real, 3 runs — o 1º provou o mecanismo, o 2º foi
contaminado pelo stray.tmp do 1º, o 3º limpo com a captura do exit):
`node scripts/hook-proof-run.mjs --branch ci-proof/hpr-statusdiv3 --mutate
"touch stray.tmp && echo stray.tmp >> .gitignore" --expect-exit 0` → o
mutate roda na etapa 4 (após o backup, antes do revert — o seam de injeção);
hook real exit 1 (o push simulado bloqueou por outro gate — irrelevante para
a prova: o revert-fail vem ANTES do verify no main). **A fronteira do método
(confirmada pelo run 2, que saiu exit 1 em vez de 3)**: a divergência só
dispara quando o stray.tmp NÃO está no snapshot pre-ciclo — no run 2 o
arquivo deixado pelo run 1 foi capturado no backup (o status-before.txt já
tinha a linha `?? stray.tmp`) e o pós-revert bateu com o snapshot, revertendo
limpo; o run 3 (com o stray removido antes) é o que prova a classe. O
`rm stray.tmp` entre runs não é só limpeza — é a PRE-CONDIÇÃO da injeção.

**O sinal observado** — helper **exit 3 fail-loud**: `git status divergiu do
snapshot pre-ciclo - backup em C:\...\hook-proof-MJFGhc` + a CURE do snapshot
na MESMA linha: `o apply do delta PASSou (o delta do ciclo JA esta na arvore
- o revert so falhou na comparacao do git status vs o snapshot): compare
'git status --porcelain' com <backup>/status-before.txt e reconcilie a
divergencia; se o delta faltar, recupere do reflog ('git reflog' + 'git
cherry-pick <sha>') ou do safety diff externo (backup em <dir>)`. A CURE
imprimida é EXATAMENTE a matriz sintética do teste — o CLI real confirma o
pin comportamental.

**O cleanup e a restauração**: o revert-fail deixa o stray.tmp no working
tree (o untracked que causou a divergência — ele NÃO está no backup, o
revert só restaura o que copiou); `rm stray.tmp` + `git status --porcelain`
byte-identical vs o snapshot pre-ciclo (17 linhas idênticas após os 3
ciclos, de volta em `freebuff/new-thread-thmsitz5qutoia`). O delta da thread
foi preservado (o apply do revert rodou antes do status check falhar).

**O veredito**: o status-divergente é alcançável ao vivo via o flip do
.gitignore — a classe 'arquivo extra pós-revert' precisa do arquivo
ignorado no momento do commit de mutação (o ACHADO do mecanismo, agora
documentado). O CLI real imprime a CURE do snapshot com o caminho do
status-before.txt e o reflog como fallback — o par pos-branch-D do
revertLeftNote (apply = Prova 43, status = Prova 46) está fechado com prova
de pipeline nos dois lados.

Registro de evento 8.x (fronteira de escopo da sec 11.51) — sem entrada no
EXIT_CLAIMS; registrada no PROOF_CLASSES (sec 11.60, classe hook-proof-run
— Prova 46).


## 8.42 Prova 47 — o SAFETY-DIFF ao vivo: o --mutate corrompe o delta.patch do backup → exit 3 com a CURE 2-NÍVEIS citando `git apply <sd>`; a recuperação manual restaura o TRACKED byte-identical, mas os untracked dependem do backup (2026-08-12)

**Pedido**: a fronteira da sec 11.77 (o revertCycle aplica o delta.patch do
backup; o safety diff é recuperação MANUAL citada na CURE) vivia em prosa +
teste hermético. O apply-fail teve a Prova 43 ao vivo (sec 8.38 — patch
corrompido, exit 3 com o backup apontado), mas o safety diff nunca foi
provado no pipeline real: faltava confirmar que o CLI aponta o safety diff
NA CURE e que o `git apply <path>` recupera o delta byte-identical — a
receita manual da 11.77 como comportamento observado.

**O ciclo executado** (repo real, delta da thread de 17 linhas):
`node scripts/hook-proof-run.mjs --branch ci-proof/sd-live-proof --safety-diff
<sd> --mutate "node -e \"const fs=require('fs'),os=require('os'),p=require('path');const d=fs.readdirSync(os.tmpdir()).filter(x=>x.startsWith('hook-proof-')).map(x=>({x,m:fs.statSync(p.join(os.tmpdir(),x)).mtimeMs})).sort((a,b)=>b.m-a.m)[0].x;fs.writeFileSync(p.join(os.tmpdir(),d,'delta.patch'),'corrompido')\"" --expect-exit 0` —
o safety diff é salvo ANTES da mutação (cópia intacta, o padrão do fato
consumido da 11.84); a mutação corrompe SÓ o delta.patch do backup (o one-liner mira o backup MAIS RECENTE do tmpdir — o mkdtemp cria um dir novo por ciclo, então o mais recente é o do PRÓPRIO ciclo); o revert
do fim do ciclo falha no apply (patch inválido) → exit 3 fail-loud com a
CURE 2-NÍVEIS da 11.75 citando `git apply <sd>` como 1º nível.

**A recuperação manual confirmada**: `git apply <sd>` → o diff sha256 é
byte-identical ao pré-ciclo (ca04632…) — o delta TRACKED da thread voltou.
**O ACHADO (a fronteira honesta da 11.77, agora medida)**: o safety diff
recupera o TRACKED, mas os 5 untracked da thread SUMIRAM da árvore pós-revert
— restaurados manualmente do `backup/untracked/` (a classe exata que o
`--safety-backup` da sec 11.89 fecha: o diff é o patch do rastreado, o
espelho é o ciclo completo). **Side finding**: o hook do ciclo saiu exit 1
por um byte não-ASCII em `scripts/guard-remeasure.mjs:67` — o byte vivia no DELTA PENDENTE da PRÓPRIA thread (guard-remeasure.mjs é arquivo novo não-commitado desta thread, a classe do mjs-gate)
("re-medições") — a classe do verify-encoding/utf8-check, flagrada pelo ASCII
guard do pre-push, sem relação com o safety diff; CORRIGIDO nesta registração (o byte virou ASCII — 0 bytes não-ASCII no arquivo).

**O veredito**: a fronteira da 11.77 é comportamento de pipeline confirmado
— o CLI aponta o safety diff na CURE, a receita manual restaura o rastreado,
e a lacuna medida (untracked fora do diff) é a motivação viva do
`--safety-backup` da 11.89.

Registro de evento 8.x (fronteira de escopo da sec 11.51) — sem entrada no
EXIT_CLAIMS; registrada no PROOF_CLASSES (sec 11.60, classe hook-proof-run
— Prova 47).


## 8.43 Prova 48 — o guard da 11.72 ao vivo no LADO ci-proof-run: docblock `Exit codes:` mutado no ci-proof-run.mjs real → a suite da 11.72 falha com o path exato (2026-08-12, local, sem rede)

**O pedido**: a Prova 44 (sec 8.39) provou o guard da 11.72 ao vivo no hook-proof-run (o docblock `3 = falha` removido → suite falha com o path). O IRMÃO ci-proof-run do MESMO contrato (as 3 partes do fail-loud em TODO helper de prova, sec 11.72 — manifest derivado da sec 11.79) seguia só com prova hermética (o MUTATION sintético da suite). Faltava confirmar no repo real: a suite da 11.72 lê o ci-proof-run.mjs REAL e falha quando o docblock perde o `3 =`.

**O veredito**: ADOTADO como prova viva local (padrão Prova 44 — mutação do source real + suite real + revert byte-identical, sem rede). A mutação usou o MESMO alvo que o MUTATION da parte 1 usa no hook-proof-run (`3 = falha de` → `X = falha de`), aplicado ao ci — a linha 124 do docblock, a única ocorrência de `3 = ` no arquivo (confirmado por grep antes de mutar, o alvo é inambíguo; o MUTATION hermético do próprio ci-proof-run na suite é a remoção da NOTA, não o exit code — os dois helpers têm o mesmo docblock `Exit codes:`, então o alvo do irmão casa). A suite real falhou com a mensagem EXATA da parte 1: `ci-proof-run.mjs: o docblock deve documentar os exit codes 0-3 (Exit codes: 0 = ... 1 = ... 2 = ... 3 = ...)`.

**A execução**: `cp scripts/ci-proof-run.mjs /tmp/prova48-cipr.bak && sed -i 's/3 = falha de/X = falha de/' scripts/ci-proof-run.mjs && npx vitest run scripts/__tests__/proof-helpers-contract.test.ts --config vitest.config.unit.ts` → **1 falhou / 5 passaram** (exatamente o teste `todo helper da DERIVADA tem as 3 partes`); `mv /tmp/prova48-cipr.bak scripts/ci-proof-run.mjs` → sha1 `4bed5df4ac21` byte-identical ao pré-mutação, 0 ocorrências de `X = falha de` (grep).

**A fronteira honesta**: a prova fecha o lado ci do par 11.72 (os dois helpers de prova agora têm prova viva da parte 1). As partes 2 (nota de limpeza) e 3 (E2E do caminho) do lado ci seguem só herméticas — o par completo das 3 partes nos DOIS helpers seria uma prova agregada (mutar as 3 partes no ci-proof-run de uma vez e ver as 3 falhas no mesmo run), uma avaliação futura natural desta classe.

Registro de evento 8.x (fronteira de escopo da sec 11.51) — sem entrada no
EXIT_CLAIMS; registrada no PROOF_CLASSES (sec 11.60, classe ci-proof-run
— Prova 48).

## 8.44 Prova 49 — a nota SERIALIZED POOL removida do config real → a suite da 11.80/11.95 falha com o path exato (2026-08-12, local, sem rede)

**O pedido**: o pin da nota do singleFork (sec 11.80 poolNotePresent) e o pin da citação da planura (sec 11.95) tinham prova hermética (MUTATIONs sobre strings do config), mas sem prova viva — faltava confirmar que a suite da 11.80 lê o vitest.config.unit.ts REAL e falha quando a nota SOME (o cenário exato que o 10º guard do batch, scan-unit-config da sec 11.96, protege no pre-commit).

**O veredito**: ADOTADO como prova viva local (padrão Provas 43/44 — mutação do source real + suite real + revert byte-identical, sem rede). A mutação removeu o bloco `// SERIALIZED POOL` inteiro (o MESMO alvo do MUTATION da sec 11.80, `CONFIG.replace(/\/\/ SERIALIZED POOL[\s\S]*?pool: "forks",/, ...)`), mantendo o `singleFork: true` real intacto (grep pós-mutação: 0 ocorrências de SERIALIZED POOL, 1 de singleFork).

**A execução**: `cp vitest.config.unit.ts /tmp/prova49-vitest.bak && node -e "...remover do índice de '// SERIALIZED POOL' até a linha 'Pinned by scripts/__tests__/unit-surface-contract.test.ts.'..." && npx vitest run scripts/__tests__/unit-surface-contract.test.ts --config vitest.config.unit.ts` → **4 falharam / 15 passaram** — o REAL-REPO da 11.80 (`poolNotePresent(CONFIG)` false), o REAL-REPO da 11.95 (`noteCalibration` throw "flatness citation not found") e 2 MUTATIONs da 11.95 em cascata (as que dependem da citação presente; a MUTATION "stripping the rationale note" PASSOU porque espera o false, e o REAL-REPO da 11.83 PRESENCE passou — a falha é localizada na nota). CLI `node scripts/scan-unit-config.mjs --check` → **exit 1** com o path exato: `vitest.config.unit.ts: o bloco '// SERIALIZED POOL' da nota (sec 11.80) ausente ou sem os tokens (sec 8.1, 2026-08, DO NOT "parallelize", singleFork: true)` + a CURE. Revert: `mv /tmp/prova49-vitest.bak vitest.config.unit.ts` → sha1 `508929d5885a8ed023af72b0ff064875eb51eb1a` byte-identical; CLI clean exit 0 de novo.

**A fronteira honesta**: a prova fecha o lado do PIN (a suite lê o config real e falha quando a nota some) e o lado do GUARD (o CLI exit 1 com o path). O que NÃO cobriu: a cascata no batch runner (o 10º guard falharia no pre-commit com a mesma violação — implicado pela mesma checagem, não rodado; o isolamento sintético da 11.96 já prova a saída agregada). E a graduação do registry: o scan-unit-config tinha entrada no WIRED_ALLOWLIST com a rationale "sem Prova dedicada" — esta prova viva dá a Prova dedicada, então ele GRADUOU para classe no PROOF_CLASSES (sec 11.60) e saiu do allowlist (9 → 8 entradas), registrando a fronteira do registry no próprio evento de Prova.

**Controle pós-ciclo**: `node scripts/scan-unit-config.mjs --check` clean exit 0; `node scripts/proofs-manifest.mjs --check` → clean (20 classes / 49 provas / 20 wired cobertos); vitest das suites tocadas verde; ASCII/UTF-8 OK; ordering 8.43 → 8.44 → 9 monotônico.

Registro de evento 8.x (fronteira de escopo da sec 11.51) — sem entrada no EXIT_CLAIMS; registrada no PROOF_CLASSES (sec 11.60, classe scan-unit-config — Prova 49).

## 8.45 Prova 50 — revert-fail apply ao vivo com delta.patch do backup INTEGRO (sem knob): poison commit no branch original -> apply-fail exit 3; 'git apply <backup>/delta.patch' (nivel 1) recupera byte-identical (2026-08-12, local, sem rede)

**O pedido**: a CURE em 2 níveis da sec 11.75 (`revertLeftNote`: (1) `git apply <backup>/delta.patch` quando o patch é íntegro — a receita do dia a dia; (2) reflog/cherry-pick ou safety diff SÓ quando o patch é inválido) tinha pin hermético + a Prova 47 provou o caminho do patch CORROMPIDO (o nível 2). Faltava o pipeline real do NÍVEL 1: um revert-fail de apply com o delta.patch do backup INTEGRO — sem o knob `HOOK_PROOF_FAKE_FAIL_APPLY`, a injeção por conflito de árvore REAL (a classe do Prova 46) — e a confirmação de que `git apply <backup>/delta.patch` recupera o delta byte-identical.

**O veredito**: ✅ **provado ao vivo**. O ciclo rodou com `--safety-diff`; a mutação commitou o poison na branch original; o hook passou; o revert falhou no apply com o patch íntegro (exit 3, a CURE 2-níveis); a recuperação nível 1 (`git apply <backup>/delta.patch`, após limpar o blocker) restaurou o delta byte-identical (status 21 linhas == snapshot + git diff sha256 == safety diff).

**A execucao**: o ciclo (`hook-proof-run --branch ci-proof/* --safety-diff /tmp/prova50-safety.diff --mutate ...`) rodou o hook real via stdin — **passou** (`[OK] pre-push: todos os gates passaram` no hook.log do backup, os 10 guards + as 10 suites tocadas verdes). A mutação injetou o commit `poison-l1` (df9792d) na branch original: `scripts/scan-exit-claims.mjs` reduzido a `// POISON-L1` (636 deleções — o arquivo envenenado É um dos 16 do delta.patch). O revert: checkout original + `branch -D` da scratch (com o delta commitado dentro, órfão no reflog) + `git apply <backup>/delta.patch` → **FALHOU com o patch íntegro** — re-demonstrado na árvore pós-fail: `error: patch failed: scripts/scan-exit-claims.mjs:258` (o contexto do patch não casa com o arquivo envenenado) → exit 3 fail-loud com a CURE 2-níveis. **Pós-fail**: HEAD = `poison-l1`, árvore limpa, delta vivo SÓ no backup `/tmp/hook-proof-RsCDqA` (delta.patch 112KB íntegro + `untracked/` + `status-before.txt`). **Recuperação nível 1** (a prova do pedido, executada nesta continuação): `git reset --hard 373bd74` (limpar o blocker — o commit poison) + `git apply /tmp/hook-proof-RsCDqA/delta.patch` → `APPLY_L1_OK` + untracked restaurados de `backup/untracked/`.

**A fronteira honesta**: (1) o stderr EXATO do ciclo original não foi capturado — a sessão morreu no meio do ciclo (após o fail do revert, antes da recuperação); o exit 3 + a CURE 2-níveis são o caminho DETERMINÍSTICO do código (`fail(3, ...revertLeftNote('apply', ...))` quando o revertCycle falha — o mesmo gate que as Provas 43/46/47 observaram ao vivo), e o estado pós-fail (HEAD no poison `df9792d`, delta só no backup) é a evidência de que o apply falhou; a recuperação nível 1 foi executada nesta continuação com o output real. (2) O texto exato do `--mutate` não foi preservado (a sessão morreu antes do output) — só o efeito observado (o commit `df9792d`): o comando real na narrativa é uma reconstrução fiel da forma. (3) O nível 1 assume o conflito de árvore RESOLVIDO — a CURE cita o apply, mas num revert-fail por conflito real o usuário primeiro limpa o blocker (aqui: o reset do poison; no dia a dia: reverter a mudança conflitante). O que a prova NÃO cobre: o backup perdido (aí só o safety diff/backup externo resta — o ACHADO da Prova 47) e o knob hermético segue sendo o seam sintético do E2E da 11.76 (a injeção REAL aqui é o conflito de árvore, sem o knob). (4) O refinamento 2 da sec 11.75 (2026-08-12, mesmo dia) virou a hierarquia em texto numa DECISÃO VERIFICADA — o call site do fail roda `git apply --check <backup>/delta.patch` e a CURE cita SÓ o nível aplicável; o texto da CURE citado nesta prova é o da época (a hierarquia em 2 níveis), mas o comportamento observado (patch íntegro + árvore com blocker → o check falha → reflog; e a recuperação nível 1 após limpar o blocker) é exatamente o que a decisão verificada preserva.

**Controle pos-ciclo**: `git status --porcelain` == `status-before.txt` (21 linhas = 16 M + 5 untracked, `STATUS_IDENTICAL`); `git diff` sha256 == safety diff sha256 (`44c23838…`); manifest CLI `clean (20 classes / 50 provas registradas; 20 guards wired)`; a suite do contrato passou como gate do registro (49→50).

**Registro de evento**: Prova 50 (classe hook-proof-run, sec 8.45, local, sem rede).

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

**Re-validação**: `ci-proof-run.test.ts` (58 testes, incl. o CONTRACT do
par mutuamente exclusivo com o SCRIPT-OWNED da 11.28 — sec 11.27/11.28
pinadas num único teste) + `scan-timeouts.test.ts` (BASELINE) — verdes;
`gates-proofs-ordering.test.ts` valida a monotonia da nova seção 11.27
(11.26 antes, 12 depois); tsc 0; eslint 0 erros; UTF-8 do doc OK.

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

**Re-validação**: `ci-proof-run.test.ts` (58) + `scan-timeouts.test.ts`
(BASELINE) — verdes; o teste CONTRACT do par (sec 11.27/11.28) prova o
lado runner-owned (flag + script auto-deletado = exit 3 fail-loud com o
marker escrito — o script RODOU e sumiu ANTES do runner olhar) e o lado
SCRIPT-OWNED (mesmo script sem flag = exit 0) num único lugar;
`gates-proofs-ordering.test.ts` valida a monotonia da nova seção 11.28
(11.27 antes, 12 depois); tsc 0; eslint 0 erros; UTF-8 do doc OK.

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

## 11.30 O falso-negativo do `eval` — a fronteira documentada da 11.29 vira contrato ACEITO (decisão 2026-08-11)

**A pergunta**: a 11.29 documenta (em prosa) que o escape que o guard NÃO
cobre é esconder o TOKEN `curl` (não o URL) dentro de uma string avaliada
depois (`CMD="curl ..."; eval "$CMD"`) — o token mascarado não é uma
invocação real para o detector. Avaliar um teste de contrato que pince esse
falso-negativo como comportamento ACEITO, para o leitor da fronteira nunca
ler a 11.29 como um furo não decidido.

**O achado (medição antes de decidir)**: probe real do guard — um gate
script sintético com `CMD="curl -s -o /dev/null -w \"%{http_code}\"
\"$HEALTH_URL\" 2>/dev/null"; eval "$CMD"` varre CLEAN (violations `[]`,
CLI exit 0) e o `maskBashStrings` mostra o porquê: o token `curl` vive DENTRO
da string mascarada (`MASKED: "CMD=\"...\"; eval \"...\""` — o conteúdo
vira espaços), então `CURL_INVOKE_RE` não vê invocação nenhuma. A fronteira
documentada é comportamento REAL, não uma conjectura.

**VALE ADOTAR com o contrafactual embutido**: o teste não pode ser um pass
vácuo (um detector que casa nada passaria nos dois lados) — o par pina os
dois lados da decisão no MESMO teste:

1. **PURE (o ACEITO)**: o eval-built curl sem `--max-time` → scanGateScript
   retorna `[]` (clean) E o masked mostra o mecanismo (o token consumido pela
   máscara — `not.toContain("curl")` no `maskBashStrings`).
2. **COUNTERFACTUAL (a prova de que é deliberado, não detector morto)**: o
   MESMO curl como invocação direta (token fora de string) É flagado (1
   violação) — se um refactor futuro silenciosamente quebrar o detector, é
   ESTA metade que quebra; a fronteira aceita fica um limite nomeado, nunca
   um pass vácuo.
3. **CLI (o end-to-end)**: o eval-built curl num root sintético → exit 0
   "clean" — o contrato do CLI mostra os dois lados (bare curl → exit 1 das
   MUTATIONs; eval token → exit 0 ACEITO).
   ⚠️ **SUPERSEDIDO (sec 11.36 + Prova 26, sec 8.21, run 31485163704)**: o
   tripwire da 11.36 mudou o CLI — a forma agora FALHA (exit 1) com `EVAL
   CURL (sec 11.30)` + file:line, observado ao vivo no pipeline real (o
   falso-negativo do DETECTOR — nenhum `CURL WITHOUT --max-time` no log —
   segue verdadeiro; a única razão do exit 1 é o aviso do tripwire).

**Fronteira travada**: o custo de fechar o eval (rastrear `eval` de strings
com `curl`) segue alto demais para uma forma que NÃO existe na superfície
(0 gate scripts usam); o teste vira o registro estrutural da decisão — quem
ler a 11.29 vê que o falso-negativo foi MEDIDO, PINADO e ACEITO, não
esquecido.

**Implementação** (`scan-curl-timeouts.test.ts`, 17 → 19 testes): 1 PURE com
contrafactual + 1 CLI, seguindo o padrão bidirecional das suítes irmãs.

**Re-validação**: `scan-curl-timeouts.test.ts` (19) + `scan-timeouts.test.ts`
(BASELINE) — verdes; `gates-proofs-ordering.test.ts` valida a monotonia da
nova seção 11.30 (11.29 antes, 12 depois); tsc 0; eslint 0 erros; UTF-8 do
doc OK.

## 11.31 A superfície de formas de invocação — só `curl` + `--max-time` literal, e `--connect-timeout` sozinho FALHA por decisão (decisão 2026-08-11)

**A pergunta**: o detector chaveia no token `curl` + a flag `--max-time` —
mas a forma curta (`-m 20`), um wrapper (`curl2() { curl "$@"; }`) ou um
`alias` passariam? E o `--connect-timeout` sozinho (sem `--max-time`) deve
falhar ou passar? Avaliar a superfície de formas que o guard reconhece hoje
e documentar a decisão.

**A medição (probe real, 18 formas — a premissa do pedido estava PARCIALMENTE
errada; a rodada do token-surface 2026-08-11 adicionou 6 formas, TODAS
pinadas na matriz)**: varri cada forma num gate script sintético (token curl
fora de string, linha 3):

| Forma | Guard | Por quê |
|---|---|---|
| `curl ... "$URL"` (bare) | **FLAG** | a classe |
| `curl ... -m 20 "$URL"` | **FLAG** | a forma curta NÃO é reconhecida — over-flag (direção segura) |
| `curl ... --MAX-TIME 20 "$URL"` | **FLAG** | case-variante NÃO casa (MAX_TIME_RE é case-sensitive, sem flag i) — over-flag direção segura; a forma é também ERRO do curl (fail-loud, nunca hang) |
| `curl ... --Max-Time 20 "$URL"` | **FLAG** | a MESMA classe (case-variante pinada) |
| `curl ... --max-time 20` | clean | o contrato literal |
| `curl ... --connect-timeout 10` | **FLAG** | só bounds a fase de connect, não o total |
| `--max-time 20 --connect-timeout 10` | clean | o par saudável |
| `curl2() { curl "$@"; }` (DEF sem bound) | **FLAG** | o token real vive no CORPO — o DEF é o chokepoint |
| `curl2() { curl --max-time 20 "$@"; }` (DEF com bound) | clean | a indireção segura é permitida |
| `curl2 ...` (CALL) | clean | `curl2` não casa `\bcurl\b` — invisível, mas o DEF já guarda o script |
| `alias curl='curl --max-time 20'` | **FLAG** | o token NOME do alias (fora da string) over-flags |
| `CURL_BIN=curl` | **FLAG** | o over-flag documentado do header |
| `command -v curl` | clean | probe de existência, excluído explicitamente |
| `/usr/bin/curl ... "$URL"` (caminho absoluto) | **FLAG** | COBERTO — a premissa INVERTIDA: o `\bcurl\b` casa na borda `/` (probe 2026-08-11) |
| `env curl ... "$URL"` | **FLAG** | COBERTO — o espaço é borda de palavra; mesma inversão de premissa |
| `env CURL_TIMEOUT=20 curl ... "$URL"` | **FLAG** | COBERTO — o prefixo `VAR=` não muda a borda (o token segue fora de string, detectado) |
| `"/usr/bin/curl" ... "$URL"` (quotado) | clean | **ESCAPE ACEITO** — o maskBashStrings consome o token na string; a classe irmã do eval SEM o trigger `eval` (o tripwire 11.36 não a pega) |
| `"$(command -v curl)" ... "$URL"` (quotado) | clean | **ESCAPE ACEITO** — idem; o idioma de resolução portátil quotada é exatamente o que o masking esconde |
| `CURL=$(command -v curl); "$CURL" ...` | clean | excluído pela regra do probe de existência (a linha contém `command -v curl`) — e a invocação `$CURL` é variável (token ausente); mecanismos sobrepostos, documentado |

**Achados (por que a decisão é manter, não ampliar)**:

1. **A premissa "a forma curta passaria" está errada** — `-m 20` FLAGIA.
   O detector reconhece SÓ o token literal `--max-time`; a forma curta
   over-flaga, e isso é a direção SEGURA (o custo é o mesmo `--max-time`
   explícito, a classe de custo documentada — nunca um furo). A forma longa
   é o canônico do guard; ampliar para `-m` adicionaria ambiguidade de
   parsing (um `-m` solto em flag combi) para zero ganho de classe.
2. **O wrapper NÃO é um furo** — o token real vive no corpo da função, então
   o DEF é o chokepoint exato: um wrapper sem bound no corpo FALHA onde o
   bound pertence (e a correção — pôr `--max-time` no corpo — bounds TODAS
   as chamadas); com o bound, a indireção segura passa. O CALL é invisível,
   mas o DEF da mesma linha de função já guarda o script inteiro.
3. **`--connect-timeout` sozinho: MANTER FAIL** — ele bounds apenas a fase
   de connect; um stall de corpo pós-connect (banda lenta, servidor
   engasgado) continuaria pendurando o CI minutos. Só o `--max-time` bounds
   o TOTAL — a classe-killer do incidente (9:08). A decisão é explícita:
   connect-timeout é RECOMENDADO como complemento, nunca substituto.
4. **`alias curl='curl --max-time 20'` over-flaga** (o token NOME do alias,
   fora da string) — direção segura; o alias que ADICIONA o bound ainda
   custa a forma explícita (ou a correção documentada de pôr a flag onde o
   guard a vê). NOTA (consistência com a 11.30): este caso é o ESPELHO da
   fronteira do `eval` — o bound está escondido DENTRO da string do alias,
   então o guard vê o nome do alias mas não o bound contido na string; a
   irmã (11.30) esconde o TOKEN, esta esconde o FLAG — o MESMO mecanismo de
   masking em string, nas duas direções, ambas decididas como direção segura.
5. **Case-sensitivity VERIFICADA (probe 2026-08-11, curl 8.21.0)**: o
   MAX_TIME_RE NÃO tem flag i (`/--max-time\b/`) — `--MAX-TIME` e
   `--Max-Time` NÃO casam e over-flagam (direção segura, a mesma classe de
   custo do `-m`: um `--max-time` explícito). E o curl REJEITA a case-variante
   (opções longas são case-sensitive: `option --MAX-TIME: is unknown` →
   fail-loud exit 2, nunca um hang) — logo NÃO existe spelling que bound o
   total E escape o regex: o under-flag hipotético NÃO existe, só o over-flag
   já documentado. O CURL_INVOKE_RE segue o mesmo princípio (um `CURL`
   maiúsculo não é comando válido — falha na hora, sem risco de stall).
6. **A premissa do token por caminho está INVERTIDA (probe 2026-08-11)**: o
   pedido hipotetizava que `/usr/bin/curl` e `env curl` NÃO casariam o
   `\bcurl\b` — o probe mostrou que CASAM (a borda de palavra vale na `/`
   e no espaço): ambas as formas são COBERTO (FLAG sem --max-time, nunca
   um under-flag). O ESCAPE real está uma camada antes: o token QUOTADO
   (`"/usr/bin/curl"`, `"$(command -v curl)"`) — o maskBashStrings consome
   a string inteira e o token some do CURL_INVOKE_RE. É a classe irmã do
   eval (11.30) SEM o trigger `eval` (o tripwire 11.36 chaveia na palavra
   `eval`, então não a pega). Decisão: fronteira ACEITA — 0 usos quotados
   na superfície derivada (health-check.sh e test-security-headers.sh
   invocam curl bare, medido na varredura 2026-08-11); fechar custa
   parsing de posição de comando quotado (distinguir `"curl"` comando de
   `"via curl"` prosa), a mesma classe de custo que a 11.30 recusou. O
   contrafactual (o mesmo caminho SEM aspas → FLAG) pina que a decisão é
   deliberada, nunca um detector morto.

**VALE ADOTAR como contrato da matriz (não como mudança de detector)**: a
superfície medida vira um teste de tabela (19 formas × resultado esperado)
que trava a superfície atual contra regressão E contra um futuro
"conserto" do `-m` sem re-medição. O header do guard ganha o bloco FORMAS
DE INVOCAÇÃO documentando a fronteira no próprio detector.

**Implementação** (2 arquivos):
- `scan-curl-timeouts.test.ts` (28 → 29 testes): 1 PURE com a matriz de 19
  formas via `writeSyntheticRoot` + `scanGateScript` (cada linha com label
  para o failure message nomear a forma que quebrou; as 2 linhas
  case-variantes — `--MAX-TIME`/`--Max-Time` → FLAG — foram adicionadas em
  2026-08-11, pinando a case-sensitivity do MAX_TIME_RE na mesma matriz;
  as 4 linhas do token-surface — caminho absoluto/env COBERTO + token
  quotado ESCAPE ACEITO — em 2026-08-11) + 1 PURE de contrafactual do
  token quotado (mesmo caminho sem aspas → FLAG).
- `scan-curl-timeouts.mjs`: header ganha o bloco FORMAS DE INVOCAÇÃO
  (superfície medida, decisão do connect-timeout, chokepoint do wrapper).

**Fronteira travada**: a decisão do `--connect-timeout` sozinho (FAIL) agora
é contrato — quem tentar "relaxar" o guard para aceitar connect-timeout
como bound único quebra a linha da matriz com o label exato; quem quiser
reconhecer `-m` precisa re-medir e editar a matriz conscientemente.

**PROVADO VIVO (Prova 27, sec 8.22, run 31487497462)**: a decisão agora
foi observada no pipeline real — `curl --connect-timeout 10` sem
`--max-time` no `scripts/health-check.sh:57` REAL falhou o step
`Scan gate-script curls for explicit timeouts` com `CURL WITHOUT --max-time
in scripts/health-check.sh:57` → exit 1, com **0 linhas `EVAL CURL`** (o
tripwire não tripou — é a decisão da matriz, não o early-warning).

**Re-validação**: `scan-curl-timeouts.test.ts` (29) + `scan-timeouts.test.ts`
(BASELINE) — verdes; `gates-proofs-ordering.test.ts` valida a monotonia da
nova seção 11.31 (11.30 antes, 12 depois); tsc 0; eslint 0 erros; UTF-8 do
doc OK.

## 11.32 Regra 10 do scan-guard-gates — os 3 scanner steps `--ci` nos DOIS lados da rede (decisão 2026-08-11)

**O pedido**: o scan-guard-gates pinava os jobs/steps de gate do push net,
mas NÃO os steps dos scanners `--ci` — remover o `scan-curl-timeouts --ci`
do guard-gates.yml mudaria o push net sem o guard travar (a mesma classe de
órfão das regras 1-9). A proposta citava 2 steps (curl-timeouts + eol-anchor).

**A descoberta que expandiu o escopo de 2 para 3**: a classe tem TRÊS
membros. O `scan-timeouts --ci` vive nos MESMOS 2 workflows do net
(guard-gates.yml + o job fragile-guard do pr-check.yml), é a MESMA classe de
step scanner standalone e NÃO era pinado por nenhum guard (o grep só achou
referências em comentários de doc). Fechar só 2 de 3 deixaria um furo
visível — a regra 10 exige os 3, com cada step-key single-valued em net
order (o mirror exato do `missingStep` da regra 3: o PRIMEIRO workflow
existente sem o step reporta, nunca os dois).

**Os sinais** (com o caminho exato, ancorados no `run:` key — comentários em
prosa não tripam):

- `SCAN TIMEOUTS STEP MISSING in <workflow>` — `run: node
  scripts/scan-timeouts.mjs --ci`
- `CURL TIMEOUTS STEP MISSING in <workflow>` — `run: node
  scripts/scan-curl-timeouts.mjs --ci`
- `EOL ANCHOR STEP MISSING in <workflow>` — `run: node
  scripts/scan-eol-anchor.mjs --ci`

**O modelo de exclusividade (sec 8.14/11.31, guard-gates-exclusivity.test.ts)**:
os 6 sinais de scanner (3 keys × 2 targets) acoplam ao modelo principal
APENAS pelos pares WORKFLOW MISSING e pela seleção single-valued por
step-key — nenhum outro cross pair é exclusivo (um arquivo pode ter paths
filter E faltar o step curl; o twin pode faltar o job fuzz E o step eol;
encoding vive em outros arquivos). Por isso o mini-modelo de 256 estados
(2×2×8×8: push/twin existência × masks 3-bit dos steps) roda como partição
SEPARADA cujo conjunto exclusivo UNION no `derive()` — modelar 6 booleans
no Dims principal multiplicaria o espaço de 112k em ~64× para zero info de
exclusividade. A partição é exata porque todo cross pair coexiste; os 9
pares exclusivos novos (3 keys × {K@push bot K@twin, WORKFLOW MISSING@push
bot K@push, WORKFLOW MISSING@twin bot K@twin}) vivem dentro do universo do
mini-modelo. SNAPSHOT regenerado: 45 → **54 pares**.

**Fixtures** (golden-copy-utils.ts): `GUARD_PUSH_BASE` e `PR_JOB_FRAGILE`
ganham os 3 scanner steps (canonical SUBSET dos workflows reais — o drift
contract da 11.25 continua verde); o pin `:10` do PATHS FILTER vira `:16`
(a base cresceu de 9 para 15 linhas); `step:false` passa a mirar o step
test:guard POR ÍNDICE (findIndex), não pelo tail — os scanners ficam
depois dele; novas opções `omitScanners`/`omitScanner` cobrem as shapes da
regra 10. Mutações: curl missing (só o curl some), all-3 (os 3 sinais
juntos), twin eol (single-valued pega o twin), prose (comentário não
tripa).

**Re-validação**: vitest 5 suítes (scan-guard-gates, guard-gates-
exclusivity com novo SNAPSHOT 54, golden-copy-utils, run-precommit-guards)
+ BASELINE scan-timeouts = 109/109 — verdes; ordering 11.31 → 11.32 → 12;
UTF-8 dos arquivos OK; tsc 0; eslint 0 erros; reviewer 0 blockers.

## 11.33 Regra 11 do scan-guard-gates — DANGLING NEEDS (o grafo needs: do net, decisão 2026-08-11)

**A classe** (observada ao vivo na Prova 24, sec 8.19): deletar um job de
um workflow do net (ex.: utf8-check do ci.yml) sem remover as referências
`needs:` que o citam (build/budget) faz o GitHub **rejeitar o workflow no
parse** — o run nasce `failure` com **0 jobs**, NENHUM contrato roda, e o
net fica órfão silencioso. A Prova 24 provou o fenômeno ao vivo (CI/CD
failure com 0 jobs); faltava o guard que inspeciona o grafo needs: — a
classe que este guard (scan-guard-gates) não cobria.

**A regra 11** (positivo + negativo): sobre a superfície do net (a união
guardNet + encodingNet — os arquivos que este guard já lê, deduped), TODA
referência `needs:` de qualquer job precisa resolver para um job declarado
no MESMO workflow. O parser `danglingNeedsIn` reconhece as 3 formas YAML
de needs (inline `needs: [a, b]` — a forma do ci.yml hoje —, single
`needs: a` e o bloco `needs:` + `- a`), pula comentários (uma menção em
prosa de needs: não pode dar falso-positivo) e reporta TODA referência
pendurada com `{ job, ref, line }` — **multi-valued**, o padrão da Prova
22. Cada ref pendurada emite um sinal `DANGLING NEEDS` com o caminho
exato: `guard-gates: DANGLING NEEDS in <file>:<line> (job <job>: needs
<ref> nao existe no workflow - um needs: pendurado INVALIDA o workflow no
parse do GitHub (0 jobs), a classe observada na Prova 24/sec 8.19)`.

**Co-emissão honesta** (header do guard): quando o workflow de encoding
está ausente do net, o encoding dispara ENCODING CALL SITE MISSING E
DANGLING NEEDS JUNTOS — os dois sinais coexistem no mesmo scan (são
independentes, não exclusivos); a matriz de exclusividade só deriva os
pares que NÃO podem coexistir.

**O modelo de exclusividade** (guard-gates-exclusivity.test.ts): a regra
11 segue o padrão da regra 10/sec 11.32 — uma **mini-partição SEPARADA de
64 estados** (2 workflows × 2 existências × 4 masks de needs por workflow)
cujo conjunto exclusivo UNION no `derive()`, em vez de crescer o Dims
principal (modelar needs no modelo de 112k multiplicaria o espaço por
arquivo). A partição é exata: os únicos acoplamentos exclusivos são os 2
pares WORKFLOW MISSING + o par same-key ci/pr (DANGLING@ci × DANGLING@pr)
— todo o resto coexiste. **3 pares exclusivos novos**; SNAPSHOT regenerado
da derivação real: 54 → **57 pares** (nunca por mão); sanity 30 → 33
sinais.

**Fixtures e testes** (scan-guard-gates.test.ts): mutações — dangling
single no ci.yml (uma ref), dangling multi (duas refs em jobs diferentes),
dangling no pr-check (o twin), comment prose (menção em comentário NÃO
tripa) e o VALID needs graph clean (needs: resolvendo para job real NÃO
tripa — o positivo). REAL-REPO CONTRACT estendido: o grafo needs: real do
repo resolve (0 penduradas) — um job removido sem limpar as refs quebra o
contrato no CI antes do merge.

**Prova viva (2026-08-11, run 31488081528 — INCONCLUSIVA)**: o ciclo
`--only-jobs check --expect failure --expect-log 'DANGLING NEEDS'`com a mutação no ci.yml rodou, mas `DANGLING NEEDS` = 0 no log — o scratch
branch nasce de HEAD, e a regra 11 vive só no delta (0 no HEAD vs 6 no
working tree): o CI executou o scanner SEM a regra. A prova vira válida
DEPOIS do commit do delta (ver sec 8.23).

**Extensão repo-wide (2026-08-11)**: a superfície da regra 11 foi
ampliada do net (guardNet + encodingNet = guard-gates.yml + pr-check.yml
+ ci.yml) para **TODOS os workflows de `.github/workflows/`** — a classe
do órfão silencioso é workflow-agnóstica: um `needs:` pendurado num
deploy.yml mataria o deploy no parse do GitHub com 0 jobs, a MESMA classe
da Prova 24 mas fora da rede. Medição antes de adotar (probe real com
`danglingNeedsIn` sobre os 18 workflows): **18 workflows, 5 carregam
`needs:` REAL (guard-gates.yml e health-check.yml citam `needs:` só em
comentário — o count-pin usa o regex `^\s*needs:` que os ignora por
design; 4 fora do net: benchmark-auto-baseline, deploy, e2e-cache,
release-deploy), 0 dangling hoje** — a extensão é um forward lock
repo-wide com superfície limpa. A superfície é **derivada por
listagem do diretório** (self-maintaining: um workflow NOVO entra na
cobertura sem editar o manifest — o net exigiria editar GUARD_NET a cada
workflow novo; `.yml` e `.yaml` ambos cobertos). Custo: zero lógica nova
(`danglingNeedsIn` já era pura e exportada; a iteração mudou de 3 para 18
arquivos). O contrato: mutation novo (deploy.yml fora do net -> DANGLING
NEEDS) + REAL-REPO CONTRACT com count-pin (18 workflows, 5 com needs:
real, 0 dangling) — o CLI exit 0 agora cobre os 18.

**Re-validação**: vitest 124/124 (5 suítes: scan-guard-gates com o
mutation novo repo-wide, guard-gates-exclusivity com novo SNAPSHOT 57,
golden-copy-utils, run-precommit-guards + BASELINE scan-timeouts) +
ordering guard 7/7 (11.32 → 11.33 → 12); UTF-8 OK; tsc 0; eslint 0
erros (a classe de warnings no-console do main do guard, exit 0);
reviewer 0 blockers (2 rodadas: nit do `.yaml` aplicado — o filtro da
superfície agora cobre `.yml` e `.yaml` — e o count-pin corrigido para o
número honesto 5/4: guard-gates.yml e health-check.yml citam `needs:` só
em comentário).

## 11.34 O ci.yml ganha a família de fixtures compartilhada (writeCIWorkflow + CI_JOB_BLOCKS, decisão 2026-08-11)

**A regra dos usos aplicada ao ci.yml**: o ci.yml sintético (o caller do
merge path, a âncora das regras 8/11 do scan-guard-gates) estava inline
em TRÊS suítes com DUAS shapes repetidas: scan-guard-gates.test.ts (a
local `writeCIWorkflow`, ~30 call sites, call site utf8-check SEMPRE na
base) e guard-gates-exclusivity.test.ts (a local `writeCi`, 6 call sites,
utf8-check OPT-IN via `{ enc: true }`) — mais a inline inerte de
run-precommit-guards.test.ts (`writeBadGuardNet`, que a sec 11.26 deixou
como "a única variante que fica inline" por decisão de fronteira). Duas
shapes repetidas cruzaram o threshold da regra dos usos — a mesma
fronteira que extraiu writePRWorkflow (11.25) e writeGuardGatesWorkflow
(11.26).

**O que mudou** (4 arquivos + docs):

1. **`golden-copy-utils.ts`** — `CI_HEADER` + `CI_JOB_BLOCKS` (record
   exportado: `lint` + `utf8-check`, as 2 jobs da base compartilhada — o
   lint é filler cosmético, o utf8-check é a âncora do call site) +
   `writeCIWorkflow(dir, opts)` exportado: `enc` (default true — a shape
   do scan-guard-gates; as 6 call sites do exclusivity TODAS passam
   `{ enc: true }`, então o default mergeado é byte-identical para todo
   consumidor atual) + `extra` (o padrão re-entry append das mutações
   de prosa).
2. **`scan-guard-gates.test.ts`** — a local `writeCIWorkflow` morre; os ~30
   call sites importam a compartilhada; os 2 call sites com `extra` viram
   `writeCIWorkflow(dir, { extra: "..." })`.
3. **`guard-gates-exclusivity.test.ts`** — a local `writeCi` morre; os 6
   call sites viram `writeCIWorkflow(dir)` (default enc=true ≡ o antigo
   `{ enc: true }`).
4. **`run-precommit-guards.test.ts`** — a inline da sec 11.26 morre: o
   `writeBadGuardNet` usa `writeCIWorkflow(dir)`. O lint job novo não
   introduz sinal (o guard só ancora o call site utf8-check + o grafo
   needs: — ambos limpos), então o pin sole-failure do teste (a ÚNICA
   violação é o TEST GUARD STEP MISSING do push net) é preservado. A
   decisão de fronteira da 11.26 é SUPERADA: o ci.yml não é mais a
   "única variante inline" — a família CI agora é compartilhada como as
   outras duas.
5. **`golden-copy-utils.test.ts`** — o drift contract da sec 11.25 cresce
   com a família CI: REAL (todo bloco de CI_JOB_BLOCKS é SUBSET canônico
   do seu job no ci.yml real), SHAPE PIN (a família cobre EXATAMENTE as 2
   jobs da base compartilhada — lint filler + utf8-check âncora; uma 3ª
   job deve crescer o record + o pin) e 3 MUTATIONs (step renomeado, job
   key renomeado fail-loud, uses: alterado — o call site âncora).

**Fronteira honesta** (a mesma da 11.25): variantes single-use ficam
inline pela regra — as mutações da regra 11 que reescrevem o ci.yml
inteiro (dangling needs, call site missing) e as mutações needs:/step da
regra 8 mantêm seus writeFile completos (cada uma é uma shape sole-
failure que não repete a base).

**Re-validação**: vitest **123/123** (5 suítes: scan-guard-gates,
guard-gates-exclusivity, golden-copy-utils, run-precommit-guards +
BASELINE scan-timeouts) — verdes; ordering 11.33 → 11.34 → 12; UTF-8 OK
em todos os 6 arquivos tocados; tsc 0; eslint 0 erros; reviewer 0
blockers (3 micro-nits de precisão aplicados e confirmados).

## 11.35 O ci-proof-run ganha o modo --expect-parse-reject (a classe Prova 24/sec 8.19 automatizada, decisão 2026-08-11)

**A classe** (observada ao vivo na Prova 24, sec 8.19, e na Prova 18): um
workflow **rejeitado no parse** pelo GitHub — o run nasce `failure` com
**0 jobs** e **SEM log** ("This run likely failed because of a workflow
file issue"; nenhum job chega a rodar, então `gh run view --log` não
tem nada para devolver). O ci-proof-run tratava esse desfecho como
qualquer outro failure — sem saber que 0 jobs + sem log É o resultado
esperado da classe (e não uma falha de infra).

**A flag `--expect-parse-reject`** (2026-08-11): define o resultado
esperado POR INTEIRO — o verify dedicado `verifyParseReject(conclusion,
jobsCount)` pina `conclusion=failure` E `jobsCount=0`. O log vazio é
CONSEQUÊNCIA de 0 jobs (nenhum job rodou) — o sinal verificável é a
contagem de jobs, não uma linha de log — então o modo consulta os jobs do
run (`gh run view <id> --json jobs`) e NÃO casa regex de log (não há log
para casar).

**Exclusividades** (parseArgs, fail-loud antes de qualquer spawn):
incompatível com `--expect` (a conclusão é fixa), com `--expect-log` (0
jobs = nenhum job rodou = sem log para casar) e com `--only-jobs` (0
jobs = não há job alvo para o poll por job — o run inteiro é o sinal).

**O fluxo com a flag**: o ciclo roda igual (branch scratch → mutação →
push → dispatch → poll até completed) e, no verify, o modo consulta os
jobs e pina a contagem. Um run que complete failure MAS com jobs (o
workflow NÃO foi rejeitado) falha com `jobs=N != 0 esperado` — a prova
da classe exige a ausência TOTAL de jobs, não só o failure.

**Re-validação**: vitest **80/80** (2 suítes: ci-proof-run com a nova
matriz pure + 3 E2Es parse-reject + o REAL-REPO CONTRACT do wiring, +
BASELINE scan-timeouts) — verdes; ordering 11.34 → 11.35 → 12; UTF-8 OK
nos 2 arquivos; tsc 0; eslint 0 erros; reviewer 0 blockers (2 micro-nits
de precisão — o count concreto e o query de jobs falho distinto do "0
observado" — aplicados e confirmados).

## 11.36 O tripwire `eval`+`curl` — o early-warning da fronteira 11.30 (decisão 2026-08-11)

**A pergunta**: a 11.30 decidiu ACEITAR o falso-negativo do `eval`
(`CMD="curl ..."; eval "$CMD"` — o token curl vive DENTRO da string, o
maskBashStrings o consome, o detector --max-time não o vê) porque fechar
custaria rastreamento de variáveis para uma forma com 0 usos na superfície
(medido: os 6 gate scripts derivados não têm NENHUM eval). Mas a fronteira
decidida não pode virar um buraco silencioso: SE um dia o repo usar a forma
de verdade, ninguém seria avisado — o escape entraria sem ruído.

**A decisão**: VALE ADOTAR um tripwire BARATO e ORTOGONAL ao detector — um
grep ASCII por `eval` + `curl` na MESMA linha lógica (continuações `\`
unidas, o mesmo joinContinuations do detector) dos gate scripts, que FALHA
(exit 1) com aviso quando a forma aparecer. O detector --max-time NÃO é
fechado (o scanGateScript segue retornando `[]` para o token mascarado — o
falso-negativo aceito da 11.30 permanece pinado no MESMO suite); o tripwire
é uma checagem SEPARADA (scanEvalCurl) que convive com ele e emite o sinal
`EVAL CURL (sec 11.30)` com o file:line exato — forçando a decisão humana
(refatorar para invocação direta com --max-time OU documentar formalmente)
em vez de um pass silencioso.

**Por que fail-loud (exit 1) e não warn-only**: um step de CI que passa
imprimindo um aviso é invisível (verde não se lê); o tripwire falha para
que ALGUÉM seja avisado — o objetivo explícito do early-warning.

**Fronteiras (barato POR DESIGN, nomeadas)**: form-based (um --max-time
DENTRO da string eval'd ainda trip — o conteúdo mascarado não é verificável
estaticamente, o aviso é sobre a FORMA, não sobre a flag); mesma linha
lógica apenas (a forma dividida em duas linhas SEM continuação — `CMD=...`
numa linha, `eval "$CMD"` noutra — NÃO trip: fechar custa rastreamento de
variáveis, o MESMO custo que a 11.30 recusou; a residual fica nomeada);
linhas de comentário excluídas (a regra barata do detector); SEM masking (o
masking mataria o próprio sinal — o token vive na string); prosa em
strings mencionando os dois tokens over-flags (direção segura, o mesmo
custo do detector).

**A residual do split-form — contrato ACEITO (padrão 11.30)**: a forma
dividida em duas linhas físicas SEM continuação (`CMD="curl ..."` numa
linha, `eval "$CMD"` noutra) NÃO tripa — decisão ACEITA, o MESMO custo que
a 11.30 recusou (rastreamento de variáveis para uma forma com 0 usos na
superfície derivada, medido). A fronteira é pinada como contrato
bidirecional no padrão da 11.30 (o teste TRIPWIRE boundary, um it com os
DOIS lados): o split NÃO tripa (`[]`) E o contrafactual — a MESMA forma
numa única linha lógica — TRIPA (`len 1`, linha 2) — provando que a
fronteira é a LINHA, nunca um detector morto que passaria vazio nos dois
lados. Quem tentar "fechar" o split precisa re-medir o custo do
rastreamento e editar o contrato conscientemente. Re-validação: `npx vitest
run scripts/__tests__/scan-curl-timeouts.test.ts --config
vitest.config.unit.ts`.

**O terceiro caso — a continuação `\` (sondado 2026-08-11, probe real)**:
a fronteira tem TRÊS formas físicas, não duas. `CMD="curl ..." \`
(backslash no fim da linha) + `eval "$CMD"` na linha seguinte NÃO é a
residual — o joinContinuations (o MESMO helper que o detector usa para a
forma TLS-check) dobra o par numa ÚNICA linha lógica, e o tripwire TRIPA na
linha INICIAL do comando lógico (probe `node --input-type=module -e ...`
num fixture `CMD=... \`/`eval "$CMD"`: `scanEvalCurl` → `[{line:3,
text:"CMD=...\\neval \"$CMD\""}]`; o scanner da residual retorna `[]` — a
continuação é território do tripwire POR DESIGN, documentado no header do
scanSplitEvalCurl). A matriz INVOCATION-FORM (sec 11.31) é do DETECTOR
(scanGateScript, token+flag) — a continuação não pertence lá: ela é
invisível ao detector (o token mascarado, a fronteira 11.30) e visível ao
tripwire. DECISÃO: a forma JÁ está pinada por teste commitado (`TRIPWIRE
continuation: the form split by a backslash continuation is ONE logical
line -> trips at the START line` — o par irmão do TRIPWIRE boundary, que
asserta len 1 na linha inicial) — NÃO ganha linha nova na matriz (casa
errada: matriz = detector, não tripwire) nem entrada FRONTIERS (não é
escape: TRIPA, não passa silencioso). O que faltava era a doc nomear o
tri-caso explicitamente para o leitor não re-derivar: (1) linha única →
TRIPA (Prova 29, sec 8.24); (2) continuação `\` → dobra e TRIPA na linha
inicial (este probe; o mesmo caso da linha única na visão do
joinContinuations); (3) split SEM continuação → residual ACEITA, NÃO tripa
(Prova 30, sec 8.25; 0 usos, BASELINE companion). O teste `TRIPWIRE
continuation` pina o caso (2) e o par boundary + continuation fecha a
tabela: o que separa a residual do tripwire é a linha LÓGICA — continuar
com `\` é juntar, é o tripwire; quebrar sem `\` é separar, é a residual.

**O tri-caso pinado como comportamento (o padrão da matriz aplicado ao
tripwire)**: a tabela acima vivia em prosa + testes separados (TRIPWIRE
boundary + TRIPWIRE continuation). Agora existe um ÚNICO `it`
parametrizado no padrão da matriz INVOCATION-FORM (sec 11.31) aplicado ao
scanEvalCurl: cada forma física é uma linha da tabela com o trip esperado
+ a linha exata — linha única → trip na 3; continuação `\` → trip na
linha INICIAL (3); split sem continuação → `[]` (0). O par de Provas vivas
29/30/31 (o tri-caso observado no CI) tem o espelho hermético numa única
tabela de comportamento — quem refatorar o tripwire quebra a tabela
inteira de uma vez, não um caso por vez.

**O pin do HELPER (JOIN-CONTINUATIONS CONTRACT)**: o caso (2) da tabela só
tripa porque o joinContinuations dobra o par numa linha lógica — a
decisão inteira cavalga na integridade do helper. Um refactor que
produzisse linha lógica truncada (empurrar o buffer na continuação ou
dropar o par) faria o tripwire errar o caso (2) SILENCIOSAMENTE, com o
fixture do tri-caso (uma continuação que por acaso junta certo) seguindo
verde. O JOIN-CONTINUATIONS CONTRACT (it dedicado na suíte do guard, probe
2026-08-11) pina a invariante de losslessness direto no helper,
independente de fixture: (1) nenhuma linha lógica termina em `\` (nenhuma
continuação fica truncada); (2) o flatten das linhas lógicas (o `\` é
marcador de JOIN, não conteúdo) reconstrói o input byte a byte — o
conteúdo de toda linha de continuação sobrevive em exatamente uma linha
lógica. O probe também revelou um fato honesto do helper que o teste
pina: a linha VAZIA entre pares é preservada como linha lógica própria
(LOGICAL_COUNT=4 num fixture de 2 pares + echo), nunca engolida pelo par.

**A prova viva da truncagem (probe 2026-08-11) — a rede viva é o BASELINE
do DETECTOR, não o tripwire**: o JOIN-CONTINUATIONS CONTRACT pina a
losslessness hermeticamente, mas a pergunta honesta era: se um refactor
truncar o join (empurrar o buffer na continuação ou dropar o par), o
BASELINE vivo detecta, ou o repo real não tem pares de continuação e o
scan seguiria verde? O probe INVERTEU a premissa do medo: o repo real TEM
par de continuação — o TLS-check do test-security-headers.sh:325
(`curl ... --tls-max 1.3 \` com o `--max-time 20` na linha de continuação
326). Com o join real, a linha lógica co-loca curl + flag (BASELINE do
detector verde — o lock da classe 9:08); com join TRUNCADO (cada linha
física vira sua própria linha lógica), o curl da linha 325 perde o
--max-time e o DETECTOR flagra: violations 0 → 1 em
`scripts/test-security-headers.sh:325` — o TRIPWIRE segue em 0 (a classe
da truncagem não é eval, o tripwire só vê formas eval+curl). DECISÃO: o
contrato NÃO precisa de um caminho CI próprio — a rede viva da truncagem
JÁ existe no BASELINE do detector (o step `scan-curl-timeouts --ci` dos
dois workflows): se a truncagem acontecer de verdade, o CI falha com o
path:line exato, sem depender do teste hermético. O CONTRACT hermético é
o pin DIRETO da invariante (falha no commit local, antes do push); o
REAL-REPO CONTRACT novo (probe 2026-08-11) pina a PREMISSA dessa rede
viva — o par TLS-check com a flag em linha de continuação existe na
superfície derivada — para um refactor legítimo que mova o --max-time
para a linha física do curl (matando a rede viva) quebrar o teste e
exigir re-decisão, em vez de a rede morrer silenciosamente.

**O pin do baseLine (probe 2026-08-11) — a linha INICIAL do comando
lógico é o número que o path:line das provas depende**: os três
consumidores do joinContinuations (scanEvalCurl, scanGateScript e o
REAL-REPO CONTRACT do health-check.sh) reportam a linha INICIAL da linha
lógica — o número que o path:line das Provas 29/31/34 carrega
(health-check.sh:58 era a linha do CMD, não a do eval). O JOIN-
CONTINUATIONS CONTRACT pina a losslessness do helper; o BASELINE com 2+
continuações pina a CONTAGEM do baseLine — e o TRI-CASO (caso 2, 1
continuação) NÃO consegue distinguir a contagem correta
(`baseLine += logical.split("\n").length`) de um bug `+=1` por linha
lógica: um único par reporta a mesma linha nas duas contagens. O
DISTINGUISHER (probe 2026-08-11, fixture medido): um par de continuação
ANTERIOR (`FOO="bar" \` + `baz` = 2 linhas físicas) desloca a contagem —
com a contagem correta o par eval+curl (2 continuações, linhas físicas
5-7) reporta a linha INICIAL 5; o bug `+=1` reportaria 4 (só 3 linhas
lógicas antes dele); o bug fim-do-par reportaria 7. O teste pina os DOIS
scanners (tripwire e detector reportam 5) + o positivo (TLS-form com a
flag numa linha de continuação do MEIO do par co-loca na linha lógica e
o BASELINE segue verde — a mesma co-locação do health-check.sh real).
DECISÃO: o teste é o pin da contagem que o path:line das provas depende
— um refactor que mudasse a aritmética do baseLine quebraria o teste com
o número errado, em vez de as provas apontarem para a linha errada no
futuro.

**O BASELINE companion da residual (REAL-REPO CONTRACT)**: o tripwire cobre
a forma de linha única; o scanner da residual (`scanSplitEvalCurl`,
EVIDÊNCIA DE TESTE apenas — NÃO wired no CLI, o guard continua aceitando a
forma por decisão) procura a FORMA DIVIDIDA (atribuição `VAR=...curl...`
numa linha + `eval "$VAR"` numa linha posterior, sem continuação) e pina o
lado "0 usos na superfície derivada": o REAL-REPO CONTRACT deriva os 6
gate scripts dos workflows e asserta `[]` — se a forma aparecer, quebra
com o path:line exato (forçando a decisão humana, nunca um furo
silencioso). A separação de domínio é o contrato: o split pertence ao
scanSplitEvalCurl (linha do eval), a forma de linha única pertence ao
tripwire scanEvalCurl — cada scanner um lado da fronteira, nunca os dois
no mesmo furo (pinned por mutation com os DOIS lados no mesmo it).

**A SPLIT-FORM MATRIX (a tabela irmã hermética da residual)**: o tri-caso
da 11.36 (linha única → trip, continuação → trip na linha inicial, split →
[]) virou um `it` parametrizado único para o TRIPWIRE; o scanner da
residual ganhou o ESPELHO — um `it` parametrizado irmão (SPLIT-FORM
MATRIX, probe 2026-08-11, 14 formas medidas) que pina as formas que o
scanSplitEvalCurl DEVE flagrar (var curl em linha anterior + eval em linha
posterior sem continuação → flag na linha do eval) e as que NÃO deve
(linha única, continuação, var sem curl, eval antes da atribuição,
comentário, eval com continuação → todos []). Destaques medidos: a var
REATRIBUIDA sem curl ainda flagra (over-flag direção segura — o scanner
não rastreia dataflow, a reatribuição não limpa o registo); duas vars curl
num eval → UM warning por var que casa; var evaldada duas vezes → UM
warning por linha de eval. A fronteira de domínio é o espelho do tri-caso:
continuação (joinContinuations dobra → tripwire) e mesma linha (guard
i+1 <= assignLine) pertencem ao TRIPWIRE, nunca à residual — cada scanner
um lado, nunca os dois no mesmo furo (o mesmo contrato do BASELINE
companion acima, agora com a superfície de FORMAS medida em vez de só o
positivo/negativo).

**O contrafactual embutido**: o teste ACCEPTED da 11.30 (scanGateScript
`[]` no eval-built curl, com o contrafactual do curl direto flagado)
permanece no MESMO suite — o par detector-aberto + tripwire-trip prova que
a decisão é deliberada, nunca um detector morto que passaria vazio nos dois
lados.

**Implementação** (`scan-curl-timeouts.mjs` + teste, 20 → 28 testes):
scanEvalCurl exportado (pure, espelha o scanGateScript: joinContinuations +
exclusão de comentário, SEM masking) + `evalWarnings` no retorno do
scanCurlTimeouts + seção EVAL CURL no CLI — violations e tripwire convivem
no MESMO exit 1, cada um com sua seção e file:line (agregação, o padrão da
Prova 22). ZERO mudança de wiring: o scanner já é step standalone `--ci` no
guard-gates.yml e no pr-check.yml — sem step novo, o mini-modelo da regra
10/sec 11.32 (os 3 scanner steps versionados) fica intacto.

**Re-validação**: vitest **58/58** (3 suítes: scan-curl-timeouts com a nova
matriz TRIPWIRE — 6 PURE + BASELINE + 2 CLI — + BASELINE scan-timeouts +
gates-proofs-ordering) — verdes; ordering 11.35 → 11.36 → 12; UTF-8 OK no
doc + ASCII-OK no gate file (o .mjs é gate); tsc 0; eslint 0 erros (exit
0, warnings tolerados); reviewer 0 blockers (3 nits de precisão do doc —
o typo "es taticamente", a Re-validação escrita antes da rodada e a
contagem 19→28 quando a base era 20 — aplicados e confirmados).

**Provas vivas do tripwire (o par nos DOIS lados da rede)**: o fail-loud da
FORMA `eval`+`curl` está observado no pipeline real em ambos os jobs que
rodam `scan-curl-timeouts --ci` — **Prova 26** (sec 8.21, run
31485163704): lado PUSH NET (guard-gates.yml, job `Guard Gates`);
**Prova 29** (sec 8.24, run 31492035257): lado PR (pr-check.yml, job
`Fragile Range Guard`, `EVAL CURL (sec 11.30) in scripts/health-check.sh:58`
→ exit 1, 0 linhas `CURL WITHOUT`). Quem ler esta decisão vê o mecanismo;
quem ler as duas provas vê o par fechado.

## 11.37 Por que o tripwire `eval` é exclusivo do curl-timeouts — a classe nas suítes irmãs (decisão 2026-08-11)

**A pergunta**: o scan-curl-timeouts mascara strings e chaveia no token `curl`
— o MESMO padrão masking+fronteira existe no scan-timeouts (codeMask) e no
scan-eol-anchor (maskComments). A classe "token escondido em string avaliada
depois" (`CMD="curl ..."; eval "$CMD"`, o tripwire da 11.36) merece um
teste de contrato irmão nessas suítes, ou a fronteira é exclusiva do
curl-timeouts?

**O achado (medição antes de decidir, probes 2026-08-11 sobre as funções
puras reais — não conjectura)**:

1. **scan-timeouts (JS test files)** — a classe ESCAPA estruturalmente:
   `eval('execSync("...")')` e `const c = 'spawnSync("x")'; eval(c)` →
   subprocessHeavy=false (o token morre no codeMask); o contrafactual
direto → true (o detector funciona). MAS o idioma real de JS test code é
parameterizar ARGS, nunca o NOME da API: `const cmd = 'node x.mjs';
execSync(cmd)` → subprocessHeavy=true (o token fica literal fora da
string, detectado). O análogo plausível da construção dinâmica
(interpolação de template literal `${...}`) é fronteira NOMEADA no header
do guard (mascarada inteira; "nenhum teste do repo faz isso") — e agora
PINADA por contrato (o teste INTERPOLATION-FRONTIER, scan-timeouts.test.ts
agora com 24 it() blocks — a nova no describe de parser, padrão
11.29/11.30: o token DENTRO de `${...}` escapa → ACEITO,
o contrafactual do MESMO token direto flagra → o detector funciona, e o
idioma real de args-interpolação (token fora do template) é detectado →
os dois eixos da decisão provados num único teste). O regression
dispatchWarning (scan-timeouts.test.ts:201) segue pinando a classe
VIZINHA do vazamento de span do matchBrace em helper puro — uma classe
separada, agora com pin próprio além do vizinho. Fechar o eval custaria
rastreamento de variáveis — o MESMO custo que a 11.30 recusou — para uma
forma com 0 usos E 0 plausibilidade acidental.
2. **scan-eol-anchor (JS test/mutation files)** — a classe NEM ESCAPA na
forma comum: strings passam BYTE-IDENTICAL pelo maskComments (mascarar
strings mataria a própria detecção), então `eval('.replace("foo\nbar",
"")')` continua com o padrão de bytes visível → flagrado=true (probe). A
ÚNICA variante que escapa (aspas escapadas `\"` — o byte shape muda) é
EXATAMENTE a fronteira "aspa escapada" já documentada no header. Não há
classe nova para pinar — um teste irmão estaria assertando uma
não-fronteira.
3. **curl-timeouts (bash)** — o tripwire da 11.36 foi justificado porque
`CMD="curl ..."; eval "$CMD"` é IDIOMA real de bash: o comando INTEIRO,
incluindo o nome da ferramenta, vai para a variável — o uso acidental é
plausível. É o único dos três guards com esse perfil.

**A decisão**: VALE DOCUMENTAR, NÃO pinar irmãos. A fronteira é exclusiva
do curl-timeouts por DOIS eixos medidos: (a) plausibilidade do idioma —
bash constrói comandos inteiros em variáveis; JS test code nunca esconde o
NOME da API num eval (parameterizar args mantém o token literal e é
detectado); (b) visibilidade de bytes — o eol-anchor vê o padrão mesmo
dentro de eval (strings byte-identical); o único escape é a fronteira já
nomeada. Um teste de contrato irmão em qualquer das duas suítes pinaria uma
forma artificial (scan-timeouts) ou inexistente (scan-eol-anchor) — o
oposto da cultura de honestidade das provas.

**Recipe de re-validação (30s, os comandos EXATOS da medição — rodados e
validados 2026-08-11, sem re-derivar os casos)**: re-rodar os probes
baixa os mesmos resultados; se qualquer linha divergir, a fronteira
mudou e a decisão precisa ser re-aberta.

Probe 1 — scan-timeouts (a classe ESCAPA no eval; o idioma real é
detectado; esperado `false, false, true, true, true`):

```bash
node --input-type=module -e '
import { findTestCalls } from "./scripts/scan-timeouts.mjs"
const forms = {
  "eval(execSync string)": "it(\"x\", () => { eval(\"execSync(\\\\\"node x.mjs\\\\\" , {})\") })",
  "eval(var spawnSync)": "it(\"x\", () => { const c = \"spawnSync(\\\\\"x\\\\\")\"; eval(c) })",
  "direto (contrafactual)": "it(\"x\", () => { execSync(\"node x.mjs\") })",
  "arg param, token literal": "it(\"x\", () => { const cmd = \"node x.mjs\"; execSync(cmd) })",
  "interpolacao template": "it(\"x\", () => { execSync(`node ${file}.mjs`) })",
}
for (const [k, src] of Object.entries(forms)) {
  const calls = findTestCalls(src)
  console.log(k.padEnd(30), "subprocessHeavy=", calls[0]?.subprocessHeavy)
}
'
```

Probe 2 — scan-eol-anchor (a classe NEM escapa — bytes visíveis dentro
do eval; esperado `hits=1, hits=1, hits=0`):

```bash
node --input-type=module -e '
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { scanFileEolAnchor } from "./scripts/scan-eol-anchor.mjs"
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "eol-probe-"))
const esc = "\\" + "n"
const forms = {
  "eval(.replace) -> NAO escapa (bytes visiveis)": `eval('\''content.replace("foo${esc}bar", "")'\'')`,
  "direto -> FLAGRA": `content.replace("foo${esc}bar", "")`,
  "aspa escapada -> NAO flagra (fronteira do header)": `content.replace("foo\\\"${esc}bar", "")`,
}
for (const [k, src] of Object.entries(forms)) {
  const f = path.join(dir, "probe.ts")
  fs.writeFileSync(f, src + "\n", "utf8")
  console.log(k.padEnd(50), "hits=", scanFileEolAnchor(f).length)
}
fs.rmSync(dir, { recursive: true, force: true })
'
```

NOTA de método do probe 2: a sequência `\n` é montada por concatenação
(`esc = "\\" + "n"`) e interpolada via template literal — o escape de 2
chars nunca fica contíguo NO CÓDIGO do comando (o guard varre os gate
files; contíguo = auto-flag no próprio script de probe, a mesma NOTA da
suíte).

NOTA de leitura do probe 1 (evita um falso conflito com a prosa): a linha
`interpolacao template → true` mede a interpolação de ARGS com o token
LITERAL fora do template — `execSync` + template com `${file}` como
argumento — o idioma real, detectado. A fronteira "mascarada inteira" da
prosa é o token DENTRO de `${...}` (nenhum teste do repo faz isso) —
casos diferentes; os dois são consistentes com a decisão.

**ACHADO incidental — FECHADO (2026-08-11, fix implementado)**: o
scan-eol-anchor.mjs NÃO tinha entry-point guard — `process.exitCode =
main()` rodava no import (diferente do scan-timeouts.mjs, que tem IS_MAIN).
O probe flagrou o PRÓPRIO arquivo de probe ao importar o módulo (a
superfície real foi varrida e o exitCode do processo do probe foi setado).
FIX: o módulo ganhou o guard IS_MAIN (mirror do scan-timeouts.mjs —
`import.meta.url === pathToFileURL(process.argv[1]).href`), então importar
(o vitest unit de parsing) não varre a superfície nem seta exitCode; o CLI
só roda quando executado direto. O teste IMPORT (scan-eol-anchor.test.ts,
10ª it) prova com contrafactual embutido: superfície sintética ENVENENADA +
import dinâmico cache-busted → exitCode intacto + o módulo expõe as
funções puras, E chamar `scanEolAnchors()` explicitamente na MESMA
superfície acha a violação (o no-scan do import é o guard funcionando,
nunca um detector morto — o assert do exitCode pega a classe: sem o
guard, o main() rodaria e setaria exitCode 1 na superfície envenenada).

**Implementação original** (2 headers + docs, ZERO lógica — a avaliação
não mudou comportamento): scan-timeouts.mjs e scan-eol-anchor.mjs ganham
a nota da fronteira/não-fronteira do eval no header — o lugar onde as
decisões de fronteira vivem (o mesmo padrão da 11.29/11.30 no
curl-timeouts) — para o próximo dev não re-derivar a avaliação; a sec
11.37 registra os probes e o veredito.

**Implementação do fechamento do ACHADO** (1 gate file + 1 suite + docs,
LÓGICA mínima): scan-eol-anchor.mjs ganha o guard IS_MAIN (2 linhas +
import pathToFileURL) e o header nota o entry-point guard; o teste IMPORT
(10ª it da suite) prova o contrato com contrafactual embutido.

**Re-validação**: vitest **39/39** (3 suítes: scan-timeouts 23 +
scan-eol-anchor 9 + gates-proofs-ordering 7) — verdes; ordering 11.36 →
11.37 → 12; UTF-8 OK no doc + ASCII-OK nos 2 gate files (headers tocados);
tsc 0; eslint 0 erros; reviewer 0 blockers (2 nits de precisão — a
citação do dispatchWarning como pin da interpolação quando ele pina a
classe vizinha do matchBrace, e o count de gate files 3→2 — aplicados e
confirmados). **Pós-fechamento**: vitest **40/40** (scan-eol-anchor 10 com
a IMPORT + scan-timeouts 23 + ordering 7) — verdes; tsc 0; eslint 0 erros;
ASCII-OK no gate file (guard + header tocados); UTF-8 OK no doc; reviewer
0 blockers. **Pós-pin da interpolação**: vitest **41/41** (scan-timeouts 24
com a INTERPOLATION-FRONTIER + scan-eol-anchor 10 + ordering 7) — verdes;
tsc 0; eslint 0 erros; ASCII-OK no gate file (header tocado); UTF-8 OK no
doc; reviewer 0 blockers (nit de precisão — "24ª it" posicional → "24
it() blocks", a nova no describe de parser — aplicado e confirmado).

## 11.38 Por que cada detector mantém a matriz própria — a classe "só o literal canônico" é filosofia compartilhada, a MATRIZ é superfície-específica (decisão 2026-08-11)

**A pergunta**: o scan-curl-timeouts e o scan-timeouts agora compartilham a
mesma filosofia de masking+fronteira+matriz. A classe "só o literal
canônico é reconhecido, variantes over-flagam" merece um teste de forma
COMPARTILHADO entre as duas suítes (o guard dos guards), ou cada detector
mantém a matriz própria?

**A medição (probe 2026-08-11, o SUBPROCESS_RE real + as duas suítes)**: a
classe NÃO tem a mesma forma nos dois guards — ela difere em KIND, não em
grau:

| Eixo | scan-curl-timeouts (bash) | scan-timeouts (JS test) |
|---|---|---|
| O literal canônico | `curl` + `--max-time` (2 tokens) | 6 nomes de API (spawnSync/execSync/execFileSync/spawn/fork/runSubprocess) + 2 padrões (process.execPath/child_process) |
| As variantes | MESMA superfície de token, formas diferentes: `-m 20`, case-variante, wrapper DEF/CALL, alias, env, path absoluto, token quotado | NOME DIFERENTE (indireção): `runCli("x")` NÃO casa SUBPROCESS_RE — o token some atrás de OUTRO nome |
| Como a classe é pinada | matriz de 19 formas (tabela) | regressions LOCAL/IMPORTED HELPER + fixpoint heavyHelperNames (a análise de helper, não uma tabela de tokens) |
| Case-variante | `--MAX-TIME` é ERRO do curl (fail-loud, exit 2) | `SPAWNSYNC(` não é API real — ReferenceError loud, nunca hang silencioso |
| Medida da classe real | a superficie de FORMAS é rica (o bash constrói comandos por texto) | ~15 diretas vs ~159 via helper (a indireção é a classe dominante, medida no header) |

**Achados (por que a decisão é documentar, não pinar irmão)**:

1. **As variantes são classes ESTRUTURALMENTE diferentes, não formas da
   mesma classe**. No curl-timeouts, a variante é o MESMO token `curl`/
   `--max-time` escrito de outro jeito (curto, maiúsculo, em alias, com
   path, quotado) — uma matriz de formas é o pin natural. No scan-timeouts,
   a variante que importa é o token substituído por OUTRO NOME (`runCli`,
   `runSubprocess` importado) — isso não é uma "forma" do token, é
   indireção, e é pinada por um mecanismo COMPLETAMENTE diferente (a
   análise fixpoint de helpers, ~15 vs ~159 medidos). Uma matriz de formas
   no scan-timeouts estaria pinando a classe ERRADA (a case-variante
   `SPAWNSYNC(` não é API real — o próprio detector a ignora porque ela
   falha loud, nunca pendura).
2. **A filosofia compartilhada JÁ está pinada por suíte, separadamente**:
   masking (codeMask vs maskBashStrings), fronteira do eval (11.30 vs
   11.37), over-flag-safe como direção aceita, BASELINE + companion de
   superfície não-vazia, mutation CLI. Um teste compartilhado DUPLICARIA
   esses pins sem adicionar sinal — o padrão de teste irmão artificial que
   a 11.37 recusou (cada guard pina a própria classe no próprio formato).
3. **A matriz de 19 formas é exclusiva do curl-timeouts POR CONSTRUÇÃO**:
   o bash constrói comandos por TEXTO (flag curta, case, alias, env, path
   absoluto, quoting) — uma superfície de formas rica. A JS test surface
   não tem esse espaço de formas; a classe dela é a indireção. Forçar um
   teste de forma compartilhado seria pinar um formato artificial numa
   suíte onde a classe não existe nesse formato.

**VEREDITO**: DOCUMENTAR a exclusividade — a filosofia (masking +
fronteira + over-flag-safe + BASELINE) é compartilhada e pinada por suíte;
a MATRIZ é superfície-específica porque a classe de variantes difere em
KIND (mesmo-token-spelling no bash vs indireção na JS test surface).

**Implementação** (2 headers + docs, ZERO lógica): scan-timeouts.mjs ganha
a nota NAO-MATRIZ no bloco das camadas de detecção (a classe aqui é
indireção, pinada pelas regressions de helper, não por tabela de tokens; a
matriz de 19 formas é exclusiva do curl-timeouts); scan-curl-timeouts.mjs
ganha a nota da exclusividade no bloco FORMAS DE INVOCAÇÃO (o scan-timeouts
compartilha a filosofia mas não tem matriz — a tabela existe aqui porque a
superfície de formas do bash é rica).

**Fronteira travada**: a decisão de NÃO ter teste compartilhado vive nos
dois headers + nesta seção — quem quiser criar um teste de forma
compartilhado precisa re-medir a classe de variantes (o KIND difere) e
editar a sec 11.38 conscientemente; quem quiser "consertar" a matriz do
scan-timeouts (adicionar formas de token) quebra as regressions de helper
que pinam a classe real.

**Re-validação**: vitest **59/59** (3 suítes: scan-timeouts 23 +
scan-curl-timeouts 29 + gates-proofs-ordering 7) — verdes; ordering 11.37→ 11.38 → 12; UTF-8 OK no doc + ASCII-OK nos 2 gate files (headers
tocados); tsc 0; eslint 0 erros.

## 11.39 Por que NÃO adotar js-yaml no danglingNeedsIn — a fronteira das 3 formas basta (decisão 2026-08-11)

**A pergunta**: o `danglingNeedsIn` (regra 11) usa regex sobre as 3 formas
YAML (inline `[a, b]`, single `a`, bloco `needs:` + `- a`). Um parser YAML
real (js-yaml) reduziria a superfície de formas (anchors/aliases, merge
keys, flow multi-linha, needs: herdado por include) — ou a fronteira
documentada basta? Medição antes de decidir.

**A medição** (probe real, 2026-08-11 — não conjectura):

| Eixo | Medido |
|---|---|
| **Paridade regex vs js-yaml** (os 18 workflows reais) | **0 vs 0 dangling, 0 divergências** — js-yaml não acharia NADA que o regex não acha hoje |
| **Custo de boot** (3 runs cada) | **idêntico ~0.12s** (regex 0.11–0.14 vs js-yaml 0.11–0.13) — ambos dominados pelo boot do node, não pelo parser |
| **Dependência** | js-yaml **NÃO é declarada** no package.json — só resolve transitiva via @mdxeditor/editor (dep de UI, não de gate) |
| **Anchors/aliases reais** | 0 em `needs:` — o único anchor do repo (e2e-cache.yml `&cache_paths`) vive em `on.pull_request.paths`, **FORA de `jobs:`** onde o parser escopa; o `&limit=1` é query string de URL, não anchor |
| **Merge keys / needs quotado / flow multi-linha / bloco-form real** | **0 usos** em todos os 18 |
| **Formas reais de needs:** | só inline `[a, b]` e single `a` — as 2 das 3 formas que o regex cobre |

**O comportamento das formas exóticas no regex** (probe da função pura):
`needs: *deps` (anchor/alias YAML — a única forma que um parser real
resolveria) → o regex reporta o alias cru como ref pendurada:
`DANGLING NEEDS (job b: needs *deps)` — **OVER-FLAG na direção SEGURA**
(falha alto, um humano revisa; nunca passa silencioso). Ou seja: mesmo se
uma forma exótica aparecer amanhã, o guard TRIPA — a fronteira não é um
furo, é um over-flag nomeado.

**O veredito — RECUSAR js-yaml** (o precedente das 11.30/11.37/11.38): a
fronteira das 3 formas basta PORQUE (1) a superfície real é exatamente as
2 formas canônicas — js-yaml reduziria 0 formas, (2) a paridade é
perfeita nos 18 workflows — zero sinal novo, (3) o custo não vale: dep
não-declarada (adotar = declarar uma dep de gate só para igualar o que o
regex já faz, com lockfile/install/CI impact) e boot idêntico, (4) a
direção de falha das formas exóticas é over-flag (seguro), nunca under-flag
silencioso. Adotar js-yaml trocaria um parser de 40 linhas sem dep por uma
dep de 300KB+ para ganhar 0 formas reais.

**O que mudou** (pin da decisão): nota NAO-JS-YAML no header do bloco rule
11 do scan-guard-gates.mjs (a fronteira nomeada); teste hermético novo
(`needs: *deps` → exit 1 DANGLING NEEDS — o over-flag provado, a direção
segura pinada); pin no REAL-REPO CONTRACT (0 formas exóticas reais nos 18
workflows — o regex `^\s*needs:.*(\*|&|"|'|\[\s*$)` casa 0 arquivos).

**Re-validação**: vitest **125/125** (scan-guard-gates com o mutation
novo do anchor/alias `needs: *deps` + o pin de 0 formas exóticas dentro do
REAL-REPO CONTRACT + exclusivity + run-precommit-guards + golden-copy-utils
+ BASELINE scan-timeouts) + ordering 11.38 → 11.39 → 12; UTF-8 OK no doc +
ASCII-OK no gate file (header tocado); tsc 0; eslint 0 erros.


## 11.40 O guard dos guards de fronteira — toda fronteira DECIDIDA-ACEITA do
scan-curl-timeouts precisa de tripwire OU contrafactual pinado (manifest
FRONTIERS, decisão 2026-08-11)

**A pergunta**: o detector tem hoje DOIS early-warnings de fronteira aceita
— o BASELINE companion (o detector varre uma superfície não-vazia, nunca
um pass vacuo) e o tripwire do eval (sec 11.36). Mas as demais fronteiras
decididas (token quotado, split-form, `-m 20`, `CURL_BIN=curl`, wrapper,
`--connect-timeout` sozinho, caminho absoluto, `env curl`, `$HEALTH_URL`,
`command -v curl`) vivem em prosa + linhas da matriz INVOCATION-FORM —
NADA as enumera com a classe de proteção. Um refactor futuro que drope um
pin (um teste de contrafactual, uma linha da matriz, o próprio tripwire)
sem o contrato travar? A avaliação mede o estado de proteção e decide se um
manifest estrutural vale o custo.

**A medição** (probe da superfície real, 2026-08-11):

| Fronteira decidida-aceita | Classe | Proteção hoje | Onde |
|---|---|---|---|
| `eval` (`CMD="curl ..."; eval "$CMD"`) | escape | **tripwire** (scanEvalCurl) + contrafactual | 11.30/11.36 |
| token quotado (`"/usr/bin/curl"`, `"$(command -v curl)"`) | escape | **contrafactual** (quotado passa, mesmo path bare flaga) | 11.31 |
| split-form (`CMD=...` / `eval "$CMD"` em linhas separadas) | escape | **contrafactual** (split não tripa, mesma forma numa linha tripa) | 11.36 |
| forma curta `-m 20` | overflag | **matrix** (expected 1 — over-flags, direção segura) | 11.31 |
| case-variante `--MAX-TIME`/`--Max-Time` | overflag | **matrix** (expected 1 — case-sensitive, também erro do curl) | 11.31 |
| `alias curl='...'` (token NOME) | overflag | **matrix** (expected 1) | 11.31 |
| `CURL_BIN=curl` (atribuição) | overflag | **matrix** (expected 1 — o over-flag documentado do header) | header |
| wrapper `curl2()` (DEF sem bound) | overflag | **matrix** (expected 1 — o DEF é o chokepoint) | 11.31 |
| `--connect-timeout` SOZINHO | fail-decision | **matrix** (expected 1 — FALHA POR DECISÃO) | 11.31 |
| caminho absoluto `/usr/bin/curl` | covered | **matrix** (expected 1 — o probe inverteu a premissa) | 11.31 |
| `env curl` / `env VAR= curl` | covered | **matrix** (expected 1) | 11.31 |
| `$HEALTH_URL` parametrizável | covered | **contrafactual** (MUTATION — o URL variável não escapa) | 11.29 |
| `command -v curl` (probe) | excluded | **matrix** (expected 0 — regra explícita) | 11.31 |
| `CURL=$(command -v curl); "$CURL"` | excluded | **matrix** (expected 0 — regra do probe, linha inteira) | 11.31 |

**O achado**: TODAS as 14 fronteiras decididas JÁ têm proteção individual —
o tripwire cobre o `eval`, os contrafactuais cobrem as três classes de
escape (quotado, split-form, URL variável), as 11 linhas da matriz cobrem
os over-flags/covered/excluded/fail-decision. MAS nada **enumera** a
superfície com a classe de proteção: um refactor que drope um pin passa
silencioso (o teste some, o doc fica). É a MESMA classe de drift que o
manifest-registry / scan-batch-coverage já travam — a fronteira do
scan-curl-timeouts é a única superfície decidida sem manifest.

**O veredito — VALE ADOTAR** (o custo é um export + 4 asserts, o benefício
é travar a superfície inteira): o manifest FRONTIERS exportado do próprio
scanner (a fonte da verdade, não um arquivo paralelo) com `kind`
(escape/overflag/covered/excluded/fail-decision), `protection`
(tripwire/counterfactual/matrix), `marker` (o substring EXATO que a suite
deve conter) e `ref` (a seção que decidiu). O contrato prova: (1) o
ABSOLUTE PIN — as 14 ids registradas, um crescimento novo tem que entrar
AQUI conscientemente; (2) oINVARIANT — toda fronteira `escape` tem tripwire OU contrafactual (uma
escape pinada só por matrix seria um furo indecidido, nunca uma fronteira
decidida); as demais classes (overflag/covered/excluded/fail-decision)
NUNCA são tripwire (o scanEvalCurl é o pin reservado do eval) e são
pinadas por matrix com o expected documentado OU por contrafactual — o
caso do `$HEALTH_URL` (covered + contrafactual) mostra a exceção legítima
ao matrix-only; (3) os MARKERS — o guard lê o próprio test file
(o padrão manifest-registry) e falha se o marker de QUALQUER fronteira
sumir do código; (4) os EARLY-WARNINGS — os dois layers da superfície
protegida (BASELINE companion + tripwire) continuam existindo como it
blocks separados. Um refactor que drope o contrafactual do quotado, a
matriz do `-m`, ou o próprio tripwire → o marker some → o contrato trava
com o caminho exato.

**O que mudou** (2 arquivos): `scripts/scan-curl-timeouts.mjs` exporta
`FRONTIERS` (14 entradas, ASCII puro, header documentando as classes);
`scripts/__tests__/scan-curl-timeouts.test.ts` ganha o describe FRONTIER
GUARD com os 4 testes (manifest, invariant, markers, early-warnings) usando
a infra já existente (ROOT/path/fs) — sem fixtures novas, sem dep nova.

**Re-validação**: `npx vitest run scripts/__tests__/scan-curl-timeouts.test.ts --config vitest.config.unit.ts`
(36 testes) + manifest-registry (o FRONTIERS é um manifest novo na família)
+ ordering 11.39 → 11.40 → 12; UTF-8 OK no doc + ASCII-OK no gate file;
tsc 0; eslint 0 erros.


## 11.41 O guard da árvore suja + `--stash-uncommitted` — o ACHADO da sec 8.21 fechado no runner (decisão 2026-08-11)

**A pergunta**: a Prova 26 (sec 8.21, run 31485163704) observou ao vivo
que o `git add -A` do commit scratch do `ci-proof-run.mjs` varreu TODO o
delta não-commitado da thread (13 arquivos) e o revert (`git checkout
<original>`) os apagou da working tree — recuperados só via cherry-pick do
commit scratch 86ff0b3. O ACHADO vive SÓ na prosa do doc; o runner não
protege o delta: qualquer ciclo futuro com working tree suja repetiria o
acidente. Fechar a classe no próprio helper.

**A decisão (fail-loud por default + `--stash-uncommitted` como escape)**:
o guard roda `git status --porcelain` ANTES do `git checkout -b` (a ordem
importa: o checkout CARREGA os arquivos sujos para a scratch e o `add -A`
os varreria; o revert os apagaria). Árvore suja SEM a flag = exit 3
fail-loud com a nota do ACHADO (o ciclo não pode varrer um delta que o
revert apaga). Com `--stash-uncommitted`, o runner preserva o delta
(`git stash push -u` — untracked incluídas, o delta pode ter arquivos
novos) e o restaura no revert (`git stash pop` após o checkout da branch
original); um pop CONFLITANTE vira revert parcial (AVISO + exit 3, o stash
permanece recuperável via `git stash list`) — o delta nunca se perde em
silêncio.

**Implementação** (`ci-proof-run.mjs` + fixture fake + suíte): parseArgs
(flag + usage) · planSteps (o passo `git: status --porcelain` ANTES do
checkout -b + `git: stash push` / `git: stash pop` quando a flag está) ·
main() (o guard roda após o rev-parse/dry-run e ANTES do checkout -b;
stash push fail-loud; revert ganhou o stash pop com participação no exit
code) · fixture (status branch-aware: `CI_PROOF_FAKE_DIRTY_BEFORE` simula
a sujeira pré-ciclo na branch base, `FAKE_DIRTY` a pós-mutação na scratch —
os testes históricos com `FAKE_DIRTY=1` continuam verdes porque a
checagem pré-ciclo vê clean na base; handlers `stash push`/`stash pop` +
`CI_PROOF_FAKE_STASH_POP_FAIL`).

**Testes**: PURE parseArgs/planSteps (flag + a ordem
status→stash→checkout e checkout→stash pop→branch -D no plano) · E2E
fail-loud (dirty antes sem flag → exit 3, ZERO invocations além do status —
nem checkout -b) · E2E stash happy path (exit 0, stash push antes do
checkout, stash pop antes do branch -D, mensagens de preservado/restaurado)
· E2E pop conflitante (exit 3, AVISO revert parcial, `stash pop=FALHOU`) ·
REAL-REPO CONTRACT (o `status --porcelain` vem antes do `checkout -b` no
código + o stash push/pop wired).

**O paralelo com o check-push-deletion (RECUSADO, 2026-08-11)**: o
check-push-deletion.mjs (sec 11.21) pula a cadeia de gates do pre-push em
push de deleção pura (local sha all-zeros) — o push não transporta
NENHUM commit novo, rodar ~74s de gates testaria nada; é housekeeping
(~74s → ~0.4s). A pergunta: o guard desta secção deveria ganhar o mesmo
skip em casos "deleção-like"? A premissa implícita é "deleção não roda
gates → não precisa proteger delta". **NÃO** — a analogia quebra na
classe, por cinco razões:

1. **Levers incomensuráveis**: o check-push-deletion é um lever de TEMPO
   (gates que testariam nada num push de housekeeping); este guard é um
   lever de INTEGRIDADE DE DADOS (o delta não-commitado seria varrido
   pelo `git add -A` do commit scratch e apagado pelo revert — a Prova
   26). "Nada a testar" ≠ "nada a perder": o primeiro otimiza um custo
   recuperável (re-push), o segundo protege trabalho irreversível.
2. **Não existe ciclo "deleção-like" no ci-proof-run**: todo ciclo faz
   checkout -b + push + dispatch + poll — o ciclo É os gates (a prova só
   existe porque o workflow roda no ref empurrado). Não há forma de
   invocação que "não rode gates" e, portanto, nenhum caso onde o delta
   não esteja em risco. (Nota de conservadorismo honesto: o sweep do `git
   add -A` só materializa com `--mutate` — sem a flag o ciclo nem
   commita — mas o guard dispara MESMO sem ela (o E2E fail-loud usa
   `--branch` + `--workflow` sem `--mutate`). Esse over-fire é
   deliberado e parte da decisão: o guard roda ANTES do checkout -b e
   não pode prever o que o ciclo fará depois; o default fail-loud custa
   ~10ms e o escape `--stash-uncommitted` existe. Um skip "só quando tem
   --mutate" seria otimizar a proteção por uma premissa que o ciclo
   pode quebrar no passo seguinte.) O push de deleção pura é housekeeping do HOOK
   (apagar branches no remote), não um propósito do ciclo.
3. **Assimetria de falha**: um skip agressivo demais do check-push-
   deletion deixa um push sem vetar — recuperável (re-push). Um skip
   indevido deste guard DESTRÓI o delta — irreversível (a Prova 26 só
   recuperou os 13 arquivos via cherry-pick do commit scratch). O default
   fail-loud existe POR essa assimetria.
4. **O escape já existe e PRESERVA**: `--stash-uncommitted` é o "skip"
   sancionado — mas um skip que protege o delta (stash push -u + pop no
   revert) em vez de abandoná-lo. Quem precisa rodar um ciclo com árvore
   suja usa a flag; o guard nunca descarta o delta ao chão.
5. **Complementaridade, não concorrência**: o próprio revert do ciclo faz
   `git push origin --delete <scratch>` — uma deleção pura que o
   check-push-deletion JÁ fast-pathada no hook (quando o hook roda; com
   `--no-verify` o push do revert sai do hook, mas o revert é o mesmo).
   Os dois levers atuam em camadas diferentes (custo do hook vs.
   integridade do ciclo) — não há sobreposição a resolver, e o guard não
   "pega emprestado" o skip do hook.

**Re-validação**: `npx vitest run scripts/__tests__/ci-proof-run.test.ts --config vitest.config.unit.ts`
+ `npx vitest run scripts/__tests__/scan-exit-claims.test.ts --config vitest.config.unit.ts`
(a cobertura bidirecional lê esta secção — as claims registradas da 11.41
não mudaram: sem flag → exit code 3, --stash-uncommitted → 0/3) +
`gates-proofs-ordering.test.ts` valida a monotonia 11.40 → 11.41 → 12;
tsc 0; eslint 0 erros; UTF-8 do doc OK; ASCII-OK nos gate files.


## 11.42 Contrato da classe 'claim de doc sem pin' — o manifest EXIT_CLAIMS (decisão 2026-08-11)

**A classe travada**: o SUPERSEDED da sec 11.30 virou um padrão — uma
decisão documentada como exit code 0 que uma mudança posterior (a sec
11.36, o tripwire) inverteu SILENCIOSAMENTE na doc. O leitor da sec 11.30
confiava numa premissa morta (o pedido original da thread usava a 11.30
como base e precisou da 11.36 para ser corrigido). A classe é: **claim de
exit code na doc sem contraparte atual pinada por teste**.

**O contrato**: `scripts/scan-exit-claims.mjs` (padrão FRONTIERS da sec
11.40 — manifest exportado + detector + main() IS_MAIN guardado, SEM
superfície `--print-*`; fora de forma como o FRONTIERS/fuzz-targets, a
LIVE TREE check do manifest-registry não o flagra) + a suíte
`scripts/__tests__/scan-exit-claims.test.ts`:

1. **ABS PIN**: o manifest EXIT_CLAIMS registra EXATAMENTE as 24 seções
   11.x com claim de exit code medidas no doc (11.2, 11.6, 11.7, 11.8,
   11.10, 11.11, 11.12, 11.17, 11.18, 11.19, 11.20, 11.21, 11.27, 11.28,
   11.30, 11.31, 11.33, 11.36, 11.38, 11.39, 11.41, 11.42, 11.43, 11.44).
   Uma claim nova sem registro (ou uma seção renumerada) falha — registrar
   é a decisão consciente, nunca o silêncio.
2. **PIN REALITY**: toda entrada `current` tem pin REAL (arquivo de suite
   existe + marker presente no conteúdo, lido do disco — o padrão
   manifest-registry). Nenhuma claim de comportamento atual vive só na
   prosa.
3. **SUPERSEDED CHAIN**: toda entrada `superseded` aponta um `supersededBy`
   que É `current` com pin real. O par canônico pinado: **11.30 → 11.36**
   — o leitor da 11.30 é redirecionado para a verdade atual (o tripwire)
   com pin em `scan-curl-timeouts.test.ts`. Se um dia outra decisão for
   invertida, a seção antiga vira `superseded` apontando a nova (com pin)
   — nunca fica um exit code morto na doc.
4. **MEASUREMENT HONESTY**: entradas `measurement` (11.2: estado upstream
   do eslint_d, verificação manual + receita na própria seção; 11.10:
   lever RECUSADO medido uma vez, o loader do bun é irrelevante no tsc)
   carregam `note` explicando por que não há pin — classificação
   consciente, não silenciosa.
5. **DOC COVERAGE bidirecional**: o detector honesto (`scanDocExitClaims`,
   regex `\bexit[\s-]+(code|status)?[\s-]*[0-3]\b` por linha sob headers
   `## 11.N` — aceita `exit 0`, `exit code 0`, `exit status 0`,
   `exit-code 0`; o re-frasear com palavra entre `exit` e o número NÃO
   escapa) varre o doc real; toda claim detectada tem entrada (doc →
   manifest) E toda entrada tem claim detectada (manifest → doc, drift de
   seção renumerada/removida falha — o `stale`).
6. **MUTATION**: o teste prova que o checker pega a classe real (claim em
   seção não registrada; sucessor ausente / não-current na cadeia; entrada
   stale sem claim no doc) — não é assert que passa por acaso.
7. **SELF-GUARD**: a própria sec 11.42 menciona exit code 0/1 do CLI — é
   UMA claim registrada (a 24ª), pinned pela própria suite (REAL-REPO
   CONTRACT do CLI + o exit-1 path). O guard guarda a si mesmo: nenhuma
   seção 11.x escapa, nem a que o descreve. (A 25ª, a sec 11.45, segue o
   mesmo padrão — a claim do step do utf8-check pinada na própria suite
   que o valida.)

**O inventário das 27 claims** (seção → kind → pin): 24 `current` com pin
(11.6/11.7 em `scan-lint-staged-loader`, 11.8 em `scan-hook-parallel-race`,
11.11/11.12 em `fuzz-mapped`, 11.17 em `scan-prepush-batch`, 11.18/11.21 em
`check-push-deletion`, 11.19 em `check-node-modules-integrity`, 11.20/11.27/
11.28/11.41/11.43/11.44 em `ci-proof-run`, 11.31/11.36/11.38 em
`scan-curl-timeouts`, 11.33/11.39/11.47 em `scan-guard-gates`, 11.42 na
PRÓPRIA suite, 11.45 em `workflow-utf8-check-contract`, 11.49 em
`check-exit-claims-push`) · 1 `superseded`
(11.30 → 11.36) · 2 `measurement` (11.2, 11.10).

**Onde roda**: via `test:unit` (o MESMO canal do `gates-proofs-ordering` —
o contrato de doc não entra no test:guard de 20s) E, desde o REFINAMENTO
2026-08-11 (o tripwire, bloco abaixo), como **8º guard do batch runner do
pre-commit** (`run-precommit-guards.mjs`). O CLI `node
scripts/scan-exit-claims.mjs --check` sai exit code 0 no doc real
(REAL-REPO CONTRACT) e exit code 1 listando as claims não registradas / pins
quebrados / cadeias quebradas.

**O tripwire do pre-commit (REFINAMENTO 2026-08-11)**: o SELF-GUARD da
11.42 travava a própria seção, mas o mecanismo dependia de quem edita
lembrar de rodar o teste — o `pre-commit:test` mapeia docs para NADA
(`pre-commit-tests.mjs` só mapeia `*.test.{ts,tsx}` e fontes `*.ts|tsx|mjs`;
uma edição do gates-proofs.md com uma claim não-registrada, o hook inteiro
passava: encoding OK, os guards não varrem doc, lint/tsc não tocam md, e o
pre-commit:test imprimia skip) e a falha só aparecia no CI (pr-check, job
check roda test:unit). O tripwire fecha o gap: o CLI do contrato roda como
8º guard do batch runner do pre-commit, INCONDICIONAL (a invariante do
repo: guards baratos não ganham condição — o batch roda sempre, worst-exit).
Medição DIRETA do incremento (3 runs, node 22.23.1, warm — o precedente
da sec 11.18: substituir extrapolação por número medido): o CLI standalone
custa ~0.14-0.16s; medindo a varredura in-process (boot + scan em 0.14-0.15s
vs boot puro 0.10-0.12s), o scan do exit-claims adiciona ~30-40ms por
commit ao batch (o boot é compartilhado) — o batch de 8 guards warm fica em
~0.29-0.31s vs ~0.26-0.43s do de 7. O mesmo lever do scan-batch-coverage,
agora aplicado ao contrato de doc.
Alternativa avaliada e RECUSADA: spawn condicional (`if git diff --cached |
grep gates-proofs.md; then node ...`) — criaria a classe de condição que os
contratos anti-paths-filter do repo travam, e o custo por commit de doc
(~0.15s standalone de boot) seria MAIOR que o incremento do batch. O
contrato de crescimento do batch (sec 11.16) foi atualizado na mesma
edição: o DERIVATION PIN do scan-batch-coverage agora pina os 8 imports e o
REAL-REPO CONTRACT do runner os 8 veredictos em ordem — um 9º guard futuro
também entra pelo mesmo caminho sancionado.**O escopo 11.x basta — as seções 8.x (Provas e medições) são registros de
evento, não claims de comportamento (RECUSADO, 2026-08-11)**: o detector varre só as
seções 11.x (`scanDocExitClaims` casa `^## (11\.\d+)` e zera em qualquer
outro `^## \d`). A região 8.x tem **87 citações** de exit-code (41 `exit
0`, 40 `exit 1`, 4 `exit 3`, 2 outras — 33 na tabela de Provas + 54 nas
seções 8.2–8.28) e a avaliação de estender com um segundo manifest
EXIT_CLAIMS_8 concluiu **RECUSADO** por 5 razões:

1. **Direção da verdade oposta** — 11.x são claims NORMATIVAS (o código
   DEVE sair exit N sob condição; o pin prova que sai). 8.x são registros
   DESCRITIVOS (este run SAIU exit N no run/date X; a âncora é o run
   number, não o código). A classe que o contrato trava é 'claim sem
   contraparte ATUAL pinada' — uma Prova não é uma claim atual, é um fato
   histórico congelado.
2. **Pin impossível no repo** — o `resolvePin` exige arquivo + marker
   LIDOS DO DISCO. Uma claim de Prova é ancorada no log do run no GitHub
   Actions (fora do repo). EXIT_CLAIMS_8 seria um manifest de fatos
   não-verificáveis no repo — o oposto do PIN REALITY.
3. **Falso-positivo estrutural** — a maioria das citações `exit 1` nas
   8.x registra uma MUTAÇÃO que esperadamente falhou (a prova do guard
   funcionando). O detector flagraria o registro da própria prova como
   drift a corrigir — estender criaria uma taxa de manutenção por Prova
   nova (uma entrada de manifest "é registro, não claim"), exatamente o
   custo que o contrato recusou por design.
4. **A tabela de Provas nem é seção** — 33 das 87 citações vivem nas rows
   1–32 (tabela), que o modelo de parser por headers não cobre; um
   EXIT_CLAIMS_8 teria que inventar um modelo de tabela além do modelo de
   seção.
5. **A rastreabilidade já existe** — cada Prova cita o run number e a sec
   11.x correspondente; o leitor que quer a verdade ATUAL vai à 11.x
   PINADA. O contrato trava a classe no lugar certo: a 11.x é a fronteira
   da verdade atual.

**Nota de conservadorismo honesto**: o reset `^## \d` do detector já
limita o escopo estruturalmente — estender exigiria um segundo header
pattern `## 8.\d+` + um segundo manifest, e a decisão é que o custo (taxa
de manutenção por Prova + pin impossível) não compra sinal nenhum:
nenhuma claim 8.x é de comportamento atual do repo.

**A convenção do redirect (fecha a aresta de escape silencioso)**: se um
dia alguém escrever uma claim NORMATIVA de exit code ("o código DEVE sair
exit N") numa seção 8.x, ela escaparia do contrato — o detector varre só
11.x POR ESTA CONVENÇÃO. A regra para o escritor: claim normativa vive na
11.x correspondente; a 8.x é o lar de registros de evento, não de claims.
Um leitor que encontrar uma claim normativa numa 8.x deve movê-la para a
11.x (e registrá-la no manifest) — a decisão não é "claims 8.x não
importam", é "a 8.x não é o lar de claims, redirecione para a 11.x" (o
mesmo argumento da rastreabilidade da razão 5).

**Re-validação**: `npx vitest run scripts/__tests__/scan-exit-claims.test.ts --config vitest.config.unit.ts`
+ `gates-proofs-ordering.test.ts` valida a monotonia 11.41 → 11.42 → 12;
tsc 0; eslint 0 erros; UTF-8 do doc OK; ASCII-OK nos gate files.

## 11.43 --expect-success-implies-clean — a classe 'passou mas com warning inesperado' travada no runner (decisão 2026-08-11)

**O problema**: a Prova 30 (sec 8.25) usou `--only-jobs` + `--expect success` —
o ciclo provou que o job concluiu `success`. Mas o sucesso de um job de CI não
prova que o log está limpo: um step pode emitir uma anotação de warning e
ainda sair exit 0 (o caso real do repo: o step docs-encoding do pr-check.yml
emite `::warning::` e não bloqueia o PR — informacional). Um proof que registra
"success" sem olhar o log esconde a classe — o sucesso observado vira premissa
para o leitor da prova.

**A flag**: `--expect-success-implies-clean` — quando setada, o verify compõe:
`conclusion==success` (o `--expect` existente) E 0 warning-lines no log
capturado (`scanLogWarnings`/`verifyCleanLog`, exports puros). Requer `--expect
success` (a flag só faz sentido quando o sucesso é o esperado) e é
incompatível com `--expect-parse-reject` (as duas definem o resultado por
inteiro — success+0 warnings vs failure+0 jobs). Qualquer warning-line = o
verify falha com exit code 1 (revert MESMO ASSIM — a branch scratch nunca fica
no remote) com as linhas listadas (número + até 3 + total) — o autor da prova
decide (corrige, documenta ou não usa a flag). Log limpo = exit code 0.

**A definição da warning-line (a decisão)**: o canal de anotação do GitHub
Actions — `::warning::` (formato novo) e `##[warning]` (legado). É o sinal
DELIBERADO de "avisa mas não falha" de um step. Tool noise em stderr (npm
warn, eslint warning) NÃO é warning-line: o ruído de install/eslint aparece em
TODO proof e faria a flag inútil; o canal de anotação é determinístico (um
step ou emite a anotação ou não). O baseline do repo (grep 2026-08-11): as
anotações deliberadas existem (pr-check.yml:92 docs-encoding informativo,
ci.yml:405 bundle preview skipped, bundle-report.mjs:641/646 gate desarmado)
mas disparam SÓ em estados degradados — um proof healthy tem 0, exatamente a
classe que a flag pega.

**Exit codes**: 0 = success + 0 warning-lines observados E revertido; 1 = a
conclusão divergiu OU o log tem warning-lines (revert mesmo assim); 2 = uso
errado (flag sem `--expect success`, incompatibilidade com parse-reject).

**Re-validação**: `npx vitest run scripts/__tests__/ci-proof-run.test.ts --config vitest.config.unit.ts`
(parseArgs + scanLogWarnings/verifyCleanLog puros + planSteps + os 3 E2Es com
fake bins: warning -> exit 1, clean -> exit 0, sem `--expect success` -> exit 2);
`gates-proofs-ordering.test.ts` valida a monotonia 11.42 → 11.43 → 12;
tsc 0; eslint 0 erros; UTF-8 do doc OK; ASCII-OK nos gate files.

## 11.44 O revert do stash do ciclo mira PELA MENSAGEM + o recipe de cura no AVISO (decisão 2026-08-11)

**O problema**: o revert parcial (stash pop conflitante, sec 8.21/11.41)
avisava que "o delta segue no stash (git stash list/show para recuperar)"
— mas ninguém recuperava: com 19+ stashes pré-existentes (lint-staged
backups + antigos, o estado real da Prova 32), qual deles era o delta? O
AVISO dizia onde procurar, não O QUE rodar. E havia uma segunda classe: o
`git stash pop` cego (stash@{0}) restauraria o stash ERRADO se algo
empilhou um stash por cima do do ciclo durante ele — o lint-staged do
pre-commit cria um "automatic backup" num commit com tree suja (um
`--mutate` sem `--no-verify`) — e o delta seguiria enterrado na stack com
o revert dizendo "delta restaurado" falsamente.

**A decisão (os DOIS lados do pedido avaliados)**:
1. **O recipe de cura no AVISO (ADOTADO)**: o AVISO de conflito agora
   identifica o **ref exato** do stash do ciclo (localizado pela mensagem)
   e carrega os comandos de recuperação: `git stash show -p <ref>`
   (inspecionar o delta) + `git stash apply <ref>` (recuperar — o apply
   mantém o stash até confirmar). Quem lê o AVISO sabe exatamente o que
   rodar, sem re-derivar com 19 stashes na frente.
2. **O `--stash-name` (RECUSADO como flag redundante)**: a intenção — "o
   pop mira o stash certo do ciclo" — é fechada SEM flag: o push -u JÁ
   nomeia o stash determinísticamente (`ci-proof: <branch> (delta
   nao-commitado)`), e o revert agora localiza o stash do ciclo PELA
   MENSAGEM (`findStashRef` + `git stash pop <ref>`, sec 11.44) em vez do
   topo cego. Uma flag `--stash-name` adicionaria uma segunda fonte de
   verdade para um nome que já existe — o ref é derivado do branch, não
   digitado. O nome é o contrato: `git stash list | grep 'ci-proof:
   <branch>'` funciona manualmente do mesmo jeito.

**Exit codes**: exit code 0 = stash do ciclo restaurado pelo ref (pop
<ref> ok); exit code 3 = pop conflitante (o delta segue no stash com o
ref + CURE no AVISO) ou o stash do ciclo não encontrado no list (pode já ter sido recuperado).

**Re-validação**: `npx vitest run scripts/__tests__/ci-proof-run.test.ts --config vitest.config.unit.ts`
(findStashRef puro + o E2E do stash alheio empilhado por cima — o pop mira
stash@{1} pela mensagem, nunca o topo cego — + os asserts do CURE no AVISO)
+ `gates-proofs-ordering.test.ts` valida a monotonia 11.43 → 11.44 → 12;
tsc 0; eslint 0 erros; UTF-8 do doc OK; ASCII-OK nos gate files.

## 11.45 A classe 'acento em gate .mjs' JÁ está no CI — premissa invertida + o step interno do utf8-check pinado (avaliação 2026-08-11)

**Pergunta**: o mjs-gate bloqueou um commit por 2 bytes não-ASCII em
comentários (`scan-curl-timeouts.mjs:298` e `ci-proof-fake-bins.mjs:149`) —
a classe 'acento em gate .mjs' teria escapado do verify-encoding (que cobre
src/) e só o scan-non-ascii do hook local pegaria? Avaliar estender o
utf8-check.yml para rodar `scan-non-ascii --report` sobre scripts/*.mjs no
CI.

**Veredito (AVALIADO — premissa INVERTIDA, com um gap residual fechado)**: o
mjs-gate NÃO é um scan separado do hook — ele é o LAYER 5 do
`verify-encoding.sh` (`scan-non-ascii --report` sobre scripts/*.mjs,
BLOCKING, superfície derivada de `encoding-surface.mjs --print-mjs-gate`), e
o `utf8-check.yml` JÁ roda esse gate consolidado no CI (`bash
scripts/verify-encoding.sh --ci src/`, o comando único). O pre-commit roda o
MESMO gate (`--dry-run --ci src/`) — o commit foi bloqueado localmente pela
MESMA cadeia que o CI executa em todo PR/merge. A classe nunca saiu do CI: o
probe 2026-08-11 rodou o gate REAL (via `MJS_SCAN_FILES`) contra um .mjs com
byte não-ASCII → `VIOLATION scripts/__tests__/tmp-probe-poison.mjs 2:30` +
`mjs-gate: FAILED - non-ASCII byte in a scripts/*.mjs gate file (blocking)`
+ exit code 1 (o sinal exato que o CI daria).

**O gap residual fechado (o que ESTE pin adiciona)**: os contratos existentes
(workflow-utf8-check-contract) pínham os CALL SITES (os `uses:` dos
callers), mas NINGUÉM pínava o comando do step DENTRO do utf8-check.yml — um
step regredido para `bash scripts/check-utf8.sh --ci src/` (dropando os
layers 3-5: fragile-range, yaml-gate, mjs-gate) passaria em TODOS os
contratos verdes. O novo teste no `workflow-utf8-check-contract.test.ts`
pina o passo interno: o step run do utf8-check.yml DEVE ser exatamente
`bash scripts/verify-encoding.sh --ci src/` (exit code 0 = gate intacto; a
mutação trocando por check-utf8 puro falha o guard). A classe 'acento em
gate .mjs' fica travada nos DOIS elos: o layer 5 existe no script E o step
que o executa no CI não pode regredir silenciosamente.

**Exit codes**: exit code 0 = step interno do utf8-check.yml roda o gate
consolidado; exit code 1 = step regredido (contrato) / byte não-ASCII num
.mjs (gate real, probe).

**Re-validação**: `npx vitest run scripts/__tests__/workflow-utf8-check-contract.test.ts --config vitest.config.unit.ts`
(step interno + mutação) + `npx vitest run scripts/__tests__/scan-exit-claims.test.ts --config vitest.config.unit.ts`
(claim 11.45 registrada, ABS PIN 25) + `gates-proofs-ordering.test.ts`
valida a monotonia 11.44 → 11.45 → 12; tsc 0; eslint 0 erros; UTF-8 do doc
OK; ASCII-OK nos gate files.

## 11.46 A classe 'seção 11.x nova sem entrada no manifest' JÁ é fechada — auditoria das 11.41/11.43/11.44 (avaliação 2026-08-11)

**Pergunta**: o commit 0508202 nasceu 4 seções novas (11.41–11.44), mas a
percepção era de que o EXIT_CLAIMS registrara só a 11.42 (a SELF-GUARD). As
seções 11.41/11.43/11.44 com claims de exit code estão TODAS registradas? E
um teste de contrato que pince 'toda seção 11.x nova num commit tem entrada
no manifest' fecharia a classe de drift no momento do commit?

**Auditoria (probe 2026-08-11)**: a premissa está INVERTIDA — as 4 seções do
commit estão TODAS no manifest (a 11.42 era a SELF-GUARD, mas 11.41/11.43/
11.44 também nasceram com entrada própria). O detector honesto no doc real
(`scanDocExitClaims` + `checkExitClaims`): **25 seções detectadas = 25
registradas, 0 unregistered, 0 stale** — o DOC COVERAGE bidirecional já fez
exatamente o trabalho que o teste proposto faria.

**Veredito (RECUSADO — a classe já está fechada em TRÊS camadas)**:
1. **DOC COVERAGE doc→manifest** (o teste 'toda claim de exit code
detectada no doc REAL tem entrada no manifest'): uma seção 11.x nova com
claim e sem registro → `unregistered` → o CLI sai com código de saída 1. É
a versão PRECISA do contrato proposto — e o literal 'toda seção nova tem
entrada' seria OVER-STRICT: uma seção 11.x nova SEM claims de exit code
(decisão em prosa pura) não precisa e não deve ter entrada. O detector
honesto (regex `exit [0-3]` nas formas naturais) é quem decide o que conta
como claim — não a presença da seção.
2. **ABS PIN** (o teste da lista exata de 25 seções): pina o lado do
MANIFEST — toda entrada nova no EXIT_CLAIMS precisa entrar na lista do
pin (edição consciente). O lado doc com claims é o DOC COVERAGE (camada
1); uma seção de prosa sem claims é legitimamente invisível aos dois —
não é claim, não precisa de entrada.
3. **O TRIPWIRE (8º guard do batch do pre-commit)**: o CLI roda como guard
incondicional do hook — a falha vem ANTES do commit, não só no CI. O teste
proposto 'no momento do commit' já existe com esse nome: o tripwire da sec
11.42 (REFINAMENTO 2026-08-11).

**Conclusão**: nada a implementar. O teste proposto seria DUPLICAÇÃO do DOC
COVERAGE doc→manifest (mesmo assert, mesma direção), e o literal 'toda
seção nova tem entrada' geraria falso positivo para seções sem claims
(decididas em prosa). A evidência da auditoria (25=25, 0/0) é o pin vivo da
cobertura — registrada aqui como a contraparte das seções nascidas no
commit.

**Re-validação**: `npx vitest run scripts/__tests__/scan-exit-claims.test.ts scripts/__tests__/gates-proofs-ordering.test.ts --config vitest.config.unit.ts`
+ `node scripts/scan-exit-claims.mjs --check` (25 claims, clean); ordering
11.45 → 11.46 → 12; UTF-8 do doc OK.

## 11.47 O filtro --since/--scope no test:guard do push net — JÁ travado pelo regex EXATO, sem trilha de doc (avaliação 2026-08-11)

**Pergunta**: a re-medição da sec 8.1 (run 31522760166) confirmou o no-filter
calibrado, e o guard-gates.yml já tem contrato próprio (scan-guard-gates,
regra 2: NO PATHS FILTER). Avaliar estender esse contrato para também pinar
que o step test:guard do workflow não ganhe um filtro `--since`/`--scope` no
futuro sem a sec 8.1 ser re-medida — travando a premissa da recalibração
estruturalmente.

**Veredito (AVALIADO — a classe JÁ está fechada, e por um mecanismo mais
forte que o pedido)**: o `TEST_GUARD_STEP_RE` do scan-guard-gates é um regex
EXATO (`^\s+run:\s+bun run test:guard\s*$`, ancorado no `run:` key) —
QUALQUER sufixo (`--since main`, `--scope cached`, `--only x`, até um
`--config` ou redirect) faz o match falhar e o step vira `TEST GUARD STEP
MISSING` no arquivo exato, com exit code 1 do guard. O probe 2026-08-11
(repo sintético, `GUARD_GATES_SCAN_ROOT`): `run: bun run test:guard --since
main` no push net → `missingStep = .github/workflows/guard-gates.yml` → o
CLI reporta `TEST GUARD STEP MISSING in .github/workflows/guard-gates.yml`.
O passo exato: o filtro mapeado NÃO casa o regex do step — a suite completa
(13 suítes/269 testes, a autoridade da sec 8.1) deixa de rodar, e o guard
trava na hora.

**A diferença de desenho vs o scan-fuzz-precommit (sec 11.11)**: o guard do
fuzz tem uma TRILHA DE DOC (uma seção 11.x com ADOTADO + re-medição datada
reverte o negativo — o fuzz foi avaliado como movível). O test:guard do push
net NÃO tem trilha: a premissa da 8.1 (CI roda a suite completa como
AUTORIDADE em checkout fresco) é o alicerce da recalibração, e o regex exato
trava qualquer derivação do comando canônico — sem exceção de doc. Reverter
essa decisão exigiria editar o próprio regex (uma mudança de guard, revisada
como tal), não só escrever uma seção. O pedido original ('que ele não ganhe
um filtro sem a sec 8.1 ser re-medida') é atendido com SOBRA: nem com
re-medição o filtro entra sem passar pelo código do guard.

**O que ESTE registro adiciona**: a mutação que pina a classe do SUFIXO de
filtro (não só a remoção do step, o teste anterior) — `--since main` e
`--scope cached` ambos tripam `TEST GUARD STEP MISSING` no caminho exato, em
loop parametrizado. O contrato já existia (o regex exato); o teste que o
prova para a forma filtrada não.

**O par nos DOIS lados da rede (mutação IRMÃ, 2026-08-11)**: o pin original
da classe de sufixo vivia SÓ no push net (guard-gates.yml). O regex é uma
const COMPARTILHADA (o loop `missingStep` sobre guardNet + o `prGuardJob`
do twin usam o MESMO `TEST_GUARD_STEP_RE`), então um sufixo no twin já
triparia hoje pelo mesmo mecanismo — mas o `prGuardJob` aceita um `stepRe`
PROPRIO por job (FUZZ_STEP_RE, ENCODING_STEP_RE, BENCHMARK_STEP_RE): um
refactor futuro que desse ao fragile-guard um override tolerante a sufixo
passaria no teste do push net (regex do push net intacto) e o twin aceitaria
o filtro mapeado silenciosamente, matando a autoridade da 8.1 no lado PR.
A mutação irmã fecha o par — `--since main` / `--scope cached` no twin
(pr-check.yml, job fragile-guard) tripam `TEST GUARD STEP MISSING in
.github/workflows/pr-check.yml` no caminho exato — o mesmo padrão das Provas
16/19 (needs: nos dois lados) e do EOL ANCHOR no twin. A claim 11.47 no
manifest agora registra a forma COMPLETA (push net OU twin).

**Exit codes**: exit code 1 do guard = filtro no step test:guard (a classe
desta avaliação, nos DOIS lados) OU remoção do step (a classe do teste
anterior) — o mesmo sinal, o mesmo lock.

**Re-validação**: `npx vitest run scripts/__tests__/scan-guard-gates.test.ts --config vitest.config.unit.ts`
(as mutações irmãs --since/--scope no push net E no twin + o REAL-REPO
CONTRACT do guard-gates.yml real)
+ `scan-exit-claims.test.ts` (claim 11.47 registrada, forma completa) +
`gates-proofs-ordering.test.ts` valida a monotonia 11.46 → 11.47 → 12; tsc
0; eslint 0 erros; UTF-8 do doc OK.

## 11.48 O paralelismo do vitest NÃO explica a divergência CI vs local — singleFork desliga o file-parallelism e `--maxWorkers` é no-op (avaliação 2026-08-11)

**Pergunta**: o step test:guard ficou plano (20.9s) apesar do +14% de
testes, mas o local quente subiu +29% (41.2s → 53.2s) — a divergência CI vs
local sugeriria que o paralelismo do vitest (workers) é o que absorve o
crescimento. Avaliar medir o test:guard com `--maxWorkers=1` vs default
(CI/local) para quantificar o ganho do paralelismo e decidir se pinar
`--maxWorkers` no test:guard reduziria a variância das medições futuras.

**Medição (probe 2026-08-11, local Windows, node 22.23.1, vitest 3.1.1, 8
CPUs, 270 testes / 13 suítes, warm)**:
- default: **66.66s / 66.91s** (2 runs)
- `--maxWorkers=1`: **64.12s / 62.14s** (2 runs)
- `--maxWorkers=4`: **60.27s** (1 run)

**O achado (a premissa INVERTIDA)**: o `vitest.config.unit.ts` já força
`pool: "forks"` + `poolOptions: { forks: { singleFork: true } }` — o
file-parallelism está **DESLIGADO por design** (a decisão de 2026-08 que
serializa as suítes subprocess-heavy do guard). O argumento DECISIVO é o
FATO DA CONFIG: com singleFork, o pool de forks é capado em 1, então
`--maxWorkers` é **estruturalmente inerte** — a flag não tem o que limitar.
A leitura honesta dos números precisa do caveat do confound: as 5 runs
NÃO foram interleaved (default, default, mw=1, mw=1, mw=4) — a ordenação
66.91 → 62.14 → 60.27 correlaciona com a posição na sessão (warmup/drift
térmico), um confound que o A/B não-interleaved não separa do efeito de
workers; por isso o veredito ancora no FATO DA CONFIG, não na banda. A
hipótese do paralelismo está invertida: **não há file-parallelism para
absorver crescimento** — a divergência CI (20.9s) vs local (53–66s) é
hardware/plataforma + carga de sessão, não workers. O próprio spread desta
medição (60.27s a 66.91s no MESMO ambiente) reforça o que a sec 8.1 já leu
honestamente: o local é variância de carga; o CI é o step estável.

**Veredito (RECUSADO — NÃO pinar `--maxWorkers` no test:guard)**: pinar o
flag não reduziria a variância das medições (é no-op com singleFork) e
adicionaria ruído ao contrato — um futuro leitor ajustando workers
esperaria ganho de paralelismo que a config não tem. A metodologia de
re-medição continua a mesma da sec 8.1: medir o step do run no CI (o ground
truth estável, 20.9s flat) e tratar o local como indicador de carga, não
como A/B de workers. Mudar o singleFork (para habilitar paralelismo de
verdade) seria uma decisão SEPARADA, com o custo de serialização das
suítes subprocess-heavy a re-medir — fora do escopo desta avaliação.

**Re-validação**: `node --input-type=module -e "import { scanDocExitClaims } from './scripts/scan-exit-claims.mjs'; const d = scanDocExitClaims(); console.log('11.48 claims:', d.get('11.48') ? d.get('11.48').join(',') : 'NENHUMA (correto - secao sem claims de exit code)')"`
+ `gates-proofs-ordering.test.ts` valida a monotonia 11.47 → 11.48 → 11.49 → 12;
UTF-8 do doc OK.

## 11.49 A classe 'commit com HUSKY=0 ou --no-verify esconde claim nova' — ADOTADO o guard git-based do doc commitado (avaliação 2026-08-11)

**O pedido**: o tripwire do scan-exit-claims roda no batch runner do
pre-commit (8º guard, sec 11.42) contra a WORKING TREE — mas só quando o
hook roda. Avaliar um guard git-based (no padrão do check-push-deletion) que
rode o scan-exit-claims --check com EXIT_CLAIMS_DOC apontando o doc do HEAD
vs HEAD~1 — fechando a classe 'commit feito com HUSKY=0 ou --no-verify
esconde claim nova' no push net.

**O furo confirmado (a classe é REAL)**: um commit com HUSKY=0 bypassa o
batch do pre-commit inteiro. No push local, o Gate 3 mapeado
(`pre-commit-tests.mjs --scope push`) mapeia docs/* → NENHUMA suite — o
`scan-exit-claims.test.ts` (REAL-REPO CONTRACT lê o doc real) nunca roda
num push docs-only; o ci.yml roda `test:run` (não `test:unit`) e o
`guard-gates.yml` roda só o `test:guard` (13 suítes, sem scan-exit-claims,
a Prova 35) — a claim sai da máquina e o CI pega SÓ DEPOIS do push (ci.yml
na verdade inclui scripts tests via test:run? NÃO — o ci.yml roda `bun run
test:run` que é o vitest default config, cujo include cobre `src/**` +
`scripts/**` — MAS a 8.1/Prova 35 mediram o net de guard como `test:guard`
13 suítes, e o check do pr-check roda `test:unit`; a classe vive no gap do
push LOCAL docs-only, que nenhum gate local cobre).

**O probe (2026-08-11) que calibrou o design**: (1) o mecanismo funciona —
doc materializado + poison claim 11.99 injetada antes do `## 12.` → o CLI
real sai **`claim na secao 11.99 nao esta no EXIT_CLAIMS`** com exit 1; (2)
o CONSTRAINT do design — o pairing ingênuo 'doc git + manifest da working
tree' false-positiva na direção STALE (o probe flagrou `entrada 11.47 sem
claim no doc atual` com o doc de HEAD — a 11.47 é um registro da working
tree, não do commit; um delta não-commitado adianta o manifest). Conclusão:
o guard usa a direção ÚNICA `.unregistered` (claim no doc SEM entrada no
manifest — a classe do pedido) e IGNORA stale/brokenPins/brokenChains
(propriedades da working tree, cobertas pelo batch do pre-commit +
test:unit).

**O guard adotado** (`scripts/check-exit-claims-push.mjs`, wired no pre-push
logo após o integrity): materializa o doc COMMITADO (`git show
HEAD:docs/gates-proofs.md` — o estado exato que será empurrado, não a
working tree) e roda o detector real na direção única. O base do push é o
`--since` (o `PRE_PUSH_REMOTE_SHA` do hook, já derivado pelo
check-push-deletion); all-zeros/ausente (primeiro push) → fallback HEAD~1
quando existe. A distinção HEAD vs base é de MENSAGEM (claim introduzida
neste push vs pre-existente), NÃO de pass/fail: um doc commitado sujo
BLOQUEIA o push em qualquer caso (empurrar estado quebrado adiante é a
classe; o fix é registrar a claim). Env override `CHECK_EXIT_CLAIMS_PUSH_DOC`
(seam hermético dos testes, mesmo padrão do EXIT_CLAIMS_DOC).

**Custo medido**: ~0.44s local (git show + scan) — acima do limiar <0.2s do
batch-worthiness da 11.17, então o veredito 'pre-push NÃO batchado'
permanece (o batch economizaria só o boot node). A 4ª entrada no
`ALLOWED_NODE_GUARDS` do scan-prepush-batch foi a EDIÇÃO CONSCIENTE que a
própria 11.17 exige (a lista é o pin estrutural — um 5º guard exige nova
re-mediação). O DERIVATION PIN e o ALLOWED pin foram atualizados (3→4).

**Exit codes do guard**: 0 = doc commitado limpo (ou apenas claims
pre-existentes no base); 1 = claim(s) não-registrada(s) no doc COMMITADO
(listadas com a seção exata + o aviso HUSKY=0/--no-verify); 2 = uso errado;
3 = falha de infra (git show HEAD falhou). Registrada como claim 11.49
(current, pin → `check-exit-claims-push.test.ts`).

**Re-validação**: `npx vitest run scripts/__tests__/check-exit-claims-push.test.ts --config vitest.config.unit.ts`
(hermético + REAL-REPO CONTRACT: o CLI real contra o doc real sai clean);
`node scripts/check-exit-claims-push.mjs` no repo real → exit 0; o
`scan-prepush-batch.test.ts` pina a 4ª entrada na lista.

## 11.50 O ABS PIN do EXIT_CLAIMS agora pina o CONTEÚDO (avaliação 2026-08-11)

**O pedido**: a lista ABS PIN de seções existia em DOIS lugares — o manifest
`EXIT_CLAIMS` (o fato) e a lista hardcoded no teste (a projeção `.map(e =>
e.section)` contra um array literal). Avaliar derivar a lista do próprio
`EXIT_CLAIMS` no teste, no padrão dos fatos consumidos (TARGET_DIRS/fatos
que os guards derivam da fonte viva) — o teste deve pinar o CONTENT, não
uma cópia da lista que pode driftar.

**A armadilha que a avaliação identificou (por que a derivação ingênua é
REJEITADA)**: derivar a lista e compará-la CONTRA SI MESMA —
`expect(EXIT_CLAIMS.map(e => e.section)).toEqual(EXIT_CLAIMS.map(e =>
e.section))` — é uma TAUTOLOGIA: o assert passa sempre, independente do
conteúdo, matando o growth contract (uma claim nova/removida falha ALTO
sem o teste perceber). O padrão TARGET_DIRS funciona porque deriva de uma
FONTE EXTERNA viva (os imports do runner, os diretórios reais); aqui a
única fonte é o próprio manifest — derivar dele e comparar com ele não
pina nada.

**O veredito (ADOTADO com refinamento — o CONTENT PIN)**: em vez de pinar
a lista de seções (uma projeção que driftava), o teste agora pina o
CONTEÚDO: o snapshot `ABS_PIN_SNAPSHOT` com as 27 triplas
`[section, kind, claim]` na ordem do manifest, e o assert deriva a tripla
real `EXIT_CLAIMS.map(e => [e.section, e.kind, e.claim])` contra o snapshot
(o mesmo padrão do ABSOLUTE PIN do manifest-registry — pina os fatos
inteiros, não uma cópia derivada). A lista de seções deixa de existir como
literal separado (é a projeção do snapshot, que pina o CONTENT inteiro).
Uma claim nova, reescrita ou com kind trocado agora exige a edição
consciente do snapshot — o growth contract aplicado ao conteúdo, não ao
número.

**A MUTATION que fecha o ciclo**: um manifest PATCHADO (claim 11.50 fake
injetada no fim do array real) diverge do snapshot (28 ≠ 27) — provando
que o pin lê o EXIT_CLAIMS VIVO (o `import` do módulo real), não uma cópia
estática que passa por acaso. A sec 11.50 é deliberadamente claim-free (sem
padrão `exit N`) para não precisar de entrada no manifest — o detector
reporta NENHUMA claim nesta seção (o mesmo padrão da sec 11.48).

**Re-validação**: `npx vitest run scripts/__tests__/scan-exit-claims.test.ts --config vitest.config.unit.ts`
(ABS PIN content + MUTATION hermética do manifest patchado);
`node scripts/scan-exit-claims.mjs --check` no repo real → clean.

## 11.51 A fronteira 11.x-only do detector é pinada como CONTRATO (avaliação 2026-08-11)

**O pedido**: a sec 11.42 documenta a decisão RECUSADO de estender o detector
às seções 8.x (Provas = registros de evento, não claims de comportamento) —
mas só em prosa, com os números de uma medição pontual. Avaliar um teste de
contrato que pince que NENHUMA seção 8.x tem claim detectada pelo detector
11.x-only — travando a fronteira documentada contra um leitor que pense que
há furo ("o detector ignora 8.x? isso é drift?").

**A medição que calibrou o contrato (probe 2026-08-11)**: a região 8.x do
doc real tem **80 citações exit-code-like nas seções 8.x** (85 contando a
tabela de Provas — a nota da 11.42 diz 87, mas com a ressalva de método que
o piso reflete: o número da 11.42 foi medido com contagem/estado diferentes
(54 nas seções 8.2–8.28), e a divergência 54↔80 é exatamente por que pinar o
COUNT como TETO seria errado — o valor varia com o método e cresce com cada
Prova nova; só o piso do MEDIDO atual é estável). O detector
`scanDocExitClaims` retorna **ZERO chaves 8.x** — o reset `^## \d` zera o
escopo em qualquer header não-11.x, e `## 8.N` cai exatamente nessa classe.

**O veredito (ADOTADO — o SCOPE FRONTIER)**: o novo describe no
`scan-exit-claims.test.ts` pina a fronteira em TRÊS direções:
1. **NEGATIVO real**: o detector nunca retorna chave `8.x` no doc real (com
   sanity: ele ACHA as 11.x — a exclusão só é significativa porque há
   11.x vistas, não é detector vazio que passa por acaso).
2. **NÃO-VACUIDADE**: a região 8.x TEM citações exit-code-like (piso ≥ 80,
   o valor MEDIDO no probe 2026-08-11 — contado com o MESMO regex do
detector, importado do módulo, não uma cópia inline que pode driftar) —
a exclusão é INTENCIONAL, não acidente de doc 8.x vazio.
3. **MUTATION hermenêutica**: a MESMA linha sob `## 8.99` não é detectada e
   sob `## 11.98` é — a fronteira é o HEADER, não o conteúdo; um leitor que
   mova uma claim normativa para a 8.x (o caso da convenção do redirect)
   vê o teste provar que ela escaparia POR ESCOPO, fechando o ciclo da
   convenção documentada na 11.42.

**Por que o count NÃO é pinado como teto (o design honesto)**: uma Prova
nova (8.31+) adiciona citações exit-code sem falhar o teste — a taxa de
manutenção por Prova é exatamente o custo que o RECUSADO da 11.42 rejeitou
(razão 3: "taxa de manutenção por Prova nova"). O piso 80 (o MEDIDO atual) é
o drift signal: adições só SOBEM o count (nunca churn), e só uma remoção em
massa de citações 8.x abaixo do valor medido falha (o doc 8.x ficar vazio
sem decisão). A sec 11.51 é deliberadamente claim-free (sem padrão `exit N`)
para não precisar de entrada no manifest — o mesmo padrão das secs
11.48/11.50; o detector reporta NENHUMA claim nesta seção.

**Re-validação**: `npx vitest run scripts/__tests__/scan-exit-claims.test.ts --config vitest.config.unit.ts`
(o describe SCOPE FRONTIER + a suite inteira);
`node scripts/scan-exit-claims.mjs --check` no repo real → clean.

## 11.52 A ASSIMETRIA de desenho do lock test:guard — o guard-gates nunca ganha o mecanismo de reversão do fuzz sem decisão registrada (avaliação 2026-08-11)

**Pergunta**: o lock do test:guard é DURO (regex EXATO, sem trilha de doc —
sec 11.47), mas o scan-fuzz-precommit tem trilha ADOTADO (o REVERSAL_RE da
sec 11.11: um header 11.x com fuzz+ADOTADO/ALLOWED na mesma linha reverte o
negativo). Avaliar um teste de contrato que pince a ASSIMETRIA de desenho —
o guard-gates nunca ganha o mecanismo de reversão do fuzz sem seção 11.x
datada declarando o test:guard ADOTADO — travando que alguém 'abrande' o
regex exato sem decisão registrada. (O título da seção evita ADOTADO na
mesma linha de test:guard de propósito: um header com os dois juntos casaria
o regex da trilha e contaminaria o próprio contrato — a mesma disciplina do
REVERSAL_RE do fuzz.)

**Veredito (ADOTADO — o describe DESIGN ASYMMETRY no scan-guard-gates.test.ts)**: a
assimetria é um FATO de desenho, agora consumido como função exportada pura
(`hardLockAsymmetry(guardSrc, fuzzSrc, docText)` — recebe os sources + doc
como strings, sem leitura de disco no runtime; o teste roda tudo em
memória). O contrato pina a assimetria em 4 direções:

1. **REAL-REPO NEGATIVE**: o scan-guard-gates.mjs NÃO declara `REVERSAL_RE`
   (o lock duro se mantém) E a doc real NÃO tem a trilha test:guard+ADOTADO
   → violated false — a assimetria existe hoje.
2. **REAL-REPO non-vacuidade**: o scan-fuzz-precommit.mjs DECLARA
   `REVERSAL_RE` — a trilha do irmão existe; a assimetria é REAL, não um
   vácuo do detector (o detector não passa porque nada é detectado).
3. **MUTATION (a classe)**: `REVERSAL_RE` injetado no source REAL do
   guard-gates (o shape exato do irmão, antes do TEST_GUARD_STEP_RE) SEM
   trilha de doc → violated true — abrandar o lock duro sem decisão
   registrada é exatamente a classe que este contrato fecha. O pin
   comportamental da 11.47 (sufixo → TEST GUARD STEP MISSING) NÃO pegaria
   essa classe: quem adiciona um REVERSAL_RE mantém o regex do step exato
   (as mutações 11.47 continuam verdes) enquanto converte o lock duro em
   mole silenciosamente.
4. **MUTATION com trilha**: a MESMA injeção + doc com `## 11.x ...
   test:guard ... ADOTADO` datado → violated false — a decisão registrada
   legitima o abrandamento (o mesmo mecanismo do REVERSAL_RE do fuzz: a
   seção é o ato consciente, revisado como tal).

**Por que contratar a ASSIMETRIA e não o comportamento**: a 11.47 já trava o
comportamento (qualquer sufixo falha o regex). O que a 11.47 NÃO trava é a
estrutura: o mecanismo de reversão em si. Um dev que 'consertasse' a
assimetria adicionando um REVERSAL_RE ao guard-gates (para 'alinhar com o
fuzz') passaria todos os testes existentes — só este contrato falha, exigindo
a seção datada que torna o abrandamento uma decisão registrada e revisável.

**Exit codes**: claim-free — o contrato é um teste vitest, não um CLI; a
seção não registra claims de exit code no EXIT_CLAIMS (mesmo padrão da
11.50/11.51).**Re-validação**: `npx vitest run scripts/__tests__/scan-guard-gates.test.ts --config vitest.config.unit.ts`
(o describe DESIGN ASYMMETRY + a suite inteira) +
`node scripts/scan-exit-claims.mjs --check` (claim-free, clean) +
`gates-proofs-ordering.test.ts` valida a monotonia 11.51 → 11.52 → 12; UTF-8
do doc OK.


## 11.53 A premissa do pedido é FALSA — o ci.yml JÁ roda o DOC COVERAGE no push via test:run; step dedicado NÃO adotado, premissa agora PINADA (avaliação 2026-08-11)

**O pedido**: "o guard 11.49 protege o pre-push local, mas o ci.yml roda
test:run (não test:unit) no push — a claim que escapar do guard e do CI de
PR só é pega pelo pr-check. Avaliar se o ci.yml deveria rodar o
scan-exit-claims --check como step dedicado no push net (o mesmo papel do
scan-curl-timeouts --ci), fechando o lado CI da classe."

**O fato (a premissa é FALSA — probe 2026-08-11)**: o `test:run` do ci.yml
é `vitest run` com o config DEFAULT (`vitest.config.ts`), cujo include é
`["src/**/*.test.{ts,tsx}", "scripts/**/*.test.{ts,tsx}"]` — o
`scan-exit-claims.test.ts` (DOC COVERAGE + REAL-REPO CONTRACT) RODA no push
do ci.yml, lendo o doc REAL (`const DOC = path.join(ROOT, "docs",
"gates-proofs.md")`). Prova direta: `npx vitest run
scripts/__tests__/scan-exit-claims.test.ts` (sem `--config` = config
default, o mesmo do test:run) → **18 testes verdes em 2.73s**, com o
`doc -> manifest` (toda claim detectada tem entrada no manifest) e o
`manifest -> doc` (toda entrada tem claim no doc) contra o doc real. Ou
seja: uma claim commitada sem registro no EXIT_CLAIMS deixa o job `test`
do ci.yml VERMELHO no push — a classe NÃO depende do pr-check. O gap que
a 11.49 fechou (e a Prova 37 provou) é o LOCAL: o Gate 3 mapeado do
pre-push mapeia docs/* → nenhuma suite, então o push LOCAL docs-only não
rodava o DOC COVERAGE; o CI (ci.yml test:run) sempre pegou.

**O veredito (NÃO ADOTAR o step dedicado)**: o `--check` dedicado seria
REDUNDANTE — o mesmo detector (`checkExitClaims`, o CLI real e o teste
vitest chamam a MESMA função) rodaria duas vezes no push (uma no DOC
COVERAGE da suíte, outra no step), contra o mesmo doc commitado, sem
cobertura nova. A premissa do pedido — "só é pega pelo pr-check" —
confundiu o test:run (default config, cobre scripts/**) com o test:unit
(só o config do pr-check); os DOIS cobrem a suíte. O padrão do
scan-curl-timeouts --ci não se aplica aqui: aquele step existe porque o
guard-gates.yml roda test:guard (13 suítes, sem scan-curl-timeouts.test.ts)
— o scanner só teria o twin no test:unit do PR; aqui o ci.yml JÁ roda a
suíte no push. Adotar o step seria pagar duplicação sem sinal novo.

**O refinamento (ADOTADO — pinar a premissa)**: a cobertura do push do
ci.yml depende de um fato NÃO-pinado até hoje: o include do config DEFAULT
cobre `scripts/**/*.test.{ts,tsx}`. Se alguém estreitar o include do
vitest.config.ts (remover scripts/**), o push do ci.yml PERDE o DOC
COVERAGE silenciosamente e a premissa do pedido vira verdade. O describe
DEFAULT CONFIG INCLUDE (sec 11.53, no scan-exit-claims.test.ts) pina: (1)
REAL-REPO — o include do config default contém os dois globs (scripts/** e
src/**); (2) REAL-REPO — o próprio arquivo da suíte casa com o glob (o DOC
COVERAGE roda sob o config default); (3) MUTATION — config sem o glob
scripts/** é detectado (a perda da cobertura falha alto, não some em
silêncio). Mesmo padrão do unit-surface-contract (extrai os padrões do
TEXTO do config, a fonte estável — importar o config in-process quebra o
invariante do vite).

**Exit codes**: claim-free — a seção não registra claims de exit code no
EXIT_CLAIMS (mesmo padrão da 11.50/11.51/11.52); o pin é um teste vitest.

**Re-validação**: `npx vitest run scripts/__tests__/scan-exit-claims.test.ts
--config vitest.config.unit.ts` (o describe DEFAULT CONFIG INCLUDE + a
suite inteira) + `node scripts/scan-exit-claims.mjs --check` (claim-free,
clean) + `gates-proofs-ordering.test.ts` valida a monotonia 11.52 → 11.53
→ 12 + scan-guard-gates (o doc-trail regex da 11.52: o header da 11.53 não
carrega test:guard + ADOTADO na mesma linha) + UTF-8 do doc OK.

## 11.54 O comando de cura no caminho de erro da classe exit-claims (avaliação 2026-08-11)

**Pedido**: o guard 11.49 lista as claims não-registradas mas não diz como
curar — adicionar o comando de cura exato ao stdout do erro, no padrão do
`--check-lock` da sec 8.5/8.6 (que já imprime `CURE: rm -rf node_modules &&
bun install --frozen-lockfile`), medindo se o custo de doc no erro vale a
usabilidade.

**O veredito (ADOTADO — CURE compartilhada, custo medido)**: o padrão do
`--check-lock` é claro e o custo de uma linha no erro é desprezível; o
único risco seria a CURE driftar entre os DOIS pontos de erro da MESMA
classe — o CLI do scan-exit-claims (stderr) e o guard do push
check-exit-claims-push (stdout): o dev que recebe o erro do push precisa
converter, o dev do CLI não. A regra dos 2 usos manda extrair:
`EXIT_CLAIMS_CURE` exportada do scan-exit-claims.mjs (a fonte única — o
fix nunca driftar) e consumida pelos dois pontos, com o texto exato
(registrar no EXIT_CLAIMS + confirmar com o `--check`).

**A medição (probe 2026-08-11, doc sintético poison com a claim 11.99)**:
o CLI real (`node scripts/scan-exit-claims.mjs --check` com o override
EXIT_CLAIMS_DOC) imprime a CURE no stderr — **1420 bytes** no caminho de
erro completo; o guard real (`node scripts/check-exit-claims-push.mjs` com
o override CHECK_EXIT_CLAIMS_PUSH_DOC) imprime a CURE no stdout — **381
bytes** (o guard lista 1 claim + a CURE; o CLI lista a claim + a CURE + os
avisos das outras classes).O custo marginal da CURE em si é 139 bytes (a string exata, medida 2026-08-11) por ponto — irrelevante para o conforto do terminal e pequeno mesmo no stderr do CLI. A usabilidade vale o custo: o dev do push sabe exatamente
o que editar (o EXIT_CLAIMS do scan-exit-claims.mjs, sec 11.42) e como
confirmar (o próprio `--check`).

**O pin (hermético, nos dois pontos)**: o teste REAL-REPO CONTRACT do CLI
(scan-exit-claims.test.ts, o caminho de erro com o doc sintético) agora
exige a CURE no stderr; o teste REAL-REPO CONTRACT do guard
(check-exit-claims-push.test.ts, o poison doc via CHECK_EXIT_CLAIMS_PUSH_DOC)
exige a CURE no stdout. Se alguém remover a CURE de um dos pontos, o pin
daquele lado falha alto — o fix compartilhado não pode sumir de metade da
classe.

**Re-validação**: `npx vitest run scripts/__tests__/scan-exit-claims.test.ts
scripts/__tests__/check-exit-claims-push.test.ts --config vitest.config.unit.ts`
(os dois pins da CURE) + `node scripts/scan-exit-claims.mjs --check`
(claim-free, clean — a 11.54 é claim-free por desenho: é uma avaliação do
caminho de erro, não uma claim de exit code) + `node
scripts/check-exit-claims-push.mjs` (o doc commitado real limpo) +
`gates-proofs-ordering.test.ts` valida a monotonia 11.53 → 11.54 → 12 +
scan-timeouts (os it() tocados são subprocess-heavy, timeouts já presentes)
+ UTF-8 do doc OK.

## 11.55 O pointer de cura da classe stale no CLI do scan-exit-claims (avaliação 2026-08-11)

**Pedido**: a CURE da sec 11.54 cobre só o bloco unregistered do CLI — a
classe stale (entrada do manifest SEM claim detectada no doc: seção
renumerada/removida) lista as entradas sem comando de cura próprio.
Avaliar um pointer 'secao renumerada/removida - a CURE de registrar nao se
aplica' no bloco stale, no mesmo padrão da 11.54.

**O veredito (ADOTADO — pointer inline, sem const compartilhada)**: a CURE
de registrar é ativamente ENGANOSA para a classe stale — a direção é
OPOSTA: no unregistered a claim existe no doc e falta a entrada no
manifest (a cura = registrar); no stale a entrada EXISTE e a claim sumiu
do doc (seção renumerada/removida) — a cura = atualizar a seção na entrada
ou removê-la. Um dev que recebesse a CURE de registrar no bloco stale
faria a ação ERRADA (registraria uma claim que o detector acha que não
existe mais). O pointer desambigua: 'atualize a secao no EXIT_CLAIMS ou
remova a entrada'.

**Por que NÃO é uma const compartilhada (a regra dos 2 usos)**: o stale tem
UM único ponto de erro — o CLI do scan-exit-claims (o guard do push
check-exit-claims-push é direction-unique `.unregistered` por desenho, sec
11.49: o stale é ruído de delta na working tree). Sem 2º consumidor, a
const não é extraída (o mesmo critério que deixou a CURE da 11.54
compartilhada: DOIS pontos de erro da MESMA classe). O pointer é inline no
bloco stale — um uso, sem drift possível.

**O pin (hermético)**: o teste REAL-REPO CONTRACT do caminho de erro do
CLI (scan-exit-claims.test.ts, doc sintético) usa um doc sintético com SÓ
a seção 11.99 — o detector acha a claim 11.99 (unregistered) e TODAS as
27 entradas do manifest viram stale (nenhuma das seções reais está no doc
sintético). O teste agora exige o pointer no
stderr: `stale nao tem CURE de registrar` — o bloco stale inteiro é
pinado no MESMO run que o unregistered (os dois caminhos de erro do CLI
num único doc sintético). Se alguém remover o pointer, o pin falha alto.

**Re-validação**: `npx vitest run scripts/__tests__/scan-exit-claims.test.ts
scripts/__tests__/check-exit-claims-push.test.ts --config vitest.config.unit.ts`
(o pin do pointer + o guard intocado) + `node scripts/scan-exit-claims.mjs
--check` (claim-free, clean — a 11.55 é claim-free por desenho: avaliação
do caminho de erro, não claim de exit code) + `gates-proofs-ordering.test.ts`
valida a monotonia 11.54 → 11.55 → 12 + UTF-8 do doc OK.

## 11.56 O contrato de forma dos CUREs: toda classe de erro com CURE compartilha a string entre todos os pontos de erro (avaliação 2026-08-11)

**Pedido**: o repo agora tem 2 comandos de cura — o `--check-lock` da sec
8.5/8.6 (`CURE: rm -rf node_modules && bun install --frozen-lockfile`) e o
EXIT_CLAIMS_CURE da 11.54. Avaliar um contrato de forma que pince que
TODA classe de erro com CURE tem a string compartilhada entre todos os
pontos de erro — a regra dos 2 usos aplicada a todos os guards.

**O inventário (probe 2026-08-11) — 3 classes de CURE, 3 formas**:
1. **Integrity lock (sec 8.5/8.6)**: o literal `check-node-modules-integrity:
   CURE: rm -rf node_modules && bun install --frozen-lockfile` vive no
   check-node-modules-integrity.mjs. Invocado de DOIS lugares — o batch
   runner (run-precommit-guards.mjs importa o `integrityMain`, L68) e o
   .husky/pre-push (spawn, L74) — mas AMBOS executam o MESMO script: há 1
   literal físico, compartilhado POR CONSTRUÇÃO (sem const, sem drift
   possível). A regra dos 2 usos extrai const quando há 2+ GERADORES
   físicos do texto (CLI + guard da 11.54), não 2 invocações do mesmo
   gerador — o ACHADO da sondagem.
2. **Exit-claims (sec 11.54)**: EXIT_CLAIMS_CURE const no
   scan-exit-claims.mjs, consumida por REFERÊNCIA pelo guard
   (check-exit-claims-push.mjs imprime `${EXIT_CLAIMS_CURE}` sem
   re-escrever o texto) — 2 geradores físicos → const compartilhada. ✓
3. **Stash do ci-proof-run (sec 11.44)**: a forma `CURE (sec 11.44): git
   stash show -p ...` no AVISO do helper — 1 ponto de erro, inline.

**O veredito (ADOTADO — contrato de forma test-only, OUT OF SHAPE)**: a
regra JÁ vale hoje (nenhuma classe duplica o literal); faltava o PIN —
nada impedia um dev de adicionar um 2º ponto de erro a uma classe e colar
o literal em vez de importar a const (a classe de drift que a 11.54
matou, reaberta). O scan-cures-contract.test.ts pina o invariante
ESTRUTURAL: toda string CURE (nas formas `CURE:` e `CURE (...):` — o
colon é o discriminador; o pointer da 11.55 `stale nao tem CURE de
registrar` não casa, por design) aparece como literal em EXATAMENTE 1
arquivo de scripts/*.mjs. Dois arquivos com o mesmo literal = duplicação =
drift = falha; a forma correta para 2+ pontos é a const importada. O
suite é test-only (sem manifest --print* nem CLI — o padrão OUT OF SHAPE
do FRONTIERS da sec 11.40): forma pura sobre a superfície scripts/*.mjs,
sem consumidor runtime.

**O pin (4 direções)**: (1) INVARIANTE real — nenhum literal em 2+ arquivos
+ sanity de ≥3 classes; (2) INVENTÁRIO PINADO — as 3 classes atuais com
seus literais e arquivos donos (uma 4ª classe ou literal movido quebra o
REAL-REPO); (3) COMPARTILHADO POR REFERÊNCIA — o guard do push contém
`EXIT_CLAIMS_CURE` e NÃO contém `"CURE:` (o literal não é re-escrito); (4)
MUTATION hermético — o mesmo literal em 2 arquivos sintéticos é flagrado
(com o controle: 1 arquivo = sem duplicação, a forma válida do
single-generator como o integrity). O extrator só lê literais de string —
a menção da CURE do integrity em comentário (o JSDoc do EXIT_CLAIMS_CURE
cita `CURE: rm -rf...`) NÃO conta: o contrato é sobre onde o comando É
IMPRESSO, não onde é documentado.

**Re-validação**: `npx vitest run scripts/__tests__/scan-cures-contract.test.ts
--config vitest.config.unit.ts` (4/4 verde contra o repo real) +
`node scripts/scan-exit-claims.mjs --check` (claim-free, clean — a 11.56 é
claim-free por desenho: avaliação da forma dos CUREs, não claim de exit
code) + `gates-proofs-ordering.test.ts` valida a monotonia 11.55 → 11.56 →
12 + UTF-8 do doc OK.

## 11.57 O batch runner do pre-commit SURFACE a CURE — o contrato da 11.56 já cobre o batch estruturalmente (avaliação 2026-08-11)

**Pedido**: a Prova 38 confirmou a CURE no stdout do pre-push (o guard
check-exit-claims-push). Mas o batch runner do pre-commit
(run-precommit-guards.mjs) também roda o scan-exit-claims (o 8º guard da
sec 11.42) — avaliar se o batch SURFACE a CURE na saída agregada ou a
CONSOME silenciosamente, decidindo se o contrato da 11.56 deve cobrir o
batch como ponto de erro.

**O fato empírico (probe 2026-08-11) — o batch SURFACE, não consome**: com
`EXIT_CLAIMS_DOC` apontando um doc poisonado (a claim fake 11.99 — o
override que o batch herda dos guards, o mesmo padrão da sec 8.5/8.6), o
batch falha (código de saída 1) e a saída AGREGADA contém a CURE na
íntegra:
```
exit-claims: 1 claim(s) de exit code SEM registro no manifest (sec 11.42):
  claim na secao 11.99 nao esta no EXIT_CLAIMS
  CURE: registre a claim no EXIT_CLAIMS de scripts/scan-exit-claims.mjs (sec 11.42) e confirme com: node scripts/scan-exit-claims.mjs --check
```
O mecanismo: o batch importa o `main()` do scan-exit-claims e o chama NO
MESMO processo — o `process.stderr.write` do guard flui direto para o
stdout/stderr do hook (o batch não redireciona nem filtra a saída dos
guards; ele só agrega os exit codes). A CURE chega ao dev no MESMO formato
da Prova 38, pelo caminho do pre-commit.

**Por que o contrato da 11.56 JÁ cobre o batch (sem mudança)**: o contrato
pina o INVARIANTE 'todo literal CURE em EXATAMENTE 1 arquivo'. O batch tem
**0 literais próprios** (grep `CURE:` = 0 em run-precommit-guards.mjs) — ele
é um CONSUMIDOR POR INVOCAÇÃO do `main()` compartilhado, não um gerador do
texto. Se alguém colar o literal CURE no batch (em vez de depender do
main()), o scan-cures-contract.test.ts flagra a duplicação — a classe de
drift da 11.56 fechada TAMBÉM para o batch, sem lista adicional. O
veredito do pedido: o batch NÃO entra no contrato como ponto de erro — a
decisão é documentar (esta seção), não estender o invariante.

**A simetria completa dos pontos de erro (o mapa da CURE no repo)**:
pre-push (guard check-exit-claims-push, stdout — Prova 38) + CLI manual
(stderr — Prova 39) + batch pre-commit (stderr do main() compartilhado —
esta prova). TODOS surfacem a MESMA string via a fonte única
EXIT_CLAIMS_CURE (sec 11.54) ou o main() que a usa — nenhum ponto cola o
literal. O contraste da Prova 39 (CLI = superfície completa CURE+stale;
guard = só unregistered) vale também para o batch: ele roda o CLI
completo, então surface CURE E stale pointer juntos (o probe acima mostrou
as duas linhas no mesmo run do batch).

**Re-validação**: `npx vitest run scripts/__tests__/scan-cures-contract.test.ts
--config vitest.config.unit.ts` (4/4 — o batch sem literal não é flagrado)
+ o teste hermético novo no run-precommit-guards.test.ts (o 8º guard
falha via `EXIT_CLAIMS_DOC` envenenado → código de saída 1 + a CURE na
saída AGREGADA + os outros 7 guards clean — a claim SURFACE agora pinada
por código, fechando a assimetria dos guards 1-7 que só tinham isolamento
hermético) +
`node scripts/scan-exit-claims.mjs --check` (claim-free, clean — a 11.57 é
claim-free por desenho: avaliação da superfície dos CUREs, não claim de
exit code) + `gates-proofs-ordering.test.ts` valida a monotonia 11.56 →
11.57 → 12 + UTF-8 do doc OK.


## 11.58 ADOTADO - hook-proof-run.mjs: o ciclo de prova de hook local num comando (2026-08-11)

O ciclo manual das Provas 37/38 (backup do delta -> scratch ci-proof/* -> delta
materializado via HUSKY=0 -> mutacao commitada -> push SIMULADO via stdin no
hook real -> revert byte-identical) rodou 2x - a regra dos 2 usos para
 extracao. O `scripts/hook-proof-run.mjs` automatiza o padrao num comando, o
espelho do `ci-proof-run.mjs` para a rede LOCAL (sem gh/dispatch/poll - o push
nunca vai ao remote, o hook real recebe o payload de refs no stdin).

**O ACHADO do nome (gitignore)**: `local-proof-*` foi DESCARTADO - o
`.gitignore` linha 51 tem `local-*` (a classe de artefatos locais
nao-commitaveis) e um helper `local-proof-run.mjs` seria SILENCIOSAMENTE
ignorado (nunca entraria no commit - o `git status` nem o listaria). O nome
`hook-proof-*` espelha o `ci-proof-*` do irmao e nao colide com nenhuma regra
de ignore.

Comando:
```
node scripts/hook-proof-run.mjs --branch ci-proof/<nome> --mutate-doc-claim <sec> --expect-cure
```

Flags: `--branch` (obrigatorio, ci-proof/* - o MESMO namespace Type E do
ci-proof-run, `isCiProofBranch` importado); `--mutate-doc-claim <sec>` (injeta
a claim fake `## <sec> Claim fake da prova` + `**Exit codes**: exit code 3.`
ANTES do `## 12.` no gates-proofs.md - a classe exata das Provas 37/38);
`--mutate <cmd>` (mutacao generica; mutuamente exclusivo com a doc-claim);
`--expect-cure` (a saida do hook DEVE conter a `EXIT_CLAIMS_CURE` - a fonte
unica da sec 11.54); `--expect-exit <n>` (default 1: o hook DEVE bloquear;
`--expect-exit 0` E valido - a prova POSITIVA de que o hook passa, o padrao
da Prova 30); `--expect-log <regex>`; `--base-sha` (o sha 'old' do push
simulado; default HEAD~1, all-zeros no 1o push); `--hook` (default
.husky/pre-push); `--keep-branch`; `--dry-run`.

Exit codes do helper: esperado observado + revertido -> **exit code 0**; o
verify divergiu (revert MESMO ASSIM - a scratch nunca fica) -> **exit code 1**;
usage errado -> **exit code 2**; infra (checkout/commit/doc ausente/revert
incompleto) -> **exit code 3**. Pinada pela suite `hook-proof-run.test.ts`
(REAL-REPO CONTRACT do dry-run + E2E hermetico com bins falsos + mutacoes de
divergencia) - o mesmo padrao das demais claims current. Robustez: arvore
LIMPA e um input legitimo (o delta commit e pulado - git commit vazio
falharia) e o revert pula o git apply de patch vazio; uma mutacao no-op nao
falha o ciclo.

Hermeticidade: `HOOK_PROOF_GIT` (o fixture hook-proof-fake-bins.mjs, mesmo
padrao cross-platform do CI_PROOF_GIT), `--hook` -> o fixture
hook-proof-fake-hook.sh (saida + exit code roteirizados via HOOK_PROOF_FAKE_HOOK_*)
e `HOOK_PROOF_DOC` (o doc sintetico do --mutate-doc-claim - nunca toca o
gates-proofs.md real em teste). O revert restaura patch + untracked + doc do
byte-copy e verifica `git status` identico ao snapshot (o equivalente
estrutural do md5 pre=pos das Provas 37/38).


## 11.59 ADOTADO — hook-proof-run ganha `--mutate-doc-renumber <sec> --to <nova>`, o irmão da classe stale (avaliação 2026-08-11)

**Pedido**: a Prova 39 (sec 8.34) e o meu probe de re-validação fizeram o
rename de seção (`## 11.42` → `## 11.98` / `## 11.58` → `## 11.99`) com sed
MANUAL — o shape apareceu 2×, a regra dos 2 usos para extração satisfeita.
Avaliar um `--mutate-doc-renumber` no hook-proof-run (o irmão do
`--mutate-doc-claim` da 11.58) para a próxima prova da classe stale rodar
em 1 comando.

**O veredito (ADOTADO — o irmão da 11.58)**: o `renumberDocSection(doc,
sec, to)` é a mutação pura (exported for tests): renomeia o header
`## <sec> ` para `## <to> ` — 1 rename produz o PAR da Prova 39 (a entrada
`sec` do EXIT_CLAIMS fica stale — sem claim no doc — e a nova seção `to`
vira unregistered). FAIL-LOUD (o Prova 17 ACHADO, sec 8.14): seção
ausente → THROW — uma mutação no-op silenciosa esconderia o sinal da
prova. As 3 mutações do helper são mutuamente exclusivas (claim | renumber
| shell) e `--to` é obrigatório com o renumber (o target da renumeracao).
Dois guards fail-loud extras do review (2026-08-11), no MESMO espírito do
ACHADO: (a) COLISÃO DE TARGET — renumerar PARA uma seção que já existe no
doc (incluindo `to === sec`, o no-op) → THROW; um header duplicado
deixaria o par ambíguo (qual `## <to> ` é o renumerado?) e quebraria o
contrato de ordenação; (b) SHAPE do `--to` — um valor que não parece seção
(ex.: `foo`) falha no parse (o header `## foo ...` nunca produziria o
unregistered detectável e o sinal da prova se perderia por razão errada).
O `--to` sem renumber já era erro no parse (regra da 11.58).

**A ASSIMETRIA documentada (o que o helper prova e o que NÃO)**: o helper
roda o HOOK real, e o guard do push (check-exit-claims-push) é
direction-unique `.unregistered` (sec 11.49) — então o renumber através do
helper prova o CONTRASTE da Prova 39 automatizado: o hook falha com a CURE
do unregistered da seção renumerada e **0 menções a stale** (o contraste
observado ao vivo na Prova 39, agora num comando). O par completo
CURE+stale (o pointer da sec 11.55) é CLI-only por design — observado via
`EXIT_CLAIMS_DOC` probe ou um futuro `--cli-check` mode, fora do escopo
deste helper.

**O pin**: a suite hook-proof-run.test.ts ganhou os testes do
renumberDocSection (pure: rename + throw + ancora com espaco + colisao de
target existente + `to === sec` no-op) + parseArgs (as 3 mutacoes
exclusivas + --to obrigatorio + shape nao-secao do --to) + planSteps + E2E
fake-bin (ciclo renumber completo com CURE + revert byte-identical +
renumber de secao inexistente -> falha de infra fail-loud, código de saída
3) + REAL-REPO CONTRACT do dry-run com a flag nova. O EXIT_CLAIMS segue
sem entrada 11.59 (claim-free por desenho: decisão de flag, não claim de
exit code — o mesmo padrão da 11.56/11.57).

**O escape-hatch do `--mutate` shell e o TRIPWIRE do atalho manual
(avaliação 2026-08-11)**: o `--mutate <cmd>` genérico CONTINUA sendo a
saída para mutações FORA do doc (workflow yml, gate files, etc.) — a
decisão da 11.59 só substituiu o rename de seção do DOC pela flag
dedicada, não o shell genérico. Mas a forma do atalho manual que a flag
substituiu (o sed das Provas 39/40: `sed -i 's/## 11.58 /## 11.98 /'
docs/gates-proofs.md`) agora tem um TRIPWIRE: um `--mutate` que cita
`sed` + `## ` (o rename de header markdown) falha no parse (usage, o
mesmo canal do shape inválido do `--to`) apontando o
`--mutate-doc-renumber <sec> --to <nova>` — porque o sed cru PERDE os
guards da flag dedicada (shape do `--to`, colisão de target, seção
ausente → no-op silencioso, Prova 17 ACHADO) e não fica auditável no
PROOF_CLASSES. O mesmo espírito do tripwire eval+curl da sec 11.36: a
fronteira decidida ganha guard barato, não só prosa. O detector é
substring intencional (`sed` + `## ` + `gates-proofs.md`) — um falso
positivo vira um erro claro de usage, nunca um no-op silencioso; o escape
hatch nao-doc passa livre: sed SEM `## ` (workflow yml), `## ` sem sed
(grep/awk), ou sed + `## ` em OUTRO markdown (README.md — a fronteira é
o contrato do gates-proofs.md, não o markdown genérico; refine do review).

**O pin do tripwire**: `isManualDocRenameCmd` (pure, exportada) + 5
casos (sed+`## `+doc → true; sed sem `## ` → false; `## ` sem sed →
false; sed+`## ` em outro .md (README.md) → false; vazio → false) +
parseArgs (trip com a mensagem apontando a flag;
escape-hatch yml parse OK) + E2E fake-bin (código de saída 2 no parse
com o invocations.log NEM CRIADO — o tripwire é a 1a barreira, antes do
backup; zero invocações git). A suite foi de 36 para 43 testes.

**O trio fail-loud do renumberDocSection fechado no caminho do hook
(avaliação 2026-08-11)**: os 3 THROWs da mutação pura (seção ausente,
colisão de target, `to === sec` no-op) agora têm E2E irmão com o CLI real
(fake-bin). O irmão do no-op explícito (`--mutate-doc-renumber 11.42
--to 11.42`) confirma o MESMO fail-loud da colisão (código de saída 3) —
o `toRe.test` casa a própria seção e o THROW do no-op (sec 11.59) vira
fail-loud no caminho do hook, com 3 pins irmãos: stderr contém "no-op"
e "11.42", o doc NÃO foi mutado (o throw acontece antes do writeFileSync
— o mesmo espírito da sec 8.14) e o hook não rodou (a cadeia morre na
etapa 4, sem commit da mutação no invocations.log). Antes, o no-op só
tinha prova na função pura — o trio de fail-loud do renumber agora está
coberto de ponta a ponta no CLI real.

**Re-validação**: `npx vitest run
scripts/__tests__/hook-proof-run.test.ts scripts/__tests__/scan-exit-claims.test.ts
--config vitest.config.unit.ts` + `node scripts/hook-proof-run.mjs --branch
ci-proof/x --mutate-doc-renumber 11.58 --to 11.99 --dry-run` (plano real) +
`node scripts/scan-exit-claims.mjs --check` (clean, claim-free) +
`gates-proofs-ordering.test.ts` valida a monotonia 11.58 → 11.59 → 12 +
UTF-8/ASCII do doc e do gate file OK.


## 11.60 ADOTADO — o registry PROOF_CLASSES: o manifest das provas vivas por classe de guard (avaliação 2026-08-11)

**Pedido**: o pedido "avalie uma prova" re-propôs 2× uma prova JÁ
registrada — a Prova 39 (sec 8.34, o PAR CURE+stale da sec 11.55) e o
caso do hook-proof-run (sec 11.58, já automatizado). A classe:
're-derivar o que já está pinado'. O consultável que faltava é um
REGISTRY classe-de-guard → prova viva (número + run) — o "avalie uma
prova" do futuro consulta o registry ANTES de propor.

**O veredito (ADOTADO — o EXIT_CLAIMS das provas)**: novo
`scripts/proofs-manifest.mjs` no padrão da sec 11.42 (manifest exportado +
detector + CLI + suite de contrato). `PROOF_CLASSES` mapeia as 17 classes
de guard (verify-encoding, scan-guard-gates, scan-curl-timeouts,
check-exit-claims-push, scan-exit-claims...) às 39 provas vivas — cada
entrada: `{ prova, section, run, what }` (run = o run do CI, null = prova
local). A consulta é o `PROOF_CLASSES` importável + o CLI:
`node scripts/proofs-manifest.mjs --check` (clean = registry coberto).

**O contrato** (a suite pina contra o doc real, o mesmo esqueleto da
11.42): ABS PIN do CONTEÚDO (a projeção [class, prova, section, run] das
39 provas — editar o registry exige editar o snapshot); DOC COVERAGE
bidirecional (doc → manifest: toda Prova detectada no doc tem entrada — o
growth contract: uma Prova nova sem registro falha; manifest → doc:
toda entrada tem seção detectada — stale = drift); PIN REALITY (o module
da classe existe, o padrão manifest-registry); RUN REALITY (todo run
não-nulo aparece no texto do doc — o run nunca é inventado); MUTATION
(Prova 40 fake → unregistered; seção removida → stale; class nova no
manifest → ABS PIN diverge); REAL-REPO CONTRACT do CLI (código de saída
0 no doc real, código de saída 1 via PROOFS_DOC com a seção listada).

**A fonte do mapeamento (o detector)**: o par seção → Prova vem dos
headers `## <sec> Prova <N>` (as Provas 1-6 nos headers `## 2.`-`## 7.`, a
7 no `## 8.`, 8-39 nos `## 8.x`, a 18 no `## 11.19`) + a linha da tabela
`(Prova N, sec X)` para a Prova 20 — cuja seção 11.20 NÃO tem 'Prova N'
no título (`## 11.20 ci-proof-run — custo real do ciclo...`). O detector
faz o first-match do título (a Prova do título, não referências cruzadas)
e a tabela confirma as demais redundantemente.

**OUT OF SHAPE (como o scan-exit-claims/FRONTIERS, sec 11.40)**: SEM
superfície --print-* (CLI = --check), então a LIVE TREE check do
manifest-registry não o flagra — contrato de doc, roda via test:unit (o
MESMO canal do scan-exit-claims), NÃO no test:guard cuja lista de 13
suítes é pinada pela Prova 35 (sec 8.30). Claim-free por desenho: decisão
de registry, não claim de exit code — o mesmo padrão da 11.56/11.57/11.59.

**O lado inverso do growth contract (2026-08-12) — a direção wired →
registry**: o DOC COVERAGE original cobre doc → manifest (Prova nova no
doc sem registro falha). O INVERSO — um guard WIRED na superfície viva
sem classe no registry — vivia só em prosa. `deriveWiredGuards()` deriva
a lista de guards wired da superfície REAL (spawns `node|bash scripts/`
dos hooks .husky/pre-commit e .husky/pre-push + os imports do batch
runner run-precommit-guards.mjs + os steps `node scripts/scan-*.mjs --ci`
dos workflows do net guard-gates.yml/pr-check.yml — o padrão TARGET_DIRS
aplicado ao registry, comentários não derivam, a camada de composição é
excluída) e `checkWiredSurface()` falha se um guard wired não tiver
classe no PROOF_CLASSES nem entrada no WIRED_ALLOWLIST. Medido
2026-08-12: **18 guards wired = 11 classes registradas + 7 no
WIRED_ALLOWLIST** (as exceções deliberadas, suite-pinned, sem Prova
dedicada: scan-timeouts, scan-lint-staged-loader, scan-fuzz-precommit,
scan-batch-coverage, check-push-deletion, scan-lucide-icons e
check-docs-encoding — um 8º guard wired exige registrar a classe com uma
Prova viva OU entrar na allowlist com rationale, nunca silêncio). A
direção registry → wired NÃO existe por desenho: classes helper
(ci-proof-run, hook-proof-run, doc-revalidate, run-all-fuzz) têm Prova mas
não são guard de hook.

**O pin**: scripts/__tests__/proofs-manifest.test.ts — o ABS_PIN_SNAPSHOT
da projeção (42 entradas) + shape + PIN REALITY + RUN REALITY + DOC
COVERAGE bidirecional + WIRED SURFACE (ABS PIN da allowlist + a derivada
real de 18 + missing = [] + MUTATIONs do hook sintético) + CONSULTATION
(a Prova 39 e o ciclo das Provas 37/38 já registrados — o caso do pedido)
+ MUTATION + REAL-REPO CLI.

**Re-validação**: `npx vitest run
scripts/__tests__/proofs-manifest.test.ts --config vitest.config.unit.ts`
+ `node scripts/proofs-manifest.mjs --check` (clean, 19 classes / 43
provas / 18 guards wired cobertos) + `gates-proofs-ordering.test.ts`
valida a monotonia 11.59 → 11.60 → 12 + UTF-8/ASCII do doc e do gate
file OK.

## 11.61 ADOTADO — scripts/doc-revalidate.mjs: a re-validação datada das 8.x num comando (avaliação 2026-08-11)

A re-validação da sec 8.34 (2026-08-11, o par 27→28 claims) foi manual: rodar o CLI, rodar a suite, editar a doc — o ciclo que o próximo dev re-derivaria a cada claim nova. O helper `scripts/doc-revalidate.mjs` (o espelho do hook-proof-run para os registros de evento) automatiza o ciclo em 1 invocação, no padrão das Provas/controles 8.x:

1. **CLI real**: spawna `node scripts/scan-exit-claims.mjs --check` (com `EXIT_CLAIMS_DOC` apontando o `--doc`) e captura o count verbatim do stdout (`clean (28 claims registradas em ...)`).
2. **Suite hermética do par**: spawna o vitest de `scan-exit-claims.test.ts` (as MUTATIONs da sec 11.42/11.55) e confirma o verde — `--no-suite` pula (o caminho rápido do dry-run).
3. **Upsert datado**: monta a linha do template UTF-8 `scripts/doc-revalidate-line.txt` (fora do gate ASCII dos `scripts/*.mjs` — o MJS_GATE_PATTERNS) e faz o upsert idempotente na seção alvo (`--section`, default `8.34`): mesma data = REPLACE da entrada automática, nunca duplicata; datas diferentes coexistem; a linha manual `**Re-validação datada (` nunca colide com a automática (o marcador não tem o "datada").

**A fronteira 8.x (o guard)**: a linha gerada cita o código de saída 0 (o mesmo estilo da linha manual) — ela só é segura em seções 8.x, onde o detector do scan-exit-claims é 11.x-only por escopo (sec 11.51). O `--section` é RESTRITO a 8.x: apontar para uma seção 11.x criaria uma claim não-registrada de propósito — o guard falha no usage (código 2 de saída) antes de tocar a doc. Um `--doc` ausente e um `--date` fora de `YYYY-MM-DD` também falham no usage; CLI ou suite não-verdes falham fail-loud (código 1) sem escrever nada.

O `--date` default é a data **LOCAL** (não UTC — o nit do reviewer: `toISOString()` rolou para 2026-08-12 num doc todo datado em data local 2026-08-11; a linha gerada tem que casar com a convenção de datas das 8.x).

**O seam hermético** (padrão `HOOK_PROOF_GIT` do hook-proof-run): os comandos spawnados são via shell com override por env `DOC_REVALIDATE_CLI_CMD` / `DOC_REVALIDATE_SUITE_CMD` — os E2Es usam fakes sem rede. `--dry-run` valida tudo (CLI + suite) e só imprime — nada escrito.

**O pin**: `parseCliCount` (count + breakdown verbatim; saída de falha → null), `buildRevalidateLine` (com o template real do disco — o TEMPLATE PIN dos 5 placeholders, sem placeholder estranho), `upsertRevalidateLine` (append no fim do conteúdo da seção, idempotência por data, CRLF preservado, seção ausente → THROW) + E2E do CLI real (insert → re-run mesmo dia = 1 linha; dry-run = doc intacta; guard 8.x = código 2 de saída; CLI/suite falhos = código 1 de saída; `--date` inválido = código 2 de saída) + REAL-REPO (`--dry-run --no-suite` no doc real, o count atual 28 pinado — o BASELINE do `--check`). A suite `doc-revalidate.test.ts` entrou no `test:guard` (a 14ª; a tabela da sec 8.1 segue registrando o job com as suites do registro datado — a re-medição é avaliação separada). A linha gerada é um registro de evento 8.x — sem entrada no EXIT_CLAIMS (a fronteira da sec 11.51); esta sec 11.61 é claim-free por desenho, o count do manifest permanece 28.

**O recipe de re-uso (re-validação de uma 8.x em 30s, medido 2026-08-11)**: o ciclo que o dev roda a cada claim nova registrada:

1. **Conferência (nada escrito, ~0.4s)** — o dry-run rápido só com o CLI, para ver a linha que SERÁ gerada e o count atual:
   ```bash
   node scripts/doc-revalidate.mjs --dry-run --no-suite
   # → doc-revalidate (dry-run): secao 8.34 de .../docs/gates-proofs.md
   #   **Re-validação (2026-08-11, 28 claims)**: re-rodou o CLI real no estado atual → `clean (28 claims ...)` código 0 (verbatim) ...
   #
   # (o quote acima é PARAFRASEADO de propósito: a linha real carrega o
   # token inglês 'exit' + o número, seguro só nas 8.x - o literal criaria
   # uma claim nesta 11.x, o detector da sec 11.51 flagra)
   ```
   (sem o `--no-suite`, o dry-run também roda a suite hermética do par — o caminho completo de validação, ~40s; o `--no-suite` é o atalho de conferência)
2. **Run real (CLI + suite + upsert)** — grava a linha datada na seção alvo (default `8.34`; outra seção: `--section 8.35`):
   ```bash
   node scripts/doc-revalidate.mjs --section 8.34
   # → doc-revalidate: linha 2026-08-11 (28 claims) upsertada em '## 8.34 ' de .../docs/gates-proofs.md
   ```
   O CLI real valida o MESMO doc do `--doc` (default: o real) e a suite hermética do par precisa passar — qualquer falha é fail-loud (código 1 de saída) com NADA escrito.
3. **Re-run idempotente (mesmo dia)** — rodar o comando 2 de novo NO MESMO dia: REPLACE da entrada automática (nunca duplicata), a linha manual `datada` segue intacta. Datas diferentes coexistem (o registro histórico fica).
4. **Prova/ensaio em backup (opcional)** — para não tocar o doc real, aponte um backup:
   ```bash
   cp docs/gates-proofs.md /tmp/backup.md
   node scripts/doc-revalidate.mjs --doc /tmp/backup.md --section 8.34   # upserta no backup
   grep -c '^\*\*Re-validação (' /tmp/backup.md                          # >= 1: o upsert aconteceu (qualquer data - o --date default e a data local)
   git diff --stat docs/gates-proofs.md                                   # intocado: só o backup mudou
   rm /tmp/backup.md
   ```
   O controle pós-ciclo é o mesmo da Prova 42 (sec 8.37): `node scripts/scan-exit-claims.mjs --check` → clean + o diff do doc (só a linha datada nova).


## 11.62 ADOTADO — o PIN dos counts citados nas 8.x: o contrato `checkCitedCounts` (avaliação 2026-08-11)

O count `clean (N claims)` citado nos controles pós-ciclo das seções 8.x pode driftar do manifest — a Prova 39 provou (o controle da sec 8.34 citava 27 quando o EXIT_CLAIMS já tinha 28). O fechamento foi a re-validação datada (sec 8.34/11.61) — nunca reescrever história. O contrato `checkCitedCounts` torna a classe estrutural: **toda seção 8.x que cita counts deve, ou citar somente o count atual do manifest, ou ter uma re-validação datada** (`**Re-validação (DATE, ...)**` / `**Re-validação datada (DATE, ...)**`) — o registro sancionado que cobre os counts históricos da seção.

**A fronteira da 11.51 (a exceção sancionada)**: este é o ÚNICO scanner que lê as 8.x — e lê só CITAÇÕES de count verbatim (`clean (N claims`, o mesmo padrão do `parseCliCount` do doc-revalidate), nunca exit-code claims. O `scanDocExitClaims` segue 11.x-only (o SCOPE FRONTIER test da sec 11.51 permanece verde e intocado). A tabela resumo (## 1) está fora do escopo — os registros completos vivem nas seções 8.x; o digest é derivado.

**O wrap (o caso real)**: o controle da sec 8.34 embrulha a citação em 2 linhas físicas (`clean (27` + `claims)`). O scan junta o PARÁGRAFO (linhas consecutivas, o mesmo espírito do joinContinuations) antes de casar o regex — o 27 da sec 8.34 é pego no doc real, provando o handling de linha embrulhada.

**O loop helper+contrato**: uma claim nova no EXIT_CLAIMS faz o `checkCitedCounts` falhar nas seções 8.x sem re-validação que citam o count antigo (hoje: a 8.35, 28→29) — o fechamento é `node scripts/doc-revalidate.mjs --section 8.35` (a linha datada cobre a seção). O contrato e o helper formam o ciclo: drift → falha → re-validação → coberto.

**O pin**: `scanCitedCounts` (por seção: `{section, hasReval, counts}`, paragraph-flattened — o marcador datado seta `hasReval` mesmo sem citações no parágrafo) + `checkCitedCounts` (violações = seções sem re-validação citando count ≠ atual, default `EXIT_CLAIMS.length`). Testes: REAL-REPO (a 8.34 com `hasReval` + os counts `[27, 28]` — o wrap provado no doc real; a 8.35 sem re-validação com `[28]`, o pin do count atual — muda de propósito a cada claim; `checkCitedCounts(DOC)` → `[]`) + 4 MUTATIONs herméticas (drift sem re-validação → violação; re-validação datada EXIME; `**Re-validação**:` sem data NÃO exime; citação embrulhada pega) + a FRONTEIRA verbatim vs narrativa (o par prosa-livre/verbatim). O count do manifest permanece 28 — a 11.62 é claim-free por desenho (sem tokens de código de saída, a fronteira da sec 11.51/11.42).

**Fronteira verbatim vs narrativa (a varredura ampla 2026-08-11)**: o scanner desta seção lê UM único token — a citação verbatim do stdout do CLI, `clean (N claims` (o `CLEAN_COUNT_RE`) — em qualquer parágrafo da seção 8.x. Prosa narrativa que cita counts históricos em linguagem natural (ex.: a re-validação da 8.34 narrando que o controle 'foi capturado com o manifest em 27 claims' — L2796) NÃO casa o token e é LIVRE por desenho: registro histórico do evento, não contract. Um leitor nunca deve tratar essa prosa como drift — só a forma verbatim do CLI é verificada. O pin da fronteira é o par na suite: a prosa não gera record no `scanCitedCounts` e o MESMO número na forma `clean (27 claims` viola sem re-validação. Se uma re-validação futura precisar narrar um count antigo, escreva em prosa natural; se precisar citá-lo como contract, use a forma exata do CLI.

## 11.63 ADOTADO — o guard do push exige a recalibração das 8.x: o loop registro+recalibração fechado no push (avaliação 2026-08-11)

A 28ª claim (a 11.58) nasceu no commit da 11.58 (registro no EXIT_CLAIMS), mas a re-validação datada da 8.34 foi feita num commit SEPARADO — a janela onde o manifest tinha 28 claims e os controles 8.x ainda citavam 27: o push passava (as claims estavam registradas) e só o CI/PR pegaria o drift (o `checkCitedCounts` da sec 11.62 roda no vitest, depois do push). O `check-exit-claims-push` agora fecha a janela NO MOMENTO DO PUSH: além da direção única `.unregistered` (sec 11.49, inalterada), o guard roda o `checkCitedCounts` da sec 11.62 contra o MESMO doc commitado — uma claim nova registrada SEM a re-validação datada nas seções 8.x afetadas bloqueia o push.

**O comportamento**: o guard materializa o doc de HEAD (git show), roda o `.unregistered` (a sec 11.49) e, se limpo, o `checkCitedCounts` (a sec 11.62). Violação → bloqueio (código 1 de saída) com o bloco:

```
exit-claims-push: N secao(oes) 8.x com count de claims desatualizado no doc COMMITADO (HEAD) - sec 11.62/11.63:
  secao 8.35 cita [28] com o EXIT_CLAIMS em 29: node scripts/doc-revalidate.mjs --section 8.35 (a linha datada cobre os counts historicos da secao - sec 11.63)
```

A CURE por seção é o `doc-revalidate --section 8.N` (a sec 11.61) — o loop fecha: claim nova → push bloqueado → `node scripts/doc-revalidate.mjs --section 8.N` → coberto → push passa. O registro (a claim no EXIT_CLAIMS) e a recalibração (a re-validação datada) passam a ser exigidos no MESMO push.

**O escopo (o que NÃO muda)**: a direção única `.unregistered` continua sendo a classe principal do guard (sec 11.49 — o stale segue ruído de delta); o check 8.x é a SEGUNDA dimensão do MESMO doc commitado (a recalibração, não o registro). O custo é desprezível (o scan da sec 11.62 é ~ms sobre o doc já materializado — o guard mede ~0.44s no total, o veredito 'pre-push não batchado' da 11.17 permanece). As camadas: batch do pre-commit + test:unit cobrem a working tree; o guard cobre o estado COMMITADO — complementares.

**O pin**: `citedOf` (o espelho do `unregisteredOf` — o helper `withTempDoc` compartilhado + o `checkCitedCounts` real da sec 11.62) + o bloco de falha no main + 2 MUTATIONs do CLI real (doc com 8.99 citando count antigo e a claim 11.42 registrada → código 1 de saída com a secao exata + a CURE por secao; doc com a 8.99 calibrada no count atual → código 0 de saída) + o REAL-REPO existente (o doc real → código 0 de saída — a 8.34 coberta, a 8.35 calibrada; o pin vivo exige o doc COMMITADO calibrado — um commit que esconda a recalibração quebraria o teste). O count do manifest permanece 28 — a 11.63 é claim-free por desenho (sem tokens de código de saída; o bloco citado usa só a frase "código de saída" no fechamento).

**Sweep completo das 8.x (2026-08-11)** — a resposta à avaliação "a 8.34 era a única?": NÃO — a 8.35 (Prova 40) também cita `clean (28 claims)`. Mas a varredura autoritativa (`scanCitedCounts` + `checkCitedCounts` no repo real) confirmou que **NENHUMA recalibração é necessária**: a 8.34 está coberta pela re-validação datada (counts `[27 histórico embrulhado, 28 atual]`) e a 8.35 cita o count ATUAL (28, o pin que muda de propósito a cada claim); `checkCitedCounts(DOC)` → `[]` — as demais 8.x (8.1–8.33) não citam counts de claims (a varredura ampla de `N claims` nas 8.x achou só a re-validação da 8.34, a narrativa histórica "27 claims" dela e o controle da 8.35).OBSERVAÇÃO: a tabela resumo (## 1) cita o count histórico 27 no registro da Prova 39 (linha 38 da tabela) — fora do escopo da 11.62 por desenho (digest derivado dos registros completos das 8.x; reescrevê-lo violaria o princípio de nunca reescrever história — o registro da 8.34 está coberto pela re-validação datada, o digest aponta para a seção calibrada).


## 11.64 RECUSADO — o teste de forma da matriz de fail-loud do hook-proof-run: os E2Es individuais bastam, com a fronteira da infra nomeada (avaliação 2026-08-11)

**Pedido**: o hook-proof-run agora tem 3 E2Es de fail-loud (seção
inexistente, colisão de target, no-op — sec 11.59). Avaliar se a matriz de
fail-loud do helper merece um teste de forma que derive os fail paths do
planSteps/parseArgs — ou documentar por que os E2Es individuais bastam.

**O veredito (RECUSADO — documentar por que os E2Es individuais bastam)**:
a medição da superfície real decide contra o teste de forma, com 4 fatos:

(a) **O planSteps NÃO contém fail paths** (a premissa da derivação falha na
fonte): o planSteps (linhas 267-305 do hook-proof-run.mjs) é o plano do
HAPPY PATH do dry-run — backup → scratch → delta → mutação → shas → hook →
verify → revert. Zero branches de falha — não há o que derivar. Os fail
paths vivem no main() (os `fail()` de infra), no renumberDocSection (os
THROWs) e no parseArgs (os `out.error`), não no plano.

(b) **Os fail paths do parseArgs já estão 100% pinados**: o describe
parseArgs tem 12 testes cobrindo TODOS os `out.error` (usage, flag
desconhecida, --help, as 3 mutações mutuamente exclusivas, --to sem
renumber, renumber sem --to, shape não-seção do --to, o tripwire sed+`## `
e o escape hatch yml). Um teste de forma que derivasse do parseArgs
duplicaria o que já existe — a regra dos TARGET_DIRS não se aplica a um
describe que já enumera cada branch.

(c) **A classe fail-loud do pedido (a THROW do renumber) está pinada nas
DUAS granulações**: pura (os 5 testes do renumberDocSection incl. os 3
THROWs — sec 11.59) + E2E (os 3 testes que provam a conversão real no
main(): o try/catch que transforma o THROW em código de saída 3 — o E2E é
o ÚNICO grão que prova o CLI real, e ele já existe).

(d) **A fronteira honesta — a infra NÃO é fail-loud pinada, e não pode ser
com o fixture atual**: os fail paths de infra do main() (git rev-parse /
diff / ls-files / checkout falharam, os commits do delta e da mutação
falharam, doc não encontrado, --mutate falhou, revert não-ok) não têm
E2E — e o fixture hook-proof-fake-bins.mjs
NÃO tem knobs de falha de git (zero HOOK_PROOF_FAKE_*_FAIL no fixture):
simulá-los exigiria cirurgia de fixture, não um teste de forma. Além
disso, são toolchain failure — a falha de git é barulhenta por natureza, a
antítese do "no-op silencioso" que a sec 8.14 trava (a classe que os E2Es
cobrem). Se um dia a rede quiser pinar a infra, o trabalho é adicionar
knobs de falha ao fixture, não um teste de forma derivado do plano.

**O pin**: este registro é claim-free (sem tokens de código de saída — o
describe parseArgs com 12 testes + os 3 E2Es de fail-loud existentes são o
pin da decisão; nenhum código novo). O EXIT_CLAIMS segue sem entrada 11.64
(claim-free por desenho: decisão de cobertura de teste, não claim de exit
code — o mesmo padrão da 11.56/11.57).

**Re-validação**: `npx vitest run
scripts/__tests__/hook-proof-run.test.ts scripts/__tests__/scan-exit-claims.test.ts
--config vitest.config.unit.ts` (a suite lê a doc real — a 11.64 não pode
vazar claim) + `node scripts/scan-exit-claims.mjs --check` (clean) +
`gates-proofs-ordering.test.ts` valida a monotonia 11.63 → 11.64 → 12 +
UTF-8 do doc OK.


## 11.65 ADOTADO — o guard de forma da `scratchLeftNote`: todo fail-loud pos-scratch do hook-proof-run termina com a nota de limpeza (avaliação 2026-08-11)

**Pedido**: o renumberDocSection agora tem 3 THROWs (seção ausente, colisão,
no-op — sec 11.59) e a Prova 41 (sec 8.36) provou ao vivo que o fail(3) da
mutação NÃO roda o revertCycle — o usuário fica na scratch com a receita de
saída no stdout (o `scratchLeftNote`). Avaliar se o scan-eol-anchor ou um
guard de forma deveria pinar que TODO fail-loud do helper termina com a
nota de limpeza — a classe do fail silencioso (um fail path que deixa o
usuário na scratch SEM dizer como sair).

**O veredito (ADOTADO — um guard de forma, NÃO o scan-eol-anchor)**: o
scan-eol-anchor é a classe errada (âncoras de newline em gate files, sec
11.37) — o invariante aqui é estrutural do helper, e o grão certo é o guard
de forma no padrão dos TARGET_DIRS/fatos consumidos: **derivar os fail
sites do SOURCE real** (toda `return fail(` com a linha) e pinar a fronteira:

- **PRE-checkout-b** (parse/namespace/rev-parse/diff/ls-files/checkout-
fail): a scratch NUNCA existiu — a nota NÃO deve aparecer (seria ruído).
- **POS-checkout-b** (delta commit, doc ausente, renumber THROW ×3,
`--mutate` fail, mutation commit, **revert-fail**): o usuário PODE ter
ficado na scratch — a nota DEVE terminar o fail (a receita `git checkout
<original> && git branch -D <scratch>` + o backup).

**O GAP que a medição achou (o fix)**: o **revert-fail** (o fail do
revertCycle, linha ~492) era o ÚNICO fail path pos-scratch SEM a nota — o
`reverted.message` cita o backup mas NÃO a receita de saída (o revertCycle
pode ter falhado no checkout/branch -D/apply, deixando o usuário na
scratch OU com a árvore parcial — a mesma classe do fail silencioso).
Corrigido: o revert-fail agora anexa o `scratchLeftNote` (sec 11.65),
fechando o gap que o guard de forma pina.

**O pin (4 testes novos no hook-proof-run.test.ts)**: (1) todo fail path
POS-checkout-b termina com a nota (derivação do source, a fronteira textual
exata `git(["checkout", "-b", opts.branch])` — sem número mágico de
linha); (2) nenhum fail path PRE-checkout-b tem a nota (a fronteira
oposta); (3) MUTATION: remover a nota do revert-fail → o guard flagra a
linha (`reverted.message` sem a nota); (4) MUTATION: adicionar a nota ao
checkout-fail → o guard flagra (a nota só é legítima pos-scratch). O
scan-eol-anchor segue sem mudança — a classe dele (âncoras) é ortogonal.

**O pin da doc**: este registro é claim-free (sem tokens de código de saída
— o guard de forma deriva do source, nunca de claims de exit code; o
EXIT_CLAIMS segue sem entrada 11.65).

**Re-validação**: `npx vitest run
scripts/__tests__/hook-proof-run.test.ts scripts/__tests__/scan-timeouts.test.ts
--config vitest.config.unit.ts` (a suite do helper, agora com o guard de
forma) + `node scripts/scan-exit-claims.mjs --check` (clean) +
`gates-proofs-ordering.test.ts` valida a monotonia 11.64 → 11.65 → 12 +
UTF-8 do doc + ASCII do gate file OK.


## 11.66 ADOTADO — o TRIPWIRE do esquecimento do doc-revalidate: a re-validação datada das 8.x precisa citar o count ATUAL do EXIT_CLAIMS (avaliação 2026-08-11)

**O pedido**: a re-validação manual da sec 8.34 virou helper (sec 11.61),
mas nada impede o dev de esquecer de rodá-lo quando o EXIT_CLAIMS ganha
claim nova. A avaliação pede um guard barato (padrão tripwire) que falhe
no pre-commit quando o manifest crescer e a 8.34 não tiver re-validação
datada com o count novo.

**O gap medido (o que motivou o ADOTADO)**: o `checkCitedCounts` da sec
11.62 EXIME seções com re-validação datada (counts históricos sancionados
— o mecanismo da 8.34) — mas essa exceção NUNCA fica stale. Probe
2026-08-11: com o manifest em 28 e a reval da 8.34 citando 28,
`checkCitedCounts(doc, 29) = []` — uma claim nova (29ª) registrada SEM
re-validar a 8.34 não é flagrada por NENHUMA das redes: nem no pre-commit
(o batch roda só o `exitClaimsMain`, que não vê a dimensão 8.x), NEM no
push (o `checkCitedCounts` do 11.63 exime por ter reval — um furo real do
loop registro+recalibração fechado na 11.63). A classe: 'o esquecimento
silencioso do doc-revalidate'.

**A decisão (ADOTADO — barato, scan puro do doc já materializado, ~ms)**:
novas funções `scanRevalCounts` (por seção 8.x, os counts citados nas
linhas de re-validação datada — `**Re-validação (DATE, N claims)**` e a
manual `datada`) e `checkRevalCurrent` (a reval precisa citar o count
ATUAL do manifest, default `EXIT_CLAIMS.length`) no `scan-exit-claims.mjs`
+ 2 pontos de wiring:
1. **Pre-commit** — `exitClaimsMain()` (o CLI `--check`) ganha a dimensão:
   reval stale → código 1 de saída com a CURE por seção. O batch runner
do pre-commit já chama o `exitClaimsMain` (8º guard) → o tripwire roda
sem novo guard no hook.
2. **Push** — `check-exit-claims-push.mjs` ganha o `revalOf` (o espelho do
   `citedOf`): fecha o furo do 11.63 — uma claim nova com a reval citando
   o count antigo NÃO passa mais pelo push (o `--no-verify`/`HUSKY=0`
   não esconde a classe).

**A CURE (o caminho de cura, o mesmo da 11.63)**: `node
scripts/doc-revalidate.mjs --section 8.34` — o helper da sec 11.61
re-gera a linha datada com o count novo (idempotente por data, o recipe
da 11.61). Para outra seção 8.x: `--section 8.N`.

**O pin (4 testes novos)**: describe `8.x REVAL CURRENT PIN` no
`scan-exit-claims.test.ts` (REAL-REPO: a reval da 8.34 cita o count atual
28 — o pin vivo que muda de propósito a cada claim; MUTATION: reval
citando 27 com manifest 28 → violação; reval no count atual → limpo; a
linha manual `datada` TAMBÉM é contada — o prefixo opcional do marcador;
REAL-REPO CONTRACT do CLI com `EXIT_CLAIMS_DOC` → código 1 com a seção
exata e a CURE) + `revalOf` no `check-exit-claims-push.test.ts` (puro +
REAL-REPO CONTRACT: o furo do 11.63 fechado — a reval stale derruba o
push com código 1 de saída) + teste de batch no `run-precommit-guards.test.ts` (o
exit-claims surface a dimensão no stderr agregado, os outros 7 guards
clean — o mesmo padrão do teste da sec 11.57).

Esta sec 11.66 é claim-free por desenho (fronteira da sec 11.51; o guard
não muda o contrato de exit do CLI — só adiciona uma dimensão de falha à
classe que a 11.42 já pina com 'violações listadas') — sem entrada no
EXIT_CLAIMS, o count do manifest permanece 28.

**Re-validação**: `npx vitest run
scripts/__tests__/scan-exit-claims.test.ts scripts/__tests__/check-exit-claims-push.test.ts
scripts/__tests__/run-precommit-guards.test.ts --config vitest.config.unit.ts`
+ `node scripts/scan-exit-claims.mjs --check` (clean) +
`gates-proofs-ordering.test.ts` valida a monotonia 11.65 → 11.66 → 12 +
UTF-8 do doc + ASCII dos gate files OK.

## 11.67 ADOTADO — o PIN dos counts citados na TABELA ## 1: o contrato `checkDigestCounts` (avaliação 2026-08-11)

**A avaliação**: a varredura provou que a 8.34 e a 8.35 são as únicas
seções 8.x com counts citados, mas a tabela resumo (`## 1`) TAMBÉM cita
counts históricos verbatim — a row 38 (Prova 39, origem sec 8.34) cita
`clean (27 claims` e a row 39 (Prova 40, origem sec 8.35) cita `clean
(28 claims`. O `checkCitedCounts` da sec 11.62 só varre as seções 8.x — a
tabela era o ÚLTIMO ponto cego da superfície: uma claim nova registrada
no EXIT_CLAIMS deixaria o digest citando o count antigo para sempre, sem
contrato pegando (nem no pre-commit — o batch roda só o `exitClaimsMain`
— nem no push — o 11.63 não vê a tabela).

**A regra (espelha a 11.62 com a ORIGEM)**: `checkDigestCounts` só flagra
uma row da tabela se (a) algum count citado DIVERGE do count atual do
manifest E (b) a seção de ORIGEM da row (a primeira referência `sec 8.N`
no texto da row — a convenção "(Prova N, sec 8.M;" do título) NÃO está
coberta por re-validação datada (o mesmo sancionamento da 11.62). Uma row
com count divergente SEM referência de seção de origem é fail-loud (a
origem não é verificável — `section: null`). O count ATUAL citado nunca
viola, mesmo sem reval na origem.

**A calibração (o doc real)**: `checkDigestCounts(DOC)` → `[]` — a row 38
cita o 27 histórico e a origem 8.34 TEM reval datada (28) → coberta; a
row 39 cita o count atual (28) → nunca viola. O contrato nasce calibrado
no número certo, sem falso-positivo.

**A CURE (o mesmo caminho da 11.63/11.66)**: `node
scripts/doc-revalidate.mjs --section 8.N` — re-validar a seção de ORIGEM
da row (a linha datada cobre os counts históricos). Para a row sem
referência de origem: adicionar a referência `sec 8.N` na row (a
cobertura passa a ser verificável).

**O pin (10 testes novos)**: describe `DIGEST TABLE PIN` no
`scan-exit-claims.test.ts` (REAL-REPO: as rows 38/39 com as origens
8.34/8.35 e os counts [27]/[28]; `checkDigestCounts(DOC)` → `[]` — o pin
vivo do par; MUTATION: row citando count antigo com origem SEM reval →
violação `{row, section, counts}`; a reval datada na origem EXIME; o
count atual nunca viola; row sem referência de seção → fail-loud
`section: null`; REAL-REPO CONTRACT do CLI com `EXIT_CLAIMS_DOC` →
código 1 de saída com a row exata e a CURE) + `digestOf` no
`check-exit-claims-push.test.ts` (puro: violação com a row exata;
count atual → limpo; REAL-REPO CONTRACT: o guard do push fecha o ponto
cego com a CURE doc-revalidate --section) + teste de batch no
`run-precommit-guards.test.ts` (o exit-claims surface a dimensão no
stderr agregado, os outros 7 guards clean — o mesmo padrão da sec 11.57).

Esta sec 11.67 é claim-free por desenho (fronteira da sec 11.51; a
leitura do digest não é claim de exit-code — é count de evento, o mesmo
papel da 11.62) — sem entrada no EXIT_CLAIMS, o count do manifest
permanece 28.

**Re-validação**: `npx vitest run
scripts/__tests__/scan-exit-claims.test.ts
scripts/__tests__/check-exit-claims-push.test.ts
scripts/__tests__/run-precommit-guards.test.ts --config
vitest.config.unit.ts` + `node scripts/scan-exit-claims.mjs --check`
(clean) + `node scripts/check-exit-claims-push.mjs` (clean) +
`gates-proofs-ordering.test.ts` valida a monotonia 11.66 → 11.67 → 12 +
UTF-8 do doc + ASCII dos gate files OK.

## 11.68 ADOTADO — o `--sweep` read-only do doc-revalidate: a varredura das seções 8.x que precisam de re-validação (avaliação 2026-08-11)

**A avaliação**: o sweep manual (rodar os scans + documentar) vivia fora de
comando — o próximo dev re-derivava o ciclo. O `doc-revalidate` já tinha o
caminho de ESCRITA (sec 11.61) mas não o de LEITURA da lista completa: o
contrato de counts (11.62/11.66/11.67) tem 3 dimensões e cada uma precisa
ser rodada para saber QUAIS seções exigem re-validação hoje.

**A regra**: `node scripts/doc-revalidate.mjs --sweep [--doc <path>]` roda as
3 dimensões REAIS do contrato de counts como funções puras importadas do
`scan-exit-claims.mjs` (sem subprocesso, ~ms) — `checkCitedCounts` (11.62:
seção sem re-validação datada citando count ≠ atual), `checkRevalCurrent`
(11.66: reval datada citando count antigo) e `checkDigestCounts` (11.67:
rows da tabela ## 1 com count ≠ atual e origem descoberta) — e imprime a
lista com a CURE por seção (`node scripts/doc-revalidate.mjs --section
8.N`), no padrão `--check` dos guards: **código 0 de saída = limpo**
(nenhuma seção precisa) / **código 1 de saída = violações listadas**. O
modo é read-only como o `--dry-run`: NADA é escrito. `--sweep` NÃO combina com
`--section/--date/--dry-run/--no-suite` (fail-loud no usage — a varredura
cobre TODAS as seções; a combinação é contraditória).

**A calibração (o doc real)**: `--sweep` no doc real → código 0 de saída
`clean` — as 3 dimensões verificam o doc atual (a 8.34 coberta pela reval
datada, a 8.35 no count atual, o digest calibrado) — o pino vivo: uma
claim nova registrada SEM a re-validação correspondente quebraria este
teste.

**O pin (6 testes novos)**: describe `SWEEP read-only` no
`doc-revalidate.test.ts` (REAL-REPO CONTRACT do CLI: `--sweep` no doc real
→ código 0 de saída clean; 3 MUTATIONs — seção 8.99 citando count antigo
sem reval → código 1 de saída com a seção exata + a CURE + `sec 11.62`;
reval datada citando count antigo → código 1 de saída com a CURE + `sec
11.66`; row 99 da tabela com origem descoberta → código 1 de saída com a
row exata + a CURE + `sec 11.67`; row SEM referência de origem → o
fail-loud `SEM referencia` do branch section:null) + 2 parseArgs
(`--sweep` reconhecida; a combinação com
`--section/--date/--dry-run/--no-suite` falha no usage).

Esta sec 11.68 é claim-free por desenho (fronteira da sec 11.51; o sweep
não muda o contrato de exit do CLI — reusa as dimensões já pinadas das
11.62/11.66/11.67) — sem entrada no EXIT_CLAIMS, o count do manifest
permanece 28.

**Re-validação**: `npx vitest run
scripts/__tests__/doc-revalidate.test.ts
scripts/__tests__/scan-exit-claims.test.ts --config vitest.config.unit.ts`
+ `node scripts/doc-revalidate.mjs --sweep` (clean) +
`gates-proofs-ordering.test.ts` valida a monotonia 11.67 → 11.68 → 12 +
UTF-8 do doc + ASCII dos gate files OK.

## 11.69 hook-proof-run --cleanup-on-fail: o ACHADO da Prova 41 fechado estruturalmente (ADOTADO 2026-08-11)

**O ACHADO (Prova 41, sec 8.36)**: o fail(3) da MUTACAO do hook-proof-run NAO roda o revertCycle — a scratch fica (com a scratchLeftNote da receita manual) e a limpeza manual precisa LEMBRAR de restaurar os untracked do byte-copy (a etapa que o `git add -A` do commit do delta engole) + o doc do byte-copy + o checkout original + branch -D. O ciclo manual da Prova 41 re-derivou isso linha a linha (9 untracked no caso da prova).

**A decisao (ADOTADO — barato, reusa o revertCycle exportado)**: a flag `--cleanup-on-fail` faz os 6 fail paths POS-scratch de infra (delta commit, doc ausente do claim/renumber, renumber THROW, --mutate shell fail, mutation commit — todos os fail(3) pos-scratch da cadeia de mutacao) rodarem o revertCycle ANTES do fail — a scratch NAO fica e as etapas do byte-copy (untracked restaurados + doc do byte-copy + status identico ao snapshot) sao feitas pelo MESMO codigo do revert normal (a fonte unica da restauracao, nunca uma copia manual). O revert-fail (o revertCycle ja rodou e falhou) NAO e retentado pela flag — o retry seria circular; a nota de saida continua. Um revertCycle que falha no cleanup-on-fail e reportado JUNTO com a nota (o usuario pode ter ficado na scratch — a receita nunca pode faltar, o espirito da sec 11.65).

**O pin (4 testes novos no hook-proof-run.test.ts)**: parseArgs (a flag parseia, default false) + planSteps (o plano cita a flag) + o par E2E contrafactual do caminho do hook: --mutate shell FALHA com --cleanup-on-fail -> codigo 3 de saida E o revertCycle rodou (checkout base + branch -D no invocations.log — a scratch nao fica); a MESMA mutacao SEM a flag -> codigo 3 de saida COM a scratchLeftNote e SEM revertCycle (a classe aberta, limpeza manual). O guard de forma da sec 11.65 permanece intocado (a scratchLeftNote continua literal em todo fail(3) POS — o ternary mantem o token).

Esta sec 11.69 e claim-free por desenho (a flag NAO muda o contrato de codigos de saida 0-3 da sec 11.58 — so o ESTADO pos-fail muda) — sem entrada no EXIT_CLAIMS, o count do manifest permanece 28.

**Re-validação**: `npx vitest run scripts/__tests__/hook-proof-run.test.ts scripts/__tests__/scan-exit-claims.test.ts scripts/__tests__/gates-proofs-ordering.test.ts --config vitest.config.unit.ts` + `node scripts/scan-exit-claims.mjs --check` (clean 28 claims) + ASCII do .mjs + UTF-8 do doc + ordering 11.68 → 11.69 → 12 monotono.


## 11.70 ADOTADO — o guard de forma do `stashLeftNote`: todo fail path pos-stash do ci-proof-run termina com a nota (ou com o revert que a torna desnecessaria) (avaliação 2026-08-12)

**Pedido**: o guard de forma da sec 11.65 deriva os fail sites do
hook-proof-run.mjs e pina que todo fail-loud pos-scratch termina com a
`scratchLeftNote`. O MESMO invariante existe no ci-proof-run.mjs — o
`stashLeftNote` da sec 11.41 (o aviso "o delta nao-commitado segue no stash
(git stash pop para restaurar)"). Avaliar um guard irmao que pince que todo
fail path pos-scratch do ci-proof-run termina com a nota, fechando a classe
nos DOIS helpers de prova.

**O veredito (ADOTADO — o guard irmao, no padrao da sec 11.65, com a
fronteira HONESTA do ci-proof-run)**: no hook-proof-run a fronteira e o
checkout -b (a scratch nasce ali e a nota de saida protege o usuario que
fica nela). No ci-proof-run o STASH precede o checkout (etapa 3 antes da
etapa 4) — a nota protege o DELTA no stash, nao a scratch. A fronteira do
guard irmao e o inicio da ETAPA 4 (a linha `// 4. Cria/entra na branch
scratch.` — o fim do guard da arvore suja). NAO pode ser o `stashedDelta =
true` (que fica DENTRO do if do stash, ANTES do else-fail da arvore suja):
aquele fail e semanticamente PRE — o stash NUNCA foi tomado no caminho do
else (a nota seria ruido) — mas cairia depois da ancora no source e o
guard o exigiria a toa (o off-by-branch que o vitest pegou na 1a rodada):

- **PRE-stash** (parse, namespace, rev-parse, stash-push-fail, tree-dirty):
  o delta NUNCA esteve no stash — a nota NAO deve aparecer (seria ruido; o
  stash-push-fail INCLUSIVE: o stash falhou, nao ha delta a restaurar).
- **POS-stash pre-revert** (checkout, checkout -b, mutate, self-delete,
  local-block x2, commit, push): todo fail(3) infra que NAO chamou o
  revert antes DEVE terminar com a nota CONDICIONAL
  `${stashedDelta ? stashLeftNote : ""}` — a condicao e a honestidade do
  shape: a nota so vale quando o stash foi tomado (arvore suja +
  --stash-uncommitted); uma nota incondicional mentiria num ciclo de
  arvore limpa.
- **A excecao revert-first** (gh view ENOENT/view, gh run, job nao
  encontrado, timeouts x3): esses fail paths chamam `revert()` ANTES do
  fail — o revert faz o `git stash pop <ref>` (secs 11.41/11.44) e o delta
  JA foi restaurado — a nota NAO deve aparecer (seria ruido). O par fecha
  a classe dos DOIS lados: sem nota onde o delta esta seguro, com nota
  onde ele segue preso.

**O pin (4 testes novos no ci-proof-run.test.ts, o espelho da sec 11.65)**:
derivacao dos fail sites do SOURCE real (a linha do `return fail(` + o span
das 5 linhas seguintes, cobrindo os fail paths MULTI-LINHA — self-delete e
local-block poem a mensagem nas linhas seguintes e um filtro em linha unica
nao as pegaria), a fronteira por ancora (o comentario `// 4. Cria/entra na
branch scratch.` — ausente = o guard fica cego e THROW), o split PRE/POS
com a excecao revert-first (o revert nas 8 linhas acima do site), e o par
MUTATION: remover a nota do push-fail -> 1 offender (a classe nao volta);
adicionar a nota ao rev-parse-fail (PRE) -> 1 offender (a nota so e
legitima pos-stash).

Esta sec 11.70 e claim-free por desenho (o guard de forma NAO muda o
contrato de codigos de saida 0-3 da sec 11.41 — so pina a FORMA da
mensagem de erro) — sem entrada no EXIT_CLAIMS, o count do manifest
permanece 28.

**Re-validação**: `npx vitest run scripts/__tests__/ci-proof-run.test.ts scripts/__tests__/gates-proofs-ordering.test.ts scripts/__tests__/scan-exit-claims.test.ts --config vitest.config.unit.ts` + `node scripts/scan-exit-claims.mjs --check` (clean 28 claims) + ASCII do .mjs + UTF-8 do doc + ordering 11.69 → 11.70 → 12 monotono.


## 11.71 ADOTADO — o envelope do revertCycle cobre os 4 fail paths internos: a receita e do chamador, nunca duplicada (avaliação 2026-08-12)

**Pedido**: o fix da 11.65 anexou a `scratchLeftNote` no revert-fail
EXTERNO, mas o `revertCycle` tem 4 fail paths internos (checkout, branch
-D, apply, status divergente) que citam so o backup — avaliar se cada fail
interno deveria citar a receita completa ou se a nota no fail(3) externo
basta (o envelope cobre).

**O veredito (ADOTADO — o envelope basta, e a nota é FONTE ÚNICA)**:

- **Os 2 pontos de conversão cobrem todo `{ ok: false }`**: o revert-fail
  (a linha ~529, pinada pelo guard 11.65) e o `cleanupOnFailSuffix` (a
  linha ~365, o caminho `--cleanup-on-fail` da 11.69) anexam AMBOS o
  `scratchLeftNote` ao message do revertCycle. Nenhum fail do revertCycle
  chega ao usuário sem a receita — o envelope cobre.
- **Duplicar a receita nos internos seria pior**: criaria 4 cópias do
  template + citação dupla nos envelopes (o interno citaria E o envelope
  repetiria). A fonte única é o `scratchLeftNote`, anexado só na conversão.
- **Os internos estão corretamente escopados**: reportam a causa específica
  (qual passo git falhou + stderr) + o backup — e o backup é a informação
  ACIONÁVEL (o ACHADO da Prova 43, sec 8.38: o branch -D roda ANTES do
  apply, então a receita genérica do template pode nem casar o estado real
  — o que salva é o backup apontado, que os internos já citam).

**O residual honesto (o que o guard fecha)**: o acoplamento envelope é
convenção, não contrato — o `revertCycle` é exportado e um 3º call site
futuro poderia engolir o `{ ok: false }` sem a nota (a classe do fail
silencioso, o espírito da 11.65). O guard 11.65 deriva `return fail(` — os
`return { ok: false` internos e o envelope do `cleanupOnFailSuffix` ficam
fora dele. O guard de forma da 11.71 (no padrão TARGET_DIRS/fatos
consumidos) deriva os CALL SITES do `revertCycle` do source real (excluída
a definição) e pina:

- os 4 fail paths internos citam `backup em` mas NUNCA a `scratchLeftNote`
  (a receita é do envelope — a decisão travada contra um refactor que
  mova a nota para dentro);
- TODO call site (pinned count = 2: o cleanupOnFailSuffix em ~363 e o
  revert normal em ~522, com o fail em ~529) tem a nota dentro do bloco de
  conversão — um 3º chamador exige edição consciente (com envelope =
  atualiza o count; sem envelope = o guard falha).

**O pin (3 testes novos no hook-proof-run.test.ts)**: internos (4+ sites
com backup e sem nota) + call sites (count exato 2 + envelope em cada) + a
MUTATION do `cleanupOnFailSuffix` (remover a nota do envelope → 1 offender
em 363 — o ponto de conversão que o guard 11.65 não alcançava).

Esta sec 11.71 é claim-free por desenho (o guard de forma NÃO muda o
contrato de códigos de saída — só pina a FORMA da mensagem de erro) — sem
entrada no EXIT_CLAIMS, o count do manifest permanece 28.

**Re-validação**: `npx vitest run scripts/__tests__/hook-proof-run.test.ts scripts/__tests__/gates-proofs-ordering.test.ts scripts/__tests__/scan-exit-claims.test.ts --config vitest.config.unit.ts` + `node scripts/scan-exit-claims.mjs --check` (clean 28 claims) + ASCII do .ts + UTF-8 do doc + ordering 11.70 → 11.71 → 12 monotono.


## 11.72 ADOTADO — o guard dos guards de prova: TODO helper (hook-proof-run + ci-proof-run) tem as 3 partes do contrato de fail-loud (avaliação 2026-08-12)

> **Nota (2026-08-12, sec 11.79)**: a FONTE do manifest `PROOF_HELPERS`
> foi invertida — a lista hardcoded virou derivação do package.json (todos
> os scripts `*-proof:run`) com pin no CONTENT derivado. Esta sec 11.72
> permanece como a casa das 3 partes do contrato de fail-loud.

**Pedido**: o guard de forma da 11.65 (scratchLeftNote do hook-proof-run) e
o da 11.70 (stashLeftNote do ci-proof-run) derivam cada um do source do
SEU helper, e o ABS PIN do proofs-manifest deriva do manifest — mas nada
pina que TODO helper de prova tem as 3 partes do contrato de fail-loud:
(1) exit codes documentados, (2) nota de limpeza definida, (3) E2E do
caminho. Avaliar um teste de forma que pince as 3 partes para os DOIS
helpers — o guard dos guards de prova.

**O veredito (ADOTADO — uma suite de contrato dedicada, sec 11.72)**: a
medição confirmou que os 2 helpers têm as 3 partes HOJE:

1. **Exit codes documentados**: ambos os docblocks têm a seção `Exit
   codes: 0 = ... 1 = ... 2 = ... 3 = ...` (hook-proof-run.mjs:~63,
   ci-proof-run.mjs:~120) — o contrato de saída nunca vive só no código.
2. **Nota de limpeza definida**: `scratchLeftNote` (hook, a 11.65) e
   `stashLeftNote` (ci, a 11.70) — as notas que os guards de forma
   consomem (a classe do fail silencioso).
3. **E2E do caminho**: as duas suítes têm E2Es herméticos que rodam o CLI
   REAL com bins fake (HOOK_PROOF_GIT / CI_PROOF_GIT+GH) e asserem exit
   nao-zero (hook: 8 asserts `.toBe(1|2|3)`; ci: 21 asserts via
   `result.status` — o caminho do fail-loud exercitado, não só descrito em
   prosa).

**O pin (5 testes na nova suite `proof-helpers-contract.test.ts`, no
padrão TARGET_DIRS/fatos consumidos)**: o manifesto `PROOF_HELPERS` (a
lista é o pin do escopo: adicionar um 3º helper exige entrar aqui) + as 3
partes assertadas para cada entrada (docblock 0-3 via regex /s, nota
`\w+LeftNote = (`|`"`, seam de bins fake + assert de exit nao-zero) + o
lado inverso do crescimento (o padrão do WIRED SURFACE da 11.60): os
helpers wired no package.json (os scripts `*-proof:run` — hoje
ci-proof:run + hook-proof:run) DEVEM estar no manifesto, com igualdade
nos dois sentidos — um helper novo wired sem entrar na lista falha, e uma
entrada do manifesto sem as 3 partes (ou sem os arquivos) também. As 3
MUTATIONs provam a sensibilidade: remover a nota do ci → flagra; remover o
`3 = falha` do docblock do hook → flagra; remover o seam de bins fake do
ci.test.ts → flagra.

Esta sec 11.72 é claim-free por desenho (o guard de forma NÃO muda o
contrato de códigos de saída — só pina que ele está documentado nas 3
partes) — sem entrada no EXIT_CLAIMS, o count do manifest permanece 28. A
nova suite roda via test:unit (o glob `scripts/**/*.test.ts` do
vitest.config.unit.ts — o MESMO canal dos helpers que ela pina); o
test:guard (14 suítes curadas) não muda.

**Re-validação**: `npx vitest run scripts/__tests__/proof-helpers-contract.test.ts scripts/__tests__/hook-proof-run.test.ts scripts/__tests__/ci-proof-run.test.ts scripts/__tests__/gates-proofs-ordering.test.ts scripts/__tests__/scan-exit-claims.test.ts --config vitest.config.unit.ts` + `node scripts/scan-exit-claims.mjs --check` (clean 28 claims) + ASCII da nova suite + UTF-8 do doc + ordering 11.71 → 11.72 → 12 monotono.

## 11.73 ADOTADO — a divisão de trabalho travada: o hook-proof-run NÃO entra no test:guard (o push net é a superfície curada; a suite de contrato roda via test:unit) (avaliação 2026-08-12)

**Pedido**: a re-medição (3) da sec 8.1 inverteu a premissa do pedido: o
hook-proof-run (44 testes) NÃO está no test:guard — é suite de contrato
que roda via test:unit. Criar um teste de contrato (padrão
scan-guard-gates) que pince que o `hook-proof-run.test.ts` NÃO está na
lista do test:guard do package.json — travando a divisão de trabalho
test:guard (push net) vs test:unit (suítes de contrato) contra regressão
futura.

**O veredito (ADOTADO — pin no REAL-REPO CONTRACT do
scan-guard-gates.test.ts)**: a divisão de trabalho já é a premissa
documentada da sec 8.1 (as re-medições 2-5 medem o custo do test:guard
como "o push net" e citam `grep hook-proof-run package.json` = 0), mas
nada a travava ESTRUTURALMENTE — um refactor que adicionasse o
hook-proof-run ao test:guard faria a suite rodar DUAS vezes (no push net
E no test:unit), inflando o custo do step da sec 8.1 sem gate benefit, e
nenhum teste falharia.

**O pin (2 testes no scan-guard-gates.test.ts, o padrão do REAL-REPO
CONTRACT da 8.4)**: a suite que já lê o package.json REAL (e roda ela
mesma DENTRO do test:guard — o pin nasce na superfície que protege)
passa a assertar que o test:guard NÃO contém `hook-proof-run.test.ts`
nem `ci-proof-run.test.ts` (o detector extraído como função pura
`testGuardCarriesSuite` — o shape dos fatos consumidos) + o lado
POSITIVO da divisão: a suite é coberta pelo canal do test:unit (o glob
`scripts/**/*.test.{ts,tsx}` do vitest.config.unit.ts + o script
test:unit sem file args) — a divisão é completa, nunca um teste solto. A
MUTATION prova a sensibilidade: adicionar o hook-proof-run ao test:guard
sintético flips o MESMO detector de false → true (a regressão que o pin
trava — não uma tautologia).

**Por que no scan-guard-gates e não numa suite nova**: o guard da 8.4 já
é o guard do push net E vive no próprio test:guard — um refactor que
adicione o hook-proof-run ao test:guard falha essa suite no push net (CI)
sem fiação nova; e o mesmo bloco já pina o positivo (scan-push-full-suite
PRESENTE no test:guard), fechando os dois lados da lista num só lugar.

Esta sec 11.73 é claim-free por desenho (o pin é de composição da lista,
não de código de saída — nenhum exit code muda) — sem entrada no
EXIT_CLAIMS, o count do manifest permanece 28.

**Re-validação**: `npx vitest run scripts/__tests__/scan-guard-gates.test.ts scripts/__tests__/workflow-contracts.test.ts scripts/__tests__/gates-proofs-ordering.test.ts scripts/__tests__/scan-exit-claims.test.ts scripts/__tests__/doc-revalidate.test.ts --config vitest.config.unit.ts` + `node scripts/scan-exit-claims.mjs --check` (clean 28 claims) + ASCII do teste + UTF-8 do doc + ordering 11.72 → 11.73 → 12 monotono.

## 11.74 ADOTADO — os counts de testes/suítes das re-medições da 8.1 são REGISTROS DE EVENTO, não claims: RECUSADO estender o checkCitedCounts a eles (avaliação 2026-08-12)

**Pedido**: a sec 8.1 agora tem 5 medições com counts citados
(66→155→236→269→297 testes; 8→13→14 suítes). Avaliar estender o
checkCitedCounts (sec 11.62) para cobrir os counts de testes/suítes das
re-medições — ou documentar por que são registros de evento históricos.

**O veredito (RECUSADO estender — os counts são registros de evento
run-pinned, e o detector já tem a fronteira certa)**: a medição no doc
REAL é decisiva: `scanCitedCounts` NÃO gera record para a sec 8.1 (só
8.34/8.35/8.36/8.37 têm records — os counts de CLAIMS). A razão é o
TOKEN CLASS: o CLEAN_COUNT_RE lê só o verbatim `clean (N claims` do
stdout do CLI; os counts de testes/suítes ("14 suítes / 304 testes") são
OUTRA classe — medidas de run, não claim de estado.

**Por que estender seria WRONG (3 leituras)**:

1. **Cada re-medição é um snapshot run-pinned**: o bloco cita run number +
   data + commit (ex.: re-medição (4) = run 31585318096, HEAD e50a186,
   14 suítes / 304 testes). Os counts LEGITIMAMENTE diferem entre
   re-medições (66→155→236→269→297) porque cada um descreve o estado
   NAQUELE run/commit. Um checker que comparasse com o count atual
   flagraria a re-medição (1) como drift — mas 66 testes ERA a verdade do
   run 31406545988. Registro de evento é imutável por design.
2. **O current truth é DERIVED, nunca doc-citado**: a composição do
   test:guard vive no package.json (single source of truth), pinada pela
   8.4 REAL-REPO CONTRACT (scan-guard-gates) + sec 11.73 (hook-proof-run
   fora do test:guard). O doc só REGISTRA o que cada run mediu — não é a
   autoridade do estado atual.
3. **A fronteira de formato já existe**: o teste FRONTEIRA da 11.62
   (verbatim vs narrativa) pina que prosa natural citando count histórico
   NÃO é contract — os counts de re-medições são a MESMA classe da
   narrativa (prosa histórica), não do token do CLI.

**O pin (2 testes na suite scan-exit-claims.test.ts, describe sec
11.74)**: o REAL-REPO prova que a sec 8.1 com 5 re-medições citando
counts NÃO gera record (o detector é claims-token-only) + o current truth
é derived (package.json test:guard com scan-push-full-suite); a MUTATION
prova o contrafactual: prosa de re-medição com counts de testes/suítes
NÃO viola, o MESMO número no token verbatim do CLI viola — a fronteira é
o FORMATO, não o número (o mesmo shape do FRONTEIRA da 11.62 aplicado à
classe de medidas).

Esta sec 11.74 é claim-free por desenho (a decisão é de token class, não
de código de saída — nenhum exit code citado) — sem entrada no
EXIT_CLAIMS, o count do manifest permanece 28.

**Re-validação**: `npx vitest run scripts/__tests__/scan-exit-claims.test.ts scripts/__tests__/scan-guard-gates.test.ts scripts/__tests__/workflow-contracts.test.ts scripts/__tests__/gates-proofs-ordering.test.ts scripts/__tests__/doc-revalidate.test.ts --config vitest.config.unit.ts` + `node scripts/scan-exit-claims.mjs --check` (clean 28 claims) + UTF-8 do doc + ordering 11.73 → 11.74 → 12 monotono.


## 11.75 ADOTADO — a CURE stage-aware do revert-fail: a scratchLeftNote aponta a recuperação real (reflog + cherry-pick) quando o branch -D JÁ rodou — refinado 2026-08-12 com a CURE em DOIS NÍVEIS do apply-fail e, no mesmo dia (2o), a DECISÃO VERIFICADA via `git apply --check` (avaliação 2026-08-12)

**Pedido**: o ACHADO da Prova 43 (sec 8.38): a `scratchLeftNote` do
revert-fail orienta `git checkout <orig> && git branch -D <branch>` — mas o
`branch -D` JÁ rodou (o `revertCycle` deleta a scratch ANTES do apply) e o
delta fica preso no reflog (commit órfão `7074dab`). A receita genérica
não descreve o estado real: o checkout já voltou (o revert passou por ele)
e o `branch -D` falharia ("no such branch"). Avaliar refinar a mensagem do
revert-fail para apontar a recuperação real (`git cherry-pick` do reflog /
safety diff), no padrão da CURE da sec 11.54.

**O veredito (ADOTADO — a nota vira stage-aware, a CURE no erro)**: a
`scratchLeftNote` continua certa para os fail paths onde a scratch AINDA
existe (checkout-fail e branch-D-fail — o `branch -D` não rodou), mas para
os fail paths POS-branch-D (apply-fail e status-divergente) a scratch JÁ
foi deletada com o commit do delta dentro. O `revertCycle` passa a retornar
o `stage` do fail (`checkout` | `branchD` | `apply` | `status` — o fato
consumido) e a nova função exportada `revertLeftNote(stage, ...)` despacha
por stage: apply-fail → a CURE em DOIS NÍVEIS (o refinamento abaixo);
status-fail → a CURE própria do snapshot; checkout/branchD → a
scratchLeftNote original. Os 2 pontos de conversão (o revert-fail do main e
o `cleanupOnFailSuffix`) usam a MESMA função — a fonte única da receita, o
padrão da sec 11.54 (nunca duas versões da receita). O guard de forma da
11.65 e o envelope da 11.71 passam a aceitar a família `LeftNote`
(`scratchLeftNote` | `revertLeftNote`) — a classe do fail silencioso
continua fechada com o novo membro.

**O refinamento (2026-08-12) — a hierarquia da CURE do apply-fail**: o
backup do ciclo guarda o `delta.patch` — a fonte PRIMÁRIA do delta quando
ÍNTEGRO. A CURE original (só reflog) subestimava o caminho do dia a dia:
na grande maioria dos casos o patch do backup é válido e `git apply
<backup>/delta.patch` restaura o delta direto — o reflog/cherry-pick só é
necessário quando o patch é INVÁLIDO (corrompido — o ACHADO da Prova 43
foi com o patch corrompido de propósito). A CURE do apply-fail vira
hierárquica em DOIS NÍVEIS: (1) `git apply <backup>/delta.patch` (a receita
do dia a dia, a fonte primária quando o patch está íntegro); (2) SÓ quando
o apply falhar de novo (patch inválido/corrompido — a classe da Prova 43):
`git reflog` (procurar `hook-proof: <branch> (delta)`) + `git cherry-pick
<sha>`, ou o safety diff externo (o caminho que a própria Prova 43 usou:
`git apply /tmp/prova43-safety.diff` — com `--safety-diff`). O status-fail
é semanticamente DIFERENTE do apply-fail: no status-divergente o apply do
ciclo PASSOU (o delta JÁ está na árvore) — re-aplicar o patch falharia
("already applied"); a CURE própria compara o `git status --porcelain` com
o snapshot `<backup>/status-before.txt` e reconcilia a divergência, com o
reflog como fallback se o delta faltar. A divisão apply/status em branches
separados é intencional (o par pos-branch-D agora tem CUREs próprias, não
a MESMA — a hierarquia apply-first não faz sentido onde o delta já foi
aplicado).

**O refinamento 2 (2026-08-12) — a hierarquia vira DECISÃO VERIFICADA**: o
refinamento acima deixou a escolha do nível para o usuário julgar (a prosa
"o usuário decide se o patch está íntegro" — o pedido deste refinamento).
O call site do fail agora roda `git apply --check <backup>/delta.patch` no
MOMENTO da nota (`patchAppliesClean` — o dry-run do git, não escreve nada;
custo: 1 spawn git no fail path, e o revert-fail é raro) e a CURE cita SÓ
o nível aplicável: o `--check` passa → SÓ o nível 1 (`git apply
<backup>/delta.patch` — a receita do dia a dia, VERIFICADA); o `--check`
falha (corrompido OU a árvore conflita — as classes das Provas 43/50) →
SÓ o reflog/cherry-pick (+ safety diff externo). A hierarquia em texto
some — o `--check` decide, e a CURE nunca cita os dois caminhos juntos (o
usuário não julga mais de olho). A FRONTEIRA honesta: o `--check` valida
contra a ÁRVORE DO MOMENTO — um patch ÍNTEGRO contra uma árvore com blocker
(a classe da Prova 50, o poison commit) FALHA o check e cai no reflog (a
recuperação garantida — o cherry-pick do commit órfão não depende da
árvore); limpar o blocker e re-tentar o apply é o caminho manual
alternativo (o que a própria Prova 50 fez). Só o stage apply consulta o
`--check` (o status já tem o delta aplicado — o re-check falharia
"already applied"; checkout/branchD a scratch ainda existe — a receita
genérica).

**O pin (suite hook-proof-run.test.ts, describe sec 11.75)**: a matriz dos
4 stages — apply-fail → a CURE SPLIT pela DECISÃO VERIFICADA (`patchApplies
true` → SÓ o nível 1 `git apply <backup>/delta.patch` com `APLICA LIMPO` +
a menção do `--check`, SEM reflog/cherry-pick; `patchApplies false` → SÓ o
reflog + `cherry-pick` com `NAO aplica`, SEM o nível 1 — o par nos DOIS
lados do dispatch) e NÃO a receita genérica; status-fail → a CURE do
snapshot (`PASSou` + `status-before.txt` + reflog como fallback) e NÃO a
receita genérica; checkout-fail e branchD-fail → a receita genérica (`git
checkout base && git branch -D ci-proof/lpr-x`) e NÃO o `cherry-pick`. O
`patchAppliesClean` tem teste próprio contra o fixture (default → true; o
knob `FAIL_APPLY_CHECK=1` → false — o seam do verificador). Os E2Es: o
caminho do reflog roda com `FAIL_APPLY + FAIL_APPLY_CHECK` (a classe
corrompida) e o NOVO E2E do nível-1 com `FAIL_APPLY` SEM o knob (o `--check`
passa → a CURE cita SÓ o nível 1) — o par fechado nos DOIS lados do
dispatch no caminho do hook. A MUTATION estrutural pina o despacho SPLIT:
apagar o branch do `status` é flagrado — o status-fail cairia na CURE do
apply (a hierarquia apply-first que não se aplica a ele, a classe da Prova
43 reabrindo no stage que a prova não cobriu ao vivo, só por síntese).

Esta sec 11.75 é claim-free por desenho (a decisão é de conteúdo da
mensagem de erro, não de código de saída — nenhum exit code citado) — sem
entrada no EXIT_CLAIMS, o count do manifest permanece 29 (revalidado
2026-08-12).

**Re-validação**: `npx vitest run scripts/__tests__/hook-proof-run.test.ts scripts/__tests__/proof-helpers-contract.test.ts scripts/__tests__/scan-exit-claims.test.ts scripts/__tests__/gates-proofs-ordering.test.ts scripts/__tests__/doc-revalidate.test.ts --config vitest.config.unit.ts` + `npx tsc --noEmit` + `node scripts/scan-exit-claims.mjs --check` (clean 29 claims) + UTF-8 do doc + ASCII do .mjs + ordering 11.74 → 11.75 → 12 monotono.


## 11.76 ADOTADO — o seam hermético do revert-fail apply: knob HOOK_PROOF_FAKE_FAIL_APPLY no fixture + E2E do fail(3) com backup e CURE (avaliação 2026-08-12)

**Pedido**: o fixture `hook-proof-fake-bins.mjs` nunca falha o `git apply`
— os 4 fail paths do `revertCycle` seguem sem E2E hermético
COMPORTAMENTAL (só o guard de forma da 11.65 deriva os fail sites do
source; a Prova 43, sec 8.38, foi a única prova viva do apply-fail —
injetando um patch corrompido no backup real). Avaliar um knob
`HOOK_PROOF_FAKE_FAIL_APPLY` no fixture + um teste E2E provando o fail(3)
com o backup apontado no caminho hermético, fechando a classe nos dois
lados (vivo + hermético).

**O veredito (ADOTADO — o seam que faltava)**: o fixture ganhou o knob
`HOOK_PROOF_FAKE_FAIL_APPLY=1` (o `git apply` fake responde falha (status
1) + stderr `No valid patches in input` — o mesmo sinal da Prova 43). O E2E novo roda o
ciclo hermético completo com a árvore SUJA (o `delta.patch` do backup é
não-vazio → o apply realmente roda), o hook passando (o sinal de sucesso
do verify — a falha é do revert, não do verify) e o apply fake falhando:
**o fail(3) fail-loud** com o backup apontado no stderr E a **CURE
stage-aware da sec 11.75** (o
apply-fail é POS-branch-D → `reflog` + `cherry-pick`, NÃO a receita
genérica `git checkout <orig> && git branch -D <branch>` que descreveria um
estado que não existe mais). O invocations.log prova a ORDEM do revert
(checkout base → branch -D → apply falhou) — o estado exato que a CURE do
reflog descreve (a scratch deletada com o commit do delta dentro).

**A classe fechada nos dois lados**: a Prova 43 (vivo) provou o apply-fail
no repo REAL com patch corrompido; o E2E novo (hermético) prova o MESMO
caminho via knob sem tocar git real — a classe do revert-fail apply agora
tem os 2 lados (o padrão das Provas 16/19 para o needs:, aplicado ao fail
path). Os outros 3 fail paths (checkout, branch -D, status divergente)
continuam cobertos por síntese (a matriz da sec 11.75 + o guard de forma
da 11.65) — o apply é o único com seam de injeção limpo (o knob substitui
o `--mutate` da Prova 43, agora sem precisar corromper arquivo nenhum).

Esta sec 11.76 é claim-free por desenho (a decisão é de teste hermético,
não de código de saída — nenhum exit code citado) — sem entrada no
EXIT_CLAIMS, o count do manifest permanece 28.

**Re-validação**: `npx vitest run scripts/__tests__/hook-proof-run.test.ts scripts/__tests__/proof-helpers-contract.test.ts scripts/__tests__/scan-exit-claims.test.ts scripts/__tests__/gates-proofs-ordering.test.ts scripts/__tests__/doc-revalidate.test.ts --config vitest.config.unit.ts` + `npx tsc --noEmit` + `node scripts/scan-exit-claims.mjs --check` (clean 28 claims) + UTF-8 do doc + ASCII do .mjs e do fixture + ordering 11.75 → 11.76 → 12 monotono.


## 11.77 ADOTADO — o --safety-diff: o delta salvo FORA do backup ANTES do ciclo, e a CURE do revert-fail o cita (avaliação 2026-08-12)

**Pedido**: a Prova 43 (sec 8.38) recuperou o delta via safety diff
EXTERNO (`git apply /tmp/prova43-safety.diff`) porque o backup apontado na
mensagem carregava o `delta.patch` CORROMPIDO (a própria mutação da prova
corrompeu o patch do backup — o backup apontado NÃO era a fonte de
recuperação do delta, só os untracked + doc + status-before). Avaliar um
`--safety-diff <path>` no hook-proof-run: o helper salva o diff ANTES do
ciclo num path externo e o recipe de recuperação do revert-fail o cita —
travando a classe de perda de delta contra a próxima prova.

**O veredito (ADOTADO — o seam temporal, não um arquivo a mais no
backup)**: o `--safety-diff <path>` grava o MESMO `git diff` (a etapa 2 do
backup) num path EXTERNO ao backupDir, ANTES de qualquer mutação — a
cópia que sobrevive à corrupção do `delta.patch` do backup (a classe da
Prova 43). A CURE do revert-fail (o `revertLeftNote` stage-aware da sec
11.75) ganhou o 5º parâmetro: quando o path foi salvo, o apply-fail/status
citam `git apply <path>` (o comando exato, o padrão da CURE da sec 11.54);
sem a flag, a CURE permanece genérica (`safety diff externo` — o opcional
honesto, a fronteira da sec 11.75 intacta). O path é resolvido para
absoluto na gravação (o recipe cita o caminho usável mesmo se o cwd mudar).

**A implementação (2 arquivos)**: `scripts/hook-proof-run.mjs` (flag no
parseArgs + USAGE + a gravação na etapa 2 do backup + o 5º param do
`revertLeftNote` propagado pelos 2 pontos de conversão — o revert-fail do
main e o `cleanupOnFailSuffix` — + a linha opcional no plano do --dry-run) e
`scripts/__tests__/hook-proof-run.test.ts` (describe sec 11.77: o parse da
flag, a matriz do `revertLeftNote` com/sem path — apply/status citam o
`git apply <path>` e NÃO a forma genérica; checkout mantém a receita
genérica — e o E2E com `--safety-diff` + `HOOK_PROOF_FAKE_FAIL_APPLY=1`:
o arquivo externo salvo com o conteúdo do diff ANTES do ciclo + a CURE
citando o caminho absoluto no fail(3)).

**A fronteira (o que NÃO mudou)**: a CURE genérica (reflog + cherry-pick +
safety diff externo) continua sendo o comportamento SEM a flag — o
`--safety-diff` só torna a receita ESPECÍFICA quando o path foi salvo. O
revertCycle NÃO usa o safety diff (ele usa o `delta.patch` do backup — o
caminho normal); o safety diff é a RECUPERAÇÃO manual do fail, nunca o
caminho automático do revert.

Esta sec 11.77 é claim-free por desenho (a decisão é de arquitetura de
recuperação, não de código de saída — nenhum exit code citado) — sem
entrada no EXIT_CLAIMS, o count do manifest permanece 28.

**Re-validação**: `npx vitest run scripts/__tests__/hook-proof-run.test.ts scripts/__tests__/proof-helpers-contract.test.ts scripts/__tests__/scan-exit-claims.test.ts scripts/__tests__/gates-proofs-ordering.test.ts scripts/__tests__/doc-revalidate.test.ts --config vitest.config.unit.ts` + `npx tsc --noEmit` + `node scripts/scan-exit-claims.mjs --check` (clean 28 claims) + UTF-8 do doc + ASCII do .mjs + ordering 11.76 → 11.77 → 12 monotono.


## 11.78 ADOTADO — o espelho da 11.72 para a classe de GUARDS wired: as 3 partes por guard (avaliação 2026-08-12)

**Pedido**: a sec 11.72 pina as 3 partes do contrato de fail-loud nos
helpers de prova (hook-proof-run + ci-proof-run), mas os node guards wired
nos hooks (.husky/pre-commit, .husky/pre-push) e no registry PROOF_CLASSES
não têm contrato de forma análogo — a parte 1 (entrada no manifest) vive no
checkWiredSurface da sec 11.60, mas as partes 2 (suite no test:guard ou
test:unit) e 3 (nota na sec 11.x) vivem só em prosa. Avaliar um teste que
derive os guards wired dos hooks reais (spawns de node) e pince que cada um
tem: entrada no proofs-manifest, suite no test:guard ou test:unit, e nota
na secao 11.x — o espelho da 11.72 para a classe de guards.

**O veredito (ADOTADO — o guard dos guards wired)**: nova
`scripts/__tests__/wired-guards-contract.test.ts` (test:unit, o canal das
suítes de contrato — NÃO no test:guard, cuja lista é pinada pela Prova 35
/sec 8.30). O teste deriva a superfície wired REAL (`deriveWiredGuards` — os
spawns `node|bash scripts/` dos hooks + imports do batch runner + steps
`--ci` dos workflows do net; 18 guards hoje, medido 2026-08-12) e pina as 3
partes por guard:
  1. ENTRADA no proofs-manifest: o basename está no PROOF_CLASSES (module)
     ou no WIRED_ALLOWLIST (a parte 1 da sec 11.60 reafirmada por guard);
  2. SUITE: o `<stem>.test.ts` existe em scripts/__tests__ E é coberto pelo
     include do test:unit (o glob `scripts/**` do vitest.config.unit.ts,
     derivado no teste do arquivo de config real) OU está na lista explícita
     do test:guard do package.json — a divisão de trabalho test:guard (push
     net) vs test:unit (suítes de contrato) da sec 8.1;
  3. NOTA na sec 11.x: o stem (basename sem extensão) aparece no corpo de
     pelo menos uma seção `## 11.N` do doc real — a fonte da nota é o STEM,
     não o basename completo (a doc cita `check-docs-encoding` sem o `.sh`
     nas secs 11.8/11.19/11.60 — o probe por basename completo acusaria
     falso negativo; o probe por stem: os 18 wired têm nota).

**O ACHADO da 1a rodada (o contrato flagrou a convenção)**: 2 dos 18
wired NÃO seguem a convenção `<stem>.test.ts` — o `GUARD_SUITE_MAP` do
teste as mapeia: `run-mapped-fuzz.mjs` → `fuzz-mapped.test.ts` (o contrato
do runner vive na suite do fuzz mapeado, sec 11.11 — o nome não deriva do
stem) e `scan-lucide-icons.mjs` → `scan-batch-coverage.test.ts` (guard de
geração sem suite própria — o pin do HOOK_ALLOWLIST da sec 11.16 vive no
teste do batch). Os demais 16 seguem a derivação `<stem>.test.ts` (o
fallback). Um guard novo com suite fora da convenção exige entrar no mapa
(o mesmo padrão do PROOF_HELPERS da sec 11.72).

**O snapshot da divisão (o pin da parte 2)**: as suites dos 8 guards de
push-net/runner estão na lista explícita do test:guard (run-mapped-fuzz,
scan-batch-coverage, scan-fuzz-precommit, scan-guard-gates,
scan-lint-staged-loader, scan-lucide-icons, scan-prepush-batch,
scan-push-full-suite — run-mapped-fuzz e scan-lucide-icons via o mapa);
as demais 10 são cobertas
pelo glob do test:unit (todas existem em scripts/__tests__). Editar a
divisão exige editar o snapshot conscientemente.

**Os MUTATIONs** (a classe é real): um guard fake num hook sintético → as
3 partes faltam (o crescimento inverso da sec 11.60 aplicado às 3 partes);
o stem removido de TODAS as seções 11.x do doc → a parte 3 flagra o guard
com o nome exato; um suite dir vazio → a parte 2 flagra todos.

**A fronteira (o que NÃO é pinado)**: a nota é por STEM — o corpo de
qualquer seção 11.x, não uma seção específica nem o basename completo (a
doc cita os guards sem extensão em prosa). A parte 1 é o checkWiredSurface
da 11.60 reafirmado per-guard (a mesma classe, agora como parte do contrato
de forma — não uma segunda fonte de verdade).

Esta sec 11.78 é claim-free por desenho (decisão de forma de contrato, não
de código de saída — nenhum exit code citado) — sem entrada no EXIT_CLAIMS,
o count do manifest permanece 28.

**Re-validação**: `npx vitest run scripts/__tests__/wired-guards-contract.test.ts scripts/__tests__/proofs-manifest.test.ts scripts/__tests__/proof-helpers-contract.test.ts scripts/__tests__/scan-exit-claims.test.ts scripts/__tests__/gates-proofs-ordering.test.ts scripts/__tests__/doc-revalidate.test.ts --config vitest.config.unit.ts` + `npx tsc --noEmit` + `node scripts/scan-exit-claims.mjs --check` (clean 28 claims) + UTF-8 do doc + ordering 11.77 → 11.78 → 12 monotono.


## 11.79 ADOTADO — o PROOF_HELPERS DERIVADO: o manifest nasce do package.json (todos os *-proof:run), pin no CONTENT (avaliação 2026-08-12)

**Pedido**: o manifest PROOF_HELPERS da sec 11.72 era um pin EXPLÍCITO
(lista hardcoded — adicionar um 3º helper exigia entrar na lista
manualmente), com o lado inverso do crescimento (helpers wired no
package.json DEVEM estar no manifesto) verificado por igualdade nos dois
sentidos. A derivação dos wired (deriveWiredGuards, sec 11.60/11.78)
provou o padrão da fonte única: a superfície REAL deriva o que o contrato
pina. Avaliar inverter a derivação: o manifesto gerado a partir do
package.json (todos os scripts `*-proof:run`) em vez de lista hardcoded,
com o pin no CONTENT derivado — o padrão do TARGET_DIRS consumido.

**O veredito (ADOTADO — a fonte única)**: o `proof-helpers-contract.test.ts`
da sec 11.72 agora DERIVA o manifest: `deriveProofHelpers(pkg)` lê o
package.json (todos os scripts `*-proof:run` → `{ script, mjs, ts, note }`),
a suite por convenção `<stem>.test.ts` e a nota pelo PRIMEIRO const
`\w+LeftNote` do source do helper (`stashLeftNote` do ci na linha 612,
`scratchLeftNote` do hook na 358 — o `revertLeftNote` da 11.75 é function
declaration e NÃO casa o regex). O pin saiu da LISTA e foi para o CONTENT:
`PROOF_HELPERS_PIN` — a projeção `[script, mjs, ts, note]` da derivada, no
padrão do ABS_PIN_SNAPSHOT da sec 11.50. O lado inverso do crescimento
MORREU por construção: todo script `*-proof:run` do package.json entra na
derivada automaticamente e é checado pelas 3 partes — não há lista para
esquecer de editar (o guard das 3 partes da 11.72 permanece, agora sobre a
derivada).

**O contrato (6 testes)**: a DERIVADA == PROOF_HELPERS_PIN (2 helpers hoje:
ci-proof:run → ci-proof-run.mjs → ci-proof-run.test.ts → stashLeftNote;
hook-proof:run → hook-proof-run.mjs → hook-proof-run.test.ts →
scratchLeftNote — adicionar um 3º script ou renomear uma nota exige editar
o snapshot conscientemente); todo helper da derivada tem as 3 partes
(docblock 0-3, nota \w+LeftNote, E2E com bins fake + assert de exit
nao-zero); a MUTATION da FONTE (um `fake-proof:run` num package.json
sintético → a derivada cresce para 3 → a projeção diverge do PIN — o
growth contract aplicado à derivada); as 3 MUTATIONs originais da 11.72
(remover a nota do ci, remover o `3 = falha` do docblock do hook, remover
o seam de bins fake do ci.test.ts) permanecem intactas.

**A fronteira (o que NÃO mudou)**: a sec 11.72 continua sendo a casa das 3
partes do contrato de fail-loud — a 11.79 só inverteu a FONTE do manifest
(lista hardcoded → derivação do package.json) e o local do pin (a lista →
o CONTENT derivado). O deriveWiredGuards da 11.60/11.78 segue separado:
ele deriva os guards de HOOK, não os helpers de prova — os dois contratos
continuam com fontes distintas e explícitas.

Esta sec 11.79 é claim-free por desenho (decisão de forma de contrato, não
de código de saída — nenhum exit code citado) — sem entrada no EXIT_CLAIMS,
o count do manifest permanece 28.

**Re-validação**: `npx vitest run scripts/__tests__/proof-helpers-contract.test.ts scripts/__tests__/wired-guards-contract.test.ts scripts/__tests__/proofs-manifest.test.ts scripts/__tests__/scan-exit-claims.test.ts scripts/__tests__/gates-proofs-ordering.test.ts scripts/__tests__/doc-revalidate.test.ts --config vitest.config.unit.ts` + `npx tsc --noEmit` + `node scripts/scan-exit-claims.mjs --check` (clean 28 claims) + UTF-8 do doc + ordering 11.78 → 11.79 → 12 monotono.

## 11.80 ADOTADO — a nota datada do singleFork no config + o pin da PRESENÇA da nota no unit-surface-contract (avaliação 2026-08-12)

**Pedido**: a re-medição (5) provou que o `singleFork: true` do
`vitest.config.unit.ts` é a fonte da planura do test:guard, mas o config
não tinha nota explicando o PORQUÊ da serialização — um leitor de boa-fé
poderia "consertar" o singleFork achando que há paralelismo perdido.
Adicionar um comentário datado junto ao `poolOptions` explicando a decisão
(determinismo + a planura medida da sec 8.1) e avaliar se o
unit-surface-contract deve pinar a presença da nota.

**A implementação (2 arquivos)**:

1. `vitest.config.unit.ts` — comentário datado `SERIALIZED POOL (2026-08,
   sec 8.1 + sec 11.48)` acima do `poolOptions`: o singleFork é INTENCIONAL
   e cita as DUAS razões da decisão — (a) DETERMINISMO: a superfície
test:unit/test:guard é de suítes de CONTRATO que leem o repo REAL (scan-*,
golden copies, manifests); o fork único serializa o I/O de subprocessos
(no interleaving); (b) a PLANURA MEDIDA (sec 8.1 re-medições (2)-(6): test:guard banda 19-23.5s,
série 20 → 20.9 → 19 → 22.2 → 23.5 → 22.5s — a citação atual, pinada contra a
calibração canônica da sec 8.1 pela sec 11.95) foi absorção de TESTES BARATOS
na banda de variância do runner, não workers —
`--maxWorkers` é no-op estrutural (sec 11.48). Termina com a instrução
anti-correção: `DO NOT "parallelize" this pool without re-measuring`.

2. `scripts/__tests__/unit-surface-contract.test.ts` — o pin da PRESENÇA:
a suite (que já lê o TEXTO do config como fonte estável — o mesmo padrão
do exclude block, que importar o config em processo quebraria o invariant
do TextEncoder) ganha a seção 6 "pool serialization note":
`poolNotePresent()` exige a nota datada (`sec 8.1` + `2026-08` + `DO NOT
"parallelize"`) junto ao bloco `singleFork: true` + 2 MUTATIONs (nota
removida → pin falha; `singleFork: false` → pin falha).

**Veredito (ADOTADO — sim, o unit-surface-contract deve pinar)**: a suite já
e o contrato do TEXTO do config; a nota do pool e mais um fato da superficie
test:unit, no MESMO domicilio — um 2o suite espalharia o contrato do config
por dois arquivos. O pin fecha a classe "leitor conserta o singleFork e
remove a nota junto" com falha loud no momento do commit — sem depender de
re-medição futura para o drift aparecer.

**Re-validação**: `npx vitest run scripts/__tests__/unit-surface-contract.test.ts` + `npx tsc --noEmit` + UTF-8/ASCII do config e da suite + ordering 11.79 → 11.80 → 12 monotono.

Esta sec 11.80 é claim-free por desenho (decisão de forma de contrato, não
de código de saída — nenhum exit code citado) — sem entrada no EXIT_CLAIMS,
o count do manifest permanece 28.

## 11.81 ADOTADO — o guard-remeasure: a re-medição da sec 8.1 em 1 comando
(dispatch do guard-gates + extração do step + veredito da banda) (avaliação
2026-08-12)

**Pedido**: a variância da sec 8.1 (banda 19-23.5s do step test:guard) é
runner-side, mas a receita de re-medição continua MANUAL — dispatch do
guard-gates via ci-proof-run + abrir o log capturado no tmpdir + extrair os
timestamps do step "Run guard vitest suites" + comparar com a banda +
escrever o veredito na doc (a re-medição (6) foi o último ciclo a pagar
esse custo, sec 8.1). Automatizar o ciclo num helper no padrão do
doc-revalidate (sec 11.61) — a re-medição (6) em 1 comando.

**A implementação (3 arquivos)**:

1. `scripts/guard-remeasure.mjs` (novo, gate ASCII puro, sem deps): o
   ciclo completo — (1) spawn do ci-proof-run (o helper de prova-CI
   existente, sec 11.20) com `--only-jobs "Guard Gates (fragile-range +
   golden-copy)" --expect success` (o DONE line `DONE run=...
   conclusion=success log=<path>` entrega o path do log do job no tmpdir);
   (2) `stepSpan()` — a extração PURA do span wall-clock do step: a 1a
   linha do step (o `##[group]` com timestamp) até a 1a linha do PRÓXIMO
   step (o delimitador de fim) — o MESMO número que a tabela da sec 8.1
   reporta (a re-medição (6): 22.47s); (3) `bandVerdict()` contra o
   `GUARD_BAND` (o fato calibrado { min: 19, max: 23.5 }, exported e
   PINADO por teste no LITERAL — recalibrar a banda exige editar o const
   E o teste; a doc é o TERCEIRO lugar (claim-free em prosa, sec 8.1));
   (4) o veredito do no-filter: dentro da banda = sucesso
   "no-filter continua calibrado" (o padrão --check dos guards); fora =
   o ALERTA de reabertura da decisão, com falha (a regra da sec 8.1). Os
   exit codes do helper vivem no docblock do .mjs e nos E2Es herméticos —
   esta sec 11.81 segue claim-free (a fronteira da sec 11.51).
   Flags: `--branch ci-proof/remeasure-<data>` (default), `--band
   "min-max"` (override), `--timeout/--keep-branch/--stash-uncommitted/--clean`
   repassados ao ci-proof-run (o `--clean` adiciona
   `--expect-success-implies-clean`, sec 11.43 — a limpeza vira contrato,
   não leitura manual), `--log <path>` (extração read-only de um log JÁ
   capturado, sem dispatch), `--dry-run` (plano sem executar).
2. `scripts/__tests__/fixtures/guard-remeasure-fake-cmd.mjs` (novo): o
   fake do subprocesso do ci-proof-run (GUARD_REMEASURE_CIPROOF_CMD — o
   mesmo padrão do DOC_REVALIDATE_CLI_CMD da sec 8.37/11.61): imprime o
   DONE line apontando para um log que o teste escreve — a extração REAL
   roda sobre ele.
3. `scripts/__tests__/guard-remeasure.test.ts` (novo, test:unit — a suite
   é de contrato, não faz parte do test:guard): as funções puras
   (parseLogTs com o BOM do `##[group]`, stepSpan com o log sintético da
   re-medição (6) = 22.47s, extractTestCounts ANSI-stripped, bandVerdict
   dentro/fora/abaixo, parseDoneLine, buildCiproveCmd, parseArgs) + os E2Es
   herméticos com o fake cmd (dentro da banda = sucesso calibrado, fora =
   ALERTA falho, conclusion=failure = falho, `--log` read-only,
   `--dry-run`).

**Veredito (ADOTADO — sim, o helper vale o custo)**: a re-medição é uma
operação de MONITORAMENTO recorrente (a sec 8.1 manda re-medir quando o
custo das suítes muda — 5 re-medições em 2 dias); o ciclo manual de 4
passos tinha exatamente a classe de erro que o repo combate (esquecer um
passo, extrair o timestamp errado, comparar com a banda desatualizada). O
helper transforma o ciclo num comando determinístico: o mesmo ci-proof-run
+ a extração pura pinada por teste + o veredito contra a banda exportada e
pinhada. A receita da próxima re-medição é:

```bash
node scripts/guard-remeasure.mjs --stash-uncommitted
# dentro da banda 19-23.5s: veredito 'no-filter continua calibrado';
# fora: veredito 'ALERTA ... reabrir a decisao da sec 8.1' (falha)
```

**Re-validação**: `npx vitest run scripts/__tests__/guard-remeasure.test.ts scripts/__tests__/ci-proof-run.test.ts scripts/__tests__/doc-revalidate.test.ts scripts/__tests__/proofs-manifest.test.ts scripts/__tests__/scan-exit-claims.test.ts scripts/__tests__/gates-proofs-ordering.test.ts --config vitest.config.unit.ts` + `npx tsc --noEmit` + CLIs clean (28 claims / manifest) + UTF-8/ASCII dos 3 arquivos + ordering 11.80 → 11.81 → 12 monotono.

Esta sec 11.81 é claim-free por desenho (decisão de forma de contrato, não
de código de saída — nenhum exit code citado) — sem entrada no EXIT_CLAIMS,
o count do manifest permanece 28.

## 11.82 ADOTADO — o lado POSITIVO da divisão: o ABS PIN da superfície do
push net (a lista COMPLETA das 14 suites do test:guard derivada e pinada)
(avaliação 2026-08-12)

**Pedido**: a sec 11.73 trava a AUSÊNCIA dos helpers de prova no test:guard
(o negativo: hook-proof-run/ci-proof-run fora da lista), mas a lista curada
de 14 suites em si segue derivada SÓ do package.json sem pin — um refactor
que adicionasse uma 15a suite (de contrato ou legítima), removesse uma
curada ou reordenasse a lista passaria sem nenhum teste falhar. Avaliar um
teste de forma que derive a lista completa do test:guard e a pince (o ABS
PIN da superfície do push net), fechando o lado positivo do mesmo contrato
de divisão.

**O veredito (ADOTADO — o ABS PIN no scan-guard-gates.test.ts, a suite que
já lê o package.json REAL e roda DENTRO do test:guard)**: a divisão da
11.73 tem dois lados — o negativo (nada de contrato ENTRA) estava pinado,
o positivo (a lista curada em si É o que a sec 8.1 mede) não. O pin:
`deriveTestGuardSuites(tg)` extrai os nomes das suites do script test:guard
EM ORDEM (a projeção do que o step realmente roda) e o
`TEST_GUARD_ABS_PIN` pina as 14 suites na ordem curada — o padrão do
ABS_PIN_SNAPSHOT da sec 11.50 aplicado à superfície do push net.

**Os 4 testes (REAL-REPO CONTRACT + 3 MUTATIONs, todos com timeout
explícito — o padrão da suite)**: (1) a derivada do package.json REAL bate
EXATAMENTE com o ABS PIN (14 suites, na ordem — o refactor que adicione/
remova/reordene quebra AQUI, na suite que roda dentro do próprio
test:guard); (2) MUTATION adicionando o hook-proof-run (a 15a suite da
11.73) → a derivada diverge (15 ≠ 14 — o crescimento NUNCA é silencioso,
e o negativo da 11.73 vira ESTRUTURAL por construção, não só detector
isolado); (3) MUTATION removendo uma suite curada (o scan-push-full-suite
da 8.4/11.11) → diverge (a lista não encolhe sem edição consciente do pin
— o GUARD SUITE MISSING do CLI pega essa remoção específica, o ABS PIN
pega QUALQUER remoção); (4) MUTATION reordenando as duas últimas → diverge
(a ORDEM faz parte do pin — é uma projeção em sequência, não um set).

**A relação com a sec 11.74**: os counts citados nas re-medições da 8.1
seguem registros de evento (RECUSADO no checkCitedCounts) — este pin não
é sobre prosa histórica, é sobre a LISTA VIVA: o dia em que o test:guard
ganhar/perder/reordenar uma suite, o ABS PIN quebra AQUI e a re-medição
seguinte da sec 8.1 recalibra a banda com o count novo. O pin trava a
superfície que a 11.74 deixou deliberadamente livre (a prosa), sem colidir
com a decisão — os dois convivem: prosa = evento, lista = contrato.

Esta sec 11.82 é claim-free por desenho (decisão de forma de contrato, não
de código de saída — nenhum exit code citado) — sem entrada no EXIT_CLAIMS,
o count do manifest permanece 28.

## 11.83 ADOTADO — a PRESENÇA das suites de contrato no glob do test:unit:
o irmão da 11.73 no OUTRO lado da divisão (o positivo do canal local)
(avaliação 2026-08-12)

**Pedido**: a sec 11.73 trava a divisão no test:guard (o push net — o
hook-proof-run/ci-proof-run NÃO entram na lista curada de 14) e a 11.82
pina o ABS PIN daquela lista. Mas o MESMO conceito de superfície curada
existe no test:unit glob — o canal que os guards de pre-commit/pre-push
rodam localmente (os hooks spawnam o test:unit via o glob `scripts/**` do
vitest.config.unit.ts). Nada pina que as suites de contrato (os helpers de
prova + os contratos dos guards) estão PRESENTES nesse canal: um refactor
que adicionasse um exclude para uma delas, ou estreitasse o glob de
scripts, faria a suite de contrato sumir silenciosamente de TODO guard
local — sem nenhum teste falhar (a divisão da 11.73 só pina o lado do push
net, não o canal local). Avaliar um contrato irmão que pince a PRESENÇA no
glob — fechando o par nos dois lados da divisão.

**O veredito (ADOTADO — o pin no unit-surface-contract.test.ts, a suite que
já lê o TEXTO do vitest.config.unit.ts como fonte estável)**: a 11.73 é o
negativo (nada de contrato no test:guard); este contrato é o POSITIVO do
outro lado (toda suite de contrato no test:unit). A implementação (1
arquivo + doc):

1. `unitIncludePatterns()` — o extrator do bloco `include:` do TEXTO do
   config (o irmão do `unitExcludePatterns` da sec 11.80 — o config é lido
   como texto, nunca importado: o import quebraria o invariant do
   TextEncoder);
2. `survivesUnitSurface(rel, include, exclude)` — a função pura que
   computa a PRESENÇA de fato: o caminho casa ALGUM include E nenhum
   exclude (o mesmo motor picomatch da sec 11.80, agora aplicado ao glob
   de scripts);
3. `TEST_UNIT_CONTRACT_PIN` — a projeção snapshot (o padrão do ABS PIN da
   sec 11.82) das 11 suites de contrato: os 3 helpers de prova
   (hook-proof-run, ci-proof-run, guard-remeasure) + os contratos dos
   guards (proof-helpers-contract, wired-guards-contract, proofs-manifest,
   scan-exit-claims, check-exit-claims-push, scan-cures-contract,
   unit-surface-contract, gates-proofs-ordering) — adicionar uma nova suite
   de contrato exige editar a lista conscientemente;
4. os 3 testes: (1) REAL-REPO — TODAS as suites do pin sobrevivem
   include+exclude (a premissa base, o glob `scripts/**` presente no
   include, re-derivado do texto — o que a 11.73 pina no package.json, aqui
   no config); (2) MUTATION — um exclude novo para o hook-proof-run derruba
   a suite do canal (a classe: silenciar uma suite de contrato local); (3)
   MUTATION — remover o glob scripts do include derruba TODAS (a classe: o
   glob do canal nunca encolhe).

**A relação com a 11.73/11.82**: a 11.73 trava o lado do push net (o que
NÃO entra no test:guard), a 11.82 pina a lista curada dele, esta sec trava
o lado local (o que DEVE estar no test:unit) — o par fica completo nos
dois lados da divisão: o mesmo conceito de superfície curada, pinado de
ambos os lados. A divisão não é só "não poluir o push net" — é também "o
canal local nunca perde uma suite de contrato".

Esta sec 11.83 é claim-free por desenho (decisão de forma de contrato, não
de código de saída — nenhum exit code citado) — sem entrada no EXIT_CLAIMS,
o count do manifest permanece 28.


## 11.84 ADOTADO — o guard de forma do FATO CONSUMIDO: todo uso do
revertLeftNote recebe o stage do retorno do revertCycle (.stage), nunca um
literal que travaria o dispatch (avaliação 2026-08-12)

**Pedido**: a sec 11.71 deriva os call sites do `revertCycle` e pina o
envelope `LeftNote` (todo chamador anexa uma nota de saída), mas nada pina
que TODO uso do `revertLeftNote` recebe o stage do RETORNO do `revertCycle`
(`rv.stage` / `reverted.stage` — o fato consumido). Um uso com o stage
HARDCODED (ex.: `revertLeftNote("apply", ...)` no `cleanupOnFailSuffix`)
passaria nos guards existentes — o envelope da 11.71 só exige uma nota
`LeftNote`, não que o stage seja o do retorno — e TRAVARIA o dispatch
stage-aware da sec 11.75 (o status-fail receberia a CURE do apply, a classe
da Prova 46 reabrindo no stage errado). Avaliar um teste de forma que derive
os usos da função e prove que todos passam o stage derivado.

**O veredito (ADOTADO — o guard do fato consumido)**: o guard mora na
suite hook-proof-run.test.ts (describe sec 11.84), no padrão da 11.65/11.71
(a derivação dos fatos consumidos do source): `useSites(src)` extrai toda
linha com `revertLeftNote(` excluindo a definição (`export function`), e o
pin `stageFromReturn` exige que o 1º argumento seja `(rv|reverted).stage,`
— a propriedade .stage do retorno do `revertCycle`, NUNCA um literal de
string. Os 2 usos reais (o `cleanupOnFailSuffix` com `rv.stage` e o
revert-fail do main com `reverted.stage`) são pinados um a um, e as 2
MUTATIONs provam a sensibilidade: hardcodar `"apply"` no cleanup ou
`"status"` no revert-fail do main → 1 offender com o caminho exato — o
dispatch stage-aware não pode travar por um literal. A classe fechada: o
stage é SEMPRE um fato consumido do retorno, nunca uma constante.

Esta sec 11.84 é claim-free por desenho (decisão de forma de contrato, não
de código de saída — nenhum exit code citado) — sem entrada no EXIT_CLAIMS,
o count do manifest permanece 28.

**Re-validação**: `npx vitest run scripts/__tests__/hook-proof-run.test.ts scripts/__tests__/proof-helpers-contract.test.ts scripts/__tests__/scan-exit-claims.test.ts scripts/__tests__/gates-proofs-ordering.test.ts --config vitest.config.unit.ts` + `npx tsc --noEmit` + `node scripts/scan-exit-claims.mjs --check` (clean 28 claims) + UTF-8 do doc + ASCII do .mjs + ordering 11.83 → 11.84 → 12 monotono.

## 11.85 ADOTADO — os knobs irmãos do revertCycle: os 4 fail paths fechados com E2E hermético (a matriz da 11.76 completa)

**O pedido**: o knob HOOK_PROOF_FAKE_FAIL_APPLY (sec 11.76) fechou o apply-fail com E2E hermético, mas os outros 3 fail paths do revertCycle (checkout, branch -D, status divergente) seguiam só por síntese (a matriz de stages da 11.75). A pergunta: knobs irmãos (FAIL_CHECKOUT / FAIL_BRANCH_D / FAIL_STATUS) + E2Es na mesma matriz da 11.76, fechando os 4 fail paths com comportamento hermético — ou documentar por que o apply é o único com seam de injeção limpo.

**O veredito**: ADOTADO — os 4 fail paths TÊM seams de injeção limpos no fixture, e os 3 knobs irmãos foram adicionados ao hook-proof-fake-bins.mjs: FAIL_CHECKOUT (o `git checkout <orig>` do REVERT falha — o `checkout -b` da scratch NÃO é afetado, só o simples), FAIL_BRANCH_D (o `git branch -D` do REVERT falha) e FAIL_STATUS (o `git status --porcelain` do REVERT diverge do snapshot). O knob do status é o mais sutil: o `git status` roda DUAS vezes no ciclo — o backup (antes do checkout do revert, snapshot normal) e o revert (depois). O knob usa o sinal de estado `state.reverting` (setado pelo checkout do revert) para divergir SÓ na segunda chamada, deixando o snapshot do backup íntegro — sem o sinal, o knob contaminaria o próprio snapshot e o fail nunca dispararia no stage certo.

**Os 3 E2Es novos (a forma da 11.76)**:
- CHECKOUT → fail-loud com `git checkout base falhou` + backup apontado + a receita GENERICA (`git checkout base && git branch -D ...` — a scratch AINDA existe, o branch -D nunca rodou) e SEM o reflog (a scratch não foi deletada com o delta dentro — o contraste exato com o apply-fail). Ordem no invocations.log: checkout base rodou (e falhou), branch -D NUNCA, apply NUNCA.
- BRANCH_D → fail-loud com `git branch -D ... falhou` + backup + a receita GENERICA (a scratch ainda existe) e SEM o reflog; ordem: checkout base → branch -D (falhou), apply NUNCA.
- STATUS → fail-loud com `git status divergiu do snapshot pre-ciclo` + backup + a CURE do SNAPSHOT (`PASSou` + `status-before.txt` — o apply do delta JÁ passou, o delta está na árvore) e SEM a receita generica (o branch -D já rodou); ordem: checkout base → branch -D → apply (o delta estava na árvore) → status divergiu.

**A classe fechada**: a matriz de stages da 11.75 agora tem comportamento hermético nos 4 fail paths (não só síntese + as provas vivas 43/46 do apply/status): cada stage recebe a CURE que descreve o estado REAL do repo — scratch existente (checkout/branch -D), scratch deletada com o delta órfão no reflog (apply), delta já aplicado na árvore (status).

Esta sec 11.85 é claim-free por desenho (decisão de forma de contrato, não de código de saída — nenhum exit code citado) — sem entrada no EXIT_CLAIMS, o count do manifest permanece 28.

**Re-validação**: `npx vitest run scripts/__tests__/hook-proof-run.test.ts scripts/__tests__/proof-helpers-contract.test.ts scripts/__tests__/scan-exit-claims.test.ts scripts/__tests__/gates-proofs-ordering.test.ts --config vitest.config.unit.ts` + `npx tsc --noEmit` + `node scripts/scan-exit-claims.mjs --check` (clean 28 claims) + `node scripts/proofs-manifest.mjs --check` (clean 46 provas) + UTF-8 do doc + ASCII do fixture + ordering 11.84 → 11.85 → 12 monotono.

## 11.86 ADOTADO — o PAR vivo/hermético do apply-fail: o stderr do knob = o stderr real da Prova 43 (a equivalência vira contrato)

**O pedido**: a Prova 43 (viva, sec 8.38) e o E2E da 11.76 (hermético) provam o MESMO apply-fail, mas o registro vivo foi citado sem re-validar contra o novo knob — nada garantia que o fake reproduz o erro REAL do git: uma mensagem aproximada no fixture passaria nos asserts genéricos da 11.76 (`git apply delta.patch falhou` + `backup em` + `reflog`). O pedido: um teste que prove a equivalência — o stderr do fake com o knob = o stderr real da Prova 43 (mesma mensagem `No valid patches` + backup + CURE), travando o par vivo/hermético como o mesmo comportamento.

**O veredito**: ADOTADO — a equivalência vira contrato em 2 camadas:
1. **A 3-via do texto (REAL-REPO doc read)**: a mensagem `error: No valid patches in input (allow with "--allow-empty")` existe VERBATIM no registro vivo da sec 8.38 E no fixture — o knob copiou o erro do git real, não uma aproximação. Se o git real mudar a mensagem (ou alguém "melhorar" o texto do fixture), o par quebra em vez de driftar silenciosamente.
2. **O núcleo no stderr hermético (E2E)**: o ciclo com o knob produz o MESMO núcleo do stderr vivo — `git apply delta.patch falhou: error: No valid patches in input (allow with "--allow-empty") - backup em <dir>` — o prefixo do revertCycle + a mensagem do git real verbatim + o backup apontado (o path em si varia por ambiente e fica fora do pin).

**A fronteira honesta (a classe SUPERSEDED)**: o SUFIXO do stderr (a CURE) evoluiu APÓS a Prova 43 — o registro vivo (sec 8.38) mostra a receita genérica pré-11.75 (`a branch scratch pode ter ficado: git checkout ... && git branch -D ...`) e o comportamento atual é a CURE 2-NÍVEIS da sec 11.75 (reflog + cherry-pick). O teste pina o NÚCLEO ESTÁVEL (o erro do git + o backup — o que a equivalência vivo/hermético significa) e pina a CURE atual (2-NÍVEIS) como o comportamento de hoje; a Prova 43 segue como registro de EVENTO histórico (a classe das secs 8.x, não claim de comportamento atual — a fronteira da 11.51).

Esta sec 11.86 é claim-free por desenho (decisão de forma de contrato, não de código de saída — nenhum exit code citado) — sem entrada no EXIT_CLAIMS, o count do manifest permanece 28.

**Re-validação**: `npx vitest run scripts/__tests__/hook-proof-run.test.ts scripts/__tests__/proof-helpers-contract.test.ts scripts/__tests__/scan-exit-claims.test.ts scripts/__tests__/gates-proofs-ordering.test.ts --config vitest.config.unit.ts` + `npx tsc --noEmit` + `node scripts/scan-exit-claims.mjs --check` (clean 28 claims) + `node scripts/proofs-manifest.mjs --check` (clean 46 provas) + UTF-8 do doc + ASCII do fixture + ordering 11.85 → 11.86 → 12 monotono.

## 11.87 ADOTADO — o PAR de conversão fechado: o cleanupOnFailSuffix FALHA no revert com a CURE do reflog no MESMO canal do revert-fail do main

**O pedido**: o revert-fail do main() e o cleanupOnFailSuffix (sec 11.69 — o sufixo dos fail paths de MUTAÇÃO com --cleanup-on-fail) usam a MESMA revertLeftNote stage-aware, mas o cleanup só tinha prova sintética (a matriz da 11.75) — o E2E da 11.69 provou o caminho de SUCESSO do revert dentro do cleanup (rv.ok → `cleanup-on-fail: revertido`), nunca o caminho de FALHA (rv.ok false → `cleanup-on-fail FALHOU` + revertLeftNote). Com o knob HOOK_PROOF_FAKE_FAIL_APPLY (11.76/11.85), o par de conversão pode ser fechado hermeticamente.

**O veredito**: ADOTADO — o E2E novo prova o canal de falha do cleanup: `--cleanup-on-fail` + `--mutate` com comando que falha (o fail path de mutação dispara o cleanupOnFailSuffix) + `HOOK_PROOF_FAKE_FAIL_APPLY=1` (o revertCycle DENTRO do cleanup falha no apply). O sufixo vira `cleanup-on-fail FALHOU: git apply delta.patch falhou: <mensagem do git real> - backup em <dir>` + `revertLeftNote(rv.stage=apply)` — a CURE 2-NÍVEIS do reflog — no MESMO canal e com o MESMO shape de mensagem do revert-fail do main (a sec 11.76): checkout base → branch -D → apply falhou no invocations.log.

**O par fechado**: os DOIS pontos de conversão do `{ ok: false }` do revertCycle (o revert-fail do main, sec 11.65/11.75, e o cleanupOnFailSuffix, sec 11.69) agora têm E2E hermético com a MESMA CURE stage-aware e a MESMA assinatura de mensagem — a 11.84 pina a origem do stage por forma (todo uso recebe `rv.stage`/`reverted.stage`), a 11.87 pina o comportamento do 2º ponto de conversão no mesmo canal.

Esta sec 11.87 é claim-free por desenho (decisão de forma de contrato, não de código de saída — nenhum exit code citado) — sem entrada no EXIT_CLAIMS, o count do manifest permanece 28.

**Re-validação**: `npx vitest run scripts/__tests__/hook-proof-run.test.ts scripts/__tests__/proof-helpers-contract.test.ts scripts/__tests__/scan-exit-claims.test.ts scripts/__tests__/gates-proofs-ordering.test.ts --config vitest.config.unit.ts` + `npx tsc --noEmit` + `node scripts/scan-exit-claims.mjs --check` (clean 28 claims) + `node scripts/proofs-manifest.mjs --check` (clean 46 provas) + UTF-8 do doc + ASCII do fixture + ordering 11.86 → 11.87 → 12 monotono.

## 11.88 ADOTADO — o REVERT AUTO-CURATIVO: --apply-safety-diff-on-fail tenta o safety diff automaticamente no apply-fail (a Prova 43 vira comportamento do ciclo)

**O pedido**: o revertCycle usa SÓ o delta.patch do backup no apply — o safety diff da 11.77 é recuperação MANUAL no fail (a CURE cita o caminho e o usuário aplica à mão; a classe da Prova 43, sec 8.38, era 100% manual). O pedido: um --apply-safety-diff-on-fail que, no apply-fail do revertCycle, tente o safety diff AUTOMATICAMENTE antes de falhar — o revert vira auto-curável, com o teste hermético do knob provando o fallback.

**O veredito**: ADOTADO — a flag transforma a recuperação da Prova 43 em comportamento do ciclo:
1. **A flag (parseArgs)**: `--apply-safety-diff-on-fail` (default false — a recuperação manual continua o padrão). O par flag + `--safety-diff <path>`: a flag sozinha é inerte (o revertCycle não tem o path para tentar).
2. **O revertCycle auto-curativo**: no apply-fail do delta.patch, se `applySafetyDiffOnFail && safetyDiff`, o revert tenta `git apply <safetyDiff>` ANTES do fail. Se o safety diff SUCCEDE, o ciclo completa (untracked + doc do byte-copy + status identico — o revert byte-identical normal) e o ciclo sai em SUCESSO (o sinal muda de 'perda de delta' para 'ciclo normal'). Se o safety diff TAMBÉM falha, a mensagem cita as DUAS falhas + backup (a auto-cura NÃO mascara a perda real de patch). Os DOIS call sites do revertCycle (o revert-fail do main e o cleanupOnFailSuffix) recebem a flag do opts (o padrão do fato consumido da sec 11.84).
3. **O knob hermético da auto-cura**: `HOOK_PROOF_FAKE_FAIL_APPLY_DELTA_ONLY` — só o apply do delta.patch do backup falha (o fixture distingue pelo SUFIXO do path: o delta.patch vive no backupDir, o safety diff é um path externo arbitrário) — o seam que permite provar o fallback SEM o FAIL_APPLY genérico.

**Os 2 E2Es herméticos (na forma da 11.77)**:
- AUTO-CURA: `--apply-safety-diff-on-fail` + `FAIL_APPLY_DELTA_ONLY=1` → o patch do backup FALHA e o safety diff é aplicado AUTOMATICAMENTE → ciclo completo em SUCESSO; invocations.log mostra checkout base → branch -D → apply do delta.patch (falhou) → apply do safety diff (sucedeu) — o 2º apply é o do path EXTERNO resolvido; doc restaurado do byte-copy (o fallback NÃO interrompe a restauração).
- CONTRAPARTE: `FAIL_APPLY=1` (o safety diff TAMBÉM falha) → fail-loud com `git apply delta.patch falhou` + `E o safety diff <path> tambem falhou` + backup apontado + a CURE stage-aware da 11.75 (reflog/cherry-pick) — quando a auto-cura não resolve, o usuário ainda tem a receita.

**A fronteira honesta**: a auto-cura é um FALLBACK, não um substituto do backup — o delta.patch do backup continua a fonte primária; o safety diff só entra quando o patch do backup falha E a flag foi pedida explicitamente. A classe da Prova 43 (patch corrompido de propósito) continua coberta: com a flag, o ciclo se auto-cura (sucesso); sem a flag, o comportamento antigo (fail-loud + CURE manual) é preservado.

Esta sec 11.88 é claim-free por desenho (decisão de forma de contrato, não de código de saída — nenhum exit code citado) — sem entrada no EXIT_CLAIMS, o count do manifest permanece 28.

**Re-validação**: `npx vitest run scripts/__tests__/hook-proof-run.test.ts scripts/__tests__/proof-helpers-contract.test.ts scripts/__tests__/scan-exit-claims.test.ts scripts/__tests__/gates-proofs-ordering.test.ts --config vitest.config.unit.ts` + `npx tsc --noEmit` + `node scripts/scan-exit-claims.mjs --check` (clean 28 claims) + `node scripts/proofs-manifest.mjs --check` (clean 46 provas) + UTF-8 do doc + ASCII do fixture e do .mjs + ordering 11.87 → 11.88 → 12 monotono.

## 11.89 ADOTADO — o SAFETY-BACKUP: --safety-backup <dir> espelha o backup INTEIRO num path externo (o safety do ciclo completo, não só do diff)

**O pedido**: o --safety-diff (11.77) salva SÓ o diff — mas os untracked (que a Prova 43, sec 8.38, também citou como parte da recuperação: os arquivos não-rastreados do byte-copy) e o status-before continuam só no backupDir do tmpdir. Se o tmpdir não sobreviver (ou o backupDir for perdido), a recuperação do ciclo completo perde untracked + status. O pedido: um --safety-backup <dir> que espelhe o backup inteiro (delta.patch + untracked + status-before) num path externo — o safety do ciclo completo, não só do diff, fechando a classe de perda total do delta.

**O veredito**: ADOTADO — a flag espelha o backup INTEIRO num path externo ao tmpdir:
1. **A flag (parseArgs)**: `--safety-backup <dir>` (default null — o espelho é opt-in; o backup vive só no tmpdir). Independe do --safety-diff (as 3 flags de safety coexistem: diff + auto-cura da 11.88 + backup inteiro). O dir é resolvido UMA vez (o padrão do fato consumido da sec 11.84 — o path absoluto citado na mensagem).
2. **O espelho**: APÓS o backup completo da etapa 2 (delta.patch + untracked/ + status-before.txt + doc-before.md) e ANTES de qualquer mutação — a cópia do estado PRE-mutação: mkdirSync recursive no dir + walk recursivo copiando o backupDir inteiro. Fail-loud no dir não-gravável (o MESMO padrão do safety-diff, sec 11.77: o ENOENT/EEXIST cru fora do contrato de exit code vira fail(3) com a mensagem `safety backup nao gravavel em <dir>`).
3. **A relação com as irmãs**: o --safety-diff (11.77) cobre SÓ o diff (o patch que o revert precisa); o --apply-safety-diff-on-fail (11.88) automatiza a aplicação desse diff; o --safety-backup (11.89) cobre o ciclo COMPLETO (diff + untracked + status + doc) — a recuperação manual da classe de perda total não depende do tmpdir sobreviver.

**Os 2 E2Es herméticos (na forma da 11.77/11.88)**:
- ESPELHO: `--safety-backup <dir>` → os 3 artefatos do backup (delta.patch com o conteúdo do diff + status-before.txt com o snapshot + doc-before.md com o byte-copy do doc) espelhados byte-identical no dir EXTERNO; o ciclo completa em SUCESSO (DONE) e o doc é restaurado do byte-copy (o espelho NÃO interfere no revert).
- CONTRAPARTE fail-loud: `--safety-backup` num dir cujo pai não existe → fail-loud com `safety backup nao gravavel` (o try/catch converte o ENOENT em contrato, não deixa cru).

**A fronteira honesta**: o espelho é uma CÓPIA do backup no momento do backup (PRE-mutação) — a recuperação manual a partir dele restaura o estado exato do início do ciclo; não é um mecanismo de auto-cura (essa é a 11.88, do diff) nem uma fonte de verdade alternativa durante o ciclo — é o safety do ciclo completo para a classe de perda total do delta. **O boundary da prova**: o untracked/ é espelhado POR DESENHO (o walk do espelho é recursivo sobre o backupDir inteiro), mas os E2Es herméticos só pinam os 3 artefatos determinísticos (delta.patch + status-before + doc-before) — o fixture hermético não produz untracked sem poluir a working tree (o loop de cópia do backup pula fontes inexistentes); o espelhamento de untracked fica coberto pelo walk genérico, não por assert E2E.

Esta sec 11.89 é claim-free por desenho (decisão de forma de contrato, não de código de saída — nenhum exit code citado) — sem entrada no EXIT_CLAIMS, o count do manifest permanece 28.

**Re-validação**: `npx vitest run scripts/__tests__/hook-proof-run.test.ts scripts/__tests__/proof-helpers-contract.test.ts scripts/__tests__/scan-exit-claims.test.ts scripts/__tests__/gates-proofs-ordering.test.ts --config vitest.config.unit.ts` + `npx tsc --noEmit` + `node scripts/scan-exit-claims.mjs --check` (clean 28 claims) + `node scripts/proofs-manifest.mjs --check` (clean 46 provas) + UTF-8 do doc + ASCII do .mjs e do fixture + ordering 11.88 → 11.89 → 12 monotono.


## 11.90 ADOTADO — o guard de forma do GUARD_SUITE_MAP: a suite mapeada DEVE existir E o mapa NAO pode ter entrada orfa (o mapa das excecoes fechado nos dois sentidos)

**O pedido**: o GUARD_SUITE_MAP (sec 11.78 — as 2 excecoes da convencao `<stem>.test.ts` medidas em 2026-08-12: `run-mapped-fuzz.mjs` → `fuzz-mapped.test.ts` e `scan-lucide-icons.mjs` → `scan-batch-coverage.test.ts`) nasceu porque 2 guards wired quebram a convencao, mas NENHUM guard pina o mapa em si: a suite mapeada podia apontar pro vazio (uma suite renomeada/removida do fs deixava o mapa com pin morto), um guard destituido dos hooks podia deixar a entrada orfa (o mapa so existe para guards wired), e uma suite mapeada podia nao pertencer a nenhum guard wired (crescimento do mapa em vao). O pedido: fechar o crescimento nos DOIS sentidos — a suite mapeada DEVE existir E o mapa NAO pode ter entrada orfa.

**O veredito**: ADOTADO — o guard `mapContractViolations` (no wired-guards-contract.test.ts, a suite da sec 11.78) deriva as violacoes do mapa real em 2 direcoes, por entrada:
1. **direcao A (entrada → suite)**: (1) o guard do mapa precisa estar wired HOJE (um guard destituido dos hooks deixa a entrada orfa — o mapa so existe para guards wired) E (2) a suite mapeada precisa EXISTIR em scripts/__tests__ (a suite existe no fs — o pin nunca aponta pro vazio; o MUTATION do suite dir vazio prova que TODA entrada flagra quando a suite some).
2. **direcao B (suite → entrada)**: a suite mapeada precisa ser a suite RESOLVIDA de pelo menos UM guard wired (o conjunto-fato `resolvedSuites` deriva `suiteOf(g)` do wired atual — a suite que nenhum guard wired resolve e orfa; o MUTATION com mapa mutado apontando para `fragile-range-guard.test.ts` — suite REAL que existe no fs mas nenhum guard wired resolve — prova a direcao B isolada, sem `suite mapeada inexistente` nem `guard nao wired`).

**A estrutura**: `mapContractViolations({ map?, wired, suiteDir? })` — puro, com injecao de mapa (o MUTATION passa copia mutada), wired (o MUTATION filtra um guard) e suiteDir (o MUTATION do dir vazio) — o padrao de injecao da sec 11.78. O ABS PIN do mapa (as 2 entradas exatas) trava a lista: adicionar um 3o guard de suite fora da convencao exige editar o pin conscientemente (o mesmo padrao do PROOF_HELPERS da 11.72 e do WIRED ALLOWLIST da 11.60).

**A fronteira honesta**: o guard pina o MAPA (as excecoes da convencao) — nao pina a convencao em si (o fallback `<stem>.test.ts` continua sendo a regra dos 16 guards, derivada em `suiteOf`) nem a cobertura das suites (a parte 2 da sec 11.78 — test:guard vs test:unit — segue separada). O guard fecha o crescimento do mapa nos dois sentidos: uma suite que some flagra a direcao A, uma suite que nenhum guard wired resolve flagra a direcao B, um guard destituido flagra as duas. **Um detalhe honesto da relacao A/B**: no mapa REAL, a direcao B nunca dispara sozinha sem a A (um guard wired resolve a PRÓPRIA suite mapeada — `suiteOf(guard)` = a entrada do mapa, entao a suite sempre pertence ao conjunto resolvido); a B so dispara independente sob um mapa MUTADO — exatamente o que o MUTATION da direcao B isolada prova — o que a torna um cinto-e-suspensorio pedido explicitamente (a classe 'suite orfa' fica provada como mecanismo, mesmo que no estado real seja consequencia da A).

Esta sec 11.90 é claim-free por desenho (decisao de forma de contrato, nao de codigo de saida — nenhum exit code citado) — sem entrada no EXIT_CLAIMS, o count do manifest permanece 28.

**Re-validacao**: `npx vitest run scripts/__tests__/wired-guards-contract.test.ts scripts/__tests__/gates-proofs-ordering.test.ts scripts/__tests__/scan-exit-claims.test.ts --config vitest.config.unit.ts` + `npx tsc --noEmit` + `node scripts/scan-exit-claims.mjs --check` (clean 28 claims) + `node scripts/proofs-manifest.mjs --check` (clean 47 provas) + UTF-8 do doc + ASCII do test + ordering 11.89 → 11.90 → 12 monotono.


## 11.91 ADOTADO — a assimetria registry -> wired pinada: toda classe cujo module e guard de hook REAL esta na derivacao wired; os helpers NAO (a fronteira documentada travada nos dois lados)

**O pedido**: a sec 11.78 pina `wired -> registry` (todo guard wired tem entrada no PROOF_CLASSES ou WIRED_ALLOWLIST — o checkWiredSurface da sec 11.60). O INVERSO (`registry -> wired`) e excluido por desenho — documentado no header do manifest: classes helper (ci-proof-run, hook-proof-run, doc-revalidate, run-all-fuzz) tem Prova mas NAO sao guard de hook (o check-js-budget e a excecao de COMPOSICAO: guard real dentro do pre-commit-tests.mjs, fora da superficie derivada sem recursao). Mas a fronteira vivia SO em prosa: nada travava que um guard REAL sumisse da derivacao (regex quebrado) nem que um helper virasse wired por engano.

**O veredito**: ADOTADO — o guard `asymmetryViolations` (no proofs-manifest.test.ts, a suite da sec 11.60) pina a assimetria nos DOIS lados:
1. **O positivo (registry -> wired para guards REAIS)**: toda classe cujo module e script (.mjs/.sh) E referenciado nas fontes wired (hooks + batch runner + net, linhas NAO-comentadas) DEVE estar em `deriveWiredGuards()` — o MUTATION prova com `./scripts/scan-guard-gates.mjs` (o form fora do WIRED_SPAWN_RE: referenciado nas fontes mas a derivacao nao pega → flagra `referenciado nas fontes wired mas NAO derivado`).
2. **O negativo (helpers fora)**: toda classe SEM referencia real nas fontes NAO pode estar na derivacao — e a LISTA da exclusao e DERIVADA das fontes (o padrao TARGET_DIRS consumido: `excludedHelperClasses()` = script modules sem referencia), pinada por conteudo: as 5 classes (`check-js-budget.mjs` da composicao + as 4 helpers `ci-proof-run`, `hook-proof-run`, `doc-revalidate`, `run-all-fuzz`) — editar a fronteira exige editar o pin. O MUTATION negativo prova o comportamento: spawnar um helper num hook sintetico (`node scripts/ci-proof-run.mjs`) faz a derivacao o PEGAR e a classe sumir da exclusao — a fronteira so e rompida por edicao consciente do hook, nunca por shape.

**A fronteira honesta**: o guard pina a RELACAO registry↔wired — nao pina o conteudo dos hooks em si (a derivacao segue sendo a fonte dos guards reais) nem a lista de helpers por shape (a exclusao e derivada das fontes, nao hardcoded — se um helper for spawnado de verdade, ele DEIXA de ser helper e vira wired, que e exatamente o comportamento correto). As classes estruturais (workflow yml, hook file, suite de teste) ficam fora por shape (.mjs/.sh — o filtro do script module). **Um detalhe honesto da relacao positivo/negativo**: a direcao NEGATIVA (derivado sem referencia nas fontes) nunca dispara em estados reais — o deriveWiredGuards SO adiciona modulos encontrados nas fontes varridas (spawns/imports/steps, com comentarios filtrados), entao todo basename derivado esta NECESSARIAMENTE no texto nao-comentado; ela e um cinto-e-suspensorio simetrico que so dispara sob condicoes sinteticas — o MUTATION positivo prova o lado REAL (a derivacao perdendo um guard referenciado por forma de spawn), o negativo prova o mecanismo do lado do helper.

Esta sec 11.91 é claim-free por desenho (decisao de forma de contrato, nao de codigo de saida — nenhum exit code citado) — sem entrada no EXIT_CLAIMS, o count do manifest permanece 28.

**Re-validacao**: `npx vitest run scripts/__tests__/proofs-manifest.test.ts scripts/__tests__/wired-guards-contract.test.ts scripts/__tests__/gates-proofs-ordering.test.ts --config vitest.config.unit.ts` + `npx tsc --noEmit` + `node scripts/scan-exit-claims.mjs --check` (clean 28 claims) + `node scripts/proofs-manifest.mjs --check` (clean 47 provas) + UTF-8 do doc + ASCII do test + ordering 11.90 → 11.91 → 12 monotono.


## 11.92 ADOTADO — a INVERSAO da 11.79 aplicada ao mapa das excecoes da convencao: as CHAVES do GUARD_SUITE_MAP sao DERIVADAS do fs (os guards wired cuja suite convencional `<stem>.test.ts` NAO existe), os VALORES seguem pin semantico (a suite onde o contrato mora)

**O pedido**: a sec 11.79 inverteu o PROOF_HELPERS (o manifest nasce do package.json, nao de lista hardcoded — a fonte unica elimina a lista manual). O GUARD_SUITE_MAP da sec 11.78 (as 2 excecoes da convencao `<stem>.test.ts` nos guards wired: `run-mapped-fuzz.mjs` → `fuzz-mapped.test.ts` e `scan-lucide-icons.mjs` → `scan-batch-coverage.test.ts`) seguia um pin EXPLICITO — avaliar se a mesma inversao se aplica: derivar o mapa do proprio fs (suite que existe vs convencao quebrada) em vez de lista hardcoded.

**O veredito**: ADOTADO PARCIAL — a inversao se aplica as CHAVES, nao aos VALORES. A divisao e honesta e medida (probe 2026-08-12):
1. **As CHAVES sao derivadas do fs** (`derivedMapKeys`): o conjunto dos guards wired cuja suite convencional `<stem>.test.ts` NAO existe em scripts/__tests__ — a convencao quebrada medida, nao uma lista. O probe confirmou exatamente os 2 conhecidos (18 wired, 16 com suite convencional + 2 sem). Um 3o guard com suite fora da convencao que nascer nos hooks ENTRA na derivada sozinho — e a direcao C do mapaContractViolations flagra `convencao quebrada sem entrada no mapa` (a lista nao existe para esquecer de editar, o padrao 11.79).
2. **Os VALORES seguem pin semantico** (o fs prova QUEM quebra a convencao, mas NAO ONDE o contrato mora): o content-scan e ambiguo — `run-mapped-fuzz` e referenciado por 9 suites em scripts/__tests__, `scan-lucide-icons` por 3 (probe 2026-08-12); derivar o valor por conteudo escolheria a suite errada. O valor e a decisao de design (a suite onde o pin do contrato do guard vive), nao um fato do fs.

**A implementacao** (na wired-guards-contract.test.ts, o guard da sec 11.78): o const `GUARD_SUITE_VALUES` (so os 2 valores) + `derivedMapKeys(wired)` (as chaves medidas) + `suiteOf` (valores ou fallback `<stem>.test.ts`) + o mapaContractViolations com 2 direcoes NOVAS alem das A/B da 11.90:
- **C. chave derivada -> entrada**: todo guard wired sem suite convencional no fs DEVE ter entrada (o 3o exception nasce flagrado);
- **D. entrada -> chave derivada**: toda entrada cujo guard TEM a suite convencional existente e DESNECESSARIA (se `<stem>.test.ts` nasceu, o fallback resolve e a excecao morreu — o espelho do ABANDONO da excecao).
Os testes: o ABS PIN agora pina a IGUALDADE chaves-derivadas == chaves-do-mapa (a fonte e o fs, nao uma copia) + os MUTATIONs das direcoes C (fake-guard.mjs sem suite convencional e sem entrada) e D (scan-batch-coverage.mjs com a suite convencional existente — a entrada morta flagra).

**A fronteira honesta**: o guard pina a RELACAO fs ↔ valores — nao pina que os valores estao certos (a suite onde o contrato mora e decisao de design, documentada nos comentarios do GUARD_SUITE_VALUES) nem a cobertura test:guard/test:unit das suites mapeadas (isso e a parte 2 da sec 11.78, inalterada). As chaves derivadas SEMPRE medem o fs REAL (o suiteDir dos MUTATIONs testa a existencia das suites mapeadas, nunca a derivacao das chaves). **O detalhe honesto da relacao C/D**: no estado real as duas direcoes sao complementares e a derivada == o mapa (2 == 2); C so dispara sob um guard novo (crescimento), D so sob uma suite convencional que nasceu apos a excecao (encolhimento) — o par cinto-e-suspensorio da fronteira medida.

Esta sec 11.92 é claim-free por desenho (decisao de forma de contrato, nao de codigo de saida — nenhum exit code citado) — sem entrada no EXIT_CLAIMS, o count do manifest permanece 28.

**Re-validacao**: `npx vitest run scripts/__tests__/wired-guards-contract.test.ts scripts/__tests__/gates-proofs-ordering.test.ts scripts/__tests__/scan-exit-claims.test.ts --config vitest.config.unit.ts` + `npx tsc --noEmit` + `node scripts/scan-exit-claims.mjs --check` (clean 28 claims) + `node scripts/proofs-manifest.mjs --check` (clean 47 provas) + UTF-8 do doc + ASCII do test + ordering 11.91 → 11.92 → 12 monotono.


## 11.93 ADOTADO — o 9o guard do batch: o CONTRATO 11.72 executado no pre-commit (scan-proof-helpers.mjs, o tripwire da edicao acidental do bloco 'Exit codes:')

**O pedido**: as Provas 44 (hook-proof-run) e 48 (ci-proof-run) provaram o guard da sec 11.72 ao vivo — mas o arquivo real dos helpers seguia vulneravel a edicao acidental do bloco 'Exit codes:' do docblock: a suite da 11.72 so roda via test:unit (no CI/push), entao um refactor que removesse o bloco passaria o commit local e so falharia no push. Avaliar um guard que rode a suite da 11.72 no pre-commit quando hook-proof-run.mjs/ci-proof-run.mjs mudarem (o padrao do tripwire do scan-exit-claims, sec 11.42/11.56).

**O veredito**: ADOTADO com REFINAMENTO — o invariante da sec 11.42 (guards baratos NAO ganham condicao por arquivo) supersede a premissa da condicao por diff: o guard roda INCONDICIONALMENTE como 9o membro do batch. A condicao por arquivo seria furada pelo proprio cenario que protege (o hook nao recebe diff confiavel — a edicao acidental NAO avisa nada) e adicionaria um caminho de teste por guard; o custo do scan e ~15-25ms de fs + regex com o boot compartilhado, o mesmo calculo que manteve o scan-exit-claims incondicional.

**A implementacao**: `scripts/scan-proof-helpers.mjs` e o EXECUTAVEL do contrato 11.72 — deriva os helpers do package.json (os scripts `*-proof:run`, a derivada da sec 11.79) e checa as 3 partes sobre o repo real: (1) exit codes 0-3 documentados no docblock (EXIT_CODES_RE); (2) nota de limpeza definida (NOTE_DEF_RE, o LeftNote); (3) E2E do caminho na suite (FAKE_BIN_RE + FAIL_EXIT_RE). **A fonte unica** (a regra dos 2 usos): a derivada e os 4 regexes vivem no guard e a proof-helpers-contract.test.ts os IMPORTA (nunca redefine) — o guard e a suite nao podem driftar, a mesma filosofia do EXIT_CLAIMS importado pelo scan-exit-claims.test.ts. O batch roda o main() do guard como 9o membro (depois do exit-claims): edicao acidental do bloco 'Exit codes:' num helper real -> exit code 1 com o caminho exato ANTES do commit.

**Exit codes**: exit code 0 (todos os helpers com as 3 partes) / exit code 1 (violacoes listadas com o caminho — o bloco 'Exit codes:' mutado, o MESMO alvo das Provas 44/48) / exit code 2 (uso errado).

**A cascata (growth contracts, o desenho que o pedido disparou)**: DERIVATION PIN do batch 8 → 9; wired 18 → 19 (o import novo no runner deriva sozinho, sec 11.60); WIRED_ALLOWLIST 7 → 8 (o guard sem Prova dedicada — contrato suite-pinned, o padrao do scan-batch-coverage); GUARD_SUITE_VALUES ganha a 3a excecao (scan-proof-helpers.mjs → proof-helpers-contract.test.ts — a suite da 11.72 NAO segue a convencao `<stem>.test.ts`; a INVERSAO da sec 11.92 derivou a chave nova automaticamente do fs, a classe funcionou ao vivo no 1o uso); EXIT_CLAIMS 28 → 29 (esta secao e claim-bearing, a 29a claim — o count citado nas revals da 8.34/8.35 re-calibrado pela reval cascade da sec 11.66/11.67).

Esta sec 11.93 é claim-BEARING (o guard novo tem exit codes 0/1/2 reais) — registrada no EXIT_CLAIMS (kind current, pin na suite do batch), o count do manifest sobe para 29.

**Re-validacao**: `node scripts/scan-proof-helpers.mjs --check` (clean 2 helpers) + `npx vitest run scripts/__tests__/proof-helpers-contract.test.ts scripts/__tests__/run-precommit-guards.test.ts scripts/__tests__/scan-batch-coverage.test.ts scripts/__tests__/wired-guards-contract.test.ts scripts/__tests__/proofs-manifest.test.ts scripts/__tests__/scan-exit-claims.test.ts scripts/__tests__/gates-proofs-ordering.test.ts --config vitest.config.unit.ts` + `npx tsc --noEmit` + `node scripts/scan-exit-claims.mjs --check` (clean 29 claims) + `node scripts/proofs-manifest.mjs --check` (clean 19 classes / 48 provas / 19 wired) + UTF-8 do doc + ASCII dos tests + ordering 11.92 → 11.93 → 12 monotono.


## 11.94 ADOTADO — scripts/proof-register.mjs: o registro de prova local num comando (avaliacao 2026-08-12)

O registro de prova LOCAL foi repetido 7+ vezes na thread (Provas 40, 41, 43, 44, 46, 47, 48 — todas run null, sec 8.x) e cada um exigiu 3+ edits (a entrada do PROOF_CLASSES, a tupla do ABS_PIN_SNAPSHOT, os 4 count pins do teste, a row da tabela ## 1, a sec 8.x). A Prova 48 provou a classe de erro: os 2 count pins (o DOC COVERAGE sanity + o REAL-REPO CONTRACT) foram esquecidos no registro e so a validacao pegou. A regra dos 2 usos aplica — ADOTADO, o espelho do doc-revalidate (sec 11.61) para o PROOF_CLASSES.

**O helper**: `scripts/proof-register.mjs` — o ciclo de 6 passos em 1 invocacao: `node scripts/proof-register.mjs --class <id> --prova N --section 8.N --what "..."` (com `--run <run>` para provas de CI, `--dry-run` para conferir os 4 pieces, `--no-suite` para o scaffold rapido). O gate da suite (o estado atual verde antes de tocar nada — o padrao do doc-revalidate), os 3 arquivos editados (manifest + teste + doc), a CURE de re-validacao no final.

**A fronteira honesta**: as partes MECANICAS sao geradas (a entrada do manifest, a tupla do snapshot, os 4 count bumps — a classe da Prova 48 —, a row da tabela, o skeleton da sec 8.x do template UTF-8 `scripts/proof-register-section.txt`, o padrao do doc-revalidate-line.txt); a NARRATIVA da sec 8.x (O pedido / O veredito / A execucao / A fronteira honesta) fica manual — o template scaffold-da os headings como comentarios NARRATIVA MANUAL. O `--what` e ASCII-gated (vai para o manifest .mjs); a prosa acentuada fica na narrativa.

**O count deriva do TESTE, nao do manifest**: o token `N provas registradas` vive no sanity do ABS PIN suite (o manifest usa ${total} no template do CLI) — o REAL-REPO CONTRACT pina a equivalencia (derivado == CLI, o drift da Prova 48 pega na hora). O `--class` precisa existir no PROOF_CLASSES e a Prova nao pode duplicar nem a secao 8.x existir (fail-loud, os mesmos exit code do doc-revalidate).

**O recipe de re-uso (registrar a Prova N em 30s)**: `node scripts/proof-register.mjs --class <id> --prova N --section 8.N --what "..." --dry-run` (confere os 4 pieces sem escrever) → o run real → preencher a narrativa da sec 8.x → re-validar (`npx vitest run scripts/__tests__/proofs-manifest.test.ts scripts/__tests__/proof-register.test.ts --config vitest.config.unit.ts` + `node scripts/proofs-manifest.mjs --check`).

Esta sec 11.94 e claim-FREE (o helper espelha o doc-revalidate, sec 11.61: a saida do CLI fica documentada no docblock do .mjs, nao na doc) — sem entrada no EXIT_CLAIMS (o count fica em 29 claims).

## 11.95 ADOTADO — o pin da citação da planura na nota do config contra a sec 8.1 (a classe 'fato medido citado fora da doc', avaliação 2026-08-12)

**Pedido**: a nota do singleFork (sec 11.80, o comentário SERIALIZED POOL do `vitest.config.unit.ts`) citava a planura medida como prosa — `test:guard 20.9 -> 19s com +28 testes` — e, se uma re-medição da sec 8.1 recalibrasse o número, a nota viraria o ponto de drift silencioso (uma citação de fato medido FORA da doc, sem o contrato que as citações DENTRO da doc têm — o checkCitedCounts da 11.62, o checkDigestCounts da 11.62). Avaliar um teste que pince a citação contra a re-medição mais recente da sec 8.1.

**O probe — a nota já estava 2 re-medições atrasada (o pin falha AGORA)**: a nota citava a transição (2)→(3) (`20.9 -> 19s com +28 testes` — re-medições 08-11(2) 20.9s/269 e 08-12 19s/297), mas a sec 8.1 seguiu: (4) 22.2s/304, (5) 23.5s (o run falho do `--maxWorkers`), (6) 22.5s SUCCESS/304 — e a própria doc marcou a leitura honesta: *"o step test:guard SUBIU: 19s → 22.2s... a série 20 → 20.9 → 19 → 22.2s quebra o padrão plano"* + o ALERTA (uma subida sustentada re-abre a decisão). A citação da nota apresentava como fato assentado a leitura que a própria sec 8.1 já tinha SUPERSEDED. A classe é real e já tinha acontecido.

**A implementação (3 arquivos)**:

1. `vitest.config.unit.ts` — a nota atualizada para citar a CALIBRAÇÃO CANÔNICA atual da sec 8.1 (a sentença "Calibração CI-vs-local": banda 19-23.5s, série 20 → 20.9 → 19 → 22.2 → 23.5 → 22.5s com as suítes crescendo 236 → 304) + o ALERTA da sec 8.1 (subida sustentada re-abre a decisão) — os tokens do pin de PRESENÇA da 11.80 (`SERIALIZED POOL`, `sec 8.1`, `2026-08`, `DO NOT "parallelize"`) preservados.

2. `scripts/__tests__/unit-surface-contract.test.ts` — o novo describe da sec 11.95: `noteCalibration(CONFIG)` extrai banda + série da nota; `docCalibration(sec81)` extrai a sentença canônica da sec 8.1 (o anchor — a afirmação da doc SOBRE a re-medição mais recente); `calibrationMatches` exige IGUALDADE (banda min/max + série inteira). O REAL-REPO pina o par no estado atual; 3 MUTATIONs: nota editada → falha; doc recalibrada (novo endpoint) → falha; citação removida → o extrator THROW (fail-loud).

3. `docs/gates-proofs.md` — a sec 11.80 atualizada (a citação que ela citava também estava stale) + esta sec 11.95.

**A fronteira honesta**: o pin ancora na SENTENÇA CANÔNICA da sec 8.1 (o que a doc afirma sobre a re-medição mais recente) — ele trava a nota contra a doc. Ele NÃO trava a doc contra si mesma (se uma re-medição (7) atualizar o bloco de re-medição mas ESQUECER a sentença de calibração, a sentença e a nota ficam stale JUNTAS) — fechar essa lacuna seria um contrato irmão (a sentença canônica == o último breakdown row default), o mesmo custo da re-medição (6) que entrou em prosa/tabela A-B, não em breakdown row. A decisão: o pin fecha a classe do PEDIDO (a citação fora da doc); o desdobramento da doc-consigo-mesma fica documentado como fronteira.

Esta sec 11.95 é claim-FREE (o pin é sobre citações de medição, não sobre códigos de saída) — sem entrada no EXIT_CLAIMS (o count fica em 29).


## 11.96 ADOTADO — o 10o guard do batch: o CONTRATO da nota SERIALIZED POOL do config no pre-commit (scan-unit-config.mjs, o tripwire da nota do singleFork)

**O pedido**: o comentário do singleFork agora é pinado pela suite unit-surface-contract (sec 11.80 poolNotePresent + sec 11.95 a citação da planura vs a sec 8.1) — mas só como SUITE via test:unit (no CI/push). O pre-commit:test mapeia vitest.config.unit.ts para NADA (o mapper cobre só src/ e scripts/ sources com suite co-localizada), então editar o config (ex.: reescrever a justificativa, remover a nota, dessincronizar a citação) passava o commit local e só falharia no push/CI. Avaliar um guard que rode o --check da 11.80 no pre-commit quando vitest.config.unit.ts mudar (o padrão do tripwire do scan-exit-claims, sec 11.42/11.56, aplicado ao config).

**O veredito**: ADOTADO com REFINAMENTO — o invariante da sec 11.42/11.93 (guards baratos NÃO ganham condição por arquivo) supersede a premissa da condição por diff: o guard roda INCONDICIONALMENTE como 10o membro do batch. A condição por arquivo seria furada pelo próprio cenário que protege (a edição acidental NÃO avisa o hook de nada) e adicionaria um caminho de teste por guard; o custo do scan é ~10-20ms de fs + regex com o boot compartilhado, o mesmo cálculo que manteve o scan-exit-claims e o scan-proof-helpers incondicionais.

**A implementação**: `scripts/scan-unit-config.mjs` é o EXECUTÁVEL do par de contratos da nota do config — (1) a PRESENÇA (poolNotePresent da sec 11.80: o bloco '// SERIALIZED POOL' com os tokens sec 8.1 + 2026-08 + DO NOT "parallelize" + o singleFork: true real) e (2) a CITAÇÃO sincronizada (noteCalibration == docCalibration da sec 11.95: a banda + a série da nota == a sentença canônica da sec 8.1 — a nota nunca cita uma medição stale). **A fonte única** (a regra dos 2 usos): as 4 funções extratoras vivem NO GUARD e a unit-surface-contract.test.ts as IMPORTA (nunca redefine — o guard e a suite não podem driftar, a mesma filosofia do EXIT_CLAIMS/scan-proof-helpers). O batch roda o main() como 10o membro (depois do proof-helpers): nota removida / tokens quebrados / citação dessincronizada -> saída 1 com o caminho exato ANTES do commit.

**A fronteira honesta**: o guard pina a RELAÇÃO nota ↔ doc, não a medição em si (re-medição continua sendo decisão humana via guard-remeasure, sec 11.81). A reescrita da JUSTIFICATIVA em prosa passa sem re-medição (prosa ≠ fato medido — o pin é sobre a citação, não sobre o texto); qualquer mudança na CITAÇÃO ou na presença da nota falha até o par nota+doc ser re-sincronizado. O short-circuit da checagem: sem a nota, a violação de presença é a raiz (a citação nem roda — sem nota não há o que comparar).

**A cascata (growth contracts)**: DERIVATION PIN do batch 9 → 10 (scan-batch-coverage.test.ts); wired 19 → 20 (o import novo no runner deriva sozinho, sec 11.60 — o 20o wired do repo); WIRED_ALLOWLIST 8 → 9 (o guard sem Prova dedicada — contrato suite-pinned, o padrão do scan-proof-helpers, com o rationale no proofs-manifest); GUARD_SUITE_VALUES ganha a 4a exceção (scan-unit-config.mjs → unit-surface-contract.test.ts — a suite da 11.80/11.95 NÃO segue a convenção `<stem>.test.ts`; a INVERSAO da sec 11.92 derivou a chave nova automaticamente do fs). O REAL-REPO CONTRACT do batch passou a exigir os 10 veredictos clean na ordem; o novo teste de isolamento (config sintético sem a nota via UNIT_CONFIG_SCAN_ROOT) prova o fail-loud do 10o guard com os outros 9 clean.

Esta sec 11.96 é claim-FREE por desenho (o contrato é sobre a FORMA da nota do config — presença + citação —, não sobre código de saída; a saída do CLI fica documentada no docblock do .mjs, o padrão da sec 11.94/11.95) — sem entrada no EXIT_CLAIMS, o count fica em 29 claims.

**ATUALIZAÇÃO (Prova 49, sec 8.44)**: a prova viva deu ao guard a Prova dedicada — o scan-unit-config GRADUOU do WIRED_ALLOWLIST (a rationale era "sem Prova dedicada") para CLASSE no PROOF_CLASSES (sec 11.60), e o allowlist voltou de 9 para 8 entradas. O guard segue sendo o 10º do batch e a suite da 11.80/11.95 continua sendo a unit-surface-contract.test.ts (a 4ª exceção do GUARD_SUITE_VALUES, sec 11.92, inalterada).

**Re-validacao**: `node scripts/scan-unit-config.mjs --check` (clean) + `npx vitest run scripts/__tests__/unit-surface-contract.test.ts scripts/__tests__/run-precommit-guards.test.ts scripts/__tests__/scan-batch-coverage.test.ts scripts/__tests__/wired-guards-contract.test.ts scripts/__tests__/proofs-manifest.test.ts scripts/__tests__/scan-exit-claims.test.ts scripts/__tests__/gates-proofs-ordering.test.ts --config vitest.config.unit.ts` + `npx tsc --noEmit` + `node scripts/scan-exit-claims.mjs --check` (clean 29 claims) + `node scripts/proofs-manifest.mjs --check` (clean 19 classes / 48 provas / 20 wired) + UTF-8 do doc + ASCII dos tests + ordering 11.95 → 11.96 → 12 monotono.

## 11.97 RECUSADO — o byte-copy do doc NÃO entra na CURE do status-fail: o envelope único basta, e a ORDEM estrutural (doc-restore → status-check) é o pin que sustenta o veredito (avaliação 2026-08-12)

**Pedido**: o `revertLeftNote` agora divide apply/status (a sec 11.75), mas o
`cleanupOnFailSuffix` (sec 11.69) consome a MESMA função nos fail paths de
MUTACAO. Avaliar se a CURE do snapshot (`status-before.txt`) também deveria
citar o caminho do byte-copy do doc (`<backup>/doc-before.md`) nesses fail
paths — ou se o envelope único basta (o padrão da 11.71).

**O veredito (RECUSADO — o envelope único basta, com o fato estrutural
pinado)**: a CURE do status-fail NÃO deve citar o byte-copy do doc. A razão
é a ORDEM do `revertCycle`: o restore do `doc-before.md` (o copyFileSync do
byte-copy) roda ANTES do check de status (o `git status --porcelain` vs o
snapshot) — um status-fail tem o doc JÁ de volta na árvore. Citar o byte-copy
na CURE do snapshot seria ENGANOSO (o doc não é a divergência: a divergência
do status é de OUTROS arquivos — o stray/untracked que o ciclo deixou, a
classe da Prova 46) e DUPLICARIA a receita (o anti-padrão que a 11.71
recusou: 4 cópias + citação dupla nos envelopes). O apply-fail é diferente
(ali o doc NÃO foi restaurado ainda — mas a CURE do apply cita o `git apply
<backup>/delta.patch`, que restaura o doc como arquivo tracked do delta, e o
reflog como fallback).

**O pin (o que a avaliação fechou)**: o fato que sustenta o veredito — a
ordem doc-restore → status-check — não estava pinado: o E2E do status-fail
(sec 11.85) assertava a ordem GIT (checkout → branch -D → apply) mas não que
o DOC voltou ao estado pré-ciclo pós-fail. O E2E agora assere `docPath ==
SYNTH_DOC` depois do status-fail (o `--mutate-doc-claim` escreveu o doc, o
revert restaurou do byte-copy e SÓ ENTÃO o status divergiu) — se um refactor
mover o restore do doc para DEPOIS do check de status, o assert quebra e o
veredito "o envelope basta" perderia a base estrutural (a CURE do snapshot
ficaria sem citar o byte-copy num estado em que o doc ainda estaria
mutado). A fronteira documentada: a CURE do snapshot reconcilia o `git status
--porcelain` com o `status-before.txt` (o doc já restaurado); o byte-copy do
doc é recuperação MANUAL implícita no `<backup>` citado, não receita da
CURE.

Esta sec 11.97 é claim-free por desenho (a decisão é de conteúdo da
mensagem de erro, não de código de saída) — sem entrada no EXIT_CLAIMS, o
count do manifest permanece 29.

**Re-validação**: `npx vitest run scripts/__tests__/hook-proof-run.test.ts scripts/__tests__/proof-helpers-contract.test.ts scripts/__tests__/scan-exit-claims.test.ts scripts/__tests__/gates-proofs-ordering.test.ts --config vitest.config.unit.ts` + `npx tsc --noEmit` + `node scripts/scan-exit-claims.mjs --check` (clean 29 claims) + UTF-8 do doc + ASCII do .mjs + ordering 11.96 → 11.97 → 12 monotono.

## 11.98 ADOTADO — `--mutate-untracked <file>`: o flip da Prova 46 embutido como mutação de 1 comando (o método da classe status-divergente travado, avaliação 2026-08-12)

**Pedido**: a Prova 46 (sec 8.41) usou o flip do `.gitignore` MANUALMENTE
via `--mutate` shell (`touch stray.tmp && echo stray.tmp >> .gitignore` — o
ACHADO do mecanismo: o `git add -A` do commit de mutação IGNORA o arquivo
porque o `.gitignore` acabou de ganhar a linha; o checkout do revert
restaura o `.gitignore` ao estado base (sem a linha do flip) mas NÃO remove
arquivo ignorado — o stray SOBREVIVE ao revert como untracked VISÍVEL e o
git status pós-revert diverge do snapshot → o status-fail do revertCycle com
a CURE do snapshot). Avaliar uma flag que embuta o flip como mutação de 1
comando — travando o método para a próxima prova da classe status-divergente
não re-derivar o ACHADO linha a linha.

**O veredito (ADOTADO — a flag dedicada, no padrão do
`--mutate-doc-renumber` da sec 11.59)**: o `--mutate-untracked <file>`
embute o flip completo (`untrackedFlip` — o `touch` do arquivo vazio + o
`echo <file> >> .gitignore`, com o append honesto que preserva a última
linha do `.gitignore` existente). O shape do `<file>` é validado no parse
(nome SIMPLES, sem separadores de path — o flip é um untracked NA RAIZ; um
file com path criaria dirs aninhados fora da shape, fail-loud no MESMO
espírito do shape do `--to` da sec 11.59). O seam hermético é o
`HOOK_PROOF_MUTATE_ROOT` (o MESMO padrão do `HOOK_PROOF_DOC`: em teste o
flip roda num root temporário — o `.gitignore` do repo real nunca é tocado).
A mutação entra na exclusividade mútua (agora 4: claim | renumber |
untracked | shell) e no commit da mutação — o flip altera a árvore (o
.gitignore muda) e o commit HUSKY=0 materializa a classe.

**O pin (suite hook-proof-run.test.ts, describe sec 11.98)**: parseArgs (a
flag parseia; exclusividade com as OUTRAS 3 mutações — o par claim+untracked
e untracked+shell falham; shape com separador `/` ou `\` → erro) + o teste
Puro do `untrackedFlip` (arquivo vazio criado + linha do `.gitignore`
anexada; append ao `.gitignore` EXISTENTE preservando a última linha) +
planSteps (o plano cita a flag e o flip) + o E2E hermético do caminho do
hook: `--mutate-untracked stray.tmp` com `HOOK_PROOF_MUTATE_ROOT` (o seam) +
`FAIL_STATUS=1` → codigo 3 (o fail-loud do status-fail) com a CURE do
snapshot E o flip rodou DE VERDADE no root do seam (arquivo existe vazio +
`.gitignore` com a linha) — a classe status-divergente observada com o
MÉTODO embutido, não o `--mutate` shell.

Esta sec 11.98 é claim-free por desenho (a flag não muda o contrato de
códigos de saída 0-3 da sec 11.58 — o flip só materializa o ESTADO da classe
já documentada) — sem entrada no EXIT_CLAIMS, o count do manifest permanece
29.

**Re-validação**: `npx vitest run scripts/__tests__/hook-proof-run.test.ts scripts/__tests__/proof-helpers-contract.test.ts scripts/__tests__/scan-exit-claims.test.ts scripts/__tests__/gates-proofs-ordering.test.ts --config vitest.config.unit.ts` + `npx tsc --noEmit` + `node scripts/scan-exit-claims.mjs --check` (clean 29 claims) + UTF-8 do doc + ASCII do .mjs + ordering 11.97 → 11.98 → 12 monotono.

## 11.99 O revert-fail nunca apaga untracked nao-backupeados (ADOTADO, 2026-08-12)

**O pedido**: o par pos-branch-D agora tem prova viva nos dois stages (apply =
Prova 43, sec 8.38; status = Prova 46, sec 8.41), mas o revertLeftNote nao
cobre o cleanup do untracked deixado - o revert-fail nao remove o stray.tmp do
flip, so restaura o que copiou (o backup). Avaliar um teste de contrato que
pince a fronteira como decisao documentada.

**O veredito**: ADOTADO - a fronteira e DECISAO, nao gap. O revertCycle so
COPIA PARA a arvore o que o backup guardou (untracked/ do byte-copy,
doc-before.md, delta.patch) e NUNCA deleta: um untracked nao-backupeado pode
ser DADO DO USUARIO (o revert nao consegue distinguir o stray do flip de um
arquivo que o usuario criou durante o ciclo) e a delecao automatica seria a
classe do `git clean` sem freio (destrutiva, irrecuperavel). O stray SOBREVIVE
ao revert POR DESENHO - ele e o SINAL da classe status-divergente (Prova 46):
so a divergencia que ele causa dispara o status-fail do revertCycle. A
reconciliacao e MANUAL: a CURE do status-fail (sec 11.75) ja aponta o
status-before.txt do backup para o usuario comparar e decidir - o helper nunca
emite um rm/clean.

**Os pins (2 camadas)**:
1. FORM GUARD (estrutural, na suite do hook-proof-run): o corpo do revertCycle
   (derivado do fonte entre 'export function revertCycle' e 'export function
   main') NAO contem primitiva de delecao - rmSync/unlinkSync/removeSync/
   rmdirSync nem git clean/git rm como invocacao. Um dev que adicione um
   delete ao revert TRIPA a suite na hora (o padrao do guard de forma da sec
   11.65 aplicado ao invarian de nao-delecao).
2. COMPORTAMENTAL (o E2E da 11.98 reforcado): apos o status-fail, o stray.tmp
   SOBREVIVE (existsSync true - o assert ja existia como mecanismo) E a CURE
   NAO instrui deletar (sem 'rm'/'git clean' no stderr) - a reconciliacao e
   manual via status-before.txt, nunca um comando de delecao no erro.

Esta sec 11.99 e claim-free por desenho (a fronteira nao muda o contrato de
codigos de saida da sec 11.58 - o revert ja nao deletava; a decisao so o pina)
- sem entrada no EXIT_CLAIMS, o count do manifest permanece 29.

**Re-validação**: `npx vitest run scripts/__tests__/hook-proof-run.test.ts scripts/__tests__/proof-helpers-contract.test.ts scripts/__tests__/scan-exit-claims.test.ts scripts/__tests__/gates-proofs-ordering.test.ts --config vitest.config.unit.ts` + `npx tsc --noEmit` + `node scripts/scan-exit-claims.mjs --check` (clean 29 claims) + UTF-8 do doc + ASCII do .mjs + ordering 11.98 → 11.99 → 12 monotono.

## 12. Referências

- Investigação da falha contínua do `security-headers`: `docs/security-headers-gate-2026-08.md`
  (DNS aponta para WordPress na Hostinger, não para o VPS — não é regressão do app).
- Gates de encoding: `scripts/verify-encoding.sh`, `scripts/scan-non-ascii.mjs`,
  `scripts/fragile-range-patterns.mjs`, `scripts/verify-ascii-proof.sh`.
- Guard de bundle: `scripts/check-js-budget.mjs` + `docs/bundle-report.md`.

