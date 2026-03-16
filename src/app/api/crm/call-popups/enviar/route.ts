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

export async function GET(req: Request) {
  try {
    const worker = await workerFromReq(req);

    if (!worker) {
      return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    }

    if (!["admin", "central"].includes(String(worker.role || ""))) {
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    }

    const admin = adminClient();

    const { data, error } = await admin
      .from("workers")
      .select("id, user_id, display_name, role, state")
      .eq("role", "tarotista")
      .order("display_name", { ascending: true });

    if (error) throw error;

    return NextResponse.json({
      ok: true,
      tarotistas: data || [],
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

    if (!["admin", "central"].includes(String(worker.role || ""))) {
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));

    const tarotista_worker_raw = String(body?.tarotista_worker_id || "").trim();
    const cliente_id_raw = String(body?.cliente_id ?? "").trim();

    const nombre = String(body?.nombre || "").trim();
    const apellido = String(body?.apellido || "").trim();

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

    if (!cliente_id_raw) {
      return NextResponse.json(
        { ok: false, error: "FALTA_CLIENTE_ID" },
        { status: 400 }
      );
    }

    const cliente_id = parseInt(cliente_id_raw, 10);

    if (!Number.isFinite(cliente_id) || cliente_id <= 0) {
      return NextResponse.json(
        { ok: false, error: "CLIENTE_ID_INVALIDO", cliente_id_raw },
        { status: 400 }
      );
    }

    const admin = adminClient();

    let tarotistaWorkerId: number | null = null;

    if (/^\d+$/.test(tarotista_worker_raw)) {
      tarotistaWorkerId = parseInt(tarotista_worker_raw, 10);
    } else if (looksLikeUuid(tarotista_worker_raw)) {
      const { data: workerByUserId, error: workerByUserIdError } = await admin
        .from("workers")
        .select("id, role")
        .eq("user_id", tarotista_worker_raw)
        .maybeSingle();

      if (workerByUserIdError) throw workerByUserIdError;

      if (!workerByUserId || String(workerByUserId.role || "").toLowerCase() !== "tarotista") {
  return NextResponse.json(
    { ok: false, error: "TAROTISTA_NO_VALIDA" },
    { status: 400 }
  );
}

      tarotistaWorkerId = Number(workerByUserId.id || 0);
    } else {
      return NextResponse.json(
        { ok: false, error: "TAROTISTA_ID_INVALIDO" },
        { status: 400 }
      );
    }

    if (!Number.isFinite(tarotistaWorkerId) || !tarotistaWorkerId || tarotistaWorkerId <= 0) {
      return NextResponse.json(
        { ok: false, error: "TAROTISTA_ID_INVALIDO" },
        { status: 400 }
      );
    }

    const { data: tarotista, error: tarotistaError } = await admin
      .from("workers")
      .select("id, role")
      .eq("id", tarotistaWorkerId)
      .maybeSingle();

    if (tarotistaError) throw tarotistaError;

    if (!tarotista || String(tarotista.role || "").toLowerCase() !== "tarotista") {
  return NextResponse.json(
    { ok: false, error: "TAROTISTA_NO_VALIDA" },
    { status: 400 }
  );
}

    const { data, error } = await admin
      .from("crm_call_popups")
      .insert({
        tarotista_worker_id: tarotistaWorkerId,
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
