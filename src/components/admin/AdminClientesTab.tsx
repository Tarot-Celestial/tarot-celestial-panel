"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";

const sb = supabaseBrowser();

type AlertItem = {
  cliente_id: string;
  nombre: string;
  apellido: string;
  telefono: string;
  pais: string;
  email: string;
  total_gastado: number;
  completed_payments_count: number;
  ultimo_pago_at: string | null;
  dias_sin_pago: number | null;
  bonus_count: number;
  vip: boolean;
};

type ApiPayload = {
  ok: boolean;
  generated_at?: string;
  summary?: {
    totalClientesConPago: number;
    bonosPendientes: number;
    clientesVip: number;
    inactivos30: number;
    inactivos60: number;
    facturacionTotal: number;
  };
  bonusAlerts?: AlertItem[];
  vipAlerts?: AlertItem[];
  inactivityAlerts?: {
    yellow: AlertItem[];
    red: AlertItem[];
  };
  error?: string;
};

async function safeJson(res: Response) {
  const txt = await res.text();
  if (!txt) return { _raw: "", _status: res.status, _ok: res.ok };
  try {
    const j = JSON.parse(txt);
    return { ...j, _raw: txt, _status: res.status, _ok: res.ok };
  } catch {
    return { _raw: txt.slice(0, 1200), _status: res.status, _ok: res.ok };
  }
}

function eur(n: any) {
  const x = Number(n) || 0;
  return x.toLocaleString("es-ES", { style: "currency", currency: "EUR" });
}

function formatDateTime(v?: string | null) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDays(days?: number | null) {
  if (days == null || !Number.isFinite(days)) return "Sin pagos";
  if (days === 0) return "Hoy";
  if (days === 1) return "1 día";
  return `${days} días`;
}

function personLabel(item: AlertItem) {
  const full = [item.nombre, item.apellido].filter(Boolean).join(" ").trim();
  return full || item.telefono || item.email || `Cliente ${item.cliente_id}`;
}

function initials(item: AlertItem) {
  const name = personLabel(item);
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((x) => x[0]?.toUpperCase() || "")
    .join("") || "CL";
}

function KpiCard({
  title,
  value,
  hint,
  accent,
}: {
  title: string;
  value: string;
  hint: string;
  accent: string;
}) {
  return (
    <div
      style={{
        position: "relative",
        overflow: "hidden",
        borderRadius: 20,
        border: "1px solid rgba(255,255,255,.10)",
        background:
          "linear-gradient(180deg, rgba(255,255,255,.05), rgba(255,255,255,.025))",
        boxShadow: "0 20px 50px rgba(0,0,0,.18)",
        padding: 18,
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: "auto -20px -30px auto",
          width: 110,
          height: 110,
          borderRadius: 999,
          background: accent,
          filter: "blur(28px)",
          opacity: 0.18,
          pointerEvents: "none",
        }}
      />
      <div className="tc-sub" style={{ opacity: 0.82, fontSize: 12, letterSpacing: ".04em", textTransform: "uppercase" }}>
        {title}
      </div>
      <div style={{ fontSize: 28, fontWeight: 900, marginTop: 10, lineHeight: 1.05 }}>{value}</div>
      <div className="tc-sub" style={{ marginTop: 8 }}>{hint}</div>
    </div>
  );
}

function AlertRow({
  item,
  tone,
  badge,
  title,
  description,
  cta,
}: {
  item: AlertItem;
  tone: "gold" | "yellow" | "red" | "purple";
  badge: string;
  title: string;
  description: string;
  cta: () => void;
}) {
  const palette = {
    gold: {
      border: "rgba(255,208,104,.22)",
      bg: "linear-gradient(135deg, rgba(255,208,104,.12), rgba(255,255,255,.03))",
      chip: "rgba(255,208,104,.16)",
      glow: "rgba(255,208,104,.25)",
    },
    yellow: {
      border: "rgba(246,208,74,.22)",
      bg: "linear-gradient(135deg, rgba(246,208,74,.12), rgba(255,255,255,.03))",
      chip: "rgba(246,208,74,.16)",
      glow: "rgba(246,208,74,.22)",
    },
    red: {
      border: "rgba(255,98,98,.24)",
      bg: "linear-gradient(135deg, rgba(255,98,98,.14), rgba(255,255,255,.03))",
      chip: "rgba(255,98,98,.16)",
      glow: "rgba(255,98,98,.22)",
    },
    purple: {
      border: "rgba(181,156,255,.24)",
      bg: "linear-gradient(135deg, rgba(181,156,255,.14), rgba(255,255,255,.03))",
      chip: "rgba(181,156,255,.16)",
      glow: "rgba(181,156,255,.22)",
    },
  }[tone];

  return (
    <div
      style={{
        position: "relative",
        overflow: "hidden",
        display: "grid",
        gridTemplateColumns: "auto 1fr auto",
        gap: 14,
        alignItems: "center",
        borderRadius: 18,
        border: `1px solid ${palette.border}`,
        background: palette.bg,
        padding: 14,
        boxShadow: "0 14px 30px rgba(0,0,0,.14)",
      }}
    >
      <div
        style={{
          width: 48,
          height: 48,
          borderRadius: 14,
          display: "grid",
          placeItems: "center",
          fontWeight: 900,
          letterSpacing: ".05em",
          background: "rgba(255,255,255,.06)",
          border: "1px solid rgba(255,255,255,.10)",
          boxShadow: `0 0 0 1px ${palette.glow} inset`,
        }}
      >
        {initials(item)}
      </div>

      <div style={{ minWidth: 0 }}>
        <div className="tc-row" style={{ gap: 8, flexWrap: "wrap" }}>
          <div style={{ fontWeight: 900, fontSize: 15 }}>{personLabel(item)}</div>
          <span
            className="tc-chip"
            style={{
              background: palette.chip,
              border: `1px solid ${palette.border}`,
              fontSize: 12,
              borderRadius: 999,
              padding: "6px 10px",
            }}
          >
            {badge}
          </span>
        </div>

        <div className="tc-sub" style={{ marginTop: 6 }}>{title}</div>

        <div className="tc-row tc-sub" style={{ marginTop: 8, gap: 10, flexWrap: "wrap", opacity: 0.9 }}>
          <span>Gastado: <b>{eur(item.total_gastado)}</b></span>
          <span>Último pago: <b>{formatDateTime(item.ultimo_pago_at)}</b></span>
          <span>Actividad: <b>{formatDays(item.dias_sin_pago)}</b></span>
          {item.telefono ? <span>Tel: <b>{item.telefono}</b></span> : null}
        </div>

        <div className="tc-sub" style={{ marginTop: 6, opacity: 0.88 }}>{description}</div>
      </div>

      <button className="tc-btn tc-btn-gold" onClick={cta} style={{ whiteSpace: "nowrap" }}>
        Revisar
      </button>
    </div>
  );
}

export default function AdminClientesTab({
  onReviewClient,
}: {
  onReviewClient?: (clienteId: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [data, setData] = useState<ApiPayload | null>(null);
  const [rankSummary, setRankSummary] = useState<any>(null);
  const [rankLoading, setRankLoading] = useState(false);
  const [rankMsg, setRankMsg] = useState("");
  const [lastUpdated, setLastUpdated] = useState<string>("");
  const [dismissedKeys, setDismissedKeys] = useState<string[]>([]);


  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("admin_clientes_dismissed_v1");
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        setDismissedKeys(parsed.map((x) => String(x)));
      }
    } catch {}
  }, []);

  function persistDismissed(next: string[]) {
    setDismissedKeys(next);
    try {
      window.localStorage.setItem("admin_clientes_dismissed_v1", JSON.stringify(next));
    } catch {}
  }

  function dismissKey(kind: "bonus" | "vip" | "inactive-red" | "inactive-yellow", item: AlertItem) {
    const datePart = item.ultimo_pago_at ? String(item.ultimo_pago_at) : "sin-fecha";
    const totalPart = Number(item.total_gastado || 0);
    const bonusPart = Number(item.bonus_count || 0);
    return `${kind}::${item.cliente_id}::${datePart}::${totalPart}::${bonusPart}`;
  }

  function isDismissed(key: string) {
    return dismissedKeys.includes(key);
  }

  function dismissAlert(key: string) {
    if (!key || dismissedKeys.includes(key)) return;
    persistDismissed([...dismissedKeys, key]);
  }

  async function getTokenOrLogin() {
    const { data } = await sb.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      window.location.href = "/login";
      return "";
    }
    return token;
  }

  async function loadRankSummary(silent = false) {
    try {
      if (!silent) {
        setRankLoading(true);
        setRankMsg("");
      }
      const token = await getTokenOrLogin();
      if (!token) return;
      const res = await fetch("/api/admin/client-ranks/summary", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const j = await safeJson(res);
      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status || res.status}`);
      setRankSummary(j.summary || null);
      if (!silent) setRankMsg("✅ Rangos mensuales actualizados.");
    } catch (e: any) {
      if (!silent) setRankMsg(`❌ ${e?.message || "Error cargando rangos"}`);
    } finally {
      if (!silent) setRankLoading(false);
    }
  }

  async function recalculateRanks() {
    try {
      setRankLoading(true);
      setRankMsg("");
      const token = await getTokenOrLogin();
      if (!token) return;
      const res = await fetch("/api/admin/client-ranks/recalculate", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const j = await safeJson(res);
      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status || res.status}`);
      setRankSummary({
        totalConRango: Number(j?.clientes_actualizados || 0),
        bronce: Number(j?.rangos?.bronce || 0),
        plata: Number(j?.rangos?.plata || 0),
        oro: Number(j?.rangos?.oro || 0),
      });
      setRankMsg(`✅ Rangos recalculados para ${Number(j?.clientes_actualizados || 0)} clientes.`);
    } catch (e: any) {
      setRankMsg(`❌ ${e?.message || "Error recalculando rangos"}`);
    } finally {
      setRankLoading(false);
    }
  }

  async function loadAlerts(silent = false) {
    if (loading && !silent) return;

    try {
      if (!silent) {
        setLoading(true);
        setMsg("");
      }

      const token = await getTokenOrLogin();
      if (!token) return;

      const res = await fetch("/api/admin/crm/clientes-alertas", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });

      const j = await safeJson(res);
      if (!j?._ok || !j?.ok) {
        throw new Error(j?.error || `HTTP ${j?._status || res.status}`);
      }

      setData(j);
      setLastUpdated(j.generated_at || new Date().toISOString());
      if (!silent) setMsg("✅ Vista de clientes actualizada.");
    } catch (e: any) {
      if (!silent) setMsg(`❌ ${e?.message || "Error cargando alertas"}`);
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    loadAlerts(false);
    loadRankSummary(true);
    const timer = setInterval(() => {
      loadAlerts(true);
      loadRankSummary(true);
    }, 30000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const summary = data?.summary || {
    totalClientesConPago: 0,
    bonosPendientes: 0,
    clientesVip: 0,
    inactivos30: 0,
    inactivos60: 0,
    facturacionTotal: 0,
  };

  const combinedBonusRows = useMemo(() => {
    const seen = new Set<string>();
    const rows: Array<{ item: AlertItem; variant: "bonus" | "vip" }> = [];

    for (const item of data?.bonusAlerts || []) {
      const key = `${item.cliente_id}::bonus`;
      if (!seen.has(key)) {
        seen.add(key);
        rows.push({ item, variant: "bonus" });
      }
    }

    for (const item of data?.vipAlerts || []) {
      const key = `${item.cliente_id}::vip`;
      if (!seen.has(key)) {
        seen.add(key);
        rows.push({ item, variant: "vip" });
      }
    }

    rows.sort((a, b) => {
      if (a.variant !== b.variant) return a.variant === "vip" ? -1 : 1;
      return Number(b.item.total_gastado || 0) - Number(a.item.total_gastado || 0);
    });

    return rows;
  }, [data]);


  const visibleBonusRows = useMemo(() => {
    return combinedBonusRows.filter(({ item, variant }) => {
      const kind = variant === "vip" ? "vip" : "bonus";
      return !isDismissed(dismissKey(kind, item));
    });
  }, [combinedBonusRows, dismissedKeys]);

  const visibleRedRows = useMemo(() => {
    return (data?.inactivityAlerts?.red || []).filter(
      (item) => !isDismissed(dismissKey("inactive-red", item))
    );
  }, [data, dismissedKeys]);

  const visibleYellowRows = useMemo(() => {
    return (data?.inactivityAlerts?.yellow || []).filter(
      (item) => !isDismissed(dismissKey("inactive-yellow", item))
    );
  }, [data, dismissedKeys]);

  function reviewClient(
    clienteId: string,
    keyToDismiss?: string
  ) {
    if (!clienteId) return;
    if (keyToDismiss) dismissAlert(keyToDismiss);
    onReviewClient?.(clienteId);
  }

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <div
        className="tc-card"
        style={{
          borderRadius: 24,
          border: "1px solid rgba(255,215,120,.10)",
          background: "linear-gradient(180deg, rgba(255,255,255,.05), rgba(255,255,255,.025))",
          boxShadow: "0 20px 50px rgba(0,0,0,.18)",
        }}
      >
        <div className="tc-row" style={{ justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
          <div>
            <div className="tc-title">🏅 Rangos mensuales</div>
            <div className="tc-sub" style={{ marginTop: 6 }}>Se calculan con el gasto del mes anterior y determinan los beneficios del mes actual.</div>
          </div>
          <div className="tc-row" style={{ gap: 8, flexWrap: "wrap" }}>
            <button className="tc-btn" onClick={() => loadRankSummary(false)} disabled={rankLoading}>{rankLoading ? "Cargando…" : "Actualizar"}</button>
            <button className="tc-btn tc-btn-gold" onClick={recalculateRanks} disabled={rankLoading}>{rankLoading ? "Recalculando…" : "Recalcular"}</button>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 12, marginTop: 14 }}>
          <KpiCard title="Bronce" value={String(Number(rankSummary?.bronce || 0))} hint="Clientes con alguna compra" accent="rgba(214,156,110,.28)" />
          <KpiCard title="Plata" value={String(Number(rankSummary?.plata || 0))} hint="Clientes desde 100€" accent="rgba(196,210,255,.28)" />
          <KpiCard title="Oro" value={String(Number(rankSummary?.oro || 0))} hint="Clientes desde 500€" accent="rgba(255,215,120,.28)" />
          <KpiCard title="Con rango" value={String(Number(rankSummary?.totalConRango || 0))} hint="Mes actual asignado" accent="rgba(181,156,255,.28)" />
        </div>
        {rankMsg ? <div className="tc-sub" style={{ marginTop: 10 }}>{rankMsg}</div> : null}
      </div>

      <div
        className="tc-card"
        style={{
          position: "relative",
          overflow: "hidden",
          borderRadius: 24,
          border: "1px solid rgba(255,255,255,.10)",
          background:
            "radial-gradient(circle at top right, rgba(181,156,255,.18), transparent 28%), radial-gradient(circle at top left, rgba(255,208,104,.12), transparent 24%), linear-gradient(180deg, rgba(255,255,255,.05), rgba(255,255,255,.025))",
          boxShadow: "0 28px 70px rgba(0,0,0,.20)",
        }}
      >
        <div className="tc-row" style={{ justifyContent: "space-between", gap: 14, flexWrap: "wrap", alignItems: "flex-start" }}>
          <div>
            <div className="tc-title" style={{ fontSize: 22 }}>💎 Clientes</div>
            <div className="tc-sub" style={{ marginTop: 8, maxWidth: 760 }}>
              Centro de alertas premium del CRM. Aquí tienes bonos por facturación, detección VIP e inactividad por falta de pagos completed.
            </div>
            <div className="tc-sub" style={{ marginTop: 8, opacity: 0.82 }}>
              Última actualización: <b>{lastUpdated ? formatDateTime(lastUpdated) : "—"}</b>
              {msg ? ` · ${msg}` : ""}
            </div>
          </div>

          <div className="tc-row" style={{ gap: 8, flexWrap: "wrap" }}>
            <div
              className="tc-chip"
              style={{
                padding: "8px 12px",
                borderRadius: 999,
                background: "rgba(255,255,255,.05)",
                border: "1px solid rgba(255,255,255,.10)",
              }}
            >
              {summary.totalClientesConPago} clientes con pagos
            </div>
            <button className="tc-btn tc-btn-gold" onClick={() => loadAlerts(false)} disabled={loading}>
              {loading ? "Actualizando…" : "Actualizar panel"}
            </button>
          </div>
        </div>

        <div className="tc-hr" />

        <div className="tc-grid-4" style={{ gap: 14 }}>
          <KpiCard title="Facturación completada" value={eur(summary.facturacionTotal)} hint="Suma total de pagos completed" accent="rgba(120,255,190,.55)" />
          <KpiCard title="Bonos detectados" value={String(summary.bonosPendientes)} hint="Tramos de 100 € detectados" accent="rgba(255,208,104,.55)" />
          <KpiCard title="Clientes VIP" value={String(summary.clientesVip)} hint="Con 1.000 € o más acumulados" accent="rgba(181,156,255,.60)" />
          <KpiCard title="Inactivos" value={`${summary.inactivos30 + summary.inactivos60}`} hint={`${summary.inactivos30} > 30 días · ${summary.inactivos60} > 60 días`} accent="rgba(255,98,98,.55)" />
        </div>
      </div>

      <div className="tc-grid-2" style={{ alignItems: "start", gap: 18 }}>
        <div className="tc-card" style={{ borderRadius: 22, boxShadow: "0 22px 50px rgba(0,0,0,.16)" }}>
          <div className="tc-row" style={{ justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div>
              <div className="tc-title">🎁 Bonos clientes</div>
              <div className="tc-sub" style={{ marginTop: 6 }}>
                Se muestran tramos de 100 € y avisos VIP. Cada fila lleva directo a la ficha del cliente.
              </div>
            </div>
            <div
              className="tc-chip"
              style={{
                padding: "7px 11px",
                borderRadius: 999,
                background: "rgba(255,208,104,.10)",
                border: "1px solid rgba(255,208,104,.18)",
              }}
            >
              {visibleBonusRows.length} avisos
            </div>
          </div>

          <div className="tc-hr" />

          <div style={{ display: "grid", gap: 12 }}>
            {visibleBonusRows.length === 0 ? (
              <div
                style={{
                  borderRadius: 18,
                  border: "1px dashed rgba(255,255,255,.14)",
                  background: "rgba(255,255,255,.025)",
                  padding: 18,
                }}
              >
                <div style={{ fontWeight: 800 }}>Todo al día</div>
                <div className="tc-sub" style={{ marginTop: 8 }}>
                  Ahora mismo no hay nuevos bonos ni clientes VIP por revisar.
                </div>
              </div>
            ) : (
              visibleBonusRows.map(({ item, variant }) => (
                <AlertRow
                  key={`${item.cliente_id}-${variant}`}
                  item={item}
                  tone={variant === "vip" ? "purple" : "gold"}
                  badge={variant === "vip" ? "VIP" : `${item.bonus_count} bono${item.bonus_count === 1 ? "" : "s"}`}
                  title={
                    variant === "vip"
                      ? "Cliente premium por facturación acumulada"
                      : `${item.bonus_count} tramo${item.bonus_count === 1 ? "" : "s"} de 100 € detectado${item.bonus_count === 1 ? "" : "s"}`
                  }
                  description={
                    variant === "vip"
                      ? "Ha superado los 1.000 € acumulados. Ya puedes revisarlo y adjudicarle la etiqueta VIP."
                      : `Con el gasto actual le corresponden ${item.bonus_count * 20} minuto${item.bonus_count * 20 === 1 ? "" : "s"} de regalo en total.`
                  }
                  cta={() => reviewClient(item.cliente_id, dismissKey(variant === "vip" ? "vip" : "bonus", item))}
                />
              ))
            )}
          </div>

          <div className="tc-sub" style={{ marginTop: 12, opacity: 0.78 }}>
            Nota operativa: este panel detecta automáticamente los tramos por gasto completed. Si luego quieres que un bono desaparezca tras revisarlo, habría que guardar ese control en base de datos.
          </div>
        </div>

        <div className="tc-card" style={{ borderRadius: 22, boxShadow: "0 22px 50px rgba(0,0,0,.16)" }}>
          <div className="tc-row" style={{ justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div>
              <div className="tc-title">⏳ Clientes sin actividad reciente</div>
              <div className="tc-sub" style={{ marginTop: 6 }}>
                Avisos basados en la fecha del último pago completed que tenemos guardado.
              </div>
            </div>
            <div
              className="tc-chip"
              style={{
                padding: "7px 11px",
                borderRadius: 999,
                background: "rgba(255,98,98,.10)",
                border: "1px solid rgba(255,98,98,.18)",
              }}
            >
              {visibleYellowRows.length + visibleRedRows.length} avisos
            </div>
          </div>

          <div className="tc-hr" />

          <div style={{ display: "grid", gap: 12 }}>
            {visibleRedRows.map((item) => (
              <AlertRow
                key={`${item.cliente_id}-red`}
                item={item}
                tone="red"
                badge="Riesgo alto"
                title="Ojo, posible cliente perdido"
                description={`Lleva ${formatDays(item.dias_sin_pago)} sin registrar pago. Conviene revisar ficha, notas y seguimiento.`}
                cta={() => reviewClient(item.cliente_id, dismissKey("inactive-red", item))}
              />
            ))}

            {visibleYellowRows.map((item) => (
              <AlertRow
                key={`${item.cliente_id}-yellow`}
                item={item}
                tone="yellow"
                badge="Seguimiento"
                title="Cliente con más de un mes sin pagar"
                description={`Lleva ${formatDays(item.dias_sin_pago)} sin actividad económica registrada. Buen momento para revisar y contactar.`}
                cta={() => reviewClient(item.cliente_id, dismissKey("inactive-yellow", item))}
              />
            ))}

            {visibleRedRows.length === 0 && visibleYellowRows.length === 0 ? (
              <div
                style={{
                  borderRadius: 18,
                  border: "1px dashed rgba(255,255,255,.14)",
                  background: "rgba(255,255,255,.025)",
                  padding: 18,
                }}
              >
                <div style={{ fontWeight: 800 }}>Sin clientes fríos</div>
                <div className="tc-sub" style={{ marginTop: 8 }}>
                  No hemos detectado clientes con más de 30 días sin pago completed.
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

