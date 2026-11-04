'use client';

import { memo, useEffect, useRef, useState } from 'react';
import type { OracleCharacterAction, OracleCharacterState } from './oracle-character-motion';
import styles from './OracleCharacter3D.module.css';

export type { OracleCharacterAction } from './oracle-character-motion';
export type OracleCharacter3DProps = {
  action: OracleCharacterAction;
  motion: boolean;
  selectedIndex?: number;
  className?: string;
};

type Controller = ReturnType<typeof import('./oracle-character-scene')['createOracleCharacterScene']>;

function OracleCharacter3D({ action, motion, selectedIndex = 10, className = '' }: OracleCharacter3DProps) {
  const host = useRef<HTMLDivElement>(null);
  const controller = useRef<Controller | null>(null);
  const current = useRef<OracleCharacterState>({ action, motion, selectedIndex });
  const wake = useRef<() => void>(() => {});
  const [status, setStatus] = useState<'loading' | 'ready' | 'fallback'>('loading');

  useEffect(() => {
    current.current = { action, motion, selectedIndex };
    controller.current?.update(current.current);
    wake.current();
  }, [action, motion, selectedIndex]);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let mounted = true, visible = true, failed = false, raf = 0, elapsed = 0, lastFrame = 0;
    let resizeObserver: ResizeObserver | undefined, observer: IntersectionObserver | undefined;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const active = () => mounted && !failed && visible && !document.hidden;
    const animated = () => current.current.motion && !media.matches;
    const cancel = () => { if (raf) cancelAnimationFrame(raf); raf = 0; lastFrame = 0; };
    const renderStill = () => {
      if (!active() || !controller.current) return;
      try {
        controller.current.update({ ...current.current, motion: animated() });
        controller.current.render(elapsed, 1 / 30);
      } catch { fail(); }
    };
    const frame = (now: number) => {
      raf = 0;
      if (!active() || !controller.current) { lastFrame = 0; return; }
      if (!animated()) { renderStill(); lastFrame = 0; return; }
      const sinceLast = lastFrame ? now - lastFrame : 1000 / 30;
      if (sinceLast >= 1000 / 30 - .5) {
        const delta = Math.min(sinceLast / 1000, .08); elapsed += delta; lastFrame = now;
        try {
          controller.current.update({ ...current.current, motion: true });
          controller.current.render(elapsed, delta);
        } catch { fail(); return; }
      }
      raf = requestAnimationFrame(frame);
    };
    const resume = () => {
      cancel();
      if (!active()) return;
      renderStill();
      if (animated()) raf = requestAnimationFrame(frame);
    };
    wake.current = resume;
    const fail = () => {
      if (!mounted || failed) return;
      failed = true; cancel(); controller.current?.dispose(); controller.current = null; setStatus('fallback');
    };
    const resize = () => { try { controller.current?.resize(); resume(); } catch { fail(); } };
    document.addEventListener('visibilitychange', resume);
    media.addEventListener('change', resume);
    if (typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver(entries => { visible = entries[0]?.isIntersecting ?? true; resume(); }, { rootMargin: '80px' });
      observer.observe(element);
    }
    if (typeof ResizeObserver !== 'undefined') { resizeObserver = new ResizeObserver(resize); resizeObserver.observe(element); }
    else window.addEventListener('resize', resize);

    void import('./oracle-character-scene').then(({ createOracleCharacterScene }) => {
      if (!mounted) return;
      try {
        controller.current = createOracleCharacterScene(element, fail);
        controller.current.update(current.current);
        setStatus('ready'); resume();
      } catch { fail(); }
    }).catch(fail);
    return () => {
      mounted = false; cancel(); wake.current = () => {};
      observer?.disconnect(); resizeObserver?.disconnect();
      document.removeEventListener('visibilitychange', resume);
      media.removeEventListener('change', resume); window.removeEventListener('resize', resize);
      controller.current?.dispose(); controller.current = null;
    };
  }, []);

  return <div className={`${styles.scene} ${className}`} data-action={action} data-renderer={status} data-testid="oracle-character">
    <div className={styles.canvas} ref={host} aria-hidden="true" />
    {status !== 'ready' && <div className={styles.fallback}>
      <img src="/images/oracle/guide.webp" alt="Guía virtual en una mesa violeta" />
      <span>{status === 'loading' ? 'Preparando la escena…' : 'Vista estática · puedes continuar tu consulta'}</span>
    </div>}
    <div className={styles.vignette} aria-hidden="true" />
    <div className={styles.signature} aria-hidden="true"><span />LA GUARDIANA DEL ORÁCULO<span /></div>
  </div>;
}

export default memo(OracleCharacter3D);
