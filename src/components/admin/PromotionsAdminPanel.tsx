"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, Copy, Eye, Gift, Plus, Power, RefreshCw, Save, ShoppingBag, Sparkles, Trash2, TrendingUp } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import styles from "./PromotionsAdminPanel.module.css";

const sb = supabaseBrowser();

type PromoPackage = {
  id: string;
  promotion_id: string;
  name: string;
  description?: string | null;
  paid_minutes: number;
  free_minutes: number;
  price: number;
  regular_price?: number | null;
  currency: "EUR" | "USD";
  roulette_level?: number | null;
  roulette_spins: number;
  coins: number;
  oracle_credits: number;
  extra_benefit?: string | null;
  is_recommended: boolean;
  is_active: boolean;
  sort_order: number;
};

type Promotion = {
  id: string;
  name: string;
  subtitle?: string | null;
  description?: string | null;
  status: string;
  effective_status: string;
  starts_at?: string | null;
  ends_at?: string | null;
  active_until_disabled: boolean;
  created_at: string;
  activated_at?: string | null;
  packages: PromoPackage[];
  stats: {
    purchases: number;
    unique_clients: number;
    revenue_by_currency: Record<string, number>;
    top_package?: { id: string; name: string; purchases: number } | null;
  };
  audit: Array<{ id: string; action: string; created_at: string; snapshot?: any }>;
};

function toLocalInput(value?: string | null) {
  if (!value) return "";
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return "";
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
}

function formatMoney(value: number, currency: string) {
  try { return Number(value || 0).toLocaleString("es-ES", { style: "currency", currency }); }
  catch { return `${Number(value || 0).toFixed(2)} ${currency}`; }
}

function statusLabel(status: string) {
  const map: Record<string, string> = { draft: "Borrador", scheduled: "Programada", active: "Activa", finished: "Finalizada", inactive: "Inactiva", archived: "Archivada" };
  return map[status] || status;
}

async function token() {
  const { data } = await sb.auth.getSession();
  return data.session?.access_token || "";
}

export default function PromotionsAdminPanel() {
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [newName, setNewName] = useState("Promo Locura");
  const [preview, setPreview] = useState(false);

  const selected = useMemo(() => promotions.find((p) => p.id === selectedId) || promotions[0] || null, [promotions, selectedId]);
  const active = useMemo(() => promotions.find((p) => p.effective_status === "active") || null, [promotions]);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const auth = await token();
      if (!auth) return;
      const response = await fetch("/api/admin/promotions", { headers: { Authorization: `Bearer ${auth}` }, cache: "no-store" });
      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.ok) throw new Error(json?.error || "PROMOTIONS_LOAD_FAILED");
      setPromotions(Array.isArray(json.promotions) ? json.promotions : []);
      setSelectedId((current) => current || json.promotions?.[0]?.id || "");
    } catch (e: any) {
      setMessage(e?.message || "No se pudieron cargar las promociones");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function mutate(payload: any, busyKey = "save") {
    try {
      setBusy(busyKey);
      setMessage("");
      const auth = await token();
      if (!auth) throw new Error("NO_AUTH");
      const response = await fetch("/api/admin/promotions", {
        method: "POST",
        headers: { Authorization: `Bearer ${auth}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.ok) throw new Error(json?.error || "PROMOTION_SAVE_FAILED");
      if (Array.isArray(json.promotions)) setPromotions(json.promotions);
      if (json.promotion?.id) setSelectedId(json.promotion.id);
      setMessage("Cambios guardados y publicados para sincronización.");
      return json;
    } catch (e: any) {
      setMessage(e?.message || "No se pudieron guardar los cambios");
      return null;
    } finally {
      setBusy("");
    }
  }

  async function createPromotion() {
    const name = newName.trim();
    if (!name) return;
    await mutate({ action: "create_promotion", name }, "create");
  }

  if (loading) return <section className={styles.loading}>Cargando centro comercial…</section>;

  const totalPurchases = promotions.reduce((sum, p) => sum + Number(p.stats?.purchases || 0), 0);
  const totalClients = promotions.reduce((sum, p) => sum + Number(p.stats?.unique_clients || 0), 0);
  const activeRevenue = active?.stats?.revenue_by_currency || {};

  return (
    <div className={styles.wrap}>
      <section className={styles.hero}>
        <div>
          <div className={styles.eyebrow}><Sparkles size={14}/> Centro comercial · campaña activa</div>
          <h2>Precios de hoy</h2>
          <p>Activa, programa y edita lo que ve el Panel Cliente sin volver a desplegar código.</p>
        </div>
        <button className={styles.secondaryButton} onClick={() => void load()} disabled={loading}><RefreshCw size={16}/> Refrescar</button>
      </section>

      {message ? <div className={styles.message}>{message}</div> : null}

      <section className={styles.kpis}>
        <article data-tone="active"><span>Promoción activa</span><strong>{active?.name || "Sin promoción"}</strong><small>{active ? statusLabel(active.effective_status) : "Precios normales visibles"}</small></article>
        <article><span>Ventas promo</span><strong>{totalPurchases}</strong><small>Compras confirmadas</small></article>
        <article><span>Clientes</span><strong>{totalClients}</strong><small>Acumulado en promociones</small></article>
        <article><span>Ingresos promo activa</span><strong>{Object.keys(activeRevenue).length ? Object.entries(activeRevenue).map(([c,v]) => formatMoney(Number(v), c)).join(" · ") : "0,00 €"}</strong><small>{active?.stats?.top_package ? `Pack líder: ${active.stats.top_package.name}` : "Sin ventas todavía"}</small></article>
      </section>

      <section className={styles.createBar}>
        <div><strong>Nueva plantilla/promoción</strong><span>Empieza en borrador y añade los packs después.</span></div>
        <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Nombre de promoción" />
        <button className={styles.primaryButton} onClick={createPromotion} disabled={busy === "create"}><Plus size={16}/>{busy === "create" ? "Creando…" : "Crear promoción"}</button>
      </section>

      <section className={styles.workspace}>
        <aside className={styles.promoList}>
          <div className={styles.listTitle}>Promociones</div>
          {promotions.length === 0 ? <div className={styles.empty}>Aún no hay promociones.</div> : promotions.map((promo) => (
            <button key={promo.id} onClick={() => { setSelectedId(promo.id); setPreview(false); }} className={`${styles.promoItem} ${selected?.id === promo.id ? styles.promoItemActive : ""}`}>
              <span className={styles.statusDot} data-status={promo.effective_status}/>
              <div><strong>{promo.name}</strong><small>{statusLabel(promo.effective_status)} · {promo.packages.length} packs</small></div>
              <span>{promo.stats?.purchases || 0}</span>
            </button>
          ))}
        </aside>

        {selected ? (
          <div className={styles.editor}>
            <PromotionEditor
              promotion={selected}
              busy={busy}
              preview={preview}
              onPreview={() => setPreview((v) => !v)}
              onMutate={mutate}
              activePromotionId={active?.id || null}
            />
          </div>
        ) : <div className={styles.emptyEditor}>Crea una promoción para empezar.</div>}
      </section>
    </div>
  );
}

function PromotionEditor({ promotion, busy, preview, onPreview, onMutate, activePromotionId }: { promotion: Promotion; busy: string; preview: boolean; onPreview: () => void; onMutate: (payload: any, busyKey?: string) => Promise<any>; activePromotionId: string | null }) {
  const [form, setForm] = useState(() => ({
    name: promotion.name,
    subtitle: promotion.subtitle || "",
    description: promotion.description || "",
    status: promotion.status,
    starts_at: toLocalInput(promotion.starts_at),
    ends_at: toLocalInput(promotion.ends_at),
    active_until_disabled: promotion.active_until_disabled,
  }));

  useEffect(() => setForm({
    name: promotion.name,
    subtitle: promotion.subtitle || "",
    description: promotion.description || "",
    status: promotion.status,
    starts_at: toLocalInput(promotion.starts_at),
    ends_at: toLocalInput(promotion.ends_at),
    active_until_disabled: promotion.active_until_disabled,
  }), [promotion]);

  const revenue = promotion.stats?.revenue_by_currency || {};

  return (
    <>
      <div className={styles.editorHeader}>
        <div>
          <span className={styles.statusPill} data-status={promotion.effective_status}>{statusLabel(promotion.effective_status)}</span>
          <h3>{promotion.name}</h3>
          <p>{promotion.stats.purchases} compras · {promotion.stats.unique_clients} clientes · {Object.keys(revenue).length ? Object.entries(revenue).map(([c,v]) => formatMoney(Number(v), c)).join(" · ") : "sin ingresos aún"}</p>
        </div>
        <div className={styles.actions}>
          <button onClick={onPreview} className={styles.secondaryButton}><Eye size={15}/> Previsualizar</button>
          <button onClick={() => void onMutate({ action: "duplicate", id: promotion.id }, `duplicate:${promotion.id}`)} className={styles.secondaryButton}><Copy size={15}/> Duplicar</button>
          {promotion.effective_status === "active" ? (
            <button onClick={() => void onMutate({ action: "deactivate", id: promotion.id }, `deactivate:${promotion.id}`)} className={styles.dangerButton}><Power size={15}/> Desactivar</button>
          ) : (
            <button onClick={() => {
              if (activePromotionId && activePromotionId !== promotion.id && !window.confirm("Ya existe una promoción activa. ¿Quieres sustituirla?")) return;
              void onMutate({ action: "activate", id: promotion.id }, `activate:${promotion.id}`);
            }} className={styles.primaryButton}><Power size={15}/> Activar</button>
          )}
        </div>
      </div>

      <section className={styles.formCard}>
        <div className={styles.sectionTitle}><CalendarClock size={17}/><div><strong>Configuración de campaña</strong><span>Programada o activa hasta desactivar manualmente.</span></div></div>
        <div className={styles.formGrid}>
          <label>Nombre<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}/></label>
          <label>Estado<select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}><option value="draft">Borrador</option><option value="scheduled">Programada</option><option value="active">Activa</option><option value="inactive">Inactiva</option><option value="finished">Finalizada</option></select></label>
          <label className={styles.span2}>Subtítulo<input value={form.subtitle} onChange={(e) => setForm({ ...form, subtitle: e.target.value })}/></label>
          <label className={styles.span2}>Descripción<textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}/></label>
          <label>Inicio<input type="datetime-local" value={form.starts_at} onChange={(e) => setForm({ ...form, starts_at: e.target.value })}/></label>
          <label>Fin<input type="datetime-local" value={form.ends_at} disabled={form.active_until_disabled} onChange={(e) => setForm({ ...form, ends_at: e.target.value })}/></label>
          <label className={styles.checkLabel}><input type="checkbox" checked={form.active_until_disabled} onChange={(e) => setForm({ ...form, active_until_disabled: e.target.checked })}/> Activa hasta desactivar manualmente</label>
        </div>
        <div className={styles.formActions}>
          <button className={styles.primaryButton} disabled={busy === `promotion:${promotion.id}`} onClick={() => void onMutate({ action: "update_promotion", id: promotion.id, ...form }, `promotion:${promotion.id}`)}><Save size={15}/> Guardar promoción</button>
          <button className={styles.secondaryButton} onClick={() => void onMutate({ action: "archive", id: promotion.id }, `archive:${promotion.id}`)}><Trash2 size={15}/> {promotion.stats.purchases ? "Archivar" : "Eliminar borrador"}</button>
        </div>
      </section>

      {preview ? <PromotionPreview promotion={promotion}/> : null}

      <section className={styles.formCard}>
        <div className={styles.sectionTitle}><ShoppingBag size={17}/><div><strong>Packs configurados</strong><span>Minutos, precio y beneficios estructurados que se acreditan al confirmar Mollie.</span></div><button className={styles.primaryButton} onClick={() => void onMutate({ action: "add_package", promotion_id: promotion.id, name: "Nuevo pack", description: "", paid_minutes: 20, free_minutes: 0, price: 20, currency: "EUR", roulette_level: 1, roulette_spins: 1, coins: 0, oracle_credits: 0, sort_order: promotion.packages.length + 1 }, `add:${promotion.id}`)}><Plus size={15}/> Añadir paquete</button></div>
        <div className={styles.packList}>
          {promotion.packages.length === 0 ? <div className={styles.empty}>Añade el primer paquete de esta promoción.</div> : promotion.packages.map((pack) => <PackageEditor key={pack.id} pack={pack} busy={busy} onMutate={onMutate}/>)}
        </div>
      </section>

      <section className={styles.bottomGrid}>
        <article className={styles.formCard}>
          <div className={styles.sectionTitle}><TrendingUp size={17}/><div><strong>Estadísticas reales</strong><span>Solo compras confirmadas.</span></div></div>
          <div className={styles.statsGrid}><div><span>Compras</span><strong>{promotion.stats.purchases}</strong></div><div><span>Clientes únicos</span><strong>{promotion.stats.unique_clients}</strong></div><div><span>Pack líder</span><strong>{promotion.stats.top_package?.name || "—"}</strong></div><div><span>Ingresos</span><strong>{Object.keys(revenue).length ? Object.entries(revenue).map(([c,v]) => formatMoney(Number(v), c)).join(" · ") : "—"}</strong></div></div>
        </article>
        <article className={styles.formCard}>
          <div className={styles.sectionTitle}><Gift size={17}/><div><strong>Historial</strong><span>Últimos cambios de la promoción.</span></div></div>
          <div className={styles.auditList}>{promotion.audit?.length ? promotion.audit.map((row) => <div key={row.id}><strong>{row.action}{row.snapshot?._actor ? ` · ${row.snapshot._actor}` : ""}</strong><span>{new Date(row.created_at).toLocaleString("es-ES")}</span></div>) : <div className={styles.empty}>Sin actividad todavía.</div>}</div>
        </article>
      </section>
    </>
  );
}

function PackageEditor({ pack, busy, onMutate }: { pack: PromoPackage; busy: string; onMutate: (payload: any, busyKey?: string) => Promise<any> }) {
  const [form, setForm] = useState({ ...pack, regular_price: pack.regular_price ?? "" as any, roulette_level: pack.roulette_level ?? "" as any });
  useEffect(() => setForm({ ...pack, regular_price: pack.regular_price ?? "" as any, roulette_level: pack.roulette_level ?? "" as any }), [pack]);
  return (
    <article className={styles.packEditor} data-disabled={!form.is_active ? "true" : "false"}>
      <div className={styles.packTop}><strong>{form.name}</strong><label className={styles.inlineCheck}><input type="checkbox" checked={Boolean(form.is_active)} onChange={(e) => setForm({ ...form, is_active: e.target.checked })}/> Activo</label><label className={styles.inlineCheck}><input type="checkbox" checked={Boolean(form.is_recommended)} onChange={(e) => setForm({ ...form, is_recommended: e.target.checked })}/> Recomendado</label></div>
      <div className={styles.packGrid}>
        <label>Nombre<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}/></label>
        <label>Moneda<select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value as any })}><option>EUR</option><option>USD</option></select></label>
        <label>Min. comprados<input type="number" min="0" value={form.paid_minutes} onChange={(e) => setForm({ ...form, paid_minutes: Number(e.target.value) })}/></label>
        <label>Min. gratis<input type="number" min="0" value={form.free_minutes} onChange={(e) => setForm({ ...form, free_minutes: Number(e.target.value) })}/></label>
        <label>Precio<input type="number" min="0.01" step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: Number(e.target.value) })}/></label>
        <label>Precio normal<input type="number" min="0" step="0.01" value={form.regular_price as any} onChange={(e) => setForm({ ...form, regular_price: e.target.value as any })}/></label>
        <label>Coins<input type="number" min="0" value={form.coins} onChange={(e) => setForm({ ...form, coins: Number(e.target.value) })}/></label>
        <label>Nivel ruleta<select value={form.roulette_level as any} onChange={(e) => setForm({ ...form, roulette_level: e.target.value ? Number(e.target.value) as any : "" as any })}><option value="">Sin giro</option><option value="1">Nivel 1</option><option value="2">Nivel 2</option><option value="3">Nivel 3</option></select></label>
        <label>Giros<input type="number" min="0" value={form.roulette_spins} onChange={(e) => setForm({ ...form, roulette_spins: Number(e.target.value) })}/></label>
        <label>Tiradas Oráculo<input type="number" min="0" value={form.oracle_credits} onChange={(e) => setForm({ ...form, oracle_credits: Number(e.target.value) })}/></label>
        <label>Orden<input type="number" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })}/></label>
        <label className={styles.span2}>Descripción<input value={form.description || ""} onChange={(e) => setForm({ ...form, description: e.target.value })}/></label>
        <label className={styles.span2}>Beneficio extra (texto)<input value={form.extra_benefit || ""} onChange={(e) => setForm({ ...form, extra_benefit: e.target.value })} placeholder="Ej. Acceso a evento especial"/></label>
      </div>
      <div className={styles.packActions}>
        <button className={styles.primaryButton} disabled={busy === `pack:${pack.id}`} onClick={() => void onMutate({ action: "update_package", promotion_id: pack.promotion_id, package_id: pack.id, ...form }, `pack:${pack.id}`)}><Save size={14}/> Guardar</button>
        <button className={styles.secondaryButton} onClick={() => void onMutate({ action: "duplicate_package", promotion_id: pack.promotion_id, package_id: pack.id }, `duplicate-pack:${pack.id}`)}><Copy size={14}/> Duplicar</button>
        <button className={styles.secondaryButton} onClick={() => void onMutate({ action: "delete_package", promotion_id: pack.promotion_id, package_id: pack.id }, `delete:${pack.id}`)}><Trash2 size={14}/> Eliminar</button>
      </div>
    </article>
  );
}

function PromotionPreview({ promotion }: { promotion: Promotion }) {
  return <section className={styles.preview}>
    <div className={styles.previewHead}><span>VISTA PREVIA PANEL CLIENTE</span><h3>{promotion.name}</h3><p>{promotion.subtitle || promotion.description || "Promoción especial"}</p></div>
    <div className={styles.previewGrid}>{promotion.packages.filter((p) => p.is_active).map((pack) => <article key={pack.id}><span>{pack.is_recommended ? "RECOMENDADO" : "PROMO"}</span><strong>{pack.name}</strong><p>{pack.paid_minutes} min {pack.free_minutes ? `+ ${pack.free_minutes} GRATIS` : ""}</p><b>{formatMoney(pack.price, pack.currency)}</b></article>)}</div>
  </section>;
}
