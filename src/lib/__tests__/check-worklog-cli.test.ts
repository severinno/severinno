/**
 * check-worklog-cli.test.ts
 *
 * Testes CLI do guard scripts/check-worklog.mjs — integridade do worklog.md:
 * cada entrada de auditoria DEVE ter o formato mínimo (Task ID/Agent/Task/
 * Work Log) e os Task IDs DEVEM ser únicos.
 *
 * Contexto: o worklog é o registro de auditoria do repo; entradas sem o
 * mínimo (ou com IDs duplicados) quebram a rastreabilidade entre threads.
 *
 * Cobre:
 *   - fixture limpo (formato completo) → exit 0
 *   - entrada sem "Agent:" → exit 1 + entrada citada
 *   - entrada sem "Task:" → exit 1
 *   - entrada sem "Work Log:" → exit 1
 *   - Task ID duplicado → exit 1 + mensagem com as entradas
 *   - formato LEGADO "Stage:" (aceito como ID) + "Work Log (sufixo):" → exit 0
 *   - head do arquivo (prosa antes do 1º separador) isento → exit 0
 *   - funções puras: splitEntries respeita fences (``` não quebra entrada)
 */

import { describe, it, expect, afterEach } from "vitest"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import { splitEntries, checkWorklog, extractEntryHeaders } from "../../../scripts/check-worklog.mjs"

const GUARD = resolve(process.cwd(), "scripts/check-worklog.mjs")

const tmpDirs: string[] = []

/** Entrada completa no formato moderno. */
function fullEntry(id: string, body = "Work Log:\n\n- feito X.\n"): string {
  return `Task ID: ${id}\nAgent: buffy (test)\nTask: Testar o guard.\n\n${body}`
}

/** Cria um worklog em dir com o conteúdo dado; retorna o path do arquivo. */
function makeWorklog(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "check-worklog-"))
  tmpDirs.push(dir)
  writeFileSync(join(dir, "worklog.md"), content)
  return join(dir, "worklog.md")
}

function run(dir: string) {
  return spawnSync(process.execPath, [GUARD, "--root", dir], { encoding: "utf8" })
}

function outputOf(res: ReturnType<typeof run>): string {
  return `${res.stdout ?? ""}${res.stderr ?? ""}`
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe("check-worklog.mjs (CLI)", () => {
  it("exit 0 quando o worklog está íntegro (formato mínimo completo)", () => {
    const file = makeWorklog(
      `# Worklog\n\nIntro prosa.\n\n---\n\n${fullEntry("TASK-1")}\n\n---\n\n${fullEntry("TASK-2")}\n`,
    )
    const res = run(resolve(file, ".."))
    expect(res.status).toBe(0)
    expect(outputOf(res)).toContain("íntegro")
  })

  it("exit 1 e cita a entrada quando falta 'Agent:'", () => {
    const file = makeWorklog(
      `# Worklog\n\n---\n\nTask ID: TASK-1\nTask: Sem agent.\n\nWork Log:\n\n- feito.\n`,
    )
    const res = run(resolve(file, ".."))
    expect(res.status).toBe(1)
    expect(outputOf(res)).toContain("TASK-1")
    expect(outputOf(res)).toContain('sem "Agent:"')
  })

  it("exit 1 quando falta 'Task:'", () => {
    const file = makeWorklog(
      `# Worklog\n\n---\n\nTask ID: TASK-1\nAgent: buffy\n\nWork Log:\n\n- feito.\n`,
    )
    const res = run(resolve(file, ".."))
    expect(res.status).toBe(1)
    expect(outputOf(res)).toContain('sem "Task:"')
  })

  it("exit 1 quando falta 'Work Log:'", () => {
    const file = makeWorklog(
      `# Worklog\n\n---\n\nTask ID: TASK-1\nAgent: buffy\nTask: Sem work log.\n`,
    )
    const res = run(resolve(file, ".."))
    expect(res.status).toBe(1)
    expect(outputOf(res)).toContain('sem "Work Log:"')
  })

  it("exit 1 quando o Task ID é duplicado (cita as duas entradas)", () => {
    const file = makeWorklog(
      `# Worklog\n\n---\n\n${fullEntry("DUP")}\n\n---\n\n${fullEntry("DUP")}\n`,
    )
    const res = run(resolve(file, ".."))
    expect(res.status).toBe(1)
    expect(outputOf(res)).toContain("duplicado")
    expect(outputOf(res)).toContain("entradas 2 e 3")
  })

  it("exit 0 com formato LEGADO: 'Stage:' como ID + 'Work Log (sufixo):' aceitos", () => {
    const file = makeWorklog(
      `# Worklog\n\n---\n\nStage: LEGACY-1\nAgent: orchestrator\nTask: Entrada antiga.\n\nWork Log (evidência lida no código):\n\n- leitura de fontes.\n`,
    )
    const res = run(resolve(file, ".."))
    expect(res.status).toBe(0)
    expect(outputOf(res)).toContain("íntegro")
  })

  it("exit 0 com head do arquivo em prosa (antes do 1º separador) isento", () => {
    const file = makeWorklog(
      `# Severinno — Worklog\n\nProsa do head sem headers de entrada.\n\n---\n\n${fullEntry("TASK-1")}\n`,
    )
    const res = run(resolve(file, ".."))
    expect(res.status).toBe(0)
  })

  it("exit 1 quando uma entrada após o head não tem Task ID nem Stage", () => {
    const file = makeWorklog(
      `# Worklog\n\n---\n\nAgent: buffy\nTask: Sem ID.\n\nWork Log:\n\n- feito.\n`,
    )
    const res = run(resolve(file, ".."))
    expect(res.status).toBe(1)
    expect(outputOf(res)).toContain('sem "Task ID:"')
  })
})

describe("check-worklog.mjs (funções puras)", () => {
  it("splitEntries respeita fences — '---' dentro de ``` não quebra entrada", () => {
    const content = `# Worklog\n\n---\n\nTask ID: T-1\nAgent: a\nTask: t\n\nWork Log:\n\n\`\`\`\n---\nlinha dentro de fence\n\`\`\`\n\n---\n\nTask ID: T-2\nAgent: a\nTask: t\n\nWork Log:\n`
    const entries = splitEntries(content)
    // head + T-1 (com a fence inteira) + T-2
    expect(entries).toHaveLength(3)
    expect(entries[1]!).toContain("linha dentro de fence")
    expect(entries[2]!).toContain("Task ID: T-2")
  })

  it("extractEntryHeaders reconhece Task ID, Stage, Agent, Task e Work Log com sufixo", () => {
    const entry = `Stage: LEGACY\nAgent: a\nTask: t\n\nWork Log (evidência):\n\n- x.\n`
    const headers = extractEntryHeaders(entry)
    expect(headers.map((h) => h.type)).toEqual(["Stage", "Agent", "Task", "Work Log"])
  })

  it("checkWorklog sinaliza entrada vazia após separador (sem ID) como violação", () => {
    const content = `# Worklog\n\n---\n\n${fullEntry("T-1")}\n\n---\n\n   \n`
    const violations = checkWorklog(content)
    expect(violations.some((v) => v.type === "missing-task-id")).toBe(true)
  })
})
