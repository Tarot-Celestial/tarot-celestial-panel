"use client";
import { useEffect, useState } from "react";
import { RefreshCw, Save } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { validateRankBenefitEdit, type RankBenefitConfig } from "@/lib/rank-benefit-config";
import CrystalEmblem from "@/components/benefits/CrystalEmblem";
import styles from "./RankBenefitsAdminPanel.module.css";

async function request(method: "GET" | "POST", body?: unknown) {
  const token = (await supabaseBrowser().auth.getSession()).data.session?.access_token;
  if (!token) throw new Error("Inicia sesión como administrador.");
  const response = await fetch("/api/admin/rank-benefits/phase-one", {
    method, cache: "no-store", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.error || "No se pudo completar la operación.");
  return result;
}
export default function RankBenefitsPhaseOne() {
  const [rows, setRows] = useState<RankBenefitConfig[]>([]);
  const [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  async function load() {
    setLoading(true); setError("");
    try {
      const result = await request("GET");
      setRows(result.ranks); setSelected(current => current || result.ranks[0]?.rank_key || "");
    } catch (cause: any) { setError(cause.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  const row = rows.find(item => item.rank_key === selected);
  return <section className={styles.wrap}>
    <header className={styles.hero}><div><span className={styles.eyebrow}>BENEFICIOS DE RANGOS Y PAQUETES · FASE 1</span><h1>Beneficios de rangos</h1><p>Define las Coins de cada compra y el acceso a Mi ritual para cada rango.</p></div><CrystalEmblem size={100}/></header>
    {error && <div className={styles.message} role="alert">{error}</div>}
    {loading && <p role="status">Cargando configuración…</p>}
    {!loading && !rows.length && <div className={styles.empty}>No hay configuración disponible. <button className={styles.secondary} onClick={() => void load()}><RefreshCw size={16}/> Reintentar</button></div>}
    <nav className={styles.tabs} aria-label="Rangos">{rows.map(item => <button key={item.rank_key} aria-pressed={selected === item.rank_key} onClick={() => setSelected(item.rank_key)}>{item.label}{item.rank_key === "diamante" ? " 💎" : ""}</button>)}</nav>
    {row && <Editor key={row.rank_key} row={row} saved={next => setRows(old => old.map(item => item.rank_key === next.rank_key ? next : item))} reload={load}/>}
  </section>;
}
function Editor({ row, saved, reload }: { row: RankBenefitConfig; saved: (row: RankBenefitConfig) => void; reload: () => Promise<void> }) {
  const [coins, setCoins] = useState(String(row.purchase_coins));
  const [ritual, setRitual] = useState(row.ritual_access);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [success, setSuccess] = useState(false);
  useEffect(() => { setCoins(String(row.purchase_coins)); setRitual(row.ritual_access); }, [row]);
  return <form className={styles.rankCard} data-rank={row.rank_key} onSubmit={async event => {
    event.preventDefault(); if (busy) return;
    setBusy(true); setMessage(""); setSuccess(false);
    try {
      if (coins.trim() === "") throw new Error("Introduce la cantidad de Coins.");
      const result = await request("POST", validateRankBenefitEdit({ ...row, purchase_coins: Number(coins), ritual_access: ritual }));
      saved(result.saved); setSuccess(true); setMessage("Guardado correctamente");
    } catch (cause: any) { setMessage(cause.message); }
    finally { setBusy(false); }
  }}>
    <div className={styles.rankHeader}><CrystalEmblem tone={row.rank_key}/><h2>Configuración de {row.label}</h2></div>
    <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 24 }}>
      <label>Coins por compra<input type="number" required min="0" max="1000000" step="1" value={coins} onChange={event => { setCoins(event.target.value); setMessage(""); }}/></label>
      <label className={styles.toggle}><span>Acceso a Mi ritual · {ritual ? "ON" : "OFF"}</span><input type="checkbox" role="switch" checked={ritual} onChange={event => { setRitual(event.target.checked); setMessage(""); }}/><i aria-hidden="true"/></label>
      <p className={styles.note}>Los cambios se aplican a las próximas compras. Los clientes sin acceso a Mi ritual no verán el apartado.</p>
      <div className={styles.toolbar}><button className={styles.primary} type="submit"><Save size={16}/>{busy ? "Guardando…" : "Guardar cambios"}</button><button type="button" className={styles.secondary} onClick={() => void reload()}>Recargar valores guardados</button></div>
    </fieldset>
    {busy && <span role="status">Guardando…</span>}
    {message && <div className={styles.message} data-success={success} role={success ? "status" : "alert"}>{message}</div>}
  </form>;
}
