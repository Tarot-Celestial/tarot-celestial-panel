import { officeAccess, officeError, officeHeaders, officeUuid } from "@/lib/server/office-access";
import { loadInstagramVersion } from "@/lib/server/office-instagram-media";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET(req: Request) {
  try {
    const auth = await officeAccess(req);
    if (!auth.ok) return auth.response;
    const p = new URL(req.url).searchParams, id = p.get("version_id");
    if (!officeUuid(id)) return officeError("Selecciona una versión.",400);
    const { media } = await loadInstagramVersion(auth.admin, id);
    if (media.sha !== p.get("sha")) return officeError("El archivo cambió. Actualiza la vista previa.",409);
    return new Response(new Uint8Array(media.bytes), { headers: { ...officeHeaders, "Content-Type": media.type } });
  } catch { return officeError("No se pudo preparar la vista previa.",422); }
}
