"use client"

/**
 * Ponte client-only para o mapa de tracking.
 *
 * Por que este arquivo existe: o Next 16 rejeita `next/dynamic` com
 * `{ ssr: false }` declarado em Server Component —
 *
 *   Error: `ssr: false` is not allowed with `next/dynamic` in Server Components.
 *   Please move it into a Client Component.
 *
 * A página (`page.tsx`) precisa continuar sendo Server Component: ela faz a
 * query do agendamento e o `generateMetadata` (SEO) e serializa as datas antes
 * de entregar ao cliente. O mapa, por outro lado, precisa mesmo ser client-only
 * (não deve ser renderizado no servidor). Este wrapper é a ponte entre os dois:
 * aqui dentro o módulo é client, então `ssr: false` é legítimo.
 *
 * ⚠️ Não mova o `dynamic(...)` de volta para `page.tsx` nem apague o
 * `{ ssr: false }`: sem ele o componente passa a ser SSR'd (o mapa depende de
 * `window`), e no lugar errado ele quebra o `next build` inteiro — foi o que
 * aconteceu no commit ad38d1cc.
 */

import type { ComponentProps } from "react"
import dynamic from "next/dynamic"

const TrackingPageClient = dynamic(
  () => import("./tracking-page-client").then((m) => ({ default: m.TrackingPageClient })),
  { ssr: false },
)

type TrackingPageProps = ComponentProps<typeof TrackingPageClient>

export function TrackingPageLoader(props: TrackingPageProps) {
  return <TrackingPageClient {...props} />
}
