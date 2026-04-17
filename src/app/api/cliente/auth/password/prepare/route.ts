import { NextResponse } from "next/server";
import {
  ensureClienteAuthUser,
  findClienteByPhoneForAuth,
  normalizePhoneDigits,
} from "@/lib/server/cliente-auth-password";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));

    const phoneDigits = normalizePhoneDigits(body?.phone);

    if (!phoneDigits) {
      return NextResponse.json(
        { ok: false, error: "TELEFONO_INVALIDO" },
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

    // 🔥 IMPORTANTE: pasar SOLO el teléfono (no el objeto cliente)
    const phoneToUse =
      cliente.telefono_normalizado ||
      cliente.telefono ||
      phoneDigits;

    const result = await ensureClienteAuthUser({
      phone: phoneToUse,
    });

    return NextResponse.json({
      ok: true,
      alias_email: result.alias_email,
      created: result.created,
      auth_user_id: result.auth_user_id,
      onboarding_completado: Boolean(
        (cliente as any)?.onboarding_completado
      ),
    });

  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "ERR_PASSWORD_PREPARE" },
      { status: 500 }
    );
  }
}
