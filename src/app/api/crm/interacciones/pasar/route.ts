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

function num(v: any) {
  return Math.max(0, Number(v) || 0);
}

function buildCodigoVisual({
  minutos_free,
  minutos_normales,
  minutos_repite,
  minutos_rueda,
}: {
  minutos_free: number;
  minutos_normales: number;
  minutos_repite: number;
  minutos_rueda: number;
}) {
  const parts: string[] = [];

  if (minutos_free > 0) parts.push(`${minutos_free}free`);
  if (minutos_normales > 0) parts.push(`${minutos_normales}normales`);
  if (minutos_repite > 0) parts.push(`${minutos_repite}repite`);
  if (minutos_rueda > 0) parts.push(`${minutos_rueda}rueda`);

  return parts.join(" ").trim();
}

export async function POST(req: Request) {
  try {
    const { uid } = await uidFromBearer(req);
    if (!uid) {
      return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));

    const interaccion_id = String(body?.interaccion_id || "").trim();
    const tarotista_worker_id = String(body?.tarotista_worker_id || "").trim();
    const notas_central = String(body?.notas_central || "").trim() || null;

    const minutos_free = num(body?.minutos_free);
    const minutos_normales = num(body?.minutos_normales);
    const minutos_repite = num(body?.minutos_repite);
    const minutos_rueda = num(body?.minutos_rueda);

    if (!interaccion_id) {
      return NextResponse.json({ ok: false, error: "INTERACCION_ID_REQUERIDO" }, { status: 400 });
    }

    if (!tarotista_worker_id) {
      return NextResponse.json({ ok: false, error: "TAROTISTA_ID_REQUERIDO" }, { status: 400 });
    }

    const codigo_visual = buildCodigoVisual({
      minutos_free,
      minutos_normales,
      minutos_repite,
      minutos_rueda,
    });

    if (!codigo_visual) {
      return NextResponse.json({ ok: false, error: "CODIGO_VISUAL_VACIO" }, { status: 400 });
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

    const { data: interaccion, error: interaccionError } = await admin
      .from("crm_interacciones")
      .select(`
        id,
        cliente_id,
        estado,
        notas_central,
        cliente:crm_clientes (
          id,
          nombre,
          apellido
        )
      `)
      .eq("id", interaccion_id)
      .maybeSingle();

    if (interaccionError) throw interaccionError;
    if (!interaccion) {
      return NextResponse.json({ ok: false, error: "INTERACCION_NO_EXISTE" }, { status: 404 });
    }

    const { data: tarotista, error: tarotistaError } = await admin
      .from("workers")
      .select("id, role, display_name")
      .eq("id", tarotista_worker_id)
      .maybeSingle();

    if (tarotistaError) throw tarotistaError;
    if (!tarotista) {
      return NextResponse.json({ ok: false, error: "TAROTISTA_NO_EXISTE" }, { status: 404 });
    }

    if (tarotista.role !== "tarotista") {
      return NextResponse.json({ ok: false, error: "WORKER_NO_ES_TAROTISTA" }, { status: 400 });
    }

    const nowIso = new Date().toISOString();

    const { data: interaccionActualizada, error: updateError } = await admin
      .from("crm_interacciones")
      .update({
        tarotista_worker_id,
        estado: "asignada",
        notas_central,
        minutos_free,
        minutos_normales,
        minutos_repite,
        minutos_rueda,
        codigo_visual,
        asignado_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", interaccion_id)
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

    if (updateError) throw updateError;

    const clienteNombre = (interaccion as any)?.cliente?.nombre || "Cliente";

    const { data: dispatch, error: dispatchError } = await admin
      .from("crm_dispatches_vivos")
      .insert({
        cliente_id: interaccion.cliente_id,
        llamada_ref: interaccion_id,
        from_worker_id: worker.id,
        to_tarotista_worker_id: tarotista_worker_id,
        nombre_cliente: clienteNombre,
        codigo_dispatch: codigo_visual,
        estado: "pending",
      })
      .select(`
        id,
        cliente_id,
        llamada_ref,
        from_worker_id,
        to_tarotista_worker_id,
        nombre_cliente,
        codigo_dispatch,
        estado,
        created_at
      `)
      .single();

    if (dispatchError) throw dispatchError;

    await admin.from("crm_audit_logs").insert({
      cliente_id: interaccion.cliente_id,
      llamada_ref: interaccion_id,
      worker_id: worker.id,
      action_type: "pasar_llamada",
      entity_type: "crm_interacciones",
      entity_id: interaccion_id,
      payload: {
        tarotista_worker_id,
        tarotista_nombre: tarotista.display_name,
        codigo_visual,
        minutos_free,
        minutos_normales,
        minutos_repite,
        minutos_rueda,
      },
    });

    return NextResponse.json({
      ok: true,
      interaccion: interaccionActualizada,
      dispatch,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "ERR" },
      { status: 500 }
    );
  }
}
