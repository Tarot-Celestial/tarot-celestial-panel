import type { LeoPersonalityMessage } from "@/lib/leo-celestial-personality";

export type LeoInterestContext =
  | "dashboard"
  | "promotions"
  | "roulette"
  | "oracle"
  | "profile"
  | "tarotists"
  | "notifications"
  | "raffle"
  | "reviews";

export type LeoMemoryProfile = {
  hidden: boolean;
  muted: boolean;
  visit_counts: Record<string, number>;
  interest_scores: Record<string, number>;
  interaction_counts: Record<string, number>;
  last_path?: string | null;
  last_seen_at?: string | null;
};

export type LeoLiveFacts = {
  activePromotion: { id: string; name: string } | null;
  pendingSpins: number;
  oracleCredits: number;
  coins: number;
  minutes: number;
};

export type LeoPersonalizedRecommendation = LeoPersonalityMessage & {
  key: string;
  reason: "available_benefit" | "active_promotion" | "learned_interest";
};

const PATH_CONTEXTS: Array<[string, LeoInterestContext]> = [
  ["/cliente/precios-ofertas", "promotions"],
  ["/cliente/ruleta", "roulette"],
  ["/cliente/oraculo", "oracle"],
  ["/cliente/perfil", "profile"],
  ["/cliente/tarotistas", "tarotists"],
  ["/cliente/notificaciones", "notifications"],
  ["/cliente/sorteo", "raffle"],
  ["/cliente/resenas", "reviews"],
];

export function leoContextForPath(pathname: string): LeoInterestContext {
  return PATH_CONTEXTS.find(([path]) => pathname.startsWith(path))?.[1] || "dashboard";
}

function strongestInterest(scores: Record<string, number>): LeoInterestContext | null {
  const entries = Object.entries(scores)
    .filter((entry): entry is [LeoInterestContext, number] => Number.isFinite(Number(entry[1])))
    .sort((a, b) => Number(b[1]) - Number(a[1]));
  return entries[0] && Number(entries[0][1]) >= 2 ? entries[0][0] : null;
}

export function buildLeoRecommendation(
  profile: LeoMemoryProfile,
  facts: LeoLiveFacts,
): LeoPersonalizedRecommendation | null {
  const favorite = strongestInterest(profile.interest_scores || {});

  if (facts.pendingSpins > 0) {
    return {
      key: `pending-spins:${facts.pendingSpins}`,
      reason: "available_benefit",
      title: "Tienes fortuna esperando",
      message: `Tienes ${facts.pendingSpins} giro${facts.pendingSpins === 1 ? "" : "s"} de ruleta pendiente${facts.pendingSpins === 1 ? "" : "s"}. Puedo acompañarte hasta allí.`,
      mood: "reward",
      pose: "proud",
      href: "/cliente/ruleta",
      actionLabel: "Ver mis giros",
    };
  }

  if (favorite === "oracle" && facts.oracleCredits > 0) {
    return {
      key: `oracle-interest:${facts.oracleCredits}`,
      reason: "available_benefit",
      title: "El Oráculo sigue tu camino",
      message: `El Oráculo está entre tus espacios favoritos y tienes ${facts.oracleCredits} tirada${facts.oracleCredits === 1 ? "" : "s"} disponible${facts.oracleCredits === 1 ? "" : "s"}.`,
      mood: "oracle",
      pose: "oracle",
      href: "/cliente/oraculo",
      actionLabel: "Abrir el Oráculo",
    };
  }

  if (facts.activePromotion && (favorite === "promotions" || favorite === "dashboard" || !favorite)) {
    return {
      key: `promotion:${facts.activePromotion.id}`,
      reason: "active_promotion",
      title: "He encontrado algo para ti",
      message: `${facts.activePromotion.name} está activa ahora. Puedes revisar sus minutos y beneficios reales antes de decidir.`,
      mood: "promo",
      pose: "guide",
      href: "/cliente/precios-ofertas",
      actionLabel: "Ver promoción",
    };
  }

  if (favorite === "oracle") {
    return {
      key: "learned:oracle",
      reason: "learned_interest",
      title: "Conozco mejor tu viaje",
      message: "El Oráculo es una de las secciones que más visitas. La mantendré cerca en tu recorrido.",
      mood: "oracle",
      pose: "curious",
      href: "/cliente/oraculo",
      actionLabel: "Ir al Oráculo",
    };
  }

  if (favorite === "promotions" && facts.activePromotion) {
    return {
      key: `learned:promotions:${facts.activePromotion.id}`,
      reason: "learned_interest",
      title: "Una opción que encaja contigo",
      message: "Sueles revisar los packs y hoy existe una promoción activa con beneficios configurados.",
      mood: "promo",
      pose: "guide",
      href: "/cliente/precios-ofertas",
      actionLabel: "Comparar packs",
    };
  }

  if (favorite === "tarotists") {
    return {
      key: "learned:tarotists",
      reason: "learned_interest",
      title: "Tu conexión importa",
      message: "Sueles explorar a las tarotistas. Puedo llevarte de nuevo a sus perfiles y disponibilidad.",
      mood: "oracle",
      pose: "guide",
      href: "/cliente/tarotistas",
      actionLabel: "Ver tarotistas",
    };
  }

  if (facts.coins > 0 && favorite === "dashboard") {
    return {
      key: `coins:${facts.coins}`,
      reason: "available_benefit",
      title: "Tu saldo también forma parte del viaje",
      message: `Tienes ${facts.coins.toLocaleString("es-ES")} Coins disponibles en tu cuenta.`,
      mood: "reward",
      pose: "sentinel",
      href: "/cliente/dashboard#saldo-coins",
      actionLabel: "Ver mis Coins",
    };
  }

  return null;
}
