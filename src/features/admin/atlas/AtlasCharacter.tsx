'use client';

import type { AtlasClientWatch } from './atlas-watch-types';
import { atlasWatchMinutes } from './atlas-watch-types';
import styles from './Atlas.module.css';

export function AtlasCharacter({ small = false, thinking = false }: { small?: boolean; thinking?: boolean }) {
  return <div className={`${styles.character} ${small ? styles.characterSmall : ''}`} data-thinking={thinking} aria-hidden="true">
    <img className={styles.characterPortrait} src="/companions/atlas-celestial-v2.webp" width={640} height={640} alt="" draggable={false} />
  </div>;
}

export function AtlasLauncher({ onOpen, alert, unreadCount = 0, stale = false }: { onOpen: () => void; alert?: AtlasClientWatch; unreadCount?: number; stale?: boolean }) {
  const notification = alert ? `${alert.clientName}: ${atlasWatchMinutes(alert)}${stale ? ' · pendiente de actualizar' : ''}` : null;
  return <button type="button" className={styles.launcher} data-alert={!!alert} onClick={onOpen} aria-label={notification ? `Abrir aviso de Atlas. ${notification}` : 'Abrir Atlas, tu asistente de administración'}>
    <AtlasCharacter small /><span><strong>Atlas{alert ? <i className={styles.launcherCount}>{unreadCount}</i> : null}</strong><small>{notification || 'Vamos a resolverlo'}</small></span><span className={styles.launcherSpark} aria-hidden="true">{alert ? '●' : '✦'}</span>
  </button>;
}
