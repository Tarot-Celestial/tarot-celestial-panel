export type RankBenefitConfig = {
  rank_key: string;
  label: string;
  sort_order: number;
  ritual_access: boolean;
  revision: number;
  updated_at?: string | null;
  updated_by?: string | null;
};

export type RankPackageBenefitConfig = {
  rank_key: string;
  package_level: 1 | 2 | 3;
  enabled: boolean;
  coins: number;
  oracle_credits: number;
  roulette_level_1_spins: number;
  roulette_level_2_spins: number;
  roulette_level_3_spins: number;
  roulette_special_spins: number;
  revision: number;
  updated_at?: string | null;
  updated_by?: string | null;
};

export type PackageLevelAssignment = {
  package_source: "standard" | "promotion";
  package_key: string;
  package_label: string;
  package_level: 1 | 2 | 3 | null;
  revision: number;
  updated_at?: string | null;
  updated_by?: string | null;
};

export type DiamondDailyBonusConfig = {
  id: string;
  rank_key: "diamante";
  enabled: boolean;
  name: string;
  description: string;
  coins: number;
  oracle_credits: number;
  roulette_level_1_spins: number;
  roulette_level_2_spins: number;
  roulette_level_3_spins: number;
  roulette_special_spins: number;
  revision: number;
  updated_at?: string | null;
  updated_by?: string | null;
};

const RANK_RE = /^[a-z][a-z0-9_]{1,39}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function integer(value: unknown, field: string, max = 1_000_000) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0 || number > max) {
    throw new Error(`${field}: introduce un número entero entre 0 y ${max.toLocaleString("es-ES")}.`);
  }
  return number;
}

function revision(value: unknown) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error("La revisión de configuración no es válida.");
  return number;
}

export function validateRankPackageBenefitEdit(value: unknown) {
  const row = value as Partial<RankPackageBenefitConfig> | null;
  const level = Number(row?.package_level);
  if (!row || typeof row.rank_key !== "string" || !RANK_RE.test(row.rank_key) || ![1, 2, 3].includes(level)) {
    throw new Error("Rango o nivel de paquete no válido.");
  }
  return {
    rank_key: row.rank_key,
    package_level: level as 1 | 2 | 3,
    enabled: row.enabled === true,
    coins: integer(row.coins, "Coins"),
    oracle_credits: integer(row.oracle_credits, "Oráculo", 100_000),
    roulette_level_1_spins: integer(row.roulette_level_1_spins, "Ruleta nivel 1", 10_000),
    roulette_level_2_spins: integer(row.roulette_level_2_spins, "Ruleta nivel 2", 10_000),
    roulette_level_3_spins: integer(row.roulette_level_3_spins, "Ruleta nivel 3", 10_000),
    roulette_special_spins: integer(row.roulette_special_spins, "Ruleta especial", 10_000),
    revision: revision(row.revision),
  };
}

export function validateRitualAccessEdit(value: unknown) {
  const row = value as Partial<RankBenefitConfig> | null;
  if (!row || typeof row.rank_key !== "string" || !RANK_RE.test(row.rank_key) || typeof row.ritual_access !== "boolean") {
    throw new Error("Configuración de Mi ritual no válida.");
  }
  return { rank_key: row.rank_key, ritual_access: row.ritual_access, revision: revision(row.revision) };
}

export function validatePackageLevelAssignment(value: unknown) {
  const row = value as Partial<PackageLevelAssignment> | null;
  if (!row || !["standard", "promotion"].includes(String(row.package_source)) || !String(row.package_key || "").trim()) {
    throw new Error("Paquete no válido.");
  }
  const level = row.package_level == null || row.package_level === ("" as any) ? null : Number(row.package_level);
  if (level !== null && ![1, 2, 3].includes(level)) throw new Error("Selecciona nivel 1, 2, 3 o Sin asignar.");
  return {
    package_source: row.package_source as "standard" | "promotion",
    package_key: String(row.package_key).trim(),
    package_label: String(row.package_label || row.package_key).trim().slice(0, 160),
    package_level: level as 1 | 2 | 3 | null,
    revision: revision(row.revision),
  };
}

export function validateDiamondDailyBonus(value: unknown) {
  const row = value as Partial<DiamondDailyBonusConfig> | null;
  if (!row || !UUID_RE.test(String(row.id || ""))) throw new Error("Bono Diamante no válido.");
  const name = String(row.name || "").trim();
  const description = String(row.description || "").trim();
  if (!name || name.length > 120 || description.length > 600) throw new Error("Revisa el nombre y la descripción del bono.");
  const result = {
    id: String(row.id),
    enabled: row.enabled === true,
    name,
    description,
    coins: integer(row.coins, "Coins"),
    oracle_credits: integer(row.oracle_credits, "Oráculo", 100_000),
    roulette_level_1_spins: integer(row.roulette_level_1_spins, "Ruleta nivel 1", 10_000),
    roulette_level_2_spins: integer(row.roulette_level_2_spins, "Ruleta nivel 2", 10_000),
    roulette_level_3_spins: integer(row.roulette_level_3_spins, "Ruleta nivel 3", 10_000),
    roulette_special_spins: integer(row.roulette_special_spins, "Ruleta especial", 10_000),
    revision: revision(row.revision),
  };
  const total = result.coins + result.oracle_credits + result.roulette_level_1_spins + result.roulette_level_2_spins + result.roulette_level_3_spins + result.roulette_special_spins;
  if (result.enabled && total <= 0) throw new Error("Para activar el bono Diamante configura al menos una recompensa.");
  return result;
}

export function matrixBenefitLabels(value: Partial<RankPackageBenefitConfig> | null | undefined) {
  if (!value?.enabled) return ["Entrega desactivada"];
  return [
    Number(value.coins) > 0 ? `+${Number(value.coins).toLocaleString("es-ES")} Coins` : null,
    Number(value.oracle_credits) > 0 ? `+${Number(value.oracle_credits)} Oráculo` : null,
    Number(value.roulette_level_1_spins) > 0 ? `+${Number(value.roulette_level_1_spins)} giro N1` : null,
    Number(value.roulette_level_2_spins) > 0 ? `+${Number(value.roulette_level_2_spins)} giro N2` : null,
    Number(value.roulette_level_3_spins) > 0 ? `+${Number(value.roulette_level_3_spins)} giro N3` : null,
    Number(value.roulette_special_spins) > 0 ? `+${Number(value.roulette_special_spins)} giro Especial` : null,
  ].filter(Boolean) as string[];
}
