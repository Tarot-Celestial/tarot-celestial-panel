"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

function PayPalFinalizarInner() {
  const searchParams = useSearchParams();
  const [msg, setMsg] = useState("Procesando pago...");
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      const token = searchParams.get("token") || searchParams.get("paypal_order_id") || "";
      const isCancel = searchParams.get("cancel") === "1";

      if (!token) {
        setMsg("Falta el identificador del pago.");
        setDone(true);
        return;
      }

      try {
        const r = await fetch(
          `/api/crm/pagos/paypal/capture?paypal_order_id=${encodeURIComponent(token)}${isCancel ? "&cancel=1" : ""}`,
          { cache: "no-store" }
        );

        const j = await r.json().catch(() => ({}));

        if (cancelled) return;

        if (!r.ok || !j?.ok) {
          setMsg(`Error procesando el pago: ${j?.error || r.status}`);
          setDone(true);
          return;
        }

        const clienteId = j?.pago?.cliente_id ? String(j.pago.cliente_id) : "";

        if (j?.status === "cancelled") {
          setMsg("Pago cancelado. Volviendo al CRM...");
          setDone(true);
          window.setTimeout(() => {
            window.location.href = clienteId ? `/admin?open_cliente_id=${encodeURIComponent(clienteId)}` : "/admin";
          }, 1200);
          return;
        }

        setMsg("Pago completado correctamente. Volviendo al CRM...");
        setDone(true);
        window.setTimeout(() => {
          window.location.href = clienteId ? `/admin?open_cliente_id=${encodeURIComponent(clienteId)}` : "/admin";
        }, 1200);
      } catch (e: any) {
        if (cancelled) return;
        setMsg(`Error procesando el pago: ${e?.message || "ERR"}`);
        setDone(true);
      }
    }

    run();

    return () => {
      cancelled = true;
    };
  }, [searchParams]);

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#0f0f11", color: "#fff", padding: 24 }}>
      <div style={{ width: "100%", maxWidth: 560, border: "1px solid rgba(255,255,255,.1)", borderRadius: 16, padding: 24, background: "#17171a" }}>
        <h1 style={{ margin: 0, fontSize: 24 }}>Tarot Celestial · PayPal</h1>
        <p style={{ marginTop: 16, lineHeight: 1.5 }}>{msg}</p>
        {done ? (
          <button
            onClick={() => {
              const clienteId = searchParams.get("cliente_id") || "";
              window.location.href = clienteId ? `/admin?open_cliente_id=${encodeURIComponent(clienteId)}` : "/admin";
            }}
            style={{
              marginTop: 16,
              border: 0,
              borderRadius: 10,
              padding: "10px 14px",
              cursor: "pointer",
            }}
          >
            Volver al CRM
          </button>
        ) : null}
      </div>
    </div>
  );
}

export default function PayPalFinalizarPage() {
  return (
    <Suspense
      fallback={
        <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#0f0f11", color: "#fff", padding: 24 }}>
          <div style={{ width: "100%", maxWidth: 560, border: "1px solid rgba(255,255,255,.1)", borderRadius: 16, padding: 24, background: "#17171a" }}>
            <h1 style={{ margin: 0, fontSize: 24 }}>Tarot Celestial · PayPal</h1>
            <p style={{ marginTop: 16, lineHeight: 1.5 }}>Procesando pago...</p>
          </div>
        </div>
      }
    >
      <PayPalFinalizarInner />
    </Suspense>
  );
}
