export const ritualMaterials = {
  shield: { light: "#fff3bf", main: "#efbc50", mid: "#c98524", dark: "#66320e", glow: "#ffbd44", secondary: "#ffe3a0" },
  gem: { light: "#ddffff", main: "#52e5f2", mid: "#258dcf", dark: "#093e81", glow: "#28dced", secondary: "#b3e8ff" },
  sprout: { light: "#d8ffd3", main: "#4edc91", mid: "#189968", dark: "#064c3c", glow: "#43d799", secondary: "#efcb75" },
  heart: { light: "#e1ffec", main: "#81eab8", mid: "#34b588", dark: "#135f53", glow: "#74e5b6", secondary: "#c5ffe6" },
  orbit: { light: "#fff0fc", main: "#f1a1d1", mid: "#b765cf", dark: "#582976", glow: "#ee8fd2", secondary: "#c3a2ff" },
  sparkles: { light: "#f7ecff", main: "#c1a1ed", mid: "#8866bc", dark: "#463265", glow: "#bc9cea", secondary: "#efd296" },
} as const;

export type RitualSymbolName = keyof typeof ritualMaterials;
export type RitualMaterial = (typeof ritualMaterials)[RitualSymbolName];
const slugSymbols: Record<string, RitualSymbolName> = { proteccion: "shield", limpieza: "gem", prosperidad: "sprout", sanacion: "heart", armonizacion: "orbit", amor: "orbit" };

export function ritualSymbol(type?: { slug?: string; icono?: string } | null): RitualSymbolName {
  const icon = type?.icono?.toLowerCase();
  if (icon && Object.prototype.hasOwnProperty.call(ritualMaterials, icon)) return icon as RitualSymbolName;
  return slugSymbols[type?.slug?.toLowerCase() || ""] || "sparkles";
}

// Visual energy uses the real phase; only the explicit completed state receives full light.
export function ritualEnergy(state: string, current: number, count: number) {
  if (state === "completado") return 1;
  if (state === "cancelado") return .06;
  if (state === "pendiente") return .12;
  const phase = count > 1 ? Math.max(0, Math.min(1, current / (count - 1))) : 0;
  return .22 + phase * .58;
}
