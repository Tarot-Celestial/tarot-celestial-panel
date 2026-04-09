import { supabaseAdmin } from "@/lib/supabase-admin";

type LeadField = {
  name?: string;
  values?: any[];
};

type MetaLeadPayload = {
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

function sanitizeText(value: any) {
  const text = String(value ?? "").trim();
  return text || null;
}

function normalizePhone(value: any) {
  const raw = String(value ?? "").trim();
  if (!raw) return { pretty: null as string | null, digits: null as string | null };
  const pretty = raw.replace(/\s+/g, " ").trim();
  const digits = pretty.replace(/\D/g, "").trim();
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
  try {
    const { data, error } = await admin
      .from("crm_clientes")
      .select("id, nombre, apellido, telefono, email")
      .eq("leadgen_id", leadgenId)
      .maybeSingle();

    if (error) throw error;
    return data || null;
  } catch {
    return null;
  }
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
      .select("id, nombre, apellido, telefono, email")
      .eq("telefono_normalizado", args.phoneDigits)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!error && data) return data;
  }

  if (args.email) {
    const { data, error } = await admin
      .from("crm_clientes")
      .select("id, nombre, apellido, telefono, email")
      .ilike("email", args.email)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!error && data) return data;
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

  const commonPatch: Record<string, any> = {
    nombre: args.nombre,
    apellido: args.apellido || null,
    telefono: args.telefono || null,
    telefono_normalizado: args.telefonoDigits || null,
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

  if (existing?.id) {
    const patch = {
      ...commonPatch,
    };

    let cliente: any = null;
    let updatedWithLeadColumns = false;

    try {
      const { data, error } = await admin
        .from("crm_clientes")
        .update({ ...patch, ...optionalColumnsPatch })
        .eq("id", existing.id)
        .select("*")
        .single();
      if (error) throw error;
      cliente = data;
      updatedWithLeadColumns = true;
    } catch {
      const { data, error } = await admin
        .from("crm_clientes")
        .update(patch)
        .eq("id", existing.id)
        .select("*")
        .single();
      if (error) throw error;
      cliente = data;
    }

    return { cliente, isNew: false, supportsLeadColumns: updatedWithLeadColumns };
  }

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
  } catch {
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
  } catch {
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
  const openStates = ["nuevo", "no_contesta", "pendiente_free", "hizo_free", "recontacto"];

  const { data: existing } = await admin
    .from("captacion_leads")
    .select("id")
    .eq("cliente_id", args.clienteId)
    .in("estado", openStates)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

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

  if (existing?.id) {
    const { error } = await admin.from("captacion_leads").update(payload).eq("id", existing.id);
    if (error) throw error;
    return existing.id;
  }

  const { data, error } = await admin.from("captacion_leads").insert(payload).select("id").single();
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
    await admin.from("crm_leads_inbox").insert({
      cliente_id: args.clienteId,
      leadgen_id: args.leadgenId || null,
      payload: args.payload,
      status: "nuevo",
    });
  } catch {
    // tabla opcional
  }
}

export async function fetchMetaLeadById(leadgenId: string) {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) {
    throw new Error("Missing env META_ACCESS_TOKEN");
  }

  const url = new URL(`https://graph.facebook.com/v22.0/${leadgenId}`);
  url.searchParams.set(
    "fields",
    [
      "id",
      "created_time",
      "field_data",
      "campaign_id",
      "campaign_name",
      "ad_id",
      "ad_name",
      "form_id",
      "form_name",
      "is_organic",
      "platform",
    ].join(",")
  );
  url.searchParams.set("access_token", token);

  const res = await fetch(url.toString(), {
    method: "GET",
    cache: "no-store",
  });

  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(json?.error?.message || `Meta lead fetch failed (${res.status})`);
  }

  return json as MetaLeadPayload;
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
  await upsertCaptacionLead({
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
  };
}
