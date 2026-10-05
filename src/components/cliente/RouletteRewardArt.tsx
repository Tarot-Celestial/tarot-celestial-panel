"use client";
import type { RouletteRewardType } from "@/lib/ruleta";
import styles from "./RouletteRewardArt.module.css";
/** Decorative inventory art; reward amounts always come from the live catalogue. */
export default function RouletteRewardArt({ type, className = "" }: { type: RouletteRewardType; className?: string }) {
  if (type === "oracle_credits") return <span className={styles.oracle + " " + className} data-reward-art={type} aria-hidden="true"><svg viewBox="0 0 100 100" focusable="false"><rect x="20" y="14" width="53" height="75" rx="7" fill="#454376" stroke="#d5bef5" strokeWidth="2" transform="rotate(-15 46 50)"/><rect x="28" y="9" width="53" height="77" rx="7" fill="#242244" stroke="#edcf8b" strokeWidth="2"/><rect x="33" y="14" width="43" height="67" rx="4" fill="#584074" stroke="#b092c7"/><path d="M60 28a20 20 0 1 0 0 37c-19-1-21-28 0-37" fill="#f5d590"/><path d="m63 35 2 6 6 2-6 2-2 6-2-6-6-2 6-2z" fill="#c7edff"/><circle cx="42" cy="23" r="2" fill="#fff3ce"/><circle cx="68" cy="70" r="2" fill="#fff3ce"/></svg></span>;
  return <span className={styles.art + " " + className} data-reward-art={type} aria-hidden="true"/>;
}
