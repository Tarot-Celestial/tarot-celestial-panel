import { rouletteLevelForPurchaseAmount } from "@/lib/ruleta";
import {
  computeCurrentRankFromSpend,
  createClientNotification,
  monthRange,
  syncClientMonthTag,
  toNum,
} from "@/lib/server/cliente-platform";

export type PromotionPackageSnapshot = {
  kind: "promotion_minute_pack";
  snapshot_version: 2 | 3;
  promotion_id: string;
  promotion_name: string;
  package_id: string;
  package_name: string;
  description: string;
  paid_minutes: number;
  free_minutes: number;
  price: number;
  regular_price: number | null;
  currency: "EUR" | "USD";
  roulette_level: 1 | 2 | 3 | 4 | null;
  roulette_spins: number;
  roulette_assignment?: "amount" | "special_promotion" | null;
  special_roulette_granted?: boolean;
  coins: number;
  oracle_credits: number;
  extra_benefit: string | null;
  is_recommended: boolean;
};

function asIso(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function promotionIsLive(row: any, now = new Date()) {
  const status = String(row?.status || "").toLowerCase();
  if (!['active', 'scheduled'].includes(status)) return false;
  const start = row?.starts_at ? new Date(row.starts_at) : null;
  const end = row?.ends_at ? new Date(row.ends_at) : null;
  if (start && Number.isFinite(start.getTime()) && start.getTime() > now.getTime()) return false;
  if (!row?.active_until_disabled && end && Number.isFinite(end.getTime()) && end.getTime() <= now.getTime()) return false;
  if (row?.active_until_disabled !== true && row?.ends_at && end && end.getTime() <= now.getTime()) return false;
  return true;
}

export function effectivePromotionStatus(row: any, now = new Date()) {
  const status = String(row?.status || "draft").toLowerCase();
  if (status === "archived" || status === "inactive" || status === "draft") return status;
  const start = row?.starts_at ? new Date(row.starts_at) : null;
  const end = row?.ends_at ? new Date(row.ends_at) : null;
  if (!row?.active_until_disabled && end && Number.isFinite(end.getTime()) && end.getTime() <= now.getTime()) return "finished";
  if (start && Number.isFinite(start.getTime()) && start.getTime() > now.getTime()) return "scheduled";
  return "active";
}

export async function loadActivePromotion(admin: any) {
  const now = new Date();
  const nowIso = now.toISOString();
  const { data: promotions, error } = await admin
    .from("tc_client_promotions")
    .select("*")
    .in("status", ["active", "scheduled"])
    .order("created_at", { ascending: false });
  if (error) throw error;

  const rows = promotions || [];
  const expired = rows.filter((row: any) => {
    if (row?.active_until_disabled || !row?.ends_at) return false;
    const end = new Date(row.ends_at);
    return Number.isFinite(end.getTime()) && end.getTime() <= now.getTime();
  });
  if (expired.length) {
    await admin.from("tc_client_promotions").update({ status: "finished", deactivated_at: nowIso, updated_at: nowIso }).in("id", expired.map((row: any) => row.id));
  }

  const liveRows = rows.filter((row: any) => promotionIsLive(row, now));
  liveRows.sort((a: any, b: any) => {
    const ta = new Date(a.starts_at || a.activated_at || a.created_at || 0).getTime() || 0;
    const tb = new Date(b.starts_at || b.activated_at || b.created_at || 0).getTime() || 0;
    return tb - ta;
  });
  let live = liveRows[0] || null;
  if (!live) return null;

  // Solo una promoción principal puede quedar visible. Al llegar la hora de una
  // programada, sustituye automáticamente a cualquier campaña anterior.
  const otherLiveIds = liveRows.slice(1).map((row: any) => row.id);
  if (otherLiveIds.length) {
    await admin.from("tc_client_promotions").update({ status: "inactive", deactivated_at: nowIso, updated_at: nowIso }).in("id", otherLiveIds);
  }
  if (String(live.status) === "scheduled") {
    const { data: activated, error: activationError } = await admin.from("tc_client_promotions").update({
      status: "active",
      activated_at: live.activated_at || nowIso,
      deactivated_at: null,
      updated_at: nowIso,
    }).eq("id", live.id).select("*").single();
    if (activationError) throw activationError;
    live = activated;
  }

  const { data: packages, error: packageError } = await admin
    .from("tc_client_promotion_packages")
    .select("*")
    .eq("promotion_id", live.id)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (packageError) throw packageError;

  return {
    ...live,
    effective_status: effectivePromotionStatus(live),
    packages: packages || [],
  };
}

export function promotionPackageSnapshot(promotion: any, pack: any): PromotionPackageSnapshot {
  const price = Number(pack.price || 0);
  const rouletteSpins = Math.max(0, Math.floor(Number(pack.roulette_spins || 0)));
  const configuredLevel = Number(pack.roulette_level || 0);
  // Niveles 1-3 SIEMPRE se deducen del importe. El Nivel 4 es la única excepción:
  // solo existe cuando una promoción lo concede explícitamente desde Administración.
  const rouletteLevel = rouletteSpins > 0
    ? (configuredLevel === 4 ? 4 : rouletteLevelForPurchaseAmount(price))
    : null;

  return {
    kind: "promotion_minute_pack",
    snapshot_version: 3,
    promotion_id: String(promotion.id),
    promotion_name: String(promotion.name || "Promoción"),
    package_id: String(pack.id),
    package_name: String(pack.name || "Pack promoción"),
    description: String(pack.description || ""),
    paid_minutes: Math.max(0, Number(pack.paid_minutes || 0)),
    free_minutes: Math.max(0, Number(pack.free_minutes || 0)),
    price,
    regular_price: pack.regular_price == null ? null : Number(pack.regular_price),
    currency: String(pack.currency || "EUR").toUpperCase() === "USD" ? "USD" : "EUR",
    roulette_level: rouletteLevel,
    roulette_spins: rouletteLevel ? rouletteSpins : 0,
    roulette_assignment: rouletteLevel === 4 ? "special_promotion" : rouletteLevel ? "amount" : null,
    special_roulette_granted: rouletteLevel === 4 && rouletteSpins > 0,
    coins: Math.max(0, Math.floor(Number(pack.coins || 0))),
    oracle_credits: Math.max(0, Math.floor(Number(pack.oracle_credits || 0))),
    extra_benefit: pack.extra_benefit ? String(pack.extra_benefit) : null,
    is_recommended: Boolean(pack.is_recommended),
  };
}

async function ensurePromotionRouletteGrant(
  admin: any,
  params: {
    attemptId: string;
    clienteId: string;
    paymentId: string;
    totalMinutes: number;
    snapshot: PromotionPackageSnapshot;
  },
) {
  const expectedLevel = Number(params.snapshot.roulette_level || 0);
  const expectedSpins = Math.max(0, Math.floor(Number(params.snapshot.roulette_spins || 0)));
  if (![1, 2, 3, 4].includes(expectedLevel) || expectedSpins <= 0 || !params.paymentId) return [];

  const { data: byPurchase, error: purchaseError } = await admin
    .from("cliente_ruleta_giros")
    .select("id,nivel,estado,payment_key,purchase_id")
    .eq("cliente_id", params.clienteId)
    .eq("purchase_id", params.paymentId)
    .order("created_at", { ascending: true });
  if (purchaseError) throw purchaseError;

  const rows = [...(byPurchase || [])];
  if (rows.length < expectedSpins) {
    const { data: byReference, error: referenceError } = await admin
      .from("cliente_ruleta_giros")
      .select("id,nivel,estado,payment_key,purchase_id")
      .eq("cliente_id", params.clienteId)
      .or(`payment_key.ilike.%${params.attemptId}%,payment_key.ilike.%${params.paymentId}%`)
      .order("created_at", { ascending: true });
    if (referenceError) throw referenceError;
    const seen = new Set(rows.map((row: any) => String(row.id)));
    for (const row of byReference || []) {
      if (!seen.has(String(row.id))) { rows.push(row); seen.add(String(row.id)); }
    }
  }

  const pendingWrong = rows.filter((row: any) => row.estado === "pending" && Number(row.nivel) !== expectedLevel);
  if (pendingWrong.length) {
    const { error: repairError } = await admin
      .from("cliente_ruleta_giros")
      .update({ nivel: expectedLevel })
      .in("id", pendingWrong.map((row: any) => row.id));
    if (repairError) throw repairError;
    for (const row of pendingWrong) row.nivel = expectedLevel;
  }

  const usedWrong = rows.filter((row: any) => row.estado === "used" && Number(row.nivel) !== expectedLevel);
  if (usedWrong.length) {
    console.error("[client-promotions/roulette-used-level-mismatch]", {
      attemptId: params.attemptId, paymentId: params.paymentId, expectedLevel, spinIds: usedWrong.map((row: any) => row.id),
    });
  }

  const missing = Math.max(0, expectedSpins - rows.length);
  if (missing > 0) {
    const start = rows.length;
    const inserts = Array.from({ length: missing }, (_, index) => ({
      cliente_id: params.clienteId,
      payment_key: `promo_attempt:${params.attemptId}:spin:${start + index + 1}`,
      source: expectedLevel === 4 ? "promotion_super_roulette" : "promotion_pack",
      nivel: expectedLevel,
      purchase_minutes: Math.max(0, Math.floor(Number(params.totalMinutes || 0))),
      purchase_id: params.paymentId,
      estado: "pending",
    }));
    const { data: created, error: createError } = await admin
      .from("cliente_ruleta_giros")
      .upsert(inserts, { onConflict: "payment_key", ignoreDuplicates: true })
      .select("id,nivel,estado,payment_key,purchase_id");
    if (createError) throw createError;
    rows.push(...(created || []));
  }

  return rows;
}

export async function applyPromotionMinutePurchase(
  admin: any,
  params: {
    attemptId: string;
    clienteId: string;
    snapshot: PromotionPackageSnapshot;
    paymentRef: string;
    amount: number;
    currency: "EUR" | "USD";
  },
) {
  const originalSnap = params.snapshot;
  if (originalSnap.kind !== "promotion_minute_pack") throw new Error("PROMOTION_SNAPSHOT_INVALID");
  if (Math.abs(Number(params.amount) - Number(originalSnap.price)) > 0.001) throw new Error("PROMOTION_AMOUNT_MISMATCH");
  if (params.currency !== originalSnap.currency) throw new Error("PROMOTION_CURRENCY_MISMATCH");

  const configuredLevel = Number(originalSnap.roulette_level || 0);
  const automaticLevel = rouletteLevelForPurchaseAmount(params.amount);
  const effectiveLevel = originalSnap.roulette_spins > 0
    ? (configuredLevel === 4 ? 4 : automaticLevel)
    : null;
  const normalizedSpins = effectiveLevel ? Math.max(0, Math.floor(Number(originalSnap.roulette_spins || 0))) : 0;
  const snap: PromotionPackageSnapshot = {
    ...originalSnap,
    snapshot_version: 3,
    roulette_level: effectiveLevel,
    roulette_spins: normalizedSpins,
    roulette_assignment: effectiveLevel === 4 ? "special_promotion" : effectiveLevel ? "amount" : null,
    special_roulette_granted: effectiveLevel === 4 && normalizedSpins > 0,
  };

  // Corrige también intentos creados antes de desplegar esta versión para que la RPC
  // lea la misma verdad: importe -> nivel automático (salvo Nivel Especial explícito).
  try {
    await admin.from("cliente_payment_attempts").update({
      promotion_snapshot: snap,
    }).eq("id", params.attemptId).neq("status", "completed");
  } catch (error) {
    console.error("[client-promotions/normalize-roulette-snapshot]", error);
  }

  const totalMinutes = snap.paid_minutes + snap.free_minutes;
  const { data: transaction, error: transactionError } = await admin.rpc("cliente_confirmar_compra_promocion_v1", {
    p_attempt_id: params.attemptId,
  });
  if (transactionError) throw transactionError;

  const payment = transaction?.payment;
  const paymentId = String(payment?.id || "");
  const grantedSpins = paymentId ? await ensurePromotionRouletteGrant(admin, {
    attemptId: params.attemptId,
    clienteId: params.clienteId,
    paymentId,
    totalMinutes,
    snapshot: snap,
  }) : [];
  if (transaction?.duplicated) return { ok: true, ...transaction, spins: grantedSpins };

  let monthlySpend = 0;
  let monthlyPurchases = 0;
  let nextRank = computeCurrentRankFromSpend(0, 0);
  try {
    const { start, end } = monthRange(new Date());
    const { data: monthPayments } = await admin
      .from("crm_cliente_pagos")
      .select("id,importe,estado")
      .eq("cliente_id", params.clienteId)
      .eq("estado", "completed")
      .gte("created_at", start.toISOString())
      .lt("created_at", end.toISOString());
    monthlySpend = (monthPayments || []).reduce((acc: number, row: any) => acc + toNum(row?.importe), 0);
    monthlyPurchases = (monthPayments || []).length;
    nextRank = computeCurrentRankFromSpend(monthlySpend, monthlyPurchases);
    await syncClientMonthTag(admin, params.clienteId);
  } catch (error) {
    console.error("[client-promotions/post-purchase-stats]", error);
  }

  const benefitBits = [
    `${snap.paid_minutes} min`,
    snap.free_minutes ? `+${snap.free_minutes} min GRATIS` : null,
    snap.coins ? `+${snap.coins} Coins` : null,
    snap.roulette_spins && snap.roulette_level ? `+${snap.roulette_spins} giro${snap.roulette_spins === 1 ? "" : "s"} ${snap.roulette_level === 4 ? "Super Ruleta · Nivel Especial" : `Ultra Sorpresas · Nivel ${snap.roulette_level}`}` : null,
    snap.oracle_credits ? `+${snap.oracle_credits} tirada${snap.oracle_credits === 1 ? "" : "s"} de Oráculo` : null,
  ].filter(Boolean).join(" · ");

  try {
    await createClientNotification(admin, {
      cliente_id: params.clienteId,
      tipo: "purchase_completed",
      titulo: `Promoción aplicada: ${snap.promotion_name}`,
      mensaje: `${snap.package_name} confirmada. ${benefitBits}.`,
      meta: {
        promotion_id: snap.promotion_id,
        package_id: snap.package_id,
        snapshot: snap,
        roulette_level: snap.roulette_level,
        roulette_spins: snap.roulette_spins,
        roulette_assignment: snap.roulette_assignment || null,
        special_roulette_granted: Boolean(snap.special_roulette_granted),
        payment_reference: params.paymentRef,
      },
    });
  } catch (error) {
    console.error("[client-promotions/client-notification]", error);
  }

  try {
    const nowIso = new Date().toISOString();
    const { data: cliente } = await admin.from("crm_clientes").select("nombre,apellido").eq("id", params.clienteId).maybeSingle();
    const name = [cliente?.nombre, cliente?.apellido].filter(Boolean).join(" ").trim() || "Cliente";
    await admin.from("notifications").insert({
      type: "cliente_payment_completed",
      title: "Compra de promoción completada",
      message: `${name} compró ${snap.promotion_name} · ${snap.package_name} por ${params.amount.toFixed(2)} ${params.currency}.`,
      cliente_id: params.clienteId,
      read: false,
      created_at: nowIso,
    });
  } catch {
    // Notificación interna opcional.
  }

  return { ok: true, duplicated: false, payment, rank: nextRank, monthlySpend, monthlyPurchases, totalMinutes };
}

export function normalizePromotionDate(value: unknown) {
  return asIso(value);
}
