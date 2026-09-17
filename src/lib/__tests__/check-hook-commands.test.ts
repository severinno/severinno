/**
 * check-hook-commands.test.ts
 *
 * A prova do guard `scripts/check-hook-commands.mjs`: todo comando que os hooks
 * executam tem de RESOLVER (arquivo do repositório, entrada do `package.json`,
 * binário de dependência, função do hook, ferramenta externa declarada).
 *
 * A suíte existe porque um guard que nunca falhou não protege nada. Cada
 * CLASSE de defeito que ele promete pegar tem um caso aqui — caminho com erro
 * de digitação, entrada de `scripts` que não existe, entrada que aponta para um
 * arquivo removido, função chamada e não definida, `source` ausente, binário
 * sem fornecedor, payload de runtime não declarado — e cada um tem o CONTROLE
 * na direção oposta (o mesmo fixture, sem o defeito, sai verde), que é o que
 * desmente um não-zero vindo do FIXTURE (package.json ausente, `.husky/` vazio,
 * guard lendo o diretório errado).
 *
 * A régua de EXTRAÇÃO também é medida, e não só o veredito: comentário, heredoc
 * e quebra de linha não são comandos, e o comando de dentro de um `$( ... )` É
 * (ele executa de verdade) — sem isso, o guard julgaria um texto que ninguém
 * executa.
 *
 * Usage:
 *   bunx vitest run --config vitest.config.unit.ts src/lib/__tests__/check-hook-commands.test.ts
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { spawnSync } from "node:child_process"
import { afterAll, describe, expect, it } from "vitest"
import {
  ALLOWLIST,
  BIN_PACKAGES,
  EXIT,
  EXTERNAL_TOOLS,
  HOOKS_DIR,
  INDETERMINATE,
  INTERPRETERS,
  SOURCE_COMMANDS,
  analyze,
  definedFunctions,
  extractSubstitutions,
  hookFiles,
  isCasePattern,
  programOf,
  reviewViolations,
  shellCommands,
} from "../../../scripts/check-hook-commands.mjs"

const GUARD = join(process.cwd(), "scripts", "check-hook-commands.mjs")

const fixtures: string[] = []
afterAll(() => {
  for (const dir of fixtures.splice(0)) rmSync(dir, { recursive: true, force: true })
})

interface FixtureSpec {
  hooks: Record<string, string>
  scripts?: Record<string, string>
  arquivos?: Record<string, string>
  deps?: string[]
}

/** Um repositório mínimo: os hooks, o `package.json` e os arquivos citados. */
function fixture(spec: FixtureSpec): string {
  const dir = mkdtempSync(join(tmpdir(), "hookcommands-"))
  fixtures.push(dir)
  mkdirSync(join(dir, HOOKS_DIR), { recursive: true })
  for (const [nome, corpo] of Object.entries(spec.hooks)) {
    writeFileSync(join(dir, HOOKS_DIR, nome), corpo, "utf8")
  }
  const pkg = {
    name: "fixture-hook-commands",
    private: true,
    scripts: spec.scripts ?? {},
    dependencies: {},
    devDependencies: Object.fromEntries((spec.deps ?? []).map((d) => [d, "1.0.0"])),
  }
  writeFileSync(join(dir, "package.json"), JSON.stringify(pkg, null, 2), "utf8")
  for (const [rel, conteudo] of Object.entries(spec.arquivos ?? {})) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true })
    writeFileSync(join(dir, rel), conteudo, "utf8")
  }
  return dir
}

/**
 * O relatório de um fixture COM as duas âncoras (`.husky/` e `package.json`).
 * O caso `infra` — que é o fail-CLOSED do guard — tem teste próprio, e aqui ele
 * é erro de fixture: sem esta guarda, uma asserção sobre `violacoes` mediria um
 * relatório que não existe, e o verde viria da ausência do arquivo.
 */
type RelatorioCompleto = Extract<ReturnType<typeof analyze>, { comandos: unknown[] }>

function relatorio(root: string): RelatorioCompleto {
  const report = analyze({ root })
  if (report.infra) throw new Error(`fixture sem .husky/ ou package.json: ${root}`)
  // O `infra` acima é o fail-closed do guard: aqui ele é erro de FIXTURE, e o
  // cast é a consequência declarada disso (o relatório completo tem os campos).
  return report as RelatorioCompleto
}

const motivos = (report: RelatorioCompleto): string[] =>
  report.violacoes.map((v) => `${v.arquivo}:${v.linha} ${v.motivo}`)

function rodaCli(dir: string, extra: string[] = []): { status: number | null; saida: string } {
  const r = spawnSync(process.execPath, [GUARD, "--root", dir, ...extra], { encoding: "utf8" })
  return { status: r.status, saida: `${r.stdout ?? ""}${r.stderr ?? ""}` }
}

// ── o defeito que o guard existe para pegar: o caminho que não existe ─────

describe("o caminho citado pelo hook tem de existir", () => {
  it("PROVA: `node scripts/typo.mjs` é VIOLAÇÃO, com arquivo e linha", () => {
    const dir = fixture({
      hooks: { "pre-commit": "set -eu\nnode scripts/check-bun-mirrorx.mjs --staged &\n" },
      arquivos: { "scripts/check-bun-mirror.mjs": "// existe, mas com outro nome\n" },
    })

    const report = relatorio(dir)

    expect(report.infra).toBe(false)
    expect(report.violacoes).toHaveLength(1)
    expect(motivos(report)[0]).toContain(".husky/pre-commit:2")
    expect(motivos(report)[0]).toContain("scripts/check-bun-mirrorx.mjs")
    // O typo de UM caractere ja vem com o nome certo na mensagem.
    expect(motivos(report)[0]).toContain("o mais próximo é `check-bun-mirror.mjs`")
    expect(rodaCli(dir).status).toBe(EXIT.VIOLATIONS)
  })

  it("o CONTROLE: o MESMO fixture com o nome certo sai verde", () => {
    const dir = fixture({
      hooks: { "pre-commit": "set -eu\nnode scripts/check-bun-mirror.mjs --staged &\n" },
      arquivos: { "scripts/check-bun-mirror.mjs": "// ok\n" },
    })

    const report = relatorio(dir)

    expect(report.violacoes).toEqual([])
    // Dois comandos: o `set -eu` e o `node`. O que importa e o do node — por
    // isso a assercao procura o DESFECHO dele, e nao o indice na lista.
    const doNode = report.resolvidos.find((r) => r.programa === "node")
    expect(doNode?.motivo).toContain("scripts/check-bun-mirror.mjs")
    expect(rodaCli(dir).status).toBe(EXIT.OK)
  })

  it("o script de um `bash` também responde pelo caminho, e `source` idem", () => {
    const dir = fixture({
      hooks: {
        "pre-push": "bash scripts/run-encoding-guards.sh\nsource scripts/lib.sh\n",
      },
      arquivos: { "scripts/run-encoding-guards.sh": "#!/usr/bin/env bash\n" },
    })

    const report = relatorio(dir)

    expect(report.violacoes).toHaveLength(1)
    expect(motivos(report)[0]).toContain("source de `scripts/lib.sh`")
  })
})

// ── a entrada do package.json (e o que ela EXECUTA) ──────────────────────

describe("`bun run <entrada>` resolve a entrada e o que ela executa", () => {
  it("PROVA: entrada que não existe em `scripts` é VIOLAÇÃO", () => {
    const dir = fixture({
      hooks: { "pre-commit": "bun run tipecheck\n" },
      scripts: { typecheck: "tsc --noEmit" },
    })

    const motivo = motivos(relatorio(dir))[0]!
    expect(motivo).toContain("não é entrada de `scripts`")
    // A sugestao do vizinho: o erro de digitacao se corrige sozinho.
    expect(motivo).toContain("o mais próximo é `typecheck`")
  })

  it("PROVA: entrada que existe mas aponta para um arquivo REMOVIDO é VIOLAÇÃO (com a proveniência)", () => {
    const dir = fixture({
      hooks: { "pre-push": "bun run fuzz\n" },
      scripts: { fuzz: "bash scripts/run-fuzz.sh" },
    })

    const report = relatorio(dir)

    expect(motivos(report)[0]).toContain("`fuzz` (em `scripts`)")
    expect(motivos(report)[0]).toContain("scripts/run-fuzz.sh")
  })

  it("o CONTROLE: entrada que aponta para um arquivo que existe sai verde", () => {
    const dir = fixture({
      hooks: { "pre-push": "bun run fuzz\n" },
      scripts: { fuzz: "bash scripts/run-fuzz.sh" },
      arquivos: { "scripts/run-fuzz.sh": "#!/usr/bin/env bash\n" },
    })

    const report = relatorio(dir)

    expect(report.violacoes).toEqual([])
    expect(report.resolvidos[0]!.motivo).toContain("entrada `fuzz`")
  })

  it("`bun run <binário>` resolve pela dependência (a entrada de `scripts` não é a única forma)", () => {
    const dir = fixture({
      hooks: { "pre-push": "bun run vitest run --reporter=verbose $T\n" },
      deps: ["vitest"],
    })
    expect(relatorio(dir).violacoes).toEqual([])

    const semDep = fixture({ hooks: { "pre-push": "bun run vitest run\n" } })
    expect(motivos(relatorio(semDep))[0]).toContain("nem binário de dependência declarada")
  })

  it("`bun install` é SUBCOMANDO nativo, não uma entrada faltando", () => {
    const dir = fixture({ hooks: { "post-checkout": "bun install\n" } })
    expect(motivos(relatorio(dir))).toEqual([])
  })
})

// ── funções do hook, binários e ferramentas externas ─────────────────────

describe("função, binário e ferramenta externa", () => {
  it("PROVA: função CHAMADA e não definida é VIOLAÇÃO (o `command not found` no meio da fase)", () => {
    const dir = fixture({ hooks: { "pre-commit": "wait_all $A $B\n" } })
    expect(motivos(relatorio(dir))[0]).toContain("`wait_all`")
  })

  it("o CONTROLE: definida no próprio hook, a chamada resolve", () => {
    const dir = fixture({
      hooks: { "pre-commit": "wait_all() {\n  return 0\n}\nwait_all $A $B\n" },
    })
    const report = relatorio(dir)
    expect(report.violacoes).toEqual([])
    // O `return` de dentro do corpo tambem e um comando julgado: a assercao
    // procura a CHAMADA, nao a posicao dela na lista.
    expect(report.resolvidos.find((r) => r.programa === "wait_all")?.motivo).toBe(
      "função do próprio hook",
    )
  })

  it("PROVA: binário de `bun x` sem dependência declarada é VIOLAÇÃO", () => {
    const dir = fixture({ hooks: { "pre-commit": "bun x ferramenta-que-nao-existe\n" } })
    expect(motivos(relatorio(dir))[0]).toContain("ALLOWLIST")
  })

  it("o CONTROLE: com a dependência declarada, o binário resolve", () => {
    const dir = fixture({
      hooks: { "pre-commit": "bun x prettier --check src\n" },
      deps: ["prettier"],
    })
    expect(relatorio(dir).violacoes).toEqual([])
  })

  it("PROVA: programa que ninguém declarou é VIOLAÇÃO (uma ferramenta nova tem de ser DECISÃO)", () => {
    const dir = fixture({ hooks: { "pre-commit": "jq . package.json\n" } })
    expect(motivos(relatorio(dir))[0]).toContain("ferramenta externa declarada")
  })

  it("a ALLOWLIST cobre o que existe fora do repositório (o advisory do Lighthouse)", () => {
    const dir = fixture({ hooks: { "pre-push": "bunx @lhci/cli --version\n" } })
    const report = relatorio(dir)
    expect(report.violacoes).toEqual([])
    expect(report.resolvidos[0]!.motivo).toContain(ALLOWLIST[0]!.addedAt)
  })
})

// ── o que não se prova por leitura tem de estar DECLARADO ────────────────

describe("runtime: o indeterminado é uma decisão datada, nunca um silêncio", () => {
  it("PROVA: payload inline sem declaração é VIOLAÇÃO (fail-closed)", () => {
    const dir = fixture({ hooks: { "pre-push": 'bash -c "$cmd"\n' } })
    const report = relatorio(dir)
    expect(report.violacoes).toHaveLength(1)
    expect(motivos(report)[0]).toContain("INDETERMINATE")
  })

  it("PROVA: caminho montado em `$VAR` sem declaração também é VIOLAÇÃO", () => {
    const dir = fixture({ hooks: { "pre-commit": 'node "$SCRIPT"\n' } })
    expect(motivos(relatorio(dir))[0]).toContain("INDETERMINATE")
  })

  it("o CONTROLE: o payload DECLARADO (o `python3 -c` real do repositório) é indeterminado verde", () => {
    const dir = fixture({ hooks: { "pre-push": 'python3 -c "import sys"\n' } })
    const report = relatorio(dir)
    expect(report.violacoes).toEqual([])
    expect(report.indeterminados).toHaveLength(1)
    expect(report.indeterminados[0]!.motivo).toContain(INDETERMINATE[0]!.addedAt)
    expect(rodaCli(dir).status).toBe(EXIT.OK)
  })

  it("as DUAS listas de decisão têm `addedAt` dentro da janela (o mecanismo é o compartilhado)", () => {
    const dir = fixture({ hooks: { "pre-commit": "git status\n" } })
    const agora = analyze({ root: dir, now: Date.now() })
    expect(reviewViolations(agora)).toEqual([])

    // Muito depois: a isenção sem revisão vira violação nomeada (é o que impede
    // uma decisão antiga de virar permanente por esquecimento).
    const futuro = analyze({ root: dir, now: Date.now() + 10 * 365 * 86_400_000 })
    const futuras = reviewViolations(futuro).map((v) => v.motivo)
    expect(futuras.some((m) => m.includes("ALLOWLIST"))).toBe(true)
    expect(futuras.some((m) => m.includes("INDETERMINATE"))).toBe(true)
  })
})

// ── a régua de extração (o que é, e o que não é, um comando) ─────────────

describe("a extração: comentário, heredoc, quebra de linha e `$( )`", () => {
  it("comentário e heredoc não são comandos; a quebra de linha SEPARA comandos", () => {
    const texto = [
      "# node scripts/comentado.mjs",
      "cat <<'EOF'",
      "node scripts/dentro-do-heredoc.mjs",
      "EOF",
      "echo um",
      "echo dois",
    ].join("\n")
    const comandos = shellCommands(texto)
    expect(comandos.map((c) => c.programa)).toEqual(["cat", "echo", "echo"])
    expect(comandos.map((c) => c.linha)).toEqual([2, 5, 6])
  })

  it("o comando de dentro de um `$( )` EXECUTA — e por isso é julgado (na linha do `$(`)", () => {
    const texto = 'SNAP=$(git diff --cached --name-only | grep -E "\\.snap$")\n'
    const comandos = shellCommands(texto)
    expect(comandos.map((c) => c.programa)).toEqual(["git", "grep"])
    expect(comandos.every((c) => c.linha === 1 && c.origem === "substituição")).toBe(true)
  })

  it("PROVA: o caminho tipado DENTRO de um `$( )` também é violação (não escapa pelo `=`)", () => {
    const dir = fixture({ hooks: { "pre-commit": "X=$(node scripts/nao-existe.mjs)\n" } })
    expect(motivos(relatorio(dir))[0]).toContain("scripts/nao-existe.mjs")
  })

  it("a máscara da substituição preserva a forma da linha (o resto não vira um `programa`)", () => {
    const texto = 'test_file="src/lib/__tests__/$(basename "$file" .ts).test.ts"\n'
    const comandos = shellCommands(texto)
    // Nenhum comando falso nasce daqui: o que há é o `basename` de dentro.
    expect(comandos.map((c) => c.programa)).toEqual(["basename"])
    expect(extractSubstitutions(texto).substituicoes).toHaveLength(1)
  })

  it("a definição da função e o PADRÃO de `case` não são comandos", () => {
    const texto = [
      "wait_all() {",
      "  return 0",
      "}",
      'case "$f" in',
      "src/lib/*.ts)",
      "  echo oi",
      "  ;;",
      "esac",
    ].join("\n")
    const comandos = shellCommands(texto)
    expect(comandos.map((c) => c.programa)).toEqual(["return", "echo"])
    expect(isCasePattern("src/lib/*.ts)")).toBe(true)
    expect(definedFunctions("wait_all() {\n}\n")).toEqual(new Set(["wait_all"]))
  })

  it("o redirecionamento não vira um comando (`2>/dev/null`, `&>/dev/null`, `>/tmp/log`)", () => {
    const texto = "git status >/tmp/log 2>/dev/null && echo ok &>/dev/null\n"
    expect(shellCommands(texto).map((c) => c.programa)).toEqual(["git", "echo"])
    expect(programOf([{ tipo: "palavra", valor: "A=1", linha: 1 }])).toBeNull()
  })

  it("continuação de linha (`\\` no fim) mantém o comando inteiro", () => {
    const texto = "node scripts/x.mjs \\\n  --flag\n"
    const comandos = shellCommands(texto)
    expect(comandos).toHaveLength(1)
    expect(comandos[0]!.tokens).toContain("--flag")
  })
})

// ── infraestrutura e cobertura ──────────────────────────────────────────

describe("fail-closed e cobertura", () => {
  it("sem `.husky/` ou sem `package.json` o guard é INDETERMINADO (exit 2), não verde", () => {
    const vazio = mkdtempSync(join(tmpdir(), "hookcommands-vazio-"))
    fixtures.push(vazio)
    expect(analyze({ root: vazio }).infra).toBe(true)
    expect(rodaCli(vazio).status).toBe(EXIT.UNJUDGEABLE)

    const comHook = fixture({ hooks: { "pre-commit": "echo ok\n" } })
    rmSync(join(comHook, "package.json"))
    expect(analyze({ root: comHook }).infra).toBe(true)
  })

  it("o diretório interno do husky (`.husky/_`) NÃO é julgado — são shims gerados", () => {
    const dir = fixture({ hooks: { "pre-commit": "echo ok\n" } })
    mkdirSync(join(dir, HOOKS_DIR, "_"), { recursive: true })
    writeFileSync(join(dir, HOOKS_DIR, "_", "husky.sh"), "node scripts/shim-gerado.mjs\n", "utf8")
    writeFileSync(join(dir, HOOKS_DIR, "_", "pre-commit"), "comando-inexistente-gerado\n", "utf8")

    expect(hookFiles(dir)).toEqual([".husky/pre-commit"])
    expect(relatorio(dir).violacoes).toEqual([])
  })

  it("a SOMA fecha: cada comando julgado tem exatamente um desfecho", () => {
    const dir = fixture({
      hooks: {
        "pre-commit": 'set -eu\nnode scripts/ok.mjs\nnode scripts/errado.mjs\npython3 -c "x"\n',
        "pre-push": "bash scripts/run.sh\n",
      },
      scripts: { typecheck: "node scripts/ok.mjs" },
      arquivos: { "scripts/ok.mjs": "// ok\n", "scripts/run.sh": "#!/usr/bin/env bash\n" },
    })

    const report = relatorio(dir)

    expect(report.comandos.length).toBe(
      report.resolvidos.length + report.indeterminados.length + report.violacoes.length,
    )
    expect(rodaCli(dir, ["--json"]).saida).toContain(`"total": ${report.comandos.length}`)
  })

  it("as listas DECLARADAS são coerentes (nenhum token é builtin e ferramenta ao mesmo tempo)", () => {
    for (const ferramenta of EXTERNAL_TOOLS) expect(INTERPRETERS.has(ferramenta)).toBe(false)
    for (const ferramenta of SOURCE_COMMANDS) expect(EXTERNAL_TOOLS.has(ferramenta)).toBe(false)
    for (const [binario, pacote] of Object.entries(BIN_PACKAGES)) {
      expect(typeof binario).toBe("string")
      expect(typeof pacote).toBe("string")
    }
  })

  it("o REPOSITÓRIO REAL é verde, com o PISO de cobertura (um scanner que não varre nada não passa)", () => {
    // O piso existe para o verde não ser verde por vazio: se a extração parar de
    // funcionar, os comandos julgados vão a zero e o guard "passa".
    const report = relatorio(process.cwd())

    expect(report.infra).toBe(false)
    expect(report.violacoes).toEqual([])
    expect(report.hooks).toEqual([".husky/post-checkout", ".husky/pre-commit", ".husky/pre-push"])
    expect(report.comandos.length).toBeGreaterThanOrEqual(60)
    // Os caminhos que o repositório de fato executa são julgados por NOME.
    const alvos = report.resolvidos.map((r) => r.motivo).join("\n")
    expect(alvos).toContain("scripts/check-workflow-run-syntax.mjs")
    expect(alvos).toContain("scripts/run-encoding-guards.sh")
    expect(alvos).toContain("entrada `typecheck`")
  })
})
