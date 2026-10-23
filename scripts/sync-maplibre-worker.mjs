#!/usr/bin/env node
/**
 * sync-maplibre-worker.mjs — copia o worker standalone do maplibre-gl
 * para public/maplibre/ (com extensão .js para MIME text/javascript
 * garantido) e reescreve o import relativo do shared.
 *
 * Roda no postinstall. O check (sem --check) falha se os arquivos
 * desalinharem da versão instalada — evita worker/style mismatch.
 *
 * Usage:
 *   node scripts/sync-maplibre-worker.mjs [--check]
 *
 * Exit codes:
 *   0 — sucesso (assets copiados ou alinhados no --check)
 *   1 — desalinhado em modo --check, ou falha de cópia/escrita
 */

import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const require = createRequire(import.meta.url)
const checkOnly = process.argv.includes("--check")

const pkgVersion = JSON.parse(
  readFileSync(join(root, "node_modules/maplibre-gl/package.json"), "utf8"),
).version

const FILES = [
  {
    src: "node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs",
    dest: "public/maplibre/maplibre-gl-worker.js",
    // O worker importa o shared por caminho relativo — reescreve p/ .js
    rewrite: (content) =>
      content.replaceAll(`from"./maplibre-gl-shared.mjs"`, `from"./maplibre-gl-shared.js"`),
  },
  {
    src: "node_modules/maplibre-gl/dist/maplibre-gl-shared.mjs",
    dest: "public/maplibre/maplibre-gl-shared.js",
    rewrite: null,
  },
]

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex")
}

let failed = false
for (const { src, dest, rewrite } of FILES) {
  const srcPath = join(root, src)
  const destPath = join(root, dest)
  let expected = readFileSync(srcPath)
  if (rewrite) expected = Buffer.from(rewrite(expected.toString("utf8")), "utf8")

  let current
  try {
    current = readFileSync(destPath)
  } catch {
    current = null
  }

  if (checkOnly) {
    if (!current || sha256(current) !== sha256(expected)) {
      console.error(
        `❌ ${dest} desalinhado de maplibre-gl@${pkgVersion}. Rode: node scripts/sync-maplibre-worker.mjs`,
      )
      failed = true
    } else {
      console.log(`✓ ${dest} (maplibre-gl@${pkgVersion})`)
    }
    continue
  }

  mkdirSync(dirname(destPath), { recursive: true })
  writeFileSync(destPath, expected)
  console.log(`✓ sincronizado ${src} → ${dest} (maplibre-gl@${pkgVersion})`)
}

// Marca a versão servida — útil p/ debug e p/ invalidar cache em upgrades.
if (!checkOnly) {
  writeFileSync(join(root, "public/maplibre/VERSION.txt"), `maplibre-gl@${pkgVersion}\n`)
  void require
}

process.exit(failed ? 1 : 0)
