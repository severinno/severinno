import { existsSync } from "node:fs"

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
