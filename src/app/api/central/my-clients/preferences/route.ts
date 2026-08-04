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
const CONTENT_TOPICS = new Set([
  "love_relationships",
  "work_money",
  "personal_growth",
  "spirituality",
  "future_destiny",
  "family",
  "health_wellbeing",
  "professional_development",
]);
const READING_STYLES = new Set(["deep_detailed", "direct_concise", "intuitive_spiritual"]);
const CONTENT_FORMATS = new Set(["text", "audio", "video", "call"]);
const SERVICE_DETAIL_LEVELS = new Set([1, 2, 3, 4]);
const SERVICE_LANGUAGES = new Set(["close_empathetic", "direct_clear", "spiritual_intuitive", "professional_formal", "motivating_positive"]);
const RECOMMENDATION_OPENNESS = new Set(["always", "when_relevant", "ask_first", "no_recommendations"]);

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
  content_preferences?: unknown;
  service_preferences?: unknown;
  important_dates?: unknown;
  personal_notes?: unknown;
};

type RawContentPreferences = {
  favorite_topics?: unknown;
  preferred_reading_style?: unknown;
  preferred_format?: unknown;
};

type ContentPreferences = {
  favorite_topics: string[];
  preferred_reading_style: string | null;
  preferred_format: string | null;
  updated_at?: string | null;
};

type RawServicePreferences = {
  detail_level?: unknown;
  preferred_language?: unknown;
  recommendation_openness?: unknown;
  interested_in_training_events?: unknown;
};

type ServicePreferences = {
  detail_level: number;
  preferred_language: string;
  recommendation_openness: string;
  interested_in_training_events: boolean;
  updated_at?: string | null;
};

type RawImportantDate = {
  id?: unknown;
  name?: unknown;
  date?: unknown;
  description?: unknown;
  reminder_enabled?: unknown;
  icon_key?: unknown;
};

type NormalizedImportantDate = {
  id: string | null;
  name: string;
  important_date: string;
  description: string | null;
  reminder_enabled: boolean;
  icon_key: string;
  sort_order: number;
};

type LoadedImportantDateRow = {
  id: unknown;
  name: unknown;
  important_date: unknown;
  description: unknown;
  reminder_enabled: unknown;
  icon_key: unknown;
  updated_at: unknown;
};

type RawPersonalNotes = {
  notes?: unknown;
};

type LoadedPersonalNotesRow = {
  notes: unknown;
  updated_at: unknown;
  updated_by_worker_id: unknown;
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

const CONTENT_DEFAULTS: ContentPreferences = {
  favorite_topics: [],
  preferred_reading_style: null,
  preferred_format: null,
  updated_at: null,
};

const SERVICE_DEFAULTS: ServicePreferences = {
  detail_level: 2,
  preferred_language: "close_empathetic",
  recommendation_openness: "when_relevant",
  interested_in_training_events: false,
  updated_at: null,
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

function normalizeContentPreferences(body: PreferencesRequestBody): ContentPreferences {
  const raw = body.content_preferences && typeof body.content_preferences === "object"
    ? body.content_preferences as RawContentPreferences
    : {};
  const topics = Array.isArray(raw.favorite_topics)
    ? raw.favorite_topics.map((value: unknown) => String(value || "").trim().toLowerCase())
    : [];
  const favoriteTopics = Array.from(new Set(topics)).filter((topic) => CONTENT_TOPICS.has(topic));
  if (favoriteTopics.length > 3) throw new Error("MAX_THREE_FAVORITE_TOPICS");

  const readingStyleValue = String(raw.preferred_reading_style || "").trim().toLowerCase();
  const formatValue = String(raw.preferred_format || "").trim().toLowerCase();
  const preferredReadingStyle = readingStyleValue || null;
  const preferredFormat = formatValue || null;

  if (preferredReadingStyle && !READING_STYLES.has(preferredReadingStyle)) {
    throw new Error("INVALID_PREFERRED_READING_STYLE");
  }
  if (preferredFormat && !CONTENT_FORMATS.has(preferredFormat)) {
    throw new Error("INVALID_PREFERRED_CONTENT_FORMAT");
  }

  return {
    favorite_topics: favoriteTopics,
    preferred_reading_style: preferredReadingStyle,
    preferred_format: preferredFormat,
  };
}

function normalizeServicePreferences(body: PreferencesRequestBody): ServicePreferences {
  const raw = body.service_preferences && typeof body.service_preferences === "object"
    ? body.service_preferences as RawServicePreferences
    : {};
  const detailLevel = Number(raw.detail_level ?? SERVICE_DEFAULTS.detail_level);
  const preferredLanguage = String(raw.preferred_language ?? SERVICE_DEFAULTS.preferred_language).trim().toLowerCase();
  const recommendationOpenness = String(raw.recommendation_openness ?? SERVICE_DEFAULTS.recommendation_openness).trim().toLowerCase();

  if (!SERVICE_DETAIL_LEVELS.has(detailLevel)) throw new Error("INVALID_SERVICE_DETAIL_LEVEL");
  if (!SERVICE_LANGUAGES.has(preferredLanguage)) throw new Error("INVALID_SERVICE_LANGUAGE");
  if (!RECOMMENDATION_OPENNESS.has(recommendationOpenness)) throw new Error("INVALID_RECOMMENDATION_OPENNESS");

  return {
    detail_level: detailLevel,
    preferred_language: preferredLanguage,
    recommendation_openness: recommendationOpenness,
    interested_in_training_events: Boolean(raw.interested_in_training_events),
  };
}

function normalizeImportantDates(body: PreferencesRequestBody): NormalizedImportantDate[] {
  const rows: RawImportantDate[] = Array.isArray(body.important_dates)
    ? body.important_dates.filter((item): item is RawImportantDate => Boolean(item) && typeof item === "object")
    : [];

  return rows.map((raw, index) => {
    const name = String(raw.name || "").trim();
    const importantDate = String(raw.date || "").trim();
    const description = String(raw.description || "").trim();
    const iconKey = String(raw.icon_key || "calendar").trim().toLowerCase();

    if (!name || name.length > 100) throw new Error(`INVALID_IMPORTANT_DATE_NAME_${index}`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(importantDate)) throw new Error(`INVALID_IMPORTANT_DATE_${index}`);
    if (description.length > 500) throw new Error(`INVALID_IMPORTANT_DATE_DESCRIPTION_${index}`);

    return {
      id: raw.id ? String(raw.id) : null,
      name,
      important_date: importantDate,
      description: description || null,
      reminder_enabled: Boolean(raw.reminder_enabled),
      icon_key: iconKey || "calendar",
      sort_order: index,
    };
  });
}

function normalizePersonalNotes(body: PreferencesRequestBody) {
  const raw = body.personal_notes && typeof body.personal_notes === "object"
    ? body.personal_notes as RawPersonalNotes
    : {};
  const notes = String(raw.notes || "").trim();
  if (notes.length > 5000) throw new Error("PERSONAL_NOTES_TOO_LONG");
  return { notes };
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
  const [communicationResult, notificationResult, schedulesResult, contentResult, serviceResult, importantDatesResult, personalNotesResult] = await Promise.all([
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
    admin
      .from("crm_client_content_preferences")
      .select("client_id, business, favorite_topics, preferred_reading_style, preferred_format, updated_at")
      .eq("client_id", clientId)
      .maybeSingle(),
    admin
      .from("crm_client_service_preferences")
      .select("client_id, business, detail_level, preferred_language, recommendation_openness, interested_in_training_events, updated_at")
      .eq("client_id", clientId)
      .maybeSingle(),
    admin
      .from("crm_client_important_dates")
      .select("id, name, important_date, description, reminder_enabled, icon_key, updated_at")
      .eq("client_id", clientId)
      .order("important_date", { ascending: true })
      .order("created_at", { ascending: true }),
    admin
      .from("crm_client_personal_notes")
      .select("notes, updated_at, updated_by_worker_id")
      .eq("client_id", clientId)
      .maybeSingle(),
  ]);

  if (communicationResult.error) throw communicationResult.error;
  if (notificationResult.error) throw notificationResult.error;
  if (schedulesResult.error) throw schedulesResult.error;
  if (contentResult.error) throw contentResult.error;
  if (serviceResult.error) throw serviceResult.error;
  if (importantDatesResult.error) throw importantDatesResult.error;
  if (personalNotesResult.error) throw personalNotesResult.error;

  let personalNotesUpdatedByName: string | null = null;
  const notesRow = personalNotesResult.data as LoadedPersonalNotesRow | null;
  const updatedByWorkerId = notesRow?.updated_by_worker_id ? String(notesRow.updated_by_worker_id) : "";
  if (updatedByWorkerId) {
    const { data: notesWorker, error: notesWorkerError } = await admin
      .from("workers")
      .select("display_name, email")
      .eq("id", updatedByWorkerId)
      .maybeSingle();
    if (notesWorkerError) throw notesWorkerError;
    if (notesWorker) {
      personalNotesUpdatedByName = String(notesWorker.display_name || notesWorker.email || "").trim() || null;
    }
  }

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
    content_preferences: contentResult.data || {
      client_id: clientId,
      business,
      ...CONTENT_DEFAULTS,
    },
    service_preferences: serviceResult.data || {
      client_id: clientId,
      business,
      ...SERVICE_DEFAULTS,
    },
    important_dates: ((importantDatesResult.data || []) as LoadedImportantDateRow[]).map((item) => ({
      id: String(item.id),
      name: String(item.name || ""),
      date: String(item.important_date || ""),
      description: String(item.description || ""),
      reminder_enabled: Boolean(item.reminder_enabled),
      icon_key: String(item.icon_key || "calendar"),
      updated_at: item.updated_at ? String(item.updated_at) : null,
    })),
    personal_notes: {
      notes: String(notesRow?.notes || ""),
      updated_at: notesRow?.updated_at ? String(notesRow.updated_at) : null,
      updated_by_name: personalNotesUpdatedByName,
    },
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
    const contentPreferences = normalizeContentPreferences(body);
    const servicePreferences = normalizeServicePreferences(body);
    const importantDates = normalizeImportantDates(body);
    const personalNotes = normalizePersonalNotes(body);
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

    const { error: contentError } = await admin
      .from("crm_client_content_preferences")
      .upsert({
        client_id: clientId,
        business: client.business,
        favorite_topics: contentPreferences.favorite_topics,
        preferred_reading_style: contentPreferences.preferred_reading_style,
        preferred_format: contentPreferences.preferred_format,
        updated_by_user_id: worker.user_id,
        updated_at: now,
      }, { onConflict: "client_id" });
    if (contentError) throw contentError;

    const { error: serviceError } = await admin
      .from("crm_client_service_preferences")
      .upsert({
        client_id: clientId,
        business: client.business,
        detail_level: servicePreferences.detail_level,
        preferred_language: servicePreferences.preferred_language,
        recommendation_openness: servicePreferences.recommendation_openness,
        interested_in_training_events: servicePreferences.interested_in_training_events,
        updated_by_user_id: worker.user_id,
        updated_at: now,
      }, { onConflict: "client_id" });
    if (serviceError) throw serviceError;

    const { error: personalNotesError } = await admin
      .from("crm_client_personal_notes")
      .upsert({
        client_id: clientId,
        business: client.business,
        notes: personalNotes.notes,
        updated_by_user_id: worker.user_id,
        updated_by_worker_id: worker.id,
        updated_at: now,
      }, { onConflict: "client_id" });
    if (personalNotesError) throw personalNotesError;

    const incomingDateIds = importantDates.map((item) => item.id).filter((id): id is string => Boolean(id));
    let deleteDatesQuery = admin.from("crm_client_important_dates").delete().eq("client_id", clientId);
    if (incomingDateIds.length > 0) deleteDatesQuery = deleteDatesQuery.not("id", "in", `(${incomingDateIds.join(",")})`);
    const { error: deleteDatesError } = await deleteDatesQuery;
    if (deleteDatesError) throw deleteDatesError;

    if (importantDates.length > 0) {
      const { error: importantDatesError } = await admin
        .from("crm_client_important_dates")
        .upsert(importantDates.map((item) => ({
          ...(item.id ? { id: item.id } : {}),
          client_id: clientId,
          business: client.business,
          name: item.name,
          important_date: item.important_date,
          description: item.description,
          reminder_enabled: item.reminder_enabled,
          icon_key: item.icon_key,
          sort_order: item.sort_order,
          updated_by_user_id: worker.user_id,
          updated_by_worker_id: worker.id,
          updated_at: now,
        })), { onConflict: "id" });
      if (importantDatesError) throw importantDatesError;
    }

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
