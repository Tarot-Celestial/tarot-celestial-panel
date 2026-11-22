import { officeAccess, officeDatabaseError, officeError, officeHeaders, officeUuid } from "@/lib/server/office-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  try {
    const access = await officeAccess(req);
    if (!access.ok) return access.response;
    const id = new URL(req.url).searchParams.get("id");
    if (!officeUuid(id)) return officeError("Selecciona una versión válida.",400);
    const { data,error } = await access.admin.rpc("office_file",{ p_user: access.authUserId, p_version: id });
    if (error) return officeDatabaseError(error);
    if (!data) return officeError("Esta versión no tiene un archivo disponible.",404);
    const name = encodeURIComponent(data.name).replace(/['()*]/g, char => "%" + char.charCodeAt(0).toString(16));
    return new Response(new Uint8Array(Buffer.from(data.base64,"base64")), {
      headers: { ...officeHeaders, "Content-Type": data.type, "Content-Disposition": "attachment; filename*=UTF-8''" + name },
    });
  } catch { return officeError("No se pudo descargar el archivo de la Oficina.",503); }
}
