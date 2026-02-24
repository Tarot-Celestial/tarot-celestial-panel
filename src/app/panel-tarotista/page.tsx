"use client";

import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function Tarotista() {
  const [ok, setOk] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        window.location.href = "/login";
        return;
      }
      const me = await fetch("/api/me", { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json());
      if (!me?.ok) return (window.location.href = "/login");
      if (me.role !== "tarotista") {
        window.location.href = me.role === "admin" ? "/admin" : "/panel-central";
        return;
      }
      setOk(true);
    })();
  }, []);

  if (!ok) return <div style={{ padding: 40 }}>Cargando…</div>;
  return <div style={{ padding: 40 }}>Panel Tarotista (OK)</div>;
}
