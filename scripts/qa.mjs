#!/usr/bin/env node
// =============================================================================
// qa.mjs — Unified Quality Assurance Runner for Severinno
// =============================================================================
//
// Usage:
//   node scripts/qa.mjs                 # default: parallel static checks, then unit tests
//   node scripts/qa.mjs --parallel     # run independent checks in parallel
//   node scripts/qa.mjs --sequential   # run all checks sequentially (CI friendly)
//   npm run qa                         # run via npm script
//
// Exit code:
//   0 — all QA checks passed successfully
//   1 — one or more QA checks failed
//   2 — internal error / runner failure
//
// =============================================================================

import { spawn } from "node:child_process"
import { performance } from "node:perf_hooks"

const isSequential = process.argv.includes("--sequential")

const COLORS = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
}

/**
 * Execute a command and return promise with exitCode and output.
 */
function runCommand(name, cmd, args = []) {
  const start = performance.now()
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, {
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, FORCE_COLOR: "1" },
    })

    let stdout = ""
    let stderr = ""

    proc.stdout.on("data", (d) => {
      stdout += d.toString()
    })
    proc.stderr.on("data", (d) => {
      stderr += d.toString()
    })

    proc.on("close", (code) => {
      const elapsed = ((performance.now() - start) / 1000).toFixed(2)
      resolve({
        name,
        code: code ?? 1,
        elapsed,
        stdout,
        stderr,
      })
    })

    proc.on("error", (err) => {
      const elapsed = ((performance.now() - start) / 1000).toFixed(2)
      resolve({
        name,
        code: 1,
        elapsed,
        stdout,
        stderr: err.message,
      })
    })
  })
}

async function main() {
  const totalStart = performance.now()
  console.log(
    `\n${COLORS.bold}${COLORS.cyan}════════════════════════════════════════════════════════════${COLORS.reset}`,
  )
  console.log(
    `${COLORS.bold}${COLORS.cyan}  SEVERINNO QUALITY ASSURANCE (QA) RUNNER${COLORS.reset}`,
  )
  console.log(
    `${COLORS.dim}  Mode: ${isSequential ? "Sequential (CI)" : "Parallel (DX Optimized)"}${COLORS.reset}`,
  )
  console.log(
    `${COLORS.bold}${COLORS.cyan}════════════════════════════════════════════════════════════${COLORS.reset}\n`,
  )

  // Phase 1: Static analysis checks
  const staticChecks = [
    { name: "TypeScript Check", cmd: "bun", args: ["run", "typecheck"] },
    { name: "ESLint", cmd: "bun", args: ["run", "lint"] },
    { name: "Barrel Lint", cmd: "node", args: ["scripts/barrel-lint.mjs"] },
    { name: "Unused Dependencies", cmd: "node", args: ["scripts/check-unused-deps.mjs"] },
  ]

  let staticResults = []

  if (isSequential) {
    for (const check of staticChecks) {
      process.stdout.write(`  [..] Running ${check.name}... `)
      const res = await runCommand(check.name, check.cmd, check.args)
      if (res.code === 0) {
        console.log(
          `${COLORS.green}PASSED${COLORS.reset} ${COLORS.dim}(${res.elapsed}s)${COLORS.reset}`,
        )
      } else {
        console.log(
          `${COLORS.red}FAILED${COLORS.reset} ${COLORS.dim}(${res.elapsed}s)${COLORS.reset}`,
        )
        if (res.stdout) console.log(res.stdout)
        if (res.stderr) console.error(res.stderr)
      }
      staticResults.push(res)
    }
  } else {
    console.log(`  ${COLORS.dim}Running static checks in parallel...${COLORS.reset}`)
    staticResults = await Promise.all(
      staticChecks.map(async (check) => {
        const res = await runCommand(check.name, check.cmd, check.args)
        if (res.code === 0) {
          console.log(
            `  ${COLORS.green}✔${COLORS.reset} ${check.name} ${COLORS.dim}(${res.elapsed}s)${COLORS.reset}`,
          )
        } else {
          console.log(
            `  ${COLORS.red}✖${COLORS.reset} ${check.name} ${COLORS.dim}(${res.elapsed}s)${COLORS.reset}`,
          )
          if (res.stdout) console.log(res.stdout)
          if (res.stderr) console.error(res.stderr)
        }
        return res
      }),
    )
  }

  const staticFailed = staticResults.filter((r) => r.code !== 0)
  if (staticFailed.length > 0) {
    console.log(
      `\n${COLORS.red}${COLORS.bold}✖ Static analysis failed with ${staticFailed.length} error(s).${COLORS.reset}\n`,
    )
    process.exit(1)
  }

  // Phase 2: Unit tests
  console.log(`\n  ${COLORS.dim}Running unit tests suite...${COLORS.reset}`)
  const testRes = await runCommand("Unit Tests", "bun", ["run", "test:unit"])
  if (testRes.code === 0) {
    console.log(
      `  ${COLORS.green}✔${COLORS.reset} Unit Tests ${COLORS.dim}(${testRes.elapsed}s)${COLORS.reset}`,
    )
  } else {
    console.log(
      `  ${COLORS.red}✖${COLORS.reset} Unit Tests ${COLORS.dim}(${testRes.elapsed}s)${COLORS.reset}`,
    )
    if (testRes.stdout) console.log(testRes.stdout)
    if (testRes.stderr) console.error(testRes.stderr)
    console.log(`\n${COLORS.red}${COLORS.bold}✖ Unit tests failed.${COLORS.reset}\n`)
    process.exit(1)
  }

  const totalElapsed = ((performance.now() - totalStart) / 1000).toFixed(2)
  console.log(
    `\n${COLORS.bold}${COLORS.green}✔ All QA checks passed successfully in ${totalElapsed}s!${COLORS.reset}\n`,
  )
  process.exit(0)
}

main().catch((err) => {
  console.error("Fatal runner error:", err)
  process.exit(2)
})
