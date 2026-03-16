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

async function attachEtiquetas(admin: ReturnType<typeof adminClient>, clientesBase: any[]) {
  if (!clientesBase?.length) {
    return [];
  }

  const ids = clientesBase
    .map((c: any) => c?.id)
    .filter((x: any) => x !== null && x !== undefined);

  if (!ids.length) {
    return clientesBase.map((c: any) => ({ ...c, etiquetas: [] }));
  }

  const { data: rels, error } = await admin
    .from("crm_cliente_etiquetas")
    .select(`
      cliente_id,
      crm_etiquetas (
        id,
        nombre
      )
    `)
    .in("cliente_id", ids);

  if (error) throw error;

  const byClienteId = new Map<string | number, string[]>();

  for (const rel of rels || []) {
    const clienteId = rel?.cliente_id;
    const rawEtiquetas = rel?.crm_etiquetas;
    const arr = Array.isArray(rawEtiquetas)
      ? rawEtiquetas
      : rawEtiquetas
      ? [rawEtiquetas]
      : [];

    for (const et of arr) {
      const nombre = et?.nombre;
      if (!clienteId || !nombre) continue;

      const prev = byClienteId.get(clienteId) || [];
      prev.push(String(nombre));
      byClienteId.set(clienteId, prev);
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

    if (!worker) {
      return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    }

    if (!["admin", "central"].includes(String(worker.role || ""))) {
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);

    const q = String(searchParams.get("q") || "").trim();
    const telefono = String(searchParams.get("telefono") || "").trim();
    const etiqueta =
      String(searchParams.get("etiqueta") || "").trim() ||
      String(searchParams.get("tag") || "").trim();
    const pais = String(searchParams.get("pais") || "").trim();

    const telefonoDigits = normalizePhoneDigits(telefono);

    const admin = adminClient();

    let query = admin
      .from("crm_clientes")
      .select("*")
      .order("nombre", { ascending: true })
      .limit(500);

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
      query = query.or(
        [
          `telefono.ilike.%${telefono}%`,
          `telefono_normalizado.ilike.%${telefonoDigits}%`,
        ].join(",")
      );
    }

    if (pais) {
      query = query.ilike("pais", `%${pais}%`);
    }

    const { data, error } = await query;

    if (error) throw error;

    let clientes = await attachEtiquetas(admin, data || []);

    if (etiqueta) {
      const etLower = etiqueta.toLowerCase();
      clientes = clientes.filter((c: any) =>
        Array.isArray(c.etiquetas) &&
        c.etiquetas.some((x: any) => String(x || "").toLowerCase().includes(etLower))
      );
    }

    clientes = clientes.slice(0, 100);

    return NextResponse.json({
      ok: true,
      clientes,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "ERR" },
      { status: 500 }
    );
  }
}
