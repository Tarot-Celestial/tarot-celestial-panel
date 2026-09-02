export type ClienteMinutePack = {
  id: string;
  nombre: string;
  descripcion: string;
  priceUsd: number;
  totalMinutes: number;
  bonusMinutes: number;
  highlight?: boolean;
};

export const CLIENTE_MINUTE_PACKS: ClienteMinutePack[] = [
  {
    id: "pack_10",
    nombre: "10 minutos",
    descripcion: "Consulta rápida de 10 minutos.",
    priceUsd: 12,
    totalMinutes: 10,
    bonusMinutes: 0,
  },
  {
    id: "pack_20",
    nombre: "20 minutos",
    descripcion: "20 minutos para profundizar en tu consulta.",
    priceUsd: 22,
    totalMinutes: 20,
    bonusMinutes: 0,
  },
  {
    id: "pack_30",
    nombre: "30 minutos",
    descripcion: "30 minutos para una consulta completa.",
    priceUsd: 26,
    totalMinutes: 30,
    bonusMinutes: 0,
    highlight: true,
  },
  {
    id: "pack_40",
    nombre: "40 minutos",
    descripcion: "40 minutos para una consulta extensa.",
    priceUsd: 29,
    totalMinutes: 40,
    bonusMinutes: 0,
  },
  {
    id: "pack_50",
    nombre: "50 minutos",
    descripcion: "50 minutos para trabajar varias preguntas.",
    priceUsd: 32,
    totalMinutes: 50,
    bonusMinutes: 0,
  },
  {
    id: "pack_60",
    nombre: "60 minutos",
    descripcion: "Una hora completa de consulta.",
    priceUsd: 35,
    totalMinutes: 60,
    bonusMinutes: 0,
    highlight: true,
  },
];

export function getConfiguredMinutePack(packId: unknown): ClienteMinutePack | null {
  const id = String(packId || "").trim();
  if (!id) return null;
  return CLIENTE_MINUTE_PACKS.find((pack) => pack.id === id) || null;
}

export function rouletteLevelForPack(pack: ClienteMinutePack): 1 | 2 {
  return pack.totalMinutes <= 30 ? 1 : 2;
}
