# Plano de fechamento — da árvore de hoje até produção 100% open source

**Data**: 2026-09-22 · **Estado medido**: `feature/forja-gates-e-regua-unica-reduzido` = `8e76c9a6`
(**143 commits à frente** de `origin/main`, 0 atrás).

---

## 0. Como ler este plano

O repositório já separa **medido** de **declarado** (o `--ci` do doctor diz, em voz alta, o que ele
NÃO cobriu). Este plano segue a mesma régua:

- todo item traz **de onde o número veio** (o comando), ou está marcado como **estimativa**;
- nada é considerado fechado sem **fonte única + guard + prova por mutação + canal acionável** — é a
  regra da casa, e é ela que impede o item de voltar;
- o §6 declara o que **não** deu para medir daqui (e o comando que mede), para ninguém ler promessa
  onde há lacuna.

---

## 1. O inventário medido (as "30+")

| #   | a pendência                            | o número medido hoje                                                                                                                                                        | a fonte                                  |
| :-- | :------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------- |
| 1   | **PRs abertas**                        | **7** (3 de tema + 4 do Dependabot) — era **11** (7 de tema), e as 4 superadas fecharam no ato de 22/09 (§8); 1 `CONFLICTING/DIRTY` (#25, por 3 arquivos do mesmo conserto) | `gh pr list --json …`                    |
| 2   | **A base "reduzida"**                  | as branches dos gates têm **0** dos 25 arquivos de `src/generated/` e **0** do `.github/actions/setup-bun` (main tem ambos)                                                 | `git ls-tree -r` nos 7 refs              |
| 3   | **Dependabot parado**                  | 4 PRs desde **07/09** (15 dias), todos `UNSTABLE`                                                                                                                           | `gh pr list`                             |
| 4   | **O que o doctor NÃO prova no `--ci`** | **12 itens** nomeados (guards, imagem, board, idade, env do host, proteção, registry, 3 refs não provadas, contrato da imagem, runner labels, valor dos espelhos)           | `node scripts/forge-doctor.mjs --ci`     |
| 5   | **Corte do GitHub**                    | 5 etapas; **etapa 1 executada**, etapas 2-5 abertas + os canais `gh`                                                                                                        | `docs/GITHUB_CUT.md`                     |
| 6   | **Produção (observabilidade)**         | `trivy` `semgrep` `gitleaks` `syft` `cosign` `slsa` `snyk` `k6` `uptime-kuma` `sops` `codecov` `sonar` = **0 arquivos** no repositório                                      | `grep -rwl` (fora `node_modules`)        |
| 7   | **Produção (o que já existe)**         | OTel (traces OTLP) + `pino` + **GlitchTip** (Sentry OSS) + Prometheus/Loki **ausentes**; `renovate` ausente, `dependabot` presente (acoplado ao GitHub)                     | `package.json`, `docker-compose.dev.yml` |
| 8   | **Relatório de staging velho**         | `docs/staging-readiness-report.json` de **14/08** (4/6, 2 warnings) — 39 dias                                                                                               | `head` do JSON                           |
| 9   | **Host: docker do snap**               | `docker stop/kill` negado por AppArmor (`docker info` → root `/var/snap/docker/...`); dois daemons no host (snap + apt)                                                     | `docker info`, `/proc` (rodada anterior) |
| 10  | **Vazamento do instrumento**           | **151** worktrees acumulados (instrumento que morre no timeout nunca vê o `rmSync`) — limpei, o defeito no código continua                                                  | `git worktree list`                      |
| 11  | **Custo do caminho do PR**             | `guards` **428,9s** · `mutation-guards` **394,9s** · `build` **246s** · `workflow-run-syntax` **61s** · `stack-per-commit` **86s**                                          | `ci/merge-latency.json`                  |
| 12  | **Crons longos**                       | `seed-guards` 2h · `tier1-fastpath-guard` 25min · `mutation-coord-timing-act` 25min                                                                                         | `ci/merge-latency.json`                  |

### 1.1 A pilha de PRs (a maior alavanca de velocidade)

```text
main ──#24 repo-hygiene (UNSTABLE)
        ├──#25 forja-gates-e-regua-unica-reduzido ── CONFLICTING
        │    └──#23 terceira-fonte-piso-e-regua-unica ── CONFLICTING
        └──#26 geo-bundle-logger (CLEAN)
#27 reguas-de-guards ← feature/reguas-de-guards-base (UNSTABLE)
#28 bench-frescor-da-regua ← feature/bench-frescor-da-regua-base (CLEAN)
#29 bench-frescor-e-passo-derivado ← feature/bench-frescor-da-regua-base (CLEAN)
#17..#20 dependabot ← main (UNSTABLE)
```

> Fechadas como superadas no ato de 22/09 (§8): **#23, #27, #28 e #29**. O que sobra de tema depois do
> ato é `#24` → `#25` (a série consolidada) → `#26`, mais os 4 do Dependabot.

Os temas de **#23, #27, #28 e #29 já estão DENTRO da série local** (a terceira fonte do gate de
sintaxe, a régua única de strings/flag/TLA, a régua da idade do bench com o passo derivado, os
required checks sem contagem). Ou seja: **quatro PRs são conteúdo superado** por um só — e é essa
duplicação que faz a lista parecer maior do que ela é.

### 1.2 A base "reduzida" (o defeito estrutural que o PR não mostra)

| ref                                           | arquivos | `src/generated/` | `.github/actions/setup-bun` |
| :-------------------------------------------- | -------: | ---------------: | --------------------------: |
| `origin/main`                                 |     1828 |           **25** |                           1 |
| `origin/feature/repo-hygiene` (#24, #26)      |     1828 |           **25** |                           1 |
| `origin/feature/forja-gates-…-reduzido` (#25) |     2041 |            **0** |                       **0** |
| `origin/feature/terceira-fonte-…` (#23)       |     1938 |            **0** |                       **0** |
| `origin/feature/reguas-de-guards` (#27)       |     2036 |            **0** |                       **0** |
| `HEAD` (série consolidada)                    |     2045 |            **0** |                       **0** |

**Corrigido em 22/09 (o parágrafo abaixo substitui a leitura "poda silenciosa"):** o diff contra
`origin/main` são **26 arquivos, e todos os 26 são duas remoções DELIBERADAS** — cada uma com commit,
razão escrita e guarda viva (§8 traz a prova de execução das duas).

| o que saiu                             | o commit que o tirou                                                                       | por que sai                                                                                                                                                                                                    | a guarda que o trava                                                                                                                                                                       |
| :------------------------------------- | :----------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/generated/prisma` (25 arquivos)   | `22272963 chore(prisma): remove client gerado versionado e trava a fonte única`            | o artefato era **divergente** do schema (exportava `UserRole`; o schema declara `enum Role`) e a rota `cron/push-scheduled` compilava **só** por causa dele — um `prisma generate` limpo quebraria o typecheck | `src/lib/__tests__/prisma-client-single-source.test.ts` (assere `existsSync("src/generated") === false`) · `check:ts-nocheck` (a exclusão de `generated` saiu: 24 `@ts-nocheck` foram a 0) |
| `.github/actions/setup-bun/action.yml` | `a582c31e ci(forge): gates da forja deixam de poder ficar verdes sem provar o que afirmam` | o `uses: ./` do act_runner **deixa de ser premissa**: o setup do Bun passa por `run:` + `scripts/setup-bun-ci.sh`, preservando as mesmas camadas de cache nas duas forjas                                      | `check:workflow-refs` (`uses: ./.github/actions/setup-bun` = ação local inexistente, violação nomeada) · `check:no-setup-bun` (o action externo não volta, em nenhuma forja)               |

Ou seja: **não é poda silenciosa e não há o que restaurar.** Trazer `src/generated/**` de volta é
reintroduzir o drift `UserRole`→`Role` e derrubar a guarda que o trava (medido: **1 de 3 testes
vermelho** no instante em que o diretório reaparece), além de devolver os 24 `@ts-nocheck` que o
mesmo commit removeu. O que faltava era **declaração, não código** — e é ela que este documento passa
a carregar; a evidência de pronto do §2 deixa de ser "nenhum arquivo gerado removido" e passa a ser
"**nenhum arquivo removido sem declaração**, com a guarda de cada remoção viva".

### 1.3 O que o doctor não prova (a lista do "Não provado")

Guards da forja · imagem do runner · dívida aberta no board · idade das declarações datadas ·
env do host × template · branch protection registrada · probe do registry · contrato da imagem
publicada · labels do runner · **as 3 refs não versionadas** (`IMAGE_REGISTRY`, `IMAGE_NAMESPACE`,
`BUN_VERSION`) · o valor dos espelhos contra `vars.BUN_VERSION` · o resultado da última execução do
`bring-up-proof`. Cada um tem **o comando que o prova** no rodapé do próprio doctor — nenhum precisa
de código novo, precisa de **credencial e estado do host** (Onda 1).

---

## 2. O plano, em cinco ondas

### Onda 0 — reconciliar e publicar a pilha (1 dia) · _destrava tudo o resto_

1. **Reconciliar a base reduzida** — **DECIDIDO (22/09), sem código novo**: as 26 deleções contra o
   `main` são duas decisões datadas (o client Prisma divergente e o composite `setup-bun`), cada uma
   **já travada por guarda viva** (§1.2 e §8). Restaurar `src/generated/**` está **descartado por
   medição**: deixa a suíte vermelha e reintroduz o drift. O que a Onda 0.1 vira é a declaração
   escrita da decisão, com a prova de execução das duas guardas — que é o §8 deste documento.
2. **Uma série só**: os temas de #23/#27/#28/#29 já estão na série local → publicar a série
   consolidada num branch e **fechar as quatro PRs como superadas**, citando a série.
3. **Ordem de merge**: `#24 repo-hygiene` → **série consolidada** (o #25 reescrito) → `#26 geo` →
   dependabot. Cada merge re-mede sozinho (é o que os gates fazem).
4. **Dependabot em lote**: 4 PRs de 15 dias — bumpar num único commit (o repo já mede o custo do
   `bun install`/cache) e **trocar por Renovate** quando o GitHub sair (Onda 4).
5. **Evidência de pronto**: `gh pr list` com **1 PR de tema aberta**; `git diff origin/main HEAD`
   **sem nenhuma remoção não declarada** (as 26 estão declaradas, com guarda — §1.2); a série local
   com "cada commit passa sozinho" ✅.

### Onda 1 — fechar o que o próprio repositório mede (2-3 dias)

1. **Rodar o doctor no perfil COMPLETO** (sem `--ci`) onde o estado existe: VPS da forja
   (`--gitea-env`), registry (`--registry-probe`), proteção (`--protection`), labels
   (`--runner-labels`), board (`--open-debt`), idade (`--bench-freshness`) e o valor dos espelhos
   (`--expected "$(gh variable get BUN_VERSION)"`). Cada "não provado" que sobrar vira item datado.
2. **Fechar os ciclos de reconciliação** já existentes (required checks, actrc, frescor, idade da
   régua, dependências do GitHub): o canal publica e fecha sozinho — o que falta é **rodar uma vez
   com credencial** e confirmar que o ciclo fecha.
3. **O host**: docker do snap nega `stop/kill` (AppArmor) — o remédio declarado é remover o daemon
   do apt do caminho (ele não tem container nenhum) e re-renderizar o perfil do snap. **Prova**: um
   `stop` e um `kill` reais + `docker ps` limpo.
4. **Vazamento do instrumento** (`prove-stack-per-commit` morto no timeout nunca limpa o worktree):
   registrar o worktree num `trap`/`finally` e **provar por teste** que um SIGTERM não deixa resíduo.
5. **Evidência de pronto**: doctor com veredito `PRONTA` (não `INDETERMINADA`) no host onde ele
   cobre tudo; `git worktree list` com 1 entrada após uma execução morta.

### Onda 2 — CI/CD de mercado, 100% open source (1 semana)

O que falta (medido: **zero arquivos** destes hoje) e o equivalente OSS que **não** depende do GitHub:

| lacuna                  | ferramenta OSS                                                     | onde entra                                                          |
| :---------------------- | :----------------------------------------------------------------- | :------------------------------------------------------------------ |
| SAST                    | **Semgrep** (OSS)                                                  | job do `pr-check`/`guards`, com regra própria versionada + baseline |
| Scan de imagem + IaC    | **Trivy** (`image` + `config`) e **hadolint**                      | job do build das duas imagens                                       |
| SBOM                    | **syft** (CycloneDX/SPDX)                                          | artefato do build + comparação por diff de pacotes                  |
| Assinatura/proveniência | **cosign** (Sigstore) + atestação do SBOM                          | depois do push no registry próprio                                  |
| Segredos no CI          | **gitleaks** (o `audit-secret-leaks` caseiro já cobre o histórico) | pre-commit + job                                                    |
| Carga                   | **k6**                                                             | `benchmark-weekly` (o mesmo canal de issue)                         |
| Uptime                  | **Uptime Kuma**                                                    | fora do CI, no VPS, com alerta no canal                             |
| Métricas/logs           | **Prometheus + Grafana + Loki** (`prom-client`/`pino-loki`)        | hoje só OTel (traces) + GlitchTip                                   |
| Dependências            | **Renovate** (auto-hospedado)                                      | substitui o Dependabot no corte                                     |
| Flags                   | **Unleash/Flagsmith** (OSS)                                        | rollout e rollback sem deploy                                       |

E três **otimizações medidas** (o custo está na tabela do §1):

1. **Matriz em shards**: `guards` (429s) e `mutation-guards` (395s) são o caminho crítico e rodam a
   matriz inteira em série — a régua de sub-tests **já mede o custo de cada uma**, então o shard sai
   do dado versionado, não de um chute.
2. **Recorte por diff no PR**: o `stack-per-commit` e as suítes já sabem derivar os testes afetados;
   aplicar o mesmo recorte declarado aos jobs longos (com o "NÃO MEDIDO" dito, nunca verde mudo).
3. **Runner próprio**: o act_runner da Gitea já roda as pipelines de lá; migrar os jobs do espelho
   elimina a fila dos runners hospedados (e é a Etapa 5 do corte).

**Evidência de pronto**: cada lacuna com job + guard + prova por mutação, e o relatório do doctor
declarando a cobertura (quantos tipos de verificação, quais).

### Onda 3 — produção (2-3 semanas)

1. **Dados**: backup **com restore provado** (o `pgbackup` existe; a prova de restore não), migrações
   Prisma versionadas com plano de rollback, e um ensaio de migração em cópia do banco de produção.
2. **Observabilidade acionável**: métricas + dashboards + **alertas que abrem issue/ticket** (o canal
   que o repositório já usa), SLOs escritos (latência, erro, fila), e o `RUNBOOK.md` com o caminho de
   incidente por sintoma.
3. **Segredos**: tirar `.env` do host do caminho crítico (**sops + age** no repositório, chave no
   host), rotação com `SECRET_ROTATION.md` ensaiada.
4. **Deploy sem downtime**: healthcheck + rolling no compose (`Caddy` já na frente), migração
   compatível, e o rollback testado (imagem anterior por digest).
5. **Capacidade**: teste de carga (k6) com o número declarado por endpoint + o PISO no
   `ci/merge-latency.json`.
6. **Conformidade**: SBOM publicado, imagem assinada, política de retenção de dados e o
   `pii-allowlist` já existente como catraca.
7. **Evidência de pronto**: relatório de prontidão **re-gerado** (o de hoje é de 14/08), com
   `failed=0` e os `warnings` explicados um a um.

### Onda 4 — o corte do GitHub, etapas 2-5 (contínuo)

`docs/GITHUB_CUT.md` já tem as 5 etapas e a catraca que mede a redução. Falta: os **9 crons** e as
vars do Actions (etapa 2), os **canais só-GitHub e o `gh`** (etapa 3 — `issue-publish.mjs` é o
gargalo nomeado), os **serviços acoplados a Actions** (etapa 4) e o **runner auto-hospedado** (etapa
5). O critério do dono: **nenhuma dependência nova do GitHub** (a catraca já falha o PR).

---

## 3. As alavancas de velocidade (por que isto fecha rápido)

1. **Consolidar a pilha** (Onda 0.2): 4 PRs superadas + 2 conflitos saem da lista de uma vez — é o
   maior ganho por hora gasta, e não depende de credencial nenhuma.
2. **Credencial é o gargalo, não código**: os 12 "não provados" do doctor são 12 comandos que já
   existem. Um `gh auth refresh -s read:project` + o token da forja + o env do host convertem
   "indeterminado" em veredito.
3. **Uma onda = um PR = um tema**: o repositório já paga caro por PR empilhada (é o que produziu os
   4 superados). Cada onda fecha com a catraca da própria onda.
4. **Orçamento por sub-test**: a régua do bench já mede o custo de CADA sub-test — o teto do job
   passa a ser derivado do dado versionado em vez de crescer por acúmulo.
5. **Recorte declarado** em vez de suíte inteira onde a pergunta é "o diff quebrou?" (`--only`,
   `--sem-afetados`), com o pulado **nomeado**.
6. **Cada conserto nasce com guard + mutação**: é o que fez o trabalho da última semana não voltar
   (38 sub-tests de mutação, 48 `check:*`). Item sem guard é item que reabre.
7. **Ciclos de reconciliação em vez de caça manual**: todo drift abre issue com contexto e delta e se
   fecha sozinho quando volta a bater — a lista de atividades deixa de ser mantida à mão.
8. **O corte do GitHub como projeto, não como faxina**: cada etapa tem medidor; o custo de manter
   duas forjas cai etapa por etapa.

---

## 4. Definição de pronto ("100% ok" nesta casa)

Um item só está fechado quando: **fonte única** (nada declarado à mão em dois lugares) · **guard**
que falha o PR · **prova por mutação** (o guard cego fica vermelho) · **prova por execução** nos dois
contextos (local e CI) · **canal acionável** se voltar · **doc derivada** (nenhum número escrito que
o código não gere) · e o **limite declarado** (o que ele não cobre).

---

## 5. As sete primeiras ações, na ordem

| ordem | ação                                                                                                                   | esforço     | destrava                               |
| :---- | :--------------------------------------------------------------------------------------------------------------------- | :---------- | :------------------------------------- |
| 1     | Base reduzida reconciliada por declaração (não por restauração) e publicar a série consolidada; fechar #23/#27/#28/#29 | 1 dia       | as duas PRs conflitantes e 4 superadas |
| 2     | Merge `#24` → série → `#26`; dependabot num commit                                                                     | 0,5 dia     | a `main` volta a andar                 |
| 3     | `gh auth refresh -s read:project` + token da forja + env do host → doctor COMPLETO                                     | 0,5 dia     | os 12 "não provados"                   |
| 4     | Conserto do vazamento do instrumento (com prova por SIGTERM)                                                           | 0,5 dia     | o resíduo que reaparece sozinho        |
| 5     | Semgrep + Trivy + SBOM + cosign nos jobs de PR (com baseline)                                                          | 2-3 dias    | a lacuna de segurança medida           |
| 6     | Restore provado do backup + métricas/alertas + prontidão re-gerada                                                     | 1 semana    | produção                               |
| 7     | Corte do GitHub, etapas 2 e 3                                                                                          | 1-2 semanas | 100% open source                       |

---

## 6. O que este plano NÃO mediu (e o comando que mede)

- **o board de atividades** (GitHub Projects): a credencial deste checkout não tem `read:project` —
  `gh auth refresh -s read:project` e depois `gh project list --owner severinno`. Se as "30+ questões"
  vierem de lá, elas **não** estão neste inventário.
- **a forja dona do merge**: sem token da Gitea (`https://git.severinno.cloud`) as issues de
  drift dela não entram — o doctor tem a seção, falta a credencial.
- **o host de produção**: `--gitea-env` aponta outro checkout; o env do VPS não existe aqui.
- **os 3 refs não versionados** (`IMAGE_REGISTRY`, `IMAGE_NAMESPACE`, `BUN_VERSION`): vivem no
  Actions/na forja, não no checkout.
- **os custos de job**: citação do `ci/merge-latency.json`; o ato do bench deste host pode divergir
  (é o que a régua do frescor mede).

## 7. A catraca deste plano

_(o §8 é o registro do que a Onda 0 fechou; a catraca abaixo continua sendo o alvo)_

Para a lista não voltar a ser prosa: (a) o inventário vira **dado versionado** (`ci/fechamento.json`)
com o estado e a data de cada item; (b) um guard falha quando um item marcado como fechado **volta**
(ou quando um item aberto perde o dono); (c) a contagem de PRs abertas × PRs superadas entra no
relatório do doctor, como o corte do GitHub já faz. Sem (b), isto é um documento — com (b), é o
contrato que fecha a lista.

---

## 8. Onda 0 — o que ficou reconciliado (ato de 2026-09-22)

**1. A base reduzida — declarada, não restaurada.** As 26 deleções contra `origin/main` são as duas
remoções deliberadas do §1.2. A prova de execução das duas guardas, medida neste host:

| a guarda                                     | a execução                                                                                                                                                                                                                                               | o veredito                    |
| :------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------- |
| `prisma-client-single-source.test.ts`        | no estado íntegro: **3/3 verde** · com `mkdir src/generated` (o órfão de volta): **1 de 3 VERMELHO**, com o texto "é artefato órfão que ninguém regenera (a causa do drift `UserRole`→`Role`)" · removido o diretório: 3/3 verde de novo                 | a remoção é **load-bearing**  |
| `check-workflow-refs` + `check-no-setup-bun` | função pura executada contra um workflow com `uses: ./.github/actions/setup-bun` → **acusa** `kind: action, ref: setup-bun`; nenhuma ação local existe na árvore (`git ls-tree`, 0 arquivos); na árvore real, os dois guardas saem ✅ em ambas as forjas | a exclusão é **load-bearing** |

**2. Uma série só.** Os temas de #23/#27/#28/#29 estão dentro da série local e **evoluídos** (o
`pre-commit-run-syntax-remedy.mjs` do #23 virou o par derivado `remedy-classes/run-syntax.mjs` +
`remedy-canal/run-syntax.mjs`; o resto aparece com `docs/GUARDS.md` +3663 e `README.md` +996 contra
a versão da PR). As quatro PRs são **conteúdo superado** e ficam fechadas citando a série.

**3. A ordem de merge** fica declarada como o §2, Onda 0.3: `#24 repo-hygiene` → **série
consolidada** (o PR #25) → `#26 geo` → dependabot. Nenhum merge é feito neste ato.

**4. Publicado e fechado (o que o ato mudou de fato):**

| o quê               | o estado depois do ato                                                                                                                                                                                                                                                                                            |
| :------------------ | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| a série consolidada | `feature/forja-gates-e-regua-unica-reduzido` = **`8e76c9a6`** no `origin` (push com o hook `pre-push` real: 6 dos 21 commits medidos pela amostra, todos verdes; o veredito da pilha inteira é o job `stack-per-commit`)                                                                                          |
| PRs abertas         | **11 → 7**: #23, #27, #28 e #29 **fechadas como superadas**, cada uma com o comentário que cita a série e o ponto exato de cada tema                                                                                                                                                                              |
| o #25               | o registro do ato está no corpo do PR; segue `CONFLICTING` com a base por **três arquivos** (`.github/workflows/pr-check.yml`, `scripts/check-mutation-count.mjs`, `scripts/test-mutation-mutation-count.sh`) — o **mesmo** conserto do _count no nome do required check_ dos dois lados, não conteúdo divergente |

**5. O passo 1 da ordem está barrado por INFRA, medido — não por código.** Os checks do #24 estão
`cancelled` com **24h0m0s/24h0m1s** de fila (53 de 57 linhas): o job esperou o timeout de 24 h e foi
cancelado. A causa está medida no mesmo ato: `gh api repos/severinno/severinno/actions/runners` →
**`total_count = 0`** — não há runner registrado no GitHub (o mesmo bloqueio que o doctor do perfil
completo já nomeava). Consequência para a ordem: enquanto o espelho do GitHub não tiver runner (ou o
merge não acontecer na forja dona, onde o act_runner roda as pipelines), **nenhuma** das quatro etapas
da ordem consegue ficar verde — o remédio já está no plano (Onda 2.3: runner próprio; Onda 4, etapa 5).
