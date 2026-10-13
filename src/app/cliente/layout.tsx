"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import CelestialUniverse from "@/components/cliente/CelestialUniverse";
import CelestialPortal from "@/components/cliente/CelestialPortal";
import { isUniverseRoute } from "@/components/cliente/universe-motion";
import styles from "@/components/cliente/CelestialUniverse.module.css";

/** The home portal is lightweight; planetary destinations share their camera and canvas. */
export default function ClienteUniverseLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname() || "";
  if (!isUniverseRoute(pathname)) return children;
  if (pathname === "/cliente/dashboard") return <div className={styles.worldFrame}><CelestialPortal><div className={styles.worldContent}>{children}</div></CelestialPortal></div>;
  return <div className={styles.worldFrame}>
    <CelestialUniverse pathname={pathname}>
      <div className={styles.worldContent}>{children}</div>
    </CelestialUniverse>
  </div>;
}
