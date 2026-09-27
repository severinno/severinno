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
 * REAL sobre uma CÓPIA do checkout, com os seis guards de fase A rodando de
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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

import { DOCS, escreverDocs } from "./bench-table.mjs"
// O CAMINHO do registro versionado e a RÉGUA da matriz saem do próprio guard
// (`check-mutation-count.mjs`): o fixture e o veredito falam do MESMO arquivo e
// do MESMO parser — uma segunda cópia do caminho divergiria no dia do primeiro
// ajuste, e a divergência apareceria como "o fixture recusa o que o guard não".
import { BENCH_PATH, run as runCountGuard } from "./check-mutation-count.mjs"
import { MASTER_DOS_SUBTESTS, comMetadesDaMatriz, metadesDaMatriz } from "./bench-families.mjs"
// A RÉGUA do fecho de imports é a MESMA das suítes de mutação (uma só régua para
// quem copia módulo para fixture — ver `docs/GUARDS.md`, "O FIXTURE QUE NÃO
// CARREGA"): este arquivo tinha a descida PRÓPRIA dele (regex de `from` e de
// `new URL`) e ela não via o `import("./x.mjs")` LITERAL — a aresta medida no
// `ensure-runner-image.mjs` → `prove-runner-image-gate.mjs`.
import { fechoDeImports } from "./fecho-imports.mjs"
// OS ARTEFATOS do fixture são DERIVADOS do que os guards do hook LEEM (por
// execução — ver `artefatos-do-hook.mjs`): o caminho do compose não mora aqui, e
// sim na medição. Antes desta régua o fixture levava uma LISTA À MÃO que não sabia
// de guard novo, e um guard fail-closed sobre um artefato lia INFRA na cópia (o
// vermelho era do FIXTURE) — foi o que deixou o `check-runner-tag` declarado em
// `HOOK_NOT_RUN` até alguém acrescentar o caminho à mão.
import { artefatosDoHookMemo } from "./artefatos-do-hook.mjs"
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
  harnessPath,
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

/**
 * A guarda da DECLARAÇÃO da imagem do act_runner (a tag pina versão?) e a linha
 * do hook que a executa.
 *
 * A linha é o MESMO comando do CI (o `command` canônico do invariante
 * `runner-tag` do CORE), SEM recorte: por isso ela não precisa de entrada em
 * `HOOK_DECLARED` — o `check-hook-ci-parity` a reconhece por IGUALDADE (mesmo
 * instrumento, mesmo escopo). E é também por isso que ela NÃO leva `--staged`:
 * o `check-mirror-coverage` DERIVA o recorte das linhas `--staged` do hook, e
 * esta guarda não julga espelho nenhum (ela julga a declaração de UMA imagem).
 */
export const RUNNER_TAG_GUARD = "check-runner-tag.mjs"
export const RUNNER_TAG_COMMAND = `node scripts/${RUNNER_TAG_GUARD}`

/** A linha do hook que torna o REMÉDIO real no fixture (é ele que elege o veredito). */
export const REMEDY_COMMAND = `node scripts/${REMEDY} && REMEDIO=0 || true`

/** Os guards de ENCODING — o par DECLARAÇÃO + guard dono que anda junto (ver
 * `CLOSURE_SEM_GRAFO`). São SHELL e PYTHON: não há import a derivar, e quem os
 * consome (o fixture deste hook e o da fase B do remédio) lê daqui — uma lista
 * por consumidor divergiria no primeiro encoder novo. */
export const GUARDS_DE_ENCODING = [
  "check-crlf.sh",
  "check_crlf.py",
  "check-blob-crlf.sh",
  "check_blob_crlf.py",
  "check-utf8.sh",
  "check_utf8.py",
]

/** As DUAS entradas do fixture: o guard do ÍNDICE e o remédio — as duas metades
 * do veredito do hook (o remédio IMPORTA o guard e SPAWNA o guard). */
const ENTRADAS_DO_FIXTURE = [GUARD, REMEDY]

/**
 * Os ARTEFATOS do repositório (fora de `scripts/`) que a cópia do fixture tem de
 * MATERIALIZAR — DERIVADOS do que os guards do hook leem.
 *
 * POR QUE ISTO EXISTE (medido em 27/09/2026): o fixture copiava só o fecho de
 * `scripts/`, e um guard fail-closed sobre um ARTEFATO do repositório — o
 * compose ausente é INFRA (exit 2) — rodava no CI e NÃO podia rodar no hook: na
 * cópia ele lia o ramo de INFRA, e o vermelho seria do FIXTURE, não do defeito.
 * Foi por isso que o `runner-tag` ficou declarado em `HOOK_NOT_RUN`. Com o
 * artefato materializado, a guarda roda no hook de verdade — com a MESMA linha
 * do CI.
 *
 * A LISTA À MÃO SAIU (27/09/2026). Ela era `[GITEA_COMPOSE]` e não sabia de guard
 * novo: quem acrescentasse uma guarda que abre um arquivo do repositório teria de
 * LEMBRAR de vir aqui — e o sintoma de esquecer é o pior possível (o guard lê
 * INFRA na cópia e o vermelho passa a ser do fixture). Agora quem responde é a
 * EXECUÇÃO (`artefatos-do-hook.mjs`): monta-se o fixture com o fecho dos comandos
 * do hook e NENHUM artefato, roda-se cada comando atrás de um pré-carregador que
 * registra as tentativas de abertura, e o artefato é o caminho que um guard abriu,
 * não achou na cópia e EXISTE no repositório. Um guard novo entra SOZINHO — o
 * teste da derivação mede exatamente isso, com uma guarda e um artefato que não
 * existem no repositório.
 *
 * O `staged` é o MESMO conteúdo que o fixture escreve no ÍNDICE: os guards de
 * `--staged` só fazem o trabalho deles com algo no índice, e sem isso a derivação
 * mediria um caminho em que eles saem cedo — e o artefato que eles leem nunca seria
 * aberto.
 *
 * @param {{root?: string, hook?: string}} [opts]
 * @returns {string[]}
 */
export function artefatosDoFixture({ root = REPO_ROOT, hook } = {}) {
  const { artefatos, problemas } = artefatosDoHookMemo({
    root,
    hook,
    staged: [
      { rel: WORKFLOW, content: WORKFLOW_QUEBRADO },
      { rel: SHELL_SCRIPT, content: SHELL_QUEBRADO },
    ],
  })
  if (problemas.length > 0)
    throw new Error(
      `a derivação dos artefatos do fixture NÃO FECHA — a cópia não pode ser montada com a lista pela metade: ${problemas.join(" | ")}`,
    )
  return artefatos
}

/**
 * O que o fixture copia ALÉM do que o grafo alcança — as SEMENTES que import
 * nenhum liga às duas entradas.
 *
 * O fixture copia `fechoDoGuard()`: a derivação do grafo a partir das entradas
 * MAIS estas sementes (o que elas puxam por import entra sozinho, transitivamente
 * — é a MESMA régua das suítes de mutação e do recorte do pre-push). A régua não
 * basta sozinha aqui porque metade deste fixture não é aresta de import:
 *
 *   · as DECLARAÇÕES de classe (`remedy-classes/*.mjs`) e do canal
 *     (`remedy-canal/*.mjs`) são carregadas por CAMINHO CALCULADO — a varredura de
 *     diretório não é estática, e o grafo não as vê. Quem responde por elas é a
 *     CONTAGEM: um fixture sem a pasta (ou com uma declaração a menos) roda um
 *     remédio com oferta INCOMPLETA, e o exit 2 da recusa apareceria como
 *     veredito do defeito;
 *   · o PUBLICADOR do canal e os guards do ÍNDICE são SPAWNADOS (pelo dublê do
 *     hook e pela fase A real, que roda os irmãos sem o dublê): são comandos, não
 *     imports;
 *   · os guards de ENCODING (`GUARDS_DE_ENCODING`) são SHELL e PYTHON, e a
 *     descoberta RECUSA a rodada quando uma declaração cita um dono que não
 *     existe NESTE repositório: declaração e dono são um par.
 *
 * MEDIDO (27/09/2026): a lista à mão que existia aqui tinha 42 linhas; o grafo das
 * duas ENTRADAS alcançava 15 delas, e estas 20 sementes são MÍNIMAS — a poda foi
 * medida uma a uma (nenhuma é alcançada pelas outras 19), a derivação devolve as
 * 46 (as 42 de então MAIS a guarda do artefato e as 3 dependências dela), e é essa
 * poda que `closureProblems()` refaz a cada rodada para uma linha redundante
 * aparecer NOMEADA em vez de envelhecer em silêncio.
 */
export const CLOSURE_SEM_GRAFO = [
  // As sete declarações de classe (caminho CALCULADO: a varredura de diretório).
  "remedy-classes/run-syntax.mjs",
  "remedy-classes/crlf.mjs",
  "remedy-classes/blob-crlf.mjs",
  "remedy-classes/utf8.mjs",
  "remedy-classes/hook-commands.mjs",
  "remedy-classes/pipefail-sigpipe.mjs",
  "remedy-classes/bun-mirror-removal.mjs",
  // As declarações do CANAL (mesma descoberta por diretório). O leitor folha
  // (`remedy-canal.mjs`) e o registro (`pr-fixers.mjs`) vêm pelo GRAFO a partir
  // daqui — é o `pr-remedy-comment.mjs`, abaixo, que os importa.
  "remedy-canal/run-syntax.mjs",
  "remedy-canal/pipefail-sigpipe.mjs",
  // O PUBLICADOR do canal: SPAWNADO pelo remédio (a mecânica do comentário e o
  // publicador de issue vêm pelo GRAFO a partir dele).
  "pr-remedy-comment.mjs",
  // Os guards do ÍNDICE que a fase A real RODA sem o dublê (as dependências
  // deles — `check-bun-mirror`, `forge-workflows`, `allowlist-review` — vêm pelo
  // GRAFO).
  "check-mutation-jobs.mjs",
  "check-unused-deps.mjs",
  "check-mutation-timing-contract.mjs",
  // A guarda da DECLARAÇÃO da imagem do runner (fase B do hook): nenhuma das
  // entradas a importa, e ela precisa estar na cópia porque o fixture a roda de
  // verdade quando um teste a pede por `passthrough` — sem o arquivo, o `node`
  // do dublê morreria com ENOENT do FIXTURE em vez de cunhar o veredito dela.
  // Julga um ARTEFATO do repositório (o compose da forja, que a MATERIALIZAÇÃO
  // derivada por `artefatosDoHook` leva para a cópia); as dependências dela
  // (`check-runner-labels`, `check-bun-mirror`) vêm pelo GRAFO, com a régua do pin
  // no dono.
  "check-runner-tag.mjs",
  // Os encoders (SHELL/PYTHON: sem import a derivar).
  ...GUARDS_DE_ENCODING,
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
    closure: fechoDoGuard(),
    wrapper: passthrough.length === 0 ? WRAPPER_SOURCE : wrapperSource(specsDoWrapper(passthrough)),
    dirs: [GITHUB_WORKFLOW_DIR],
    artefatos: artefatosDoFixture(),
  })
}

/**
 * A derivação do fecho, configurada para ESTE fixture: `permitirPacotes` é
 * DECLARADO (o fixture roda com o `node_modules` da instalação — o `linkModules`
 * do simulador — e resolve o parser de YAML; quem mede os pacotes do fecho é o
 * `naoRelativos()`, no teste).
 *
 * @param {string} root
 * @param {string[]} entradas
 * @returns {{fecho: string[], adiados: object[], problemas: string[]}}
 */
function derivarFecho(root, entradas) {
  return fechoDeImports(entradas, {
    root: join(root, "scripts"),
    comRaiz: true,
    permitirPacotes: true,
  })
}

/**
 * O FECHO do fixture — o que `novoRepo` COPIA: a derivação do grafo a partir das
 * duas ENTRADAS MAIS as sementes que import nenhum liga a elas
 * (`CLOSURE_SEM_GRAFO`).
 *
 * Uma aresta nova entra na cópia sozinha — não há lista de vizinhos para
 * envelhecer. Fail-closed como no recorte do pre-push: quando a régua RECUSA
 * (aresta que não resolve, caminho fora da raiz, semente ausente do checkout), a
 * função LEVANTA com os problemas nomeados e o fixture NÃO é montado; quem
 * publica o desfecho é quem chama (o `closureProblems` do `proveCommitBlocks`
 * vira `unavailable`, e um teste fica vermelho dizendo o porquê).
 *
 * @param {string} [root]
 * @returns {string[]}
 */
export function fechoDoGuard(root = REPO_ROOT) {
  const { fecho, problemas } = derivarFecho(root, [...ENTRADAS_DO_FIXTURE, ...CLOSURE_SEM_GRAFO])
  if (problemas.length > 0)
    throw new Error(
      `o fecho do fixture NÃO FECHA — a cópia não pode ser montada com meio fecho: ${problemas.join(" | ")}`,
    )
  return fecho
}

/**
 * As referências que o fixture NÃO copiaria — DERIVADAS do grafo pela MESMA régua
 * das suítes de mutação (`scripts/fecho-imports.mjs`).
 *
 * Duas perguntas, e nenhuma delas é uma lista paralela:
 *   1. o fecho fecha? (aresta que não resolve, semente ausente do checkout,
 *      caminho fora da raiz — a régua é fail-closed);
 *   2. alguma semente declarada à mão é REDUNDANTE? Uma linha cuja derivação SEM
 *      ela já traz não é um defeito do fixture (o arquivo é copiado de qualquer
 *      forma), mas é dívida que envelhece: foi assim que o
 *      `prove-runner-image-gate.mjs` (que entrou à mão pelo `import()` LITERAL)
 *      ficou na lista depois de o grafo passar a alcançá-lo. MEDIDO: as 20 podas
 *      custam ~0,3s (a rodada inteira do `closureProblems`, 20 derivações) — barato
 *      para uma checagem que roda uma vez por prova.
 *
 * @param {string} [root]
 * @returns {string[]}
 */
export function closureProblems(root = REPO_ROOT) {
  const seeds = [...ENTRADAS_DO_FIXTURE, ...CLOSURE_SEM_GRAFO]
  const { problemas } = derivarFecho(root, seeds)
  const faltando = [...problemas]
  for (const s of CLOSURE_SEM_GRAFO) {
    const sem = derivarFecho(
      root,
      seeds.filter((x) => x !== s),
    )
    if (sem.fecho.includes(s))
      faltando.push(
        `${s} → declarado em CLOSURE_SEM_GRAFO, mas a derivação SEM ele já o traz (linha à mão redundante: o grafo é quem deve trazê-lo)`,
      )
  }
  return faltando
}

/**
 * As dependências NÃO relativas do fecho (o que o fixture tem de RESOLVER).
 *
 * Um `import`/`require` de pacote é a outra metade do fecho que a cópia não
 * traz: copiar só os `.mjs` deixa o guard sem o parser, e o não-zero que a prova
 * mediria seria do fixture. O fecho varrido é o MESMO que o fixture copia
 * (`fechoDoGuard`, derivado ∪ sementes), e as dependências são LIDAS do fonte
 * (não declaradas à mão): uma dependência nova aparece sozinha no probe do teste
 * — que é quem as mede de verdade (resolve e parsa).
 *
 * `fechoDoGuard` LEVANTA quando o fecho não fecha: sem fecho não há o que
 * resolver, e o desfecho de chamar isto é o erro nomeado, não uma lista vazia.
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
  for (const f of fechoDoGuard(root)) {
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
 * A evidência da fase B, por defeito declarado em `FASE_B_DEFEITOS`: o commit do
 * defeito (recusado), os membros da fase B medidos no MESMO índice (com o argv de
 * cada um), a descida do runner (os comandos e quem recusou), a fase A + o gate
 * nesse índice, e o CONTROLE do defeito.
 *
 * @typedef {{
 *   id: string, rotulo: string, arquivo: string,
 *   recusadoresEsperados: {membros: string[], descida: string[]},
 *   defeito: object|null, membros: object[], descida: object|null,
 *   irmaos: object[], gate: object|null, controle: object|null,
 * }} MetadeDaFaseB
 * @typedef {{defeito: object, controle?: object, irmaos?: object[], gate?: object, faseB?: MetadeDaFaseB[]}} ProofEvidenceReal
 *
 * O veredito da prova. `proven` = o hook BLOQUEOU o corpo quebrado no índice, a
 * fase B recusou os defeitos de encoding/link com a atribuição fechada, e os
 * CONTROLES comitaram (sem eles, "não commitou" seria indistinguível de um
 * fixture que não sabe commitar). `violated` = o defeito ENTROU no histórico.
 * `unavailable` = não deu para provar (e nunca vira verde).
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
// A OFERTA DO REMÉDIO NO PRÓPRIO COMMIT — o hook bloqueia E remenda a classe
// =============================================================================
//
// A prova de cima mede o BLOQUEIO: o corpo `run:` quebrado no índice não vira
// commit. O remédio do pre-commit existe para o passo seguinte — a MESMA medição
// mostrando que o hook OFERECE o remendo da classe quando o defeito que bloqueou
// é um dos que ele sabe consertar. Até aqui essa metade só era medida no
// SIMULADOR (a suíte e o ensaio do pty, na máquina de quem roda): no runtime do CI
// o que se provava era o bloqueio, não a oferta.
//
// A CLASSE desta metade é a `bun-mirror-removal` (a sétima, o remendo da
// declaração de espelho APAGADA) porque é ela que fecha o ciclo inteiro sobre um
// defeito de uma fase REAL do hook: o guard DONO (`check-bun-mirror.mjs`) roda de
// verdade no recorte `--staged`, RECUSA o commit, e o fixer dele restaura a
// declaração a partir da HEAD.
//
// TRÊS METADES, e as três são necessárias (a terceira é o que impede a oferta de
// ser uma promessa vazia):
//
//   1. o DEFEITO (o índice com o arg `BUN_VERSION` apagado do build site) tem de
//      ser RECUSADO pelo guard dono — o HEAD intacto e nenhum objeto de commit
//      novo, num fixture cujo commit BASE já existe (por isso a contagem é
//      RELATIVA, e não "zero objetos": aqui zero seria o commit base ausente);
//   2. a OFERTA tem de nomear a classe, os ofensores e o fixer do DONO — medida
//      pela CLI `--oferta` do MESMO script que o hook executa (a cópia do
//      fixture, byte a byte), com o vínculo do hook provado no lado dele: a
//      saída do commit cita a classe. Sem a segunda, "a oferta existe" poderia
//      ser um script que ninguém invoca;
//   3. o CONTROLE: o fixer DO DONO, rodado de verdade no runtime, restaura a
//      declaração, o recorte `--staged` do guard volta a 0 e o MESMO commit ENTRA
//      (conteúdo conferido em HEAD). Sem ele, "ofereceu" conviveria com um
//      remendo que não desbloqueia nada.
//
// O CAMINHO é o NÃO INTERATIVO (`NO_PROMPT` do simulador): o `git commit` do
// fixture não tem operador, e o remédio é fail-closed nesse ramo (imprime o
// caminho à mão e mantém o commit bloqueado). QUEM MEDE O CAMINHO INTERATIVO é o
// ensaio do pty — declarado no limite, não escondido.

// A VERSÃO do fixture é uma SENTINELA, não uma afirmação de versão: o guard da
// fonte única (`check-bun-mirror`) lê este arquivo, e um literal aqui envelheceria
// em silêncio depois de um bump (o próprio guard nomeia a saída para fixtures).
export const MIRROR_ACTRC = "--var BUN_VERSION=9.9.9-sentinel\n"
export const MIRROR_ACTRC_PATH = ".actrc"

/** O Dockerfile que faz o build site do compose PRECISAR do arg (a 18(b)). */
export const MIRROR_DOCKERFILE = "Dockerfile.worker"
export const MIRROR_DOCKERFILE_FONTE = "ARG BUN_VERSION\nFROM oven/bun:${BUN_VERSION}\n"

export const MIRROR_COMPOSE = "docker-compose.yml"

/** O build site PASSANDO o arg — o estado do bloco em HEAD (a premissa). */
export const MIRROR_COMPOSE_COM_ARG = [
  "services:",
  "  web:",
  "    build:",
  "      context: .",
  `      dockerfile: ${MIRROR_DOCKERFILE}`,
  "      args:",
  "        BUN_VERSION: ${BUN_VERSION:-9.9.9-sentinel}",
  "",
].join("\n")

/** O MESMO serviço, com o bloco sem o arg — o commit que o hook tem de recusar. */
export const MIRROR_COMPOSE_SEM_ARG =
  MIRROR_COMPOSE_COM_ARG.split("\n").slice(0, 5).join("\n") + "\n"

/** O prefixo dos fixtures desta prova (eles convivem com os das outras). */
export const MIRROR_PREFIX = "pre-commit-remedy-"

/**
 * A mudança BENIGNA que o CONTROLE soma ao índice.
 *
 * Ela não é enfeite: o remendo da classe RESTAURA o que o commit apagava, então
 * o índice volta a ser IGUAL à HEAD naquele arquivo — e um commit que só carrega
 * a declaração restaurada é VAZIO para o git (medido: `git commit` sai 1 com
 * "nada adicionado ao envio"). O que o CONTROLE mede é o VEREDITO do hook com a
 * declaração de volta, e para isso o commit precisa ter o que registrar.
 */
export const MIRROR_NOTAS = "nota-do-fixture.txt"
export const MIRROR_NOTAS_TEXTO = "mudança benigna do CONTROLE — o remendo restaurou a declaração\n"

/**
 * Um fixture com o estado BASE comitado (o arg no lugar) e o hook do checkout no
 * `hooksPath`. O commit base vai com `--no-verify` de propósito: ele é a PREMISSA
 * da medição (o "antes" com o arg), e um base que dependesse do veredito do hook
 * mediria outra coisa.
 *
 * @returns {string}
 */
export function mirrorFixture() {
  const dir = novoRepo({ passthrough: [BUN_GUARD], prefix: MIRROR_PREFIX })
  writeHooksShim(dir)
  stage(dir, MIRROR_ACTRC_PATH, MIRROR_ACTRC)
  stage(dir, MIRROR_DOCKERFILE, MIRROR_DOCKERFILE_FONTE)
  stage(dir, MIRROR_COMPOSE, MIRROR_COMPOSE_COM_ARG)
  runCommit(dir, {}, ["commit", "-q", "-m", "base do fixture", "--no-verify"])
  return dir
}

/**
 * A OFERTA medida pela CLI do remédio, contra o ESTADO do fixture — o mesmo
 * script que o hook executa (a cópia do fixture), no mesmo runtime.
 *
 * O `json` é o payload do `--oferta` (`scripts/pre-commit-remedy.mjs`, tipado
 * lá como `Oferta`) ou `null` quando o stdout não é JSON — `null` é "não li",
 * nunca uma oferta vazia inventada.
 *
 * @param {string} dir
 * @returns {{status: number|null, json: any, output: string}}
 */
export function remedyOfferOf(dir, { run = spawnSync } = {}) {
  const res = run(process.execPath, [join(dir, "scripts", REMEDY), "--root", dir, "--oferta"], {
    cwd: dir,
    encoding: "utf8",
    input: "",
    timeout: 60_000,
    env: { ...process.env, PATH: harnessPath() },
  })
  const saida = String(res.stdout ?? "")
  let json = null
  try {
    json = JSON.parse(saida)
  } catch {
    json = null
  }
  return { status: res.status, json, output: `${saida}${res.stderr ?? ""}` }
}

/**
 * Um script do FIXTURE rodado de verdade, no runtime — a CLI do guard dono (o
 * `--fix` e o `--staged` do CONTROLE). O `node` é o mesmo do processo (o do
 * runtime), e o `PATH` é o do harness: o fixture não soma dublê nenhum AQUI (o
 * dublê vive dentro do hook, que o git invoca).
 *
 * @param {string} dir
 * @param {string} script
 * @param {string[]} args
 * @param {{run?: typeof spawnSync}} [deps]
 * @returns {{status: number|null, output: string}}
 */
export function rodarCli(dir, script, args, { run = spawnSync } = {}) {
  const res = run(process.execPath, [join(dir, "scripts", script), ...args], {
    cwd: dir,
    encoding: "utf8",
    input: "",
    timeout: 60_000,
    env: { ...process.env, PATH: harnessPath() },
  })
  return { status: res.status, output: `${res.stdout ?? ""}${res.stderr ?? ""}` }
}

/**
 * A metade da OFERTA: o hook bloqueia o commit que apaga a declaração de espelho,
 * oferece a classe que remenda esse defeito e o fixer do dono fecha o ciclo.
 *
 * As peças são INJETÁVEIS (`deps`) pelo mesmo motivo das outras provas do
 * repositório: as metades de FALHA (o bloqueio que passa, a oferta sem a classe,
 * o fixer que não restaura, o controle que não entra) só são exercitáveis se a
 * premissa que se quer derrubar puder ser trocada — e é a suíte que as mede, não
 * uma re-leitura do código.
 *
 * @param {{root?: string, deps?: {fixture?: Function, runCommit?: Function, git?: Function, offerOf?: Function, cli?: Function}}} [opts]
 * @returns {{state: string, detail: string, evidence: object|null, remedies: string[]}}
 */
export function proveRemedyOffered({ root = REPO_ROOT, deps = /** @type {any} */ ({}) } = {}) {
  const {
    fixture = mirrorFixture,
    runCommit: commit = runCommit,
    git = runGit,
    offerOf = remedyOfferOf,
    cli = rodarCli,
  } = deps
  const remedies = [
    `o hook precisa existir e ser EXECUTÁVEL: um hook sem o bit de execução é IGNORADO por git EM SILÊNCIO (o commit entra sem veredito)`,
    `a classe 'bun-mirror-removal' precisa estar na oferta: ela é declarada por \`scripts/remedy-classes/bun-mirror-removal.mjs\`, e a descoberta RECUSA a rodada quando a declaração cita um dono que não existe`,
  ]
  const fonte = hookSource(root)
  if (fonte === null) {
    return {
      state: "unavailable",
      detail: `${HOOK} não existe neste checkout — não há hook para exercitar a oferta`,
      evidence: null,
      remedies,
    }
  }
  const faltando = []
  if (!existsSync(join(root, "node_modules")))
    faltando.push("node_modules (a CLI do remédio importa as classes)")
  const problems = closureProblems(root)
  if (problems.length > 0) faltando.push(`fecho do guard incompleto: ${problems.join(", ")}`)
  if (faltando.length > 0) {
    return {
      state: "unavailable",
      detail: `não dá para exercitar o remédio no runtime: ${faltando.join("; ")}`,
      evidence: null,
      remedies,
    }
  }

  try {
    const dir = fixture()
    const objetosAntes = commitObjects(dir)
    const headAntes = String(git(dir, ["rev-parse", "HEAD"]).output ?? "").trim()

    // ── METADE 1: o defeito no ÍNDICE tem de ser RECUSADO pelo guard DONO ──
    stage(dir, MIRROR_COMPOSE, MIRROR_COMPOSE_SEM_ARG)
    const bloqueio = commit(dir)
    const objetosDepois = commitObjects(dir)
    const headDepois = String(git(dir, ["rev-parse", "HEAD"]).output ?? "").trim()
    const evidencia = {
      defeito: {
        ...resumoCommit(bloqueio),
        objetosDeCommit: objetosDepois,
        objetosDoBase: objetosAntes,
        headIntacto: headDepois === headAntes && headDepois !== "",
      },
    }
    if (bloqueio.status === 0 || objetosDepois > objetosAntes) {
      return {
        state: "violated",
        detail:
          `o pre-commit NÃO bloqueou o commit que APAGA o arg \`BUN_VERSION\` do build site ` +
          `(${MIRROR_COMPOSE}): exit ${bloqueio.status}, ${objetosDepois - objetosAntes} objeto(s) novo(s) — ` +
          `a declaração apagada viaja no commit de quem confia no guard dono`,
        evidence: evidencia,
        remedies,
      }
    }
    if (!bloqueio.output.includes(MIRROR_COMPOSE)) {
      return {
        state: "unavailable",
        detail: `o commit foi recusado, mas a saída do hook não cita ${MIRROR_COMPOSE} — o não-zero veio de outro lugar (não do veredito do guard dono)`,
        evidence: evidencia,
        remedies,
      }
    }
    evidencia.defeito.bloqueadoPor = "a saída do hook cita o arquivo do defeito"

    // ── METADE 2: a OFERTA nomeia a classe, os ofensores e o fixer do DONO ──
    const oferta = offerOf(dir)
    const classe = (oferta.json?.classes ?? []).find((c) => c.id === "bun-mirror-removal")
    evidencia.oferta = {
      exit: oferta.status,
      classes: (oferta.json?.classes ?? []).map((c) => ({ id: c.id, offenders: c.offenders })),
      unmeasured: (oferta.json?.unmeasured ?? []).map((u) => u.id),
      fonte: `node scripts/${REMEDY} --oferta (a cópia do fixture)`,
    }
    if (!classe) {
      return {
        state: "violated",
        detail:
          `o commit foi BLOQUEADO (o bloqueio está de pé), mas a OFERTA não tem a classe ` +
          `'bun-mirror-removal' para o defeito que o guard dono acabou de recusar — o operador corrige à mão ` +
          `o que o repositório remenda por máquina (medido: ${oferta.json?.classes?.length ?? 0} classe(s) na oferta, exit ${oferta.status})`,
        evidence: evidencia,
        remedies,
      }
    }
    evidencia.oferta.classe = {
      offenders: [...classe.offenders],
      fixer: classe.fixer,
      violacoes: classe.violacoes,
    }
    // O vínculo: quem OFERECE é o HOOK, não um script avulso. A classe entra como
    // requisito porque o bloco é UMA escrita do remédio (as linhas ✅/❌ dos guards
    // paralelos, essas, seguem evidência — ver o cabeçalho do módulo).
    const citada = bloqueio.output.includes("bun-mirror-removal")
    evidencia.oferta.citadaPeloHook = citada
    if (!citada) {
      return {
        state: "violated",
        detail:
          `a classe 'bun-mirror-removal' existe na oferta medida FORA do hook, mas a saída do commit não a cita — ` +
          `o hook recusou sem entregar a oferta ao operador`,
        evidence: evidencia,
        remedies,
      }
    }

    // ── METADE 3 (o CONTROLE): o fixer do DONO restaura e o MESMO commit ENTRA ──
    const fixer = cli(dir, BUN_GUARD, ["--fix"])
    git(dir, ["add", "--", MIRROR_COMPOSE])
    const guarda = cli(dir, BUN_GUARD, ["--staged"])
    // O que o fixer devolveu ao ÍNDICE: a declaração do commit anterior. É o
    // contrato da classe (restaurar o que foi APAGADO), e é medido ANTES de
    // seguir — um remendo que gravasse outra coisa não seria o remendo dela.
    const noIndice = String(git(dir, ["show", `:${MIRROR_COMPOSE}`]).output ?? "")
    const restauradoNoIndice = noIndice === MIRROR_COMPOSE_COM_ARG
    // A mudança BENIGNA: com a declaração de volta o commit sozinho seria VAZIO.
    stage(dir, MIRROR_NOTAS, MIRROR_NOTAS_TEXTO)
    const commitControle = commit(dir)
    const objetosControle = commitObjects(dir)
    let conteudo = null
    try {
      conteudo = committedContent(dir, MIRROR_COMPOSE)
    } catch {
      conteudo = null
    }
    evidencia.controle = {
      fixer: fixer.status,
      guarda: guarda.status,
      restauradoNoIndice,
      status: commitControle.status,
      objetosDeCommit: objetosControle - objetosDepois,
      conteudoEmHead:
        conteudo === MIRROR_COMPOSE_COM_ARG ? "a declaração restaurada" : "outro conteúdo",
    }
    if (fixer.status !== 0) {
      return {
        state: "violated",
        detail: `o fixer do guard dono ('${BUN_GUARD} --fix') não restaurou a declaração (exit ${fixer.status}) — a oferta aponta para um remendo que não fecha`,
        evidence: evidencia,
        remedies,
      }
    }
    if (guarda.status !== 0) {
      return {
        state: "violated",
        detail: `o fixer rodou, mas o recorte '--staged' do guard DONO continua vermelho (exit ${guarda.status}) — o remendo não fechou o defeito que o hook recusou`,
        evidence: evidencia,
        remedies,
      }
    }
    if (!restauradoNoIndice) {
      return {
        state: "violated",
        detail: `o fixer do guard dono não devolveu ao ÍNDICE a declaração do commit anterior (${MIRROR_COMPOSE} no índice difere do bloco de HEAD) — o remendo não é o da classe`,
        evidence: evidencia,
        remedies,
      }
    }
    if (
      commitControle.status !== 0 ||
      objetosControle <= objetosDepois ||
      conteudo !== MIRROR_COMPOSE_COM_ARG
    ) {
      const doDono = String(commitControle.output ?? "").includes(MIRROR_COMPOSE)
      return {
        state: doDono ? "violated" : "unavailable",
        detail:
          `o CONTROLE (o MESMO commit com a declaração restaurada) não entrou depois do remendo: ` +
          `exit ${commitControle.status}, ${objetosControle - objetosDepois} objeto(s), conteúdo ${conteudo === MIRROR_COMPOSE_COM_ARG ? "o esperado" : "DIFERENTE"}` +
          (doDono
            ? ` — e a recusa ainda cita ${MIRROR_COMPOSE}: o guard dono continua vermelho num fixture em que a oferta foi feita`
            : ` — e a saída não cita o guard dono: a recusa veio de outro lugar`),
        evidence: evidencia,
        remedies,
      }
    }

    return {
      state: "proven",
      detail:
        `o commit que APAGA o arg \`BUN_VERSION\` do build site (${MIRROR_COMPOSE}) é RECUSADO pelo guard DONO ` +
        `(exit ${bloqueio.status}, ${objetosDepois - objetosAntes} objeto(s) novo(s), HEAD intacto), a OFERTA nomeia a ` +
        `classe 'bun-mirror-removal' (${classe.offenders.length} ofensor(es), fixer \`${classe.fixer}\`) e a saída do ` +
        `commit a CITA, e o fixer do dono devolve a declaração ao ÍNDICE: o \`--staged\` volta a ${guarda.status} e o ` +
        `commit CONTROLE (o mesmo índice + uma mudança benigna, porque o remendo torna o commit vazio) ENTRA ` +
        `(exit ${commitControle.status}, ${objetosControle - objetosDepois} objeto, conteúdo conferido em HEAD)`,
      evidence: evidencia,
      remedies,
    }
  } catch (err) {
    return {
      state: "unavailable",
      detail: `a prova da oferta não pôde rodar: ${err instanceof Error ? err.message : String(err)}`,
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
// `core.hooksPath` é o REAL, os seis guards de fase A são os REAIS (sem
// wrapper, sem dublê), o gate é o REAL e a fase C (lint-staged, typecheck) roda
// de verdade — porque a cópia tem o `package.json` e o `node_modules` que o
// fixture não tem.
//
// CINCO METADES, e a segunda é o que a primeira NÃO consegue dizer sozinha:
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
//      "recusou" seria indistinguível de um ambiente que não sabe commitar;
//   4. os DEFEITOS de FASE B (um byte 0x97 num `.ts` NOVO e um link interno
//      quebrado num `.md` NOVO) têm de ser RECUSADOS, com o HEAD intacto — a
//      metade 3 só media a fase B pelo lado que PASSA (o controle entrava);
//   5. a ATRIBUIÇÃO da fase B: os DEZ membros rodados DIRETO sobre o MESMO
//      índice (veredito por exit code) e a DESCIDA do runner nomeando o guard de
//      cada classe (`check-utf8.sh`, `check-readme-anchors.mjs`) — com o
//      conjunto medido igual ao DECLARADO nos dois sentidos (é o que impede a
//      medição de virar um relatório), a fase A e o gate verdes nesse índice, e
//      o CONTROLE de cada defeito (o arquivo REMENDADO) entrando.
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
  // O SEXTO — e o que carrega a recusa do BUMP DE MATRIZ sem o ato (ver a metade
  // 6 de `proveRealHookBlocks`). Ele entrou no hook junto com o recorte
  // `--staged` do `check:mutation-count`, e a lista daqui ficou para trás: a
  // prova dizia "os CINCO guards de fase A" enquanto o hook rodava SEIS, de modo
  // que uma recusa DELE não era nem esperada nem atribuída. Uma lista à mão de
  // um conjunto que o hook declara é exatamente o tipo de segunda fonte que este
  // repositório fecha com guard — e é o teste da completude da fase que cobra
  // cada comando do hook `fase_a()`.
  "check-mutation-count.mjs",
]

/** O recorte que a fase A usa — o mesmo que o hook passa a cada um deles. */
export const FASE_A_RECORTE = "--staged"

/**
 * O membro da fase B que pergunta pela HISTÓRIA do repositório (ver
 * `ligaObjetosDoCheckout`): o `check-doc-hashes` exige que todo commit citado na
 * prosa exista na história de HEAD, e é ele que torna o `.git` COMPLETO uma
 * premissa da medição.
 *
 * A prova procura ESTE nome no corpo do hook (em vez de um segundo lugar que
 * diga "há um membro da história"): a premissa acompanha o hook.
 */
export const MEMBRO_DA_HISTORIA = "check-doc-hashes.mjs"

/**
 * O checkout é um clone RASO? (`git rev-parse --is-shallow-repository`)
 *
 * "Não consegui perguntar" não é "é profundo": sem a resposta do git a premissa
 * falha, e a prova sai `unavailable` com o motivo em vez de medir o fixture.
 *
 * @param {string} dir
 * @param {{run?: typeof spawnSync}} [deps]
 * @returns {boolean}
 */
export function repoRaso(dir, { run = spawnSync } = {}) {
  try {
    const r = run("git", ["rev-parse", "--is-shallow-repository"], {
      cwd: dir,
      encoding: "utf8",
      timeout: 30_000,
    })
    if (r?.status !== 0) return true
    return String(r.stdout ?? "").trim() !== "false"
  } catch {
    return true
  }
}

/**
 * O marcador do INVARIANTE do gate no texto dele: o `bash -n` dos corpos `run:`.
 * É por ele que a recusa é atribuída ao gate — e não à prosa do relatório dele,
 * que pode ser reescrita sem mudar o que o gate mede.
 */
export const GATE_MARCADOR = "bash -n"

// =============================================================================
// A FASE B — os guards GLOBAIS, medidos com um defeito NO ÍNDICE
// =============================================================================
//
// A metade 3 (o CONTROLE) já media a fase B pelo lado que passa: com o corpo
// fechado o commit ENTRA. O que ela NÃO dizia é quem RECUSA um defeito da classe
// dela — e "os guards globais rodam" (por leitura do hook) não é a mesma coisa
// que "estes guards recusam ESTE índice".
//
// Aqui a fase B é medida como a fase A já era: o MESMO índice do defeito, cada
// membro rodado direto, o veredito por EXIT CODE. O membro do encoding é um
// RUNNER (17 guards dentro, com `set -e`: ele para no PRIMEIRO) — então além do
// membro há a DESCIDA: os comandos que o próprio runner declara são lidos do
// arquivo dele e rodados um a um, e são eles que NOMEIAM o guard que recusou.
//
// A lista de membros é a mesma do hook e NÃO é lida dele de propósito: um membro
// a mais no hook tem de aparecer AQUI, à mão, em vez de entrar na prova por conta
// de um `grep` que ninguém conferiu (o `check-hook-ci-parity` cobre o outro lado,
// o de o hook rodar o mesmo comando do CI).

/**
 * Os membros da FASE B do `.husky/pre-commit`, com o comando EXATO de cada um.
 *
 * `estagio: true` marca o membro cujo argumento é a lista de arquivos do índice
 * (o `prettier --check` do recorte): a prova calcula a lista do MESMO jeito que o
 * hook — `git diff --cached --name-only --diff-filter=ACMR` MENOS os binários.
 */
export const FASE_B_MEMBROS = [
  { id: "encoding-runner", cmd: "bash", args: ["scripts/run-encoding-guards.sh"] },
  { id: "barrel-lint", cmd: "bun", args: ["run", "barrel-lint"] },
  { id: "pii-allowlist", cmd: "bun", args: ["run", "check:pii-allowlist"] },
  { id: "registry-source", cmd: "bun", args: ["run", "check:registry-source"] },
  { id: "forge-parity", cmd: "bun", args: ["run", "check:forge-parity"] },
  { id: "forge-workflow-scope", cmd: "bun", args: ["run", "check:forge-workflow-scope"] },
  { id: "hook-ci-parity", cmd: "node", args: ["scripts/check-hook-ci-parity.mjs"] },
  { id: "hook-commands", cmd: "node", args: ["scripts/check-hook-commands.mjs"] },
  { id: "pipefail-sigpipe", cmd: "node", args: ["scripts/check-pipefail-sigpipe.mjs"] },
  {
    id: "prettier-format",
    cmd: "bun",
    args: ["x", "prettier", "--check", "--ignore-unknown"],
    estagio: true,
  },
]

/**
 * O `grep -vE` do hook, na mesma forma: o que o `prettier --check` do recorte
 * NÃO recebe (binário não tem parser, e listá-lo faria o membro reprovar por
 * "parser" em vez de por formatação). O teste cobra que a linha do hook traga
 * ESTA regex — duas cópias divergiriam no dia em que uma fosse ajustada.
 */
export const STAGED_FORMAT_EXCLUSAO = "\\.(png|jpg|gif|svg|ico|webp|pdf|lock|snap)$"

/**
 * Os arquivos que o membro de formatação recebe: os do ÍNDICE, sem os binários —
 * a mesma régua do hook (`git diff --cached --name-only --diff-filter=ACMR`).
 *
 * @param {string} dir
 * @returns {string[]}
 */
export function arquivosDeFormatoDoIndice(dir) {
  const r = runGit(dir, ["diff", "--cached", "--name-only", "--diff-filter=ACMR"])
  if (r.status !== 0) return []
  const binarios = new RegExp(STAGED_FORMAT_EXCLUSAO)
  return r.output
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "" && !binarios.test(l))
}

/**
 * O membro do encoding é um RUNNER: os guards que ele executa estão declarados no
 * PRÓPRIO arquivo dele (`bash scripts/…`, `node scripts/…`), e é essa lista que a
 * descida percorre. Ler a declaração (em vez de cravar 17 comandos aqui) é o que
 * faz um guard NOVO no runner entrar na medição sozinho — e um comando que o
 * runner declare e o checkout não tenha aparece como refutador NOMEADO (exit != 0
 * do próprio shell), nunca como verde por omissão.
 */
export const RUNNER_ENCODING = "scripts/run-encoding-guards.sh"

/**
 * Os DEFEITOS da fase B medidos pela prova: um de ENCODING e um de LINK — as
 * duas classes que os guards globais existem para pegar —, cada um num arquivo
 * NOVO (o refutador tem de ser nomeável, e um defeito num arquivo existente
 * mexeria em outros guards).
 *
 * `recusadoresEsperados` é DECLARADO e CONFERIDO nos dois sentidos: um refutador
 * declarado que ficasse verde (o guard parou de pegar a classe) e um vermelho NÃO
 * declarado (outro guard passou a recusar) derrubam a prova com o nome do guard.
 * É o que impede a medição de virar um relatório.
 *
 * A lista é o que a EXECUÇÃO mediu no repositório (o `--sem-duble` a mede de
 * verdade): o refutador da classe ENCODING é o `encoding-runner`, e o da classe
 * LINK é a descida até o `check-readme-anchors.mjs`. O membro de formatação NÃO
 * aparece nos dois — e isso é medido, não suposto: o `prettier --check` julga sob
 * a config do repositório, e é ela que decide o veredito dele (sem o `.prettierrc`
 * do repo o mesmo byte inválido sai 1; com ele, 0). Quem faz essa distinção é o
 * FIXTURE, que precisa da config no checkout sintético — um membro declarado a
 * mais por causa de um fixture sem config seria a medição do fixture, não do gate.
 */
export const FASE_B_DEFEITOS = [
  {
    id: "utf8-num-ts",
    rotulo: "o byte 0x97 num `.ts` NOVO (a classe ENCODING)",
    arquivo: "src/lib/prova-fase-b-utf8.ts",
    // Em BYTES, e não em texto: é o byte inválido que o guard mede.
    bytes: [...Buffer.from('export const prova = "'), 0x97, ...Buffer.from('"\n')],
    remendo: 'export const prova = "ok"\n',
    recusadoresEsperados: {
      membros: ["encoding-runner"],
      descida: ["bash scripts/check-utf8.sh --dry-run --ci src/"],
    },
  },
  {
    id: "link-quebrado",
    rotulo: "um link interno quebrado num doc NOVO (a classe LINK)",
    arquivo: "docs/prova-fase-b-link.md",
    bytes: [
      ...Buffer.from("# Prova de link\n\nVeja [o guard](GUARDS.md#ancora-que-nao-existe).\n"),
    ],
    remendo: "# Prova de link\n\nVeja [o guard](docs/GUARDS.md).\n",
    recusadoresEsperados: {
      membros: ["encoding-runner"],
      descida: ["node scripts/check-readme-anchors.mjs"],
    },
  },
]

/**
 * Escreve o DEFEITO da fase B no arquivo declarado e o leva ao ÍNDICE — é o
 * commit que dá o veredito, então o defeito tem de estar no que o commit carrega
 * (na árvore só, ele nem seria julgado pelo recorte `--staged` da fase A e a
 * prova estaria medindo outro estado).
 *
 * @param {string} dir
 * @param {{arquivo: string, bytes: number[]}} defeito
 * @param {{runGit: Function}} deps
 */
function escritaDoDefeitoDaFaseB(dir, defeito, { runGit }) {
  const caminho = join(dir, defeito.arquivo)
  mkdirSync(dirname(caminho), { recursive: true })
  writeFileSync(caminho, Buffer.from(defeito.bytes))
  const r = runGit(dir, ["add", defeito.arquivo])
  if (r.status !== 0) throw new Error(`git add ${defeito.arquivo} falhou: ${r.output}`)
}

/**
 * O REMENDO do mesmo arquivo, também levado ao índice: é o CONTROLE do defeito de
 * fase B (sem ele, "a fase B recusou" não se distingue de "o arquivo não entra").
 *
 * @param {string} dir
 * @param {{arquivo: string, remendo: string}} defeito
 * @param {{runGit: Function}} deps
 */
function escritaDoRemendoDaFaseB(dir, defeito, { runGit }) {
  writeFileSync(join(dir, defeito.arquivo), defeito.remendo, "utf8")
  const r = runGit(dir, ["add", defeito.arquivo])
  if (r.status !== 0) throw new Error(`git add ${defeito.arquivo} (remendo) falhou: ${r.output}`)
}

/**
 * Roda UM membro da fase B, no diretório dado, com o MESMO comando do hook. O
 * `node`/`bun`/`bash` são resolvidos pelo PATH do processo que executa a prova —
 * dentro da imagem do runner são os DO RUNTIME.
 *
 * @param {string} dir
 * @param {{id: string, cmd: string, args: string[], estagio?: boolean}} membro
 * @param {{run?: typeof spawnSync, node?: string, estagio?: string[]}} [deps]
 * @returns {{guard: string, status: number|null, linha: string, argv: string[]}}
 */
export function rodaMembroDeFaseB(dir, membro, deps = {}) {
  const run = deps.run ?? spawnSync
  const node = deps.node ?? process.execPath
  const cmd = membro.cmd === "node" ? node : membro.cmd
  const argv = [...membro.args, ...(membro.estagio ? (deps.estagio ?? []) : [])]
  if (membro.estagio && argv.length === membro.args.length) {
    // Sem arquivo de índice não há o que formatar: o membro é NÃO MEDIDO, e não
    // um verde por omissão (status `null` é tratado como medição que faltou).
    return { guard: membro.id, status: null, linha: "", argv }
  }
  const r = run(cmd, argv, { cwd: dir, encoding: "utf8", timeout: 300_000, input: "" })
  const saida = `${r?.stdout ?? ""}${r?.stderr ?? ""}`.trim()
  return {
    guard: membro.id,
    status: r?.status ?? null,
    linha: saida.split("\n").filter(Boolean).slice(-1)[0] ?? "",
    argv,
  }
}

/**
 * A DESCIDA do runner do encoding: os comandos que ele declara, rodados um a um,
 * para o guard que recusou ser NOMEADO (o runner sozinho devolve um exit code só).
 *
 * @param {string} dir
 * @param {{run?: typeof spawnSync, node?: string}} [deps]
 * @returns {{comandos: string[], recusadores: {comando: string, status: number|null}[]|null, indisponivel: string|null}}
 */
export function descidaDoEncodingRunner(dir, deps = {}) {
  const run = deps.run ?? spawnSync
  const node = deps.node ?? process.execPath
  const caminho = join(dir, RUNNER_ENCODING)
  if (!existsSync(caminho)) {
    return {
      comandos: [],
      recusadores: null,
      indisponivel: `${RUNNER_ENCODING} não existe neste checkout`,
    }
  }
  const comandos = readFileSync(caminho, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^(bash|node|bun) /.test(l))
  if (comandos.length === 0) {
    return {
      comandos: [],
      recusadores: null,
      indisponivel: `${RUNNER_ENCODING} não declara comando nenhum — a descida não teria o que medir`,
    }
  }
  const recusadores = []
  for (const comando of comandos) {
    const [cmd, ...args] = comando.split(/\s+/)
    const r = run(cmd === "node" ? node : cmd, args, {
      cwd: dir,
      encoding: "utf8",
      timeout: 300_000,
      input: "",
    })
    const status = r?.status ?? null
    if (status !== 0) recusadores.push({ comando, status })
  }
  return { comandos, recusadores, indisponivel: null }
}

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
    // A SAÍDA INTEIRA, ao lado da última linha: quem precisa ATRIBUIR a recusa a
    // uma regra do guard (o marcador da defasagem da matriz, a metade 6) não pode
    // depender de a linha estar na última posição do relatório dele.
    output: saida,
  }
}

/**
 * O `alternates` da cópia: os objetos do CHECKOUT ficam disponíveis sem serem
 * copiados.
 *
 * POR QUE ELE EXISTE (o defeito MEDIDO em 23/09/2026): a cópia é feita sem o
 * `.git` (o deste repositório tem centenas de MB, e a cópia acontece a cada
 * execução da prova), e o `git init` dela criava um repositório SEM história. A
 * fase B do hook ganhou um membro que pergunta pela HISTÓRIA —
 * `check-doc-hashes.mjs` exige que todo commit citado na prosa exista na história
 * de HEAD — e, num repositório de um commit só, TODA citação é órfã: medido,
 * **88** refutadores de outros guards apareceram no relatório do hook e a prova
 * saiu `unavailable` ("o gate recusou, mas 88 OUTROS refutaram junto"), medindo o
 * FIXTURE em vez do hook. O `alternates` resolve o mesmo problema sem copiar
 * objeto nenhum: a cópia ENXERGA o store do checkout (só leitura — os objetos
 * novos que ela criar ficam no store DELA), e o commit de base nasce em cima do
 * HEAD REAL (`update-ref HEAD`), de modo que a história que a fase B pergunta é a
 * história de verdade.
 *
 * A CONSEQUÊNCIA DECLARADA: um checkout SEM `.git` (ou RASO) não permite medir a
 * fase B inteira — a prova sai `unavailable` NOMEANDO isso, em vez de acusar o
 * hook. É o que torna o `fetch-depth: 0` dos dois jobs uma CONDIÇÃO da medição.
 *
 * @param {string} copia
 * @param {{root?: string}} [opts]
 * @returns {{ok: boolean, caminho: string, destino: string, motivo: string|null}}
 */
export function ligaObjetosDoCheckout(copia, { root = REPO_ROOT } = {}) {
  const destino = join(root, ".git", "objects")
  const caminho = join(copia, ".git", "objects", "info", "alternates")
  try {
    mkdirSync(dirname(caminho), { recursive: true })
    writeFileSync(caminho, `${destino}\n`)
    return { ok: true, caminho, destino, motivo: null }
  } catch (e) {
    return { ok: false, caminho, destino, motivo: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Quantos commits a cópia ACRESCENTOU ao commit de base (`git rev-list --count
 * <base>..HEAD`).
 *
 * É a medida LOCAL de "o commit entrou?" na forma SEM DUBLÊ, e ela precisa ser
 * LOCAL porque a cópia compartilha os objetos do checkout por `alternates`: um
 * `git cat-file --batch-all-objects` enxergaria a história INTEIRA (milhares de
 * commits) e o número deixaria de dizer se ESTE commit entrou. O que a prova
 * mede é o delta — um commit recusado não move o HEAD, então a contagem não anda.
 *
 * @param {string} dir
 * @param {string|null} base  o SHA do commit de base da cópia
 * @param {{run?: typeof spawnSync}} [deps]
 * @returns {number|null}
 */
export function commitsAcimaDaBase(dir, base, { run = spawnSync } = {}) {
  if (!base) return null
  const r = run("git", ["rev-list", "--count", `${base}..HEAD`], {
    cwd: dir,
    encoding: "utf8",
    timeout: 60_000,
  })
  if (r?.status !== 0) return null
  return Number(String(r.stdout ?? "").trim())
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

// =============================================================================
// AS RECUSAS DA FASE A COM O ÍNDICE COERENTE
// =============================================================================
//
// A metade do `run:` quebrado mede a recusa do GATE. Esta mede a de outro guard —
// e a diferença de tratamento é a mesma régua: para atribuir uma recusa a UM
// guard, o índice tem de estar bom em TODO o resto. Um bump de matriz feito à
// mão toca SEIS arquivos (o master, o summary do job, o comentário do job, o
// header e as refs do README — mais a suíte nova), e um fixture que mexesse só na
// matriz seria recusado pelo count das REFS, não pela defasagem do ato: mediria
// a classe errada.

/** O sub-test que o bump da metade 6 acrescenta à matriz. */
export const BUMP_SUBTEST = "prova-bump"

/**
 * O GUARD DONO da classe da metade 6 — o da contagem da matriz, no recorte
 * `--staged`. Ele sai da lista da fase A (`FASE_A_GUARDS`) pelo NOME porque a
 * atribuição precisa perguntar "ele recusou?" separado dos irmãos: um irmão
 * vermelho no MESMO índice tira a atribuição, e um dono verde a tira também.
 */
export const DONO_DO_COUNT = "check-mutation-count.mjs"

/** O arquivo da suíte do sub-test novo (o que a matriz passa a citar). */
export const BUMP_SUITE = "scripts/test-mutation-prova-bump.sh"

/** O master (a matriz) — o mesmo nome que o guard da contagem lê. */
export const MASTER_DA_MATRIZ = "scripts/test-mutation-guards.sh"

/**
 * O MARCADOR da classe da metade 6 no texto do guard: a defasagem do ATO.
 *
 * É a violação da terceira metade do `check-mutation-count` — a matriz ganhou um
 * sub-test que o registro versionado do bench não tem. É por ele que a recusa é
 * atribuída à DEFASAGEM (e não a qualquer outra violação do mesmo guard): o
 * texto da violação é a fonte, e a mensagem cita o sub-test e o comando do ato.
 */
export const ATO_MARCADOR = "que o ATO não versionou"

/**
 * A suíte nova do bump — o mínimo que o guard da contagem exige de uma suíte: o
 * bloco `METADES=(...)` (a fonte única da descrição do sub-test e da prosa da
 * doc). O conteúdo do script não é exercitado por ninguém na prova: quem o lê é
 * o guard, para derivar as metades.
 *
 * @param {string} id
 * @returns {string}
 */
function suiteDoBump(id) {
  return [
    "#!/usr/bin/env bash",
    "# =============================================================================",
    `# scripts/test-mutation-${id}.sh — o sub-test que a metade 6 acrescenta à matriz.`,
    "#",
    "# Ele existe para MEDIR uma recusa: o bump coerente da matriz (master + as",
    "# refs + este arquivo) SEM o ato que versiona o custo dele. O commit tem de",
    "# ser recusado pelo `check-mutation-count`, e a recusa tem de nomear ESTE id.",
    "#",
    "# O CABEÇALHO (Usage + Exit code) não é enfeite: o `barrel-lint` da fase B",
    "# varre o cabeçalho de todo script do índice, e uma suíte sem ele faria o",
    "# commit do DEFEITO ser recusado pela fase B também — a recusa deixaria de",
    "# ser atribuível ao guard da contagem (medido: era isso que acontecia).",
    "#",
    "# Usage:",
    `#   bash scripts/test-mutation-${id}.sh`,
    "#",
    "# Exit codes:",
    "#   0 — a suíte do fixture passou (ela não mede nada: existe para a matriz)",
    "#   1 — falha",
    "# =============================================================================",
    "set -euo pipefail",
    "",
    "METADES=(",
    `  'M1|a metade que prova o bump da matriz (${id})'`,
    "  'M2|o controle do bump (o ato versionado faz o mesmo commit entrar)'",
    ")",
    "",
    'echo "suite do bump (fixture da prova): nada a rodar"',
    "",
  ].join("\n")
}

/**
 * O BUMP COERENTE da matriz, por INTEIRO — a premissa que torna a recusa
 * atribuível.
 *
 * COERENTE quer dizer: o master (a entrada nova e o header), as refs de count no
 * `pr-check.yml` (o summary e o comentário do job) e as refs VIVAS do README, mais
 * o ARQUIVO da suíte nova. Só o ATO fica de fora — no defeito. O `verso` decide:
 *
 * O DEFEITO é este: o bump INTEIRO e mais nada — o registro versionado segue com
 * as formas do ato anterior → o commit tem de ser RECUSADO. O CONTROLE é o MESMO
 * índice mais o ato versionado (`versionaOAto`), e ele tem de ENTRAR: é ele que
 * prova que a recusa é da DEFASAGEM, e não do bump (ou de um fixture que não sabe
 * commitar).
 *
 * O N e as LINHAS das refs do README saem do PRÓPRIO guard (`run()`, em modo
 * árvore): uma segunda derivação do count divergiria no dia em que o guard fosse
 * ajustado, e a divergência apareceria como "o fixture recusa o que o guard não
 * recusa".
 *
 * @param {string} copia
 * @param {{ler?: typeof readFileSync}} [opts]
 * @returns {{ok: boolean, motivo: string|null, n: number|null, nNovo: number|null, refs: number}}
 */
export function bumpDaMatriz(copia, { ler = readFileSync } = {}) {
  const atual = runCountGuard(copia)
  if (atual.ok !== true) {
    return {
      ok: false,
      motivo:
        `a cópia JÁ chega inconsistente ao bump (${atual.violations[0] ?? "sem motivo"}): ` +
        "sem uma base coerente a recusa mediria a inconsistência que veio de fora, não o bump",
      n: null,
      nNovo: null,
      refs: 0,
    }
  }
  const n = atual.derivedCount
  const nNovo = n + 1

  // 1. A SUÍTE nova (o arquivo que a matriz passa a citar).
  writeFileSync(join(copia, BUMP_SUITE), suiteDoBump(BUMP_SUBTEST), { mode: 0o755 })

  // 2. O MASTER: a entrada nova na matriz e o count do header.
  const caminhoMaster = join(copia, MASTER_DA_MATRIZ)
  const masterSrc = String(ler(caminhoMaster, "utf8"))
  const bloco = /SUBTESTS=\(([\s\S]*?)\n\)/
  if (!bloco.test(masterSrc)) {
    return {
      ok: false,
      motivo: `${MASTER_DA_MATRIZ} não tem o bloco SUBTESTS=(...)`,
      n,
      nNovo,
      refs: 0,
    }
  }
  const masterNovo = masterSrc
    .replace(bloco, (_t, corpo) => `SUBTESTS=(${corpo}\n  "${BUMP_SUBTEST}|${BUMP_SUITE}"\n)`)
    .split(`Roda os ${n} mutation tests node-puro`)
    .join(`Roda os ${nNovo} mutation tests node-puro`)
  writeFileSync(caminhoMaster, masterNovo)

  // 3. O `pr-check.yml`: o summary e o comentário do job (as duas refs do count).
  const caminhoWf = join(copia, WORKFLOW_DO_COUNT)
  const wfSrc = String(ler(caminhoWf, "utf8"))
    .split(`All ${n} node-pure mutation tests passed`)
    .join(`All ${nNovo} node-pure mutation tests passed`)
    .split(`Roda os ${n} mutation tests node-puro`)
    .join(`Roda os ${nNovo} mutation tests node-puro`)
  writeFileSync(caminhoWf, wfSrc)

  // 4. O README: cada ref VIVA que o próprio guard listou, na linha dela.
  const caminhoReadme = join(copia, "README.md")
  const linhas = String(ler(caminhoReadme, "utf8")).split("\n")
  const vivas = atual.refs.readmeLive ?? []
  for (const ref of vivas) {
    const i = ref.lineNo - 1
    if (i < 0 || i >= linhas.length) continue
    // O NÚMERO QUE ABRE o match é trocado (e só ele): um `replace` do valor solto
    // casaria o `3` dentro de um `13 sub-tests` e produziria `140`.
    const novo = ref.match.replace(/^\d+/, String(nNovo))
    linhas[i] = linhas[i].split(ref.match).join(novo)
  }
  writeFileSync(caminhoReadme, linhas.join("\n"))

  return { ok: true, motivo: null, n, nNovo, refs: vivas.length }
}

/**
 * O CONTROLE do bump: o ATO versionado — a forma nova no registro versionado do
 * bench e o count da família.
 *
 * É o remédio que o próprio guard nomeia (o comando do ato), aplicado no fixture
 * SEM rodar o ato (que custa minutos e depende do master inteiro): o que se mede
 * aqui é o VEREDITO do guard sobre um índice com a forma versionada, não o custo
 * do sub-test.
 *
 * @param {string} copia
 * @param {{nNovo: number, ler?: typeof readFileSync}} opts
 * @returns {{ok: boolean, motivo: string|null, formas: number|null}}
 */
export function versionaOAto(copia, { nNovo, ler = readFileSync }) {
  const caminhoBench = join(copia, BENCH_PATH)
  let bench
  try {
    bench = JSON.parse(String(ler(caminhoBench, "utf8")))
  } catch (e) {
    return { ok: false, motivo: `${BENCH_PATH} ilegível: ${e.message}`, formas: null }
  }
  const familia = bench?.mutations
  if (!familia || !Array.isArray(familia.forms)) {
    return {
      ok: false,
      motivo: `${BENCH_PATH} não tem a família \`mutations\` com formas`,
      formas: null,
    }
  }
  familia.forms.push({
    role: BUMP_SUBTEST,
    label: BUMP_SUBTEST,
    ms: 1000,
    exit: 0,
    metades: 2,
    ok: true,
    script: BUMP_SUITE,
    runs: [{ ms: 1000, ok: true }],
  })
  familia.subtests = nNovo
  // A COLUNA: pelo MESMO caminho do ato (`comMetadesDaMatriz`) — a suíte nova
  // declara as metades dela no bloco da própria suíte, e o fixture não pode
  // gravar um número que o ato não gravaria. Sem a derivação (master ilegível),
  // o fixture ainda fecha o TOTAL com as formas: um fixture incoerente por
  // dentro seria recusado pela coerência, e não pela defasagem que ele mede.
  const derivadas = derivacaoDaCopia(copia, ler)
  const corrigida = comMetadesDaMatriz(familia, derivadas) ?? familia
  const total = corrigida.forms.reduce(
    (s, f) => s + (Number.isFinite(f?.metades) ? Number(f.metades) : 0),
    0,
  )
  bench.mutations = corrigida.metades === total ? corrigida : { ...corrigida, metades: total }
  writeFileSync(caminhoBench, `${JSON.stringify(bench, null, 2)}\n`)
  // O ATO não é o registro sozinho: ele REESCREVE as duas prosas derivadas (é o
  // `escreverDocs` do `--baseline`, a MESMA folha que este fixture importa).
  // Versionar só o registro deixaria o índice com a prosa do ato ANTERIOR — o
  // guard o recusaria pela prosa (a regra 6), e não pela defasagem que esta
  // metade mede (medido: o CONTROLE do bump era recusado com o resto verde).
  const notas = escreverDocs({
    cwd: copia,
    registro: bench,
    ler: (p) => String(ler(p, "utf8")),
  })
  const ruins = notas.filter((n) => n.status !== "reescrito" && n.status !== "jaEstava")
  if (ruins.length) {
    return {
      ok: false,
      motivo: `o ato não pôde reescrever as prosas: ${JSON.stringify(ruins)}`,
      formas: corrigida.forms.length,
    }
  }
  return { ok: true, motivo: null, formas: corrigida.forms.length }
}

/**
 * A derivação das metades da MATRIZ de uma CÓPIA — a régua da folha sobre os
 * arquivos dela (o master e cada suíte citada).
 *
 * `null` quando nem o master foi lido: o fixture então mantém o total fechando
 * com as formas, mas não inventa unidade por forma.
 *
 * @param {string} copia
 * @param {typeof readFileSync} [ler]
 * @returns {Map<string, {count: number}>|null}
 */
export function derivacaoDaCopia(copia, ler = readFileSync) {
  const lerDe = (rel) => {
    try {
      return String(ler(join(copia, rel), "utf8"))
    } catch {
      return null
    }
  }
  const masterSrc = lerDe(MASTER_DOS_SUBTESTS)
  if (masterSrc === null) return null
  return metadesDaMatriz({ masterSrc, lerSuite: (rel) => lerDe(rel) })
}

/**
 * O workflow do count (o `pr-check.yml`) — a fonte das refs do job `mutation-guards`.
 * Ele fica aqui como constante para o fixture e o guard falarem do MESMO caminho.
 */
export const WORKFLOW_DO_COUNT = ".github/workflows/pr-check.yml"

/**
 * A prova do bloqueio SEM O DUBLÊ.
 *
 * Mesmo contrato de `proveCommitBlocks` (state/detail/evidence/remedies) e a
 * mesma régua tri-estado: `proven` exige as CINCO metades medidas, `violated` é o
 * defeito que ENTROU, e tudo o que for condição de medição — git, bash, a cópia,
 * o bit de execução do hook, um irmão que reprovou — sai como `unavailable`
 * NOMEANDO o que faltou.
 *
 * AS METADES:
 *   1. o DEFEITO da fase A (corpo `run:` aberto num workflow novo) tem de ser
 *      RECUSADO, com o HEAD intacto;
 *   2. a ATRIBUIÇÃO por exit code: os seis guards de fase A aprovam o MESMO
 *      índice e o GATE é quem recusa;
 *   3. o CONTROLE: o corpo fechado tem de ENTRAR;
 *   4. o DEFEITO da fase B (um de ENCODING e um de LINK, num arquivo novo cada)
 *      tem de ser RECUSADO, com o HEAD intacto;
 *   5. a ATRIBUIÇÃO da fase B: os membros da fase B rodados DIRETO sobre o MESMO
 *      índice (veredito por exit code) e a DESCIDA do runner do encoding nomeando
 *      o guard que recusou — e o CONTROLE de cada defeito (o arquivo REMENDADO)
 *      entrando;
 *   6. o BUMP DE MATRIZ SEM O ATO: um bump COERENTE da matriz (o master, as refs
 *      do count e o arquivo da suíte nova) sem o ato que a versiona tem de ser
 *      RECUSADO, a recusa tem de ser ATRIBUÍVEL (o guard dono medido direto sobre
 *      o MESMO índice, nomeando a defasagem e o sub-test novo, com os irmãos e o
 *      gate verdes) e o CONTROLE (o MESMO índice com o ato versionado) tem de
 *      ENTRAR com a forma nova em HEAD.
 *
 * @param {{root?: string, deps?: {run?: typeof spawnSync, node?: string, existe?: (p: string) => boolean}}} [opts]
 * @returns {CommitBlockProof}
 */
export function proveRealHookBlocks({ root = REPO_ROOT, deps = {} } = {}) {
  const run = deps.run ?? spawnSync
  const existe = deps.existe ?? existsSync
  const remedies = [
    `o hook REAL tem de existir E ser EXECUTÁVEL: um hook sem o bit de execução é IGNORADO por git EM SILÊNCIO (o commit entra sem veredito)`,
    `os SEIS guards de fase A e o gate (${GUARD}) têm de existir em scripts/: sem eles a fase A não roda, e o não-zero seria do ambiente`,
    `\`node_modules\` tem de existir no checkout (a fase C roda de verdade na cópia: \`lint-staged\` e \`typecheck\`)`,
    `a cópia precisa do \`git\` e do \`bash\` vivos (o commit é um \`git commit\` de verdade, e o hook é um script de shell)`,
    `o checkout precisa da HISTÓRIA (\`fetch-depth: 0\`): a fase B tem um membro que pergunta pela história (\`${MEMBRO_DA_HISTORIA}\` exige que todo commit citado na prosa exista em HEAD), e a cópia a vê pelo \`alternates\` do \`.git/objects\` — sem um checkout PROFUNDO, esse membro recusa todo arquivo citado e a prova mediria o fixture`,
  ]
  const faltando = []
  if (!existe(join(root, "node_modules"))) faltando.push("node_modules no checkout")
  if (hookSource(root) === null) faltando.push(`${join(root, ".husky", "pre-commit")} não existe`)
  for (const g of [...FASE_A_GUARDS, GUARD]) {
    if (!existe(join(root, "scripts", g))) faltando.push(`scripts/${g}`)
  }
  // As premissas da HISTÓRIA (ver `ligaObjetosDoCheckout`): a fase B pergunta
  // pelo passado do repositório, e a cópia responde pelo `alternates` do store do
  // checkout. Sem o store (checkout sem `.git`) ou com a história TRUNCADA
  // (checkout raso) o membro da história recusaria TODO arquivo citado — e a
  // atribuição da recusa passaria a falar do fixture, não do hook.
  //
  // A exigência é DERIVADA do hook (o membro aparece no corpo dele?), não cravada:
  // no dia em que a fase B deixar de ter um membro que lê a história, a premissa
  // some com ele.
  const fonteDoHook = hookSource(root)
  if ((fonteDoHook ?? "").includes(MEMBRO_DA_HISTORIA)) {
    if (!existe(join(root, ".git", "objects"))) {
      faltando.push(`o objeto store do checkout (${join(root, ".git", "objects")})`)
    } else if (repoRaso(root, { run })) {
      faltando.push(
        `a HISTÓRIA COMPLETA do checkout (o repositório é RASO: \`${MEMBRO_DA_HISTORIA}\` pergunta em HEAD e as citações são de commits do passado — busque com \`fetch-depth: 0\`)`,
      )
    }
  }
  // As premissas da FASE B: cada defeito precisa de um arquivo NOVO (o refutador
  // tem de ser nomeável) e o runner do encoding tem de DECLARAR os comandos que a
  // descida espera medir — um comando que ele não declara mais seria medido por
  // outra régua (ou não seria), e a atribuição passaria a falar de outro conjunto.
  const linhasDoRunner = existe(join(root, RUNNER_ENCODING))
    ? readFileSync(join(root, RUNNER_ENCODING), "utf8")
        .split("\n")
        .map((l) => l.trim())
    : null
  if (linhasDoRunner === null)
    faltando.push(`scripts/${RUNNER_ENCODING} (a descida da fase B lê os comandos dele)`)
  for (const d of FASE_B_DEFEITOS) {
    if (existe(join(root, d.arquivo))) {
      faltando.push(
        `${d.arquivo} JÁ EXISTE no checkout (o defeito de fase B '${d.id}' precisa de um arquivo NOVO para o refutador ser nomeável)`,
      )
    }
    for (const comando of d.recusadoresEsperados.descida) {
      if (linhasDoRunner !== null && !linhasDoRunner.includes(comando)) {
        faltando.push(
          `o runner (${RUNNER_ENCODING}) não declara '${comando}' — a descida do defeito '${d.id}' mediria outro conjunto`,
        )
      }
    }
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
    // A HISTÓRIA (ver `ligaObjetosDoCheckout`): o store do checkout entra por
    // `alternates` e o commit de base nasce EM CIMA do HEAD real — a fase B
    // pergunta pelo passado do repositório, e uma cópia de um commit só faria
    // todo arquivo citado parecer órfão.
    const objetos = ligaObjetosDoCheckout(copia, { root })
    const headDoCheckout = objetos.ok ? shaDoHead(root) : null
    if (objetos.ok && headDoCheckout) runGit(copia, ["update-ref", "HEAD", headDoCheckout])
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
    const baseSha = shaDoHead(copia)
    // A medida LOCAL (a cópia compartilha o store do checkout): o que interessa é
    // o que ELA acrescentou ao base — um commit recusado não move o HEAD.
    const objetosBase = commitsAcimaDaBase(copia, baseSha, { run })
    const headBase = baseSha

    // ── METADE 1: o defeito no ÍNDICE tem de ser RECUSADO pelo GATE ────────
    stage(copia, REAL_WORKFLOW, REAL_WORKFLOW_QUEBRADO)
    const bloqueio = runGit(copia, ["commit", "-m", "defeito (corpo `run:` aberto)"])
    const objetosDepois = commitsAcimaDaBase(copia, baseSha, { run })
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
      // As metades 4 e 5 (a fase B com o defeito no índice) preenchem esta lista
      // por defeito declarado em `FASE_B_DEFEITOS`.
      faseB: [],
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
    const objetosControle = commitsAcimaDaBase(copia, baseSha, { run })
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

    // ── METADES 4 e 5: a FASE B real, com um DEFEITO de encoding/link ─────
    //
    // A metade 3 media a fase B pelo lado que passa (o controle ENTRA). Aqui a
    // mesma fase é medida com o defeito NO ÍNDICE, como a fase A: o commit tem de
    // ser RECUSADO, a recusa tem de ser ATRIBUÍVEL (os membros rodados direto
    // sobre o MESMO índice, o veredito por exit code, e a DESCIDA do runner
    // nomeando o guard) e o CONTROLE (o arquivo remendado) tem de ENTRAR.
    for (const defeito of FASE_B_DEFEITOS) {
      const entrada = {
        id: defeito.id,
        rotulo: defeito.rotulo,
        arquivo: defeito.arquivo,
        recusadoresEsperados: defeito.recusadoresEsperados,
        defeito: null,
        membros: [],
        descida: null,
        irmaos: [],
        gate: null,
        controle: null,
      }
      evidencia.faseB.push(entrada)
      const ondeFaseB = `o defeito de fase B '${defeito.id}' (${defeito.rotulo})`

      const headAntesB = shaDoHead(copia)
      escritaDoDefeitoDaFaseB(copia, defeito, { runGit })
      const recusaB = runGit(copia, ["commit", "-m", `defeito de fase B (${defeito.id})`])
      const headDepoisB = shaDoHead(copia)
      entrada.defeito = {
        status: recusaB.status,
        output: recusaB.output.trim().split("\n").slice(0, 4).join(" | "),
        headAntes: headAntesB,
        headDepois: headDepoisB,
      }
      if (recusaB.status === null) {
        return {
          state: "unavailable",
          detail: `${ondeFaseB}: o \`git commit\` não terminou — o veredito da fase B não foi medido`,
          evidence: evidencia,
          remedies,
        }
      }
      if (recusaB.status === 0 || headDepoisB !== headAntesB) {
        return {
          state: "violated",
          detail:
            `${ondeFaseB} NÃO foi bloqueado: exit ${recusaB.status} e o HEAD ` +
            `${headDepoisB === headAntesB ? "NÃO avançou" : `avançou de ${String(headAntesB).slice(0, 12)} para ${String(headDepoisB).slice(0, 12)}`} — ` +
            `a fase B deixou passar um defeito da classe que ela existe para pegar`,
          evidence: evidencia,
          remedies,
        }
      }

      // A ATRIBUIÇÃO, no MESMO índice do defeito: os membros da fase B (cada um
      // pelo exit code do comando do hook), a descida do runner, e — para a recusa
      // ser da FASE B — a fase A e o gate verdes aqui.
      const estagioDoIndice = arquivosDeFormatoDoIndice(copia)
      entrada.membros = FASE_B_MEMBROS.map((m) =>
        rodaMembroDeFaseB(copia, m, { run, node: deps.node, estagio: estagioDoIndice }),
      )
      entrada.descida = descidaDoEncodingRunner(copia, { run, node: deps.node })
      entrada.irmaos = FASE_A_GUARDS.map((g) =>
        rodaGuardDeFaseA(copia, g, { run, node: deps.node }),
      )
      entrada.gate = rodaGuardDeFaseA(copia, GUARD, { run, node: deps.node })

      const membrosNaoMedidos = entrada.membros.filter((m) => m.status === null)
      if (membrosNaoMedidos.length > 0) {
        return {
          state: "unavailable",
          detail:
            `${ondeFaseB}: ${membrosNaoMedidos.length} membro(s) da fase B NÃO terminaram ` +
            `(${membrosNaoMedidos.map((m) => m.guard).join(", ")}) — sem exit code não há veredito`,
          evidence: evidencia,
          remedies,
        }
      }
      const vermelhosDaFaseA = entrada.irmaos.filter((i) => i.status !== 0)
      if (vermelhosDaFaseA.length > 0 || entrada.gate.status !== 0) {
        return {
          state: "unavailable",
          detail:
            `${ondeFaseB}: a recusa NÃO é atribuível à fase B — no MESMO índice, ` +
            `${vermelhosDaFaseA.map((i) => `${i.guard}=${i.status}`).join(", ") || "nenhum guard de fase A vermelho"}` +
            ` e o gate saiu ${entrada.gate.status === null ? "sem veredito" : entrada.gate.status}`,
          evidence: evidencia,
          remedies,
        }
      }
      const membrosVermelhos = entrada.membros.filter((m) => m.status !== 0).map((m) => m.guard)
      const esperados = [...defeito.recusadoresEsperados.membros].sort()
      const medidos = [...membrosVermelhos].sort()
      if (medidos.join("|") !== esperados.join("|")) {
        const faltou = esperados.filter((e) => !medidos.includes(e))
        const sobrou = medidos.filter((m) => !esperados.includes(m))
        return {
          state: "unavailable",
          detail:
            `${ondeFaseB}: a ATRIBUIÇÃO mudou — ` +
            (faltou.length > 0
              ? `o(s) guard(s) declarado(s) como refutador(es) ficou(aram) verde(s): ${faltou.join(", ")}; `
              : "") +
            (sobrou.length > 0
              ? `e um refutador NÃO declarado apareceu: ${sobrou.join(", ")} `
              : "") +
            `(medidos: ${medidos.join(", ") || "nenhum"})`,
          evidence: evidencia,
          remedies,
        }
      }
      if (entrada.descida.indisponivel !== null) {
        return {
          state: "unavailable",
          detail: `${ondeFaseB}: a descida do runner não pôde ser medida — ${entrada.descida.indisponivel}`,
          evidence: evidencia,
          remedies,
        }
      }
      if (entrada.descida.recusadores.some((r) => r.status === null)) {
        return {
          state: "unavailable",
          detail: `${ondeFaseB}: ${entrada.descida.recusadores
            .filter((r) => r.status === null)
            .map((r) => r.comando)
            .join(", ")} não terminou (o veredito do guard que recusa a classe não foi medido)`,
          evidence: evidencia,
          remedies,
        }
      }
      const descidaEsperada = [...defeito.recusadoresEsperados.descida].sort()
      const descidaMedida = entrada.descida.recusadores.map((r) => r.comando).sort()
      if (descidaMedida.join("|") !== descidaEsperada.join("|")) {
        const faltou = descidaEsperada.filter((e) => !descidaMedida.includes(e))
        const sobrou = descidaMedida.filter((m) => !descidaEsperada.includes(m))
        return {
          state: "unavailable",
          detail:
            `${ondeFaseB}: a DESCIDA do runner não bate com o declarado — ` +
            (faltou.length > 0 ? `não recusou: ${faltou.join(", ")}; ` : "") +
            (sobrou.length > 0 ? `recusou SEM estar declarado: ${sobrou.join(", ")} ` : "") +
            `(medidos: ${descidaMedida.join(", ") || "nenhum"})`,
          evidence: evidencia,
          remedies,
        }
      }

      // O CONTROLE do defeito: o MESMO arquivo REMENDADO tem de ENTRAR — sem ele,
      // "recusou" seria indistinguível de uma cópia que não sabe commitar (o
      // mesmo raciocínio da metade 3).
      escritaDoRemendoDaFaseB(copia, defeito, { runGit })
      const controleB = runGit(copia, ["commit", "-m", `controle de fase B (${defeito.id})`])
      const headControleB = shaDoHead(copia)
      entrada.controle = {
        status: controleB.status,
        output: controleB.output.trim().split("\n").slice(0, 4).join(" | "),
        headAntes: headAntesB,
        headDepois: headControleB,
      }
      if (controleB.status === null) {
        return {
          state: "unavailable",
          detail: `${ondeFaseB}: o \`git commit\` do CONTROLE não terminou — sem ele, a recusa medida acima não é do defeito`,
          evidence: evidencia,
          remedies,
        }
      }
      if (controleB.status !== 0 || headControleB === headDepoisB) {
        return {
          state: "unavailable",
          detail:
            `${ondeFaseB}: o CONTROLE (${defeito.arquivo} REMENDADO) não comitou ` +
            `(exit ${controleB.status}, HEAD ${headControleB === headDepoisB ? "NÃO avançou" : "avançou"}) — ` +
            `sem ele, "a fase B recusou o defeito" não se distingue de "o arquivo não pôde entrar"`,
          evidence: evidencia,
          remedies,
        }
      }
      const gravadoB = committedContent(copia, defeito.arquivo)
      entrada.controle.conteudoEmHead =
        gravadoB === defeito.remendo ? "igual ao arquivo remendado" : "outro conteúdo"
      if (gravadoB !== defeito.remendo) {
        return {
          state: "unavailable",
          detail: `${ondeFaseB}: o CONTROLE comitou um conteúdo diferente do remendo (${defeito.arquivo}) — a cópia não está medindo o que a prova diz`,
          evidence: evidencia,
          remedies,
        }
      }
    }

    // ── METADE 6: o BUMP DE MATRIZ sem o ATO ──────────────────────────────
    //
    // A classe é a terceira metade do `check-mutation-count`, no recorte que o
    // hook usa: um bump COERENTE da matriz (o master, as refs do count no
    // `pr-check.yml` e as refs VIVAS do README, mais o ARQUIVO da suíte nova)
    // cujo ATO que versiona o custo dele não vai no mesmo commit. É a janela que
    // o recorte do índice existe para fechar — a matriz num commit e o ato no
    // seguinte deixam o primeiro INCONSISTENTE, e quem o aprova na forja recebe
    // um CI vermelho por um número que o commit seguinte ia consertar.
    //
    // A atribuição é a mesma das outras metades: o guard dono medido DIRETO sobre
    // o MESMO índice (exit code + o marcador da violação, que nomeia o sub-test
    // novo) e os irmãos da fase A verdes ali — sem isso, "recusou" não diz QUEM
    // recusou. E o CONTROLE: o MESMO índice com o ato versionado tem de ENTRAR,
    // que é o que separa "a defasagem recusa" de "a cópia não sabe commitar".
    const bump = bumpDaMatriz(copia)
    const entradaBump = {
      subTest: BUMP_SUBTEST,
      escrito: bump.ok,
      motivoDoFixture: bump.motivo,
      n: bump.n,
      nNovo: bump.nNovo,
      refs: bump.refs,
      defeito: null,
      atribuicao: null,
      irmaos: [],
      membros: [],
      gate: null,
      controle: null,
    }
    evidencia.bump = entradaBump
    if (!bump.ok) {
      return {
        state: "unavailable",
        detail:
          `o bump coerente da matriz não pôde ser escrito na cópia — ${bump.motivo}: ` +
          `sem o índice do defeito a recusa não é medível (e a prova não pode dizer que o guard recusa o que ele não julgou)`,
        evidence: evidencia,
        remedies,
      }
    }
    runGit(copia, ["add", "-A"])
    const headAntesBump = shaDoHead(copia)
    const recusaBump = runGit(copia, [
      "commit",
      "-m",
      `bump de matriz (${BUMP_SUBTEST}, sem o ato)`,
    ])
    const headDepoisBump = shaDoHead(copia)
    entradaBump.defeito = {
      status: recusaBump.status,
      output: recusaBump.output.trim().split("\n").slice(0, 6).join(" | "),
      headAntes: headAntesBump,
      headDepois: headDepoisBump,
    }
    if (recusaBump.status === null) {
      return {
        state: "unavailable",
        detail: `o \`git commit\` do bump de matriz não terminou (o teto por comando do simulador, \`runGit\`, ou um sinal) — o veredito da recusa não foi medido`,
        evidence: evidencia,
        remedies,
      }
    }
    if (recusaBump.status === 0 || headDepoisBump !== headAntesBump) {
      return {
        state: "violated",
        detail:
          `o hook REAL (sem dublê) NÃO bloqueou o bump da matriz SEM o ato que a versiona: ` +
          `exit ${recusaBump.status} e o HEAD ` +
          `${headDepoisBump === headAntesBump ? "NÃO avançou" : `avançou de ${String(headAntesBump).slice(0, 12)} para ${String(headDepoisBump).slice(0, 12)}`} — ` +
          `a matriz entra num commit cujo número declarado descreve a matriz do commit SEGUINTE`,
        evidence: evidencia,
        remedies,
      }
    }

    // A ATRIBUIÇÃO, no MESMO índice do bump: o guard dono (exit + o marcador da
    // violação, com o sub-test novo nomeado) e os irmãos da fase A verdes aqui.
    const donoDoCount = rodaGuardDeFaseA(copia, DONO_DO_COUNT, { run, node: deps.node })
    const irmaosDoBump = FASE_A_GUARDS.filter((g) => g !== DONO_DO_COUNT).map((g) =>
      rodaGuardDeFaseA(copia, g, { run, node: deps.node }),
    )
    const gateDoBump = rodaGuardDeFaseA(copia, GUARD, { run, node: deps.node })
    // Os membros da fase B TAMBÉM entram na atribuição — e não é zelo: medido,
    // uma suíte nova sem o cabeçalho (Usage + Exit code) fazia o `barrel-lint`
    // reprovar o MESMO índice, e como a fase A recusa ANTES de a fase B rodar, a
    // recusa do commit teria ficado atribuída ao guard da contagem sem ser dele.
    const estagioDoIndiceBump = arquivosDeFormatoDoIndice(copia)
    const membrosDoBump = FASE_B_MEMBROS.map((m) =>
      rodaMembroDeFaseB(copia, m, { run, node: deps.node, estagio: estagioDoIndiceBump }),
    )
    entradaBump.irmaos = irmaosDoBump
    entradaBump.gate = gateDoBump
    entradaBump.membros = membrosDoBump
    entradaBump.atribuicao = {
      guard: DONO_DO_COUNT,
      status: donoDoCount.status,
      citouMarcador: donoDoCount.output.includes(ATO_MARCADOR),
      citouSubTest: donoDoCount.output.includes(BUMP_SUBTEST),
    }
    if (donoDoCount.status === null) {
      return {
        state: "unavailable",
        detail: `o guard dono da contagem (${DONO_DO_COUNT} --staged) não terminou sobre o índice do bump — sem exit code, a recusa não é atribuível`,
        evidence: evidencia,
        remedies,
      }
    }
    if (donoDoCount.status === 0) {
      return {
        state: "unavailable",
        detail:
          `o commit do bump foi recusado, mas o guard dono (${DONO_DO_COUNT} --staged) APROVOU o mesmo índice (exit 0): ` +
          `a recusa não é da defasagem da matriz — sem um refutador nomeado, a prova não pode dizer que esta classe é recusada`,
        evidence: evidencia,
        remedies,
      }
    }
    if (!entradaBump.atribuicao.citouMarcador || !entradaBump.atribuicao.citouSubTest) {
      return {
        state: "unavailable",
        detail:
          `o guard dono recusou o índice do bump (exit ${donoDoCount.status}), mas a saída dele não traz ` +
          `${!entradaBump.atribuicao.citouMarcador ? `o marcador da defasagem ('${ATO_MARCADOR}')` : ""}` +
          `${!entradaBump.atribuicao.citouMarcador && !entradaBump.atribuicao.citouSubTest ? " e " : ""}` +
          `${!entradaBump.atribuicao.citouSubTest ? `o sub-test novo ('${BUMP_SUBTEST}')` : ""}` +
          ` — o vermelho pode ser de outra regra do mesmo guard, e a prova mediria uma classe que ela não nomeia`,
        evidence: evidencia,
        remedies,
      }
    }
    const irmaosBumpVermelhos = irmaosDoBump.filter((i) => i.status !== 0)
    const membrosBumpVermelhos = membrosDoBump.filter((m) => m.status !== 0)
    if (
      irmaosBumpVermelhos.length > 0 ||
      membrosBumpVermelhos.length > 0 ||
      gateDoBump.status !== 0
    ) {
      return {
        state: "unavailable",
        detail:
          `a recusa do bump NÃO é atribuível ao guard da contagem — no MESMO índice, ` +
          `${irmaosBumpVermelhos.map((i) => `${i.guard}=${i.status}`).join(", ") || "nenhum irmão de fase A vermelho"}` +
          `, ${membrosBumpVermelhos.map((m) => `${m.guard}=${m.status}`).join(", ") || "nenhum membro de fase B vermelho"}` +
          ` e o gate saiu ${gateDoBump.status === null ? "sem veredito" : gateDoBump.status}`,
        evidence: evidencia,
        remedies,
      }
    }

    // O CONTROLE: o MESMO índice com o ATO versionado (o remédio que o próprio
    // guard nomeia) tem de ENTRAR — e o que entra em HEAD tem de ser o registro
    // com a forma nova, não "algum commit passou".
    const ato = versionaOAto(copia, { nNovo: bump.nNovo })
    if (!ato.ok) {
      return {
        state: "unavailable",
        detail: `o ato do bump não pôde ser escrito na cópia — ${ato.motivo}: sem ele não há CONTROLE, e "a defasagem recusa" fica indistinguível de "a cópia não sabe commitar"`,
        evidence: evidencia,
        remedies,
      }
    }
    // O índice do CONTROLE recebe TUDO o que o ato escreveu: o registro E as duas
    // prosas que ele reescreve (a lista sai da folha do ato, não de uma segunda
    // lista à mão). Deixar as prosas de fora fazia o commit ser recusado pela
    // PROSA no recorte do índice (a regra 6), e não pela defasagem que esta
    // metade mede — medido: o CONTROLE saía `exit 1` com o registro já versionado.
    runGit(copia, ["add", "--", BENCH_PATH, ...DOCS.map((d) => d.arquivo)])
    const controleBump = runGit(copia, [
      "commit",
      "-m",
      `bump de matriz (${BUMP_SUBTEST}, com o ato)`,
    ])
    const headControleBump = shaDoHead(copia)
    entradaBump.controle = {
      status: controleBump.status,
      output: controleBump.output.trim().split("\n").slice(0, 6).join(" | "),
      formas: ato.formas,
      headAntes: headDepoisBump,
      headDepois: headControleBump,
    }
    if (controleBump.status === null) {
      return {
        state: "unavailable",
        detail: `o \`git commit\` do CONTROLE do bump não terminou — sem ele, a recusa medida acima não é da defasagem`,
        evidence: evidencia,
        remedies,
      }
    }
    if (controleBump.status !== 0 || headControleBump === headDepoisBump) {
      return {
        state: "unavailable",
        detail:
          `o CONTROLE do bump (a MESMA matriz com o ato versionado) não comitou ` +
          `(exit ${controleBump.status}, HEAD ${headControleBump === headDepoisBump ? "NÃO avançou" : "avançou"}) — ` +
          `sem ele, a recusa do índice não se distingue de uma cópia que não sabe commitar`,
        evidence: evidencia,
        remedies,
      }
    }
    const benchEmHead = committedContent(copia, BENCH_PATH)
    let formasEmHead = null
    try {
      const parsed = JSON.parse(benchEmHead)
      const familia = parsed?.mutations
      formasEmHead = Array.isArray(familia?.forms)
        ? familia.forms.filter((f) => f.role === BUMP_SUBTEST).length
        : 0
    } catch {
      formasEmHead = null
    }
    entradaBump.controle.formasEmHead = formasEmHead
    if (formasEmHead !== 1) {
      return {
        state: "unavailable",
        detail:
          `o CONTROLE do bump comitou um registro SEM a forma do sub-test novo em HEAD ` +
          `(${formasEmHead === null ? `${BENCH_PATH} ilegível em HEAD` : `${formasEmHead} forma(s) '${BUMP_SUBTEST}'`}) — ` +
          `a cópia não está medindo o que a prova diz`,
        evidence: evidencia,
        remedies,
      }
    }

    const faseBResumo = evidencia.faseB
      .map(
        (f) =>
          `'${f.id}' por ${f.membros
            .filter((m) => m.status !== 0)
            .map((m) => m.guard)
            .join("+")}` +
          ` (descido até ${f.descida.recusadores.map((r) => r.comando).join(", ")})`,
      )
      .join("; ")

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
        `o mesmo commit com o corpo fechado ENTROU (exit ${controle.status}, HEAD em ${String(headControle).slice(0, 12)}, conteúdo conferido em HEAD)` +
        `; a fase B REAL recusou ${evidencia.faseB.length} defeito(s) de encoding/link no índice — ${faseBResumo} —, ` +
        `cada um com os ${FASE_B_MEMBROS.length} membros da fase B medidos DIRETO sobre o MESMO índice ` +
        `(os esperados vermelhos e nenhum outro), a fase A e o gate verdes nesse índice, ` +
        `e o CONTROLE de cada um (o arquivo REMENDADO) ENTRANDO` +
        `; e o bump da matriz SEM o ato que a versiona foi recusado também ` +
        `(${DONO_DO_COUNT} --staged, exit ${entradaBump.atribuicao?.status}, nomeando '${ATO_MARCADOR}' e o sub-test '${BUMP_SUBTEST}'), ` +
        `com os irmãos e o gate verdes no MESMO índice e o CONTROLE (o ato versionado) ENTRANDO com a forma nova em HEAD`,
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
