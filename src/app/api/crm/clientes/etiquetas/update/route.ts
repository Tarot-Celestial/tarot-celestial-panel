import { NextResponse } from "next/server";
import { centralWorkspaceIdentity, centralWorkspaceAccessFailure } from "@/lib/server/central-workspace-access";

export const runtime = "nodejs";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const headers = { "Cache-Control": "private, no-store", Vary: "Authorization" };
const json = (body: object, status = 200) => NextResponse.json(body, { status, headers });

export async function POST(req: Request) {
  try {
    // Verify the token and active Central/Admin identity before privileged writes.
    const { db } = await centralWorkspaceIdentity(req);
    const body = await req.json().catch(() => null);
    const clienteId = typeof body?.cliente_id === "string" ? body.cliente_id.trim() : "";
    if (!UUID.test(clienteId) || !Array.isArray(body?.etiquetas)
        || body.etiquetas.length > 500
        || body.etiquetas.some((id: unknown) => typeof id !== "string" || !UUID.test(id))) {
      return json({ ok: false, error: "Revisa el cliente y las etiquetas seleccionadas." }, 400);
    }
    // One transaction preserves the authoritative activity month even when the
    // form was opened before a newer call/purchase, and keeps other selected tags.
    const { error } = await db.rpc("tc_crm_replace_client_tags", {
      p_cliente_id: clienteId,
      p_etiquetas: Array.from(new Set<string>(body.etiquetas)),
    });
    if (error) throw error;
    return json({ ok: true });
  } catch (error: any) {
    const accessFailure = centralWorkspaceAccessFailure(error);
    if (accessFailure) return accessFailure;
    const code = String(error?.message || "");
    if (code === "CLIENT_NOT_FOUND") return json({ ok: false, error: "No encontramos la ficha del cliente." }, 404);
    if (code === "INVALID_TAG") return json({ ok: false, error: "Una etiqueta ya no está disponible. Recarga la ficha." }, 400);
    console.error("[CRM etiquetas]", { code: error?.code || null });
    return json({ ok: false, error: "No se pudieron guardar las etiquetas. Recarga la ficha y vuelve a intentarlo." }, 500);
  }
}
