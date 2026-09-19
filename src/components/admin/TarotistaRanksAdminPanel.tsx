"use client";

import { useEffect, useMemo, useState } from "react";
import { RefreshCw, Save, ShieldCheck, Sparkles } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import styles from "./TarotistaRanksAdminPanel.module.css";

const sb = supabaseBrowser();

type RankRow = {
  code: "C" | "B" | "A" | "S";
  name: string;
  subtitle: string;
  description: string;
  min_cliente_pct: number | null;
  requirement_label: string;
  benefits: string[];
  sort_order: number;
};

async function getToken() {
  const { data } = await sb.auth.getSession();
  return data.session?.access_token || null;
}

export default function TarotistaRanksAdminPanel() {
  const [rows, setRows] = useState<RankRow[]>([]);
  const [selected, setSelected] = useState<RankRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const current = useMemo(() => selected ? { ...selected, benefits: [...(selected.benefits || [])] } : null, [selected]);

  async function load() {
    setBusy(true);
    setMsg("");
    try {
      const token = await getToken();
      if (!token) throw new Error("NO_AUTH");
      const res = await fetch("/api/admin/tarotista-ranks", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const json = await res.json();
      if (!res.ok || !json?.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setRows(json.ranks || []);
      setSelected((prev) => {
        const code = prev?.code || json.ranks?.[0]?.code;
        return (json.ranks || []).find((row: RankRow) => row.code === code) || json.ranks?.[0] || null;
      });
    } catch (error: any) {
      setMsg(`❌ ${error?.message || "Error"}`);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { void load(); }, []);

  function patch(patchValue: Partial<RankRow>) {
    setSelected((prev) => prev ? { ...prev, ...patchValue } : prev);
  }

  async function save() {
    if (!selected) return;
    setBusy(true);
    setMsg("");
    try {
      const token = await getToken();
      if (!token) throw new Error("NO_AUTH");
      const res = await fetch("/api/admin/tarotista-ranks", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(selected),
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setMsg(`✅ Rango ${selected.code} guardado`);
      await load();
    } catch (error: any) {
      setMsg(`❌ ${error?.message || "Error"}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.shell}>
      <header className={styles.hero}>
        <div>
          <div className={styles.eyebrow}><Sparkles size={14}/> Configuración centralizada</div>
          <h1>Rangos tarotistas</h1>
          <p>Administra C, B, A y S desde la misma fuente que consume el Panel Tarotista.</p>
        </div>
        <button onClick={() => void load()} disabled={busy}><RefreshCw size={16}/>{busy ? "Actualizando…" : "Actualizar"}</button>
      </header>

      <div className={styles.grid}>
        <aside className={styles.rankList}>
          {rows.map((row) => (
            <button key={row.code} className={`${styles.rankCard} ${selected?.code === row.code ? styles.rankCardActive : ""}`} data-rank={row.code} onClick={() => setSelected({ ...row, benefits: [...(row.benefits || [])] })}>
              <span className={styles.badge}>{row.code}</span>
              <span><strong>{row.name}</strong><small>{row.subtitle}</small></span>
              <em>{row.min_cliente_pct == null ? "Por configurar" : `Desde ${Number(row.min_cliente_pct).toLocaleString("es-ES")} % Cliente`}</em>
            </button>
          ))}
        </aside>

        <div className={styles.editor}>
          {!current ? <div className={styles.empty}>Cargando configuración…</div> : <>
            <div className={styles.editorHead}><div><span>EDITANDO RANGO</span><h2>{current.code}</h2></div><div className={styles.liveChip}><ShieldCheck size={14}/> Fuente real Supabase</div></div>
            <div className={styles.formGrid}>
              <label><span>Nombre</span><input value={current.name} onChange={(e) => patch({ name: e.target.value })}/></label>
              <label><span>Subtítulo</span><input value={current.subtitle} onChange={(e) => patch({ subtitle: e.target.value })}/></label>
              <label className={styles.full}><span>Descripción</span><textarea value={current.description} onChange={(e) => patch({ description: e.target.value })}/></label>
              <label><span>% Cliente mínimo</span><input type="number" min="0" max="100" step="0.01" value={current.min_cliente_pct ?? ""} placeholder="Sin configurar" onChange={(e) => patch({ min_cliente_pct: e.target.value === "" ? null : Number(e.target.value) })}/></label>
              <label><span>Orden</span><input type="number" min="1" max="4" value={current.sort_order} onChange={(e) => patch({ sort_order: Number(e.target.value) })}/></label>
              <label className={styles.full}><span>Texto del requisito</span><input value={current.requirement_label} onChange={(e) => patch({ requirement_label: e.target.value })}/></label>
              <label className={styles.full}><span>Beneficios · uno por línea</span><textarea value={(current.benefits || []).join("\n")} placeholder="Deja vacío si todavía no hay beneficios definidos" onChange={(e) => patch({ benefits: e.target.value.split("\n").map((v) => v.trim()).filter(Boolean) })}/></label>
            </div>
            <div className={styles.footer}><span>{msg || "Los cambios se aplicarán al mismo sistema que ve la tarotista."}</span><button className={styles.save} onClick={() => void save()} disabled={busy}><Save size={16}/>{busy ? "Guardando…" : "Guardar rango"}</button></div>
          </>}
        </div>
      </div>
    </section>
  );
}
