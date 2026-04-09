export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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

const CLOSED_STATES = new Set(["captado", "no_interesado", "numero_invalido", "perdido", "cerrado", "finalizado"]);

function norm(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function computeWorkflowState(item: AnyRow) {
  const estado = norm(item?.estado);
  const crmLead = norm(item?.cliente?.lead_status);
  const last = norm(item?.last_result);
  const intento = Number(item?.intento_actual || 1);

  // IMPORTANTE: si captacion_leads ya tiene un estado, ese manda.
  // No dejamos que CRM o last_result pisen el estado real del lead.
  if (estado === "captado") return "captado";
  if (["no_interesado", "numero_invalido", "perdido", "cerrado", "finalizado"].includes(estado)) return estado;
  if (estado === "pendiente_free") return "pendiente_free";
  if (["hizo_free", "recontacto"].includes(estado)) return estado;
  if (["no_contesta", "reintento_2", "reintento_3", "sin_respuesta"].includes(estado)) return "no_contesta";
  if (estado === "nuevo") return "nuevo";

  // Solo hacemos fallback si estado viene vacío o nulo.
  if (crmLead === "captado") return "captado";
  if (["no_interesado", "numero_invalido", "perdido", "cerrado", "finalizado"].includes(crmLead)) return crmLead;
  if (crmLead === "pendiente_free") return "pendiente_free";
  if (["hizo_free", "recontacto"].includes(crmLead)) return crmLead;
  if (["no_contesta", "sin_respuesta"].includes(crmLead)) return "no_contesta";

  if (last === "captado") return "captado";
  if (last === "no_contesta") return "no_contesta";
  if (last === "no_interesado") return "no_interesado";

  if (intento > 1 && !item?.closed_at) return "no_contesta";

  return "nuevo";
}

function isClosed(item: AnyRow) {
  const estado = norm(item?.estado);
  return Boolean(
    item?.closed_at ||
    ["captado", "no_interesado", "numero_invalido", "perdido", "cerrado", "finalizado"].includes(estado)
  );
}

async function fetchWithJoin() {
  const { data, error } = await supabase
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
    `)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

async function fetchFallback() {
  const { data, error } = await supabase
    .from("captacion_leads")
    .select("id, cliente_id, estado, intento_actual, max_intentos, next_contact_at, last_contact_at, contacted_at, closed_at, last_result, campaign_name, form_name, origen, notas, assigned_worker_id, assigned_role, created_at, updated_at")
    .order("created_at", { ascending: false });

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

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const scope = norm(searchParams.get("scope") || "pendientes");

    let raw: AnyRow[] = [];

    try {
      raw = await fetchWithJoin();
    } catch {
      raw = await fetchFallback();
    }

    let items: LeadItem[] = raw.map((item) => ({
      ...item,
      workflow_state: computeWorkflowState(item),
      is_closed: isClosed(item),
    }));

    if (scope === "pendientes") {
      items = items.filter((item) => !item.is_closed);
    } else if (scope === "cerrados") {
      items = items.filter((item) => item.is_closed);
    }

    items.sort((a, b) => {
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

    return NextResponse.json({ ok: true, items });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || "ERR_CAPTACION_LIST" },
      { status: 500 }
    );
  }
}
