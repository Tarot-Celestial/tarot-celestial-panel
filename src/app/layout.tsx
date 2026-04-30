import type { Metadata } from "next";
import "./globals.css";

import { PhoneProvider } from "@/context/PhoneContext";
import { OpsProvider } from "@/providers/OpsProvider";
import GlobalBottomBar from "@/components/global/GlobalBottomBar";

export const metadata: Metadata = {
  title: "Panel Interno - Tarot Celestial",
  description: "Sistema interno de gestión de trabajadores",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="bg-[#0b0b0f] text-white">
        <OpsProvider>
          <PhoneProvider>
            {children}
            <GlobalBottomBar />
          </PhoneProvider>
        </OpsProvider>
      </body>
    </html>
  );
}
