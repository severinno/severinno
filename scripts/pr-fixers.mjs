/**
 * pr-fixers.mjs
 *
 * A DESCOBERTA dos fixers do CANAL DO PR — derivada de `scripts/remedy-canal/`
 * (uma declaração por remendo), nunca escrita à mão.
 *
 * POR QUE DESCOBERTA, e não um registro aqui dentro (era o que havia): enquanto o
 * `FIXERS` morava no `pr-remedy-comment.mjs`, um guard novo que já sabia consertar
 * (`--fix`) e produzir o PATCH (`remedyPatch`) ficava FORA do canal até alguém
 * editar aquele arquivo — e a regressão não acusa nada, porque um remédio que não
 * publica é indistinguível de um defeito sem remédio. Pior: a prosa do comentário
 * (marcador, nome do gate, o que o remédio não cobre) era um SEGUNDO lugar para o
 * mesmo defeito, e o par declaração × registro divergiria na primeira correção
 * que um dos dois recebesse (o `comandoFix`, por exemplo, já era a cópia do
 * `fixer` da declaração da CLASSE).
 *
 * O PAR DECLARATIVO (e o que sai de cada lado):
 *   - `scripts/remedy-canal/<id>.mjs`  → a prosa do comentário (`marker`,
 *     `gateJob`, `titulo`, `achado`, `naoCobre`, `rodape`) e o `default`;
 *   - `scripts/remedy-classes/<id>.mjs` → o guard dono (`script`), o comando do
 *     `--fix` (`fixer`) e a `ordem` — a MESMA classe que o pre-commit oferece.
 * O `id` é o nome do arquivo nas duas pontas: um fixer novo entra no canal no
 * commit em que a declaração e a classe existem, sem editar registro nenhum.
 *
 * A RÉGUA DO CANAL É DERIVADA — as duas direções, fail-closed:
 *   1. a declaração do canal EXIGE a classe de mesmo id e o guard dono exportando
 *      `remedyPatch` — o canal publica o MESMO patch que o `--fix --dry-run`
 *      gravaria; declarar o canal sem o produtor do patch promete o que o dono não
 *      tem, e sem a classe não há nem comando nem dono;
 *   2. o guard dono que JÁ exporta `remedyPatch` EXIGE a declaração do canal —
 *      senão o repositório sabe publicar aquele remendo e o canal fica sem ele,
 *      em silêncio. (Um dono sem `remedyPatch` — os `.sh`, por exemplo, que não
 *      exportam função nenhuma — não entra no canal, e essa ausência é MECÂNICA:
 *      não é uma decisão que alguém precise declarar por escrito.)
 *
 * O CONTRATO DA DECLARAÇÃO (validado aqui, fail-closed):
 *   - `id` igual ao nome do arquivo (e, pela ponta 1, ao id da classe);
 *   - `marker` é um comentário HTML ÚNICO entre os fixers (a reconciliação é por
 *     marcador: dois fixers com o mesmo marcador retirariam o comentário um do
 *     outro) e o campo que o corpo publica;
 *   - `gateJob`, `titulo`, `naoCobre` e `rodape` são texto não vazio (o corpo do
 *     comentário é montado deles);
 *   - `achado` é uma FUNÇÃO de N (as remendas contadas) — a prosa do achado;
 *   - EXATAMENTE um fixer declara `default: true` (o `fixerOf()` sem argumento):
 *     zero é "ninguém sabe qual é o default" e dois é a escolha feita por ordem
 *     de arquivo, que muda entre hosts.
 *
 * UMA DECLARAÇÃO INVÁLIDA NÃO SOME DO CANAL EM SILÊNCIO: ela sai em
 * `CANAL_PROBLEMAS`, o fixer NÃO entra em `FIXERS`, e o `pr-remedy-comment.mjs`
 * RECUSA a rodada (exit 2) quando há problema — o PR nunca é julgado por um canal
 * incompleto, e a mensagem diz qual arquivo e o que falta.
 *
 * QUEM PRECISA SÓ DOS IDs NÃO PASSA POR AQUI. Este módulo é assíncrono por
 * natureza (`import()` de caminhos descobertos em runtime) e usa top-level await:
 * um módulo com TLA que seja alcançável a partir do grafo de uma CLASSE fecha um
 * ciclo com o `remedy-classes.mjs` e o node sai 13 sem imprimir nada (o
 * pre-commit morre). Por isso o `check-forge-parity.mjs` lê a COBERTURA de
 * `remedy-canal.mjs` (folha), não daqui — a régua completa está no cabeçalho
 * daquele módulo.
 *
 * Usage:
 *   import { FIXERS, DEFAULT_FIXER, CANAL_PROBLEMAS } from "./pr-fixers.mjs"
 *   const { fixers, problemas } = await discoverFixers({ canalDir: "fixture/canal" })
 *
 * Exit codes:
 *   (módulo — sem CLI próprio; o exit code é o do `pr-remedy-comment.mjs`, que
 *   transforma `CANAL_PROBLEMAS` não vazio em exit 2)
 */

import { dirname, join } from "node:path"
import { pathToFileURL } from "node:url"

import { CANAL_DIR, caminhoDaDeclaracao, idsDoCanal } from "./remedy-canal.mjs"
import { REMEDY_CLASSES_DIR, discoverRemedyClasses } from "./remedy-classes.mjs"

/**
 * UM fixer do canal, já resolvido pela descoberta: o que o publicador publica
 * (a prosa do comentário), o que o CI cita e o que mede o patch. O `medir` é a
 * função `remedyPatch` do GUARD DONO — a mesma que o `--fix --dry-run` imprime.
 *
 * @typedef {object} Fixer
 * @property {string} id
 * @property {number} ordem
 * @property {string} comandoFix
 * @property {string} marker
 * @property {string} gateJob
 * @property {string} titulo
 * @property {(n: number) => string} achado
 * @property {string} naoCobre
 * @property {string} rodape
 * @property {(...args: any[]) => any} medir
 * @property {boolean} default
 */

/** Os campos que o canal consome da declaração (fora o `id` e o `default`). */
export const CAMPOS_DO_CANAL = ["marker", "gateJob", "titulo", "achado", "naoCobre", "rodape"]

/** O único campo da declaração que é FUNÇÃO (o resto é a prosa do comentário). */
export const CAMPOS_DO_CANAL_FUNCAO = ["achado"]

/** Os campos de texto não vazio. */
export const CAMPOS_DO_CANAL_TEXTO = ["marker", "gateJob", "titulo", "naoCobre", "rodape"]

/** As extensões que um módulo JS pode ter — o que o canal consegue IMPORTAR. */
export const EXTENSOES_DE_MODULO = [".mjs", ".js"]

/**
 * A FORMA de um marcador: um comentário HTML. O `pr-remedy-comment` casa o
 * marcador no corpo do comentário para reconciliar, e um marcador que não fosse
 * um comentário apareceria no PR como texto solto — visível para quem lê e
 * invisível para a busca.
 */
export const MARCADOR_RE = /^<!--[\s\S]*-[\s\S]*-->$/

/**
 * O que o canal exige do GUARD DONO: o produtor do patch.
 *
 * É a mesma função que o `--fix --dry-run` imprime e que o operador cola no
 * terminal — o comentário do PR publica o que o `--fix` GRAVARIA, e uma segunda
 * régua aqui prometeria um remendo que a gravação recusaria.
 */
export const PRODUTOR_DO_PATCH = "remedyPatch"

/**
 * O dono é um módulo que o canal consegue importar? Um `.sh`/`.py` não exporta
 * função nenhuma: a ausência de `remedyPatch` ali é MECÂNICA (não é uma decisão
 * que a declaração precise declarar por escrito).
 *
 * @param {string} script
 * @returns {boolean}
 */
export function donoImportavel(script) {
  return EXTENSOES_DE_MODULO.some((ext) => String(script).endsWith(ext))
}

/**
 * Valida UMA declaração do canal. Devolve os problemas (vazia = o fixer entra no
 * canal). Cada mensagem nomeia o ARQUIVO e o que falta, porque é ela que quem
 * publica o PR lê quando a rodada é recusada.
 *
 * @param {{declaracao: object, arquivo: string, id: string, classe: object|null,
 *   dono: object|null, donoImportavel: boolean, marcadores: Map<string, string>}} ctx
 * @returns {string[]}
 */
export function validarDeclaracaoDeCanal({
  declaracao,
  arquivo,
  id,
  classe,
  dono,
  donoImportavel: importavel,
  marcadores,
}) {
  const problemas = []
  const erro = (msg) => problemas.push(`${arquivo}: ${msg}`)
  const canal = declaracao

  if (canal === null || typeof canal !== "object") {
    return [`${arquivo}: a declaração do canal não é um objeto (\`default\` ausente?)`]
  }
  // A CLASSE de mesmo id é a outra ponta do par: sem ela não há guard dono nem
  // comando do `--fix`. Quem chama já a garantiu (`discoverFixers` não entra no
  // laço sem ela), mas a régua é repetida aqui porque esta função é o CONTRATO
  // do bloco — e o teste dela é a metade que prova a exigência.
  if (classe === null || classe === undefined) {
    erro(
      `não há classe 'remedy-classes/${id}.mjs' — o canal publica o MESMO remendo que o pre-commit oferece, e a classe é quem declara o guard dono e o comando do \`--fix\`. Declare a classe (ou remova esta declaração do canal).`,
    )
  }

  if (canal.id !== id) {
    erro(
      `\`id\` é '${canal.id}' e o arquivo é '${arquivo}' — o id é o NOME do arquivo (é ele que casa o canal com a classe do pre-commit)`,
    )
  }

  // A ponta 1 (segunda metade): a classe existe, mas o dono dela não produz o
  // patch — a promessa do canal seria maior que o que o dono sabe entregar.
  const donoProduzPatch = importavel && typeof dono?.[PRODUTOR_DO_PATCH] === "function"
  if (classe != null && !donoProduzPatch) {
    erro(
      `a classe aponta para o guard dono 'scripts/${classe.script}', que ${
        importavel
          ? `não exporta \`${PRODUTOR_DO_PATCH}\``
          : "não é um módulo JS (não há patch a publicar)"
      } — o canal publica o patch do \`--fix\` do dono, e sem o produtor dele não há o que publicar neste PR.`,
    )
  }

  for (const campo of CAMPOS_DO_CANAL) {
    if (!(campo in canal)) erro(`\`${campo}\` ausente (o corpo do comentário é montado dele)`)
  }
  for (const campo of CAMPOS_DO_CANAL_FUNCAO) {
    if (campo in canal && typeof canal[campo] !== "function") {
      erro(`\`${campo}\` não é função — a prosa do achado não sabe contar as remendas`)
    }
  }
  for (const campo of CAMPOS_DO_CANAL_TEXTO) {
    if (campo in canal && (typeof canal[campo] !== "string" || canal[campo].trim() === "")) {
      erro(`\`${campo}\` vazio`)
    }
  }
  if (typeof canal.marker === "string" && canal.marker.trim() !== "") {
    if (!MARCADOR_RE.test(canal.marker.trim())) {
      erro(
        `\`marker\` não é um comentário HTML ('${canal.marker}') — a reconciliação casa o marcador no corpo, e um marcador fora dessa forma apareceria como texto solto no PR`,
      )
    } else if (marcadores.has(canal.marker.trim())) {
      erro(
        `\`marker\` '${canal.marker.trim()}' é o mesmo de '${marcadores.get(canal.marker.trim())}' — a reconciliação é POR marcador: dois fixers com o mesmo retirariam o comentário um do outro`,
      )
    } else {
      marcadores.set(canal.marker.trim(), id)
    }
  }
  if (canal.default !== undefined && typeof canal.default !== "boolean") {
    erro("`default` não é booleano (true só em UM fixer: o do `fixerOf()` sem argumento)")
  }

  return problemas
}

/**
 * A OFERTA do canal derivada dos DOIS diretórios: importa cada declaração do
 * canal, casa com a classe de mesmo id (validada pela régua do pre-commit — uma
 * só), valida o bloco e devolve os fixers prontos para publicar.
 *
 * @param {{canalDir?: string, classesDir?: string, scriptsDir?: string,
 *   importar?: (url: string) => Promise<unknown>}} [opts]
 * @returns {Promise<{fixers: Fixer[], problemas: string[]}>}
 */
export async function discoverFixers({
  canalDir = CANAL_DIR,
  classesDir = REMEDY_CLASSES_DIR,
  scriptsDir = dirname(classesDir),
  importar = (url) => import(url),
} = {}) {
  const problemas = []
  let ids
  try {
    ids = idsDoCanal({ dir: canalDir })
  } catch (e) {
    // Diretório ilegível NÃO é "nenhum fixer": é a cobertura inteira que sumiu, e
    // um canal sem fixer diria "nada a publicar" sobre qualquer PR.
    return { fixers: [], problemas: [`${e?.message ?? e}`] }
  }

  // A validação da CLASSE é a mesma do pre-commit (uma só régua): o canal lê a
  // declaração inteira, e uma classe que não passa lá não pode produzir um fixer
  // aqui — seria publicar no PR um remendo que o commit recusa oferecer.
  const { classes, problemas: problemasDaClasse } = await discoverRemedyClasses({
    dir: classesDir,
    scriptsDir,
    importar,
  })
  problemas.push(...problemasDaClasse)
  const porId = new Map(classes.map((c) => [c.id, c]))

  /** Importa o guard dono de uma classe, cacheado (a classe é uma só por id). */
  const donos = new Map()
  const donoDe = async (classe) => {
    if (!donoImportavel(classe.script)) return { importavel: false, dono: null, erro: null }
    if (donos.has(classe.id)) return donos.get(classe.id)
    const url = pathToFileURL(join(scriptsDir, classe.script)).href
    let entrada
    try {
      entrada = { importavel: true, dono: await importar(url), erro: null }
    } catch (e) {
      // Não conseguir importar o dono NÃO é "ele não tem patch": é a medição do
      // canal que não aconteceu.
      entrada = { importavel: true, dono: null, erro: `${classe.script}: ${e?.message ?? e}` }
    }
    donos.set(classe.id, entrada)
    return entrada
  }

  const marcadores = new Map()
  const fixers = []
  const defaults = []

  if (ids.length === 0 && problemas.length === 0) {
    problemas.push(
      `${canalDir}: nenhuma declaração de canal (*.mjs) — não há fixer para publicar no PR`,
    )
  }

  for (const id of ids) {
    const { url, arquivo } = caminhoDaDeclaracao(id, { dir: canalDir })
    let declaracao
    try {
      declaracao = (await importar(url))?.default
    } catch (e) {
      problemas.push(`${arquivo}: não pude importar (${e?.message ?? e})`)
      continue
    }
    const classe = porId.get(id) ?? null
    let entrada = { importavel: false, dono: null, erro: null }
    if (classe) {
      entrada = await donoDe(classe)
      if (entrada.erro) {
        problemas.push(`não pude importar o guard dono (${entrada.erro})`)
        continue
      }
    }
    const violacoes = validarDeclaracaoDeCanal({
      declaracao,
      arquivo,
      id,
      classe,
      dono: entrada.dono,
      donoImportavel: entrada.importavel,
      marcadores,
    })
    if (violacoes.length > 0) {
      problemas.push(...violacoes)
      continue
    }
    fixers.push({
      id,
      ordem: classe.ordem,
      // O comando do `--fix` NÃO é copiado: é o MESMO campo que o pre-commit usa
      // (duas cópias divergiriam no dia em que o dono mudasse a superfície dele).
      comandoFix: classe.fixer,
      marker: declaracao.marker.trim(),
      gateJob: declaracao.gateJob,
      titulo: declaracao.titulo,
      achado: declaracao.achado,
      naoCobre: declaracao.naoCobre,
      rodape: declaracao.rodape,
      // A medição sai do produtor do patch do PRÓPRIO dono.
      medir: entrada.dono[PRODUTOR_DO_PATCH],
      // A marca do default viaja no fixer: a ajuda, o `--all` e o teste leem a
      // MESMA declaração que a descoberta validou (exatamente uma a tem).
      default: declaracao.default === true,
    })
    if (declaracao.default === true) defaults.push(id)
  }

  // A ponta 2: o dono que SABE produzir o patch e não tem declaração de canal
  // fica fora do PR em silêncio — e é exatamente a regressão que esta descoberta
  // existe para pegar.
  for (const classe of classes) {
    if (ids.includes(classe.id)) continue
    const entrada = await donoDe(classe)
    if (entrada.erro) {
      // A classe sem declaração de canal foi a ÚNICA que tentou importar o dono
      // (as que têm declaração são tratadas no laço acima), então o problema é
      // reportado aqui uma vez.
      problemas.push(`não pude importar o guard dono da classe '${classe.id}' (${entrada.erro})`)
      continue
    }
    if (!entrada.importavel || typeof entrada.dono?.[PRODUTOR_DO_PATCH] !== "function") continue
    problemas.push(
      `${classe.id}: a classe 'remedy-classes/${classe.id}.mjs' aponta para 'scripts/${classe.script}', que exporta \`${PRODUTOR_DO_PATCH}\`, e não há declaração de canal 'remedy-canal/${classe.id}.mjs' — o canal publica o patch que o dono já sabe produzir, e sem a declaração o fixer fica FORA do PR em silêncio. Declare o canal (marker, gateJob, titulo, achado, naoCobre, rodape).`,
    )
  }

  fixers.sort((a, b) => a.ordem - b.ordem)

  if (fixers.length > 0 && defaults.length !== 1) {
    problemas.push(
      defaults.length === 0
        ? "nenhum fixer declara `default: true` — o `fixerOf()` sem argumento não tem default"
        : `dois fixers declaram \`default: true\` (${defaults.join(", ")}) — o default não pode ser escolhido por ordem de arquivo`,
    )
  }

  return { fixers, problemas }
}

const descoberta = await discoverFixers()

/**
 * O REGISTRO do canal — derivado das declarações, nunca editado à mão. É a fonte
 * do `--all` (a cobertura), do `fixerOf` e da ordem do relatório.
 *
 * @type {Record<string, Fixer>}
 */
export const FIXERS = Object.fromEntries(descoberta.fixers.map((f) => [f.id, f]))

/** Os fixers na ordem declarada (a mesma do `--all` e do relatório). */
export const CANAL_FIXERS = descoberta.fixers

/**
 * O id do fixer DEFAULT — quem declara `default: true` na PRÓPRIA declaração (a
 * descoberta exige exatamente um). O default não é "o primeiro da lista":
 * derivá-lo da ordem faria um fixer novo com `ordem` menor mudar, em silêncio,
 * quem o `fixerOf()` sem argumento publica.
 */
export const DEFAULT_FIXER =
  descoberta.fixers.find((f) => f.default === true)?.id ?? descoberta.fixers[0]?.id ?? null

/**
 * As declarações que NÃO entraram no canal, com o motivo. Não vazio = a rodada
 * recusa (exit 2): um PR julgado por um canal incompleto pode deixar de publicar
 * o remendo de um defeito que o repositório sabe remendar.
 */
export const CANAL_PROBLEMAS = descoberta.problemas
