/** Shared operational routes; roles remain those of the signed-in worker. */
const ADMIN_CENTRAL_TABS: Readonly<Record<string, string>> = {
  "central-operativa": "central",
  "central-primera-tarotista": "primera-tarotista",
  "central-chat": "chat",
  "central-sorteo": "sorteo",
  "central-whatsapp": "whatsapp",
};

export function adminCentralDestination(tab: string): string | null {
  const target = Object.prototype.hasOwnProperty.call(ADMIN_CENTRAL_TABS, tab) ? ADMIN_CENTRAL_TABS[tab] : null;
  return target ? `/admin/central?tab=${target}` : null;
}

/** Retain the current workspace for existing notification links and bookmarks. */
export function centralWorkspaceDestination(pathname: string | null, target: string): string {
  return pathname === "/admin/central" && /^\/panel-central(?=[?#]|$)/.test(target)
    ? target.replace("/panel-central", "/admin/central") : target;
}
