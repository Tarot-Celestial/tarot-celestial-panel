import type { SupabaseClient } from "@supabase/supabase-js";
import { renderOfficeArtwork } from "./office-artwork";
import { checkCreativeAutonomy, officeArtworkAlt, officeCreativeStep, OfficeCreativeError, officePublicCaption, validateOfficeSources } from "./office-creative";

type CreativeCopy = { headline: string; lines: string[]; caption: string };
type Review = { id: string; deliverable_id: string; version: number; title: string; body: string; review_note: string | null };
type Run = {
  id: string; task_id: string; step: number; lease_token: string; revision_id: string | null;
  outputs: { "0"?: { brief: string }; "1"?: CreativeCopy }; source_snapshot?: unknown;
};

const revisionFields = "id,task_id,deliverable_id,version,title,body,review_note,status";
async function loadInputs(db: SupabaseClient, run: Run) {
  const [task, version] = await Promise.all([
    db.from("office_tasks").select("id,revision,department_id,objective,expected_delivery,time_zone,status").eq("id", run.task_id).single(),
    run.revision_id ? db.from("office_versions").select(revisionFields).eq("id", run.revision_id).eq("task_id", run.task_id).single() : null,
  ]);
  if (task.error || version?.error) throw new Error("No se pudo recuperar el encargo o la versión revisada.");
  return { task: task.data, revision: (version?.data || null) as Review | null };
}

async function makeDelivery(db: SupabaseClient, run: Run, task: Awaited<ReturnType<typeof loadInputs>>["task"], revision: Review | null) {
  const brief = run.outputs["0"];
  const copy = run.outputs["1"];
  const caption = copy?.caption && officePublicCaption(copy.caption);
  if (!brief || !copy || !caption) throw new Error("Faltan el briefing o los textos de Marketing.");
  const bytes = await renderOfficeArtwork(copy);
  const alt = officeArtworkAlt(copy, bytes.readUInt32BE(16), bytes.readUInt32BE(20));
  await validateOfficeSources(db, task, brief);
  const filename = "tarot-celestial-instagram-v" + (1 + (revision?.version || 0)) + ".png";
  const body = [caption, "Texto de la imagen", copy.headline, ...copy.lines, "Texto alternativo", alt].join("\n\n");
  return {
    title: copy.headline, body, file_name: filename, file_type: "image/png", file_base64: bytes.toString("base64"),
    deliverable_id: revision?.deliverable_id || null, base_version: revision?.version || 0,
  };
}

// Each lease covers one step. A new invocation can resume at the next committed step.
// A failed database commit after a provider call is left for lease reconciliation.
export async function processOfficeRun(db: SupabaseClient, requestedId: string | null) {
  let runId = requestedId;
  let finished = 0;
  for (let n = 0; n < 3; n++) {
    const claim = await db.rpc("office_run_claim", { p_run_id: runId });
    if (claim.error) throw new Error("No se pudo reclamar el encargo.");
    const run = claim.data as Run | null;
    if (!run) break;
    runId = run.id;
    let status = "ok", error: string | null = null, output: object = {}, usage: object = {};
    let delivery: Awaited<ReturnType<typeof makeDelivery>> | null = null;
    try {
      const { task, revision } = await loadInputs(db, run);
      if (task.department_id !== "marketing") throw new OfficeCreativeError("waiting_input", "El encargo debe pertenecer a Marketing.");
      if (run.step === 2) {
        await checkCreativeAutonomy(db,run);
        delivery = await makeDelivery(db, run, task, revision);
        output = { title: delivery.title, format: "PNG", width: 1080, height: 1350, renderer: "oficina-celestial/1" };
      } else {
        const result = await officeCreativeStep({ db, run, task, revision });
        output = result.output;
        usage = result.usage;
      }
    } catch (e) {
      if (e instanceof OfficeCreativeError) {
        status = e.status;
        error = e.message;
        if ("usage" in e && e.usage && typeof e.usage === "object") usage = e.usage;
      } else {
        status = "failed";
        error = run.step === 2 ? "Contenido no pudo preparar la pieza privada. Revisa el formato del texto y los activos de marca." :
          "No se pudieron cargar los datos del encargo.";
      }
    }
    const saved = await db.rpc("office_run_finish_step", {
      p_run_id: run.id, p_lease_token: run.lease_token, p_status: status,
      p_output: output, p_usage: usage, p_error: error, p_delivery: delivery,
    });
    if (saved.error) throw new Error("No se pudo confirmar el paso en la Oficina.");
    if (!saved.data) break;
    finished++;
    if (saved.data.status !== "queued" || status !== "ok" || run.step === 2) break;
  }
  return { finished };
}
