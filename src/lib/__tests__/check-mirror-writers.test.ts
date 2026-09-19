// =============================================================================
// check-mirror-writers.test.ts
//
// Testes do checkMirrorWriters (scripts/check-bun-mirror.mjs): os espelhos da
// variável BUN_VERSION têm DOIS donos em DOIS arquivos — o bump
// (scripts/bump-bun.sh) ESCREVE, o guard semanal (scripts/check-actrc-sync.mjs)
// COMPARA. Os dois conjuntos têm de ser o MESMO; a assimetria é silenciosa:
//
//   - leitor sem escritor → todo bump deixa um ::warning:: PERMANENTE que o
//     procedimento documentado não consegue silenciar (um aviso assim morre);
//   - escritor sem leitor → o valor escrito nunca é conferido.
//
// Padrão do repo: funções PURAS testadas com conteúdo sintético + uma asserção
// contra os arquivos REAIS do repositório (o que vale é o guard que roda aqui),
// e uma mutação no conteúdo real provando que ele ACUSA.
// =============================================================================

import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import {
  ACTRC_SYNC_SCRIPT,
  BUN_BUMP_SCRIPT,
  checkMirrorWriters,
} from "../../../scripts/check-bun-mirror.mjs"

const ROOT = process.cwd()
const realBump = () => readFileSync(join(ROOT, BUN_BUMP_SCRIPT), "utf8")
const realSync = () => readFileSync(join(ROOT, ACTRC_SYNC_SCRIPT), "utf8")

// ── fixtures (trechos mínimos, na forma dos arquivos reais) ────────────────

/** Trecho do bump na forma real: declaração `X_PATH="$REPO_ROOT/<espelho>"` + chamada. */
function bumpScript(mirrors: { varName: string; path: string; calls: boolean }[]): string {
  const declarations = mirrors.map((m) => `${m.varName}="$REPO_ROOT/${m.path}"`).join("\n")
  const calls = mirrors
    .filter((m) => m.calls)
    .map((m) => `  update_mirror "$${m.varName}" '^BUN_VERSION=' "\${m.varName}_LINE"`)
    .join("\n")
  return `#!/usr/bin/env bash\n${declarations}\n\nupdate_mirror() { :; }\n\n${calls}\n`
}

/** Trecho do guard semanal na forma real: o default do .actrc + a constante do env. */
function syncScript(opts: { actrc: boolean; envMirror: string | null }): string {
  const actrcLine = opts.actrc ? '  let actrcPath = join(process.cwd(), ".actrc")\n' : ""
  const envConst =
    opts.envMirror === null ? "" : `export const GITEA_ENV_MIRROR = "${opts.envMirror}"\n`
  return `${envConst}\nconst isMain = true\n\nif (isMain) {\n${actrcLine}}\n`
}

const BOTH = syncScript({ actrc: true, envMirror: "deploy/env.gitea.example" })
const BUMP_BOTH = bumpScript([
  { varName: "ACTRC_PATH", path: ".actrc", calls: true },
  { varName: "ENV_MIRROR_PATH", path: "deploy/env.gitea.example", calls: true },
])

// ── checkMirrorWriters ────────────────────────────────────────────────────

describe("checkMirrorWriters — os dois donos precisam do mesmo conjunto", () => {
  it("bump escreve os dois espelhos que o guard semanal compara → zero violações", () => {
    expect(checkMirrorWriters(BUMP_BOTH, BOTH)).toEqual([])
  })

  it("guard semanal comparando SÓ o .actrc → violação (o outro divergiria sem aviso)", () => {
    const v = checkMirrorWriters(BUMP_BOTH, syncScript({ actrc: true, envMirror: null }))
    expect(v.length).toBe(1)
    expect(v[0]).toContain(ACTRC_SYNC_SCRIPT)
    expect(v[0]).toContain("DOIS espelhos")
  })

  it("guard semanal sem a constante do env → a mesma violação (não é silenciosa)", () => {
    const v = checkMirrorWriters(BUMP_BOTH, syncScript({ actrc: true, envMirror: null }))
    expect(v[0]).toContain("encontrei 1")
  })

  it("bump que NÃO escreve o env da forja → violação nomeando o espelho e o aviso permanente", () => {
    const bump = bumpScript([{ varName: "ACTRC_PATH", path: ".actrc", calls: true }])
    const v = checkMirrorWriters(bump, BOTH)
    expect(v.length).toBe(1)
    expect(v[0]).toContain(BUN_BUMP_SCRIPT)
    expect(v[0]).toContain("deploy/env.gitea.example")
    expect(v[0]).toContain("permanente")
  })

  it("bump que DECLARA o caminho mas nunca chama update_mirror → violação (declaração não é escrita)", () => {
    const bump = bumpScript([
      { varName: "ACTRC_PATH", path: ".actrc", calls: true },
      { varName: "ENV_MIRROR_PATH", path: "deploy/env.gitea.example", calls: false },
    ])
    const v = checkMirrorWriters(bump, BOTH)
    expect(v.length).toBe(1)
    expect(v[0]).toContain("nunca chama update_mirror")
    expect(v[0]).toContain("ENV_MIRROR_PATH")
  })

  it("as duas quebras somam (nenhum espelho escrito, guard comparando os dois)", () => {
    const v = checkMirrorWriters(bumpScript([]), BOTH)
    expect(v.length).toBe(2)
  })

  it("bump ausente → violação apontando o script", () => {
    const v = checkMirrorWriters("", BOTH)
    expect(v.length).toBe(1)
    expect(v[0]).toContain(BUN_BUMP_SCRIPT)
  })
})

// ── repositório real ──────────────────────────────────────────────────────

describe("checkMirrorWriters — repositório real", () => {
  it("o bump e o guard semanal do repo fecham o mesmo conjunto de espelhos", () => {
    const v = checkMirrorWriters(realBump(), realSync())
    expect(v, v.join("\n")).toEqual([])
  })

  it("o bump real escreve os DOIS espelhos (não só um por acidente)", () => {
    const bump = realBump()
    // Prova direta do que o guard deduz: cada chamada existe no arquivo real.
    expect(bump).toContain('update_mirror "$ACTRC_PATH"')
    expect(bump).toContain('update_mirror "$ENV_MIRROR_PATH"')
  })

  it("mutação: remover a chamada do env no conteúdo REAL faz o guard ACUSAR", () => {
    const mutated = realBump().replace('update_mirror "$ENV_MIRROR_PATH"', "# removido")
    const v = checkMirrorWriters(mutated, realSync())
    expect(v.length).toBe(1)
    expect(v[0]).toContain("nunca chama update_mirror")
  })

  it("mutação: tirar o env do guard semanal REAL faz o guard ACUSAR", () => {
    const mutated = realSync().replace(
      'export const GITEA_ENV_MIRROR = "deploy/env.gitea.example"',
      "export const GITEA_ENV_MIRROR = null",
    )
    const v = checkMirrorWriters(realBump(), mutated)
    expect(v.length).toBe(1)
    expect(v[0]).toContain("DOIS espelhos")
  })
})
