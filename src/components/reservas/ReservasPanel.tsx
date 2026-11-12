"use client";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { getActiveBrand } from "@/components/global/BrandSwitcher";
import { reservaClosed, reservaDate, reservaDay, reservaInView, reservaTiming } from "@/lib/reservas";
import { reservaMutationInSnapshot, reservasFreshUrl } from "@/lib/reservas-sync";
import styles from "./ReservasPanel.module.css";
const sb = supabaseBrowser();
type Row = { id: string; numero_reserva?: number; cliente_id: string; cliente_nombre: string; telefono_normalizado: string; tarotista_id: string; tarotista_nombre: string; tarotista_nombre_manual: string; fecha_reserva: string; estado: string; nota: string; updated_at: string | null; deleted_at?: string | null };
type Action = "completar" | "aplazar" | "cancelar" | "eliminar" | "confirmar" | "nota";
const labels: Record<string,string> = { pendiente: "Pendiente", confirmada: "Confirmada", completada: "Cumplida", finalizada: "Cumplida", cancelada: "Cancelada" };
const tarotista = (r: Row) => r.tarotista_nombre || r.tarotista_nombre_manual || "Sin asignar";
const fecha = (value: string) => reservaDate(value).toLocaleString("es-ES", { timeZone: "Europe/Madrid", dateStyle: "medium", timeStyle: "short" });
const referencia = (row: Row) => row.numero_reserva ? `R-${String(row.numero_reserva).padStart(5,"0")}` : row.id;
export default function ReservasPanel({ mode = "admin", embedded = false }: { mode?: "admin" | "central"; embedded?: boolean }) {
  const [now,setNow] = useState(() => Date.now());
  const [view,setView] = useState("agenda");
  const [visibleCount,setVisibleCount] = useState(50);
  const [lastSync,setLastSync] = useState("");
  const [brand,setBrand] = useState("celestial");
  const [rows,setRows] = useState<Row[]>([]);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const [notice,setNotice] = useState("");
  const [q,setQ] = useState("");
  const [filter,setFilter] = useState("pendientes");
  const [reader,setReader] = useState("");
  const [day,setDay] = useState("");
  const [edit,setEdit] = useState<{row:Row;action:Action} | null>(null);
  const [newDate,setNewDate] = useState("");
  const [reason,setReason] = useState("");
  const [saving,setSaving] = useState(false);
  const [focusId,setFocusId] = useState("");
  const [zone,setZone] = useState("");
  const serial = useRef(0), savingRef = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const cancelDelete = useRef<HTMLButtonElement>(null);
  const dialogTitleId = useId(), deleteDescriptionId = useId();
  async function token() {
    const { data } = await sb.auth.getSession();
    if (!data.session?.access_token) throw new Error("Tu sesión ha caducado. Vuelve a iniciar sesión.");
    return data.session.access_token;
  }
  const fetchSnapshot = useCallback(async (): Promise<Row[]> => {
    const res = await fetch(reservasFreshUrl(`/api/crm/reservas/listar?brand=${brand}`), {
      headers: { Authorization: `Bearer ${await token()}`, "Cache-Control": "no-cache", Pragma: "no-cache" },
      cache: "no-store",
    });
    const result = await res.json();
    if (!res.ok || result.ok !== true || !Array.isArray(result.reservas)) {
      throw new Error(result.error || "No se pudieron cargar las reservas.");
    }
    return result.reservas.filter((row: Row) => !row.deleted_at);
  }, [brand]);
  const load = useCallback(async (silent = false, preserveError = false) => {
    if (savingRef.current) return;
    const id = ++serial.current;
    if (!silent) setBusy(true);
    try {
      const snapshot = await fetchSnapshot();
      if (id === serial.current) {
        setRows(snapshot);
        setLastSync(new Date().toISOString());
        if (!preserveError) setError("");
      }
    } catch (e: any) { if (id === serial.current) setError(e.message); }
    finally { if (id === serial.current) setBusy(false); }
  },[fetchSnapshot]);
  useEffect(() => {
    setZone("Europe/Madrid");
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
    const clock = setInterval(() => setNow(Date.now()),15000);
    window.addEventListener("focus",visible); window.addEventListener("online",visible); document.addEventListener("visibilitychange",visible);
    const open = (event: Event) => { const id=String((event as CustomEvent).detail?.id || ""); setView("historial"); setFilter("todas"); setQ(""); setReader(""); setDay(""); setFocusId(id); refresh(); };
    const changed = (event: Event) => {
      const detail = (event as CustomEvent).detail || {};
      const id = String(detail?.id || detail?.reserva?.id || "");
      const reserva = detail?.reserva as Row | undefined;
      if (id && (detail.deleted || reserva?.deleted_at)) {
        serial.current++;
        setBusy(false);
        setRows(prev => prev.filter(row => row.id !== id));
        setFocusId(current => current === id ? "" : current);
        refresh();
        return;
      }
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
        setView("agenda");
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
    return () => { serial.current++; clearTimeout(timer); clearInterval(fallback); clearInterval(clock); void sb.removeChannel(channel); window.removeEventListener("focus",visible); window.removeEventListener("online",visible); document.removeEventListener("visibilitychange",visible); window.removeEventListener("reservas-open-item",open); window.removeEventListener("tc-reservation-changed", changed as EventListener); };
  },[load,mode,brand]);
  useEffect(() => { if (focusId) document.getElementById(`reserva-${focusId}`)?.scrollIntoView({block:"center",behavior:"smooth"}); },[focusId,rows,visibleCount]);
  useEffect(() => {
    if (edit) {
      if (!dialog.current?.open) dialog.current?.showModal();
      if (edit.action === "eliminar") cancelDelete.current?.focus();
    } else dialog.current?.close();
  },[edit]);
  const ordered = useMemo(() => [...rows].sort((a,b) => reservaDate(a.fecha_reserva).getTime()-reservaDate(b.fecha_reserva).getTime() || a.id.localeCompare(b.id)),[rows]);
  const queue = useMemo(() => {
    const counters = new Map<string,number>(), result = new Map<string,number>();
    ordered.filter(r=>!reservaClosed(r.estado)).forEach(r=>{const key=`${reservaDay(r.fecha_reserva)}:${r.tarotista_id || tarotista(r)}`;const n=(counters.get(key)||0)+1;counters.set(key,n);result.set(r.id,n);});
    return result;
  },[ordered]);
  const filtered = ordered.filter(r=>{
    if (!reservaInView(r,view,now)) return false;
    if (filter === "pendientes" && reservaClosed(r.estado)) return false;
    if (filter === "cumplidas" && !["completada","finalizada"].includes(r.estado)) return false;
    if (filter === "canceladas" && r.estado !== "cancelada") return false;
    if (reader && tarotista(r)!==reader) return false;
    if (day && reservaDay(r.fecha_reserva) !== day) return false;
    return `${r.numero_reserva || ""} ${r.id} ${r.cliente_nombre} ${r.telefono_normalizado} ${tarotista(r)}`.toLowerCase().includes(q.trim().toLowerCase());
  });
  const upcoming = ordered.find(row => !reservaClosed(row.estado) && reservaDate(row.fecha_reserva).getTime() > now);
  useEffect(() => { setVisibleCount(50); }, [q,filter,reader,day,view]);
  useEffect(() => { const index = filtered.findIndex(row => row.id === focusId); if (index >= visibleCount) setVisibleCount(index + 1); }, [focusId,ordered,q,filter,reader,day,view,visibleCount]);
  function openAction(row:Row,action:Action) {if(savingRef.current)return;setEdit({row,action});setNewDate("");setReason("");setNotice("");setError("");}
  async function save(event:React.FormEvent) {
    event.preventDefault(); if (!edit || savingRef.current) return;
    savingRef.current=true;serial.current++;setBusy(false);setSaving(true);setError("");
    let refreshAfter = false, verified = false;
    try {
      const res=await fetch("/api/crm/reservas/actualizar",{method:"POST",cache:"no-store",headers:{Authorization:`Bearer ${await token()}`,"Content-Type":"application/json"},body:JSON.stringify({id:edit.row.id,version:edit.row.updated_at,action:edit.action,motivo:reason,fecha_reserva:newDate?new Date(newDate).toISOString():undefined,...(edit.action==="eliminar"?{confirmed:true}:{})})});
      const result=await res.json();
      if(!res.ok || result.ok !== true) {
        if(res.status===409) {setEdit(null);refreshAfter=true;}
        throw new Error(result.error || "No se pudo guardar.");
      }
      if (!result.reserva?.id || result.reserva.id !== edit.row.id || (edit.action === "eliminar" && !result.reserva.deleted_at)) {
        throw new Error("El servidor no ha confirmado el cambio. Actualiza la agenda antes de continuar.");
      }
      setEdit(null);
      refreshAfter = true;
      // No mostramos éxito por un cambio solo en pantalla: comprobamos una nueva
      // lectura independiente, incluso si la reserva se ha eliminado.
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const snapshot = await fetchSnapshot();
          if (!reservaMutationInSnapshot(edit.action, result.reserva, snapshot)) continue;
          verified = true;
          serial.current++;
          setRows(snapshot);
          setLastSync(new Date().toISOString());
          setError("");
          if (edit.action === "eliminar") setFocusId(current => current === edit.row.id ? "" : current);
          setNotice(edit.action === "eliminar" ? "Reserva eliminada y verificada en la agenda. Su registro interno se conserva." : "Cambio guardado y verificado en la agenda.");
          window.dispatchEvent(new CustomEvent("tc-reservation-changed", { detail: { id: edit.row.id, reserva: result.reserva, deleted: edit.action === "eliminar" } }));
          break;
        } catch {
          // Si la lectura falla, las siguientes lecturas utilizan una URL nueva.
        }
      }
      if (!verified) {
        setNotice("");
        setError("El servidor recibió el cambio, pero no se pudo comprobar en una lectura nueva. No lo damos por confirmado; actualiza la agenda.");
      }
    }catch(e:any){setError(e.message);}finally{savingRef.current=false;setSaving(false);if(refreshAfter && !verified)void load(true,true);}
  }
  return <section className={`${styles.panel} ${embedded?"":"tc-card"}`}>
    <header className={styles.header}><div><span className={styles.eyebrow}>AGENDA DE ATENCIÓN</span><h2>Reservas</h2><p>Las reservas de hoy y las próximas primero. Las pendientes antiguas siguen disponibles en Atrasadas e Historial.</p></div><div className={styles.actions}>
      <a className="tc-btn tc-btn-gold" href="?tab=crm">Nueva reserva en CRM</a>
      <button className="tc-btn" disabled={busy || saving} onClick={()=>void load()}>{busy?"Actualizando…":"Actualizar"}</button></div></header>
    <div className={styles.summary}><span><b>{rows.filter(r=>!reservaClosed(r.estado)).length}</b> pendientes</span><span><b>{rows.filter(r=>["completada","finalizada"].includes(r.estado)).length}</b> cumplidas</span><span>Horarios: <b>{zone || "hora local"}</b></span></div>
    <p className={styles.sync} role="status">{error ? "Sincronización pendiente" : lastSync ? `Actualizado a las ${new Date(lastSync).toLocaleTimeString("es-ES", {timeZone:"Europe/Madrid"})} · Aviso 5 min antes y alerta a la hora` : "Conectando con la agenda…"}</p>
    <nav className={styles.views} aria-label="Vista de la agenda">{[["agenda","Agenda"],["hoy","Hoy"],["proximas","Próximas"],["atrasadas","Atrasadas"],["historial","Historial"]].map(([key,label]) => <button key={key} aria-pressed={view===key} onClick={() => {setView(key);setFocusId("");if(key!=="historial")setFilter("pendientes");else setFilter("todas");}}>{label} <b>{rows.filter(row => (key === "historial" || !reservaClosed(row.estado)) && reservaInView(row,key,now)).length}</b></button>)}</nav>
    {upcoming && <div className={styles.next}><div><span>PRÓXIMA RESERVA · {reservaTiming(upcoming.fecha_reserva,now)}</span><strong>{upcoming.cliente_nombre} · {tarotista(upcoming)}</strong><small>{fecha(upcoming.fecha_reserva)} · Madrid</small></div><button className="tc-btn tc-btn-gold" onClick={() => {setView("historial");setFilter("todas");setQ("");setReader("");setDay("");setFocusId(upcoming.id);}}>Ver reserva</button></div>}
    <div className={styles.filters}>
      <label>Cliente, teléfono o referencia<input className="tc-input" value={q} onChange={e=>setQ(e.target.value)} placeholder="Buscar reserva…" /></label>
      <label>Tarotista<select className="tc-select" value={reader} onChange={e=>setReader(e.target.value)}><option value="">Todas</option>{Array.from(new Set(rows.map(tarotista))).sort().map(n=><option key={n}>{n}</option>)}</select></label>
      <label>Estado<select className="tc-select" value={filter} onChange={e=>setFilter(e.target.value)}><option value="pendientes">Pendientes</option><option value="cumplidas">Cumplidas</option><option value="canceladas">Canceladas</option><option value="todas">Todas</option></select></label>
      <label>Fecha<input className="tc-input" type="date" value={day} onChange={e=>setDay(e.target.value)} /></label>
    </div>
    {error && !edit && <p role="alert" className={styles.error}>{error}</p>}{notice && <p role="status">{notice}</p>}
    <p className={styles.sync}>{filtered.length} reservas encontradas</p>
    <div className={styles.list}>{filtered.slice(0,visibleCount).map(r=><article className={styles.card} key={r.id} id={`reserva-${r.id}`} data-focused={focusId===r.id}>
      <div className={styles.cardTop}><div><span className={styles.eyebrow}>{queue.has(r.id)?`TURNO ${queue.get(r.id)} · ${tarotista(r)}`:tarotista(r)}</span><h3>{r.cliente_nombre || "Cliente sin nombre"}</h3>{r.telefono_normalizado && <a href={`tel:${r.telefono_normalizado.replace(/[^+\d]/g,"")}`}>{r.telefono_normalizado}</a>}</div><span className={styles.status}>{labels[r.estado] || r.estado}</span></div>
      <p className={styles.time}>{fecha(r.fecha_reserva)} · Madrid {!reservaClosed(r.estado) && <span data-overdue={reservaDate(r.fecha_reserva).getTime()<now}>{reservaTiming(r.fecha_reserva,now)}</span>}</p><div className={styles.reference}>N.º de reserva: <span title={r.id}>{referencia(r)}</span></div>
      {r.nota && <details><summary>Notas e historial</summary><p className={styles.notes}>{r.nota}</p></details>}
      <div className={styles.actions}>
        {!reservaClosed(r.estado) && <>{r.estado !== "confirmada" && <button className="tc-btn" onClick={()=>openAction(r,"confirmar")}>Confirmar asistencia</button>}<button className="tc-btn" onClick={()=>openAction(r,"nota")}>Añadir nota</button><button className="tc-btn tc-btn-ok" onClick={()=>openAction(r,"completar")}>Cumplió reserva</button><button className="tc-btn tc-btn-gold" onClick={()=>openAction(r,"aplazar")}>Aplazar reserva</button><button className="tc-btn" onClick={()=>openAction(r,"cancelar")}>Cancelar</button></>}
        <button className={`tc-btn ${styles.deleteButton}`} onClick={()=>openAction(r,"eliminar")}>Eliminar reserva</button>
      </div>
    </article>)}</div>
    {filtered.length > visibleCount && <button className="tc-btn" onClick={() => setVisibleCount(count => count + 50)}>Ver más reservas ({filtered.length - visibleCount})</button>}
    {!busy && !filtered.length && <p className={styles.empty}>No hay reservas con estos filtros.</p>}
    <dialog ref={dialog} className={styles.dialog} aria-labelledby={dialogTitleId} aria-describedby={edit?.action==="eliminar"?deleteDescriptionId:undefined} aria-busy={saving} onCancel={e=>{if(savingRef.current)e.preventDefault();else setEdit(null);}} onClose={()=>{if(!savingRef.current)setEdit(null);}}>
      {edit && <form onSubmit={save}><h3 id={dialogTitleId}>{edit.action==="eliminar"?"¿Eliminar esta reserva?":edit.action==="aplazar"?"Aplazar reserva":edit.action==="completar"?"Confirmar reserva cumplida":edit.action==="confirmar"?"Confirmar asistencia":edit.action==="nota"?"Añadir nota operativa":"Cancelar reserva"}</h3>
        <div className={styles.dialogReservation}><p><strong>{edit.row.cliente_nombre || "Cliente sin nombre"}</strong> · {tarotista(edit.row)}</p>{edit.action==="eliminar" && <p className={styles.reference}>N.º de reserva: {referencia(edit.row)}</p>}<p>Horario actual: {fecha(edit.row.fecha_reserva)}</p></div>
        {edit.action==="eliminar" && <p id={deleteDescriptionId} className={styles.deleteExplanation}>Se retirará de la agenda y dejará de generar avisos. Su registro interno se conservará.</p>}
        {edit.action==="aplazar" && <label>Nuevo horario · {Intl.DateTimeFormat().resolvedOptions().timeZone}<input autoFocus required disabled={saving} type="datetime-local" className="tc-input" value={newDate} onChange={e=>setNewDate(e.target.value)} /></label>}
        <label>{edit.action==="aplazar"?"Motivo del aplazamiento":"Observación (opcional)"}<textarea className="tc-input" disabled={saving} required={edit.action==="aplazar" || edit.action==="nota"} maxLength={500} value={reason} onChange={e=>setReason(e.target.value)} /></label>
        {error && <p role="alert" className={styles.error}>{error}</p>}
        <div className={styles.actions}><button ref={cancelDelete} autoFocus={edit.action==="eliminar"} type="button" className="tc-btn" disabled={saving} onClick={()=>{if(!savingRef.current)setEdit(null);}}>{edit.action==="eliminar"?"Cancelar":"Volver"}</button><button type="submit" className={edit.action==="eliminar"?`tc-btn ${styles.deleteConfirm}`:"tc-btn tc-btn-gold"} disabled={saving}>{saving?(edit.action==="eliminar"?"Eliminando…":"Guardando…"):edit.action==="eliminar"?"Sí, eliminar reserva":"Confirmar"}</button></div>
      </form>}
    </dialog>
  </section>;
}
