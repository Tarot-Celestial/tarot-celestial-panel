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

function pathLabel(pathname: string) {
  if (!pathname) return "Panel";
  if (pathname === "/admin") return "Admin";
  if (pathname === "/panel-central") return "Centrales";
  if (pathname === "/panel-tarotista") return "Tarotista";
  return pathname.replaceAll("/", " · ").replace(/^ · /, "");
}

async function safeJson(res: Response) {
  const txt = await res.text();
  try {
    return JSON.parse(txt);
  } catch {
    console.error("Respuesta no JSON:", txt);
    return null;
  }
}

export default function AppHeader() {
  const [name, setName] = useState<string>("Cargando…");
  const [role, setRole] = useState<string>("");
  const [team, setTeam] = useState<string>("");
  const [month, setMonth] = useState<string>(monthKeyNow());
  const [estado, setEstado] = useState<"online" | "offline" | "break">("offline");
  const [startTime, setStartTime] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const pathname = usePathname();

  // 🔥 LOGIN LIMPIO SIN /api/me
  useEffect(() => {
    const { data: sub } = sb.auth.onAuthStateChange((_event, session) => {
      if (!session) window.location.href = "/login";
    });

    (async () => {
      const { data } = await sb.auth.getUser();
      const user = data?.user;

      if (!user) {
        window.location.href = "/login";
        return;
      }

      const { data: worker } = await sb
        .from("workers")
        .select("display_name, role, team")
        .eq("user_id", user.id)
        .maybeSingle();

      if (!worker) {
        window.location.href = "/login";
        return;
      }

      setName(worker.display_name || "Usuario");
      setRole(worker.role || "");
      setTeam(worker.team || "");
    })();

    return () => sub.subscription.unsubscribe();
  }, []);

  // 🔥 attendance sync
  async function syncEstado() {
    const { data } = await sb.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;

    const res = await fetch("/api/attendance/me", {
      headers: { Authorization: `Bearer ${token}` },
    });

    const j = await safeJson(res);
    if (!j?.ok) return;

    if (!j.online) {
      setEstado("offline");
      setStartTime(null);
      return;
    }

    if (j.status === "break") {
      setEstado("break");
      setStartTime(null);
      return;
    }

    setEstado("online");
    if (j.last_event_at) {
      setStartTime(new Date(j.last_event_at).getTime());
    }
  }

  useEffect(() => {
    syncEstado();
    const i = setInterval(syncEstado, 10000);
    return () => clearInterval(i);
  }, []);

  async function cambiarEstado(nuevo: "online" | "offline" | "break") {
    const { data } = await sb.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;

    await fetch("/api/attendance/event", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        event_type: nuevo === "break" ? "heartbeat" : nuevo,
      }),
    });

    await syncEstado();
  }

  async function logout() {
    await sb.auth.signOut();
    window.location.href = "/login";
  }

  // ⏱ timer
  useEffect(() => {
    if (!startTime) return;
    const i = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
    return () => clearInterval(i);
  }, [startTime]);

  function formatTime(sec: number) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return [h, m, s].map(v => String(v).padStart(2,"0")).join(":");
  }

  const roleText = useMemo(() => {
    if (role === "admin") return "Admin";
    if (role === "central") return "Central";
    if (role === "tarotista") return "Tarotista";
    return role || "Usuario";
  }, [role]);

  return (
    <>
      <div style={{ position: "sticky", top: 0, zIndex: 80 }}>
        <div className="tc-container" style={{ padding: "14px 18px" }}>
          <div className="tc-row" style={{ justifyContent: "space-between" }}>
            <div className="tc-row" style={{ gap: 14 }}>
              <Image src="/tarot-celestial-logo.png" alt="logo" width={38} height={38} />
              <div>
                <div style={{ fontWeight: 900 }}>Tarot Celestial</div>
                <div>{name} · {roleText}</div>
              </div>
            </div>

            <div className="tc-row" style={{ gap: 10 }}>
              <button className="tc-btn" onClick={() => cambiarEstado("online")}>🟢</button>
              <button className="tc-btn" onClick={() => cambiarEstado("break")}>⏸️</button>
              <button className="tc-btn" onClick={() => cambiarEstado("offline")}>🔴</button>

              {estado === "online" && startTime && (
                <div className="tc-chip">⏱ {formatTime(elapsed)}</div>
              )}

              <button className="tc-btn tc-btn-gold" onClick={logout}>Salir</button>
            </div>
          </div>
        </div>
      </div>

      <TCToaster />
    </>
  );
}
