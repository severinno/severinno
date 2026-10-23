#!/usr/bin/env node
// =============================================================================
// stage-migrate-closure.mjs
//
// Copia para um staging a FECHAMENTO (closure) de dependências que o
// `prisma migrate deploy` resolve em RUNTIME a partir de /app/node_modules —
// e nada além disso.
//
// POR QUE ESTE SCRIPT EXISTE: a imagem de produção é montada pelo fallback
// host-artifacts (.gitea/workflows/deploy.yml) e o `COPY node_modules` dela
// levava o node_modules INTEIRO (~1,4GB, 716 pacotes, devDeps inclusas) por
// cima do node_modules traçado (~141M, 45 pacotes) que o
// `.next/standalone` já traz — a imagem pagava ~1,3GB de letra morta.
// O que o migrate precisa ALÉM do standalone é pequeno e declarado aqui.
//
// COMO A FECHAMENTO É CALCULADA: caminhada sobre os `dependencies` de cada
// package.json (NÃO optionalDependencies, NÃO peerDependencies — quem faltar
// em runtime falha ALTO no `prisma migrate deploy` da prova, e a linha de
// baixo é acrescentada), resolvendo cada pacote na árvore do node_modules
// completo (hoisted do bun) pela MESMA regra de resolução do node: sobe de
// diretório em diretório procurando node_modules/<nome>.
//
// Usage:
//   node scripts/stage-migrate-closure.mjs <node_modules de origem> <staging dest>
//
// Exit codes: 0 ok · 1 uso inválido · 2 pacote não encontrado na origem
// =============================================================================

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import process from "node:process"

// As sementes: o que o prisma.config.ts (lido pelo CLI do migrate dentro da
// imagem) importa diretamente. O CLI em si é global na imagem (npm -g) e o
// client (.prisma/@prisma/client) já vem no standalone traçado.
export const SEEDS = ["dotenv", "@prisma/config"]

function usageAndExit(code) {
  console.error(
    "uso: node scripts/stage-migrate-closure.mjs <node_modules de origem> <staging dest>",
  )
  process.exit(code)
}

const [srcArg, dstArg] = process.argv.slice(2)
if (!srcArg || !dstArg) usageAndExit(1)

const SRC = resolve(srcArg)
const DST = resolve(dstArg)
if (!existsSync(join(SRC, "..", "package.json")) && !existsSync(SRC)) {
  console.error(`origem não encontrada: ${SRC}`)
  process.exit(1)
}

/** Lê os dependencies declarados de um pacote (ignora dev/optional/peer). */
function declaredDeps(pkgDir) {
  const manifest = join(pkgDir, "package.json")
  if (!existsSync(manifest)) return []
  try {
    const pkg = JSON.parse(readFileSync(manifest, "utf-8"))
    return Object.keys(pkg.dependencies ?? {})
  } catch {
    console.error(`package.json ilegível em ${pkgDir} — fail-closed`)
    process.exit(2)
  }
}

/**
 * Resolve um pacote pela regra do node a partir de `fromDir`: sobe procurando
 * node_modules/<nome>. Bun hoista para a raiz, mas pacotes com conflito de
 * versão ficam aninhados — a caminhada cobre os dois casos.
 */
function resolveDep(name, fromDir) {
  let current = fromDir
  while (true) {
    const candidate = join(current, "node_modules", name)
    if (existsSync(join(candidate, "package.json"))) return candidate
    const parent = dirname(current)
    if (parent === current) return null
    current = parent
  }
}

const staged = new Set()
const queue = []

for (const seed of SEEDS) {
  const dir = resolveDep(seed, SRC)
  if (!dir) {
    console.error(`semente não encontrada na origem: ${seed} (em ${SRC})`)
    process.exit(2)
  }
  queue.push([seed, dir])
}

while (queue.length > 0) {
  const [name, dir] = queue.shift()
  if (staged.has(name)) continue
  staged.add(name)

  const dest = join(DST, name)
  rmSync(dest, { recursive: true, force: true })
  mkdirSync(dirname(dest), { recursive: true })
  cpSync(dir, dest, { recursive: true })

  for (const dep of declaredDeps(dir)) {
    const depDir = resolveDep(dep, dirname(dir))
    if (!depDir) {
      console.error(
        `[stage-migrate-closure] dependência transitiva não encontrada: ` +
          `${dep} (pedida por ${name}) — acrescente-a às sementes ou à origem`,
      )
      process.exit(2)
    }
    queue.push([dep, depDir])
  }
}

console.log(
  `[stage-migrate-closure] ${staged.size} pacote(s) copiado(s) para ${DST}: ` +
    [...staged].join(", "),
)
