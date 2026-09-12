/**
 * check-actrc-sync.test.ts
 *
 * Testes do guard PERIÓDICO dos DOIS espelhos da repository variable
 * BUN_VERSION: o `.actrc` (espelho local do act) e `deploy/env.gitea.example`
 * (espelho do runner da forja) — scripts/check-actrc-sync.mjs.
 *
 * O guard estático scripts/check-bun-mirror.mjs valida que cada espelho DEFINE
 * BUN_VERSION (existe a linha `--var BUN_VERSION=...` / `BUN_VERSION=...`), mas
 * NÃO pode conferir se o VALOR bate com a variável do GitHub — impossível
 * estaticamente (a variável remota só existe em runtime no Actions). Este
 * guard compara os DOIS e emite `::warning::` (NÃO-bloqueante) se divergirem: o
 * job semanal `actrc-sync` do benchmark-weekly.yml passa o valor real de
 * vars.BUN_VERSION via --expected e o script lê os espelhos do working tree.
 *
 * Cobre:
 *   - extractActrcBunVersion (linha --var BUN_VERSION=, aspas, comentário,
 *     ausente)
 *   - extractEnvMirrorBunVersion (linha BUN_VERSION=, export, aspas, comentário
 *     de header — o arquivo é quase todo prosa, então o decoy importa)
 *   - actrcSyncWarnings / envMirrorSyncWarnings (em sincronia = zero avisos;
 *     divergência = aviso com ambos os valores; sem BUN_VERSION = aviso
 *     fail-closed)
 *   - CLI (--expected/--actrc/--gitea-env/--fail, exit 0 aviso / 1 fail / 2 uso
 *     inválido; env ausente é ignorado, não é drift)
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
  actrcSyncWarnings,
  extractEnvMirrorBunVersion,
  envMirrorSyncWarnings,
  mirrorDriftReport,
  GITEA_ENV_MIRROR,
} from "../../../scripts/check-actrc-sync.mjs"

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

const ACTRC_1_3_14 = `# .actrc — espelho local da repository variable
--var BUN_VERSION=1.3.14
`

const ACTRC_1_4_0 = `# .actrc — espelho local da repository variable
--var BUN_VERSION=1.4.0
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
