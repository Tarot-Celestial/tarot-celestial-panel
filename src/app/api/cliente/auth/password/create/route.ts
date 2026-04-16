import { NextRequest, NextResponse } from "next/server";
import {
  adminSupabase,
  ensureClienteAuthUser,
  digitsOnly,
} from "@/lib/server/cliente-auth-password";

export const runtime = "nodejs";

function isStrongPassword(password: string) {
  return typeof password === "string" && password.trim().length >= 6;
}

export async function POST(req: NextRequest) {
  try {
    const sb = adminSupabase();

    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return NextResponse.json(result);
    }

    const token = authHeader.replace("Bearer ", "");

    const {
      data: { user },
      error,
    } = await sb.auth.getUser(token);

    if (error || !user) {
      return NextResponse.json({ ok: false, error: "INVALID_SESSION" }, { status: 401 });
    }

    const body = await req.json().catch(() => null);

    const password = String(body?.password || "");
    const password_confirm = String(body?.password_confirm || "");

    if (!isStrongPassword(password)) {
      return NextResponse.json(
        { ok: false, error: "PASSWORD_TOO_SHORT" },
        { status: 400 }
      );
    }

    if (password !== password_confirm) {
      return NextResponse.json(
        { ok: false, error: "PASSWORDS_DO_NOT_MATCH" },
        { status: 400 }
      );
    }

    // 🔥 sacamos teléfono del metadata (importantísimo)
    const phone =
      user.user_metadata?.telefono_normalizado ||
      user.phone ||
      "";

    const phoneDigits = digitsOnly(phone);

    if (!phoneDigits) {
      return NextResponse.json(
        { ok: false, error: "PHONE_NOT_FOUND" },
        { status: 400 }
      );
    }

    // 🔥 AQUÍ ESTÁ LA MAGIA (anti-duplicados)
    const result = await ensureClienteAuthUser({
      phone: phoneDigits,
      password,
    });

    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
