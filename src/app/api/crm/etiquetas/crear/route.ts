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
    const nombre = String(body?.nombre || "").trim();
    const color = String(body?.color || "").trim() || null;

    if (!nombre) {
      return NextResponse.json({ ok: false, error: "NOMBRE_REQUERIDO" }, { status: 400 });
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

    const { data: existente } = await admin
      .from("crm_etiquetas")
      .select("id, nombre, color, activa, created_at")
      .ilike("nombre", nombre)
      .maybeSingle();

    if (existente) {
      return NextResponse.json({
        ok: true,
        etiqueta: existente,
        already_exists: true,
      });
    }

    const { data: etiqueta, error } = await admin
      .from("crm_etiquetas")
      .insert({
        nombre,
        color,
        activa: true,
        creado_por_worker_id: worker.id,
      })
      .select("id, nombre, color, activa, created_at")
      .single();

    if (error) throw error;

    const payload = {
      nombre,
      color,
    };

    await admin.from("crm_audit_logs").insert({
      worker_id: worker.id,
      action_type: "crear_etiqueta",
      entity_type: "crm_etiquetas",
      entity_id: etiqueta.id,
      payload,
    });

    return NextResponse.json({
      ok: true,
      etiqueta,
      already_exists: false,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "ERR" },
      { status: 500 }
    );
  }
}
