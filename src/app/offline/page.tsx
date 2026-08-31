export default function OfflinePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 text-center">
      <div className="mb-4 rounded-full bg-amber-100 p-4 dark:bg-amber-900/30">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="48"
          height="48"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-amber-600 dark:text-amber-400"
        >
          <path d="M2 12 7 2" />
          <path d="m2 12 5 10" />
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10" />
          <path d="M2 12h20" />
        </svg>
      </div>
      <h1 className="mb-2 text-2xl font-bold">Sem conexão</h1>
      <p className="text-muted-foreground mb-6 max-w-sm">
        Você está offline. Verifique sua conexão com a internet e tente novamente.
      </p>
      <button
        onClick={() => window.location.reload()}
        className="rounded-xl bg-emerald-600 px-6 py-3 text-sm font-medium text-white shadow-lg transition hover:bg-emerald-700 active:scale-[0.97]"
      >
        Tentar novamente
      </button>
    </div>
  )
}
