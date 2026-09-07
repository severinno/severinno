#!/usr/bin/env node
// =============================================================================
// rotate-secrets.mjs — Rotação de secrets expostos no histórico do git
// =============================================================================
//
// Gera NOVOS valores para os secrets que podem ser rotacionados localmente e
// lista os que exigem rotação manual no painel do provedor externo.
//
// Por que existe: os arquivos `.env` / `.env.production` estiveram rastreados
// pelo git com secrets reais (SESSION_SECRET, VAPID, DB_PASSWORD, S3, etc.).
// Mesmo após `git rm --cached`, os valores antigos permanecem no histórico —
// a única remediação real é ROTACIONAR cada secret e aplicar os novos valores
// nos provedores/instâncias.
//
// Usage:
//   node scripts/rotate-secrets.mjs                    # dry-run (não grava nada)
//   node scripts/rotate-secrets.mjs --apply            # grava <arquivo>.rotated
//   node scripts/rotate-secrets.mjs --file .env        # processa um arquivo só
//   node scripts/rotate-secrets.mjs --check            # CI guard: falha se .env
//                                                      # ainda estiver no git OU se
//                                                      # hooks de teste do seed
//                                                      # vazarem p/ workflows de prod
//   node scripts/rotate-secrets.mjs --help
//
// Segurança do output:
//   - dry-run exibe valores MASCARADOS (primeiros 8 chars + "…").
//   - --apply grava os valores completos em <arquivo>.rotated — o operador
//     revisa e faz o swap manualmente. O arquivo original nunca é alterado.
//   - Nunca imprime o valor antigo de nenhum secret.
//
// Exit code:
//   0 — ok (dry-run/apply concluído, ou --check com .env untracked e
//       nenhum hook de teste do seed em workflow de produção)
//   1 — erro (arquivo não encontrado, web-push indisponível p/ VAPID,
//       --check encontrou .env rastreado, ou hooks SEED_SPEC_PATCH /
//       PROD_SEED_ALLOW_DEV vazaram para workflows de produção)
// =============================================================================

import { randomBytes } from "node:crypto"
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { execSync } from "node:child_process"
import { scanWorkflows } from "./check-seed-hooks.mjs"

// ── web-push (dependência de produção) — gera o par VAPID P-256 ───────────
let webpush = null
try {
  webpush = (await import("web-push")).default
} catch {
  webpush = null // VAPID será marcado como manual no fallback
}

// =============================================================================
// Config — categorias de secrets
// =============================================================================

// Secrets geráveis localmente (valor 100% novo, formato base64url).
const AUTO = {
  SESSION_SECRET: {
    bytes: 32,
    note: "HMAC das sessões. Rotacionar invalida TODAS as sessões ativas (comportamento esperado).",
  },
  CRON_SECRET: { bytes: 32, note: "Autenticação de jobs cron (Authorization header)." },
  PAYMENT_WEBHOOK_SECRET: { bytes: 32, note: "Validação de webhooks de pagamento." },
  GLITCHTIP_SECRET: { bytes: 32, note: "Sentry/Glitchtip auth (DSN interno)." },
  DB_PASSWORD: { bytes: 24, note: "Senha do Postgres (dev).", links: ["DATABASE_URL"] },
  POSTGRES_PASSWORD: {
    bytes: 24,
    note: "Senha do Postgres (prod).",
    links: ["DATABASE_URL", "DIRECT_URL"],
  },
  RABBITMQ_PASS: { bytes: 24, note: "Senha do RabbitMQ.", links: ["RABBITMQ_URL"] },
  OPENSEARCH_PASSWORD: {
    bytes: 24,
    note: "Senha do OpenSearch.",
    links: ["OPENSEARCH_URL"],
  },
}

// Par VAPID — gerado em conjunto (publicKey/privateKey precisam combinar).
const VAPID_KEYS = ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "NEXT_PUBLIC_VAPID_PUBLIC_KEY"]

// Secrets que NÃO podem ser gerados localmente — o operador deve criar o novo
// valor no painel do provedor e colá-lo aqui. Formato: chave → instrução.
const MANUAL = {
  SENTRY_AUTH_TOKEN:
    "Painel Sentry → Settings → Auth Tokens → criar novo token, revogar o antigo. Atualizar SENTRY_AUTH_TOKEN + SENTRY_ORG/PROJECT se mudar.",
  EVOLUTION_API_KEY:
    "Dashboard Evolution API → API Key da instância → regenerar. Atualizar EVOLUTION_API_KEY e conferir EVOLUTION_INSTANCE/EVOLUTION_API_URL.",
  LYTEX_CLIENT_SECRET:
    "Painel Lytex → credenciais da conta (Client ID/Secret) → gerar novo Client Secret. Lembrar de atualizar o webhook HMAC no painel Lytex.",
  GROQ_API_KEY: "console.groq.com → API Keys → criar nova key, revogar a antiga.",
  WHATSAPP_API_KEY:
    "Provedor WhatsApp/Evolution → nova API key da conexão. Atualizar WHATSAPP_API_KEY/WHATSAPP_API_URL.",
  SMTP_PASS:
    "Provedor de e-mail (ex.: app password do Gmail / API key do Mailgun) → gerar nova senha de aplicativo.",
  S3_ACCESS_KEY:
    "Console S3/MinIO → criar NOVO par de chaves (access key + secret key). Atualizar S3_ACCESS_KEY e S3_SECRET_KEY juntos, depois revogar o antigo.",
  S3_SECRET_KEY:
    "Gerado pelo provedor junto com S3_ACCESS_KEY (o provedor gera o secret key — não é escolhido manualmente).",
  REDIS_URL:
    "URL do Redis com senha embutida (redis://:senha@host). A senha é definida NO SERVIDOR via ACL — gere um novo ACL password no Redis e atualize a URL aqui.",
}

// Chaves de URL cujo componente de senha deve ser reescrito quando o password
// vinculado muda (campo `links` do AUTO acima).
// Formato do link: <userKey> -> <urlKey> (mesma origem de credencial).

// =============================================================================
// Helpers
// =============================================================================

const HELP = `rotate-secrets.mjs — Rotação de secrets expostos no git

USO:
  node scripts/rotate-secrets.mjs                     dry-run (mostra o que mudaria)
  node scripts/rotate-secrets.mjs --apply             grava <arquivo>.rotated com os novos valores
  node scripts/rotate-secrets.mjs --file .env         processa apenas um arquivo (repetível)
  node scripts/rotate-secrets.mjs --check             CI guard: sai 1 se .env estiver rastreado no git
  node scripts/rotate-secrets.mjs --help

ARQUIVOS-PADRÃO: .env e .env.production (se existirem).

CATEGORIAS:
  AUTO   — valor gerado localmente (base64url). Rotação imediata, sem provedor.
  VAPID  — par público/privado gerado com web-push (precisam combinar).
  MANUAL — valor criado no painel do provedor externo (Sentry, Evolution,
           Lytex, GROQ, WhatsApp, SMTP, S3/MinIO). O script apenas lista e
           espera o operador colar o novo valor em <arquivo>.rotated.

SAÍDA:
  dry-run  → valores MASCARADOS (nunca vazam o secret completo).
  --apply  → grava <arquivo>.rotated com valores completos; o original é
             preservado. Revise e faça o swap manualmente.
`

function randomBase64url(bytes) {
  return randomBytes(bytes).toString("base64url")
}

/** Substitui a senha embutida em uma URL do tipo scheme://user:pass@host. */
function replaceUrlPassword(url, newPassword) {
  // Captura: scheme://user:  SENHA  @host
  // O grupo 3 já inclui o '@' separador; o guard usa `@[^@]*$` de forma que
  // um '@' EXTRA (senha antiga com '@' embutido) faz o match falhar → null,
  // e a URL não é reescrita (evita URL corrompida).
  const m = url.match(/^([a-zA-Z][\w+.-]*:\/\/[^:/\s]+:)([^@\s]*)(@[^@]*)$/)
  if (!m) return null
  // base64url é URL-safe — não precisa de percent-encoding
  return `${m[1]}${newPassword}${m[3]}`
}

/** Lê um arquivo .env preservando comentários/ordem, devolvendo linhas. */
function readEnv(file) {
  if (!existsSync(file)) return null
  return readFileSync(file, "utf8").split(/\r?\n/)
}

function mask(v) {
  return v.length <= 8 ? "********" : `${v.slice(0, 8)}…(${v.length} chars)`
}

/** Verifica se o git ainda rastreia arquivos .env. */
function trackedEnvFiles() {
  try {
    // Sem grep — evita dependência de shell/Git Bash no Windows e suprime
    // o stderr do child process (mensagens tipo "cannot find the path" do cmd).
    const out = execSync("git ls-files", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
    return (
      out
        .split(/\r?\n/)
        .map((l) => l.trim())
        // .example são templates seguros e DEVEM continuar rastreados
        .filter((l) => /^\.env(\..*)?$/.test(l) && !l.endsWith(".example"))
    )
  } catch {
    return []
  }
}

// =============================================================================
// Rotação de um arquivo
// =============================================================================

/**
 * @param {string} file  caminho do arquivo .env
 * @param {boolean} apply  se true, grava <file>.rotated; senão dry-run
 * @returns {{ ok: boolean, auto: number, manual: number, vapid: boolean }}
 */
function rotateFile(file, apply) {
  const lines = readEnv(file)
  if (lines === null) {
    console.error(`  ⚠️  Arquivo não encontrado: ${file} (pulando)`)
    return { ok: false, auto: 0, manual: 0, vapid: false }
  }

  const original = new Map()
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (m) original.set(m[1], { value: m[2], index: i })
  }

  /** Novo conteúdo (mesmas linhas, valores trocados onde aplicável). */
  const next = [...lines]
  const setValue = (key, value) => {
    const ref = original.get(key)
    if (ref) next[ref.index] = `${key}=${value}`
  }

  const generated = new Map() // chave -> novo valor (ou "PAR_VAPID")
  const manualFound = []
  let vapidGenerated = false

  console.error(`\n📄 ${file}`)

  // ── 1. AUTO — secrets gerados localmente ──────────────────────────────
  for (const [key, cfg] of Object.entries(AUTO)) {
    if (!original.has(key)) continue
    const fresh = randomBase64url(cfg.bytes)
    generated.set(key, fresh)
    setValue(key, fresh)
    console.error(`   ✅ AUTO    ${key.padEnd(24)} ${apply ? fresh : mask(fresh)}`)

    // Reescrita das URLs que embutem essa senha (ex.: DATABASE_URL)
    for (const urlKey of cfg.links ?? []) {
      if (!original.has(urlKey)) continue
      const rewritten = replaceUrlPassword(original.get(urlKey).value, fresh)
      if (rewritten) {
        setValue(urlKey, rewritten)
        generated.set(urlKey, rewritten)
        console.error(`   🔗 LINK    ${urlKey.padEnd(24)} senha atualizada na URL`)
      } else {
        console.error(
          `   ⚠️  URL     ${urlKey.padEnd(24)} não reescrita (formato inesperado — senha antiga com '@'?) — rotacione manualmente`,
        )
        manualFound.push(urlKey)
      }
    }
  }

  // ── 2. VAPID — par gerado com web-push ────────────────────────────────
  const hasVapid = VAPID_KEYS.some((k) => original.has(k))
  if (hasVapid) {
    if (webpush) {
      const pair = webpush.generateVAPIDKeys()
      setValue("VAPID_PUBLIC_KEY", pair.publicKey)
      setValue("VAPID_PRIVATE_KEY", pair.privateKey)
      setValue("NEXT_PUBLIC_VAPID_PUBLIC_KEY", pair.publicKey)
      generated.set("VAPID_PUBLIC_KEY", pair.publicKey)
      generated.set("VAPID_PRIVATE_KEY", pair.privateKey)
      generated.set("NEXT_PUBLIC_VAPID_PUBLIC_KEY", pair.publicKey)
      vapidGenerated = true
      console.error(`   ✅ VAPID   par público/privado gerado (web-push)`)
      if (!apply) {
        console.error(
          `            public  ${mask(pair.publicKey)}\n            private ${mask(pair.privateKey)}`,
        )
      }
    } else {
      console.error(
        `   ⚠️  VAPID   web-push indisponível — rotacione manualmente (gerar par em web-push/libs ou painel push)`,
      )
      manualFound.push("VAPID_*")
    }
  }

  // ── 3. MANUAL — precisa do painel do provedor ─────────────────────────
  for (const [key, instruction] of Object.entries(MANUAL)) {
    if (!original.has(key)) continue
    manualFound.push(key)
    // split(". ") — ponto+espaço separa frases; split(".") quebraria em
    // abreviações tipo "ex.:" (caso SMTP_PASS) e truncaria a instrução.
    const short = instruction.split(". ")[0].replace(/\.$/, "")
    console.error(`   ⏳ MANUAL  ${key.padEnd(24)} → ${short}.`)
  }

  // ── Gravação (apenas com --apply) ─────────────────────────────────────
  if (apply) {
    const outFile = `${file}.rotated`
    // OBJETO de opções — Node ignora um 4º argumento de writeFileSync.
    // mode 0600: arquivo contém secrets completos (Linux/containers).
    writeFileSync(outFile, next.join("\n") + "\n", { encoding: "utf8", mode: 0o600 })
    console.error(`   💾 GRAVADO ${outFile} (modo 0600 — revise e faça o swap manualmente)`)
  }

  return { ok: true, auto: generated.size, manual: manualFound.length, vapid: vapidGenerated }
}

// =============================================================================
// Main
// =============================================================================

const args = process.argv.slice(2)
if (args.includes("--help") || args.includes("-h")) {
  console.log(HELP)
  process.exit(0)
}

// ── --check: CI guard (secrets + hooks de teste do seed) ──────────────────
if (args.includes("--check")) {
  let failed = false

  // 1. .env ainda rastreado no git
  const tracked = trackedEnvFiles()
  if (tracked.length > 0) {
    console.error(
      `❌ Arquivos .env AINDA rastreados pelo git:\n   ${tracked.join("\n   ")}\n\n` +
        `   Execute: git rm --cached ${tracked.join(" ")}\n` +
        `   Depois rotacione os secrets: node scripts/rotate-secrets.mjs --apply`,
    )
    failed = true
  } else {
    console.error("✅ Nenhum arquivo .env rastreado pelo git.")
  }

  // 2. Hooks de TESTE do seed em workflows de PRODUÇÃO — SEED_SPEC_PATCH e
  //    PROD_SEED_ALLOW_DEV são TEST-ONLY (E2Es de seed em banco efêmero). Se
  //    vazarem para um deploy, o seed de produção pode rodar com spec patchado
  //    ou com o guard de produção contornado. Reutiliza o scanWorkflows do
  //    check-seed-hooks.mjs (fail-closed, allowlist de workflows de teste).
  const workflowDir = join(process.cwd(), ".github", "workflows")
  let workflows = []
  try {
    workflows = readdirSync(workflowDir)
      .filter((f) => f.endsWith(".yml"))
      .sort()
      .map((name) => ({ name, content: readFileSync(join(workflowDir, name), "utf8") }))
  } catch {
    // diretório inexistente (ex.: repo minimalista) — nada a verificar
  }
  const seedHookViolations = scanWorkflows(workflows)
  if (seedHookViolations.length > 0) {
    console.error(`❌ Hook(s) de teste do seed em workflow(s) de produção:`)
    for (const v of seedHookViolations) {
      console.error(`   - ${v.file}:${v.line}  ${v.hook}  →  ${v.text}`)
    }
    console.error(
      `\n   SEED_SPEC_PATCH / PROD_SEED_ALLOW_DEV são TEST-ONLY (E2Es de seed).\n` +
        `   Eles NUNCA devem aparecer em workflows de produção (deploy/release).\n` +
        `   Ação: remova a referência OU use o guard dedicado: node scripts/check-seed-hooks.mjs`,
    )
    failed = true
  } else {
    console.error("✅ Nenhum hook de teste do seed em workflows de produção.")
  }

  process.exit(failed ? 1 : 0)
}

const apply = args.includes("--apply")
const fileArgs = []
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--file" && args[i + 1]) {
    fileArgs.push(args[i + 1])
    i++
  }
}
const targets = fileArgs.length > 0 ? fileArgs : [".env", ".env.production"]

console.error(
  `🔐 Rotação de secrets — modo: ${apply ? "APPLY (grava .rotated)" : "DRY-RUN (nada gravado)"}\n`,
)

let ok = true
let totalAuto = 0
let totalManual = 0
let anyVapid = false
for (const file of targets) {
  const r = rotateFile(file, apply)
  if (r.ok) {
    totalAuto += r.auto
    totalManual += r.manual
    anyVapid = anyVapid || r.vapid
  } else {
    ok = false
  }
}

console.error(`\n═══ Resumo ═══`)
console.error(`  Auto-rotacionados: ${totalAuto} chave(s)`)
console.error(`  Par VAPID:         ${anyVapid ? "gerado" : "—"}`)
console.error(`  Rotação manual:    ${totalManual} chave(s) → painel do provedor`)

if (totalManual > 0) {
  console.error(
    `\n⏳ Ações manuais pendentes (valores novos devem ser criados no provedor):\n` +
      `   Revise as instruções acima e coloque os novos valores no arquivo .rotated.`,
  )
}

// Alerta se o git ainda rastreia .env
const tracked = trackedEnvFiles()
if (tracked.length > 0) {
  console.error(
    `\n⚠️  ATENÇÃO: o git ainda rastreia: ${tracked.join(", ")}\n` +
      `   Rotacionar os valores é OBRIGATÓRIO (o histórico vazou os antigos).\n` +
      `   Remova do índice: git rm --cached ${tracked.join(" ")}`,
  )
}

if (!apply) {
  console.error(`\nℹ️  Para gerar os valores completos: node scripts/rotate-secrets.mjs --apply`)
}

process.exit(ok ? 0 : 1)
