// =============================================================================
// check-workflow-run-syntax.test.ts
//
// Testes do scripts/check-workflow-run-syntax.mjs — o gate que roda `bash -n` em
// TODO corpo `run:` dos workflows das duas forjas.
//
// O que precisa ser provado (o gate pode "parecer" certo e mentir):
//   1. o corpo julgado é o que o SHELL recebe: escalar e bloco, de-indentado
//      como o runner entrega — e o `defaults: run:` (que NÃO é passo) fica fora;
//   2. a EXPRESSÃO do runner (`${{ ... }}`) é mascarada sem neuterizar o gate:
//      um erro REAL em volta dela continua reprovando (as duas metades);
//   3. shell declarado NÃO-bash é PULADO com o motivo dito — nunca contado como
//      conferido, nem escondido;
//   4. INFRA fail-closed: um `bash` que não executa não pode virar "0 violações";
//   5. o repositório inteiro passa (o gate nasce ABSOLUTO: sem allowlist);
//   6. a SEGUNDA fonte: os SCRIPTS DE SHELL do repositório (a lista do
//      `listShellScripts`, a mesma do check:pipefail-sigpipe) passam pelo MESMO
//      parser — o shebang é a declaração (python pula com motivo, sem-shebang cai
//      na premissa de quem o executa), o arquivo VAZIO é nomeado, o escopo não
//      desce em node_modules/artefato, e o `--fix` RECUSA remendar arquivo sem
//      tocar nele (a cicatriz que ele conhece é de uma linha ancorada em `run: |`).
//
// Sem rede. O `run` (spawnSync) é injetado onde o teste precisa do desfecho de
// infra; o resto usa o bash de verdade (é ele que julga).
// =============================================================================

import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"

import { afterAll, describe, expect, it } from "vitest"

import {
  DEFAULT_BASH,
  EXIT,
  RUNNER_IMAGE,
  RUNNER_SHELLS,
  RUNNER_SHELLS_MISSING,
  argvPayload,
  checkBody as checkBodyBruto,
  collectEmbeddedShell as collectEmbeddedShellBruto,
  collectRunBodies as collectBruto,
  collectShellScripts as collectShellScriptsBruto,
  dockerfileRunUnits,
  embeddedPaths,
  embeddedPayloads,
  fixAll as fixAllBruto,
  fixWorkflow,
  interpreterOf,
  isBashShell,
  lineOfText,
  maskComposeEscapes,
  maskExpressions,
  mendBody,
  runnerImageRef,
  scan as scanBruto,
  shellCommandOf,
  shellTokens,
  yamlEmbeddedPayloads,
} from "../../../scripts/check-workflow-run-syntax.mjs"

/** O módulo é .mjs: o teste tipa só o que consome (o resto é o runtime). */
type Corpo = {
  file: string
  line: number
  bodyEndLine: number
  job: string | null
  shell: string | null
  body: string
}
type Pulado = { file: string; line: number; shell: string | null; detail: string }
type FalhaDeShell = {
  file: string
  line: number
  shell: string | null
  command: string
  kind: string
  error: string
}
type Coleta = {
  files: string[]
  steps: Corpo[]
  skipped: Pulado[]
  indeterminate: Pulado[]
  shellFailures: FalhaDeShell[]
  unread: { file: string; detail: string }[]
  /** Workflows que EXISTEM e não fazem parsing em YAML (§ "A OUTRA PORTA"). */
  yamlInvalido: { file: string; detail: string }[]
}
type Remendo = {
  fixed: boolean
  reason?: string
  operador?: string
  antes?: string
  depois?: string
}
type Mendado = {
  mended: boolean
  reason?: string
  operador?: string
  antes?: string
  depois?: string
  body?: string
}
type ArquivoDeShell = { file: string; body: string; interpreter: string; fonte: string }
type PuladoDeShell = { file: string; detail: string }
type ColetaDeShell = {
  files: string[]
  scripts: ArquivoDeShell[]
  skipped: PuladoDeShell[]
  unread: { file: string; detail: string }[]
}
type ResultadoScan = Coleta & {
  failures: (Corpo & { kind: string; error: string })[]
  shellFiles: string[]
  shellScripts: ArquivoDeShell[]
  scriptSkipped: PuladoDeShell[]
  scriptFailures: (ArquivoDeShell & { kind: string; error: string })[]
  embeddedFiles: string[]
  embeddedUnits: UnidadeEmbutida[]
  embeddedPayloads: PayloadEmbutido[]
  embeddedSkipped: PuladoEmbutido[]
  embeddedIndeterminate: PuladoEmbutido[]
  embeddedFailures: (UnidadeEmbutida & { kind: string; error: string })[]
  payloadFailures: (PayloadEmbutido & { kind: string; error: string })[]
  indisponivel: string | null
}
type Veredito = {
  ok: boolean
  unavailable?: boolean
  status: number | null
  kind: "erro" | "aviso" | null
  detail: string
}
type UnidadeEmbutida = { file: string; line: number; body: string; fonte: string }
type PayloadEmbutido = {
  file: string
  line: number | null
  body: string
  fonte: string
  mascara: "runner" | "compose" | null
}
type PuladoEmbutido = { file: string; line: number | null; detail: string }
type ResultadoEmbutido = {
  files: string[]
  units: UnidadeEmbutida[]
  payloads: PayloadEmbutido[]
  skipped: PuladoEmbutido[]
  indeterminate: PuladoEmbutido[]
  unread: { file: string; detail: string }[]
}

const collectRunBodies = (root: string) => collectBruto(root) as Coleta
const collectShellScripts = (root: string, opts: Record<string, unknown> = {}) =>
  collectShellScriptsBruto(root, opts) as ColetaDeShell
const scan = (root: string, opts: Record<string, unknown> = {}) =>
  scanBruto(root, opts) as ResultadoScan
const collectEmbeddedShell = (root: string, opts: Record<string, unknown> = {}) =>
  collectEmbeddedShellBruto(root, opts) as ResultadoEmbutido
const checkBody = (body: string, opts: Record<string, unknown> = {}) =>
  checkBodyBruto(body, opts) as Veredito

const ROOT = resolve(__dirname, "..", "..", "..")
const SCRIPT = join(ROOT, "scripts", "check-workflow-run-syntax.mjs")
const tmpDirs: string[] = []

function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "run-syntax-"))
  tmpDirs.push(dir)
  return dir
}

afterAll(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** Uma árvore de fixture com os workflows nomeados. */
function tree(workflows: Record<string, string>): string {
  const root = makeDir()
  for (const [caminho, conteudo] of Object.entries(workflows)) {
    mkdirSync(join(root, dirname(caminho)), { recursive: true })
    writeFileSync(join(root, caminho), conteudo)
  }
  return root
}

/** A CLI, com o exit code do processo (o contrato que o CI consome). */
function cli(
  args: string[],
  env: Record<string, string> = {},
): { code: number; out: string; err: string } {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  })
  return { code: r.status ?? -1, out: r.stdout ?? "", err: r.stderr ?? "" }
}

// ── 1. A leitura dos corpos ────────────────────────────────────────────────

describe("collectRunBodies — o corpo que o SHELL recebe", () => {
  it("escalar e bloco: o bloco sai DE-INDENTADO, e o vazio não entra na conta", () => {
    const root = tree({
      ".gitea/workflows/ci.yml": [
        "on:",
        "  push:",
        "jobs:",
        "  guards:",
        "    steps:",
        "      - run: echo escalar",
        "      - run: |",
        "          linha um",
        "          linha dois",
        "      - run: |",
        "      - run: echo depois-do-vazio",
        "",
      ].join("\n"),
    })
    const { steps } = collectRunBodies(root)
    // Três corpos NÃO vazios: o escalar, o bloco, e o passo que vem depois do
    // `run: |` sem conteúdo — que não entra na conta (não roda nada).
    expect(steps).toHaveLength(3)
    expect(steps.every((s) => s.body.trim() !== "")).toBe(true)
    expect(steps[0]).toMatchObject({ file: ".gitea/workflows/ci.yml", job: "guards" })
    expect(steps[0].body.trim()).toBe("echo escalar")
    expect(steps[1].body).toContain("linha um\nlinha dois")
    expect(steps[2].body.trim()).toBe("echo depois-do-vazio")
  })

  it("o `defaults: run:` NÃO é passo (a leitura é a mesma dos outros guards)", () => {
    const root = tree({
      ".github/workflows/ci.yml": [
        "on:",
        "  push:",
        "defaults:",
        "  run:",
        "    shell: bash",
        "jobs:",
        "  a:",
        "    steps:",
        "      - run: echo um",
        "",
      ].join("\n"),
    })
    const { steps } = collectRunBodies(root)
    expect(steps).toHaveLength(1)
    expect(steps[0].body.trim()).toBe("echo um")
  })

  it("shell declarado não-bash → PULADO com o motivo (nunca contado como conferido)", () => {
    const root = tree({
      ".gitea/workflows/ci.yml": [
        "on:",
        "  push:",
        "jobs:",
        "  a:",
        "    steps:",
        "      - run: print('nao e bash')",
        "        shell: python",
        "      - run: echo e-bash",
        "",
      ].join("\n"),
    })
    const { steps, skipped } = collectRunBodies(root)
    expect(steps).toHaveLength(1)
    expect(skipped).toHaveLength(1)
    expect(skipped[0]).toMatchObject({ file: ".gitea/workflows/ci.yml" })
    expect(skipped[0].detail).toContain("python")
  })
})

// ── 2. A máscara da expressão do runner ────────────────────────────────────

describe("maskExpressions — a expressão do runner não é sintaxe de shell", () => {
  it("troca `${{ ... }}` por uma palavra (o texto em volta fica intacto)", () => {
    expect(maskExpressions('echo "${{ vars.X }}" e ${HOME}')).toBe('echo "EXPRESSAO" e ${HOME}')
  })

  it("AS DUAS METADES: o corpo COM expressão passa, e um erro REAL em volta reprova", () => {
    // Metade 1: a expressão não é julgada (o runner a resolve ANTES do bash).
    const comExpressao = 'if [ "${{ github.event.inputs.modo }}" = "x" ]; then echo ok; fi'
    expect(checkBody(maskExpressions(comExpressao)).ok).toBe(true)
    // Metade 2: mascarar não AFROUXA — o mesmo corpo com um `fi` faltando falha.
    const quebrado = 'if [ "${{ github.event.inputs.modo }}" = "x" ]; then echo ok'
    expect(checkBody(maskExpressions(quebrado)).ok).toBe(false)
  })
})

describe("isBashShell — a premissa do runner conta como bash", () => {
  it("null (o runner: `bash -e {0}`), `bash`, `bash -e {0}`, `/bin/bash` e `sh` são bash", () => {
    for (const s of [null, "", "bash", "bash -e {0}", "/bin/bash", "sh", "sh -e {0}"])
      expect(isBashShell(s as string | null)).toBe(true)
  })

  it("`python`, `pwsh` e `node` NÃO são (o gate não julga o que não é bash)", () => {
    for (const s of ["python", "pwsh", "node", "cmd"]) expect(isBashShell(s)).toBe(false)
  })
})

// ── 3. As classes que o gate existe para pegar ─────────────────────────────

describe("checkBody — o parsing que o runner faria", () => {
  it("corpo válido → ok; reescrita mecânica quebrada → reprova com o erro do bash", () => {
    expect(checkBody('grep -q x <<< "$(docker ps)"').ok).toBe(true)
    // O formato EXATO do remédio do SIGPIPE, com o `)` que sobrou: é a classe
    // que este gate existe para pegar (a reescrita errada de 216 ocorrências).
    const r = checkBody('grep -q x <<< "$(docker ps"')
    expect(r.ok).toBe(false)
    expect(r.detail.length).toBeGreaterThan(0)
  })

  it("heredoc SEM terminador reprova — e o exit code do bash NÃO bastaria (é AVISO, sai 0)", () => {
    // A classe que a reescrita mecânica mais produz, e a razão de o gate não
    // olhar só o exit code: `bash -n` sai **0** aqui, com aviso no stderr.
    const semTerminador = checkBody("cat <<'EOF'\nconteudo\n")
    expect(semTerminador.ok).toBe(false)
    expect(semTerminador.kind).toBe("aviso")
    expect(semTerminador.status).toBe(0)
    expect(checkBody("cat <<'EOF'\nconteudo\nEOF\n").ok).toBe(true)
  })

  it("INFRA fail-closed: `bash` que não executa é UNAVAILABLE, jamais 'válido'", () => {
    const r = checkBody("echo ok", {
      run: () => ({ error: new Error("ENOENT"), status: null, stderr: "" }),
    })
    expect(r.ok).toBe(false)
    expect(r.unavailable).toBe(true)
    expect(r.detail).toContain("não pôde ser executado")
  })
})

// ── 4. A CLI (o contrato do CI) ────────────────────────────────────────────

describe("CLI — exit codes", () => {
  it("corpo quebrado → exit 1, com arquivo, linha e o erro do bash", () => {
    const root = tree({
      ".gitea/workflows/ci.yml": [
        "on:",
        "  push:",
        "jobs:",
        "  a:",
        "    steps:",
        "      - run: echo ok",
        "      - run: |",
        "          if [ -f x ]; then",
        "            echo sem-fi",
        "",
      ].join("\n"),
    })
    const r = cli(["--root", root])
    expect(r.code).toBe(EXIT.VIOLATIONS)
    expect(r.err).toContain(".gitea/workflows/ci.yml:7")
    // O locale é PINADO (`LC_ALL=C`): a mensagem do parser não muda com o
    // `LANG` do runner, então o diagnóstico (e esta asserção) são estáveis.
    expect(r.err).toContain("syntax error")
    expect(r.err).toContain("1 com ERRO de sintaxe")
  })

  it("árvore limpa → exit 0, e o passo NÃO-bash aparece dito no relatório", () => {
    const root = tree({
      ".gitea/workflows/ci.yml": [
        "on:",
        "  push:",
        "jobs:",
        "  a:",
        "    steps:",
        "      - run: echo ok",
        "      - run: print(1)",
        "        shell: python",
        "",
      ].join("\n"),
    })
    const r = cli(["--root", root])
    expect(r.code).toBe(EXIT.OK)
    expect(r.out).toContain(
      "1 corpo(s) `run:`, 0 arquivo(s) de shell E 0 texto(s) de shell EMBUTIDO",
    )
    expect(r.out).toContain("shell NÃO-bash PRESENTE no runner")
    expect(r.out).toContain("python")
  })

  it("--root inexistente → exit 2 (fail-closed), e flag desconhecida → exit 3", () => {
    expect(cli(["--root", join(tmpdir(), "nao-existe-xyz")]).code).toBe(EXIT.UNAVAILABLE)
    expect(cli(["--inventada"]).code).toBe(EXIT.USAGE)
    expect(cli(["--bash"]).code).toBe(EXIT.USAGE)
  })

  it("--json sai os dados do gate (e o mesmo exit)", () => {
    const root = tree({
      ".gitea/workflows/ci.yml": "on:\n  push:\njobs:\n  a:\n    steps:\n      - run: echo ok\n",
    })
    const r = cli(["--root", root, "--json"])
    expect(r.code).toBe(EXIT.OK)
    const data = JSON.parse(r.out) as { passos: number; failures: unknown[] }
    expect(data.passos).toBe(1)
    expect(data.failures).toEqual([])
  })

  it("`bash` ausente no PATH → exit 2 (sem interpretador não há parsing)", () => {
    const root = tree({
      ".gitea/workflows/ci.yml": "on:\n  push:\njobs:\n  a:\n    steps:\n      - run: echo ok\n",
    })
    const r = cli(["--root", root, "--bash", "bash-que-nao-existe-xyz"])
    expect(r.code).toBe(EXIT.UNAVAILABLE)
    expect(r.err).toContain("não há parsing")
  })

  it("YAML que NÃO faz parsing → exit 2, NOMEADO (não é '0 corpos reprovados')", () => {
    // A outra metade do "não consegui julgar": o arquivo ABRE (não é I/O nem
    // encoding) e não é um workflow. As linhas dele existem, mas nenhum passo
    // delas chega ao runner — julgar `bash -n` ali não mede nada.
    const root = tree({
      ".gitea/workflows/quebrado.yml": ["on:", "  push:", "jobs:", "\ta:", ""].join("\n"),
      ".gitea/workflows/ok.yml": "on:\n  push:\njobs:\n  a:\n    steps:\n      - run: echo ok\n",
    })
    const r = cli(["--root", root])
    expect(r.code).toBe(EXIT.UNAVAILABLE)
    expect(r.err).toContain(".gitea/workflows/quebrado.yml")
    expect(r.err).toContain("NÃO fazem parsing em YAML")
    // O workflow VÁLIDO do mesmo diretório continua julgado: a recusa é do
    // arquivo, não do escopo inteiro.
    expect(r.out).not.toContain("0 corpo(s) ")
    // E o `--fix` também não remenda num arquivo que não é workflow.
    const comFix = cli(["--root", root, "--fix"])
    expect(comFix.code).toBe(EXIT.UNAVAILABLE)
  })

  it("ilegível (não é UTF-8) → exit 2 — o `readFileSync` antigo devolvia mojibake", () => {
    const root = mkdtempSync(join(tmpdir(), "run-syntax-utf8-"))
    tmpDirs.push(root)
    mkdirSync(join(root, ".gitea", "workflows"), { recursive: true })
    writeFileSync(
      join(root, ".gitea", "workflows", "ilegivel.yml"),
      Buffer.concat([
        Buffer.from("on:\n  push:\njobs:\n  a:\n    steps:\n      - run: echo "),
        Buffer.from([0xff, 0xfe]),
        Buffer.from("\n"),
      ]),
    )
    const r = cli(["--root", root])
    expect(r.code).toBe(EXIT.UNAVAILABLE)
    expect(r.err).toContain("ilegivel.yml")
    expect(r.err).toContain("UTF-8")
  })
})

// ── 5. O repositório inteiro (o gate nasce ABSOLUTO) ───────────────────────

describe("o repositório real", () => {
  it("TODO corpo `run:` das duas forjas faz parsing (sem allowlist, sem cota)", () => {
    const { steps, skipped, unread, failures, indisponivel } = scan(ROOT, { bash: DEFAULT_BASH })
    expect(unread).toEqual([])
    expect(indisponivel).toBeNull()
    expect(skipped).toEqual([])
    expect(failures).toEqual([])
    // Um piso que também pega o gate "verde por não ter varrido nada".
    expect(steps.length).toBeGreaterThan(400)
  })

  it("e todo `shell:` declarado é um nome que a imagem MEDIDA tem (ou está dito que não é)", () => {
    const { skipped, indeterminate, shellFailures } = scan(ROOT, { bash: DEFAULT_BASH })
    expect(shellFailures).toEqual([])
    // O que sobra são passos nomeados: presentes no runner ou fora da medição.
    for (const s of skipped) expect(Object.keys(RUNNER_SHELLS)).toContain(s.shell?.trim())
    for (const s of indeterminate) {
      const nome = String(s.shell).trim()
      expect(Object.keys(RUNNER_SHELLS)).not.toContain(nome)
      expect(RUNNER_SHELLS_MISSING).not.toContain(nome)
    }
  })
})

// ── 6. O `shell:` declarado (a classe que o PARSING não pega) ──────────────

describe("a semântica do `shell:` — julgada contra o que o runner MEDIU", () => {
  it("a medição vem com a PROVA: digest, data e o comando que a produziu", () => {
    expect(RUNNER_IMAGE.digest).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(RUNNER_IMAGE.measuredAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(RUNNER_IMAGE.command).toContain("command -v")
    // A mesma lista não pode dizer que TEM e que NÃO TEM o mesmo nome.
    expect(Object.keys(RUNNER_SHELLS).filter((s) => RUNNER_SHELLS_MISSING.includes(s))).toEqual([])
  })

  it("shellCommandOf: nome com caminho, forma CUSTOM (`{0}`) e o basename como identidade", () => {
    expect(shellCommandOf("python3")).toEqual({ raw: "python3", custom: false, command: "python3" })
    expect(shellCommandOf("/usr/bin/zsh")).toMatchObject({ custom: false, command: "zsh" })
    expect(shellCommandOf("perl {0}")).toMatchObject({ custom: true, command: "perl" })
    expect(shellCommandOf("   ")).toBeNull()
  })

  it("os TRÊS desfechos de um passo não-bash: PRESENTE, ausente e fora da medição", () => {
    const root = tree({
      ".gitea/workflows/ci.yml": [
        "on:",
        "  push:",
        "jobs:",
        "  a:",
        "    steps:",
        "      - run: print(1)",
        "        shell: python3",
        "      - run: Write-Host oi",
        "        shell: pwsh",
        "      - run: nada",
        "        shell: ferramenta-inventada",
        "",
      ].join("\n"),
    })
    const c = collectRunBodies(root)
    expect(c.skipped.map((s) => s.shell)).toEqual(["python3"])
    expect(c.shellFailures.map((f) => f.command)).toEqual(["pwsh"])
    expect(c.indeterminate.map((s) => s.shell)).toEqual(["ferramenta-inventada"])
    // O passo reprovado nomeia o que o runner TEM: é prova, não opinião.
    expect(c.shellFailures[0].error).toContain("medido AUSENTE")
    expect(c.shellFailures[0].error).toContain("bash")
    // E o de fora da medição diz o que NÃO se sabe (nas duas direções).
    expect(c.indeterminate[0].detail).toContain("não está na medição")
    expect(c.indeterminate[0].detail).toContain("NEM que não tem")
  })

  it("a forma CUSTOM é julgada pelo NOME que invoca: `perl {0}` passa, `pwsh {0}` reprova", () => {
    const root = tree({
      ".gitea/workflows/ci.yml": [
        "on:",
        "  push:",
        "jobs:",
        "  a:",
        "    steps:",
        "      - run: print 1",
        "        shell: perl {0}",
        "      - run: Write-Host oi",
        "        shell: pwsh {0} -File",
        "",
      ].join("\n"),
    })
    const c = collectRunBodies(root)
    expect(c.skipped.map((s) => s.shell)).toEqual(["perl {0}"])
    expect(c.shellFailures.map((f) => f.command)).toEqual(["pwsh"])
    expect(c.indeterminate).toEqual([])
  })

  it("CLI: shell que o runner NÃO tem → exit 1, com o que o runner faria e onde", () => {
    const root = tree({
      ".gitea/workflows/ci.yml": [
        "on:",
        "  push:",
        "jobs:",
        "  a:",
        "    steps:",
        "      - run: Write-Host oi",
        "        shell: pwsh",
        "",
      ].join("\n"),
    })
    const r = cli(["--root", root])
    expect(r.code).toBe(EXIT.VIOLATIONS)
    expect(r.err).toContain(".gitea/workflows/ci.yml:6")
    expect(r.err).toContain("command not found")
    expect(r.err).toContain("`--shells`")
  })

  it("a REF é DERIVADA da fonte única — e sem BUN_VERSION é INDETERMINADA", () => {
    // A tag sai do MESMO resolver do compose (`ensure-runner-image`), com os
    // defaults do compose; um literal aqui seria um espelho de `BUN_VERSION`.
    expect(
      runnerImageRef({ IMAGE_REGISTRY: "reg.io", IMAGE_NAMESPACE: "org", BUN_VERSION: "9.9.9" }),
    ).toBe("reg.io/org/ubuntu-bun:9.9.9")
    expect(runnerImageRef({ BUN_VERSION: "1.2.3" })).toBe("ghcr.io/severinno/ubuntu-bun:1.2.3")
    // Sem BUN_VERSION NÃO há ref: o gate não presume qual imagem foi medida.
    expect(runnerImageRef({})).toBeNull()
    expect(runnerImageRef({ IMAGE_REGISTRY: "reg.io", BUN_VERSION: "  " })).toBeNull()
  })

  it("CLI: `--shells` imprime a medição e o COMANDO que a produziu (exit 0)", () => {
    const r = cli(["--shells"], { BUN_VERSION: "1.3.14" })
    expect(r.code).toBe(EXIT.OK)
    expect(r.out).toContain("ghcr.io/severinno/ubuntu-bun:1.3.14")
    expect(r.out).toContain(RUNNER_IMAGE.digest)
    expect(r.out).toContain(RUNNER_IMAGE.measuredAt)
    expect(r.out).toContain("command -v")
    for (const nome of Object.keys(RUNNER_SHELLS)) expect(r.out).toContain(nome)
    expect(r.out).toContain("INDETERMINADO")
  })

  it("CLI: sem BUN_VERSION o `--shells` diz INDETERMINADO em vez de presumir a tag", () => {
    const r = cli(["--shells"], { BUN_VERSION: "" })
    expect(r.code).toBe(EXIT.OK)
    expect(r.out).toContain("INDETERMINADO")
    expect(r.out).toContain("defina BUN_VERSION")
    // As provas que NÃO se derivam continuam ditas.
    expect(r.out).toContain(RUNNER_IMAGE.digest)
    expect(r.out).toContain("command -v")
  })

  it("CLI: `--json` carrega os três desfechos (e o ausente já é exit 1)", () => {
    const root = tree({
      ".gitea/workflows/ci.yml": [
        "on:",
        "  push:",
        "jobs:",
        "  a:",
        "    steps:",
        "      - run: print(1)",
        "        shell: python3",
        "      - run: nada",
        "        shell: ferramenta-inventada",
        "",
      ].join("\n"),
    })
    const r = cli(["--root", root, "--json"])
    expect(r.code).toBe(EXIT.OK)
    const data = JSON.parse(r.out) as {
      skipped: { shell: string }[]
      indeterminate: { shell: string }[]
      shellFailures: { command: string }[]
    }
    expect(data.skipped.map((s) => s.shell)).toEqual(["python3"])
    expect(data.indeterminate.map((s) => s.shell)).toEqual(["ferramenta-inventada"])
    expect(data.shellFailures).toEqual([])
  })
})

// ── 7. O `--fix`: a cicatriz MECÂNICA, medida antes e depois de gravar ────

const SCAR_UM = [
  "on:",
  "  push:",
  "jobs:",
  "  a:",
  "    steps:",
  "      - name: a",
  "        run: |",
  '          echo "um" &&',
  "      - name: b",
  "        run: |",
  '          echo "dois" |',
  "      - name: c",
  "        run: |",
  "          echo ok",
  "",
].join("\n")

describe("mendBody — a cicatriz conhecida, e só ela", () => {
  it("tira o operador pendente da última linha PRESERVANDO a indentação", () => {
    const m = mendBody('  echo "a" &&') as Mendado
    expect(m.mended).toBe(true)
    expect(m.operador).toBe("&&")
    expect(m.depois).toBe('  echo "a"')
    expect(m.body).toBe('  echo "a"')
  })

  it("`&` e `;` NÃO são cicatriz: eles FECHAM comando (`sleep 1 &` é válido)", () => {
    expect((mendBody("  sleep 1 &") as Mendado).mended).toBe(false)
    expect((mendBody("  echo a;") as Mendado).mended).toBe(false)
    expect((mendBody("  echo a &;") as Mendado).reason).toContain("OPERADOR PENDENTE")
  })

  it("heredoc é recusado (o texto é DADO) e o motivo é escrito", () => {
    const m = mendBody("  cat <<'EOF'\n  x") as Mendado
    expect(m.mended).toBe(false)
    expect(m.reason).toContain("heredoc")
  })

  it("sem operador pendente, RECUSA — não adivinha a intenção", () => {
    const m = mendBody("  if [ -f x ]; then\n    echo a") as Mendado
    expect(m.mended).toBe(false)
    expect(m.reason).toContain("não termina em OPERADOR PENDENTE")
  })

  it("um corpo que viraria VAZIO não é remendado (o passo deixaria de rodar o que diz)", () => {
    const m = mendBody("  &&") as Mendado
    expect(m.mended).toBe(false)
    expect(m.reason).toContain("VAZIO")
  })

  it("os operadores de continuação são reconhecidos (e o de terminação não)", () => {
    for (const op of ["\\", "&&", "||", "|", "<<<", ">>", ">", "<"]) {
      const m = mendBody(`  echo a ${op}`) as Mendado
      expect(m.mended, `\`${op}\` devia ser cicatriz`).toBe(true)
    }
  })
})

describe("fixWorkflow — o remendo só é gravado quando ele MEDE o efeito", () => {
  it("grava o remendo no disco e o corpo volta a fazer parsing", () => {
    const root = tree({ ".gitea/workflows/ci.yml": SCAR_UM })
    const caminho = join(root, ".gitea/workflows/ci.yml")
    const antes = readFileSync(caminho, "utf8")
    const s = scan(root)
    expect(s.failures).toHaveLength(2)
    const r = fixWorkflow(root, s.failures[0]) as Remendo
    expect(r.fixed).toBe(true)
    expect(r.operador).toBe("&&")
    const depois = readFileSync(caminho, "utf8")
    expect(depois).not.toBe(antes)
    expect(depois).toContain('          echo "um"\n')
    expect(depois).not.toContain('echo "um" &&')
  })

  it("se o corpo NO DISCO continuar sem fazer parsing, a gravação é DESFEITA", () => {
    const root = tree({ ".gitea/workflows/ci.yml": SCAR_UM })
    const caminho = join(root, ".gitea/workflows/ci.yml")
    const original = readFileSync(caminho, "utf8")
    const s = scan(root)
    const gravacoes: string[] = []
    // Um `write` que NÃO grava: quem mede o efeito é a releitura do disco.
    const r = fixWorkflow(root, s.failures[0], {
      write: (_p: string, conteudo: string) => {
        gravacoes.push(conteudo)
      },
    }) as Remendo
    expect(r.fixed).toBe(false)
    expect(r.reason).toContain("DESFEITA")
    // DUAS gravações: a tentativa e a RESTAURAÇÃO do conteúdo original.
    expect(gravacoes).toHaveLength(2)
    expect(gravacoes[0]).not.toBe(original)
    expect(gravacoes[1]).toBe(original)
  })

  it("as recusas são DITAS e nada é gravado: dobrada, heredoc e não-cicatriz", () => {
    const root = tree({
      ".gitea/workflows/ci.yml": [
        "on:",
        "  push:",
        "jobs:",
        "  a:",
        "    steps:",
        "      - name: dobrada",
        "        run: >-",
        '          echo "d" &&',
        "      - name: heredoc",
        "        run: |",
        "          cat <<'EOF'",
        "          x",
        "      - name: sem fi",
        "        run: |",
        "          if [ -f x ]; then",
        "            echo a",
        "",
      ].join("\n"),
    })
    const caminho = join(root, ".gitea/workflows/ci.yml")
    const antes = readFileSync(caminho, "utf8")
    const r = fixAllBruto(root) as { fixed: Remendo[]; refused: (Remendo & { reason: string })[] }
    expect(r.fixed).toEqual([])
    expect(r.refused).toHaveLength(3)
    const motivos = r.refused.map((f) => f.reason).join("\n")
    expect(motivos).toContain("não declara bloco LITERAL")
    expect(motivos).toContain("heredoc")
    expect(motivos).toContain("não termina em OPERADOR PENDENTE")
    expect(readFileSync(caminho, "utf8")).toBe(antes)
  })

  it("CLI --fix: aplica, fica verde, e é idempotente (não inventa a segunda cicatriz)", () => {
    const root = tree({ ".gitea/workflows/ci.yml": SCAR_UM })
    const primeiro = cli(["--root", root, "--fix"])
    expect(primeiro.code).toBe(EXIT.OK)
    expect(primeiro.out).toContain("remendo aplicado: operador pendente `&&` removido")
    expect(primeiro.out).toContain("NÃO reconstrói a linha engolida")
    expect(primeiro.out).toContain("2 corpo(s) remendado(s)")
    expect(cli(["--root", root]).code).toBe(EXIT.OK)
    const segundo = cli(["--root", root, "--fix"])
    expect(segundo.code).toBe(EXIT.OK)
    expect(segundo.out).toContain("não há cicatriz para remendar")
  })

  it("CLI: `--fix` com `--staged` ou `--json` é uso inválido (exit 3) — não promete o que não faz", () => {
    expect(cli(["--fix", "--staged"]).code).toBe(EXIT.USAGE)
    expect(cli(["--fix", "--json"]).code).toBe(EXIT.USAGE)
    expect(cli(["--fix", "--staged"]).err).toContain("ÁRVORE")
  })

  it("`dry` é PREVIEW: prevê o remendo e NÃO escreve — e a previsão é a mesma da gravação", () => {
    // O preview existe para quem precisa da CONFIRMAÇÃO antes de tocar no arquivo
    // (o remédio do pre-commit). Ele julga pelo MESMO caminho de decisão: o que
    // ele promete é o que a gravação faz — senão a pergunta seria sobre outra coisa.
    const root = tree({ ".gitea/workflows/ci.yml": SCAR_UM })
    const caminho = join(root, ".gitea/workflows/ci.yml")
    const antes = readFileSync(caminho, "utf8")
    const previsto = fixAllBruto(root, { dry: true }) as {
      fixed: (Remendo & { applied?: boolean })[]
      refused: unknown[]
    }
    expect(previsto.fixed).toHaveLength(2)
    expect(previsto.fixed.every((f) => f.applied === false)).toBe(true)
    expect(readFileSync(caminho, "utf8")).toBe(antes) // NADA escrito

    const aplicado = fixAllBruto(root) as { fixed: (Remendo & { applied?: boolean })[] }
    expect(aplicado.fixed.map((f) => f.antes)).toEqual(previsto.fixed.map((f) => f.antes))
    expect(aplicado.fixed.map((f) => f.depois)).toEqual(previsto.fixed.map((f) => f.depois))
    expect(aplicado.fixed.every((f) => f.applied === true)).toBe(true)
    expect(readFileSync(caminho, "utf8")).not.toBe(antes)
  })

  it("`dry` NÃO inventa remendável: o refusal continua refusal (nada previsto, nada escrito)", () => {
    const root = tree({
      ".gitea/workflows/ci.yml": [
        "on:",
        "  push:",
        "jobs:",
        "  a:",
        "    steps:",
        "      - run: |",
        "          if [ -f x ]; then",
        "            echo a",
        "",
      ].join("\n"),
    })
    const caminho = join(root, ".gitea/workflows/ci.yml")
    const antes = readFileSync(caminho, "utf8")
    const r = fixAllBruto(root, { dry: true }) as {
      fixed: unknown[]
      refused: { reason: string }[]
    }
    expect(r.fixed).toEqual([])
    expect(r.refused).toHaveLength(1)
    expect(r.refused[0]?.reason).toContain("OPERADOR PENDENTE")
    expect(readFileSync(caminho, "utf8")).toBe(antes)
  })

  it("fixAll: `fixed` e `refused` cobrem TODA falha de parsing (nenhuma some em silêncio)", () => {
    const root = tree({
      ".gitea/workflows/ci.yml": [
        "on:",
        "  push:",
        "jobs:",
        "  a:",
        "    steps:",
        "      - run: |",
        '          echo "um" &&',
        "      - run: |",
        "          if [ -f x ]; then",
        "            echo a",
        "",
      ].join("\n"),
    })
    const s = scan(root)
    const r = fixAllBruto(root) as { fixed: unknown[]; refused: unknown[] }
    expect(s.failures.length).toBe(2)
    expect(r.fixed.length + r.refused.length).toBe(s.failures.length)
  })
})

// ── 9. A SEGUNDA fonte: os scripts de shell do repositório ────────────────
//
// O corpo de um passo morre no runner; um script morre no PASSO que o executa.
// É a mesma classe de defeito e o mesmo parser — o que muda é a FONTE do texto
// (e, por isso, a declaração do interpretador: `shell:` num passo, SHEBANG num
// arquivo).

describe("a SEGUNDA fonte — os scripts de shell, pelo mesmo `bash -n`", () => {
  it("interpreterOf: o shebang é a DECLARAÇÃO (env desembrulhado, basename como identidade)", () => {
    expect(interpreterOf("#!/usr/bin/env bash\necho oi\n")).toEqual({
      raw: "#!/usr/bin/env bash",
      command: "bash",
      declared: true,
    })
    expect(interpreterOf("#!/bin/sh\n").command).toBe("sh")
    expect(interpreterOf("#!/bin/bash -e\n").command).toBe("bash")
    expect(interpreterOf("#!/usr/bin/env python3\n").command).toBe("python3")
    // Sem shebang NÃO há declaração: cai na premissa do `isBashShell`, como o
    // passo sem `shell:` cai na premissa do runner.
    expect(interpreterOf("set -eu\necho oi\n")).toEqual({
      raw: null,
      command: null,
      declared: false,
    })
  })

  it("três desfechos, nenhum silencioso: bash JULGA, python PULA com motivo, vazio NOMEIA", () => {
    const root = tree({
      "scripts/bom.sh": "#!/usr/bin/env bash\necho oi\n",
      "scripts/py.sh": "#!/usr/bin/env python3\nprint('oi')\n",
      "scripts/vazio.sh": "",
      ".husky/pre-commit": "set -eu\necho hook\n",
    })
    const c = collectShellScripts(root)
    expect(c.files).toEqual([
      ".husky/pre-commit",
      "scripts/bom.sh",
      "scripts/py.sh",
      "scripts/vazio.sh",
    ])
    expect(c.scripts.map((s) => s.file)).toEqual([".husky/pre-commit", "scripts/bom.sh"])
    // O hook do husky não tem shebang e é JULGADO (o husky o roda com `sh`):
    // tratar "sem declaração" como "fora do escopo" seria varrer menos do que diz.
    const hook = c.scripts.find((s) => s.file === ".husky/pre-commit")
    expect(hook?.fonte).toBe("premissa")
    expect(hook?.interpreter).toBe("sh")
    expect(c.skipped.find((s) => s.file === "scripts/py.sh")?.detail).toContain("NÃO é bash")
    expect(c.skipped.find((s) => s.file === "scripts/vazio.sh")?.detail).toContain("VAZIO")
  })

  it("o escopo é o do `listShellScripts`: node_modules e artefato de build NÃO entram", () => {
    const root = tree({
      "scripts/bom.sh": "#!/usr/bin/env bash\necho oi\n",
      "node_modules/x/ruim.sh": "#!/usr/bin/env bash\nif [ -f x ]; then\n",
      "coverage/y/ruim.sh": "#!/usr/bin/env bash\nif [ -f x ]; then\n",
    })
    const c = collectShellScripts(root)
    expect(c.files).toEqual(["scripts/bom.sh"])
    expect(scan(root).scriptFailures).toEqual([])
  })

  it("o arquivo quebrado é acusado como ARQUIVO (com o erro do bash e o interpretador)", () => {
    const root = tree({ "scripts/quebrado.sh": "#!/usr/bin/env bash\nif [ -f x ]; then\necho a\n" })
    const s = scan(root)
    expect(s.failures).toEqual([])
    expect(s.scriptFailures).toHaveLength(1)
    expect(s.scriptFailures[0]?.file).toBe("scripts/quebrado.sh")
    expect(s.scriptFailures[0]?.kind).toBe("erro")
    expect(s.scriptFailures[0]?.interpreter).toBe("bash")
    expect(s.scriptFailures[0]?.error).toContain("unexpected end of file")
  })

  it("no arquivo o AVISO também reprova (heredoc sem terminador: o bash sai 0)", () => {
    const root = tree({ "scripts/h.sh": "#!/usr/bin/env bash\ncat <<'EOF'\n" })
    const s = scan(root)
    expect(s.scriptFailures).toHaveLength(1)
    expect(s.scriptFailures[0]?.kind).toBe("aviso")
  })

  it("FAIL-CLOSED: `--staged` sem repositório git NÃO vira '0 violações'", () => {
    const root = tree({ "scripts/bom.sh": "#!/usr/bin/env bash\necho oi\n" })
    expect(scan(root, { staged: true }).unread.length).toBeGreaterThan(0)
    expect(cli(["--root", root, "--staged"]).code).toBe(EXIT.UNAVAILABLE)
  })

  it("CLI: arquivo quebrado → exit 1 nomeando o ARQUIVO (a mesma classe do corpo)", () => {
    const root = tree({ "scripts/quebrado.sh": "#!/usr/bin/env bash\nif [ -x ]; then\n" })
    const r = cli(["--root", root])
    expect(r.code).toBe(EXIT.VIOLATIONS)
    expect(r.err).toContain("arquivo(s) de shell")
    expect(r.err).toContain("scripts/quebrado.sh")
    expect(r.err).toContain("interpretador: `bash`")
  })

  it("CLI --json: os DOIS escopos no mesmo payload (e o mesmo exit code)", () => {
    const root = tree({
      "scripts/bom.sh": "#!/usr/bin/env bash\necho oi\n",
      ".husky/pre-commit": "set -eu\necho h\n",
    })
    const ok = cli(["--root", root, "--json"])
    const j = JSON.parse(ok.out)
    expect(ok.code).toBe(EXIT.OK)
    expect(j.arquivosDeShell).toEqual([".husky/pre-commit", "scripts/bom.sh"])
    expect(j.scripts).toBe(2)
    expect(j.scriptFailures).toEqual([])
  })

  it("`--fix` RECUSA remendar arquivo de shell — e NÃO toca no arquivo", () => {
    const root = tree({ "scripts/quebrado.sh": "#!/usr/bin/env bash\nif [ -x ]; then\n" })
    const alvo = join(root, "scripts/quebrado.sh")
    const antes = readFileSync(alvo, "utf8")
    const r = cli(["--root", root, "--fix"])
    // Recusa é VEREDITO, não sucesso: um "✓" aqui esconderia um script quebrado.
    expect(r.code).toBe(EXIT.VIOLATIONS)
    expect(r.err).toContain("NÃO remendado")
    expect(r.err).toContain("arquivo de shell")
    expect(readFileSync(alvo, "utf8")).toBe(antes)
  })

  it("o repositório real: TODO script de shell versionado faz parsing (sem allowlist)", () => {
    const { shellFiles, shellScripts, scriptSkipped, scriptFailures } = scan(ROOT, {
      bash: DEFAULT_BASH,
    })
    expect(scriptFailures).toEqual([])
    expect(scriptSkipped).toEqual([])
    // A lista do `listShellScripts` é a MESMA da varredura do SIGPIPE: os
    // `*.sh` e os hooks do `.husky/` (sem extensão, e ainda assim shell).
    expect(shellScripts.length).toBe(shellFiles.length)
    expect(shellFiles).toContain("scripts/check-utf8.sh")
    expect(shellFiles).toContain(".husky/pre-commit")
    // Um piso que também pega o gate "verde por não ter varrido nada".
    expect(shellFiles.length).toBeGreaterThan(100)
  })
})

// ── 9. A TERCEIRA FONTE: o shell EMBUTIDO ──────────────────────────────────
//
// O texto que não é corpo de passo nem arquivo de script — e que por isso não
// era julgado por NINGUÉM: a instrução `RUN` de um Dockerfile (o shell do BUILD)
// e o payload de um `sh -c` (uma STRING para o parser do arquivo que o contém).
// O que precisa ser provado é o que cada desfecho PROMETE: o que é julgado, o
// que sai NOMEADO, o que sai INDETERMINADO — e que nada vira "0 violações" por
// ter ficado de fora em silêncio.

describe("dockerfileRunUnits — o shell do BUILD", () => {
  it("junta a CONTINUAÇÃO: o texto julgado é o da INSTRUÇÃO, não o da primeira linha", () => {
    const dockerfile = [
      "FROM alpine",
      "RUN set -euo pipefail \\",
      "  && echo um \\",
      "  && echo dois",
      "",
    ].join("\n")
    const { units } = dockerfileRunUnits(dockerfile, { file: "Dockerfile" })
    expect(units).toHaveLength(1)
    expect(units[0]).toMatchObject({ file: "Dockerfile", line: 2, fonte: "RUN (forma shell)" })
    expect(units[0].body).toContain("set -euo pipefail")
    expect(units[0].body).toContain("echo dois")
    // A LINHA é a da instrução (o começo), não a da última linha da continuação:
    // é ali que o operador procura a causa.
    expect(units[0].line).toBe(2)
  })

  it("descarta o COMENTÁRIO dentro da continuação (o docker o descarta antes do shell)", () => {
    const dockerfile = [
      "FROM alpine",
      "RUN echo um \\",
      "  # nota do autor \\",
      "  && echo dois",
      "",
    ].join("\n")
    const { units } = dockerfileRunUnits(dockerfile, { file: "Dockerfile" })
    expect(units[0].body).toBe("echo um  && echo dois")
    expect(units[0].body).not.toContain("nota do autor")
  })

  it("tira as FLAGS do docker (`--mount=`) — elas não chegam ao shell", () => {
    const { units } = dockerfileRunUnits(
      ["FROM alpine", "RUN --mount=type=cache,target=/root/.cache apt-get update", ""].join("\n"),
      { file: "Dockerfile" },
    )
    expect(units[0].body).toBe("apt-get update")
  })

  it("forma HEREDOC: o CORPO é o script (e o terminador não entra no texto julgado)", () => {
    const dockerfile = [
      "FROM alpine",
      "RUN <<'EOF'",
      "set -euo pipefail",
      "echo um",
      "EOF",
      "CMD echo fim",
      "",
    ].join("\n")
    const { units } = dockerfileRunUnits(dockerfile, { file: "Dockerfile" })
    expect(units).toHaveLength(1)
    expect(units[0].fonte).toContain("heredoc")
    expect(units[0].body).toBe("set -euo pipefail\necho um")
  })

  it("heredoc SEM terminador → INDETERMINADO (nomeado), nunca 'nada a julgar'", () => {
    const dockerfile = ["FROM alpine", "RUN <<'EOF'", "echo um", ""].join("\n")
    const { units, indeterminate } = dockerfileRunUnits(dockerfile, { file: "Dockerfile" })
    expect(units).toEqual([])
    expect(indeterminate).toHaveLength(1)
    expect(indeterminate[0].detail).toContain("terminador")
  })

  it("forma EXEC: o `-c` de um shell é julgado (o arg é LITERAL) e o resto sai PULADO e nomeado", () => {
    const comShell = dockerfileRunUnits(
      'FROM alpine\nRUN ["bash", "-c", "if [ 1 = 1 ]; then echo sem fi"]\n',
      { file: "Dockerfile" },
    )
    expect(comShell.units).toHaveLength(1)
    expect(comShell.units[0].body).toBe("if [ 1 = 1 ]; then echo sem fi")
    expect(comShell.units[0].fonte).toContain("EXEC")
    // `$` num ARGV é TEXTO (quem expande é o shell INTERNO): julga-se ele.
    expect(argvPayload(["bash", "-c", "echo $cmd"])?.payload?.body).toBe("echo $cmd")
    const semShell = dockerfileRunUnits('FROM alpine\nRUN ["apk", "add", "bash"]\n', {
      file: "Dockerfile",
    })
    expect(semShell.units).toEqual([])
    expect(semShell.skipped).toHaveLength(1)
    expect(semShell.skipped[0].detail).toContain("execve")
  })

  it("EXEC que não faz parsing em JSON → INDETERMINADO (o gate não sabe o que o docker rodaria)", () => {
    const { units, indeterminate } = dockerfileRunUnits('FROM alpine\nRUN [bash, -c, "x"]\n', {
      file: "Dockerfile",
    })
    expect(units).toEqual([])
    expect(indeterminate).toHaveLength(1)
  })
})

describe("embeddedPayloads — o payload do `sh -c`", () => {
  it("payload LITERAL é julgado, com a LINHA do token", () => {
    const texto = ["set -euo pipefail", 'bash -c "if [ -f x ]; then"', "echo depois"].join("\n")
    const { payloads } = embeddedPayloads(texto)
    expect(payloads).toHaveLength(1)
    expect(payloads[0].body).toBe("if [ -f x ]; then")
    expect(payloads[0].linha).toBe(2)
    expect(checkBody(payloads[0].body).ok).toBe(false)
  })

  it("payload de VARIÁVEL sai INDETERMINADO — o texto só existe em runtime", () => {
    const { payloads, indeterminado } = embeddedPayloads('bash -c "$cmd"')
    expect(payloads).toEqual([])
    expect(indeterminado).toHaveLength(1)
    expect(indeterminado[0].detail).toContain("runtime")
  })

  it("quote SIMPLES é literal por definição (o `$` não é do shell externo)", () => {
    const { payloads, indeterminado } = embeddedPayloads("sh -c 'echo $cmd'")
    expect(indeterminado).toEqual([])
    expect(payloads).toHaveLength(1)
    expect(payloads[0].body).toBe("echo $cmd")
  })

  it("`python3 -c` NÃO é shell (não vira alvo — e não inventa violação)", () => {
    const { payloads, indeterminado, pular } = embeddedPayloads(
      'python3 -c "import urllib.request; urllib.request.urlopen(1)"',
    )
    expect(payloads).toEqual([])
    expect(indeterminado).toEqual([])
    expect(pular).toEqual([])
  })

  it("COMENTÁRIO e corpo de HEREDOC não são código: nenhum alvo ali", () => {
    const comentario = ['# bash -c "if [ 1 ]; then"', 'echo "ok"'].join("\n")
    expect(embeddedPayloads(comentario).payloads).toEqual([])
    const heredoc = ["cat <<'EOF'", 'bash -c "if [ 1 ]; then"', "EOF"].join("\n")
    expect(embeddedPayloads(heredoc).payloads).toEqual([])
    // A CONTRA-PROVA: fora do heredoc, o mesmo texto é alvo.
    const fora = ["cat <<'EOF'", 'bash -c "if [ 1 ]; then"', "EOF", 'sh -c "if [ 2 ]; then"'].join(
      "\n",
    )
    expect(embeddedPayloads(fora).payloads).toHaveLength(1)
    expect(embeddedPayloads(fora).payloads[0].linha).toBe(4)
  })

  it("tokenização: a quote atravessa LINHAS (o payload multi-linha é um token só)", () => {
    const toks = shellTokens('sh -c "linha um\nlinha dois"')
    expect(toks).toHaveLength(3)
    expect(toks[2].inner).toBe("linha um\nlinha dois")
    expect(shellTokens("echo 'a b' c")[0].valor).toBe("echo")
  })

  it("`-c` sem texto adiante → INDETERMINADO (a flag está lá e o payload não)", () => {
    expect(embeddedPayloads("bash -c").indeterminado).toHaveLength(1)
  })
})

describe("yamlEmbeddedPayloads — o shell embutido do YAML", () => {
  const raw = [
    "services:",
    "  minio-init:",
    "    entrypoint:",
    "      - /bin/sh",
    "      - -c",
    "      - |",
    '        echo "oi"',
    "        command -v mc",
    "",
  ].join("\n")
  const doc = {
    services: { "minio-init": { entrypoint: ["/bin/sh", "-c", 'echo "oi"\ncommand -v mc'] } },
  }

  it("lista em BLOCO entrega o CORPO do script, não a marca de lista do YAML", () => {
    const { payloads } = yamlEmbeddedPayloads(doc, raw)
    expect(payloads).toHaveLength(1)
    expect(payloads[0].body).toBe('echo "oi"\ncommand -v mc')
    // A linha vem da LOCALIZAÇÃO do texto no arquivo (o js-yaml dá valor, não marca).
    expect(payloads[0].linha).toBe(7)
  })

  it("lista em FLOW e `CMD-SHELL` são shell embutido; `-c` de python NÃO é", () => {
    const flow = { test: ["CMD", "sh", "-c", "pg_isready -U x"] }
    expect(yamlEmbeddedPayloads(flow, "").payloads[0].body).toBe("pg_isready -U x")
    const cmdShell = { test: ["CMD-SHELL", "wget -q -O /dev/null http://x || exit 1"] }
    const r = yamlEmbeddedPayloads(cmdShell, "")
    expect(r.payloads[0].body).toContain("wget")
    expect(r.payloads[0].fonte).toContain("CMD-SHELL")
    const python = { test: ["CMD", "python3", "-c", "import urllib.request"] }
    expect(yamlEmbeddedPayloads(python, "").payloads).toEqual([])
  })

  it("escalar (`entrypoint: >`) é TEXT de shell — e o limite da variável é o do TEXTO INTEIRO", () => {
    // Payload que é SÓ a variável: o texto não está escrito em lugar nenhum.
    expect(
      yamlEmbeddedPayloads({ entrypoint: '/bin/sh -c "$cmd"' }, "").indeterminado,
    ).toHaveLength(1)
    // Payload com TEXTO em volta: o shell INTERNO recebe texto (a variável do
    // meio é um valor, não sintaxe) — julgar os dois é o mesmo contrato.
    const r = yamlEmbeddedPayloads({ entrypoint: '/bin/sh -c "echo $cmd"' }, "")
    expect(r.indeterminado).toEqual([])
    expect(r.payloads[0].body).toBe("echo $cmd")
  })
})

describe("A TERCEIRA FONTE no veredito (e nenhum alvo invisível)", () => {
  it("um Dockerfile NOVO num diretório novo entra na varredura (por NOME, não por lista à mão)", () => {
    const root = tree({ "servicos/novo/Dockerfile.svc": "FROM alpine\nRUN echo oi\n" })
    expect(embeddedPaths(root)).toContain("servicos/novo/Dockerfile.svc")
    const r = scan(root, { bash: DEFAULT_BASH })
    expect(r.embeddedUnits.map((u) => u.file)).toEqual(["servicos/novo/Dockerfile.svc"])
  })

  it("`RUN` quebrado → exit 1, com a headline PRÓPRIA e o arquivo:linha", () => {
    const root = tree({ Dockerfile: "FROM alpine\nRUN echo um && \\\n  echo dois &&\n" })
    const r = cli(["--root", root])
    expect(r.code).toBe(EXIT.VIOLATIONS)
    expect(r.err).toContain("instrução(ões) EMBUTIDA(s)")
    expect(r.err).toContain("Dockerfile:2")
  })

  it("payload quebrado → exit 1, com a headline PRÓPRIA (o arquivo que o contém é válido)", () => {
    const root = tree({
      "scripts/quebra.sh":
        '#!/usr/bin/env bash\nset -euo pipefail\nbash -c "if [ 1 = 1 ]; then echo sem fi"\n',
    })
    const r = cli(["--root", root])
    expect(r.code).toBe(EXIT.VIOLATIONS)
    // O `bash -n` do ARQUIVO passa (a metade das duas primeiras fontes fica verde):
    // é exatamente o buraco que esta fonte fecha.
    expect(r.err).toContain("payload(s) de `sh -c`/`bash -c`")
    expect(r.err).toContain("scripts/quebra.sh:3")
  })

  it("o `$$` do compose é ESCAPE: o shell do container recebe o `$` desescapado", () => {
    expect(maskComposeEscapes("RESPONSE=$$(curl -s http://x)")).toBe("RESPONSE=$(curl -s http://x)")
    const root = tree({
      "docker-compose.dev.yml": [
        "services:",
        "  a:",
        "    entrypoint: >",
        '      /bin/sh -c "',
        "      RESPONSE=$$(curl -s http://x)",
        '      "',
        "",
      ].join("\n"),
    })
    expect(cli(["--root", root]).code).toBe(EXIT.OK)
  })

  it("`--fix` RECUSA remendar shell embutido — e NÃO toca no arquivo", () => {
    const root = tree({ Dockerfile: "FROM alpine\nRUN echo um &&\n" })
    const alvo = join(root, "Dockerfile")
    const antes = readFileSync(alvo, "utf8")
    const r = cli(["--root", root, "--fix"])
    expect(r.code).toBe(EXIT.VIOLATIONS)
    expect(r.err).toContain("NÃO remendado")
    expect(r.err).toContain("shell embutido")
    expect(readFileSync(alvo, "utf8")).toBe(antes)
  })

  it("o repositório real: nenhum `RUN` nem payload reprovado — e os dois conjuntos NÃO estão vazios", () => {
    const r = collectEmbeddedShell(ROOT, {})
    expect(r.unread).toEqual([])
    const s = scan(ROOT, { bash: DEFAULT_BASH })
    expect(s.embeddedFailures).toEqual([])
    expect(s.payloadFailures).toEqual([])
    // Um piso para o gate "verde por não ter varrido nada": os Dockerfiles do
    // repositório têm instruções de shell, e os composes têm `entrypoint`.
    expect(s.embeddedUnits.length).toBeGreaterThan(10)
    expect(s.embeddedPayloads.length).toBeGreaterThan(10)
    expect(s.embeddedFiles).toContain("Dockerfile.ubuntu-bun")
    expect(s.embeddedFiles).toContain("deploy/docker-compose.gitea.yml")
    // O que o gate NÃO julga, ele DIZ: o payload montado em runtime fica nomeado.
    expect(s.embeddedIndeterminate.length).toBeGreaterThan(0)
  })
})

// ── 10. A régua compartilhada (heredoc) ────────────────────────────────────

describe("lineOfText — a linha de um texto dentro do arquivo", () => {
  it("acha a linha pela primeira linha DISTINTIVA, e é `null` quando é ambíguo", () => {
    const raw = ["a", "set -e", "b", "set -e", "assinatura unica"].join("\n")
    expect(lineOfText(raw, "set -e\nassinatura unica")).toBe(5)
    // Nenhuma linha do texto é única: dizer `null` é honesto, apontar a errada não.
    expect(lineOfText(raw, "set -e")).toBeNull()
  })
})
