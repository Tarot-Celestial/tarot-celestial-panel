'use client';
import { memo, useState } from 'react';
import { ATLAS_IDENTITY } from '@/lib/atlas-identity';
import styles from './AtlasPortrait.module.css';
type Props = { state?: string; paused?: boolean; className?: string };
function AtlasPortrait({ state = 'idle', paused = false, className = '' }: Props) {
  const [failed, setFailed] = useState(false);
  const thinking = state === 'thinking' || state === 'working';
  return <span className={`${styles.portrait} ${className}`} data-atlas-state={state} data-paused={paused} aria-hidden="true">
    <span className={styles.halo}/>
    {failed ? <span className={styles.fallback}>🦉</span> : <img className={styles.art} src={ATLAS_IDENTITY.image} width={640} height={640} alt="" draggable={false} decoding="async" onError={()=>setFailed(true)}/>}
    <span className={styles.heart}>✦</span>
    {thinking ? <span className={styles.thought}>•••</span> : null}
    {state === 'sleeping' || state === 'break' ? <span className={styles.thought}>z Z</span> : null}
    {state === 'celebrating' || state === 'dancing' ? <span className={styles.sparkles}>✧　✦　✧</span> : null}
  </span>;
}
export default memo(AtlasPortrait);
