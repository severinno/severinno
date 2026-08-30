/**
 * Offline Page — shown when user has no internet connection
 *
 * Displays cached provider data and allows browsing offline-cached content.
 */
"use client"

import { useSyncExternalStore } from "react"
import { WifiOff, RefreshCw, Home } from "lucide-react"
import Link from "next/link"

function subscribe(callback: () => void) {
  window.addEventListener("online", callback)
  window.addEventListener("offline", callback)
  return () => {
    window.removeEventListener("online", callback)
    window.removeEventListener("offline", callback)
  }
}

function getSnapshot() {
  return navigator.onLine
}

export default function OfflinePage() {
  const isOnline = useSyncExternalStore(subscribe, getSnapshot, () => true)

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4 text-center dark:bg-gray-900">
      <div className="mx-auto max-w-md">
        <WifiOff className="mx-auto mb-6 h-16 w-16 text-gray-400" />

        <h1 className="mb-2 text-2xl font-bold text-gray-900 dark:text-white">
          Você está offline
        </h1>

        <p className="mb-8 text-gray-600 dark:text-gray-400">
          Verifique sua conexão com a internet e tente novamente.
        </p>

        {!isOnline && (
          <p className="mb-4 text-sm text-amber-600 dark:text-amber-400">
            ⚡ Você pode navegar conteúdo salvo enquanto offline.
          </p>
        )}

        <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
          <button
            onClick={() => window.location.reload()}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-blue-700"
          >
            <RefreshCw className="h-4 w-4" />
            Tentar novamente
          </button>

          <Link
            href="/"
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-6 py-3 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            <Home className="h-4 w-4" />
            Voltar ao início
          </Link>
        </div>
      </div>
    </div>
  )
}
