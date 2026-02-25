import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

async function uidFromBearer(req: Request) {
  const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anon = getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return { uid: null as string | null };

  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data } = await userClient.auth.getUser();
  return { uid: data.user?.id || null };
}

function monthKeyNow() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function bonusForPos(pos: number | null) {
  if (pos === 1) return 6;
  if (pos === 2) return 4;
  if (pos === 3) return 2;
  return 0;
}

function stableKey(x: any) {
  // desempate estable
  return String(x?.worker_id || "");
}

function top3ByMetric(rows: any[], metric: string) {
  const arr = [...(rows || [])].sort((a, b) => {
    const va = Number(a?.[metric] || 0);
    const vb = Number(b?.[metric] || 0);
    if (vb !== va) return vb - va;

    // desempate: minutos_total desc (si existe)
    const ma = Number(a?.minutes_total || 0);
    const mb = Number(b?.minutes_total || 0);
    if (mb !== ma) return mb - ma;

    // desempate final estable
    return stableKey(a).localeCompare(stableKey(b));
  });
  return arr.slice(0, 3);
}

function posInTop3(top: any[], workerId: string) {
  const i = (top || []).findIndex((x: any) => String(x.worker_id) === String(workerId));
  return i >= 0 ? i + 1 : null;
}

export async function GET(req: Request) {
  try {
    const { uid } = await uidFromBearer(req);
    if (!uid) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });

    const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
    const service = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    const admin = createClient(url, service, { auth: { persistSession: false } });

    const u = new URL(req.url);
    const month = u.searchParams.get("month") || monthKeyNow();

    const { data: me, error: em } = await admin
      .from("workers")
      .select("id, role, display_name, team")
      .eq("user_id", uid)
      .maybeSingle();

    if (em) throw em;
    if (!me) return NextResponse.json({ ok: false, error: "NO_WORKER" }, { status: 403 });

    // tarotista: stats propios + bono ranking EN VIVO
    if (me.role === "tarotista") {
      const { data: s, error: es } = await admin
        .from("v_monthly_tarotist_stats")
        .select("*")
        .eq("month_key", month)
        .eq("worker_id", me.id)
        .maybeSingle();
      if (es) throw es;

      // 👇 Cogemos todos los tarotistas del mes y calculamos top3 y posición
      const { data: allRows, error: ea } = await admin
        .from("v_monthly_tarotist_stats")
        .select("worker_id, minutes_total, captadas_total, pct_cliente, pct_repite")
        .eq("month_key", month);
      if (ea) throw ea;

      const topCaptadas = top3ByMetric(allRows || [], "captadas_total");
      const topCliente = top3ByMetric(allRows || [], "pct_cliente");
      const topRepite = top3ByMetric(allRows || [], "pct_repite");

      const posCaptadas = posInTop3(topCaptadas, me.id);
      const posCliente = posInTop3(topCliente, me.id);
      const posRepite = posInTop3(topRepite, me.id);

      const brCaptadas = bonusForPos(posCaptadas);
      const brCliente = bonusForPos(posCliente);
      const brRepite = bonusForPos(posRepite);

      const bonusRanking = brCaptadas + brCliente + brRepite;

      const baseStats =
        s ||
        ({
          month_key: month,
          minutes_total: 0,
          calls_total: 0,
          captadas_total: 0,
          calls_free: 0,
          calls_rueda: 0,
          calls_cliente: 0,
          calls_repite: 0,
          pay_minutes: 0,
          pct_cliente: 0,
          pct_repite: 0,
          bonus_captadas: 0,
        } as any);

      // devolvemos bonus_ranking “en vivo” aunque el view SQL no lo tenga
      const statsOut = {
        ...baseStats,
        bonus_ranking: bonusRanking,
        bonus_ranking_breakdown: {
          captadas: brCaptadas,
          cliente: brCliente,
          repite: brRepite,
        },
        rank_positions: {
          captadas: posCaptadas,
          cliente: posCliente,
          repite: posRepite,
        },
      };

      return NextResponse.json({
        ok: true,
        scope: "self",
        month,
        worker: { id: me.id, display_name: me.display_name, team: me.team },
        stats: statsOut,
      });
    }

    // central/admin: totales globales
    const { data: rows, error: eg } = await admin
      .from("v_monthly_tarotist_stats")
      .select("minutes_total,calls_total,captadas_total,pay_minutes,bonus_captadas")
      .eq("month_key", month);

    if (eg) throw eg;

    const total = (rows || []).reduce(
      (acc: any, r: any) => {
        acc.minutes_total += Number(r.minutes_total || 0);
        acc.calls_total += Number(r.calls_total || 0);
        acc.captadas_total += Number(r.captadas_total || 0);
        acc.pay_minutes += Number(r.pay_minutes || 0);
        acc.bonus_captadas += Number(r.bonus_captadas || 0);
        return acc;
      },
      { minutes_total: 0, calls_total: 0, captadas_total: 0, pay_minutes: 0, bonus_captadas: 0 }
    );

    return NextResponse.json({
      ok: true,
      scope: "global",
      month,
      totals: total,
      rows_count: rows?.length || 0,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}
