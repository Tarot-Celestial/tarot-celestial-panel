"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { getConversionProbability } from "@/lib/conversion-engine";
import { sortByDecision, getNextBestAction } from "@/lib/decision-engine";
import { getAnalytics } from "@/lib/analytics-lite";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { useOps } from "@/hooks/useOps";
import { sortItems, type Priority } from "@/lib/priority-engine";
import { getSuggestion, type Suggestion } from "@/lib/suggestion-engine";
import { evaluateSla, type SlaStatus } from "@/lib/sla-engine";
import { getLoadSummary } from "@/lib/load-engine";
import { getOperatorControlSummary } from "@/lib/operator-score-engine";
import { revenueLabel, revenueProfile } from "@/lib/revenue-engine";

type InboxMode = "admin" | "central" | "tarotista";

type InboxAction =
  | "leads"
  | "parking"
  | "chat"
  | "calls"
  | "team"
  | "incidents"
  | "crm"
  | "attendance";

type OperationalInboxProps = {
  mode: InboxMode;
  onAction?: (action: InboxAction) => void;
  compact?: boolean;
};

export type InboxItem = {
  id: string;
  title: string;
  subtitle?: string;
  meta?: string;
  priority?: Priority;
  action?: InboxAction;
  type?: "parking" | "lead" | "chat" | "call" | "incident" | "team" | "attendance";
  rank?: string | null;
  value?: number | null;
  cliente_revenue_total?: number | null;
  cliente_revenue_30d?: number | null;
  cliente_completed_payments_count?: number | null;
  cliente_first_payment_at?: string | null;
  cliente_last_payment_at?: string | null;
  converted_first_payment?: boolean | null;
  next_contact_at?: string | null;
  created_at?: string | null;
  last_activity_at?: string | null;
  unread_count?: number | null;
  sla?: SlaStatus;
};

type InboxSection = {
  key: string;
  title: string;
  icon: string;
  count: number;
  tone: "gold" | "green" | "purple" | "red" | "blue";
  action?: InboxAction;
  empty: string;
  items: InboxItem[];
};

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function monthKeyNow() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function timeAgo(value?: string | null) {
  if (!value) return "";
  const t = new Date(value).getTime();
  if (!Number.isFinite(t)) return "";
  const diff = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (diff < 60) return `hace ${diff}s`;
  if (diff < 3600) return `hace ${Math.round(diff / 60)}m`;
  if (diff < 86400) return `hace ${Math.round(diff / 3600)}h`;
  return `hace ${Math.round(diff / 86400)}d`;
}

async function getToken() {
  const sb = supabaseBrowser();
  const { data } = await sb.auth.getSession();
  return data.session?.access_token || "";
}

async function safeJson(res: Response) {
  const txt = await res.text();
  if (!txt) return null;
  try {
    return JSON.parse(txt);
  } catch {
    return null;
  }
}

function normalizeLeadName(row: any) {
  const c = row?.cliente || {};
  return [c?.nombre, c?.apellido].filter(Boolean).join(" ").trim() || c?.telefono || row?.campaign_name || "Lead pendiente";
}

function getLeadRank(lead: any) {
  return (
    lead?.rango_actual ||
    lead?.rango ||
    lead?.rank ||
    lead?.cliente?.rango_actual ||
    lead?.cliente?.rango ||
    lead?.cliente?.rank ||
    null
  );
}

function getLeadValue(lead: any) {
  return Number(
    lead?.cliente_revenue_total ||
      lead?.cliente_revenue_30d ||
      lead?.valor_total ||
      lead?.total_spent ||
      lead?.importe_total ||
      lead?.cliente?.rango_gasto_mes_anterior ||
      lead?.cliente?.valor_total ||
      0
  );
}

function rankLabel(rank?: string | null) {
  const r = String(rank || "").toLowerCase();
  if (!r) return "";
  if (r === "oro" || r === "gold") return "Rango oro";
  if (r === "plata" || r === "silver") return "Rango plata";
  if (r === "bronce" || r === "bronze") return "Rango bronce";
  return `Rango ${rank}`;
}

function priorityBorder(priority?: InboxItem["priority"]) {
  if (priority === "critical") return "rgba(255,82,82,0.58)";
  if (priority === "high") return "rgba(255,120,120,0.34)";
  if (priority === "medium") return "rgba(215,181,109,0.34)";
  return "rgba(255,255,255,0.10)";
}

function priorityLabel(priority?: InboxItem["priority"]) {
  if (priority === "critical") return "CRÍTICO";
  if (priority === "high") return "URGENTE";
  if (priority === "medium") return "Media";
  return "Baja";
}

function priorityBadgeStyle(priority?: InboxItem["priority"]): CSSProperties {
  if (priority === "critical") {
    return {
      border: "1px solid rgba(255,82,82,0.58)",
      background: "rgba(255,82,82,0.22)",
      color: "#ffe0e0",
      boxShadow: "0 0 22px rgba(255,82,82,0.18)",
    };
  }

  if (priority === "high") {
    return {
      border: "1px solid rgba(255,120,120,0.40)",
      background: "rgba(255,120,120,0.16)",
      color: "#ffd6d6",
      boxShadow: "0 0 18px rgba(255,120,120,0.12)",
    };
  }

  if (priority === "medium") {
    return {
      border: "1px solid rgba(215,181,109,0.34)",
      background: "rgba(215,181,109,0.12)",
      color: "#f5dfaa",
    };
  }

  return {
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.06)",
    color: "rgba(255,255,255,0.72)",
  };
}

function priorityItemStyle(priority?: InboxItem["priority"]): CSSProperties {
  if (priority === "critical") {
    return {
      border: `1px solid ${priorityBorder(priority)}`,
      borderRadius: 12,
      padding: 10,
      background: "linear-gradient(135deg, rgba(255,82,82,0.18), rgba(0,0,0,0.10))",
      boxShadow: "0 0 0 1px rgba(255,82,82,0.08), 0 14px 30px rgba(255,82,82,0.14)",
    };
  }

  if (priority === "high") {
    return {
      border: `1px solid ${priorityBorder(priority)}`,
      borderRadius: 12,
      padding: 10,
      background: "linear-gradient(135deg, rgba(255,120,120,0.13), rgba(0,0,0,0.10))",
      boxShadow: "0 0 0 1px rgba(255,120,120,0.05), 0 10px 24px rgba(255,120,120,0.08)",
    };
  }

  return {
    border: `1px solid ${priorityBorder(priority)}`,
    borderRadius: 12,
    padding: 10,
    background: "rgba(0,0,0,0.10)",
  };
}

function toneStyle(tone: InboxSection["tone"]) {
  if (tone === "green") return { border: "rgba(120,255,190,0.22)", bg: "rgba(120,255,190,0.07)" };
  if (tone === "purple") return { border: "rgba(181,156,255,0.22)", bg: "rgba(181,156,255,0.07)" };
  if (tone === "red") return { border: "rgba(255,120,120,0.22)", bg: "rgba(255,120,120,0.07)" };
  if (tone === "blue") return { border: "rgba(120,190,255,0.22)", bg: "rgba(120,190,255,0.07)" };
  return { border: "rgba(215,181,109,0.24)", bg: "rgba(215,181,109,0.08)" };
}

function itemActionLabel(item: InboxItem, fallback?: InboxAction) {
  const action = item.action || fallback;
  if (action === "parking") return "Atender ahora";
  if (action === "leads") return "Abrir lead";
  if (action === "chat") return "Abrir chat";
  if (action === "calls") return "Ver llamadas";
  if (action === "team") return "Revisar equipo";
  if (action === "incidents") return "Ver aviso";
  if (action === "attendance") return "Gestionar estado";
  if (action === "crm") return "Abrir CRM";
  return "Abrir";
}

function suggestionButtonStyle(suggestion?: Suggestion | null): CSSProperties {
  if (!suggestion) return {};
  if (suggestion.severity === "critical") {
    return {
      border: "1px solid rgba(255,82,82,0.50)",
      background: "rgba(255,82,82,0.18)",
      color: "#ffe0e0",
      boxShadow: "0 0 16px rgba(255,82,82,0.14)",
    };
  }
  if (suggestion.severity === "high") {
    return {
      border: "1px solid rgba(255,120,120,0.38)",
      background: "rgba(255,120,120,0.14)",
      color: "#ffd6d6",
    };
  }
  if (suggestion.severity === "medium") {
    return {
      border: "1px solid rgba(215,181,109,0.34)",
      background: "rgba(215,181,109,0.12)",
      color: "#f5dfaa",
    };
  }
  return {
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.06)",
  };
}

function metricLabel(value: number, label: string) {
  return `${label}: ${Number(value || 0)}`;
}

const PRIORITY_RANK: Record<Priority, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

function maxPriority(a?: Priority, b?: Priority): Priority {
  const pa = a || "low";
  const pb = b || "low";
  return PRIORITY_RANK[pb] > PRIORITY_RANK[pa] ? pb : pa;
}

function withSla<T extends InboxItem>(item: T): T {
  const sla = evaluateSla(item);
  return {
    ...item,
    sla,
    priority: maxPriority(item.priority, sla.priority),
  };
}

export default function OperationalInbox({ mode, onAction, compact = false }: OperationalInboxProps) {
  const ops = useOps();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [leads, setLeads] = useState<any[]>([]);
  const [outboundItems, setOutboundItems] = useState<any[]>([]);
  const [chatItems, setChatItems] = useState<any[]>([]);
  const [incidentItems, setIncidentItems] = useState<any[]>([]);
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);

  const fireAction = useCallback(
    (action: InboxAction) => {
      if (onAction) onAction(action);

      if (action === "leads") {
        window.dispatchEvent(new CustomEvent("tc-open-captacion"));
        window.dispatchEvent(new CustomEvent("go-to-captacion"));
      }

      if (action === "parking") {
        window.dispatchEvent(new CustomEvent("tc-open-parking"));
        window.dispatchEvent(new CustomEvent("go-to-parking"));
      }

      if (action === "chat") window.dispatchEvent(new CustomEvent("tc-open-chat"));
      if (action === "crm") window.dispatchEvent(new CustomEvent("tc-open-crm-tab"));
    },
    [onAction]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const token = await getToken();
      const authHeaders = token ? { Authorization: `Bearer ${token}` } : undefined;
      const month = monthKeyNow();
      const today = todayKey();

      if (mode === "central" || mode === "admin") {
        const leadRes = await fetch(`/api/captacion/list?scope=pendientes&t=${Date.now()}`, { cache: "no-store" });
        const leadJson = await safeJson(leadRes);
        setLeads(Array.isArray(leadJson?.items) ? leadJson.items.slice(0, 8) : []);
      } else {
        setLeads([]);
      }

      if (mode === "central" && authHeaders) {
        const outRes = await fetch(`/api/central/outbound/pending?date=${encodeURIComponent(today)}&t=${Date.now()}`, {
          headers: authHeaders,
          cache: "no-store",
        });

        const outJson = await safeJson(outRes);
        const items = (outJson?.batches || []).flatMap((b: any) =>
          (b?.outbound_batch_items || []).map((it: any) => ({ ...it, _sender: b?.sender, _batch_id: b?.id }))
        );

        setOutboundItems(items.slice(0, 8));

        const chatRes = await fetch(`/api/central/chat/threads?t=${Date.now()}`, {
          headers: authHeaders,
          cache: "no-store",
        });

        const chatJson = await safeJson(chatRes);
        setChatItems(Array.isArray(chatJson?.threads || chatJson?.rows) ? (chatJson.threads || chatJson.rows).slice(0, 6) : []);
        setIncidentItems([]);
      }

      if (mode === "admin" && authHeaders) {
        const [chatRes, incRes] = await Promise.all([
          fetch(`/api/admin/chat/overview?t=${Date.now()}`, { headers: authHeaders, cache: "no-store" }),
          fetch(`/api/admin/incidents/list?month=${encodeURIComponent(month)}&t=${Date.now()}`, {
            headers: authHeaders,
            cache: "no-store",
          }),
        ]);

        const chatJson = await safeJson(chatRes);
        const incJson = await safeJson(incRes);

        setChatItems(Array.isArray(chatJson?.threads) ? chatJson.threads.slice(0, 6) : []);
        setIncidentItems(Array.isArray(incJson?.incidents) ? incJson.incidents.slice(0, 8) : []);
        setOutboundItems([]);
      }

      if (mode === "tarotista" && authHeaders) {
        const [outRes, incRes] = await Promise.all([
          fetch(`/api/me/outbound?date=${encodeURIComponent(today)}&t=${Date.now()}`, {
            headers: authHeaders,
            cache: "no-store",
          }),
          fetch(`/api/incidents/my?month=${encodeURIComponent(month)}&t=${Date.now()}`, {
            headers: authHeaders,
            cache: "no-store",
          }),
        ]);

        const outJson = await safeJson(outRes);
        const incJson = await safeJson(incRes);

        setOutboundItems(Array.isArray(outJson?.batch?.outbound_batch_items) ? outJson.batch.outbound_batch_items.slice(0, 8) : []);
        setIncidentItems(Array.isArray(incJson?.incidents) ? incJson.incidents.slice(0, 6) : []);
        setChatItems([]);
      }

      setRefreshedAt(new Date().toISOString());
    } catch (e: any) {
      setError(String(e?.message || "No se pudo cargar la bandeja"));
    } finally {
      setLoading(false);
    }
  }, [mode]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), mode === "tarotista" ? 45_000 : 30_000);
    return () => window.clearInterval(id);
  }, [load, mode]);

  const loadSummary = useMemo(() => {
    return getLoadSummary({
      presences: ops.presences.rows || [],
      expected: ops.expected.rows || [],
      outboundItems,
      chatItems,
      parkingCount: ops.counters.parking || 0,
      chatUnread: ops.counters.chatUnread || 0,
      incidentCount: incidentItems.length,
    });
  }, [chatItems, incidentItems.length, ops.counters.chatUnread, ops.counters.parking, ops.expected.rows, ops.presences.rows, outboundItems]);

  const operatorControl = useMemo(() => {
    return getOperatorControlSummary({
      presences: ops.presences.rows || [],
      expected: ops.expected.rows || [],
      outboundItems,
      chatItems,
      parkingCount: ops.counters.parking || 0,
      offlineExpected: loadSummary.offlineExpected,
    });
  }, [chatItems, loadSummary.offlineExpected, ops.counters.parking, ops.expected.rows, ops.presences.rows, outboundItems]);

  
  const analytics = getAnalytics({ leads, outboundItems, chatItems });
  

  const sections = useMemo<InboxSection[]>(() => {
    const onlineRows = (ops.presences.rows || []).filter((r) => r.online);
    const expectedRows = ops.expected.rows || [];
    const offlineExpected = loadSummary.offlineExpected;

    if (mode === "tarotista") {
      return [
        {
          key: "turno",
          title: "Mi turno",
          icon: ops.attendance.online ? "🟢" : "⚪",
          count: ops.attendance.online ? 1 : 0,
          tone: ops.attendance.online ? "green" : "purple",
          action: "attendance",
          empty: "Conéctate cuando estés dentro de tu turno.",
          items: [
            withSla({
              id: "my-status",
              title: ops.attendance.online ? "Estás online" : "Estás offline",
              subtitle: ops.attendance.status ? `Estado: ${ops.attendance.status}` : undefined,
              priority: ops.attendance.online ? "low" : "medium",
              action: "attendance",
              type: "attendance",
            }),
          ],
        },
        {
          key: "assigned-calls",
          title: "Mis llamadas",
          icon: "📞",
          count: outboundItems.length,
          tone: "gold",
          action: "calls",
          empty: "No tienes llamadas asignadas para hoy.",
          items: sortItems(
            outboundItems.map((it: any) => withSla({
              id: String(it.id),
              title: it.customer_name || it.phone || "Cliente pendiente",
              subtitle: it.phone ? `Teléfono: ${it.phone}` : "Llamada asignada",
              meta: it.current_status || "Pendiente",
              priority: it.priority === "high" ? "high" : "medium",
              action: "calls",
              type: "call",
              created_at: it.created_at,
              last_activity_at: it.last_call_at || it.updated_at,
            }))
          ),
        },
        {
          key: "my-incidents",
          title: "Mis avisos",
          icon: "⚠️",
          count: incidentItems.length,
          tone: incidentItems.length ? "red" : "green",
          action: "incidents",
          empty: "No tienes incidencias este mes.",
          items: sortItems(
            incidentItems.map((it: any) => withSla({
              id: String(it.id),
              title: it.reason || it.title || "Incidencia",
              subtitle: it.amount ? `Importe: ${it.amount}€` : "Aviso operativo",
              meta: timeAgo(it.created_at),
              priority: "medium",
              action: "incidents",
              type: "incident",
              created_at: it.created_at,
              value: Number(it.amount || 0),
            }))
          ),
        },
      ];
    }

    const baseSections: InboxSection[] = [
      {
        key: "parking",
        title: "Parking",
        icon: "🅿️",
        count: ops.counters.parking || 0,
        tone: ops.counters.parking ? "red" : "green",
        action: "parking",
        empty: "No hay llamadas aparcadas ahora.",
        items:
          ops.counters.parking > 0
            ? [
                withSla({
                  id: "parking",
                  title: `${ops.counters.parking} llamada(s) esperando`,
                  subtitle: "Revisar parking y derivar cuanto antes.",
                  meta: "Prioridad máxima",
                  priority: "critical",
                  action: "parking",
                  type: "parking",
                }),
              ]
            : [],
      },
      {
        key: "leads",
        title: "Leads pendientes",
        icon: "🔥",
        count: ops.counters.leads || leads.length,
        tone: "gold",
        action: "leads",
        empty: "No hay leads pendientes.",
        items: sortItems(
          leads.map((lead: any) => {
  const probability = getConversionProbability(lead);

  const revenue =
    Number(lead?.cliente_revenue_total) ||
    Number(lead?.cliente_revenue_30d) ||
    20;

  const expectedValue = probability * revenue;

  return withSla({
    id: String(lead.id),
    title: normalizeLeadName(lead),

    subtitle: `Prob: ${Math.round(probability * 100)}% · Valor: ${expectedValue.toFixed(0)}€`,

    meta: lead.workflow_state
      ? `Estado: ${lead.workflow_state}`
      : "Lead pendiente",

    priority:
      expectedValue > 50
        ? "high"
        : expectedValue > 20
        ? "medium"
        : "low",

    action: "leads",
    type: "lead",

    value: expectedValue,

    created_at: lead.created_at,
    last_activity_at: lead.updated_at,
  });
});)
        ),
      },
      {
        key: "calls",
        title: "Llamadas pendientes",
        icon: "📞",
        count: outboundItems.length,
        tone: "gold",
        action: "calls",
        empty: mode === "admin" ? "Vista supervisor sin lote central asignado." : "No hay llamadas pendientes para hoy.",
        items: sortItems(
          outboundItems.map((it: any) => withSla({
            id: String(it.id),
            title: it.customer_name || it.phone || "Cliente pendiente",
            subtitle: it.phone ? `Teléfono: ${it.phone}` : "Llamada pendiente",
            meta: it._sender?.display_name ? `Asignado por ${it._sender.display_name}` : it.current_status || "Pendiente",
            priority: it.priority === "high" ? "high" : "medium",
            action: "calls",
            type: "call",
            created_at: it.created_at,
            last_activity_at: it.last_call_at || it.updated_at,
          }))
        ),
      },
      {
        key: "chat",
        title: mode === "admin" ? "Chats activos" : "Chats central",
        icon: "💬",
        count: chatItems.length || ops.counters.chatUnread || 0,
        tone: "purple",
        action: "chat",
        empty: "No hay chats pendientes visibles.",
        items: sortItems(
          chatItems.map((t: any) => withSla({
            id: String(t.id),
            title: t.tarotist_display_name || t.cliente_nombre || t.title || "Chat activo",
            subtitle: t.last_message_text || t.last_message_preview || "Sin vista previa",
            meta: timeAgo(t.last_message_at),
            priority: t.unread_count ? "medium" : "low",
            action: "chat",
            type: "chat",
            unread_count: Number(t.unread_count || 0),
            last_activity_at: t.last_message_at,
          }))
        ),
      },
      {
        key: "team",
        title: mode === "admin" ? "Equipo global" : "Equipo conectado",
        icon: "👥",
        count: onlineRows.length,
        tone: "blue",
        action: "team",
        empty: "No hay presencia activa registrada.",
        items: sortItems([
          withSla({
            id: "online",
            title: `${onlineRows.length} conectadas ahora`,
            subtitle: `${expectedRows.length} deberían estar en turno · ${loadSummary.label}`,
            meta: offlineExpected ? `${offlineExpected} ausencias detectadas` : "Sin ausencias detectadas",
            priority: offlineExpected ? "high" : loadSummary.level === "critical" || loadSummary.level === "high" ? "medium" : "low",
            action: "team",
            type: "team",
          }),
        ]),
      },
      {
        key: "operator-control",
        title: "Control operadores",
        icon: "🎯",
        count: operatorControl.alertItems.length || operatorControl.topOperators.length,
        tone: operatorControl.alertItems.length ? "red" : "blue",
        action: "team",
        empty: "Sin alertas de carga ahora mismo.",
        items: sortItems([
          ...operatorControl.alertItems.map((alert) =>
            withSla({
              ...alert,
              action: alert.action,
              type: "team",
            })
          ),
          ...operatorControl.topOperators.map((op) =>
            withSla({
              id: `operator-${op.id}`,
              title: `${op.name} · carga ${op.score}`,
              subtitle: `${op.online ? "Online" : "Offline"} · ${op.calls} llamada(s) · ${op.chats} chat(s)`,
              meta: op.level === "high" ? "Carga alta" : op.level === "medium" ? "Carga media" : "Carga baja",
              priority: op.level === "high" ? "medium" : "low",
              action: "team",
              type: "team",
            })
          ),
        ]),
      },
      {
        key: "incidents",
        title: "Incidencias",
        icon: "⚠️",
        count: incidentItems.length,
        tone: incidentItems.length ? "red" : "green",
        action: "incidents",
        empty: mode === "admin" ? "No hay incidencias recientes." : "Gestiona incidencias desde su pestaña.",
        items: sortItems(
          incidentItems.map((it: any) => withSla({
            id: String(it.id),
            title: it.display_name || it.reason || "Incidencia",
            subtitle: it.reason || it.title || "Pendiente de revisión",
            meta: it.amount ? `${it.amount}€ · ${timeAgo(it.created_at)}` : timeAgo(it.created_at),
            priority: "medium",
            action: "incidents",
            type: "incident",
            created_at: it.created_at,
            value: Number(it.amount || 0),
          }))
        ),
      },
    ];

    const focusItems = sortItems(baseSections.flatMap((section) => section.items.map((item) => ({ ...item, action: item.action || section.action })))).filter(
      (item) => item.priority === "critical" || item.priority === "high"
    );

    if (!focusItems.length) return baseSections;

    return [
      {
        key: "focus-now",
        title: "Prioridad ahora",
        icon: "🎯",
        count: focusItems.length,
        tone: "red",
        action: focusItems[0]?.action,
        empty: "No hay prioridades críticas ahora mismo.",
        items: focusItems.slice(0, 4),
      },
      ...baseSections,
    ];
  }, [chatItems, incidentItems, leads, loadSummary, mode, operatorControl, ops.attendance, ops.counters, ops.expected.rows, ops.presences.rows, outboundItems]);

  const decisionItems = useMemo(() => {
  return sortByDecision(
    sections.flatMap((section) =>
      section.items.map((item) => ({
        ...item,
        action: item.action || section.action,
      }))
    ),
    { loadLevel: loadSummary.level }
  );
}, [sections, loadSummary.level]);

  const nextBestItem = useMemo(() => {
  return getNextBestAction(decisionItems, {
    loadLevel: loadSummary.level,
  });
}, [decisionItems, loadSummary.level]);

const nextSuggestion = nextBestItem
  ? getSuggestion(nextBestItem, nextBestItem.action)
  : null;

  return (
    <section className="tc-card" style={{ border: "1px solid rgba(215,181,109,0.18)", overflow: "hidden" }}>
      <div className="tc-row" style={{ justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div className="tc-title" style={{ fontSize: compact ? 16 : 18 }}>
            {mode === "admin" ? "👑 Bandeja supervisión" : mode === "tarotista" ? "🔮 Mi bandeja de turno" : "⚡ Bandeja central"}
          </div>
          <div className="tc-sub" style={{ marginTop: 6 }}>
            {mode === "admin"
              ? "Visión global de lo que requiere atención. Parking manda; chats no bloquean salvo pendientes."
              : mode === "tarotista"
              ? "Resumen reducido de tu turno, llamadas y avisos."
              : "Trabajo operativo priorizado: parking primero, leads/rangos y ausencias después."}
            {refreshedAt ? ` · Actualizado ${timeAgo(refreshedAt)}` : ""}
            {error ? ` · ${error}` : ""}
          </div>
        </div>

        <div className="tc-row" style={{ gap: 8, flexWrap: "wrap" }}>
          <span className="tc-chip">{loading ? "Actualizando…" : "En vivo"}</span>
          <button className="tc-btn tc-btn-gold" onClick={() => void load()} disabled={loading} type="button">
            {loading ? "…" : "Refrescar"}
          </button>
        </div>
      </div>

      <div className="tc-hr" />

{mode === "admin" && (
  <div style={{ marginTop: 10 }}>
    <div className="tc-row" style={{ gap: 8 }}>
      <span className="tc-chip">Leads: {analytics.leads}</span>
      <span className="tc-chip">Llamadas: {analytics.calls}</span>
      <span className="tc-chip">Chats: {analytics.chats}</span>
      <span className="tc-chip">Conversión: {analytics.convertedLeads}/{analytics.leads} ({analytics.conversionRate}%)</span>
      <span className="tc-chip">Revenue leads: {analytics.revenue.toLocaleString("es-ES", { style: "currency", currency: "EUR" })}</span>
    </div>
  </div>
)}


      <div className="tc-row" style={{ gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <span className="tc-chip">{metricLabel(leads.length, "Leads")}</span>
        <span className="tc-chip">{metricLabel(outboundItems.length, "Llamadas")}</span>
        <span className="tc-chip">{metricLabel(chatItems.length || ops.counters.chatUnread || 0, "Chats")}</span>
        <span className="tc-chip">{metricLabel(incidentItems.length, "Avisos")}</span>
        <span className="tc-chip" title={`Score operativo: ${loadSummary.pressureScore.toFixed(1)}`}>{loadSummary.label}</span>
        <span className="tc-chip">Operadores: {operatorControl.operators.length}</span>
        {operatorControl.overloaded ? <span className="tc-chip">Saturada: {operatorControl.overloaded.name}</span> : null}
      </div>

      {nextBestItem ? (
  <div
    style={{
      border: "2px solid rgba(255,82,82,0.58)",
      background: "linear-gradient(135deg, rgba(255,82,82,0.18), rgba(215,181,109,0.07))",
      borderRadius: 18,
      padding: 14,
      marginBottom: 12,
      boxShadow: "0 18px 42px rgba(255,82,82,0.18)",
    }}
  >
    <div className="tc-row" style={{ justifyContent: "space-between", gap: 12 }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 950 }}>🧠 SISTEMA RECOMIENDA</div>

        <div style={{ marginTop: 6, fontWeight: 900 }}>
          {nextBestItem.title}
        </div>

        {nextBestItem.subtitle && (
          <div className="tc-sub" style={{ marginTop: 4 }}>
            {nextBestItem.subtitle}
          </div>
        )}

        {nextSuggestion?.reason && (
          <div className="tc-sub" style={{ marginTop: 4, color: "#f5dfaa" }}>
            {nextSuggestion.reason}
          </div>
        )}

        {nextBestItem.sla?.breached && nextBestItem.sla.reason && (
          <div className="tc-sub" style={{ marginTop: 4, color: "#ffd6d6" }}>
            {nextBestItem.sla.reason}
          </div>
        )}
      </div>

      {nextSuggestion && (
        <button
          type="button"
          className="tc-btn tc-btn-gold"
          onClick={() => fireAction(nextSuggestion.action as InboxAction)}
        >
          {nextSuggestion.label}
        </button>
      )}
    </div>
  </div>
) : null}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: compact ? "1fr" : "repeat(auto-fit, minmax(240px, 1fr))",
          gap: 12,
        }}
      >
        {sections.map((section) => {
          const tone = toneStyle(section.tone);
          const visibleItems = section.items.slice(0, mode === "tarotista" ? 3 : 4);

          return (
            <div
              key={section.key}
              style={{
                border: `1px solid ${tone.border}`,
                background: tone.bg,
                borderRadius: 16,
                padding: 12,
                minHeight: 168,
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              <button
                type="button"
                onClick={() => section.action && fireAction(section.action)}
                className="tc-btn"
                style={{
                  width: "100%",
                  justifyContent: "space-between",
                  borderRadius: 14,
                  padding: "10px 12px",
                  background: "rgba(0,0,0,0.12)",
                }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 900 }}>
                  <span>{section.icon}</span>
                  <span>{section.title}</span>
                </span>
                <span className="tc-chip" style={{ padding: "3px 8px" }}>
                  {section.count}
                </span>
              </button>

              <div style={{ display: "grid", gap: 8 }}>
                {visibleItems.length ? (
                  visibleItems.map((item) => (
                    <div key={`${section.key}-${item.id}`} style={priorityItemStyle(item.priority)}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "flex-start",
                          justifyContent: "space-between",
                          gap: 8,
                        }}
                      >
                        <div style={{ fontWeight: 900, fontSize: 13, lineHeight: 1.25, minWidth: 0 }}>{item.title}</div>
                        {item.priority ? (
                          <span
                            style={{
                              ...priorityBadgeStyle(item.priority),
                              borderRadius: 999,
                              padding: "2px 7px",
                              fontSize: 10,
                              fontWeight: 900,
                              letterSpacing: 0.3,
                              whiteSpace: "nowrap",
                              textTransform: "uppercase",
                            }}
                          >
                            {priorityLabel(item.priority)}
                          </span>
                        ) : null}
                      </div>

                      {item.subtitle ? (
                        <div className="tc-sub" style={{ marginTop: 4 }}>
                          {item.subtitle}
                        </div>
                      ) : null}
                      {item.meta ? (
                        <div className="tc-sub" style={{ marginTop: 4, opacity: 0.78 }}>
                          {item.meta}
                        </div>
                      ) : null}
                      {item.sla?.breached && item.sla.label ? (
                        <div className="tc-sub" style={{ marginTop: 4, color: "#ffd6d6" }}>
                          {item.sla.label}{item.sla.minutesWaiting != null ? ` · ${item.sla.minutesWaiting}m` : ""}
                        </div>
                      ) : null}

                      {(() => {
                        const suggestion = getSuggestion(item, item.action || section.action);
                        const action = suggestion?.action || item.action || section.action;
                        if (!action) return null;

                        return (
                          <button
                            type="button"
                            className="tc-btn"
                            onClick={() => fireAction(action as InboxAction)}
                            title={suggestion?.reason || undefined}
                            style={{
                              marginTop: 8,
                              padding: "6px 9px",
                              borderRadius: 10,
                              fontSize: 12,
                              ...suggestionButtonStyle(suggestion),
                            }}
                          >
                            {suggestion?.label || itemActionLabel(item, section.action)}
                          </button>
                        );
                      })()}
                    </div>
                  ))
                ) : (
                  <div className="tc-sub" style={{ padding: 10, border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12 }}>
                    {section.empty}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
