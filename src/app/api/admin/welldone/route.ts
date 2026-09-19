import { NextResponse } from "next/server";
import { getAdminClient, workerFromRequest } from "@/lib/server/auth-worker";
import { buildWelldoneReport, monthRange, type WelldoneRange } from "@/lib/server/welldone";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function currentMonth() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`));
}

async function requireAdmin(req: Request) {
  const worker = await workerFromRequest(req);
  if (!worker) return { worker: null, response: NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 }) };
  if (String(worker.role || "") !== "admin") return { worker: null, response: NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 }) };
  return { worker, response: null };
}

export async function GET(req: Request) {
  try {
    const auth = await requireAdmin(req);
    if (!auth.worker) return auth.response!;
    const params = new URL(req.url).searchParams;
    const month = String(params.get("month") || currentMonth());
    let range: WelldoneRange;
    const from = String(params.get("from") || "").trim();
    const to = String(params.get("to") || "").trim();
    if (from || to) {
      if (!validDate(from) || !validDate(to) || from > to) return NextResponse.json({ ok: false, error: "INVALID_DATE_RANGE" }, { status: 400 });
      range = { start: from, end: to };
    } else {
      range = monthRange(month);
    }
    const report = await buildWelldoneReport({
      workerId: String(auth.worker.id),
      range,
      filters: {
        client: String(params.get("client") || "").slice(0, 160),
        phone: String(params.get("phone") || "").slice(0, 80),
        telefonista: String(params.get("telefonista") || "").slice(0, 160),
        method: String(params.get("method") || "").slice(0, 100),
        type: String(params.get("type") || "").slice(0, 100),
        corrected: String(params.get("corrected") || "all").slice(0, 12),
      },
      page: Number(params.get("page") || 1),
      pageSize: Number(params.get("page_size") || 25),
    });
    return NextResponse.json({ ok: true, report }, { headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" } });
  } catch (error: any) {
    const message = String(error?.message || "ERR");
    const status = message === "WELLDONE_SQL_REQUIRED" || message === "WELLDONE_TARIFF_MISSING" ? 409 : 500;
    return NextResponse.json({ ok: false, error: message }, { status, headers: { "Cache-Control": "no-store" } });
  }
}

export async function POST(req: Request) {
  try {
    const auth = await requireAdmin(req);
    if (!auth.worker) return auth.response!;
    const body = await req.json().catch(() => ({}));
    const effectiveFrom = String(body?.effective_from || "").trim();
    const rate = Number(String(body?.rate_per_minute ?? "").replace(",", "."));
    if (!validDate(effectiveFrom)) return NextResponse.json({ ok: false, error: "INVALID_EFFECTIVE_DATE" }, { status: 400 });
    if (!Number.isFinite(rate) || rate <= 0 || rate > 10) return NextResponse.json({ ok: false, error: "INVALID_RATE" }, { status: 400 });

    const admin = getAdminClient();
    const { data, error } = await admin
      .from("welldone_tariffs")
      .upsert({
        effective_from: effectiveFrom,
        rate_per_minute: rate,
        created_by_user_id: auth.worker.user_id || auth.worker.resolved_uid || null,
        updated_at: new Date().toISOString(),
      }, { onConflict: "effective_from" })
      .select("id, rate_per_minute, effective_from, created_at, updated_at")
      .single();
    if (error) throw error;
    return NextResponse.json({ ok: true, tariff: data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: String(error?.message || "ERR") }, { status: 500 });
  }
}
