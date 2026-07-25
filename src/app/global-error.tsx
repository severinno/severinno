"use client"

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html>
      <body className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-8 text-center">
        <h1 className="text-2xl font-bold text-foreground">
          Algo deu errado
        </h1>
        <p className="max-w-md text-sm text-muted-foreground">
          Ocorreu um erro inesperado. Tente recarregar a página.
        </p>
        <button
          type="button"
          onClick={() => reset()}
          className="inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          Tentar novamente
        </button>
      </body>
    </html>
  )
}
