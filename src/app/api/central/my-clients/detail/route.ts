import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getAuthUserFromRequest } from "@/lib/server/auth-fast";
import { calculateClientFidelity } from "@/lib/server/client-fidelity";
import { loadRolling30ClientTotals } from "@/lib/server/client-ranks";
import { loadEffectiveClientRank } from "@/lib/server/client-rank-effective";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
    .select("id, role, display_name, user_id")
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
    const [clientResult, paymentsResult, notesResult, interactionsResult, callsResult, followUpsResult] = await Promise.all([
      admin.from("crm_clientes").select("*").eq("id", id).maybeSingle(),
      admin.from("crm_cliente_pagos").select("*").eq("cliente_id", id).order("created_at", { ascending: false }),
      admin.from("crm_client_notes").select("*").eq("cliente_id", id).order("is_pinned", { ascending: false }).order("created_at", { ascending: false }),
      admin.from("crm_interacciones").select("id, estado, notas_central, origen, tarotista_worker_id, created_at, cerrado_at").eq("cliente_id", id).order("created_at", { ascending: false }),
      admin.from("rendimiento_llamadas").select("id, fecha_hora, fecha, created_at, importe, forma_pago, resumen_codigo, cliente_compra_minutos, usa_7_free, usa_minutos, tipo_registro, guarda_minutos, minutos_guardados_free, minutos_guardados_normales, telefonista_worker_id, telefonista_nombre, tarotista_nombre").eq("cliente_id", id).order("fecha_hora", { ascending: false }),
      admin.from("crm_client_followups").select("id, status, created_at").eq("client_id", id),
    ]);

    if (clientResult.error) throw clientResult.error;
    if (!clientResult.data) return NextResponse.json({ ok: false, error: "CLIENT_NOT_FOUND" }, { status: 404 });

    const rankNowIso = new Date().toISOString();
    const rankSinceIso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const rankTotals = await loadRolling30ClientTotals(admin, [clientResult.data], rankSinceIso, rankNowIso);
    const rankWindow = rankTotals.get(String(clientResult.data.id)) || { total: 0, compras: 0 };
    const effectiveRank = await loadEffectiveClientRank(admin, id, Number(rankWindow.total || 0));
    const clientWithRank = {
      ...clientResult.data,
      rango_automatico: effectiveRank.automatic,
      rango_efectivo: effectiveRank.effective,
      rango_intervencion: effectiveRank.override,
      rango_actual: effectiveRank.effective,
      rango_gasto_30d: Number((rankWindow.total || 0).toFixed(2)),
      rango_compras_30d: Number(rankWindow.compras || 0),
    };

    const responsibleId = String(
      clientResult.data.captured_by_worker_id ||
      clientResult.data.responsable_worker_id ||
      clientResult.data.assigned_worker_id ||
      ""
    ).trim();
    let responsible: { id: string; display_name: string | null } | null = null;
    if (responsibleId) {
      const { data: responsibleWorker, error: responsibleError } = await admin
        .from("workers")
        .select("id, display_name")
        .eq("id", responsibleId)
        .maybeSingle();
      if (responsibleError) throw responsibleError;
      if (responsibleWorker) responsible = responsibleWorker;
    }

    const payments = (paymentsResult.data || []).filter(completedPayment);
    const notes = notesResult.error ? [] : notesResult.data || [];
    const interactions = interactionsResult.error ? [] : interactionsResult.data || [];
    const calls = callsResult.error ? [] : callsResult.data || [];
    const followUps = followUpsResult.error ? [] : followUpsResult.data || [];
    const rawLatestPurchase = payments[0] || null;
    const linkedLatestCall = rawLatestPurchase?.source_rendimiento_id
      ? calls.find((row: any) => String(row.id) === String(rawLatestPurchase.source_rendimiento_id)) || null
      : null;
    const readNumber = (row: any, keys: string[]) => {
      for (const key of keys) {
        const raw = row?.[key];
        if (raw !== undefined && raw !== null && raw !== "") {
          const value = Number(String(raw).replace(",", "."));
          if (Number.isFinite(value)) return Math.max(0, value);
        }
      }
      return 0;
    };
    const paymentFreeMinutes = rawLatestPurchase ? readNumber(rawLatestPurchase, ["minutos_free", "free_minutes", "minutos_gratis", "bonus_minutes", "minutos_guardados_free"]) : 0;
    const paymentNormalMinutes = rawLatestPurchase ? readNumber(rawLatestPurchase, ["minutos_normales", "normal_minutes", "paid_minutes", "minutos_pagados", "minutos_guardados_normales"]) : 0;
    const linkedFreeMinutes = linkedLatestCall ? readNumber(linkedLatestCall, ["minutos_guardados_free"]) : 0;
    const linkedNormalMinutes = linkedLatestCall ? readNumber(linkedLatestCall, ["minutos_guardados_normales"]) : 0;
    const latestPurchase = rawLatestPurchase ? {
      ...rawLatestPurchase,
      minutes_free: paymentFreeMinutes || linkedFreeMinutes,
      minutes_normal: paymentNormalMinutes || linkedNormalMinutes,
      minutes_total: (paymentFreeMinutes || linkedFreeMinutes) + (paymentNormalMinutes || linkedNormalMinutes),
    } : null;
    const currentFreeMinutes = Math.max(0, Number(clientResult.data.minutos_free_pendientes || 0));
    const currentNormalMinutes = Math.max(0, Number(clientResult.data.minutos_normales_pendientes || 0));
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
      cliente: clientWithRank,
      responsable: responsible,
      ultima_compra: latestPurchase,
      resumen: {
        captured_at: clientResult.data.captured_at || clientResult.data.created_at || null,
        captured_by: responsible,
        fidelity_index: fidelity.score,
        fidelity,
        favorite_tarotists: savedFavorites,
        available_tarotists: (availableTarotists || []).map((row: any) => ({ id: row.id, name: row.display_name || "Tarotista" })),
        notes,
        interactions,
        calls,
        payments,
        current_balance: {
          free: currentFreeMinutes,
          normal: currentNormalMinutes,
          total: currentFreeMinutes + currentNormalMinutes,
        },
        totals: {
          purchases: payments.length,
          spent: Number(totalSpent.toFixed(2)),
          calls: calls.length,
          consultations: interactions.length,
          followUps: followUps.length,
          messages: 0,
          minutes: currentFreeMinutes + currentNormalMinutes,
        },
      },
    }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || "ERR_CLIENT_DETAIL" }, { status: 500 });
  }
}
