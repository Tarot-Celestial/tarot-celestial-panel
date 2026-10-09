'use client';
import type { CSSProperties } from 'react';
import { PETS, type PetId, type PetState } from '@/lib/central-assistant';
import styles from './CentralCompanion.module.css';
const poses: Record<PetState,number> = { idle:0,listening:0,walking:0,thinking:2,working:2,pointing:1,celebrating:3,concerned:4,error:4,sleeping:5,break:2 };
export default function CompanionCharacter({ pet, state, reduced = false, large = false }: { pet: PetId; state: PetState; reduced?: boolean; large?: boolean }) {
  const index = poses[state];
  const walking=state==='walking'&&!reduced, resting=state==='break';
  return <span className={`${styles.character} ${large ? styles.largeCharacter : ''}`} data-pet={pet} data-state={state} data-reduced={reduced} style={{ '--pet-accent': PETS[pet].accent } as CSSProperties} aria-hidden="true">
    <span className={styles.aura}/><span className={styles.shadow}/>
    <span className={styles.body}><span className={`${styles.sprite} ${walking?styles.walkSprite:''}`} style={walking?{backgroundImage:`url(/companions/${pet}-walk.png)`}:resting?{backgroundImage:'url(/companions/break.png)',backgroundSize:'200% 100%',backgroundPosition:pet==='draco'?'0% 0%':'100% 0%'}:{ backgroundImage:`url(/companions/${pet}-atlas.png)`, backgroundPosition:`${index % 3 * 50}% ${Math.floor(index / 3) * 100}%` }}/></span>
    {state === 'thinking' || state === 'working' ? <span className={styles.thought}>•••</span> : null}
    {state === 'sleeping' && <span className={styles.thought}>z Z</span>}
    {state === 'celebrating' && <span className={styles.stars}>✦　✧　✦</span>}
  </span>;
}
