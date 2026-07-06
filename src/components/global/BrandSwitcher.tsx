"use client";

import { useEffect, useState } from "react";

type BrandKey = "celestial" | "orion";

const STORAGE_KEY = "tc_active_brand";

function normalizeBrand(value: string | null | undefined): BrandKey {
  return String(value || "").toLowerCase() === "orion" ? "orion" : "celestial";
}

export function getActiveBrand(): BrandKey {
  if (typeof window === "undefined") return "celestial";
  return normalizeBrand(window.localStorage.getItem(STORAGE_KEY));
}

export default function BrandSwitcher() {
  const [brand, setBrand] = useState<BrandKey>("celestial");

  useEffect(() => {
    setBrand(getActiveBrand());
  }, []);

  function changeBrand(next: BrandKey) {
    setBrand(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
      window.dispatchEvent(new CustomEvent("tc-brand-changed", { detail: { brand: next } }));
    } catch {}
  }

  const btn = (key: BrandKey, label: string) => {
    const active = brand === key;
    return (
      <button
        type="button"
        onClick={() => changeBrand(key)}
        title={key === "orion" ? "Ver y crear clientes de Tarot Orion" : "Ver y crear clientes de Tarot Celestial"}
        style={{
          border: active ? "1px solid rgba(215,181,109,.55)" : "1px solid rgba(255,255,255,.13)",
          background: active
            ? "linear-gradient(135deg, rgba(215,181,109,.28), rgba(181,156,255,.16))"
            : "rgba(255,255,255,.045)",
          color: active ? "#ffe8b7" : "rgba(255,255,255,.82)",
          height: 38,
          padding: "0 13px",
          borderRadius: 999,
          fontWeight: 900,
          cursor: "pointer",
          letterSpacing: ".02em",
          boxShadow: active ? "0 10px 28px rgba(215,181,109,.16)" : "none",
        }}
      >
        {label}
      </button>
    );
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: 4,
        borderRadius: 999,
        border: "1px solid rgba(255,255,255,.10)",
        background: "rgba(0,0,0,.18)",
      }}
    >
      {btn("celestial", "Celestial")}
      {btn("orion", "Orion")}
    </div>
  );
}
