import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { campaignIdentity, CampaignError, campaignResponseError } from "@/lib/server/campaign-auth";
import { campaignCapabilities, processCampaignBatch } from "@/lib/server/client-campaigns";
import { normalizeAudience, normalizeCampaign, UUID } from "@/lib/campaigns";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const json = (data: object) => NextResponse.json({ ok: true, ...data }, { headers: { "Cache-Control": "private, no-store" } });
export async function GET(req: Request) {
  try {
    const { db } = await campaignIdentity(req, "admin");
    const url = new URL(req.url);
    if (url.searchParams.get("view") === "recipients") {
      const { data, error } = await db.rpc("tc_campaign_preview", { a: { mode: "all" }, search_text: (url.searchParams.get("q") || "").slice(0,100), page_offset: Math.max(0, Math.min(100000, Number(url.searchParams.get("offset")) || 0)) });
      if (error) throw error;
      return json({ audience: data });
    }
    const { data, error } = await db.rpc("tc_campaign_overview");
    if (error) throw error;
    return json({ campaigns: data, capabilities: campaignCapabilities() });
  } catch (error) { return campaignResponseError(error); }
}
export async function POST(req: Request) {
  try {
    const { db, uid } = await campaignIdentity(req, "admin");
    const raw = await req.json().catch(() => { throw new CampaignError("La petición no es válida."); });
    const action = raw.action;
    if (action === "preview") {
      let audience; try { audience = normalizeAudience(raw.audience); } catch (e: any) { throw new CampaignError(e.message); }
      const { data, error } = await db.rpc("tc_campaign_preview", { a: audience });
      if (error) throw error;
      return json({ audience: data });
    }
    const id = raw.id || (action === "save" ? randomUUID() : "");
    if (!UUID.test(id)) throw new CampaignError("Identificador de campaña no válido.");
    if (action === "save") {
      let doc; try { doc = normalizeCampaign(raw.campaign); } catch (e: any) { throw new CampaignError(e.message); }
      const { data, error } = await db.rpc("tc_campaign_save", { p_id: id, doc, actor: uid });
      if (error) { if (error.code === "P0001") throw new CampaignError(error.message); throw error; }
      return json({ id: data });
    }
    if (action === "details") {
      const offset = Math.max(0, Math.min(100000, Number(raw.offset) || 0));
      const { data, error, count } = await db.from("tc_client_campaign_deliveries").select("id,channel,state,sent_at,opened_at,error,attempts,crm_clientes(nombre,apellido)", { count: "exact" }).eq("campaign_id", id).order("created_at").order("id").range(offset, offset + 49);
      if (error) throw error;
      return json({ deliveries: data, total: count });
    }
    if (action === "schedule") {
      const time = raw.scheduled_at ? Date.parse(raw.scheduled_at) : Date.now();
      if (!Number.isFinite(time) || (raw.scheduled_at && time < Date.now() - 60000)) throw new CampaignError("Selecciona una fecha futura.");
      const stored = await db.from("tc_client_campaigns").select("channels").eq("id", id).single();
      if (stored.error) throw stored.error;
      const capabilities = campaignCapabilities();
      if (stored.data.channels.includes("push") && !capabilities.push) throw new CampaignError("Faltan las claves VAPID para enviar notificaciones móviles.");
      if (time > Date.now() + 60000 && !capabilities.scheduler) throw new CampaignError("Configura CRON_SECRET en Vercel para programar envíos.");
      const { data, error } = await db.rpc("tc_campaign_schedule", { p_id: id, send_at: new Date(time).toISOString() });
      if (error) { if (error.code === "P0001") throw new CampaignError(error.message); throw error; }
      // Scheduling persists first. Dispatch has its own explicit action so failures cannot lose the campaign.
      return json({ id, deliveries: data });
    }
    if (action === "process") return json(await processCampaignBatch(id));
    if (action === "cancel" || action === "retry") {
      const { error } = await db.rpc("tc_campaign_action", { p_id: id, action });
      if (error) { if (error.code === "P0001") throw new CampaignError(error.message); throw error; }
      return json({ id });
    }
    throw new CampaignError("Acción no válida.");
  } catch (error) { return campaignResponseError(error); }
}
