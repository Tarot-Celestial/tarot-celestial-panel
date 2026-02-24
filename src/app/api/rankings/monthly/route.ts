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

export async function GET(req: Request) {
  try {
    const { uid } = await uidFromBearer(req);
    if (!uid) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });

    const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
    const service = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    const admin = createClient(url, service, { auth: { persistSession: false } });

    const u = new URL(req.url);
    const month = u.searchParams.get("month") || monthKeyNow();

    // rol (solo para asegurar que existe)
    const { data: me, error: em } = await admin
      .from("workers")
      .select("id, role")
      .eq("user_id", uid)
      .maybeSingle();
    if (em) throw em;
    if (!me) return NextResponse.json({ ok: false, error: "NO_WORKER" }, { status: 403 });

    const { data: r, error: er } = await admin
      .from("v_monthly_rankings")
      .select("worker_id,display_name,team,minutes_total,captadas_total,pct_cliente,pct_repite,rank_captadas,rank_cliente,rank_repite")
      .eq("month_key", month);

    if (er) throw er;

    const rows = (r || []).map((x: any) => ({
      ...x,
      minutes_total: Number(x.minutes_total || 0),
      captadas_total: Number(x.captadas_total || 0),
      pct_cliente: Number(x.pct_cliente || 0),
      pct_repite: Number(x.pct_repite || 0),
    }));

    // top3 por categorías (por rank 1..3)
    function topByRank(key: "rank_captadas" | "rank_cliente" | "rank_repite") {
      return rows
        .filter((x: any) => Number(x[key]) <= 3)
        .sort((a: any, b: any) => Number(a[key]) - Number(b[key]))
        .slice(0, 3);
    }

    const topCaptadas = topByRank("rank_captadas");
    const topCliente = topByRank("rank_cliente");
    const topRepite = topByRank("rank_repite");

    // equipos (media de pct_cliente + pct_repite)
    const fuego = rows.filter((x: any) => x.team === "fuego");
    const agua = rows.filter((x: any) => x.team === "agua");

    function avgTeam(arr: any[]) {
      if (!arr.length) return { avg_cliente: 0, avg_repite: 0, score: 0 };
      const avg_cliente = arr.reduce((a, x) => a + Number(x.pct_cliente || 0), 0) / arr.length;
      const avg_repite = arr.reduce((a, x) => a + Number(x.pct_repite || 0), 0) / arr.length;
      const score = (avg_cliente + avg_repite) / 2;
      return {
        avg_cliente: Math.round(avg_cliente * 100) / 100,
        avg_repite: Math.round(avg_repite * 100) / 100,
        score: Math.round(score * 100) / 100,
      };
    }

    const fuegoAvg = avgTeam(fuego);
    const aguaAvg = avgTeam(agua);
    const winner = fuegoAvg.score === aguaAvg.score ? "empate" : fuegoAvg.score > aguaAvg.score ? "fuego" : "agua";

    return NextResponse.json({
      ok: true,
      month,
      top: { captadas: topCaptadas, cliente: topCliente, repite: topRepite },
      teams: { fuego: fuegoAvg, agua: aguaAvg, winner },
      rows_count: rows.length,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}
