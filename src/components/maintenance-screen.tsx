import { Wrench } from "lucide-react"

/**
 * MaintenanceScreen — a página que o público vê com a chave LIGADA.
 *
 * Renderizada PELO LAYOUT RAIZ no lugar de `children` (sem redirect, sem
 * rewrite, sem exceção de rota — quem não é ADMIN vê isto em QUALQUER página).
 * Server component puro: zero JS, zero chamadas, funciona com o app "meio
 * quebrado" — é exatamente o estado que ela existe para comunicar.
 *
 * React 19 eleva o <meta> de robots ao <head>: a página não indexa durante a
 * manutenção (o conteúdo real não está aqui).
 */
export function MaintenanceScreen() {
  return (
    <div className="bg-background flex min-h-[100dvh] flex-col items-center justify-center px-4 text-center">
      <meta name="robots" content="noindex, nofollow" />
      <div className="mb-6 rounded-full bg-amber-100 p-5 dark:bg-amber-900/30">
        <Wrench
          aria-hidden="true"
          className="size-12 text-amber-600 dark:text-amber-400"
          strokeWidth={1.75}
        />
      </div>
      <p className="text-muted-foreground mb-2 text-sm font-medium tracking-widest uppercase">
        Severinno
      </p>
      <h1 className="mb-3 text-3xl font-bold tracking-tight sm:text-4xl">Manutenção preventiva</h1>
      <p className="text-muted-foreground max-w-md text-balance">
        Estamos aprimorando a plataforma para melhor atender você.{" "}
        <strong className="text-foreground">Em breve estaremos online</strong> — volte em instantes.
      </p>
    </div>
  )
}
