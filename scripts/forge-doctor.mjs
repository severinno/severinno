#!/usr/bin/env node

// =============================================================================
// forge-doctor.mjs
//
// Usage:
//   node scripts/forge-doctor.mjs                 # relatório de prontidão da forja
//   node scripts/forge-doctor.mjs --json          # o mesmo, como dados
//   node scripts/forge-doctor.mjs --ci --expected "$BUN_VERSION" \
//     --expected-var IMAGE_REGISTRY=... --expected-var IMAGE_NAMESPACE=...
//                                                # o PERFIL de pipeline (job guards):
//                                                # fatia local, sem rede/credencial
//   node scripts/forge-doctor.mjs --no-guards     # pula a bateria (só contrato + imagem)
//   node scripts/forge-doctor.mjs --ci          # perfil CI (recortes explícitos, veredito honesto)
//   node scripts/forge-doctor.mjs --no-protection # pula a leitura da forja (branch protection)
//   node scripts/forge-doctor.mjs --no-runner-labels # pula o registro do runner (as duas forjas)
//   node scripts/forge-doctor.mjs --no-image-contract # pula o contrato da imagem PUBLICADA
//   node scripts/forge-doctor.mjs --no-registry-probe # offline: nao consulta o registry
//   node scripts/forge-doctor.mjs --no-open-debt  # offline: nao le o board (as issues abertas)
//   node scripts/forge-doctor.mjs --expected 1.3.14   # valor de vars.BUN_VERSION
//   node scripts/forge-doctor.mjs --expected 1.3.14 \
//     --expected-var IMAGE_REGISTRY=... --expected-var IMAGE_NAMESPACE=...
//   node scripts/forge-doctor.mjs --gitea-env deploy/.env.gitea
//   node scripts/forge-doctor.mjs --timeout 300   # segundos por guard (default 120)
//
// O PERFIL `--ci` (e por que ele existe): o job `guards` da forja roda o doctor
// a CADA PR para o VALOR das repository variables ser conferido no merge e não
// só no cron. O que muda é o ESCOPO, nunca a régua: as seções caras/privilegiadas
// saem (a bateria de guards — que É aquele job —, a prova do bloqueio — que
// executa o `gitea-up.sh`, que por sua vez executa este doctor —, a branch
// protection registrada, o registro do runner, o contrato da imagem publicada,
// o probe do registry e o board), e ficam as que um runner de PR prova sem
// credencial: contrato de merge, env mirror, render do compose e o VALOR dos
// espelhos. Uma divergência de valor BLOQUEIA (exit 1); o que sobrou fora do
// escopo sai NOMEADO como não provado (a lista `unproven`), e é isso que faz o
// veredito do perfil ser INDETERMINADA sem mentir.
//
// Exit codes:
//   0 — PRONTA: tudo o que dá para provar localmente foi provado, e a imagem do
//       runner existe e é puxável
//   1 — BLOQUEADA: alguma invariante falhou, OU a imagem do runner não está no
//       registry (sem ela NENHUM job inicia), OU a branch protection REGISTRADA
//       na forja diverge do manifesto (o merge é bloqueado pelo motivo errado, ou
//       não é bloqueado), OU uma referência em config NÃO VERSIONADA foi provada
//       errada (variável da forja divergindo dos espelhos, env do host da app
//       divergindo do template, default do compose divergindo do declarado, tag
//       re-tagada/ausente no registry), OU o REGISTRO do act_runner não é o do
//       compose (label gravado apontando para outra imagem: o job roda o que não
//       foi revisado), OU a imagem PUBLICADA não executa o contrato do build
//       (sem o plugin `compose`, com OUTRA versão do Bun, ou com o Bun fora de
//       /usr/local/bin) — o merge não pode ser confiado
//   2 — INDETERMINADA: nada falhou, mas algo não pôde ser provado (registry
//       inacessível, pacote privado sem credencial, ferramenta ausente) OU há
//       dívida ABERTA no board (uma issue de drift que ninguém fechou: o
//       repositório já sabe do problema, e o veredito não pode ignorá-lo)
//   3 — uso/erro interno (argumento inválido, pipeline ilegível) OU RECURSÃO
//       detectada (o doctor rodando DENTRO da própria prova). Nos dois casos o
//       doctor EMITE o relatório — no de recursão, com o fato `nestedGuard` e um
//       bloqueador que nomeia a recursão —, para a causa não ficar só no stderr
//       nem depender de distinguir "flag errada" de "recursão" pelo código.
//
// POR QUE EXISTE: os guards da forja passavam VERDES e a forja ainda não
// bloqueava o merge. Cada peça tem seu guard, mas ninguém respondia a pergunta
// inteira — e as respostas parciais alinhavam num sentido falso:
//
//   - `check:forge-parity` prova que a pipeline da forja CONTÉM as invariantes
//     do CORE. Ele não prova que elas PASSAM agora, nem que a branch protection
//     as exige, nem que o runner consegue iniciar um job;
//   - `check:required-checks` prova que o manifesto aponta para jobs que
//     EXISTEM. Ele não prova que a forja aplicou aquele manifesto — nem que um
//     job ESPECÍFICO esteja no manifesto: o contrato pode ficar válido e MENOR,
//     deixando a prova do bring-up verde e o merge livre; e um job exigido cuja
//     linha `run:` deixou de rodar a prova fica verde sem medir nada. É o fato
//     `bringUpGate` (seção 4), derivado do MESMO manifesto que o contrato lê;
//   - `runner-image:ensure` prova a imagem. Ele não sabe nada sobre os guards.
//
// E a garantia da imagem tinha um buraco próprio: `runner-image:check` diz se a
// tag existe AGORA, mas não prova que a subida da stack depende dela. Quem prova
// isso é uma seção a mais — a PROVA DO BLOQUEIO (seção 4): ela executa o
// `deploy/gitea-up.sh` real contra um registry de TESTE em 127.0.0.1, com a tag
// ausente e com a tag presente, e afirma sobre o LOG do docker dublê. Sem ela, o
// relatório afirmaria "a imagem está garantida" sem nunca ter visto o bloqueio
// acontecer.
//
// QUEM O CHAMA, E POR QUE ISSO IMPORTA: o `deploy/gitea-up.sh` executa este
// doctor como PRÉ-REQUISITO da subida da stack — veredito BLOQUEADA (e "não
// consegui rodar": sem veredito não há prontidão) RECUSA a subida, e
// INDETERMINADA avisa e segue, porque "não consegui provar agora" não é
// violação. Ele o chama INTEIRO — a seção 4 (a prova do bloqueio) roda junto. A
// prova EXECUTA aquele script, então a cadeia `bring-up → doctor → prova →
// bring-up` só é finita porque a prova DUBLA o doctor que ela passa ao bring-up
// dublado (`DOCTOR_SCRIPT`); o corte é medido em cada caso dela
// (`expectDoctorStub`) e a cadeia completa é provada por execução em
// `src/lib/__tests__/prove-runner-image-gate.test.ts`. A prova NÃO pode ser
// desligada numa invocação manual — quem precisa de um recorte usa `--ci` (que
// declara cada seção pulada explicitamente) ou flags individuais
// (`--no-guards`, `--no-protection`, etc.).
//
// Com todos eles verdes, um runner sem a imagem publicada, ou um gate quebrado
// no momento do merge, ainda travava o PR — e o diagnóstico chegava pelo
// sintoma mais distante da causa. Este comando junta as peças num veredito, e
// — igual de importante — DIZ O QUE NÃO PROVOU.
//
// DE ONDE VEM A LISTA DE GUARDS (o ponto central do desenho): de LUGAR NENHUM
// escrita à mão. A forja é dona do merge, então quem define "os guards da
// forja" é o próprio job `guards` de `.gitea/workflows/ci.yml`. O doctor fatia
// esse job e executa os gates que estão lá, com a mesma classificação que o
// `check-forge-parity` usa (`discoverGates`). Consequência: um guard novo na
// pipeline entra no doctor SOZINHO, e um guard removido de lá some daqui — não
// existe lista paralela para envelhecer.
//
// A branch protection REGISTRADA na forja ele AGORA lê (seção 1, o outro lado do
// contrato): quem lê é `scripts/apply-required-checks.mjs --check --json`, a
// mesma comparação que o cron de drift usa — sem uma segunda implementação que
// pudesse divergir da primeira justamente no dia do drift. Sem token de
// administração (ou sem rede), o estado é "não lida" — NUNCA "em sincronia".
//
// Os ESPELHOS das variáveis da imagem têm as duas metades: a de sempre (os
// arquivos existem e concordam entre si, sem rede) e a que faltava — cada um bate
// com o VALOR declarado, `vars.BUN_VERSION` por `--expected` e as demais
// (`IMAGE_REGISTRY`, `IMAGE_NAMESPACE`) por `--expected-var`, pela MESMA função
// que o guard periódico usa (`mirrorDriftReport`). Sem o valor, o doctor não
// inventa "em sincronia": ele diz que o valor não foi comparado (e o veredito
// fica parcial), porque dois espelhos que concordam entre si podem estar os DOIS
// velhos.
//
// O TEMPO, e por que a otimização NÃO muda o veredito: a bateria de guards roda
// com PARALELISMO LIMITADO (`runGatesConcurrent`, `DEFAULT_GATE_CONCURRENCY`),
// porque ela é uma lista de perguntas INDEPENDENTES — o teto do tempo passa a ser
// o gate mais lento, não a soma. Os resultados voltam na ORDEM da bateria e um
// gate que estoura vira NÃO VERIFICADO (o mesmo `code: null` de sempre), então o
// significado de cada gate é idêntico ao do caminho sequencial (`runGuards`, que
// segue existindo para quem injeta um `run` síncrono). E a identidade da imagem
// servida pela tag é MEMOIZADA (`createRegistryIdentityCache`): os DOIS fatos que
// fazem a mesma pergunta (referências não versionadas e contrato da imagem
// publicada) dividem UMA ida ao registry; erro não é cacheado, e um estado de
// incerteza (`unreachable`, `unauthorized`) continua sendo devolvido como
// INDETERMINADO a cada consumidor — cachear resposta é atalho, cachear dúvida
// seria mentir.
//
// As REFERÊNCIAS que não estão no repositório (invariante 9 do
// `check-registry-source`) entram pela MESMA função do gate — repository
// variables, env do host da aplicação e o que o registry serve para a tag. Ele
// não reimplementa nada: um segundo comparador divergiria do primeiro justamente
// no dia do drift. Violação bloqueia; INDETERMINADO nunca vira "pronta"; e um
// arquivo gitignored ausente (`absent`) não é pendência — é "não aplicável aqui".
//
// O CONTRATO DA IMAGEM PUBLICADA (seção 3) fecha o buraco que o build não
// alcança: as provas do build (o pin por digest, o bloco fail-closed, as
// mutações) continuam verdadeiras se a imagem que o registry serve for OUTRA
// build — e o job baixa essa. Quem responde é `checkPublishedImageContract`:
// resolve o DIGEST que a tag serve hoje e RODA o bloco do contrato DENTRO do
// artefato (`docker run <repo>@<digest>`), lendo plugin `compose`, versão do Bun
// e o caminho resolvido. Violação BLOQUEIA (o runner roda uma imagem que não
// cumpre a promessa); "não conseguiu rodar" (sem daemon, sem credencial, pull
// negado) é INDETERMINADA — e o custo é dito: o primeiro run baixa a imagem.
//
// O REGISTRO do act_runner (`/data/.runner`, seção 3) entra pela função do guard
// da Prova 5 do smoke (`checkRunnerLabels`, o mesmo exit code) — existe para o
// veredito não dizer "o compose PEDE a imagem certa" e ficar em silêncio sobre o
// que o runner GRAVOU, que é o que decide a imagem de cada job. Registro velho,
// vazio (runner órfão) ou compose sem os labels BLOQUEIAM; sem docker/container
// ou registro ilegível é INDETERMINADA — "não consegui ler" nunca é "está certo".
//
// O REGISTRO do runner do GITHUB (`--forge github` do MESMO guard, seção 3) é o
// fato irmão: lá o registro não tem arquivo (o `.runner` do actions/runner não
// guarda label nenhum), então quem decide é a API — e o declarado é o
// `RUNNER_LABELS` de `deploy/setup-github-runner.sh`. Mesmos pesos (violação
// bloqueia; sem token/API é INDETERMINADA), porque o sintoma é o mesmo: o
// workflow que pede um label que não está registrado não falha — ele ESPERA.
//
// A DÍVIDA ABERTA NO BOARD (seção 6) é o outro lado da moeda: tudo acima mede a
// forja AGORA, e nada disso enxerga a issue que um cron já abriu e ninguém
// fechou. Quem lê o board é `listIssuesByLabel`, a MESMA consulta dos
// publicadores, e o assunto tem de ser NOSSO (o marcador, não só a label).
// Dívida aberta NÃO bloqueia (não prova que o merge pode ser furado), mas
// impede PRONTA — e as duas labels cujo assunto o doctor mede por conta própria
// (`required-checks-drift` → proteção registrada, `actrc-sync-drift` → espelhos)
// vêm com a medição ao lado, para a issue velha não passar por problema vivo.
//
// O que ele NÃO pode provar daqui, e por isso sai escrito no relatório:
//   - a PERMISSÃO do token sobre a forja (sem ela, "não lida");
//   - o smoke (tier-1 em runtime — é um job da própria forja);
//   - o `.env.gitea` do VPS, que não existe neste checkout.
// =============================================================================

import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import process from "node:process"
import { spawn, spawnSync } from "node:child_process"
import { fileURLToPath, pathToFileURL } from "node:url"

import { CORE_INVARIANTS, discoverGates } from "./check-forge-parity.mjs"
import { checkPublishedImageContract } from "./check-runner-base.mjs"
import {
  createRegistryIdentityCache,
  credentialsFromEnv,
  ensureRunnerImage,
  DEFAULT_ENV_FILE,
} from "./ensure-runner-image.mjs"
import { GITHUB_RUNNER_SCRIPT, checkGithubRunnerLabels } from "./check-runner-labels.mjs"
import { proveRunnerImageGate } from "./prove-runner-image-gate.mjs"
import { checkComposeInterpolation, checkNonVersionedImageRefs } from "./check-registry-source.mjs"
import { collectDeclaredDebt, textoFonteVencida } from "./declared-debt.mjs"
import { checkRunnerLabels } from "./check-runner-labels.mjs"
import {
  ENV_MIRROR_SCRIPT,
  GITEA_BRING_UP,
  GITEA_COMPOSE,
  PROOF_SCRIPT,
} from "./check-bun-mirror.mjs"
import { GITEA_WORKFLOW_DIR, allWorkflowFiles, defaultsRunLines } from "./forge-workflows.mjs"
import { workflowShellInheritance } from "./check-pipefail-sigpipe.mjs"
import {
  clearStaleClosure,
  describeGithubRead,
  githubReadConfig,
  issueHasAnyMarker,
  listIssuesByLabel,
  readStaleClosures,
} from "./issue-publish.mjs"
import {
  ENV_MIRROR_COSTS,
  extractActrcBunVersion,
  GITEA_ENV_MIRROR,
  MIRROR_VARIABLES,
  mirrorDriftReport,
  normalizeExpectedVars,
  readMirrorVariableValues,
} from "./check-actrc-sync.mjs"
// A PROVA do bloqueio LOCAL (o pre-commit recusa um corpo `run:` quebrado no
// ÍNDICE): ela mora em `scripts/pre-commit-proof.mjs` junto com a camada do hook
// que os testes dos hooks usam — a régua é UMA só, e o doctor a EXECUTA em vez de
// confiar na existência do teste que a mede.
import { proveCommitBlocks } from "./pre-commit-proof.mjs"
// A PROVA do bloqueio do OUTRO ELO do contrato local (o `pre-push` recusando um
// push com a árvore VERMELHA, sem deixar objeto nenhum no remoto): ela mora em
// `scripts/pre-push-proof.mjs` junto com a camada do hook que o teste
// `pre-push-git-push-blocks.test.ts` importa — a régua é UMA só, e o doctor a
// EXECUTA em vez de confiar na existência do teste que a mede.
import { provePushBypass, provePushBlocks } from "./pre-push-proof.mjs"
// A RÉGUA DOS COMANDOS DOS HOOKS: o fato do contrato local declara o que cada
// hook RODA, e a leitura é a do `check-hook-commands` (o dono da régua) —
// importada, nunca reescrita aqui. Duas leituras do mesmo texto divergiriam no
// dia em que uma delas mudasse, e o veredito passaria a julgar um contrato que o
// gate não julga mais (ou o contrário). `analyze` não executa nada no import: o
// guard só roda quando é chamado como script.
import { analyze as analyzeHookCommands } from "./check-hook-commands.mjs"

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")

/** O manifesto do contrato de merge (fonte única dos checks obrigatórios). */
export const REQUIRED_CHECKS_MANIFEST = "ci/required-checks.json"

/** A pipeline DONA DO MERGE — de onde a bateria de guards é derivada. */
export const MERGE_OWNER_PIPELINE = `${GITEA_WORKFLOW_DIR}/ci.yml`

/** O job dessa pipeline cujos gates formam a bateria da forja. */
export const FORGE_GUARDS_JOB = "guards"

/**
 * O APLICADOR do contrato — a única implementação da comparação
 * manifesto ↔ branch protection registrada (ver `readProtection`).
 */
export const REQUIRED_CHECKS_APPLIER = "scripts/apply-required-checks.mjs"

/**
 * O job que COBRA o bring-up no merge — o ID do job, não o `name:` exibido
 * (renomear o `name:` muda o contexto de status e não pode mexer no que está
 * protegido; mesma regra do manifesto).
 */
export const BRING_UP_GATE_JOB = "bring-up-proof"

/**\ * Env var que a PROVA seta no bring-up dublado. Se o doctor detecta este
 * valor, sabe que está rodando DENTRO da própria prova (recursão) e falha
 * alto — a dublagem (DOCTOR_SCRIPT) é o corte PRIMÁRIO, mas este guard é
 * o DEFESA EM PROFUNDAZURA: se o stub falhar ou for removido, o doctor
 * recusa em vez de recursar infinitamente. Exit 3 = detecção de recursão.\ */
export const NESTED_GUARD_ENV = "FORGE_DOCTOR_NESTED"

/**
 * Flag EQUIVALENTE à env var, para quem não controla o AMBIENTE do filho.
 *
 * POR QUE OS DOIS CANAIS: a prova marca a invocação aninhada com a env var
 * (o padrão). Mas um chamador que reexecuta o doctor por linha de comando —
 * um wrapper, um `spawn` que não propaga o `env`, um script de diagnóstico —
 * não tem como setá-la. Sem a flag, esse caminho ficava SEM a defesa: o
 * doctor recursava até o limite de processos, e o erro real (o ciclo
 * bring-up → doctor → prova → bring-up) aparecia como exaustão de recursos.
 * Com os dois canais, a defesa cobre os dois jeitos de marcar a invocação.
 */
export const NESTED_GUARD_FLAG = "--proof-nested"

/**
 * Exit code com que o doctor RECUSA quando detecta a recursão.
 *
 * Nomeado porque é CONTRATO (o `deploy/gitea-up.sh` e os consumidores leem o
 * código) — e é o MESMO 3 do uso inválido. Essa coincidência é justamente o
 * motivo do relatório abaixo: sem ele, quem lê o exit code não distinguia "o
 * doctor foi rodado dentro da própria prova" de "passaram uma flag errada".
 */
export const NESTED_GUARD_EXIT = 3

/**
 * O doctor está rodando DENTRO da própria prova (ou seja: recursão)?
 *
 * Pura e injetável (env/argv) de propósito: o teste exercita CADA canal sem
 * subprocesso, e o `main` só consome a resposta — a regra (env OU flag) vive
 * num lugar só.
 *
 * @param {{env?: Record<string, string|undefined>, argv?: string[]}} [io]
 * @returns {boolean}
 */
export function isNestedDoctorInvocation({ env = process.env, argv = process.argv } = {}) {
  return Boolean(env[NESTED_GUARD_ENV]) || argv.includes(NESTED_GUARD_FLAG)
}

/**
 * O RELATÓRIO da recursão — o que o guard passa a DIZER, em vez de só recusar.
 *
 * POR QUE EXISTE: o guard cortava o ciclo e saía com o código 3, com a causa
 * no stderr. Quem consome a PRONTIDÃO (o `--json`, o publicador de issues, o
 * operador que só vê o exit code) recebia um código OPACO — 3 é o mesmo código
 * de uso inválido —, e a causa vivia fora do canal do relatório. Agora o fato
 * viaja em stdout/`--json`, o mesmo canal do veredito, e o bloqueador o NOMEIA.
 *
 * SÓ o fato da recursão entra: as seções não foram coletadas, e preenchê-las
 * como "ok" seria a falsa segurança que o resto do doctor existe para matar. O
 * `unproven` declara exatamente isso, para o veredito não mentir para nenhum
 * dos dois lados.
 *
 * Pura e injetável (env/argv) de propósito: o teste exercita CADA canal sem
 * subprocesso, e o `main` só consome a resposta.
 *
 * O ESTADO `fired` (e não `violated`) porque este fato tem TRÊS perguntas e
 * três respostas: `fired` = o guard disparou NESTA invocação; `armed` = o guard
 * está no caminho e responde aos dois canais; `disarmed` = não responde a algum
 * deles. `violated` diria o mesmo que "armed"/"disarmed" sem distinguir qual
 * das duas — e um consumidor (o publicador de issue) precisa saber se o guard
 * DISPAROU, não se ele está bem armado.
 *
 * @param {{env?: Record<string, string|undefined>, argv?: string[]}} [io]
 * @returns {{facts: {nestedGuard: {state: string, channels: {channel: string, name: string}[], envVar: string, flag: string, exit: number}}, verdict: {verdict: string, blockers: string[], unknowns: string[], unproven: string[]}}}
 */
export function nestedGuardReport({ env = process.env, argv = process.argv } = {}) {
  const channels = []
  if (env[NESTED_GUARD_ENV]) channels.push({ channel: "env", name: NESTED_GUARD_ENV })
  if (argv.includes(NESTED_GUARD_FLAG)) channels.push({ channel: "argv", name: NESTED_GUARD_FLAG })
  const marcado =
    channels.map((c) => `${c.name} (${c.channel})`).join(" e ") || "canal desconhecido"
  return {
    facts: {
      nestedGuard: {
        state: "fired",
        channels,
        envVar: NESTED_GUARD_ENV,
        flag: NESTED_GUARD_FLAG,
        exit: NESTED_GUARD_EXIT,
      },
    },
    verdict: {
      verdict: VERDICT.BLOCKED,
      blockers: [
        `RECURSAO: o doctor foi invocado DENTRO da propria prova (marcado por ${marcado}) — o ciclo bring-up → doctor → prova → bring-up foi interrompido por este guard antes de coletar qualquer fato`,
      ],
      unknowns: [],
      unproven: [
        "NENHUMA seção foi coletada: o guard de recursão recusou antes de rodar — este relatório cobre apenas o fato `nestedGuard`",
      ],
    },
  }
}

/**
 * O FATO do guard de recursão ARMADO — a outra metade de `nestedGuardReport`.
 *
 * POR QUE O RELATÓRIO NORMAL PRECISA DELE: o `nestedGuardReport` só existe
 * quando o guard DISPARA. Sem este fato, um veredito não diz NADA sobre a
 * DEFESA: se o `isNestedDoctorInvocation` sair do caminho quente, ou se um dos
 * dois canais deixar de ser respondido, o relatório de uma forja saudável fica
 * idêntico — a proteção do ciclo (bring-up → doctor → prova → bring-up) pode
 * ter sumido sem que a prontidão mude uma linha. É cobertura de EXISTÊNCIA, e
 * não só de disparo.
 *
 * O QUE ELE PROVA, E COM QUE FORÇA: sonda a MESMA função do caminho quente
 * (`isNestedDoctorInvocation`), um canal por vez, com entradas sintéticas — não
 * uma segunda implementação da regra, que mediria a si mesma (o defeito que o
 * `--expected-var` e a comparação de espelhos já evitam no resto do doctor).
 *
 * O QUE ELE NÃO PROVA (e por isso está escrito no `detail`): a POSIÇÃO do
 * corte — que o check roda ANTES de qualquer coleta. Essa metade não se mede de
 * dentro: medir a defesa do ciclo dando a volta no ciclo é exatamente o que a
 * defesa impede — um filho sem o corte É a recursão, e o diagnóstico não pode
 * virar o defeito. Quem prende a posição são os testes que executam os DOIS
 * canais de fora (o `--proof-nested` sai 3 antes de coletar) e o
 * `checkGiteaBringUp`, que prende a invocação e a ordem.
 *
 * @param {{probe?: typeof isNestedDoctorInvocation}} [deps]
 * @returns {{state: "armed"|"disarmed", channels: {channel: string, name: string}[], armed: Record<string, boolean>, envVar: string, flag: string, exit: number, detail: string, remedies: string[]}}
 */
export function recursionGuardFacts({ probe = isNestedDoctorInvocation } = {}) {
  const channels = [
    { channel: "env", name: NESTED_GUARD_ENV },
    { channel: "argv", name: NESTED_GUARD_FLAG },
  ]
  const armed = Object.fromEntries(
    channels.map((c) => [
      c.channel,
      probe(
        c.channel === "env"
          ? { env: { [NESTED_GUARD_ENV]: "1" }, argv: [] }
          : { env: {}, argv: [NESTED_GUARD_FLAG] },
      ) === true,
    ]),
  )
  const desarmados = channels.filter((c) => !armed[c.channel])
  const nomeados = channels.map((c) => `${c.name} (${c.channel})`).join(" + ")
  const base = {
    channels,
    armed,
    envVar: NESTED_GUARD_ENV,
    flag: NESTED_GUARD_FLAG,
    exit: NESTED_GUARD_EXIT,
  }

  if (desarmados.length === 0) {
    return {
      ...base,
      state: "armed",
      // "esta invocação não foi marcada por nenhum deles" é FATO, não suposição:
      // se uma das marcas estivesse no ambiente/argv, o guard teria disparado
      // antes de montar relatório nenhum.
      detail: `o guard de recursão está armado nos dois canais (${nomeados}) e esta invocação não foi marcada por nenhum deles`,
      remedies: [],
    }
  }

  return {
    ...base,
    state: "disarmed",
    detail: `o guard de recursão NÃO responde pelo(s) canal(is) ${desarmados
      .map((c) => `${c.name} (${c.channel})`)
      .join(
        " e ",
      )}: a defesa em profundidade do ciclo bring-up → doctor → prova → bring-up está armada PELA METADE`,
    remedies: [
      `scripts/forge-doctor.mjs: isNestedDoctorInvocation tem de responder a ${NESTED_GUARD_ENV} (env) E a ${NESTED_GUARD_FLAG} (argv) — os dois canais existem porque um chamador que NÃO controla o ambiente do filho (wrapper, spawn sem 'env') não tem como setar a env var, e sem a flag esse caminho ficaria sem defesa`,
      `as duas metades têm de sair ${NESTED_GUARD_EXIT} antes de coletar qualquer fato: FORGE_DOCTOR_NESTED=1 node scripts/forge-doctor.mjs e node scripts/forge-doctor.mjs ${NESTED_GUARD_FLAG}`,
    ],
  }
}

/**
 * Um `run:` que é SÓ o marcador de bloco multilinha do YAML (`>`, `>-`, `|`)
 * — o comando vive nas linhas seguintes, que o extrator de linha única não vê.
 * Existe para o DIAGNÓSTICO não imprimir `'>'` como se fosse um comando.
 */
const BLOCK_RUN = /^[>|][-+]?$/

/** Exit code do `runner-image:check` quando a tag NÃO existe (a única falha da forja). */
const IMAGE_MISSING = 4
/** Exit code do `runner-image:check` quando o env está ausente/inválido. */
const IMAGE_ENV_BAD = 2

const C = {
  reset: "\u001b[0m",
  red: "\u001b[0;31m",
  green: "\u001b[0;32m",
  yellow: "\u001b[1;33m",
  cyan: "\u001b[0;36m",
  gray: "\u001b[0;90m",
}
const color = (c, s) => (process.stdout.isTTY ? `${c}${s}${C.reset}` : s)

/** Marcadores de status do relatório — um só vocabulário para todas as seções. */
// Sem espaço à direita: o template sempre põe um depois do marcador.
const MARK = {
  ok: () => color(C.green, "✅"),
  fail: () => color(C.red, "❌"),
  warn: () => color(C.yellow, "⚠️"),
  info: () => color(C.cyan, "▸"),
  skip: () => color(C.gray, "·"),
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. Descoberta (derivada da pipeline, nunca escrita à mão)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fatia UM job da pipeline, pela indentação de 2 espaços sob `jobs:`.
 *
 * POR QUE parser caseiro: o doctor roda com `node` puro, sem node_modules
 * (mesma restrição declarada em check-required-checks.mjs). A fidelidade é
 * garantida pelo teste que compara o resultado com a pipeline REAL.
 *
 * @param {string} content  conteúdo da pipeline
 * @param {string} jobId    id do job (ex.: 'guards')
 * @returns {string|null}   o bloco do job, ou null se ele não existir
 */
export function sliceJob(content, jobId) {
  const lines = content.split(/\r?\n/)
  const start = lines.findIndex((line) => new RegExp(`^  ${jobId}:\\s*$`).test(line))
  if (start === -1) return null

  const body = []
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]
    // Próximo job (mesmo nível) ou fim do bloco `jobs:` (coluna 0).
    // Comentário em coluna 0 NÃO encerra: ele pode estar no meio do job, e o
    // descobridor de gates já ignora comentários por conta própria.
    if (/^ {2}\S/.test(line)) break
    if (/^\S/.test(line) && line.trim() !== "" && !line.startsWith("#")) break
    body.push(line)
  }
  return body.join("\n")
}

/**
 * O comando declara MODO DE VERIFICAÇÃO? É a trava que impede o doctor de
 * executar um script na sua modalidade de EFEITO.
 *
 * POR QUE ISSO PRECISA EXISTIR (defeito real, cometido e depois corrigido): o
 * rótulo que o descobridor devolve para uma invocação direta é só o CAMINHO —
 * `bun scripts/rotate-secrets.mjs --check` vira o rótulo
 * `scripts/rotate-secrets.mjs`, com a flag descartada. Executar o rótulo como
 * comando roda o script SEM `--check`: no caso do rotate-secrets isso significa
 * PREPARAR UMA ROTAÇÃO DE SEGREDOS como efeito de rodar um relatório. O
 * comando tem de vir da LINHA da pipeline (que preserva as flags) e ainda
 * passar por esta trava.
 *
 * As marcas são as MESMAS que o check-forge-parity usa para chamar algo de
 * gate (`--check`/`--ci`, entrada `check:`/`validate:`/`test-mutation:`, script
 * com prefixo check-/validate-/audit-/test-mutation-/run-, `tsc`).
 *
 * @param {string} command
 * @returns {boolean}
 */
export function isVerificationCommand(command) {
  return [
    /--(?:check|ci|dry-run)\b/,
    /\b(?:check|validate|test-mutation):[a-z0-9-]+/,
    /(?:^|\/)(?:check|validate|audit|test-mutation|run)-[a-z0-9-]+\.(?:mjs|cjs|js|sh|bash)\b/,
    /(?:^|\s)tsc(?:\s|$)/,
  ].some((re) => re.test(command))
}

/**
 * Converte um COMANDO (a linha `run:` da pipeline, não o rótulo) no processo a
 * executar.
 *
 * Recusa comando com metacaracteres de shell em vez de "executar mesmo assim":
 * o doctor executa por lista de argumentos, não por shell, e adivinhar a
 * intenção seria pior que falhar alto.
 *
 * @param {string} command
 * @returns {{cmd: string, args: string[]}|{error: string}}
 */
export function gateCommand(command) {
  if (/["'`$|&;<>()\\*?]/.test(command)) {
    return {
      error: `comando de gate com caractere de shell não suportado: '${command}' — o doctor executa por lista de argumentos, não por shell`,
    }
  }
  if (!isVerificationCommand(command)) {
    return {
      error: `comando sem modo de verificação ('--check'/'--ci', entrada check:, ou script check-/validate-/audit-/run-): '${command}' — o doctor NÃO executa um gate na modalidade de efeito`,
    }
  }
  const parts = command.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return { error: `comando de gate vazio` }

  // Invocação direta de script vem sem interpretador (`scripts/x.mjs`) — o
  // comando da pipeline tem `bun scripts/x.mjs`, mas se a linha não for achada
  // o fallback é o caminho cru. Reconstrói pela EXTENSÃO, que é como as
  // pipelines chamam (bun para .mjs/.js, bash para .sh/.bash).
  if (/\.(mjs|cjs|js)$/.test(parts[0])) return { cmd: "bun", args: parts }
  if (/\.(sh|bash)$/.test(parts[0])) return { cmd: "bash", args: parts }

  return { cmd: parts[0], args: parts.slice(1) }
}

/**
 * A linha `run:` que PRODUZIU o rótulo (preserva flags que o rótulo descarta).
 * Só considera linhas executáveis: comentário que menciona o script não é
 * comando (mesma regra dos outros guards do repo).
 *
 * @param {string[]} lines  linhas do job
 * @param {string} label
 * @returns {string|null}
 */
export function gateRunLine(lines, label) {
  const defaults = defaultsRunLines(lines.join("\n"))
  for (let i = 0; i < lines.length; i++) {
    // `defaults.run` é SHELL DEFAULT: aceitar a linha dela como O COMANDO do job
    // deixa o contrato de merge ser satisfeito por uma declaração que não roda.
    if (defaults.has(i + 1)) continue
    const line = lines[i].trim()
    if (line.startsWith("#") || !line.includes(label)) continue
    // `- run: <cmd>` ou `run: <cmd>` — pega o que vem depois do marcador.
    const m = line.match(/^(?:-\s*)?run:\s*(.+)$/)
    if (m) return m[1].trim()
  }
  return null
}

/**
 * Primeira linha `run:` de um job — sem exigir que ela contenha o label.
 * Usado por `readGateContract` para jobs standalone (não composited como
 * `guards`), onde o `run:` é o comando inteiro e não inclui o ID do job.
 *
 * @param {string[]} lines  linhas do bloco do job
 * @returns {string|null}
 */
export function firstRunLine(lines) {
  const defaults = defaultsRunLines(lines.join("\n"))
  for (let i = 0; i < lines.length; i++) {
    if (defaults.has(i + 1)) continue
    const line = lines[i].trim()
    if (line.startsWith("#")) continue
    const m = line.match(/^(?:-\s*)?run:\s*(.+)$/)
    if (m) return m[1].trim()
  }
  return null
}

/**
 * Os gates da bateria da forja, derivados da pipeline dona do merge.
 *
 * O CONJUNTO vem do descobridor do `check-forge-parity` (mesma classificação,
 * uma fonte só), mas o COMANDO vem da linha `run:` que o gerou — porque o
 * rótulo é uma identidade para classificar, não um comando executável (ele
 * descarta as flags; ver `isVerificationCommand`).
 *
 * @param {string} content  conteúdo de `.gitea/workflows/ci.yml`
 * @returns {{gates: {label: string, command: string|null}[], error?: string}}
 */
export function forgeGates(content) {
  const job = sliceJob(content, FORGE_GUARDS_JOB)
  if (job === null) {
    return {
      gates: [],
      error: `job '${FORGE_GUARDS_JOB}' não encontrado em ${MERGE_OWNER_PIPELINE} — a bateria da forja não tem de onde ser derivada`,
    }
  }
  const labels = discoverGates(job)
  if (labels.length === 0) {
    return {
      gates: [],
      error: `job '${FORGE_GUARDS_JOB}' existe mas não declara nenhum gate — a forja não estaria bloqueando nada`,
    }
  }
  const lines = job.split(/\r?\n/)
  return { gates: labels.map((label) => ({ label, command: gateRunLine(lines, label) })) }
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. Execução de um gate
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Roda um gate da bateria e devolve o resultado cru. `code === null` significa
 * que o processo não terminou (timeout/sinal) ou não pôde ser executado — que
 * NÃO é "passou".
 *
 * @param {{label: string, command: string|null}} gate
 * @param {{cwd?: string, timeoutS?: number, run?: Function}} [deps]
 * @returns {{gate: string, code: number|null, seconds: number, error?: string, tail?: string}}
 */
function gateSpawn(gate) {
  if (!gate.command) {
    return {
      error: `não achei a linha 'run:' que executa este gate em ${MERGE_OWNER_PIPELINE} — não executo o rótulo cru (sem as flags ele roda em modo de efeito)`,
    }
  }
  const parsed = gateCommand(gate.command)
  if (parsed.error) return { error: parsed.error }
  return { cmd: parsed.cmd, args: parsed.args }
}

/**
 * O resultado cru de um gate a partir do retorno do spawn (sync OU async). Um
 * lugar só: o caminho síncrono (dublê injetado) e o concorrente têm de produzir
 * o MESMO shape — senão o veredito passaria a depender de qual caminho rodou.
 */
function shapeGateResult(label, res, seconds, timeoutS) {
  if (res.error) {
    // ENOENT (binário ausente) chega aqui — é "não executado", não "falhou".
    return { gate: label, code: null, seconds, error: res.error.message }
  }
  if (res.signal || res.status === null) {
    return {
      gate: label,
      code: null,
      seconds,
      error: `não terminou em ${timeoutS}s (timeout) — trate como NÃO verificado`,
    }
  }
  const out = `${res.stdout ?? ""}\n${res.stderr ?? ""}`.trim()
  return {
    gate: label,
    code: res.status,
    seconds,
    tail: res.status === 0 ? undefined : out.split("\n").slice(-12).join("\n"),
  }
}

/**
 * Roda um gate da bateria de forma SÍNCRONA. `code === null` significa que o
 * processo não terminou (timeout/sinal) ou não pôde ser executado — que NÃO é
 * "passou".
 *
 * É o caminho do `run` INJETADO (dublê dos testes, que é síncrono): a bateria
 * concorrente (`runGatesConcurrent`) só existe em produção, onde não há dublê.
 *
 * @param {{label: string, command: string|null}} gate
 * @param {{cwd?: string, timeoutS?: number, run?: Function}} [deps]
 * @returns {{gate: string, code: number|null, seconds: number, error?: string, tail?: string}}
 */
export function runGate(gate, { cwd = REPO_ROOT, timeoutS = 120, run = spawnSync } = {}) {
  const spawn0 = gateSpawn(gate)
  if (spawn0.error) return { gate: gate.label, code: null, seconds: 0, error: spawn0.error }

  const started = Date.now()
  const res = run(spawn0.cmd, spawn0.args, {
    cwd,
    encoding: "utf8",
    timeout: timeoutS * 1000,
    env: process.env,
  })
  return shapeGateResult(gate.label, res, (Date.now() - started) / 1000, timeoutS)
}

/**
 * `spawn` → a MESMA forma que o `spawnSync` devolve
 * (`status`/`signal`/`stdout`/`stderr`/`error`), para o shape do gate não mudar
 * entre os dois caminhos. Nunca rejeita: um binário ausente chega pelo evento
 * `error`, um timeout pelo `SIGTERM`.
 */
function spawnGate(cmd, args, { cwd, timeoutMs }) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(cmd, args, { cwd, env: process.env, stdio: ["ignore", "pipe", "pipe"] })
    } catch (err) {
      resolve({ error: err })
      return
    }
    let stdout = ""
    let stderr = ""
    let done = false
    let timer = null
    const finish = (res) => {
      if (done) return
      done = true
      if (timer) clearTimeout(timer)
      resolve(res)
    }
    timer = timeoutMs
      ? setTimeout(() => {
          try {
            child.kill("SIGTERM")
          } catch {
            // Já morreu entre o timeout e o kill — o evento close cuida do resto.
          }
        }, timeoutMs)
      : null
    child.stdout?.setEncoding?.("utf8")
    child.stderr?.setEncoding?.("utf8")
    child.stdout?.on("data", (d) => {
      stdout += d
    })
    child.stderr?.on("data", (d) => {
      stderr += d
    })
    child.on("error", (err) => finish({ error: err }))
    child.on("close", (status, signal) => finish({ status, signal, stdout, stderr }))
  })
}

/**
 * O mesmo gate, por spawn ASSÍNCRONO — é o que permite rodar a bateria em
 * paralelo sem bloquear o event loop. Mesmo shape.
 *
 * @param {{label: string, command: string|null}} gate
 * @param {{cwd?: string, timeoutS?: number}} [deps]
 * @returns {Promise<{gate: string, code: number|null, seconds: number, error?: string, tail?: string}>}
 */
export async function runGateAsync(gate, { cwd = REPO_ROOT, timeoutS = 120 } = {}) {
  const spawn0 = gateSpawn(gate)
  if (spawn0.error) return { gate: gate.label, code: null, seconds: 0, error: spawn0.error }
  const started = Date.now()
  const res = await spawnGate(spawn0.cmd, spawn0.args, { cwd, timeoutMs: timeoutS * 1000 })
  return shapeGateResult(gate.label, res, (Date.now() - started) / 1000, timeoutS)
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. O veredito
// ═══════════════════════════════════════════════════════════════════════════

export const VERDICT = {
  READY: "pronta",
  BLOCKED: "bloqueada",
  UNKNOWN: "indeterminada",
}

/**
 * Junta os fatos num veredito.
 *
 * A REGRA, e por que ela não é "tudo verde = pronto": a pergunta é se o merge
 * pode ser CONFIADO à forja. Três coisas quebram isso, em ordens diferentes de
 * gravidade:
 *   - uma invariante FALHA     → o gate que existe vai reprovar PRs bons ou
 *                                aprovar PRs ruins: BLOQUEADA; *   - a imagem do runner não   → nenhum job INICIA (não é um gate vermelho, é a
 *     está no registry            fila inteira parada): BLOQUEADA;
 *   - a PROVA do bloqueio é    → a garantia da imagem é DECORATIVA: a subida da
 *     VIOLADA                     stack leva o runner ao ar sem a tag. BLOQUEADA,
 *                                 e mais grave que a imagem ausente — ali o
 *                                 remédio é publicar a imagem, aqui é consertar
 *                                 a própria subida;
 *   - o GATE do bring-up sai    → a prova continua rodando e o merge deixa de ser
 *     do contrato de merge        bloqueado por ela (o contrato menor deixa a
 *     (ou o job deixa de rodar    proteção em sincronia): o PR passa sem a
 *     a prova)                    prova. BLOQUEADA — é o elo que liga o fato da
 *                                 seção 4 ao que a forja de fato exige;
 *   - algo não deu para        → não é falha, é ausência de prova. Não pode
 *     determinar                  virar "pronta" (seria a falsa segurança que
 *                                 o check-forge-parity foi escrito para matar)
 *                                 nem "bloqueada" (mentiria para o outro lado)
 *                                 → INDETERMINADA.
 * * @param {{contract: object, gateContracts?: {results: object[], violations: string[]}, bringUpGate?: object, guards: object, image: object, proof: object, mirrors: object, openDebt?: object, declaredDebt?: object, shellInheritance?: object, skippedGuards?: boolean, skippedOpenDebt?: boolean, skippedGateContracts?: boolean}} facts
 * @returns {{verdict: string, blockers: string[], unknowns: string[], unproven: string[]}}
 */
export function summarize(facts) {
  const blockers = []
  const unknowns = []

  // O GUARD DE RECURSÃO ARMADO — o fato que diz se a DEFESA existe, e não só se
  // ela disparou. Desarmado em QUALQUER canal BLOQUEIA: pelo canal que deixou de
  // ser respondido, o ciclo (bring-up → doctor → prova → bring-up) volta a
  // recursar até a exaustão de processos, e um veredito "PRONTA" com a defesa
  // pela metade é a falsa segurança que este comando existe para não produzir.
  //
  // Ausente NÃO é verde: um relatório sem o fato não cobre a existência da
  // defesa — e dizer "pronta" sobre o que não foi olhado é exatamente o que
  // este doctor recusa. (Relação montada à mão em teste precisa do fato:
  // mesma disciplina do resto dos fixtures.)
  if (facts.nestedGuard?.state === "disarmed") {
    blockers.push(`o guard de recursao esta DESARMADO — ${facts.nestedGuard.detail}`)
  } else if (facts.nestedGuard && facts.nestedGuard.state !== "armed") {
    unknowns.push(
      `o guard de recursão não foi conferido (state '${facts.nestedGuard.state}'): ${facts.nestedGuard.detail ?? "sem detalhe"}`,
    )
  } else if (!facts.nestedGuard) {
    unknowns.push(
      "o guard de recursão (a defesa em profundidade contra o ciclo bring-up → doctor → prova) não está declarado no relatório: o veredito não cobre se a defesa está armada nem por quais canais ela responde",
    )
  }

  for (const f of facts.contract.failures) blockers.push(f)
  if (facts.contract.unknown) unknowns.push(facts.contract.unknown)

  // OS GATES CORE NO CONTRATO DE MERGE: cada gate classificado como CORE que
  // tem `jobIds` é verificado — o job está no manifesto, o job roda o comando
  // esperado e a branch protection o registra. Violação em qualquer gate
  // bloqueia: o merge passaria sem a verificação exigida.
  //
  // `gateContracts` é a lista genérica (readAllGateContracts);
  // `bringUpGate` é o legado (readBringUpGate, mantido para compatibilidade).
  const gc = facts.gateContracts
  if (gc?.violations?.length > 0) {
    for (const v of gc.violations) blockers.push(`gate CORE nao esta cobrado no merge — ${v}`)
  }
  if (gc?.results) {
    for (const r of gc.results) {
      if (r.state !== "proven" && r.state !== "violated") {
        unknowns.push(
          `gate '${r.jobId}' (invariante '${r.invariantId}') não foi conferido: ${r.detail}`,
        )
      }
    }
  }
  // Compatibilidade: o bringUpGate legado continua sendo verificado.
  const gate = facts.bringUpGate
  if (gate?.state === "violated") {
    for (const v of gate.violations)
      blockers.push(`o GATE do bring-up nao esta cobrado no merge — ${v}`)
  } else if (gate && gate.state !== "proven" && !gc) {
    unknowns.push(`o gate do bring-up (job '${gate.job}') nao foi conferido: ${gate.detail}`)
  }

  if (facts.skippedGuards) {
    // Pular a bateria NÃO pode dar PRONTA: seria dizer "pode confiar o merge"
    // sem ter olhado um gate sequer. É a falsa segurança que este comando
    // existe para não produzir.
    unknowns.push("os guards da forja foram pulados (--no-guards): o veredito não cobre os gates")
  } else {
    for (const g of facts.guards.results) {
      if (g.code === null) unknowns.push(`gate '${g.gate}' não foi verificado: ${g.error}`)
      else if (g.code !== 0) blockers.push(`gate '${g.gate}' FALHOU (exit ${g.code})`)
    }
    if (facts.guards.error) blockers.push(facts.guards.error)
  }

  if (facts.image.code === IMAGE_MISSING) {
    blockers.push(
      "imagem do runner AUSENTE no registry (exit 4): sem ela NENHUM job inicia — nenhum gate chega a rodar, e o PR não é bloqueado por invariante nenhuma",
    )
  } else if (facts.image.code === IMAGE_ENV_BAD) {
    // Ausência do env NÃO é evidência sobre a forja: o arquivo é gitignored e
    // mora no host de deploy. Falta de prova, não prova de falha.
    unknowns.push(
      `imagem do runner não checada: o env não existe neste checkout (exit ${facts.image.code}) — aponte --gitea-env para o env da forja para que o veredito cubra a imagem`,
    )
  } else if (facts.image.code !== 0) {
    unknowns.push(`imagem do runner não confirmada (exit ${facts.image.code})`)
  }
  // A prova do bloqueio: só a VIOLAÇÃO é defeito (a garantia existe no texto e
  // não no comportamento). Não conseguir rodá-la é ausência de prova — nunca
  // "pronta", pelo mesmo motivo de sempre.
  if (facts.proof.status === "violated") {
    blockers.push(
      `a PROVA do bloqueio da imagem FALHOU (${facts.proof.detail}): com a tag ausente o runner SOBE — o pré-requisito da imagem é decorativo`,
    )
  } else if (facts.proof.status === "unavailable") {
    unknowns.push(`prova do bloqueio não executada: ${facts.proof.detail}`)
  }

  // A DÍVIDA ABERTA NO BOARD: uma issue de drift ABERTA é dívida não resolvida.
  // Ela não PROVA que a forja falha em bloquear o merge (quem mede isso são os
  // fatos acima), então não bloqueia — mas também não deixa o veredito PRONTA:
  // é exatamente a informação que vivia só no board, e uma dívida esquecida não
  // pode ser confundida com ausência de dívida.
  if (facts.skippedOpenDebt) {
    unknowns.push(
      "a dívida aberta no board foi pulada (--no-open-debt): o veredito não cobre as issues de drift que os crons JÁ abriram",
    )
  } else {
    for (const u of openDebtUnknowns(facts.openDebt)) unknowns.push(u)
  }

  // A DÍVIDA DECLARADA (a IDADE das isenções): o outro lado do que o repositório
  // já sabe que deve. `invalid` BLOQUEIA (decisão sem registro não tem como
  // envelhecer) e `aged` não deixa PRONTA (a isenção venceu e ninguém revisou) —
  // a cobrança é a issue do publicador, não o veredito.
  if (facts.skippedDeclaredDebt) {
    unknowns.push(
      "a dívida DECLARADA no repositório foi pulada (--no-declared-debt): o veredito não cobre a IDADE das isenções (nem se alguma venceu a janela)",
    )
  } else if (!facts.declaredDebt) {
    // Ausente NÃO é verde — mesma disciplina do fato do guard de recursão: um
    // relatório sem o fato não cobre a idade das isenções, e dizer "pronta" sobre
    // o que não foi olhado é o que este doctor recusa.
    unknowns.push(
      "a dívida DECLARADA (a IDADE das isenções com data e janela) não está declarada no relatório: o veredito não cobre se alguma passou a janela de revisão",
    )
  } else {
    for (const b of declaredDebtBlockers(facts.declaredDebt)) blockers.push(b)
    for (const u of declaredDebtUnknowns(facts.declaredDebt)) unknowns.push(u)
  }

  // A interpolação do compose: variável vazia / valor literal BLOQUEIA (o
  // runner roda uma imagem que não é a declarada). Não conseguir renderizar é
  // ausência de prova — nunca "pronta".
  const compose = facts.compose
  if (compose?.state === "violated") {
    for (const v of compose.violations) blockers.push(v)
  } else if (compose && compose.state !== "proven" && compose.state !== "absent") {
    unknowns.push(`a interpolacao do compose da forja nao foi provada: ${compose.detail}`)
  }

  // O PRÉ-REQUISITO 0 do bring-up, como FATO PRÓPRIO: o `deploy/gitea-up.sh`
  // RECUSA a subida quando o env do host não espelha o template comitado. Ele é
  // DERIVADO da MESMA medição que a seção acima fez (host × template — uma
  // pergunta, uma resposta; sondar de novo seria a segunda verdade), e o que ele
  // acrescenta ao veredito é o NOME do pré-requisito, o COMANDO que o reproduz e
  // o REMÉDIO.
  //
  // Violado BLOQUEIA — e o texto diz que é a CONSEQUÊNCIA da divergência já
  // listada acima, não um segundo problema (as violações em si viajam pela
  // comparação e continuam sendo as linhas de bloqueio do detalhe). Não
  // conseguir comparar NESTE checkout (o env do host é gitignored e mora no host
  // de deploy) é INDETERMINADA, nunca "pronta" por omissão.
  const bringUp = deriveBringUpEnv(compose)
  if (bringUp.state === "violated") {
    blockers.push(
      `por causa da divergencia acima, o PRE-REQUISITO 0 do ${GITEA_BRING_UP} esta violado: a subida da stack RECUSA (o ensure resolveria a imagem do env divergente). Comando: ${bringUp.command} · Remedio: ${ENV_MIRROR_CHECK} --fix`,
    )
  } else if (bringUp.state === "absent" || bringUp.state === "unavailable") {
    unknowns.push(bringUp.detail)
  }

  // O contrato REGISTRADO na forja (o branch protection de verdade): o
  // manifesto é a INTENÇÃO; isto é o que bloqueia o merge. Drift em qualquer
  // forja BLOQUEIA — nos dois sentidos (check exigido que não existe trava todo
  // PR para sempre; check do manifesto que não é exigido deixa o merge passar).
  if (facts.skippedProtection) {
    unknowns.push(
      "a branch protection REGISTRADA na forja foi pulada (--no-protection): o veredito não cobre o que de fato bloqueia o merge",
    )
  } else if (facts.protection?.state === "drift") {
    for (const b of protectionBlockers(facts.protection)) blockers.push(b)
  } else if (facts.protection?.state === "unsupported") {
    // A forja NÃO TEM o recurso: não é "não li", é "não existe portão daquele
    // lado". Vai para o NÃO PROVADO (o veredito não pode afirmar que a forja
    // bloqueia) e NÃO para os bloqueios: uma limitação de plano acenderia o
    // veredito em todo run para sempre, e um veredito que sempre acende não
    // bloqueia nada — a mesma razão pela qual a dívida do board não bloqueia.
    // O que o operador precisa está dito: o merge daquela forja não tem portão.
    const semPortao = (facts.protection.forges ?? [])
      .filter((f) => f.state === "unsupported")
      .map((f) => f.forge)
    unknowns.push(
      `a forja ${semPortao.join(", ")} NÃO SUPORTA branch protection: nenhum required check pode ser aplicado nem lido, e o merge dessa forja não tem portão — ${facts.protection.detail}`,
    )
  } else if (facts.protection && facts.protection.state !== "in-sync") {
    unknowns.push(`a branch protection REGISTRADA nao foi lida: ${facts.protection.detail}`)
  }

  // As referencias em configuracao NAO VERSIONADA: o que o repositorio NAO
  // contem (repository variables, env do host, o que o registry serve). Uma
  // violacao bloqueia; nao conseguir provar nunca vira "pronto".
  // O skip da consulta ao registry é declarado: sem ele, um fato "proven" que
  // pulou a única parte que olha a tag diria "pronta" com a pergunta em aberto.
  if (facts.skippedRegistryProbe) {
    unknowns.push(
      "a consulta ao registry foi pulada (--no-registry-probe): a tag que o repositorio declara nao foi conferida",
    )
  }
  const refs = facts.imageRefs
  if (refs?.state === "violated") {
    for (const v of refs.violations) blockers.push(v)
  } else if (refs && refs.state !== "proven") {
    // `absent` fica FORA do "pendente": e um arquivo gitignored que nao existe
    // neste checkout, nao uma referencia que deixou de ser provada. Listar os
    // dois juntos faria a lista de pendencia parecer maior do que e (e o
    // operador procurar um problema onde nao ha).
    const pending = (refs.items ?? [])
      .filter((i) => i.state === "indeterminate" || i.state === "violated")
      .map((i) => i.source)
      .join(" · ")
    unknowns.push(
      `as referencias NAO VERSIONADAS da imagem nao foram provadas: ${refs.detail}${pending ? ` [${pending}]` : ""}`,
    )
  }

  // O CONTRATO da imagem PUBLICADA: o build promete, o artefato prova. Violação
  // BLOQUEIA — é o job rodando uma imagem que não cumpre a promessa (sem o
  // plugin `compose`, com OUTRA versão do Bun, ou com o Bun fora do PATH) —, e
  // "não consegui rodar" (sem daemon, sem credencial, pull negado) é
  // INDETERMINADA: não poder provar não é acusação nem atestado.
  if (facts.skippedImageContract) {
    unknowns.push(
      "o contrato da imagem PUBLICADA foi pulado (--no-image-contract): o veredito não cobre se o artefato que o job baixa cumpre o contrato do build",
    )
  } else if (facts.imageContract?.state === "violated") {
    blockers.push(
      `o contrato da imagem PUBLICADA FALHOU (${facts.imageContract.detail}) — o job roda uma imagem que NAO cumpre a promessa do build`,
    )
  } else if (facts.imageContract && facts.imageContract.state !== "proven") {
    if (facts.imageContract.state !== "skipped") {
      unknowns.push(
        `o contrato da imagem PUBLICADA nao foi provado (${facts.imageContract.state}): ${facts.imageContract.detail}`,
      )
    }
  }

  // O REGISTRO do act_runner: o que GRAVOU é o que decide a imagem de cada job.
  // Violação BLOQUEIA (a forja roda os jobs numa imagem que não é a revisada, ou
  // não os roda em imagem nenhuma); "não consegui ler" é INDETERMINADA — nunca
  // "o registro está certo".
  if (facts.skippedRunnerLabels) {
    unknowns.push(
      "o registro do runner foi pulado (--no-runner-labels): o veredito não cobre quais labels o act_runner GRAVOU nem os do runner auto-hospedado do GitHub",
    )
  } else {
    if (facts.runnerLabels?.state === "violated") {
      for (const b of runnerLabelBlockers(facts.runnerLabels)) blockers.push(b)
    } else if (facts.runnerLabels && facts.runnerLabels.state !== "proven") {
      unknowns.push(
        `o registro do act_runner nao foi comparado com o compose (${facts.runnerLabels.state}): ${facts.runnerLabels.detail}`,
      )
    }
    // A OUTRA forja: o mesmo registro velho, e no GitHub ele não tem arquivo —
    // quem decide é a API. Mesmos estados, mesmos pesos: violação BLOQUEIA (o
    // runner que existe pega os jobs numa configuração que o repositório não
    // declara, ou não pega job nenhum), e o que não deu para ler é INDETERMINADA
    // (sem token de self-hosted runners o doctor não finge "em sincronia").
    if (facts.githubRunnerLabels?.state === "violated") {
      for (const b of githubRunnerLabelBlockers(facts.githubRunnerLabels)) blockers.push(b)
    } else if (facts.githubRunnerLabels && facts.githubRunnerLabels.state !== "proven") {
      unknowns.push(
        `o registro do runner do GitHub nao foi comparado com ${GITHUB_RUNNER_SCRIPT} (${facts.githubRunnerLabels.state}): ${facts.githubRunnerLabels.detail}`,
      )
    }
  }

  for (const m of facts.mirrors.blockers) blockers.push(m)
  for (const m of facts.mirrors.unknowns) unknowns.push(m)

  // A HERANÇA DE SHELL dos workflows: de ONDE vem o shell de CADA passo.
  //
  // Uma declaração de `defaults:` que LIGA o pipefail BLOQUEIA — ela troca a
  // premissa de todos os passos do escopo numa linha, e o passo que passa a ser
  // a classe SIGPIPE não mudou no diff; a declaração ilegível (forma inline)
  // bloqueia pelo mesmo motivo do gate (fail-closed: presumir "sem pipefail"
  // ali seria uma aposta). Não conseguir ler é AUSÊNCIA DE PROVA, nunca "o
  // repositório não declara shell default nenhum".
  //
  // AUSENTE não é verde — mesma disciplina do guard de recursão e da dívida
  // declarada: um relatório sem o fato não cobre a premissa que decide se um
  // pipeline pode virar 141. E o fato entra por ÚLTIMO de propósito: acrescentar
  // uma linha ao veredito não pode REORDENAR as que já estavam lá (a lista é lida
  // de cima para baixo, e quem diagnostica vai pela primeira que aparece).
  for (const b of shellInheritanceBlockers(facts.shellInheritance)) blockers.push(b)
  for (const u of shellInheritanceUnknowns(facts.shellInheritance)) unknowns.push(u)
  // O CONTRATO LOCAL — UM assunto, UM lugar: os DOIS elos EXECUTADOS (o commit
  // que tem de recusar o corpo quebrado no índice e o push que tem de recusar a
  // árvore vermelha) e os comandos que cada hook RODA saem do MESMO fato, e é o
  // MESMO par de funções que o cobra no perfil completo e no recorte `--ci` (o
  // que muda é o que ele cobra, não onde ele mora). O elo pulado por flag já
  // entra como `skipped` DENTRO do fato: não existe uma segunda lista de flags
  // paralela para o veredito consultar.
  for (const b of localContractBlockers(facts.localContract, {
    ciProfile: Boolean(facts.ciProfile),
  })) {
    blockers.push(b)
  }
  for (const u of localContractUnknowns(facts.localContract)) unknowns.push(u)

  const verdict =
    blockers.length > 0 ? VERDICT.BLOCKED : unknowns.length > 0 ? VERDICT.UNKNOWN : VERDICT.READY

  const unproven = [
    `a PERMISSAO do token sobre a forja: o doctor lê a branch protection com o aplicador (${REQUIRED_CHECKS_APPLIER}) e, sem token de administração, ele diz "não lida" — nunca "em sincronia"`,
    `o historico da forja: se o job '${BRING_UP_GATE_JOB}' PASSOU no ultimo PR — o doctor mede o contrato e o registro, mas nao o resultado da ultima execucao`,
    "o smoke da forja: que o runner usa a imagem com o Bun da variable (tier-1 em runtime) — é um job da própria forja",
    "o deploy/.env.gitea do VPS: o doctor COMPARA o env do host com o template comitado (invariante 7b, e o PRE-REQUISITO 0 do gitea-up.sh) quando o arquivo existe, e diz o estado + o comando (`bun run env-mirror:check`, com `--fix` para reconciliar) — o que ele nao alcanca daqui e o env de um host DIFERENTE deste checkout (`--gitea-env` aponta outro)",
    `o render do compose com o DOCKER DO RUNNER da forja: aqui o render é feito com ESTE docker (${GITEA_COMPOSE}). A imagem do job da forja EMBARCA o plugin \`compose\` — medido: a base catthehacker/ubuntu:act-latest entrega /usr/libexec/docker/cli-plugins/docker-compose, e o build do Dockerfile.ubuntu-bun FALHA se isso mudar — e o smoke exige o render (--require-compose). O que segue fora do alcance daqui é o socket do job: é a Prova 4 do smoke que o exercita, no host.`,
  ]
  if (facts.skippedGuards) unproven.unshift("os guards da forja (pulados por --no-guards)")
  if (facts.skippedGateContracts)
    unproven.unshift("a verificação dos gates CORE no contrato de merge (pulada por --ci)")

  if (facts.skippedRunnerLabels) {
    unproven.unshift(
      "o registro do act_runner e o do runner auto-hospedado do GitHub (pulados por --no-runner-labels)",
    )
  }
  if (facts.skippedImageContract) {
    unproven.unshift("o contrato da imagem PUBLICADA (pulado por --no-image-contract)")
  }
  if (facts.skippedProtection) {
    unproven.unshift("a branch protection REGISTRADA na forja (pulada por --no-protection)")
  }
  // A forja que NÃO TEM o recurso: a lista do "NÃO CUBRE" existe para dizer o
  // que o veredito não está prometendo, e "o merge desta forja é barrado" é a
  // conclusão que ele NÃO pode tirar daqui.
  if (facts.protection?.state === "unsupported") {
    const semPortao = (facts.protection.forges ?? [])
      .filter((f) => f.state === "unsupported")
      .map((f) => f.forge)
    unproven.unshift(
      `o PORTÃO DE MERGE do ${semPortao.join(", ")}: a forja não suporta branch protection (repo privado num plano sem a feature) — nenhum required check pode ser aplicado nem lido, e nada bloqueia o merge daquele lado; a declaração de ci/required-checks-applied.json descreve a INTENÇÃO, e o estado da forja é este`,
    )
  }
  if (facts.skippedOpenDebt) {
    unproven.unshift("a dívida aberta no board (pulada por --no-open-debt)")
  }
  if (facts.skippedDeclaredDebt) {
    unproven.unshift("a IDADE da dívida declarada (pulada por --no-declared-debt)")
  }
  if (facts.skippedProof) {
    unproven.unshift(
      "a PROVA do bloqueio da imagem (pulada — sem ela, o veredito não garante que o runner não sobe sem a tag)",
    )
  }
  // O que o contrato local deixou de fora POR FLAG: o estado `skipped` mora no
  // fato (é lá que o leitor o encontra), e aqui ele só vira a linha de "não foi
  // provado" — a ordem é a mesma de antes.
  for (const [elo, texto] of [
    [
      "pre-commit",
      "a prova do bloqueio LOCAL (pre-commit) — pulada por --no-pre-commit-proof: sem ela, o veredito não garante que um corpo `run:` quebrado no índice não vire commit",
    ],
    [
      "pre-push",
      "a prova do bloqueio do PUSH (pre-push) — pulada por --no-pre-push-proof: sem ela, o veredito não garante que uma árvore VERMELHA não chegue à forja por um push local",
    ],
  ]) {
    if (facts.localContract?.links?.[elo]?.state === "skipped") unproven.unshift(texto)
  }
  // O LIMITE do gate local, quando MEDIDO: não é uma seção pulada nem uma prova
  // que faltou — é o que o repositório sabe e declara sobre a própria barreira.
  // Ele entra aqui porque esta é a lista que o leitor consulta para saber o que
  // o veredito NÃO está prometendo, e "o hook local é uma barreira" é a
  // conclusão que o fato, sem esta linha, deixaria implícita.
  // (no FIM da lista, e com `push`: as seções puladas acima entram por `unshift`
  // e são lidas pela POSIÇÃO — a declaração do limite não é uma delas, e não
  // pode empurrar para baixo o que o leitor já procura no topo.)
  if (facts.localContract?.bypass?.state === "proven") {
    unproven.push(
      `o LIMITE do gate LOCAL: um 'git push --no-verify' não executa o hook — medido, o defeito CHEGA ao remoto e quem o barra é ${ciQueBarraAArvore()} (o comando do gate reprova o conteúdo que chegou). O hook local não é barreira contra quem o desliga`,
    )
  }
  if (facts.ciProfile) {
    // O PERFIL entra como uma linha PRÓPRIA, no TOPO das OITO de skip (cada
    // `unshift` seguinte ficaria acima): quem lê o veredito num PR precisa saber
    // que o recorte foi DELIBERADO (o cron já cobre o resto) e não que oito flags
    // foram esquecidas no YAML.
    unproven.unshift(
      "o PERFIL --ci: o recorte local (sem rede, credencial ou estado do HOST) é o que roda no job `guards` a cada PR — as seções abaixo ficam para o cron semanal",
    )
  }

  return { verdict, blockers, unknowns, unproven }
}

/**
 * O que a dívida aberta ACRESCENTA ao veredito: uma linha por leitura que não
 * aconteceu e uma por assunto com issue aberta.
 *
 * Por que cada assunto tem a PRÓPRIA linha (em vez de uma "há dívida aberta"
 * agregada): o leitor precisa do número da issue e de há quanto tempo ela está
 * aberta para agir — e "dívida há 47 dias" e "dívida de hoje" pedem decisões
 * diferentes.
 *
 * @param {object|undefined} debt
 * @returns {string[]}
 */
export function openDebtUnknowns(debt) {
  const unknowns = []
  if (!debt || debt.state === "skipped") return unknowns
  for (const read of debt.reads ?? []) {
    if (read.state !== "read") unknowns.push(read.detail)
  }
  for (const item of debt.items ?? []) unknowns.push(item.detail)
  return unknowns
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. Coleta dos fatos
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Lê o contrato de merge: cada forja do manifesto, com workflow existente e a
 * contagem de jobs obrigatórios.
 */
export function readContract(cwd = REPO_ROOT) {
  const path = join(cwd, REQUIRED_CHECKS_MANIFEST)
  if (!existsSync(path)) {
    return { forges: [], failures: [`${REQUIRED_CHECKS_MANIFEST}: ausente`], unknown: null }
  }
  let manifest
  try {
    manifest = JSON.parse(readFileSync(path, "utf8"))
  } catch (err) {
    return {
      forges: [],
      failures: [`${REQUIRED_CHECKS_MANIFEST}: JSON inválido (${err.message})`],
      unknown: null,
    }
  }

  const failures = []
  const forges = []
  for (const [forge, cfg] of Object.entries(manifest.forges ?? {})) {
    const jobs = cfg.jobs ?? []
    const exists = existsSync(join(cwd, cfg.workflow))
    if (!exists) failures.push(`${forge}: workflow obrigatório ausente (${cfg.workflow})`)
    if (jobs.length === 0) failures.push(`${forge}: nenhum job obrigatório no manifesto`)
    // `jobs` continua sendo a CONTAGEM (o relatório da seção 1 a mostra) e
    // `jobIds` são os IDS — o fato do gate do bring-up pergunta *quais* são, e
    // uma segunda leitura do manifesto para a mesma pergunta seria a segunda
    // verdade sobre o mesmo arquivo.
    forges.push({ forge, workflow: cfg.workflow, jobs: jobs.length, jobIds: [...jobs], exists })
  }
  if (forges.length === 0) failures.push(`${REQUIRED_CHECKS_MANIFEST}: nenhuma forja declarada`)
  return { forges, failures, unknown: null }
}

/**
 * O GATE do bring-up no CONTRATO DE MERGE, como fato próprio.
 *
 * POR QUE ESTE FATO EXISTE (o buraco entre "a prova roda" e "o merge é
 * bloqueado por ela"): a seção 4 mede se a subida da stack REALMENTE exige a
 * imagem, e o job `bring-up-proof` roda essa prova nas duas pipelines. Mas o
 * doctor não cobria o elo que faz dela um GATE: o job estar no **contrato de
 * merge**. Os guardas existentes têm, cada um, uma metade:
 *
 *   - `check:required-checks` valida o manifesto CONTRA os workflows (o job
 *     existe, não é condicional, não duplica contexto) — ele nunca exige que
 *     um job específico ESTEJA no manifesto. Tirar `bring-up-proof` de lá deixa
 *     o manifesto válido, a proteção em sincronia com um contrato MENOR e a
 *     prova verde na pipeline: o PR passaria sem passar por ela, e o doctor
 *     diria PRONTA;
 *   - `check:forge-parity` garante que a invariante do CORE roda nas DUAS
 *     pipelines (por descoberta do comando) — mas ele não sabe se o CONTRATO de
 *     merge exige o job, nem se quem carrega a prova é o job exigido.
 *
 * O outro lado do mesmo buraco é o gate DECORATIVO: o job exigido cujo `run:`
 * deixou de executar a prova — o check fica verde no merge e nada foi medido.
 *
 * O QUE ELE AGORA RESPONDE (e o `unproven` não precisa mais dizer): se a
 * forja REGISTRA o check na branch protection. Quando `protection` é passado
 * (o mesmo que a seção 1 já leu), o fato cruza o gate com a proteção:
 * `proven` exige que o contrato exija O GATE O GATE E QUE A FORJA O REGISTRE;
 * `violated` quando a branch protection está em drift e o contexto do gate
 * está entre os que faltam; `unavailable` quando a proteção não foi lida.
 *
 * @param {{cwd?: string, contract?: object, protection?: object}} [args]
 * @returns {{state: "proven"|"violated"|"unavailable", job: string, script: string,
 *   detail: string, forges: {forge: string, workflow: string, command: string|null, detail: string, registered: boolean|null}[],
 *   violations: string[], remedies: string[]}}
 */
export function readBringUpGate({
  cwd = REPO_ROOT,
  contract = readContract(cwd),
  protection = null,
} = {}) {
  const base = {
    job: BRING_UP_GATE_JOB,
    script: PROOF_SCRIPT,
    forges: [],
    violations: [],
    // O REMÉDIO fecha os dois modos de falha do fato: o gate fora do contrato
    // (o manifesto é a fonte e o aplicador é quem escreve na forja) e o gate
    // decorativo (a linha `run:` é o que faz o job medir algo).
    remedies: [
      `ci/required-checks.json: devolva '${BRING_UP_GATE_JOB}' a lista de jobs da forja — sem o job exigido, o PR passa sem a prova (aplique com: bun run ci:required-checks -- --apply)`,
      `a linha 'run:' do job '${BRING_UP_GATE_JOB}' tem de executar ${PROOF_SCRIPT} — um check verde que nao roda a prova nao bloqueia nada`,
    ],
  }
  const declared = contract?.forges ?? []
  if (declared.length === 0) {
    return {
      ...base,
      state: "unavailable",
      detail: `o GATE do bring-up nao foi conferido: ${REQUIRED_CHECKS_MANIFEST} nao declara forja nenhuma (${(contract?.failures ?? []).join(" · ") || "manifesto ilegivel"}) — sem o contrato de merge nao ha gate a exigir`,
    }
  }

  const entries = []
  const violations = []
  let unread = null
  for (const f of declared) {
    if (!(f.jobIds ?? []).includes(BRING_UP_GATE_JOB)) {
      const detail = `${f.forge}: o contrato de merge NAO exige o job '${BRING_UP_GATE_JOB}' — a prova roda na pipeline e no doctor, mas nenhum PR e obrigado a passa-la antes do merge`
      violations.push(detail)
      entries.push({ forge: f.forge, workflow: f.workflow, command: null, detail })
      continue
    }
    const path = join(cwd, f.workflow)
    if (!existsSync(path)) {
      unread = `${f.forge}: ${f.workflow} ausente deste checkout — nao da para ler o que o job exigido RODA`
      entries.push({ forge: f.forge, workflow: f.workflow, command: null, detail: unread })
      continue
    }
    const job = sliceJob(readFileSync(path, "utf8"), BRING_UP_GATE_JOB)
    if (job === null) {
      const detail = `${f.forge}: o contrato exige '${BRING_UP_GATE_JOB}', mas o job nao existe em ${f.workflow} — o check exigido nunca roda (quem cobra existencia e condicionalidade e o check:required-checks)`
      violations.push(detail)
      entries.push({ forge: f.forge, workflow: f.workflow, command: null, detail })
      continue
    }
    // O comando vem da LINHA `run:` (não do rótulo): é o que o job de fato roda.
    const command = gateRunLine(job.split(/\r?\n/), PROOF_SCRIPT)
    if (command === null) {
      const detail = `${f.forge}: o job '${BRING_UP_GATE_JOB}' existe em ${f.workflow} e nenhum 'run:' executa ${PROOF_SCRIPT} — o check fica verde sem medir a prova (gate decorativo: o merge deixa de ser bloqueado por ela)`
      violations.push(detail)
      entries.push({ forge: f.forge, workflow: f.workflow, command: null, detail })
      continue
    }
    entries.push({
      forge: f.forge,
      workflow: f.workflow,
      command,
      detail: `${f.forge}: '${BRING_UP_GATE_JOB}' em ${f.workflow} roda '${command}'`,
      // O campo `registered` é preenchido DEPOIS que as entradas estão prontas
      // (abaixo, após o loop) — aqui fica null como placeholder.
      registered: null,
    })
  }

  if (violations.length > 0) {
    return {
      ...base,
      state: "violated",
      forges: entries,
      violations,
      // A forja que NAO deu para ler entra na mesma frase: uma violacao provada
      // nao pode esconder a ausencia de prova das outras. Sem isso, uma forja
      // ilegivel sairia como "cobre as duas" num relatorio que leu uma so.
      detail: `${violations.join(" · ")}${unread ? ` | NAO lido: ${unread}` : ""}`,
    }
  }
  if (unread !== null) {
    return { ...base, state: "unavailable", forges: entries, detail: unread }
  }

  // ── CRUZAMENTO COM A BRANCH PROTECTION ──────────────────────────────────
  // Agora que o manifesto e as pipelines estão OK (sem violações), o fato cruza
  // com a branch protection REGISTRADA na forja: o gate pode estar no manifesto
  // e o job pode rodar a prova, mas se a branch protection NÃO exige o check,
  // o merge passa sem passar pela prova. É o mesmo modo de falha do gate
  // decorativo — só que do outro lado (a proteção não cobre o manifesto).
  //
  // A fonte da verdade é `protection.forges[].missing[]` — a lista de checks que
  // o manifesto exige mas a branch protection NÃO registrou. Se o contexto
  // resolvido do `bring-up-proof` está nessa lista, a violação é nomeada.
  // Proteção em sincronia → todos os checks exigidos estão registrados → o
  // gate também. Proteção indisponível → não dá para provar → `unavailable`.
  //
  // Quando `protection` é null (doctor sem --protection, ou teste unitário),
  // o cruzamento NÃO acontece — o estado é proven pela manifest/pipeline.
  if (protection && protection.state !== "skipped" && protection.forges) {
    const missingByForge = new Map()
    for (const pf of protection.forges) {
      missingByForge.set(pf.forge, pf.missing)
    }

    const protectionViolations = []
    for (const e of entries) {
      const missing = missingByForge.get(e.forge)
      if (missing === undefined) {
        // Proteção não reportada para esta forja → registered é null.
        e.registered = null
      } else if (missing === null) {
        // Proteção indisponível (missing=null = não lido) → não pode provar.
        e.registered = null
      } else if (missing.length === 0) {
        // Proteção em sincronia (missing=[] = tudo registrado) → o gate está registrado.
        e.registered = true
      } else {
        // Proteção em drift: verificar se o contexto do gate está entre os que faltam.
        const isMissing = missing.some(
          (m) => m === BRING_UP_GATE_JOB || m.toLowerCase().includes("bring-up-proof"),
        )
        e.registered = !isMissing
        if (isMissing) {
          protectionViolations.push(
            `${e.forge}: o gate '${BRING_UP_GATE_JOB}' esta no contrato de merge mas a branch protection NAO o registra — o merge passa sem a prova (missing: ${missing.map((c) => `'${c}'`).join(", ")})`,
          )
        }
      }
    }

    // Se a proteção não foi lida para NENHUMA forja → unavailable.
    if (entries.length > 0 && entries.every((e) => e.registered === null)) {
      return {
        ...base,
        state: "unavailable",
        forges: entries,
        detail: `o gate esta no contrato e o job roda a prova, mas a branch protection REGISTRADA nao foi lida — o fato nao pode confirmar que a forja exige o check (proteção: ${protection.detail})`,
      }
    }

    if (protectionViolations.length > 0) {
      return {
        ...base,
        state: "violated",
        forges: entries,
        violations: protectionViolations,
        remedies: [
          ...base.remedies,
          `bun run ci:required-checks -- --apply: aplique o manifesto na branch protection para que a forja exija o gate de merge`,
        ],
        detail: protectionViolations.join(" · "),
      }
    }

    return {
      ...base,
      state: "proven",
      forges: entries,
      detail: `o gate do bring-up esta no contrato de merge das ${entries.length} forja(s) E o job roda a prova E a branch protection o registra — ${entries.map((e) => e.detail).join(" · ")}`,
    }
  }

  return {
    ...base,
    state: "proven",
    forges: entries,
    detail: `o gate do bring-up esta no contrato de merge das ${entries.length} forja(s) E o job roda a prova — ${entries.map((e) => e.detail).join(" · ")}`,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 1b. Verificador genérico de gates CORE no contrato de merge
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Contrato de UM gate CORE no contrato de merge: manifesto + pipeline +
 * branch protection. Generaliza `readBringUpGate` para qualquer gate que
 * tenha `jobIds` no `CORE_INVARIANTS`.
 *
 * Para cada forja declarada no manifesto, o verificador:
 *   1. confere que o job está no manifesto (a lista de jobs obrigatórios);
 *   2. confere que o job tem um `run:` que executa o comando esperado;
 *   3. cruza com a branch protection registrada (o check está exigido?).
 *
 * O `expectedCommand` é um regex ANCORADO nas duas pontas e testado contra a
 * linha `run:` do job — não contra o rótulo do gate (que descarta flags). Isso
 * impede que um gate decorativo (job existe mas roda outra coisa) passe em
 * silêncio — e pega a divergência mais sutil: o MESMO script invocado com
 * argumentos diferentes (`node scripts/x.mjs` de um lado, com `--pkg-internal`
 * do outro), que é o que fazia o merge de uma forja e o da outra medirem coisas
 * diferentes com o mesmo nome de invariante.
 *
 * A RÉGUA É UMA SÓ, e é a da invariante — não da forja. Uma tabela de
 * sobrescrita por forja (`matchesByForge`) existiu aqui para acomodar o dia em
 * que o job `lint-guard` do GitHub rodava prettier + `eslint . --max-warnings 0`
 * INLINE enquanto a Gitea rodava `bun run lint` (= `eslint .`, sem o teto de
 * warnings e sem prettier). Ela descrevia a assimetria com precisão e, ao
 * fazê-lo, a transformava em contrato: o mesmo commit passava no merge de uma
 * forja e era rejeitado na outra, e quem liberava o merge era o lado mais
 * fraco. Hoje o comando compartilhado vive no script `lint` do package.json e
 * as duas forjas rodam o MESMO `bun run lint`; se um dia uma forja precisar de
 * outra coisa, o conserto é mudar o comando COMPARTILHADO — declarar uma
 * segunda régua é reabrir o furo.
 *
 * @param {{jobId: string, expectedCommand: RegExp, invariantId: string,
 *   cwd?: string, contract?: object, protection?: object}} args
 * @returns {GateContractResult}
 */
/**
 * O SCRIPT que o comando canônico de uma invariante executa — o campo `script`
 * do contrato de gate.
 *
 * O campo existia com o VALOR ERRADO: o `base` do contrato copiava
 * `PROOF_SCRIPT` (o do bring-up), então TODO gate CORE publicava no `--json` o
 * mesmo script — e quem consumisse o relatório leria "o script do gate é
 * prove-runner-image-gate.mjs" para uma régua de lint. Derivar do COMANDO é o
 * único jeito de o campo dizer a verdade sem uma segunda lista para manter.
 *
 * A fonte é um REGEX (o `command` da invariante), então as escapes saem antes:
 * `scripts\/x\.mjs` é o mesmo caminho que `scripts/x.mjs`.
 *
 * @param {RegExp|undefined} expectedCommand
 * @returns {string|null}
 */
export function scriptOfCommand(expectedCommand) {
  const fonte = (expectedCommand?.source ?? "")
    .replace(/\\(.)/g, "$1")
    // As ÂNCORAS saem primeiro: elas são a régua do texto (`^`/`$` do regex),
    // não parte do comando — mantê-las faria nenhuma linha casar.
    .replace(/^\^/, "")
    .replace(/\$$/, "")
  const m = /^(?:node|bun|bunx)\s+(?:run\s+)?([^\s$]+)/.exec(fonte)
  return m ? m[1] : null
}

export function readGateContract({
  jobId,
  expectedCommand,
  invariantId,
  cwd = REPO_ROOT,
  contract = readContract(cwd),
  protection = null,
}) {
  const base = {
    jobId,
    invariantId,
    script: scriptOfCommand(expectedCommand),
    forges: [],
    violations: [],
    remedies: [
      `ci/required-checks.json: devolva '${jobId}' à lista de jobs da forja — sem o job exigido, o PR passa sem a verificação (aplique com: bun run ci:required-checks -- --apply)`,
      `a linha 'run:' do job '${jobId}' tem de executar um comando que casa com ${expectedCommand} — um check verde que não executa a verificação não bloqueia nada`,
    ],
  }

  const declared = contract?.forges ?? []
  if (declared.length === 0) {
    return {
      ...base,
      state: "unavailable",
      detail: `o gate '${jobId}' não foi conferido: ${REQUIRED_CHECKS_MANIFEST} não declara forja nenhuma`,
    }
  }

  const entries = []
  const violations = []
  let unread = null
  for (const f of declared) {
    if (!(f.jobIds ?? []).includes(jobId)) {
      const detail = `${f.forge}: o contrato de merge NÃO exige o job '${jobId}' — a verificação roda na pipeline mas nenhum PR é obrigado a passa-la antes do merge`
      violations.push(detail)
      entries.push({
        forge: f.forge,
        workflow: f.workflow,
        command: null,
        registered: null,
        detail,
      })
      continue
    }
    // A régua é a da INVARIANTE, a mesma para toda forja que declara o job.
    const expected = expectedCommand
    const path = join(cwd, f.workflow)
    if (!existsSync(path)) {
      unread = `${f.forge}: ${f.workflow} ausente deste checkout — não dá para ler o que o job '${jobId}' RODA`
      entries.push({
        forge: f.forge,
        workflow: f.workflow,
        command: null,
        registered: null,
        detail: unread,
      })
      continue
    }
    const job = sliceJob(readFileSync(path, "utf8"), jobId)
    if (job === null) {
      const detail = `${f.forge}: o contrato exige '${jobId}', mas o job não existe em ${f.workflow} — o check exigido nunca roda`
      violations.push(detail)
      entries.push({
        forge: f.forge,
        workflow: f.workflow,
        command: null,
        registered: null,
        detail,
      })
      continue
    }
    // Para jobs STANDALONE (typecheck, lint, etc.), o `run:` é o comando
    // inteiro. Para jobs COMPOSTOS (guards), há MÚLTIPLOS `run:` — o primeiro
    // pode ser um setup script. Procuramos TODOS os `run:` e verificamos se
    // ALGUM casa com o padrão esperado.
    const jobLines = job.split(/\r?\n/)
    const allRunLines = []
    // A declaração `defaults.run` do job NÃO é um comando do job: sem excluí-la,
    // `defaults: {run: bun run check:x}` faria o doctor afirmar que o job RODA o
    // comando esperado — o veredito de prontidão para bloquear o merge sairia de
    // uma linha que nenhuma pipeline executa.
    const jobDefaults = defaultsRunLines(job)
    for (let i = 0; i < jobLines.length; i++) {
      if (jobDefaults.has(i + 1)) continue
      const line = jobLines[i].trim()
      if (line.startsWith("#")) continue
      const m = line.match(/^(?:-\s*)?run:\s*(.+)$/)
      if (m) allRunLines.push(m[1].trim())
    }
    // A PERGUNTA É "o job RODA o comando esperado?" — então a busca pelo
    // comando vem ANTES de qualquer palpite por rótulo. `gateRunLine` casa
    // pelo NOME do passo, e o nome é escrito por quem escreve o workflow: no
    // job `check` do GitHub existe o passo "Guard: no @ts-nocheck", cujo
    // rótulo contém "check" — pelo rótulo, o gate `tests` era acusado de
    // rodar `bun run check:ts-nocheck` mesmo com `bun run test:unit` no
    // mesmo job. Um palpite virando VIOLAÇÃO é pior que não ter o teste.
    let command = allRunLines.find((runCmd) => expected.test(runCmd)) ?? null
    // Só quando NENHUM `run:` casa: aí o rótulo serve para DIAGNOSTICAR
    // (nomear a linha que o gate realmente executa na violação).
    if (command === null) {
      command = gateRunLine(jobLines, jobId)
    }
    // Último recurso: usa o primeiro `run:` (para jobs standalone).
    if (command === null && allRunLines.length > 0) {
      command = allRunLines[0]
    }
    if (command === null) {
      const detail = `${f.forge}: o job '${jobId}' existe em ${f.workflow} mas nenhum 'run:' foi encontrado — o check fica verde sem medir nada (gate decorativo)`
      violations.push(detail)
      entries.push({
        forge: f.forge,
        workflow: f.workflow,
        command: null,
        registered: null,
        detail,
      })
      continue
    }
    if (!expected.test(command)) {
      // Aqui NENHUM `run:` do job casa a régua (o `find` acima já testou todas):
      // `command` é o palpite do rótulo, ou a primeira linha, e nomear UMA
      // delas é apontar para um lugar que pode não ter nada a ver com o gate —
      // no job `lint-guard` era o passo de setup do Bun, que nunca foi o gate.
      // A violação lista TODOS os `run:` do job: quem lê vê o comando de
      // verdade sem abrir o YAML, e não sai procurando o problema no setup.
      const rodam =
        allRunLines.length > 0
          ? `NENHUM dos ${allRunLines.length} 'run:' do job casa com ${expected} — o job roda: ${allRunLines
              .map((c) => (BLOCK_RUN.test(c) ? "<bloco multilinha>" : `'${c}'`))
              .join(" · ")}`
          : `não tem nenhum 'run:' que case com ${expected}`
      const detail = `${f.forge}: o job '${jobId}' em ${f.workflow}: ${rodam} — o gate pode ter sido trocado por outro`
      violations.push(detail)
      entries.push({ forge: f.forge, workflow: f.workflow, command, registered: null, detail })
      continue
    }
    entries.push({
      forge: f.forge,
      workflow: f.workflow,
      command,
      registered: null,
      detail: `${f.forge}: '${jobId}' em ${f.workflow} executa '${command}'`,
    })
  }

  if (violations.length > 0) {
    return {
      ...base,
      state: "violated",
      forges: entries,
      violations,
      detail: `${violations.join(" · ")}${unread ? ` | NÃO lido: ${unread}` : ""}`,
    }
  }
  if (unread !== null) {
    return { ...base, state: "unavailable", forges: entries, detail: unread }
  }

  // ── CRUZAMENTO COM A BRANCH PROTECTION ──────────────────────────────────
  // O gate está no manifesto e o job roda o comando esperado; agora confere
  // se a branch protection da forja REGISTRA o check. O `missing` do applier
  // lista os checks que o manifesto exige mas a proteção NÃO registrou.
  if (protection && protection.state !== "skipped" && protection.forges) {
    const missingByForge = new Map()
    for (const pf of protection.forges) {
      // `?? []` aqui DESFAZIA o `null` que significa "não li": ele virava lista
      // vazia, a lista vazia vira "tudo registrado", e o veredito publicava os
      // gates CORE como "provado(s) — a branch protection o registra" com as
      // DUAS forjas sem proteção lida. MEDIDO antes do conserto: 50 contratos
      // "provado(s)", 0 "não conferido(s)", com o aviso de "não foi lida"
      // impresso na linha de cima. `null` passa a atravessar intacto.
      missingByForge.set(pf.forge, pf.missing ?? null)
    }
    const protectionViolations = []
    for (const e of entries) {
      const missing = missingByForge.get(e.forge)
      if (missing === undefined || missing === null) {
        e.registered = null
      } else if (missing.length === 0) {
        e.registered = true
      } else {
        const isMissing = missing.some(
          (m) => m === jobId || m.toLowerCase().includes(jobId.toLowerCase()),
        )
        e.registered = !isMissing
        if (isMissing) {
          protectionViolations.push(
            `${e.forge}: o gate '${jobId}' está no contrato mas a branch protection NÃO o registra — o merge passa sem a verificação (missing: ${missing.map((c) => `'${c}'`).join(", ")})`,
          )
        }
      }
    }
    // BASTA UMA forja NÃO LIDA para o contrato NÃO PODER sair `proven`: o
    // contrato cobre as forjas que DECLARAM o job, e o veredito dele afirma que
    // "a branch protection o registra" em todas. Com metade lida e metade não, a
    // afirmação seria sobre a outra metade também — e era isso que acontecia
    // (só o caso em que TODAS eram nulas caía aqui; uma lida e a outra não dava
    // `proven`).
    const naoLidas = entries.filter((e) => e.registered === null).map((e) => e.forge)
    if (naoLidas.length > 0) {
      // DUAS razões diferentes para o mesmo `null`, e a frase tem de dizer QUAL:
      // "não li" (falta canal — resolve com credencial) e "a forja não TEM o
      // recurso" (não há portão para conferir — nenhum token resolve).
      const semPortao = (protection.forges ?? [])
        .filter((f) => f.state === "unsupported")
        .map((f) => f.forge)
      return {
        ...base,
        state: "unavailable",
        forges: entries,
        detail:
          semPortao.length > 0
            ? `o gate '${jobId}' está no contrato e o job roda o comando, mas a forja ${semPortao.join(", ")} NÃO SUPORTA branch protection — não há registro a conferir, e o merge daquele lado não tem portão`
            : `o gate '${jobId}' está no contrato e o job roda o comando, mas a branch protection de ${naoLidas.join(", ")} não foi lida — o registro não pode ser confirmado`,
      }
    }
    if (protectionViolations.length > 0) {
      return {
        ...base,
        state: "violated",
        forges: entries,
        violations: protectionViolations,
        remedies: [
          ...base.remedies,
          `bun run ci:required-checks -- --apply: aplique o manifesto na branch protection`,
        ],
        detail: protectionViolations.join(" · "),
      }
    }
    return {
      ...base,
      state: "proven",
      forges: entries,
      detail: `o gate '${jobId}' está no contrato das ${entries.length} forja(s) e o job roda o comando e a branch protection o registra`,
    }
  }

  return {
    ...base,
    state: "proven",
    forges: entries,
    detail: `o gate '${jobId}' está no contrato das ${entries.length} forja(s) e o job roda o comando esperado`,
  }
}

/**
 * A lista CENTRAL dos contratos de gates CORE: cada invariante que tem
 * `jobIds` vira um contrato verificável. A lista é DERIVADA dos
 * `CORE_INVARIANTS` (uma fonte só) — adicionar uma invariante com `jobIds`
 * a essa lista a torna automaticamente verificável no veredito do doctor.
 *
 * `expectedCommand` é o `command` de cada invariante — a régua CANÔNICA, uma só
 * por gate —, NÃO o `matches`, que responde "o gate está classificado?" e é
 * deliberadamente frouxo.
 *
 * @returns {{invariantId: string, jobId: string, forge: string,
 *   expectedCommand: RegExp}[]}
 */
export function coreGateContracts() {
  const contracts = []
  // A chave é (invariante × job) — NÃO só o job. SEIS invariantes (ts-nocheck,
  // required-checks, registry-source, runner-base, forge-parity,
  // forge-workflow-scope) compartilham o job `guards` da Gitea: deduplicando
  // pelo job, cinco delas ficavam fora da lista de contratos e cinco regras
  // CORE apareciam como "cobertas" sem nunca terem sido medidas. Cada
  // invariante tem a SUA régua e tem de ser conferida.
  const seen = new Set()
  for (const inv of CORE_INVARIANTS) {
    if (!inv.jobIds) continue
    // Cada invariante pode ter VÁRIOS jobIds (um por forja). Cada par único
    // (invariante, jobId) vira um contrato — se a Gitea tem `lint` e o GitHub
    // tem `lint-guard`, são dois contratos distintos da MESMA invariante.
    for (const [forge, jid] of Object.entries(inv.jobIds)) {
      const key = `${inv.id}|${jid}`
      if (seen.has(key)) continue
      seen.add(key)
      contracts.push({
        invariantId: inv.id,
        jobId: jid,
        forge,
        // A régua do JOB: o `command` da invariante (o COMANDO CANÔNICO, com
        // argumentos, ancorado nas duas pontas), o MESMO para toda forja que
        // declara aquele jobId. É o que impede o merge de ser liberado por uma
        // régua mais fraca de um dos lados E o que pega a invocação indireta ou
        // com argumentos diferentes (`node scripts/x.mjs` sem a flag que o
        // canônico carrega) — o `matches` da invariante é a IDENTIDADE do gate,
        // deliberadamente frouxo, e não serve como régua de job.
        expectedCommand: inv.command,
      })
    }
  }
  return contracts
}

/**
 * Verifica TODOS os gates CORE que estão no manifesto de uma vez: lê o
 * manifesto UMA vez, cruza com a proteção UMA vez, e chama `readGateContract`
 * para cada job do manifesto que casa com uma invariante CORE.
 *
 * A pergunta é: "o que o manifesto EXIGE é CORE e está correto?" — não
 * "o que é CORE está no manifesto?" (a segunda pergunta é do check:forge-parity).
 *
 * @param {{cwd?: string, contract?: object, protection?: object}} args
 * @returns {{results: GateContractResult[], allProven: boolean, violations: string[]}}
 */
export function readAllGateContracts({
  cwd = REPO_ROOT,
  contract = readContract(cwd),
  protection = null,
} = {}) {
  const allContracts = coreGateContracts()
  const declared = contract?.forges ?? []
  const results = []
  const allViolations = []

  // Itera os CONTRATOS (invariante × jobId) — não os jobs do manifesto, e sem
  // deduplicar por jobId. As duas coisas juntas eram um furo silencioso: SEIS
  // invariantes (ts-nocheck, required-checks, registry-source, runner-base,
  // forge-parity, forge-workflow-scope) compartilham o job `guards` da Gitea, e
  // o dedup por jobId conferia a régua da PRIMEIRA delas e descartava as outras
  // cinco — cinco invariantes CORE "cobertas" pelo fato sem nunca terem sido
  // olhadas. Cada invariante declara a sua régua; cada uma tem de ser medida.
  //
  // Um contrato cujo job o manifesto NÃO exige é PULADO aqui (é o
  // check:forge-parity que compara o que o CORE pede com o que existe em cada
  // pipeline). A pergunta deste fato é: "o que o manifesto EXIGE é CORE e roda
  // o comando certo?"
  for (const c of allContracts) {
    // O contrato é RECORTADO para as forjas que DECLARAM o job. Uma invariante
    // que só existe numa forja (por desenho — as isenções GitHub-only com razão
    // escrita) declarava o outro lado como violação: "a forja X NÃO exige o job
    // 'lint'", quando 'lint' é o job da Gitea e o manifesto do GitHub
    // corretamente não o exige.
    const declaring = declared.filter((df) => (df.jobIds ?? []).includes(c.jobId))
    if (declaring.length === 0) continue
    const r = readGateContract({
      jobId: c.jobId,
      expectedCommand: c.expectedCommand,
      invariantId: c.invariantId,
      cwd,
      contract: { ...contract, forges: declaring },
      protection,
    })
    results.push(r)
    if (r.state === "violated") allViolations.push(...r.violations)
  }

  return {
    results,
    allProven: results.every((r) => r.state === "proven"),
    violations: allViolations,
  }
}

/**
 * O OUTRO LADO do contrato de merge: o que a FORJA REGISTRA.
 *
 * POR QUE ESTE FATO EXISTE: a seção 1 prova que o manifesto é válido e aponta
 * para jobs que existem; ela NÃO prova que a forja exige aqueles checks. Quem
 * bloqueia o merge é a branch protection — estado da forja, invisível em review
 * —, e o modo de falha é o pior: o `name:` de um job renomeado muda o CONTEXTO
 * de status, o manifesto passa a exigir um check que nunca roda e o PR trava
 * PARA SEMPRE. Nenhum teste de PR enxerga isso: no PR o job novo existe e passa.
 *
 * DE ONDE VEM A VERDADE: de `scripts/apply-required-checks.mjs --check --json`,
 * o MESMO comando que o cron de drift usa nos dois lados
 * (`required-checks-drift.yml`). Nada de uma segunda comparação aqui: o
 * aplicador é o dono da regra (contextos resolvidos do manifesto, credencial por
 * forja, drift por branch) e devolve o relatório em JSON. Um segundo comparador
 * divergiria do primeiro justamente no dia do drift — o defeito que este
 * repositório persegue.
 *
 * O QUE O TOKEN PRECISA: permissão de ADMINISTRAÇÃO no repo (PAT clássico com
 * scope `repo`, ou fine-grained com 'Administration: read'). O `GITHUB_TOKEN`
 * padrão NÃO tem esse escopo — e por isso "não consegui ler" é estado PRÓPRIO
 * (`unavailable`), nunca "em sincronia". O cron semanal pula com um `::notice::`;
 * aqui não ler significa NÃO PROVADO.
 *
 * QUANDO A FORJA NÃO TEM O RECURSO, o estado é `unsupported` — e não
 * `unavailable`: `unavailable` é "não consegui ler" (falta canal), que se resolve
 * com credencial; `unsupported` é a forja RECUSANDO a feature (repo privado num
 * plano sem branch protection), que nenhum token resolve — e cujo efeito é o
 * merge daquele lado não ter portão nenhum. As duas pedem ações diferentes, e
 * por isso são estados diferentes.
 *
 * @param {{cwd?: string, forges?: string[], run?: Function, nodePath?: string}} [args]
 * @returns {{state: "in-sync"|"drift"|"unsupported"|"unavailable", detail: string, forges: object[]}}
 */
export function readProtection({
  cwd = REPO_ROOT,
  forges = [],
  run = spawnSync,
  nodePath = process.execPath,
} = {}) {
  const reads = forges.map((forge) => readForgeProtection({ cwd, forge, run, nodePath }))
  return { ...summarizeProtection(reads), forges: reads }
}

/** Executa o aplicador para UMA forja e interpreta o relatório JSON. */
function readForgeProtection({ cwd, forge, run, nodePath }) {
  const args = [REQUIRED_CHECKS_APPLIER, "--check", "--forge", forge, "--json"]
  const res = run(nodePath, args, { cwd, encoding: "utf8", timeout: 60_000, env: process.env })
  // `missing: null` (e NÃO `[]`) é o que significa "não li": os consumidores
  // deste fato traduzem `[]` como "tudo registrado" — e o defeito medido era
  // exatamente esse, com as DUAS forjas sem proteção lida e o veredito
  // publicando 50 gates CORE "provado(s)", incluindo "a branch protection o
  // registra". Um `[]` aqui transformava "não consegui ler" em "está tudo lá".
  const empty = {
    forge,
    state: "unavailable",
    desired: 0,
    branches: [],
    missing: null,
    extra: null,
  }

  if (res.error) {
    return { ...empty, detail: `nao consegui executar o aplicador (${res.error.message})` }
  }
  if (res.signal || res.status === null) {
    return { ...empty, detail: "o aplicador nao terminou em 60s — trate como NAO verificado" }
  }

  let report = null
  try {
    report = JSON.parse(String(res.stdout ?? ""))
  } catch {
    report = null
  }
  const errors = report?.errors ?? []
  if (errors.some((e) => e.unsupported === true)) {
    // A FORJA NÃO SUPORTA O RECURSO — e isso é uma AFIRMAÇÃO sobre ela, não
    // ausência de prova: não há token, permissão nem comando que faça o branch
    // protection existir neste plano/repositório, então NADA bloqueia o merge
    // daquele lado. Dizer "não foi lida" aqui mandaria o operador caçar uma
    // credencial que está certa e esconderia o fato que importa (o portão não
    // existe). MEDIDO: com token de administração, o GET e o PATCH do GitHub
    // respondem 403 'Upgrade to GitHub Pro or make this repository public'.
    return {
      ...empty,
      state: "unsupported",
      unsupported: true,
      detail: errors.map((e) => e.message).join("; "),
    }
  }
  if (errors.length > 0) {
    // Falta de credencial/rede NÃO é evidência sobre a forja: é ausência de prova.
    return { ...empty, detail: errors.map((e) => e.message).join("; ") }
  }
  const data = report?.forges?.[forge]
  if (!data) {
    return { ...empty, detail: `o aplicador nao reportou a forja '${forge}' (exit ${res.status})` }
  }

  const desired = data.desired?.length ?? 0
  const branches = (data.branches ?? []).map((b) => ({
    branch: b.branch,
    configured: b.configured === true,
    missing: b.missing ?? [],
    extra: b.extra ?? [],
  }))
  const missing = [...new Set(branches.flatMap((b) => b.missing))]
  const extra = [...new Set(branches.flatMap((b) => b.extra))]
  // O veredito do APLICADOR manda: se ele diz drift e a derivação acima não viu
  // nada, ainda é drift (e a mensagem diz que veio dele).
  const drift = missing.length > 0 || extra.length > 0 || report.drift === true
  return {
    forge,
    state: drift ? "drift" : "in-sync",
    desired,
    branches,
    missing,
    extra,
    detail: describeProtection({
      branches,
      desired,
      missing,
      extra,
      flagged: report.drift === true,
    }),
  }
}

/**
 * Uma frase por branch, dita em termos do que o operador precisa fazer. A
 * AUSÊNCIA de proteção é o caso mais grave (nenhum check bloqueia nada) e tem
 * mensagem própria — "0 de N exigidos" não é o mesmo que "falta um".
 */
function describeProtection({ branches, desired, missing, extra, flagged }) {
  if (branches.length === 0) return "nenhuma branch reportada pelo aplicador"
  const parts = branches.map((b) => {
    if (!b.configured) {
      return `${b.branch} NAO tem protecao registrada (0 de ${desired} check(s) exigidos) — nenhum check bloqueia o merge`
    }
    if (b.missing.length === 0 && b.extra.length === 0) {
      return `${b.branch} exige os ${desired} check(s) do manifesto`
    }
    const bits = []
    if (b.missing.length > 0) bits.push(`falta(m) ${b.missing.map((c) => `'${c}'`).join(", ")}`)
    if (b.extra.length > 0) bits.push(`sobra(m) ${b.extra.map((c) => `'${c}'`).join(", ")}`)
    return `${b.branch} exige ${desired - b.missing.length} de ${desired} check(s): ${bits.join(" · ")}`
  })
  if (flagged && missing.length === 0 && extra.length === 0) {
    parts.push("o aplicador reportou drift sem nomear contexto")
  }
  return parts.join(" · ")
}

/**
 * O estado AGREGADO: um drift em qualquer forja domina; depois a forja que NÃO
 * SUPORTA o recurso (o portão não existe ali — é mais forte que "não li");
 * depois a falta de prova.
 *
 * A ordem não é decorativa: `drift` é contradição entre manifesto e forja, que
 * alguém conserta com um comando; `unsupported` é a forja recusando a feature,
 * que nenhum comando do repositório resolve; `unavailable` é falta de canal.
 */
function summarizeProtection(reads) {
  if (reads.length === 0) {
    return {
      state: "unavailable",
      detail: `${REQUIRED_CHECKS_MANIFEST} nao declara forja nenhuma — nao ha o que comparar com a forja`,
    }
  }
  const line = (r) => `${r.forge}: ${r.detail}`
  if (reads.some((r) => r.state === "drift")) {
    return { state: "drift", detail: reads.map(line).join(" · ") }
  }
  if (reads.some((r) => r.state === "unsupported")) {
    return { state: "unsupported", detail: reads.map(line).join(" · ") }
  }
  if (reads.some((r) => r.state !== "in-sync")) {
    return { state: "unavailable", detail: reads.map(line).join(" · ") }
  }
  return { state: "in-sync", detail: reads.map(line).join(" · ") }
}

/**
 * As mensagens de BLOQUEIO do contrato REGISTRADO — o que o veredito consome, e
 * por isso exportado (o teste trava a frase que o operador lê).
 */
export function protectionBlockers(protection) {
  return (protection?.forges ?? [])
    .filter((f) => f.state === "drift")
    .map(
      (f) =>
        `branch protection REGISTRADA no ${f.forge} divergiu de ${REQUIRED_CHECKS_MANIFEST}: ${f.detail}. Remédio: bun run ci:required-checks -- --apply (o manifesto é a fonte; a forja é quem obedece)`,
    )
}

/**
 * O bloqueio do REGISTRO do runner, com a localização do arquivo lido e o
 * remédio do próprio guard.
 *
 * Um bloqueio só, e não um por divergência: todas as linhas do guard descrevem o
 * MESMO problema (o registro não é o do compose) e o veredito lê melhor com uma
 * frase que nomeia onde o arquivo está do que com N repetições do mesmo juízo.
 *
 * @param {object} labels
 * @returns {string[]}
 */
export function runnerLabelBlockers(labels) {
  const where = labels?.container
    ? `${labels.container} · ${labels.stateFile}`
    : "o registro do runner"
  const remedies = (labels?.remedies ?? []).join(" ")
  return [
    `o registro do act_runner NAO é o do compose (${labels?.detail}): ${where} x ${GITEA_COMPOSE} — ${(labels?.violations ?? []).join(" · ")}${remedies ? ` ${remedies}` : ""}`,
  ]
}

/**
 * As referencias da imagem que vivem em configuracao NAO VERSIONADA
 * (repository variables, env do host, o que o registry serve para a tag).
 *
 * POR QUE E UM FATO PROPRIO: nenhuma delas esta no repositorio — e por isso
 * mesmo nao da para "ler e concluir". O guard devolve um tri-estado por
 * referencia (`proven` / `indeterminate` / `violated`), e este fato so o
 * transporta para o veredito: VIOLACAO bloqueia; INDETERMINADO nunca vira
 * "pronto" — e o que o doctor chama de nao provado.
 *
 * `deps` e a fronteira de dependencia do teste (`env` e `probe`: o ambiente do
 * processo e a consulta ao registry).
 *
 * @param {{cwd?: string, envFile?: string, deps?: object}} [args]
 * @returns {Promise<{state: string, items: {source: string, state: string, detail: string}[], violations: string[], detail: string}>}
 */
export async function readImageRefs({
  cwd = REPO_ROOT,
  envFile = DEFAULT_ENV_FILE,
  deps = {},
} = {}) {
  try {
    return await checkNonVersionedImageRefs({ root: cwd, hostEnv: envFile, ...deps })
  } catch (err) {
    // Um fato nunca derruba o doctor: se a propria avaliacao falhou, isso e
    // ausencia de prova (INDETERMINADA), nao "esta tudo certo".
    return {
      state: "unavailable",
      items: [],
      violations: [],
      detail: `nao foi possivel avaliar as referencias nao versionadas: ${err?.message ?? String(err)}`,
    }
  }
}

/**
 * Os espelhos da versão do Bun concordam com o que o repositório DECLARA?
 *
 * SÃO DUAS PERGUNTAS, e a segunda é a que faltava aqui:
 *   1. os arquivos locais existem e concordam entre si? (sem rede, sempre possível)
 *   2. cada um bate com o VALOR de `vars.BUN_VERSION`? (só com `--expected`: o
 *      valor da variável não existe no checkout, ele vive no Actions)
 *
 * A pergunta 2 é a MESMA do guard periódico (`check-actrc-sync.mjs`, job semanal
 * `actrc-sync`) — e por isso NÃO é reimplementada: este fato chama
 * `mirrorDriftReport`, a função que o guard, o CLI dele e o publicador de issue
 * já compartilham. A descoberta dos arquivos (template comitado + o `.env.gitea`
 * do host quando existe, ou o `--gitea-env` apontado) e a leitura dos valores
 * vêm de lá; uma segunda comparação aqui divergiria da primeira justamente no
 * dia do drift.
 *
 * SEM `--expected` o que resta é a pergunta 1 — e ela é MAIS FRACA do que
 * parece: dois espelhos que concordam entre si podem estar os DOIS velhos em
 * relação à variável. É exatamente assim que o fast path de 0s do tier-1
 * desliga na forja sem nenhum sintoma. Então, sem o valor, o doctor diz que o
 * VALOR não foi comparado — em vez de chamar de "em sincronia" o que só provou
 * existir.
 *
 * A GRAVIDADE É DIFERENTE PARA CADA ESPELHO, e misturar os dois seria mentir:
 *   - o env da forja (`deploy/env.gitea.example`, e o `.env.gitea` do host)
 *     alimenta a label do runner: ausente, a forja não sabe QUAL imagem rodar →
 *     BLOQUEIA (é config da forja); divergente do valor declarado, o runner
 *     roda OUTRA imagem → BLOQUEIA também (o tier-1 desliga em silêncio e o
 *     setup funciona igual, só mais lento);
 *   - `.actrc` é o espelho do act LOCAL: divergir dele não impede a forja de
 *     bloquear merge nenhum — incomoda quem roda act na máquina → NÃO PROVADO.
 *
 * COMO O VALOR CHEGA: `--expected` traz `vars.BUN_VERSION` e `--expected-var
 * NOME=VALOR` traz as DEMAIS variáveis que o compose consome
 * (`IMAGE_REGISTRY`/`IMAGE_NAMESPACE`). As ausentes ficam em `unknowns`,
 * nominalmente: a metade que prova existência não pode passar por prova de
 * valor, e uma variável sem valor passado não pode sumir em silêncio.
 *
 * @param {string} [cwd]
 * @param {{expected?: string|null, expectedVars?: Record<string, string|null>, envPath?: string|null}} [options]
 *   `expected`: valor de `vars.BUN_VERSION` (null = não perguntado — o VERDITO
 *   do valor não foi feito); `expectedVars`: os valores das outras variáveis
 *   comparadas; `envPath`: o env de um host específico
 *   (`--gitea-env`), que SUBSTITUI a descoberta como no CLI do guard (para
 *   inquirir OUTRO host). O doctor NÃO usa esta opção de propósito: ele quer o
 *   template comitado E o host do checkout, e passar um caminho largaria o
 *   template fora da comparação. O valor de outro host entra pela invariante
 *   7b (host x template), que compara o env inteiro.
 * @returns {{actrc: string|null, env: string|null, expected: string|null, expectedVars: Record<string, string|null>, mirrors: object[], warnings: string[], blockers: string[], unknowns: string[]}}
 */
export function readMirrors(
  cwd = REPO_ROOT,
  { expected = null, expectedVars = {}, envPath = null } = {},
) {
  const blockers = []
  const unknowns = []

  const wanted = normalizeExpectedVars({ expected, expectedVars })
  const envFile = join(cwd, GITEA_ENV_MIRROR)
  const envValues = existsSync(envFile)
    ? readMirrorVariableValues(readFileSync(envFile, "utf8"), "env")
    : null
  const env = envValues?.BUN_VERSION ?? null
  if (env === null) {
    blockers.push(
      `${GITEA_ENV_MIRROR} ausente ou sem BUN_VERSION — é ele que alimenta a label do runner: sem ele a forja não sabe qual imagem rodar`,
    )
  }

  const actrcPath = join(cwd, ".actrc")
  const actrc = existsSync(actrcPath)
    ? extractActrcBunVersion(readFileSync(actrcPath, "utf8"))
    : null

  // Sem RÉGUA NENHUMA não há como dizer se o espelho está certo: o que se pode
  // dizer é que os dois entre si divergem (um dos dois está velho) e que a
  // pergunta do VALOR continua aberta.
  const comparable = MIRROR_VARIABLES.some((name) => wanted[name] !== null && wanted[name] !== "")
  if (!comparable) {
    if (actrc === null) {
      unknowns.push(".actrc ausente ou sem BUN_VERSION — o act local rodaria sem versão")
    } else if (env !== null && actrc !== env) {
      unknowns.push(
        `os espelhos locais divergem: .actrc='${actrc}' vs ${GITEA_ENV_MIRROR}='${env}' — um dos dois está velho, e qual é o certo só a repository variable diz`,
      )
    }
    unknowns.push(
      `o VALOR dos espelhos NAO foi comparado com vars.BUN_VERSION: a variável vive no Actions, não no checkout — passe --expected <versão> (ou, com credencial: --expected "$(gh variable get BUN_VERSION)") e --expected-var para as demais variáveis da imagem. Existência e concordância local não provam que o runner roda o que está declarado`,
    )
    return {
      actrc,
      env,
      expected,
      expectedVars: wanted,
      mirrors: [],
      warnings: [],
      blockers,
      unknowns,
    }
  }

  // O env de um host apontado só entra quando EXISTE: o `mirrorDriftReport` lê o
  // arquivo sem checar (o CLI do guard trata a ausência como erro de uso), e um
  // doctor que estoura num fato não é um doctor. A ausência do arquivo já é
  // reportada na seção da imagem, que lê o MESMO `--gitea-env`.
  const host = envPath && existsSync(envPath) ? envPath : null
  const report = mirrorDriftReport({
    cwd,
    expected,
    expectedVars,
    ...(host ? { envPath: host } : {}),
  })

  for (const d of report.drift) {
    if (d.kind === "env") {
      const kind = d.deployed ? "o env DESTE host" : "o template comitado"
      blockers.push(
        `${d.label} define ${d.name}='${d.value ?? "ausente"}' mas vars.${d.name}='${d.expected}' — é ${kind} que alimenta a label do runner: ${ENV_MIRROR_COSTS[d.name] ?? "a imagem que roda nao e a declarada"}. Remédio: ${doctorEnvRemedy(d)}`,
      )
    } else {
      // O `.actrc` é o espelho do act LOCAL: divergir dele não impede a forja de
      // bloquear merge nenhum — incomoda quem roda act na máquina → NÃO PROVADO.
      const remedy =
        d.name === "BUN_VERSION"
          ? `bash scripts/bump-bun.sh ${d.expected} (escreve a variável, o .actrc e o template de uma vez)`
          : `atualize o --var ${d.name} no .actrc (o act local lê o espelho, não a variável)`
      unknowns.push(
        `.actrc define ${d.name}='${d.value ?? "ausente"}' mas vars.${d.name}='${d.expected}' — o act LOCAL usa outro valor (não é o merge, é a dev experience da máquina). Remédio: ${remedy}`,
      )
    }
  }

  // Variável SEM valor passado: a comparação não aconteceu para ela, e o doctor
  // DIZ qual — sem isso o veredito chamaria de "conferido" o que só teve a
  // existência olhada (a regra que o resto do doctor já aplica ao valor da
  // versão).
  if (report.unproven.length > 0) {
    unknowns.push(
      `o VALOR de ${report.unproven.join(", ")} nao foi comparado com a repository variable: passe ${report.unproven
        .map((n) => `--expected-var ${n}=<valor>`)
        .join(" ")} (sem isso a comparacao dos espelhos fica so na versao)`,
    )
  }

  return {
    actrc,
    env,
    expected,
    expectedVars: wanted,
    mirrors: report.mirrors,
    // Os avisos do GUARD, no texto dele: o log do doctor e a issue do job semanal
    // não podem discordar, e é isso que a fonte única garante.
    warnings: report.warnings,
    blockers,
    unknowns,
  }
}

/**
 * O remédio de um drift de env, por variável: só a VERSÃO tem script de bump.
 *
 * @param {{name: string, label: string, deployed: boolean, expected: string}} d
 * @returns {string}
 */
function doctorEnvRemedy(d) {
  if (d.name === "BUN_VERSION") {
    return d.deployed
      ? `bash scripts/bump-bun.sh ${d.expected}, e re-registre o runner: bash deploy/gitea-up.sh --re-register`
      : `bash scripts/bump-bun.sh ${d.expected}`
  }
  return d.deployed
    ? `atualize ${d.label} e re-registre o runner: bash deploy/gitea-up.sh --re-register`
    : `atualize ${d.label} (o template comitado) e a repository variable`
}

/** Roda o check da imagem (NUNCA publica) e guarda as linhas que ele emitiu. */
export async function readImage({ envFile = DEFAULT_ENV_FILE, cwd = REPO_ROOT, deps = {} } = {}) {
  // (o `readImageContract` logo abaixo consome o `ref` resolvido aqui)
  const lines = []
  const emit = {
    pass: (m) => lines.push(`✅ ${m}`),
    fail: (m) => lines.push(`❌ ${m}`),
    warn: (m) => lines.push(`⚠️  ${m}`),
    info: (m) => lines.push(`▸  ${m}`),
    plain: (m = "") => lines.push(m),
  }
  // `emit` por ÚLTIMO: as dependências injetadas são para o fetch/exec, nunca
  // para trocar o coletor de linhas (senão a saída do check sumiria do relatório).
  const res = await ensureRunnerImage({ check: true, envFile, cwd, ...deps, emit })
  return { code: res.code, ref: res.ref, state: res.state, detail: res.detail, lines }
}

/**
 * O CONTRATO DA IMAGEM PUBLICADA — o que o build promete x o que a forja BAIXA.
 *
 * POR QUE O BUILD NÃO BASTA: o pin por digest, o bloco fail-closed e as mutações
 * falhando provam o ARQUIVO e o bloco dele. Todas seguem verdadeiras se a imagem
 * que o registry serve for OUTRA build — e é essa que o job baixa. Aqui o alvo é
 * o DIGEST que a tag serve hoje (não a tag: rodar por tag provaria o cache DESTA
 * máquina) e quem decide é o MESMO bloco do Dockerfile, executado DENTRO do
 * artefato: plugin `compose`, versão do Bun e o caminho resolvido.
 *
 * A RESOLUÇÃO DO DIGEST sai do MESMO probe do invariante 9
 * (`probeImageIdentity`), com a credencial do ambiente: sem ela o pacote privado
 * responde 401 e o fato é INDETERMINADA — nunca "o contrato está certo".
 *
 * O `expected` é o valor de `vars.BUN_VERSION` (`--expected`) e, sem ele, a TAG
 * que o compose declara (o env do runner é a fonte do ref): a comparação do
 * valor entre os dois é do fato dos espelhos; aqui a pergunta é se a IMAGEM roda
 * a versão que ela promete.
 *
 * @param {{image?: {ref?: string|null}, expected?: string|null, cwd?: string, env?: Record<string, string>, deps?: object}} [args]
 * @returns {Promise<{state: string, detail: string, ref: string|null, digest: string|null, target: string|null, expectedVersion: string|null, findings: object|null, remedies: string[]}>}
 */
export async function readImageContract({
  image = {},
  expected = null,
  cwd = REPO_ROOT,
  env = {},
  deps = {},
} = {}) {
  const ref = image?.ref ?? null
  if (!ref) {
    return {
      state: "unavailable",
      detail:
        "a imagem declarada nao foi resolvida (env do runner ausente/invalido): nao ha artefato a provar contra o registry",
      ref: null,
      digest: null,
      target: null,
      expectedVersion: expected,
      findings: null,
      remedies: [],
    }
  }
  const tag = ref.slice(ref.lastIndexOf(":") + 1)
  const expectedVersion = expected ?? tag
  const result = await checkPublishedImageContract({
    ref,
    expectedVersion,
    credentials: credentialsFromEnv(env),
    cwd,
    ...deps,
  })
  return { ...result, expectedVersion, ref }
}

/**

/**
 * A prova do bloqueio: EXECUTA o `deploy/gitea-up.sh` real contra um registry de
 * TESTE (127.0.0.1) e afirma sobre o log do docker dublê — com a tag ausente o
 * runner não sobe, com a tag presente sobe. Inclui a família do `--re-register`,
 * que tem um risco PRÓPRIO: ele apaga o registro gravado antes de subir, então a
 * prova exige que a falha da garantia não destrua nada, que a ordem seja
 * `rm` → `volume rm` → `up -d runner` e que um registro que não sai não deixe o
 * runner subir com os labels antigos.
 *
 * POR QUE ISTO É UM FATO DO VEREDITO e não uma nota de rodapé: o doctor podia
 * dizer "imagem garantida" com base apenas na EXISTÊNCIA da tag agora. Isso
 * responde "dá para puxar?", não "a subida depende disso?". A prova responde a
 * segunda — e se ela falhar, o remédio não é publicar imagem nenhuma: é
 * consertar a subida.
 *
 * Nunca lança: `unavailable` (sem bash, sem o bring-up) é um estado próprio,
 * distinto de falha, porque ausência de prova não é prova de falha.
 */
export async function readProof({ cwd = REPO_ROOT, deps = {} } = {}) {
  // `prove` é o ponto de injeção: o teste do doctor precisa dos TRÊS estados
  // (segura/violada/indisponível) sem montar um registry e um docker dublê
  // dentro do teste do AGREGADOR — a prova em si tem o próprio arquivo de teste.
  const { prove = proveRunnerImageGate, ...rest } = deps
  try {
    const res = await prove({ cwd, ...rest })
    return { status: res.status, ok: res.ok, detail: res.detail, cases: res.cases }
  } catch (err) {
    return {
      status: "unavailable",
      ok: false,
      detail: `a prova não pôde rodar: ${err?.message ?? String(err)}`,
      cases: [],
    }
  }
}

/**
 * O REGISTRO do act_runner (`/data/.runner`) × o que o compose declara.
 *
 * POR QUE É UM FATO DO VEREDITO e não uma nota de rodapé: o render prova o que o
 * compose PEDE; nada aqui prova o que o runner GRAVOU — e é o gravado que decide
 * a imagem de todo job. Os labels são ESTADO (vivem no volume, enviados à
 * instância no registro, nunca relidos do compose): um `up -d runner` recria o
 * container com o env novo e deixa o registro velho no lugar. O sintoma é o pior
 * tipo: o job roda, o setup funciona, os testes passam — na imagem antiga, sem o
 * tier-1. Um registro VAZIO é o caso extremo: runner órfão, nenhum job atribuído
 * a ele.
 *
 * NÃO reimplementa nada: chama `checkRunnerLabels` (o MESMO guard da Prova 5 do
 * smoke, com o mesmo exit code) — um segundo comparador divergiria do primeiro
 * justamente no dia do registro velho.
 *
 * Estados, e a diferença entre eles é o ponto: `proven` (é o do compose),
 * `violated` (registro velho/vazio, ou compose sem os labels ⇒ BLOQUEIA) e
 * `unavailable`/`env-missing` (sem docker, sem socket, sem container, registro
 * ilegível ⇒ NÃO PROVADO). Nunca lança: ausência de prova não é prova de falha.
 *
 * `deps` é a fronteira de dependência do teste (`check` e o `run` do guard).
 */
export function readRunnerLabels({ cwd = REPO_ROOT, envFile = null, deps = {} } = {}) {
  const { check = checkRunnerLabels, ...rest } = deps
  const empty = {
    violations: [],
    remedies: [],
    declared: [],
    registered: [],
    container: null,
    stateFile: null,
  }
  try {
    const res = check({ cwd, envFile, ...rest })
    return {
      state: res.state,
      violations: res.violations ?? [],
      remedies: res.remedies ?? [],
      detail: res.detail,
      declared: res.declared ?? [],
      registered: res.registered ?? [],
      container: res.container ?? null,
      stateFile: res.stateFile ?? null,
    }
  } catch (err) {
    return {
      ...empty,
      state: "unavailable",
      detail: `o registro do act_runner nao pode ser lido: ${err?.message ?? String(err)}`,
    }
  }
}

/**
 * O REGISTRO do runner AUTO-HOSPEDADO DO GITHUB — a outra forja, o MESMO
 * registro velho, e aqui ele é invisível por CONSTRUÇÃO.
 *
 * POR QUE É UM FATO PRÓPRIO E NÃO UMA VARIAÇÃO DO ANTERIOR: a leitura não tem
 * nada em comum com a da forja. O act_runner grava os labels no volume
 * (`/data/.runner`, aliás `docker exec`); o runner do GitHub NÃO grava label
 * nenhum (o `.runner` do actions/runner guarda AgentId/AgentName/PoolName/
 * ServerUrl — nenhum campo de labels): o registro vive no SERVIDOR, e quem o lê
 * é a API. Mesmos estados, mesmos remédios — a origem é outra.
 *
 * Não reimplementa nada: chama `checkGithubRunnerLabels` (o MESMO código do
 * CLI `--forge github`). `violated` BLOQUEIA (o runner registrado pega os jobs
 * numa configuração que o repositório não declara — ou não pega job nenhum, se
 * o registro está vazio, ou o runner declarado não existe/está offline) e
 * `unavailable`/`env-missing` são NÃO PROVADO (sem token de self-hosted runners
 * ou sem repo, o doctor não finge "em sincronia"). Nunca lança: ausência de
 * prova não é prova de falha.
 *
 * `deps` é a fronteira de dependência do teste (`check`).
 */
export async function readGithubRunnerLabels({
  cwd = REPO_ROOT,
  env = process.env,
  deps = {},
} = {}) {
  const { check = checkGithubRunnerLabels, ...rest } = deps
  const empty = {
    violations: [],
    remedies: [],
    declared: [],
    registered: [],
    runner: null,
    status: null,
    repo: null,
  }
  try {
    const res = await check({ cwd, env, ...rest })
    return {
      state: res.state,
      violations: res.violations ?? [],
      remedies: res.remedies ?? [],
      detail: res.detail,
      declared: res.declared ?? [],
      registered: res.registered ?? [],
      runner: res.runner ?? null,
      status: res.status ?? null,
      repo: res.repo ?? null,
    }
  } catch (err) {
    return {
      ...empty,
      state: "unavailable",
      detail: `o registro do runner do GitHub nao pode ser lido: ${err?.message ?? String(err)}`,
    }
  }
}

/**
 * O bloqueio do REGISTRO do runner do GitHub, com o runner lido e o remédio.
 *
 * Um bloqueio só, pelo mesmo motivo do `runnerLabelBlockers`: todas as linhas do
 * guard descrevem o MESMO problema (o registro não é o do setup) e
 * `violations.length` tem de continuar significando "quantos problemas existem".
 *
 * @param {object} labels
 * @returns {string[]}
 */
export function githubRunnerLabelBlockers(labels) {
  const where = labels?.runner
    ? `runner '${labels.runner}' (${labels.status}) · repos/${labels.repo}/actions/runners`
    : `repos/${labels?.repo}/actions/runners`
  const remedies = (labels?.remedies ?? []).join(" ")
  return [
    `o registro do runner do GITHUB NAO é o que o setup declara (${labels?.detail}): ${where} x ${GITHUB_RUNNER_SCRIPT} — ${(labels?.violations ?? []).join(" · ")}${remedies ? ` ${remedies}` : ""}`,
  ]
}

// ═══════════════════════════════════════════════════════════════════════════
// 4b. A dívida ABERTA no board
// ═══════════════════════════════════════════════════════════════════════════

/** As forjas cujo board pode carregar dívida (a forja primeiro: é ela a dona do merge). */
/**
 * As forjas cujo board o doctor lê.
 *
 * POR QUE AS DUAS, mesmo o doctor rodando na forja: nem toda dívida nasce aqui.
 * A auditoria reversa do README e a tendência de mutação são crons do
 * `.github/` — as issues delas existem SÓ no board do GitHub. Lê-las é o que
 * impede a prontidão de dizer "sem dívida" sobre um board que ela nunca olhou.
 *
 * O GITHUB EXIGE CANAL PRÓPRIO (`GH_TOKEN` + `GH_REPOSITORY`, ver
 * `githubReadConfig` em `issue-publish.mjs`): o runner da forja não tem a CLI
 * `gh`, e `GITHUB_*` ali aponta para o repositório do GITEA. Sem o canal, a
 * leitura do GitHub sai como NÃO lida — nunca como "sem dívida".
 */
const DEBT_FORGES = ["gitea", "github"]

/** Um dia em ms — a IDADE da dívida é o que separa a ativa da esquecida. */
const MS_PER_DAY = 86_400_000

/**
 * Os ASSUNTOS de dívida que o board carrega: uma label por publicador de issue
 * deste repositório, com o marcador que identifica QUEM a escreveu.
 *
 * POR QUE UMA LISTA EXPLÍCITA (e não "toda issue aberta"): o board tem issue de
 * produto, de cliente, de ideia — lê-las como dívida de forja encheria o veredito
 * de ruído alheio, e um alerta que sempre acende é um alerta que ninguém lê. A
 * lista é a de quem ABRE alerta por cron, e o `markerId` é o que separa o que é
 * NOSSO do que ganhou a etiqueta à mão.
 *
 * A FONTE desta lista são os próprios publicadores (`ISSUE_LABEL` + o marcador de
 * cada um): um teste percorre `scripts/*-issue.mjs` e FALHA se uma label nova não
 * estiver aqui — a dívida de um cron novo não pode nascer invisível para a
 * prontidão (que é o defeito que este fato existe para matar).
 *
 * `crossCheck` diz se o doctor MEDE o mesmo assunto por conta própria (e então
 * pode dizer se a issue caducou, o outro lado da mesma moeda): `protection` e
 * `mirrors` são fatos deste relatório; `null` é assunto que só o publicador vê.
 * `forges` diz ONDE a label existe — ler a forja errada devolveria vazio e o
 * vazio passaria por "sem dívida".
 */
export const DEBT_SUBJECTS = [
  {
    label: "required-checks-drift",
    markerId: "required-checks-drift",
    subject: "a branch protection REGISTRADA divergiu do manifesto de required checks",
    forges: ["gitea", "github"],
    crossCheck: "protection",
  },
  {
    label: "actrc-sync-drift",
    markerId: "actrc-sync-drift",
    subject: "os espelhos do BUN_VERSION divergiram da repository variable",
    forges: ["github"],
    crossCheck: "mirrors",
  },
  {
    label: "env-mirror-drift",
    markerId: "env-mirror-drift",
    subject:
      "o env do HOST da forja (deploy/.env.gitea) divergiu do template comitado (deploy/env.gitea.example)",
    forges: ["gitea"],
    // O doctor MEDE o mesmo par (`compose.hostCompare`, e o pré-requisito 0 que
    // deriva dele) — mas aquele fato é calculado DEPOIS da leitura do board e
    // carrega o MESMO limite de visibilidade deste publicador (o env do host é
    // gitignored e existe só onde a stack roda). Usá-lo como segunda testemunha
    // exigiria reordenar o `diagnose`, e não acrescentaria independência: os dois
    // leem a mesma descoberta. `null` é a resposta honesta.
    crossCheck: null,
  },
  {
    label: "readme-drift",
    markerId: "readme-drift",
    subject: "a auditoria reversa do README achou um alvo que o repositório não serve mais",
    forges: ["github"],
    crossCheck: null,
  },
  {
    label: "mutation-trend-drift",
    markerId: "mutation-trend-drift",
    subject: "o overhead da suíte passou do limiar (tendência ou timing)",
    forges: ["github"],
    crossCheck: null,
  },
  {
    label: "crlf-scope-drift",
    markerId: "blob-crlf-scope-drift",
    subject:
      "o alcance do CRLF no histórico cresceu (blobs em tipos `text eol=lf` além do gate `.sh`/`.bash`)",
    forges: ["github"],
    // O doctor NÃO varre a história do git por CRLF — o alcance é assunto que
    // só o publicador vê (a correção é reescrita deliberada, não um fato do
    // diagnóstico de prontidão). Declarar `null` é dizer isso, e nunca
    // presumir caducidade.
    crossCheck: null,
  },
  {
    label: "guard-timing-regression",
    markerId: "guard-timing-regression",
    subject:
      "o wall time dos guards/doctor (e do custo do lint) passou do limiar do bench-guard-timing",
    forges: ["github"],
    // O doctor NÃO mede o bench de wall time: ele roda os gates para julgar
    // CORRETUDE, e cronometrá-los aqui mediria a máquina deste run contra
    // BASELINE de outra máquina — comparar os dois daria "caducidade" a partir de
    // um número que não é comparável. `null` é o mesmo que o `crlf-scope-drift`
    // declara: assunto que só o publicador vê, e nunca presumir caducidade.
    crossCheck: null,
  },
  {
    label: "runner-shells-drift",
    markerId: "runner-shells-drift",
    subject:
      "o conjunto de shells da imagem DECLARADA do runner divergiu do que a imagem publicada tem (o gate passaria um passo que morre com `command not found`)",
    forges: ["github"],
    // A medição exige PUXAR a imagem (docker + registry) e comparar o conjunto
    // MEDIDO com o declarado; o doctor cobre a DECLARAÇÃO (o gate de sintaxe lê
    // os shells declarados para julgar os passos), não o que a imagem publicada
    // tem. Assunto que só o publicador vê — a mesma resposta do `crlf-scope-drift`
    // e do `guard-timing-regression`: `null` diz isso, e nunca presume caducidade.
    crossCheck: null,
  },
  {
    label: "declared-debt-review",
    markerId: "declared-debt-review",
    subject:
      "uma isenção DECLARADA (data + janela de revisão) venceu sem ser reafirmada, ou ficou SEM REGISTRO",
    forges: ["github"],
    // O doctor MEDE o mesmo assunto por conta própria: o fato `declaredDebt`
    // (a MESMA função `collectDeclaredDebt` que o publicador consome) dá a
    // idade das isenções a cada run. É o cruzamento mais forte deste registro —
    // e é por isso que a leitura da issue NÃO substitui o fato: a issue diz que
    // alguém foi avisado, o fato diz se ainda é verdade.
    crossCheck: "declaredDebt",
  },
]

/**
 * A label que fica FORA da leitura — e a razão, dita para não parecer esquecimento.
 *
 * É a saída DESTE comando: uma issue de veredito aberta existe porque o veredito
 * não é PRONTA. Lê-la como dívida faria o doctor alimentar o próprio alerta —
 * INDETERMINADA para sempre, por construção, e a decisão de publicar nunca mais
 * voltaria a ser PRONTA nem depois de tudo resolvido. O ciclo do veredito é
 * fechado pelo PUBLICADOR (que a abre e comenta), não pelo diagnóstico.
 */
export const DEBT_EXCLUDED = {
  label: "forge-doctor-verdict",
  why: "é a saída DESTE comando: ler o próprio veredito como dívida faria o doctor se alimentar",
}

/**
 * A idade da issue, em dias, a partir do `createdAt` que o backend devolve.
 *
 * `days: null` quando a forja não deu a data — e não `0`, que se confundiria com
 * "aberta hoje". O que não se sabe não vira número.
 */
function debtIssue(issue, nowMs) {
  const createdAt = issue?.createdAt ?? null
  const ts = createdAt ? Date.parse(createdAt) : Number.NaN
  return {
    number: issue?.number ?? null,
    title: issue?.title ?? "",
    createdAt,
    days: Number.isFinite(ts) ? Math.max(0, Math.floor((nowMs - ts) / MS_PER_DAY)) : null,
  }
}

/**
 * A CADUCIDADE da issue: o doctor mede o mesmo assunto por conta própria?
 *
 * Três respostas, e nenhuma delas é um palpite: `true` (o doctor mede o assunto
 * e ele está limpo AGORA — a issue provavelmente fala de um problema que já se
 * foi), `false` (o doctor mede e o problema CONTINUA — a issue está certa) e
 * `null` (o doctor NÃO mede esse assunto, ou não conseguiu medir nesta run: não
 * dá para declarar caducidade daqui). `null` nunca vira `true`: dizer "caducou"
 * sobre o que não se mediu é a dívida que mente, do outro lado.
 */
function debtStaleness(subject, forge, { protection, mirrors, declaredDebt }) {
  if (subject.crossCheck === "protection") {
    const read = (protection?.forges ?? []).find((f) => f.forge === forge)
    if (!read) {
      return {
        stale: null,
        detail: `o doctor não leu a branch protection do ${forge} nesta run`,
      }
    }
    if (read.state === "in-sync") {
      return {
        stale: true,
        detail: `o doctor mede a branch protection do ${forge} EM SINCRONIA com ${REQUIRED_CHECKS_MANIFEST} — a issue fala de um problema que já não se vê (o publicador a fecha por assinatura quando o drift some)`,
      }
    }
    return {
      stale: false,
      detail: `o doctor também mede a branch protection do ${forge} e ela NÃO está em sincronia (${read.state}) — a issue fala de um problema VIVO`,
    }
  }

  if (subject.crossCheck === "mirrors") {
    // O que conta é o que foi de fato COMPARADO: as fatos antigos trazem só
    // `expected` (a versão), os novos trazem `expectedVars` (as três).
    const wanted = mirrors?.expectedVars ?? { BUN_VERSION: mirrors?.expected ?? null }
    const compared = MIRROR_VARIABLES.filter(
      (name) => wanted[name] !== null && wanted[name] !== undefined && wanted[name] !== "",
    )
    if (compared.length === 0) {
      return {
        stale: null,
        detail:
          "o VALOR dos espelhos não foi comparado nesta run (sem --expected/--expected-var) — o doctor não pode declarar a issue caducada",
      }
    }
    const clean = (mirrors.blockers?.length ?? 0) === 0 && (mirrors.unknowns?.length ?? 0) === 0
    return clean
      ? {
          stale: true,
          detail: `o doctor mede os espelhos das variáveis da imagem (${compared.join(", ")}) em concordância com as repository variables`,
        }
      : {
          stale: false,
          detail: `o doctor também mede os espelhos das variáveis da imagem (${compared.join(", ")}) e eles NÃO estão limpos agora`,
        }
  }

  if (subject.crossCheck === "declaredDebt") {
    // Só o que foi de fato MEDIDO conta: sem o fato (ausente, pulado por
    // `--no-declared-debt`, ou `unread` porque uma lista não pôde ser lida) a
    // resposta honesta é `null` — dizer "caducou" sobre o que não se mediu é a
    // dívida que mente, do outro lado.
    if (!declaredDebt || declaredDebt.state === "skipped" || declaredDebt.state === "unread") {
      return {
        stale: null,
        detail:
          "a idade das isenções declaradas não foi medida nesta run — o doctor não pode declarar a issue caducada",
      }
    }
    const vivas = (declaredDebt.aged?.length ?? 0) + (declaredDebt.invalid?.length ?? 0)
    if (vivas === 0) {
      return {
        stale: true,
        detail: `o doctor mede as MESMAS isenções agora (${declaredDebt.total} decisão(ões) em ${declaredDebt.sources.length} lista(s)) e nenhuma passou a janela — a issue fala de um problema que já não se vê (o publicador a fecha por assinatura quando a dívida some)`,
      }
    }
    return {
      stale: false,
      detail: `o doctor também mede as isenções declaradas e ${vivas} delas ainda estão vencidas (ou Sem REGISTRO) — a issue fala de um problema VIVO`,
    }
  }

  return {
    stale: null,
    detail: `o assunto não é medido pelo doctor — a caducidade não pode ser declarada daqui`,
  }
}

/** A frase de UM assunto com dívida aberta: quantas, quais, há quanto tempo, e se caducou. */
function describeOpenDebt({ forge, subject, ours, alien, staleness }) {
  const bits = []
  if (ours.length > 0) {
    bits.push(
      `aberta(s) por este publicador: ${ours
        .map((i) => `#${i.number}${i.days === null ? "" : ` (há ${i.days} dia(s))`}`)
        .join(", ")}`,
    )
  }
  if (alien.length > 0) {
    bits.push(
      `SEM o marcador do publicador: ${alien.map((i) => `#${i.number}`).join(", ")} — não foram os crons que as abriram, então um automatismo não pode fechá-las: revise à mão`,
    )
  }
  const stale =
    staleness.stale === true
      ? `Parece CADUCADA: ${staleness.detail}`
      : staleness.stale === false
        ? `Fala de um problema VIVO: ${staleness.detail}`
        : `Caducidade NÃO verificada: ${staleness.detail}`
  return `${ours.length + alien.length} dívida(s) ABERTA(S) no ${forge} com a label '${subject.label}' (assunto: ${subject.subject}) — ${bits.join(" · ")}. ${stale}`
}

/**
 * A DÍVIDA ABERTA NO BOARD — as issues que os crons deste repositório abriram e
 * ninguém fechou.
 *
 * POR QUE ISTO É UM FATO DO VEREDITO: o doctor mede a forja AGORA (proteção
 * registrada, registro do runner, tag no registry, espelhos). Nenhuma dessas
 * medições vê o BOARD — e é ali que vive a dívida que alguém já identificou e não
 * resolveu: um drift de README, um overhead que subiu, uma proteção que foi
 * consertada à mão e cuja issue o publicador não conseguiu fechar. Sem este fato,
 * "PRONTA PARA BLOQUEAR O MERGE" convive com uma issue aberta que diz o
 * contrário, e o veredito responde sobre o que ele mesmo mediu, não sobre o que o
 * repositório já sabe.
 *
 * POR QUE NÃO BLOQUEIA: uma issue aberta não prova que a forja falha em bloquear
 * o merge — prova que existe dívida PENDENTE. Bloquear por ticket transformaria
 * "alguém esqueceu de fechar" em "não confie o merge", e o operador aprenderia a
 * ignorar o veredito. Não poder PRONTA é o peso certo: vira INDETERMINADA, com o
 * número da issue e a idade para quem lê decidir.
 *
 * A LEITURA é a MESMA mecânica dos publicadores (`listIssuesByLabel`, de
 * `issue-publish.mjs`): o leitor e quem escreve enxergam o mesmo board, com o
 * mesmo marcador. Nunca lança — cada forja que não deu para ler vira `unread`, e
 * "não consegui ler" é reportado como tal, jamais como "sem dívida".
 *
 * COMO se leu é um FATO do relatório (`via`), não detalhe interno: no runner da
 * forja o `gh` não existe, e a diferença entre "li o board do GitHub pela API e
 * não há dívida" e "não consegui ler" é exatamente o que o veredito existe para
 * não borrar. O canal sai do MESMO resolvedor que a leitura usa
 * (`githubReadConfig`) — o relatório não pode declarar um canal que não foi o
 * usado.
 *
 * @param {{cwd?: string, env?: Record<string,string|undefined>, deps?: {list?: Function, now?: () => number, githubChannel?: Function}, protection?: object|null, mirrors?: object|null, declaredDebt?: object|null}} [args]
 * @returns {Promise<{state: string, detail: string, reads: object[], items: object[], labels: string[], excluded: object}>}
 */
export async function readOpenDebt({
  cwd = REPO_ROOT,
  env = process.env,
  deps = {},
  protection = null,
  mirrors = null,
  declaredDebt = null,
} = {}) {
  const {
    list = listIssuesByLabel,
    now = () => Date.now(),
    githubChannel = githubReadConfig,
  } = deps
  const reads = []
  const items = []

  for (const forge of DEBT_FORGES) {
    const subjects = DEBT_SUBJECTS.filter((s) => s.forges.includes(forge))
    if (subjects.length === 0) continue
    const labels = subjects.map((s) => s.label)
    // Só o GitHub tem dois canais (a API e o `gh`): a forja lê pela API de
    // issues dela, sempre, e declarar um "canal" ali seria inventar diferença.
    const channel = forge === "github" ? githubChannel({ env }) : null

    let listed
    try {
      listed = []
      for (const subject of subjects) {
        listed.push({
          subject,
          issues: (await list({ forge, label: subject.label, env, cwd })) ?? [],
        })
      }
    } catch (err) {
      // NÃO PODER LER NÃO É EVIDÊNCIA: é ausência de prova. O doctor diz isso com
      // todas as letras em vez de presumir "sem dívida" — que é a falsa segurança
      // que ele existe para não produzir.
      //
      // A mensagem vira UMA LINHA: o erro do `gh`/da API vem com quebras ("...\n
      // Alternatively, populate...") e, cru, partiria o relatório no meio de uma
      // frase — o log do doctor é lido em terminal e colado em issue.
      const why = String(err?.message ?? err)
        .replace(/\s+/g, " ")
        .trim()
      reads.push({
        forge,
        labels,
        state: "unread",
        via: null,
        open: 0,
        foreign: 0,
        // A mensagem do erro já NOMEIA os dois canais e o que falta em cada um
        // (é construída lá, onde a regra vive) — aqui não há segunda versão dela.
        detail: `a dívida aberta no ${forge} NÃO foi lida: ${why}`,
      })
      continue
    }

    let open = 0
    let foreign = 0
    const nowMs = now()
    for (const { subject, issues } of listed) {
      const ours = []
      const alien = []
      for (const issue of issues) {
        // O MARCADOR, e não a label: label é etiqueta de triagem — alguém pode
        // aplicá-la numa issue alheia, e lê-la como dívida NOSSA seria inventar um
        // alerta que nenhum publicador abriu (o mesmo critério do fechamento
        // automático, pelo mesmo motivo).
        if (issueHasAnyMarker(issue, subject.markerId)) ours.push(debtIssue(issue, nowMs))
        else alien.push({ number: issue?.number ?? null, title: issue?.title ?? "" })
      }
      if (ours.length === 0 && alien.length === 0) continue
      const staleness = debtStaleness(subject, forge, { protection, mirrors, declaredDebt })
      open += ours.length + alien.length
      foreign += alien.length
      items.push({
        forge,
        label: subject.label,
        markerId: subject.markerId,
        subject: subject.subject,
        ours: ours.length,
        foreign: alien.length,
        open: ours.length + alien.length,
        issues: ours,
        stale: staleness.stale,
        staleDetail: staleness.detail,
        detail: describeOpenDebt({ forge, subject, ours, alien, staleness }),
      })
    }

    reads.push({
      forge,
      labels,
      state: "read",
      via: channel?.via ?? null,
      open,
      foreign,
      detail:
        (open === 0
          ? `nenhuma dívida aberta (labels: ${labels.join(", ")})`
          : `${open} dívida(s) ABERTA(S) nas labels ${labels.join(", ")}`) +
        (channel ? ` — lida por ${describeGithubRead(channel)}` : ""),
    })
  }

  const read = reads.filter((r) => r.state === "read")
  const unread = reads.filter((r) => r.state !== "read")
  const state =
    read.length === 0
      ? "unavailable"
      : unread.length > 0
        ? "partial"
        : items.length > 0
          ? "open"
          : "clear"
  const detail =
    state === "clear"
      ? `nenhuma dívida aberta nas labels ${DEBT_SUBJECTS.map((s) => s.label).join(", ")}`
      : state === "open"
        ? `${items.length} assunto(s) com dívida ABERTA no board`
        : state === "partial"
          ? `lida no ${read.map((r) => r.forge).join(" e ")}; NÃO lida no ${unread.map((r) => r.forge).join(" e ")}`
          : `nenhuma forja pôde ser lida (${unread.map((r) => r.forge).join(", ")})`

  // FECHAMENTOS SILENCIOSOS: issues que o publicador tentou fechar mas
  // ainda estão abertas. O doctor surfacea como fato próprio — sem isso,
  // um fechamento que não pegou deixaria a dívida aberta sem ninguém saber,
  // e o doctor diria "pronta" quando a dívida ainda vive.
  const staleClosures = readStaleClosures()
  if (staleClosures.length > 0) {
    for (const sc of staleClosures) {
      // Remove registros cuja issue já não está aberta
      const isOpen = items.some(
        (item) => item.number === sc.issueNumber && item.forge === sc.publisher,
      )
      if (!isOpen) {
        clearStaleClosure(sc.publisher, sc.issueNumber)
      } else {
        const staleDetail = `fechamento silencioso detectado: o publicador '${sc.publisher}' tentou fechar a issue #${sc.issueNumber} ${sc.count} vez(es) desde ${sc.detectedAt} mas ela continua aberta`
        items.push({
          forge: sc.publisher,
          label: "stale-closure",
          markerId: null,
          subject: `fechamento silencioso: issue #${sc.issueNumber} deveria ter sido fechada pelo publicador '${sc.publisher}' mas ainda está aberta (${sc.count} tentativa(s) desde ${sc.detectedAt})`,
          issues: [
            {
              number: sc.issueNumber,
              title: "",
              age: 0,
              detail: staleDetail,
            },
          ],
          detail: staleDetail,
        })
      }
    }
  }

  return {
    state,
    detail,
    reads,
    items,
    labels: DEBT_SUBJECTS.map((s) => s.label),
    excluded: DEBT_EXCLUDED,
  }
}

/**
 * A INTERPOLAÇÃO do compose da forja: o que o `docker compose config` resolve
 * para o label do runner (invariante 7 do `check:registry-source`).
 *
 * POR QUE É UM FATO DO VEREDITO: a seção 3 mostra que a tag existe no registry,
 * e a seção 4 que a subida depende dela. Nenhuma das duas lê o que o compose
 * REALMENTE pede — um `${BUN_VERSIO}` (typo) resolve para string vazia e um
 * `${BUN_VERSION:-1.4.0}` [divergente] resolve para um literal: nos dois casos a tag do
 * registry pode até existir, e o runner registra/puxa OUTRA imagem.
 *
 * `state: 'unavailable'` (sem docker/compose, sem env) NÃO falha aqui — vira
 * "não provado", a mesma regra do resto do doctor.
 *
 * A comparação HOST × TEMPLATE (invariante 7b) viaja como fato PRÓPRIO
 * (`hostCompare`): "conferido e em sincronia" não pode aparecer igual a "não
 * havia o que conferir".
 *
 * @param {{cwd?: string, hostEnv?: string|null, deps?: {check?: (args: {cwd?: string, hostEnv?: string|null}) => {state: string, violations?: string[], detail: string, hostCompare?: {state: string, detail: string}}}}} [args]
 */
export async function readComposeInterpolation({
  cwd = REPO_ROOT,
  hostEnv = null,
  deps = {},
} = {}) {
  const { check = checkComposeInterpolation } = deps
  try {
    const res = check({ cwd, hostEnv })
    return {
      state: res.state,
      violations: res.violations ?? [],
      detail: res.detail,
      // A comparação HOST × TEMPLATE é um fato PRÓPRIO: "conferido e em
      // sincronia" não pode aparecer igual a "não havia o que conferir".
      hostCompare: res.hostCompare ?? {
        state: "absent",
        detail: "a comparacao host x template nao devolveu estado",
      },
    }
  } catch (err) {
    return {
      state: "unavailable",
      violations: [],
      detail: `a interpolacao do compose nao pode ser avaliada: ${err?.message ?? String(err)}`,
      hostCompare: {
        state: "absent",
        detail: `a interpolacao nao pode ser avaliada: ${err?.message ?? String(err)}`,
      },
    }
  }
}

/** O comando do operador que responde — e cura — a pergunta do pré-requisito 0. */
export const ENV_MIRROR_CHECK = "bun run env-mirror:check"

/**
 * O PRÉ-REQUISITO 0 do bring-up como FATO PRÓPRIO — e DERIVADO, nunca remedido.
 *
 * O `deploy/gitea-up.sh` RECUSA a subida antes de tudo quando o env do host não
 * espelha o template comitado, e esse pré-requisito existe porque o
 * `ensure-runner-image` resolve a imagem DESTE arquivo: com um env divergente a
 * subida garantiria a imagem ERRADA. Quem responde essa pergunta já foi medido —
 * é a metade host × template da interpolação do compose
 * (`compose.hostCompare`), que usa a MESMA função do comando que o operador roda
 * (`compareEnvMirrorDeclarations`, a fonte única da regra).
 *
 * POR QUE DERIVAR EM VEZ DE SONDAAR DE NOVO: medir a mesma pergunta duas vezes é
 * como duas verdades começam a divergir (o repo já pagou esse preço uma vez, e o
 * comentário dos espelhos no `diagnose` registra isso). O que faltava não era a
 * medição — era o **NOME** do pré-requisito, o **COMANDO** que o reproduz e o
 * **REMÉDIO**, e é exatamente isso que este fato acrescenta ao veredito.
 *
 * Os estados são os do resto do doctor: `proven` (a subida passa), `violated`
 * (a subida RECUSA), `absent` (não há o env do host NESTE checkout — falta de
 * prova, nunca prova de falha), `skipped` (a seção que mede foi pulada) e
 * `not-applicable` (não há stack da forja neste checkout: nada a exigir).
 *
 * @param {{state?: string, violations?: string[], detail?: string, hostCompare?: {state?: string, detail?: string, host?: string|null, template?: string|null}}} [compose]
 * @returns {{state: string, detail: string, command: string, remedies: string[], refuses: boolean, readsFrom: string}}
 */
export function deriveBringUpEnv(compose = {}) {
  const hc = compose?.hostCompare ?? {}
  const host = hc.host ?? null
  const template = hc.template ?? GITEA_ENV_MIRROR
  // Quando a comparação NOMEIA os dois arquivos, o comando é o que os reproduz;
  // quando não (o env do host não existe aqui), o comando é o de DESCOBERTA — o
  // que o operador roda ONDE o arquivo existe.
  const command = host
    ? `${ENV_MIRROR_CHECK} --host ${host} --template ${template}`
    : ENV_MIRROR_CHECK
  const remedies = [
    `${ENV_MIRROR_CHECK} --patch   # ve o diff que reconcilia o host`,
    `${ENV_MIRROR_CHECK} --fix     # aplica (atomico; nunca toca no segredo)`,
  ]
  const base = { command, remedies, refuses: false, readsFrom: "compose.hostCompare" }

  // Sem a stack da forja neste checkout não há pré-requisito a exigir: o
  // "ausente" aqui é do ARQUIVO da stack, não do env do host (e cobrar o env de
  // quem não tem a stack encheria a lista de pendências com um problema que não
  // existe).
  if (!compose || compose.state === "absent" || compose.state === undefined) {
    return {
      ...base,
      state: "not-applicable",
      detail: `nao ha a stack da forja neste checkout (${GITEA_COMPOSE}) — o pre-requisito 0 nao existe aqui`,
    }
  }

  if (hc.state === "in-sync") {
    return {
      ...base,
      state: "proven",
      detail: `o env do host espelha o template comitado: a subida do ${GITEA_BRING_UP} passa pelo pre-requisito 0 (${hc.detail ?? "em sincronia"})`,
    }
  }

  if (hc.state === "diverged") {
    return {
      ...base,
      state: "violated",
      refuses: true,
      detail: `o env do host NAO espelha o template comitado: o ${GITEA_BRING_UP} RECUSA a subida (pre-requisito 0) — e o ensure resolveria a imagem do arquivo divergente. Comando: ${command}`,
    }
  }

  if (hc.state === "absent") {
    return {
      ...base,
      state: "absent",
      detail: `o PRE-REQUISITO 0 do ${GITEA_BRING_UP} nao foi coberto: o env do HOST nao foi comparado com o template comitado (${hc.detail ?? "o arquivo nao existe neste checkout"}). Comando: ${command} — rode-o no host onde o arquivo existe (${ENV_MIRROR_SCRIPT})`,
    }
  }

  if (hc.state === "skipped") {
    return {
      ...base,
      state: "skipped",
      detail: `o pre-requisito 0 nao foi medido: ${hc.detail ?? "a secao que o mede foi pulada"}`,
    }
  }

  return {
    ...base,
    state: "unavailable",
    detail: `o PRE-REQUISITO 0 do ${GITEA_BRING_UP} nao foi coberto: a comparacao host x template nao devolveu estado (${hc.detail ?? "sem detalhe"}). Comando: ${command}`,
  }
}

/**
 * Executa a bateria de gates da forja SEQUENCIALMENTE (caminho síncrono).
 *
 * Continua existindo porque é o contrato de quem injeta um `run` síncrono (os
 * testes e qualquer chamada que precise de determinismo de ordem de chamada).
 * A produção usa `runGatesConcurrent`.
 */
export function runGuards(gates, { cwd = REPO_ROOT, timeoutS = 120, run } = {}) {
  return gates.map((gate) => runGate(gate, { cwd, timeoutS, run: run ?? spawnSync }))
}

/**
 * Quantos gates rodam ao mesmo tempo por padrão.
 *
 * POR QUE NÃO `cpus()`: os gates são processos `bun`/`node` que já usam vários
 * cores cada um; abrir um por core satura a máquina e faz cada um ficar MAIS
 * lento (o wall time total piora). Quatro é conservador o bastante para caber
 * num runner compartilhado e já derruba o tempo da bateria (o teto passa a ser o
 * gate mais lento, não a soma).
 */
export const DEFAULT_GATE_CONCURRENCY = 4

/**
 * Executa a bateria de gates com PARALELISMO LIMITADO.
 *
 * POR QUE É SEGURO: todos os gates da bateria são de VERIFICAÇÃO
 * (`gateCommand` recusa modo de efeito) e não têm ordem entre si — a bateria é
 * uma lista de perguntas independentes, não um pipeline. Nada aqui muda o
 * SIGNIFICADO de um gate: o resultado volta na ORDEM DA BATERIA
 * (`results[i] = ...`), o shape é o mesmo do caminho síncrono
 * (`shapeGateResult`) e um gate que estoura NÃO derruba os outros — ele vira
 * `code: null` ("não verificado"), que é o que o veredito já sabia ler.
 *
 * O `run` INJETADO desvia para o caminho sequencial de propósito: um dublê é
 * síncrono e determinístico, e paralelizá-lo não traria ganho nenhum — só
 * mudaria a ordem de chamada que os testes observam.
 *
 * @param {{label: string, command: string|null}[]} gates
 * @param {{cwd?: string, timeoutS?: number, run?: Function, concurrency?: number, gateAsync?: Function}} [deps]
 * @returns {Promise<{gate: string, code: number|null, seconds: number, error?: string, tail?: string}[]>}
 */
export async function runGatesConcurrent(
  gates,
  {
    cwd = REPO_ROOT,
    timeoutS = 120,
    run,
    concurrency = DEFAULT_GATE_CONCURRENCY,
    gateAsync = runGateAsync,
  } = {},
) {
  if (run) return runGuards(gates, { cwd, timeoutS, run })

  const results = new Array(gates.length)
  const workers = Math.max(1, Math.min(concurrency, gates.length))
  let next = 0
  const worker = async () => {
    for (;;) {
      const i = next
      next += 1
      if (i >= gates.length) return
      try {
        results[i] = await gateAsync(gates[i], { cwd, timeoutS })
      } catch (err) {
        // Um gate que estoura (spawn do interpretador, dublê) não pode derrubar
        // a bateria inteira: vira NÃO verificado, como qualquer falha de exec.
        results[i] = {
          gate: gates[i].label,
          code: null,
          seconds: 0,
          error: `não foi possível executar o gate: ${err?.message ?? String(err)}`,
        }
      }
    }
  }
  await Promise.all(Array.from({ length: workers }, worker))
  return results
}

// ═══════════════════════════════════════════════════════════════════════════
// 4c. A dívida DECLARADA (a IDADE das isenções)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A IDADE das isenções declaradas — o quanto falta para a decisão vencer.
 *
 * POR QUE ISTO É UM FATO DO VEREDITO: as quatro listas do repositório
 * (`OUT_OF_SCOPE_ALLOWLIST`, `THIRD_PARTY_ALLOWLIST`, `ALLOWLIST` do
 * `check-unused-deps` e o baseline do SIGPIPE) são decisões escritas de "não
 * consertar agora", com DATA e JANELA de revisão. O canal que as revisa é o job
 * semanal (`--review`), e é lá que a decisão vencida vira VIOLAÇÃO. O doctor mede
 * a forja inteira e não sabia NADA disso: uma isenção de 179 dias e uma que
 * venceu ontem davam o mesmo "PRONTA", e o vencimento só existia como run
 * vermelho de um cron.
 *
 * A MEDIÇÃO é a do módulo compartilhado (`declared-debt.mjs`), que lê as listas
 * dos DONOS delas e aplica a regra do `allowlist-review.mjs` — a mesma que os
 * guards usam. Este fato NÃO reimplementa janela, data nem leitura: duas contas
 * para a mesma pergunta divergem no primeiro ajuste feito de um lado só.
 *
 * PESO (e por quê):
 *   - `invalid` (decisão SEM registro: data ausente/impossível) BLOQUEIA — uma
 *     isenção sem data não tem como envelhecer, e é violação nos dois modos nos
 *     próprios guards (fail-closed). Aqui o veredito diz o mesmo, com o nome da
 *     lista;
 *   - `aged` (passou a janela) NÃO PRONTA (INDETERMINADA): a isenção venceu e
 *     ninguém a revisou, mas uma data vencida não prova que a forja falha em
 *     bloquear o merge — bloquear transformaria "alguém esqueceu de reafirmar"
 *     em "não confie o merge", que é o peso errado (mesma régua da dívida do
 *     board). O canal de cobrança é a ISSUE do publicador
 *     (`scripts/declared-debt-issue.mjs`), não o veredito;
 *   - `unread` (a lista não pôde ser lida) é ausência de prova: nunca "sem
 *     dívida", nunca "pronta" — é o mesmo estado que o doctor usa para o resto.
 *
 * @param {{cwd?: string, deps?: {collect?: Function, now?: number}}} [args]
 *
 * O retorno do caminho de PROGRAMA (o coletor lançou) é o MESMO shape, com
 * `error` dito: quem não conseguiu medir tem de poder nomear o motivo em vez de
 * devolver um fato vazio, que se leria como "nenhuma lista declarada".
 * @returns {{state: string, sources: Array<{
 *   id: string, listName: string, owner: string, kind?: string, remedy?: string,
 *   reviewDays?: number|null, where?: string, state: string, total: number,
 *   declaredAt?: string|null, reason?: string|null,
 *   aged: Array<{id: string, addedAt?: string, days: number, limit?: number}>,
 *   invalid: Array<{id: string, why: string}>,
 *   oldest: {id: string, addedAt: string, days: number}|null,
 *   detail: string,
 * }>, aged: object[], invalid: object[], unread: object[], total: number, error?: string}}
 */
export function readDeclaredDebt({ cwd = REPO_ROOT, deps = {} } = {}) {
  const collect = deps.collect ?? collectDeclaredDebt
  try {
    return collect({ root: cwd, ...(deps.now === undefined ? {} : { now: deps.now }) })
  } catch (err) {
    // O coletor NUNCA lança por lista ilegível (isso vira `unread` na fonte);
    // isto aqui é a rede para um erro de PROGRAMA, que não pode virar "sem
    // dívida" — quem não conseguiu medir não diz que está tudo bem.
    return {
      state: "unread",
      sources: [],
      aged: [],
      invalid: [],
      unread: [],
      total: 0,
      error: String(err?.message ?? err),
    }
  }
}

/**
 * O que a dívida DECLARADA acrescenta ao veredito como AUSÊNCIA DE PROVA: as
 * decisões vencidas (uma linha por lista, com a idade e o remédio) e as listas
 * que não puderam ser lidas.
 *
 * Uma linha por LISTA (e não um agregado): quem lê precisa saber QUAL decisão
 * reafirmar — "há dívida vencida" mandaria procurar em quatro lugares.
 *
 * @param {object|undefined} fato
 * @returns {string[]}
 */
export function declaredDebtUnknowns(fato) {
  if (!fato || fato.state === "proven" || fato.state === "sem-divida") return []
  const unknowns = []
  for (const fonte of fato.sources) {
    if (fonte.state === "aged") {
      const [maisVelha] = [...fonte.aged].sort((a, b) => b.days - a.days)
      unknowns.push(
        `a dívida DECLARADA venceu a janela de revisão: ${textoFonteVencida(fonte)} ` +
          `(vencida há ${maisVelha.days - maisVelha.limit} dia(s))`,
      )
    }
    if (fonte.state === "unread") {
      unknowns.push(
        `a dívida DECLARADA em '${fonte.listName}' NÃO pôde ser lida: ${fonte.detail ?? "sem detalhe"} — não ler não é o mesmo que não haver`,
      )
    }
  }
  // Um erro de PROGRAMA no coletor (sem fontes medidas) tem de aparecer: um fato
  // vazio pareceria "nenhuma lista declarada", que é uma afirmação forte demais.
  if (fato.sources.length === 0 && fato.error) {
    unknowns.push(`a dívida DECLARADA não foi coletada: ${fato.error}`)
  }
  return unknowns
}

/**
 * O que a dívida DECLARADA tem de BLOQUEANTE: uma decisão sem registro — o
 * fail-closed dos próprios guards, dito no veredito.
 *
 * @param {object|undefined} fato
 * @returns {string[]}
 */
export function declaredDebtBlockers(fato) {
  if (!fato || fato.state !== "invalid") return []
  return fato.sources
    .filter((fonte) => fonte.state === "invalid")
    .map(
      (fonte) =>
        `a dívida DECLARADA em '${fonte.listName}' está SEM REGISTRO (${fonte.invalid
          .map((i) => `${i.id}: ${i.why}`)
          .join(
            "; ",
          )}): uma isenção sem data não tem como envelhecer, então não há janela que a revise`,
    )
}

// ═══════════════════════════════════════════════════════════════════════════
// 4a. A herança de shell dos workflows
//
// A PROMESSA QUE VIVIA SÓ NO GUARD: o `check-pipefail-sigpipe` diz, no relatório
// dele, de ONDE vem o shell de cada passo — do `shell:` do próprio passo, do
// `defaults:` do JOB, do `defaults:` do ARQUIVO, ou do shell default do RUNNER
// (a premissa `bash -e`, que não é deste repositório). E reprova a declaração de
// `defaults:` que LIGA o pipefail: ela reclassifica todos os passos do escopo
// numa linha, sem que um passo sequer mude no diff.
//
// Aqui essa medição entra no veredito de prontidão como FATO PRÓPRIO, por
// WORKFLOW — e ela é a MESMA (`workflowShellInheritance`, do guard: o `scanRoot`
// a chama item a item). O que o fato acrescenta ao veredito não é uma segunda
// leitura do YAML (duas divergem no primeiro ajuste): é a conta NOMEADA, passo a
// passo, que faz do pré-requisito uma cobrança. Ele roda ATÉ no perfil `--ci` —
// é leitura de checkout —, e é justamente ali que ele mais importa: no PR a
// bateria de guards está pulada, e sem este fato uma premissa mudada viajaria
// em silêncio até o cron semanal.
// ═══════════════════════════════════════════════════════════════════════════

/** Onde a declaração de `defaults:` vive, em prosa (a MESMA nos dois canais). */
export function describeShellScope({ scope, job }) {
  return scope === "workflow" ? "workflow inteiro" : `job \`${job ?? "?"}\``
}

/**
 * A HERANÇA DE SHELL dos workflows do repositório, como fato do relatório.
 *
 * Os estados são os do guard, ditos no vocabulário do doctor:
 *   - `violated` — há uma declaração que NÃO SE PODE CONFIAR: a que LIGA o
 *     pipefail (a premissa mudou numa linha, o gate a reprova) ou a que o guard
 *     não consegue LER (forma inline — não ler não é o mesmo que não haver, e o
 *     fail-closed das duas é exit 1 lá). BLOQUEIA;
 *   - `unread`  — a lista de workflows ou um arquivo não pôde ser lido: AUSÊNCIA
 *     DE PROVA (INDETERMINADA), nunca "o repositório não declara shell default
 *     nenhum";
 *   - `proven`  — todos os workflows lidos e nenhuma declaração que ligue o
 *     pipefail. Diz a CONTA por fonte, que é o que o veredito passa a cobrir.
 *
 * @param {{cwd?: string, deps?: {list?: Function, readFile?: Function}}} [options]
 * @returns {{state: string, workflows: object[], totals: object, violations: string[], detail: string, error: string|null}}
 */
export function readShellInheritance({ cwd = REPO_ROOT, deps = {} } = {}) {
  const list = deps.list ?? ((root) => allWorkflowFiles(root))
  const read = deps.readFile ?? ((path) => readFileSync(path, "utf8"))
  const vazio = {
    state: "proven",
    workflows: [],
    totals: {
      workflows: 0,
      steps: 0,
      corpoVazio: 0,
      noPasso: 0,
      porDefaultDoJob: 0,
      porDefaultDoArquivo: 0,
      peloRunner: 0,
      comPipefail: 0,
      premissas: 0,
      ilegiveis: 0,
      unread: 0,
    },
    violations: [],
    detail: "0 workflow(s) de forja neste checkout",
    error: null,
  }
  let arquivos
  try {
    arquivos = list(cwd)
  } catch (err) {
    // Um erro de PROGRAMA não pode virar "sem workflow": quem não conseguiu
    // listar não diz que está tudo bem.
    return {
      ...vazio,
      state: "unread",
      detail: "a lista de workflows não foi lida",
      error: String(err?.message ?? err),
    }
  }

  const workflows = []
  const violations = []
  const totals = { ...vazio.totals, workflows: arquivos.length }
  for (const w of arquivos) {
    let content
    try {
      content = read(join(cwd, w.path))
    } catch (err) {
      totals.unread++
      workflows.push({
        file: w.path,
        state: "unread",
        detail: `o arquivo não foi lido: ${String(err?.message ?? err)}`,
        counts: null,
        premissas: [],
        ilegiveis: [],
      })
      continue
    }
    const { declaracoes, counts } = workflowShellInheritance(String(content))
    const premissas = declaracoes
      .filter((d) => !d.unparsed && d.pipefail)
      .map((d) => ({
        scope: d.scope,
        job: d.job,
        shell: d.shell,
        line: d.line,
        passos: d.passos,
      }))
    const ilegiveis = declaracoes
      .filter((d) => d.unparsed === true)
      .map((d) => ({ scope: d.scope, job: d.job, shell: d.shell, line: d.line }))
    for (const p of premissas) {
      violations.push(
        `${w.path}:${p.line} \`defaults:\` (${describeShellScope(p)}) declara \`shell: ${p.shell}\`, que LIGA o pipefail para ${p.passos} passo(s) sem \`shell:\` — a premissa do escopo inteiro mudou numa linha, sem o passo mudar no diff`,
      )
    }
    for (const d of ilegiveis) {
      violations.push(
        `${w.path}:${d.line} \`defaults:\` (${describeShellScope(d)}) está em FORMA INLINE (\`${d.shell}\`) — a premissa do shell default NÃO foi lida (escreva em bloco: \`defaults:\` → \`run:\` → \`shell:\`)`,
      )
    }
    totals.steps += counts.total
    // O `run:` VAZIO é declarado e NÃO julgado (nada executa): a conta viaja com
    // o resto da origem do shell, para a prontidão não omitir a categoria que o
    // guard NOMEIA — a mesma disciplina de não varrer menos do que parece.
    totals.corpoVazio += counts.corpoVazio
    totals.noPasso += counts.noPasso
    totals.porDefaultDoJob += counts.porDefaultDoJob
    totals.porDefaultDoArquivo += counts.porDefaultDoArquivo
    totals.peloRunner += counts.peloRunner
    totals.comPipefail += counts.comPipefail
    totals.premissas += premissas.length
    totals.ilegiveis += ilegiveis.length
    workflows.push({
      file: w.path,
      state: premissas.length > 0 || ilegiveis.length > 0 ? "violated" : "proven",
      detail:
        premissas.length > 0 || ilegiveis.length > 0
          ? `${premissas.length} declaração(ões) ligando o pipefail, ${ilegiveis.length} ilegível(is)`
          : "nenhuma declaração de `defaults:` que ligue o pipefail",
      counts,
      premissas,
      ilegiveis,
    })
  }

  const state = violations.length > 0 ? "violated" : totals.unread > 0 ? "unread" : "proven"
  const detail =
    `${totals.workflows} workflow(s), ${totals.steps} passo(s): ` +
    `${totals.noPasso} pelo \`shell:\` do passo, ${totals.porDefaultDoJob + totals.porDefaultDoArquivo} por \`defaults:\` do repositório ` +
    `(${totals.porDefaultDoJob} do job, ${totals.porDefaultDoArquivo} do arquivo), ${totals.peloRunner} pelo default do RUNNER ` +
    `(premissa \`bash -e\`, que NÃO é deste repositório); ${totals.comPipefail} passo(s) sob pipefail` +
    (totals.corpoVazio > 0
      ? `; ${totals.corpoVazio} passo(s) com \`run:\` VAZIO (fora do escopo: nada executa)`
      : "")
  return { state, workflows, totals, violations, detail, error: null }
}

/**
 * A PROVA DO BLOQUEIO LOCAL como FATO do relatório — a garantia de que o
 * `pre-commit` recusa um corpo `run:` quebrado no ÍNDICE.
 *
 * POR QUE ISTO VIROU FATO (e não ficou só no teste): a garantia vivia em
 * `src/lib/__tests__/pre-commit-git-commit-blocks.test.ts`, e um teste que só
 * roda em `bun run test` é uma promessa sobre quem lembra de rodá-lo. Aqui o
 * doctor EXECUTA a mesma prova (`proveCommitBlocks`, o mesmo módulo que o teste
 * importa) e publica o desfecho no vocabulário do resto do relatório:
 *
 *   - `proven`      — um `git commit` de verdade com o corpo QUEBRADO no índice é
 *                     recusado E o mesmo commit com o corpo fechado entra (a
 *                     segunda metade é o CONTROLE: sem ela, "não commitou" seria
 *                     indistinguível de um fixture que não sabe commitar);
 *   - `violated`    — o defeito ENTROU no histórico (o hook deixou passar): o
 *                     commit de quem confia no hook carrega o corpo quebrado;
 *   - `unavailable` — não deu para provar (sem `.husky/pre-commit`, sem o fecho do
 *                     guard, sem `node_modules`, sem git/bash) — NUNCA verde.
 *
 * `deps.prove` é o ponto de injeção: o teste mede os TRÊS estados sem depender do
 * hook do checkout (e a prova REAL continua sendo a do default, exercitada pelo
 * teste de integração e pelo próprio doctor).
 *
 * @param {{cwd?: string, deps?: {prove?: (opts: {root: string}) => object}}} [args]
 * @returns {{state: string, detail: string, evidence: object|null, remedies: string[]}}
 */
export function readPreCommitBlock({
  cwd = REPO_ROOT,
  deps = /** @type {{prove?: (opts: {root: string}) => any}} */ ({}),
} = {}) {
  const prove = deps.prove ?? ((opts) => proveCommitBlocks({ root: opts.root }))
  try {
    const r = prove({ root: cwd })
    if (r === null || r === undefined || typeof r.state !== "string") {
      return {
        state: "unavailable",
        detail: "a prova do bloqueio local nao devolveu estado (nem 'proven', nem 'violated')",
        evidence: null,
        remedies: [],
      }
    }
    return {
      state: r.state,
      detail: r.detail ?? "sem detalhe",
      evidence: r.evidence ?? null,
      remedies: r.remedies ?? [],
    }
  } catch (err) {
    return {
      state: "unavailable",
      detail: `a prova do bloqueio local nao pode rodar: ${err instanceof Error ? err.message : String(err)}`,
      evidence: null,
      remedies: [],
    }
  }
}

/**
 * A PROVA DO BLOQUEIO DO PUSH como FATO do relatório — o OUTRO ELO do contrato
 * local: a garantia de que o `pre-push` recusa um push cuja ÁRVORE está vermelha,
 * sem deixar OBJETO NENHUM no remoto.
 *
 * POR QUE ISTO VIROU FATO (e não ficou só no teste): a garantia vivia em
 * `src/lib/__tests__/pre-push-git-push-blocks.test.ts`, e um teste que só roda em
 * `bun run test` é uma promessa sobre quem lembra de rodá-lo. Aqui o doctor
 * EXECUTA a mesma prova (`provePushBlocks`, o mesmo módulo que o teste importa)
 * e publica o desfecho no vocabulário do resto do relatório.
 *
 * POR QUE É UM FATO PRÓPRIO (e não uma linha do fato do pre-commit): os dois elos
 * medem PROMESSAS DIFERENTES num lugar diferente. O commit mede "nenhum objeto de
 * COMMIT foi criado"; o push mede "nenhum OBJETO de qualquer tipo chegou ao
 * REMOTO" — porque o git consulta o remoto ANTES do hook e só manda o pack
 * DEPOIS dele. Um hook de push que passa não deixa rastro nenhum no banco local;
 * o que ele promete (ou não) só existe do outro lado.
 *
 *   - `proven`      — um `git push` de verdade com a árvore VERMELHA é recusado
 *                     (zero ref e zero objeto no remoto bare) E o mesmo push com
 *                     a árvore verde CHEGA (a segunda metade é o CONTROLE: sem
 *                     ela, "nada chegou" seria indistinguível de um fixture que
 *                     não sabe empurrar);
 *   - `violated`    — o defeito CHEGOU ao remoto (o hook deixou passar): o commit
 *                     de quem confia no hook já está na forja;
 *   - `unavailable` — não deu para provar (sem `.husky/pre-push`, sem `bun`, sem
 *                     git/bash) — NUNCA verde.
 *
 * `deps.prove` é o ponto de injeção: o teste mede os TRÊS estados sem depender do
 * hook do checkout (e a prova REAL continua sendo a do default, exercitada pelo
 * teste de integração e pelo próprio doctor).
 *
 * @param {{cwd?: string, deps?: {prove?: (opts: {root: string}) => object}}} [args]
 * @returns {{state: string, detail: string, evidence: object|null, remedies: string[]}}
 */
export function readPrePushBlock({
  cwd = REPO_ROOT,
  deps = /** @type {{prove?: (opts: {root: string}) => any}} */ ({}),
} = {}) {
  const prove = deps.prove ?? ((opts) => provePushBlocks({ root: opts.root }))
  try {
    const r = prove({ root: cwd })
    if (r === null || r === undefined || typeof r.state !== "string") {
      return {
        state: "unavailable",
        detail: "a prova do bloqueio do push nao devolveu estado (nem 'proven', nem 'violated')",
        evidence: null,
        remedies: [],
      }
    }
    return {
      state: r.state,
      detail: r.detail ?? "sem detalhe",
      evidence: r.evidence ?? null,
      remedies: r.remedies ?? [],
    }
  } catch (err) {
    return {
      state: "unavailable",
      detail: `a prova do bloqueio do push nao pode rodar: ${err instanceof Error ? err.message : String(err)}`,
      evidence: null,
      remedies: [],
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// O CONTRATO LOCAL, EM UM FATO SÓ
// ═══════════════════════════════════════════════════════════════════════════
//
// O QUE ESTE FATO CARREGA — e por que ele é UM:
//
//   1. os DOIS elos EXECUTADOS: o `git commit` de verdade com o corpo `run:`
//      quebrado no ÍNDICE (tem de ser RECUSADO, e o controle com o corpo fechado
//      tem de ENTRAR) e o `git push` de verdade com a ÁRVORE vermelha (tem de ser
//      RECUSADO sem deixar um objeto sequer no remoto bare, e o controle verde tem
//      de CHEGAR);
//   2. o que cada hook RODA: todo comando que o `.husky/pre-commit` e o
//      `.husky/pre-push` executam — o do próprio arquivo e o de dentro dos scripts
//      de shell que eles chamam (a DESCIDA) — com o desfecho de cada um
//      (`resolvido` / `indeterminado` DECLARADO / `violacao`);
//   3. o LIMITE do gate local, MEDIDO: o `git push --no-verify` contorna o hook
//      (a árvore vermelha CHEGA ao remoto, com o hook sem rodar) e quem barra o
//      defeito depois é o CI — o comando do gate reprova o conteúdo que chegou,
//      num CLONE do remoto. É a parte que impede o veredito de sugerir que "o
//      pre-push está provado" equivale a "a árvore vermelha não chega a main".
//
// O ASSUNTO É UM SÓ: "o que o contrato local promete, na máquina de quem commita
// e de quem empurra". Antes ele vivia em TRÊS lugares — dois fatos de topo
// (`preCommitBlock` e `prePushBlock`, um por elo) e o contrato dos comandos, que
// só existia no gate (`check-hook-commands`) e nem era declarado na prontidão.
// Dois lugares para o mesmo assunto é o que produz o pior veredito possível: o
// relatório dizendo uma coisa enquanto a bateria diz outra, sem ninguém para
// arbitrar. Agora o veredito consulta ESTE fato, e só ele.
//
// A RÉGUA NÃO FOI REESCRITA: o item 2 é lido pelo `analyze` do
// `check-hook-commands` (importado) — o dono da régua. O doctor não tem uma
// segunda lista de "comandos que os hooks rodam"; ele tem a MESMA.
//
// O QUE MUDA NO VEREDITO (e é a razão de o fato ser um):
//   - `violated` em qualquer das partes (um elo que deixou passar, ou um comando
//     do hook que NÃO resolve — um passo que nunca roda) BLOQUEIA;
//   - `unavailable` e `skipped` são FALTA DE PROVA nomeada: `unavailable` no
//     recorte `--ci` é elo quebrado (lá os três itens só precisam de git, bash,
//     bun e do próprio checkout), e fora dele é INDETERMINADA;
//   - ausente do relatório NÃO é verde (a mesma disciplina do guard de recursão,
//     da herança de shell e da dívida declarada).

/** Os elos do contrato local, na ordem em que o relatório os lê. */
export const LOCAL_LINKS = ["pre-commit", "pre-push"]

/** Como o veredito escreve o nome de cada elo (as mensagens já existiam assim). */
const LOCAL_LINK_FACE = { "pre-commit": "PRE-COMMIT", "pre-push": "PRE-PUSH" }

/**
 * A SEVERIDADE de cada estado, para o agregado: o estado do fato é o PIOR estado
 * presente em qualquer das partes. `violated` (o contrato quebrou) >
 * `unavailable` (não deu para medir) > `skipped` (pulada por flag, nomeada) >
 * `proven` (medido e de pé).
 */
const LOCAL_STATE_WEIGHT = { violated: 3, unavailable: 2, skipped: 1, proven: 0 }

/**
 * O pior estado entre os das partes — a agregação do fato único.
 *
 * Um estado desconhecido (nem `proven`, nem `skipped`) pesa como `unavailable`:
 * quem inventa um estado não pode ganhar um veredito mais verde do que quem não
 * conseguiu medir.
 *
 * @param {string[]} estados
 * @returns {"violated"|"unavailable"|"skipped"|"proven"}
 */
export function aggregateLocalState(estados) {
  let pior = "proven"
  for (const estado of estados) {
    const peso = LOCAL_STATE_WEIGHT[estado] ?? LOCAL_STATE_WEIGHT.unavailable
    if (peso > (LOCAL_STATE_WEIGHT[pior] ?? 0)) pior = estado
  }
  return /** @type {"violated"|"unavailable"|"skipped"|"proven"} */ (pior)
}

/**
 * O resultado de UM contrato de gate (invariante × job): o estado, o comando que
 * o job tem de rodar, o que cada forja registra e o remédio.
 *
 * Declarado como typedef porque o MESMO shape sai de `readGateContract` (um
 * contrato) e de `readAllGateContracts` (a lista de todos): sem ele, o
 * `@returns` do agregador dizia `object[]` e quem consumia o fato tinha de
 * reconverter o tipo na mão só para ler `state`/`forges`/`detail` — a assinatura
 * mentindo sobre o que ela entrega.
 *
 * @typedef {object} GateContractResult
 * @property {"proven"|"violated"|"unavailable"} state
 * @property {string} jobId
 * @property {string} invariantId
 * @property {string} script
 * @property {string} detail
 * @property {{forge: string, workflow: string, command: string|null,
 *   registered: boolean|null, detail: string}[]} forges
 * @property {string[]} violations
 * @property {string[]} remedies
 */

/**
 * UM comando julgado de um hook (o shape que o `analyze` do `check-hook-commands`
 * entrega e que o relatório imprime: arquivo, linha, programa, a linha inteira e
 * o desfecho com o motivo).
 *
 * @typedef {object} HookCommandLine
 * @property {string} arquivo
 * @property {number} linha
 * @property {string} programa
 * @property {string} comando
 * @property {string} desfecho
 * @property {string} motivo
 */

/**
 * O QUE UM ARQUIVO DE HOOK RODA, com o desfecho agregado — a parte do fato que
 * responde "algum passo deste hook NUNCA roda?".
 *
 * @typedef {object} HookCommandsPart
 * @property {string} state
 * @property {string} detail
 * @property {string|null} elo
 * @property {HookCommandLine[]} commands
 * @property {HookCommandLine[]} unresolved
 * @property {HookCommandLine[]} declared
 * @property {object[]} limits
 * @property {string[]} descended
 */

/**
 * O QUE CADA HOOK RODA — por ARQUIVO de hook, com o desfecho de cada comando.
 *
 * Cobre TODOS os hooks do `.husky/` (não só os dois elos do contrato local): um
 * hook extra que executa um caminho que não existe é o MESMO defeito — um passo
 * que nunca roda em todo commit — e deixá-lo fora seria a cegueira que o gate
 * fechou ao descer nos scripts.
 *
 * A ATRIBUIÇÃO é a regra do próprio gate: o hook é dono do que está no arquivo
 * dele e do que DESCE dele (a cadeia `chamador:linha` em `origem`), e um script
 * alcançado por dois hooks pertence ao primeiro que o alcançou — exatamente como
 * o gate o julga UMA vez. Quando a cadeia de um comando não chega a hook nenhum,
 * ele entra em `unattributed` (declarado, nunca sumido em silêncio).
 *
 * `unavailable` (e não `proven` vazio) quando NADA foi julgado: um hook sem
 * comando julgado é "não consegui ler", nunca "não havia nada a julgar" —
 * fail-closed, a mesma lei do resto do repositório.
 *
 * @param {{cwd?: string, deps?: {analyze?: (opts: {root: string}) => object}}} [args]
 * @returns {{state: string, detail: string, hooks: Record<string, HookCommandsPart>, unattributed: object[]}}
 */
export function readHookCommands({ cwd = REPO_ROOT, deps = {} } = {}) {
  // `typeof` e não `??`: o default do doctor para as deps é `{}`, e um objeto
  // vazio NÃO é nullish — `deps.analyze ?? fallback` entregaria `{}` e a chamada
  // morreria com "analyze is not a function" (foi o que aconteceu na primeira
  // rodada). A régua real é o default, sempre.
  const analyze =
    typeof deps.analyze === "function"
      ? deps.analyze
      : (opts) => analyzeHookCommands({ root: opts.root })
  const indisponivel = (motivo) => ({
    state: "unavailable",
    detail: motivo,
    hooks: {},
    unattributed: [],
  })

  let report
  try {
    report = analyze({ root: cwd })
  } catch (err) {
    return indisponivel(
      `o contrato dos comandos dos hooks nao pode ser lido: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  if (!report || report.infra) {
    return indisponivel(
      "o contrato dos comandos dos hooks nao pode ser lido: `.husky/` (ou os `scripts` do package.json) ausente ou ilegivel — NADA foi julgado (nao conseguir ler nunca e 'nao havia o que julgar')",
    )
  }

  const arquivos = report.hooks ?? []
  // De qual ARQUIVO de hook cada arquivo julgado desceu (os hooks nascem donos de si).
  const dono = new Map(arquivos.map((rel) => [rel, rel]))
  const porArquivo = new Map(arquivos.map((rel) => [rel, []]))
  const unattributed = []
  for (const comando of report.comandos ?? []) {
    const daCadeia = dono.has(comando.arquivo)
      ? dono.get(comando.arquivo)
      : dono.get((comando.origem ?? "").split(":")[0])
    if (daCadeia === undefined || daCadeia === null) {
      unattributed.push({
        arquivo: comando.arquivo,
        linha: comando.linha,
        origem: comando.origem ?? "",
      })
      continue
    }
    dono.set(comando.arquivo, daCadeia)
    porArquivo.get(daCadeia)?.push(comando)
  }

  const hooks = Object.fromEntries(
    arquivos.map((rel) => {
      const comandos = (porArquivo.get(rel) ?? []).map((c) => ({
        arquivo: c.arquivo,
        linha: c.linha,
        programa: c.programa,
        comando: [c.programa, ...(c.tokens ?? [])].join(" "),
        desfecho: c.desfecho,
        motivo: c.motivo ?? "",
      }))
      const unresolved = comandos.filter((c) => c.desfecho === "violacao")
      const declared = comandos.filter((c) => c.desfecho === "indeterminado")
      const limits = (report.limites ?? []).filter((l) => dono.get(l.arquivo) === rel)
      const descended = [...new Set(comandos.map((c) => c.arquivo).filter((a) => a !== rel))].sort()
      const state =
        unresolved.length > 0 ? "violated" : comandos.length === 0 ? "unavailable" : "proven"
      const detail =
        state === "violated"
          ? `${unresolved.length} de ${comandos.length} comando(s) NAO resolvem — um passo que nunca roda`
          : state === "unavailable"
            ? `nenhum comando julgado — nao conseguir ler nao e "nao havia o que julgar"`
            : `${comandos.length} comando(s) resolvem (${descended.length} script(s) por descida), ${declared.length} declarado(s) indeterminado(s)`
      return [
        rel,
        {
          state,
          detail,
          elo: LOCAL_LINKS.find((elo) => rel.split("/").pop() === elo) ?? null,
          commands: comandos,
          unresolved,
          declared,
          limits,
          descended,
        },
      ]
    }),
  )

  const partes = Object.values(hooks).map((h) => h.state)
  const state = aggregateLocalState(partes.length > 0 ? partes : ["unavailable"])
  const total = Object.values(hooks).reduce((soma, h) => soma + h.commands.length, 0)
  const naoResolvidos = Object.values(hooks).reduce((soma, h) => soma + h.unresolved.length, 0)
  return {
    state,
    detail:
      `${arquivos.length} hook(s) do .husky/, ${total} comando(s) julgado(s), ${naoResolvidos} nao resolvido(s)` +
      (unattributed.length > 0
        ? `, ${unattributed.length} sem cadeia ate um hook (declarado(s))`
        : ""),
    hooks,
    unattributed,
  }
}

/**
 * QUEM BARRA o defeito DEPOIS do gate local — a resposta de "o hook é a última
 * linha?": é o CI, e o relatório NOMEIA o job em vez de dizer "o CI" no vazio.
 *
 * A fonte é o `CORE_INVARIANTS` (não uma lista à mão): a invariante que roda o
 * comando do gate da ÁRVORE (`typecheck`) declara os `jobIds` de cada forja, e é
 * isso que a branch protection exige para liberar o merge. Se um dia a
 * invariante mudar de job, o nome muda aqui sozinho — o texto do limite nunca
 * aponta para um check que não existe.
 *
 * @returns {string}
 */
export function ciQueBarraAArvore() {
  const inv = CORE_INVARIANTS.find((i) => i.id === "typecheck")
  const jobs = Object.entries(inv?.jobIds ?? {}).map(([forge, jid]) => `${forge}: '${jid}'`)
  return jobs.length > 0 ? `o CI (${jobs.join(", ")})` : "o CI"
}

/**
 * A MEDIDA DO LIMITE DO GATE LOCAL como PARTE do fato — o `git push
 * --no-verify` contorna o hook, o defeito CHEGA ao remoto e quem o barra é o CI.
 *
 * POR QUE ELA MORA NO MESMO FATO (e não numa nota em prosa): é o MESMO assunto
 * — o que o contrato local promete e o que ele NÃO cobre. O hook é quem executa
 * a promessa na máquina de quem empurra, e o git entrega ao próprio autor do
 * push o interruptor que a desliga; a rede é o CI. Declarar isso aqui faz o
 * veredito dizer quem barra, em vez de deixar "o pre-push está provado"
 * sugerindo que a árvore vermelha não tem como chegar a `main`.
 *
 * @param {{cwd?: string, deps?: {prove?: (opts: {root: string}) => object}}} [args]
 * @returns {{state: string, detail: string, evidence: object|null, remedies: string[]}}
 */
export function readPushBypass({
  cwd = REPO_ROOT,
  deps = /** @type {{prove?: (opts: {root: string}) => any}} */ ({}),
} = {}) {
  const prove = deps.prove ?? ((opts) => provePushBypass({ root: opts.root }))
  try {
    const r = prove({ root: cwd })
    if (r === null || r === undefined || typeof r.state !== "string") {
      return {
        state: "unavailable",
        detail:
          "a medida do limite do gate local nao devolveu estado (nem 'proven', nem 'violated')",
        evidence: null,
        remedies: [],
      }
    }
    return {
      state: r.state,
      detail: r.detail ?? "sem detalhe",
      evidence: r.evidence ?? null,
      remedies: r.remedies ?? [],
    }
  } catch (err) {
    return {
      state: "unavailable",
      detail: `a medida do limite do gate local nao pode rodar: ${err instanceof Error ? err.message : String(err)}`,
      evidence: null,
      remedies: [],
    }
  }
}

/**
 * O CONTRATO LOCAL INTEIRO — o fato único: os dois elos EXECUTADOS, o que cada
 * hook RODA e o LIMITE do gate local (medido).
 *
 * `executed` diz quais elos foram EXECUTADOS (o `--no-pre-commit-proof` e o
 * `--no-pre-push-proof` os desligam UM A UM): o elo desligado entra como
 * `skipped` — nomeado dentro do fato, e não numa flag paralela do relatório. A
 * falta de prova viaja junto do resto do contrato local, porque é isso que ela
 * é: uma parte do mesmo assunto.
 *
 * `deps.preCommit` / `deps.prePush` / `deps.analyzeHooks` / `deps.bypass` são os
 * pontos de injeção do teste (as quatro leituras são medidas sem git, sem os
 * hooks do checkout e sem o gate).
 *
 * O `bypass` NÃO tem flag de pulo: medir que o hook local é contornável custa o
 * mesmo que a prova do elo (o mesmo fixture, um push a mais) e é a única coisa
 * que impede o fato de sugerir que "o pre-push está provado" significa "a árvore
 * vermelha não chega a `main`". Um interruptor aqui seria mais um jeito de o
 * veredito ficar parcial sem dizer qual fato foi pulado.
 *
 * @param {{cwd?: string, deps?: object, executed?: Record<string, boolean>}} [args]
 * @returns {{state: string, detail: string, links: Record<string, {state: string, detail: string, evidence: object|null, remedies: string[]}>, commands: {state: string, detail: string, hooks: Record<string, HookCommandsPart>, unattributed: object[]}, bypass: {state: string, detail: string, evidence: object|null, remedies: string[]}, evidence: Record<string, object|null>, remedies: string[]}}
 */
export function readLocalContract({ cwd = REPO_ROOT, deps = {}, executed = {} } = {}) {
  const links = {}
  for (const elo of LOCAL_LINKS) {
    if (executed[elo] === false) {
      links[elo] = {
        state: "skipped",
        detail: `pulada por --no-${elo}-proof`,
        evidence: null,
        remedies: [],
      }
      continue
    }
    links[elo] =
      elo === "pre-commit"
        ? readPreCommitBlock({ cwd, deps: deps.preCommit ?? {} })
        : readPrePushBlock({ cwd, deps: deps.prePush ?? {} })
  }

  // `analyzeHooks` é o OBJETO de deps do leitor de comandos (`{analyze}`), não a
  // função: embrulhá-lo de novo entregaria um objeto onde se espera a régua.
  const commands = readHookCommands({ cwd, deps: deps.analyzeHooks ?? {} })
  // O LIMITE do gate local: não é uma promessa sendo cumprida, é a MEDIDA do que
  // a promessa não alcança — e por isso ele entra no agregado como qualquer
  // parte (um limite que não pôde ser medido não pode virar silêncio).
  const bypass = readPushBypass({ cwd, deps: deps.bypass ?? {} })
  const state = aggregateLocalState([
    ...LOCAL_LINKS.map((elo) => links[elo].state),
    commands.state,
    bypass.state,
  ])
  const detalheElo = (elo) =>
    `${elo}: ${links[elo].state} · ${commands.hooks[`.husky/${elo}`]?.unresolved.length ?? 0} comando(s) do hook nao resolvido(s)`

  return {
    state,
    detail: `${LOCAL_LINKS.map(detalheElo).join(" | ")} | ${commands.detail} | limite (--no-verify): ${bypass.state}`,
    links,
    commands,
    bypass,
    evidence: Object.fromEntries(LOCAL_LINKS.map((elo) => [elo, links[elo].evidence ?? null])),
    remedies: LOCAL_LINKS.flatMap((elo) => links[elo].remedies ?? []),
  }
}

/**
 * O que o contrato local tem de BLOQUEANTE: um elo que DEIXOU PASSAR (o defeito
 * entrou no histórico ou chegou ao remoto), um comando do hook que NÃO resolve
 * (um passo que nunca roda — a mesma classe que o gate reprova com exit 1) ou o
 * LIMITE medido como `violated` (o `--no-verify` leva o defeito ao remoto E o
 * gate do CI não reprova o que chegou: aí não há rede nenhuma depois do hook).
 *
 * O limite contornar o hook NÃO bloqueia — isso é o desenho do git, não um
 * defeito, e é justamente o que o fato declara. O que bloqueia é ele ser a
 * ÚLTIMA linha.
 *
 * NO RECORTE `--ci`, `unavailable` e `skipped` TAMBÉM BLOQUEIAM — e não só para
 * os elos: as TRÊS partes do contrato local (os dois elos e os comandos dos dois
 * hooks) só precisam de git, bash, bun e do próprio checkout, então "não deu para
 * medir" aqui é elo quebrado. SEM ESSA REGRA A PROMESSA SAI DE CENA EM SILÊNCIO:
 * apagar o `.husky/pre-push` (ou tirar o `bun` do PATH) leva o fato a
 * `unavailable` → INDETERMINADA → o portão do PR traduz 2 em 0 e o merge passa
 * com a garantia do push deixando de existir. É a classe de "verde por desenho"
 * que este repositório recusa.
 *
 * Fora do `--ci` NADA DISSO BLOQUEIA: lá a falta de prova é INDETERMINADA (ver
 * `localContractUnknowns`), porque o perfil completo cobre o que depende do HOST.
 * `violated` não é repetido aqui: ele já bloqueia pelo motivo dele.
 *
 * @param {object|undefined} fato
 * @param {{ciProfile?: boolean}} [opcoes]
 * @returns {string[]}
 */
export function localContractBlockers(fato, { ciProfile = false } = {}) {
  const blockers = []
  const elos = LOCAL_LINKS.map((elo) => [elo, fato?.links?.[elo]]).filter(([, l]) => l)
  for (const [elo, link] of elos) {
    if (link.state === "violated") {
      blockers.push(
        elo === "pre-commit"
          ? `o PRE-COMMIT nao bloqueia um corpo 'run:' quebrado no indice — ${link.detail}`
          : `o PRE-PUSH nao bloqueia um push com a arvore VERMELHA — ${link.detail}`,
      )
    }
  }
  for (const [rel, hook] of Object.entries(fato?.commands?.hooks ?? {})) {
    if (hook.state !== "violated") continue
    const lista = hook.unresolved
      .map((c) => `${c.arquivo}:${c.linha} \`${c.comando}\``)
      .slice(0, 5)
      .join(" · ")
    blockers.push(
      `o hook ${rel} executa comando(s) que NAO resolvem — um passo que NUNCA roda: ${lista}`,
    )
  }

  if (fato?.bypass?.state === "violated") {
    blockers.push(
      `o LIMITE do gate local foi medido como VIOLADO: ${fato.bypass.detail} — o hook local é contornável (\`--no-verify\`) e quem tinha de barrar depois (${ciQueBarraAArvore()}) não barrou`,
    )
  }

  if (!ciProfile) return blockers

  for (const elo of LOCAL_LINKS) {
    const link = fato?.links?.[elo]
    const state = link?.state ?? "ausente do relatório"
    if (state === "proven" || state === "violated") continue
    blockers.push(
      `a prova do bloqueio do ${LOCAL_LINK_FACE[elo]} nao foi PROVADA no recorte do merge (--ci): ` +
        `state '${state}'${link?.detail ? ` — ${link.detail}` : ""}. ` +
        `Neste recorte o contrato local so precisa de git/bash/bun e do proprio checkout, entao "nao deu para provar" ` +
        `aqui é elo quebrado — conserte-o (ou rode o doctor SEM --ci para tratar a falta de prova como INDETERMINADA)`,
    )
  }
  // O LIMITE no recorte do merge: medir que o `--no-verify` contorna o hook (e
  // que o gate do CI reprova o que chegou) usa o MESMO fixture e as mesmas
  // dependências dos elos — não há rede, credencial nem estado do HOST que
  // justifiquem um `unavailable` aqui. Sem esta metade, apagar o `bun` do runner
  // ou o próprio fixture levaria o limite a `unavailable` → INDETERMINADA → o
  // portão do PR traduz 2 em 0, e o veredito voltaria a sugerir que o hook local
  // é a rede que ele não é.
  const estadoDoLimite = fato?.bypass?.state ?? "ausente do relatório"
  if (estadoDoLimite !== "proven" && estadoDoLimite !== "violated") {
    blockers.push(
      `o LIMITE do gate local nao foi medido no recorte do merge (--ci): state '${estadoDoLimite}'` +
        `${fato?.bypass?.detail ? ` — ${fato.bypass.detail}` : ""}. ` +
        `Medir o '--no-verify' usa o mesmo fixture dos elos (git, bash, bun e o proprio checkout): ` +
        `aqui "nao deu para medir" é o veredito sem a parte que diz QUEM barra o defeito depois do hook`,
    )
  }

  // A metade dos COMANDOS no recorte do merge: todos os hooks do `.husky/`,
  // não só os dois elos. Ler os hooks e os scripts que eles chamam não precisa de
  // rede, credencial nem estado do HOST — então, DENTRO deste recorte, "não deu
  // para medir" é o contrato local sem a metade que diz O QUE cada hook roda.
  const hooksDoFato = Object.entries(fato?.commands?.hooks ?? {})
  if (hooksDoFato.length === 0) {
    blockers.push(
      `os comandos dos hooks nao foram CONFERIDOS no recorte do merge (--ci): ` +
        `${fato?.commands?.detail ?? "o fato do contrato local nao declara a parte dos comandos"}. ` +
        `Ler os hooks e os scripts que eles chamam nao precisa de rede, credencial nem estado do HOST: ` +
        `aqui "nao deu para medir" é o contrato local sem a metade que diz O QUE cada hook roda`,
    )
    return blockers
  }
  for (const [rel, hook] of hooksDoFato) {
    if (hook.state === "proven" || hook.state === "violated") continue
    blockers.push(
      `os comandos de '${rel}' nao foram CONFERIDOS no recorte do merge (--ci): ` +
        `state '${hook.state}'${hook.detail ? ` — ${hook.detail}` : ""}. ` +
        `Ler os hooks e os scripts que eles chamam nao precisa de rede, credencial nem estado do HOST: ` +
        `aqui "nao deu para medir" é o contrato local sem a metade que diz O QUE cada hook roda`,
    )
  }
  return blockers
}

/**
 * O que o contrato local NÃO pôde provar. Ausência do FATO também é ausência de
 * prova (mesma disciplina do guard de recursão, da herança de shell e da dívida
 * declarada): um relatório sem ele não cobre nem o commit que carrega um corpo
 * quebrado nem o push que leva a árvore vermelha para a forja — e "pronta" sobre
 * o que não foi olhado é o que este doctor recusa.
 *
 * As três partes da falta de prova saem NOMEADAS e separadas: o leitor precisa
 * saber QUAL elo não foi provado (e, no caso do `skipped`, qual flag o pulou),
 * qual hook não teve os comandos conferidos e se o LIMITE do gate local chegou a
 * ser medido — a última é a que responde "e se ninguém tivesse o hook?"
 *
 * @param {object|undefined} fato
 * @returns {string[]}
 */
export function localContractUnknowns(fato) {
  if (!fato) {
    return [
      "o CONTRATO LOCAL (os DOIS elos executados — o pre-commit recusando um corpo `run:` quebrado no ÍNDICE e o pre-push recusando a ÁRVORE vermelha sem deixar objeto nenhum no remoto — mais o que cada hook RODA) não está declarado no relatório: o veredito não cobre nem o commit local nem o push",
    ]
  }
  const unknowns = []
  // O LIMITE: a parte do mesmo assunto que responde "o hook é a última linha?".
  // Um fato sem ela (ou com ela não medida) não sabe dizer quem barra o defeito
  // depois do gate local — e "o pre-push está provado" sozinho sugere que a
  // árvore vermelha não tem como chegar a `main`.
  if (!fato.bypass) {
    unknowns.push(
      "o LIMITE do gate local (o `git push --no-verify` contorna o hook) não está declarado no fato: o veredito não cobre QUEM barra o defeito depois do gate local",
    )
  } else if (fato.bypass.state !== "proven" && fato.bypass.state !== "violated") {
    unknowns.push(
      `o limite do gate local (o '--no-verify' contorna o hook) nao foi MEDIDO (state '${fato.bypass.state}'): ${fato.bypass.detail} — sem ele o veredito nao diz quem barra o defeito depois do hook`,
    )
  }
  for (const elo of LOCAL_LINKS) {
    const link = fato.links?.[elo]
    if (!link) {
      unknowns.push(`o elo ${elo} do contrato local não está declarado no fato`)
      continue
    }
    if (link.state === "proven" || link.state === "violated") continue
    if (link.state === "skipped") {
      unknowns.push(
        elo === "pre-commit"
          ? "a prova do bloqueio LOCAL foi pulada (--no-pre-commit-proof): o veredito não cobre se um corpo `run:` quebrado no ÍNDICE pode virar um commit local"
          : "a prova do bloqueio do PUSH foi pulada (--no-pre-push-proof): o veredito não cobre se um push com a ÁRVORE vermelha leva o defeito para a forja",
      )
      continue
    }
    unknowns.push(
      elo === "pre-commit"
        ? `o bloqueio LOCAL do pre-commit nao foi provado (state '${link.state}'): ${link.detail}`
        : `o bloqueio do PUSH nao foi provado (state '${link.state}'): ${link.detail}`,
    )
  }
  // A metade dos COMANDOS: um hook que não teve os comandos conferidos — e o
  // caso em que NENHUM foi declarado (o fato sem a parte dos comandos).
  const hooksDeclarados = Object.entries(fato.commands?.hooks ?? {})
  if (hooksDeclarados.length === 0) {
    unknowns.push(
      `os comandos que os hooks RODAM não estão declarados no fato do contrato local: ${fato.commands?.detail ?? "a parte dos comandos não existe"}`,
    )
  }
  for (const [rel, hook] of hooksDeclarados) {
    if (hook.state === "proven" || hook.state === "violated") continue
    unknowns.push(
      `os comandos de '${rel}' nao foram conferidos (state '${hook.state}'): ${hook.detail}`,
    )
  }
  return unknowns
}

/**
 * O que a herança de shell tem de BLOQUEANTE: a declaração que liga o pipefail
 * (a premissa não é herdada, é dita) e a que não pôde ser lida — as DUAS classes
 * que o guard reprova com exit 1, agora NOMEADAS no veredito de prontidão em vez
 * de viverem só no relatório do gate.
 *
 * @param {object|undefined} fato
 * @returns {string[]}
 */
export function shellInheritanceBlockers(fato) {
  if (!fato || fato.state !== "violated") return []
  return fato.violations.map((v) => `a HERANCA DE SHELL dos workflows esta violada — ${v}`)
}

/**
 * O que a herança de shell NÃO pôde provar: a lista ou um arquivo ilegível.
 *
 * Ausência do FATO também é ausência de prova (mesma disciplina do guard de
 * recursão e da dívida declarada): um relatório sem o fato não cobre se uma
 * linha de `defaults:` mudou a premissa de todos os passos de um escopo, e dizer
 * "pronta" sobre o que não foi olhado é o que este doctor recusa.
 *
 * @param {object|undefined} fato
 * @returns {string[]}
 */
export function shellInheritanceUnknowns(fato) {
  if (!fato) {
    return [
      "a herança de shell dos workflows (de onde vem o shell de cada passo: o `shell:` do passo, o `defaults:` do job, o `defaults:` do arquivo ou a premissa `bash -e` do runner) não está declarada no relatório: o veredito não cobre se uma linha de `defaults:` mudou a premissa de um escopo inteiro",
    ]
  }
  if (fato.state === "proven") return []
  const out = []
  if (fato.state === "unread" && fato.error) {
    out.push(`a heranca de shell dos workflows NAO foi lida: ${fato.error}`)
  }
  for (const w of fato.workflows ?? []) {
    if (w.state === "unread") {
      out.push(`a heranca de shell de '${w.file}' NAO foi lida: ${w.detail}`)
    }
  }
  return out
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. Relatório
// ═══════════════════════════════════════════════════════════════════════════

const VERDICT_LINE = {
  [VERDICT.READY]: () => `${MARK.ok()} PRONTA PARA BLOQUEAR O MERGE`,
  [VERDICT.BLOCKED]: () => `${MARK.fail()} NÃO ESTÁ PRONTA — o merge NÃO pode ser confiado à forja`,
  [VERDICT.UNKNOWN]: () => `${MARK.warn()} INDETERMINADA — nada falhou, mas há coisa não provada`,
}

/** A barra do cabeçalho do relatório — uma só, para o recorte de recursão usar a mesma. */
const REPORT_BAR = "  ═════════════════════════════════════════════════════════════════"

/**
 * @param {object} report  { facts, verdict }
 * @param {{emit: Function}} deps
 */
export function renderReport(report, { emit = console.log } = {}) {
  const { facts, verdict } = report
  const line = (s = "") => emit(s)

  // ── RECURSÃO DETECTADA (nenhuma seção coletada) ────────────────────────
  // O doctor foi invocado DENTRO da própria prova: o guard cortou o ciclo e o
  // relatório existe para o FATO chegar em quem lê a prontidão — antes ele saía
  // com exit 3 e a causa vivia só no stderr, fora do canal do relatório (e o 3
  // é o MESMO código de uso inválido, então nem dava para distinguir os dois).
  const nested = facts.nestedGuard
  if (nested?.state === "fired") {
    line()
    line(REPORT_BAR)
    line("   🩺 DOCTOR DA FORJA — RECURSÃO DETECTADA (nenhuma seção coletada)")
    line(REPORT_BAR)
    line()
    line(
      `  ${MARK.fail()} o doctor está rodando DENTRO da própria prova (exit ${NESTED_GUARD_EXIT})`,
    )
    for (const c of nested.channels ?? []) {
      line(`  ${MARK.info()} marcado por: ${c.name} (canal ${c.channel})`)
    }
    line()
    for (const b of verdict.blockers) line(`  ${MARK.fail()} ${b}`)
    line()
    line("  O relatório NÃO cobre (o guard recusou antes de coletar):")
    for (const u of verdict.unproven) line(`  ${MARK.skip()} ${u}`)
    line()
    return
  }

  line()
  line(REPORT_BAR)
  line("   🩺 DOCTOR DA FORJA — prontidão para bloquear o merge")
  line(REPORT_BAR)
  line()
  line(`  ${MARK.info()} dona do merge : ${MERGE_OWNER_PIPELINE} (job '${FORGE_GUARDS_JOB}')`)
  line(`  ${MARK.info()} manifesto     : ${REQUIRED_CHECKS_MANIFEST}`)

  // ── 1. Contrato de merge ────────────────────────────────────────────────
  // Duas metades, lado a lado DE PROPÓSITO: o que o repositório DECLARA (o
  // manifesto + os workflows que ele cita) e o que a forja REGISTRA (a branch
  // protection). Um manifesto validado com a forja em drift é o modo de falha
  // que este comando existe para não deixar passar.
  line()
  line("  1/7  Contrato de merge (o que o repositório DECLARA × o que a forja REGISTRA)")
  for (const f of facts.contract.forges) {
    const mark = f.exists && f.jobs > 0 ? MARK.ok() : MARK.fail()
    line(
      `       ${mark} ${f.forge.padEnd(7)} ${f.workflow.padEnd(32)} ${f.jobs} job(s) obrigatório(s)`,
    )
  }
  for (const failure of facts.contract.failures) line(`       ${MARK.fail()} ${failure}`)

  if (facts.skippedProtection) {
    line(`       ${MARK.skip()} registrado: pulado por --no-protection`)
  } else {
    for (const f of facts.protection?.forges ?? []) {
      const mark =
        f.state === "in-sync" ? MARK.ok() : f.state === "drift" ? MARK.fail() : MARK.warn()
      line(`       ${mark} ${f.forge.padEnd(7)} registrado: ${f.detail}`)
    }
    if ((facts.protection?.forges ?? []).length === 0) {
      line(`       ${MARK.warn()} registrado: ${facts.protection?.detail ?? "nao lido"}`)
    }
  }

  // ── 2. Guards da forja ──────────────────────────────────────────────────
  line()
  line(`  2/7  Guards da forja (derivados de ${MERGE_OWNER_PIPELINE})`)
  if (facts.skippedGuards) {
    line(`       ${MARK.skip()} pulados por --no-guards (o veredito NÃO cobre os gates)`)
  } else if (facts.guards.error) {
    line(`       ${MARK.fail()} ${facts.guards.error}`)
  } else {
    const failed = facts.guards.results.filter((r) => r.code !== 0)
    const mark = failed.length === 0 ? MARK.ok() : MARK.fail()
    line(
      `       ${mark} ${facts.guards.results.length} gate(s) executado(s) — ${failed.length} com problema`,
    )
    for (const r of facts.guards.results) {
      const status = r.code === 0 ? MARK.ok() : r.code === null ? MARK.warn() : MARK.fail()
      const time = `${r.seconds.toFixed(1)}s`.padStart(6)
      const note = r.code === null ? `  ${r.error}` : r.code === 0 ? "" : `  exit ${r.code}`
      line(`       ${status} ${r.gate.padEnd(40)}${time}${note}`)
      if (r.tail) for (const l of r.tail.split("\n")) line(`           ${color(C.gray, l)}`)
    }
  }

  // ── 3. Imagem do runner ─────────────────────────────────────────────────
  line()
  line("  3/7  Imagem do runner (o que os jobs puxam para INICIAR)") // Só a AUSÊNCIA confirmada (exit 4) é falha da forja; o resto é falta de
  // prova (env ausente no checkout, registry inacessível, pacote privado).
  const imageMark =
    facts.image.code === 0
      ? MARK.ok()
      : facts.image.code === IMAGE_MISSING
        ? MARK.fail()
        : MARK.warn()
  line(`       ${imageMark} exit ${facts.image.code} · estado '${facts.image.state}'`)
  if (facts.image.ref) line(`           ${facts.image.ref}`)
  for (const l of facts.image.lines) line(`           ${color(C.gray, l)}`)

  // A tag existir no registry não prova que o compose PEDE a tag certa: aqui o
  // `docker compose config` resolve o label do runner de verdade (invariante 7).
  const ci = facts.compose
  if (ci) {
    const ciMark =
      ci.state === "proven"
        ? MARK.ok()
        : ci.state === "violated"
          ? MARK.fail()
          : ci.state === "absent"
            ? MARK.info()
            : MARK.warn()
    line(`       ${ciMark} interpolacao do compose: ${ci.detail}`)
    for (const v of ci.violations) line(`           ${color(C.gray, v)}`)
    // A outra metade: o env do HOST (o que o VPS interpola) contra o template
    // comitado (o que o repositorio declara).
    const hc = ci.hostCompare
    if (hc) {
      const hcMark =
        hc.state === "in-sync"
          ? MARK.ok()
          : hc.state === "diverged"
            ? MARK.fail()
            : hc.state === "absent" || hc.state === "skipped"
              ? MARK.skip()
              : MARK.warn()
      line(`       ${hcMark} host x template: ${hc.detail}`)
    }
  }

  // O CONTRATO DA IMAGEM PUBLICADA: a prova mais forte da seção. O build promete
  // (pin por digest + bloco fail-closed) — aqui o ARTEFATO que o job BAIXA é
  // executado e responde: plugin `compose`, versão do Bun e o caminho resolvido.
  const ic = facts.imageContract
  if (ic) {
    const icMark =
      ic.state === "proven"
        ? MARK.ok()
        : ic.state === "violated"
          ? MARK.fail()
          : ic.state === "skipped"
            ? MARK.skip()
            : MARK.warn()
    line(`       ${icMark} contrato da imagem PUBLICADA: ${ic.detail}`)
    if (ic.digest) line(`           ${color(C.gray, `alvo: ${ic.target}`)}`)
    if (ic.findings) {
      const f = ic.findings
      line(
        `           ${color(C.gray, `bun: ${f.bunPath ?? "?"} · versao: ${f.bunVersion ?? "?"} · compose: ${f.composeVersion ?? "?"}`)}`,
      )
    }
    for (const r of ic.remedies ?? []) line(`           ${color(C.gray, `→ ${r}`)}`)
  }

  // O que o runner GRAVOU (`/data/.runner`): os labels são ESTADO no volume, não
  // config do container — o `up -d runner` recria o container com o env novo e
  // deixa o registro velho no lugar, e o job cai na imagem antiga sem sintoma.
  const labels = facts.runnerLabels
  if (labels) {
    const labelsMark =
      labels.state === "proven"
        ? MARK.ok()
        : labels.state === "violated"
          ? MARK.fail()
          : labels.state === "skipped"
            ? MARK.skip()
            : MARK.warn()
    const where = labels.container ? ` (${labels.container} · ${labels.stateFile})` : ""
    line(`       ${labelsMark} registro do act_runner${where}: ${labels.detail}`)
    for (const v of labels.violations ?? []) line(`           ${color(C.gray, v)}`)
    for (const r of labels.remedies ?? []) line(`           ${color(C.gray, `→ ${r}`)}`)
  }

  // A OUTRA forja, na MESMA seção: aqui não há arquivo a ler — o registro do
  // runner do GitHub vive no servidor, e é a API que o revela. Mostrar as duas
  // lado a lado é o ponto: uma forja em sincronia e a outra não é drift, e o
  // relatório não pode deixar isso invisível.
  const ghLabels = facts.githubRunnerLabels
  if (ghLabels) {
    const ghMark =
      ghLabels.state === "proven"
        ? MARK.ok()
        : ghLabels.state === "violated"
          ? MARK.fail()
          : ghLabels.state === "skipped"
            ? MARK.skip()
            : MARK.warn()
    const ghWhere = ghLabels.repo
      ? ` (repos/${ghLabels.repo}/actions/runners${ghLabels.runner ? ` · ${ghLabels.runner} (${ghLabels.status})` : ""})`
      : ""
    line(`       ${ghMark} registro do runner (github)${ghWhere}: ${ghLabels.detail}`)
    for (const v of ghLabels.violations ?? []) line(`           ${color(C.gray, v)}`)
    for (const r of ghLabels.remedies ?? []) line(`           ${color(C.gray, `→ ${r}`)}`)
  }

  // As referencias que NAO estao no repositorio: o que ficou indeterminado
  // aparece aqui, item por item — esconder isso num modo verboso seria o alerta
  // mudo que este repo persegue.
  const refs = facts.imageRefs
  if (refs) {
    const refsMark =
      refs.state === "proven" ? MARK.ok() : refs.state === "violated" ? MARK.fail() : MARK.warn()
    line(`       ${refsMark} referencias nao versionadas: ${refs.detail}`)
    for (const item of refs.items ?? []) {
      const mark =
        item.state === "proven"
          ? MARK.ok()
          : item.state === "indeterminate" || item.state === "absent"
            ? MARK.skip()
            : MARK.fail()
      line(`           ${mark} ${color(C.gray, `${item.source} — ${item.detail}`)}`)
    }
  }

  // ── 4. Prova do bloqueio + o GATE que a cobra no merge ──────────────────
  // A tag existir AGORA não prova que a subida depende dela. Esta seção executa
  // o caminho real contra um registry de teste e mostra o que o docker viu — e,
  // logo abaixo, diz o que o CONTRATO DE MERGE exige e o que o job exigido RODA.
  // As duas metades juntas é que respondem "o merge é bloqueado por isto?": a
  // prova mede o comportamento, o gate mede a OBRIGAÇÃO.
  line()
  // A seção abriga os DOIS elos do contrato LOCAL (o commit e o push: o
  // pre-commit recusando um corpo `run:` quebrado no ÍNDICE e o pre-push
  // recusando a árvore VERMELHA sem deixar objeto nenhum no remoto) mais a prova
  // do bring-up (registry de TESTE) e o(s) GATE(s) que as cobram no merge. O
  // título mantém o começo de antes para o número da seção seguir sendo a âncora
  // de quem lê.
  line(
    "  4/7  Prova do bloqueio (registry de TESTE) + os DOIS elos locais (pre-commit e pre-push) + o GATE que as cobra no merge",
  )
  {
    const proofMark =
      facts.proof.status === "holds"
        ? MARK.ok()
        : facts.proof.status === "violated"
          ? MARK.fail()
          : MARK.warn()
    const cases = facts.proof.cases ?? []
    const summary =
      facts.proof.status === "holds"
        ? `${cases.length} caso(s): ${cases.map((c) => `${c.id}=exit ${c.exit}`).join(" · ")}`
        : facts.proof.detail
    line(`       ${proofMark} ${summary}`)
    if (facts.proof.status === "holds") {
      line(
        `           ${color(C.gray, "tag ausente ⇒ NENHUM 'compose up'; tag presente ⇒ 'up -d runner' (controle)")}`,
      )
      line(
        `           ${color(C.gray, "re-registro: sem a imagem NADA é apagado; com ela, 'rm -sf runner' → 'volume rm' → 'up'; registro preso ⇒ o runner não sobe")}`,
      )
    }
    for (const c of cases.filter((c) => !c.ok)) {
      line(`           ${MARK.fail()} ${c.title}`)
      for (const f of c.failures ?? []) line(`               ${color(C.gray, f)}`)
    }
  }

  // O CONTRATO LOCAL — UM bloco só para UM assunto: os DOIS elos EXECUTADOS (o
  // commit que tem de recusar o corpo `run:` quebrado no índice, com o controle
  // que tem de entrar, e o push que tem de recusar a árvore vermelha, com o
  // controle que tem de chegar ao remoto) MAIS o que cada hook RODA (quantos
  // comandos resolvem, quantos não resolvem, o que a descida alcançou e onde ela
  // parou). Antes isto eram dois blocos — e o contrato dos comandos nem aparecia.
  {
    const lc = facts.localContract
    /** O estado de uma parte, na marca gráfica do resto do relatório. */
    const marcaLocal = (estado) =>
      estado === "proven"
        ? MARK.ok()
        : estado === "violated"
          ? MARK.fail()
          : estado === "skipped"
            ? MARK.skip()
            : MARK.warn()
    if (!lc) {
      line(
        `       ${MARK.warn()} contrato local: NÃO declarado no relatório — o veredito não cobre os dois elos locais nem o que cada hook roda`,
      )
    } else {
      line(`       ${marcaLocal(lc.state)} contrato local: ${lc.state} — ${lc.detail}`)
      for (const elo of LOCAL_LINKS) {
        const link = lc.links?.[elo]
        const face =
          elo === "pre-commit"
            ? "prova do bloqueio LOCAL (pre-commit)"
            : "prova do bloqueio do PUSH (pre-push)"
        if (!link) {
          line(`           ${MARK.warn()} ${face}: NÃO declarada no relatório`)
          continue
        }
        if (link.state === "skipped") {
          line(
            `           ${MARK.skip()} ${
              elo === "pre-commit"
                ? "prova do bloqueio LOCAL pulada por --no-pre-commit-proof (o veredito NÃO cobre o corpo quebrado no commit local)"
                : "prova do bloqueio do PUSH pulada por --no-pre-push-proof (o veredito NÃO cobre a árvore vermelha chegando à forja)"
            }`,
          )
          continue
        }
        line(`           ${marcaLocal(link.state)} ${face}: ${link.state}`)
        line(`               ${color(C.gray, link.detail)}`)
        const ev = link.evidence
        if (elo === "pre-commit") {
          if (ev?.defeito) {
            line(
              `               ${color(C.gray, `defeito no índice: exit ${ev.defeito.status}, ${ev.defeito.objetosDeCommit} objeto(s) de commit, HEAD ${ev.defeito.headExiste ? "existe" : "ausente"}${ev.defeito.conteudoEmHead ? `, conteúdo em HEAD: ${ev.defeito.conteudoEmHead}` : ""}`)}`,
            )
          }
          if (ev?.controle) {
            line(
              `               ${color(C.gray, `CONTROLE com o corpo fechado: exit ${ev.controle.status}, ${ev.controle.objetosDeCommit} objeto(s) — sem ele, "não commitou" não distinguiria defeito de fixture quebrado`)}`,
            )
          }
        } else if (ev?.defeito) {
          line(
            `               ${color(C.gray, `árvore vermelha: exit ${ev.defeito.status}, ${ev.defeito.refs.length} ref(s) e ${ev.defeito.objetosNoRemoto} objeto(s) no remoto, ${ev.defeito.invocacoes ?? 0} invocação(ões) do typecheck`)}`,
          )
        }
        if (elo === "pre-push" && ev?.controle) {
          line(
            `               ${color(C.gray, `CONTROLE com a árvore verde: exit ${ev.controle.status}, ${ev.controle.refs.join(", ") || "sem ref"} (${ev.controle.objetosNoRemoto} objeto(s)) — sem ele, "nada chegou" não distinguiria defeito de fixture quebrado`)}`,
          )
        }
      }
      // O QUE CADA HOOK RODA — a metade que antes não era declarada na prontidão
      // (o gate a julgava, o relatório não a dizia). Os comandos que NÃO resolvem
      // saem um por linha, com arquivo, linha e motivo: é um passo que nunca roda.
      const hooksDoFato = Object.entries(lc.commands?.hooks ?? {})
      if (hooksDoFato.length === 0) {
        line(
          `           ${MARK.warn()} o que os hooks RODAM: NÃO declarado no relatório — ${lc.commands?.detail ?? "a parte dos comandos não existe no fato"}`,
        )
      }
      for (const [rel, hook] of hooksDoFato) {
        const papel = hook.elo ? " (elo do contrato local)" : ""
        line(`           ${marcaLocal(hook.state)} o que o ${rel} RODA${papel}: ${hook.detail}`)
        for (const c of hook.unresolved.slice(0, 5)) {
          line(
            `               ${MARK.fail()} ${c.arquivo}:${c.linha} \`${c.comando}\` — ${c.motivo}`,
          )
        }
        if (hook.declared.length > 0) {
          line(
            `               ${color(C.gray, `${hook.declared.length} declarado(s) indeterminado(s) em INDETERMINATE (com data e motivo) — medidos por leitura, não por engano`)}`,
          )
        }
        for (const limite of hook.limits) {
          line(`               ${color(C.gray, limite.motivo)}`)
        }
        if (hook.descended.length > 0) {
          line(
            `               ${color(C.gray, `a descida alcancou: ${hook.descended.join(", ")}`)}`,
          )
        }
      }
      line(
        `           ${color(C.gray, "quem cobra: o PRÓPRIO hook (.husky/pre-commit e .husky/pre-push) — o CI não o executa; o contrato que o cobre é o check-hook-commands (todo comando do hook tem de resolver)")}`,
      )
      // O LIMITE do gate local — a parte que impede o leitor de concluir que
      // "o pre-push está provado" significa "a árvore vermelha não chega a
      // main". Medida, não presumida: o `--no-verify` CHEGA ao remoto e o gate
      // do CI reprova o conteúdo que chegou.
      const b = lc.bypass
      if (!b) {
        line(
          `           ${MARK.warn()} limite do gate local: NÃO declarado no relatório — o veredito não diz quem barra o defeito depois do hook`,
        )
      } else {
        line(`           ${marcaLocal(b.state)} limite (git push --no-verify): ${b.state}`)
        line(`               ${color(C.gray, b.detail)}`)
        const ev = b.evidence
        if (ev?.contorno) {
          line(
            `               ${color(C.gray, `contorno: exit ${ev.contorno.status}, ${(ev.contorno.refs ?? []).join(", ") || "sem ref"}, ${ev.contorno.objetosNoRemoto ?? 0} objeto(s) no remoto, ` + `${ev.contorno.invocacoes ?? 0} invocação(ões) do typecheck (o controle tem ${ev.controle?.invocacoes ?? 0}) — o hook não rodou`)}`,
          )
        }
        if (ev?.ci) {
          line(
            `               ${color(C.gray, `quem barra: '${ev.ci.comando}' sobre o conteúdo CLONADO do remoto → exit ${ev.ci.status} (${ciQueBarraAArvore()})`)}`,
          )
        }
        if (b.state !== "proven") {
          for (const rem of b.remedies ?? []) line(`               ${color(C.gray, `→ ${rem}`)}`)
        }
      }
      if (lc.state !== "proven") {
        for (const rem of lc.remedies ?? []) line(`           ${color(C.gray, `→ ${rem}`)}`)
      }
    }
  }

  // O GUARD DE RECURSÃO: a defesa contra o ciclo que ESTA seção provoca — a
  // prova executa o bring-up, que executa o doctor. O fato é declarado no
  // relatório NORMAL porque a prontidão tem de cobrir a EXISTÊNCIA da defesa (e
  // por quais canais ela responde), e não só o disparo dela: o disparo tem
  // relatório próprio, com o estado `fired`.
  const guard = facts.nestedGuard
  if (!guard) {
    line(
      `       ${MARK.warn()} guard de recursão: NÃO declarado no relatório — o veredito não cobre a defesa do ciclo bring-up → doctor → prova`,
    )
  } else {
    const guardMark =
      guard.state === "armed" ? MARK.ok() : guard.state === "disarmed" ? MARK.fail() : MARK.warn()
    const canais = (guard.channels ?? []).map((c) => `${c.name} (${c.channel})`).join(" + ")
    line(
      `       ${guardMark} guard de recursão: ${guard.state}${canais ? ` — responde a ${canais}` : ""}`,
    )
    line(`           ${color(C.gray, guard.detail)}`)
    if (guard.state !== "armed") {
      for (const r of guard.remedies ?? []) line(`           ${color(C.gray, `→ ${r}`)}`)
    }
  }

  // OS GATES CORE NO CONTRATO DE MERGE: cada gate classificado como CORE é
  // verificado — o job está no manifesto, o job roda o comando esperado e a
  // branch protection o registra. Violação em qualquer um bloqueia.
  //
  // `gateContracts` é a lista genérica; `bringUpGate` é mantido para
  // compatibilidade (e já é coberto pela lista genérica).
  const gc = facts.gateContracts
  if (facts.skippedGateContracts) {
    line(
      `       ${MARK.skip()} verificação dos gates CORE pulada por --ci (o veredito NÃO cobre se os gates CORE estão no contrato de merge)`,
    )
  } else if (gc?.results?.length > 0) {
    const violated = gc.results.filter((r) => r.state === "violated")
    const unavailable = gc.results.filter((r) => r.state === "unavailable")
    const proven = gc.results.filter((r) => r.state === "proven")
    line(
      `       ${violated.length > 0 ? MARK.fail() : MARK.ok()} Gates CORE no contrato de merge: ${proven.length} provado(s), ${violated.length} violado(s), ${unavailable.length} não conferido(s)`,
    )
    for (const r of gc.results) {
      if (r.state === "proven") continue // só mostra violações e indisponíveis
      const gMark = r.state === "violated" ? MARK.fail() : MARK.warn()
      line(`           ${gMark} [${r.invariantId}] job '${r.jobId}': ${r.state}`)
      for (const f of r.forges ?? []) {
        if (f.registered === false) {
          line(`               ${color(C.red, f.detail)} [NAO REGISTRADO]`)
        } else if (f.command === null) {
          line(`               ${color(C.yellow, f.detail)}`)
        }
      }
      if (r.state !== "proven") {
        for (const v of r.violations ?? []) line(`               ${color(C.gray, v)}`)
        for (const rem of r.remedies ?? []) line(`               ${color(C.gray, `→ ${rem}`)}`)
      }
    }
  }
  // Compatibilidade: o bringUpGate legado continua sendo exibido.
  const gate = facts.bringUpGate
  if (gate && !gc) {
    const gMark =
      gate.state === "proven" ? MARK.ok() : gate.state === "violated" ? MARK.fail() : MARK.warn()
    line(`       ${gMark} GATE do bring-up (job '${gate.job}' no contrato de merge): ${gate.state}`)
    for (const f of gate.forges ?? []) {
      const reg =
        f.registered === true ? " [registrado]" : f.registered === false ? " [NAO REGISTRADO]" : ""
      line(
        `           ${color(C.gray, f.detail)}${color(f.registered === false ? C.red : C.gray, reg)}`,
      )
    }
    if (
      gate.state !== "proven" &&
      !(gate.forges ?? []).every((f) => gate.detail.includes(f.detail))
    ) {
      line(`           ${color(C.gray, gate.detail)}`)
    }
    if (gate.state !== "proven") {
      for (const r of gate.remedies ?? []) line(`           ${color(C.gray, `→ ${r}`)}`)
    }
  }

  // ── 5. Espelhos locais ─────────────────────────────────────────────────
  // A primeira linha diz CONTRA O QUE se comparou: sem o valor da variável, o
  // resto da seção só prova existência e concordância local — e o operador
  // precisa ver essa diferença sem ler o código.
  line()
  line("  5/7  Espelhos das variáveis da imagem — o VALOR (sem rede)")
  // O conjunto COMPARADO vem do fato (não de uma lista escrita aqui): as
  // variáveis sem valor passado aparecem em `unknowns`, com o nome.
  // `expectedVars` com fallback em `expected`: um fato montado à mão (teste,
  // chamador antigo) continua dizendo o que comparou, em vez de sair como "nada
  // foi comparado" com o valor na mão.
  const wantedVars = facts.mirrors.expectedVars ?? {
    BUN_VERSION: facts.mirrors.expected ?? null,
  }
  const comparedVars = MIRROR_VARIABLES.filter(
    (name) =>
      wantedVars[name] !== null && wantedVars[name] !== undefined && wantedVars[name] !== "",
  )
  if (comparedVars.length > 0) {
    line(
      `       ${MARK.info()} comparados com ${comparedVars
        .map((name) => `vars.${name}='${wantedVars[name]}'`)
        .join(" · ")} (--expected/--expected-var, mesma função do job semanal actrc-sync)`,
    )
  } else {
    line(
      `       ${MARK.info()} o VALOR não foi comparado: sem --expected/--expected-var (as repository variables só existem no Actions/na forja)`,
    )
  }
  if (facts.mirrors.blockers.length === 0 && facts.mirrors.unknowns.length === 0) {
    line(`       ${MARK.ok()} .actrc e ${GITEA_ENV_MIRROR} concordam (${facts.mirrors.actrc})`)
  }
  for (const m of facts.mirrors.mirrors ?? []) {
    const mark = Array.isArray(m.drift)
      ? m.drift.length > 0
        ? MARK.fail()
        : MARK.ok()
      : m.version === (facts.mirrors.expected ?? null)
        ? MARK.ok()
        : MARK.fail()
    const others = comparedVars.filter((name) => name !== "BUN_VERSION")
    const values = [
      `BUN_VERSION=${m.version ?? "<sem BUN_VERSION>"}`,
      ...others.map((name) => `${name}=${m.values?.[name] ?? "<ausente>"}`),
    ]
    line(
      `           ${mark} ${m.label} (${m.deployed ? "host" : "template comitado"}): ${values.join(" · ")}`,
    )
  }
  // Os avisos do GUARD, no texto dele: é o que o job semanal publica na issue, e
  // vê-los aqui lado a lado com o bloqueio é o que faz o log do doctor e a issue
  // não poderem discordar (a comparação é uma função só).
  if ((facts.mirrors.warnings ?? []).length > 0) {
    line(
      `           ${color(C.gray, "aviso do guard periódico (o MESMO texto que o job semanal publica):")}`,
    )
    for (const w of facts.mirrors.warnings) line(`           ${color(C.gray, w)}`)
  }
  for (const p of facts.mirrors.blockers) line(`       ${MARK.fail()} ${p}`)
  for (const p of facts.mirrors.unknowns) line(`       ${MARK.warn()} ${p}`)

  // O PRÉ-REQUISITO 0 do bring-up, na seção dos espelhos: é aqui que ele vive
  // (o comando é o mesmo), e a linha diz as três coisas que faltavam no
  // relatório — que o `gitea-up.sh` EXIGE isto, o COMANDO que o responde e o
  // estado em que ele está AGORA. O estado vem da MESMA medição da seção 3
  // (`compose.hostCompare`): uma pergunta, uma resposta.
  const bringUp = deriveBringUpEnv(facts.compose)
  if (bringUp.state !== "not-applicable") {
    const bMark =
      bringUp.state === "proven"
        ? MARK.ok()
        : bringUp.state === "violated"
          ? MARK.fail()
          : bringUp.state === "skipped"
            ? MARK.skip()
            : MARK.warn()
    line(
      `       ${bMark} PRE-REQUISITO 0 do ${GITEA_BRING_UP} (o env do host espelha o template): ${bringUp.state}`,
    )
    // O comando sai em linha PROPRIA só quando o detalhe não o traz: o detalhe é
    // a mesma string que viaja no veredito (e no `--json`), então ele tem de ser
    // auto-contido — mas imprimir os dois lado a lado seria eco.
    if (!bringUp.detail.includes(bringUp.command)) {
      line(`           ${color(C.gray, `comando: ${bringUp.command}`)}`)
    }
    line(`           ${color(C.gray, bringUp.detail)}`)
    for (const r of bringUp.remedies) line(`           ${color(C.gray, `→ ${r}`)}`)
  }

  // ── 6. Dívida aberta no board ───────────────────────────────────────────
  // A única seção que fala do que o repositório JÁ SABE, em vez do que ele mede
  // agora: as issues que os próprios crons abriram. Aqui uma dívida esquecida
  // aparece com o número e a idade, em vez de viver só no board — e as duas que
  // o doctor mede por conta própria vêm lado a lado com a MEDIÇÃO, para a issue
  // velha não passar por problema vivo (nem o contrário).
  line()
  line("  6/7  Dívida conhecida (DECLARADA no repositório × ABERTA no board)")
  // ── a DECLARADA: a IDADE das isenções (data + janela de revisão) ────────
  if (facts.skippedDeclaredDebt) {
    line(
      `       ${MARK.skip()} dívida declarada pulada por --no-declared-debt (a IDADE das isenções fica fora do veredito)`,
    )
  } else {
    for (const fonte of facts.declaredDebt?.sources ?? []) {
      const mark =
        fonte.state === "proven"
          ? MARK.ok()
          : fonte.state === "sem-divida"
            ? MARK.info()
            : fonte.state === "aged"
              ? MARK.warn()
              : MARK.fail()
      const idade = fonte.oldest ? ` — a mais antiga há ${fonte.oldest.days} dia(s)` : ""
      const janela = fonte.reviewDays ? ` (janela de ${fonte.reviewDays} dia(s))` : ""
      line(`       ${mark} ${fonte.listName} [${fonte.state}]${idade}: ${fonte.detail}${janela}`)
      if (fonte.state === "aged" || fonte.state === "invalid") {
        line(`           ${color(C.gray, textoFonteVencida(fonte))}`)
      }
    }
    if ((facts.declaredDebt?.sources ?? []).length === 0) {
      line(
        `       ${MARK.warn()} a dívida declarada NÃO foi coletada: ${facts.declaredDebt?.error ?? "sem detalhe"}`,
      )
    }
  }
  // ── a ABERTA no board: o que os crons já publicaram ────────────────────
  line(`       ${MARK.info()} labels lidas: ${(facts.openDebt?.labels ?? []).join(", ")}`)
  if (facts.openDebt?.excluded) {
    line(
      `       ${MARK.info()} fora da leitura: '${facts.openDebt.excluded.label}' — ${facts.openDebt.excluded.why}`,
    )
  }
  if (facts.skippedOpenDebt) {
    line(
      `       ${MARK.skip()} pulada por --no-open-debt (a dívida do board NÃO entra no veredito)`,
    )
  }
  for (const read of facts.openDebt?.reads ?? []) {
    const mark = read.state === "read" ? (read.open === 0 ? MARK.ok() : MARK.warn()) : MARK.warn()
    line(`       ${mark} ${read.forge}: ${read.detail}`)
  }
  for (const item of facts.openDebt?.items ?? []) {
    line(`           ${MARK.warn()} ${item.forge} · ${item.label} — ${item.subject}`)
    for (const issue of item.issues) {
      const when = issue.days === null ? "data desconhecida" : `aberta há ${issue.days} dia(s)`
      line(`               ${color(C.gray, `#${issue.number} (${when}) — ${issue.title}`)}`)
    }
    if (item.foreign > 0) {
      line(
        `               ${color(C.gray, `${item.foreign} issue(s) com a label e SEM o marcador do publicador — um automatismo não pode fechá-la(s)`)}`,
      )
    }
    const stale =
      item.stale === true ? MARK.info() : item.stale === false ? MARK.warn() : MARK.skip()
    line(`               ${stale} ${color(C.gray, item.staleDetail)}`)
  }

  // ── 7. Herança de shell dos workflows ───────────────────────────────────
  // A promessa que vivia SÓ no relatório do `check-pipefail-sigpipe`: de ONDE
  // vem o shell de cada passo. A medição é a MESMA (`workflowShellInheritance`,
  // a função que o gate usa item a item), e o fato entra ATÉ no perfil `--ci` —
  // é leitura de checkout, e no PR a bateria de guards está pulada: sem esta
  // seção, uma declaração de `defaults:` que ligue o pipefail viajaria em
  // silêncio no veredito de quem decide se o merge pode ser confiado à forja.
  line()
  line("  7/7  Herança de shell dos workflows (de ONDE vem o shell de CADA passo)")
  const si = facts.shellInheritance
  if (!si) {
    line(
      `       ${MARK.warn()} o fato não está no relatório — a premissa do shell default fica fora do veredito`,
    )
  } else {
    for (const w of si.workflows) {
      const mark =
        w.state === "proven" ? MARK.ok() : w.state === "violated" ? MARK.fail() : MARK.warn()
      line(`       ${mark} ${w.file}`)
      if (w.counts) {
        line(
          `           ${color(C.gray, `origem: ${w.counts.peloRunner} pelo RUNNER (\`bash -e\`, premissa) · ${w.counts.noPasso} no próprio passo · ${w.counts.porDefaultDoJob} por \`defaults:\` do job · ${w.counts.porDefaultDoArquivo} por \`defaults:\` do arquivo`)}`,
        )
        line(
          `           ${color(C.gray, `pipefail: ${w.counts.comPipefail} de ${w.counts.total} passo(s) com o pipefail ATIVO (declarado no passo, por \`defaults:\` ou por \`set -o pipefail\` no corpo)`)}`,
        )
      } else {
        line(`           ${color(C.gray, w.detail)}`)
      }
      for (const p of w.premissas) {
        line(
          `           ${MARK.fail()} :${p.line} \`defaults:\` (${describeShellScope(p)}) → \`shell: ${p.shell}\` LIGA o pipefail para ${p.passos} passo(s) sem \`shell:\``,
        )
      }
      for (const d of w.ilegiveis) {
        line(
          `           ${MARK.fail()} :${d.line} \`defaults:\` (${describeShellScope(d)}) em FORMA INLINE (\`${d.shell}\`) — a premissa não foi lida`,
        )
      }
    }
    const marca =
      si.violations.length > 0 ? MARK.fail() : si.totals.unread > 0 ? MARK.warn() : MARK.ok()
    line(`       ${marca} total: ${si.detail}`)
    if (si.totals.corpoVazio > 0) {
      line(
        `       ${MARK.info()} ${si.totals.corpoVazio} passo(s) com \`run:\` VAZIO: declarados e NÃO julgados — o guard os conta e os nomeia em vez de deixá-los sumir`,
      )
    }
    line(
      `       ${MARK.info()} o default do RUNNER (\`bash -e\`) NÃO é deste repositório: é uma PREMISSA — por isso o guard julga os passos nos DOIS contextos (com e sem pipefail), e uma declaração de \`defaults:\` que ligue o pipefail é falha própria: a premissa não é herdada, é DITA`,
    )
    if (si.violations.length > 0) {
      line(
        `       ${MARK.info()} remédio: declare \`shell: bash\` em cada passo afetado (a classe fica visível em quem revisa o PASSO) ou remova o \`defaults:\` e mantenha o default do runner`,
      )
      line(
        `       ${MARK.info()} gate: node scripts/check-pipefail-sigpipe.mjs reprova as duas classes (exit 1) — aqui elas aparecem NOMEADAS no veredito de prontidão`,
      )
    }
    if (si.totals.unread > 0) {
      line(
        `       ${MARK.warn()} ${si.totals.unread} arquivo(s) não lido(s): não ler NÃO é o mesmo que não haver shell default declarado`,
      )
    }
  }

  // ── Veredito ────────────────────────────────────────────────────────────
  line()
  line("  ─────────────────────────────────────────────────────────────────")
  line(`  VEREDITO: ${VERDICT_LINE[verdict.verdict]()}`)
  line("  ─────────────────────────────────────────────────────────────────")

  if (verdict.blockers.length > 0) {
    line()
    line(`  ${color(C.red, "Bloqueios")} (corrigir antes de confiar o merge à forja):`)
    for (const b of verdict.blockers) line(`    ${MARK.fail()} ${b}`)
  }
  if (verdict.unknowns.length > 0) {
    line()
    line(`  ${color(C.yellow, "Não provado")}:`)
    for (const u of verdict.unknowns) line(`    ${MARK.warn()} ${u}`)
  }

  line()
  line(`  ${color(C.gray, "O veredito NÃO cobre:")}`)
  for (const u of verdict.unproven) line(`    ${color(C.gray, `· ${u}`)}`)
  line()
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. CLI
// ═══════════════════════════════════════════════════════════════════════════

export const USAGE = `forge-doctor — relatório de prontidão da forja para bloquear o merge

Usage:
  node scripts/forge-doctor.mjs [opções]

O relatório NOMEIA o PRE-REQUISITO 0 do deploy/gitea-up.sh (o env do host tem de
espelhar o template comitado) com o ESTADO dele, o COMANDO que o reproduz e o
REMEDIO (bun run env-mirror:check --patch | --fix). Ele é DERIVADO da MESMA
comparação host x template da seção da imagem — uma pergunta, uma resposta:
sondar de novo seria uma segunda verdade sobre o mesmo arquivo.

Opções:
  --no-guards            pula a bateria de guards (mais rápido; o veredito fica parcial)
  --no-protection        pula a leitura da branch protection registrada na forja
  --no-runner-labels     pula a comparação do registro do runner NAS DUAS forjas:
                         o act_runner (os labels são ESTADO no volume:
                         /data/.runner x o compose) e o runner auto-hospedado do
                         GitHub (o registro vive no SERVIDOR: a API x o
                         RUNNER_LABELS de deploy/setup-github-runner.sh, que
                         exige token de self-hosted runners — sem ele é 3)
  --no-image-contract    pula o contrato da imagem PUBLICADA: o doctor resolve o
                         DIGEST que a tag serve e roda o bloco do contrato DENTRO
                         do artefato (docker run <repo>@<digest>) — plugin
                         \`compose\`, versão do Bun e o caminho resolvido. É a
                         única prova do que o job REALMENTE baixa; o primeiro
                         run baixa a imagem (minutos) se ela nao estiver local
  --no-compose-render    pula a interpolação do compose (docker compose config)
  --no-registry-probe    não consulta o registry (offline): a tag que o repo
                         declara deixa de ser conferida — e o veredito não pode
                         fingir que foi
  --no-open-debt         não lê o BOARD (offline): as issues de drift ABERTAS
                         (required-checks-drift, actrc-sync-drift, readme-drift,
                         mutation-trend-drift) deixam de aparecer no veredito —
                         e a dívida que vive só no board volta a ser invisível
                         para a prontidão
  --no-declared-debt     pula a IDADE da dívida DECLARADA (as isenções com data
                         e janela de revisão: OUT_OF_SCOPE_ALLOWLIST,
                         THIRD_PARTY_ALLOWLIST, ALLOWLIST e o baseline do
                         SIGPIPE). NÃO é preciso em rede/credencial: é leitura
                         do checkout, e por isso roda ATÉ no perfil --ci
  --no-pre-commit-proof  pula a PROVA DO BLOQUEIO LOCAL: o doctor deixa de
                         executar o 'git commit' de verdade que mede se o
                         pre-commit recusa um corpo 'run:' quebrado no ÍNDICE
                         (e o controle com o corpo fechado). É local e barata
                         (~0,3s: git + o hook real, com o fecho do guard) e por
                         isso roda ATÉ no perfil --ci — pular deixa o veredito
                         INDETERMINADA nomeando a parte que ficou fora (dentro
                         do fato 'localContract', que cobre os DOIS elos e os
                         comandos de cada hook)
  --no-pre-push-proof    pula a PROVA DO BLOQUEIO DO PUSH (o OUTRO ELO do
                         contrato local): o doctor deixa de executar o 'git
                         push' de verdade contra um remoto BARE que mede se o
                         pre-push recusa a ÁRVORE vermelha sem deixar ref nem
                         OBJETO nenhum do outro lado (e o controle com a árvore
                         verde). É local e barata (~0,2s: git + o hook real) e
                         por isso roda ATÉ no perfil --ci — pular deixa o
                         veredito INDETERMINADA nomeando a parte que ficou fora
                         (dentro do fato 'localContract', que cobre os DOIS elos,
                         os comandos de cada hook e o LIMITE do gate local)
  --expected <versão>    valor de vars.BUN_VERSION (a repository variable): com
                         ele os espelhos do Bun são comparados com o VALOR
                         declarado, pelo mesmo código do job semanal
                         actrc-sync. Sem ele o doctor só prova que os espelhos
                         existem e concordam entre si — e o veredito fica
                         INDETERMINADA por isso
  --expected-var NOME=VALUE
                         o valor de OUTRA variável que o compose consome
                         (IMAGE_REGISTRY, IMAGE_NAMESPACE): o guard periódico
                         compara o valor de TODAS elas, e uma sem valor passado
                         deixa o veredito INDETERMINADA com o nome dito.
                         Repetível; BUN_VERSION entra por --expected
  --gitea-env <path>     env do HOST (default: deploy/.env.gitea) — e ele que o
                         doctor compara com o template comitado
  --timeout <segundos>   limite por gate (default: 120)
  --json                 sai como JSON (mesma informação do relatório)
  --ci                   PERFIL de pipeline (o job \`guards\` da forja, a cada PR):
                         a fatia que não precisa de rede, credencial nem do
                         HOST — equivale a --no-guards --no-protection
                         --no-runner-labels --no-image-contract
                         --no-registry-probe --no-open-debt. O que ele NÃO faz
                         é baixar a régua: com --expected/--expected-var o VALOR
                         das variáveis é comparado e uma divergência BLOQUEIA;
                         e os DOIS ELOS LOCAIS (\`.husky/pre-commit\` e
                         \`.husky/pre-push\`) têm de sair PROVADOS — eles só
                         precisam de git/bash/bun, então "não deu para provar"
                         neste recorte é elo quebrado e BLOQUEIA (sem --ci a
                         falta de prova segue INDETERMINADA, que é o veredito
                         honesto no perfil completo);
                         cada seção fora do perfil sai na lista de não provado
  --proof-nested         DEFESA (não é opção de uso): declara que ESTA
                         invocação roda DENTRO da prova. O doctor falha com
                         exit 3 em vez de recursar (bring-up → doctor →
                         prova → bring-up) e EMITE o relatório de recursão
                         (stdout, ou o JSON de --json) — o mesmo canal do
                         veredito, para a causa não viver só no stderr. É o
                         gêmeo da env \`FORGE_DOCTOR_NESTED\`, para quem
                         reexecuta o doctor por linha de comando SEM
                         controlar o ambiente do filho
  -h, --help             esta ajuda

Exit codes (o veredito é o exit code — dá para usar em pipeline):
  0 — pronta   1 — bloqueada   2 — indeterminada
  3 — uso/erro interno OU recursão detectada (o doctor rodando DENTRO da
      própria prova). Em ambos sai o RELATÓRIO; no caso da recursão ele traz
      o fato \`nestedGuard\` e um bloqueador que a nomeia

No perfil --ci o veredito NORMAL é 2 (INDETERMINADA): as seções de rede e de
HOST ficam para o cron. Quem roda em pipeline trata 0 e 2 como "sem violação" e
lê a lista \`unproven\` do relatório (ou o log) para saber o que NÃO foi coberto.
`

/**
 * O RECORTE do doctor que um runner de PR prova — e por isso o que pode rodar no
 * job `guards` a cada PR (`.gitea/workflows/ci.yml` e o espelho do GitHub).
 *
 * POR QUE ESTAS SETE, e não uma a menos: cada uma precisa de algo que um runner
 * de PR não tem (rede, credencial de administração, o estado do HOST) ou é
 * RECURSIVA ali dentro — a bateria de guards É o job que chama o doctor, e a
 * prova do bloqueio executa o `deploy/gitea-up.sh`, que por sua vez executa este
 * doctor. Ficam de fora do recorte apenas as seções que o PR consegue provar: o
 * contrato de merge, o env mirror, o render do compose e o VALOR das variáveis
 * nos espelhos e nas referências não versionadas.
 *
 * O que ele NÃO faz é esconder o que saiu: cada chave daqui vira uma linha da
 * lista `unproven` (e todas elas já existem para as flags manuais — este perfil
 * não inventou um segundo mecanismo).
 *
 * @type {string[]} os nomes das seções que o `--ci` DESLIGA
 */
export const CI_PROFILE_SKIPS = [
  "guards",
  // "proof" NÃO entra aqui: a prova do bloqueio é a defesa em
  // profundidade contra recursão (NESTED_GUARD_ENV) e o corte do ciclo
  // (DOCTOR_SCRIPT). Sem ela, o veredito diz "sem prova" sem nunca
  // ter tentado — e a subida da stack leva o runner ao ar sem a tag.
  "protection",
  "runnerLabels",
  "imageContract",
  "registryProbe",
  "openDebt",
  "gateContractsCheck",
]

export function parseArgs(argv) {
  const opts = {
    ciProfile: false,
    guards: true,
    proof: true,
    protection: true,
    runnerLabels: true,
    imageContract: true,
    composeRender: true,
    registryProbe: true,
    gateContractsCheck: true,
    openDebt: true,
    declaredDebt: true,
    preCommitProof: true,
    prePushProof: true,
    envFile: DEFAULT_ENV_FILE,
    expected: null,
    expectedVars: {},
    timeoutS: 120,
    json: false,
    help: false,
    error: null,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--ci") {
      opts.ciProfile = true
      for (const name of CI_PROFILE_SKIPS) opts[name] = false
    } else if (arg === "--no-guards") opts.guards = false
    else if (arg === "--no-protection") opts.protection = false
    else if (arg === "--no-runner-labels") opts.runnerLabels = false
    else if (arg === "--no-image-contract") opts.imageContract = false
    else if (arg === "--no-compose-render") opts.composeRender = false
    else if (arg === "--no-registry-probe") opts.registryProbe = false
    else if (arg === "--no-open-debt") opts.openDebt = false
    else if (arg === "--no-declared-debt") opts.declaredDebt = false
    else if (arg === "--no-pre-commit-proof") opts.preCommitProof = false
    else if (arg === "--no-pre-push-proof") opts.prePushProof = false
    else if (arg === "--json") opts.json = true
    else if (arg === "-h" || arg === "--help") opts.help = true
    else if (arg === "--expected") opts.expected = argv[++i] ?? ""
    else if (arg === "--expected-var") {
      const raw = argv[++i] ?? ""
      const eq = raw.indexOf("=")
      const name = eq > 0 ? raw.slice(0, eq) : ""
      if (!MIRROR_VARIABLES.includes(name)) {
        opts.error = `--expected-var exige NOME=VALOR com NOME em ${MIRROR_VARIABLES.join(", ")} (recebi '${raw}')`
      } else if (name === "BUN_VERSION") {
        opts.error = "--expected-var: BUN_VERSION entra por --expected"
      } else if (raw.slice(eq + 1).startsWith("--")) {
        opts.error = `--expected-var exige um valor, nao uma flag (recebi '${raw.slice(eq + 1)}' para ${name})`
      } else {
        opts.expectedVars[name] = raw.slice(eq + 1)
      }
    } else if (arg === "--gitea-env") opts.envFile = argv[++i] ?? ""
    else if (arg === "--timeout") opts.timeoutS = Number(argv[++i])
    else opts.error = `argumento desconhecido: ${arg}`
  }
  if (!opts.envFile) opts.error = "--gitea-env exige um caminho"
  // `--expected` SEM valor é erro de uso. A versão vazia (variável não criada) é
  // drift REAL, mas quem o reporta é o guard periódico — um flag que aceita
  // nada seria indistinguível de "não perguntei".
  if (opts.expected === "") opts.error = "--expected exige uma versão (ex.: --expected 1.3.14)"
  // Uma flag engolida como valor (`--expected --json`) seria comparada como se
  // fosse uma versão — o espelho "divergiria de '--json'" e a mensagem mandaria
  // o operador procurar um drift que não existe. Versão nenhuma começa com `--`.
  if (typeof opts.expected === "string" && opts.expected.startsWith("--")) {
    opts.error = `--expected exige uma versão, não uma flag (recebi '${opts.expected}')`
  }
  if (!Number.isFinite(opts.timeoutS) || opts.timeoutS < 1) {
    opts.error = "--timeout exige um número de segundos >= 1"
  }
  return opts
}

/**
 * Coleta os fatos e monta o veredito. Exportado para o teste exercitar o fluxo
 * inteiro com dependências dubladas (sem registry, sem rodar gate de verdade).
 *
 * @param {object} [options]
 * @param {string} [options.cwd]
 * @param {string} [options.envFile]   env do runner (o mesmo do compose)
 * @param {string|null} [options.expected] valor de `vars.BUN_VERSION` para
 * comparar os espelhos do Bun (null = não comparado: o veredito fica parcial)
 * @param {Record<string, string|null>} [options.expectedVars] os valores das
 * outras variáveis comparadas (`--expected-var`): as sem valor entram como
 * dúvida nominal ("o VALOR de X não foi comparado"), nunca como conferidas
 * @param {boolean} [options.ciProfile] PERFIL de pipeline (`--ci`): marca o
 * relatório como o recorte local e acrescenta a linha própria em `unproven`.
 * Quem desliga as seções é `CI_PROFILE_SKIPS` (no `parseArgs`), não este flag
 * (aqui ele só DECLARA o recorte no relatório)
 * @param {boolean} [options.guards]   executar a bateria da forja (default: true)
 * @param {boolean} [options.proof]    executar a prova do bloqueio (default: true)
 * @param {boolean} [options.protection] ler a branch protection registrada na forja (default: true)
 * @param {boolean} [options.runnerLabels] comparar o registro do act_runner com o compose (default: true)
 * @param {boolean} [options.imageContract] rodar o contrato DENTRO da imagem publicada (default: true)
 * @param {boolean} [options.composeRender] interpolar o compose da forja (default: true)
 * @param {boolean} [options.registryProbe] consultar o registry (default: true)
 * @param {boolean} [options.openDebt] ler o BOARD: as issues de drift abertas (default: true)
 * @param {number} [options.timeoutS]  limite por gate
 * @param {Function} [options.run]     `spawnSync` real ou dublê de teste
 * @param {object} [options.imageDeps] dependências repassadas ao check da imagem
 * @param {object} [options.imageRefsDeps] dependências do fato das referências
 * não versionadas (`env`/`probe`) — o ponto de injeção do teste
 * @param {object} [options.runnerLabelsDeps] dependências do fato do registro do
 * runner (`check`/`run`) — o ponto de injeção do teste
 * @param {object} [options.githubRunnerLabelsDeps] dependências do fato do
 * registro do runner do GitHub (`check`/`fetchImpl`/`env`) — o ponto de injeção do teste
 * @param {object} [options.proofDeps] dependências repassadas à prova do bloqueio
 * @param {object} [options.imageContractDeps] dependências do fato do contrato publicado
 * (`resolveIdentity`/`run`/`credentials`/`cwd`) — o ponto de injeção do teste
 * @param {object} [options.composeDeps] dependências repassadas à interpolação do compose
 * @param {object} [options.protectionDeps] dependências repassadas à leitura da branch protection
 * (`run` é o mesmo dublê dos gates: é por ele que a leitura da forja é injetada)
 * @param {Function} [options.identityProbe] o probe CRU da identidade da imagem
 * (default: `probeImageIdentity`) — o doutor o embrulha no cache COMPARTILHADO
 * pelos dois fatos que perguntam a mesma coisa; é por aqui que o teste conta
 * quantas idas ao registry a mesma pergunta custou
 * @param {object} [options.openDebtDeps] dependências do fato da dívida aberta
 * (`list` = a leitura do board, `now` = o relógio da idade) — o ponto de injeção
 * do teste, e o que mantém a suíte fora da rede
 * (`{prove}` substitui a prova inteira — é o ponto de injeção do teste)
 * @param {object} [options.identityProbe] quando fornecido, dispara o probe de
 * identidade do registry (cacheada entre os fatos que a perguntam)
 * @param {object} [options.gateContractsDeps] dependências do verificador
 * reutilizável de gates CORE (`readAllGateContracts` = dublê de teste)
 * @param {boolean} [options.preCommitProof] executar a PROVA DO BLOQUEIO LOCAL
 * (o `git commit` de verdade que mede se o pre-commit recusa um corpo `run:`
 * quebrado no ÍNDICE, default: true)
 * @param {object} [options.preCommitBlockDeps] dependências do fato da prova do
 * bloqueio local (`prove` substitui a prova inteira) — o ponto de injeção do
 * teste, e o que mantém o fluxo do veredito fora do git real
 * @param {boolean} [options.prePushProof] executar a PROVA DO BLOQUEIO DO PUSH
 * (o `git push` de verdade que mede se o pre-push recusa a ÁRVORE vermelha, sem
 * deixar objeto nenhum no remoto bare, default: true)
 * @param {object} [options.prePushBlockDeps] dependências do fato da prova do
 * bloqueio do push (`prove` substitui a prova inteira) — o ponto de injeção do
 * teste, e o que mantém o fluxo do veredito fora do git real
 * @param {object} [options.pushBypassDeps] dependências da MEDIDA DO LIMITE do
 * gate local (o `--no-verify` contorna o hook e quem barra é o CI;
 * `prove` substitui a medida inteira) — o ponto de injeção do teste
 * (sem `@returns` declarado de propósito: o formato dos fatos é o que o
 * `summarize` consome, e descrevê-lo aqui de novo só criaria duas verdades)
 */
export async function diagnose({
  cwd = REPO_ROOT,
  envFile = DEFAULT_ENV_FILE,
  env = process.env,
  expected = null,
  expectedVars = {},
  ciProfile = false,
  guards = true,
  proof = true,
  protection = true,
  runnerLabels = true,
  imageContract = true,
  composeRender = true,
  registryProbe = true,
  gateContractsCheck = true,
  openDebt = true,
  declaredDebt = true,
  preCommitProof = true,
  prePushProof = true,
  timeoutS = 120,
  run,
  imageDeps = {},
  imageRefsDeps = {},
  runnerLabelsDeps = {},
  /** Injeção do FATO do guard de recursão (`probe`) — o teste exercita os canais sem subprocesso. */
  nestedGuardDeps = {},
  githubRunnerLabelsDeps = {},
  proofDeps = {},
  composeDeps = {},
  protectionDeps = {},
  imageContractDeps = {},
  openDebtDeps = {},
  /** Injeção do FATO da dívida declarada (`collect`/`now`) — o teste mede o envelhecimento sem depender do relógio. */
  declaredDebtDeps = {},
  /** Injeção do FATO da herança de shell (`list`/`readFile`) — o teste mede os estados sem um checkout de verdade. */
  shellInheritanceDeps = {},
  /** Injeção do FATO da prova do bloqueio local (`prove`) — o teste mede os três estados sem rodar git. */
  preCommitBlockDeps = {},
  /** Injeção do FATO da prova do bloqueio do push (`prove`) — o teste mede os três estados sem rodar git. */
  prePushBlockDeps = {},
  /** Injeção da MEDIDA DO LIMITE do gate local (`prove`) — o teste mede os estados sem rodar git. */
  pushBypassDeps = {},
  /** Injeção do FATO dos comandos dos hooks (`analyze`) — o teste mede os estados sem um checkout de verdade. */
  hookCommandsDeps = {},
  identityProbe,
  gateContractsDeps = {},
} = {}) {
  const contractRun = runGate(
    { label: "check:required-checks", command: "bun run check:required-checks" },
    { cwd, timeoutS, run },
  )
  const contract = readContract(cwd)
  // A branch protection REGISTRADA é lida ANTES do gate do bring-up: o gate
  // cruza o contrato de merge com a proteção da forja (o check está registrado?),
  // e para isso precisa dos dados da proteção — a MESMA leitura que a seção 1
  // já faria, extraída para frente por dependência.
  const protectionFacts = protection
    ? readProtection({
        cwd,
        forges: contract.forges.map((f) => f.forge),
        run,
        ...protectionDeps,
      })
    : { state: "skipped", detail: "pulada por --no-protection", forges: [] }
  // O GATE do bring-up pergunta QUAIS jobs o contrato exige — a leitura do
  // manifesto é a MESMA (`readContract`, uma leitura de arquivo): o fato recebe
  // o que já foi lido e acrescenta só a linha `run:` das pipelines. Agora ele
  // TAMBÉM cruza com a branch protection registrada (o check está registrado?).
  const bringUpGate = readBringUpGate({ cwd, contract, protection: protectionFacts })
  // TODOS os gates CORE: o verificador genérico itera os `CORE_INVARIANTS` que
  // têm `jobIds` e confere, para cada um, o manifesto + pipeline + proteção.
  const readAllGates = gateContractsDeps.readAllGateContracts ?? readAllGateContracts
  const gateContracts = gateContractsCheck
    ? readAllGates({ cwd, contract, protection: protectionFacts })
    : null
  if (contractRun.code !== 0) {
    contract.failures.push(
      contractRun.code === null
        ? `check:required-checks não foi verificado: ${contractRun.error}`
        : `check:required-checks FALHOU (exit ${contractRun.code}) — o manifesto aponta para jobs que não existem, ou um obrigatório virou condicional`,
    )
  }

  const pipelinePath = join(cwd, MERGE_OWNER_PIPELINE)
  let gatesResult = { gates: [], error: null }
  if (existsSync(pipelinePath)) {
    gatesResult = forgeGates(readFileSync(pipelinePath, "utf8"))
  } else {
    gatesResult = { gates: [], error: `${MERGE_OWNER_PIPELINE}: ausente` }
  }

  // A bateria roda CONCORRENTE (ordem dos resultados preservada). Um `run`
  // injetado — dublê síncrono dos testes — volta ao caminho sequencial.
  const results = guards ? await runGatesConcurrent(gatesResult.gates, { cwd, timeoutS, run }) : []

  // UMA identidade do registry para os DOIS fatos que a perguntam (invariante 9
  // e o contrato da imagem publicada): sem o cache, o mesmo manifesto + config
  // blob eram lidos duas vezes. O probe cacheado entra como DEPENDÊNCIA — o que
  // um teste injetar em `imageRefsDeps`/`imageContractDeps` continua ganhando.
  const registryIdentity = createRegistryIdentityCache(
    identityProbe ? { probe: identityProbe } : {},
  )

  // O fato da imagem sai primeiro porque o CONTRATO PUBLICADO depende dele (o
  // `ref` resolvido pelo env é a fonte do alvo — uma leitura do env, não duas).
  const image = await readImage({ envFile, cwd, deps: imageDeps })

  // `protectionFacts` já foi computado ANTES do gate (o gate cruza com ele).
  // Aqui só os espelhos e a dívida dependem das duas leituras — não recompute
  // a proteção (duas medições do mesmo fato começam a divergir).
  const mirrorsFacts = readMirrors(cwd, { expected, expectedVars })
  // A IDADE da dívida DECLARADA sai ANTES da leitura do board: o próprio board
  // a usa como segunda testemunha (a issue do publicador caduca quando o doctor
  // mede as mesmas isenções e nenhuma venceu). Computar depois faria a leitura
  // do board responder com um fato que ainda não existe — ou pior, com uma
  // segunda medição do mesmo dado.
  const declaredDebtFacts = declaredDebt
    ? readDeclaredDebt({ cwd, deps: declaredDebtDeps })
    : {
        state: "skipped",
        detail: "pulada por --no-declared-debt",
        sources: [],
        aged: [],
        invalid: [],
        unread: [],
        total: 0,
      }
  const openDebtFacts = openDebt
    ? await readOpenDebt({
        cwd,
        env,
        deps: openDebtDeps,
        protection: protectionFacts,
        mirrors: mirrorsFacts,
        declaredDebt: declaredDebtFacts,
      })
    : {
        state: "skipped",
        detail: "pulada por --no-open-debt",
        reads: [],
        items: [],
        labels: DEBT_SUBJECTS.map((s) => s.label),
        excluded: DEBT_EXCLUDED,
      }

  const facts = {
    contract,
    bringUpGate,
    gateContracts,
    guards: { results, error: gatesResult.error ?? null, gates: gatesResult.gates },
    image,
    // A imagem publicada: exige a MESMA leitura do registry que o
    // `--no-registry-probe` desliga (o digest da tag vem de lá) — a flag pula
    // as duas, e o relatório diz qual das duas razões o fez ficar de fora.
    imageContract:
      imageContract && registryProbe
        ? await readImageContract({
            image,
            expected,
            cwd,
            env,
            deps: { resolveIdentity: registryIdentity, ...imageContractDeps },
          })
        : {
            state: "skipped",
            detail: imageContract
              ? "pulada por --no-registry-probe (o digest que a tag serve vem do registry)"
              : "pulada por --no-image-contract",
            ref: image.ref ?? null,
            digest: null,
            target: null,
            expectedVersion: expected,
            findings: null,
            remedies: [],
          },
    proof: proof
      ? await readProof({ cwd, deps: proofDeps })
      : { status: "skipped", detail: "prova do bloqueio pulada (proof=false)", cases: [] },
    compose: composeRender
      ? await readComposeInterpolation({ cwd, hostEnv: envFile, deps: composeDeps })
      : {
          state: "skipped",
          violations: [],
          detail: "pulada por --no-compose-render",
          hostCompare: { state: "skipped", detail: "pulada por --no-compose-render" },
        },
    // As forjas saem do MANIFESTO (uma fonte): um manifesto que ganhe uma
    // terceira forja entra na leitura sozinho.
    protection: protectionFacts,
    // SEM `envPath`: a DESCOBERTA do guard já cobre o template comitado E o
    // `deploy/.env.gitea` do checkout quando ele existe — que é o caso do VPS,
    // justamente onde os dois importam. Apontar um arquivo (`--gitea-env`)
    // SUBSTITUI a descoberta (semântica do CLI do guard, para perguntar por
    // OUTRO host), e aí o template sairia da comparação — regressão silenciosa
    // no host onde o valor mais importa.
    imageRefs: await readImageRefs({
      cwd,
      envFile,
      deps: { probeRegistry: registryProbe, probe: registryIdentity, ...imageRefsDeps },
    }),
    // O `envFile` só é repassado quando NÃO é o default: o default do doctor
    // (`deploy/.env.gitea`) significa "use a DESCOBERTA do guard" — e a
    // descoberta prefere o arquivo do host e cai no template comitado quando
    // ele não existe. Repassá-lo cru trocaria isso por `env-missing` em todo
    // checkout que não seja o VPS (o guard não inventa um baseline).
    runnerLabels: runnerLabels
      ? readRunnerLabels({
          cwd,
          envFile: envFile === DEFAULT_ENV_FILE ? null : envFile,
          deps: runnerLabelsDeps,
        })
      : {
          state: "skipped",
          detail: "pulada por --no-runner-labels",
          violations: [],
          remedies: [],
        },
    // A outra forja, com a MESMA flag: as duas são "o registro do runner", e
    // separá-las em duas flags faria a segunda ser esquecida.
    githubRunnerLabels: runnerLabels
      ? await readGithubRunnerLabels({ cwd, env, deps: githubRunnerLabelsDeps })
      : {
          state: "skipped",
          detail: "pulada por --no-runner-labels",
          violations: [],
          remedies: [],
        },
    mirrors: mirrorsFacts,
    openDebt: openDebtFacts,
    // A IDADE da dívida DECLARADA: pura leitura de arquivo (sem rede, credencial
    // ou estado do HOST), então ela entra ATÉ no perfil --ci — é no PR que a
    // isenção vencida precisa aparecer, não só no cron. MEDIDA UMA VEZ (acima):
    // o mesmo objeto serve ao veredito e à caducidade da issue do board.
    declaredDebt: declaredDebtFacts,
    // A HERANÇA DE SHELL dos workflows: leitura de checkout (sem rede, sem
    // credencial, sem estado do HOST), então ela entra ATÉ no perfil `--ci` — e
    // é ali que ela mais serve: no PR a bateria de guards está pulada, e sem
    // este fato uma declaração de `defaults:` que ligue o pipefail viajaria em
    // silêncio até o cron semanal.
    shellInheritance: readShellInheritance({ cwd, deps: shellInheritanceDeps }),
    // O CONTRATO LOCAL, EM UM FATO SÓ — as TRÊS partes do mesmo assunto: os
    // DOIS elos EXECUTADOS aqui (um `git commit` de verdade, duas vezes: o corpo
    // quebrado no ÍNDICE tem de ser RECUSADO e o controle com o corpo fechado tem
    // de ENTRAR; e um `git push` de verdade contra um remoto BARE, duas vezes: a
    // árvore VERMELHA tem de ser recusada sem deixar um objeto sequer do outro
    // lado e a verde tem de CHEGAR) MAIS os comandos que cada hook RODA, pela
    // régua do `check-hook-commands` (importada — não há uma segunda leitura) MAIS
    // o LIMITE do gate local (o `git push --no-verify` CHEGA ao remoto e o comando
    // do gate do CI reprova o conteúdo clonado — a parte que impede o fato de
    // sugerir que "o pre-push está provado" significa "a árvore vermelha não
    // chega a main").
    //
    // Local de ponta a ponta (sem rede, sem credencial, sem estado do HOST) e
    // ~0,7s no total (medido: 0,58s sem a medida do limite, 0,72s com ela): entra
    // ATÉ no perfil `--ci`, porque é no PR que a promessa
    // dos hooks importa (eles rodam na máquina de quem commita e de quem empurra;
    // o CI não os executa). O `--no-pre-commit-proof` e o `--no-pre-push-proof`
    // NÃO saem daqui para uma flag paralela do relatório: o elo desligado entra
    // como `skipped` DENTRO do fato, e o veredito lê a falta de prova no MESMO
    // lugar em que lê a prova.
    localContract: readLocalContract({
      cwd,
      executed: { "pre-commit": preCommitProof, "pre-push": prePushProof },
      deps: {
        preCommit: preCommitBlockDeps,
        prePush: prePushBlockDeps,
        analyzeHooks: hookCommandsDeps,
        bypass: pushBypassDeps,
      },
    }),
    // O GUARD DE RECURSÃO, como fato do relatório NORMAL: a prontidão declara a
    // EXISTÊNCIA da defesa (e por quais canais ela responde), não só o disparo
    // dela — que vira um relatório à parte, com o estado `fired`.
    nestedGuard: recursionGuardFacts(nestedGuardDeps),
    ciProfile,
    skippedGuards: !guards,
    skippedProtection: !protection,
    skippedRunnerLabels: !runnerLabels,
    skippedRegistryProbe: !registryProbe,
    skippedImageContract: !imageContract,
    skippedOpenDebt: !openDebt,
    skippedDeclaredDebt: !declaredDebt,
    skippedGateContracts: !gateContractsCheck,
    skippedProof: !proof,
  }

  return { facts }
}

async function main() {
  // DEFESA EM PROFUNDIDADE contra recursão: a prova (seção 4) executa o
  // bring-up, que executa o doctor. O corte primário é o DOCTOR_SCRIPT
  // (dublagem), mas este guard é a segunda camada — se o stub falhar ou
  // for removido, o doctor recusa em vez de recursar infinitamente.
  //
  // A marca vale por DOIS canais (env var OU flag): quem não controla o
  // ambiente do filho passa `--proof-nested` e tem a mesma defesa.
  if (isNestedDoctorInvocation()) {
    // O corte continua IMEDIATO (antes do parseArgs, para o ciclo não avançar
    // nem um passo). O que muda é que a causa passa a sair no canal do
    // RELATÓRIO (stdout, ou o JSON de `--json`) — antes ela vivia só no stderr,
    // e o exit 3 (o mesmo de uso inválido) não dizia QUAL dos dois era.
    console.error(
      `forge-doctor: DETECTADO RECURSAO — ${NESTED_GUARD_ENV} definido ou ` +
        `${NESTED_GUARD_FLAG} passado. ` +
        `O doctor ja esta rodando DENTRO da propria prova. O ciclo ` +
        `bring-up → doctor → prova → bring-up foi interrompido por este ` +
        `guard (defesa em profundidade contra o corte via DOCTOR_SCRIPT).`,
    )
    const report = nestedGuardReport()
    if (process.argv.includes("--json")) console.log(JSON.stringify(report, null, 2))
    else renderReport(report)
    process.exit(NESTED_GUARD_EXIT)
  }
  const opts = parseArgs(process.argv.slice(2))
  if (opts.error) {
    console.error(`forge-doctor: ${opts.error}`)
    console.error(USAGE)
    process.exit(3)
  }
  if (opts.help) {
    console.log(USAGE)
    process.exit(0)
  }

  const { facts } = await diagnose(opts)
  const verdict = summarize(facts)
  const report = { facts, verdict }

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    renderReport(report)
  }

  process.exit(verdict.verdict === VERDICT.READY ? 0 : verdict.verdict === VERDICT.BLOCKED ? 1 : 2)
}

const IS_DIRECT_RUN =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (IS_DIRECT_RUN) await main()
