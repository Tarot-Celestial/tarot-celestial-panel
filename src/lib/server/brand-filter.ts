import type { SupabaseClient } from "@supabase/supabase-js";

export type BrandKey = "celestial" | "orion";

export function normalizeBrand(value: unknown): BrandKey {
  return String(value || "").trim().toLowerCase() === "orion" ? "orion" : "celestial";
}

export function brandFromRequest(req: Request): BrandKey {
  const url = new URL(req.url);
  return normalizeBrand(url.searchParams.get("brand") || url.searchParams.get("marca"));
}

export function originMatchesBrand(origin: unknown, brand: BrandKey) {
  const text = String(origin || "").trim().toLowerCase();
  const isOrion = text.includes("orion");
  return brand === "orion" ? isOrion : !isOrion;
}

export async function filterRowsByBrand<T extends Record<string, any>>(
  admin: SupabaseClient,
  rows: T[],
  brand: BrandKey,
  clientIdField = "cliente_id"
): Promise<T[]> {
  const ids = Array.from(new Set((rows || []).map((row) => String(row?.[clientIdField] || "").trim()).filter(Boolean)));
  if (!ids.length) return brand === "celestial" ? rows : [];

  const originById = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const { data, error } = await admin.from("crm_clientes").select("id, origen").in("id", chunk);
    if (error) throw error;
    for (const client of data || []) originById.set(String(client.id), String(client.origen || ""));
  }

  return (rows || []).filter((row) => {
    const id = String(row?.[clientIdField] || "").trim();
    if (!id) return brand === "celestial";
    return originMatchesBrand(originById.get(id), brand);
  });
}
