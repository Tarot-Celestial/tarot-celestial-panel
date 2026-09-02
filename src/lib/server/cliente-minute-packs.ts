import { CLIENTE_PACKS, getClientePack } from "@/lib/server/cliente-platform";

const NEW_PACK_VALUES = [
  { minutes: 10, priceUsd: 12 },
  { minutes: 20, priceUsd: 22 },
  { minutes: 30, priceUsd: 26 },
  { minutes: 40, priceUsd: 29 },
  { minutes: 50, priceUsd: 32 },
  { minutes: 60, priceUsd: 35 },
] as const;

const sortedBasePacks = [...CLIENTE_PACKS].sort(
  (a: any, b: any) => Number(a?.totalMinutes || 0) - Number(b?.totalMinutes || 0),
);

export const CLIENTE_MINUTE_PACKS = NEW_PACK_VALUES.map((config, index) => {
  const exactPack = sortedBasePacks.find(
    (pack: any) => Number(pack?.totalMinutes || 0) === config.minutes,
  );
  const pack = exactPack || sortedBasePacks[index];
  if (!pack) return null;

  return {
    ...pack,
    nombre: `${config.minutes} minutos`,
    descripcion: `Pack de ${config.minutes} minutos para tus consultas.`,
    priceUsd: config.priceUsd,
    totalMinutes: config.minutes,
    bonusMinutes: 0,
    highlight: config.minutes === 30 ? true : Boolean(pack?.highlight),
  };
}).filter(Boolean) as any[];

export function getConfiguredMinutePack(packId: unknown) {
  const raw = String(packId || "").trim();
  if (!raw) return null;

  const original = getClientePack(raw) as any;
  if (!original) return null;

  return CLIENTE_MINUTE_PACKS.find((pack: any) => String(pack.id) === raw) || null;
}
