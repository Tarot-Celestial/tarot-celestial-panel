import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getAuthUserFromRequest } from "@/lib/server/auth-fast";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHANNELS = new Set(["whatsapp", "phone", "email", "sms"]);
const FREQUENCIES = new Set(["daily", "every_2_days", "weekly", "every_15_days", "monthly", "purchase_only"]);
const TIME_SLOTS = new Set(["morning", "midday", "afternoon", "evening", "any"]);
const DAYS = new Set(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]);

const DEFAULTS = {
  preferred_channel: "whatsapp",
  likes_follow_up: true,
  follow_up_frequency: "weekly",
  preferred_time_slot: "any",
  preferred_days: [] as string[],
  weekly_summary: false,
};

function env(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

function adminClient() {
  return createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });
}

async function authenticatedWorker(req: Request) {
  const { data, error } = getAuthUserFromRequest(req);
  if (error || !data.user?.id) return null;

  const admin = adminClient();
  const { data: worker, error: workerError } = await admin
    .from("workers")
    .select("id, role, user_id")
    .eq("user_id", data.user.id)
    .maybeSingle();

  if (workerError) throw workerError;
  const role = String(worker?.role || "").toLowerCase();
  if (!worker || !["admin", "central", "ceo", "supervisor"].includes(role)) return null;
  return worker;
}

function clientIdFrom(req: Request) {
  return String(new URL(req.url).searchParams.get("client_id") || "").trim();
}

function normalizePayload(body: any) {
  const preferredChannel = String(body?.preferred_channel || "").trim().toLowerCase();
  const frequency = String(body?.follow_up_frequency || "").trim().toLowerCase();
  const timeSlot = String(body?.preferred_time_slot || "").trim().toLowerCase();
  const normalizedDays: string[] = Array.isArray(body?.preferred_days)
    ? body.preferred_days.map((value: unknown) => String(value || "").trim().toLowerCase())
    : [];
  const days = Array.from(new Set<string>(normalizedDays)).filter((day) => DAYS.has(day));

  if (!CHANNELS.has(preferredChannel)) throw new Error("INVALID_PREFERRED_CHANNEL");
  if (!FREQUENCIES.has(frequency)) throw new Error("INVALID_FOLLOW_UP_FREQUENCY");
  if (!TIME_SLOTS.has(timeSlot)) throw new Error("INVALID_PREFERRED_TIME_SLOT");

  return {
    preferred_channel: preferredChannel,
    likes_follow_up: Boolean(body?.likes_follow_up),
    follow_up_frequency: frequency,
    preferred_time_slot: timeSlot,
    preferred_days: days,
    weekly_summary: Boolean(body?.weekly_summary),
  };
}

async function clientBusiness(admin: ReturnType<typeof adminClient>, clientId: string) {
  const { data, error } = await admin
    .from("crm_clientes")
    .select("id, origen")
    .eq("id", clientId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { id: String(data.id), business: String(data.origen || "celestial").trim().toLowerCase() || "celestial" };
}

export async function GET(req: Request) {
  try {
    const worker = await authenticatedWorker(req);
    if (!worker) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });

    const clientId = clientIdFrom(req);
    if (!clientId) return NextResponse.json({ ok: false, error: "CLIENT_ID_REQUIRED" }, { status: 400 });

    const admin = adminClient();
    const client = await clientBusiness(admin, clientId);
    if (!client) return NextResponse.json({ ok: false, error: "CLIENT_NOT_FOUND" }, { status: 404 });

    const { data, error } = await admin
      .from("crm_client_communication_preferences")
      .select("client_id, business, preferred_channel, likes_follow_up, follow_up_frequency, preferred_time_slot, preferred_days, weekly_summary, updated_at")
      .eq("client_id", clientId)
      .maybeSingle();

    if (error) throw error;

    return NextResponse.json({
      ok: true,
      preferences: data || { client_id: clientId, business: client.business, ...DEFAULTS, updated_at: null },
    }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error: any) {
    console.error("[client-preferences:get]", {
      code: error?.code,
      message: error?.message,
      details: error?.details,
      hint: error?.hint,
    });
    return NextResponse.json({ ok: false, error: error?.message || "PREFERENCES_LOAD_FAILED" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const worker = await authenticatedWorker(req);
    if (!worker) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });

    const clientId = clientIdFrom(req);
    if (!clientId) return NextResponse.json({ ok: false, error: "CLIENT_ID_REQUIRED" }, { status: 400 });

    const body = await req.json().catch(() => null);
    const normalized = normalizePayload(body);
    const admin = adminClient();
    const client = await clientBusiness(admin, clientId);
    if (!client) return NextResponse.json({ ok: false, error: "CLIENT_NOT_FOUND" }, { status: 404 });

    const { data, error } = await admin
      .from("crm_client_communication_preferences")
      .upsert({
        client_id: clientId,
        business: client.business,
        ...normalized,
        updated_by_user_id: worker.user_id,
        updated_at: new Date().toISOString(),
      }, { onConflict: "client_id" })
      .select("client_id, business, preferred_channel, likes_follow_up, follow_up_frequency, preferred_time_slot, preferred_days, weekly_summary, updated_at")
      .single();

    if (error) throw error;

    return NextResponse.json({ ok: true, preferences: data }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error: any) {
    console.error("[client-preferences:put]", {
      code: error?.code,
      message: error?.message,
      details: error?.details,
      hint: error?.hint,
    });
    const status = String(error?.message || "").startsWith("INVALID_") ? 400 : 500;
    return NextResponse.json({ ok: false, error: error?.message || "PREFERENCES_SAVE_FAILED" }, { status });
  }
}
