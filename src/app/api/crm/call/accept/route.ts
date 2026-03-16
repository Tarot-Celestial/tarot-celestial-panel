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

export async function POST(req: Request) {
  try {
    const worker = await workerFromReq(req);

    if (!worker) {
      return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    }

    if (String(worker.role || "") !== "tarotista") {
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const popup_id = Number(body?.popup_id || 0);

    if (!popup_id || !Number.isFinite(popup_id)) {
      return NextResponse.json(
        { ok: false, error: "FALTA_POPUP_ID" },
        { status: 400 }
      );
    }

    const admin = adminClient();

    const { data: popup, error: popupError } = await admin
      .from("crm_call_popups")
      .select("*")
      .eq("id", popup_id)
      .maybeSingle();

    if (popupError) throw popupError;

    if (!popup) {
      return NextResponse.json(
        { ok: false, error: "POPUP_NO_ENCONTRADO" },
        { status: 404 }
      );
    }

    if (String(popup.tarotista_worker_id || "") !== String(worker.id || "")) {
      return NextResponse.json(
        { ok: false, error: "POPUP_NO_PERTENECE_A_TAROTISTA" },
        { status: 403 }
      );
    }

    if (popup.closed === true) {
      return NextResponse.json(
        { ok: false, error: "LLAMADA_YA_CERRADA" },
        { status: 400 }
      );
    }

    const { data, error } = await admin
      .from("crm_call_popups")
      .update({
        accepted: true,
        visible: false,
        accepted_at: new Date().toISOString(),
        closed: false,
      })
      .eq("id", popup_id)
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
