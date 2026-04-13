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
    .select("id, role")
    .eq("user_id", uid)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

function normalizePhoneDigits(v: any) {
  return String(v || "").replace(/\D/g, "").trim();
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

    const admin = adminClient();

    let clienteIdsFiltro: string[] | null = null;

    // 🔥 FILTRO REAL POR ETIQUETA (EN BD)
    if (etiqueta) {
      const { data: etiquetasData } = await admin
        .from("crm_etiquetas")
        .select("id")
        .ilike("nombre", etiqueta);

      const idsEtiqueta = (etiquetasData || []).map((e: any) => e.id);

      if (!idsEtiqueta.length) {
        return NextResponse.json({ ok: true, clientes: [] });
      }

      const { data: rels } = await admin
        .from("crm_cliente_etiquetas")
        .select("cliente_id")
        .in("etiqueta_id", idsEtiqueta);

      clienteIdsFiltro = (rels || []).map((r: any) => r.cliente_id);

      if (!clienteIdsFiltro.length) {
        return NextResponse.json({ ok: true, clientes: [] });
      }
    }

    let query = admin
      .from("crm_clientes")
      .select("*")
      .order("nombre", { ascending: true })
      .limit(1000);

    // aplicar filtro por IDs
    if (clienteIdsFiltro) {
      query = query.in("id", clienteIdsFiltro);
    }

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
      }

      query = query.or(orParts.join(","));
    }

    if (telefono) {
      const phoneOrParts = [`telefono.ilike.%${telefono}%`];
      if (telefonoDigits) {
        phoneOrParts.push(`telefono.ilike.%${telefonoDigits}%`);
      }
      query = query.or(phoneOrParts.join(","));
    }

    if (pais) {
      query = query.ilike("pais", `%${pais}%`);
    }

    const { data, error } = await query;
    if (error) throw error;

    let clientes = data || [];

    // 🔥 AÑADIR ETIQUETAS PARA UI
    const ids = clientes.map((c: any) => c.id);

    if (ids.length) {
      const { data: rels } = await admin
        .from("crm_cliente_etiquetas")
        .select("cliente_id, etiqueta_id")
        .in("cliente_id", ids);

      const { data: etiquetasData } = await admin
        .from("crm_etiquetas")
        .select("id, nombre");

      const etiquetaMap = new Map(
        (etiquetasData || []).map((e: any) => [e.id, e.nombre])
      );

      const byCliente = new Map<string, string[]>();

      for (const r of rels || []) {
        const cid = String(r.cliente_id);
        const nombre = etiquetaMap.get(r.etiqueta_id);
        if (!nombre) continue;

        if (!byCliente.has(cid)) {
  byCliente.set(cid, []);
}

const arr = byCliente.get(cid);
if (arr) {
  arr.push(nombre);
}

      clientes = clientes.map((c: any) => ({
        ...c,
        etiquetas: byCliente.get(String(c.id)) || [],
      }));
    }

    return NextResponse.json({
      ok: true,
      clientes,
    });
  } catch (e: any) {
    console.error("🔥 CRM ERROR:", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "ERR" },
      { status: 500 }
    );
  }
}
