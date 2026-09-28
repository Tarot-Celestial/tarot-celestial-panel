import type { CSSProperties, HTMLAttributes } from "react";
import { panelThemeVariables, resolvePanelRank } from "@/lib/panel-theme";

type Props = HTMLAttributes<HTMLDivElement> & { rank?: string | null };

export default function PanelTheme({ rank, className = "", style, children, ...props }: Props) {
  return (
    <div {...props} className={`tc-rank-panel ${className}`} data-panel-rank={resolvePanelRank(rank)}
      style={{ ...panelThemeVariables(rank), ...style } as CSSProperties}>
      {children}
    </div>
  );
}
