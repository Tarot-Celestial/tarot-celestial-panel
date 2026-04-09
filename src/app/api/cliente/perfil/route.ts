import { NextResponse } from "next/server";
import { clientFromRequest } from "@/lib/server/auth-cliente";

export const runtime = "nodejs";

function cleanText(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}

function cleanDate(value: unknown): string | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  return text;
}

export async function POST(req: Request) {
  try {
    const gate = await clientFromRequest(req);
    if (!gate.uid) {
      return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    }
    if (!gate.cliente) {
      return NextResponse.json({ ok: false, error: "CLIENTE_NO_ENCONTRADO" }, { status: 404 });
    }

    const body = await req.json().catch(() => ({}));

    const patch = {
      nombre: cleanText(body?.nombre),
      apellido: cleanText(body?.apellido),
      email: cleanText(body?.email),
      fecha_nacimiento: cleanDate(body?.fecha_nacimiento),
      onboarding_completado: Boolean(body?.onboarding_completado),
      updated_at: new Date().toISOString(),
    };

    const { data: updated, error } = await gate.admin
      .from("crm_clientes")
      .update(patch)
      .eq("id", gate.cliente.id)
      .select("*")
      .maybeSingle();

    if (error) throw error;

    return NextResponse.json({ ok: true, cliente: updated });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR_CLIENTE_PERFIL" }, { status: 500 });
  }
}
