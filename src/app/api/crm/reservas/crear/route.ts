import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

async function uidFromBearer(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return { uid: null as string | null };

  const userClient = createClient(
    getEnv("NEXT_PUBLIC_SUPABASE_URL"),
    getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    }
  );

  const { data, error } = await userClient.auth.getUser();
  if (error) throw error;
  return { uid: data.user?.id || null };
}

function adminDb() {
  return createClient(
    getEnv("NEXT_PUBLIC_SUPABASE_URL"),
    getEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } }
  );
}

async function getClienteById(db: ReturnType<typeof adminDb>, clienteId: string) {
  const candidates = ["crm_clientes", "clientes", "crm_clientes_panel"];

  for (const table of candidates) {
    const { data, error } = await db
      .from(table)
      .select("id, nombre, apellido, telefono")
      .eq("id", clienteId)
      .maybeSingle();

    if (!error && data) {
      return data;
    }

    const msg = String(error?.message || "");
    if (
      msg.includes("schema cache") ||
      msg.includes("relation") ||
      msg.includes("does not exist")
    ) {
      continue;
    }

    if (error) throw error;
  }

  return null;
}

export async function POST(req: Request) {
  try {
    const { uid } = await uidFromBearer(req);
    if (!uid) {
      return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    }

    const db = adminDb();

    const { data: me, error: meErr } = await db
      .from("workers")
      .select("id, role")
      .eq("user_id", uid)
      .maybeSingle();

    if (meErr) throw meErr;
    if (!me || (me.role !== "admin" && me.role !== "central")) {
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));

    const cliente_id = String(body?.cliente_id || "").trim();
    const tarotista_worker_id = String(body?.tarotista_worker_id || "").trim() || null;
    const tarotista_nombre_manual = String(body?.tarotista_nombre_manual || "").trim() || null;
    const fecha_reserva = String(body?.fecha_reserva || "").trim();
    const nota = String(body?.nota || "").trim() || null;

    if (!cliente_id) {
      return NextResponse.json({ ok: false, error: "CLIENTE_REQUIRED" }, { status: 400 });
    }
    if (!fecha_reserva) {
      return NextResponse.json({ ok: false, error: "FECHA_REQUIRED" }, { status: 400 });
    }
    if (!tarotista_worker_id && !tarotista_nombre_manual) {
      return NextResponse.json({ ok: false, error: "TAROTISTA_REQUIRED" }, { status: 400 });
    }

    const cliente = await getClienteById(db, cliente_id);
    if (!cliente) {
      return NextResponse.json({ ok: false, error: "CLIENTE_NOT_FOUND" }, { status: 404 });
    }

    let tarotista_display_name: string | null = null;
    if (tarotista_worker_id) {
      const { data: tarotista, error: tarotistaErr } = await db
        .from("workers")
        .select("id, display_name")
        .eq("id", tarotista_worker_id)
        .maybeSingle();

      if (tarotistaErr) throw tarotistaErr;
      tarotista_display_name = tarotista?.display_name || null;
    }

    const payload: Record<string, any> = {
      cliente_id,
      cliente_nombre: [cliente?.nombre, cliente?.apellido].filter(Boolean).join(" ").trim() || null,
      cliente_telefono: cliente?.telefono || null,
      tarotista_worker_id,
      tarotista_display_name,
      tarotista_nombre_manual,
      fecha_reserva: new Date(fecha_reserva).toISOString(),
      estado: "pendiente",
      nota,
      created_by_worker_id: me.id,
    };

    const { data: inserted, error } = await db
      .from("reservas")
      .insert(payload)
      .select("id")
      .single();

    if (error) throw error;

    return NextResponse.json({ ok: true, id: inserted.id });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || "ERR" },
      { status: 500 }
    );
  }
}
