import { NextResponse } from "next/server";
import {
  createWhatsappOtpChallenge,
  findClienteByPhone,
  formatE164FromDigits,
  generateWhatsappOtpCode,
  normalizePhone,
  sendWhatsappVerification,
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

    const code = generateWhatsappOtpCode();
    const phoneE164 = formatE164FromDigits(phoneDigits);
    const message = await sendWhatsappVerification(phoneE164, code);
    const challenge_token = createWhatsappOtpChallenge(phoneDigits, code);

    return NextResponse.json({
      ok: true,
      channel: "whatsapp",
      sid: message?.sid || null,
      status: message?.status || null,
      phone: phoneE164,
      challenge_token,
      message: "Te hemos enviado un código por WhatsApp.",
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "WHATSAPP_SEND_ERROR" },
      { status: 500 }
    );
  }
}
