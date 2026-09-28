import { NextResponse } from "next/server";
import { campaignIdentity, CampaignError, campaignResponseError } from "@/lib/server/campaign-auth";
import { UUID } from "@/lib/campaigns";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handle(req: Request, id: string, opened: boolean) {
  try {
    const { db, clientId } = await campaignIdentity(req, "client");
    if (!UUID.test(id)) throw new CampaignError("Campaña no encontrada.", 404);
    const deliveryId = new URL(req.url).searchParams.get("delivery");
    let query = db.from("tc_client_campaign_deliveries").select("id,campaign_id").eq("campaign_id", id).eq("client_id", clientId).in("state", ["sent", "processing", "uncertain"]);
    if (deliveryId) { if (!UUID.test(deliveryId)) throw new CampaignError("Aviso no encontrado.", 404); query = query.eq("id", deliveryId); }
    const delivery = await query.order("created_at").limit(1).maybeSingle();
    if (delivery.error) throw delivery.error;
    if (!delivery.data) throw new CampaignError("Esta campaña no está disponible para tu cuenta.", 404);
    const result = await db.from("tc_client_campaigns").select("id,title,message,image_url,action_url,expires_at,status,scheduled_at").eq("id", id).single();
    if (result.error) throw result.error;
    if (result.data.status === "cancelled" || Date.parse(result.data.expires_at) <= Date.now() || Date.parse(result.data.scheduled_at) > Date.now()) throw new CampaignError("Esta promoción ha caducado o se ha retirado.", 410);
    if (opened) {
      const update = await db.from("tc_client_campaign_deliveries").update({ opened_at: new Date().toISOString() }).eq("id", delivery.data.id).is("opened_at", null);
      if (update.error) throw update.error;
      const read = await db.from("cliente_notificaciones").update({ leida: true }).eq("campaign_id", id).eq("cliente_id", clientId);
      if (read.error) throw read.error;
    }
    return NextResponse.json({ ok: true, campaign: result.data }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return campaignResponseError(error); }
}
export const GET = (req: Request, { params }: { params: { id: string } }) => handle(req, params.id, false);
export const POST = (req: Request, { params }: { params: { id: string } }) => handle(req, params.id, true);
