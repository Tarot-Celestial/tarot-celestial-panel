"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import styles from "./ManualInvoiceModal.module.css";
import { supabaseBrowser } from "@/lib/supabase-browser";

type Line = { id?: string; description: string; quantity: number; unit_price: number; discount_percent: number; vat_percent: number };
type Props = { open: boolean; invoiceId?: string | null; onClose: () => void; onSaved: () => void };

const emptyLine = (): Line => ({ description: "", quantity: 1, unit_price: 0, discount_percent: 0, vat_percent: 21 });
const today = () => new Date().toISOString().slice(0, 10);
const money = (value: number) => value.toLocaleString("es-ES", { style: "currency", currency: "EUR" });

export default function ManualInvoiceModal({ open, invoiceId, onClose, onSaved }: Props) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [form, setForm] = useState({ issue_date: today(), due_date: "", status: "draft", recipient_name: "", recipient_tax_id: "", recipient_address: "", recipient_postal_code: "", recipient_city: "", recipient_province: "", recipient_country: "España", recipient_email: "", recipient_phone: "", notes: "" });
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [number, setNumber] = useState("Se asignará al guardar");
  const editable = !invoiceId || form.status === "draft";

  useEffect(() => {
    if (!open) return;
    setMessage("");
    if (!invoiceId) {
      setForm({ issue_date: today(), due_date: "", status: "draft", recipient_name: "", recipient_tax_id: "", recipient_address: "", recipient_postal_code: "", recipient_city: "", recipient_province: "", recipient_country: "España", recipient_email: "", recipient_phone: "", notes: "" });
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
      const response = await fetch(`/api/admin/invoices/manual?id=${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" });
      const json = await response.json();
      if (!response.ok || !json.ok) throw new Error(json.error || "LOAD_FAILED");
      const inv = json.invoice;
      setNumber(inv.invoice_number);
      setForm({ issue_date: inv.issue_date || today(), due_date: inv.due_date || "", status: inv.status || "draft", recipient_name: inv.recipient_name || "", recipient_tax_id: inv.recipient_tax_id || "", recipient_address: inv.recipient_address || "", recipient_postal_code: inv.recipient_postal_code || "", recipient_city: inv.recipient_city || "", recipient_province: inv.recipient_province || "", recipient_country: inv.recipient_country || "España", recipient_email: inv.recipient_email || "", recipient_phone: inv.recipient_phone || "", notes: inv.notes || "" });
      setLines((json.lines || []).map((line: Record<string, unknown>) => ({ id: String(line.id || ""), description: String(line.description || ""), quantity: Number(line.quantity || 0), unit_price: Number(line.unit_price || 0), discount_percent: Number(line.discount_percent || 0), vat_percent: Number(line.vat_percent || 0) })));
    } catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo cargar"); }
    finally { setLoading(false); }
  }

  const totals = useMemo(() => lines.reduce((acc, line) => {
    const gross = Math.max(0, line.quantity) * Math.max(0, line.unit_price);
    const discount = gross * Math.min(100, Math.max(0, line.discount_percent)) / 100;
    const base = gross - discount;
    const vat = base * Math.min(100, Math.max(0, line.vat_percent)) / 100;
    return { subtotal: acc.subtotal + gross, discount: acc.discount + discount, base: acc.base + base, vat: acc.vat + vat, total: acc.total + base + vat };
  }, { subtotal: 0, discount: 0, base: 0, vat: 0, total: 0 }), [lines]);

  function patchLine(index: number, patch: Partial<Line>) { setLines((current) => current.map((line, i) => i === index ? { ...line, ...patch } : line)); }

  async function save() {
    if (!editable) return;
    if (!form.recipient_name.trim() || !form.issue_date || lines.some((line) => !line.description.trim() || line.quantity <= 0 || line.unit_price < 0 || line.discount_percent < 0 || line.discount_percent > 100 || line.vat_percent < 0 || line.vat_percent > 100)) {
      setMessage("Revisa el destinatario, la fecha y todas las líneas."); return;
    }
    setSaving(true); setMessage("");
    try {
      const accessToken = await token();
      const response = await fetch("/api/admin/invoices/manual", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` }, body: JSON.stringify({ id: invoiceId || undefined, ...form, lines }) });
      const json = await response.json();
      if (!response.ok || !json.ok) throw new Error(json.error || "SAVE_FAILED");
      setMessage("Factura guardada correctamente."); onSaved(); onClose();
    } catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo guardar"); }
    finally { setSaving(false); }
  }

  async function setStatus(status: string) {
    if (!invoiceId) return;
    setSaving(true);
    try {
      const accessToken = await token();
      const response = await fetch("/api/admin/invoices/manual", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` }, body: JSON.stringify({ action: "set_status", id: invoiceId, status }) });
      const json = await response.json(); if (!response.ok || !json.ok) throw new Error(json.error || "STATUS_FAILED");
      setForm((current) => ({ ...current, status })); onSaved();
    } catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo actualizar"); }
    finally { setSaving(false); }
  }

  if (!open) return null;
  return <div className={styles.overlay} role="dialog" aria-modal="true">
    <div className={styles.modal}>
      <div className={styles.header}><div><span>Factura manual</span><h2>{number}</h2></div><button onClick={onClose} aria-label="Cerrar"><X /></button></div>
      <div className={styles.body}>{loading ? <div className={styles.loading}>Cargando…</div> : <>
        <section><h3>Datos de la factura</h3><div className={styles.grid3}><label>Fecha de emisión<input type="date" value={form.issue_date} disabled={!editable} onChange={(e)=>setForm({...form,issue_date:e.target.value})}/></label><label>Vencimiento<input type="date" value={form.due_date} disabled={!editable} onChange={(e)=>setForm({...form,due_date:e.target.value})}/></label><label>Estado<select value={form.status} disabled={!editable} onChange={(e)=>setForm({...form,status:e.target.value})}><option value="draft">Borrador</option><option value="issued">Emitida</option><option value="paid">Pagada</option><option value="cancelled">Cancelada</option></select></label></div></section>
        <section><h3>Destinatario</h3><div className={styles.grid3}><label>Nombre o razón social<input value={form.recipient_name} disabled={!editable} onChange={(e)=>setForm({...form,recipient_name:e.target.value})}/></label><label>NIF/CIF<input value={form.recipient_tax_id} disabled={!editable} onChange={(e)=>setForm({...form,recipient_tax_id:e.target.value})}/></label><label>Email<input type="email" value={form.recipient_email} disabled={!editable} onChange={(e)=>setForm({...form,recipient_email:e.target.value})}/></label><label>Dirección<input value={form.recipient_address} disabled={!editable} onChange={(e)=>setForm({...form,recipient_address:e.target.value})}/></label><label>Código postal<input value={form.recipient_postal_code} disabled={!editable} onChange={(e)=>setForm({...form,recipient_postal_code:e.target.value})}/></label><label>Ciudad<input value={form.recipient_city} disabled={!editable} onChange={(e)=>setForm({...form,recipient_city:e.target.value})}/></label><label>Provincia<input value={form.recipient_province} disabled={!editable} onChange={(e)=>setForm({...form,recipient_province:e.target.value})}/></label><label>País<input value={form.recipient_country} disabled={!editable} onChange={(e)=>setForm({...form,recipient_country:e.target.value})}/></label><label>Teléfono<input value={form.recipient_phone} disabled={!editable} onChange={(e)=>setForm({...form,recipient_phone:e.target.value})}/></label></div></section>
        <section><div className={styles.sectionTitle}><h3>Conceptos</h3>{editable&&<button onClick={()=>setLines([...lines,emptyLine()])}><Plus size={16}/> Añadir línea</button>}</div><div className={styles.lines}>{lines.map((line,index)=>{const gross=line.quantity*line.unit_price;const base=gross-(gross*line.discount_percent/100);const total=base+(base*line.vat_percent/100);return <div className={styles.line} key={line.id||index}><input className={styles.description} placeholder="Descripción del servicio" value={line.description} disabled={!editable} onChange={(e)=>patchLine(index,{description:e.target.value})}/><input type="number" min="0.01" step="0.01" value={line.quantity} disabled={!editable} onChange={(e)=>patchLine(index,{quantity:Number(e.target.value)})}/><input type="number" min="0" step="0.01" value={line.unit_price} disabled={!editable} onChange={(e)=>patchLine(index,{unit_price:Number(e.target.value)})}/><input type="number" min="0" max="100" value={line.discount_percent} disabled={!editable} onChange={(e)=>patchLine(index,{discount_percent:Number(e.target.value)})}/><input type="number" min="0" max="100" value={line.vat_percent} disabled={!editable} onChange={(e)=>patchLine(index,{vat_percent:Number(e.target.value)})}/><strong>{money(total)}</strong>{editable&&lines.length>1&&<button className={styles.trash} onClick={()=>setLines(lines.filter((_,i)=>i!==index))}><Trash2 size={16}/></button>}</div>})}</div></section>
        <section><label>Observaciones<textarea rows={3} value={form.notes} disabled={!editable} onChange={(e)=>setForm({...form,notes:e.target.value})}/></label></section>
        <div className={styles.totals}><div><span>Subtotal</span><b>{money(totals.subtotal)}</b></div><div><span>Descuentos</span><b>-{money(totals.discount)}</b></div><div><span>Base imponible</span><b>{money(totals.base)}</b></div><div><span>IVA</span><b>{money(totals.vat)}</b></div><div className={styles.grand}><span>Total</span><b>{money(totals.total)}</b></div></div>
      </>}</div>
      {message&&<div className={styles.message}>{message}</div>}
      <div className={styles.footer}>{invoiceId&&form.status!=="draft"?<><button onClick={()=>setStatus("paid")} disabled={saving||form.status==="paid"}>Marcar pagada</button><button onClick={()=>setStatus("cancelled")} disabled={saving||form.status==="cancelled"}>Cancelar factura</button></>:null}<button className={styles.secondary} onClick={onClose}>Cerrar</button>{editable&&<button className={styles.primary} onClick={save} disabled={saving}>{saving?"Guardando…":"Guardar factura"}</button>}</div>
    </div>
  </div>;
}
