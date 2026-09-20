/**
 * pre-commit-proof.mjs
 *
 * A camada do hook `.husky/pre-commit` SOBRE o simulador compartilhado
 * (`hook-simulator.mjs`): as constantes do hook (o guard, o remédio, o fecho
 * transitivo), os defeitos do fixture e as duas formas de executá-lo — SOMADO
 * (`runHook`) e PELO GIT (`writeHooksShim` + `runCommit`).
 *
 * E a PROVA de ponta a ponta que o `forge-doctor` publica como fato próprio:
 * `proveCommitBlocks()` roda um `git commit` de VERDADE duas vezes — com o corpo
 * `run:` quebrado no índice (tem de ser BLOQUEADO: zero objetos de commit) e com
 * o corpo fechado (tem de ENTRAR: um objeto, e o conteúdo no HEAD) — porque sem
 * a segunda metade "não commitou" seria indistinguível de um fixture que não
 * sabe commitar.
 *
 * E a MESMA prova SEM O DUBLÊ (`proveRealHookBlocks`, no fim do arquivo): o hook
 * REAL sobre uma CÓPIA do checkout, com os cinco guards de fase A rodando de
 * verdade. As duas formas medem o mesmo fato em dois lugares — o fixture mede o
 * FIO do hook; a cópia mede o hook inteiro, o ambiente inteiro.
 *
 * Os DOIS consumidores (o doctor e os testes dos hooks) importam DAQUI: a régua
 * é uma só, e a divergência entre duas cópias apareceria como uma prova que mede
 * outra coisa.
 *
 * Usage:
 *   import { proveCommitBlocks } from "./pre-commit-proof.mjs"
 *
 *   const r = proveCommitBlocks()   // { state, detail, evidencia }
 *   r.state   // "proven" | "violated" | "unavailable"
 *
 * Exit codes:
 *   (módulo — sem CLI próprio; o veredito é o `state` acima, e o doctor o
 *   publica como provado/violado/indisponível)
 */

import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
// O diretório de workflow das forjas vem da FONTE ÚNICA (cravar o literal aqui
// deixaria as outras forjas fora da varredura — foi assim que a pipeline dona do
// merge ficou fora da cobertura dos guards).
import { GITHUB_WORKFLOW_DIR } from "./forge-workflows.mjs"
import {
  REPO_ROOT,
  cleanupFixtures,
  commitObjects,
  committedContent,
  copiaDoCheckout,
  headExists,
  isExecutable,
  novoRepo as novoRepoSim,
  runGit,
  runSourcedHook,
  stage,
  wrapperSource,
  writeHook,
} from "./hook-simulator.mjs"

/** O hook REAL do repositório (o arquivo que o git executa num commit). */
export const HOOK = join(REPO_ROOT, ".husky", "pre-commit")

/**
 * O corpo do hook REAL. É função (e não const) de propósito: ler no import faria
 * um consumidor que só quer as constantes — o doctor num checkout sem `.husky/`
 * — morrer na importação em vez de reportar `unavailable`.
 *
 * @param {string} [root]
 * @returns {string|null}
 */
export function hookSource(root = REPO_ROOT) {
  const path = join(root, ".husky", "pre-commit")
  if (!existsSync(path)) return null
  return readFileSync(path, "utf8")
}

export const GUARD = "check-workflow-run-syntax.mjs"

/**
 * O OUTRO guard de fase A que a prova passa pelo dublê: o da fonte única do Bun.
 *
 * Ele já está no fecho (a régua do que é um COMPOSE vem dele), então atravessá-lo
 * não custa uma cópia a mais — e é o que permite provar no hook REAL o defeito
 * que o recorte das linhas ADICIONADAS não vê: o commit que REMOVE o arg de um
 * build site (a régua compara o bloco do ÍNDICE com o de HEAD).
 */
export const BUN_GUARD = "check-bun-mirror.mjs"
/** O REMÉDIO que o hook oferece quando o guard acima reprova (com confirmação). */
export const REMEDY = "pre-commit-remedy.mjs"

/**
 * A linha do hook que torna o guard REAL no fixture. Se ela mudar, o fixture
 * deixa de tornar real o comando certo — e as mutações viram no-op silencioso.
 * Por isso ela é asserida, não presumida.
 */
export const GUARD_COMMAND = `node scripts/${GUARD} --staged &`

/** A linha do hook que roda o guard do Bun no modo do índice. */
export const BUN_GUARD_COMMAND = `node scripts/${BUN_GUARD} --staged &`

/** A linha do hook que torna o REMÉDIO real no fixture (é ele que elege o veredito). */
export const REMEDY_COMMAND = `node scripts/${REMEDY} && REMEDIO=0 || true`

/**
 * O fecho transitivo do guard (ele + os imports locais). É o que o fixture
 * copia: sem o fecho completo o guard morreria com "module not found" e o
 * não-zero do hook seria do fixture, não do defeito. O remédio entra aqui porque
 * ele IMPORTA o guard e SPAWNA o guard — as duas metades do veredito do hook.
 */
export const GUARD_CLOSURE = [
  GUARD,
  REMEDY,
  "check-pipefail-sigpipe.mjs",
  "ensure-runner-image.mjs",
  "forge-workflows.mjs",
  "allowlist-review.mjs",
  // A TERCEIRA FONTE puxou estas duas: a régua do que é um COMPOSE
  // (`COMPOSE_FILE_RE`) vem do `check-bun-mirror`, que por sua vez deriva a
  // versão do Bun da fonte única (`bun-version`). Sem elas o fecho morre com
  // "module not found" e o não-zero do hook seria do FIXTURE, não do defeito — é
  // exatamente o que o teste de completude existe para pegar.
  "check-bun-mirror.mjs",
  "bun-version.mjs",
  // E o RESOLVEDOR do registry/namespace entrou pelo `ensure-runner-image` (que
  // deixou de cravar o literal de reserva e passa a ler o valor DECLARADO por
  // ele): é a mesma régua do teste de completude — uma referência nova aparece
  // nomeada, em vez de virar um controle verde por acidente.
  "registry-source.mjs",
  // A DECLARAÇÃO dos shells do runner (e o probe que a mediu) passou a ser
  // importada pelo guard: o dono dela é o módulo da medição, e o gate importa em
  // vez de manter a cópia. Sem esta linha o fixture morreria com "module not
  // found" e o não-zero do hook seria do FIXTURE, não do defeito — o teste de
  // completude acusou a referência nova na hora (`closureProblems`), que é
  // exatamente o desfecho certo: uma dependência nova aparece NOMEADA.
  "runner-shells.mjs",
  // O REMENDO DO CAMINHO TIPADO entrou no fecho: a classe `hook-commands` do
  // remédio IMPORTA a régua do guard dono (`check-hook-commands`) — que importa a
  // tokenização (`shellTokens`), o resolvedor do comando canônico do CI e a
  // PERGUNTA compartilhada. O par que o `check-hook-commands` puxa
  // (`check-hook-ci-parity` → `check-forge-parity`) entra junto. Sem estas
  // linhas o fecho morre com "module not found" e o não-zero do hook seria do
  // FIXTURE, não do defeito — que é exatamente o que o `closureProblems`
  // existe para nomear.
  "check-hook-commands.mjs",
  "confirm-prompt.mjs",
  "check-hook-ci-parity.mjs",
  "check-forge-parity.mjs",
  // A CONSTRUÇÃO DO PATCH do remédio virou módulo COMPARTILHADO pelo `--fix`
  // dos DOIS fixers mecânicos (`check-workflow-run-syntax` e
  // `check-pipefail-sigpipe` importam os dois): um hunk sem CONTEXTO é recusado
  // pelo `git apply`, e o patch que o comentário do PR publica tem de aplicar
  // byte a byte. O `check-pipefail-sigpipe` JÁ estava no fecho, e passou a
  // depender deste na hora em que o preview dele ganhou o mesmo patch — o teste
  // de completude (`closureProblems`) acusou as duas referências novas na hora,
  // que é exatamente o desfecho certo: dependência nova aparece NOMEADA, em vez
  // de virar um controle verde por acidente (o fixture morreria com "module not
  // found" e o não-zero do hook seria do FIXTURE, não do defeito).
  "unified-patch.mjs",
  // A OFERTA DO REMÉDIO virou DESCOBERTA: o driver deixou de ter a lista à mão e
  // passa a importar `remedy-classes.mjs`, que varre `scripts/remedy-classes/`.
  // Os declarations são importados por CAMINHO CALCULADO (a varredura não é
  // estática), então o `closureProblems` não os vê — é a CONTAGEM de classes
  // deste fecho que responde por eles: sem a pasta (ou com uma declaração a
  // menos) o fixture roda um remédio com oferta incompleta, e é o exit 2 da
  // recusa que aparece, não um verde por acidente.
  "remedy-classes.mjs",
  "remedy-shell-guard.mjs",
  "remedy-classes/run-syntax.mjs",
  "remedy-classes/crlf.mjs",
  "remedy-classes/blob-crlf.mjs",
  "remedy-classes/utf8.mjs",
  "remedy-classes/hook-commands.mjs",
  // A SEXTA classe entrou com o guard dono DELA no hook (fase B): a varredura do
  // `check-pipefail-sigpipe` e a mesma do CI, e o remendo (`--fix` -> herestring)
  // passa a ser oferecido no momento do defeito. A declaração importa o `fixAll`
  // do dono, e o DONO já viajava neste fecho; o que faltava era a declaração — o
  // fixture roda um remédio com oferta incompleta sem ela, e a recusa (exit 2)
  // apareceria como veredito do defeito, que é exatamente o que o comentário
  // acima descreve.
  "remedy-classes/pipefail-sigpipe.mjs",
  // E OS GUARDS DONOS das três classes de ENCODING viajam com as declarações:
  // a descoberta RECUSA a rodada quando uma declaração cita um dono que não
  // existe NESTE repositório, então um fixture com as declarações e sem os donos
  // é uma árvore INCONSISTENTE — o remédio sairia 2 antes de julgar o commit, e
  // um não-zero vindo da OFERTA seria lido como veredito do defeito. Declaração e
  // guard dono são um par que anda junto (é o que o diretório significa).
  "check-crlf.sh",
  "check_crlf.py",
  "check-blob-crlf.sh",
  "check_blob_crlf.py",
  "check-utf8.sh",
  "check_utf8.py",
  // A FASE A REAL (a prova do LUGAR roda os irmãos SEM o dublê) precisa dos
  // QUATRO guards do ÍNDICE no fecho: sem eles o fixture morreria com "module not
  // found" e o não-zero do hook seria do FIXTURE, não do defeito — o mesmo
  // desfecho que o `closureProblems` existe para nomear. As dependências deles
  // (`check-bun-mirror`, `forge-workflows`, `allowlist-review`) já viajavam aqui.
  "check-mutation-jobs.mjs",
  "check-unused-deps.mjs",
  "check-mutation-timing-contract.mjs",
  // O CANAL DO REMEDIO entrou no fecho porque o `check-forge-parity` passou a
  // importar o REGISTRO de fixers (`FIXERS`) dele: a regra 5 da paridade mede a
  // COBERTURA do canal nas duas forjas, e uma lista de fixers escrita no guard
  // envelheceria no primeiro fixer novo — que e exatamente o que a regra existe
  // para impedir. A cadeia que vem junto (a mecanica do comentario e o
  // publicador de issue) nao tem dependencia de pacote: ela e copiada para o
  // fixture, e o teste de completude (`closureProblems`) acusa a referencia
  // nova na hora em vez de deixar o fixture morrer com "module not found".
  "pr-remedy-comment.mjs",
  "pr-comment-channel.mjs",
  "issue-publish.mjs",
]

export const WORKFLOW = `${GITHUB_WORKFLOW_DIR}/ci.yml`
export const SHELL_SCRIPT = "scripts/quebrado.sh"

/**
 * A cicatriz MECÂNICA no índice: bloco literal cujo corpo termina em operador
 * pendente. É o único defeito que o remédio SABE remendar — e é por isso que ele
 * separa "o hook bloqueia" de "o hook bloqueia e ainda oferece o caminho".
 */
export const WORKFLOW_CICATRIZ =
  "name: CI\n" +
  "on: [push]\n" +
  "jobs:\n" +
  "  build:\n" +
  "    runs-on: ubuntu-latest\n" +
  "    steps:\n" +
  "      - run: |\n" +
  '          echo "um" &&\n'

/** `if` sem `fi` — a reescrita mecânica que trunca o corpo de um `run: |`. */
export const WORKFLOW_QUEBRADO =
  "name: CI\n" +
  "on: [push]\n" +
  "jobs:\n" +
  "  build:\n" +
  "    runs-on: ubuntu-latest\n" +
  "    steps:\n" +
  "      - run: |\n" +
  "          if [ -f x ]; then\n" +
  "          echo oi\n"

/** O mesmo corpo, fechado. */
export const WORKFLOW_VALIDO =
  "name: CI\n" +
  "on: [push]\n" +
  "jobs:\n" +
  "  build:\n" +
  "    runs-on: ubuntu-latest\n" +
  "    steps:\n" +
  "      - run: |\n" +
  "          if [ -f x ]; then\n" +
  "            echo oi\n" +
  "          fi\n"

/** `if` sem `fi` num arquivo de shell — a outra metade do mesmo guard. */
export const SHELL_QUEBRADO = "#!/usr/bin/env bash\nset -eu\nif [ -f x ]; then\necho oi\n"

/**
 * O nome da variável que AFIRMA o desfecho do remédio sem rodá-lo (`REMEDY_STUB`).
 *
 * É o único jeito de exercitar a DIREÇÃO "o remédio saiu 0": no harness o stdin
 * do hook é um pipe e o remédio real nunca sai 0. O nome tem UM dono (aqui),
 * importado por quem o usa — o dublê, os testes e o benchmark da oferta.
 */
export const REMEDY_STUB_ENV = "REMEDY_STUB"

/**
 * O corpo do dublê: soma o hook real depois de trocar os binários por funções.
 *
 * `node` só é real para o GUARD sob teste; para os irmãos de fase ele devolve 0
 * (declarado — eles não são o assunto). `command node` atravessa a função, o
 * que mantém o interpretador verdadeiro (e não uma segunda implementação do
 * `node`) no caminho do guard.
 */
/**
 * Os dublês do hook, com os guards que a prova atravessa (os REAIS).
 *
 * `passthrough` é o que muda por prova: o guard de sintaxe dos `run:` está SEMPRE
 * no caminho (é o contrato histórico), e uma prova do recorte de compose passa o
 * guard do Bun junto — sem que isso mude o fixture dos outros testes (um irmão de
 * fase a mais rodando de verdade reprovaria controles que não são o assunto dele).
 */
function specsDoWrapper(passthrough = []) {
  return [
    {
      tool: "node",
      match: REMEDY,
      // O dublê da DIREÇÃO: `REMEDY_STUB_ENV` afirma o desfecho do remédio sem rodá-lo.
      overrideVar: REMEDY_STUB_ENV,
      why:
        `\`${REMEDY_STUB_ENV}\` afirma o desfecho do REMÉDIO sem rodá-lo (é o único jeito\n` +
        'de exercitar a DIREÇÃO "o remédio saiu 0": no harness o stdin do hook é\n' +
        "um pipe e o remédio real nunca sai 0). Declarado, e usado por um teste.",
    },
    { tool: "node", match: GUARD },
    ...passthrough.map((match) => ({ tool: "node", match })),
    { tool: "bun" },
    { tool: "bash" },
  ]
}

export const WRAPPER_SOURCE = wrapperSource(specsDoWrapper())

/** O diretório que `core.hooksPath` aponta — relativo à raiz do fixture. */
export const HOOKS_DIR = ".husky"

/**
 * Um repositório git de verdade com o fecho do guard e o dublê do hook.
 *
 * `passthrough` soma guards REAIS ao dublê (o default não muda nenhuma prova
 * existente); o fecho copiado é o MESMO — ele já contém os dois.
 *
 * @param {{passthrough?: string[], prefix?: string}} [opts]
 * @returns {string}
 */
export function novoRepo({ passthrough = [], prefix = "pre-commit-runsyntax-" } = {}) {
  return novoRepoSim({
    prefix,
    closure: GUARD_CLOSURE,
    wrapper: passthrough.length === 0 ? WRAPPER_SOURCE : wrapperSource(specsDoWrapper(passthrough)),
    dirs: [GITHUB_WORKFLOW_DIR],
  })
}

/**
 * As referências LOCAIS (`from "./x.mjs"` e `new URL("./x.mjs", ...)`) que NÃO
 * estão no fecho declarado. Uma referência nova aparece AQUI, nomeada, em vez de
 * virar um controle verde por acidente (o teste mediria o fixture).
 *
 * @param {string} [root]
 * @returns {string[]}
 */
export function closureProblems(root = REPO_ROOT) {
  const faltando = []
  for (const f of GUARD_CLOSURE) {
    const path = join(root, "scripts", f)
    if (!existsSync(path)) {
      faltando.push(`${f} → ausente do checkout`)
      continue
    }
    const src = readFileSync(path, "utf8")
    for (const re of [/from\s+"\.\/([^"]+\.mjs)"/g, /new URL\("\.\/([^"]+\.mjs)"/g]) {
      for (const m of src.matchAll(re)) {
        if (!GUARD_CLOSURE.includes(m[1])) faltando.push(`${f} → ${m[1]}`)
      }
    }
  }
  return faltando
}

/**
 * As dependências NÃO relativas do fecho (o que o fixture tem de RESOLVER).
 *
 * Um `import`/`require` de pacote é a outra metade do fecho que a lista acima
 * não vê: copiar só os `.mjs` deixa o guard sem o parser, e o não-zero que a
 * prova mediria seria do fixture. Aqui elas são LIDAS do fonte (não declaradas à
 * mão), então uma dependência nova aparece sozinha no probe do teste.
 *
 * @param {string} [root]
 * @returns {string[]}
 */
export function naoRelativos(root = REPO_ROOT) {
  const achados = new Set()
  const formas = [
    /\bfrom\s+"([^"]+)"/g,
    /\brequire\(\s*"([^"]+)"\s*\)/g,
    /\bimport\(\s*"([^"]+)"\s*\)/g,
  ]
  for (const f of GUARD_CLOSURE) {
    const path = join(root, "scripts", f)
    if (!existsSync(path)) continue
    // Comentário fora: prosa que CITA um pacote não é dependência dele.
    const fonte = readFileSync(path, "utf8")
      .split("\n")
      .filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l))
      .join("\n")
    for (const re of formas) {
      for (const m of fonte.matchAll(re)) {
        const spec = m[1]
        if (spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("node:")) continue
        achados.add(spec)
      }
    }
  }
  return [...achados].sort()
}

/**
 * Roda o hook (real ou mutado) somado pelo dublê, com o repo temporário como
 * CWD. É a forma da prova que SUMA o hook — a de `git commit` está abaixo.
 *
 * @param {string} dir
 * @param {string} hookSourceTexto
 * @param {Record<string, string>} [extraEnv]
 */
export function runHook(dir, hookSourceTexto, extraEnv = {}) {
  return runSourcedHook(dir, hookSourceTexto, extraEnv)
}

/**
 * Escreve o `pre-commit` do fixture em `.husky/pre-commit` (o que
 * `core.hooksPath` aponta) com o dublê, e o hook sob teste em `hook-under-test`.
 * Devolve o caminho do hook que o GIT vai executar.
 *
 * @param {string} dir
 * @param {string} [hookSourceTexto]
 * @returns {string}
 */
export function writeHooksShim(dir, hookSourceTexto) {
  const source = hookSourceTexto ?? hookSource()
  return writeHook(dir, { name: "pre-commit", source, hooksPath: HOOKS_DIR })
}

/**
 * Um `git commit` de VERDADE: é o git que invoca o hook do `hooksPath`, e o
 * exit code do hook é o que decide se o objeto de commit é criado.
 *
 * @param {string} dir
 * @param {Record<string, string>} [extraEnv]
 * @param {string[]} [args]
 */
export function runCommit(dir, extraEnv = {}, args = ["commit", "-m", "commit do fixture"]) {
  return runGit(dir, args, extraEnv)
}

// =============================================================================
// A PROVA DE PONTA A PONTA — os três desfechos que o doctor publica
// =============================================================================

/**
 * A evidência das DUAS metades, como ela sai no JSON do doctor: os campos são
 * medidos (exit code, objetos de commit no banco, HEAD, conteúdo no HEAD), não
 * deduzidos — é o que permite a quem lê conferir a prova sem reexecutá-la.
 *
 * @typedef {{
 *   status: number|null, output: string, objetosDeCommit: number, headExiste: boolean,
 *   linhaDoGuardNoHook?: boolean, bloqueadoPor?: string, conteudoEmHead?: string,
 * }} MetadeDaProva
 * @typedef {{defeito: MetadeDaProva, controle?: MetadeDaProva}} ProofEvidence
 *
 * O veredito da prova. `proven` = o hook BLOQUEOU o corpo quebrado no índice E o
 * controle comitou (as duas metades; sem a segunda, "não commitou" seria
 * indistinguível de um fixture que não sabe commitar). `violated` = o defeito
 * ENTROU no histórico. `unavailable` = não deu para provar (e nunca vira verde).
 *
 * @typedef {{
 *   state: "proven"|"violated"|"unavailable",
 *   detail: string,
 *   evidence: ProofEvidence|null,
 *   remedies: string[],
 * }} CommitBlockProof
 */

/** A evidência de cada metade, como TEXTO — legível no relatório e no JSON. */
function resumoCommit(res) {
  return {
    status: res.status,
    output: (res.output ?? "").trim().split("\n").slice(0, 4).join(" | "),
  }
}

/**
 * Roda a prova: um commit com o corpo `run:` quebrado no índice (tem de ser
 * RECUSADO) e o mesmo commit com o corpo fechado (tem de ENTRAR).
 *
 * `hookSourceTexto` permite MUTAR o hook (tirar a linha do guard) — é assim que
 * o veredito é medido a mudar, em vez de medido uma vez só.
 *
 * Tudo o que é condição de medição (git, bash, o hook, o fecho do guard, o
 * `node_modules`) sai como `unavailable` NOMEANDO o que faltou: uma prova que não
 * pôde rodar não é uma prova que passou.
 *
 * @param {{root?: string, hookSourceTexto?: string|null, timeoutMs?: number}} [opts]
 * @returns {CommitBlockProof}
 */
export function proveCommitBlocks({ root = REPO_ROOT, hookSourceTexto = null } = {}) {
  const remedies = [
    `o pre-commit tem de rodar '${GUARD_COMMAND.trim()}' (o guard do ÍNDICE): confira a fase que julga os corpos 'run:' em .husky/pre-commit`,
    `o hook precisa existir e ser EXECUTÁVEL: um hook sem o bit de execução é IGNORADO por git EM SILÊNCIO (o commit entra sem veredito)`,
  ]
  const fonte = hookSourceTexto ?? hookSource(root)
  if (fonte === null) {
    return {
      state: "unavailable",
      detail: `${join(root, ".husky", "pre-commit")} não existe neste checkout — não há o que provar`,
      evidence: null,
      remedies,
    }
  }
  // A linha literal do guard é OBSERVADA, não exigida: a prova mede
  // COMPORTAMENTO (o commit passa ou não passa), então um hook que reestruture
  // a fase — e continue bloqueando — segue provado. O que ela muda é o
  // diagnóstico: sem a linha, um veredito `violated` já nomeia o que devolver.
  const linhaDoGuard = fonte.includes(GUARD_COMMAND)
  const faltando = []
  if (!existsSync(join(root, "node_modules")))
    faltando.push("node_modules (o guard importa o parser)")
  const problems = closureProblems(root)
  if (problems.length > 0) faltando.push(`fecho do guard incompleto: ${problems.join(", ")}`)
  if (faltando.length > 0) {
    return {
      state: "unavailable",
      detail: `não dá para executar o hook real: ${faltando.join("; ")}`,
      evidence: null,
      remedies,
    }
  }

  try {
    // ── METADE A: o defeito no ÍNDICE tem de ser BLOQUEADO ────────────────
    const dir = novoRepo()
    writeHooksShim(dir, fonte)
    stage(dir, WORKFLOW, WORKFLOW_QUEBRADO)
    const bloqueio = runCommit(dir)
    const objetos = commitObjects(dir)
    const comitou = headExists(dir)
    const evidencia = {
      defeito: {
        ...resumoCommit(bloqueio),
        objetosDeCommit: objetos,
        headExiste: comitou,
        linhaDoGuardNoHook: linhaDoGuard,
      },
    }

    if (bloqueio.status === 0 || objetos > 0 || comitou) {
      // A prova mais forte não é "criou um objeto": é o corpo QUEBRADO gravado
      // em HEAD — o defeito que o hook prometia não deixar passar.
      let entrou = `um objeto de commit foi criado (${objetos})`
      if (comitou) {
        try {
          const gravado = committedContent(dir, WORKFLOW)
          evidencia.defeito.conteudoEmHead =
            gravado === WORKFLOW_QUEBRADO ? "igual ao corpo quebrado" : "outro conteúdo"
          if (gravado === WORKFLOW_QUEBRADO)
            entrou = `o corpo quebrado foi GRAVADO em HEAD (${WORKFLOW})`
        } catch {
          evidencia.defeito.conteudoEmHead = "ilegível"
        }
      }
      return {
        state: "violated",
        detail:
          `o pre-commit NÃO bloqueou o corpo 'run:' quebrado no índice: ${entrou}` +
          ` — o defeito viaja no commit de quem confia no hook` +
          (linhaDoGuard ? "" : ` (e o hook não executa mais '${GUARD_COMMAND.trim()}')`),
        evidence: evidencia,
        remedies,
      }
    }
    // A saída do hook tem de NOMEAR o arquivo do defeito: um não-zero por
    // ambiente (hook quebrado, comando ausente) bloquearia por outro motivo e a
    // prova estaria medindo o fixture.
    if (!bloqueio.output.includes(WORKFLOW)) {
      return {
        state: "unavailable",
        detail: `o commit foi recusado, mas a saída do hook não cita ${WORKFLOW} — o não-zero veio de outro lugar (não do veredito do guard)`,
        evidence: evidencia,
        remedies,
      }
    }
    evidencia.defeito.bloqueadoPor = "a saída do hook cita o arquivo do defeito"

    // ── METADE B (o CONTROLE): o corpo fechado tem de ENTRAR ──────────────
    const controleDir = novoRepo()
    writeHooksShim(controleDir, fonte)
    stage(controleDir, WORKFLOW, WORKFLOW_VALIDO)
    const controle = runCommit(controleDir)
    const objetosControle = commitObjects(controleDir)
    const evidenciaControle = {
      controle: {
        ...resumoCommit(controle),
        objetosDeCommit: objetosControle,
      },
    }
    if (controle.status !== 0 || objetosControle !== 1) {
      return {
        state: "unavailable",
        detail: `o CONTROLE com o corpo válido não comitou (exit ${controle.status}, ${objetosControle} objeto(s)) — sem ele, o bloqueio medido na metade A não é do defeito`,
        evidence: { ...evidencia, ...evidenciaControle },
        remedies,
      }
    }
    const gravado = committedContent(controleDir, WORKFLOW)
    if (gravado !== WORKFLOW_VALIDO) {
      return {
        state: "unavailable",
        detail: `o CONTROLE comitou um conteúdo diferente do corpo válido (${WORKFLOW}) — o harness não está medindo o que diz`,
        evidence: { ...evidencia, ...evidenciaControle },
        remedies,
      }
    }

    return {
      state: "proven",
      detail:
        `um 'git commit' de verdade com o corpo 'run:' QUEBRADO no índice é RECUSADO ` +
        `(exit ${bloqueio.status}, ${objetos} objeto(s) de commit) e o mesmo commit com o corpo ` +
        `fechado ENTRA (exit ${controle.status}, ${objetosControle} objeto, conteúdo conferido em HEAD)` +
        (linhaDoGuard
          ? ""
          : ` — por um caminho que NÃO é a linha '${GUARD_COMMAND.trim()}' (a fase foi reestruturada; o comportamento é o que a prova mede)`),
      evidence: { ...evidencia, ...evidenciaControle },
      remedies,
    }
  } catch (err) {
    return {
      state: "unavailable",
      detail: `a prova do bloqueio não pôde rodar: ${err instanceof Error ? err.message : String(err)}`,
      evidence: null,
      remedies,
    }
  } finally {
    cleanupFixtures()
  }
}

// =============================================================================
// A MESMA PROVA SEM O DUBLÊ — o hook REAL sobre uma CÓPIA do checkout
// =============================================================================
//
// A prova acima roda o hook do checkout SOMADO ao dublê do simulador: os guards
// IRMÃOS do defeito devolvem 0 (declarado, e é o que mantém a medição sobre o
// FIO sob teste — o fixture não tem o `package.json` do projeto e a fase C
// morreria nele). Isso deixa UMA metade de fora: se os guards irmãos REAIS — os
// CINCO do índice que a fase A roda antes do gate — recusam o corpo quebrado, se
// simplesmente RODAM, e se o gate os substitui, a prova de cima não mede: quem
// rodava era o dublê.
//
// Aqui o mesmo `git commit` acontece sobre uma CÓPIA do checkout: o hook do
// `core.hooksPath` é o REAL, os cinco guards de fase A são os REAIS (sem
// wrapper, sem dublê), o gate é o REAL e a fase C (lint-staged, typecheck) roda
// de verdade — porque a cópia tem o `package.json` e o `node_modules` que o
// fixture não tem.
//
// TRÊS METADES, e a segunda é o que a primeira NÃO consegue dizer sozinha:
//
//   1. o DEFEITO (corpo `run:` aberto, num workflow NOVO) tem de ser RECUSADO:
//      exit não-zero e o HEAD intacto (a contagem de objetos não mede isso aqui: a
//      fase C roda de verdade e o `lint-staged` cria objetos próprios);
//   2. a ATRIBUIÇÃO é medida por EXIT CODE, não pelo relatório do hook: os CINCO
//      guards de fase A e o GATE, rodados DIRETAMENTE com o mesmo `--staged`
//      sobre o MESMO índice, têm de sair 0,0,0,0,0 e não-zero — respectivamente.
//      O texto do hook (os ✅/❌) entra como evidência e como rigor EXTRA (um
//      refutador que não seja o do gate derruba a prova), nunca como requisito:
//      a escrita de um processo em PIPE é assíncrona, e uma linha perdida não
//      pode virar um gate vermelho por acaso (um requisito de texto é flaky por
//      construção — e o exit code, não);
//   3. o CONTROLE (o mesmo arquivo com o corpo fechado) ENTRA — sem ele,
//      "recusou" seria indistinguível de um ambiente que não sabe commitar.
//
// O defeito é um arquivo NOVO justamente para o refutador ser ÚNICO: um defeito
// num workflow EXISTENTE faria outros guards (o contrato de merge do índice, a
// cobertura de mutation tests) reprovarem junto, e a recusa deixaria de ser
// atribuível. Se o arquivo já existir no checkout, a premissa caiu — e isso sai
// como INDETERMINADO nomeando o remédio, nunca como verde.

/**
 * O arquivo do defeito da prova SEM DUBLÊ: um workflow que NÃO existe no
 * checkout, para o refutador ser nomeável (o caminho é citado na saída do gate).
 */
export const REAL_WORKFLOW = `${GITHUB_WORKFLOW_DIR}/prova-fase-a-real.yml`

/** `if` sem `fi` — a reescrita mecânica que trunca o corpo de um `run:`. */
export const REAL_WORKFLOW_QUEBRADO =
  "name: prova fase A\n" +
  "on: [push]\n" +
  "jobs:\n" +
  "  build:\n" +
  "    runs-on: ubuntu-latest\n" +
  "    steps:\n" +
  "      - run: |\n" +
  "          if [ -f x ]; then\n" +
  "          echo oi\n"

/** O mesmo corpo, fechado — o CONTROLE. */
export const REAL_WORKFLOW_VALIDO =
  "name: prova fase A\n" +
  "on: [push]\n" +
  "jobs:\n" +
  "  build:\n" +
  "    runs-on: ubuntu-latest\n" +
  "    steps:\n" +
  "      - run: |\n" +
  "          if [ -f x ]; then\n" +
  "            echo oi\n" +
  "          fi\n"

/**
 * Os CINCO guards de FASE A — os que o hook roda em paralelo no recorte do
 * ÍNDICE, ANTES do gate. São eles que o dublê substituía por `exit 0`: rodá-los
 * aqui, com o mesmo `--staged` sobre o mesmo índice, é o que separa "o gate
 * recusou" de "a fase recusou" (e de "a fase nem rodou").
 *
 * A lista é a mesma do hook (`.husky/pre-commit`, fase A) e NÃO é lida dele de
 * propósito: um guard a mais no hook tem de aparecer AQUI, à mão, em vez de
 * entrar na prova por conta de um `grep` que ninguém conferiu.
 */
export const FASE_A_GUARDS = [
  "check-bun-mirror.mjs",
  "check-mutation-jobs.mjs",
  "check-unused-deps.mjs",
  "check-mutation-timing-contract.mjs",
  "check-required-checks.mjs",
]

/** O recorte que a fase A usa — o mesmo que o hook passa a cada um deles. */
export const FASE_A_RECORTE = "--staged"

/**
 * O marcador do INVARIANTE do gate no texto dele: o `bash -n` dos corpos `run:`.
 * É por ele que a recusa é atribuída ao gate — e não à prosa do relatório dele,
 * que pode ser reescrita sem mudar o que o gate mede.
 */
export const GATE_MARCADOR = "bash -n"

/**
 * Os veredictos de um relatório do hook, lidos do TEXTO (as linhas que os
 * próprios guards imprimem). Contar é o que permite dizer "um refutador só" —
 * e um refutador A MAIS (um irmão que também reprovou) é a diferença entre
 * "o gate recusou" e "a fase recusou".
 *
 * @param {string} saida
 * @returns {{aprovados: number, refutadores: string[]}}
 */
export function veredictosDoHook(saida) {
  const linhas = String(saida ?? "").split("\n")
  return {
    aprovados: linhas.filter((l) => /^\s*✅/.test(l)).length,
    refutadores: linhas
      .filter((l) => /^\s*❌/.test(l))
      .map((l) => l.trim())
      .filter(Boolean),
  }
}

/**
 * A ATRIBUIÇÃO da recusa: quem refutou, e se o defeito foi citado.
 *
 * O veredito do gate é o ÚNICO que pode estar aqui. Um refutador sem o marcador
 * do invariante do gate é OUTRO guard (ou o harness) — e o chamador trata isso
 * como prova indisponível, porque a metade que ela queria medir não foi medida.
 *
 * @param {string} saida
 * @param {string} [arquivo]
 * @returns {{aprovados: number, refutadores: string[], doGate: string[], outros: string[], citouArquivo: boolean}}
 */
export function atribuicaoDaRecusa(saida, arquivo = REAL_WORKFLOW) {
  const { aprovados, refutadores } = veredictosDoHook(saida)
  const doGate = refutadores.filter((l) => l.includes(GATE_MARCADOR))
  return {
    aprovados,
    refutadores,
    doGate,
    outros: refutadores.filter((l) => !l.includes(GATE_MARCADOR)),
    citouArquivo: String(saida ?? "").includes(arquivo),
  }
}

/**
 * Roda UM guard de fase A com o recorte do índice, no diretório dado, com o
 * `node` que EXECUTA esta prova (`process.execPath` — dentro da imagem do
 * runner é o node DO RUNTIME, não um `command -v` que poderia resolver outro).
 *
 * @param {string} dir
 * @param {string} guard
 * @param {{run?: typeof spawnSync, node?: string, recorte?: string}} [deps]
 * @returns {{guard: string, status: number|null, linha: string}}
 */
export function rodaGuardDeFaseA(dir, guard, deps = {}) {
  const run = deps.run ?? spawnSync
  const node = deps.node ?? process.execPath
  const recorte = deps.recorte ?? FASE_A_RECORTE
  const r = run(node, [join("scripts", guard), recorte], {
    cwd: dir,
    encoding: "utf8",
    timeout: 120_000,
  })
  const saida = `${r?.stdout ?? ""}${r?.stderr ?? ""}`.trim()
  return {
    guard,
    status: r?.status ?? null,
    linha: saida.split("\n").filter(Boolean).slice(-1)[0] ?? "",
  }
}

/**
 * O SHA de `HEAD` (ou `null` se não há commit) — a medida que a prova SEM
 * DUBLÊ usa no lugar da CONTAGEM de objetos: a fase C roda de verdade na cópia, e
 * o `lint-staged` cria objetos de commit por conta própria (o stash interno dele),
 * de modo que `objetos` deixa de ser um proxy de "o commit entrou". O que o
 * commit recusado não move é o HEAD.
 *
 * @param {string} dir
 * @returns {string|null}
 */
export function shaDoHead(dir) {
  const r = runGit(dir, ["rev-parse", "HEAD"])
  if (r.status !== 0) return null
  const sha = r.output.trim().split("\n")[0] ?? ""
  return sha === "" ? null : sha
}

/**
 * A prova do bloqueio SEM O DUBLÊ.
 *
 * Mesmo contrato de `proveCommitBlocks` (state/detail/evidence/remedies) e a
 * mesma régua tri-estado: `proven` exige as TRÊS metades medidas, `violated` é o
 * defeito que ENTROU, e tudo o que for condição de medição — git, bash, a cópia,
 * o bit de execução do hook, um irmão que reprovou — sai como `unavailable`
 * NOMEANDO o que faltou.
 *
 * @param {{root?: string, deps?: {run?: typeof spawnSync, node?: string, existe?: (p: string) => boolean}}} [opts]
 * @returns {CommitBlockProof}
 */
export function proveRealHookBlocks({ root = REPO_ROOT, deps = {} } = {}) {
  const run = deps.run ?? spawnSync
  const existe = deps.existe ?? existsSync
  const remedies = [
    `o hook REAL tem de existir E ser EXECUTÁVEL: um hook sem o bit de execução é IGNORADO por git EM SILÊNCIO (o commit entra sem veredito)`,
    `os CINCO guards de fase A e o gate (${GUARD}) têm de existir em scripts/: sem eles a fase A não roda, e o não-zero seria do ambiente`,
    `\`node_modules\` tem de existir no checkout (a fase C roda de verdade na cópia: \`lint-staged\` e \`typecheck\`)`,
    `a cópia precisa do \`git\` e do \`bash\` vivos (o commit é um \`git commit\` de verdade, e o hook é um script de shell)`,
  ]
  const faltando = []
  if (!existe(join(root, "node_modules"))) faltando.push("node_modules no checkout")
  if (hookSource(root) === null) faltando.push(`${join(root, ".husky", "pre-commit")} não existe`)
  for (const g of [...FASE_A_GUARDS, GUARD]) {
    if (!existe(join(root, "scripts", g))) faltando.push(`scripts/${g}`)
  }
  // O defeito precisa ser um arquivo NOVO: num workflow EXISTENTE outros guards
  // reprovariam junto e a recusa deixaria de ser atribuível ao gate.
  if (existe(join(root, REAL_WORKFLOW))) {
    return {
      state: "unavailable",
      detail:
        `a premissa do defeito caiu: ${REAL_WORKFLOW} JÁ EXISTE no checkout. A prova precisa de um arquivo NOVO ` +
        `para o refutador ser único (um defeito num workflow existente faz outros guards reprovarem junto, e a recusa ` +
        `deixa de ser atribuível ao gate) — renomeie \`REAL_WORKFLOW\` em scripts/pre-commit-proof.mjs`,
      evidence: null,
      remedies,
    }
  }
  if (faltando.length > 0) {
    return {
      state: "unavailable",
      detail: `não dá para rodar o hook REAL sem dublê: faltou ${faltando.join("; ")}`,
      evidence: null,
      remedies,
    }
  }

  try {
    const copia = copiaDoCheckout({ root })
    // O bit de execução ANTES de qualquer commit: um hook não-executável é
    // ignorado por git EM SILÊNCIO, e o verde mediria um hook que não rodou.
    if (!isExecutable(join(copia, ".husky", "pre-commit"))) {
      return {
        state: "unavailable",
        detail: `o hook da cópia (${join(copia, ".husky", "pre-commit")}) NÃO é executável: git o ignora em SILÊNCIO, e um commit que entra por isso mede o oposto do que a prova diz`,
        evidence: null,
        remedies,
      }
    }
    runGit(copia, ["init", "-q"])
    runGit(copia, ["config", "user.email", "pre-commit-proof@local"])
    runGit(copia, ["config", "user.name", "pre-commit proof"])
    runGit(copia, ["add", "-A"])
    const base = runGit(copia, ["commit", "-q", "-m", "base da cópia"])
    if (base.status !== 0) {
      return {
        state: "unavailable",
        detail: `a cópia do checkout não sabe commitar (exit ${base.status} no commit base): ${base.output.trim().split("\n").slice(-1)[0] || "sem saída"} — sem isso não há o que medir`,
        evidence: null,
        remedies,
      }
    }
    // O `hooksPath` entra DEPOIS do commit base (o base não é o assunto) e o
    // hook do `hooksPath` é o do CHECKOUT, copiado — não há wrapper, nem dublê.
    runGit(copia, ["config", "core.hooksPath", ".husky"])
    const objetosBase = commitObjects(copia)
    const headBase = shaDoHead(copia)

    // ── METADE 1: o defeito no ÍNDICE tem de ser RECUSADO pelo GATE ────────
    stage(copia, REAL_WORKFLOW, REAL_WORKFLOW_QUEBRADO)
    const bloqueio = runGit(copia, ["commit", "-m", "defeito (corpo `run:` aberto)"])
    const objetosDepois = commitObjects(copia)
    const headDepois = shaDoHead(copia)
    const atribuicao = atribuicaoDaRecusa(bloqueio.output)
    const evidencia = {
      defeito: {
        status: bloqueio.status,
        output: bloqueio.output.trim().split("\n").slice(0, 4).join(" | "),
        objetosDeCommit: objetosDepois,
        headExiste: headExists(copia),
        objetosAntes: objetosBase,
        headAntes: headBase,
        headDepois,
        aprovados: atribuicao.aprovados,
        refutadores: atribuicao.refutadores,
        citouArquivo: atribuicao.citouArquivo,
      },
      irmaos: [],
    }
    if (bloqueio.status === null) {
      return {
        state: "unavailable",
        detail: `o \`git commit\` do defeito não terminou (o teto por comando do simulador, \`runGit\`, ou um sinal) — o veredito não foi medido`,
        evidence: evidencia,
        remedies,
      }
    }
    if (bloqueio.status === 0 || headDepois !== headBase) {
      return {
        state: "violated",
        detail:
          `o hook REAL (sem dublê) NÃO bloqueou o corpo 'run:' quebrado no índice: ` +
          `exit ${bloqueio.status} e o HEAD ${headDepois === headBase ? "NÃO avançou" : `avançou de ${String(headBase).slice(0, 12)} para ${String(headDepois).slice(0, 12)}`} — ` +
          `o defeito viaja no commit de quem confia no hook`,
        evidence: evidencia,
        remedies,
      }
    }
    if (atribuicao.outros.length > 0) {
      return {
        state: "unavailable",
        detail:
          `o gate recusou o defeito, mas ${atribuicao.outros.length} OUTRO(S) guard(s) refutaram junto ` +
          `(${atribuicao.outros.join(" · ")}): a recusa não é atribuível ao gate, e a prova não pode dizer o que ela diz medir`,
        evidence: evidencia,
        remedies,
      }
    }

    // ── METADE 2: a ATRIBUIÇÃO por EXIT CODE, no MESMO índice ─────────────
    // Cada guard roda DIRETAMENTE, com o mesmo recorte do hook. É aqui que a
    // pergunta "quem recusa o corpo quebrado" é respondida por medição (exit
    // code) e não pela prosa do relatório: se um dos CINCO reprovasse o defeito,
    // a recusa do commit não seria do gate; e um guard que não roda (exit != 0
    // por ambiente) aparece aqui, em vez de virar verde.
    const irmaos = FASE_A_GUARDS.map((g) => rodaGuardDeFaseA(copia, g, { run, node: deps.node }))
    const gate = rodaGuardDeFaseA(copia, GUARD, { run, node: deps.node })
    evidencia.irmaos = irmaos
    evidencia.gate = gate
    const irmaosVermelhos = irmaos.filter((i) => i.status !== 0)
    if (irmaosVermelhos.length > 0) {
      return {
        state: "unavailable",
        detail:
          `os guards de fase A NÃO aprovaram o MESMO índice (${irmaosVermelhos.map((i) => `${i.guard}=${i.status}`).join(", ")}): ` +
          `a recusa do commit não é atribuível ao gate — ela pode ser de um irmão (ou de um irmão que não rodou)`,
        evidence: evidencia,
        remedies,
      }
    }
    if (gate.status === 0) {
      return {
        state: "unavailable",
        detail:
          `o GATE APROVOU o índice do defeito numa medição DIRETA (exit 0 sobre ${REAL_WORKFLOW}): ` +
          `a recusa do commit NÃO é a dele — sem uma metade vermelha nomeada, a prova não pode dizer que a fase A recusa o corpo quebrado`,
        evidence: evidencia,
        remedies,
      }
    }
    if (gate.status === null) {
      return {
        state: "unavailable",
        detail: `a medição direta do gate não terminou (o teto por comando do simulador ou um sinal) — o veredito dele não foi medido`,
        evidence: evidencia,
        remedies,
      }
    }

    // ── METADE 3 (o CONTROLE): o corpo fechado tem de ENTRAR ──────────────
    stage(copia, REAL_WORKFLOW, REAL_WORKFLOW_VALIDO)
    const controle = runGit(copia, ["commit", "-m", "controle (corpo fechado)"])
    const objetosControle = commitObjects(copia)
    const headControle = shaDoHead(copia)
    evidencia.controle = {
      status: controle.status,
      output: controle.output.trim().split("\n").slice(0, 4).join(" | "),
      objetosDeCommit: objetosControle,
      headAntes: headBase,
      headDepois: headControle,
    }
    if (controle.status === null) {
      return {
        state: "unavailable",
        detail: `o \`git commit\` do CONTROLE não terminou (o teto por comando do simulador, \`runGit\`, ou um sinal) — sem ele, o bloqueio medido na metade 1 não é do defeito`,
        evidence: evidencia,
        remedies,
      }
    }
    if (controle.status !== 0 || headControle === headBase) {
      return {
        state: "unavailable",
        detail:
          `o CONTROLE com o corpo válido não comitou (exit ${controle.status}, HEAD ${headControle === headBase ? "NÃO avançou" : "avançou"}): ` +
          `sem ele, o bloqueio medido na metade 1 não é do defeito (o ambiente pode simplesmente não saber commitar)`,
        evidence: evidencia,
        remedies,
      }
    }
    const gravado = committedContent(copia, REAL_WORKFLOW)
    evidencia.controle.conteudoEmHead =
      gravado === REAL_WORKFLOW_VALIDO ? "igual ao corpo válido" : "outro conteúdo"
    if (gravado !== REAL_WORKFLOW_VALIDO) {
      return {
        state: "unavailable",
        detail: `o CONTROLE comitou um conteúdo diferente do corpo válido (${REAL_WORKFLOW}) — a cópia não está medindo o que a prova diz`,
        evidence: evidencia,
        remedies,
      }
    }

    return {
      state: "proven",
      detail:
        `o hook REAL (sem o dublê dos irmãos) RECUSOU o corpo 'run:' quebrado no índice ` +
        `(exit ${bloqueio.status}, HEAD intacto em ${String(headBase).slice(0, 12)}, ${atribuicao.aprovados} guard(s) aprovando, ${atribuicao.refutadores.length} refutador(es) no relatório dele) ` +
        `e quem recusa é o GATE: '${GATE_MARCADOR}', o recorte --staged, medido DIRETAMENTE em exit ${gate.status}` +
        (atribuicao.citouArquivo
          ? ` e citando ${REAL_WORKFLOW} no relatório do hook`
          : ` (o relatório do hook não citou ${REAL_WORKFLOW} — a linha pode ter se perdido no pipe; o que decide é o exit code)`) +
        `; os ${irmaos.length} guards de fase A rodaram de verdade sobre o MESMO índice e saíram 0; ` +
        `o mesmo commit com o corpo fechado ENTROU (exit ${controle.status}, HEAD em ${String(headControle).slice(0, 12)}, conteúdo conferido em HEAD)`,
      evidence: evidencia,
      remedies,
    }
  } catch (err) {
    return {
      state: "unavailable",
      detail: `a prova SEM DUBLÊ não pôde rodar: ${err instanceof Error ? err.message : String(err)}`,
      evidence: null,
      remedies,
    }
  } finally {
    cleanupFixtures()
  }
}
