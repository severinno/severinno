#!/usr/bin/env node
// =============================================================================
// check-realtime-env-parity.mjs
//
// Usage:
//   node scripts/check-realtime-env-parity.mjs              # repo atual (working tree)
//   node scripts/check-realtime-env-parity.mjs --root X     # fixture (testes)
//   node scripts/check-realtime-env-parity.mjs --json       # saida estruturada
//   node scripts/check-realtime-env-parity.mjs --service X  # outro serviço (default: realtime)
//
// Exit codes:
//   0 — os canais declaram o MESMO environment efetivo para o serviço
//   1 — DIVERGE (canal com variável que o outro não tem, ou valor diferente)
//   2 — infra: compose ilegível, YAML inválido ou serviço ausente (fail-closed)
//
// O QUE ELE COMPARA
//
// O environment EFETIVO do serviço — base + override mesclados com a SEMÂNTICA
// DO DOCKER COMPOSE: `docker-compose.prod.yml` e `docker-compose.hostinger.yml`
// fazem `include:` de `docker-compose.base.yml`, onde o serviço `realtime`
// declara o seu `environment`. Cada canal pode ADICIONAR ou SOBRESCREVER
// variáveis no próprio arquivo; o guard mescla base→override e compara o
// resultado entre os dois canais.
//
// Formatos tratados em environment (ambos viram mapa nome→string):
//   - mapa:      KEY: valor | KEY: ${VAR} | KEY: ${VAR:-default}
//   - lista:     - KEY=valor | - KEY | - KEY=valor com `=` no valor
// Valores são normalizados: `${VAR}` e `${VAR:-default}` viram o NOME da
// variável — o que o guard compara é o CONTRATO (quais variáveis, de que
// fonte), não o valor interpolado de um .env que não está no repo. Consequência
// deliberada: defaults DIFERENTES para a mesma variável (ex.: os domínios
// `.com.br` vs `.com` documentados nos headers dos canais) NÃO são
// sinalizados — é drift de VALOR documentado, não de contrato; o que fica
// é variável presente num canal e ausente no outro, ou fontes diferentes.
//
// POR QUE EXISTE
//
// O comentário ⛳ da base documenta o incidente: a REALTIME_EMIT_API_KEY
// faltava no `app` do docker-compose.hostinger.yml — "metade do contrato em
// cada arquivo". O realtime é fail-closed (o serviço recusa o boot sem a
// chave em produção), então a divergência não era silenciosa ali — mas
// qualquer OUTRA variável do serviço pode divergir do mesmo jeito e só
// explodir no canal que ninguém olhou. Este guard mede a paridade no MERGE.
//
// ESCOPO DELIBERADO
//
// Compara UM serviço (default: realtime, `--service` para outro). A divergência
// LEGÍTIMA de defaults de domínio (`.com` vs `.com.br` no app/email-worker/
// notification-worker) é documentada nos headers dos canais — esses serviços
// NÃO são comparados aqui. Paridade de env de HOST vs template é do
// check-env-mirror; imagem/registry é do check-registry-source.
// =============================================================================

import { readFileSync } from "node:fs"
import { join } from "node:path"
import process from "node:process"
import { pathToFileURL } from "node:url"
import { load as yamlLoad } from "js-yaml"

/** Exit codes — o contrato da CLI. */
export const EXIT = { OK: 0, DIVERGED: 1, UNAVAILABLE: 2, USAGE: 3 }

/** Serviço cujo environment precisa ser idêntico entre os canais. */
export const PARITY_SERVICE = "realtime"

/** Os DOIS canais de produção que devem declarar a mesma coisa. */
export const CHANNELS = ["docker-compose.prod.yml", "docker-compose.hostinger.yml"]

/**
 * Itens da LISTA já vêm parseados pelo js-yaml (sem o traço):
 * `KEY` (sem `=`) = valor vem do ambiente do host → a fonte é a própria KEY;
 * `KEY=valor` (o `=` pode aparecer no valor) → valor normalizado.
 */
const LIST_ITEM_NO_VALUE = /^([A-Za-z_][A-Za-z0-9_]*)\s*$/
const LIST_ITEM_WITH_VALUE = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/

/**
 * Normaliza um valor de environment para a FONTE do contrato:
 * `${VAR}` → "VAR"; `${VAR:-default}` → "VAR"; `${VAR:?msg}` → "VAR".
 * Literais passam intactos. Não-strings (números, booleans do YAML) → String().
 *
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeSource(value) {
  const s = typeof value === "string" ? value : String(value ?? "")
  const m = s.match(/^\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-|\?\?)?[^}]*\}$/)
  return m ? m[1] : s
}

/**
 * Lê o environment de UM serviço de UM arquivo compose (sem mesclar).
 * Retorna null quando o serviço não declara o arquivo (quem decide
 * serviço-ausente é o chamador, depois do merge — a base pode declarar por
 * um canal e o override não mencionar o serviço de novo).
 *
 * @param {string} filePath caminho absoluto do compose
 * @param {string} service
 * @returns {{found: boolean, env: Record<string, string>}}
 */
export function readServiceEnv(filePath, service) {
  let doc
  try {
    doc = yamlLoad(readFileSync(filePath, "utf8"))
  } catch (err) {
    throw new Error(`YAML inválido em ${filePath}: ${err.message}`)
  }
  if (!doc || typeof doc !== "object") {
    throw new Error(`compose sem documento YAML: ${filePath}`)
  }
  const services = doc.services
  // Arquivo SEM services (canal include-only) é compose VÁLIDO — todos os
  // serviços vêm da base. Quem decide serviço-ausente é o merge no chamador.
  if (!services || typeof services !== "object") return { found: false, env: {} }
  const svc = services[service]
  if (!svc || typeof svc !== "object") return { found: false, env: {} }

  const raw = svc.environment
  if (!raw) return { found: true, env: {} }

  const env = {}
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const line = String(item)
      const noValue = line.match(LIST_ITEM_NO_VALUE)
      if (noValue) {
        env[noValue[1]] = noValue[1] // `KEY` puro = vem do host → a fonte é a própria KEY
        continue
      }
      const withValue = line.match(LIST_ITEM_WITH_VALUE)
      if (withValue) {
        env[withValue[1]] = normalizeSource(withValue[2])
        continue
      }
      throw new Error(`item de environment irreconhecível em ${filePath}: ${line}`)
    }
    return { found: true, env }
  }
  if (typeof raw === "object") {
    for (const [key, value] of Object.entries(raw)) {
      env[key] = normalizeSource(value)
    }
    return { found: true, env }
  }
  throw new Error(`environment com formato desconhecido em ${filePath}: ${typeof raw}`)
}

/**
 * Mescla base→override com a semântica do Compose e devolve o environment
 * EFETIVO do serviço no canal (`channelPath` inclui `channelBase`).
 * Serviço ausente nos DOIS arquivos do canal é infra (erro).
 *
 * @param {string} channelPath compose do canal (prod/hostinger)
 * @param {string} channelBase  base incluída (docker-compose.base.yml)
 * @param {string} service
 * @returns {Record<string, string>}
 */
export function effectiveServiceEnv(channelPath, channelBase, service) {
  const base = readServiceEnv(channelBase, service)
  const override = readServiceEnv(channelPath, service)
  if (!base.found && !override.found) {
    throw new Error(`serviço "${service}" não existe nem em ${channelPath} nem em ${channelBase}`)
  }
  return { ...base.env, ...override.env }
}

/**
 * Compara os environments efetivos: retorna a lista de divergências.
 *
 * @param {Record<string, string>} a
 * @param {Record<string, string>} b
 * @returns {{key: string, a?: string, b?: string}[]}
 */
export function diffServiceEnv(a, b) {
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()
  const out = []
  for (const key of keys) {
    const inA = key in a
    const inB = key in b
    if (inA && inB) {
      if (a[key] !== b[key]) out.push({ key, a: a[key], b: b[key] })
    } else {
      out.push({ key, a: inA ? a[key] : undefined, b: inB ? b[key] : undefined })
    }
  }
  return out
}

// ── CLI ─────────────────────────────────────────────────────────────────────

function usage() {
  return [
    "Usage: node scripts/check-realtime-env-parity.mjs [opções]",
    "",
    "Opções:",
    "  --root <dir>     raiz do checkout (default: cwd)",
    "  --service <name> serviço a comparar (default: realtime)",
    "  --json           saída estruturada",
    "  -h, --help       esta ajuda",
    "",
    "Exit codes: 0 paridade | 1 divergência | 2 infra | 3 uso inválido",
  ].join("\n")
}

function run(args) {
  let root = process.cwd()
  let service = PARITY_SERVICE
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
    if (arg === "--service") {
      service = args[++i]
      if (!service) return usageExit()
      continue
    }
    return usageExit()
  }

  try {
    const [prodPath, hostPath] = CHANNELS.map((f) => join(root, f))
    const baseName = "docker-compose.base.yml"
    const prod = effectiveServiceEnv(prodPath, join(root, baseName), service)
    const host = effectiveServiceEnv(hostPath, join(root, baseName), service)
    const diffs = diffServiceEnv(prod, host)

    if (diffs.length === 0) {
      if (json) {
        console.log(JSON.stringify({ service, channels: CHANNELS, ok: true, diffs: [] }))
      } else {
        console.log(
          `✅ real-env-parity: "${service}" tem o MESMO environment efetivo em ${CHANNELS.join(" ≡ ")} (${Object.keys(prod).length} variáveis)`,
        )
      }
      return EXIT.OK
    }

    if (json) {
      console.log(JSON.stringify({ service, channels: CHANNELS, ok: false, diffs }))
    } else {
      console.error(
        `❌ real-env-parity: "${service}" DIVERGE entre os canais de produção (${CHANNELS[0]} vs ${CHANNELS[1]}):`,
      )
      for (const d of diffs) {
        if (d.a === undefined) {
          console.error(`   · ${d.key}: SÓ em ${CHANNELS[1]} (falta em ${CHANNELS[0]})`)
        } else if (d.b === undefined) {
          console.error(`   · ${d.key}: SÓ em ${CHANNELS[0]} (falta em ${CHANNELS[1]})`)
        } else {
          console.error(`   · ${d.key}: ${CHANNELS[0]}=${d.a} ≠ ${CHANNELS[1]}=${d.b}`)
        }
      }
      console.error(
        `   Remédio: alinhe o environment do serviço nos DOIS canais (a base comum é ${baseName}).`,
      )
    }
    return EXIT.DIVERGED
  } catch (err) {
    // Infra: compose ausente, YAML quebrado, serviço sumido — fail-closed.
    if (json) {
      console.log(JSON.stringify({ service, channels: CHANNELS, ok: false, error: err.message }))
    } else {
      console.error(`❌ real-env-parity (infra): ${err.message}`)
    }
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
