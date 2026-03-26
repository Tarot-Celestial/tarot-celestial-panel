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

  const sb = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data } = await sb.auth.getUser();
  return data.user?.id || null;
}

export async function POST(req: Request) {
  try {
    const uid = await uidFromBearer(req);
    if (!uid) {
      return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    }

    const body = await req.json();

    const cliente_id = String(body?.cliente_id || "").trim();
    const etiquetas = Array.isArray(body?.etiquetas) ? body.etiquetas : [];

    if (!cliente_id) {
      return NextResponse.json({ ok: false, error: "cliente_id requerido" }, { status: 400 });
    }

    const admin = createClient(
      getEnv("NEXT_PUBLIC_SUPABASE_URL"),
      getEnv("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { persistSession: false } }
    );

    // 🔥 BORRAR TODAS LAS RELACIONES
    await admin
      .from("crm_cliente_etiquetas")
      .delete()
      .eq("cliente_id", cliente_id);

    // 🔥 INSERTAR NUEVAS
    if (etiquetas.length > 0) {
      const rows = etiquetas.map((etiqueta_id: string) => ({
        cliente_id,
        etiqueta_id,
      }));

      const { error } = await admin
        .from("crm_cliente_etiquetas")
        .insert(rows);

      if (error) throw error;
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "ERR" },
      { status: 500 }
    );
  }
}
