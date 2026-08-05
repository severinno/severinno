"use client"

import * as Sentry from "@sentry/nextjs"
import { useEffect } from "react"

/**
 * Global error boundary — wraps the entire app including <html>.
 *
 * This component must render its own <html> and <body> tags because the
 * root layout may have crashed. Tailwind classes may NOT be available at
 * this level, so all styling is done via a self-contained <style> tag.
 */

const styles = `
  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
      "Helvetica Neue", Arial, sans-serif;
    background: #fafafa;
    color: #1a1a2e;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1.5rem;
  }

  .container {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    max-width: 420px;
    width: 100%;
  }

  .icon-wrap {
    position: relative;
    margin-bottom: 0.5rem;
  }

  .icon-ring {
    position: absolute;
    inset: 0;
    border-radius: 9999px;
    background: rgba(239, 68, 68, 0.1);
    animation: ping 2s cubic-bezier(0, 0, 0.2, 1) infinite;
  }

  @keyframes ping {
    75%, 100% { transform: scale(1.5); opacity: 0; }
  }

  .icon-circle {
    position: relative;
    width: 72px;
    height: 72px;
    border-radius: 9999px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(135deg, #fef2f2, #fee2e2);
    margin: 0 auto;
  }

  .icon-svg {
    width: 32px;
    height: 32px;
    color: #ef4444;
  }

  .badge {
    display: inline-block;
    background: #fef2f2;
    color: #dc2626;
    font-size: 0.7rem;
    font-weight: 600;
    padding: 0.2rem 0.7rem;
    border-radius: 9999px;
    margin-top: 0.5rem;
  }

  h1 {
    font-size: 1.75rem;
    font-weight: 700;
    letter-spacing: -0.025em;
    margin-top: 1rem;
    color: #1a1a2e;
  }

  @media (min-width: 640px) {
    h1 { font-size: 2rem; }
  }

  p {
    margin-top: 0.75rem;
    font-size: 0.875rem;
    line-height: 1.6;
    color: #64748b;
  }

  .actions {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    margin-top: 2rem;
    width: 100%;
    align-items: center;
  }

  @media (min-width: 640px) {
    .actions { flex-direction: row; justify-content: center; }
  }

  .btn-primary {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    height: 2.75rem;
    padding: 0 1.5rem;
    border-radius: 0.75rem;
    border: none;
    background: #059669;
    color: white;
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    box-shadow: 0 4px 12px rgba(5, 150, 105, 0.2);
    transition: all 0.2s;
  }

  .btn-primary:hover {
    background: #047857;
    box-shadow: 0 6px 16px rgba(5, 150, 105, 0.3);
  }

  .btn-primary:active {
    transform: scale(0.97);
  }

  .btn-secondary {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    height: 2.75rem;
    padding: 0 1.5rem;
    border-radius: 0.75rem;
    border: 1px solid #e2e8f0;
    background: white;
    color: #64748b;
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    text-decoration: none;
    transition: all 0.2s;
  }

  .btn-secondary:hover {
    background: #f8fafc;
    color: #1a1a2e;
  }

  .btn-secondary:active {
    transform: scale(0.97);
  }

  .footer {
    margin-top: 3rem;
    font-size: 0.75rem;
    color: #94a3b8;
  }
`

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return (
    <html>
      <head>
        <meta charSet="utf-8" />
        <title>Severinno — Erro interno</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body>
        <style>{styles}</style>

        <div className="container">
          {/* Animated icon */}
          <div className="icon-wrap">
            <div className="icon-ring" />
            <div className="icon-circle">
              <svg
                className="icon-svg"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
                />
              </svg>
            </div>
          </div>

          <span className="badge">500</span>

          <h1>Erro interno</h1>
          <p>
            Ocorreu um erro inesperado. Nossa equipe já foi notificada e está trabalhando na
            correção.
          </p>

          <div className="actions">
            <button className="btn-primary" onClick={() => reset()}>
              <svg
                width="16"
                height="16"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182"
                />
              </svg>
              Tentar novamente
            </button>
          </div>

          {error.digest && (
            <p className="footer">
              Ref: {error.digest} &mdash; {new Date().getFullYear()} Severinno
            </p>
          )}

          {!error.digest && <p className="footer">&copy; {new Date().getFullYear()} Severinno</p>}
        </div>
      </body>
    </html>
  )
}
