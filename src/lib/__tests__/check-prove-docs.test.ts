// =============================================================================
// check-prove-docs.test.ts
//
// Testes do scripts/check-prove-docs.mjs — o guard que exige, para CADA comando
// da família `prove-*`/`doctor`, um BLOCO DOCUMENTADO com o resultado esperado, e
// que CONFRONTA esse bloco com a saída REAL.
//
// O que estes testes precisam provar (não é "roda sem erro"):
//   1. a FAMÍLIA é derivada de package.json — o `doctor:issue` (publicador, não
//      medidor) fica de fora, e um comando novo entra sozinho;
//   2. o PARSER lê o marcador + a cerca, e NÃO confunde o EXEMPLO de formato
//      (que vive dentro de uma cerca, na própria doc do guard) com um bloco real;
//   3. a cobertura fecha nos DOIS sentidos: comando sem bloco E bloco órfão;
//   4. a FIDELIDADE morde: exit real fora do declarado e linha exigida ausente
//      da saída real são VIOLAÇÃO — é a razão de o guard existir;
//   5. `cenario: docker-ausente` cria mesmo o cenário (um `docker` que falha no
//      PATH), e o comando que passa a sair 0 sem provar nada é pego por ele.
//
// Usage:
//   bunx vitest run --config vitest.config.unit.ts src/lib/__tests__/check-prove-docs.test.ts
// =============================================================================

import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterAll, describe, expect, it } from "vitest"

import {
  DESFECHOS,
  DOC_MARKER,
  audit,
  checkCoverage,
  discoverFamily,
  docSources,
  missingLines,
  normalizeOutput,
  parseDocBlocks,
  parseMarkerHead,
  runBlock,
  validateFields,
} from "../../../scripts/check-prove-docs.mjs"

const ROOT = process.cwd()
const SCRIPT = join(ROOT, "scripts", "check-prove-docs.mjs")

const tmpDirs: string[] = []

function makeTmp(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `prove-docs-${name}-`))
  tmpDirs.push(dir)
  return dir
}

afterAll(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** Roda a CLI real contra um root (fixture). */
function runCli(args: string[]): { status: number; out: string } {
  const res = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" })
  return { status: res.status ?? -1, out: `${res.stdout ?? ""}\n${res.stderr ?? ""}` }
}

/** Um bloco documentado bem formado, para os testes de parsing. */
function docBlock(
  command: string,
  {
    run = "--json",
    exit = "0",
    cenario = "ambiente",
    desfecho = "provado",
    lines = ['"ok": true'],
  }: {
    run?: string
    exit?: string
    cenario?: string
    desfecho?: string
    lines?: string[]
  } = {},
): string {
  return [
    `<!-- ${DOC_MARKER}: ${command}`,
    `     run: ${run}`,
    `     exit: ${exit}`,
    `     cenario: ${cenario}`,
    `     desfecho: ${desfecho}`,
    `-->`,
    "",
    "```text",
    ...lines,
    "```",
  ].join("\n")
}

// ── a FAMÍLIA, derivada ────────────────────────────────────────────────────

describe("discoverFamily — derivada de package.json, não listada", () => {
  it("acha os DEZ comandos da família e deixa o PUBLICADOR de fora", () => {
    const pkg = JSON.parse(
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require("node:fs").readFileSync(join(ROOT, "package.json"), "utf8"),
    )
    const names = discoverFamily(pkg.scripts).map((c: { name: string }) => c.name)
    expect(names).toEqual([
      "cut-stages:prove",
      "doctor",
      "forge-runtime:prove",
      "forge-smoke:prove",
      "image-contract:prove",
      "merge-gate:prove",
      "pre-commit-in-runner:prove",
      "runner-image:prove",
      "smoke-render:prove",
    ])
    // O `doctor:issue` PUBLICA o veredito; não mede nada — não há saída de prova
    // nele, e exigir um bloco ali seria pedir uma asserção sobre... nada.
    expect(names).not.toContain("doctor:issue")
    // E um comando qualquer do repositório não entra por engano.
    expect(names).not.toContain("test:unit")
    expect(names).not.toContain("check:prove-docs")
  })

  it("o comando novo (prove-* ou --prove) entra sozinho", () => {
    const names = discoverFamily({
      "fake:prove": "node scripts/prove-fake.mjs",
      "fake:duvidoso": "node scripts/ensure-runner-image.mjs --prove",
      "fake:comum": "node scripts/check-foo.mjs",
      "outro:doctor": "node scripts/forge-doctor-issue.mjs",
    }).map((c: { name: string }) => c.name)
    expect(names).toEqual(["fake:duvidoso", "fake:prove"])
  })

  it("um comando com metacaractere de shell é RECUSADO, não tokenizado em silêncio", () => {
    // O guard executa por LISTA de argumentos, nunca por shell: um valor com
    // `;`/`&&` não pode ser "interpretado" — executaria outra coisa.
    const [limpo] = discoverFamily({ "fake:prove": "node scripts/prove-fake.mjs --json" })
    expect(limpo.argv).toEqual(["node", "scripts/prove-fake.mjs", "--json"])
    expect(limpo.error).toBeNull()

    const [suspeito] = discoverFamily({ "fake:prove": "node scripts/prove-fake.mjs && rm -rf /" })
    expect(suspeito.argv).toEqual([])
    expect(suspeito.error).toContain("metacaractere de shell")
  })
})

// ── o PARSER ───────────────────────────────────────────────────────────────

describe("parseDocBlocks — o marcador MAIS a cerca da saída esperada", () => {
  it("lê comando, campos e linhas exigidas, com a linha do marcador", () => {
    const { blocks, errors } = parseDocBlocks(`# x\n\n${docBlock("doctor")}\n`, "docs/x.md")
    expect(errors).toEqual([])
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({
      command: "doctor",
      run: "--json",
      exit: "0",
      cenario: "ambiente",
      desfecho: "provado",
      expected: ['"ok": true'],
      source: "docs/x.md",
      line: 3,
      malformed: false,
    })
  })

  it("IGNORA marcador DENTRO de cerca (o exemplo de formato não é bloco)", () => {
    // A doc do próprio guard mostra o formato dentro de uma cerca ```md: se o
    // parser a tomasse por bloco, ela viraria um bloco ÓRFÃO (comando inexistente
    // e sem cerca de saída) e o guard reprovaria a si mesmo.
    const example = ["```md", `<!-- ${DOC_MARKER}: <nome>`, "     run: <args>", "-->", "```"].join(
      "\n",
    )
    const { blocks, errors } = parseDocBlocks(`${example}\n\n${docBlock("doctor")}\n`, "docs/x.md")
    expect(errors).toEqual([])
    expect(blocks.map((b: { command: string }) => b.command)).toEqual(["doctor"])
  })

  it("IGNORA exemplo dentro de cerca de QUATRO crases (cerca aninhada conta pelo comprimento)", () => {
    // O exemplo de formato da doc do guard vive num bloco ````md e contém uma
    // cerca de três crases DENTRO: se o fim da cerca externa fosse reconhecido
    // por "qualquer ```", o marcador do exemplo voltaria à varredura.
    const example = [
      "````md",
      `<!-- ${DOC_MARKER}: <nome>`,
      "     run: <args>",
      "     exit: <n>",
      "     cenario: ambiente",
      "     desfecho: provado",
      "-->",
      "",
      "```text",
      "<linha>",
      "```",
      "````",
    ].join("\n")
    const { blocks, errors } = parseDocBlocks(`${example}\n\n${docBlock("doctor")}\n`, "docs/x.md")
    expect(errors).toEqual([])
    expect(blocks.map((b: { command: string }) => b.command)).toEqual(["doctor"])
  })

  it("marcador SEM cerca de saída esperada é violação (bloco sem asserção)", () => {
    const md = `<!-- ${DOC_MARKER}: doctor\n     run: --json\n     exit: 0\n     cenario: ambiente\n     desfecho: provado\n-->\n\nSem cerca aqui.\n`
    const { blocks, errors } = parseDocBlocks(md, "docs/x.md")
    expect(blocks).toEqual([])
    expect(errors.join(" ")).toContain("não tem a cerca com a SAÍDA ESPERADA")
  })

  it("cerca VAZIA é violação (não há o que comparar)", () => {
    const md = docBlock("doctor", { lines: [] })
    const { blocks, errors } = parseDocBlocks(md, "docs/x.md")
    expect(blocks).toHaveLength(1)
    expect(errors.join(" ")).toContain("cerca da saída esperada está VAZIA")
    expect(blocks[0].malformed).toBe(false) // a forma está ok; o defeito é o conteúdo
  })

  it("campo desconhecido, repetido, ausente ou inválido é violação NOMEADA", () => {
    const md = `<!-- ${DOC_MARKER}: doctor\n     run: --json\n     exit: zero\n     cenario: docker\n     extra: 1\n     desfecho: provado\n-->\n\n\`\`\`text\nx\n\`\`\`\n`
    const { blocks, errors } = parseDocBlocks(md, "docs/x.md")
    const all = errors.join(" ")
    expect(all).toContain("'exit' tem de ser códigos separados por '|'")
    expect(all).toContain("'cenario' tem de ser 'ambiente' ou 'docker-ausente'")
    expect(all).toContain("campo desconhecido: 'extra'")
    expect(blocks[0].malformed).toBe(true)
  })

  it("o marcador sem nome de comando é violação", () => {
    const md = `<!-- ${DOC_MARKER}: \n     run: --json\n     exit: 0\n     cenario: ambiente\n     desfecho: provado\n-->\n\n\`\`\`text\nx\n\`\`\`\n`
    const { errors } = parseDocBlocks(md, "docs/x.md")
    expect(errors.join(" ")).toContain("não nomeia o comando")
  })

  it("parseMarkerHead: a linha do comentário pode fechar na MESMA linha do nome", () => {
    const { command, fields, errors } = parseMarkerHead([
      "doctor -->",
      "run: --ci",
      "exit: 1|2",
      "cenario: ambiente",
      "desfecho: indeterminado",
    ])
    expect(errors).toEqual([])
    expect(command).toBe("doctor")
    expect(fields.exit).toBe("1|2")
  })

  it("validateFields aceita os desfechos documentados e recusa o resto", () => {
    expect(DESFECHOS).toEqual(["provado", "indeterminado"])
    expect(
      validateFields("x", { run: "", exit: "0|2", cenario: "ambiente", desfecho: "provado" }),
    ).toEqual([])
    expect(
      validateFields("x", { run: "", exit: "0", cenario: "ambiente", desfecho: "talvez" }),
    ).toHaveLength(1)
  })
})

describe("docSources — onde os blocos vivem", () => {
  it("acha docs/ recursivo e o README (só Markdown)", () => {
    const dir = makeTmp("sources")
    mkdirSync(join(dir, "docs", "sub"), { recursive: true })
    writeFileSync(join(dir, "docs", "a.md"), "# a")
    writeFileSync(join(dir, "docs", "sub", "b.md"), "# b")
    writeFileSync(join(dir, "docs", "ignore.txt"), "x")
    writeFileSync(join(dir, "README.md"), "# r")
    const found = docSources(dir).map((p: string) =>
      p
        .slice(dir.length + 1)
        .split("\\")
        .join("/"),
    )
    expect(found).toEqual(["README.md", "docs/a.md", "docs/sub/b.md"])
  })
})

// ── a COBERTURA nos dois sentidos ──────────────────────────────────────────

describe("checkCoverage — comando sem bloco E bloco órfão", () => {
  const family = [
    { name: "doctor", argv: ["node", "scripts/forge-doctor.mjs"] },
    { name: "merge-gate:prove", argv: ["node", "scripts/prove-gitea-merge-gate.mjs"] },
  ]

  it("comando sem bloco → violação (o comando novo entra sozinho e FALHA)", () => {
    const errors = checkCoverage(family, [{ command: "doctor", where: "docs/x.md:1" }])
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain("'merge-gate:prove'")
    expect(errors[0]).toContain(`<!-- ${DOC_MARKER}: merge-gate:prove -->`)
  })

  it("bloco ÓRFÃO (comando que não existe) → violação (doc descrevendo o que não há)", () => {
    const errors = checkCoverage(family, [
      { command: "doctor", where: "docs/x.md:1" },
      { command: "merge-gate:prove", where: "docs/x.md:9" },
      { command: "prove-antigo", where: "docs/x.md:17" },
    ])
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain("bloco órfão")
    expect(errors[0]).toContain("prove-antigo")
  })

  it("DOIS blocos para o mesmo comando → violação (a asserção é única)", () => {
    const errors = checkCoverage(family, [
      { command: "doctor", where: "docs/x.md:1" },
      { command: "doctor", where: "docs/y.md:40" },
      { command: "merge-gate:prove", where: "docs/x.md:9" },
    ])
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain("2 blocos documentados")
    expect(errors[0]).toContain("docs/y.md:40")
  })
})

// ── a FIDELIDADE ───────────────────────────────────────────────────────────

describe("missingLines / normalizeOutput — a comparação com a saída REAL", () => {
  it("normaliza espaços para o pretty-print não virar falso negativo", () => {
    expect(normalizeOutput('  "a":\n    1  ')).toBe('"a": 1')
  })

  it("substring multi-linha casa contra a saída inteira", () => {
    const out = '{\n  "verdict": "unavailable",\n  "detail": "sem imagem"\n}\n'
    expect(missingLines(out, ['"verdict": "unavailable"', '"detail": "sem imagem"'])).toEqual([])
    expect(missingLines(out, ['"verdict": "proven"'])).toEqual(['"verdict": "proven"'])
  })
})

describe("runBlock — o exit e as linhas são CONFRONTADOS, não presumidos", () => {
  const node = process.execPath
  // O falso imprime PRETTY-print, como os comandos reais (o guard compara contra
  // o texto formatado; a normalização de espaços cobre a diferença entre eles).
  const gate = {
    name: "fake",
    argv: [node, "-e", "console.log(JSON.stringify({ ok: true }, null, 2))"],
  }

  const block = (
    over: Record<string, string> = {},
    expected = ['"ok": true'],
  ): Record<string, unknown> => ({
    run: "",
    exit: "0",
    cenario: "ambiente",
    desfecho: "provado",
    expected,
    ...over,
  })

  it("saída real batendo → ok", () => {
    const res = runBlock(gate, block())
    expect(res.ok).toBe(true)
    expect(res.code).toBe(0)
  })

  it("exit real FORA do declarado → divergência nomeada", () => {
    const bad = { name: "fake", argv: [node, "-e", "process.exit(3)"] }
    const res = runBlock(bad, block({ exit: "0" }))
    expect(res.ok).toBe(false)
    expect(res.divergences.join(" ")).toContain("exit 3")
    expect(res.divergences.join(" ")).toContain("o bloco documenta 0")
  })

  it("linha exigida AUSENTE da saída real → divergência com o diff dito", () => {
    const res = runBlock(gate, block({}, ['"ok": true', '"status": "holds"']))
    expect(res.ok).toBe(false)
    const faltando = res.divergences.filter((d: string) => d.startsWith("linha exigida AUSENTE"))
    expect(faltando).toHaveLength(1)
    expect(faltando[0]).toContain('"status": "holds"')
  })

  it("comando que NÃO existe → não é 'provado', é divergência", () => {
    const res = runBlock({ name: "fake", argv: ["prove-nao-existe-mesmo"] }, block())
    expect(res.ok).toBe(false)
    expect(res.divergences.join(" ")).toContain("não foi possível executar")
  })

  it("cenario docker-ausente cria MESMO o cenário (docker que falha no PATH)", () => {
    // O comando de prova consulta o docker e diz o que encontrou: com o shim, o
    // `docker` do PATH é o que falha — é isso que torna o desfecho determinístico
    // (não depende de a máquina ter socket, imagem ou rede).
    const probe = {
      name: "fake",
      argv: [
        node,
        "-e",
        "const r=require('node:child_process').spawnSync('docker',['version'],{encoding:'utf8'});console.log(r.status===127?'docker-ausente':'docker-presente:'+(r.status??r.error?.code))",
      ],
    }
    const res = runBlock(probe, block({ cenario: "docker-ausente" }, ["docker-ausente"]))
    expect(res.ok).toBe(true)
    expect(res.output).toContain("docker-ausente")
    // e no cenário `ambiente` o docker REAL é quem responde (aqui ele existe).
    const ambiente = runBlock(probe, block({ cenario: "ambiente" }, ["docker-presente"]))
    expect(ambiente.ok).toBe(true)
  })

  it("timeout → NÃO verificado (um comando que trava não vira prova)", () => {
    const slow = { name: "fake", argv: [node, "-e", "setTimeout(()=>{},5000)"] }
    const res = runBlock(slow, block({ exit: "0" }), { timeoutMs: 300 })
    expect(res.ok).toBe(false)
    expect(res.divergences.join(" ")).toContain("não terminou em")
  })
})

// ── a CLI, ponta a ponta, num fixture ──────────────────────────────────────

describe("CLI real — o fixture prova a cobertura E a fidelidade", () => {
  /**
   * Um repo mínimo: um comando da família que imprime um JSON estável.
   * `package.json` + `scripts/prove-fake.mjs` + `docs/x.md` (o bloco).
   */
  function fixture(md: string | null): string {
    const dir = makeTmp("cli")
    mkdirSync(join(dir, "scripts"), { recursive: true })
    mkdirSync(join(dir, "docs"), { recursive: true })
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "fixture", scripts: { "fake:prove": "node scripts/prove-fake.mjs" } }),
    )
    writeFileSync(
      join(dir, "scripts", "prove-fake.mjs"),
      'console.log(JSON.stringify({ ok: true, status: "holds" }, null, 2))\n',
    )
    if (md !== null) writeFileSync(join(dir, "docs", "x.md"), md)
    return dir
  }

  it("bloco batendo com a saída real → exit 0, e o veredito diz o que foi provado", () => {
    const dir = fixture(docBlock("fake:prove", { lines: ['"ok": true', '"status": "holds"'] }))
    const { status, out } = runCli(["--root", dir])
    expect(status).toBe(0)
    expect(out).toContain("fake:prove")
    expect(out).toContain("provado")
    expect(out).toContain("VEREDITO: ✅")
  })

  it("linha documentada que a saída NÃO tem → exit 1 (é a razão de o guard existir)", () => {
    const dir = fixture(
      docBlock("fake:prove", { lines: ['"status": "holds"', '"id": "re-register"'] }),
    )
    const { status, out } = runCli(["--root", dir])
    expect(status).toBe(1)
    expect(out).toContain("linha exigida AUSENTE na saída real")
    expect(out).toContain('"id": "re-register"')
    expect(out).toContain("a documentação das provas NÃO bate com a saída real")
  })

  it("exit documentado que o comando não produz → exit 1", () => {
    const dir = fixture(docBlock("fake:prove", { exit: "7" }))
    const { status, out } = runCli(["--root", dir])
    expect(status).toBe(1)
    expect(out).toContain("exit 0")
    expect(out).toContain("o bloco documenta 7")
  })

  it("comando sem bloco → exit 1, com o nome do comando e o marcador a escrever", () => {
    const dir = fixture(null)
    const { status, out } = runCli(["--root", dir])
    expect(status).toBe(1)
    expect(out).toContain("não documenta o RESULTADO ESPERADO")
    expect(out).toContain(`<!-- ${DOC_MARKER}: fake:prove -->`)
  })

  it("--json traz o veredito estruturado (para o operador e para o CI)", () => {
    const dir = fixture(docBlock("fake:prove", { lines: ['"ok": true'] }))
    const { status, out } = runCli(["--root", dir, "--json"])
    expect(status).toBe(0)
    const payload = JSON.parse(out.slice(out.indexOf("{")))
    expect(payload.ok).toBe(true)
    expect(payload.family).toEqual(["fake:prove"])
    expect(payload.results[0]).toMatchObject({ command: "fake:prove", ok: true, exit: 0 })
  })

  it("--root inexistente → exit 2 (infra, fail-closed)", () => {
    const { status, out } = runCli(["--root", join(tmpdir(), "nao-existe-prove-docs-xyz")])
    expect(status).toBe(2)
    expect(out).toContain("package.json ausente")
  })
})

// ── o ESTADO REAL do repositório ───────────────────────────────────────────

describe("audit — o repositório como ele está", () => {
  it("nenhuma violação: os dez comandos documentam e a saída real bate", () => {
    const report = audit({ root: ROOT })
    expect(report.violations).toEqual([])
    expect(report.family).toHaveLength(10)
    expect(report.results).toHaveLength(10)
    // O desfecho é REPORTADO, não presumido: o que não foi rodado com docker
    // aparece como indeterminado DECLARADO, nunca como "provado".
    const provados = report.results.filter(
      (r: { ok: boolean; desfecho: string }) => r.ok && r.desfecho === "provado",
    )
    // Duas provas rodam SEM docker e saem provadas neste host: o `cut-stages:prove`
    // (o veredito é dos CONTRATOS da árvore) e o `runner-image:prove`.
    expect(provados.map((r: { command: string }) => r.command)).toEqual([
      "runner-image:prove",
      "cut-stages:prove",
    ])
    expect(
      report.results
        .filter((r: { desfecho: string }) => r.desfecho === "indeterminado")
        .every((r: { ok: boolean }) => r.ok),
    ).toBe(true)
  }, 120000)
})
