import { recoveryIdentity as identity, recoveryJson as json, recoveryFailure as failure } from '@/lib/server/recovery-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
      result = await db.rpc(q.get("mission") === "1" ? "tc_recovery_mission_list" : "tc_recovery_list", { p_user: uid, p_bucket: bucket, p_status: bucket === "pending" ? status : "", p_search: (q.get("q") || "").trim().slice(0,100), p_tag: (q.get("tag") || "").slice(0,150), p_page: Number.isInteger(page) ? Math.min(100000, Math.max(1,page)) : 1 });
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
    const channel = body.action === 'contacted' ? body.channel : 'other';
    if (!['whatsapp', 'phone', 'email', 'other'].includes(channel) || !uuid.test(body.request_id || '')) {
      return json({ ok: false, error: 'Selecciona el canal y vuelve a abrir la gestión si ha caducado.' }, 400);
    }
    const { data, error } = await db.rpc("tc_recovery_act_v2", { p_user: uid, p_client: body.client_id, p_action: body.action, p_version: body.version, p_payment: body.payment_id || null, p_note: String(body.note || "").slice(0,1000), p_channel: channel, p_request_id: body.request_id });
    if (error) throw error;
    return json({ ok: true, ...data });
  } catch (error) { return failure(error); }
}
