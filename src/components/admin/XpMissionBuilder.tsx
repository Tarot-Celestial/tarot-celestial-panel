"use client";

import { useMemo, useState } from "react";
import { Archive, Check, ChevronDown, Flame, Pencil, Sparkles, Target, X } from "lucide-react";
import styles from "./XpMissionBuilder.module.css";

export type XpMission = {
  id: string;
  mission_key: string;
  name: string;
  description: string;
  source_action_key: string;
  target_count: number;
  xp_reward: number;
  period: "lifetime" | "daily" | "weekly" | "monthly" | "per_client" | "once";
  max_claims: number | null;
  unique_clients: boolean;
  delivery_mode: "manual" | "automatic";
  unit_label: string | null;
  active: boolean;
  archived_at: string | null;
  display_order: number;
};

type Rule = { action_key: string; name: string; description?: string };
type Link = { level: number; mission_id: string };
type TierLink = { tier_key: string; mission_id: string };
type Level = { level: number; tier_key: string };
type Tier = { key: string; name: string };
type Draft = Omit<XpMission, "id" | "archived_at"> & { id?: string; level: number; tier_key: string };

const emptyDraft = (levels: Level[], tiers: Tier[]): Draft => ({
  mission_key: "", name: "", description: "", source_action_key: "", target_count: 1,
  xp_reward: 20, period: "once", max_claims: 1, unique_clients: false,
  delivery_mode: "manual", unit_label: null, active: true, display_order: 1,
  level: levels[0]?.level || 1, tier_key: tiers[0]?.key || "bronze",
});

const slug = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
const unitFor = (key: string, name: string) => {
  const source = `${key} ${name}`.toLowerCase();
  if (source.includes("capt")) return "clientas captadas";
  if (source.includes("follow") || source.includes("seguim")) return "seguimientos";
  if (source.includes("repurchase") || source.includes("recompra")) return "recompras";
  if (source.includes("purchase") || source.includes("compra")) return "compras";
  if (source.includes("review") || source.includes("valoraci")) return "valoraciones";
  if (source.includes("consult")) return "consultas";
  if (source.includes("rank") || source.includes("rango")) return "clientas";
  return "acciones";
};
const periodLabel: Record<XpMission["period"], string> = { lifetime: "Permanente", daily: "Diaria", weekly: "Semanal", monthly: "Mensual", per_client: "Por clienta", once: "Una sola vez" };

export default function XpMissionBuilder({ missions, rules, levels, tiers, levelLinks, tierLinks, busy, operate }: {
  missions: XpMission[]; rules: Rule[]; levels: Level[]; tiers: Tier[]; levelLinks: Link[]; tierLinks: TierLink[]; busy: boolean;
  operate: (body: Record<string, unknown>) => Promise<any>;
}) {
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(levels, tiers));
  const [advanced, setAdvanced] = useState(false);
  const [search, setSearch] = useState("");
  const selectedRule = rules.find(rule => rule.action_key === draft.source_action_key);
  const unit = draft.unit_label || unitFor(draft.source_action_key, selectedRule?.name || "");
  const visible = useMemo(() => missions.filter(mission => !mission.archived_at && `${mission.name} ${mission.description}`.toLowerCase().includes(search.toLowerCase().trim())), [missions, search]);

  const patch = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft(current => ({ ...current, [key]: value }));
  const reset = () => { setDraft(emptyDraft(levels, tiers)); setAdvanced(false); };
  const edit = (mission: XpMission) => {
    const linkedLevel = levelLinks.find(link => link.mission_id === mission.id)?.level || levels[0]?.level || 1;
    const linkedTier = tierLinks.find(link => link.mission_id === mission.id)?.tier_key || levels.find(level => level.level === linkedLevel)?.tier_key || tiers[0]?.key || "bronze";
    setDraft({ ...mission, id: mission.id, max_claims: mission.max_claims ?? 1, unique_clients: Boolean(mission.unique_clients), delivery_mode: mission.delivery_mode || "manual", unit_label: mission.unit_label || null, level: linkedLevel, tier_key: linkedTier });
    document.getElementById("mission-catalog-editor")?.scrollIntoView({ behavior: "smooth" });
  };
  const save = async () => {
    const missionKey = draft.mission_key || slug(draft.name);
    if (!draft.name.trim() || !draft.description.trim() || !draft.source_action_key || !missionKey) return;
    const result = await operate({ op: "save_mission", ...draft, mission_key: missionKey, unit_label: unit });
    const missionId = draft.id || result?.mission?.id;
    if (missionId) {
      await operate({ op: "set_mission_links", scope: "level", mission_id: missionId, keys: [draft.level] });
      await operate({ op: "set_mission_links", scope: "tier", mission_id: missionId, keys: [draft.tier_key] });
    }
    reset();
  };

  return <div className={styles.builder}>
    <article className={styles.editor} id="mission-catalog-editor">
      <header><div className={styles.icon}><Sparkles /></div><div><span>CONSTRUCTOR DE MISIONES</span><h3>{draft.id ? "Editar misión" : "Nueva misión"}</h3><p>El progreso procede exclusivamente de eventos XP reales.</p></div>{draft.id ? <button className={styles.cancel} type="button" onClick={reset}><X /> Cancelar edición</button> : null}</header>
      <div className={styles.form}>
        <label className={styles.wide}><span>Nombre de la misión</span><input value={draft.name} placeholder="Ej. Triple captación" onChange={event => patch("name", event.target.value)} /></label>
        <label className={styles.wide}><span>Descripción</span><textarea value={draft.description} placeholder="Describe el objetivo real y cómo se consigue." onChange={event => patch("description", event.target.value)} /></label>
        <label className={styles.wide}><span>Acción real que cuenta</span><select value={draft.source_action_key} onChange={event => { const key = event.target.value; const rule = rules.find(item => item.action_key === key); setDraft(current => ({ ...current, source_action_key: key, unit_label: unitFor(key, rule?.name || "") })); }}><option value="">Selecciona una acción configurada…</option>{rules.map(rule => <option key={rule.action_key} value={rule.action_key}>{rule.name}</option>)}</select><small>{selectedRule?.description || "Solo aparecen acciones del Sistema XP real."}</small></label>
        <label><span>Objetivo</span><div className={styles.numberField}><input type="number" min="1" value={draft.target_count} onChange={event => patch("target_count", Math.max(1, Number(event.target.value)))} /><b>{unit}</b></div></label>
        <label><span>Periodo de progreso</span><select value={draft.period} onChange={event => patch("period", event.target.value as XpMission["period"])}>{Object.entries(periodLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label><span>Reclamos máximos</span><select value={draft.max_claims ?? "unlimited"} onChange={event => patch("max_claims", event.target.value === "unlimited" ? null : Number(event.target.value))}>{[1,2,3,5,10].map(value => <option key={value} value={value}>{value} por periodo</option>)}<option value="unlimited">Ilimitado</option></select></label>
        <label><span>Recompensa XP</span><div className={styles.xpField}><input type="number" min="0" value={draft.xp_reward} onChange={event => patch("xp_reward", Math.max(0, Number(event.target.value)))} /><b>XP</b></div></label>
        <label><span>Nivel de desbloqueo</span><select value={draft.level} onChange={event => { const level = Number(event.target.value); patch("level", level); const tier = levels.find(item => item.level === level)?.tier_key; if (tier) patch("tier_key", tier); }}>{levels.map(level => <option key={level.level} value={level.level}>Nivel {level.level}</option>)}</select></label>
        <label><span>Categoría</span><select value={draft.tier_key} onChange={event => patch("tier_key", event.target.value)}>{tiers.map(tier => <option key={tier.key} value={tier.key}>{tier.name}</option>)}</select></label>
        <label><span>Tipo de entrega</span><select value={draft.delivery_mode} onChange={event => patch("delivery_mode", event.target.value as XpMission["delivery_mode"])}><option value="manual">Manual · botón Reclamar</option><option value="automatic">Automática al completar</option></select></label>
      </div>
      <div className={styles.switches}><label><input type="checkbox" checked={draft.unique_clients} onChange={event => patch("unique_clients", event.target.checked)} /><span><Check /> Contar solo clientes únicos</span></label><label><input type="checkbox" checked={draft.active} onChange={event => patch("active", event.target.checked)} /><span><Check /> Misión activa</span></label></div>
      <button className={styles.advancedToggle} type="button" onClick={() => setAdvanced(value => !value)}><ChevronDown data-open={advanced} /> Configuración avanzada</button>
      {advanced ? <div className={styles.advanced}><label><span>Clave interna</span><input value={draft.mission_key} placeholder={slug(draft.name) || "se_generara_automaticamente"} onChange={event => patch("mission_key", slug(event.target.value))} /></label><label><span>Unidad visual</span><input value={draft.unit_label || ""} placeholder={unit} onChange={event => patch("unit_label", event.target.value || null)} /></label><label><span>Orden</span><input type="number" min="1" value={draft.display_order} onChange={event => patch("display_order", Math.max(1, Number(event.target.value)))} /></label></div> : null}
      <section className={styles.preview}><div><Flame /><span>PREVIEW EN CENTRAL</span></div><h4>{draft.name || "Nombre de la misión"}</h4><p>{draft.description || "La descripción aparecerá aquí."}</p><div className={styles.progress}><span style={{ width: "0%" }} /></div><footer><b>0 / {draft.target_count} {unit}</b><strong>+{draft.xp_reward} XP</strong></footer><small>Nivel {draft.level} · {tiers.find(tier => tier.key === draft.tier_key)?.name || draft.tier_key} · {periodLabel[draft.period]}</small></section>
      <button className={styles.save} disabled={busy || !draft.name.trim() || !draft.description.trim() || !draft.source_action_key} type="button" onClick={() => void save()}><Sparkles /> {draft.id ? "GUARDAR CAMBIOS" : "CREAR MISIÓN"}</button>
    </article>

    <section className={styles.catalog}><header><div><span>CATÁLOGO OPERATIVO</span><h3>Misiones existentes</h3></div><input value={search} placeholder="Buscar misión…" onChange={event => setSearch(event.target.value)} /></header><div className={styles.cards}>{visible.map(mission => {
      const level = levelLinks.find(link => link.mission_id === mission.id)?.level;
      const tier = tierLinks.find(link => link.mission_id === mission.id)?.tier_key;
      return <article key={mission.id} className={!mission.active ? styles.inactive : ""}><div className={styles.cardIcon}><Target /></div><div><span>{mission.active ? "ACTIVA" : "INACTIVA"}</span><h4>{mission.name}</h4><p>{mission.description}</p><div className={styles.chips}><b>{mission.target_count} {mission.unit_label || unitFor(mission.source_action_key, "")}</b><b>{periodLabel[mission.period] || mission.period}</b><b>+{mission.xp_reward} XP</b><b>Nivel {level || "—"} · {tiers.find(item => item.key === tier)?.name || tier || "—"}</b><b>{mission.delivery_mode === "automatic" ? "Automática" : "Manual"}</b></div></div><footer><button type="button" onClick={() => edit(mission)}><Pencil /> Editar</button><button type="button" onClick={() => void operate({ op: "toggle_mission", id: mission.id, active: !mission.active })}>{mission.active ? "Desactivar" : "Activar"}</button><button className={styles.archive} type="button" onClick={() => void operate({ op: "archive_mission", id: mission.id })}><Archive /> Archivar</button></footer></article>;
    })}{!visible.length ? <p className={styles.empty}>No hay misiones para estos filtros.</p> : null}</div></section>
  </div>;
}
