import { NextResponse } from "next/server";
import {
  createClienteMagicLinkFromChannel,
  findClienteByPhone,
  normalizePhone,
  verifyOtpChallenge,
} from "@/lib/server/cliente-whatsapp-auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const phoneDigits = normalizePhone(body?.phone || body?.telefono || "");
    const code = String(body?.code || body?.token || "").trim();
    const challengeToken = String(body?.challenge_token || "").trim();

    if (!phoneDigits || !code || !challengeToken) {
      return NextResponse.json({ ok: false, error: "DATOS_INVALIDOS" }, { status: 400 });
    }

    const cliente = await findClienteByPhone(phoneDigits);
    if (!cliente?.id) {
      return NextResponse.json({ ok: false, error: "CLIENTE_NO_ENCONTRADO" }, { status: 404 });
    }

    verifyOtpChallenge(challengeToken, phoneDigits, code, "email");

    const origin = new URL(req.url).origin;
    const login = await createClienteMagicLinkFromChannel(phoneDigits, origin, "email");

    return NextResponse.json({
      ok: true,
      action_link: login.actionLink,
      redirect_to: login.actionLink,
      message: "Código validado. Te estamos redirigiendo al panel.",
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "EMAIL_VERIFY_ERROR" }, { status: 500 });
  }
}
