import { NextResponse } from "next/server";
import { calcClientRank, loadRolling30ClientTotals } from "@/lib/server/client-ranks";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function adminClient() {
  return createClient(getEnv("NEXT_PUBLIC_SUPABASE_URL"), getEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });
}

async function uidFromBearer(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return null;
  const sb = createClient(getEnv("NEXT_PUBLIC_SUPABASE_URL"), getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });
  const { data, error } = await sb.auth.getUser();
  if (error) throw error;
  return data.user?.id || null;
}

async function workerFromReq(req: Request) {
  const uid = await uidFromBearer(req);
  if (!uid) return null;
  const admin = adminClient();
  const { data, error } = await admin.from("workers").select("id, role").eq("user_id", uid).maybeSingle();
  if (error) throw error;
  return data || null;
}

function mapEtiquetasFromRelations(cliente: any) {
  const rels = Array.isArray(cliente?.crm_cliente_etiquetas) ? cliente.crm_cliente_etiquetas : [];
  const etiquetas = rels
    .map((rel: any) => {
      const et = rel?.crm_etiquetas;
      if (!et) return null;
      if (typeof et === "string") return et;
      return et.nombre || null;
    })
    .filter(Boolean);
  return Array.from(new Set(etiquetas));
}

export async function GET(req: Request) {
  try {
    const worker = await workerFromReq(req);
    if (!worker) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    if (!["admin", "central"].includes(String(worker.role || ""))) {
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const id = String(searchParams.get("id") || "").trim();
    if (!id) return NextResponse.json({ ok: false, error: "FALTA_ID_CLIENTE" }, { status: 400 });

    const admin = adminClient();
    const sinceIso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const [{ data, error }, { error: rendimientoErr }] = await Promise.all([
      admin
        .from("crm_clientes")
        .select(`
          *,
          crm_cliente_etiquetas (
            crm_etiquetas (
              id,
              nombre
            )
          )
        `)
        .eq("id", id)
        .maybeSingle(),
      admin.from("rendimiento_llamadas").select("id").eq("cliente_id", id).limit(1),
    ]);

    if (error) throw error;
    if (rendimientoErr) throw rendimientoErr;
    if (!data) return NextResponse.json({ ok: false, error: "CLIENTE_NO_ENCONTRADO" }, { status: 404 });

    const totals30d = await loadRolling30ClientTotals(admin, [data], sinceIso, new Date().toISOString());
    const rankInfo = totals30d.get(String(data.id)) || { total: 0, compras: 0 };

    const cliente = {
      ...data,
      etiquetas: mapEtiquetasFromRelations(data),
      rango_actual: calcClientRank(rankInfo.total),
      rango_gasto_mes_anterior: Number((rankInfo.total || 0).toFixed(2)),
      rango_compras_mes_anterior: Number(rankInfo.compras || 0),
      rango_actual_desde: sinceIso.slice(0, 10),
      rango_actual_hasta: new Date().toISOString().slice(0, 10),
    };

    return NextResponse.json({ ok: true, cliente, window_days: 30 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}
