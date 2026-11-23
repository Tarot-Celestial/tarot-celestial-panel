import { officeAccess, officeError, officeJson } from "@/lib/server/office-access";
import { readOfficeInstagramPerformance } from "@/lib/server/office-instagram-performance";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await officeAccess(req);
  if (!auth.ok) return auth.response;
  try {
    return officeJson({ ok: true, ...await readOfficeInstagramPerformance() });
  } catch {
    return officeError("No se pudieron comprobar las publicaciones de @tarotcelestialof en Instagram.", 503);
  }
}
