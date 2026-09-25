import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import { computeRitual, isOpenRitual, ritualModes } from "@/lib/rituals";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const DAY = 86400000;
const uuid = (value: unknown) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
class InputError extends Error { constructor(message: string, public status = 400) { super(message); } }
function number(value: unknown, label: string, min: number, max: number) {
  if (value === null || value === "" || typeof value === "boolean" || !["string", "number"].includes(typeof value)) throw new InputError(`${label}: introduce un número válido.`);
  const result = Number(value);
  if (!Number.isFinite(result) || result < min || result > max) throw new InputError(`${label}: debe estar entre ${min} y ${max}.`);
  return result;
}
function text(value: unknown, max = 2000) {
  if (value == null) return null;
  if (typeof value !== "string" || value.length > max) throw new InputError(`El texto no puede superar ${max} caracteres.`);
  return value.trim() || null;
}
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store", Vary: "Authorization" } });
function failure(error: unknown) {
  if (error instanceof InputError) return reply({ ok: false, error: error.message }, error.status);
  console.error("[admin/client-rituals]", error);
  return reply({ ok: false, error: "No se pudo guardar o consultar el ritual. Actualiza y vuelve a intentarlo." }, 500);
}

export async function GET(req: Request) {
  try {
    const gate = await requireAdmin(req);
    if (!gate.ok) return reply({ ok: false, error: gate.error }, gate.error === "FORBIDDEN" ? 403 : 401);
    const url = new URL(req.url), eventId = url.searchParams.get("ritual_id");
    if (eventId) {
      if (!uuid(eventId)) throw new InputError("Ritual no válido.");
      const result = await gate.admin.from("client_ritual_events").select("id,tipo,detalle,created_at").eq("ritual_id", eventId).order("created_at", { ascending: false }).limit(30);
      if (result.error) throw result.error;
      return reply({ ok: true, events: result.data || [] });
    }
    const q = (url.searchParams.get("q") || "").replace(/[^\p{L}\p{N}@+ ._-]/gu, "").trim().slice(0, 80);
    let cq = gate.admin.from("crm_clientes").select("id,nombre,apellido,email,telefono").order("updated_at", { ascending: false }).limit(80);
    if (q) cq = cq.or(`nombre.ilike.%${q}%,apellido.ilike.%${q}%,email.ilike.%${q}%,telefono.ilike.%${q}%`);
    const [clients, types, rituals] = await Promise.all([
      cq,
      gate.admin.from("ritual_types").select("*").order("nombre"),
      gate.admin.from("client_rituals").select("*,ritual_types(*),cliente:crm_clientes!client_rituals_cliente_id_fkey(id,nombre,apellido)").order("created_at", { ascending: false }).limit(150),
    ]);
    if (clients.error) throw clients.error;
    if (types.error) throw types.error;
    if (rituals.error) throw rituals.error;
    return reply({ ok: true, clients: clients.data || [], types: types.data || [], rituals: (rituals.data || []).map((row: any) => computeRitual(row)) });
  } catch (error) { return failure(error); }
}

export async function POST(req: Request) {
  try {
    const gate = await requireAdmin(req);
    if (!gate.ok) return reply({ ok: false, error: gate.error }, gate.error === "FORBIDDEN" ? 403 : 401);
    const b = await req.json().catch(() => { throw new InputError("Solicitud no válida."); });
    if (!b || typeof b !== "object" || Array.isArray(b)) throw new InputError("Solicitud no válida.");
    const action = String(b.action || ""), now = new Date(), stamp = now.toISOString();
    const audit = async (id: string, clientId: string, detail: unknown) => {
      const result = await gate.admin.from("client_ritual_events").insert({ ritual_id: id, cliente_id: clientId, tipo: action === "create" ? "ritual_iniciado" : `ritual_${action}`, actor_worker_id: gate.me.id, detalle: detail });
      if (result.error) console.error("[admin/client-rituals:audit]", result.error);
      return result.error ? "El cambio se ha guardado, pero no se pudo registrar en el historial. No repitas la operación." : undefined;
    };
    if (action === "create") {
      if (!uuid(b.cliente_id) || !uuid(b.ritual_type_id)) throw new InputError("Selecciona un cliente y un tipo de ritual válidos.");
      const mode = b.modo || "automatico";
      if (!Object.hasOwn(ritualModes, mode)) throw new InputError("Modo no válido.");
      const [type, open] = await Promise.all([
        gate.admin.from("ritual_types").select("*").eq("id", b.ritual_type_id).eq("activo", true).maybeSingle(),
        gate.admin.from("client_rituals").select("id").eq("cliente_id", b.cliente_id).in("estado", ["pendiente", "activo", "pausado"]).limit(1),
      ]);
      if (type.error) throw type.error;
      if (open.error) throw open.error;
      if (!type.data) throw new InputError("Este tipo de ritual ya no está disponible.");
      if (open.data?.length) throw new InputError("Este cliente ya tiene un ritual abierto. Complétalo o cancélalo antes de asignar otro.", 409);
      const duration = number(b.duracion_dias ?? type.data.duracion_default_dias ?? 7, "Duración", 1, 3650);
      const start = b.fecha_inicio ? new Date(b.fecha_inicio) : now;
      if (!Number.isFinite(start.getTime())) throw new InputError("Fecha de inicio no válida.");
      const values = { cliente_id: b.cliente_id, ritual_type_id: b.ritual_type_id, modo: mode,
        estado: "activo", fecha_inicio: start.toISOString(), fecha_fin_prevista: new Date(start.getTime() + duration * DAY).toISOString(),
        nombre_personalizado: text(b.nombre_personalizado, 160), mensaje_actual: text(b.mensaje), consejo_actual: text(b.consejo), created_by: gate.me.id };
      const created = await gate.admin.from("client_rituals").insert(values).select("id").single();
      if (created.error) throw created.error;
      const warning = await audit(created.data.id, b.cliente_id, { ...values, duracion_dias: duration });
      return reply({ ok: true, id: created.data.id, warning });
    }
    if (!["update", "pause", "resume", "complete", "cancel"].includes(action)) throw new InputError("Acción no válida.");
    if (!uuid(b.id)) throw new InputError("Ritual no válido.");
    const found = await gate.admin.from("client_rituals").select("*,ritual_types(*)").eq("id", b.id).maybeSingle();
    if (found.error) throw found.error;
    if (!found.data) throw new InputError("El ritual ya no existe.", 404);
    const old = found.data;
    if (!isOpenRitual(old.estado)) throw new InputError("Este ritual está cerrado. Su historial se conserva sin cambios.", 409);
    if (b.expected_updated_at && Date.parse(b.expected_updated_at) !== Date.parse(old.updated_at)) throw new InputError("Otra sesión ha cambiado este ritual. Actualiza antes de guardar.", 409);
    const patch: Record<string, unknown> = { updated_at: stamp };
    if (action === "update") {
      const mode = b.modo ?? old.modo;
      if (!Object.hasOwn(ritualModes, mode)) throw new InputError("Modo no válido.");
      patch.modo = mode;
      if (b.nombre_personalizado !== undefined) patch.nombre_personalizado = text(b.nombre_personalizado, 160);
      if (b.mensaje !== undefined) patch.mensaje_actual = text(b.mensaje);
      if (b.consejo !== undefined) patch.consejo_actual = text(b.consejo);
      if (b.duracion_dias !== undefined) {
        const duration = number(b.duracion_dias, "Duración", 1, 3650);
        patch.fecha_fin_prevista = new Date(Date.parse(old.fecha_inicio) + duration * DAY).toISOString();
      }
      if (b.clear_override === true) {
        if (mode === "manual") throw new InputError("El modo manual necesita un porcentaje. Selecciona automático o híbrido para recuperar el calendario.");
        patch.override_automatico = false; patch.fase_manual = null;
      } else {
        if (b.progreso !== undefined) { patch.progreso_manual = number(b.progreso, "Progreso", 0, 100); patch.override_automatico = true; }
        if (b.fase_manual !== undefined) {
          const phases = Array.isArray(old.ritual_types?.fases) ? old.ritual_types.fases : [];
          const phase = b.fase_manual === null ? null : number(b.fase_manual, "Fase", 0, Math.max(0, phases.length - 1));
          if (phase !== null && (!Number.isInteger(phase) || !phases[phase])) throw new InputError("Selecciona una fase válida.");
          patch.fase_manual = phase;
          if (phase !== null) { patch.override_automatico = true; if (patch.progreso_manual === undefined) patch.progreso_manual = computeRitual(old).progress; }
        }
      }
      if (mode === "manual" && old.modo !== "manual" && patch.progreso_manual === undefined) patch.progreso_manual = computeRitual(old).progress;
    } else if (action === "pause") {
      if (old.estado !== "activo") throw new InputError("Solo se puede pausar un ritual activo.", 409);
      patch.estado = "pausado"; patch.progreso_manual = computeRitual(old, now.getTime()).progress;
    } else if (action === "resume") {
      if (!["pausado", "pendiente"].includes(old.estado)) throw new InputError("Este ritual ya está en proceso.", 409);
      patch.estado = "activo";
      if (old.estado === "pausado" && old.modo !== "manual" && !old.override_automatico) {
        const pause = await gate.admin.from("client_ritual_events").select("created_at").eq("ritual_id", old.id).eq("tipo", "ritual_pause").order("created_at", { ascending: false }).limit(1).maybeSingle();
        if (pause.error) throw pause.error;
        const elapsed = Math.max(0, now.getTime() - Date.parse(pause.data?.created_at || old.updated_at));
        patch.fecha_inicio = new Date(Date.parse(old.fecha_inicio) + elapsed).toISOString();
        if (old.fecha_fin_prevista) patch.fecha_fin_prevista = new Date(Date.parse(old.fecha_fin_prevista) + elapsed).toISOString();
      }
    } else if (action === "complete") {
      patch.estado = "completado"; patch.progreso_manual = 100; patch.override_automatico = true; patch.fase_manual = null; patch.fecha_fin_real = stamp;
    } else { patch.estado = "cancelado"; patch.progreso_manual = computeRitual(old).progress; }
    // Optimistic concurrency prevents stale forms and repeated close actions from overwriting newer changes.
    const saved = await gate.admin.from("client_rituals").update(patch).eq("id", old.id).eq("updated_at", old.updated_at).select("id").maybeSingle();
    if (saved.error) throw saved.error;
    if (!saved.data) throw new InputError("El ritual ha cambiado durante la edición. Actualiza y revisa los datos.", 409);
    const warning = await audit(old.id, old.cliente_id, patch);
    return reply({ ok: true, id: old.id, warning });
  } catch (error) { return failure(error); }
}
