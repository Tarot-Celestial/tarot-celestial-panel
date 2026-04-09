import { NextResponse } from "next/server";
import { adminClient, authUserFromBearer, normalizePhone } from "@/lib/server/auth-cliente";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const { uid, phone } = await authUserFromBearer(req);
    if (!uid) {
      return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    }
    if (!phone) {
      return NextResponse.json({ ok: false, error: "PHONE_REQUIRED" }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const previousNormalized = normalizePhone(body?.telefono_anterior || body?.telefono_anterior_normalizado || "");
    if (!previousNormalized) {
      return NextResponse.json({ ok: false, error: "PREVIOUS_PHONE_REQUIRED" }, { status: 400 });
    }

    const admin = adminClient();
    const { data: cliente, error: lookupError } = await admin
      .from("crm_clientes")
      .select("id")
      .eq("telefono_normalizado", previousNormalized)
      .maybeSingle();

    if (lookupError) throw lookupError;
    if (!cliente?.id) {
      return NextResponse.json({ ok: false, error: "CLIENTE_NO_ENCONTRADO" }, { status: 404 });
    }

    const visiblePhone = String(body?.telefono || phone || "").trim() || phone;
    const phoneNormalized = normalizePhone(phone);

    const { data: updated, error } = await admin
      .from("crm_clientes")
      .update({
        telefono: visiblePhone,
        telefono_normalizado: phoneNormalized,
        updated_at: new Date().toISOString(),
      })
      .eq("id", cliente.id)
      .select("*")
      .maybeSingle();

    if (error) throw error;

    return NextResponse.json({ ok: true, cliente: updated });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR_PHONE_SYNC" }, { status: 500 });
  }
}
