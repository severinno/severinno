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
  headExists,
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
