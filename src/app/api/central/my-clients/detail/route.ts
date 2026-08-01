import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getAuthUserFromRequest } from "@/lib/server/auth-fast";
import { calculateClientFidelity } from "@/lib/server/client-fidelity";

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
      admin.from("crm_cliente_pagos").select("id, cliente_id, importe, moneda, metodo, estado, notas, referencia_externa, created_at").eq("cliente_id", id).order("created_at", { ascending: false }),
      admin.from("crm_client_notes").select("*").eq("cliente_id", id).order("is_pinned", { ascending: false }).order("created_at", { ascending: false }),
      admin.from("crm_interacciones").select("id, estado, notas_central, origen, tarotista_worker_id, created_at, cerrado_at").eq("cliente_id", id).order("created_at", { ascending: false }),
      admin.from("rendimiento_llamadas").select("id, fecha_hora, fecha, importe, forma_pago, resumen_codigo, cliente_compra_minutos, telefonista_nombre, tarotista_nombre").eq("cliente_id", id).order("fecha_hora", { ascending: false }),
    ]);

    if (clientResult.error) throw clientResult.error;
    if (!clientResult.data) return NextResponse.json({ ok: false, error: "CLIENT_NOT_FOUND" }, { status: 404 });

    const payments = (paymentsResult.data || []).filter(completedPayment);
    const notes = notesResult.error ? [] : notesResult.data || [];
    const interactions = interactionsResult.error ? [] : interactionsResult.data || [];
    const calls = callsResult.error ? [] : callsResult.data || [];
    const latestPurchase = payments[0] || null;
    const totalSpent = payments.reduce((sum: number, payment: any) => sum + (Number(payment.importe) || 0), 0);
    const fidelityPurchases = [
      ...payments,
      ...calls
        .filter((row: any) => Boolean(row.cliente_compra_minutos) && (Number(row.importe) || 0) > 0)
        .map((row: any) => ({ created_at: row.fecha_hora || row.fecha || null, importe: row.importe })),
    ];
    const fidelity = calculateClientFidelity({
      capturedAt: clientResult.data.created_at || null,
      purchases: fidelityPurchases,
      calls: calls.map((row: any) => ({ created_at: row.fecha_hora || row.fecha || null })),
      interactions,
      notes,
    });

    const { data: availableTarotists, error: tarotistsError } = await admin
      .from("workers")
      .select("id, display_name, role, is_active")
      .eq("role", "tarotista")
      .eq("is_active", true)
      .order("display_name", { ascending: true });
    if (tarotistsError) throw tarotistsError;

    let savedFavorites: any[] = [];
    const favoriteResult = await admin
      .from("client_favorite_tarotists")
      .select("id, client_id, tarotist_worker_id, created_at")
      .eq("client_id", id)
      .order("created_at", { ascending: true });

    if (!favoriteResult.error) {
      const nameById = new Map((availableTarotists || []).map((row: any) => [String(row.id), String(row.display_name || "Tarotista")]));
      savedFavorites = (favoriteResult.data || []).map((row: any) => ({
        id: row.id,
        tarotist_id: row.tarotist_worker_id,
        name: nameById.get(String(row.tarotist_worker_id)) || "Tarotista",
        created_at: row.created_at,
      }));
    }

    return NextResponse.json({
      ok: true,
      cliente: clientResult.data,
      responsable: null,
      ultima_compra: latestPurchase,
      resumen: {
        captured_at: clientResult.data.created_at || null,
        captured_by: null,
        fidelity_index: fidelity.score,
        fidelity,
        favorite_tarotists: savedFavorites,
        available_tarotists: (availableTarotists || []).map((row: any) => ({ id: row.id, name: row.display_name || "Tarotista" })),
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
