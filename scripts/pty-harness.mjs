/**
 * pty-harness.mjs
 *
 * A PORTA do harness de TERMINAL (`pty_answer.py`) para quem mede de dentro do
 * Node: resolve o python que tem o módulo `pty`, roda um comando com os três
 * descritores ligados a um terminal alocado de VERDADE e devolve os fatos do
 * ensaio (exit code, transcript, se a pergunta apareceu e se a resposta foi
 * enviada pelo terminal).
 *
 * POR QUE ELE EXISTE: o caminho INTERATIVO do remédio do pre-commit só pergunta
 * quando o stdin É um terminal. Num subprocesso comum o stdin é um pipe, então a
 * direção interativa ficava provada apenas por DUBLÊ (`isTTY` injetado) — um
 * dublê que afirma "é um terminal" prova a lógica, não o terminal: se o readline
 * não funcionasse sob um tty de verdade (eco, modo cru, fim de linha), o valor
 * injetado passaria por cima e a suíte ficaria verde. Com este harness a
 * pergunta é feita ao terminal e a resposta vai pelo MESMO terminal que o
 * comando está lendo — nada é injetado no processo.
 *
 * O MECANISMO fica no python (o `pty` é da libc; o Node não tem API de pty) e é
 * UMA cópia só: o módulo aqui resolve o interpretador, monta o argv e lê o
 * `--meta` — não reimplementa o loop do terminal.
 *
 * DISPONIBILIDADE É FATO DECLARADO, nunca um verde por omissão: sem um python
 * com `pty` (o caso do Windows) o ensaio devolve `available: false` com o MOTIVO
 * nomeado, e quem decide pular (ou falhar) é o consumidor — um harness que
 * "passa" sem ter alocado terminal nenhum seria a garantia decorativa que este
 * repositório recusa.
 *
 * Usage:
 *   import { ptyAvailability, ptyRun } from "./pty-harness.mjs"
 *
 *   const pty = ptyAvailability()
 *   pty.available   // false no Windows, com pty.reason nomeando o motivo
 *   const r = ptyRun({ command: ["git", "commit", "-m", "x"], cwd: dir,
 *                      expect: "Aplicar? [s/N]", answer: "s" })
 *   r.status        // o exit code DO COMANDO (o ensaio não tem veredito próprio)
 *   r.meta.sawExpect // a pergunta apareceu no terminal?
 *
 * Exit codes:
 *   (módulo — sem CLI próprio; o veredito deste módulo é o `status` do comando,
 *   propagado tal e qual, e o `available`/`reason` da disponibilidade)
 */

import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

/** O harness de terminal (python) — o MECANISMO, uma cópia só. */
export const PTY_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "pty_answer.py")

/** Os interpretadores tentados, em ordem. `PTY_PYTHON` sobrepõe (válvula da casa). */
export const PYTHON_CANDIDATES = ["python3", "python"]

/**
 * Os FATOS que o harness grava no `--meta`: o exit code do comando, se a
 * pergunta apareceu, se a resposta foi enviada e se ele foi morto no teto.
 *
 * @typedef {{
 *   status: number, signaled: number|null, saw_expect: boolean,
 *   answer_sent: boolean, timed_out: boolean, elapsed: number, bytes: number,
 *   command: string[],
 * }} PtyMeta
 */

/**
 * Há um interpretador com o módulo `pty`?
 *
 * O teste é o IMPORT (`-c "import pty"`), não a existência do binário: no Windows
 * o `python` do PATH pode ser o atalho da Microsoft Store (que imprime um convite
 * para instalar e sai com 9009) e um `python` sem `pty` não mede nada. Os dois
 * casos caem no MESMO desfecho: indisponível, com o motivo dito.
 *
 * @param {{env?: Record<string, string|undefined>}} [deps]
 * @returns {{available: boolean, command: string|null, reason: string}}
 */
export function ptyAvailability({ env = process.env } = {}) {
  const candidatos = [env.PTY_PYTHON, ...PYTHON_CANDIDATES].filter(
    (c) => typeof c === "string" && c !== "",
  )
  const tentativas = []
  for (const cmd of candidatos) {
    let res
    try {
      res = spawnSync(cmd, ["-c", "import pty"], { encoding: "utf8", timeout: 20_000 })
    } catch (error) {
      tentativas.push(`${cmd} (não executou: ${error?.code ?? error?.message})`)
      continue
    }
    const saida = `${res.stdout ?? ""}${res.stderr ?? ""}`
    if (res.status === 0) return { available: true, command: cmd, reason: "" }
    if (/Microsoft Store/i.test(saida)) {
      tentativas.push(`${cmd} (atalho da Microsoft Store, não é um interpretador)`)
      continue
    }
    tentativas.push(
      `${cmd} (${(saida.trim().split("\n")[0] || `exit ${res.status}`).slice(0, 120)})`,
    )
  }
  return {
    available: false,
    command: null,
    reason:
      `nenhum interpretador com o módulo \`pty\` (tentei ${tentativas.join(", ") || "nenhum"})` +
      " — o ensaio do caminho interativo exige um TERMINAL (o `pty` é POSIX; no" +
      " Windows não existe). O motivo é este, não um verde por omissão.",
  }
}

/**
 * Roda um comando sob um TERMINAL de verdade.
 *
 * `expect`/`answer`: quando os dois são passados, a resposta só é escrita DEPOIS
 * de o texto de `expect` aparecer na saída — é isso que prova que houve uma
 * PERGUNTA, e não que a resposta foi aceita por acaso (um comando que nem
 * pergunta consome o stdin e segue).
 *
 * @param {{
 *   command: string[], cwd?: string, env?: Record<string, string|undefined>,
 *   expect?: string|null, answer?: string|null, timeoutMs?: number,
 *   metaPath?: string|null, scriptPath?: string, python?: string|null,
 * }} opts
 * @returns {{
 *   available: boolean, reason: string, status: number|null, output: string,
 *   sawExpect: boolean, answerSent: boolean, timedOut: boolean,
 *   meta: PtyMeta|null, command: string[],
 * }}
 */
export function ptyRun({
  command,
  cwd = undefined,
  env = {},
  expect = null,
  answer = null,
  timeoutMs = 90_000,
  metaPath = null,
  scriptPath = PTY_SCRIPT,
  python = null,
} = {}) {
  const porta =
    python !== null ? { available: true, command: python, reason: "" } : ptyAvailability()
  const base = {
    available: porta.available,
    reason: porta.reason,
    status: null,
    output: "",
    sawExpect: false,
    answerSent: false,
    timedOut: false,
    meta: null,
    command,
  }
  if (!porta.available) return base
  if (!Array.isArray(command) || command.length === 0) {
    return { ...base, reason: "ptyRun exige um `command` não vazio" }
  }

  const dir = mkdtempSync(join(tmpdir(), "pty-meta-"))
  const meta = metaPath ?? join(dir, "meta.json")
  const argv = [scriptPath, "--timeout", String(timeoutMs / 1000), "--meta", meta]
  if (cwd !== undefined) argv.push("--cwd", cwd)
  for (const [nome, valor] of Object.entries(env)) {
    if (valor === undefined || valor === null) continue
    argv.push("--env", `${nome}=${valor}`)
  }
  if (expect !== null) argv.push("--expect", expect)
  if (answer !== null) argv.push("--answer", answer)
  argv.push("--", ...command)

  // stdin VAZIO (não herdado): o terminal do ensaio é o do FILHO, e nada do
  // processo de teste entra nele — a resposta vai pelo `--answer`, pelo pty.
  let res
  try {
    res = spawnSync(porta.command, argv, {
      encoding: "utf8",
      input: "",
      maxBuffer: 64 * 1024 * 1024,
      timeout: timeoutMs + 30_000,
    })
  } catch (error) {
    return { ...base, reason: `não executei o harness (${error?.code ?? error?.message})` }
  }

  let fatos = null
  try {
    fatos = JSON.parse(readFileSync(meta, "utf8"))
  } catch {
    fatos = null
  }
  if (metaPath === null) rmSync(dir, { recursive: true, force: true })

  return {
    ...base,
    status: res.status,
    output: `${res.stdout ?? ""}${res.stderr ?? ""}`,
    sawExpect: Boolean(fatos?.saw_expect),
    answerSent: Boolean(fatos?.answer_sent),
    timedOut: Boolean(fatos?.timed_out),
    meta: fatos,
    reason:
      fatos === null
        ? "o harness terminou sem gravar o `--meta` — o ensaio não pode ser afirmado sobre isso"
        : "",
  }
}
