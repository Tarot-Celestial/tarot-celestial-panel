import { timingSafeEqual } from "node:crypto";
import { getServiceClient } from "@/lib/admin/require-admin";
import { officeJson } from "@/lib/server/office-access";
import { discoverOfficeCapture } from "@/lib/server/office-capture-discovery";
import { allowOfficeDiscovery } from "@/lib/server/office-discovery-policy";
import { runOfficeSocialDispatch, syncOfficeSocialInboxes } from "@/lib/server/office-social-worker";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const expected = Buffer.from("Bearer " + (secret || ""));
  const received = Buffer.from(req.headers.get("authorization") || "");
  if (!secret || received.length !== expected.length || !timingSafeEqual(expected, received)) return officeJson({ ok: false }, 401);
  let stage = "connection";
  try {
    const db = getServiceClient();
    const batch = crypto.randomUUID();
    const policy = await db.rpc("office_autonomy_check", { p_action:"capture_discovery", p_channel:"*",
      p_account:"", p_operation:null, p_reserve:false });
    if (policy.error) throw Error();
    const canDiscover = policy.data === "allow";
    const social = canDiscover ? await syncOfficeSocialInboxes((ch,acct)=>allowOfficeDiscovery(db,ch,acct,batch)).catch(() => []) : [];
    stage = "discovery";
    const discovery = canDiscover ? await discoverOfficeCapture(db,batch) : { whatsapp:{state:"paused"}, database:{processed:0} };
    stage = "dispatch";
    const dispatch = await runOfficeSocialDispatch(db, { limit: 5 });
    const summary = { social, whatsapp: discovery.whatsapp.state, processed: discovery.database.processed, dispatch };
    stage = "save";
    const saved = await db.from("office_capture_settings").update({ last_round_at: new Date().toISOString(), last_round: summary }).eq("id", true);
    if (saved.error) throw Error();
    return officeJson({ ok: true, ...summary });
  } catch {
    console.error("office-capture: round failed", { stage });
    return officeJson({ ok: false, error: "No se pudo completar la ronda de Captación." }, 503);
  }
}
