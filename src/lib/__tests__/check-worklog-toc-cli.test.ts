/**
 * check-worklog-toc-cli.test.ts
 *
 * Testes CLI do guard scripts/check-worklog-toc.mjs — sincronia do índice
 * (TOC) do worklog.md: todo Task ID/Stage DEVE ter uma linha no índice com
 * âncora e resumo, e todo link do índice DEVE resolver para uma entrada real.
 *
 * Contexto: um worklog de 30+ entradas sem índice vira navegação manual;
 * uma entrada nova sem linha no TOC (ou um link stale apontando para uma
 * entrada que não existe mais) quebra a navegação rápida sem ninguém notar.
 *
 * Cobre:
 *   - fixture limpo (TOC sincronizado com âncoras) → exit 0
 *   - entrada sem linha no índice (reverse) → exit 1 + ID citado
 *   - link do índice sem âncora (forward) → exit 1 + slug citado
 *   - âncora com slug ≠ slugify(id) (anchor) → exit 1
 *   - linha stale do índice (sem entrada real) → exit 1
 *   - linha do índice sem resumo (empty-summary) → exit 1
 *   - entradas coladas sem separador '---' (glued) → exit 1
 *   - funções puras: extractEntries/extractTocRows respeitam fences, e
 *     extractTocRows ignora tabelas (linhas `|`) e para no 1º separador
 */

import { describe, it, expect, afterEach } from "vitest"
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import {
  extractEntries,
  extractTocRows,
  extractAnchors,
  checkWorklogToc,
  fenceAwareIdLines,
  ENTRY_ID_RE,
} from "../../../scripts/check-worklog-toc.mjs"
import { slugify } from "../../../scripts/check-readme-anchors.mjs"

const GUARD = resolve(process.cwd(), "scripts/check-worklog-toc.mjs")

const tmpDirs: string[] = []

/** Worklog com 1 entrada + TOC sincronizado (linha com âncora e resumo). */
function cleanWorklog(): string {
  return [
    "# Worklog",
    "",
    "## Índice de Task IDs",
    "",
    "- [TASK-1](#task-1) — Testar o guard de TOC.",
    "",
    "---",
    "",
    "Task ID: TASK-1",
    '<a id="task-1"></a>',
    "Agent: buffy (test)",
    "Task: Testar o guard de TOC.",
    "",
    "Work Log:",
    "",
    "- feito X.",
    "",
  ].join("\n")
}

/** Cria um worklog em dir com o conteúdo dado; retorna o path do arquivo. */
function makeWorklog(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "check-worklog-toc-"))
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

describe("check-worklog-toc.mjs (CLI)", () => {
  it("exit 0 quando o TOC está sincronizado (todo ID indexado + âncora + resumo)", () => {
    const file = makeWorklog(cleanWorklog())
    const res = run(resolve(file, ".."))
    expect(res.status).toBe(0)
    expect(outputOf(res)).toContain("sincronizado")
  })

  it("exit 1 e cita o ID quando uma entrada não tem linha no índice (reverse)", () => {
    const content = cleanWorklog().replace("- [TASK-1](#task-1) — Testar o guard de TOC.\n", "")
    const file = makeWorklog(content)
    const res = run(resolve(file, ".."))
    expect(res.status).toBe(1)
    expect(outputOf(res)).toContain("TASK-1")
    expect(outputOf(res)).toContain("sem linha no índice")
  })

  it("exit 1 e cita o slug quando um link do índice não tem âncora (forward)", () => {
    const content = cleanWorklog().replace('<a id="task-1"></a>\n', "")
    const file = makeWorklog(content)
    const res = run(resolve(file, ".."))
    expect(res.status).toBe(1)
    expect(outputOf(res)).toContain("#task-1")
    expect(outputOf(res)).toContain("sem âncora")
  })

  it("exit 1 quando a âncora do TOC não é o slug github-slugger do ID (anchor)", () => {
    const content = cleanWorklog().replace(
      "- [TASK-1](#task-1) — Testar o guard de TOC.",
      "- [TASK-1](#task-1-wrong) — Testar o guard de TOC.",
    )
    const file = makeWorklog(content)
    const res = run(resolve(file, ".."))
    expect(res.status).toBe(1)
    expect(outputOf(res)).toContain("≠ slug esperado")
  })

  it("exit 1 quando o índice tem linha stale (ID sem entrada real)", () => {
    const content = [
      "# Worklog",
      "",
      "## Índice de Task IDs",
      "",
      "- [TASK-1](#task-1) — Testar o guard de TOC.",
      "- [GHOST](#ghost) — Entrada que não existe.",
      '<a id="ghost"></a>',
      "",
      "---",
      "",
      "Task ID: TASK-1",
      '<a id="task-1"></a>',
      "Agent: buffy (test)",
      "Task: Testar o guard de TOC.",
      "",
      "Work Log:",
      "",
      "- feito X.",
      "",
    ].join("\n")
    const file = makeWorklog(content)
    const res = run(resolve(file, ".."))
    expect(res.status).toBe(1)
    expect(outputOf(res)).toContain("GHOST")
    expect(outputOf(res)).toContain("stale")
  })

  it("exit 1 quando uma linha do índice não tem resumo (empty-summary)", () => {
    const content = cleanWorklog().replace(
      "- [TASK-1](#task-1) — Testar o guard de TOC.",
      "- [TASK-1](#task-1) — —",
    )
    const file = makeWorklog(content)
    const res = run(resolve(file, ".."))
    expect(res.status).toBe(1)
    expect(outputOf(res)).toContain("TASK-1")
    expect(outputOf(res)).toContain("sem resumo")
  })

  it("exit 1 quando duas entradas estão coladas sem separador '---' (glued)", () => {
    const content = [
      "# Worklog",
      "",
      "## Índice de Task IDs",
      "",
      "- [TASK-1](#task-1) — Primeira.",
      "- [TASK-2](#task-2) — Segunda colada.",
      "",
      "---",
      "",
      "Task ID: TASK-1",
      '<a id="task-1"></a>',
      "Agent: buffy (test)",
      "Task: Primeira.",
      "",
      "Work Log:",
      "",
      "- feito.",
      "",
      "Task ID: TASK-2",
      '<a id="task-2"></a>',
      "Agent: buffy (test)",
      "Task: Segunda colada.",
      "",
      "Work Log:",
      "",
      "- feito.",
      "",
    ].join("\n")
    const file = makeWorklog(content)
    const res = run(resolve(file, ".."))
    expect(res.status).toBe(1)
    expect(outputOf(res)).toContain("coladas")
    expect(outputOf(res)).toContain("TASK-2")
  })
})

describe("check-worklog-toc.mjs (funções puras)", () => {
  it("extractEntries respeita fences — Task ID dentro de ``` não conta", () => {
    const content = [
      "# Worklog",
      "",
      "## Índice de Task IDs",
      "",
      "- [T-1](#t-1) — Um.",
      "",
      "---",
      "",
      "Task ID: T-1",
      "Agent: a",
      "Task: t",
      "",
      "Work Log:",
      "",
      "```",
      "Task ID: FENCE-1",
      "```",
      "",
      "---",
      "",
      "Task ID: T-2",
      "Agent: a",
      "Task: t",
      "",
      "Work Log:",
      "",
    ].join("\n")
    const entries = extractEntries(content)
    expect(entries.map((e) => e.id)).toEqual(["T-1", "T-2"])
  })

  it("extractTocRows ignora linhas de tabela e casa o resumo após o '—'", () => {
    const content = [
      "## Índice de Task IDs",
      "",
      "| ID | Slug |",
      "| --- | ---- |",
      "| TASK-1 | #task-1 |",
      "- [TASK-1](#task-1) — Testar o guard de TOC.",
      "",
    ].join("\n")
    const rows = extractTocRows(content)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.id).toBe("TASK-1")
    expect(rows[0]!.slug).toBe("task-1")
    expect(rows[0]!.summary).toBe("Testar o guard de TOC.")
  })

  it("fenceAwareIdLines ignora 'Task ID:' dentro de ``` (snippet de Work Log não é bloco colado)", () => {
    const block = [
      "Task ID: TASK-1",
      "Agent: a",
      "Task: t",
      "",
      "Work Log:",
      "",
      "```",
      "Task ID: AMOSTRA",
      "Stage: FAKE",
      "```",
      "",
      "- feito.",
    ].join("\n")
    const ids = fenceAwareIdLines(block)
    expect(ids.map((l) => l.id)).toEqual(["TASK-1"])
  })

  it("extractTocRows para no 1º separador — bullet '- [x](#y)' do corpo não é linha de índice", () => {
    const content = [
      "## Índice de Task IDs",
      "",
      "- [TASK-1](#task-1) — Testar o guard de TOC.",
      "",
      "---",
      "",
      "Task ID: TASK-1",
      "Agent: a",
      "Task: t",
      "",
      "Work Log:",
      "",
      "- [FALSO](#falso) — bullet de work log não é TOC.",
      "",
    ].join("\n")
    const rows = extractTocRows(content)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.id).toBe("TASK-1")
  })

  it("extractAnchors acha âncoras <a id> do arquivo", () => {
    const content = '<a id="task-1"></a>\n\n<a id="ghost"></a>\n'
    const anchors = extractAnchors(content)
    expect(anchors.map((a) => a.id)).toEqual(["task-1", "ghost"])
  })

  it("ENTRY_ID_RE aceita Task ID moderno e Stage legado", () => {
    expect("Task ID: ABC".match(ENTRY_ID_RE)?.[1]?.trim()).toBe("ABC")
    expect("Stage: LEGACY".match(ENTRY_ID_RE)?.[1]?.trim()).toBe("LEGACY")
  })

  it("slugify é o mesmo do guard de âncoras (accent + parentêses)", () => {
    expect(slugify("MUTATION-COORD-UPDATE-B (direção inversa)")).toBe(
      "mutation-coord-update-b-direção-inversa",
    )
    expect(slugify("RT-SESSION-LIMIT")).toBe("rt-session-limit")
  })

  it("checkWorklogToc reporta as 4 direções (forward/reverse/anchor/stale) no mesmo fixture", () => {
    const content = [
      "# Worklog",
      "",
      "## Índice de Task IDs",
      "",
      "- [T-1](#t-1) — Um.",
      "- [T-2](#t-2) — Dois (sem entrada).",
      '<a id="t-2"></a>',
      "",
      "---",
      "",
      "Task ID: T-1",
      '<a id="t-1"></a>',
      "Agent: a",
      "Task: t",
      "",
      "Work Log:",
      "",
      "---",
      "",
      "Task ID: T-3",
      "Agent: a",
      "Task: t",
      "",
      "Work Log:",
      "",
    ].join("\n")
    const violations = checkWorklogToc(content)
    expect(violations.some((v) => v.type === "stale" && v.id === "T-2")).toBe(true)
    expect(violations.some((v) => v.type === "reverse" && v.id === "T-3")).toBe(true)
  })
})
