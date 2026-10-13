"use client";
import { createContext, useContext } from "react";
/** Reuse the authenticated layout result; cards never infer access from a rank label. */
export const ClientRitualAccess = createContext(false);
export const useClientRitualAccess = () => useContext(ClientRitualAccess);
