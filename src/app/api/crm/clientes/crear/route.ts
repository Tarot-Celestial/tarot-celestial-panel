import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function clean(v: any) {
  return String(v || "").trim();
}

function toNum(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function uidFromBearer(req: Request) {
  const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anon = getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return null;

  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data } = await userClient.auth.getUser();
  return data.user?.id || null;
}

export async function POST(req: Request) {
  try {
    const uid = await uidFromBearer(req);
    if (!uid) {
      return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    }

    const sbUrl = getEnv("NEXT_PUBLIC_SUPABASE_URL");
    const service = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    const admin = createClient(sbUrl, service, { auth: { persistSession: false } });

    const { data: me, error: meError } = await admin
      .from("workers")
      .select("id, role, display_name")
      .eq("user_id", uid)
      .maybeSingle();

    if (meError) throw meError;
    if (!me) {
      return NextResponse.json({ ok: false, error: "NO_WORKER" }, { status: 403 });
    }

    if (me.role !== "admin" && me.role !== "central") {
      return NextResponse.json({ ok: false, error: "NO_ALLOWED" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));

    const nombre = clean(body?.nombre);
    const apellido = clean(body?.apellido);
    const telefono = clean(body?.telefono);
    const fecha_nacimiento = clean(body?.fecha_nacimiento);
    const pais = clean(body?.pais);

    const minutos_free_pendientes = toNum(body?.minutos_free_pendientes);
    const minutos_normales_pendientes = toNum(body?.minutos_normales_pendientes);
    const deuda_pendiente = toNum(body?.deuda_pendiente);

    if (!nombre) {
      return NextResponse.json({ ok: false, error: "NOMBRE_REQUIRED" }, { status: 400 });
    }

    if (!telefono) {
      return NextResponse.json({ ok: false, error: "TELEFONO_REQUIRED" }, { status: 400 });
    }

    const { data: exists, error: existsError } = await admin
      .from("crm_clientes")
      .select("id, nombre, apellido, telefono")
      .eq("telefono", telefono)
      .maybeSingle();

    if (existsError) throw existsError;

    if (exists) {
      return NextResponse.json(
        {
          ok: false,
          error: "CLIENTE_YA_EXISTE",
          cliente: exists,
        },
        { status: 409 }
      );
    }

    const insertPayload: any = {
      nombre,
      apellido: apellido || null,
      telefono,
      fecha_nacimiento: fecha_nacimiento || null,
      pais: pais || null,
      minutos_free_pendientes,
      minutos_normales_pendientes,
      deuda_pendiente,
    };

    const { data: cliente, error: insertError } = await admin
      .from("crm_clientes")
      .insert(insertPayload)
      .select("*")
      .single();

    if (insertError) throw insertError;

    return NextResponse.json({
      ok: true,
      cliente,
      message: "Cliente creado correctamente.",
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "ERR_CREAR_CLIENTE" },
      { status: 500 }
    );
  }
}
