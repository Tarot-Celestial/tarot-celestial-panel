export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "@supabase/supabase-js";
import { createClient } from "@supabase/supabase-js";

function env(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

const supabase = createClient(
  env("NEXT_PUBLIC_SUPABASE_URL"),
  env("SUPABASE_SERVICE_ROLE_KEY")
);

// 🔥 estados cerrados (solo estos se excluyen)
const CLOSED_STATUSES = new Set([
  "contactado",
  "no_interesado",
  "numero_invalido",
  "perdido",
]);

// 🔥 estados válidos abiertos (para normalizar)
const OPEN_STATUSES = new Set([
  "nuevo",
  "reintento_2",
  "reintento_3",
]);

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const scope = String(searchParams.get("scope") || "pendientes")
      .trim()
      .toLowerCase();

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
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      );
    }

    let items = Array.isArray(data) ? data : [];

    // 🔥 NORMALIZACIÓN CLAVE (esto arregla TODO)
    items = items.map((item: any) => {
      let estado = String(item?.estado || "").toLowerCase().trim();

      // 👉 si no tiene estado → es nuevo
      if (!estado) estado = "nuevo";

      // 👉 si viene raro (ej: nuevo_lead)
      if (!OPEN_STATUSES.has(estado) && !CLOSED_STATUSES.has(estado)) {
        estado = "nuevo";
      }

      return {
        ...item,
        estado,
      };
    });

    // 🔥 FILTRO ROBUSTO
    if (scope === "pendientes") {
      items = items.filter(
        (item: any) => !CLOSED_STATUSES.has(item.estado)
      );
    }

    // 🔥 ORDEN TIPO CALL CENTER
    items.sort((a: any, b: any) => {
      const now = Date.now();

      const aNext = a?.next_contact_at
        ? new Date(a.next_contact_at).getTime()
        : 0;
      const bNext = b?.next_contact_at
        ? new Date(b.next_contact_at).getTime()
        : 0;

      const aDue = aNext && aNext <= now ? 1 : 0;
      const bDue = bNext && bNext <= now ? 1 : 0;

      // primero los que toca llamar
      if (aDue !== bDue) return bDue - aDue;

      // luego por fecha de contacto
      if (aNext !== bNext) return aNext - bNext;

      // luego por antigüedad
      const aCreated = a?.created_at
        ? new Date(a.created_at).getTime()
        : 0;
      const bCreated = b?.created_at
        ? new Date(b.created_at).getTime()
        : 0;

      return aCreated - bCreated;
    });

    return NextResponse.json({ ok: true, items });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || "ERR" },
      { status: 500 }
    );
  }
}
