#!/usr/bin/env node
/**
 * check-node-modules-integrity.mjs - guard de layout divergente do node_modules (2026-08)
 *
 * WHY: a secao 8.5 do gates-proofs.md documentou a classe de erro em que o
 * `bun install` COMUM nao detecta um node_modules divergente: o bun confia no
 * layout existente e reporta "no changes" mesmo quando o store esta corrompido
 * (react/react-dom duplicados -> invalid hook call em TODA a suite de
 * componentes; 114 testes vermelhos por motivo ambiental, nao de codigo). O
 * bun NAO reconcilia um layout divergente - o reparo e o install limpo
 * (`rm -rf node_modules && bun install --frozen-lockfile`, 160s, lock
 * byte-identical). Este guard e o sinal barato que trava essa classe ANTES de
 * o tsc/testes falharem com sintomas confusos.
 *
 * DETECCAO: compara a VERSAO instalada de react e react-dom (via leitura
 * direta de node_modules/<pkg>/package.json, sem require() - mais barato e
 * imune a cache de modulos; o "require" do pedido, implementado assim) com a versao
 * RESOLVIDA no bun.lock (grep da linha `"react": ["react@19.2.3", ...]` do
 * lock JSON do bun - o 1o elemento do array da entrada e o specifier
 * resolvido). Divergiu = o node_modules nao reflete o lock -> o bun install
 * comum nao repara -> falha com o comando de cura. Dois pacotes basta: o
 * par react/react-dom e o que, duplicado, derruba a suite inteira (a classe
 * da 8.5); uma divergencia em qualquer outro pacote relevante aparece como
 * sintoma em tsc/testes, mas este guard cobre o par que transforma um commit
 * limpo em 114 falhas ambientais.
 *
 * LIMITACAO (documentada, aceita): a comparacao e por VERSAO, nao por
 * conteudo/hash. Uma divergencia que preserva a versao (ex.: arquivos
 * corrompidos com o mesmo package.json) nao e detectada - e o mesmo limite
 * do proxy da 8.5; o proposito e flagrar o layout divergente (pacote de
 * versao errada ou ausente), nao corrupcao de bytes. Se o bun.lock nao
 * existe (repo nao instalado) o guard faz skip exit 0 - o CI e o setup
 * inicial cuidam disso; o hook so corre com node_modules presente.
 *
 * CUSTO: <10ms (2 reads de package.json + 1 read do lock, puro node, sem
 * deps). Env override NODE_MODULES_ROOT (repo sintetico p/ o vitest -
 * espelha o NEXT_TYPES_ROOT do check-next-types e o FRAGILE_SCAN_ROOT do
 * fragile-range). Saida ASCII pura (gate file).
 */
import fs from "node:fs"
import path from "node:path"

const ROOT = path.resolve(process.env.NODE_MODULES_ROOT || process.cwd())
const LOCK = path.join(ROOT, "bun.lock")
// O par que, duplicado, derruba a suite inteira (a classe da secao 8.5).
const PKGS = ["react", "react-dom"]

/** Le a versao resolvida de um pacote no bun.lock (grep da entrada JSON). */
function lockedVersion(lockText, pkg) {
  // bun.lock (lockfileVersion 1): "react": ["react@19.2.3", "https://...", ...]
  const m = lockText.match(new RegExp(`"${pkg}": \\["${pkg}@([^"]+)"`))
  return m ? m[1] : null
}

function main() {
  if (!fs.existsSync(LOCK)) {
    console.log("check-node-modules-integrity: skip (no bun.lock to compare)")
    return 0
  }
  const lockText = fs.readFileSync(LOCK, "utf8")
  const diverged = []
  const unverifiable = []
  for (const pkg of PKGS) {
    const locked = lockedVersion(lockText, pkg)
    const installedPath = path.join(ROOT, "node_modules", pkg, "package.json")
    const installed = fs.existsSync(installedPath)
      ? JSON.parse(fs.readFileSync(installedPath, "utf8")).version
      : null
    // FAIL-SAFE: lock existe mas a entrada do pkg NAO foi localizada (ex.:
    // bun.lock v2 futuro muda o formato da linha) - nunca 'clean' silencioso
    // com o guard desligado; falha com mensagem explicita forcando a atualizacao.
    if (locked === null) {
      unverifiable.push(pkg)
      continue
    }
    if (installed !== locked) {
      diverged.push({ pkg, installed: installed || "MISSING", locked })
    }
  }
  if (unverifiable.length > 0) {
    console.log(`check-node-modules-integrity: UNVERIFIABLE ${unverifiable.join("/")} - resolved version not found in bun.lock (lock format changed? update the guard)`)
    return 1
  }
  if (diverged.length === 0) {
    const versions = PKGS.map((p) => lockedVersion(lockText, p)).join("/")
    console.log(`check-node-modules-integrity: clean (react/react-dom match bun.lock: ${versions})`)
    return 0
  }
  for (const d of diverged) {
    console.log(
      `check-node-modules-integrity: DIVERGENT ${d.pkg} installed=${d.installed} locked=${d.locked}`,
    )
  }
  console.log("check-node-modules-integrity: node_modules divergente do lock - o bun install comum NAO repara (confia no layout existente)")
  console.log("check-node-modules-integrity: CURE: rm -rf node_modules && bun install --frozen-lockfile")
  console.log("check-node-modules-integrity: (sec. 8.5 do gates-proofs.md: install limpo, lock byte-identical, 160s)")
  return 1
}

process.exitCode = main()
