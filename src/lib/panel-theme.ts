export type PanelRank = "celestial" | "bronze" | "silver" | "gold" | "elite" | "master" | "legend" | "diamond" | "platinum";

export const PANEL_PALETTES: Record<PanelRank, { accent: string; rgb: string; secondary: string; label: string }> = {
  celestial: { accent: "#c9c1ee", rgb: "201,193,238", secondary: "#8793c7", label: "Celestial" },
  bronze: { accent: "#e1b79b", rgb: "225,183,155", secondary: "#b48573", label: "Bronce" },
  silver: { accent: "#e0e8f4", rgb: "224,232,244", secondary: "#91a5c5", label: "Plata" },
  gold: { accent: "#edd29a", rgb: "237,210,154", secondary: "#b89a67", label: "Oro" },
  elite: { accent: "#c0b5f3", rgb: "192,181,243", secondary: "#8c87cf", label: "Élite" },
  master: { accent: "#edbcdc", rgb: "237,188,220", secondary: "#b480af", label: "Maestra" },
  legend: { accent: "#e7d5b3", rgb: "231,213,179", secondary: "#ac93d9", label: "Leyenda" },
  diamond: { accent: "#bce6f1", rgb: "188,230,241", secondary: "#80aace", label: "Diamante" },
  platinum: { accent: "#bee3d9", rgb: "190,227,217", secondary: "#8bb7b7", label: "Platino" },
};

// Visual mapping only. Access, rewards and rank calculation remain on the server.
export function resolvePanelRank(value?: string | null): PanelRank {
  const key = String(value || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const aliases: Record<string, PanelRank> = {
    bronze: "bronze", bronce: "bronze", silver: "silver", plata: "silver",
    gold: "gold", oro: "gold", elite: "elite", master: "master", maestra: "master",
    maestro: "master", legend: "legend", leyenda: "legend", legendario: "legend",
    diamond: "diamond", diamante: "diamond", platinum: "platinum", platino: "platinum",
    c: "bronze", b: "silver", a: "gold", s: "diamond",
  };
  return aliases[key] || "celestial";
}

export function panelThemeVariables(value?: string | null) {
  const palette = PANEL_PALETTES[resolvePanelRank(value)];
  return {
    "--rank-accent": palette.accent,
    "--rank-rgb": palette.rgb,
    "--rank-secondary": palette.secondary,
  };
}
