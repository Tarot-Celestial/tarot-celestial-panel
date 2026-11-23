import { officeAccess, officeError, officeJson } from "@/lib/server/office-access";
import { InstagramPerformanceError, readOfficeInstagramPerformance } from "@/lib/server/office-instagram-performance";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const fetchCache = "force-no-store";
export const maxDuration = 60;

export async function GET(req: Request) {
  const auth = await officeAccess(req);
  if (!auth.ok) return auth.response;
  try {
    return officeJson({ ok: true, ...await readOfficeInstagramPerformance() });
  } catch (error) {
    const stage = error instanceof InstagramPerformanceError ? error.stage : "report";
    const code = error instanceof InstagramPerformanceError ? error.code : "UNAVAILABLE";
    console.warn("office-instagram-performance", { stage, code });
    const labels = { connection: "la conexión", identity: "la cuenta", media: "las publicaciones", metrics: "las métricas", report: "el informe" };
    return officeError("No se pudo comprobar " + labels[stage] + " de @tarotcelestialof (" + code + ").", code === "META_RATE_LIMIT" ? 429 : 503);
  }
}
