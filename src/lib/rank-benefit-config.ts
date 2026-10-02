export type RankBenefitConfig = {
  rank_key: string; label: string; sort_order: number;
  purchase_coins: number; ritual_access: boolean; revision: number;
};

export function validateRankBenefitEdit(value: unknown) {
  const row = value as Partial<RankBenefitConfig> | null;
  if (!row || typeof row.rank_key !== "string" || !/^[a-z][a-z0-9_]{1,39}$/.test(row.rank_key)
    || !Number.isSafeInteger(row.purchase_coins) || row.purchase_coins! < 0 || row.purchase_coins! > 1000000
    || typeof row.ritual_access !== "boolean" || !Number.isSafeInteger(row.revision) || row.revision! < 0) {
    throw new Error("Configuración no válida: introduce entre 0 y 1.000.000 Coins enteras.");
  }
  return { rank_key: row.rank_key, purchase_coins: row.purchase_coins!, ritual_access: row.ritual_access, revision: row.revision! };
}

export function benefitLabels(value: { purchase_coins: number; ritual_access: boolean }) {
  return [
    ...(value.purchase_coins > 0 ? [`${value.purchase_coins.toLocaleString("es-ES")} Coins por compra`] : []),
    ...(value.ritual_access ? ["Acceso a Mi ritual"] : []),
  ];
}
