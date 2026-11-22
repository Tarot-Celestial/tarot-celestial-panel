import { timingSafeEqual } from "node:crypto";
import { getServiceClient } from "@/lib/admin/require-admin";
import { officeJson } from "@/lib/server/office-access";
import { discoverOfficeCapture } from "@/lib/server/office-capture-discovery";
import { runOfficeSocialDispatch, syncOfficeSocialInboxes } from "@/lib/server/office-social-worker";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const expected = Buffer.from("Bearer " + (secret || ""));
  const received = Buffer.from(req.headers.get("authorization") || "");
  if (!secret || received.length !== expected.length || !timingSafeEqual(expected, received)) return officeJson({ ok: false }, 401);
  try {
    const db = getServiceClient();
    const social = await syncOfficeSocialInboxes().catch(() => []);
    const discovery = await discoverOfficeCapture(db);
    const dispatch = await runOfficeSocialDispatch(db, { limit: 5 });
    const summary = { social, whatsapp: discovery.whatsapp.state, processed: discovery.database.processed, dispatch };
    const saved = await db.from("office_capture_settings").update({ last_round_at: new Date().toISOString(), last_round: summary }).eq("id", true);
    if (saved.error) throw Error();
    return officeJson({ ok: true, ...summary });
  } catch { return officeJson({ ok: false, error: "No se pudo completar la ronda de Captación." }, 503); }
}
