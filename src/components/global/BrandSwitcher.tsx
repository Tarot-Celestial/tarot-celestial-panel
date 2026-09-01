"use client";

import { useEffect } from "react";

const STORAGE_KEY = "tc_active_brand";
type BrandKey = "celestial" | "orion";

export function getActiveBrand(): BrandKey {
  if (typeof window === "undefined") return "celestial";
  try {
    window.localStorage.setItem(STORAGE_KEY, "celestial");
  } catch {}
  return "celestial";
}

export default function BrandSwitcher() {
  useEffect(() => {
    getActiveBrand();
    window.dispatchEvent(new CustomEvent("tc-brand-changed", { detail: { brand: "celestial" } }));
  }, []);

  return null;
}
