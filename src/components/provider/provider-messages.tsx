"use client"

import * as React from "react"
import { MessagesView } from "@/components/shared/messages-view"
import { useViewStore } from "@/store/view"

/**
 * Provider messages — wraps the shared MessagesView with the initial peer
 * coming from view params (e.g. when navigating from a booking detail).
 */
export function ProviderMessages() {
  const params = useViewStore((s) => s.params)
  const peerId = typeof params?.peerId === "string" ? (params.peerId as string) : undefined

  return (
    <MessagesView
      initialPeerId={peerId}
      emptyTitle="Conversas com clientes"
      emptyDescription="Troque mensagens com seus clientes em tempo real, tire dúvidas e combine detalhes do serviço."
    />
  )
}

export default ProviderMessages
