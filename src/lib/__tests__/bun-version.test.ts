/**
 * bun-version.test.ts
 *
 * Testes do resolvedor `scripts/bun-version.mjs` — o único caminho pelo qual um
 * script do repositório descobre a versão do Bun SEM cravar um literal.
 *
 * A auditoria de espelhos (invariantes 15/16 do `check-bun-mirror`) existe
 * porque literais de BUN_VERSION vivos em scripts envelhecem em silêncio: o
 * script continua funcionando depois do bump. Este módulo é o remédio — e uma
 * peça de remédio que ninguém testa é exatamente o mesmo defeito com outra
 * roupa.
 *
 * Cobre:
 *   - a ORDEM da cadeia (env do processo → espelhos declarados);
 *   - a lista de espelhos como fonte única (nomes e formatos das linhas);
 *   - `requireBunVersion` LANÇAR em vez de devolver um default silencioso;
 *   - a mensagem de erro NOMEAR onde declarar (violação sem remédio é ignorada).
 *
 * Usage:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/bun-version.test.ts
 */

import { describe, it, expect, afterAll } from "vitest"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  BUN_VERSION_VAR,
  BUN_MIRRORS,
  mirrorFiles,
  mirrorListText,
  readMirrorValues,
  resolveBunVersion,
  requireBunVersion,
} from "../../../scripts/bun-version.mjs"

const dirs: string[] = []

function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "bun-version-"))
  dirs.push(dir)
  return dir
}

afterAll(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** Um repo mínimo com os dois espelhos declarados. */
function makeRepo({
  actrc = "1.3",
  envFile = "1.3",
}: { actrc?: string | null; envFile?: string | null } = {}) {
  const dir = makeDir()
  if (actrc !== null) writeFileSync(join(dir, ".actrc"), `# header\n--var BUN_VERSION=${actrc}\n`)
  if (envFile !== null) {
    mkdirSync(join(dir, "deploy"), { recursive: true })
    writeFileSync(
      join(dir, "deploy", "env.gitea.example"),
      `IMAGE_REGISTRY=ghcr.io\nBUN_VERSION=${envFile}\n`,
    )
  }
  return dir
}

describe("BUN_MIRRORS — a lista declarada dos espelhos", () => {
  it("são os dois que o bump escreve e o guard semanal compara", () => {
    expect(mirrorFiles()).toEqual([".actrc", "deploy/env.gitea.example"])
  })

  it("cada espelho sabe FORMULAR a própria linha (o bump copia daqui)", () => {
    const formats = BUN_MIRRORS.map((m) => m.format("1.3.14"))
    expect(formats).toEqual(["--var BUN_VERSION=1.3.14", "BUN_VERSION=1.3.14"])
  })

  it("BUN_VERSION_VAR é a referência da repository variable (a fonte única)", () => {
    expect(BUN_VERSION_VAR).toBe("${{ vars.BUN_VERSION }}")
  })

  it("mirrorListText nomeia os dois arquivos, em backticks", () => {
    expect(mirrorListText()).toBe("`.actrc`, `deploy/env.gitea.example`")
  })
})

describe("readMirrorValues — o que cada espelho declara", () => {
  it("lê os dois, na ordem declarada", () => {
    const dir = makeRepo()
    expect(readMirrorValues(dir)).toEqual([
      { file: ".actrc", value: "1.3" },
      { file: "deploy/env.gitea.example", value: "1.3" },
    ])
  })

  it("espelho ausente ou sem a linha é OMITIDO (a existência é do guard, não do leitor)", () => {
    const dir = makeRepo({ envFile: null })
    expect(readMirrorValues(dir)).toEqual([{ file: ".actrc", value: "1.3" }])
    expect(readMirrorValues(makeDir())).toEqual([])
  })
})

describe("resolveBunVersion — a ordem da cadeia", () => {
  it("o ENV do processo vem primeiro (é a variável resolvida pelo CI)", () => {
    const dir = makeRepo()
    const r = resolveBunVersion({ root: dir, env: { BUN_VERSION: "9.8.7" } })
    expect(r.version).toBe("9.8.7")
    expect(r.source).toContain("ambiente")
  })

  it("env vazio ou só espaços NÃO vale como declaração", () => {
    const dir = makeRepo()
    expect(resolveBunVersion({ root: dir, env: { BUN_VERSION: "   " } }).version).toBe("1.3")
    expect(resolveBunVersion({ root: dir, env: {} }).version).toBe("1.3")
  })

  it("sem env, cai no espelho e DIZ de qual veio", () => {
    const dir = makeRepo({ actrc: null, envFile: "2.0.0" })
    const r = resolveBunVersion({ root: dir, env: {} })
    expect(r.version).toBe("2.0.0")
    expect(r.source).toContain("deploy/env.gitea.example")
  })

  it("sem env e sem espelho: version null (quem decide é o consumidor)", () => {
    const r = resolveBunVersion({ root: makeDir(), env: {} })
    expect(r.version).toBeNull()
    expect(r.source).toBeNull()
  })
})

describe("requireBunVersion — falhar em vez de inventar um default", () => {
  it("devolve a versão e a procedência quando existe", () => {
    const r = requireBunVersion({ root: makeRepo(), env: {} })
    expect(r.version).toBe("1.3")
    expect(r.source).toContain(".actrc")
  })

  it("LANÇA quando não há de onde tirar — e a mensagem nomeia os espelhos", () => {
    // O ponto do módulo: um default silencioso (`|| "1.3.14"`) sobrevive ao bump.
    // Falhar aqui é o que transforma "mediu a versão errada em silêncio" em erro.
    expect(() => requireBunVersion({ root: makeDir(), env: {} })).toThrow(
      /BUN_VERSION não declarado/,
    )
    expect(() => requireBunVersion({ root: makeDir(), env: {} })).toThrow(/\.actrc/)
    expect(() => requireBunVersion({ root: makeDir(), env: {} })).toThrow(
      /deploy\/env\.gitea\.example/,
    )
    expect(() => requireBunVersion({ root: makeDir(), env: {} })).toThrow(/default de reserva/)
  })
})
