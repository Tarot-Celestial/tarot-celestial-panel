"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { supabaseBrowser } from "@/lib/supabase-browser";

const sb = supabaseBrowser();

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
  const [crmLoading, setCrmLoading] = useState(false);
  const [crmRows, setCrmRows] = useState<any[]>([]);
  const [crmMsg, setCrmMsg] = useState("");
  const [crmImportLoading, setCrmImportLoading] = useState(false);
  const [crmCreateLoading, setCrmCreateLoading] = useState(false);
  const [crmCreateMsg, setCrmCreateMsg] = useState("");
  const [mostrarNuevoCliente, setMostrarNuevoCliente] = useState(false);

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
  const [crmUpdatingNote, setCrmUpdatingNote] = useState(false);
  const [crmPinningNoteId, setCrmPinningNoteId] = useState("");

  async function getTokenOrLogin() {
    const { data } = await sb.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      window.location.href = "/login";
      return "";
    }
    return token;
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
    } catch (e) {
      console.error("ERROR GUARDANDO ETIQUETAS CLIENTE", e);
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
  }, []);

  useEffect(() => {
    function onOpenCliente(e: any) {
      const id = e?.detail?.id;
      if (id) openCRMFicha(String(id));
    }

    window.addEventListener("crm-open-cliente", onOpenCliente);
    return () => window.removeEventListener("crm-open-cliente", onOpenCliente);
  }, []);

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

  async function searchCRM() {
    const q = crmQuery.trim();
    const telefono = crmPhoneFilter.trim();
    const etiqueta = crmTagFilter.trim();
    const pais = crmCountryFilter.trim();

    if (!q && !telefono && !etiqueta && !pais) {
      setCrmMsg("⚠️ Escribe al menos un filtro");
      setCrmRows([]);
      return;
    }

    try {
      setCrmLoading(true);
      setCrmMsg("");

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

      const r = await fetch(`/api/crm/clientes/buscar?${params.toString()}`, {
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
      setCrmLoading(false);
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
      setCrmFichaMsg("✅ Cliente actualizado correctamente");
      await searchCRM();
    } catch (e: any) {
      setCrmFichaMsg(`❌ ${e?.message || "Error guardando ficha"}`);
    } finally {
      setCrmSaveLoading(false);
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

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className="tc-card">
        <div className="tc-row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
          <div>
            <div className="tc-title">👥 CRM</div>
            <div className="tc-sub">
              Busca clientes por nombre, teléfono, país o etiqueta
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
              style={{ width: "100%", marginTop: 6, colorScheme: "dark" }}
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

        <div className="tc-row" style={{ justifyContent: "flex-end", marginTop: 12 }}>
          <button className="tc-btn tc-btn-gold" onClick={searchCRM} disabled={crmLoading}>
            {crmLoading ? "Buscando…" : "Buscar"}
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
                  <textarea
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
                    crmNotes.map((n: any) => (
                      <div
                        key={n.id}
                        style={{
                          border: n?.is_pinned ? "1px solid rgba(215,181,109,.26)" : "1px solid rgba(255,255,255,.08)",
                          borderRadius: 14,
                          padding: 12,
                          background: n?.is_pinned ? "linear-gradient(135deg, rgba(215,181,109,.10), rgba(255,255,255,.025))" : "rgba(255,255,255,.025)",
                          boxShadow: n?.is_pinned ? "0 10px 26px rgba(0,0,0,.16)" : "none",
                        }}
                      >
                        <div className="tc-row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                          <div className="tc-row" style={{ gap: 8, flexWrap: "wrap" }}>
                            <div style={{ fontWeight: 800 }}>{n.author_name || n.author_email || "Usuario"}</div>
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
                            <textarea
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
                            {n.texto || "—"}
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
                    ))
                  )}
                </div>
              </div>

              <div className="tc-grid-2" style={{ marginTop: 12 }}>
                <div>
                  <div className="tc-sub">Enviar llamada a tarotista</div>
                  <select
                    className="tc-input"
                    value={crmTarotistaSendId}
                    onChange={(e) => setCrmTarotistaSendId(e.target.value)}
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

                  <div className="tc-grid-2" style={{ marginTop: 12 }}>
                    <div>
                      <div className="tc-sub">Minutos free a enviar</div>
                      <input
                        className="tc-input"
                        value={crmSendMinFree}
                        onChange={(e) => setCrmSendMinFree(e.target.value)}
                        placeholder="0"
                        style={{ width: "100%", marginTop: 6 }}
                      />
                    </div>

                    <div>
                      <div className="tc-sub">Minutos cliente a enviar</div>
                      <input
                        className="tc-input"
                        value={crmSendMinNormales}
                        onChange={(e) => setCrmSendMinNormales(e.target.value)}
                        placeholder="0"
                        style={{ width: "100%", marginTop: 6 }}
                      />
                    </div>
                  </div>

                  <div className="tc-row" style={{ marginTop: 12 }}>
                    <button className="tc-btn tc-btn-gold" onClick={sendCallPopup} disabled={crmSendLoading || !crmClienteSelId || !crmTarotistaSendId}>
                      {crmSendLoading ? "Enviando..." : "Enviar llamada"}
                    </button>
                  </div>
                </div>

                <div>
                  <div className="tc-sub">Resumen del popup</div>
                  <div className="tc-sub" style={{ marginTop: 8 }}>
                    {[crmEditNombre, crmEditApellido].filter(Boolean).join(" ") || "—"}
                  </div>
                  <div className="tc-sub" style={{ marginTop: 6 }}>
                    {Number(String(crmSendMinFree).replace(",", ".")) || 0} minutos free · {" "}
                    {Number(String(crmSendMinNormales).replace(",", ".")) || 0} minutos cliente
                  </div>
                </div>
              </div>

              <div className="tc-grid-2" style={{ marginTop: 12 }}>
                <div><div className="tc-sub">ID cliente</div><div className="tc-sub" style={{ marginTop: 8, wordBreak: "break-all" }}>{crmClienteFicha?.id || crmClienteSelId || "—"}</div></div>
                <div><div className="tc-sub">Última ficha cargada</div><div className="tc-sub" style={{ marginTop: 8 }}>{[crmClienteFicha?.nombre, crmClienteFicha?.apellido].filter(Boolean).join(" ") || "—"}</div></div>
              </div>

              <div className="tc-hr" />

              <div className="tc-title">💳 Cobros</div>
              <div className="tc-sub" style={{ marginTop: 6 }}>
                Abre el TPV virtual de PayPal. Cuando termines el cobro, vuelve a esta pestaña y usa 'Confirmar pago' si salió bien o 'Pago erróneo' si falló.
              </div>

              <div className="tc-grid-2" style={{ marginTop: 12 }}>
                <div>
                  <div className="tc-sub">Importe (€)</div>
                  <input
                    className="tc-input"
                    value={crmPagoImporte}
                    onChange={(e) => setCrmPagoImporte(e.target.value)}
                    placeholder="20"
                    style={{ width: "100%", marginTop: 6 }}
                  />
                </div>

                <div>
                  <div className="tc-sub">Referencia PayPal / operación</div>
                  <input
                    className="tc-input"
                    value={crmPagoReferencia}
                    onChange={(e) => setCrmPagoReferencia(e.target.value)}
                    placeholder="Ej: 7AB12345CD6789012"
                    style={{ width: "100%", marginTop: 6 }}
                  />
                </div>
              </div>

              <div className="tc-grid-1" style={{ marginTop: 12 }}>
                <div>
                  <div className="tc-sub">Notas</div>
                  <input
                    className="tc-input"
                    value={crmPagoNotas}
                    onChange={(e) => setCrmPagoNotas(e.target.value)}
                    placeholder="Cobro telefónico PayPal"
                    style={{ width: "100%", marginTop: 6 }}
                  />
                </div>
              </div>

              <div className="tc-row" style={{ justifyContent: "flex-start", marginTop: 12, gap: 8, flexWrap: "wrap" }}>
                <button
                  className="tc-btn tc-btn-gold"
                  onClick={crearPagoManual}
                  disabled={crmPagoLoading || crmPagoPendienteConfirmacion || !crmClienteSelId}
                  style={{ opacity: crmPagoPendienteConfirmacion ? 0.6 : 1 }}
                >
                  {crmPagoLoading ? "Abriendo..." : "Registrar pago"}
                </button>

                <button
                  className="tc-btn tc-btn-ok"
                  onClick={confirmarPagoManual}
                  disabled={crmPagoLoading || !crmPagoPendienteConfirmacion}
                  style={{ opacity: crmPagoPendienteConfirmacion ? 1 : 0.6 }}
                >
                  {crmPagoLoading ? "Guardando..." : "Confirmar pago"}
                </button>

                <button
                  className="tc-btn"
                  onClick={marcarPagoErroneo}
                  disabled={crmPagoLoading || !crmPagoPendienteConfirmacion}
                  style={{ opacity: crmPagoPendienteConfirmacion ? 1 : 0.6 }}
                >
                  {crmPagoLoading ? "Guardando..." : "Pago erróneo"}
                </button>
              </div>

              <div className="tc-sub" style={{ marginTop: 10 }}>
                {crmPagoMsg || " "}
              </div>

              <div className="tc-sub" style={{ marginTop: 4 }}>
                {crmPagoPendienteConfirmacion
                  ? "Hay un cobro pendiente de cerrar en esta ficha. Usa Confirmar pago o Pago erróneo."
                  : "Primero pulsa Registrar pago para abrir el TPV. Después se habilitarán Confirmar pago y Pago erróneo."}
              </div>

              <div className="tc-hr" />

              <div className="tc-sub">Historial de pagos</div>
              <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                {crmPagosLoading ? (
                  <div className="tc-sub">Cargando pagos...</div>
                ) : crmPagos.length === 0 ? (
                  <div className="tc-sub">Sin pagos registrados.</div>
                ) : (
                  crmPagos.map((p: any) => (
                    <div
                      key={p.id}
                      className="tc-row"
                      style={{
                        justifyContent: "space-between",
                        alignItems: "center",
                        border: "1px solid rgba(255,255,255,.08)",
                        borderRadius: 10,
                        padding: "10px 12px",
                        gap: 10,
                        flexWrap: "wrap",
                      }}
                    >
                      <div className="tc-sub">
                        <b>{eur(p.importe || 0)}</b> · {p.estado || "—"} · {p.metodo || "—"}
                      </div>
                      <div className="tc-sub">
                        {p.created_at ? new Date(p.created_at).toLocaleString("es-ES") : "—"}
                      </div>
                      {!!p.referencia_externa && (
                        <div className="tc-sub" style={{ width: "100%" }}>
                          Ref: {p.referencia_externa}
                        </div>
                      )}
                      {!!p.notas && (
                        <div className="tc-sub" style={{ width: "100%" }}>
                          {p.notas}
                        </div>
                      )}
                    </div>
                  ))
                )}
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


      <div className="tc-card">
        <div className="tc-title">📋 Resultados CRM</div>
        <div className="tc-sub" style={{ marginTop: 6 }}>Resultado de búsqueda con filtros</div>

        <div className="tc-hr" />

        <div style={{ overflowX: "auto" }}>
          <table className="tc-table">
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Teléfono</th>
                <th>País</th>
                <th>Etiquetas</th>
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

                return (
                  <tr key={r.id}>
                    <td><b>{[r.nombre, r.apellido].filter(Boolean).join(" ") || "—"}</b></td>
                    <td>{r.telefono || "—"}</td>
                    <td>{r.pais || "—"}</td>
                    <td>{etiquetasTexto || "—"}</td>
                    <td>{r.minutos_free_pendientes ?? 0}</td>
                    <td>{r.minutos_normales_pendientes ?? 0}</td>
                    <td>{eur(r.deuda_pendiente || 0)}</td>
                    <td><button className="tc-btn" onClick={() => openCRMFicha(String(r.id || ""))}>Ver ficha</button></td>
                  </tr>
                );
              })}

              {crmRows.length === 0 && (
                <tr>
                  <td colSpan={8} className="tc-muted">Sin resultados.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
