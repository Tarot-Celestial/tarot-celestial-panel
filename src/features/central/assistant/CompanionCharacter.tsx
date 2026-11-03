'use client';
import { memo, useEffect, useState } from 'react';
import type { PetId, PetState } from '@/lib/central-assistant';
import AtlasPortrait from '@/components/atlas/AtlasPortrait';
import styles from './CentralCompanion.module.css';
type CharacterProps = { pet: PetId; state: PetState; gesture?: string; reduced?: boolean; large?: boolean; portrait?: boolean; attention?: boolean };
function CompanionCharacter({ state, gesture, reduced = false, large = false, portrait = false, attention = false }: CharacterProps) {
  const [visible,setVisible] = useState(true);
  useEffect(()=>{const update=()=>setVisible(!document.hidden);update();document.addEventListener('visibilitychange',update);return()=>document.removeEventListener('visibilitychange',update);},[]);
  const effectiveState = gesture || state;
  return <span className={`${styles.character} ${large ? styles.largeCharacter : ''}`} data-pet="atlas" data-state={effectiveState} data-attention={attention} data-reduced={reduced || !visible || portrait} aria-hidden="true">
    <AtlasPortrait state={effectiveState} paused={reduced || !visible || portrait}/>
  </span>;
}
export default memo(CompanionCharacter);
