import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

async function uidFromBearer(req: Request) {
  const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anon = getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return { uid: null as string | null };

  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data } = await userClient.auth.getUser();
  return { uid: data.user?.id || null };
}

function normalizarTelefono(v: string) {
  return String(v || "").replace(/\D+/g, "");
}

export async function GET(req: Request) {
  try {
    const { uid } = await uidFromBearer(req);
    if (!uid) {
      return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    }

    const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
    const service = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    const admin = createClient(url, service, { auth: { persistSession: false } });

    const { data: worker, error: workerError } = await admin
      .from("workers")
      .select("id, role")
      .eq("user_id", uid)
      .maybeSingle();

    if (workerError) throw workerError;
    if (!worker) {
      return NextResponse.json({ ok: false, error: "NO_WORKER" }, { status: 403 });
    }

    if (worker.role !== "admin" && worker.role !== "central") {
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const telefono = String(searchParams.get("telefono") || "").trim();
    const q = String(searchParams.get("q") || "").trim();

    if (!telefono && !q) {
      return NextResponse.json({
        ok: true,
        clientes: [],
      });
    }

    let clientes: any[] = [];

    if (telefono) {
      const telefonoNormalizado = normalizarTelefono(telefono);

      const { data, error } = await admin
        .from("crm_clientes")
        .select(`
          id,
          nombre,
          apellido,
          telefono,
          telefono_normalizado,
          pais,
          minutos_free_pendientes,
          minutos_normales_pendientes,
          deuda_pendiente,
          created_at
        `)
        .eq("telefono_normalizado", telefonoNormalizado)
        .order("created_at", { ascending: false })
        .limit(20);

      if (error) throw error;
      clientes = data || [];
    } else {
      const { data, error } = await admin
        .from("crm_clientes")
        .select(`
          id,
          nombre,
          apellido,
          telefono,
          telefono_normalizado,
          pais,
          minutos_free_pendientes,
          minutos_normales_pendientes,
          deuda_pendiente,
          created_at
        `)
        .or(`nombre.ilike.%${q}%,apellido.ilike.%${q}%,telefono.ilike.%${q}%`)
        .order("created_at", { ascending: false })
        .limit(20);

      if (error) throw error;
      clientes = data || [];
    }

    const clienteIds = clientes.map((x) => x.id);
    let etiquetasMap = new Map<string, any[]>();

    if (clienteIds.length > 0) {
      const { data: rels, error: relsError } = await admin
        .from("crm_cliente_etiquetas")
        .select(`
          cliente_id,
          crm_etiquetas (
            id,
            nombre,
            color,
            activa
          )
        `)
        .in("cliente_id", clienteIds);

      if (relsError) throw relsError;

      for (const row of rels || []) {
        const clienteId = String((row as any).cliente_id);
        const etiqueta = (row as any).crm_etiquetas;
        if (!etiquetasMap.has(clienteId)) etiquetasMap.set(clienteId, []);
        if (etiqueta) etiquetasMap.get(clienteId)!.push(etiqueta);
      }
    }

    const result = clientes.map((c) => ({
      ...c,
      etiquetas: etiquetasMap.get(String(c.id)) || [],
    }));

    return NextResponse.json({
      ok: true,
      clientes: result,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "ERR" },
      { status: 500 }
    );
  }
}
