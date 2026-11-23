import type { SupabaseClient } from "@supabase/supabase-js";
import { officeInstagramConnection } from "./office-instagram-graph";
import { InstagramDraftError, loadInstagramVersion } from "./office-instagram-media";
import { processOfficeInstagram } from "./office-instagram-worker";

// The run holds the administrator's explicit order. Only its original output
// can be approved, even if another worker edits the task during these reads.
export async function reviewAtlasPublication(db: SupabaseClient, runId: string | null) {
  if (process.env.VERCEL_ENV !== "production") return;
  const next = await db.rpc("office_atlas_review_candidate", { p_run_id: runId });
  if (next.error) throw new Error("No se pudo consultar el encargo de publicación.");
  if (!next.data) return;
  const { id, version_id, format } = next.data;
  let review: Record<string,string>;
  try {
    const draft = await loadInstagramVersion(db,version_id);
    if (draft.version.status !== "pendiente" || draft.media.type !== (format === "reel" ? "video/mp4" : "image/jpeg")) {
      throw new InstagramDraftError("El archivo o la decisión editorial cambió desde el encargo.");
    }
    const connection = await officeInstagramConnection();
    // A provider outage is retryable. No approval is written until the live
    // destination, its permission and the publication quota have been verified.
    if (!connection.can_publish || !connection.connected_at) {
      review = { retry: connection.message || "Atlas espera la confirmación de la conexión de Instagram." };
    } else {
      if (connection.username !== "tarotcelestialof") throw new InstagramDraftError("El destino verificado difiere de @tarotcelestialof.");
      review = { username: connection.username, account_id: connection.account_id, persisted_account_id: connection.persisted_account_id,
        connected_at: connection.connected_at, caption: draft.caption, alt_text: draft.alt_text, media_type: draft.media.type, media_sha256: draft.media.sha };
    }
  } catch (error) {
    if (!(error instanceof InstagramDraftError)) throw error;
    review = { reason: error.message };
  }
  const result = await db.rpc("office_atlas_decide_publication", { p_run_id: id, p_version_id: version_id, p_review: review });
  if (result.error) throw new Error("No se pudo registrar la revisión de Atlas.");
  if (result.data) await processOfficeInstagram(db,result.data);
}
