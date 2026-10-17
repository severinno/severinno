"use client"

import * as React from "react"
import { MessagesView } from "@/components/shared/messages-view"
import { useViewStore } from "@/store/view"

/**
 * ClientMessages — wraps the shared MessagesView with the initial peer
 * coming from view params (e.g. when navigating from a provider profile or booking).
 */
export function ClientMessages() {
  const params = useViewStore((s) => s.params) as { with?: string; peerId?: string } | undefined
  const peerId =
    typeof params?.with === "string"
      ? params.with
      : typeof params?.peerId === "string"
        ? params.peerId
        : undefined

  return (
    <MessagesView
      initialPeerId={peerId}
      emptyTitle="Conversas com prestadores"
      emptyDescription="Tire dúvidas, aprove orçamentos com Custódia PIX e combine detalhes dos seus atendimentos."
    />
  )
}

export default ClientMessages
