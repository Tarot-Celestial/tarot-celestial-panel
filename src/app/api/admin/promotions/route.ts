import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import { effectivePromotionStatus, normalizePromotionDate } from "@/lib/server/client-promotions";

export const runtime = "nodejs";

function cleanText(value: unknown, max = 500) {
  const v = String(value || "").trim();
  return v ? v.slice(0, max) : null;
}

function cleanStatus(value: unknown) {
  const v = String(value || "draft").toLowerCase();
  const allowed = new Set(["draft", "scheduled", "active", "finished", "inactive", "archived"]);
  return allowed.has(v) ? v : "draft";
}

async function audit(admin: any, promotionId: string | null, action: string, actorUserId: string | null, snapshot: any, actorName?: string | null) {
  try {
    await admin.from("tc_client_promotion_audit").insert({
      promotion_id: promotionId,
      action,
      actor_user_id: actorUserId,
      snapshot: { ...(snapshot || {}), _actor: actorName || null },
    });
  } catch {
    // La auditoría no debe bloquear una edición válida.
  }
}

async function payload(admin: any) {
  const { data: promotions, error } = await admin
    .from("tc_client_promotions")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;

  const ids = (promotions || []).map((row: any) => row.id);
  let packages: any[] = [];
  let audits: any[] = [];
  let attempts: any[] = [];

  if (ids.length) {
    const [packageResult, auditResult, attemptResult] = await Promise.all([
      admin.from("tc_client_promotion_packages").select("*").in("promotion_id", ids).order("sort_order", { ascending: true }),
      admin.from("tc_client_promotion_audit").select("*").in("promotion_id", ids).order("created_at", { ascending: false }).limit(100),
      admin.from("cliente_payment_attempts").select("promotion_id,promotion_package_id,amount,currency,status,cliente_id,completed_at,created_at").in("promotion_id", ids).eq("status", "completed"),
    ]);
    if (packageResult.error) throw packageResult.error;
    if (auditResult.error) throw auditResult.error;
    if (attemptResult.error) throw attemptResult.error;
    packages = packageResult.data || [];
    audits = auditResult.data || [];
    attempts = attemptResult.data || [];
  }

  const packageMap = new Map<string, any[]>();
  for (const pack of packages) {
    const key = String(pack.promotion_id);
    const arr = packageMap.get(key) || [];
    arr.push(pack);
    packageMap.set(key, arr);
  }

  const auditMap = new Map<string, any[]>();
  for (const row of audits) {
    const key = String(row.promotion_id || "");
    const arr = auditMap.get(key) || [];
    if (arr.length < 12) arr.push(row);
    auditMap.set(key, arr);
  }

  const statsMap = new Map<string, any>();
  for (const row of attempts) {
    const key = String(row.promotion_id || "");
    if (!key) continue;
    const stat = statsMap.get(key) || { purchases: 0, clients: new Set<string>(), by_currency: {}, packages: {} };
    stat.purchases += 1;
    stat.clients.add(String(row.cliente_id || ""));
    const currency = String(row.currency || "EUR").toUpperCase();
    stat.by_currency[currency] = Number(stat.by_currency[currency] || 0) + Number(row.amount || 0);
    const packageId = String(row.promotion_package_id || "");
    if (packageId) stat.packages[packageId] = Number(stat.packages[packageId] || 0) + 1;
    statsMap.set(key, stat);
  }

  return (promotions || []).map((row: any) => {
    const stat = statsMap.get(String(row.id));
    const packRows = packageMap.get(String(row.id)) || [];
    let topPackage: any = null;
    let topCount = 0;
    if (stat) {
      for (const pack of packRows) {
        const count = Number(stat.packages[String(pack.id)] || 0);
        if (count > topCount) {
          topCount = count;
          topPackage = pack;
        }
      }
    }
    return {
      ...row,
      effective_status: effectivePromotionStatus(row),
      packages: packRows,
      audit: auditMap.get(String(row.id)) || [],
      stats: {
        purchases: stat?.purchases || 0,
        unique_clients: stat?.clients?.size || 0,
        revenue_by_currency: stat?.by_currency || {},
        top_package: topPackage ? { id: topPackage.id, name: topPackage.name, purchases: topCount } : null,
      },
    };
  });
}

export async function GET(req: Request) {
  try {
    const gate = await requireAdmin(req);
    if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: gate.error === "FORBIDDEN" ? 403 : 401 });
    return NextResponse.json({ ok: true, promotions: await payload(gate.admin) });
  } catch (error: any) {
    console.error("[admin/promotions:get]", error);
    return NextResponse.json({ ok: false, error: error?.message || "PROMOTIONS_LOAD_FAILED" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const gate = await requireAdmin(req);
    if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: gate.error === "FORBIDDEN" ? 403 : 401 });
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "").trim();
    const now = new Date().toISOString();
    const actor = String(gate.me?.user_id || "") || null;
    const actorName = String(gate.me?.display_name || gate.me?.email || "Admin");

    if (action === "create_promotion") {
      const name = cleanText(body?.name, 120);
      if (!name) return NextResponse.json({ ok: false, error: "NOMBRE_REQUERIDO" }, { status: 400 });
      const { data, error } = await gate.admin.from("tc_client_promotions").insert({ name, status: "draft", created_by: actor, updated_at: now }).select("*").single();
      if (error) throw error;
      await audit(gate.admin, data.id, "created", actor, data, actorName);
      return NextResponse.json({ ok: true, promotion: data, promotions: await payload(gate.admin) });
    }

    if (action === "update_promotion") {
      const id = String(body?.id || "");
      if (!id) return NextResponse.json({ ok: false, error: "PROMOTION_ID_REQUIRED" }, { status: 400 });
      const status = cleanStatus(body?.status);
      const startsAt = normalizePromotionDate(body?.starts_at);
      const endsAt = normalizePromotionDate(body?.ends_at);
      const activeUntilDisabled = Boolean(body?.active_until_disabled);
      if (!activeUntilDisabled && startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) {
        return NextResponse.json({ ok: false, error: "FECHA_FIN_DEBE_SER_POSTERIOR" }, { status: 400 });
      }
      const update = {
        name: cleanText(body?.name, 120),
        subtitle: cleanText(body?.subtitle, 180),
        description: cleanText(body?.description, 1000),
        status,
        starts_at: startsAt,
        ends_at: activeUntilDisabled ? null : endsAt,
        active_until_disabled: activeUntilDisabled,
        updated_at: now,
      };
      if (!update.name) return NextResponse.json({ ok: false, error: "NOMBRE_REQUERIDO" }, { status: 400 });
      const { data, error } = await gate.admin.from("tc_client_promotions").update(update).eq("id", id).select("*").single();
      if (error) throw error;
      await audit(gate.admin, id, "updated", actor, data, actorName);
      return NextResponse.json({ ok: true, promotion: data, promotions: await payload(gate.admin) });
    }

    if (action === "activate") {
      const id = String(body?.id || "");
      if (!id) return NextResponse.json({ ok: false, error: "PROMOTION_ID_REQUIRED" }, { status: 400 });
      await gate.admin.from("tc_client_promotions").update({ status: "inactive", deactivated_at: now, updated_at: now }).eq("status", "active").neq("id", id);
      const { data, error } = await gate.admin.from("tc_client_promotions").update({ status: "active", activated_at: now, activated_by: actor, deactivated_at: null, starts_at: body?.keep_schedule ? undefined : now, updated_at: now }).eq("id", id).select("*").single();
      if (error) throw error;
      await audit(gate.admin, id, "activated", actor, data, actorName);
      return NextResponse.json({ ok: true, promotion: data, promotions: await payload(gate.admin) });
    }

    if (action === "deactivate") {
      const id = String(body?.id || "");
      const { data, error } = await gate.admin.from("tc_client_promotions").update({ status: "inactive", deactivated_at: now, updated_at: now }).eq("id", id).select("*").single();
      if (error) throw error;
      await audit(gate.admin, id, "deactivated", actor, data, actorName);
      return NextResponse.json({ ok: true, promotion: data, promotions: await payload(gate.admin) });
    }

    if (action === "duplicate") {
      const id = String(body?.id || "");
      const { data: source, error: sourceError } = await gate.admin.from("tc_client_promotions").select("*").eq("id", id).single();
      if (sourceError) throw sourceError;
      const { data: newPromotion, error: insertError } = await gate.admin.from("tc_client_promotions").insert({
        name: `${source.name} · copia`,
        subtitle: source.subtitle,
        description: source.description,
        status: "draft",
        active_until_disabled: true,
        created_by: actor,
        updated_at: now,
      }).select("*").single();
      if (insertError) throw insertError;
      const { data: sourcePackages, error: packError } = await gate.admin.from("tc_client_promotion_packages").select("*").eq("promotion_id", id);
      if (packError) throw packError;
      if ((sourcePackages || []).length) {
        const rows = (sourcePackages || []).map((pack: any) => ({
          promotion_id: newPromotion.id,
          name: pack.name,
          description: pack.description,
          paid_minutes: pack.paid_minutes,
          free_minutes: pack.free_minutes,
          price: pack.price,
          regular_price: pack.regular_price,
          currency: pack.currency,
          roulette_level: pack.roulette_level,
          roulette_spins: pack.roulette_spins,
          coins: pack.coins,
          oracle_credits: pack.oracle_credits,
          extra_benefit: pack.extra_benefit,
          is_recommended: pack.is_recommended,
          is_active: pack.is_active,
          sort_order: pack.sort_order,
        }));
        const { error } = await gate.admin.from("tc_client_promotion_packages").insert(rows);
        if (error) throw error;
      }
      await audit(gate.admin, newPromotion.id, "duplicated", actor, { source_id: id, source_name: source.name }, actorName);
      return NextResponse.json({ ok: true, promotion: newPromotion, promotions: await payload(gate.admin) });
    }

    if (action === "add_package" || action === "update_package") {
      const promotionId = String(body?.promotion_id || "");
      const packageId = String(body?.package_id || "");
      const name = cleanText(body?.name, 120);
      const price = Number(body?.price || 0);
      const paidMinutes = Math.max(0, Math.floor(Number(body?.paid_minutes || 0)));
      const freeMinutes = Math.max(0, Math.floor(Number(body?.free_minutes || 0)));
      const currency = String(body?.currency || "EUR").toUpperCase() === "USD" ? "USD" : "EUR";
      if (!promotionId || !name || !Number.isFinite(price) || price <= 0 || paidMinutes + freeMinutes <= 0) {
        return NextResponse.json({ ok: false, error: "DATOS_PAQUETE_INVALIDOS" }, { status: 400 });
      }
      const row = {
        promotion_id: promotionId,
        name,
        description: cleanText(body?.description, 500),
        paid_minutes: paidMinutes,
        free_minutes: freeMinutes,
        price,
        regular_price: body?.regular_price === "" || body?.regular_price == null ? null : Number(body.regular_price),
        currency,
        roulette_level: [1, 2, 3].includes(Number(body?.roulette_level)) ? Number(body.roulette_level) : null,
        roulette_spins: Math.max(0, Math.floor(Number(body?.roulette_spins || 0))),
        coins: Math.max(0, Math.floor(Number(body?.coins || 0))),
        oracle_credits: Math.max(0, Math.floor(Number(body?.oracle_credits || 0))),
        extra_benefit: cleanText(body?.extra_benefit, 300),
        is_recommended: Boolean(body?.is_recommended),
        is_active: body?.is_active !== false,
        sort_order: Math.floor(Number(body?.sort_order || 0)),
        updated_at: now,
      };
      let result;
      if (action === "add_package") result = await gate.admin.from("tc_client_promotion_packages").insert(row).select("*").single();
      else result = await gate.admin.from("tc_client_promotion_packages").update(row).eq("id", packageId).eq("promotion_id", promotionId).select("*").single();
      if (result.error) throw result.error;
      await audit(gate.admin, promotionId, action === "add_package" ? "package_created" : "package_updated", actor, result.data, actorName);
      return NextResponse.json({ ok: true, package: result.data, promotions: await payload(gate.admin) });
    }

    if (action === "duplicate_package") {
      const promotionId = String(body?.promotion_id || "");
      const packageId = String(body?.package_id || "");
      const { data: source, error: sourceError } = await gate.admin.from("tc_client_promotion_packages").select("*").eq("id", packageId).eq("promotion_id", promotionId).single();
      if (sourceError) throw sourceError;
      const { data, error } = await gate.admin.from("tc_client_promotion_packages").insert({
        promotion_id: promotionId,
        name: `${source.name} · copia`,
        description: source.description,
        paid_minutes: source.paid_minutes,
        free_minutes: source.free_minutes,
        price: source.price,
        regular_price: source.regular_price,
        currency: source.currency,
        roulette_level: source.roulette_level,
        roulette_spins: source.roulette_spins,
        coins: source.coins,
        oracle_credits: source.oracle_credits,
        extra_benefit: source.extra_benefit,
        is_recommended: false,
        is_active: source.is_active,
        sort_order: Number(source.sort_order || 0) + 1,
        updated_at: now,
      }).select("*").single();
      if (error) throw error;
      await audit(gate.admin, promotionId, "package_duplicated", actor, data, actorName);
      return NextResponse.json({ ok: true, package: data, promotions: await payload(gate.admin) });
    }

    if (action === "delete_package") {
      const promotionId = String(body?.promotion_id || "");
      const packageId = String(body?.package_id || "");
      const { count, error: countError } = await gate.admin.from("cliente_payment_attempts").select("id", { count: "exact", head: true }).eq("promotion_package_id", packageId).eq("status", "completed");
      if (countError) throw countError;
      if ((count || 0) > 0) {
        const { error } = await gate.admin.from("tc_client_promotion_packages").update({ is_active: false, updated_at: now }).eq("id", packageId);
        if (error) throw error;
        await audit(gate.admin, promotionId, "package_archived", actor, { package_id: packageId, sales: count }, actorName);
        return NextResponse.json({ ok: true, archived: true, promotions: await payload(gate.admin) });
      }
      const { error } = await gate.admin.from("tc_client_promotion_packages").delete().eq("id", packageId).eq("promotion_id", promotionId);
      if (error) throw error;
      await audit(gate.admin, promotionId, "package_deleted", actor, { package_id: packageId }, actorName);
      return NextResponse.json({ ok: true, deleted: true, promotions: await payload(gate.admin) });
    }

    if (action === "archive") {
      const id = String(body?.id || "");
      const { count, error: countError } = await gate.admin.from("cliente_payment_attempts").select("id", { count: "exact", head: true }).eq("promotion_id", id).eq("status", "completed");
      if (countError) throw countError;
      if ((count || 0) === 0) {
        const { error } = await gate.admin.from("tc_client_promotions").delete().eq("id", id).in("status", ["draft", "inactive"]);
        if (error) throw error;
        return NextResponse.json({ ok: true, deleted: true, promotions: await payload(gate.admin) });
      }
      const { data, error } = await gate.admin.from("tc_client_promotions").update({ status: "archived", deactivated_at: now, updated_at: now }).eq("id", id).select("*").single();
      if (error) throw error;
      await audit(gate.admin, id, "archived", actor, data, actorName);
      return NextResponse.json({ ok: true, archived: true, promotions: await payload(gate.admin) });
    }

    return NextResponse.json({ ok: false, error: "ACCION_NO_RECONOCIDA" }, { status: 400 });
  } catch (error: any) {
    console.error("[admin/promotions:post]", error);
    return NextResponse.json({ ok: false, error: error?.message || "PROMOTION_SAVE_FAILED" }, { status: 500 });
  }
}
