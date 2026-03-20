"use client";

import { useEffect, useState } from "react";
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

  const [crmNotes, setCrmNotes] = useState<any[]>([]);
  const [crmNotesLoading, setCrmNotesLoading] = useState(false);
  const [crmNoteText, setCrmNoteText] = useState("");
  const [crmNoteSaving, setCrmNoteSaving] = useState(false);
  const [crmNotesMsg, setCrmNotesMsg] = useState("");

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

  async function getTokenOrLogin() {
    const { data } = await sb.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      window.location.href = "/login";
      return "";
    }
    return token;
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
    setCrmNoteText("");
    setCrmNoteSaving(false);
    setCrmNotesMsg("");
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

      setCrmNotes(Array.isArray(j.notas) ? j.notas : []);
    } catch (e: any) {
      console.error("ERROR CARGANDO NOTAS CLIENTE", e);
      setCrmNotes([]);
      setCrmNotesMsg(`❌ ${e?.message || "Error cargando notas"}`);
    } finally {
      setCrmNotesLoading(false);
    }
  }

  async function addCRMNote() {
    const clienteId = String(crmClienteFicha?.id || crmClienteSelId || "").trim();
    const texto = crmNoteText.trim();

    if (!clienteId) {
      setCrmNotesMsg("⚠️ Primero abre una ficha de cliente");
      return;
    }
    if (!texto) {
      setCrmNotesMsg("⚠️ Escribe una nota");
      return;
    }

    try {
      setCrmNoteSaving(true);
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
          texto,
        }),
      });

      const j = await safeJson(r);
      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status}`);

      setCrmNoteText("");
      setCrmNotesMsg("✅ Nota guardada");
      await loadNotasCliente(clienteId);
    } catch (e: any) {
      setCrmNotesMsg(`❌ ${e?.message || "Error guardando nota"}`);
    } finally {
      setCrmNoteSaving(false);
    }
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

      const clienteId = String(c?.id || id || "");
      await Promise.all([
        loadPagosCliente(clienteId),
        loadNotasCliente(clienteId),
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

      console.log("SEND CALL POPUP", {
        crmTarotistaSendId,
        tarotistaSel,
        crmTarotistasOpts,
        clienteSelId: crmClienteSelId,
        clienteFichaId: crmClienteFicha?.id,
      });

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
    <div style={{ display: "grid", gap: 18 }}>
      <div
        className="tc-card"
        style={{
          borderRadius: 24,
          padding: 20,
          background:
            "radial-gradient(circle at top right, rgba(181,156,255,.18), transparent 28%), radial-gradient(circle at top left, rgba(215,181,109,.12), transparent 22%), linear-gradient(180deg, rgba(255,255,255,.06), rgba(255,255,255,.03))",
          boxShadow: "0 26px 70px rgba(0,0,0,.22)",
        }}
      >
        <div className="tc-row" style={{ justifyContent: "space-between", gap: 14, flexWrap: "wrap", alignItems: "flex-start" }}>
          <div>
            <div className="tc-title" style={{ fontSize: 24 }}>👥 CRM Clientes</div>
            <div className="tc-sub" style={{ marginTop: 8, maxWidth: 760 }}>
              Búsqueda, revisión y gestión de clientes desde un panel maestro-detalle más claro y profesional.
            </div>
          </div>

          <div className="tc-row" style={{ gap: 8, flexWrap: "wrap" }}>
            <span className="tc-chip">Resultados: {crmRows.length}</span>
            <span className="tc-chip">Ficha: {crmClienteSelId ? "Abierta" : "Sin seleccionar"}</span>
            {showImportButton ? (
              <button className="tc-btn tc-btn-gold" onClick={importCRM} disabled={crmImportLoading}>
                {crmImportLoading ? "Importando…" : "Importar CRM"}
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="crm-master-detail" style={{ display: "grid", gridTemplateColumns: "420px 1fr", gap: 20, alignItems: "start" }}>
        <div style={{ display: "grid", gap: 18 }}>
          <div className="tc-card" style={{ borderRadius: 22, padding: 18 }}>
            <div className="tc-row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <div>
                <div className="tc-title" style={{ fontSize: 20 }}>Buscar clientes</div>
                <div className="tc-sub" style={{ marginTop: 6 }}>
                  Filtra por nombre, teléfono, país o etiqueta.
                </div>
              </div>

              <button className="tc-btn" onClick={clearCRMFilters} disabled={crmLoading || crmImportLoading}>
                Limpiar
              </button>
            </div>

            <div className="tc-hr" />

            <div style={{ display: "grid", gap: 12 }}>
              <div>
                <div className="tc-sub">Nombre / búsqueda general</div>
                <input
                  className="tc-input"
                  value={crmQuery}
                  onChange={(e) => setCrmQuery(e.target.value)}
                  placeholder="María, Ana, etc."
                  style={{ width: "100%", marginTop: 6 }}
                  onKeyDown={(e) => { if (e.key === "Enter") searchCRM(); }}
                />
              </div>

              <div>
                <div className="tc-sub">Teléfono</div>
                <input
                  className="tc-input"
                  value={crmPhoneFilter}
                  onChange={(e) => setCrmPhoneFilter(e.target.value)}
                  placeholder="600123123"
                  style={{ width: "100%", marginTop: 6 }}
                  onKeyDown={(e) => { if (e.key === "Enter") searchCRM(); }}
                />
              </div>

              <div>
                <div className="tc-sub">Etiqueta</div>
                <select
                  className="tc-select"
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
                <input
                  className="tc-input"
                  value={crmCountryFilter}
                  onChange={(e) => setCrmCountryFilter(e.target.value)}
                  placeholder="España, México..."
                  style={{ width: "100%", marginTop: 6 }}
                  onKeyDown={(e) => { if (e.key === "Enter") searchCRM(); }}
                />
              </div>
            </div>

            <div className="tc-row" style={{ justifyContent: "space-between", marginTop: 14, gap: 10 }}>
              <div className="tc-sub">{crmMsg || "Busca para cargar clientes"}</div>
              <button className="tc-btn tc-btn-gold" onClick={searchCRM} disabled={crmLoading}>
                {crmLoading ? "Buscando…" : "Buscar"}
              </button>
            </div>
          </div>

          <div className="tc-card" style={{ borderRadius: 22, padding: 18 }}>
            <div className="tc-row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <div>
                <div className="tc-title" style={{ fontSize: 20 }}>Resultados</div>
                <div className="tc-sub" style={{ marginTop: 6 }}>
                  Selecciona un cliente para abrir su ficha.
                </div>
              </div>

              <span className="tc-chip">{crmRows.length} filas</span>
            </div>

            <div className="tc-hr" />

            <div style={{ display: "grid", gap: 10, maxHeight: "70vh", overflow: "auto", paddingRight: 4 }}>
              {(crmRows || []).map((r: any) => {
                const etiquetas = r.etiquetas || r.tags || r.labels || r.crm_tags || r.crm_etiquetas || [];
                const etiquetasTexto = Array.isArray(etiquetas)
                  ? etiquetas.map((x: any) => typeof x === "string" ? x : x?.nombre || x?.label || x?.name || x?.tag || "").filter(Boolean).join(", ")
                  : "";
                const selected = String(crmClienteSelId || "") === String(r.id || "");

                return (
                  <button
                    key={r.id}
                    onClick={() => openCRMFicha(String(r.id || ""))}
                    style={{
                      textAlign: "left",
                      width: "100%",
                      borderRadius: 18,
                      padding: 14,
                      cursor: "pointer",
                      border: selected ? "1px solid rgba(181,156,255,.35)" : "1px solid rgba(255,255,255,.08)",
                      background: selected
                        ? "linear-gradient(135deg, rgba(181,156,255,.16), rgba(255,255,255,.03))"
                        : "rgba(255,255,255,.03)",
                      boxShadow: selected ? "0 16px 40px rgba(0,0,0,.18)" : "none",
                      color: "inherit",
                    }}
                  >
                    <div className="tc-row" style={{ justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 900, fontSize: 15 }}>
                          {[r.nombre, r.apellido].filter(Boolean).join(" ") || "—"}
                        </div>
                        <div className="tc-sub" style={{ marginTop: 6 }}>
                          {r.telefono || "—"} · {r.pais || "—"}
                        </div>
                        <div className="tc-sub" style={{ marginTop: 6, opacity: .86 }}>
                          Etiquetas: <b>{etiquetasTexto || "—"}</b>
                        </div>
                      </div>

                      <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        <div className="tc-sub">Deuda</div>
                        <div style={{ fontWeight: 900 }}>{eur(r.deuda_pendiente || 0)}</div>
                      </div>
                    </div>

                    <div className="tc-row" style={{ marginTop: 10, gap: 8, flexWrap: "wrap" }}>
                      <span className="tc-chip">Free: {r.minutos_free_pendientes ?? 0}</span>
                      <span className="tc-chip">Cliente: {r.minutos_normales_pendientes ?? 0}</span>
                      {selected ? <span className="tc-chip">Ficha abierta</span> : null}
                    </div>
                  </button>
                );
              })}

              {crmRows.length === 0 && (
                <div
                  style={{
                    borderRadius: 18,
                    border: "1px dashed rgba(255,255,255,.14)",
                    background: "rgba(255,255,255,.025)",
                    padding: 18,
                  }}
                >
                  <div style={{ fontWeight: 800 }}>Sin resultados</div>
                  <div className="tc-sub" style={{ marginTop: 8 }}>
                    Usa los filtros de arriba para encontrar clientes.
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gap: 18 }}>
          <div className="tc-card" style={{ borderRadius: 22, padding: 18 }}>
            <div className="tc-row" style={{ justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <div>
                <div className="tc-title" style={{ fontSize: 20 }}>➕ Nuevo cliente</div>
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
                <div style={{ display: "grid", gap: 14 }}>
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

                  <div className="tc-grid-2">
                    <div><div className="tc-sub">Min normales</div><input className="tc-input" value={crmNewMinNormales} onChange={(e) => setCrmNewMinNormales(e.target.value)} placeholder="0" style={{ width: "100%", marginTop: 6 }} /></div>
                    <div><div className="tc-sub">Notas</div><input className="tc-input" value={crmNewNotas} onChange={(e) => setCrmNewNotas(e.target.value)} placeholder="Notas internas" style={{ width: "100%", marginTop: 6 }} /></div>
                  </div>

                  <div className="tc-row" style={{ justifyContent: "space-between", marginTop: 4, gap: 10, flexWrap: "wrap" }}>
                    <div className="tc-sub">{crmCreateMsg || "Completa los datos y crea el cliente."}</div>
                    <div className="tc-row" style={{ gap: 8 }}>
                      <button className="tc-btn" onClick={() => setMostrarNuevoCliente(false)} disabled={crmCreateLoading}>
                        Cancelar
                      </button>
                      <button className="tc-btn tc-btn-ok" onClick={createCRMClient} disabled={crmCreateLoading}>
                        {crmCreateLoading ? "Creando..." : "Crear cliente"}
                      </button>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="tc-sub" style={{ marginTop: 12 }}>
                Pulsa <b>+ Nuevo cliente</b> para desplegar el formulario de alta.
              </div>
            )}
          </div>

          {(crmFichaLoading || crmClienteFicha) ? (
            <div className="tc-card" style={{ borderRadius: 24, padding: 20, boxShadow: "0 28px 70px rgba(0,0,0,.24)" }}>
              <div className="tc-row" style={{ justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                <div>
                  <div className="tc-title" style={{ fontSize: 24 }}>🧾 Ficha CRM</div>
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

                  <div className="tc-grid-2" style={{ marginTop: 14 }}>
                    <div><div className="tc-sub">Min normales pendientes</div><input className="tc-input" value={crmEditMinNormales} onChange={(e) => setCrmEditMinNormales(e.target.value)} placeholder="0" style={{ width: "100%", marginTop: 6 }} /></div>
                    <div>
                  <div className="tc-sub">Resumen interno del cliente</div>
                  <textarea
                    className="tc-input"
                    value={crmEditNotas}
                    onChange={(e) => setCrmEditNotas(e.target.value)}
                    placeholder="Resumen general visible en la ficha"
                    style={{ width: "100%", marginTop: 6, minHeight: 180, fontSize: 15, lineHeight: 1.5 }}
                  />
                  <div className="tc-sub" style={{ marginTop: 8 }}>
                    Este campo puede quedarse como resumen. Las notas con autor quedan guardadas debajo en el historial.
                  </div>
                </div>
              </div>

              <div className="tc-grid-2" style={{ marginTop: 14 }}>
                <div className="tc-card" style={{ borderRadius: 20, padding: 16, background: "rgba(255,255,255,.025)" }}>
                  <div className="tc-title" style={{ fontSize: 18 }}>📝 Notas del CRM</div>
                  <div className="tc-sub" style={{ marginTop: 6 }}>
                    Cada nota guarda automáticamente qué usuario la escribió y cuándo.
                  </div>

                  <div style={{ marginTop: 12 }}>
                    <textarea
                      className="tc-input"
                      value={crmNoteText}
                      onChange={(e) => setCrmNoteText(e.target.value)}
                      placeholder="Escribe una nota nueva para este cliente…"
                      style={{ width: "100%", minHeight: 130, fontSize: 15, lineHeight: 1.5 }}
                    />
                  </div>

                  <div className="tc-row" style={{ justifyContent: "flex-end", marginTop: 12 }}>
                    <button className="tc-btn tc-btn-ok" onClick={addCRMNote} disabled={crmNoteSaving || !crmClienteSelId}>
                      {crmNoteSaving ? "Guardando nota..." : "Guardar nota"}
                    </button>
                  </div>

                  <div className="tc-sub" style={{ marginTop: 10 }}>
                    {crmNotesMsg || " "}
                  </div>

                  <div className="tc-hr" />

                  <div style={{ display: "grid", gap: 10 }}>
                    {crmNotesLoading ? (
                      <div className="tc-sub">Cargando notas...</div>
                    ) : crmNotes.length === 0 ? (
                      <div className="tc-sub">Todavía no hay notas guardadas para este cliente.</div>
                    ) : (
                      crmNotes.map((note: any) => (
                        <div
                          key={note.id}
                          style={{
                            border: "1px solid rgba(255,255,255,.08)",
                            borderRadius: 14,
                            padding: 12,
                            background: "rgba(255,255,255,.03)",
                          }}
                        >
                          <div className="tc-row" style={{ justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                            <div style={{ fontWeight: 800 }}>
                              {note.author_name || note.author_email || "Usuario"}
                            </div>
                            <div className="tc-sub">
                              {note.created_at ? new Date(note.created_at).toLocaleString("es-ES") : "—"}
                            </div>
                          </div>
                          {note.author_email ? (
                            <div className="tc-sub" style={{ marginTop: 4 }}>
                              {note.author_email}
                            </div>
                          ) : null}
                          <div style={{ marginTop: 10, whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
                            {note.texto || note.body || ""}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="tc-grid-2" style={{ marginTop: 0 }}>
                    <div className="tc-card" style={{ borderRadius: 20, padding: 16, background: "rgba(255,255,255,.025)" }}>
                      <div className="tc-title" style={{ fontSize: 18 }}>📞 Enviar llamada</div>
                      <div className="tc-sub" style={{ marginTop: 6 }}>Selecciona tarotista y minutos a enviar.</div>

                      <div style={{ marginTop: 12 }}>
                        <div className="tc-sub">Tarotista</div>
                        <select
                          className="tc-select"
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
                      </div>

                      <div className="tc-grid-2" style={{ marginTop: 12 }}>
                        <div>
                          <div className="tc-sub">Minutos free</div>
                          <input className="tc-input" value={crmSendMinFree} onChange={(e) => setCrmSendMinFree(e.target.value)} placeholder="0" style={{ width: "100%", marginTop: 6 }} />
                        </div>
                        <div>
                          <div className="tc-sub">Minutos cliente</div>
                          <input className="tc-input" value={crmSendMinNormales} onChange={(e) => setCrmSendMinNormales(e.target.value)} placeholder="0" style={{ width: "100%", marginTop: 6 }} />
                        </div>
                      </div>

                      <div className="tc-row" style={{ marginTop: 12, justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                        <div className="tc-sub">
                          {[crmEditNombre, crmEditApellido].filter(Boolean).join(" ") || "—"} · {Number(String(crmSendMinFree).replace(",", ".")) || 0} free / {Number(String(crmSendMinNormales).replace(",", ".")) || 0} cliente
                        </div>
                        <button className="tc-btn tc-btn-gold" onClick={sendCallPopup} disabled={crmSendLoading || !crmClienteSelId || !crmTarotistaSendId}>
                          {crmSendLoading ? "Enviando..." : "Enviar llamada"}
                        </button>
                      </div>
                    </div>

                    <div className="tc-card" style={{ borderRadius: 20, padding: 16, background: "rgba(255,255,255,.025)" }}>
                      <div className="tc-title" style={{ fontSize: 18 }}>💳 Cobros</div>
                      <div className="tc-sub" style={{ marginTop: 6 }}>
                        Registra el intento en PayPal y vuelve aquí para confirmarlo o marcarlo como erróneo.
                      </div>

                      <div className="tc-grid-2" style={{ marginTop: 12 }}>
                        <div>
                          <div className="tc-sub">Importe (€)</div>
                          <input className="tc-input" value={crmPagoImporte} onChange={(e) => setCrmPagoImporte(e.target.value)} placeholder="20" style={{ width: "100%", marginTop: 6 }} />
                        </div>
                        <div>
                          <div className="tc-sub">Referencia</div>
                          <input className="tc-input" value={crmPagoReferencia} onChange={(e) => setCrmPagoReferencia(e.target.value)} placeholder="Ej: 7AB12345CD6789012" style={{ width: "100%", marginTop: 6 }} />
                        </div>
                      </div>

                      <div style={{ marginTop: 12 }}>
                        <div className="tc-sub">Notas</div>
                        <input className="tc-input" value={crmPagoNotas} onChange={(e) => setCrmPagoNotas(e.target.value)} placeholder="Cobro telefónico PayPal" style={{ width: "100%", marginTop: 6 }} />
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

                      <div className="tc-sub" style={{ marginTop: 10 }}>{crmPagoMsg || " "}</div>
                    </div>
                  </div>

                  <div className="tc-grid-2" style={{ marginTop: 14 }}>
                    <div><div className="tc-sub">ID cliente</div><div className="tc-sub" style={{ marginTop: 8, wordBreak: "break-all" }}>{crmClienteFicha?.id || crmClienteSelId || "—"}</div></div>
                    <div><div className="tc-sub">Última ficha cargada</div><div className="tc-sub" style={{ marginTop: 8 }}>{[crmClienteFicha?.nombre, crmClienteFicha?.apellido].filter(Boolean).join(" ") || "—"}</div></div>
                  </div>

                  <div className="tc-hr" />

                  <div className="tc-title" style={{ fontSize: 18 }}>Historial de pagos</div>
                  <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
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
                            borderRadius: 14,
                            padding: "12px 14px",
                            gap: 10,
                            flexWrap: "wrap",
                            background: "rgba(255,255,255,.025)",
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

                  <div className="tc-row" style={{ justifyContent: "space-between", marginTop: 14, gap: 10, flexWrap: "wrap" }}>
                    <div className="tc-sub">{crmFichaMsg || crmSendMsg || " "}</div>
                    <div className="tc-row" style={{ gap: 8 }}>
                      <button className="tc-btn" onClick={closeCRMFicha}>Cancelar</button>
                      <button className="tc-btn tc-btn-ok" onClick={saveCRMFicha} disabled={crmSaveLoading || !crmClienteSelId}>
                        {crmSaveLoading ? "Guardando..." : "Guardar cambios"}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          ) : (
            <div
              className="tc-card"
              style={{
                borderRadius: 24,
                padding: 24,
                minHeight: 320,
                display: "grid",
                alignContent: "center",
                justifyItems: "start",
                background: "linear-gradient(180deg, rgba(255,255,255,.045), rgba(255,255,255,.025))",
              }}
            >
              <div className="tc-title" style={{ fontSize: 24 }}>Selecciona un cliente</div>
              <div className="tc-sub" style={{ marginTop: 10, maxWidth: 540 }}>
                Abre una ficha desde la columna izquierda para editar datos, enviar llamadas, revisar notas y gestionar cobros.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
