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
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return null;

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

export async function GET(req: Request) {
  try {
    const worker = await authenticatedWorker(req);
    if (!worker) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });

    const id = String(new URL(req.url).searchParams.get("id") || "").trim();
    if (!id) return NextResponse.json({ ok: false, error: "ID_REQUIRED" }, { status: 400 });

    const admin = adminClient();
    const [{ data: cliente, error: clientError }, { data: payment, error: paymentError }] = await Promise.all([
      admin.from("crm_clientes").select("*").eq("id", id).maybeSingle(),
      admin
        .from("crm_cliente_pagos")
        .select("id, cliente_id, created_at, estado, notas, referencia_externa")
        .eq("cliente_id", id)
        .eq("estado", "completed")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    if (clientError) throw clientError;
    if (paymentError) throw paymentError;
    if (!cliente) return NextResponse.json({ ok: false, error: "CLIENT_NOT_FOUND" }, { status: 404 });

    return NextResponse.json({
      ok: true,
      cliente,
      ultima_compra: payment || null,
    });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || "ERR_CLIENT_DETAIL" }, { status: 500 });
  }
}
