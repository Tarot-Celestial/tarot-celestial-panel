import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function normalizeText(v: any) {
  return String(v || "").trim();
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

    const q = normalizeText(url.searchParams.get("q"));
    const telefono = normalizeText(url.searchParams.get("telefono"));
    const pais = normalizeText(url.searchParams.get("pais"));
    const etiqueta =
      normalizeText(url.searchParams.get("etiqueta")) ||
      normalizeText(url.searchParams.get("tag"));

    const sbUrl = getEnv("NEXT_PUBLIC_SUPABASE_URL");
    const service = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    const admin = createClient(sbUrl, service, { auth: { persistSession: false } });

    const { data: me, error: meError } = await admin
      .from("workers")
      .select("id, role")
      .eq("user_id", uid)
      .maybeSingle();

    if (meError) throw meError;
    if (!me) {
      return NextResponse.json({ ok: false, error: "NO_WORKER" }, { status: 403 });
    }

    if (me.role !== "admin" && me.role !== "central") {
      return NextResponse.json({ ok: false, error: "NO_ALLOWED" }, { status: 403 });
    }

    let query = admin
      .from("crm_clientes")
      .select(`
        id,
        nombre,
        apellido,
        telefono,
        fecha_nacimiento,
        pais,
        minutos_free_pendientes,
        minutos_normales_pendientes,
        deuda_pendiente
      `)
      .order("updated_at", { ascending: false })
      .limit(100);

    if (telefono) {
      query = query.ilike("telefono", `%${telefono}%`);
    }

    if (pais) {
      query = query.ilike("pais", `%${pais}%`);
    }

    if (q) {
      query = query.or(
        [
          `nombre.ilike.%${q}%`,
          `apellido.ilike.%${q}%`,
          `telefono.ilike.%${q}%`,
          `pais.ilike.%${q}%`,
        ].join(",")
      );
    }

    const { data: clientesBase, error: clientesError } = await query;
    if (clientesError) throw clientesError;

    let clientes = clientesBase || [];

    const clienteIds = clientes.map((x: any) => x.id).filter(Boolean);

    let tagsMap = new Map<string, any[]>();

    if (clienteIds.length > 0) {
      const { data: rels, error: relsError } = await admin
        .from("crm_cliente_etiquetas")
        .select(`
          cliente_id,
          etiqueta_id,
          crm_etiquetas (
            id,
            nombre,
            color
          )
        `)
        .in("cliente_id", clienteIds);

      if (relsError) throw relsError;

      for (const row of rels || []) {
        const cid = String(row.cliente_id || "");
        const et = Array.isArray(row.crm_etiquetas)
          ? row.crm_etiquetas[0]
          : row.crm_etiquetas;

        if (!cid || !et) continue;
        if (!tagsMap.has(cid)) tagsMap.set(cid, []);
        tagsMap.get(cid)!.push(et);
      }
    }

    clientes = clientes.map((c: any) => ({
      ...c,
      etiquetas: tagsMap.get(String(c.id)) || [],
    }));

    if (etiqueta) {
      const needle = etiqueta.toLowerCase();
      clientes = clientes.filter((c: any) =>
        (c.etiquetas || []).some((et: any) =>
          String(et?.nombre || "").toLowerCase().includes(needle)
        )
      );
    }

    return NextResponse.json({
      ok: true,
      clientes,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "ERR_CRM_BUSCAR" },
      { status: 500 }
    );
  }
}
