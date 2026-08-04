import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getAuthUserFromRequest } from "@/lib/server/auth-fast";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHANNELS = new Set(["whatsapp", "phone", "email", "sms"]);
const FREQUENCIES = new Set(["daily", "every_2_days", "weekly", "every_15_days", "monthly", "purchase_only"]);
const TIME_SLOTS = new Set(["morning", "midday", "afternoon", "evening", "any"]);
const DAYS = new Set(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]);
const NOTIFICATION_TIMINGS = new Set([
  "immediate",
  "30_minutes_before",
  "1_hour_before",
  "24_hours_before",
  "same_day",
  "day_before",
  "according_to_preferences",
  "morning_0900",
  "afternoon_1700",
  "custom",
]);
const NOTIFICATION_KEYS = [
  "promotions",
  "appointment_reminders",
  "personalized_followups",
  "new_content",
  "birthday_offer",
  "important_updates",
] as const;

type NotificationKey = (typeof NOTIFICATION_KEYS)[number];

type NotificationTiming = {
  enabled: boolean;
  timing: string;
};

type NotificationSettings = Record<NotificationKey, NotificationTiming>;

type PreferencesRequestBody = {
  preferred_channel?: unknown;
  likes_follow_up?: unknown;
  follow_up_frequency?: unknown;
  preferred_time_slot?: unknown;
  preferred_days?: unknown;
  weekly_summary?: unknown;
  notifications?: unknown;
  custom_schedules?: unknown;
};

type RawNotificationEntry = {
  enabled?: unknown;
  timing?: unknown;
};

type RawSchedule = {
  id?: unknown;
  name?: unknown;
  time?: unknown;
  color?: unknown;
  days?: unknown;
  enabled?: unknown;
};

type NormalizedSchedule = {
  id: string | null;
  name: string;
  time: string;
  days: string[];
  enabled: boolean;
  color: string;
  sort_order: number;
};

type LoadedScheduleRow = {
  id: unknown;
  name: unknown;
  schedule_time: unknown;
  preferred_days: unknown;
  enabled: unknown;
  color: unknown;
  updated_at: unknown;
};

type ErrorDetails = {
  code?: unknown;
  message?: unknown;
  details?: unknown;
  hint?: unknown;
};

const DEFAULTS = {
  preferred_channel: "whatsapp",
  likes_follow_up: true,
  follow_up_frequency: "weekly",
  preferred_time_slot: "any",
  preferred_days: [] as string[],
  weekly_summary: false,
};

const NOTIFICATION_DEFAULTS = Object.fromEntries(
  NOTIFICATION_KEYS.map((key) => [key, { enabled: false, timing: "according_to_preferences" }]),
) as NotificationSettings;

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

function normalizeCommunicationPayload(body: PreferencesRequestBody) {
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

function normalizeNotifications(body: PreferencesRequestBody): NotificationSettings {
  const incoming = body.notifications && typeof body.notifications === "object"
    ? body.notifications as Partial<Record<NotificationKey, RawNotificationEntry>>
    : {};
  return Object.fromEntries(NOTIFICATION_KEYS.map((key) => {
    const entry: RawNotificationEntry = incoming[key] || {};
    const timing = String(entry.timing || "according_to_preferences").trim().toLowerCase();
    if (!NOTIFICATION_TIMINGS.has(timing)) throw new Error(`INVALID_NOTIFICATION_TIMING_${key.toUpperCase()}`);
    return [key, { enabled: Boolean(entry.enabled), timing }];
  })) as NotificationSettings;
}

function normalizeSchedules(body: PreferencesRequestBody): NormalizedSchedule[] {
  const schedules: RawSchedule[] = Array.isArray(body.custom_schedules)
    ? body.custom_schedules.filter((item): item is RawSchedule => Boolean(item) && typeof item === "object")
    : [];
  return schedules.map((raw: RawSchedule, index: number): NormalizedSchedule => {
    const name = String(raw?.name || "").trim();
    const time = String(raw?.time || "").trim();
    const color = String(raw?.color || "#9b6cff").trim();
    const days = Array.from(new Set<string>(Array.isArray(raw?.days)
      ? raw.days.map((value: unknown) => String(value || "").trim().toLowerCase())
      : [])).filter((day) => DAYS.has(day));

    if (!name || name.length > 80) throw new Error(`INVALID_SCHEDULE_NAME_${index}`);
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error(`INVALID_SCHEDULE_TIME_${index}`);
    if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error(`INVALID_SCHEDULE_COLOR_${index}`);
    if (days.length === 0) throw new Error(`INVALID_SCHEDULE_DAYS_${index}`);

    return {
      id: raw?.id ? String(raw.id) : null,
      name,
      time,
      days,
      enabled: raw?.enabled !== false,
      color: color.toLowerCase(),
      sort_order: index,
    };
  });
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

async function loadAll(admin: ReturnType<typeof adminClient>, clientId: string, business: string) {
  const [communicationResult, notificationResult, schedulesResult] = await Promise.all([
    admin
      .from("crm_client_communication_preferences")
      .select("client_id, business, preferred_channel, likes_follow_up, follow_up_frequency, preferred_time_slot, preferred_days, weekly_summary, updated_at")
      .eq("client_id", clientId)
      .maybeSingle(),
    admin
      .from("crm_client_notification_preferences")
      .select("client_id, business, settings, updated_at")
      .eq("client_id", clientId)
      .maybeSingle(),
    admin
      .from("crm_client_notification_schedules")
      .select("id, client_id, business, name, schedule_time, preferred_days, enabled, color, sort_order, updated_at")
      .eq("client_id", clientId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
  ]);

  if (communicationResult.error) throw communicationResult.error;
  if (notificationResult.error) throw notificationResult.error;
  if (schedulesResult.error) throw schedulesResult.error;

  const settings = notificationResult.data?.settings && typeof notificationResult.data.settings === "object"
    ? notificationResult.data.settings as Partial<Record<NotificationKey, RawNotificationEntry>>
    : {};

  return {
    preferences: communicationResult.data || { client_id: clientId, business, ...DEFAULTS, updated_at: null },
    notifications: Object.fromEntries(NOTIFICATION_KEYS.map((key) => {
      const setting = settings[key];
      const timing = String(setting?.timing ?? "").trim().toLowerCase();

      return [
        key,
        {
          enabled: Boolean(setting?.enabled ?? NOTIFICATION_DEFAULTS[key].enabled),
          timing: NOTIFICATION_TIMINGS.has(timing)
            ? timing
            : NOTIFICATION_DEFAULTS[key].timing,
        },
      ];
    })) as NotificationSettings,
    custom_schedules: ((schedulesResult.data || []) as LoadedScheduleRow[]).map((schedule: LoadedScheduleRow) => ({
      id: String(schedule.id),
      name: String(schedule.name || ""),
      time: String(schedule.schedule_time || "").slice(0, 5),
      days: Array.isArray(schedule.preferred_days) ? schedule.preferred_days : [],
      enabled: Boolean(schedule.enabled),
      color: String(schedule.color || "#9b6cff"),
      updated_at: schedule.updated_at,
    })),
    notifications_updated_at: notificationResult.data?.updated_at || null,
  };
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

    const data = await loadAll(admin, clientId, client.business);
    return NextResponse.json({ ok: true, ...data }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error: unknown) {
    const details = error as ErrorDetails;
    console.error("[client-preferences:get]", {
      code: details.code,
      message: details.message,
      details: details.details,
      hint: details.hint,
    });
    const message = error instanceof Error ? error.message : "PREFERENCES_LOAD_FAILED";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const worker = await authenticatedWorker(req);
    if (!worker) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });

    const clientId = clientIdFrom(req);
    if (!clientId) return NextResponse.json({ ok: false, error: "CLIENT_ID_REQUIRED" }, { status: 400 });

    const parsedBody: unknown = await req.json().catch((): null => null);
    const body: PreferencesRequestBody = parsedBody && typeof parsedBody === "object"
      ? parsedBody as PreferencesRequestBody
      : {};
    const communication = normalizeCommunicationPayload(body);
    const notifications = normalizeNotifications(body);
    const schedules = normalizeSchedules(body);
    const admin = adminClient();
    const client = await clientBusiness(admin, clientId);
    if (!client) return NextResponse.json({ ok: false, error: "CLIENT_NOT_FOUND" }, { status: 404 });

    const now = new Date().toISOString();
    const { error: communicationError } = await admin
      .from("crm_client_communication_preferences")
      .upsert({
        client_id: clientId,
        business: client.business,
        ...communication,
        updated_by_user_id: worker.user_id,
        updated_at: now,
      }, { onConflict: "client_id" });
    if (communicationError) throw communicationError;

    const { error: notificationError } = await admin
      .from("crm_client_notification_preferences")
      .upsert({
        client_id: clientId,
        business: client.business,
        settings: notifications,
        updated_by_user_id: worker.user_id,
        updated_at: now,
      }, { onConflict: "client_id" });
    if (notificationError) throw notificationError;

    const incomingIds = schedules.map((schedule) => schedule.id).filter(Boolean) as string[];
    let deleteQuery = admin.from("crm_client_notification_schedules").delete().eq("client_id", clientId);
    if (incomingIds.length > 0) deleteQuery = deleteQuery.not("id", "in", `(${incomingIds.join(",")})`);
    const { error: deleteError } = await deleteQuery;
    if (deleteError) throw deleteError;

    if (schedules.length > 0) {
      const { error: schedulesError } = await admin
        .from("crm_client_notification_schedules")
        .upsert(schedules.map((schedule) => ({
          ...(schedule.id ? { id: schedule.id } : {}),
          client_id: clientId,
          business: client.business,
          name: schedule.name,
          schedule_time: schedule.time,
          preferred_days: schedule.days,
          enabled: schedule.enabled,
          color: schedule.color,
          sort_order: schedule.sort_order,
          updated_by_user_id: worker.user_id,
          updated_at: now,
        })), { onConflict: "id" });
      if (schedulesError) throw schedulesError;
    }

    const data = await loadAll(admin, clientId, client.business);
    return NextResponse.json({ ok: true, ...data }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error: unknown) {
    const details = error as ErrorDetails;
    console.error("[client-preferences:put]", {
      code: details.code,
      message: details.message,
      details: details.details,
      hint: details.hint,
    });
    const message = error instanceof Error ? error.message : "PREFERENCES_SAVE_FAILED";
    const status = message.startsWith("INVALID_") ? 400 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
