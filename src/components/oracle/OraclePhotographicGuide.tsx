'use client';

import { memo, useEffect, useRef } from 'react';
import type { OracleGuideAction } from '@/lib/oracle-guide-state';
import { createPortrait } from './photo/portrait';
import { createCardPerformance } from './photo/cards';
import './photo/cards.css';
import styles from './OraclePhotographicGuide.module.css';

type Props = {
  action: OracleGuideAction;
  motion: boolean;
  selectedIndex?: number;
  className?: string;
};

const IMAGE_ROOT = '/oraculo/guardiana';
const PORTRAIT = `${IMAGE_ROOT}/guardiana.webp`;
const GAZE = `${IMAGE_ROOT}/guardiana-mirada.webp`;

const PORTRAIT_POSES = {
  welcome: 'answer', idle: 'idle', reading: 'listening', 'oracle-open': 'idle',
  listening: 'listening', channeling: 'channeling', answer: 'answer', rest: 'listening',
  recover: 'idle', shuffle: 'idle', offer: 'idle', reveal: 'idle',
} as const satisfies Record<OracleGuideAction, string>;

function isCardAction(action: OracleGuideAction) {
  return action === 'shuffle' || action === 'offer' || action === 'reveal';
}

// Keep short gestures legible on a fast response. A new interaction or error can always interrupt.
function gestureDuration(previous: OracleGuideAction, next: OracleGuideAction) {
  if (previous === 'shuffle' && next === 'offer') return 1000;
  if (previous === 'reveal' && (next === 'offer' || next === 'reading')) return 950;
  if (previous === 'channeling' && next === 'answer') return 700;
  return 0;
}

function selectionZone(index: number) {
  return Number.isFinite(index) ? Math.max(0, Math.min(2, Math.floor(index / 7))) : 1;
}

type Presentation = Required<Pick<Props, 'action' | 'motion' | 'selectedIndex'>>;

function OraclePhotographicGuide({ action, motion, selectedIndex = 10, className = '' }: Props) {
  const portraitLayer = useRef<HTMLDivElement>(null);
  const cardLayer = useRef<HTMLDivElement>(null);
  const scene = useRef<HTMLDivElement>(null);
  const present = useRef<((value: Presentation) => void) | null>(null);

  useEffect(() => {
    const portraitHost = portraitLayer.current;
    const cardHost = cardLayer.current;
    const stage = scene.current;
    if (!portraitHost || !cardHost || !stage) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const canvas = document.createElement('canvas');
    portraitHost.append(canvas);
    let portrait: ReturnType<typeof createPortrait> | undefined;
    let cards: ReturnType<typeof createCardPerformance> | undefined;
    try { portrait = createPortrait(canvas, { src: PORTRAIT, gazeSrc: GAZE }); }
    catch { canvas.remove(); }
    try { cards = createCardPerformance(cardHost); }
    catch { cardHost.replaceChildren(); }

    let desired: Presentation | undefined;
    let shown: OracleGuideAction | undefined;
    let shownSince = 0;
    let timer: number | undefined;
    let portraitPaused: boolean | undefined;
    let cardsPaused: boolean | undefined;

    const sync = () => {
      window.clearTimeout(timer);
      if (!desired) return;
      const paused = !desired.motion || reduced.matches || document.hidden;
      const next = desired.action;
      const remaining = shown && !paused && shown !== next
        ? gestureDuration(shown, next) - (performance.now() - shownSince)
        : 0;
      const visible = remaining > 0 && shown ? shown : next;
      if (visible !== shown) {
        shown = visible;
        shownSince = performance.now();
        stage.dataset.presenting = shown;
      }
      const drawing = isCardAction(visible);
      if (paused !== cardsPaused) { cards?.setPaused(paused); cardsPaused = paused; }
      if ((paused || drawing) !== portraitPaused) {
        portraitPaused = paused || drawing;
        portrait?.setPaused(portraitPaused);
      }
      portrait?.setState(PORTRAIT_POSES[visible]);
      cards?.setState(drawing ? visible : 'idle', selectionZone(desired.selectedIndex));
      if (remaining > 0) timer = window.setTimeout(sync, Math.ceil(remaining));
    };
    present.current = value => { desired = value; sync(); };
    reduced.addEventListener('change', sync);
    document.addEventListener('visibilitychange', sync);

    return () => {
      present.current = null;
      window.clearTimeout(timer);
      reduced.removeEventListener('change', sync);
      document.removeEventListener('visibilitychange', sync);
      portrait?.destroy();
      cards?.destroy();
      canvas.remove();
    };
  }, []);

  useEffect(() => {
    present.current?.({ action, motion, selectedIndex });
  }, [action, motion, selectedIndex]);

  return <div ref={scene} className={`${styles.scene} ${className}`}
    data-action={action} data-guide="photographic" data-motion={motion} data-testid="oracle-character" aria-hidden="true">
    <img className={styles.poster} src={PORTRAIT} alt="" />
    <div ref={portraitLayer} className={styles.portrait} data-layer="portrait" />
    <div ref={cardLayer} className={styles.cards} data-layer="cards" />
  </div>;
}

export default memo(OraclePhotographicGuide);
