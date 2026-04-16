import { NextResponse } from "next/server";
import { ensureClienteAuthUser, findClienteByPhoneForAuth, normalizePhoneDigits } from "@/lib/server/cliente-auth-password";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const phoneDigits = normalizePhoneDigits(body?.phone);

    if (!phoneDigits) {
      return NextResponse.json({ ok: false, error: "TELEFONO_INVALIDO" }, { status: 400 });
    }

    const cliente = await findClienteByPhoneForAuth(phoneDigits);
    if (!cliente?.id) {
      return NextResponse.json({ ok: false, error: "CLIENTE_NO_ENCONTRADO" }, { status: 404 });
    }

    const authState = await ensureClienteAuthUser(cliente);

    return NextResponse.json({
      ok: true,
      alias_email: authState.aliasEmail,
      created: authState.created,
      migrated: authState.migrated,
      linked: authState.linked,
      auth_user_id: authState.authUserId,
      onboarding_completado: Boolean((cliente as any)?.onboarding_completado),
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR_PASSWORD_PREPARE" }, { status: 500 });
  }
}
