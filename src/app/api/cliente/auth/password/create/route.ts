import { NextRequest, NextResponse } from "next/server";
import {
  adminSupabase,
  ensureClienteAuthUser,
  digitsOnly,
  findClienteByPhoneForAuth,
  normalizePhoneDigits,
} from "@/lib/server/cliente-auth-password";

export const runtime = "nodejs";

function isStrongPassword(password: string) {
  return typeof password === "string" && password.trim().length >= 6;
}

export async function POST(req: NextRequest) {
  try {
    const sb = adminSupabase();
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

    let phoneDigits = "";

    const authHeader = req.headers.get("authorization");
    if (authHeader) {
      const token = authHeader.replace("Bearer ", "");
      const {
        data: { user },
        error,
      } = await sb.auth.getUser(token);

      if (error || !user) {
        return NextResponse.json(
          { ok: false, error: "INVALID_SESSION" },
          { status: 401 }
        );
      }

      const phone = user.user_metadata?.telefono_normalizado || user.phone || body?.phone || "";
      phoneDigits = normalizePhoneDigits(phone);
    } else {
      phoneDigits = normalizePhoneDigits(body?.phone);
    }

    if (!phoneDigits) {
      return NextResponse.json(
        { ok: false, error: "PHONE_NOT_FOUND" },
        { status: 400 }
      );
    }

    const cliente = await findClienteByPhoneForAuth(phoneDigits);
    if (!cliente?.id) {
      return NextResponse.json(
        { ok: false, error: "CLIENTE_NO_ENCONTRADO" },
        { status: 404 }
      );
    }

    const phoneToUse = normalizePhoneDigits(
      cliente.telefono_normalizado || cliente.telefono || phoneDigits
    );

    const result = await ensureClienteAuthUser({
      phone: phoneToUse,
      password,
    });

    return NextResponse.json({
      ok: true,
      alias_email: result.alias_email,
      created: result.created,
      auth_user_id: result.auth_user_id,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
