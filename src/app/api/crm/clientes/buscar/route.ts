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

function normalizePhone(v: any) {
  return String(v || "").replace(/[^\d+]/g, "").trim();
}

function normalizePhoneDigits(v: any) {
  return String(v || "").replace(/\D/g, "").trim();
}

function mapEtiquetasFromRelations(cliente: any) {
  const rels = Array.isArray(cliente?.crm_cliente_etiquetas)
    ? cliente.crm_cliente_etiquetas
    : [];

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

async function attachEtiquetas(admin: ReturnType<typeof adminClient>, clientesBase: any[]) {
  if (!clientesBase?.length) return [];

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

  const byClienteId = new Map<number | string, string[]>();

  for (const rel of rels || []) {
    const clienteId = rel?.cliente_id;

    const rawEtiquetas = rel?.crm_etiquetas;
    const etiquetasArr = Array.isArray(rawEtiquetas)
      ? rawEtiquetas
      : rawEtiquetas
      ? [rawEtiquetas]
      : [];

    for (const et of etiquetasArr) {
      const nombre = et?.nombre;
      if (!clienteId || !nombre) continue;

      const prev = byClienteId.get(clienteId) || [];
      prev.push(nombre);
      byClienteId.set(clienteId, prev);
    }
  }

  return clientesBase.map((c: any) => {
    const etiquetas = Array.from(new Set(byClienteId.get(c.id) || []));
    return {
      ...c,
      etiquetas,
    };
  });
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

    const telefonoNorm = normalizePhone(telefono);
    const telefonoDigits = normalizePhoneDigits(telefono);

    const admin = adminClient();

    let clientes: any[] = [];

    if (q) {
      const { data, error } = await admin.rpc("crm_buscar_clientes_fuzzy", { q });

      if (error) throw error;

      const base = Array.isArray(data) ? data : [];
      clientes = await attachEtiquetas(admin, base);
    } else {
      const { data, error } = await admin
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
        .order("nombre", { ascending: true })
        .limit(200);

      if (error) throw error;

      clientes = (data || []).map((c: any) => ({
        ...c,
        etiquetas: mapEtiquetasFromRelations(c),
      }));
    }

    if (telefonoNorm || telefonoDigits) {
      clientes = clientes.filter((c: any) => {
        const tel = String(c.telefono || "");
        const telNorm = String(c.telefono_normalizado || "").replace(/\D/g, "");
        return tel.includes(telefonoNorm) || telNorm.includes(telefonoDigits);
      });
    }

    if (pais) {
      const paisLower = pais.toLowerCase();
      clientes = clientes.filter((c: any) =>
        String(c.pais || "").toLowerCase().includes(paisLower)
      );
    }

    if (etiqueta) {
      const etLower = etiqueta.toLowerCase();

      clientes = clientes.filter((c: any) => {
        const raw =
          c.etiquetas ||
          c.tags ||
          c.labels ||
          c.crm_tags ||
          c.crm_etiquetas ||
          [];

        if (!Array.isArray(raw)) return false;

        const arr = raw
          .map((x: any) =>
            typeof x === "string"
              ? x
              : x?.nombre || x?.label || x?.name || x?.tag || ""
          )
          .filter(Boolean)
          .map((x: string) => x.toLowerCase());

        return arr.some((x: string) => x.includes(etLower));
      });
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
