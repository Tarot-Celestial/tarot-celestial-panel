export type TarotistaRankCode = "C" | "B" | "A" | "S";

export type TarotistaRankConfig = {
  code: TarotistaRankCode;
  name: string;
  subtitle: string;
  description: string;
  min_cliente_pct: number | null;
  requirement_label: string;
  benefits: string[];
  sort_order: number;
};

export type TarotistaRankState = {
  current: TarotistaRankConfig;
  next: TarotistaRankConfig | null;
  pct_cliente: number;
  progress_to_next: number | null;
  remaining_to_next: number | null;
  max_reached: boolean;
};

const RANK_ORDER: TarotistaRankCode[] = ["C", "B", "A", "S"];

// Fallback compatible con la lógica histórica real del proyecto:
// B hasta 25% Cliente y A por encima de 25%.
// C y S se exponen visualmente, pero no se les inventa un umbral.
export const TAROTISTA_RANK_FALLBACK: TarotistaRankConfig[] = [
  {
    code: "C",
    name: "Rango C",
    subtitle: "Inicio del camino",
    description: "Nivel inicial.",
    min_cliente_pct: null,
    requirement_label: "Requisito pendiente de configurar",
    benefits: [],
    sort_order: 1,
  },
  {
    code: "B",
    name: "Rango B",
    subtitle: "Crecimiento",
    description: "Crecimiento profesional.",
    min_cliente_pct: 0,
    requirement_label: "Hasta 25 % de minutos con código Cliente",
    benefits: [],
    sort_order: 2,
  },
  {
    code: "A",
    name: "Rango A",
    subtitle: "Rendimiento destacado",
    description: "Rendimiento destacado.",
    min_cliente_pct: 25.000001,
    requirement_label: "Más de 25 % de minutos con código Cliente",
    benefits: [],
    sort_order: 3,
  },
  {
    code: "S",
    name: "Rango S",
    subtitle: "Élite profesional",
    description: "Élite profesional.",
    min_cliente_pct: null,
    requirement_label: "Requisito pendiente de configurar",
    benefits: [],
    sort_order: 4,
  },
];

function clampPct(value: unknown) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

function normalizeBenefits(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }
  return [];
}

function normalizeRankRow(raw: any, fallback: TarotistaRankConfig): TarotistaRankConfig {
  const threshold = raw?.min_cliente_pct;
  return {
    code: fallback.code,
    name: String(raw?.name || fallback.name),
    subtitle: String(raw?.subtitle || fallback.subtitle),
    description: String(raw?.description || fallback.description),
    min_cliente_pct:
      threshold === null || threshold === undefined || threshold === ""
        ? null
        : clampPct(threshold),
    requirement_label: String(raw?.requirement_label || fallback.requirement_label),
    benefits: normalizeBenefits(raw?.benefits),
    sort_order: Number(raw?.sort_order || fallback.sort_order),
  };
}

export async function loadTarotistaRankConfig(admin: any): Promise<TarotistaRankConfig[]> {
  try {
    const { data, error } = await admin
      .from("tarotista_rank_config")
      .select("code,name,subtitle,description,min_cliente_pct,requirement_label,benefits,sort_order")
      .order("sort_order", { ascending: true });

    if (error) {
      // 42P01 = tabla aún no creada. Mantiene el comportamiento histórico hasta ejecutar SQL.
      if (String(error.code || "") !== "42P01") {
        console.warn("[tarotista-ranks] config fallback:", error.message);
      }
      return TAROTISTA_RANK_FALLBACK.map((row) => ({ ...row, benefits: [...row.benefits] }));
    }

    const byCode = new Map<string, any>((data || []).map((row: any) => [String(row.code || "").toUpperCase(), row]));
    return TAROTISTA_RANK_FALLBACK.map((fallback) => normalizeRankRow(byCode.get(fallback.code), fallback))
      .sort((a, b) => a.sort_order - b.sort_order);
  } catch (error) {
    console.warn("[tarotista-ranks] unexpected fallback:", error);
    return TAROTISTA_RANK_FALLBACK.map((row) => ({ ...row, benefits: [...row.benefits] }));
  }
}

export function resolveTarotistaRankState(
  pctClienteInput: unknown,
  configInput: TarotistaRankConfig[]
): TarotistaRankState {
  const pct_cliente = clampPct(pctClienteInput);
  const config = RANK_ORDER.map((code) =>
    configInput.find((row) => row.code === code) || TAROTISTA_RANK_FALLBACK.find((row) => row.code === code)!
  );

  const assignable = config
    .filter((row) => row.min_cliente_pct !== null)
    .sort((a, b) => Number(a.min_cliente_pct) - Number(b.min_cliente_pct));

  let current = assignable[0] || config.find((row) => row.code === "B") || config[0];
  for (const row of assignable) {
    if (pct_cliente >= Number(row.min_cliente_pct)) current = row;
  }

  const currentIndex = Math.max(0, config.findIndex((row) => row.code === current.code));
  const next = currentIndex < config.length - 1 ? config[currentIndex + 1] : null;
  const max_reached = current.code === "S" || !next;

  if (!next || next.min_cliente_pct === null || current.min_cliente_pct === null) {
    return {
      current,
      next,
      pct_cliente,
      progress_to_next: max_reached ? 100 : null,
      remaining_to_next: null,
      max_reached,
    };
  }

  const from = Number(current.min_cliente_pct);
  const to = Number(next.min_cliente_pct);
  const span = to - from;
  const progress_to_next = span > 0 ? Math.max(0, Math.min(100, ((pct_cliente - from) / span) * 100)) : 100;
  const remaining_to_next = Math.max(0, to - pct_cliente);

  return {
    current,
    next,
    pct_cliente,
    progress_to_next,
    remaining_to_next,
    max_reached,
  };
}
