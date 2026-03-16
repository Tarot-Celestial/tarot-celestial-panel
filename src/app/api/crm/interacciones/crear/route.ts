import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

async function uidFromBearer(req: Request) {
  const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anon = getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return { uid: null as string | null };

  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data } = await userClient.auth.getUser();
  return { uid: data.user?.id || null };
}

export async function POST(req: Request) {
  try {
    const { uid } = await uidFromBearer(req);
    if (!uid) {
      return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const cliente_id = String(body?.cliente_id || "").trim();
    const notas_central = String(body?.notas_central || "").trim() || null;
    const origen = String(body?.origen || "").trim() || null;

    if (!cliente_id) {
      return NextResponse.json({ ok: false, error: "CLIENTE_ID_REQUERIDO" }, { status: 400 });
    }

    const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
    const service = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    const admin = createClient(url, service, { auth: { persistSession: false } });

    const { data: worker, error: workerError } = await admin
      .from("workers")
      .select("id, role")
      .eq("user_id", uid)
      .maybeSingle();

    if (workerError) throw workerError;
    if (!worker) {
      return NextResponse.json({ ok: false, error: "NO_WORKER" }, { status: 403 });
    }

    if (worker.role !== "admin" && worker.role !== "central") {
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    }

    const { data: cliente, error: clienteError } = await admin
      .from("crm_clientes")
      .select("id, nombre, apellido")
      .eq("id", cliente_id)
      .maybeSingle();

    if (clienteError) throw clienteError;
    if (!cliente) {
      return NextResponse.json({ ok: false, error: "CLIENTE_NO_EXISTE" }, { status: 404 });
    }

    const { data: interaccion, error: createError } = await admin
      .from("crm_interacciones")
      .insert({
        cliente_id,
        atendido_por_worker_id: worker.id,
        estado: "abierta",
        notas_central,
        origen,
        minutos_free: 0,
        minutos_normales: 0,
        minutos_repite: 0,
        minutos_rueda: 0,
      })
      .select(`
        id,
        cliente_id,
        atendido_por_worker_id,
        tarotista_worker_id,
        estado,
        notas_central,
        codigo_visual,
        minutos_free,
        minutos_normales,
        minutos_repite,
        minutos_rueda,
        origen,
        asignado_at,
        cerrado_at,
        created_at,
        updated_at
      `)
      .single();

    if (createError) throw createError;

    await admin.from("crm_audit_logs").insert({
      cliente_id,
      worker_id: worker.id,
      action_type: "crear_interaccion",
      entity_type: "crm_interacciones",
      entity_id: interaccion.id,
      payload: {
        cliente_nombre: cliente.nombre,
        cliente_apellido: cliente.apellido,
        notas_central,
        origen,
      },
    });

    return NextResponse.json({
      ok: true,
      interaccion,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "ERR" },
      { status: 500 }
    );
  }
}
