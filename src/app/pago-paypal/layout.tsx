import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "Estado del pago · Tarot Celestial",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export default function PaymentLayout({ children }: { children: React.ReactNode }) { return children; }
