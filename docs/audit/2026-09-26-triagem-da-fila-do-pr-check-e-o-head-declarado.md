# Triagem da fila — os dois `PR Check` que morreram sem veredito, e o head que ficou declarado

A PERGUNTA: os dois `PR Check` disparados em 24/09 (`35990690695`, head `30447a57`;
`35990702155`, head `e8419d5c`) chegaram a rodar algum job? Existe veredito de algum
deles? E o que dá para medir agora — o re-disparo, e o que cada head pode produzir.

A RESPOSTA, em uma linha: **nenhum job dos dois runs pegou runner** (0 de 101 e 0 de 51
jobs têm `runner_name` preenchido) — não houve veredito, houve **tempo de fila**, e quem
matou foi o pool vazio (1 runner, `offline`). Hoje o `POST /rerun` volta **201 nos dois**,
mas só o head cuja branch ainda existe produz um attempt com jobs: o outro morre em
**`startup_failure` com 0 jobs**, porque o ref foi apagado — é um head que **não pode
rodar sem um ref novo**, nem verde nem vermelho.

---

## 0. Procedência — o que foi medido, quando, e com quê

Toda medição de API desta nota é da sessão de **26/09/2026, ~13:1xZ–14:11Z**
(**10:1x–11:11 local**, -03), fechada com a nota em **11:11:12 local**. Os carimbos
que a API devolve saem em **UTC** e são citados como tais; onde o dado traz o
próprio carimbo (o `created_at` do run, o `started_at` do job), é ele que vai na
tabela — a hora de LEITURA é a da sessão.

| medição                                                                                                     | fonte                                                                                                                                         | horas                                                                   |
| :---------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------- |
| jobs dos dois runs, attempt 1 e 2 (`runner_name`, `started_at`, `completed_at`, o 101/101 e o 51/51 vazios) | `gh api repos/severinno/severinno/actions/runs/<id>/jobs?filter=all` — runs `35990690695` (head `30447a57`) e `35990702155` (head `e8419d5c`) | lido ~13:1xZ; carimbos do dado em **24/09 11:02:25Z → 26/09 11:02:40Z** |
| estado/conclusão de cada run e o `run_attempt`                                                              | `gh api .../actions/runs/<id>`                                                                                                                | ~13:1xZ; re-lido ~13:2xZ (attempt 2) e 13:30Z (pelo vigia)              |
| o pool e o registro (`hostinger-runner` id 23, `offline`; `total_count` 1 → **0**)                          | `gh api .../actions/runners` + `DELETE .../runners/23` → **204**                                                                              | ~13:1xZ                                                                 |
| `/cancel` que **não** fechou o run (202) e o `force-cancel` que fechou                                      | `POST .../actions/runs/35990702155/{cancel,force-cancel}`                                                                                     | cancel ~13:18Z; force-cancel **13:19:58Z**                              |
| os dois re-disparos → **201** nos dois                                                                      | `POST .../actions/runs/{35990690695,35990702155}/rerun`                                                                                       | **13:20:09Z** e **13:20:07Z**                                           |
| `patch-id` dos dois heads (o mesmo patch)                                                                   | `git show <head> \| git patch-id`                                                                                                             | heads `30447a57` e `e8419d5c`                                           |
| a ponta remota (viva) e a branch apagada do outro head                                                      | `git ls-remote --heads origin`                                                                                                                | ~13:1xZ                                                                 |
| a proteção de branch que o plano não deixa nem LER                                                          | `GET repos/severinno/severinno/branches/main/protection` → **403**                                                                            | ~13:2xZ                                                                 |
| as três medições do "porquê" do vigia (post-job, endpoint que recusa escape, o recorte que fatia)           | runs antigos `35460515022` e `35842009224` (`gh run view --job <id> --log`)                                                                   | na sessão                                                               |
| o log do vigia — bloco de 24/09                                                                             | `.git/pr-check-watch.log` (não versionado): **487 linhas, 162 ciclos, 08:43:25–11:29:53** (local)                                             | lido na sessão                                                          |
| o instrumento reescrito                                                                                     | `.git/watch-pr-check.sh` (não versionado)                                                                                                     | **11:01:21 local**                                                      |
| o estado no fechamento                                                                                      | `.git/pr-check-watch.log`: pool **0 registrados**; `35990690695` attempt 2 `queued`                                                           | **10:30:07 local** em diante                                            |

---

## 1. O que o log do vigia diz — e o que ele NÃO pode dizer

- `.git/pr-check-watch.log` (não versionado, vive no `.git/`): o bloco de 24/09 tem
  **487 linhas**, de **08:43:25 a 11:29:53** (2h46 de uma janela declarada de 12h),
  **162 ciclos**.
- Ele carrega **três conteúdos, só**: `runner: hostinger-runner=offline` (162×),
  `run 35990702155: pending/` (162×), `run 35990690695: queued/` (162×).
- **Zero transições**: nenhuma linha com `in_progress`, `completed`, `success` ou
  `failure` no dia 24/09.

Ou seja: o log prova a **CAUSA** (o puxador fora do ar a janela inteira), não o
**desfecho**. O veredito por job tem de vir da API — onde ele existe, ou não existe.

## 2. Os dois runs, job a job (MEDIDO)

| run           | head       | ref                                          | criado          | attempt 1      | jobs | com runner | attempt 2                     |
| ------------- | ---------- | -------------------------------------------- | --------------- | -------------- | ---- | ---------- | ----------------------------- |
| `35990690695` | `30447a57` | `feature/forja-gates-e-regua-unica-reduzido` | 24/09 11:02:23Z | 51 `cancelled` | 51   | **0**      | `queued`, **50 jobs**         |
| `35990702155` | `e8419d5c` | `feature/tres-classes-base` (**apagada**)    | 24/09 11:02:31Z | 51 `cancelled` | 51   | **0**      | **`startup_failure`, 0 jobs** |

O padrão de morte, medido nos `started_at`/`completed_at` de cada job:

- **`35990690695`**: 50 jobs com `started_at` = 24/09 11:02:25Z (o instante do
  enfileiramento) morreram em **25/09 11:02:25–26Z** — exatamente **24h**. O 51º job
  (`started_at` 25/09 11:02:28Z) só morreu em **26/09 11:02:28Z** — **48h**.
- **`35990702155`**: 50 jobs com `started_at` = **25/09 11:02:38Z** (o carimbo chegou
  **24h depois** do run ser criado) morreram em **26/09 11:02:39–40Z** — ou seja **48h
  do run, 24h do `started_at`**. O último (`started_at` 26/09 11:02:40Z) ficou pendurado
  até o **force-cancel de hoje** (26/09 13:19:58Z).

A régua que sai disso, e que vale a pena guardar: **o job enfileirado sem puxador é
cancelado ~24h depois do próprio `started_at`** — e quando esse carimbo só chega no
marco de 24h (o caso do segundo run), a morte cai em **48h do run**. São **duas janelas**,
não uma: prever "24h" e só olhar o relógio do run erra o primeiro caso por um dia inteiro.

E o que fecha o diagnóstico: `runner_name` **vazio em 101/101 e 51/51 jobs**. Nenhum passo
executou em nenhum dos dois runs.

## 3. O pool (MEDIDO)

- **1 runner registrado**: `hostinger-runner`, id **23**, `status: offline`,
  `busy: false`, versão **2.337.0**, labels `self-hosted, linux, x64, docker`.
- Repositório **privado** (`private: true`, `visibility: private`): **não há fallback**
  para runner hospedado — job sem o pool é job na fila, ponto.
- E o agravante é estrutural, não circunstancial: **todos os 50 jobs do attempt 2 pedem
  `self-hosted`** (agrupando por label: `self-hosted` × 50). O run inteiro depende de
  **um** puxador.
- A fila não é só ele: `Sync PostGIS Mirror (GHCR)` (`36232426954`) está `queued` desde
  **26/09 09:19:32Z**, esperando o mesmo pool.

## 4. As duas limpezas (MEDIDO)

- **O registro velho saiu**: `DELETE /actions/runners/23` → **204**; `total_count` foi de
  1 para **0**. Com zero registros, um `config.sh --replace` na VPS não briga com
  duplicata de nome.
- **O `/cancel` que não pega**: `POST /actions/runs/35990702155/cancel` → **202
  Accepted**, e o run **continuou `queued`** (medido ~60s depois: 50 jobs `cancelled` e
  **1 pendurado**). Só o `POST .../force-cancel` fechou: `completed/cancelled`.
- Lição operacional: em run `queued`, **`/cancel` sozinho não é garantia**; o rerun exige
  o run fechado, então o force-cancel é o que destrava a re-medição.

## 5. Os re-disparos (MEDIDO)

- `POST /actions/runs/35990690695/rerun` → **201**: attempt 2 `queued`, **50 jobs**, todos
  `self-hosted`, `started_at` 26/09 13:20:09Z. **É este run que tem veredito por vir.**
- `POST /actions/runs/35990702155/rerun` → **201 também**, mas o attempt 2 termina em
  **`startup_failure` com 0 jobs** (`run_started_at` 26/09 13:20:07Z, `updated_at`
  13:20:16Z): a branch `feature/tres-classes-base` **foi apagada**, e o GitHub não inicia
  workflow cujo ref não existe mais.
- `gh workflow run` recebe **`--ref`** ("branch or tag name"), não SHA — medido no `--help`
  da própria CLI. Sem ref, aquele head não tem caminho de dispatch: o único seria
  **criar um ref novo** (push).

## 6. O head declarado — e por que a declaração não custa medição

- `git patch-id` dos dois heads — o **digest do patch**, não um commit:
  **`sha1:737a68efdb35ebb138855b478d664974608c6e85` nos dois** — é o **mesmo patch**
  (`fix(ci): o job seed-hooks-guard instala as dependências antes do guard`, 3 workflows,
  71 linhas).
- O guard `scripts/check-seed-hooks.mjs` e `src/lib/seed/` são **byte-idênticos** entre os
  dois heads; a única diferença de `.github/workflows/pr-check.yml` são **2 linhas** de
  comentário/echo no job MASTER de mutação (38 → 41 sub-tests), **fora** do caminho do job
  em destaque.
- E a ponta **remota** da branch viva é o próprio `30447a57` (`git ls-remote`): o attempt 2
  mede exatamente o código que está publicado.

**DECLARADO**, então: o veredito literal do `e8419d5c` é `startup_failure` (ref apagado) —
não é verde, não é vermelho, é um head que não roda. O que se mede daquela correção é o
attempt 2 do `30447a57`.

## 7. O job em destaque: `Seed Test Hooks Guard (no prod leak)`

| run           | attempt | desfecho                                                                   | runner |
| ------------- | ------- | -------------------------------------------------------------------------- | ------ |
| `35990690695` | 1       | `cancelled` — **nunca rodou** (`started_at` = instante da fila)            | `""`   |
| `35990690695` | 2       | `queued` (o veredito sai com o pool de volta)                              | `""`   |
| `35990702155` | 1       | `cancelled` — 48h de fila (`started_at` 25/09 11:02:38Z → 26/09 11:02:39Z) | `""`   |

Três fatos medidos que cercam esse job:

- Em `30447a57` (e em `e8419d5c`) ele é **`runs-on: self-hosted`** — apesar do comentário
  do próprio job dizer que ele "roda no caminho que NÃO depende do runner da forja". No
  topo **local** (não publicado) ele é **`ubuntu-latest`**: essa é a correção do repo para
  este incidente, e ela ainda **não está no remoto**.
- No contrato declarado (`ci/required-checks.json`) o lado github exige **16 IDs de job**
  (`utf8-check · secrets-guard · workflow-refs-guard · workflow-run-syntax ·
bring-up-proof · pre-commit-in-runner-proof · bun-mirror-guard · actionlint · lint-guard ·
typecheck · check · security-headers · pii-allowlist-guard · mutation-guards ·
forge-parity-mutation · seed-guards`) — **`seed-hooks-guard` não está entre eles**.
- E o lado **aplicado** nem é legível: `GET /branches/main/protection` → **403 de plano**
  ("Upgrade to GitHub Pro or make this repository public"). Nenhum required check pode ser
  **lido nem aplicado** neste repositório privado — o que o próprio
  `scripts/apply-required-checks.mjs` já nomeia (o 403 do PLANO não é o 403 do TOKEN).

## 8. O instrumento passou a dizer o que faltava (MEDIDO)

O vigia (`.git/watch-pr-check.sh`, não versionado) ganhou, nesta triagem:

- o bloco **`⊘ SEM VEREDITO POR JOB`** para `startup_failure` (antes o run imprimia três
  seções vazias, que se leem como "nada reprovou");
- o veredito publicado **uma vez** por run (antes seriam ~720 repetições na janela de 12h);
- o estado do pool distinguindo **"a leitura falhou"** (`<sem-dado>`) de **"0 registrados
  (nenhum runner no pool)"** — a diferença que importa neste incidente;
- o comando de re-dispatch corrigido: o que ele imprimia,
  `gh workflow run pr-check.yml --ref feature/tres-classes-base`, **falha desde 25/09**;
- o **PORQUÊ de cada vermelho**: o passo que falhou, a URL do job e um recorte do log.

Três medições que a construção do porquê exigiu:

1. A cauda **crua** de um job vermelho é o **POST-JOB**, não o erro: medido no
   `GiST Benchmark (PR)` — as últimas linhas eram `docker network rm
github_network_a21accf1…` e `Cleaning up orphan processes`.
2. `gh api .../jobs/<id>/logs` **recusa** imprimir log com sequências de escape
   (`rc=1`, _"the response contains terminal escape sequences; pass
   --allow-escape-sequences"_): o recorte sairia **vazio** e o log diria "sem porquê".
3. O caminho que funciona é `gh run view --job <id> --log`, e o recorte fatia nesta ordem:
   linhas **dentro do passo que falhou** → linhas com `##[error]` → cauda.

Provado com o `veredito()` **real** em dois runs antigos: `35460515022` (14 vermelhos, com
o passo que falhou de cada um) e `35842009224` (`❌ Mirror postgis → GHCR` · passo
`Install crane (registry-to-registry copy, preserva digest)` ·
`##[error]Process completed with exit code 1.`).

## 9. Veredito — MEDIDO contra DECLARADO

**MEDIDO:**

- 0 de 101 jobs (e 0 de 51) com `runner_name`: nenhum passo executou.
- A morte na fila: **24h** do `started_at` do job, e **48h do run** quando o carimbo
  atrasa (as duas janelas acima).
- O pool: 1 runner `offline` → **0 registrados** (DELETE 204).
- `/cancel` 202 que **não** fecha o run; `force-cancel` que fecha.
- `POST /rerun` 201 nos dois heads; `startup_failure` com **0 jobs** no head sem ref.
- `patch-id` idêntico, guard byte-idêntico, ponta remota = `30447a57`.
- Proteção de branch: **403 de plano** (privado sem Pro) — nada lido, nada aplicado.
- Os três achados do instrumento (post-job, endpoint que recusa escape, o recorte que fatia).

**DECLARADO:**

- O **veredito por job do attempt 2** do `30447a57`: só existe quando a VPS registrar o
  puxador (o run está `queued` desde 26/09 13:20Z).
- O veredito literal do `e8419d5c` é **`startup_failure`** — não é verde nem vermelho.
- A metade **GitHub dos puxadores** do doctor segue dívida declarada em `ci/unproven.json`
  (`runner-queue-github`), com o `proveWith` nomeado: sem token, o fato cai em `unread`.
- A **causa da queda do runner** não foi medida aqui: exige `journalctl -u 'actions.runner.*'`
  e `df -h /home` na VPS.

## 10. O que fica aberto

- **Re-registro na VPS** (`deploy/setup-github-runner.sh`, ou o `config.sh --replace`
  direto): o token de registro é efêmero (~1h) e entra no `--token` do `config.sh`; o
  script rotula "PAT", mas repassa o valor como `--token`, que é onde o token de registro
  entra.
- A pergunta de desenho que o incidente abre: **por que 50 jobs de um `PR Check` dependem
  de um puxador só** — a política de `runs-on` da matriz é uma decisão, não um detalhe.
- O **pool como FATO no doctor**: hoje o lado github do fato da fila lê a fila, mas a
  metade dos puxadores exige token próprio e devolve `unread`.

## Como reproduzir

```bash
# 1) o estado do pool e o registro (leitura)
gh api repos/severinno/severinno/actions/runners --jq '{total_count, runners: [.runners[]? | {id,name,status,busy,version}]}'

# 2) os dois runs, job a job, COM as tentativas (filter=all) — é daqui que saem as duas janelas
for r in 35990690695 35990702155; do
  gh api "repos/severinno/severinno/actions/runs/$r/jobs?per_page=100&filter=all" --paginate \
    --jq '.jobs[] | [.run_attempt, (.conclusion // "-"), .runner_name, .started_at, (.completed_at // "-")] | @tsv'
done

# 3) o head que não roda: o ref apagado
gh api repos/severinno/severinno/actions/runs/35990702155 --jq '{status, conclusion, run_attempt}'
git ls-remote --heads origin | grep -c tres-classes-base   # 0: a branch não existe mais

# 4) o mesmo patch nos dois heads (a declaração não custa medição)
git show e8419d5c | git patch-id
git show 30447a57 | git patch-id

# 5) a proteção que não pode nem ser lida neste repo
gh api repos/severinno/severinno/branches/main/protection   # 403: "Upgrade to GitHub Pro"

# 6) o vigia (o que ele vê agora; janela de N horas)
bash .git/watch-pr-check.sh 12
```
