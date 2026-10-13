"use client";

import { useEffect, useId, useState, type CSSProperties } from "react";
import RitualSymbol from "./RitualSymbol";
import { ritualMaterials, type RitualSymbolName } from "./ritual-materials";
import styles from "./RitualCrystal.module.css";

type CrystalKind = Exclude<RitualSymbolName, "sparkles">;
type CrystalProps = { kind: RitualSymbolName; frame: number; energy: number; paused: boolean };
type RayDesign = { clip: string; paths: readonly string[]; cores: readonly (readonly [number, number])[] };

// These quiet veins stay inside the central artwork, rather than orbiting the object.
const RAYS: Record<CrystalKind, RayDesign> = {
  heart: {
    clip: "M50 75C44 67 29 55 29 42C29 29 43 27 50 37C57 27 71 29 71 42C71 55 56 67 50 75Z",
    paths: ["M50 70C47 61 55 54 49 40", "M50 62C48 51 37 52 35 36", "M50 62C52 48 61 48 65 35", "M49 57Q41 57 35 46", "M52 56Q60 55 66 44"],
    cores: [[50, 62]],
  },
  shield: {
    clip: "M50 25 70 35V48C70 61 62 70 50 77C38 70 30 61 30 48V35Z",
    paths: ["M50 72Q45 59 50 35", "M50 57Q41 48 35 38", "M50 57Q59 48 65 38", "M50 61Q39 59 35 49", "M50 61Q59 61 65 49"],
    cores: [[50, 57]],
  },
  gem: {
    clip: "M50 21 64 35 66 55 50 79 34 55 36 35Z",
    paths: ["M50 74 49 58 51 43 50 27", "M50 58 43 49 44 37", "M51 44 58 38", "M50 63 57 53 57 46"],
    cores: [[50, 61]],
  },
  sprout: {
    clip: "M43 78 42 66C31 62 28 50 31 39C40 37 47 44 49 48C49 37 57 28 69 28C73 43 66 51 55 55L54 78Z",
    paths: ["M49 74 50 62 51 52 56 40 64 34", "M50 61 44 51 36 45", "M53 48 60 45 65 39", "M48 62 39 56"],
    cores: [[49, 68]],
  },
  orbit: {
    clip: "M27 35H73V68H27Z",
    paths: ["M38 51C32 37 44 35 51 49C59 65 72 62 65 47C59 35 53 43 48 53C42 63 34 61 38 51Z"],
    cores: [[40, 48], [61, 49]],
  },
};

const MOTES = [
  [29, 34, -1.2], [70, 48, -3.4], [38, 69, -.6], [63, 27, -4.2],
  [24, 58, -2.1], [73, 65, -5.3], [44, 22, -3.7], [59, 73, -1.8],
] as const;

// Presentation offsets from the atlas alpha bounds. The plant keeps its seed anchored.
const OFFSETS: Record<CrystalKind, readonly (readonly [number, number])[]> = {
  heart: [[.5, -7.5], [2, -7.5], [0, -7.5], [0, 18], [2, 19], [-.5, 18.5]],
  shield: [[-31.5, 4], [0, 4], [31.5, 4.5], [-31, 6.5], [0, 7], [32.5, 6.5]],
  gem: [[-13, -1.5], [.5, -1], [12.5, -1], [-13, 9.5], [0, 10], [12.5, 10]],
  sprout: [[1.5, 17], [0, 8], [.5, 0], [-4, 1], [-5.5, -2], [-2, -7]],
  orbit: [[-6, -28.5], [-1, -29], [1.5, -28.5], [-9.5, 6], [1.5, 5.5], [3, 4.5]],
};

function offsetTransform(kind: CrystalKind, frame: number, inverse = false) {
  const [x, y] = OFFSETS[kind][frame];
  const factor = (inverse ? -100 : 100) / 512;
  return `translate(${x * factor}%, ${y * factor}%)`;
}

function frameStyle(kind: CrystalKind, frame: number): CSSProperties {
  return { backgroundPosition: `${(frame % 3) * 50}% ${Math.floor(frame / 3) * 100}%`, transform: offsetTransform(kind, frame) };
}

/** The two layers share one decoded atlas; changing phase never fetches another image. */
function AtlasFrames({ kind, url, frame, paused }: { kind: CrystalKind; url: string; frame: number; paused: boolean }) {
  const [frames, setFrames] = useState<{ current: number; previous: number | null }>({ current: frame, previous: null });
  // Adjust before committing the render so a rapid update cannot paint a stale phase.
  if (frames.current !== frame || (paused && frames.previous !== null)) {
    setFrames({ current: frame, previous: paused ? null : frames.current });
  }
  return <div className={styles.atlas} style={{ backgroundImage: `url("${url}")` }}>
    {frames.previous !== null ? <div key={`previous-${frames.current}`} className={`${styles.atlasFrame} ${styles.atlasPrevious}`} style={frameStyle(kind, frames.previous)} /> : null}
    <div key={frames.current} className={`${styles.atlasFrame} ${frames.previous !== null ? styles.atlasArrival : ""}`} style={frameStyle(kind, frames.current)} onAnimationEnd={() => {
      setFrames(value => value.current === frame && value.previous !== null ? { current: value.current, previous: null } : value);
    }} />
  </div>;
}

function InternalLight({ kind, clipId }: { kind: CrystalKind; clipId: string }) {
  const design = RAYS[kind];
  return <>
    <svg className={styles.veins} viewBox="0 0 100 100" fill="none" focusable="false">
      <defs><clipPath id={clipId}><path d={design.clip} /></clipPath></defs>
      <g clipPath={`url(#${clipId})`}>
        {design.paths.map((d, index) => <g key={d}>
          <path className={styles.rayBed} d={d} pathLength="100" />
          <path className={styles.rayPulse} d={d} pathLength="100" style={{ animationDelay: `${index * -.53}s` }} />
        </g>)}
      </g>
    </svg>
    {design.cores.map(([x, y], index) => <span key={index} className={styles.core} style={{ left: `${x}%`, top: `${y}%` }} />)}
  </>;
}

export default function RitualCrystal({ kind, frame, energy, paused }: CrystalProps) {
  const safeKind: RitualSymbolName = Object.prototype.hasOwnProperty.call(ritualMaterials, kind) ? kind : "sparkles";
  const material = ritualMaterials[safeKind];
  const amount = Number.isFinite(energy) ? Math.max(0, Math.min(1, energy)) : 0;
  const phase = Number.isFinite(frame) ? Math.max(0, Math.min(5, Math.trunc(frame))) : 0;
  const source = safeKind === "sparkles" ? null : `/images/rituals/crystal/${safeKind}.webp`;
  const [asset, setAsset] = useState<{ source: string | null; state: "loading" | "ready" | "error" }>({ source: null, state: "loading" });
  const id = `crystal-${useId().replace(/:/g, "")}`;
  const ready = source !== null && asset.source === source && asset.state === "ready";

  useEffect(() => {
    if (!source) return;
    let active = true;
    const image = new Image();
    image.decoding = "async";
    setAsset({ source, state: "loading" });
    image.onload = () => {
      void image.decode().then(() => {
        if (active) setAsset({ source, state: image.naturalWidth > 0 && image.naturalHeight > 0 ? "ready" : "error" });
      }).catch(() => { if (active) setAsset({ source, state: "error" }); });
    };
    image.onerror = () => { if (active) setAsset({ source, state: "error" }); };
    image.src = source;
    return () => {
      active = false;
      image.onload = null;
      image.onerror = null;
      image.removeAttribute("src");
    };
  }, [source]);

  const variables = {
    "--crystal-light": material.light,
    "--crystal-main": material.main,
    "--crystal-glow": material.glow,
    "--crystal-dark": material.dark,
    "--crystal-secondary": material.secondary,
    "--crystal-aura": .1 + amount * .28,
    "--crystal-rays": .12 + amount * .4,
    "--crystal-core": .25 + amount * .7,
    "--crystal-floor": .14 + amount * .36,
    "--inner-light": .12 + amount * .48,
  } as CSSProperties;

  return <div className={styles.crystal} data-ritual-crystal={safeKind} data-frame={phase} data-paused={paused !== false} data-asset-status={ready ? "ready" : !source || (asset.source === source && asset.state === "error") ? "fallback" : "loading"} style={variables} aria-hidden="true">
    <div className={styles.backlight} />
    <div className={styles.glass}><div className={styles.glassReflection} /></div>
    <div className={styles.floorLight} />
    <div className={styles.pedestal}>
      <svg viewBox="0 0 240 68" fill="none" focusable="false">
        <ellipse cx="120" cy="31" rx="109" ry="22" /><ellipse cx="120" cy="31" rx="99" ry="17" />
        <ellipse className={styles.engraving} cx="120" cy="31" rx="90" ry="13" />
        <path d="M13 33V40C22 69 218 69 227 40V33M30 45 34 49M53 51 55 56M80 55 81 61M109 57V63M139 57V63M169 55 168 61M197 50 195 56M216 43 213 48" />
        <path className={styles.engraving} d="m37 30 6-3 6 3-6 3Zm154 0 6-3 6 3-6 3ZM79 18l4 2-4 2-4-2Zm83 1 4 2-4 2-4-2ZM77 41l5 2-5 2-5-2Zm85 0 5 2-5 2-5-2ZM116 15h8M116 47h8" />
      </svg>
    </div>
    <div className={styles.suspension}>
      <div className={styles.art}>
        {ready && source && safeKind !== "sparkles" ? <AtlasFrames key={source} kind={safeKind} url={source} frame={phase} paused={paused !== false} /> : <div className={styles.fallback}><RitualSymbol kind={safeKind} /></div>}
        {ready && source && safeKind !== "sparkles" ? <div className={styles.lightMask} style={{ maskImage: `url("${source}")`, maskPosition: `${(phase % 3) * 50}% ${Math.floor(phase / 3) * 100}%`, transform: offsetTransform(safeKind, phase) }}><div className={styles.lightContent} style={{ transform: offsetTransform(safeKind, phase, true) }}><InternalLight kind={safeKind} clipId={id} /></div></div> : null}
      </div>
    </div>
    <div className={styles.particles}>
      {MOTES.slice(0, 2 + Math.round(amount * 6)).map(([x, y, delay], index) => <span key={index} className={styles.mote} style={{ left: `${x}%`, top: `${y}%`, animationDelay: `${delay}s` }} />)}
    </div>
  </div>;
}
