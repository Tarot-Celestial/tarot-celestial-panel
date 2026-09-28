import { NextResponse } from "next/server";
import { campaignIdentity, CampaignError, campaignResponseError } from "@/lib/server/campaign-auth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  try {
    const { db, clientId } = await campaignIdentity(req, "client");
    const { data, error } = await db.from("crm_client_notification_preferences").select("settings").eq("client_id", clientId).maybeSingle();
    if (error) throw error;
    return NextResponse.json({ ok: true, enabled: data?.settings?.promotions?.enabled === true }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return campaignResponseError(error); }
}
export async function POST(req: Request) {
  try {
    const { db, clientId, uid } = await campaignIdentity(req, "client");
    const body = await req.json();
    if (typeof body.enabled !== "boolean") throw new CampaignError("Indica si deseas recibir promociones.");
    const { error } = await db.rpc("tc_campaign_preference", { p_client: clientId, actor: uid, enabled: body.enabled });
    if (error) throw error;
    return NextResponse.json({ ok: true, enabled: body.enabled });
  } catch (error) { return campaignResponseError(error); }
}
