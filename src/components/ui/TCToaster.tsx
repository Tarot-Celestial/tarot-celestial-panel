"use client";

import { useEffect, useMemo, useState } from "react";

type ToastTone = "success" | "error" | "warning" | "info";

type ToastItem = {
  id: string;
  title: string;
  description?: string;
  tone: ToastTone;
  duration?: number;
};

declare global {
  interface WindowEventMap {
    "tc-toast": CustomEvent<{
      title?: string;
      description?: string;
      tone?: ToastTone;
      duration?: number;
    }>;
  }
}

function iconForTone(tone: ToastTone) {
  if (tone === "success") return "✅";
  if (tone === "error") return "❌";
  if (tone === "warning") return "⚠️";
  return "🔔";
}

function toneClass(tone: ToastTone) {
  if (tone === "success") return "tc-toast-success";
  if (tone === "error") return "tc-toast-error";
  if (tone === "warning") return "tc-toast-warning";
  return "tc-toast-info";
}

export default function TCToaster() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    function onToast(
      e: CustomEvent<{
        title?: string;
        description?: string;
        tone?: ToastTone;
        duration?: number;
      }>
    ) {
      const detail = e.detail || {};
      const item: ToastItem = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        title: detail.title || "Notificación",
        description: detail.description || "",
        tone: detail.tone || "info",
        duration: typeof detail.duration === "number" ? detail.duration : 4200,
      };

      setItems((prev) => [...prev, item]);

      window.setTimeout(() => {
        setItems((prev) => prev.filter((x) => x.id !== item.id));
      }, item.duration);
    }

    window.addEventListener("tc-toast", onToast as EventListener);
    return () => window.removeEventListener("tc-toast", onToast as EventListener);
  }, []);

  const visible = useMemo(() => items.slice(-4), [items]);

  return (
    <div className="tc-toast-stack" aria-live="polite" aria-atomic="true">
      {visible.map((item) => (
        <div key={item.id} className={`tc-toast ${toneClass(item.tone)}`}>
          <div className="tc-toast-icon">{iconForTone(item.tone)}</div>

          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="tc-toast-title">{item.title}</div>
            {item.description ? (
              <div className="tc-toast-desc">{item.description}</div>
            ) : null}
          </div>

          <button
            type="button"
            className="tc-toast-close"
            onClick={() => setItems((prev) => prev.filter((x) => x.id !== item.id))}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
