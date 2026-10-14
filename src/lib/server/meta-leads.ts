import { supabaseAdmin } from "@/lib/supabase-admin";

type LeadField = {
  name?: string;
  values?: any[];
};

export type MetaLeadPayload = {
  id?: string;
  created_time?: string;
  field_data?: LeadField[];
  ad_id?: string;
  form_id?: string;
  campaign_id?: string;
  ad_name?: string;
  form_name?: string;
  campaign_name?: string;
  platform?: string;
  page_id?: string;
};

type IngestOptions = {
  sourceLabel?: string;
  rawWebhookBody?: any;
  metaContext?: Record<string, any>;
};

const SAFE_RETRY_PREFIX = "RETRYABLE_PRE_INGEST_V1:";
const EVENT_COLUMNS = "id,status,received_at,updated_at,attempt_count,last_error,cliente_id,captacion_lead_id,inserted_at";

export class MetaLeadError extends Error {
  constructor(public code: string, public status = 503) {
    super(code);
  }
}

export function metaLeadErrorCode(error: unknown): string {
  if (error instanceof MetaLeadError) return error.code;
  const code = String((error as any)?.code || "");
  return /^[A-Z0-9]{3,12}$/.test(code) ? `META_STORAGE_${code}` : "META_LEAD_PROCESSING_FAILED";
}

function isMissingColumn(error: any) {
  return error?.code === "42703" || error?.code === "PGRST204";
}

export async function metaGraphRequest(path: string, params: Record<string, string>, deadlineAt?: number) {
  if (!/^\d+(?:\/leads)?$/.test(path)) throw new MetaLeadError("META_INVALID_RESOURCE", 400);
  const token = String(process.env.META_ACCESS_TOKEN || "").trim();
  if (!token) throw new MetaLeadError("META_ACCESS_TOKEN_MISSING");
  const version = String(process.env.META_GRAPH_API_VERSION || "v22.0").trim();
  if (!/^v\d+\.\d+$/.test(version)) throw new MetaLeadError("META_GRAPH_VERSION_INVALID");
  const remaining = deadlineAt == null ? 8000 : Math.min(8000, deadlineAt - Date.now());
  if (remaining < 1000) throw new MetaLeadError("META_TIME_BUDGET_EXCEEDED");
  const url = new URL(`https://graph.facebook.com/${version}/${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(remaining),
    });
    const json = await response.json().catch(() => null);
    if (!response.ok) throw new MetaLeadError(`META_GRAPH_HTTP_${response.status}`);
    if (!json || typeof json !== "object") throw new MetaLeadError("META_GRAPH_INVALID_RESPONSE");
    return json;
  } catch (error) {
    if (error instanceof MetaLeadError) throw error;
    const name = String((error as any)?.name || "");
    throw new MetaLeadError(name === "TimeoutError" || name === "AbortError" ? "META_GRAPH_TIMEOUT" : "META_GRAPH_UNAVAILABLE");
  }
}

function sanitizeText(value: any) {
  const text = String(value ?? "").trim();
  return text || null;
}

function normalizePhone(value: any) {
  const raw = String(value ?? "").trim();
  if (!raw) return { pretty: null as string | null, digits: null as string | null };
  const pretty = raw.replace(/\s+/g, " ").trim();
  const rawDigits = pretty.replace(/\D/g, "").trim();
  const digits = rawDigits.length === 9 ? `34${rawDigits}` : rawDigits;
  return {
    pretty: pretty || null,
    digits: digits || null,
  };
}

function findFieldValue(fields: LeadField[], names: string[]) {
  const normalizedNames = names.map((x) => x.toLowerCase());

  for (const field of fields || []) {
    const fieldName = String(field?.name || "").trim().toLowerCase();
    if (!fieldName) continue;
    if (!normalizedNames.includes(fieldName)) continue;

    const value = Array.isArray(field?.values) ? field.values[0] : null;
    if (value == null) continue;
    const text = String(value).trim();
    if (text) return text;
  }

  return null;
}

function buildLeadSummary(args: {
  fullName?: string | null;
  phone?: string | null;
  email?: string | null;
  sourceLabel?: string | null;
  campaignName?: string | null;
  formName?: string | null;
  createdTime?: string | null;
  extra?: Record<string, any>;
}) {
  const lines = [
    "🔥 Nuevo lead entrado automáticamente desde Meta/Facebook.",
    args.fullName ? `• Nombre: ${args.fullName}` : null,
    args.phone ? `• Teléfono: ${args.phone}` : null,
    args.email ? `• Email: ${args.email}` : null,
    args.sourceLabel ? `• Origen: ${args.sourceLabel}` : null,
    args.campaignName ? `• Campaña: ${args.campaignName}` : null,
    args.formName ? `• Formulario: ${args.formName}` : null,
    args.createdTime ? `• Fecha lead: ${args.createdTime}` : null,
  ].filter(Boolean) as string[];

  const extraEntries = Object.entries(args.extra || {}).filter(([, v]) => v != null && String(v).trim() !== "");
  if (extraEntries.length) {
    lines.push("", "Datos extra capturados:");
    for (const [key, value] of extraEntries) {
      lines.push(`• ${key}: ${String(value)}`);
    }
  }

  return lines.join("\n");
}

async function trySelectClienteByLeadgenId(leadgenId: string) {
  const admin = supabaseAdmin();
    const { data, error } = await admin
      .from("crm_clientes")
      .select("id, nombre, apellido, telefono, telefono_normalizado, email")
      .eq("leadgen_id", leadgenId)
      .maybeSingle();

    if (error) throw error;
    return data || null;
}

async function findExistingClient(args: {
  leadgenId?: string | null;
  phoneDigits?: string | null;
  email?: string | null;
}) {
  const admin = supabaseAdmin();

  if (args.leadgenId) {
    const byLeadgenId = await trySelectClienteByLeadgenId(args.leadgenId);
    if (byLeadgenId) return byLeadgenId;
  }

  if (args.phoneDigits) {
    const { data, error } = await admin
      .from("crm_clientes")
      .select("id, nombre, apellido, telefono, telefono_normalizado, email")
      .eq("telefono_normalizado", args.phoneDigits)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    if (data) return data;
  }

  if (args.email) {
    const { data, error } = await admin
      .from("crm_clientes")
      .select("id, nombre, apellido, telefono, telefono_normalizado, email")
      .ilike("email", args.email)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    if (data) return data;
  }

  return null;
}

async function upsertClient(args: {
  nombre: string;
  apellido?: string | null;
  telefono?: string | null;
  telefonoDigits?: string | null;
  email?: string | null;
  sourceLabel: string;
  leadgenId?: string | null;
  campaignName?: string | null;
  formName?: string | null;
  adName?: string | null;
  metaCreatedAt?: string | null;
}) {
  const admin = supabaseAdmin();
  const existing = await findExistingClient({
    leadgenId: args.leadgenId,
    phoneDigits: args.telefonoDigits,
    email: args.email,
  });

  // A new form submission is not permission to reset a CRM contact. Its latest
  // answers are recorded in the note/inbox, preserving the staff-owned record.
  if (existing?.id) return { cliente: existing, isNew: false, supportsLeadColumns: true };

  const commonPatch: Record<string, any> = {
    nombre: args.nombre,
    apellido: args.apellido || null,
    telefono: args.telefono || `sin_telefono_${args.leadgenId || Date.now()}`,
    telefono_normalizado: args.telefonoDigits || `sin_telefono_${args.leadgenId || Date.now()}`,
    email: args.email || null,
    origen: args.sourceLabel,
  };

  const optionalColumnsPatch: Record<string, any> = {
    lead_status: "nuevo",
    lead_source: args.sourceLabel,
    lead_form_name: args.formName || null,
    lead_campaign_name: args.campaignName || null,
    lead_ad_name: args.adName || null,
    leadgen_id: args.leadgenId || null,
    lead_created_at: args.metaCreatedAt || null,
    lead_contacted_at: null,
  };

  const insertPayload: Record<string, any> = {
    ...commonPatch,
    pais: null,
    notas: null,
    deuda_pendiente: 0,
    minutos_free_pendientes: 0,
    minutos_normales_pendientes: 0,
  };

  try {
    const { data, error } = await admin
      .from("crm_clientes")
      .insert({ ...insertPayload, ...optionalColumnsPatch })
      .select("*")
      .single();

    if (error) throw error;
    return { cliente: data, isNew: true, supportsLeadColumns: true };
  } catch (insertFailure: any) {
    // Only a definitive missing-column response is safe to retry. A transport
    // error can mean the INSERT committed and its response was lost.
    if (!isMissingColumn(insertFailure)) throw insertFailure;
    const { data, error } = await admin
      .from("crm_clientes")
      .insert(insertPayload)
      .select("*")
      .single();

    if (error) throw error;
    return { cliente: data, isNew: true, supportsLeadColumns: false };
  }
}

async function insertClientNote(clienteId: string, texto: string) {
  const admin = supabaseAdmin();

  const { error } = await admin.from("crm_client_notes").insert({
    cliente_id: clienteId,
    texto,
    author_name: "Sistema · Meta Leads",
    author_email: "no-reply@tarotcelestial.local",
    is_pinned: true,
  });

  if (error) throw error;
}

async function insertNotifications(args: {
  clienteId: string;
  fullName: string;
  phone?: string | null;
  campaignName?: string | null;
}) {
  const admin = supabaseAdmin();
  const { data: workers, error } = await admin
    .from("workers")
    .select("user_id, display_name, role, state")
    .in("role", ["admin", "central"]);

  if (error) throw error;

  const targets = (workers || []).filter((w: any) => w?.user_id);
  if (!targets.length) return;

  const title = "🔥 Nuevo lead de Facebook";
  const message = [
    args.fullName || "Lead sin nombre",
    args.phone ? `· ${args.phone}` : null,
    args.campaignName ? `· ${args.campaignName}` : null,
  ].filter(Boolean).join(" ");

  const rows = targets.map((worker: any) => ({
    user_id: worker.user_id,
    title,
    message,
    read: false,
    client_id: args.clienteId,
  }));

  try {
    const { error: insertError } = await admin.from("notifications").insert(rows);
    if (insertError) throw insertError;
  } catch (error: any) {
    if (!isMissingColumn(error)) throw error;
    const fallbackRows = rows.map((row: any) => ({
      user_id: row.user_id,
      title: row.title,
      message: row.message,
      read: row.read,
    }));
    const { error: fallbackError } = await admin.from("notifications").insert(fallbackRows);
    if (fallbackError) throw fallbackError;
  }
}

async function upsertCaptacionLead(args: {
  clienteId: string;
  origen: string;
  campaignName?: string | null;
  formName?: string | null;
}) {
  const admin = supabaseAdmin();
  const { data: existing, error: lookupError } = await admin
    .from("captacion_leads")
    .select("id")
    .eq("cliente_id", args.clienteId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lookupError) throw lookupError;

  const payload = {
    cliente_id: args.clienteId,
    estado: "nuevo",
    intento_actual: 1,
    max_intentos: 3,
    next_contact_at: new Date().toISOString(),
    contacted_at: null,
    last_contact_at: null,
    last_result: null,
    campaign_name: args.campaignName || null,
    form_name: args.formName || null,
    origen: args.origen,
    closed_at: null,
    updated_at: new Date().toISOString(),
  };

  const updateMetadata = async (id: string) => {
    const { error } = await admin.from("captacion_leads").update({
      // One row per client, including pend_free, pend_cap and closed contacts.
      // Never reset workflow, assignment, attempts, reminders or closure.
      updated_at: new Date().toISOString(),
      ...(args.campaignName ? { campaign_name: args.campaignName } : {}),
      ...(args.formName ? { form_name: args.formName } : {}),
    }).eq("id", id);
    if (error) throw error;
    return id;
  };
  if (existing?.id) return updateMetadata(existing.id);

  const { data, error } = await admin.from("captacion_leads").insert(payload).select("id").single();
  if (error?.code === "23505") {
    const { data: raced, error: raceError } = await admin.from("captacion_leads")
      .select("id").eq("cliente_id", args.clienteId).maybeSingle();
    if (raceError) throw raceError;
    if (raced?.id) return updateMetadata(raced.id);
  }
  if (error) throw error;
  return data?.id || null;
}

async function tryInsertLeadLog(args: {
  clienteId: string;
  leadgenId?: string | null;
  payload: Record<string, any>;
}) {
  const admin = supabaseAdmin();
  try {
    const { error } = await admin.from("crm_leads_inbox").insert({
      cliente_id: args.clienteId,
      leadgen_id: args.leadgenId || null,
      payload: args.payload,
      status: "nuevo",
    });
    if (error) throw error;
  } catch (error: any) {
    // Auxiliary log must not cause a second ingestion after core writes.
    console.warn("META_LEAD_INBOX_UNAVAILABLE", { code: metaLeadErrorCode(error) });
  }
}

export async function fetchMetaLeadById(leadgenId: string, deadlineAt?: number) {
  return await metaGraphRequest(leadgenId, {
    fields: "id,created_time,field_data,campaign_id,campaign_name,ad_id,ad_name,form_id,form_name,is_organic,platform",
  }, deadlineAt) as MetaLeadPayload;
}

export async function ingestMetaLead(lead: MetaLeadPayload, options: IngestOptions = {}) {
  const fields = Array.isArray(lead?.field_data) ? lead.field_data : [];
  const fullName =
    findFieldValue(fields, ["full_name", "nombre_completo", "name"]) ||
    [
      findFieldValue(fields, ["first_name", "nombre"]),
      findFieldValue(fields, ["last_name", "apellido"]),
    ]
      .filter(Boolean)
      .join(" ")
      .trim() ||
    "Lead Facebook";

  const firstName = findFieldValue(fields, ["first_name", "nombre"]);
  const lastName = findFieldValue(fields, ["last_name", "apellido"]);
  const resolvedNombre = firstName || fullName.split(" ").slice(0, 1).join(" ") || fullName;
  const resolvedApellido =
    lastName ||
    (fullName.includes(" ") ? fullName.split(" ").slice(1).join(" ").trim() : null);

  const email = sanitizeText(findFieldValue(fields, ["email", "correo", "correo_electronico"]));
  const phoneInfo = normalizePhone(findFieldValue(fields, ["phone_number", "telefono", "teléfono", "mobile_phone_number"]));
  const sourceLabel = sanitizeText(options.sourceLabel) || "facebook_ads";

  const ignoredFieldNames = new Set([
    "full_name",
    "name",
    "first_name",
    "last_name",
    "nombre",
    "apellido",
    "phone_number",
    "telefono",
    "teléfono",
    "mobile_phone_number",
    "email",
    "correo",
    "correo_electronico",
  ]);

  const extraFields: Record<string, any> = {};
  for (const field of fields) {
    const rawName = String(field?.name || "").trim();
    if (!rawName) continue;
    if (ignoredFieldNames.has(rawName.toLowerCase())) continue;
    const value = Array.isArray(field?.values) ? field.values.join(", ") : "";
    if (!String(value).trim()) continue;
    extraFields[rawName] = value;
  }

  const { cliente, isNew } = await upsertClient({
    nombre: resolvedNombre,
    apellido: resolvedApellido,
    telefono: phoneInfo.pretty,
    telefonoDigits: phoneInfo.digits,
    email,
    sourceLabel,
    leadgenId: sanitizeText(lead?.id),
    campaignName: sanitizeText(lead?.campaign_name),
    formName: sanitizeText(lead?.form_name),
    adName: sanitizeText(lead?.ad_name),
    metaCreatedAt: sanitizeText(lead?.created_time),
  });

  const note = buildLeadSummary({
    fullName,
    phone: phoneInfo.pretty,
    email,
    sourceLabel,
    campaignName: sanitizeText(lead?.campaign_name),
    formName: sanitizeText(lead?.form_name),
    createdTime: sanitizeText(lead?.created_time),
    extra: extraFields,
  });

  await insertClientNote(String(cliente.id), note);
  const captacionLeadId = await upsertCaptacionLead({
    clienteId: String(cliente.id),
    origen: sourceLabel,
    campaignName: sanitizeText(lead?.campaign_name),
    formName: sanitizeText(lead?.form_name),
  });

  await insertNotifications({
    clienteId: String(cliente.id),
    fullName,
    phone: phoneInfo.pretty,
    campaignName: sanitizeText(lead?.campaign_name),
  });

  await tryInsertLeadLog({
    clienteId: String(cliente.id),
    leadgenId: sanitizeText(lead?.id),
    payload: {
      lead,
      webhook: options.rawWebhookBody || null,
      context: options.metaContext || null,
      ingested_at: new Date().toISOString(),
    },
  });

  return {
    ok: true,
    cliente,
    isNew,
    fullName,
    phone: phoneInfo.pretty,
    email,
    leadgenId: sanitizeText(lead?.id),
    captacionLeadId,
  };
}

type MetaEventContext = {
  source?: string;
  pageId?: string | null;
  formId?: string | null;
  campaignId?: string | null;
  adId?: string | null;
  payload?: Record<string, any> | null;
  deadlineAt?: number;
};

export async function claimMetaLeadEvent(leadgenId: string, context: MetaEventContext = {}) {
  const admin = supabaseAdmin();
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("meta_lead_events")
    .insert({
      leadgen_id: leadgenId,
      status: "received",
      source: context.source || "meta_webhook",
      page_id: context.pageId || null,
      form_id: context.formId || null,
      campaign_id: context.campaignId || null,
      ad_id: context.adId || null,
      received_at: now,
      attempt_count: 1,
      payload: context.payload || null,
      updated_at: now,
    })
    .select(EVENT_COLUMNS)
    .single();

  if (!error && data) return { claimed: true as const, event: data };

  if (error?.code === "23505") {
    const { data: existing, error: lookupError } = await admin
      .from("meta_lead_events")
      .select(EVENT_COLUMNS)
      .eq("leadgen_id", leadgenId)
      .maybeSingle();
    if (lookupError) throw lookupError;
    if (!existing) throw new MetaLeadError("META_EVENT_NOT_FOUND");
    if (existing.status === "processed" && existing.cliente_id && existing.captacion_lead_id) {
      return { claimed: false as const, event: existing };
    }
    if (existing.status === "failed" && String(existing.last_error || "").startsWith(SAFE_RETRY_PREFIX)
      && !existing.cliente_id && !existing.captacion_lead_id && !existing.inserted_at) {
      // Only this version's proven pre-ingestion failures can be reclaimed.
      // No lease expiry retry: an old worker could still be writing CRM rows.
      const { data: retried, error: retryError } = await admin.from("meta_lead_events")
        .update({ status: "received", last_error: null, attempt_count: Number(existing.attempt_count || 0) + 1, updated_at: now })
        .eq("id", existing.id).eq("status", "failed").eq("updated_at", existing.updated_at)
        .eq("last_error", existing.last_error).select(EVENT_COLUMNS).maybeSingle();
      if (retryError) throw retryError;
      if (retried) return { claimed: true as const, event: retried };
      throw new MetaLeadError("META_LEAD_IN_PROGRESS");
    }
    const age = Date.now() - Date.parse(existing.updated_at || existing.received_at);
    if (["received", "fetching"].includes(existing.status) && Number.isFinite(age) && age < 120000) {
      throw new MetaLeadError("META_LEAD_IN_PROGRESS");
    }
    throw new MetaLeadError("META_MANUAL_RECONCILIATION_REQUIRED");
  }

  throw error || new MetaLeadError("META_EVENT_CLAIM_FAILED");
}

export async function markMetaLeadEvent(
  eventId: string,
  patch: Record<string, any>
) {
  const admin = supabaseAdmin();
  const { error } = await admin
    .from("meta_lead_events")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", eventId);
  if (error) throw error;
}

export async function processMetaLeadById(
  leadgenId: string,
  context: MetaEventContext = {}
) {
  return processClaimedLead(leadgenId, () => fetchMetaLeadById(leadgenId, context.deadlineAt), context);
}

export async function processExpandedMetaLead(
  lead: MetaLeadPayload,
  context: MetaEventContext = {}
) {
  const leadgenId = sanitizeText(lead?.id);
  if (!leadgenId) throw new MetaLeadError("META_LEAD_ID_REQUIRED", 400);
  return processClaimedLead(leadgenId, async () => lead, context);
}

async function processClaimedLead(leadgenId: string, load: () => Promise<MetaLeadPayload>, context: MetaEventContext) {
  if (!/^\d+$/.test(leadgenId)) throw new MetaLeadError("META_LEAD_ID_INVALID", 400);
  const claimed = await claimMetaLeadEvent(leadgenId, context);
  if (!claimed.claimed) return { ok: true, duplicate: true, leadgenId, event: claimed.event };

  const eventId = String(claimed.event.id);
  let ingestionStarted = false;
  try {
    await markMetaLeadEvent(eventId, { status: "fetching" });
    const lead = await load();
    if (String(lead?.id || "") !== leadgenId || !Array.isArray(lead?.field_data) || !lead.field_data.length
      || (lead.created_time != null && !Number.isFinite(Date.parse(lead.created_time)))) {
      throw new MetaLeadError("META_LEAD_PAYLOAD_INVALID", 400);
    }
    const fetchedAt = new Date().toISOString();
    await markMetaLeadEvent(eventId, { fetched_at: fetchedAt });
    if (context.deadlineAt != null && Date.now() >= context.deadlineAt) {
      throw new MetaLeadError("META_TIME_BUDGET_EXCEEDED");
    }
    // From here, any error/crash can leave partial CRM/note/notification writes.
    // Marking it failed must NEVER authorize a second ingestion automatically.
    ingestionStarted = true;
    const result = await ingestMetaLead(lead, {
      sourceLabel: "facebook_ads",
      rawWebhookBody: context.payload || null,
      metaContext: context,
    });
    const insertedAt = new Date().toISOString();
    await markMetaLeadEvent(eventId, {
      status: "processed",
      cliente_id: result.cliente?.id || null,
      captacion_lead_id: result.captacionLeadId || null,
      meta_created_at: lead.created_time || null,
      fetched_at: fetchedAt,
      inserted_at: insertedAt,
      visible_at: insertedAt,
      campaign_id: lead.campaign_id || context.campaignId || null,
      ad_id: lead.ad_id || context.adId || null,
      form_id: lead.form_id || context.formId || null,
      last_error: null,
      payload: { webhook: context.payload || null, lead },
    });
    console.info("META_LEAD_PROCESSED", { eventId, source: context.source || "meta_webhook" });
    return { ...result, duplicate: false, eventId };
  } catch (error) {
    const code = metaLeadErrorCode(error);
    const marker = ingestionStarted ? "MANUAL_RECONCILIATION_REQUIRED:" : SAFE_RETRY_PREFIX;
    await markMetaLeadEvent(eventId, { status: "failed", last_error: `${marker}${code}` }).catch(() => {
      console.error("META_EVENT_STATUS_WRITE_FAILED", { eventId });
    });
    console.error("META_LEAD_FAILED", { eventId, code, manualReview: ingestionStarted });
    if (ingestionStarted) throw new MetaLeadError("META_MANUAL_RECONCILIATION_REQUIRED");
    throw error;
  }
}
