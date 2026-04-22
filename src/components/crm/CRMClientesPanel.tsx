"use client";

import KpiCard from "@/components/ui/KpiCard";
import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createPortal } from "react-dom";
import { supabaseBrowser } from "@/lib/supabase-browser";
import RegistrarLlamadaModal from "@/components/crm/RegistrarLlamadaModal";

function crmNoteTone(text: string) {
  const s = String(text || "").toLowerCase();
  if (s.includes("compra registrada")) return { chip: "Compra", border: "1px solid rgba(105,240,177,.26)", bg: "linear-gradient(135deg, rgba(105,240,177,.12), rgba(255,255,255,.03))", color: "#b7ffe0" };
  if (s.includes("7 free")) return { chip: "7 Free", border: "1px solid rgba(255,90,106,.22)", bg: "linear-gradient(135deg, rgba(255,90,106,.12), rgba(255,255,255,.03))", color: "#ffc1c7" };
  if (s.includes("cliente usa") || s.includes("uso actual:")) return { chip: "Minutos", border: "1px solid rgba(122,162,255,.22)", bg: "linear-gradient(135deg, rgba(122,162,255,.12), rgba(255,255,255,.03))", color: "#c9d9ff" };
  if (s.includes("promo")) return { chip: "Promo", border: "1px solid rgba(215,181,109,.24)", bg: "linear-gradient(135deg, rgba(215,181,109,.14), rgba(255,255,255,.03))", color: "#f7dfab" };
  if (s.includes("captad")) return { chip: "Captado", border: "1px solid rgba(105,240,177,.22)", bg: "linear-gradient(135deg, rgba(105,240,177,.10), rgba(255,255,255,.03))", color: "#aefad5" };
  if (s.includes("recuperad")) return { chip: "Recuperado", border: "1px solid rgba(181,156,255,.24)", bg: "linear-gradient(135deg, rgba(181,156,255,.12), rgba(255,255,255,.03))", color: "#decfff" };
  return { chip: "Nota", border: "1px solid rgba(255,255,255,.08)", bg: "rgba(255,255,255,.025)", color: "rgba(255,255,255,.92)" };
}

const sb = supabaseBrowser();

function normalizeRankParam(value: string | null | undefined): "" | "bronce" | "plata" | "oro" {
  const v = String(value || "").trim().toLowerCase();
  if (["bronce", "bronze", "bronzes"].includes(v)) return "bronce";
  if (["plata", "silver", "silvers"].includes(v)) return "plata";
  if (["oro", "gold", "golds"].includes(v)) return "oro";
  return "";
}



function normalizeDialPhone(value: string | null | undefined) {
  return String(value || "").replace(/[^0-9*#+]/g, "");
}

function sendNumberToSoftphone(
  phone: string,
  autoCall = false,
  clientContext?: {
    cliente_id?: string | null;
    telefono?: string | null;
    nombre?: string | null;
    apellido?: string | null;
    minutos_free_pendientes?: number | null;
    minutos_normales_pendientes?: number | null;
    tarotista_worker_id?: string | null;
    tarotista_nombre?: string | null;
  }
) {
  const clean = normalizeDialPhone(phone);
  if (!clean || typeof window === "undefined") return false;
  if (clientContext) {
    window.dispatchEvent(new CustomEvent("tc-softphone-client-context", {
      detail: {
        ...clientContext,
        telefono: clientContext.telefono || clean,
        source: "crm",
      },
    }));
  }
  window.dispatchEvent(new CustomEvent("tc-softphone-dial", { detail: { number: clean, autoCall, openFicha: false } }));
  return true;
}

function renderNoteText(text: string) {
  const lines = String(text || "").split(/\n/);
  return lines.map((line, lineIndex) => {
    const parts = line.split(/(\*\*[^*]+\*\*)/g);
    return (
      <span key={`line-${lineIndex}`}>
        {parts.map((part, idx) => {
          if (/^\*\*[^*]+\*\*$/.test(part)) {
            return <strong key={`part-${lineIndex}-${idx}`}>{part.slice(2, -2)}</strong>;
          }
          return <span key={`part-${lineIndex}-${idx}`}>{part}</span>;
        })}
        {lineIndex < lines.length - 1 ? <br /> : null}
      </span>
    );
  });
}

function applyBoldToValue(value: string, start: number, end: number) {
  const from = Number.isFinite(start) ? start : value.length;
  const to = Number.isFinite(end) ? end : value.length;
  const selected = value.slice(from, to) || "texto en negrita";
  return `${value.slice(0, from)}**${selected}**${value.slice(to)}`;
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

function eur(n: any) {
  const x = Number(n) || 0;
  return x.toLocaleString("es-ES", { style: "currency", currency: "EUR" });
}
function rankMeta(rank: string | null | undefined) {
  const r = String(rank || "").toLowerCase();
  if (r === "oro") {
    return {
      icon: "🥇",
      label: "Oro",
      chipBg: "rgba(255,215,120,.18)",
      chipBorder: "1px solid rgba(255,215,120,.32)",
      cardBg: "linear-gradient(135deg, rgba(255,215,120,.18), rgba(255,255,255,.03))",
      cardBorder: "1px solid rgba(255,215,120,.28)",
      perks: [
        "12 min GRATIS con cada nueva tarotista",
        "+12 min permanentes en compras a precio regular",
        "3 pases gratis al mes de 7 minutos",
        "Participación automática en sorteos activos",
        "Seguimiento energético 1 mes post rituales",
      ],
    };
  }
  if (r === "plata") {
    return {
      icon: "🥈",
      label: "Plata",
      chipBg: "rgba(196,210,255,.18)",
      chipBorder: "1px solid rgba(196,210,255,.30)",
      cardBg: "linear-gradient(135deg, rgba(196,210,255,.16), rgba(255,255,255,.03))",
      cardBorder: "1px solid rgba(196,210,255,.26)",
      perks: [
        "10 min GRATIS con cada nueva tarotista",
        "+10 min permanentes en compras a precio regular",
        "3 pases gratis al mes de 7 minutos",
        "Seguimiento energético 1 mes post rituales",
      ],
    };
  }
  if (r === "bronce") {
    return {
      icon: "🥉",
      label: "Bronce",
      chipBg: "rgba(214,156,110,.18)",
      chipBorder: "1px solid rgba(214,156,110,.30)",
      cardBg: "linear-gradient(135deg, rgba(214,156,110,.16), rgba(255,255,255,.03))",
      cardBorder: "1px solid rgba(214,156,110,.26)",
      perks: ["3 pases gratis al mes de 7 minutos"],
    };
  }
  return {
    icon: "▫️",
    label: "Sin rango",
    chipBg: "rgba(255,255,255,.08)",
    chipBorder: "1px solid rgba(255,255,255,.12)",
    cardBg: "rgba(255,255,255,.03)",
    cardBorder: "1px solid rgba(255,255,255,.08)",
    perks: ["Sin compras el mes anterior"],
  };
}

function rankChip(rank: string | null | undefined) {
  const meta = rankMeta(rank);
  return (
    <span
      className="tc-chip"
      style={{
        background: meta.chipBg,
        border: meta.chipBorder,
        color: "white",
        fontWeight: 800,
      }}
    >
      {meta.icon} {meta.label}
    </span>
  );
}


function clientWebMeta(cliente: any) {
  const onboardingDone = Boolean(cliente?.onboarding_completado);
  const accessCount = Math.max(0, Number(cliente?.total_accesos || 0));
  const lastAccessAt = cliente?.ultimo_acceso_at || null;
  const lastActivityAt = cliente?.ultima_actividad_at || null;
  const registered = Boolean(onboardingDone || accessCount > 0 || lastAccessAt || lastActivityAt);
  return { registered, onboardingDone, accessCount, lastAccessAt, lastActivityAt };
}

function clientWebBadge(cliente: any) {
  const meta = clientWebMeta(cliente);
  if (meta.onboardingDone) return { label: "🟢 Web activa", bg: "rgba(34,197,94,.18)", border: "1px solid rgba(34,197,94,.35)", color: "#dcfce7" };
  if (meta.registered) return { label: "🟡 Web pendiente", bg: "rgba(245,158,11,.18)", border: "1px solid rgba(245,158,11,.35)", color: "#fde68a" };
  return { label: "🔴 No registrado", bg: "rgba(239,68,68,.16)", border: "1px solid rgba(239,68,68,.30)", color: "#fecaca" };
}

function formatWebDateTime(v?: string | null) {
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


type CRMClientesPanelProps = {
  mode?: "admin" | "central";
  showImportButton?: boolean;
};

export default function CRMClientesPanel({
  mode = "admin",
  showImportButton = mode === "admin",
}: CRMClientesPanelProps) {
  const [crmQuery, setCrmQuery] = useState("");
  const [crmTagFilter, setCrmTagFilter] = useState("");
  const [crmPhoneFilter, setCrmPhoneFilter] = useState("");
  const [crmCountryFilter, setCrmCountryFilter] = useState("");
  const [crmWebFilter, setCrmWebFilter] = useState<"todos" | "registrados" | "no_registrados" | "onboarding_pendiente">("todos");
  const [crmLoading, setCrmLoading] = useState(false);
  const [crmRows, setCrmRows] = useState<any[]>([]);
  const [crmFreshLeads, setCrmFreshLeads] = useState<any[]>([]);
  const [crmFreshLeadsLoading, setCrmFreshLeadsLoading] = useState(false);
  const [crmFreshLeadsMsg, setCrmFreshLeadsMsg] = useState("");
  const [crmMsg, setCrmMsg] = useState("");
  const [crmImportLoading, setCrmImportLoading] = useState(false);
  const [crmCreateLoading, setCrmCreateLoading] = useState(false);
  const [crmCreateMsg, setCrmCreateMsg] = useState("");
  const [mostrarNuevoCliente, setMostrarNuevoCliente] = useState(false);
  const [crmRankSummary, setCrmRankSummary] = useState<any>(null);
  const [crmRankLoading, setCrmRankLoading] = useState(false);
  const [crmRankMsg, setCrmRankMsg] = useState("");
  const router = useRouter();
  const searchParams = useSearchParams();
  const rankFromUrl = normalizeRankParam(searchParams?.get("rango"));
  const [crmRankFilter, setCrmRankFilter] = useState<"" | "bronce" | "plata" | "oro">(rankFromUrl);

  const [crmEtiquetasOpts, setCrmEtiquetasOpts] = useState<any[]>([]);
  const [crmEtiquetasLoading, setCrmEtiquetasLoading] = useState(false);
  const [crmClienteEtiquetasSel, setCrmClienteEtiquetasSel] = useState<string[]>([]);
  const [crmNewEtiquetasSel, setCrmNewEtiquetasSel] = useState<string[]>([]);
  const [crmEtiquetasModalFor, setCrmEtiquetasModalFor] = useState<"" | "ficha" | "nuevo">("");
  const [crmNuevaEtiqueta, setCrmNuevaEtiqueta] = useState("");
  const [crmEtiquetasSaving, setCrmEtiquetasSaving] = useState(false);

  const [crmTarotistasOpts, setCrmTarotistasOpts] = useState<any[]>([]);
  const [crmTarotistasLoading, setCrmTarotistasLoading] = useState(false);
  const [crmTarotistaSendId, setCrmTarotistaSendId] = useState("");
  const [crmSendLoading, setCrmSendLoading] = useState(false);
  const [crmSendMsg, setCrmSendMsg] = useState("");
  const [crmSendMinFree, setCrmSendMinFree] = useState("0");
  const [crmSendMinNormales, setCrmSendMinNormales] = useState("0");
  const [crmReservaTarotistaId, setCrmReservaTarotistaId] = useState("");
  const [crmReservaTarotistaManual, setCrmReservaTarotistaManual] = useState("");
  const [crmReservaFecha, setCrmReservaFecha] = useState("");
  const [crmReservaNota, setCrmReservaNota] = useState("");
  const [crmReservaLoading, setCrmReservaLoading] = useState(false);
  const [crmReservaMsg, setCrmReservaMsg] = useState("");


  const [crmClienteSelId, setCrmClienteSelId] = useState("");
  const [crmClienteFicha, setCrmClienteFicha] = useState<any>(null);
  const [crmFichaLoading, setCrmFichaLoading] = useState(false);
  const [crmFichaMsg, setCrmFichaMsg] = useState("");

  const [crmEditNombre, setCrmEditNombre] = useState("");
  const [crmEditApellido, setCrmEditApellido] = useState("");
  const [crmEditTelefono, setCrmEditTelefono] = useState("");
  const [crmEditPais, setCrmEditPais] = useState("");
  const [crmEditEmail, setCrmEditEmail] = useState("");
  const [crmEditNotas, setCrmEditNotas] = useState("");
  const [crmEditOrigen, setCrmEditOrigen] = useState("");
  const [crmEditDeuda, setCrmEditDeuda] = useState("0");
  const [crmEditMinFree, setCrmEditMinFree] = useState("0");
  const [crmEditMinNormales, setCrmEditMinNormales] = useState("0");
  const [crmSaveLoading, setCrmSaveLoading] = useState(false);

  const [crmNewNombre, setCrmNewNombre] = useState("");
  const [crmNewApellido, setCrmNewApellido] = useState("");
  const [crmNewTelefono, setCrmNewTelefono] = useState("");
  const [crmNewPais, setCrmNewPais] = useState("España");
  const [crmNewEmail, setCrmNewEmail] = useState("");
  const [crmNewNotas, setCrmNewNotas] = useState("");
  const [crmNewOrigen, setCrmNewOrigen] = useState("manual");
  const [crmNewDeuda, setCrmNewDeuda] = useState("0");
  const [crmNewMinFree, setCrmNewMinFree] = useState("0");
  const [crmNewMinNormales, setCrmNewMinNormales] = useState("0");

  // COBROS
  const [crmPagos, setCrmPagos] = useState<any[]>([]);
  const [crmPagosLoading, setCrmPagosLoading] = useState(false);
  const [crmPagoImporte, setCrmPagoImporte] = useState("");
  const [crmPagoNotas, setCrmPagoNotas] = useState("");
  const [crmPagoReferencia, setCrmPagoReferencia] = useState("");
  const [crmPagoLoading, setCrmPagoLoading] = useState(false);
  const [crmPagoMsg, setCrmPagoMsg] = useState("");
  const [crmPagoPendienteConfirmacion, setCrmPagoPendienteConfirmacion] = useState(false);

  // NOTAS CON AUTOR
  const [crmNotes, setCrmNotes] = useState<any[]>([]);
  const [crmNotesLoading, setCrmNotesLoading] = useState(false);
  const [crmNotesMsg, setCrmNotesMsg] = useState("");
  const [crmNewNote, setCrmNewNote] = useState("");
  const [crmSavingNote, setCrmSavingNote] = useState(false);
  const [crmEditingNoteId, setCrmEditingNoteId] = useState("");
  const [crmEditingNoteText, setCrmEditingNoteText] = useState("");
  const crmNewNoteRef = useRef<HTMLTextAreaElement | null>(null);
  const crmEditNoteRef = useRef<HTMLTextAreaElement | null>(null);
  const [crmUpdatingNote, setCrmUpdatingNote] = useState(false);
  const [crmPinningNoteId, setCrmPinningNoteId] = useState("");
  const [crmRegistrarOpen, setCrmRegistrarOpen] = useState(false);
  const [crmNotesExpanded, setCrmNotesExpanded] = useState(false);

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
        setCrmRankLoading(true);
        setCrmRankMsg("");
      }
      const token = await getTokenOrLogin();
      if (!token) return;
      const r = await fetch("/api/admin/client-ranks/summary", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const j = await safeJson(r);
      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status || r.status}`);
      setCrmRankSummary(j?.summary || null);
      if (!silent) setCrmRankMsg("✅ Rangos de 30 días cargados.");
    } catch (e: any) {
      if (!silent) setCrmRankMsg(`❌ ${e?.message || "Error cargando rangos"}`);
    } finally {
      if (!silent) setCrmRankLoading(false);
    }
  }

  async function recalculateClientRanks() {
    try {
      setCrmRankLoading(true);
      setCrmRankMsg("");
      const token = await getTokenOrLogin();
      if (!token) return;
      const r = await fetch("/api/admin/client-ranks/recalculate", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const j = await safeJson(r);
      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status || r.status}`);
      const rangos = j?.rangos || {};
      setCrmRankSummary({
        totalConRango: Number(j?.clientes_actualizados || 0),
        bronce: Number(rangos?.bronce || 0),
        plata: Number(rangos?.plata || 0),
        oro: Number(rangos?.oro || 0),
        gastoMesAnterior: Number(j?.gastoMesAnterior || 0),
        comprasMesAnterior: Number(j?.comprasMesAnterior || 0),
      });
      setCrmRankMsg(`✅ Rangos recalculados. ${Number(j?.clientes_actualizados || 0)} clientes actualizados.`);
      await searchCRM(true);
      if (crmClienteSelId || crmClienteFicha?.id) {
        await openCRMFicha(String(crmClienteSelId || crmClienteFicha?.id || ""));
      }
    } catch (e: any) {
      setCrmRankMsg(`❌ ${e?.message || "Error recalculando rangos"}`);
    } finally {
      setCrmRankLoading(false);
    }
  }

  function sortNotes(rows: any[]) {
    return [...(rows || [])].sort((a: any, b: any) => {
      const ap = a?.is_pinned ? 1 : 0;
      const bp = b?.is_pinned ? 1 : 0;
      if (ap !== bp) return bp - ap;
      return String(b?.created_at || "").localeCompare(String(a?.created_at || ""));
    });
  }

  function getEtiquetasSeleccionadas(target: "ficha" | "nuevo") {
    return target === "ficha" ? crmClienteEtiquetasSel : crmNewEtiquetasSel;
  }

  function setEtiquetasSeleccionadas(target: "ficha" | "nuevo", values: string[]) {
    if (target === "ficha") {
      setCrmClienteEtiquetasSel(values);
      return;
    }
    setCrmNewEtiquetasSel(values);
  }

  function toggleEtiquetaSeleccion(target: "ficha" | "nuevo", etiquetaId: string) {
    const list = getEtiquetasSeleccionadas(target);
    const next = list.includes(etiquetaId)
      ? list.filter((x) => x !== etiquetaId)
      : [...list, etiquetaId];
    setEtiquetasSeleccionadas(target, next);
  }

  function openEtiquetasModal(target: "ficha" | "nuevo") {
    setCrmEtiquetasModalFor(target);
    setCrmNuevaEtiqueta("");
  }

  function closeEtiquetasModal() {
    setCrmEtiquetasModalFor("");
    setCrmNuevaEtiqueta("");
  }

  async function createCRMEtiquetaDesdeModal() {
    const nombre = crmNuevaEtiqueta.trim();
    if (!nombre) return;

    try {
      setCrmEtiquetasSaving(true);
      const token = await getTokenOrLogin();
      if (!token) return;

      const r = await fetch("/api/crm/etiquetas/crear", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ nombre }),
      });

      const j = await safeJson(r);
      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status || r.status}`);

      const etiqueta = j?.etiqueta;
      if (!etiqueta?.id) return;

      setCrmEtiquetasOpts((prev) => {
        const exists = prev.some((x: any) => String(x?.id) === String(etiqueta.id));
        return exists ? prev : [...prev, etiqueta].sort((a: any, b: any) => String(a?.nombre || "").localeCompare(String(b?.nombre || "")));
      });

      if (crmEtiquetasModalFor) {
        toggleEtiquetaSeleccion(crmEtiquetasModalFor, String(etiqueta.id));
      }
      setCrmNuevaEtiqueta("");
    } catch (e) {
      console.error("ERROR CREANDO ETIQUETA CRM", e);
    } finally {
      setCrmEtiquetasSaving(false);
    }
  }

  async function saveEtiquetasCliente(clienteId?: string) {
    const targetId = String(clienteId || crmClienteSelId || crmClienteFicha?.id || "").trim();
    if (!targetId) return;

    try {
      const token = await getTokenOrLogin();
      if (!token) return;

      const r = await fetch("/api/crm/clientes/etiquetas/update", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          cliente_id: targetId,
          etiquetas: crmClienteEtiquetasSel,
        }),
      });

      const j = await safeJson(r);
      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status || r.status}`);

      await loadEtiquetasCliente(targetId);
    } catch (e) {
      console.error("ERROR GUARDANDO ETIQUETAS CLIENTE", e);
      throw e;
    }
  }

  async function loadCRMEtiquetas() {
    try {
      setCrmEtiquetasLoading(true);

      const token = await getTokenOrLogin();
      if (!token) return;

      const r = await fetch("/api/crm/etiquetas/listar", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });

      const j = await safeJson(r);

      if (!j?._ok || !j?.ok) {
        throw new Error(j?.error || `HTTP ${j?._status || r.status}`);
      }

      setCrmEtiquetasOpts(Array.isArray(j.etiquetas) ? j.etiquetas : []);
    } catch (e) {
      console.error("ERROR CARGANDO ETIQUETAS CRM", e);
      setCrmEtiquetasOpts([]);
    } finally {
      setCrmEtiquetasLoading(false);
    }
  }

  async function loadEtiquetasCliente(clienteId: string) {
    if (!clienteId) {
      setCrmClienteEtiquetasSel([]);
      return;
    }

    try {
      const token = await getTokenOrLogin();
      if (!token) return;

      const r = await fetch(`/api/crm/clientes/etiquetas/get?cliente_id=${encodeURIComponent(clienteId)}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });

      const j = await safeJson(r);
      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status || r.status}`);

      const ids = Array.isArray(j.etiquetas)
        ? j.etiquetas.map((x: any) => String(x?.id || x?.etiqueta_id || "")).filter(Boolean)
        : [];

      setCrmClienteEtiquetasSel(ids);
    } catch (e) {
      console.error("ERROR CARGANDO ETIQUETAS CLIENTE", e);
      setCrmClienteEtiquetasSel([]);
    }
  }

  async function loadCRMTarotistas() {
    try {
      setCrmTarotistasLoading(true);

      const token = await getTokenOrLogin();
      if (!token) return;

      const r = await fetch("/api/crm/call-popups/enviar", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });

      const j = await safeJson(r);

      if (!j?._ok || !j?.ok) {
        throw new Error(j?.error || `HTTP ${j?._status || r.status}`);
      }

      const tarotistas = Array.isArray(j.tarotistas) ? j.tarotistas : [];
      setCrmTarotistasOpts(tarotistas);

      setCrmTarotistaSendId((prev) => {
        if (prev && tarotistas.some((t: any) => String(t.id) === String(prev))) return prev;
        return "";
      });
    } catch (e) {
      console.error("ERROR CARGANDO TAROTISTAS CRM", e);
      setCrmTarotistasOpts([]);
    } finally {
      setCrmTarotistasLoading(false);
    }
  }

  useEffect(() => {
    loadCRMEtiquetas();
    loadCRMTarotistas();
    loadFreshLeads();
    loadRankSummary(true);
    if (rankFromUrl) {
      setCrmRankFilter(rankFromUrl);
      searchCRM(true, rankFromUrl);
    } else {
      searchCRM(true);
    }

    const interval = window.setInterval(() => {
      loadFreshLeads(true);
      loadRankSummary(true);
    }, 20000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const nextRank = rankFromUrl;
    if (nextRank === crmRankFilter) return;
    setCrmRankFilter(nextRank);
    searchCRM(true, nextRank);
  }, [rankFromUrl]);

  useEffect(() => {
    function onOpenCliente(e: any) {
      const id = e?.detail?.id;
      if (id) openCRMFicha(String(id));
    }

    window.addEventListener("crm-open-cliente", onOpenCliente);
    return () => window.removeEventListener("crm-open-cliente", onOpenCliente);
  }, []);

  useEffect(() => {
    const openClienteId = String(searchParams?.get("open_cliente_id") || "").trim();
    const phoneFromUrl = String(searchParams?.get("telefono") || "").trim();

    if (openClienteId) {
      void openCRMFicha(openClienteId);
      return;
    }

    if (!phoneFromUrl) return;

    setCrmPhoneFilter(phoneFromUrl);

    void (async () => {
      try {
        const token = await getTokenOrLogin();
        if (!token) return;
        const r = await fetch(`/api/crm/clientes/buscar?telefono=${encodeURIComponent(phoneFromUrl)}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const j = await safeJson(r);
        if (!j?._ok || !j?.ok) return;
        setCrmRows(j.clientes || []);
        setCrmMsg(`Resultados: ${(j.clientes || []).length}`);
      } catch {
        // noop
      }
    })();
  }, [searchParams]);

  useEffect(() => {
    if (!crmClienteSelId) return;

    try {
      const raw = sessionStorage.getItem("crm_pago_paypal_draft");
      if (!raw) return;

      const draft = JSON.parse(raw);
      if (String(draft?.cliente_id || "") !== String(crmClienteSelId)) return;

      if (draft?.importe && !crmPagoImporte) {
        setCrmPagoImporte(String(draft.importe));
      }
      if (typeof draft?.notas === "string" && !crmPagoNotas) {
        setCrmPagoNotas(draft.notas);
      }
      if (typeof draft?.referencia_externa === "string" && !crmPagoReferencia) {
        setCrmPagoReferencia(draft.referencia_externa);
      }

      setCrmPagoPendienteConfirmacion(true);
      setCrmPagoMsg("ℹ️ He recuperado el borrador del cobro de PayPal para este cliente. Pega la referencia y pulsa 'Confirmar pago' o 'Pago erróneo'.");
    } catch {}
  }, [crmClienteSelId]);


  async function loadFreshLeads(silent = false) {
    try {
      if (!silent) {
        setCrmFreshLeadsLoading(true);
        setCrmFreshLeadsMsg("");
      }

      const token = await getTokenOrLogin();
      if (!token) return;

      const r = await fetch("/api/crm/leads/recent?limit=6&minutes=240", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const j = await safeJson(r);
      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status || r.status}`);

      const leads = Array.isArray(j?.leads) ? j.leads : [];
      setCrmFreshLeads(leads);
      if (!silent) {
        setCrmFreshLeadsMsg(leads.length ? `Leads calientes: ${leads.length}` : "No hay leads recientes sin contactar");
      }
    } catch (e: any) {
      if (!silent) setCrmFreshLeadsMsg(`❌ ${e?.message || "Error cargando leads"}`);
      setCrmFreshLeads([]);
    } finally {
      if (!silent) setCrmFreshLeadsLoading(false);
    }
  }

  async function markLeadAsContacted(clienteId: string) {
    const id = String(clienteId || "").trim();
    if (!id) return;

    try {
      const token = await getTokenOrLogin();
      if (!token) return;

      const r = await fetch("/api/crm/leads/contacted", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ cliente_id: id }),
      });

      const j = await safeJson(r);
      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status || r.status}`);

      setCrmFreshLeads((prev) => prev.filter((lead: any) => String(lead?.id || "") !== id));
      setCrmFreshLeadsMsg("✅ Lead marcado como contactado");

      if (String(crmClienteSelId || crmClienteFicha?.id || "") === id) {
        await openCRMFicha(id);
      }
    } catch (e: any) {
      setCrmFreshLeadsMsg(`❌ ${e?.message || "Error marcando lead"}`);
    }
  }

  function rankLabel(rank: "" | "bronce" | "plata" | "oro") {
    if (rank === "oro") return "Oro";
    if (rank === "plata") return "Plata";
    if (rank === "bronce") return "Bronce";
    return "Todos";
  }

  async function openRankClients(rank: "bronce" | "plata" | "oro") {
    setCrmRankFilter(rank);

    try {
      const basePath = mode === "central" ? "/panel-central" : "/admin";
      router.replace(`${basePath}?tab=crm&rango=${encodeURIComponent(rank)}`);
    } catch {}

    await searchCRM(false, rank || "");

    try {
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {}
  }

  async function clearRankClientsFilter() {
    setCrmRankFilter("");

    try {
      const basePath = mode === "central" ? "/panel-central" : "/admin";
      router.replace(`${basePath}?tab=crm`);
    } catch {}

    await searchCRM(false, "");
  }

  async function searchCRM(silent = false, forcedRank: "" | "bronce" | "plata" | "oro" = crmRankFilter) {
    const q = crmQuery.trim();
    const telefono = crmPhoneFilter.trim();
    const etiqueta = crmTagFilter.trim();
    const pais = crmCountryFilter.trim();

    try {
      if (!silent) {
        setCrmLoading(true);
        setCrmMsg("");
      }

      const token = await getTokenOrLogin();
      if (!token) return;

      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (telefono) params.set("telefono", telefono);
      if (etiqueta) {
        params.set("etiqueta", etiqueta);
        params.set("tag", etiqueta);
      }
      if (pais) params.set("pais", pais);
      if (crmWebFilter !== "todos") params.set("web_filter", crmWebFilter);
      if (forcedRank && ["bronce", "plata", "oro"].includes(forcedRank)) {
  params.set("rango", forcedRank);
}
      
      const url = `/api/crm/clientes/buscar?${params.toString()}`;
console.log("URL CRM 👉", url);
      
      const r = await fetch(url, {
  headers: { Authorization: `Bearer ${token}` },
});

      const j = await safeJson(r);

      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status}`);

      setCrmRows(j.clientes || []);
      setCrmMsg(`Resultados: ${(j.clientes || []).length}`);
    } catch (e: any) {
      setCrmRows([]);
      setCrmMsg(`❌ ${e?.message || "Error"}`);
    } finally {
      if (!silent) setCrmLoading(false);
    }
  }

  async function importCRM() {
    try {
      setCrmImportLoading(true);
      setCrmMsg("");

      const token = await getTokenOrLogin();
      if (!token) return;

      const r = await fetch("/api/admin/crm/import", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });

      const j = await safeJson(r);

      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status}`);

      setCrmMsg(j.message || "✅ Importación CRM lanzada correctamente.");
    } catch (e: any) {
      setCrmMsg(`❌ ${e?.message || "Error al importar CRM"}`);
    } finally {
      setCrmImportLoading(false);
    }
  }

  async function createCRMClient() {
    if (!crmNewNombre.trim()) {
      setCrmCreateMsg("⚠️ El nombre es obligatorio");
      return;
    }

    if (!crmNewTelefono.trim()) {
      setCrmCreateMsg("⚠️ El teléfono es obligatorio");
      return;
    }

    try {
      setCrmCreateLoading(true);
      setCrmCreateMsg("");

      const token = await getTokenOrLogin();
      if (!token) return;

      const r = await fetch("/api/crm/clientes/crear", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          nombre: crmNewNombre.trim(),
          apellido: crmNewApellido.trim(),
          telefono: crmNewTelefono.trim(),
          pais: crmNewPais.trim() || "España",
          email: crmNewEmail.trim(),
          notas: crmNewNotas.trim(),
          origen: crmNewOrigen.trim() || "manual",
          deuda_pendiente: Number(String(crmNewDeuda).replace(",", ".")) || 0,
          minutos_free_pendientes: Number(String(crmNewMinFree).replace(",", ".")) || 0,
          minutos_normales_pendientes: Number(String(crmNewMinNormales).replace(",", ".")) || 0,
        }),
      });

      const j = await safeJson(r);

      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status}`);

      const nuevoClienteId = String(
        j?.cliente?.id ||
        j?.cliente_id ||
        j?.id ||
        ""
      ).trim();

      if (nuevoClienteId && crmNewEtiquetasSel.length > 0) {
        try {
          await fetch("/api/crm/clientes/etiquetas/update", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              cliente_id: nuevoClienteId,
              etiquetas: crmNewEtiquetasSel,
            }),
          });
        } catch {}
      }

      setCrmCreateMsg("✅ Cliente creado correctamente");
      setCrmNewNombre("");
      setCrmNewApellido("");
      setCrmNewTelefono("");
      setCrmNewPais("España");
      setCrmNewEmail("");
      setCrmNewNotas("");
      setCrmNewOrigen("manual");
      setCrmNewDeuda("0");
      setCrmNewMinFree("0");
      setCrmNewMinNormales("0");
      setCrmNewEtiquetasSel([]);
      setMostrarNuevoCliente(false);

      await searchCRM();
    } catch (e: any) {
      setCrmCreateMsg(`❌ ${e?.message || "Error al crear cliente"}`);
    } finally {
      setCrmCreateLoading(false);
    }
  }

  function clearCRMFilters() {
    setCrmQuery("");
    setCrmTagFilter("");
    setCrmPhoneFilter("");
    setCrmCountryFilter("");
    setCrmWebFilter("todos");
    setCrmRows([]);
    setCrmMsg("");
  }

  function closeCRMFicha() {
    setCrmClienteSelId("");
    setCrmClienteFicha(null);
    setCrmFichaMsg("");
    setCrmSendMsg("");
    setCrmTarotistaSendId("");
    setCrmSendMinFree("0");
    setCrmSendMinNormales("0");
    setCrmReservaTarotistaId("");
    setCrmReservaTarotistaManual("");
    setCrmReservaFecha("");
    setCrmReservaNota("");
    setCrmReservaLoading(false);
    setCrmReservaMsg("");
    setCrmEditNombre("");
    setCrmEditApellido("");
    setCrmEditTelefono("");
    setCrmEditPais("");
    setCrmEditEmail("");
    setCrmEditNotas("");
    setCrmEditOrigen("");
    setCrmEditDeuda("0");
    setCrmEditMinFree("0");
    setCrmEditMinNormales("0");
    setCrmPagos([]);
    setCrmPagosLoading(false);
    setCrmPagoImporte("");
    setCrmPagoNotas("");
    setCrmPagoReferencia("");
    setCrmPagoLoading(false);
    setCrmPagoMsg("");
    setCrmPagoPendienteConfirmacion(false);
    setCrmNotes([]);
    setCrmNotesLoading(false);
    setCrmNotesMsg("");
    setCrmNewNote("");
    setCrmSavingNote(false);
    setCrmEditingNoteId("");
    setCrmEditingNoteText("");
    setCrmUpdatingNote(false);
    setCrmPinningNoteId("");
    setCrmRegistrarOpen(false);
    setCrmNotesExpanded(false);
    setCrmClienteEtiquetasSel([]);
    setCrmEtiquetasModalFor("");
    setCrmNuevaEtiqueta("");
  }

  async function loadPagosCliente(clienteId: string) {
    if (!clienteId) {
      setCrmPagos([]);
      return;
    }

    try {
      setCrmPagosLoading(true);
      setCrmPagoMsg("");

      const token = await getTokenOrLogin();
      if (!token) return;

      const r = await fetch(`/api/crm/pagos/listar?cliente_id=${encodeURIComponent(clienteId)}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });

      const j = await safeJson(r);

      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status}`);

      setCrmPagos(Array.isArray(j.pagos) ? j.pagos : []);
    } catch (e) {
      console.error("ERROR CARGANDO PAGOS CLIENTE", e);
      setCrmPagos([]);
    } finally {
      setCrmPagosLoading(false);
    }
  }

  async function loadNotasCliente(clienteId: string) {
    if (!clienteId) {
      setCrmNotes([]);
      return;
    }

    try {
      setCrmNotesLoading(true);
      setCrmNotesMsg("");

      const token = await getTokenOrLogin();
      if (!token) return;

      const r = await fetch(`/api/crm/clientes/notas/listar?cliente_id=${encodeURIComponent(clienteId)}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });

      const j = await safeJson(r);
      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status}`);

      setCrmNotes(sortNotes(Array.isArray(j.notas) ? j.notas : []));
      setCrmNotesExpanded(false);
    } catch (e) {
      console.error("ERROR CARGANDO NOTAS CLIENTE", e);
      setCrmNotes([]);
    } finally {
      setCrmNotesLoading(false);
    }
  }

  async function createCRMNote() {
    const clienteId = String(crmClienteFicha?.id || crmClienteSelId || "").trim();
    if (!clienteId) {
      setCrmNotesMsg("⚠️ Primero abre una ficha de cliente");
      return;
    }

    if (!crmNewNote.trim()) {
      setCrmNotesMsg("⚠️ Escribe una nota");
      return;
    }

    try {
      setCrmSavingNote(true);
      setCrmNotesMsg("");

      const token = await getTokenOrLogin();
      if (!token) return;

      const r = await fetch("/api/crm/clientes/notas/crear", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          cliente_id: clienteId,
          texto: crmNewNote.trim(),
        }),
      });

      const j = await safeJson(r);
      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status}`);

      setCrmNewNote("");
      setCrmNotesMsg("✅ Nota guardada");
      await loadNotasCliente(clienteId);
    } catch (e: any) {
      setCrmNotesMsg(`❌ ${e?.message || "Error guardando nota"}`);
    } finally {
      setCrmSavingNote(false);
    }
  }

  function startEditCRMNote(note: any) {
    setCrmEditingNoteId(String(note?.id || ""));
    setCrmEditingNoteText(String(note?.texto || ""));
    setCrmNotesMsg("");
  }

  function cancelEditCRMNote() {
    setCrmEditingNoteId("");
    setCrmEditingNoteText("");
  }

  function applyBoldToNewNote() {
    const el = crmNewNoteRef.current;
    const next = applyBoldToValue(crmNewNote, el?.selectionStart ?? crmNewNote.length, el?.selectionEnd ?? crmNewNote.length);
    setCrmNewNote(next);
    setTimeout(() => el?.focus(), 0);
  }

  function applyBoldToEditingNote() {
    const el = crmEditNoteRef.current;
    const next = applyBoldToValue(crmEditingNoteText, el?.selectionStart ?? crmEditingNoteText.length, el?.selectionEnd ?? crmEditingNoteText.length);
    setCrmEditingNoteText(next);
    setTimeout(() => el?.focus(), 0);
  }

  async function updateCRMNote(noteId: string) {
    if (!noteId) return;
    if (!crmEditingNoteText.trim()) {
      setCrmNotesMsg("⚠️ La nota no puede estar vacía");
      return;
    }
    try {
      setCrmUpdatingNote(true);
      setCrmNotesMsg("");
      const token = await getTokenOrLogin();
      if (!token) return;
      const r = await fetch("/api/crm/clientes/notas/update", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: noteId,
          texto: crmEditingNoteText.trim(),
        }),
      });
      const j = await safeJson(r);
      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status}`);
      setCrmNotesMsg("✅ Nota actualizada");
      cancelEditCRMNote();
      await loadNotasCliente(String(crmClienteFicha?.id || crmClienteSelId || ""));
    } catch (e: any) {
      setCrmNotesMsg(`❌ ${e?.message || "Error actualizando nota"}`);
    } finally {
      setCrmUpdatingNote(false);
    }
  }

  async function togglePinCRMNote(note: any) {
    const noteId = String(note?.id || "");
    const clienteId = String(crmClienteFicha?.id || crmClienteSelId || "").trim();
    if (!noteId || !clienteId) return;
    try {
      setCrmPinningNoteId(noteId);
      setCrmNotesMsg("");
      const token = await getTokenOrLogin();
      if (!token) return;
      const r = await fetch("/api/crm/clientes/notas/pin", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: noteId,
          is_pinned: !Boolean(note?.is_pinned),
        }),
      });
      const j = await safeJson(r);
      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status}`);
      setCrmNotesMsg(!Boolean(note?.is_pinned) ? "✅ Nota anclada" : "✅ Nota desanclada");
      await loadNotasCliente(clienteId);
    } catch (e: any) {
      setCrmNotesMsg(`❌ ${e?.message || "Error anclando nota"}`);
    } finally {
      setCrmPinningNoteId("");
    }
  }

  async function openCRMFicha(id: string) {
    if (!id) return;

    try {
      setCrmFichaLoading(true);
      setCrmFichaMsg("");
      setCrmSendMsg("");
      setCrmPagoMsg("");
      setCrmClienteSelId(id);

      const token = await getTokenOrLogin();
      if (!token) return;

      const r = await fetch(`/api/crm/clientes/ficha?id=${encodeURIComponent(id)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      const j = await safeJson(r);
      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status}`);

      const c = j.cliente;
      setCrmClienteFicha(c);
      setCrmClienteSelId(String(c?.id || id || ""));
      setCrmEditNombre(String(c?.nombre || ""));
      setCrmEditApellido(String(c?.apellido || ""));
      setCrmEditTelefono(String(c?.telefono || ""));
      setCrmEditPais(String(c?.pais || ""));
      setCrmEditEmail(String(c?.email || ""));
      setCrmEditNotas(String(c?.notas || ""));
      setCrmEditOrigen(String(c?.origen || ""));
      setCrmEditDeuda(String(c?.deuda_pendiente ?? 0));
      setCrmEditMinFree(String(c?.minutos_free_pendientes ?? 0));
      setCrmEditMinNormales(String(c?.minutos_normales_pendientes ?? 0));
      setCrmSendMinFree(String(c?.minutos_free_pendientes ?? 0));
      setCrmSendMinNormales(String(c?.minutos_normales_pendientes ?? 0));

      const etiquetasFichaRaw =
        c?.etiquetas ||
        c?.tags ||
        c?.labels ||
        c?.crm_tags ||
        c?.crm_etiquetas ||
        [];
      const etiquetasFichaIds = Array.isArray(etiquetasFichaRaw)
        ? etiquetasFichaRaw
            .map((x: any) =>
              typeof x === "string"
                ? x
                : String(x?.id || x?.etiqueta_id || x?.tag_id || "")
            )
            .filter(Boolean)
        : [];
      setCrmClienteEtiquetasSel(etiquetasFichaIds);

      await Promise.all([
        loadPagosCliente(String(c?.id || id || "")),
        loadNotasCliente(String(c?.id || id || "")),
        loadEtiquetasCliente(String(c?.id || id || "")),
      ]);
    } catch (e: any) {
      console.error("ERROR FICHA", e);
      setCrmClienteFicha(null);
      setCrmFichaMsg(`❌ ${e?.message || "Error cargando ficha"}`);
    } finally {
      setCrmFichaLoading(false);
    }
  }

  async function saveCRMFicha() {
    if (!crmClienteSelId) return;

    try {
      setCrmSaveLoading(true);
      setCrmFichaMsg("");

      const token = await getTokenOrLogin();
      if (!token) return;

      const r = await fetch("/api/crm/clientes/actualizar", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: crmClienteSelId,
          nombre: crmEditNombre,
          apellido: crmEditApellido,
          telefono: crmEditTelefono,
          pais: crmEditPais,
          email: crmEditEmail,
          notas: crmEditNotas,
          origen: crmEditOrigen,
          deuda_pendiente: Number(String(crmEditDeuda).replace(",", ".")) || 0,
          minutos_free_pendientes: Number(String(crmEditMinFree).replace(",", ".")) || 0,
          minutos_normales_pendientes: Number(String(crmEditMinNormales).replace(",", ".")) || 0,
        }),
      });

      const j = await safeJson(r);
      if (!j?._ok || !j?.ok) throw new Error(j?.error || "Error guardando");

      await saveEtiquetasCliente(crmClienteSelId);
      await openCRMFicha(crmClienteSelId);
      setCrmFichaMsg("✅ Cliente y etiquetas actualizados correctamente");
      await searchCRM();
    } catch (e: any) {
      setCrmFichaMsg(`❌ ${e?.message || "Error guardando ficha"}`);
    } finally {
      setCrmSaveLoading(false);
    }
  }

  async function crearReservaCRM() {
    const clienteId = String(crmClienteFicha?.id || crmClienteSelId || "").trim();
    if (!clienteId) {
      setCrmReservaMsg("⚠️ Primero abre una ficha de cliente");
      return;
    }

    const tarotista_worker_id = String(crmReservaTarotistaId || "").trim();
    const tarotista_nombre_manual = String(crmReservaTarotistaManual || "").trim();
    const fecha_reserva = String(crmReservaFecha || "").trim();

    if (!tarotista_worker_id && !tarotista_nombre_manual) {
      setCrmReservaMsg("⚠️ Selecciona una tarotista o escribe un nombre manual");
      return;
    }

    if (!fecha_reserva) {
      setCrmReservaMsg("⚠️ Selecciona fecha y hora para la reserva");
      return;
    }

    try {
      setCrmReservaLoading(true);
      setCrmReservaMsg("");

      const token = await getTokenOrLogin();
      if (!token) return;

      const payload: any = {
        cliente_id: clienteId,
        fecha_reserva: new Date(fecha_reserva).toISOString(),
        nota: crmReservaNota.trim(),
      };

      if (tarotista_worker_id) payload.tarotista_worker_id = tarotista_worker_id;
      if (tarotista_nombre_manual) payload.tarotista_nombre_manual = tarotista_nombre_manual;

      const r = await fetch("/api/crm/reservas/crear", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const j = await safeJson(r);
      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status || r.status}`);

      setCrmReservaMsg("✅ Reserva creada correctamente");
      setCrmReservaTarotistaId("");
      setCrmReservaTarotistaManual("");
      setCrmReservaFecha("");
      setCrmReservaNota("");
    } catch (e: any) {
      setCrmReservaMsg(`❌ ${e?.message || "Error creando reserva"}`);
    } finally {
      setCrmReservaLoading(false);
    }
  }

  async function sendCallPopup() {
    if (!crmClienteSelId && !crmClienteFicha?.id) {
      setCrmSendMsg("⚠️ Primero abre una ficha de cliente");
      return;
    }

    if (!crmTarotistaSendId) {
      setCrmSendMsg("⚠️ Selecciona una tarotista");
      return;
    }

    try {
      setCrmSendLoading(true);
      setCrmSendMsg("");

      const token = await getTokenOrLogin();
      if (!token) return;

      const tarotistaSel =
        crmTarotistasOpts.find((t: any) => String(t.id) === String(crmTarotistaSendId)) || null;

      const payload = {
        tarotista_worker_id: String(tarotistaSel?.id || crmTarotistaSendId || "").trim(),
        display_name: String(tarotistaSel?.display_name || "").trim(),
        cliente_id: String(crmClienteFicha?.id || crmClienteSelId || "").trim(),
        telefono: crmEditTelefono.trim(),
        nombre: crmEditNombre.trim(),
        apellido: crmEditApellido.trim(),
        minutos_free_pendientes:
          Number(String(crmSendMinFree).replace(",", ".")) || 0,
        minutos_normales_pendientes:
          Number(String(crmSendMinNormales).replace(",", ".")) || 0,
      };

      const r = await fetch("/api/crm/call-popups/enviar", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const j = await safeJson(r);

      if (!j?._ok || !j?.ok) {
        const extra =
          j?.tarotista_worker_raw ||
          j?.cliente_id_raw ||
          (j?.debug ? JSON.stringify(j.debug) : "") ||
          (j?.workers_debug ? JSON.stringify(j.workers_debug) : "") ||
          "";
        throw new Error([j?.error || `HTTP ${j?._status || r.status}`, extra].filter(Boolean).join(" · "));
      }

      const tarotistaNombre = tarotistaSel?.display_name || "la tarotista";

      setCrmSendMsg(`✅ Llamada enviada a ${tarotistaNombre}`);
    } catch (e: any) {
      setCrmSendMsg(`❌ ${e?.message || "Error enviando llamada"}`);
    } finally {
      setCrmSendLoading(false);
    }
  }

  async function crearPagoManual() {
    if (!crmClienteSelId && !crmClienteFicha?.id) {
      setCrmPagoMsg("⚠️ Primero abre una ficha de cliente");
      return;
    }

    const importe = Number(String(crmPagoImporte).replace(",", "."));
    if (!importe || importe <= 0) {
      setCrmPagoMsg("⚠️ Introduce un importe válido");
      return;
    }

    try {
      setCrmPagoLoading(true);
      setCrmPagoMsg("");

      const clienteId = String(crmClienteFicha?.id || crmClienteSelId || "").trim();

      try {
        sessionStorage.setItem(
          "crm_pago_paypal_draft",
          JSON.stringify({
            cliente_id: clienteId,
            importe,
            notas: crmPagoNotas.trim(),
            referencia_externa: crmPagoReferencia.trim(),
            ts: Date.now(),
          })
        );
      } catch {}

      const url = "https://www.paypal.com/virtualterminal/launch?source=appcenter";
      setCrmPagoPendienteConfirmacion(true);
      window.open(url, "_blank", "noopener,noreferrer");

      setCrmPagoMsg(
        "✅ TPV PayPal abierto. Cuando termines el intento de cobro, vuelve a esta ficha y usa 'Confirmar pago' o 'Pago erróneo'."
      );
    } catch (e: any) {
      setCrmPagoMsg(`❌ ${e?.message || "Error abriendo TPV PayPal"}`);
    } finally {
      setCrmPagoLoading(false);
    }
  }

  async function confirmarPagoManual() {
    if (!crmClienteSelId && !crmClienteFicha?.id) {
      setCrmPagoMsg("⚠️ Primero abre una ficha de cliente");
      return;
    }

    const importe = Number(String(crmPagoImporte).replace(",", "."));
    if (!importe || importe <= 0) {
      setCrmPagoMsg("⚠️ Introduce un importe válido");
      return;
    }

    if (!crmPagoReferencia.trim()) {
      setCrmPagoMsg("⚠️ Pega la referencia de PayPal antes de confirmar");
      return;
    }

    try {
      setCrmPagoLoading(true);
      setCrmPagoMsg("");

      const token = await getTokenOrLogin();
      if (!token) return;

      const clienteId = String(crmClienteFicha?.id || crmClienteSelId || "").trim();

      const r = await fetch("/api/crm/pagos/crear", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          cliente_id: clienteId,
          importe,
          moneda: "EUR",
          metodo: "paypal_manual",
          estado: "completed",
          referencia_externa: crmPagoReferencia.trim(),
          notas: crmPagoNotas.trim(),
        }),
      });

      const j = await safeJson(r);

      if (!j?._ok || !j?.ok) {
        throw new Error(j?.error || `HTTP ${j?._status || r.status}`);
      }

      try {
        const raw = sessionStorage.getItem("crm_pago_paypal_draft");
        if (raw) {
          const draft = JSON.parse(raw);
          if (String(draft?.cliente_id || "") === String(clienteId)) {
            sessionStorage.removeItem("crm_pago_paypal_draft");
          }
        }
      } catch {}

      setCrmPagoMsg("✅ Pago registrado correctamente");
      setCrmPagoPendienteConfirmacion(false);
      setCrmPagoImporte("");
      setCrmPagoNotas("");
      setCrmPagoReferencia("");
      await loadPagosCliente(clienteId);
    } catch (e: any) {
      setCrmPagoMsg(`❌ ${e?.message || "Error confirmando pago"}`);
    } finally {
      setCrmPagoLoading(false);
    }
  }

  async function marcarPagoErroneo() {
    if (!crmClienteSelId && !crmClienteFicha?.id) {
      setCrmPagoMsg("⚠️ Primero abre una ficha de cliente");
      return;
    }

    const importe = Number(String(crmPagoImporte).replace(",", "."));
    if (!importe || importe <= 0) {
      setCrmPagoMsg("⚠️ Introduce un importe válido");
      return;
    }

    try {
      setCrmPagoLoading(true);
      setCrmPagoMsg("");

      const token = await getTokenOrLogin();
      if (!token) return;

      const clienteId = String(crmClienteFicha?.id || crmClienteSelId || "").trim();

      const r = await fetch("/api/crm/pagos/crear", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          cliente_id: clienteId,
          importe,
          moneda: "EUR",
          metodo: "paypal_manual",
          estado: "failed",
          referencia_externa: crmPagoReferencia.trim(),
          notas: crmPagoNotas.trim() || "Pago erróneo / no completado",
        }),
      });

      const j = await safeJson(r);

      if (!j?._ok || !j?.ok) {
        throw new Error(j?.error || `HTTP ${j?._status || r.status}`);
      }

      try {
        const raw = sessionStorage.getItem("crm_pago_paypal_draft");
        if (raw) {
          const draft = JSON.parse(raw);
          if (String(draft?.cliente_id || "") === String(clienteId)) {
            sessionStorage.removeItem("crm_pago_paypal_draft");
          }
        }
      } catch {}

      setCrmPagoMsg("✅ Pago marcado como erróneo");
      setCrmPagoPendienteConfirmacion(false);
      setCrmPagoImporte("");
      setCrmPagoNotas("");
      setCrmPagoReferencia("");
      await loadPagosCliente(clienteId);
    } catch (e: any) {
      setCrmPagoMsg(`❌ ${e?.message || "Error marcando pago erróneo"}`);
    } finally {
      setCrmPagoLoading(false);
    }
  }

  const crmWebSummary = (() => {
    const rows = crmRows || [];
    const registered = rows.filter((row: any) => clientWebMeta(row).registered).length;
    const onboardingPending = rows.filter((row: any) => {
      const meta = clientWebMeta(row);
      return meta.registered && !meta.onboardingDone;
    }).length;
    return {
      total: rows.length,
      registered,
      notRegistered: Math.max(0, rows.length - registered),
      onboardingPending,
    };
  })();

  const visibleNotes = crmNotesExpanded ? crmNotes : crmNotes.slice(0, 3);

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <div
        className="tc-card"
        style={{
          padding: 22,
          borderRadius: 24,
          background:
            "radial-gradient(circle at top right, rgba(181,156,255,.18), transparent 26%), radial-gradient(circle at top left, rgba(215,181,109,.12), transparent 22%), linear-gradient(180deg, rgba(255,255,255,.07), rgba(255,255,255,.03))",
        }}
      >
        <div className="tc-row" style={{ justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
          <div>
            <div className="tc-title" style={{ fontSize: 24 }}>👥 CRM Operativo</div>
            <div className="tc-sub" style={{ marginTop: 8, maxWidth: 760 }}>
              Búsqueda, ficha, pagos, reservas, notas y etiquetas en una vista de trabajo premium.
            </div>
          </div>

          <div className="tc-row" style={{ gap: 8, flexWrap: "wrap" }}>
            <span className="tc-chip">Modo: {mode}</span>
            <span className="tc-chip">Resultados: {crmRows.length}</span>
            {crmClienteSelId ? <span className="tc-chip">Cliente activo</span> : null}
          </div>
        </div>
      </div>
<div
        className="tc-card"
        style={{
          borderRadius: 22,
          border: "1px solid rgba(255,215,120,.16)",
          background:
            "radial-gradient(circle at top right, rgba(255,215,120,.16), transparent 24%), linear-gradient(180deg, rgba(255,255,255,.05), rgba(255,255,255,.025))",
        }}
      >
        <div className="tc-row" style={{ justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
          <div>
            <div className="tc-title">🏅 Rangos dinámicos de clientes</div>
            <div className="tc-sub" style={{ marginTop: 6, maxWidth: 820 }}>
              El rango se calcula con el gasto acumulado de los últimos 30 días. Bronce con cualquier compra, Plata desde 100€ y Oro desde 500€.
            </div>
          </div>

          <div className="tc-row" style={{ gap: 8, flexWrap: "wrap" }}>
            <button className="tc-btn" onClick={() => loadRankSummary(false)} disabled={crmRankLoading}>
              {crmRankLoading ? "Cargando…" : "Actualizar rangos"}
            </button>
            <button className="tc-btn tc-btn-gold" onClick={recalculateClientRanks} disabled={crmRankLoading}>
              {crmRankLoading ? "Recalculando…" : "Recalcular ahora"}
            </button>
          </div>
        </div>

        <div className="tc-grid-4" style={{ marginTop: 14 }}>
          <button
            type="button"
            className="tc-chip"
            onClick={() => openRankClients("bronce")}
            style={{ justifyContent: "space-between", padding: "14px 16px", display: "flex", width: "100%", textAlign: "left", cursor: "pointer", background: crmRankFilter === "bronce" ? "rgba(214,156,110,.24)" : "rgba(214,156,110,.12)", border: crmRankFilter === "bronce" ? "1px solid rgba(214,156,110,.46)" : "1px solid rgba(214,156,110,.22)" }}
          >
            <span>🥉 Bronce</span><b>{Number(crmRankSummary?.bronce || 0)}</b>
          </button>
          <button
            type="button"
            className="tc-chip"
            onClick={() => openRankClients("plata")}
            style={{ justifyContent: "space-between", padding: "14px 16px", display: "flex", width: "100%", textAlign: "left", cursor: "pointer", background: crmRankFilter === "plata" ? "rgba(196,210,255,.24)" : "rgba(196,210,255,.12)", border: crmRankFilter === "plata" ? "1px solid rgba(196,210,255,.46)" : "1px solid rgba(196,210,255,.22)" }}
          >
            <span>🥈 Plata</span><b>{Number(crmRankSummary?.plata || 0)}</b>
          </button>
          <button
            type="button"
            className="tc-chip"
            onClick={() => openRankClients("oro")}
            style={{ justifyContent: "space-between", padding: "14px 16px", display: "flex", width: "100%", textAlign: "left", cursor: "pointer", background: crmRankFilter === "oro" ? "rgba(255,215,120,.24)" : "rgba(255,215,120,.12)", border: crmRankFilter === "oro" ? "1px solid rgba(255,215,120,.46)" : "1px solid rgba(255,215,120,.22)" }}
          >
            <span>🥇 Oro</span><b>{Number(crmRankSummary?.oro || 0)}</b>
          </button>
          <div className="tc-chip" style={{ justifyContent: "space-between", padding: "14px 16px", display: "flex", background: "rgba(181,156,255,.12)", border: "1px solid rgba(181,156,255,.22)" }}><span>Total con rango</span><b>{Number(crmRankSummary?.totalConRango || 0)}</b></div>
        </div>

        <div className="tc-sub" style={{ marginTop: 12 }}>{crmRankMsg || "Puedes recalcular manualmente para forzar una foto inmediata basada en los últimos 30 días."}</div>
      </div>

      <div className="crm-master-detail">
        <div style={{ display: "grid", gap: 16 }}>
      <div className="tc-card">
        <div className="tc-row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
          <div>
            <div className="tc-title">👥 CRM</div>
            <div className="tc-sub">
              Busca clientes por nombre, teléfono, país o etiqueta y detecta quién ya usa la web
            </div>
          </div>

          <div className="tc-row" style={{ gap: 8, flexWrap: "wrap" }}>
            <button className="tc-btn" onClick={clearCRMFilters} disabled={crmLoading || crmImportLoading}>
              Limpiar filtros
            </button>

            {showImportButton ? (
              <button className="tc-btn tc-btn-gold" onClick={importCRM} disabled={crmImportLoading}>
                {crmImportLoading ? "Importando…" : "Importar CRM"}
              </button>
            ) : null}
          </div>
        </div>

        <div className="tc-hr" />

        <div className="tc-grid-4">
          <div>
            <div className="tc-sub">Nombre / búsqueda general</div>
            <input className="tc-input" value={crmQuery} onChange={(e) => setCrmQuery(e.target.value)} placeholder="María, Ana, etc." style={{ width: "100%", marginTop: 6 }} onKeyDown={(e) => { if (e.key === "Enter") searchCRM(); }} />
          </div>

          <div>
            <div className="tc-sub">Teléfono</div>
            <input className="tc-input" value={crmPhoneFilter} onChange={(e) => setCrmPhoneFilter(e.target.value)} placeholder="600123123" style={{ width: "100%", marginTop: 6 }} onKeyDown={(e) => { if (e.key === "Enter") searchCRM(); }} />
          </div>

          <div>
            <div className="tc-sub">Etiqueta</div>
            <select
              className="tc-input"
              value={crmTagFilter}
              onChange={(e) => setCrmTagFilter(e.target.value)}
              style={{ width: "100%", marginTop: 6, colorScheme: "dark", background: "rgba(17,24,39,.96)", color: "#fff", border: "1px solid rgba(255,255,255,.12)" }}
            >
              <option value="">
                {crmEtiquetasLoading ? "Cargando etiquetas..." : "Todas las etiquetas"}
              </option>
              {crmEtiquetasOpts.map((et: any) => (
                <option key={et.id} value={et.nombre}>
                  {et.nombre}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div className="tc-sub">País</div>
            <input className="tc-input" value={crmCountryFilter} onChange={(e) => setCrmCountryFilter(e.target.value)} placeholder="España, México..." style={{ width: "100%", marginTop: 6 }} onKeyDown={(e) => { if (e.key === "Enter") searchCRM(); }} />
          </div>
        </div>

        <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 10 }}>
          <KpiCard title="Clientes cargados" value={String(crmWebSummary.total)} hint="Base visible en CRM" accent="rgba(181,156,255,.75)" />
          <KpiCard title="Registrados web" value={String(crmWebSummary.registered)} hint="Han entrado al panel" accent="rgba(34,197,94,.75)" active={crmWebFilter === "registrados"} onClick={() => setCrmWebFilter((v) => v === "registrados" ? "todos" : "registrados")} />
          <KpiCard title="No registrados" value={String(crmWebSummary.notRegistered)} hint="Clientes a insistir" accent="rgba(239,68,68,.75)" active={crmWebFilter === "no_registrados"} onClick={() => setCrmWebFilter((v) => v === "no_registrados" ? "todos" : "no_registrados")} />
          <KpiCard title="Onboarding pendiente" value={String(crmWebSummary.onboardingPending)} hint="Entraron pero no cerraron" accent="rgba(245,158,11,.75)" active={crmWebFilter === "onboarding_pendiente"} onClick={() => setCrmWebFilter((v) => v === "onboarding_pendiente" ? "todos" : "onboarding_pendiente")} />
        </div>

        <div className="tc-row" style={{ gap: 8, flexWrap: "wrap", marginTop: 12 }}>
          <button className={`tc-btn ${crmWebFilter === "todos" ? "tc-btn-gold" : ""}`} onClick={() => setCrmWebFilter("todos")}>Todos</button>
          <button className={`tc-btn ${crmWebFilter === "registrados" ? "tc-btn-gold" : ""}`} onClick={() => setCrmWebFilter("registrados")}>Registrados web</button>
          <button className={`tc-btn ${crmWebFilter === "no_registrados" ? "tc-btn-gold" : ""}`} onClick={() => setCrmWebFilter("no_registrados")}>No registrados</button>
          <button className={`tc-btn ${crmWebFilter === "onboarding_pendiente" ? "tc-btn-gold" : ""}`} onClick={() => setCrmWebFilter("onboarding_pendiente")}>Onboarding pendiente</button>
        </div>

        <div className="tc-row" style={{ justifyContent: "flex-end", marginTop: 12 }}>
          <button className="tc-btn tc-btn-gold" onClick={() => searchCRM()} disabled={crmLoading}>
            {crmLoading ? "Cargando…" : "Cargar CRM"}
          </button>
        </div>

        <div className="tc-hr" />
        <div className="tc-sub">{crmMsg || " "}</div>
      </div>

      <div className="tc-card">
        <div className="tc-row" style={{ justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div>
            <div className="tc-title">➕ Nuevo cliente</div>
            <div className="tc-sub" style={{ marginTop: 6 }}>
              Alta manual rápida desde el panel {mode}
            </div>
          </div>

          <button
            className={`tc-btn ${mostrarNuevoCliente ? "" : "tc-btn-gold"}`}
            onClick={() => setMostrarNuevoCliente((v) => !v)}
          >
            {mostrarNuevoCliente ? "Ocultar formulario" : "+ Nuevo cliente"}
          </button>
        </div>

        {mostrarNuevoCliente ? (
          <>
            <div className="tc-hr" />

            <div
              style={{
                border: "1px solid rgba(255,255,255,.08)",
                borderRadius: 14,
                padding: 14,
                background: "rgba(255,255,255,.02)",
              }}
            >
              <div className="tc-grid-4">
                <div><div className="tc-sub">Nombre</div><input className="tc-input" value={crmNewNombre} onChange={(e) => setCrmNewNombre(e.target.value)} placeholder="Nombre" style={{ width: "100%", marginTop: 6 }} /></div>
                <div><div className="tc-sub">Apellido</div><input className="tc-input" value={crmNewApellido} onChange={(e) => setCrmNewApellido(e.target.value)} placeholder="Apellido" style={{ width: "100%", marginTop: 6 }} /></div>
                <div><div className="tc-sub">Teléfono</div><input className="tc-input" value={crmNewTelefono} onChange={(e) => setCrmNewTelefono(e.target.value)} placeholder="600123123" style={{ width: "100%", marginTop: 6 }} /></div>
                <div><div className="tc-sub">País</div><input className="tc-input" value={crmNewPais} onChange={(e) => setCrmNewPais(e.target.value)} placeholder="España" style={{ width: "100%", marginTop: 6 }} /></div>
                <div><div className="tc-sub">Email</div><input className="tc-input" value={crmNewEmail} onChange={(e) => setCrmNewEmail(e.target.value)} placeholder="cliente@email.com" style={{ width: "100%", marginTop: 6 }} /></div>
                <div><div className="tc-sub">Origen</div><input className="tc-input" value={crmNewOrigen} onChange={(e) => setCrmNewOrigen(e.target.value)} placeholder="manual" style={{ width: "100%", marginTop: 6 }} /></div>
                <div><div className="tc-sub">Deuda</div><input className="tc-input" value={crmNewDeuda} onChange={(e) => setCrmNewDeuda(e.target.value)} placeholder="0" style={{ width: "100%", marginTop: 6 }} /></div>
                <div><div className="tc-sub">Min free</div><input className="tc-input" value={crmNewMinFree} onChange={(e) => setCrmNewMinFree(e.target.value)} placeholder="0" style={{ width: "100%", marginTop: 6 }} /></div>
              </div>

              <div className="tc-grid-2" style={{ marginTop: 12 }}>
                <div><div className="tc-sub">Min normales</div><input className="tc-input" value={crmNewMinNormales} onChange={(e) => setCrmNewMinNormales(e.target.value)} placeholder="0" style={{ width: "100%", marginTop: 6 }} /></div>
                <div><div className="tc-sub">Notas</div><input className="tc-input" value={crmNewNotas} onChange={(e) => setCrmNewNotas(e.target.value)} placeholder="Notas internas" style={{ width: "100%", marginTop: 6 }} /></div>
              </div>

                            <div style={{ marginTop: 12 }}>
                <div className="tc-sub">Etiquetas</div>

                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                  {crmNewEtiquetasSel.map((id: any) => {
                    const et = crmEtiquetasOpts.find((e: any) => String(e.id) === String(id));
                    if (!et) return null;
                    return (
                      <span key={id} className="tc-chip">
                        {et.nombre}
                        <button
                          type="button"
                          onClick={() => setCrmNewEtiquetasSel((prev) => prev.filter((x) => String(x) !== String(id)))}
                        >
                          ✕
                        </button>
                      </span>
                    );
                  })}
                </div>

                <div className="tc-row" style={{ marginTop: 8, gap: 8, flexWrap: "wrap" }}>
                  <button className="tc-btn" type="button" onClick={() => openEtiquetasModal("nuevo")}>
                    Seleccionar / crear etiquetas
                  </button>
                </div>
              </div>

<div className="tc-row" style={{ justifyContent: "flex-end", marginTop: 12, gap: 8, flexWrap: "wrap" }}>
                <button className="tc-btn" onClick={() => setMostrarNuevoCliente(false)} disabled={crmCreateLoading}>
                  Cancelar
                </button>
                <button className="tc-btn tc-btn-ok" onClick={createCRMClient} disabled={crmCreateLoading}>
                  {crmCreateLoading ? "Creando..." : "Crear cliente"}
                </button>
              </div>

              <div className="tc-sub" style={{ marginTop: 10 }}>{crmCreateMsg || " "}</div>
            </div>
          </>
        ) : (
          <div className="tc-sub" style={{ marginTop: 12 }}>
            Pulsa <b>+ Nuevo cliente</b> para desplegar el formulario de alta.
          </div>
        )}
      </div>

        </div>

        <div style={{ display: "grid", gap: 16 }}>

      {(crmFichaLoading || crmClienteFicha) && (
        <div className="tc-card" style={{ marginTop: 12 }}>
          <div className="tc-row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div className="tc-title">🧾 Ficha CRM</div>
              <div className="tc-sub" style={{ marginTop: 6 }}>
                {crmFichaLoading ? "Cargando ficha del cliente..." : `Editando cliente #${crmClienteSelId || crmClienteFicha?.id || ""}`}
              </div>
            </div>

            {!crmFichaLoading && <button className="tc-btn" onClick={closeCRMFicha}>Cerrar ficha</button>}
          </div>

          <div className="tc-hr" />

          {crmFichaLoading ? (
            <div className="tc-sub">Cargando ficha...</div>
          ) : (
            <>
              <div className="tc-grid-4">
                <div><div className="tc-sub">Nombre</div><input className="tc-input" value={crmEditNombre} onChange={(e) => setCrmEditNombre(e.target.value)} placeholder="Nombre" style={{ width: "100%", marginTop: 6 }} /></div>
                <div><div className="tc-sub">Apellido</div><input className="tc-input" value={crmEditApellido} onChange={(e) => setCrmEditApellido(e.target.value)} placeholder="Apellido" style={{ width: "100%", marginTop: 6 }} /></div>
                <div><div className="tc-sub">Teléfono</div><input className="tc-input" value={crmEditTelefono} onChange={(e) => setCrmEditTelefono(e.target.value)} placeholder="600123123" style={{ width: "100%", marginTop: 6 }} /></div>
                <div><div className="tc-sub">País</div><input className="tc-input" value={crmEditPais} onChange={(e) => setCrmEditPais(e.target.value)} placeholder="España" style={{ width: "100%", marginTop: 6 }} /></div>
                <div><div className="tc-sub">Email</div><input className="tc-input" value={crmEditEmail} onChange={(e) => setCrmEditEmail(e.target.value)} placeholder="cliente@email.com" style={{ width: "100%", marginTop: 6 }} /></div>
                <div><div className="tc-sub">Origen</div><input className="tc-input" value={crmEditOrigen} onChange={(e) => setCrmEditOrigen(e.target.value)} placeholder="manual" style={{ width: "100%", marginTop: 6 }} /></div>
                <div><div className="tc-sub">Deuda pendiente</div><input className="tc-input" value={crmEditDeuda} onChange={(e) => setCrmEditDeuda(e.target.value)} placeholder="0" style={{ width: "100%", marginTop: 6 }} /></div>
                <div><div className="tc-sub">Min free pendientes</div><input className="tc-input" value={crmEditMinFree} onChange={(e) => setCrmEditMinFree(e.target.value)} placeholder="0" style={{ width: "100%", marginTop: 6 }} /></div>
              </div>

              <div className="tc-grid-2" style={{ marginTop: 12 }}>
                <div><div className="tc-sub">Min normales pendientes</div><input className="tc-input" value={crmEditMinNormales} onChange={(e) => setCrmEditMinNormales(e.target.value)} placeholder="0" style={{ width: "100%", marginTop: 6 }} /></div>
                <div><div className="tc-sub">Resumen interno</div><div className="tc-sub" style={{ marginTop: 10 }}>Las notas con autor están justo debajo.</div></div>
              </div>

                            <div className="tc-card" style={{ marginTop: 12 }}>
                <div className="tc-sub">Etiquetas cliente</div>

                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                  {crmClienteEtiquetasSel.map((id: any) => {
                    const et = crmEtiquetasOpts.find((e: any) => String(e.id) === String(id));
                    if (!et) return null;
                    return (
                      <span key={id} className="tc-chip">
                        {et.nombre}
                        <button
                          type="button"
                          onClick={() => setCrmClienteEtiquetasSel((prev) => prev.filter((x) => String(x) !== String(id)))}
                        >
                          ✕
                        </button>
                      </span>
                    );
                  })}
                </div>

                <div className="tc-row" style={{ marginTop: 8, gap: 8, flexWrap: "wrap" }}>
                  <button className="tc-btn" type="button" onClick={() => openEtiquetasModal("ficha")}>
                    Seleccionar / crear etiquetas
                  </button>
                </div>
              </div>

<div className="tc-card" style={{ marginTop: 14, borderRadius: 18, padding: 16, background: "rgba(255,255,255,.03)" }}>
                <div className="tc-row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <div>
                    <div className="tc-title" style={{ fontSize: 16 }}>📝 Historial de notas</div>
                    <div className="tc-sub" style={{ marginTop: 6 }}>
                      Cada nota guarda quién la escribió y cuándo. Las ancladas se quedan arriba.
                    </div>
                  </div>
                </div>

                <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                  <div className="tc-row" style={{ justifyContent: "space-between", gap: 8 }}>
                    <div className="tc-sub">Usa <b>**texto**</b> para negrita o pulsa el botón.</div>
                    <button type="button" className="tc-btn" onClick={applyBoldToNewNote}>Negrita</button>
                  </div>
                  <textarea
                    ref={crmNewNoteRef}
                    className="tc-input"
                    value={crmNewNote}
                    onChange={(e) => setCrmNewNote(e.target.value)}
                    placeholder="Escribe una nueva nota del cliente..."
                    style={{ width: "100%", minHeight: 120, lineHeight: 1.45 }}
                  />
                  <div className="tc-row" style={{ justifyContent: "flex-end", gap: 8 }}>
                    <button className="tc-btn tc-btn-gold" onClick={createCRMNote} disabled={crmSavingNote || !crmClienteSelId}>
                      {crmSavingNote ? "Guardando nota..." : "Guardar nota"}
                    </button>
                  </div>
                  <div className="tc-sub">{crmNotesMsg || " "}</div>
                </div>

                <div className="tc-hr" />

                <div style={{ display: "grid", gap: 10 }}>
                  {crmNotesLoading ? (
                    <div className="tc-sub">Cargando notas...</div>
                  ) : crmNotes.length === 0 ? (
                    <div className="tc-sub">Todavía no hay notas registradas para este cliente.</div>
                  ) : (
                    visibleNotes.map((n: any) => {
                      const tone = crmNoteTone(n.texto || "");
                      return (
                      <div
                        key={n.id}
                        style={{
                          border: n?.is_pinned ? "1px solid rgba(215,181,109,.26)" : tone.border,
                          borderRadius: 14,
                          padding: 12,
                          background: n?.is_pinned ? "linear-gradient(135deg, rgba(215,181,109,.10), rgba(255,255,255,.025))" : tone.bg,
                          boxShadow: n?.is_pinned ? "0 10px 26px rgba(0,0,0,.16)" : "none",
                        }}
                      >
                        <div className="tc-row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                          <div className="tc-row" style={{ gap: 8, flexWrap: "wrap" }}>
                            <div style={{ fontWeight: 800 }}>{n.author_name || n.author_email || "Usuario"}</div>
                            <span className="tc-chip" style={{ border: tone.border, background: tone.bg, color: tone.color }}>{tone.chip}</span>
                            {n?.is_pinned ? (
                              <span className="tc-chip" style={{ background: "rgba(215,181,109,.14)", border: "1px solid rgba(215,181,109,.22)" }}>📌 Anclada</span>
                            ) : null}
                          </div>
                          <div className="tc-sub">
                            {n.created_at ? new Date(n.created_at).toLocaleString("es-ES") : "—"}
                          </div>
                        </div>
                        {!!n.author_email && (
                          <div className="tc-sub" style={{ marginTop: 4 }}>{n.author_email}</div>
                        )}

                        {crmEditingNoteId === String(n.id) ? (
                          <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                            <div className="tc-row" style={{ justifyContent: "space-between", gap: 8 }}>
                              <div className="tc-sub">Usa <b>**texto**</b> para negrita o pulsa el botón.</div>
                              <button type="button" className="tc-btn" onClick={applyBoldToEditingNote}>Negrita</button>
                            </div>
                            <textarea
                              ref={crmEditNoteRef}
                              className="tc-input"
                              value={crmEditingNoteText}
                              onChange={(e) => setCrmEditingNoteText(e.target.value)}
                              style={{ width: "100%", minHeight: 120, lineHeight: 1.45 }}
                            />
                            <div className="tc-row" style={{ justifyContent: "flex-end", gap: 8 }}>
                              <button className="tc-btn" onClick={cancelEditCRMNote} disabled={crmUpdatingNote}>Cancelar</button>
                              <button className="tc-btn tc-btn-ok" onClick={() => updateCRMNote(String(n.id))} disabled={crmUpdatingNote}>
                                {crmUpdatingNote ? "Guardando..." : "Guardar"}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div style={{ marginTop: 8, whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
                            {renderNoteText(n.texto || "—")}
                          </div>
                        )}

                        <div className="tc-row" style={{ justifyContent: "flex-end", gap: 8, marginTop: 10 }}>
                          <button
                            className="tc-btn"
                            onClick={() => togglePinCRMNote(n)}
                            disabled={crmPinningNoteId === String(n.id) || crmEditingNoteId === String(n.id)}
                          >
                            {crmPinningNoteId === String(n.id) ? "Guardando..." : n?.is_pinned ? "Desanclar" : "Anclar"}
                          </button>
                          {crmEditingNoteId !== String(n.id) ? (
                            <button className="tc-btn" onClick={() => startEditCRMNote(n)}>
                              Editar
                            </button>
                          ) : null}
                        </div>
                      </div>
                    );
                    })
                  )}
                </div>
                {crmNotes.length > 3 ? (
                  <div className="tc-row" style={{ justifyContent: "flex-end", marginTop: 12 }}>
                    <button className="tc-btn" onClick={() => setCrmNotesExpanded((v) => !v)}>
                      {crmNotesExpanded ? "Ver menos notas" : `Ver las demás notas (${crmNotes.length - 3})`}
                    </button>
                  </div>
                ) : null}
              </div>

              <div id="crm-reserva-card" className="tc-card" style={{ marginTop: 14, borderRadius: 18, padding: 16, background: "rgba(255,255,255,.03)" }}>
                <div className="tc-title" style={{ fontSize: 16 }}>📅 Reservar tarotista</div>
                <div className="tc-sub" style={{ marginTop: 6 }}>
                  Crea una reserva para esta clienta y aparecerá automáticamente en la pestaña Reservas.
                </div>

                <div className="tc-grid-2" style={{ marginTop: 12 }}>
                  <div>
                    <div className="tc-sub">Tarotista</div>
                    <select
                      className="tc-input"
                      value={crmReservaTarotistaId}
                      onChange={(e) => setCrmReservaTarotistaId(e.target.value)}
                      style={{ width: "100%", marginTop: 6, colorScheme: "dark" }}
                    >
                      <option value="">
                        {crmTarotistasLoading ? "Cargando tarotistas..." : "Selecciona tarotista"}
                      </option>
                      {crmTarotistasOpts.map((t: any) => (
                        <option key={t.id} value={t.id}>
                          {t.display_name || t.id}
                          {t.state ? ` · ${t.state}` : ""}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <div className="tc-sub">O nombre manual</div>
                    <input
                      className="tc-input"
                      value={crmReservaTarotistaManual}
                      onChange={(e) => setCrmReservaTarotistaManual(e.target.value)}
                      placeholder="Escribe el nombre si no está en la lista"
                      style={{ width: "100%", marginTop: 6 }}
                    />
                  </div>
                </div>

                <div className="tc-grid-2" style={{ marginTop: 12 }}>
                  <div>
                    <div className="tc-sub">Fecha y hora</div>
                    <input
                      className="tc-input"
                      type="datetime-local"
                      value={crmReservaFecha}
                      onChange={(e) => setCrmReservaFecha(e.target.value)}
                      style={{ width: "100%", marginTop: 6 }}
                    />
                  </div>

                  <div>
                    <div className="tc-sub">Nota</div>
                    <input
                      className="tc-input"
                      value={crmReservaNota}
                      onChange={(e) => setCrmReservaNota(e.target.value)}
                      placeholder="Observación opcional"
                      style={{ width: "100%", marginTop: 6 }}
                    />
                  </div>
                </div>

                <div className="tc-row" style={{ justifyContent: "flex-end", marginTop: 12 }}>
                  <button
                    className="tc-btn tc-btn-gold"
                    onClick={crearReservaCRM}
                    disabled={crmReservaLoading || !crmClienteSelId}
                  >
                    {crmReservaLoading ? "Creando..." : "Crear reserva"}
                  </button>
                </div>

                <div className="tc-sub" style={{ marginTop: 10 }}>
                  {crmReservaMsg || " "}
                </div>
              </div>

              <div id="crm-rendimiento-card" className="tc-card" style={{ marginTop: 14, borderRadius: 18, padding: 16, background: "rgba(255,255,255,.03)" }}>
                <div className="tc-title" style={{ fontSize: 16 }}>📞 Registrar llamada</div>
                <div className="tc-sub" style={{ marginTop: 6 }}>
                  Sustituye el antiguo registro de pago. El wizard guardará la línea en Rendimiento, dejará una nota automática en CRM y actualizará los minutos pendientes de la clienta.
                </div>

                <div className="tc-grid-2" style={{ marginTop: 12 }}>
                  <div>
                    <div className="tc-sub">Cliente</div>
                    <div className="tc-sub" style={{ marginTop: 8 }}>{[crmClienteFicha?.nombre, crmClienteFicha?.apellido].filter(Boolean).join(" ") || "—"}</div>
                  </div>
                  <div>
                    <div className="tc-sub">Pendiente en CRM</div>
                    <div className="tc-sub" style={{ marginTop: 8 }}>
                      {Number(String(crmEditMinFree).replace(",", ".")) || 0} free · {Number(String(crmEditMinNormales).replace(",", ".")) || 0} normales
                    </div>
                  </div>
                </div>

                <div className="tc-row" style={{ justifyContent: "space-between", marginTop: 12, gap: 8, flexWrap: "wrap" }}>
                  <div className="tc-sub">ID cliente: {crmClienteFicha?.id || crmClienteSelId || "—"}</div>
                  <div className="tc-row" style={{ gap: 8, flexWrap: "wrap" }}>
                    {rankChip(crmClienteFicha?.rango_actual)}
                    <button
                      className="tc-btn"
                      onClick={() => sendNumberToSoftphone(String(crmClienteFicha?.telefono || crmEditTelefono || ""), false, {
                        cliente_id: String(crmClienteFicha?.id || crmClienteSelId || ""),
                        telefono: String(crmClienteFicha?.telefono || crmEditTelefono || ""),
                        nombre: String(crmClienteFicha?.nombre || crmEditNombre || ""),
                        apellido: String(crmClienteFicha?.apellido || crmEditApellido || ""),
                        minutos_free_pendientes: Number(String(crmSendMinFree).replace(",", ".")) || 0,
                        minutos_normales_pendientes: Number(String(crmSendMinNormales).replace(",", ".")) || 0,
                        tarotista_worker_id: String(crmTarotistaSendId || ""),
                        tarotista_nombre: String((crmTarotistasOpts.find((t: any) => String(t.id) === String(crmTarotistaSendId))?.display_name) || ""),
                      })}
                      disabled={!normalizeDialPhone(String(crmClienteFicha?.telefono || crmEditTelefono || ""))}
                    >
                      Enviar al softphone
                    </button>
                    <button
                      className="tc-btn tc-btn-gold"
                      onClick={() => sendNumberToSoftphone(String(crmClienteFicha?.telefono || crmEditTelefono || ""), true, {
                        cliente_id: String(crmClienteFicha?.id || crmClienteSelId || ""),
                        telefono: String(crmClienteFicha?.telefono || crmEditTelefono || ""),
                        nombre: String(crmClienteFicha?.nombre || crmEditNombre || ""),
                        apellido: String(crmClienteFicha?.apellido || crmEditApellido || ""),
                        minutos_free_pendientes: Number(String(crmSendMinFree).replace(",", ".")) || 0,
                        minutos_normales_pendientes: Number(String(crmSendMinNormales).replace(",", ".")) || 0,
                        tarotista_worker_id: String(crmTarotistaSendId || ""),
                        tarotista_nombre: String((crmTarotistasOpts.find((t: any) => String(t.id) === String(crmTarotistaSendId))?.display_name) || ""),
                      })}
                      disabled={!normalizeDialPhone(String(crmClienteFicha?.telefono || crmEditTelefono || ""))}
                    >
                      Llamar ahora
                    </button>
                    <button className="tc-btn tc-btn-gold" onClick={() => setCrmRegistrarOpen(true)} disabled={!crmClienteSelId && !crmClienteFicha?.id}>
                      Registrar llamada
                    </button>
                  </div>
                </div>
              </div>

              <div className="tc-card" style={{ marginTop: 14, borderRadius: 18, padding: 16, background: rankMeta(crmClienteFicha?.rango_actual).cardBg, border: rankMeta(crmClienteFicha?.rango_actual).cardBorder }}>
                <div className="tc-row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <div>
                    <div className="tc-title" style={{ fontSize: 16 }}>🏅 Rango mensual del cliente</div>
                    <div className="tc-sub" style={{ marginTop: 6 }}>
                      Se calcula con el gasto acumulado en los últimos 30 días.
                    </div>
                  </div>
                  {rankChip(crmClienteFicha?.rango_actual)}
                </div>

                <div className="tc-grid-4" style={{ marginTop: 12 }}>
                  <div><div className="tc-sub">Gasto 30 días</div><div style={{ fontWeight: 900, marginTop: 6 }}>{eur(crmClienteFicha?.rango_gasto_mes_anterior || 0)}</div></div>
                  <div><div className="tc-sub">Compras 30 días</div><div style={{ fontWeight: 900, marginTop: 6 }}>{Number(crmClienteFicha?.rango_compras_mes_anterior || 0)}</div></div>
                  <div><div className="tc-sub">Vigente desde</div><div style={{ fontWeight: 900, marginTop: 6 }}>{crmClienteFicha?.rango_actual_desde || "—"}</div></div>
                  <div><div className="tc-sub">Vigente hasta</div><div style={{ fontWeight: 900, marginTop: 6 }}>{crmClienteFicha?.rango_actual_hasta || "—"}</div></div>
                </div>

                <div style={{ display: "grid", gap: 8, marginTop: 14 }}>
                  {rankMeta(crmClienteFicha?.rango_actual).perks.map((perk: string) => (
                    <div key={perk} className="tc-sub" style={{ padding: "10px 12px", borderRadius: 12, background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.08)" }}>
                      ✨ {perk}
                    </div>
                  ))}
                </div>
              </div>

              <div className="tc-row" style={{ justifyContent: "flex-end", marginTop: 12, gap: 8, flexWrap: "wrap" }}>
                <button className="tc-btn" onClick={closeCRMFicha}>Cancelar</button>
                <button className="tc-btn tc-btn-ok" onClick={saveCRMFicha} disabled={crmSaveLoading || !crmClienteSelId}>
                  {crmSaveLoading ? "Guardando..." : "Guardar cambios"}
                </button>
              </div>

              <div className="tc-sub" style={{ marginTop: 10 }}>
                {crmFichaMsg || crmSendMsg || " "}
              </div>
            </>
          )}
        </div>
      )}

          {!crmFichaLoading && !crmClienteFicha && (
            <div
              className="tc-card"
              style={{
                minHeight: 320,
                display: "grid",
                placeItems: "center",
                textAlign: "center",
                borderRadius: 22,
                background:
                  "linear-gradient(180deg, rgba(255,255,255,.05), rgba(255,255,255,.025))",
              }}
            >
              <div style={{ maxWidth: 440 }}>
                <div className="tc-title" style={{ fontSize: 20 }}>Selecciona una clienta</div>
                <div className="tc-sub" style={{ marginTop: 10 }}>
                  Abre una ficha desde resultados para trabajar pagos, llamadas, reservas, etiquetas y notas en una vista lateral fija.
                </div>
              </div>
            </div>
          )}

        </div>
      </div>

      {crmEtiquetasModalFor && typeof document !== "undefined"
        ? createPortal(
            <div
              onClick={closeEtiquetasModal}
              style={{
                position: "fixed",
                inset: 0,
                zIndex: 2147483647,
                background: "rgba(0,0,0,.72)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 16,
              }}
            >
              <div
                onClick={(e) => e.stopPropagation()}
                style={{
                  width: "min(560px, 92vw)",
                  maxHeight: "82vh",
                  overflow: "hidden",
                  borderRadius: 18,
                  border: "1px solid rgba(255,255,255,.10)",
                  background: "rgba(11,11,18,.98)",
                  boxShadow: "0 30px 80px rgba(0,0,0,.55)",
                  display: "grid",
                  gridTemplateRows: "auto 1fr auto",
                }}
              >
                <div style={{ padding: 16, borderBottom: "1px solid rgba(255,255,255,.08)" }}>
                  <div className="tc-title" style={{ fontSize: 18 }}>🏷️ Etiquetas</div>
                  <div className="tc-sub" style={{ marginTop: 6 }}>
                    Selecciona etiquetas existentes o crea una nueva.
                  </div>
                </div>

                <div style={{ padding: 16, overflowY: "auto", display: "grid", gap: 8 }}>
                  {crmEtiquetasOpts.map((et: any) => {
                    const isActive = getEtiquetasSeleccionadas(crmEtiquetasModalFor).includes(String(et.id));
                    return (
                      <button
                        key={et.id}
                        type="button"
                        onClick={() => toggleEtiquetaSeleccion(crmEtiquetasModalFor, String(et.id))}
                        style={{
                          width: "100%",
                          textAlign: "left",
                          borderRadius: 12,
                          border: isActive ? "1px solid rgba(215,181,109,.55)" : "1px solid rgba(255,255,255,.08)",
                          background: isActive ? "rgba(215,181,109,.14)" : "rgba(255,255,255,.03)",
                          color: "white",
                          padding: "12px 14px",
                          cursor: "pointer",
                          fontSize: 15,
                        }}
                      >
                        <span style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                          <span>{et.nombre}</span>
                          <span>{isActive ? "✓" : ""}</span>
                        </span>
                      </button>
                    );
                  })}

                  <div
                    style={{
                      marginTop: 8,
                      borderTop: "1px solid rgba(255,255,255,.08)",
                      paddingTop: 14,
                      display: "grid",
                      gap: 8,
                    }}
                  >
                    <div className="tc-sub">Crear nueva etiqueta</div>
                    <input
                      className="tc-input"
                      value={crmNuevaEtiqueta}
                      onChange={(e) => setCrmNuevaEtiqueta(e.target.value)}
                      placeholder="Ej: VIP, Pendiente, Septiembre2025..."
                      style={{ width: "100%" }}
                    />
                    <button
                      className="tc-btn tc-btn-gold"
                      type="button"
                      onClick={createCRMEtiquetaDesdeModal}
                      disabled={crmEtiquetasSaving || !crmNuevaEtiqueta.trim()}
                    >
                      {crmEtiquetasSaving ? "Creando..." : "Crear etiqueta"}
                    </button>
                  </div>
                </div>

                <div
                  style={{
                    padding: 16,
                    borderTop: "1px solid rgba(255,255,255,.08)",
                    display: "flex",
                    justifyContent: "flex-end",
                    gap: 8,
                  }}
                >
                  <button className="tc-btn" type="button" onClick={closeEtiquetasModal}>
                    Cerrar
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}

      <RegistrarLlamadaModal
        open={crmRegistrarOpen}
        onClose={() => setCrmRegistrarOpen(false)}
        cliente={crmClienteFicha ? {
          id: String(crmClienteFicha?.id || crmClienteSelId || ""),
          nombre: crmClienteFicha?.nombre,
          apellido: crmClienteFicha?.apellido,
          telefono: crmClienteFicha?.telefono,
          minutos_free_pendientes: crmClienteFicha?.minutos_free_pendientes,
          minutos_normales_pendientes: crmClienteFicha?.minutos_normales_pendientes,
        } : null}
        tarotistas={crmTarotistasOpts}
        getToken={getTokenOrLogin}
        onSuccess={async (message?: string) => {
          const targetId = String(crmClienteFicha?.id || crmClienteSelId || "").trim();
          setCrmRegistrarOpen(false);
          if (targetId) {
            await openCRMFicha(targetId);
          }
          setCrmFichaMsg(message || "✅ Llamada registrada correctamente");
        }}
      />


      <div className="tc-card" style={{ borderRadius: 20, overflow: "hidden" }}>
        <div className="tc-row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <div>
            <div className="tc-title">📋 Resultados CRM</div>
            <div className="tc-sub" style={{ marginTop: 6 }}>Listado operativo con acceso rápido a ficha</div>
          </div>
          <div className="tc-row" style={{ gap: 8, flexWrap: "wrap" }}>
            <span className="tc-chip">Clientes: {crmRows.length}</span>
            {crmMsg ? <span className="tc-chip">{crmMsg}</span> : null}
          </div>
        </div>

        <div className="tc-hr" />

        {crmRankFilter ? (
          <div className="tc-card" style={{ marginBottom: 12, padding: 14, borderRadius: 18, background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.08)" }}>
            <div className="tc-row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <div>
                <div className="tc-title" style={{ fontSize: 18 }}>Vista de rango: {rankLabel(crmRankFilter)}</div>
                <div className="tc-sub" style={{ marginTop: 6 }}>Aquí tienes todos los clientes del rango seleccionado.</div>
              </div>
              <button className="tc-btn" onClick={clearRankClientsFilter} disabled={crmLoading}>Quitar filtro de rango</button>
            </div>
          </div>
        ) : null}

        <div style={{ overflowX: "auto" }}>
          <table className="tc-table">
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Teléfono</th>
                <th>País</th>
                <th>Etiquetas</th>
                <th>Estado web</th>
                <th>Rango</th>
                <th>Min free</th>
                <th>Min normales</th>
                <th>Deuda</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {(crmRows || []).map((r: any) => {
                const etiquetas = r.etiquetas || r.tags || r.labels || r.crm_tags || r.crm_etiquetas || [];
                const etiquetasTexto = Array.isArray(etiquetas)
                  ? etiquetas.map((x: any) => typeof x === "string" ? x : x?.nombre || x?.label || x?.name || x?.tag || "").filter(Boolean).join(", ")
                  : "";

                const webMeta = clientWebMeta(r);
                const webBadge = clientWebBadge(r);

                return (
                  <tr key={r.id}>
                    <td><b>{[r.nombre, r.apellido].filter(Boolean).join(" ") || "—"}</b></td>
                    <td>{r.telefono || "—"}</td>
                    <td>{r.pais || "—"}</td>
                    <td>{etiquetasTexto || "—"}</td>
                    <td>
                      <div style={{ display: "grid", gap: 6 }}>
                        <span className="tc-chip" style={{ background: webBadge.bg, border: webBadge.border, color: webBadge.color, width: "fit-content" }}>
                          {webBadge.label}
                        </span>
                        <span className="tc-sub">
                          {webMeta.lastAccessAt ? `Último acceso: ${formatWebDateTime(webMeta.lastAccessAt)}` : webMeta.lastActivityAt ? `Actividad: ${formatWebDateTime(webMeta.lastActivityAt)}` : "Sin acceso detectado"}
                        </span>
                        <span className="tc-sub">Accesos: {webMeta.accessCount}</span>
                      </div>
                    </td>
                    <td>{rankChip(r.rango_actual)}</td>
                    <td>{r.minutos_free_pendientes ?? 0}</td>
                    <td>{r.minutos_normales_pendientes ?? 0}</td>
                    <td>{eur(r.deuda_pendiente || 0)}</td>
                    <td>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button className="tc-btn" onClick={() => openCRMFicha(String(r.id || ""))}>Ver ficha</button>
                        <button className="tc-btn tc-btn-gold" onClick={() => sendNumberToSoftphone(String(r.telefono || ""), true)} disabled={!normalizeDialPhone(String(r.telefono || ""))}>
                          Llamar
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {crmRows.length === 0 && (
                <tr>
                  <td colSpan={10} className="tc-muted">Sin resultados.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

