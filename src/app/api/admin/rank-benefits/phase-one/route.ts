import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import { validateRankBenefitEdit } from "@/lib/rank-benefit-config";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });
function failure(error: any) {
  const message = String(error?.message || "No se pudo guardar la configuración.");
  return reply({ ok: false, error: message.includes("CONFIG_CONFLICT")
    ? "Otra sesión modificó este rango. Actualiza y revisa los cambios antes de guardar." : message }, message.includes("CONFIG_CONFLICT") ? 409 : 500);
}
export async function GET(req: Request) {
  try {
    const gate = await requireAdmin(req);
    if (!gate.ok) return reply({ ok: false, error: gate.error }, 403);
    const { data, error } = await gate.admin.from("tc_client_rank_benefits")
      .select("rank_key,label,sort_order,purchase_coins,ritual_access,revision").order("sort_order");
    if (error) throw error;
    return reply({ ok: true, ranks: data });
  } catch (error) { return failure(error); }
}
export async function POST(req: Request) {
  try {
    const gate = await requireAdmin(req);
    if (!gate.ok) return reply({ ok: false, error: gate.error }, 403);
    let edit;
    try { edit = validateRankBenefitEdit(await req.json()); }
    catch (error: any) { return reply({ ok: false, error: error.message }, 400); }
    const { data, error } = await gate.admin.rpc("tc_save_rank_phase_one", { p_edit: edit });
    if (error) throw error;
    if (!data?.rank_key) throw new Error("Supabase no confirmó el guardado.");
    return reply({ ok: true, saved: data });
  } catch (error) { return failure(error); }
}
