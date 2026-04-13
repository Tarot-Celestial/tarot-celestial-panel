import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function adminClient() {
  return createClient(
    getEnv("NEXT_PUBLIC_SUPABASE_URL"),
    getEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } }
  );
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

async function workerFromReq(req: Request) {
  const uid = await uidFromBearer(req);
  if (!uid) return null;

  const admin = adminClient();
  const { data, error } = await admin
    .from("workers")
    .select("id, user_id, display_name, role, team, state")
    .eq("user_id", uid)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

function normalizePhoneDigits(v: any) {
  return String(v || "").replace(/\D/g, "").trim();
}

function currentRankPeriodStart(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
    .toISOString()
    .slice(0, 10);
}

function getClientWebMeta(cliente: any) {
  const onboardingDone = Boolean(cliente?.onboarding_completado);
  const accessCount = Math.max(0, Number(cliente?.total_accesos || 0));
  const lastAccessAt = cliente?.ultimo_acceso_at || null;
  const lastActivityAt = cliente?.ultima_actividad_at || null;
  const registered = Boolean(
    onboardingDone || accessCount > 0 || lastAccessAt || lastActivityAt
  );
  return { registered, onboardingDone };
}

async function hydrateCurrentRanks(admin: any, clientesBase: any[]) {
  if (!clientesBase?.length) return clientesBase || [];

  const ids = clientesBase.map((c: any) => c?.id).filter(Boolean);
  if (!ids.length) return clientesBase;

  const periodoMes = currentRankPeriodStart();
  const { data, error } = await admin
    .from("cliente_rangos_mensuales")
    .select(
      "cliente_id, rango, gasto_mes_anterior, compras_mes_anterior, recalculated_at, calculado_desde_mes, periodo_mes"
    )
    .eq("periodo_mes", periodoMes)
    .in("cliente_id", ids);

  if (error) throw error;

  const byCliente = new Map<string, any>();

  for (const row of data || []) {
    const key = String(row?.cliente_id || "");
    if (!key) continue;

    const prev = byCliente.get(key);

    const prevTs = new Date(prev?.recalculated_at || 0).getTime();
    const nextTs = new Date(row?.recalculated_at || 0).getTime();

    if (!prev || nextTs >= prevTs) {
      byCliente.set(key, row);
    }
  }

  return clientesBase.map((c: any) => {
    const rankRow = byCliente.get(String(c?.id || ""));
    if (!rankRow) return c;

    return {
      ...c,
      rango_actual: rankRow?.rango || null,
    };
  });
}

async function attachEtiquetas(admin: any, clientesBase: any[]) {
  if (!clientesBase?.length) return [];

  const ids = clientesBase.map((c: any) => c?.id).filter(Boolean);
  if (!ids.length)
    return clientesBase.map((c: any) => ({ ...c, etiquetas: [] }));

  const { data, error } = await admin
    .from("crm_cliente_etiquetas")
    .select(`cliente_id, crm_etiquetas ( nombre )`)
    .in("cliente_id", ids);

  if (error) throw error;

  const byCliente = new Map();

  for (const rel of data || []) {
    const id = rel?.cliente_id;
    const nombre = rel?.crm_etiquetas?.nombre;

    if (!id || !nombre) continue;

    if (!byCliente.has(id)) byCliente.set(id, []);
    byCliente.get(id).push(nombre);
  }

  return clientesBase.map((c: any) => ({
    ...c,
    etiquetas: byCliente.get(c.id) || [],
  }));
}

export async function GET(req: Request) {
  try {
    const worker = await workerFromReq(req);
    if (!worker)
      return NextResponse.json({ ok: false }, { status: 401 });

    if (!["admin", "central"].includes(String(worker.role))) {
      return NextResponse.json({ ok: false }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);

    const q = searchParams.get("q") || "";
    const telefono = searchParams.get("telefono") || "";
    const pais = searchParams.get("pais") || "";
    const rangoRaw = searchParams.get("rango");
    const rango = ["bronce", "plata", "oro", "sin_rango"].includes(
  String(rangoRaw || "").toLowerCase()
)
  ? String(rangoRaw).toLowerCase()
  : "";

    const admin = adminClient();

    let query = admin
      .from("crm_clientes")
      .select("*")
      .order("nombre", { ascending: true })
      .limit(300);

    // 🔥 SOLO filtra si hay búsqueda
    if (q) {
  const safeQ = q.replace(/[%]/g, ""); // evita romper ilike
  query = query.or(
    `nombre.ilike.%${safeQ}%,apellido.ilike.%${safeQ}%,email.ilike.%${safeQ}%`
  );
}

    if (telefono) {
      query = query.ilike("telefono", `%${telefono}%`);
    }

    if (pais) {
      query = query.ilike("pais", `%${pais}%`);
    }

    const { data, error } = await query;
    if (error) {
  console.error("SUPABASE ERROR:", error);
  throw error;
}

    let clientes = await hydrateCurrentRanks(admin, data || []);
    clientes = await attachEtiquetas(admin, clientes);

    // 🔥 FILTRO POR RANGO (CLAVE)
    if (rango) {
      clientes = clientes.filter((c: any) => {
        const r = String(c?.rango_actual || "").toLowerCase();
        if (rango === "sin_rango") return !r;
        return r === rango;
      });
    }

    return NextResponse.json({
      ok: true,
      clientes: clientes.slice(0, 300),
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message },
      { status: 500 }
    );
  }
}
