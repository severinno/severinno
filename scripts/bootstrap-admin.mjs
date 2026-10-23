#!/usr/bin/env node
/**
 * bootstrap-admin.mjs — cria/promove o PRIMEIRO administrador real em produção.
 *
 * Substitui as credenciais demo estáticas (admin@severinno.com/admin123) por um
 * bootstrap via Docker secrets: o operador define o próprio e-mail em
 * secrets/admin_email.secret e a senha nasce aleatória em
 * secrets/admin_password.secret (gerada pelo setup-vps.sh). Idempotente —
 * seguro rodar a cada deploy (deploy.sh chama após o migrate).
 *
 * Uso manual (a partir da raiz do projeto na VPS):
 *   docker compose -f docker-compose.prod.yml run --rm --no-deps \
 *     -v "$PWD/scripts/bootstrap-admin.mjs:/app/scripts/bootstrap-admin.mjs:ro" \
 *     -v "$PWD/secrets/admin_email.secret:/run/secrets/admin_email:ro" \
 *     -v "$PWD/secrets/admin_password.secret:/run/secrets/admin_password:ro" \
 *     -e ADMIN_EMAIL_FILE=/run/secrets/admin_email \
 *     -e ADMIN_PASSWORD_FILE=/run/secrets/admin_password \
 *     app node /app/scripts/bootstrap-admin.mjs                    # bootstrap
 *     app node /app/scripts/bootstrap-admin.mjs --rotate           # rotação
 *
 * Fontes de credencial (precedência): ADMIN_EMAIL / ADMIN_PASSWORD (env
 * direta) → ADMIN_EMAIL_FILE / ADMIN_PASSWORD_FILE (Docker secrets).
 *
 * Hash: mesmos parâmetros de src/lib/crypto.ts (scrypt N=16384, r=8, p=1,
 * salt 16B, chave 64B — formato "saltHex:hashHex"). Script puro Node para
 * rodar na imagem standalone (node:22-alpine, sem bun nem devDeps).
 *
 * ROTATE (`--rotate`): atualiza o hash do admin EXISTENTE com a senha do
 * secret — o caminho de rotação de credencial comprometida. Fail-closed em
 * TUDO: o admin precisa EXISTIR e ser ADMIN (rotar sobre usuário inexistente
 * ou não-admin esconderia um secret trocado por uma saída verde), o e-mail
 * demo continua recusado, a senha continua validada, e o log NUNCA exibe a
 * senha nem o hash (novo nem velho). Sem `--rotate` o script é o bootstrap de
 * sempre — a flag só muda o efeito sobre o admin EXISTENTE: em vez de "já é
 * ADMIN — nada a fazer", o hash é REESCRITO (a senha do secret passa a valer).
 *
 * Usage:
 *   node scripts/bootstrap-admin.mjs            (na VPS: via docker compose run —
 *   node scripts/bootstrap-admin.mjs --rotate    ver "Uso manual" acima, com os
 *                                                secrets montados)
 *
 * Exit codes:
 *   0 — bootstrap ok (criado/promovido/idempotente) ou hash rotacionado
 *   1 — credencial ausente/inválida, e-mail demo, admin não existe (rotate),
 *       admin não é ADMIN (rotate) ou falha no bootstrap
 */

import { randomBytes, scryptSync } from "node:crypto"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"

/**
 * E-mails do gate demo (src/lib/demo-accounts.ts) — NUNCA podem nascer como
 * ADMIN via bootstrap. Reproduzidos aqui em fail-closed: o bootstrap roda fora
 * do bundle Next e não pode importar o módulo TS.
 */
const DEMO_EMAILS_REFUSED = new Set([
  "admin@severinno.com",
  "cliente@severinno.com",
  "joao@severinno.com",
])

const MIN_PASSWORD_LEN = 12

const ROTATE_FLAG = "--rotate"

function fail(message) {
  console.error(`❌ bootstrap-admin: ${message}`)
  process.exit(1)
}

function readSource(name, fileEnv) {
  const direct = process.env[name]
  if (direct && direct.trim()) return direct.trim()
  const file = process.env[fileEnv]
  if (file) {
    try {
      const value = readFileSync(file, "utf8").trim()
      if (value) return value
    } catch (err) {
      fail(`${name}: não consegui ler o arquivo ${file} — ${err.message}`)
    }
  }
  fail(`${name} (ou ${fileEnv}) é obrigatório`)
}

// Mesmos parâmetros de src/lib/crypto.ts → hashPassword().
function hashPassword(password) {
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 })
  return `${salt.toString("hex")}:${hash.toString("hex")}`
}

function validatePassword(password) {
  if (password.length < MIN_PASSWORD_LEN) {
    fail(`senha deve ter ao menos ${MIN_PASSWORD_LEN} caracteres`)
  }
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
    fail("senha deve conter maiúscula, minúscula e dígito (mín. 12 caracteres)")
  }
}

// A FLAG: um argumento que não é `--rotate` é uso inválido (fail-closed: o
// deploy chama este script sem argumentos — um argumento a mais é um erro de
// operação, nunca um modo silenciosamente ignorado).
const args = process.argv.slice(2)
const extra = args.filter((a) => a !== ROTATE_FLAG)
if (extra.length > 0)
  fail(`argumento desconhecido: ${extra.join(" ")} (uso: node bootstrap-admin.mjs [--rotate])`)
const ROTATE = args.includes(ROTATE_FLAG)

const email = readSource("ADMIN_EMAIL", "ADMIN_EMAIL_FILE").toLowerCase()
const password = readSource("ADMIN_PASSWORD", "ADMIN_PASSWORD_FILE")

if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(`e-mail inválido: ${email}`)
if (DEMO_EMAILS_REFUSED.has(email)) {
  fail("e-mail pertence ao gate demo — use o e-mail real do administrador (ex.: dominio .com.br)")
}
validatePassword(password)

const name = (process.env.ADMIN_NAME || "").trim() || email.split("@")[0]

const require = createRequire(import.meta.url)
const { PrismaClient } = require("@prisma/client")

const prisma = new PrismaClient()

async function main() {
  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    if (ROTATE) {
      if (existing.role !== "ADMIN") {
        fail(
          `--rotate: ${email} existe como ${existing.role}, não como ADMIN — rotação recusada (bootstrap que o PROMOVE, rotação não cria dono)`,
        )
      }
      await prisma.user.update({ where: { email }, data: { passwordHash: hashPassword(password) } })
      console.log(
        `✅ ${email} — hash do ADMIN ROTACIONADO com a senha do secret (a senha em si nunca sai no log; a antiga deixa de valer).`,
      )
      return
    }
    if (existing.role === "ADMIN") {
      console.log(`✅ ${email} já é ADMIN — nada a fazer (idempotente).`)
      return
    }
    await prisma.user.update({ where: { email }, data: { role: "ADMIN" } })
    console.log(
      `⚠️  ${email} existia como ${existing.role} — promovido a ADMIN (senha preservada).`,
    )
    return
  }
  if (ROTATE) {
    fail(
      `--rotate: ${email} NÃO existe — rotação não cria usuário (use o bootstrap sem a flag, que cria o admin pelo secret)`,
    )
  }
  await prisma.user.create({
    data: { email, name, passwordHash: hashPassword(password), role: "ADMIN" },
  })
  console.log(
    `✅ Admin criado: ${email} — senha em secrets/admin_password.secret (nunca exibida em log).`,
  )
}

main()
  .catch((err) => fail(err?.message ?? String(err)))
  .finally(() => prisma.$disconnect())
