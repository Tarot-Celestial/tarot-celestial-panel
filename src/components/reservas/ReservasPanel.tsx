"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { getActiveBrand } from "@/components/global/BrandSwitcher";
import { reservaClosed, reservaDate } from "@/lib/reservas";
import styles from "./ReservasPanel.module.css";
const sb = supabaseBrowser();
type Row = { id: string; numero_reserva?: number; cliente_id: string; cliente_nombre: string; telefono_normalizado: string; tarotista_id: string; tarotista_nombre: string; tarotista_nombre_manual: string; fecha_reserva: string; estado: string; nota: string; updated_at: string | null };
const labels: Record<string,string> = { pendiente: "Pendiente", confirmada: "Confirmada", completada: "Cumplida", finalizada: "Cumplida", cancelada: "Cancelada" };
const tarotista = (r: Row) => r.tarotista_nombre || r.tarotista_nombre_manual || "Sin asignar";
const fecha = (value: string) => reservaDate(value).toLocaleString("es-ES", { dateStyle: "medium", timeStyle: "short" });
export default function ReservasPanel({ mode = "admin", embedded = false }: { mode?: "admin" | "central"; embedded?: boolean }) {
  const [brand,setBrand] = useState("celestial");
  const [rows,setRows] = useState<Row[]>([]);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const [notice,setNotice] = useState("");
  const [q,setQ] = useState("");
  const [filter,setFilter] = useState("pendientes");
  const [reader,setReader] = useState("");
  const [day,setDay] = useState("");
  const [edit,setEdit] = useState<{row:Row;action:string} | null>(null);
  const [newDate,setNewDate] = useState("");
  const [reason,setReason] = useState("");
  const [saving,setSaving] = useState(false);
  const [focusId,setFocusId] = useState("");
  const [zone,setZone] = useState("");
  const serial = useRef(0), savingRef = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  async function token() {
    const { data } = await sb.auth.getSession();
    if (!data.session?.access_token) throw new Error("Tu sesión ha caducado. Vuelve a iniciar sesión.");
    return data.session.access_token;
  }
  const load = useCallback(async (silent = false) => {
    const id = ++serial.current;
    if (!silent) setBusy(true);
    try {
      const res = await fetch(`/api/crm/reservas/listar?brand=${brand}`, { headers: { Authorization: `Bearer ${await token()}` }, cache: "no-store" });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "No se pudieron cargar las reservas.");
      if (id === serial.current) { setRows(result.reservas || []); setError(""); }
    } catch (e: any) { if (id === serial.current) setError(e.message); }
    finally { if (id === serial.current) setBusy(false); }
  },[brand]);
  useEffect(() => {
    setZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
    setBrand(getActiveBrand());
    const change = () => setBrand(getActiveBrand());
    window.addEventListener("tc-brand-changed",change);
    return () => window.removeEventListener("tc-brand-changed",change);
  },[]);
  useEffect(() => {
    void load();
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => { clearTimeout(timer); timer = setTimeout(() => void load(true),250); };
    const visible = () => { if (document.visibilityState === "visible") refresh(); };
    const channel = sb.channel(`reservas-panel-${mode}-${brand}`).on("postgres_changes", { event:"*",schema:"public",table:"reservas" },refresh).subscribe(status => { if (status === "SUBSCRIBED") refresh(); });
    const fallback = setInterval(visible,15000);
    window.addEventListener("focus",visible); window.addEventListener("online",visible); document.addEventListener("visibilitychange",visible);
    const open = (event: Event) => { const id=String((event as CustomEvent).detail?.id || ""); setFilter("todas"); setQ(""); setReader(""); setDay(""); setFocusId(id); refresh(); };
    const changed = (event: Event) => {
      const detail = (event as CustomEvent).detail || {};
      const id = String(detail?.id || detail?.reserva?.id || "");
      const reserva = detail?.reserva as Row | undefined;
      if (reserva?.id) {
        setRows((prev) => {
          const index = prev.findIndex((row) => row.id === reserva.id);
          if (index < 0) return [reserva, ...prev];
          const next = [...prev];
          next[index] = { ...next[index], ...reserva };
          return next;
        });
      }
      if (id) {
        setFilter("pendientes");
        setQ("");
        setReader("");
        setDay("");
        setFocusId(id);
      }
      refresh();
    };
    window.addEventListener("reservas-open-item",open);
    window.addEventListener("tc-reservation-changed", changed as EventListener);
    const requestedId = new URLSearchParams(window.location.search).get("reserva");
    if (requestedId) {
      setFilter("todas"); setQ(""); setReader(""); setDay(""); setFocusId(requestedId);
    }
    return () => { serial.current++; clearTimeout(timer); clearInterval(fallback); void sb.removeChannel(channel); window.removeEventListener("focus",visible); window.removeEventListener("online",visible); document.removeEventListener("visibilitychange",visible); window.removeEventListener("reservas-open-item",open); window.removeEventListener("tc-reservation-changed", changed as EventListener); };
  },[load,mode,brand]);
  useEffect(() => { if (focusId) document.getElementById(`reserva-${focusId}`)?.scrollIntoView({block:"center",behavior:"smooth"}); },[focusId,rows]);
  useEffect(() => { if (edit) dialog.current?.showModal(); else dialog.current?.close(); },[edit]);
  const ordered = useMemo(() => [...rows].sort((a,b) => reservaDate(a.fecha_reserva).getTime()-reservaDate(b.fecha_reserva).getTime() || a.id.localeCompare(b.id)),[rows]);
  const queue = useMemo(() => {
    const counters = new Map<string,number>(), result = new Map<string,number>();
    ordered.filter(r=>!reservaClosed(r.estado)).forEach(r=>{const key=r.tarotista_id || tarotista(r);const n=(counters.get(key)||0)+1;counters.set(key,n);result.set(r.id,n);});
    return result;
  },[ordered]);
  const filtered = ordered.filter(r=>{
    if (filter === "pendientes" && reservaClosed(r.estado)) return false;
    if (filter === "cumplidas" && !["completada","finalizada"].includes(r.estado)) return false;
    if (filter === "canceladas" && r.estado !== "cancelada") return false;
    if (reader && tarotista(r)!==reader) return false;
    if (day) {const d=reservaDate(r.fecha_reserva);if (`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`!==day)return false;}
    return `${r.numero_reserva || ""} ${r.id} ${r.cliente_nombre} ${r.telefono_normalizado} ${tarotista(r)}`.toLowerCase().includes(q.trim().toLowerCase());
  });
  function openAction(row:Row,action:string) {setEdit({row,action});setNewDate("");setReason("");setNotice("");setError("");}
  async function save(event:React.FormEvent) {
    event.preventDefault(); if (!edit || savingRef.current) return;
    savingRef.current=true;setSaving(true);setError("");
    try {
      const res=await fetch("/api/crm/reservas/actualizar",{method:"POST",headers:{Authorization:`Bearer ${await token()}`,"Content-Type":"application/json"},body:JSON.stringify({id:edit.row.id,version:edit.row.updated_at,action:edit.action,motivo:reason,fecha_reserva:newDate?new Date(newDate).toISOString():undefined})});
      const result=await res.json();if(!res.ok)throw new Error(result.error || "No se pudo guardar.");
      setRows(prev=>prev.map(r=>r.id===result.reserva.id?result.reserva:r));setEdit(null);setNotice("Reserva actualizada correctamente.");void load(true);
    }catch(e:any){setError(e.message);}finally{savingRef.current=false;setSaving(false);}
  }
  return <section className={`${styles.panel} ${embedded?"":"tc-card"}`}>
    <header className={styles.header}><div><span className={styles.eyebrow}>AGENDA DE ATENCIÓN</span><h2>Reservas</h2><p>Ordenadas por horario. Cada tarotista tiene su propia cola de atención.</p></div><div className={styles.actions}>
      {mode==="central" && <a className="tc-btn tc-btn-gold" href="/panel-central?tab=crm">Nueva reserva en CRM</a>}
      <button className="tc-btn" disabled={busy} onClick={()=>void load()}>{busy?"Actualizando…":"Actualizar"}</button></div></header>
    <div className={styles.summary}><span><b>{rows.filter(r=>!reservaClosed(r.estado)).length}</b> pendientes</span><span><b>{rows.filter(r=>["completada","finalizada"].includes(r.estado)).length}</b> cumplidas</span><span>Horarios: <b>{zone || "hora local"}</b></span></div>
    <div className={styles.filters}>
      <label>Cliente, teléfono o referencia<input className="tc-input" value={q} onChange={e=>setQ(e.target.value)} placeholder="Buscar reserva…" /></label>
      <label>Tarotista<select className="tc-select" value={reader} onChange={e=>setReader(e.target.value)}><option value="">Todas</option>{Array.from(new Set(rows.map(tarotista))).sort().map(n=><option key={n}>{n}</option>)}</select></label>
      <label>Estado<select className="tc-select" value={filter} onChange={e=>setFilter(e.target.value)}><option value="pendientes">Pendientes</option><option value="cumplidas">Cumplidas</option><option value="canceladas">Canceladas</option><option value="todas">Todas</option></select></label>
      <label>Fecha<input className="tc-input" type="date" value={day} onChange={e=>setDay(e.target.value)} /></label>
    </div>
    {error && !edit && <p role="alert" className={styles.error}>{error}</p>}{notice && <p role="status">{notice}</p>}
    <div className={styles.list}>{filtered.map(r=><article className={styles.card} key={r.id} id={`reserva-${r.id}`} data-focused={focusId===r.id}>
      <div className={styles.cardTop}><div><span className={styles.eyebrow}>{queue.has(r.id)?`TURNO ${queue.get(r.id)} · ${tarotista(r)}`:tarotista(r)}</span><h3>{r.cliente_nombre || "Cliente sin nombre"}</h3>{r.telefono_normalizado && <a href={`tel:${r.telefono_normalizado.replace(/[^+\d]/g,"")}`}>{r.telefono_normalizado}</a>}</div><span className={styles.status}>{labels[r.estado] || r.estado}</span></div>
      <p className={styles.time}>{fecha(r.fecha_reserva)}</p><div className={styles.reference}>N.º de reserva: <span title={r.id}>{r.numero_reserva ? `R-${String(r.numero_reserva).padStart(5,"0")}` : r.id}</span></div>
      {r.nota && <details><summary>Notas e historial</summary><p className={styles.notes}>{r.nota}</p></details>}
      {!reservaClosed(r.estado) && <div className={styles.actions}><button className="tc-btn tc-btn-ok" onClick={()=>openAction(r,"completar")}>Cumplió reserva</button><button className="tc-btn tc-btn-gold" onClick={()=>openAction(r,"aplazar")}>Aplazar reserva</button><button className="tc-btn" onClick={()=>openAction(r,"cancelar")}>Cancelar</button></div>}
    </article>)}</div>
    {!busy && !filtered.length && <p className={styles.empty}>No hay reservas con estos filtros.</p>}
    <dialog ref={dialog} className={styles.dialog} onCancel={e=>{if(saving)e.preventDefault();else setEdit(null);}} onClose={()=>{if(!saving)setEdit(null);}}>
      {edit && <form onSubmit={save}><h3>{edit.action==="aplazar"?"Aplazar reserva":edit.action==="completar"?"Confirmar reserva cumplida":"Cancelar reserva"}</h3><p>{edit.row.cliente_nombre} · {tarotista(edit.row)}</p><p>Horario actual: {fecha(edit.row.fecha_reserva)}</p>
        {edit.action==="aplazar" && <label>Nuevo horario · {zone}<input autoFocus required type="datetime-local" className="tc-input" value={newDate} onChange={e=>setNewDate(e.target.value)} /></label>}
        <label>{edit.action==="aplazar"?"Motivo del aplazamiento":"Observación (opcional)"}<textarea className="tc-input" required={edit.action==="aplazar"} maxLength={500} value={reason} onChange={e=>setReason(e.target.value)} /></label>
        {error && <p role="alert" className={styles.error}>{error}</p>}
        <div className={styles.actions}><button type="button" className="tc-btn" disabled={saving} onClick={()=>setEdit(null)}>Volver</button><button className="tc-btn tc-btn-gold" disabled={saving}>{saving?"Guardando…":"Confirmar"}</button></div>
      </form>}
    </dialog>
  </section>;
}
