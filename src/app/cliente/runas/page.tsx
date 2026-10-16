"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import ClienteLayout from "@/components/cliente/ClienteLayout";
import RunesComingSoon from "@/components/cliente/RunesComingSoon";
import { supabaseClienteBrowser } from "@/lib/supabase-browser";

export default function ClientRunesPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const sb = supabaseClienteBrowser();
    let active = true;
    let authChanged = false;
    const acceptSession = (signedIn: boolean) => {
      if (!active) return;
      setReady(signedIn);
      if (!signedIn) router.replace("/cliente/login?next=runas");
    };
    const { data: auth } = sb.auth.onAuthStateChange((_event, session) => {
      authChanged = true;
      acceptSession(Boolean(session?.user));
    });
    void sb.auth.getSession().then(({ data }) => {
      if (!authChanged) acceptSession(Boolean(data.session?.user));
    }).catch(() => { if (!authChanged) acceptSession(false); });
    return () => { active = false; auth.subscription.unsubscribe(); };
  }, [router]);

  if (!ready) return <p role="status" style={{ padding: "2rem", color: "#fff1d8" }}>Preparando tu espacio…</p>;

  return <ClienteLayout title="Runas" subtitle="Un nuevo espacio está por descubrirse.">
    <RunesComingSoon />
  </ClienteLayout>;
}
