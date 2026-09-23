import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import { deleteSocialConnection, isSocialProvider } from "@/lib/server/social-connections";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const auth = await requireAdmin(req);
    if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.error === "FORBIDDEN" ? 403 : 401 });
    const body = await req.json().catch(() => ({}));
    if (!isSocialProvider(body?.provider)) return NextResponse.json({ ok: false, error: "INVALID_PROVIDER" }, { status: 400 });
    await deleteSocialConnection(body.provider);
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || "SOCIAL_DISCONNECT_ERROR" }, { status: 500 });
  }
}
