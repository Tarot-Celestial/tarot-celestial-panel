"use client";

import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import AppHeader from "@/components/AppHeader";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function Admin() {
  const [ok, setOk] = useState(false);
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string>("");

  useEffect(() => {
    (async () => {
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return (window.location.href = "/login");

      const me = await fetch("/api/me", {
        headers: { Authorization: `Bearer ${token}` },
      }).then((r) => r.json());

      if (!me?.ok) return (window.location.href = "/login");

      if (me.role !== "admin") {
        window.location.href =
          me.role === "central" ? "/panel-central" : "/panel-tarotista";
        return;
      }

      setOk(true);
    })();
  }, []);

  async function syncNow() {
    if (syncLoading) return;
    setSyncLoading(true);
    setSyncMsg("");

    try {
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        window.location.href = "/login";
        return;
      }

      const r = await fetch("/api/sync/calls", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const j = await r.json();
      if (!j?.ok) throw new Error(j?.error || "Sync failed");

      setSyncMsg(`✅ Sincronización OK. Upserted: ${j.upserted ?? 0}`);
    } catch (e: any) {
      setSyncMsg(`❌ ${e?.message || "Error"}`);
    } finally {
      setSyncLoading(false);
    }
  }

  if (!ok) return <div style={{ padding: 40 }}>Cargando…</div>;

  return (
    <>
      <AppHeader />

      <div style={{ padding: 24 }}>
        <h2 style={{ margin: "0 0 8px" }}>Panel Admin</h2>
        <div style={{ opacity: 0.75, fontSize: 12, marginBottom: 16 }}>
          Aquí tendrás control total. De momento añadimos el botón para sincronizar
          llamadas desde Google Sheets (manual), además del cron diario.
        </div>

        <div
          style={{
            display: "flex",
            gap: 10,
            alignItems: "center",
            flexWrap: "wrap",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 14,
            padding: 14,
            maxWidth: 720,
          }}
        >
          <button
            onClick={syncNow}
            disabled={syncLoading}
            style={{
              padding: "10px 12px",
              borderRadius: 12,
              border: "1px solid rgba(215,181,109,0.45)",
              background: "rgba(215,181,109,0.18)",
              color: "white",
              cursor: "pointer",
              minWidth: 170,
            }}
          >
            {syncLoading ? "Sincronizando…" : "Sincronizar ahora"}
          </button>

          <div style={{ fontSize: 12, opacity: 0.85 }}>
            {syncMsg || "Pulsa para importar/actualizar llamadas del CSV."}
          </div>
        </div>
      </div>
    </>
  );
}
