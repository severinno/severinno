/**
 * remedy-classes/bun-mirror-removal.mjs
 *
 * A DECLARAÇÃO da classe `bun-mirror-removal` do remédio do pre-commit — o que o
 * guard DONO (`scripts/check-bun-mirror.mjs`) sabe consertar.
 *
 * POR QUE ESTA CLASSE: o recorte `--staged` do guard já RECUSA o commit que apaga
 * uma declaração de espelho da versão — o arg `BUN_VERSION` de um build site de
 * compose (invariante 18(b)) e o `"packageManager"` do `package.json` (18(c)) — e
 * a recusa, sozinha, transfere ao operador um remendo MECÂNICO: a linha apagada
 * está inteira no commit anterior, e restaurá-la não é uma decisão. A CLASSE
 * oferece esse remendo no momento do defeito, como as demais.
 *
 * A RÉGUA NÃO MORA AQUI: o `fixRemovedMirrors` é IMPORTADO do guard dono. A
 * classe declara COMO ACHAR o defeito (o mesmo recorte ÍNDICE×HEAD que o veredito
 * usa, em modo preview) e o que fazer com o resultado — jamais uma segunda régua,
 * que divergiria da diagnose no dia em que uma das duas mudasse.
 *
 * O QUE ELA **NÃO** REMENDA, em duas classes distintas de caso:
 *
 *   · a DIVERGÊNCIA — a linha que APENAS TROCA o valor (o `packageManager` que
 *     passou a declarar outra versão, o arg que aponta para outra variável). Ela
 *     não ENTRA nesta classe (`violacoes` 0, medido): restaurar o valor do HEAD
 *     ali esconderia a intenção de quem escreveu o novo, e um remendo que adivinha
 *     intenção é a classe que este repositório persegue. Quem a nomeia é o veredito
 *     do PRÓPRIO guard dono (`--staged`), com o valor novo no relatório — outro
 *     defeito, outro remédio (aqui não há remendo, e não há o que oferecer);
 *   · a declaração que PERDEU A ÂNCORA ou o ponto de restauração (a linha não
 *     existe no commit anterior, a âncora aparece mais de uma vez na árvore) — esta
 *     SIM é do escopo da classe e sai em `refused`, virada em `semRemendo`: o
 *     commit continua bloqueado, sem pergunta, com o motivo por arquivo.
 */

import { fixRemovedMirrors } from "../check-bun-mirror.mjs"

export default {
  id: "bun-mirror-removal",
  ordem: 70,
  // O guard dono: a régua vem dele, importada (por isso ele não é spawnado).
  script: "check-bun-mirror.mjs",
  label: "declaração de espelho APAGADA (arg `BUN_VERSION` do build site / `packageManager`)",
  verde: "a declaração apagada voltou e o recorte `--staged` do guard dono voltou a passar",
  vermelho: "o recorte `--staged` CONTINUA vermelho (a declaração não voltou)",
  estagio: "add",
  fixer: "node scripts/check-bun-mirror.mjs --fix",
  sugere: (paths) => [
    "node scripts/check-bun-mirror.mjs --fix   # restaura da HEAD — REVISE o diff",
    "node scripts/check-bun-mirror.mjs --fix --dry-run   # só o preview, sem gravar",
    `git add ${paths.join(" ")}`,
  ],
  aplicavel: () => null,
  detectar(root) {
    const preview = fixRemovedMirrors(root, { dry: true })
    if (preview.indisponivel) return { indisponivel: preview.indisponivel }
    if (preview.unreadable.length > 0) {
      return {
        indisponivel:
          "arquivo(s) ILEGÍVEL(is) — não ler não é o mesmo que estar válido:\n" +
          preview.unreadable.map((f) => `     ${f}`).join("\n"),
      }
    }
    const linhas = []
    const offenders = []
    for (const item of preview.fixed) {
      offenders.push(item.file)
      const pais = item.linhas.slice(0, -1)
      linhas.push(
        `   ${item.file}${item.lineNo ? `:${item.lineNo}` : ""} — ${item.classe}: a declaração apagada ` +
          `\`${(item.declaracao ?? item.linhas[0]).trim()}\` voltaria abaixo de \`${item.ancora.trim()}\`` +
          (pais.length > 0
            ? ` (com a(s) chave(s)-pai que o commit apagou junto: ${pais
                .map((l) => `\`${l.trim()}\``)
                .join(", ")})`
            : ""),
      )
    }
    for (const item of preview.refused) {
      linhas.push(`   ⛔ ${item.file} — NÃO remendável: ${item.reason}`)
    }
    const violacoes = preview.fixed.length + preview.refused.length
    return {
      offenders: [...new Set(offenders)],
      relatorio: linhas.length > 0 ? linhas.join("\n") : "",
      detalhe: preview,
      recusas: preview.refused,
      violacoes,
      semRemendo:
        violacoes > 0 && preview.fixed.length === 0
          ? "⛔ a declaração que este remendo restaura é a que foi APAGADA (o arg do build site, o\n" +
            "   `packageManager`) — o que ele NÃO remenda é a linha que só TROCA o valor (divergência),\n" +
            "   nem a que perdeu a âncora. Conserte à mão:\n" +
            linhas.join("\n")
          : null,
    }
  },
  aplicar(root) {
    const aplicado = fixRemovedMirrors(root)
    const linhas = aplicado.fixed.map(
      (item) =>
        `✔ ${item.file}${item.lineNo ? `:${item.lineNo}` : ""} — declaração restaurada do commit ` +
        `anterior (${item.classe}): ${item.linhas.map((l) => `\`${l.trim()}\``).join(", ")}\n` +
        `     âncora: ${item.ancora}`,
    )
    return { relatorio: linhas.join("\n"), detalhe: aplicado }
  },
}
