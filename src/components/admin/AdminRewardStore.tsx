"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Gift, Plus, Save } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import styles from "./AdminRewardStore.module.css";
const blank = { name: "", description: "", category: "money", coin_cost: "", active: false, featured: false, display_order: 100, image_url: "", stock: "", required_level: "" };
const labels: Record<string, string> = { money: "Dinero", time: "Tiempo libre", surprise: "Sorpresas", exclusive: "Exclusivas" };
const statuses: Record<string, string> = { pending: "Solicitada", approved: "Aprobada", delivered: "Entregada", rejected: "Rechazada", cancelled: "Cancelada" };
export default function AdminRewardStore() {
  const [data, setData] = useState<any>(null), [draft, setDraft] = useState<any>(blank);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [page, setPage] = useState(0);
  const [showArchived, setShowArchived] = useState(false);
  const locked = useRef(false);
  const call = useCallback(async (url: string, init?: RequestInit) => {
    const token = (await supabaseBrowser().auth.getSession()).data.session?.access_token;
    if (!token) throw new Error("Vuelve a iniciar sesión.");
    const r = await fetch(url, { ...init, headers: { ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }), Authorization: `Bearer ${token}` }, cache: "no-store" });
    const j = await r.json(); if (!r.ok || !j.ok) throw new Error(j.error || "No se pudo completar la operación."); return j;
  }, []);
  const load = useCallback(async () => {
    try { setData(await call(`/api/admin/store?page=${page}`)); }
    catch (e: any) { setError(e.message); }
  }, [call, page]);
  useEffect(() => {
    void load(); const sb = supabaseBrowser(); let timer: ReturnType<typeof setTimeout>;
    const refresh = () => { clearTimeout(timer); timer = setTimeout(() => { if (document.visibilityState === "visible") void load(); }, 250); };
    const channel = sb.channel("admin-store-editor").on("postgres_changes", { event: "*", schema: "public", table: "worker_store_rewards" }, refresh).on("postgres_changes", { event: "*", schema: "public", table: "worker_store_claims" }, refresh).subscribe();
    window.addEventListener("focus", refresh); document.addEventListener("visibilitychange", refresh);
    return () => { clearTimeout(timer); void sb.removeChannel(channel); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [load]);
  async function mutate(body: any, reset = false) {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError("");
    try { await call("/api/admin/store", { method: "POST", body: JSON.stringify(body) }); if (reset) setDraft(blank); await load(); }
    catch (e: any) { setError(e.message); }
    finally { locked.current = false; setBusy(false); }
  }
  async function upload(file?: File) {
    if (!file || locked.current) return;
    locked.current = true; setBusy(true); setError("");
    try { const form = new FormData(); form.set("file", file); const j = await call("/api/admin/store/image", { method: "POST", body: form }); setDraft((d: any) => ({ ...d, image_url: j.image_url })); }
    catch (e: any) { setError(e.message); }
    finally { locked.current = false; setBusy(false); }
  }
  const categories = [...new Set([...Object.keys(labels), ...(data?.rewards || []).map((r: any) => String(r.category))])];
  const edit = (r: any) => setDraft({ ...r, stock: r.stock ?? "", required_level: r.required_level ?? "", image_url: r.image_url ?? "" });
  return <section className={styles.card} aria-busy={busy}>
    <header><div><span><Gift /> BÓVEDA CENTRAL</span><h2>Tienda de recompensas</h2><p>Publica productos, organiza el catálogo y gestiona las entregas.</p></div><button disabled={busy} onClick={() => setDraft(blank)}><Plus /> Nueva recompensa</button></header>
    {error && <div className={styles.error} role="alert">{error}</div>}
    <form onSubmit={e => { e.preventDefault(); void mutate({ op: "save_reward", ...draft }, true); }}>
      <fieldset className={styles.editor} disabled={busy}>
        <legend>{draft.id ? "Editar recompensa" : "Crear recompensa"}</legend>
        <label>Nombre<input required maxLength={150} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label>
        <label>Descripción<textarea maxLength={2000} value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} /></label>
        <label>Categoría<select aria-label="Categoría" value={categories.includes(draft.category) ? draft.category : "__new"} onChange={e => setDraft({ ...draft, category: e.target.value === "__new" ? "" : e.target.value })}>{categories.map(c => <option key={c} value={c}>{labels[c] || c}</option>)}<option value="__new">Nueva categoría…</option></select>{!categories.includes(draft.category) && <input aria-label="Nombre de nueva categoría" required maxLength={60} placeholder="Nombre de categoría" value={draft.category} onChange={e => setDraft({ ...draft, category: e.target.value })} />}</label>
        {([['coin_cost','Coste en Coins',1],['display_order','Orden de aparición',0],['stock','Stock (vacío: ilimitado)',0],['required_level','Nivel mínimo (opcional)',1]] as const).map(([key,label,min]) => <label key={key}>{label}<input type="number" min={min} step="1" required={key==='coin_cost'||key==='display_order'} value={draft[key]} onChange={e => setDraft({ ...draft, [key]: e.target.value })} /></label>)}
        <label>Imagen HTTPS<input type="url" value={draft.image_url} onChange={e => setDraft({ ...draft, image_url: e.target.value })} /></label>
        <label>Subir / cambiar imagen<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => void upload(e.target.files?.[0])} /><small>JPG, PNG o WebP · Máximo 3 MB</small></label>
        {draft.image_url && <img className={styles.preview} src={draft.image_url} alt="Vista previa de la recompensa" />}
        <label className={styles.check}><input type="checkbox" checked={draft.active} onChange={e => setDraft({ ...draft, active: e.target.checked })} /> Publicada</label>
        <label className={styles.check}><input type="checkbox" checked={draft.featured} onChange={e => setDraft({ ...draft, featured: e.target.checked })} /> Destacada</label>
        <button type="submit"><Save />{busy ? "Guardando…" : "Guardar recompensa"}</button>
      </fieldset>
    </form>
    <header><h3>Catálogo</h3><label><input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} /> Ver archivadas</label></header>
    <div className={styles.catalog}>{(data?.rewards || []).filter((r: any) => showArchived || !r.archived_at).map((r: any) => <article key={r.id}>
      {r.image_url ? <img src={r.image_url} alt="" loading="lazy" /> : <div className={styles.fallback}><Gift /></div>}
      <div><b>{r.name}</b><p>{r.coin_cost} Coins · {labels[r.category] || r.category}</p><small>{r.archived_at ? "Archivada" : r.active ? "Publicada" : "Inactiva"} · Orden {r.display_order}{r.featured ? " · Destacada" : ""}</small></div>
      <div className={styles.actions}><button disabled={busy || !!r.archived_at} onClick={() => edit(r)}>Editar</button><button disabled={busy} onClick={() => { edit({ ...r, id: undefined, archived_at: null, name: `${r.name} (copia)`, active: false }); }}>Duplicar</button>{!r.archived_at && <><button disabled={busy} onClick={() => void mutate({ ...r, op: "save_reward", active: !r.active })}>{r.active ? "Desactivar" : "Activar"}</button><button disabled={busy} onClick={() => { if (window.confirm(`¿Archivar «${r.name}»? Sus canjes se conservarán.`)) void mutate({ op: "archive_reward", id: r.id }, draft.id === r.id); }}>Archivar</button></>}</div>
    </article>)}</div>
    <h3>Solicitudes e historial</h3><p>El estado registra la gestión de entrega. Cambiarlo no devuelve Coins automáticamente.</p>
    <div className={styles.claims}>{(data?.claims || []).map((c: any) => <article key={c.id}>
      {c.reward_image_url && <img src={c.reward_image_url} alt="" loading="lazy" />}
      <span><b>{c.worker_name} · {c.reward_name}</b><small>{c.coin_cost} Coins · {new Date(c.created_at).toLocaleString("es-ES")}</small>{c.status_note && <small>{c.status_note}</small>}</span>
      <select aria-label={`Estado de ${c.reward_name} para ${c.worker_name}`} disabled={busy} value={c.status} onChange={e => void mutate({ op: "set_claim_status", claim_id: c.id, status: e.target.value, status_note: c.status_note })}>{Object.entries(statuses).map(([k,v]) => <option key={k} value={k}>{v}</option>)}</select>
      <button disabled={busy} onClick={() => { const note = window.prompt("Nota de gestión", c.status_note || ""); if (note !== null) void mutate({ op: "set_claim_status", claim_id: c.id, status: c.status, status_note: note }); }}>Añadir nota</button>
    </article>)}</div>
    <div className={styles.actions}><button disabled={page === 0} onClick={() => setPage(p => p - 1)}>Anterior</button><span>Página {page + 1}</span><button disabled={!data?.has_more} onClick={() => setPage(p => p + 1)}>Siguiente</button><button onClick={() => void load()}>Actualizar</button></div>
  </section>;
}
