#!/usr/bin/env node

// =============================================================================
// check-generated-format.mjs
//
// O guard do GERADO: todo arquivo versionado que um script do repositório produz
// tem de sair DENTRO do lint — na mão do formatador que o próprio repositório
// roda (`node_modules/.bin/prettier`, via `prettier-format.mjs`).
//
// POR QUE ELE EXISTE (o defeito medido, 26/09/2026)
//
// Um gerador que monta o arquivo com `JSON.stringify(dados, null, 2)` grava uma
// forma que o prettier NÃO mantém: ele colapsa o que cabe na largura (`staged:
// ["a.sh", "b.sh"]` numa linha, `runs: [1, 2, 3]` idem) e o `JSON.stringify`
// expande tudo. Medido: o `bench-guard-timing` gravou a baseline assim, o hook
// RECUSOU o commit e o remédio ficou local àquele arquivo. A mesma armadilha
// seguia armada em todo gerador que não tinha aprendido a lição — baselines
// (`--update`), inventário de dependências, badge do README, tabelas derivadas da
// doc, os `*-latest.json` dos benchmarks. Um gerado fora do lint é um commit que
// o hook recusa (ou um PR vermelho quando outro caminho o regenera).
//
// O QUE ELE MEDE (três metades, e nenhuma é a leitura da intenção)
//
//   1. O ARTEFATO (empírico): cada `saidas` declarada é um arquivo VERSIONADO, e
//      tem de estar DENTRO do escopo do lint. "Dentro" tem duas partes, e a
//      segunda é a que quase ninguém confere: a cobertura pelos globs do script
//      `lint` (a régua é a do `check-lint-scope`, importada — não uma segunda
//      cópia) e NÃO ser ignorada pelo `.prettierignore`. Um artefato declarado
//      fora do lint é a promessa quebrada deste guard: o gerado existe, entra no
//      commit, e ninguém o julga. Só então o CONTEÚDO é medido — o arquivo tem de
//      SAIR COMO O PRETTIER O DEIXA (`--check` com o binário do repositório): é o
//      produto, não o caminho. `reescreve` cobre o gerador cujo alvo é um
//      DIRETÓRIO/arquivo que ele reescreve sem a lista exata (o fixer de citações,
//      o fixer de comandos): o prefixo tem de estar coberto pelos globs.
//   2. O CAMINHO DE ESCRITA (estrutural, e DITO como tal): cada gerador declarado
//      passa pelo formatador na hora de gravar. A varredura é do código — cada
//      chamada CRUA (`writeFileSync`/`appendFileSync`/`writeFile`) tem de estar
//      DECLARADA na entrada, com o alvo e o motivo (a fixture em tmpdir, o
//      arquivo de prova). É a metade que pega o gerador NOVO que grava cru: sem
//      ela o guard só saberia do defeito depois que alguém regenerasse o
//      artefato. O LIMITE é declarado: ler o código mede a FORMA do caminho de
//      escrita, não o efeito — o efeito quem mede é a metade 1, e é por isso que
//      as duas existem.
//   3. A COBERTURA (duas direções, como o `EXEMPT` do `check-lint-scope`): o
//      conjunto de candidatos é DERIVADO da árvore — scripts versionados que
//      gravam E citam um caminho que existe como arquivo versionado. Um candidato
//      FORA da tabela é violação (um gerador que ninguém declarou); e uma entrada
//      que não declara saída nenhuma E não é candidata é STALE (a declaração que
//      ninguém revisa). LIMITE DECLARADO da derivação: ela vê o caminho LITERAL
//      no próprio script — um gerador que recebe o destino de um módulo
//      compartilhado não é alcançado por ela e entra na tabela pela DECLARAÇÃO
//      (as `saidas`), que é conferida contra a árvore (`git ls-files`).
//
// O QUE ELE NÃO MEDE: o gerador que precisa de rede, docker ou minutos para
// reproduzir a saída não é EXECUTADO aqui. O que se cobra dele é o ARTEFATO (na
// árvore) e o caminho de escrita; a reprodução fica com o ensaio que já a faz
// (os `test-mutation-*`, as provas do CI).
//
// Usage:
//   node scripts/check-generated-format.mjs            # a árvore versionada
//   node scripts/check-generated-format.mjs --json     # saída estruturada
//   node scripts/check-generated-format.mjs --help
//
// Exit codes:
//   0 — toda saída declarada existe, está no escopo do lint e sai como o
//       prettier a deixa; toda escrita crua está declarada; e a tabela cobre os
//       candidatos da árvore
//   1 — violação: saída fora do lint (ignorada pelo `.prettierignore`, fora dos
//       globs ou reformatável), escrita crua não declarada, declaração STALE,
//       candidato fora da tabela ou saída declarada que não é versionada
//   2 — infra: `package.json`/comando `lint` ilegível, `git ls-files`
//       indisponível, prettier fora do `node_modules` ou `scripts/` ilegível
//       (fail-closed: sem medição não há veredito)
//   3 — uso inválido
// =============================================================================

import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import process from "node:process"
import { pathToFileURL } from "node:url"

// A RÉGUA DO ESCOPO é a do `check-lint-scope` (globs lidos do comando do lint, a
// cobertura e o oráculo do prettier): uma segunda cópia aqui divergiria no dia em
// que o lint mudasse de forma.
import { coveredBy, prettierGlobsOf, prettierJudges } from "./check-lint-scope.mjs"
// O FORMATADOR é um só, e é o mesmo que os geradores usam para gravar.
import { PRETTIER_REL, caminhoDoFormatador } from "./prettier-format.mjs"

/** Exit codes — o contrato da CLI. */
export const EXIT = { OK: 0, VIOLATIONS: 1, UNAVAILABLE: 2, USAGE: 3 }

/** O diretório dos geradores. */
export const SCRIPTS_DIR = "scripts"

/** As funções do formatador: gravar por elas é o caminho declarado como FORMATADO. */
export const HELPERS = ["escreverFormatado", "escreverJsonFormatado"]

/**
 * A TABELA DOS GERADORES — a declaração que a varredura cobra.
 *
 * `saidas` são os arquivos VERSIONADOS que o script escreve (conferidos contra a
 * árvore: existir, ser versionado, estar no lint e sair como o prettier o deixa).
 * `reescreve` é o prefixo do que ele reescreve quando a lista exata não é um
 * conjunto fixo (o fixer de citações, o de comandos) — o prefixo tem de estar
 * coberto pelos globs do lint. `escritasCruas` são as escritas que NÃO passam
 * pelo formatador, com o motivo no comentário da entrada: a varredura cobra que
 * essa lista seja exatamente a do código (uma nova escrita crua reprova, e uma
 * declaração que não existe mais é STALE). `leSo` marca o script que a derivação
 * alcança (grava fixture e cita versão) mas cujo alvo versionado é LIDO: ele não
 * gera artefato, e o motivo fica escrito.
 *
 * @type {{script: string, saidas?: string[], reescreve?: string[], escritasCruas?: string[], leSo?: string}[]}
 */
export const GERADORES = [
  // ── 1. o REGISTRO do bench e os BLOCOS DERIVADOS da doc ────────────────────
  {
    script: "scripts/bench-guard-timing.mjs",
    saidas: [
      "docs/benchmarks/guard-timing-baseline.json",
      "docs/benchmarks/guard-timing-latest.json",
    ],
  },
  { script: "scripts/bench-table.mjs", saidas: ["README.md", "docs/GUARDS.md"] },

  // ── 2. as BASELINES e os REGISTROS versionados (`--update`) ─────────────────
  {
    script: "scripts/check-bun-audit-baseline.mjs",
    saidas: ["docs/security/bun-audit-baseline.json"],
  },
  {
    script: "scripts/check-secret-leaks-baseline.mjs",
    saidas: ["docs/security/secret-leaks-baseline.json"],
  },
  {
    script: "scripts/check-jsdom-baseline.mjs",
    saidas: ["docs/quality/jsdom-failures-baseline.json"],
  },
  {
    script: "scripts/check-readme-reverse-baseline.mjs",
    saidas: ["docs/security/readme-reverse-baseline.json"],
  },
  { script: "scripts/check-github-dependencies.mjs", saidas: ["ci/github-dependencies.json"] },
  { script: "scripts/check-required-checks.mjs", saidas: ["ci/required-checks-applied.json"] },

  // ── 3. os REESCRITORES da doc (o alvo é o arquivo/diretório que ele corrige) ─
  { script: "scripts/check-encoding-guards-badge.mjs", saidas: ["README.md"] },
  { script: "scripts/check-doc-hashes.mjs", reescreve: ["docs/", "README.md"] },
  { script: "scripts/check-hook-commands.mjs", reescreve: ["docs/", "README.md", "package.json"] },

  // ── 4. os BENCHMARKS (`*-latest.json`): a saída só existe quando rodam ──────
  { script: "scripts/run-benchmark.mjs", reescreve: ["docs/benchmarks/"] },
  { script: "scripts/search-benchmark.mjs", saidas: ["docs/benchmarks/search-latest.json"] },
  { script: "scripts/cache-benchmark.mjs", saidas: ["docs/benchmarks/cache-latest.json"] },
  { script: "scripts/geo-benchmark.mjs", reescreve: ["docs/benchmarks/"] },
  { script: "scripts/geo-benchmark-real.mjs", reescreve: ["docs/benchmarks/"] },
  { script: "scripts/geo-pipeline-benchmark.mjs", reescreve: ["docs/benchmarks/"] },
  { script: "scripts/measure-mutation-timing.mjs", reescreve: ["docs/benchmarks/"] },

  // ── 5. os que a derivação alcança e cujo alvo versionado é LIDO ─────────────
  // Eles gravam fixture/temporário (o alvo sai declarado em `escritasCruas`), e o
  // arquivo versionado que citam é ENTRADA da prova — não saída.
  {
    script: "scripts/artefatos-do-hook.mjs",
    leSo: "a derivação copia o fecho de imports para um repo de prova em tmpdir; o `package.json` que cita é LIDO pelos guards do hook",
    // `LOG` não é escrita DESTE script: ele é o alvo do `appendFileSync` que
    // vive dentro do TRACEADOR — o fonte que a derivação escreve no fixture e
    // injeta com `--require`. A varredura o lê do texto, então ele se declara
    // aqui (e o alvo deixa de parecer uma escrita própria).
    escritasCruas: ["LOG", "traceador"],
  },
  {
    script: "scripts/check-actrc-sync.mjs",
    leSo: "grava o relatório em `--json-out` (caminho do chamador); o compose que cita é lido",
    escritasCruas: ["jsonOutput"],
  },
  {
    script: "scripts/check-mutation-count.mjs",
    leSo: "grava a cópia de prova em tmpdir; a matriz e a doc que cita são lidas",
    escritasCruas: ["destino"],
  },
  {
    script: "scripts/check-prove-docs.mjs",
    leSo: "grava o shim de `docker` da fixture em tmpdir; a doc que cita é lida",
    escritasCruas: ['join(shimDir, "docker")'],
  },
  {
    script: "scripts/check-registry-source.mjs",
    leSo: "grava a fixture de env em tmpdir; os composes que cita são lidos",
    escritasCruas: ["path"],
  },
  {
    script: "scripts/hook-simulator.mjs",
    leSo: "o simulador de hook: grava o repo de prova em tmpdir, nunca artefato versionado",
    escritasCruas: [
      "join(dir, WRAPPER_FILE)",
      "join(dir, rel)",
      "hookPath",
      "join(dir, HOOK_UNDER_TEST)",
      "caminho",
    ],
  },
  {
    script: "scripts/pre-commit-proof.mjs",
    leSo: "a prova roda o hook sobre uma CÓPIA do repositório em tmpdir",
    escritasCruas: [
      "caminho",
      "join(dir, defeito.arquivo)",
      "join(copia, BUMP_SUITE)",
      "caminhoMaster",
      "caminhoWf",
      "caminhoReadme",
    ],
  },
  {
    script: "scripts/pre-push-proof.mjs",
    leSo: "a prova roda o hook sobre uma cópia do repositório em tmpdir",
    escritasCruas: ['"${LOG}"', "→ log"],
  },
  {
    script: "scripts/prettier-format.mjs",
    leSo: "é o PRÓPRIO formatador: a escrita dele é o caminho declarado por todos os outros",
    escritasCruas: ["caminho"],
  },
  {
    script: "scripts/prove-cut-stages.mjs",
    leSo: "grava o recorte de prova; os arquivos versionados que cita são lidos",
    escritasCruas: ["path"],
  },
  {
    script: "scripts/prove-forge-smoke-ephemeral.mjs",
    leSo: "o ensaio efêmero escreve o compose/workflow de prova em tmpdir",
    escritasCruas: [
      "stackComposePath",
      "join(repoDir, SMOKE_WORKFLOW)",
      "→ join(repoDir, SENTINELA_WORKFLOW)",
      "→ overridePath",
      "→ envPath",
      "→ mutationPath",
    ],
  },
  {
    script: "scripts/prove-gitea-registry.mjs",
    leSo: "o ensaio do registry escreve o override de prova em tmpdir",
    escritasCruas: ["→ overridePath", "→ envEphemeral", "envSemRegistry"],
  },
  {
    script: "scripts/prove-runner-image-gate.mjs",
    leSo: "o ensaio da imagem escreve logs e templates de prova em tmpdir",
    escritasCruas: [
      "dockerLog",
      "doctorLog",
      "mirrorLog",
      "ensureLog",
      "traceLog",
      "volumeState",
      "imageState",
      '→ join(binDir, "docker")',
      '→ join(binDir, "gh")',
      "→ doctorStub",
      "LOG",
      "TRACE",
      "→ path",
      "templateFile",
      "envFile",
    ],
  },
  {
    script: "scripts/prove-runner-queue-cycle.mjs",
    leSo: "o ensaio do ciclo escreve o compose/workflow de prova em tmpdir",
    escritasCruas: [
      "stackComposePath",
      "→ overridePath",
      "envPath",
      "join(repoDir, CYCLE_WORKFLOW)",
    ],
  },
  {
    script: "scripts/prove-stack-per-commit.mjs",
    leSo: "a prova da pilha escreve o marcador do dono no repo de prova",
    escritasCruas: ["join(base, MARCADOR_DO_DONO)"],
  },
  {
    script: "scripts/prove-tla-cycle.mjs",
    leSo: "a prova do ciclo TLA escreve o arquivo de prova em tmpdir",
    escritasCruas: ["caminho"],
  },
  {
    script: "scripts/verify-pii-gate.mjs",
    leSo: "grava o alvo da fixture de vazamento; o package.json que cita é lido",
    escritasCruas: ["target"],
  },
]

/**
 * As chamadas de ESCRITA de um fonte, com o alvo e se ela passa pelo formatador.
 *
 * Duas famílias entram, e a distinção é a razão de a função existir: as funções
 * do `node:fs` chamadas DIRETO (`writeFileSync`/`appendFileSync`/`writeFile`) são
 * escritas CRUAS, e as do formatador (`escreverFormatado`/`escreverJsonFormatado`)
 * são o caminho declarado como FORMATAADO. As duas contam para a derivação de
 * candidatos (um gerador totalmente fíado TAMBÉM é um gerador) e só as cruas são
 * cobradas em `escritasCruas`.
 *
 * O alvo é o TEXTO do primeiro argumento (não o valor resolvido): a pergunta é
 * estrutural — "esta chamada passa pelo formatador?" —, e resolvê-lo exigiria
 * executar o script (o que a metade do artefato faz pelo produto, não aqui).
 *
 * @param {string} fonte
 * @returns {{alvo: string, linha: number, formatado: boolean}[]}
 */
export function escritasDe(fonte) {
  const out = []
  const linhas = String(fonte ?? "").split("\n")
  const re =
    /(?:^|[^\w.])(writeFileSync|appendFileSync|writeFile|escreverFormatado|escreverJsonFormatado)\s*\(/g
  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i]
    // Comentário não é escrita — de linha (`//`, `#`) nem o miolo de um bloco
    // (`*`, `/*`): o mesmo cuidado do `check-lint-scope` com os marcadores na
    // prosa, e o que impede o cabeçalho deste módulo de se autoacusar.
    if (/^(?:\/\/|\*|\/\*|#)/.test(linha.trim())) continue
    re.lastIndex = 0
    let m
    while ((m = re.exec(linha)) !== null) {
      const resto = linha.slice(m.index + m[0].length)
      let alvo = primeiroArgumento(resto)
      if (alvo === "") {
        // A chamada abre na linha e o argumento desce: o alvo vira o começo da
        // PRÓXIMA linha não vazia, que é o que a declaração precisa nomear.
        const proxima = linhas.slice(i + 1).find((l) => l.trim() !== "")
        // A vírgula que fecha o argumento não faz parte do alvo: a declaração
        // nomeia a EXPRESSÃO (o mesmo texto que a linha traria se coubesse).
        alvo = proxima
          ? `→ ${proxima.trim().replace(/,$/, "").slice(0, 40)}`
          : "→ (sem argumento na linha seguinte)"
      }
      out.push({
        alvo: alvo.length > 60 ? `${alvo.slice(0, 57)}…` : alvo,
        linha: i + 1,
        formatado: HELPERS.includes(m[1]),
      })
    }
  }
  return out
}

/**
 * O texto do primeiro argumento de uma chamada, até a vírgula/parêntese de topo.
 *
 * @param {string} resto
 * @returns {string}
 */
function primeiroArgumento(resto) {
  let prof = 0
  let aspas = null
  let fim = resto.length
  for (let i = 0; i < resto.length; i++) {
    const c = resto[i]
    if (aspas) {
      if (c === aspas && resto[i - 1] !== "\\") aspas = null
      continue
    }
    if (c === '"' || c === "'" || c === "`") {
      aspas = c
      continue
    }
    if (c === "(" || c === "[" || c === "{") prof++
    else if (c === ")" || c === "]" || c === "}") {
      if (prof === 0) {
        fim = i
        break
      }
      prof--
    } else if (c === "," && prof === 0) {
      fim = i
      break
    }
  }
  return resto.slice(0, fim).trim()
}

/**
 * Os caminhos de artefato CITADOS por um fonte — a matéria-prima da derivação.
 *
 * @param {string} fonte
 * @returns {string[]}
 */
export function caminhosCitados(fonte) {
  const out = new Set()
  const re = /["'`]([A-Za-z0-9_@][A-Za-z0-9_./@-]*\.(?:json|md|ya?ml|txt|csv))["'`]/g
  let m
  while ((m = re.exec(String(fonte ?? ""))) !== null) out.add(m[1])
  return [...out]
}

/**
 * O ARTEFATO está DENTRO do lint? (escopo + forma)
 *
 * @param {string} rel
 * @param {{cwd: string, globs: string[], run?: Function}} o
 * @returns {{ok: boolean, motivo: string|null}}
 */
export function artefatoNoLint(rel, { cwd, globs, run = spawnSync }) {
  const abs = join(cwd, rel)
  if (!existsSync(abs))
    return { ok: false, motivo: `${rel}: a saída declarada NÃO existe na árvore` }
  if (!coveredBy(globs, rel)) {
    return {
      ok: false,
      motivo: `${rel}: fora dos globs do \`lint\` do package.json — o gerador escreve um arquivo que o lint não julga`,
    }
  }
  const bin = caminhoDoFormatador(cwd)
  if (!existsSync(bin)) {
    return {
      ok: false,
      motivo: `${rel}: sem o prettier do repositório (${PRETTIER_REL}) não há como medir a forma`,
    }
  }
  const r = run(bin, ["--check", rel], { cwd, encoding: "utf8" })
  if (r?.error)
    return { ok: false, motivo: `${rel}: prettier não rodou (${r.error.message ?? r.error})` }
  if (r.status !== 0) {
    const saida = `${r.stdout ?? ""}${r.stderr ?? ""}`
      .split("\n")
      .filter(
        (l) => l.trim() !== "" && !/^Checking formatting/.test(l) && !/^All matched files/.test(l),
      )
      .slice(0, 3)
      .join(" | ")
    return {
      ok: false,
      motivo: `${rel}: o arquivo NÃO sai como o prettier o deixa (o gerador gravou fora do formatador)${saida ? ` — ${saida}` : ""}`,
    }
  }
  return { ok: true, motivo: null }
}

/**
 * O relatório do guard — o shape do `analyze` (e o do `--json`).
 *
 * @typedef {{
 *   exit: number,
 *   violations: string[],
 *   geradores: number,
 *   saidas: number,
 *   candidatos: string[],
 *   escritasCruas: {script: string, cruas: string[], declaradas: string[]}[],
 *   globs: string[],
 *   error: string|null,
 *   artefatos: {saida: string, gerador: string, ok: boolean}[],
 * }} Relatorio
 */

/**
 * O veredito completo.
 *
 * @param {{cwd?: string, geradores?: typeof GERADORES, run?: Function}} [o]
 * @returns {Promise<Relatorio>}
 */
export async function analyze({
  cwd = process.cwd(),
  geradores = GERADORES,
  run = spawnSync,
} = {}) {
  const base = {
    exit: EXIT.OK,
    violations: [],
    geradores: geradores.length,
    saidas: 0,
    candidatos: [],
    escritasCruas: [],
    globs: [],
    error: null,
    artefatos: [],
  }
  const pkgPath = join(cwd, "package.json")
  if (!existsSync(pkgPath))
    return { ...base, exit: EXIT.UNAVAILABLE, error: `package.json ausente em ${cwd}` }
  let command
  try {
    command = JSON.parse(readFileSync(pkgPath, "utf8")).scripts?.lint
  } catch (err) {
    return { ...base, exit: EXIT.UNAVAILABLE, error: `package.json ilegivel: ${err.message}` }
  }
  const { globs, error: globError } = prettierGlobsOf(command)
  if (globError) return { ...base, exit: EXIT.UNAVAILABLE, error: globError }
  base.globs = globs

  // A ÁRVORE versionada: dela sai a prova de que a saída declarada entra no
  // commit, e é contra ela que o candidato (um caminho citado que existe) é
  // medido.
  const versionados = (() => {
    const r = run("git", ["ls-files"], { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    if (r?.error || r.status !== 0) return null
    return new Set(
      String(r.stdout ?? "")
        .split("\n")
        .filter((l) => l !== ""),
    )
  })()
  if (!versionados) {
    return {
      ...base,
      exit: EXIT.UNAVAILABLE,
      error: "git ls-files indisponível — sem a árvore não há candidatos",
    }
  }

  // ── metade 3: os CANDIDATOS, derivados ────────────────────────────────────
  let fontes
  try {
    fontes = readdirSync(join(cwd, SCRIPTS_DIR)).filter((f) => f.endsWith(".mjs"))
  } catch (err) {
    return { ...base, exit: EXIT.UNAVAILABLE, error: `scripts/ ilegivel: ${err.message}` }
  }
  for (const nome of fontes.sort()) {
    const rel = `${SCRIPTS_DIR}/${nome}`
    const fonte = readFileSync(join(cwd, rel), "utf8")
    if (escritasDe(fonte).length === 0) continue
    if (!caminhosCitados(fonte).some((c) => versionados.has(c))) continue
    base.candidatos.push(rel)
  }

  const declarados = new Map(geradores.map((g) => [g.script, g]))
  for (const c of base.candidatos) {
    if (!declarados.has(c)) {
      base.violations.push(
        `${c} grava e cita arquivo versionado, e NÃO está na tabela GERADORES deste guard: ` +
          `declare as \`saidas\` (ou \`reescreve\`) e as \`escritasCruas\`, — um gerador fora da tabela é um gerado que ninguém mede`,
      )
    }
  }
  for (const g of geradores) {
    const declara = (g.saidas?.length ?? 0) > 0 || (g.reescreve?.length ?? 0) > 0
    if (!declara && !base.candidatos.includes(g.script)) {
      base.violations.push(
        `entrada STALE: '${g.script}' não declara saída nenhuma e a varredura não o alcança mais ` +
          `(ele não grava nem cita arquivo versionado) — a declaração que ninguém revisa`,
      )
    }
  }

  // ── metade 1: o ARTEFATO ──────────────────────────────────────────────────
  for (const g of geradores) {
    for (const rel of g.saidas ?? []) {
      base.saidas++
      if (!versionados.has(rel)) {
        base.violations.push(
          `${g.script}: a saída declarada '${rel}' não é versionada (git ls-files não a lista) — ` +
            `declarar como gerado o que não entra no commit não mede nada`,
        )
        continue
      }
      const info = await prettierJudges(rel, cwd).catch(() => null)
      if (info?.ignored) {
        base.violations.push(
          `${rel}: é IGNORADO pelo .prettierignore e está declarado como saída de '${g.script}' — ` +
            `um gerado não pode ficar fora do lint: o lint é o único lugar que julga o que o gerador escreve`,
        )
        continue
      }
      const veredito = artefatoNoLint(rel, { cwd, globs, run })
      base.artefatos.push({ saida: rel, gerador: g.script, ok: veredito.ok })
      if (!veredito.ok) base.violations.push(veredito.motivo)
    }
    for (const prefixo of g.reescreve ?? []) {
      const exemplo = prefixo.endsWith("/") ? `${prefixo}exemplo.json` : prefixo
      if (!coveredBy(globs, exemplo)) {
        base.violations.push(
          `${g.script}: \`reescreve\` declara '${prefixo}', que está fora dos globs do \`lint\` — ` +
            `o que o gerador reescreve tem de ser julgado pelo lint`,
        )
      }
    }
  }

  // ── metade 2: o CAMINHO DE ESCRITA ────────────────────────────────────────
  for (const g of geradores) {
    if (!existsSync(join(cwd, g.script))) {
      base.violations.push(
        `${g.script}: declarado na tabela GERADORES e o arquivo NÃO existe — a entrada aponta para um script que sumiu`,
      )
      continue
    }
    const fonte = readFileSync(join(cwd, g.script), "utf8")
    const cruas = [
      ...new Set(
        escritasDe(fonte)
          .filter((e) => !e.formatado)
          .map((e) => e.alvo),
      ),
    ].sort()
    const declaradas = [...new Set(g.escritasCruas ?? [])].sort()
    const usaHelper = HELPERS.some((h) => fonte.includes(h))
    const declara = (g.saidas?.length ?? 0) > 0 || (g.reescreve?.length ?? 0) > 0
    if (declara && !usaHelper) {
      base.violations.push(
        `${g.script}: gera artefato versionado SEM passar pelo formatador (nenhuma chamada a ` +
          `${HELPERS.join("/")}) — o arquivo nasce fora do lint`,
      )
    }
    base.escritasCruas.push({ script: g.script, cruas, declaradas })
    for (const c of cruas.filter((x) => !declaradas.includes(x))) {
      base.violations.push(
        `${g.script}: escrita CRUA não declarada (alvo \`${c}\`) — se é fixture/temporário, ` +
          `declare o alvo em \`escritasCruas\` com o motivo; se é artefato versionado, passe pelo formatador`,
      )
    }
    for (const s of declaradas.filter((x) => !cruas.includes(x))) {
      base.violations.push(
        `${g.script}: \`escritasCruas\` declara \`${s}\`, que não é mais uma escrita crua do script — declaração STALE`,
      )
    }
  }

  base.exit = base.violations.length > 0 ? EXIT.VIOLATIONS : EXIT.OK
  return base
}

const USAGE = `
 Uso: node scripts/check-generated-format.mjs [--json] [--help]

   --json   a saida estruturada
   --help   esta ajuda

 O FATO: toda saida versionada de um gerador do repositorio existe, esta no
 escopo do lint (globs do script \`lint\`, nunca no .prettierignore) e SAI COMO O
 PRETTIER A DEIXA; o caminho de escrita de cada gerador passa (ou declara) o
 formatador; e a tabela GERADORES cobre os candidatos da arvore.
`

function main() {
  const argv = process.argv.slice(2)
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(USAGE)
    process.exit(EXIT.OK)
  }
  const desconhecido = argv.find((a) => !["--json"].includes(a))
  if (desconhecido !== undefined) {
    console.error(`❌ argumento invalido: ${desconhecido}\n${USAGE}`)
    process.exit(EXIT.USAGE)
  }
  analyze({}).then((report) => {
    if (argv.includes("--json")) {
      console.log(JSON.stringify(report, null, 2))
      process.exit(report.exit)
    }
    if (report.exit === EXIT.UNAVAILABLE) {
      console.error(`❌ INFRA: ${report.error}`)
      process.exit(report.exit)
    }
    if (report.exit === EXIT.VIOLATIONS) {
      console.error(`❌ Gerado FORA do lint (${report.violations.length}):\n`)
      for (const v of report.violations) console.error(`   - ${v}`)
      console.error(
        `\n   Quem gera arquivo versionado grava por \`escreverFormatado\` (o MESMO prettier que o \`lint\` roda): ` +
          `um gerado que nasce fora da forma que o prettier deixa é um commit que o hook recusa.`,
      )
      process.exit(report.exit)
    }
    console.log(
      `✅ ${report.geradores} gerador(es) declarado(s) e ${report.saidas} saída(s) versionada(s) DENTRO do lint ` +
        `(${report.candidatos.length} candidato(s) derivados da árvore, todos cobertos): o gerado sai como o prettier o deixa.`,
    )
    process.exit(report.exit)
  })
}

// True apenas quando executado diretamente — permite importar as funções puras
// nos testes unitarios sem disparar a varredura.
const IS_DIRECT_RUN =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (IS_DIRECT_RUN) main()
