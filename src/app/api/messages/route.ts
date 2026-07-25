import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { messageSchema } from "@/lib/validators";
import { badRequest, handleError, notFound } from "@/lib/api-server";

// Authenticated: list messages
// - If `with` is provided → return conversation between current user and that user
// - Otherwise → return list of conversations (last message per peer)
export async function GET(request: Request) {
  try {
    const session = await requireUser();
    const { searchParams } = new URL(request.url);
    const withUserId = searchParams.get("with") || undefined;

    if (withUserId) {
      // Validate peer exists
      const peer = await db.user.findUnique({
        where: { id: withUserId },
        select: {
          id: true,
          name: true,
          avatarUrl: true,
          role: true,
        },
      });
      if (!peer) throw notFound("Usuário não encontrado");

      const messages = await db.message.findMany({
        where: {
          OR: [
            { fromId: session.userId, toId: withUserId },
            { fromId: withUserId, toId: session.userId },
          ],
        },
        orderBy: { createdAt: "asc" },
      });

      // Mark unread inbound messages as read
      await db.message.updateMany({
        where: { fromId: withUserId, toId: session.userId, read: false },
        data: { read: true },
      });

      return NextResponse.json({ peer, items: messages });
    }

    // Conversations list — fetch all peers the user exchanged messages with.
    // Group by peer and pick the most recent message.
    const sent = await db.message.findMany({
      where: { fromId: session.userId },
      select: { toId: true, createdAt: true, content: true, read: true },
      orderBy: { createdAt: "desc" },
    });
    const received = await db.message.findMany({
      where: { toId: session.userId },
      select: { fromId: true, createdAt: true, content: true, read: true },
      orderBy: { createdAt: "desc" },
    });

    const byPeer = new Map<
      string,
      {
        peerId: string;
        lastMessage: string;
        lastAt: Date;
        unreadCount: number;
      }
    >();

    // unread count (received & unread)
    const unreadByPeer = new Map<string, number>();
    for (const m of received) {
      if (!m.read) {
        unreadByPeer.set(m.fromId, (unreadByPeer.get(m.fromId) ?? 0) + 1);
      }
    }

    const consider = (peerId: string, content: string, createdAt: Date) => {
      const existing = byPeer.get(peerId);
      if (!existing || existing.lastAt < createdAt) {
        byPeer.set(peerId, {
          peerId,
          lastMessage: content,
          lastAt: createdAt,
          unreadCount: unreadByPeer.get(peerId) ?? 0,
        });
      } else {
        existing.unreadCount = unreadByPeer.get(peerId) ?? existing.unreadCount;
      }
    };

    for (const m of sent) consider(m.toId, m.content, m.createdAt);
    for (const m of received) consider(m.fromId, m.content, m.createdAt);

    const peerIds = Array.from(byPeer.keys());
    const peers = await db.user.findMany({
      where: { id: { in: peerIds } },
      select: { id: true, name: true, avatarUrl: true, role: true },
    });

    const items = Array.from(byPeer.values())
      .sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime())
      .map((c) => ({
        ...c,
        peer: peers.find((p) => p.id === c.peerId) ?? null,
      }));

    return NextResponse.json({ items });
  } catch (e) {
    return handleError(e);
  }
}

// Authenticated: send a message
export async function POST(request: Request) {
  try {
    const session = await requireUser();
    const body = await request.json();
    const data = messageSchema.parse(body);

    if (data.toId === session.userId) {
      throw badRequest("Você não pode enviar mensagens para si mesmo");
    }
    const recipient = await db.user.findUnique({
      where: { id: data.toId },
      select: { id: true, active: true },
    });
    if (!recipient || !recipient.active) {
      throw notFound("Destinatário não encontrado");
    }

    const message = await db.message.create({
      data: {
        fromId: session.userId,
        toId: data.toId,
        content: data.content,
        bookingId: data.bookingId || null,
        read: false,
      },
    });

    // Best-effort in-app notification to recipient
    await db.notification
      .create({
        data: {
          userId: data.toId,
          type: "MESSAGE",
          title: "Nova mensagem",
          body: data.content.length > 80 ? data.content.slice(0, 80) + "…" : data.content,
          read: false,
        },
      })
      .catch(() => {
        /* ignore notification errors */
      });

    return NextResponse.json({ message }, { status: 201 });
  } catch (e) {
    return handleError(e);
  }
}
