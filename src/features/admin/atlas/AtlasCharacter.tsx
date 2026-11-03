'use client';

import { useEffect, useState } from 'react';
import AtlasPortrait from '@/components/atlas/AtlasPortrait';
import { useCompanionMotion } from '@/features/central/assistant/useCompanionMotion';
import type { AtlasClientWatch } from './atlas-watch-types';
import { atlasWatchMinutes } from './atlas-watch-types';
import styles from './Atlas.module.css';

export function AtlasCharacter({ small = false, thinking = false }: { small?: boolean; thinking?: boolean }) {
  return <div className={`${styles.character} ${small ? styles.characterSmall : ''}`} data-thinking={thinking} aria-hidden="true">
    <AtlasPortrait state={thinking ? 'thinking' : 'idle'}/>
  </div>;
}

export function AtlasLauncher({ onOpen, alert, unreadCount = 0, stale = false, workerId, label = 'Abrir Atlas, tu asistente de administración', paused = false }: { onOpen: () => void; alert?: AtlasClientWatch; unreadCount?: number; stale?: boolean; workerId?: string | null; label?: string; paused?: boolean }) {
  const [roaming,setRoaming] = useState(true), [reduced,setReduced] = useState(true), [visible,setVisible] = useState(true);
  const motion = useCompanionMotion(roaming && !reduced && visible, paused, workerId);
  useEffect(()=>{const media=window.matchMedia('(prefers-reduced-motion: reduce)');const update=()=>setReduced(media.matches);const show=()=>setVisible(!document.hidden);update();show();media.addEventListener('change',update);document.addEventListener('visibilitychange',show);return()=>{media.removeEventListener('change',update);document.removeEventListener('visibilitychange',show);};},[]);
  useEffect(()=>{try{setRoaming(!workerId || localStorage.getItem('tc-atlas-roaming:'+workerId)!=='false');}catch{setRoaming(true);}},[workerId]);
  useEffect(()=>{
    if(!roaming || reduced || !visible || paused)return;
    const timer=setInterval(()=>{
      const focused=document.activeElement;
      if(document.hidden || document.querySelector('dialog[open], [role="dialog"], [aria-modal="true"]') || (focused instanceof HTMLElement && (focused.isContentEditable || ['INPUT','TEXTAREA','SELECT'].includes(focused.tagName))))return;
      const anchors=[...document.querySelectorAll<HTMLElement>('main h2,main h3,[data-companion-landmark]')].filter(el=>{const r=el.getBoundingClientRect();return r.top>90 && r.bottom<window.innerHeight-180;});
      if(anchors.length)motion.point(anchors[Math.floor(Math.random()*anchors.length)]);
    },45000);
    return()=>clearInterval(timer);
  },[roaming,reduced,visible,paused,motion.point]);
  const toggleRoaming=()=>{const next=!roaming;setRoaming(next);if(workerId)try{localStorage.setItem('tc-atlas-roaming:'+workerId,String(next));}catch{/* Movement remains available without storage. */}};
  const notification = alert ? `${alert.clientName}: ${atlasWatchMinutes(alert)}${stale ? ' · pendiente de actualizar' : ''}` : null;
  return <div ref={motion.ref} className={styles.travellingLauncher} data-moving={motion.moving} data-dragging={motion.dragging}>
    <button type="button" className={styles.launcher} data-alert={!!alert} {...motion.dragProps} onClick={onOpen} aria-describedby="atlas-admin-move-help" aria-label={notification ? `Abrir aviso de Atlas. ${notification}` : label}>
      <span className={styles.launcherPortrait}><AtlasPortrait state={motion.dragging?'dragging':motion.moving?'walking':alert?'concerned':'idle'} paused={reduced||!visible||!roaming}/></span>
      <span className={styles.launcherCaption}><strong>Atlas{alert ? <i className={styles.launcherCount}>{unreadCount}</i> : null}</strong><small>{notification || 'Vamos a resolverlo'}</small></span>
    </button>
    <div className={styles.launcherControls}><button type="button" onClick={toggleRoaming} aria-label={roaming?'Pausar paseos de Atlas':'Reanudar paseos de Atlas'} aria-pressed={!roaming} title={roaming?'Pausar paseos':'Reanudar paseos'}>{roaming?'Ⅱ':'▷'}</button><button type="button" onClick={motion.dock} aria-label="Devolver Atlas a su rincón" title="Volver al rincón">⌂</button></div>
    <span id="atlas-admin-move-help" className={styles.srOnly} aria-live="polite">Arrastra a Atlas o usa las flechas para moverlo. Inicio lo devuelve al rincón. {motion.positionLabel}</span>
  </div>;
}
