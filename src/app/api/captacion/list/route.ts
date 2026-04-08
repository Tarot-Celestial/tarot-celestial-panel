export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function env(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function adminClient() {
  return createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });
}

async function uidFromBearer(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return null;

  const sb = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });

  const { data, error } = await sb.auth.getUser();
  if (error) throw error;
  return data.user?.id || null;
}

async function workerFromReq(req: Request) {
  const uid = await uidFromBearer(req);
  if (!uid) return null;
  const admin = adminClient();
  const { data, error } = await admin
    .from("workers")
    .select("id, user_id, display_name, email, role")
    .eq("user_id", uid)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

export async function GET(req: NextRequest) {
  try {
    const worker = await workerFromReq(req);
    if (!worker) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    if (!["admin", "central"].includes(String(worker.role || ""))) {
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const scope = String(searchParams.get("scope") || "pendientes").trim();

    const admin = adminClient();
    let query = admin
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
      .order("next_contact_at", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false });

    if (scope === "pendientes") {
      query = query.not("estado", "in", '("contactado","no_interesado","numero_invalido","perdido")');
    }

    // En este panel interno tanto admin como central deben ver todos los leads.
    // La asignación se usa para seguimiento, no para restringir la lectura.

    const { data, error } = await query;
    if (error) throw error;

    const now = Date.now();
    const items = (data || []).map((item: any) => {
      const nextTs = item?.next_contact_at ? new Date(item.next_contact_at).getTime() : null;
      const isClosed = ["contactado", "no_interesado", "numero_invalido", "perdido"].includes(String(item?.estado || ""));
      const overdueMinutes = !isClosed && Number.isFinite(nextTs) ? Math.max(0, Math.floor((now - Number(nextTs)) / 60000)) : 0;
      const priority = isClosed ? "closed" : overdueMinutes >= 60 ? "critical" : overdueMinutes > 0 ? "high" : String(item?.estado || "") === "nuevo" ? "high" : "normal";
      return {
        ...item,
        overdue_minutes: overdueMinutes,
        due_now: !isClosed && Number.isFinite(nextTs) ? Number(nextTs) <= now : false,
        priority,
      };
    });

    return NextResponse.json({ ok: true, items });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || "ERR" }, { status: 500 });
  }
}
