const CLIENT_DESTINATIONS = new Set(["dashboard", "oraculo", "rangos", "runas", "ruleta", "precios-ofertas", "vincular-meta"]);

export function clientDestination(search: string): string {
  const params = new URLSearchParams(search);
  const next = params.get("next") || "dashboard";
  const ref = params.get("ref") || "";
  const query = next === "vincular-meta" && /^[a-f0-9]{24}$/.test(ref) ? "?ref="+ref : "";
  return `/cliente/${CLIENT_DESTINATIONS.has(next) ? next : "dashboard"}`+query;
}

export function clientLoginHref(destination: string, search = ""): string {
  const params = new URLSearchParams();
  params.set("next", CLIENT_DESTINATIONS.has(destination) ? destination : "dashboard");
  if (new URLSearchParams(search).get("source") === "instagram") params.set("source", "instagram");
  const ref = new URLSearchParams(search).get("ref") || "";
  if (destination === "vincular-meta" && /^[a-f0-9]{24}$/.test(ref)) params.set("ref",ref);
  return `/cliente/login?${params}`;
}

export function clientRecoveryHref(search: string): string {
  const params = new URLSearchParams();
  const target = new URL(clientDestination(search),"https://local.invalid");
  params.set("next", target.pathname.split("/").pop() || "dashboard");
  if (target.searchParams.has("ref")) params.set("ref",target.searchParams.get("ref")!);
  return `/cliente/recuperar?${params}`;
}
