import type { ReactNode } from "react";

export type ClientArea = "clientes" | "captacion-reservas";
export type OpenClientArea = (area: ClientArea, clientId?: string | null) => void;

export function officeClientHref(area: ClientArea, clientId?: string | null) {
  const params = new URLSearchParams({ departamento: area });
  if (clientId) params.set("cliente", clientId);
  return "/admin/oficina?" + params;
}

export default function OfficeClientLink({ area, clientId, open, children, className, current, label }: {
  area: ClientArea; clientId?: string | null; open: OpenClientArea; children: ReactNode;
  className?: string; current?: boolean; label?: string;
}) {
  return <a href={officeClientHref(area, clientId)} className={className} aria-label={label}
    aria-current={current ? "page" : undefined} onClick={event => {
      if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.defaultPrevented) return;
      event.preventDefault();
      open(area, clientId);
    }}>{children}</a>;
}
