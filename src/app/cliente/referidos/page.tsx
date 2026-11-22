"use client";

import ClienteLayout from "@/components/cliente/ClienteLayout";
import ClientReferralRewards from "@/components/cliente/ClientReferralRewards";

export default function ClientReferralsPage() {
  return <ClienteLayout title="Mis referidos" subtitle="Comparte tu camino. Cada nuevo referido te acerca a tu próximo premio.">
    <ClientReferralRewards />
  </ClienteLayout>;
}
