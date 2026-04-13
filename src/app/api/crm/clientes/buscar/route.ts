import { NextResponse } from "next/server";
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

function normalizePhoneDigits(v: any) {
  return String(v || "").replace(/\D/g, "").trim();
}

function normalizeName(v: any) {
  return String(v || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function calcRank(total: number) {
  if (total >= 500) return "oro";
  if (total >= 100) return "plata";
  if (total > 0) return "bronce";
  return null;
}

function clientWebMeta(cliente: any) {
  const onboardingDone = Boolean(cliente?.onboarding_completado);
  const accessCount = Math.max(0, Number(cliente?.total_accesos || 0));
  const lastAccessAt = cliente?.ultimo_acceso_at || null;
  const lastActivityAt = cliente?.ultima_actividad_at || null;
  const registered = Boolean(onboardingDone || accessCount > 0 || lastAccessAt || lastActivityAt);
  return { registered, onboardingDone };
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
    const telefonoDigits = normalizePhoneDigits(telefono);
    const pais = String(searchParams.get("pais") || "").trim();
    const etiqueta = String(searchParams.get("etiqueta") || searchParams.get("tag") || "").trim().toLowerCase();
    const rango = String(searchParams.get("rango") || "").trim().toLowerCase();
    const webFilter = String(searchParams.get("web_filter") || "todos").trim().toLowerCase();

    const admin = adminClient();
    let clienteIdsFiltro: string[] | null = null;

    if (etiqueta) {
      const { data: etiquetasData, error: tagsErr } = await admin.from("crm_etiquetas").select("id").ilike("nombre", etiqueta);
      if (tagsErr) throw tagsErr;
      const idsEtiqueta = (etiquetasData || []).map((e: any) => String(e.id));
      if (!idsEtiqueta.length) return NextResponse.json({ ok: true, clientes: [] });
      const { data: rels, error: relErr } = await admin.from("crm_cliente_etiquetas").select("cliente_id").in("etiqueta_id", idsEtiqueta);
      if (relErr) throw relErr;
      clienteIdsFiltro = Array.from(new Set((rels || []).map((r: any) => String(r.cliente_id)).filter(Boolean)));
      if (!clienteIdsFiltro.length) return NextResponse.json({ ok: true, clientes: [] });
    }

    let query = admin
      .from("crm_clientes")
      .select("*")
      .order("updated_at", { ascending: false, nullsFirst: false })
      .order("nombre", { ascending: true })
      .limit(1000);

    if (clienteIdsFiltro) query = query.in("id", clienteIdsFiltro);

    if (q) {
      const safeQ = q.replace(/[%]/g, " ").replace(/,/g, " ").trim();
      const qDigits = normalizePhoneDigits(safeQ);
      const orParts = [`nombre.ilike.%${safeQ}%`, `apellido.ilike.%${safeQ}%`, `email.ilike.%${safeQ}%`];
      if (qDigits) orParts.push(`telefono.ilike.%${qDigits}%`);
      query = query.or(orParts.join(","));
    }

    if (telefono) {
      const phoneOrParts = [`telefono.ilike.%${telefono}%`];
      if (telefonoDigits) phoneOrParts.push(`telefono.ilike.%${telefonoDigits}%`);
      query = query.or(phoneOrParts.join(","));
    }

    if (pais) query = query.ilike("pais", `%${pais}%`);

    const { data, error } = await query;
    if (error) throw error;
    let clientes = data || [];

    const ids = clientes.map((c: any) => String(c.id)).filter(Boolean);
    if (!ids.length) return NextResponse.json({ ok: true, clientes: [] });

    const [{ data: rels }, { data: etiquetasData }, { data: rendimientoRows, error: rendimientoErr }] = await Promise.all([
      admin.from("crm_cliente_etiquetas").select("cliente_id, etiqueta_id").in("cliente_id", ids),
      admin.from("crm_etiquetas").select("id, nombre"),
      admin.from("rendimiento_llamadas").select("cliente_id, cliente_nombre, importe, fecha_hora").gte("fecha_hora", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()),
    ]);
    if (rendimientoErr) throw rendimientoErr;

    const etiquetaMap = new Map((etiquetasData || []).map((e: any) => [String(e.id), e.nombre]));
    const byCliente = new Map<string, string[]>();
    for (const r of rels || []) {
      const cid = String(r.cliente_id || "");
      const nombre = etiquetaMap.get(String(r.etiqueta_id || ""));
      if (!cid || !nombre) continue;
      const arr = byCliente.get(cid) || [];
      arr.push(nombre);
      byCliente.set(cid, Array.from(new Set(arr)));
    }

    const nameMap = new Map<string, string>();
    for (const c of clientes) {
      const full = [c?.nombre, c?.apellido].filter(Boolean).join(" ").trim();
      const key1 = normalizeName(full);
      const key2 = normalizeName(c?.nombre);
      if (key1) nameMap.set(key1, String(c.id));
      if (key2 && !nameMap.has(key2)) nameMap.set(key2, String(c.id));
    }

    const totals = new Map<string, { total: number; compras: number }>();
    for (const row of rendimientoRows || []) {
      const amount = Number(row?.importe || 0);
      if (!(amount > 0)) continue;
      let clienteId = String(row?.cliente_id || "").trim();
      if (!clienteId) clienteId = nameMap.get(normalizeName(row?.cliente_nombre)) || "";
      if (!clienteId || !ids.includes(clienteId)) continue;
      const prev = totals.get(clienteId) || { total: 0, compras: 0 };
      prev.total += amount;
      prev.compras += 1;
      totals.set(clienteId, prev);
    }

    clientes = clientes
      .map((c: any) => {
        const rankInfo = totals.get(String(c.id)) || { total: 0, compras: 0 };
        return {
          ...c,
          etiquetas: byCliente.get(String(c.id)) || [],
          rango_actual: calcRank(rankInfo.total),
          rango_gasto_mes_anterior: Number(rankInfo.total.toFixed(2)),
          rango_compras_mes_anterior: rankInfo.compras,
          rango_actual_desde: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
          rango_actual_hasta: new Date().toISOString().slice(0, 10),
        };
      })
      .filter((c: any) => {
        if (rango && ["bronce", "plata", "oro"].includes(rango) && c.rango_actual !== rango) return false;
        const web = clientWebMeta(c);
        if (webFilter === "registrados") return web.registered;
        if (webFilter === "no_registrados") return !web.registered;
        if (webFilter === "onboarding_pendiente") return web.registered && !web.onboardingDone;
        return true;
      });

    return NextResponse.json({ ok: true, clientes });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}
