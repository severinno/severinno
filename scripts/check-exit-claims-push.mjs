#!/usr/bin/env node
/**
 * check-exit-claims-push.mjs - guard git-based do push net (2026-08-11, sec 11.49).
 *
 * WHY: o tripwire do scan-exit-claims roda no BATCH RUNNER do pre-commit (8o
 * guard, sec 11.42) contra a WORKING TREE - mas so quando o hook roda. Um
 * commit feito com HUSKY=0 ou --no-verify esconde uma claim nova de exit
 * code no gates-proofs.md SEM registro no EXIT_CLAIMS: o pre-commit nao
 * tripou (bypassed), e o pre-push local NAO pega a classe - o Gate 3
 * mapeado (pre-commit-tests.mjs) mapeia docs/* -> NENHUMA suite (secao 11.x
 * de pre-commit-tests: "anything else (docs, workflow YAML, e2e specs, ...)
 * maps to nothing"), entao o scan-exit-claims.test.ts (REAL-REPO CONTRACT
 * le o doc real) nunca roda localmente num push docs-only. O CI (ci.yml
 * test:run / pr-check test:unit) pega DEPOIS do push - a claim sai da
 * maquina. Este guard fecha o furo NO MOMENTO DO PUSH: materializa o doc
 * COMMITADO (git show HEAD:docs/gates-proofs.md - o estado exato que sera
 * empurrado, NAO a working tree) e roda o detector contra ele.
 *
 * DESIGN (o probe 2026-08-11 que calibrarizou o guard):
 *   - DIRECAO UNICA: o guard usa SOMENTE o .unregistered do checkExitClaims
 *     (claim no doc SEM entrada no manifest) - a classe do pedido. O stale
 *     (entrada no manifest sem claim no doc) e RUIDO DE DELTA: um delta
 *     nao-commitado na working tree (manifest adiante do doc commitado)
 *     false-positiva o stale contra o doc materializado (o probe flagrou
 *     'entrada 11.47 sem claim no doc atual' com o doc de HEAD - a 11.47
 *     e um registro da working tree, nao do commit). As demais direcoes
 *     (brokenPins/brokenChains) sao propriedades da working tree, cobertas
 *     pelo batch do pre-commit + test:unit. O escopo do guard e preciso:
 *     "o doc commitado tem claim sem registro".
 *   - HEAD vs BASE: o guard compara o doc commitado em HEAD contra o doc do
 *     base do push (--since, o PRE_PUSH_REMOTE_SHA do hook; all-zeros /
 *     ausente = primeiro push -> fallback HEAD~1 quando existe). A distincao
 *     e de MENSAGEM (introduzida neste push vs pre-existente), NAO de
 *     pass/fail: um doc commitado sujo BLOQUEIA o push em qualquer caso
 *     (empurrar estado quebrado adiante e a classe; o fix e barato -
 *     registrar a claim).
 *   - ENV OVERRIDE (padrao dos irmaos: NODE_MODULES_ROOT, GUARD_GATES_SCAN_ROOT,
 *     EXIT_CLAIMS_DOC...): CHECK_EXIT_CLAIMS_PUSH_DOC aponta um arquivo para
 *     usar COMO o doc de HEAD (pula o git show) - o seam hermetico dos
 *     testes (poison doc -> exit 1 com a secao exata) e o mesmo mecanismo
 *     de inspecao manual. O guard real no hook nunca seta.
 *
 * CUSTO (medido no probe 2026-08-11): git show + scan = ~0.44s local. Acima
 * do limiar <0.2s do batch-worthiness da 11.17 - o veredito 'pre-push NAO
 * batchado' permanece (o batch economizaria so o boot node; sec 11.49).
 *
 * Exit codes: 0 = doc commitado limpo (ou apenas claims pre-existentes);
 * 1 = claim(s) nao-registrada(s) OU secao(oes) 8.x desatualizada(s) no doc
 * COMMITADO (listadas); 2 = uso errado; 3 = falha de infra (git show HEAD
 * falhou). Saida ASCII pura. Puro node, sem deps.
 *
 * RECALIBRACAO (sec 11.63): o MESMO doc commitado passa tambem pelo
 * checkCitedCounts da sec 11.62 - uma claim nova REGISTRADA sem a
 * re-validacao datada nas secoes 8.x afetadas bloqueia o push com a CURE
 * por secao (node scripts/doc-revalidate.mjs --section 8.N). O escopo
 * principal (a direcao unica .unregistered da sec 11.49) nao muda - esta
 * e a SEGUNDA dimensao, a recalibracao. Custo desprezivel (o scan e ~ms
 * sobre o doc ja materializado).
 */
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { checkCitedCounts, checkExitClaims, EXIT_CLAIMS, EXIT_CLAIMS_CURE } from "./scan-exit-claims.mjs"

const DOC_REL = "docs/gates-proofs.md"
const HEAD = "HEAD"
const BASE_FALLBACK = "HEAD~1"

/** Parse `--since <sha>` (next-arg form, o mesmo shape do run-mapped-fuzz). */
export function parseSince(argv) {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--since") return argv[i + 1] ?? ""
  }
  return ""
}

/**
 * Valida a forma do since (all-zeros = primeiro push = sem base real).
 * Espelha o isValidSince do pre-commit-tests.mjs (a regra dos 2 usos
 * aceita o duplicado curto aqui - importar o pre-commit-tests arrastaria a
 * resolucao do binario do vitest para dentro do caminho quente do push).
 */
export function isValidBase(since) {
  const s = (since ?? "").trim()
  return s !== "" && !/^0+$/.test(s)
}

/**
 * Materializa o doc em um ref do git (`git show <ref>:docs/gates-proofs.md`).
 * Retorna o conteudo ou null quando o ref nao tem o doc (HEAD~1 inexistente
 * no primeiro commit da branch, refs pre-doc, etc.).
 */
export function materializeDoc(ref) {
  try {
    return execFileSync("git", ["show", `${ref}:${DOC_REL}`], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    })
  } catch {
    return null
  }
}

/**
 * O padrao temp-file compartilhado (regra dos 2 usos): escreve o doc numa
 * string num temp file, roda o checker real e limpa - o seam que os dois
 * guardas de dimensao usam (a sec 11.49 claims + a sec 11.63 recalibracao).
 */
function withTempDoc(content, checkFn) {
  const tmp = path.join(os.tmpdir(), `exit-claims-push-${process.pid}-${Math.random().toString(36).slice(2)}.md`)
  try {
    fs.writeFileSync(tmp, content, "utf8")
    return checkFn(tmp)
  } finally {
    fs.rmSync(tmp, { force: true })
  }
}

/** Run the real detector against a doc string (temp file) -> .unregistered. */
export const unregisteredOf = (content) => withTempDoc(content, (tmp) => checkExitClaims(tmp).unregistered)

/**
 * Run the real 8.x counts contract (sec 11.62) against a doc string (temp
 * file) -> as violacoes (secoes 8.x sem re-validacao datada citando count
 * != atual do EXIT_CLAIMS). O espelho do unregisteredOf para a dimensao
 * da recalibracao (sec 11.63).
 */
export const citedOf = (content) => withTempDoc(content, (tmp) => checkCitedCounts(tmp))

/**
 * A decisao pura do guard (exported for the hermetic vitest suite - a
 * logica que os testes pinam, sem git/fs):
 *   - headUnreg vazio -> { ok: true } (doc commitado limpo).
 *   - headUnreg nao-vazio -> { ok: false, newInPush, preExisting }.
 *     newInPush = claims de HEAD ausentes no base (introduzidas neste
 *     push); preExisting = claims que o base ja tinha. A distincao e de
 *     mensagem, nao de pass/fail: o doc commitado sujo bloqueia em qualquer
 *     caso (o fix e registrar a claim).
 *
 * @param {{ headUnreg: string[], baseUnreg?: string[], hasBase?: boolean }} args - os tres eixos
 */
export function decideExitClaimsVerdict({ headUnreg, baseUnreg = [], hasBase = false }) {
  if (headUnreg.length === 0) {
    return { ok: true, message: "clean (doc commitado em HEAD sem claims nao-registradas - sec 11.42)" }
  }
  const newInPush = hasBase ? headUnreg.filter((s) => !baseUnreg.includes(s)) : headUnreg
  const preExisting = hasBase ? headUnreg.filter((s) => baseUnreg.includes(s)) : []
  return { ok: false, newInPush, preExisting }
}

function fail(code, msg) {
  console.error(`exit-claims-push: ${msg}`)
  return code
}

/** CLI: `node scripts/check-exit-claims-push.mjs [--since <sha>]` -> exit 0/1/2/3. */
export function main() {
  const argv = process.argv.slice(2)
  const unknown = argv.filter((a) => a.startsWith("--") && a !== "--since")
  if (unknown.length > 0) {
    return fail(2, "usage: node scripts/check-exit-claims-push.mjs [--since <sha>]")
  }
  const since = parseSince(argv)

  // HEAD: o doc COMMITADO (o estado empurrado) - via git show, ou o env
  // override hermetico (CHECK_EXIT_CLAIMS_PUSH_DOC) nos testes.
  const override = process.env.CHECK_EXIT_CLAIMS_PUSH_DOC
  const headDoc = override ? (fs.existsSync(override) ? fs.readFileSync(override, "utf8") : null) : materializeDoc(HEAD)
  if (headDoc === null) {
    return fail(3, `nao consegui materializar ${DOC_REL} em ${HEAD} (git show falhou ou CHECK_EXIT_CLAIMS_PUSH_DOC invalido)`)
  }

  // BASE: o doc antes deste push. --since valido (o remote sha do hook) >
  // HEAD~1 (fallback de primeiro push) > ausente (sem comparacao).
  let baseDoc = null
  if (!override) {
    if (isValidBase(since)) baseDoc = materializeDoc(since)
    else baseDoc = materializeDoc(BASE_FALLBACK)
  }
  const hasBase = baseDoc !== null

  const headUnreg = unregisteredOf(headDoc)
  const baseUnreg = hasBase ? unregisteredOf(baseDoc) : []
  const v = decideExitClaimsVerdict({ headUnreg, baseUnreg, hasBase })

  if (v.ok) {
    // Sec 11.63 - a SEGUNDA dimensao do MESMO doc commitado: a claim nova
    // REGISTRADA no manifest sem a re-validacao datada nas secoes 8.x
    // afetadas (o loop que a 28a claim da 11.58 quebrou: registro no commit
    // dela, re-validacao da 8.34 num commit separado) sairia da maquina - o
    // vitest pegaria so no CI/PR. O checkCitedCounts da sec 11.62 roda aqui
    // e a CURE por secao e o doc-revalidate --section 8.N.
    const citedV = citedOf(headDoc)
    if (citedV.length > 0) {
      console.log(
        `exit-claims-push: ${citedV.length} secao(oes) 8.x com count de claims desatualizado no doc COMMITADO (${HEAD}) - sec 11.62/11.63:`,
      )
      for (const s of citedV) {
        console.log(
          `  secao ${s.section} cita ${JSON.stringify(s.counts)} com o EXIT_CLAIMS em ${EXIT_CLAIMS.length}: node scripts/doc-revalidate.mjs --section ${s.section} (a linha datada cobre os counts historicos da secao - sec 11.63)`,
        )
      }
      return 1
    }
    console.log(`exit-claims-push: ${v.message}${hasBase ? ` (base ${since ? `--since ${since}` : BASE_FALLBACK})` : " (sem base - primeiro push)"}`)
    return 0
  }

  console.log(`exit-claims-push: ${headUnreg.length} claim(s) NAO-registrada(s) no doc COMMITADO (${HEAD}) - sec 11.42/11.49:`)
  for (const s of v.newInPush) {
    console.log(`  claim na secao ${s} nao esta no EXIT_CLAIMS (doc commitado - um commit com HUSKY=0/--no-verify pode ter escondido; registrar a claim - sec 11.49)`)
  }
  for (const s of v.preExisting) {
    console.log(`  claim na secao ${s} nao esta no EXIT_CLAIMS (pre-existente no base, carregada por este push - registrar a claim - sec 11.49)`)
  }
  console.log(`  ${EXIT_CLAIMS_CURE}`)
  return 1
}

// Entry-point guard: so roda o CLI quando executado direto (vitest importa
// as funcoes puras para os testes sem efeitos colaterais).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main()
}
