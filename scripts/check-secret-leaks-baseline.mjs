#!/usr/bin/env node
// =============================================================================
// check-secret-leaks-baseline.mjs — Guard semanal: segredos NOVOS no histórico
// =============================================================================
//
// Roda o audit-secret-leaks.mjs (git log -p --all) e compara os achados com
// um BASELINE commitado (docs/security/secret-leaks-baseline.json). Falha
// (exit 1) SOMENTE se achados NOVOS aparecerem — o baseline documenta os
// vazamentos JÁ conhecidos do histórico. Um segredo NOVO commitado depois
// do baseline vira falha no job semanal, alertando sobre vazamentos futuros
// antes de virarem incidente.
//
// Por que baseline e não zero: o histórico JÁ tem vazamentos conhecidos
// (141 em 2026-08 — a remediação é filter-repo + rotação, uma operação
// deliberada, não CI). O guard protege o FUTURO. O count do baseline é
// DERIVADO do audit real (nunca literal) — `--update` regenera o arquivo,
// então o número não fica hardcoded (mesmo princípio do badge de encoding
// guards e do check-e2e-counts).
//
// COMPARAÇÃO POR CONTEÚDO, NUNCA POR ANCESTRALIDADE
//
// A assinatura de um achado é o CONTEÚDO dele — arquivo:linha:padrão:chave:
// valor-mascarado — e o commit NÃO entra. Por quê: reescrever a história
// (filter-repo, rebase, amend, squash) troca TODOS os hashes de commit sem
// tocar em um byte dos segredos. Com o commit dentro da assinatura, uma
// reescrita transformava o baseline inteiro em "assinaturas desconhecidas" e o
// guard acusava os achados conhecidos como NOVOS — alarme falso em massa que só
// se resolvia regenerando o baseline, apagando a evidência de que a história
// tinha mudado. Comparando por conteúdo, a reescrita não inventa nada.
//
// O commit continua no arquivo, mas só como PROVENIÊNCIA (documenta onde o
// vazamento vive, para a remediação com filter-repo). A proveniência é
// conferida e REPORTADA COMO MOTIVO PRÓPRIO quando os commits do baseline não
// são mais alcançáveis — o fato aparece nomeado, em vez de virar a acusação de
// "todos os achados são novos". Proveniência NUNCA falha o gate: o que falha é
// conteúdo novo, e só isso.
//
// Não é comparação por count: uma linha removida e outra adicionada mantém o
// count, mas a assinatura de conteúdo nova é detectada. Achados REMOVIDOS
// (ex.: história reescrita com filter-repo) NÃO falham — só os novos.
// Fail-closed: baseline ausente sem --update = exit 2 com instrução clara.
//
// Usage:
//   node scripts/check-secret-leaks-baseline.mjs                     # check
//   node scripts/check-secret-leaks-baseline.mjs --update            # regenera baseline
//   node scripts/check-secret-leaks-baseline.mjs --baseline X        # path custom
//   node scripts/check-secret-leaks-baseline.mjs --min-severity alta # só novos ALTA falham
//   node scripts/check-secret-leaks-baseline.mjs --json              # output JSON
//
// Exit codes:
//   0 — nenhum achado NOVO (ou --update aplicado)
//   1 — achados NOVOS detectados (fail-closed; respeitando --min-severity)
//   2 — infra: audit falhou / baseline ausente (sem --update) / flag inválida
//
// SEVERIDADE (--min-severity): cada achado do audit carrega severity
// (alta/média/baixa — ver audit-secret-leaks.mjs). Por padrão o guard falha
// em QUALQUER achado novo. Com `--min-severity alta`, achados novos de
// severidade MÉDIA/BAIXA são reportados como aviso (não falham) e só os de
// severidade ALTA (chaves privadas, tokens com prefixo) falham — o parecer
// de segurança pede exatamente isto: falhar em QUALQUER achado novo de
// classificação alta, não gatear apenas o total.
// =============================================================================

import { spawnSync } from "node:child_process"
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

/** Path do baseline default (commitado — a fonte da verdade dos achados conhecidos). */
const DEFAULT_BASELINE = "docs/security/secret-leaks-baseline.json"

/**
 * Ordem de severidade (crescente) — usada pelo --min-severity para decidir
 * quais achados NOVOS falham. Fonte: audit-secret-leaks.mjs (alta = chaves
 * privadas + tokens com prefixo; média = atribuições de secret).
 */
export const SEVERITY_ORDER = ["baixa", "média", "alta"]

/**
 * Rank de uma severidade (0=baixa … 2=alta). Severidade desconhecida é
 * tratada como ALTA (rank máximo, fail-closed): um padrão novo no audit sem
 * severity NÃO pode escapar do gate — com --min-severity alta, um achado de
 * severidade desconhecida BLOQUEIA (a opção segura para um guard de segredos
 * é falhar fechado, nunca falhar aberto).
 *
 * @param {string|undefined|null} sev
 * @returns {number}
 */
export function severityRank(sev) {
  const i = SEVERITY_ORDER.indexOf(sev)
  return i === -1 ? SEVERITY_ORDER.length - 1 : i
}

/**
 * Caminho ABSOLUTO do audit-secret-leaks.mjs — resolvido a partir do próprio
 * módulo (não do cwd!): o guard roda com cwd = repo em CI, mas os testes CLI
 * rodam num temp git repo SEM scripts/ — resolver pelo cwd quebraria lá
 * (Cannot find module). O audit recebe o cwd via spawnSync abaixo e roda o
 * `git log -p --all` no repo do caller.
 */
const AUDIT_PATH = join(dirname(fileURLToPath(import.meta.url)), "audit-secret-leaks.mjs")

/**
 * Assinatura de CONTEÚDO de um achado — a identidade que o guard compara.
 *
 * `arquivo:linha:padrão:chave:valor-mascarado`, e o COMMIT NÃO ENTRA. O `line`
 * é a linha ADICIONADA no hunk daquele commit: imutável enquanto o commit
 * existir, e igual depois de qualquer reescrita (o conteúdo não mudou).
 *
 * O `masked` entra porque é o único pedaço do VALOR que se pode guardar sem
 * vazar o segredo (`maskSecret` = 4 primeiros caracteres + tamanho, estável):
 * sem ele, um segredo DIFERENTE gravado no mesmo arquivo:linha:chave passaria
 * como "já conhecido".
 *
 * ⚠️ ACOPLADO ao id (label PT do audit: 'atribuição de secret', 'token com
 * prefixo', 'chave privada') e ao formato do `maskSecret`: renomear um label ou
 * mudar o mascaramento muda TODAS as assinaturas → o guard acusaria "achados
 * novos" (falso alarme). Aceitável (força re-baseline via --update), mas faça
 * a renomeação e o `--update` na MESMA mudança.
 *
 * O `commit` é ACEITO e IGNORADO — de propósito: a assinatura lê o MESMO objeto
 * que o audit produz (achado completo, commit incluso) e não o usa. É essa
 * indiferença que faz a reescrita de história passar despercebida pelo gate.
 *
 * @param {{commit?: string, file: string, line: number, id: string, key?: string|null, masked?: string|null}} f
 * @returns {string}
 */
export function signatureOf(f) {
  return `${f.file}:${f.line}:${f.id}:${f.key ?? ""}:${f.masked ?? ""}`
}

/**
 * Constrói o baseline a partir dos achados atuais (formato do arquivo).
 *
 * O arquivo guarda o achado inteiro do audit — inclusive o `commit` — para o
 * registro de PROVENIÊNCIA (onde o vazamento vive, para a remediação). A
 * comparação do guard NÃO usa o commit: ela reconstrói a assinatura de conteúdo
 * de cada entrada com `signatureOf`.
 *
 * @param {Array<{commit: string, file: string, line: number, id: string, key?: string|null, masked: string}>} findings
 * @returns {{version: number, count: number, updatedAt: string, findings: object[]}}
 */
export function buildBaseline(findings) {
  return {
    version: 2,
    $comment: [
      "BASELINE dos segredos JÁ CONHECIDOS no histórico (audit-secret-leaks.mjs).",
      "",
      "O guard compara por CONTEÚDO (arquivo:linha:padrão:chave:valor-mascarado) e",
      "IGNORA o campo commit. Ele está aqui como PROVENIÊNCIA — onde o vazamento",
      "vive, para a remediação com filter-repo — e some quando a história é",
      "reescrita, sem que isso vire acusação de 'achado novo'.",
      "",
      "Regenerar: node scripts/check-secret-leaks-baseline.mjs --update",
    ],
    count: findings.length,
    updatedAt: new Date().toISOString().slice(0, 10),
    findings: findings.map((f) => ({
      commit: f.commit,
      file: f.file,
      line: f.line,
      id: f.id,
      severity: f.severity ?? null,
      key: f.key ?? null,
      masked: f.masked,
    })),
  }
}

/**
 * Lê e valida o conteúdo do arquivo de baseline.
 *
 * @param {string} content
 * @returns {{count: number, updatedAt: string, findings: object[]}}
 */
export function parseBaseline(content) {
  const j = JSON.parse(content)
  if (!Array.isArray(j.findings)) {
    throw new Error("baseline sem campo 'findings'")
  }
  return j
}

/**
 * Achados cuja assinatura de CONTEÚDO não existe no baseline — os NOVOS.
 *
 * Deduplicados por assinatura: o mesmo segredo costuma aparecer em VÁRIOS
 * commits (o audit varre `git log -p --all`, então o valor segue presente em
 * todo commit posterior), e por conteúdo ele é UM achado. Cada item devolvido
 * carrega `signature` e `commits[]` — o relatório nomeia onde o conteúdo vive
 * sem inflar a contagem com a mesma linha repetida.
 *
 * @param {Array<object>} current           achados do audit atual
 * @param {Array<object>} baselineFindings  achados do baseline
 * @returns {Array<object>} achados novos, um por assinatura, na ordem do audit
 */
export function findNewFindings(current, baselineFindings) {
  const known = new Set(baselineFindings.map(signatureOf))
  const porAssinatura = new Map()
  for (const f of current) {
    const signature = signatureOf(f)
    if (known.has(signature)) continue
    const visto = porAssinatura.get(signature)
    if (visto) visto.commits.push(f.commit)
    else porAssinatura.set(signature, { ...f, signature, commits: [f.commit] })
  }
  return [...porAssinatura.values()]
}

/**
 * O repositório é um CLONE RASSO? `true`/`false`, ou `null` quando não dá para
 * saber (git ausente, comando falhou).
 *
 * Existe porque num clone raso a proveniência do baseline some SEM que ninguém
 * tenha reescrito história: os commits estão lá no remoto, só não foram
 * baixados. Sem separar os dois, o relatório mandaria alguém caçar uma
 * reescrita que nunca aconteceu — diagnóstico errado é pior que diagnóstico
 * ausente, porque é seguido.
 *
 * @param {string} cwd
 * @returns {boolean | null}
 */
export function isShallowRepo(cwd) {
  const res = spawnSync("git", ["rev-parse", "--is-shallow-repository"], {
    cwd,
    encoding: "utf8",
  })
  if (res.status !== 0 || typeof res.stdout !== "string") return null
  const saida = res.stdout.trim()
  if (saida === "true") return true
  if (saida === "false") return false
  return null
}

/**
 * Os commits alcançáveis a partir de qualquer ref (`git rev-list --all`), ou
 * `null` quando não dá para saber (git ausente, repo sem refs, comando falhou).
 *
 * `null` NÃO é "nada alcançável": é INDETERMINADO. Confundir os dois faria o
 * guard relatar reescrita de história em qualquer ambiente sem git.
 *
 * @param {string} cwd
 * @returns {string[] | null}
 */
export function reachableCommits(cwd) {
  const res = spawnSync("git", ["rev-list", "--all"], {
    cwd,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  })
  if (res.status !== 0 || typeof res.stdout !== "string") return null
  return res.stdout
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * A PROVENIÊNCIA do baseline ainda existe neste repositório?
 *
 * Compara os commits registrados no baseline com o conjunto alcançável. Commit
 * do baseline que não está mais lá tem três causas possíveis — reescrita de
 * história (filter-repo/rebase/amend), branch apagado, ou clone raso. O guard
 * mede o FATO ("não é mais alcançável") e NÃO escolhe a causa por conta própria:
 * a única separação que ele faz é a que o ambiente pode provar — `git rev-parse
 * --is-shallow-repository`. Fora isso, o relatório nomeia as três para quem lê,
 * em vez de afirmar uma.
 *
 * Estados (padrão do resto do repositório: provado/violado/indisponível):
 *   - `intacta`       — todo commit do baseline continua alcançável
 *   - `reescrita`     — pelo menos um não é mais alcançável (história reescrita)
 *   - `raso`          — o mesmo, mas num CLONE RASSO: quase certamente os commits
 *                       existem no remoto e só não foram baixados
 *   - `indeterminado` — não foi possível listar os alcançáveis
 *
 * `raso` é um estado PRÓPRIO, e não `reescrita`, porque a AÇÃO do operador é
 * outra: um manda rodar `git fetch --unshallow`, o outro manda procurar a
 * reescrita. Colapsar os dois num só nome faria o relatório mandar caçar uma
 * reescrita que nunca aconteceu.
 *
 * Independente do estado, isto NUNCA falha o gate: é diagnóstico.
 *
 * @param {Array<{commit?: string}>} baselineFindings
 * @param {{reachable?: string[] | null, shallow?: boolean | null}} opts
 * @returns {{state: "intacta"|"reescrita"|"raso"|"indeterminado", baselineCommits: number, reachable: number, unreachable: string[]}}
 */
export function historyProvenance(baselineFindings, { reachable = null, shallow = null } = {}) {
  const commits = [...new Set(baselineFindings.map((f) => f.commit).filter(Boolean))]
  if (reachable === null) {
    return {
      state: "indeterminado",
      baselineCommits: commits.length,
      reachable: 0,
      unreachable: [],
    }
  }
  const alcancaveis = new Set(reachable)
  const unreachable = commits.filter((c) => !alcancaveis.has(c))
  // `shallow === true` SÓ reclassifica quando HÁ proveniência faltando: num
  // clone raso com todos os commits do baseline baixados não há fato a nomear.
  const state = unreachable.length === 0 ? "intacta" : shallow === true ? "raso" : "reescrita"
  return {
    state,
    baselineCommits: commits.length,
    reachable: commits.length - unreachable.length,
    unreachable,
  }
}

/**
 * O bloco de proveniência do relatório — o "motivo próprio" da reescrita.
 *
 * Existe como função pura porque a MENSAGEM é o contrato: o que o guard
 * promete quando a história é reescrita é dizer exatamente isto (o baseline
 * perdeu a proveniência, e por isso NENHUM achado conhecido vira "novo"), em
 * vez de despejar a lista de achados como se fossem vazamentos recém-introduzidos.
 *
 * @param {ReturnType<typeof historyProvenance>} prov
 * @returns {string[]} linhas (sem quebra) para o consumidor imprimir
 */
export function renderProvenance(prov) {
  if (prov.state === "indeterminado") {
    return [
      "📜 PROVENIÊNCIA DO BASELINE: INDETERMINADO — não consegui listar os commits alcançáveis",
      "   (git ausente ou repositório sem refs). Nada é afirmado sobre a história.",
    ]
  }
  if (prov.state === "intacta") {
    return [
      `📜 PROVENIÊNCIA DO BASELINE: os ${prov.baselineCommits} commit(s) do baseline continuam alcançáveis.`,
    ]
  }
  if (prov.state === "raso") {
    return [
      `📜 MOTIVO PRÓPRIO — CLONE RASSO: ${prov.unreachable.length} de ${prov.baselineCommits} commit(s) do`,
      "   baseline não estão neste clone (git rev-parse --is-shallow-repository = true). Num clone",
      "   raso os commits do baseline podem existir no remoto e simplesmente não ter sido baixados —",
      "   o mais provável é ISTO, não uma reescrita de história. Rode com o histórico completo",
      "   (fetch-depth: 0 / git fetch --unshallow) para o fato ser conclusivo. Nada foi acusado.",
    ]
  }
  return [
    `📜 MOTIVO PRÓPRIO — HISTÓRIA REESCRITA: ${prov.unreachable.length} de ${prov.baselineCommits} commit(s)`,
    "   do baseline NÃO são mais alcançáveis a partir de nenhuma ref (reescrita de história,",
    "   branch apagado ou clone raso). Isto NÃO é vazamento e NÃO é achado novo: a comparação",
    "   é por CONTEÚDO (arquivo:linha:padrão:chave:valor-mascarado) e não usa o commit — por isso",
    "   a reescrita não acusa nada. O `commit` do baseline é só proveniência, e pode ser",
    "   regenerado com --update quando a remediação terminar.",
  ]
}

/**
 * Aplica o filtro de severidade: separa os achados novos que DEVEM falhar
 * (severidade >= min) dos que são apenas AVISO (severidade < min). Com
 * min="baixa" (default) todo achado novo falha — comportamento histórico.
 *
 * @param {Array<object>} newFindings  achados novos (do findNewFindings)
 * @param {string} minSeverity  severidade mínima para falhar (baixa/média/alta)
 * @returns {{blocking: Array<object>, warnings: Array<object>}}
 */
export function splitBySeverity(newFindings, minSeverity) {
  const minRank = severityRank(minSeverity)
  const blocking = []
  const warnings = []
  for (const f of newFindings) {
    if (severityRank(f.severity) >= minRank) blocking.push(f)
    else warnings.push(f)
  }
  return { blocking, warnings }
}

function main() {
  const args = process.argv.slice(2)
  const update = args.includes("--update")
  const json = args.includes("--json")

  // --min-severity alta|média|baixa (default: baixa — comportamento histórico)
  const sevIdx = args.indexOf("--min-severity")
  let minSeverity = "baixa"
  if (sevIdx !== -1) {
    if (args[sevIdx + 1] === undefined || !SEVERITY_ORDER.includes(args[sevIdx + 1])) {
      console.error(
        `check-secret-leaks-baseline: --min-severity requer um de ${SEVERITY_ORDER.join("|")}`,
      )
      process.exit(2)
    }
    minSeverity = args[sevIdx + 1]
  }

  const baselineIdx = args.indexOf("--baseline")
  if (baselineIdx !== -1 && args[baselineIdx + 1] === undefined) {
    console.error("check-secret-leaks-baseline: --baseline requer um path")
    process.exit(2)
  }
  const baselinePath = baselineIdx !== -1 ? args[baselineIdx + 1] : DEFAULT_BASELINE

  const cwd = process.cwd()
  const baselineFile = join(cwd, baselinePath)

  // ── Roda o audit real (--json, sem --check → exit 0 mesmo com achados) ──
  // Reutiliza os padrões/masking do audit — UMA fonte de verdade para o que
  // é segredo (sem duplicar regex neste guard). O cwd é passado para o child
  // (o audit roda `git log -p --all` no repo do caller); o PATH do audit é
  // absoluto (AUDIT_PATH), nunca relativo ao cwd.
  const audit = spawnSync(process.execPath, [AUDIT_PATH, "--json"], {
    cwd,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  })

  if (audit.status !== 0 || !audit.stdout) {
    console.error(
      `❌ check-secret-leaks-baseline: audit-secret-leaks falhou (exit ${audit.status ?? "?"}) — não é um repo git?`,
    )
    console.error(audit.stderr ? audit.stderr.slice(0, 800) : "")
    process.exit(2)
  }

  let current
  try {
    current = JSON.parse(audit.stdout)
  } catch {
    console.error("❌ check-secret-leaks-baseline: audit retornou JSON inválido")
    process.exit(2)
  }

  // ── --update: regenera o baseline a partir do audit real ──────────────
  if (update) {
    mkdirSync(dirname(baselineFile), { recursive: true })
    const baseline = buildBaseline(current.findings)
    writeFileSync(baselineFile, `${JSON.stringify(baseline, null, 2)}\n`, "utf8")
    console.log(`✅ Baseline atualizado: ${baseline.count} achado(s) → ${baselinePath}`)
    process.exit(0)
  }

  // ── Fail-closed: baseline ausente sem --update ────────────────────────
  if (!existsSync(baselineFile)) {
    console.error(`❌ Baseline ausente: ${baselinePath}`)
    console.error(`   Rode primeiro: node scripts/check-secret-leaks-baseline.mjs --update`)
    process.exit(2)
  }

  let baseline
  try {
    baseline = parseBaseline(readFileSync(baselineFile, "utf8"))
  } catch (e) {
    console.error(`❌ Baseline inválido (${baselinePath}): ${e.message}`)
    process.exit(2)
  }

  // ── Proveniência do baseline (diagnóstico — NUNCA gate) ───────────────
  // Um commit do baseline que não está mais no histórico alcançável é MOTIVO
  // PRÓPRIO (história reescrita, branch apagado ou clone raso) — e é o fato
  // que, antes, aparecia disfarçado de "todos os achados são novos".
  const prov = historyProvenance(baseline.findings, {
    reachable: reachableCommits(cwd),
    shallow: isShallowRepo(cwd),
  })
  const emitirProveniencia = (paraErro = false) => {
    const out = paraErro ? console.error : console.log
    for (const linha of renderProvenance(prov)) out(`   ${linha}`)
  }

  // ── Comparação por CONTEÚDO — só achados NOVOS falham ─────────────────
  const newFindings = findNewFindings(current.findings, baseline.findings)
  // ── Filtro de severidade: com --min-severity alta, só novos ALTA falham ──
  const { blocking, warnings } = splitBySeverity(newFindings, minSeverity)

  if (json) {
    console.log(
      JSON.stringify(
        {
          count: current.count,
          baselineCount: baseline.count,
          newCount: newFindings.length,
          newFindings,
          history: prov,
          minSeverity,
          blockingCount: blocking.length,
          blocking,
        },
        null,
        2,
      ),
    )
    process.exit(blocking.length > 0 ? 1 : 0)
  }

  if (blocking.length === 0 && warnings.length === 0) {
    console.log(
      `🔒 check-secret-leaks-baseline: ${current.count} achado(s) — nenhum NOVO por conteúdo ` +
        `(baseline ${baseline.count}, ${baseline.updatedAt}).`,
    )
    emitirProveniencia()
    process.exit(0)
  }

  if (blocking.length === 0 && warnings.length > 0) {
    // Achados novos de severidade ABAIXO do mínimo: aviso (não falha)
    console.error(
      `⚠️  ${warnings.length} achado(s) NOVO(s) de severidade abaixo de '${minSeverity}' ` +
        `(não bloqueiam com --min-severity ${minSeverity}):\n`,
    )
    for (const f of warnings) {
      console.error(
        `   • ${f.commit.slice(0, 12)}  ${f.file}:${f.line}  [${f.id} (${f.severity ?? "?"})]  ${f.masked}` +
          (f.key ? `  (chave: ${f.key})` : ""),
      )
    }
    emitirProveniencia(true)
    process.exit(0)
  }

  console.error(
    `🔓 check-secret-leaks-baseline: ${blocking.length} CONTEÚDO(s) NOVO(s) de severidade ` +
      `>= '${minSeverity}' no histórico (baseline ${baseline.count} → atual ${current.count}):\n`,
  )
  for (const f of blocking) {
    console.error(
      `   • ${f.commit.slice(0, 12)}  ${f.file}:${f.line}  [${f.id} (${f.severity ?? "?"})]  ${f.masked}` +
        (f.key ? `  (chave: ${f.key})` : ""),
    )
  }
  if (warnings.length > 0) {
    console.error(
      `\nℹ️  + ${warnings.length} achado(s) novo(s) de severidade menor (não bloqueiam com '${minSeverity}').`,
    )
  }
  console.error("")
  emitirProveniencia(true)
  console.error(
    `\n⚠️  Segredo NOVO commitado — ROTACIONE o valor (node scripts/rotate-secrets.mjs).` +
      `\n   Após remediar, atualize o baseline: node scripts/check-secret-leaks-baseline.mjs --update`,
  )
  process.exit(1)
}

// True apenas quando executado diretamente (node ...) — permite importar as
// funções puras em testes unitários sem disparar o scan.
const IS_DIRECT_RUN =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (IS_DIRECT_RUN) main()
