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

    const { searchParams } = new URL(req.url);
    const cliente_id = String(searchParams.get("cliente_id") || "").trim();

    if (!cliente_id) {
      return NextResponse.json({ ok: false, error: "cliente_id requerido" }, { status: 400 });
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

    const { data, error } = await admin
      .from("crm_cliente_etiquetas")
      .select("etiqueta_id")
      .eq("cliente_id", cliente_id);

    if (error) throw error;

    const etiquetaIds = (data || [])
      .map((row: any) => String(row?.etiqueta_id || ""))
      .filter(Boolean);

    let etiquetas = etiquetaIds.map((id) => ({ id, etiqueta_id: id }));

    if (etiquetaIds.length > 0) {
      const { data: etiquetasData, error: etiquetasError } = await admin
        .from("crm_etiquetas")
        .select("id, nombre, color, activa")
        .in("id", etiquetaIds);

      if (!etiquetasError && Array.isArray(etiquetasData)) {
        const map = new Map(etiquetasData.map((et: any) => [String(et.id), et]));
        etiquetas = etiquetaIds.map((id) => {
          const et = map.get(String(id));
          return et
            ? {
                id: String(et.id),
                nombre: et.nombre || "",
                color: et.color || null,
                activa: et.activa ?? true,
                etiqueta_id: String(et.id),
              }
            : { id: String(id), etiqueta_id: String(id) };
        });
      }
    }

    return NextResponse.json({ ok: true, etiquetas });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "ERR" },
      { status: 500 }
    );
  }
}
