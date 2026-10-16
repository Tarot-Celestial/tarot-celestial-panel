"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BadgeEuro,
  CircleDollarSign,
  Crown,
  Gem,
  HeartPulse,
  MoonStar,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
  Target,
  UserRoundCheck,
} from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import styles from "./TarotistaRanksAdminPanel.module.css";

const sb = supabaseBrowser();
type RankCode = "C" | "B" | "A" | "S";
type EditorTab = "identity" | "requirements" | "benefits" | "notes";

type Requirements = {
  min_minutes_total: number | null;
  min_minutes_cliente: number | null;
  min_minutes_repite: number | null;
  min_cliente_pct: number | null;
  min_repite_pct: number | null;
  min_captadas: number | null;
};

type BenefitConfig = {
  cliente_rate_bonus: number;
  repite_rate_bonus: number;
  health_bonus: number;
  rank_bonus: number;
  extras: string[];
};

type RankRow = {
  code: RankCode;
  name: string;
  subtitle: string;
  description: string;
  min_cliente_pct: number | null;
  requirement_label: string;
  benefits: string[];
  requirements: Requirements;
  benefit_config: BenefitConfig;
  professional_mode: boolean;
  admin_notes: string;
  sort_order: number;
};

const EMPTY_REQUIREMENTS: Requirements = {
  min_minutes_total: null,
  min_minutes_cliente: null,
  min_minutes_repite: null,
  min_cliente_pct: null,
  min_repite_pct: null,
  min_captadas: null,
};

const EMPTY_BENEFITS: BenefitConfig = {
  cliente_rate_bonus: 0,
  repite_rate_bonus: 0,
  health_bonus: 0,
  rank_bonus: 0,
  extras: [],
};

async function getToken() {
  const { data } = await sb.auth.getSession();
  return data.session?.access_token || null;
}

function numOrNull(value: string) {
  if (value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, n) : null;
}

function numOrZero(value: string) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

function cloneRow(row: RankRow): RankRow {
  return {
    ...row,
    requirements: { ...EMPTY_REQUIREMENTS, ...(row.requirements || {}) },
    benefit_config: { ...EMPTY_BENEFITS, ...(row.benefit_config || {}), extras: [...(row.benefit_config?.extras || [])] },
    benefits: [...(row.benefits || [])],
  };
}

function requirementCount(row: RankRow) {
  return Object.values(row.requirements || {}).filter((value) => value !== null && value !== undefined).length;
}

function benefitCount(row: RankRow) {
  const b = row.benefit_config || EMPTY_BENEFITS;
  return [b.cliente_rate_bonus, b.repite_rate_bonus, b.health_bonus, b.rank_bonus].filter((value) => Number(value || 0) > 0).length + (b.extras || []).length;
}

function RankSigil({ code, large = false }: { code: RankCode; large?: boolean }) {
  const Icon = code === "C" ? MoonStar : code === "B" ? ShieldCheck : code === "A" ? Gem : Crown;
  return (
    <div className={`${styles.sigil} ${large ? styles.sigilLarge : ""}`} data-rank={code}>
      <span className={styles.sigilOrbit} />
      <Icon size={large ? 42 : 25} strokeWidth={1.45} />
      <strong>{code}</strong>
    </div>
  );
}

export default function TarotistaRanksAdminPanel() {
  const [rows, setRows] = useState<RankRow[]>([]);
  const [selected, setSelected] = useState<RankRow | null>(null);
  const [tab, setTab] = useState<EditorTab>("identity");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const current = useMemo(() => selected ? cloneRow(selected) : null, [selected]);

  async function load() {
    setBusy(true);
    setMsg("");
    try {
      const token = await getToken();
      if (!token) throw new Error("NO_AUTH");
      const res = await fetch("/api/admin/tarotista-ranks", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const json = await res.json();
      if (!res.ok || !json?.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      const nextRows = (json.ranks || []).map((row: RankRow) => cloneRow(row));
      setRows(nextRows);
      setSelected((prev) => {
        const code = prev?.code || nextRows?.[0]?.code;
        const found = nextRows.find((row: RankRow) => row.code === code) || nextRows?.[0] || null;
        return found ? cloneRow(found) : null;
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

  function patchRequirement(key: keyof Requirements, value: number | null) {
    setSelected((prev) => prev ? { ...prev, requirements: { ...EMPTY_REQUIREMENTS, ...(prev.requirements || {}), [key]: value } } : prev);
  }

  function patchBenefit(key: keyof Omit<BenefitConfig, "extras">, value: number) {
    setSelected((prev) => prev ? { ...prev, benefit_config: { ...EMPTY_BENEFITS, ...(prev.benefit_config || {}), extras: [...(prev.benefit_config?.extras || [])], [key]: value } } : prev);
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
      setMsg(`✅ Rango ${selected.code} guardado. La lógica queda activa para el periodo real.`);
      await load();
    } catch (error: any) {
      setMsg(`❌ ${error?.message || "Error"}`);
    } finally {
      setBusy(false);
    }
  }

  const requirements = current?.requirements || EMPTY_REQUIREMENTS;
  const benefits = current?.benefit_config || EMPTY_BENEFITS;

  return (
    <section className={styles.shell}>
      <header className={styles.hero}>
        <div className={styles.heroCopy}>
          <div className={styles.eyebrow}><Sparkles size={14}/> Sistema profesional de progresión</div>
          <h1>Rangos tarotistas</h1>
          <p>Configura requisitos, economía y recompensas con datos reales de Rendimiento y Facturación.</p>
          <div className={styles.heroChips}>
            <span><ShieldCheck size={13}/> Fuente real Supabase</span>
            <span><Target size={13}/> Evaluación automática</span>
            <span><BadgeEuro size={13}/> Beneficios estructurados</span>
          </div>
        </div>
        <button onClick={() => void load()} disabled={busy}><RefreshCw size={16}/>{busy ? "Actualizando…" : "Actualizar"}</button>
      </header>

      <div className={styles.grid}>
        <aside className={styles.rankList}>
          <div className={styles.rankListHead}>
            <span>Escalera profesional</span>
            <b>C · B · A · S</b>
          </div>
          {rows.map((row) => (
            <button
              key={row.code}
              className={`${styles.rankCard} ${selected?.code === row.code ? styles.rankCardActive : ""}`}
              data-rank={row.code}
              onClick={() => setSelected(cloneRow(row))}
            >
              <RankSigil code={row.code} />
              <span className={styles.rankCardCopy}>
                <strong>{row.name}</strong>
                <small>{row.subtitle}</small>
                <em>{requirementCount(row)} requisitos · {benefitCount(row)} beneficios</em>
              </span>
            </button>
          ))}
        </aside>

        <div className={styles.editor}>
          {!current ? <div className={styles.empty}>Cargando configuración…</div> : <>
            <div className={styles.editorHead}>
              <div className={styles.editorIdentity}>
                <RankSigil code={current.code} large />
                <div><span>EDITANDO RANGO</span><h2>{current.name}</h2><p>{current.subtitle}</p></div>
              </div>
              <label className={styles.modeSwitch}>
                <input type="checkbox" checked={current.professional_mode} onChange={(e) => patch({ professional_mode: e.target.checked })}/>
                <span><b>Modo profesional</b><small>Lógica estructurada activa</small></span>
              </label>
            </div>

            <nav className={styles.tabs}>
              <button className={tab === "identity" ? styles.activeTab : ""} onClick={() => setTab("identity")}>Identidad</button>
              <button className={tab === "requirements" ? styles.activeTab : ""} onClick={() => setTab("requirements")}>Lógica y requisitos</button>
              <button className={tab === "benefits" ? styles.activeTab : ""} onClick={() => setTab("benefits")}>Beneficios</button>
              <button className={tab === "notes" ? styles.activeTab : ""} onClick={() => setTab("notes")}>Observaciones</button>
            </nav>

            {tab === "identity" && <div className={styles.formGrid}>
              <label><span>Nombre</span><input value={current.name} onChange={(e) => patch({ name: e.target.value })}/></label>
              <label><span>Subtítulo / título místico</span><input value={current.subtitle} onChange={(e) => patch({ subtitle: e.target.value })}/></label>
              <label className={styles.full}><span>Descripción pública</span><textarea value={current.description} onChange={(e) => patch({ description: e.target.value })}/></label>
              <label><span>Orden</span><input type="number" min="1" max="4" value={current.sort_order} onChange={(e) => patch({ sort_order: Number(e.target.value) })}/></label>
              <label><span>Texto resumen del requisito</span><input value={current.requirement_label} onChange={(e) => patch({ requirement_label: e.target.value })}/></label>
            </div>}

            {tab === "requirements" && <div className={styles.logicWrap}>
              <div className={styles.sectionIntro}>
                <Target size={19}/><div><b>Todos los requisitos configurados deben cumplirse</b><span>Los valores salen del periodo real seleccionado en Rendimiento. Deja un campo vacío para no usarlo como condición.</span></div>
              </div>
              <div className={styles.metricGrid}>
                <label><span>Minutos totales mínimos</span><input type="number" min="0" step="1" value={requirements.min_minutes_total ?? ""} placeholder="Sin requisito" onChange={(e) => patchRequirement("min_minutes_total", numOrNull(e.target.value))}/><small>Producción total del periodo.</small></label>
                <label><span>Minutos Cliente mínimos</span><input type="number" min="0" step="1" value={requirements.min_minutes_cliente ?? ""} placeholder="Sin requisito" onChange={(e) => patchRequirement("min_minutes_cliente", numOrNull(e.target.value))}/><small>Minutos reales con código Cliente.</small></label>
                <label><span>Minutos Repite mínimos</span><input type="number" min="0" step="1" value={requirements.min_minutes_repite ?? ""} placeholder="Sin requisito" onChange={(e) => patchRequirement("min_minutes_repite", numOrNull(e.target.value))}/><small>Minutos reales con código Repite.</small></label>
                <label><span>% Cliente mínimo</span><input type="number" min="0" max="100" step="0.01" value={requirements.min_cliente_pct ?? ""} placeholder="Sin requisito" onChange={(e) => patchRequirement("min_cliente_pct", numOrNull(e.target.value))}/><small>Porcentaje calculado sobre minutos totales.</small></label>
                <label><span>% Repite mínimo</span><input type="number" min="0" max="100" step="0.01" value={requirements.min_repite_pct ?? ""} placeholder="Sin requisito" onChange={(e) => patchRequirement("min_repite_pct", numOrNull(e.target.value))}/><small>Fidelización real del periodo.</small></label>
                <label><span>Clientes captados mínimos</span><input type="number" min="0" step="1" value={requirements.min_captadas ?? ""} placeholder="Ej. 4" onChange={(e) => patchRequirement("min_captadas", numOrNull(e.target.value))}/><small>Captaciones confirmadas en Rendimiento.</small></label>
              </div>
            </div>}

            {tab === "benefits" && <div className={styles.logicWrap}>
              <div className={styles.sectionIntro}>
                <BadgeEuro size={19}/><div><b>Beneficios desbloqueados al alcanzar el rango</b><span>Los incrementos económicos quedan estructurados para el cálculo de factura; los extras se muestran como ventajas del nivel.</span></div>
              </div>
              <div className={styles.benefitGrid}>
                <label><span><CircleDollarSign size={15}/> Extra €/min Cliente</span><input type="number" min="0" step="0.001" value={benefits.cliente_rate_bonus || ""} placeholder="0,00" onChange={(e) => patchBenefit("cliente_rate_bonus", numOrZero(e.target.value))}/><small>Se suma a la tarifa base Cliente.</small></label>
                <label><span><CircleDollarSign size={15}/> Extra €/min Repite</span><input type="number" min="0" step="0.001" value={benefits.repite_rate_bonus || ""} placeholder="0,00" onChange={(e) => patchBenefit("repite_rate_bonus", numOrZero(e.target.value))}/><small>Se suma a la tarifa base Repite.</small></label>
                <label><span><HeartPulse size={15}/> Bono de salud (€)</span><input type="number" min="0" step="0.01" value={benefits.health_bonus || ""} placeholder="0,00" onChange={(e) => patchBenefit("health_bonus", numOrZero(e.target.value))}/><small>Bono fijo mensual asociado al rango.</small></label>
                <label><span><Crown size={15}/> Bono de rango (€)</span><input type="number" min="0" step="0.01" value={benefits.rank_bonus || ""} placeholder="0,00" onChange={(e) => patchBenefit("rank_bonus", numOrZero(e.target.value))}/><small>Premio fijo mensual del nivel.</small></label>
                <label className={styles.full}><span>Beneficios extra · uno por línea</span><textarea value={(benefits.extras || []).join("\n")} placeholder="Ej. Prioridad en campañas\nAcceso a formación premium" onChange={(e) => patch({ benefit_config: { ...benefits, extras: e.target.value.split("\n").map((v) => v.trim()).filter(Boolean) } })}/></label>
              </div>
            </div>}

            {tab === "notes" && <div className={styles.logicWrap}>
              <div className={styles.sectionIntro}>
                <UserRoundCheck size={19}/><div><b>Observaciones internas</b><span>Estas notas son solo para administración y no se muestran a las tarotistas.</span></div>
              </div>
              <label className={styles.notesField}><textarea rows={8} value={current.admin_notes || ""} placeholder="Ej. Revisar este rango al cierre del trimestre…" onChange={(e) => patch({ admin_notes: e.target.value })}/></label>
            </div>}

            <div className={styles.footer}>
              <span>{msg || "Los cambios alimentan el mismo sistema que ve Tarot Leonaris y se calculan con métricas reales."}</span>
              <button className={styles.save} onClick={() => void save()} disabled={busy}><Save size={16}/>{busy ? "Guardando…" : "Guardar rango"}</button>
            </div>
          </>}
        </div>
      </div>
    </section>
  );
}
