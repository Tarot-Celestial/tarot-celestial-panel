'use client';
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { clampCompanionPosition, DRAG_THRESHOLD, keyboardPosition, MANUAL_POSITION_PAUSE, parseSavedPosition, positionStorageKey, type CompanionPosition } from './companion-motion';

type Drag = { pointerId: number; startX: number; startY: number; origin: CompanionPosition; moved: boolean; element: HTMLButtonElement };

export function useCompanionMotion(enabled: boolean, busy: boolean, workerId?: string | null) {
  const ref = useRef<HTMLDivElement>(null), target = useRef({ x: 0, y: 0 }), position = useRef({ x: 0, y: 0 }), velocity = useRef({ x: 0, y: 0 });
  const [moving, setMoving] = useState(false), [dragging, setDragging] = useState(false), [highlight, setHighlight] = useState<DOMRect | null>(null);
  const highlighted = useRef<HTMLElement | null>(null), expiry = useRef(0), lastHighlight = useRef<DOMRect | null>(null);
  const current = useRef({ enabled, busy, workerId }); current.current = { enabled, busy, workerId };
  const drag = useRef<Drag | null>(null), manualUntil = useRef(0), suppressClickUntil = useRef(0);
  const wakeMotion = useRef<() => void>(() => {});
  const [positionLabel, setPositionLabel] = useState('');
  const bounded = useCallback((x: number, y: number) => clampCompanionPosition(x, y, window.innerWidth, window.innerHeight, ref.current?.offsetWidth || 136, Math.max(ref.current?.offsetHeight || 174, 174)), []);
  const clearHighlight = useCallback(() => { highlighted.current = null; lastHighlight.current = null; setHighlight(null); }, []);
  const persist = useCallback(() => {
    const key = positionStorageKey(current.current.workerId);
    if (key) { try { window.localStorage.setItem(key, JSON.stringify(position.current)); } catch { /* Storage can be disabled; dragging still works. */ } }
  }, []);
  const renderPosition = useCallback(() => {
    const el = ref.current; if (!el) return;
    const p = position.current;
    el.style.transform = `translate3d(${p.x.toFixed(2)}px,${p.y.toFixed(2)}px,0)`;
    const bubble = el.querySelector<HTMLElement>('[role="status"]'), bubbleWidth = bubble?.offsetWidth || 248, bubbleHeight = bubble?.offsetHeight || 170;
    const originalLeft = p.x + el.offsetWidth - 4 - bubbleWidth;
    const bubbleLeft = Math.max(8, Math.min(window.innerWidth - bubbleWidth - 8, originalLeft));
    const desiredTop = p.y >= bubbleHeight + 18 ? p.y - bubbleHeight - 14 : p.y + el.offsetHeight + 12;
    const bubbleTop = Math.max(8, Math.min(window.innerHeight - bubbleHeight - 8, desiredTop));
    el.style.setProperty('--bubble-offset', `${bubbleLeft - originalLeft}px`);
    el.style.setProperty('--bubble-top', `${bubbleTop - p.y}px`);
    el.style.setProperty('--bubble-bottom', 'auto');
    if (Math.abs(velocity.current.x) > 5) el.style.setProperty('--facing', velocity.current.x < 0 ? '-1' : '1');
  }, []);
  const place = useCallback((x: number, y: number) => {
    const p = bounded(x, y); target.current = p; position.current = { ...p }; velocity.current = { x: 0, y: 0 }; renderPosition();
  }, [bounded, renderPosition]);
  const move = useCallback((x: number, y: number) => {
    if (drag.current || current.current.busy || Date.now() < manualUntil.current) return;
    target.current = bounded(x, y);
    wakeMotion.current();
  }, [bounded]);
  const dock = useCallback(() => {
    clearHighlight(); manualUntil.current = Date.now() + MANUAL_POSITION_PAUSE;
    place(window.innerWidth - 156, window.innerHeight - 218); persist(); setPositionLabel('Mascota en su rincón.');
  }, [clearHighlight, place, persist]);
  const point = useCallback((element: HTMLElement | null) => {
    if (!element || drag.current || current.current.busy || Date.now() < manualUntil.current) return false;
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height || rect.bottom < 0 || rect.top > window.innerHeight) return false;
    highlighted.current = element; expiry.current = Date.now() + 6500; lastHighlight.current = rect; setHighlight(rect);
    wakeMotion.current();
    const candidates = [{ x: rect.right + 16, y: rect.top }, { x: rect.left - 152, y: rect.top }, { x: rect.right - 136, y: rect.bottom + 18 }];
    const interactive = [...document.querySelectorAll<HTMLElement>('button,input,textarea,select,[role="dialog"]')].filter(el => !el.closest('[data-companion-root]')).map(el => el.getBoundingClientRect()).filter(r => r.width > 0 && r.height > 0);
    const candidate = candidates.find(p => p.x >= 8 && p.x + 136 < window.innerWidth - 8 && p.y >= 8 && p.y + 174 < window.innerHeight - 8 && !interactive.some(r => p.x < r.right && p.x + 136 > r.left && p.y < r.bottom && p.y + 174 > r.top));
    if (candidate && current.current.enabled) move(candidate.x, candidate.y);
    return true;
  }, [move]);
  const finishDrag = useCallback((cancel = false) => {
    const d = drag.current; if (!d) return;
    drag.current = null; setDragging(false);
    if (d.element.hasPointerCapture?.(d.pointerId)) d.element.releasePointerCapture(d.pointerId);
    if (!d.moved) return;
    suppressClickUntil.current = Date.now() + 500; manualUntil.current = Date.now() + MANUAL_POSITION_PAUSE;
    if (cancel) place(d.origin.x, d.origin.y); else persist();
    setPositionLabel(cancel ? 'Movimiento cancelado.' : 'Mascota colocada. Puedes moverla con las flechas.');
  }, [place, persist]);
  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || !event.isPrimary || drag.current) return;
    suppressClickUntil.current = 0;
    drag.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, origin: { ...position.current }, moved: false, element: event.currentTarget };
    target.current = { ...position.current }; velocity.current = { x: 0, y: 0 }; event.currentTarget.setPointerCapture(event.pointerId);
  }, []);
  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    const d = drag.current; if (!d || d.pointerId !== event.pointerId) return;
    const dx = event.clientX - d.startX, dy = event.clientY - d.startY;
    if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    if (!d.moved) { d.moved = true; setDragging(true); clearHighlight(); }
    event.preventDefault(); place(d.origin.x + dx, d.origin.y + dy);
  }, [clearHighlight, place]);
  const onPointerUp = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => { if (event.pointerId === drag.current?.pointerId) finishDrag(); }, [finishDrag]);
  const onPointerCancel = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => { if (event.pointerId === drag.current?.pointerId) finishDrag(true); }, [finishDrag]);
  const onClickCapture = useCallback((event: ReactMouseEvent<HTMLButtonElement>) => {
    if (Date.now() < suppressClickUntil.current) { event.preventDefault(); event.stopPropagation(); suppressClickUntil.current = 0; }
  }, []);
  const onKeyDown = useCallback((event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Escape' && drag.current) { event.preventDefault(); finishDrag(true); return; }
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === 'Home') { event.preventDefault(); dock(); return; }
    const next = keyboardPosition(event.key, position.current, event.shiftKey); if (!next) return;
    event.preventDefault(); clearHighlight(); manualUntil.current = Date.now() + MANUAL_POSITION_PAUSE;
    place(next.x, next.y); persist(); setPositionLabel(`Posición de la mascota: ${Math.round(position.current.x)}, ${Math.round(position.current.y)}.`);
  }, [clearHighlight, dock, finishDrag, persist, place]);
  useEffect(() => {
    // Profiles on a shared terminal never inherit another worker's saved position.
    const previousDrag = drag.current; drag.current = null;
    if (previousDrag?.element.hasPointerCapture?.(previousDrag.pointerId)) previousDrag.element.releasePointerCapture(previousDrag.pointerId);
    setDragging(false); clearHighlight(); manualUntil.current = 0;
    let saved: CompanionPosition | null = null;
    const key = positionStorageKey(workerId);
    if (key) { try { saved = parseSavedPosition(window.localStorage.getItem(key)); } catch { /* Private browsing or unavailable storage. */ } }
    if (saved) manualUntil.current = Date.now() + MANUAL_POSITION_PAUSE;
    place(saved?.x ?? window.innerWidth - 156, saved?.y ?? window.innerHeight - 218);
  }, [workerId, clearHighlight, place]);
  // Parent-rendered bubbles can change size without any character movement.
  useEffect(() => { renderPosition(); });
  useEffect(() => {
    let raf = 0, last = 0, wasMoving = false, lastHighlightCheck = 0;
    const wake = () => {
      if (raf || document.hidden) return;
      last = 0;
      raf = requestAnimationFrame(frame);
    };
    wakeMotion.current = wake;
    function frame(time: number) {
      raf = 0;
      const dt = Math.min((time - last) / 1000 || 1 / 60, .032); last = time;
      const p = position.current, t = target.current, v = velocity.current;
      const previousX = p.x, previousY = p.y;
      if (!drag.current) {
        if (!current.current.enabled) { p.x = t.x; p.y = t.y; v.x = 0; v.y = 0; }
        else { const damping = Math.exp(-14 * dt); v.x = (v.x + (t.x - p.x) * 65 * dt) * damping; v.y = (v.y + (t.y - p.y) * 65 * dt) * damping; p.x += v.x * dt; p.y += v.y * dt; }
      }
      const active = !drag.current && Math.abs(t.x - p.x) + Math.abs(t.y - p.y) > 1;
      const settling = wasMoving && !active;
      if (!active && !drag.current) { p.x = t.x; p.y = t.y; v.x = 0; v.y = 0; }
      if (active !== wasMoving) { wasMoving = active; setMoving(active); }
      // Pointer dragging and parent renders position directly. An idle companion
      // needs no animation frame, layout measurement, or recurring DOM write.
      if (active || settling || p.x !== previousX || p.y !== previousY) renderPosition();
      if (highlighted.current && time - lastHighlightCheck > 100) {
        lastHighlightCheck = time;
        if (Date.now() > expiry.current || !highlighted.current.isConnected) clearHighlight();
        else { const rect = highlighted.current.getBoundingClientRect(), prev = lastHighlight.current;
          if (!prev || rect.x !== prev.x || rect.y !== prev.y || rect.width !== prev.width || rect.height !== prev.height) { lastHighlight.current = rect; setHighlight(rect); }
        }
      }
      if (active || highlighted.current) raf = requestAnimationFrame(frame);
    }
    const resize = () => { finishDrag(true); place(position.current.x, position.current.y); };
    const visibility = () => { cancelAnimationFrame(raf); raf = 0; if (document.hidden) finishDrag(); else { renderPosition(); wake(); } };
    const blur = () => finishDrag();
    wake(); window.addEventListener('resize', resize); window.addEventListener('blur', blur); document.addEventListener('visibilitychange', visibility);
    return () => {
      wakeMotion.current = () => {};
      cancelAnimationFrame(raf); window.removeEventListener('resize', resize); window.removeEventListener('blur', blur); document.removeEventListener('visibilitychange', visibility);
      const pendingDrag = drag.current; drag.current = null;
      if (pendingDrag?.element.hasPointerCapture?.(pendingDrag.pointerId)) pendingDrag.element.releasePointerCapture(pendingDrag.pointerId);
    };
  }, [clearHighlight, finishDrag, place, renderPosition]);
  useEffect(() => {
    if (busy || !enabled) { target.current = { ...position.current }; velocity.current = { x: 0, y: 0 }; clearHighlight(); setMoving(false); }
  }, [enabled, busy, clearHighlight]);
  return { ref, moving, dragging, highlight, point, dock, move, positionLabel, dragProps: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onLostPointerCapture: onPointerUp, onClickCapture, onKeyDown } };
}
