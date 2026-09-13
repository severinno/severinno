#!/usr/bin/env node
// =============================================================================
// check-runner-base.mjs — a BASE da imagem do runner está pinada por digest?
//
// Usage:
//   node scripts/check-runner-base.mjs                      # check (probe de rede opcional)
//   node scripts/check-runner-base.mjs --no-registry-probe  # só o que é offline
//   node scripts/check-runner-base.mjs --require-registry   # a tag TEM de ser lida (senão 3)
//   node scripts/check-runner-base.mjs --write              # resolve a tag, atualiza o FROM e revalida
//   node scripts/check-runner-base.mjs --json
//   node scripts/check-runner-base.mjs -h
//
// Exit codes:
//   0 — pinado e conferido (ou a prova da tag não pôde ser feita e NÃO foi exigida — dito na saída)
//   1 — VIOLAÇÃO: FROM sem digest/malformado, digest ≠ o que a tag serve, contrato que não é
//       fail-closed, ou uma das provas/mutações falhando
//   2 — uso inválido
//   3 — INDETERMINADO (só com --require-registry: a tag não pôde ser lida)
//
// POR QUE EXISTE
//
// `Dockerfile.ubuntu-bun` responde por DUAS coisas ao mesmo tempo: o tier-1 do
// setup-bun (o Bun pré-instalado, o fast path de 0s) e o CONTRATO DA IMAGEM (o
// plugin `compose`, que a invariante 7 do `check:registry-source` usa para
// renderizar o compose da forja DENTRO do job). As duas são verificadas no
// BUILD, e o build é o lugar certo para falhar. O que faltava era a outra
// metade da pergunta: CONTRA O QUE o build verifica.
//
// `FROM catthehacker/ubuntu:act-latest` é uma tag FLUTUANTE. Quem garantia que
// o plugin está lá era a sorte de qual build a tag servia no dia do build. Um
// rebuild da base (ou um re-tag) troca a imagem inteira — inclusive o plugin —
// sem que UMA LINHA do repositório mude: o build passa a verificar outra
// imagem, e o único jeito de saber é o dia em que ele começar a falhar. É a
// mesma classe do re-tag da NOSSA imagem (que o `probeImageIdentity` do
// `ensure-runner-image` cobre): o apelido é mutável, o artefato não.
//
// O QUE ESTE GUARD FAZ (4 invariantes)
//
//   1. O `FROM` é `nome:tag@sha256:<64 hex>` — pinado por DIGEST, com a tag
//      mantida como documentação de ONDE o digest veio (é por ela que o
//      operador atualiza). Sem digest = violação: a base volta a ser o que a
//      tag servir amanhã.
//
//   2. O digest fixado é o que a TAG serve HOJE — a única resposta possível
//      vem do registry. Tri-estado: `proven` (a tag aponta para o pinado, seja
//      o ÍNDICE do multi-arch ou o filho da plataforma), `violated` (serve
//      OUTRO digest: o pin está velho, ou é de outra imagem) e INDETERMINADO
//      (sem rede/credencial) — e INDETERMINADO nunca vira "conforme" por
//      omissão. Quem EXIGE a prova liga `--require-registry`, e aí o veredito
//      vira exit 3.
//
//   3. O CONTRATO do Dockerfile é FAIL-CLOSED, e isso é provado EXECUTANDO o
//      bloco real (`RUN ...` do arquivo, verbatim, nunca uma cópia) contra
//      dublês de `docker`/`bun` no PATH:
//        · base com o plugin  → o bloco sai 0 (CONTROLE);
//        · base SEM o plugin  → o bloco FALHA nomeando a consequência — é a
//          MUTAÇÃO do digest: uma base trocada não traz o plugin;
//        · base sem o CLI     → o bloco FALHA no primeiro ramo.
//
//   4. As MUTAÇÕES do pin falham o guard: `sem digest`, `digest malformado`,
//      `digest trocado` (forma válida, outra imagem) e `contrato afrouxado`
//      (sem `set -euo pipefail` / sem o `exit 1`). Cada mutação roda sobre uma
//      CÓPIA em memória do arquivo e exige VIOLAÇÃO. Sem esta prova, "está
//      pinado" seria uma afirmação sobre o arquivo de hoje, não sobre a regra.
//
// O SANDBOX E O SEU SHIM (a limitação, dita): a asserção do contrato confere
// também que o Bun resolve de `/usr/local/bin/bun`, e o harness não pode criar
// esse caminho (sem root). Então o harness define um `command` de shell que
// responde `-v bun` com o caminho que o PRÓPRIO bloco declara exigir — só a
// asserção de CAMINHO é shimada; o PLUGIN (o alvo desta prova) é exercitado de
// verdade, com um `docker` dublê estrito. A forma do bloco (as asserções que
// ele promete) é conferida à parte, em `contractShape`, e é ela que impede o
// shim de mascarar um contrato que mudou.
//
// POR QUE O PIN É SEMPRE POR ÍNDICE (e o filho também vale): `docker pull`
// reporta o digest do ÍNDICE multi-arch (`docker images --digests`), e é ele
// que o `FROM ...@sha256:` resolve para o filho da plataforma. Um pin do filho
// `linux/amd64` é igualmente imutável e o guard o aceita — o que ele NÃO aceita
// é um digest que não é nenhum dos dois.
// =============================================================================

import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import process from "node:process"
import { pathToFileURL } from "node:url"

/** O Dockerfile da imagem que roda os jobs da forja. */
export const DOCKERFILE = "Dockerfile.ubuntu-bun"

export const EXIT = {
  OK: 0,
  VIOLATION: 1,
  USAGE: 2,
  UNKNOWN: 3,
}

/** A forma canônica de um digest de manifesto OCI. */
export const DIGEST_RE = /^sha256:[0-9a-f]{64}$/

/** O host da API do Docker Hub (o `docker.io` do nome é só apelido dele). */
export const HUB_API = "registry-1.docker.io"

/** Os apelidos do Docker Hub que podem aparecer num ref. */
export const HUB_ALIASES = ["docker.io", "index.docker.io", "registry-1.docker.io"]

/** O que a plataforma do runner é — o pin do filho, quando alguém o usa. */
export const RUNNER_PLATFORM = { os: "linux", architecture: "amd64" }

/** O caminho do Bun na imagem: o contrato promete ESTE. */
export const BUN_PATH = "/usr/local/bin/bun"

/**
 * Os aceites de manifesto: começa pelo ÍNDICE para o registry devolver o
 * digest do multi-arch (o que `docker images --digests` mostra).
 */
export const MANIFEST_ACCEPT = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
  "application/vnd.docker.distribution.manifest.v2+json",
].join(", ")

// ═══════════════════════════════════════════════════════════════════════════
// 1. Leitura estática: o ref do FROM, o bloco do contrato e a FORMA dele
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Um ref de imagem (`[host/]caminho[:tag][@sha256:…]`) em pedaços.
 *
 * O `registryEndpoints` do `ensure-runner-image` NÃO serve aqui: ele assume que
 * o primeiro segmento é o host, e o Docker Hub é exatamente o caso em que ele
 * NÃO está (o nome oficial é `catthehacker/ubuntu`, sem host). E o Hub tem duas
 * convenções próprias: o host da API é `registry-1.docker.io` (o `docker.io`
 * do nome é apelido) e o nome de UMA palavra mora sob `library/`.
 *
 * @param {string} ref
 * @returns {{ok: boolean, name?: string, tag?: string|null, digest?: string|null, host?: string, apiHost?: string, repository?: string, registryId?: string, detail: string}}
 */
export function parseImageRef(ref) {
  const text = String(ref ?? "").trim()
  if (text === "") return { ok: false, detail: "ref vazio" }
  const at = text.indexOf("@")
  const nameWithTag = at === -1 ? text : text.slice(0, at)
  const digest = at === -1 ? null : text.slice(at + 1)
  const lastSlash = nameWithTag.lastIndexOf("/")
  const colon = nameWithTag.indexOf(":", lastSlash + 1)
  const tag = colon === -1 ? null : nameWithTag.slice(colon + 1)
  const name = colon === -1 ? nameWithTag : nameWithTag.slice(0, colon)
  if (name === "") return { ok: false, detail: `ref sem nome: '${ref}'` }

  const segments = name.split("/")
  const first = segments[0]
  const looksLikeHost =
    segments.length > 1 && (first.includes(".") || first.includes(":") || first === "localhost")
  const host = looksLikeHost ? first : "docker.io"
  const path = looksLikeHost ? segments.slice(1).join("/") : name
  const repository = host === "docker.io" && !path.includes("/") ? `library/${path}` : path
  return {
    ok: true,
    name,
    tag,
    digest,
    host,
    apiHost: HUB_ALIASES.includes(host) ? HUB_API : host,
    repository,
    registryId: `${host}/${repository}`,
    detail: `${host}/${repository}${tag ? `:${tag}` : ""}${digest ? `@${digest}` : ""}`,
  }
}

/**
 * As INSTRUÇÕES do Dockerfile, com as continuações de linha (`\`) unidas — a
 * unidade que o docker realmente executa.
 *
 * @param {string} text
 * @returns {{line: number, end: number, kind: string, body: string}[]}
 */
export function instructions(text) {
  const out = []
  const lines = String(text ?? "").split(/\r?\n/)
  let current = null
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    if (current) {
      current.body += `\n${raw}`
      current.end = i + 1
      if (!/\\\s*$/.test(raw)) {
        out.push(current)
        current = null
      }
      continue
    }
    const trimmed = raw.trim()
    if (trimmed === "" || trimmed.startsWith("#")) continue
    const match = /^([A-Za-z]+)\s+(.*)$/.exec(trimmed)
    if (!match) continue
    const entry = { line: i + 1, end: i + 1, kind: match[1].toUpperCase(), body: trimmed }
    if (/\\\s*$/.test(raw)) current = entry
    else out.push(entry)
  }
  if (current) out.push(current)
  return out
}

/**
 * O(s) `FROM` do Dockerfile, com o pin de cada um.
 *
 * @param {string} text
 * @returns {{ok: boolean, froms: {line: number, end: number, ref: string, parsed: ReturnType<typeof parseImageRef>}[], detail: string}}
 */
export function readBase(text) {
  const froms = instructions(text)
    .filter((i) => i.kind === "FROM")
    .map((i) => {
      const ref = i.body.replace(/^FROM\s+/i, "").trim()
      return { line: i.line, end: i.end, ref, parsed: parseImageRef(ref) }
    })
  if (froms.length === 0) return { ok: false, froms: [], detail: `nenhum FROM em ${DOCKERFILE}` }
  return { ok: true, froms, detail: `${froms.length} FROM` }
}

/**
 * Troca o REF do `FROM` — e SÓ ele.
 *
 * POR QUE NÃO `String.replace(ref)` DIRETO: o Dockerfile MENCIONA a mesma tag no
 * cabeçalho ("Base: catthehacker/ubuntu:act-latest …"), e o primeiro `replace`
 * textual mutava o COMENTÁRIO enquanto o `FROM` ficava intacto. Foi assim que as
 * mutações `digest-malformado`/`digest-trocado` "passaram" sem mudar nada que o
 * build lê — o guard estava cego não para as mutações, mas para o lugar delas.
 * A troca é na INSTRUÇÃO do `FROM` (linha inicial..final), nunca no arquivo.
 *
 * @param {string} text
 * @param {string} nextRef
 * @returns {string}
 */
export function replaceBaseRef(text, nextRef) {
  const from = readBase(text).froms?.[0]
  if (!from) return text
  const lines = String(text).split(/\r?\n/)
  const start = from.line - 1
  const segment = lines.slice(start, from.end).join("\n")
  if (!segment.includes(from.ref)) return text
  lines.splice(start, from.end - from.line + 1, segment.replace(from.ref, nextRef))
  return lines.join("\n")
}

/**
 * O bloco `RUN` que confere o CONTRATO — o texto do arquivo, verbatim.
 *
 * Achado por ÂNCORA (a asserção do plugin), nunca por posição: mover o bloco de
 * lugar não pode fazer a prova executar outro trecho — o pior desfecho seria
 * provar um script que não é o que roda no build.
 *
 * @param {string} text
 * @returns {{ok: boolean, block: string|null, line: number|null, detail: string}}
 */
export function contractBlock(text) {
  const found = instructions(text).find(
    (i) => i.kind === "RUN" && /docker compose version/.test(i.body),
  )
  if (!found) {
    return {
      ok: false,
      block: null,
      line: null,
      detail: `nenhum RUN confere o plugin 'compose' — a asserção do contrato sumiu de ${DOCKERFILE}`,
    }
  }
  return {
    ok: true,
    block: found.body.replace(/^RUN\s+/i, ""),
    line: found.line,
    detail: `RUN da linha ${found.line}`,
  }
}

/**
 * A FORMA do contrato: as asserções que ele promete, conferidas no TEXTO.
 *
 * Isto roda à parte da execução (invariante 3) de propósito: o sandbox shima
 * `command -v bun`, então a forma é o que impede o shim de mascarar um contrato
 * que mudou — e um `exit 1` que virou `echo` continuaria "executando".
 *
 * @param {string} text
 * @returns {{ok: boolean, violations: string[], block: string|null}}
 */
export function contractShape(text) {
  const found = contractBlock(text)
  const violations = []
  if (!found.ok) return { ok: false, violations: [found.detail], block: null }
  const block = found.block
  if (!/^\s*set -euo pipefail\b/m.test(block)) {
    violations.push(
      "o bloco do contrato não abre com `set -euo pipefail`: sem isso um `docker compose version` que falha NÃO aborta o build (verificação decorativa)",
    )
  }
  const exits = (block.match(/exit 1/g) ?? []).length
  if (exits < 2) {
    violations.push(
      `o bloco do contrato tem ${exits} \`exit 1\` — são dois ramos que precisam FALHAR o build (sem o CLI, sem o plugin)`,
    )
  }
  if (!/INDETERMINADA dentro do runner da forja/.test(block)) {
    violations.push(
      "a falha do plugin não NOMEIA a consequência (a invariante 7 fica INDETERMINADA dentro do runner) — sem isso o próximo leitor remove a asserção achando que é ruído de build",
    )
  }
  if (!/docker compose version/.test(block)) {
    violations.push("a asserção do plugin (`docker compose version`) não está no bloco")
  }
  if (!new RegExp(`command -v bun[^\\n]*${BUN_PATH.replace(/[.\\/]/g, "\\$&")}`).test(block)) {
    violations.push(
      `o bloco não confere que o Bun resolve de ${BUN_PATH} — mexer no PATH é o que desligaria o tier-1 sem sintoma`,
    )
  }
  return { ok: violations.length === 0, violations, block }
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. A prova por EXECUÇÃO: o bloco real contra bases dubladas
// ═══════════════════════════════════════════════════════════════════════════

/** Os três estados de base que a prova exercita. */
export const SANDBOX_MODES = ["plugin", "no-plugin", "no-cli"]

/**
 * O shell do sandbox, por caminho ABSOLUTO: o PATH dele é só o diretório dos
 * dublês, e por isso `bash` não seria resolvido de lá.
 */
export const SANDBOX_SHELL = existsSync("/bin/bash") ? "/bin/bash" : "bash"

/**
 * O PATH do sandbox é SÓ o diretório dos dublês — nada do sistema vaza.
 *
 * POR QUE ISSO É OBRIGATÓRIO e não uma preferência: com o PATH do host, o caso
 * `no-cli` acharia o `docker` DE VERDADE da máquina e o ramo "sem o CLI" não
 * seria exercitado (foi o que aconteceu na primeira medição: `no-cli` saiu 0,
 * verde por engano). O sandbox tem de conter exatamente um CLI: o dublê.
 */

/** O dublê ESTRITO do `docker`: só o que o contrato usa. */
export function dockerStub(mode) {
  if (mode === "no-plugin") {
    return [
      "#!/bin/sh",
      "# Base trocada: o CLI existe, o subcomando NÃO (o caso da mensagem do guard).",
      'if [ "${1:-}" = "compose" ] && [ "${2:-}" = "version" ]; then',
      "  echo \"docker: 'compose' is not a docker command.\" >&2",
      "  exit 1",
      "fi",
      'echo "Docker version 29.7.2"',
      "exit 0",
      "",
    ].join("\n")
  }
  return [
    "#!/bin/sh",
    "# Base com o plugin (o controle): `docker compose version` responde.",
    'if [ "${1:-}" = "compose" ] && [ "${2:-}" = "version" ]; then',
    '  echo "Docker Compose version 5.4.0-2"',
    "  exit 0",
    "fi",
    'echo "Docker version 29.7.2"',
    "exit 0",
    "",
  ].join("\n")
}

/**
 * Executa o BLOCO REAL do Dockerfile num sandbox com dublês de docker/bun.
 *
 * O PATH do sandbox é SÓ o diretório dos dublês (ver `SANDBOX_MODES`): `docker`
 * e `bun` são o dublê da vez, e o shell é chamado por caminho absoluto. Sem
 * isso o `docker` do host responderia no lugar do dublê.
 *
 * O shim de `command`: o bloco confere que o Bun resolve de `/usr/local/bin/bun`
 * e o sandbox não pode criar esse caminho (sem root). O shim responde `-v bun`
 * com o caminho que o bloco EXIGE e delega todo o resto ao builtin — a asserção
 * de CAMINHO é a única coisa que ele cobre, e `contractShape` a prende no texto.
 *
 * @param {{block: string, mode?: string, cwd?: string, run?: Function, timeoutMs?: number, bunVersion?: string}} args
 * @returns {{code: number, stdout: string, stderr: string, output: string}}
 */
export function runContractBlock({
  block,
  mode = "plugin",
  cwd = process.cwd(),
  run = spawnSync,
  timeoutMs = 30000,
  bunVersion = "1.3.14",
} = {}) {
  if (!SANDBOX_MODES.includes(mode)) throw new Error(`modo desconhecido: ${mode}`)
  const dir = mkdtempSync(join(tmpdir(), "runner-base-"))
  try {
    const bin = join(dir, "bin")
    mkdirSync(bin, { recursive: true })
    if (mode !== "no-cli") writeFileSync(join(bin, "docker"), dockerStub(mode), { mode: 0o755 })
    writeFileSync(join(bin, "bun"), `#!/bin/sh\necho "${bunVersion}"\n`, { mode: 0o755 })
    const shim = `command() { if [ "\${1:-}" = "-v" ] && [ "\${2:-}" = "bun" ]; then echo "${BUN_PATH}"; return 0; fi; builtin command "$@"; }\n`
    const res = run(SANDBOX_SHELL, ["-c", `${shim}${block}`], {
      cwd,
      encoding: "utf8",
      timeout: timeoutMs,
      env: { PATH: bin, BUN_VERSION: bunVersion },
    })
    const stdout = String(res.stdout ?? "")
    const stderr = String(res.stderr ?? "")
    return {
      code: res.status === null || res.status === undefined ? 1 : res.status,
      stdout,
      stderr,
      output: `${stdout}${stderr}`.trim(),
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * A prova do contrato: o bloco real tem de PASSAR na base com o plugin e FALHAR
 * nas duas bases trocadas — cada uma pela razão certa.
 *
 * @param {{text: string, run?: Function, timeoutMs?: number, cwd?: string}} args
 * @returns {{ok: boolean, cases: {id: string, expected: number, code: number, ok: boolean, why: string, tail: string}[], detail: string}}
 */
export function proveContract({ text, run, timeoutMs, cwd } = {}) {
  const found = contractBlock(text)
  if (!found.ok) return { ok: false, cases: [], detail: found.detail }
  const expectations = [
    {
      id: "plugin",
      expected: 0,
      why: "a base do digest fixado traz o plugin — o build passa",
      must: "Contrato da imagem ok",
    },
    {
      id: "no-plugin",
      expected: 1,
      why: "a troca do digest trouxe uma base SEM o plugin — o build FALHA (e nomeia a invariante 7)",
      must: "PLUGIN 'compose' não está na imagem",
    },
    {
      id: "no-cli",
      expected: 1,
      why: "a base não tem nem o CLI `docker` — o build falha no primeiro ramo",
      must: "o CLI 'docker' não está na imagem",
    },
  ]
  const cases = expectations.map((exp) => {
    const res = runContractBlock({
      block: found.block,
      mode: exp.id,
      run,
      timeoutMs,
      cwd,
    })
    const byExpectation = exp.expected === 0 ? res.code === 0 : res.code !== 0
    const byMessage = res.output.includes(exp.must)
    const tail = res.output.split("\n").filter(Boolean).slice(-2).join(" | ")
    return {
      id: exp.id,
      expected: exp.expected,
      code: res.code,
      ok: byExpectation && byMessage,
      why: exp.why,
      tail,
    }
  })
  const failed = cases.filter((c) => !c.ok)
  return {
    ok: failed.length === 0,
    cases,
    detail:
      failed.length === 0
        ? `3 bases exercitadas com o bloco do arquivo (com plugin 0 · sem plugin ≠0 · sem CLI ≠0)`
        : `${failed.length} caso(s) da prova do contrato não bateram: ${failed.map((c) => `${c.id} saiu ${c.code} (esperado ${c.expected})`).join(" · ")}`,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. A prova por MUTAÇÃO: cada troca do pin tem de FALHAR o guard
// ═══════════════════════════════════════════════════════════════════════════

/** Outro digest, de forma VÁLIDA: é o que uma troca por outra imagem produz. */
export const FOREIGN_DIGEST = `sha256:${"0".repeat(64)}`

/** As mutações do Dockerfile que o guard precisa reprovar. */
export function pinMutations(text) {
  const base = readBase(text)
  const from = base.froms?.[0]
  if (!from?.parsed?.ok) return []
  const { name, tag, digest } = from.parsed
  const withRef = (ref) => replaceBaseRef(text, ref)
  const list = [
    {
      id: "sem-digest",
      noopOk: true,
      why: "a tag volta a ser flutuante: a base passa a ser o que ela servir amanhã",
      text: withRef(`${name}:${tag}`),
      detect: (r) => r.violations.some((v) => /não está pinado por digest/.test(v)),
    },
    {
      id: "digest-malformado",
      why: "um digest de 40 hex (ou truncado) passa a olho e não é um digest",
      text: withRef(`${name}:${tag}@sha256:${"a".repeat(40)}`),
      detect: (r) => r.violations.some((v) => /não é um digest canônico/.test(v)),
    },
    {
      id: "digest-trocado",
      why: "o pin aponta para OUTRA imagem (a troca que o probe denuncia)",
      text: withRef(
        `${name}:${tag}@${digest === FOREIGN_DIGEST ? `sha256:${"f".repeat(64)}` : FOREIGN_DIGEST}`,
      ),
      detect: (r) => r.violations.some((v) => /NÃO é o que a tag serve hoje/.test(v)),
    },
    {
      id: "contrato-afrouxado",
      why: "a asserção do plugin continua no arquivo, mas deixou de ser fail-closed",
      text: String(text).replace(
        /exit 1; \\\n    fi; \\\n    if ! docker compose version/,
        "true; \\\n    fi; \\\n    if ! docker compose version",
      ),
      detect: (r) => r.violations.some((v) => /exit 1/.test(v)),
    },
  ]
  return list
}

/**
 * Prova, por mutação, que o guard REPROVA cada troca do pin.
 *
 * O `resolve` é injetado (o probe dublê), e o dublê devolve exatamente o digest
 * que o arquivo REAL fixa — assim a mutação `digest-trocado` é detectada sem
 * rede: o que se prova é a COMPARAÇÃO (a identidade real da tag é a prova da
 * invariante 2, com o probe de verdade).
 *
 * Uma mutação que NÃO muda o arquivo é FALHA, não sucesso: ela significa que a
 * âncora dela deixou de existir (o bloco do contrato foi reescrito, o `FROM`
 * mudou de forma) e que o guard está sendo "provado" por nada. A exceção é
 * `sem-digest`, que num arquivo já despinado é o estado real do arquivo — e aí
 * quem acusa é o próprio `evaluate` na checagem principal.
 *
 * @param {{text: string, resolve?: Function}} args
 * @returns {{ok: boolean, cases: {id: string, ok: boolean, why: string, detail: string}[], detail: string}}
 */
export function provePinMutations({ text, resolve } = {}) {
  const base = readBase(text)
  const pinned = base.froms?.[0]?.parsed?.digest ?? null
  const probe =
    resolve ?? (async () => ({ state: "proven", index: pinned, child: null, detail: "dublê" }))
  void probe
  const mutations = pinMutations(text)
  const cases = []
  for (const mutation of mutations) {
    const changed = mutation.text !== text
    if (!changed) {
      cases.push({
        id: mutation.id,
        ok: mutation.noopOk === true,
        why: mutation.why,
        detail: mutation.noopOk
          ? "o arquivo já está neste estado (a checagem principal acusa)"
          : "a mutação não mudou o arquivo: a ÂNCORA dela deixou de existir — a prova seria vácua",
      })
      continue
    }
    const res = evaluate({
      text: mutation.text,
      resolved: {
        ok: true,
        detail:
          "dublê: a tag serve o digest que o ARQUIVO fixa (a identidade real é a invariante 2, com o probe)",
        ...(pinned ? { index: pinned } : {}),
      },
    })
    cases.push({
      id: mutation.id,
      ok: mutation.detect(res),
      why: mutation.why,
      detail: res.violations[0] ?? "o guard não acusou a mutação",
    })
  }
  if (mutations.length === 0) {
    return {
      ok: false,
      cases: [],
      detail: "nenhuma mutação pôde ser construída a partir do arquivo",
    }
  }
  return {
    ok: cases.every((c) => c.ok),
    cases,
    detail: cases.every((c) => c.ok)
      ? `${cases.length} mutação(ões) do pin reprovadas pelo guard`
      : `${cases.filter((c) => !c.ok).length} mutação(ões) PASSARAM (o guard está cego para elas)`,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. O probe: o que a TAG serve hoje (índice e filho da plataforma)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Pede um token ao registry a partir do desafio `WWW-Authenticate` (fluxo
 * Bearer do Docker Distribution). Sem desafio, tenta o endpoint padrão do host.
 *
 * @returns {Promise<string|null>}
 */
async function fetchRegistryToken(challenge, { fetchImpl, timeoutMs, repository, apiHost }) {
  const realm = /realm="([^"]+)"/.exec(challenge)?.[1]
  const service = /service="([^"]+)"/.exec(challenge)?.[1] ?? apiHost
  const scope = /scope="([^"]+)"/.exec(challenge)?.[1] ?? `repository:${repository}:pull`
  const url = `${realm ?? `https://${apiHost}/token`}${(realm ?? "").includes("?") ? "&" : "?"}service=${encodeURIComponent(service)}&scope=${encodeURIComponent(scope)}`
  try {
    const res = await fetchImpl(url, {
      signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined,
    })
    if (!res.ok) return null
    const body = await res.json().catch(() => ({}))
    return body.token ?? body.access_token ?? null
  } catch {
    return null
  }
}

/**
 * O QUE A TAG SERVE HOJE: o digest do manifesto que ela aponta — o ÍNDICE
 * (multi-arch) e, quando é um índice, o digest do filho da plataforma do
 * runner.
 *
 * POR QUE NÃO REUSA `checkTagExists`/`probeImageIdentity`: aquelas perguntam
 * "dá para puxar?" e "que build a imagem declara?" — esta pergunta é "o digest
 * que a tag serve agora é o que o Dockerfile FIXA?", que exige ler o digest do
 * índice (as outras descem direto para o filho, pelo config blob da versão). E
 * o Docker Hub não passa pelo `registryEndpoints` (host ausente no nome).
 *
 * @param {{ref: string, fetchImpl?: Function, timeoutMs?: number}} args
 * @returns {Promise<{state: string, index: string|null, child: string|null, manifestType: string|null, detail: string}>}
 */
export async function resolveTagDigests({
  ref,
  fetchImpl = globalThis.fetch,
  timeoutMs = 20000,
} = {}) {
  const empty = { index: null, child: null, manifestType: null }
  const parsed = parseImageRef(ref)
  if (!parsed.ok) return { ...empty, state: "error", detail: parsed.detail }
  const { apiHost, repository, tag } = parsed
  if (!tag) return { ...empty, state: "error", detail: `ref sem tag: '${ref}'` }
  const url = `https://${apiHost}/v2/${repository}/manifests/${tag}`
  const signal = () => (timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined)
  const get = (token) =>
    fetchImpl(url, {
      headers: { accept: MANIFEST_ACCEPT, ...(token ? { authorization: `Bearer ${token}` } : {}) },
      signal: signal(),
    })
  try {
    let res = await get(null)
    if (res.status === 401 || res.status === 403) {
      const token = await fetchRegistryToken(res.headers?.get?.("www-authenticate") ?? "", {
        fetchImpl,
        timeoutMs,
        repository,
        apiHost,
      })
      if (!token) {
        return {
          ...empty,
          state: "unauthorized",
          detail: `HTTP ${res.status} em ${apiHost} sem credencial anônima para ${repository}:${tag}`,
        }
      }
      res = await get(token)
    }
    if (res.status === 404) {
      return { ...empty, state: "missing", detail: `HTTP 404 — ${tag} não está em ${apiHost}` }
    }
    if (res.status !== 200) {
      return {
        ...empty,
        state: res.status === 401 || res.status === 403 ? "unauthorized" : "error",
        detail: `HTTP ${res.status} do registry ${apiHost} ao ler o manifesto de ${tag}`,
      }
    }
    const index = res.headers?.get?.("docker-content-digest") ?? null
    const manifestType = String(res.headers?.get?.("content-type") ?? "").split(";")[0] || null
    const manifest = await res.json().catch(() => null)
    let child = null
    if (Array.isArray(manifest?.manifests)) {
      const match =
        manifest.manifests.find(
          (m) =>
            m?.platform?.os === RUNNER_PLATFORM.os &&
            m?.platform?.architecture === RUNNER_PLATFORM.architecture,
        ) ?? manifest.manifests[0]
      child = match?.digest ?? null
    }
    return {
      state: "proven",
      index,
      child,
      manifestType,
      detail:
        `a tag ${tag} de ${apiHost}/${repository} serve ` +
        `${manifestType === "application/vnd.oci.image.index.v1+json" || manifestType === "application/vnd.docker.distribution.manifest.list.v2+json" ? `o índice ${index}` : `o manifesto ${index}`}` +
        `${child ? ` (${RUNNER_PLATFORM.os}/${RUNNER_PLATFORM.architecture}: ${child})` : ""}`,
    }
  } catch (err) {
    return { ...empty, state: "unreachable", detail: err?.message ?? String(err) }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. A decisão
// ═══════════════════════════════════════════════════════════════════════════

/**
 * As checagens ESTÁTICAS + a comparação com o que a tag serve.
 *
 * Pura e síncrona de propósito: o resultado do probe ENTRA como argumento, e é
 * o que torna as mutações do pin prováveis sem rede (o teste injeta o digest).
 *
 * @param {{text: string, resolved?: {ok: boolean, index?: string|null, child?: string|null, state?: string, detail?: string}|null}} args
 * @returns {{ok: boolean, violations: string[], info: {ref: string|null, line: number|null, digest: string|null, registryId: string|null, tag: string|null, matchesIndex: boolean|null, matchesChild: boolean|null}}}
 */
export function evaluate({ text, resolved = null } = {}) {
  const violations = []
  const base = readBase(text)
  const from = base.froms[0] ?? null
  const info = {
    ref: from?.ref ?? null,
    line: from?.line ?? null,
    digest: from?.parsed?.digest ?? null,
    registryId: from?.parsed?.registryId ?? null,
    tag: from?.parsed?.tag ?? null,
    matchesIndex: null,
    matchesChild: null,
  }

  if (!base.ok) violations.push(base.detail)
  if (base.froms.length > 1) {
    violations.push(
      `${DOCKERFILE} tem ${base.froms.length} FROM: o pin (e a prova do contrato) é de UM só — o contrato roda na imagem final`,
    )
  }
  if (from && !from.parsed.ok) violations.push(`FROM ilegível: ${from.parsed.detail}`)

  if (from?.parsed?.ok) {
    const { digest } = from.parsed
    if (!digest) {
      violations.push(
        `${DOCKERFILE}:${from.line} — o FROM não está pinado por digest (\`${from.ref}\`): a tag é FLUTUANTE e um rebuild da base troca a imagem inteira (inclusive o plugin \`compose\` do contrato) sem nenhuma linha do repositório mudar`,
      )
    } else if (!DIGEST_RE.test(digest)) {
      violations.push(
        `${DOCKERFILE}:${from.line} — \`${digest}\` não é um digest canônico (\`sha256:\` + 64 hex): um digest truncado passa a olho e não pina nada`,
      )
    } else if (resolved?.ok) {
      info.matchesIndex = resolved.index ? digest === resolved.index : null
      info.matchesChild = resolved.child ? digest === resolved.child : null
      if (!info.matchesIndex && !info.matchesChild) {
        violations.push(
          `o digest fixado NÃO é o que a tag serve hoje (${resolved.detail}): o pin está velho (a base foi republicada — atualize com \`--write\`) ou é de OUTRA imagem`,
        )
      }
    }
  }

  // O CONTRATO: forma (texto) + prova (execução). Os dois juntos, porque um
  // `exit 1` que virou `echo` continua "rodando" — e um bloco ausente não tem
  // prova nenhuma para dar.
  const shape = contractShape(text)
  for (const v of shape.violations) violations.push(v)

  return { ok: violations.length === 0, violations, info }
}

/**
 * A decisão completa: estático + probe + provas (execução e mutação).
 *
 * @param {{cwd?: string, probe?: boolean, requireRegistry?: boolean, fetchImpl?: Function, timeoutMs?: number, run?: Function, prove?: boolean, text?: string|null}} [options]
 * @returns {Promise<{state: "proven"|"violated"|"unknown", violations: string[], warnings: string[], info: {ref?: string|null, line?: number|null, digest?: string|null, registryId?: string|null, tag?: string|null, matchesIndex?: boolean|null, matchesChild?: boolean|null}, probe: {state: string, index: string|null, child: string|null, manifestType: string|null, detail: string}|null, proofs: {contract: {ok: boolean, cases: {id: string, expected: number, code: number, ok: boolean, why: string, tail: string}[], detail: string}, mutations: {ok: boolean, cases: {id: string, ok: boolean, why: string, detail: string}[], detail: string}}|null, detail: string}>}
 */
export async function checkRunnerBase({
  cwd = process.cwd(),
  probe = true,
  requireRegistry = false,
  fetchImpl = globalThis.fetch,
  timeoutMs = 20000,
  run = spawnSync,
  prove = true,
  text = null,
} = {}) {
  const empty = {
    state: "violated",
    violations: [],
    warnings: [],
    info: {},
    probe: null,
    proofs: null,
  }
  const path = join(cwd, DOCKERFILE)
  let source = text
  if (source === null) {
    if (!existsSync(path)) {
      return { ...empty, state: "violated", detail: `${DOCKERFILE} não existe em ${cwd}` }
    }
    source = readFileSync(path, "utf8")
  }

  const base = readBase(source)
  const from = base.froms[0] ?? null
  const warnings = []

  // O probe ANTES do evaluate: ele é a única pergunta que depende da rede, e o
  // resultado entra no veredito estático (o digest fixado é o que a tag serve?).
  let resolved = null
  let probeFact = null
  if (probe && from?.parsed?.ok && from.parsed.tag) {
    const r = await resolveTagDigests({ ref: from.ref, fetchImpl, timeoutMs })
    probeFact = r
    if (r.state === "proven") {
      resolved = { ok: true, index: r.index, child: r.child, state: r.state, detail: r.detail }
    } else {
      warnings.push(
        `a tag não pôde ser conferida no registry (${r.state}): ${r.detail} — o pin NÃO foi verificado contra o que a tag serve`,
      )
    }
  } else if (!probe) {
    warnings.push(
      "a consulta ao registry foi desligada (--no-registry-probe): o pin não foi conferido contra o que a tag serve",
    )
  }

  const evaluated = evaluate({ text: source, resolved })
  const violations = [...evaluated.violations]

  // As provas (execução do contrato + mutações do pin).
  let proofs = null
  if (prove) {
    const contract = proveContract({ text: source, run, cwd, timeoutMs })
    const mutations = provePinMutations({
      text: source,
      resolve: async () => ({
        state: "proven",
        index: from?.parsed?.digest ?? null,
        child: null,
        detail: "dublê",
      }),
    })
    proofs = { contract, mutations }
    if (!contract.ok) violations.push(`a prova do contrato FALHOU: ${contract.detail}`)
    if (!mutations.ok) violations.push(`a prova por mutação do pin FALHOU: ${mutations.detail}`)
  }

  const state =
    violations.length > 0
      ? "violated"
      : warnings.length > 0 && requireRegistry
        ? "unknown"
        : "proven"
  return {
    state,
    violations,
    warnings,
    info: evaluated.info,
    probe: probeFact,
    proofs,
    detail:
      violations.length > 0
        ? `${violations.length} violação(ões) na base do runner`
        : state === "unknown"
          ? `a base está pinada, mas a prova da tag foi EXIGIDA (--require-registry) e não aconteceu`
          : `a base está pinada por digest${resolved ? " e é o que a tag serve hoje" : " (a tag não pôde ser conferida)"}`,
  }
}

/**
 * Reescreve o `FROM` com o digest que a tag serve agora — a atualização do pin,
 * em um passo, RESOLVENDO E VALIDANDO (um `--write` que escrevesse sem conferir
 * o pin novo seria o mesmo trabalho manual com outra roupa).
 *
 * @param {{cwd?: string, text?: string, ref?: string, fetchImpl?: Function, timeoutMs?: number}} args
 * @returns {Promise<{ok: boolean, text?: string, digest?: string, changed?: boolean, detail: string}>}
 */
export async function writePin({
  cwd = process.cwd(),
  text = null,
  ref = null,
  fetchImpl = globalThis.fetch,
  timeoutMs = 20000,
} = {}) {
  const source = text ?? readFileSync(join(cwd, DOCKERFILE), "utf8")
  const base = readBase(source)
  const from = base.froms[0]
  if (!from?.parsed?.ok) return { ok: false, detail: base.ok ? "FROM ilegível" : base.detail }
  const target = ref ?? from.ref.replace(/@sha256:[0-9a-f]{64}$/, "")
  const resolved = await resolveTagDigests({ ref: target, fetchImpl, timeoutMs })
  if (resolved.state !== "proven" || !resolved.index) {
    return {
      ok: false,
      detail: `a tag não pôde ser resolvida (${resolved.state}): ${resolved.detail}`,
    }
  }
  const pinned = `${target}@${resolved.index}`
  if (pinned === from.ref)
    return {
      ok: true,
      text: source,
      digest: resolved.index,
      changed: false,
      detail: "o pin já é o que a tag serve hoje",
    }
  return {
    ok: true,
    text: replaceBaseRef(source, pinned),
    digest: resolved.index,
    changed: true,
    detail: `${from.ref} → ${pinned}`,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. Relatório e CLI
// ═══════════════════════════════════════════════════════════════════════════

const MARK = { ok: "✅", fail: "❌", warn: "⚠️", info: "▸" }

/** O relatório legível — o MESMO texto na CLI e no log do CI. */
export function renderReport(result) {
  const lines = []
  const head =
    result.state === "proven"
      ? `${MARK.ok} ${result.detail}`
      : result.state === "unknown"
        ? `${MARK.warn} INDETERMINADO — ${result.detail}`
        : `${MARK.fail} ${result.detail}`
  lines.push(`check-runner-base: ${head}`)
  if (result.info?.ref) lines.push(`  FROM      : ${result.info.ref} (linha ${result.info.line})`)
  if (result.info?.digest) {
    const which = result.info.matchesIndex
      ? "é o ÍNDICE da tag"
      : result.info.matchesChild
        ? `é o filho ${RUNNER_PLATFORM.os}/${RUNNER_PLATFORM.architecture} do índice`
        : "não foi conferido contra a tag"
    lines.push(`  digest    : ${result.info.digest} — ${which}`)
  }
  if (result.probe?.detail) lines.push(`  registry  : ${result.probe.detail}`)
  if (result.proofs?.contract?.cases?.length) {
    const cases = result.proofs.contract.cases.map((c) => `${c.id}=${c.code}`).join(" · ")
    lines.push(
      `  contrato  : ${result.proofs.contract.ok ? MARK.ok : MARK.fail} bloco do Dockerfile executado (${cases})`,
    )
  }
  if (result.proofs?.mutations?.cases?.length) {
    lines.push(
      `  mutações  : ${result.proofs.mutations.ok ? MARK.ok : MARK.fail} ${result.proofs.mutations.cases.map((c) => c.id).join(" · ")}`,
    )
  }
  for (const v of result.violations) lines.push(`  ${MARK.fail} ${v}`)
  for (const w of result.warnings) lines.push(`  ${MARK.warn} ${w}`)
  return lines.join("\n")
}

export const USAGE = `check-runner-base — a base do Dockerfile do runner está pinada por digest?

Usage:
  node scripts/check-runner-base.mjs [opções]

Opções:
  --no-registry-probe     não consulta o registry (offline): o pin deixa de ser
                          conferido contra o que a tag serve — e o relatório diz
  --require-registry      a consulta ao registry é OBRIGATÓRIA: sem ela o
                          veredito é INDETERMINADO (exit 3) em vez de "conforme"
  --write                 resolve a tag no registry e reescreve o FROM com o
                          digest servido (atualiza o pin em um passo)
  --dockerfile <path>     outro Dockerfile (default: ${DOCKERFILE})
  --json                  saída estruturada
  -h, --help              esta ajuda

O que ele prova (e por que a prova é o ponto):
  · o FROM é \`nome:tag@sha256:<64 hex>\` (a tag é documentação; o digest é o contrato);
  · o digest fixado é o que a tag serve HOJE (índice ou filho da plataforma);
  · o BLOCO do contrato do Dockerfile é fail-closed — e é provado EXECUTANDO o
    bloco real contra bases dubladas (com plugin · sem plugin · sem o CLI);
  · as MUTAÇÕES do pin (sem digest · malformado · trocado · contrato afrouxado)
    falham o guard: sem isso, "está pinado" seria uma afirmação sobre o arquivo
    de hoje, não sobre a regra.

Exit codes:
  0 — pinado e conferido   1 — violação   2 — uso inválido
  3 — indeterminado (só com --require-registry)`

/**
 * @param {string[]} argv
 * @returns {{probe: boolean, requireRegistry: boolean, write: boolean, json: boolean, help: boolean, dockerfile: string, error?: string}}
 */
export function parseArgs(argv) {
  const opts = {
    probe: true,
    requireRegistry: false,
    write: false,
    json: false,
    help: false,
    dockerfile: DOCKERFILE,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--no-registry-probe") opts.probe = false
    else if (arg === "--require-registry") opts.requireRegistry = true
    else if (arg === "--write") opts.write = true
    else if (arg === "--json") opts.json = true
    else if (arg === "-h" || arg === "--help") opts.help = true
    else if (arg === "--dockerfile") {
      const next = argv[++i]
      if (next === undefined || next.startsWith("--"))
        return { ...opts, error: "--dockerfile exige um caminho" }
      opts.dockerfile = next
    } else if (arg.startsWith("-")) return { ...opts, error: `argumento desconhecido: ${arg}` }
  }
  return opts
}

/** O exit code de um resultado — o CONTRATO da CLI. */
export function exitCodeFor(result) {
  if (result.state === "proven") return EXIT.OK
  if (result.state === "unknown") return EXIT.UNKNOWN
  return EXIT.VIOLATION
}

const isMain = !!process.argv[1] && process.argv[1].split(/[\\/]/).pop() === "check-runner-base.mjs"

if (isMain) {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.help) {
    console.log(USAGE)
    process.exit(EXIT.OK)
  }
  if (opts.error) {
    console.error(`check-runner-base: ${opts.error}`)
    console.error(USAGE)
    process.exit(EXIT.USAGE)
  }

  // `--dockerfile` aponta o ARQUIVO (default: o do repositório). O texto é lido
  // daqui e passado ao guard, que assim não tem um segundo caminho de leitura.
  const file = resolve(opts.dockerfile)
  if (!existsSync(file)) {
    console.error(`check-runner-base: ${DOCKERFILE} não existe em ${file}`)
    process.exit(EXIT.VIOLATION)
  }
  const text = opts.dockerfile === DOCKERFILE ? null : readFileSync(file, "utf8")

  if (opts.write) {
    const written = await writePin({ text, ref: null })
    if (!written.ok) {
      console.error(`check-runner-base: ${written.detail}`)
      process.exit(EXIT.VIOLATION)
    }
    if (written.changed) {
      writeFileSync(file, /** @type {string} */ (written.text), "utf8")
      console.log(`check-runner-base: ${MARK.ok} ${written.detail}`)
    } else {
      console.log(`check-runner-base: ${MARK.info} ${written.detail}`)
    }
    process.exit(EXIT.OK)
  }

  const result = await checkRunnerBase({
    text,
    probe: opts.probe,
    requireRegistry: opts.requireRegistry,
  })

  if (opts.json) {
    console.log(JSON.stringify({ ...result, exitCode: exitCodeFor(result) }, null, 2))
  } else {
    console.log(renderReport(result))
  }
  process.exit(exitCodeFor(result))
}

// `pathToFileURL` fica importado para o caso de o arquivo ser carregado por
// caminho relativo em outro script (o doctor importa as funções, não o main).
export const __moduleUrl = pathToFileURL(join(process.cwd(), DOCKERFILE)).href
