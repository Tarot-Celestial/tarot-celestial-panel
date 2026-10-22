export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { originMatchesBrand, type BrandKey } from "@/lib/server/brand-filter";
import { getBearerToken } from "@/lib/server/auth-fast";
import { pendingMetaSubmissionAt, recentMetaSubmissions } from "@/lib/server/captacion-attention";

function env(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

const supabase = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false },
});

type AnyRow = Record<string, any>;

type LeadItem = AnyRow & {
  workflow_state: string;
  is_closed: boolean;
  next_contact_at?: string | null;
  created_at?: string | null;
};

const CLOSED_STATES = ["cliente", "captado", "no_interesado", "numero_invalido", "perdido", "cerrado", "finalizado"];
const PAGE_SIZE = 250;
const ID_BATCH_SIZE = 100;
type PageOptions = { from?: number; to?: number; includeIds?: string[]; excludeIds?: string[] };

function scopedPage(query: any, worker: AnyRow, scope: string, page: number, leadId?: string, options: PageOptions = {}) {
  // Apply access and workflow filters before pagination, so another central's
  // rows or recent closed leads cannot push permitted pending leads out.
  const alternatives: string[] = [];
  if (leadId) query = query.eq("id", leadId);
  if (options.includeIds?.length) query = query.in("id", options.includeIds);
  if (options.excludeIds?.length) query = query.not("id", "in", `(${options.excludeIds.join(",")})`);
  if (worker.role === "central") alternatives.push(`assigned_worker_id.is.null,assigned_worker_id.eq.${worker.id}`);
  if (scope === "pendientes") {
    query = query.is("closed_at", null);
    alternatives.push(`estado.is.null,estado.not.in.(${CLOSED_STATES.join(",")})`);
  } else if (scope === "cerrados") {
    alternatives.push(`closed_at.not.is.null,estado.in.(${CLOSED_STATES.join(",")})`);
  }
  if (alternatives.length) query = query.or(alternatives.length === 1 ? alternatives[0] : `and(${alternatives.map(filter => `or(${filter})`).join(",")})`);
  return query.order("created_at", { ascending: false }).order("id", { ascending: false })
    .range(options.from ?? page * PAGE_SIZE, options.to ?? (page + 1) * PAGE_SIZE - 1);
}

async function currentWorker(req: NextRequest) {
  const token = getBearerToken(req);
  if (!token) return null;
  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !authData.user?.id) return null;
  const { data } = await supabase
    .from("workers")
    .select("id,role,display_name,is_active")
    .or(`user_id.eq.${authData.user.id},auth_user_id.eq.${authData.user.id}`)
    .eq("is_active", true)
    .in("role", ["admin", "central"])
    .limit(1)
    .maybeSingle();
  return data || null;
}

function norm(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function computeWorkflowState(item: AnyRow) {
  const estado = norm(item?.estado);
  if (["cliente", "captado"].includes(estado)) return "cliente";
  if (item?.closed_at || ["no_interesado", "numero_invalido", "perdido", "cerrado", "finalizado"].includes(estado)) {
    return "cerrado";
  }
  if (["pend_free", "pendiente_free", "no_contesta", "sin_respuesta", "reintento_2", "reintento_3"].includes(estado)) return "pend_free";
  if (["pend_cap", "hizo_free", "recontacto"].includes(estado)) return "pend_cap";

  return "nuevo";
}

function isClosed(item: AnyRow) {
  const estado = norm(item?.estado);
  return Boolean(
    item?.closed_at ||
    ["cliente", "captado", "no_interesado", "numero_invalido", "perdido", "cerrado", "finalizado"].includes(estado)
  );
}

async function fetchWithJoin(worker: AnyRow, scope: string, page: number, leadId?: string, options: PageOptions = {}) {
  const { data, error } = await scopedPage(supabase
    .from("captacion_leads")
    .select(`
      id,
      cliente_id,
      estado,
      intento_actual,
      max_intentos,
      next_contact_at,
      last_contact_at,
      contacted_at,
      closed_at,
      last_result,
      campaign_name,
      form_name,
      origen,
      notas,
      assigned_worker_id,
      assigned_role,
      created_at,
      updated_at,
      cliente:crm_clientes(
        id,
        nombre,
        apellido,
        telefono,
        email,
        origen,
        lead_status,
        lead_contacted_at,
        lead_campaign_name,
        lead_form_name,
        created_at
      )
    `), worker, scope, page, leadId, options);

  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

async function fetchFallback(worker: AnyRow, scope: string, page: number, leadId?: string, options: PageOptions = {}) {
  const { data, error } = await scopedPage(supabase
    .from("captacion_leads")
    .select("id, cliente_id, estado, intento_actual, max_intentos, next_contact_at, last_contact_at, contacted_at, closed_at, last_result, campaign_name, form_name, origen, notas, assigned_worker_id, assigned_role, created_at, updated_at"), worker, scope, page, leadId, options);

  if (error) throw error;

  const rows = Array.isArray(data) ? data : [];

  const clienteIds = Array.from(
    new Set(rows.map((x: AnyRow) => String(x?.cliente_id || "").trim()).filter(Boolean))
  );

  if (!clienteIds.length) return rows;

  const { data: clientes, error: clientesErr } = await supabase
    .from("crm_clientes")
    .select("id, nombre, apellido, telefono, email, origen, lead_status, lead_contacted_at, lead_campaign_name, lead_form_name, created_at")
    .in("id", clienteIds);

  if (clientesErr) throw clientesErr;

  const byId = new Map((clientes || []).map((c: AnyRow) => [String(c.id), c]));

  return rows.map((row: AnyRow) => ({
    ...row,
    cliente: byId.get(String(row?.cliente_id || "")) || null,
  }));
}

async function fetchRows(worker: AnyRow, scope: string, page: number, leadId?: string, options: PageOptions = {}) {
  try { return await fetchWithJoin(worker, scope, page, leadId, options); }
  catch { return fetchFallback(worker, scope, page, leadId, options); }
}

function permittedRows(rows: AnyRow[], worker: AnyRow, brand: BrandKey) {
  return rows.filter(row => originMatchesBrand(row?.cliente?.origen || row?.origen, brand)
    && (worker.role === "admin" || !row.assigned_worker_id || String(row.assigned_worker_id) === String(worker.id)));
}

async function priorityRows(worker: AnyRow, brand: BrandKey, latest: Map<string, string>, now: number, leadId?: string) {
  const ids = [...latest.keys()].filter(id => !leadId || id === leadId);
  const rows: AnyRow[] = [];
  for (let offset = 0; offset < ids.length; offset += ID_BATCH_SIZE) {
    // Ignore the previous workflow only for selecting new requests. The actual
    // state/closed_at are preserved; no database record is reopened by this GET.
    const batch = await fetchRows(worker, "todos", 0, leadId, { includeIds: ids.slice(offset, offset + ID_BATCH_SIZE) });
    rows.push(...permittedRows(batch, worker, brand).filter(row => pendingMetaSubmissionAt(row, latest.get(String(row.id)), now)));
  }
  return rows.sort((a, b) => latest.get(String(b.id))!.localeCompare(latest.get(String(a.id))!) || String(a.id).localeCompare(String(b.id)));
}

async function ordinaryRows(worker: AnyRow, scope: string, leadId: string | undefined, offset: number, count: number, excludedIds: string[]) {
  if (!count) return [];
  if (excludedIds.length <= ID_BATCH_SIZE) {
    return fetchRows(worker, scope, 0, leadId, { from: offset, to: offset + count - 1, excludeIds: excludedIds });
  }
  // Avoid an unbounded NOT IN URL when a campaign brings hundreds of forms.
  // Scan only IDs in stable pages, then hydrate the requested ordinary window.
  const excluded = new Set(excludedIds);
  const selected: string[] = [];
  let skipped = 0;
  for (let page = 0; ; page++) {
    const { data, error } = await scopedPage(supabase.from("captacion_leads").select("id"), worker, scope, page, leadId);
    if (error || !Array.isArray(data)) throw new Error("CAPTACION_UNAVAILABLE");
    for (const row of data) {
      if (excluded.has(String(row.id))) continue;
      if (skipped++ < offset) continue;
      selected.push(String(row.id));
      if (selected.length === count) break;
    }
    if (selected.length === count || data.length < PAGE_SIZE) break;
  }
  const rows: AnyRow[] = [];
  for (let start = 0; start < selected.length; start += ID_BATCH_SIZE) {
    const ids = selected.slice(start, start + ID_BATCH_SIZE);
    rows.push(...await fetchRows(worker, scope, 0, leadId, { includeIds: ids, from: 0, to: ids.length - 1 }));
  }
  return rows;
}

function cleanNum(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function paymentMoveKey(clienteId: string, amount: number, dateValue: string | null | undefined) {
  const day = dateValue ? String(dateValue).slice(0, 10) : "sin-fecha";
  return clienteId + "::" + amount.toFixed(2) + "::" + day;
}

async function enrichWithRevenue(rows: AnyRow[]) {
  const clienteIds = Array.from(
    new Set(rows.map((x: AnyRow) => String(x?.cliente_id || x?.cliente?.id || "").trim()).filter(Boolean))
  );

  if (!clienteIds.length) return rows;

  const since30Iso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [{ data: pagos }, { data: rendimiento }] = await Promise.all([
    supabase
      .from("crm_cliente_pagos")
      .select("cliente_id, importe, estado, created_at")
      .in("cliente_id", clienteIds)
      .eq("estado", "completed")
      .order("created_at", { ascending: true }),
    supabase
      .from("rendimiento_llamadas")
      .select("cliente_id, importe, fecha_hora")
      .in("cliente_id", clienteIds)
      .gt("importe", 0)
      .order("fecha_hora", { ascending: true }),
  ]);

  const byCliente = new Map<string, any>();
  const seen = new Set<string>();

  function ensure(clienteId: string) {
    if (!byCliente.has(clienteId)) {
      byCliente.set(clienteId, {
        cliente_revenue_total: 0,
        cliente_revenue_30d: 0,
        cliente_completed_payments_count: 0,
        cliente_first_payment_at: null,
        cliente_last_payment_at: null,
        converted_first_payment: false,
      });
    }
    return byCliente.get(clienteId);
  }

  function addMove(clienteIdRaw: any, amountRaw: any, dateRaw: any) {
    const clienteId = String(clienteIdRaw || "").trim();
    const amount = cleanNum(amountRaw);
    const dateValue = dateRaw ? String(dateRaw) : null;
    if (!clienteId || !(amount > 0)) return;

    const key = paymentMoveKey(clienteId, amount, dateValue);
    if (seen.has(key)) return;
    seen.add(key);

    const row = ensure(clienteId);
    row.cliente_revenue_total += amount;
    if (dateValue && dateValue >= since30Iso) row.cliente_revenue_30d += amount;
    row.cliente_completed_payments_count += 1;
    row.converted_first_payment = true;

    if (!row.cliente_first_payment_at || new Date(dateValue || 0).getTime() < new Date(row.cliente_first_payment_at || 0).getTime()) {
      row.cliente_first_payment_at = dateValue;
    }
    if (!row.cliente_last_payment_at || new Date(dateValue || 0).getTime() > new Date(row.cliente_last_payment_at || 0).getTime()) {
      row.cliente_last_payment_at = dateValue;
    }
  }

  for (const pago of pagos || []) addMove((pago as any)?.cliente_id, (pago as any)?.importe, (pago as any)?.created_at);
  for (const row of rendimiento || []) addMove((row as any)?.cliente_id, (row as any)?.importe, (row as any)?.fecha_hora);

  return rows.map((row: AnyRow) => {
    const clienteId = String(row?.cliente_id || row?.cliente?.id || "").trim();
    const revenue = byCliente.get(clienteId);
    if (!revenue) {
      return {
        ...row,
        cliente_revenue_total: 0,
        cliente_revenue_30d: 0,
        cliente_completed_payments_count: 0,
        cliente_first_payment_at: null,
        cliente_last_payment_at: null,
        converted_first_payment: false,
      };
    }

    return {
      ...row,
      cliente_revenue_total: Number(cleanNum(revenue.cliente_revenue_total).toFixed(2)),
      cliente_revenue_30d: Number(cleanNum(revenue.cliente_revenue_30d).toFixed(2)),
      cliente_completed_payments_count: cleanNum(revenue.cliente_completed_payments_count),
      cliente_first_payment_at: revenue.cliente_first_payment_at,
      cliente_last_payment_at: revenue.cliente_last_payment_at,
      converted_first_payment: Boolean(revenue.converted_first_payment),
    };
  });
}

export async function GET(req: NextRequest) {
  try {
    const worker = await currentWorker(req);
    if (!worker) {
      return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    }
    const { searchParams } = new URL(req.url);
    const scope = norm(searchParams.get("scope") || "pendientes");
    const brand = searchParams.get("brand") || searchParams.get("marca") || "celestial";
    if (brand !== "celestial" && brand !== "orion") {
      return NextResponse.json({ ok: false, error: "INVALID_BRAND" }, { status: 400 });
    }
    const page = Number(searchParams.get("page") || 0);
    const leadId = searchParams.get("lead_id") || undefined;
    if (leadId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(leadId)) {
      return NextResponse.json({ ok: false, error: "INVALID_LEAD_ID" }, { status: 400 });
    }
    if (!Number.isSafeInteger(page) || page < 0 || page > 100_000 || !["pendientes", "cerrados", "todos"].includes(scope)) {
      return NextResponse.json({ ok: false, error: "INVALID_PAGINATION" }, { status: 400 });
    }

    const now = Date.now();
    // The event ledger now determines pagination and historical reentries. A
    // failed read must retain the UI's last good list, not silently hide requests.
    const latestMeta = await recentMetaSubmissions(supabase, now);
    const pendingNew = await priorityRows(worker, brand, latestMeta, now, leadId);
    const priority = scope === "cerrados" ? [] : pendingNew;
    const pageStart = page * PAGE_SIZE;
    const highlighted = priority.slice(pageStart, pageStart + PAGE_SIZE);
    const normalCount = PAGE_SIZE - highlighted.length;
    const normalStart = Math.max(0, pageStart - priority.length);
    // Prioritize across the entire result set BEFORE pagination. A repeat form
    // on an old client must not be buried behind hundreds of newer CRM rows.
    const ordinary = await ordinaryRows(worker, scope, leadId, normalStart, normalCount, pendingNew.map(row => String(row.id)));
    const hasMore = priority.length >= pageStart + PAGE_SIZE || (normalCount > 0 && ordinary.length === normalCount);
    let raw = [...highlighted, ...ordinary];

    // Importante para Supabase Nano: la vista de captación no necesita calcular ingresos
    // de cada cliente en cada refresco. Evitamos agregaciones pesadas en pagos/rendimiento.

    // Advance over raw pages even if a page contains only the other brand.
    raw = permittedRows(raw, worker, brand);

    const workerIds = Array.from(new Set(raw.map((item) => String(item?.assigned_worker_id || "")).filter(Boolean)));
    const workerNames = new Map<string, string>();
    if (workerIds.length) {
      const { data: assignedWorkers } = await supabase.from("workers").select("id,display_name").in("id", workerIds);
      for (const item of assignedWorkers || []) workerNames.set(String(item.id), String(item.display_name || "Central"));
    }

    let items: LeadItem[] = raw.map((item) => ({
      ...item,
      assigned_worker_name: workerNames.get(String(item?.assigned_worker_id || "")) || null,
      latest_meta_lead_at: latestMeta.get(String(item.id)) || null,
      new_submission_pending: Boolean(pendingMetaSubmissionAt(item, latestMeta.get(String(item.id)), now)),
      reentry_pending: isClosed(item) && Boolean(pendingMetaSubmissionAt(item, latestMeta.get(String(item.id)), now)),
      workflow_state: computeWorkflowState(item),
      is_closed: isClosed(item),
    }));

    if (scope === "pendientes") {
      items = items.filter((item) => !item.is_closed || item.new_submission_pending);
    } else if (scope === "cerrados") {
      items = items.filter((item) => item.is_closed && !item.new_submission_pending);
    }

    items.sort((a, b) => {
      const aRecent = pendingMetaSubmissionAt(a, a.latest_meta_lead_at, now);
      const bRecent = pendingMetaSubmissionAt(b, b.latest_meta_lead_at, now);
      if (aRecent !== bRecent) return bRecent - aRecent;
      const aNext = a.next_contact_at ? new Date(a.next_contact_at).getTime() : Number.MAX_SAFE_INTEGER;
      const bNext = b.next_contact_at ? new Date(b.next_contact_at).getTime() : Number.MAX_SAFE_INTEGER;

      const aDue = Number.isFinite(aNext) && aNext <= Date.now() ? 0 : 1;
      const bDue = Number.isFinite(bNext) && bNext <= Date.now() ? 0 : 1;

      if (aDue !== bDue) return aDue - bDue;
      if (aNext !== bNext) return aNext - bNext;

      const aCreated = a.created_at ? new Date(a.created_at).getTime() : 0;
      const bCreated = b.created_at ? new Date(b.created_at).getTime() : 0;

      return bCreated - aCreated;
    });

    let metaDiagnostics: AnyRow | undefined;
    if (worker.role === "admin") {
      let lastEvent: AnyRow | null = null;
      let eventReadAvailable = true;
      try {
      const { data, error } = await supabase
        .from("meta_lead_events")
        .select("status,source,received_at,inserted_at,visible_at")
        .order("received_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      lastEvent = data || null;
      } catch { eventReadAvailable = false; }
      const configured = (key: string) => Boolean(String(process.env[key] || "").trim());
      metaDiagnostics = {
        configuration: {
          access_token: configured("META_ACCESS_TOKEN"),
          form_ids: Boolean(String(process.env.META_FORM_IDS || "").split(",").some(value => value.trim())),
          app_secret: configured("META_APP_SECRET"),
          verify_token: configured("META_VERIFY_TOKEN"),
          internal_ingest: configured("META_INGEST_SECRET"),
          reconciliation_auth: configured("CRON_SECRET"),
        },
        last_event: lastEvent,
        event_read_available: eventReadAvailable,
      };
    }

    return new NextResponse(JSON.stringify({ ok: true, brand, items, server_time: new Date(now).toISOString(), pagination: { page, page_size: PAGE_SIZE, next_page: hasMore ? page + 1 : null, has_more: hasMore }, meta_diagnostics: metaDiagnostics }), {
      headers: {
        "Cache-Control": "private, no-store, no-cache, must-revalidate, proxy-revalidate",
      },
    });

  } catch {
    return new NextResponse(
      JSON.stringify({ ok: false, error: "ERR_CAPTACION_LIST" }),
      {
        status: 503,
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  }
}
