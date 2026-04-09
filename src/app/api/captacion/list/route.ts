export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function env(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

const supabase = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));

const CLOSED_STATUSES = new Set(["contactado", "no_interesado", "numero_invalido", "perdido"]);
const OPEN_STATUSES = new Set(["nuevo", "reintento_2", "reintento_3"]);

function normalizeState(raw: unknown, item: any) {
  const estado = String(raw || "").toLowerCase().trim();
  const crmStatus = String(item?.cliente?.lead_status || "").toLowerCase().trim();

  if (item?.closed_at || item?.contacted_at) {
    if (estado === "contactado" || crmStatus === "contactado") return "contactado";
    if (crmStatus === "no_interesado") return "no_interesado";
    if (crmStatus === "numero_invalido") return "numero_invalido";
    return estado || "perdido";
  }

  if (CLOSED_STATUSES.has(estado) || OPEN_STATUSES.has(estado)) return estado;

  if (["seguimiento", "sin_respuesta"].includes(crmStatus)) {
    const intento = Number(item?.intento_actual || 1);
    if (intento >= 3) return "reintento_3";
    if (intento >= 2) return "reintento_2";
    return "nuevo";
  }

  if (["contactado", "no_interesado", "numero_invalido", "perdido"].includes(crmStatus)) {
    if (crmStatus === "sin_respuesta") return "perdido";
    return crmStatus;
  }

  return "nuevo";
}

function isClosed(item: any) {
  const estado = String(item?.estado || "").toLowerCase();
  const crmStatus = String(item?.cliente?.lead_status || "").toLowerCase();
  return Boolean(
    item?.closed_at ||
      item?.contacted_at ||
      CLOSED_STATUSES.has(estado) ||
      ["contactado", "no_interesado", "numero_invalido", "sin_respuesta", "perdido"].includes(crmStatus)
  );
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const scope = String(searchParams.get("scope") || "pendientes").trim().toLowerCase();

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
        assigned_worker_id,
        assigned_role,
        notas,
        created_at,
        updated_at,
        cliente:crm_clientes(
          id,
          nombre,
          apellido,
          telefono,
          email,
          origen,
          estado,
          lead_status,
          lead_campaign_name,
          lead_form_name,
          created_at
        )
      `)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    let items = (Array.isArray(data) ? data : []).map((item: any) => ({
      ...item,
      estado: normalizeState(item?.estado, item),
    }));

    if (scope === "pendientes") {
      items = items.filter((item: any) => !isClosed(item));
    }

    items.sort((a: any, b: any) => {
      const now = Date.now();
      const aNext = a?.next_contact_at ? new Date(a.next_contact_at).getTime() : 0;
      const bNext = b?.next_contact_at ? new Date(b.next_contact_at).getTime() : 0;
      const aDue = aNext && aNext <= now ? 1 : 0;
      const bDue = bNext && bNext <= now ? 1 : 0;
      if (aDue !== bDue) return bDue - aDue;
      if (aNext !== bNext) return aNext - bNext;
      const aCreated = a?.created_at ? new Date(a.created_at).getTime() : 0;
      const bCreated = b?.created_at ? new Date(b.created_at).getTime() : 0;
      return aCreated - bCreated;
    });

    return NextResponse.json({ ok: true, items });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || "ERR" }, { status: 500 });
  }
}
