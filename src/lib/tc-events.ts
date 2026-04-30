export const TC_EVENTS = {
  openParking: "tc-open-parking",
  openCaptacion: "tc-open-captacion",
  countersRefresh: "tc-counters-refresh",
  attendanceChanged: "tc-attendance-changed",
  activeTabChanged: "tc-active-tab-changed",
} as const;

export const TC_LEGACY_EVENTS = {
  openParking: "go-to-parking",
  openCaptacion: "go-to-captacion",
} as const;

export type TcEventName = (typeof TC_EVENTS)[keyof typeof TC_EVENTS];
export type TcLegacyEventName = (typeof TC_LEGACY_EVENTS)[keyof typeof TC_LEGACY_EVENTS];

type TcEventDetail = Record<string, unknown>;

export function emitTcEvent(name: TcEventName | TcLegacyEventName, detail?: TcEventDetail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

export function emitDockOpenParking(detail?: TcEventDetail) {
  emitTcEvent(TC_EVENTS.openParking, detail);
  emitTcEvent(TC_LEGACY_EVENTS.openParking, detail);
}

export function emitDockOpenCaptacion(detail?: TcEventDetail) {
  emitTcEvent(TC_EVENTS.openCaptacion, detail);
  emitTcEvent(TC_LEGACY_EVENTS.openCaptacion, detail);
}

export function listenTcEvent(
  names: Array<TcEventName | TcLegacyEventName>,
  handler: EventListener
) {
  if (typeof window === "undefined") return () => {};
  names.forEach((name) => window.addEventListener(name, handler));
  return () => names.forEach((name) => window.removeEventListener(name, handler));
}
