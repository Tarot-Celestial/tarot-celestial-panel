"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";
import TCToaster from "@/components/ui/TCToaster";

const sb = supabaseBrowser();

function monthKeyNow() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function AppHeader() {
  const [name, setName] = useState<string>("Cargando…");
  const [role, setRole] = useState<string>("");
  const [team, setTeam] = useState<string>("");
  const [month, setMonth] = useState<string>(monthKeyNow());

  const pathname = usePathname();

  useEffect(() => {
    (async () => {
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return;

      const me = await fetch("/api/me", {
        headers: { Authorization: `Bearer ${token}` },
      }).then((r) => r.json());

      if (me?.ok) {
        setName(me.display_name || "Usuario");
        setRole(me.role || "");
        setTeam(me.team || "");

        // 🔥 FIX MES: no usar backend si no coincide
        const current = monthKeyNow();
        if (me.month_key === current) {
          setMonth(me.month_key);
        } else {
          setMonth(current);
        }
      }
    })();
  }, []);

  return (
    <>
      <div style={{ padding: 20 }}>
        <Image src="/tarot-celestial-logo.png" alt="logo" width={40} height={40} />
        <div>{name} · {role} · {team}</div>
        <div>Mes actual: {month}</div>
      </div>
      <TCToaster />
    </>
  );
}
