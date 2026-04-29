"use client";

import { createContext, useContext, useState } from "react";

type PhoneState = {
  isOpen: boolean;
  setIsOpen: (v: boolean) => void;
};

const PhoneContext = createContext<PhoneState | null>(null);

export function PhoneProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <PhoneContext.Provider value={{ isOpen, setIsOpen }}>
      {children}
    </PhoneContext.Provider>
  );
}

export function usePhone() {
  const ctx = useContext(PhoneContext);
  if (!ctx) throw new Error("usePhone fuera de provider");
  return ctx;
}
