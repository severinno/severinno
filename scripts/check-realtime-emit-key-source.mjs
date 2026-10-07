#!/usr/bin/env node
// =============================================================================
// check-realtime-emit-key-source.mjs
//
// Usage:
//   node scripts/check-realtime-emit-key-source.mjs              # repo atual
//   node scripts/check-realtime-emit-key-source.mjs --root X     # fixture (testes)
//   node scripts/check-realtime-emit-key-source.mjs --json
//
// Exit codes:
//   0 — todo consumer de REALTIME_EMIT_API_KEY lê de fonte sancionada
//   1 — VIOLAÇÃO (valor da chave em environment de compose, consumer sem o
//       secret, declaração ausente, *.secret commitado ou .example sem
//       placeholder)
//   2 — infra: compose ilegível ou contrato sumido (fail-closed)
//   3 — uso inválido (flag desconhecida, --root sem valor)
//
// O QUE ELE GARANTE
//
// A REALTIME_EMIT_API_KEY é fail-closed: produção nem sobe sem ela. O valor
// NUNCA pode transitar por `environment` de compose (apareceria em `docker
// inspect`, `docker compose config` e em shells que exportam o .env) — entra
// como DOCKER SECRET (realtime_emit_api_key → /run/secrets/realtime_emit_api_key)
// e cada consumer lê via *_FILE (o app/notification-worker recebem via
// docker-entrypoint.sh, que exporta /run/secrets/* como env). O valor real
// também nunca é commitado: só *.secret.example com placeholder.
//
// REGRAS (a razão vai no remédio impresso):
//   R1 — nenhum `REALTIME_EMIT_API_KEY:` com VALOR em environment de compose
//        comitado (nem via ${VAR}: interpolar do .env do host é a fuga que
//        esta tarefa fecha);
//   R2 — todo consumer (serviço cujo environment menciona a chave) declara o
//        secret `realtime_emit_api_key` em `secrets:` — e consumer nenhum
//        recebe o secret sem mencionar a chave (órfão = _FILE sem leitor, ou
//        leitor sem _FILE);
//   R3 — todo compose que menciona a chave DECLARA o secret no top-level
//        `secrets:` (os canais fazem include da base; exigir a declaração no
//        arquivo que usa mantém o contrato legível arquivo a arquivo);
//   R4 — secrets/realtime_emit_api_key.secret.example existe com PLACEHOLDER
//        e nenhum *.secret está TRACKED no git;
//   R5 — o caminho de ${EMIT_KEY_FILE_ENV} é o canônico
//        /run/secrets/realtime_emit_api_key (um caminho diferente esconderia
//        um segundo monte de secret).
//
// POR QUE EXISTE
//
// A chave é o que impede qualquer processo HTTP interno de forjar eventos em
// salas user:{id} (chat, booking, tracking). Deixar o valor em `environment`
// recria a classe do incidente ⛳ (contrato dividido entre arquivos) de um
// jeito PIOR: o segredo visível em `docker inspect`. O guard transforma o
// desenho (secret + _FILE) em invariante do merge.
//
// ESCOPO DELIBERADO
//
// Varre os DOIS canais de produção + a base comum (SCAN_FILES). Staging/dev
// são composes monolíticos de desenvolvimento e leem a chave por env direta
// do .env — deliberado, não são varridos. Paridade base↔override POR SERVIÇO
// é do check-realtime-env-parity; aqui o contrato é a FONTE da chave nos
// composes de produção.
// =============================================================================

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { join } from "node:path"
import process from "node:process"
import { pathToFileURL } from "node:url"
import { load as yamlLoad } from "js-yaml"

/** Exit codes — o contrato da CLI. */
export const EXIT = { OK: 0, VIOLATION: 1, UNAVAILABLE: 2, USAGE: 3 }

/** A variável da chave do /emit (fail-closed). */
export const EMIT_KEY_ENV = "REALTIME_EMIT_API_KEY"

/** Sufixo _FILE que aponta para o arquivo montado do secret. */
export const EMIT_KEY_FILE_ENV = "REALTIME_EMIT_API_KEY_FILE"

/** Nome do docker secret (== nome do arquivo em secrets/<nome>.secret). */
export const EMIT_KEY_SECRET = "realtime_emit_api_key"

/** Caminho canônico do arquivo montado dentro do container. */
export const EMIT_KEY_SECRET_PATH = `/run/secrets/${EMIT_KEY_SECRET}`

/**
 * Serviços que CONSUMEM a chave (emitem ou validam o bridge /emit) — o
 * contract set. Todo serviço cujo environment menciona a chave precisa estar
 * nesta lista (e a lista não pode citar serviço que não a menciona).
 */
export const EMIT_KEY_CONSUMERS = ["realtime", "app", "notification-worker"]

/**
 * Composes comitados onde a chave pode aparecer — os DOIS canais de produção
 * e a base comum (ambos incluem a base).
 */
export const SCAN_FILES = [
  "docker-compose.base.yml",
  "docker-compose.prod.yml",
  "docker-compose.hostinger.yml",
]

/** Diretório dos arquivos de secret (com *.example versionado). */
export const SECRETS_DIR = "secrets"

const PLACEHOLDER_RE = /changeme|your_secret_here|replace_me|<[^>]*>/i

/**
 * Lê environment (mapa OU lista) e secrets (lista de nomes ou mapa) de um
 * serviço num documento YAML já parseado. Lista sem `=` = fonte do host
 * (mesma semântica do check-realtime-env-parity).
 *
 * @param {unknown} doc
 * @param {string} service
 * @returns {{found: boolean, env: Record<string, string>, secrets: string[]}}
 */
export function readServiceSpec(doc, service) {
  const svc = doc?.services?.[service]
  if (!svc || typeof svc !== "object") return { found: false, env: {}, secrets: [] }
  const env = {}
  const raw = svc.environment
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const line = String(item)
      const eq = line.indexOf("=")
      if (eq === -1) env[line.trim()] = line.trim()
      else env[line.slice(0, eq).trim()] = line.slice(eq + 1)
    }
  } else if (raw && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw)) env[k] = typeof v === "string" ? v : String(v ?? "")
  } else if (raw != null) {
    throw new Error(`environment com formato desconhecido para "${service}"`)
  }
  const secs = svc.secrets
  const secrets = Array.isArray(secs)
    ? secs.map((s) => (typeof s === "string" ? s : String(s?.target ?? s?.source ?? "")))
    : secs && typeof secs === "object"
      ? Object.keys(secs)
      : []
  return { found: true, env, secrets }
}

function loadDoc(root, file) {
  try {
    return { doc: yamlLoad(readFileSync(join(root, file), "utf8")), error: null }
  } catch (err) {
    return { doc: null, error: `${file}: ${err.message}` }
  }
}

/**
 * Varre os composes de SCAN_FILES e devolve todas as menções à chave, quais
 * arquivos declaram o secret e o primeiro erro de parse (se houver).
 *
 * @param {string} root raiz do checkout
 * @returns {{mentions: Array<{file: string, service: string, envKey: string, value: string}>, declared: string[], parseError: string|null}}
 */
export function scanKeyMentions(root) {
  const mentions = []
  const declared = []
  for (const file of SCAN_FILES) {
    const { doc, error } = loadDoc(root, file)
    if (error) return { mentions, declared, parseError: error }
    if (!doc || typeof doc !== "object") continue
    if (doc.secrets && typeof doc.secrets === "object" && EMIT_KEY_SECRET in doc.secrets) {
      declared.push(file)
    }
    const services = doc.services
    if (!services || typeof services !== "object") continue
    for (const name of Object.keys(services)) {
      const spec = readServiceSpec(doc, name)
      for (const envKey of [EMIT_KEY_ENV, EMIT_KEY_FILE_ENV]) {
        if (envKey in spec.env) {
          mentions.push({ file, service: name, envKey, value: spec.env[envKey] })
        }
      }
    }
  }
  return { mentions, declared, parseError: null }
}

/**
 * Verifica o lado secrets/: .example presente com placeholder e nenhum
 * *.secret commitado.
 *
 * @param {string} root
 * @returns {{examplePresent: boolean, exampleHasPlaceholder: boolean, committedSecrets: string[]}}
 */
export function checkSecretsDir(root) {
  const dir = join(root, SECRETS_DIR)
  const examplePath = join(dir, `${EMIT_KEY_SECRET}.secret.example`)
  const examplePresent = existsSync(examplePath)
  let exampleHasPlaceholder = false
  if (examplePresent) {
    exampleHasPlaceholder = PLACEHOLDER_RE.test(readFileSync(examplePath, "utf8"))
  }
  const committedSecrets = []
  if (existsSync(dir)) {
    for (const entry of readdirSync(dir)) {
      if (entry.endsWith(".secret") && statSync(join(dir, entry)).isFile()) {
        committedSecrets.push(entry)
      }
    }
  }
  return { examplePresent, exampleHasPlaceholder, committedSecrets }
}

/**
 * *.secret PRESENTES NO GIT (trackeados). Arquivos .secret locais de dev são
 * normais (o .gitignore de secrets/ os ignora) — a violação é estar TRACKED.
 * Fora de um repositório git (fixtures de teste) devolve [] — não dá para
 * provar, e ausência de prova não é violação.
 *
 * @param {string} root
 * @returns {string[]}
 */
export function trackedSecretFiles(root) {
  const res = spawnSync("git", ["ls-files", "--", SECRETS_DIR], {
    cwd: root,
    encoding: "utf8",
  })
  if (res.status !== 0 || typeof res.stdout !== "string") return []
  return res.stdout
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.endsWith(".secret"))
}

/**
 * Coleta as violações do contrato da chave no checkout `root`.
 *
 * @param {string} root
 * @returns {string[]}
 */
export function collectViolations(root) {
  const violations = []

  const { mentions, declared, parseError } = scanKeyMentions(root)
  if (parseError) {
    violations.push(
      `${parseError} — compose ilegível (YAML inválido): a declaração da chave pode ter drift sem ninguém ver (fail-closed).`,
    )
    return violations
  }
  if (mentions.length === 0) {
    violations.push(
      `NENHUM compose de produção menciona ${EMIT_KEY_ENV}(_FILE) — o contrato do bridge /emit sumiu dos canais (o realtime fail-closed nem sobe).`,
    )
  }
  for (const m of mentions) {
    if (m.envKey === EMIT_KEY_ENV) {
      violations.push(
        `${m.file} (${m.service}): ${EMIT_KEY_ENV} com valor em environment — o segredo aparece em docker inspect/compose config/shell. ` +
          `Troque por ${EMIT_KEY_FILE_ENV}: ${EMIT_KEY_SECRET_PATH} + o secret em secrets: (veja docker-compose.base.yml).`,
      )
    }
    if (m.envKey === EMIT_KEY_FILE_ENV && m.value !== EMIT_KEY_SECRET_PATH) {
      violations.push(
        `${m.file} (${m.service}): ${EMIT_KEY_FILE_ENV} aponta para '${m.value}' — o caminho canônico do secret é ${EMIT_KEY_SECRET_PATH}.`,
      )
    }
  }

  // R2/R3 arquivo a arquivo — os três composes são varridos com a mesma régua
  // (a base é comum, mas nada impede um override de adicionar ou apagar menção
  // ou secret num serviço só de um canal).
  for (const file of SCAN_FILES) {
    const { doc, error } = loadDoc(root, file)
    if (error || !doc || typeof doc !== "object") continue // parse já reportado
    const services = doc.services && typeof doc.services === "object" ? doc.services : {}
    const fileMentions = mentions.some((m) => m.file === file)
    const fileDeclares = declared.includes(file)
    if (fileMentions && !fileDeclares) {
      violations.push(
        `${file}: menciona ${EMIT_KEY_ENV}(_FILE) mas não declara o secret ${EMIT_KEY_SECRET} no top-level secrets: — /run/secrets/${EMIT_KEY_SECRET} não existiria no container.`,
      )
    }
    for (const name of Object.keys(services)) {
      const spec = readServiceSpec(doc, name)
      const mentionsKey = EMIT_KEY_ENV in spec.env || EMIT_KEY_FILE_ENV in spec.env
      const receivesSecret = spec.secrets.includes(EMIT_KEY_SECRET)
      if (mentionsKey && !receivesSecret) {
        violations.push(
          `${file} (${name}): menciona a chave mas NÃO recebe o secret ${EMIT_KEY_SECRET} em secrets: — o _FILE apontaria para arquivo inexistente (o boot fail-closed do realtime derruba a stack).`,
        )
      }
      if (!mentionsKey && receivesSecret && EMIT_KEY_CONSUMERS.includes(name)) {
        violations.push(
          `${file} (${name}): recebe o secret ${EMIT_KEY_SECRET} mas o environment não menciona a chave — consumer órfão (ou faltou ${EMIT_KEY_FILE_ENV}).`,
        )
      }
    }
  }

  // R4 — lado secrets/ do repositório.
  const sec = checkSecretsDir(root)
  if (!sec.examplePresent) {
    violations.push(
      `secrets/${EMIT_KEY_SECRET}.secret.example ausente — o template versionado é o contrato de provisionamento (copie o formato de session_secret.secret.example).`,
    )
  } else if (!sec.exampleHasPlaceholder) {
    violations.push(
      `secrets/${EMIT_KEY_SECRET}.secret.example NÃO contém placeholder — .example versionado carrega formato, nunca valor (parece valor real commitado).`,
    )
  }
  if (sec.committedSecrets.length > 0) {
    // Só é violação se o valor está TRACKED no git (`.secret` local de dev é
    // o fluxo normal — o .gitignore de secrets/ o ignora).
    const tracked = trackedSecretFiles(root).filter((f) =>
      sec.committedSecrets.includes(f.split("/").pop() ?? ""),
    )
    if (tracked.length > 0) {
      violations.push(
        `arquivo(s) *.secret TRACKED no git: ${tracked.join(", ")} — valor real NUNCA vai para o git; remova do índice (git rm --cached) e confirme o .gitignore de secrets/.`,
      )
    }
  }

  return violations
}

// ── CLI ─────────────────────────────────────────────────────────────────────

function usage() {
  return [
    "Usage: node scripts/check-realtime-emit-key-source.mjs [opções]",
    "",
    "Opções:",
    "  --root <dir>  raiz do checkout (default: cwd)",
    "  --json        saída estruturada",
    "  -h, --help    esta ajuda",
    "",
    "Exit codes: 0 fonte sancionada | 1 violação | 2 infra | 3 uso inválido",
  ].join("\n")
}

function run(args) {
  let root = process.cwd()
  let json = false
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === "-h" || arg === "--help") {
      console.log(usage())
      return EXIT.OK
    }
    if (arg === "--json") {
      json = true
      continue
    }
    if (arg === "--root") {
      root = args[++i]
      if (!root) return usageExit()
      continue
    }
    return usageExit()
  }

  try {
    const violations = collectViolations(root)
    if (violations.length === 0) {
      if (json) {
        console.log(JSON.stringify({ ok: true, violations: [] }))
      } else {
        console.log(
          `✅ real-emit-key-source: ${EMIT_KEY_ENV} entra por DOCKER SECRET (${EMIT_KEY_SECRET}) + ${EMIT_KEY_FILE_ENV} nos canais de produção — nenhum valor em environment`,
        )
      }
      return EXIT.OK
    }
    if (json) {
      console.log(JSON.stringify({ ok: false, violations }))
    } else {
      console.error(
        `❌ real-emit-key-source: ${violations.length} violação(ões) no contrato da ${EMIT_KEY_ENV}:`,
      )
      for (const v of violations) console.error(`   · ${v}`)
      console.error(
        `   Remédio: secret ${EMIT_KEY_SECRET} em secrets/ + ${EMIT_KEY_FILE_ENV}=${EMIT_KEY_SECRET_PATH} nos consumers (realtime, app, notification-worker).`,
      )
    }
    return EXIT.VIOLATION
  } catch (err) {
    if (json) console.log(JSON.stringify({ ok: false, error: err.message }))
    else console.error(`❌ real-emit-key-source (infra): ${err.message}`)
    return EXIT.UNAVAILABLE
  }
}

function usageExit() {
  console.error(usage())
  return EXIT.USAGE
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exit(run(process.argv.slice(2)))
}
