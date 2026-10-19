'use client';

import { useId } from 'react';
import styles from './Atlas.module.css';

export function AtlasCharacter({ small = false, thinking = false }: { small?: boolean; thinking?: boolean }) {
  const uid = useId().replace(/:/g, '');
  return <div className={`${styles.character} ${small ? styles.characterSmall : ''}`} data-thinking={thinking} aria-hidden="true">
    <div className={styles.orbit} />
    <svg viewBox="0 0 160 160" fill="none" focusable="false">
      <defs>
        <radialGradient id={`${uid}-body`} cx=".3" cy=".22" r=".85"><stop stopColor="#e3d0ff" /><stop offset=".35" stopColor="#a47ef2" /><stop offset=".8" stopColor="#583897" /><stop offset="1" stopColor="#271c54" /></radialGradient>
        <linearGradient id={`${uid}-gold`} x1="31" y1="23" x2="131" y2="142" gradientUnits="userSpaceOnUse"><stop stopColor="#fff3c4" /><stop offset=".55" stopColor="#dbb86b" /><stop offset="1" stopColor="#977040" /></linearGradient>
      </defs>
      <ellipse cx="80" cy="140" rx="34" ry="6" fill="#b28cff" opacity=".15" />
      <path d="M45 95C29 99 25 113 32 119C40 124 47 113 52 107M115 95C131 99 135 113 128 119C120 124 113 113 108 107" fill={`url(#${uid}-body)`} stroke="#d9b9ff" strokeOpacity=".55" />
      <path d="M79 29C111 29 130 54 128 83C127 104 113 122 96 127L92 136L80 130L68 136L63 127C47 121 33 106 32 83C30 54 48 29 79 29Z" fill={`url(#${uid}-body)`} stroke="#e0ccff" strokeOpacity=".6" />
      <path d="M40 60C60 47 99 48 119 60" stroke="#fff" strokeOpacity=".16" strokeWidth="2" />
      <ellipse cx="80" cy="77" rx="35" ry="27" fill="#19112e" fillOpacity=".86" />
      <g className={styles.eyes}><ellipse cx="65" cy="75" rx="4.5" ry="7" fill="#fbebbf" /><ellipse cx="95" cy="75" rx="4.5" ry="7" fill="#fbebbf" /></g>
      <path d="M74 89Q80 94 86 89" stroke="#efd9ff" strokeWidth="2.5" strokeLinecap="round" />
      <ellipse cx="55" cy="85" rx="5" ry="2" fill="#d29bff" opacity=".35" /><ellipse cx="105" cy="85" rx="5" ry="2" fill="#d29bff" opacity=".35" />
      <path d="M80 17L84 26L94 29L84 33L80 43L76 33L66 29L76 26Z" fill={`url(#${uid}-gold)`} />
      <path d="M59 115L80 122L101 115" stroke={`url(#${uid}-gold)`} strokeWidth="3" strokeLinecap="round" />
      <path d="M80 106L84 112L80 118L76 112Z" fill={`url(#${uid}-gold)`} />
      <path d="M22 41L25 47L31 50L25 52L22 59L20 52L13 50L20 47Z" fill="#ddbd75" opacity=".8" />
      <path d="M136 103L138 107L143 109L138 111L136 116L134 111L129 109L134 107Z" fill="#d9c6ff" opacity=".8" />
    </svg>
  </div>;
}

export function AtlasLauncher({ onOpen }: { onOpen: () => void }) {
  return <button type="button" className={styles.launcher} onClick={onOpen} aria-label="Abrir Atlas, tu asistente de administración">
    <AtlasCharacter small /><span><strong>Atlas</strong><small>Vamos a resolverlo</small></span><span className={styles.launcherSpark}>✦</span>
  </button>;
}
