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
//   5. o repositório inteiro passa (o gate nasce ABSOLUTO: sem allowlist).
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
  checkBody as checkBodyBruto,
  collectRunBodies as collectBruto,
  fixAll as fixAllBruto,
  fixWorkflow,
  isBashShell,
  maskExpressions,
  mendBody,
  runnerImageRef,
  scan as scanBruto,
  shellCommandOf,
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
type ResultadoScan = Coleta & {
  failures: (Corpo & { kind: string; error: string })[]
  indisponivel: string | null
}
type Veredito = {
  ok: boolean
  unavailable?: boolean
  status: number | null
  kind: "erro" | "aviso" | null
  detail: string
}

const collectRunBodies = (root: string) => collectBruto(root) as Coleta
const scan = (root: string, opts: Record<string, unknown> = {}) =>
  scanBruto(root, opts) as ResultadoScan
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
    expect(r.out).toContain("1 corpo(s) `run:` passam em")
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
