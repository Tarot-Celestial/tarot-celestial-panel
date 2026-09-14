import { NextResponse } from "next/server";
import { storeAccess } from "@/lib/server/store-access";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function integer(value: unknown, min = 0, max = 2147483647) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error("Introduce un número entero válido.");
  return n;
}
export async function GET(req: Request) {
  try {
    const { admin } = await storeAccess(req, true);
    const page = Math.max(0, Number(new URL(req.url).searchParams.get("page")) || 0);
    const [rewards, claims, workers] = await Promise.all([
      admin.from("worker_store_rewards").select("*").order("display_order").order("created_at"),
      admin.from("worker_store_claims").select("*", { count: "exact" }).order("created_at", { ascending: false }).range(page * 50, page * 50 + 49),
      admin.from("workers").select("id,display_name"),
    ]);
    for (const r of [rewards, claims, workers]) if (r.error) throw r.error;
    const names = new Map((workers.data || []).map(w => [w.id, w.display_name]));
    return NextResponse.json({ ok: true, rewards: rewards.data, claims: (claims.data || []).map(c => ({ ...c, worker_name: names.get(c.worker_id) || c.worker_id })), has_more: (claims.count || 0) > (page + 1) * 50 });
  } catch (e: any) { return NextResponse.json({ ok: false, error: e.message }, { status: e.status || 500 }); }
}
export async function POST(req: Request) {
  try {
    const { admin, me } = await storeAccess(req, true);
    const b = await req.json();
    if (b.op === "save_reward") {
      const category = String(b.category || "").trim();
      const name = String(b.name || "").trim();
      if (!name || name.length > 150 || !category || category.length > 60) throw new Error("Nombre y categoría obligatorios (máximo 150 y 60 caracteres).");
      const image = String(b.image_url || "").trim();
      if (image && new URL(image).protocol !== "https:") throw new Error("La imagen debe tener una dirección HTTPS.");
      const payload = { name, category, description: String(b.description || "").trim().slice(0, 2000), coin_cost: integer(b.coin_cost, 1), image_url: image || null, featured: b.featured === true, active: b.active === true, display_order: integer(b.display_order), stock: b.stock == null || b.stock === "" ? null : integer(b.stock), required_level: b.required_level == null || b.required_level === "" ? null : integer(b.required_level, 1), updated_at: new Date().toISOString(), updated_by_worker_id: me.id };
      const q = b.id ? admin.from("worker_store_rewards").update(payload).eq("id", b.id).is("archived_at", null) : admin.from("worker_store_rewards").insert(payload);
      const saved = await q.select().single(); if (saved.error) throw saved.error;
      return NextResponse.json({ ok: true, reward: saved.data });
    }
    if (b.op === "archive_reward") {
      const saved = await admin.from("worker_store_rewards").update({ active: false, archived_at: new Date().toISOString(), updated_at: new Date().toISOString(), updated_by_worker_id: me.id }).eq("id", b.id).select().single();
      if (saved.error) throw saved.error;
      return NextResponse.json({ ok: true });
    }
    if (b.op === "set_claim_status") {
      if (!["pending", "approved", "delivered", "rejected", "cancelled"].includes(b.status)) throw new Error("Estado inválido.");
      const saved = await admin.from("worker_store_claims").update({ status: b.status, status_note: String(b.status_note || "").trim().slice(0, 2000) || null, managed_by_worker_id: me.id, updated_at: new Date().toISOString() }).eq("id", b.claim_id).select().single();
      if (saved.error) throw saved.error;
      return NextResponse.json({ ok: true, claim: saved.data });
    }
    throw new Error("Operación inválida.");
  } catch (e: any) { return NextResponse.json({ ok: false, error: e.message }, { status: e.status || 400 }); }
}
