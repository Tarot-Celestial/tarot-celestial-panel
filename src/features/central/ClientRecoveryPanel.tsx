"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, Clock3, History, MessageCircle, Phone, Recycle, RefreshCw, Search, ShoppingBag, Sparkles, X } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { recoveryLabels, type RecoveryBucket, type RecoveryContact, type RecoveryHistory, type RecoveryPayment } from "@/lib/client-recovery";
import styles from "./ClientRecoveryPanel.module.css";
import RecoveryMessageComposer from "./RecoveryMessageComposer";
import { useRecoveryMission } from "./assistant/useRecoveryMission";
import { RECOVERY_MISSION_REFRESH, recoveryMissionMessage, recoveryMissionPhase, recoveryMissionTime } from "@/lib/recovery-mission";
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
 const missionState = useRecoveryMission();
 const mission = missionState.mission?.enabled ? missionState.mission : null;
 const missionPhase = recoveryMissionPhase(missionState.mission);
 const [missionOnly, setMissionOnly] = useState(false);
 const [bucket, setBucket] = useState<RecoveryBucket>("pending"), [status, setStatus] = useState(""), [tag, setTag] = useState(""), [search, setSearch] = useState(""), [query, setQuery] = useState(""), [page, setPage] = useState(1);
 const [feed, setFeed] = useState<Feed | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState(""), [notice, setNotice] = useState("");
 const [modal, setModal] = useState<{ client: RecoveryContact; action: Action } | null>(null);
 const [payments, setPayments] = useState<RecoveryPayment[]>([]), [history, setHistory] = useState<RecoveryHistory[]>([]), [payment, setPayment] = useState(""), [note, setNote] = useState(""), [saving, setSaving] = useState(false), [detailLoading, setDetailLoading] = useState(false), [modalError, setModalError] = useState("");
 const [followPointer, setFollowPointer] = useState(true);
 const [channel, setChannel] = useState(""), [mutationRequestId, setMutationRequestId] = useState("");
 useEffect(() => { if (missionState.mission && !missionState.mission.enabled) { setMissionOnly(false); setPage(1); } }, [missionState.mission]);
 const hoverTimer = useRef<ReturnType<typeof setTimeout>>();
 useEffect(() => () => clearTimeout(hoverTimer.current), []);
 const [messageClient, setMessageClient] = useState<RecoveryContact | null>(null);
 const generation = useRef(0), dialog = useRef<HTMLDivElement>(null), busy = useRef(false);
 useEffect(() => { const id = setTimeout(() => { setQuery(search.trim()); setPage(1); }, 300); return () => clearTimeout(id); }, [search]);
 const load = useCallback(async (silent = false) => {
  const seq = ++generation.current;
  if (!silent) setLoading(true);
  try {
   const result = await request("?" + new URLSearchParams({ bucket, status, tag, q: query, page: String(page), ...(missionOnly ? { mission: "1" } : {}) }));
   if (seq !== generation.current) return;
   if (!result.contacts.length && page > 1 && result.total <= (page - 1) * 25) { setPage(Math.max(1, Math.ceil(result.total / 25))); return; }
   setFeed(result); setError("");
  } catch (e: any) { if (seq === generation.current) setError(e.message); }
  finally { if (seq === generation.current) setLoading(false); }
 }, [bucket, status, tag, query, page, missionOnly]);
 useEffect(() => { void load(); return () => { generation.current++; }; }, [load]);
 useEffect(() => { const refresh = () => { if (!document.hidden && !busy.current) void load(true); }; const timer = setInterval(refresh,30000); window.addEventListener("focus",refresh); return () => { clearInterval(timer); window.removeEventListener("focus",refresh); }; }, [load]);
 useEffect(() => { const refresh = () => { if (!document.hidden) void load(true); }; window.addEventListener(RECOVERY_MISSION_REFRESH, refresh); return () => window.removeEventListener(RECOVERY_MISSION_REFRESH, refresh); }, [load]);
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
 function open(client: RecoveryContact, action: Action) { setPayments([]); setHistory([]); setPayment(""); setNote(""); setChannel(""); setMutationRequestId(action !== "history" ? crypto.randomUUID() : ""); setModalError(""); setDetailLoading(["recovered","history"].includes(action)); setModal({client,action}); }
 async function submit() {
  if (!modal || busy.current || modal.action === "history") return;
  if (modal.action === "contacted" && !channel) { setModalError("Selecciona el canal que has utilizado para contactar."); return; }
  busy.current = true; setSaving(true); setModalError("");
  try {
   const result = await request("", { client_id: modal.client.id, action: modal.action, version: modal.client.version, payment_id: payment || null, note, request_id: mutationRequestId, ...(modal.action === "contacted" ? { channel } : {}) });
   setNotice(result.status === "recovered" ? "Cliente en recuperados. 75 XP registrados para la central responsable, una sola vez." : result.status === "recycled" ? "Contacto trasladado a Reciclaje. Su historial se conserva." : "Estado guardado. El contacto continúa en seguimiento.");
   setModal(null); await load(); window.dispatchEvent(new Event(RECOVERY_MISSION_REFRESH)); onXpChange?.();
  } catch (e: any) { setModalError(e.message); }
  finally { busy.current = false; setSaving(false); }
 }
 return <section className={styles.panel} aria-label="Recuperación de clientes">
  <header className={styles.header}><div><span className={styles.eyebrow}>CENTRAL · FIDELIZACIÓN</span><h1>Recuperación de clientes</h1><p>Retoma el contacto. Registra cada gestión.</p></div><button className={styles.refresh} onClick={() => { void load(); missionState.refresh(); }} disabled={loading}><RefreshCw size={16}/> Actualizar</button></header>
  {missionState.error ? <div className={styles.missionUnavailable} role="status"><Sparkles size={20}/><div><strong>Tu misión está pendiente de actualizar</strong><p>{missionState.error}</p></div><button onClick={missionState.refresh}>Reintentar</button></div> : !missionState.mission && missionState.loading ? <div className={styles.missionUnavailable} role="status"><Sparkles size={20}/><p>Consultando tu misión y los XP registrados…</p></div> : null}
  {mission && <section className={styles.mission} data-phase={missionPhase} aria-labelledby="recovery-mission-title">
   <div className={styles.missionHeading}><div><span className={styles.eyebrow}>TU MISIÓN · {mission.day} · ECUADOR</span><h2 id="recovery-mission-title">Cada conversación cuenta</h2></div><span className={styles.shift}><Clock3 size={14}/>{recoveryMissionTime(mission.starts_at)}–{recoveryMissionTime(mission.ends_at)}</span></div>
   <p className={styles.missionMessage}>{recoveryMissionMessage(mission)}</p>
   {mission.is_workday && <div className={styles.missionGoals}>
    <div className={styles.missionGoal}><div><span>Clientes gestionados</span><strong>{mission.managed}<small> / {mission.target}</small></strong></div><progress aria-label="Clientes gestionados en tu turno" max={mission.target} value={Math.min(mission.managed, mission.target)}/><p>{mission.management_bonus_awarded ? `${mission.management_bonus} XP registrados` : `+${mission.management_bonus} XP al completar ${mission.target}, con o sin venta`}</p></div>
    <div className={styles.missionGoal}><div><span>Clientes recuperados</span><strong>{mission.recovered}<small> / {mission.recovery_target}</small></strong></div><progress aria-label="Clientes recuperados en tu turno" max={mission.recovery_target} value={Math.min(mission.recovered, mission.recovery_target)}/><p>{mission.recovery_bonus_awarded ? `${mission.recovery_bonus} XP extra registrados` : `75 XP por recuperación · +${mission.recovery_bonus} XP al llegar a ${mission.recovery_target}`}</p></div>
    <div className={styles.missionXp}><Sparkles size={22}/><strong>{mission.awarded_xp}<small> XP</small></strong><span>Registrados hoy</span></div>
   </div>}
   <div className={styles.missionFoot}><p>{mission.is_workday ? <>Un cliente suma una gestión al día. {mission.assigned_client_ids.length > 0 ? `${mission.assigned_client_ids.length} contactos en tu misión.` : "Prepara tu lista de contactos disponibles."}{missionPhase === "behind" && <> Referencia actual: {mission.expected_managed} gestiones. El aviso no resta XP.</>}</> : "Las misiones se activan de lunes a viernes."}</p><div>{mission.is_workday && mission.active && mission.managed < mission.target && <button onClick={() => void missionState.prepare()} disabled={missionState.preparing || missionState.loading}><Sparkles size={15}/>{missionState.preparing ? "Preparando…" : mission.assigned_client_ids.length ? "Actualizar mi lista" : "Preparar mi misión"}</button>}<button aria-pressed={missionOnly} onClick={() => { setMissionOnly(value => !value); setPage(1); }}>{missionOnly ? "Ver toda la cartera" : "Ver mi misión"}</button></div></div>
  </section>}
  {!mission && missionOnly && <p className={styles.missionUnavailable}>Mostrando los contactos de tu misión.<button onClick={() => { setMissionOnly(false); setPage(1); }}>Ver toda la cartera</button></p>}
  <div className={styles.rule}><Clock3 size={21}/><div><strong>Hasta junio de 2026 + sin etiqueta</strong><p>Se excluyen contactos con cualquier etiqueta desde julio de 2026. Las etiquetas sin fecha reconocible no se consideran antiguas.</p></div></div>
  <div className={styles.tabs} role="tablist" aria-label="Bandejas de recuperación">{([['pending','Por recuperar'],['recycled','Reciclaje'],['recovered','Clientes recuperados']] as const).map(([key,label]) => <button key={key} role="tab" aria-selected={bucket === key} onClick={() => { setBucket(key); setStatus(""); setPage(1); }}>{label}<span>{feed?.counts[key] ?? "—"}</span></button>)}</div>
  <div className={styles.filters}><label><Search size={18}/><input aria-label="Buscar nombre o teléfono" placeholder="Buscar nombre o teléfono" value={search} onChange={e => setSearch(e.target.value)}/></label><select aria-label="Filtrar por estado" value={status} disabled={bucket !== "pending"} onChange={e => { setStatus(e.target.value); setPage(1); }}><option value="">Todos los estados</option><option value="pending">Pendiente de contactar</option><option value="contacted">Contactada · Esperando resultado</option><option value="no_response">Sin respuesta · Decidir reciclaje</option></select><select aria-label="Filtrar por etiqueta" value={tag} onChange={e => { setTag(e.target.value); setPage(1); }}><option value="">Todas las etiquetas</option><option value="__none__">Sin etiqueta</option>{feed?.tags.map(t => <option key={t} value={t}>{t}</option>)}</select></div>
  {notice && <p role="status" className={styles.notice}>{notice}</p>}{error && <p role="alert" className={styles.error}>{error} <button onClick={() => void load()}>Reintentar</button></p>}
  <div className={styles.recoveryWorkspace}><div>
  <div className={styles.list} aria-busy={loading}>{loading ? <p className={styles.empty}>Cargando contactos…</p> : feed?.contacts.length ? feed.contacts.map(c => <article key={c.id} className={styles.card} data-status={c.status} data-message-selected={messageClient?.id === c.id} onMouseEnter={() => { if (followPointer) hoverTimer.current = setTimeout(() => setMessageClient(c), 450); }} onMouseLeave={() => clearTimeout(hoverTimer.current)} onFocus={() => { if (followPointer) setMessageClient(c); }}>
   <div className={styles.identity}><div className={styles.avatar}>{c.nombre.split(" ").filter(Boolean).slice(0,2).map(s => s[0]).join("") || "?"}</div><div><h2>{c.nombre || "Sin nombre"}</h2><a className={styles.phone} href={"tel:" + c.telefono.replace(/[^+\d]/g,"")}><Phone size={14}/>{c.telefono}</a></div><div className={styles.tags}>{c.tags.length ? c.tags.map(t => <span key={t}>{t}</span>) : <span>Sin etiqueta</span>}</div><span className={styles.state}>{recoveryLabels[c.status]}</span></div>
   <div className={styles.meta}><span>Responsable: <b>{c.responsible_name || "Sin asignar"}</b></span><span>Última gestión: {date(c.updated_at)}</span>{c.status === "recovered" && <span>Compra: <b>{money(Number(c.purchase_amount))}</b> · {date(c.recovered_at)}</span>}<span className={styles.xp}><Sparkles size={15}/>{c.status === "recovered" ? "75 XP acreditados al responsable" : "Recuperar este contacto equivale a 75 XP"}</span></div>
   <div className={styles.actions}><button type="button" onClick={() => { clearTimeout(hoverTimer.current); setFollowPointer(false); setMessageClient(c); }}><Sparkles size={16}/>Preparar mensaje</button>{!['recycled','recovered'].includes(c.status) && <><button onClick={() => open(c,"contacted")}><Phone size={16}/>Fue contactada</button><button onClick={() => open(c,"no_response")}><MessageCircle size={16}/>No responde al WhatsApp</button><button onClick={() => open(c,"recycled")}><Recycle size={16}/>Enviar a reciclaje</button></>}{c.status === "recycled" && <button onClick={() => open(c,"restore")}><ArrowLeft size={16}/>Devolver a seguimiento</button>}{c.status !== "recovered" && <button className={styles.purchase} onClick={() => open(c,"recovered")} disabled={!c.contacted_at} title={!c.contacted_at ? "Registra primero el contacto" : undefined}><ShoppingBag size={16}/>Realizó promo reencuentro</button>}<button className={styles.history} onClick={() => open(c,"history")}><History size={16}/>Historial</button></div>
  </article>) : <div className={styles.empty}><CheckCircle2 size={28}/><h2>No hay contactos en esta vista</h2><p>Prueba otros filtros o revisa las demás bandejas.</p></div>}</div>
  <footer className={styles.footer}><span>{feed?.total || 0} contactos · Página {page} de {Math.max(1,Math.ceil((feed?.total || 0)/25))}</span><div><button aria-label="Página anterior" disabled={loading || page === 1} onClick={() => setPage(p => p-1)}><ArrowLeft size={17}/></button><button aria-label="Página siguiente" disabled={loading || page*25 >= (feed?.total || 0)} onClick={() => setPage(p => p+1)}><ArrowRight size={17}/></button></div></footer>
  </div><RecoveryMessageComposer client={messageClient} followPointer={followPointer} onFollowPointer={setFollowPointer}/></div>
  {modal && <div className={styles.overlay}><div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="recovery-dialog-title" className={styles.dialog}><button className={styles.close} aria-label="Cerrar" disabled={saving} onClick={() => setModal(null)}><X size={20}/></button><span className={styles.eyebrow}>{modal.client.nombre}</span><h2 id="recovery-dialog-title">{titles[modal.action]}</h2>
   {modal.action === "recovered" && <><p>Selecciona la compra que corresponde a la promo reencuentro. Debe estar completada y ser posterior al primer contacto registrado.</p><label>Compra confirmada<select aria-label="Compra confirmada" value={payment} disabled={detailLoading || saving} onChange={e => setPayment(e.target.value)}><option value="">Selecciona una compra</option>{payments.map(p => <option key={p.id} value={p.id}>{date(p.created_at)} · {money(Number(p.importe))} · {p.id.slice(0,8)}</option>)}</select></label>{!detailLoading && !payments.length && <p>No hay compras válidas registradas todavía. Registra o confirma el pago en el CRM y vuelve a abrir esta ficha.</p>}<p className={styles.xp}><Sparkles size={16}/>75 XP para {modal.client.responsible_name || "la central responsable"}. No se duplican al reintentar.</p></>}
   {modal.action === "recycled" && <p>El contacto pasará a Reciclaje. No se borrarán sus datos y podrás devolverlo a seguimiento.</p>}
   {modal.action === "contacted" && <><p>Registra un contacto que ya has realizado. Un mismo cliente cuenta una sola vez al día para tu misión; esta acción no envía mensajes.</p><label>Canal utilizado<select required aria-label="Canal utilizado para contactar" value={channel} disabled={saving} onChange={e => setChannel(e.target.value)}><option value="">Selecciona el canal</option><option value="whatsapp">WhatsApp</option><option value="phone">Teléfono</option><option value="email">Correo electrónico</option><option value="other">Otro canal</option></select></label></>}
   {modal.action === "no_response" && <p>La ficha quedará naranja con «Sin respuesta». Permanecerá por recuperar hasta que decidas reciclarla o confirmes su compra.</p>}
   {modal.action === "restore" && <p>El contacto volverá a Por recuperar con su historial y responsable.</p>}
   {detailLoading && <p role="status">Cargando información…</p>}
   {modal.action === "history" ? <ol className={styles.timeline}>{history.map(h => <li key={h.id}><strong>{recoveryLabels[h.status]}</strong><span>{h.actor_name} · {date(h.created_at)}</span>{h.note && <p>{h.note}</p>}</li>)}{!detailLoading && !history.length && <li>Sin gestiones registradas.</li>}</ol> : <label>Nota de la gestión (opcional)<textarea maxLength={1000} value={note} disabled={saving} onChange={e => setNote(e.target.value)} placeholder="Añade contexto para la próxima gestión"/></label>}
   {modalError && <p role="alert" className={styles.error}>{modalError}</p>}
   <div className={styles.dialogActions}><button disabled={saving} onClick={() => setModal(null)}>{modal.action === "history" ? "Cerrar" : "Cancelar"}</button>{modal.action !== "history" && <button className={styles.confirm} disabled={saving || detailLoading || (modal.action === "recovered" && !payment) || (modal.action === "contacted" && !channel)} onClick={() => void submit()}>{saving ? "Guardando…" : modal.action === "recovered" ? "Confirmar recuperación · 75 XP" : "Guardar gestión"}</button>}</div>
  </div></div>}
 </section>;
}
