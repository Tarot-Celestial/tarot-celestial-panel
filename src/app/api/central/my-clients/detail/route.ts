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
    .select("id, role, display_name")
    .eq("user_id", data.user.id)
    .maybeSingle();
  if (workerError) throw workerError;
  if (!worker || !["admin", "central"].includes(String(worker.role || ""))) return null;
  return worker;
}

function completedPayment(row: any) {
  return String(row?.estado || "").toLowerCase() === "completed";
}

export async function GET(req: Request) {
  try {
    const worker = await authenticatedWorker(req);
    if (!worker) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });

    const id = String(new URL(req.url).searchParams.get("id") || "").trim();
    if (!id) return NextResponse.json({ ok: false, error: "ID_REQUIRED" }, { status: 400 });

    const admin = adminClient();
    const [clientResult, paymentsResult, notesResult, interactionsResult, callsResult] = await Promise.all([
      admin.from("crm_clientes").select("*").eq("id", id).maybeSingle(),
      admin.from("crm_cliente_pagos").select("id, cliente_id, importe, moneda, metodo, estado, notas, referencia_externa, created_at").eq("cliente_id", id).order("created_at", { ascending: false }).limit(100),
      admin.from("crm_client_notes").select("id, texto, author_name, author_email, is_pinned, created_at, updated_at").eq("cliente_id", id).order("is_pinned", { ascending: false }).order("created_at", { ascending: false }).limit(12),
      admin.from("crm_interacciones").select("id, estado, notas_central, origen, tarotista_worker_id, created_at, cerrado_at").eq("cliente_id", id).order("created_at", { ascending: false }).limit(30),
      admin.from("rendimiento_llamadas").select("id, fecha_hora, fecha, importe, forma_pago, resumen_codigo, cliente_compra_minutos, telefonista_nombre, tarotista_nombre").eq("cliente_id", id).order("fecha_hora", { ascending: false }).limit(30),
    ]);

    if (clientResult.error) throw clientResult.error;
    if (!clientResult.data) return NextResponse.json({ ok: false, error: "CLIENT_NOT_FOUND" }, { status: 404 });

    const payments = (paymentsResult.data || []).filter(completedPayment);
    const notes = notesResult.error ? [] : notesResult.data || [];
    const interactions = interactionsResult.error ? [] : interactionsResult.data || [];
    const calls = callsResult.error ? [] : callsResult.data || [];
    const latestPurchase = payments[0] || null;
    const totalSpent = payments.reduce((sum: number, payment: any) => sum + (Number(payment.importe) || 0), 0);

    const tarotistaIds = Array.from(new Set(interactions.map((row: any) => String(row.tarotista_worker_id || "")).filter(Boolean)));
    const workerNames = new Map<string, string>();
    if (tarotistaIds.length) {
      const { data: tarotistas } = await admin.from("workers").select("id, display_name").in("id", tarotistaIds);
      for (const tarotista of tarotistas || []) workerNames.set(String(tarotista.id), String(tarotista.display_name || "Tarotista"));
    }

    const favoriteMap = new Map<string, { name: string; count: number }>();
    for (const interaction of interactions) {
      const name = workerNames.get(String((interaction as any).tarotista_worker_id || ""));
      if (!name) continue;
      const current = favoriteMap.get(name) || { name, count: 0 };
      current.count += 1;
      favoriteMap.set(name, current);
    }

    return NextResponse.json({
      ok: true,
      cliente: clientResult.data,
      responsable: null,
      ultima_compra: latestPurchase,
      resumen: {
        captured_at: clientResult.data.created_at || null,
        captured_by: null,
        fidelity_index: null,
        favorite_tarotists: Array.from(favoriteMap.values()).sort((a, b) => b.count - a.count).slice(0, 3),
        notes,
        interactions,
        calls,
        payments,
        totals: {
          purchases: payments.length,
          spent: Number(totalSpent.toFixed(2)),
          calls: calls.length,
          consultations: interactions.length,
          followUps: 0,
          messages: 0,
          minutes: null,
        },
      },
    });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || "ERR_CLIENT_DETAIL" }, { status: 500 });
  }
}
