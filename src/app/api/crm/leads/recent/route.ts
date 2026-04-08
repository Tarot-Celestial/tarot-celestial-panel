import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function adminClient() {
  return createClient(getEnv("NEXT_PUBLIC_SUPABASE_URL"), getEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });
}

async function uidFromBearer(req: Request) {
  const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anon = getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return null;

  const sb = createClient(url, anon, {
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
    .select("id, user_id, display_name, role")
    .eq("user_id", uid)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function selectWithLeadColumns(limit: number) {
  const admin = adminClient();
  const { data, error } = await admin
    .from("crm_clientes")
    .select(
      "id, created_at, nombre, apellido, telefono, email, origen, lead_status, lead_source, lead_campaign_name, lead_form_name, lead_contacted_at"
    )
    .or("origen.ilike.%facebook%,origen.ilike.%meta%,lead_source.ilike.%facebook%,lead_source.ilike.%meta%")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data || [];
}

async function selectFallback(limit: number) {
  const admin = adminClient();
  const { data, error } = await admin
    .from("crm_clientes")
    .select("id, created_at, nombre, apellido, telefono, email, origen")
    .or("origen.ilike.%facebook%,origen.ilike.%meta%")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data || []).map((row: any) => ({
    ...row,
    lead_status: null,
    lead_source: row?.origen || null,
    lead_campaign_name: null,
    lead_form_name: null,
    lead_contacted_at: null,
  }));
}

export async function GET(req: Request) {
  try {
    const worker = await workerFromReq(req);
    if (!worker) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    if (!["admin", "central"].includes(String(worker.role || ""))) {
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const limit = Math.min(20, Math.max(1, Number(searchParams.get("limit") || 6) || 6));
    const minutes = Math.min(24 * 60, Math.max(5, Number(searchParams.get("minutes") || 180) || 180));
    const since = Date.now() - minutes * 60 * 1000;

    let rows: any[] = [];
    try {
      rows = await selectWithLeadColumns(limit * 3);
    } catch {
      rows = await selectFallback(limit * 3);
    }

    const items = (rows || [])
      .filter((row) => {
        const createdAt = new Date(String(row?.created_at || 0)).getTime();
        if (!createdAt || Number.isNaN(createdAt)) return false;
        if (createdAt < since) return false;
        if (row?.lead_contacted_at) return false;
        const status = String(row?.lead_status || "").toLowerCase();
        if (["contactado", "won", "closed"].includes(status)) return false;
        return true;
      })
      .slice(0, limit)
      .map((row) => ({
        id: row.id,
        nombre_completo: [row?.nombre, row?.apellido].filter(Boolean).join(" ").trim() || "Lead Facebook",
        telefono: row?.telefono || null,
        email: row?.email || null,
        origen: row?.lead_source || row?.origen || "facebook_ads",
        campaign_name: row?.lead_campaign_name || null,
        form_name: row?.lead_form_name || null,
        created_at: row?.created_at || null,
        lead_status: row?.lead_status || null,
        lead_contacted_at: row?.lead_contacted_at || null,
      }));

    return NextResponse.json({ ok: true, leads: items });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || "ERR" }, { status: 500 });
  }
}
