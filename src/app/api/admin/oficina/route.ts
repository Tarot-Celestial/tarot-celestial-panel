import { officeDepartments } from "@/features/office/catalog";
import type { OfficeDepartment, OfficeSnapshot } from "@/features/office/model";
import { officeAccess, officeDatabaseError, officeError, officeInput, officeJson } from "@/lib/server/office-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

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
    const { data, error } = await access.admin.rpc("office_apply", { p_user: access.authUserId, p_input: input.data });
    if (error) return officeDatabaseError(error);
    return officeJson({ ok: true, id: data.id });
  } catch { return officeError("No se pudo confirmar el cambio. Actualiza la Oficina y revisa el historial.",503); }
}
