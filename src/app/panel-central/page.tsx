"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import AppHeader from "@/components/AppHeader";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

type TabKey = "equipo" | "incidencias" | "ranking";

function monthKeyNow() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function eur(n: any) {
  const x = Number(n) || 0;
  return x.toLocaleString("es-ES", { style: "currency", currency: "EUR" });
}

function pctAny(v: any) {
  let x = Number(v) || 0;
  // si viene como 0..1 lo pasamos a 0..100
  if (x > 0 && x <= 1) x = x * 100;
  return x;
}

async function safeJson(res: Response) {
  const txt = await res.text();
  if (!txt) return { _raw: "", _status: res.status, _ok: res.ok };
  try {
    const j = JSON.parse(txt);
    return { ...j, _raw: txt, _status: res.status, _ok: res.ok };
  } catch {
    return { _raw: txt.slice(0, 800), _status: res.status, _ok: res.ok };
  }
}

export default function Central() {
  const [ok, setOk] = useState(false);
  const [tab, setTab] = useState<TabKey>("equipo");
  const [month, setMonth] = useState(monthKeyNow());

  const [rank, setRank] = useState<any>(null);
  const [rankMsg, setRankMsg] = useState("");

  const [tarotists, setTarotists] = useState<any[]>([]);
  const [tarotistsLoading, setTarotistsLoading] = useState(false);
  const [tarotistsMsg, setTarotistsMsg] = useState("");

  const [incWorkerId, setIncWorkerId] = useState("");
  const [incAmount, setIncAmount] = useState("5");
  const [incReason, setIncReason] = useState("No contesta llamada");
  const [incMsg, setIncMsg] = useState("");
  const [incLoading, setIncLoading] = useState(false);

  const [q, setQ] = useState(""); // buscador incidencias

  useEffect(() => {
    (async () => {
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return (window.location.href = "/login");

      const me = await fetch("/api/me", { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
      if (!me?.ok) return (window.location.href = "/login");

      if (me.role !== "central") {
        window.location.href = me.role === "admin" ? "/admin" : "/panel-tarotista";
        return;
      }

      setOk(true);
    })();
  }, []);

  async function refreshRanking() {
    setRankMsg("");
    try {
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return;

      const rnkRes = await fetch(`/api/rankings/monthly?month=${encodeURIComponent(month)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const rnk = await safeJson(rnkRes);

      if (!rnk?._ok || rnk?.ok === false) {
        setRank(null);
        setRankMsg(`⚠️ Error cargando ranking: ${rnk?.error || `HTTP ${rnk?._status}`}`);
        return;
      }

      setRank(rnk);
    } catch (e: any) {
      setRankMsg(`❌ ${e?.message || "Error"}`);
    }
  }

  async function loadTarotists() {
    setTarotistsLoading(true);
    setTarotistsMsg("");
    try {
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return;

      const res = await fetch("/api/central/tarotists", { headers: { Authorization: `Bearer ${token}` } });
      const j = await safeJson(res);

      if (!j?._ok || !j?.ok) {
        setTarotists([]);
        setTarotistsMsg(`❌ No se pudieron cargar tarotistas: ${j?.error || `HTTP ${j?._status}`}`);
        return;
      }

      const list = j.tarotists || [];
      setTarotists(list);
      setTarotistsMsg(list.length ? `✅ Cargadas ${list.length} tarotistas` : "⚠️ No hay tarotistas (¿workers.role='tarotista'?)");

      if (!incWorkerId && list.length) setIncWorkerId(list[0].id);
    } catch (e: any) {
      setTarotists([]);
      setTarotistsMsg(`❌ ${e?.message || "Error"}`);
    } finally {
      setTarotistsLoading(false);
    }
  }

  useEffect(() => {
    if (!ok) return;
    refreshRanking();
    loadTarotists();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ok]);

  useEffect(() => {
    if (!ok) return;
    refreshRanking();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  // ✅ cuando entras a incidencias, recarga lista (evita “no carga nada” por un fallo anterior)
  useEffect(() => {
    if (!ok) return;
    if (tab === "incidencias") loadTarotists();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const team = rank?.teams || {};
  const fuego = team?.fuego || {};
  const agua = team?.agua || {};
  const winner = team?.winner || "—";

  const fuegoScore = Number(fuego?.score || 0);
  const aguaScore = Number(agua?.score || 0);

  const maxScore = Math.max(fuegoScore, aguaScore, 1);
  const fuegoPct = Math.round((fuegoScore / maxScore) * 100);
  const aguaPct = Math.round((aguaScore / maxScore) * 100);

  const topCaptadas = rank?.top?.captadas || [];
  const topCliente = rank?.top?.cliente || [];
  const topRepite = rank?.top?.repite || [];

  const tarotistsFiltered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return tarotists;
    return (tarotists || []).filter((t) => String(t.display_name || "").toLowerCase().includes(qq));
  }, [tarotists, q]);

  const selectedTarotist = useMemo(
    () => tarotists.find((t) => t.id === incWorkerId),
    [tarotists, incWorkerId]
  );

  async function crearIncidencia() {
    if (incLoading) return;
    setIncLoading(true);
    setIncMsg("");
    try {
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return (window.location.href = "/login");

      const res = await fetch("/api/central/incidents", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          worker_id: incWorkerId,
          amount: Number(String(incAmount).replace(",", ".")),
          reason: incReason,
          month_key: month,
        }),
      });

      const j = await safeJson(res);
      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status}`);

      setIncMsg("✅ Incidencia creada. (Para reflejarlo en factura: generar facturas del mes.)");
    } catch (e: any) {
      setIncMsg(`❌ ${e?.message || "Error"}`);
    } finally {
      setIncLoading(false);
    }
  }

  if (!ok) return <div style={{ padding: 40 }}>Cargando…</div>;

  return (
    <>
      <AppHeader />

      <div className="tc-wrap">
        <div className="tc-container">
          <div className="tc-card">
            <div className="tc-row" style={{ justifyContent: "space-between" }}>
              <div>
                <div className="tc-title" style={{ fontSize: 18 }}>🎧 Panel Central</div>
                <div className="tc-sub">Competición · Incidencias · Ranking</div>
              </div>

              <div className="tc-row" style={{ flexWrap: "wrap" }}>
                <span className="tc-chip">Mes</span>
                <input
                  className="tc-input"
                  value={month}
                  onChange={(e) => setMonth(e.target.value)}
                  placeholder="2026-02"
                  style={{ width: 120 }}
                />
                <button className="tc-btn tc-btn-gold" onClick={refreshRanking}>Actualizar</button>
              </div>
            </div>

            <div style={{ marginTop: 12 }} className="tc-tabs">
              <button className={`tc-tab ${tab === "equipo" ? "tc-tab-active" : ""}`} onClick={() => setTab("equipo")}>
                🔥💧 Equipo
              </button>
              <button className={`tc-tab ${tab === "incidencias" ? "tc-tab-active" : ""}`} onClick={() => setTab("incidencias")}>
                ⚠️ Incidencias
              </button>
              <button className={`tc-tab ${tab === "ranking" ? "tc-tab-active" : ""}`} onClick={() => setTab("ranking")}>
                🏆 Ranking
              </button>
            </div>
          </div>

          {tab === "equipo" && (
            <div className="tc-card">
              <div className="tc-title">🔥💧 Competición por equipos</div>
              <div className="tc-sub" style={{ marginTop: 6 }}>
                Ganador: <b>{winner}</b> · Bono central ganadora: <b>{eur(40)}</b>
                {rankMsg ? ` · ${rankMsg}` : ""}
              </div>

              <div className="tc-hr" />

              <div className="tc-grid-2">
                <TeamBar
                  title="🔥 Fuego (Yami)"
                  score={fuegoScore}
                  pct={fuegoPct}
                  aCliente={pctAny(fuego?.avg_cliente ?? 0)}
                  aRepite={pctAny(fuego?.avg_repite ?? 0)}
                  isWinner={winner === "fuego"}
                />
                <TeamBar
                  title="💧 Agua (Maria)"
                  score={aguaScore}
                  pct={aguaPct}
                  aCliente={pctAny(agua?.avg_cliente ?? 0)}
                  aRepite={pctAny(agua?.avg_repite ?? 0)}
                  isWinner={winner === "agua"}
                />
              </div>

              <div className="tc-hr" />

              <div className="tc-sub">
                Siguiente: “Mejoras de equipo” automático (consejos según %cliente y %repite).
              </div>
            </div>
          )}

          {tab === "incidencias" && (
            <div className="tc-card">
              <div className="tc-row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <div>
                  <div className="tc-title">⚠️ Incidencias</div>
                  <div className="tc-sub" style={{ marginTop: 6 }}>
                    Descuenta en la factura del mes seleccionado.
                  </div>
                </div>

                <div className="tc-row" style={{ flexWrap: "wrap" }}>
                  <button className="tc-btn tc-btn-gold" onClick={loadTarotists} disabled={tarotistsLoading}>
                    {tarotistsLoading ? "Cargando…" : "Recargar tarotistas"}
                  </button>
                </div>
              </div>

              <div className="tc-sub" style={{ marginTop: 10 }}>
                {tarotistsMsg || " "}
                {incMsg ? ` · ${incMsg}` : ""}
              </div>

              <div className="tc-hr" />

              <div className="tc-row" style={{ flexWrap: "wrap", gap: 10, alignItems: "center" }}>
                <input
                  className="tc-input"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Buscar tarotista…"
                  style={{ width: 260, maxWidth: "100%" }}
                />

                <select
                  className="tc-select"
                  value={incWorkerId}
                  onChange={(e) => setIncWorkerId(e.target.value)}
                  style={{ minWidth: 320, width: 360, maxWidth: "100%" }}
                >
                  {(tarotistsFiltered || []).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.display_name} {t.team_key ? `(${t.team_key})` : ""}
                    </option>
                  ))}
                  {(!tarotistsFiltered || tarotistsFiltered.length === 0) && (
                    <option value="">(Sin resultados)</option>
                  )}
                </select>

                <input
                  className="tc-input"
                  value={incAmount}
                  onChange={(e) => setIncAmount(e.target.value)}
                  style={{ width: 140 }}
                  placeholder="Importe"
                />

                <input
                  className="tc-input"
                  value={incReason}
                  onChange={(e) => setIncReason(e.target.value)}
                  style={{ width: 360, maxWidth: "100%" }}
                  placeholder="Motivo"
                />

                <button className="tc-btn tc-btn-danger" onClick={crearIncidencia} disabled={incLoading || !incWorkerId}>
                  {incLoading ? "Guardando…" : "Guardar incidencia"}
                </button>
              </div>

              <div className="tc-hr" />

              <div className="tc-sub">
                Seleccionada: <b>{selectedTarotist?.display_name || "—"}</b>{" "}
                {selectedTarotist?.team_key ? (
                  <>
                    · Equipo <b>{selectedTarotist.team_key}</b>
                  </>
                ) : null}
              </div>

              <div className="tc-sub" style={{ marginTop: 8 }}>
                Nota: para que se refleje en facturas, en Admin vuelves a generar facturas del mes.
              </div>
            </div>
          )}

          {tab === "ranking" && (
            <div className="tc-card">
              <div className="tc-title">🏆 Top 3 del mes</div>
              <div className="tc-sub" style={{ marginTop: 6 }}>
                Captadas / %Cliente / %Repite {rankMsg ? `· ${rankMsg}` : ""}
              </div>

              <div className="tc-hr" />

              <div className="tc-grid-3">
                <TopCard
                  title="Captadas"
                  items={topCaptadas.map((x: any) => `${x.display_name} (${Number(x.captadas_total || 0)})`)}
                />
                <TopCard
                  title="Cliente"
                  items={topCliente.map((x: any) => `${x.display_name} (${pctAny(x.pct_cliente).toFixed(2)}%)`)}
                />
                <TopCard
                  title="Repite"
                  items={topRepite.map((x: any) => `${x.display_name} (${pctAny(x.pct_repite).toFixed(2)}%)`)}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function TeamBar({
  title,
  score,
  pct,
  aCliente,
  aRepite,
  isWinner,
}: {
  title: string;
  score: number;
  pct: number;
  aCliente: number;
  aRepite: number;
  isWinner: boolean;
}) {
  return (
    <div className="tc-card" style={{ boxShadow: "none", padding: 14 }}>
      <div className="tc-row" style={{ justifyContent: "space-between" }}>
        <div className="tc-title" style={{ fontSize: 14 }}>
          {title} {isWinner ? "👑" : ""}
        </div>
        <div style={{ fontWeight: 900 }}>{Number(score || 0).toFixed(2)}</div>
      </div>

      <div style={{ marginTop: 10, height: 12, borderRadius: 999, background: "rgba(255,255,255,0.10)", overflow: "hidden" }}>
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background: isWinner
              ? "linear-gradient(90deg, rgba(120,255,190,0.85), rgba(215,181,109,0.95))"
              : "linear-gradient(90deg, rgba(181,156,255,0.85), rgba(215,181,109,0.65))",
          }}
        />
      </div>

      <div className="tc-sub" style={{ marginTop: 10 }}>
        Media %Cliente: <b>{Number(aCliente || 0).toFixed(2)}%</b> · Media %Repite: <b>{Number(aRepite || 0).toFixed(2)}%</b>
      </div>
    </div>
  );
}

function TopCard({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="tc-card" style={{ boxShadow: "none", padding: 14 }}>
      <div className="tc-title" style={{ fontSize: 14 }}>🏆 {title}</div>
      <div className="tc-hr" />
      <div style={{ display: "grid", gap: 8 }}>
        {(items || []).slice(0, 3).map((t, i) => (
          <div key={i} className="tc-row" style={{ justifyContent: "space-between" }}>
            <span>{i === 0 ? "🥇" : i === 1 ? "🥈" : "🥉"} {t}</span>
          </div>
        ))}
        {(!items || items.length === 0) && <div className="tc-sub">Sin datos</div>}
      </div>
    </div>
  );
}
