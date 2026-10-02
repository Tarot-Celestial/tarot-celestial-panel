import { useId } from "react";

/** Faceted crystal with shaded depth. Decorative, no external images or font glyphs. */
export default function CrystalEmblem({ size = 80, tone = "diamante" }: { size?: number; tone?: string }) {
  const id = useId().replace(/:/g, "");
  const palettes: Record<string,string[]> = {
    diamante: ["#f0fdff","#9fe1ff","#b7a6fc","#4c5dba"],
    oro: ["#fff7cd","#f5d37e","#d8a345","#8a5628"],
    plata: ["#f7fcff","#cadbea","#9caabc","#627088"],
    bronce: ["#fff1d9","#eab48a","#b67754","#6e433c"],
  };
  const c = palettes[tone] || palettes.diamante;
  return <svg width={size} height={size} viewBox="0 0 120 112" fill="none" aria-hidden="true" style={{flexShrink:0,filter:"drop-shadow(0 10px 12px #111a3840)"}}>
    <defs><linearGradient id={`${id}a`} x1="22" y1="10" x2="95" y2="101" gradientUnits="userSpaceOnUse"><stop stopColor={c[0]}/><stop offset=".45" stopColor={c[1]}/><stop offset="1" stopColor={c[3]}/></linearGradient><linearGradient id={`${id}b`} x1="33" y1="26" x2="75" y2="95"><stop stopColor="white" stopOpacity=".96"/><stop offset="1" stopColor={c[2]}/></linearGradient><radialGradient id={`${id}s`}><stop stopColor={c[2]} stopOpacity=".35"/><stop offset="1" stopColor={c[2]} stopOpacity="0"/></radialGradient></defs>
    <ellipse cx="60" cy="100" rx="39" ry="9" fill={`url(#${id}s)`}/>
    <path d="M27 20L88 16L109 43L64 99L10 48Z" fill={`url(#${id}a)`} stroke={c[0]} strokeWidth="1.4"/>
    <path d="M27 20L42 45L10 48Z" fill={c[1]}/><path d="M27 20L56 17L42 45Z" fill={c[0]}/><path d="M56 17L76 42L42 45Z" fill={c[2]}/><path d="M56 17L88 16L76 42Z" fill="white" fillOpacity=".87"/>
    <path d="M88 16L109 43L76 42Z" fill={c[1]}/><path d="M10 48L42 45L64 99Z" fill={c[3]} fillOpacity=".72"/>
    <path d="M42 45L76 42L64 99Z" fill={`url(#${id}b)`}/><path d="M76 42L109 43L64 99Z" fill={c[2]} fillOpacity=".58"/>
    <path d="M10 48L42 45L76 42L109 43M27 20L42 45L64 99L76 42L88 16" stroke="white" strokeOpacity=".72" strokeWidth=".8"/>
    <path d="M31 27L43 24M92 39L100 40" stroke="white" strokeWidth="2.4" strokeLinecap="round"/>
    <path d="M28 15V27M22 21H34" stroke="white" strokeWidth="1.4" strokeLinecap="round"/>
  </svg>;
}
