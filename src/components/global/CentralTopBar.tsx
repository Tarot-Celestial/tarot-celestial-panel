"use client";

import { supabaseBrowser } from "@/lib/supabase-browser";

const sb = supabaseBrowser();

export default function CentralTopBar() {
  async function logout() {
    await sb.auth.signOut();
    window.location.href = "/login";
  }

  return (
    <div
      style={{
        position: "fixed",
        top: 10,
        right: 10,
        zIndex: 9999,
        display: "flex",
        gap: 8,
      }}
    >
      <button
        className="tc-btn"
        onClick={() => (window.location.href = "/panel-central")}
      >
        🏠 Panel
      </button>

      <button
        className="tc-btn tc-btn-danger"
        onClick={logout}
      >
        🚪 Cerrar sesión
      </button>
    </div>
  );
}
