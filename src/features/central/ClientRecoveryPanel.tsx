"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, Clock3, History, MessageCircle, Phone, Recycle, RefreshCw, Search, ShoppingBag, Sparkles, X } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { recoveryLabels, type RecoveryBucket, type RecoveryContact, type RecoveryHistory, type RecoveryPayment } from "@/lib/client-recovery";
import styles from "./ClientRecoveryPanel.module.css";
const sb = supabaseBrowser();
const date = (v: string | null) => v ? new Date(v).toLocaleString("es-ES", { dateStyle: "medium", timeStyle: "short" }) : "Sin gestión registrada";
const money = (v: number) => new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(v);
const titles = { contacted: "Fue contactada", no_response: "No responde al WhatsApp", recycled: "Enviar a reciclaje", recovered: "Realizó promo reencuentro", restore: "Devolver a seguimiento", history: "Historial de gestiones" };
type Action = keyof typeof titles;
type Feed = { contacts: RecoveryContact[]; total: number; counts: Record<RecoveryBucket, number>; tags: string[] };
async function request(query: string, body?: object, signal?: AbortSignal) {
 const { data } = await sb.auth.getSession();
 if (!data.session) throw new Error("Tu sesión ha terminado. Vuelve a entrar.");
 const response = await fetch("/api/central/client-recovery" + query, { method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${data.session.access_token}`, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined, cache: "no-store", signal });
 const result = await response.json();
 if (!response.ok || !result.ok) throw new Error(result.error || "No se pudo completar la gestión.");
 return result;
}
export default function ClientRecoveryPanel({ onXpChange }: { onXpChange?: () => void }) {
 const [bucket, setBucket] = useState<RecoveryBucket>("pending"), [status, setStatus] = useState(""), [tag, setTag] = useState(""), [search, setSearch] = useState(""), [query, setQuery] = useState(""), [page, setPage] = useState(1);
 const [feed, setFeed] = useState<Feed | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState(""), [notice, setNotice] = useState("");
 const [modal, setModal] = useState<{ client: RecoveryContact; action: Action } | null>(null);
 const [payments, setPayments] = useState<RecoveryPayment[]>([]), [history, setHistory] = useState<RecoveryHistory[]>([]), [payment, setPayment] = useState(""), [note, setNote] = useState(""), [saving, setSaving] = useState(false), [detailLoading, setDetailLoading] = useState(false), [modalError, setModalError] = useState("");
 const generation = useRef(0), dialog = useRef<HTMLDivElement>(null), busy = useRef(false);
 useEffect(() => { const id = setTimeout(() => { setQuery(search.trim()); setPage(1); }, 300); return () => clearTimeout(id); }, [search]);
 const load = useCallback(async (silent = false) => {
  const seq = ++generation.current;
  if (!silent) setLoading(true);
  try {
   const result = await request("?" + new URLSearchParams({ bucket, status, tag, q: query, page: String(page) }));
   if (seq !== generation.current) return;
   if (!result.contacts.length && page > 1 && result.total <= (page - 1) * 25) { setPage(Math.max(1, Math.ceil(result.total / 25))); return; }
   setFeed(result); setError("");
  } catch (e: any) { if (seq === generation.current) setError(e.message); }
  finally { if (seq === generation.current) setLoading(false); }
 }, [bucket, status, tag, query, page]);
 useEffect(() => { void load(); return () => { generation.current++; }; }, [load]);
 useEffect(() => { const refresh = () => { if (!document.hidden && !busy.current) void load(true); }; const timer = setInterval(refresh,30000); window.addEventListener("focus",refresh); return () => { clearInterval(timer); window.removeEventListener("focus",refresh); }; }, [load]);
 useEffect(() => {
  if (!modal) return;
  const previous = document.activeElement as HTMLElement | null;
  dialog.current?.focus();
  const key = (e: KeyboardEvent) => {
   if (e.key === "Escape" && !busy.current) setModal(null);
   if (e.key !== "Tab") return;
   const nodes = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]');
   if (!nodes?.length) return;
   const first = nodes[0], last = nodes[nodes.length-1];
   if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { e.preventDefault(); last.focus(); }
   else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  const old = document.body.style.overflow; document.body.style.overflow = "hidden"; document.addEventListener("keydown",key);
  return () => { document.body.style.overflow = old; document.removeEventListener("keydown",key); previous?.focus(); };
 }, [modal]);
 useEffect(() => {
  if (!modal || !["recovered","history"].includes(modal.action)) return;
  const controller = new AbortController(); setDetailLoading(true);
  request("?client_id=" + modal.client.id, undefined, controller.signal).then(result => { setPayments(result.payments); setHistory(result.history); }).catch(e => { if (!controller.signal.aborted) setModalError(e.message); }).finally(() => { if (!controller.signal.aborted) setDetailLoading(false); });
  return () => controller.abort();
 }, [modal]);
 function open(client: RecoveryContact, action: Action) { setPayments([]); setHistory([]); setPayment(""); setNote(""); setModalError(""); setDetailLoading(["recovered","history"].includes(action)); setModal({client,action}); }
 async function submit() {
  if (!modal || busy.current || modal.action === "history") return;
  busy.current = true; setSaving(true); setModalError("");
  try {
   const result = await request("", { client_id: modal.client.id, action: modal.action, version: modal.client.version, payment_id: payment || null, note });
   setNotice(result.status === "recovered" ? "Cliente en recuperados. 75 XP registrados para la central responsable, una sola vez." : result.status === "recycled" ? "Contacto trasladado a Reciclaje. Su historial se conserva." : "Estado guardado. El contacto continúa en seguimiento.");
   setModal(null); await load(); if (result.status === "recovered") onXpChange?.();
  } catch (e: any) { setModalError(e.message); }
  finally { busy.current = false; setSaving(false); }
 }
 return <section className={styles.panel} aria-label="Recuperación de clientes">
  <header className={styles.header}><div><span className={styles.eyebrow}>CENTRAL · FIDELIZACIÓN</span><h1>Recuperación de clientes</h1><p>Retoma el contacto. Registra cada gestión.</p></div><button className={styles.refresh} onClick={() => void load()} disabled={loading}><RefreshCw size={16}/> Actualizar</button></header>
  <div className={styles.rule}><Clock3 size={21}/><div><strong>Hasta junio de 2026 + sin etiqueta</strong><p>Se excluyen contactos con cualquier etiqueta desde julio de 2026. Las etiquetas sin fecha reconocible no se consideran antiguas.</p></div></div>
  <div className={styles.tabs} role="tablist" aria-label="Bandejas de recuperación">{([['pending','Por recuperar'],['recycled','Reciclaje'],['recovered','Clientes recuperados']] as const).map(([key,label]) => <button key={key} role="tab" aria-selected={bucket === key} onClick={() => { setBucket(key); setStatus(""); setPage(1); }}>{label}<span>{feed?.counts[key] ?? "—"}</span></button>)}</div>
  <div className={styles.filters}><label><Search size={18}/><input aria-label="Buscar nombre o teléfono" placeholder="Buscar nombre o teléfono" value={search} onChange={e => setSearch(e.target.value)}/></label><select aria-label="Filtrar por estado" value={status} disabled={bucket !== "pending"} onChange={e => { setStatus(e.target.value); setPage(1); }}><option value="">Todos los estados</option><option value="pending">Pendiente de contactar</option><option value="contacted">Contactada · Esperando resultado</option><option value="no_response">Sin respuesta · Decidir reciclaje</option></select><select aria-label="Filtrar por etiqueta" value={tag} onChange={e => { setTag(e.target.value); setPage(1); }}><option value="">Todas las etiquetas</option><option value="__none__">Sin etiqueta</option>{feed?.tags.map(t => <option key={t} value={t}>{t}</option>)}</select></div>
  {notice && <p role="status" className={styles.notice}>{notice}</p>}{error && <p role="alert" className={styles.error}>{error} <button onClick={() => void load()}>Reintentar</button></p>}
  <div className={styles.list} aria-busy={loading}>{loading ? <p className={styles.empty}>Cargando contactos…</p> : feed?.contacts.length ? feed.contacts.map(c => <article key={c.id} className={styles.card} data-status={c.status}>
   <div className={styles.identity}><div className={styles.avatar}>{c.nombre.split(" ").filter(Boolean).slice(0,2).map(s => s[0]).join("") || "?"}</div><div><h2>{c.nombre || "Sin nombre"}</h2><a className={styles.phone} href={"tel:" + c.telefono.replace(/[^+\d]/g,"")}><Phone size={14}/>{c.telefono}</a></div><div className={styles.tags}>{c.tags.length ? c.tags.map(t => <span key={t}>{t}</span>) : <span>Sin etiqueta</span>}</div><span className={styles.state}>{recoveryLabels[c.status]}</span></div>
   <div className={styles.meta}><span>Responsable: <b>{c.responsible_name || "Sin asignar"}</b></span><span>Última gestión: {date(c.updated_at)}</span>{c.status === "recovered" && <span>Compra: <b>{money(Number(c.purchase_amount))}</b> · {date(c.recovered_at)}</span>}<span className={styles.xp}><Sparkles size={15}/>{c.status === "recovered" ? "75 XP acreditados al responsable" : "Recuperar este contacto equivale a 75 XP"}</span></div>
   <div className={styles.actions}>{!['recycled','recovered'].includes(c.status) && <><button onClick={() => open(c,"contacted")}><Phone size={16}/>Fue contactada</button><button onClick={() => open(c,"no_response")}><MessageCircle size={16}/>No responde al WhatsApp</button><button onClick={() => open(c,"recycled")}><Recycle size={16}/>Enviar a reciclaje</button></>}{c.status === "recycled" && <button onClick={() => open(c,"restore")}><ArrowLeft size={16}/>Devolver a seguimiento</button>}{c.status !== "recovered" && <button className={styles.purchase} onClick={() => open(c,"recovered")} disabled={!c.contacted_at} title={!c.contacted_at ? "Registra primero el contacto" : undefined}><ShoppingBag size={16}/>Realizó promo reencuentro</button>}<button className={styles.history} onClick={() => open(c,"history")}><History size={16}/>Historial</button></div>
  </article>) : <div className={styles.empty}><CheckCircle2 size={28}/><h2>No hay contactos en esta vista</h2><p>Prueba otros filtros o revisa las demás bandejas.</p></div>}</div>
  <footer className={styles.footer}><span>{feed?.total || 0} contactos · Página {page} de {Math.max(1,Math.ceil((feed?.total || 0)/25))}</span><div><button aria-label="Página anterior" disabled={loading || page === 1} onClick={() => setPage(p => p-1)}><ArrowLeft size={17}/></button><button aria-label="Página siguiente" disabled={loading || page*25 >= (feed?.total || 0)} onClick={() => setPage(p => p+1)}><ArrowRight size={17}/></button></div></footer>
  {modal && <div className={styles.overlay}><div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="recovery-dialog-title" className={styles.dialog}><button className={styles.close} aria-label="Cerrar" disabled={saving} onClick={() => setModal(null)}><X size={20}/></button><span className={styles.eyebrow}>{modal.client.nombre}</span><h2 id="recovery-dialog-title">{titles[modal.action]}</h2>
   {modal.action === "recovered" && <><p>Selecciona la compra que corresponde a la promo reencuentro. Debe estar completada y ser posterior al primer contacto registrado.</p><label>Compra confirmada<select aria-label="Compra confirmada" value={payment} disabled={detailLoading || saving} onChange={e => setPayment(e.target.value)}><option value="">Selecciona una compra</option>{payments.map(p => <option key={p.id} value={p.id}>{date(p.created_at)} · {money(Number(p.importe))} · {p.id.slice(0,8)}</option>)}</select></label>{!detailLoading && !payments.length && <p>No hay compras válidas registradas todavía. Registra o confirma el pago en el CRM y vuelve a abrir esta ficha.</p>}<p className={styles.xp}><Sparkles size={16}/>75 XP para {modal.client.responsible_name || "la central responsable"}. No se duplican al reintentar.</p></>}
   {modal.action === "recycled" && <p>El contacto pasará a Reciclaje. No se borrarán sus datos y podrás devolverlo a seguimiento.</p>}
   {modal.action === "contacted" && <p>La ficha quedará naranja, esperando el resultado de la gestión. Esta acción registra el contacto; no envía mensajes.</p>}
   {modal.action === "no_response" && <p>La ficha quedará naranja con «Sin respuesta». Permanecerá por recuperar hasta que decidas reciclarla o confirmes su compra.</p>}
   {modal.action === "restore" && <p>El contacto volverá a Por recuperar con su historial y responsable.</p>}
   {detailLoading && <p role="status">Cargando información…</p>}
   {modal.action === "history" ? <ol className={styles.timeline}>{history.map(h => <li key={h.id}><strong>{recoveryLabels[h.status]}</strong><span>{h.actor_name} · {date(h.created_at)}</span>{h.note && <p>{h.note}</p>}</li>)}{!detailLoading && !history.length && <li>Sin gestiones registradas.</li>}</ol> : <label>Nota de la gestión (opcional)<textarea maxLength={1000} value={note} disabled={saving} onChange={e => setNote(e.target.value)} placeholder="Añade contexto para la próxima gestión"/></label>}
   {modalError && <p role="alert" className={styles.error}>{modalError}</p>}
   <div className={styles.dialogActions}><button disabled={saving} onClick={() => setModal(null)}>{modal.action === "history" ? "Cerrar" : "Cancelar"}</button>{modal.action !== "history" && <button className={styles.confirm} disabled={saving || detailLoading || (modal.action === "recovered" && !payment)} onClick={() => void submit()}>{saving ? "Guardando…" : modal.action === "recovered" ? "Confirmar recuperación · 75 XP" : "Guardar gestión"}</button>}</div>
  </div></div>}
 </section>;
}
