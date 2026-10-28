import type { Metadata } from "next";
import "./globals.css";
import "./panel-theme.css";

import { PhoneProvider } from "@/context/PhoneContext";
import { OpsProvider } from "@/providers/OpsProvider";
import GlobalBottomBar from "@/components/global/GlobalBottomBar";
import PanelAccessGate from '@/components/attendance/PanelAccessGate';

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
            <PanelAccessGate>
              {children}
              <GlobalBottomBar />
            </PanelAccessGate>
          </PhoneProvider>
        </OpsProvider>
      </body>
    </html>
  );
}
