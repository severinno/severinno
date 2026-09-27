/**
 * runner-queue.test.ts
 *
 * Testes de scripts/runner-queue.mjs — a régua da FILA PARADA: o runner da forja
 * FORA DO AR com run esperando.
 *
 * POR QUE ESTA FOLHA TEM TESTES PRÓPRIOS: ela é a única parte do fato que DECIDE
 * (a derivação, o estado do runner da Gitea pela régua da própria forja, a
 * resolução do banco no compose) e a única que fala com a fronteira de I/O (a API
 * do GitHub, a CLI `gh`, o `docker exec … sqlite3` no container da stack). O
 * `forge-doctor.test.ts` mede o fato pelo VEREDITO, com dublê; aqui as duas
 * metades saem medidas DIRETO, com o que cada uma recebe: os parsers com os
 * payloads medidos em 24/09/2026 (5 runs em `queued` no GitHub) e o formato do
 * `sqlite3 -json` da Gitea 1.22 (a fila em `action_run_job`, a linha de
 * `action_task` só nascendo quando um runner pega), a régua da forja com os
 * limiares do `models/actions/runner.go` v1.22.6
 * (60s = offline, 10s = idle) e as leituras com a costura de I/O injetada — sem
 * rede, sem docker e sem relógio da forja.
 *
 * Cobre:
 *   - splitReposlug: `owner/name` ok; vazio, sem barra, com três partes e com
 *     espaço são RECUSADOS (o slug entra numa consulta SQL)
 *   - parseGithubQueuedRuns: o `total_count` é a fila (não a página), o mais
 *     antigo vem da AMOSTRA e `oldestFromSample` declara isso; lista ausente é
 *     leitura que não aconteceu (nunca fila vazia), e data ilegível é null
 *   - parseGiteaQueueCounts: tabela VAZIA (stdout vazio do `-json`) é fila vazia
 *     MEDIDA; o `created` em segundos vira idade; saída ilegível e contagem
 *     negativa são leitura que não aconteceu
 *   - parseGiteaRepoId: o slug precisa EXISTIR no banco (zero itens de uma fila
 *     de um repo inexistente é o verde falso que a ordem das consultas evita)
 *   - giteaRunnerStatus + parseGiteaRunnerRows: a régua DA FORJA (offline > 60s,
 *     idle > 10s sem atividade, active caso contrário)
 *   - deriveRunnerQueue: os CINCO estados, e a ORDEM (fila vazia é medida ANTES
 *     do estado do puxador), com `pullers: null` (registro não lido) separado de
 *     `[]` (ninguém registrado)
 *   - runnerQueueBlocker / runnerQueueUnknown: uma linha por forja parada, com a
 *     idade e o comando de RE-REGISTRO dentro dela
 *   - dur: a idade legível (s/min/h/d)
 *   - resolveGiteaDatabase: o container e o caminho DERIVADOS do compose
 *     comitado, a forma declarada (`GITEA_CONTAINER`) vencendo, o `docker ps` por
 *     service label quando não há `container_name`, e os quatro jeitos de não
 *     saber (interpolado, dois serviços com o banco, nenhum, compose ilegível)
 *   - readGiteaQueue: as três consultas na ordem (repo → fila → runners), o canal
 *     (`docker exec … sqlite3 -json`), e cada recusa nomeada (banco que não é
 *     sqlite, slug fora do banco, docker exec que falhou, exit ≠ 0)
 *   - readGithubQueue / readGithubQueueCli: os dois canais do espelho (API com
 *     GH_TOKEN e a CLI `gh`), com o 401/403 dito e o `gh` sem instalação
 *   - readRunnerQueue: a agregação (o estado, a soma que ignora a forja não
 *     lida, a mais antiga de todas) e — o que NÃO pode regredir — a lista de
 *     runners do GitHub vinda do registro JÁ LIDO (uma chamada, dois fatos)
 */

import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import {
  GITEA_CONTAINER_ENV,
  GITEA_QUEUE_STATUSES,
  GITEA_RUNNER_IDLE_SECONDS,
  GITEA_RUNNER_OFFLINE_SECONDS,
  GITEA_TASK_STATUS,
  RUNNER_QUEUE_FORGES,
  RUNNER_QUEUE_REMEDY,
  deriveRunnerQueue,
  dur,
  giteaRunnerStatus,
  parseGiteaQueueCounts,
  parseGiteaRepoId,
  parseGiteaRunnerRows,
  parseGithubQueuedRuns,
  readGiteaQueue,
  readGithubQueue,
  readGithubQueueCli,
  readRunnerQueue,
  resolveGiteaDatabase,
  runnerQueueBlocker,
  runnerQueueUnknown,
  splitReposlug,
} from "../../../scripts/runner-queue.mjs"

// ── As constantes DECLARADAS ────────────────────────────────────────────────

describe("as constantes", () => {
  it("a DONA DO MERGE vem primeiro (a ordem do relatório, não alfabética)", () => {
    expect(RUNNER_QUEUE_FORGES).toEqual(["gitea", "github"])
  })

  it("a espera da Gitea é SÓ `waiting` (5) — `blocked` (7) e `running` (6) NÃO contam", () => {
    expect(GITEA_QUEUE_STATUSES).toEqual([GITEA_TASK_STATUS.WAITING])
    // `blocked` (7) é o job que espera `needs`/aprovação: re-registrar runner
    // nenhum o destrava, e contá-lo publicaria o remédio errado.
    expect(GITEA_QUEUE_STATUSES).not.toContain(GITEA_TASK_STATUS.BLOCKED)
    // Um job rodando é a forja trabalhando: contá-lo faria a fila parada se
    // disfarçar de fila andando.
    expect(GITEA_QUEUE_STATUSES).not.toContain(GITEA_TASK_STATUS.RUNNING)
  })

  it("a régua do estado é a DA FORJA (1 minuto offline, 10 segundos idle)", () => {
    expect(GITEA_RUNNER_OFFLINE_SECONDS).toBe(60)
    expect(GITEA_RUNNER_IDLE_SECONDS).toBe(10)
  })

  it("o remédio das duas forjas é o RE-REGISTRO, nomeado pelo script da casa", () => {
    expect(RUNNER_QUEUE_REMEDY.gitea).toContain("deploy/gitea-up.sh")
    expect(RUNNER_QUEUE_REMEDY.github).toContain("deploy/setup-github-runner.sh")
  })
})

// ── splitReposlug ───────────────────────────────────────────────────────────

describe("splitReposlug", () => {
  it("aceita owner/name", () => {
    expect(splitReposlug("severinno/severinno")).toMatchObject({
      ok: true,
      owner: "severinno",
      name: "severinno",
    })
  })

  it("espaços das pontas não viram parte do slug", () => {
    expect(splitReposlug("  severinno/api.v2  ")).toMatchObject({ ok: true, name: "api.v2" })
  })

  it("recusa o vazio nomeando o canal (nunca um slug chutado)", () => {
    const r = splitReposlug("")
    expect(r.ok).toBe(false)
    expect(r.detail).toContain("sem repositório no canal")
    expect(splitReposlug(null as unknown as string).ok).toBe(false)
    expect(splitReposlug(undefined as unknown as string).ok).toBe(false)
  })

  it("recusa o que não é owner/name — o slug entra numa consulta SQL", () => {
    for (const ruim of ["severinno", "a/b/c", "seve rinno/severinno", "severinno/../etc", "a//b"]) {
      const r = splitReposlug(ruim)
      expect(r.ok, `deveria recusar '${ruim}'`).toBe(false)
      expect(r.detail).toContain("owner/name")
    }
  })
})

// ── parseGithubQueuedRuns ───────────────────────────────────────────────────

describe("parseGithubQueuedRuns", () => {
  it("a fila é o `total_count` e o mais antigo vem da AMOSTRA (declarado)", () => {
    const r = parseGithubQueuedRuns({
      total_count: 5,
      workflow_runs: [
        {
          id: 1,
          name: "PR Check",
          head_branch: "main",
          html_url: "https://github.com/o/r/actions/runs/1",
          created_at: new Date(Date.now() - 3_600_000).toISOString(),
        },
      ],
    })
    expect(r.ok).toBe(true)
    expect(r.waiting).toBe(5)
    expect(r.items).toHaveLength(1)
    expect(r.items[0].name).toBe("PR Check")
    // 5 na fila e 1 lido: a data NÃO é "a mais antiga da fila" — é a mais antiga
    // entre os lidos, e o fato diz isso em vez de inventar a data.
    expect(r.oldestFromSample).toBe(true)
    expect(r.oldestMs).toBeGreaterThan(3_000_000)
    expect(r.detail).toContain("5 run(s)")
  })

  it("a lista INTEIRA numa página só: a idade é da fila, não da amostra", () => {
    const r = parseGithubQueuedRuns({
      total_count: 2,
      workflow_runs: [
        { id: 1, created_at: new Date(Date.now() - 600_000).toISOString() },
        { id: 2, created_at: new Date(Date.now() - 120_000).toISOString() },
      ],
    })
    expect(r.waiting).toBe(2)
    expect(r.oldestFromSample).toBe(false)
    // O mais antigo dos dois, e não o primeiro da lista.
    expect(r.oldestMs).toBeGreaterThan(500_000)
  })

  it("sem `total_count` a fila é o que foi lido (nunca zero por engano)", () => {
    const r = parseGithubQueuedRuns({ workflow_runs: [{ id: 1 }, { id: 2 }, { id: 3 }] })
    expect(r.ok).toBe(true)
    expect(r.waiting).toBe(3)
  })

  it("lista ausente é leitura que NÃO aconteceu — jamais uma fila vazia", () => {
    for (const payload of [null, {}, { total_count: 0 }, { workflow_runs: "nope" }]) {
      const r = parseGithubQueuedRuns(payload)
      expect(r.ok).toBe(false)
      expect(r.detail).toContain("workflow_runs")
      // A metade da fila não sai como zero medido: quem chama vê `ok: false`.
      expect(r.waiting).toBe(0)
      expect(r.oldestMs).toBeNull()
    }
  })

  it("data ilegível não vira idade zero", () => {
    const r = parseGithubQueuedRuns({ total_count: 1, workflow_runs: [{ id: 1 }] })
    expect(r.items[0].createdAt).toBe("")
    expect(r.items[0].ageMs).toBeNull()
    expect(r.oldestMs).toBeNull()
    expect(r.detail).not.toContain("mais antigo")
  })
})

// ── parseGiteaQueueCounts ───────────────────────────────────────────────────

describe("parseGiteaQueueCounts", () => {
  it("lê a contagem e a idade em SEGUNDOS da própria forja", () => {
    const nowMs = Date.UTC(2026, 8, 24, 12, 0, 0)
    const criadaEm = nowMs / 1000 - 7200
    const r = parseGiteaQueueCounts(`[{"aguardando":2,"mais_antiga":${criadaEm}}]`, nowMs)
    expect(r.ok).toBe(true)
    expect(r.waiting).toBe(2)
    expect(r.oldestMs).toBe(7_200_000)
    expect(r.detail).toContain("2h00")
  })

  it("tabela VAZIA (stdout vazio do `-json`) é uma fila vazia MEDIDA", () => {
    // O `nowMs` é o MESMO relógio fixo das outras metades deste bloco (e não o
    // `Date.now()`): o veredito destas quatro leituras NÃO depende do relógio, e
    // ler o relógio real numa asserção é a bomba-relógio que o
    // `check-clock-bombs` recusa — o arquivo mede a régua SEM o relógio da forja.
    const nowMs = Date.UTC(2026, 8, 24, 12, 0, 0)
    const r = parseGiteaQueueCounts("", nowMs)
    expect(r.ok).toBe(true)
    expect(r.waiting).toBe(0)
    expect(r.oldestMs).toBeNull()
  })

  it("zero em espera com um `min(created)` nulo não inventa idade", () => {
    const nowMs = Date.UTC(2026, 8, 24, 12, 0, 0)
    const r = parseGiteaQueueCounts('[{"aguardando":0,"mais_antiga":null}]', nowMs)
    expect(r.ok).toBe(true)
    expect(r.waiting).toBe(0)
    expect(r.oldestMs).toBeNull()
  })

  it("saída ilegível e contagem negativa são leitura que não aconteceu", () => {
    const nowMs = Date.UTC(2026, 8, 24, 12, 0, 0)
    expect(parseGiteaQueueCounts("nao e json", nowMs).ok).toBe(false)
    expect(parseGiteaQueueCounts('{"aguardando":1}', nowMs).ok).toBe(false)
    const negativa = parseGiteaQueueCounts('[{"aguardando":-1,"mais_antiga":1}]', nowMs)
    expect(negativa.ok).toBe(false)
    expect(negativa.detail).toContain("não é um número")
  })
})

// ── parseGiteaRepoId ────────────────────────────────────────────────────────

describe("parseGiteaRepoId", () => {
  it("devolve o id que escopa a fila", () => {
    expect(parseGiteaRepoId('[{"repo_id":7}]')).toMatchObject({ ok: true, id: 7 })
  })

  it("o slug precisa existir NO BANCO — zero itens de um repo inexistente é o verde falso", () => {
    const r = parseGiteaRepoId("")
    expect(r.ok).toBe(false)
    expect(r.detail).toContain("não existe no banco desta forja")
    expect(parseGiteaRepoId('[{"repo_id":0}]').ok).toBe(false)
    expect(parseGiteaRepoId('[{"repo_id":null}]').ok).toBe(false)
  })
})

// ── a régua do runner da Gitea ──────────────────────────────────────────────

describe("giteaRunnerStatus / parseGiteaRunnerRows", () => {
  const nowMs = Date.UTC(2026, 8, 24, 12, 0, 0)
  const agora = nowMs / 1000

  it("ACTIVE é o único estado em que alguém está PEGANDO um job", () => {
    expect(giteaRunnerStatus({ lastOnline: agora - 5, lastActive: agora - 2 }, nowMs)).toBe(
      "active",
    )
  })

  it("no ar e sem atividade nos últimos 10s → idle (a régua da forja)", () => {
    expect(giteaRunnerStatus({ lastOnline: agora - 30, lastActive: agora - 30 }, nowMs)).toBe(
      "idle",
    )
    expect(giteaRunnerStatus({ lastOnline: agora - 30, lastActive: agora - 11 }, nowMs)).toBe(
      "idle",
    )
  })

  it("passou de 60s sem contato → offline, mesmo com atividade recente", () => {
    expect(giteaRunnerStatus({ lastOnline: agora - 61, lastActive: agora }, nowMs)).toBe("offline")
  })

  it("sem `last_online` (0/null) é OFFLINE, nunca 'no ar'", () => {
    expect(giteaRunnerStatus({ lastOnline: null, lastActive: agora }, nowMs)).toBe("offline")
    expect(giteaRunnerStatus({ lastOnline: 0, lastActive: agora }, nowMs)).toBe("offline")
    expect(giteaRunnerStatus({}, nowMs)).toBe("offline")
  })

  it("as linhas ganham o estado derivado, com name/version preservados", () => {
    const r = parseGiteaRunnerRows(
      JSON.stringify([
        { name: "vps-runner", version: "v0.6.1", last_online: agora - 3, last_active: agora - 1 },
        { name: "runner-velho", version: "v0.2.11", last_online: agora - 900, last_active: 0 },
      ]),
      nowMs,
    )
    expect(r.ok).toBe(true)
    expect(r.runners.map((x) => x.status)).toEqual(["active", "offline"])
    expect(r.detail).toContain("2 runner(s)")
  })

  it("saída ilegível não vira 'nenhum runner registrado'", () => {
    expect(parseGiteaRunnerRows("lixo", nowMs).ok).toBe(false)
    // Tabela vazia de runners é um FATO (ninguém registrado) e sai como lista vazia.
    expect(parseGiteaRunnerRows("", nowMs)).toMatchObject({ ok: true, runners: [] })
  })
})

// ── deriveRunnerQueue ───────────────────────────────────────────────────────

/** A fila MEDIDA, com `waiting` itens e o mais antigo há `oldestMs`. */
function filaMedida(waiting: number, oldestMs: number | null = null, over: object = {}) {
  return {
    ok: true,
    waiting,
    oldestMs,
    oldestFromSample: false,
    items: [],
    detail: `${waiting} item(ns)`,
    ...over,
  }
}

/** Um runner no registro, na forma que as duas forjas compartilham. */
function puxador(over: object = {}) {
  return { name: "hostinger-runner", status: "online", busy: false, raw: "idle", ...over }
}

describe("deriveRunnerQueue — os cinco estados", () => {
  const nowMs = Date.UTC(2026, 8, 24, 12, 0, 0)

  it("a fila não lida → `unread` com a CAUSA (nunca 'sem fila')", () => {
    const m = deriveRunnerQueue({
      forge: "gitea",
      queue: { ok: false, detail: "o container da forja não está rodando" },
      pullers: null,
      nowMs,
    })
    expect(m.state).toBe("unread")
    expect(m.detail).toContain("o container da forja não está rodando")
    expect(m.remedy).toContain("gitea-up.sh")
  })

  it("registro NÃO LIDO (`null`) → `unread`, e a fila medida sai dita ao lado", () => {
    const m = deriveRunnerQueue({
      forge: "github",
      queue: filaMedida(4, 3_600_000),
      pullers: null,
      nowMs,
    })
    expect(m.state).toBe("unread")
    expect(m.waiting).toBe(4)
    expect(m.oldestMs).toBe(3_600_000)
    expect(m.detail).toContain("quem puxaria a fila não foi lido")
  })

  it("fila VAZIA é ociosa — mesmo com ZERO runners registrados (e mesmo offline)", () => {
    // A ORDEM importa: zero espera não é dívida nem com a forja no chão. Ler o
    // contrário abriria bloqueio no item mais comum de todos (a fila vazia de
    // todo dia) e ensinaria a ignorar o veredito.
    for (const pullers of [[], [puxador({ status: "offline" })]]) {
      const m = deriveRunnerQueue({ forge: "github", queue: filaMedida(0), pullers, nowMs })
      expect(m.state).toBe("ociosa")
      expect(m.detail).toContain("fila vazia")
    }
  })

  it("fila cheia e NENHUM runner online → `parada` (a dívida, com a idade)", () => {
    const m = deriveRunnerQueue({
      forge: "github",
      queue: filaMedida(5, 57_600_000),
      pullers: [puxador({ status: "offline" })],
      nowMs,
    })
    expect(m.state).toBe("parada")
    expect(m.online).toBe(0)
    expect(m.detail).toContain("16h00")
  })

  it("ZERO runners registrados com fila cheia é PARADA (o 'no runner available' da forja)", () => {
    // `[]` é um FATO (a leitura respondeu que ninguém está registrado) e `null` é
    // a ausência de um: o primeiro é a forja parada, o segundo é leitura que não
    // aconteceu.
    const m = deriveRunnerQueue({ forge: "github", queue: filaMedida(3), pullers: [], nowMs })
    expect(m.state).toBe("parada")
    expect(m.detail).toContain("NENHUM dos 0 runner(s)")
  })

  it("fila cheia com runner online PEGANDO job → `drenando` (a forja trabalhando)", () => {
    const m = deriveRunnerQueue({
      forge: "github",
      queue: filaMedida(2),
      pullers: [puxador({ busy: true })],
      nowMs,
    })
    expect(m.state).toBe("drenando")
    expect(m.picking).toBe(1)
  })

  it("fila cheia, runner online e NINGUÉM pegando → `sem-puxador` (dúvida, não bloqueio)", () => {
    const m = deriveRunnerQueue({
      forge: "github",
      queue: filaMedida(2),
      pullers: [puxador(), puxador({ name: "outro", status: "offline" })],
      nowMs,
    })
    expect(m.state).toBe("sem-puxador")
    expect(m.online).toBe(1)
    expect(m.detail).toContain("nenhum runner casar com os `runs-on`")
  })

  it("um `busy` basta para drenar, com o resto offline no registro", () => {
    const m = deriveRunnerQueue({
      forge: "gitea",
      queue: filaMedida(1),
      pullers: [puxador({ name: "a", status: "offline" }), puxador({ name: "b", busy: true })],
      nowMs,
    })
    expect(m.state).toBe("drenando")
    expect(m.online).toBe(1)
    expect(m.runners).toHaveLength(2)
  })

  it("o estado sai também por forja, sem vazar a régua da outra", () => {
    const m = deriveRunnerQueue({ forge: "gitea", queue: filaMedida(1), pullers: [], nowMs })
    expect(m.forge).toBe("gitea")
    expect(m.label).toBe("Gitea")
    expect(m.remedy).toContain("gitea-up.sh")
  })
})

// ── as linhas do veredito ───────────────────────────────────────────────────

describe("runnerQueueBlocker / runnerQueueUnknown", () => {
  const nowMs = Date.UTC(2026, 8, 24, 12, 0, 0)

  it("UMA linha por forja parada (a fila é um problema, não dez)", () => {
    const m = deriveRunnerQueue({
      forge: "github",
      queue: filaMedida(5, 57_600_000),
      pullers: [puxador({ status: "offline" })],
      nowMs,
    })
    const linhas = runnerQueueBlocker(m)
    expect(linhas).toHaveLength(1)
    expect(linhas[0]).toContain("FORA DO AR com run na FILA")
    expect(linhas[0]).toContain("5 item(ns)")
    expect(linhas[0]).toContain("0 de 1 runner(s) online")
    // O remédio sai DENTRO da linha: quem lê o bloqueio tem o comando ao lado.
    expect(linhas[0]).toContain("deploy/setup-github-runner.sh")
    // O prazo é o que torna mudo o defeito, e ele vai dito.
    expect(linhas[0]).toContain("24h")
  })

  it("a idade vinda da AMOSTRA é declarada como tal", () => {
    const m = deriveRunnerQueue({
      forge: "github",
      queue: filaMedida(5, 3_600_000, { oldestFromSample: true }),
      pullers: [],
      nowMs,
    })
    expect(runnerQueueBlocker(m)[0]).toContain("medida na amostra lida")
  })

  it("só a forja PARADA gera bloqueio (as outras quatro metades não)", () => {
    for (const [queue, pullers] of [
      [filaMedida(0), [puxador({ status: "offline" })]],
      [filaMedida(2), [puxador({ busy: true })]],
      [filaMedida(2), [puxador()]],
      [{ ok: false, detail: "sem leitura" }, null],
    ] as [object, object[] | null][]) {
      const m = deriveRunnerQueue({ forge: "github", queue, pullers, nowMs })
      expect(m.state).not.toBe("parada")
      expect(runnerQueueBlocker(m)).toEqual([])
    }
  })

  it("a dúvida sai como dúvida (nunca como bloqueio)", () => {
    const m = deriveRunnerQueue({
      forge: "github",
      queue: filaMedida(2, 600_000),
      pullers: [puxador()],
      nowMs,
    })
    expect(runnerQueueUnknown(m)).toHaveLength(1)
    expect(runnerQueueUnknown(m)[0]).toContain("fila parada?")
    expect(runnerQueueBlocker(m)).toEqual([])
    expect(
      runnerQueueUnknown(
        deriveRunnerQueue({ forge: "gitea", queue: filaMedida(0), pullers: [], nowMs }),
      ),
    ).toEqual([])
  })
})

// ── dur ─────────────────────────────────────────────────────────────────────

describe("dur", () => {
  it("diz a idade na unidade em que ela é lida", () => {
    expect(dur(45_000)).toBe("45s")
    expect(dur(9 * 60_000)).toBe("9min")
    expect(dur((14 * 3600 + 3 * 60) * 1000)).toBe("14h03")
    expect(dur(26 * 3_600_000)).toBe("1d02h")
  })

  it("nada negativo e nada absurdo", () => {
    expect(dur(-1)).toBe("0s")
    expect(dur(0)).toBe("0s")
  })
})

// ── resolveGiteaDatabase ────────────────────────────────────────────────────

/** Um compose mínimo com o serviço que declara o banco. */
function compose(over: { servico?: string; extra?: string; semContainerName?: boolean } = {}) {
  const containerName = over.semContainerName ? "" : "    container_name: gitea\n"
  return [
    "services:",
    `  ${over.servico ?? "gitea"}:`,
    "    image: gitea/gitea:1.22",
    containerName,
    "    environment:",
    "      - GITEA__database__DB_TYPE=sqlite3",
    `      - GITEA__database__PATH=/data/gitea/gitea.db`,
    over.extra ?? "",
    "",
  ]
    .filter((l) => l !== "")
    .join("\n")
}

const semRun = () => ({ error: new Error("sem docker") })

describe("resolveGiteaDatabase — o container e o caminho DERIVADOS do compose", () => {
  it("no compose REAL: deriva o serviço, o container e o banco", () => {
    const r = resolveGiteaDatabase({ cwd: process.cwd() })
    expect(r.ok).toBe(true)
    expect(r.service).toBe("gitea")
    expect(r.container).toBe("gitea")
    expect(r.dbPath).toBe("/data/gitea/gitea.db")
    expect(r.dbType).toBe("sqlite3")
  })

  it("o serviço é AQUELE QUE DECLARA O BANCO — não o nome 'gitea'", () => {
    const r = resolveGiteaDatabase({
      cwd: "/tmp",
      readFile: () => compose({ servico: "forja" }),
    })
    expect(r).toMatchObject({ ok: true, service: "forja", container: "gitea" })
  })

  it("a forma DECLARADA (GITEA_CONTAINER) vence o `container_name` do compose", () => {
    const r = resolveGiteaDatabase({
      cwd: "/tmp",
      readFile: () => compose(),
      declarado: "ponta-gitea",
    })
    expect(r).toMatchObject({ ok: true, container: "ponta-gitea" })
    expect(r.detail).toContain(GITEA_CONTAINER_ENV)
  })

  it("sem `container_name`, o container sai do `docker ps` pelo service LABEL", () => {
    const chamadas: string[][] = []
    const run = (_bin: string, args: string[]) => {
      chamadas.push(args)
      return { status: 0, stdout: "a1b2-forja-1\n", stderr: "", error: null }
    }
    const r = resolveGiteaDatabase({
      cwd: "/tmp",
      readFile: () => compose({ semContainerName: true }),
      run,
    })
    expect(r).toMatchObject({ ok: true, container: "a1b2-forja-1" })
    expect(chamadas[0]).toContain("label=com.docker.compose.service=gitea")
    expect(r.detail).toContain("service label")
  })

  it("nenhum container rodando o serviço → não sei, nomeando o serviço", () => {
    const r = resolveGiteaDatabase({
      cwd: "/tmp",
      readFile: () => compose({ semContainerName: true }),
      run: () => ({ status: 0, stdout: "", stderr: "", error: null }),
    })
    expect(r.ok).toBe(false)
    expect(r.detail).toContain("nenhum container do serviço 'gitea' está rodando")
  })

  it("sem docker para resolver o nome, é 'não sei' e não um nome chutado", () => {
    const r = resolveGiteaDatabase({
      cwd: "/tmp",
      readFile: () => compose({ semContainerName: true }),
      run: semRun,
    })
    expect(r.ok).toBe(false)
    expect(r.detail).toContain("sem docker")
  })

  it("caminho INTERPOLADO é recusado (adivinhar seria uma segunda verdade sobre a stack)", () => {
    const r = resolveGiteaDatabase({
      cwd: "/tmp",
      readFile: () => compose().replace("/data/gitea/gitea.db", "${GITEA_DATA_DIR}/gitea.db"),
    })
    expect(r.ok).toBe(false)
    expect(r.detail).toContain("interpolado")
  })

  it("dois serviços com o banco declarado → não sei QUAL é a forja (e os dois são nomeados)", () => {
    const r = resolveGiteaDatabase({
      cwd: "/tmp",
      readFile: () =>
        [
          compose(),
          "  forja-velha:",
          "    image: gitea/gitea:1.21",
          "    container_name: gitea-velha",
          "    environment:",
          "      - GITEA__database__PATH=/data/gitea/gitea.db",
          "",
        ].join("\n"),
    })
    expect(r.ok).toBe(false)
    expect(r.detail).toContain("2 serviços")
    expect(r.detail).toContain("forja-velha")
  })

  it("nenhum serviço declara o banco → não sei qual container tem o banco", () => {
    const r = resolveGiteaDatabase({
      cwd: "/tmp",
      readFile: () => "services:\n  caddy:\n    image: caddy:2\n",
    })
    expect(r.ok).toBe(false)
    expect(r.detail).toContain("nenhum serviço")
  })

  it("compose sem `services` e compose ilegível são recusas NOMEADAS", () => {
    const semServicos = resolveGiteaDatabase({
      cwd: "/tmp",
      readFile: () => "version: '3'\n",
    })
    expect(semServicos.ok).toBe(false)
    expect(semServicos.detail).toContain("não tem a chave 'services'")

    const ilegivel = resolveGiteaDatabase({
      cwd: "/tmp",
      readFile: () => {
        throw new Error("ENOENT")
      },
    })
    expect(ilegivel.ok).toBe(false)
    expect(ilegivel.detail).toContain("ENOENT")
  })
})

// ── readGiteaQueue ──────────────────────────────────────────────────────────

const C = "gitea"
const DB = "/data/gitea/gitea.db"

/** O `docker exec … sqlite3 -json` dublado: cada consulta responde pela tabela. */
function sqlite({ id = '[{"repo_id":1}]', fila = "[]", runners = "[]" } = {}) {
  const chamadas: string[] = []
  const run = (_bin: string, args: string[]) => {
    const sql = args[args.length - 1]
    chamadas.push(sql)
    // A ORDEM das comparações importa: a consulta dos runners traz um subselect
    // em `repository` (o dono do repo), e um `includes` ingênuo a confundiria com
    // a consulta do id — a tabela do FROM é que diz qual consulta é qual.
    const stdout = /from action_runner\b/.test(sql)
      ? runners
      : /from action_run_job\b/.test(sql)
        ? fila
        : /from repository\b/.test(sql)
          ? id
          : ""
    return { status: 0, stdout, stderr: "", error: null }
  }
  return { run, chamadas }
}

describe("readGiteaQueue — a fila e quem a puxaria, no banco da forja", () => {
  const nowMs = Date.UTC(2026, 8, 24, 12, 0, 0)

  it("as três consultas, na ordem: repo → fila → runners", () => {
    const { run, chamadas } = sqlite({
      fila: `[{"aguardando":2,"mais_antiga":${nowMs / 1000 - 3600}}]`,
      runners: `[{"name":"vps-runner","version":"v0.6.1","last_online":${nowMs / 1000 - 3},"last_active":${nowMs / 1000 - 1}}]`,
    })
    const r = readGiteaQueue({
      cwd: "/repo",
      run,
      container: C,
      dbPath: DB,
      repo: "severinno/severinno",
      nowMs,
    })
    expect(r.ok).toBe(true)
    expect(chamadas).toHaveLength(3)
    expect(chamadas[0]).toContain("from repository")
    // A fila é `action_run_job` — a linha de `action_task` só nasce quando um
    // runner PEGA o job (e nasce `running`): lê-la aqui leria o trabalho, nunca
    // a espera. `task_id = 0` é o filtro do `CreateTaskForRunner` da forja.
    expect(chamadas[1]).toContain("from action_run_job")
    expect(chamadas[1]).toContain("task_id = 0")
    expect(chamadas[1]).toContain("status in (5)")
    expect(chamadas[2]).toContain("from action_runner")
    // O escopo dos runners: o do repo, o do dono e o global (system) — e o
    // deletado fora.
    expect(chamadas[2]).toContain("owner_id")
    expect(chamadas[2]).toContain("repo_id = 0 and owner_id = 0")
    expect(chamadas[2]).toContain("deleted = 0")
    expect(r.queue?.waiting).toBe(2)
    expect(r.queue?.oldestMs).toBe(3_600_000)
    // A forma dos "puxadores" é a MESMA das duas forjas (status/busy), com o
    // estado bruto da forja preservado ao lado.
    expect(r.runners).toEqual([
      { name: "vps-runner", version: "v0.6.1", status: "online", busy: true, raw: "active" },
    ])
  })

  it("runner IDLE é online e NÃO está pegando job (a segunda metade não se confunde)", () => {
    const { run } = sqlite({
      fila: `[{"aguardando":2,"mais_antiga":${nowMs / 1000 - 600}}]`,
      runners: `[{"name":"vps-runner","version":"v0.6.1","last_online":${nowMs / 1000 - 30},"last_active":${nowMs / 1000 - 120}}]`,
    })
    const r = readGiteaQueue({
      cwd: "/repo",
      run,
      container: C,
      dbPath: DB,
      repo: "severinno/severinno",
      nowMs,
    })
    expect(r.runners?.[0]).toMatchObject({ status: "online", busy: false, raw: "idle" })
  })

  it("o banco que não é o sqlite do compose é recusado ANTES de consultar", () => {
    const { run, chamadas } = sqlite()
    const r = readGiteaQueue({
      cwd: "/repo",
      run,
      container: C,
      dbPath: DB,
      dbType: "mysql",
      repo: "severinno/severinno",
      nowMs,
    })
    expect(r.ok).toBe(false)
    expect(r.detail).toContain("mysql")
    expect(chamadas).toEqual([])
  })

  it("slug fora da forma owner/name não chega ao SQL", () => {
    const { run, chamadas } = sqlite()
    const r = readGiteaQueue({
      cwd: "/repo",
      run,
      container: C,
      dbPath: DB,
      repo: "sem-barra",
      nowMs,
    })
    expect(r.ok).toBe(false)
    expect(chamadas).toEqual([])
  })

  it("repo que não existe no banco → NÃO SEI (a fila vazia falsa é o que se evita)", () => {
    const { run } = sqlite({ id: "" })
    const r = readGiteaQueue({
      cwd: "/repo",
      run,
      container: C,
      dbPath: DB,
      repo: "severinno/nao-existe",
      nowMs,
    })
    expect(r.ok).toBe(false)
    expect(r.detail).toContain("não existe no banco desta forja")
    expect(r.detail).toContain("severinno/nao-existe")
  })

  it("o `docker exec` que falhou é causa NOMEADA (nunca fila vazia)", () => {
    const r = readGiteaQueue({
      cwd: "/repo",
      run: () => ({ error: new Error("no such container") }),
      container: C,
      dbPath: DB,
      repo: "severinno/severinno",
      nowMs,
    })
    expect(r.ok).toBe(false)
    expect(r.detail).toContain("no such container")
  })

  it("exit ≠ 0 é recusa nomeada, no primeiro passo que falhar", () => {
    const falha = (_bin: string, args: string[]) => {
      const sql = args[args.length - 1]
      return sql.includes("from action_run_job")
        ? { status: 1, stdout: "", stderr: "no such table: action_run_job", error: null }
        : { status: 0, stdout: '[{"repo_id":1}]', stderr: "", error: null }
    }
    const r = readGiteaQueue({
      cwd: "/repo",
      run: falha,
      container: C,
      dbPath: DB,
      repo: "severinno/severinno",
      nowMs,
    })
    expect(r.ok).toBe(false)
    expect(r.detail).toContain("no such table: action_run_job")
  })
})

// ── readGithubQueue / readGithubQueueCli ────────────────────────────────────

describe("readGithubQueue — o canal da API", () => {
  const ok200 = async () => ({
    status: 200,
    data: { total_count: 1, workflow_runs: [{ id: 1, created_at: "2026-09-23T21:30:20Z" }] },
    text: "",
  })

  it("lê a fila pelo MESMO caminho de headers da API do repositório", async () => {
    const vistos: string[] = []
    const r = await readGithubQueue({
      token: "t",
      repo: "severinno/severinno",
      api: async (_cfg: object, method: string, path: string) => {
        vistos.push(`${method} ${path}`)
        return ok200()
      },
    })
    expect(r.ok).toBe(true)
    expect(r.waiting).toBe(1)
    expect(vistos[0]).toContain("GET /actions/runs?status=queued")
  })

  it("sem canal a metade é NÃO LIDA — um repo desconhecido devolveria fila limpa", async () => {
    for (const args of [{ token: null, repo: "a/b" }, { token: "t", repo: null }, {}]) {
      const r = await readGithubQueue(args)
      expect(r.ok).toBe(false)
      expect(r.detail).toContain("sem o canal do GitHub")
    }
  })

  it("401/403 é recusa nomeada COM o escopo que falta (o CI com GITHUB_TOKEN cai aqui)", async () => {
    const r = await readGithubQueue({
      token: "t",
      repo: "a/b",
      api: async () => ({ status: 403, data: null, text: "Forbidden" }),
    })
    expect(r.ok).toBe(false)
    expect(r.detail).toContain("HTTP 403")
    expect(r.detail).toContain("Actions: read")
  })

  it("a API que não respondeu é causa nomeada", async () => {
    const r = await readGithubQueue({
      token: "t",
      repo: "a/b",
      api: async () => {
        throw new Error("ECONNRESET")
      },
    })
    expect(r.ok).toBe(false)
    expect(r.detail).toContain("ECONNRESET")
  })

  it("200 com corpo inesperado não vira fila vazia", async () => {
    const r = await readGithubQueue({
      token: "t",
      repo: "a/b",
      api: async () => ({ status: 200, data: {}, text: "" }),
    })
    expect(r.ok).toBe(false)
    expect(r.detail).toContain("workflow_runs")
  })
})

describe("readGithubQueueCli — o segundo canal (a CLI `gh`)", () => {
  const payload = JSON.stringify({
    total_count: 1,
    workflow_runs: [{ id: 1, created_at: "2026-09-23T21:30:20Z" }],
  })

  it("sem GH_TOKEN, a fila sai da CLI que o host já autenticou", () => {
    const r = readGithubQueueCli({
      repo: "severinno/severinno",
      run: () => ({ status: 0, stdout: payload, stderr: "", error: null }),
    })
    expect(r.ok).toBe(true)
    expect(r.waiting).toBe(1)
  })

  it("sem `gh` instalado, o erro de spawn é causa nomeada", () => {
    const r = readGithubQueueCli({
      repo: "a/b",
      run: () => ({ status: null, stdout: "", stderr: "", error: new Error("spawn gh ENOENT") }),
    })
    expect(r.ok).toBe(false)
    expect(r.detail).toContain("spawn gh ENOENT")
  })

  it("sem runner de processo (o CI sem GH_TOKEN), a metade é NÃO LIDA", () => {
    const r = readGithubQueueCli({ repo: "a/b", run: null })
    expect(r.ok).toBe(false)
    expect(r.detail).toContain("sem o canal da API e sem runner de processo")
  })

  it("`gh` que saiu ≠ 0 nomeia o stderr (o pedido de escopo aparece aqui)", () => {
    const r = readGithubQueueCli({
      repo: "a/b",
      run: () => ({ status: 1, stdout: "", stderr: "gh: Resource not accessible", error: null }),
    })
    expect(r.ok).toBe(false)
    expect(r.detail).toContain("Resource not accessible")
  })

  it("saída que não é JSON não vira fila vazia", () => {
    const r = readGithubQueueCli({
      repo: "a/b",
      run: () => ({ status: 0, stdout: "not json", stderr: "", error: null }),
    })
    expect(r.ok).toBe(false)
    expect(r.detail).toContain("não é JSON")
  })
})

// ── readRunnerQueue (a agregação) ───────────────────────────────────────────

describe("readRunnerQueue — as duas forjas em um fato", () => {
  const nowMs = Date.UTC(2026, 8, 24, 12, 0, 0)

  /** O dublê do canal do GitHub. */
  const canal = () => ({
    via: "api",
    token: "t",
    repo: "severinno/severinno",
    baseUrl: "https://api.github.com",
  })

  /** O dublê do compose: a stack conhecida, com o banco declarado. */
  const dbok = () => ({
    ok: true,
    container: "gitea",
    dbPath: "/data/gitea/gitea.db",
    dbType: "sqlite3",
    service: "gitea",
    detail: "container 'gitea' · banco /data/gitea/gitea.db",
  })

  /** A metade da Gitea lida com a fila que se quiser. */
  const gitea =
    (waiting: number, runners: object[] = []) =>
    () => ({
      ok: true,
      queue: {
        ok: true,
        waiting,
        oldestMs: waiting > 0 ? 3_600_000 : null,
        oldestFromSample: false,
        items: [],
        detail: `${waiting} tarefa(s) em espera`,
      },
      runners,
      detail: `gitea · repo_id 1 · ${waiting} tarefa(s) em espera`,
    })

  /** O dublê da fila do GitHub, contando as chamadas à API. */
  const github = (waiting: number, created = "2026-09-23T21:30:20Z") => {
    const contador = { chamadas: 0 }
    return {
      contador,
      api: async () => {
        contador.chamadas += 1
        return {
          status: 200,
          data: {
            total_count: waiting,
            workflow_runs: waiting > 0 ? [{ id: 1, name: "PR Check", created_at: created }] : [],
          },
          text: "",
        }
      },
    }
  }

  it("a fila PARADA do espelho BLOQUEIA: 5 em espera e o runner offline", async () => {
    const gh = github(5)
    const fato = await readRunnerQueue({
      cwd: "/repo",
      repos: { gitea: "severinno/severinno", github: "severinno/severinno" },
      githubRunners: [{ name: "hostinger-runner", status: "offline", busy: false }],
      deps: { channel: canal, api: gh.api, resolveDb: dbok, readGitea: gitea(0) },
      nowMs,
    })
    expect(fato.state).toBe("stalled")
    expect(fato.stalled).toEqual(["github"])
    expect(fato.idle).toEqual(["gitea"])
    expect(fato.waiting).toBe(5)
    // 5 na fila e 1 lido: a data declara vir da AMOSTRA (é o que a linha do
    // bloqueio publica ao lado da idade).
    expect(fato.oldest).toMatchObject({ forge: "github", waiting: 5, fromSample: true })
    expect(fato.remedies.some((r: string) => r.includes("setup-github-runner.sh"))).toBe(true)
    expect(fato.detail).toContain("GitHub:")
    expect(fato.erros).toEqual([])
  })

  it("o registro do GitHub é lido UMA vez: a lista vem PRONTA, sem segunda consulta", async () => {
    const gh = github(5)
    const fato = await readRunnerQueue({
      cwd: "/repo",
      repos: { github: "severinno/severinno" },
      githubRunners: [{ name: "hostinger-runner", status: "offline", busy: false }],
      deps: { channel: canal, api: gh.api, resolveDb: dbok, readGitea: gitea(0) },
      nowMs,
    })
    expect(gh.contador.chamadas).toBe(1)
    expect(fato.forges.github.runners).toEqual([
      { name: "hostinger-runner", status: "offline", busy: false },
    ])
  })

  it("registro do GitHub NÃO LIDO (`null`) → a forja sai `unread`, nunca 'sem fila'", async () => {
    const fato = await readRunnerQueue({
      cwd: "/repo",
      repos: { github: "severinno/severinno" },
      githubRunners: null,
      deps: { channel: canal, api: github(5).api, resolveDb: dbok, readGitea: gitea(0) },
      nowMs,
    })
    expect(fato.forges.github.state).toBe("unread")
    expect(fato.unread).toEqual(["github"])
    // Zero runners REGISTRADOS (`[]`) é outra coisa: é a forja parada.
    expect(fato.forges.github.runners).toEqual([])
    // A forja lida com a fila vazia continua sendo uma MEDIÇÃO, e a soma ignora
    // o que não foi lido (contar a fila de uma forja a que não se olhou seria
    // inventar número).
    expect(fato.waiting).toBe(0)
    expect(fato.state).toBe("measured")
    // O aviso fica na METADE do espelho (a fila em si foi lida; quem não foi lido
    // é o registro de quem a puxaria).
    expect(fato.forges.github.detail).toContain("quem puxaria a fila não foi lido")
  })

  it("as DUAS não lidas → o fato inteiro é `unread`", async () => {
    const fato = await readRunnerQueue({
      cwd: "/repo",
      repos: {},
      githubRunners: null,
      deps: {
        channel: () => ({ via: "cli", token: null, repo: null, baseUrl: "https://api.github.com" }),
        api: github(0).api,
        resolveDb: () => ({
          ok: false,
          detail: "nenhum container do serviço 'gitea' está rodando",
        }),
        readGitea: gitea(0),
      },
      nowMs,
    })
    expect(fato.state).toBe("unread")
    expect(fato.unread.sort()).toEqual(["gitea", "github"])
    expect(fato.forges.gitea.detail).toContain("nenhum container")
    expect(fato.erros).toHaveLength(2)
  })

  it("a forma DECLARADA do container chega ao resolvedor (o ensaio se aponta)", async () => {
    const vistos: (string | null)[] = []
    await readRunnerQueue({
      cwd: "/repo",
      declarado: "ponta-gitea",
      repos: { gitea: "a/b" },
      githubRunners: [],
      deps: {
        resolveDb: (args: { declarado: string | null }) => {
          vistos.push(args.declarado)
          return dbok()
        },
        readGitea: gitea(0),
        channel: () => ({ via: "cli", repo: "a/b" }),
      },
      nowMs,
    })
    expect(vistos).toEqual(["ponta-gitea"])
  })

  it("o canal da CLI é usado quando o token não existe (os dois canais do espelho)", async () => {
    const cli = { chamadas: 0 }
    const fato = await readRunnerQueue({
      cwd: "/repo",
      repos: { github: "a/b" },
      githubRunners: [],
      deps: {
        channel: () => ({
          via: "cli",
          token: null,
          repo: "a/b",
          baseUrl: "https://api.github.com",
        }),
        api: async () => {
          throw new Error("a API não deveria ser chamada no caminho da CLI")
        },
        readGithubCli: ({ repo }: { repo: string }) => {
          cli.chamadas += 1
          expect(repo).toBe("a/b")
          return {
            ok: true,
            waiting: 0,
            oldestMs: null,
            oldestFromSample: false,
            items: [],
            detail: "0 run(s) em `queued`",
          }
        },
        resolveDb: dbok,
        readGitea: gitea(0),
      },
      nowMs,
    })
    expect(cli.chamadas).toBe(1)
    expect(fato.state).toBe("measured")
  })

  it("a exceção de uma forja não derruba o fato da outra (cada metade é o seu try)", async () => {
    const fato = await readRunnerQueue({
      cwd: "/repo",
      repos: { github: "a/b" },
      githubRunners: [],
      deps: {
        channel: canal,
        api: async () => {
          throw new Error("boom")
        },
        resolveDb: dbok,
        readGitea: gitea(0),
      },
      nowMs,
    })
    expect(fato.forges.github.state).toBe("unread")
    expect(fato.forges.gitea.state).toBe("ociosa")
    expect(fato.state).toBe("measured")
  })

  it("sem canal NENHUM para a fila, o GitHub não é lido (e não vira fila vazia)", async () => {
    const fato = await readRunnerQueue({
      cwd: "/repo",
      repos: {},
      githubRunners: [],
      deps: {
        channel: () => ({ via: "cli", token: null, repo: null, baseUrl: "https://api.github.com" }),
        api: github(0).api,
        resolveDb: dbok,
        readGitea: gitea(0),
      },
      nowMs,
    })
    expect(fato.forges.github.state).toBe("unread")
    expect(fato.forges.github.detail).toContain("GH_REPOSITORY")
  })

  it("a mais antiga das duas forjas é a que o fato reporta", async () => {
    const gh = { api: github(2, new Date(Date.now() - 120_000).toISOString()).api }
    const fato = await readRunnerQueue({
      cwd: "/repo",
      repos: { gitea: "a/b", github: "a/b" },
      githubRunners: [puxador({ busy: true })],
      deps: {
        channel: canal,
        api: gh.api,
        resolveDb: dbok,
        // A espera da Gitea é mais velha (3h) que a do GitHub (2min).
        readGitea: gitea(3),
      },
      nowMs,
    })
    expect(fato.oldest?.forge).toBe("gitea")
    expect(fato.oldest?.ms).toBe(3_600_000)
    expect(fato.draining).toEqual(["github"])
  })
})

// ── a fonte REAL ────────────────────────────────────────────────────────────

describe("a folha e a stack real", () => {
  it("o compose comitado declara o banco da forja — o que o resolvedor exige", () => {
    const texto = readFileSync(
      resolve(join(process.cwd(), "deploy/docker-compose.gitea.yml")),
      "utf8",
    )
    expect(texto).toContain("GITEA__database__PATH=/data/gitea/gitea.db")
    expect(texto).toContain("GITEA__database__DB_TYPE=sqlite3")
  })
})
