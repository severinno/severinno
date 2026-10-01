/**
 * pr-remedy-comment.test.ts
 *
 * O contrato do publicador do remendo (scripts/pr-remedy-comment.mjs): o patch
 * do gate `bash -n` vira COMENTÁRIO no PR, e o comentário é RECONCILIADO.
 *
 * O QUE ELE PRENDE (cada metade tem o seu porquê):
 *
 *   1. o CORPO carrega o marcador estável, o patch exato e o bloco de aplicação
 *      (copiar → colar já aplica), e as RECUSAS com motivo — um comentário que
 *      só mostrasse o patch esconderia o que o fixer não remenda nem por quê;
 *   2. as DECISÕES são puras e as quatro importam: `create` (primeira vez),
 *      `update` (o patch mudou), `noop` (idêntico — reescrever gastaria uma
 *      chamada e mudaria a data do rodapé) e `remove` (a cicatriz sumiu: retirar
 *      é o que FECHA o ciclo, em vez de deixar aberto um aviso mentiroso);
 *   3. o CICLO é exercitado ponta a ponta contra uma API DUBLÊ (injetável, como
 *      nos outros publicadores) — criar na run 1, não repetir na 2, atualizar na
 *      3 e retirar na 4 —, e o resíduo de dois runs concorrentes (dois
 *      comentários com o marcador) é RETIRADO em vez de acumular;
 *   4. os desfechos de CANAL são opostos de propósito: 401/403 (token sem
 *      escrita: PR de fork) é `ChannelDenied` — aviso, o GATE é o veredito —,
 *      enquanto 5xx é publicação QUEBRADA e falha o passo. Um canal que existe e
 *      não publica é pior que a ausência dele, porque parece que publicou.
 *
 * ATENÇÃO (esbuild): `${{` e `${...}` do GitHub Actions precisam de escape
 * (`\${{`, `\${...}`) dentro de template literals.
 *
 * Usage:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/pr-remedy-comment.test.ts
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"

import { afterEach, describe, expect, it } from "vitest"

import { criarParDeReescrita, garantirRepoComBase } from "./helpers/doc-hashes-fixture"

import {
  ChannelDenied,
  DEFAULT_FIXER,
  EXIT,
  FIXERS,
  FORMA_DO_RESULTADO,
  GATE_JOB,
  MARKER,
  MAX_REFUSED,
  backendChannel,
  corpoDoFixer,
  decideComment,
  fixerOf,
  prNumberFrom,
  publicarFixer,
  reconcileRemedy,
  remedyBody,
  selectBackend,
} from "../../../scripts/pr-remedy-comment.mjs"

const SCRIPT = join(process.cwd(), "scripts", "pr-remedy-comment.mjs")
const tmpDirs: string[] = []

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** Um `remedyPatch` sintético: o que o publicador consome do gate. */
function resultado(over: Record<string, unknown> = {}) {
  return {
    patch:
      "--- a/.github/workflows/ci.yml\n" +
      "+++ b/.github/workflows/ci.yml\n" +
      "@@ -9,1 +9,1 @@\n" +
      "-          echo hello &&\n" +
      "+          echo hello\n",
    fixed: [{ file: ".github/workflows/ci.yml", line: 8, linhaArquivo: 9, operador: "&&" }],
    refused: [],
    shellFailures: [],
    embeddedFailures: [],
    payloadFailures: [],
    unread: [],
    yamlInvalido: [],
    indisponivel: null,
    ...over,
  }
}

/**
 * API dublê dos dois desfechos: comentários em memória + falhas por método.
 */
function fakeApi({
  deny = false,
  failMethod = null,
}: { deny?: boolean; failMethod?: string | null } = {}) {
  const comments: { id: number; body: string }[] = []
  const calls: { method: string; path: string }[] = []
  let nextId = 1
  const request = async (
    _config: unknown,
    method: string,
    path: string,
    body?: { body?: string },
  ) => {
    calls.push({ method, path })
    if (failMethod === method) return { status: 500, data: null, text: "boom" }
    if (deny && method !== "GET") return { status: 403, data: null, text: "forbidden" }
    const idOf = () => Number.parseInt(path.split("/").pop() ?? "", 10)
    if (method === "GET") return { status: 200, data: comments.map((c) => ({ ...c })), text: "" }
    if (method === "POST") {
      const id = nextId++
      comments.push({ id, body: String(body?.body ?? "") })
      return { status: 201, data: { id }, text: "" }
    }
    if (method === "PATCH") {
      const found = comments.find((c) => c.id === idOf())
      if (!found) return { status: 404, data: null, text: "gone" }
      found.body = String(body?.body ?? "")
      return { status: 200, data: { id: found.id }, text: "" }
    }
    if (method === "DELETE") {
      const i = comments.findIndex((c) => c.id === idOf())
      if (i === -1) return { status: 404, data: null, text: "gone" }
      comments.splice(i, 1)
      return { status: 204, data: null, text: "" }
    }
    return { status: 500, data: null, text: "método inesperado" }
  }
  return { request, comments, calls }
}

function writeFixture(linhas: string[], extra?: { arquivo: string; corpo: string }): string {
  const dir = mkdtempSync(join(tmpdir(), "pr-remedy-"))
  tmpDirs.push(dir)
  mkdirSync(join(dir, ".github", "workflows"), { recursive: true })
  writeFileSync(join(dir, ".github", "workflows", "ci.yml"), linhas.join("\n") + "\n", "utf8")
  if (extra) writeFileSync(join(dir, extra.arquivo), extra.corpo, "utf8")
  return dir
}

/** Um script com o padrão do SIGPIPE (o defeto do OUTRO fixer). */
const SCRIPT_COM_PADRAO = [
  "#!/usr/bin/env bash",
  "set -euo pipefail",
  'echo "$OUT" | grep -q alfa',
  "",
].join("\n")

/** O resultado sintético do `remedyPatch` do fixer do SIGPIPE. */
function resultadoSigpipeB(over: Record<string, unknown> = {}) {
  return {
    patch:
      '--- a/caso.sh\n+++ b/caso.sh\n@@ -4,4 +4,4 @@\n-echo "$OUT" | grep -q alfa\n+grep -q alfa <<< "$OUT"\n',
    fixed: [
      {
        file: "caso.sh",
        line: 3,
        before: 'echo "$OUT" | grep -q alfa',
        after: 'grep -q alfa <<< "$OUT"',
      },
    ],
    refused: [],
    recusados: [],
    shellFailures: [],
    embeddedFailures: [],
    payloadFailures: [],
    unread: [],
    yamlInvalido: [],
    indisponivel: null,
    ...over,
  }
}

const CICATRIZ = [
  "name: Fixture",
  "on: [push]",
  "jobs:",
  "  x:",
  "    runs-on: ubuntu-latest",
  "    steps:",
  "      - run: |",
  "          echo hello &&",
]

describe("o corpo do comentário", () => {
  it("sem remendo não há corpo — e `null` é o sinal de RETIRAR, não de nada a fazer", () => {
    expect(remedyBody(resultado({ patch: "", fixed: [] }))).toBeNull()
  })

  it("carrega o marcador, o patch exato e o bloco de aplicação (copiar → colar aplica)", () => {
    const body = remedyBody(resultado())
    expect(body).toContain(MARKER)
    expect(body).toContain("```bash\ngit apply - <<'REMEDY_PATCH'")
    expect(body).toContain("--- a/.github/workflows/ci.yml")
    expect(body).toContain("\nREMEDY_PATCH\n```")
    expect(body).toContain("`remedyPatch`")
    expect(body).toContain("NÃO reconstrói a linha")
  })

  it("as RECUSAS entram com o motivo; o excedente do teto é CONTADO, nunca omitido", () => {
    const recusas = Array.from({ length: MAX_REFUSED + 3 }, (_, i) => ({
      file: ".github/workflows/ci.yml",
      line: 40 + i,
      reason: "heredoc no corpo: o texto do heredoc é DADO",
    }))
    const body = remedyBody(resultado({ refused: recusas })) ?? ""
    expect(body).toContain(`NÃO cobre (${recusas.length} recusa(s))`)
    expect(body).toContain("heredoc no corpo")
    expect(body).toContain("e mais **3** caso(s)")
    expect(body.split("heredoc no corpo").length - 1).toBe(MAX_REFUSED)
  })

  it("violações que não são cicatriz aparecem numa seção própria", () => {
    const body =
      remedyBody(
        resultado({ shellFailures: [{ file: "scripts/x.sh", line: 3, error: "erro de sintaxe" }] }),
      ) ?? ""
    expect(body).toContain("NÃO são cicatriz remendável (1)")
    expect(body).toContain("`scripts/x.sh:3 — erro de sintaxe`")
  })
})

describe("a decisão (pura)", () => {
  it("as quatro respostas", () => {
    expect(decideComment({ hasPrevious: false, body: "x" })).toBe("create")
    expect(decideComment({ hasPrevious: true, previousBody: "x", body: "y" })).toBe("update")
    expect(decideComment({ hasPrevious: true, previousBody: "x", body: "x" })).toBe("noop")
    expect(decideComment({ hasPrevious: true, previousBody: "x", body: null })).toBe("remove")
    expect(decideComment({ hasPrevious: false, body: null })).toBe("noop")
  })
})

describe("o ciclo de reconciliação (API dublê)", () => {
  it("cria na 1ª run, não repete na 2ª, atualiza na 3ª e RETIRA na 4ª", async () => {
    const api = fakeApi()
    const base = { request: api.request, config: {}, kind: "github", pr: 7 }
    const corpo = remedyBody(resultado()) ?? ""

    const r1 = await reconcileRemedy({ ...base, body: corpo })
    expect(r1.action).toBe("created")
    expect(api.comments).toHaveLength(1)

    const r2 = await reconcileRemedy({ ...base, body: corpo })
    expect(r2.action).toBe("noop")
    expect(api.comments).toHaveLength(1)
    expect(api.calls.filter((c) => c.method !== "GET")).toHaveLength(1)

    const corpoNovo = corpo.replace("echo hello", "echo outro")
    const r3 = await reconcileRemedy({ ...base, body: corpoNovo })
    expect(r3.action).toBe("updated")
    expect(api.comments).toHaveLength(1)
    expect(api.comments[0].body).toContain("echo outro")

    const r4 = await reconcileRemedy({ ...base, body: null })
    expect(r4.action).toBe("removed")
    expect(api.comments).toHaveLength(0)

    const r5 = await reconcileRemedy({ ...base, body: null })
    expect(r5.action).toBe("noop")
  })

  it("dois comentários nossos (runs concorrentes) — o resíduo é RETIRADO", async () => {
    const api = fakeApi()
    api.comments.push(
      { id: 91, body: `${MARKER}\nvelho` },
      { id: 92, body: `${MARKER}\nmais velho` },
    )
    const out = await reconcileRemedy({
      request: api.request,
      config: {},
      kind: "gitea",
      pr: 3,
      body: remedyBody(resultado()) ?? "",
    })
    expect(out.action).toBe("updated")
    expect(api.comments.map((c) => c.id)).toEqual([91])
  })

  it("o canal que EXISTE e recusa (5xx) é erro; o 403 é canal SEM ESCRITA (aviso)", async () => {
    const quebrado = fakeApi({ failMethod: "POST" })
    await expect(
      reconcileRemedy({ request: quebrado.request, config: {}, kind: "github", pr: 1, body: "x" }),
    ).rejects.toThrow(/HTTP 500/)

    const semEscrita = fakeApi({ deny: true })
    semEscrita.comments.push({ id: 5, body: `${MARKER}\nvelho` })
    await expect(
      reconcileRemedy({
        request: semEscrita.request,
        config: {},
        kind: "github",
        pr: 1,
        body: null,
      }),
    ).rejects.toBeInstanceOf(ChannelDenied)
  })
})

describe("o canal e o PR resolvidos do ambiente", () => {
  it("--backend manda; sem ele a presença do token decide; sem nenhum, o motivo NOMEIA as variáveis", () => {
    expect(selectBackend({ flag: "gitea" }).backend).toBe("gitea")
    expect(selectBackend({ flag: "github" }).backend).toBe("github")
    expect(selectBackend({ env: { GITEA_TOKEN: "t" } }).backend).toBe("gitea")
    expect(selectBackend({ env: { GH_TOKEN: "t" } }).backend).toBe("github")
    const nada = selectBackend({ env: {} })
    expect(nada.backend).toBeNull()
    expect(nada.why).toContain("GITEA_TOKEN/GH_TOKEN")
  })

  it("o número do PR: --pr, PR_NUMBER, o payload do evento e o GITHUB_REF", () => {
    expect(prNumberFrom({ flag: "12" })).toBe(12)
    expect(prNumberFrom({ env: { PR_NUMBER: "34" }, flag: null })).toBe(34)
    const payload = join(mkdtempSync(join(tmpdir(), "pr-payload-")), "event.json")
    writeFileSync(payload, JSON.stringify({ pull_request: { number: 56 } }), "utf8")
    expect(prNumberFrom({ env: { GITHUB_EVENT_PATH: payload }, flag: null })).toBe(56)
    expect(prNumberFrom({ env: { GITHUB_REF: "refs/pull/78/merge" }, flag: null })).toBe(78)
    expect(prNumberFrom({ env: {}, flag: null })).toBeNull()
  })

  it("o GitHub exige o canal de API (token + repo): sem eles, o motivo é nomeado", () => {
    const semToken = backendChannel("github", { env: {} })
    expect("unavailable" in semToken && semToken.unavailable).toContain("GH_TOKEN")
    const comToken = backendChannel("github", { env: { GH_TOKEN: "t", GH_REPOSITORY: "o/r" } })
    expect("config" in comToken && comToken.kind).toBe("github")
    const gitea = backendChannel("gitea", {
      env: { GITEA_TOKEN: "t", GITEA_URL: "https://g", GITEA_REPOSITORY: "o/r" },
    })
    expect("config" in gitea && gitea.kind).toBe("gitea")
  })
})

describe("a CLI", () => {
  function runCli(args: string[]): { status: number | null; stdout: string; stderr: string } {
    const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" })
    return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" }
  }

  it("--dry-run imprime o corpo e a decisão, sem tocar a API nem exigir token", () => {
    const dir = writeFixture(CICATRIZ)
    const out = runCli(["--dry-run", "--root", dir])
    expect(out.status).toBe(EXIT.OK)
    expect(out.stdout).toContain(MARKER)
    expect(out.stdout).toContain("git apply - <<'REMEDY_PATCH'")
    expect(out.stderr).toContain("a API não foi tocada")
  })

  it("numa árvore limpa o dry-run diz que o comentário seria RETIRADO", () => {
    const dir = writeFixture([
      "name: Fixture",
      "on: [push]",
      "jobs:",
      "  x:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - run: echo ok",
    ])
    const out = runCli(["--dry-run", "--root", dir])
    expect(out.status).toBe(EXIT.OK)
    expect(out.stdout).toContain("seria retirado")
  })

  it("uso inválido: --backend desconhecido e --pr sem número", () => {
    expect(runCli(["--backend", "warp"]).status).toBe(EXIT.USAGE)
    expect(runCli(["--pr", "abc"]).status).toBe(EXIT.USAGE)
    expect(runCli(["--nada"]).status).toBe(EXIT.USAGE)
  })

  it("uso inválido MESMO COM payload de PR no ambiente: o fallback do prNumberFrom não valida a flag", () => {
    // Medido na forja (runs 33-38): com o GITHUB_EVENT_PATH REAL de um
    // pull_request, o `--pr abc` caía no fallback do `prNumberFrom`, "resolvia"
    // o PR do payload e o uso inválido saía VERDE (exit 0 em vez de USAGE) —
    // o passo publicaria num PR que ninguém leu. O julgamento de uso é SÓ
    // sobre a flag; o ambiente resolve o PR de quem NÃO passou flag.
    const payload = join(mkdtempSync(join(tmpdir(), "pr-payload-")), "event.json")
    writeFileSync(payload, JSON.stringify({ pull_request: { number: 1 } }), "utf8")
    const r = spawnSync(process.execPath, [SCRIPT, "--pr", "abc"], {
      encoding: "utf8",
      env: { ...process.env, GITHUB_EVENT_PATH: payload, PR_NUMBER: "1" },
    })
    expect(r.status).toBe(EXIT.USAGE)
  })

  it("sem canal (sem token) o passo NÃO falha: o GATE é o veredito, e a ausência é DITA", () => {
    const dir = writeFixture(CICATRIZ)
    const out = runCli(["--root", dir])
    expect(out.status).toBe(EXIT.OK)
    expect(out.stderr).toContain("::notice::")
    expect(out.stderr).toContain("GITEA_TOKEN/GH_TOKEN")
  })

  it("--fixer escolhe o DEFEITO: o corpo do SIGPIPE é o dele, e o default não mudou", () => {
    const dir = writeFixture(CICATRIZ)
    const padrao = runCli(["--dry-run", "--root", dir])
    expect(padrao.stdout).toContain(FIXERS["run-syntax"].marker)

    // O MESMO diretório, o outro fixer: o corpo muda de gate, de prosa e de
    // marcador — e o dry-run continua sem tocar a API.
    const dirPipe = writeFixture(CICATRIZ, { arquivo: "caso.sh", corpo: SCRIPT_COM_PADRAO })
    const out = runCli(["--fixer", "pipefail-sigpipe", "--dry-run", "--root", dirPipe])
    expect(out.status).toBe(EXIT.OK)
    expect(out.stdout).toContain(FIXERS["pipefail-sigpipe"].marker)
    expect(out.stdout).toContain("Pipefail x grep quieto (SIGPIPE)")
    expect(out.stdout).toContain("check-pipefail-sigpipe.mjs --fix")
    expect(out.stdout).not.toContain(FIXERS["run-syntax"].marker)
  })

  it("--fixer desconhecido é erro de USO (cair no default publicaria o gate errado)", () => {
    const out = runCli(["--fixer", "pipefail", "--dry-run"])
    expect(out.status).toBe(EXIT.USAGE)
    expect(out.stderr).toContain("fixer desconhecido: pipefail")
    expect(out.stderr).toContain("run-syntax, pipefail-sigpipe")
  })
})

// ── o registro de fixers: dois remédios, um canal ────────────────────────

describe("o registro de fixers", () => {
  it("cada fixer tem o SEU marcador, e o default é o do `bash -n`", () => {
    expect(Object.keys(FIXERS).sort()).toEqual(["doc-hashes", "pipefail-sigpipe", "run-syntax"])
    expect(DEFAULT_FIXER).toBe("run-syntax")
    expect(MARKER).toBe(FIXERS["run-syntax"].marker)
    const marcadores = Object.values(FIXERS).map((f) => f.marker)
    expect(new Set(marcadores).size).toBe(marcadores.length)
  })

  it("`fixerOf` LANÇA com os ids válidos (um id errado não pode virar o default)", () => {
    expect(fixerOf("run-syntax").gateJob).toBe(GATE_JOB)
    expect(fixerOf("pipefail-sigpipe").gateJob).toBe("Pipefail x grep quieto (SIGPIPE)")
    expect(() => fixerOf("nao-existe")).toThrow(/fixer desconhecido: nao-existe \(válidos: /)
  })

  it("os dois fixers medem pela RÉGUA deles (o `medir` não é um só)", () => {
    // A medição do SIGPIPE lê o padrão do gate de SIGPIPE; a do `bash -n`, a
    // cicatriz dos corpos `run:`. Um registro com o medidor trocado publicaria o
    // remendo de um gate no comentário do outro — medido no repositório real:
    // cada um devolve a SUA forma, com todos os campos do contrato.
    for (const f of Object.values(FIXERS)) {
      const r = f.medir(process.cwd())
      for (const campo of FORMA_DO_RESULTADO) expect(Object.keys(r)).toContain(campo)
      expect(r.patch).toBe("")
    }
  })
})

describe("o corpo do fixer do SIGPIPE", () => {
  const resultadoSigpipe = () =>
    resultadoSigpipeB({
      refused: [{ file: "vivo.sh", line: 9, reason: "produtor vivo: captura em $()" }],
    })

  it("carrega o marcador DELE, o nome do gate e o comando do fixer", () => {
    const body = corpoDoFixer("pipefail-sigpipe", resultadoSigpipeB()) ?? ""
    expect(body).toContain(FIXERS["pipefail-sigpipe"].marker)
    expect(body).toContain("Pipefail x grep quieto (SIGPIPE)")
    expect(body).toContain("node scripts/check-pipefail-sigpipe.mjs --fix")
    expect(body).toContain("git apply - <<'REMEDY_PATCH'")
    expect(body).toContain("SIGPIPE")
    // A linha do arquivo vem do `line` (é o campo que o `fixAll` do gate tem).
    expect(body).toContain("caso.sh:3")
    // E NÃO carrega o marcador do irmão (senão a reconciliação de um retiraria
    // o comentário do outro).
    expect(body).not.toContain(FIXERS["run-syntax"].marker)
  })

  it("sem remendo não há corpo — o sinal de RETIRAR vale para os dois fixers", () => {
    expect(corpoDoFixer("pipefail-sigpipe", resultadoSigpipeB({ patch: "", fixed: [] }))).toBeNull()
  })

  it("as RECUSAS entram com o motivo DESTE fixer (um comentário que só mostrasse o patch mentiria pelo que omite)", () => {
    // A metade honesta: o patch cobre o caso MECÂNICO, e o `| grep -q` cujo
    // produtor é um comando VIVO (que o fixer recusa de propósito, porque
    // capturar a saída dele mudaria a semântica) tem de aparecer nomeado. A
    // prosa é a do fixer do SIGPIPE — não a do `bash -n`.
    const body = corpoDoFixer("pipefail-sigpipe", resultadoSigpipe()) ?? ""
    expect(body).toContain("### O que este comentário NÃO cobre (1 recusa(s))")
    expect(body).toContain(FIXERS["pipefail-sigpipe"].naoCobre.split("\n")[0])
    expect(body).toContain("| `vivo.sh:9` | produtor vivo: captura em $() |")
    expect(body).not.toContain(FIXERS["run-syntax"].naoCobre.split("\n")[0])
  })
})

describe("dois fixers no MESMO PR — cada comentário é reconciliado pelo seu marcador", () => {
  it("o do SIGPIPE nasce, atualiza e some SEM tocar no comentário do `bash -n`", async () => {
    const api = fakeApi()
    const base = { request: api.request, config: {}, kind: "github", pr: 11 }
    const corpoA = remedyBody(resultado()) ?? ""
    const corpoB = corpoDoFixer("pipefail-sigpipe", resultadoSigpipeB()) ?? ""

    const a1 = await reconcileRemedy({ ...base, body: corpoA, marker: FIXERS["run-syntax"].marker })
    const b1 = await reconcileRemedy({
      ...base,
      body: corpoB,
      marker: FIXERS["pipefail-sigpipe"].marker,
    })
    expect([a1.action, b1.action]).toEqual(["created", "created"])
    expect(api.comments).toHaveLength(2)

    // O SIGPIPE conserta (corpo novo) → ATUALIZA o dele; o irmão não é tocado.
    const b2 = await reconcileRemedy({
      ...base,
      body: corpoB.replace("@@ -4,4", "@@ -5,4"),
      marker: FIXERS["pipefail-sigpipe"].marker,
    })
    expect(b2.action).toBe("updated")
    expect(api.comments).toHaveLength(2)
    expect(api.comments.filter((c) => c.body.includes(FIXERS["run-syntax"].marker))).toHaveLength(1)

    // O SIGPIPE SOME (sem remendo) → RETIRA o dele e deixa o outro aberto.
    const b3 = await reconcileRemedy({
      ...base,
      body: null,
      marker: FIXERS["pipefail-sigpipe"].marker,
    })
    expect(b3.action).toBe("removed")
    expect(api.comments).toHaveLength(1)
    expect(api.comments[0].body).toContain(FIXERS["run-syntax"].marker)
  })

  it("sem `marker` o default é o do `bash -n` (o contrato de quem já usava o módulo)", async () => {
    const api = fakeApi()
    api.comments.push({ id: 3, body: `${FIXERS["pipefail-sigpipe"].marker}\nalheio` })
    const out = await reconcileRemedy({
      request: api.request,
      config: {},
      kind: "github",
      pr: 5,
      body: remedyBody(resultado()) ?? "",
    })
    // O comentário do OUTRO fixer não é o anterior deste: ele fica onde está.
    expect(out.action).toBe("created")
    expect(api.comments).toHaveLength(2)
  })
})

// ── o canal DERIVADO do registro: `--all` ────────────────────────────────
//
// O conjunto de fixers NÃO pode vir da linha de comando das pipelines: se viesse,
// o fixer novo dependeria de alguém lembrar de editar DOIS workflows (e da
// sincronia entre eles). O que se mede aqui é o outro lado disso — o `--all`
// publica TODO o registro, cada fixer com o SEU marcador, e um fixer que não
// publica não impede os outros (a rodada termina com o PIOR desfecho, depois de
// todos terem sido tentados).

describe("o canal publica o REGISTRO inteiro (--all)", () => {
  /** Um `fetch` dublê da API do GitHub, com falha opcional por corpo postado. */
  function fakeGithubFetch({ failPostQuando }: { failPostQuando?: string } = {}) {
    const comments: { id: number; body: string }[] = []
    const chamadas: string[] = []
    let nextId = 1
    const fetchImpl = async (url: string, init: { method?: string; body?: string } = {}) => {
      const method = init.method ?? "GET"
      const path = String(url).split("/repos/o/r")[1] ?? ""
      chamadas.push(`${method} ${path.split("?")[0]}`)
      const respond = (status: number, data: unknown) => ({
        status,
        text: async () => (data === null ? "" : JSON.stringify(data)),
      })
      if (method === "GET")
        return respond(
          200,
          comments.map((c) => ({ ...c })),
        )
      if (method === "POST") {
        const corpo = String(JSON.parse(init.body ?? "{}").body ?? "")
        if (failPostQuando && corpo.includes(failPostQuando))
          return respond(500, { message: "boom" })
        const id = nextId++
        comments.push({ id, body: corpo })
        return respond(201, { id })
      }
      const id = Number.parseInt(path.split("/").pop() ?? "", 10)
      if (method === "PATCH") {
        const found = comments.find((c) => c.id === id)
        if (!found) return respond(404, null)
        found.body = String(JSON.parse(init.body ?? "{}").body ?? "")
        return respond(200, { id })
      }
      if (method === "DELETE") {
        const i = comments.findIndex((c) => c.id === id)
        if (i === -1) return respond(404, null)
        comments.splice(i, 1)
        return respond(204, null)
      }
      return respond(500, null)
    }
    return { fetchImpl, comments, chamadas }
  }

  /**
   * OS TRÊS defeitos no mesmo diretório: cada fixer do REGISTRO tem o que
   * remendar. E o fixture é um repositório git DE VERDADE, com HISTÓRIA — a
   * régua do `doc-hashes` é o GRAFO, então uma citação órfã só existe contra uma
   * história: sem `HEAD` o fixer mais novo mede INDETERMINADO, o `--all` publica
   * dois de três e a suíte passaria a testemunhar um canal menor do que o do CI.
   */
  function fixtureComOsTresDefeitos() {
    const dir = writeFixture(CICATRIZ, { arquivo: "caso.sh", corpo: SCRIPT_COM_PADRAO })
    // O BASE commitado e o PAR da rewrite vêm do helper COMPARTILHADO com as
    // suítes do guard e do remédio: o hash citado sai comprovadamente uma citação
    // (sem letra `a-f` um hash de 7 dígitos não é citação, e o fixer do `doc-hashes`
    // mediria o vazio sem que nenhuma asserção visse).
    garantirRepoComBase(dir)
    const { orfao } = criarParDeReescrita(dir)
    // A prosa cita o nome MORTO: o defeito que o canal do `doc-hashes` publica.
    writeFileSync(join(dir, "README.md"), `o ato foi no \`${orfao}\`\n`, "utf8")
    return dir
  }

  const ENV_GITHUB = { GH_TOKEN: "t", GH_REPOSITORY: "o/r" }
  const silencio = () => {}

  /** O CLI de verdade, num processo próprio (o do `--fixer` também serve). */
  function runCli(args: string[]) {
    const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" })
    return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" }
  }

  it("publica UM comentário por fixer do registro, cada um com o SEU marcador", async () => {
    const api = fakeGithubFetch()
    const real = globalThis.fetch
    globalThis.fetch = api.fetchImpl as unknown as typeof fetch
    try {
      const dir = fixtureComOsTresDefeitos()
      const saidas = []
      for (const id of Object.keys(FIXERS)) {
        saidas.push(
          await publicarFixer({
            fixerId: id,
            root: dir,
            env: ENV_GITHUB,
            prFlag: "12",
            out: silencio,
            err: silencio,
          }),
        )
      }

      // Um comentário por fixer — e o texto de cada um é o do SEU canal.
      expect(api.comments).toHaveLength(Object.keys(FIXERS).length)
      const corpos = api.comments.map((c) => c.body)
      for (const [id, fixer] of Object.entries(FIXERS)) {
        const meus = corpos.filter((b) => b.includes(fixer.marker))
        expect(meus, `marcador do fixer ${id}`).toHaveLength(1)
      }
      // Nenhum comentário carrega dois marcadores (a reconciliação de um não
      // pode alcançar o comentário do outro).
      for (const corpo of corpos) {
        expect(Object.values(FIXERS).filter((f) => corpo.includes(f.marker))).toHaveLength(1)
      }
      for (const s of saidas) expect(s.desfecho).toBe("publicado")
    } finally {
      globalThis.fetch = real
    }
  })

  it("um fixer que NÃO publica não impede os outros — e a rodada cobra o pior desfecho", async () => {
    const ids = Object.keys(FIXERS) as (keyof typeof FIXERS)[]
    const ultimo = ids[ids.length - 1]
    const api = fakeGithubFetch({ failPostQuando: FIXERS[ultimo].marker })
    const real = globalThis.fetch
    globalThis.fetch = api.fetchImpl as unknown as typeof fetch
    try {
      const dir = fixtureComOsTresDefeitos()
      const saidas = []
      for (const id of Object.keys(FIXERS)) {
        saidas.push(
          await publicarFixer({
            fixerId: id,
            root: dir,
            env: ENV_GITHUB,
            prFlag: "12",
            out: silencio,
            err: silencio,
          }),
        )
      }

      const porFixer = Object.fromEntries(saidas.map((s) => [s.resumo.fixer, s]))
      expect(porFixer[ultimo].desfecho).toBe("quebrado")
      expect(porFixer[ultimo].exit).toBe(EXIT.UNPUBLISHED)
      // Os OUTROS fixers PUBLICARAM (todos, não só um): o ciclo não abortou no
      // primeiro erro — o número sai do REGISTRO, e não de uma contagem à mão que
      // um fixer novo faça envelhecer.
      for (const outroId of ids.filter((id) => id !== ultimo)) {
        expect(porFixer[outroId].desfecho, `${outroId} não publicou`).toBe("publicado")
      }
      expect(api.comments).toHaveLength(ids.length - 1)
      // E o canal quebrou DEPOIS de tentar (o POST do último foi feito).
      expect(api.chamadas.some((c) => c.startsWith("POST"))).toBe(true)
    } finally {
      globalThis.fetch = real
    }
  })

  it("`--fixer` continua publicando UM só (o default do canal não mudou)", async () => {
    const api = fakeGithubFetch()
    const real = globalThis.fetch
    globalThis.fetch = api.fetchImpl as unknown as typeof fetch
    try {
      const dir = fixtureComOsTresDefeitos()
      const saida = await publicarFixer({
        fixerId: "pipefail-sigpipe",
        root: dir,
        env: ENV_GITHUB,
        prFlag: "12",
        out: silencio,
        err: silencio,
      })
      expect(saida.desfecho).toBe("publicado")
      expect(api.comments).toHaveLength(1)
      expect(api.comments[0].body).toContain(FIXERS["pipefail-sigpipe"].marker)
    } finally {
      globalThis.fetch = real
    }
  })

  it("o `--all` do CLI percorre o REGISTRO (dry-run: um corpo por fixer, na ordem do registro)", () => {
    const dir = fixtureComOsTresDefeitos()
    const out = runCli(["--all", "--dry-run", "--root", dir])
    expect(out.status).toBe(EXIT.OK)
    for (const fixer of Object.values(FIXERS)) expect(out.stdout).toContain(fixer.marker)
    // A ordem do relatório é a do REGISTRO, não a de uma lista escrita à mão.
    const posicoes = Object.values(FIXERS).map((f) => out.stdout.indexOf(f.marker))
    expect(posicoes).toEqual([...posicoes].sort((a, b) => a - b))
    expect(out.stdout).toContain(`${Object.keys(FIXERS).length} fixer(s) do registro`)
  })

  it("sem canal, o `--all` não falha e DIZ por fixer (o GATE é o veredito)", () => {
    const dir = fixtureComOsTresDefeitos()
    const out = runCli(["--all", "--root", dir])
    expect(out.status).toBe(EXIT.OK)
    const notices = out.stderr.split("::notice::").length - 1
    expect(notices).toBe(Object.keys(FIXERS).length)
    expect(out.stdout).toContain("indeterminado(s)")
  })

  it("`--all` E `--fixer` juntos são uso inválido (um escolhe o defeito, o outro publica o registro)", () => {
    const out = runCli(["--all", "--fixer", "run-syntax", "--dry-run"])
    expect(out.status).toBe(EXIT.USAGE)
    expect(out.stderr).toContain("--all publica TODOS os fixers")
  })
})
