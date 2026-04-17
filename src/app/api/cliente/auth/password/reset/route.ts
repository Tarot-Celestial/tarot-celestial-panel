import { NextResponse } from "next/server";
import {
  buildPasswordValidationError,
  ensureClienteAuthUser,
  findClienteByPhoneForAuth,
  normalizePhoneDigits,
} from "@/lib/server/cliente-auth-password";
import { verifyOtpChallenge } from "@/lib/server/cliente-whatsapp-auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));

    const phoneDigits = normalizePhoneDigits(body?.phone);
    const code = String(body?.code || "").trim();
    const challengeToken = String(body?.challenge_token || "").trim();
    const password = String(body?.password || "");
    const channel = body?.channel === "email" ? "email" : "whatsapp";

    // 🔒 VALIDACIÓN INPUT
    if (!phoneDigits || !code || !challengeToken) {
      return NextResponse.json(
        { ok: false, error: "DATOS_INCOMPLETOS" },
        { status: 400 }
      );
    }

    const passwordError = buildPasswordValidationError(password);
    if (passwordError) {
      return NextResponse.json(
        { ok: false, error: passwordError },
        { status: 400 }
      );
    }

    // 🔐 VERIFICAR OTP
    verifyOtpChallenge(challengeToken, phoneDigits, code, channel);

    // 🔍 BUSCAR CLIENTE
    const cliente = await findClienteByPhoneForAuth(phoneDigits);

    if (!cliente?.id) {
      return NextResponse.json(
        { ok: false, error: "CLIENTE_NO_ENCONTRADO" },
        { status: 404 }
      );
    }

    // 🔥 USAR TELÉFONO CORRECTO
    const phoneToUse =
      cliente.telefono_normalizado ||
      cliente.telefono ||
      phoneDigits;

    if (!phoneToUse) {
      return NextResponse.json(
        { ok: false, error: "TELEFONO_NO_VALIDO" },
        { status: 400 }
      );
    }

    // 🔥 CREAR / ACTUALIZAR PASSWORD (ANTI DUPLICADOS)
    const authState = await ensureClienteAuthUser({
      phone: phoneToUse,
      password,
    });

    // ✅ RESPUESTA LIMPIA
    return NextResponse.json({
      ok: true,
      alias_email: authState.alias_email,
      created: authState.created,
      auth_user_id: authState.auth_user_id,
    });

  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "ERR_PASSWORD_RESET" },
      { status: 500 }
    );
  }
}
