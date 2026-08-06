"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import styles from "./ManualInvoiceModal.module.css";
import { supabaseBrowser } from "@/lib/supabase-browser";

type ManualInvoiceLine = {
  id?: string;
  concept: string;
  detail: string;
  amount: number;
};

type ManualInvoiceForm = {
  issue_date: string;
  due_date: string;
  status: string;
  recipient_name: string;
  recipient_tax_id: string;
  recipient_address: string;
  recipient_postal_code: string;
  recipient_city: string;
  recipient_province: string;
  recipient_country: string;
  recipient_email: string;
  recipient_phone: string;
  notes: string;
  vat_percent: number;
};

type Props = {
  open: boolean;
  invoiceId?: string | null;
  onClose: () => void;
  onSaved: () => void;
};

const emptyLine = (): ManualInvoiceLine => ({ concept: "", detail: "", amount: 0 });
const today = () => new Date().toISOString().slice(0, 10);
const money = (value: number) => value.toLocaleString("es-ES", { style: "currency", currency: "EUR" });
const initialForm = (): ManualInvoiceForm => ({
  issue_date: today(),
  due_date: "",
  status: "draft",
  recipient_name: "",
  recipient_tax_id: "",
  recipient_address: "",
  recipient_postal_code: "",
  recipient_city: "",
  recipient_province: "",
  recipient_country: "España",
  recipient_email: "",
  recipient_phone: "",
  notes: "",
  vat_percent: 21,
});

function readableError(code: string) {
  const messages: Record<string, string> = {
    LINES_REQUIRED: "Añade al menos un concepto a la factura.",
    INVALID_LINE: "Cada línea necesita un concepto y un importe mayor que cero.",
    INVALID_VAT: "Introduce un porcentaje de IVA válido entre 0 y 100.",
    RECIPIENT_AND_DATE_REQUIRED: "Indica el destinatario y la fecha de emisión.",
    ONLY_DRAFT_EDITABLE: "Solo se pueden editar facturas en borrador.",
    INVALID_STATUS: "El estado seleccionado no es válido.",
  };
  return messages[code] || "No se pudo guardar la factura. Revisa los datos e inténtalo de nuevo.";
}

export default function ManualInvoiceModal({ open, invoiceId, onClose, onSaved }: Props) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [form, setForm] = useState<ManualInvoiceForm>(initialForm);
  const [lines, setLines] = useState<ManualInvoiceLine[]>([emptyLine()]);
  const [number, setNumber] = useState("Se asignará al guardar");
  const editable = !invoiceId || form.status === "draft";

  useEffect(() => {
    if (!open) return;
    setMessage("");
    if (!invoiceId) {
      setForm(initialForm());
      setLines([emptyLine()]);
      setNumber("Se asignará al guardar");
      return;
    }
    void loadInvoice(invoiceId);
  }, [open, invoiceId]);

  async function token() {
    const { data } = await supabaseBrowser().auth.getSession();
    return data.session?.access_token || "";
  }

  async function loadInvoice(id: string) {
    setLoading(true);
    try {
      const accessToken = await token();
      const response = await fetch(`/api/admin/invoices/manual?id=${encodeURIComponent(id)}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      });
      const json = await response.json();
      if (!response.ok || !json.ok) throw new Error(String(json.error || "LOAD_FAILED"));
      const inv = json.invoice as Record<string, unknown>;
      setNumber(String(inv.invoice_number || ""));
      setForm({
        issue_date: String(inv.issue_date || today()),
        due_date: String(inv.due_date || ""),
        status: String(inv.status || "draft"),
        recipient_name: String(inv.recipient_name || ""),
        recipient_tax_id: String(inv.recipient_tax_id || ""),
        recipient_address: String(inv.recipient_address || ""),
        recipient_postal_code: String(inv.recipient_postal_code || ""),
        recipient_city: String(inv.recipient_city || ""),
        recipient_province: String(inv.recipient_province || ""),
        recipient_country: String(inv.recipient_country || "España"),
        recipient_email: String(inv.recipient_email || ""),
        recipient_phone: String(inv.recipient_phone || ""),
        notes: String(inv.notes || ""),
        vat_percent: Number(inv.vat_percent ?? 21),
      });
      const loadedLines = Array.isArray(json.lines) ? json.lines : [];
      setLines(loadedLines.length ? loadedLines.map((line: Record<string, unknown>) => ({
        id: line.id ? String(line.id) : undefined,
        concept: String(line.concept || line.description || ""),
        detail: String(line.detail || ""),
        amount: Number(line.amount ?? line.unit_price ?? 0),
      })) : [emptyLine()]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo cargar la factura.");
    } finally {
      setLoading(false);
    }
  }

  const totals = useMemo(() => {
    const subtotal = lines.reduce((sum, line) => sum + (Number.isFinite(line.amount) ? Math.max(0, line.amount) : 0), 0);
    const vatPercent = Number.isFinite(form.vat_percent) ? Math.min(100, Math.max(0, form.vat_percent)) : 0;
    const vat = subtotal * vatPercent / 100;
    return { subtotal, vat, total: subtotal + vat };
  }, [lines, form.vat_percent]);

  function patchLine(index: number, patch: Partial<ManualInvoiceLine>) {
    setLines((current) => current.map((line, currentIndex) => currentIndex === index ? { ...line, ...patch } : line));
  }

  async function save() {
    if (!editable || saving) return;
    if (!form.recipient_name.trim() || !form.issue_date) {
      setMessage("Indica el destinatario y la fecha de emisión.");
      return;
    }
    if (!Number.isFinite(form.vat_percent) || form.vat_percent < 0 || form.vat_percent > 100) {
      setMessage("Introduce un porcentaje de IVA válido entre 0 y 100.");
      return;
    }
    if (!lines.length || lines.some((line) => !line.concept.trim() || !Number.isFinite(line.amount) || line.amount <= 0)) {
      setMessage("Cada línea necesita un concepto y un importe mayor que cero.");
      return;
    }

    setSaving(true);
    setMessage("");
    try {
      const accessToken = await token();
      const response = await fetch("/api/admin/invoices/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ id: invoiceId || undefined, ...form, lines }),
      });
      const json = await response.json();
      if (!response.ok || !json.ok) {
        console.error("[manual-invoice:save]", json.diagnostic || json.error);
        throw new Error(readableError(String(json.error || "SAVE_FAILED")));
      }
      setMessage("Factura guardada correctamente.");
      onSaved();
      onClose();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo guardar la factura.");
    } finally {
      setSaving(false);
    }
  }

  async function setStatus(status: string) {
    if (!invoiceId || saving) return;
    setSaving(true);
    setMessage("");
    try {
      const accessToken = await token();
      const response = await fetch("/api/admin/invoices/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ action: "set_status", id: invoiceId, status }),
      });
      const json = await response.json();
      if (!response.ok || !json.ok) throw new Error(readableError(String(json.error || "STATUS_FAILED")));
      setForm((current) => ({ ...current, status }));
      onSaved();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo actualizar la factura.");
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return <div className={styles.overlay} role="dialog" aria-modal="true">
    <div className={styles.modal}>
      <div className={styles.header}>
        <div><span>Factura manual</span><h2>{number}</h2></div>
        <button onClick={onClose} aria-label="Cerrar"><X /></button>
      </div>

      <div className={styles.body}>{loading ? <div className={styles.loading}>Cargando…</div> : <>
        <section>
          <h3>Datos de la factura</h3>
          <div className={styles.grid3}>
            <label>Fecha de emisión<input type="date" value={form.issue_date} disabled={!editable} onChange={(event) => setForm({ ...form, issue_date: event.target.value })} /></label>
            <label>Vencimiento<input type="date" value={form.due_date} disabled={!editable} onChange={(event) => setForm({ ...form, due_date: event.target.value })} /></label>
            <label>Estado<select value={form.status} disabled={!editable} onChange={(event) => setForm({ ...form, status: event.target.value })}><option value="draft">Borrador</option><option value="issued">Emitida</option><option value="paid">Pagada</option><option value="cancelled">Cancelada</option></select></label>
          </div>
        </section>

        <section>
          <h3>Destinatario</h3>
          <div className={styles.grid3}>
            <label>Nombre o razón social<input value={form.recipient_name} disabled={!editable} onChange={(event) => setForm({ ...form, recipient_name: event.target.value })} /></label>
            <label>NIF/CIF<input value={form.recipient_tax_id} disabled={!editable} onChange={(event) => setForm({ ...form, recipient_tax_id: event.target.value })} /></label>
            <label>Email<input type="email" value={form.recipient_email} disabled={!editable} onChange={(event) => setForm({ ...form, recipient_email: event.target.value })} /></label>
            <label>Dirección<input value={form.recipient_address} disabled={!editable} onChange={(event) => setForm({ ...form, recipient_address: event.target.value })} /></label>
            <label>Código postal<input value={form.recipient_postal_code} disabled={!editable} onChange={(event) => setForm({ ...form, recipient_postal_code: event.target.value })} /></label>
            <label>Ciudad<input value={form.recipient_city} disabled={!editable} onChange={(event) => setForm({ ...form, recipient_city: event.target.value })} /></label>
            <label>Provincia<input value={form.recipient_province} disabled={!editable} onChange={(event) => setForm({ ...form, recipient_province: event.target.value })} /></label>
            <label>País<input value={form.recipient_country} disabled={!editable} onChange={(event) => setForm({ ...form, recipient_country: event.target.value })} /></label>
            <label>Teléfono<input value={form.recipient_phone} disabled={!editable} onChange={(event) => setForm({ ...form, recipient_phone: event.target.value })} /></label>
          </div>
        </section>

        <section>
          <div className={styles.sectionTitle}>
            <h3>Conceptos</h3>
            {editable && <button type="button" onClick={() => setLines((current) => [...current, emptyLine()])}><Plus size={16} /> Añadir línea</button>}
          </div>
          <div className={styles.lineHeader}><span>Concepto</span><span>Detalle</span><span>Importe</span><span aria-hidden="true" /></div>
          <div className={styles.lines}>{lines.map((line, index) => <div className={styles.line} key={line.id || index}>
            <input placeholder="Servicio mensual" value={line.concept} disabled={!editable} onChange={(event) => patchLine(index, { concept: event.target.value })} />
            <input placeholder="Gestión correspondiente al periodo" value={line.detail} disabled={!editable} onChange={(event) => patchLine(index, { detail: event.target.value })} />
            <div className={styles.amountField}><input aria-label="Importe" type="number" min="0.01" step="0.01" value={line.amount || ""} disabled={!editable} onChange={(event) => patchLine(index, { amount: Number(event.target.value) })} /><span>€</span></div>
            {editable && lines.length > 1 ? <button type="button" className={styles.trash} aria-label="Eliminar línea" onClick={() => setLines((current) => current.filter((_, currentIndex) => currentIndex !== index))}><Trash2 size={16} /></button> : <span />}
          </div>)}</div>
        </section>

        <section>
          <div className={styles.taxRow}>
            <label>IVA %<input type="number" min="0" max="100" step="0.01" value={form.vat_percent} disabled={!editable} onChange={(event) => setForm({ ...form, vat_percent: Number(event.target.value) })} /></label>
            <div className={styles.taxHint}>El IVA se aplica una sola vez sobre el subtotal completo de la factura.</div>
          </div>
        </section>

        <section><label>Observaciones<textarea rows={3} value={form.notes} disabled={!editable} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label></section>

        <div className={styles.totals}>
          <div><span>Subtotal</span><b>{money(totals.subtotal)}</b></div>
          <div><span>IVA {form.vat_percent || 0} %</span><b>{money(totals.vat)}</b></div>
          <div className={styles.grand}><span>Total</span><b>{money(totals.total)}</b></div>
        </div>
      </>}</div>

      {message && <div className={styles.message}>{message}</div>}
      <div className={styles.footer}>
        {invoiceId && form.status !== "draft" ? <><button onClick={() => setStatus("paid")} disabled={saving || form.status === "paid"}>Marcar pagada</button><button onClick={() => setStatus("cancelled")} disabled={saving || form.status === "cancelled"}>Cancelar factura</button></> : null}
        <button className={styles.secondary} onClick={onClose}>Cerrar</button>
        {editable && <button className={styles.primary} onClick={save} disabled={saving}>{saving ? "Guardando…" : "Guardar factura"}</button>}
      </div>
    </div>
  </div>;
}
