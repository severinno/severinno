/**
 * remedy-shell-guard.mjs
 *
 * A MAQUINARIA das classes de remédio cujo GUARD DONO é um script de shell
 * (`check-crlf.sh`, `check-blob-crlf.sh`, `check-utf8.sh`): rodar o guard dentro
 * do repositório sob remendo, ler a lista de ofensores que ELE declarou e aplicar
 * o `--fix` dele.
 *
 * POR QUE EXISTE (e por que não mora no `pre-commit-remedy.mjs`): a declaração de
 * uma classe é um módulo em `scripts/remedy-classes/`, e o remédio DESCOBRE as
 * declarações varrendo o diretório. Se a fábrica morasse no remédio, cada
 * declaração importaria o módulo que a importa — um ciclo no grafo do hook, onde
 * um erro de ordem de avaliação apareceria como "a classe não existe" justamente
 * na máquina de quem está commitando.
 *
 * O CONTRATO COM O GUARD DONO É O DELE, não uma régua nova: o remédio roda o
 * MESMO comando que o hook roda (com o argv que o guard declara) e lê o prefixo
 * que ELE imprime. Nenhum limiar, nenhum formato e nenhuma lista de arquivos é
 * reimplementada aqui — se o guard mudar o que imprime, o parse muda de
 * resultado e o teste da classe fica VERMELHO (é o que o pina), em vez de o
 * remédio estagiar o arquivo errado em silêncio.
 *
 * Usage:
 *   import { classeDeGuardDeShell } from "./remedy-shell-guard.mjs"
 *
 * Exit codes:
 *   (módulo — sem CLI próprio; ele devolve a classe, e quem tem exit code é o
 *   `pre-commit-remedy.mjs` que a consome)
 */

import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { join } from "node:path"

/**
 * Roda um comando no repositório sob remendo e devolve o exit code e a SAÍDA
 * (stdout+stderr juntos: é o que o operador veria, e é o que se exibe como
 * relatório da classe).
 *
 * @param {string} root
 * @param {string[]} argv
 * @returns {{status: number|null, output: string, erro: string|null}}
 */
export function rodar(root, argv) {
  const r = spawnSync(argv[0], argv.slice(1), {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
  if (r.error) return { status: null, output: "", erro: r.error.message }
  return { status: r.status, output: `${r.stdout ?? ""}${r.stderr ?? ""}`, erro: null }
}

/**
 * O guard DONO dentro do repositório sob remendo. SEM fallback de propósito: num
 * fixture onde o guard não existe a classe se declara NÃO APLICÁVEL — em vez de
 * rodar, por acidente, o guard do repositório de quem executa (que é outro repo,
 * e mediria outra árvore).
 *
 * @param {string} root
 * @param {string} script
 * @returns {string|null}
 */
export function guardDoRepo(root, script) {
  const p = join(root, "scripts", script)
  return existsSync(p) ? p : null
}

/**
 * As linhas de OFENSORES com o prefixo DECLARADO pelo guard (`  - ` nos guards de
 * CRLF; `  WOULD FIX: ` no de UTF-8). Cada classe tem teste que roda o guard REAL
 * sobre um fixture ofensor e PINA este parse: se o formato do guard mudar, o
 * teste fica vermelho em vez de o remédio estagiar o arquivo errado.
 *
 * @param {string} saida
 * @param {string} prefixo
 * @returns {string[]}
 */
export function ofensoresComPrefixo(saida, prefixo) {
  return String(saida ?? "")
    .split(/\r?\n/)
    .filter((l) => l.startsWith(prefixo))
    .map((l) => l.slice(prefixo.length).trim())
    .map((l) => l.replace(/\s+\(.*$/, ""))
    .filter((p) => p !== "")
}

/**
 * A CLASSE de remédio de um guard de SHELL, derivada do que ele declara.
 *
 * O que é DADO (e é o que uma classe nova precisa declarar): o id, a ordem na
 * oferta, o script dono, as frases do veredito, o argv da DETECÇÃO e o do FIXER,
 * o prefixo da lista de ofensores e como o remendo chega ao índice.
 *
 * O que NÃO é parâmetro, de propósito: a DETECÇÃO e a APLICAÇÃO. As duas são
 * sempre "rode o guard dono" — uma classe que medisse por conta própria seria uma
 * segunda régua, e a divergência apareceria como um remendo que o guard continua
 * acusando depois de aplicado.
 *
 * @param {{
 *   id: string,
 *   ordem: number,
 *   script: string,
 *   label: string,
 *   verde: string,
 *   vermelho: string,
 *   estagio: "add"|"renormalize"|"self",
 *   deteccao: string[],
 *   fixer: {argv: string[], comando: string},
 *   sugere: (paths: string[]) => string[],
 *   prefixo?: string,
 *   exigeDir?: string|null,
 *   naoRemendavel?: {regex: RegExp, motivo: (n: number) => string}|null,
 * }} spec
 * @returns {object} a classe (a mesma forma que o driver do remédio consome)
 */
export function classeDeGuardDeShell(spec) {
  const {
    id,
    ordem,
    script,
    label,
    verde,
    vermelho,
    estagio,
    deteccao,
    fixer,
    sugere,
    prefixo = "  - ",
    exigeDir = null,
    naoRemendavel = null,
  } = spec

  return {
    id,
    ordem,
    script,
    label,
    verde,
    vermelho,
    estagio,
    fixer: fixer.comando,
    sugere,
    aplicavel: (root) => {
      if (guardDoRepo(root, script) === null) {
        return `scripts/${script} não existe neste repositório`
      }
      if (exigeDir !== null && !existsSync(join(root, exigeDir))) {
        return `o diretório ${exigeDir}/ não existe neste repositório`
      }
      return null
    },
    detectar(root) {
      const r = rodar(root, ["bash", guardDoRepo(root, script), ...deteccao])
      if (r.erro !== null) return { indisponivel: `${script} não executou: ${r.erro}` }
      const offenders = ofensoresComPrefixo(r.output, prefixo)
      // O que o guard NOMEIA como não-remendável: é a metade honesta da classe —
      // sem ela, "nenhum ofensor" diria "nada a remendar" sobre uma violação que
      // o fixer não cobre (o byte inválido que não é o 0x97, no guard de UTF-8).
      const naoRemendaveis = naoRemendavel
        ? r.output.split(/\r?\n/).filter((l) => naoRemendavel.regex.test(l)).length
        : 0
      return {
        offenders,
        relatorio: r.output,
        violacoes: r.status === 0 ? 0 : 1,
        semRemendo:
          naoRemendavel && offenders.length === 0 && naoRemendaveis > 0
            ? naoRemendavel.motivo(naoRemendaveis)
            : null,
      }
    },
    aplicar(root) {
      const r = rodar(root, ["bash", guardDoRepo(root, script), ...fixer.argv])
      return { relatorio: r.output }
    },
  }
}
