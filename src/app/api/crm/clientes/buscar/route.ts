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
      rango_gasto_mes_anterior: Number(rankRow?.gasto_mes_anterior || 0),
      rango_compras_mes_anterior: Number(rankRow?.compras_mes_anterior || 0),
      rango_actual_desde: rankRow?.calculado_desde_mes || null,
      rango_periodo_mes: rankRow?.periodo_mes || null,
    };
  });
}

export async function GET(req: Request) {
  try {
    const worker = await workerFromReq(req);
    if (!worker) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }

    if (!["admin", "central"].includes(String(worker.role))) {
      return NextResponse.json({ ok: false }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);

    const q = String(searchParams.get("q") || "").trim();
    const telefono = String(searchParams.get("telefono") || "").trim();
    const telefonoDigits = normalizePhoneDigits(telefono);
    const pais = String(searchParams.get("pais") || "").trim();
    const etiqueta = String(
      searchParams.get("etiqueta") || searchParams.get("tag") || ""
    ).trim().toLowerCase();

    const webFilter = String(searchParams.get("web_filter") || "todos")
      .trim()
      .toLowerCase();

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
      .limit(1000);

    if (q) {
      const safeQ = q.replace(/[%]/g, " ").replace(/,/g, " ").trim();
      const qDigits = normalizePhoneDigits(safeQ);

      const orParts = [
        `nombre.ilike.%${safeQ}%`,
        `apellido.ilike.%${safeQ}%`,
        `email.ilike.%${safeQ}%`,
      ];

      if (qDigits) {
        orParts.push(`telefono.ilike.%${qDigits}%`);
        orParts.push(`telefono_normalizado.ilike.%${qDigits}%`);
      }

      query = query.or(orParts.join(","));
    }

    if (telefono) {
      const phoneOrParts = [`telefono.ilike.%${telefono}%`];
      if (telefonoDigits) {
        phoneOrParts.push(`telefono_normalizado.ilike.%${telefonoDigits}%`);
      }
      query = query.or(phoneOrParts.join(","));
    }

    if (pais) {
      query = query.ilike("pais", `%${pais}%`);
    }

    const { data, error } = await query;
    if (error) throw error;

    let clientes = await hydrateCurrentRanks(admin, data || []);

    // 🔥 NUEVO SISTEMA DE ETIQUETAS (SIN JOIN QUE ROMPE)
    if (etiqueta) {
      const { data: rels } = await admin
        .from("crm_cliente_etiquetas")
        .select("cliente_id, etiqueta_id");

      const { data: etiquetas } = await admin
        .from("crm_etiquetas")
        .select("id, nombre");

      const etiquetaIds = (etiquetas || [])
        .filter((e: any) => String(e.nombre).toLowerCase() === etiqueta)
        .map((e: any) => e.id);

      const clientesIds = new Set(
        (rels || [])
          .filter((r: any) => etiquetaIds.includes(r.etiqueta_id))
          .map((r: any) => String(r.cliente_id))
      );

      clientes = clientes.filter((c: any) =>
        clientesIds.has(String(c.id))
      );
    }

    if (rango) {
      clientes = clientes.filter((c: any) => {
        const r = String(c?.rango_actual || "").toLowerCase();
        if (rango === "sin_rango") return !r;
        return r === rango;
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

    return NextResponse.json({
      ok: true,
      clientes: clientes.slice(0, 300),
    });
  } catch (e: any) {
    console.error("🔥 CRM ERROR:", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "ERR" },
      { status: 500 }
    );
  }
}
