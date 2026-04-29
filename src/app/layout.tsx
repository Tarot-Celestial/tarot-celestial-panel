import type { Metadata } from "next";
import "./globals.css";

import { PhoneProvider } from "@/context/PhoneContext";
import GlobalBottomBar from "@/components/global/GlobalBottomBar";

export const metadata: Metadata = {
  title: "Panel Interno - Tarot Celestial",
  description: "Sistema interno de gestión de trabajadores",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="bg-[#0b0b0f] text-white">
        <PhoneProvider>
          {children}
          <GlobalBottomBar />
        </PhoneProvider>
      </body>
    </html>
  );
}
