#!/usr/bin/env node
/**
 * audit-lockfile-divergence.mjs - inventario da divergencia pnpm-lock vs bun.lock (2026-08)
 *
 * WHY: a secao 8.6 do gates-proofs.md documentou que o pnpm-lock.yaml
 * resolveu react 19.2.8 enquanto o bun.lock resolve 19.2.3 - os dois locks
 * NUNCA rodaram na mesma arvore sem conflito. Este script produz o
 * inventario COMPLETO dos pacotes diretos com resolucao divergente entre os
 * dois locks, tornando a migracao pnpm->bun auditavel (nao so o par react).
 *
 * FONTES (por path, nao por cwd - o repo real OU um snapshot restaurado):
 *   --pnpm <path>  o pnpm-lock.yaml (snapshot do ultimo commit que o teve:
 *                  `git show HEAD:pnpm-lock.yaml` - hoje o arquivo esta
 *                  removido da arvore, o snapshot e a fonte auditavel).
 *   --bun  <path>  o bun.lock vigente (default ./bun.lock).
 *
 * FORMATOS PARSEADOS:
 *   pnpm v9: `importers: .: dependencies: <pkg>: { specifier, version }` -
 *     a resolucao final pode vir com peer-deps anexadas
 *     (`5.4.0(react-hook-form@7.82.0(react@19.2.8))`) - extrai so o numero.
 *   bun v1: `"pkg": ["pkg@ver", "https://...", {...}]` - a versao e o 1o
 *     elemento do array (o specifier resolvido), formato identico ao que o
 *     check-node-modules-integrity.mjs ja grepa.
 *
 * SAIDA: por pacote com divergencia, `DIVERGE <pkg>: pnpm=<ver> bun=<ver>`
 * (ordenado por nome); no fim, o resumo `N divergences / M direct packages`
 * e exit 1 se houver qualquer divergencia (0 = locks identicos nos diretos).
 * Pacotes sem entrada em um dos locks (ex.: um lock anterior/removido que
 * nao conhecia um dep novo) sao contados como divergencia de PRESENCA.
 *
 * Uso na auditoria (registrado na 8.6):
 *   git show HEAD:pnpm-lock.yaml > /tmp/pnpm-lock-head.yaml
 *   node scripts/audit-lockfile-divergence.mjs --pnpm /tmp/pnpm-lock-head.yaml
 */
import fs from "node:fs"
import path from "node:path"

const argv = process.argv.slice(2)
const pnpmIdx = argv.indexOf("--pnpm")
const pnpmPath = pnpmIdx >= 0 ? argv[pnpmIdx + 1] : undefined
if (!pnpmPath || !fs.existsSync(pnpmPath)) {
  console.error("audit-lockfile-divergence: --pnpm <pnpm-lock.yaml> required (restore the snapshot: git show HEAD:pnpm-lock.yaml > /tmp/pnpm-lock-head.yaml)")
  process.exit(2)
}
const bunIdx = argv.indexOf("--bun")
const bunPath = bunIdx >= 0 ? argv[bunIdx + 1] : path.resolve(process.cwd(), "bun.lock")
if (!fs.existsSync(bunPath)) {
  console.error(`audit-lockfile-divergence: bun.lock not found at ${bunPath} (pass --bun <path>)`)
  process.exit(2)
}

/**
 * Versao resolvida de um pacote direto no pnpm-lock v9: entra pelo bloco
 * `importers: .: dependencies:`. A linha `version:` pode trazer peer-deps
 * anexadas (`5.4.0(react-hook-form@7.82.0(react@19.2.8))`) - extrai o numero
 * ate o primeiro char nao [0-9.]. Tambem pode ser `link:`/`workspace:`/
 * `file:` (nao-registry) - devolve o spec cru (presenca documentada).
 * SO pacotes do bloco importers (diretos) entram - nunca o set transitivo
 * do bloco `packages:` (comparar transitivos distorceria o inventario com
 * ABSENT em massa, como a 1a rodada mostrou).
 */
function pnpmDirectVersions(text) {
  const out = {}
  // seccao importers -> primeiro bloco `.` (o workspace raiz)
  // NOTA: o lookahead termina SOMENTE em `\npackages:` - o importers e
  // sempre o primeiro bloco top-level e `.` o unico workspace raiz. Nao usar
  // `\n\s{2}\S` como alternativa: versoes com peer-deps aninhadas
  // (`0.1.0(vitest@3.1.1(...)(yaml@2.9.0))`) contem linhas indentadas em 2
  // DENTRO dos parenteses e truncariam o bloco no meio de uma entrada.
  const imp = text.match(/importers:\n\s*\n?\s{2}\.:\n([\s\S]*?)\npackages:/)
  if (!imp) return out
  const block = imp[1]
  // nome em 6 espacos - single-quoted apenas quando ha chars que o YAML
  // exigiria escapar (`'@aws-sdk/client-s3':`); identificador puro fica
  // SEM aspas (`react:`, `prisma:`, `next:`) - o regex aceita as duas formas
  // e o `version:` em 8 espacos.
  const re = /^ {6}(?:'([^']+)'|([^\s:]+)):\n {8}specifier: (.+)\n {8}version: (.+)$/gm
  for (const m of block.matchAll(re)) {
    const name = m[1] ?? m[2]
    // m[3] = specifier (o range pedido no package.json); m[4] = a VERSAO
    // RESOLVIDA (o que comparamos com o bun.lock)
    const ver = m[4]
    if (/^(link|workspace|file|\.|~|git|github|http):/.test(ver)) {
      out[name] = `non-registry:${ver.split("(")[0]}`
      continue
    }
    // `5.4.0(react-hook-form@7.82.0(react@19.2.8))` -> base `5.4.0`
    out[name] = ver.split("(")[0]
  }
  return out
}

/**
 * O MAPA completo de entradas do bun.lock: `"pkg": ["pkg@ver", "url", ...]`
 * -> pkg -> ver (o 1o elemento do array e o specifier resolvido; o formato
 * e o mesmo que o check-node-modules-integrity grepa). O escapo usa o nome
 * ja com o prefixo `@` (scoped) - sem re-escapa do `@`.
 */
function bunEntryMap(text) {
  const out = {}
  const re = /"((?:@[^/\s"@]+\/)?[^\s"@]+)": \["\1@([^"]+)",/g
  for (const m of text.matchAll(re)) out[m[1]] = m[2]
  return out
}

/**
 * Versao resolvida de um pacote DIRETO no bun.lock: o bloco `workspaces:
 * ""` lista os diretos do workspace raiz; a resolucao vem do bunEntryMap.
 * Como no pnpm, SO os diretos entram - o set transitivo (o resto do lock)
 * fica fora para o inventario comparar a MESMA superficie nos dois locks.
 */
function bunDirectVersions(text) {
  const out = {}
  const entries = bunEntryMap(text)
  const ws = text.match(/\n {4}"": \{\n([\s\S]*?)\n {4}\}/)
  if (!ws) return out
  const names = []
  // os diretos vivem nos blocos `dependencies:`/`devDependencies:` (headers
  // em 6 espacos, entries em 8, fechamento `},` em 6). Parse linha a linha:
  // ao achar um header de seccao, coleta as linhas seguintes no indent 8
  // ate sair do bloco - ancoramento por indent, imune a variacoes de chave.
  const lines = ws[1].split("\n")
  let inSection = false
  for (const line of lines) {
    if (/^ {6}"(?:dependencies|devDependencies)": \{/.test(line)) {
      inSection = true
      continue
    }
    if (inSection) {
      if (/^ {6}\},?$/.test(line)) {
        inSection = false
        continue
      }
      const m = line.match(/^ {8}"([^"]+)":/)
      if (m) names.push(m[1])
    }
  }
  for (const name of names) {
    out[name] = entries[name] ?? "UNRESOLVED"
  }
  return out
}

const pnpmText = fs.readFileSync(pnpmPath, "utf8")
const bunText = fs.readFileSync(bunPath, "utf8")
const pnpm = pnpmDirectVersions(pnpmText)
const bun = bunDirectVersions(bunText)

const names = [...new Set([...Object.keys(pnpm), ...Object.keys(bun)])].sort()
const diverged = []
for (const name of names) {
  const p = pnpm[name]
  const b = bun[name]
  if (p === undefined || b === undefined) {
    diverged.push({ name, pnpm: p ?? "ABSENT", bun: b ?? "ABSENT" })
  } else if (p !== b) {
    diverged.push({ name, pnpm: p, bun: b })
  }
}

for (const d of diverged) {
  console.log(`DIVERGE ${d.name}: pnpm=${d.pnpm} bun=${d.bun}`)
}
console.log(`${diverged.length} divergences / ${names.length} direct packages`)
process.exit(diverged.length > 0 ? 1 : 0)
