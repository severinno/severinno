# Guards do repo — catálogo e PORQUÊ de cada família

> Meta-tooling consolidado (2026-08). O repo tem ~150 scripts; este documento
> explica o **porquê** de cada família de guard, para que o crescimento seja
> deliberado: um guard NOVO deve caber numa família existente (ou justificar
> uma nova com este doc atualizado). Antes de criar `scripts/check-foo.mjs`,
> pergunte: "qual família cobre este risco?".

## Como ler este catálogo

Cada família lista: **o que protege**, **por que existe** (o incidente/regressão
que motivou), **onde roda** (hooks/CI/cron/manual) e **como testar**. O critério
de aceite de um guard novo: ele precisa ter (1) teste unitário das funções
puras, (2) teste CLI quando aplicável (spawn real, exit code), e (3) quando
possível um **mutation test** (scripts/test-mutation-*.sh) provando que o guard
REALMENTE pega a regressão.

---

## 1. Encoding guards — `check-utf8`, `check-crlf`, `check-blob-crlf`, `check-single-line-out-assign`

**O que protege:** zero CRLF/UTF-8 quebrado no working tree, no staged e no
histórico; padrão `out=` de um só arquivo.

**Por que existe:** Windows + Git sem `core.autocrlf` consistente gerava blobs
CRLF commitados que quebravam builds Linux e diff em PRs. O guard trava o
presente (CRLF/UTF-8), o escopo (`src/` só para utf8, `scripts/` só para
single-line), o staged (pre-commit) e o histórico (audit de blobs — o histórico
não pode ser reescrito por CI, então é auditoria periódica + rotação manual).

**Onde roda:** `.husky/pre-commit` + `.husky/pre-push` via
`scripts/run-encoding-guards.sh` (orquestrador único); jobs no pr-check.yml e
cron no benchmark-weekly.yml (auditoria histórica `--all-text`).

**Família relacionada:** `check-encoding-guards-badge` valida que a tabela do
README (Encoding Guards) bate com os guards reais dos hooks — doc não pode
driftar do código.

---

## 2. Mirror do Bun / fonte única — `check-bun-mirror`, `check-actrc-sync`, `check-no-setup-bun`, `check-setup-bun-common`, `check-setup-bun-warm`

**O que protege:** a versão do Bun tem UMA fonte de verdade
(`vars.BUN_VERSION`); mirror GHCR e Dockerfiles alinhados; setup-bun sem
literal.

**Por que existe:** versões hardcoded (bun@1.2 no Dockerfile, bun-1.3.14- nas
cache keys, bun-version: 1.3.14 nos workflows) criavam múltiplos pontos de
verdade — bump da variável não invalidava caches nem imagens. O guard caça
literais em workflows, Dockerfiles, .actrc e lockfiles estrangeiros
(package-lock.json/pnpm-lock.yaml são proibidos; só bun.lock).

**Onde roda:** pre-commit/pre-push (modo `--staged` pega key/literal/call site
introduzidos pelo PR), CI (job dedicado), cron (tier-1 fastpath).

**Família relacionada:** `check-tier1-fastpath`, `check-tier2-cache-restore`
(performance do setup-bun — ver família 10).

---

## 3. Mutation tests — `test-mutation-*.sh` + `check-mutation-jobs`

**O que protege:** os guards NÃO são cosméticos — cada `test-mutation-*.sh`
muta um fixture (injeta literal, remove input, quebra âncora, apaga script) e
exige que o guard FALHE pela asserção certa. Guard cego (passa com a mutação)
bloqueia o CI.

**Por que existe:** guards sem prova de detecção viram dead code — um dev
remove/enfraquece a checagem e ninguém percebe. O master
`scripts/test-mutation-guards.sh` roda a matriz completa num job só do
pr-check; `check-mutation-jobs` valida que todo mutation script TEM job no
pr-check (um mutation novo sem job = falha).

**Onde roda:** CI (pr-check), local (`bash scripts/test-mutation-guards.sh`).

#### Overhead por PR do job `mutation-coord-update` (medido 08/2026)

O job roda em `ubuntu-latest` (hosted runner — **NÃO** usa a imagem custom
`ubuntu-bun`; essa imagem é só para o tier-1 local/act). O custo real por PR é
dominado pelo **payload do mutation test**: 5 cenários (controle + A + B + C + D

- E) = 6 runs de vitest + 6 runs do guard estático (`check-e2e-counts.mjs`,
  ~0.3-0.4s cada). Medido no act com a imagem `ubuntu-bun:1.3.14` (08/2026):

| Componente do job                      | Local (Windows, node frio) | act (ubuntu-bun, container) | CI real (GH hosted) |
| :------------------------------------- | :------------------------: | :-------------------------: | :-----------------: |
| checkout@v4                            |             —              |            49ms             |    ~1-2s (real)     |
| setup-bun (composite, tier-1)          |             —              |     13.5s (fast path)¹      |  ~1-2s (esperado)¹  |
| Cache node_modules (restore+save)      |             —              |           17.4s*            |    ~1-2s (real)     |
| bun install (warm, cache hit)          |             7s             |           12.8s*            |  ~2-5s (esperado)   |
| **Mutation test payload (5 cenários)** |          **51s**           |        **4m37.6s***         | ~35-45s (estimado)² |
| Publish summary                        |             —              |            0.6s             |         <1s         |

¹ Na imagem ubuntu-bun o setup-bun atinge o **tier-1 fast path** (log: `Bun já
instalado no runner (1.3.14) — fast path`) — os 13.5s do act são o overhead de
EMULAÇÃO do composite (docker exec), não download/cache; no CI real o tier-1 não
existe (runner hosted), então o setup-bun real é o tier-2 com cache REAL do
GitHub (~1-2s esperado — ver a tabela de medição do setup-bun no README).

*Overhead de EMULAÇÃO do act: docker cp do worktree no checkout + bind mount
lento (`/mnt/c` no Docker Desktop) + actions/cache emulado. É por isso que o
payload do mutation test dispara de ~21s (local) para 4m37s no act: cada um dos 6
runs de vitest paga I/O de bind mount (SSD do host → ext4 do container, ~46s por
run emulado vs ~3.4-5.0s local). O act ainda travou no "Post Cache node_modules"
(tar do cache emulado) após o step do mutation test — overhead pós-step que não
existe no CI real. O GitHub Actions real usa filesystem nativo do runner, então o
payload esperado no CI é da ordem do local (~21s, escalando com os 5 cenários).

² Estimado por extrapolação do local medido (51s com 6 vitest runs + 6 guard runs
≈ ~8s/run de vitest a frio no runner hosted) — a medir com `gh` autenticado (ver
abaixo). O step do mutation test roda no CI com bun install WARM (cache real do
GitHub), então a I/O não é o gargalo; a expectativa é o payload ficar no mesmo
patamar do local (dezenas de segundos, não minutos).

⚠️ Timing REAL do GitHub Actions não medido aqui — o `gh` está autenticado (auth
fantasma RESOLVIDO em 08/2026, ver Bugs conhecidos no README), mas o
`seed-guards.yml` não existe na branch default (`release/v0.4.0` — nunca
mergeado), então o job nunca rodou no CI real (zero runs); o act é o proxy
local, no padrão do README. O
número confiável é o **payload do mutation test no container: 4m37.6s** (o step
`Run mutation test` completou `✅ Success` com os 5 cenários; o job só foi morto
depois, no Post Cache emulado). No CI real, com cache warm e FS nativo, o payload
esperado é ~21-25s (ver nota ²).

Quando o `gh` estiver autenticado, medir o CI real é um one-liner:
`gh run list --workflow=seed-guards.yml --limit 1` → pegar o run id →
`gh run view <id> --json jobs --jq '.jobs[] | select(.name | contains("contrato")) | .steps[] | select(.name | contains("Run mutation test")) | {name, startedAt, completedAt}'`
— o passo `Run mutation test (contrato coordenado — 5 cenários, 2 elos)` dá o
tempo real do payload; os steps `actions/checkout@v4` e `setup-bun` dão o overhead
fixo do job (troque o filtro do `.steps[]` pelo nome do step desejado). Atualize a
tabela acima quando medir.

---

## 4. README/docs guards — `check-readme-anchors`, `check-readme-toc`, `check-readme-images`, `check-readme-reverse-baseline`, `check-readme-repro-marker`, `check-worklog`, `check-worklog-toc`, `check-cache-patterns`, `check-realtime-copy`

**O que protege:** links internos (#slug) resolvem, TOCs apontam para headings
reais, imagens existem, e o reverse (semântico) detecta label apontando para o
heading errado. O `check-worklog` valida a INTEGRIDADE do worklog.md: cada
entrada de auditoria exige o formato mínimo (Task ID/Agent/Task/Work Log —
com `Stage:` aceito como ID legado e `Work Log (sufixo):` tolerado) e Task
IDs ÚNICOS no arquivo (entrada sem contexto rastreável ou ID duplicado = PR
bloqueado). O `check-worklog-toc` valida a SINCRONIA do índice (TOC) do
worklog.md nas TRÊS direções: todo Task ID/Stage tem linha no índice com
âncora e resumo (reverse), todo link do índice resolve para uma âncora real
(forward) e toda âncora é o slug github-slugger exato do ID (anchor) — além
de linhas stale do índice (ID sem entrada real). O resumo de cada linha é
derivado da descrição `Task:` da entrada pelo gerador `gen-worklog-toc.mjs`
(bun run gen:worklog-toc — idempotente, revalida com os dois guards antes de
escrever). O `check-cache-patterns` valida a CONSISTÊNCIA da lista de
invalidação do seed (`CACHE_PATTERNS` em prisma/seed.ts) contra os prefixes
reais de `withCache`/`withCachedGeo`/`cacheInvalidate` em src/ — derivando
os prefixes dos call sites (e builders `*CacheKey`) em arquivos
cache-capable. Flagra nas duas direções: prefixo de catálogo NOVO em src/
esquecido do CACHE_PATTERNS (a janela de stale do re-seed volta a existir)
e padrão do seed sem uso real (órfão); prefixes não-catálogo (sessão/push/
ops/geo externa) são cobertos pela ALLOWLIST do guard, espelho do comentário
de exclusões do seed. O `check-realtime-copy` valida que o Dockerfile do
realtime (`mini-services/realtime/Dockerfile`) COPIA todo módulo local
importado — direta ou TRANSITIVAMENTE — por `index.ts`: o guard deriva o
closure dos imports do código (cada módulo lido e seus próprios imports
seguidos até fechar) e checa contra o COPY (glob `*.ts` cobre módulos
top-level; lista explícita precisa listar cada um), flagrando módulo sem
arquivo no diretório (module not found no boot do container), módulo fora
da lista explícita e entrada órfã na lista (reverse) — a regressão de
imagem quebrada que quebrou 2x antes do fix `COPY *.ts ./` não volta.

**Por que existe:** o README é a porta de entrada do repo; heading renomeado
sem atualizar o link = link morto silencioso. O guard roda o algoritmo do
GitHub slugger exato (sem depender de lib externa). O worklog é o registro de
auditoria entre threads; sem o mínimo, vira uma pilha de anotações sem
contexto (quem/qual tarefa) e IDs duplicados quebram referências cruzadas.

**Onde roda:** pre-commit (staged), pre-push, CI; `--reverse`/`--reverse-strict`
em job semanal com baseline (alerta, não gate de PR). O `check-worklog` roda
no pre-commit (bun run check:worklog) + job `worklog-guard` no pr-check.yml
(sem mutation test próprio — o CLI test cobre os formatos e o fixture). O
`check-worklog-toc` roda no pre-commit (bun run check:worklog-toc) + job
`worklog-toc-guard` no pr-check.yml, com mutation test próprio
(`test-mutation-worklog-toc.sh`: entrada sem linha, link sem âncora, slug
errado e linha stale — todos detectados).

---

## 5. E2E counts / seed — `check-e2e-counts`, `check-seed-count-literals`, `check-seed-hooks`, `validate-seed-guards-matrix-local`

**O que protege:** os counts derivados dos E2Es de seed (prod/dev) batem com o
documentado; os guards comparam por DERIVAÇÃO (nunca literal hardcoded):
`check-e2e-counts` cobre os comentários/echos dos workflows e do script local;
`check-seed-count-literals` varre TODO o repo (scripts/, docs/, .github/) por
literais de count em contexto ("N checks" / ternary da matrix) fora do
conjunto válido {prod, dev}.

**Por que existe:** count drifted (doc dizia 128, âncora de teste esperava 123)
sem ninguém perceber — a derivação é a fonte da verdade e os guards falham se
o número documentado divergir. O check-e2e-counts cobre os workflows; o
check-seed-count-literals fecha o buraco de docs/ e scripts/ não-varridos
(um literal órfão após bump — ex.: 123 — falha o PR na hora).

**Onde roda:** pre-push, CI.

---

## 6. Workflow refs — `check-workflow-refs`, `validate-workflows.py`

**O que protege:** toda `run:`/`uses:` de workflow aponta para script/arquivo
que EXISTE (par transitivo fechado: entry do package.json → scripts/X).

**Por que existe:** script deletado/renomeado sem atualizar o workflow = job
quebrado no runtime, descoberto só no push. O guard pega no PR, antes do merge.

**Onde roda:** pre-push, CI.

---

## 7. Segredos — `audit-secret-leaks`, `check-secret-leaks-baseline`, `rotate-secrets`

**O que protege:** segredos NÃO entram no histórico (rotina de rotação);
QUALQUER achado NOVO falha o job semanal — o gate já cobre TODOS os de
severidade ALTA (chaves privadas, tokens sk-*), que era o pedido do parecer.

**Por que existe:** um segredo commitado uma vez fica no histórico para sempre
(filter-repo + rotação são operações deliberadas). O baseline documenta os 141
vazamentos conhecidos; o guard protege o FUTURO comparando por assinatura
(commit+file+line+id+key). NOTA (parecer 08/2026): a premissa "hoje gateia só
o total" era FALSA — o guard já falhava em qualquer achado novo por
assinatura, não por count. Por isso o job semanal roda o DEFAULT (falha em
tudo, incluindo alta) e NÃO usa `--min-severity alta` (isso ENFRAQUECERIA o
gate, deixando novos de severidade média passar). A classificação de
severidade (alta/média) existe como OPÇÃO de relaxamento deliberado:
`node scripts/check-secret-leaks-baseline.mjs --min-severity alta`.

**Onde roda:** job semanal (benchmark-weekly.yml, gate default), manual
(auditoria), operação de rotação (scripts/rotate-secrets.mjs).

---

## 8. Hook symmetry / README tabela — `check-hooks-symmetry`, `check-encoding-guards-badge`

**O que protege:** a tabela do README (Git Hooks / Encoding Guards) bate com o
conteúdo REAL do `.husky/pre-commit` e `.husky/pre-push` — nos dois sentidos
(guard sem linha na doc E linha da doc sem guard real).

**Por que existe:** guard novo adicionado sem atualizar a doc = devs não sabem
que o guard existe; linha stale = doc promete proteção que não existe.

**Onde roda:** pre-commit, pre-push, CI.

---

## 9. Sentinel / producer — `check-sentinel-producer`, `validate-all-text-alert`

**O que protege:** todo sentinel grepeado nos workflows (`grep -Fq '...'`) tem
o sentinel correspondente no produtor (script/python que o emite); o fluxo do
alerta é reproduzível num script único.

**Por que existe:** workflow que grepa um sentinel que o produtor não emite =
job sempre falha ou nunca detecta — drift silencioso entre produtor e
consumidor.

**Onde roda:** CI, local (validate-all-text-alert.sh).

---

## 10. Performance / benchmark — `check-tier1-fastpath`, `check-tier2-cache-restore`, `bench-*`, `run-benchmark`, `audit-playwright`

**O que protege:** o setup-bun mantém o fast path (tier-1, imagem custom com bun
embarcado) — regressão de tier (cache/download) falha o guard; benchmarks de
startup/encoding rodam em cron com limiar.

**Por que existe:** a otimização de startup (imagem ubuntu-bun vs catthehacker)
é uma decisão medida; sem guard, um bump de imagem poderia reverter o ganho
silenciosamente. Benchmarks também medem o overhead dos próprios guards (para
manter o hook <1s).

**Onde roda:** cron (benchmark-weekly.yml), CI (tier1-fastpath-guard em PR que
toca Dockerfile/setup-bun).

---

## 11. Fuzz / encoding runtime — `run-all-fuzz`, `run-encoding-guards.sh`

**O que protege:** fuzz dos parsers de encoding + execução orquestrada dos
encoding guards.

**Por que existe:** parsers (regex de CRLF/UTF-8/out=) com inputs malformados
não podem crashar; o orquestrador garante ordem determinística e saída
agregada para hooks e CI.

**Onde roda:** pre-push (fuzz:ci), pre-commit/pre-push (orquestrador).

---

## 12. Dependências — `check-unused-deps`

**O que protege:** zero órfãs no `package.json` — toda dep (`dependencies` +
`devDependencies`) tem pelo menos UMA referência real no código do repo
(src/, scripts/, e2e/, mini-services/, configs, workflows, hooks, Dockerfiles).
Dep adicionada e não usada = falha (exit 1); não existe baseline de órfãs.

**Por que existe:** dep órfã é lockfile que cresce sem uso, superfície de
ataque (deps nunca atualizadas no audit) e confusão para o próximo dev
(qual dep é runtime de verdade?). O guard trava o lockfile ENCOLHENDO — a
política é ZERO-órfãs, não "N órfãs toleradas".

**Onde roda:** job `unused-deps-guard` do pr-check.yml (mutation test
`test-mutation-unused-deps.sh` + guard real) — fora do pre-commit por ser um
scan repo-wide mais lento; checagem local pontual: `bun run check:unused-deps`.

**Política completa (fluxo ao adicionar dep: use / remova / allowlist com
razão; allowlist de uso implícito; as 5 deps removidas no bump 0.4.0; as
limitações do scan):** veja a seção [Auditoria de dependências — política
ZERO-órfãs](../README.md#auditoria-de-dependências-política-zero-órfãs) —
fonte única, sem duplicação neste catálogo para não driftar.

---

## 13. Runner oficial — `check-no-npx-playwright`

**O que protege:** zero `npx playwright` em docs/README.md, `docs/**/*.md`,
`scripts/*.sh`/`*.bash` e package.json (escopo travado; workflows/Makefile
fora por decisão). Runner oficial do Playwright é `bunx playwright` (ou
`bun run e2e`).

**Por que existe:** no Windows, o `npx` resolve uma instância DIFERENTE de
@playwright/test no grafo de módulos (shim `.EXE` do bun sem `.cmd`/`.ps1` vs
o layout do npm) e rodar os specs E2E via `npx` fazia TODOS eles falharem com
'No tests found' (ou 'did not expect test.describe() to be called here') —
enquanto `bunx` (que lê o ponteiro `.bunx` e resolve o grafo do bun)
funcionava. Workaround local documentado no README Troubleshooting: gerar os
shims `.cmd`/`.ps1` do npm no worktree com `npm install --no-save
--no-package-lock`; o guard trava a decisão de manter `bunx` como runner
oficial em docs/scripts/package.json.
O Troubleshooting do README documenta a regressão; este guard trava a decisão
no código: reintroduzir `npx playwright` em docs/scripts/package.json falha o
PR com a orientação do bunx. Menções em PROSA (o próprio Troubleshooting) são
isentas por padrão — o guard detecta o padrão em POSIÇÃO DE COMANDO (linha
iniciando com `npx playwright` ou seguida de subcomando/flag: test, install,
list, codegen, open, show, --*). `test-mutation-*.sh` são excluídos do scan de
scripts/ de propósito (mutation tests introduzem o padrão em fixtures para
provar a detecção).

**Onde roda:** pre-commit (fast gate), job `no-npx-playwright-guard` do
pr-check.yml (mutation test + guard real).

**Como testar:** `bun run check:no-npx-playwright`; vitest
`check-no-npx-playwright-cli.test.ts` (via `test:guards`); mutation
`bash scripts/test-mutation-no-npx-playwright.sh`.

---

## 14. Timeout envs docs — `check-timeout-envs`

**O que protege:** toda env `*_TIMEOUT_MS` consumida em src/ (via
`envTimeoutSignal`/`resolveTimeoutMs` ou constantes `X_ENV`/`X_DEFAULT_MS`)
está documentada com o MESMO default (ms) em TRÊS lugares: README (tabela
"Fetch timeouts"), `.env.example` e os composes (docker-compose.yml +
docker-compose.prod.yml, serviço `app`).

**Por que existe:** as 4 envs de clientes externos (LYTEX, EVOLUTION,
GLITCHTIP, ALERT_WEBHOOK) existiam no código mas estavam INVISÍVEIS na doc
— operação não sabia que dava para tunar o timeout, e o default documentado
podia driftar do código. O guard DERIVA as envs do código (fonte da verdade,
nada hardcoded) e exige o par env+default nas 3 docs — fechando a classe por
regressão: env de timeout nova em src/ sem doc (ou default divergente) falha
o PR. Reverse também: linha da tabela do README sem uso real em src/ =
linha stale.

**Onde roda:** pre-commit (fast gate, após o check:fetch-timeout), job
`timeout-envs-guard` do pr-check.yml (mutation test + guard real).

**Como testar:** `bun run check:timeout-envs`; vitest
`check-timeout-envs-cli.test.ts` (via `test:guards`); mutation
`bash scripts/test-mutation-timeout-envs.sh`.

**Família relacionada:** `check-fetch-timeout` (hangs de fetch — o guard
irmão que exige o `signal`; este exige a DOC das envs de timeout).

---

## Regra de ouro para guards novos

1. **Cabe numa família existente?** Se sim, estenda a família (com teste +
   mutation test) — não crie `check-foo.mjs` avulso.
2. **É uma família nova?** Atualize ESTE documento com o porquê, e atualize a
   tabela do README (o `check-hooks-symmetry` e o `check-encoding-guards-badge`
   FALHAM se a doc não bater com o código).
3. **Todo guard precisa de:** teste unitário + teste CLI (quando há exit code)
   - mutation test (quando o guard é de detecção). O `check-mutation-jobs`
     valida o último no CI.
4. **Todo guard novo precisa de um job** no pr-check.yml (o `check-mutation-jobs`
   falha se um `test-mutation-*.sh` não tiver job).
