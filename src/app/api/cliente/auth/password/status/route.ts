import { NextRequest, NextResponse } from "next/server";
import { adminSupabase } from "@/lib/server/cliente-auth-password";
import { getAuthUserFromRequest } from "@/lib/server/auth-fast";

export async function GET(req: NextRequest) {
  try {
    const sb = adminSupabase();

    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }

    const token = authHeader.replace("Bearer ", "");

    const {
      data: { user },
      error,
    } = getAuthUserFromRequest(req);

    if (error || !user) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }

    const hasPassword = !!user.email; // si tiene email → tiene password en tu sistema

    return NextResponse.json({
      ok: true,
      hasPassword,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message },
      { status: 500 }
    );
  }
}
