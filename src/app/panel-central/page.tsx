"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import AppHeader from "@/components/AppHeader";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

type TabKey = "resumen" | "incidencias" | "checklist" | "chat" | "facturas";

function monthKeyNow() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
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

  const [tab, setTab] = useState<TabKey>("resumen");
  const [month, setMonth] = useState<string>(monthKeyNow());

  const [meName, setMeName] = useState<string>("Central");

  const [workers, setWorkers] = useState<any[]>([]);
  const tarotists = useMemo(
    () => (workers || []).filter((w) => String(w.role || "") === "tarotista"),
    [workers]
  );

  // incidencias
  const [incWorkerId, setIncWorkerId] = useState<string>("");
  const [incTitle, setIncTitle] = useState<string>("");
  const [incAmount, setIncAmount] = useState<string>("0");
  const [incLoading, setIncLoading] = useState(false);
  const [incMsg, setIncMsg] = useState<string>("");

  useEffect(() => {
    (async () => {
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return (window.location.href = "/login");

      const meRes = await fetch("/api/me", { headers: { Authorization: `Bearer ${token}` } });
      const me = await safeJson(meRes);
      if (!me?.ok) return (window.location.href = "/login");

      if (me.role !== "central") {
        window.location.href = me.role === "admin" ? "/admin" : "/panel-tarotista";
        return;
      }

      setMeName(me.display_name || "Central");

      // carga lista de trabajadores (tarotistas para incidencias)
      // aquí usamos el anon client con RLS: si no te deja, lo cambiamos por endpoint admin/central.
      const { data: ws, error } = await sb
        .from("workers")
        .select("id, display_name, role, team")
        .eq("role", "tarotista")
        .order("display_name", { ascending: true });

      if (!error) {
        setWorkers(ws || []);
        if (!incWorkerId && (ws || []).length) setIncWorkerId(ws![0].id);
      } else {
        // si RLS bloquea, dejamos mensaje
        setIncMsg("⚠️ No puedo cargar la lista de tarotistas (RLS). Si pasa, lo arreglamos con un endpoint central.");
      }

      setOk(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function getTokenOrLogin() {
    const { data } = await sb.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      window.location.href = "/login";
      return "";
    }
    return token;
  }

  async function createIncident() {
    if (incLoading) return;
    setIncLoading(true);
    setIncMsg("");

    try {
      const token = await getTokenOrLogin();
      if (!token) return;

      const title = incTitle.trim();
      if (!incWorkerId) throw new Error("Selecciona una tarotista.");
      if (!title) throw new Error("Escribe el motivo de la incidencia.");

      const amt = Number(String(incAmount).replace(",", "."));
      if (!isFinite(amt) || amt < 0) throw new Error("Importe inválido (usa 0 o positivo).");

      const r = await fetch("/api/incidents/create", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          worker_id: incWorkerId,
          month_key: month,
          title,
          amount: amt,
        }),
      });

      const j = await safeJson(r);
      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status}. ${j?._raw || "(vacía)"}`);

      setIncTitle("");
      setIncAmount("0");
      setIncMsg("✅ Incidencia creada. (Al regenerar facturas del mes, se aplicará en la factura)");
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
          {/* CABECERA DEL PANEL */}
          <div className="tc-card">
            <div className="tc-row" style={{ justifyContent: "space-between" }}>
              <div>
                <div className="tc-title" style={{ fontSize: 18 }}>
                  🧑‍💼 Central — {meName}
                </div>
                <div className="tc-sub">Competición · Incidencias · Checklist · Chat · Facturas</div>
              </div>

              <div className="tc-row">
                <span className="tc-chip">Mes</span>
                <input
                  className="tc-input"
                  value={month}
                  onChange={(e) => setMonth(e.target.value)}
                  placeholder="2026-02"
                  style={{ width: 120 }}
                />
              </div>
            </div>

            <div style={{ marginTop: 12 }} className="tc-tabs">
              <button className={`tc-tab ${tab === "resumen" ? "tc-tab-active" : ""}`} onClick={() => setTab("resumen")}>
                🏆 Resumen
              </button>
              <button
                className={`tc-tab ${tab === "incidencias" ? "tc-tab-active" : ""}`}
                onClick={() => setTab("incidencias")}
              >
                ⚠️ Incidencias
              </button>
              <button
                className={`tc-tab ${tab === "checklist" ? "tc-tab-active" : ""}`}
                onClick={() => setTab("checklist")}
              >
                ✅ Checklist
              </button>
              <button className={`tc-tab ${tab === "chat" ? "tc-tab-active" : ""}`} onClick={() => setTab("chat")}>
                💬 Chat
              </button>
              <button
                className={`tc-tab ${tab === "facturas" ? "tc-tab-active" : ""}`}
                onClick={() => setTab("facturas")}
              >
                🧾 Facturas
              </button>
            </div>
          </div>

          {/* TAB: RESUMEN */}
          {tab === "resumen" && (
            <div className="tc-card">
              <div className="tc-title">🏆 Competición por equipos</div>
              <div className="tc-sub" style={{ marginTop: 6 }}>
                Aquí mostraremos: media de % repite y % cliente por equipo (Fuego vs Agua), ganadores del mes y bonus
                (central ganador +40€). Próximo paso.
              </div>

              <div className="tc-hr" />

              <div className="tc-row">
                <div className="tc-chip">Equipo Fuego (Yami)</div>
                <div className="tc-sub">Tarotistas tarde (1pm–9pm)</div>
              </div>
              <div className="tc-row" style={{ marginTop: 8 }}>
                <div className="tc-chip">Equipo Agua (María)</div>
                <div className="tc-sub">Tarotistas noche (9pm–5am)</div>
              </div>

              <div className="tc-hr" />

              <div className="tc-sub">
                En el siguiente paso conectamos la view de stats por mes y pintamos:
                <b> % repite, % cliente, captadas, minutos</b> + top 3.
              </div>
            </div>
          )}

          {/* TAB: INCIDENCIAS */}
          {tab === "incidencias" && (
            <div className="tc-card">
              <div className="tc-row" style={{ justifyContent: "space-between" }}>
                <div>
                  <div className="tc-title">⚠️ Crear incidencia</div>
                  <div className="tc-sub">Ej: “No contesta”, “Se va la luz”, “Desconecta sin avisar”…</div>
                </div>
                <div className="tc-chip">Se aplica al mes: {month}</div>
              </div>

              <div className="tc-hr" />

              <div className="tc-grid-2">
                <div className="tc-card" style={{ boxShadow: "none", padding: 14 }}>
                  <div className="tc-sub" style={{ marginBottom: 6 }}>
                    Tarotista
                  </div>

                  <select
                    className="tc-select"
                    value={incWorkerId}
                    onChange={(e) => setIncWorkerId(e.target.value)}
                    style={{ width: "100%" }}
                  >
                    {(tarotists || []).map((w: any) => (
                      <option key={w.id} value={w.id}>
                        {w.display_name}
                      </option>
                    ))}
                    {(!tarotists || tarotists.length === 0) && (
                      <option value="">(No hay tarotistas cargadas)</option>
                    )}
                  </select>

                  <div className="tc-sub" style={{ marginTop: 12, marginBottom: 6 }}>
                    Motivo
                  </div>
                  <input
                    className="tc-input"
                    value={incTitle}
                    onChange={(e) => setIncTitle(e.target.value)}
                    placeholder="Ej: No contesta a la llamada"
                    style={{ width: "100%" }}
                  />

                  <div className="tc-sub" style={{ marginTop: 12, marginBottom: 6 }}>
                    Importe (€) que se descontará
                  </div>
                  <input
                    className="tc-input"
                    value={incAmount}
                    onChange={(e) => setIncAmount(e.target.value)}
                    placeholder="0"
                    style={{ width: 140 }}
                  />

                  <div className="tc-row" style={{ marginTop: 12 }}>
                    <button className="tc-btn tc-btn-gold" onClick={createIncident} disabled={incLoading}>
                      {incLoading ? "Guardando…" : "Crear incidencia"}
                    </button>
                    <div className="tc-sub">{incMsg || " "}</div>
                  </div>

                  <div className="tc-sub" style={{ marginTop: 12 }}>
                    Nota: la incidencia queda registrada y al generar/regenerar facturas del mes se reflejará en la factura.
                  </div>
                </div>

                <div className="tc-card" style={{ boxShadow: "none", padding: 14 }}>
                  <div className="tc-title" style={{ fontSize: 14 }}>
                    💡 Guía rápida de uso
                  </div>
                  <div className="tc-sub" style={{ marginTop: 8 }}>
                    1) Elige tarotista <br />
                    2) Escribe motivo claro <br />
                    3) Pon importe (0 si solo es registro) <br />
                    4) Crear incidencia <br />
                    5) Admin regenerará facturas del mes si hace falta
                  </div>

                  <div className="tc-hr" />

                  <div className="tc-title" style={{ fontSize: 14 }}>
                    🎯 Consejo motivacional
                  </div>
                  <div className="tc-sub" style={{ marginTop: 8 }}>
                    Las incidencias deben ser consistentes y justificadas. El objetivo es que el equipo mejore y la
                    competición sea justa.
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB: CHECKLIST */}
          {tab === "checklist" && (
            <div className="tc-card">
              <div className="tc-title">✅ Checklist de Central</div>
              <div className="tc-sub" style={{ marginTop: 6 }}>
                Próximo paso: checklist por turno (se reinicia al empezar turno) + notificación al Admin cuando se completa.
              </div>

              <div className="tc-hr" />

              <div className="tc-sub">
                Lo montamos con: <b>checklists</b> + <b>checklist_items</b> + <b>checklist_ticks</b> y una vista por turno.
              </div>
            </div>
          )}

          {/* TAB: CHAT */}
          {tab === "chat" && (
            <div className="tc-card">
              <div className="tc-title">💬 Chat con tarotistas</div>
              <div className="tc-sub" style={{ marginTop: 6 }}>
                Próximo paso: chat interno central ↔ tarotistas para enviar lista de clientes al inicio del turno.
              </div>

              <div className="tc-hr" />

              <div className="tc-sub">
                Lo haremos simple: tabla <b>messages</b> (from_worker_id, to_role/team, body, created_at) + realtime.
              </div>
            </div>
          )}

          {/* TAB: FACTURAS */}
          {tab === "facturas" && (
            <div className="tc-card">
              <div className="tc-title">🧾 Facturas (Central)</div>
              <div className="tc-sub" style={{ marginTop: 6 }}>
                Próximo paso: ver tu factura del mes (sueldo base + bonos) y el resumen por equipos.
              </div>

              <div className="tc-hr" />

              <div className="tc-sub">
                Ya tienes la generación por mes en Admin. Aquí solo mostraremos tu factura y tus bonos.
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
