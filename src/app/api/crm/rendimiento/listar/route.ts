import { NextResponse } from "next/server";
import { getAdminClient, normalizeText, workerFromRequest } from "@/lib/server/auth-worker";
import { brandFromRequest, filterRowsByBrand } from "@/lib/server/brand-filter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const SELECT_FIELDS = "id,fecha_hora,fecha,cliente_nombre,telefonista_worker_id,telefonista_nombre,tarotista_worker_id,tarotista_nombre,tarotista_manual_call,llamada_call,tiempo,resumen_codigo,codigo_1,codigo_2,forma_pago,importe,promo,captado,recuperado,tipo_registro,cliente_id";

function addDays(date: string, days: number) { const value = new Date(`${date}T00:00:00.000Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10); }
function cleanDate(value: string | null) { const raw = String(value || "").trim(); return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : ""; }
function cleanBoolean(value: string | null) { return value === "true" ? true : value === "false" ? false : null; }
function safeLike(value: string) { return value.replace(/[%_,()]/g, " ").trim(); }
function money(value: unknown) { return Math.round((Number(value) || 0) * 100) / 100; }

export async function GET(req: Request) {
  try {
    const me = await workerFromRequest(req);
    if (!me) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    const role = String(me.role || "");
    if (!["admin", "central"].includes(role)) return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });

    const url = new URL(req.url);
    const from = cleanDate(url.searchParams.get("from"));
    const to = cleanDate(url.searchParams.get("to"));
    const tarotista = safeLike(String(url.searchParams.get("tarotista") || ""));
    const telefonista = safeLike(String(url.searchParams.get("telefonista") || ""));
    const codigo = normalizeText(url.searchParams.get("codigo"));
    const cliente = safeLike(String(url.searchParams.get("cliente") || ""));
    const metodo = normalizeText(url.searchParams.get("metodo"));
    const captado = cleanBoolean(url.searchParams.get("captado"));
    const promo = cleanBoolean(url.searchParams.get("promo"));
    const call = cleanBoolean(url.searchParams.get("call"));
    const importe = String(url.searchParams.get("importe") || "all");
    const page = Math.max(1, Number(url.searchParams.get("page") || 1) || 1);
    const pageSize = Math.min(100, Math.max(20, Number(url.searchParams.get("page_size") || 50) || 50));
    const brand = brandFromRequest(req);
    const admin = getAdminClient();
    const allRows: any[] = [];

    for (let offset = 0; offset < 50000; offset += 1000) {
      let query = admin.from("rendimiento_llamadas").select(SELECT_FIELDS).order("fecha_hora", { ascending: false });
      if (from) query = query.gte("fecha_hora", `${from}T00:00:00.000Z`);
      if (to) query = query.lt("fecha_hora", `${addDays(to, 1)}T00:00:00.000Z`);
      if (tarotista) query = query.or(`tarotista_nombre.ilike.%${tarotista}%,tarotista_manual_call.ilike.%${tarotista}%`);
      if (telefonista) query = query.ilike("telefonista_nombre", `%${telefonista}%`);
      if (cliente) query = query.ilike("cliente_nombre", `%${cliente}%`);
      if (captado !== null) query = query.eq("captado", captado);
      if (promo !== null) query = query.eq("promo", promo);
      if (call !== null) query = query.eq("llamada_call", call);
      if (importe === "positive") query = query.gt("importe", 0);
      if (importe === "zero") query = query.or("importe.is.null,importe.eq.0");
      const { data, error } = await query.range(offset, offset + 999);
      if (error) throw error;
      const chunk = data || [];
      allRows.push(...chunk);
      if (chunk.length < 1000) break;
    }

    const brandRows = await filterRowsByBrand(admin, allRows, brand);
    const methodOptions = Array.from(new Map(brandRows.map((row: any) => String(row.forma_pago || "").trim()).filter(Boolean).map((label) => [normalizeText(label), label])).entries())
      .map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, "es"));
    const filtered = brandRows.filter((row: any) => {
      const codeText = normalizeText([row.resumen_codigo, row.codigo_1, row.codigo_2, row.tipo_registro].filter(Boolean).join(" "));
      return (!codigo || codeText.includes(codigo)) && (!metodo || normalizeText(row.forma_pago) === metodo);
    });
    const totals = filtered.reduce((acc, row: any) => {
      acc.records += 1; acc.minutes += Number(row.tiempo || 0) || 0; acc.amount += Number(row.importe || 0) || 0; if (row.captado) acc.captured += 1; return acc;
    }, { records: 0, minutes: 0, amount: 0, captured: 0 });
    totals.minutes = money(totals.minutes); totals.amount = money(totals.amount);
    const start = (page - 1) * pageSize;
    const response = NextResponse.json({
      ok: true, data: filtered.slice(start, start + pageSize),
      totals: role === "admin" ? totals : { records: totals.records, captured: totals.captured },
      payment_methods: methodOptions,
      pagination: { page, page_size: pageSize, total: filtered.length, pages: Math.max(1, Math.ceil(filtered.length / pageSize)) },
      brand, viewer: { role, worker_id: me.id || null, mode: role === "central" ? "central" : "admin", read_scope: "all_centrals" },
    });
    response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    return response;
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || "RENDIMIENTO_LOAD_FAILED" }, { status: 500 });
  }
}
