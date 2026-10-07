"use client";
import { useEffect, useRef, useState } from "react";

export default function PayPalResult() {
  const [state, setState] = useState("checking");
  const [message, setMessage] = useState("Estamos consultando el estado de tu pago con PayPal.");
  const busy = useRef(false);
  async function check() {
    if (busy.current) return;
    const params = new URLSearchParams(window.location.search);
    if (!params.get("ref")) { setState("error"); setMessage("Este enlace de confirmación no es válido."); return; }
    busy.current = true; setState("checking");
    try {
      const response = await fetch("/api/paypal-crm/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ref: params.get("ref"), cancel: params.get("cancel") === "1" }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo comprobar el pago.");
      setState(data.status);
      setMessage(data.status === "completed" ? "Tu pago está confirmado y la compra ya se ha registrado. Puedes volver al panel."
        : data.status === "cancelled" ? data.last_error || "Este pago no se ha completado. PayPal no ha facilitado el motivo. Contacta con tu central si necesitas otro enlace."
        : params.get("cancel") === "1" ? "Has salido del proceso de pago. No lo damos por pagado; puedes consultar su estado aquí."
        : "PayPal aún no ha confirmado el cobro. No repitas el pago. Puedes comprobarlo de nuevo en unos instantes.");
    } catch (error: any) { setState("error"); setMessage(error.message); }
    finally { busy.current = false; }
  }
  useEffect(() => { void check(); }, []);
  return <main style={{ minHeight: "100vh", background: "#0c0a18", color: "#fff5df", display: "grid", placeItems: "center", padding: 24 }}>
    <section style={{ maxWidth: 540, padding: 32, border: "1px solid #796440", borderRadius: 24, background: "#191325" }}>
      <small>TAROT CELESTIAL · PAYPAL</small>
      <h1>{state === "completed" ? "Pago confirmado" : state === "cancelled" ? "Pago no completado" : "Estado de tu pago"}</h1>
      <p role="status" style={{ lineHeight: 1.7 }}>{message}</p>
      {state !== "completed" && <button disabled={state === "checking"} onClick={() => void check()} style={{ padding: "14px 24px", borderRadius: 12, border: 0, background: "#edcd83", color: "#21142c", cursor: "pointer" }}>{state === "checking" ? "Comprobando…" : "Comprobar de nuevo"}</button>}
      <p><a href="/cliente" style={{ color: "#edcd83" }}>Volver al panel</a></p>
    </section>
  </main>;
}
