"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import ClienteLayout from "@/components/cliente/ClienteLayout";
import PurchaseRoulette from "@/components/cliente/PurchaseRoulette";
import { supabaseClienteBrowser } from "@/lib/supabase-browser";

const sb = supabaseClienteBrowser();

export default function ClienteRuletaPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    sb.auth.getSession().then(({ data }) => {
      if (!active) return;
      if (!data.session?.user) {
        router.replace("/cliente/login?next=ruleta");
        return;
      }
      setReady(true);
    });
    return () => { active = false; };
  }, [router]);

  return (
    <ClienteLayout
      title="Ruletas clientes"
      subtitle="Compra, gana giros y descubre premios reales. Si eres cliente Diamante, además disfrutas de la Ruleta Diamante: 1 giro por cada compra válida."
      eyebrow="Experiencia Celestial"
    >
      <div style={{ marginTop: 18 }}>
        {ready ? (
          <PurchaseRoulette />
        ) : (
          <section className="tc-card" style={{ minHeight: 260, display: "grid", placeItems: "center" }}>
            Preparando tus ruletas…
          </section>
        )}
      </div>
    </ClienteLayout>
  );
}
