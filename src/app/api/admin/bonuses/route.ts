import { GET as canonicalGET, POST as canonicalPOST } from "../../bonuses/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

// Alias de compatibilidad. La implementación real vive en /api/bonuses para
// que Administración y Tarotista compartan exactamente el mismo controlador.
export async function GET(req: Request) {
  return canonicalGET(req);
}

export async function POST(req: Request) {
  return canonicalPOST(req);
}
