import webpush from "web-push";
import { createClient } from "@supabase/supabase-js";

type PushSubscriptionRow = {
  id?: string;
  cliente_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent?: string | null;
};

function getEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

let configured = false;

export function getPushAdmin() {
  return createClient(getEnv("NEXT_PUBLIC_SUPABASE_URL"), getEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export function ensureWebPushConfigured() {
  if (configured) return;
  webpush.setVapidDetails(
    getEnv("VAPID_SUBJECT"),
    getEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY"),
    getEnv("VAPID_PRIVATE_KEY")
  );
  configured = true;
}

export async function sendPushToSubscriptions(
  subscriptions: PushSubscriptionRow[],
  payload: { title: string; body: string; url?: string; tag?: string; icon?: string }
) {
  ensureWebPushConfigured();
  const admin = getPushAdmin();

  const settled = await Promise.allSettled(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: {
              p256dh: sub.p256dh,
              auth: sub.auth,
            },
          },
          JSON.stringify({
            title: payload.title,
            body: payload.body,
            url: payload.url || "/cliente/dashboard",
            tag: payload.tag || "tarot-celestial",
            icon: payload.icon || "/Nuevo-logo-tarot.png",
          })
        );
        return { ok: true };
      } catch (error: any) {
        const statusCode = Number(error?.statusCode || error?.status || 0);
        if (statusCode === 404 || statusCode === 410) {
          await admin.from("cliente_push_subscriptions").delete().eq("endpoint", sub.endpoint);
        }
        return { ok: false, statusCode, message: error?.message || "PUSH_SEND_ERROR" };
      }
    })
  );

  const sent = settled.filter((item) => item.status === "fulfilled" && item.value?.ok).length;
  const failed = settled.length - sent;
  return { sent, failed };
}

export async function getClientPushSubscriptions(clienteId: string) {
  const admin = getPushAdmin();
  const { data, error } = await admin
    .from("cliente_push_subscriptions")
    .select("id, cliente_id, endpoint, p256dh, auth, user_agent")
    .eq("cliente_id", clienteId);

  if (error) throw error;
  return (data || []) as PushSubscriptionRow[];
}
