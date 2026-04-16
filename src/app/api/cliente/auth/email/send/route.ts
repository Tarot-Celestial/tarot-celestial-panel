import { NextResponse } from "next/server";
import {
  createOtpChallenge,
  findClienteByPhone,
  generateOtpCode,
  maskEmail,
  normalizeEmail,
  normalizePhone,
  sendEmailVerification,
} from "@/lib/server/cliente-whatsapp-auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const phoneDigits = normalizePhone(body?.phone || body?.telefono || "");

    if (!phoneDigits) {
      return NextResponse.json({ ok: false, error: "TELEFONO_INVALIDO" }, { status: 400 });
    }

    const cliente = await findClienteByPhone(phoneDigits);
    if (!cliente?.id) {
      return NextResponse.json({ ok: false, error: "CLIENTE_NO_ENCONTRADO" }, { status: 404 });
    }

    const email = normalizeEmail((cliente as any)?.email || "");
    if (!email) {
      return NextResponse.json({ ok: false, error: "CLIENTE_SIN_EMAIL" }, { status: 400 });
    }

    const code = generateOtpCode();
    const emailResult = await sendEmailVerification(email, code, (cliente as any)?.nombre || null);
    const challenge_token = createOtpChallenge(phoneDigits, code, "email");

    return NextResponse.json({
      ok: true,
      channel: "email",
      email: maskEmail(email),
      challenge_token,
      provider_id: emailResult?.id || null,
      message: `Te hemos enviado un código al e-mail ${maskEmail(email)}.`,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "EMAIL_SEND_ERROR" }, { status: 500 });
  }
}
