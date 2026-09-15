/**
 * check-actrc-sync.test.ts
 *
 * Testes do guard PERIÓDICO dos espelhos das variáveis que o compose da forja
 * consome — BUN_VERSION, IMAGE_REGISTRY e IMAGE_NAMESPACE: o `.actrc` (espelho
 * local do act) e os arquivos de env da forja (`deploy/env.gitea.example` e, no
 * checkout que roda a stack, o `deploy/.env.gitea` do host) —
 * scripts/check-actrc-sync.mjs.
 *
 * O guard estático (check-bun-mirror.mjs, check-registry-source.mjs) valida que
 * cada espelho DEFINE a variável (a linha `--var BUN_VERSION=...`, a flag
 * `--var IMAGE_REGISTRY=`, a declaração do nome no template), mas NÃO pode
 * conferir se o VALOR bate com a repository variable — impossível estaticamente
 * (a variável remota só existe em runtime no Actions/na forja). Este guard
 * compara os VALORES e emite `::warning::` (NÃO-bloqueante no GitHub; `--fail`
 * na forja) se divergirem: o job semanal `actrc-sync` passa o valor real de
 * cada variável (`--expected` para a versão, `--expected-var NOME=VALOR` para
 * as demais) e o script lê os espelhos do working tree.
 *
 * Cobre:
 *   - extractActrcVar / extractEnvVar (linha --var NOME= / NOME=, export,
 *     aspas, comentário — o env é quase todo prosa, então o decoy importa)
 *   - readMirrorVariableValues / normalizeExpectedVars (o conjunto inteiro, e a
 *     diferença entre "não perguntado" e "não configurado")
 *   - mirrorDriftReport (o drift POR VARIÁVEL e POR ESPELHO, com o valor lido e
 *     a régua; `unproven` nomeia o que não foi comparado)
 *   - o CONTRATO do conjunto comparado: MIRROR_VARIABLES + SECRET_MIRROR_VARIABLES
 *     = as variáveis que o compose consome (nada entra só com a checagem de
 *     existência)
 *   - actrcSyncWarnings / envMirrorSyncWarnings (em sincronia = zero avisos;
 *     divergência = aviso com ambos os valores; sem valor = aviso fail-closed)
 *   - CLI (--expected/--expected-var/--actrc/--gitea-env/--fail, exit 0 aviso /
 *     1 fail / 2 uso inválido; env ausente é ignorado, não é drift)
 *
 * Sem rede: as funções recebem o conteúdo diretamente; os testes CLI usam
 * spawnSync com arquivos temporários.
 */

import { describe, it, expect, afterAll } from "vitest"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  extractActrcBunVersion,
  extractActrcVar,
  actrcSyncWarnings,
  extractEnvMirrorBunVersion,
  extractEnvVar,
  envMirrorSyncWarnings,
  mirrorDriftReport,
  normalizeExpectedVars,
  readMirrorVariableValues,
  GITEA_ENV_MIRROR,
  MIRROR_VARIABLE_RULES,
  MIRROR_VARIABLES,
  SECRET_MIRROR_VARIABLES,
} from "../../../scripts/check-actrc-sync.mjs"
import {
  COMPOSE_ENV_VARIABLES,
  composeEnvVariables,
} from "../../../scripts/check-registry-source.mjs"

// Caminho do módulo para os testes CLI (spawn do node). Usa process.cwd()
// (raiz do projeto no vitest) — NÃO usar fileURLToPath(new URL(...)): o
// import.meta.url do vitest não tem scheme file.
const MODULE_PATH = join(process.cwd(), "scripts", "check-actrc-sync.mjs")

const tmpDirs: string[] = []

function makeTmpFile(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "check-actrc-sync-"))
  tmpDirs.push(dir)
  const p = join(dir, name)
  writeFileSync(p, content)
  return p
}

function makeTmpActrc(content: string): string {
  return makeTmpFile(".actrc", content)
}

/**
 * Espelho do runner da forja — sempre explícito nos testes CLI.
 *
 * POR QUE explícito: o default do script é `deploy/env.gitea.example` relativo
 * ao cwd, e o cwd nos testes É o repo. Deixar o default agir faria os testes de
 * `.actrc` lerem o arquivo real — ficariam verdes só enquanto ele estivesse em
 * sincronia, e a asserção `not.toContain("::warning::")` viraria um teste do
 * arquivo de deploy em vez do comportamento sob teste.
 */
function makeTmpEnv(content: string): string {
  return makeTmpFile(".env.gitea", content)
}

/**
 * Um checkout em miniatura, com a MESMA forma do repo: `.actrc` na raiz e os
 * arquivos de env em `deploy/`. É o único jeito de exercitar a DESCOBERTA (o
 * guard resolve os espelhos a partir do cwd) sem ler os arquivos do repo real.
 */
function makeTmpRepo(opts: {
  actrc?: string | null
  template?: string | null
  deployed?: string | null
}): string {
  const dir = mkdtempSync(join(tmpdir(), "check-actrc-sync-repo-"))
  tmpDirs.push(dir)
  mkdirSync(join(dir, "deploy"), { recursive: true })
  if (opts.actrc !== null) writeFileSync(join(dir, ".actrc"), opts.actrc ?? ACTRC_1_3_14)
  if (opts.template !== null) {
    writeFileSync(join(dir, "deploy", "env.gitea.example"), opts.template ?? ENV_1_3_14)
  }
  if (opts.deployed !== null && opts.deployed !== undefined) {
    writeFileSync(join(dir, "deploy", ".env.gitea"), opts.deployed)
  }
  return dir
}

afterAll(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

// ── fixtures (.actrc) ─────────────────────────────────────────────────────

// O `.actrc` REAL do repo espelha DUAS variáveis (BUN_VERSION e IMAGE_REGISTRY
// — a versão e o registry da imagem). O fixture abaixo tem a mesma forma de
// propósito: um `.actrc` de teste só com a versão faria o guard acusar o
// registry ausente, e os casos de "em sincronia" mediriam uma divergência que o
// repositório não tem.
const ACTRC_1_3_14 = `# .actrc — espelho local da repository variable
--var BUN_VERSION=1.3.14
--var IMAGE_REGISTRY=ghcr.io
`

const ACTRC_1_4_0 = `# .actrc — espelho local da repository variable
--var BUN_VERSION=1.4.0
--var IMAGE_REGISTRY=ghcr.io
`

const ACTRC_QUOTED = `--var BUN_VERSION="1.3.14"
`

const ACTRC_WITHOUT_BUN = `# .actrc sem a linha BUN_VERSION
--var OTHER=foo
`

const ACTRC_EMPTY = ``

// Comentário que CONTÉM o padrão --var BUN_VERSION= ANTES da linha real — a
// regex ancorada ao início da linha não pode ser enganada pelo comentário.
const ACTRC_COMMENT_DECOY = `# exemplo: --var BUN_VERSION=2.0 (desatualizado)
--var BUN_VERSION=1.3.14
`

// ── fixtures (env do runner da forja) ───────────────────────────────────────
// É `deploy/env.gitea.example`: quase todo comentário de prosa, com três
// variáveis no fim. O decoy abaixo existe porque um header REALMENTE contém
// `BUN_VERSION=1.4.0` como exemplo (o arquivo do repo documenta a variável
// citando a versão) — se o match não ignorasse comentário, o guard leria o
// exemplo do header em vez do valor de verdade.

const ENV_1_3_14 = `# .env.gitea — variaveis do Gitea + Caddy + Runner
# ⚠️ O BUN_VERSION daqui precisa ser IGUAL a repository variable
IMAGE_REGISTRY=ghcr.io
IMAGE_NAMESPACE=severinno
BUN_VERSION=1.3.14
`

const ENV_1_4_0 = `# .env.gitea — variaveis do Gitea + Caddy + Runner
IMAGE_REGISTRY=ghcr.io
IMAGE_NAMESPACE=severinno
BUN_VERSION=1.4.0
`

const ENV_EXPORT_QUOTED = `export BUN_VERSION="1.3.14"
`

const ENV_COMMENT_DECOY = `# exemplo historico: BUN_VERSION=1.4.0 (nao use)
IMAGE_REGISTRY=ghcr.io
BUN_VERSION=1.3.14
`

const ENV_WITHOUT_BUN = `# sem a linha BUN_VERSION
IMAGE_REGISTRY=ghcr.io
`

// ── extractActrcBunVersion ────────────────────────────────────────────────

describe("extractActrcBunVersion", () => {
  it("extrai o valor de '--var BUN_VERSION=1.3.14'", () => {
    expect(extractActrcBunVersion(ACTRC_1_3_14)).toBe("1.3.14")
  })

  it("tolera aspas em volta do valor", () => {
    expect(extractActrcBunVersion(ACTRC_QUOTED)).toBe("1.3.14")
  })

  it("ignora comentário que CONTÉM o padrão antes da linha real (regex ancorada)", () => {
    expect(extractActrcBunVersion(ACTRC_COMMENT_DECOY)).toBe("1.3.14")
  })

  it("retorna null se o .actrc não definir BUN_VERSION", () => {
    expect(extractActrcBunVersion(ACTRC_WITHOUT_BUN)).toBeNull()
    expect(extractActrcBunVersion(ACTRC_EMPTY)).toBeNull()
  })
})

// ── actrcSyncWarnings ─────────────────────────────────────────────────────

describe("actrcSyncWarnings", () => {
  it("em sincronia (.actrc == vars.BUN_VERSION) → zero avisos", () => {
    expect(actrcSyncWarnings("1.3.14", "1.3.14")).toEqual([])
  })

  it("divergência → aviso com AMBOS os valores (actrc vs vars.BUN_VERSION)", () => {
    const w = actrcSyncWarnings("1.4.0", "1.3.14")
    expect(w.length).toBe(1)
    expect(w[0]).toContain("1.4.0")
    expect(w[0]).toContain("1.3.14")
    expect(w[0]).toContain("vars.BUN_VERSION")
  })

  it(".actrc sem BUN_VERSION (null) → aviso fail-closed com o valor esperado", () => {
    const w = actrcSyncWarnings(null, "1.3.14")
    expect(w.length).toBe(1)
    expect(w[0]).toContain("NÃO define BUN_VERSION")
    expect(w[0]).toContain("1.3.14")
  })
})

// ── extractEnvMirrorBunVersion ────────────────────────────────────────────

describe("extractEnvMirrorBunVersion", () => {
  it("extrai o valor de 'BUN_VERSION=1.3.14' do env da forja", () => {
    expect(extractEnvMirrorBunVersion(ENV_1_3_14)).toBe("1.3.14")
  })

  it("tolera 'export ' e aspas em volta do valor", () => {
    expect(extractEnvMirrorBunVersion(ENV_EXPORT_QUOTED)).toBe("1.3.14")
  })

  it("ignora comentário que CONTÉM o padrão antes da linha real (regex ancorada)", () => {
    expect(extractEnvMirrorBunVersion(ENV_COMMENT_DECOY)).toBe("1.3.14")
  })

  it("retorna null se o env não definir BUN_VERSION", () => {
    expect(extractEnvMirrorBunVersion(ENV_WITHOUT_BUN)).toBeNull()
    expect(extractEnvMirrorBunVersion("")).toBeNull()
  })
})

// ── envMirrorSyncWarnings ─────────────────────────────────────────────────

describe("envMirrorSyncWarnings", () => {
  it("em sincronia (env == vars.BUN_VERSION) → zero avisos", () => {
    expect(envMirrorSyncWarnings("1.3.14", "1.3.14")).toEqual([])
  })

  it("divergência → aviso com AMBOS os valores e o rótulo do arquivo", () => {
    const w = envMirrorSyncWarnings("1.4.0", "1.3.14")
    expect(w.length).toBe(1)
    expect(w[0]).toContain("1.4.0")
    expect(w[0]).toContain("1.3.14")
    expect(w[0]).toContain(GITEA_ENV_MIRROR)
  })

  it("diz o CUSTO do drift: o fast path do tier-1 desliga em silêncio", () => {
    // Sem isso o aviso seria indistinguível do aviso do .actrc — e quem lê não
    // saberia que o custo aqui é lentidão de TODO job da forja, não do act local.
    const w = envMirrorSyncWarnings("1.4.0", "1.3.14")
    expect(w[0]).toContain("tier-1")
    expect(w[0]).toContain("silêncio")
  })

  it("env sem BUN_VERSION (null) → aviso fail-closed com a linha a adicionar", () => {
    const w = envMirrorSyncWarnings(null, "1.3.14")
    expect(w.length).toBe(1)
    expect(w[0]).toContain("NÃO define BUN_VERSION")
    expect(w[0]).toContain("BUN_VERSION=<versão>")
    expect(w[0]).toContain("1.3.14")
  })

  it("aceita um rótulo próprio (o VPS lê deploy/.env.gitea, não o .example)", () => {
    const w = envMirrorSyncWarnings("1.4.0", "1.3.14", "deploy/.env.gitea")
    expect(w[0]).toContain("deploy/.env.gitea")
    expect(w[0]).not.toContain(GITEA_ENV_MIRROR)
  })
})

// ── modo CLI (spawn do módulo, sem rede) ───────────────────────────────────

describe("modo CLI (spawn do módulo)", () => {
  /**
   * Spawn com os DOIS espelhos sempre explícitos (ver makeTmpEnv).
   */
  function run(
    args: string[],
    cwd?: string,
  ): { status: number | null; stdout: string; stderr: string } {
    const res = spawnSync(process.execPath, [MODULE_PATH, ...args], {
      encoding: "utf8",
      // `cwd` só quando o teste quer exercitar a DESCOBERTA de espelhos (o guard
      // resolve os caminhos a partir do cwd); com `--actrc`/`--gitea-env`
      // explícitos o cwd é irrelevante.
      ...(cwd ? { cwd } : {}),
    })
    return { status: res.status, stdout: res.stdout, stderr: res.stderr }
  }

  it("os dois espelhos em sincronia → exit 0 e mensagem de PASS", () => {
    const res = run([
      "--expected",
      "1.3.14",
      "--actrc",
      makeTmpActrc(ACTRC_1_3_14),
      "--gitea-env",
      makeTmpEnv(ENV_1_3_14),
    ])
    expect(res.status).toBe(0)
    expect(res.stdout).toContain("✅ espelhos da variável em sincronia")
    expect(res.stdout).not.toContain("::warning::")
  })

  it("divergência do .actrc → exit 0 (aviso NÃO-bloqueante) com ::warning:: e ambos os valores", () => {
    const res = run([
      "--expected",
      "1.3.14",
      "--actrc",
      makeTmpActrc(ACTRC_1_4_0),
      "--gitea-env",
      makeTmpEnv(ENV_1_3_14),
    ])
    expect(res.status).toBe(0)
    expect(res.stdout).toContain("::warning::")
    expect(res.stdout).toContain("1.4.0")
    expect(res.stdout).toContain("1.3.14")
  })

  it("divergência do ENV do runner (só dele) → aviso nomeando o arquivo do runner", () => {
    const envPath = makeTmpEnv(ENV_1_4_0)
    const res = run([
      "--expected",
      "1.3.14",
      "--actrc",
      makeTmpActrc(ACTRC_1_3_14),
      "--gitea-env",
      envPath,
    ])
    expect(res.status).toBe(0)
    expect(res.stdout).toContain("::warning::")
    // O rótulo é o CAMINHO passado (o VPS lê deploy/.env.gitea, não o .example)
    expect(res.stdout).toContain(envPath)
    expect(res.stdout).toContain("1.4.0")
    expect(res.stdout).toContain("1.3.14")
  })

  it("divergência dos DOIS espelhos → dois avisos (um por espelho, não um só)", () => {
    const res = run([
      "--expected",
      "1.3.14",
      "--actrc",
      makeTmpActrc(ACTRC_1_4_0),
      "--gitea-env",
      makeTmpEnv(ENV_1_4_0),
    ])
    expect(res.status).toBe(0)
    expect(res.stdout.match(/::warning::/g)?.length).toBe(2)
  })

  it("--gitea-env apontando para arquivo INEXISTENTE → exit 2 (você pediu ESTE arquivo)", () => {
    // Ausência nos espelhos DESCOBERTOS é ignorada; aqui a pergunta foi
    // explícita, e uma checagem que não acontece sem avisar é pior que nenhuma.
    const res = run([
      "--expected",
      "1.3.14",
      "--actrc",
      makeTmpActrc(ACTRC_1_3_14),
      "--gitea-env",
      "/nope/.env.gitea",
    ])
    expect(res.status).toBe(2)
    expect(res.stderr).toContain("inexistente")
  })

  it("divergência com --fail → exit 1 (modo estrito, para validação local/CI)", () => {
    const res = run([
      "--expected",
      "1.3.14",
      "--actrc",
      makeTmpActrc(ACTRC_1_4_0),
      "--gitea-env",
      makeTmpEnv(ENV_1_3_14),
      "--fail",
    ])
    expect(res.status).toBe(1)
    expect(res.stdout).toContain("::warning::")
  })

  it("divergência só do ENV com --fail → exit 1 (o espelho do runner também é bloqueante no modo estrito)", () => {
    const res = run([
      "--expected",
      "1.3.14",
      "--actrc",
      makeTmpActrc(ACTRC_1_3_14),
      "--gitea-env",
      makeTmpEnv(ENV_1_4_0),
      "--fail",
    ])
    expect(res.status).toBe(1)
    expect(res.stdout).toContain("::warning::")
  })

  it("sem --expected → exit 2 com mensagem de uso", () => {
    const res = run(["--actrc", makeTmpActrc(ACTRC_1_3_14)])
    expect(res.status).toBe(2)
    expect(res.stderr).toContain("--expected")
  })

  it("--expected VAZIO (variável ausente no repo — expressão não definida vira '') → exit 0 com ::warning:: de variável não configurada", () => {
    const res = run(["--expected", "", "--actrc", makeTmpActrc(ACTRC_1_3_14)])
    expect(res.status).toBe(0)
    expect(res.stdout).toContain("::warning::")
    expect(res.stdout).toContain("vars.BUN_VERSION NÃO configurada")
  })

  it("--expected VAZIO + --fail → exit 1 (a ausência da variável é o drift mais grave; modo estrito falha igual à divergência)", () => {
    const res = run(["--expected", "", "--actrc", makeTmpActrc(ACTRC_1_3_14), "--fail"])
    expect(res.status).toBe(1)
    expect(res.stdout).toContain("::warning::")
    expect(res.stdout).toContain("vars.BUN_VERSION NÃO configurada")
  })

  it(".actrc inexistente → exit 2", () => {
    const res = run(["--expected", "1.3.14", "--actrc", "/nope/.actrc"])
    expect(res.status).toBe(2)
    expect(res.stderr).toContain("não encontrado")
  })

  // ── descoberta dos espelhos de env (o arquivo do HOST entra na conta) ──

  describe("descoberta dos espelhos de env", () => {
    it("só o template no workspace → compara o template", () => {
      const dir = makeTmpRepo({ deployed: null })
      const res = run(["--expected", "1.3.14"], dir)
      expect(res.status).toBe(0)
      expect(res.stdout).toContain("deploy/env.gitea.example")
      expect(res.stdout).not.toContain("::warning::")
    })

    it("o deploy/.env.gitea do HOST é comparado — e o aviso nomeia ELE", () => {
      // O caso que motivou a extensão: num checkout do VPS o arquivo do host
      // existe, é o que o compose lê, e antes ele ficava INVISÍVEL (o guard
      // olhava só o template e dizia "em sincronia").
      const dir = makeTmpRepo({ deployed: ENV_1_4_0 })
      const res = run(["--expected", "1.3.14"], dir)
      expect(res.status).toBe(0)
      expect(res.stdout).toContain("::warning::")
      expect(res.stdout).toContain("deploy/.env.gitea")
      expect(res.stdout).toContain("1.4.0")
      expect(res.stdout).toContain("1.3.14")
    })

    it("HOST divergente → o remédio manda mexer no arquivo do host, não no template comitado", () => {
      const dir = makeTmpRepo({ deployed: ENV_1_4_0 })
      const res = run(["--expected", "1.3.14"], dir)
      // Editar o template não conserta a máquina que já está rodando.
      expect(res.stdout).toContain("o arquivo que o compose lê")
      expect(res.stdout).toContain("gitea-up.sh")
    })

    it("template E host divergindo → DOIS avisos (um por arquivo, não um genérico)", () => {
      const dir = makeTmpRepo({ template: ENV_1_4_0, deployed: ENV_1_4_0 })
      const res = run(["--expected", "1.3.14"], dir)
      expect(res.status).toBe(0)
      expect(res.stdout.match(/::warning::/g)?.length).toBe(2)
    })

    it("nem template nem host → PASS diz que o env foi ignorado (não finge cobertura)", () => {
      const dir = makeTmpRepo({ template: null, deployed: null })
      const res = run(["--expected", "1.3.14"], dir)
      expect(res.status).toBe(0)
      expect(res.stdout).not.toContain("::warning::")
      expect(res.stdout).toContain("ausente, ignorado")
    })

    it("--gitea-env SOBREPÕE a descoberta (o host passa a ser outro arquivo)", () => {
      const dir = makeTmpRepo({ deployed: ENV_1_4_0 })
      const outro = makeTmpEnv(ENV_1_3_14)
      const res = run(["--expected", "1.3.14", "--gitea-env", outro], dir)
      // O arquivo divergente do checkout NÃO é olhado; só o que foi apontado.
      expect(res.status).toBe(0)
      expect(res.stdout).not.toContain("::warning::")
      expect(res.stdout).toContain(outro)
      expect(res.stdout).not.toContain("deploy/.env.gitea")
    })
  })

  // ── o espelho REAL do repositório ──────────────────────────────────────
  // O default é relativo ao cwd — este teste prende a ligação entre o script e
  // o arquivo comitado: se alguém mover/renomear `deploy/env.gitea.example`, o
  // guard passa a ignorá-lo em silêncio e nenhum dos dois avisos volta a
  // existir. Aqui o arquivo real é lido com a versão que ele MESMO declara.
  it("o espelho comitado do repo existe no caminho default e está em sincronia consigo mesmo", () => {
    const envContent = readFileSync(join(process.cwd(), GITEA_ENV_MIRROR), "utf8")
    const realVersion = extractEnvMirrorBunVersion(envContent)
    expect(realVersion).not.toBeNull()

    const res = run([
      "--expected",
      realVersion as string,
      "--actrc",
      makeTmpActrc(ACTRC_1_3_14),
      // sem --gitea-env: usa o default (deploy/env.gitea.example do cwd)
    ])
    expect(res.status).toBe(0)
    expect(res.stdout).not.toContain("ausente, ignorado")
    expect(res.stdout).not.toContain("::warning::")
    expect(res.stdout).toContain("✅ espelhos da variável em sincronia")
  })
})

// ═════════════════════════════════════════════════════════════════════════‖
// mirrorDriftReport — a fonte UNICA das duas metades do guard periodico
// ═════════════════════════════════════════════════════════════════════════
//
// O CLI (que imprime avisos e decide o exit code) e o `actrc-sync-issue.mjs`
// (que transforma o MESMO diagnostico em issue no GitHub) consomem esta funcao.
// Com a logica duplicada, os dois divergiriam justamente no dia do drift.

describe("mirrorDriftReport", () => {
  it("descobre os espelhos e devolve o valor de cada um", () => {
    const dir = makeTmpRepo({ template: ENV_1_4_0, deployed: ENV_1_3_14 })
    const report = mirrorDriftReport({ cwd: dir, expected: "1.3.14" })
    expect(report.actrcVersion).toBe("1.3.14")
    expect(report.mirrors.map((m) => m.label)).toEqual([
      "deploy/env.gitea.example",
      "deploy/.env.gitea",
    ])
    expect(report.mirrors.map((m) => m.version)).toEqual(["1.4.0", "1.3.14"])
    expect(report.warnings.some((w) => w.includes("deploy/env.gitea.example"))).toBe(true)
  })

  it("variavel AUSENTE e o drift mais grave: um aviso proprio e NENHUM espelho comparado", () => {
    const dir = makeTmpRepo({})
    const report = mirrorDriftReport({ cwd: dir, expected: "" })
    expect(report.warnings.length).toBe(1)
    expect(report.warnings[0]).toContain("NÃO configurada")
    expect(report.mirrors).toEqual([])
  })

  it("--gitea-env aponta um arquivo explicito e o rotula como HOST (nao como template)", () => {
    const env = makeTmpEnv(ENV_1_3_14)
    const report = mirrorDriftReport({ cwd: makeTmpRepo({}), expected: "1.4.0", envPath: env })
    expect(report.mirrors.length).toBe(1)
    expect(report.mirrors[0].deployed).toBe(true)
    expect(report.mirrors[0].label).toBe(env)
  })

  it("espelhos em sincronia -> zero avisos (o sinal de 'nao publica nada')", () => {
    const report = mirrorDriftReport({ cwd: makeTmpRepo({}), expected: "1.3.14" })
    expect(report.warnings).toEqual([])
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// A COMPARAÇÃO DE VALOR DE TODAS AS VARIÁVEIS DO COMPOSE
// ═══════════════════════════════════════════════════════════════════════════
//
// Até esta extensão o guard comparava o VALOR só do BUN_VERSION: as outras duas
// variáveis que o compose da forja consome (`IMAGE_REGISTRY`, `IMAGE_NAMESPACE`)
// ficavam apenas com a checagem ESTÁTICA de existência (`--var IMAGE_REGISTRY` no
// .actrc, o template declarando o nome). Um registry/namespace trocado passava
// por tudo em silêncio — e o sintoma é o pior tipo: o pull da imagem só falha
// quando um job tenta iniciar, longe da causa.

describe("o conjunto comparado vem do COMPOSE (contrato, não lista à mão)", () => {
  it("comparadas + segredo = as variáveis que o compose consome", () => {
    // O compose REAL: se alguém acrescentar uma variável lá, este teste FALHA até
    // a variável ser classificada (comparada ou declarada como segredo) — uma
    // variável nova não pode entrar só com a checagem de existência.
    const consumed = composeEnvVariables(
      readFileSync(join(process.cwd(), "deploy", "docker-compose.gitea.yml"), "utf8"),
    )
    expect([...MIRROR_VARIABLES, ...SECRET_MIRROR_VARIABLES].sort()).toEqual([...consumed].sort())
    expect([...COMPOSE_ENV_VARIABLES].sort()).toEqual([...consumed].sort())
  })

  it("o segredo é DECLARADO (comparar valor exigiria versioná-lo)", () => {
    expect(SECRET_MIRROR_VARIABLES).toEqual(["RUNNER_TOKEN"])
    // Nenhuma variável pode estar nos dois conjuntos.
    for (const name of SECRET_MIRROR_VARIABLES) expect(MIRROR_VARIABLES).not.toContain(name)
  })

  it("cada variável comparada é espelhada onde o desenho diz (e a ausência tem razão)", () => {
    // `.actrc`: versão + registry, nunca o namespace (os workflows usam
    // `vars.IMAGE_NAMESPACE || github.repository_owner`).
    expect(Object.keys(MIRROR_VARIABLE_RULES.BUN_VERSION)).toEqual(["actrc", "env"])
    expect(Object.keys(MIRROR_VARIABLE_RULES.IMAGE_REGISTRY)).toEqual(["actrc", "env"])
    expect(Object.keys(MIRROR_VARIABLE_RULES.IMAGE_NAMESPACE)).toEqual(["env"])
  })
})

describe("extractActrcVar / extractEnvVar / readMirrorVariableValues", () => {
  const ACTRC = `# comentário com --var IMAGE_REGISTRY=comentado\n--var IMAGE_REGISTRY="ghcr.io"\n--var BUN_VERSION=1.3.14\n`
  const ENV = `# IMAGE_NAMESPACE=comentado\nIMAGE_REGISTRY=ghcr.io\nexport IMAGE_NAMESPACE='severinno'\nBUN_VERSION=1.3.14\n`

  it("lê qualquer variável do .actrc (e o comentário não engana)", () => {
    expect(extractActrcVar(ACTRC, "IMAGE_REGISTRY")).toBe("ghcr.io")
    expect(extractActrcVar(ACTRC, "BUN_VERSION")).toBe("1.3.14")
    expect(extractActrcVar(ACTRC, "IMAGE_NAMESPACE")).toBeNull()
  })

  it("lê qualquer variável do env (export/aspas, comentário descartado)", () => {
    expect(extractEnvVar(ENV, "IMAGE_NAMESPACE")).toBe("severinno")
    expect(extractEnvVar(ENV, "IMAGE_REGISTRY")).toBe("ghcr.io")
    expect(extractEnvVar(ENV, "RUNNER_TOKEN")).toBeNull()
  })

  it("nome fora do formato de variável não vira regex (e não devolve nada)", () => {
    expect(extractEnvVar(ENV, "IMAGE_.*")).toBeNull()
    expect(extractActrcVar(ACTRC, "BUN_VERSION).*")).toBeNull()
  })

  it("readMirrorVariableValues lê o conjunto inteiro, com null para ausente", () => {
    expect(readMirrorVariableValues(ENV, "env")).toEqual({
      BUN_VERSION: "1.3.14",
      IMAGE_REGISTRY: "ghcr.io",
      IMAGE_NAMESPACE: "severinno",
    })
    expect(readMirrorVariableValues(ACTRC, "actrc")).toEqual({
      BUN_VERSION: "1.3.14",
      IMAGE_REGISTRY: "ghcr.io",
      IMAGE_NAMESPACE: null,
    })
  })
})

describe("mirrorDriftReport — o VALOR de cada variável, não só da versão", () => {
  const VARS = { IMAGE_REGISTRY: "ghcr.io", IMAGE_NAMESPACE: "severinno" }

  it("as três em sincronia → nenhum aviso, nenhum drift, nada por comparar", () => {
    const report = mirrorDriftReport({
      cwd: makeTmpRepo({}),
      expected: "1.3.14",
      expectedVars: VARS,
    })
    expect(report.warnings).toEqual([])
    expect(report.drift).toEqual([])
    expect(report.unproven).toEqual([])
    expect(report.expectedVars).toEqual({ BUN_VERSION: "1.3.14", ...VARS })
    // Cada espelho carrega o valor das três e o próprio veredito.
    for (const mirror of report.mirrors) {
      expect(mirror.values).toMatchObject({ BUN_VERSION: "1.3.14", ...VARS })
      expect(mirror.drift).toEqual([])
    }
  })

  it("IMAGE_NAMESPACE divergente → aviso nomeando a variável e o arquivo (e SEM bump-bun)", () => {
    const report = mirrorDriftReport({
      cwd: makeTmpRepo({
        template: ENV_1_3_14.replace("IMAGE_NAMESPACE=severinno", "IMAGE_NAMESPACE=outro"),
      }),
      expected: "1.3.14",
      expectedVars: VARS,
    })
    expect(report.warnings).toHaveLength(1)
    expect(report.warnings[0]).toContain("define IMAGE_NAMESPACE='outro'")
    expect(report.warnings[0]).toContain("vars.IMAGE_NAMESPACE='severinno'")
    // O `bump-bun.sh` só escreve a VERSÃO: um aviso que o mandasse rodar
    // resolveria uma variável e deixaria a outra.
    expect(report.warnings[0]).not.toContain("bump-bun.sh")
    expect(report.drift).toEqual([
      {
        name: "IMAGE_NAMESPACE",
        kind: "env",
        label: GITEA_ENV_MIRROR,
        deployed: false,
        value: "outro",
        expected: "severinno",
      },
    ])
    expect(report.mirrors[0].drift).toEqual(["IMAGE_NAMESPACE"])
  })

  it("variável sem valor passado → NÃO COMPARADA (nomeada), nunca 'conferida'", () => {
    const report = mirrorDriftReport({ cwd: makeTmpRepo({}), expected: "1.3.14" })
    expect(report.warnings).toEqual([])
    expect(report.unproven).toEqual(["IMAGE_REGISTRY", "IMAGE_NAMESPACE"])
  })

  it("o .actrc não é cobrado pelo que ele não espelha (IMAGE_NAMESPACE)", () => {
    // Decisão escrita: o namespace não vive no .actrc. Cobrá-lo ali seria um
    // aviso permanente que o procedimento documentado não consegue silenciar.
    const report = mirrorDriftReport({
      cwd: makeTmpRepo({ actrc: "--var IMAGE_REGISTRY=ghcr.io\n--var BUN_VERSION=1.3.14\n" }),
      expected: "1.3.14",
      expectedVars: VARS,
    })
    expect(report.warnings).toEqual([])
  })

  it("variável NÃO CONFIGURADA no repositório → aviso próprio, um por variável", () => {
    const report = mirrorDriftReport({
      cwd: makeTmpRepo({}),
      expected: "",
      expectedVars: { IMAGE_REGISTRY: "", IMAGE_NAMESPACE: "" },
    })
    expect(report.warnings).toHaveLength(3)
    expect(report.warnings.join(" ")).toContain("vars.BUN_VERSION NÃO configurada")
    expect(report.warnings.join(" ")).toContain("vars.IMAGE_REGISTRY NÃO configurada")
    expect(report.warnings.join(" ")).toContain("vars.IMAGE_NAMESPACE NÃO configurada")
  })
})

describe("normalizeExpectedVars — 'não perguntado' e 'não configurado' são estados distintos", () => {
  it("--expected vira a régua do BUN_VERSION; o resto fica null (não perguntado)", () => {
    expect(normalizeExpectedVars({ expected: "1.3.14" })).toEqual({
      BUN_VERSION: "1.3.14",
      IMAGE_REGISTRY: null,
      IMAGE_NAMESPACE: null,
    })
  })

  it("nome desconhecido é ignorado (a validação é do CLI) e null não sobrescreve", () => {
    expect(
      normalizeExpectedVars({
        expected: "1.3.14",
        expectedVars: { OUTRA: "x", IMAGE_REGISTRY: null },
      }),
    ).toEqual({ BUN_VERSION: "1.3.14", IMAGE_REGISTRY: null, IMAGE_NAMESPACE: null })
  })
})

describe("modo CLI — --expected-var (o valor das outras variáveis do compose)", () => {
  function run(
    args: string[],
    cwd?: string,
  ): { status: number | null; stdout: string; stderr: string } {
    const res = spawnSync(process.execPath, [MODULE_PATH, ...args], {
      encoding: "utf8",
      ...(cwd ? { cwd } : {}),
    })
    return { status: res.status, stdout: res.stdout, stderr: res.stderr }
  }

  it("as três em sincronia → exit 0 e o PASS diz quantas tiveram o VALOR conferido", () => {
    const res = run([
      "--expected",
      "1.3.14",
      "--expected-var",
      "IMAGE_REGISTRY=ghcr.io",
      "--expected-var",
      "IMAGE_NAMESPACE=severinno",
      "--actrc",
      makeTmpActrc("--var IMAGE_REGISTRY=ghcr.io\n--var BUN_VERSION=1.3.14\n"),
      "--gitea-env",
      makeTmpEnv(ENV_1_3_14),
    ])
    expect(res.status).toBe(0)
    expect(res.stdout).toContain("✅ espelhos da variável em sincronia")
    expect(res.stdout).toContain(
      "3 variavel(is) com o VALOR conferido: BUN_VERSION, IMAGE_REGISTRY, IMAGE_NAMESPACE",
    )
    expect(res.stdout).not.toContain("::warning::")
  })

  it("namespace divergente → ::warning:: nomeando a variável (e o modo estrito falha)", () => {
    const args = [
      "--expected",
      "1.3.14",
      "--expected-var",
      "IMAGE_REGISTRY=ghcr.io",
      "--expected-var",
      "IMAGE_NAMESPACE=outro",
      "--actrc",
      makeTmpActrc("--var IMAGE_REGISTRY=ghcr.io\n--var BUN_VERSION=1.3.14\n"),
      "--gitea-env",
      makeTmpEnv(ENV_1_3_14),
    ]
    const warn = run(args)
    expect(warn.status).toBe(0)
    expect(warn.stdout).toContain("::warning::")
    expect(warn.stdout).toContain("IMAGE_NAMESPACE")
    expect(run([...args, "--fail"]).status).toBe(1)
  })

  it("sem o valor de uma variável → o log DIZ que ela não foi comparada", () => {
    const res = run([
      "--expected",
      "1.3.14",
      "--actrc",
      makeTmpActrc("--var IMAGE_REGISTRY=ghcr.io\n--var BUN_VERSION=1.3.14\n"),
      "--gitea-env",
      makeTmpEnv(ENV_1_3_14),
    ])
    expect(res.status).toBe(0)
    expect(res.stdout).toContain("· sem valor para comparar (IMAGE_REGISTRY, IMAGE_NAMESPACE)")
    expect(res.stdout).toContain("--expected-var IMAGE_REGISTRY=<valor>")
  })

  it("NAME fora do conjunto comparado → exit 2 (um typo não pode virar verde falso)", () => {
    const res = run(["--expected", "1.3.14", "--expected-var", "IMAGEN_REGISTRY=x"])
    expect(res.status).toBe(2)
    expect(res.stderr).toContain("IMAGEN_REGISTRY")
  })

  it("BUN_VERSION entra por --expected (uma forma só de escrever o valor)", () => {
    const res = run(["--expected", "1.3.14", "--expected-var", "BUN_VERSION=1.3.14"])
    expect(res.status).toBe(2)
    expect(res.stderr).toContain("--expected")
  })

  it("--expected-var sem '=' (ou com valor que é flag) → exit 2", () => {
    expect(run(["--expected", "1.3.14", "--expected-var", "IMAGE_REGISTRY"]).status).toBe(2)
    expect(run(["--expected", "1.3.14", "--expected-var", "IMAGE_REGISTRY=--fail"]).status).toBe(2)
  })

  it("a MESMA variável com valores diferentes → exit 2 (precedência silenciosa não)", () => {
    const res = run([
      "--expected",
      "1.3.14",
      "--expected-var",
      "IMAGE_REGISTRY=ghcr.io",
      "--expected-var",
      "IMAGE_REGISTRY=outro",
    ])
    expect(res.status).toBe(2)
    expect(res.stderr).toContain("duas vezes")
  })

  it("--expected engolindo uma flag → exit 2 (não 'divergir de --fail')", () => {
    const res = run(["--expected", "--fail"])
    expect(res.status).toBe(2)
    expect(res.stderr).toContain("nao uma flag")
  })
})
