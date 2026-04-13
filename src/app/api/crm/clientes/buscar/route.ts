
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
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0, 0)).toISOString().slice(0, 10);
}

function getClientWebMeta(cliente: any) {
  const onboardingDone = Boolean(cliente?.onboarding_completado);
  const accessCount = Math.max(0, Number(cliente?.total_accesos || 0));
  const lastAccessAt = cliente?.ultimo_acceso_at || null;
  const lastActivityAt = cliente?.ultima_actividad_at || null;
  const registered = Boolean(onboardingDone || accessCount > 0 || lastAccessAt || lastActivityAt);
  return { registered, onboardingDone, accessCount, lastAccessAt, lastActivityAt };
}

async function hydrateCurrentRanks(admin: ReturnType<typeof adminClient>, clientesBase: any[]) {
  if (!clientesBase?.length) return clientesBase || [];

  const ids = clientesBase.map((c: any) => c?.id).filter(Boolean);
  if (!ids.length) return clientesBase;

  const periodoMes = currentRankPeriodStart();
  const { data, error } = await admin
    .from("cliente_rangos_mensuales")
    .select("cliente_id, rango, gasto_mes_anterior, compras_mes_anterior, recalculated_at, calculado_desde_mes, periodo_mes")
    .eq("periodo_mes", periodoMes)
    .in("cliente_id", ids);
  if (error) throw error;

  const byCliente = new Map<string, any>();
  for (const row of data || []) {
    const key = String(row?.cliente_id || "");
    if (!key) continue;
    const prev = byCliente.get(key);
    const prevTs = String(prev?.recalculated_at || "");
    const nextTs = String(row?.recalculated_at || "");
    if (!prev || nextTs >= prevTs) byCliente.set(key, row);
  }

  return (clientesBase || []).map((c: any) => {
    const rankRow = byCliente.get(String(c?.id || ""));
    if (!rankRow) return c;
    return {
      ...c,
      rango_actual: rankRow?.rango || c?.rango_actual || null,
      rango_gasto_mes_anterior: Number(rankRow?.gasto_mes_anterior ?? c?.rango_gasto_mes_anterior ?? 0),
      rango_compras_mes_anterior: Number(rankRow?.compras_mes_anterior ?? c?.rango_compras_mes_anterior ?? 0),
      rango_actual_desde: rankRow?.calculado_desde_mes || c?.rango_actual_desde || null,
      rango_periodo_mes: rankRow?.periodo_mes || null,
    };
  });
}

async function attachEtiquetas(admin: ReturnType<typeof adminClient>, clientesBase: any[]) {
  if (!clientesBase?.length) return [];

  const ids = clientesBase.map((c: any) => c?.id).filter(Boolean);
  if (!ids.length) return clientesBase.map((c: any) => ({ ...c, etiquetas: [] }));

  const { data: rels, error } = await admin
    .from("crm_cliente_etiquetas")
    .select(`cliente_id, crm_etiquetas ( id, nombre )`)
    .in("cliente_id", ids);
  if (error) throw error;

  const byClienteId = new Map<string | number, string[]>();
  for (const rel of rels || []) {
    const clienteId = rel?.cliente_id;
    const raw = rel?.crm_etiquetas;
    const arr = Array.isArray(raw) ? raw : raw ? [raw] : [];
    for (const et of arr) {
      const nombre = et?.nombre;
      if (!clienteId || !nombre) continue;
      byClienteId.set(clienteId, [...(byClienteId.get(clienteId) || []), String(nombre)]);
    }
  }

  return clientesBase.map((c: any) => ({
    ...c,
    etiquetas: Array.from(new Set(byClienteId.get(c.id) || [])),
  }));
}

export async function GET(req: Request) {
  try {
    const worker = await workerFromReq(req);
    if (!worker) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    if (!["admin", "central"].includes(String(worker.role || ""))) {
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const q = String(searchParams.get("q") || "").trim();
    const telefono = String(searchParams.get("telefono") || "").trim();
    const etiqueta = String(searchParams.get("etiqueta") || searchParams.get("tag") || "").trim();
    const pais = String(searchParams.get("pais") || "").trim();
    const rango = String(searchParams.get("rango") || "").trim().toLowerCase();
    const webFilter = String(searchParams.get("web_filter") || "todos").trim().toLowerCase();
    const telefonoDigits = normalizePhoneDigits(telefono);
    const admin = adminClient();

    let forcedIds: string[] | null = null;
    if (etiqueta) {
      const { data: tags, error: tagsErr } = await admin
        .from("crm_etiquetas")
        .select("id, nombre")
        .ilike("nombre", `%${etiqueta}%`)
        .limit(200);
      if (tagsErr) throw tagsErr;

      const tagIds = (tags || []).map((t: any) => t.id).filter(Boolean);
      if (!tagIds.length) return NextResponse.json({ ok: true, clientes: [] });

      const { data: rels, error: relErr } = await admin
        .from("crm_cliente_etiquetas")
        .select("cliente_id")
        .in("etiqueta_id", tagIds)
        .limit(5000);
      if (relErr) throw relErr;

      forcedIds = Array.from(new Set((rels || []).map((r: any) => String(r.cliente_id || "")).filter(Boolean)));
      if (!forcedIds.length) return NextResponse.json({ ok: true, clientes: [] });
    }

    let query = admin.from("crm_clientes").select("*").order("nombre", { ascending: true }).limit(1000);

    if (forcedIds) query = query.in("id", forcedIds);

    if (q) {
      const qEsc = q.replace(/,/g, " ").trim();
      const qDigits = normalizePhoneDigits(qEsc);
      const orParts = [
        `nombre.ilike.%${qEsc}%`,
        `apellido.ilike.%${qEsc}%`,
        `email.ilike.%${qEsc}%`,
      ];
      if (qDigits) {
        orParts.push(`telefono.ilike.%${qDigits}%`);
        orParts.push(`telefono_normalizado.ilike.%${qDigits}%`);
      }
      query = query.or(orParts.join(","));
    }

    if (telefono) {
      query = query.or([
        `telefono.ilike.%${telefono}%`,
        `telefono_normalizado.ilike.%${telefonoDigits}%`,
      ].join(","));
    }

    if (pais) query = query.ilike("pais", `%${pais}%`);

    const { data, error } = await query;
    if (error) throw error;

    let clientes = await hydrateCurrentRanks(admin, data || []);
    clientes = await attachEtiquetas(admin, clientes || []);
    if (etiqueta) {
      const etLower = etiqueta.toLowerCase();
      clientes = clientes.filter((c: any) => Array.isArray(c.etiquetas) && c.etiquetas.some((x: any) => String(x || "").toLowerCase().includes(etLower)));
    }

    if (rango && ["bronce", "plata", "oro", "sin_rango"].includes(rango)) {
      clientes = clientes.filter((c: any) => {
        const rank = String(c?.rango_actual || "").trim().toLowerCase();
        if (rango === "sin_rango") return !rank;
        return rank === rango;
      });
    }

    if (webFilter === "registrados") {
      clientes = clientes.filter((c: any) => getClientWebMeta(c).registered);
    } else if (webFilter === "no_registrados") {
      clientes = clientes.filter((c: any) => !getClientWebMeta(c).registered);
    } else if (webFilter === "onboarding_pendiente") {
      clientes = clientes.filter((c: any) => {
        const meta = getClientWebMeta(c);
        return meta.registered && !meta.onboardingDone;
      });
    }

    return NextResponse.json({ ok: true, clientes: clientes.slice(0, 300) });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}
