import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createOfficeContainer, findOfficeReceipt, findRecentExactPost, getOfficeContainerStatus, officeInstagramConnection,
  OfficeInstagramError, readOfficeReceipt, sendOfficeContainer, type OfficeInstagramBinding,
} from "./office-instagram-graph";
import { InstagramDraftError, loadInstagramVersion } from "./office-instagram-media";
import { officeMediaUrl } from "./office-instagram-link";

type Job = {
  id: string; version_id: string; account_id: string; username: string; connection_owner: string;
  connected_at: string; persisted_account_id: string; media_sha256: string; caption: string; alt_text: string;
  status: string; container_id: string | null; external_post_id: string | null; dispatch_started_at: string | null;
  created_at: string; lease_token: string; dispatch_token: string | null;
};
type Receipt = Awaited<ReturnType<typeof readOfficeReceipt>>;
async function transition(db: SupabaseClient, job: Job, next: string, values: { container?: string; media?: string; link?: string | null; error?: string } = {}) {
  const result = await db.rpc("office_ig_transition", { p_id:job.id, p_lease:job.lease_token, p_next:next,
    p_container_id:values.container || null, p_media_id:values.media || null, p_permalink:values.link || null, p_error:values.error || null });
  if (result.error) throw new Error("No se pudo guardar el estado de la publicación.");
  return result.data === true;
}
export async function saveOfficeMetrics(db: SupabaseClient, id: string, receipt: Receipt) {
  const result = await db.rpc("office_ig_metrics", { p_id:id,p_media_id:receipt.id,p_metrics:receipt.metrics,p_permalink:receipt.permalink });
  if (result.error) throw new Error("No se pudieron actualizar las estadísticas.");
}
async function confirm(db: SupabaseClient, job: Job, receipt: Receipt) {
  if (await transition(db,job,"published",{ media:receipt.id,link:receipt.permalink })) await saveOfficeMetrics(db,job.id,receipt);
}
function directions(job: Job): OfficeInstagramBinding {
  return { persisted_account_id:job.persisted_account_id, connected_at:job.connected_at };
}
async function canSend(job: Job) {
  const conn = await officeInstagramConnection();
  if (!conn.can_publish) throw new InstagramDraftError(conn.message || "Meta no autorizó el envío.");
  if (conn.account_id !== job.account_id || conn.persisted_account_id !== job.persisted_account_id ||
      conn.username.toLowerCase() !== job.username.toLowerCase() || Date.parse(conn.connected_at || "") !== Date.parse(job.connected_at) ||
      (conn.owner_id && conn.owner_id !== job.connection_owner)) {
    throw new InstagramDraftError("La conexión o el destino han cambiado. Vuelve a aprobar el envío.");
  }
}

export async function processOfficeInstagram(db: SupabaseClient, id: string | null) {
  if (process.env.VERCEL_ENV !== "production") return;
  const result = await db.rpc("office_ig_claim", { p_id:id });
  if (result.error) throw new Error("No se pudo recuperar la publicación.");
  const job = result.data as Job | null;
  if (!job) return;
  const pin = directions(job);
  let dispatching = false, mediaReturned = false;
  try {
    if (job.status === "verifying") {
      const receipt = job.external_post_id ? await readOfficeReceipt(job.account_id,job.external_post_id,pin) :
        job.container_id ? await findOfficeReceipt(job.account_id,job.container_id,job.caption,
          (job.dispatch_token && job.dispatch_started_at) || job.created_at,pin) : null;
      if (receipt) await confirm(db,job,receipt);
      else await transition(db,job,"verifying",{ error:"Meta todavía no confirmó una publicación inequívoca." });
      return;
    }
    await canSend(job);
    const draft = await loadInstagramVersion(db,job.version_id);
    if (draft.version.status !== "aprobado" || draft.media.sha !== job.media_sha256 || draft.caption !== job.caption || draft.alt_text !== job.alt_text) {
      await transition(db,job,"invalidated",{ error:"El entregable ha cambiado desde la aprobación." }); return;
    }
    let container = job.container_id;
    if (!container) {
      const since = new Date(Date.now() - 7 * 86400000).toISOString();
      const duplicate = await findRecentExactPost(job.account_id,job.caption,since,pin);
      if (duplicate) {
        await transition(db,job,"invalidated",{ error:"Ya hay una publicación reciente con este texto en la cuenta. Revisa el historial antes de preparar otro envío." }); return;
      }
      const ready = await db.rpc("office_autonomy_ig_prepare", { p_id:job.id, p_lease:job.lease_token });
      if (ready.error) throw new Error("No se pudo verificar la política de autonomía.");
      if (ready.data !== true) return;
      container = await createOfficeContainer(job.account_id,officeMediaUrl(job.id,job.media_sha256),job.caption,job.alt_text,draft.media.type,pin);
      if (!await transition(db,job,"container_ready",{ container })) return;
    }
    let status = await getOfficeContainerStatus(job.account_id,container,pin);
    for (let poll = 0; status === "IN_PROGRESS" && poll < 3; poll++) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      status = await getOfficeContainerStatus(job.account_id,container,pin);
    }
    if (status === "IN_PROGRESS") { await transition(db,job,"defer"); return; }
    if (status === "PUBLISHED") { await transition(db,job,"observed_published",{ error:"Meta marcó el contenedor como publicado. Comprobando su identificador." }); return; }
    if (status !== "FINISHED") throw new InstagramDraftError("Meta no pudo procesar el archivo (" + status + ").");
    await canSend(job);
    // This last transactional check fences superseded versions, revoked approvals and expired offers.
    if (!await transition(db,job,"dispatching")) return;
    dispatching = true;
    const media = await sendOfficeContainer(job.account_id,container,pin);
    mediaReturned = true;
    if (!await transition(db,job,"receipt",{ media })) return;
    const receipt = await readOfficeReceipt(job.account_id,media,pin);
    await confirm(db,job,receipt);
  } catch (error) {
    const message = error instanceof OfficeInstagramError || error instanceof InstagramDraftError ? error.message : "No se pudo confirmar el paso de publicación.";
    // After dispatch a timeout, a lost database acknowledgement or a failed receipt read requires reconciliation.
    const denied = !mediaReturned && error instanceof OfficeInstagramError && error.code === "META_PERMISSION" && !error.uncertain;
    const next = job.status === "verifying" || (dispatching && !denied) ? "verifying" : dispatching && denied ? "provider_rejected" : "failed";
    await transition(db,job,next,{ error:message });
  }
}
