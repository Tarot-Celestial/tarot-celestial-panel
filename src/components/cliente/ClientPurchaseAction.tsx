"use client";
import { useSyncExternalStore, type ReactNode } from "react";
import ManualPurchaseButton from "./ManualPurchaseButton";

let enabled = false;
let pending: Promise<void> | null = null;
const listeners = new Set<() => void>();
async function refresh() {
  if (pending) return pending;
  pending = (async () => {
    let next = false;
    try {
      const response = await fetch("/api/cliente/payment-availability", { cache: "no-store" });
      const data = await response.json();
      next = response.ok && data.web_payments_enabled === true;
    } catch { /* Fail closed: purchases remain available by phone. */ }
    if (enabled !== next) { enabled = next; listeners.forEach(listener => listener()); }
  })().finally(() => { pending = null; });
  return pending;
}
let cleanup: (() => void) | null = null;
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    const update = () => { if (document.visibilityState === "visible") void refresh(); };
    update();
    const timer = window.setInterval(update, 60000);
    window.addEventListener("focus", update);
    window.addEventListener("online", update);
    document.addEventListener("visibilitychange", update);
    cleanup = () => { clearInterval(timer); window.removeEventListener("focus", update); window.removeEventListener("online", update); document.removeEventListener("visibilitychange", update); };
  }
  return () => { listeners.delete(listener); if (!listeners.size) { cleanup?.(); cleanup = null; enabled = false; } };
}
export default function ClientPurchaseAction({ children, className }: { children: ReactNode; className?: string }) {
  const active = useSyncExternalStore(subscribe, () => enabled, () => false);
  return active ? <>{children}</> : <ManualPurchaseButton className={className} />;
}
