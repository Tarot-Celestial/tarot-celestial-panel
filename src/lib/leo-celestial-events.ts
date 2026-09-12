export const LEO_CELESTIAL_EVENT = "tc-leo-celestial-event";

export type LeoCelestialReaction = "purchase" | "roulette" | "coins" | "oracle" | "gift" | "promotion";

export type LeoCelestialEventDetail = {
  id?: string;
  reaction: LeoCelestialReaction;
  title: string;
  message: string;
  href?: string;
  actionLabel?: string;
  duration?: number;
};

export function announceLeoCelestial(detail: LeoCelestialEventDetail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<LeoCelestialEventDetail>(LEO_CELESTIAL_EVENT, { detail }));
}

export function isLeoCelestialEventDetail(value: unknown): value is LeoCelestialEventDetail {
  if (!value || typeof value !== "object") return false;
  const detail = value as Partial<LeoCelestialEventDetail>;
  return (
    ["purchase", "roulette", "coins", "oracle", "gift", "promotion"].includes(String(detail.reaction)) &&
    typeof detail.title === "string" && detail.title.trim().length > 0 &&
    typeof detail.message === "string" && detail.message.trim().length > 0
  );
}
