#!/usr/bin/env node

// =============================================================================
// confirm-prompt.mjs
//
// A REGRA ÚNICA da PERGUNTA no terminal de controle: `Aplicar? [s/N]`, com o
// default NÃO, com teto de espera e com o caminho SEM TERMINAL declarado.
//
// POR QUE EXISTE (e por que não pode viver dentro de quem pergunta): duas
// ferramentas do repositório precisam da MESMA pergunta —
//
//   · `pre-commit-remedy.mjs` (o remédio do hook, que pergunta UMA vez por
//     todas as classes mecânicas do commit);
//   · `check-hook-commands.mjs --fix` (o remendo do caminho tipado num comando
//     de hook, que pergunta só o que ele remenda).
//
// Duas cópias divergiriam no dia em que uma delas passasse a aceitar "s" com
// espaços ou a abrir o `/dev/tty` de outro jeito — e o desfecho de uma pergunta
// divergente é o pior dos mundos: um hook que trava esperando uma resposta que
// ninguém sabe que está sendo pedida. O guard NÃO pode importar o remédio
// (o grafo do remédio é o do hook inteiro; o guard é chamado em fase paralela e
// no CI), então a régua mora aqui, embaixo dos dois.
//
// O QUE ELA NÃO DECIDE: QUANDO perguntar. Quem sabe se há operador é quem está
// rodando (o stdin do hook é `/dev/null` — o git entrega o fd 0 assim —, e por
// isso o terminal de CONTROLE é aberto explicitamente aqui, mas a decisão de
// chamar é do caller). Um `ask` que decidisse sozinho travaria o commit num
// fluxo onde ninguém está olhando.
//
// Usage:
//   import { ask, isAffirmative, openTerminal, OFFER_MARKER } from "./confirm-prompt.mjs"
//   const tty = openTerminal()
//   const resposta = await ask(`\n   ${OFFER_MARKER} `, { input: tty.input, output: tty.output, waitMs: TTY_WAIT_MS })
//
// Exit codes:
//   (módulo puro — não possui CLI nem exit code próprio; quem decide o exit é
//    quem pergunta, e cada um o faz na sua prosa)
// =============================================================================

import { closeSync, openSync } from "node:fs"
import process from "node:process"
import { createInterface } from "node:readline"
// O terminal de CONTROLE, aberto explicitamente: é dele que a resposta vem
// quando o stdin do hook não é um terminal (o caso medido do `git commit`).
import { ReadStream as TtyReadStream, WriteStream as TtyWriteStream } from "node:tty"

/**
 * O DESLIGAMENTO DECLARADO da pergunta. Existe para quem tem um terminal de
 * controle mas NÃO tem operador: um `git commit` dentro de um script, uma
 * esteira que aloca tty, um ensaio. Com a variável ligada quem pergunta não abre
 * o `/dev/tty` e cai no caminho à mão (fail-closed) — nunca num prompt que
 * ninguém vai responder. O valor vale como LIGADO só nas formas afirmativas
 * ditas abaixo: `=0`, `=false` e vazio são o default (a pergunta acontece onde
 * ela cabe).
 *
 * O NOME é o histórico (nasceu no remédio do pre-commit). Quem o lê hoje é a
 * pergunta COMPARTILHADA: um comando que passou a perguntar carrega junto o
 * desligamento que quem opera já conhece — em vez de inventar uma segunda
 * variável para desligar a mesma pergunta.
 */
export const NO_PROMPT_ENV = "PRE_COMMIT_REMEDY_NO_PROMPT"

/** As formas que valem como "ligado" em `NO_PROMPT_ENV`. */
const NO_PROMPT_ON = /^(1|true|yes|sim|on)$/i

/**
 * A pergunta está desligada por variável de ambiente?
 *
 * @param {Record<string, string|undefined>} [env]
 * @returns {boolean}
 */
export function noPromptEnv(env = process.env) {
  return NO_PROMPT_ON.test(String(env[NO_PROMPT_ENV] ?? "").trim())
}

/** As respostas que valem "sim". O default é o NÃO — vazio não confirma nada. */
export const AFFIRMATIVE = /^(s|sim|y|yes)$/i

/**
 * O FIM da pergunta — o texto que marca "há um prompt esperando resposta".
 *
 * Exportado de propósito: quem responde a pergunta POR FORA precisa saber QUANDO
 * ela apareceu. O ensaio sob um TERMINAL de verdade (`scripts/pty-harness.mjs`)
 * responde pelo mesmo terminal que o remédio está lendo, e um segundo literal do
 * fim da pergunta divergiria no dia em que ela fosse reescrita — o ensaio ficaria
 * esperando por um prompt que não existe mais (e o desfecho disso é um ensaio
 * que "não perguntou", não uma resposta errada).
 */
export const OFFER_MARKER = "Aplicar? [s/N]"

/**
 * O TERMINAL DE CONTROLE do processo. É daqui que a resposta vem quando o stdin
 * não é um terminal — o caso MEDIDO do `git commit`, em que o git entrega ao
 * hook o fd 0 em `/dev/null` e deixa os descritores 1 e 2 no terminal. Abrir
 * `/dev/tty` falha quando o processo não tem terminal de controle nenhum (CI,
 * `ssh` sem tty): é esse erro que separa "perguntar" de "não há a quem perguntar".
 */
export const TTY_DEVICE = "/dev/tty"

/**
 * O teto da espera pela RESPOSTA (`/dev/tty` não tem fim de arquivo como um
 * stdin fechado tem). Sem teto, um hook que pergunta a um terminal onde ninguém
 * está pendura o commit para sempre — a pior forma de um hook falhar. Estourou,
 * a resposta é o NÃO, dito.
 */
export const TTY_WAIT_MS = 120_000

/**
 * A resposta de um TETO estourado. É um sentinela, e não `""`, porque quem
 * CONTOU o que aconteceu foi quem esperou: o caller diz "sem resposta no teto" em
 * vez de chamar de recusa do operador uma resposta que ele nunca deu.
 */
export const TIMEOUT = Symbol("timeout")

/**
 * Abre o TERMINAL DE CONTROLE (`/dev/tty`) para leitura e escrita, ou devolve
 * `null` quando não há terminal nenhum — a resposta honesta de quem não pôde
 * abrir, e não um objeto que falharia na primeira pergunta.
 *
 * Os dois fluxos saem de `node:tty` de propósito: um `createReadStream` de
 * `/dev/tty` não é um TTY (não tem `isTTY`, não entra em modo cru) e o readline
 * trataría o terminal como um arquivo — o eco e a edição de linha seriam do
 * terminal, não do prompt.
 *
 * @returns {{input: NodeJS.ReadableStream, output: NodeJS.WritableStream}|null}
 */
export function openTerminal() {
  let fdIn = null
  let fdOut = null
  try {
    fdIn = openSync(TTY_DEVICE, "r")
    fdOut = openSync(TTY_DEVICE, "w")
  } catch {
    if (fdIn !== null) {
      try {
        closeSync(fdIn)
      } catch {
        // fechar o que não abriu não muda o veredito
      }
    }
    return null
  }
  return { input: new TtyReadStream(fdIn), output: new TtyWriteStream(fdOut) }
}

/**
 * A resposta vale "sim"?
 *
 * @param {unknown} answer
 * @returns {boolean}
 */
export function isAffirmative(answer) {
  return AFFIRMATIVE.test(String(answer ?? "").trim())
}

/**
 * A pergunta no TERMINAL (`stderr`, onde o operador está olhando) e a resposta
 * lida do `input`. `terminal` acompanha o `isTTY` do fluxo: com um stdin que não
 * é terminal, o readline não entra em modo cru e não ecoa — e é por isso que o
 * caller decide se pergunta, em vez de o `ask` decidir por ele.
 *
 * O FIM DO STDIN (Ctrl-D, ou um stdin que fecha) resolve a promessa com a
 * resposta VAZIA — que é o NÃO. Sem isso o commit ficaria pendurado esperando uma
 * resposta que não vem, que é a pior forma de um hook falhar.
 *
 * `waitMs > 0` é o TETO da espera, para os fluxos que não têm fim de arquivo (o
 * `/dev/tty` aberto): estourado, a promessa resolve com `TIMEOUT` — o caller
 * diz que o operador NÃO respondeu, em vez de chamar seu silêncio de recusa.
 *
 * @param {string} question
 * @param {{input?: NodeJS.ReadableStream, output?: NodeJS.WritableStream, waitMs?: number}} [deps]
 * @returns {Promise<string|symbol>}
 */
export function ask(question, { input = process.stdin, output = process.stderr, waitMs = 0 } = {}) {
  return new Promise((resolveAnswer) => {
    let respondeu = false
    let timer = null
    /** O fim da espera, por qualquer causa: resolve UMA vez. */
    const encerrar = (valor) => {
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
      if (respondeu) return
      respondeu = true
      rl.close()
      resolveAnswer(valor)
    }
    const rl = createInterface({ input, output, terminal: Boolean(input.isTTY) })
    rl.question(question, (answer) => encerrar(String(answer).trim()))
    rl.on("close", () => encerrar(""))
    if (waitMs > 0) timer = setTimeout(() => encerrar(TIMEOUT), waitMs)
  })
}
