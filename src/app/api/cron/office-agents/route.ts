import { timingSafeEqual } from "node:crypto";
import { getServiceClient } from "@/lib/admin/require-admin";
import { officeJson } from "@/lib/server/office-access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 90;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const expected = Buffer.from("Bearer " + (secret || ""));
  const received = Buffer.from(req.headers.get("authorization") || "");
  if (!secret || received.length !== expected.length || !timingSafeEqual(expected, received)) return officeJson({ ok: false }, 401);
  try {
    const result = await getServiceClient().rpc("office_agent_round");
    if (result.error) return officeJson({ ok: false, error: "No se pudo completar la ronda de la Oficina." }, 503);
    return officeJson({ ok: true, ...result.data });
  } catch {
    return officeJson({ ok: false, error: "La ronda de la Oficina no está disponible." }, 503);
  }
}
