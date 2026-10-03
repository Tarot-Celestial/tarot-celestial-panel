"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Eye, Gift, RefreshCw, Save, ShieldCheck, Sparkles } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import {
  matrixBenefitLabels,
  type DiamondDailyBonusConfig,
  type PackageLevelAssignment,
  type RankBenefitConfig,
  type RankPackageBenefitConfig,
} from "@/lib/rank-benefit-config";
import CrystalEmblem from "@/components/benefits/CrystalEmblem";
import styles from "./RankBenefitsAdminPanel.module.css";

type AdminData = {
  ranks: (RankBenefitConfig & { updated_by_name?: string | null })[];
  matrix: (RankPackageBenefitConfig & { updated_by_name?: string | null })[];
  assignments: PackageLevelAssignment[];
  packages: Array<{ package_source: "standard" | "promotion"; package_key: string; package_label: string; active: boolean; native_benefits?: any }>;
  diamond_bonus: (DiamondDailyBonusConfig & { updated_by_name?: string | null }) | null;
  deliveries: any[];
  audit: any[];
  business_timezone: string;
};

async function request(method: "GET" | "POST", body?: unknown) {
  const token = (await supabaseBrowser().auth.getSession()).data.session?.access_token;
  if (!token) throw new Error("Inicia sesión como administrador.");
  const response = await fetch("/api/admin/rank-benefits/phase-one", {
    method,
    cache: "no-store",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) throw new Error(result.error || "No se pudo completar la operación.");
  return result;
}

function emptyMatrix(rank: string, level: 1 | 2 | 3): RankPackageBenefitConfig {
  return { rank_key: rank, package_level: level, enabled: false, coins: 0, oracle_credits: 0, roulette_level_1_spins: 0, roulette_level_2_spins: 0, roulette_level_3_spins: 0, roulette_special_spins: 0, revision: 0 };
}

function fmt(value?: string | null) {
  if (!value) return "Sin cambios registrados";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" });
}

export default function RankBenefitsPhaseOne() {
  const [data, setData] = useState<AdminData | null>(null);
  const [selectedRank, setSelectedRank] = useState("bronce");
  const [level, setLevel] = useState<1 | 2 | 3>(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [historyTab, setHistoryTab] = useState<"deliveries" | "audit">("deliveries");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const result = await request("GET");
      const next: AdminData = result;
      setData(next);
      setSelectedRank((current) => next.ranks.some((r) => r.rank_key === current) ? current : next.ranks[0]?.rank_key || "bronce");
    } catch (cause: any) { setError(cause.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  const rank = data?.ranks.find((row) => row.rank_key === selectedRank) || null;
  const matrix = data?.matrix.find((row) => row.rank_key === selectedRank && Number(row.package_level) === level) || emptyMatrix(selectedRank, level);

  const saveResult = useCallback((text: string) => { setMessage(text); window.setTimeout(() => setMessage(""), 3500); }, []);

  return <section className={styles.wrap}>
    <header className={styles.hero}>
      <div><span className={styles.eyebrow}>BENEFICIOS DE RANGOS Y PAQUETES</span><h1>Beneficios reales por rango</h1><p>Configura lo que se acredita en Supabase según rango efectivo y nivel real del paquete, sin alterar precios ni minutos.</p></div>
      <CrystalEmblem size={104}/>
    </header>

    {error && <div className={styles.message} role="alert">{error}</div>}
    {message && <div className={styles.message} data-success="true" role="status"><CheckCircle2 size={16}/> {message}</div>}
    {loading && <div className={styles.rankAdminLoading}>Cargando configuración real de Supabase…</div>}
    {!loading && !data && <button className={styles.secondary} onClick={() => void load()}><RefreshCw size={16}/> Reintentar</button>}

    {data && <>
      <nav className={styles.tabs} aria-label="Rangos">
        {data.ranks.map((item) => <button key={item.rank_key} aria-pressed={selectedRank === item.rank_key} onClick={() => setSelectedRank(item.rank_key)}>{item.label}{item.rank_key === "diamante" ? " 💎" : ""}</button>)}
      </nav>

      <section className={styles.rankAdminGrid}>
        <div className={styles.rankAdminMain}>
          <div className={styles.rankCard} data-rank={selectedRank}>
            <div className={styles.rankHeader}><CrystalEmblem tone={selectedRank}/><div><h2>{rank?.label || selectedRank}</h2><p className={styles.note}>Los beneficios de paquete son adicionales a lo que el propio pack o promoción ya promete. Cada entrega queda registrada por compra.</p></div></div>

            <div className={styles.rankSectionTitle}><span><Gift size={17}/> Beneficios por compra</span><small>Nivel del paquete ≠ nivel de ruleta</small></div>
            <div className={styles.levelTabs}>{([1,2,3] as const).map((value) => <button key={value} type="button" aria-pressed={level === value} onClick={() => setLevel(value)}>Nivel {value}</button>)}</div>
            <MatrixEditor key={`${selectedRank}-${level}-${matrix.revision}`} row={matrix} onSaved={load} notify={saveResult}/>
          </div>

          {rank && <RitualEditor key={`${rank.rank_key}-${rank.revision}`} row={rank} onSaved={load} notify={saveResult}/>} 
          {selectedRank === "diamante" && data.diamond_bonus && <DiamondBonusEditor key={`${data.diamond_bonus.id}-${data.diamond_bonus.revision}`} row={data.diamond_bonus} timezone={data.business_timezone} onSaved={load} notify={saveResult}/>} 
        </div>

        <aside className={styles.rankAdminAside}>
          <section className={styles.rankCard}>
            <div className={styles.rankSectionTitle}><span><ShieldCheck size={17}/> Resumen</span></div>
            <div className={styles.rankSummaryList}>
              <div><span>Rango</span><strong>{rank?.label || "—"}</strong></div>
              <div><span>Paquete</span><strong>Nivel {level}</strong></div>
              <div><span>Entrega</span><strong>{matrix.enabled ? "Activa" : "Desactivada"}</strong></div>
              <div><span>Mi ritual</span><strong>{rank?.ritual_access ? "Permitido" : "Oculto"}</strong></div>
              <div><span>Última edición</span><strong>{fmt(matrix.updated_at || rank?.updated_at)}</strong></div><div><span>Responsable</span><strong>{(matrix as any).updated_by_name || rank?.updated_by_name || "Sistema / migración"}</strong></div>
            </div>
            <div className={styles.rankBenefitPills}>{matrixBenefitLabels(matrix).map((label) => <span key={label}>{label}</span>)}</div>
          </section>

          <PackageMappings data={data} onSaved={load} notify={saveResult}/>
        </aside>
      </section>

      <section className={styles.rankCard}>
        <div className={styles.rankHistoryHeader}><div><h2>Historial y trazabilidad</h2><p className={styles.note}>Consulta entregas reales y cambios administrativos.</p></div><div className={styles.levelTabs}><button aria-pressed={historyTab === "deliveries"} onClick={() => setHistoryTab("deliveries")}>Entregas</button><button aria-pressed={historyTab === "audit"} onClick={() => setHistoryTab("audit")}>Cambios</button></div></div>
        {historyTab === "deliveries" ? <HistoryRows rows={data.deliveries} kind="delivery"/> : <HistoryRows rows={data.audit} kind="audit"/>}
      </section>
    </>}
  </section>;
}

function MatrixEditor({ row, onSaved, notify }: { row: RankPackageBenefitConfig; onSaved: () => Promise<void>; notify: (text: string) => void }) {
  const [form, setForm] = useState({ ...row });
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<any>(null);
  const [error, setError] = useState("");
  const dirty = JSON.stringify(form) !== JSON.stringify(row);
  const number = (key: keyof RankPackageBenefitConfig, value: string) => setForm((old) => ({ ...old, [key]: Math.max(0, Number(value || 0)) }));
  async function save() {
    setBusy(true); setError("");
    try { await request("POST", { action: "save_matrix", data: form }); notify("Guardado correctamente"); await onSaved(); }
    catch (cause: any) { setError(cause.message); }
    finally { setBusy(false); }
  }
  async function showPreview() {
    setBusy(true); setError("");
    try { const result = await request("POST", { action: "preview", data: form }); setPreview(result.saved); }
    catch (cause: any) { setError(cause.message); }
    finally { setBusy(false); }
  }
  return <div className={styles.matrixEditor}>
    <label className={styles.toggle}><span>Entregar beneficios en este nivel · {form.enabled ? "ON" : "OFF"}</span><input type="checkbox" role="switch" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })}/><i/></label>
    <div className={styles.matrixFields}>
      <label>Coins<input type="number" min="0" step="1" value={form.coins} onChange={(e) => number("coins", e.target.value)}/></label>
      <label>Tiradas Oráculo<input type="number" min="0" step="1" value={form.oracle_credits} onChange={(e) => number("oracle_credits", e.target.value)}/></label>
      <label>Ruleta nivel 1<input type="number" min="0" step="1" value={form.roulette_level_1_spins} onChange={(e) => number("roulette_level_1_spins", e.target.value)}/></label>
      <label>Ruleta nivel 2<input type="number" min="0" step="1" value={form.roulette_level_2_spins} onChange={(e) => number("roulette_level_2_spins", e.target.value)}/></label>
      <label>Ruleta nivel 3<input type="number" min="0" step="1" value={form.roulette_level_3_spins} onChange={(e) => number("roulette_level_3_spins", e.target.value)}/></label>
      <label>Ruleta especial<input type="number" min="0" step="1" value={form.roulette_special_spins} onChange={(e) => number("roulette_special_spins", e.target.value)}/></label>
    </div>
    {preview && <div className={styles.rankPreview}><strong>Vista previa · sin acreditar nada</strong><span>Rango: {preview.rank_key} · Nivel {preview.package_level}</span><div className={styles.rankBenefitPills}>{(preview.labels || []).map((label: string) => <span key={label}>{label}</span>)}</div></div>}
    {error && <div className={styles.message} role="alert">{error}</div>}
    <div className={styles.toolbar}><button type="button" className={styles.primary} disabled={busy || !dirty} onClick={() => void save()}><Save size={16}/>{busy ? "Guardando…" : dirty ? "Guardar cambios" : "Sin cambios"}</button><button type="button" className={styles.secondary} disabled={busy} onClick={() => void showPreview()}><Eye size={16}/> Vista previa</button></div>
  </div>;
}

function RitualEditor({ row, onSaved, notify }: { row: RankBenefitConfig; onSaved: () => Promise<void>; notify: (text: string) => void }) {
  const [enabled, setEnabled] = useState(row.ritual_access);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save() { setBusy(true); setError(""); try { await request("POST", { action: "save_ritual", data: { ...row, ritual_access: enabled } }); notify("Acceso a Mi ritual actualizado"); await onSaved(); } catch (e: any) { setError(e.message); } finally { setBusy(false); } }
  return <section className={styles.rankCard}><div className={styles.rankSectionTitle}><span><Sparkles size={17}/> Acceso a Mi ritual</span></div><p className={styles.note}>Permitir acceso no crea ni regala un ritual. Si está OFF, el cliente no ve el enlace y la API no devuelve información ritual.</p><label className={styles.toggle}><span>Acceso para {row.label} · {enabled ? "ON" : "OFF"}</span><input type="checkbox" role="switch" checked={enabled} onChange={(e) => setEnabled(e.target.checked)}/><i/></label>{error && <div className={styles.message}>{error}</div>}<small className={styles.note}>Última modificación: {fmt(row.updated_at)} · {((row as any).updated_by_name || "Sistema / migración")}</small><div className={styles.toolbar}><button className={styles.primary} disabled={busy || enabled === row.ritual_access} onClick={() => void save()}><Save size={16}/>{busy ? "Guardando…" : "Guardar acceso"}</button></div></section>;
}

function DiamondBonusEditor({ row, timezone, onSaved, notify }: { row: DiamondDailyBonusConfig; timezone: string; onSaved: () => Promise<void>; notify: (text: string) => void }) {
  const [form, setForm] = useState({ ...row }); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const numeric = (key: keyof DiamondDailyBonusConfig, value: string) => setForm((old) => ({ ...old, [key]: Math.max(0, Number(value || 0)) }));
  async function save() { setBusy(true); setError(""); try { await request("POST", { action: "save_bonus", data: form }); notify("Bono diario Diamante guardado"); await onSaved(); } catch (e: any) { setError(e.message); } finally { setBusy(false); } }
  return <section className={styles.rankCard}><div className={styles.rankSectionTitle}><span><Gift size={17}/> Bono diario Diamante</span><small>1 uso por día · {timezone}</small></div><label className={styles.toggle}><span>Bono diario · {form.enabled ? "ACTIVO" : "INACTIVO"}</span><input type="checkbox" role="switch" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })}/><i/></label><div className={styles.matrixFields}><label className={styles.wideField}>Nombre<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}/></label><label className={styles.wideField}>Descripción<textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}/></label><label>Coins<input type="number" min="0" value={form.coins} onChange={(e) => numeric("coins", e.target.value)}/></label><label>Oráculo<input type="number" min="0" value={form.oracle_credits} onChange={(e) => numeric("oracle_credits", e.target.value)}/></label><label>Ruleta N1<input type="number" min="0" value={form.roulette_level_1_spins} onChange={(e) => numeric("roulette_level_1_spins", e.target.value)}/></label><label>Ruleta N2<input type="number" min="0" value={form.roulette_level_2_spins} onChange={(e) => numeric("roulette_level_2_spins", e.target.value)}/></label><label>Ruleta N3<input type="number" min="0" value={form.roulette_level_3_spins} onChange={(e) => numeric("roulette_level_3_spins", e.target.value)}/></label><label>Ruleta especial<input type="number" min="0" value={form.roulette_special_spins} onChange={(e) => numeric("roulette_special_spins", e.target.value)}/></label></div>{error && <div className={styles.message}>{error}</div>}<small className={styles.note}>Última modificación: {fmt(row.updated_at)} · {((row as any).updated_by_name || "Sistema / migración")}</small><div className={styles.toolbar}><button className={styles.primary} disabled={busy || JSON.stringify(form) === JSON.stringify(row)} onClick={() => void save()}><Save size={16}/>{busy ? "Guardando…" : "Guardar bono"}</button></div></section>;
}

function PackageMappings({ data, onSaved, notify }: { data: AdminData; onSaved: () => Promise<void>; notify: (text: string) => void }) {
  const mapping = useMemo(() => new Map(data.assignments.map((row) => [`${row.package_source}:${row.package_key}`, row])), [data.assignments]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  async function save(pkg: AdminData["packages"][number], value: string) {
    const key = `${pkg.package_source}:${pkg.package_key}`; setBusy(key); setError("");
    try { const existing = mapping.get(key); await request("POST", { action: "save_assignment", data: { package_source: pkg.package_source, package_key: pkg.package_key, package_label: pkg.package_label, package_level: value ? Number(value) : null, revision: existing?.revision || 0 } }); notify("Asignación de paquete guardada"); await onSaved(); } catch (e: any) { setError(e.message || "No se pudo guardar la asignación."); } finally { setBusy(""); }
  }
  return <section className={styles.rankCard}><div className={styles.rankSectionTitle}><span>Asignación de paquetes</span><small>Fuente real de nivel 1/2/3</small></div><p className={styles.note}>Los packs estándar conservan la agrupación que ya mostraba el Panel Cliente. Las promociones nuevas quedan sin nivel hasta asignarlas.</p>{error && <div className={styles.message} role="alert">{error}</div>}<div className={styles.packageMappingList}>{data.packages.map((pkg) => { const key = `${pkg.package_source}:${pkg.package_key}`; const current = mapping.get(key); return <div className={styles.packageMappingRow} key={key}><div><strong>{pkg.package_label}</strong><small>{pkg.package_source === "standard" ? "Pack estándar" : "Promoción"}{pkg.native_benefits ? ` · beneficio propio: ${pkg.native_benefits.coins || 0} Coins, ${pkg.native_benefits.oracle_credits || 0} Oráculo` : ""}</small></div><select value={current?.package_level ?? ""} disabled={busy === key} onChange={(e) => void save(pkg, e.target.value)}><option value="">Sin asignar</option><option value="1">Nivel 1</option><option value="2">Nivel 2</option><option value="3">Nivel 3</option></select></div>; })}</div></section>;
}

function HistoryRows({ rows, kind }: { rows: any[]; kind: "delivery" | "audit" }) {
  if (!rows.length) return <div className={styles.empty}>Todavía no hay registros.</div>;
  return <div className={styles.rankHistoryList}>{rows.map((row, index) => <article key={row.id || `${kind}-${index}`}><div><strong>{kind === "delivery" ? row.client_name || row.cliente_id : row.action}</strong><small>{kind === "delivery" ? `${row.benefit_type}${row.package_level ? ` · paquete N${row.package_level}` : ""}` : `${row.entity} · ${row.actor_name || "Sistema"}`}</small></div><time>{fmt(row.created_at)}</time></article>)}</div>;
}
