"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Crown, LockKeyhole, RefreshCw, Save, Shield, Sparkles, Star, Trophy } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { buildConfiguredLevels, type XpLevelConfig, type XpTierConfig } from "@/lib/xp-levels";
import styles from "./XpLevelsAdminPanel.module.css";

type AdminXpResponse = {
  ok: boolean;
  level_config: XpLevelConfig[];
  tier_config: XpTierConfig[];
  level_config_persisted: boolean;
};

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

  if (!data && !error) return <div className={styles.loading}>Cargando Sistema de niveles telefonista…</div>;

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
            </article>
          );
        })}
      </div>

      <div className={styles.sectionHead}>
        <div>
          <span>NIVELES 1–20</span>
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
              <button className={styles.saveLevel} type="button" onClick={() => void saveLevel(level)} disabled={!data?.level_config_persisted || Boolean(busyKey)}>
                <Save size={14} /> {busyKey === `level:${level.level}` ? "Guardando…" : "Guardar"}
              </button>
            </div>
          ))}
      </div>

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
