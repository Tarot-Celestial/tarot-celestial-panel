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

function normalizarTelefono(v: string) {
  return String(v || "").replace(/\D+/g, "");
}

export async function POST(req: Request) {
  try {
    const { uid } = await uidFromBearer(req);
    if (!uid) {
      return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));

    const nombre = String(body?.nombre || "").trim();
    const apellido = String(body?.apellido || "").trim() || null;
    const telefono = String(body?.telefono || "").trim();
    const fecha_nacimiento = String(body?.fecha_nacimiento || "").trim() || null;
    const pais = String(body?.pais || "").trim() || null;
    const notas_generales = String(body?.notas_generales || "").trim() || null;
    const minutos_free_pendientes = Number(body?.minutos_free_pendientes || 0) || 0;
    const minutos_normales_pendientes = Number(body?.minutos_normales_pendientes || 0) || 0;
    const deuda_pendiente = Number(body?.deuda_pendiente || 0) || 0;
    const etiqueta_ids = Array.isArray(body?.etiqueta_ids) ? body.etiqueta_ids : [];

    if (!nombre) {
      return NextResponse.json({ ok: false, error: "NOMBRE_REQUERIDO" }, { status: 400 });
    }

    if (!telefono) {
      return NextResponse.json({ ok: false, error: "TELEFONO_REQUERIDO" }, { status: 400 });
    }

    const telefono_normalizado = normalizarTelefono(telefono);
    if (!telefono_normalizado) {
      return NextResponse.json({ ok: false, error: "TELEFONO_INVALIDO" }, { status: 400 });
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

    const { data: existente, error: existenteError } = await admin
      .from("crm_clientes")
      .select("id, nombre, apellido, telefono, telefono_normalizado, pais, created_at")
      .eq("telefono_normalizado", telefono_normalizado)
      .maybeSingle();

    if (existenteError) throw existenteError;

    if (existente) {
      return NextResponse.json({
        ok: false,
        error: "CLIENTE_YA_EXISTE",
        cliente: existente,
      }, { status: 409 });
    }

    const { data: cliente, error: createError } = await admin
      .from("crm_clientes")
      .insert({
        nombre,
        apellido,
        telefono,
        telefono_normalizado,
        fecha_nacimiento,
        pais,
        minutos_free_pendientes,
        minutos_normales_pendientes,
        deuda_pendiente,
        notas_generales,
        creado_por_worker_id: worker.id,
        actualizado_por_worker_id: worker.id,
      })
      .select(`
        id,
        nombre,
        apellido,
        telefono,
        telefono_normalizado,
        fecha_nacimiento,
        pais,
        minutos_free_pendientes,
        minutos_normales_pendientes,
        deuda_pendiente,
        notas_generales,
        created_at,
        updated_at
      `)
      .single();

    if (createError) throw createError;

    if (etiqueta_ids.length > 0) {
      const rows = etiqueta_ids.map((etiqueta_id: string) => ({
        cliente_id: cliente.id,
        etiqueta_id,
        creado_por_worker_id: worker.id,
      }));

      const { error: tagsError } = await admin
        .from("crm_cliente_etiquetas")
        .insert(rows);

      if (tagsError) throw tagsError;
    }

    await admin.from("crm_audit_logs").insert({
      cliente_id: cliente.id,
      worker_id: worker.id,
      action_type: "crear_cliente",
      entity_type: "crm_clientes",
      entity_id: cliente.id,
      payload: {
        nombre,
        apellido,
        telefono,
        pais,
        etiqueta_ids,
      },
    });

    return NextResponse.json({
      ok: true,
      cliente,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "ERR" },
      { status: 500 }
    );
  }
}
