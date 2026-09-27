// =============================================================================
// prove-forge-smoke-ephemeral.test.ts
//
// Testes do scripts/prove-forge-smoke-ephemeral.mjs — o ensaio que roda o smoke
// da forja contra um act_runner EFÊMERO (compose de teste, volumes e porta
// próprios) sem tocar a instância de produção.
//
// O que precisa ser provado (e é o ponto todo):
//   1. o GATILHO acrescentado é a ÚNICA diferença entre o workflow empurrado e o
//      comitado — e a asserção que confere isso MORDE quando algo mais mudou;
//   2. as EXPECTATIVAS são DERIVADAS do próprio smoke (passos, `✅` e mensagens
//      de falha): um `✅` que ninguém imprime deixa de ser exigido, mas um passo
//      que não rodou ou um `::error::` que apareceu viram violação DIZENDO qual;
//   3. o veredito da tarefa distingue TERMINAL de \"ainda não terminou\" (só 1 e 2
//      decidem), e a leitura do banco não inventa resultado com saída vazia ou
//      ilegível;
//   4. o override do compose é o mínimo para ser efêmero (volumes, nome do
//      container do Gitea, porta local) — e NÃO toca em labels/imagens;
//   5. a remoção do hardening é cirúrgica e verificada (e a asserção morde);
//   6. o config do runner é o MÍNIMO que tira o job da rede por job
//      (`container.network`), e o override só pede o arquivo quando o ensaio o
//      semeia no volume — o ensaio que não semeia não pode receber a env;
//   7. a SEGURANÇA de produção bloqueia antes de subir nada — e o teardown é
//      reportado, nunca presumido (host que recusa parar container).
//
// SEM docker e SEM a forja no ar: o `run` é injetado. O único teste que toca o
// repositório real lê `deploy/docker-compose.gitea.yml` e o workflow comitado.
// =============================================================================

import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import {
  DEFAULT_ENV_FILE,
  GITEA_SERVICE,
  GROUP_MARKER,
  MUTATION_LABEL_NAME,
  PROJECT_PREFIX,
  REPO_ROOT,
  RUN_MARKER,
  RUNNER_CONFIG_PATH,
  RUNNER_SERVICE,
  SENTINELA_BRANCH,
  SENTINELA_MARKER,
  SMOKE_BRANCH,
  SMOKE_WORKFLOW,
  addPushTrigger,
  assertOnlyAddition,
  assertOnlyRemoval,
  classifyTaskStatus,
  ephemeralEnvFile,
  evaluateSmokeLog,
  exitCodeFor,
  parseActionTasks,
  parseArgs,
  prepareSmokeWorkflow,
  readDbfsLog,
  readTaskLog,
  renderOverrideCompose,
  renderRunnerConfig,
  removeContainers,
  safetyBlocker,
  sentinelWorkflow,
  smokeExpectations,
  stripRunnerHardening,
} from "../../../scripts/prove-forge-smoke-ephemeral.mjs"

const COMPOSE_TEXT = readFileSync(join(REPO_ROOT, "deploy/docker-compose.gitea.yml"), "utf8")
const SMOKE_TEXT = readFileSync(join(REPO_ROOT, SMOKE_WORKFLOW), "utf8")
const ENV_TEXT = readFileSync(join(REPO_ROOT, DEFAULT_ENV_FILE), "utf8")

/** Um `run` dublê que responde por comando (chave: \"cmd arg1 arg2\"). */
function fakeRun(responses: Record<string, { status?: number; stdout?: string; stderr?: string }>) {
  const calls: string[][] = []
  const run = (command: string, args: string[]) => {
    calls.push([command, ...args])
    const key = [command, ...args].join(" ")
    const found = Object.entries(responses).find(([pattern]) => key.startsWith(pattern))
    const res = found?.[1] ?? { status: 1, stdout: "", stderr: "sem resposta" }
    return {
      status: res.status ?? 0,
      stdout: res.stdout ?? "",
      stderr: res.stderr ?? "",
      error: null,
    }
  }
  return { run, calls }
}

describe("addPushTrigger — o gatilho é acrescentado, não trocado", () => {
  it("insere `push` com o branch do ensaio logo depois do `on:`, preservando o dispatch", () => {
    const text = "name: x\non:\n  workflow_dispatch:\njobs:\n  a:\n    runs-on: ubuntu-latest\n"
    const out = addPushTrigger(text, { branch: SMOKE_BRANCH })
    expect(out.ok).toBe(true)
    expect(out.added).toEqual(["  push:", `    branches: [${SMOKE_BRANCH}]`])
    expect(out.text).toBe(
      `name: x\non:\n${out.added.join("\n")}\n  workflow_dispatch:\njobs:\n  a:\n    runs-on: ubuntu-latest\n`,
    )
    expect(assertOnlyAddition(text, out.text as string, out.added)).toEqual({
      ok: true,
      detail: "a única diferença são 2 linha(s) de gatilho",
    })
  })

  it("recusa um workflow sem bloco `on:` de nível raiz (não inventa YAML)", () => {
    const out = addPushTrigger("name: x\njobs:\n  a:\n    runs-on: ubuntu-latest\n")
    expect(out.ok).toBe(false)
    expect(out.text).toBeNull()
    expect(out.detail).toContain("não tem um bloco `on:`")
  })

  it("recusa sobrescrever um `push:` já declarado", () => {
    const out = addPushTrigger("on:\n  push:\n    branches: [main]\n  workflow_dispatch:\n")
    expect(out.ok).toBe(false)
    expect(out.detail).toContain("já tem um gatilho `push:`")
  })

  it("a asserção MORDE quando algo além do gatilho mudou", () => {
    const original = "on:\n  workflow_dispatch:\n"
    const added = ["  push:", "    branches: [prova/smoke]"]
    const modified = `on:\n${added.join("\n")}\n  workflow_dispatch:\n      # linha intrusa\n`
    const check = assertOnlyAddition(original, modified, added)
    expect(check.ok).toBe(false)
    expect(check.detail).toContain("empurrado")
  })
})

describe("sentinelWorkflow — o controle negativo do canal", () => {
  it("declara o branch próprio, um passo que falha e o marcador verificável", () => {
    const text = sentinelWorkflow({ branch: SENTINELA_BRANCH })
    expect(text).toContain(`branches: [${SENTINELA_BRANCH}]`)
    expect(text).toContain("exit 1")
    expect(text).toContain(SENTINELA_MARKER)
    expect(text).toContain("runs-on: ubuntu-latest")
    // O branch da SENTINELA não pode ser o mesmo do smoke: um push acenderia os dois.
    expect(SENTINELA_BRANCH).not.toBe(SMOKE_BRANCH)
  })
})

describe("renderOverrideCompose — só o que precisa ser efêmero", () => {
  const override = renderOverrideCompose({
    project: "prova-forge-smoke-abc",
    port: 34567,
    volumeKeys: ["gitea-data", "runner-data", "caddy-data", "caddy-config", "caddy-logs"],
  })

  it("renomeia TODOS os volumes declarados (nenhuma escrita nos da produção)", () => {
    for (const key of ["gitea-data", "runner-data", "caddy-data", "caddy-config", "caddy-logs"]) {
      expect(override).toContain(`  ${key}:\n    name: prova-forge-smoke-abc-${key}`)
    }
  })

  it("dá porta local ao Gitea e renomeia SÓ o container do Gitea", () => {
    expect(override).toContain("127.0.0.1:34567:3000")
    expect(override).toContain(
      `  ${GITEA_SERVICE}:\n    container_name: prova-forge-smoke-abc-gitea`,
    )
    // O runner NÃO é renomeado: a Prova 5 o procura pelo nome declarado.
    expect(override).not.toContain(`  ${RUNNER_SERVICE}:`)
  })

  it("não redeclara labels nem imagem (esses vêm do compose da forja)", () => {
    expect(override).not.toContain("GITEA_RUNNER_LABELS")
    expect(override).not.toContain("image:")
  })

  it("com `runnerConfigPath`, pede o CONFIG_FILE — e o default NÃO toca no runner", () => {
    const withConfig = renderOverrideCompose({
      project: "prova-forge-smoke-abc",
      port: 34567,
      volumeKeys: ["runner-data"],
      runnerConfigPath: RUNNER_CONFIG_PATH,
    })
    expect(withConfig).toContain(
      `  ${RUNNER_SERVICE}:\n    environment:\n      - CONFIG_FILE=${RUNNER_CONFIG_PATH}`,
    )
    // A env é OPT-IN: quem não semeia o arquivo no volume não pode recebê-la (o
    // `run.sh` passaria `--config` para um arquivo inexistente e o `register`
    // morreria com o runner fora do ar).
    expect(override).not.toContain(`  ${RUNNER_SERVICE}:`)
  })
})

describe("renderRunnerConfig — o config que o runner efêmero lê", () => {
  it("declara SÓ o container.network: o resto é o default do binário", () => {
    const text = renderRunnerConfig({ network: "prova-forge-smoke-abc_gitea-net" })
    expect(text).toContain("container:\n  network: prova-forge-smoke-abc_gitea-net\n")
    // Um segundo campo aqui seria uma SEGUNDA declaração de default (capacity,
    // timeout, cache, docker_host…) que o `LoadDefault` do binário já preenche —
    // e é o docker_host vazio (default) que MONTA o socket no job e faz a
    // Prova 5 existir.
    const topLevel = text.split("\n").filter((line) => /^[A-Za-z_][A-Za-z0-9_-]*:/.test(line))
    expect(topLevel).toEqual(["container:"])
  })
})

describe("ephemeralEnvFile — o template comitado, com o token trocado", () => {
  it("troca SÓ o RUNNER_TOKEN e preserva a fonte única da versão", () => {
    const out = ephemeralEnvFile(ENV_TEXT, { token: "tok-123" })
    expect(out.replaced).toBe(true)
    expect(out.text).toContain("RUNNER_TOKEN=tok-123")
    expect(out.text).not.toContain("COLE_O_TOKEN_AQUI")
    for (const line of ENV_TEXT.split("\n")) {
      if (/^\s*RUNNER_TOKEN\s*=/.test(line)) continue
      expect(out.text).toContain(line)
    }
  })

  it("reporta quando o template NÃO declara RUNNER_TOKEN (não finge que trocou)", () => {
    const out = ephemeralEnvFile("BUN_VERSION=1.3.14\n", { token: "tok" })
    expect(out.replaced).toBe(false)
  })
})

describe("stripRunnerHardening — a remoção cirúrgica do hardening (opt-in)", () => {
  it("remove o `security_opt` do serviço runner, e NADA mais", () => {
    const out = stripRunnerHardening(COMPOSE_TEXT)
    expect(out.ok).toBe(true)
    expect(out.removal?.lines).toEqual(["    security_opt:", "      - no-new-privileges:true"])
    // o alvo é o RUNNER (o compose tem security_opt em três serviços)
    const runnerAt = COMPOSE_TEXT.split("\n").findIndex((l) => l === `  ${RUNNER_SERVICE}:`)
    expect(out.removal?.at).toBeGreaterThan(runnerAt)
    const check = assertOnlyRemoval(COMPOSE_TEXT, out.text as string, out.removal as never)
    expect(check.ok).toBe(true)
    // O compose tem `security_opt` em mais de um serviço: o ensaio remove o do
    // runner e deixa os outros INTACTOS (casar por conteúdo acertaria o alvo errado).
    const count = (text: string) => text.split("\n").filter((l) => l === "    security_opt:").length
    expect(count(COMPOSE_TEXT)).toBeGreaterThan(count(out.text as string))
    expect(count(out.text as string)).toBe(count(COMPOSE_TEXT) - 1)
  })

  it("a asserção MORDE quando o texto gerado mudou outra coisa", () => {
    const out = stripRunnerHardening(COMPOSE_TEXT)
    // A agulha sai do PRÓPRIO texto (a linha da imagem do runner), nunca de um
    // literal: cravar `gitea/act_runner:latest` aqui deixou este teste VERMELHO
    // quando a tag foi pinada para `:0.6.1` — o `replace` deixou de casar, o
    // texto seguia intacto e a asserção passava a medir a coisa errada.
    const imageLine = String(out.text)
      .split("\n")
      .find((line) => line.includes("    image: gitea/act_runner:"))
    expect(imageLine).toBeTruthy()
    const tampered = (out.text as string).replace(imageLine as string, `${imageLine} # intrusa`)
    const check = assertOnlyRemoval(COMPOSE_TEXT, tampered, out.removal as never)
    expect(check.ok).toBe(false)
    expect(check.detail).toContain("divergiu além do que foi removido")
  })

  it("recusa um compose cujo runner não declare o hardening (a flag não teria efeito)", () => {
    const out = stripRunnerHardening("services:\n  runner:\n    image: x\n")
    expect(out.ok).toBe(false)
    expect(out.detail).toContain("não declara 'security_opt'")
  })
})

describe("classifyTaskStatus / parseActionTasks — o veredito mora no banco", () => {
  it("só 1 e 2 são terminais; qualquer outro código é 'ainda não terminou'", () => {
    expect(classifyTaskStatus(1)).toBe("success")
    expect(classifyTaskStatus(2)).toBe("failure")
    // 6 foi MEDIDO num job rodando: não pode ser lido como desfecho.
    expect(classifyTaskStatus(6)).toBe("pending")
    expect(classifyTaskStatus(0)).toBe("pending")
    expect(classifyTaskStatus(null)).toBe("absent")
  })

  it("saída VAZIA do sqlite3 é 'nenhuma tarefa' (o -json não imprime [] sem linhas)", () => {
    expect(parseActionTasks("")).toEqual({
      ok: true,
      rows: [],
      detail: "nenhuma tarefa (saída vazia)",
    })
    expect(parseActionTasks("  \n")).toMatchObject({ ok: true, rows: [] })
  })

  it("saída ilegível NÃO vira 'sem tarefas'", () => {
    const parsed = parseActionTasks("Error: no such table")
    expect(parsed.ok).toBe(false)
    expect(parsed.detail).toContain("não é JSON")
  })

  it("lê o JSON como o sqlite3 -json devolve", () => {
    const parsed = parseActionTasks('[{"id":1,"status":2,"log_filename":"a/01/1.log"}]')
    expect(parsed.ok).toBe(true)
    expect((parsed.rows[0] as { status: number }).status).toBe(2)
  })
})

describe("readTaskLog — o log mora em DUAS casas na 1.22", () => {
  const args = {
    container: "gitea",
    dbPath: "/data/gitea/gitea.db",
    logDir: "/data/gitea/actions_log",
  }
  const FILENAME = "prova/ensaio/02/2.log"

  it("o ARQUIVO transferido vem primeiro, e a leitura nem toca no DBFS", () => {
    const { run, calls } = fakeRun({
      [`docker exec gitea cat /data/gitea/actions_log/${FILENAME}`]: {
        status: 0,
        stdout: "linha do log",
      },
    })
    const lido = readTaskLog({ ...args, filename: FILENAME, run })
    expect(lido).toMatchObject({ ok: true, log: "linha do log", onde: "actions_log" })
    expect(calls.some((c) => c.includes("sqlite3"))).toBe(false)
  })

  // MEDIDO nas rodadas #5 e #7: o job fecha com o log INTEIRO no DBFS e o
  // `cat` morre com No such file or directory — ler só o arquivo diria "não
  // consegui ler" sobre um log que EXISTE, e o ensaio sairia INDETERMINADO por
  // um lugar de leitura, não por um fato da forja.
  it("arquivo ausente → lê o DBFS (blocos concatenados, não truncados)", () => {
    const { run, calls } = fakeRun({
      "docker exec gitea sqlite3": { status: 0, stdout: "log inteiro do DBFS" },
    })
    const lido = readTaskLog({ ...args, filename: FILENAME, run })
    expect(lido).toMatchObject({ ok: true, log: "log inteiro do DBFS", onde: "dbfs" })
    expect(lido.detail).toContain("DBFS")
    const sql = (calls.find((c) => c.includes("sqlite3")) ?? []).join(" ")
    expect(sql).toContain("group_concat")
    expect(sql).toContain("dbfs_data")
    expect(sql).toContain("order by blob_offset")
  })

  it("arquivo VAZIO (transferência recém-criada) também cai para o DBFS", () => {
    const { run } = fakeRun({
      [`docker exec gitea cat /data/gitea/actions_log/${FILENAME}`]: { status: 0, stdout: "" },
      "docker exec gitea sqlite3": { status: 0, stdout: "log completo" },
    })
    expect(readTaskLog({ ...args, filename: FILENAME, run })).toMatchObject({
      ok: true,
      log: "log completo",
      onde: "dbfs",
    })
  })

  it("sem log em casa alguma, o detalhe DIZ as duas tentativas", () => {
    const { run } = fakeRun({
      "docker exec gitea sqlite3": { status: 0, stdout: "" },
    })
    const lido = readTaskLog({ ...args, filename: FILENAME, run })
    expect(lido.ok).toBe(false)
    expect(lido.onde).toBeNull()
    expect(lido.detail).toContain("em casa alguma")
    expect(lido.detail).toContain("DBFS")
  })

  it("o DBFS ilegível NÃO vira log vazio: é falha de leitura dita", () => {
    const { run } = fakeRun({
      "docker exec gitea sqlite3": { status: 1, stderr: "Error: no such table: dbfs_data" },
    })
    const lido = readDbfsLog({ ...args, filename: FILENAME, run })
    expect(lido.ok).toBe(false)
    expect(lido.log).toBe("")
    expect(lido.detail).toContain("no such table: dbfs_data")
  })
})

describe("smokeExpectations — as expectativas saem DO ARQUIVO", () => {
  const fixture = [
    "name: x",
    "on:",
    "  workflow_dispatch:",
    "jobs:",
    "  smoke:",
    "    steps:",
    "      - uses: actions/checkout@v4",
    '      - name: "Prova 1 — vars.BUN_VERSION resolve"',
    "        run: |",
    "          set -euo pipefail",
    '          echo "✅ vars.BUN_VERSION = ${BUN_VERSION}"',
    "      - name: Prova 2",
    "        run: |",
    "          set -euo pipefail",
    '          echo "::error::tier-1 NAO disparou: a imagem nao embarca o Bun ${X}"',
    '          echo "✅ tier-1 engajou"',
    "      - name: Restore Bun cache",
    "        uses: actions/cache@v4",
    "        with:",
    "          path: ~/.bun",
    "      - name: Report",
    "        run: echo fim",
  ].join("\n")

  it("deriva passos, ✅ truncados na interpolação e a falha (como antes)", () => {
    const exp = smokeExpectations(fixture)
    expect(exp.steps).toEqual([
      "Prova 1 — vars.BUN_VERSION resolve",
      "Prova 2",
      "Restore Bun cache",
      "Report",
    ])
    expect(exp.success).toEqual(["✅ vars.BUN_VERSION =", "✅ tier-1 engajou"])
    expect(exp.failure).toEqual(["::error::tier-1 NAO disparou: a imagem nao embarca o Bun"])
    expect(exp.variables).toEqual(["BUN_VERSION"])
  })

  it("o rótulo do grupo é do TIPO do passo, e o que se compartilha é CONTADO", () => {
    const exp = smokeExpectations(fixture)
    // `uses:` sem nome → a referência; `uses:` com nome → o nome; `run:` → a
    // PRIMEIRA linha do script. É essa a linha que o runner grava (medido).
    expect(exp.groups).toEqual([
      { label: "actions/checkout@v4", count: 1, steps: ["actions/checkout@v4"] },
      {
        label: "set -euo pipefail",
        count: 2,
        steps: ["Prova 1 — vars.BUN_VERSION resolve", "Prova 2"],
      },
      { label: "Restore Bun cache", count: 1, steps: ["Restore Bun cache"] },
      { label: "echo fim", count: 1, steps: ["Report"] },
    ])
    expect(exp.required).toEqual([
      `${GROUP_MARKER}actions/checkout@v4`,
      `${GROUP_MARKER}set -euo pipefail`,
      `${GROUP_MARKER}Restore Bun cache`,
      `${GROUP_MARKER}echo fim`,
    ])
    // O nome do passo NÃO é a régua: o runner não grava `⭐ Run Main <nome>` para
    // os passos de `run:` (medido: um job com quatro `run:` tinha o `⭐` só do
    // `actions/checkout@v4`) — exigir o nome reprovaria um run verde.
    expect(exp.required.some((linha) => linha.includes(RUN_MARKER))).toBe(false)
  })

  it("sobre o smoke REAL: cada passo tem o seu grupo, com a contagem certa", () => {
    const exp = smokeExpectations(SMOKE_TEXT)
    expect(exp.steps.length).toBeGreaterThanOrEqual(5)
    const porRotulo = Object.fromEntries(exp.groups.map((g) => [g.label, g]))
    expect(porRotulo["actions/checkout@v4"]?.count).toBe(1)
    // três Provas abrem com o mesmo `set -euo pipefail`: o rótulo é um só e a
    // exigência é de TRÊS ocorrências (um run onde só uma rodou é vermelho)
    expect(porRotulo["set -euo pipefail"]?.count).toBe(3)
    expect(porRotulo["set -uo pipefail +e"]?.steps.join(" ")).toContain("Prova 5")
    expect(porRotulo["bun install --frozen-lockfile"]?.steps.join(" ")).toContain("Prova 4")
    expect(porRotulo["Restore Bun cache"]?.count).toBe(1)
    // as variáveis usadas pelo smoke TÊM de estar no template comitado
    for (const name of exp.variables) expect(ENV_TEXT).toContain(`${name}=`)
  })

  it("todo `run:` que decide por `$?` desliga o -e que o runner impõe", () => {
    // MEDIDO (fase 2 do ensaio): o act roda cada `run:` com `bash --noprofile
    // --norc -e -o pipefail {0}` e `set -uo pipefail` NÃO desliga esse `-e` —
    // um `OUT="$(…)"` que sai != 0 morre NA ATRIBUIÇÃO, o `case` vira código
    // morto e o job fica vermelho sem dizer QUAL prova caiu. Foi exatamente o
    // que a mutação de labels mediu na Prova 5: status 2 e nenhuma das três
    // mensagens. A régua vale para todo passo que decide por código de saída.
    const blocos = SMOKE_TEXT.split(/\n(?=\s*- )/).filter((bloco) => /^\s*run: \|/m.test(bloco))
    const decidemPorCodigo = blocos.filter((bloco) => /\$\?/.test(bloco))
    expect(decidemPorCodigo.length).toBeGreaterThan(0)
    const semOE = decidemPorCodigo.filter(
      (bloco) => !bloco.split("\n").some((linha) => /^\s*set\s/.test(linha) && /\+e\b/.test(linha)),
    )
    expect(semOE.map((bloco) => bloco.split("\n")[0].trim())).toEqual([])
  })
})

describe("evaluateSmokeLog — verde exige tudo, e cada falta é dita", () => {
  const expectations = smokeExpectations(
    [
      "jobs:",
      "  smoke:",
      "    steps:",
      "      - name: A",
      "        run: |",
      "          set -e",
      '          echo "✅ feito"',
      "      - name: B",
      "        run: |",
      "          set -e",
      '          echo "::error::quebrou"',
    ].join("\n"),
  )
  // O log de um run VERDE: os grupos dos dois passos (o rótulo é COMPARTILHADO,
  // então a régua é a contagem), o ✅ emitido de verdade… e o ECO do script do
  // passo B, que traz a linha `echo "::error::quebrou"` para dentro do log.
  const full = [
    `${GROUP_MARKER}set -e`,
    "::endgroup::",
    `${GROUP_MARKER}set -e`,
    '        echo "::error::quebrou"',
    "::endgroup::",
    "✅ feito",
    "",
  ].join("\n")

  it("verde: os grupos (contados) + os ✅ reais, e o eco do script NÃO é falha", () => {
    const out = evaluateSmokeLog({ log: full, status: 1, expectations })
    expect(out.ok).toBe(true)
    expect(out.missingSteps).toEqual([])
    expect(out.missingSuccess).toEqual([])
    expect(out.hitFailure).toEqual([])
  })

  it("um passo cujo grupo não apareceu é reportado com o nome e a CONTAGEM", () => {
    const log = [`${GROUP_MARKER}set -e`, "::endgroup::", "✅ feito", ""].join("\n")
    const out = evaluateSmokeLog({ log, status: 1, expectations })
    expect(out.ok).toBe(false)
    expect(out.missingSteps).toEqual([`A, B: o log tem 1/2 de \`${GROUP_MARKER}set -e\``])
  })

  it("✅ ausente e `::error::` REAL são violações separadas", () => {
    const semSucesso = [
      `${GROUP_MARKER}set -e`,
      "::endgroup::",
      `${GROUP_MARKER}set -e`,
      "::error::quebrou",
      "",
    ].join("\n")
    const out = evaluateSmokeLog({ log: semSucesso, status: 1, expectations })
    expect(out.ok).toBe(false)
    expect(out.missingSuccess).toEqual(["✅ feito"])
    expect(out.hitFailure).toContain("::error::quebrou")
  })

  it("status de falha derruba o veredito mesmo com o log completo", () => {
    const out = evaluateSmokeLog({ log: full, status: 2, expectations })
    expect(out.ok).toBe(false)
    expect(out.state).toBe("failure")
  })
})

describe("safetyBlocker — a produção não é tocada", () => {
  const base = { runnerName: "gitea-runner", ownPrefix: PROJECT_PREFIX, prodProject: "deploy" }

  it("bloqueia quando o NOME do runner está ocupado por container alheio", () => {
    const out = safetyBlocker({
      ...base,
      containers: [{ name: "gitea-runner", project: "deploy", running: true }],
    })
    expect(out).toContain("'gitea-runner' já existe")
    expect(out).toContain("Prova 5")
  })

  it("bloqueia quando a stack da forja está RODANDO (não divide recurso)", () => {
    const out = safetyBlocker({
      ...base,
      containers: [{ name: "gitea", project: "deploy", running: true }],
    })
    expect(out).toContain("está RODANDO")
  })

  it("tolera container PARADO de outro projeto (o nome do Gitea do ensaio é renomeado)", () => {
    const out = safetyBlocker({
      ...base,
      containers: [{ name: "gitea", project: "deploy", running: false }],
    })
    expect(out).toBeNull()
  })

  it("não bloqueia pelos resíduos do PRÓPRIO ensaio (prefixo conhecido)", () => {
    const out = safetyBlocker({
      ...base,
      containers: [{ name: "gitea-runner", project: `${PROJECT_PREFIX}-abc`, running: true }],
    })
    expect(out).toBeNull()
  })
})

describe("removeContainers — o teardown que não presume", () => {
  it("remove quando o daemon deixa", () => {
    const { run } = fakeRun({
      "docker rm -f a": { status: 0 },
      "docker inspect a": { status: 1, stderr: "no such" },
    })
    expect(removeContainers({ names: ["a"], run: run as never })).toEqual([])
  })

  it("quando o daemon recusa, pede o encerramento DE DENTRO e remove", () => {
    let inspected = 0
    const calls: string[] = []
    const run = (command: string, args: string[]) => {
      calls.push([command, ...args].join(" "))
      if (args[0] === "inspect") {
        inspected += 1
        return { status: inspected === 1 ? 0 : 1, stdout: "running", stderr: "", error: null }
      }
      return { status: 0, stdout: "", stderr: "", error: null }
    }
    expect(removeContainers({ names: ["b"], run: run as never })).toEqual([])
    expect(calls).toContain("docker exec b kill 1")
  })

  it("o que NÃO saiu volta com nome, para o relatório não esconder resíduo", () => {
    const { run } = fakeRun({
      "docker rm -f c": { status: 1, stderr: "cannot remove container: permission denied" },
      "docker inspect c": { status: 0, stdout: "running" },
    })
    const remaining = removeContainers({ names: ["c"], run: run as never, sleep: () => undefined })
    expect(remaining.map((r) => r.name)).toEqual(["c"])
  })
})

describe("parseArgs — o contrato da CLI", () => {
  it("defaults: worktree, sentinela ligada, mutação desligada", () => {
    expect(parseArgs([])).toMatchObject({
      source: "worktree",
      sentinela: true,
      mutation: false,
      semNoNewPrivileges: false,
      branch: SMOKE_BRANCH,
      error: null,
    })
  })

  it("aceita as flags do ensaio", () => {
    const opts = parseArgs([
      "--json",
      "--keep",
      "--source",
      "HEAD",
      "--timeout",
      "60",
      "--mutacao-labels",
      "--sem-no-new-privileges",
      "--no-sentinela",
    ])
    expect(opts).toMatchObject({
      json: true,
      keep: true,
      source: "HEAD",
      timeoutS: 60,
      mutation: true,
      sentinela: false,
      semNoNewPrivileges: true,
    })
  })

  it("falha alto em argumento desconhecido, valor ausente ou inválido", () => {
    expect(parseArgs(["--nope"]).error).toContain("desconhecido")
    expect(parseArgs(["--source"]).error).toContain("exige um valor")
    expect(parseArgs(["--source", "banana"]).error).toContain("HEAD ou worktree")
    expect(parseArgs(["--timeout", "0"]).error).toContain("número de segundos")
  })
})

describe("exitCodeFor / prepareSmokeWorkflow", () => {
  it("a escala da família", () => {
    expect(exitCodeFor("proven")).toBe(0)
    expect(exitCodeFor("violated")).toBe(1)
    expect(exitCodeFor("unavailable")).toBe(2)
    expect(exitCodeFor("sei-la")).toBe(3)
  })

  it("o smoke comitado é preparado com as expectativas derivadas e o gatilho conferido", () => {
    const prepared = prepareSmokeWorkflow()
    expect(prepared.ok).toBe(true)
    expect(prepared.added).toEqual(["  push:", `    branches: [${SMOKE_BRANCH}]`])
    expect(prepared.expectations!.steps.length).toBeGreaterThanOrEqual(5)
    expect(prepared.detail).toContain("passo(s)")
  })

  it("reporta o motivo (sem valores cravados) quando o workflow some", () => {
    const prepared = prepareSmokeWorkflow({ repoRoot: "/tmp/nao-existe-xyz" })
    expect(prepared.ok).toBe(false)
    expect(prepared.detail).toContain(SMOKE_WORKFLOW)
  })

  it("a mutação de labels usa um nome que o compose NÃO declara", () => {
    expect(COMPOSE_TEXT).not.toContain(MUTATION_LABEL_NAME)
  })
})
