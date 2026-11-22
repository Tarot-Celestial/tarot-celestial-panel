import { officeAccess, officeDatabaseError, officeError, officeJson, officeUuid } from "@/lib/server/office-access";
import { promotionIsLive } from "@/lib/server/client-promotions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const access = await officeAccess(req);
    if (!access.ok) return access.response;
    const db = access.admin;
    const promotions = await db.from("tc_client_promotions").select("id,name,status,starts_at,ends_at,active_until_disabled")
      .in("status", ["active", "scheduled"]).order("starts_at", { ascending: false });
    if (promotions.error) return officeDatabaseError(promotions.error);
    const live = promotions.data.filter(row => promotionIsLive(row));
    if (!live.length) return officeJson({ offers: [] });
    const ids = live.map(row => row.id);
    const [packages, scopes] = await Promise.all([
      db.from("tc_client_promotion_packages").select("promotion_id,name,description,currency,price,paid_minutes,free_minutes,regular_price")
        .in("promotion_id", ids).eq("is_active", true).order("sort_order"),
      db.from("office_promotion_scopes").select("promotion_id,market,currency,channel,enabled,approved_at").in("promotion_id", ids),
    ]);
    if (packages.error || scopes.error) return officeDatabaseError((packages.error || scopes.error)!);
    const verified = await Promise.all(scopes.data.map(async scope => {
      if (!scope.enabled) return { ...scope, valid: false };
      const check = await db.rpc("office_promotion_scope_live", { p_promotion_id: scope.promotion_id, p_market: scope.market,
        p_currency: scope.currency, p_channel: scope.channel });
      if (check.error) throw new Error("No se pudo verificar el alcance comercial.");
      return { ...scope, valid: check.data === true };
    }));
    return officeJson({ offers: live.map(row => ({
      id: row.id, title: row.name, starts_at: row.starts_at, ends_at: row.active_until_disabled ? null : row.ends_at, time_zone: "UTC",
      packages: packages.data.filter(pack => pack.promotion_id === row.id).map(pack => ({
        name: pack.name, description: pack.description, currency: pack.currency, price: pack.price, regular_price: pack.regular_price,
        base_minutes: pack.paid_minutes, bonus_minutes: pack.free_minutes,
      })),
      scopes: verified.filter(scope => scope.promotion_id === row.id),
    })) });
  } catch { return officeError("No se pudo consultar el catálogo autorizado.", 503); }
}

export async function POST(req: Request) {
  try {
    const access = await officeAccess(req);
    if (!access.ok) return access.response;
    const body = await req.json().catch(() => null);
    if (!officeUuid(body?.promotion_id) || !/^[a-z]{2}$/i.test(String(body.market || "")) ||
        !["EUR", "USD"].includes(body.currency) || body.channel !== "instagram" || typeof body.enabled !== "boolean")
      return officeError("Elige una oferta, su moneda y el código de dos letras del mercado.", 400);
    const result = await access.admin.rpc("office_promotion_scope_set", { p_actor: access.authUserId, p_promotion_id: body.promotion_id,
      p_market: body.market.trim().toLowerCase(), p_currency: body.currency, p_channel: body.channel, p_enabled: body.enabled });
    return result.error ? officeDatabaseError(result.error) : officeJson({ ok: true });
  } catch { return officeError("No se pudo guardar la autorización de la oferta.", 503); }
}
