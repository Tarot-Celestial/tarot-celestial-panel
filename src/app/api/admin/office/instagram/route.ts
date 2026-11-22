import { waitUntil } from "@vercel/functions";
import type { SupabaseClient } from "@supabase/supabase-js";
import { officeAccess, officeError, officeJson, officeUuid } from "@/lib/server/office-access";
import { officeInstagramConnection, readOfficeReceipt, OfficeInstagramError } from "@/lib/server/office-instagram-graph";
import { InstagramDraftError, loadInstagramVersion } from "@/lib/server/office-instagram-media";
import { processOfficeInstagram, saveOfficeMetrics } from "@/lib/server/office-instagram-worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
const fields = "id,version_id,status,scheduled_at,time_zone,container_id,external_post_id,permalink,last_error,metrics,updated_at";
async function destination(db: SupabaseClient, actor: string) {
  const conn = await officeInstagramConnection();
  if (conn.owner_id || !conn.persisted_account_id || !conn.connected_at) return { ...conn, bind_on_approval:false };
  const owner = await db.from("office_ig_connection_owners").select("actor_user_id")
    .eq("account_id",conn.persisted_account_id).eq("connected_at",conn.connected_at).maybeSingle();
  if (owner.error) throw new Error("No se pudo comprobar el responsable de la conexión.");
  return { ...conn, owner_id: owner.data?.actor_user_id || actor, bind_on_approval: !owner.data };
}
async function preview(db: SupabaseClient, id: string) {
  const draft = await loadInstagramVersion(db,id);
  const [latest, posts, source, task] = await Promise.all([
    db.from("office_versions").select("id").eq("deliverable_id",draft.version.deliverable_id).order("version",{ascending:false}).limit(1).single(),
    db.from("office_instagram_posts").select(fields).eq("deliverable_id",draft.version.deliverable_id).order("created_at",{ascending:false}).limit(12),
    db.rpc("office_ig_source",{p_version_id:id}),
    db.from("office_tasks").select("department_id,status").eq("id",draft.version.task_id).single(),
  ]);
  if (latest.error || posts.error || source.error || task.error) throw new Error("No se pudo verificar la versión y su historial.");
  const offer = source.data?.offer;
  const commercial = /(?:[€$%]|\b(?:promoci[oó]n|descuento|oferta|precio|EUR|USD|gratis)\b)/iu.test(draft.caption);
  let message: string | null = null;
  if (latest.data.id !== id || !["aprobado","pendiente"].includes(draft.version.status)) message = "Selecciona la última versión pendiente o aprobada.";
  else if (task.data.department_id !== "marketing" || task.data.status === "cancelado") message = "El encargo debe estar vigente y pertenecer a Marketing.";
  else if (commercial && !offer) message = "La pieza comercial necesita una oferta del catálogo con su mercado y moneda aprobados.";
  if (!message && offer) {
    const scoped = await db.rpc("office_promotion_scope_live",{p_promotion_id:offer.promotion_id,p_market:offer.market,p_currency:offer.currency,p_channel:"instagram"});
    const fingerprint = await db.rpc("office_promotion_fingerprint",{p_promotion_id:offer.promotion_id,p_currency:offer.currency});
    if (scoped.error || fingerprint.error || !scoped.data || fingerprint.data !== offer.source_fingerprint) message = "La oferta ha cambiado o ya no está vigente para este mercado.";
  }
  return { caption:draft.caption, alt_text:draft.alt_text, media_type:draft.media.type, media_sha256:draft.media.sha,
    eligible:!message, message, offer:offer ? [offer.name,offer.market,offer.price + " " + offer.currency,
      offer.paid + " min" + (offer.free ? " + " + offer.free + " min de regalo" : ""),
      offer.ends_at ? "Hasta " + new Intl.DateTimeFormat("es-ES",{ timeZone:offer.time_zone || "Europe/Madrid", dateStyle:"short",timeStyle:"short" }).format(new Date(offer.ends_at)) + " (" + offer.time_zone + ")" : "Hasta desactivación",
      offer.conditions].filter(Boolean).join(" · ") : null,
    posts:posts.data };
}
function problem(error: unknown) {
  return error instanceof InstagramDraftError || error instanceof OfficeInstagramError ? officeError(error.message,422) :
    officeError("No se pudo comprobar la publicación. Actualiza la ficha.",503);
}
function rpcError(message: string) {
  if (message.includes("FORBIDDEN")) return officeError("La acción requiere autorización administrativa.",403);
  if (message.includes("NOT_FOUND")) return officeError("La publicación ya no está disponible.",404);
  return officeError("La autorización, la versión, el destino o el horario han cambiado. Actualiza la ficha antes de continuar.",409);
}
export async function GET(req: Request) {
  try {
    const auth = await officeAccess(req);
    if (!auth.ok) return auth.response;
    const id = new URL(req.url).searchParams.get("version_id");
    if (!officeUuid(id)) return officeError("Selecciona una versión válida.",400);
    const [connection, draft] = await Promise.all([destination(auth.admin,auth.authUserId),preview(auth.admin,id)]);
    return officeJson({ connection, ...draft });
  } catch (error) { return problem(error); }
}
function kick(db: SupabaseClient, id: string) {
  waitUntil(processOfficeInstagram(db,id).catch(() => { console.error("[office-instagram] La cola revisará el estado del envío."); }));
}
export async function POST(req: Request) {
  try {
    const auth = await officeAccess(req);
    if (!auth.ok) return auth.response;
    if (process.env.VERCEL_ENV !== "production") return officeError("La publicación externa se autoriza desde la Oficina de producción.",409);
    const b = await req.json().catch(() => null);
    if (b?.action === "cancel" && officeUuid(b.id)) {
      const r = await auth.admin.rpc("office_ig_cancel",{ p_actor:auth.authUserId,p_id:b.id });
      return r.error ? rpcError(r.error.message) : officeJson({ok:true});
    }
    if (b?.action === "refresh" && officeUuid(b.id)) {
      const post = await auth.admin.from("office_instagram_posts").select("id,status,account_id,persisted_account_id,connected_at,external_post_id").eq("id",b.id).maybeSingle();
      if (post.error || !post.data) return officeError("No se encontró el envío.",404);
      if (post.data.status === "published" && post.data.external_post_id) {
        const receipt = await readOfficeReceipt(post.data.account_id,post.data.external_post_id,
          {persisted_account_id:post.data.persisted_account_id,connected_at:post.data.connected_at});
        await saveOfficeMetrics(auth.admin,b.id,receipt);
      } else if (post.data.status === "verifying") kick(auth.admin,b.id);
      return officeJson({ok:true});
    }
    if (b?.action !== "approve" || !officeUuid(b.version_id) || !officeUuid(b.request_id) ||
        !["Europe/Madrid","America/Puerto_Rico"].includes(b.time_zone) ||
        (b.scheduled_at !== null && (typeof b.scheduled_at !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(b.scheduled_at) || !Number.isFinite(Date.parse(b.scheduled_at))))) {
      return officeError("Revisa la versión, el destino y la fecha de publicación.",400);
    }
    const [conn,draft] = await Promise.all([destination(auth.admin,auth.authUserId),preview(auth.admin,b.version_id)]);
    if (!conn.can_publish) return officeError(conn.message || "Se necesita reconectar Instagram.",409);
    if (!draft.eligible) return officeError(draft.message || "La versión requiere revisión.",409);
    if (draft.caption !== b.caption || draft.alt_text !== b.alt_text || draft.offer !== (b.offer ?? null) ||
        draft.media_sha256 !== b.media_sha256 || conn.account_id !== b.account_id || conn.owner_id !== b.connection_owner ||
        conn.username !== b.username || conn.connected_at !== b.connected_at) return officeError("La vista previa o la conexión cambió. Vuelve a revisarla.",409);
    const r = await auth.admin.rpc("office_ig_approve",{p_actor:auth.authUserId,p_version_id:b.version_id,p_request_id:b.request_id,
      p_account_id:conn.account_id,p_username:conn.username,p_connection_owner:conn.owner_id,p_caption:draft.caption,p_alt_text:draft.alt_text,
      p_media_sha256:draft.media_sha256,p_scheduled_at:b.scheduled_at,p_time_zone:b.time_zone,p_persisted_account_id:conn.persisted_account_id,p_connected_at:conn.connected_at});
    if (r.error) return rpcError(r.error.message);
    if (!officeUuid(r.data)) return officeError("No se pudo confirmar la autorización.",503);
    if (b.scheduled_at === null || Date.parse(b.scheduled_at) <= Date.now()) kick(auth.admin,r.data);
    return officeJson({ok:true,id:r.data},202);
  } catch (error) { return problem(error); }
}
