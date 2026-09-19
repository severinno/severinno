#!/usr/bin/env node

// =============================================================================
// pre-commit-remedy.mjs
//
// O REMÉDIO do pre-commit: quando um gate do hook reprova o commit por um defeito
// que o PRÓPRIO guard já sabe consertar por máquina, este script OFERECE o remendo
// — com confirmação explícita, e numa pergunta só — em vez de deixar o operador
// consertar à mão um defeito que o repositório remenda sozinho.
//
// AS CLASSES: DERIVADAS, nunca uma lista à mão. Cada classe é declarada pelo
// GUARD DONO dela, num módulo de `scripts/remedy-classes/<id>.mjs`, e este script
// DESCOBRE a oferta varrendo aquele diretório (`remedy-classes.mjs`): um fixer
// novo entra na oferta no commit em que é declarado, sem ninguém editar ESTE
// arquivo. A validação da declaração é fail-closed — uma declaração inválida NÃO
// some da oferta em silêncio: ela RECUSA a rodada (exit 2) nomeando o arquivo e o
// que falta, porque um commit julgado por uma oferta incompleta ofereceria MENOS
// do que o repositório sabe remendar (e "nada a remendar" passaria a significar
// "nenhuma classe", não "nenhum defeito").
//
// A ajuda (`USAGE`) sai da MESMA oferta: uma lista escrita à mão aqui divergiria
// da que o remédio executa.
//
// Nenhuma régua é reimplementada aqui: a detecção e o remendo são SEMPRE o guard
// dono da classe, rodado como o hook o roda; este script só (a) pergunta, (b) leva
// o remendo ao ÍNDICE com a guarda de WIP e (c) REVALIDA com o guard dono — o
// veredito final nunca é uma segunda opinião daqui.
//
// POR QUE ISTO EXISTE (a distância entre o gate e o remédio)
//
// O repositório reescreve corpo de `run:` por MÁQUINA, e é daí que nasce a
// cicatriz: um OPERADOR PENDENTE no fim do corpo (`\`, `&&`, `||`, `|`, `<<`,
// `<<<`, `>`, `>>`, `<`) que a reescrita deixou. O gate (`--fix`, item 9 do
// `check-workflow-run-syntax`) JÁ SABE remendar essa classe e prova o remendo
// antes de gravá-lo. O que faltava era o caminho pelo qual o operador chega até
// ele NO MOMENTO em que o defeito aparece: sem isso, o hook reprovava o commit e
// a correção era manual — reescrever à mão exatamente a linha que o fixer
// remenda, com a chance de introduzir um erro NOVO na mesma linha.
//
// O QUE ELE FAZ (a sequência inteira, e ela é mostrada ANTES da pergunta)
//
//   1. DETECÇÃO por classe, com o guard dono, sem escrever nada: o relatório dele
//      vai para o terminal como está (não há régua paralela que prometeria um
//      remendo que a gravação recusaria);
//   2. se NENHUMA classe tem o que remendar, ele NÃO pergunta (uma pergunta cuja
//      resposta não muda nada ensina o operador a responder sem ler) e sai
//      vermelho com o motivo por classe e por arquivo;
//   3. PERGUNTA UMA VEZ, dizendo os efeitos de um "sim": remenda a ÁRVORE,
//      re-estagia os arquivos de cada classe e REVALIDA os escopos tocados;
//   4. aplica (o fixer de cada classe, o mesmo do guard) e re-estagia SOMENTE os
//      arquivos que já não tinham modificação não estagiada ANTES do remendo —
//      num arquivo com WIP, o `git add` levaria o WIP para dentro do commit, e
//      isso não é um remendo, é outra mudança. A classe que ESTAGIA POR CONTA
//      PRÓPRIA (blob-crlf, que roda `git add --renormalize`) fica retida quando
//      algum ofensor tem WIP ou não é deste commit: não há como separar o que
//      ela estagiaria;
//   5. REVALIDA cada classe tocada: a sintaxe pelo GATE DE VERDADE (`--staged`,
//      o mesmo comando do hook) e cada classe mecânica re-DETECTADA pelo guard
//      dono — o veredito é dele, com o relatório dele, e não uma segunda
//      implementação aqui. Quem decide se a FASE do hook passou é o HOOK,
//      rodando a fase outra vez depois de um remédio verde: o remédio LEVANTA a
//      falha que ele mediu, nunca declara verde uma fase com outro gate vermelho.
//
// DE ONDE A RESPOSTA VEM: do TERMINAL DE CONTROLE, nunca de um stdin que não é
// um terminal. O git invoca o hook com o fd 0 em `/dev/null` (os descritores 1 e 2
// são o terminal do operador) — então `process.stdin.isTTY` é FALSO justamente no
// fluxo que o operador mais usa, o `git commit`. Ler um stdin que não é um
// terminal travaria o commit ou consumiria entrada que não é deste comando; por
// isso, com o stdin não-terminal, este script abre o terminal EXPLICITAMENTE
// (`/dev/tty`, `openTerminal`) e pergunta ALI. É isso que faz a oferta interativa
// existir no fluxo real do operador, e não só quando ele chama o remédio direto.
//
// SEM TERMINAL NENHUM (CI, sessão sem terminal de controle, `ssh` sem tty): o
// `/dev/tty` não abre, o remédio NÃO pergunta, imprime a lista e o CAMINHO À MÃO
// (o `--fix` + o `git add`) e mantém o commit bloqueado — fail-closed, dito.
//
// A ESPERA PELA RESPOSTA É LIMITADA (`TTY_WAIT_MS`, 2 minutos) só quando ela vem
// do `/dev/tty`: um hook que pergunta a um terminal onde ninguém está não pode
// pendurar o commit para sempre. Sem resposta no teto, a resposta é o NÃO (o
// default), dito com todas as letras.
//
// A medição do fd 0 e do terminal de controle está em
// `src/lib/__tests__/pre-commit-remedy-pty.test.ts` (um pty de verdade, sem
// `isTTY` injetado — o dublê é o que mantinha esta distinção invisível), e o
// caminho SEM terminal nenhum é medido numa sessão sem tty de controle.
//
// O QUE ELE NÃO PROMETE: o remendo tira a cicatriz que impedia o parsing; ele
// NÃO reconstrói a linha que a reescrita engoliu. O diff é o que se revisa — e a
// pergunta diz isso antes de o operador responder.
//
// Todo o relatório sai em STDERR: num hook não há stdout para consumir, e o
// canal do diagnóstico é o que o operador está olhando.
//
// Usage:
//   node scripts/pre-commit-remedy.mjs            # o remédio (interativo)
//   node scripts/pre-commit-remedy.mjs --root X   # outro repositório (testes)
//   node scripts/pre-commit-remedy.mjs -h         # esta ajuda
//
// Exit codes:
//   0 — o commit pode continuar: o remendo foi aplicado, re-estagiado e o
//       recorte `--staged` revalidou SEM violação
//   1 — o commit segue BLOQUEADO: não havia cicatriz remendável (com o motivo por
//       arquivo), ou o terminal recusou, ou não há terminal, ou algum arquivo não
//       pôde ser re-estagiado com segurança, ou o `--staged` continua vermelho
//   2 — infra: git/índice indisponível, `bash` não executável, ou um arquivo
//       ilegível (sem medição não há veredito — nunca "0 violações" por não ter
//       conseguido medir)
//   3 — uso inválido (`--root` sem valor, flag desconhecida)
// =============================================================================

import { existsSync, statSync } from "node:fs"
import { join, resolve } from "node:path"
import process from "node:process"
import { fileURLToPath, pathToFileURL } from "node:url"

import { DEFAULT_BASH, EXIT, runGit } from "./check-workflow-run-syntax.mjs"
// A OFERTA das classes vem da DESCOBERTA (`remedy-classes.mjs`), que varre
// `scripts/remedy-classes/`: cada classe é declarada pelo GUARD DONO dela, num
// módulo ao lado do `--fix` que ele já tem. As RÉGUAS (o `fixAll` do gate de
// sintaxe, o plano do guard dos comandos) são importadas NAS DECLARAÇÕES —
// nenhuma delas mora mais aqui, e é isso que faz um fixer novo entrar na oferta
// sem que ninguém edite este arquivo.
import { CLASSES, CLASSES_PROBLEMAS } from "./remedy-classes.mjs"
// O `rodar` (um comando no repositório sob remendo) tem UM dono — o módulo das
// classes cujo guard dono é um script de shell, que o usa para DETECTAR e
// APLICAR. O driver usa o mesmo nas duas revalidações (a do gate e a da
// RELANCAMENTO, que roda a CLI): duas cópias divergiriam no dia em que uma
// tratasse o timeout como o `null` que a outra trata.
import { rodar } from "./remedy-shell-guard.mjs"
// A PERGUNTA (o terminal de CONTROLE, o default NÃO, o teto da espera e o
// desligamento declarado) tem UM dono: `confirm-prompt.mjs`. Ela saiu daqui
// porque o `check-hook-commands.mjs --fix` faz a MESMA pergunta — e o guard não
// pode importar este módulo (o grafo daqui é o do hook inteiro; o guard roda em
// fase paralela e no CI). Reexportada logo abaixo: é desta superfície que os
// testes e o ensaio sob terminal já importam, então o nome não muda e a régua
// passa a ter um dono só.
import {
  AFFIRMATIVE,
  NO_PROMPT_ENV,
  OFFER_MARKER,
  TIMEOUT,
  TTY_DEVICE,
  TTY_WAIT_MS,
  ask,
  isAffirmative,
  noPromptEnv,
  openTerminal,
} from "./confirm-prompt.mjs"

export {
  AFFIRMATIVE,
  NO_PROMPT_ENV,
  OFFER_MARKER,
  TIMEOUT,
  TTY_DEVICE,
  TTY_WAIT_MS,
  ask,
  isAffirmative,
  noPromptEnv,
  openTerminal,
}

// A OFERTA derivada (e os problemas da descoberta) atravessam este módulo: o
// hook, os testes e o ensaio sob terminal importam daqui, e é daqui que o
// `USAGE` lê o bloco de classes. Uma superfície só.
export { CLASSES, CLASSES_PROBLEMAS }

export const USAGE = `pre-commit-remedy — oferece, numa pergunta só, o remendo dos defeitos MECÂNICOS
que reprovaram o commit e que os próprios guards sabem consertar

Usage:
  node scripts/pre-commit-remedy.mjs            # o remédio (interativo)
  node scripts/pre-commit-remedy.mjs --root X   # outro repositório (testes)
  node scripts/pre-commit-remedy.mjs -h         # esta ajuda

As classes (e o fixer de cada uma — a régua é sempre o guard dono):
${blocoClasses()}

A sequência (mostrada antes da pergunta):
  1. DETECÇÃO por classe com o guard dono (nada gravado), com o relatório dele
  2. nada remendável em classe nenhuma: NÃO pergunta, sai vermelho com o motivo
  3. pergunta NO TERMINAL, dizendo que o "sim" remenda a ÁRVORE, re-estagia e
     revalida os ESCOPOS tocados — com o stdin não-terminal ela é feita pelo
     \\\`/dev/tty\\\` (o git entrega ao hook o fd 0 em \\\`/dev/null\\\`), e sem terminal
     nenhum o remédio não pergunta: caminho à mão, commit bloqueado
  4. aplica, re-estagia só o que não tinha WIP não estagiado, e REVALIDA rodando o
     comando que o HOOK executa — o veredito final é o dele
  5. RELANCAMENTO: a classe que grava em .husky/ remendou o arquivo que ESTA casca
     executa — o remendo fica na ARVORE e no INDICE e o commit desta rodada
     BLOQUEIA pedindo um git commit NOVO (o interpretador le o arquivo por
     deslocamento; a medicao esta no cabecalho de check-hook-commands.mjs)

Variáveis de ambiente:
  PRE_COMMIT_REMEDY_NO_PROMPT=1   DESLIGA a pergunta (quem tem terminal e não tem
                                  operador): caminho à mão, commit bloqueado

Exit codes:
  0 — o commit pode continuar (remendo aplicado, re-estagiado, escopos verdes)
  1 — o commit segue bloqueado (nada remendável, recusa, sem terminal, arquivo com
      WIP não re-estagiado, um escopo continua vermelho, ou o remendo reescreveu o
      arquivo que a casca executa — RE-RODE o commit)
  2 — infra: git/índice indisponível, bash não executável, arquivo ilegível, ou um
      guard que não pôde ser medido
  3 — uso inválido (\\\`--root\\\` sem valor, flag desconhecida)
`

// O DESLIGAMENTO da pergunta (`NO_PROMPT_ENV`) e a sua leitura (`noPromptEnv`)
// vêm do `confirm-prompt.mjs`, importados e reexportados no topo: um comando que
// passou a PERGUNTAR carrega junto o desligamento que quem opera já conhece.

/**
 * O caminho do GUARD que revalida o índice. Ele é resolvido pelo módulo (a
 * execução normal: o guard mora ao lado deste arquivo) e, quando o module URL
 * não é um `file:` — o caso de um runner de teste que reescreve `import.meta.url`
 * —, cai no `scripts/` do repositório de quem roda.
 *
 * @returns {string}
 */
export function guardPath(root = process.cwd()) {
  // O do REPOSITÓRIO SOB REMENDO vem primeiro: é o guard que o hook executa lá, e
  // é o que o fixture copia para o `scripts/` dele.
  const doRepo = join(root, "scripts", "check-workflow-run-syntax.mjs")
  if (existsSync(doRepo)) return doRepo
  try {
    const url = new URL("./check-workflow-run-syntax.mjs", import.meta.url)
    if (url.protocol === "file:") return fileURLToPath(url)
  } catch {
    // cai no cwd (abaixo)
  }
  return join(process.cwd(), "scripts", "check-workflow-run-syntax.mjs")
}

// ---------------------------------------------------------------------------
// A PERGUNTA saiu daqui: `AFFIRMATIVE`, `OFFER_MARKER`, `TTY_DEVICE`,
// `TTY_WAIT_MS`, `TIMEOUT`, `openTerminal`, `isAffirmative` e `ask` moram em
// `confirm-prompt.mjs` (importados e reexportados no topo). O motivo está lá: o
// `check-hook-commands.mjs --fix` faz a MESMA pergunta, e duas cópias da régua
// divergiriam no dia em que uma delas mudasse — num lugar onde o desfecho é um
// hook esperando resposta que ninguém sabe que foi pedida.
// ---------------------------------------------------------------------------

/**
 * Os caminhos com modificação NÃO ESTAGIADA (árvore ≠ índice). É o conjunto que
 * diz se um `git add` depois do remendo levaria junto trabalho que NÃO é deste
 * commit.
 *
 * LANÇA quando o git não responde — o caller transforma em exit 2. Um conjunto
 * vazio por não ter conseguido ler seria a pior das respostas: ele autorizaria o
 * `git add` que o conjunto existia para impedir.
 *
 * @param {string} root
 * @returns {Set<string>}
 */
export function dirtyPaths(root) {
  const r = runGit(root, ["diff", "--name-only"])
  if (r.error || r.status !== 0) {
    throw new Error(`git diff indisponível (${r.error?.message ?? String(r.stderr ?? "").trim()})`)
  }
  return new Set(
    String(r.stdout ?? "")
      .split(/\r?\n/)
      .filter((p) => p !== ""),
  )
}

// ── AS CLASSES DE REMÉDIO: DESCOBERTAS, NÃO DECLARADAS AQUI ────────────────
//
// Cada classe declara QUEM a detecta (o guard DONO, do jeito que o hook o roda),
// QUEM a remenda (o `--fix` do MESMO guard), COMO o remendo chega ao ÍNDICE e o
// comando à mão — mas a declaração mora em `scripts/remedy-classes/<id>.mjs`, ao
// lado do guard dono, e chega aqui inteira pela DESCOBERTA (`CLASSES`). Duas
// consequências disso são deliberadas: um fixer novo entra na oferta SEM editar
// este arquivo, e a lista que a ajuda mostra é a MESMA que o remédio executa.
//
// O CONTRATO QUE O DRIVER ESPERA de uma classe (validado na descoberta):
//
//   detectar(root, ctx) → {offenders, relatorio, semRemendo?, indisponivel?}
//     `offenders`   os arquivos que o fixer remenda (a lista do guard dono)
//     `relatorio`   o que se mostra ANTES da pergunta (o texto do guard dono)
//     `semRemendo`  há violação mas NENHUMA remendável — o motivo, por arquivo
//     `indisponivel` o guard não pôde ser medido (infra: sem medição, sem remédio)
//   aplicar(root, ctx)  → {relatorio, detalhe}
//   estagio             como o remendo chega ao ÍNDICE: `add`, `renormalize` ou
//                       `self` (o fixer estagia por conta própria — e aí a classe
//                       fica RETIDA quando algum ofensor tem WIP ou não é deste
//                       commit, porque não há como separar o que ela estagiaria)
//   verde/vermelho      a frase da REVALIDAÇÃO (a
//                       re-detecção: `detectar` tem de voltar com zero violações)
//
// A revalidação é a MESMA detecção rodada de novo — a régua continua sendo a do
// guard dono, nunca uma segunda opinião daqui. E quem decide se a FASE do hook
// passou é o hook, rodando a fase outra vez depois de um remédio verde
// (`.husky/pre-commit`): o remédio pode LEVANTAR a falha que ele mediu, jamais
// declarar verde uma fase que tem outro gate vermelho.

/** O rótulo da classe, para as mensagens (id + o que ele remenda). */
const rotulo = (classe) => `\`${classe.id}\` — ${classe.label}`

/**
 * O BLOCO DE CLASSES DA AJUDA, derivado da MESMA oferta que o remédio executa.
 * Era escrito à mão aqui, e a divergência não tinha como aparecer: um fixer novo
 * entrava na oferta e ficava FORA da ajuda (ou, pior, a ajuda nomeava um fixer que
 * já não existia). A documentação da oferta é parte da oferta.
 *
 * @param {object[]} classes
 * @returns {string}
 */
export function blocoClasses(classes = CLASSES) {
  // A largura da coluna é a do MAIOR id da oferta, não um literal: um id mais
  // longo que o do momento (a sexta classe trouxe `pipefail-sigpipe`) empurrava o
  // rótulo para fora da coluna e a ajuda saía desalinhada justamente ao documentar
  // uma classe nova — a documentação da oferta é parte da oferta.
  const largura = Math.max(...classes.map((c) => c.id.length), 0)
  const seta = `  ${" ".repeat(largura)} → `
  return classes
    .map((c) => `  ${c.id.padEnd(largura)}  ${c.label}\n${seta}\`${c.fixer}\``)
    .join("\n")
}

/**
 * A RECUSA por OFERTA INCOMPLETA — `null` quando a oferta está inteira.
 *
 * Uma declaração inválida NÃO é "uma classe a menos" em silêncio: sem a classe, o
 * remédio diria "não há remendo para este defeito" sobre um defeito que o
 * repositório SABE remendar (só não conseguiu declarar). Por isso o driver RECUSA
 * a rodada (exit 2), nomeando o arquivo e o que falta.
 *
 * @param {object[]} classes
 * @param {string[]} problemas
 * @returns {string|null}
 */
export function recusaDaOferta(classes = CLASSES, problemas = CLASSES_PROBLEMAS) {
  if (problemas.length === 0 && classes.length > 0) return null
  const linhas = problemas.map((p) => `     ${p}`).join("\n")
  if (classes.length === 0) {
    return (
      "   NENHUMA classe na oferta — o remédio não ofereceria remendo nenhum:\n" +
      (linhas || "     (scripts/remedy-classes/ não tem declaração nenhuma)")
    )
  }
  return `   declaração(ões) que NÃO entraram na oferta:\n${linhas}`
}

// A OFERTA vem da DESCOBERTA (importada no topo): este driver NÃO declara classe
// nenhuma. Uma declaração nova é um módulo em `scripts/remedy-classes/` — e é isto
// que faz um fixer novo entrar na oferta sem edição manual.

/**
 * Os caminhos que o COMMIT carrega (o índice). É o que separa "remendo deste
 * commit" de "remendo de outro arquivo que o guard global também reprova".
 *
 * @param {string} root
 * @returns {Set<string>}
 */
function noIndice(root) {
  const r = runGit(root, ["diff", "--cached", "--name-only"])
  if (r.error || r.status !== 0) {
    throw new Error(`git diff --cached indisponível (${r.error?.message ?? r.stderr})`)
  }
  return new Set(
    String(r.stdout ?? "")
      .split(/\r?\n/)
      .filter((p) => p !== ""),
  )
}

/**
 * O remédio em si. Devolve o resultado (o `main` o transforma em exit code), de
 * modo que os testes possam exercitar o caminho INTERATIVO — que um subprocesso
 * não alcança, porque ali o stdin nunca é um terminal.
 *
 * @param {string} root
 * @param {{bash?: string, isTTY?: boolean, askFn?: Function, openTty?: Function,
 *   noPrompt?: boolean, ttyWaitMs?: number, log?: Function, write?: Function,
 *   rerun?: Function, classes?: object[]}} [deps]
 * @returns {Promise<{code: number, fixed: object[], refused: object[], restaged: string[],
 *   withheld: string[], answer: string|null, classes: object[], relancamento: string[]}>}
 */
export async function remedy(root, deps = {}) {
  const {
    bash = DEFAULT_BASH,
    isTTY = Boolean(process.stdin.isTTY),
    askFn = null,
    openTty = openTerminal,
    noPrompt = noPromptEnv(),
    ttyWaitMs = TTY_WAIT_MS,
    log = (msg) => process.stderr.write(`${msg}\n`),
    write = (txt) => process.stderr.write(String(txt ?? "")),
    rerun = null,
    classes = CLASSES,
  } = deps

  const vazio = {
    fixed: [],
    restaged: [],
    withheld: [],
    answer: null,
    classes: [],
    relancamento: [],
  }

  // A mesma guarda da CLI, para quem chama `remedy()` direto (testes e o ensaio
  // do terminal): uma oferta incompleta nunca é julgada como "nada a remendar".
  // Com `classes` INJETADA, a oferta é a de quem chamou — a guarda não se aplica.
  if (deps.classes === undefined) {
    const recusa = recusaDaOferta()
    if (recusa !== null) {
      log(`❌ oferta de classes INCOMPLETA — o commit NÃO foi julgado\n${recusa}\n`)
      return { code: EXIT.UNAVAILABLE, ...vazio }
    }
  }

  // ── 1. O PLANO: cada classe é DETECTADA com o guard dono, sem escrever nada ─
  const plano = []
  const bloqueios = []
  const naoAplicaveis = []
  // As RECUSAS do fixer (o que ele viu e não sabe remendar, com o motivo). São
  // devolvidas mesmo quando o remédio NÃO chega a aplicar nada: um consumidor do
  // resultado precisa distinguir "nada foi remendado porque a resposta foi não"
  // de "nada foi remendado porque não HÁ remendo para este defeito" — e o motivo
  // por arquivo é a única coisa que diz qual dos dois foi.
  const recusas = []
  for (const classe of classes) {
    const motivo = classe.aplicavel(root)
    if (motivo !== null) {
      naoAplicaveis.push({ classe, motivo })
      continue
    }
    const deteccao = classe.detectar(root, { bash })
    if (deteccao.indisponivel) {
      log(
        `❌ ${rotulo(classe)}: ${deteccao.indisponivel}\n` +
          `   Sem medição não há remédio: nada foi previsto e nada foi remendado.`,
      )
      return { code: EXIT.UNAVAILABLE, ...vazio, refused: recusas }
    }
    if (deteccao.recusas) recusas.push(...deteccao.recusas)
    if (deteccao.semRemendo) {
      // O rótulo da CLASSE entra na frente do motivo: com seis classes, "há uma
      // violação que não é remendável" sem dizer QUAL mecanismo a viu obrigaria o
      // operador a procurar no código de quem fala.
      log(`${rotulo(classe)}:\n${deteccao.semRemendo}`)
      bloqueios.push({ classe, motivo: deteccao.semRemendo })
      continue
    }
    if (deteccao.offenders.length === 0) {
      if (deteccao.violacoes > 0 && deteccao.relatorio) log(deteccao.relatorio)
      continue
    }
    plano.push({ classe, ...deteccao })
  }

  // NADA REMENDÁVEL EM CLASSE NENHUMA: a pergunta não existiria (a resposta não
  // muda nada) e dizer "não remendei" sobre um commit verde seria mentir sobre o
  // estado dele.
  if (plano.length === 0) {
    if (bloqueios.length > 0) {
      log(
        `\n   O commit segue BLOQUEADO: há violação que este remédio NÃO remenda (as classes acima dizem\n` +
          `   o motivo, arquivo por arquivo) — a pergunta não existiria: a resposta não mudaria nada.`,
      )
      return { code: EXIT.VIOLATIONS, ...vazio, refused: recusas }
    }
    log(`✅ nada a remendar: nenhum dos gates tem defeito MECÂNICO neste commit.`)
    for (const n of naoAplicaveis) log(`   · ${rotulo(n.classe)}: ${n.motivo}`)
    return { code: EXIT.OK, ...vazio, refused: recusas }
  }

  const sujoAntes = dirtyPaths(root)
  const indice = noIndice(root)

  // O retido da classe que estagia por conta própria: se algum ofensor tem WIP ou
  // não é deste commit, o `git add` dela levaria junto o que não é do remendo.
  const aplicaveis = []
  for (const item of plano) {
    if (item.classe.estagio === "self") {
      const sujos = item.offenders.filter((p) => sujoAntes.has(p))
      const fora = item.offenders.filter((p) => !indice.has(p))
      if (sujos.length > 0 || fora.length > 0) {
        const motivo =
          `a classe ESTAGIA POR CONTA PRÓPRIA (${item.classe.fixer}) e ` +
          (sujos.length > 0
            ? `${sujos.length} ofensor(es) tem modificação NÃO estagiada (WIP)`
            : `${fora.length} ofensor(es) NÃO é(são) deste commit`) +
          ` — o \`git add\` dela levaria junto o que não é do remendo; à mão:\n` +
          item.classe
            .sugere(item.offenders)
            .map((l) => `     ${l}`)
            .join("\n")
        log(`   ⛔ ${rotulo(item.classe)}: ${motivo}`)
        bloqueios.push({ classe: item.classe, motivo })
        continue
      }
    }
    aplicaveis.push(item)
  }

  if (aplicaveis.length === 0) {
    log(
      `\n   O commit segue BLOQUEADO: o remendo não pôde ser aplicado sem levar junto o que não é dele.`,
    )
    return { code: EXIT.VIOLATIONS, ...vazio, refused: recusas }
  }

  log(`\n⚠️  Este commit carrega defeito(s) MECÂNICO(s) que o remédio conhece:`)
  for (const item of aplicaveis) {
    log(`\n   ${rotulo(item.classe)} — ${item.offenders.length} arquivo(s):`)
    if (item.relatorio) log(item.relatorio)
  }
  for (const n of naoAplicaveis) log(`   · ${rotulo(n.classe)}: ${n.motivo}`)
  for (const b of bloqueios) log(`   ⛔ ${rotulo(b.classe)}: ${b.motivo}`)

  // DE ONDE A RESPOSTA VEM. O stdin do hook NÃO é um terminal — medido: o git o
  // liga em `/dev/null`, com 1 e 2 no terminal do operador —, então esperar por
  // um `isTTY` verdadeiro deixava a oferta interativa morta justamente no fluxo
  // real. Com o stdin não-terminal (e sem um `askFn` injetado por um teste), o
  // TERMINAL DE CONTROLE é aberto explicitamente e a pergunta é feita ALI.
  const tty = !isTTY && askFn === null && !noPrompt ? openTty() : null

  // SEM TERMINAL: não há a quem perguntar. Perguntar mesmo assim (lendo de um
  // stdin que é pipe, ou do terminal de outro processo) travaria o commit ou
  // consumiria entrada que não é deste comando.
  /**
   * O CAMINHO À MÃO de cada classe do plano: o `--fix` do guard dono e o `git add`
   * que leva o remendo ao COMMIT — os dois, porque um sem o outro não desbloqueia
   * nada. É o que o operador recebe quando não há a quem perguntar.
   */
  const caminhoAMao = (itens) =>
    itens
      .map(
        (i) =>
          `   · ${rotulo(i.classe)}:\n` +
          i.classe
            .sugere(i.offenders)
            .map((l) => `     ${l}`)
            .join("\n"),
      )
      .join("\n")

  if (!isTTY && askFn === null && tty === null) {
    log(
      `\n❌ SEM TERMINAL: o remédio exige confirmação explícita, e aqui não há a quem perguntar\n` +
        (noPrompt
          ? `   (a pergunta está DESLIGADA por ${NO_PROMPT_ENV})\n`
          : `   (${TTY_DEVICE} não abriu: esta sessão não tem terminal de controle).\n`) +
        `   O commit segue BLOQUEADO. Para remendar e levar o remendo ao commit:\n` +
        caminhoAMao(aplicaveis) +
        `\n   (o \`--fix\` remenda a árvore; é o \`git add\` acima que leva o remendo ao COMMIT)`,
    )
    return { code: EXIT.VIOLATIONS, ...vazio, refused: recusas }
  }

  const temRunSyntax = aplicaveis.some((i) => i.classe.id === "run-syntax")
  const alvo = { input: tty?.input ?? process.stdin, output: tty?.output ?? process.stderr }
  const answer = await (
    askFn ?? ((q) => ask(q, { ...alvo, waitMs: tty === null ? 0 : ttyWaitMs }))
  )(
    `\n   Aplicar AGORA? O "sim" faz as TRÊS coisas: remenda a ÁRVORE, re-estagia\n` +
      `   (git add) e REVALIDA os escopos tocados antes de o commit seguir:\n` +
      aplicaveis
        .map((i) => `   · ${rotulo(i.classe)} — ${i.offenders.length} arquivo(s)`)
        .join("\n") +
      (temRunSyntax
        ? `\n   O remendo tira a cicatriz que impedia o parsing; ele NÃO reconstrói a linha\n` +
          `   engolida — o diff é o que se revisa.\n`
        : `\n   O remendo troca EOL/byte inválido — o diff é o que se revisa.\n`) +
      `   ${OFFER_MARKER} `,
  )
  if (tty !== null) {
    tty.input.destroy()
    tty.output.destroy()
  }
  if (answer === TIMEOUT) {
    log(
      `   ⏱  SEM RESPOSTA em ${Math.round(ttyWaitMs / 1000)}s — o remédio assume NÃO (o default).\n` +
        `   NADA foi remendado. O commit segue BLOQUEADO; o caminho à mão:\n` +
        caminhoAMao(aplicaveis),
    )
    return { code: EXIT.VIOLATIONS, ...vazio, refused: recusas }
  }
  if (!isAffirmative(answer)) {
    log(
      `   ⛔ recusado (resposta: "${String(answer).trim() === "" ? "<vazio>" : String(answer).trim()}") — NADA foi remendado.`,
    )
    return { code: EXIT.VIOLATIONS, ...vazio, refused: recusas, answer }
  }

  // ── 3. APLICAÇÃO: o fixer de cada classe, e o remendo ao ÍNDICE ─────────
  const restaged = []
  const withheld = []
  const porClasse = []
  const agregado = { fixed: [], refused: [] }

  for (const item of aplicaveis) {
    const r = item.classe.aplicar(root, { bash })
    if (r.relatorio) log(r.relatorio)
    if (r.detalhe?.fixed) agregado.fixed.push(...r.detalhe.fixed)
    if (r.detalhe?.refused) agregado.refused.push(...r.detalhe.refused)

    const sujosAgora = dirtyPaths(root)
    // Os arquivos que o fixer ESCREVEU: não estavam sujos antes e estão agora. É
    // o que separa "o fixer remendou" de "o fixer disse que remendou".
    const escritos = item.offenders.filter((p) => !sujoAntes.has(p) && sujosAgora.has(p))
    const comWip = item.offenders.filter((p) => sujoAntes.has(p))
    const foraDoCommit = item.offenders.filter((p) => !indice.has(p))
    // Quem uma classe ANTERIOR já levou ao índice não é "não escrito por esta":
    // as classes se sobrepõem por construção (o CR do working tree quebra também
    // o blob do índice) e a primeira que remenda deixa o arquivo LIMPO — um
    // filtro que só olhasse "sujo agora" acusaria de retido o arquivo que JÁ está
    // no commit, com o operador estagiando de novo o que já estava estagiado.
    const jaNoIndice = new Set(restaged)
    const naoEscritos = item.offenders.filter(
      (p) => !escritos.includes(p) && !comWip.includes(p) && !jaNoIndice.has(p),
    )

    const estagiadosAqui = []
    if (item.classe.estagio !== "self") {
      const args = item.classe.estagio === "renormalize" ? ["add", "--renormalize"] : ["add"]
      for (const file of escritos) {
        if (foraDoCommit.includes(file)) continue
        const g = runGit(root, [...args, "--", file])
        if (g.error || g.status !== 0) {
          withheld.push(file)
          log(
            `   ⛔ git ${args.join(" ")} recusou ${file}: ${
              String(g.stderr ?? g.error?.message ?? "")
                .trim()
                .split("\n")[0]
            }`,
          )
          continue
        }
        restaged.push(file)
        estagiadosAqui.push(file)
      }
    } else {
      // O fixer estagia por conta própria: o que ele estagiou É o remendo (a
      // classe já se retirou quando algum ofensor tinha WIP ou não era do commit).
      // No AGREGADO o arquivo entra uma vez só; por classe, ele aparece em todas
      // que o remendaram — é o que o resumo precisa dizer.
      restaged.push(...item.offenders.filter((p) => !restaged.includes(p)))
      estagiadosAqui.push(...item.offenders)
    }
    for (const file of [...comWip, ...foraDoCommit, ...naoEscritos]) {
      if (!withheld.includes(file)) withheld.push(file)
    }

    porClasse.push({
      id: item.classe.id,
      offenders: item.offenders,
      restaged: estagiadosAqui,
      withheld: [...new Set([...comWip, ...foraDoCommit, ...naoEscritos])],
    })
  }

  if (withheld.length > 0) {
    log(
      `\n   ⚠️  NÃO re-estagiado(s): ${withheld.join(", ")}\n` +
        `   Ou tinha modificação NÃO estagiada ANTES do remendo (um \`git add\` aqui levaria junto\n` +
        `   trabalho que NÃO é deste commit), ou o arquivo não é deste commit, ou o fixer não o\n` +
        `   remendou. O remendo está na ÁRVORE; revise o diff e estagie o que for deste commit.`,
    )
  }

  // ── 4. REVALIDAÇÃO: a MESMA detecção, rodada de novo ────────────────
  // A régua continua sendo a do guard dono (a classe RE-DETECTA com ele), e o
  // veredito é dele — não uma segunda opinião daqui. Um guard que não pôde ser
  // medido de novo é `unavailable`: sem veredito não há remédio.
  const revalidacoes = []
  for (const item of aplicaveis) {
    const sintaxe = item.classe.id === "run-syntax"
    if (sintaxe) {
      // O veredito da sintaxe é do GATE RODADO DE VERDADE (o mesmo `--staged` do
      // hook), com o relatório dele — não a re-detecção in-process. `rerun` é o
      // dublê declarado desse passo (o único jeito de exercitar "o índice continua
      // vermelho" com o remendo já aplicado).
      const v =
        rerun !== null ? rerun(root) : rodar(root, [process.execPath, guardPath(root), "--staged"])
      const status = v.status ?? v.code ?? EXIT.UNAVAILABLE
      write(v.output ?? `${v.stdout ?? ""}${v.stderr ?? ""}`)
      revalidacoes.push({ id: item.classe.id, status, restante: null })
      log(
        status === EXIT.OK
          ? `✅ ${rotulo(item.classe)}: ${item.classe.verde}.`
          : `❌ ${rotulo(item.classe)}: ${item.classe.vermelho} depois do remendo (exit ${status}).`,
      )
      continue
    }
    // As demais classes RE-DETECTAM com o guard dono (é a régua delas, a mesma da
    // detecção): zero violações = verde, e o que sobrar sai nomeado.
    const re = item.classe.detectar(root, { bash })
    if (re.indisponivel) {
      log(`❌ ${rotulo(item.classe)}: ${re.indisponivel} (na revalidação)`)
      return { code: EXIT.UNAVAILABLE, ...agregado, restaged, withheld, answer, classes: porClasse }
    }
    const verde = re.violacoes === 0
    revalidacoes.push({
      id: item.classe.id,
      status: verde ? EXIT.OK : EXIT.VIOLATIONS,
      restante: re.offenders,
    })
    log(
      verde
        ? `✅ ${rotulo(item.classe)}: ${item.classe.verde}.`
        : `❌ ${rotulo(item.classe)}: ${item.classe.vermelho} depois do remendo ` +
            `(${re.offenders.length} arquivo(s) ainda: ${re.offenders.join(", ")}).`,
    )
    if (!verde && re.relatorio) write(re.relatorio)
  }

  // ── 5. O RELANÇAMENTO: o remendo reescreveu o arquivo que a casca EXECUTA ──
  //
  // Uma classe pode gravar num arquivo que o PRÓPRIO hook está executando
  // (`exigeRelancamento`) — hoje sò a do caminho tipado, que mexe em `.husky/`.
  // MEDIDO (casca de 12.957 bytes reescrita no meio da própria execução, `sh -e`
  // como o husky usa): exit 127 com `B39: not found` numa linha POSTERIOR — o
  // interpretador lê o arquivo por DESLOCAMENTO, e mudar o tamanho desalinha o
  // que ele ainda vai ler. Sem a reescrita, o MESMO arquivo sai 0.
  //
  // Por isso o veredito desta rodada NÃO pode ser "o commit pode seguir", mesmo
  // com o guard verde na revalidação (ele RODOU num processo novo e leu o arquivo
  // inteiro): o que continua rodando é a casca antiga, com bytes fora de lugar.
  // O remendo está na ÁRVORE e no ÍNDICE — quem mede o commit corrigido é um
  // `git commit` NOVO. E continua fail-closed: esta rodada BLOQUEIA.
  const relancar = porClasse.filter(
    (c) =>
      aplicaveis.some((i) => i.classe.id === c.id && i.classe.exigeRelancamento === true) &&
      (c.restaged.length > 0 || c.withheld.length > 0),
  )

  const contribuintes = porClasse.map((c) => `${c.id}: ${c.restaged.join(", ") || "—"}`).join(" | ")
  const vermelho = revalidacoes.find((v) => v.status !== EXIT.OK)
  const code =
    bloqueios.length > 0 || relancar.length > 0 ? EXIT.VIOLATIONS : (vermelho?.status ?? EXIT.OK)

  if (code === EXIT.OK) {
    log(
      `✅ remendo aplicado e re-estagiado (${contribuintes}) — as classes tocadas revalidaram VERDE.\n` +
        `   O commit pode seguir. O diff é o que se revisa.`,
    )
  } else if (bloqueios.length > 0) {
    log(
      `❌ há violação que este remédio NÃO remenda (${bloqueios
        .map((b) => b.classe.id)
        .join(", ")}) — o commit segue BLOQUEADO.`,
    )
  } else if (relancar.length > 0) {
    log(
      `\n❌ RE-RODE o commit: ${relancar.map((c) => `\`${c.id}\``).join(", ")} remendou um arquivo que\n` +
        `   esta casca está EXECUTANDO (.husky/). O remendo JÁ está na ÁRVORE e no ÍNDICE, mas o\n` +
        `   interpretador lê o arquivo por DESLOCAMENTO: continuar daqui leria bytes fora de lugar\n` +
        `   (medido numa casca de 12.957 bytes: exit 127, "not found" numa linha POSTERIOR).\n` +
        `   Um \`git commit\` NOVO mede o hook corrigido — esta rodada BLOQUEIA de propósito.`,
    )
  } else if (restaged.length === 0) {
    log(`   Nenhum arquivo foi re-estagiado: o defeito do ÍNDICE continua lá.`)
  }

  return {
    code,
    ...agregado,
    restaged,
    withheld,
    answer,
    classes: porClasse,
    relancamento: relancar.map((c) => c.id),
  }
}

async function main() {
  const argv = process.argv.slice(2)
  const conhecidas = ["--root", "-h", "--help"]
  const desconhecida = argv.find((a) => a.startsWith("--") && !conhecidas.includes(a))
  if (desconhecida) {
    process.stderr.write(`❌ flag desconhecida: ${desconhecida}\n${USAGE}`)
    process.exit(EXIT.USAGE)
  }
  if (argv.includes("-h") || argv.includes("--help")) {
    process.stdout.write(USAGE)
    process.exit(EXIT.OK)
  }
  // OFERTA INCOMPLETA RECUSA A RODADA (fail-closed): sem esta guarda, o commit
  // seria julgado por um remédio que oferece MENOS do que o repositório sabe
  // remendar, e "nada a remendar" passaria a significar "nenhuma classe".
  const recusa = recusaDaOferta()
  if (recusa !== null) {
    process.stderr.write(`❌ oferta de classes INCOMPLETA — o commit NÃO foi julgado\n${recusa}\n`)
    process.exit(EXIT.UNAVAILABLE)
  }
  const i = argv.indexOf("--root")
  let root = process.cwd()
  if (i !== -1) {
    const v = argv[i + 1]
    if (v === undefined || v.startsWith("--")) {
      process.stderr.write(`❌ --root exige um valor\n${USAGE}`)
      process.exit(EXIT.USAGE)
    }
    root = resolve(v)
  }
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    process.stderr.write(`❌ --root inexistente: ${root}\n`)
    process.exit(EXIT.UNAVAILABLE)
  }
  try {
    const r = await remedy(root)
    process.exit(r.code)
  } catch (err) {
    process.stderr.write(`❌ remédio indisponível: ${err?.message ?? err}\n`)
    process.exit(EXIT.UNAVAILABLE)
  }
}

// True apenas quando executado diretamente — permite importar as funções puras
// nos testes (o caminho INTERATIVO, que um subprocesso não alcança).
const IS_DIRECT_RUN =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (IS_DIRECT_RUN) main()
