export default function PagoConfirmadoPage() {
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, background: "radial-gradient(circle at 50% 10%, rgba(113,76,169,.20), transparent 34%), #09070d", color: "#fff", fontFamily: "system-ui, sans-serif" }}>
      <section style={{ width: "min(560px, 100%)", padding: 30, borderRadius: 24, border: "1px solid rgba(224,190,104,.35)", background: "linear-gradient(145deg, rgba(29,20,39,.96), rgba(11,8,16,.98))", boxShadow: "0 28px 80px rgba(0,0,0,.5)", textAlign: "center" }}>
        <div style={{ color: "#e6c66f", fontSize: 12, fontWeight: 900, letterSpacing: ".16em" }}>TAROT CELESTIAL</div>
        <h1 style={{ margin: "12px 0 10px", fontSize: 30 }}>Gracias ✨</h1>
        <p style={{ margin: 0, color: "rgba(255,255,255,.72)", lineHeight: 1.65 }}>
          Hemos recibido tu proceso de pago. Mollie confirmará automáticamente el resultado a Tarot Celestial.
          Puedes cerrar esta pantalla y volver a WhatsApp.
        </p>
      </section>
    </main>
  );
}
