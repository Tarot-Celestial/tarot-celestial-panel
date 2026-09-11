import { NextResponse } from "next/server";
import { clientFromRequest, normalizePhone } from "@/lib/server/auth-cliente";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const gate = await clientFromRequest(req);
    if (!gate.uid) {
      return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    }
    if (!gate.cliente?.id) {
      return NextResponse.json({ ok: false, error: "CLIENTE_NO_ENCONTRADO" }, { status: 404 });
    }
    if (!gate.phone) {
      return NextResponse.json({ ok: false, error: "PHONE_REQUIRED" }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const previousNormalized = normalizePhone(body?.telefono_anterior || body?.telefono_anterior_normalizado || "");
    if (!previousNormalized) {
      return NextResponse.json({ ok: false, error: "PREVIOUS_PHONE_REQUIRED" }, { status: 400 });
    }

    const currentPhone = normalizePhone(gate.cliente.telefono);
    const currentNormalized = normalizePhone(gate.cliente.telefono_normalizado);
    if (previousNormalized !== currentPhone && previousNormalized !== currentNormalized) {
      return NextResponse.json({ ok: false, error: "PREVIOUS_PHONE_MISMATCH" }, { status: 409 });
    }

    const phoneNormalized = normalizePhone(gate.phone);

    const { data: updated, error } = await gate.admin
      .from("crm_clientes")
      .update({
        telefono: phoneNormalized,
        telefono_normalizado: phoneNormalized,
        updated_at: new Date().toISOString(),
      })
      .eq("id", gate.cliente.id)
      .select("*")
      .maybeSingle();

    if (error) throw error;

    return NextResponse.json({ ok: true, cliente: updated });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR_PHONE_SYNC" }, { status: 500 });
  }
}
