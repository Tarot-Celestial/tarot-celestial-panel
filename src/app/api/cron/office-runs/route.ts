import { timingSafeEqual } from "node:crypto";
import { getServiceClient } from "@/lib/admin/require-admin";
import { processOfficeRun } from "@/lib/server/office-worker";
import { officeJson } from "@/lib/server/office-access";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const expected = Buffer.from("Bearer " + (secret || ""));
  const received = Buffer.from(req.headers.get("authorization") || "");
  if (!secret || received.length !== expected.length || !timingSafeEqual(expected, received)) return officeJson({ ok: false }, 401);
  try { return officeJson({ ok: true, ...await processOfficeRun(getServiceClient(), null) }); }
  catch { return officeJson({ ok: false, error: "No se pudo recuperar la ejecución." }, 503); }
}
