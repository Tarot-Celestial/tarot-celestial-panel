import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "Pago con tarjeta · Tarot Celestial",
  description: "Completa tu pago de forma segura con tarjeta.",
  robots: { index: false, follow: false }, referrer: "no-referrer",
};
export default function CardPaymentLayout({ children }: { children: React.ReactNode }) { return children; }
