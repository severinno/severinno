/**
 * check-lint-scope.test.ts
 *
 * Testes do scripts/check-lint-scope.mjs — o guard de ESCOPO do lint: todo
 * diretório versionado cujo arquivo o PRETTIER julga tem de estar coberto pelos
 * globs do script `lint` do package.json, ou isento com o motivo escrito.
 *
 * O defeito que ele fecha: o lint julhava uma LISTA A MAO de globs e o hook
 * julga TODO arquivo estagiado — 13 diretórios com arquivo que o prettier julga
 * ficavam fora (`.gitea/` incluso: as workflows da forja dona do merge) e o
 * `ci/unproven.json` fora do padrão passou o `bun run lint` verde.
 *
 * Cobre:
 *   - prettierGlobsOf: os globs saem do COMANDO (a fonte única), a segunda perna
 *     do `&&` (o eslint) não entra, e as três formas inválidas falham alto
 *     (script vazio / sem prettier / sem globo nenhum)
 *   - globToRegExp + coveredBy: `dir/**` cruza diretório, `*.json` casa SÓ a
 *     raiz, `src/**` não casa `srcx/a.ts` (a fronteira que faz o glob ser glob)
 *   - topDirOf: o diretório de topo (e a raiz)
 *   - ignoreDeclaration: UTF-16LE (o estado REAL do .prettierignore até esta
 *     rodada), UTF-16BE e NUL são ilegíveis; UTF-8 é legível; ausente é legítimo
 *   - candidatesOf: coberto sai, isento sai (e é marcado como usado), o resto é
 *     candidato ao oráculo
 *   - analyze (fixture git): diretório novo com .md julgado = VIOLAÇÃO nomeando
 *     diretório e remédio; isenção declarada = verde; isenção ÓRFÃ = violação;
 *     `.prettierignore` em UTF-16 = violação; arquivo que o prettier NÃO julga
 *     (.sh, imagem) = sem falso positivo
 *   - integração: o guard real no repo real sai 0
 */

import { describe, it, expect } from "vitest"
import { spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import {
  analyze,
  candidatesOf,
  coveredBy,
  globToRegExp,
  ignoreDeclaration,
  prettierGlobsOf,
  remedyFor,
  topDirOf,
  EXEMPT,
  IGNORE_FILE,
  PKG,
} from "../../../scripts/check-lint-scope.mjs"

// ── prettierGlobsOf ──────────────────────────────────────────────────────

describe("prettierGlobsOf", () => {
  it("lê os globs do COMANDO e ignora a segunda perna (o eslint)", () => {
    const { globs, error } = prettierGlobsOf(
      "prettier --check --ignore-unknown 'src/**' 'ci/**' '*.json' && eslint . --max-warnings 0",
    )
    expect(error).toBeNull()
    expect(globs).toEqual(["src/**", "ci/**", "*.json"])
  })

  it("a fonte é o package.json REAL — o mesmo comando que as duas forjas rodam", () => {
    const pkg = resolve(process.cwd(), PKG)
    const command = JSON.parse(readFileSync(pkg, "utf8")).scripts.lint
    const { globs, error } = prettierGlobsOf(command)
    expect(error).toBeNull()
    // Os diretórios que o defeito deixava fora — e o arquivo de raiz que o
    // oráculo achou quando este guard nasceu (`ci/` e `.gitea/` são o núcleo).
    expect(globs).toContain("ci/**")
    expect(globs).toContain(".gitea/**")
    expect(globs).toContain(".prettierrc")
    expect(command).toContain("eslint . --max-warnings 0")
  })

  it("script vazio → erro (mediria nada)", () => {
    expect(prettierGlobsOf("").error).toMatch(/vazio/)
    expect(prettierGlobsOf(undefined as unknown as string).error).toMatch(/vazio/)
  })

  it("primeira perna sem o prettier → erro", () => {
    expect(prettierGlobsOf("eslint . --max-warnings 0").error).toMatch(/nao invoca o prettier/)
  })

  it("prettier sem NENHUM globo → erro (fail-closed)", () => {
    expect(prettierGlobsOf("prettier --check --ignore-unknown").error).toMatch(/NENHUM globo/)
  })
})

// ── globToRegExp + coveredBy ─────────────────────────────────────────────

describe("globToRegExp / coveredBy", () => {
  it("`dir/**` alcanca o filho e o neto", () => {
    expect(coveredBy(["ci/**"], "ci/unproven.json")).toBe(true)
    expect(coveredBy(["ci/**"], "ci/sub/deep.json")).toBe(true)
  })

  it("`*.json` (sem barra) casa SÓ a raiz — a semântica do fast-glob", () => {
    expect(coveredBy(["*.json"], "package.json")).toBe(true)
    expect(coveredBy(["*.json"], "ci/merge-latency.json")).toBe(false)
  })

  it("a fronteira do diretório não é prefixo de string", () => {
    expect(coveredBy(["src/**"], "srcx/a.ts")).toBe(false)
    expect(coveredBy(["src/**"], "src/a.ts")).toBe(true)
  })

  it("`.` do globo é literal, não curinga", () => {
    expect(globToRegExp(".prettierrc").test(".prettierrc")).toBe(true)
    expect(globToRegExp(".prettierrc").test("xprettierrc")).toBe(false)
  })
})

// ── topDirOf + remedyFor ─────────────────────────────────────────────────

describe("topDirOf / remedyFor", () => {
  it("o diretório de topo, e a raiz para arquivo solto", () => {
    expect(topDirOf("a/b/c.ts")).toBe("a")
    expect(topDirOf("x.ts")).toBe("(raiz)")
  })

  it("o remédio de um arquivo de RAIZ não manda criar `(raiz)/**`", () => {
    expect(remedyFor(".prettierrc")).toContain("caminho literal '.prettierrc'")
    expect(remedyFor(".prettierrc")).not.toContain("(raiz)/**")
    expect(remedyFor("ci/unproven.json")).toContain("'ci/**'")
  })
})

// ── ignoreDeclaration ────────────────────────────────────────────────────

describe("ignoreDeclaration — a outra metade do escopo", () => {
  it("UTF-16LE (BOM ff fe) é ILEGÍVEL: era o estado real do .prettierignore", () => {
    const buf = Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from("Caddyfile.prod\r\n", "utf16le"),
    ])
    const v = ignoreDeclaration(IGNORE_FILE, buf)
    expect(v.ok).toBe(false)
    expect(v.why).toMatch(/UTF-16LE/)
    expect(v.why).toMatch(/NENHUM ignore vale/)
  })

  it("UTF-16BE também é ilegível", () => {
    const v = ignoreDeclaration(IGNORE_FILE, Buffer.from([0xfe, 0xff, 0x00, 0x41]))
    expect(v.ok).toBe(false)
    expect(v.why).toMatch(/UTF-16BE/)
  })

  it("NUL no meio (sem BOM) é ilegível", () => {
    const v = ignoreDeclaration(IGNORE_FILE, Buffer.from("Caddy\0file.prod\n", "utf8"))
    expect(v.ok).toBe(false)
    expect(v.why).toMatch(/NUL/)
  })

  it("UTF-8 é legível", () => {
    expect(ignoreDeclaration(IGNORE_FILE, Buffer.from("public/openapi.json\n", "utf8")).ok).toBe(
      true,
    )
  })
})

// ── candidatesOf ─────────────────────────────────────────────────────────

describe("candidatesOf", () => {
  it("coberto sai, isento sai E é marcado, o resto é candidato", () => {
    const files = ["ci/a.json", "osrm-data/x.bin", "public/sw.js"]
    const { candidates, usedExempt } = candidatesOf({
      globs: ["ci/**"],
      files,
      exempt: new Map([["osrm-data", "binarios"]]),
    })
    expect(candidates).toEqual(["public/sw.js"])
    expect([...usedExempt]).toEqual(["osrm-data"])
  })

  it("a EXEMPT do guard está vazia — hoje o lint cobre tudo o que o hook julga", () => {
    expect(EXEMPT.size).toBe(0)
  })
})

// ── analyze (fixture git) ────────────────────────────────────────────────

/**
 * Um repo git de fixture com o package.json e os arquivos pedidos.
 *
 * `globs` é o que a bancada DECLARA no comando do lint — é dele que o guard
 * deriva o escopo (a fonte única), então a bancada mede a régua inteira.
 */
function fixture(
  files: Record<string, string>,
  ignore?: string | Buffer,
  globs = "'src/**' '*.json'",
) {
  const dir = mkdtempSync(join(tmpdir(), "lint-scope-"))
  const git = (...args: string[]) =>
    spawnSync("git", args, {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
    })
  git("init", "-q")
  git("config", "user.email", "t@t")
  git("config", "user.name", "t")
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify(
      {
        scripts: {
          lint: `prettier --check --ignore-unknown ${globs} && eslint . --max-warnings 0`,
        },
      },
      null,
      2,
    ),
  )
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel)
    mkdirSync(join(abs, ".."), { recursive: true })
    writeFileSync(abs, content)
  }
  if (ignore !== undefined) writeFileSync(join(dir, IGNORE_FILE), ignore)
  git("add", "-A")
  // O COMMIT e o que torna o indice inicial VAZIO (`git diff --cached` compara
  // contra o HEAD): sem ele, o recorte `--staged` veria todo o fixture.
  git("commit", "-qm", "fixture")
  return {
    dir,
    git,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  }
}

describe("analyze — o veredito sobre um repo de fixture", () => {
  it("diretório novo com arquivo JULGADO é violação, nomeando diretório e remédio", async () => {
    const f = fixture({ "src/a.ts": "const a = 1\n", "e2e/x.spec.ts": "const b = 1\n" })
    try {
      const r = await analyze({ cwd: f.dir })
      expect(r.exit).toBe(1)
      expect(r.judged).toEqual(["e2e/x.spec.ts"])
      expect(r.dirs).toEqual(["e2e"])
      expect(r.violations.join("\n")).toContain("'e2e/x.spec.ts'")
      expect(r.violations.join("\n")).toContain("'e2e/**'")
    } finally {
      f.cleanup()
    }
  })

  it("arquivo que o prettier NÃO julga (imagem) não é falso positivo", async () => {
    const f = fixture({ "src/a.ts": "const a = 1\n", "assets/foto.png": "x" })
    try {
      const r = await analyze({ cwd: f.dir })
      expect(r.exit).toBe(0)
      expect(r.candidates).toBe(1) // o PNG é candidato; o oráculo o absolve
      expect(r.judged).toEqual([])
    } finally {
      f.cleanup()
    }
  })

  it("isenção DECLARADA (com motivo) tira o diretório do julgamento", async () => {
    const f = fixture({ "src/a.ts": "const a = 1\n", "e2e/x.spec.ts": "const b = 1\n" })
    try {
      const r = await analyze({
        cwd: f.dir,
        exempt: new Map([["e2e", "specs rodam no playwright"]]),
      })
      expect(r.exit).toBe(0)
      expect(r.judged).toEqual([])
    } finally {
      f.cleanup()
    }
  })

  it("isenção ÓRFÃ (não casa com arquivo nenhum) é violação", async () => {
    const f = fixture({ "src/a.ts": "const a = 1\n" })
    try {
      const r = await analyze({ cwd: f.dir, exempt: new Map([["k6", "carga"]]) })
      expect(r.exit).toBe(1)
      expect(r.violations.join("\n")).toContain("entrada stale")
    } finally {
      f.cleanup()
    }
  })

  it("um arquivo ILEGÍVEL de declaração (UTF-16/NUL) é violação — a declaração que não declara nada", async () => {
    const f = fixture(
      { "src/a.ts": "const a = 1\n" },
      Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("x.md\r\n", "utf16le")]),
    )
    try {
      const r = await analyze({ cwd: f.dir })
      expect(r.exit).toBe(1)
      expect(r.violations.join("\n")).toContain("UTF-16LE")
    } finally {
      f.cleanup()
    }
  })

  it("a DECLARAÇÃO que o commit move julga a ÁRVORE: o globo removido no índice abre buraco em todo o repositório", async () => {
    // A bancada SÃ (o `ci/**` declarado), commitada.
    const f = fixture(
      { "src/a.ts": "const a = 1\n", "ci/dado.json": '{ "x": 1 }\n' },
      undefined,
      "'src/**' 'ci/**' '*.json'",
    )
    try {
      const pkgAtual = readFileSync(join(f.dir, "package.json"), "utf8")
      // O commit REMOVE o globo do escopo: o ÍNDICE passa a declarar sem `ci/**`…
      writeFileSync(
        join(f.dir, "package.json"),
        JSON.stringify(
          {
            scripts: {
              lint: "prettier --check --ignore-unknown 'src/**' '*.json' && eslint . --max-warnings 0",
            },
          },
          null,
          2,
        ),
      )
      f.git("add", "package.json")
      // …e a ÁRVORE fica como estava (o desenvolvedor só mexeu no commit).
      writeFileSync(join(f.dir, "package.json"), pkgAtual)

      // O recorte lê a declaração DO ÍNDICE e, por ela mexer no escopo inteiro,
      // julga a ÁRVORE: o buraco está em um arquivo que o commit não toca.
      const staged = await analyze({ cwd: f.dir, staged: true })
      expect(staged.exit).toBe(1)
      expect(staged.judged).toEqual(["ci/dado.json"])
      expect(staged.scope).toContain("arvore")
      // A árvore, que ainda declara `ci/**`, é o outro veredito — e é o do CI.
      expect((await analyze({ cwd: f.dir })).exit).toBe(0)
    } finally {
      f.cleanup()
    }
  })

  it("`--staged` julga o ÍNDICE: o arquivo novo estagiado é a violação", async () => {
    const f = fixture({ "src/a.ts": "const a = 1\n" })
    try {
      mkdirSync(join(f.dir, "deploy"), { recursive: true })
      writeFileSync(join(f.dir, "deploy/README.md"), "# deploy\n")
      f.git("add", "deploy/README.md")
      const staged = await analyze({ cwd: f.dir, staged: true })
      expect(staged.exit).toBe(1)
      expect(staged.judged).toEqual(["deploy/README.md"])
      // A ARVORE é a mesma: o que muda é o ESCOPO do recorte.
      const tree = await analyze({ cwd: f.dir })
      expect(tree.judged).toEqual(["deploy/README.md"])
    } finally {
      f.cleanup()
    }
  })

  it("o recorte --staged lê o ÍNDICE: o arquivo que só existe na árvore não é julgado", async () => {
    // O fixture já carrega um buraco PRÉ-EXISTENTE: `ci/` fora dos globs dele.
    const f = fixture({ "src/a.ts": "const a = 1\n", "ci/dado.json": '{ "x": 1 }\n' })
    try {
      // 1. Nada estagiado: o commit não abre a lacuna, e o recorte não pode
      //    bloquear um commit por um buraco que ele não abriu (quem o julga é a
      //    varredura global do CI).
      const nada = await analyze({ cwd: f.dir, staged: true })
      expect(nada.exit).toBe(0)
      expect(nada.files).toBe(0)
      expect(nada.judged).toEqual([])
      // 2. A ÁRVORE, por outro lado, vê o buraco — é o veredito do merge.
      expect((await analyze({ cwd: f.dir })).judged).toEqual(["ci/dado.json"])
      // 3. Escrito na ÁRVORE e FORA do índice: é WIP, não é o commit.
      mkdirSync(join(f.dir, "e2e"), { recursive: true })
      writeFileSync(join(f.dir, "e2e/wip.spec.ts"), "const b = 1\n")
      expect((await analyze({ cwd: f.dir, staged: true })).judged).toEqual([])
      // 4. No índice, o mesmo arquivo é o commit — e o recorte o julga.
      f.git("add", "e2e/wip.spec.ts")
      expect((await analyze({ cwd: f.dir, staged: true })).judged).toEqual(["e2e/wip.spec.ts"])
      expect((await analyze({ cwd: f.dir })).judged).toEqual(["ci/dado.json", "e2e/wip.spec.ts"])
    } finally {
      f.cleanup()
    }
  })

  it("package.json sem o script `lint` é INFRA (exit 2), não verde", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lint-scope-"))
    try {
      writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: {} }))
      expect((await analyze({ cwd: dir })).exit).toBe(2)
      rmSync(join(dir, "package.json"))
      expect((await analyze({ cwd: dir })).exit).toBe(2)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

// ── Integração (spawn do guard real contra o repo) ────────────────────────

describe("check-lint-scope.mjs (integração)", () => {
  it("exit 0 no repo real — o escopo do lint cobre o que o hook julga", () => {
    const res = spawnSync("node", [resolve(process.cwd(), "scripts/check-lint-scope.mjs")], {
      cwd: process.cwd(),
      encoding: "utf8",
    })
    expect(res.stderr).toBe("")
    expect(res.status).toBe(0)
    expect(res.stdout).toContain("Escopo do lint cobre o que o hook julga")
  })

  it("argumento inválido → exit 3 com a ajuda", () => {
    const res = spawnSync(
      "node",
      [resolve(process.cwd(), "scripts/check-lint-scope.mjs"), "--turbo"],
      { cwd: process.cwd(), encoding: "utf8" },
    )
    expect(res.status).toBe(3)
    expect(res.stderr).toContain("argumento invalido")
  })
})
