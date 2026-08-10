#!/usr/bin/env node
/**
 * check-next-types.mjs - auto-heal do .next/types stale (2026-08)
 *
 * WHY: o tsconfig.json inclui os globs de types gerados do .next (".next/types"
 * e ".next/dev/types"). Quando o `next` instalado muda de versao (package.json
 * "next": "^16.1.1" -> bun install resolve 16.1.3), o surface de types GERADO
 * por uma versao anterior importa membros de next/dist que a versao nova nao
 * exporta mais (ex.: 2026-08: 123 erros TS2305, todos
 * `InstantConfigForTypeCheckInternal` em .next/types/app). O `tsc --noEmit`
 * do pre-commit passa a falhar em TODO commit ate o surface stale ser
 * removido - mesmo sem nenhuma mudanca no codigo-fonte.
 *
 * DETECCAO (por mtime, nao por parsing de erro): a classe de falha e "o next
 * foi (re)instalado DEPOIS dos types terem sido gerados". Se o mtime de
 * node_modules/next/package.json (o momento da instalacao) e MAIS NOVO (ou
 * igual - tie de granularidade de mtime em fs de 1-2s) que o mtime mais
 * recente sob .next/types e .next/dev/types (o momento da geracao), os types
 * podem ser de uma versao anterior -> STALE. Nenhum regex de mensagem de
 * erro, nenhum nome de membro hardcoded - so a ordem de mtime, que captura
 * exatamente a classe de drift de versao. O `>=` (nao `>`) escolhe o lado
 * seguro no tie: falso-positivo remove types validos que regeneram
 * (inofensivo); falso-negativo deixaria os 123 erros bloqueando o commit
 * (o problema original).
 *
 * HEAL (--fix): remove SOMENTE .next/types e .next/dev/types - o surface
 * gerado, nunca o .next inteiro (preserva o cache de build; o proximo
 * `next dev`/`next build` regenera os types). Se um `next dev` estiver
 * RODANDO quando o --fix remove os dirs, e seguro: o dev server regenera o
 * surface no proximo compile. A ausencia dos types e SEGURA para o tsc
 * standalone: o include dos globs casa zero arquivos (provado 2026-08:
 * `rm -rf .next` -> tsc exit 0), e o CI typechecka checkout fresco sem
 * .next desde sempre.
 *
 * POR QUE NO PRE-COMMIT E NAO NO CI: o CI so ve checkout fresco (sem .next,
 * ou com types gerados pelo mesmo next no mesmo job) - a stale surface so
 * existe LOCALMENTE, entre um bun install que sobe o next e o proximo
 * dev/build. O hook roda o guard com --fix antes do tsc; o CI nao precisa.
 *
 * LIMITACAO RESIDUAL (documentada, aceita): mtime e um PROXY para mudanca
 * de versao - um .next copiado de outro lugar DEPOIS do install (preservando
 * mtime mais novo) escaparia da deteccao.
 *
 * AUDITORIA 2026-08-09 (next 16.1.3): NAO existe marcador de versao estavel
 * dentro do .next que permita comparacao direta - mantido o heuristico por
 * EVIDENCIA, nao por falta de tentativa (dev real gerou .next/dev/types;
 * source do next dist auditado):
 *   1. .next/BUILD_ID: hash aleatorio (generateBuildId -> nanoid), nao a
 *      versao - confirmado em generate-build-id.js e write-build-id.js
 *      (escreve o buildId, sem versao).
 *   2. .next/package.json: {"type":"commonjs"} (dev mode), sem versao.
 *   3. Types gerados (routes.d.ts, cache-life.d.ts, validator.ts): header
 *      "This file is generated automatically by Next.js", sem versao.
 *   4. Unica ocorrencia da versao no .next: .next/dev/trace (log de
 *      diagnostico do hot-reloader, tags.version) - NAO e contrato: pode
 *      nao existir em build mode e e rotacionado/sobrescrito a cada run.
 * Se uma versao futura do next gravar um marcador estavel (ex.: a versao
 * no header dos types gerados), a comparacao direta substituira o
 * heuristico - ate la, mtime e o sinal de classe disponivel sem parsing
 * de erro.
 *
 * MEDICAO 2026-08-09 (lock ja em 16.1.3, node_modules ja em 16.1.3):
 * bun install NAO reescreve node_modules/next/package.json quando a
 * resolucao nao muda. Medido - `bun install --frozen-lockfile` (22s) e
 * `bun install` simples (2s) ambos sairam "Checked 1227 installs across
 * 1328 packages (no changes)" e o mtime do package.json ficou INTACTO
 * (07-18 09:16:13.533, valor identico antes/depois). O mtime do install
 * so sobe quando o bun RE-RESOLVE o next (bump de versao - a classe do
 * incidente original, um bun install normal subindo 16.1.1 -> 16.1.3
 * via ^16.1.1) - exatamente quando o guard DEVE acusar STALE. Logo: sem
 * risco de falso STALE em install no-op; o heuristico fica correto nos
 * dois casos (bump detecta, no-op nao trip). MEDIDA ADICIONAL 2026-08-09
 * (reify parcial - a lacuna fechada): bump real de uma dep NAO
 * relacionada no package.json (uuid ^11.1.0 -> ^12.0.1 - bump de major,
 * o next NAO re-resolvido) +
 * `bun install` (5.39s, "1 package installed") -> node_modules/next/
 * package.json ficou com mtime IDENTICO (1784376973533.5103 antes e
 * depois) e hash sha256 IDENTICO (8657813c...); o diff do bun.lock
 * tocou so a entrada do uuid. O restore (--frozen-lockfile, 12.0.1 ->
 * 11.1.0, 1.2s) repetiu o mesmo: next pkg intacto. Logo o reify parcial
 * NAO avanca o mtime do next - o heuristico so trip quando a propria
 * resolucao do next muda (o bump), onde STALE e o comportamento
 * correto. Dado extra: uma falha de resolucao (specifier inexistente)
 * aborta o install sem tocar nem o next pkg nem o bun.lock.
 *
 * Env override NEXT_TYPES_ROOT (repo sintetico p/ o vitest - espelha o
 * FRAGILE_SCAN_ROOT do fragile-range). Saida ASCII pura (gate file).
 * Puro node, sem deps, <10ms.
 */
import fs from "node:fs"
import path from "node:path"

const ROOT = path.resolve(process.env.NEXT_TYPES_ROOT || process.cwd())
const NEXT_PKG = path.join(ROOT, "node_modules", "next", "package.json")
const TYPE_DIRS = [".next/types", ".next/dev/types"]

/** Newest mtime (ms) under a dir tree; 0 when the dir is absent/empty. */
function newestMtime(dir) {
  let newest = 0
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else newest = Math.max(newest, fs.statSync(p).mtimeMs)
    }
  }
  walk(dir)
  return newest
}

function main() {
  const fix = process.argv.includes("--fix")
  if (!fs.existsSync(NEXT_PKG)) {
    console.log("check-next-types: clean (no installed next to compare)")
    return 0
  }
  const installedMs = fs.statSync(NEXT_PKG).mtimeMs
  const stale = []
  let found = 0 // dirs de types COM CONTEUDO (para a mensagem honesta)
  for (const rel of TYPE_DIRS) {
    const abs = path.join(ROOT, rel)
    if (!fs.existsSync(abs)) continue
    const genMs = newestMtime(abs)
    if (genMs > 0) found++ // dir vazio nao e "types gerados" - nao conta
    // `>=`: tie de granularidade de mtime tambem e stale (lado seguro -
    // falso-positivo regenera; falso-negativo = os 123 erros de volta).
    if (genMs > 0 && installedMs >= genMs) stale.push(rel)
  }
  if (stale.length === 0) {
    // Dois estados distintos: sem types nenhum (comum - checkout fresco ou
    // apos um heal) vs types existentes e mais novos que o install.
    console.log(
      found === 0
        ? "check-next-types: clean (no generated types to check)"
        : "check-next-types: clean (generated types are newer than the installed next)",
    )
    return 0
  }
  for (const rel of stale) {
    console.log(`check-next-types: STALE ${rel} (generated by a previous next version)`)
  }
  if (!fix) {
    console.log("check-next-types: run with --fix to remove the stale generated surface (regenerated on the next next dev/build)")
    return 1
  }
  for (const rel of stale) {
    fs.rmSync(path.join(ROOT, rel), { recursive: true, force: true })
    console.log(`check-next-types: REMOVED ${rel} (regenerated on the next next dev/build)`)
  }
  return 0
}

process.exitCode = main()
