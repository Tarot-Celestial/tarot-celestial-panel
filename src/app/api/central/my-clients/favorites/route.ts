import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getAuthUserFromRequest } from "@/lib/server/auth-fast";

export const runtime = "nodejs";

function env(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

function adminClient() {
  return createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });
}

async function authenticatedWorker(req: Request) {
  const { data, error } = getAuthUserFromRequest(req);
  if (error || !data.user?.id) return null;
  const admin = adminClient();
  const { data: worker, error: workerError } = await admin
    .from("workers")
    .select("id, role")
    .eq("user_id", data.user.id)
    .maybeSingle();
  if (workerError) throw workerError;
  if (!worker || !["admin", "central"].includes(String(worker.role || ""))) return null;
  return worker;
}

async function clientExists(clientId: string) {
  const admin = adminClient();
  const { data, error } = await admin.from("crm_clientes").select("id").eq("id", clientId).maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

export async function POST(req: Request) {
  try {
    const worker = await authenticatedWorker(req);
    if (!worker) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const clientId = String(body?.client_id || "").trim();
    const tarotistId = String(body?.tarotist_id || "").trim();
    if (!clientId || !tarotistId) {
      return NextResponse.json({ ok: false, error: "CLIENT_AND_TAROTIST_REQUIRED" }, { status: 400 });
    }
    if (!(await clientExists(clientId))) {
      return NextResponse.json({ ok: false, error: "CLIENT_NOT_FOUND" }, { status: 404 });
    }

    const admin = adminClient();
    const { data: tarotist, error: tarotistError } = await admin
      .from("workers")
      .select("id, display_name, role, is_active")
      .eq("id", tarotistId)
      .maybeSingle();
    if (tarotistError) throw tarotistError;
    if (!tarotist || String(tarotist.role || "") !== "tarotista" || tarotist.is_active === false) {
      return NextResponse.json({ ok: false, error: "INVALID_TAROTIST" }, { status: 400 });
    }

    const { error } = await admin.from("client_favorite_tarotists").insert({
      client_id: clientId,
      tarotist_worker_id: tarotistId,
      created_by_worker_id: worker.id,
    });
    if (error) {
      if (String(error.code || "") === "23505") {
        return NextResponse.json({ ok: false, error: "ALREADY_FAVORITE" }, { status: 409 });
      }
      throw error;
    }

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || "ERR_ADD_FAVORITE" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const worker = await authenticatedWorker(req);
    if (!worker) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const clientId = String(body?.client_id || "").trim();
    const tarotistId = String(body?.tarotist_id || "").trim();
    if (!clientId || !tarotistId) {
      return NextResponse.json({ ok: false, error: "CLIENT_AND_TAROTIST_REQUIRED" }, { status: 400 });
    }

    const admin = adminClient();
    const { error } = await admin
      .from("client_favorite_tarotists")
      .delete()
      .eq("client_id", clientId)
      .eq("tarotist_worker_id", tarotistId);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || "ERR_REMOVE_FAVORITE" }, { status: 500 });
  }
}
