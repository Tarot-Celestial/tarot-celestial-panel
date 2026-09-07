import type { CSSProperties } from "react";

export type CentralTeam = "agua" | "fuego" | "tierra" | "celestial";
export type CentralThemeVariant = "balanced" | "soft" | "vivid";

export function normalizeCentralTeam(value: unknown): CentralTeam {
  const team = String(value || "").trim().toLowerCase();
  if (team.includes("agua")) return "agua";
  if (team.includes("fuego")) return "fuego";
  if (team.includes("tierra")) return "tierra";
  return "celestial";
}

export function centralTeamLabel(value: unknown) {
  const team = normalizeCentralTeam(value);
  return team === "agua" ? "Equipo Agua" : team === "fuego" ? "Equipo Fuego" : team === "tierra" ? "Equipo Tierra" : "Equipo Celestial";
}

export function centralThemeStyle(teamValue: unknown, variantValue: unknown = "balanced") {
  const team = normalizeCentralTeam(teamValue);
  const variant: CentralThemeVariant = ["soft", "vivid"].includes(String(variantValue)) ? String(variantValue) as CentralThemeVariant : "balanced";
  const palette = {
    agua: ["#58d8eb", "#4366ff", "88,216,235"],
    fuego: ["#ffb24d", "#e64b69", "255,178,77"],
    tierra: ["#dfbc69", "#66986d", "223,188,105"],
    celestial: ["#e7c66f", "#8e68db", "231,198,111"],
  }[team];
  const intensity = variant === "soft" ? ".10" : variant === "vivid" ? ".28" : ".18";
  return {
    "--central-accent": palette[0],
    "--central-accent-2": palette[1],
    "--central-rgb": palette[2],
    "--central-intensity": intensity,
  } as CSSProperties;
}
