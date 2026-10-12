"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import CelestialUniverse from "@/components/cliente/CelestialUniverse";
import { isUniverseRoute } from "@/components/cliente/universe-motion";
import styles from "@/components/cliente/CelestialUniverse.module.css";

/** Shared by client destinations, so navigation keeps the same camera and canvas. */
export default function ClienteUniverseLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname() || "";
  if (!isUniverseRoute(pathname)) return children;
  return <div className={styles.worldFrame}>
    <CelestialUniverse pathname={pathname}>
      <div className={styles.worldContent}>{children}</div>
    </CelestialUniverse>
  </div>;
}
