/**
 * Offline Page — shown when user has no internet connection
 *
 * Displays cached provider data and allows browsing offline-cached content.
 */
"use client"

import { useEffect, useState } from "react"
import { WifiOff, RefreshCw, Home } from "lucide-react"
import Link from "next/link"

export default function OfflinePage() {
  const [isOnline, setIsOnline] = useState(false)

  useEffect(() => {
    setIsOnline(navigator.onLine)

    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)

    window.addEventListener("online", handleOnline)
    window.addEventListener("offline", handleOffline)
    return () => {
      window.removeEventListener("online", handleOnline)
      window.removeEventListener("offline", handleOffline)
    }
  }, [])

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4 text-center dark:bg-gray-900">
      <div className="rounded-2xl bg-white p-8 shadow-lg dark:bg-gray-800">
        <WifiOff className="mx-auto mb-4 h-16 w-16 text-orange-500" />
        <h1 className="mb-2 text-2xl font-bold text-gray-900 dark:text-white">
          Sem conexão
        </h1>
        <p className="mb-6 text-gray-600 dark:text-gray-400">
          Você está offline. Verifique sua conexão com a internet.
        </p>

        {isOnline ? (
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-3 text-white hover:bg-blue-700"
          >
            <Home className="h-4 w-4" />
            Voltar ao início
          </Link>
        ) : (
          <button
            onClick={() => window.location.reload()}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-3 text-white hover:bg-blue-700"
          >
            <RefreshCw className="h-4 w-4" />
            Tentar novamente
          </button>
        )}

        <p className="mt-4 text-sm text-gray-500 dark:text-gray-500">
          Dados em cache podem estar disponíveis offline.
        </p>
      </div>
    </div>
  )
}
