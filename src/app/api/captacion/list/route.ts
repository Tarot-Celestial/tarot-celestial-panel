import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

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

export async function GET(req: Request) {
  try {
    const worker = await workerFromReq(req);
    if (!worker) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    if (!["admin", "central"].includes(String(worker.role || ""))) {
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    }

    const admin = adminClient();
    const { searchParams } = new URL(req.url);
    const scope = String(searchParams.get("scope") || "pendientes");

    let query = admin
      .from("captacion_leads")
      .select("id, cliente_id, estado, intento_actual, max_intentos, next_contact_at, last_contact_at, contacted_at, closed_at, last_result, notas, created_at, updated_at, campaign_name, form_name, origen")
      .order("next_contact_at", { ascending: true })
      .order("created_at", { ascending: false })
      .limit(scope === "todos" ? 200 : 120);

    if (scope !== "todos") {
      query = query.in("estado", ["nuevo", "reintento_2", "reintento_3"]);
    }

    const { data, error } = await query;
    if (error) throw error;

    const rows = Array.isArray(data) ? data : [];
    const now = Date.now();

    const filtered = scope === "todos"
      ? rows
      : rows.filter((row: any) => {
          const t = new Date(String(row?.next_contact_at || row?.created_at || 0)).getTime();
          return Number.isFinite(t) && t <= now;
        });

    const clienteIds = [...new Set(filtered.map((row: any) => String(row?.cliente_id || "")).filter(Boolean))];
    const clientesMap = new Map<string, any>();

    if (clienteIds.length) {
      const { data: clientes, error: clientesError } = await admin
        .from("crm_clientes")
        .select("id, nombre, apellido, telefono, email, origen")
        .in("id", clienteIds);
      if (clientesError) throw clientesError;
      for (const cliente of clientes || []) {
        clientesMap.set(String(cliente.id), cliente);
      }
    }

    const items = filtered.map((row: any) => ({
      ...row,
      cliente: clientesMap.get(String(row?.cliente_id || "")) || null,
    }));

    return NextResponse.json({ ok: true, items });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || "ERR" }, { status: 500 });
  }
}
