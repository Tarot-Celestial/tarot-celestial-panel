import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendPushToSubscriptions } from "@/lib/server/web-push";

export function campaignCapabilities() {
  return { push: Boolean(process.env.VAPID_SUBJECT && process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY), scheduler: Boolean(process.env.CRON_SECRET), preview: process.env.VERCEL_ENV === "preview", whatsapp: false };
}
export async function processCampaignBatch(campaignId?: string) {
  const db = supabaseAdmin();
  const { data: jobs, error } = await db.rpc("tc_campaign_claim", { batch_size: 30, only_campaign: campaignId || null });
  if (error) throw error;
  // Five requests at a time, bounded batch and timeouts keep the worker within its runtime.
  const outcomes: { id: string; ok: boolean }[] = [];
  const accountChecks = new Map<string, Promise<boolean>>();
  const activeAccount = (clientId: string) => {
    if (!accountChecks.has(clientId)) accountChecks.set(clientId, (async () => {
      const client = await db.from("crm_clientes").select("auth_user_id").eq("id",clientId).maybeSingle();
      if (client.error) throw client.error;
      if (!client.data?.auth_user_id) return false;
      // Auth owns account status; do not grant database access to its internal user table.
      const account = await db.auth.admin.getUserById(client.data.auth_user_id);
      if (account.error) { if (account.error.status === 404) return false; throw account.error; }
      const until = (account.data.user as any)?.banned_until;
      return Boolean(account.data.user) && (!until || Date.parse(until) <= Date.now());
    })());
    return accountChecks.get(clientId)!;
  };
  for (let offset = 0; offset < (jobs || []).length; offset += 5) {
    const batch = await Promise.all((jobs || []).slice(offset, offset + 5).map(async (job: any) => {
      try {
        if (!await activeAccount(job.client_id)) {
          const skipped = await db.from("tc_client_campaign_deliveries").update({state:"skipped",error:"Cuenta no disponible."}).eq("id",job.id).eq("attempt_token",job.attempt_token).eq("state","processing");
          if(skipped.error) throw skipped.error;
          return {id:job.id,ok:true};
        }
        const prepared = await db.rpc("tc_campaign_prepare", { delivery_id: job.id, token: job.attempt_token });
        if (prepared.error) throw prepared.error;
        if (!prepared.data) return { id: job.id, ok: true }; // Panel committed atomically, or consent/expiry skipped.
        const campaign = prepared.data;
        const subscription = await db.from("cliente_push_subscriptions").select("*").eq("id", job.target_key).eq("cliente_id", job.client_id).maybeSingle();
        if (subscription.error) throw subscription.error;
        let state = "skipped", message: string | null = "El dispositivo ya no está suscrito.";
        if (subscription.data) {
          if (!campaignCapabilities().push) { state = "failed"; message = "Falta la configuración push del servidor."; }
          else {
            const result = await sendPushToSubscriptions([subscription.data], {
              title: campaign.title, body: campaign.message.slice(0,240), image: campaign.image_url || undefined,
              url: `/cliente/campanas/${campaign.id}?delivery=${job.id}`, tag: `campaign-${campaign.id}`,
              expiresAt: campaign.expires_at,
            });
            const failure = result.results[0];
            state = result.sent ? "sent" : failure?.statusCode >= 400 && failure?.statusCode < 500 && failure?.statusCode !== 408 ? "failed" : "uncertain";
            message = result.sent ? null : state === "uncertain" ? "Sin confirmación del proveedor. No se reenvía automáticamente." : `Push rechazado (${failure?.statusCode || 0}).`;
          }
        }
        const updated = await db.from("tc_client_campaign_deliveries").update({ state, error: message, sent_at: state === "sent" ? new Date().toISOString() : null }).eq("id", job.id).eq("attempt_token", job.attempt_token).eq("state", "processing");
        if (updated.error) throw updated.error;
        return { id: job.id, ok: true };
      } catch (error: any) {
        // Leave the lease intact on an uncertain write. A later worker records uncertainty, never blindly resends.
        console.error("campaign-delivery", job.id, error?.code || error?.message);
        return { id: job.id, ok: false };
      }
    }));
    outcomes.push(...batch);
  }
  const finished = await db.rpc("tc_campaign_finish");
  if (finished.error) throw finished.error;
  return { processed: outcomes.length, errors: outcomes.filter(o => !o.ok).length };
}
