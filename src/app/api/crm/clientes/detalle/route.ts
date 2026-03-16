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

  if (!token) return null;

  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data } = await userClient.auth.getUser();
  return data.user?.id || null;
}

export async function GET(req: Request) {
  try {
    const uid = await uidFromBearer(req);
    if (!uid) {
      return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    }

    const url = new URL(req.url);
    const id = url.searchParams.get("id");

    if (!id) {
      return NextResponse.json({ ok: false, error: "ID_REQUIRED" }, { status: 400 });
    }

    const sbUrl = getEnv("NEXT_PUBLIC_SUPABASE_URL");
    const service = getEnv("SUPABASE_SERVICE_ROLE_KEY");

    const admin = createClient(sbUrl, service, {
      auth: { persistSession: false },
    });

    const { data: cliente, error } = await admin
      .from("crm_clientes")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) throw error;
    if (!cliente) {
      return NextResponse.json({ ok: false, error: "CLIENT_NOT_FOUND" }, { status: 404 });
    }

    const { data: etiquetas } = await admin
      .from("crm_cliente_etiquetas")
      .select(`
        etiqueta_id,
        crm_etiquetas (
          id,
          nombre,
          color
        )
      `)
      .eq("cliente_id", id);

    const { data: notas } = await admin
      .from("crm_notas_cliente")
      .select(`
        id,
        nota,
        created_at,
        workers (
          display_name
        )
      `)
      .eq("cliente_id", id)
      .order("created_at", { ascending: false })
      .limit(20);

    const { data: ultimas } = await admin
      .from("crm_interacciones")
      .select(`
        tarotista_worker_id,
        workers (
          display_name
        ),
        created_at
      `)
      .eq("cliente_id", id)
      .not("tarotista_worker_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(8);

    return NextResponse.json({
      ok: true,
      cliente,
      etiquetas,
      notas,
      ultimas_tarotistas: ultimas,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "ERR_CLIENT_DETAIL" },
      { status: 500 }
    );
  }
}
