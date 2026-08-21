import { existsSync } from "node:fs"
import { spawnSync, type SpawnSyncOptions, type SpawnSyncReturns } from "node:child_process"

/**
 * Resolve o binário `bash` para spawns de scripts .sh em testes.
 *
 * No Windows o `bash` do PATH pode resolver para o WSL (saída UTF-16, exit 1
 * sempre, ~30s de timeout por spawn). O husky roda com o Git Bash no PATH; o
 * vitest solto não. Prefere o bash do Git for Windows quando presente.
 */
export function resolveBash(): string {
  if (process.platform === "win32") {
    const gitBash = "C:\\Program Files\\Git\\bin\\bash.exe"
    if (existsSync(gitBash)) return gitBash
  }
  return "bash"
}

let _pyCommand: string | null = null

export function resolvePython(): { cmd: string; isNodeFallback?: boolean } {
  if (_pyCommand) return { cmd: _pyCommand }
  try {
    const res = spawnSync("python3", ["-c", "import sys"], { encoding: "utf8" })
    if (res.status === 0) {
      _pyCommand = "python3"
      return { cmd: "python3" }
    }
  } catch {
    // ignore
  }
  try {
    const res = spawnSync("python", ["-c", "import sys"], { encoding: "utf8" })
    if (
      res.status === 0 &&
      !res.stdout?.includes("Microsoft Store") &&
      !res.stderr?.includes("Microsoft Store")
    ) {
      _pyCommand = "python"
      return { cmd: "python" }
    }
  } catch {
    // ignore
  }
  return { cmd: "node", isNodeFallback: true }
}

export function spawnDetector(
  pyScriptPath: string,
  args: string[],
  opts: SpawnSyncOptions = {},
): SpawnSyncReturns<string> {
  const py = resolvePython()
  if (py.isNodeFallback) {
    const mjsPath = pyScriptPath.replace(/\.py$/, ".mjs")
    if (existsSync(mjsPath)) {
      return spawnSync("node", [mjsPath, ...args], {
        encoding: "utf8",
        ...opts,
      }) as SpawnSyncReturns<string>
    }
  }
  return spawnSync(py.cmd, [pyScriptPath, ...args], {
    encoding: "utf8",
    ...opts,
  }) as SpawnSyncReturns<string>
}
