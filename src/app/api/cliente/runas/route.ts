import { NextResponse } from "next/server";
import { clientFromRequest } from "@/lib/server/auth-cliente";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store, max-age=0", Vary: "Authorization" } });

export async function GET(req: Request) {
  try {
    const gate = await clientFromRequest(req);
    if (!gate.uid) return reply({ ok: false, error: "NO_AUTH" }, 401);
    if (!gate.cliente) return reply({ ok: false, error: "Tu cuenta todavía no está vinculada a una ficha de cliente. Contacta con tu central." }, 404);
    const result = await gate.admin.from("client_runes").select("title,benefit,updated_at").eq("cliente_id", gate.cliente.id).eq("enabled", true).maybeSingle();
    if (result.error) throw result.error;
    return reply({ ok: true, rune: result.data || null });
  } catch (error) {
    console.error("[cliente/runas]", (error as { code?: string })?.code || "QUERY_FAILED");
    return reply({ ok: false, error: "No se pudo consultar tu runa. Vuelve a intentarlo." }, 500);
  }
}
