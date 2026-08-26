"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Crown, LockKeyhole, Plus, RefreshCw, Save, Search, Shield, Sparkles, Star, Target, Trophy, X } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { buildConfiguredLevels, type XpLevelConfig, type XpTierConfig } from "@/lib/xp-levels";
import XpMissionBuilder, { type XpMission as Mission } from "./XpMissionBuilder";
import styles from "./XpLevelsAdminPanel.module.css";

type AdminXpResponse = {
  ok: boolean;
  level_config: XpLevelConfig[];
  tier_config: XpTierConfig[];
  level_config_persisted: boolean;
  missions: { installed: boolean; catalog: Mission[]; levels: MissionLink[]; tiers: TierMissionLink[] };
  rules: Array<{action_key:string;name:string}>;
};
type MissionLink={level:number;mission_id:string};
type TierMissionLink={tier_key:string;mission_id:string};
const linkedLevelsFor=(level:number,links?:MissionLink[])=>(links||[]).filter(link=>link.level===level);

const sb = supabaseBrowser();
const fmt = (value: number) => new Intl.NumberFormat("es-ES").format(Number(value) || 0);

function rewardPreview(type: string | null, amount: number | null, label: string | null) {
  if (label) return label;
  if (type === "coins" && amount != null) return `${fmt(amount)} Coins`;
  if (type === "bonus" && amount != null) return `${fmt(amount)} € de bono`;
  if (type && amount != null) return `${fmt(amount)} · ${type}`;
  return "Sin recompensa configurada";
}

export default function XpLevelsAdminPanel() {
  const [data, setData] = useState<AdminXpResponse | null>(null);
  const [levels, setLevels] = useState<XpLevelConfig[]>([]);
  const [tiers, setTiers] = useState<XpTierConfig[]>([]);
  const [busyKey, setBusyKey] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [editingLevel,setEditingLevel]=useState<number|null>(null);
  const [missionSearch,setMissionSearch]=useState("");

  const authFetch = useCallback(async (url: string, init?: RequestInit) => {
    const { data: sessionData } = await sb.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) throw new Error("Sesión no disponible");
    return fetch(url, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(init?.headers || {}),
      },
      cache: "no-store",
    });
  }, []);

  const load = useCallback(async () => {
    setBusyKey("load");
    setError("");
    try {
      const response = await authFetch(`/api/admin/xp-system?t=${Date.now()}`);
      const json = await response.json();
      if (!response.ok || !json.ok) throw new Error(json.error || "No se pudo cargar la configuración");
      const typed = json as AdminXpResponse;
      setData(typed);
      setLevels(typed.level_config || []);
      setTiers(typed.tier_config || []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No se pudo cargar la configuración");
    } finally {
      setBusyKey("");
    }
  }, [authFetch]);

  useEffect(() => {
    void load();
    const channel=sb.channel("admin-xp-level-missions").on("postgres_changes",{event:"*",schema:"public",table:"worker_xp_level_config"},()=>void load()).on("postgres_changes",{event:"*",schema:"public",table:"worker_xp_tier_config"},()=>void load()).on("postgres_changes",{event:"*",schema:"public",table:"worker_xp_missions"},()=>void load()).on("postgres_changes",{event:"*",schema:"public",table:"worker_xp_level_missions"},()=>void load()).on("postgres_changes",{event:"*",schema:"public",table:"worker_xp_tier_missions"},()=>void load()).subscribe();
    return()=>{void sb.removeChannel(channel)};
  }, [load]);

  const configured = useMemo(() => buildConfiguredLevels(levels), [levels]);
  const cumulativeByLevel = useMemo(
    () => new Map(configured.map((level) => [level.level, level.cumulative_xp])),
    [configured],
  );
  const maximumXp = configured[configured.length - 1]?.cumulative_xp ?? 0;

  async function saveLevel(level: XpLevelConfig) {
    setBusyKey(`level:${level.level}`);
    setError("");
    setMessage("");
    try {
      const response = await authFetch("/api/admin/xp-system", {
        method: "POST",
        body: JSON.stringify({ op: "save_level_config", ...level }),
      });
      const json = await response.json();
      if (!response.ok || !json.ok) throw new Error(json.error || "No se pudo guardar el nivel");
      setMessage(`Nivel ${level.level} actualizado correctamente.`);
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No se pudo guardar el nivel");
    } finally {
      setBusyKey("");
    }
  }

  async function saveTier(tier: XpTierConfig) {
    setBusyKey(`tier:${tier.key}`);
    setError("");
    setMessage("");
    try {
      const response = await authFetch("/api/admin/xp-system", {
        method: "POST",
        body: JSON.stringify({ op: "save_tier_config", ...tier }),
      });
      const json = await response.json();
      if (!response.ok || !json.ok) throw new Error(json.error || "No se pudo guardar el rango");
      setMessage(`${tier.name} actualizado correctamente.`);
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No se pudo guardar el rango");
    } finally {
      setBusyKey("");
    }
  }

  function patchLevel(levelNumber: number, patch: Partial<XpLevelConfig>) {
    setLevels((current) => current.map((level) => level.level === levelNumber ? { ...level, ...patch } : level));
  }

  function patchTier(key: string, patch: Partial<XpTierConfig>) {
    setTiers((current) => current.map((tier) => tier.key === key ? { ...tier, ...patch } : tier));
  }

  async function missionOp(body:Record<string,unknown>){setBusyKey("mission");setError("");try{const response=await authFetch("/api/admin/xp-system",{method:"POST",body:JSON.stringify(body)});const json=await response.json();if(!response.ok||!json.ok)throw new Error(json.error||"No se pudo guardar la misión");await load();setMessage("Catálogo de misiones actualizado en tiempo real.");return json;}catch(e){setError(e instanceof Error?e.message:"No se pudo guardar la misión");throw e;}finally{setBusyKey("");}}
  const linkedLevels=(id:string)=>new Set((data?.missions?.levels||[]).filter(x=>x.mission_id===id).map(x=>x.level));
  const linkedTiers=(id:string)=>new Set((data?.missions?.tiers||[]).filter(x=>x.mission_id===id).map(x=>x.tier_key));
  async function toggleLevelMission(missionId:string,levelNumber:number){const keys=[...linkedLevels(missionId)];const next=keys.includes(levelNumber)?keys.filter(x=>x!==levelNumber):[...keys,levelNumber];await missionOp({op:"set_mission_links",scope:"level",mission_id:missionId,keys:next});}
  async function toggleTierMission(missionId:string,tierKey:string){const keys=[...linkedTiers(missionId)];const next=keys.includes(tierKey)?keys.filter(x=>x!==tierKey):[...keys,tierKey];await missionOp({op:"set_mission_links",scope:"tier",mission_id:missionId,keys:next});}
  const selectedLevel=editingLevel==null?null:levels.find(level=>level.level===editingLevel)||null;
  const visibleMissions=(data?.missions?.catalog||[]).filter(mission=>`${mission.name} ${mission.description} ${mission.mission_key}`.toLowerCase().includes(missionSearch.trim().toLowerCase()));

  if (!data && !error) return <div className={styles.loading}>Cargando Sistema de niveles telefonista…</div>;
  if (!data) return <div className={styles.loading}>{error || "No se pudo cargar la configuración de niveles."}</div>;

  return (
    <section className={styles.page}>
      <header className={styles.hero}>
        <div className={styles.heroIcon}><Crown /></div>
        <div>
          <span className={styles.eyebrow}>CONFIGURACIÓN CENTRAL · SOLO ADMIN</span>
          <h1>Sistema de niveles telefonista</h1>
          <p>Define niveles, requisitos, categorías y recompensas sin modificar el XP histórico del equipo.</p>
        </div>
        <button type="button" className={styles.refresh} onClick={() => void load()} disabled={busyKey === "load"}>
          <RefreshCw size={16} /> {busyKey === "load" ? "Actualizando…" : "Actualizar"}
        </button>
      </header>

      {!data?.level_config_persisted ? (
        <div className={styles.installWarning}>
          <LockKeyhole size={17} />
          <div>
            <strong>Falta instalar la configuración persistente</strong>
            <span>Ejecuta SQL_NECESARIO.sql en Supabase antes de editar niveles.</span>
          </div>
        </div>
      ) : null}

      {error ? <div className={styles.error}>{error}</div> : null}
      {message ? <div className={styles.success}>{message}</div> : null}

      <div className={styles.metrics}>
        <article><Star /><span>Niveles configurados</span><strong>{configured.length}</strong></article>
        <article><Shield /><span>Categorías activas</span><strong>{tiers.filter((tier) => tier.active).length}</strong></article>
        <article><Trophy /><span>XP al nivel máximo</span><strong>{fmt(maximumXp)} XP</strong></article>
        <article><Sparkles /><span>XP histórico</span><strong>Se conserva</strong></article>
      </div>

      <div className={styles.sectionHead}>
        <div>
          <span>CATEGORÍAS</span>
          <h2>Rangos de progresión</h2>
          <p>El nombre y la recompensa especial se reflejan posteriormente en el Panel Telefonista.</p>
        </div>
      </div>

      <div className={styles.tierGrid}>
        {tiers.map((tier) => {
          const assigned = levels
            .filter((level) => level.tier_key === tier.key)
            .sort((a, b) => a.display_order - b.display_order || a.level - b.level)
            .map((level) => level.level);
          return (
            <article key={tier.key} className={styles.tierCard} data-tier={tier.key}>
              <div className={styles.tierTitle}>
                <div className={styles.tierEmblem}><Shield /></div>
                <div>
                  <small>{tier.key}</small>
                  <h3>{tier.name}</h3>
                  <p>{assigned.length ? `Niveles ${assigned.join(" · ")}` : "Sin niveles asignados"}</p>
                </div>
              </div>
              <div className={styles.formGrid}>
                <label>
                  Nombre / título
                  <input value={tier.name} onChange={(event) => patchTier(tier.key, { name: event.target.value })} />
                </label>
                <label>
                  Orden
                  <input type="number" min="1" value={tier.display_order} onChange={(event) => patchTier(tier.key, { display_order: Number(event.target.value) })} />
                </label>
                <label>
                  Recompensa especial
                  <select value={tier.reward_type || ""} onChange={(event) => patchTier(tier.key, { reward_type: event.target.value || null })}>
                    <option value="">Sin recompensa</option>
                    <option value="coins">Coins</option>
                    <option value="bonus">Bono económico</option>
                    <option value="custom">Personalizada</option>
                  </select>
                </label>
                <label>
                  Cantidad
                  <input type="number" min="0" value={tier.reward_amount ?? ""} onChange={(event) => patchTier(tier.key, { reward_amount: event.target.value === "" ? null : Number(event.target.value) })} />
                </label>
                <label className={styles.full}>
                  Texto de recompensa
                  <input placeholder="Ej. Cofre Élite / 750 Coins" value={tier.reward_label || ""} onChange={(event) => patchTier(tier.key, { reward_label: event.target.value || null })} />
                </label>
              </div>
              <div className={styles.cardFooter}>
                <label className={styles.toggle}>
                  <input type="checkbox" checked={tier.active} onChange={(event) => patchTier(tier.key, { active: event.target.checked })} />
                  <span>{tier.active ? "Categoría activa" : "Categoría inactiva"}</span>
                </label>
                <span className={styles.rewardPreview}>{rewardPreview(tier.reward_type, tier.reward_amount, tier.reward_label)}</span>
                <button type="button" onClick={() => void saveTier(tier)} disabled={!data?.level_config_persisted || Boolean(busyKey)}>
                  <Save size={14} /> Guardar categoría
                </button>
              </div>
              <div className={styles.tierMissions}><div><span>MISIONES ESPECIALES</span><strong>{(data?.missions?.tiers||[]).filter(link=>link.tier_key===tier.key).length} configuradas</strong></div>{(data?.missions?.tiers||[]).filter(link=>link.tier_key===tier.key).map(link=>data.missions.catalog.find(m=>m.id===link.mission_id)).filter(Boolean).map((mission:any)=><button type="button" key={mission.id} onClick={()=>void toggleTierMission(mission.id,tier.key)} title="Quitar solo de esta categoría"><Target/>{mission.name}<X/></button>)}<select defaultValue="" onChange={e=>{if(e.target.value)void toggleTierMission(e.target.value,tier.key);e.currentTarget.value=""}}><option value="">+ Añadir misión especial</option>{(data?.missions?.catalog||[]).filter(m=>!linkedTiers(m.id).has(tier.key)).map(m=><option key={m.id} value={m.id}>{m.name} · +{m.xp_reward} XP</option>)}</select></div>
            </article>
          );
        })}
      </div>

      <div className={styles.sectionHead}>
        <div>
          <span>NIVELES CONFIGURADOS</span>
          <h2>Requisitos y recompensas por nivel</h2>
          <p>El XP acumulado se recalcula automáticamente. Cambiar requisitos no altera ningún evento XP ya ganado.</p>
        </div>
      </div>

      <div className={styles.levelTableWrap}>
        <div className={styles.levelHeader}>
          <span>Nivel</span>
          <span>Categoría</span>
          <span>XP → siguiente</span>
          <span>XP acumulado</span>
          <span>Recompensa</span>
          <span>Estado / orden</span>
          <span />
        </div>
        {levels
          .slice()
          .sort((a, b) => a.display_order - b.display_order || a.level - b.level)
          .map((level) => (
            <div className={styles.levelRow} key={level.level}>
              <div className={styles.levelBadge}><Star size={14} /><strong>{level.level}</strong></div>
              <label>
                <span>Categoría</span>
                <select value={level.tier_key} onChange={(event) => patchLevel(level.level, { tier_key: event.target.value })}>
                  {tiers.map((tier) => <option key={tier.key} value={tier.key}>{tier.name}</option>)}
                </select>
              </label>
              <label>
                <span>XP → siguiente</span>
                <input
                  type="number"
                  min="1"
                  disabled={level.level === 20}
                  value={level.level === 20 ? "" : level.xp_to_next ?? ""}
                  placeholder={level.level === 20 ? "Máximo" : "0"}
                  onChange={(event) => patchLevel(level.level, { xp_to_next: event.target.value === "" ? null : Number(event.target.value) })}
                />
              </label>
              <div className={styles.cumulative}>
                <span>XP acumulado</span>
                <strong>{fmt(cumulativeByLevel.get(level.level) ?? 0)} XP</strong>
              </div>
              <div className={styles.rewardFields}>
                <select value={level.reward_type || ""} onChange={(event) => patchLevel(level.level, { reward_type: event.target.value || null })}>
                  <option value="">Sin recompensa</option>
                  <option value="coins">Coins</option>
                  <option value="bonus">Bono</option>
                  <option value="custom">Personalizada</option>
                </select>
                <input type="number" min="0" placeholder="Cantidad" value={level.reward_amount ?? ""} onChange={(event) => patchLevel(level.level, { reward_amount: event.target.value === "" ? null : Number(event.target.value) })} />
                <input placeholder="Texto opcional" value={level.reward_label || ""} onChange={(event) => patchLevel(level.level, { reward_label: event.target.value || null })} />
              </div>
              <div className={styles.stateFields}>
                <label className={styles.toggle}>
                  <input type="checkbox" checked={level.active} onChange={(event) => patchLevel(level.level, { active: event.target.checked })} />
                  <span>{level.active ? "Activo" : "Inactivo"}</span>
                </label>
                <input type="number" min="1" value={level.display_order} onChange={(event) => patchLevel(level.level, { display_order: Number(event.target.value) })} />
              </div>
              <button className={styles.saveLevel} type="button" onClick={() => setEditingLevel(level.level)} disabled={!data?.level_config_persisted || Boolean(busyKey)}>
                <Target size={14} /> Configurar nivel
              </button>
            </div>
          ))}
      </div>

      {selectedLevel?<div className={styles.levelModalBackdrop} role="dialog" aria-modal="true" aria-label={`Configurar nivel ${selectedLevel.level}`} onMouseDown={event=>{if(event.currentTarget===event.target)setEditingLevel(null)}}><article className={styles.levelModal}>
        <button className={styles.modalClose} type="button" onClick={()=>setEditingLevel(null)} aria-label="Cerrar"><X/></button>
        <header><div className={styles.levelOrb}><Star/><strong>{selectedLevel.level}</strong></div><div><span>CONFIGURACIÓN DE NIVEL</span><h2>Nivel {selectedLevel.level}</h2><p>{fmt(cumulativeByLevel.get(selectedLevel.level)||0)} XP acumulados para alcanzarlo · {linkedLevelsFor(selectedLevel.level,data?.missions?.levels).length} misiones</p></div></header>
        <div className={styles.modalGrid}><label>Categoría<select value={selectedLevel.tier_key} onChange={e=>patchLevel(selectedLevel.level,{tier_key:e.target.value})}>{tiers.map(t=><option key={t.key} value={t.key}>{t.name}</option>)}</select></label><label>XP para siguiente<input type="number" min="1" value={selectedLevel.xp_to_next??""} onChange={e=>patchLevel(selectedLevel.level,{xp_to_next:e.target.value===""?null:Number(e.target.value)})}/></label><label>Recompensa<select value={selectedLevel.reward_type||""} onChange={e=>patchLevel(selectedLevel.level,{reward_type:e.target.value||null})}><option value="">Sin recompensa</option><option value="coins">Coins</option><option value="bonus">Bono</option><option value="custom">Personalizada</option></select></label><label>Cantidad<input type="number" min="0" value={selectedLevel.reward_amount??""} onChange={e=>patchLevel(selectedLevel.level,{reward_amount:e.target.value===""?null:Number(e.target.value)})}/></label></div>
        <section className={styles.levelMissionSection}><div className={styles.levelMissionHead}><div><span>MISIONES DEL NIVEL</span><h3>Misiones desbloqueadas</h3></div><button type="button" onClick={()=>{setEditingLevel(null);window.setTimeout(()=>document.getElementById("mission-catalog-editor")?.scrollIntoView({behavior:"smooth"}),0)}}><Plus/> Crear nueva misión</button></div><label className={styles.missionSearch}><Search/><input placeholder="Buscar misión por nombre, objetivo o clave…" value={missionSearch} onChange={e=>setMissionSearch(e.target.value)}/></label><div className={styles.selectorList}>{visibleMissions.map(mission=>{const assigned=linkedLevels(mission.id).has(selectedLevel.level);return <article key={mission.id} className={assigned?styles.assignedMission:""}><Target/><div><strong>{mission.name}</strong><p>{mission.description||`${mission.target_count} acciones`}</p><small>{mission.period} · {mission.active?"Activa":"Inactiva"} · +{mission.xp_reward} XP</small></div><button type="button" onClick={()=>void toggleLevelMission(mission.id,selectedLevel.level)}>{assigned?"Quitar":"Añadir"}</button></article>})}{!visibleMissions.length?<p className={styles.emptySelector}>No hay misiones que coincidan con la búsqueda.</p>:null}</div></section>
        <footer><label className={styles.toggle}><input type="checkbox" checked={selectedLevel.active} onChange={e=>patchLevel(selectedLevel.level,{active:e.target.checked})}/><span>Nivel activo</span></label><button type="button" onClick={()=>void saveLevel(selectedLevel)} disabled={Boolean(busyKey)}><Save/> Guardar cambios</button></footer>
      </article></div>:null}

      <div className={styles.sectionHead}><div><span>CATÁLOGO ÚNICO</span><h2>Misiones por nivel y categoría</h2><p>Desbloquear una misión no entrega XP. El XP se concede una sola vez cuando la telefonista cumple y reclama el objetivo.</p></div></div>
      {!data?.missions?.installed?<div className={styles.installWarning}><LockKeyhole/><div><strong>Falta instalar el sistema de misiones</strong><span>Ejecuta SQL_NECESARIO.sql en Supabase.</span></div></div>:
      <XpMissionBuilder missions={data.missions.catalog||[]} rules={data.rules||[]} levels={levels} tiers={tiers} levelLinks={data.missions.levels||[]} tierLinks={data.missions.tiers||[]} busy={Boolean(busyKey)} operate={missionOp}/>} 

      <div className={styles.infoBox}>
        <Sparkles />
        <div>
          <strong>Entrega automática de recompensas: preparada, no activada</strong>
          <p>Esta pantalla configura qué recompensa corresponde a cada nivel/categoría. No se han creado entregas automáticas de Coins o bonos en esta fase.</p>
        </div>
      </div>
    </section>
  );
}
