import { NextResponse } from "next/server";
import { findClienteByPhone, formatE164FromDigits, sendWhatsappVerification } from "@/lib/server/cliente-whatsapp-auth";

export const runtime = "nodejs";

function normalizePhone(phone: string): string {
  return String(phone || "").replace(/\D/g, "");
}

export async function POST(req: Request) {
  try {
    console.log("🔥 WHATSAPP API LLAMADA");

    const body = await req.json().catch(() => null);
    const phoneDigits = normalizePhone(body?.phone || body?.telefono || "");

    if (!phoneDigits) {
      return NextResponse.json({ ok: false, error: "TELEFONO_INVALIDO" }, { status: 400 });
    }

    const cliente = await findClienteByPhone(phoneDigits);
    if (!cliente?.id) {
      return NextResponse.json({ ok: false, error: "CLIENTE_NO_ENCONTRADO" }, { status: 404 });
    }

    const phoneE164 = formatE164FromDigits(phoneDigits);

    const verification = await sendWhatsappVerification(phoneE164);

    return NextResponse.json({
      ok: true,
      channel: "whatsapp",
      sid: verification?.sid || null,
      status: verification?.status || null,
      phone: phoneE164,
      message: "Te hemos enviado un código por WhatsApp.",
    });
  } catch (e: any) {
    console.error("❌ WHATSAPP ERROR:", e);

    return NextResponse.json(
      { ok: false, error: e?.message || "WHATSAPP_SEND_ERROR" },
      { status: 500 }
    );
  }
}
