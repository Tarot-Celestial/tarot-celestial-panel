import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/server/auth-worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (value: object, status = 200) => NextResponse.json(value, { status, headers: { "Cache-Control": "private, no-store" } });
class AccessError extends Error { constructor(message: string, public status: number) { super(message); } }
async function identity(req: Request) {
  const token = (req.headers.get("authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) throw new AccessError("Inicia sesión para acceder.", 401);
  const db = getAdminClient();
  // Verify the signature/session with Auth; decoding the JWT is not authentication.
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) throw new AccessError("La sesión no es válida. Vuelve a entrar.", 401);
  const workers = await db.from("workers").select("id,role,is_active").eq("user_id", data.user.id);
  if (workers.error) throw workers.error;
  if (!workers.data?.some(w => w.is_active !== false && ["central", "admin"].includes(w.role))) throw new AccessError("No tienes acceso a recuperación de clientes.", 403);
  return { db, uid: data.user.id };
}
function failure(error: any) {
  if (error instanceof AccessError) return json({ ok: false, error: error.message }, error.status);
  const codes: Record<string, [number, string]> = {
    FORBIDDEN: [403, "No tienes permiso para esta gestión."],
    NOT_ELIGIBLE: [409, "Este contacto ya no cumple el filtro de recuperación. Actualiza la lista."],
    STALE_VERSION: [409, "Otra central ha actualizado esta ficha. Actualiza antes de continuar."],
    OTHER_OWNER: [409, "Esta ficha está en seguimiento por otra central. Su responsable o el administrador puede cambiar el estado."],
    RESTORE_FIRST: [409, "Devuelve primero el contacto desde reciclaje."],
    CONTACT_FIRST: [409, "Registra primero que fue contactada; la compra debe ser posterior."],
    PAYMENT_REQUIRED: [409, "Selecciona una compra completada de esta clienta, posterior al contacto."],
    INVALID_ACTION: [400, "La acción no es válida para este estado."],
  };
  const match = codes[String(error?.message || "")];
  if (match) return json({ ok: false, error: match[1] }, match[0]);
  if (["42P01", "42883", "PGRST202", "PGRST205"].includes(error?.code)) return json({ ok: false, error: "Falta instalar el SQL de Recuperación de clientes. Contacta con el administrador." }, 503);
  console.error("client-recovery", { code: error?.code, message: error?.message });
  return json({ ok: false, error: "No se ha podido guardar o cargar la gestión. Reintenta; no se duplicarán los XP." }, 500);
}
export async function GET(req: Request) {
  try {
    const { db, uid } = await identity(req);
    const q = new URL(req.url).searchParams;
    const id = q.get("client_id");
    if (id && !uuid.test(id)) return json({ ok: false, error: "Contacto no válido." }, 400);
    let result;
    if (id) result = await db.rpc("tc_recovery_detail", { p_user: uid, p_client: id });
    else {
      const bucket = q.get("bucket") || "pending", status = q.get("status") || "";
      if (!["pending", "recycled", "recovered"].includes(bucket) || !["", "pending", "contacted", "no_response"].includes(status)) return json({ ok: false, error: "Filtro no válido." }, 400);
      const page = Number(q.get("page") || 1);
      result = await db.rpc("tc_recovery_list", { p_user: uid, p_bucket: bucket, p_status: bucket === "pending" ? status : "", p_search: (q.get("q") || "").trim().slice(0,100), p_tag: (q.get("tag") || "").slice(0,150), p_page: Number.isInteger(page) ? Math.min(100000, Math.max(1,page)) : 1 });
    }
    if (result.error) throw result.error;
    return json({ ok: true, ...result.data });
  } catch (error) { return failure(error); }
}
export async function POST(req: Request) {
  try {
    const { db, uid } = await identity(req);
    const body = await req.json().catch(() => null);
    if (!body || !uuid.test(body.client_id || "") || !["contacted", "no_response", "recycled", "recovered", "restore"].includes(body.action) || !Number.isInteger(body.version) || body.version < 0 || (body.payment_id && !uuid.test(body.payment_id))) return json({ ok: false, error: "Revisa los datos de la gestión." }, 400);
    const { data, error } = await db.rpc("tc_recovery_act", { p_user: uid, p_client: body.client_id, p_action: body.action, p_version: body.version, p_payment: body.payment_id || null, p_note: String(body.note || "").slice(0,1000) });
    if (error) throw error;
    return json({ ok: true, ...data });
  } catch (error) { return failure(error); }
}
