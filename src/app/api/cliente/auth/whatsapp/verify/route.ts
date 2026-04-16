import { NextResponse } from "next/server";
import {
  checkWhatsappVerification,
  createClienteMagicLinkFromWhatsapp,
  findClienteByPhone,
  formatE164FromDigits,
  normalizePhone,
} from "@/lib/server/cliente-whatsapp-auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const phoneDigits = normalizePhone(body?.phone || body?.telefono || "");
    const code = String(body?.code || body?.token || "").trim();

    if (!phoneDigits || !code) {
      return NextResponse.json({ ok: false, error: "DATOS_INVALIDOS" }, { status: 400 });
    }

    const cliente = await findClienteByPhone(phoneDigits);
    if (!cliente?.id) {
      return NextResponse.json({ ok: false, error: "CLIENTE_NO_ENCONTRADO" }, { status: 404 });
    }

    const phoneE164 = formatE164FromDigits(phoneDigits);
    const verification = await checkWhatsappVerification(phoneE164, code);
    if (String(verification?.status || "").toLowerCase() !== "approved") {
      return NextResponse.json({ ok: false, error: "CODIGO_INVALIDO" }, { status: 401 });
    }

    const origin = new URL(req.url).origin;
    const login = await createClienteMagicLinkFromWhatsapp(phoneDigits, origin);

    return NextResponse.json({
      ok: true,
      redirect_to: login.actionLink,
      message: "Código validado. Te estamos redirigiendo al panel.",
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "WHATSAPP_VERIFY_ERROR" }, { status: 500 });
  }
}
