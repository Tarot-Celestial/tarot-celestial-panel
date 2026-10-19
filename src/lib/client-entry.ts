const CLIENT_DESTINATIONS = new Set(["dashboard", "oraculo", "rangos", "runas", "ruleta", "precios-ofertas"]);

export function clientDestination(search: string): string {
  const next = new URLSearchParams(search).get("next") || "dashboard";
  return `/cliente/${CLIENT_DESTINATIONS.has(next) ? next : "dashboard"}`;
}

export function clientLoginHref(destination: string, search = ""): string {
  const params = new URLSearchParams();
  params.set("next", CLIENT_DESTINATIONS.has(destination) ? destination : "dashboard");
  if (new URLSearchParams(search).get("source") === "instagram") params.set("source", "instagram");
  return `/cliente/login?${params}`;
}

export function clientRecoveryHref(search: string): string {
  const params = new URLSearchParams();
  params.set("next", clientDestination(search).split("/").pop() || "dashboard");
  return `/cliente/recuperar?${params}`;
}
