// =============================================================================
// check-script-headers.test.ts
//
// Testes do scripts/check-script-headers.mjs — o guard que exige `Usage:` e
// `Exit code` no BLOCO DE DOCUMENTAÇÃO LÍDER de cada script, e que passou a ser
// GATE BLOQUEANTE nas duas forjas.
//
// O que precisa ser provado (e é o ponto todo):
//   1. o contrato é ESTRUTURAL, não posicional: a região são as linhas de
//      comentário do topo, até a primeira linha de código. Um cabeçalho de 200
//      linhas PASSA (antes reprovava por estar fora das "primeiras 50"), e um
//      `Usage:` no CORPO do arquivo NÃO passa (antes passava, se coubesse nas
//      50). As duas metades são testadas — é o mesmo par de mutações que mostra
//      que a regra nova não é só mais frouxa;
//   2. cada extensão tem a sua sintaxe de comentário, e a região atravessa bloco
//      aberto (C-style ` * `, PowerShell `<# #>`, docstring Python) — o
//      marcador não está na linha, está no bloco;
//   3. o veredito diz QUAL marcador falta e onde o código começa (o remédio é
//      derivado, não genérico);
//   4. o gate é BLOQUEANTE e está nas DUAS pipelines + classificado como CORE —
//      se alguém remover o step ou voltar o aviso do quality-gate, o teste cai
//      antes do CI.
//
// SEM rede e SEM docker: tudo é content-in/content-out, com sandbox em `os.tmpdir()`.
// =============================================================================

import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import yaml from "js-yaml"
import { describe, expect, it } from "vitest"

import { CORE_INVARIANTS } from "../../../scripts/check-forge-parity.mjs"
import {
  BUILTIN_IGNORES,
  EXIT,
  HEADER_EXTENSIONS,
  IGNORE_FILE,
  commentText,
  documentedHeader,
  exitCodeFor,
  firstCodeLine,
  headerRegion,
  ignoreList,
  isHeaderCheckable,
  parseArgs,
  remedyFor,
  renderReport,
  scanHeaders,
} from "../../../scripts/check-script-headers.mjs"

// ── fixtures ────────────────────────────────────────────────────────────────

const ROOT = process.cwd()

/** O guard REAL é o primeiro script varrido; o alvo do teste é o repositorio. */
const SCAN = scanHeaders({ dir: "scripts", root: ROOT })

/** Um cabeçalho mínimo válido, com a extensão decidindo o marcador. */
function mjsHeader(
  body: string,
  header = "// Usage:\n//   node scripts/x.mjs\n//\n// Exit codes:\n//   0 - ok",
) {
  return `${header.trimEnd()}\n${body}`
}

describe("headerRegion — a região é ESTRUTURAL, não as primeiras N linhas", () => {
  it("pega o bloco de comentário do topo, até a primeira linha de código", () => {
    const region = headerRegion(mjsHeader("const a = 1\n"), ".mjs")
    expect(region.map((l) => l.line)).toEqual([1, 2, 3, 4, 5])
    expect(region[4].text).toContain("0 - ok")
  })

  it("shebang não é documentação nem código (a região começa depois dele)", () => {
    const region = headerRegion(
      "#!/usr/bin/env node\n// Usage:\n// Exit codes:\nconsole.log(1)\n",
      ".mjs",
    )
    expect(region[0]).toEqual({ line: 2, text: "// Usage:" })
  })

  it("a região termina na PRIMEIRA linha de código, mesmo que ela seja a 2ª", () => {
    const region = headerRegion("const a = 1\n// Usage:\n// Exit codes:\n", ".mjs")
    expect(region).toEqual([])
  })

  it("um cabeçalho LONGO passa: 200 linhas de comentário continuam sendo o cabeçalho", () => {
    // É a metade que a regra anterior errava: ela media a POSIÇÃO do bloco, e
    // este repo escreve o "por que existe" inteiro no topo do arquivo.
    const preamble = Array.from({ length: 200 }, (_, i) => `// linha ${i + 1}`).join("\n")
    const content = `// Usage:\n//   node scripts/x.mjs\n${preamble}\n// Exit codes:\n//   0 - ok\nconst a = 1\n`
    const verdict = documentedHeader(content, ".mjs")
    expect(verdict.ok).toBe(true)
    expect(verdict.headerLines).toBe(204)
    expect(verdict.codeLine).toBe(205)
  })

  it("`Usage:` no CORPO do arquivo não conta — mesmo na linha 3 (a outra metade)", () => {
    // Antes passava (cabia nas primeiras 50). A regra olha a REGIÃO: se já
    // houve código, o comentário é do código, não do arquivo.
    const verdict = documentedHeader("const a = 1\n// Usage:\n// Exit codes:\n", ".mjs")
    expect(verdict.ok).toBe(false)
    expect(verdict.missing).toEqual(["Usage:", "Exit code"])
    expect(verdict.headerLines).toBe(0)
  })

  it("linhas em branco do topo fazem parte da região (e não inventam código)", () => {
    const region = headerRegion("\n\n// Usage:\n// Exit codes:\nlet x = 1\n", ".mjs")
    expect(region.map((l) => l.line)).toEqual([1, 2, 3, 4])
    expect(documentedHeader("\n\n// Usage:\n// Exit codes:\nlet x = 1\n", ".mjs").codeLine).toBe(5)
  })

  it("BOM e CRLF não quebram a região (arquivo vindo de checkout Windows)", () => {
    const content = "\uFEFF// Usage:\r\n// Exit codes:\r\nconst a = 1\r\n"
    expect(documentedHeader(content, ".mjs").ok).toBe(true)
  })

  it("bloco C-style aberto mantém a região viva (o ` * ` não carrega marcador)", () => {
    const content =
      "/**\n * Usage:\n *   node scripts/x.mjs\n *\n * Exit codes:\n *   0 - ok\n */\nconst a = 1\n"
    const verdict = documentedHeader(content, ".mjs")
    expect(verdict.ok).toBe(true)
    expect(verdict.codeLine).toBe(8)
  })

  it("o delimitador do bloco sai do texto da linha (`/* Usage: x */` conta)", () => {
    const content = "/* Usage: node x.mjs */\n// Exit codes:\n//   0 - ok\nconst a = 1\n"
    expect(documentedHeader(content, ".mjs").ok).toBe(true)
  })

  it("bloco que abre e fecha na MESMA linha não fica aberto (não engole o arquivo)", () => {
    // Se o `/* ... */` de uma linha deixasse a região aberta, ela atravessaria
    // o `const a = 1` e só pararia no `*/` do fim — e o veredito diria "ok"
    // sobre um arquivo cujo único cabeçalho termina na linha 1.
    const content = "/* nota de uma linha */\nconst a = 1\n// Usage:\n// Exit codes:\n/* fim */\n"
    expect(headerRegion(content, ".mjs").map((l) => l.line)).toEqual([1])
    const verdict = documentedHeader(content, ".mjs")
    expect(verdict.ok).toBe(false)
    expect(verdict.codeLine).toBe(2) // a linha 2 é CÓDIGO, não cabeçalho
  })

  it("comentário HTML (`<!-- -->`) é cabeçalho válido", () => {
    expect(
      documentedHeader("<!--\nUsage: node x.mjs\nExit codes: 0\n-->\n<html />\n", ".mjs").ok,
    ).toBe(true)
  })

  it("&#96;.sh&#96;: `#` acima do `set -euo pipefail` é cabeçalho; abaixo é código", () => {
    const good = "#!/usr/bin/env bash\n# Usage:\n# Exit codes:\nset -euo pipefail\n"
    expect(documentedHeader(good, ".sh").ok).toBe(true)
    const bad = "#!/usr/bin/env bash\nset -euo pipefail\n# Usage:\n# Exit codes:\n"
    expect(documentedHeader(bad, ".sh").ok).toBe(false)
    expect(documentedHeader(bad, ".sh").codeLine).toBe(2)
  })

  it("&#96;.ps1&#96;: o `<# ... #>` é a região (o marcador não está na linha)", () => {
    const content = "<#\n  Usage: .\\scripts\\x.ps1\n  Exit codes: 0 ok\n#>\nparam()\n"
    expect(documentedHeader(content, ".ps1").ok).toBe(true)
  })

  it("&#96;.py&#96;: o docstring module-level É a documentação do arquivo", () => {
    const content =
      '#!/usr/bin/env python3\n"""\nUsage: python3 scripts/x.py\n\nExit codes:\n  0 - ok\n"""\nimport sys\n'
    const verdict = documentedHeader(content, ".py")
    expect(verdict.ok).toBe(true)
    expect(verdict.codeLine).toBe(8)
  })

  it("uma linha de `*` no topo de um .sh NÃO é comentário (só JS/TS tem continuação C-style)", () => {
    // `*` em shell é glob/loop, não comentário: tratar como comentário deixaria
    // a região atravessar código de shell.
    expect(headerRegion("* x\n# Usage:\n# Exit codes:\n", ".sh")).toEqual([])
  })
})

describe("documentedHeader — o veredito e o remédio", () => {
  it("os dois marcadores presentes: ok, sem `missing`", () => {
    const verdict = documentedHeader(mjsHeader("const a = 1\n"), ".mjs")
    expect(verdict).toEqual({ ok: true, missing: [], headerLines: 5, codeLine: 6 })
  })

  it("`Exit codes:` (plural) é aceito — a baseline do repo usa as duas formas", () => {
    const content = "// Usage:\n//   node x.mjs\n//\n// Exit codes:\n//   0 - ok\nconst a = 1\n"
    expect(documentedHeader(content, ".mjs").ok).toBe(true)
  })

  it("o marcador é literal: `Usages:` e `inusage:` não valem", () => {
    expect(documentedHeader("// Usages:\n// Exit codes:\nconst a = 1\n", ".mjs").missing).toEqual([
      "Usage:",
    ])
  })

  it('diz QUAL marcador falta (um de cada vez), não "faltou o cabeçalho"', () => {
    expect(documentedHeader("// Exit codes:\n// 0 ok\nconst a = 1\n", ".mjs").missing).toEqual([
      "Usage:",
    ])
    expect(documentedHeader("// Usage:\n// x\nconst a = 1\n", ".mjs").missing).toEqual([
      "Exit code",
    ])
  })

  it('arquivo VAZIO é violação (não é "nada a documentar")', () => {
    const verdict = documentedHeader("", ".mjs")
    expect(verdict.ok).toBe(false)
    expect(verdict.missing).toEqual(["Usage:", "Exit code"])
  })

  it("arquivo só de cabeçalho não inventa linha de código (codeLine null)", () => {
    const content = "// Usage:\n//   node x.mjs\n//\n// Exit codes:\n//   0 - ok\n"
    const verdict = documentedHeader(content, ".mjs")
    expect(verdict.ok).toBe(true)
    expect(verdict.codeLine).toBeNull()
    expect(firstCodeLine(content, ".mjs")).toBeNull()
  })

  it("o remédio nomeia a marca que falta E onde o cabeçalho termina", () => {
    const verdict = documentedHeader("// Usage:\nconst a = 1\n", ".mjs")
    const remedy = remedyFor({
      name: "x.mjs",
      missing: verdict.missing,
      codeLine: verdict.codeLine,
    })
    expect(remedy).toContain("Exit code")
    expect(remedy).toContain("linha 2")
  })
})

describe("commentText — o conteúdo da documentação, não a linha crua", () => {
  it("tira os delimitadores das pontas, em qualquer sintaxe", () => {
    expect(commentText("// Usage:")).toBe("Usage:")
    expect(commentText("# Exit codes:")).toBe("Exit codes:")
    expect(commentText(" * Usage:")).toBe("Usage:")
    expect(commentText("/* Usage: x */")).toBe("Usage: x")
    expect(commentText("<!-- Exit codes: 0 -->")).toBe("Exit codes: 0")
    expect(commentText("Usage:")).toBe("Usage:")
  })

  it("não come o texto do marcador (o prefixo `check-` não vira `heck-`)", () => {
    expect(commentText("# check-script-headers")).toBe("check-script-headers")
    expect(commentText("// Exit codes: 0 ok · 1 violação")).toBe("Exit codes: 0 ok · 1 violação")
  })
})

describe("parseArgs — o contrato da CLI", () => {
  it("varre scripts/ por padrão e não liga nada que mude o veredito", () => {
    const opts = parseArgs([])
    expect(opts).toMatchObject({ dir: "scripts", list: false, json: false, help: false })
    expect(opts.error).toBeUndefined()
  })

  it("as flags são reconhecidas", () => {
    expect(parseArgs(["--list"]).list).toBe(true)
    expect(parseArgs(["--json"]).json).toBe(true)
    expect(parseArgs(["-h"]).help).toBe(true)
    expect(parseArgs(["--help"]).help).toBe(true)
    expect(parseArgs(["--dir", "outro"]).dir).toBe("outro")
  })

  it("flag sem valor e flag desconhecida são ERRO, não um valor engolido", () => {
    expect(parseArgs(["--dir"]).error).toBeTruthy()
    expect(parseArgs(["--dir", "--json"]).error).toBeTruthy()
    expect(parseArgs(["--inventado"]).error).toContain("--inventado")
  })
})

describe("isHeaderCheckable / ignoreList — o que o gate alcança", () => {
  it("só as extensões com sintaxe de cabeçalho entram", () => {
    expect(HEADER_EXTENSIONS).toEqual([".mjs", ".ts", ".sh", ".py", ".ps1"])
    for (const name of ["a.mjs", "b.ts", "c.sh", "d.py", "e.ps1"]) {
      expect(isHeaderCheckable(name), name).toBe(true)
    }
    for (const name of ["schema.sql", "notes.txt", "service.service", "logo.svg"]) {
      expect(isHeaderCheckable(name), name).toBe(false)
    }
  })

  it("a lista de ignorados é a do repo MAIS os built-in (helpers internos)", () => {
    const list = ignoreList(ROOT)
    for (const builtin of BUILTIN_IGNORES) expect(list, builtin).toContain(builtin)
    expect(list).toContain("setup-vps.sh")
    expect(list.length).toBeGreaterThan(BUILTIN_IGNORES.length)
  })

  it("sem o arquivo de ignore, a lista é só a built-in", () => {
    const list = ignoreList("/nao/existe", { exists: () => false })
    expect(list).toEqual(BUILTIN_IGNORES)
  })

  it('ignore ILEGÍVEL não vira "tudo ignorado" (fail-safe, não fail-open)', () => {
    const list = ignoreList(ROOT, {
      exists: () => true,
      readFile: () => {
        throw new Error("EACCES")
      },
    })
    expect(list).toEqual(BUILTIN_IGNORES)
  })
})

describe("scanHeaders — o sandbox", () => {
  function sandbox(files: Record<string, string>) {
    const dir = mkdtempSync(join(tmpdir(), "headers-"))
    const scripts = join(dir, "scripts")
    mkdirSync(scripts, { recursive: true })
    for (const [name, content] of Object.entries(files)) writeFileSync(join(scripts, name), content)
    return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
  }

  it("varre só as extensões do contrato e separa violações de ignorados", () => {
    const { dir, cleanup } = sandbox({
      "ok.mjs": mjsHeader("const a = 1\n"),
      "ruim.mjs": "const a = 1\n",
      "ruim.sh": "set -euo pipefail\n",
      "dados.sql": "select 1;\n",
      "ignore-me.sh": "set -euo pipefail\n",
    })
    try {
      // A lista de ignorados é a do ROOT do sandbox (não a do repo).
      writeFileSync(join(dir, IGNORE_FILE), "ignore-me.sh\n")
      const result = scanHeaders({ dir: "scripts", root: dir })
      expect(result.ok).toBe(false)
      // varridos = os do contrato, MENOS o ignorado; o `.sql` nem entra
      expect(result.checked).toEqual(["ok.mjs", "ruim.mjs", "ruim.sh"])
      expect(result.violations.map((v) => v.name)).toEqual(["ruim.mjs", "ruim.sh"])
      expect(result.ignored).toEqual(["ignore-me.sh"])
      expect(result.violations[0].missing).toEqual(["Usage:", "Exit code"])
    } finally {
      cleanup()
    }
  })

  it("respeita o `.barrel-lint-ignore` do diretório raiz", () => {
    const { dir, cleanup } = sandbox({ "ruim.sh": "set -euo pipefail\n" })
    try {
      writeFileSync(join(dir, IGNORE_FILE), "# comentário\nruim.sh\n")
      const result = scanHeaders({ dir: "scripts", root: dir })
      expect(result.ok).toBe(true)
      expect(result.ignored).toEqual(["ruim.sh"])
      expect(result.checked).toEqual([])
    } finally {
      cleanup()
    }
  })

  it('diretório inexistente é INFRA (exit 2), não "está tudo documentado"', () => {
    const result = scanHeaders({ dir: "nao-existe", root: ROOT })
    expect(result.ok).toBe(false)
    expect(result.error).toContain("nao-existe")
    expect(exitCodeFor(result)).toBe(EXIT.UNAVAILABLE)
  })

  it("o REPOSITÓRIO REAL passa — e o total é honesto sobre o que ficou de fora", () => {
    expect(SCAN.ok).toBe(true)
    expect(SCAN.violations).toEqual([])
    expect(SCAN.checked.length).toBeGreaterThan(150)
    // Os ignorados estão DECLARADOS (a diferença entre documentado e não olhado).
    expect(SCAN.ignored.length).toBeGreaterThan(0)
    // E nenhum arquivo foi varrido duas vezes.
    expect(new Set(SCAN.checked).size).toBe(SCAN.checked.length)
  })

  it("o script que motivou o gate continua documentado (âncora de regressão)", () => {
    // `setup-bun-ci.sh` era o ÚNICO sem `Usage:` — e era o item que o gate
    // antigo, com o aviso no CI, deixava passar em qualquer pipeline.
    const content = readFileSync(join(ROOT, "scripts/setup-bun-ci.sh"), "utf-8")
    const verdict = documentedHeader(content, ".sh")
    expect(verdict.ok).toBe(true)
    expect(verdict.missing).toEqual([])
  })

  it("os scripts que 'falhavam' por POSIÇÃO seguem documentados — sem terem sido reescritos", () => {
    // Estes seis estavam na lista de violações só porque o cabeçalho passa da
    // linha 50. A doc deles está certa; era a regra que media a coisa errada.
    for (const name of [
      "actrc-sync-issue.mjs",
      "check-actrc-sync.mjs",
      "check-registry-source.mjs",
      "check-runner-labels.mjs",
      "ensure-runner-image.mjs",
      "prove-runner-image-gate.mjs",
    ]) {
      const content = readFileSync(join(ROOT, "scripts", name), "utf-8")
      const ext = name.slice(name.lastIndexOf("."))
      const verdict = documentedHeader(content, ext)
      expect(verdict.ok, name).toBe(true)
      // E o cabeçalho deles realmente passa da linha 50 (a prova de que a
      // regra antiga reprovava por posição).
      expect(verdict.codeLine ?? 0, name).toBeGreaterThan(50)
    }
  })
})

describe("CLI — os exit codes são o contrato", () => {
  const cli = (args: string[], cwd = ROOT) => {
    const res = spawnSync("node", [join(ROOT, "scripts/check-script-headers.mjs"), ...args], {
      cwd,
      encoding: "utf8",
      timeout: 60_000,
    })
    return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" }
  }

  it("no repositório real: exit 0", () => {
    const res = cli(["--json"])
    expect(res.status).toBe(EXIT.OK)
    const json = JSON.parse(res.stdout)
    expect(json.exitCode).toBe(EXIT.OK)
    expect(json.violations).toEqual([])
  })

  it("--help sai 0 e documenta o contrato", () => {
    const res = cli(["--help"])
    expect(res.status).toBe(EXIT.OK)
    expect(res.stdout).toContain("Exit codes:")
    expect(res.stdout).toContain("BLOCO DE DOCUMENTAÇÃO LÍDER")
  })

  it("uso inválido sai 3", () => {
    expect(cli(["--inventado"]).status).toBe(EXIT.USAGE)
    expect(cli(["--dir"]).status).toBe(EXIT.USAGE)
  })

  it("diretório inexistente sai 2 (infra)", () => {
    const res = cli(["--dir", "nao-existe"])
    expect(res.status).toBe(EXIT.UNAVAILABLE)
  })

  it("um script sem cabeçalho no sandbox sai 1 e aponta o arquivo", () => {
    const dir = mkdtempSync(join(tmpdir(), "headers-cli-"))
    try {
      mkdirSync(join(dir, "scripts"), { recursive: true })
      writeFileSync(join(dir, "scripts/feio.mjs"), "console.log(1)\n")
      const res = cli(["--dir", "scripts"], dir)
      expect(res.status).toBe(EXIT.VIOLATIONS)
      expect(res.stdout).toContain("scripts/feio.mjs")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("--list lista o que foi varrido, sem veredito", () => {
    const res = cli(["--list"])
    expect(res.status).toBe(EXIT.OK)
    expect(res.stdout.split("\n")).toContain("scripts/check-script-headers.mjs")
  })
})

describe("renderReport", () => {
  const capture = (result: any, opts: any = {}) => {
    const lines: string[] = []
    renderReport(result, { emit: (s) => lines.push(s ?? ""), ...opts })
    return lines.join("\n")
  }

  it("verde: diz quantos foram varridos E quantos ficaram fora do contrato", () => {
    const text = capture(SCAN)
    expect(text).toContain("✅")
    expect(text).toContain(IGNORE_FILE)
    expect(text).toContain(`${SCAN.ignored.length} ignorado(s)`)
  })

  it("vermelho: nomeia o arquivo, a marca que falta e o remédio", () => {
    const text = capture({
      ok: false,
      dir: "scripts",
      checked: ["feio.mjs"],
      ignored: [],
      violations: [{ name: "feio.mjs", missing: ["Usage:"], codeLine: 1, headerLines: 0 }],
    })
    expect(text).toContain("scripts/feio.mjs")
    expect(text).toContain("falta Usage:")
    expect(text).toContain("linha 1")
    expect(text).toContain("BLOCO DE DOCUMENTAÇÃO LÍDER")
  })

  it("infra: diz o erro e não finge veredito", () => {
    const text = capture({
      ok: false,
      dir: "x",
      checked: [],
      ignored: [],
      violations: [],
      error: "diretorio inexistente: x",
    })
    expect(text).toContain("diretorio inexistente")
    expect(text).not.toContain("✅")
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// O GATE BLOQUEANTE — o que este trabalho veio fechar
// ═══════════════════════════════════════════════════════════════════════════

describe("o gate é bloqueante e está nas DUAS forjas", () => {
  const read = (p: string) => readFileSync(join(ROOT, p), "utf-8")

  /** O id do job que roda `needle` — derivado do YAML, não escrito à mão. */
  function jobCarrying(file: string, needle: string): string {
    const doc = yaml.load(read(file)) as { jobs?: Record<string, { steps?: { run?: string }[] }> }
    for (const [id, job] of Object.entries(doc.jobs ?? {})) {
      if ((job.steps ?? []).some((s) => typeof s.run === "string" && s.run.includes(needle))) {
        return id
      }
    }
    throw new Error(`nenhum job em ${file} roda '${needle}'`)
  }

  it("o step vive num job REQUIRED em cada forja — é isso que bloqueia o merge", () => {
    // Um gate num job que NÃO é required roda e não bloqueia nada: o vermelho
    // aparece, o merge passa. A prova de bloqueio é esta amarra com o manifesto.
    const manifest = JSON.parse(read("ci/required-checks.json")) as {
      forges: Record<string, { jobs: string[] }>
    }
    expect(manifest.forges.gitea.jobs).toContain(
      jobCarrying(".gitea/workflows/ci.yml", "check-script-headers"),
    )
    expect(manifest.forges.github.jobs).toContain(
      jobCarrying(".github/workflows/pr-check.yml", "check-script-headers"),
    )
  })

  it("roda na forja dona do merge (job `guards`, com `node` direto)", () => {
    expect(read(".gitea/workflows/ci.yml")).toContain("run: node scripts/check-script-headers.mjs")
  })

  it("roda no espelho do GitHub (pr-check.yml)", () => {
    expect(read(".github/workflows/pr-check.yml")).toContain(
      "run: node scripts/check-script-headers.mjs",
    )
  })

  it("o gate está classificado como CORE — não pode sumir de uma pipeline em silêncio", () => {
    const entry = CORE_INVARIANTS.find((i) => i.matches.test("scripts/check-script-headers.mjs"))
    expect(entry).toBeDefined()
    expect(entry?.id).toBe("script-headers")
    expect(entry?.why.length).toBeGreaterThan(40)
  })

  it("o `quality-gate.yml` NÃO engole mais o exit code (fail-closed)", () => {
    const content = read(".github/workflows/quality-gate.yml")
    // O step passou a ser UM comando cujo código de saída É o veredito.
    expect(content).toMatch(
      /name: Barrel imports \+ script headers\n\s+run: node scripts\/barrel-lint\.mjs/,
    )
    // Os dois sinais de que o gate era decorativo: o `|| exit_code=$?` que
    // capturava o status e o ramo `-eq 3` que o transformava em aviso.
    expect(content).not.toContain("|| exit_code=$?")
    expect(content).not.toMatch(/-eq 3/)
    expect(content).not.toMatch(/%warning::|::warning::/)
  })

  it("o barrel-lint usa a MESMA regra (não existe segunda cópia do contrato)", () => {
    const content = read("scripts/barrel-lint.mjs")
    expect(content).toContain('from "./check-script-headers.mjs"')
    expect(content).not.toContain("hasMinimalHeader")
    // E ele passa no repositório real — o hook local não briga com o CI.
    const res = spawnSync("node", ["scripts/barrel-lint.mjs"], { cwd: ROOT, encoding: "utf8" })
    expect(res.status).toBe(0)
  })
})
