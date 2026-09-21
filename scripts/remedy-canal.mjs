/**
 * remedy-canal.mjs
 *
 * O LEITOR das declarações do canal do PR — `scripts/remedy-canal/<id>.mjs`, uma
 * por remendo que o canal publica. Ele NÃO importa nenhuma declaração: lê o
 * DIRETÓRIO. É a peça que permite a um guard saber QUAIS fixers o canal cobre
 * sem entrar no grafo assíncrono da descoberta.
 *
 * POR QUE ESTE MÓDULO EXISTE SEPARADO DO `pr-fixers.mjs`. O `pr-fixers.mjs` é a
 * DESCOBERTA (importa as declarações, as classes do pre-commit e os guards donos
 * para validar o par) e por isso carrega `top-level await`. E aqui está o fato
 * medido, que custou uma rodada vermelha: um módulo com TLA que seja alcançável a
 * partir do grafo de uma CLASSE (`remedy-classes/<id>.mjs` → guard dono →
 * `check-hook-ci-parity` → `check-forge-parity` → …) fecha um CICLO com o próprio
 * `remedy-classes.mjs` (também TLA) e o node NÃO resolve o módulo — ele sai 13
 * (`unsettled top-level await`) sem imprimir nada. O `pre-commit-remedy.mjs`
 * (que a fase A do hook executa) parava de rodar.
 *
 * A régua que sai daí: **nenhum módulo com TLA pode ser alcançável a partir de
 * uma declaração de classe**. O `check-forge-parity` precisa dos IDs (a cobertura
 * do canal), não da prosa — e os IDs são os NOMES dos arquivos deste diretório.
 * Logo: este leitor é folha (só builtins do node), e a descoberta fica do outro
 * lado, atrás dele.
 *
 * O DIREtório VAZIO É FALHA, não "nenhum fixer": um canal sem declaração
 * publicaria "nada a publicar" sobre qualquer PR — o mesmo silêncio que o
 * registro escrito à mão produzia quando ninguém o editava.
 *
 * Usage:
 *   import { idsDoCanal, arquivosDoCanal, caminhoDaDeclaracao } from "./remedy-canal.mjs"
 *   idsDoCanal()                      // → ["pipefail-sigpipe", "run-syntax"]
 *   idsDoCanal({ dir: "outro/dir" })  // → teste com fixture
 *
 * Exit codes:
 *   (módulo — as funções devolvem listas vazias/levantam; quem decide o exit code
 *   é o `pr-fixers.mjs`, que transforma declaração inválida em problema e o
 *   `pr-remedy-comment.mjs`, que a transforma em exit 2)
 */

import { readdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

/** O diretório das declarações do canal — ao lado deste módulo. */
export const CANAL_DIR = join(dirname(fileURLToPath(import.meta.url)), "remedy-canal")

/** A extensão que uma declaração do canal tem (o id é o nome sem ela). */
export const SUFIXO = ".mjs"

/**
 * Os arquivos do canal, ordenados — ou `null` quando o diretório não pôde ser
 * LIDO. `null` e `[]` são coisas diferentes de propósito: lista vazia é uma
 * decisão (não há declaração), diretório ilegível é uma medição que não
 * aconteceu. Quem chama tem de dizer qual das duas é.
 *
 * @param {{dir?: string}} [opts]
 * @returns {string[]|null}
 */
export function arquivosDoCanal({ dir = CANAL_DIR } = {}) {
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith(SUFIXO))
      .sort()
  } catch {
    return null // NÃO é []: "não consegui ler" não é "nenhuma declaração"
  }
}

/**
 * Os IDs declarados no canal (o nome do arquivo sem a extensão) — a COBERTURA que
 * as pipelines têm de publicar. Diretório ilegível levanta: um guard que lesse
 * `[]` ali diria que o canal não cobre nada e ficaria verde.
 *
 * @param {{dir?: string}} [opts]
 * @returns {string[]}
 */
export function idsDoCanal({ dir = CANAL_DIR } = {}) {
  const arquivos = arquivosDoCanal({ dir })
  if (arquivos === null) {
    throw new Error(
      `remedy-canal: não consegui listar ${dir} — 'não consegui ler' não é 'nenhuma declaração'`,
    )
  }
  return arquivos.map((f) => f.slice(0, -SUFIXO.length))
}

/**
 * O caminho e a URL de importação da declaração de UM id. O `pathToFileURL`
 * existe porque o caminho relativo quebraria o `import()` dinâmico a partir de
 * outro diretório de trabalho.
 *
 * @param {string} id
 * @param {{dir?: string}} [opts]
 * @returns {{caminho: string, url: string, arquivo: string}}
 */
export function caminhoDaDeclaracao(id, { dir = CANAL_DIR } = {}) {
  const arquivo = `${id}${SUFIXO}`
  const caminho = join(dir, arquivo)
  return { caminho, url: pathToFileURL(caminho).href, arquivo }
}
