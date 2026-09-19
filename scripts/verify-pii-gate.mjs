#!/usr/bin/env node
/**
 * Self-test do gate de PII (`check:pii-allowlist`).
 *
 * Motivação: um gate que nunca falhou não é um gate — é decoração. Este script
 * PROVA, de forma repetível, que o gate detecta a regressão que ele existe para
 * impedir. A prova manual (aplicar a regressão, rodar, desfazer) não é
 * repetível: depende de alguém lembrar de fazê-la toda vez que o guard muda.
 *
 * Como funciona:
 *   1. Monta um SANDBOX isolado em `.tmp/pii-gate-sandbox/` (cópia de `src/`,
 *      `prisma/` e dos configs do vitest). O repo real não é tocado — aliás,
 *      `node_modules` é resolvido pelo parent-walk, sem cópia.
 *   2. CONTROLE: roda o gate no sandbox limpo. PRECISA passar. Sem isso, um
 *      sandbox quebrado faria a injeção "passar" por motivo errado.
 *   3. INJEÇÃO A (runtime): adiciona `email: true` à allowlist pública de
 *      `src/lib/api-server.ts` → o teste de resposta tem de FALHAR.
 *   4. INJEÇÃO B (estática): troca um `provider: { select }` por `provider: true`
 *      em `src/lib/dispatch.ts` → o guard de relação de User tem de FALHAR.
 *   5. Remove o sandbox e sai com 0 só se o controle passou e TODAS as injeções
 *      falharam.
 *
 * Usage:
 *   bun run check:pii-gate
 *
 * Exit codes:
 *   0 — controle passou e TODAS as injeções foram detectadas
 *   1 — sandbox quebrado, controle falhou, ou alguma regressão passou batido
 */

import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const SANDBOX = path.join(ROOT, ".tmp", "pii-gate-sandbox")
const GATE_SCRIPT = "check:pii-allowlist"

/** O que o sandbox precisa para rodar o gate: código, schema e configs. */
const COPY_ENTRIES = [
  "src",
  "prisma",
  "vitest.config.ts",
  "vitest.act-setup.ts",
  "vitest.setup.ts",
  "package.json",
]

function log(icon, message) {
  console.log(`${icon} ${message}`)
}

function runGate(env = {}) {
  return spawnSync("bun", ["run", GATE_SCRIPT], {
    cwd: SANDBOX,
    encoding: "utf8",
    env: { ...process.env, ...env },
  })
}

function buildSandbox() {
  rmSync(SANDBOX, { recursive: true, force: true })
  mkdirSync(SANDBOX, { recursive: true })
  for (const entry of COPY_ENTRIES) {
    const from = path.join(ROOT, entry)
    if (!existsSync(from)) throw new Error(`Sandbox: entrada ausente no repo: ${entry}`)
    cpSync(from, path.join(SANDBOX, entry), { recursive: true })
  }
}

/** Aplica uma substituição no sandbox e devolve a função que desfaz. */
function inject(relativePath, from, to) {
  const target = path.join(SANDBOX, relativePath)
  const original = readFileSync(target, "utf8")
  if (!original.includes(from)) {
    throw new Error(
      `Injeção impossível: âncora não encontrada em ${relativePath}.\n` +
        `Procurei por:\n${from}\n` +
        "O guard mudou de lugar? Atualize a âncora — não remova a verificação.",
    )
  }
  writeFileSync(target, original.replace(from, to))
  return () => writeFileSync(target, original)
}

function describeFailure(result) {
  const out = `${result.stdout ?? ""}${result.stderr ?? ""}`
  const lines = out.split("\n").filter((line) => line.trim().length > 0)
  return lines.slice(-8).join("\n")
}

/** Roda o gate num cenário injetado e exige que ele FALHE. */
function expectGateToFail(label, inject) {
  const restore = inject()
  try {
    const result = runGate()
    if (result.status === 0) {
      log("✗", `${label}: o gate PASSOU com a regressão injetada — não está protegendo nada.`)
      return false
    }
    log("✓", `${label}: gate falhou como esperado (exit ${result.status})`)
    console.log(
      describeFailure(result)
        .split("\n")
        .map((line) => `      ${line}`)
        .join("\n"),
    )
    return true
  } finally {
    restore()
  }
}

function main() {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"))
  if (!pkg.scripts?.[GATE_SCRIPT]) {
    log("✗", `package.json não define o script "${GATE_SCRIPT}".`)
    return 1
  }

  console.log("═══ Self-test do gate de PII ═══")
  buildSandbox()
  log("•", `Sandbox: ${path.relative(ROOT, SANDBOX)}`)

  // ── 2. Controle ─────────────────────────────────────────────────────────
  const control = runGate()
  if (control.status !== 0) {
    log("✗", "CONTROLE: o gate falhou no sandbox LIMPO. A prova não é válida até isto passar.")
    console.log(describeFailure(control))
    return 1
  }
  log("✓", "CONTROLE: gate passa no sandbox limpo.")

  // ── 3. Injeção de runtime (allowlist pública com campo sensível) ────────
  const runtimeOk = expectGateToFail("INJEÇÃO A (email na allowlist pública)", () =>
    inject(
      "src/lib/api-server.ts",
      "export const PUBLIC_PROVIDER_SELECT = {\n  id: true,\n",
      "export const PUBLIC_PROVIDER_SELECT = {\n  id: true,\n  email: true,\n",
    ),
  )

  // ── 4. Injeção estática (relação de User sem select) ───────────────────
  const staticOk = expectGateToFail("INJEÇÃO B (provider: true numa projeção)", () =>
    inject(
      "src/lib/dispatch.ts",
      "      clientId: true,\n      provider: { select: { name: true } },\n",
      "      clientId: true,\n      provider: true,\n",
    ),
  )

  if (!runtimeOk || !staticOk) {
    log("✗", "O gate NÃO detectou toda regressão injetada.")
    return 1
  }

  log("✓", "Gate confirmado: detecta regressão de runtime e de projeção estática.")
  return 0
}

let code = 1
try {
  code = main()
} catch (error) {
  log("✗", `Self-test abortado: ${error.message}`)
} finally {
  rmSync(SANDBOX, { recursive: true, force: true })
}
process.exit(code)
