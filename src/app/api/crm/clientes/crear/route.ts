import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function adminClient() {
  return createClient(
    getEnv("NEXT_PUBLIC_SUPABASE_URL"),
    getEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } }
  );
}

async function uidFromBearer(req: Request) {
  const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anon = getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";

  if (!token) return null;

  const sb = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data } = await sb.auth.getUser();
  return data.user?.id || null;
}

async function workerFromReq(req: Request) {
  const uid = await uidFromBearer(req);
  if (!uid) return null;

  const admin = adminClient();

  const { data, error } = await admin
    .from("workers")
    .select("id, user_id, display_name, role, team, state")
    .eq("user_id", uid)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

function normalizePhone(v: any) {
  return String(v || "").replace(/[^\d+]/g, "").trim();
}

export async function POST(req: Request) {
  try {
    const worker = await workerFromReq(req);
    if (!worker) {
      return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    }

    if (!["admin", "central"].includes(String(worker.role || ""))) {
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));

    const nombre = String(body?.nombre || "").trim();
    const apellido = String(body?.apellido || "").trim();
    const telefono = normalizePhone(body?.telefono);
    const pais = String(body?.pais || "").trim();
    const email = String(body?.email || "").trim();
    const notas = String(body?.notas || "").trim();
    const origen = String(body?.origen || "manual").trim();

    const deuda_pendiente = Number(body?.deuda_pendiente || 0) || 0;
    const minutos_free_pendientes = Number(body?.minutos_free_pendientes || 0) || 0;
    const minutos_normales_pendientes = Number(body?.minutos_normales_pendientes || 0) || 0;

    if (!nombre) {
      return NextResponse.json({ ok: false, error: "FALTA_NOMBRE" }, { status: 400 });
    }

    if (!telefono) {
      return NextResponse.json({ ok: false, error: "FALTA_TELEFONO" }, { status: 400 });
    }

    const admin = adminClient();

    const { data: existing, error: existingError } = await admin
      .from("crm_clientes")
      .select("id, nombre, apellido, telefono")
      .eq("telefono", telefono)
      .maybeSingle();

    if (existingError) throw existingError;

    if (existing) {
      return NextResponse.json(
        { ok: false, error: "CLIENTE_YA_EXISTE", cliente: existing },
        { status: 409 }
      );
    }

    const payload: any = {
      nombre,
      apellido: apellido || null,
      telefono,
      pais: pais || null,
      email: email || null,
      notas: notas || null,
      origen: origen || "manual",
      deuda_pendiente,
      minutos_free_pendientes,
      minutos_normales_pendientes,
    };

    const { data: cliente, error } = await admin
      .from("crm_clientes")
      .insert(payload)
      .select("*")
      .single();

    if (error) throw error;

    return NextResponse.json({
      ok: true,
      cliente,
      msg: "Cliente creado correctamente",
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "ERR" },
      { status: 500 }
    );
  }
}
