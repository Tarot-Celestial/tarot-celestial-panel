import { NextResponse } from "next/server";
import { clientFromRequest } from "@/lib/server/auth-cliente";
export const runtime = "nodejs";

// New registrations verify ownership first. A phone number alone never resets a password.
export async function POST(req: Request) {
  try {
    const gate = await clientFromRequest(req);
    if (!gate.uid || !gate.cliente || !gate.admin) return NextResponse.json({ ok: false, error: "VERIFIED_ACCESS_REQUIRED" }, { status: 401 });
    const body = await req.json();
    const password = String(body?.password || "");
    if (password.length < 8 || password.length > 128) return NextResponse.json({ ok: false, error: "REGISTRATION_PASSWORD_TOO_SHORT" }, { status: 400 });
    if (password !== body?.password_confirm) return NextResponse.json({ ok: false, error: "PASSWORDS_DO_NOT_MATCH" }, { status: 400 });
    const changed = await gate.admin.auth.admin.updateUserById(gate.uid, { password });
    if (changed.error) throw changed.error;
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: "PASSWORD_CHANGE_UNAVAILABLE" }, { status: 503 });
  }
}
