type LevelledPack = {
  package_level?: number | null;
  roulette_level?: number | null;
  total_minutes: number;
};

/** Keep the server's package assignment; never infer a purchase level from its position or price. */
export function groupPurchasePacks<T extends LevelledPack>(packs: T[]) {
  const groups = new Map<number | null, T[]>();
  for (const pack of packs) {
    const assigned = Number(pack.package_level ?? pack.roulette_level);
    const level = [1, 2, 3].includes(assigned) ? assigned : null;
    const group = groups.get(level) || [];
    group.push(pack);
    groups.set(level, group);
  }
  return [1, 2, 3, null].flatMap(level => {
    const items = groups.get(level);
    if (!items?.length) return [];
    const minutes = items.map(pack => Number(pack.total_minutes)).filter(value => Number.isFinite(value) && value > 0);
    const min = Math.min(...minutes), max = Math.max(...minutes);
    return [{
      level,
      title: level ? `Nivel ${level}` : "Otros paquetes",
      minutesLabel: minutes.length ? min === max ? `${min} minutos` : `De ${min} a ${max} minutos` : "",
      packs: items,
    }];
  });
}

const retiredPromotionReward = /\b(?:coins?|monedas?|ruletas?|roulette|spins?|giros?)\b/i;

/** Old promotion copy can still contain retired reward promises. Structured minutes and Oracle remain visible. */
export function promotionDisplayCopy(value: string | null | undefined): string {
  const text = String(value || "").trim();
  if (!retiredPromotionReward.test(text)) return text;
  return text
    .split(/\s*(?:\+|\||;|·|\n)\s*/)
    .map(part => part.trim())
    .filter(part => part && !retiredPromotionReward.test(part))
    .join(" + ");
}
