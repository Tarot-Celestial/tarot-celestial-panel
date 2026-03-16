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

export async function GET(req: Request) {
  try {
    const { uid } = await uidFromBearer(req);
    if (!uid) {
      return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
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

    const { searchParams } = new URL(req.url);
    const id = String(searchParams.get("id") || "").trim();

    if (!id) {
      return NextResponse.json({ ok: false, error: "ID_REQUERIDO" }, { status: 400 });
    }

    const { data: cliente, error: clienteError } = await admin
      .from("crm_clientes")
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
      .eq("id", id)
      .maybeSingle();

    if (clienteError) throw clienteError;
    if (!cliente) {
      return NextResponse.json({ ok: false, error: "CLIENTE_NO_EXISTE" }, { status: 404 });
    }

    const { data: etiquetasRel, error: etiquetasError } = await admin
      .from("crm_cliente_etiquetas")
      .select(`
        etiqueta_id,
        crm_etiquetas (
          id,
          nombre,
          color,
          activa
        )
      `)
      .eq("cliente_id", id);

    if (etiquetasError) throw etiquetasError;

    const etiquetas = (etiquetasRel || [])
      .map((row: any) => row.crm_etiquetas)
      .filter(Boolean);

    const { data: notas, error: notasError } = await admin
      .from("crm_notas_cliente")
      .select(`
        id,
        nota,
        llamada_ref,
        created_at,
        creado_por_worker_id
      `)
      .eq("cliente_id", id)
      .order("created_at", { ascending: false })
      .limit(20);

    if (notasError) throw notasError;

    const { data: interacciones, error: interaccionesError } = await admin
      .from("crm_interacciones")
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
      .eq("cliente_id", id)
      .order("created_at", { ascending: false })
      .limit(20);

    if (interaccionesError) throw interaccionesError;

    const tarotistaIds = Array.from(
      new Set(
        (interacciones || [])
          .map((x: any) => x.tarotista_worker_id)
          .filter(Boolean)
      )
    ).slice(0, 8);

    let ultimas_tarotistas: any[] = [];

    if (tarotistaIds.length > 0) {
      const { data: tarotistas, error: tarotistasError } = await admin
        .from("workers")
        .select("id, display_name")
        .in("id", tarotistaIds);

      if (tarotistasError) throw tarotistasError;
      ultimas_tarotistas = tarotistas || [];
    }

    return NextResponse.json({
      ok: true,
      cliente,
      etiquetas,
      notas: notas || [],
      interacciones: interacciones || [],
      ultimas_tarotistas,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "ERR" },
      { status: 500 }
    );
  }
}
