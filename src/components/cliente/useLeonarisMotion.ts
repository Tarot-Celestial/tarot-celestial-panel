"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { clampLeonaris, normalizeLeonaris, restoreLeonaris, type LeonarisBounds, type LeonarisPoint } from "@/lib/leonaris-motion";

type Options = { uid: string | null; enabled: boolean; motion: boolean; visible: boolean; journey: boolean; onWake: () => void };
type Drag = { id: number; start: LeonarisPoint; origin: LeonarisPoint; moved: boolean; target: HTMLButtonElement };

export function useLeonarisMotion({ uid, enabled, motion, visible, journey, onWake }: Options) {
  const companionRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<LeonarisPoint | null>(null);
  const [dragging, setDragging] = useState(false);
  const [playful, setPlayful] = useState(false);
  const [lookDirection, setLookDirection] = useState<'front'|'left'|'right'>('front');
  const lookDirectionRef = useRef<'front'|'left'|'right'>('front');
  const normalized = useRef<LeonarisPoint | null>(null);
  const drag = useRef<Drag | null>(null);
  const pending = useRef<LeonarisPoint | null>(null);
  const dragFrame = useRef(0);
  const suppressUntil = useRef(0);
  const owner = useRef<string | null>(null);
  const wake = useRef(onWake);
  wake.current = onWake;
  const storageKey = (id: string) => `tc-leonaris-position-v1:${id}`;
  const bounds = useCallback((): LeonarisBounds => {
    const element = companionRef.current;
    return { width: window.innerWidth, height: window.innerHeight, petWidth: element?.offsetWidth || 160, petHeight: element?.offsetHeight || 170 };
  }, []);

  const save = useCallback((point: LeonarisPoint) => {
    const limited = clampLeonaris(point, bounds());
    setPosition(limited);
    normalized.current = normalizeLeonaris(limited, bounds());
    if (uid && owner.current === uid) try { localStorage.setItem(storageKey(uid), JSON.stringify(normalized.current)); } catch { /* Position is optional. */ }
  }, [uid, bounds]);

  const stopDrag = useCallback((persist: boolean) => {
    const current = drag.current;
    drag.current = null;
    cancelAnimationFrame(dragFrame.current); dragFrame.current = 0;
    if (current?.moved) {
      suppressUntil.current = performance.now() + 600;
      if (persist && pending.current) save(pending.current);
    }
    pending.current = null;
    if (current) try { if (current.target.hasPointerCapture(current.id)) current.target.releasePointerCapture(current.id); } catch { /* Pointer may already be released. */ }
    setDragging(false);
  }, [save]);

  useEffect(() => {
    stopDrag(false); owner.current = uid; normalized.current = null; setPosition(null); setPlayful(false);
    suppressUntil.current = 0;
    if (uid) try {
      const raw = JSON.parse(localStorage.getItem(storageKey(uid)) || "null");
      const point = restoreLeonaris(raw, bounds());
      if (point) { normalized.current = raw; setPosition(point); }
    } catch { /* A damaged or unavailable local position is ignored. */ }
  }, [uid, bounds, stopDrag]);

  useEffect(() => {
    if (!enabled || !visible || journey) stopDrag(false);
    if (enabled && !journey) setPosition(restoreLeonaris(normalized.current, bounds()));
    const resize = () => {
      stopDrag(true);
      const point = restoreLeonaris(normalized.current, bounds());
      setPosition(point);
    };
    window.addEventListener("resize", resize);
    return () => { window.removeEventListener("resize", resize); stopDrag(false); };
  }, [enabled, visible, journey, bounds, stopDrag]);

  useEffect(() => {
    const element = companionRef.current;
    if (!element) return;
    const reset = () => {
      element.style.setProperty("--leo-look-x", "0px");
      element.style.setProperty("--leo-look-y", "0px");
      element.style.setProperty("--leo-look-turn", "0deg");
      setPlayful(false);
      if (lookDirectionRef.current !== 'front') { lookDirectionRef.current = 'front'; setLookDirection('front'); }
    };
    reset();
    if (!enabled || !motion || !visible || journey || dragging || !window.matchMedia("(pointer: fine)").matches) return;
    let frame = 0, x = 0, y = 0, interactive = false;
    const move = (event: globalThis.PointerEvent) => {
      if (event.pointerType === "touch") return;
      x = event.clientX; y = event.clientY;
      interactive = !!(event.target as Element | null)?.closest?.("a,button,input,textarea,select,[role=button]");
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const rect = element.getBoundingClientRect(), dx = x - rect.left - rect.width / 2, dy = y - rect.top - rect.height * .38;
        const distance = Math.hypot(dx, dy), near = distance < 320;
        element.style.setProperty("--leo-look-x", `${near ? Math.max(-3, Math.min(3, dx / 55)) : 0}px`);
        element.style.setProperty("--leo-look-y", `${near ? Math.max(-2, Math.min(2, dy / 75)) : 0}px`);
        element.style.setProperty("--leo-look-turn", `${near ? Math.max(-4, Math.min(4, dx / 45)) : 0}deg`);
        // A wide dead zone prevents repeatedly swapping poses around the center.
        const direction = !near ? 'front' : dx < -70 || (lookDirectionRef.current === 'left' && dx < -35) ? 'left' : dx > 70 || (lookDirectionRef.current === 'right' && dx > 35) ? 'right' : 'front';
        if (direction !== lookDirectionRef.current) { lookDirectionRef.current = direction; setLookDirection(direction); }
        // Play stays inside the companion's own box and never follows a page control.
        setPlayful(near && distance > 70 && distance < 190 && !interactive);
      });
    };
    const leave = () => { cancelAnimationFrame(frame); frame = 0; reset(); };
    window.addEventListener("pointermove", move, { passive: true });
    document.documentElement.addEventListener("pointerleave", leave);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("pointermove", move); document.documentElement.removeEventListener("pointerleave", leave); reset(); };
  }, [enabled, motion, visible, journey, dragging]);

  const resetPosition = useCallback(() => {
    stopDrag(false); normalized.current = null; setPosition(null);
    if (uid) try { localStorage.removeItem(storageKey(uid)); } catch { /* Optional preference. */ }
  }, [uid, stopDrag]);

  return {
    companionRef, position, dragging, playful, lookDirection, resetPosition,
    consumeClick: () => performance.now() < suppressUntil.current,
    characterHandlers: {
      onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
        if (!enabled || journey || !event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return;
        const rect = companionRef.current?.getBoundingClientRect(); if (!rect) return;
        drag.current = { id: event.pointerId, start: { x: event.clientX, y: event.clientY }, origin: { x: rect.left, y: rect.top }, moved: false, target: event.currentTarget };
        event.currentTarget.setPointerCapture(event.pointerId);
      },
      onPointerMove: (event: PointerEvent<HTMLButtonElement>) => {
        const current = drag.current; if (!current || current.id !== event.pointerId) return;
        const dx = event.clientX - current.start.x, dy = event.clientY - current.start.y;
        if (!current.moved && Math.hypot(dx, dy) < 6) return;
        if (!current.moved) { current.moved = true; setDragging(true); wake.current(); }
        event.preventDefault();
        pending.current = clampLeonaris({ x: current.origin.x + dx, y: current.origin.y + dy }, bounds());
        if (!dragFrame.current) dragFrame.current = requestAnimationFrame(() => { dragFrame.current = 0; if (pending.current) setPosition(pending.current); });
      },
      onPointerUp: (event: PointerEvent<HTMLButtonElement>) => { if (drag.current?.id === event.pointerId) stopDrag(true); },
      onPointerCancel: (event: PointerEvent<HTMLButtonElement>) => { if (drag.current?.id === event.pointerId) stopDrag(true); },
      onLostPointerCapture: (event: PointerEvent<HTMLButtonElement>) => { if (drag.current?.id === event.pointerId) stopDrag(true); },
      onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
        if (journey || !enabled || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home"].includes(event.key)) return;
        event.preventDefault(); wake.current();
        if (event.key === "Home") { resetPosition(); return; }
        const rect = companionRef.current?.getBoundingClientRect(); if (!rect) return;
        save({ x: rect.left + (event.key === "ArrowLeft" ? -24 : event.key === "ArrowRight" ? 24 : 0), y: rect.top + (event.key === "ArrowUp" ? -24 : event.key === "ArrowDown" ? 24 : 0) });
      },
    },
  };
}
