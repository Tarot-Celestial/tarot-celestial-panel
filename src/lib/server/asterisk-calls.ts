import { createClient } from "@supabase/supabase-js";

type SupabaseAny = ReturnType<typeof getAdminClient>;

type ParsedPayload = {
  event: string;
  callId: string;
  linkedId: string | null;
  direction: "inbound" | "outbound" | "internal" | "unknown";
  from: string;
  to: string;
  fromExtension: string | null;
  toExtension: string | null;
  fromPhone: string | null;
  toPhone: string | null;
  startedAt: string;
  answeredAt: string | null;
  endedAt: string;
  durationSeconds: number;
  billSeconds: number;
  disposition: string | null;
  amaFlags: string | null;
  codigo: string | null;
  metadata: Record<string, any>;
};

type WorkerLite = {
  id: string;
  role: string | null;
  display_name: string | null;
  email: string | null;
};

type EndpointResolution = {
  extension: string;
  worker_id: string | null;
  label: string | null;
  worker: WorkerLite | null;
};

type ClientResolution = {
  id: string;
  nombre?: string | null;
  apellido?: string | null;
  telefono?: string | null;
  telefono_normalizado?: string | null;
  minutos_free_pendientes?: number | null;
  minutos_normales_pendientes?: number | null;
};

export function getEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

export function getAdminClient() {
  return createClient(getEnv("NEXT_PUBLIC_SUPABASE_URL"), getEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function phoneDigits(value: unknown) {
  return clean(value).replace(/\D/g, "");
}

function normalizePhoneCandidates(value: unknown) {
  const digits = phoneDigits(value);
  if (!digits) return [] as string[];
  const set = new Set<string>();
  set.add(digits);
  set.add(`+${digits}`);
  if (digits.startsWith("34") && digits.length > 9) set.add(digits.slice(2));
  if (digits.startsWith("1") && digits.length > 10) set.add(digits.slice(1));
  return Array.from(set);
}

function isExtension(value: unknown) {
  const digits = phoneDigits(value);
  return /^\d{2,6}$/.test(digits);
}

function normalizeCode(raw: unknown) {
  const value = clean(raw).toLowerCase();
  if (!value) return "cliente";
  if (value.includes("free")) return "free";
  if (value.includes("rueda")) return "rueda";
  if (value.includes("repite")) return "repite";
  if (value.includes("call")) return "call";
  if (value.includes("cliente")) return "cliente";
  return "cliente";
}

function clampPositive(n: unknown) {
  const value = Number(n ?? 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function isoOrNow(value: unknown) {
  const raw = clean(value);
  if (!raw) return new Date().toISOString();
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function joinClientName(cliente: ClientResolution | null) {
  if (!cliente) return "Cliente";
  const full = [cliente.nombre, cliente.apellido].filter(Boolean).join(" ").trim();
  return full || cliente.telefono || cliente.telefono_normalizado || "Cliente";
}

function minutesToText(minutes: number, code: string) {
  if (!minutes || minutes <= 0) return "";
  return `${Number(minutes.toFixed(2))} ${code}`;
}

function inferDirection(from: string, to: string) {
  const fromIsExt = isExtension(from);
  const toIsExt = isExtension(to);
  if (fromIsExt && toIsExt) return "internal" as const;
  if (fromIsExt && !toIsExt) return "outbound" as const;
  if (!fromIsExt && toIsExt) return "inbound" as const;
  return "unknown" as const;
}

function parsePayload(body: Record<string, any>): ParsedPayload {
  const event = clean(body.event || body.type || body.action || "completed").toLowerCase();
  const from = clean(body.from || body.src || body.callerid || body.caller_id || body.caller || body.origin || "");
  const to = clean(body.to || body.dst || body.destination || body.exten || body.called || "");
  const startedAt = isoOrNow(body.started_at || body.start_at || body.start || body.calldate || body.timestamp);
  const answeredAtRaw = clean(body.answered_at || body.answer_at || body.answered || "");
  const endedAt = isoOrNow(body.ended_at || body.end_at || body.end || body.hangup_at || body.finished_at || startedAt);
  const durationSeconds = clampPositive(body.duration_seconds ?? body.duration ?? body.total_seconds ?? 0);
  const billSeconds = clampPositive(body.bill_seconds ?? body.billsec ?? body.billSec ?? body.billable_seconds ?? durationSeconds);
  const direction = (clean(body.direction).toLowerCase() as ParsedPayload["direction"]) || inferDirection(from, to);
  const callId = clean(body.call_id || body.uniqueid || body.unique_id || body.id || body.channel_id);
  const linkedId = clean(body.linked_id || body.linkedid || body.bridge_id || body.bridgeid || "") || null;
  const fromDigits = phoneDigits(from);
  const toDigits = phoneDigits(to);
  const fromExtension = isExtension(fromDigits) ? fromDigits : null;
  const toExtension = isExtension(toDigits) ? toDigits : null;

  return {
    event,
    callId,
    linkedId,
    direction,
    from,
    to,
    fromExtension,
    toExtension,
    fromPhone: fromExtension ? null : fromDigits || null,
    toPhone: toExtension ? null : toDigits || null,
    startedAt,
    answeredAt: answeredAtRaw ? isoOrNow(answeredAtRaw) : null,
    endedAt,
    durationSeconds,
    billSeconds,
    disposition: clean(body.disposition || body.status || body.dialstatus || body.hangup_cause || "") || null,
    amaFlags: clean(body.amaflags || body.ama_flags || "") || null,
    codigo: clean(body.codigo || body.code || body.concept || body.concepto || "") || null,
    metadata: body,
  };
}

async function findClientByPhone(admin: SupabaseAny, phoneLike: string | null) {
  const candidates = normalizePhoneCandidates(phoneLike);
  if (!candidates.length) return null;

  const conditions = candidates
    .flatMap((value) => [`telefono_normalizado.eq.${value}`, `telefono.eq.${value}`])
    .join(",");

  const { data, error } = await admin
    .from("crm_clientes")
    .select("id,nombre,apellido,telefono,telefono_normalizado,minutos_free_pendientes,minutos_normales_pendientes")
    .or(conditions)
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return (data as ClientResolution | null) || null;
}

async function findEndpointByExtension(admin: SupabaseAny, extension: string | null) {
  const ext = clean(extension);
  if (!ext) return null;

  const { data: endpoint, error: endpointError } = await admin
    .from("pbx_extensions")
    .select("extension, worker_id, label")
    .eq("extension", ext)
    .maybeSingle();

  if (endpointError) throw endpointError;
  if (!endpoint) return null;

  let worker: WorkerLite | null = null;
  if (endpoint.worker_id) {
    const { data: workerData, error: workerError } = await admin
      .from("workers")
      .select("id, role, display_name, email")
      .eq("id", endpoint.worker_id)
      .maybeSingle();
    if (workerError) throw workerError;
    worker = (workerData as WorkerLite | null) || null;
  }

  return {
    extension: endpoint.extension,
    worker_id: endpoint.worker_id || null,
    label: endpoint.label || null,
    worker,
  } as EndpointResolution;
}

function computeMinuteConsumption(cliente: ClientResolution | null, totalMinutes: number, rawCode: string | null) {
  const total = Math.max(0, Number(totalMinutes || 0));
  if (!cliente || total <= 0) {
    const code = normalizeCode(rawCode);
    return {
      freeUsed: 0,
      normalUsed: total,
      nextFree: Number(cliente?.minutos_free_pendientes || 0),
      nextNormal: Math.max(0, Number(cliente?.minutos_normales_pendientes || 0) - total),
      primaryCode: code,
      secondaryCode: null as string | null,
      summary: minutesToText(total, code),
    };
  }

  const freeAvailable = Math.max(0, Number(cliente.minutos_free_pendientes || 0));
  const normalAvailable = Math.max(0, Number(cliente.minutos_normales_pendientes || 0));
  const preferredCode = normalizeCode(rawCode);

  let freeUsed = 0;
  let normalUsed = 0;

  if (preferredCode === "free") {
    freeUsed = Math.min(freeAvailable, total);
    normalUsed = Math.min(normalAvailable, Math.max(0, total - freeUsed));
  } else {
    freeUsed = Math.min(freeAvailable, total);
    normalUsed = Math.min(normalAvailable, Math.max(0, total - freeUsed));
  }

  if (!freeUsed && preferredCode === "free") {
    normalUsed = Math.min(normalAvailable, total);
  }

  if (!normalUsed && preferredCode !== "free") {
    freeUsed = Math.min(freeAvailable, total);
  }

  const nextFree = Math.max(0, Number((freeAvailable - freeUsed).toFixed(2)));
  const nextNormal = Math.max(0, Number((normalAvailable - normalUsed).toFixed(2)));
  const normalCode = preferredCode === "free" ? "cliente" : preferredCode;
  const summary = [minutesToText(freeUsed, "free"), minutesToText(normalUsed, normalCode)].filter(Boolean).join(" · ");

  return {
    freeUsed: Number(freeUsed.toFixed(2)),
    normalUsed: Number(normalUsed.toFixed(2)),
    nextFree,
    nextNormal,
    primaryCode: freeUsed > 0 ? "FREE" : normalUsed > 0 ? normalCode : null,
    secondaryCode: freeUsed > 0 && normalUsed > 0 ? normalCode : null,
    summary,
  };
}

async function maybeInsertClientNote(admin: SupabaseAny, clienteId: string | null, texto: string) {
  if (!clienteId || !texto.trim()) return;
  await admin.from("crm_client_notes").insert({
    cliente_id: clienteId,
    texto: texto.trim(),
    author_user_id: null,
    author_name: "Sistema",
    author_email: null,
    is_pinned: false,
  });
}

async function existsPerformanceRow(admin: SupabaseAny, payload: any) {
  let query = admin
    .from("rendimiento_llamadas")
    .select("id")
    .eq("fecha_hora", payload.fecha_hora)
    .eq("tiempo", payload.tiempo)
    .limit(1);

  query = payload.cliente_id ? query.eq("cliente_id", payload.cliente_id) : query.is("cliente_id", null);
  query = payload.tarotista_worker_id ? query.eq("tarotista_worker_id", payload.tarotista_worker_id) : query.is("tarotista_worker_id", null);
  query = payload.resumen_codigo ? query.eq("resumen_codigo", payload.resumen_codigo) : query.is("resumen_codigo", null);

  const { data, error } = await query.maybeSingle();

  if (error) throw error;
  return !!data?.id;
}

export async function handleAsteriskCallWebhook(body: Record<string, any>) {
  const admin = getAdminClient();
  const payload = parsePayload(body);

  const finalSeconds = payload.billSeconds || payload.durationSeconds;
  const totalMinutes = Number((finalSeconds / 60).toFixed(2));

  const endpointFrom = await findEndpointByExtension(admin, payload.fromExtension);
  const endpointTo = await findEndpointByExtension(admin, payload.toExtension);

  const internalTarotista = [endpointFrom, endpointTo].find((item) => String(item?.worker?.role || "").toLowerCase() === "tarotista") || null;
  const internalCentral = [endpointFrom, endpointTo].find((item) => {
    const role = String(item?.worker?.role || "").toLowerCase();
    return role === "central" || role === "admin";
  }) || null;

  const externalPhone = payload.direction === "inbound"
    ? payload.fromPhone
    : payload.direction === "outbound"
    ? payload.toPhone
    : payload.fromPhone || payload.toPhone;

  const cliente = await findClientByPhone(admin, externalPhone);
  const consumo = computeMinuteConsumption(cliente, totalMinutes, payload.codigo);

  const clienteNombre = joinClientName(cliente);
  const tarotistaNombre = internalTarotista?.worker?.display_name || internalTarotista?.label || null;
  const telefonistaNombre = internalCentral?.worker?.display_name || internalCentral?.label || null;
  const fechaHora = payload.answeredAt || payload.startedAt || payload.endedAt;
  const fecha = fechaHora.slice(0, 10);

  if (payload.event === "completed" || payload.event === "hangup" || payload.event === "ended" || payload.event === "finalized") {
    if (cliente?.id && (consumo.freeUsed > 0 || consumo.normalUsed > 0)) {
      const { error: updateClienteError } = await admin
        .from("crm_clientes")
        .update({
          minutos_free_pendientes: consumo.nextFree,
          minutos_normales_pendientes: consumo.nextNormal,
          updated_at: new Date().toISOString(),
        })
        .eq("id", cliente.id);
      if (updateClienteError) throw updateClienteError;
    }

    const rendimientoPayload = {
      fecha,
      fecha_hora: fechaHora,
      cliente_id: cliente?.id || null,
      cliente_nombre: clienteNombre,
      telefonista_worker_id: internalCentral?.worker_id || null,
      telefonista_nombre: telefonistaNombre || "Central",
      tarotista_worker_id: internalTarotista?.worker_id || null,
      tarotista_nombre: tarotistaNombre,
      tarotista_manual_call: null,
      llamada_call: false,
      tipo_registro: "minutos",
      cliente_compra_minutos: false,
      usa_7_free: false,
      usa_minutos: true,
      misma_compra: false,
      guarda_minutos: false,
      minutos_guardados_free: 0,
      minutos_guardados_normales: 0,
      codigo_1: consumo.primaryCode,
      minutos_1: consumo.primaryCode === "FREE" ? consumo.freeUsed : consumo.normalUsed,
      codigo_2: consumo.secondaryCode,
      minutos_2: consumo.secondaryCode ? consumo.normalUsed : 0,
      resumen_codigo: consumo.summary || null,
      tiempo: totalMinutes,
      forma_pago: null,
      importe: 0,
      promo: false,
      captado: false,
      recuperado: false,
    };

    const alreadyExists = await existsPerformanceRow(admin, rendimientoPayload);
    if (!alreadyExists) {
      const { error: insertError } = await admin.from("rendimiento_llamadas").insert(rendimientoPayload);
      if (insertError) throw insertError;
    }

    await maybeInsertClientNote(
      admin,
      cliente?.id || null,
      [
        `Llamada registrada automáticamente desde centralita.`,
        tarotistaNombre ? `Tarotista: ${tarotistaNombre}.` : null,
        telefonistaNombre ? `Central: ${telefonistaNombre}.` : null,
        totalMinutes > 0 ? `Duración: ${Number(totalMinutes.toFixed(2))} min.` : null,
        consumo.summary ? `Consumo: ${consumo.summary}.` : null,
        payload.disposition ? `Estado: ${payload.disposition}.` : null,
      ]
        .filter(Boolean)
        .join(" ")
    );
  }

  return {
    ok: true,
    received: {
      event: payload.event,
      call_id: payload.callId || null,
      linked_id: payload.linkedId,
      direction: payload.direction,
      from: payload.from,
      to: payload.to,
      duration_seconds: finalSeconds,
      duration_minutes: totalMinutes,
      disposition: payload.disposition,
    },
    resolved: {
      cliente_id: cliente?.id || null,
      cliente_nombre: clienteNombre,
      tarotista_worker_id: internalTarotista?.worker_id || null,
      tarotista_nombre: tarotistaNombre,
      central_worker_id: internalCentral?.worker_id || null,
      central_nombre: telefonistaNombre,
      consumo,
    },
  };
}
