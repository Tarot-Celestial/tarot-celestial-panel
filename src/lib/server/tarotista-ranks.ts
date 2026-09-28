export type TarotistaRankCode = "C" | "B" | "A" | "S";

export type TarotistaRankRequirements = {
  min_minutes_total: number | null;
  min_minutes_cliente: number | null;
  min_minutes_repite: number | null;
  min_cliente_pct: number | null;
  min_repite_pct: number | null;
  min_captadas: number | null;
};

export type TarotistaRankBenefitConfig = {
  cliente_rate_bonus: number;
  repite_rate_bonus: number;
  health_bonus: number;
  rank_bonus: number;
  extras: string[];
};

export type TarotistaRankConfig = {
  code: TarotistaRankCode;
  name: string;
  subtitle: string;
  description: string;
  min_cliente_pct: number | null;
  requirement_label: string;
  benefits: string[];
  requirements: TarotistaRankRequirements;
  benefit_config: TarotistaRankBenefitConfig;
  professional_mode: boolean;
  admin_notes: string;
  sort_order: number;
};

export type TarotistaRankMetrics = {
  minutes_total: number;
  minutes_cliente: number;
  minutes_repite: number;
  pct_cliente: number;
  pct_repite: number;
  captadas_total: number;
};

export type TarotistaRequirementProgress = {
  key: keyof TarotistaRankRequirements;
  label: string;
  current: number;
  target: number;
  unit: "min" | "%" | "clientes";
  met: boolean;
  progress: number;
  remaining: number;
};

export type TarotistaRankProgress = {
  configured: boolean;
  eligible: boolean;
  progress: number | null;
  requirements: TarotistaRequirementProgress[];
};

export type TarotistaRankState = {
  current: TarotistaRankConfig;
  next: TarotistaRankConfig | null;
  metrics: TarotistaRankMetrics;
  pct_cliente: number;
  progress_to_next: number | null;
  remaining_to_next: number | null;
  max_reached: boolean;
  rank_progress: Record<TarotistaRankCode, TarotistaRankProgress>;
  next_requirements: TarotistaRequirementProgress[];
};

const RANK_ORDER: TarotistaRankCode[] = ["C", "B", "A", "S"];

const EMPTY_REQUIREMENTS: TarotistaRankRequirements = {
  min_minutes_total: null,
  min_minutes_cliente: null,
  min_minutes_repite: null,
  min_cliente_pct: null,
  min_repite_pct: null,
  min_captadas: null,
};

const EMPTY_BENEFITS: TarotistaRankBenefitConfig = {
  cliente_rate_bonus: 0,
  repite_rate_bonus: 0,
  health_bonus: 0,
  rank_bonus: 0,
  extras: [],
};

// Compatibilidad con la lógica histórica: B desde 0% Cliente y A por encima de 25%.
// Cuando se ejecute el SQL profesional, cada rango podrá combinar minutos, porcentajes y captadas.
export const TAROTISTA_RANK_FALLBACK: TarotistaRankConfig[] = [
  {
    code: "C",
    name: "Rango C",
    subtitle: "Iniciado del Arcano",
    description: "El primer sello del camino profesional. Aquí comienza tu evolución dentro de Tarot Leonaris.",
    min_cliente_pct: null,
    requirement_label: "Rango de entrada",
    benefits: [],
    requirements: { ...EMPTY_REQUIREMENTS },
    benefit_config: { ...EMPTY_BENEFITS, extras: [] },
    professional_mode: true,
    admin_notes: "",
    sort_order: 1,
  },
  {
    code: "B",
    name: "Rango B",
    subtitle: "Guardián del Oráculo",
    description: "La constancia empieza a transformarse en experiencia, fidelización y dominio de la consulta.",
    min_cliente_pct: 0,
    requirement_label: "Crecimiento profesional",
    benefits: [],
    requirements: { ...EMPTY_REQUIREMENTS, min_cliente_pct: 0 },
    benefit_config: { ...EMPTY_BENEFITS, extras: [] },
    professional_mode: true,
    admin_notes: "",
    sort_order: 2,
  },
  {
    code: "A",
    name: "Rango A",
    subtitle: "Maestra del Destino",
    description: "Un nivel de rendimiento destacado para tarotistas con producción, captación y fidelización sólidas.",
    min_cliente_pct: 25.000001,
    requirement_label: "Más de 25 % de minutos con código Cliente",
    benefits: [],
    requirements: { ...EMPTY_REQUIREMENTS, min_cliente_pct: 25.000001 },
    benefit_config: { ...EMPTY_BENEFITS, extras: [] },
    professional_mode: true,
    admin_notes: "",
    sort_order: 3,
  },
  {
    code: "S",
    name: "Rango S",
    subtitle: "Oráculo Supremo",
    description: "La cima del sistema de progresión: excelencia, continuidad y máxima consolidación profesional.",
    min_cliente_pct: null,
    requirement_label: "Configura los requisitos del rango élite",
    benefits: [],
    requirements: { ...EMPTY_REQUIREMENTS },
    benefit_config: { ...EMPTY_BENEFITS, extras: [] },
    professional_mode: true,
    admin_notes: "",
    sort_order: 4,
  },
];

function finite(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function nonNegative(value: unknown) {
  return Math.max(0, finite(value));
}

function clampPct(value: unknown) {
  return Math.max(0, Math.min(100, finite(value)));
}

function nullableNonNegative(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, n) : null;
}

function nullablePct(value: unknown): number | null {
  const n = nullableNonNegative(value);
  return n === null ? null : Math.min(100, n);
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || "").trim()).filter(Boolean);
}

function normalizeRequirements(raw: any, legacyPct: unknown): TarotistaRankRequirements {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const legacy = nullablePct(legacyPct);
  return {
    min_minutes_total: nullableNonNegative(source.min_minutes_total),
    min_minutes_cliente: nullableNonNegative(source.min_minutes_cliente),
    min_minutes_repite: nullableNonNegative(source.min_minutes_repite),
    min_cliente_pct: source.min_cliente_pct === undefined ? legacy : nullablePct(source.min_cliente_pct),
    min_repite_pct: nullablePct(source.min_repite_pct),
    min_captadas: nullableNonNegative(source.min_captadas),
  };
}

function normalizeBenefitConfig(raw: any, legacyBenefits: unknown): TarotistaRankBenefitConfig {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const extras = normalizeStringArray(source.extras).length
    ? normalizeStringArray(source.extras)
    : normalizeStringArray(legacyBenefits);
  return {
    cliente_rate_bonus: nonNegative(source.cliente_rate_bonus),
    repite_rate_bonus: nonNegative(source.repite_rate_bonus),
    health_bonus: nonNegative(source.health_bonus),
    rank_bonus: nonNegative(source.rank_bonus),
    extras,
  };
}

export function rankBenefitsToLabels(config: TarotistaRankBenefitConfig): string[] {
  const labels: string[] = [];
  if (config.cliente_rate_bonus > 0) labels.push(`+${config.cliente_rate_bonus.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 4 })} €/min Cliente`);
  if (config.repite_rate_bonus > 0) labels.push(`+${config.repite_rate_bonus.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 4 })} €/min Repite`);
  if (config.health_bonus > 0) labels.push(`Bono de salud: ${config.health_bonus.toLocaleString("es-ES", { style: "currency", currency: "EUR" })}`);
  if (config.rank_bonus > 0) labels.push(`Bono de rango: ${config.rank_bonus.toLocaleString("es-ES", { style: "currency", currency: "EUR" })}`);
  labels.push(...config.extras);
  return Array.from(new Set(labels.map((label) => label.trim()).filter(Boolean)));
}

function normalizeRankRow(raw: any, fallback: TarotistaRankConfig): TarotistaRankConfig {
  const threshold = raw?.min_cliente_pct;
  const legacyPct = threshold === null || threshold === undefined || threshold === "" ? fallback.min_cliente_pct : threshold;
  const requirements = normalizeRequirements(raw?.requirements, legacyPct);
  const benefit_config = normalizeBenefitConfig(raw?.benefit_config, raw?.benefits ?? fallback.benefits);
  return {
    code: fallback.code,
    name: String(raw?.name || fallback.name),
    subtitle: String(raw?.subtitle || fallback.subtitle),
    description: String(raw?.description || fallback.description),
    min_cliente_pct: requirements.min_cliente_pct,
    requirement_label: String(raw?.requirement_label || fallback.requirement_label),
    benefits: rankBenefitsToLabels(benefit_config),
    requirements,
    benefit_config,
    professional_mode: raw?.professional_mode === undefined || raw?.professional_mode === null ? true : Boolean(raw.professional_mode),
    admin_notes: String(raw?.admin_notes || ""),
    sort_order: Number(raw?.sort_order || fallback.sort_order),
  };
}

async function queryRankRows(admin: any) {
  const modern = await admin
    .from("tarotista_rank_config")
    .select("code,name,subtitle,description,min_cliente_pct,requirement_label,benefits,requirements,benefit_config,professional_mode,admin_notes,sort_order")
    .order("sort_order", { ascending: true });

  if (!modern.error) return modern;
  const code = String(modern.error?.code || "");
  if (!["42703", "PGRST204"].includes(code)) return modern;

  return admin
    .from("tarotista_rank_config")
    .select("code,name,subtitle,description,min_cliente_pct,requirement_label,benefits,sort_order")
    .order("sort_order", { ascending: true });
}

export async function loadTarotistaRankConfig(admin: any): Promise<TarotistaRankConfig[]> {
  try {
    const { data, error } = await queryRankRows(admin);
    if (error) {
      if (String(error.code || "") !== "42P01") console.warn("[tarotista-ranks] config fallback:", error.message);
      return TAROTISTA_RANK_FALLBACK.map((row) => ({
        ...row,
        benefits: [...row.benefits],
        requirements: { ...row.requirements },
        benefit_config: { ...row.benefit_config, extras: [...row.benefit_config.extras] },
      }));
    }

    const byCode = new Map<string, any>((data || []).map((row: any) => [String(row.code || "").toUpperCase(), row]));
    return TAROTISTA_RANK_FALLBACK.map((fallback) => normalizeRankRow(byCode.get(fallback.code), fallback))
      .sort((a, b) => a.sort_order - b.sort_order);
  } catch (error) {
    console.warn("[tarotista-ranks] unexpected fallback:", error);
    return TAROTISTA_RANK_FALLBACK.map((row) => ({
      ...row,
      benefits: [...row.benefits],
      requirements: { ...row.requirements },
      benefit_config: { ...row.benefit_config, extras: [...row.benefit_config.extras] },
    }));
  }
}

export function normalizeTarotistaRankMetrics(input: unknown): TarotistaRankMetrics {
  if (typeof input === "number" || typeof input === "string") {
    return {
      minutes_total: 0,
      minutes_cliente: 0,
      minutes_repite: 0,
      pct_cliente: clampPct(input),
      pct_repite: 0,
      captadas_total: 0,
    };
  }
  const row: any = input || {};
  return {
    minutes_total: nonNegative(row.minutes_total),
    minutes_cliente: nonNegative(row.minutes_cliente),
    minutes_repite: nonNegative(row.minutes_repite),
    pct_cliente: clampPct(row.pct_cliente),
    pct_repite: clampPct(row.pct_repite),
    captadas_total: nonNegative(row.captadas_total),
  };
}

const REQUIREMENT_META: Array<{
  key: keyof TarotistaRankRequirements;
  metric: keyof TarotistaRankMetrics;
  label: string;
  unit: TarotistaRequirementProgress["unit"];
}> = [
  { key: "min_minutes_total", metric: "minutes_total", label: "Minutos totales", unit: "min" },
  { key: "min_minutes_cliente", metric: "minutes_cliente", label: "Minutos Cliente", unit: "min" },
  { key: "min_minutes_repite", metric: "minutes_repite", label: "Minutos Repite", unit: "min" },
  { key: "min_cliente_pct", metric: "pct_cliente", label: "% Cliente", unit: "%" },
  { key: "min_repite_pct", metric: "pct_repite", label: "% Repite", unit: "%" },
  { key: "min_captadas", metric: "captadas_total", label: "Clientes captados", unit: "clientes" },
];

export function evaluateTarotistaRank(config: TarotistaRankConfig, metricsInput: unknown): TarotistaRankProgress {
  const metrics = normalizeTarotistaRankMetrics(metricsInput);
  const requirements: TarotistaRequirementProgress[] = [];
  for (const meta of REQUIREMENT_META) {
    const target = config.requirements?.[meta.key];
    if (target === null || target === undefined) continue;
    const safeTarget = Math.max(0, Number(target));
    const current = Math.max(0, Number(metrics[meta.metric] || 0));
    const met = safeTarget <= 0 ? true : current >= safeTarget;
    requirements.push({
      key: meta.key,
      label: meta.label,
      current,
      target: safeTarget,
      unit: meta.unit,
      met,
      progress: safeTarget <= 0 ? 100 : Math.max(0, Math.min(100, (current / safeTarget) * 100)),
      remaining: Math.max(0, safeTarget - current),
    });
  }

  const configured = requirements.length > 0 || config.code === "C";
  const eligible = config.code === "C" ? requirements.every((item) => item.met) : configured && requirements.every((item) => item.met);
  const progress = requirements.length
    ? requirements.reduce((sum, item) => sum + item.progress, 0) / requirements.length
    : config.code === "C" ? 100 : null;

  return { configured, eligible, progress, requirements };
}

export function resolveTarotistaRankState(
  metricsInput: unknown,
  configInput: TarotistaRankConfig[]
): TarotistaRankState {
  const metrics = normalizeTarotistaRankMetrics(metricsInput);
  const config = RANK_ORDER.map((code) =>
    configInput.find((row) => row.code === code) || TAROTISTA_RANK_FALLBACK.find((row) => row.code === code)!
  );

  const rank_progress = {} as Record<TarotistaRankCode, TarotistaRankProgress>;
  for (const row of config) rank_progress[row.code] = evaluateTarotistaRank(row, metrics);

  let current = config[0];
  for (const row of config) {
    if (rank_progress[row.code].eligible) current = row;
  }

  const currentIndex = Math.max(0, config.findIndex((row) => row.code === current.code));
  const next = currentIndex < config.length - 1 ? config[currentIndex + 1] : null;
  const max_reached = current.code === "S" || !next;
  const nextProgress = next ? rank_progress[next.code] : null;

  return {
    current,
    next,
    metrics,
    pct_cliente: metrics.pct_cliente,
    progress_to_next: max_reached ? 100 : nextProgress?.progress ?? null,
    remaining_to_next: null,
    max_reached,
    rank_progress,
    next_requirements: nextProgress?.requirements || [],
  };
}
