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

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { spawnSync } from "node:child_process"
import { afterAll, describe, expect, it } from "vitest"
import {
  ALLOWLIST,
  BIN_PACKAGES,
  EXIT,
  EXTERNAL_TOOLS,
  FIX_MAX_DISTANCE,
  HOOKS_DIR,
  INDETERMINATE,
  INTERPRETERS,
  SOURCE_COMMANDS,
  analyze,
  aplicarRemendo,
  arquivosDoRemendo,
  atribuicoesDoTexto,
  caminhosProvaveis,
  definedFunctions,
  extractSubstitutions,
  fix,
  hookFiles,
  isCasePattern,
  localizaToken,
  planoDeRemendo,
  programOf,
  renderPlano,
  reviewViolations,
  shellCommands,
  variaveisDoArquivo,
  vizinhoAceito,
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

/** O conteúdo de um arquivo do fixture (o remendo é medido no DISCO). */
const conteudo = (dir: string, rel: string) => readFileSync(join(dir, rel), "utf8")

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

// ── as VARIÁVEIS DE CAMINHO: o alvo do interpretador provado, não declarado ─
//
// `python3 "$PYTHON_SCRIPT"` era uma DECISÃO datada em INDETERMINATE (o guard não
// provava o caminho). Hoje ele lê as atribuições do arquivo — e estas provas
// medem as duas metades: o caminho que RESOLVE (verde por prova, sem nenhuma
// entrada declarada no fixture) e o que continua reprovado (fail-closed quando o
// valor não é estático). A ausência de INDETERMINATE no fixture é o que faz cada
// caso valer: um guard que só declarasse de novo sairia vermelho aqui.

describe("as variáveis de caminho dos scripts são RESOLVIDAS pelas atribuições", () => {
  const SCRIPT_COM_VARIAVEL = [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    'SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"',
    'PYTHON_SCRIPT="$SCRIPT_DIR/check_utf8.py"',
    'python3 "$PYTHON_SCRIPT" "$@"',
    'node "$SCRIPT_DIR/check_utf8.mjs" "$@"',
    "",
  ].join("\n")

  it("PROVA: o `$VAR` do alvo resolve, e o motivo diz de onde veio", () => {
    const dir = fixture({
      hooks: { "pre-commit": "bash scripts/check-utf8.sh\n" },
      arquivos: {
        "scripts/check-utf8.sh": SCRIPT_COM_VARIAVEL,
        "scripts/check_utf8.py": "# existe\n",
        "scripts/check_utf8.mjs": "// existe\n",
      },
    })

    const report = relatorio(dir)

    expect(report.violacoes).toEqual([])
    expect(report.indeterminados).toEqual([])
    const doPython = report.resolvidos.find((r) => r.programa === "python3")
    expect(doPython?.motivo).toContain("pelas atribuições de `$PYTHON_SCRIPT` neste arquivo")
    expect(doPython?.motivo).toContain("`scripts/check_utf8.py`")
    // O mesmo para a referência EMBUTIDA num caminho (`$SCRIPT_DIR/x`), que não é
    // o token inteiro: o `$SCRIPT_DIR` é o idioma do diretório DESTE arquivo.
    const doNode = report.resolvidos.find((r) => r.programa === "node")
    expect(doNode?.motivo).toContain("pelas atribuições de `$SCRIPT_DIR` neste arquivo")
    expect(doNode?.motivo).toContain("`scripts/check_utf8.mjs`")
    expect(rodaCli(dir).status).toBe(EXIT.OK)
  })

  it("PROVA: o alvo provável que NÃO existe é VIOLAÇÃO, e o remendo a RECUSA", () => {
    const dir = fixture({
      hooks: { "pre-commit": "bash scripts/check-utf8.sh\n" },
      arquivos: {
        "scripts/check-utf8.sh": SCRIPT_COM_VARIAVEL.replace("check_utf8.py", "nao-existe.py"),
        "scripts/check_utf8.mjs": "// existe\n",
      },
    })

    const report = relatorio(dir)

    expect(report.violacoes).toHaveLength(1)
    expect(motivos(report)[0]).toContain("`$PYTHON_SCRIPT` provável")
    expect(motivos(report)[0]).toContain("`scripts/nao-existe.py`")
    // Sem `remendo`: não há token de caminho a trocar (a variável pode ter vários
    // valores), e o remendo NOMEIA a recusa em vez de adivinhar o token.
    expect(report.violacoes[0]!.remendo).toBeUndefined()
    const { recusas } = planoDeRemendo(dir)
    expect(recusas.map((r) => r.motivo).join("\n")).toContain("nao-existe.py")
    expect(rodaCli(dir, ["--fix", "--yes"]).status).not.toBe(EXIT.OK)
  })

  it("FAIL-CLOSED: valor não estático continua VIOLAÇÃO (nada foi adivinhado)", () => {
    const dir = fixture({
      hooks: { "pre-commit": "bash scripts/check-utf8.sh\n" },
      arquivos: {
        "scripts/check-utf8.sh": [
          "#!/usr/bin/env bash",
          "set -euo pipefail",
          'PYTHON_SCRIPT="$(date +%s)"',
          'python3 "$PYTHON_SCRIPT"',
          "",
        ].join("\n"),
      },
    })

    const report = relatorio(dir)

    expect(report.violacoes).toHaveLength(1)
    expect(motivos(report)[0]).toContain("INDETERMINATE")
    // O motivo nomeia a VARIÁVEL e a LINHA da atribuição que não é provável — o
    // operador não fica procurando qual valor o guard não conseguiu ler.
    expect(motivos(report)[0]).toContain("`$PYTHON_SCRIPT`")
    expect(rodaCli(dir).status).toBe(EXIT.VIOLATIONS)
  })

  it("o conjunto de RAMOS: o mesmo `$PY` com três valores conhecidos resolve", () => {
    const dir = fixture({
      hooks: { "pre-commit": "bash scripts/check-crlf.sh\n" },
      arquivos: {
        "scripts/check-crlf.sh": [
          "#!/usr/bin/env bash",
          "set -euo pipefail",
          'SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"',
          'PY_SCRIPT="$SCRIPT_DIR/check_crlf.py"',
          "if command -v python3 >/dev/null 2>&1; then",
          '  PY="python3"',
          "elif command -v python >/dev/null 2>&1; then",
          '  PY="python"',
          "else",
          '  PY="node"',
          '  PY_SCRIPT="$SCRIPT_DIR/check_crlf.mjs"',
          "fi",
          '"$PY" "$PY_SCRIPT" --fix',
          "",
        ].join("\n"),
        "scripts/check_crlf.py": "# existe\n",
        "scripts/check_crlf.mjs": "// existe\n",
      },
    })

    const report = relatorio(dir)

    expect(report.violacoes).toEqual([])
    expect(report.indeterminados).toEqual([])
    const doPy = report.resolvidos.find((r) => r.programa === "$PY")
    expect(doPy?.motivo).toContain("→ `python3`, `python`, `node`")
    expect(doPy?.motivo).toContain("e o alvo resolve")
    expect(rodaCli(dir).status).toBe(EXIT.OK)
  })

  it("o ramo com um programa que o guard NÃO conhece derruba o veredito", () => {
    const dir = fixture({
      hooks: { "pre-commit": "bash scripts/check-crlf.sh\n" },
      arquivos: {
        "scripts/check-crlf.sh": [
          "#!/usr/bin/env bash",
          "set -euo pipefail",
          'SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"',
          'PY_SCRIPT="$SCRIPT_DIR/check_crlf.py"',
          'PY="python3"',
          'PY="interpretador-que-ninguem-tem"',
          '"$PY" "$PY_SCRIPT"',
          "",
        ].join("\n"),
        "scripts/check_crlf.py": "# existe\n",
      },
    })

    const report = relatorio(dir)

    expect(report.violacoes).toHaveLength(1)
    expect(motivos(report)[0]).toContain("`interpretador-que-ninguem-tem`")
    expect(rodaCli(dir).status).toBe(EXIT.VIOLATIONS)
  })

  it("o escopo é o ARQUIVO: a variável do hook não vale dentro do script executado", () => {
    // `bash script.sh` cria um processo NOVO: a variável do hook não existe lá
    // dentro (a menos que seja `export`-ada), e resolver por ela seria prometer um
    // caminho que o runtime não tem.
    const dir = fixture({
      hooks: {
        "pre-commit": 'PYTHON_SCRIPT="scripts/check_utf8.py"\nbash scripts/check-utf8.sh\n',
      },
      arquivos: {
        "scripts/check-utf8.sh": '#!/usr/bin/env bash\npython3 "$PYTHON_SCRIPT"\n',
        "scripts/check_utf8.py": "# existe\n",
      },
    })

    const report = relatorio(dir)

    expect(report.violacoes).toHaveLength(1)
    expect(motivos(report)[0]).toContain("não é atribuída neste arquivo")
  })
})

describe("a leitura das atribuições (a régua da resolução, medida em separado)", () => {
  it("a UNIÃO dos ramos, e a linha comentada que não atribui nada", () => {
    const mapa = atribuicoesDoTexto(
      ["# PY=ignorado", 'PY="python3"', "# comentario", 'PY="node"', "export OUTRO=valor", ""].join(
        "\n",
      ),
    )

    expect(mapa.get("PY")?.valores).toEqual(['"python3"', '"node"'])
    expect(mapa.get("PY")?.linhas).toEqual([2, 4])
    expect(mapa.get("OUTRO")?.linhas).toEqual([5])
  })

  it("as formas que viram motivo NOMEADO (nunca um valor adivinhado)", () => {
    const vars = variaveisDoArquivo(
      [
        'SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"',
        'A="$SCRIPT_DIR/x.py"',
        'B="$(comando qualquer)"',
        'C="$A"',
        'D="$E"',
        'E="$D"',
        "VAZIA=",
        "",
      ].join("\n"),
      "scripts/qualquer.sh",
    )
    const razao = (token: string) => {
      const r = caminhosProvaveis(token, vars)
      return r.ok ? "ok" : r.motivo
    }

    // O idioma do diretório DESTE arquivo resolve — e o resto do token entra junto.
    const a = caminhosProvaveis("$A", vars)
    expect(a.ok && a.valores).toEqual(["scripts/x.py"])
    expect(caminhosProvaveis("$C", vars).ok).toBe(true)
    // Substituição de comando, variável não atribuída, ciclo, vazia e parâmetro
    // posicional: cada uma diz POR QUE não dá para provar.
    expect(razao("$B")).toContain("substituição de comando")
    expect(razao("$D")).toContain("ciclo")
    expect(razao("$NAO_EXISTE")).toContain("não é atribuída neste arquivo")
    expect(razao("$VAZIA")).toContain("VAZIA")
    expect(razao("$@")).toContain("parâmetro do shell")
    expect(razao("${NAO_EXISTE[@]}")).toContain("não resolve")
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
    // O PISO subiu com a DESCIDA: os hooks sozinhos são ~100 comandos; o runner
    // de encoding e os quatro `check-*.sh` que ele chama somam o resto. Sem o
    // piso novo, uma descida que parasse de funcionar deixaria o guard verde com
    // o número antigo — verde por ter varrido menos.
    expect(report.comandos.length).toBeGreaterThanOrEqual(200)
    expect(report.scripts).toContain("scripts/run-encoding-guards.sh")
    expect(report.scripts).toContain("scripts/check-utf8.sh")
    // Os caminhos que o repositório de fato executa são julgados por NOME.
    const alvos = report.resolvidos.map((r) => r.motivo).join("\n")
    expect(alvos).toContain("scripts/check-workflow-run-syntax.mjs")
    expect(alvos).toContain("scripts/run-encoding-guards.sh")
    expect(alvos).toContain("entrada `typecheck`")
  })
})

// ── a DESCIDA: o que os scripts que o hook CHAMA executam por dentro ───────
//
// O hook real não lista os 17 guards de encoding: ele chama UM runner
// (`bash scripts/run-encoding-guards.sh`) que chama os outros. Parar no ALVO do
// `bash` deixava uma linha tipada DENTRO do runner como o mesmo passo-que-nunca-
// roda — invisível, num arquivo que roda em todo commit. Cada metade da descida
// tem aqui a sua prova e o seu CONTROLE: a transitividade, o ciclo, o teto, o
// escopo das funções (que depende da FORMA da chamada), os padrões de um `case`,
// o `$( )` que NÃO executa (comentário e aspas simples) e o `<( ... )` que
// executa.

describe("a descida nos scripts de shell que o hook chama", () => {
  it("PROVA: o caminho tipado DENTRO do script chamado é VIOLAÇÃO, com a proveniência", () => {
    const dir = fixture({
      hooks: { "pre-commit": "set -eu\nbash scripts/run-ci.sh\n" },
      arquivos: {
        "scripts/run-ci.sh": "#!/usr/bin/env bash\nnode scripts/check-utf8-scopez.mjs\n",
        "scripts/check-utf8-scope.mjs": "// o vizinho existe\n",
      },
    })

    const report = relatorio(dir)

    expect(report.scripts).toEqual(["scripts/run-ci.sh"])
    expect(report.violacoes).toHaveLength(1)
    // O relatório aponta para o ARQUIVO e a LINHA do defeito (o script), e a
    // `origem` diz de qual hook ele veio — sem isso a mensagem mandaria o
    // operador procurar a linha errada no arquivo errado.
    expect(report.violacoes[0]!.arquivo).toBe("scripts/run-ci.sh")
    expect(report.violacoes[0]!.linha).toBe(2)
    expect(report.violacoes[0]!.origem).toBe(".husky/pre-commit:2")
  })

  it("CONTROLE: o mesmo fixture com o caminho CERTO dentro do script é verde", () => {
    const dir = fixture({
      hooks: { "pre-commit": "set -eu\nbash scripts/run-ci.sh\n" },
      arquivos: {
        "scripts/run-ci.sh": "#!/usr/bin/env bash\nnode scripts/check-utf8-scope.mjs\n",
        "scripts/check-utf8-scope.mjs": "// ok\n",
      },
    })

    const report = relatorio(dir)

    expect(report.violacoes).toEqual([])
    expect(report.scripts).toEqual(["scripts/run-ci.sh"])
  })

  it("a descida é TRANSITIVA (script → script) e o teto é NOMEADO quando morde", () => {
    // hook → s1 → s2 → s3 → s4 → s5: o teto é 4 níveis A PARTIR do hook, então o
    // que está além dele tem de ser DITO (`limites`), nunca pulado em silêncio.
    const arquivos: Record<string, string> = {}
    for (let n = 1; n <= 5; n++) {
      arquivos[`scripts/s${n}.sh`] = `#!/usr/bin/env bash\nbash scripts/s${n + 1}.sh\n`
    }
    arquivos["scripts/s6.sh"] = "#!/usr/bin/env bash\necho fim\n"
    const dir = fixture({
      hooks: { "pre-commit": "set -eu\nbash scripts/s1.sh\n" },
      arquivos,
    })

    const report = relatorio(dir)

    expect(report.violacoes).toEqual([])
    expect(report.scripts).toEqual([
      "scripts/s1.sh",
      "scripts/s2.sh",
      "scripts/s3.sh",
      "scripts/s4.sh",
    ])
    expect(report.limites).toHaveLength(1)
    expect(report.limites[0]!.motivo).toContain("PROFUNDIDADE")
    expect(report.limites[0]!.alvo).toBe("scripts/s5.sh")
  })

  it("CICLO: a descida TERMINA e o ciclo é NOMEADO (nunca um travamento nem um silêncio)", () => {
    const dir = fixture({
      hooks: { "pre-commit": "set -eu\nbash scripts/a.sh\n" },
      arquivos: {
        "scripts/a.sh": "#!/usr/bin/env bash\nbash scripts/b.sh\n",
        "scripts/b.sh": "#!/usr/bin/env bash\nbash scripts/a.sh\n",
      },
    })

    const report = relatorio(dir)

    expect(report.violacoes).toEqual([])
    expect(report.scripts).toEqual(["scripts/a.sh", "scripts/b.sh"])
    expect(report.limites.map((l) => l.motivo).join("\n")).toContain("CICLO")
  })

  it("as FUNÇÕES VISÍVEIS seguem a FORMA da chamada: `bash` não herda, `source` herda", () => {
    // É a semântica do shell, e ela decide um veredito: `bash script.sh` cria um
    // processo NOVO (a função do hook não existe lá dentro), `source` roda no
    // MESMO shell (herda). Herdar sempre deixaria um `command not found` passar
    // como resolvido dentro do script.
    const corpo = "#!/usr/bin/env bash\nminha_funcao\n"
    const hook = "minha_funcao() {\n  echo ok\n}\nbash scripts/x.sh\n"
    const execDir = fixture({ hooks: { "pre-commit": hook }, arquivos: { "scripts/x.sh": corpo } })
    const srcDir = fixture({
      hooks: { "pre-commit": hook.replace("bash scripts/x.sh", "source scripts/x.sh") },
      arquivos: { "scripts/x.sh": corpo },
    })

    const execReport = relatorio(execDir)
    expect(execReport.violacoes).toHaveLength(1)
    expect(execReport.violacoes[0]!.arquivo).toBe("scripts/x.sh")
    expect(execReport.violacoes[0]!.motivo).toContain("minha_funcao")

    // CONTROLE: com o MESMO defeito (`minha_funcao` não definida no script), o
    // `source` resolve — o que mudou foi a forma da chamada, e nada mais.
    expect(relatorio(srcDir).violacoes).toEqual([])
  })

  it("os PADRÕES de um `case` não são comandos — e o CORPO dele É julgado", () => {
    const script =
      "#!/usr/bin/env bash\n" +
      'case "$1" in\n' +
      "  --ci) MODE=ci ;;\n" +
      "  -h | --help)\n" +
      "    echo usage\n" +
      "    exit 0\n" +
      "    ;;\n" +
      "  *)\n" +
      "    node scripts/typo.mjs\n" +
      "    ;;\n" +
      "esac\n" +
      "exit 0\n"
    const dir = fixture({
      hooks: { "pre-commit": "set -eu\nbash scripts/args.sh\n" },
      arquivos: { "scripts/args.sh": script },
    })

    const report = relatorio(dir)
    const programas = report.comandos.map((c) => c.programa)

    // O `case` NÃO é um buraco de cobertura: o corpo do ramo é julgado.
    expect(report.violacoes.map((v) => `${v.arquivo}:${v.linha}`)).toEqual(["scripts/args.sh:9"])
    // E os padrões (com `)` colado e com `|` entre eles) não viram programa.
    for (const padrao of ["--ci)", "-h", "--help)", "*)"]) expect(programas).not.toContain(padrao)
    // O `exit 0` DEPOIS do `esac` continua julgado (o fim do `case` não engole o
    // resto do arquivo).
    expect(report.comandos.some((c) => c.programa === "exit" && c.linha === 12)).toBe(true)
  })

  it("o `$( )` de um COMENTÁRIO e o de ASPAS SIMPLES não são comandos; o real É", () => {
    const dir = fixture({
      hooks: { "pre-commit": "set -eu\nbash scripts/x.sh\n" },
      arquivos: {
        "scripts/x.sh":
          "#!/usr/bin/env bash\n" +
          "# exemplo: out=$(node scripts/typo-do-comentario.mjs) na mesma linha\n" +
          "echo 'literal: $(node scripts/typo-em-aspas.mjs)'\n" +
          "VALOR=$(node scripts/ok.mjs)\n",
        "scripts/ok.mjs": "// ok\n",
      },
    })

    const report = relatorio(dir)

    expect(report.violacoes).toEqual([])
    // O que EXECUTA é julgado (e resolve): a substituição real não pode sumir
    // junto com as duas que não executam nada.
    expect(report.resolvidos.map((r) => r.motivo).join("\n")).toContain("scripts/ok.mjs")
    expect(report.comandos.length).toBeGreaterThan(2)
  })

  it("o comando de dentro de um `<( ... )` É julgado, e o `)` colado não vira programa", () => {
    const dir = fixture({
      hooks: { "pre-commit": "set -eu\nbash scripts/x.sh\n" },
      arquivos: {
        "scripts/x.sh":
          "#!/usr/bin/env bash\nmapfile -t FILES < <(git ls-files 'scripts/' | grep -E 'x' || true)\n",
      },
    })

    const report = relatorio(dir)
    const programas = report.comandos.map((c) => c.programa)

    expect(programas).toContain("git")
    expect(programas).toContain("grep")
    // `true)` é o tokenizador colando o `)` de fechamento: um nome terminado em
    // `)` não é um comando (em shell isso é erro de sintaxe).
    expect(programas).not.toContain("true)")
    expect(report.violacoes).toEqual([])
  })

  it("PROGRAMA montado em runtime: PROVADO quando as atribuições provam, violação quando não", () => {
    // Acusar `$INTERPRETE` de "não ser arquivo do repositório" seria falso duas
    // vezes (não é um nome) e travaria um merge legítimo. O guard prova o que der
    // para provar pelas ATRIBUIÇÕES do arquivo (as três são interpretadores
    // declarados, e o alvo existe) e, quando não dá, mantém `indeterminado` +
    // declaração datada. Sem a declaração, é violação (fail-closed, medido no
    // primeiro CONTROLE abaixo).
    const naoDeclarado = fixture({
      hooks: { "pre-commit": "set -eu\nbash scripts/x.sh\n" },
      arquivos: { "scripts/x.sh": '#!/usr/bin/env bash\n"$INTERPRETE" "$ALVO"\n' },
    })

    const report = relatorio(naoDeclarado)

    expect(report.violacoes).toHaveLength(1)
    expect(report.violacoes[0]!.motivo).toContain("programa montado em runtime")
    expect(report.violacoes[0]!.motivo).toContain("decisão nao declarada")
    // O motivo diz POR QUE não provou — e nomeia a variável que falta.
    expect(report.violacoes[0]!.motivo).toContain(
      "a variável `INTERPRETE` não é atribuída neste arquivo",
    )

    // CONTROLE (a outra direção): com as atribuições do REPOSITÓRIO
    // (`"$PY" "$PY_SCRIPT" --fix` nos dois check-*.sh) o mesmo comando RESOLVE —
    // é a resolução que sustenta o verde, e nenhuma entrada de INDETERMINATE
    // precisa cobri-lo.
    const provado = fixture({
      hooks: { "pre-commit": "set -eu\nbash scripts/x.sh\n" },
      arquivos: {
        "scripts/x.sh": [
          "#!/usr/bin/env bash",
          'SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"',
          'PY_SCRIPT="$SCRIPT_DIR/check_crlf.py"',
          'PY="python3"',
          '"$PY" "$PY_SCRIPT" --fix',
          "",
        ].join("\n"),
        "scripts/check_crlf.py": "# existe\n",
      },
    })
    const provados = relatorio(provado)
    expect(provados.violacoes).toEqual([])
    expect(provados.indeterminados).toEqual([])
    expect(provados.resolvidos.find((r) => r.programa === "$PY")?.motivo).toContain(
      "e o alvo resolve",
    )
    // E a lista de DECISÕES não carrega mais o texto do repositório: o que era
    // declaração virou prova.
    expect(INDETERMINATE.some((e) => "$PY $PY_SCRIPT".startsWith(e.match))).toBe(false)
  })

  it("a SOMA fecha com a descida junto (nenhum comando descido escapa da conta)", () => {
    const dir = fixture({
      hooks: { "pre-commit": "set -eu\nbash scripts/run.sh\n" },
      arquivos: {
        "scripts/run.sh": "#!/usr/bin/env bash\nnode scripts/ok.mjs\nnode scripts/errado.mjs\n",
        "scripts/ok.mjs": "// ok\n",
      },
    })

    const report = relatorio(dir)

    expect(report.comandos.length).toBe(
      report.resolvidos.length + report.indeterminados.length + report.violacoes.length,
    )
    expect(report.comandos.filter((c) => c.arquivo === "scripts/run.sh")).toHaveLength(2)
    const json = JSON.parse(rodaCli(dir, ["--json"]).saida)
    expect(json.scripts).toEqual(["scripts/run.sh"])
    expect(json.limites).toEqual([])
  })

  it("o remendo NÃO escreve num script chamado — e a recusa é NOMEADA, no arquivo do script", () => {
    const script = "#!/usr/bin/env bash\nnode scripts/check-utf8-scopez.mjs\n"
    const dir = fixture({
      hooks: { "pre-commit": "set -eu\nbash scripts/run-ci.sh\n" },
      arquivos: { "scripts/run-ci.sh": script, "scripts/check-utf8-scope.mjs": "// vizinho\n" },
    })

    const { plano, recusas } = planoDeRemendo(dir)

    expect(plano).toEqual([])
    expect(recusas).toHaveLength(1)
    expect(recusas[0]!.arquivo).toBe("scripts/run-ci.sh")
    expect(recusas[0]!.motivo).toContain("não é um hook")
    // O arquivo do script fica BYTE A BYTE: o remendo deste guard escreve em
    // `.husky/`, e o defeito de um script se corrige no próprio script.
    expect(conteudo(dir, "scripts/run-ci.sh")).toBe(script)
  })
})

// ── o REMENDO: o caminho tipado, trocado pelo vizinho INEQUÍVOCO ────────────
//
// O guard já diz QUAL era o nome esperado ("o mais próximo é `X`"); o `--fix`
// fecha a distância entre a diagnose e o conserto. O que esta suíte mede é o que
// distingue um remendo de uma adivinhação:
//   · o plano NÃO grava nada (ele é o que a pergunta autoriza);
//   · a troca é CIRÚRGICA (o resto do arquivo fica byte a byte — um hook é um
//     arquivo de comentários que explicam decisões);
//   · o que não é caminho (a entrada de `bun run`), o que EMPATA e o que está
//     longe demais entram como RECUSA com motivo, nunca em silêncio;
//   · a CONTA fecha: as violações caem exatamente no número de trocas;
//   · sem terminal, NADA é gravado (fail-closed) — e a recusa também não grava.

describe("o remendo (`--fix`): o vizinho mais próximo, com a conta fechando", () => {
  it("PROVA: troca SÓ o token — o resto do arquivo fica byte a byte", async () => {
    const hook =
      "set -eu\n# comentário que explica uma decisão\nnode scripts/check-bun-mirrorX.mjs --staged &\nbun run typecheck\n"
    const dir = fixture({
      hooks: { "pre-commit": hook },
      scripts: { typecheck: "node scripts/typecheck.mjs" },
      arquivos: { "scripts/check-bun-mirror.mjs": "// ok\n", "scripts/typecheck.mjs": "// ok\n" },
    })

    const { plano, recusas } = planoDeRemendo(dir)
    expect(plano).toEqual([
      {
        arquivo: ".husky/pre-commit",
        linha: 3,
        de: "scripts/check-bun-mirrorX.mjs",
        para: "scripts/check-bun-mirror.mjs",
        papel: "script do node",
        distancia: 1,
      },
    ])
    expect(recusas).toEqual([])
    // O PLANO não grava: quem grava é o "sim".
    expect(conteudo(dir, ".husky/pre-commit")).toBe(hook)
    expect(renderPlano(dir, { plano, recusas })).toContain(
      "antes:  node scripts/check-bun-mirrorX.mjs --staged &",
    )
    expect(renderPlano(dir, { plano, recusas })).toContain(
      "depois: node scripts/check-bun-mirror.mjs --staged &",
    )

    const r = await fix(dir, { yes: true, log: () => {} })

    expect(r.code).toBe(EXIT.OK)
    expect(r.antes).toBe(1)
    expect(r.aplicados.length).toBe(1)
    expect(r.depois).toBe(0)
    expect(r.arquivos).toEqual([".husky/pre-commit"])
    expect(conteudo(dir, ".husky/pre-commit")).toBe(hook.replace("X.mjs", ".mjs"))
  })

  it("o que NÃO é caminho entra como RECUSA com motivo (a entrada de `bun run`)", async () => {
    // Trocar uma entrada de `scripts` por outra MUDA o que o hook executa —
    // `bun run <binário>` e `bun run <script>` não são a mesma coisa. O remendo
    // recusa, DIZ por quê, e o arquivo não é tocado.
    const hook = "bun run tipecheck\n"
    const dir = fixture({
      hooks: { "pre-commit": hook },
      scripts: { typecheck: "node scripts/t.mjs" },
      arquivos: { "scripts/t.mjs": "// ok\n" },
    })

    const { plano, recusas } = planoDeRemendo(dir)
    expect(plano).toEqual([])
    expect(recusas.length).toBe(1)
    expect(recusas[0].motivo).toContain("não é um caminho")

    const r = await fix(dir, { yes: true, log: () => {} })
    expect(r.code).toBe(EXIT.VIOLATIONS)
    expect(r.aplicados).toEqual([])
    expect(conteudo(dir, ".husky/pre-commit")).toBe(hook)
  })

  it("a violação que vive em OUTRO arquivo NÃO é remendada", () => {
    // A linha de um comando INTERNO (o que uma entrada de `bun run` executa) é a
    // linha 1 do TEXTO do script do package.json (o resolvedor normaliza o texto
    // da entrada), e o `arquivo` da linha do relatório é o HOOK. Aqui o hook tem o
    // MESMO token na linha 1, dentro de um comentário — a coincidência exata em
    // que um remendo sem escopo reescreveria um comentário por causa de um defeito
    // que vive em outro arquivo.
    //
    // Esta é a prova do DESFECHO (a recusa nomeia a origem e o arquivo fica byte a
    // byte). A prova de que a regra é LOAD-BEARING — que sem ela o comentário cai
    // — é a mutação M8 do `test-mutation-hook-commands.sh`, porque só ela pode
    // tirar a regra do lugar.
    const hook = "# node scripts/typo.mjs\nbun run x\n"
    const dir = fixture({ hooks: { "pre-commit": hook }, scripts: { x: "node scripts/typo.mjs" } })

    const { plano, recusas } = planoDeRemendo(dir)
    expect(plano).toEqual([])
    expect(recusas.map((r) => r.motivo).join("\n")).toContain("package.json scripts.x")

    return fix(dir, { yes: true, log: () => {} }).then((r) => {
      expect(r.code).toBe(EXIT.VIOLATIONS)
      expect(r.aplicados).toEqual([])
      // O comentário e o resto do hook ficam byte a byte.
      expect(conteudo(dir, ".husky/pre-commit")).toBe(hook)
    })
  })

  it("EMPATE de vizinhos e distância grande demais são RECUSA — o remendo não adivinha", () => {
    const empate = fixture({
      hooks: { "pre-commit": "node scripts/abc.mjs\n" },
      arquivos: { "scripts/abd.mjs": "// ok\n", "scripts/abe.mjs": "// ok\n" },
    })
    const e = planoDeRemendo(empate)
    expect(e.plano).toEqual([])
    expect(e.recusas[0].motivo).toContain("EMPATE")
    expect(e.recusas[0].motivo).toContain("`scripts/abd.mjs`")

    const longe = fixture({
      hooks: { "pre-commit": "node scripts/uma-coisa-bem-diferente.mjs\n" },
      arquivos: { "scripts/outra.mjs": "// ok\n" },
    })
    const l = planoDeRemendo(longe)
    expect(l.plano).toEqual([])
    expect(l.recusas[0].motivo).toContain(`até ${FIX_MAX_DISTANCE} caractere(s)`)
  })

  it("SEM TERMINAL não pergunta e NÃO grava (fail-closed, com o caminho à mão)", async () => {
    const hook = "node scripts/check-xX.mjs\n"
    const dir = fixture({
      hooks: { "pre-commit": hook },
      arquivos: { "scripts/check-x.mjs": "// ok\n" },
    })
    const linhas: string[] = []
    const r = await fix(dir, {
      isTTY: false,
      openTty: () => null,
      log: (m: string) => linhas.push(m),
    })

    expect(r.code).toBe(EXIT.VIOLATIONS)
    expect(r.aplicados).toEqual([])
    expect(r.motivo).toBe("sem terminal")
    expect(linhas.join("\n")).toContain("SEM TERMINAL")
    expect(linhas.join("\n")).toContain("NADA foi gravado")
    expect(conteudo(dir, ".husky/pre-commit")).toBe(hook)
  })

  it("a recusa do operador (`n` na pergunta) não toca no arquivo", async () => {
    const hook = "node scripts/check-xX.mjs\n"
    const dir = fixture({
      hooks: { "pre-commit": hook },
      arquivos: { "scripts/check-x.mjs": "// ok\n" },
    })
    const r = await fix(dir, { isTTY: false, askFn: async () => "n", log: () => {} })

    expect(r.code).toBe(EXIT.VIOLATIONS)
    expect(r.motivo).toContain("recusa")
    expect(conteudo(dir, ".husky/pre-commit")).toBe(hook)
  })

  it("aplicada a remendável, a que SOBRA mantém o commit bloqueado (exit 1) e a conta fecha", async () => {
    const dir = fixture({
      hooks: { "pre-commit": "node scripts/check-xX.mjs\nnode scripts/sem-vizinho-nenhum.mjs\n" },
      arquivos: { "scripts/check-x.mjs": "// ok\n" },
    })

    const r = await fix(dir, { isTTY: false, askFn: async () => "s", log: () => {} })

    expect(r.code).toBe(EXIT.VIOLATIONS)
    expect(r.antes).toBe(2)
    expect(r.aplicados.length).toBe(1)
    expect(r.depois).toBe(1)
    expect(conteudo(dir, ".husky/pre-commit")).toContain("scripts/check-x.mjs")
    expect(conteudo(dir, ".husky/pre-commit")).toContain("scripts/sem-vizinho-nenhum.mjs")
  })

  it("a árvore VERDE não ganha remendo nenhum (e diz que não havia nada)", async () => {
    const hook = "node scripts/check-x.mjs\n"
    const dir = fixture({
      hooks: { "pre-commit": hook },
      arquivos: { "scripts/check-x.mjs": "// ok\n" },
    })
    const linhas: string[] = []
    const r = await fix(dir, { isTTY: false, log: (m: string) => linhas.push(m) })

    expect(r.code).toBe(EXIT.OK)
    expect(r.aplicados).toEqual([])
    expect(linhas.join("\n")).toContain("nada a remendar")
    expect(conteudo(dir, ".husky/pre-commit")).toBe(hook)
  })

  it("o `--json` publica o MESMO plano que o `--fix` usaria (o remédio não re-deriva)", () => {
    const dir = fixture({
      hooks: { "pre-commit": "node scripts/check-xX.mjs\n" },
      arquivos: { "scripts/check-x.mjs": "// ok\n" },
    })
    const r = rodaCli(dir, ["--json"])
    const saida = JSON.parse(r.saida)

    expect(saida.ok).toBe(false)
    expect(saida.remendos).toEqual([
      {
        arquivo: ".husky/pre-commit",
        linha: 1,
        de: "scripts/check-xX.mjs",
        para: "scripts/check-x.mjs",
        papel: "script do node",
        distancia: 1,
      },
    ])
    expect(saida.remendosRecusados).toEqual([])
  })

  it("uso inválido sai 3 (o comando não interpreta o que ele não promete)", () => {
    const dir = fixture({ hooks: { "pre-commit": "echo ok\n" } })

    for (const args of [["--fix", "--json"], ["--fix", "--list"], ["--yes"], ["--flag-nova"]]) {
      const r = rodaCli(dir, args)
      expect(r.status, `${args.join(" ")} devia sair 3`).toBe(EXIT.USAGE)
    }
    expect(rodaCli(dir, ["--fix", "--json"]).saida).toContain("--fix")
  })
})

describe("a LOCALIZAÇÃO do token (o que faz a escrita ser cirúrgica)", () => {
  it("acha o token na linha lógica e recusa quando ele aparece duas vezes", () => {
    const fonte = "a\nnode scripts/x.mjs && node scripts/x.mjs\nb\n"
    // Duas ocorrências na mesma linha: o remendo não escolhe QUAL é.
    expect(localizaToken(fonte, 2, "scripts/x.mjs")).toBeNull()

    const uma = "a\nnode scripts/xX.mjs --staged\nb\n"
    const span = localizaToken(uma, 2, "scripts/xX.mjs")
    expect(span).not.toBeNull()
    expect(uma.slice(span?.inicio ?? 0, span?.fim ?? 0)).toBe("scripts/xX.mjs")
  })

  it("a CONTINUAÇÃO de linha é a MESMA linha lógica (o token vale na linha seguinte)", () => {
    const fonte = "set -eu\nnode \\\n  scripts/xX.mjs --staged\n"
    const span = localizaToken(fonte, 2, "scripts/xX.mjs")
    expect(span).not.toBeNull()
    expect(fonte.slice(span?.inicio ?? 0, span?.fim ?? 0)).toBe("scripts/xX.mjs")
  })

  it("um token COLADO a outros caracteres de caminho não é o mesmo token", () => {
    // `scripts/x.mjs.bak` NÃO é `scripts/x.mjs`: trocar ali deixaria `.bak`.
    expect(localizaToken("node scripts/x.mjs.bak\n", 1, "scripts/x.mjs")).toBeNull()
    expect(localizaToken("node scripts/x.mjs\n", 1, "scripts/x.mjs")).not.toBeNull()
  })

  it("`aplicarRemendo` é all-or-nothing por ARQUIVO: uma troca impronunciável não grava as outras", () => {
    const fonte = "node scripts/x.mjs && node scripts/x.mjs\n"
    const dir = fixture({
      hooks: { "pre-commit": fonte },
      arquivos: { "scripts/x.mjs": "// ok\n" },
    })
    const r = aplicarRemendo(dir, [
      {
        arquivo: ".husky/pre-commit",
        linha: 1,
        de: "scripts/x.mjs",
        para: "scripts/y.mjs",
        papel: "x",
        distancia: 1,
      },
    ])
    expect(r.aplicados).toEqual([])
    expect(r.recusados[0].motivo).toContain("NÃO foi tocado")
    expect(conteudo(dir, ".husky/pre-commit")).toBe(fonte)
  })

  it("o vizinho aceito é o ÚNICO a até FIX_MAX_DISTANCE (e o empate não é escolha)", () => {
    expect(vizinhoAceito("abc.mjs", ["abd.mjs", "outra-bem-longe.mjs"])).toEqual({
      aceito: { nome: "abd.mjs", distancia: 1 },
      ambiguos: [],
    })
    expect(vizinhoAceito("abc.mjs", ["abd.mjs", "abe.mjs"]).aceito).toBeNull()
    expect(vizinhoAceito("abc.mjs", ["abd.mjs", "abe.mjs"]).ambiguos).toEqual([
      "abd.mjs",
      "abe.mjs",
    ])
    expect(vizinhoAceito("abc.mjs", ["z-z-z-z-z.mjs"]).aceito).toBeNull()
  })

  it("`arquivosDoRemendo` devolve os arquivos UMA vez cada, ordenados", () => {
    expect(
      arquivosDoRemendo([
        { arquivo: "b.sh", linha: 1, de: "x", para: "y", papel: "p", distancia: 1 },
        { arquivo: "a.sh", linha: 1, de: "x", para: "y", papel: "p", distancia: 1 },
        { arquivo: "b.sh", linha: 2, de: "x", para: "y", papel: "p", distancia: 1 },
      ]),
    ).toEqual(["a.sh", "b.sh"])
  })
})
