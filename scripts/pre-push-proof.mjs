/**
 * pre-push-proof.mjs
 *
 * A camada do hook `.husky/pre-push` SOBRE o simulador compartilhado
 * (`hook-simulator.mjs`): as constantes do hook (os comandos das fases, o
 * smart-skip), o defeito do fixture e as duas formas de executá-lo — SOMADO
 * (`runHook`) e PELO GIT (`writeHooksShim` + `runPush`).
 *
 * E a PROVA de ponta a ponta que o `forge-doctor` publica como fato próprio — o
 * OUTRO ELO do contrato local (`pre-commit-proof.mjs` é o primeiro):
 * `provePushBlocks()` roda um `git push` de VERDADE contra um remoto BARE duas
 * vezes — com a árvore VERMELHA (tem de ser BLOQUEADO: zero ref e ZERO objeto do
 * outro lado) e com a árvore VERDE (tem de CHEGAR: a ref existe e o conteúdo
 * bate) — porque sem a segunda metade "nada chegou" seria indistinguível de um
 * fixture que não sabe empurrar.
 *
 * POR QUE A PROMESSA AQUI É OUTRA (e não uma cópia da do commit): o git CONSULTA
 * o remoto ANTES de rodar o hook e só manda o pack DEPOIS dele. No commit o
 * veredito é "nenhum objeto de COMMIT foi criado"; no push é "nenhum OBJETO de
 * qualquer tipo chegou ao REMOTO" — medido no banco do remoto (`countObjects`) e
 * nas refs dele (`refsOf`), nunca no stdout de ninguém. As duas metades precisam
 * ser medidas no mesmo lugar: é o remoto que prova (ou não) o push.
 *
 * Os DOIS consumidores (o doctor e o teste `pre-push-git-push-blocks.test.ts`)
 * importam DAQUI: a régua é uma só, e a divergência entre duas cópias apareceria
 * como uma prova que mede outra coisa.
 *
 * O que é REAL e o que é DUBLÊ (declarado, nunca implícito):
 *
 *   - REAL: `bun run typecheck` — o comando do hook, executado pelo binário
 *     verdadeiro, e o desfecho vem do CONTEÚDO versionado do `src/foo.ts` do
 *     fixture (`ERRO_DE_TIPO`), não de um arquivo fora do git. O `package.json`
 *     do fixture aponta o script para um payload que REGISTRA cada invocação: é
 *     assim que se prova que o processo real rodou (uma mutação mede o contrário);
 *   - DUBLÊ: `bash scripts/run-encoding-guards.sh` (irmão de fase — o runner dos
 *     encoding guards não existe no fixture, e ele não é o assunto) e o `curl` do
 *     bloco ADVISORY do Lighthouse. O `curl` não é conforto: ele é o que torna o
 *     push DETERMINÍSTICO. O bloco termina num
 *     `SCORE=$(curl … | python3 …)` dentro de um `if` — sob `set -eu`, uma
 *     substituição de comando que falha derruba o hook. Numa máquina com um dev
 *     server de pé na porta 3000 mas sem `/api/health` respondendo, o push VERDE
 *     seria recusado por um motivo que não é do repositório; o dublê devolve 1
 *     ("Server not running"), que é o caminho que o hook já sabe tratar.
 *
 * Usage:
 *   import { provePushBlocks } from "./pre-push-proof.mjs"
 *
 *   const r = provePushBlocks()   // { state, detail, evidence, remedies }
 *   r.state   // "proven" | "violated" | "unavailable"
 *
 * Exit codes:
 *   (módulo — sem CLI próprio; o veredito é o `state` acima, e o doctor o
 *   publica como provado/violado/indisponível)
 */

import { existsSync, readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { join } from "node:path"

import {
  REPO_ROOT,
  bareRemote,
  cleanupFixtures,
  commitObjects,
  contentAtRef,
  countObjects,
  novoRepo as novoRepoSim,
  refsOf,
  runGit,
  runSourcedHook,
  stage,
  wrapperSource,
  writeHook,
} from "./hook-simulator.mjs"

/** O hook REAL do repositório (o arquivo que o git executa num push). */
export const HOOK = join(REPO_ROOT, ".husky", "pre-push")

/**
 * O corpo do hook REAL. É função (e não const) de propósito: ler no import faria
 * um consumidor que só quer as constantes — o doctor num checkout sem `.husky/` —
 * morrer na importação em vez de reportar `unavailable`.
 *
 * @param {string} [root]
 * @returns {string|null}
 */
export function hookSource(root = REPO_ROOT) {
  const path = join(root, ".husky", "pre-push")
  if (!existsSync(path)) return null
  return readFileSync(path, "utf8")
}

/** O nome do hook que o git procura no `core.hooksPath`. */
export const HOOK_NAME = "pre-push"
/** O diretório que `core.hooksPath` aponta — relativo à raiz do fixture. */
export const HOOKS_DIR = ".husky"

/**
 * O comando do hook que a prova torna REAL no fixture: a fase que julga a ÁRVORE
 * (o typecheck). É a linha cuja ausência uma mutação remove para medir que ela é
 * load-bearing.
 */
export const TYPECHECK_COMMAND = "bun run typecheck"

/**
 * O irmão de fase do hook (`run-encoding-guards.sh`). Ele aparece aqui para que o
 * dublê seja DECLARADO contra o texto do hook: se a linha mudar, o dublê deixa de
 * cobrir o comando certo e o fixture passa a rodar (ou a não rodar) outra coisa.
 */
export const ENCODING_GUARDS_COMMAND = "bash scripts/run-encoding-guards.sh"

/** O marcador do defeito: o conteúdo que TORNA a árvore vermelha. */
export const MARCADOR = "ERRO_DE_TIPO"

/** O rastro de que o processo REAL do typecheck rodou (e quantas vezes). */
export const LOG = "typecheck-invocado.log"

/** O arquivo do fixture cujo conteúdo versionado eletiva o veredito. */
export const ARVORE_ARQUIVO = "src/foo.ts"

/** A frase que o payload imprime quando reprova — o veredito, não o ambiente. */
export const FRASE_DA_REPROVACAO = "TYPECHECK_DO_FIXTURE_REPROVOU"

/** A árvore BASE, comitada antes de o hook existir (ela não é o assunto). */
export const ARVORE_BASE = 'export const oi = "base"\n'
/** A árvore VERDE: o typecheck do fixture passa. */
export const ARVORE_BOA = 'export const oi = "verde"\n'
/** A árvore VERMELHA: o defeito é o CONTEÚDO versionado, não o ambiente. */
export const ARVORE_RUIM = `export const oi: number = "${MARCADOR}"\n`

/** O script que o fixture declara como o `typecheck` do seu `package.json`. */
export const PAYLOAD_FILE = "scripts/typecheck-fixture.mjs"

/**
 * O PAYLOAD declarado do `bun run typecheck` do fixture: o veredito vem do
 * conteúdo versionado, e a linha do log é o rastro do processo real.
 */
export const PAYLOAD = `// O PAYLOAD declarado do \`bun run typecheck\` do fixture.
import { appendFileSync, readFileSync } from "node:fs"

// A linha é o rastro de que o PROCESSO REAL rodou (e quantas vezes): sem ela,
// "não chegou nada ao remoto" seria compatível com um dublê que mentiu.
appendFileSync("${LOG}", "typecheck\\n")

const fonte = readFileSync("${ARVORE_ARQUIVO}", "utf8")
if (fonte.includes("${MARCADOR}")) {
  console.error("${ARVORE_ARQUIVO}(1,8): error TS2322: ${FRASE_DA_REPROVACAO}")
  process.exit(1)
}
console.log("typecheck do fixture: OK")
`

/** O `package.json` do fixture: o typecheck aponta para o PAYLOAD acima. */
export const PACKAGE_JSON = `${JSON.stringify(
  {
    name: "fixture-hook-push",
    private: true,
    scripts: { typecheck: `node ${PAYLOAD_FILE}` },
  },
  null,
  2,
)}\n`

/**
 * O dublê do hook. `node` não aparece porque o hook não o chama direto (o
 * typecheck o spawna como processo de verdade, fora do dublê).
 *
 * O `match` do `bun` é o que LIBERA o processo real do typecheck; todo o resto do
 * `bun` (e o `bash` dos encoding guards, e o `curl` do bloco advisory) é dublê
 * declarado — o `why` de cada um está no texto gerado.
 */
export const WRAPPER_SOURCE = wrapperSource([
  {
    tool: "bun",
    match: "typecheck",
    why: "o comando sob teste é REAL: o dublê só o reconhece para liberar `command bun`",
  },
  {
    tool: "bash",
    why: `irmão de fase (${ENCODING_GUARDS_COMMAND}): não existe no fixture e não é o assunto`,
  },
  {
    tool: "curl",
    code: 1,
    why: "o bloco ADVISORY do Lighthouse tem de ser determinístico: 1 = 'Server not running',\nque é o caminho que o hook sabe tratar (sob `set -eu`, um `curl` que falha\nDENTRO do bloco derrubaria um push legítimo por um motivo do ambiente)",
  },
])

/**
 * Um repositório git de verdade com o dublê do hook (a forma somada).
 *
 * O fixture NÃO copia o fecho de nenhum guard: o comando sob teste é o typecheck,
 * que o fixture declara inteiro no próprio `package.json`. O que o simulador
 * linka é o `node_modules` real, para o resto do hook resolver exatamente como
 * resolve na máquina de quem empurra.
 */
export function novoRepo() {
  return novoRepoSim({
    prefix: "pre-push-push-",
    wrapper: WRAPPER_SOURCE,
    dirs: ["scripts", "src"],
  })
}

/**
 * Roda o hook (real ou mutado) somado pelo dublê, com o repo temporário como CWD.
 *
 * @param {string} dir
 * @param {string} hookSourceTexto
 * @param {Record<string, string>} [extraEnv]
 */
export function runHook(dir, hookSourceTexto, extraEnv = {}) {
  return runSourcedHook(dir, hookSourceTexto, extraEnv)
}

/**
 * Escreve o `pre-push` do fixture no `hooksPath` (o que `core.hooksPath` aponta)
 * com o dublê, e o hook sob teste em `hook-under-test`. Devolve o caminho do hook
 * que o GIT vai executar.
 *
 * @param {string} dir
 * @param {string} [hookSourceTexto]
 * @returns {string}
 */
export function writeHooksShim(dir, hookSourceTexto) {
  const source = hookSourceTexto ?? hookSource()
  return writeHook(dir, { name: HOOK_NAME, source, hooksPath: HOOKS_DIR })
}

/**
 * Um `git push` de VERDADE: é o git que invoca o hook do `hooksPath`, e o exit
 * code do hook é o que decide se o pack sai (e o que chega ao remoto).
 *
 * @param {string} dir
 * @param {string} [remoto] nome ou caminho do remoto (default: `origin`)
 * @param {Record<string, string>} [extraEnv]
 * @param {string[]} [args]
 */
export function runPush(dir, remoto = "origin", extraEnv = {}, args = ["push", remoto, "main"]) {
  return runGit(dir, args, extraEnv)
}

/**
 * Quantas vezes o payload do typecheck rodou; `null` = o processo real NUNCA foi
 * executado.
 *
 * @param {string} dir
 * @returns {number|null}
 */
export function invocacoesDoPayload(dir) {
  const caminho = join(dir, LOG)
  if (!existsSync(caminho)) return null
  return readFileSync(caminho, "utf8").split("\n").filter(Boolean).length
}

/**
 * Monta o fixture COMPLETO da prova: o repo de trabalho, o remoto BARE e o
 * `pre-push` escrito por ÚLTIMO.
 *
 * A base é comitada ANTES de o hook existir — ela não é o assunto, e um hook que
 * bloqueasse o próprio setup faria a prova medir o fixture. O commit sob teste
 * muda `src/foo.ts`: o smart-skip do hook precisa de um arquivo que NÃO seja
 * doc/config (`SKIP_PATTERN`) e que não mapeie para nenhum teste afetado — é
 * assim que ele chega no `else` do fast path (a fase 2 do hook é independente
 * dele, e as duas invocações do typecheck ficam medidas).
 *
 * O `HEAD~1` do smart-skip vem daí: no primeiro push não há `@{u}`, e a base
 * comitada é o que dá ao hook um ponto de comparação real.
 *
 * @param {{arvore?: "verde"|"vermelha", hookSourceTexto?: string, wrapper?: string}} [opts]
 * @returns {{dir: string, remoto: string, hook: string}}
 */
export function montaPushFixture({ arvore = "verde", hookSourceTexto, wrapper } = {}) {
  const dir = novoRepoSim({
    prefix: "pre-push-push-",
    wrapper: wrapper ?? WRAPPER_SOURCE,
    dirs: ["scripts", "src"],
  })
  stage(dir, "package.json", PACKAGE_JSON)
  stage(dir, PAYLOAD_FILE, PAYLOAD)
  stage(dir, ARVORE_ARQUIVO, ARVORE_BASE)
  const base = runGit(dir, ["commit", "-q", "-m", "base"])
  if (base.status !== 0) throw new Error(`o fixture não conseguiu comitar a base: ${base.output}`)
  runGit(dir, ["branch", "-M", "main"])
  const remoto = bareRemote()
  runGit(dir, ["remote", "add", "origin", remoto])
  stage(dir, ARVORE_ARQUIVO, arvore === "vermelha" ? ARVORE_RUIM : ARVORE_BOA)
  const mudanca = runGit(dir, ["commit", "-q", "-m", "mudança sob teste"])
  if (mudanca.status !== 0) {
    throw new Error(`o fixture não conseguiu comitar a mudança: ${mudanca.output}`)
  }
  const hook = writeHook(dir, {
    name: HOOK_NAME,
    source: hookSourceTexto ?? hookSource() ?? "",
    hooksPath: HOOKS_DIR,
  })
  return { dir, remoto, hook }
}

// =============================================================================
// A PROVA DE PONTA A PONTA — os três desfechos que o doctor publica
// =============================================================================

/**
 * A evidência das DUAS metades, como ela sai no JSON do doctor: os campos são
 * MEDIDOS (exit code, refs do remoto, objetos no banco do remoto, invocações do
 * processo real, conteúdo na ref), não deduzidos — é o que permite a quem lê
 * conferir a prova sem reexecutá-la.
 *
 * @typedef {{
 *   status: number|null, output: string, refs: string[], objetosNoRemoto: number,
 *   invocacoes: number|null, linhaDoTypecheckNoHook?: boolean,
 *   conteudoNaRef?: string, comitouNoLocal?: number,
 * }} MetadeDoPush
 * @typedef {{defeito: MetadeDoPush, controle?: MetadeDoPush}} PushProofEvidence
 *
 * O veredito da prova. `proven` = o hook BLOQUEOU a árvore vermelha (zero ref e
 * zero objeto no remoto) E o controle EMPURROU a árvore verde (as duas metades;
 * sem a segunda, "nada chegou" seria indistinguível de um fixture que não sabe
 * empurrar). `violated` = o defeito CHEGOU ao remoto. `unavailable` = não deu
 * para provar (e nunca vira verde).
 *
 * @typedef {{
 *   state: "proven"|"violated"|"unavailable",
 *   detail: string,
 *   evidence: PushProofEvidence|null,
 *   remedies: string[],
 * }} PushBlockProof
 */

/** A evidência de cada metade, como TEXTO — legível no relatório e no JSON. */
function resumoPush(res) {
  return {
    status: res.status,
    output: (res.output ?? "").trim().split("\n").slice(-4).join(" | "),
  }
}

/**
 * O `bun` do hook resolve? Sem ele a fase 2 do hook morre com `command not found`
 * e o push seria recusado por um motivo que NÃO é o defeito — a medição estaria
 * medindo o ambiente. Por isso ele é pré-condição EXPLÍCITA da prova (`unavailable`
 * nomeando o que faltou), e não um detalhe descoberto no meio.
 *
 * @returns {boolean}
 */
function bunResolve() {
  const r = spawnSync("bun", ["--version"], { encoding: "utf8", timeout: 20_000 })
  return r.status === 0
}

/**
 * Roda a prova: um push com a árvore VERMELHA (tem de ser BLOQUEADO, com zero ref
 * e zero objeto no remoto) e o mesmo push com a árvore VERDE (tem de CHEGAR).
 *
 * `hookSourceTexto` permite MUTAR o hook (tirar a linha do typecheck) — é assim
 * que o veredito é medido a mudar, em vez de medido uma vez só.
 *
 * Tudo o que é condição de medição (git, bash, o hook, o `bun`, o remoto bare)
 * sai como `unavailable` NOMEANDO o que faltou: uma prova que não pôde rodar não
 * é uma prova que passou.
 *
 * @param {{root?: string, hookSourceTexto?: string|null}} [opts]
 * @returns {PushBlockProof}
 */
export function provePushBlocks({ root = REPO_ROOT, hookSourceTexto = null } = {}) {
  const remedies = [
    `o pre-push tem de rodar '${TYPECHECK_COMMAND}' (a fase que julga a ÁRVORE): confira .husky/pre-push`,
    "o hook precisa existir e ser EXECUTÁVEL: um hook sem o bit de execução é IGNORADO por git EM SILÊNCIO (o push entra sem veredito)",
  ]
  const fonte = hookSourceTexto ?? hookSource(root)
  if (fonte === null) {
    return {
      state: "unavailable",
      detail: `${join(root, ".husky", "pre-push")} não existe neste checkout — não há o que provar`,
      evidence: null,
      remedies,
    }
  }
  // A linha literal do typecheck é OBSERVADA, não exigida: a prova mede
  // COMPORTAMENTO (o push passa ou não passa), então um hook que reestruture a
  // fase — e continue bloqueando — segue provado. O que ela muda é o
  // diagnóstico: sem a linha, um veredito `violated` já nomeia o que devolver.
  const linhaDoTypecheck = fonte.includes(TYPECHECK_COMMAND)
  if (!bunResolve()) {
    return {
      state: "unavailable",
      detail: `não dá para executar o hook real: \`bun\` não resolve neste ambiente (a fase '${TYPECHECK_COMMAND}' morreria com 'command not found', e o não-zero do hook seria do ambiente, não do defeito)`,
      evidence: null,
      remedies,
    }
  }

  try {
    // ── METADE A: a árvore VERMELHA tem de ser BLOQUEADA ──────────────────
    const vermelho = montaPushFixture({
      arvore: "vermelha",
      ...(hookSourceTexto === null ? {} : { hookSourceTexto }),
    })
    if (refsOf(vermelho.remoto).length !== 0 || countObjects(vermelho.remoto) !== 0) {
      throw new Error("o remoto bare do fixture não estava vazio antes do push")
    }
    const bloqueio = runPush(vermelho.dir, "origin")
    const refsDefeito = refsOf(vermelho.remoto)
    const objetosDefeito = countObjects(vermelho.remoto)
    const invocacoes = invocacoesDoPayload(vermelho.dir)
    const evidencia = {
      defeito: {
        ...resumoPush(bloqueio),
        refs: refsDefeito,
        objetosNoRemoto: objetosDefeito,
        invocacoes,
        linhaDoTypecheckNoHook: linhaDoTypecheck,
        comitouNoLocal: commitObjects(vermelho.dir),
      },
    }

    if (bloqueio.status === 0 || refsDefeito.length > 0 || objetosDefeito > 0) {
      const chegou =
        objetosDefeito > 0
          ? `${objetosDefeito} objeto(s) e ${refsDefeito.length} ref(s) chegaram ao remoto`
          : `o remoto ganhou ${refsDefeito.length} ref(s)`
      return {
        state: "violated",
        detail:
          `o pre-push NÃO bloqueou a árvore VERMELHA: ${chegou}` +
          ` — o defeito viaja para a forja de quem confia no hook` +
          (linhaDoTypecheck ? "" : ` (e o hook não executa mais '${TYPECHECK_COMMAND}')`),
        evidence: evidencia,
        remedies,
      }
    }
    // A recusa tem de vir do VEREDITO. Um não-zero por ambiente (hook quebrado,
    // comando ausente) bloquearia por outro motivo e a prova estaria medindo o
    // fixture — por isso a saída tem de citar a reprovação do payload.
    if (!bloqueio.output.includes(FRASE_DA_REPROVACAO)) {
      return {
        state: "unavailable",
        detail: `o push foi recusado, mas a saída do hook não cita '${FRASE_DA_REPROVACAO}' — o não-zero veio de outro lugar (não do veredito do typecheck)`,
        evidence: evidencia,
        remedies,
      }
    }
    if (!invocacoes) {
      return {
        state: "unavailable",
        detail: `o push foi recusado citando '${FRASE_DA_REPROVACAO}', mas o processo REAL do typecheck não registrou invocação — o veredito não veio do fixture versionado`,
        evidence: evidencia,
        remedies,
      }
    }
    evidencia.defeito.bloqueadoPor = "a saída do hook cita a reprovação do typecheck"

    // ── METADE B (o CONTROLE): a árvore VERDE tem de CHEGAR ───────────────
    const verde = montaPushFixture({
      arvore: "verde",
      ...(hookSourceTexto === null ? {} : { hookSourceTexto }),
    })
    const controle = runPush(verde.dir, "origin")
    const refsControle = refsOf(verde.remoto)
    const objetosControle = countObjects(verde.remoto)
    const evidenciaControle = {
      controle: {
        ...resumoPush(controle),
        refs: refsControle,
        objetosNoRemoto: objetosControle,
        invocacoes: invocacoesDoPayload(verde.dir),
      },
    }
    if (controle.status !== 0 || refsControle.length === 0 || objetosControle === 0) {
      return {
        state: "unavailable",
        detail: `o CONTROLE com a árvore VERDE não chegou ao remoto (exit ${controle.status}, ${refsControle.length} ref(s), ${objetosControle} objeto(s)) — sem ele, o bloqueio medido na metade A não é do defeito`,
        evidence: { ...evidencia, ...evidenciaControle },
        remedies,
      }
    }
    const gravado = contentAtRef(verde.remoto, "refs/heads/main", ARVORE_ARQUIVO)
    evidenciaControle.controle.conteudoNaRef = gravado
    if (gravado !== ARVORE_BOA) {
      return {
        state: "unavailable",
        detail: `o CONTROLE chegou ao remoto com outro conteúdo em ${ARVORE_ARQUIVO} — o harness não está medindo o que diz`,
        evidence: { ...evidencia, ...evidenciaControle },
        remedies,
      }
    }

    return {
      state: "proven",
      detail:
        `um 'git push' de verdade com a árvore VERMELHA é RECUSADO ` +
        `(exit ${bloqueio.status}, ${refsDefeito.length} ref(s), ${objetosDefeito} objeto(s) no remoto) e o ` +
        `mesmo push com a árvore VERDE CHEGA (exit ${controle.status}, ${refsControle.join(", ")}, ` +
        `${objetosControle} objeto(s), conteúdo conferido na ref)` +
        (linhaDoTypecheck
          ? ""
          : ` — por um caminho que NÃO é a linha '${TYPECHECK_COMMAND}' (a fase foi reestruturada; o comportamento é o que a prova mede)`),
      evidence: { ...evidencia, ...evidenciaControle },
      remedies,
    }
  } catch (err) {
    return {
      state: "unavailable",
      detail: `a prova do bloqueio do push não pôde rodar: ${err instanceof Error ? err.message : String(err)}`,
      evidence: null,
      remedies,
    }
  } finally {
    cleanupFixtures()
  }
}
