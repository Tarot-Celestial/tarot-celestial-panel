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
    const dispatch_id = String(body?.dispatch_id || "").trim();
    const estado = String(body?.estado || "").trim();

    if (!dispatch_id) {
      return NextResponse.json({ ok: false, error: "DISPATCH_ID_REQUERIDO" }, { status: 400 });
    }

    if (!["seen", "accepted", "closed"].includes(estado)) {
      return NextResponse.json({ ok: false, error: "ESTADO_INVALIDO" }, { status: 400 });
    }

    const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
    const service = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    const admin = createClient(url, service, { auth: { persistSession: false } });

    const { data: worker, error: workerError } = await admin
      .from("workers")
      .select("id, role, display_name")
      .eq("user_id", uid)
      .maybeSingle();

    if (workerError) throw workerError;
    if (!worker) {
      return NextResponse.json({ ok: false, error: "NO_WORKER" }, { status: 403 });
    }

    if (worker.role !== "tarotista") {
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    }

    const { data: dispatch, error: dispatchError } = await admin
      .from("crm_dispatches_vivos")
      .select(`
        id,
        cliente_id,
        llamada_ref,
        to_tarotista_worker_id,
        estado
      `)
      .eq("id", dispatch_id)
      .eq("to_tarotista_worker_id", worker.id)
      .maybeSingle();

    if (dispatchError) throw dispatchError;
    if (!dispatch) {
      return NextResponse.json({ ok: false, error: "DISPATCH_NO_EXISTE" }, { status: 404 });
    }

    const nowIso = new Date().toISOString();

    const patch: any = {
      estado,
    };

    if (estado === "seen") patch.seen_at = nowIso;
    if (estado === "accepted") patch.accepted_at = nowIso;
    if (estado === "closed") patch.closed_at = nowIso;

    const { data: dispatchActualizado, error: updateError } = await admin
      .from("crm_dispatches_vivos")
      .update(patch)
      .eq("id", dispatch_id)
      .select(`
        id,
        cliente_id,
        llamada_ref,
        from_worker_id,
        to_tarotista_worker_id,
        nombre_cliente,
        codigo_dispatch,
        estado,
        created_at,
        seen_at,
        accepted_at,
        closed_at
      `)
      .single();

    if (updateError) throw updateError;

    if (dispatch.llamada_ref) {
      let estadoInteraccion: string | null = null;

      if (estado === "accepted") estadoInteraccion = "en_curso";
      if (estado === "closed") estadoInteraccion = "cerrada";

      if (estadoInteraccion) {
        const interaccionPatch: any = {
          estado: estadoInteraccion,
          updated_at: nowIso,
        };

        if (estado === "closed") {
          interaccionPatch.cerrado_at = nowIso;
        }

        await admin
          .from("crm_interacciones")
          .update(interaccionPatch)
          .eq("id", dispatch.llamada_ref);
      }
    }

    await admin.from("crm_audit_logs").insert({
      cliente_id: dispatch.cliente_id,
      llamada_ref: dispatch.llamada_ref,
      worker_id: worker.id,
      action_type: `dispatch_${estado}`,
      entity_type: "crm_dispatches_vivos",
      entity_id: dispatch.id,
      payload: {
        dispatch_id: dispatch.id,
        estado,
        tarotista_nombre: worker.display_name,
      },
    });

    return NextResponse.json({
      ok: true,
      dispatch: dispatchActualizado,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "ERR" },
      { status: 500 }
    );
  }
}
