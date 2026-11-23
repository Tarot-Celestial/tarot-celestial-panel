import { officeDepartments } from "@/features/office/catalog";
import type { OfficeDepartment, OfficeSnapshot } from "@/features/office/model";
import { officeAccess, officeDatabaseError, officeError, officeInput, officeJson } from "@/lib/server/office-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 300;

export async function GET(req: Request) {
  try {
    const access = await officeAccess(req);
    if (!access.ok) return access.response;
    const { data, error } = await access.admin.rpc("office_snapshot", { p_user: access.authUserId });
    if (error) return officeDatabaseError(error);
    const snapshot = data as OfficeSnapshot | null;
    if (!snapshot || !Array.isArray(snapshot.departments)) return officeError("No se pudo leer la Oficina.",503);
    const byId = new Map(snapshot.departments.map(d => [d.id,d]));
    const departments: OfficeDepartment[] = [];
    for (const item of officeDepartments) {
      const row = byId.get(item.id);
      if (!row) return officeError("El catálogo de departamentos requiere completar la migración.",503);
      departments.push({ ...row, name: item.name, purpose: item.purpose });
    }
    return officeJson({ ...snapshot, departments, ok: true });
  } catch { return officeError("No se pudo verificar el acceso a la Oficina.",503); }
}

export async function POST(req: Request) {
  try {
    const access = await officeAccess(req);
    if (!access.ok) return access.response;
    const input = await officeInput(req);
    if ("response" in input) return input.response;
    const publication = input.data.action === "create_task" && input.data.instagram_publication !== undefined;
    if (publication && process.env.VERCEL_ENV !== "production") return officeError("Crea el encargo de publicación en la Oficina de producción.",409);
    const operation = publication ? (input.data.file_sha256 ? "office_create_instagram_order_with_file" : "office_create_instagram_order") : "office_apply";
    const { data, error } = await access.admin.rpc(operation, { p_user: access.authUserId, p_input: input.data });
    if (error) return officeDatabaseError(error);
    if (publication && data.run_id) {
      const [{ waitUntil }, { processOfficeRun }] = await Promise.all([import("@vercel/functions"),import("@/lib/server/office-worker")]);
      waitUntil(processOfficeRun(access.admin,data.run_id).catch(() => { console.error("[office-worker] Encargo de publicación pendiente de la ronda."); }));
      return officeJson({ ok:true, id:data.id, run_id:data.run_id },202);
    }
    return officeJson({ ok: true, id: data.id });
  } catch { return officeError("No se pudo confirmar el cambio. Actualiza la Oficina y revisa el historial.",503); }
}
