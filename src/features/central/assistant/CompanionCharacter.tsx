'use client';
import { memo, useCallback, useEffect, useId, useState, type CSSProperties } from 'react';
import dynamic from 'next/dynamic';
import { PETS, type PetId, type PetState } from '@/lib/central-assistant';
import styles from './CentralCompanion.module.css';

const Model = dynamic(() => import('./Companion3D'), { ssr: false });
type CharacterProps = { pet: PetId; state: PetState; gesture?: string; reduced?: boolean; large?: boolean; portrait?: boolean };

// The lightweight vector version also appears while WebGL loads or is unavailable.
function CompatibleCharacter({ pet, state }: { pet: PetId; state: string }) {
  const id = useId().replace(/:/g, ''), sol = pet === 'sol';
  const sleeping = state === 'sleeping', thinking = state === 'thinking' || state === 'working', happy = state === 'celebrating' || state === 'dancing';
  const waving = state === 'greeting' || state === 'pointing', worried = state === 'error' || state === 'concerned';
  return <svg viewBox="0 0 160 160" width="100%" height="100%" focusable="false" style={{ display: 'block', overflow: 'visible' }}>
    <defs>
      <linearGradient id={`${id}-skin`} x1="0" x2="1" y1="0" y2="1"><stop stopColor={sol ? '#ffe28c' : '#c0a5fa'} /><stop offset=".5" stopColor={sol ? '#ffbc43' : '#9073d3'} /><stop offset="1" stopColor={sol ? '#df851c' : '#62468c'} /></linearGradient>
      <linearGradient id={`${id}-suit`} x1="0" x2="1" y1="0" y2="1"><stop stopColor="#b492fa" /><stop offset="1" stopColor="#55318f" /></linearGradient>
      <linearGradient id={`${id}-face`} x1="0" x2="1" y1="0" y2="1"><stop stopColor="#253657" /><stop offset="1" stopColor="#101725" /></linearGradient>
    </defs>
    {!sol && <g fill="#7653b4" stroke="#ac8dda" strokeWidth="2"><path d="M54 96Q27 73 23 82L28 113Q41 105 54 121Z" /><path d="M106 96Q133 73 137 82L132 113Q119 105 106 121Z" /></g>}
    <g stroke="#302540" strokeWidth="13" strokeLinecap="round"><path d="M69 122L67 142" /><path d="M92 122L94 142" /></g>
    <g fill={`url(#${id}-suit)`} stroke="#e8dfff" strokeWidth="2"><path d="M55 142Q57 132 70 136L74 146H55Z" /><path d="M86 146L90 136Q103 132 106 142V146Z" /></g>
    <ellipse cx="80" cy="112" rx="26" ry="24" fill={`url(#${id}-suit)`} />
    <path d="M65 97L80 113L95 97M80 113V130" stroke="#ffde91" strokeWidth="2" fill="none" />
    <circle cx="80" cy="107" r="3.2" fill="#b4f7fa" />
    <g transform="rotate(10 56 99)"><path d="M55 99Q47 104 47 119" stroke="#8155c5" strokeWidth="13" strokeLinecap="round" /><ellipse cx="47" cy="122" rx="8" ry="9" fill={`url(#${id}-skin)`} /></g>
    <g transform={waving || happy ? 'rotate(-145 104 99)' : 'rotate(-10 104 99)'}><path d="M105 99Q113 104 113 119" stroke="#8155c5" strokeWidth="13" strokeLinecap="round" /><ellipse cx="113" cy="122" rx="8" ry="9" fill={`url(#${id}-skin)`} /></g>
    <g transform={thinking ? 'rotate(-7 80 65)' : undefined}>
      {sol ? <g fill={`url(#${id}-skin)`}>{Array.from({ length: 7 }, (_, i) => <rect key={i} x="75.5" y="10" width="9" height="20" rx="4.5" transform={`rotate(${(i - 3) * 27} 80 60)`} />)}</g> : <g stroke="#efd396" strokeWidth="8" strokeLinecap="round"><path d="M56 32L50 18" /><path d="M104 32L110 18" /></g>}
      <ellipse cx="80" cy="64" rx="40" ry="38" fill={`url(#${id}-skin)`} />
      <path d="M40 58Q39 22 80 26Q121 22 120 58" stroke="#39304f" strokeWidth="4" fill="none" />
      <rect x="49" y="42" width="62" height="47" rx="20" fill={`url(#${id}-face)`} stroke={sol ? '#ffe298' : '#ba9beb'} strokeWidth="2.5" />
      <path d="M60 49Q72 44 85 46" stroke="#496381" strokeWidth="2" strokeLinecap="round" opacity=".65" fill="none" />
      <g fill="#adf5f6" stroke="#adf5f6" strokeWidth="2.5" strokeLinecap="round">
        {sleeping || happy ? <><path d="M61 63Q65 69 70 63" fill="none" /><path d="M90 63Q95 69 99 63" fill="none" /></> : <><ellipse cx="65" cy="63" rx="3.4" ry={worried ? 4 : 5.5} /><ellipse cx="95" cy="63" rx="3.4" ry={worried ? 4 : 5.5} /></>}
        {state === 'talking' || sleeping ? <ellipse cx="80" cy="77" rx="2.3" ry="3.5" stroke="none" /> : <path d={worried ? 'M75 78Q80 74 85 78' : 'M75 76Q80 81 85 76'} fill="none" strokeWidth="2" />}
      </g>
      <g fill="#ffa98a" opacity=".7"><ellipse cx="58" cy="74" rx="3" ry="1.5" /><ellipse cx="102" cy="74" rx="3" ry="1.5" /></g>
      <g fill="#754dab" stroke="#302841" strokeWidth="3"><rect x="36" y="52" width="9" height="23" rx="4" /><rect x="115" y="52" width="9" height="23" rx="4" /></g>
      <path d="M120 71Q121 89 98 86" stroke="#3a2b4b" strokeWidth="3" fill="none" /><rect x="93" y="83" width="9" height="5" rx="2.5" fill="#ffe09a" />
    </g>
  </svg>;
}

function CharacterModel({ pet, state, reduced }: { pet: PetId; state: string; reduced: boolean }) {
  const [fallback, setFallback] = useState(false), [ready, setReady] = useState(false);
  const unavailable = useCallback(() => setFallback(true), []), available = useCallback(() => setReady(true), []);
  return <>
    {(!ready || fallback) && <span className={styles.body} data-companion-fallback={fallback ? 'compatible' : 'loading'}><CompatibleCharacter pet={pet} state={state} /></span>}
    {!fallback && <Model pet={pet} state={state} reduced={reduced} onUnavailable={unavailable} onReady={available} />}
  </>;
}

function CompanionCharacter({ pet, state, gesture, reduced = false, large = false, portrait = false }: CharacterProps) {
  const [visible,setVisible] = useState(true);
  useEffect(()=>{const update=()=>setVisible(!document.hidden);update();document.addEventListener('visibilitychange',update);return()=>document.removeEventListener('visibilitychange',update);},[]);
  const effectiveState = gesture || state;
  const paused = reduced || !visible || portrait;
  const expression = effectiveState === 'sleeping' || effectiveState === 'break' ? 'sleeping' : effectiveState === 'thinking' || effectiveState === 'working' || effectiveState === 'concerned' || effectiveState === 'error' ? 'thinking' : effectiveState === 'celebrating' || effectiveState === 'dancing' ? 'celebrating' : effectiveState === 'greeting' || effectiveState === 'pointing' ? 'greeting' : 'idle';
  return <span className={`${styles.character} ${large ? styles.largeCharacter : ''}`} data-pet={pet} data-state={effectiveState} data-reduced={paused} style={{ '--pet-accent': PETS[pet].accent } as CSSProperties} aria-hidden="true">
    <span className={styles.aura} /><span className={styles.shadow} />
    {pet === 'ambar' ? <span className={`${styles.body} ${styles.ambarBody}`}>
      {expression === 'idle' || portrait ? <img className={styles.ambarArt} src="/companions/ambar-v1.webp" alt="" width={822} height={900} draggable={false} decoding="async"/> : <span className={styles.ambarExpression} data-expression={expression}/>}
    </span> : portrait ? <CompatibleCharacter pet={pet} state="idle"/> : <CharacterModel key={pet} pet={pet} state={effectiveState} reduced={paused} />}
    {effectiveState === 'thinking' || effectiveState === 'working' ? <span className={styles.thought}>•••</span> : null}
    {effectiveState === 'sleeping' && <span className={styles.thought}>z Z</span>}
    {effectiveState === 'celebrating' && <span className={styles.stars}>✦　✧　✦</span>}
  </span>;
}
export default memo(CompanionCharacter);
