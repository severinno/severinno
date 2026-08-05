import Link from "next/link"
import { Search, Home } from "lucide-react"

export default function NotFound() {
  return (
    <div className="from-background via-background to-muted/30 relative flex min-h-screen flex-col bg-gradient-to-b">
      {/* ── Decorative blobs ─────────────────────────────────────────── */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -left-40 size-80 rounded-full bg-emerald-500/5 blur-3xl dark:bg-emerald-400/5" />
        <div className="absolute -right-40 -bottom-40 size-96 rounded-full bg-emerald-500/5 blur-3xl dark:bg-emerald-400/5" />
      </div>

      {/* ── Main content ──────────────────────────────────────────────── */}
      <div className="relative flex flex-1 items-center justify-center px-4">
        <div className="flex w-full max-w-md flex-col items-center text-center">
          {/* Animated icon */}
          <div className="mb-2" style={{ animation: "fadeSlideUp 0.5s both" }}>
            <div className="relative">
              <div className="absolute inset-0 animate-ping rounded-full bg-emerald-500/15 dark:bg-emerald-400/10" />
              <div className="relative flex size-20 items-center justify-center rounded-full bg-gradient-to-br from-emerald-50 to-emerald-100 dark:from-emerald-950/30 dark:to-emerald-900/20">
                <Search className="size-9 text-emerald-500 dark:text-emerald-400" />
              </div>
            </div>
          </div>

          {/* Status code */}
          <div style={{ animation: "fadeSlideUp 0.5s 0.1s both" }}>
            <span className="inline-block rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400">
              404
            </span>
          </div>

          {/* Title */}
          <h1
            className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl"
            style={{ animation: "fadeSlideUp 0.5s 0.15s both" }}
          >
            Página não encontrada
          </h1>

          {/* Description */}
          <p
            className="text-muted-foreground mt-3 max-w-sm"
            style={{ animation: "fadeSlideUp 0.5s 0.2s both" }}
          >
            O conteúdo que você procura não existe ou foi removido. Verifique o link ou busque por
            profissionais na página inicial.
          </p>

          {/* Action buttons */}
          <div
            className="mt-8 flex flex-col items-center gap-3 sm:flex-row"
            style={{ animation: "fadeSlideUp 0.5s 0.25s both" }}
          >
            <Link
              href="/"
              className="inline-flex h-11 items-center gap-2 rounded-xl bg-emerald-600 px-6 text-sm font-medium text-white shadow-lg shadow-emerald-600/20 transition-all hover:bg-emerald-700 hover:shadow-emerald-600/30 active:scale-[0.97]"
            >
              <Home className="size-4" />
              Voltar ao início
            </Link>

            <Link
              href="/busca"
              className="border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground inline-flex h-11 items-center gap-2 rounded-xl border px-5 text-sm font-medium transition-all active:scale-[0.97]"
            >
              <Search className="size-4" />
              Buscar profissionais
            </Link>
          </div>
        </div>
      </div>

      {/* ── Footer ────────────────────────────────────────────────────── */}
      <footer
        className="bg-muted/20 relative border-t px-4 py-6"
        style={{ animation: "fadeIn 0.5s 0.5s both" }}
      >
        <p className="text-muted-foreground/60 text-center text-xs">
          &copy; {new Date().getFullYear()} Severinno. Todos os direitos reservados.
        </p>
      </footer>

      {/* ── Inject keyframes ──────────────────────────────────────────── */}
      <style>{`
        @keyframes fadeSlideUp {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
      `}</style>
    </div>
  )
}
