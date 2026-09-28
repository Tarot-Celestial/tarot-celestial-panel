import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import {
  TAROTISTA_RANK_FALLBACK,
  rankBenefitsToLabels,
  type TarotistaRankBenefitConfig,
  type TarotistaRankRequirements,
} from "@/lib/server/tarotista-ranks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const CODES = ["C", "B", "A", "S"] as const;
type RankCode = typeof CODES[number];

function nullablePositive(value: unknown, max?: number) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return max == null ? n : Math.min(max, n);
}

function money(value: unknown) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

function strings(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || "").trim()).filter(Boolean);
}

function normalizeRequirements(value: any, legacyPct: unknown): TarotistaRankRequirements {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    min_minutes_total: nullablePositive(source.min_minutes_total),
    min_minutes_cliente: nullablePositive(source.min_minutes_cliente),
    min_minutes_repite: nullablePositive(source.min_minutes_repite),
    min_cliente_pct: source.min_cliente_pct === undefined ? nullablePositive(legacyPct, 100) : nullablePositive(source.min_cliente_pct, 100),
    min_repite_pct: nullablePositive(source.min_repite_pct, 100),
    min_captadas: nullablePositive(source.min_captadas),
  };
}

function normalizeBenefitConfig(value: any, legacy: unknown): TarotistaRankBenefitConfig {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    cliente_rate_bonus: money(source.cliente_rate_bonus),
    repite_rate_bonus: money(source.repite_rate_bonus),
    health_bonus: money(source.health_bonus),
    rank_bonus: money(source.rank_bonus),
    extras: strings(source.extras).length ? strings(source.extras) : strings(legacy),
  };
}

async function selectRanks(admin: any) {
  const modern = await admin
    .from("tarotista_rank_config")
    .select("code,name,subtitle,description,min_cliente_pct,requirement_label,benefits,requirements,benefit_config,professional_mode,admin_notes,sort_order")
    .order("sort_order", { ascending: true });
  if (!modern.error) return modern;
  if (!["42703", "PGRST204"].includes(String(modern.error?.code || ""))) return modern;
  return admin
    .from("tarotista_rank_config")
    .select("code,name,subtitle,description,min_cliente_pct,requirement_label,benefits,sort_order")
    .order("sort_order", { ascending: true });
}

function normalizeRow(row: any, fallback: any) {
  const requirements = normalizeRequirements(row?.requirements, row?.min_cliente_pct ?? fallback.min_cliente_pct);
  const benefit_config = normalizeBenefitConfig(row?.benefit_config, row?.benefits ?? fallback.benefits);
  return {
    ...fallback,
    ...row,
    code: fallback.code,
    min_cliente_pct: requirements.min_cliente_pct,
    requirements,
    benefit_config,
    benefits: rankBenefitsToLabels(benefit_config),
    professional_mode: row?.professional_mode === undefined || row?.professional_mode === null ? true : Boolean(row.professional_mode),
    admin_notes: String(row?.admin_notes || ""),
  };
}

export async function GET(req: Request) {
  try {
    const gate = await requireAdmin(req);
    if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: 403 });
    const { admin } = gate;
    const { data, error } = await selectRanks(admin);
    if (error) throw error;

    const byCode = new Map((data || []).map((row: any) => [String(row.code || "").toUpperCase(), row]));
    const ranks = TAROTISTA_RANK_FALLBACK.map((fallback) => normalizeRow(byCode.get(fallback.code) || {}, fallback))
      .sort((a, b) => Number(a.sort_order) - Number(b.sort_order));

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
    const requirements = normalizeRequirements(body?.requirements, body?.min_cliente_pct);
    const benefit_config = normalizeBenefitConfig(body?.benefit_config, body?.benefits);
    const payload = {
      code,
      name: String(body?.name || fallback.name).trim() || fallback.name,
      subtitle: String(body?.subtitle || fallback.subtitle).trim() || fallback.subtitle,
      description: String(body?.description || fallback.description).trim() || fallback.description,
      min_cliente_pct: requirements.min_cliente_pct,
      requirement_label: String(body?.requirement_label || fallback.requirement_label).trim() || fallback.requirement_label,
      benefits: rankBenefitsToLabels(benefit_config),
      requirements,
      benefit_config,
      professional_mode: body?.professional_mode === undefined ? true : Boolean(body.professional_mode),
      admin_notes: String(body?.admin_notes || "").trim(),
      sort_order: Math.max(1, Math.min(4, Number(body?.sort_order || fallback.sort_order))),
    };

    const saved = await admin
      .from("tarotista_rank_config")
      .upsert(payload, { onConflict: "code" })
      .select("code,name,subtitle,description,min_cliente_pct,requirement_label,benefits,requirements,benefit_config,professional_mode,admin_notes,sort_order")
      .single();

    if (saved.error) {
      if (["42703", "PGRST204"].includes(String(saved.error.code || ""))) {
        return NextResponse.json({
          ok: false,
          error: "Falta ejecutar SQL_TAROTISTA_RANGOS_PRO.sql en Supabase antes de guardar la configuración profesional.",
        }, { status: 409 });
      }
      throw saved.error;
    }
    return NextResponse.json({ ok: true, rank: saved.data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || "ERR" }, { status: 500 });
  }
}
