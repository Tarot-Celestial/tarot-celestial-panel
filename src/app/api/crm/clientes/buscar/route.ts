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

function normalizePhoneDigits(phone: string) {
  return phone.replace(/\D/g, "");
}

function normalizeSpanishPhone(phone: string) {
  const digits = normalizePhoneDigits(phone || "");
  if (!digits) return "";
  if (digits.startsWith("0034")) return digits.slice(4);
  if (digits.startsWith("34") && digits.length > 9) return digits.slice(2);
  return digits;
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
    const telefonoDigits = normalizeSpanishPhone(telefono);
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

    const searchQ = q.replace(/[%]/g, " ").replace(/,/g, " ").trim();
    const qDigits = normalizeSpanishPhone(searchQ);
    const qParts = searchQ.split(" ").filter(Boolean);

    if (qDigits || telefonoDigits) {
      const phoneSearch = telefonoDigits || qDigits;
      const phoneCandidates = Array.from(
        new Set(
          [
            phoneSearch,
            phoneSearch.replace(/^34/, ""),
            `34${phoneSearch.replace(/^34/, "")}`,
            `0034${phoneSearch.replace(/^34/, "")}`,
          ].filter(Boolean)
        )
      );

      const phoneOrParts: string[] = [];
      for (const candidate of phoneCandidates) {
        phoneOrParts.push(`telefono_normalizado.eq.${candidate}`);
        phoneOrParts.push(`telefono.eq.${candidate}`);
        phoneOrParts.push(`telefono.ilike.%${candidate}%`);
      }

      query = query.or(phoneOrParts.join(","));
    } else if (searchQ) {
      const orParts: string[] = [
        `nombre.ilike.%${searchQ}%`,
        `apellido.ilike.%${searchQ}%`,
        `email.ilike.%${searchQ}%`,
      ];

      if (qParts.length >= 2) {
        const first = qParts[0];
        const second = qParts.slice(1).join(" ");
        orParts.push(`and(nombre.ilike.%${first}%,apellido.ilike.%${second}%)`);
        orParts.push(`and(nombre.ilike.%${second}%,apellido.ilike.%${first}%)`);
      }

      query = query.or(orParts.join(","));
    }

    if (pais) query = query.ilike("pais", `%${pais}%`);

    const { data, error } = await query;
    if (error) throw error;
    let clientes = data || [];

    const ids = clientes.map((c: any) => String(c.id)).filter(Boolean);
    if (!ids.length) return NextResponse.json({ ok: true, clientes: [] });

    const sinceIso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const [{ data: rels }, { data: etiquetasData }] = await Promise.all([
      admin.from("crm_cliente_etiquetas").select("cliente_id, etiqueta_id").in("cliente_id", ids),
      admin.from("crm_etiquetas").select("id, nombre"),
    ]);

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

    const totals = await loadRolling30ClientTotals(admin, clientes, sinceIso, new Date().toISOString());

    clientes = clientes
      .map((c: any) => {
        const rankInfo = totals.get(String(c.id)) || { total: 0, compras: 0 };
        return {
          ...c,
          etiquetas: byCliente.get(String(c.id)) || [],
          rango_actual: calcClientRank(rankInfo.total),
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
