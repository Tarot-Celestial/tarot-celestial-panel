import { useId } from "react";
import { ritualMaterials, type RitualSymbolName } from "./ritual-materials";

/** Filled, layered materials. All colours come from the shared palette. */
export default function RitualSymbol({ kind }: { kind: RitualSymbolName }) {
  const id = `ritual-${useId().replace(/:/g, "")}`;
  const p = ritualMaterials[kind];
  const paint = (name: string) => `url(#${id}-${name})`;
  return <svg viewBox="0 0 200 220" fill="none" data-symbol={kind} aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id={`${id}-body`} x1=".15" y1="0" x2=".85" y2="1"><stop stopColor={p.light} /><stop offset=".24" stopColor={p.main} /><stop offset=".62" stopColor={p.mid} /><stop offset="1" stopColor={p.dark} /></linearGradient>
      <linearGradient id={`${id}-edge`} x1="0" y1="0" x2="1" y2="1"><stop stopColor={p.light} /><stop offset=".3" stopColor={p.main} /><stop offset=".5" stopColor={p.light} /><stop offset=".72" stopColor={p.mid} /><stop offset="1" stopColor={p.dark} /></linearGradient>
      <linearGradient id={`${id}-facet`} x1="0" y1="1" x2="1" y2="0"><stop stopColor={p.dark} /><stop offset=".55" stopColor={p.mid} /><stop offset="1" stopColor={p.main} /></linearGradient>
      <radialGradient id={`${id}-core`} cx=".4" cy=".35" r=".65"><stop stopColor={p.light} /><stop offset=".3" stopColor={p.main} /><stop offset="1" stopColor={p.dark} /></radialGradient>
      <radialGradient id={`${id}-light`}><stop stopColor={p.light} stopOpacity=".85" /><stop offset="1" stopColor={p.glow} stopOpacity="0" /></radialGradient>
    </defs>
    {kind === "shield" && <>
      <path d="M103 17C78 37 48 42 25 43v69c0 40 29 72 78 96 47-24 77-56 77-96V43c-23-1-54-6-77-26Z" fill={p.dark} transform="translate(3 5)" />
      <path d="M100 12C76 32 46 39 23 39v69c0 40 29 72 77 96 48-24 77-56 77-96V39c-23 0-53-7-77-27Z" fill={paint("edge")} />
      <path d="M100 29C79 44 53 51 37 52v55c0 32 24 60 63 82 39-22 63-50 63-82V52c-16-1-42-8-63-23Z" fill={paint("body")} stroke={p.light} strokeOpacity=".65" strokeWidth="2" />
      <path d="M100 31v156c38-24 60-50 60-80V54c-22-4-43-11-60-23Z" fill={paint("facet")} />
      <path d="M44 58v47c0 24 15 44 33 60" stroke={p.light} strokeWidth="3" opacity=".55" />
      <ellipse cx="99" cy="105" rx="44" ry="55" fill={paint("light")} opacity="var(--inner-light)" />
      <path d="m100 66 9 31 25 12-25 9-9 35-9-35-25-9 25-12Z" fill={p.dark} transform="translate(2 3)" />
      <path d="m100 66 9 31 25 12-25 9-9 35-9-35-25-9 25-12Z" fill={paint("edge")} stroke={p.light} strokeWidth="1" />
    </>}
    {kind === "gem" && <>
      <path d="m48 34 105 0 37 55-88 118L12 89Z" fill={p.dark} transform="translate(2 5)" />
      <path d="m48 30 105 0 35 55-88 119L12 85Z" fill={paint("body")} stroke={p.main} strokeWidth="2" />
      <path d="m48 30 22 12-37 39-21 4Z" fill={p.light} /><path d="m48 30 105 0-23 12H70Z" fill={p.secondary} />
      <path d="m153 30 35 55-23-5-35-38Z" fill={p.main} />
      <path d="m70 42 30-12 30 12-30 39Z" fill={paint("facet")} /><path d="m70 42-37 39 45 0 22-51Z" fill={p.mid} /><path d="m130 42 35 38-43 1-22-51Z" fill={p.dark} />
      <path d="m12 85 88 119-67-113Z" fill={p.main} /><path d="m188 85-88 119 65-113Z" fill={p.light} />
      <path d="m33 91 45 0 22 113Z" fill={paint("facet")} /><path d="m165 91-43 0-22 113Z" fill={paint("body")} />
      <path d="m78 91 44 0-22 113Z" fill={p.dark} /><path d="m78 91 22 9 0 104Z" fill={p.mid} />
      <path d="m12 85 66-4 22-51 22 51 66 4-66 6-22 113L78 91Z" stroke={p.light} strokeOpacity=".65" strokeWidth="2" />
      <ellipse cx="100" cy="100" rx="65" ry="48" fill={paint("light")} opacity="var(--inner-light)" />
      <path d="m48 35 101 0M24 80l24-37" stroke={p.light} strokeWidth="3" strokeLinecap="round" />
    </>}
    {kind === "sprout" && <>
      <ellipse cx="101" cy="192" rx="39" ry="10" fill={p.dark} /><ellipse cx="98" cy="187" rx="38" ry="9" fill={p.secondary} />
      <path d="M100 186c0-62 6-102 26-143" stroke={p.dark} strokeWidth="12" strokeLinecap="round" /><path d="M97 184c0-62 6-102 26-143" stroke={p.secondary} strokeWidth="7" strokeLinecap="round" />
      <path d="M102 128C40 135 20 99 21 54c57-1 88 21 81 74Z" fill={paint("body")} stroke={p.main} strokeWidth="2" /><path d="M102 128 21 54c2 49 24 79 81 74Z" fill={paint("facet")} />
      <path d="M106 100c-7-57 22-82 76-78-1 52-28 80-76 78Z" fill={paint("body")} stroke={p.main} strokeWidth="2" /><path d="m106 100 76-78c-3 53-28 79-76 78Z" fill={paint("facet")} />
      <path d="M100 158c-40 8-64-7-70-38 37-10 66 3 70 38Z" fill={paint("body")} /><path d="M106 153c3-36 29-51 66-42-5 32-27 47-66 42Z" fill={paint("body")} />
      <path d="m35 69 65 57m17-39 49-49m-125 91 52 25m20-9 45-26" stroke={p.secondary} strokeWidth="2" strokeLinecap="round" opacity=".8" />
      <ellipse cx="94" cy="110" rx="58" ry="65" fill={paint("light")} opacity="var(--inner-light)" />
    </>}
    {kind === "heart" && <>
      <path d="M100 193C77 168 15 125 15 76 15 21 76 12 100 51c24-39 85-30 85 25 0 49-62 92-85 117Z" fill={p.dark} transform="translate(3 6)" />
      <path d="M100 193C77 168 15 125 15 76 15 21 76 12 100 51c24-39 85-30 85 25 0 49-62 92-85 117Z" fill={paint("body")} stroke={p.main} strokeWidth="2" />
      <path d="M100 183c24-29 75-67 75-108 0-18-6-29-16-35 14 46-8 94-59 143Z" fill={p.dark} opacity=".45" />
      <ellipse cx="92" cy="94" rx="67" ry="65" fill={paint("light")} opacity="var(--inner-light)" />
      <path d="M31 78c-1-25 22-42 43-26" stroke={p.light} strokeWidth="7" strokeLinecap="round" opacity=".8" /><path d="M33 100c7 23 20 38 36 51" stroke={p.light} strokeWidth="3" strokeLinecap="round" opacity=".35" />
      <path d="m100 79 5 18 17 6-17 5-5 19-5-19-17-5 17-6Z" fill={p.light} opacity="var(--inner-light)" />
    </>}
    {kind === "orbit" && <>
      <ellipse cx="100" cy="112" rx="87" ry="34" transform="rotate(-38 100 112)" stroke={p.secondary} strokeWidth="7" />
      <ellipse cx="100" cy="112" rx="82" ry="33" transform="rotate(38 100 112)" stroke={p.mid} strokeWidth="5" />
      <path d="m100 38 47 34 12 56-59 66-58-66 11-56Z" fill={paint("body")} stroke={p.light} strokeOpacity=".65" strokeWidth="2" />
      <path d="m100 38 0 156-58-66 11-56Z" fill={paint("facet")} opacity=".65" /><path d="m100 38 47 34-47 23-47-23Z" fill={p.light} opacity=".4" />
      <path d="m53 72 47 23 47-23-20 63-27 59-27-59Z" fill={paint("core")} />
      <ellipse cx="99" cy="109" rx="51" ry="58" fill={paint("light")} opacity="var(--inner-light)" />
      <path d="M25 164c14 17 63 0 111-37 41-32 60-63 47-75" stroke={p.secondary} strokeWidth="6" strokeLinecap="round" /><path d="M26 163c15 13 59-1 100-32" stroke={p.light} strokeWidth="2" strokeLinecap="round" />
      <circle cx="164" cy="81" r="12" fill={paint("core")} /><circle cx="43" cy="64" r="9" fill={paint("body")} />
    </>}
    {kind === "sparkles" && <>
      <path d="m100 23 23 62 58 27-58 26-23 63-23-63-58-26 58-27Z" fill={paint("body")} stroke={p.light} strokeWidth="2" />
      <path d="m100 23 0 89-81 0 58-27Zm0 89 81 0-58 26-23 63Z" fill={paint("facet")} />
      <ellipse cx="100" cy="112" rx="52" ry="65" fill={paint("light")} opacity="var(--inner-light)" />
      <path d="m159 23 5 14 14 5-14 5-5 14-5-14-14-5 14-5Z" fill={p.secondary} />
    </>}
  </svg>;
}
