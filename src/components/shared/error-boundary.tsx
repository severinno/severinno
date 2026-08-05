"use client"

/**
 * ErrorBoundary — catches JavaScript errors in its child component tree
 * and renders a friendly fallback UI instead of crashing the whole page.
 *
 * Usage:
 *   <ErrorBoundary>
 *     <ProviderPanel />
 *   </ErrorBoundary>
 *
 * By default it renders a card with the error message and a "Tentar novamente"
 * button.  You can override the fallback via the `fallback` prop.
 */

import * as React from "react"
import { AlertTriangle, RefreshCw, Home } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card"
import { useViewStore } from "@/store/view"

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

type ErrorBoundaryProps = {
  children: React.ReactNode
  /** Optional custom fallback renderer. Receives the error + reset function. */
  fallback?: (props: { error: Error; reset: () => void }) => React.ReactNode
  /** Label shown in the fallback UI header, e.g. "Painel do Prestador" */
  label?: string
  /** Optional onError callback for logging / Sentry */
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void
}

type ErrorBoundaryState = {
  error: Error | null
}

// ---------------------------------------------------------------------------
// Component (class-based — required for componentDidCatch)
// ---------------------------------------------------------------------------

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    // Log to console in dev
    if (process.env.NODE_ENV === "development") {
      console.error("[ErrorBoundary]", error.message, errorInfo.componentStack)
    }
    // Forward to optional callback (Sentry, etc.)
    this.props.onError?.(error, errorInfo)
  }

  private handleReset = (): void => {
    this.setState({ error: null })
  }

  render(): React.ReactNode {
    if (this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback({
          error: this.state.error,
          reset: this.handleReset,
        })
      }
      return (
        <DefaultFallback
          error={this.state.error}
          reset={this.handleReset}
          label={this.props.label}
        />
      )
    }
    return this.props.children
  }
}

// ---------------------------------------------------------------------------
// Default fallback UI
// ---------------------------------------------------------------------------

function DefaultFallback({
  error,
  reset,
  label,
}: {
  error: Error
  reset: () => void
  label?: string
}) {
  const navigate = useViewStore((s) => s.navigate)

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <Card className="border-destructive/20 mx-auto w-full max-w-md shadow-lg">
        <CardHeader className="text-center">
          <div className="bg-destructive/10 mx-auto mb-3 flex size-14 items-center justify-center rounded-full">
            <AlertTriangle className="text-destructive size-7" />
          </div>
          <CardTitle className="text-lg">
            {label ? `Erro no ${label}` : "Algo deu errado"}
          </CardTitle>
          <CardDescription className="text-sm">
            Ocorreu um erro inesperado. Você pode tentar novamente ou voltar para a página inicial.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {process.env.NODE_ENV === "development" && error.message ? (
            <details className="group bg-muted/50 rounded-lg border p-3">
              <summary className="text-muted-foreground group-open:text-foreground cursor-pointer text-xs font-medium">
                Detalhes do erro
              </summary>
              <pre className="text-muted-foreground mt-2 overflow-x-auto text-xs whitespace-pre-wrap">
                {error.message}
                {"\n"}
                {error.stack?.split("\n").slice(0, 6).join("\n")}
              </pre>
            </details>
          ) : null}
        </CardContent>
        <CardFooter className="flex justify-center gap-3 border-t pt-4">
          <Button variant="outline" onClick={() => navigate("vitrine")}>
            <Home className="mr-1.5 size-4" />
            Início
          </Button>
          <Button onClick={reset}>
            <RefreshCw className="mr-1.5 size-4" />
            Tentar novamente
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}

export default ErrorBoundary
