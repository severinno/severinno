#!/usr/bin/env node
/**
 * scan-unit-config.mjs - o 10o guard do batch do pre-commit: o CONTRATO da
 * nota SERIALIZED POOL do vitest.config.unit.ts (sec 11.80 + o pin da
 * citacao da sec 11.95) executado NO BATCH (2026-08-12, sec 11.96 do
 * gates-proofs.md).
 *
 * WHY: a nota do singleFork e pinada pela suite unit-surface-contract
 * (sec 11.80 poolNotePresent + sec 11.95 a citacao da planura vs a sec
 * 8.1) - mas SO como SUITE via test:unit (no CI/push). O pre-commit:test
 * mapeia vitest.config.unit.ts para NADA (o mapper so cobre src/ e
 * scripts/ sources com suite co-localizada), entao editar o config
 * (reescrever a justificativa, remover a nota, dessincronizar a citacao)
 * passava o commit local e so falharia no push/CI. Este guard fecha a
 * classe: a falha vem ANTES do commit, no batch do pre-commit (o padrao do
 * tripwire do scan-exit-claims, sec 11.42/11.56, e do 9o guard
 * scan-proof-helpers, sec 11.93).
 *
 * INVARIANTE do batch (sec 11.42/11.93): guards baratos NAO ganham
 * condicao. O pedido original avaliou 'rodar quando vitest.config.unit.ts
 * mudar' (a condicao por arquivo) - mas a premisa e supersedida pela
 * invariante: o guard roda INCONDICIONALMENTE, custo medido ~10-20ms (fs +
 * regex puros, boot compartilhado do batch). A condicao por diff seria
 * furavel (a edicao acidental nao avisa o hook de nada) e quebraria o
 * determinismo da agregacao (uma falha nunca esconde as demais).
 *
 * O CONTRATO executado (as MESMAS 2 checagens que a suite pina):
 *   1. poolNotePresent (sec 11.80): o bloco '// SERIALIZED POOL' com os
 *      tokens sec 8.1 + 2026-08 + DO NOT "parallelize" + o singleFork:
 *      true REAL (a nota nunca sai sem edicao consciente);
 *   2. calibrationMatches (sec 11.95): a citacao da planura na nota
 *      (banda + serie) == a sentenca canonica 'Calibracao CI-vs-local' da
 *      sec 8.1 (a nota nunca cita uma medicao stale).
 * As 4 funcoes EXTRATORAS vivem AQUI (a fonte unica): a suite da sec
 * 11.80/11.95 (unit-surface-contract.test.ts) as IMPORTA (a regra dos 2
 * usos - nao ha copia nos dois lugares para driftar, o padrao do
 * EXIT_CLAIMS/scan-proof-helpers).
 *
 * Exit codes do CLI: 0 = config com a nota presente + a citacao
 * sincronizada - 1 = violacoes listadas no stderr com o caminho - 2 = uso
 * errado.
 *
 * Re-validacao: `node scripts/scan-unit-config.mjs --check` + a suite da
 * sec 11.80/11.95 (importa DAQUI a fonte unica).
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

/** ROOT - a raiz do repo, com override por env (o padrao dos guards:
 * UNIT_CONFIG_SCAN_ROOT aponta um repo sintetico nos testes de isolacao do
 * batch). */
const ROOT = path.resolve(process.env.UNIT_CONFIG_SCAN_ROOT || process.cwd())

/** O caminho do config unit (a superficie do contrato). */
const UNIT_CONFIG = path.join(ROOT, "vitest.config.unit.ts")

/** O caminho do doc (a sentenca canonica da sec 8.1). */
const DOC = path.join(ROOT, "docs", "gates-proofs.md")

/**
 * True quando o config carrega a nota datada do singleFork (sec 11.80, a
 * re-mediacao (5) + a sec 11.48): o bloco '// SERIALIZED POOL' com os
 * tokens sec 8.1 + 2026-08 + DO NOT "parallelize" + o singleFork: true
 * REAL. A nota e o guard contra um leitor "consertar" o pool serializado
 * acreditando em paralelismo perdido - remove-la deve quebrar um teste,
 * nao driftar em silencio.
 */
export function poolNotePresent(src) {
  const m = src.match(/\/\/ SERIALIZED POOL[\s\S]*?singleFork: true\s*}\s*},/)
  if (!m) return false
  return (
    m[0].includes("sec 8.1") &&
    m[0].includes("2026-08") &&
    m[0].includes('DO NOT "parallelize"')
  )
}

/** O texto da sec 8.1 (entre os headers ## 8.1 e ## 8.2 - o padrao sectionBetween). */
export function sec81Text(doc) {
  const i = doc.indexOf("## 8.1 ")
  const j = doc.indexOf("## 8.2 ", i)
  if (i === -1 || j === -1) throw new Error("sec81Text: sec 8.1 boundaries not found in gates-proofs.md")
  return doc.slice(i, j)
}

/**
 * A sentenca canonica da sec 8.1 (a "Calibracao CI-vs-local"): `o step do
 * CI mede **19-23.5s** (re-medi\coes 2-6: 20 \u2192 ... \u2192 22.5s`. A
 * afirmacao da doc SOBRE a re-mediacao mais recente - o anchor da citacao
 * da nota. Throws fail-loud quando a sentenca driftou.
 */
export function docCalibration(sec81) {
  // A serie da doc usa " \u2192 " (espaco-seta-espaco) e QUEBRA DE LINHA apos
  // o '22.2 ->' (o \s* tolera o wrap fisico; a serie da nota usa " -> " ASCII
  // numa unica linha). O pin compara os VALORES, nao os formatos.
  const m = sec81.match(/mede \*\*([\d.]+)-([\d.]+)s\*\* \(re-medi\u00e7\u00f5es 2-\d+: ([\d.]+(?:\s*\u2192\s*[\d.]+)*)/)
  if (!m) throw new Error("docCalibration: canonical calibration sentence not found in sec 8.1")
  return {
    bandMin: Number(m[1]),
    bandMax: Number(m[2]),
    series: m[3].split(/\s*\u2192\s*/).map((s) => Number(s)),
  }
}

/**
 * A citacao da planura na nota (sec 11.95): o SERIALIZED POOL note deve
 * citar a banda + a serie verbatim - um fato medido citado FORA da doc (a
 * classe de drift: uma re-mediacao recalibrando a sec 8.1 deve forcar a
 * atualizacao da nota, nao deixa-la stale).
 */
export function noteCalibration(src) {
  const m = src.match(/guard band \(test:guard ([\d.]+)-([\d.]+)s, series ([\d.]+(?: -> [\d.]+)*)s as the suites grew/)
  if (!m) throw new Error("noteCalibration: flatness citation not found in the config note")
  return {
    bandMin: Number(m[1]),
    bandMax: Number(m[2]),
    series: m[3].split(" -> ").map((s) => Number(s)),
  }
}

/** O contrato da citacao: a banda + a serie da nota devem IGUALAR as da doc. */
export function calibrationMatches(note, doc) {
  if (note.bandMin !== doc.bandMin || note.bandMax !== doc.bandMax) return false
  if (note.series.length !== doc.series.length) return false
  return note.series.every((v, i) => v === doc.series[i])
}

/**
 * checkUnitConfig - o scan real (o que o CLI roda): le o config + o doc do
 * root e agrega as violacoes das 2 checagens. Config ausente => 1 violacao
 * (o scan nunca crasha). Doc ausente => a citacao nao pode validar (falha
 * com o caminho - nao existe nota sem sentenca para comparar).
 * @returns {string[]} violacoes prontas para o stderr (vazio = clean).
 */
export function checkUnitConfig() {
  const violations = []
  if (!fs.existsSync(UNIT_CONFIG)) {
    violations.push(`vitest.config.unit.ts ausente em ${ROOT}`)
    return violations
  }
  const config = fs.readFileSync(UNIT_CONFIG, "utf8")
  if (!poolNotePresent(config)) {
    violations.push(
      "vitest.config.unit.ts: o bloco '// SERIALIZED POOL' da nota (sec 11.80) ausente ou sem os tokens (sec 8.1, 2026-08, DO NOT \"parallelize\", singleFork: true)",
    )
    // Short-circuit: sem nota nao ha citacao para validar (a violacao da
    // presenca e a raiz; as demais seriam ruido da mesma edicao).
    return violations
  }
  const docPath = DOC
  if (!fs.existsSync(docPath)) {
    violations.push(`docs/gates-proofs.md ausente em ${ROOT} - impossivel validar a citacao da sec 11.95`)
    return violations
  }
  const docText = fs.readFileSync(docPath, "utf8")
  let note
  let doc
  try {
    note = noteCalibration(config)
  } catch (e) {
    violations.push(`vitest.config.unit.ts: ${e.message}`)
    return violations
  }
  try {
    doc = docCalibration(sec81Text(docText))
  } catch (e) {
    violations.push(`docs/gates-proofs.md: ${e.message}`)
    return violations
  }
  if (note && doc && !calibrationMatches(note, doc)) {
    violations.push(
      "vitest.config.unit.ts: a citacao da planura (banda + serie, sec 11.95) diverge da sentenca canonica da sec 8.1 - a nota cita uma medicao stale (rode a re-medicao da sec 8.1 e atualize a nota JUNTO, o par nunca drift separado)",
    )
  }
  return violations
}

/** CLI: `node scripts/scan-unit-config.mjs [--check]` - exit 0/1/2. */
export function main() {
  const args = process.argv.slice(2)
  const unknown = args.filter((a) => a.startsWith("--") && a !== "--check")
  if (unknown.length > 0) {
    process.stderr.write("unit-config: usage: node scripts/scan-unit-config.mjs [--check]\n")
    return 2
  }
  const violations = checkUnitConfig()
  if (violations.length === 0) {
    process.stdout.write(
      "unit-config: clean (nota SERIALIZED POOL presente e citacao sincronizada com a sec 8.1 - sec 11.80/11.95/11.96)\n",
    )
    return 0
  }
  process.stderr.write(`unit-config: ${violations.length} violacao(oes) do contrato da nota do config (sec 11.80/11.95):\n`)
  for (const v of violations) process.stderr.write(`  ${v}\n`)
  process.stderr.write(
    "  CURE: restaure a nota do vitest.config.unit.ts (sec 11.80) ou rode a re-medicao da sec 8.1 (node scripts/guard-remeasure.mjs) e atualize a nota JUNTO com a sentenca canonica (sec 11.95); confirme com: node scripts/scan-unit-config.mjs --check\n",
  )
  return 1
}

// Entry-point guard: so roda o CLI quando executado direto (o batch runner
// importa main() e o chama no MESMO processo - importar NAO executa).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main()
}
