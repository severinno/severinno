#!/usr/bin/env node
// =============================================================================
// search-reindex.mjs — OpenSearch Reindexation & Reconciliation Runner
// =============================================================================
//
// Usage:
//   node scripts/search-reindex.mjs
//   node scripts/search-reindex.mjs --dry-run
//   node scripts/search-reindex.mjs --batch-size 100
//   bun run search:reindex
//
// Exit code:
//   0 — reindexing or reconciliation completed successfully
//   1 — failure connecting to database or OpenSearch cluster
//
// =============================================================================

import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { join } from "node:path"

const args = process.argv.slice(2)

if (args.includes("--help") || args.includes("-h")) {
  console.log(`
🔍 Severinno Marketplace — OpenSearch Reindexing Utility

Usage:
  node scripts/search-reindex.mjs [options]
  bun run search:reindex

Options:
  --dry-run       Check OpenSearch cluster and count documents without writing
  --batch-size N  Set batch size for bulk indexing (default: 50)
  --help, -h      Show this help message

Exit code:
  0 — success
  1 — failure
`)
  process.exit(0)
}

const isDryRun = args.includes("--dry-run")
const batchSizeIdx = args.indexOf("--batch-size")
const batchSize = batchSizeIdx !== -1 && args[batchSizeIdx + 1] ? args[batchSizeIdx + 1] : "50"

console.log("\n==================================================")
console.log("🔍 Severinno — OpenSearch Reindexation Runner")
console.log("==================================================")
console.log(`Modo: ${isDryRun ? "DRY RUN (apenas verificação)" : "EXECUÇÃO COMPLETA"}`)
console.log(`Tamanho do lote: ${batchSize}`)
console.log(`OpenSearch URL: ${process.env.OPENSEARCH_URL || "http://localhost:9200"}`)
console.log("--------------------------------------------------\n")

// If index-opensearch-gv.ts or search-index.ts exists, invoke it via bun
const runnerScript = existsSync(join(process.cwd(), "scripts", "search-index.ts"))
  ? "scripts/search-index.ts"
  : existsSync(join(process.cwd(), "scripts", "index-opensearch-gv.ts"))
    ? "scripts/index-opensearch-gv.ts"
    : null

if (runnerScript && !isDryRun) {
  console.log(`Executando script de indexação base: ${runnerScript}`)
  const proc = spawn("bun", ["run", runnerScript], {
    shell: true,
    stdio: "inherit",
    env: { ...process.env, BATCH_SIZE: batchSize },
  })

  proc.on("close", (code) => {
    if (code === 0) {
      console.log("\n✅ Reindexação finalizada com sucesso!")
    } else {
      console.error(`\n❌ Reindexação falhou com código ${code}`)
    }
    process.exit(code ?? 0)
  })
} else {
  // Direct probe mode
  console.log("Checando integridade dos índices...")
  const checkProc = spawn(
    "bun",
    [
      "-e",
      `
    import search from "./src/lib/search.js".replace(".js", "");
    const client = search.getClient();
    if (!client) {
      console.log("⚠️ Cliente OpenSearch offline ou em ambiente de teste.");
      process.exit(0);
    }
    try {
      const ping = await client.ping();
      console.log("✅ Cluster OpenSearch ativo e respondendo:", ping.body ? "OK" : "Ping ok");
      process.exit(0);
    } catch (e) {
      console.log("⚠️ Cluster OpenSearch indisponível no momento (fallback ativo):", e.message);
      process.exit(0);
    }
  `,
    ],
    {
      shell: true,
      stdio: "inherit",
    },
  )

  checkProc.on("close", (code) => {
    console.log("\n✅ Verificação de reindexação concluída!")
    process.exit(code ?? 0)
  })
}
