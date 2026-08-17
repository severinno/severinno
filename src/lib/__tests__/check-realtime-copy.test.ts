/**
 * check-realtime-copy.test.ts
 *
 * Testes do guard scripts/check-realtime-copy.mjs — valida que o Dockerfile
 * do realtime copia todo módulo local importado (direta ou transitivamente)
 * por index.ts. Previne a regressão de imagem quebrada: um módulo novo
 * importado sem COPY correspondente boota o container com "module not found"
 * (o gap que quebrou 2x antes do fix COPY *.ts ./).
 *
 * Cobre:
 *   - fixture limpo (glob *.ts + módulos no diretório) → exit 0
 *   - módulo importado SEM arquivo no diretório (forward) → exit 1 + citado
 *   - lista explícita do COPY sem módulo importado → exit 1 + citado
 *   - entrada órfã na lista explícita (reverse) → exit 1 + citada
 *   - index.ts ou Dockerfile ausente (fail-closed) → exit 1
 *   - import para subdiretório NÃO é coberto pelo glob *.ts → exit 1
 *   - funções puras: extractLocalImports (from/import/re-export + normalize),
 *     collectModuleClosure (transitivo + ciclo), parseDockerfileCopies
 *     (glob vs lista, dest, --from), checkRealtimeCopy (3 direções)
 */

import { describe, it, expect, afterEach } from "vitest"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import {
  extractLocalImports,
  collectModuleClosure,
  parseDockerfileCopies,
  checkRealtimeCopy,
} from "../../../scripts/check-realtime-copy.mjs"

const GUARD = resolve(process.cwd(), "scripts/check-realtime-copy.mjs")

const tmpDirs: string[] = []

/** Conteúdo do index.ts fake (imports dos 4 módulos do fixture). */
const INDEX_SOURCE = [
  'import { readSecret } from "./security"',
  'import { persist } from "./redis-telemetry"',
  'import { check } from "./booking-participant"',
  'export { createOrphanAlert } from "./ops-alert"',
  "",
].join("\n")

/** Dockerfile fake com glob *.ts (o fix atual do repo). */
const DOCKERFILE_GLOB = [
  "ARG BUN_VERSION",
  "FROM oven/bun:${BUN_VERSION}-slim AS runner",
  "WORKDIR /app",
  "COPY package.json bun.lock ./",
  "COPY *.ts ./",
  "CMD [\"bun\", \"index.ts\"]",
  "",
].join("\n")

/** Dockerfile fake com lista explícita (a regressão que o guard bloqueia). */
const DOCKERFILE_LIST = [
  "ARG BUN_VERSION",
  "FROM oven/bun:${BUN_VERSION}-slim AS runner",
  "WORKDIR /app",
  "COPY package.json bun.lock ./",
  "COPY index.ts security.ts redis-telemetry.ts booking-participant.ts ./",
  "CMD [\"bun\", \"index.ts\"]",
  "",
].join("\n")

/** Cria o fixture limpo (4 módulos + Dockerfile com glob). Retorna o root. */
function makeFixture(dockerfile = DOCKERFILE_GLOB): string {
  const dir = mkdtempSync(join(tmpdir(), "realtime-copy-"))
  tmpDirs.push(dir)
  const rt = join(dir, "mini-services", "realtime")
  mkdirSync(rt, { recursive: true })
  writeFileSync(join(rt, "index.ts"), INDEX_SOURCE)
  writeFileSync(join(rt, "Dockerfile"), dockerfile)
  // security.ts re-exporta port.ts — testa o closure transitivo
  writeFileSync(join(rt, "security.ts"), 'export { parseRealtimePort } from "./port"\n')
  writeFileSync(join(rt, "port.ts"), "export const parseRealtimePort = () => 3003\n")
  writeFileSync(join(rt, "redis-telemetry.ts"), 'import { readSecret } from "./security"\n')
  writeFileSync(join(rt, "booking-participant.ts"), "")
  writeFileSync(join(rt, "ops-alert.ts"), "")
  return dir
}

/** Output combinado stdout+stderr — o guard escreve violações no stderr. */
function outputOf(res: ReturnType<typeof run>): string {
  return `${res.stdout ?? ""}${res.stderr ?? ""}`
}

function run(dir: string) {
  return spawnSync(process.execPath, [GUARD, "--root", dir], { encoding: "utf8" })
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe("check-realtime-copy.mjs (CLI)", () => {
  it("exit 0 quando o glob *.ts cobre todos os módulos importados", () => {
    const dir = makeFixture()
    const res = run(dir)
    expect(res.status).toBe(0)
    expect(outputOf(res)).toContain("✅")
  })

  it("exit 1 e cita o módulo quando um import NÃO tem arquivo no diretório (forward)", () => {
    const dir = makeFixture()
    // index.ts importa ./ghost mas ghost.ts não existe
    writeFileSync(
      join(dir, "mini-services", "realtime", "index.ts"),
      'import { x } from "./ghost"\n',
    )
    const res = run(dir)
    expect(res.status).toBe(1)
    expect(outputOf(res)).toContain("ghost")
    expect(outputOf(res)).toContain("SEM arquivo")
  })

  it("exit 1 e cita o módulo quando a lista explícita do COPY o omite", () => {
    const dir = makeFixture(DOCKERFILE_LIST)
    // ops-alert.ts importado por index.ts mas não listado no COPY explícito
    const res = run(dir)
    expect(res.status).toBe(1)
    expect(outputOf(res)).toContain("ops-alert")
    expect(outputOf(res)).toContain("NÃO está na lista explícita")
  })

  it("exit 1 e cita a entrada quando a lista explícita tem módulo órfão (reverse)", () => {
    const dir = makeFixture(DOCKERFILE_LIST)
    // lista contém booking-participant e todos os outros... adiciona órfão
    writeFileSync(
      join(dir, "mini-services", "realtime", "Dockerfile"),
      DOCKERFILE_LIST.replace(
        "booking-participant.ts ./",
        "booking-participant.ts ghost.ts ./",
      ),
    )
    const res = run(dir)
    expect(res.status).toBe(1)
    expect(outputOf(res)).toContain("ghost")
    expect(outputOf(res)).toContain("órfã")
  })

  it("exit 1 quando o index.ts está ausente (fail-closed)", () => {
    const dir = makeFixture()
    rmSync(join(dir, "mini-services", "realtime", "index.ts"))
    const res = run(dir)
    expect(res.status).toBe(1)
    expect(outputOf(res)).toContain("index.ts")
  })

  it("exit 1 quando o Dockerfile está ausente (fail-closed)", () => {
    const dir = makeFixture()
    rmSync(join(dir, "mini-services", "realtime", "Dockerfile"))
    const res = run(dir)
    expect(res.status).toBe(1)
    expect(outputOf(res)).toContain("Dockerfile")
  })

  it("exit 1 quando o módulo da lista do COPY não tem arquivo em lugar nenhum (fail-open do skip da lista)", () => {
    const dir = makeFixture(DOCKERFILE_LIST)
    // index.ts importa ./ghost, a lista do COPY contém ghost.ts, MAS o arquivo
    // não existe — o skip por list-membership passaria silenciosamente; o
    // resolved-set flagra arquivo ausente SEMPRE (fix do reviewer).
    writeFileSync(
      join(dir, "mini-services", "realtime", "index.ts"),
      'import { x } from "./ghost"\n',
    )
    writeFileSync(
      join(dir, "mini-services", "realtime", "Dockerfile"),
      DOCKERFILE_LIST.replace(
        "booking-participant.ts ./",
        "booking-participant.ts ghost.ts ./",
      ),
    )
    const res = run(dir)
    expect(res.status).toBe(1)
    expect(outputOf(res)).toContain("ghost")
    expect(outputOf(res)).toContain("SEM arquivo")
  })

  it("exit 1 quando não há COPY de fonte (.ts/.js) no Dockerfile", () => {
    const dir = makeFixture(
      ["ARG BUN_VERSION", "FROM oven/bun:${BUN_VERSION}-slim", "WORKDIR /app", "CMD [\"bun\", \"index.ts\"]", ""].join(
        "\n",
      ),
    )
    const res = run(dir)
    expect(res.status).toBe(1)
    expect(outputOf(res)).toContain("nenhum COPY de fonte")
  })

  it("exit 1 quando o glob *.ts não cobre import para subdiretório (arquivo existe em lib/)", () => {
    const dir = makeFixture()
    // O arquivo EXISTE em subdiretório — o glob *.ts não recursa, então o
    // forward (2) flagra "não é coberto pelo glob" (não é arquivo ausente).
    mkdirSync(join(dir, "mini-services", "realtime", "lib"), { recursive: true })
    writeFileSync(join(dir, "mini-services", "realtime", "lib", "helper.ts"), "export const h = 1\n")
    writeFileSync(
      join(dir, "mini-services", "realtime", "index.ts"),
      'import { x } from "./lib/helper"\n',
    )
    const res = run(dir)
    expect(res.status).toBe(1)
    expect(outputOf(res)).toContain("lib/helper")
    expect(outputOf(res)).toContain("NÃO é coberto pelo glob")
  })

  it("exit 2 para flag desconhecida", () => {
    const dir = makeFixture()
    const res = spawnSync(process.execPath, [GUARD, "--nope", dir], { encoding: "utf8" })
    expect(res.status).toBe(2)
  })
})

describe("check-realtime-copy.mjs (funções puras)", () => {
  it("extractLocalImports captura from/import/re-export e normaliza .ts", () => {
    const src = [
      'import { a } from "./security"',
      'import { b } from "./redis-telemetry.ts"',
      'export { c } from "./ops-alert"',
      'import "socket.io"', // pacote — não é local
      'import type { T } from "./port"',
      "",
    ].join("\n")
    expect(extractLocalImports(src).sort()).toEqual([
      "ops-alert",
      "port",
      "redis-telemetry",
      "security",
    ])
  })

  it("extractLocalImports rastreia caminhos com subdiretório (normaliza p/ lib/helper)", () => {
    // O glob *.ts não recursa — o rastreio do subdir é o que permite o forward
    // flagrar o gap real de module not found (fix do reviewer).
    expect(extractLocalImports('import { x } from "./lib/helper"')).toEqual(["lib/helper"])
  })

  it("collectModuleClosure segue imports transitivos e evita ciclos", () => {
    const files = new Map<string, string>([
      ["security", 'export { parseRealtimePort } from "./port"'],
      ["port", ""],
      ["redis-telemetry", 'import { readSecret } from "./security"'],
    ])
    const read = (n: string) => files.get(n) ?? null
    const closure = collectModuleClosure(INDEX_SOURCE, read)
    // security → port (transitivo); redis-telemetry → security (já visitado)
    expect(closure).toContain("security")
    expect(closure).toContain("port")
    expect(closure).toContain("redis-telemetry")
    expect(closure).toContain("booking-participant")
    expect(closure).toContain("ops-alert")
  })

  it("collectModuleClosure não estoura em ciclo security ↔ index", () => {
    const files = new Map<string, string>([
      ["security", 'import { x } from "./index"'],
    ])
    const read = (n: string) => files.get(n) ?? null
    const closure = collectModuleClosure(INDEX_SOURCE, read)
    expect(closure).toContain("security")
  })

  it("parseDockerfileCopies distingue glob de lista e ignora dest diferente", () => {
    const dockerfile = [
      "COPY package.json bun.lock ./",
      "COPY *.ts ./",
      "COPY --from=builder /app/dist ./dist", // --from: ignora (dest dist)
      "COPY index.ts security.ts /app/",
      "COPY assets /tmp/", // sem .ts — não conta
      "",
    ].join("\n")
    const copies = parseDockerfileCopies(dockerfile)
    expect(copies.globs).toEqual(["*.ts"])
    expect(copies.list).toEqual(["index", "security"])
  })

  it("checkRealtimeCopy reporta forward, lista faltando, reverse e glob ok", () => {
    // glob cobre tudo com arquivos presentes (resolved = dirFiles)
    expect(
      checkRealtimeCopy(
        ["security", "port"],
        { globs: ["*.ts"], list: [] },
        new Set(["security", "port"]),
        new Set(["security", "port"]),
      ),
    ).toEqual([])

    // forward (1) — módulo sem arquivo em lugar nenhum (resolved não o tem)
    expect(
      checkRealtimeCopy(["ghost"], { globs: ["*.ts"], list: [] }, new Set(["security"]), new Set(["security"])),
    ).toHaveLength(1)

    // lista explícita sem o módulo importado (arquivo existe → resolved tem)
    const listViol = checkRealtimeCopy(
      ["security", "port"],
      { globs: [], list: ["security"] },
      new Set(["security", "port"]),
      new Set(["security", "port"]),
    )
    expect(listViol.some((v) => v.includes("port") && v.includes("NÃO está na lista"))).toBe(true)

    // reverse — entrada órfã
    const orphan = checkRealtimeCopy(
      ["security"],
      { globs: [], list: ["security", "ghost"] },
      new Set(["security", "ghost"]),
      new Set(["security", "ghost"]),
    )
    expect(orphan.some((v) => v.includes("ghost") && v.includes("órfã"))).toBe(true)
  })

  it("checkRealtimeCopy não flagra subdir presente na lista explícita (fix do reviewer)", () => {
    // COPY lib/helper.ts ./ → list: ["lib/helper"]; o arquivo existe em lib/,
    // fora do dirFiles top-level — não pode ser falso positivo de forward.
    expect(
      checkRealtimeCopy(
        ["lib/helper"],
        { globs: [], list: ["lib/helper"] },
        new Set([]), // top-level vazio
        new Set(["lib/helper"]), // arquivo existe (subdir) → resolved tem
      ),
    ).toEqual([])

    // lista explícita SEM o subdir → o check de lista é o dono do caso
    // (mensagem de lista, não de glob — nit do reviewer)
    const listViol = checkRealtimeCopy(
      ["lib/helper"],
      { globs: [], list: [] },
      new Set([]),
      new Set(["lib/helper"]),
    )
    expect(listViol.some((v) => v.includes("lib/helper") && v.includes("NÃO está na lista"))).toBe(true)
    // sem mensagem de glob enganosa — a sugestão "ou use o glob *.ts" existe
    // na mensagem de lista, então o alvo é o wording específico de cobertura
    expect(listViol.some((v) => v.includes("NÃO é coberto pelo glob"))).toBe(false)

    // glob *.ts com subdir → o glob é o dono do caso (mensagem de glob)
    const globViol = checkRealtimeCopy(
      ["lib/helper"],
      { globs: ["*.ts"], list: [] },
      new Set([]),
      new Set(["lib/helper"]),
    )
    expect(globViol.some((v) => v.includes("lib/helper") && v.includes("NÃO é coberto pelo glob"))).toBe(true)

    // mixed glob+lista (COPY *.ts ./ + COPY lib/helper.ts ./) → a lista cobre
    // o subdir — sem falso positivo (regressão que o reviewer pegou 2x)
    expect(
      checkRealtimeCopy(
        ["lib/helper"],
        { globs: ["*.ts"], list: ["lib/helper"] },
        new Set([]),
        new Set(["lib/helper"]),
      ),
    ).toEqual([])
  })

  it("checkRealtimeCopy flagra SEMPRE arquivo ausente, mesmo na lista do COPY (fail-open do reviewer)", () => {
    // ghost está na lista explícita MAS o arquivo não existe (resolved vazio) —
    // o skip por list-membership passaria; o resolved-set flagra arquivo
    // ausente incondicionalmente.
    const viol = checkRealtimeCopy(["ghost"], { globs: [], list: ["ghost"] }, new Set([]), new Set([]))
    expect(viol.some((v) => v.includes("ghost") && v.includes("SEM arquivo"))).toBe(true)
    // e nenhuma entrada órfã é reportada (ghost É usado no closure)
    expect(viol.some((v) => v.includes("órfã"))).toBe(false)
  })
})
