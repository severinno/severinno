/**
 * check-next-types.mjs - auto-heal do .next/types stale (2026-08)
 *
 * Synthetic-root tests via NEXT_TYPES_ROOT (the same env-override pattern
 * as FRAGILE_SCAN_ROOT): each test builds an isolated temp dir with a fake
 * node_modules/next/package.json and fake generated type files under
 * .next/types / .next/dev/types, then runs the CLI with
 * env: { NEXT_TYPES_ROOT: dir }. mtimes are SET EXPLICITLY with
 * utimesSync - the whole contract is the mtime ORDER (installed next NEWER
 * than generated types == stale; OLDER == clean), so the fixture content
 * is irrelevant: no tsc error parsing, no hardcoded member names, exactly
 * the class-level detection the guard itself implements. Hermetic by
 * construction - zero real repo surface scanned.
 *
 * Um teste REAL-SWAP MUTATION quebra o utimesSync-only de proposito: reescreve
 * o package.json via writeFileSync real (conteudo + mtime natural, o caminho do
 * bun install) e prova o flip clean -> STALE, depois restaura o mtime para provar
 * que o guard ignora conteudo (a LIMITACAO RESIDUAL do proxy, assertada como
 * contrato em vez de comentario).
 *
 * O CONTRACT no-op install trava a conclusao da MEDICAO 2026-08-09: um
 * bun install SEM mudanca de resolucao NAO reescreve o package.json
 * ("no changes", mtime identico antes/depois) - logo o guard NAO pode dar
 * falso STALE em todo install. O teste roda o guard ANTES e DEPOIS do
 * no-op simulado (mesma versao, mesmo mtime) e asserta clean nos DOIS runs,
 * pinando o invariante INTACTO do mtime como contrato, nao comentario.
 *
 * O teste LIMITACAO RESIDUAL trava o lado OPOSTO do proxy - o
 * FALSO-NEGATIVO aceito: um .next COPIADO de outra versao (conteudo que
 * referencia o next 16.1.1, mtime fabricado mais novo que o install,
 * package.json intacto) passa clean. O guard so ve a ORDEM de mtime - a
 * copia com mtime preservado escapa da deteccao, comportamento documentado
 * e aceito no header do .mjs (LIMITACAO RESIDUAL), nao uma regressao.
 *
 * Subprocess-heavy (every test spawns the CLI via runSubprocess) -> an
 * EXPLICIT timeout on every it() (the scan-timeouts guard requires it:
 * the global testTimeout: 30000 is only the safety net for tests the
 * guard does NOT flag).
 */
import { afterEach, describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { cleanupTempDirs, createTempDir, runSubprocess } from "./golden-copy-utils"

const SCRIPT = path.resolve(process.cwd(), "scripts", "check-next-types.mjs")
// Two fixed instants: INSTALL (next/package.json mtime) vs GEN (types mtime).
const INSTALL = new Date("2026-08-09T00:00:00.000Z")
const GEN_OLD = new Date("2026-08-08T00:00:00.000Z") // types OLDER than install -> stale
const GEN_NEW = new Date("2026-08-10T00:00:00.000Z") // types NEWER than install -> clean

// Real-swap mutation timings: install (08-01) and types (08-05) are both in the
// past relative to any real run (the suite exists from 2026-08), so a REAL
// writeFileSync (natural mtime = now) always lands past the types - the swap
// flips clean -> STALE deterministically, no utimesSync needed for that leg.
const INSTALL_EARLY = new Date("2026-08-01T00:00:00.000Z")
const GEN_MID = new Date("2026-08-05T00:00:00.000Z")

function setMtime(p: string, when: Date) {
  fs.utimesSync(p, when, when)
}

interface FakeRoot {
  dir: string
  nextPkg: string
  typesFile: string
  devTypesFile: string
}

/** Build a synthetic repo: fake next install + generated type surface. */
function buildRoot(opts: {
  install: Date
  gen: Date
  withDevTypes?: boolean
  noNext?: boolean
}): FakeRoot {
  const dir = createTempDir("next-types-")
  // node_modules/next/package.json (the "installed next")
  const nextPkg = path.join(dir, "node_modules", "next", "package.json")
  if (!opts.noNext) {
    fs.mkdirSync(path.dirname(nextPkg), { recursive: true })
    fs.writeFileSync(nextPkg, JSON.stringify({ name: "next", version: "16.1.3" }))
    setMtime(nextPkg, opts.install)
  }
  // .next/types/app/page.ts (the generated surface)
  const typesFile = path.join(dir, ".next", "types", "app", "page.ts")
  fs.mkdirSync(path.dirname(typesFile), { recursive: true })
  fs.writeFileSync(typesFile, "// generated\n")
  setMtime(typesFile, opts.gen)
  // optional .next/dev/types
  const devTypesFile = path.join(dir, ".next", "dev", "types", "app", "page.ts")
  if (opts.withDevTypes) {
    fs.mkdirSync(path.dirname(devTypesFile), { recursive: true })
    fs.writeFileSync(devTypesFile, "// generated\n")
    setMtime(devTypesFile, opts.gen)
  }
  return { dir, nextPkg, typesFile, devTypesFile }
}

function runGuard(dir: string, args: string[] = []) {
  return runSubprocess({
    command: process.execPath,
    args: [SCRIPT, ...args],
    env: { NEXT_TYPES_ROOT: dir },
  })
}

describe("check-next-types.mjs - stale .next/types auto-heal (2026-08)", () => {
  afterEach(cleanupTempDirs)

  it("clean: types NEWER than the installed next -> exit 0, clean verdict", () => {
    const root = buildRoot({ install: INSTALL, gen: GEN_NEW })
    const r = runGuard(root.dir)
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("clean")
    // the surface is NOT touched on a clean run
    expect(fs.existsSync(root.typesFile)).toBe(true)
  }, 60000)

  it("stale (check): types OLDER than the installed next -> exit 1 + STALE with the exact dir", () => {
    const root = buildRoot({ install: INSTALL, gen: GEN_OLD })
    const r = runGuard(root.dir)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("STALE .next/types")
    expect(r.stdout).toContain("run with --fix")
  }, 60000)

  it("stale + --fix: removes BOTH .next/types and .next/dev/types, exit 0, REMOVED lines", () => {
    const root = buildRoot({ install: INSTALL, gen: GEN_OLD, withDevTypes: true })
    const r = runGuard(root.dir, ["--fix"])
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("REMOVED .next/types")
    expect(r.stdout).toContain("REMOVED .next/dev/types")
    expect(fs.existsSync(root.typesFile)).toBe(false)
    expect(fs.existsSync(root.devTypesFile)).toBe(false)
    // the REST of the build cache is preserved (only the generated surface goes)
    expect(fs.existsSync(path.join(root.dir, ".next"))).toBe(true)
  }, 60000)

  it("clean + --fix: no-op (nothing stale, nothing removed)", () => {
    const root = buildRoot({ install: INSTALL, gen: GEN_NEW })
    const r = runGuard(root.dir, ["--fix"])
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("clean")
    expect(fs.existsSync(root.typesFile)).toBe(true)
  }, 60000)

  it("no .next at all -> exit 0 clean (the fresh-checkout CI case)", () => {
    const dir = createTempDir("next-types-")
    fs.mkdirSync(path.join(dir, "node_modules", "next"), { recursive: true })
    fs.writeFileSync(
      path.join(dir, "node_modules", "next", "package.json"),
      JSON.stringify({ name: "next", version: "16.1.3" }),
    )
    setMtime(path.join(dir, "node_modules", "next", "package.json"), INSTALL)
    const r = runGuard(dir)
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("clean")
  }, 60000)

  it("no installed next (node_modules absent) -> exit 0 skip (nothing to compare)", () => {
    const root = buildRoot({ install: INSTALL, gen: GEN_OLD, noNext: true })
    const r = runGuard(root.dir)
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("clean")
  }, 60000)

  it("MUTATION: flipping the mtime order flips the verdict on identical fixtures", () => {
    // Same content, types OLDER -> stale
    const stale = buildRoot({ install: INSTALL, gen: GEN_OLD })
    expect(runGuard(stale.dir).status).toBe(1)
    // Same content, types NEWER -> clean
    const clean = buildRoot({ install: INSTALL, gen: GEN_NEW })
    expect(runGuard(clean.dir).status).toBe(0)
  }, 60000)

  it("REAL-SWAP MUTATION: real writeFileSync (content AND mtime) flips clean -> STALE; restoring the mtime proves the guard ignores content", () => {
    // Pre-swap: install (08-01) OLDER than types (08-05) -> CLEAN - the state a
    // dev sits in between a real install and the next dev/build.
    const root = buildRoot({ install: INSTALL_EARLY, gen: GEN_MID })
    expect(runGuard(root.dir).status).toBe(0)
    // The bun-install swap path: a REAL writeFileSync changes content (version
    // bump to 16.2.0) AND bumps the file mtime naturally to now (past the types).
    // This is the incident class Prova 9 proved with `bun add` real binaries -
    // here hermetically: content AND mtime both change, like bun re-resolving.
    fs.writeFileSync(root.nextPkg, JSON.stringify({ name: "next", version: "16.2.0" }))
    const staleRun = runGuard(root.dir)
    expect(staleRun.status).toBe(1) // STALE
    expect(staleRun.stdout).toContain("STALE .next/types") // message contract for the real-write path, same as the utimesSync "stale (check)" test
    // Same content change, mtime RESTORED to pre-swap: the guard goes CLEAN again
    // - it keys on mtime, NOT content. The documented LIMITACAO RESIDUAL (a swap
    // that preserves mtime escapes detection) is now an asserted contract.
    setMtime(root.nextPkg, INSTALL_EARLY)
    expect(runGuard(root.dir).status).toBe(0) // clean again
  }, 60000)

  it("CONTRACT no-op install (MEDICAO 2026-08-09): bun NAO reescreve o package.json quando a resolucao nao muda -> mtime INTACTO -> clean nos DOIS runs (sem falso STALE)", () => {
    // Estado saudavel pre-no-op: install (08-01) mais velho que os types (08-05) -> clean.
    const root = buildRoot({ install: INSTALL_EARLY, gen: GEN_MID })
    const r1 = runGuard(root.dir)
    expect(r1.status).toBe(0)
    expect(r1.stdout).toContain("generated types are newer than the installed next")
    const mtimeBefore = fs.statSync(root.nextPkg).mtimeMs

    // Simula o no-op como a MEDICAO mediu ("Checked ... (no changes)", mtime
    // identico antes/depois): o install roda e o package.json NAO e re-escrito
    // com mtime novo - escrever a MESMA versao e restaurar o MESMO mtime modela
    // isso: sem mudanca de resolucao, o mtime nao avanca para 'now'.
    fs.writeFileSync(root.nextPkg, JSON.stringify({ name: "next", version: "16.1.3" }))
    setMtime(root.nextPkg, INSTALL_EARLY) // mesmo mtime do install original
    expect(fs.statSync(root.nextPkg).mtimeMs).toBe(mtimeBefore) // o invariante INTACTO da MEDICAO

    // Run 2 apos o no-op: o veredito NAO muda - clean. (O hazard que a MEDICAO
    // descartou - um re-write com mtime natural flip'aria clean -> STALE em
    // TODO install - e exatamente o flip que o REAL-SWAP test acima prova no
    // caso do bump de versao, onde o STALE E o comportamento correto.)
    const r2 = runGuard(root.dir)
    expect(r2.status).toBe(0)
    expect(r2.stdout).toContain("clean")
    expect(r2.stdout).toContain("generated types are newer than the installed next")
  }, 60000)

  it("LIMITACAO RESIDUAL aceita (falso-negativo): .next COPIADO de outra versao (conteudo 16.1.1 + mtime fabricado mais novo que o install + package.json intacto) -> clean, o guard NAO detecta", () => {
    // O cenario da LIMITACAO RESIDUAL do header do .mjs: um .next copiado de
    // OUTRA maquina/versao DEPOIS do install, com o mtime preservado pela copia
    // (mais novo que o install). O guard so le a ORDEM de mtime -> clean,
    // mesmo que o CONTEUDO dos types seja de uma versao diferente (stale por
    // origem). Falso-negativo ACEITO por design - o proxy nao le conteudo.
    const root = buildRoot({ install: INSTALL_EARLY, gen: GEN_MID })
    const pkgBefore = fs.readFileSync(root.nextPkg, "utf8")
    // Reescreve o surface com conteudo que referencia OUTRA versao (16.1.1):
    // o que a copia traz. O guard nao le isso - o mtime (08-05) e o sinal.
    fs.writeFileSync(root.typesFile, "// generated by next 16.1.1 (copiado de outro checkout)\n")
    setMtime(root.typesFile, GEN_MID) // mtime preservado pela copia, mais novo que o install
    const r = runGuard(root.dir)
    expect(r.status).toBe(0) // falso-negativo ACEITO: o guard nao trip
    expect(r.stdout).toContain("generated types are newer than the installed next")
    expect(r.stdout).not.toContain("STALE") // pino explicito do falso-negativo
    // O install nunca foi tocado (a copia nao reescreve o package.json):
    // a unica fabricacao e o mtime dos types, e mesmo assim o guard diz clean.
    expect(fs.readFileSync(root.nextPkg, "utf8")).toBe(pkgBefore)
    // O surface copiado permanece no lugar (nenhum heal dispara em clean).
    expect(fs.existsSync(root.typesFile)).toBe(true)
  }, 60000)

  it("CONTRACT falso-negativo do bump com MTIME PRESERVADO (16.1.3 -> 16.2.0 + setMtime fixo): o guard NAO trip - a LIMITACAO RESIDUAL travada como contrato bidirecional", () => {
    // O incidente original da Prova 9 foi um `bun install` NORMAL subindo o
    // next (16.1.1 -> 16.1.3 via ^16.1.1) - e o bun, ao re-resolver, avanca o
    // mtime do package.json (o que o guard detecta como STALE, correto).
    // Este teste trava o lado OPOSTO do proxy, que a LIMITACAO RESIDUAL do
    // header do .mjs documenta como aceito: um bump que PRESERVA o mtime
    // (ex.: copy/restore, ci artifact, ou um install que nao re-escreve o
    // arquivo) passa DESPERCEBIDO - o guard so le a ORDEM de mtime, nunca o
    // conteudo. O REAL-SWAP test acima prova o flip clean -> STALE quando o
    // mtime avanca; aqui o MESMO bump de versao com mtime fixo fica clean.
    // O par fecha o contrato bidirecional: conteudo sem mtime novo NAO trip.
    const root = buildRoot({ install: INSTALL_EARLY, gen: GEN_MID })
    expect(runGuard(root.dir).status).toBe(0) // pre-bump: clean
    const mtimeBefore = fs.statSync(root.nextPkg).mtimeMs

    // O bump real do incidente (conteudo muda para a versao NOVA), mas com o
    // mtime PRESERVADO no instante original do install - o cenario que o
    // proxy nao ve: o package.json diz 16.2.0, os types (08-05) sao MAIS
    // NOVOS que o install (08-01) na ordem de mtime -> clean para o guard.
    fs.writeFileSync(root.nextPkg, JSON.stringify({ name: "next", version: "16.2.0" }))
    setMtime(root.nextPkg, INSTALL_EARLY) // mtime de volta ao do install (o proxy nao ve o bump)
    expect(fs.statSync(root.nextPkg).mtimeMs).toBe(mtimeBefore) // invariante: mtime INTACTO
    expect(fs.readFileSync(root.nextPkg, "utf8")).toContain("\"version\":\"16.2.0\"") // conteudo REALMENTE bumpado (JSON.stringify compacto, sem espacos)

    const r = runGuard(root.dir)
    expect(r.status).toBe(0) // falso-negativo do bump preservado: ACEITO e travado aqui
    expect(r.stdout).toContain("generated types are newer than the installed next")
    expect(r.stdout).not.toContain("STALE") // pino explicito: mtime intacto = clean, mesmo com versao nova no conteudo
    expect(fs.existsSync(root.typesFile)).toBe(true) // nenhum heal dispara em clean
  }, 60000)
})
