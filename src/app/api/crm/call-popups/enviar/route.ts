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
    .select("id, user_id, display_name, role, state")
    .eq("user_id", uid)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

function looksLikeUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function normalizeRole(v: any) {
  return String(v || "").trim().toLowerCase();
}

function normalizePhoneDigits(v: any) {
  return String(v || "").replace(/\D/g, "").trim();
}

function pickNumericId(...values: any[]) {
  for (const value of values) {
    const raw = String(value ?? "").trim();
    if (!raw) continue;
    const n = parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

async function findTarotistaByAnyKey(admin: ReturnType<typeof adminClient>, raw: string) {
  const value = String(raw || "").trim();
  if (!value) return null;

  // 1) numeric workers.id
  if (/^\d+$/.test(value)) {
    const { data, error } = await admin
      .from("workers")
      .select("id, user_id, display_name, role, state")
      .eq("id", Number(value))
      .maybeSingle();

    if (error) throw error;
    if (data) return data;
  }

  // 2) auth user uuid
  if (looksLikeUuid(value)) {
    const { data, error } = await admin
      .from("workers")
      .select("id, user_id, display_name, role, state")
      .eq("user_id", value)
      .maybeSingle();

    if (error) throw error;
    if (data) return data;
  }

  // 3) display_name exact
  {
    const { data, error } = await admin
      .from("workers")
      .select("id, user_id, display_name, role, state")
      .eq("display_name", value)
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    if (data) return data;
  }

  // 4) display_name case-insensitive partial fallback
  {
    const { data, error } = await admin
      .from("workers")
      .select("id, user_id, display_name, role, state")
      .ilike("display_name", `%${value}%`)
      .order("display_name", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    if (data) return data;
  }

  return null;
}

export async function GET(req: Request) {
  try {
    const worker = await workerFromReq(req);

    if (!worker) {
      return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    }

    if (!["admin", "central"].includes(normalizeRole(worker.role))) {
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    }

    const admin = adminClient();

    const { data, error } = await admin
      .from("workers")
      .select("id, user_id, display_name, role, state")
      .order("display_name", { ascending: true });

    if (error) throw error;

    const tarotistas = (data || []).filter((w: any) => normalizeRole(w.role) === "tarotista");

    return NextResponse.json({
      ok: true,
      tarotistas,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "ERR" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const worker = await workerFromReq(req);

    if (!worker) {
      return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    }

    if (!["admin", "central"].includes(normalizeRole(worker.role))) {
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));

    const tarotista_worker_raw = String(
      body?.tarotista_worker_id ??
      body?.tarotista_id ??
      body?.worker_id ??
      body?.display_name ??
      ""
    ).trim();

    const nombre = String(body?.nombre || "").trim();
    const apellido = String(body?.apellido || "").trim();
    const telefono = String(body?.telefono || body?.crmEditTelefono || "").trim();
    const telefonoDigits = normalizePhoneDigits(telefono);

    const minutos_free_pendientes =
      Number(String(body?.minutos_free_pendientes ?? "0").replace(",", ".")) || 0;

    const minutos_normales_pendientes =
      Number(String(body?.minutos_normales_pendientes ?? "0").replace(",", ".")) || 0;

    if (!tarotista_worker_raw) {
      return NextResponse.json(
        { ok: false, error: "FALTA_TAROTISTA" },
        { status: 400 }
      );
    }

    const admin = adminClient();

    const tarotista = await findTarotistaByAnyKey(admin, tarotista_worker_raw);

    if (!tarotista) {
      return NextResponse.json(
        {
          ok: false,
          error: "TAROTISTA_NO_ENCONTRADA",
          tarotista_worker_raw,
        },
        { status: 400 }
      );
    }

    if (normalizeRole(tarotista.role) !== "tarotista") {
      return NextResponse.json(
        {
          ok: false,
          error: "TAROTISTA_NO_VALIDA",
          tarotista_worker_raw,
          tarotista_encontrada: {
            id: tarotista.id,
            user_id: tarotista.user_id,
            display_name: tarotista.display_name,
            role: tarotista.role,
          },
        },
        { status: 400 }
      );
    }

    let cliente_id = pickNumericId(
      body?.cliente_id,
      body?.id,
      body?.cliente?.id,
      body?.crmClienteSelId,
      body?.crmClienteFicha?.id
    );

    if (!cliente_id && telefonoDigits) {
      const { data: clienteByPhone, error: clienteByPhoneError } = await admin
        .from("crm_clientes")
        .select("id, telefono, telefono_normalizado")
        .or(`telefono.ilike.%${telefonoDigits}%,telefono_normalizado.ilike.%${telefonoDigits}%`)
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (clienteByPhoneError) throw clienteByPhoneError;
      if (clienteByPhone?.id) cliente_id = Number(clienteByPhone.id);
    }

    if (!cliente_id || !Number.isFinite(cliente_id) || cliente_id <= 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "CLIENTE_ID_INVALIDO",
          debug: {
            body_cliente_id: body?.cliente_id ?? null,
            body_id: body?.id ?? null,
            body_cliente_obj_id: body?.cliente?.id ?? null,
            body_crmClienteSelId: body?.crmClienteSelId ?? null,
            body_crmClienteFicha_id: body?.crmClienteFicha?.id ?? null,
            telefono,
          },
        },
        { status: 400 }
      );
    }

    const { data, error } = await admin
      .from("crm_call_popups")
      .insert({
        tarotista_worker_id: Number(tarotista.id),
        cliente_id,
        nombre,
        apellido,
        minutos_free_pendientes,
        minutos_normales_pendientes,
        visible: true,
        accepted: false,
        closed: false,
      })
      .select("*")
      .maybeSingle();

    if (error) throw error;

    return NextResponse.json({
      ok: true,
      popup: data,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "ERR" },
      { status: 500 }
    );
  }
}
