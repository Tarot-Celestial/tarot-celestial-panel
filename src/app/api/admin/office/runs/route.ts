import { waitUntil } from "@vercel/functions";
import { officeAccess, officeDatabaseError, officeError, officeJson, officeUuid } from "@/lib/server/office-access";
import { processOfficeRun } from "@/lib/server/office-worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: Request) {
  try {
    const auth = await officeAccess(req);
    if (!auth.ok) return auth.response;
    const task = new URL(req.url).searchParams.get("task_id");
    if (!officeUuid(task)) return officeError("Selecciona un encargo de la Oficina.", 400);
    const rows = await auth.admin.from("office_runs")
      .select("id,task_id,step,status,outputs,last_error,created_at,updated_at,usage,revision_id,result_version_id,instagram_publication,atlas_review_status,atlas_review_note,atlas_post_id,delegated_by:actor_id")
      .eq("task_id", task).order("created_at", { ascending: false }).limit(20);
    if (rows.error) return officeDatabaseError(rows.error);
    return officeJson({ runs: rows.data });
  } catch { return officeError("No se pudo consultar la ejecución.", 503); }
}

export async function POST(req: Request) {
  try {
    const auth = await officeAccess(req);
    if (!auth.ok) return auth.response;
    const body = await req.json().catch(() => null);
    if (body?.action === "resolve" && officeUuid(body.run_id)) {
      const note = typeof body.note === "string" ? body.note.trim() : "";
      if (!note || note.length > 2000) return officeError("Registra el resultado de la comprobación para cerrar el intento.", 400);
      const result = await auth.admin.rpc("office_run_resolve", { p_actor: auth.authUserId, p_run_id: body.run_id, p_note: note });
      return result.error ? officeDatabaseError(result.error) : officeJson({ ok: true, id: body.run_id });
    }
    if (body?.action === "cancel" && officeUuid(body.run_id)) {
      const result = await auth.admin.rpc("office_run_cancel", { p_actor: auth.authUserId, p_run_id: body.run_id });
      return result.error ? officeDatabaseError(result.error) : officeJson({ ok: true, id: body.run_id });
    }
    if (body?.action !== "start" || !officeUuid(body.task_id) || !officeUuid(body.request_id) ||
        (body.revision_id != null && !officeUuid(body.revision_id))) return officeError("Revisa el encargo y la versión seleccionada.", 400);
    const task = await auth.admin.from("office_tasks").select("department_id").eq("id", body.task_id).maybeSingle();
    if (task.error) return officeDatabaseError(task.error);
    if (!task.data) return officeError("El encargo ya no está disponible.", 404);
    if (task.data.department_id !== "marketing") return officeError("Selecciona un encargo del departamento de Marketing.", 400);
    const result = await auth.admin.rpc("office_run_enqueue", { p_actor: auth.authUserId, p_task_id: body.task_id,
      p_request_id: body.request_id, p_revision_id: body.revision_id || null });
    if (result.error) return officeDatabaseError(result.error);
    if (!officeUuid(result.data)) return officeError("No se pudo confirmar la ejecución.", 503);
    waitUntil(processOfficeRun(auth.admin, result.data).catch(() => { console.error("[office-worker] No se confirmó el paso. El planificador revisará la ejecución."); }));
    return officeJson({ ok: true, id: result.data }, 202);
  } catch { return officeError("No se pudo confirmar el encargo. Consulta su estado antes de reintentar.", 503); }
}
