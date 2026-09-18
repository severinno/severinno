// =============================================================================
// check-pipefail-sigpipe.test.ts
//
// Testes do scripts/check-pipefail-sigpipe.mjs — o guard da classe SIGPIPE.
//
// O que precisa ser provado (o guard pode "parecer" certo e mentir):
//   1. o GATILHO é o pipefail, não o texto: `echo "$X" | grep -q Y` sem pipefail
//      NÃO é a classe (lá a soma do pipeline é o status do grep) e não pode ser
//      acusado; `set +o pipefail` também não;
//   2. o `q` da flag é o que importa (`-q`, `-Fq`, `-qE`, `-wq`, `--quiet`), e um
//      grep comum no pipe NÃO é violação;
//   3. o REMÉDIO sai correto (é o valor do guard): `echo "$X"` → `<<< "$X"`,
//      variável solta → `<<< "$X"`, produtor vivo → `<<< "$(...)"`, e a CADEIA
//      inteira entra na captura quando há mais de um pipe;
//   4. o comando vem do CÓDIGO, não do texto: continuação de linha entra junta e
//      corpo de HEREDOC é pulado (senão o guard acusaria os próprios fixtures);
//   5. a varredura cobre as DUAS forjas e o `.husky/`, e o pipefail do workflow
//      vem do `shell: bash` (o runner liga `-eo pipefail`) ou do próprio corpo;
//   6. o baseline não ESCONDE crescimento: cota igual passa, uma ocorrência acima
//      falha, cota sobrando é reportada como redução.
//
// Sem docker, sem rede, sem executar gate: as funções puras + fixtures em tmpdir.
// =============================================================================

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterAll, describe, expect, it } from "vitest"

import {
  EXIT,
  BASELINE_PATH,
  baselineAgeDays,
  baselineProblems,
  compareWithBaseline,
  countsByFile,
  findQuietPipes,
  findViolations,
  fixCommand,
  githubExpressions,
  fixFirstQuietPipe,
  fixSource,
  hasPipefail,
  isQuietGrepFlag,
  isShellScript,
  lastSimpleCommand,
  listShellScripts,
  logicalCommands,
  scanRoot,
  splitPipelines,
  suggestHerestring,
  shellEnablesPipefail,
  textoDividaVencida,
  truncateAtControl,
  workflowDefaultShells,
  workflowRunSteps,
  writeBaseline,
} from "../../../scripts/check-pipefail-sigpipe.mjs"
import { DEFAULT_REVIEW_DAYS } from "../../../scripts/allowlist-review.mjs"

/** O retorno do `.mjs` chega como `object`: o teste estreita o que ele lê. */
type Violacao = {
  file: string
  line: number
  text: string
  suggestion: string
  context?: "pipefail" | "shell-default" | "shell-declared"
}

type Premissa = {
  file: string
  line: number
  scope: "workflow" | "job"
  job: string | null
  shell: string
  passos: number
}

type ResultadoScan = {
  files: string[]
  violations: Violacao[]
  premissas: Premissa[]
  ilegiveis: { file: string; line: number; scope: string; job: string | null; shell: string }[]
  scanned: {
    shellScripts: number
    shellScriptsComPipefail: number
    workflows: number
    runStepsComPipefail: number
    runStepsSemPipefail: number
    passosDoRunner: number
    passosComDefaultDeclarado: number
    passosComShellNoPasso: number
    defaultShellsEmPipefail: number
  }
}

function scan(dir: string): ResultadoScan {
  return scanRoot(dir) as unknown as ResultadoScan
}

/** Fixture com UMA violação real (o caso que a classe descreve). */
function violacaoDir(): string {
  const dir = makeDir()
  escrever(
    dir,
    "scripts/violacao.sh",
    '#!/usr/bin/env bash\nset -euo pipefail\nOUT=$(x)\nif ! echo "$OUT" | grep -Fq "ok"; then\n  exit 1\nfi\n',
  )
  return dir
}

const tmpDirs: string[] = []

function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "pipefail-sigpipe-"))
  tmpDirs.push(dir)
  return dir
}

function escrever(dir: string, rel: string, conteudo: string): void {
  const abs = join(dir, rel)
  mkdirSync(join(abs, ".."), { recursive: true })
  writeFileSync(abs, conteudo)
}

afterAll(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

// ── o gatilho: pipefail ───────────────────────────────────────────────────

describe("hasPipefail — o gatilho é a DECLARAÇÃO, não a presença do texto", () => {
  it("reconhece as formas que LIGAM o modo (flag com -o em qualquer posição)", () => {
    for (const linha of [
      "set -euo pipefail",
      "set -uo pipefail",
      "set -o pipefail",
      "set -e -u -o pipefail",
      "set -euo pipefail   # liga o modo",
    ]) {
      expect(hasPipefail(linha), linha).toBe(true)
    }
  })

  it("recusa o que NÃO liga o modo — inclusive o `set +o` que DESLIGA", () => {
    for (const linha of [
      "set -eu",
      "set -e",
      "",
      "# set -euo pipefail",
      "set +o pipefail",
      'echo "pipefail"',
      "  # a flag -o pipefail importa",
    ]) {
      expect(hasPipefail(linha), JSON.stringify(linha)).toBe(false)
    }
  })
})

describe("isQuietGrepFlag — só o `q` fecha o stdin no primeiro casamento", () => {
  it("reconhece as flags quietas, combinadas ou longas", () => {
    for (const flag of ["-q", "-Fq", "-qE", "-wq", "-Fiq", "-qx", "--quiet", "--silent"]) {
      expect(isQuietGrepFlag(flag), flag).toBe(true)
    }
  })

  it("não confunde grep comum (que lê tudo) com o quieto", () => {
    for (const flag of ["-F", "-E", "-i", "-n", "-v", "-c", "-e", "--color"]) {
      expect(isQuietGrepFlag(flag), flag).toBe(false)
    }
  })
})

// ── a mecânica do comando ─────────────────────────────────────────────────

describe("splitPipelines / truncateAtControl — o que é pipe e o que é controle", () => {
  it("não quebra no `||` (operador lógico) nem dentro de quotes", () => {
    expect(splitPipelines('a || b | grep -q "x|y"')).toEqual(["a || b ", ' grep -q "x|y"'])
  })

  it("corta o `; then` que vem depois do comando", () => {
    expect(truncateAtControl(' grep -q "x"; then')).toBe(' grep -q "x"')
    expect(truncateAtControl(' grep -q "x" && echo ok')).toBe(' grep -q "x" ')
    expect(truncateAtControl(' grep -q "a;b"')).toBe(' grep -q "a;b"')
  })
})

describe("lastSimpleCommand — o produtor é o comando, não a estrutura", () => {
  it("tira as palavras de controle e o que vem antes de && / ||, mantendo a cadeia", () => {
    expect(lastSimpleCommand('if echo "$OUT" ')).toBe('echo "$OUT"')
    expect(lastSimpleCommand("elif [ -d x ] && ls y ")).toBe("ls y")
    expect(lastSimpleCommand('if ! echo "$A" ')).toBe('echo "$A"')
    expect(lastSimpleCommand('netstat -ano | grep ":80" ')).toBe('netstat -ano | grep ":80"')
  })
})

describe("findQuietPipes — o que o guard acusa (e o que deixa passar)", () => {
  it("acha o pipe quieto e devolve o produtor e o texto do grep", () => {
    const [pipa] = findQuietPipes('if ! echo "$OUT" | grep -Fq "ok"; then')
    expect(pipa.producer).toBe('echo "$OUT"')
    expect(pipa.grepText).toBe('grep -Fq "ok"')
  })

  it("ignora grep de leitura completa (sem `q`) — não é a classe", () => {
    expect(findQuietPipes('echo "$OUT" | grep "ok"')).toEqual([])
    expect(findQuietPipes('echo "$OUT" | grep -n "ok"')).toEqual([])
  })

  it("ignora pipe cujo leitor não é grep (o SIGPIPE não é observado como gate)", () => {
    expect(findQuietPipes('echo "$OUT" | head -1')).toEqual([])
  })

  it("atravessa prefixos de comando (sudo/command) e a cadeia de pipes", () => {
    const [pipa] = findQuietPipes('echo "$OUT" | sudo grep -q "x"')
    // O prefixo sai do remédio: `sudo grep -q "x" <<< ...` seria uma sugestão
    // que o operador teria de consertar à mão.
    expect(pipa.grepText).toBe('grep -q "x"')
    const [encadeado] = findQuietPipes('netstat -ano | grep ":80" | grep -qi "LISTEN"')
    expect(encadeado.grepText).toBe('grep -qi "LISTEN"')
    // O produtor é a CADEIA: sem o `netstat` dentro da captura o grep perde a
    // entrada, e o remédio sugerido seria um defeito novo.
    expect(encadeado.producer).toBe('netstat -ano | grep ":80"')
  })
})

describe("suggestHerestring — o remédio é o valor do guard", () => {
  it('`echo "$X"` vira herestring direto', () => {
    expect(suggestHerestring({ producer: 'echo "$OUT"', grepText: 'grep -Fq "ok"' })).toBe(
      'grep -Fq "ok" <<< "$OUT"',
    )
  })

  it("variável solta vira herestring citado (sem `$( )` desnecessário)", () => {
    expect(suggestHerestring({ producer: '"$OUT"', grepText: "grep -q x" })).toBe(
      'grep -q x <<< "$OUT"',
    )
  })

  it("produtor vivo é CAPTURADO antes (herestring não aceita comando)", () => {
    expect(
      suggestHerestring({ producer: 'docker ps --format "{{.Names}}"', grepText: 'grep -q "x"' }),
    ).toBe('grep -q "x" <<< "$(docker ps --format "{{.Names}}")"')
  })

  it("`echo -n`/`echo -e` NÃO viram herestring cru (a flag iria como texto)", () => {
    expect(suggestHerestring({ producer: 'echo -n "$OUT"', grepText: "grep -q x" })).toBe(
      'grep -q x <<< "$(echo -n "$OUT")"',
    )
  })
})

// ── o texto é código, não fixture ─────────────────────────────────────────

describe("logicalCommands — continuação de linha e heredoc", () => {
  it("junta a continuação `\\` com o número da PRIMEIRA linha", () => {
    const cmds = logicalCommands("if curl x \\\n  | grep -q 200; then\n  echo ok\nfi\n")
    expect(cmds[0].line).toBe(1)
    expect(cmds[0].text).toContain("| grep -q 200")
    // `echo ok` e `fi` são comandos próprios — o que se prova aqui é que o pipe
    // NÃO ficou numa linha solta sem o produtor.
    expect(cmds.map((c) => c.text)).toContain("echo ok")
  })

  it("pula o corpo de heredoc (fixture escrito NÃO é execução)", () => {
    const src = [
      "cat > /tmp/x.sh <<'EOF'",
      'echo "$OUT" | grep -Fq "padrao"',
      "EOF",
      'echo "$OUT" | grep -Fq "de-verdade"',
      "",
    ].join("\n")
    const cmds = logicalCommands(src)
    // A linha que ABRE o heredoc é comando (é executada); o CORPO não é.
    expect(cmds.map((c) => c.text).some((t) => t.includes("padrao"))).toBe(false)
    expect(cmds.map((c) => c.line)).toEqual([1, 4])
  })

  it("pula heredoc não citado, com `<<-` e múltiplos terminadores em ordem", () => {
    const src = ["cat <<-A <<B", "\tlinha de A", "A", "linha de B", "B", "echo depois"].join("\n")
    const cmds = logicalCommands(src)
    expect(cmds.map((c) => c.text)).toEqual(["cat <<-A <<B", "echo depois"])
  })

  it("não confunde HERESTRING (`<<<`) com heredoc (o remédio ficaria auto-acusado)", () => {
    const cmds = logicalCommands('grep -q "ok" <<< "$OUT"\n')
    expect(cmds).toHaveLength(1)
    expect(cmds[0].text).toContain("<<<")
  })

  it("ignora linhas de comentário", () => {
    expect(logicalCommands("# echo x | grep -q y\n")).toEqual([])
  })
})

describe("findViolations — o gatilho decide, não o padrão textual", () => {
  it("sem pipefail, o mesmo texto NÃO é violação", () => {
    const src = 'OUT=$(x)\nif echo "$OUT" | grep -q y; then echo ok; fi\n'
    expect(findViolations(src, { pipefail: false })).toEqual([])
    expect(findViolations(src, { pipefail: true })).toHaveLength(1)
  })
})

// ── workflows: o gate é o `shell:` ────────────────────────────────────────

describe("workflowRunSteps — `shell: bash` é o gatilho no runner", () => {
  const yaml = (shell: string | null, corpo: string): string =>
    [
      "on:",
      "  push:",
      "jobs:",
      "  check:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - name: Passo",
      ...(shell === null ? [] : [`        ${shell}`]),
      "        run: |",
      corpo,
      "",
    ].join("\n")

  it("`shell: bash` liga o pipefail (o runner gera `bash -eo pipefail {0}`)", () => {
    const [passo] = workflowRunSteps(yaml("shell: bash", '          echo "$OUT" | grep -q x'))
    expect(passo.pipefail).toBe(true)
    expect(passo.body).toContain("grep -q x")
  })

  it("shell default (`bash -e`) fica FORA — não é esta classe", () => {
    const [passo] = workflowRunSteps(yaml(null, '          echo "$OUT" | grep -q x'))
    expect(passo.pipefail).toBe(false)
  })

  it("`shell:` com string própria é usado VERBATIM: `-eo pipefail` liga, `-e` não", () => {
    expect(shellEnablesPipefail("bash")).toBe(true)
    expect(shellEnablesPipefail("bash -e {0}")).toBe(false)
    expect(shellEnablesPipefail("bash -eo pipefail {0}")).toBe(true)
    expect(shellEnablesPipefail(null)).toBe(false)
    const [semPf] = workflowRunSteps(
      yaml("shell: bash -e {0}", '          echo "$OUT" | grep -q x'),
    )
    expect(semPf.pipefail).toBe(false)
    const [comPf] = workflowRunSteps(
      yaml("shell: bash --noprofile --norc -eo pipefail {0}", '          echo "$OUT" | grep -q x'),
    )
    expect(comPf.pipefail).toBe(true)
  })

  it("o PRÓPRIO corpo pode ligar o pipefail, mesmo no shell default", () => {
    const [passo] = workflowRunSteps(
      yaml(null, '          set -euo pipefail\n          echo "$OUT" | grep -q x'),
    )
    expect(passo.pipefail).toBe(true)
  })

  it("lê o passo com a CHAVE na própria linha (`- run: ...`) — forma do repositório", () => {
    const passos = workflowRunSteps(
      ["jobs:", "  a:", "    steps:", '      - run: echo "$OUT" | grep -q x', ""].join("\n"),
    )
    expect(passos).toHaveLength(1)
    expect(passos[0].body).toBe('echo "$OUT" | grep -q x')
  })

  it("o corpo em BLOCO de `- run: |` perde a indentação do ITEM (a coluna é a da chave)", () => {
    const [passo] = workflowRunSteps(
      [
        "jobs:",
        "  a:",
        "    steps:",
        "      - run: |",
        '          echo "$OUT"',
        '          grep -qx 1 <<< "$OUT"',
        "",
      ].join("\n"),
    )
    expect(passo.body).toBe('echo "$OUT"\ngrep -qx 1 <<< "$OUT"\n')
  })

  it("`shell:` DEPOIS do corpo do `run:` ainda é o shell do passo (ordem livre no YAML)", () => {
    const [passo] = workflowRunSteps(
      [
        "jobs:",
        "  a:",
        "    steps:",
        "      - run: |",
        '          echo "$OUT" | grep -q x',
        "        shell: bash",
        "",
      ].join("\n"),
    )
    expect(passo.shellFonte).toBe("step")
    expect(passo.pipefail).toBe(true)
  })

  it("não devolve passos sem `run:` (uses/with ficam fora)", () => {
    const soUses = ["jobs:", "  a:", "    steps:", "      - uses: actions/checkout@v4", ""].join(
      "\n",
    )
    expect(workflowRunSteps(soUses)).toEqual([])
  })
})

// ── a PREMISSA: o shell default DECLARADO no repositório ──────────────────

const WF_DEFAULT_LIGADO = [
  "name: x",
  "defaults:",
  "  run:",
  "    shell: bash",
  "jobs:",
  "  guardas:",
  "    steps:",
  "      - name: um",
  "        run: |",
  '          echo "$OUT" | grep -q x',
  "      - name: dois",
  "        shell: bash -e {0}",
  "        run: echo ok",
  "",
].join("\n")

const JOB_DEFAULT_LIGADO = [
  "name: y",
  "jobs:",
  "  comDefault:",
  "    defaults:",
  "      run:",
  "        shell: bash -leo pipefail",
  "    steps:",
  "      - name: afetado",
  "        run: |",
  '          echo "$OUT" | grep -q x',
  "  semDefault:",
  "    steps:",
  "      - name: limpo",
  '        run: echo "$OUT" | grep -q x',
  "",
].join("\n")

const WF_DEFAULT_NEUTRO = [
  "name: z",
  "defaults:",
  "  run:",
  "    shell: bash -e {0}",
  "jobs:",
  "  a:",
  "    steps:",
  "      - name: limpo",
  '        run: echo "$OUT" | grep -q x',
  "",
].join("\n")

const WF_DEFAULT_INLINE = [
  "name: w",
  "defaults: {run: {shell: bash}}",
  "jobs:",
  "  a:",
  "    steps:",
  "      - name: limpo",
  "        run: echo ok",
  "",
].join("\n")

describe("workflowDefaultShells — a declaração é FATO lido, não premissa presumida", () => {
  it("lê o `defaults:` do ARQUIVO e o classifica pelo pipefail", () => {
    const [d] = workflowDefaultShells(WF_DEFAULT_LIGADO)
    expect(d).toMatchObject({ scope: "workflow", job: null, shell: "bash", pipefail: true })
    expect(d.line).toBe(4)
  })

  it("lê o `defaults:` do JOB com o NOME do job (e só ele)", () => {
    const declaracoes = workflowDefaultShells(JOB_DEFAULT_LIGADO)
    expect(declaracoes).toHaveLength(1)
    expect(declaracoes[0]).toMatchObject({
      scope: "job",
      job: "comDefault",
      shell: "bash -leo pipefail",
      pipefail: true,
    })
  })

  it("string própria sem `-o pipefail` NÃO liga o pipefail", () => {
    const [d] = workflowDefaultShells(WF_DEFAULT_NEUTRO)
    expect(d).toMatchObject({ shell: "bash -e {0}", pipefail: false })
  })

  it("a forma INLINE não é lida — sai `unparsed` (não ler ≠ não haver)", () => {
    const [d] = workflowDefaultShells(WF_DEFAULT_INLINE)
    expect(d).toMatchObject({ scope: "workflow", unparsed: true, pipefail: false })
  })

  it("workflow sem `defaults:` não inventa declaração", () => {
    expect(workflowDefaultShells("jobs:\n  a:\n    steps:\n      - run: echo ok\n")).toEqual([])
  })

  it("a declaração carrega a LINHA da chave `run:` (o dado que os outros guards usam)", () => {
    // `runLine` vem de `defaultsBlocks` (forge-workflows.mjs), a leitura única: é
    // por essa linha que os guards de workflow sabem o que NÃO é passo. Um guard
    // que passasse a ler `defaults:` por conta própria perderia este campo — e a
    // prova de que a leitura é uma só é o campo existir aqui.
    const [d] = workflowDefaultShells(WF_DEFAULT_LIGADO)
    expect(d.runLine).toBe(3)
    expect(d.inline).toBe(false)
  })
})

describe("workflowRunSteps — a FONTE do shell de cada passo é dita", () => {
  it("passo sem `shell:` herda o default do ARQUIVO (fonte `workflow-default`)", () => {
    const [passo] = workflowRunSteps(WF_DEFAULT_LIGADO)
    expect(passo.shellFonte).toBe("workflow-default")
    expect(passo.shell).toBe("bash")
    expect(passo.pipefail).toBe(true)
  })

  it("`shell:` no passo VENCE o default dos dois escopos", () => {
    const [, passo] = workflowRunSteps(WF_DEFAULT_LIGADO)
    expect(passo.shellFonte).toBe("step")
    expect(passo.shell).toBe("bash -e {0}")
    expect(passo.pipefail).toBe(false)
  })

  it("o default do JOB vale para os passos DELE, e não para os do outro job", () => {
    const passos = workflowRunSteps(JOB_DEFAULT_LIGADO)
    expect(passos.map((p) => [p.job, p.shellFonte, p.pipefail])).toEqual([
      ["comDefault", "job-default", true],
      ["semDefault", "runner", false],
    ])
  })

  it("sem `defaults:` nenhum, a fonte é o RUNNER (a premissa que não é nossa)", () => {
    const [passo] = workflowRunSteps(
      ["jobs:", "  a:", "    steps:", "      - run: echo ok", ""].join("\n"),
    )
    expect(passo.shellFonte).toBe("runner")
    expect(passo.shell).toBeNull()
  })
})

describe("scanRoot — a premissa que LIGA o pipefail é FALHA própria", () => {
  it("declaração do ARQUIVO: fato `premissas` com os passos que ela reclassificou", () => {
    const dir = makeDir()
    escrever(dir, ".github/workflows/a.yml", WF_DEFAULT_LIGADO)
    const { premissas, violations, scanned } = scan(dir)
    expect(premissas).toHaveLength(1)
    expect(premissas[0]).toMatchObject({
      file: ".github/workflows/a.yml",
      scope: "workflow",
      job: null,
      shell: "bash",
      passos: 1,
    })
    // o passo reclassificado é acusado como `pipefail` (não como shell default)
    expect(violations).toHaveLength(1)
    expect(violations[0].context).toBe("pipefail")
    expect(scanned.defaultShellsEmPipefail).toBe(1)
  })

  it("declaração do JOB: o fato nomeia o job e só os passos dele são reclassificados", () => {
    const dir = makeDir()
    escrever(dir, ".github/workflows/y.yml", JOB_DEFAULT_LIGADO)
    const { premissas, violations, scanned } = scan(dir)
    expect(premissas).toHaveLength(1)
    expect(premissas[0]).toMatchObject({ scope: "job", job: "comDefault", passos: 1 })
    expect(violations.map((v) => v.context).sort()).toEqual(["pipefail", "shell-default"])
    expect(scanned.passosDoRunner).toBe(1)
  })

  it("declaração que NÃO liga o pipefail não é premissa mudada — e o passo sai `shell-declared`", () => {
    const dir = makeDir()
    escrever(dir, ".github/workflows/z.yml", WF_DEFAULT_NEUTRO)
    const { premissas, violations, scanned } = scan(dir)
    expect(premissas).toEqual([])
    expect(violations).toHaveLength(1)
    expect(violations[0].context).toBe("shell-declared")
    expect(scanned).toMatchObject({ passosComDefaultDeclarado: 1, passosDoRunner: 0 })
  })

  it("`defaults:` inline sai como ILEGÍVEL (INDETERMINADO, nunca presumido)", () => {
    const dir = makeDir()
    escrever(dir, ".github/workflows/w.yml", WF_DEFAULT_INLINE)
    const { ilegiveis, premissas } = scan(dir)
    expect(premissas).toEqual([])
    expect(ilegiveis).toHaveLength(1)
    expect(ilegiveis[0]).toMatchObject({ scope: "workflow", shell: "{run: {shell: bash}}" })
  })
})

describe("githubExpressions — a parte do comando que o BASH não vê", () => {
  it("lista as expressões na ordem (o invariante do `--fix`)", () => {
    const cmd = 'if docker exec ${{ job.services.postgres.id }} psql -tAc "x" | grep -qx 1; then'
    expect(githubExpressions(cmd)).toEqual(["job.services.postgres.id"])
    expect(githubExpressions("echo ok")).toEqual([])
  })
})

describe("fixCommand — a reescrita mantém o PRODUTOR dentro da captura", () => {
  // O defeito real: a extração shell-aware lia `{{`/`}}` como ESTRUTURA e o
  // remédio saía com o `docker exec` FORA da captura — reduzia a contagem e
  // quebrava o passo no runner. A máscara (o conserto) é provada por mutação no
  // scripts/test-mutation-pipefail-sigpipe.sh, onde a máscara pode ser desfeita.
  it("produtor com EXPRESSÃO continua inteiro dentro do herestring", () => {
    const cmd =
      'if docker exec ${{ job.services.postgres.id }} psql -U u -d d -tAc "SELECT 1" | grep -qx 1; then'
    const novo = fixCommand(cmd)
    expect(novo).toBe(
      'if grep -qx 1 <<< "$(docker exec ${{ job.services.postgres.id }} psql -U u -d d -tAc "SELECT 1")"; then',
    )
    expect(githubExpressions(novo as string)).toEqual(githubExpressions(cmd))
  })
})

// ── a varredura: escopo das duas forjas + hooks ───────────────────────────

describe("scanRoot — o que entra na varredura", () => {
  it("reconhece `.sh`/`.bash` e os hooks SEM extensão do `.husky/`", () => {
    expect(isShellScript("scripts/x.sh")).toBe(true)
    expect(isShellScript("deploy/y.bash")).toBe(true)
    expect(isShellScript(".husky/pre-commit")).toBe(true)
    expect(isShellScript(".husky/pre-push")).toBe(true)
    expect(isShellScript("src/x.ts")).toBe(false)
    expect(isShellScript(".github/workflows/ci.yml")).toBe(false)
    expect(isShellScript(".husky/_/husky.sh")).toBe(true) // é .sh; o walk pula o dir `_`
  })

  it("varre scripts, hooks e as DUAS forjas, sem descer em node_modules", () => {
    const dir = makeDir()
    escrever(dir, "scripts/a.sh", "#!/usr/bin/env bash\nset -euo pipefail\n")
    escrever(dir, ".husky/pre-push", "#!/usr/bin/env bash\nset -euo pipefail\n")
    escrever(dir, "node_modules/pkg/x.sh", 'echo "$A" | grep -q b\n')
    escrever(dir, ".gitea/workflows/ci.yml", "on:\n  push:\n")
    escrever(dir, ".github/workflows/pr.yml", "on:\n  push:\n")
    const files = listShellScripts(dir)
    expect(files).toContain("scripts/a.sh")
    expect(files).toContain(".husky/pre-push")
    expect(files.some((f) => f.includes("node_modules"))).toBe(false)

    const { files: varridos, scanned } = scan(dir)
    expect(varridos).toContain(".gitea/workflows/ci.yml")
    expect(varridos).toContain(".github/workflows/pr.yml")
    expect(scanned.workflows).toBe(2)
  })

  it("a violação traz arquivo, linha, texto e o remédio", () => {
    const { violations } = scan(violacaoDir())
    expect(violations).toHaveLength(1)
    expect(violations[0].file).toBe("scripts/violacao.sh")
    expect(violations[0].line).toBe(4)
    expect(violations[0].suggestion).toBe('grep -Fq "ok" <<< "$OUT"')
  })

  it("o corpo de heredoc do próprio fixture não vira violação", () => {
    const dir = makeDir()
    escrever(
      dir,
      "scripts/gera.sh",
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        "cat > /tmp/f.sh <<'SH'",
        'echo "$OUT" | grep -q x',
        "SH",
        "echo ok",
        "",
      ].join("\n"),
    )
    expect(scanRoot(dir).violations).toEqual([])
  })
})

// ── o baseline não esconde crescimento ────────────────────────────────────

type Comparacao = {
  novas: Violacao[]
  reduzidas: { file: string; baseline: number; atual: number }[]
}

function comparar(violacoes: Violacao[], files: Record<string, number>): Comparacao {
  return compareWithBaseline(violacoes, { files }) as unknown as Comparacao
}

describe("compareWithBaseline — dívida declarada com dentes", () => {
  const v = (file: string, line: number): Violacao => ({ file, line, text: "x", suggestion: "y" })

  it("sem baseline, TUDO é ocorrência nova", () => {
    const { novas } = comparar([v("a.sh", 1), v("a.sh", 2)], {})
    expect(novas).toHaveLength(2)
  })

  it("cota IGUAL passa; acima da cota só o excedente é reportado", () => {
    const { novas } = comparar([v("a.sh", 1), v("a.sh", 2), v("a.sh", 3)], { "a.sh": 1 })
    expect(novas.map((n) => n.line)).toEqual([2, 3])
  })

  it("cota sobrando e arquivo que sumiu viram REDUÇÃO (corrigir nunca bloqueia)", () => {
    const { novas, reduzidas } = comparar([v("a.sh", 1)], { "a.sh": 3, "b.sh": 2 })
    expect(novas).toEqual([])
    expect(reduzidas).toEqual([
      { file: "a.sh", baseline: 3, atual: 1 },
      { file: "b.sh", baseline: 2, atual: 0 },
    ])
  })

  it("arquivo NOVO com ocorrência falha inteiro (não herda cota de outro)", () => {
    const { novas } = comparar([v("novo.sh", 9)], { "a.sh": 5 })
    expect(novas.map((n) => n.file)).toEqual(["novo.sh"])
  })

  it("countsByFile é a forma do baseline e a idade sai em dias", () => {
    expect(countsByFile([v("a.sh", 1), v("a.sh", 2), v("b.sh", 1)])).toEqual({
      "a.sh": 2,
      "b.sh": 1,
    })
    expect(baselineAgeDays({ declaredAt: "2026-09-15" }, new Date("2026-09-25T00:00:00Z"))).toBe(10)
    expect(baselineAgeDays({ declaredAt: null })).toBeNull()
  })
})

describe("fixCommand / fixFirstQuietPipe — o remédio mecânico", () => {
  it("troca o produtor `echo` pelo herestring, preservando o controle em volta", () => {
    expect(fixCommand('if ! echo "$OUT" | grep -Fq "ok"; then')).toBe(
      'if ! grep -Fq "ok" <<< "$OUT"; then',
    )
  })

  it("troca produtor VIVO por captura (a forma que não tem `echo` para trocar)", () => {
    expect(fixCommand('if docker ps | grep -q "alive"; then')).toBe(
      'if grep -q "alive" <<< "$(docker ps)"; then',
    )
  })

  it("leva a CADEIA inteira do produtor para a captura, não só o segmento colado", () => {
    expect(
      fixCommand('netstat -ano 2>/dev/null | grep ":$port" | grep -qi "LISTEN" && return 0'),
    ).toBe('grep -qi "LISTEN" <<< "$(netstat -ano 2>/dev/null | grep ":$port")" && return 0')
  })

  it("resolve MAIS DE UM pipe quieto no mesmo comando (`||` encadeado)", () => {
    expect(fixCommand('if ! echo "$G" | grep -Fq "$A" || ! echo "$G" | grep -Fq "$B"; then')).toBe(
      'if ! grep -Fq "$A" <<< "$G" || ! grep -Fq "$B" <<< "$G"; then',
    )
  })

  it("preserva o ESPAÇO significativo dentro do padrão (tokenizar destruía o conselho)", () => {
    expect(fixCommand("if git -C x diff -- f | grep -Fq -- '-  run: bash x.sh'; then")).toBe(
      `if grep -Fq -- '-  run: bash x.sh' <<< "$(git -C x diff -- f)"; then`,
    )
  })

  it("devolve null quando não há pipe quieto (não é a classe)", () => {
    expect(fixCommand('echo "$OUT" | grep -n "x" >/dev/null')).toBeNull()
    expect(fixCommand("echo oi")).toBeNull()
    expect(fixFirstQuietPipe('echo "$OUT" | grep -n "x"')).toBeNull()
  })

  it("FAIL-CLOSED: o remédio nunca AUMENTA a contagem do comando", () => {
    const casos = [
      'if ! echo "$OUT" | grep -Fq "ok"; then',
      'if docker ps | grep -q "alive"; then',
      'netstat -ano | grep ":$port" | grep -qi "LISTEN"',
      'if ! echo "$G" | grep -Fq "$A" || ! echo "$G" | grep -Fq "$B"; then',
      'echo "$A" | grep -q x | grep -q y',
      'echo "$OUT" | grep -n "x" >/dev/null',
    ]
    for (const caso of casos) {
      const fixado = fixCommand(caso)
      if (fixado === null) continue
      expect(findViolations(fixado, { pipefail: true }).length).toBeLessThanOrEqual(
        findViolations(caso, { pipefail: true }).length,
      )
    }
  })
})

describe("fixSource — o que o --fix toca e o que ele deixa em paz", () => {
  it("reescreve o CÓDIGO e nunca o corpo do heredoc (fixture é texto)", () => {
    const src = [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      'if echo "$A" | grep -q "a"; then',
      "  :",
      "fi",
      "cat > /tmp/f.sh <<'EOF'",
      'echo "$B" | grep -q "b"',
      "EOF",
      "",
    ].join("\n")
    const { content, fixadas } = fixSource(src)
    expect(fixadas).toHaveLength(1)
    expect(content).toContain('if grep -q "a" <<< "$A"; then')
    expect(content).toContain('echo "$B" | grep -q "b"')
  })

  it("COMPRIME a continuação, preservando a indentação da primeira linha", () => {
    const src = [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "  if docker compose ps \\",
      '      | grep -qi "healthy"; then',
      "    :",
      "  fi",
      "",
    ].join("\n")
    const { content, fixadas } = fixSource(src)
    expect(fixadas).toHaveLength(1)
    expect(content).toContain('  if grep -qi "healthy" <<< "$(docker compose ps)"; then')
    expect(content.split("\n")).toHaveLength(src.split("\n").length - 1)
  })

  it("preserva CRLF e LF (o --fix não é uma conversão de terminador)", () => {
    const crlf =
      '#!/usr/bin/env bash\r\nset -euo pipefail\r\nif echo "$A" | grep -q "a"; then\r\n  :\r\nfi\r\n'
    const { content } = fixSource(crlf)
    expect(content).toContain('grep -q "a" <<< "$A"; then\r\n')
    expect(content.match(/\r\n/g)).toHaveLength(5)

    const lf = '#!/usr/bin/env bash\nset -euo pipefail\nif echo "$A" | grep -q "a"; then\n  :\nfi\n'
    expect(fixSource(lf).content).not.toContain("\r")
  })

  it("é idempotente: arquivo já correto volta IDÊNTICO, sem linha reescrita", () => {
    const src = '#!/usr/bin/env bash\nset -euo pipefail\nif grep -q "a" <<< "$A"; then\n  :\nfi\n'
    const { content, fixadas } = fixSource(src)
    expect(fixadas).toEqual([])
    expect(content).toBe(src)
  })

  it("reporta a linha e o ANTES/DEPOIS de cada reescrita (o diff é o que se revisa)", () => {
    const src = [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      'if echo "$A" | grep -q "a"; then',
      "  :",
      "fi",
      'if echo "$B" | grep -q "b"; then',
      "  :",
      "fi",
      "",
    ].join("\n")
    const { fixadas } = fixSource(src)
    expect(fixadas.map((f) => f.line)).toEqual([3, 6])
    expect(fixadas[0]).toEqual({
      line: 3,
      before: 'if echo "$A" | grep -q "a"; then',
      after: 'if grep -q "a" <<< "$A"; then',
      // As LINHAS CRUAS e a linha GRAVADA: o patch do PR (o mesmo que
      // `--fix --dry-run` imprime) precisa dos bytes do arquivo para achar o
      // texto e para aplicar — um diff montado com o comando já colapsado não
      // acharia a continuação.
      linhasAntes: ['if echo "$A" | grep -q "a"; then'],
      linhaDepois: 'if grep -q "a" <<< "$A"; then',
    })
  })
})

// ── a dívida declarada: DECLARADA, JUSTIFICADA e VENCÍVEL ────────────────
//
// O baseline foi aposentado (216 → 0, arquivo REMOVIDO) e o `--update` é a
// comporta que pode reabri-lo. Estes casos provam que ela exige uma decisão —
// sem eles, "declarar dívida" voltaria a ser um comando para deixar o gate
// verde, e a cota antiga voltaria por digitação.

describe("baselineProblems — a dívida tem de ser justificada e vencer", () => {
  const HOJE = Date.UTC(2026, 8, 15) // 2026-09-15, o "hoje" dos casos
  const dia = 86_400_000
  const base = (over: Record<string, unknown> = {}) => ({
    files: { "a.sh": 2 },
    declaredAt: "2026-09-01",
    reason: "caso de produtor vivo, revisao humana",
    ...over,
  })

  it("dívida ZERO é inerte: não exige razão nem data (não há o que revisar)", () => {
    expect(baselineProblems({ files: {} }, { now: HOJE })).toEqual({ invalid: [], aged: null })
    expect(baselineProblems({}, { now: HOJE })).toEqual({ invalid: [], aged: null })
  })

  it("dívida SEM `reason` é INVALID (fail-closed) — apagar o campo não pode ser a saída", () => {
    const r = baselineProblems(base({ reason: "" }), { now: HOJE })
    expect(r.aged).toBeNull()
    expect(r.invalid).toHaveLength(1)
    expect(r.invalid[0]).toContain("reason")
    // Só espaço em branco NÃO é razão escrita.
    expect(baselineProblems(base({ reason: "   " }), { now: HOJE }).invalid).toHaveLength(1)
  })

  it("`declaredAt` impossível é INVALID — o transbordo do Date.UTC não passa", () => {
    // 2026-02-30 não existe; `new Date('2026-02-30T00:00:00Z')` TRANSBORDA para
    // 2026-03-02 — aceitar isso mediria uma data que o autor não digitou.
    const r = baselineProblems(base({ declaredAt: "2026-02-30" }), { now: HOJE })
    expect(r.invalid).toHaveLength(1)
    expect(r.invalid[0]).toContain("declaredAt")
    expect(baselineAgeDays({ declaredAt: "2026-02-30" })).toBeNull()
  })

  it("`declaredAt` no FUTURO é INVALID (decisão não pode ser posterior a hoje)", () => {
    const r = baselineProblems(base({ declaredAt: "2027-01-01" }), { now: HOJE })
    expect(r.invalid).toHaveLength(1)
    expect(r.invalid[0]).toContain("FUTURO")
  })

  it("dentro da janela e justificada: limpa", () => {
    expect(baselineProblems(base(), { now: HOJE })).toEqual({ invalid: [], aged: null })
  })

  it("passada a JANELA vira `aged`, com o limite junto (não é violação por si)", () => {
    const declared = new Date(HOJE - (DEFAULT_REVIEW_DAYS + 10) * dia).toISOString().slice(0, 10)
    const r = baselineProblems(base({ declaredAt: declared }), { now: HOJE })
    expect(r.invalid).toEqual([])
    expect(r.aged).toEqual({
      declaredAt: declared,
      days: DEFAULT_REVIEW_DAYS + 10,
      limit: DEFAULT_REVIEW_DAYS,
    })
    // O dia do VENCIMENTO ainda está dentro: a janela é `>`, não `>=`.
    const noLimite = new Date(HOJE - DEFAULT_REVIEW_DAYS * dia).toISOString().slice(0, 10)
    expect(baselineProblems(base({ declaredAt: noLimite }), { now: HOJE }).aged).toBeNull()
  })

  it("`textoDividaVencida` nomeia o estado, a janela e a data (as duas metades da prosa)", () => {
    const t = textoDividaVencida({
      declaredAt: "2026-01-01",
      days: 200,
      limit: DEFAULT_REVIEW_DAYS,
    })
    expect(t).toContain("VENCEU")
    expect(t).toContain(String(DEFAULT_REVIEW_DAYS))
    expect(t).toContain("2026-01-01")
    expect(t).toContain(BASELINE_PATH)
  })
})

describe("writeBaseline — a decisão fica registrada no ARQUIVO", () => {
  const v = (file: string, line: number): Violacao => ({ file, line, text: "x", suggestion: "y" })

  it("grava a razão, a data e a JANELA do módulo compartilhado (uma janela só)", () => {
    const dir = makeDir()
    const gravado = writeBaseline(dir, [v("a.sh", 1)], { reason: "porque X", hoje: "2026-09-15" })
    expect(gravado.reason).toBe("porque X")
    expect(gravado.reviewAfterDays).toBe(DEFAULT_REVIEW_DAYS)
    const lido = JSON.parse(readFileSync(join(dir, BASELINE_PATH), "utf8"))
    expect(lido.reason).toBe("porque X")
    expect(lido.reviewAfterDays).toBe(DEFAULT_REVIEW_DAYS)
    expect(lido.declaredAt).toBe("2026-09-15")
    expect(lido.files).toEqual({ "a.sh": 1 })
    // O arquivo gravado é ACEITO pela própria regra que o gate aplica.
    expect(baselineProblems(lido, { now: Date.UTC(2026, 8, 20) }).invalid).toEqual([])
  })

  it("cria o diretório do baseline quando ele não existe (sem ENOENT/stack trace)", () => {
    // Defeito real: `--update --reason` num alvo sem `docs/quality/` morria com
    // ENOENT do writeFileSync e um stack trace do Node — o operador via um
    // CRASH onde devia ver "declarado".
    const dir = makeDir()
    expect(existsSync(join(dir, BASELINE_PATH))).toBe(false)
    expect(() => writeBaseline(dir, [v("a.sh", 1)], { reason: "r" })).not.toThrow()
    expect(existsSync(join(dir, BASELINE_PATH))).toBe(true)
  })

  it("dívida zero grava um baseline INERTE (sem razão obrigatória)", () => {
    const dir = makeDir()
    const gravado = writeBaseline(dir, [], {})
    expect(gravado.total).toBe(0)
    // `now` FIXO: dívida zero é inerte em qualquer data (e a suíte proíbe
    // relógio dentro de asserção — `check:clock-bombs`).
    expect(baselineProblems(gravado, { now: Date.UTC(2026, 8, 15) })).toEqual({
      invalid: [],
      aged: null,
    })
  })
})

describe("o contrato da CLI", () => {
  it("publica os exit codes e o caminho do baseline (o dado da dívida)", () => {
    expect(EXIT).toEqual({ OK: 0, VIOLATIONS: 1, UNAVAILABLE: 2, USAGE: 3 })
    expect(BASELINE_PATH).toBe("docs/quality/pipefail-sigpipe-baseline.json")
  })
})
