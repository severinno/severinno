/**
 * remedy-classes.mjs
 *
 * A DESCOBERTA das classes do remédio do pre-commit: varre `scripts/remedy-classes/`
 * (um módulo por classe) e devolve a OFERTA — sem NENHUMA lista à mão.
 *
 * POR QUE DESCOBERTA, e não um array aqui dentro: enquanto a lista morava no
 * `pre-commit-remedy.mjs`, um guard novo que já sabia se consertar (`--fix`)
 * ficava FORA da oferta até alguém editar aquele arquivo — e a regressão não
 * acusa nada, porque um remédio que não oferece o conserto é indistinguível de um
 * defeito sem conserto. Com a declaração em `scripts/remedy-classes/<id>.mjs`, o
 * fixer entra na oferta no commit em que é declarado: quem escreve o `--fix` é
 * quem escreve a declaração ao lado dele.
 *
 * O CONTRATO DA DECLARAÇÃO (validado aqui, fail-closed):
 *   1. o NOME do arquivo é o `id` da classe (a oferta e o diretório não podem
 *      divergir: um arquivo renomeado seria uma classe que ninguém acha);
 *   2. `ordem` é um número ÚNICO — a ordem das mensagens não depende da ordem do
 *      sistema de arquivos (que muda entre hosts e entre checkouts);
 *   3. os campos que o driver consome existem e têm o tipo certo;
 *   4. `estagio` é um dos três conhecidos (`add`, `renormalize`, `self`);
 *   5. o DONO declarado (`script`) existe em `scripts/` e a superfície dele
 *      declara `--fix` — a classe não pode prometer um remendo que o guard dono
 *      não tem;
 *   6. o comando do fixer CITA o guard dono (`scripts/<script>`) — a classe e o
 *      comando que ela manda rodar não podem divergir.
 *
 * UMA DECLARAÇÃO INVÁLIDA NÃO SOME DA OFERTA EM SILÊNCIO: ela sai em
 * `CLASSES_PROBLEMAS`, a classe NÃO entra em `CLASSES`, e o `pre-commit-remedy.mjs`
 * RECUSA a rodada (exit 2) quando há problema — um commit nunca é julgado por uma
 * oferta incompleta, e a mensagem diz qual arquivo e o que falta. (A varredura é
 * assíncrona por natureza: `import()` de um caminho descoberto em runtime. Os
 * consumidores leem `CLASSES` já resolvido — este módulo usa top-level await.)
 *
 * Usage:
 *   import { CLASSES, CLASSES_PROBLEMAS } from "./remedy-classes.mjs"
 *   const { classes, problemas } = await discoverRemedyClasses({ dir: "outro/dir" })
 *
 * Exit codes:
 *   (módulo — sem CLI próprio; o exit code é o do `pre-commit-remedy.mjs`, que
 *   transforma `CLASSES_PROBLEMAS` não vazio em exit 2)
 */

import { existsSync, readFileSync, readdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

/**
 * UMA CLASSE DE REMÉDIO, do jeito que o driver a consome. O tipo é declarado
 * aqui (e não deixado como `object`) porque os consumidores — o driver, os testes
 * e o bloco da ajuda — leem campos dela: um `object[]` transformaria cada leitura
 * num erro de tipo e uma classe mal formada passaria a aparecer como `any`.
 *
 * @typedef {object} RemedyClass
 * @property {string} id
 * @property {number} ordem
 * @property {string} script   o guard DONO (o arquivo em `scripts/`)
 * @property {string} label
 * @property {string} verde    a frase do veredito quando a re-detecção volta zero
 * @property {string} vermelho a frase do veredito quando ela continua vermelha
 * @property {"add"|"renormalize"|"self"} estagio
 * @property {string} fixer    o comando do `--fix` do guard dono
 * @property {(paths: string[]) => string[]} sugere
 * @property {(root: string) => (string|null)} aplicavel
 * @property {(root: string, ctx?: object) => RemedyDetection} detectar
 * @property {(root: string, ctx?: object) => RemedyApplication} aplicar
 * @property {boolean} [exigeRelancamento]
 */

/**
 * O QUE UMA DETECÇÃO DEVOLVE. Os campos são opcionais porque cada desfecho usa
 * os seus: uma classe sem candidato devolve `offenders` vazio; a que não pôde ser
 * MEDIDA devolve `indisponivel` (e nunca "nada a remendar"); a que tem violação
 * sem remendo mecânico devolve `semRemendo` com o motivo.
 *
 * @typedef {object} RemedyDetection
 * @property {string[]} [offenders]   os arquivos que o fixer remenda
 * @property {string} [relatorio]     o texto que se mostra antes da pergunta
 * @property {number} [violacoes]     quantas violações o guard dono relatou
 * @property {string} [semRemendo]    há violação e NENHUMA remendável (o motivo)
 * @property {string} [indisponivel]  o guard não pôde ser medido (infra)
 * @property {object} [detalhe]       o que os testes leem do desfecho
 * @property {object[]} [recusas]     o que o fixer viu e não sabe remendar
 */

/**
 * O QUE UMA APLICAÇÃO DEVOLVE.
 *
 * @typedef {object} RemedyApplication
 * @property {string} [relatorio]
 * @property {object} [detalhe]
 */

/** O diretório das declarações, ao lado deste módulo. */
export const REMEDY_CLASSES_DIR = join(dirname(fileURLToPath(import.meta.url)), "remedy-classes")

/** O sufixo dos módulos de declaração. */
export const SUFIXO = ".mjs"

/** Os campos que o driver do remédio consome — sem eles a classe não é oferecível. */
export const CAMPOS_OBRIGATORIOS = [
  "id",
  "ordem",
  "label",
  "verde",
  "vermelho",
  "estagio",
  "fixer",
  "sugere",
  "aplicavel",
  "detectar",
  "aplicar",
]

/** As funções que a classe tem de saber fazer (o resto é texto/função de apoio). */
export const CAMPOS_FUNCAO = ["sugere", "aplicavel", "detectar", "aplicar"]

/** Como o remendo chega ao ÍNDICE — os três desfechos que o driver sabe tratar. */
export const ESTAGIOS = ["add", "renormalize", "self"]

/**
 * Valida UMA declaração. Devolve a lista de problemas (vazia = a classe entra na
 * oferta). Cada mensagem nomeia o ARQUIVO e o que falta, porque é ela que o
 * operador lê quando o commit é recusado.
 *
 * @param {{classe: unknown, arquivo: string, scriptsDir: string, ids: Set<string>, ordens: Set<number>}} ctx
 * @returns {string[]}
 */
export function validarDeclaracao({ classe, arquivo, scriptsDir, ids, ordens }) {
  const problemas = []
  const nomeBase = arquivo.slice(0, -SUFIXO.length)
  const erro = (msg) => problemas.push(`${arquivo}: ${msg}`)

  if (classe === null || typeof classe !== "object") {
    return [`${arquivo}: a declaração não exporta um objeto (default)`]
  }
  for (const campo of CAMPOS_OBRIGATORIOS) {
    if (!(campo in classe)) erro(`campo obrigatório ausente: \`${campo}\``)
  }
  for (const campo of CAMPOS_FUNCAO) {
    if (campo in classe && typeof classe[campo] !== "function") {
      erro(`\`${campo}\` não é função — a classe não sabe ${campo}`)
    }
  }
  for (const campo of ["label", "verde", "vermelho", "fixer"]) {
    if (typeof classe[campo] === "string" && classe[campo].trim() === "") {
      erro(`\`${campo}\` vazio`)
    }
  }
  if (typeof classe.ordem !== "number" || !Number.isFinite(classe.ordem)) {
    erro("`ordem` não é número (a ordem da oferta não pode depender do sistema de arquivos)")
  }
  if (typeof classe.estagio === "string" && !ESTAGIOS.includes(classe.estagio)) {
    erro(`\`estagio\` desconhecido: ${classe.estagio} (válidos: ${ESTAGIOS.join(", ")})`)
  }
  if (typeof classe.id === "string" && classe.id !== nomeBase) {
    erro(`id '${classe.id}' ≠ nome do arquivo '${nomeBase}' (o arquivo É a declaração da classe)`)
  }
  if (typeof classe.id === "string") {
    if (ids.has(classe.id)) erro(`id '${classe.id}' declarado duas vezes`)
    ids.add(classe.id)
  }
  if (typeof classe.ordem === "number") {
    if (ordens.has(classe.ordem)) {
      erro(`ordem ${classe.ordem} repetida — a ordem das mensagens ficaria indefinida`)
    }
    ordens.add(classe.ordem)
  }
  // O DONO: existe, declara `--fix`, e é ele que o fixer cita.
  if (typeof classe.script === "string" && classe.script !== "") {
    const caminho = join(scriptsDir, classe.script)
    if (!existsSync(caminho)) {
      erro(
        `guard dono 'scripts/${classe.script}' não existe — a classe cita um script que ninguém roda`,
      )
    } else if (!readFileSync(caminho, "utf8").includes("--fix")) {
      erro(
        `guard dono 'scripts/${classe.script}' não declara \`--fix\` — a classe promete um remendo que o dono não tem`,
      )
    }
    if (typeof classe.fixer === "string" && !classe.fixer.includes(`scripts/${classe.script}`)) {
      erro(
        `o fixer '${classe.fixer}' não cita o guard dono 'scripts/${classe.script}' — a classe e o comando que ela manda rodar divergiriam`,
      )
    }
  }
  return problemas
}

/**
 * A OFERTA derivada do diretório: importa cada módulo de declaração, valida e
 * ordena. Devolve `{ classes, problemas }` — e quem chama decide o que fazer com
 * o problema (o remédio RECUSA a rodada; o teste exige a lista vazia no repo).
 *
 * @param {{dir?: string, scriptsDir?: string, importar?: (url: string) => Promise<unknown>}} [opts]
 * @returns {Promise<{classes: RemedyClass[], problemas: string[]}>}
 */
export async function discoverRemedyClasses({
  dir = REMEDY_CLASSES_DIR,
  scriptsDir = dirname(dir),
  importar = (url) => import(url),
} = {}) {
  const problemas = []
  const classes = []
  let arquivos
  try {
    arquivos = readdirSync(dir)
      .filter((f) => f.endsWith(SUFIXO))
      .sort()
  } catch (e) {
    // Diretório ilegível NÃO é "nenhuma classe": é a oferta inteira que sumiu, e
    // um remédio sem oferta diria "nada a remendar" sobre qualquer commit.
    return {
      classes: [],
      problemas: [`${dir}: não consegui listar as declarações (${e?.message ?? e})`],
    }
  }
  if (arquivos.length === 0) {
    return { classes: [], problemas: [`${dir}: nenhuma declaração de classe (*${SUFIXO})`] }
  }

  const ids = new Set()
  const ordens = new Set()
  for (const arquivo of arquivos) {
    let modulo
    try {
      modulo = await importar(pathToFileURL(join(dir, arquivo)).href)
    } catch (e) {
      problemas.push(`${arquivo}: não pude importar (${e?.message ?? e})`)
      continue
    }
    const classe = modulo?.default
    const violacoes = validarDeclaracao({ classe, arquivo, scriptsDir, ids, ordens })
    if (violacoes.length > 0) {
      problemas.push(...violacoes)
      continue
    }
    classes.push(classe)
  }
  classes.sort((a, b) => a.ordem - b.ordem)
  return { classes, problemas }
}

const descoberta = await discoverRemedyClasses()

/**
 * A OFERTA — derivada do diretório, nunca editada à mão. É o default do driver
 * (`remedy(root, { classes })` permite injetar outra em teste).
 *
 * @type {RemedyClass[]}
 */
export const CLASSES = descoberta.classes

/**
 * As declarações que NÃO entraram na oferta, com o motivo. Não vazio = a rodada
 * recusa (exit 2): um commit julgado por uma oferta incompleta pode passar
 * oferecendo menos do que o repositório sabe remendar.
 */
export const CLASSES_PROBLEMAS = descoberta.problemas
