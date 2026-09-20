#!/usr/bin/env node
// =============================================================================
// check-github-dependencies.mjs
//
// O INVENTARIO do que o GitHub sustenta hoje, medido — e a CATRACA: nenhuma
// dependencia NOVA do GitHub entra sem uma decisao escrita (a etapa do corte que
// a remove e o que a substitui).
//
// POR QUE EXISTE
//
// O projeto nao usa tecnologia paga e a forja dona do merge e a Gitea (o
// `ci/required-checks.json` tem uma lista por forja e o `check:forge-parity`
// exige o MESMO comando das invariantes do CORE nas duas). Mesmo assim o GitHub
// sustenta coisas que ninguem ve num PR: 27 workflows, 9 crons, 14 actions de
// terceiro, o GHCR como registry, o `gh` CLI em 17 scripts, o runner
// auto-hospedado de TODOS os jobs e o Dependabot. A alternativa "usar so o
// repositorio local" nao substitui isso: sem PR, checks, issues e UI nao existe
// o portao de merge que este repositorio passou a construir — o espelho bare e a
// camada de DURABILIDADE (backup offsite), nao a de colaboracao.
//
// O defeito que este guard fecha e o do dia seguinte: um PR que acrescenta um
// workflow, um cron, uma action de marketplace ou um servico do GitHub
// AUMENTA o custo do corte em silencio. A migracao so anda para baixo, e cada
// passo dela e um ATO: quem corta uma dependencia atualiza o inventario no mesmo
// commit (ou o guard acusa a declaracao envelhecida).
//
// A MEDICAO (por classe, derivada das fontes do repositorio)
//
//   workflows          — os arquivos de `.github/workflows/` (a pipeline inteira)
//   crons              — as entradas `- cron:` desses workflows (o agendador do GitHub)
//   marketplace-actions— os `uses:` de actions de TERCEIRO (o que o runner baixa da forja)
//   reusable-local     — os workflows reusaveis referenciados (`uses: ./.github/...`)
//   ghcr-images        — as referencias a `ghcr.io/` em arquivos versionados de
//                        CODIGO (a prosa do PROPRIO auditor fica fora: ela
//                        DESCREVE a classe e nao e um lugar onde o flip nao
//                        chegou — ver `ARQUIVOS_DO_AUDITOR`)
//   gh-cli             — os arquivos versionados que chamam o `gh`
//   actions-plane      — `vars.`/`secrets.`/`github.token` nos workflows do GitHub
//   github-services    — os SERVICOS do GitHub em uso (Dependabot, github-script,
//                        dependency-review, agentes de artifact, actionlint,
//                        runner auto-hospedado, Gist)
//
// O CONTRATO (fail-closed, na mesma direcao do resto do repositorio)
//
//  1. classe MEDIDA e nao declarada -> violacao. Um TIPO novo de dependencia do
//     GitHub nao entra em silencio: quem o introduz declara a classe, com a
//     etapa do corte e o substituto.
//  2. lista declarada x lista medida, nos DOIS sentidos: item novo = dependencia
//     nova; item declarado que sumiu = declaracao envelhecida (o corte foi feito
//     e o inventario nao acompanhou — atualizar e o ato).
//  3. contador: `medido > declarado` = dependencia nova; `medido < declarado` =
//     o inventario mente sobre o que ainda existe.
//  4. toda classe declarada precisa de `estagio` e `substituto`: uma dependencia
//     declarada SEM plano e o que a `docs/GITHUB_CUT.md` existe para impedir.
//
// A FONTE DA DECLARACAO e um DADO versionado (`ci/github-dependencies.json`), e
// nao uma lista no codigo: o inventario e revisoravel num diff e o `--update`
// reescreve SO os campos medidos (`declarado`), preservando a prosa (etapa,
// substituto, por que) — uma classe nova continua sendo decisao humana.
//
// Usage:
//   node scripts/check-github-dependencies.mjs              # mede e confere
//   node scripts/check-github-dependencies.mjs --json       # inventario estruturado
//   node scripts/check-github-dependencies.mjs --only crons # so uma classe
//   node scripts/check-github-dependencies.mjs --update     # congela o medido (o ATO)
//   node scripts/check-github-dependencies.mjs -h
//
// Exit codes:
//   0 — o inventario confere com o medido (e nenhuma classe ficou sem declaracao)
//   1 — violacao: classe nova, dependencia nova, declaracao envelhecida ou classe
//       sem etapa/substituto
//   2 — falha de infra (o dado da declaracao ilegivel/invalido, git indisponivel)
// =============================================================================

import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import {
  GITHUB_WORKFLOW_DIR,
  executableLines,
  stripSlashComment,
  workflowFileNames,
} from "./forge-workflows.mjs"

/** A raiz do repositorio (este arquivo vive em `scripts/`). */
export const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..")

/**
 * Uma classe do inventario, ja com a medicao do momento.
 *
 * `kind: "lista"` compara `declarado` com `medido` item a item; `kind:
 * "contador"` compara os dois numeros. `medido` tem o tipo do `kind`.
 *
 * @typedef {{id: string, titulo: string, kind: "lista"|"contador", unidade: string,
 *            papel: string, medir: (root: string) => string[]|number,
 *            estagio?: number, substituto?: string, porque?: string,
 *            declarado?: string[]|number, medido: string[]|number}} ClasseInventario
 * @typedef {{version?: number, atualizadoEm?: string, estagios?: {id: number, titulo: string, entrega: string}[],
 *            classes?: ClasseInventario[]}} Declaracao
 */

/** O DADO versionado que declara o inventario (o alvo do `--update`). */
export const DATA = "ci/github-dependencies.json"

/** O caminho DESTE arquivo, relativo a raiz (o auditor nao se conta). */
export const AUDITOR = relative(ROOT, fileURLToPath(import.meta.url))

/** Exit codes — o contrato da CLI. */
export const EXIT = { OK: 0, VIOLACAO: 1, USO: 2 }

/**
 * As ETAPAS do corte (`docs/GITHUB_CUT.md`). Cada uma e shippable sozinha — e o
 * inventario guarda, por dependencia, QUAL etapa a remove: uma dependencia sem
 * etapa declarada e uma dependencia sem plano.
 */
export const ESTAGIOS = [
  {
    id: 1,
    titulo: "Registry proprio + as duas imagens",
    entrega:
      "as imagens (Bun mirror e ubuntu-bun do runner) publicadas no registry OCI embutido da Gitea/Forgejo e o flip de IMAGE_REGISTRY/IMAGE_NAMESPACE (uma variavel cada, ja parametrizadas por desenho)",
  },
  {
    id: 2,
    titulo: "Os 9 crons e as vars do Actions",
    entrega:
      "os agendadores migrados para a Gitea (benchmarks, espelhos, auditorias) e as repository variables replicadas, com o manifesto de required checks por forja ja refletindo isso",
  },
  {
    id: 3,
    titulo: "Canais que ainda sao so-GitHub + o `gh` CLI",
    entrega:
      "os publicadores de issue/comentario que so falam GitHub passando a `--backend gitea`, o Dependabot substituido (Renovate ou o bump proprio) e o `gh` fora dos scripts versionados",
  },
  {
    id: 4,
    titulo:
      "Servicos acoplados a Actions (artifact, github-script, dependency-review, actionlint, Gist)",
    entrega:
      "o transporte de artifact, os scripts inline, a revisao de dependencia e o lint de workflow resolvidos por ferramenta do repositorio; o benchmark deixa de publicar Gist",
  },
  {
    id: 5,
    titulo: "O runner auto-hospedado e a pipeline do espelho",
    entrega:
      "os jobs do GitHub desligados (o repositorio fica espelho read-only do bundle) e o `deploy/GITHUB_RUNNER.md` + `setup-github-runner.sh` removidos",
  },
]

/**
 * As CLASSES medidas. `kind` diz COMO comparar; `papel` diz o que a classe e no
 * corte; `medir` e a regra (derivada das fontes do repositorio, nunca de uma
 * lista a mao — a lista a mao e a DECLARACAO, no dado versionado).
 *
 * @type {{id: string, titulo: string, kind: "lista"|"contador", unidade: string,
 *        papel: string, medir: (root: string) => string[]|number}[]}
 */
export const CLASSES = [
  {
    id: "workflows",
    titulo: "workflows do GitHub",
    kind: "lista",
    unidade: "arquivo",
    papel:
      "a pipeline inteira do espelho: cada arquivo e um lugar onde o merge de outro lado pode divergir do da forja",
    medir: (root) =>
      workflowFileNames(root, GITHUB_WORKFLOW_DIR).map((f) => `${GITHUB_WORKFLOW_DIR}/${f}`),
  },
  {
    id: "crons",
    titulo: "crons agendados pelo GitHub",
    kind: "lista",
    unidade: "entrada `- cron:`",
    papel:
      "o agendador e do GitHub: enquanto um cron vive aqui, a auditoria/benchmark/mirror depende de quem nao e a forja dona do merge",
    medir: (root) => {
      const out = []
      for (const nome of workflowFileNames(root, GITHUB_WORKFLOW_DIR)) {
        const rel = `${GITHUB_WORKFLOW_DIR}/${nome}`
        const linhas = executableLines(readFileSync(join(root, rel), "utf8").split(/\r?\n/))
        for (const linha of linhas) {
          // A expressao cron tem ESPACOS (`0 3 * * 0`): a captura vai ate a
          // aspa (ou o fim da linha), nunca ate o primeiro espaco.
          const m = linha.match(/^\s*-\s*cron:\s*["']?([^"'#]+?)["']?\s*$/)
          if (m) out.push(`${rel}#${m[1]}`)
        }
      }
      return out.sort()
    },
  },
  {
    id: "marketplace-actions",
    titulo: "actions de terceiro (`uses:`)",
    kind: "lista",
    unidade: "referencia `uses:`",
    papel:
      "cada uma e codigo de terceiro baixado pela forja: trocar de forja significa trocar o provedor de cada uma (ou fazer o que ela faz)",
    medir: (root) => usosDosWorkflows(root).terceiros,
  },
  {
    id: "reusable-local",
    titulo: "workflows reusaveis referenciados",
    kind: "lista",
    unidade: "referencia `uses: ./.github/...`",
    papel:
      "a pipeline do espelho reaproveita workflows por `uses: ./...` — uma forma de dependencia que nao aparece em nenhuma matriz de jobs",
    medir: (root) => usosDosWorkflows(root).locais,
  },
  {
    id: "ghcr-images",
    titulo: "referencias a `ghcr.io`",
    kind: "contador",
    unidade: "ocorrencia",
    papel:
      "o registry e proprietario (cota de storage/egress) e o flip e de UMA variavel — mas cada referencia literal e um lugar onde o flip nao chegou",
    medir: (root) => contarOcorrencias(root, /ghcr\.io\//g),
  },
  {
    id: "gh-cli",
    titulo: "scripts que chamam o `gh`",
    kind: "lista",
    unidade: "arquivo",
    papel:
      "o `gh` fala com a API do GitHub com credencial de administracao: cada script que o chama e um passo que so existe neste lado",
    medir: (root) =>
      arquivosVersionados(root).filter((rel) => ehCodigoQueRoda(rel) && chamaGh(root, rel)),
  },
  {
    id: "actions-plane",
    titulo: "plano de configuracao do Actions",
    kind: "contador",
    unidade: "ocorrencia (`vars.`/`secrets.`/token)",
    papel:
      "as repository variables e secrets vivem NA FORJA: enquanto os workflows do GitHub os consomem, o valor tem de existir nos dois lados (e um dos lados nao e versionado)",
    medir: (root) => {
      let total = 0
      for (const nome of workflowFileNames(root, GITHUB_WORKFLOW_DIR)) {
        const texto = readFileSync(join(root, GITHUB_WORKFLOW_DIR, nome), "utf8")
        total += (texto.match(/\bvars\./g) ?? []).length
        total += (texto.match(/\bsecrets\./g) ?? []).length
        total += (texto.match(/github\.token|GITHUB_TOKEN/g) ?? []).length
      }
      return total
    },
  },
  {
    id: "github-services",
    titulo: "servicos do GitHub em uso",
    kind: "lista",
    unidade: "servico",
    papel:
      "servico nao porta por `git push`: ou existe equivalente na forja propria, ou a funcao deixa de existir",
    medir: (root) => SERVICOS.filter((s) => s.presente(root)).map((s) => s.id),
  },
]

/** Um arquivo cujo conteudo entra na varredura por ocorrencia. */
const ARQUIVOS_DE_REGISTRY = /\.(ya?ml|json|md|mjs|ts|tsx|sh|env|example)$|^Dockerfile/

/**
 * Os SERVICOS do GitHub que o repositorio usa, com a regra de PRESENCA de cada
 * um. A lista e a fonte da verdade do `kind: "lista"` da classe
 * `github-services` — acrescentar um servico aqui e o ato de reconhecer a
 * dependencia nova (com etapa e substituto, na declaracao).
 */
export const SERVICOS = [
  {
    id: "dependabot",
    o_que: "atualizacao de dependencia do GitHub",
    presente: (root) => existsSync(join(root, ".github/dependabot.yml")),
  },
  {
    id: "github-script",
    o_que: "scripts inline no runner (`actions/github-script`)",
    presente: (root) => workflowsCitam(root, /actions\/github-script@/),
  },
  {
    id: "dependency-review",
    o_que: "revisao de dependencia do PR (`actions/dependency-review-action`)",
    presente: (root) => workflowsCitam(root, /actions\/dependency-review-action@/),
  },
  {
    id: "actionlint",
    o_que: "lint de workflow pelo container oficial (`docker://rhysd/actionlint`)",
    presente: (root) => workflowsCitam(root, /docker:\/\/[^\s]*actionlint/),
  },
  {
    id: "artifact-transport",
    o_que: "transporte de artifact entre jobs (`actions/upload|download-artifact`)",
    presente: (root) => workflowsCitam(root, /actions\/(?:upload|download)-artifact@/),
  },
  {
    id: "self-hosted-runner",
    o_que: "runner auto-hospedado do GitHub (`runs-on: self-hosted`)",
    presente: (root) => workflowsCitam(root, /runs-on:\s*self-hosted/),
  },
  {
    id: "gist",
    o_que: "publicacao no Gist (benchmark do espelho)",
    presente: (root) =>
      arquivosVersionados(root).some(
        (rel) => /gist/i.test(rel) && /\.(mjs|sh)$/.test(rel) && !/test-mutation/.test(rel),
      ),
  },
]

// ── a medicao ───────────────────────────────────────────────────────────────

/**
 * Os arquivos VERSIONADOS (o que o commit leva), relativos a raiz.
 *
 * `git ls-files` e a mesma fonte do resto dos guards: um arquivo nao versionado
 * (build, cache) nao e dependencia do repositorio. Sem git (ou fora de um
 * repositorio) o guard NAO presume lista vazia — ele falha alto, porque "nao
 * consegui listar" nao pode virar "nao ha dependencia".
 *
 * @param {string} root
 * @returns {string[]}
 */
export function arquivosVersionados(root) {
  const saida = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" })
  return saida
    .split("\0")
    .filter((p) => p !== "")
    .sort()
}

/**
 * O arquivo e CODIGO QUE RODA (nao doc, nao fixture)?
 *
 * A exclusao nao e cosmetica: uma prova por mutacao carrega o texto do defeito
 * como PAYLOAD, e um teste que dubla o `gh` nao e o repositorio dependendo dele.
 * Contar os dois inflaria a classe com o que ela nao mede.
 */
function ehCodigoQueRoda(rel) {
  if (rel.startsWith("docs/")) return false
  if (rel.startsWith("node_modules/")) return false
  if (rel.includes("__tests__/")) return false
  if (/test-mutation[^/]*\.sh$/.test(rel)) return false
  return true
}

/**
 * Os arquivos do PROPRIO auditor ficam fora da varredura por ocorrencia.
 *
 * A classe `ghcr-images` conta "cada referencia literal e um lugar onde o flip
 * nao chegou" — e a prosa que DESCREVE a contagem nao e um lugar do repositorio:
 * o cabecalho deste guard cita o padrao, e o `porque` da declaracao o explica.
 * Contando os dois, o medido subia de 50 para 52 no PROPRIO commit que declarou a
 * classe — o auditor inflava a si mesmo ao se documentar — e o `--update` para 52
 * congelaria essa inflacao na catraca, que so pode ANDAR PARA BAIXO. Documentar a
 * classe e editar doc, nao introduzir dependencia: o numero continua medindo o
 * repositorio.
 */
const ARQUIVOS_DO_AUDITOR = new Set([AUDITOR, DATA])

/** Um arquivo entra na varredura por ocorrencia? */
function arquivoDeCodigo(rel) {
  if (ARQUIVOS_DO_AUDITOR.has(rel)) return false
  return ehCodigoQueRoda(rel) && ARQUIVOS_DE_REGISTRY.test(rel)
}

/**
 * As ocorrencias de um padrao em arquivos versionados de CODIGO.
 *
 * @param {string} root
 * @param {RegExp} re  global (a contagem e por ocorrencia)
 * @param {RegExp} filtro  quais arquivos entram
 * @returns {number}
 */
export function contarOcorrencias(root, re, filtro = arquivoDeCodigo) {
  let total = 0
  for (const rel of arquivosVersionados(root)) {
    if (!filtro(rel)) continue
    const abs = join(root, rel)
    if (!existsSync(abs)) continue
    total += (readFileSync(abs, "utf8").match(new RegExp(re.source, "g")) ?? []).length
  }
  return total
}

/**
 * O arquivo chama o `gh` (a CLI do GitHub) em linha executavel?
 *
 * O escopo e o codigo que EXECUTA no fluxo do repositorio (`scripts/` e os
 * hooks): um teste que dubla o `gh` prova o comportamento do script, nao a
 * dependencia — e a lista de testes cresce sozinha a cada guard novo.
 */
export function chamaGh(root, rel) {
  if (!/^(scripts|\.husky)\//.test(rel)) return false
  if (!/\.(mjs|ts|tsx|sh|bash)$/.test(rel)) return false
  if (/test-mutation/.test(rel)) return false
  // A régua de COMENTARIO depende da linguagem: o `#` do shell/YAML e o `//` do
  // JavaScript. As duas vêm do `forge-workflows` (fonte única da régua) — ler a
  // linha comentada como comando faria um `# gh api ...` virar dependência.
  const linhas = ehJavaScript(rel)
    ? readFileSync(join(root, rel), "utf8")
        .split(/\r?\n/)
        .map(stripSlashComment)
        .filter((l) => l.trim() !== "")
    : executableLines(readFileSync(join(root, rel), "utf8").split(/\r?\n/), null)
  // A borda antes do `gh` inclui aspas e crase: o comando aparece em
  // `await run('gh api ...')` e num template de shell.
  return linhas.some((l) =>
    /(^|[\s(|;&='"`])(?:\/usr\/bin\/)?gh\s+(?:api|pr|issue|release|workflow|variable|auth|run|secret|repo)\b/.test(
      l,
    ),
  )
}

/** Extensões cujo comentário de linha é `//` (e não `#`). */
function ehJavaScript(rel) {
  return /\.(mjs|ts|tsx)$/.test(rel)
}

/** Algum workflow do GitHub cita o padrao? */
function workflowsCitam(root, re) {
  return workflowFileNames(root, GITHUB_WORKFLOW_DIR).some((nome) =>
    re.test(readFileSync(join(root, GITHUB_WORKFLOW_DIR, nome), "utf8")),
  )
}

/**
 * Os `uses:` dos workflows do GitHub, separados em actions de TERCEIRO e
 * workflows reusaveis do proprio repositorio. Linhas de comentario e `${{ }}`
 * saem pela regua compartilhada (`executableLines`) — a mesma do
 * `check-forge-parity`.
 *
 * @param {string} root
 * @returns {{terceiros: string[], locais: string[]}}
 */
export function usosDosWorkflows(root) {
  const terceiros = new Set()
  const locais = new Set()
  for (const nome of workflowFileNames(root, GITHUB_WORKFLOW_DIR)) {
    const linhas = executableLines(
      readFileSync(join(root, GITHUB_WORKFLOW_DIR, nome), "utf8").split(/\r?\n/),
    )
    for (const linha of linhas) {
      // O `- ` na frente é o item de lista do YAML (as duas formas aparecem).
      const m = linha.match(/^\s*-?\s*uses:\s*([^\s#]+)/)
      if (!m) continue
      const ref = m[1]
      if (ref.startsWith("./")) {
        if (ref.startsWith("./.github/")) locais.add(ref)
      } else if (!ref.startsWith("docker://actions/")) {
        terceiros.add(ref)
      }
    }
  }
  return { terceiros: [...terceiros].sort(), locais: [...locais].sort() }
}

/**
 * O INVENTARIO: para cada classe, o medido agora e o declarado no dado.
 *
 * @param {{root?: string, data?: Declaracao|null}} [opts]
 * @returns {{classes: ClasseInventario[], estagios: {id: number, titulo: string, entrega: string}[], faltando: string[]}}
 */
export function inventario({ root = ROOT, data = null } = {}) {
  const declarado = data ?? lerDeclaracao(root)
  const porId = new Map(CLASSES.map((c) => [c.id, c]))
  const classes = []
  const faltando = []
  for (const classe of CLASSES) {
    const entrada = declarado.classes?.find((c) => c.id === classe.id)
    if (!entrada) {
      faltando.push(classe.id)
      continue
    }
    classes.push({ ...classe, ...entrada, medido: classe.medir(root) })
  }
  // Uma classe DECLARADA que nao existe mais no codigo e a mesma classe nova, do
  // outro lado: a declaracao cobre algo que ninguem mede (e um numero que
  // envelhece sozinho).
  for (const entrada of declarado.classes ?? []) {
    if (!porId.has(entrada.id)) faltando.push(entrada.id)
  }
  return { classes, estagios: declarado.estagios ?? ESTAGIOS, faltando }
}

/**
 * As dependencias NOVAS do GitHub: o item que ENTROU no repositorio sem estar
 * na declaracao (ou, nas classes de contagem, o quanto o medido passou do
 * declarado).
 *
 * POR QUE ISTO E UMA FUNCAO, E NAO UM PEDACO DO RENDER DAS VIOLACOES: as duas
 * leituras do mesmo fato — o texto que o GATE imprime no PR e a ISSUE que o cron
 * publica — tem de sair da MESMA derivacao. Se o publicador remontasse a lista
 * de novos por conta propria (filtrando medido x declarado por fora), a regra do
 * canal divergiria da regra que bloqueia o merge no dia em que uma delas mudasse
 * — e a divergencia apareceria como uma issue acusando um item que o gate aceita
 * (ou, pior, um item NOVO que nenhuma das duas enxerga).
 *
 * Cada entrada carrega o que o canal precisa escrever: a CLASSE (id/titulo/
 * papel/unidade), a ETAPA do corte que a remove (id/titulo/entrega, do proprio
 * manifesto) e o DELTA (1 item, ou quantas ocorrencias/arquivos a mais), alem do
 * SUBSTITUTO e do `porque` declarados.
 *
 * `item` e o NOME do que entrou nas classes de lista (um arquivo, um cron, uma
 * `uses:`, um servico) e `null` nas de contagem — onde o que entrou e numero, e
 * nao ha nome a citar.
 *
 * @param {ReturnType<typeof inventario>} inv
 * @returns {{classe: string, titulo: string, kind: "lista"|"contador", unidade: string,
 *            papel: string, item: string|null, delta: number, medido: number|string[],
 *            declarado: number|string[], totalMedido: number, totalDeclarado: number,
 *            estagio: number|null, etapa: {id: number, titulo: string, entrega: string}|null,
 *            substituto: string|null, porque: string|null}[]}
 */
export function novasDependencias(inv) {
  const novas = []
  for (const c of inv.classes) {
    const etapa = ESTAGIOS.find((e) => e.id === c.estagio) ?? null
    const base = {
      classe: c.id,
      titulo: c.titulo,
      kind: c.kind,
      unidade: c.unidade,
      papel: c.papel,
      estagio: Number.isInteger(c.estagio) ? c.estagio : null,
      etapa,
      substituto: typeof c.substituto === "string" ? c.substituto : null,
      porque: typeof c.porque === "string" ? c.porque : null,
    }
    if (c.kind === "lista") {
      const declarado = c.declarado ?? []
      const medido = c.medido
      for (const item of medido) {
        if (declarado.includes(item)) continue
        novas.push({
          ...base,
          item,
          delta: 1,
          medido,
          declarado,
          totalMedido: medido.length,
          totalDeclarado: declarado.length,
        })
      }
    } else if (c.kind === "contador") {
      const medido = Number(c.medido)
      const declarado = Number(c.declarado)
      // Um contador ILEGIVEL nao e "nenhuma dependencia nova": e um dado que nao
      // da para julgar. Ele sai daqui (a violacao de dado invalido e do gate) e a
      // guarda de fechamento do canal recusa reconciliar com ele.
      if (!Number.isInteger(declarado) || medido <= declarado) continue
      novas.push({
        ...base,
        item: null,
        delta: medido - declarado,
        medido,
        declarado,
        totalMedido: medido,
        totalDeclarado: declarado,
      })
    }
  }
  return novas
}

/**
 * As violacoes: classe nova/sem declaracao, item novo, declaracao envelhecida e
 * classe sem etapa ou substituto.
 *
 * As de DEPENDENCIA NOVA saem de `novasDependencias` (a mesma derivacao que o
 * canal periodico publica); as de DECLARACAO — classe sem etapa/substituto, item
 * que sumiu, contador abaixo do declarado, dado invalido — sao do gate e nao
 * viram issue: elas se corrigem no MESMO commit (o PR nao passa sem isso), e uma
 * issue para cada uma delas transformaria o board num espelho do diff.
 *
 * @param {ReturnType<typeof inventario>} inv
 * @returns {string[]}
 */
export function violacoesDeGitHub(inv) {
  const violacoes = []
  const novas = novasDependencias(inv)
  for (const c of inv.classes) {
    const onde = `classe '${c.id}'`
    if (!Number.isInteger(c.estagio) || !ESTAGIOS.some((e) => e.id === c.estagio)) {
      violacoes.push(
        `${onde}: sem ETAPA do corte declarada (ou apontando para uma etapa que nao existe). Uma dependencia do GitHub sem etapa e uma dependencia sem plano — declare QUAL das ${ESTAGIOS.length} etapas a remove.`,
      )
    }
    if (typeof c.substituto !== "string" || c.substituto.trim() === "") {
      violacoes.push(
        `${onde}: sem SUBSTITUTO declarado. Se a dependencia nao tem equivalente na forja propria, escreva isso (a funcao deixa de existir) — o campo vazio esconde a decisao.`,
      )
    }
    const novasDesta = novas.filter((n) => n.classe === c.id)
    if (c.kind === "lista") {
      const medido = c.medido
      const declarado = c.declarado ?? []
      const sumidos = declarado.filter((x) => !medido.includes(x))
      for (const n of novasDesta) {
        violacoes.push(
          `${onde}: dependencia NOVA do GitHub — ${n.item}. Ela entra com etapa (${c.estagio}) e substituto (${c.substituto}) declarados: se ela e temporaria, diga em qual etapa sai.`,
        )
      }
      for (const x of sumidos) {
        violacoes.push(
          `${onde}: declaracao ENVELHECIDA — ${x} nao existe mais no repositorio. Atualize o inventario no MESMO commit do corte (rode --update e revise o diff): o numero tem de dizer o que ainda existe.`,
        )
      }
    } else if (c.kind === "contador") {
      const medido = Number(c.medido)
      const declarado = Number(c.declarado)
      if (!Number.isInteger(declarado)) {
        violacoes.push(
          `${onde}: contador declarado invalido (${c.declarado}) — o campo e o numero medido na ultima medicao.`,
        )
      } else if (medido > declarado) {
        violacoes.push(
          `${onde}: dependencia NOVA do GitHub — ${medido} ${c.unidade}(s) contra ${declarado} declarada(s) (${medido - declarado} a mais). A catraca so anda para baixo: a etapa ${c.estagio} e o substituto (${c.substituto}) sao a decisao escrita desta classe.`,
        )
      } else if (medido < declarado) {
        violacoes.push(
          `${onde}: declaracao ENVELHECIDA — ${medido} ${c.unidade}(s) medidas contra ${declarado} declarada(s) (o corte ja aconteceu). Rode --update e revise o diff no MESMO commit.`,
        )
      }
    }
  }
  for (const id of inv.faltando) {
    violacoes.push(
      `classe '${id}': declarada e medida de forma DIVERGENTE — a lista de classes do guard e o dado versionado (${DATA}) discordam. Alinhe os dois no mesmo commit.`,
    )
  }
  return violacoes
}

/**
 * O relatorio em texto: o inventario por etapa (a barra de progresso do corte) e
 * o detalhe por classe.
 *
 * @param {ReturnType<typeof inventario>} inv
 * @returns {string}
 */
export function renderInventario(inv) {
  const linhas = []
  const total = inv.classes.reduce((n, c) => n + (c.kind === "lista" ? c.medido.length : 1), 0)
  linhas.push(`inventario do GitHub: ${inv.classes.length} classe(s), ${total} item(ns) medido(s)`)
  for (const e of inv.estagios) {
    const desta = inv.classes.filter((c) => c.estagio === e.id)
    const itens = desta.reduce((n, c) => n + (c.kind === "lista" ? c.medido.length : 1), 0)
    linhas.push(
      `  etapa ${e.id} — ${e.titulo}: ${desta.length} classe(s), ${itens} item(ns) ${desta.length === 0 ? "(nada aqui)" : `(${desta.map((c) => c.id).join(", ")})`}`,
    )
  }
  linhas.push("por classe:")
  for (const c of inv.classes) {
    const medido =
      c.kind === "lista" ? `${c.medido.length} ${c.unidade}(s)` : `${c.medido} ${c.unidade}(s)`
    const declarado = c.kind === "lista" ? `${(c.declarado ?? []).length}` : `${c.declarado}`
    linhas.push(`  ${c.id} — medido ${medido} · declarado ${declarado} · etapa ${c.estagio}`)
    linhas.push(`      o que e: ${c.papel}`)
    linhas.push(`      substituto (etapa ${c.estagio}): ${c.substituto}`)
    linhas.push(`      por que ainda existe: ${c.porque}`)
    if (c.kind === "lista" && c.medido.length > 0) {
      linhas.push(`      itens: ${c.medido.join(", ")}`)
    }
  }
  return linhas.join("\n")
}

// ── a declaracao (o dado versionado) ───────────────────────────────────────

/**
 * Le o dado versionado. Um dado AUSENTE ou ILEGIVEL e falha de infra (exit 2):
 * sem a declaracao nao existe catraca — e presumir "nada declarado" faria o
 * guard reprovar tudo (ou, pior, passar tudo).
 *
 * @param {string} root
 * @returns {Declaracao}
 */
export function lerDeclaracao(root) {
  const abs = join(root, DATA)
  if (!existsSync(abs)) {
    throw new Error(`o inventario declarado (${DATA}) nao existe — sem ele nao ha catraca`)
  }
  try {
    return JSON.parse(readFileSync(abs, "utf8"))
  } catch (err) {
    throw new Error(`o inventario declarado (${DATA}) nao e JSON valido: ${err?.message ?? err}`)
  }
}

/**
 * O ATO: congela o MEDIDO no dado versionado, preservando a prosa (etapa,
 * substituto, por que). Nunca acrescenta classe nova — uma classe nova e
 * decisao humana, com etapa e substituto.
 *
 * @param {{root?: string, inv: ReturnType<typeof inventario>}} args
 * @returns {string} o JSON pronto para gravar
 */
export function congelar({ root = ROOT, inv }) {
  const atual = lerDeclaracao(root)
  const classes = (atual.classes ?? []).map((c) => {
    const medido = inv.classes.find((x) => x.id === c.id)
    return medido ? { ...c, declarado: medido.medido } : c
  })
  return `${JSON.stringify({ ...atual, classes }, null, 2)}\n`
}

// ── CLI ─────────────────────────────────────────────────────────────────────

export const USAGE = `check-github-dependencies — o inventario do que o GitHub sustenta, com catraca.

Mede, por classe (workflows, crons, actions de terceiro, workflows reusaveis,
referencias a ghcr.io, scripts que chamam o gh, plano de configuracao do Actions
e servicos do GitHub) e confere contra a declaracao versionada em ${DATA}.

Usage:
  node scripts/check-github-dependencies.mjs           # mede e confere
  node scripts/check-github-dependencies.mjs --json
  node scripts/check-github-dependencies.mjs --only <classe>
  node scripts/check-github-dependencies.mjs --update  # congela o medido (o ATO)
  node scripts/check-github-dependencies.mjs -h

Exit codes: 0 inventario confere · 1 violacao (dependencia nova / declaracao
envelhecida / classe sem etapa ou substituto) · 2 infra`

const IS_DIRECT_RUN =
  process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1]}`).href

if (IS_DIRECT_RUN) {
  const args = process.argv.slice(2)
  if (args.includes("-h") || args.includes("--help")) {
    console.log(USAGE)
    process.exit(EXIT.OK)
  }
  let inv
  try {
    inv = inventario({ root: ROOT })
  } catch (err) {
    console.error(`❌ ${err?.message ?? err}`)
    process.exit(EXIT.USO)
  }
  const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null
  if (only !== null) {
    if (!CLASSES.some((c) => c.id === only)) {
      console.error(
        `❌ --only ${only}: classe desconhecida (${CLASSES.map((c) => c.id).join(", ")}).`,
      )
      process.exit(EXIT.USO)
    }
    inv = { ...inv, classes: inv.classes.filter((c) => c.id === only) }
  }

  if (args.includes("--update")) {
    const texto = congelar({ inv })
    writeFileSync(join(ROOT, DATA), texto, "utf8")
    console.log(
      `✅ ${DATA} atualizado: o medido virou a declaracao (revise o diff — o numero tem de dizer o que existe).`,
    )
    const violacoes = violacoesDeGitHub(inv)
    for (const v of violacoes) console.error(`⚠️  ${v}`)
    process.exit(violacoes.length === 0 ? EXIT.OK : EXIT.VIOLACAO)
  }

  const violacoes = violacoesDeGitHub(inv)
  if (args.includes("--json")) {
    console.log(
      JSON.stringify(
        {
          classes: inv.classes.map((c) => ({
            id: c.id,
            kind: c.kind,
            estagio: c.estagio,
            substituto: c.substituto,
            porque: c.porque,
            declarado: c.declarado,
            medido: c.medido,
          })),
          violacoes,
        },
        null,
        2,
      ),
    )
    process.exit(violacoes.length === 0 ? EXIT.OK : EXIT.VIOLACAO)
  }
  console.log(renderInventario(inv))
  for (const v of violacoes) console.error(`❌ ${v}`)
  if (violacoes.length === 0) {
    console.log(
      "✅ o inventario confere com o medido: nenhuma dependencia nova do GitHub entrou sem etapa e substituto declarados.",
    )
  }
  process.exit(violacoes.length === 0 ? EXIT.OK : EXIT.VIOLACAO)
}
