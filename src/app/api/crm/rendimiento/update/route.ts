import { NextResponse } from "next/server";
import { rendimientoActor } from "@/lib/server/rendimiento-access";
import { decimalValue, validateActivityCodes } from "@/lib/activity-codes";
export const runtime = "nodejs";
export async function POST(req: Request) {
  try {
    const { admin, worker } = await rendimientoActor(req);
    if (!worker) return NextResponse.json({ ok: false, message: "Tu sesión no autoriza esta operación. Vuelve a iniciar sesión." }, { status: 401 });
    const body = await req.json().catch(() => null);
    let tiempo: number, importe: number, tarotistaNombre: string, blocks;
    try {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(body?.id || ""))) throw new Error("Registro inválido.");
      if (!Number.isSafeInteger(body?.revision) || body.revision < 0) throw new Error("Actualiza la tabla antes de editar.");
      const updates = body?.updates;
      if (!updates || Object.keys(updates).some(key => !["tiempo","importe","tarotista_nombre","code_blocks"].includes(key))) throw new Error("Solo se pueden corregir tarotista, tiempo, importe y códigos.");
      tiempo = decimalValue(updates.tiempo, "Tiempo");
      importe = decimalValue(updates.importe, "Importe");
      tarotistaNombre = String(updates.tarotista_nombre || "").trim().replace(/\s+/g, " ");
      if (!tarotistaNombre || tarotistaNombre.length > 120) throw new Error("Escribe un nombre de tarotista válido (máximo 120 caracteres).");
      blocks = validateActivityCodes(updates.code_blocks, tiempo);
    } catch (e) {
      return NextResponse.json({ ok: false, message: e instanceof Error ? e.message : "Revisa los datos." }, { status: 400 });
    }
    const { data, error } = await admin.rpc("tc_rendimiento_update_v2", {
      p_worker: worker.id, p_id: body.id, p_revision: body.revision,
      p_tiempo: tiempo, p_importe: importe, p_tarotista_nombre: tarotistaNombre, p_blocks: blocks,
    });
    if (error) {
      const status = error.code === "42501" ? 403 : error.code === "40001" || error.code === "P0002" ? 409 : error.code === "22023" ? 400 : 500;
      const message = status < 500 ? error.message : "No se pudo guardar. Comprueba que se aplicó el SQL de Rendimiento; tus cambios siguen en el formulario.";
      return NextResponse.json({ ok: false, message }, { status });
    }
    if (!data?.id) throw new Error("EMPTY_UPDATE");
    return NextResponse.json({ ok: true, data }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false, message: "No se pudo confirmar el guardado. Tus cambios se conservan; vuelve a intentarlo." }, { status: 500 });
  }
}
