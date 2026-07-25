import { NextResponse } from "next/server";
import { destroySession } from "@/lib/auth";
import { handleError } from "@/lib/api-server";

export async function POST() {
  try {
    await destroySession();
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
