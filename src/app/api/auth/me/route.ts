import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getOptionalSession } from "@/lib/auth";
import { handleError, USER_PUBLIC_SELECT } from "@/lib/api-server";

export async function GET() {
  try {
    const session = await getOptionalSession();
    if (!session) {
      return NextResponse.json({ user: null });
    }
    const user = await db.user.findUnique({
      where: { id: session.userId },
      select: USER_PUBLIC_SELECT,
    });
    if (!user) {
      return NextResponse.json({ user: null });
    }
    return NextResponse.json({ user });
  } catch (e) {
    return handleError(e);
  }
}
