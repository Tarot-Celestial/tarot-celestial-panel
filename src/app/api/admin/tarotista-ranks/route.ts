import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import { TAROTISTA_RANK_FALLBACK } from "@/lib/server/tarotista-ranks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const CODES = ["C", "B", "A", "S"] as const;

type RankCode = typeof CODES[number];

function normalizeBenefits(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || "").trim()).filter(Boolean);
}

export async function GET(req: Request) {
  try {
    const gate = await requireAdmin(req);
    if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: 403 });
    const { admin } = gate;

    const { data, error } = await admin
      .from("tarotista_rank_config")
      .select("code,name,subtitle,description,min_cliente_pct,requirement_label,benefits,sort_order")
      .order("sort_order", { ascending: true });

    if (error) throw error;

    const byCode = new Map((data || []).map((row: any) => [String(row.code || "").toUpperCase(), row]));
    const ranks = TAROTISTA_RANK_FALLBACK.map((fallback) => {
      const row: any = byCode.get(fallback.code) || {};
      return {
        ...fallback,
        ...row,
        code: fallback.code,
        min_cliente_pct: row.min_cliente_pct === null || row.min_cliente_pct === undefined ? null : Number(row.min_cliente_pct),
        benefits: normalizeBenefits(row.benefits),
      };
    }).sort((a, b) => Number(a.sort_order) - Number(b.sort_order));

    return NextResponse.json({ ok: true, ranks }, { headers: { "Cache-Control": "no-store" } });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || "ERR" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const gate = await requireAdmin(req);
    if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: 403 });
    const { admin } = gate;
    const body = await req.json();
    const code = String(body?.code || "").toUpperCase() as RankCode;
    if (!CODES.includes(code)) return NextResponse.json({ ok: false, error: "INVALID_RANK_CODE" }, { status: 400 });

    const fallback = TAROTISTA_RANK_FALLBACK.find((row) => row.code === code)!;
    const rawPct = body?.min_cliente_pct;
    const minClientePct = rawPct === "" || rawPct === null || rawPct === undefined ? null : Number(rawPct);
    if (minClientePct !== null && (!Number.isFinite(minClientePct) || minClientePct < 0 || minClientePct > 100)) {
      return NextResponse.json({ ok: false, error: "INVALID_MIN_CLIENTE_PCT" }, { status: 400 });
    }

    const payload = {
      code,
      name: String(body?.name || fallback.name).trim() || fallback.name,
      subtitle: String(body?.subtitle || fallback.subtitle).trim() || fallback.subtitle,
      description: String(body?.description || fallback.description).trim() || fallback.description,
      min_cliente_pct: minClientePct,
      requirement_label: String(body?.requirement_label || fallback.requirement_label).trim() || fallback.requirement_label,
      benefits: normalizeBenefits(body?.benefits),
      sort_order: Number(body?.sort_order || fallback.sort_order),
    };

    const saved = await admin
      .from("tarotista_rank_config")
      .upsert(payload, { onConflict: "code" })
      .select("code,name,subtitle,description,min_cliente_pct,requirement_label,benefits,sort_order")
      .single();

    if (saved.error) throw saved.error;
    return NextResponse.json({ ok: true, rank: saved.data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || "ERR" }, { status: 500 });
  }
}
