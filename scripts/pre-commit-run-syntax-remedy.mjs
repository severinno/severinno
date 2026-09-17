#!/usr/bin/env node

// =============================================================================
// pre-commit-run-syntax-remedy.mjs
//
// O REMÉDIO do pre-commit: quando o recorte `--staged` do
// `check-workflow-run-syntax` reprova o commit, este script OFERECE o remendo da
// cicatriz MECÂNICA — com confirmação explícita — em vez de deixar o operador
// consertar à mão um defeito que o próprio repositório já sabe remendar.
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
//   1. PREVIEW com o MESMO caminho de decisão do fixer (`fixAll` com `dry`) —
//      não uma régua paralela que prometeria um remendo que a gravação
//      recusaria: nada é gravado neste passo;
//   2. se não há NADA remendável, ele NÃO pergunta (uma pergunta cuja resposta
//      não muda nada ensina o operador a responder sem ler) e sai vermelho com o
//      motivo da recusa por arquivo;
//   3. PERGUNTA, dizendo os três efeitos de um "sim": remenda a ÁRVORE,
//      re-estagia estes arquivos (`git add`) e revalida o recorte `--staged`;
//   4. aplica (`fixAll` real: re-lê e re-julga), re-estagia SOMENTE os arquivos
//      que já não tinham modificação não estagiada ANTES do remendo — num
//      arquivo com WIP, o `git add` levaria o WIP para dentro do commit, e isso
//      não é um remendo, é outra mudança;
//   5. REVALIDA rodando o guard DE VERDADE (`--staged`, em subprocesso): o
//      veredito final é o dele, com o relatório dele, e não uma segunda
//      implementação do veredito aqui.
//
// SEM TERMINAL NÃO HÁ PERGUNTA. O remédio NÃO lê de um stdin que não é um
// terminal: num hook, stdin pode ser um pipe (ou o terminal de outro processo) e
// um prompt ali ou trava o commit ou consome entrada que não é dele. Nesse caso
// ele imprime a lista e o CAMINHO À MÃO (o `--fix` + o `git add`) e mantém o
// commit bloqueado — fail-closed, dito.
//
// O QUE ELE NÃO PROMETE: o remendo tira a cicatriz que impedia o parsing; ele
// NÃO reconstrói a linha que a reescrita engoliu. O diff é o que se revisa — e a
// pergunta diz isso antes de o operador responder.
//
// Todo o relatório sai em STDERR: num hook não há stdout para consumir, e o
// canal do diagnóstico é o que o operador está olhando.
//
// Usage:
//   node scripts/pre-commit-run-syntax-remedy.mjs            # o remédio (interativo)
//   node scripts/pre-commit-run-syntax-remedy.mjs --root X   # outro repositório (testes)
//   node scripts/pre-commit-run-syntax-remedy.mjs -h         # esta ajuda
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

import { spawnSync } from "node:child_process"
import { existsSync, statSync } from "node:fs"
import { join, resolve } from "node:path"
import process from "node:process"
import { createInterface } from "node:readline"
import { fileURLToPath, pathToFileURL } from "node:url"

import { DEFAULT_BASH, EXIT, fixAll, runGit } from "./check-workflow-run-syntax.mjs"

export const USAGE = `pre-commit-run-syntax-remedy — oferece o remendo da cicatriz mecânica que
reprovou o commit, com confirmação explícita

Usage:
  node scripts/pre-commit-run-syntax-remedy.mjs            # o remédio (interativo)
  node scripts/pre-commit-run-syntax-remedy.mjs --root X   # outro repositório (testes)
  node scripts/pre-commit-run-syntax-remedy.mjs -h         # esta ajuda

A sequência (mostrada antes da pergunta):
  1. PREVIEW com o mesmo fixer do gate (nada gravado)
  2. sem cicatriz remendável: NÃO pergunta, sai vermelho com o motivo por arquivo
  3. pergunta, dizendo que o "sim" remenda a ÁRVORE, re-estagia e revalida o ÍNDICE
  4. aplica, re-estagia só o que não tinha WIP não estagiado, e REVALIDA rodando o
     guard de verdade (\\\`--staged\\\`) — o veredito final é o dele

Exit codes:
  0 — o commit pode continuar (remendo aplicado, re-estagiado, \\\`--staged\\\` verde)
  1 — o commit segue bloqueado (nada remendável, recusa, sem terminal, arquivo com
      WIP não re-estagiado, ou o \\\`--staged\\\` continua vermelho)
  2 — infra: git/índice indisponível, bash não executável, arquivo ilegível
  3 — uso inválido (\\\`--root\\\` sem valor, flag desconhecida)
`

/**
 * O caminho do GUARD que revalida o índice. Ele é resolvido pelo módulo (a
 * execução normal: o guard mora ao lado deste arquivo) e, quando o module URL
 * não é um `file:` — o caso de um runner de teste que reescreve `import.meta.url`
 * —, cai no `scripts/` do repositório de quem roda.
 *
 * @returns {string}
 */
export function guardPath() {
  try {
    const url = new URL("./check-workflow-run-syntax.mjs", import.meta.url)
    if (url.protocol === "file:") return fileURLToPath(url)
  } catch {
    // cai no cwd (abaixo)
  }
  return join(process.cwd(), "scripts", "check-workflow-run-syntax.mjs")
}

/** As respostas que valem "sim". O default é o NÃO — vazio não confirma nada. */
export const AFFIRMATIVE = /^(s|sim|y|yes)$/i

/**
 * @param {unknown} answer
 * @returns {boolean}
 */
export function isAffirmative(answer) {
  return AFFIRMATIVE.test(String(answer ?? "").trim())
}

/**
 * A pergunta no TERMINAL (`stderr`, onde o operador está olhando) e a resposta
 * lida do stdin. `terminal` acompanha o `isTTY` do fluxo: com um stdin que não é
 * terminal, o readline não entra em modo cru e não ecoa — e é por isso que o
 * caller decide se pergunta, em vez de o `ask` decidir por ele.
 *
 * O FIM DO STDIN (Ctrl-D, ou um stdin que fecha) resolve a promessa com a
 * resposta VAZIA — que é o NÃO. Sem isso o commit ficaria pendurado esperando uma
 * resposta que não vem, que é a pior forma de um hook falhar.
 *
 * @param {string} question
 * @param {{input?: NodeJS.ReadableStream, output?: NodeJS.WritableStream}} [deps]
 * @returns {Promise<string>}
 */
export function ask(question, { input = process.stdin, output = process.stderr } = {}) {
  return new Promise((resolveAnswer) => {
    let respondeu = false
    const rl = createInterface({ input, output, terminal: Boolean(input.isTTY) })
    rl.question(question, (answer) => {
      respondeu = true
      rl.close()
      resolveAnswer(String(answer).trim())
    })
    rl.on("close", () => {
      if (!respondeu) resolveAnswer("")
    })
  })
}

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

/**
 * O remédio em si. Devolve o resultado (o `main` o transforma em exit code), de
 * modo que os testes possam exercitar o caminho INTERATIVO — que um subprocesso
 * não alcança, porque ali o stdin nunca é um terminal.
 *
 * @param {string} root
 * @param {{bash?: string, isTTY?: boolean, askFn?: Function, log?: Function, write?: Function, rerun?: Function}} [deps]
 * @returns {Promise<{code: number, fixed: object[], refused: object[], restaged: string[],
 *   withheld: string[], answer: string|null}>}
 */
export async function remedy(root, deps = {}) {
  const {
    bash = DEFAULT_BASH,
    isTTY = Boolean(process.stdin.isTTY),
    askFn = null,
    log = (msg) => process.stderr.write(`${msg}\n`),
    write = (txt) => process.stderr.write(String(txt ?? "")),
    rerun = null,
  } = deps

  const preview = fixAll(root, { bash, staged: true, dry: true })
  if (preview.indisponivel) {
    log(
      `❌ ${preview.indisponivel}\n` +
        `   Sem interpretador não há parsing: nada foi previsto e nada foi remendado.`,
    )
    return {
      code: EXIT.UNAVAILABLE,
      fixed: [],
      refused: [],
      restaged: [],
      withheld: [],
      answer: null,
    }
  }
  if (preview.unread.length > 0) {
    log(`❌ arquivo(s) ILEGÍVEL(is) — não ler não é o mesmo que estar válido:`)
    for (const u of preview.unread) log(`     ${u.file}: ${u.detail}`)
    return {
      code: EXIT.UNAVAILABLE,
      fixed: [],
      refused: [],
      restaged: [],
      withheld: [],
      answer: null,
    }
  }

  // O ÍNDICE NÃO TEM VIOLAÇÃO: o remédio não tem o que remendar, e dizer "não
  // remendei" aqui seria mentir sobre o estado do commit (ele está verde).
  // Conta as TRÊS classes do gate — inclusive a que este fixer não remenda
  // (\`shell:\` que o runner não tem), senão um índice vermelho sairia como verde.
  const violacoes =
    preview.failures.length + preview.scriptFailures.length + preview.shellFailures.length
  if (violacoes === 0) {
    log(
      `✅ nada a remendar: o recorte \`--staged\` não tem violação — não há cicatriz neste commit.`,
    )
    return { code: EXIT.OK, fixed: [], refused: [], restaged: [], withheld: [], answer: null }
  }

  // Nada REMENDÁVEL: a pergunta não existiria (a resposta não muda nada) e o
  // commit segue bloqueado pelo motivo real, nomeado por arquivo.
  if (preview.fixed.length === 0) {
    log(
      `⛔ não há cicatriz MECÂNICA para remendar neste commit — o remédio não tocou em arquivo nenhum:`,
    )
    for (const f of preview.refused) {
      log(`   ⛔ ${f.line ? `${f.file}:${f.line}` : f.file} — ${f.reason}`)
    }
    for (const f of preview.shellFailures) {
      log(
        `   ⛔ ${f.file}:${f.line} — \`shell:\` que o runner NÃO tem (classe que não é de\n` +
          `      parsing e que este remendo não toca): ${f.error}`,
      )
    }
    log(
      `   A cicatriz que o remendo conhece é o OPERADOR PENDENTE no fim do corpo em bloco\n` +
        `   literal (\`run: |\`); a causa costuma estar a poucas linhas de onde o bash apontou.`,
    )
    return {
      code: EXIT.VIOLATIONS,
      fixed: [],
      refused: preview.refused,
      restaged: [],
      withheld: [],
      answer: null,
    }
  }

  const files = [...new Set(preview.fixed.map((f) => f.file))].sort()
  const sujoAntes = dirtyPaths(root)

  log(
    `⚠️  Este commit carrega ${preview.fixed.length} corpo(s) \`run:\` com a cicatriz MECÂNICA que o\n` +
      `    remendo do gate conhece (operador pendente no fim do corpo):`,
  )
  for (const f of preview.fixed) {
    log(`   ${f.file}:${f.line} — operador pendente \`${f.operador}\``)
    log(`     antes:  ${f.antes}`)
    log(`     depois: ${f.depois}`)
  }
  for (const f of preview.refused) {
    log(`   ⛔ ${f.line ? `${f.file}:${f.line}` : f.file} — NÃO remendável: ${f.reason}`)
  }

  // SEM TERMINAL: não há a quem perguntar. Perguntar mesmo assim (lendo de um
  // stdin que é pipe, ou do terminal de outro processo) travaria o commit ou
  // consumiria entrada que não é deste comando.
  if (!isTTY) {
    log(
      `\n❌ SEM TERMINAL: o remédio exige confirmação explícita, e aqui não há a quem perguntar.\n` +
        `   O commit segue BLOQUEADO. Para remendar e levar o remendo ao commit:\n` +
        `     node scripts/check-workflow-run-syntax.mjs --fix   # remenda a ÁRVORE — REVISE o diff\n` +
        `     git add ${files.join(" ")}\n` +
        `   (o \`--fix\` remenda a árvore; é o \`git add\` acima que leva o remendo ao COMMIT)`,
    )
    return {
      code: EXIT.VIOLATIONS,
      fixed: [],
      refused: preview.refused,
      restaged: [],
      withheld: [],
      answer: null,
    }
  }

  const answer = await (askFn ?? ((q) => ask(q)))(
    `\n   Aplicar AGORA? O "sim" faz as TRÊS coisas: remenda a ÁRVORE, re-estagia\n` +
      `   (git add) estes ${files.length} arquivo(s): ${files.join(", ")}\n` +
      `   e REVALIDA o recorte --staged antes de o commit seguir.\n` +
      `   O remendo tira a cicatriz que impedia o parsing; ele NÃO reconstrói a linha\n` +
      `   engolida — o diff é o que se revisa.\n` +
      `   Aplicar? [s/N] `,
  )
  if (!isAffirmative(answer)) {
    log(
      `   ⛔ recusado (resposta: "${String(answer).trim() === "" ? "<vazio>" : String(answer).trim()}") — NADA foi remendado.`,
    )
    return {
      code: EXIT.VIOLATIONS,
      fixed: [],
      refused: preview.refused,
      restaged: [],
      withheld: [],
      answer,
    }
  }

  // Aplica de verdade. O fixer RE-LÊ o arquivo e re-julga: um arquivo que mudou
  // entre o preview e a gravação recusa em vez de gravar na linha errada.
  const aplicado = fixAll(root, { bash, staged: true })
  const remendados = new Set(aplicado.fixed.map((f) => `${f.file}:${f.line}`))
  for (const f of preview.fixed) {
    if (!remendados.has(`${f.file}:${f.line}`)) {
      log(
        `   ⚠️  ${f.file}:${f.line} deixou de ser remendável entre a pergunta e a gravação — nada foi gravado nele.`,
      )
    }
  }
  for (const f of aplicado.fixed) {
    log(
      `✔ ${f.file}:${f.line} — remendo aplicado na ÁRVORE: operador pendente \`${f.operador}\` removido`,
    )
    log(`     antes:  ${f.antes}`)
    log(`     depois: ${f.depois}`)
  }

  const restaged = []
  const withheld = []
  for (const file of [...new Set(aplicado.fixed.map((f) => f.file))].sort()) {
    if (sujoAntes.has(file)) {
      withheld.push(file)
      continue
    }
    const r = runGit(root, ["add", "--", file])
    if (r.error || r.status !== 0) {
      withheld.push(file)
      log(
        `   ⛔ git add recusou ${file}: ${
          String(r.stderr ?? r.error?.message ?? "")
            .trim()
            .split("\n")[0]
        }`,
      )
      continue
    }
    restaged.push(file)
  }

  if (withheld.length > 0) {
    log(
      `\n   ⚠️  NÃO re-estagiado(s) — tinha modificação NÃO estagiada ANTES do remendo, e um \`git add\`\n` +
        `   aqui levaria junto trabalho que NÃO é deste commit:\n` +
        withheld.map((f) => `     ${f}`).join("\n") +
        `\n   O remendo está na ÁRVORE; revise o diff e estagie o que for deste commit.`,
    )
  }

  // O VEREDITO FINAL é do guard, rodado de verdade: o relatório e o exit code
  // são os do gate, não uma segunda implementação do veredito aqui.
  const guard = guardPath()
  const veredito = (
    rerun ??
    ((_root) =>
      spawnSync(process.execPath, [guard, "--staged"], {
        cwd: _root,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      }))
  )(root)
  write(veredito.stdout)
  write(veredito.stderr)
  const code = veredito.status ?? veredito.code ?? EXIT.UNAVAILABLE

  if (code === EXIT.OK) {
    log(
      `✅ remendo aplicado e re-estagiado (${restaged.join(", ")}) — o recorte \`--staged\` voltou a passar.\n` +
        `   O commit pode seguir. A cicatriz foi embora, mas o diff é o que se revisa.`,
    )
    return {
      code: EXIT.OK,
      fixed: aplicado.fixed,
      refused: aplicado.refused,
      restaged,
      withheld,
      answer,
    }
  }

  log(
    `❌ o recorte \`--staged\` CONTINUA vermelho depois do remendo (exit ${code}) — o commit segue bloqueado.`,
  )
  if (restaged.length === 0) {
    log(`   Nenhum arquivo foi re-estagiado: o defeito do ÍNDICE continua lá.`)
  }
  return { code, fixed: aplicado.fixed, refused: aplicado.refused, restaged, withheld, answer }
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
