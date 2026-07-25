import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { providerProfileSchema } from "@/lib/validators";
import { forbidden, handleError, USER_PUBLIC_SELECT } from "@/lib/api-server";

// GET: current authenticated user (full public profile)
export async function GET() {
  try {
    const session = await requireUser();
    const user = await db.user.findUnique({
      where: { id: session.userId },
      select: USER_PUBLIC_SELECT,
    });
    if (!user) {
      return NextResponse.json({ user: null }, { status: 404 });
    }
    return NextResponse.json({ user });
  } catch (e) {
    return handleError(e);
  }
}

// PATCH: update own profile (name, bio, contact, address, geoloc, avatarUrl, coverUrl, radiusKm)
export async function PATCH(request: Request) {
  try {
    const session = await requireUser();
    const body = await request.json();
    const data = providerProfileSchema.parse(body);

    // Only the owner can edit their own profile.
    const existing = await db.user.findUnique({
      where: { id: session.userId },
      select: { id: true, role: true },
    });
    if (!existing) throw forbidden("Usuário não encontrado");

    const updated = await db.user.update({
      where: { id: session.userId },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.bio !== undefined ? { bio: data.bio || null } : {}),
        ...(data.whatsapp !== undefined ? { whatsapp: data.whatsapp || null } : {}),
        ...(data.phone !== undefined ? { phone: data.phone || null } : {}),
        ...(data.avatarUrl !== undefined ? { avatarUrl: data.avatarUrl || null } : {}),
        ...(data.coverUrl !== undefined ? { coverUrl: data.coverUrl || null } : {}),
        ...(data.cep !== undefined ? { cep: data.cep || null } : {}),
        ...(data.street !== undefined ? { street: data.street || null } : {}),
        ...(data.number !== undefined ? { number: data.number || null } : {}),
        ...(data.complement !== undefined ? { complement: data.complement || null } : {}),
        ...(data.district !== undefined ? { district: data.district || null } : {}),
        ...(data.city !== undefined ? { city: data.city || null } : {}),
        ...(data.state !== undefined ? { state: data.state || null } : {}),
        ...(data.lat !== undefined ? { lat: data.lat } : {}),
        ...(data.lng !== undefined ? { lng: data.lng } : {}),
        ...(data.radiusKm !== undefined ? { radiusKm: data.radiusKm } : {}),
      },
      select: USER_PUBLIC_SELECT,
    });

    return NextResponse.json({ user: updated });
  } catch (e) {
    return handleError(e);
  }
}
