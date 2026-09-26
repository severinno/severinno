/**
 * prove-runner-queue-cycle.test.ts
 *
 * Testes de scripts/prove-runner-queue-cycle.mjs — a prova do CICLO da fila
 * (offline → online) numa forja efêmera.
 *
 * POR QUE ESTA FOLHA TEM TESTES PRÓPRIOS: o ensaio tem duas partes que decidem e
 * que rodam com I/O injetado — os LEITORES (a FILA em `action_run_job`, o log no
 * arquivo OU no DBFS do banco) e o JUIZ (`cycleVerdict`, puro). Uma prova cujo
 * juiz aceita uma fase "quase boa" mente com aparência de rigor: aqui a fila que
 * andou sem runner, o fato que não acusou `parada`, o remédio que não registrou e
 * o `success` SEM a marca do job têm, cada um, o seu caso — e cada caso diz qual
 * é o defeito, não só que falhou.
 *
 * O que NÃO se testa aqui: o ensaio de verdade (sobe Gitea + act_runner em
 * containers e leva ~4min) — esse é o `bun run runner-queue:prove`, documentado
 * em docs/GUARDS.md com o bloco `prove-doc` do cenário sem docker.
 */

import { describe, it, expect } from "vitest"
import {
  CYCLE_BRANCH,
  CYCLE_WORKFLOW,
  CYCLE_WORKFLOW_STEM,
  GREEN_MARKER,
  REMEDIO_DECLARADO,
  cycleVerdict,
  cycleWorkflow,
  jobImageParts,
  parseArgs,
  readCycleLog,
  readCycleQueue,
  taskStatuses,
} from "../../../scripts/prove-runner-queue-cycle.mjs"

// ── As constantes DECLARADAS ────────────────────────────────────────────────

describe("as constantes do ensaio", () => {
  it("o filtro das leituras é o RADICAL do workflow — o banco guarda `ciclo-da-fila.yml`", () => {
    // MEDIDO em 26/09/2026: a Gitea indexa `workflow_id` como o arquivo SEM o
    // prefixo `.gitea/workflows/`. Filtrar pelo caminho devolvia zero tarefas —
    // o "verde de nada" que a primeira rodada do ensaio publicou.
    expect(CYCLE_WORKFLOW).toBe(".gitea/workflows/ciclo-da-fila.yml")
    expect(CYCLE_WORKFLOW_STEM).toBe("ciclo-da-fila")
    expect(CYCLE_WORKFLOW.startsWith(".gitea/workflows/")).toBe(true)
  })

  it("a MARCA é o que o job imprime: o status sozinho não prova que o job rodou", () => {
    expect(GREEN_MARKER).toContain("CICLO-DA-FILA")
  })

  it("o remédio declarado é o script de RE-REGISTRO da casa (o mesmo que o bloqueio publica)", () => {
    expect(REMEDIO_DECLARADO).toBe("deploy/gitea-up.sh")
  })
})

// ── O workflow do ensaio ────────────────────────────────────────────────────

describe("cycleWorkflow", () => {
  it("dispara por PUSH na branch do ensaio e DECLARA o dispatch (a 1.22 não o tem)", () => {
    const yml = cycleWorkflow({ branch: "prova/ciclo" })
    expect(yml).toContain("branches: [prova/ciclo]")
    expect(yml).toContain("workflow_dispatch:")
    expect(yml).toContain(GREEN_MARKER)
    expect(yml).toContain("runs-on: ubuntu-latest")
  })

  it("os defaults vêm das constantes (a branch do ensaio, não uma qualquer)", () => {
    expect(cycleWorkflow()).toContain(`branches: [${CYCLE_BRANCH}]`)
  })
})

// ── O partidor da imagem do job ─────────────────────────────────────────────

describe("jobImageParts", () => {
  it("aceita `<registry>/<namespace>/ubuntu-bun:<versão>` e devolve as três partes", () => {
    const p = jobImageParts("ghcr.io/severinno/ubuntu-bun:1.3.14")
    expect(p.ok).toBe(true)
    expect(p.registry).toBe("ghcr.io")
    expect(p.namespace).toBe("severinno")
    expect(p.bun).toBe("1.3.14")
  })

  it("recusa uma referência fora da fórmula — os labels do runner saem dela", () => {
    const p = jobImageParts("ubuntu:24.04")
    expect(p.ok).toBe(false)
    expect(p.detail).toContain("não é uma referência de")
  })
})

// ── parseArgs ───────────────────────────────────────────────────────────────

describe("parseArgs", () => {
  /** A recusa NOMEADA de uma invocação (a união de retorno não carrega `error` em todo ramo). */
  const erroDe = (argv: string[]) => String((parseArgs(argv) as { error?: string }).error ?? "")

  it("os defaults: relatório humano, janela de 20s, o env comitado, a branch do ensaio", () => {
    const o = parseArgs([])
    expect(o.json).toBe(false)
    expect(o.keep).toBe(false)
    expect(o.semNoNewPrivileges).toBe(false)
    expect(o.silenceS).toBe(20)
    expect(o.jobImage).toBe(null)
    expect(o.branch).toBe(CYCLE_BRANCH)
    expect(erroDe([])).toBe("")
  })

  it("lê as flags e os valores (json, keep, imagem, janela, silêncio)", () => {
    const o = parseArgs([
      "--json",
      "--keep",
      "--sem-no-new-privileges",
      "--job-image",
      "ghcr.io/severinno/ubuntu-bun:1.3.14",
      "--timeout",
      "600",
      "--silencio",
      "5",
    ])
    expect(o.json).toBe(true)
    expect(o.keep).toBe(true)
    expect(o.semNoNewPrivileges).toBe(true)
    expect(o.jobImage).toBe("ghcr.io/severinno/ubuntu-bun:1.3.14")
    expect(o.timeoutS).toBe(600)
    expect(o.silenceS).toBe(5)
  })

  it("flag desconhecida e valor inválido são recusa NOMEADA (nunca um default silencioso)", () => {
    expect(erroDe(["--nao-existe"])).toContain("flag desconhecida")
    expect(erroDe(["--timeout", "0"])).toContain("--timeout inválido")
    expect(erroDe(["--silencio", "-1"])).toContain("--silencio inválido")
  })
})

// ── taskStatuses ────────────────────────────────────────────────────────────

describe("taskStatuses", () => {
  it("conta `total` (alguém pegou?), `terminal` (drenou?) e `outros`", () => {
    const s = taskStatuses([{ status: 1 }, { status: 2 }, { status: 6 }, { status: 1 }])
    expect(s.total).toBe(4)
    expect(s.success).toBe(2)
    expect(s.failure).toBe(1)
    expect(s.terminal).toBe(3)
    expect(s.outros).toBe(1)
  })

  it("lista vazia e lista ausente são zero MEDIDO (não erro)", () => {
    expect(taskStatuses([]).total).toBe(0)
    expect(taskStatuses(undefined as unknown as object[]).total).toBe(0)
  })
})

// ── readCycleQueue ──────────────────────────────────────────────────────────

describe("readCycleQueue — a FILA lida onde ela vive", () => {
  const agoraS = 1_800_000_000

  const captura = (stdout: string) => {
    const sqls: string[] = []
    const run = (_bin: string, args: string[]) => {
      sqls.push(args[args.length - 1])
      return { status: 0, stdout, stderr: "", error: null }
    }
    return { run, sqls }
  }

  it("consulta `action_run_job` (NUNCA `action_task`) com `task_id = 0` e `status in (5)`", () => {
    // A linha de `action_task` só nasce quando um runner PEGA o job — e nasce
    // `running`: lê-la aqui mediria o trabalho do runner, nunca a espera.
    const { run, sqls } = captura("")
    const r = readCycleQueue({
      container: "gitea",
      dbPath: "/data/gitea/gitea.db",
      owner: "prova",
      name: "ensaio",
      run,
    })
    expect(r.ok).toBe(true)
    expect(r.waiting).toBe(0)
    expect(sqls).toHaveLength(1)
    expect(sqls[0]).toContain("from action_run_job")
    expect(sqls[0]).not.toContain("from action_task")
    expect(sqls[0]).toContain("task_id = 0")
    expect(sqls[0]).toContain("status in (5)")
    expect(sqls[0]).toContain("owner_name = 'prova'")
    expect(sqls[0]).toContain("lower(p.lower_name) = lower('ensaio')")
  })

  it("a idade sai da linha mais ANTIGA da fila (segundos da forja → ms)", () => {
    const { run } = captura(`[{"created":${agoraS - 600}},{"created":${agoraS - 30}}]`)
    const r = readCycleQueue({
      container: "gitea",
      dbPath: "/data/gitea/gitea.db",
      run,
      nowMs: agoraS * 1000,
    })
    expect(r.ok).toBe(true)
    expect(r.waiting).toBe(2)
    expect(r.oldestMs).toBe(600_000)
  })

  it("saída vazia é FILA VAZIA medida; exit ≠ 0 é leitura que NÃO aconteceu", () => {
    const vazia = readCycleQueue({
      container: "gitea",
      dbPath: "/data/gitea/gitea.db",
      run: captura("").run,
    })
    expect(vazia.ok).toBe(true)
    expect(vazia.waiting).toBe(0)
    expect(vazia.oldestMs).toBe(null)

    const falha = readCycleQueue({
      container: "gitea",
      dbPath: "/data/gitea/gitea.db",
      run: () => ({ status: 1, stdout: "", stderr: "no such table: action_run_job", error: null }),
    })
    expect(falha.ok).toBe(false)
    expect(falha.detail).toContain("no such table: action_run_job")
  })
})

// ── readCycleLog ────────────────────────────────────────────────────────────

describe("readCycleLog — o log lido de ONDE a Gitea o guarda", () => {
  it("com `log_in_storage = 1` lê o ARQUIVO em `actions_log/` (`cat`, como o smoke)", () => {
    const vistos: string[] = []
    const run = (_bin: string, args: string[]) => {
      vistos.push(args.join(" "))
      return { status: 0, stdout: `linha\n${GREEN_MARKER}\n`, stderr: "", error: null }
    }
    const log = readCycleLog({
      container: "gitea",
      dbPath: "/data/gitea/gitea.db",
      logDir: "/data/gitea/actions_log",
      filename: "prova/ensaio/01/1.log",
      inStorage: true,
      run,
    })
    expect(log.ok).toBe(true)
    expect(log.log).toContain(GREEN_MARKER)
    expect(vistos[0]).toContain("cat /data/gitea/actions_log/prova/ensaio/01/1.log")
  })

  it("com o log no DBFS (o runner não fechou o stream), consulta as tabelas do banco", () => {
    // MEDIDO em 26/09/2026: o job fechou `success` com `log_in_storage = 0` e o
    // arquivo INEXISTENTE — o log inteiro estava no DBFS. Ler só o arquivo diria
    // "não consegui ler" sobre um log que existe.
    const vistos: string[] = []
    const run = (_bin: string, args: string[]) => {
      vistos.push(args[args.length - 1])
      return { status: 0, stdout: `log do dbfs\n${GREEN_MARKER}\n`, stderr: "", error: null }
    }
    const log = readCycleLog({
      container: "gitea",
      dbPath: "/data/gitea/gitea.db",
      logDir: "/data/gitea/actions_log",
      filename: "prova/ensaio/01/1.log",
      inStorage: false,
      run,
    })
    expect(log.ok).toBe(true)
    expect(log.log).toContain(GREEN_MARKER)
    expect(log.detail).toContain("dbfs")
    // O `group_concat` existe porque o DBFS guarda o log em BLOCOS de 32KB: sem
    // ele, uma marca partida na fronteira de dois blocos leria como ausente.
    expect(vistos[0]).toContain("dbfs_data")
    expect(vistos[0]).toContain("dbfs_meta")
    expect(vistos[0]).toContain("group_concat")
    expect(vistos[0]).toContain("prova/ensaio/01/1.log")
  })

  it("falha de leitura é causa NOMEADA, nunca um log vazio silencioso", () => {
    const log = readCycleLog({
      container: "gitea",
      dbPath: "/data/gitea/gitea.db",
      logDir: "/data/gitea/actions_log",
      filename: "prova/ensaio/01/1.log",
      inStorage: false,
      run: () => ({ status: 1, stdout: "", stderr: "no such table: dbfs_data", error: null }),
    })
    expect(log.ok).toBe(false)
    expect(log.log).toBe("")
    expect(log.detail).toContain("no such table: dbfs_data")
  })
})

// ── cycleVerdict ────────────────────────────────────────────────────────────

describe("cycleVerdict — o juiz do ciclo", () => {
  const silencioOk = (over: Record<string, unknown> = {}) => ({
    ok: true,
    waiting: 1,
    oldestMs: 21_000,
    detail: "a fila apareceu em 2.1s e continuou parada por 20s",
    statuses: { total: 0, waiting: 0, success: 0, failure: 0, outros: 0, terminal: 0 },
    apareceu: true,
    esperouS: "2.1",
    ...over,
  })
  const fatoOk = (over: Record<string, unknown> = {}) => ({
    ok: true,
    state: "parada",
    waiting: 1,
    oldestMs: 21_000,
    blocker: `o runner da forja Gitea está FORA DO AR com run na FILA ... Remédio: \`bash ${REMEDIO_DECLARADO}\` no host da forja`,
    remedioDito: true,
    detail: "1 item(ns) esperando e NENHUM runner online",
    ...over,
  })
  const remedioOk = (over: Record<string, unknown> = {}) => ({
    registered: true,
    detail: "'gitea-runner' registrou (estado 'running')",
    ...over,
  })
  const drenagemOk = (over: Record<string, unknown> = {}) => ({
    ok: true,
    detail: "4343 bytes (dbfs do banco) lido do job prova/ensaio/01/1.log",
    statuses: { total: 1, waiting: 0, success: 1, failure: 0, outros: 0, terminal: 1 },
    marca: true,
    ...over,
  })

  it("as quatro fases completas dão `proven`", () => {
    const v = cycleVerdict({
      silencio: silencioOk(),
      fato: fatoOk(),
      remedio: remedioOk(),
      drenagem: drenagemOk(),
    })
    expect(v.state).toBe("proven")
    expect(v.detail).toContain("drenou até `success` com a marca")
  })

  it("fase A que não deu para ler é INDETERMINADA com a causa (nunca 'sem fila')", () => {
    const v = cycleVerdict({
      silencio: { ...silencioOk(), ok: false, detail: "no such table: action_run_job" },
      fato: fatoOk(),
      remedio: remedioOk(),
      drenagem: drenagemOk(),
    })
    expect(v.state).toBe("unavailable")
    expect(v.detail).toContain("no such table: action_run_job")
  })

  it("fase A com tarefa TERMINAL é violação: a fila ANDOU sem runner nenhum", () => {
    const v = cycleVerdict({
      silencio: silencioOk({
        statuses: { total: 1, waiting: 0, success: 1, failure: 0, outros: 0, terminal: 1 },
      }),
      fato: fatoOk(),
      remedio: remedioOk(),
      drenagem: drenagemOk(),
    })
    expect(v.state).toBe("violated")
    expect(v.detail).toContain("a fila ANDOU sem runner nenhum")
  })

  it("fase A com QUALQUER linha de `action_task` é violação: alguém PEGOU a fila", () => {
    // Uma linha de `action_task` nasce SÓ quando um runner pega o job — mesmo sem
    // desfecho ainda, ela prova que o silêncio não era silêncio.
    const v = cycleVerdict({
      silencio: silencioOk({
        statuses: { total: 1, waiting: 0, success: 0, failure: 0, outros: 1, terminal: 0 },
      }),
      fato: fatoOk(),
      remedio: remedioOk(),
      drenagem: drenagemOk(),
    })
    expect(v.state).toBe("violated")
    expect(v.detail).toContain("a fila foi PEGA sem runner nenhum")
  })

  it("fase A sem job na fila é INDETERMINADA: o ensaio não mediria o ciclo", () => {
    const v = cycleVerdict({
      silencio: silencioOk({ waiting: 0, apareceu: false, esperouS: "120.0" }),
      fato: fatoOk(),
      remedio: remedioOk(),
      drenagem: drenagemOk(),
    })
    expect(v.state).toBe("unavailable")
    expect(v.detail).toContain("não deixou job em `waiting` na FILA")
  })

  it("fase B que leu outro estado é violação (o doctor não publicaria o bloqueio)", () => {
    const v = cycleVerdict({
      silencio: silencioOk(),
      fato: fatoOk({ state: "ociosa", waiting: 0 }),
      remedio: remedioOk(),
      drenagem: drenagemOk(),
    })
    expect(v.state).toBe("violated")
    expect(v.detail).toContain("NÃO acusou a fila parada")
  })

  it("fase B sem o comando de re-registro na linha é violação (o bloqueio não diz o que fazer)", () => {
    const v = cycleVerdict({
      silencio: silencioOk(),
      fato: fatoOk({ remedioDito: false, blocker: "o runner da forja está fora do ar" }),
      remedio: remedioOk(),
      drenagem: drenagemOk(),
    })
    expect(v.state).toBe("violated")
    expect(v.detail).toContain(REMEDIO_DECLARADO)
  })

  it("fase C que não registrou é INDETERMINADA com a causa", () => {
    const v = cycleVerdict({
      silencio: silencioOk(),
      fato: fatoOk(),
      remedio: remedioOk({ registered: false, detail: "operation not permitted" }),
      drenagem: drenagemOk(),
    })
    expect(v.state).toBe("unavailable")
    expect(v.detail).toContain("operation not permitted")
  })

  it("fase D que drenou VERMELHO é violação (o remédio trouxe o runner, o job não fecha)", () => {
    const v = cycleVerdict({
      silencio: silencioOk(),
      fato: fatoOk(),
      remedio: remedioOk(),
      drenagem: drenagemOk({
        statuses: { total: 1, waiting: 0, success: 0, failure: 1, outros: 0, terminal: 1 },
      }),
    })
    expect(v.state).toBe("violated")
    expect(v.detail).toContain("drenou VERMELHO")
  })

  it("fase D que não drenou dentro da janela é INDETERMINADA (não deu tempo de medir)", () => {
    const v = cycleVerdict({
      silencio: silencioOk(),
      fato: fatoOk(),
      remedio: remedioOk(),
      drenagem: drenagemOk({
        statuses: { total: 0, waiting: 0, success: 0, failure: 0, outros: 0, terminal: 0 },
      }),
    })
    expect(v.state).toBe("unavailable")
    expect(v.detail).toContain("NÃO drenou dentro da janela")
  })

  it("fase D com `success` SEM a marca é violação: status que muda sem o job não é o ciclo", () => {
    const v = cycleVerdict({
      silencio: silencioOk(),
      fato: fatoOk(),
      remedio: remedioOk(),
      drenagem: drenagemOk({ marca: false, detail: "não consegui ler o log no DBFS (exit 1)" }),
    })
    expect(v.state).toBe("violated")
    expect(v.detail).toContain("SEM a marca do job no log")
  })
})
